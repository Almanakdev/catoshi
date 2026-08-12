// Cooking mini-game — the visual layer.
//
// This module owns pixels and pointer input; src/game/cooking.js owns rules,
// scoring and the clock. The engine calls `mount()` for whichever STEP_TYPE it
// is about to play, drives the returned handle every frame, and listens to the
// handle's `on*` callbacks for anything the player does with a mouse or finger.
// Keyboard input for the "one key" steps (timing / hold / slice / roll) stays
// with the engine so there is exactly one Space handler in the whole game; the
// two selection steps (drag / arrange) own their own keys because the selection
// state lives here.
//
// Everything visible is built from src/ui/kit.js primitives. The extra <style>
// block below only adds the parts the kit has no vocabulary for — tracks,
// chips, beat markers — and it reads the kit's CSS custom properties instead of
// inventing a second palette.

import { el, panel, button, bar, badge, scrim, THEME, injectStyles } from './kit.js';
import { QUALITY_GRADES } from '../data/progression.js';
import { IS_TOUCH } from '../engine/device.js';

const CSS = `
.ck-stage{
  left:50%; top:50%; transform:translate(-50%,-50%);
  width:min(860px, 94vw); max-height:94vh;
  z-index:40; padding:14px 16px 16px;
  display:flex; flex-direction:column;
}
.ck-stage .sp-head{ margin-bottom:6px; }
.ck-scrim{ z-index:39; }

.ck-top{ display:flex; align-items:center; gap:10px; margin-bottom:8px; }
.ck-dish{ font-size:clamp(20px,3.4vmin,28px); line-height:1; }
.ck-dishname{ font-size:clamp(14px,2.2vmin,18px); font-weight:900; color:var(--sp-ink); }
.ck-steplabel{ font-size:12px; color:var(--sp-ink-soft); font-weight:800; }
.ck-progress{ flex:1; min-width:70px; }

.ck-dots{ display:flex; gap:6px; align-items:center; flex-wrap:wrap; margin-bottom:8px; }
.ck-dot{
  display:flex; align-items:center; gap:5px;
  border-radius:999px; padding:3px 9px; font-size:11px; font-weight:800;
  background:rgba(255,255,255,.5); border:1.5px solid rgba(59,47,38,.12);
  color:var(--sp-ink-soft); white-space:nowrap;
}
.ck-dot.on{ background:#fff; border-color:var(--sp-red); color:var(--sp-ink); box-shadow:0 0 0 2px rgba(200,80,63,.16); }
.ck-dot.done{ background:rgba(126,163,106,.18); border-color:rgba(126,163,106,.55); color:var(--sp-ink); }

.ck-prompt{
  text-align:center; font-size:clamp(15px,2.6vmin,21px); font-weight:900;
  color:var(--sp-ink); min-height:1.4em; letter-spacing:.01em;
}
.ck-hint{ text-align:center; font-size:12px; font-weight:700; color:var(--sp-ink-soft); min-height:1.2em; margin-top:2px; }
.ck-hint kbd{
  display:inline-block; background:var(--sp-ink); color:var(--sp-cream);
  border-radius:6px; padding:0 6px; margin:0 3px; font-family:inherit; font-size:11px;
}

.ck-arena{
  position:relative; margin:10px 0 4px;
  min-height:clamp(150px, 28vh, 240px);
  display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:10px; padding:12px;
  background:radial-gradient(120% 90% at 50% 0%, rgba(255,255,255,.72), rgba(255,255,255,.34));
  border:2px dashed rgba(59,47,38,.14); border-radius:var(--sp-radius);
  overflow:hidden; touch-action:none; user-select:none;
}

/* ---------------------------------------------------------------- timing */
.ck-track{
  position:relative; width:min(560px,88%); height:clamp(30px,6vmin,44px);
  background:linear-gradient(180deg,#efe0c0,#e4d1ab);
  border:2px solid rgba(59,47,38,.16); border-radius:999px;
  box-shadow:inset 0 2px 5px rgba(59,47,38,.14);
}
.ck-zone{
  position:absolute; top:3px; bottom:3px; left:38%; width:24%;
  background:linear-gradient(180deg,rgba(126,163,106,.85),rgba(126,163,106,.62));
  border-radius:999px; box-shadow:inset 0 0 0 2px rgba(255,255,255,.4);
  transition:left .12s ease, width .12s ease;
}
.ck-zone::after{
  content:''; position:absolute; left:50%; top:12%; bottom:12%; width:2px;
  margin-left:-1px; background:rgba(255,255,255,.85); border-radius:2px;
}
.ck-marker{
  position:absolute; top:-6px; bottom:-6px; left:50%; width:8px; margin-left:-4px;
  background:var(--sp-red); border-radius:6px;
  box-shadow:0 2px 6px var(--sp-shadow), 0 0 0 2px rgba(255,255,255,.65);
}
.ck-track.f-perfect{ animation:ck-flash-gold .4s ease; }
.ck-track.f-good{ animation:ck-flash-green .4s ease; }
.ck-track.f-bad{ animation:ck-shake .34s ease; }
@keyframes ck-flash-gold{ 50%{ box-shadow:0 0 0 6px rgba(240,185,63,.55), inset 0 2px 5px rgba(59,47,38,.14) } }
@keyframes ck-flash-green{ 50%{ box-shadow:0 0 0 6px rgba(126,163,106,.5), inset 0 2px 5px rgba(59,47,38,.14) } }
@keyframes ck-shake{ 25%{ transform:translateX(-5px) } 75%{ transform:translateX(5px) } }

/* ------------------------------------------------------------------ hold */
.ck-hold{
  position:relative; width:min(560px,88%); height:clamp(34px,7vmin,50px);
  background:linear-gradient(180deg,#efe0c0,#e4d1ab);
  border:2px solid rgba(59,47,38,.16); border-radius:14px; overflow:hidden;
  box-shadow:inset 0 2px 5px rgba(59,47,38,.14);
}
.ck-holdfill{
  position:absolute; left:0; top:0; bottom:0; width:0%;
  background:linear-gradient(180deg,#e8a44f,var(--sp-gold));
  box-shadow:inset 0 -3px 0 rgba(0,0,0,.08);
}
.ck-holdband{
  position:absolute; top:0; bottom:0; left:50%; width:10%; margin-left:-5%;
  background:rgba(126,163,106,.34); border-left:2px solid rgba(126,163,106,.8);
  border-right:2px solid rgba(126,163,106,.8);
}
.ck-holdtarget{ position:absolute; top:-2px; bottom:-2px; left:50%; width:3px; margin-left:-1.5px; background:var(--sp-red); border-radius:3px; }
.ck-hold.f-perfect{ animation:ck-flash-gold .4s ease; }
.ck-hold.f-good{ animation:ck-flash-green .4s ease; }
.ck-hold.f-bad{ animation:ck-shake .34s ease; }

/* ----------------------------------------------------------------- slice */
.ck-arrow{
  font-size:clamp(52px,12vmin,92px); line-height:1; font-weight:900; color:var(--sp-ink);
  text-shadow:0 4px 0 rgba(59,47,38,.14);
  animation:ck-pop .18s cubic-bezier(.2,1.6,.5,1) both;
}
.ck-arrow.ok{ color:var(--sp-green); }
.ck-arrow.no{ color:var(--sp-red); animation:ck-shake .3s ease; }
@keyframes ck-pop{ from{ transform:scale(.6); opacity:0 } to{ transform:none; opacity:1 } }
.ck-timer{ width:min(300px,70%); }
.ck-strokes{ display:flex; gap:6px; }
.ck-stroke{ width:14px; height:14px; border-radius:50%; background:rgba(59,47,38,.14); border:1.5px solid rgba(59,47,38,.12); }
.ck-stroke.ok{ background:var(--sp-green); }
.ck-stroke.no{ background:var(--sp-red); }

/* ------------------------------------------------------------------ drag */
.ck-slots, .ck-chips{ display:flex; gap:clamp(8px,2vmin,16px); flex-wrap:wrap; justify-content:center; }
.ck-slot{
  width:clamp(58px,11vmin,84px); height:clamp(58px,11vmin,84px);
  border:3px dashed rgba(59,47,38,.28); border-radius:16px;
  display:flex; align-items:center; justify-content:center; flex-direction:column; gap:2px;
  background:rgba(255,255,255,.4); color:var(--sp-ink-soft);
  font-size:clamp(20px,4.4vmin,30px);
}
.ck-slot .ck-slotname{ font-size:10px; font-weight:800; }
.ck-slot.active{ border-color:var(--sp-red); background:#fff; box-shadow:0 0 0 3px rgba(200,80,63,.16); }
.ck-slot.over{ border-style:solid; border-color:var(--sp-blue); }
.ck-slot.ok{ border-style:solid; border-color:var(--sp-green); background:rgba(126,163,106,.16); }
.ck-slot.no{ border-style:solid; border-color:var(--sp-red); background:rgba(200,80,63,.14); }
.ck-chip{
  position:relative; width:clamp(52px,10vmin,74px); height:clamp(52px,10vmin,74px);
  border:2px solid rgba(59,47,38,.16); border-radius:16px;
  background:linear-gradient(180deg,#fff8ea,#f1e0be); color:var(--sp-ink);
  box-shadow:0 3px 0 rgba(59,47,38,.16);
  display:flex; align-items:center; justify-content:center; flex-direction:column;
  font-size:clamp(20px,4.2vmin,28px); font-family:inherit; cursor:grab;
  touch-action:none;
}
.ck-chip .ck-num{
  position:absolute; top:-7px; left:-7px; width:18px; height:18px; border-radius:50%;
  background:var(--sp-ink); color:var(--sp-cream); font-size:10px; font-weight:900;
  display:flex; align-items:center; justify-content:center;
}
.ck-chip.sel{ border-color:var(--sp-red); box-shadow:0 0 0 3px rgba(200,80,63,.2), 0 3px 0 rgba(59,47,38,.16); }
.ck-chip.used{ opacity:.28; pointer-events:none; }
.ck-chip.ghost{
  position:fixed; z-index:80; pointer-events:none; margin:0;
  transform:translate(-50%,-50%) rotate(-4deg) scale(1.06); cursor:grabbing;
}

/* ------------------------------------------------------------------ roll */
.ck-beats{ display:flex; gap:clamp(6px,1.6vmin,12px); align-items:center; }
.ck-beat{
  width:clamp(16px,3.4vmin,24px); height:clamp(16px,3.4vmin,24px); border-radius:50%;
  background:rgba(59,47,38,.14); border:2px solid rgba(59,47,38,.12);
}
.ck-beat.now{ background:var(--sp-gold); transform:scale(1.25); }
.ck-beat.ok{ background:var(--sp-green); border-color:rgba(126,163,106,.7); }
.ck-beat.no{ background:var(--sp-red); border-color:rgba(200,80,63,.6); }
.ck-pulse{
  width:clamp(72px,15vmin,110px); height:clamp(72px,15vmin,110px); border-radius:50%;
  border:4px solid rgba(59,47,38,.16); background:rgba(255,255,255,.6);
  display:flex; align-items:center; justify-content:center; font-size:clamp(28px,6vmin,44px);
}
.ck-pulse.beat{ animation:ck-thump .26s ease; }
@keyframes ck-thump{ 40%{ transform:scale(1.16); border-color:var(--sp-gold) } }
.ck-pulse.ok{ animation:ck-flash-green .3s ease; }
.ck-pulse.no{ animation:ck-shake .3s ease; }

/* --------------------------------------------------------------- arrange */
.ck-pieces{ display:flex; gap:clamp(8px,2vmin,16px); flex-wrap:wrap; justify-content:center; }
.ck-piece{
  position:relative; width:clamp(56px,11vmin,80px); height:clamp(56px,11vmin,80px);
  border:2px solid rgba(59,47,38,.16); border-radius:18px;
  background:linear-gradient(180deg,#fff8ea,#f1e0be); color:var(--sp-ink);
  box-shadow:0 3px 0 rgba(59,47,38,.16); cursor:pointer; font-family:inherit;
  font-size:clamp(22px,4.6vmin,32px);
}
.ck-piece .ck-order{
  position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  background:rgba(200,80,63,.9); color:#fff8ef; border-radius:16px;
  font-size:clamp(20px,4vmin,28px); font-weight:900;
}
.ck-piece.hi{ border-color:var(--sp-red); box-shadow:0 0 0 3px rgba(200,80,63,.2), 0 3px 0 rgba(59,47,38,.16); }
.ck-piece.ok{ border-color:var(--sp-green); background:rgba(126,163,106,.2); }
.ck-piece.no{ border-color:var(--sp-red); background:rgba(200,80,63,.16); }
.ck-piece.done{ opacity:.4; }
.ck-seq{ display:flex; gap:6px; }
.ck-seqdot{ width:12px; height:12px; border-radius:50%; background:rgba(59,47,38,.14); }
.ck-seqdot.ok{ background:var(--sp-green); }
.ck-seqdot.no{ background:var(--sp-red); }

/* --------------------------------------------------------------- verdict */
.ck-verdict{
  position:absolute; left:50%; top:50%; transform:translate(-50%,-50%) rotate(-8deg);
  padding:8px 22px; border-radius:14px; pointer-events:none; z-index:5;
  font-size:clamp(22px,5vmin,38px); font-weight:900; letter-spacing:.02em;
  color:#fff8ef; text-shadow:0 2px 0 rgba(59,47,38,.28);
  background:var(--sp-red); border:3px solid rgba(255,255,255,.7);
  box-shadow:0 8px 20px var(--sp-shadow);
  animation:ck-stamp .5s cubic-bezier(.2,1.7,.4,1) both;
}
@keyframes ck-stamp{
  0%{ transform:translate(-50%,-50%) rotate(-8deg) scale(2.1); opacity:0 }
  60%{ opacity:1 }
  100%{ transform:translate(-50%,-50%) rotate(-8deg) scale(1); opacity:1 }
}
.ck-verdict.out{ animation:ck-stampout .3s ease forwards; }
@keyframes ck-stampout{ to{ opacity:0; transform:translate(-50%,-60%) rotate(-8deg) scale(.9) } }

/* ---------------------------------------------------------------- result */
.ck-result{
  position:absolute; inset:0; z-index:10; border-radius:var(--sp-radius);
  background:linear-gradient(180deg,rgba(251,243,226,.97),rgba(242,228,200,.99));
  display:flex; flex-direction:column; gap:8px; padding:14px; overflow:auto;
  animation:ck-pop .22s cubic-bezier(.2,1.5,.5,1) both;
}
.ck-grade{ text-align:center; font-size:clamp(24px,5.4vmin,40px); font-weight:900; }
.ck-scoreline{ display:flex; align-items:center; gap:8px; }
.ck-rows{ display:flex; flex-direction:column; gap:4px; overflow:auto; }
.ck-row{
  display:flex; align-items:center; gap:8px; font-size:12px; font-weight:800;
  background:rgba(255,255,255,.55); border:1.5px solid rgba(59,47,38,.1);
  border-radius:10px; padding:5px 9px;
}
.ck-row .ck-rowname{ flex:1; }
.ck-row .sp-ico{ font-size:16px; width:20px; text-align:center; flex:0 0 20px; }
.ck-row .ck-rowv{ color:var(--sp-ink-soft); }

.ck-stop{
  flex:0 0 auto; font-family:inherit; font-weight:800; font-size:11px; cursor:pointer;
  color:var(--sp-ink); background:rgba(255,255,255,.7);
  border:1.5px solid rgba(59,47,38,.12); border-radius:999px; padding:5px 11px;
  white-space:nowrap;
}
.ck-stop:hover{ border-color:var(--sp-red); color:var(--sp-red); }
.ck-stop:focus-visible{ outline:2px solid var(--sp-red); outline-offset:2px; }

@media (max-width:820px), (max-height:620px){
  .ck-arena{ min-height:130px; padding:8px; }
  .ck-dots{ display:none; }
}
@media (max-width:700px){
  .ck-stage{
    width:calc(100vw - 16px); max-height:calc(100svh - 16px);
    padding:10px 10px calc(10px + env(safe-area-inset-bottom, 0px));
  }
  .ck-top{ flex-wrap:wrap; gap:6px; }
  .ck-progress{ order:5; flex-basis:100%; }
  .ck-stop{ padding:8px 13px; font-size:12px; }
  .ck-arena{ min-height:clamp(150px, 30svh, 240px); }
  .ck-track, .ck-hold{ width:96%; }
}
`;

