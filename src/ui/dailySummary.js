// End-of-day card.
//
// `open()` returns a promise that resolves when the player presses "Sleep until
// morning", so the day-rollover system can simply `await`. The promise always
// resolves — closing the panel by ✕ or Esc counts as sleeping, because leaving
// the player stuck at midnight with no card is worse than a slightly cheap exit.

import { injectStyles, el, panel, button, money } from './kit.js';
import { RECIPES } from '../data/recipes.js';

const STYLE_ID = 'sp-daily-style';

const CSS = `
.spd-body{ display:flex; flex-direction:column; gap:10px; }
.spd-day{ display:flex; align-items:baseline; gap:8px; }
.spd-day b{ font-size:24px; color:var(--sp-red); }
.spd-day span{ font-size:12px; font-weight:800; color:var(--sp-ink-soft); }

.spd-rows{ display:flex; flex-direction:column; gap:5px; }
.spd-row{
  display:flex; align-items:center; gap:9px; font-size:13px; font-weight:800;
  background:rgba(255,255,255,.55); border:1.5px solid rgba(59,47,38,.1);
  border-radius:11px; padding:6px 10px;
}
.spd-row .spd-ico{ width:20px; text-align:center; flex:0 0 20px; font-size:15px; }
.spd-row .spd-lbl{ flex:1; }
.spd-row .spd-val{ font-variant-numeric:tabular-nums; }
.spd-pos{ color:var(--sp-green); }
.spd-neg{ color:var(--sp-red); }
.spd-net{ background:rgba(240,185,63,.16); border-color:rgba(240,185,63,.5); }

.spd-best{
  display:flex; align-items:center; gap:10px; padding:9px 11px;
  background:rgba(126,163,106,.14); border:1.5px solid rgba(126,163,106,.4); border-radius:13px;
}
.spd-best .spd-ico{ font-size:26px; }
.spd-best b{ font-size:13px; }
.spd-best div{ font-size:11px; font-weight:700; color:var(--sp-ink-soft); }

.spd-flavour{
  font-size:12.5px; font-weight:700; font-style:italic; line-height:1.5;
  color:var(--sp-ink-soft); text-align:center; padding:4px 6px;
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
  'A good day. The lanterns go out, the street goes quiet, the cat goes to bed.',
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
  const i = Math.abs(Math.floor(seed)) % list.length;
  return list[i];
}

export function createDailySummary(game) {
  styleOnce();

  const id = 'daily';
  const state = game.state;

  let resolveOpen = null;
  let open = false;

  const p = panel({
    id: 'sp-panel-daily',
    title: 'End of Day',
    sub: '',
    pos: {
      left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
      width: 'min(430px, 92vw)',
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

  const rows = el('div', 'spd-rows');
  const best = el('div', 'spd-best');
  const flavour = el('div', 'spd-flavour', '');
  const foot = el('div', 'spd-foot');
  const sleepBtn = button('Sleep until morning', { cls: 'sp-primary', icon: '🌙' });
  foot.append(sleepBtn);

  body.append(dayLine, rows, best, flavour, foot);
  p.body.append(body);

  function row(icon, label, value, tone) {
    const r = el('div', `spd-row ${tone === 'net' ? 'spd-net' : ''}`.trim());
    r.append(el('span', 'spd-ico', icon));
    r.append(el('span', 'spd-lbl', label));
    const v = el('span', `spd-val ${tone === 'pos' ? 'spd-pos' : tone === 'neg' ? 'spd-neg' : ''}`.trim(), value);
    r.append(v);
    return r;
  }

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

    rows.textContent = '';
    rows.append(row('💰', 'Coins earned', `+${money(earned)}`, earned ? 'pos' : ''));
    rows.append(row('🧾', 'Coins spent', `-${money(spent)}`, spent ? 'neg' : ''));
    rows.append(row('⚖️', 'Net', `${net >= 0 ? '+' : '−'}${money(Math.abs(net))}`, 'net'));
    rows.append(row('🍽️', 'Customers served', String(served)));
    rows.append(row('💔', 'Walked out', String(failed), failed ? 'neg' : ''));
    rows.append(row('🎁', 'Tips', money(tips), tips ? 'pos' : ''));
    rows.append(row('⭐', 'Reputation gained', `+${Math.round(rep * 10) / 10}`, rep ? 'pos' : ''));

    // Best dish
    best.textContent = '';
    const bestId = s.bestDish || s.best || null;
    const rec = bestId ? RECIPES.find((r) => r.id === bestId || r.name === bestId) : null;
    best.append(el('span', 'spd-ico', rec ? rec.icon : '🍣'));
    const bcol = el('div', 'sp-col');
    bcol.append(el('b', null, rec ? rec.name : (bestId || 'No standout dish')));
    bcol.append(el('div', null, rec ? 'Dish of the day' : 'Tomorrow, then.'));
    best.append(bcol);

    const list = net > 120 || served >= 6 ? FLAVOUR_GOOD : (net >= 0 ? FLAVOUR_OK : FLAVOUR_BAD);
    flavour.textContent = pick(list, day * 7 + served);
  }

  function num(a, b) {
    const v = a != null ? a : b;
    return Number(v) || 0;
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
    close() { finish(); },
    get isOpen() { return open; },
    destroy() {
      if (resolveOpen) { resolveOpen({ slept: false }); resolveOpen = null; }
      p.destroy();
    },
  };

  game.panels.register(id, api);
  return api;
}
