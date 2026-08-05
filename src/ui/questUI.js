// The journal.
//
// Four tabs, one card shape. Cards read from the quest table for their static
// content and from state.data.quests for progress, so the panel works even
// before the quest runner exists.

import { EV } from '../game/bus.js';
import { injectStyles, el, panel, button, bar, money, THEME } from './kit.js';
import { QUESTS, QUEST_INDEX, objectiveText, questAvailable } from '../data/quests.js';
import { districtById } from '../data/districts.js';
import { npc as npcById } from '../data/npcs.js';
import { RECIPES } from '../data/recipes.js';
import { ingredientName, ingredient } from '../data/ingredients.js';

const STYLE_ID = 'sp-quest-style';

const CSS = `
.spq-body{ flex:1; min-height:0; display:flex; flex-direction:column; gap:9px; }
.spq-tabs{ display:flex; gap:6px; flex-wrap:wrap; }
.spq-tab{
  font-family:inherit; font-weight:800; font-size:12px; cursor:pointer;
  border:1.5px solid rgba(59,47,38,.14); border-radius:999px;
  background:rgba(255,255,255,.6); color:var(--sp-ink); padding:5px 12px;
}
.spq-tab:hover{ border-color:var(--sp-red); }
.spq-tab.spq-on{ background:var(--sp-red); color:#fff8ef; border-color:rgba(0,0,0,.12); }
.spq-tab:focus-visible{ outline:2px solid var(--sp-red); outline-offset:2px; }

.spq-scroll{ flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; gap:9px; padding-right:4px; }
.spq-scroll::-webkit-scrollbar{ width:8px; }
.spq-scroll::-webkit-scrollbar-thumb{ background:rgba(59,47,38,.2); border-radius:8px; }

.spq-card{
  background:rgba(255,255,255,.6); border:1.5px solid rgba(59,47,38,.1);
  border-left:4px solid rgba(59,47,38,.16); border-radius:14px; padding:10px 12px;
  display:flex; flex-direction:column; gap:7px;
}
.spq-card.spq-active{ border-left-color:var(--sp-red); background:rgba(255,255,255,.82); }
.spq-card.spq-tracked{ box-shadow:0 0 0 2px rgba(200,80,63,.25); }
.spq-card.spq-done{ opacity:.66; border-left-color:var(--sp-green); }
.spq-card.spq-locked{ opacity:.55; }

.spq-top{ display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; }
.spq-title{ font-size:14px; font-weight:900; }
.spq-who{ font-size:11px; font-weight:700; color:var(--sp-ink-soft); }
.spq-desc{ font-size:11.5px; font-weight:700; color:var(--sp-ink-soft); line-height:1.45; font-style:italic; }
.spq-objs{ display:flex; flex-direction:column; gap:3px; }
.spq-obj{ display:flex; align-items:flex-start; gap:7px; font-size:12px; font-weight:700; line-height:1.35; }
.spq-box{ flex:0 0 15px; width:15px; height:15px; margin-top:1px; border-radius:5px;
  border:1.5px solid rgba(59,47,38,.28); background:rgba(255,255,255,.7);
  display:flex; align-items:center; justify-content:center; font-size:10px; color:#fff; }
.spq-obj.spq-ok .spq-box{ background:var(--sp-green); border-color:var(--sp-green); }
.spq-obj.spq-ok{ color:var(--sp-ink-soft); text-decoration:line-through; }
.spq-obj.spq-cur{ color:var(--sp-ink); }
.spq-obj .spq-cnt{ margin-left:auto; font-variant-numeric:tabular-nums; color:var(--sp-ink-soft); font-size:11px; }
.spq-hint{ font-size:11px; font-weight:700; color:var(--sp-ink-soft); padding-left:22px; }

.spq-rew{ display:flex; flex-wrap:wrap; gap:5px; align-items:center; }
.spq-foot{ display:flex; align-items:center; gap:8px; }
.spq-foot .sp-bar{ flex:1; }
.spq-empty{ padding:30px 12px; text-align:center; color:var(--sp-ink-soft); font-size:12.5px; }
`;

