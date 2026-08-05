// Upgrades & shop tier.
//
// The shop-tier card sits at the top because it is the decision that changes
// the game; the levelled upgrades below are the steady drip.

import { EV } from '../game/bus.js';
import { injectStyles, el, panel, button, bar, money, THEME } from './kit.js';
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
.spu-hero.spu-ready{ border-color:var(--sp-green); background:linear-gradient(180deg,rgba(126,163,106,.24),rgba(126,163,106,.1)); }
.spu-hero .spu-ico{ font-size:34px; line-height:1; }
.spu-hero h3{ margin:0; font-size:15px; }

/* before → after, side by side so the trade is one glance */
.spu-ba{ display:flex; align-items:stretch; gap:9px; margin-top:7px; }
.spu-ba .spu-arrow{ color:var(--sp-red); font-weight:900; font-size:16px; align-self:center; flex:0 0 auto; }
.spu-side{
  flex:1; min-width:0; border-radius:11px; padding:7px 9px;
  background:rgba(255,255,255,.5); border:1.5px solid rgba(59,47,38,.1);
}
.spu-side.spu-after{ background:rgba(255,255,255,.85); border-color:rgba(240,185,63,.6); }
.spu-side .spu-when{ font-size:9.5px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; color:var(--sp-ink-soft); }
.spu-side .spu-tname{ font-size:12.5px; font-weight:900; line-height:1.25; margin:1px 0 3px; }
.spu-side .spu-gives{ font-size:11px; font-weight:700; color:var(--sp-ink-soft); line-height:1.4; }

.spu-prog{ margin-top:8px; display:flex; flex-direction:column; gap:4px; }
.spu-prog .spu-ptxt{ font-size:11px; font-weight:800; color:var(--sp-ink-soft); }
.spu-prog .sp-bar{ height:8px; }

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

/**
 * Effect key -> a phrase a player can act on. Nothing here shows a raw stat
 * name: "sliceSpeed 0.07" means nothing, "7% more forgiving slicing" does.
 *
 * `unit` is appended straight after the number, `label` after a space.
 */
const EFFECT_LABEL = {
  inventory:     { label: 'basket slots',            pct: false },
  stamina:       { label: 'max stamina',             pct: false },
  timingZone:    { label: 'wider timing window',     pct: true },
  sliceSpeed:    { label: 'more forgiving slicing',  pct: true },
  freshness:     { label: 'slower spoiling',         pct: true },
  tipChance:     { label: 'more often tipped',       pct: true },
  tipAmount:     { label: 'bigger tips',             pct: true },
  queueSize:     { label: 'customer in the queue',   pct: false, plural: 'customers in the queue' },
  cookSpeed:     { label: 'faster cooking',          pct: true },
  fishingLuck:   { label: 'better fishing luck',     pct: true },
  deliveryTime:  { label: 'more delivery time',      pct: false, unit: 's' },
  dailySpecials: { label: 'daily special slot',      pct: false, plural: 'daily special slots' },
  prepQuality:   { label: 'better dishes',           pct: true },
  buyDiscount:   { label: 'off supplier prices',     pct: true },
};

/** "+2 basket slots", "+7% more forgiving slicing", "+8s more delivery time". */
function effectPhrase(key, value) {
  const def = EFFECT_LABEL[key];
  if (!def) return `+${value} ${key}`;
  if (def.pct) return `+${Math.round(value * 100)}% ${def.label}`;
  const label = (value === 1 || !def.plural) ? def.label : def.plural;
  return `+${value}${def.unit || ''} ${label}`;
}

function effectTags(effects) {
  const out = [];
  for (const k in effects || {}) out.push(effectPhrase(k, effects[k]));
  return out;
}

/** What the player already owns from this upgrade, in the same phrasing. */
function ownedPhrase(u, lvl) {
  if (!lvl) return '';
  const bits = [];
  for (const k in u.effects || {}) bits.push(effectPhrase(k, Math.round(u.effects[k] * lvl * 1000) / 1000));
  return bits.join(' · ');
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
  /** "4 seats · queue of 4" — what a tier actually hands the player. */
  function tierGives(t) {
    return `${t.seats} seats · queue of ${t.queue}`;
  }

  function renderHero() {
    hero.textContent = '';
    hero.classList.remove('spu-ready');
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

    const repOk = state.reputation >= next.repReq;
    const coinOk = state.canAfford(next.cost);
    if (repOk && coinOk) hero.classList.add('spu-ready');

    col.append(el('h3', null, `Upgrade the shop → ${next.name}`));

    // before → after
    const ba = el('div', 'spu-ba');
    const before = el('div', 'spu-side');
    before.append(el('div', 'spu-when', 'Now'));
    before.append(el('div', 'spu-tname', cur.name));
    before.append(el('div', 'spu-gives', tierGives(cur)));
    before.append(el('div', 'spu-gives', cur.desc));
    const after = el('div', 'spu-side spu-after');
    after.append(el('div', 'spu-when', 'After'));
    after.append(el('div', 'spu-tname', next.name));
    after.append(el('div', 'spu-gives', tierGives(next)));
    after.append(el('div', 'spu-gives', next.desc));
    ba.append(before, el('span', 'spu-arrow', '→'), after);
    col.append(ba);

    // How close are they? Only worth drawing while it is still out of reach.
    if (!coinOk || !repOk) {
      const prog = el('div', 'spu-prog');
      if (!coinOk) {
        const frac = next.cost > 0 ? Math.max(0, Math.min(1, state.coins / next.cost)) : 1;
        prog.append(el('div', 'spu-ptxt',
          `${money(state.coins)} of ${money(next.cost)} saved — ${money(next.cost - state.coins)} to go`));
        prog.append(bar(frac, THEME.gold));
      }
      if (!repOk) {
        const frac = next.repReq > 0 ? Math.max(0, Math.min(1, state.reputation / next.repReq)) : 1;
        prog.append(el('div', 'spu-ptxt',
          `⭐ ${Math.round(state.reputation)} of ${next.repReq} reputation — serve more customers`));
        prog.append(bar(frac, THEME.red));
      }
      col.append(prog);
    }

    const foot = el('div', 'spu-foot');
    foot.append(el('span', 'spu-cost', money(next.cost)));
    foot.append(el('span', 'spu-req', repOk && coinOk
      ? 'You can afford this right now'
      : (repOk ? 'Keep saving' : `Needs ⭐ ${next.repReq} reputation`)));

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
    c.append(el('div', 'spu-desc', maxed ? 'You have all of it:' : 'Each level gives:'));
    c.append(eff);
    if (lvl > 0) c.append(el('div', 'spu-desc', `Already giving you ${ownedPhrase(u, lvl)}.`));

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
