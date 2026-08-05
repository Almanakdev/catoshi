// Quest runner.
//
// The whole point of this module is that NOTHING else in the game knows quests
// exist. Systems emit their normal gameplay events (an order was served, a fish
// was caught, a district was entered) and this file translates them into
// objective progress through one universal hook: `progress(type, target, n)`.
//
// Persistence is deliberately tiny and lives entirely in `state.data.quests`:
//
//   {
//     active: { [questId]: { objIndex: number, counts: number[], ready: boolean } },
//     done:   [questId, ...],
//     offered:[questId, ...],
//   }
//
// Nothing else is written, so a save/load round trip is just JSON. The runner
// re-hydrates from that blob on EV.LOAD.
//
// Robustness policy: a malformed quest (missing objectives, unknown objective
// type, bad ids) is logged once and skipped. This file must never throw into
// the frame loop or into a bus dispatch.

import { EV } from './bus.js';
import {
  QUESTS, QUEST_INDEX, OBJECTIVE_TYPES,
  questAvailable, objectiveText,
} from '../data/quests.js';
import { npc } from '../data/npcs.js';
import { ingredient } from '../data/ingredients.js';
import { recipe } from '../data/recipes.js';
import { districtById } from '../data/districts.js';

/**
 * Objective types whose progress is an ABSOLUTE reading rather than an
 * accumulation ("reach 200 reputation", not "gain 200 reputation").
 */
const ABSOLUTE = new Set(['reputation']);

const REFRESH_EVERY = 1.5;   // seconds between availability sweeps

const isFn = (f) => typeof f === 'function';

