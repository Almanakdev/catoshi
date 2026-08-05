// Cooking mini-game engine.
//
// Owns the rules, the clock and the scoring for one dish. Pixels and pointer
// input live in src/ui/cookingUI.js; this file never touches a DOM node except
// the single window key listener it installs for the duration of a session.
//
//   const cooking = createCooking(game);
//   const res = await cooking.start('salmon_nigiri', { orderId, rush });
//   // res === null  -> aborted, or the ingredients were not there
//
// Pacing contract: a session costs `recipeTime(recipe)` seconds of interaction
// (scaled by the cookSpeed upgrade) plus a fixed STEP_INTRO + STEP_VERDICT of
// feedback per step. A stock 3-step recipe therefore lands at 15s + 3 * 1.5s =
// 19.5s, and a fully upgraded kitchen floors it at exactly 15s — both inside
// the 15-40s band. The interaction budget is also the timeout for every step,
// so a player who does nothing at all still finishes in the same time.

import { EV } from './bus.js';
import { toast } from '../ui/kit.js';
import { createCookingUI } from '../ui/cookingUI.js';
import { recipe as findRecipe, STEPS, STEP_TYPES, recipeTime } from '../data/recipes.js';
import { PROGRESSION, gradeFor } from '../data/progression.js';
import { ingredient } from '../data/ingredients.js';

// --------------------------------------------------------------- constants

/** Feedback padding around each step's interaction, in seconds. */
const STEP_INTRO = 0.6;
const STEP_VERDICT = 0.9;

/** cookSpeed may never take a dish below 70% of its nominal length. */
const MIN_TIME_SCALE = 0.7;

/** Tired cats (0 stamina) lose their upgrades and 25% of every margin. */
const TIRED_SHRINK = 0.75;

/**
 * Final score weights.
 *
 *   steps      0.62   how well the player actually cooked
 *   quality    0.20   weighted quality of the ingredients consumed
 *   remaining  0.18   of which freshness takes PROGRESSION.freshnessQualityWeight
 *                     (0.25 -> 0.045) and the rest (0.135) is the flat credit
 *                     for having produced a dish at all.
 *
 * The four weights sum to exactly 1.0, so a flawless run on perfect
 * ingredients reads 1.0 with no rescaling, and a totally botched run on stock
 * 0.7-quality ingredients reads ~0.32 ("Poor") rather than a demoralising 0.
 */
const W_STEPS = 0.62;
const W_QUALITY = 0.20;
const W_REMAINDER = 0.18;
const W_FRESH = W_REMAINDER * PROGRESSION.freshnessQualityWeight;
const W_BASE = W_REMAINDER - W_FRESH;

/** Verdict vocabulary shown to the player. */
export const VERDICTS = {
  PERFECT: 'Perfect',
  GOOD: 'Good',
  OK: 'Acceptable',
  OVER: 'Overprepared',
  RUSHED: 'Rushed',
  MISSED: 'Missed',
  WRONG: 'Wrong ingredient',
  MISSING: 'Missing item',
};

const DIRS = ['left', 'right', 'up', 'down'];
const ARROW_KEY = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  a: 'left', d: 'right', w: 'up', s: 'down',
  A: 'left', D: 'right', W: 'up', S: 'down',
};
const STAPLES = new Set(['rice', 'nori', 'vinegar']);
const FILLER = ['wasabi', 'ginger', 'sesame', 'soy_sauce'];
const PLATE_ICONS = ['🍣', '🍥', '🍤', '🥑', '🟠', '🍋', '🌿', '🥒'];

/** Sentinel resolved by every pending interaction when the player bails out. */
const ABORTED = Symbol('cooking-aborted');

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => clamp(v, 0, 1);
const isSpace = (e) => e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar';

/** Score -> verdict. `over` disambiguates a miss: true = too late/too much. */
function verdictFor(score, over) {
  if (score >= 0.9) return VERDICTS.PERFECT;
  if (score >= 0.72) return VERDICTS.GOOD;
  if (score >= 0.45) return VERDICTS.OK;
  if (over === true) return VERDICTS.OVER;
  if (over === false) return VERDICTS.RUSHED;
  return VERDICTS.MISSED;
}

