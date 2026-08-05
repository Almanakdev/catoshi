import * as THREE from 'three';

// Shared cutscene machinery — the hospital intro and the mission briefings are
// both built on this, so they look and behave identically: same letterbox, same
// fade, same typewriter subtitles, same skip affordances, same guarantee that
// control comes back exactly once.
//
// Two pieces:
//
//   createShotTrack(shots)      camera path. A shot is { t, p:[x,y,z], a:[x,y,z] }
//                               — position and aim point. Within a run of shots
//                               the camera eases between them with a smoothstep;
//                               a shot flagged `cut: true` starts a new segment
//                               instead, giving a hard cut with no interpolation
//                               across it (which is what a fly-across-the-city
//                               would otherwise turn into).
//
//   createCutscene({...})       the player: drives the track, reveals the cue
//                               list, owns the DOM, and calls onFinish once.
//
// A scene adds its own content through `onFrame(t)` — the intro poses the actor
// there, a briefing does nothing.

// ---------------------------------------------------------------------------
// Camera path
// ---------------------------------------------------------------------------
const smooth = (f) => f * f * (3 - 2 * f);
const lerp = (a, b, f) => a + (b - a) * f;

export function createShotTrack(shots) {
  // Split into continuous segments at every `cut`.
  const segments = [];
  let cur = [];
  for (const s of shots) {
    if (s.cut && cur.length) { segments.push(cur); cur = []; }
    cur.push(s);
  }
  if (cur.length) segments.push(cur);

  const _p = new THREE.Vector3();
  const _a = new THREE.Vector3();

  function sample(t, camera) {
    // Which segment owns this moment? The last one that has started.
    let seg = segments[0];
    for (const s of segments) if (t >= s[0].t) seg = s;
    if (!seg || !seg.length) return;

    // Hold the first/last pose outside the segment's own span.
    let i = 0;
    while (i < seg.length - 2 && t >= seg[i + 1].t) i++;
    const a = seg[i], b = seg[Math.min(i + 1, seg.length - 1)];
    const span = Math.max(1e-4, b.t - a.t);
    const f = smooth(Math.max(0, Math.min(1, (t - a.t) / span)));

    _p.set(lerp(a.p[0], b.p[0], f), lerp(a.p[1], b.p[1], f), lerp(a.p[2], b.p[2], f));
    _a.set(lerp(a.a[0], b.a[0], f), lerp(a.a[1], b.a[1], f), lerp(a.a[2], b.a[2], f));
    camera.position.copy(_p);
    camera.lookAt(_a);
  }

  return { sample, segments };
}

// ---------------------------------------------------------------------------
// DOM layer — one instance, shared by every cutscene.
// ---------------------------------------------------------------------------
const TYPE_SPEED = 42; // characters per second

function createLayer() {
  const root = document.getElementById('cine');
  const barTop = document.getElementById('cine-bar-top');
  const barBot = document.getElementById('cine-bar-bottom');
  const fade = document.getElementById('cine-fade');
  const sub = document.getElementById('cine-sub');
  const who = document.getElementById('cine-who');
  const text = document.getElementById('cine-text');
  const skip = document.getElementById('cine-skip');

  let active = null; // the cutscene currently playing, if any

  const api = {
    begin(scene) {
      active = scene;
      // Clear the gameplay HUD out of the cinematic frame.
      document.body.classList.add('cine-on');
      if (root) root.classList.add('show');
      if (skip) skip.style.display = '';
      api.setLetterbox(true);
    },
    end() {
      active = null;
      document.body.classList.remove('cine-on');
      api.setLetterbox(false);
      if (sub) sub.classList.remove('show');
      // The skip button is the only interactive part of the overlay — retire it
      // so it can't sit invisibly over the HUD once the scene is done.
      if (skip) skip.style.display = 'none';
    },
    hideRoot() { if (root) root.classList.remove('show'); },
    setLetterbox(on) {
      if (barTop) barTop.classList.toggle('in', on);
      if (barBot) barBot.classList.toggle('in', on);
    },
    setFade(v) { if (fade) fade.style.opacity = String(v); },
    cue(c, elapsed) {
      if (sub) sub.classList.toggle('show', !!c);
      if (!c) return;
      if (who) who.textContent = c.who || '';
      if (!text) return;
      const n = Math.floor(elapsed * TYPE_SPEED);
      const shown = c.text.slice(0, Math.max(0, n));
      if (text.textContent !== shown) text.textContent = shown;
    },
    get active() { return active; },
  };

  if (skip) skip.addEventListener('click', () => { if (active) active.skip(); });
  // Esc / Enter / Space is what people actually reach for.
  window.addEventListener('keydown', (e) => {
    if (!active) return;
    if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      active.skip();
    }
  });

  return api;
}

