// Fishing mini-game.
//
// Cozy by design: the only way to actually LOSE a fish is to hold the line
// under full tension through three separate warnings. Missing the hook just
// re-waits, casting badly only biases the loot table, and Esc always exits
// cleanly.
//
// Flow:  cast (power meter) -> wait (bobber + "!") -> reel (tension) -> catch
//
// The system owns three world-side props while a session runs — a bobber, a
// pool of expanding ripple rings and a line from the cat's carryAnchor — and
// disposes every one of them on the single exit path (`finish`).

import { EV } from './bus.js';
import * as UI from '../ui/kit.js';
import { ingredient, ingredientAvailable } from '../data/ingredients.js';
import { IS_TOUCH } from '../engine/device.js';

// The whole mini-game is "one button": tap to cast, tap to hook, hold to reel.
// On touch that button is the screen, so the prompts have to say so.
const T = IS_TOUCH
  ? { tap: 'Tap', TAP: 'TAP', hold: 'Hold', quit: '✕ Pack up' }
  : { tap: 'Press SPACE', TAP: 'SPACE', hold: 'Hold SPACE', quit: 'Esc — pack up' };

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const CAST = {
  speed: 1.15,            // full sweeps of the power meter per second
  flySeconds: 0.55,       // bobber arc before it lands
};

const WAIT = {
  min: 1.5,
  max: 5.0,
  hookWindow: 0.9,
};

const REEL = {
  barHalfBase: 0.105,     // half-height of the catch bar, 0..1 of the track
  barHalfPerLuck: 0.14,   // fishingLuck widens the bar
  lift: 2.35,             // upward acceleration while Space is held
  gravity: 1.20,
  drag: 1.7,
  bounce: 0.28,
  fillRate: 0.30,         // progress per second while the fish is inside the bar
  fillPerLuck: 0.09,
  slipRate: 0.055,        // progress lost per second while it is outside
  tensionUp: 0.245,       // per second while holding and OFF the fish
  tensionUpHeld: 0.155,   // per second while holding and ON the fish (rewarded)
  tensionDown: 0.44,
  warnAt: [0.52, 0.72, 0.90],
  fishSpeedPerLuck: 0.45, // fishingLuck slows the fish
};

const RARE_RARITY = 2;      // rarity >= this triggers the celebration
const RARE_IDS = new Set(['golden_koi']);

// ---------------------------------------------------------------------------
// Spot table
// ---------------------------------------------------------------------------

/**
 * A fishing spot.
 *   id, name, x, z, r          world anchor + reach radius
 *   district                   for the prompt / minimap
 *   quality [min, max]         base quality band rolled before bonuses
 *   pool [{ ingredientId, weight, minRep?, rarity }]
 *   requires { hours:[from,to], questAny:[ids], reputation }   optional gate
 *   y                          water surface height (defaults to 0.02)
 *   blurb                      flavour line shown on the cast screen
 */