function styleOnce() {
  injectStyles();
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function resolveName(id) {
  if (id == null) return '';
  const d = districtById(id);
  if (d) return d.name;
  const n = npcById(id);
  if (n) return n.name;
  const rec = RECIPES.find((r) => r.id === id);
  if (rec) return rec.name;
  const ing = ingredientName(id);
  if (ing && ing !== id) return ing;
  return String(id).replace(/_/g, ' ');
}

function objCounts(entry) {
  if (!entry) return [];
  if (Array.isArray(entry.progress)) return entry.progress;
  if (Array.isArray(entry.counts)) return entry.counts;
  if (Array.isArray(entry.objectives)) {
    return entry.objectives.map((o) => (typeof o === 'number' ? o : (o && (o.progress ?? o.count)) || 0));
  }
  return [];
}

const TABS = [
  { key: 'main', label: '📜 Main' },
  { key: 'business', label: '🏪 Business' },
  { key: 'side', label: '🌿 Side' },
  { key: 'done', label: '✔ Completed' },
];

export function createQuestUI(game) {
  styleOnce();

  const id = 'quests';
  const state = game.state;
  const offs = [];

  const p = panel({
    id: 'sp-panel-quests',
    title: 'Journal',
    sub: '',
    pos: {
      left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
      width: 'min(760px, 94vw)', height: 'min(590px, 88vh)',
    },
    onClose: () => game.panels.close(id),
  });
  p.root.setAttribute('role', 'dialog');
  p.root.setAttribute('aria-label', 'Quest journal');

  const body = el('div', 'spq-body');
  const tabs = el('div', 'spq-tabs');
  tabs.setAttribute('role', 'tablist');
  const scroll = el('div', 'spq-scroll');
  body.append(tabs, scroll);
  p.body.append(body);

  let open = false;
  let tab = 'main';

  const tabBtns = [];
  for (const t of TABS) {
    const b = el('button', 'spq-tab', t.label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => { tab = t.key; render(); });
    tabBtns.push({ key: t.key, b });
    tabs.append(b);
  }

  function trackedId() {
    const q = game.quests;
    if (!q) return null;
    const t = q.tracked;
    if (typeof t === 'string') return t;
    if (t && t.id) return t.id;
    return null;
  }

  function activeEntry(qid) {
    const qs = state.data && state.data.quests;
    return (qs && qs.active && qs.active[qid]) || null;
  }

  // ---------------------------------------------------------------- card
  function card(q, { done = false } = {}) {
    const entry = activeEntry(q.id);
    const isActive = !!entry;
    const counts = objCounts(entry);
    const objs = q.objectives || [];

    const c = el('div', 'spq-card');
    if (done) c.classList.add('spq-done');
    else if (isActive) c.classList.add('spq-active');
    else if (!questAvailable(q, state)) c.classList.add('spq-locked');
    if (!done && trackedId() === q.id) c.classList.add('spq-tracked');

    const giver = npcById(q.giver);
    const dist = districtById(q.district);

    const top = el('div', 'spq-top');
    top.append(el('span', 'spq-title', q.title));
    top.append(el('span', 'spq-who',
      `${giver ? giver.name : q.giver}${dist ? ` · ${dist.icon} ${dist.name}` : ''}`));
    c.append(top);

    c.append(el('div', 'spq-desc', `“${q.desc}”`));

    // Objectives
    const list = el('div', 'spq-objs');
    const rows = [];
    let doneUnits = 0, totalUnits = 0, currentIdx = -1;
    objs.forEach((o, i) => {
      const need = o.count == null ? 1 : o.count;
      const got = done ? need : Math.min(need, Number(counts[i]) || 0);
      totalUnits += need; doneUnits += got;
      const ok = got >= need;
      if (!ok && currentIdx < 0) currentIdx = i;

      const row = el('div', `spq-obj ${ok ? 'spq-ok' : ''}`.trim());
      const box = el('span', 'spq-box', ok ? '✔' : '');
      row.append(box, el('span', null, objectiveText(o, resolveName)));
      if (need > 1) row.append(el('span', 'spq-cnt', `${got}/${need}`));
      rows[i] = row;
      list.append(row);

      if (!ok && i === currentIdx && isActive && o.hint) {
        list.append(el('div', 'spq-hint', `↳ ${o.hint}`));
      }
    });
    if (currentIdx >= 0 && rows[currentIdx]) rows[currentIdx].classList.add('spq-cur');
    c.append(list);

    // Rewards
    const rew = el('div', 'spq-rew');
    const r = q.rewards || {};
    if (r.coins) rew.append(el('span', 'sp-badge', `💰 ${money(r.coins)}`));
    if (r.reputation) rew.append(el('span', 'sp-badge', `⭐ +${r.reputation}`));
    if (r.xp) rew.append(el('span', 'sp-badge', `🍣 ${r.xp} xp`));
    if (r.recipe) {
      const rec = RECIPES.find((x) => x.id === r.recipe);
      rew.append(el('span', 'sp-badge', `📖 ${rec ? rec.name : r.recipe}`));
    }
    for (const it of r.items || []) {
      const ing = ingredient(it.id);
      rew.append(el('span', 'sp-badge', `${(ing && ing.icon) || '📦'} ×${it.qty}`));
    }
    if (r.relationship) {
      const n = npcById(r.relationship.npc);
      rew.append(el('span', 'sp-badge', `💛 ${n ? n.name : r.relationship.npc}`));
    }
    if (r.unlockDistrict) {
      const d = districtById(r.unlockDistrict);
      rew.append(el('span', 'sp-badge', `🗺️ ${d ? d.name : r.unlockDistrict}`));
    }
    if (rew.children.length) c.append(rew);

    // Footer
    const foot = el('div', 'spq-foot');
    const b = bar(totalUnits ? doneUnits / totalUnits : 0, done ? THEME.green : THEME.red);
    foot.append(b);
    if (!done && isActive) {
      const tracked = trackedId() === q.id;
      const btn = button(tracked ? 'Tracking' : 'Track', {
        cls: tracked ? 'sp-ghost' : '',
        icon: tracked ? '📍' : '',
        onClick: () => {
          const qs = game.quests;
          if (qs && typeof qs.setTracked === 'function') {
            try { qs.setTracked(q.id); } catch (err) { console.error('[questUI] setTracked threw', err); }
          }
          render();
        },
      });
      btn.disabled = tracked;
      foot.append(btn);
    } else if (done) {
      foot.append(el('span', 'spq-who', 'Completed'));
    }
    c.append(foot);
    return c;
  }

  // -------------------------------------------------------------- render
  function render() {
    for (const t of tabBtns) {
      t.b.classList.toggle('spq-on', t.key === tab);
      t.b.setAttribute('aria-selected', t.key === tab ? 'true' : 'false');
    }
    scroll.textContent = '';

    const qs = state.data && state.data.quests;
    const doneIds = (qs && qs.done) || [];

    if (tab === 'done') {
      const list = doneIds.map((qid) => QUEST_INDEX[qid]).filter(Boolean);
      if (!list.length) scroll.append(el('div', 'spq-empty', 'Nothing finished yet. Everything starts somewhere.'));
      for (const q of list) scroll.append(card(q, { done: true }));
    } else {
      const list = QUESTS.filter((q) => {
        if (q.kind !== tab) return false;
        if (doneIds.includes(q.id)) return false;
        const active = !!(qs && qs.active && qs.active[q.id]);
        return active || questAvailable(q, state);
      });
      // Active first, then offerable.
      list.sort((a, b) => {
        const aa = qs && qs.active && qs.active[a.id] ? 0 : 1;
        const bb = qs && qs.active && qs.active[b.id] ? 0 : 1;
        return aa - bb;
      });
      if (!list.length) scroll.append(el('div', 'spq-empty', 'Nothing on this page yet. Talk to the cats around town.'));
      for (const q of list) scroll.append(card(q));
    }

    const activeCount = qs && qs.active ? Object.keys(qs.active).length : 0;
    p.setTitle('Journal', `${activeCount} active · ${doneIds.length} done`);
  }

  const refresh = () => { if (open) render(); };
  offs.push(game.bus.on(EV.QUEST_STARTED, refresh));
  offs.push(game.bus.on(EV.QUEST_PROGRESS, refresh));
  offs.push(game.bus.on(EV.QUEST_DONE, refresh));
  offs.push(game.bus.on(EV.QUEST_OFFERED, refresh));

  // ----------------------------------------------------------------- api
  const api = {
    id,
    open(payload) {
      if (payload && payload.tab && TABS.some((t) => t.key === payload.tab)) tab = payload.tab;
      if (open) { render(); return; }
      open = true;
      render();
      p.show();
    },
    close() {
      if (!open) return;
      open = false;
      p.hide();
    },
    get isOpen() { return open; },
    destroy() {
      for (const un of offs) { try { un(); } catch { /* ignore */ } }
      offs.length = 0;
      p.destroy();
    },
  };

  game.panels.register(id, api);
  return api;
}
