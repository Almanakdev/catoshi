import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createCat } from './catModel.js';

// ---------------------------------------------------------------------------
// Optional "bring your own cat" path.
//
// Drop a .glb / .gltf / .vrm into public/models/ and point CAT_MODEL_URL at it
// (see public/models/README.txt). loadCatModel() wraps it in EXACTLY the same
// public API createCat() exposes, so the rest of the game never learns which
// one it got. Anything that goes wrong — missing file, bad parse, the VRM
// package failing to import — resolves to NULL rather than rejecting, so a
// broken drop-in can never take the game down with it.
// ---------------------------------------------------------------------------

const LOCO = ['idle', 'walk', 'run'];
const AIR = ['jump', 'fall'];
const HOLD = ['sit', 'sleep', 'carry', 'cook', 'fish', 'climb'];
const SHOT = ['land', 'meow', 'stretch', 'lick', 'happy', 'pounce'];
const ACTIONS = new Set([...LOCO, ...AIR, ...HOLD, ...SHOT, 'tired']);
const ONE_SHOT = new Set(SHOT);

// Case-insensitive clip-name aliases. Longest match wins, so "jumpstart" maps
// to jump rather than being swallowed by a shorter alias.
const ALIASES = {
  idle: ['idle', 'stand', 'standing', 'breathing', 'rest', 'restpose'],
  walk: ['walk', 'walking', 'trot', 'trotting', 'prowl'],
  run: ['run', 'running', 'sprint', 'gallop', 'dash'],
  jump: ['jump', 'jumpstart', 'jumpup', 'leap', 'hop'],
  fall: ['fall', 'falling', 'jumploop', 'airborne', 'inair'],
  land: ['land', 'landing', 'jumpend', 'jumpdown', 'touchdown'],
  sit: ['sit', 'sitting', 'sitidle', 'sitdown'],
  sleep: ['sleep', 'sleeping', 'lie', 'liedown', 'laydown', 'laying', 'nap'],
  carry: ['carry', 'carrying', 'hold', 'holding', 'pickup', 'deliver'],
  cook: ['cook', 'cooking', 'chop', 'chopping', 'work', 'working', 'craft'],
  fish: ['fish', 'fishing', 'paw', 'pawing', 'dab', 'dig'],
  meow: ['meow', 'talk', 'talking', 'speak', 'cry', 'shout', 'yell'],
  stretch: ['stretch', 'stretching', 'yawn', 'yawning', 'wakeup'],
  lick: ['lick', 'licking', 'groom', 'grooming', 'clean', 'eat', 'eating', 'drink'],
  happy: ['happy', 'cheer', 'cheering', 'celebrate', 'dance', 'dancing', 'excited', 'joy'],
  tired: ['tired', 'exhausted', 'sad', 'droop'],
  climb: ['climb', 'climbing', 'ladder'],
  pounce: ['pounce', 'attack', 'swipe', 'punch', 'jumpattack', 'scratch'],
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Absolutise the url before it reaches three.
 *
 * THREE.FileLoader registers the url in its in-flight `loading` map BEFORE it
 * builds `new Request(url)` — and Request throws synchronously on a url it
 * can't parse. The throw escapes past the fetch's .catch(), so the stale entry
 * is never cleaned up and EVERY later load of that same url silently takes the
 * "duplicate request" path and never calls back. Handing three a fully
 * resolved url keeps us out of that trap.
 */
function resolveUrl(url) {
  try {
    const base =
      (typeof document !== 'undefined' && document.baseURI) ||
      (typeof location !== 'undefined' && location.href) ||
      'http://localhost/';
    return new URL(url, base).href;
  } catch (e) {
    return url;
  }
}

/** Best action key for a clip name, or null. */
function matchAction(clipName) {
  const n = norm(clipName);
  if (!n) return null;
  let best = null;
  let bestLen = 0;
  for (const key in ALIASES) {
    for (const a of ALIASES[key]) {
      if (n.includes(a) && a.length > bestLen) { best = key; bestLen = a.length; }
    }
  }
  return best;
}

/**
 * Load a cat from a GLB/GLTF/VRM url and wrap it in the createCat() API.
 * Resolves to null on ANY failure — never rejects.
 *
 * @param {string} url
 * @param {{targetHeight?: number, timeout?: number}} [opts] targetHeight is the
 *        overall height in world units (the procedural cat is ~1.35 to the ear
 *        tips, which is the default). `timeout` (ms, 0 disables) bounds how
 *        long a stalled download can hold up the game.
 */
export async function loadCatModel(url, { targetHeight = 1.35, timeout = 20000 } = {}) {
  if (typeof url !== 'string' || !url.trim()) return null;
  const height = Number.isFinite(targetHeight) && targetHeight > 0 ? targetHeight : 1.35;
  const ms = Number.isFinite(timeout) && timeout > 0 ? timeout : 0;
  const src = resolveUrl(url.trim());

  // A load that never settles would hang the whole boot sequence, which is just
  // as bad as a crash — so every await below is bounded.
  let timer = null;
  const TIMED_OUT = Symbol('timeout');
  const bound = (p) =>
    ms ? Promise.race([p, new Promise((res) => { timer = setTimeout(() => res(TIMED_OUT), ms); })]) : p;

  let gltf = null;
  let vrm = null;
  try {
    const loader = new GLTFLoader();
    const isVrm = /\.vrm(\?.*)?$/i.test(src);
    if (isVrm) {
      // @pixiv/three-vrm is a real dependency, but importing it dynamically
      // keeps it out of the main bundle for everyone using the procedural cat.
      const mod = await import('@pixiv/three-vrm');
      const Plugin = mod.VRMLoaderPlugin || (mod.default && mod.default.VRMLoaderPlugin);
      if (!Plugin) throw new Error('VRMLoaderPlugin not found in @pixiv/three-vrm');
      loader.register((parser) => new Plugin(parser));
      gltf = await bound(loader.loadAsync(src));
      if (gltf === TIMED_OUT) throw new Error(`timed out after ${ms}ms`);
      vrm = (gltf.userData && gltf.userData.vrm) || null;
      if (vrm) {
        const Utils = mod.VRMUtils || (mod.default && mod.default.VRMUtils);
        if (Utils) {
          try { if (Utils.rotateVRM0) Utils.rotateVRM0(vrm); } catch (e) { /* optional */ }
          try { if (Utils.removeUnnecessaryVertices) Utils.removeUnnecessaryVertices(gltf.scene); } catch (e) { /* optional */ }
          try { if (Utils.combineSkeletons) Utils.combineSkeletons(gltf.scene); } catch (e) { /* optional */ }
        }
      }
    } else {
      gltf = await bound(loader.loadAsync(src));
      if (gltf === TIMED_OUT) throw new Error(`timed out after ${ms}ms`);
    }
  } catch (err) {
    console.warn('[cat] loadCatModel failed for', url, '-', err && err.message ? err.message : err);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }

  try {
    return wrapLoaded(gltf, vrm, height, url);
  } catch (err) {
    console.warn('[cat] loadCatModel could not wrap', url, '-', err && err.message ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
function wrapLoaded(gltf, vrm, targetHeight, url) {
  const model = (vrm && vrm.scene) || gltf.scene || (gltf.scenes && gltf.scenes[0]);
  if (!model) throw new Error('no scene in file');

  const group = new THREE.Group();
  group.name = 'cat(loaded)';
  const inner = new THREE.Group();
  group.add(inner);

  const materials = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;
    const m = o.material;
    for (const mm of Array.isArray(m) ? m : [m]) {
      if (!mm) continue;
      if (mm.color && !mm.userData._catBase) mm.userData._catBase = mm.color.clone();
      materials.push(mm);
    }
  });

  // Auto-scale to targetHeight, then drop so the lowest point sits at y = 0.
  const bb = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  bb.getSize(size);
  if (size.y > 1e-5) model.scale.multiplyScalar(targetHeight / size.y);
  model.updateMatrixWorld(true);
  const bb2 = new THREE.Box3().setFromObject(model);
  if (Number.isFinite(bb2.min.y)) model.position.y -= bb2.min.y;
  inner.add(model);

  // A carry anchor roughly in front of the chest, at 60% of the height.
  const carryAnchor = new THREE.Object3D();
  carryAnchor.name = 'catCarryAnchor';
  carryAnchor.position.set(0, targetHeight * 0.6, targetHeight * 0.5);
  inner.add(carryAnchor);

  // Best-effort head / tail handles so gameplay code that pokes them still works.
  let head = null;
  let tail = null;
  if (vrm && vrm.humanoid && vrm.humanoid.getNormalizedBoneNode) {
    try { head = vrm.humanoid.getNormalizedBoneNode('head'); } catch (e) { head = null; }
  }
  model.traverse((o) => {
    const n = norm(o.name);
    if (!head && n.includes('head')) head = o;
    if (!tail && n.includes('tail')) tail = o;
  });
  if (!head) { head = new THREE.Object3D(); head.position.y = targetHeight * 0.85; inner.add(head); }
  if (!tail) { tail = new THREE.Object3D(); inner.add(tail); }

  // ---- animation ----------------------------------------------------------
  const clips = Array.isArray(gltf.animations) ? gltf.animations : [];
  const mixer = clips.length ? new THREE.AnimationMixer(model) : null;
  const byAction = new Map(); // action name -> AnimationAction
  const durations = new Map();
  if (mixer) {
    for (const clip of clips) {
      const key = matchAction(clip.name);
      if (!key || byAction.has(key)) continue;
      const act = mixer.clipAction(clip);
      byAction.set(key, act);
      durations.set(key, clip.duration || 0);
    }
    // Nothing matched at all? Fall back to the first clip as idle so the model
    // at least breathes instead of standing frozen.
    if (!byAction.size && clips[0]) {
      const act = mixer.clipAction(clips[0]);
      byAction.set('idle', act);
      durations.set('idle', clips[0].duration || 0);
    }
  }

  let current = null;      // AnimationAction
  let currentName = 'idle';
  let shot = null;         // one-shot name currently playing
  let shotT = 0, shotDur = 0;
  let hold = null;
  let manualAir = 0, manualAirName = 'jump';
  let loco = 'idle';
  let tired = 0;
  let mood = 'neutral';
  let punchCd = 0;
  let speedScale = 1;
  let disposed = false;

  function fadeTo(name, fade = 0.22) {
    const next = byAction.get(name);
    currentName = name;
    if (!next || next === current) return false;
    next.reset();
    next.setLoop(ONE_SHOT.has(name) || AIR.includes(name) ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = ONE_SHOT.has(name) || AIR.includes(name);
    next.enabled = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.play();
    if (current) current.crossFadeTo(next, fade, false);
    current = next;
    return true;
  }

  // ---- API ----------------------------------------------------------------
  function setAction(name, options = {}) {
    if (disposed || typeof name !== 'string') return 0;
    const n = name.toLowerCase().trim();
    if (!ACTIONS.has(n)) return 0;

    if (n === 'tired') { tired = clamp01(numOr(options && options.amount, 1)); return 0.22; }
    if (LOCO.includes(n)) { hold = null; shot = null; shotDur = 0; return 0.22; }
    if (AIR.includes(n)) {
      shot = null; shotDur = 0;
      manualAirName = n;
      manualAir = Math.max(0.05, numOr(options && options.duration, n === 'jump' ? 0.6 : 0.5));
      fadeTo(byAction.has(n) ? n : loco);
      return manualAir;
    }
    if (HOLD.includes(n)) {
      hold = n; shot = null; shotDur = 0;
      fadeTo(byAction.has(n) ? n : 'idle');
      // A hold has no natural end — report the blend time.
      return 0.22;
    }
    // one-shot: without a matching clip it is a silent no-op that still costs
    // the caller nothing, so return 0 ("could not play").
    if (!byAction.has(n)) return 0;
    shot = n;
    shotT = 0;
    shotDur = durations.get(n) || 0.4;
    fadeTo(n, 0.12);
    return shotDur;
  }
  const playAction = setAction;

  function stopAction() {
    shot = null; shotT = 0; shotDur = 0;
    hold = null; manualAir = 0;
  }

  const actionReady = (name) =>
    typeof name === 'string' && ACTIONS.has(name.toLowerCase().trim()) && byAction.has(name.toLowerCase().trim());

  function update(dt, speed = 0, options = {}) {
    if (disposed) return;
    const d = clamp(numOr(dt, 0.016), 0, 0.1);
    const O = options && typeof options === 'object' ? options : {};
    const ss = Math.max(0.0001, numOr(O.speedScale, speedScale));
    const s = Math.abs(numOr(speed, 0)) * ss;
    if (punchCd > 0) punchCd -= d;
    if (manualAir > 0) manualAir -= d;

    if (shot) {
      shotT += d;
      if (shotT >= shotDur) { shot = null; shotT = 0; shotDur = 0; }
    }

    loco = s < 0.15 ? 'idle' : s < 3.2 ? 'walk' : 'run';
    const airborne = !!O.airborne || manualAir > 0;

    if (!shot) {
      let want;
      if (airborne) want = byAction.has(manualAirName) ? manualAirName : (byAction.has('jump') ? 'jump' : loco);
      else if (hold) want = byAction.has(hold) ? hold : 'idle';
      else want = loco;
      if (!byAction.has(want)) want = byAction.has('idle') ? 'idle' : want;
      fadeTo(want);
    }

    if (current) current.setEffectiveTimeScale(1 - 0.3 * tired);
    if (mixer) mixer.update(d);
    if (vrm && typeof vrm.update === 'function') vrm.update(d);
  }

  function setTired(v) { tired = clamp01(numOr(v, 0)); }
  function setMood(m) { if (typeof m === 'string') mood = m; }   // no-op beyond bookkeeping
  function setTint(hex) {
    let c;
    try { c = new THREE.Color(hex); } catch (e) { return; }
    for (const m of materials) {
      if (!m.color) continue;
      const base = m.userData._catBase || m.color;
      m.color.copy(base).multiply(c);
    }
  }
  function setHeight(h) { const s = numOr(h, 1); if (s > 0) group.scale.setScalar(s); }
  function setFacingOffset(rad) { inner.rotation.y = numOr(rad, 0); }
  function setCutscene() { /* no rigged cutscene poses on a drop-in model */ }
  function setSpeedScale(k) { speedScale = Math.max(0.0001, numOr(k, 1)); }

  function punch() {
    if (disposed || punchCd > 0 || shot) return false;
    punchCd = 0.55;
    return setAction('pounce') > 0;
  }

  const _v = new THREE.Vector3();
  const _bb = new THREE.Box3();
  function footWorldY() {
    if (disposed) return null;
    group.updateMatrixWorld(true);
    _bb.setFromObject(model);
    return Number.isFinite(_bb.min.y) ? _bb.min.y : null;
  }
  function groundFeet(floorY = 0, maxCorrection = 1.5) {
    if (disposed) return;
    const f = numOr(floorY, 0);
    const lim = Math.abs(numOr(maxCorrection, 1.5));
    const fy = footWorldY();
    if (fy === null) return;
    group.position.y += clamp(f - fy, -lim, lim);
    group.updateMatrixWorld(true);
  }
  function eyeHeight() {
    if (disposed) return targetHeight * 0.85 * group.scale.y;
    group.updateMatrixWorld(true);
    head.getWorldPosition(_v);
    const base = new THREE.Vector3();
    group.getWorldPosition(base);
    const h = _v.y - base.y;
    return Number.isFinite(h) && h > 0.02 ? h : targetHeight * 0.85 * group.scale.y;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (mixer) { try { mixer.stopAllAction(); mixer.uncacheRoot(model); } catch (e) { /* ignore */ } }
    model.traverse((o) => {
      if (!o.isMesh) return;
      if (o.geometry) { try { o.geometry.dispose(); } catch (e) { /* ignore */ } }
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m) { try { m.dispose(); } catch (e) { /* ignore */ } }
      }
    });
    if (group.parent) group.parent.remove(group);
  }

  console.info(
    `[cat] loaded "${url}" — ${clips.length} clip(s), mapped: ${[...byAction.keys()].join(', ') || 'none'}`
  );

  return {
    group, inner, head, tail, carryAnchor, vrm, gltf, mixer, materials,
    update,
    setAction, playAction, stopAction, actionReady,
    get actionPlaying() { return !!shot; },
    get action() { return shot || (manualAir > 0 ? manualAirName : (hold || loco)); },
    get mood() { return mood; },
    setTired, setMood, setTint, setHeight, setFacingOffset, setCutscene, setSpeedScale,
    groundFeet, footWorldY, punch, eyeHeight, dispose,
    isProcedural: false,
  };
}

// ---------------------------------------------------------------------------
/**
 * The one call the game should make: hand it the config and get a cat.
 * With `url` set it tries the drop-in model first and quietly falls back to the
 * procedural cat if that fails, so the game always ends up with something.
 */
export function catFromOptions({ url, targetHeight, timeout, ...catOpts } = {}) {
  if (typeof url === 'string' && url.trim()) {
    return loadCatModel(url, { targetHeight, timeout }).then((loaded) => {
      if (loaded) {
        // Carry across the knobs a drop-in model can still honour, so swapping
        // in a GLB doesn't silently change how the gait reads or how NPCs tint.
        if (Number.isFinite(catOpts.speedScale)) loaded.setSpeedScale(catOpts.speedScale);
        if (Number.isFinite(catOpts.scale) && catOpts.scale > 0) loaded.setHeight(catOpts.scale);
        return loaded;
      }
      console.info('[cat] falling back to the procedural cat (model failed to load):', url);
      return createCat(catOpts);
    });
  }
  console.info('[cat] using the procedural cat (no CAT_MODEL_URL set)');
  return Promise.resolve(createCat(catOpts));
}

// --- local helpers ---------------------------------------------------------
function numOr(v, d) { return Number.isFinite(v) ? v : d; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function clamp01(v) { return clamp(numOr(v, 0), 0, 1); }

export default catFromOptions;
