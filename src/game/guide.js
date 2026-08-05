// The guidance brain.
//
// One job: at any instant, know the single most important thing the player
// should do next, and say it in one small object:
//
//   { id, title, hint, target: {x,z}|null, npcId, poiId, kind, distance }
//
// Nothing else in the game asks "what now?" — the banner, the ground arrows,
// the destination pin and the compass all read this. The guide also owns
// `world.setWaypoint()` while it has an objective, so the compass and the map
// can never disagree with the banner.
//
// Priority, highest first:
//   1. an active tutorial step
//   2. the tracked quest's current incomplete objective
//   3. a delivery package in the player's paws
//   4. the shop is open and somebody is waiting
//   5. it is past closing time — go home and sleep
//   6. the nearest sensible way to earn money (so the player can never be stuck)
//
// Robustness policy, same as the quest runner: this file must never throw into
// the frame loop or a bus dispatch. Anything that cannot be resolved falls
// through to the next priority level and complains exactly once.

import { EV } from './bus.js';
import { HOME, districtById } from '../data/districts.js';
import { SUPPLIERS, priceFor, isOpenAt } from '../data/suppliers.js';
import { npc as npcById, npcPositionAt } from '../data/npcs.js';
import { ingredientName } from '../data/ingredients.js';
import { RECIPES, recipe as recipeById, knownRecipes, cookableRecipes } from '../data/recipes.js';
import { PROGRESSION } from '../data/progression.js';

/** How often update() is allowed to recompute (NPCs walk their schedules). */
const RECOMPUTE_EVERY = 0.5;

/** Colour/tone families the UI keys off. Kept here so both halves agree. */
export const GUIDE_KINDS = [
  'tutorial', 'talk', 'turnin', 'visit', 'purchase', 'collect',
  'cook', 'serve', 'fish', 'deliver', 'shop', 'sleep', 'earn',
];

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const dist2d = (a, b) => Math.hypot(num(a.x) - num(b.x), num(a.z) - num(b.z));

/** A world point, or null if the thing it came from was nonsense. */
function pt(x, z) {
  const px = Number(x), pz = Number(z);
  if (!Number.isFinite(px) || !Number.isFinite(pz)) return null;
  return { x: px, z: pz };
}

