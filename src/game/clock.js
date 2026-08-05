// The in-game clock.
//
// One real second is `24 / PROGRESSION.dayLengthSeconds` in-game hours. This is
// the only place that converts between the two, and it is the only writer of
// `state.clock`. Everything else reacts to EV.TIME / EV.PHASE / EV.DAY_START /
// EV.DAY_END.
//
// Implements the `game.clock` contract in CONTRACT.md exactly:
//   { day, hour, minute, phase, night, timeString,
//     set(day, hour), advance(hours), pause(v), paused, update(dt) }

import { EV } from './bus.js';
import { PROGRESSION } from '../data/progression.js';
import { ingredient } from '../data/ingredients.js';
import { isTypingInUI } from '../engine/inputGuard.js';

// ---------------------------------------------------------------------------
/** Phase bands, in order. Each runs [from, to) and they tile 0..24. */
const PHASES = [
  { id: 'night',   from: 0,  to: 5 },
  { id: 'morning', from: 5,  to: 11 },
  { id: 'day',     from: 11, to: 17 },
  { id: 'evening', from: 17, to: 21 },
  { id: 'night',   from: 21, to: 24 },
];

/** Day/night blend keyframes: fully day 8..17, fully night 21..5. */
// Dawn finishes before the 7:00 wake-up so day one opens in daylight, and
// dusk holds later so the evening service is warm rather than dark.
const NIGHT = { dawnStart: 4.5, dawnEnd: 6.8, duskStart: 18, duskEnd: 21 };

/** Debug: how many hours the N key skips. */
const DEBUG_SKIP_HOURS = 2;

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (t) => { const x = clamp01(t); return x * x * (3 - 2 * x); };
const wrap24 = (h) => ((h % 24) + 24) % 24;

function phaseAt(hour) {
  const h = wrap24(hour);
  for (const p of PHASES) if (h >= p.from && h < p.to) return p.id;
  return 'night';
}

/** 0 = broad daylight, 1 = full dark, smoothstepped across dawn and dusk. */
function nightAt(hour) {
  const h = wrap24(hour);
  if (h >= NIGHT.dawnEnd && h <= NIGHT.duskStart) return 0;            // full daylight
  if (h >= NIGHT.duskEnd || h < NIGHT.dawnStart) return 1;             // full dark
  if (h > NIGHT.duskStart && h < NIGHT.duskEnd) {                      // sundown
    return smoothstep((h - NIGHT.duskStart) / (NIGHT.duskEnd - NIGHT.duskStart));
  }
  // 5..8 sunrise
  return 1 - smoothstep((h - NIGHT.dawnStart) / (NIGHT.dawnEnd - NIGHT.dawnStart));
}

