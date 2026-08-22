// Always-on gameplay HUD.
//
// No panel chrome — a single fixed, pointer-events:none overlay whose children
// opt back into pointer events where they need to. Everything is driven from
// the bus (never polled) except the handful of per-frame things that genuinely
// change every frame: the coin count-up, the compass and the patience rings.
//
// The HUD owns no game logic. If a system it reads from is missing (world,
// quests, clock) it degrades to a blank slot rather than throwing.

import { EV } from '../game/bus.js';
import { injectStyles, el, bar, money, THEME } from './kit.js';
import { RECIPES } from '../data/recipes.js';
import { QUEST_INDEX, objectiveText } from '../data/quests.js';
import { districtById } from '../data/districts.js';
import { ingredientName } from '../data/ingredients.js';
import { npc as npcById } from '../data/npcs.js';
import { SHOP_TIERS } from '../data/progression.js';
import { UPGRADES, upgradeCost, upgradeUnlocked } from '../data/upgrades.js';

const STYLE_ID = 'sp-hud-style';

const CSS = `
.sph-root{
  position:fixed; inset:0; z-index:12; pointer-events:none;
  font-family:"Hiragino Maru Gothic ProN","Quicksand",ui-rounded,"Nunito",system-ui,sans-serif;
  font-weight:800; color:var(--sp-ink);
  opacity:1; transition:opacity .22s ease;
}
.sph-root.sph-off{ opacity:0; }
.sph-root.sph-off *{ pointer-events:none !important; }

.sph-card{
  background:linear-gradient(180deg,rgba(255,246,248,.95),rgba(248,212,224,.95));
  border:2px solid rgba(59,47,38,.16); border-radius:14px;
  box-shadow:0 6px 16px var(--sp-shadow), inset 0 1px 0 rgba(255,255,255,.6);
  padding:8px 10px;
}

/* Layout anchors. --sp-hud-top clears whatever chrome sits above the HUD (the
   Home / mute / Buy row), and the safe-area insets keep everything out of the
   notch and the home indicator. */
.sph-root{
  --sp-hud-top:  calc(env(safe-area-inset-top, 0px) + 52px);
  --sp-hud-left: calc(env(safe-area-inset-left, 0px) + 12px);
  --sp-hud-right:calc(env(safe-area-inset-right, 0px) + 12px);
  --sp-hud-bot:  calc(env(safe-area-inset-bottom, 0px) + 14px);
}

.sph-tl{ position:absolute; left:var(--sp-hud-left);  top:var(--sp-hud-top); width:196px; transform-origin:top left; }
.sph-tc{ position:absolute; left:50%;   top:calc(env(safe-area-inset-top, 0px) + 12px); transform-origin:top center; }
.sph-tr{ position:absolute; right:var(--sp-hud-right); top:var(--sp-hud-top); transform-origin:top right; }
.sph-quest{ position:absolute; left:var(--sp-hud-left); top:calc(var(--sp-hud-top) + 120px); width:214px; transform-origin:top left; }
.sph-bl{ position:absolute; left:var(--sp-hud-left);  bottom:var(--sp-hud-bot); width:196px; transform-origin:bottom left; }
.sph-br{ position:absolute; right:var(--sp-hud-right); bottom:var(--sp-hud-bot); width:204px; transform-origin:bottom right; }

.sph-tl,.sph-tr,.sph-quest,.sph-bl,.sph-br{ transform:scale(var(--sp-scale,1)); }
.sph-tc{ transform:translateX(-50%) scale(var(--sp-scale,1)); }

.sph-line{ display:flex; align-items:center; gap:6px; font-size:13px; line-height:1.25; }
.sph-line + .sph-line{ margin-top:5px; }
.sph-ico{ width:17px; text-align:center; flex:0 0 17px; font-size:14px; }
.sph-val{ font-variant-numeric:tabular-nums; }
.sph-sub{ color:var(--sp-ink-soft); font-size:11px; font-weight:700; }
.sph-grow{ flex:1; min-width:0; }
.sph-trunc{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

.sph-coins{ font-size:17px; color:var(--sp-red); }
.sph-xpwrap{ margin-top:6px; }
.sph-xpwrap .sp-bar{ height:7px; }

/* Today's net — deliberately quiet, one line under the coins. */
.sph-today{
  margin:1px 0 0 23px; font-size:10.5px; font-weight:800; line-height:1.2;
  color:var(--sp-ink-soft); font-variant-numeric:tabular-nums;
}
.sph-today.sph-up{ color:var(--sp-green); }
.sph-today.sph-down{ color:var(--sp-red); }

/* "You can afford an upgrade" nudge, pinned to the coin row. */
.sph-nudge{
  pointer-events:auto; cursor:pointer; font-family:inherit; font-weight:900;
  font-size:10px; letter-spacing:.04em; line-height:1;
  border:1.5px solid rgba(0,0,0,.12); border-radius:999px; padding:3px 8px;
  background:linear-gradient(180deg,#94bd80,var(--sp-green)); color:#fff;
  box-shadow:0 0 0 0 rgba(126,163,106,.7);
  animation:sph-pulse 1.9s ease-out infinite;
}
.sph-nudge:hover{ filter:brightness(1.06); }
.sph-nudge:focus-visible{ outline:2px solid var(--sp-red); outline-offset:2px; }
.sph-nudge.sph-hide{ display:none; }
@keyframes sph-pulse{
  0%{ box-shadow:0 0 0 0 rgba(126,163,106,.65); }
  70%{ box-shadow:0 0 0 9px rgba(126,163,106,0); }
  100%{ box-shadow:0 0 0 0 rgba(126,163,106,0); }
}
@media (prefers-reduced-motion:reduce){ .sph-nudge{ animation:none; } }

.sph-clock{ display:flex; align-items:center; gap:9px; padding:7px 14px; border-radius:999px; }
.sph-clock .sph-time{ font-size:14px; letter-spacing:.04em; font-variant-numeric:tabular-nums; }
.sph-clock .sph-dist{ color:var(--sp-ink-soft); font-size:12px; }
.sph-clock .sph-dot{ width:4px; height:4px; border-radius:50%; background:rgba(59,47,38,.3); }

.sph-compass{ display:flex; flex-direction:column; align-items:center; gap:5px; padding:7px; border-radius:18px; }
.sph-compass canvas{ display:block; width:84px; height:84px; }
.sph-compass .sph-dist-txt{ font-size:11px; color:var(--sp-ink-soft); max-width:96px; text-align:center; }
.sph-mapbtn{
  pointer-events:auto; cursor:pointer; font-family:inherit; font-weight:800; font-size:11px;
  border:2px solid rgba(59,47,38,.18); border-radius:10px; padding:3px 9px;
  background:linear-gradient(180deg,#fff8ea,#f1e0be); color:var(--sp-ink);
}
.sph-mapbtn:hover{ border-color:var(--sp-red); }
.sph-mapbtn:focus-visible{ outline:2px solid var(--sp-red); outline-offset:2px; }

.sph-quest .sph-qtitle{ color:var(--sp-red); font-size:12px; letter-spacing:.03em; text-transform:uppercase; }
.sph-quest .sph-qobj{ font-size:12px; font-weight:700; line-height:1.3; margin:4px 0 6px; }
.sph-quest.sph-empty{ display:none; }

/* sph-grow lets the label shrink its box but not its text, so at narrow card
   widths "Stamina" used to run straight through the number beside it. */
.sph-bl .sph-label{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sph-bl .sph-tired{ font-size:15px; opacity:0; transition:opacity .2s; }
.sph-bl.sph-low .sph-tired{ opacity:1; }
.sph-bl.sph-low .sph-label{ color:var(--sp-red); }

.sph-orders{ display:flex; flex-direction:column; gap:6px; }
.sph-br.sph-empty{ display:none; }
.sph-order{ display:flex; align-items:center; gap:8px; font-size:12px; }
.sph-ring{
  position:relative; width:26px; height:26px; flex:0 0 26px; border-radius:50%;
  background:conic-gradient(var(--sp-green) 0turn, var(--sp-green) 1turn, rgba(59,47,38,.14) 0);
}
.sph-ring > span{
  position:absolute; inset:3px; border-radius:50%;
  background:#fff8ec; display:flex; align-items:center; justify-content:center; font-size:13px;
}

@media (max-width:960px){
  .sph-tl,.sph-quest{ width:172px; }
  .sph-br,.sph-bl{ width:172px; }
  .sph-compass canvas{ width:70px; height:70px; }
}

/* ------------------------------------------------------------------ phones
   Four corners of cards is a desktop luxury. On a phone the bottom two corners
   belong to the thumbs, so every card collapses into one top-left column —
   stats, then stamina, then orders — with the clock and the minimap down the
   right edge. The compass card goes entirely: the minimap and the guide arrows
   already cover navigation, and the map opens from the touch menu.

   The offsets below are hand-stacked rather than flexed because the cards are
   independent absolutely-positioned siblings, and the two that can grow (orders
   is capped at four rows) sit at the bottom of the column where growth is free. */
@media (max-width:700px){
  .sph-root{ --sp-scale:.86; }
  .sph-tl{ width:152px; }

  .sph-tc{
    left:auto; right:var(--sp-hud-right); top:calc(env(safe-area-inset-top, 0px) + 12px);
    transform-origin:top right; transform:scale(var(--sp-scale,1));
    padding:5px 10px;
  }
  .sph-tc .sph-time{ font-size:12px; }
  .sph-tc .sph-dist{ display:none; }

  .sph-bl,.sph-br{ width:152px; }
  .sph-coins{ font-size:15px; }
  .sph-line{ font-size:12px; }
  /* 131 rendered pixels is not enough for icon + word + number + mood, and the
     ⚡ already says which bar this is. */
  .sph-bl .sph-label{ display:none; }
}

/* Everything that reacts to the on-screen controls rather than to width: the
   two bottom cards move out of the thumbs' corners, and the two cards that
   duplicate something else go. The compass shares the top-right with the
   minimap and its Map button now lives in the touch menu; the quest card says
   what the guide banner already says. */
@media (max-width:700px), (pointer:coarse){
  .sph-tr,.sph-quest{ display:none; }
  .sph-bl{
    left:var(--sp-hud-left); top:calc(var(--sp-hud-top) + 104px); bottom:auto;
    transform-origin:top left;
  }
  .sph-br{
    left:var(--sp-hud-left); right:auto; top:calc(var(--sp-hud-top) + 160px); bottom:auto;
    transform-origin:top left;
  }
}

/* Landscape phones: the column would run off the bottom, so shrink it and let
   orders overlap back toward the middle-left. */
@media (max-height:520px) and (pointer:coarse){
  .sph-root{ --sp-scale:.74; }
  .sph-bl{ top:calc(var(--sp-hud-top) + 90px); }
  .sph-br{ top:calc(var(--sp-hud-top) + 138px); }
}
`;