let cssInjected = false;
function injectCookingStyles() {
  if (cssInjected) return;
  cssInjected = true;
  injectStyles();
  const s = el('style');
  s.id = 'sp-cooking';
  s.textContent = CSS;
  document.head.appendChild(s);
}

const ARROW_GLYPH = { left: '←', right: '→', up: '↑', down: '↓' };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const pct = (v) => `${(clamp01(v) * 100).toFixed(2)}%`;

/** Tracks every listener it adds so `removeAll()` can guarantee a clean exit. */
function listenerBag() {
  const bag = [];
  return {
    add(target, type, fn, opts) {
      if (!target) return fn;
      target.addEventListener(type, fn, opts);
      bag.push([target, type, fn, opts]);
      return fn;
    },
    removeAll() {
      for (const [target, type, fn, opts] of bag.splice(0)) {
        target.removeEventListener(type, fn, opts);
      }
    },
  };
}

function gradeColor(grade) {
  if (!grade) return THEME.red;
  if (typeof grade === 'object' && grade.color) return grade.color;
  const id = typeof grade === 'string' ? grade.toLowerCase() : '';
  const g = QUALITY_GRADES.find((x) => x.id === id || x.label.toLowerCase() === id);
  if (g) return g.color;
  if (id === 'perfect') return THEME.gold;
  if (id === 'good' || id === 'great') return THEME.green;
  if (id === 'bad' || id === 'missed') return THEME.red;
  return THEME.red;
}

