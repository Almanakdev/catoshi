// First-run shadow-cursor tutorial (controls intro). Complements the day-one
// gameplay tutorial in tutorial.js — this one only teaches how to move/look.

import { isTypingInUI } from '../engine/inputGuard.js';
import { IS_TOUCH } from '../engine/device.js';

const STORAGE_KEY = 'catoshi:shadow-tutorial-v1';

const KEY_STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to Oshicat',
    body: 'A quick walkthrough. Follow the shadow cursor — or just try it yourself.',
    mode: 'pointer',
    advance: 'click',
  },
  {
    id: 'move',
    title: 'Walk',
    body: 'Hold W A S D to walk around the city.',
    mode: 'keys',
    keys: ['KeyW', 'KeyA', 'KeyS', 'KeyD'],
    keyLabels: ['W', 'A', 'S', 'D'],
    advance: 'keys',
  },
  {
    id: 'look',
    title: 'Look around',
    body: 'Push the mouse toward a screen edge to turn the camera. Drag for a precise swing.',
    mode: 'look',
    advance: 'time',
    wait: 4.0,
  },
  {
    id: 'run',
    title: 'Sprint',
    body: 'Hold Shift while moving to run.',
    mode: 'keys',
    keys: ['ShiftLeft', 'ShiftRight'],
    keyLabels: ['⇧ Shift'],
    advance: 'keys',
  },
  {
    id: 'jump',
    title: 'Jump',
    body: 'Press Space to jump.',
    mode: 'keys',
    keys: ['Space'],
    keyLabels: ['Space'],
    advance: 'keys',
  },
  {
    id: 'interact',
    title: 'Interact',
    body: 'Press E near stalls, the shop sign, Master Kuro, or job boards.',
    mode: 'keys',
    keys: ['KeyE'],
    keyLabels: ['E'],
    advance: 'keys',
  },
  {
    id: 'menu',
    title: 'Leave anytime',
    body: 'Top-left: Home returns to the landing page. Chat is bottom-right. Minimap is top-right.',
    mode: 'menu',
    advance: 'click',
  },
];

/**
 * The same seven beats for thumbs. There is no keydown to wait on here, so
 * every step advances on Continue and the shadow cursor points at the real
 * on-screen control (`target` is a live selector into src/ui/touchControls.js).
 */
const TOUCH_STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to Oshicat',
    body: 'A quick tour of the controls. Tap Continue when you have tried each one.',
    mode: 'pointer',
    advance: 'click',
  },
  {
    id: 'move',
    title: 'Walk',
    body: 'Drag the stick at the bottom-left. Push it further to walk faster.',
    mode: 'point',
    target: '.tc-stick',
    advance: 'click',
  },
  {
    id: 'look',
    title: 'Look around',
    body: 'Drag anywhere on the city to swing the camera. Pinch with two fingers to zoom.',
    mode: 'look',
    advance: 'time',
    wait: 3.2,
  },
  {
    id: 'run',
    title: 'Sprint',
    body: 'Tap Run to sprint — or just pin the stick to the edge.',
    mode: 'point',
    target: '.tc-run',
    advance: 'click',
  },
  {
    id: 'jump',
    title: 'Jump',
    body: 'Tap Jump to hop.',
    mode: 'point',
    target: '.tc-jump',
    advance: 'click',
  },
  {
    id: 'interact',
    title: 'Interact',
    body: 'The big paw button lights up near stalls, your shop sign, Master Kuro and job boards. It tells you what it will do.',
    mode: 'point',
    target: '.tc-use',
    advance: 'click',
  },
  {
    id: 'menu',
    title: 'Everything else',
    body: 'The ☰ button opens your bag, recipes, quests, the map and chat. Home (top-left) returns to the landing page.',
    mode: 'point',
    target: '.tc-menu',
    advance: 'click',
  },
];

const STEPS = IS_TOUCH ? TOUCH_STEPS : KEY_STEPS;

export function isShadowTutorialDone() {
  try { return window.localStorage.getItem(STORAGE_KEY) === '1'; }
  catch { return false; }
}

function markDone() {
  try { window.localStorage.setItem(STORAGE_KEY, '1'); } catch { /* private mode */ }
}

/**
 * @param {{ onUi?: () => void, menuTarget?: HTMLElement | null, audio?: { play?: (n:string)=>void } }} opts
 */