let layer = null;
export function cinematicLayer() {
  if (!layer) layer = createLayer();
  return layer;
}

// ---------------------------------------------------------------------------
// The player
// ---------------------------------------------------------------------------
/**
 * @param camera    THREE.Camera the scene takes over
 * @param shots     shot list for createShotTrack
 * @param cues      [{ t, hold, who, text }] subtitles
 * @param length    seconds; the hand-off happens at the end
 * @param fadeIn    seconds of fade up from black at the start (0 = no fade)
 * @param fadeOut   seconds of fade down to black before the hand-off
 * @param onFrame   (t, dt) => void, for scene-specific animation
 * @param onFinish  () => void, called EXACTLY once — grant control here
 * @param onAfter   () => void, called once the closing fade has cleared
 */
export function createCutscene(opts) {
  const {
    camera, shots = [], cues = [], length = 10,
    fadeIn = 0, fadeOut = 0,
    onFrame = () => {}, onFinish = () => {}, onAfter = () => {},
  } = opts;

  const track = createShotTrack(shots);
  const ui = cinematicLayer();

  let time = 0;
  let running = false;
  let finished = false;
  let cueIdx = -1;

  function currentCue(t) {
    for (let i = cues.length - 1; i >= 0; i--) {
      if (t >= cues[i].t && t < cues[i].t + cues[i].hold) return i;
    }
    return -1;
  }

  function play() {
    if (running || finished) return;
    running = true;
    time = 0;
    cueIdx = -1;
    ui.begin(api);
    ui.setFade(fadeIn > 0 ? 1 : 0);
    track.sample(0, camera);
    onFrame(0, 0);
  }

  function update(dt) {
    if (!running) return;
    time += dt;

    track.sample(time, camera);
    onFrame(time, dt);

    if (fadeIn > 0 && time < fadeIn) ui.setFade(1 - time / fadeIn);
    else if (fadeOut > 0 && time > length - fadeOut) ui.setFade((time - (length - fadeOut)) / fadeOut);
    else ui.setFade(0);

    const idx = currentCue(time);
    if (idx !== cueIdx) cueIdx = idx;
    ui.cue(idx >= 0 ? cues[idx] : null, idx >= 0 ? time - cues[idx].t : 0);

    if (time >= length) finish(false);
  }

  // `skipped` only changes how quickly we cut away. The hand-off below is
  // identical either way, so no path can leave the player without control.
  function finish(skipped) {
    if (finished) return;
    finished = true;
    running = false;
    ui.end();
    // Hold black across the teleport/hand-off when the scene fades out.
    if (fadeOut > 0) ui.setFade(1);

    onFinish();

    const settle = skipped ? 60 : 200;
    setTimeout(() => {
      ui.setFade(0);
      onAfter();
      setTimeout(() => { if (!ui.active) ui.hideRoot(); }, 700);
    }, fadeOut > 0 ? settle : 0);
  }

  const api = {
    play, update,
    skip: () => finish(true),
    get running() { return running; },
    get finished() { return finished; },
    get time() { return time; },
  };
  return api;
}