// ---------------------------------------------------------------------------
export function createClock(game) {
  const g = game || {};
  const bus = g.bus || { emit() {}, on() { return () => {}; } };
  const state = g.state;

  if (!state) console.warn('[clock] created without game.state — running detached');

  const dayLen = Math.max(1, num(PROGRESSION.dayLengthSeconds, 900));
  const HOURS_PER_SEC = 24 / dayLen;

  let day = Math.max(1, Math.round(num(state && state.clock && state.clock.day, 1)));
  let hourF = wrap24(num(state && state.clock && state.clock.hour, PROGRESSION.dayStartHour));
  let paused = false;

  let lastMinuteKey = -1;
  let lastPhase = phaseAt(hourF);

  const emit = (e, p) => { try { bus.emit(e, p); } catch (err) { console.error('[clock] emit', e, err); } };

  function writeState() {
    if (state && typeof state.setClock === 'function') state.setClock(day, hourF);
  }

  function minuteKey() {
    return day * 1440 + Math.floor(hourF * 60);
  }

  function tickSignals() {
    const key = minuteKey();
    if (key !== lastMinuteKey) {
      lastMinuteKey = key;
      emit(EV.TIME, {
        day, hour: Math.floor(hourF), minute: Math.floor((hourF % 1) * 60),
        phase: lastPhase, night: nightAt(hourF), timeString: timeString(),
      });
    }
    const p = phaseAt(hourF);
    if (p !== lastPhase) {
      const prev = lastPhase;
      lastPhase = p;
      emit(EV.PHASE, { phase: p, prev });
    }
  }

  // -------------------------------------------------------------- day rollover
  /** True when the player is broke AND holding nothing worth selling. */
  function needsBailout() {
    if (!state) return false;
    if (num(state.coins, 0) >= num(PROGRESSION.bailoutThreshold, 12)) return false;
    const inv = Array.isArray(state.inventory) ? state.inventory : [];
    for (const slot of inv) {
      if (!slot || num(slot.qty, 0) <= 0) continue;
      const ing = ingredient(slot.id);
      if (!ing) continue;
      if (num(ing.value, 0) > 0 || num(ing.price, 0) > 0) return false;
    }
    return true;
  }

  function rollover() {
    const finished = day;

    // 1. Close the books on the day that just ended.
    const today = (state && state.today) || {};
    const summary = {
      day: finished,
      earned: num(today.earned, 0),
      spent: num(today.spent, 0),
      served: num(today.served, 0),
      tips: num(today.tips, 0),
      rep: num(today.rep, 0),
    };
    emit(EV.DAY_END, { day: finished, summary });

    // 2. Advance.
    day += 1;
    if (state) {
      const stats = state.stats || {};
      stats.daysPlayed = num(stats.daysPlayed, 1) + 1;

      // Everything in the basket is a day older.
      if (typeof state.decayFreshness === 'function') state.decayFreshness(24);
      if (typeof state.resetToday === 'function') state.resetToday();

      // A night's sleep is a full stamina bar.
      if (typeof state.addStamina === 'function' && typeof state.staminaMax === 'function') {
        state.addStamina(state.staminaMax());
      }

      // Safety net: never let the player wake up unable to buy a bag of rice.
      if (needsBailout()) {
        const n = num(PROGRESSION.bailoutCoins, 25);
        if (n > 0 && typeof state.addCoins === 'function') {
          state.addCoins(n, 'bailout');
          emit(EV.TOAST, { text: `A neighbour left ${n}¢ on the counter`, icon: '🧧', tone: 'good' });
        }
      }
    }

    writeState();
    lastMinuteKey = -1;                 // force a fresh EV.TIME on the new day
    emit(EV.DAY_START, { day });
  }

  // ------------------------------------------------------------------ stepping
  /** Move the clock forward by `hours`, running every rollover on the way. */
  function step(hours) {
    let h = num(hours, 0);
    if (h <= 0) return;
    // Cap runaway steps (a tab that slept for an hour should not roll 100 days).
    if (h > 24 * 30) h = 24 * 30;

    let guard = 0;
    while (h > 0 && guard++ < 1000) {
      const toMidnight = 24 - hourF;
      if (h < toMidnight) { hourF += h; h = 0; }
      else { h -= toMidnight; hourF = 0; rollover(); }
    }
    hourF = wrap24(hourF);
    writeState();
    tickSignals();
  }

  function update(dt) {
    if (paused) return;
    const d = Math.max(0, Math.min(num(dt, 0), 0.5));
    if (d <= 0) return;
    step(d * HOURS_PER_SEC);
  }

  function advance(hours) {
    step(Math.max(0, num(hours, 0)));
  }

  /** Jump to an absolute point in time. Never fires rollovers. */
  function set(newDay, newHour) {
    const d = Math.max(1, Math.round(num(newDay, day)));
    const h = wrap24(num(newHour, hourF));
    const dayChanged = d !== day;
    day = d;
    hourF = h;
    writeState();
    lastMinuteKey = -1;
    const p = phaseAt(hourF);
    if (p !== lastPhase) { const prev = lastPhase; lastPhase = p; emit(EV.PHASE, { phase: p, prev }); }
    tickSignals();
    if (dayChanged) emit(EV.DAY_START, { day });
  }

  function pause(v = true) { paused = !!v; return paused; }

  function timeString() {
    const h = Math.floor(wrap24(hourF));
    const m = Math.floor((hourF % 1) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // --------------------------------------------------------------- debug key: N
  function onKey(e) {
    if (!e || e.repeat) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingInUI()) return;
    if (e.key !== 'n' && e.key !== 'N') return;
    e.preventDefault();
    advance(DEBUG_SKIP_HOURS);
    emit(EV.TOAST, { text: `Time skip → ${timeString()}`, icon: '⏩' });
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('keydown', onKey);
  }

  function dispose() {
    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('keydown', onKey);
    }
  }

  // Publish the opening state so listeners built after us are not blind.
  writeState();
  tickSignals();

  return {
    get day() { return day; },
    /** Whole hours 0..23, per the contract. `hourFloat` is the continuous one. */
    get hour() { return Math.floor(wrap24(hourF)); },
    get hourFloat() { return wrap24(hourF); },
    get minute() { return Math.floor((hourF % 1) * 60); },
    get phase() { return lastPhase; },
    get night() { return nightAt(hourF); },
    get timeString() { return timeString(); },
    set,
    advance,
    pause,
    get paused() { return paused; },
    update,
    dispose,
  };
}

export default createClock;
