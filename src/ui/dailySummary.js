// End-of-day receipt.
//
// The player's complaint was "I don't understand the money and the shop", so
// this card is deliberately a till receipt and not a stat dump: profit is the
// hero number, everything else is a supporting line, and the last thing they
// read is one concrete sentence about what to do tomorrow.
//
// `open()` returns a promise that resolves when they press "Sleep until
// morning". It ALWAYS resolves — closing by ✕ or Esc counts as sleeping,
// because stranding the player at midnight with no card is worse than a
// slightly cheap exit.

import { EV } from '../game/bus.js';
import { injectStyles, el, panel, button, money } from './kit.js';
import { recipe as recipeById } from '../data/recipes.js';
import { ingredient } from '../data/ingredients.js';
import { SHOP_TIERS } from '../data/progression.js';
import { UPGRADES, upgradeCost, upgradeUnlocked } from '../data/upgrades.js';
import { bestCookableRecipe, recipeEconomy } from '../data/economy.js';

const STYLE_ID = 'sp-daily-style';

const CSS = `
.spd-body{ display:flex; flex-direction:column; gap:9px; }
.spd-day{ display:flex; align-items:baseline; gap:8px; }
.spd-day b{ font-size:22px; color:var(--sp-red); }
.spd-day span{ font-size:12px; font-weight:800; color:var(--sp-ink-soft); }

/* ---- the hero: profit --------------------------------------------------- */
.spd-hero{
  display:flex; align-items:center; gap:12px; padding:11px 13px;
  border-radius:15px; border:2px solid rgba(240,185,63,.55);
  background:linear-gradient(180deg,rgba(240,185,63,.22),rgba(240,185,63,.1));
}
.spd-hero.spd-h-bad{ border-color:rgba(200,80,63,.5); background:linear-gradient(180deg,rgba(200,80,63,.16),rgba(200,80,63,.07)); }
.spd-hero .spd-ico{ font-size:30px; line-height:1; }
.spd-hero .spd-num{ font-size:28px; font-weight:900; line-height:1; font-variant-numeric:tabular-nums; }
.spd-hero .spd-cap{ font-size:11px; font-weight:800; letter-spacing:.05em; text-transform:uppercase; color:var(--sp-ink-soft); }
.spd-hero .spd-eq{ margin-left:auto; text-align:right; font-size:11px; font-weight:700; color:var(--sp-ink-soft); line-height:1.5; }

.spd-rows{ display:flex; flex-direction:column; gap:4px; }
.spd-row{
  display:flex; align-items:center; gap:9px; font-size:12.5px; font-weight:800;
  background:rgba(255,255,255,.55); border:1.5px solid rgba(59,47,38,.1);
  border-radius:11px; padding:5px 10px;
}
.spd-row .spd-ico{ width:18px; text-align:center; flex:0 0 18px; font-size:14px; }
.spd-row .spd-lbl{ flex:1; }
.spd-row .spd-val{ font-variant-numeric:tabular-nums; }
.spd-pos{ color:var(--sp-green); }
.spd-neg{ color:var(--sp-red); }

.spd-best{
  display:flex; align-items:center; gap:10px; padding:8px 11px;
  background:rgba(126,163,106,.14); border:1.5px solid rgba(126,163,106,.4); border-radius:13px;
}
.spd-best .spd-ico{ font-size:24px; }
.spd-best b{ font-size:12.5px; }
.spd-best div{ font-size:11px; font-weight:700; color:var(--sp-ink-soft); }

/* ---- tomorrow ----------------------------------------------------------- */
.spd-advice{
  display:flex; align-items:flex-start; gap:10px; padding:9px 12px;
  background:rgba(95,151,184,.13); border:1.5px solid rgba(95,151,184,.45);
  border-radius:13px;
}
.spd-advice .spd-ico{ font-size:20px; line-height:1.2; }
.spd-advice .spd-atxt{ flex:1; min-width:0; }
.spd-advice .spd-akick{
  font-size:10px; font-weight:800; letter-spacing:.12em; text-transform:uppercase;
  color:var(--sp-blue, #5f97b8); margin-bottom:2px;
}
.spd-advice .spd-abody{ font-size:12.5px; font-weight:800; line-height:1.45; }

.spd-flavour{
  font-size:12px; font-weight:700; font-style:italic; line-height:1.5;
  color:var(--sp-ink-soft); text-align:center; padding:2px 6px;
}
.spd-foot{ display:flex; justify-content:center; }
`;