/** Objective's required count, defaulting to 1 and never 0/NaN/negative. */
function needOf(obj) {
  const n = obj && obj.count == null ? 1 : Number(obj && obj.count);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Turn any content id into something a player can read. */
export function resolveName(id) {
  if (id == null) return '';
  const key = String(id);
  const n = npc(key); if (n) return n.name;
  const r = recipe(key); if (r) return r.name;
  const d = districtById(key); if (d) return d.name;
  const ing = ingredient(key); if (ing) return ing.name;
  return key;
}

export function createQuests(game) {
  const bus = game && game.bus;
  const state = game && game.state;
  if (!bus || !state) {
    console.error('[quests] createQuests needs game.bus and game.state');
  }

  const badQuests = new Set();   // ids we have already complained about
  const offs = [];               // bus unsubscribers
  let tracked = null;            // in-memory only (see note in `setTracked`)
  let sinceRefresh = 0;

  // ------------------------------------------------------------- persistence
  /** Always read through this — `state.fromJSON` swaps the whole data object. */
  function store() {
    const d = state && state.data;
    if (!d) return { active: {}, done: [], offered: [] };
    let q = d.quests;
    if (!q || typeof q !== 'object') { q = d.quests = { active: {}, done: [], offered: [] }; }
    if (!q.active || typeof q.active !== 'object' || Array.isArray(q.active)) q.active = {};
    if (!Array.isArray(q.done)) q.done = [];
    if (!Array.isArray(q.offered)) q.offered = [];
    return q;
  }

  /** Repair a loaded blob: drop unknown ids, resize counts, clamp indices. */
  function rehydrate() {
    const q = store();
    for (const id of Object.keys(q.active)) {
      const def = QUEST_INDEX[id];
      if (!validQuest(def)) { delete q.active[id]; continue; }
      const e = q.active[id];
      if (!e || typeof e !== 'object') { delete q.active[id]; continue; }
      const n = def.objectives.length;
      const counts = Array.isArray(e.counts) ? e.counts.slice(0, n) : [];
      while (counts.length < n) counts.push(0);
      for (let i = 0; i < n; i++) {
        const v = Number(counts[i]);
        counts[i] = Number.isFinite(v) && v > 0 ? v : 0;
      }
      e.counts = counts;
      const oi = Number(e.objIndex);
      e.objIndex = Number.isFinite(oi) ? Math.max(0, Math.min(n - 1, Math.trunc(oi))) : 0;
      e.ready = !!e.ready;
      if (!def.parallel) {
        // Re-derive the cursor so an old save cannot get stuck on a done step.
        while (e.objIndex < n - 1 && counts[e.objIndex] >= needOf(def.objectives[e.objIndex])) e.objIndex++;
      }
    }
    q.done = q.done.filter((id) => typeof id === 'string');
    q.offered = q.offered.filter((id) => typeof id === 'string' && !!QUEST_INDEX[id]);
    if (tracked && !q.active[tracked]) tracked = null;
    if (!tracked) tracked = Object.keys(q.active)[0] || null;
  }

  // ---------------------------------------------------------------- validity
  function validQuest(q) {
    if (!q || typeof q !== 'object' || typeof q.id !== 'string') return false;
    if (badQuests.has(q.id)) return false;
    if (!Array.isArray(q.objectives) || q.objectives.length === 0) {
      complain(q.id, 'has no objectives');
      return false;
    }
    for (const o of q.objectives) {
      if (!o || typeof o !== 'object' || !OBJECTIVE_TYPES[o.type]) {
        complain(q.id, `has an objective with an unknown type "${o && o.type}"`);
        return false;
      }
    }
    return true;
  }

  function complain(id, why) {
    if (badQuests.has(id)) return;
    badQuests.add(id);
    console.warn(`[quests] skipping "${id}" — it ${why}.`);
  }

  // ------------------------------------------------------------------ lookup
  function entryOf(id) {
    const q = store();
    const e = q.active[id];
    return e || null;
  }

  function isDone(id) { return store().done.includes(id); }
  function isActive(id) { return !!store().active[id]; }

  /** Public helper — `entry` is one of the objects returned by `get active()`. */
  function isObjectiveDone(entry, i) {
    if (!entry) return false;
    const q = entry.quest || QUEST_INDEX[entry.id];
    if (!validQuest(q)) return false;
    const obj = q.objectives[i];
    if (!obj) return false;
    const counts = entry.counts || [];
    return (Number(counts[i]) || 0) >= needOf(obj);
  }

  function allObjectivesDone(q, e) {
    for (let i = 0; i < q.objectives.length; i++) {
      if ((Number(e.counts[i]) || 0) < needOf(q.objectives[i])) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ offers
  function offer(questId) {
    const q = QUEST_INDEX[questId];
    if (!validQuest(q)) return false;
    const s = store();
    if (s.active[q.id]) return false;
    if (s.done.includes(q.id) && !q.repeatable) return false;
    if (!s.offered.includes(q.id)) s.offered.push(q.id);
    bus.emit(EV.QUEST_OFFERED, { quest: q });
    return true;
  }

  function refreshAvailability() {
    const s = store();
    for (const q of QUESTS) {
      try {
        if (!validQuest(q)) continue;
        if (s.active[q.id]) continue;
        if (s.done.includes(q.id) && !q.repeatable) continue;
        if (s.offered.includes(q.id)) continue;
        if (!questAvailable(q, state)) continue;
        s.offered.push(q.id);
        bus.emit(EV.QUEST_OFFERED, { quest: q });
      } catch (err) {
        complain(q && q.id, 'threw while being evaluated');
        console.error('[quests] refreshAvailability', err);
      }
    }
    // Something we already offered may have become unavailable again (a
    // repeatable quest that got taken, a requirement that regressed).
    s.offered = s.offered.filter((id) => {
      const q = QUEST_INDEX[id];
      if (!validQuest(q)) return false;
      if (s.active[id]) return false;
      if (s.done.includes(id) && !q.repeatable) return false;
      return questAvailable(q, state);
    });
  }

  /** Quests this NPC can hand out right now. */
  function availableFrom(npcId) {
    if (!npcId) return [];
    const s = store();
    const out = [];
    for (const q of QUESTS) {
      if (!validQuest(q)) continue;
      if (q.giver !== npcId) continue;
      if (s.active[q.id]) continue;
      if (s.done.includes(q.id) && !q.repeatable) continue;
      try { if (!questAvailable(q, state)) continue; } catch { continue; }
      out.push(q);
    }
    return out;
  }

  /** Active quests waiting to be handed in to this NPC. */
  function readyFor(npcId) {
    if (!npcId) return [];
    const s = store();
    const out = [];
    for (const id of Object.keys(s.active)) {
      const q = QUEST_INDEX[id];
      if (!validQuest(q)) continue;
      if (q.turnIn !== npcId) continue;
      if (s.active[id].ready) out.push(q);
    }
    return out;
  }

  /** Does this NPC deserve a marker over their head? '!' offer, '?' turn-in. */
  function markerFor(npcId) {
    if (readyFor(npcId).length) return '?';
    if (availableFrom(npcId).length) return '!';
    return null;
  }

  // ------------------------------------------------------------------- start
  function start(questId) {
    const q = QUEST_INDEX[questId];
    if (!validQuest(q)) return false;
    const s = store();
    if (s.active[q.id]) return false;
    if (s.done.includes(q.id) && !q.repeatable) return false;
    try { if (!questAvailable(q, state)) return false; } catch { return false; }

    const counts = new Array(q.objectives.length).fill(0);
    // "Reach N reputation" is a reading, not a tally — seed it so a quest taken
    // at rep 40 with a "reach 45" step does not ask for 45 more.
    for (let i = 0; i < q.objectives.length; i++) {
      if (q.objectives[i].type === 'reputation') counts[i] = Number(state.reputation) || 0;
    }
    s.active[q.id] = { objIndex: 0, counts, ready: false };
    s.offered = s.offered.filter((id) => id !== q.id);
    if (q.repeatable) s.done = s.done.filter((id) => id !== q.id);

    if (!tracked) tracked = q.id;
    bus.emit(EV.QUEST_STARTED, { quest: q });
    bus.emit(EV.TOAST, { text: `New quest: ${q.title}`, icon: '📜', tone: 'good' });

    // A quest can open already satisfied (seeded reputation, or a 0-count step).
    checkCompletion(q.id);
    return true;
  }

  function abandon(questId) {
    const s = store();
    if (!s.active[questId]) return false;
    delete s.active[questId];
    if (tracked === questId) tracked = Object.keys(s.active)[0] || null;
    const q = QUEST_INDEX[questId];
    bus.emit(EV.TOAST, { text: `Abandoned: ${q ? q.title : questId}`, icon: '📕', tone: 'bad' });
    refreshAvailability();
    return true;
  }

  // ---------------------------------------------------------------- progress
  /**
   * The universal hook. Every other system funnels here (usually via the bus
   * wiring below, never by importing this module).
   */
  function progress(type, target, amount = 1) {
    if (!type || !OBJECTIVE_TYPES[type]) return false;
    const s = store();
    const amt = Number(amount);
    if (!Number.isFinite(amt)) return false;
    if (!ABSOLUTE.has(type) && amt <= 0) return false;

    let touched = false;
    // Snapshot: completing a quest can start its `next`, which mutates `active`.
    for (const id of Object.keys(s.active)) {
      const q = QUEST_INDEX[id];
      if (!validQuest(q)) continue;
      const e = s.active[id];
      if (!e || e.ready) continue;

      try {
        let hit = false;
        const idxs = q.parallel
          ? q.objectives.map((_, i) => i)
          : [Math.max(0, Math.min(q.objectives.length - 1, e.objIndex | 0))];

        for (const i of idxs) {
          const obj = q.objectives[i];
          if (!obj || obj.type !== type) continue;
          if (!targetMatches(obj, target)) continue;
          const req = needOf(obj);
          const before = Number(e.counts[i]) || 0;
          if (before >= req) continue;

          const after = ABSOLUTE.has(type)
            ? Math.max(before, amt)
            : Math.min(req, before + amt);
          if (after === before) continue;
          e.counts[i] = after;
          touched = true;
          hit = true;

          bus.emit(EV.QUEST_PROGRESS, {
            quest: q, objective: obj, index: i,
            count: after, need: req,
            text: objectiveText(obj, resolveName),
            done: after >= req,
          });
          if (after >= req && !q.parallel) advanceCursor(q, e);
        }
        if (hit) checkCompletion(id);
      } catch (err) {
        complain(id, 'threw while taking progress');
        console.error('[quests] progress', err);
      }
    }
    return touched;
  }

  function targetMatches(obj, target) {
    // A null objective target means "anything of this type counts" (serve/earn).
    if (obj.target == null) return true;
    if (target == null) return false;
    return String(obj.target) === String(target);
  }

  function advanceCursor(q, e) {
    const n = q.objectives.length;
    while (e.objIndex < n && (Number(e.counts[e.objIndex]) || 0) >= needOf(q.objectives[e.objIndex])) {
      e.objIndex++;
    }
    if (e.objIndex > n - 1) e.objIndex = n - 1;
  }

  // -------------------------------------------------------------- completion
  function checkCompletion(id) {
    const s = store();
    const e = s.active[id];
    const q = QUEST_INDEX[id];
    if (!e || e.ready || !validQuest(q)) return false;
    if (!allObjectivesDone(q, e)) return false;

    if (q.turnIn) {
      e.ready = true;
      const who = npc(q.turnIn);
      bus.emit(EV.TOAST, {
        text: `${q.title} — report to ${who ? who.name : q.turnIn}`,
        icon: '❗', tone: 'good',
      });
      return true;
    }
    finish(id);
    return true;
  }

  /** Player handed the quest in (or it had no turn-in NPC). */
  function turnIn(questId) {
    const s = store();
    const e = s.active[questId];
    const q = QUEST_INDEX[questId];
    if (!e || !validQuest(q)) return false;
    if (!e.ready && !allObjectivesDone(q, e)) return false;
    finish(questId);
    return true;
  }

  function finish(id) {
    const s = store();
    const q = QUEST_INDEX[id];
    if (!q) { delete s.active[id]; return false; }

    delete s.active[id];
    s.offered = s.offered.filter((x) => x !== id);
    if (!s.done.includes(id)) s.done.push(id);
    if (tracked === id) tracked = Object.keys(s.active)[0] || null;

    const granted = applyRewards(q);
    bus.emit(EV.QUEST_DONE, { quest: q, rewards: granted });
    bus.emit(EV.TOAST, { text: `Quest complete: ${q.title}`, icon: '🏅', tone: 'good' });

    // Requirements may have shifted (rep, flags, district, done-list).
    try { if (isFn(state.checkDistrictUnlocks)) state.checkDistrictUnlocks(); } catch (err) { console.error('[quests] unlock sweep', err); }
    refreshAvailability();

    // refreshAvailability() may already have surfaced the chained quest — do
    // not announce the same offer twice.
    if (q.next && QUEST_INDEX[q.next] && !s.offered.includes(q.next)) {
      try { offer(q.next); } catch (err) { console.error('[quests] chain', err); }
    }
    return true;
  }

  function applyRewards(q) {
    const r = (q && q.rewards) || {};
    const granted = {};
    const step = (label, fn) => {
      try { fn(); } catch (err) { console.error(`[quests] reward "${label}" failed for ${q.id}`, err); }
    };

    if (Number(r.coins)) step('coins', () => { state.addCoins(Number(r.coins), 'quest'); granted.coins = Number(r.coins); });
    if (Number(r.xp)) step('xp', () => { state.addXp(Number(r.xp)); granted.xp = Number(r.xp); });
    if (Number(r.reputation)) step('reputation', () => { state.addReputation(Number(r.reputation)); granted.reputation = Number(r.reputation); });
    if (r.recipe) step('recipe', () => { state.unlockRecipe(String(r.recipe)); granted.recipe = String(r.recipe); });
    if (Array.isArray(r.items)) {
      step('items', () => {
        granted.items = [];
        for (const it of r.items) {
          if (!it || !it.id) continue;
          const qty = Math.max(1, Math.floor(Number(it.qty) || 1));
          state.addItem(String(it.id), qty, { quality: 0.8, freshness: 1 });
          granted.items.push({ id: String(it.id), qty });
        }
      });
    }
    if (r.relationship && r.relationship.npc) {
      step('relationship', () => {
        const amt = Number(r.relationship.amount) || 0;
        state.addRelationship(String(r.relationship.npc), amt);
        granted.relationship = { npc: String(r.relationship.npc), amount: amt };
      });
    }
    if (r.unlockDistrict) step('unlockDistrict', () => { state.unlockDistrict(String(r.unlockDistrict)); granted.unlockDistrict = String(r.unlockDistrict); });
    if (r.flag) step('flag', () => { state.setFlag(String(r.flag), true); granted.flag = String(r.flag); });
    return granted;
  }

  // -------------------------------------------------------------------- read
  function activeList() {
    const s = store();
    const out = [];
    for (const id of Object.keys(s.active)) {
      const q = QUEST_INDEX[id];
      if (!validQuest(q)) continue;
      const e = s.active[id];
      out.push({
        id, quest: q,
        objIndex: e.objIndex | 0,
        counts: e.counts.slice(),
        ready: !!e.ready,
        objective: q.objectives[Math.min(e.objIndex | 0, q.objectives.length - 1)] || null,
      });
    }
    return out;
  }

  function setTracked(questId) {
    // NOTE: deliberately NOT persisted — `state.data.quests` keeps exactly the
    // three documented keys, so tracking is re-derived after a load.
    if (questId == null) { tracked = null; return null; }
    if (!store().active[questId]) return tracked;
    tracked = questId;
    return tracked;
  }

  function trackedEntry() {
    if (!tracked) return null;
    return activeList().find((e) => e.id === tracked) || null;
  }

  // -------------------------------------------------------------- bus wiring
  const on = (evt, cb) => {
    if (!bus) return;
    offs.push(bus.on(evt, (p) => {
      try { cb(p || {}); } catch (err) { console.error(`[quests] handler for ${evt}`, err); }
    }));
  };

  on(EV.ORDER_SERVED, () => progress('serve', null, 1));

  on(EV.COOK_DONE, (p) => { if (p.recipeId) progress('cook', p.recipeId, 1); });

  on(EV.ITEM_GAINED, (p) => { if (p.id) progress('collect', p.id, Math.max(1, Number(p.qty) || 1)); });

  on(EV.FISH_CAUGHT, (p) => {
    if (!p.id) return;
    progress('fish', p.id, 1);
    // A caught fish is also collected — collect objectives accept any source.
    progress('collect', p.id, 1);
  });

  on(EV.DELIVERY_DONE, (p) => { if (p.missionId) progress('deliver', p.missionId, 1); });

  on(EV.COINS, (p) => {
    const d = Number(p.delta) || 0;
    // Quest payouts must not feed another quest's "earn N coins" step.
    if (d > 0 && p.reason !== 'quest') progress('earn', null, d);
  });

  on(EV.REPUTATION, (p) => progress('reputation', null, Number(p.reputation) || 0));

  // state.setShopTier() emits with id 'tier', setUpgradeLevel() with the
  // upgrade id — so one line covers both "upgrade the chiller" and "reach
  // tier 3" objectives.
  on(EV.SHOP_UPGRADED, (p) => { if (p.id) progress('upgrade', p.id, 1); });

  on(EV.DISTRICT_ENTER, (p) => { if (p.id) progress('visit', p.id, 1); });

  on(EV.INTERACT, (p) => {
    const kind = p.kind;
    const data = p.target || {};
    if (kind === 'npc') {
      const id = data.npcId || data.id || p.id;
      if (!id) return;
      progress('talk', id, 1);
      // Walking up to the recipient IS the hand-over for delivery steps.
      progress('deliver', id, 1);
      return;
    }
    if (kind === 'purchase') {
      const id = data.itemId || data.id || data.ingredient;
      if (!id) return;
      progress('purchase', id, Math.max(1, Number(data.qty) || 1));
      return;
    }
    if (kind === 'minigame' || kind === 'compete') {
      const id = data.gameId || data.id || p.id;
      if (id) progress(kind, id, 1);
      return;
    }
    if (kind === 'supplier' || kind === 'shop' || kind === 'poi' || kind === 'door') {
      const id = data.supplierId || data.poi || data.id || p.id;
      if (id) progress('visit', id, 1);
    }
  });

  on(EV.LOAD, () => { rehydrate(); refreshAvailability(); });
  on(EV.DAY_START, () => refreshAvailability());

  // -------------------------------------------------------------------- loop
  function update(dt) {
    const d = Number(dt) || 0;
    sinceRefresh += d;
    if (sinceRefresh < REFRESH_EVERY) return;
    sinceRefresh = 0;
    try {
      refreshAvailability();
      // Catch anything that became complete without a matching event (a
      // reputation threshold met while the quest was inactive, say).
      for (const id of Object.keys(store().active)) checkCompletion(id);
    } catch (err) {
      console.error('[quests] update', err);
    }
  }

  function dispose() {
    while (offs.length) { const off = offs.pop(); try { off(); } catch { /* ignore */ } }
  }

  // Boot from whatever is already in state (new game or a pre-loaded save).
  rehydrate();
  refreshAvailability();

  return {
    update, dispose,
    offer, start, abandon, progress, turnIn,
    get active() { return activeList(); },
    get tracked() { return tracked; },
    get trackedEntry() { return trackedEntry(); },
    setTracked,
    availableFrom, readyFor, markerFor,
    isObjectiveDone, refreshAvailability,
    // Small read helpers the journal / HUD want and would otherwise re-derive.
    entryOf, isActive, isDone,
    quest: (id) => QUEST_INDEX[id] || null,
    objectiveText: (obj) => objectiveText(obj, resolveName),
    resolveName,
    get done() { return store().done.slice(); },
    get offered() { return store().offered.slice(); },
  };
}

export default createQuests;
