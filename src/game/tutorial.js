// Day-one tutorial.
//
// Nine short steps that walk a brand-new player once around the core loop:
// move → meet your teacher → buy → come home → open → take → cook → serve →
// free play. Each step is DATA. The runner below only knows how to ask a step
// "are you done yet?", so adding, cutting or reordering steps is a data edit.
//
// Rules this file holds itself to:
//   · it never locks input, never opens a modal, never steals a key;
//   · it is skippable at any moment (the banner carries a Skip link, and the
//     settings panel has a "Play the tutorial" switch);
//   · progress lives in `state.data.flags`, so a reload resumes where you were;
//   · if a step's condition is already true when it starts, it auto-advances
//     (so a returning player is never told to do what they have already done).
//
// The current step is priority one for the guide (src/game/guide.js), which is
// what makes the banner, the ground arrows and the destination pin all point at
// the same thing.

import { EV } from './bus.js';
import * as UI from '../ui/kit.js';

// ---------------------------------------------------------------------------
// THE STEPS
// ---------------------------------------------------------------------------
//
// { id, title, hint, target, done(game, t), on?, reward?, teaches? }
//
//   target   a spec the guide knows how to resolve (see guide.resolve)
//   done     pure predicate; `t` exposes the runner's little scratchpad:
//              t.moved     units walked since this step started
//              t.elapsed   seconds this step has been showing
//              t.mark(k)   true if event mark `k` has fired since step start
//   on       events that should re-check `done` immediately
//   reward   { xp?, coins? } granted once, on completion
//   teaches  one line toasted when the step completes

export const TUTORIAL_STEPS = [
  {
    id: 'move',
    title: 'Stretch your legs',
    hint: 'Use WASD to walk. Hold Shift to run.',
    target: { kind: 'npc', id: 'master_kuro' },
    done: (game, t) => t.moved >= 8,
    teaches: 'The compass at the top right always points at your next stop.',
  },
  {
    id: 'meet_kuro',
    title: 'Meet Master Kuro',
    hint: 'Walk up to Master Kuro and press E.',
    target: { kind: 'npc', id: 'master_kuro' },
    on: [EV.INTERACT, EV.DIALOGUE, EV.QUEST_STARTED],
    done: (game, t) => t.mark('talked:master_kuro'),
    teaches: 'A gold ! over a cat means a job. A gold ? means they are waiting on you.',
  },
  {
    id: 'buy_supplies',
    title: 'Buy rice and salmon',
    hint: 'Press E at the stall. Buy 2 rice, 2 salmon.',
    target: { kind: 'item', id: 'rice' },
    on: [EV.INVENTORY, EV.ITEM_GAINED],
    done: (game) => game.state.countItem('rice') >= 2 && game.state.countItem('salmon') >= 2,
    teaches: 'Ingredients lose freshness through the day. Buy what you will cook.',
  },
  {
    id: 'back_to_shop',
    title: 'Go back to your shop',
    hint: 'Your counter is back on the plaza.',
    target: { kind: 'counter' },
    done: (game, t) => t.nearTarget(3.6),
  },
  {
    id: 'open_shop',
    title: 'Open the shop',
    hint: 'Press E on the sign by the door.',
    target: { kind: 'sign' },
    on: [EV.ORDER_NEW],
    done: (game) => !!(game.state.shop && game.state.shop.isOpen),
    teaches: 'Customers only arrive while you are open — and only inside trading hours.',
  },
  {
    id: 'take_order',
    title: 'Take an order',
    hint: 'Press E at the counter to pick an order.',
    target: { kind: 'counter' },
    on: [EV.COOK_START],
    done: (game, t) => t.mark('cookStart'),
  },
  {
    id: 'cook',
    title: 'Cook it',
    hint: 'Hit each prompt close to the mark.',
    target: { kind: 'counter' },
    on: [EV.COOK_DONE],
    done: (game, t) => t.mark('cookDone'),
    teaches: 'A better grade means a bigger tip and more reputation.',
  },
  {
    id: 'serve',
    title: 'Serve the customer',
    hint: 'Serve before their patience runs out.',
    target: { kind: 'counter' },
    on: [EV.ORDER_SERVED],
    done: (game, t) => t.mark('orderServed'),
    reward: { xp: 15 },
  },
  {
    id: 'free_play',
    title: 'That is the whole loop',
    hint: 'Buy, cook, serve, repeat. Journal is Q.',
    target: { kind: 'counter' },
    done: (game, t) => t.elapsed > 12,
    teaches: 'Q journal · I basket · R recipes · M map · Esc settings.',
  },
];