export function createCookingUI(game) {
  injectCookingStyles();

  // ------------------------------------------------------------- structure
  const dim = scrim();
  dim.el.classList.add('ck-scrim');

  const stage = panel({
    id: 'sp-cooking-stage',
    title: 'Cooking',
    sub: '',
    closable: false,
    cls: 'ck-stage',
  });
  stage.root.setAttribute('role', 'dialog');
  stage.root.setAttribute('aria-label', 'Cooking mini-game');

  const top = el('div', 'ck-top');
  const dishIcon = el('span', 'ck-dish', '🍣');
  const dishName = el('span', 'ck-dishname', '');
  const stepLabel = el('span', 'ck-steplabel', '');
  const progressBar = bar(0, THEME.gold);
  progressBar.classList.add('ck-progress');
  // Escape is the abort, and on a touchscreen there is no Escape. This is the
  // same abort with a hit target — without it a phone player who starts a dish
  // has no way out of the mini-game.
  let onStop = null;
  const stopBtn = el('button', 'ck-stop');
  stopBtn.type = 'button';
  stopBtn.textContent = IS_TOUCH ? '✕ Stop' : '⎋ Esc to stop';
  stopBtn.title = 'Stop cooking';
  stopBtn.addEventListener('click', () => { if (onStop) onStop(); });
  top.append(dishIcon, dishName, stepLabel, progressBar, stopBtn);

  const dots = el('div', 'ck-dots');
  const promptEl = el('div', 'ck-prompt', '');
  promptEl.setAttribute('aria-live', 'polite');
  const hintEl = el('div', 'ck-hint', '');
  const arena = el('div', 'ck-arena');

  stage.body.append(top, dots, promptEl, hintEl, arena);

  let activeHandle = null;   // whatever mount() last returned
  let verdictEl = null;
  let verdictTimer = 0;
  let resultBag = null;      // listeners owned by the result card
  let resultEl = null;
  let resultResolve = null;  // settles result()'s promise from ANY teardown path
  let destroyed = false;

  function clearArena() {
    if (activeHandle && activeHandle.destroy) {
      try { activeHandle.destroy(); } catch (err) { console.error('[cookingUI] destroy', err); }
    }
    activeHandle = null;
    // The verdict stamp and the summary card live in the arena too. Keep the
    // stamp if it is mid-animation, and never orphan the card — only
    // dismissResult() may remove that, because it owns the pending promise.
    for (const child of Array.from(arena.children)) {
      if (child !== verdictEl && child !== resultEl) child.remove();
    }
  }

  /** Every mount funnels through here so exactly one interaction exists at a time. */
  function beginMount() {
    clearArena();
    const bag = listenerBag();
    const nodes = [];
    return {
      bag,
      keep(node) { nodes.push(node); arena.append(node); return node; },
      wrap(handle) {
        const h = {
          ...handle,
          destroy() {
            bag.removeAll();
            if (handle.destroy) handle.destroy();
            for (const n of nodes) n.remove();
            nodes.length = 0;
            if (activeHandle === h) activeHandle = null;
          },
        };
        activeHandle = h;
        return h;
      },
    };
  }

  // ------------------------------------------------------------ chrome API
  function show(recipe) {
    if (destroyed) return;
    dishIcon.textContent = (recipe && recipe.icon) || '🍣';
    dishName.textContent = (recipe && recipe.name) || 'Cooking';
    stage.setTitle('Cooking', (recipe && recipe.desc) || '');
    stepLabel.textContent = '';
    promptEl.textContent = '';
    hintEl.textContent = '';
    progressBar.set(0, THEME.gold);
    dots.innerHTML = '';
    clearArena();
    dim.show();
    stage.show();
  }

  function hide() {
    dismissResult();
    clearArena();
    if (verdictEl) { verdictEl.remove(); verdictEl = null; }
    stage.hide();
    dim.hide();
  }

  /** step = the STEPS entry for this index (may be null while spinning up). */
  function setStep(index, total, step) {
    stepLabel.textContent = `Step ${Math.min(index + 1, total)} / ${total}`;
    if (dots.children.length !== total) {
      dots.innerHTML = '';
      for (let i = 0; i < total; i++) dots.append(el('div', 'ck-dot', ''));
    }
    Array.from(dots.children).forEach((d, i) => {
      d.className = 'ck-dot' + (i < index ? ' done' : i === index ? ' on' : '');
      if (i === index && step) d.textContent = `${step.icon || ''} ${step.label || ''}`.trim();
      else if (!d.textContent) d.textContent = '•';
    });
    if (step) {
      const dot = dots.children[index];
      if (dot) dot.textContent = `${step.icon || ''} ${step.label || ''}`.trim();
    }
    progressBar.set(total ? index / total : 0, THEME.gold);
  }

  function setPrompt(text) { promptEl.textContent = text == null ? '' : String(text); }

  /** Accepts plain text; [Space] style brackets become <kbd> chips. */
  function setHint(text) {
    hintEl.innerHTML = '';
    if (!text) return;
    const parts = String(text).split(/(\[[^\]]+\])/g);
    for (const p of parts) {
      if (!p) continue;
      if (p[0] === '[' && p[p.length - 1] === ']') hintEl.append(el('kbd', null, p.slice(1, -1)));
      else hintEl.append(document.createTextNode(p));
    }
  }

  function progress(t01) { progressBar.set(clamp01(t01), THEME.gold); }

  function verdict(text, grade) {
    if (verdictEl) { verdictEl.remove(); verdictEl = null; }
    if (verdictTimer) { clearTimeout(verdictTimer); verdictTimer = 0; }
    const v = el('div', 'ck-verdict', text || '');
    v.style.background = gradeColor(grade);
    arena.append(v);
    verdictEl = v;
    verdictTimer = setTimeout(() => {
      v.classList.add('out');
      setTimeout(() => { if (verdictEl === v) verdictEl = null; v.remove(); }, 300);
    }, 620);
    return v;
  }

  // ------------------------------------------------------------------ timing
  const timing = {
    mount(cfg = {}) {
      const m = beginMount();
      const track = el('div', 'ck-track');
      const zone = el('div', 'ck-zone');
      const marker = el('div', 'ck-marker');
      track.append(zone, marker);
      m.keep(track);

      const rounds = el('div', 'ck-strokes');
      const total = Math.max(1, cfg.rounds || 1);
      for (let i = 0; i < total; i++) rounds.append(el('div', 'ck-stroke'));
      if (total > 1) m.keep(rounds);

      let onPress = null;
      m.bag.add(arena, 'pointerdown', (e) => {
        e.preventDefault();
        if (onPress) onPress();
      });

      let flashTimer = 0;
      return m.wrap({
        setMarker(t) { marker.style.left = pct(t); },
        setZone(a, b) {
          const lo = clamp01(Math.min(a, b));
          const hi = clamp01(Math.max(a, b));
          zone.style.left = pct(lo);
          zone.style.width = pct(hi - lo);
        },
        flash(kind) {
          track.classList.remove('f-perfect', 'f-good', 'f-bad');
          if (!kind) return;
          // Reflow so the animation restarts even on a repeated verdict.
          void track.offsetWidth;
          track.classList.add(`f-${kind}`);
          if (flashTimer) clearTimeout(flashTimer);
          flashTimer = setTimeout(() => track.classList.remove('f-perfect', 'f-good', 'f-bad'), 450);
        },
        markRound(i, kind) {
          const d = rounds.children[i];
          if (d) d.className = `ck-stroke ${kind === 'bad' ? 'no' : 'ok'}`;
        },
        onPress(cb) { onPress = cb; },
        destroy() { if (flashTimer) clearTimeout(flashTimer); },
      });
    },
  };

  // -------------------------------------------------------------------- hold
  const hold = {
    mount() {
      const m = beginMount();
      const wrap = el('div', 'ck-hold');
      const band = el('div', 'ck-holdband');
      const fill = el('div', 'ck-holdfill');
      const target = el('div', 'ck-holdtarget');
      wrap.append(band, fill, target);
      m.keep(wrap);

      let onStart = null, onEnd = null, down = false;
      m.bag.add(arena, 'pointerdown', (e) => {
        e.preventDefault();
        if (down) return;
        down = true;
        if (onStart) onStart();
      });
      const up = () => { if (!down) return; down = false; if (onEnd) onEnd(); };
      m.bag.add(window, 'pointerup', up);
      m.bag.add(window, 'pointercancel', up);

      let flashTimer = 0;
      let targetT = 0.5, tol = 0.1;
      const paint = () => {
        target.style.left = pct(targetT);
        band.style.left = pct(Math.max(0, targetT - tol));
        band.style.width = pct(Math.min(1, targetT + tol) - Math.max(0, targetT - tol));
        band.style.marginLeft = '0';
      };
      paint();

      return m.wrap({
        setFill(t) { fill.style.width = pct(t); },
        setTarget(t) { targetT = clamp01(t); paint(); },
        setTolerance(w) { tol = Math.max(0, w); paint(); },
        flash(kind) {
          wrap.classList.remove('f-perfect', 'f-good', 'f-bad');
          if (!kind) return;
          void wrap.offsetWidth;
          wrap.classList.add(`f-${kind}`);
          if (flashTimer) clearTimeout(flashTimer);
          flashTimer = setTimeout(() => wrap.classList.remove('f-perfect', 'f-good', 'f-bad'), 450);
        },
        onHoldStart(cb) { onStart = cb; },
        onHoldEnd(cb) { onEnd = cb; },
        destroy() { if (flashTimer) clearTimeout(flashTimer); },
      });
    },
  };

  // ------------------------------------------------------------------- slice
  const slice = {
    mount(cfg = {}) {
      const m = beginMount();
      const arrow = el('div', 'ck-arrow', '→');
      const timerBar = bar(1, THEME.red);
      timerBar.classList.add('ck-timer');
      const strokes = el('div', 'ck-strokes');
      const total = Math.max(1, cfg.strokes || 1);
      for (let i = 0; i < total; i++) strokes.append(el('div', 'ck-stroke'));
      m.keep(arrow); m.keep(timerBar); m.keep(strokes);

      let onSwipe = null;
      let sx = 0, sy = 0, tracking = false;
      m.bag.add(arena, 'pointerdown', (e) => {
        e.preventDefault();
        tracking = true; sx = e.clientX; sy = e.clientY;
      });
      m.bag.add(window, 'pointerup', (e) => {
        if (!tracking) return;
        tracking = false;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return;   // a tap, not a stroke
        const dir = Math.abs(dx) > Math.abs(dy)
          ? (dx > 0 ? 'right' : 'left')
          : (dy > 0 ? 'down' : 'up');
        if (onSwipe) onSwipe(dir);
      });
      m.bag.add(window, 'pointercancel', () => { tracking = false; });

      let idx = 0;
      return m.wrap({
        setArrow(dir) {
          arrow.className = 'ck-arrow';
          void arrow.offsetWidth;
          arrow.textContent = ARROW_GLYPH[dir] || '→';
        },
        setTimer(t) { timerBar.set(clamp01(t), clamp01(t) > 0.4 ? THEME.green : THEME.red); },
        hit(ok) {
          arrow.classList.remove('ok', 'no');
          void arrow.offsetWidth;
          arrow.classList.add(ok ? 'ok' : 'no');
          const d = strokes.children[idx++];
          if (d) d.className = `ck-stroke ${ok ? 'ok' : 'no'}`;
        },
        onSwipe(cb) { onSwipe = cb; },
        destroy() {},
      });
    },
  };

  // -------------------------------------------------------------------- drag
  const drag = {
    mount(cfg = {}) {
      const m = beginMount();
      const slotRow = el('div', 'ck-slots');
      const chipRow = el('div', 'ck-chips');
      m.keep(slotRow); m.keep(chipRow);

      let chips = [], slots = [];
      const chipEls = new Map();   // chipId -> button
      const slotEls = new Map();   // slotId -> div
      const usedChips = new Set();
      const filledSlots = new Set();
      let selected = null;         // chipId
      let activeSlot = 0;          // index into slots
      let onPlace = null;
      let ghost = null;
      let dragId = null;
      let hovered = null;

      function paintSelection() {
        for (const [id, node] of chipEls) node.classList.toggle('sel', id === selected);
        slots.forEach((s, i) => {
          const node = slotEls.get(s.id);
          if (node) node.classList.toggle('active', i === activeSlot && !filledSlots.has(s.id));
        });
      }

      function nextOpenSlot(from = 0) {
        for (let i = 0; i < slots.length; i++) {
          const idx = (from + i) % slots.length;
          if (!filledSlots.has(slots[idx].id)) return idx;
        }
        return -1;
      }

      function place(chipId, slotId) {
        if (!chipId || !slotId) return;
        if (usedChips.has(chipId) || filledSlots.has(slotId)) return;
        usedChips.add(chipId);
        filledSlots.add(slotId);
        const chipNode = chipEls.get(chipId);
        const slotNode = slotEls.get(slotId);
        if (chipNode) chipNode.classList.add('used');
        if (slotNode) {
          const chip = chips.find((c) => c.id === chipId);
          slotNode.textContent = (chip && chip.icon) || '•';
        }
        selected = null;
        activeSlot = Math.max(0, nextOpenSlot(slots.findIndex((s) => s.id === slotId)));
        paintSelection();
        if (onPlace) onPlace(chipId, slotId);
      }

      function slotUnder(x, y) {
        const node = document.elementFromPoint(x, y);
        const s = node && node.closest ? node.closest('.ck-slot') : null;
        return s && s.dataset ? s.dataset.slot : null;
      }

      function moveGhost(x, y) {
        if (!ghost) return;
        ghost.style.left = `${x}px`;
        ghost.style.top = `${y}px`;
        const over = slotUnder(x, y);
        if (over !== hovered) {
          if (hovered && slotEls.get(hovered)) slotEls.get(hovered).classList.remove('over');
          hovered = over;
          if (hovered && slotEls.get(hovered) && !filledSlots.has(hovered)) {
            slotEls.get(hovered).classList.add('over');
          }
        }
      }

      function endDrag(x, y) {
        if (!dragId) return;
        const targetSlot = slotUnder(x, y);
        if (hovered && slotEls.get(hovered)) slotEls.get(hovered).classList.remove('over');
        hovered = null;
        if (ghost) { ghost.remove(); ghost = null; }
        const id = dragId;
        dragId = null;
        if (targetSlot) place(id, targetSlot);
        else { selected = id; paintSelection(); }
      }

      m.bag.add(window, 'pointermove', (e) => { if (dragId) moveGhost(e.clientX, e.clientY); });
      m.bag.add(window, 'pointerup', (e) => { if (dragId) endDrag(e.clientX, e.clientY); });
      m.bag.add(window, 'pointercancel', () => {
        if (!dragId) return;
        if (ghost) { ghost.remove(); ghost = null; }
        if (hovered && slotEls.get(hovered)) slotEls.get(hovered).classList.remove('over');
        hovered = null; dragId = null;
      });

      // Keyboard fallback: 1..N picks a chip, arrows move the outline, Enter places.
      m.bag.add(window, 'keydown', (e) => {
        if (e.key === 'Escape') return;             // the engine owns Esc
        const n = parseInt(e.key, 10);
        if (!Number.isNaN(n) && n >= 1 && n <= chips.length) {
          const chip = chips[n - 1];
          if (chip && !usedChips.has(chip.id)) { selected = chip.id; paintSelection(); e.preventDefault(); }
          return;
        }
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'Tab') {
          const nx = nextOpenSlot(activeSlot + 1);
          if (nx >= 0) { activeSlot = nx; paintSelection(); e.preventDefault(); }
          return;
        }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          for (let i = 1; i <= slots.length; i++) {
            const idx = (activeSlot - i + slots.length * 2) % slots.length;
            if (!filledSlots.has(slots[idx].id)) { activeSlot = idx; paintSelection(); break; }
          }
          e.preventDefault();
          return;
        }
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          const slot = slots[activeSlot];
          const chipId = selected || (chips.find((c) => !usedChips.has(c.id)) || {}).id;
          if (slot && chipId) { place(chipId, slot.id); e.preventDefault(); }
        }
      });

      return m.wrap({
        setChips(list) {
          chips = (list || []).slice();
          chipRow.innerHTML = '';
          chipEls.clear();
          chips.forEach((c, i) => {
            const b = el('button', 'ck-chip');
            b.type = 'button';
            b.append(el('span', 'ck-num', String(i + 1)));
            b.append(el('span', null, c.icon || '🍚'));
            b.title = c.name || c.id;
            b.setAttribute('aria-label', `${c.name || c.id} (key ${i + 1})`);
            m.bag.add(b, 'pointerdown', (e) => {
              e.preventDefault();
              if (usedChips.has(c.id)) return;
              selected = c.id;
              dragId = c.id;
              ghost = b.cloneNode(true);
              ghost.classList.add('ghost');
              document.body.append(ghost);
              moveGhost(e.clientX, e.clientY);
              paintSelection();
            });
            chipEls.set(c.id, b);
            chipRow.append(b);
          });
          paintSelection();
        },
        setSlots(list) {
          slots = (list || []).slice();
          slotRow.innerHTML = '';
          slotEls.clear();
          filledSlots.clear();
          slots.forEach((s) => {
            const node = el('div', 'ck-slot');
            node.dataset.slot = s.id;
            node.textContent = s.icon || '';
            if (s.name) {
              const nm = el('span', 'ck-slotname', s.name);
              node.append(nm);
            }
            slotEls.set(s.id, node);
            slotRow.append(node);
          });
          activeSlot = 0;
          paintSelection();
        },
        onPlace(cb) { onPlace = cb; },
        mark(slotId, ok) {
          const node = slotEls.get(slotId);
          if (node) node.classList.add(ok ? 'ok' : 'no');
        },
        destroy() { if (ghost) { ghost.remove(); ghost = null; } },
      });
    },
  };

  // -------------------------------------------------------------------- roll
  const roll = {
    mount(cfg = {}) {
      const m = beginMount();
      const pulse = el('div', 'ck-pulse', '🍥');
      const beats = el('div', 'ck-beats');
      const total = Math.max(1, cfg.beats || 1);
      for (let i = 0; i < total; i++) beats.append(el('div', 'ck-beat'));
      m.keep(pulse); m.keep(beats);

      let onTap = null;
      m.bag.add(arena, 'pointerdown', (e) => { e.preventDefault(); if (onTap) onTap(); });

      let pulseTimer = 0, hitTimer = 0;
      return m.wrap({
        setBeat(i, count) {
          Array.from(beats.children).forEach((b, k) => {
            b.classList.toggle('now', k === i);
            if (count && k >= count) b.style.display = 'none';
          });
        },
        pulse() {
          pulse.classList.remove('beat');
          void pulse.offsetWidth;
          pulse.classList.add('beat');
          if (pulseTimer) clearTimeout(pulseTimer);
          pulseTimer = setTimeout(() => pulse.classList.remove('beat'), 280);
        },
        hit(ok, index) {
          pulse.classList.remove('ok', 'no');
          void pulse.offsetWidth;
          pulse.classList.add(ok ? 'ok' : 'no');
          if (hitTimer) clearTimeout(hitTimer);
          hitTimer = setTimeout(() => pulse.classList.remove('ok', 'no'), 320);
          const b = beats.children[index == null ? -1 : index];
          if (b) { b.classList.remove('now'); b.classList.add(ok ? 'ok' : 'no'); }
        },
        onTap(cb) { onTap = cb; },
        destroy() {
          if (pulseTimer) clearTimeout(pulseTimer);
          if (hitTimer) clearTimeout(hitTimer);
        },
      });
    },
  };

  // ----------------------------------------------------------------- arrange
  const arrange = {
    mount() {
      const m = beginMount();
      const row = el('div', 'ck-pieces');
      const seq = el('div', 'ck-seq');
      m.keep(row); m.keep(seq);

      let pieces = [];
      const nodes = new Map();     // pieceId -> button
      const orderTags = new Map(); // pieceId -> overlay
      let onPick = null;
      let hi = 0;
      let picks = 0;

      function paintHi() {
        pieces.forEach((p, i) => {
          const n = nodes.get(p.id);
          if (n) n.classList.toggle('hi', i === hi);
        });
      }

      function pick(id) {
        const node = nodes.get(id);
        if (!node || node.classList.contains('done')) return;
        if (onPick) onPick(id);
      }

      m.bag.add(window, 'keydown', (e) => {
        if (e.key === 'Escape') return;
        const n = parseInt(e.key, 10);
        if (!Number.isNaN(n) && n >= 1 && n <= pieces.length) { pick(pieces[n - 1].id); e.preventDefault(); return; }
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { hi = (hi + 1) % Math.max(1, pieces.length); paintHi(); e.preventDefault(); return; }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { hi = (hi - 1 + Math.max(1, pieces.length)) % Math.max(1, pieces.length); paintHi(); e.preventDefault(); return; }
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          if (pieces[hi]) { pick(pieces[hi].id); e.preventDefault(); }
        }
      });

      return m.wrap({
        setPieces(list) {
          pieces = (list || []).slice();
          row.innerHTML = '';
          seq.innerHTML = '';
          nodes.clear();
          orderTags.clear();
          pieces.forEach((p, i) => {
            const b = el('button', 'ck-piece');
            b.type = 'button';
            b.append(el('span', null, p.icon || '🍣'));
            b.title = p.name || p.id;
            b.setAttribute('aria-label', `${p.name || p.id} (key ${i + 1})`);
            m.bag.add(b, 'click', () => pick(p.id));
            nodes.set(p.id, b);
            row.append(b);
            seq.append(el('div', 'ck-seqdot'));
          });
          hi = 0;
          paintHi();
        },
        /** order = array of piece ids in the order they must be clicked. */
        showPattern(order) {
          (order || []).forEach((id, k) => {
            const node = nodes.get(id);
            if (!node) return;
            const tag = el('span', 'ck-order', String(k + 1));
            node.append(tag);
            orderTags.set(id, tag);
          });
        },
        hidePattern() {
          for (const tag of orderTags.values()) tag.remove();
          orderTags.clear();
        },
        onPick(cb) { onPick = cb; },
        mark(i, ok, pieceId) {
          const dot = seq.children[i];
          if (dot) dot.className = `ck-seqdot ${ok ? 'ok' : 'no'}`;
          const node = pieceId != null ? nodes.get(pieceId) : null;
          if (node) {
            node.classList.add(ok ? 'ok' : 'no', 'done');
            node.classList.remove('hi');
          }
          picks = i + 1;
          if (picks < pieces.length) {
            const nextOpen = pieces.findIndex((p) => {
              const n = nodes.get(p.id);
              return n && !n.classList.contains('done');
            });
            if (nextOpen >= 0) { hi = nextOpen; paintHi(); }
          }
        },
        destroy() {},
      });
    },
  };

  // ------------------------------------------------------------------ result
  /**
   * Tears the summary card down and settles its promise. hide() and destroy()
   * both funnel through here, so `await result()` can never outlive the card.
   */
  function dismissResult() {
    const settle = resultResolve;
    resultResolve = null;
    if (resultBag) { resultBag.removeAll(); resultBag = null; }
    if (resultEl) { resultEl.remove(); resultEl = null; }
    if (settle) settle();
  }

  /**
   * End-of-dish summary. Resolves when the player dismisses it (button, Enter,
   * Space or Esc). `res.autoMs` auto-dismisses — used by rush service.
   */
  function result(res) {
    dismissResult();
    return new Promise((resolve) => {
      if (destroyed || !res) { resolve(null); return; }
      const bag = listenerBag();
      resultBag = bag;
      resultResolve = () => resolve(res);
      const card = el('div', 'ck-result');
      resultEl = card;

      const g = res.grade || {};
      const head = el('div', 'ck-grade', g.label || 'Done');
      head.style.color = gradeColor(g);
      card.append(head);

      const line = el('div', 'ck-scoreline');
      line.append(badge(`${Math.round((res.score || 0) * 100)}%`, '⭐'));
      if (res.seconds != null) line.append(badge(`${res.seconds.toFixed(1)}s`, '⏱'));
      if (res.perfect) line.append(badge('Flawless', '✨'));
      line.append(el('span', 'sp-spacer'));
      card.append(line);

      const rows = el('div', 'ck-rows');
      for (const s of res.stepScores || []) {
        const r = el('div', 'ck-row');
        r.append(el('span', 'sp-ico', s.icon || '•'));
        r.append(el('span', 'ck-rowname', s.label || s.stepId));
        const v = el('span', 'ck-rowv', s.verdict || '');
        r.append(v);
        const b = bar(s.score || 0, (s.score || 0) > 0.75 ? THEME.green : (s.score || 0) > 0.45 ? THEME.gold : THEME.red);
        b.style.width = '70px';
        r.append(b);
        rows.append(r);
      }
      card.append(rows);

      const foot = el('div', 'sp-row');
      foot.append(el('span', 'sp-spacer'));
      const ok = button('Serve it up', { cls: 'sp-primary' });
      foot.append(ok);
      card.append(foot);

      let autoTimer = 0;
      const done = () => dismissResult();     // dismissResult() resolves us
      bag.add(ok, 'click', done);
      bag.add(window, 'keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar' || e.key === 'Escape') {
          e.preventDefault();
          done();
        }
      });
      if (res.autoMs > 0) autoTimer = setTimeout(done, res.autoMs);
      // The timer must die with the card even if the click never comes, so the
      // card's teardown handle wraps the bag rather than being it.
      resultBag = { removeAll() { if (autoTimer) clearTimeout(autoTimer); bag.removeAll(); } };

      arena.append(card);
      // Focus the primary action for keyboard players, but do not trap: Tab
      // still walks out of the card normally because nothing intercepts it.
      try { ok.focus({ preventScroll: true }); } catch (err) { /* older browsers */ }
    });
  }

  function destroy() {
    destroyed = true;
    dismissResult();
    clearArena();
    if (verdictTimer) clearTimeout(verdictTimer);
    if (verdictEl) { verdictEl.remove(); verdictEl = null; }
    stage.destroy();
    dim.el.remove();
  }

  return {
    show, hide,
    setStep, setPrompt, setHint,
    timing, hold, slice, drag, roll, arrange,
    verdict, progress, result, destroy,
    /** What the stop button does. The engine points this at its `abort()`. */
    onStop(cb) { onStop = typeof cb === 'function' ? cb : null; },
    get root() { return stage.root; },
    get arena() { return arena; },
  };
}
