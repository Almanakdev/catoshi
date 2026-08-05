// Upgrades & shop tier.
//
// The shop-tier card sits at the top because it is the decision that changes
// the game; the levelled upgrades below are the steady drip.

import { EV } from '../game/bus.js';
import { injectStyles, el, panel, button, money } from './kit.js';
import {
  UPGRADE_CATEGORIES, UPGRADES, upgradeCost, upgradeUnlocked, upgradesByCategory,
} from '../data/upgrades.js';
import { SHOP_TIERS } from '../data/progression.js';
import { QUEST_INDEX } from '../data/quests.js';

const STYLE_ID = 'sp-upgrade-style';

const CSS = `
.spu-body{ flex:1; min-height:0; display:flex; flex-direction:column; gap:9px; }
.spu-tabs{ display:flex; gap:6px; flex-wrap:wrap; }
.spu-tab{
  font-family:inherit; font-weight:800; font-size:12px; cursor:pointer;
  border:1.5px solid rgba(59,47,38,.14); border-radius:999px;
  background:rgba(255,255,255,.6); color:var(--sp-ink); padding:5px 12px;
}
.spu-tab:hover{ border-color:var(--sp-red); }
.spu-tab.spu-on{ background:var(--sp-red); color:#fff8ef; border-color:rgba(0,0,0,.12); }
.spu-tab:focus-visible{ outline:2px solid var(--sp-red); outline-offset:2px; }

.spu-scroll{ flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; gap:9px; padding-right:4px; }
.spu-scroll::-webkit-scrollbar{ width:8px; }
.spu-scroll::-webkit-scrollbar-thumb{ background:rgba(59,47,38,.2); border-radius:8px; }

.spu-hero{
  background:linear-gradient(180deg,rgba(240,185,63,.2),rgba(240,185,63,.08));
  border:2px solid rgba(240,185,63,.55); border-radius:16px; padding:11px 13px;
  display:flex; gap:12px; align-items:flex-start;
}
.spu-hero .spu-ico{ font-size:34px; line-height:1; }
.spu-hero h3{ margin:0; font-size:15px; }
.spu-ba{ display:flex; align-items:center; gap:8px; font-size:11.5px; font-weight:700; color:var(--sp-ink-soft); margin-top:4px; line-height:1.4; }
.spu-ba .spu-arrow{ color:var(--sp-red); font-weight:900; }
.spu-ba div{ flex:1; min-width:0; }

.spu-grid{ display:grid; gap:9px; grid-template-columns:repeat(auto-fill, minmax(258px, 1fr)); }
.spu-card{
  background:rgba(255,255,255,.6); border:1.5px solid rgba(59,47,38,.1);
  border-radius:14px; padding:10px; display:flex; flex-direction:column; gap:6px;
}
.spu-card.spu-locked{ opacity:.55; }
.spu-top{ display:flex; align-items:center; gap:8px; }
.spu-top .spu-ico{ font-size:24px; width:28px; text-align:center; }
.spu-top .spu-name{ flex:1; font-size:13px; font-weight:900; }
.spu-desc{ font-size:11.5px; font-weight:700; color:var(--sp-ink-soft); line-height:1.4; }
.spu-pips{ display:flex; gap:4px; align-items:center; }
.spu-pip{ width:13px; height:9px; border-radius:4px; background:rgba(59,47,38,.16); }
.spu-pip.spu-fill{ background:var(--sp-green); }
.spu-eff{ display:flex; flex-wrap:wrap; gap:5px; }
.spu-tag{
  font-size:10.5px; font-weight:800; border-radius:999px; padding:2px 8px;
  background:rgba(126,163,106,.18); border:1px solid rgba(126,163,106,.4); color:var(--sp-ink);
}
.spu-foot{ display:flex; align-items:center; gap:8px; margin-top:2px; }
.spu-cost{ font-size:12px; font-weight:900; color:var(--sp-red); font-variant-numeric:tabular-nums; }
.spu-req{ font-size:11px; font-weight:700; color:var(--sp-ink-soft); flex:1; }
.spu-empty{ padding:22px; text-align:center; color:var(--sp-ink-soft); font-size:12px; }
`;