const FLAG_STEP = 'tutorial.step';
const FLAG_DONE = 'tutorial.done';
const FLAG_SKIPPED = 'tutorial.skipped';

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

export function createTutorial(game, guide) {
  const bus = game && game.bus;
  const state = game && game.state;
  if (!bus || !state) console.error('[tutorial] createTutorial needs game.bus and game.state');

  const offs = [];
  const marks = new Set();

  let index = -1;                 // -1 = not running
  let elapsed = 0;
  let moved = 0;
  let lastPos = null;
  let spendBase = 0;
  let lastServed = null;          // { pay, tip } for the step-8 receipt
  let disposed = false;
  let checking = false;

  // ------------------------------------------------------------ persistence
  const flag = (k) => { try { return !!state.flag(k); } catch { return false; } };
  const setFlag = (k, v) => { try { state.setFlag(k, v); } catch { /* ignore */ } };
  const flagValue = (k) => {
    try { return (state.data && state.data.flags) ? state.data.flags[k] : null; } catch { return null; }
  };

  function wanted() {
    // The settings switch is the master control; the flags say where we are.
    const s = state && state.settings;
    if (s && s.tutorial === false) return false;
    if (flag(FLAG_DONE) || flag(FLAG_SKIPPED)) return false;
    return true;
  }

  function indexOfId(id) {
    if (!id) return -1;
    return TUTORIAL_STEPS.findIndex((s) => s.id === id);
  }

  function persist() {
    const step = TUTORIAL_STEPS[index];
    setFlag(FLAG_STEP, step ? step.id : '');
  }

  // ------------------------------------------------------------- scratchpad
  const scratch = {
    get moved() { return moved; },
    get elapsed() { return elapsed; },
    mark: (k) => marks.has(k),
    /** Distance from the player to this step's resolved target. */
    nearTarget(r) {
      const step = TUTORIAL_STEPS[index];
      if (!step || !step.target || !guide || typeof guide.resolve !== 'function') return false;
      let at = null;
      try { at = guide.resolve(step.target); } catch { at = null; }
      const p = game.player && game.player.position;
      if (!at || !p) return false;
      return Math.hypot(num(p.x) - at.x, num(p.z) - at.z) <= (Number(r) || 3);
    },
  };

  // --------------------------------------------------------------- stepping
  function isDone(step) {
    if (!step || typeof step.done !== 'function') return true;
    try { return !!step.done(game, scratch); } catch (err) {
      console.warn(`[tutorial] step "${step.id}" threw while being checked`, err);
      return false;   // a broken predicate must not skip the step silently
    }
  }

  function enter(i, { autoAdvance = true } = {}) {
    index = i;
    elapsed = 0;
    moved = 0;
    marks.clear();
    lastPos = null;
    const step = TUTORIAL_STEPS[index];
    if (step && step.id === 'buy_supplies') spendBase = num(state.today && state.today.spent, 0);
    persist();
    if (guide && typeof guide.refresh === 'function') guide.refresh();
    // A step whose work is already done should never be shown at all.
    if (autoAdvance && step && isDone(step)) advance({ silent: true });
  }

  function reward(step) {
    const r = step && step.reward;
    if (!r) return;
    try {
      if (Number(r.xp)) state.addXp(Number(r.xp));
      if (Number(r.coins)) state.addCoins(Number(r.coins), 'tutorial');
    } catch (err) { console.warn('[tutorial] reward failed', err); }
  }

  function receipt() {
    // Step 8's promise: say plainly what came in and what it cost.
    if (!lastServed) return null;
    const pay = Math.round(num(lastServed.pay, 0));
    const tip = Math.round(num(lastServed.tip, 0));
    const spent = Math.max(0, Math.round(num(state.today && state.today.spent, 0) - spendBase));
    const profit = pay + tip - spent;
    return `+${pay}¢${tip ? ` and a ${tip}¢ tip` : ''} · ingredients cost ${spent}¢ · ${profit >= 0 ? 'profit' : 'loss'} ${Math.abs(profit)}¢`;
  }

  function advance({ silent = false } = {}) {
    const step = TUTORIAL_STEPS[index];
    if (step) {
      reward(step);
      if (!silent) {
        if (step.id === 'serve') {
          const line = receipt();
          if (line) UI.toast(line, { icon: '🧾', tone: 'good', ms: 4200 });
        }
        if (step.teaches) UI.toast(step.teaches, { icon: '💡', ms: 3600 });
        if (game.guideUI && typeof game.guideUI.flashDone === 'function') game.guideUI.flashDone();
      }
    }
    if (index >= TUTORIAL_STEPS.length - 1) { finish(); return; }
    enter(index + 1);
  }

  function finish() {
    index = -1;
    setFlag(FLAG_DONE, true);
    setFlag(FLAG_STEP, '');
    if (guide && typeof guide.refresh === 'function') guide.refresh();
  }

  function skip() {
    if (index < 0) return false;
    index = -1;
    setFlag(FLAG_SKIPPED, true);
    setFlag(FLAG_STEP, '');
    UI.toast('Tutorial skipped — you can replay it from Settings', { icon: '⏭️' });
    if (guide && typeof guide.refresh === 'function') guide.refresh();
    return true;
  }

  function restart() {
    setFlag(FLAG_DONE, false);
    setFlag(FLAG_SKIPPED, false);
    if (state.settings) state.settings.tutorial = true;
    enter(0, { autoAdvance: false });
    return true;
  }

  /** Re-read the flags (save load, settings toggle). */
  function syncFromState() {
    if (disposed) return;
    if (!wanted()) {
      if (index >= 0) { index = -1; if (guide && guide.refresh) guide.refresh(); }
      return;
    }
    let at = indexOfId(flagValue(FLAG_STEP));
    if (at < 0) at = 0;
    if (index === at) return;
    enter(at);
  }

  // ------------------------------------------------------------- bus wiring
  const on = (evt, cb) => {
    if (!bus) return;
    offs.push(bus.on(evt, (p) => {
      try { cb(p || {}); } catch (err) { console.warn(`[tutorial] handler for ${evt}`, err); }
    }));
  };

  on(EV.INTERACT, (p) => {
    const d = p.target || {};
    if (p.kind === 'npc') {
      const id = d.npcId || d.id || p.id;
      if (id) marks.add(`talked:${id}`);
    }
    check();
  });
  on(EV.DIALOGUE, (p) => { if (p.npcId) marks.add(`talked:${p.npcId}`); check(); });
  on(EV.COOK_START, () => { marks.add('cookStart'); check(); });
  on(EV.COOK_DONE, () => { marks.add('cookDone'); check(); });
  on(EV.ORDER_SERVED, (p) => {
    marks.add('orderServed');
    lastServed = { pay: num(p.pay, 0), tip: num(p.tip, 0) };
    check();
  });
  on(EV.INVENTORY, check);
  on(EV.ITEM_GAINED, check);
  on(EV.ORDER_NEW, check);
  on(EV.QUEST_STARTED, check);
  on(EV.LOAD, () => { marks.clear(); syncFromState(); });

  function check() {
    if (disposed || index < 0 || checking) return;
    checking = true;
    try {
      // A single event can satisfy several steps in a row (a returning player).
      let guard = 0;
      while (index >= 0 && guard++ < TUTORIAL_STEPS.length && isDone(TUTORIAL_STEPS[index])) {
        advance();
      }
    } finally {
      checking = false;
    }
  }

  // -------------------------------------------------------------- the frame
  function update(dt) {
    if (disposed || index < 0) return;
    const d = Math.max(0, Math.min(0.25, Number(dt) || 0));
    elapsed += d;

    const p = game.player && game.player.position;
    if (p) {
      if (lastPos) moved += Math.hypot(num(p.x) - lastPos.x, num(p.z) - lastPos.z);
      lastPos = { x: num(p.x), z: num(p.z) };
    }
    check();
  }

  // -------------------------------------------------------------------- api
  function guideStep() {
    const step = TUTORIAL_STEPS[index];
    if (!step) return null;
    return {
      id: step.id,
      title: step.title,
      hint: step.hint,
      target: step.target || null,
      teaches: step.teaches || null,
      index,
      count: TUTORIAL_STEPS.length,
    };
  }

  function destroy() {
    if (disposed) return;
    disposed = true;
    while (offs.length) { const off = offs.pop(); try { off(); } catch { /* ignore */ } }
    index = -1;
  }

  // Boot from whatever the flags already say.
  syncFromState();

  return {
    update, destroy,
    skip, restart, syncFromState, guideStep,
    check,
    get active() { return index >= 0; },
    get index() { return index; },
    get step() { return TUTORIAL_STEPS[index] || null; },
    get steps() { return TUTORIAL_STEPS.slice(); },
    get finished() { return flag(FLAG_DONE); },
    get skipped() { return flag(FLAG_SKIPPED); },
  };
}

export default createTutorial;