export const DEFAULT_SPOTS = [
  {
    id: 'spot_harbor_steps',
    name: 'Harbour Steps',
    district: 'fish_harbor',
    x: -10.1, z: -61, r: 3.4, y: -0.08,
    quality: [0.44, 0.72],
    blurb: 'Shallow, busy, forgiving. Everybody starts here.',
    pool: [
      { ingredientId: 'mackerel', weight: 62, rarity: 0 },
      { ingredientId: 'salmon',   weight: 26, rarity: 1 },
      { ingredientId: 'shrimp',   weight: 12, rarity: 1 },
    ],
  },
  {
    id: 'spot_deep_point',
    name: 'The Point',
    district: 'fish_harbor',
    x: -29.5, z: -63.5, r: 3.6, y: -0.10,
    quality: [0.58, 0.88],
    blurb: 'Cold, deep water past the breakwater. Cast long.',
    pool: [
      { ingredientId: 'mackerel',  weight: 26, rarity: 0 },
      { ingredientId: 'salmon',    weight: 24, rarity: 1 },
      { ingredientId: 'tuna',      weight: 22, rarity: 2 },
      { ingredientId: 'sea_bream', weight: 14, rarity: 2, minRep: 30 },
    ],
  },
  {
    id: 'spot_rocky_ledge',
    name: 'Rockpool Ledge',
    district: 'fish_harbor',
    x: 20.6, z: -63, r: 3.2, y: -0.06,
    quality: [0.52, 0.82],
    blurb: 'Weed, barnacles and things that hide in holes.',
    pool: [
      { ingredientId: 'mackerel', weight: 30, rarity: 0 },
      { ingredientId: 'shrimp',   weight: 22, rarity: 1 },
      { ingredientId: 'scallop',  weight: 18, rarity: 2, minRep: 45 },
      { ingredientId: 'eel',      weight: 12, rarity: 2, minRep: 60 },
    ],
  },
  {
    id: 'spot_tower_canal',
    name: 'Tower Row Canal',
    district: 'downtown',
    x: 49, z: 29, r: 3.0, y: -0.12,
    quality: [0.28, 0.58],
    blurb: 'Concrete banks and a vending machine glow. Cheap, but it bites.',
    pool: [
      { ingredientId: 'mackerel', weight: 70, rarity: 0 },
      { ingredientId: 'shrimp',   weight: 22, rarity: 0 },
      { ingredientId: 'salmon',   weight: 8,  rarity: 1 },
    ],
  },
  {
    id: 'spot_lantern_pier',
    name: 'Lantern Pier',
    district: 'neon_street',
    x: 56, z: -54.2, r: 3.2, y: -0.05,
    quality: [0.70, 0.95],
    hidden: true,
    blurb: 'Lanterns on black water. Something gold moves under them.',
    requires: { hours: [19, 5], questAny: ['q07_rare_fish'] },
    pool: [
      { ingredientId: 'sea_bream', weight: 26, rarity: 2, minRep: 30 },
      { ingredientId: 'tuna',      weight: 22, rarity: 2 },
      { ingredientId: 'eel',       weight: 18, rarity: 2, minRep: 60 },
      { ingredientId: 'golden_koi', weight: 5, rarity: 3 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Overlay CSS (injected once)
// ---------------------------------------------------------------------------

const FX_CSS = `
.spf-root{
  position:fixed; inset:0; z-index:44; pointer-events:none;
  display:flex; flex-direction:column; align-items:center; justify-content:flex-end;
  padding-bottom:70px; gap:12px;
  font-family:"Hiragino Maru Gothic ProN","Quicksand",ui-rounded,"Nunito",system-ui,sans-serif;
  font-weight:800; color:#3b2f26;
}
.spf-root.spf-hidden{ display:none; }
.spf-card{
  background:linear-gradient(180deg,#fffaf0,#f2e4c8);
  border:2px solid rgba(59,47,38,.16); border-radius:16px;
  box-shadow:0 10px 26px rgba(59,47,38,.22);
  padding:10px 16px; display:flex; flex-direction:column; align-items:center; gap:8px;
}
.spf-title{ font-size:13px; letter-spacing:.05em; text-transform:uppercase; color:#c8503f; }
.spf-hint{ font-size:12px; color:#6d5a49; font-weight:700; text-align:center; }
.spf-esc{ position:fixed; top:16px; right:18px; font-size:12px; color:#fff8ef;
  background:rgba(43,33,26,.55); border-radius:999px; padding:5px 12px;
  font-family:inherit; font-weight:800; border:0; cursor:pointer; }

/* The tap/hold surface. It sits behind the card and the Esc chip (z-order by
   document order), so it can cover the screen without swallowing either. */
.spf-touch{ position:absolute; inset:0; display:none; touch-action:none; -webkit-tap-highlight-color:transparent; }
@media (pointer:coarse){
  .spf-touch{ display:block; pointer-events:auto; }
  .spf-esc{ pointer-events:auto; padding:9px 16px; font-size:13px;
    top:calc(env(safe-area-inset-top, 0px) + 12px); right:calc(env(safe-area-inset-right, 0px) + 12px); }
}
@media (max-width:700px){
  .spf-root{ padding-bottom:calc(env(safe-area-inset-bottom, 0px) + 28px); }
  .spf-card{ max-width:calc(100vw - 24px); }
  .spf-meter, .spf-bands{ width:min(280px, calc(100vw - 72px)); }
  .spf-track, .spf-tension{ height:min(230px, 34svh); }
  .spf-reel{ gap:14px; }
}

.spf-meter{ position:relative; width:280px; height:22px; border-radius:11px; overflow:hidden;
  background:linear-gradient(90deg,#8fb98a 0%,#8fb98a 40%,#e7c25f 40%,#e7c25f 75%,#d97b6c 75%,#d97b6c 100%);
  border:2px solid rgba(59,47,38,.2); }
.spf-needle{ position:absolute; top:-2px; bottom:-2px; width:5px; margin-left:-2.5px;
  background:#3b2f26; border-radius:3px; box-shadow:0 0 0 2px rgba(255,255,255,.65); }
.spf-bands{ display:flex; width:280px; justify-content:space-between; font-size:11px; color:#6d5a49; }

.spf-bob{ font-size:34px; line-height:1; transition:transform .12s; }
.spf-bang{ font-size:46px; color:#c8503f; text-shadow:0 3px 0 rgba(255,255,255,.8);
  animation:spf-bang .28s cubic-bezier(.2,1.6,.5,1) both; }
@keyframes spf-bang{ from{ transform:scale(.3) rotate(-14deg); opacity:0 } to{ transform:none; opacity:1 } }

.spf-reel{ display:flex; align-items:center; gap:18px; }
.spf-track{ position:relative; width:56px; height:230px; border-radius:28px;
  background:linear-gradient(180deg,#cfe2ea,#9dc0d0);
  border:3px solid rgba(59,47,38,.22); overflow:hidden; }
.spf-bar{ position:absolute; left:3px; right:3px; border-radius:20px;
  background:linear-gradient(180deg,rgba(246,196,69,.92),rgba(224,150,60,.92));
  box-shadow:inset 0 0 0 2px rgba(255,255,255,.5); transition:height .08s; }
.spf-fish{ position:absolute; left:50%; width:38px; height:38px; margin-left:-19px; margin-bottom:-19px;
  font-size:28px; text-align:center; line-height:38px; transition:opacity .1s; }
.spf-tension{ position:relative; width:16px; height:230px; border-radius:8px;
  background:rgba(59,47,38,.14); border:2px solid rgba(59,47,38,.2); overflow:hidden; }
.spf-tension > i{ position:absolute; left:0; right:0; bottom:0; display:block;
  background:linear-gradient(180deg,#d97b6c,#8fb98a); transition:height .06s; }
.spf-ring{ width:96px; height:96px; }
.spf-ring circle{ fill:none; stroke-linecap:round; transform:rotate(-90deg); transform-origin:50% 50%; }
.spf-warn{ font-size:13px; color:#c8503f; min-height:18px; }
.spf-shake{ animation:spf-shake .18s linear; }
@keyframes spf-shake{ 25%{transform:translateX(-5px)} 75%{transform:translateX(5px)} }

.spf-catch{ display:flex; flex-direction:column; align-items:center; gap:4px;
  animation:spf-pop .34s cubic-bezier(.2,1.5,.5,1) both; }
.spf-catch .spf-icon{ font-size:56px; }
.spf-catch.spf-rare .spf-icon{ animation:spf-spin 1.1s ease-in-out; }
.spf-catch .spf-name{ font-size:20px; }
@keyframes spf-pop{ from{ transform:scale(.4); opacity:0 } to{ transform:none; opacity:1 } }
@keyframes spf-spin{ 50%{ transform:scale(1.35) rotate(12deg) } }
.spf-spark{ position:fixed; pointer-events:none; font-size:22px; animation:spf-rise 1.1s ease-out forwards; }
@keyframes spf-rise{ to{ transform:translateY(-90px) rotate(40deg); opacity:0 } }
`;

let cssInjected = false;
function injectFxCss() {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;
  const s = document.createElement('style');
  s.id = 'sp-fishing-kit';
  s.textContent = FX_CSS;
  document.head.appendChild(s);
}

// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => clamp(v, 0, 1);

/**
 * @param {object} game  see src/game/CONTRACT.md
 */
export function createFishing(game) {
  const THREE = game.THREE;
  const bus = game.bus;
  const state = game.state;
  const rng = typeof game.rng === 'function' ? game.rng : Math.random;

  /** @type {Map<string, object>} */
  const spots = new Map();
  /** @type {Map<string, Function>} */
  const spotHandles = new Map();

  let session = null;
  let dom = null;
  let keysBound = false;

  // ------------------------------------------------------------------ utils
  const sfx = (name, opts) => {
    const a = game.audio;
    if (a && typeof a.play === 'function') { try { a.play(name, opts); } catch (e) { /* silent */ } }
  };
  const toast = (text, opts) => {
    if (bus) bus.emit(EV.TOAST, { text, icon: (opts && opts.icon) || '🎣', tone: (opts && opts.tone) || '' });
    else UI.toast(text, opts);
  };
  const luckValue = () => clamp(state && typeof state.upgradeValue === 'function'
    ? state.upgradeValue('fishingLuck', 0) : 0, 0, 0.85);

  function hourNow() {
    const c = game.clock;
    if (!c) return 12;
    const h = Number(c.hour);
    return Number.isFinite(h) ? h : 12;
  }

  /** Time-of-day / quest gate for a spot. */
  function spotAvailable(spot) {
    if (!spot) return false;
    const req = spot.requires;
    if (!req) return true;
    if (req.reputation != null && state.reputation < req.reputation) return false;
    if (Array.isArray(req.hours) && req.hours.length === 2) {
      const [from, to] = req.hours;
      const h = hourNow();
      const inWindow = from <= to ? (h >= from && h < to) : (h >= from || h < to);
      if (!inWindow) return false;
    }
    if (Array.isArray(req.questAny) && req.questAny.length) {
      const ok = req.questAny.some((q) => state.questActive(q) || state.questDone(q));
      if (!ok) return false;
    }
    if (req.flag && !state.flag(req.flag)) return false;
    return true;
  }

  // =========================================================================
  // World props — created on start, disposed on finish
  // =========================================================================
  const world = {
    group: null,
    bobber: null,
    line: null,
    linePos: null,
    ripples: [],
    disposables: [],
  };

  function trackGeo(g) { if (g) world.disposables.push(g); return g; }
  function trackMat(m) { if (m) world.disposables.push(m); return m; }

  function buildWorldProps(spot) {
    if (!THREE || !game.scene) return;
    const waterY = spot.y != null ? spot.y : 0.02;
    const group = new THREE.Group();
    group.name = 'fishingProps';
    group.position.set(spot.x, 0, spot.z);

    // ---- bobber -----------------------------------------------------------
    const bob = new THREE.Group();
    const topGeo = trackGeo(new THREE.SphereGeometry(0.14, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2));
    const botGeo = trackGeo(new THREE.SphereGeometry(0.14, 14, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2));
    const stickGeo = trackGeo(new THREE.CylinderGeometry(0.014, 0.014, 0.20, 6));
    const redMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xc8503f, roughness: 0.55 }));
    const whiteMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xf6efe0, roughness: 0.6 }));
    const inkMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x3b2f26, roughness: 0.8 }));
    bob.add(new THREE.Mesh(topGeo, redMat));
    bob.add(new THREE.Mesh(botGeo, whiteMat));
    const stick = new THREE.Mesh(stickGeo, inkMat);
    stick.position.y = 0.20;
    bob.add(stick);
    bob.position.set(0, waterY + 0.09, 0);
    bob.visible = false;
    group.add(bob);
    world.bobber = bob;

    // ---- ripple rings (shader-free: scale up + fade out) -------------------
    const ringGeo = trackGeo(new THREE.RingGeometry(0.44, 0.56, 28));
    for (let i = 0; i < 5; i++) {
      const mat = trackMat(new THREE.MeshBasicMaterial({
        color: 0xdff0f6, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide,
      }));
      const m = new THREE.Mesh(ringGeo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = waterY + 0.012 + i * 0.001;
      m.visible = false;
      m.frustumCulled = false;
      group.add(m);
      world.ripples.push({ mesh: m, mat, life: 0, dur: 1 });
    }

    // ---- line -------------------------------------------------------------
    const lineGeo = trackGeo(new THREE.BufferGeometry());
    world.linePos = new Float32Array(6);
    lineGeo.setAttribute('position', new THREE.BufferAttribute(world.linePos, 3));
    const lineMat = trackMat(new THREE.LineBasicMaterial({
      color: 0xf4f1ea, transparent: true, opacity: 0.75, depthWrite: false,
    }));
    const line = new THREE.Line(lineGeo, lineMat);
    line.frustumCulled = false;
    line.visible = false;
    // The line lives in world space, not in the spot-local group.
    game.scene.add(line);
    world.line = line;

    game.scene.add(group);
    world.group = group;
  }

  function disposeWorldProps() {
    if (world.group && world.group.parent) world.group.parent.remove(world.group);
    if (world.line && world.line.parent) world.line.parent.remove(world.line);
    for (const d of world.disposables) {
      try { if (d && typeof d.dispose === 'function') d.dispose(); } catch (e) { /* silent */ }
    }
    world.disposables.length = 0;
    world.ripples.length = 0;
    world.group = null;
    world.bobber = null;
    world.line = null;
    world.linePos = null;
  }

  function spawnRipple(scale = 1) {
    for (const r of world.ripples) {
      if (r.mesh.visible) continue;
      r.life = 0;
      r.dur = 1.1 + rng() * 0.5;
      r.scale0 = 0.22 * scale;
      r.scale1 = (1.5 + rng() * 0.5) * scale;
      r.mesh.visible = true;
      r.mat.opacity = 0.6;
      r.mesh.scale.setScalar(r.scale0);
      return;
    }
  }

  const _catPos = THREE ? new THREE.Vector3() : null;
  const _bobPos = THREE ? new THREE.Vector3() : null;

  function updateWorld(dt) {
    if (!world.group) return;
    const s = session;
    const waterY = s.spot.y != null ? s.spot.y : 0.02;

    // Bobber bob + cast arc.
    const bob = world.bobber;
    if (bob) {
      if (s.phase === 'cast') {
        bob.visible = false;
      } else if (s.phase === 'fly') {
        bob.visible = true;
        const k = clamp01(s.flyT / CAST.flySeconds);
        const arc = Math.sin(k * Math.PI) * 2.4;
        bob.position.set(0, waterY + 0.09 + arc, 0);
      } else {
        bob.visible = true;
        const tug = s.phase === 'hook' || s.phase === 'reel' ? 0.09 : 0.022;
        const rate = s.phase === 'reel' ? 9 : s.phase === 'hook' ? 12 : 2.2;
        bob.position.y = waterY + 0.09 - Math.abs(Math.sin(s.t * rate)) * tug;
        bob.rotation.z = Math.sin(s.t * rate * 0.7) * (s.phase === 'reel' ? 0.35 : 0.06);
      }
    }

    // Ripples.
    s.rippleT -= dt;
    if (s.rippleT <= 0 && (s.phase === 'wait' || s.phase === 'hook' || s.phase === 'reel')) {
      const busy = s.phase === 'reel' || s.phase === 'hook';
      s.rippleT = busy ? 0.22 + rng() * 0.14 : 0.85 + rng() * 0.7;
      spawnRipple(busy ? 1.25 : 1);
    }
    for (const r of world.ripples) {
      if (!r.mesh.visible) continue;
      r.life += dt;
      const k = r.life / r.dur;
      if (k >= 1) { r.mesh.visible = false; r.mat.opacity = 0; continue; }
      const e = 1 - Math.pow(1 - k, 2);
      r.mesh.scale.setScalar(r.scale0 + (r.scale1 - r.scale0) * e);
      r.mat.opacity = 0.6 * (1 - k) * (1 - k);
    }

    // Line: cat carry anchor -> bobber.
    const line = world.line;
    if (line && world.linePos) {
      const cat = game.player && game.player.cat;
      const anchor = cat && cat.carryAnchor;
      if (anchor && bob && bob.visible) {
        anchor.getWorldPosition(_catPos);
        bob.getWorldPosition(_bobPos);
        world.linePos[0] = _catPos.x; world.linePos[1] = _catPos.y + 0.18; world.linePos[2] = _catPos.z;
        world.linePos[3] = _bobPos.x; world.linePos[4] = _bobPos.y + 0.16; world.linePos[5] = _bobPos.z;
        line.geometry.attributes.position.needsUpdate = true;
        line.visible = true;
      } else {
        line.visible = false;
      }
    }
  }

  // =========================================================================
  // DOM overlay
  // =========================================================================
  function buildDom() {
    if (dom || typeof document === 'undefined') return;
    injectFxCss();
    UI.injectStyles();

    const root = document.createElement('div');
    root.className = 'spf-root spf-hidden';

    // Touch equivalent of the Space key: press anywhere is "press Space",
    // release is "release Space". The pointer is captured so a finger that
    // slides off the surface mid-reel still delivers its release.
    const touch = document.createElement('div');
    touch.className = 'spf-touch';
    touch.addEventListener('pointerdown', (e) => {
      if (!session) return;
      e.preventDefault();
      touch.setPointerCapture?.(e.pointerId);
      session.holding = true;
      pressSpace();
    });
    const lift = (e) => {
      if (!session) return;
      try { touch.releasePointerCapture?.(e.pointerId); } catch { /* already gone */ }
      session.holding = false;
    };
    touch.addEventListener('pointerup', lift);
    touch.addEventListener('pointercancel', lift);

    const esc = document.createElement('button');
    esc.type = 'button';
    esc.className = 'spf-esc';
    esc.textContent = T.quit;
    esc.addEventListener('click', () => {
      if (!session) return;
      // Same rule as the Escape key: a finished catch is already banked, so
      // skipping the celebration must still resolve with the real result.
      if (session.phase === 'done') finish(session.result);
      else abort();
    });

    const card = document.createElement('div');
    card.className = 'spf-card';
    const title = document.createElement('div');
    title.className = 'spf-title';
    const stage = document.createElement('div');
    stage.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:10px;min-height:64px;justify-content:center;';
    const hint = document.createElement('div');
    hint.className = 'spf-hint';
    card.append(title, stage, hint);

    // --- cast --------------------------------------------------------------
    const castWrap = document.createElement('div');
    castWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:5px;';
    const meter = document.createElement('div');
    meter.className = 'spf-meter';
    const needle = document.createElement('div');
    needle.className = 'spf-needle';
    meter.append(needle);
    const bands = document.createElement('div');
    bands.className = 'spf-bands';
    for (const label of ['near', 'mid', 'far']) {
      const b = document.createElement('span');
      b.textContent = label;
      bands.append(b);
    }
    castWrap.append(meter, bands);

    // --- wait --------------------------------------------------------------
    const waitWrap = document.createElement('div');
    waitWrap.style.cssText = 'display:flex;align-items:center;justify-content:center;height:56px;';
    const bobIcon = document.createElement('div');
    bobIcon.className = 'spf-bob';
    bobIcon.textContent = '🎣';
    waitWrap.append(bobIcon);

    // --- reel --------------------------------------------------------------
    const reelWrap = document.createElement('div');
    reelWrap.className = 'spf-reel';
    const track = document.createElement('div');
    track.className = 'spf-track';
    const barEl = document.createElement('div');
    barEl.className = 'spf-bar';
    const fishEl = document.createElement('div');
    fishEl.className = 'spf-fish';
    fishEl.textContent = '🐟';
    track.append(barEl, fishEl);

    const tension = document.createElement('div');
    tension.className = 'spf-tension';
    const tensionFill = document.createElement('i');
    tension.append(tensionFill);

    const ringWrap = document.createElement('div');
    ringWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;';
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('class', 'spf-ring');
    ring.setAttribute('viewBox', '0 0 100 100');
    const ringBg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ringBg.setAttribute('cx', '50'); ringBg.setAttribute('cy', '50'); ringBg.setAttribute('r', '42');
    ringBg.setAttribute('stroke', 'rgba(59,47,38,.16)'); ringBg.setAttribute('stroke-width', '10');
    const ringFg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ringFg.setAttribute('cx', '50'); ringFg.setAttribute('cy', '50'); ringFg.setAttribute('r', '42');
    ringFg.setAttribute('stroke', '#7ea36a'); ringFg.setAttribute('stroke-width', '10');
    const CIRC = 2 * Math.PI * 42;
    ringFg.setAttribute('stroke-dasharray', String(CIRC));
    ringFg.setAttribute('stroke-dashoffset', String(CIRC));
    ring.append(ringBg, ringFg);
    const warn = document.createElement('div');
    warn.className = 'spf-warn';
    ringWrap.append(ring, warn);

    reelWrap.append(track, tension, ringWrap);

    // --- result ------------------------------------------------------------
    const resultWrap = document.createElement('div');
    resultWrap.className = 'spf-catch';
    const resIcon = document.createElement('div');
    resIcon.className = 'spf-icon';
    const resName = document.createElement('div');
    resName.className = 'spf-name';
    const resMeta = document.createElement('div');
    resMeta.className = 'spf-hint';
    resultWrap.append(resIcon, resName, resMeta);

    // Order matters: the touch surface is first so the card and the Esc button
    // paint (and receive taps) on top of it.
    root.append(touch, esc, card);
    document.body.append(root);

    dom = {
      root, touch, card, title, stage, hint,
      castWrap, needle,
      waitWrap, bobIcon,
      reelWrap, track, barEl, fishEl, tensionFill, ringFg, warn, CIRC,
      resultWrap, resIcon, resName, resMeta,
      current: null,
    };
  }

  function showStage(node) {
    if (!dom) return;
    if (dom.current === node) return;
    while (dom.stage.firstChild) dom.stage.removeChild(dom.stage.firstChild);
    if (node) dom.stage.append(node);
    dom.current = node;
  }

  function setOverlay(on) {
    if (!dom) return;
    dom.root.classList.toggle('spf-hidden', !on);
  }

  function sparkle(count = 14) {
    if (typeof document === 'undefined') return;
    const icons = ['✨', '⭐', '🌟', '💫'];
    for (let i = 0; i < count; i++) {
      const s = document.createElement('div');
      s.className = 'spf-spark';
      s.textContent = icons[Math.floor(rng() * icons.length)];
      s.style.left = `${45 + (rng() - 0.5) * 34}%`;
      s.style.top = `${52 + (rng() - 0.5) * 18}%`;
      s.style.animationDelay = `${rng() * 0.4}s`;
      document.body.append(s);
      setTimeout(() => s.remove(), 1700);
    }
  }

  // =========================================================================
  // Input
  // =========================================================================
  function onKeyDown(e) {
    if (!session) return;
    if (e.code === 'Escape' || e.key === 'Escape') {
      e.preventDefault();
      // The catch has already been banked by the time we reach 'done', so
      // skipping the celebration must still resolve with the real result.
      if (session.phase === 'done') finish(session.result);
      else abort();
      return;
    }
    if (e.code !== 'Space' && e.key !== ' ') return;
    e.preventDefault();
    if (e.repeat) { session.holding = true; return; }
    session.holding = true;
    pressSpace();
  }

  function onKeyUp(e) {
    if (!session) return;
    if (e.code !== 'Space' && e.key !== ' ') return;
    e.preventDefault();
    session.holding = false;
  }

  function onBlur() { if (session) session.holding = false; }

  function bindKeys() {
    if (keysBound || typeof window === 'undefined') return;
    keysBound = true;
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
  }

  function unbindKeys() {
    if (!keysBound || typeof window === 'undefined') return;
    keysBound = false;
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', onBlur);
  }

  function pressSpace() {
    const s = session;
    if (!s) return;
    if (s.phase === 'cast') {
      s.power = s.meterValue;
      s.phase = 'fly';
      s.flyT = 0;
      sfx('cast');
      return;
    }
    if (s.phase === 'hook') {
      s.phase = 'reel';
      s.t = 0;
      startReel();
      sfx('hook');
    }
  }

  // =========================================================================
  // Phases
  // =========================================================================
  function startReel() {
    const s = session;
    const luck = s.luck;
    s.reel = {
      fish: 0.5,
      fishVel: 0,
      fishTarget: 0.5,
      fishTimer: 0.3,
      bar: 0.32,
      barVel: 0,
      barHalf: REEL.barHalfBase + REEL.barHalfPerLuck * luck,
      progress: 0,
      tension: 0,
      warnStage: 0,
      heldTime: 0,
      containedTime: 0,
      totalTime: 0,
      tensionAcc: 0,
    };
    if (dom) {
      dom.barEl.style.height = `${s.reel.barHalf * 2 * 100}%`;
      dom.warn.textContent = '';
      dom.hint.textContent = `${T.hold} to lift the bar — keep the fish inside it`;
    }
    showStage(dom && dom.reelWrap);
  }

  function beginWait(first) {
    const s = session;
    s.phase = 'wait';
    // A long cast biases toward rarer fish AND slightly longer waits.
    const stretch = 1 + s.band * 0.35;
    s.waitT = (WAIT.min + rng() * (WAIT.max - WAIT.min)) * stretch * (1 - s.luck * 0.18);
    s.rippleT = 0;
    if (dom) {
      dom.title.textContent = s.spot.name;
      dom.hint.textContent = first
        ? `Wait for the bite… then ${T.tap.toLowerCase()}`
        : 'It nosed the bait and left. Wait again…';
      dom.bobIcon.textContent = '🎣';
      dom.bobIcon.className = 'spf-bob';
    }
    showStage(dom && dom.waitWrap);
  }

  function bite() {
    const s = session;
    s.phase = 'hook';
    s.hookT = WAIT.hookWindow;
    if (dom) {
      dom.bobIcon.textContent = '❗';
      dom.bobIcon.className = 'spf-bang';
      dom.hint.textContent = `NOW — ${T.TAP}!`;
    }
    sfx('bite');
    spawnRipple(1.4);
  }

  // =========================================================================
  // Loot
  // =========================================================================
  function poolCandidates(spot) {
    const out = [];
    for (const e of spot.pool || []) {
      if (!e || !e.ingredientId) continue;
      if (e.minRep != null && state.reputation < e.minRep) continue;
      if (!ingredientAvailable(e.ingredientId, state)) continue;
      out.push(e);
    }
    return out;
  }

  /** Weighted pick with a rarity bias driven by cast distance + fishingLuck. */
  function pickFish(spot, band, luck) {
    let cands = poolCandidates(spot);
    if (!cands.length) {
      // Never leave the player empty-handed: fall back to anything ungated.
      cands = (spot.pool || []).filter((e) => e && ingredientAvailable(e.ingredientId, state));
    }
    if (!cands.length) cands = (spot.pool || []).slice(0, 1);
    if (!cands.length) return null;

    const bias = 0.3 + band * 1.25 + luck * 0.55;
    let total = 0;
    const weights = cands.map((e) => {
      const w = Math.max(0.0001, e.weight || 1) * (1 + bias * (e.rarity || 0));
      total += w;
      return w;
    });
    let roll = rng() * total;
    for (let i = 0; i < cands.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return cands[i];
    }
    return cands[cands.length - 1];
  }

  function succeed() {
    const s = session;
    const r = s.reel;
    const spot = s.spot;
    const luck = s.luck;

    const entry = pickFish(spot, s.band, luck);
    if (!entry) { finish({ caught: false, id: null, quality: 0, size: 0, seconds: s.elapsed, reason: 'empty' }); return; }

    const id = entry.ingredientId;
    const ing = ingredient(id);

    // Quality: spot band + how cleanly the reel went + a touch of luck.
    const qb = Array.isArray(spot.quality) ? spot.quality : [0.5, 0.75];
    const containRatio = r.totalTime > 0 ? clamp01(r.containedTime / r.totalTime) : 0.5;
    const avgTension = r.totalTime > 0 ? clamp01(r.tensionAcc / r.totalTime) : 0.5;
    const reelBonus = containRatio * 0.16 + (1 - avgTension) * 0.05;
    const size = 0.7 + rng() * 0.9;                       // 0.7 .. 1.6
    let quality = qb[0] + rng() * Math.max(0, qb[1] - qb[0]);
    quality += reelBonus + luck * 0.05 + (size - 1.15) * 0.06;
    quality = clamp(quality, 0.06, 1);

    const rarity = entry.rarity || 0;
    const rare = rarity >= RARE_RARITY || RARE_IDS.has(id);

    state.addItem(id, 1, { quality, freshness: 1 });
    if (state.stats) state.stats.fishCaught = (state.stats.fishCaught || 0) + 1;
    if (bus) bus.emit(EV.FISH_CAUGHT, { id, quality, size, spotId: spot.id, rarity, rare });

    const xp = Math.round(6 + rarity * 7 + quality * 9 + (size > 1.4 ? 4 : 0));
    state.addXp(xp);

    // Cat celebrates.
    const cat = game.player && game.player.cat;
    if (cat && typeof cat.setAction === 'function') cat.setAction('happy');
    if (game.player && typeof game.player.setMood === 'function') game.player.setMood('happy');

    const name = ing ? ing.name : id;
    const icon = ing ? ing.icon : '🐟';
    const sizeWord = size > 1.42 ? 'a monster' : size > 1.15 ? 'a good one' : size < 0.85 ? 'a little one' : 'a keeper';

    if (dom) {
      dom.title.textContent = rare ? 'RARE CATCH!' : 'Caught!';
      dom.resIcon.textContent = icon;
      dom.resName.textContent = name;
      dom.resMeta.textContent = `${sizeWord} · quality ${Math.round(quality * 100)}% · +${xp} xp`;
      dom.resultWrap.classList.toggle('spf-rare', rare);
      dom.hint.textContent = rare ? 'Nobody is going to believe this.' : 'Into the basket it goes.';
      showStage(dom.resultWrap);
    }

    if (rare) {
      sparkle(20);
      sfx('rare');
      toast(`${name} — a rare catch!`, { icon, tone: 'good' });
      if (id === 'golden_koi') state.setFlag('golden_koi_seen', true);
    } else {
      sfx('catch');
      toast(`Caught ${name}`, { icon, tone: 'good' });
    }

    s.phase = 'done';
    s.doneT = rare ? 2.1 : 1.3;
    s.result = { caught: true, id, quality, size, seconds: s.elapsed, rare, rarity, xp };
  }

  function snap() {
    const s = session;
    if (dom) {
      dom.title.textContent = 'Snap!';
      dom.resIcon.textContent = '〰️';
      dom.resName.textContent = 'The line went slack';
      dom.resMeta.textContent = 'No harm done — tie on a new hook and try again.';
      dom.resultWrap.classList.remove('spf-rare');
      dom.hint.textContent = 'Ease off the tension next time.';
      showStage(dom.resultWrap);
    }
    sfx('snap');
    toast('The line snapped — it got away', { icon: '〰️', tone: 'bad' });
    s.phase = 'done';
    s.doneT = 1.2;
    s.result = { caught: false, id: null, quality: 0, size: 0, seconds: s.elapsed, reason: 'snapped' };
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================
  function registerSpot(spot) {
    if (!spot || !spot.id) { console.warn('[fishing] registerSpot needs an id'); return () => {}; }
    const def = {
      r: 3.0, quality: [0.45, 0.75], pool: [], y: 0.02,
      ...spot,
    };
    spots.set(def.id, def);

    // Give it a world interaction so E starts the mini-game.
    if (game.interactions && typeof game.interactions.add === 'function') {
      const off = game.interactions.add({
        id: `fish:${def.id}`,
        x: def.x, z: def.z, r: def.r,
        key: 'E',
        priority: 1,
        enabled: () => !session && spotAvailable(def),
        label: () => `Fish at ${def.name || 'the water'}`,
        marker: { color: '#4e8fa8', height: 1.2 },
        data: { kind: 'fishing', spotId: def.id },
        onUse: () => { start(def.id); },
      });
      spotHandles.set(def.id, off);
    }
    return () => unregisterSpot(def.id);
  }

  function unregisterSpot(id) {
    const off = spotHandles.get(id);
    if (off) { try { off(); } catch (e) { /* silent */ } spotHandles.delete(id); }
    spots.delete(id);
  }

  /**
   * @param {string} spotId
   * @returns {Promise<{caught:boolean,id:string|null,quality:number,size:number,seconds:number}|null>}
   */
  function start(spotId) {
    if (session) return Promise.resolve(null);
    const spot = spots.get(spotId);
    if (!spot) {
      console.warn('[fishing] unknown spot', spotId);
      return Promise.resolve(null);
    }
    if (!spotAvailable(spot)) {
      toast('Not biting here right now', { icon: '🌙', tone: 'bad' });
      return Promise.resolve(null);
    }

    buildDom();

    return new Promise((resolve) => {
      session = {
        spot,
        resolve,
        phase: 'cast',
        t: 0,
        elapsed: 0,
        meterT: 0,
        meterValue: 0,
        power: 0,
        band: 0,
        flyT: 0,
        waitT: 0,
        hookT: 0,
        misses: 0,
        rippleT: 0,
        holding: false,
        doneT: 0,
        result: null,
        luck: luckValue(),
        reel: null,
      };

      try { game.setMode('fishing'); } catch (e) { /* silent */ }
      if (game.player && typeof game.player.lock === 'function') game.player.lock(true);
      if (game.interactions && typeof game.interactions.lock === 'function') game.interactions.lock(true);

      const cat = game.player && game.player.cat;
      if (cat && typeof cat.setAction === 'function') cat.setAction('fish');

      buildWorldProps(spot);
      bindKeys();
      setOverlay(true);
      if (dom) {
        dom.title.textContent = spot.name || 'Fishing';
        dom.hint.textContent = spot.blurb || `${T.tap} to set the cast`;
        showStage(dom.castWrap);
        dom.resultWrap.classList.remove('spf-rare');
      }
      sfx('rod_out');
    });
  }

  /** The one and only exit path — every phase ends here. */
  function finish(result) {
    const s = session;
    session = null;
    if (!s) return;

    unbindKeys();
    setOverlay(false);
    if (dom) showStage(null);
    disposeWorldProps();

    const cat = game.player && game.player.cat;
    if (cat && typeof cat.stopAction === 'function') cat.stopAction();

    if (game.interactions && typeof game.interactions.lock === 'function') game.interactions.lock(false);
    if (game.player && typeof game.player.lock === 'function') game.player.lock(false);
    try { game.setMode('explore'); } catch (e) { /* silent */ }

    try { s.resolve(result); } catch (e) { console.error('[fishing] resolve threw', e); }
  }

  function abort() {
    if (!session) return;
    finish(null);
  }

  // =========================================================================
  // Frame
  // =========================================================================
  function update(dt) {
    const s = session;
    if (!s) return;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;              // a tab-switch must not snap the line
    s.t += dt;
    s.elapsed += dt;

    switch (s.phase) {
      case 'cast': {
        s.meterT += dt * CAST.speed;
        const ping = s.meterT % 1;
        s.meterValue = ping < 0.5 ? ping * 2 : 2 - ping * 2;
        if (dom) dom.needle.style.left = `${s.meterValue * 100}%`;
        break;
      }
      case 'fly': {
        s.flyT += dt;
        if (s.flyT >= CAST.flySeconds) {
          s.band = s.power < 0.4 ? 0 : s.power < 0.75 ? 0.55 : 1;
          spawnRipple(1.5);
          sfx('splash');
          beginWait(true);
        }
        break;
      }
      case 'wait': {
        s.waitT -= dt;
        if (dom) {
          const wob = Math.sin(s.t * 3.4) * 4;
          dom.bobIcon.style.transform = `translateY(${wob}px)`;
        }
        if (s.waitT <= 0) bite();
        break;
      }
      case 'hook': {
        s.hookT -= dt;
        if (s.hookT <= 0) {
          s.misses++;
          // Missing is never a failure — it just goes back to waiting.
          beginWait(false);
        }
        break;
      }
      case 'reel': {
        stepReel(dt);
        break;
      }
      case 'done': {
        s.doneT -= dt;
        if (s.doneT <= 0) finish(s.result);
        break;
      }
      default: break;
    }

    updateWorld(dt);
  }

  function stepReel(dt) {
    const s = session;
    const r = s.reel;
    const luck = s.luck;
    r.totalTime += dt;

    // ---- fish: drifts toward wandering targets ----------------------------
    const slow = 1 - REEL.fishSpeedPerLuck * luck;
    r.fishTimer -= dt;
    if (r.fishTimer <= 0) {
      r.fishTarget = 0.08 + rng() * 0.84;
      r.fishTimer = (0.45 + rng() * 1.05) / Math.max(0.35, slow);
    }
    const k = 4.6 * slow;
    r.fishVel += (r.fishTarget - r.fish) * k * dt;
    r.fishVel *= (1 - 3.1 * dt);
    r.fish = clamp(r.fish + r.fishVel * dt, 0.03, 0.97);

    // ---- bar: hold to lift, release to fall -------------------------------
    if (s.holding) r.barVel += REEL.lift * dt;
    r.barVel -= REEL.gravity * dt;
    r.barVel *= (1 - REEL.drag * dt);
    r.bar += r.barVel * dt;
    if (r.bar < 0) { r.bar = 0; r.barVel = Math.abs(r.barVel) * REEL.bounce; }
    if (r.bar > 1) { r.bar = 1; r.barVel = -Math.abs(r.barVel) * REEL.bounce; }

    // ---- containment ------------------------------------------------------
    const contained = Math.abs(r.fish - r.bar) <= r.barHalf;
    if (contained) {
      r.containedTime += dt;
      r.progress = clamp01(r.progress + (REEL.fillRate + REEL.fillPerLuck * luck) * dt);
    } else {
      r.progress = clamp01(r.progress - REEL.slipRate * dt);
    }

    // ---- tension ----------------------------------------------------------
    if (s.holding) {
      r.heldTime += dt;
      r.tension += (contained ? REEL.tensionUpHeld : REEL.tensionUp) * dt;
    } else {
      r.tension -= REEL.tensionDown * dt;
    }
    r.tension = clamp(r.tension, 0, 1.05);
    r.tensionAcc += r.tension * dt;

    const stage = r.tension >= REEL.warnAt[2] ? 3
      : r.tension >= REEL.warnAt[1] ? 2
      : r.tension >= REEL.warnAt[0] ? 1 : 0;
    if (stage > r.warnStage) {
      r.warnStage = stage;
      const msg = ['', 'the rod is bending…', 'careful — it is straining!', 'LET GO! it is about to go!'][stage];
      if (dom) {
        dom.warn.textContent = msg;
        dom.track.classList.remove('spf-shake');
        void dom.track.offsetWidth;
        dom.track.classList.add('spf-shake');
      }
      sfx(stage >= 3 ? 'tension_high' : 'tension');
    } else if (stage < r.warnStage) {
      r.warnStage = stage;
      if (dom) dom.warn.textContent = stage === 0 ? '' : dom.warn.textContent;
    }

    // ---- paint ------------------------------------------------------------
    if (dom) {
      // The track's 0 is the bottom, CSS's 0 is the top.
      dom.barEl.style.bottom = `${(r.bar - r.barHalf) * 100}%`;
      dom.fishEl.style.bottom = `${r.fish * 100}%`;
      dom.fishEl.style.opacity = contained ? '1' : '0.72';
      dom.tensionFill.style.height = `${clamp01(r.tension) * 100}%`;
      dom.tensionFill.style.background = stage >= 3
        ? 'linear-gradient(180deg,#c8503f,#d97b6c)'
        : stage === 2 ? 'linear-gradient(180deg,#e0a24a,#f0b93f)'
        : 'linear-gradient(180deg,#7ea36a,#94bd80)';
      dom.ringFg.setAttribute('stroke-dashoffset', String(dom.CIRC * (1 - r.progress)));
      dom.ringFg.setAttribute('stroke', r.progress > 0.85 ? '#f0b93f' : '#7ea36a');
    }

    if (r.progress >= 1) { succeed(); return; }
    if (r.tension >= 1) { snap(); }
  }

  // =========================================================================
  function destroy() {
    abort();
    for (const id of Array.from(spotHandles.keys())) unregisterSpot(id);
    spots.clear();
    if (dom && dom.root && dom.root.parentNode) dom.root.parentNode.removeChild(dom.root);
    dom = null;
  }

  const api = {
    id: 'fishing',
    registerSpot,
    unregisterSpot,
    start,
    abort,
    update,
    destroy,
    spotAvailable,
    get active() { return !!session; },
    get spot() { return session ? session.spot : null; },
    get phase() { return session ? session.phase : null; },
    get spots() { return Array.from(spots.values()); },
  };
  return api;
}

export default createFishing;