function styleOnce() {
  injectStyles();
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

/** Effect key -> readable label + how to format the per-level delta. */
const EFFECT_LABEL = {
  inventory:     { label: 'basket slots', pct: false },
  stamina:       { label: 'max stamina',  pct: false },
  timingZone:    { label: 'timing window', pct: true },
  sliceSpeed:    { label: 'slice margin',  pct: true },
  freshness:     { label: 'slower spoiling', pct: true },
  tipChance:     { label: 'tip chance',   pct: true },
  tipAmount:     { label: 'tip size',     pct: true },
  queueSize:     { label: 'queue space',  pct: false },
  cookSpeed:     { label: 'cook speed',   pct: true },
  fishingLuck:   { label: 'fishing luck', pct: true },
  deliveryTime:  { label: 's delivery grace', pct: false },
  dailySpecials: { label: 'daily special', pct: false },
  prepQuality:   { label: 'dish quality', pct: true },
  buyDiscount:   { label: 'supplier discount', pct: true },
};

function effectTags(effects) {
  const out = [];
  for (const k in effects || {}) {
    const def = EFFECT_LABEL[k] || { label: k, pct: false };
    const v = effects[k];
    const txt = def.pct ? `+${Math.round(v * 100)}% ${def.label}` : `+${v} ${def.label}`;
    out.push(txt);
  }
  return out;
}

function requireText(req) {
  if (!req) return '';
  const bits = [];
  if (req.shopTier != null) {
    const t = SHOP_TIERS.find((x) => x.tier === req.shopTier);
    bits.push(`${t ? t.name : `Tier ${req.shopTier}`}`);
  }
  if (req.reputation != null) bits.push(`⭐ ${req.reputation}`);
  if (req.level != null) bits.push(`Lv ${req.level}`);
  if (req.quest) { const q = QUEST_INDEX[req.quest]; bits.push(`“${q ? q.title : req.quest}”`); }
  return bits.length ? `Needs ${bits.join(' · ')}` : '';
}

export function createUpgradeUI(game) {
  styleOnce();

  const id = 'upgrades';
  const state = game.state;
  const offs = [];

  const p = panel({
    id: 'sp-panel-upgrades',
    title: 'Upgrades',
    sub: '',
    pos: {
      left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
      width: 'min(860px, 94vw)', height: 'min(590px, 88vh)',
    },
    onClose: () => game.panels.close(id),
  });
  p.root.setAttribute('role', 'dialog');
  p.root.setAttribute('aria-label', 'Upgrades');

  const body = el('div', 'spu-body');
  const tabs = el('div', 'spu-tabs');
  tabs.setAttribute('role', 'tablist');
  const scroll = el('div', 'spu-scroll');
  const hero = el('div', 'spu-hero');
  const grid = el('div', 'spu-grid');
  scroll.append(hero, grid);
  body.append(tabs, scroll);
  p.body.append(body);

  let open = false;
  const catKeys = Object.keys(UPGRADE_CATEGORIES);
  let tab = catKeys[0];

  const tabBtns = [];
  for (const key of catKeys) {
    const c = UPGRADE_CATEGORIES[key];
    const b = el('button', 'spu-tab', `${c.icon} ${c.name}`);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => { tab = key; render(); });
    tabBtns.push({ key, b });
    tabs.append(b);
  }

  // --------------------------------------------------------- shop tier card
  function renderHero() {
    hero.textContent = '';
    const cur = SHOP_TIERS.find((t) => t.tier === state.shop.tier) || SHOP_TIERS[0];
    const next = SHOP_TIERS.find((t) => t.tier === state.shop.tier + 1) || null;

    hero.append(el('span', 'spu-ico', next ? '🏗️' : '🏆'));
    const col = el('div', 'sp-col');
    col.style.flex = '1';
    col.style.minWidth = '0';

    if (!next) {
      col.append(el('h3', null, `${cur.name} — the top of the city`));
      col.append(el('div', 'spu-desc', cur.desc));
      hero.append(col);
      return;
    }

    col.append(el('h3', null, `Upgrade the shop → ${next.name}`));
    const ba = el('div', 'spu-ba');
    ba.append(el('div', null, `Now: ${cur.name}. ${cur.seats} seats, queue of ${cur.queue}. ${cur.desc}`));
    ba.append(el('span', 'spu-arrow', '→'));
    ba.append(el('div', null, `After: ${next.name}. ${next.seats} seats, queue of ${next.queue}. ${next.desc}`));
    col.append(ba);

    const foot = el('div', 'spu-foot');
    const repOk = state.reputation >= next.repReq;
    const coinOk = state.canAfford(next.cost);
    foot.append(el('span', 'spu-cost', money(next.cost)));
    foot.append(el('span', 'spu-req', repOk
      ? `⭐ ${next.repReq} reputation — met`
      : `⭐ needs ${next.repReq} reputation (you have ${Math.round(state.reputation)})`));

    const btn = button('Upgrade the shop', {
      cls: 'sp-primary',
      onClick: () => {
        if (!repOk || !coinOk) return;
        if (!state.spendCoins(next.cost, 'shop-tier')) return;
        state.setShopTier(next.tier);
        game.bus.emit(EV.TOAST, { text: `${next.name}!`, icon: '🏮', tone: 'good' });
        render();
      },
    });
    btn.disabled = !repOk || !coinOk;
    foot.append(btn);
    col.append(foot);
    hero.append(col);
  }

  // ------------------------------------------------------------ upgrade card
  function card(u) {
    const lvl = state.upgradeLevel(u.id);
    const maxed = lvl >= u.maxLevel;
    const unlocked = upgradeUnlocked(u, state);
    const cost = upgradeCost(u, lvl);
    const afford = cost != null && state.canAfford(cost);

    const c = el('div', 'spu-card');
    if (!unlocked) c.classList.add('spu-locked');

    const top = el('div', 'spu-top');
    top.append(el('span', 'spu-ico', u.icon));
    top.append(el('span', 'spu-name', u.name));
    const pips = el('div', 'spu-pips');
    for (let i = 0; i < u.maxLevel; i++) {
      const pip = el('span', `spu-pip ${i < lvl ? 'spu-fill' : ''}`.trim());
      pips.append(pip);
    }
    pips.title = `Level ${lvl} of ${u.maxLevel}`;
    top.append(pips);
    c.append(top);

    c.append(el('div', 'spu-desc', u.desc));

    const eff = el('div', 'spu-eff');
    for (const t of effectTags(u.effects)) eff.append(el('span', 'spu-tag', t));
    c.append(eff);

    const foot = el('div', 'spu-foot');
    if (maxed) {
      foot.append(el('span', 'spu-req', '✔ Fully upgraded'));
    } else if (!unlocked) {
      foot.append(el('span', 'spu-req', requireText(u.requires) || 'Locked'));
    } else {
      foot.append(el('span', 'spu-cost', money(cost)));
      foot.append(el('span', 'spu-req', `Level ${lvl} → ${lvl + 1}`));
      const btn = button('Buy', {
        cls: 'sp-good',
        onClick: () => {
          const price = upgradeCost(u, state.upgradeLevel(u.id));
          if (price == null) return;
          if (!state.spendCoins(price, `upgrade:${u.id}`)) {
            game.bus.emit(EV.TOAST, { text: 'Not enough coins', icon: '🪙', tone: 'bad' });
            return;
          }
          state.setUpgradeLevel(u.id, state.upgradeLevel(u.id) + 1);
          game.bus.emit(EV.TOAST, { text: `${u.name} upgraded`, icon: u.icon, tone: 'good' });
          render();
        },
      });
      btn.disabled = !afford;
      foot.append(btn);
    }
    c.append(foot);
    return c;
  }

  function render() {
    for (const t of tabBtns) {
      t.b.classList.toggle('spu-on', t.key === tab);
      t.b.setAttribute('aria-selected', t.key === tab ? 'true' : 'false');
    }
    renderHero();
    grid.textContent = '';
    const list = upgradesByCategory(tab);
    if (!list.length) grid.append(el('div', 'spu-empty', 'Nothing here yet.'));
    for (const u of list) grid.append(card(u));

    const owned = UPGRADES.reduce((s, u) => s + state.upgradeLevel(u.id), 0);
    p.setTitle('Upgrades', `${owned} bought · ${money(state.coins)}`);
  }

  offs.push(game.bus.on(EV.COINS, () => { if (open) render(); }));
  offs.push(game.bus.on(EV.REPUTATION, () => { if (open) render(); }));
  offs.push(game.bus.on(EV.XP, () => { if (open) render(); }));

  // ----------------------------------------------------------------- api
  const api = {
    id,
    open(payload) {
      if (payload && payload.tab && UPGRADE_CATEGORIES[payload.tab]) tab = payload.tab;
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