function styleOnce() {
  injectStyles();
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const RECIPE_ICON = Object.create(null);
for (const r of RECIPES) RECIPE_ICON[r.id] = r.icon;

/** Pretty name for any id an objective might point at. */
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

/** Objective counters, tolerant of whatever shape the quest runner stores. */
function objCounts(entry) {
  if (!entry) return [];
  if (Array.isArray(entry.progress)) return entry.progress;
  if (Array.isArray(entry.counts)) return entry.counts;
  if (Array.isArray(entry.objectives)) {
    return entry.objectives.map((o) => (typeof o === 'number' ? o : (o && (o.progress ?? o.count)) || 0));
  }
  return [];
}

export function createHUD(game) {
  styleOnce();

  const bus = game.bus;
  const state = game.state;
  const offs = [];
  const on = (evt, cb) => { const un = bus.on(evt, cb); offs.push(un); return un; };

  // ------------------------------------------------------------------ shell
  const root = el('div', 'sph-root');
  root.setAttribute('aria-live', 'off');

  // ------------------------------------------------------------- top-left
  const tl = el('div', 'sph-card sph-tl');
  const coinRow = el('div', 'sph-line');
  const coinVal = el('span', 'sph-val sph-coins', '0');
  const nudge = el('button', 'sph-nudge sph-hide');
  nudge.type = 'button';
  nudge.textContent = 'UPGRADE';
  nudge.addEventListener('click', () => {
    try { game.panels.open('upgrades'); } catch { /* panel not built yet */ }
  });
  coinRow.append(el('span', 'sph-ico', '🪙'), coinVal, el('span', 'sph-grow'), nudge);

  // Today's net, sitting quietly under the coin count.
  const todayLine = el('div', 'sph-today', '');

  const repRow = el('div', 'sph-line');
  const repVal = el('span', 'sph-val', '0');
  const repTier = el('span', 'sph-sub sph-grow sph-trunc', '');
  repRow.append(el('span', 'sph-ico', '⭐'), repVal, repTier);

  const lvlRow = el('div', 'sph-line');
  const lvlVal = el('span', 'sph-val', 'Lv 1');
  const xpTxt = el('span', 'sph-sub sph-grow sph-trunc', '');
  lvlRow.append(el('span', 'sph-ico', '🍣'), lvlVal, xpTxt);

  const xpWrap = el('div', 'sph-xpwrap');
  const xpBar = bar(0, THEME.gold);
  xpWrap.append(xpBar);
  tl.append(coinRow, todayLine, repRow, lvlRow, xpWrap);

  // ----------------------------------------------------------- top-centre
  const tc = el('div', 'sph-card sph-tc sph-clock');
  const skyIco = el('span', null, '☀️');
  const timeTxt = el('span', 'sph-time', 'Day 1 · 07:00');
  const distTxt = el('span', 'sph-dist', '');
  tc.append(skyIco, timeTxt, el('span', 'sph-dot'), distTxt);

  // ------------------------------------------------------------ top-right
  const tr = el('div', 'sph-card sph-tr sph-compass');
  const cvs = el('canvas');
  cvs.width = 168; cvs.height = 168;             // 2x for crispness
  cvs.setAttribute('aria-hidden', 'true');
  const distLabel = el('div', 'sph-dist-txt', 'No waypoint');
  const mapBtn = el('button', 'sph-mapbtn');
  mapBtn.type = 'button';
  mapBtn.textContent = '🗺 Map';
  mapBtn.title = 'Open the district map (M)';
  mapBtn.addEventListener('click', () => { try { game.panels.open('map'); } catch { /* no map yet */ } });
  tr.append(cvs, distLabel, mapBtn);
  const ctx = cvs.getContext('2d');

  // ---------------------------------------------------------- quest track
  const qc = el('div', 'sph-card sph-quest sph-empty');
  const qTitle = el('div', 'sph-qtitle sph-trunc', '');
  const qObj = el('div', 'sph-qobj', '');
  const qBar = bar(0, THEME.red);
  qc.append(qTitle, qObj, qBar);

  // ---------------------------------------------------------- bottom-left
  const bl = el('div', 'sph-card sph-bl');
  const stamRow = el('div', 'sph-line');
  const stamLabel = el('span', 'sph-sub sph-grow sph-label', 'Stamina');
  const stamVal = el('span', 'sph-val sph-sub', '');
  const tiredIco = el('span', 'sph-tired', '🐱‍💤');
  stamRow.append(el('span', 'sph-ico', '⚡'), stamLabel, stamVal, tiredIco);
  const stamBar = bar(1, THEME.green);
  bl.append(stamRow, stamBar);

  // --------------------------------------------------------- bottom-right
  const br = el('div', 'sph-card sph-br sph-empty');
  const brHead = el('div', 'sph-line');
  const brCount = el('span', 'sph-sub', '');
  brHead.append(el('span', 'sph-ico', '🍽️'), el('span', 'sph-sub sph-grow', 'Orders'), brCount);
  const orderList = el('div', 'sph-orders');
  br.append(brHead, orderList);

  root.append(tl, tc, tr, qc, bl, br);
  document.body.append(root);

  // ------------------------------------------------------------ live data
  let coinsShown = state.coins;
  let coinsTarget = state.coins;
  let visible = true;
  let panelsOpen = 0;
  /** Which upgrade opportunity the badge is currently showing. */
  let lastNudgeKey = null;
  /** Opportunities already toasted this session — never toast the same twice. */
  const announced = new Set();
  /** @type {{order:object,max:number,t:number,node:HTMLElement,ring:HTMLElement}[]} */
  let orders = [];

  // ------------------------------------------------------------- painters
  function paintCoins() { coinVal.textContent = `${Math.round(coinsShown)}¢`; }

  /** "Today: +180" / "Today: -40" — quiet, but always there. */
  function paintToday() {
    const t = state.today || {};
    const net = Math.round((Number(t.earned) || 0) - (Number(t.spent) || 0));
    todayLine.textContent = `Today: ${net >= 0 ? '+' : '−'}${Math.abs(net)}¢`;
    todayLine.classList.toggle('sph-up', net > 0);
    todayLine.classList.toggle('sph-down', net < 0);
    todayLine.title = `Earned ${Math.round(t.earned || 0)}¢, spent ${Math.round(t.spent || 0)}¢ today`;
  }

  // ------------------------------------------------------- upgrade nudge
  /**
   * The cheapest thing worth buying right now: the next shop tier if it is
   * fully within reach, otherwise the cheapest affordable upgrade.
   * @returns {{ key:string, label:string, toast:string }|null}
   */
  function affordableTarget() {
    const next = SHOP_TIERS.find((t) => t.tier === state.shop.tier + 1) || null;
    if (next && state.coins >= next.cost && state.reputation >= next.repReq) {
      return {
        key: `tier:${next.tier}`,
        label: 'UPGRADE',
        toast: `You can afford the ${next.name} — press U`,
      };
    }
    let best = null;
    for (const u of UPGRADES) {
      const lvl = state.upgradeLevel(u.id);
      if (lvl >= u.maxLevel) continue;
      if (!upgradeUnlocked(u, state)) continue;
      const cost = upgradeCost(u, lvl);
      if (cost == null || cost > state.coins) continue;
      if (!best || cost < best.cost) best = { u, cost, lvl };
    }
    if (!best) return null;
    return {
      key: `up:${best.u.id}:${best.lvl}`,
      label: 'UPGRADE',
      toast: `${money(best.cost)} buys ${best.u.name} — press U`,
    };
  }

  function paintNudge() {
    const target = affordableTarget();
    if (!target) {
      nudge.classList.add('sph-hide');
      lastNudgeKey = null;
      return;
    }
    nudge.classList.remove('sph-hide');
    nudge.textContent = target.label;
    nudge.title = target.toast;
    nudge.setAttribute('aria-label', target.toast);

    // Announce each distinct opportunity once, so it reads as news rather
    // than nagging every time a coin lands.
    if (target.key !== lastNudgeKey && !announced.has(target.key)) {
      announced.add(target.key);
      bus.emit(EV.TOAST, { text: target.toast, icon: '🏗️', tone: 'good' });
    }
    lastNudgeKey = target.key;
  }

  function paintRep() {
    const tier = typeof state.repTier === 'function' ? state.repTier() : null;
    repVal.textContent = String(Math.round(state.reputation));
    repTier.textContent = tier ? tier.name : '';
  }

  function paintXp() {
    const lvl = state.level;
    const need = typeof state.xpForLevel === 'function' ? state.xpForLevel(lvl) : 0;
    lvlVal.textContent = `Lv ${lvl}`;
    xpTxt.textContent = need ? `${Math.round(state.xp)}/${need} xp` : `${Math.round(state.xp)} xp`;
    xpBar.set(need ? clamp01(state.xp / need) : 0);
  }

  function paintStamina() {
    const max = typeof state.staminaMax === 'function' ? state.staminaMax() : 100;
    const v = clamp01(max ? state.stamina / max : 0);
    stamVal.textContent = `${Math.round(state.stamina)}`;
    stamBar.set(v, v < 0.25 ? THEME.red : v < 0.5 ? THEME.gold : THEME.green);
    bl.classList.toggle('sph-low', v < 0.25);
  }

  function hourOf() {
    if (game.clock && typeof game.clock.hour === 'number') return game.clock.hour;
    return (state.clock && state.clock.hour) || 0;
  }

  function paintClock() {
    const c = game.clock;
    const day = c && c.day != null ? c.day : (state.clock ? state.clock.day : 1);
    let text;
    if (c && typeof c.timeString === 'string') {
      text = c.timeString;
    } else {
      const h = hourOf();
      const hh = Math.floor(h) % 24;
      const mm = Math.floor((h - Math.floor(h)) * 60);
      text = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
    timeTxt.textContent = `Day ${day} · ${text}`;
    const phase = (c && c.phase) || phaseFromHour(hourOf());
    skyIco.textContent = phase === 'night' ? '🌙' : phase === 'evening' ? '🌇' : phase === 'morning' ? '🌤️' : '☀️';
  }

  function phaseFromHour(h) {
    if (h < 6 || h >= 21) return 'night';
    if (h < 10) return 'morning';
    if (h < 17) return 'day';
    return 'evening';
  }

  function paintDistrict(id) {
    const d = districtById(id);
    distTxt.textContent = d ? `${d.icon} ${d.name}` : '';
  }

  // ------------------------------------------------------------ quest hud
  function trackedId() {
    const q = game.quests;
    if (q) {
      const t = q.tracked;
      if (typeof t === 'string') return t;
      if (t && t.id) return t.id;
    }
    const active = state.data && state.data.quests && state.data.quests.active;
    const ids = active ? Object.keys(active) : [];
    return ids.length ? ids[0] : null;
  }

  function paintQuest() {
    const id = trackedId();
    const def = id ? QUEST_INDEX[id] : null;
    if (!def) { qc.classList.add('sph-empty'); return; }
    qc.classList.remove('sph-empty');
    const active = state.data && state.data.quests && state.data.quests.active;
    const entry = active ? active[id] : null;
    const counts = objCounts(entry);
    const objs = def.objectives || [];

    let doneUnits = 0, totalUnits = 0, currentIdx = -1;
    for (let i = 0; i < objs.length; i++) {
      const need = objs[i].count == null ? 1 : objs[i].count;
      const got = Math.min(need, Number(counts[i]) || 0);
      totalUnits += need; doneUnits += got;
      if (currentIdx < 0 && got < need) currentIdx = i;
    }
    if (currentIdx < 0) currentIdx = objs.length - 1;

    qTitle.textContent = def.title;
    const cur = objs[currentIdx];
    if (cur) {
      const need = cur.count == null ? 1 : cur.count;
      const got = Math.min(need, Number(counts[currentIdx]) || 0);
      const label = objectiveText(cur, resolveName);
      qObj.textContent = need > 1 ? `${label}  (${got}/${need})` : label;
    } else {
      qObj.textContent = '';
    }
    qBar.set(totalUnits ? doneUnits / totalUnits : 0);
  }

  // --------------------------------------------------------------- orders
  function orderRecipeId(o) {
    if (!o) return null;
    if (o.recipeId) return o.recipeId;
    if (o.recipe) return typeof o.recipe === 'string' ? o.recipe : o.recipe.id;
    if (Array.isArray(o.items) && o.items.length) {
      const first = o.items[0];
      return typeof first === 'string' ? first : (first.recipeId || first.id);
    }
    return null;
  }

  function orderKey(o) { return (o && (o.id != null ? o.id : o)) || o; }

  function addOrder(o) {
    if (!o) return;
    const node = el('div', 'sph-order');
    const ring = el('div', 'sph-ring');
    const inner = el('span', null, RECIPE_ICON[orderRecipeId(o)] || '🍣');
    ring.append(inner);
    const rid = orderRecipeId(o);
    const rec = RECIPES.find((r) => r.id === rid);
    const name = el('span', 'sph-grow sph-trunc', rec ? rec.name : (o.label || 'Order'));
    node.append(ring, name);
    orderList.append(node);
    orders.push({
      order: o,
      max: Number(o.patience) || Number(o.maxPatience) || 120,
      t: 0, node, ring,
    });
    trimOrders();
  }

  function dropOrder(o) {
    const key = orderKey(o);
    const idx = orders.findIndex((r) => orderKey(r.order) === key);
    if (idx < 0) return;
    orders[idx].node.remove();
    orders.splice(idx, 1);
    trimOrders();
  }

  function trimOrders() {
    while (orders.length > 4) { const r = orders.shift(); r.node.remove(); }
    brCount.textContent = orders.length ? `${orders.length}` : '';
    refreshOrderVisibility();
  }

  function shopOpen() {
    const s = state.shop;
    return !!(s && s.isOpen);
  }

  function refreshOrderVisibility() {
    br.classList.toggle('sph-empty', !shopOpen() || orders.length === 0);
  }

  function tickOrders(dt) {
    for (const rec of orders) {
      rec.t += dt;
      const o = rec.order;
      let ratio;
      if (typeof o.patienceLeft === 'number') ratio = clamp01(o.patienceLeft / rec.max);
      else if (typeof o.timeLeft === 'number') ratio = clamp01(o.timeLeft / rec.max);
      else ratio = clamp01(1 - rec.t / rec.max);
      const col = ratio > 0.5 ? THEME.green : ratio > 0.22 ? THEME.gold : THEME.red;
      rec.ring.style.background =
        `conic-gradient(${col} 0turn ${ratio.toFixed(3)}turn, rgba(59,47,38,.14) ${ratio.toFixed(3)}turn 1turn)`;
    }
  }

  // -------------------------------------------------------------- compass
  function drawCompass() {
    // Phones hide the compass card entirely — don't pay for a canvas nobody
    // can see. `offsetParent` is null exactly when an ancestor is display:none.
    if (!ctx || tr.offsetParent === null) return;
    const w = cvs.width, h = cvs.height;
    const cx = w / 2, cy = h / 2, r = w / 2 - 12;
    ctx.clearRect(0, 0, w, h);

    // dial
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(59,47,38,.22)';
    ctx.stroke();

    const yaw = (game.player && typeof game.player.yaw === 'number') ? game.player.yaw : 0;

    // tick marks every 45°
    ctx.strokeStyle = 'rgba(59,47,38,.18)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 - yaw;
      const sx = cx + Math.sin(a) * (r - 4), sy = cy - Math.cos(a) * (r - 4);
      const ex = cx + Math.sin(a) * (r - 12), ey = cy - Math.cos(a) * (r - 12);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    }

    // North (world -Z)
    const nA = Math.PI - yaw;
    const nx = cx + Math.sin(nA) * (r - 22), ny = cy - Math.cos(nA) * (r - 22);
    ctx.fillStyle = THEME.red;
    ctx.font = '700 26px "Quicksand", system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny);

    // player heading pip in the middle
    ctx.fillStyle = 'rgba(59,47,38,.55)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 12);
    ctx.lineTo(cx + 8, cy + 9);
    ctx.lineTo(cx, cy + 4);
    ctx.lineTo(cx - 8, cy + 9);
    ctx.closePath();
    ctx.fill();

    // waypoint
    const wp = game.world && game.world.waypoint;
    const p = game.player && game.player.position;
    if (wp && p && typeof wp.x === 'number') {
      const dx = wp.x - p.x, dz = wp.z - p.z;
      const dist = Math.hypot(dx, dz);
      const rel = Math.atan2(dx, dz) - yaw;
      const px = cx + Math.sin(rel) * (r - 6), py = cy - Math.cos(rel) * (r - 6);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rel);
      ctx.fillStyle = THEME.gold;
      ctx.strokeStyle = 'rgba(59,47,38,.4)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -11); ctx.lineTo(9, 8); ctx.lineTo(0, 3); ctx.lineTo(-9, 8);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      distLabel.textContent = `${wp.label ? wp.label + ' · ' : ''}${Math.round(dist)} m`;
    } else {
      distLabel.textContent = 'No waypoint';
    }
  }

  // ---------------------------------------------------------- visibility
  function hiddenMode() {
    const m = game.mode;
    return m === 'cutscene' || m === 'cooking' || m === 'fishing' || m === 'dialogue';
  }

  function applyVisibility() {
    const off = !visible || hiddenMode() || panelsOpen > 0;
    root.classList.toggle('sph-off', off);
  }

  // ------------------------------------------------------------- wiring
  on(EV.COINS, (p) => {
    coinsTarget = p && p.coins != null ? p.coins : state.coins;
    paintToday();
    paintNudge();
  });
  on(EV.REPUTATION, () => { paintRep(); paintNudge(); });
  on(EV.XP, paintXp);
  on(EV.STAMINA, paintStamina);
  on(EV.TIME, paintClock);
  on(EV.PHASE, paintClock);
  on(EV.DAY_START, () => {
    paintClock();
    paintToday();
    orders.forEach((r) => r.node.remove());
    orders = [];
    trimOrders();
  });
  on(EV.DISTRICT_ENTER, (p) => paintDistrict(p && p.id));
  on(EV.SHOP_UPGRADED, () => { refreshOrderVisibility(); paintNudge(); });
  // A fresh run or a loaded save changes every number at once.
  on(EV.LOAD, () => { paintToday(); paintNudge(); });

  on(EV.QUEST_STARTED, paintQuest);
  on(EV.QUEST_PROGRESS, paintQuest);
  on(EV.QUEST_DONE, paintQuest);
  on(EV.QUEST_OFFERED, paintQuest);

  on(EV.ORDER_NEW, (p) => { addOrder(p && p.order); refreshOrderVisibility(); });
  on(EV.ORDER_SERVED, (p) => dropOrder(p && p.order));
  on(EV.ORDER_FAILED, (p) => dropOrder(p && p.order));

  on(EV.PANEL_OPEN, () => { panelsOpen++; applyVisibility(); });
  on(EV.PANEL_CLOSE, () => { panelsOpen = Math.max(0, panelsOpen - 1); applyVisibility(); });

  // First paint. paintNudge() runs last and stays quiet on boot: a save that
  // loads already able to afford something should not fire a toast at the
  // title card, so seed `announced` with whatever is true at construction.
  paintCoins(); paintRep(); paintXp(); paintStamina(); paintClock(); paintQuest();
  paintToday();
  paintDistrict((state.data && state.data.player && state.data.player.district) || null);
  refreshOrderVisibility();
  {
    const boot = affordableTarget();
    if (boot) announced.add(boot.key);
    paintNudge();
  }

  // -------------------------------------------------------------- update
  let compassAcc = 0;
  function update(dt) {
    const d = Number(dt) || 0;

    // Coin count-up: fast but never instant, and always lands exactly.
    if (coinsShown !== coinsTarget) {
      const diff = coinsTarget - coinsShown;
      const step = Math.max(1, Math.abs(diff) * Math.min(1, d * 6));
      coinsShown += Math.sign(diff) * Math.min(Math.abs(diff), step);
      if (Math.abs(coinsTarget - coinsShown) < 0.5) coinsShown = coinsTarget;
      paintCoins();
    }

    applyVisibility();
    if (root.classList.contains('sph-off')) return;

    tickOrders(d);
    refreshOrderVisibility();

    compassAcc += d;
    if (compassAcc >= 1 / 20) { compassAcc = 0; drawCompass(); }
  }

  function setVisible(v) { visible = !!v; applyVisibility(); }

  function destroy() {
    for (const un of offs) { try { un(); } catch { /* ignore */ } }
    offs.length = 0;
    orders.forEach((r) => r.node.remove());
    orders = [];
    root.remove();
  }

  return {
    root,
    setVisible,
    get visible() { return visible; },
    update,
    refresh() {
      paintRep(); paintXp(); paintStamina(); paintClock(); paintQuest();
      paintToday(); paintNudge();
    },
    destroy,
  };
}