export function createShadowTutorial(opts = {}) {
  const onUi = opts.onUi || (() => {});
  const menuTarget = opts.menuTarget || null;
  const audio = opts.audio || null;

  const root = document.createElement('div');
  root.id = 'shadow-tutorial';
  root.setAttribute('aria-live', 'polite');
  root.innerHTML = `
    <div class="tut-veil" aria-hidden="true"></div>
    <div class="tut-cursor" id="tut-cursor" aria-hidden="true">
      <span class="tut-cursor-ring"></span>
      <span class="tut-cursor-dot"></span>
      <span class="tut-cursor-trail"></span>
    </div>
    <div class="tut-keys" id="tut-keys" hidden></div>
    <div class="tut-card" role="dialog" aria-modal="false" aria-labelledby="tut-title">
      <div class="tut-step" id="tut-step">1 / 7</div>
      <h2 class="tut-title" id="tut-title"></h2>
      <p class="tut-body" id="tut-body"></p>
      <div class="tut-actions">
        <button type="button" class="tut-skip" id="tut-skip">Skip</button>
        <button type="button" class="tut-next" id="tut-next">Continue</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  const elCursor = root.querySelector('#tut-cursor');
  const elKeys = root.querySelector('#tut-keys');
  const elTitle = root.querySelector('#tut-title');
  const elBody = root.querySelector('#tut-body');
  const elStep = root.querySelector('#tut-step');
  const elNext = root.querySelector('#tut-next');
  const elSkip = root.querySelector('#tut-skip');

  let active = false;
  let index = 0;
  let t = 0;
  let waitLeft = 0;

  function showKeys(labels) {
    if (!labels || !labels.length) {
      elKeys.hidden = true;
      elKeys.innerHTML = '';
      return;
    }
    elKeys.hidden = false;
    elKeys.innerHTML = labels.map((lab) => `<kbd class="tut-key">${lab}</kbd>`).join('');
  }

  function placeCursor(nx, ny) {
    elCursor.style.left = `${nx * 100}%`;
    elCursor.style.top = `${ny * 100}%`;
  }

  function pointAt(el, fx = 0.5, fy = 0.5) {
    if (!el) { placeCursor(fx, fy); return; }
    const r = el.getBoundingClientRect();
    placeCursor((r.left + r.width * 0.5) / window.innerWidth, (r.top + r.height * 0.45) / window.innerHeight);
  }

  /**
   * The touch controls are built after this module, and the interact button
   * only exists visually when something is in reach, so the target is resolved
   * every frame rather than cached.
   */
  function targetOf(step) {
    if (!step || !step.target) return null;
    try { return document.querySelector(step.target); } catch { return null; }
  }

  function renderStep() {
    const step = STEPS[index];
    if (!step) return finish();
    t = 0;
    waitLeft = step.wait || 0;
    elStep.textContent = `${index + 1} / ${STEPS.length}`;
    elTitle.textContent = step.title;
    elBody.textContent = step.body;
    const needsAction = step.advance === 'keys';
    elNext.hidden = needsAction;
    elNext.textContent = index === STEPS.length - 1 ? 'Got it — play' : 'Continue';
    showKeys(step.keyLabels);

    if (step.mode === 'pointer') placeCursor(0.52, 0.42);
    else if (step.mode === 'keys') placeCursor(0.5, 0.62);
    else if (step.mode === 'look') placeCursor(0.5, 0.5);
    else if (step.mode === 'point') pointAt(targetOf(step), 0.5, 0.75);
    else if (step.mode === 'menu') {
      pointAt(menuTarget || document.getElementById('btn-home'), 0.08, 0.06);
    }
    if (audio && audio.play) audio.play('ui_open');
  }

  function next() {
    onUi();
    index += 1;
    if (index >= STEPS.length) finish();
    else renderStep();
  }

  function finish() {
    active = false;
    root.classList.remove('show');
    elKeys.hidden = true;
    markDone();
    if (audio && audio.play) audio.play('good');
  }

  elNext.addEventListener('click', (e) => { e.stopPropagation(); next(); });
  elSkip.addEventListener('click', (e) => { e.stopPropagation(); onUi(); finish(); });

  window.addEventListener('keydown', (e) => {
    if (!active || isTypingInUI()) return;
    const step = STEPS[index];
    if (!step || step.advance !== 'keys' || !step.keys) return;
    if (step.keys.includes(e.code)) {
      window.setTimeout(() => {
        if (active && STEPS[index] === step) next();
      }, 120);
    }
  });

  function start() {
    if (isShadowTutorialDone()) return false;
    active = true;
    index = 0;
    root.classList.add('show');
    renderStep();
    return true;
  }

  function update(dt) {
    if (!active) return;
    t += dt;
    const step = STEPS[index];
    if (!step) return;

    if (step.mode === 'look') {
      const a = t * 0.9;
      placeCursor(0.5 + Math.sin(a) * 0.38, 0.5 + Math.sin(a * 2) * 0.22);
      elCursor.classList.add('tut-cursor-look');
      if (step.advance === 'time') {
        waitLeft -= dt;
        if (waitLeft <= 0) elNext.hidden = false;
      }
    } else if (step.mode === 'keys') {
      elCursor.classList.remove('tut-cursor-look');
      const bob = Math.sin(t * 3) * 0.012;
      placeCursor(0.5, 0.62 + bob);
      elKeys.querySelectorAll('.tut-key').forEach((k, i) => {
        k.classList.toggle('tut-key-pulse', Math.floor(t * 2 + i) % 2 === 0);
      });
    } else if (step.mode === 'pointer') {
      elCursor.classList.remove('tut-cursor-look');
      placeCursor(0.52 + Math.sin(t * 1.4) * 0.03, 0.42 + Math.cos(t * 1.1) * 0.02);
    } else if (step.mode === 'point') {
      elCursor.classList.remove('tut-cursor-look');
      pointAt(targetOf(step), 0.5, 0.75);
    } else if (step.mode === 'menu') {
      pointAt(menuTarget || document.getElementById('btn-home'), 0.08, 0.06);
    }
  }

  return {
    start,
    update,
    finish,
    get active() { return active; },
  };
}