export function createGuide(game) {
  const bus = game && game.bus;
  const state = game && game.state;
  if (!bus || !state) console.error('[guide] createGuide needs game.bus and game.state');

  const offs = [];
  const listeners = new Set();
  const complained = new Set();

  let current = null;
  let enabled = true;
  let since = RECOMPUTE_EVERY;      // force a compute on the first update()
  let ownsWaypoint = false;
  let disposed = false;

  function complain(key, why) {
    if (!key || complained.has(key)) return;
    complained.add(key);
    console.warn(`[guide] ${key}: ${why} — falling back to the next priority.`);
  }

  // ------------------------------------------------------------- tiny reads
  function hour() {
    try {
      if (game.clock && typeof game.clock.hour === 'number') return game.clock.hour;
    } catch { /* ignore */ }
    return num(state && state.clock && state.clock.hour, 8);
  }

  function playerPos() {
    const p = game.player && game.player.position;
    return p ? { x: num(p.x), z: num(p.z) } : { x: HOME.spawn.x, z: HOME.spawn.z };
  }

  function nameOf(id) {
    if (id == null) return '';
    const n = npcById(id); if (n) return n.name;
    const r = recipeById(id); if (r) return r.name;
    const d = districtById(id); if (d) return d.name;
    const i = ingredientName(id); if (i) return i;
    return String(id).replace(/_/g, ' ');
  }

  // ------------------------------------------------------- world resolvers
  /** Where an NPC is standing right now (live runtime first, schedule after). */
  function npcPoint(id) {
    if (!id) return null;
    try {
      if (game.npcs && typeof game.npcs.positionOf === 'function') {
        const p = game.npcs.positionOf(id);
        if (p) return pt(p.x, p.z);
      }
    } catch { /* fall through to the authored schedule */ }
    const rec = npcById(id);
    if (!rec) return null;
    const p = npcPositionAt(rec, hour()) || rec.home;
    return p ? pt(p.x, p.z) : null;
  }

  function poiPoint(id) {
    if (!id) return null;
    try {
      const p = game.world && typeof game.world.poi === 'function' ? game.world.poi(id) : null;
      if (p) return pt(p.x, p.z);
    } catch { /* ignore */ }
    return null;
  }

  /** A district: its gate if it has one, otherwise its centre. */
  function districtPoint(id) {
    const gate = poiPoint(`gate_${id}`);
    if (gate) return gate;
    const d = districtById(id);
    return d && d.center ? pt(d.center.x, d.center.z) : null;
  }

  /** The exact spot the shop's E-prompts live at, so "the counter" is walkable. */
  function interactionPoint(id) {
    try {
      const it = game.interactions && typeof game.interactions.get === 'function'
        ? game.interactions.get(id) : null;
      if (it) return pt(it.x, it.z);
    } catch { /* ignore */ }
    return null;
  }

  function counterPoint() {
    return interactionPoint('shop_counter')
      || (() => {
        const a = game.restaurant && game.restaurant.anchors;
        return a && a.counter ? pt(a.counter.x, a.counter.z) : null;
      })()
      || (() => {
        const a = game.world && game.world.shopAnchors;
        return a && a.counterAnchor ? pt(a.counterAnchor.x, a.counterAnchor.z) : null;
      })()
      || poiPoint('home_shop')
      || pt(HOME.shop.x, HOME.shop.z);
  }

  function signPoint() { return interactionPoint('shop_sign') || counterPoint(); }

  function bedPoint() { return poiPoint('home_bed') || pt(HOME.bed.x, HOME.bed.z); }

  function boardPoint() { return poiPoint('delivery_board') || pt(HOME.board.x, HOME.board.z); }

  /** Cheapest supplier that will actually sell `itemId` today. */
  function supplierFor(itemId) {
    if (!itemId) return null;
    const rel = (id) => {
      try { return (state && typeof state.relationship === 'function') ? state.relationship(id) : 0; }
      catch { return 0; }
    };
    let best = null;
    for (const s of SUPPLIERS) {
      let price = null;
      try { price = priceFor(s, itemId, rel(s.npc)); } catch { price = null; }
      if (price == null) continue;
      let unlocked = true;
      try { unlocked = !state.districtUnlocked || state.districtUnlocked(s.district); } catch { unlocked = true; }
      let open = true;
      try { open = isOpenAt(s, hour()); } catch { open = true; }
      // Nothing physically stops the cat walking into a "locked" district, so a
      // shut stall or an unfamiliar quarter is still a valid answer — it just
      // loses every tie against somewhere near and open.
      const score = price + (open ? 0 : 1000) + (unlocked ? 0 : 5000);
      if (!best || score < best.score) best = { supplier: s, price, open, score };
    }
    return best;
  }

  /** The nearest forage bed growing `itemId` (ready ones win). */
  function forageFor(itemId) {
    const f = game.foraging;
    if (!f || !itemId) return null;
    let list = [];
    try { list = f.nodes || []; } catch { list = []; }
    let ready = [];
    try { ready = f.ready || []; } catch { ready = []; }
    const readyIds = new Set(ready.map((n) => n && n.id));
    const p = playerPos();
    let best = null;
    for (const n of list) {
      if (!n || n.ingredientId !== itemId) continue;
      const at = pt(n.x, n.z);
      if (!at) continue;
      const score = dist2d(p, at) + (readyIds.has(n.id) ? 0 : 400);
      if (!best || score < best.score) best = { node: n, at, score };
    }
    return best;
  }

  function nearestFishingSpot() {
    const p = playerPos();
    let best = null;
    let list = [];
    try { list = (game.fishing && game.fishing.spots) || []; } catch { list = []; }
    if (!list.length && game.world && Array.isArray(game.world.pois)) {
      list = game.world.pois.filter((o) => o && o.kind === 'fishing');
    }
    for (const s of list) {
      const at = pt(s.x, s.z);
      if (!at) continue;
      let ok = true;
      try { ok = !state.districtUnlocked || !s.district || state.districtUnlocked(s.district); } catch { ok = true; }
      const d = dist2d(p, at) + (ok ? 0 : 200);
      if (!best || d < best.d) best = { spot: s, at, d };
    }
    return best;
  }

  /**
   * Resolve a declarative target spec. Shared with the tutorial so its steps
   * can be pure data.
   *   { kind:'npc', id } | { kind:'poi', id } | { kind:'district', id }
   *   { kind:'counter' } | { kind:'sign' } | { kind:'bed' } | { kind:'board' }
   *   { kind:'supplier', id } | { kind:'item', id } | { kind:'fishing' }
   *   { kind:'point', x, z } | { kind:'none' }
   */
  function resolve(spec) {
    if (!spec) return null;
    try {
      if (typeof spec === 'function') return resolve(spec(game));
      if (spec.kind === 'none') return null;
      switch (spec.kind) {
        case 'npc': return npcPoint(spec.id);
        case 'poi': return poiPoint(spec.id);
        case 'district': return districtPoint(spec.id);
        case 'counter': return counterPoint();
        case 'sign': return signPoint();
        case 'bed': return bedPoint();
        case 'board': return boardPoint();
        case 'fishing': { const f = nearestFishingSpot(); return f ? f.at : null; }
        case 'supplier': {
          const at = poiPoint(spec.id);
          if (at) return at;
          const s = SUPPLIERS.find((x) => x.id === spec.id);
          return s ? pt(s.x, s.z) : null;
        }
        case 'item': {
          const sup = supplierFor(spec.id);
          if (sup) return poiPoint(sup.supplier.id) || pt(sup.supplier.x, sup.supplier.z);
          const fo = forageFor(spec.id);
          return fo ? fo.at : null;
        }
        case 'point': return pt(spec.x, spec.z);
        default: return pt(spec.x, spec.z);
      }
    } catch (err) {
      console.warn('[guide] could not resolve a target spec', spec, err);
      return null;
    }
  }

  // ------------------------------------------------------------ priority 1
  function fromTutorial() {
    const t = game.tutorial;
    if (!t) return null;
    let step = null;
    try {
      if (!t.active) return null;
      step = typeof t.guideStep === 'function' ? t.guideStep() : null;
    } catch (err) {
      complain('tutorial', 'threw while asked for its current step');
      return null;
    }
    if (!step) return null;
    let target = null;
    try { target = step.target ? resolve(step.target) : null; } catch { target = null; }
    return {
      id: `tutorial:${step.id}`,
      title: step.title || 'Next step',
      hint: step.hint || '',
      target,
      npcId: step.target && step.target.kind === 'npc' ? step.target.id : null,
      poiId: step.target && (step.target.kind === 'poi' || step.target.kind === 'supplier') ? step.target.id : null,
      kind: 'tutorial',
      // A tutorial step with no target of its own still deserves an arrow: it
      // borrows whatever the next priority level would have pointed at.
      borrowTarget: !target,
    };
  }

  // ------------------------------------------------------------ priority 2
  function trackedQuest() {
    const q = game.quests;
    if (!q) return null;
    try {
      let entry = q.trackedEntry;
      if (!entry) {
        const active = q.active || [];
        entry = active[0] || null;
        if (entry && typeof q.setTracked === 'function') q.setTracked(entry.id);
      }
      return entry;
    } catch (err) {
      complain('quests', 'threw while being read');
      return null;
    }
  }

  function fromQuest() {
    const entry = trackedQuest();
    if (!entry || !entry.quest) return null;
    const quest = entry.quest;

    // Everything ticked — the only thing left is to go and say so.
    if (entry.ready && quest.turnIn) {
      const at = npcPoint(quest.turnIn);
      if (!at) { complain(`${quest.id}:turnin`, `cannot find ${quest.turnIn}`); return null; }
      return {
        id: `quest:${quest.id}:turnin`,
        title: `Report to ${nameOf(quest.turnIn)}`,
        hint: `${quest.title} is ready.`,
        target: at, npcId: quest.turnIn, poiId: null, kind: 'turnin',
      };
    }

    const objs = Array.isArray(quest.objectives) ? quest.objectives : [];
    let idx = -1;
    for (let i = 0; i < objs.length; i++) {
      let done = false;
      try { done = game.quests.isObjectiveDone(entry, i); } catch { done = false; }
      if (!done) { idx = i; break; }
    }
    if (idx < 0) return null;
    const obj = objs[idx];
    if (!obj) return null;

    const key = `${quest.id}#${idx}`;
    let title = '';
    try { title = game.quests.objectiveText(obj) || ''; } catch { title = ''; }
    if (!title) title = quest.title;

    const need = obj.count == null ? 1 : Number(obj.count) || 1;
    const got = Math.min(need, num(Number((entry.counts || [])[idx]), 0));
    if (need > 1) title = `${title}  (${got}/${need})`;

    const hint = obj.hint || quest.title;
    const out = (target, kind, extra = {}) => {
      if (!target) { complain(key, `no world position for a "${obj.type}" objective`); return null; }
      return { id: `quest:${key}`, title, hint, target, npcId: null, poiId: null, kind, ...extra };
    };

    switch (obj.type) {
      case 'talk':
      case 'deliver':
        return out(npcPoint(obj.target), obj.type === 'talk' ? 'talk' : 'deliver', { npcId: obj.target });

      case 'visit': {
        const at = poiPoint(obj.target) || districtPoint(obj.target)
          || (obj.where ? pt(obj.where.x, obj.where.z) : null);
        return out(at, 'visit', { poiId: obj.target });
      }

      case 'purchase': {
        const sup = supplierFor(obj.target);
        if (sup) {
          const at = poiPoint(sup.supplier.id) || pt(sup.supplier.x, sup.supplier.z);
          return out(at, 'purchase', {
            poiId: sup.supplier.id,
            hint: sup.open
              ? `${sup.supplier.name} — ${sup.price}¢ each.`
              : `${sup.supplier.name}: opens ${String(sup.supplier.openHour).padStart(2, '0')}:00.`,
          });
        }
        return out(null, 'purchase');
      }

      case 'collect': {
        const fo = forageFor(obj.target);
        if (fo) return out(fo.at, 'collect', { poiId: fo.node.id, hint: `${fo.node.name || nameOf(obj.target)} — press E to pick.` });
        const sup = supplierFor(obj.target);
        if (sup) {
          const at = poiPoint(sup.supplier.id) || pt(sup.supplier.x, sup.supplier.z);
          return out(at, 'collect', { poiId: sup.supplier.id, hint: `${sup.supplier.name} sells it for ${sup.price}¢.` });
        }
        return out(null, 'collect');
      }

      case 'fish': {
        const f = nearestFishingSpot();
        return out(f ? f.at : null, 'fish', { poiId: f ? f.spot.id : null });
      }

      case 'cook':
      case 'serve':
        return out(counterPoint(), obj.type === 'cook' ? 'cook' : 'serve', { poiId: 'home_shop' });

      case 'upgrade':
      case 'reputation':
      case 'earn':
        return out(counterPoint(), 'shop', { poiId: 'home_shop' });

      default: {
        // Unknown objective types still get an arrow if the author left a hint
        // position behind; otherwise the next priority level takes over.
        const at = obj.where ? pt(obj.where.x, obj.where.z) : counterPoint();
        return out(at, 'visit');
      }
    }
  }

  // ------------------------------------------------------------ priority 3
  function fromDelivery() {
    const d = game.delivery;
    if (!d) return null;
    let carrying = null;
    try { carrying = d.carrying; } catch { carrying = null; }
    if (!carrying || !carrying.missionId) return null;
    let m = null;
    try { m = typeof d.get === 'function' ? d.get(carrying.missionId) : null; } catch { m = null; }
    if (!m) return null;
    const at = npcPoint(m.toNpc) || pt(m.x, m.z);
    if (!at) { complain(`delivery:${m.id}`, 'has no destination'); return null; }
    return {
      id: `delivery:${m.id}`,
      title: `Deliver to ${nameOf(m.toNpc)}`,
      hint: m.route && m.route.hint ? String(m.route.hint) : 'Keep it fresh. Do not dawdle.',
      target: at, npcId: m.toNpc, poiId: null, kind: 'deliver',
    };
  }

  // ------------------------------------------------------------ priority 4
  function fromOrders() {
    const o = game.orders;
    if (!o) return null;
    let open = false, waiting = 0;
    try {
      open = !!o.isOpen;
      waiting = (o.queue || []).filter((x) => x && x.state === 'waiting').length;
    } catch { return null; }
    if (!open || waiting <= 0) return null;
    const at = counterPoint();
    if (!at) return null;
    return {
      id: 'orders:waiting',
      title: waiting === 1 ? 'Someone is waiting' : `${waiting} customers are waiting`,
      hint: 'Press E at the counter to take an order.',
      target: at, npcId: null, poiId: 'home_shop', kind: 'serve',
    };
  }

  // ------------------------------------------------------------ priority 5
  function fromClosingTime() {
    const shop = (state && state.shop) || {};
    const close = num(shop.closeHour, PROGRESSION.shopCloseHour);
    const open = num(shop.openHour, PROGRESSION.shopOpenHour);
    const h = hour();
    // "Past closing" is the small hours, not the early morning: once the shop
    // has shut, sleep — but 07:00 with the stalls about to open is a shopping
    // trip, not a bedtime, so anything from first light onward falls through.
    const DAWN = 5;
    const past = open < close
      ? (h >= close || h < Math.min(DAWN, open))
      : (h >= close && h < open);
    if (!past) return null;
    const at = bedPoint();
    if (!at) return null;
    return {
      id: 'night:sleep',
      title: 'Head home and sleep',
      hint: 'The city is shut. Sleep it off.',
      target: at, npcId: null, poiId: 'home_bed', kind: 'sleep',
    };
  }

  // ------------------------------------------------------------ priority 6
  /** The safety net: there is always a way to make the next coin. */
  function fromEarning() {
    // a) something in the basket is already a dish.
    let cookable = [];
    try { cookable = cookableRecipes(state) || []; } catch { cookable = []; }
    if (cookable.length) {
      const best = cookable.reduce((a, b) => (b.basePrice > a.basePrice ? b : a));
      const shopOpen = !!(state.shop && state.shop.isOpen);
      const at = shopOpen ? counterPoint() : signPoint();
      if (at) {
        return {
          id: `earn:cook:${best.id}`,
          title: shopOpen ? `Cook ${best.name}` : 'Open the shop',
          hint: shopOpen
            ? `${best.name} is ready to make — ${best.basePrice}¢ a plate.`
            : `Open up — you can make ${best.name}.`,
          target: at, npcId: null, poiId: 'home_shop', kind: shopOpen ? 'cook' : 'shop',
        };
      }
    }

    // b) buy the cheapest missing ingredient for the cheapest dish you know.
    let known = [];
    try { known = knownRecipes(state) || []; } catch { known = RECIPES.slice(); }
    let pick = null;
    for (const r of known) {
      let cost = 0;
      let missing = null;
      let ok = true;
      for (const need of r.ingredients || []) {
        let have = 0;
        try { have = state.countItem(need.id); } catch { have = 0; }
        const short = Math.max(0, (Number(need.qty) || 1) - have);
        if (!short) continue;
        const sup = supplierFor(need.id);
        if (!sup) { ok = false; break; }
        cost += sup.price * short;
        if (!missing) missing = { id: need.id, sup, short };
      }
      if (!ok || !missing) continue;
      let afford = false;
      try { afford = state.canAfford(cost); } catch { afford = false; }
      if (!afford) continue;
      if (!pick || cost < pick.cost) pick = { recipe: r, cost, missing };
    }
    if (pick) {
      const s = pick.missing.sup.supplier;
      const at = poiPoint(s.id) || pt(s.x, s.z);
      if (at) {
        return {
          id: `earn:buy:${pick.missing.id}`,
          title: `Buy ${ingredientName(pick.missing.id)}`,
          hint: `${s.name} — ${pick.cost}¢ for a ${pick.recipe.basePrice}¢ plate.`,
          target: at, npcId: null, poiId: s.id, kind: 'purchase',
        };
      }
    }

    // c) broke: free money. The delivery board first, water second.
    const board = boardPoint();
    if (board) {
      return {
        id: 'earn:board',
        title: 'Take a delivery job',
        hint: 'Paid work, no ingredients needed.',
        target: board, npcId: null, poiId: 'delivery_board', kind: 'earn',
      };
    }
    const f = nearestFishingSpot();
    if (f) {
      return {
        id: 'earn:fish',
        title: `Fish at ${f.spot.name || 'the water'}`,
        hint: 'Fish cost nothing but time, and sell.',
        target: f.at, npcId: null, poiId: f.spot.id, kind: 'fish',
      };
    }
    return null;
  }

  // --------------------------------------------------------------- compute
  const LEVELS = [fromQuest, fromDelivery, fromOrders, fromClosingTime, fromEarning];

  function computeRaw() {
    const tut = fromTutorial();
    if (tut && !tut.borrowTarget) { delete tut.borrowTarget; return tut; }

    let fallback = null;
    for (const level of LEVELS) {
      let r = null;
      try { r = level(); } catch (err) { console.warn('[guide] a priority level threw', err); r = null; }
      if (r && r.target) { fallback = r; break; }
    }

    if (tut) {
      // The tutorial still owns the words; it just borrows somebody's arrow.
      delete tut.borrowTarget;
      if (fallback) { tut.target = fallback.target; tut.npcId = fallback.npcId; tut.poiId = fallback.poiId; }
      return tut;
    }
    return fallback;
  }

  function compute() {
    if (!enabled || disposed) return null;
    let next = null;
    try { next = computeRaw(); } catch (err) {
      console.warn('[guide] compute failed', err);
      next = null;
    }
    if (!next) return null;
    const p = playerPos();
    next.distance = next.target ? dist2d(p, next.target) : Infinity;
    if (!next.kind) next.kind = 'visit';
    if (next.npcId === undefined) next.npcId = null;
    if (next.poiId === undefined) next.poiId = null;
    return next;
  }

  // ------------------------------------------------------------- waypoint
  function pushWaypoint(obj) {
    const w = game.world;
    if (!w || typeof w.setWaypoint !== 'function') return;
    try {
      if (obj && obj.target) {
        w.setWaypoint({ x: obj.target.x, z: obj.target.z, label: obj.title, id: obj.id });
        ownsWaypoint = true;
      } else if (ownsWaypoint) {
        w.setWaypoint(null);
        ownsWaypoint = false;
      }
    } catch (err) { console.warn('[guide] setWaypoint failed', err); }
  }

  function notify(obj, prev) {
    for (const cb of Array.from(listeners)) {
      try { cb(obj, prev); } catch (err) { console.error('[guide] listener threw', err); }
    }
  }

  /** Recompute now. Returns the (possibly unchanged) current objective. */
  function refresh() {
    if (disposed) return current;
    const next = compute();
    const prev = current;
    const prevId = prev ? prev.id : null;
    const nextId = next ? next.id : null;

    if (nextId !== prevId) {
      current = next;
      pushWaypoint(next);
      notify(next, prev);
      return current;
    }

    // Same objective — keep the live position and distance fresh (NPCs walk).
    if (next && prev) {
      const moved = next.target && prev.target ? dist2d(next.target, prev.target) : 0;
      current = next;
      if (moved > 0.75 || (!!next.target !== !!prev.target)) pushWaypoint(next);
    } else {
      current = next;
    }
    return current;
  }

  function update(dt) {
    if (disposed || !enabled) return;
    const d = Math.max(0, Math.min(0.25, Number(dt) || 0));
    // Distance is cheap and the banner reads it every frame.
    if (current && current.target) {
      current.distance = dist2d(playerPos(), current.target);
    }
    since += d;
    if (since < RECOMPUTE_EVERY) return;
    since = 0;
    refresh();
  }

  function setEnabled(v) {
    const on = !!v;
    if (on === enabled) return enabled;
    enabled = on;
    if (!enabled) {
      const prev = current;
      current = null;
      if (ownsWaypoint) pushWaypoint(null);
      if (prev) notify(null, prev);
    } else {
      since = RECOMPUTE_EVERY;
      refresh();
    }
    return enabled;
  }

  function on(cb) {
    if (typeof cb !== 'function') return () => {};
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  // ------------------------------------------------------------ bus wiring
  const sub = (evt) => {
    if (!bus) return;
    offs.push(bus.on(evt, () => { try { refresh(); } catch (err) { console.warn('[guide] refresh failed', err); } }));
  };
  for (const e of [
    EV.QUEST_PROGRESS, EV.QUEST_STARTED, EV.QUEST_DONE,
    EV.ORDER_NEW, EV.INVENTORY, EV.DAY_START, EV.PHASE, EV.DELIVERY_DONE,
  ]) sub(e);
  // Not in the required list, but a load swaps the whole world state under us.
  sub(EV.LOAD);

  function destroy() {
    if (disposed) return;
    disposed = true;
    while (offs.length) { const off = offs.pop(); try { off(); } catch { /* ignore */ } }
    listeners.clear();
    if (ownsWaypoint) {
      try { if (game.world && game.world.setWaypoint) game.world.setWaypoint(null); } catch { /* ignore */ }
      ownsWaypoint = false;
    }
    current = null;
  }

  return {
    get current() { return current; },
    get enabled() { return enabled; },
    update, refresh, setEnabled, on, destroy,
    // Shared with the tutorial so its steps stay pure data.
    resolve,
    nameOf,
  };
}

export default createGuide;