function styleOnce() {
  injectStyles();
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

const FLAVOUR_GOOD = [
  'The rice tub is empty and the till is full. Sleep well.',
  'Somebody came back for a second plate today. That never stops being nice.',
  'The lanterns go out, the street goes quiet, the cat goes to bed.',
  'You wiped the counter twice out of pure contentment.',
];
const FLAVOUR_OK = [
  'A steady day. Nothing burned, nobody shouted.',
  'The kind of day that pays for itself and asks nothing more.',
  'Tomorrow the boats come in early. Set an alarm you will ignore.',
];
const FLAVOUR_BAD = [
  'A quiet one. Some days the street just walks past.',
  'Rough day. The knife is still sharp and so are you.',
  'Not every day is a good day. The rice will forgive you by morning.',
];

function pick(list, seed) {
  return list[Math.abs(Math.floor(seed)) % list.length];
}

const num = (a, b) => {
  const v = a != null ? a : b;
  return Number(v) || 0;
};

export function createDailySummary(game) {
  styleOnce();

  const id = 'daily';
  const state = game.state;
  const offs = [];

  let resolveOpen = null;
  let open = false;

  // ---- what the day actually looked like, gathered as it happens ---------
  // The DAY_END payload carries totals but not detail, so the two things the
  // advice really needs — which dish earned most, and what ran out — are
  // tallied here from the order and inventory events.
  let ledger = { byRecipe: Object.create(null), used: Object.create(null) };
  const resetLedger = () => { ledger = { byRecipe: Object.create(null), used: Object.create(null) }; };

  offs.push(game.bus.on(EV.ORDER_SERVED, (p) => {
    if (!p || !p.order) return;
    const rid = p.order.recipeId;
    if (!rid) return;
    const take = num(p.pay, 0) + num(p.tip, 0);
    const row = ledger.byRecipe[rid] || (ledger.byRecipe[rid] = { count: 0, earned: 0 });
    row.count += 1;
    row.earned += take;
  }));
  offs.push(game.bus.on(EV.ITEM_LOST, (p) => {
    if (!p || !p.id) return;
    ledger.used[p.id] = (ledger.used[p.id] || 0) + num(p.qty, 0);
  }));
  offs.push(game.bus.on(EV.DAY_START, resetLedger));

  // ------------------------------------------------------------------ shell
  const p = panel({
    id: 'sp-panel-daily',
    title: 'End of Day',
    sub: '',
    pos: {
      left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
      width: 'min(440px, 92vw)', maxHeight: '92vh', overflowY: 'auto',
    },
    onClose: () => game.panels.close(id),
  });
  p.root.setAttribute('role', 'dialog');
  p.root.setAttribute('aria-label', 'End of day summary');

  const body = el('div', 'spd-body');
  const dayLine = el('div', 'spd-day');
  const dayNum = el('b', null, 'Day 1');
  const daySub = el('span', null, '');
  dayLine.append(dayNum, daySub);

  const hero = el('div', 'spd-hero');
  const rows = el('div', 'spd-rows');
  const best = el('div', 'spd-best');
  const advice = el('div', 'spd-advice');
  const flavour = el('div', 'spd-flavour', '');
  const foot = el('div', 'spd-foot');
  const sleepBtn = button('Sleep until morning', { cls: 'sp-primary', icon: '🌙' });
  foot.append(sleepBtn);

  body.append(dayLine, hero, rows, best, advice, flavour, foot);
  p.body.append(body);

  function row(icon, label, value, tone) {
    const r = el('div', 'spd-row');
    r.append(el('span', 'spd-ico', icon));
    r.append(el('span', 'spd-lbl', label));
    r.append(el('span', `spd-val ${tone === 'pos' ? 'spd-pos' : tone === 'neg' ? 'spd-neg' : ''}`.trim(), value));
    return r;
  }

  // ------------------------------------------------------------ the advice
  /** Next shop tier the player has not bought yet, or null at the top. */
  function nextTier() {
    return SHOP_TIERS.find((t) => t.tier === state.shop.tier + 1) || null;
  }

  /** Cheapest upgrade they could buy this second, or null. */
  function affordableUpgrade() {
    let best2 = null;
    for (const u of UPGRADES) {
      const lvl = state.upgradeLevel(u.id);
      if (lvl >= u.maxLevel) continue;
      if (!upgradeUnlocked(u, state)) continue;
      const cost = upgradeCost(u, lvl);
      if (cost == null || cost > state.coins) continue;
      if (!best2 || cost < best2.cost) best2 = { upgrade: u, cost };
    }
    return best2;
  }

  /**
   * The ingredient the day most obviously ran short of: heavily used, and
   * finished at zero in the basket.
   */
  function ranOut() {
    let worst = null;
    for (const iid in ledger.used) {
      const used = ledger.used[iid];
      if (used < 2) continue;
      let left = 0;
      try { left = state.countItem(iid); } catch { left = 0; }
      if (left > 0) continue;
      if (!worst || used > worst.used) worst = { id: iid, used };
    }
    return worst;
  }

  /**
   * One sentence, chosen by a fixed priority ladder so the most actionable
   * problem always wins. Returns { icon, text }.
   */
  function adviceFor({ served, failed, net, day }) {
    // 1. Never opened the shop — nothing else matters yet.
    if (served === 0) {
      const b = bestCookableRecipe(state);
      return {
        icon: '🏮',
        text: b
          ? `You served nobody today. Cook a ${b.recipe.name} and open the shop at your counter — it clears ${money(b.profit)} a plate.`
          : 'You served nobody today. Buy rice and fish, cook a plate, then open the shop at your counter.',
      };
    }

    // 2. People walking out is the loudest fixable failure.
    if (failed >= 2) {
      return {
        icon: '⏳',
        text: `${failed} customers left before you served them — take fewer orders at once, or buy a Longer Counter so the queue waits happily.`,
      };
    }

    // 3. Running dry mid-service.
    const dry = ranOut();
    if (dry) {
      const ing = ingredient(dry.id);
      const buy = Math.max(2, Math.ceil(dry.used * 1.5));
      return {
        icon: '🧺',
        text: `You used all ${dry.used} of your ${ing ? ing.name.toLowerCase() : dry.id} and finished with none — buy ${buy} tomorrow.`,
      };
    }

    // 4. They can afford the shop upgrade. This is the one the player is
    //    most likely to have missed entirely.
    const nt = nextTier();
    if (nt && state.coins >= nt.cost && state.reputation >= nt.repReq) {
      return {
        icon: '🏗️',
        text: `You have ${money(state.coins)} — enough for the ${nt.name} (${money(nt.cost)}). Press U to upgrade: ${nt.seats} seats and a queue of ${nt.queue}.`,
      };
    }

    // 5. Close to it — tell them how much further.
    if (nt && state.reputation >= nt.repReq && state.coins >= nt.cost * 0.6) {
      return {
        icon: '🏗️',
        text: `${money(nt.cost - state.coins)} more and the ${nt.name} is yours. That is about ${Math.max(1, Math.ceil((nt.cost - state.coins) / Math.max(1, net || 1)))} more days like today.`,
      };
    }

    // 6. Losing money.
    if (net < 0) {
      const b = bestCookableRecipe(state);
      return {
        icon: '📉',
        text: b
          ? `You spent more than you earned. Stick to ${b.recipe.name} tomorrow — it costs ${money(b.cost)} and sells for ${money(b.sell)}.`
          : 'You spent more than you earned. Buy only what tomorrow\'s orders actually need.',
      };
    }

    // 7. A cheap upgrade they can already afford.
    const up = affordableUpgrade();
    if (up) {
      return {
        icon: '🔧',
        text: `${money(state.coins)} in the tin — ${money(up.cost)} of it buys ${up.upgrade.name}. Press U to see what it does.`,
      };
    }

    // 8. Nothing wrong: point at the money-maker.
    const b = bestCookableRecipe(state);
    if (b && b.profit > 0) {
      return {
        icon: '💡',
        text: `Your best margin is ${b.recipe.name}: ${money(b.cost)} of ingredients, ${money(b.sell)} on the plate. Buy for a few of those before opening.`,
      };
    }
    return { icon: '💤', text: `Day ${day + 1} starts in the morning. Buy fish early — the harbour auction is cheapest at dawn.` };
  }

  // ---------------------------------------------------------------- render
  function render(payload) {
    const s = (payload && payload.summary) || payload || {};
    const today = state.today || {};
    const day = s.day != null ? s.day : ((game.clock && game.clock.day) || (state.clock && state.clock.day) || 1);

    const earned = num(s.earned, today.earned);
    const spent = num(s.spent, today.spent);
    const served = num(s.served, today.served);
    const failed = num(s.failed, today.failed);
    const tips = num(s.tips, today.tips);
    const rep = num(s.rep != null ? s.rep : s.reputation, today.rep);
    const net = earned - spent;

    dayNum.textContent = `Day ${day}`;
    daySub.textContent = 'is over';
    p.setTitle('End of Day', `Day ${day}`);

    // Hero: profit.
    hero.textContent = '';
    hero.classList.toggle('spd-h-bad', net < 0);
    hero.append(el('span', 'spd-ico', net >= 0 ? '💰' : '📉'));
    const heroCol = el('div', 'sp-col');
    heroCol.append(el('div', 'spd-cap', net >= 0 ? 'Profit today' : 'Lost today'));
    heroCol.append(el('div', `spd-num ${net >= 0 ? 'spd-pos' : 'spd-neg'}`,
      `${net >= 0 ? '+' : '−'}${money(Math.abs(net))}`));
    hero.append(heroCol);
    const eq = el('div', 'spd-eq');
    eq.append(el('div', null, `${money(earned)} earned`));
    eq.append(el('div', null, `− ${money(spent)} spent`));
    hero.append(eq);

    // Supporting lines.
    rows.textContent = '';
    rows.append(row('🍽️', 'Customers served', String(served), served ? 'pos' : ''));
    rows.append(row('💔', 'Walked out', String(failed), failed ? 'neg' : ''));
    rows.append(row('🎁', 'Tips', money(tips), tips ? 'pos' : ''));
    rows.append(row('⭐', 'Reputation gained', `+${Math.round(rep * 10) / 10}`, rep ? 'pos' : ''));
    if (num(s.best, 0) > 0) rows.append(row('🧾', 'Biggest single ticket', money(s.best)));

    // Best dish of the day, from our own ledger; falls back to the recipe the
    // numbers say they SHOULD be cooking.
    best.textContent = '';
    let topId = null, topRow = null;
    for (const rid in ledger.byRecipe) {
      const r = ledger.byRecipe[rid];
      if (!topRow || r.earned > topRow.earned) { topRow = r; topId = rid; }
    }
    const rec = topId ? recipeById(topId) : null;
    best.append(el('span', 'spd-ico', rec ? rec.icon : '🍣'));
    const bcol = el('div', 'sp-col');
    if (rec && topRow) {
      bcol.append(el('b', null, `${rec.name} — ${money(topRow.earned)}`));
      const e = recipeEconomy(rec, state);
      bcol.append(el('div', null,
        `Best seller today · ${topRow.count} plate${topRow.count === 1 ? '' : 's'}${e && e.ok ? ` · ${money(e.profit)} profit each` : ''}`));
    } else {
      bcol.append(el('b', null, 'No dish of the day'));
      bcol.append(el('div', null, 'Nothing left the counter today.'));
    }
    best.append(bcol);

    // Tomorrow.
    advice.textContent = '';
    const a = adviceFor({ served, failed, net, day });
    advice.append(el('span', 'spd-ico', a.icon));
    const atxt = el('div', 'spd-atxt');
    atxt.append(el('div', 'spd-akick', 'For tomorrow'));
    atxt.append(el('div', 'spd-abody', a.text));
    advice.append(atxt);

    const list = net > 120 || served >= 6 ? FLAVOUR_GOOD : (net >= 0 ? FLAVOUR_OK : FLAVOUR_BAD);
    flavour.textContent = pick(list, day * 7 + served);
  }

  function finish() {
    if (!open) return;
    open = false;
    p.hide();
    const r = resolveOpen;
    resolveOpen = null;
    if (r) r({ slept: true });
  }

  sleepBtn.addEventListener('click', () => {
    // Route through the manager so mode/lock unwind exactly once.
    game.panels.close(id);
  });

  // ----------------------------------------------------------------- api
  const api = {
    id,
    open(payload) {
      render(payload);
      if (!open) {
        open = true;
        p.show();
        sleepBtn.focus();
      }
      return new Promise((resolve) => {
        // A second open() before the first resolved: settle the old one first.
        if (resolveOpen) resolveOpen({ slept: false });
        resolveOpen = resolve;
      });
    },
    close() {
      finish();
      // The day is banked — start the next one's ledger clean even if DAY_START
      // is late or never fires.
      resetLedger();
    },
    get isOpen() { return open; },
    destroy() {
      for (const un of offs) { try { un(); } catch { /* ignore */ } }
      offs.length = 0;
      if (resolveOpen) { resolveOpen({ slept: false }); resolveOpen = null; }
      p.destroy();
    },
  };

  game.panels.register(id, api);
  return api;
}