/** 1.0 at the centre of the zone, 0.55 at its edge, 0 well outside it. */
function zoneScoreFor(distance, half) {
  if (half <= 0) return 0;
  if (distance <= half) return 1 - 0.45 * Math.pow(distance / half, 1.35);
  return Math.max(0, 0.55 - 0.55 * ((distance - half) / (half * 1.6)));
}

export function createCooking(game) {
  const state = game.state;
  const bus = game.bus || { emit() {} };
  const EVT = game.EV || EV;
  const rng = typeof game.rng === 'function' ? game.rng : Math.random;
  const ui = createCookingUI(game);

  /** @type {null | object} the one in-flight cooking session */
  let session = null;
  let rafId = 0;
  let rafLast = 0;
  let lastExternalUpdate = 0;

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const pick = (arr) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];

  function shuffle(list) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  // ------------------------------------------------------------ frame pump
  //
  // The host loop drives us through update(dt). If it forgets — or the mode
  // switch happens on a frame the loop skips — a rAF fallback keeps the
  // mini-game moving so the player can never be stranded in a frozen step.

  function pump(dt) {
    if (!session) return;
    const d = clamp(dt, 0, 0.1);
    session.elapsed += d;
    if (session.tick) session.tick(d);
  }

  function update(dt) {
    lastExternalUpdate = now();
    pump(dt);
  }

  function rafStep(t) {
    if (!session) { rafId = 0; return; }
    const dt = rafLast ? (t - rafLast) / 1000 : 0;
    rafLast = t;
    if (now() - lastExternalUpdate > 250) pump(dt);
    rafId = requestAnimationFrame(rafStep);
  }

  function startPump() {
    lastExternalUpdate = now();
    rafLast = 0;
    if (typeof requestAnimationFrame === 'function' && !rafId) {
      rafId = requestAnimationFrame(rafStep);
    }
  }

  function stopPump() {
    if (rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
    rafId = 0;
  }

  // ------------------------------------------------------- async primitives

  /**
   * Runs one interruptible slice of gameplay.
   * `setup(ctx)` wires up callbacks and returns a `tick(dt)` function.
   * Resolves with whatever ctx.finish() was given, or ABORTED.
   */
  function interaction(setup) {
    return new Promise((resolve) => {
      if (!session || session.aborted) { resolve(ABORTED); return; }
      let done = false;
      const ctx = {
        get aborted() { return !session || session.aborted; },
        finish(value) {
          if (done) return;
          done = true;
          if (session) {
            session.tick = null;
            session.cancel = null;
            session.keyDown = null;
            session.keyUp = null;
          }
          resolve(value);
        },
      };
      let tick = null;
      try {
        tick = setup(ctx);
      } catch (err) {
        console.error('[cooking] step setup failed', err);
        ctx.finish(null);
        return;
      }
      if (done) return;                       // setup finished synchronously
      session.tick = (dt) => { if (!done && typeof tick === 'function') tick(dt); };
      session.cancel = () => ctx.finish(ABORTED);
    });
  }

  /** Abortable pause driven by the same clock as the mini-games. */
  function wait(seconds) {
    if (seconds <= 0) return Promise.resolve(null);
    return interaction((ctx) => {
      let t = 0;
      return (dt) => { t += dt; if (t >= seconds) ctx.finish(null); };
    });
  }

  // ---------------------------------------------------------------- helpers

  function currentMods() {
    const tired = state.stamina <= 0;
    const zoneUp = tired ? 0 : Math.max(0, state.upgradeValue('timingZone', 0));
    const sliceUp = tired ? 0 : Math.max(0, state.upgradeValue('sliceSpeed', 0));
    const shrink = tired ? TIRED_SHRINK : 1;
    return {
      tired,
      zoneScale: (1 + zoneUp) * shrink,
      windowScale: (1 + sliceUp) * shrink,
    };
  }

  /** Distinct ingredient chips for the drag step, toppings before staples. */
  function chipsFor(recipe, n) {
    const seen = new Set();
    const ids = [];
    const push = (id) => { if (id && !seen.has(id)) { seen.add(id); ids.push(id); } };
    for (const req of recipe.ingredients) if (!STAPLES.has(req.id)) push(req.id);
    for (const req of recipe.ingredients) push(req.id);
    for (const f of FILLER) { if (ids.length >= n) break; push(f); }
    return ids.slice(0, n).map((id) => {
      const ing = ingredient(id);
      return { id, icon: ing ? ing.icon : '🍚', name: ing ? ing.name : id };
    });
  }

  // ------------------------------------------------------------ step: timing
  async function playTiming(step, cfg, budget, mods) {
    const rounds = Math.max(1, Math.round(cfg.rounds || 1));
    const gap = 0.28;
    // Reserve the inter-round gaps so the step can never outrun its budget.
    const per = Math.max(0.8, (budget - gap * (rounds - 1)) / rounds);
    const width = clamp((cfg.zone || 0.22) * mods.zoneScale, 0.06, 0.7);
    const half = width / 2;
    const oneWay = clamp(0.9 / Math.max(0.2, cfg.speed || 1), 0.35, 2.5);
    const h = ui.timing.mount({ rounds });
    const scores = [];
    let lateCount = 0;
    let responded = 0;

    try {
      for (let r = 0; r < rounds; r++) {
        if (!session || session.aborted) return ABORTED;
        const span = 1 - width - 0.16;
        const centre = half + 0.08 + rng() * Math.max(0, span);
        h.setZone(centre - half, centre + half);
        ui.setPrompt(rounds > 1 ? `${step.label} — ${r + 1}/${rounds}` : step.label);

        const outcome = await interaction((ctx) => {
          let t = 0;
          let pos = 0;
          const press = () => {
            const d = Math.abs(pos - centre);
            ctx.finish({ score: zoneScoreFor(d, half), over: pos > centre, pos });
          };
          session.keyDown = (e) => { if (isSpace(e) || e.key === 'Enter') { e.preventDefault(); press(); } };
          h.onPress(press);
          return (dt) => {
            t += dt;
            const phase = (t % (oneWay * 2)) / oneWay;
            pos = phase <= 1 ? phase : 2 - phase;
            h.setMarker(pos);
            if (t >= per) ctx.finish(null);       // ran out of track: a miss
          };
        });
        if (outcome === ABORTED) return ABORTED;

        const score = outcome ? outcome.score : 0;
        const over = outcome ? outcome.over : null;
        if (outcome) responded++;
        if (over) lateCount++;
        scores.push(score);
        h.flash(score >= 0.9 ? 'perfect' : score >= 0.45 ? 'good' : 'bad');
        if (h.markRound) h.markRound(r, score >= 0.45 ? 'ok' : 'bad');
        if (r < rounds - 1 && (await wait(gap)) === ABORTED) return ABORTED;
      }
    } finally {
      h.destroy();
    }

    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    // Never pressing is a miss; pressing badly is Rushed or Overprepared.
    if (responded === 0) return { score: 0, verdict: VERDICTS.MISSED };
    return { score: mean, verdict: verdictFor(mean, lateCount * 2 >= scores.length) };
  }

  // -------------------------------------------------------------- step: hold
  async function playHold(step, cfg, budget, mods, timeScale) {
    const target = Math.max(0.25, (cfg.target || 1.2) * timeScale);
    const tol = Math.max(0.08, (cfg.tolerance || 0.3) * mods.zoneScale);
    const full = Math.max(target * 2, target + tol * 1.6);   // bar range
    const h = ui.hold.mount({});
    h.setTarget(target / full);
    h.setTolerance(tol / full);

    try {
      const outcome = await interaction((ctx) => {
        let total = 0;
        let held = 0;
        let holding = false;
        const grab = () => { if (!holding) { holding = true; held = 0; } };
        const release = () => {
          if (!holding) return;
          holding = false;
          ctx.finish({ held });
        };
        session.keyDown = (e) => { if (isSpace(e) && !e.repeat) { e.preventDefault(); grab(); } };
        session.keyUp = (e) => { if (isSpace(e)) { e.preventDefault(); release(); } };
        h.onHoldStart(grab);
        h.onHoldEnd(release);
        return (dt) => {
          total += dt;
          if (holding) {
            held += dt;
            h.setFill(held / full);
            if (held >= full) { release(); return; }   // pan is on fire; stop for them
          }
          // The budget is a hard wall: dithering eats the hold you had left.
          if (total >= budget) {
            if (holding) release();
            else ctx.finish(null);
          }
        };
      });
      if (outcome === ABORTED) return ABORTED;

      if (!outcome) { h.flash('bad'); return { score: 0, verdict: VERDICTS.MISSED }; }
      const err = outcome.held - target;
      const a = Math.abs(err);
      const score = a <= tol
        ? 1 - 0.42 * Math.pow(a / tol, 1.3)
        : Math.max(0, 0.58 - 0.58 * ((a - tol) / (tol * 2.2)));
      h.flash(score >= 0.9 ? 'perfect' : score >= 0.45 ? 'good' : 'bad');
      return { score, verdict: verdictFor(score, err > 0) };
    } finally {
      h.destroy();
    }
  }

  // ------------------------------------------------------------- step: slice
  async function playSlice(step, cfg, budget, mods) {
    const strokes = Math.max(1, Math.round(cfg.strokes || 3));
    const gap = 0.12;
    // Reserve the between-stroke beats so upgraded windows can't overrun.
    const usable = Math.max(0.4, budget - 0.2 - gap * strokes);
    const win = Math.max(0.3, Math.min((cfg.window || 1) * mods.windowScale, usable / strokes));
    const h = ui.slice.mount({ strokes });
    const scores = [];
    let missedAll = true;

    try {
      for (let i = 0; i < strokes; i++) {
        if (!session || session.aborted) return ABORTED;
        const dir = pick(DIRS);
        h.setArrow(dir);
        h.setTimer(1);
        ui.setPrompt(`${step.label} — ${i + 1}/${strokes}`);

        const outcome = await interaction((ctx) => {
          let t = 0;
          const stroke = (d) => {
            const speed = 1 - 0.55 * clamp01(t / win);
            ctx.finish(d === dir ? { score: clamp(speed, 0.45, 1), ok: true } : { score: 0.2, ok: false });
          };
          session.keyDown = (e) => {
            const d = ARROW_KEY[e.key];
            if (!d) return;
            e.preventDefault();
            stroke(d);
          };
          h.onSwipe(stroke);
          return (dt) => {
            t += dt;
            h.setTimer(1 - clamp01(t / win));
            if (t >= win) ctx.finish(null);
          };
        });
        if (outcome === ABORTED) return ABORTED;

        const score = outcome ? outcome.score : 0;
        if (outcome) missedAll = false;
        scores.push(score);
        h.hit(!!(outcome && outcome.ok));
        if ((await wait(gap)) === ABORTED) return ABORTED;
      }
    } finally {
      h.destroy();
    }

    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (missedAll) return { score: 0, verdict: VERDICTS.MISSED };
    return { score: mean, verdict: verdictFor(mean, false) };
  }

  // -------------------------------------------------------------- step: drag
  async function playDrag(step, cfg, budget, recipe) {
    const n = Math.max(1, Math.round(cfg.slots || 2));
    const chips = chipsFor(recipe, n);
    const wanted = shuffle(chips);
    const slots = wanted.map((c, i) => ({ id: `slot${i}`, icon: '', name: c.name, accepts: c.id }));
    const h = ui.drag.mount({ slots: n });
    h.setSlots(slots);
    h.setChips(shuffle(chips));

    const results = [];
    try {
      const outcome = await interaction((ctx) => {
        let t = 0;
        h.onPlace((chipId, slotId) => {
          const slot = slots.find((s) => s.id === slotId);
          if (!slot) return;
          const ok = slot.accepts === chipId;
          h.mark(slotId, ok);
          results.push({ score: ok ? 1 : 0.35, ok });
          if (results.length >= slots.length) ctx.finish(true);
        });
        return (dt) => {
          t += dt;
          if (t >= budget) ctx.finish(false);
        };
      });
      if (outcome === ABORTED) return ABORTED;
    } finally {
      h.destroy();
    }

    const placed = results.length;
    for (let i = placed; i < slots.length; i++) results.push({ score: 0, ok: false, missed: true });
    const mean = results.reduce((a, b) => a + b.score, 0) / results.length;
    if (placed === 0) return { score: 0, verdict: VERDICTS.MISSED };
    const anyWrong = results.some((r) => !r.ok && !r.missed);
    const anyMissed = results.some((r) => r.missed);
    return {
      score: mean,
      verdict: mean >= 0.9 ? VERDICTS.PERFECT
        : anyMissed && mean < 0.45 ? VERDICTS.MISSED
          : anyWrong && mean < 0.72 ? VERDICTS.WRONG
            : verdictFor(mean, false),
    };
  }

  // -------------------------------------------------------------- step: roll
  async function playRoll(step, cfg, budget, mods) {
    const beats = Math.max(1, Math.round(cfg.beats || 4));
    const win = Math.max(0.08, (cfg.window || 0.2) * mods.zoneScale);
    const lead = Math.min(0.8, budget * 0.18);
    const tail = win + 0.15;
    // The whole metronome, tail included, has to fit inside the step budget.
    const interval = Math.max(win * 2.2, (budget - lead - tail) / beats);
    const h = ui.roll.mount({ beats });
    const scores = new Array(beats).fill(null);
    let strays = 0;

    try {
      const outcome = await interaction((ctx) => {
        let t = 0;
        let announced = -1;

        const settle = (i, score) => {
          if (scores[i] != null) return;
          scores[i] = score;
          h.hit(score >= 0.45, i);
          if (scores.every((s) => s != null)) ctx.finish(true);
        };

        const tap = () => {
          // Match the tap to the nearest beat that has not been settled yet.
          let best = -1, bestD = Infinity;
          for (let i = 0; i < beats; i++) {
            if (scores[i] != null) continue;
            const d = Math.abs(t - (lead + i * interval));
            if (d < bestD) { bestD = d; best = i; }
          }
          if (best < 0) return;
          if (bestD > win * 1.5) { strays++; h.hit(false); return; }   // mashing, not rolling
          settle(best, Math.max(0.15, 1 - 0.55 * (bestD / win)));
        };

        session.keyDown = (e) => { if (isSpace(e) && !e.repeat) { e.preventDefault(); tap(); } };
        h.onTap(tap);

        return (dt) => {
          t += dt;
          if (t >= lead) {
            const idx = Math.floor((t - lead) / interval);
            if (idx < beats && idx !== announced) {
              announced = idx;
              h.setBeat(idx, beats);
              h.pulse();
            }
          }
          for (let i = 0; i < beats; i++) {
            if (scores[i] == null && t > lead + i * interval + win) settle(i, 0);
          }
          if (t >= lead + beats * interval + tail) ctx.finish(false);
        };
      });
      if (outcome === ABORTED) return ABORTED;
    } finally {
      h.destroy();
    }

    const filled = scores.map((s) => (s == null ? 0 : s));
    const raw = filled.reduce((a, b) => a + b, 0) / filled.length;
    const mean = clamp01(raw - Math.min(0.2, strays * 0.04));   // mashing costs a little
    if (mean <= 0) return { score: 0, verdict: VERDICTS.MISSED };
    return { score: mean, verdict: verdictFor(mean, false) };
  }

  // ----------------------------------------------------------- step: arrange
  async function playArrange(step, cfg, budget, timeScale) {
    const count = clamp(Math.round(cfg.pieces || 4), 2, 6);
    const pieces = PLATE_ICONS.slice(0, count)
      .map((icon, i) => ({ id: `p${i}`, icon, name: `Piece ${i + 1}` }));
    const order = shuffle(pieces).map((p) => p.id);
    const showFor = Math.max(1.0, 1.5 * timeScale);
    const h = ui.arrange.mount({ pieces: count });
    h.setPieces(pieces);
    h.showPattern(order);

    const scores = [];
    try {
      ui.setPrompt('Remember the order…');
      const memo = await wait(showFor);
      if (memo === ABORTED) return ABORTED;
      h.hidePattern();
      ui.setPrompt(step.label);

      const outcome = await interaction((ctx) => {
        let t = 0;
        let k = 0;
        h.onPick((id) => {
          if (k >= order.length) return;
          const ok = id === order[k];
          scores.push(ok ? 1 : 0.3);
          h.mark(k, ok, id);
          k++;
          if (k >= order.length) ctx.finish(true);
        });
        return (dt) => {
          t += dt;
          if (t >= budget - showFor) ctx.finish(false);
        };
      });
      if (outcome === ABORTED) return ABORTED;
    } finally {
      h.destroy();
    }

    const picked = scores.length;
    while (scores.length < order.length) scores.push(0);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (picked === 0) return { score: 0, verdict: VERDICTS.MISSED };
    return { score: mean, verdict: mean < 0.45 ? VERDICTS.MISSED : verdictFor(mean, false) };
  }

  // ----------------------------------------------------------- step router
  async function playStep(stepId, budget, timeScale, recipe) {
    const step = STEPS[stepId];
    if (!step) return { score: 0.5, verdict: VERDICTS.OK };
    const type = STEP_TYPES[step.type] ? step.type : 'timing';
    const cfg = step.cfg || {};
    const mods = currentMods();

    ui.setPrompt(step.label);
    ui.setHint(mods.tired ? `${STEP_TYPES[type].hint} — your paws are shaking` : STEP_TYPES[type].hint);

    switch (type) {
      case 'timing':  return playTiming(step, cfg, budget, mods);
      case 'hold':    return playHold(step, cfg, budget, mods, timeScale);
      case 'slice':   return playSlice(step, cfg, budget, mods);
      case 'drag':    return playDrag(step, cfg, budget, recipe);
      case 'roll':    return playRoll(step, cfg, budget, mods);
      case 'arrange': return playArrange(step, cfg, budget, timeScale);
      default:        return { score: 0.5, verdict: VERDICTS.OK };
    }
  }

  // ------------------------------------------------------------------ start
  /**
   * Accepts either `start('salmon_nigiri', { orderId })` or the object form
   * `start({ recipeId, orderId, qty, rush })` that the restaurant uses.
   */
  async function start(recipeId, opts = {}) {
    if (recipeId && typeof recipeId === 'object') {
      opts = recipeId;
      recipeId = opts.recipeId || opts.recipe || null;
    }
    const { orderId = null, rush = false } = opts || {};
    if (session) {
      toast('Already cooking', { icon: '🍳', tone: 'bad' });
      return null;
    }

    const recipe = findRecipe(recipeId);
    if (!recipe) {
      console.warn('[cooking] unknown recipe', recipeId);
      toast(`${VERDICTS.MISSING}: unknown recipe`, { icon: '📖', tone: 'bad' });
      return null;
    }
    if (!state.knowsRecipe(recipe.id)) {
      toast(`You haven't learned ${recipe.name} yet`, { icon: '📖', tone: 'bad' });
      return null;
    }
    if (!state.hasItems(recipe.ingredients)) {
      const short = recipe.ingredients
        .filter((req) => state.countItem(req.id) < (req.qty || 1))
        .map((req) => {
          const ing = ingredient(req.id);
          return ing ? ing.name : req.id;
        });
      toast(`${VERDICTS.MISSING}: ${short.join(', ')}`, { icon: '🧺', tone: 'bad' });
      return null;
    }

    // ---- consume up front, remembering exactly what we took so abort refunds
    const consumed = [];
    let qAcc = 0, fAcc = 0, qty = 0;
    for (const req of recipe.ingredients) {
      const need = req.qty || 1;
      const got = state.removeItem(req.id, need);
      if (got.taken > 0) {
        consumed.push({ id: req.id, qty: got.taken, quality: got.quality, freshness: got.freshness });
        qAcc += got.quality * got.taken;
        fAcc += got.freshness * got.taken;
        qty += got.taken;
      }
    }
    const ingQuality = qty ? clamp01(qAcc / qty) : 0;
    const freshness = qty ? clamp01(fAcc / qty) : 0;

    const timeScale = clamp(1 - Math.max(0, state.upgradeValue('cookSpeed', 0)), MIN_TIME_SCALE, 1);
    const prepQuality = Math.max(0, state.upgradeValue('prepQuality', 0));
    const introPause = rush ? STEP_INTRO * 0.5 : STEP_INTRO;
    const verdictPause = rush ? STEP_VERDICT * 0.5 : STEP_VERDICT;

    session = {
      recipeId: recipe.id, orderId, rush, consumed,
      aborted: false, elapsed: 0,
      tick: null, cancel: null, keyDown: null, keyUp: null,
    };

    const onKeyDown = (e) => {
      if (!session) return;
      if (e.key === 'Escape') { e.preventDefault(); abort(); return; }
      if (session.keyDown) session.keyDown(e);
    };
    const onKeyUp = (e) => {
      if (!session || !session.keyUp) return;
      session.keyUp(e);
    };
    const onBlur = () => { if (session && session.keyUp) session.keyUp({ code: 'Space', key: ' ', preventDefault() {} }); };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    let result = null;
    try {
      if (game.setMode) game.setMode('cooking');
      if (game.player && game.player.lock) game.player.lock(true);
      ui.show(recipe);
      bus.emit(EVT.COOK_START, { recipeId: recipe.id, orderId, rush });
      startPump();

      const steps = recipe.steps || [];
      const nominal = recipeTime(recipe) || steps.length * 4;
      const stepScores = [];
      const t0 = session.elapsed;

      for (let i = 0; i < steps.length; i++) {
        if (session.aborted) break;
        const stepId = steps[i];
        const step = STEPS[stepId] || { id: stepId, label: stepId, icon: '•', secs: 4, type: 'timing', cfg: {} };
        const budget = Math.max(1.2, (step.secs || 4) * timeScale);

        ui.setStep(i, steps.length, step);
        ui.progress(i / steps.length);

        // Every action costs the cat something, tired or not.
        state.addStamina(-PROGRESSION.staminaCookPerAction);

        if ((await wait(introPause)) === ABORTED) break;
        const out = await playStep(stepId, budget, timeScale, recipe);
        if (out === ABORTED || session.aborted) break;

        const score = clamp01(out.score);
        const verdict = out.verdict || verdictFor(score, null);
        stepScores.push({
          stepId, score, verdict,
          label: step.label, icon: step.icon, weight: step.secs || 4,
        });
        ui.verdict(verdict, gradeFor(score));
        ui.progress((i + 1) / steps.length);
        if ((await wait(verdictPause)) === ABORTED) break;
      }

      if (session.aborted || stepScores.length < steps.length) {
        refund(consumed);
        return null;
      }

      // ---- score
      let wSum = 0, sSum = 0;
      for (const s of stepScores) { wSum += s.weight; sSum += s.score * s.weight; }
      const stepMean = wSum ? sSum / wSum : 0;
      const score = clamp01(
        W_STEPS * stepMean +
        W_QUALITY * ingQuality +
        W_FRESH * freshness +
        W_BASE +
        prepQuality,
      );
      const grade = gradeFor(score);
      const perfect = grade.id === 'perfect' && stepScores.every((s) => s.score >= 0.9);
      const seconds = Math.max(0, session.elapsed - t0);

      result = {
        recipeId: recipe.id,
        orderId,
        score,
        grade,
        stepScores: stepScores.map((s) => ({
          stepId: s.stepId, score: s.score, verdict: s.verdict, label: s.label, icon: s.icon,
        })),
        consumed: consumed.map((c) => ({ id: c.id, qty: c.qty })),
        seconds,
        perfect,
        ingredientQuality: ingQuality,
        freshness,
        nominalSeconds: nominal,
      };

      ui.setPrompt('');
      ui.setHint('');
      ui.progress(1);
      bus.emit(EVT.COOK_DONE, {
        recipeId: recipe.id, orderId, score, quality: score, grade: grade.id, perfect,
      });

      // The summary card is the one place the player, not the clock, decides.
      // abort() dismisses it for us if something external cuts the session off.
      session.awaitingResult = true;
      await ui.result({ ...result, autoMs: rush ? 1400 : 0 });
      return result;
    } catch (err) {
      console.error('[cooking] session failed', err);
      refund(consumed);
      return null;
    } finally {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      stopPump();
      session = null;
      ui.hide();
      if (game.player && game.player.lock) game.player.lock(false);
      if (game.setMode) game.setMode('explore');
    }
  }

  function refund(consumed) {
    for (const c of consumed) {
      try {
        state.addItem(c.id, c.qty, { quality: c.quality, freshness: c.freshness });
      } catch (err) {
        console.error('[cooking] refund failed for', c.id, err);
      }
    }
    if (consumed.length) toast('Ingredients back in the basket', { icon: '🧺' });
  }

  function abort() {
    if (!session || session.aborted) return;
    session.aborted = true;
    const cancel = session.cancel;
    const awaitingResult = session.awaitingResult;
    session.tick = null;
    session.cancel = null;
    session.keyDown = null;
    session.keyUp = null;
    if (cancel) cancel();
    // Nothing else can settle the summary card's promise, so tear it down.
    if (awaitingResult) ui.hide();
  }

  function destroy() {
    abort();
    stopPump();
    ui.destroy();
  }

  return {
    id: 'cooking',
    start,
    abort,
    update,
    destroy,
    get active() { return !!session; },
    get ui() { return ui; },
  };
}
