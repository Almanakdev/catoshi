// Sushi Paws — entry point.
//
// This file owns three things and nothing else:
//   1. the renderer / scene / sky / lighting / post stack,
//   2. construction order for every gameplay system,
//   3. the frame loop.
// Systems talk to each other over the bus (src/game/bus.js), never directly.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { GAME, CAT_MODEL_URL, PLAYER_CAT, RENDER, QUALITY, DEBUG } from './config.js';
import { createBus, EV } from './game/bus.js';
import { createState } from './game/state.js';
import { createSaveSystem } from './game/save.js';
import { createInteractions } from './game/interactions.js';
import { createClock } from './game/clock.js';
import { createWorld } from './world/world.js';
import { createPlayer } from './player.js';
import { createOrders } from './game/orders.js';
import { createRestaurant } from './game/restaurant.js';
import { createCooking } from './game/cooking.js';
import { createFishing, DEFAULT_SPOTS } from './game/fishing.js';
import { createDelivery } from './game/delivery.js';
import { createForaging } from './game/foraging.js';
import { createQuests } from './game/questEngine.js';
import { createNpcs } from './game/npcRuntime.js';
import { createDialogueUI } from './ui/dialogueUI.js';
import { createUI, createPanelManager } from './ui/index.js';
import { createAudio } from './audio/audio.js';
import { catFromOptions } from './cat/catLoader.js';
import { makeToonGradient } from './engine/textures.js';
import { isTypingInUI } from './engine/inputGuard.js';
import * as KIT from './ui/kit.js';
import { HOME, DISTRICTS } from './data/districts.js';
import { UPGRADES } from './data/upgrades.js';
import { checkRecipeUnlocks } from './data/recipes.js';

// ===========================================================================
// Renderer, scene, camera
// ===========================================================================
const app = document.getElementById('app') || document.body;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, RENDER.maxPixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NoToneMapping;
renderer.info.autoReset = false;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.15, 900);
camera.position.set(HOME.spawn.x, 4, HOME.spawn.z + 8);

// --- Sky ---------------------------------------------------------------
// A single inverted sphere with a three-stop vertical gradient. Cheap, and the
// three colours are all we need to sell dawn / noon / dusk / night.
const SKY = {
  day:   { top: 0x6fb2e0, mid: 0xbfe0f0, bot: 0xf7e9cf },
  dusk:  { top: 0x4a5f96, mid: 0xe08a5a, bot: 0xf6c98a },
  dawn:  { top: 0x8fb6de, mid: 0xf2cdae, bot: 0xfbe7c8 },
  night: { top: 0x131a33, mid: 0x243256, bot: 0x3c4468 },
};
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: {
    top: { value: new THREE.Color(SKY.day.top) },
    mid: { value: new THREE.Color(SKY.day.mid) },
    bot: { value: new THREE.Color(SKY.day.bot) },
  },
  vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform vec3 top, mid, bot; varying vec3 vP;
    void main(){
      float h = normalize(vP).y;
      vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.55, h))
                       : mix(mid, bot, smoothstep(0.0, -0.35, h));
      gl_FragColor = vec4(c, 1.0);
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 24, 16), skyMat);
sky.frustumCulled = false;
scene.add(sky);

scene.fog = new THREE.Fog(0xbfe0f0, RENDER.fog.near, RENDER.fog.far);

// --- Lights -------------------------------------------------------------
const sunLight = new THREE.DirectionalLight(0xfff2d8, 2.1);
sunLight.position.set(60, 90, 40);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 260;
sunLight.shadow.camera.left = -60;
sunLight.shadow.camera.right = 60;
sunLight.shadow.camera.top = 60;
sunLight.shadow.camera.bottom = -60;
sunLight.shadow.bias = -0.0012;
sunLight.shadow.normalBias = 0.03;
scene.add(sunLight);
scene.add(sunLight.target);

const hemi = new THREE.HemisphereLight(0xcfe6f5, 0xd9c6a2, 0.9);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0xffffff, 0.42);
scene.add(ambient);

const gradientMap = makeToonGradient(4);

// ===========================================================================
// Core services
// ===========================================================================
const bus = createBus();
const state = createState(bus);
state.registerUpgrades(UPGRADES);
const save = createSaveSystem(state, bus, { autosaveSeconds: 90 });
save.loadSettings();
const audio = createAudio(state);
const interactions = createInteractions(bus);

// A tiny seeded RNG so anything that must be reproducible can be.
let rngSeed = 0x9e3779b9;
function rng() {
  rngSeed |= 0; rngSeed = (rngSeed + 0x6d2b79f5) | 0;
  let t = Math.imul(rngSeed ^ (rngSeed >>> 15), 1 | rngSeed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

let mode = 'boot';
const game = {
  THREE, scene, camera, renderer,
  bus, EV, state, save, interactions, audio, rng,
  ui: KIT,
  get mode() { return mode; },
  setMode(m) {
    if (m === mode) return;
    mode = m;
    if (m !== 'explore') interactions.lock(true);
    else interactions.lock(false);
  },
};

// ===========================================================================
// World + player
// ===========================================================================
const world = createWorld(game, { gradientMap });
scene.add(world.group);
game.world = world;

game.panels = createPanelManager(game);

// ===========================================================================
// Day / night
// ===========================================================================
const _c = new THREE.Color();
function applyDayNight(night, hourF) {
  // Dusk is the dramatic one; dawn gets its own paler palette and a narrower
  // window so 07:00 on day one already reads as a bright morning.
  const dusk = Math.max(0, 1 - Math.abs(hourF - 18.4) / 2.4) * (1 - night * 0.5);
  const dawn = Math.max(0, 1 - Math.abs(hourF - 5.9) / 1.5) * (1 - night * 0.5);
  const tint = dusk >= dawn ? SKY.dusk : SKY.dawn;
  const warm = Math.max(dusk, dawn) * (dusk >= dawn ? 0.85 : 0.6);

  const lerp3 = (uni, a, b, t, c, t2) => {
    _c.set(a).lerp(new THREE.Color(b), t);
    if (c != null) _c.lerp(new THREE.Color(c), t2);
    uni.value.copy(_c);
  };
  lerp3(skyMat.uniforms.top, SKY.day.top, SKY.night.top, night, tint.top, warm);
  lerp3(skyMat.uniforms.mid, SKY.day.mid, SKY.night.mid, night, tint.mid, warm);
  lerp3(skyMat.uniforms.bot, SKY.day.bot, SKY.night.bot, night, tint.bot, warm);
  scene.fog.color.copy(skyMat.uniforms.mid.value);

  // Sun arc: up at 6:00, peak at noon, down at 18:00.
  const arc = ((hourF - 6) / 12) * Math.PI;
  const sx = Math.cos(arc) * 90, sy = Math.max(6, Math.sin(arc) * 110), sz = 48;
  const p = player ? player.position : HOME.spawn;
  sunLight.position.set(p.x + sx * 0.5, sy, (p.z || 0) + sz);
  sunLight.target.position.set(p.x, 0, p.z || 0);
  sunLight.target.updateMatrixWorld();

  sunLight.intensity = 2.1 * (1 - night * 0.86);
  sunLight.color.setHex(dusk > 0.3 ? 0xffcf9a : dawn > 0.3 ? 0xffe6c4 : 0xfff2d8);
  hemi.intensity = 0.9 * (1 - night * 0.55) + night * 0.28;
  hemi.color.setHex(night > 0.5 ? 0x2e3a5c : 0xcfe6f5);
  ambient.intensity = 0.42 * (1 - night * 0.35) + night * 0.22;

  for (const m of world.glowMats) if (m) m.emissiveIntensity = 0.05 + night * 1.15;
  for (const m of world.neonMats) if (m) m.emissiveIntensity = 0.3 + night * 1.0;
  if (bloomPass) bloomPass.strength = 0.10 + night * 0.22;
}

// ===========================================================================
// Post-processing
// ===========================================================================
// A depth-sobel ink outline: it needs no extra normal buffer, so it stays cheap
// while giving the whole city the drawn-cartoon edge the art direction asks for.
const OutlineShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    cameraNear: { value: 0.15 },
    cameraFar: { value: 900 },
    outlineColor: { value: new THREE.Color(RENDER.outlineColor) },
    strength: { value: RENDER.outlineStrength },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    #include <packing>
    uniform sampler2D tDiffuse, tDepth;
    uniform vec2 resolution;
    uniform float cameraNear, cameraFar, strength;
    uniform vec3 outlineColor;
    varying vec2 vUv;
    float lin(vec2 uv){
      float d = texture2D(tDepth, uv).x;
      return viewZToOrthographicDepth(perspectiveDepthToViewZ(d, cameraNear, cameraFar), cameraNear, cameraFar);
    }
    void main(){
      vec4 src = texture2D(tDiffuse, vUv);
      vec2 t = 1.0 / resolution;
      float c = lin(vUv);
      float e = 0.0;
      e += abs(lin(vUv + vec2( t.x, 0.0)) - c);
      e += abs(lin(vUv + vec2(-t.x, 0.0)) - c);
      e += abs(lin(vUv + vec2(0.0,  t.y)) - c);
      e += abs(lin(vUv + vec2(0.0, -t.y)) - c);
      // Scale the threshold with depth so far buildings don't turn into soup.
      float k = smoothstep(0.0012 + c * 0.02, 0.006 + c * 0.06, e);
      float fade = 1.0 - smoothstep(0.35, 0.85, c);
      gl_FragColor = vec4(mix(src.rgb, outlineColor, k * strength * fade), src.a);
    }`,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    warmth: { value: 0.06 },
    saturation: { value: 1.08 },
    vignette: { value: 0.22 },
  },
  vertexShader: OutlineShader.vertexShader,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float warmth, saturation, vignette;
    varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c += vec3(warmth, warmth * 0.4, -warmth * 0.35);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, saturation);
      vec2 d = vUv - 0.5;
      c *= 1.0 - vignette * dot(d, d) * 2.2;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

let composer = null, bloomPass = null, outlinePass = null, depthTarget = null, usePost = true;

function buildComposer(q) {
  if (composer) { composer.dispose(); composer = null; }
  if (depthTarget) { depthTarget.dispose(); depthTarget = null; }
  bloomPass = null; outlinePass = null;
  usePost = !!q.post;
  if (!usePost) return;

  const size = renderer.getSize(new THREE.Vector2());
  depthTarget = new THREE.WebGLRenderTarget(size.x, size.y);
  depthTarget.depthTexture = new THREE.DepthTexture(size.x, size.y);
  depthTarget.depthTexture.type = THREE.UnsignedShortType;

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  outlinePass = new ShaderPass(OutlineShader);
  outlinePass.uniforms.tDepth.value = depthTarget.depthTexture;
  outlinePass.uniforms.resolution.value.set(size.x, size.y);
  outlinePass.uniforms.cameraNear.value = camera.near;
  outlinePass.uniforms.cameraFar.value = camera.far;
  composer.addPass(outlinePass);

  if (q.bloom) {
    bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.14, 0.8, 0.9);
    composer.addPass(bloomPass);
  }
  composer.addPass(new ShaderPass(GradeShader));
  composer.addPass(new OutputPass());
}

function applyQuality(level) {
  const q = QUALITY[Math.max(0, Math.min(QUALITY.length - 1, level | 0))] || QUALITY[1];
  renderer.shadowMap.enabled = q.shadows;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
  buildComposer(q);
  scene.traverse((o) => { if (o.isMesh) o.castShadow = o.castShadow && q.shadows; });
  return q;
}
game.setQuality = (n) => { state.settings.quality = n; applyQuality(n); save.saveSettings(); };

// ===========================================================================
// Boot the cat, then everything that depends on it
// ===========================================================================
let player = null;
let clock = null, orders = null, restaurant = null, cooking = null, fishing = null,
    delivery = null, foraging = null, quests = null, npcs = null, ui = null, dialogue = null;

async function boot() {
  const cat = await catFromOptions({ url: CAT_MODEL_URL, ...PLAYER_CAT, gradientMap });

  player = createPlayer(game, cat, { spawn: HOME.spawn });
  game.player = player;

  clock = createClock(game);          game.clock = clock;
  dialogue = createDialogueUI(game);  game.dialogue = dialogue;
  orders = createOrders(game);        game.orders = orders;
  cooking = createCooking(game);      game.cooking = cooking;
  restaurant = createRestaurant(game, { shopGroup: world.shopGroup, anchors: world.shopAnchors });
  game.restaurant = restaurant;
  fishing = createFishing(game);      game.fishing = fishing;
  delivery = createDelivery(game);    game.delivery = delivery;
  foraging = createForaging(game);    game.foraging = foraging;
  quests = createQuests(game);        game.quests = quests;
  npcs = createNpcs(game, { gradientMap }); game.npcs = npcs;
  if (npcs && npcs.group && !npcs.group.parent) scene.add(npcs.group);

  ui = createUI(game);                game.ui2 = ui;

  // Content registration
  for (const s of DEFAULT_SPOTS) fishing.registerSpot(s);
  if (foraging.registerDefaults) foraging.registerDefaults();
  if (delivery.registerBoard) {
    delivery.registerBoard({ id: 'job_board', x: HOME.plaza.x + 6, z: HOME.plaza.z - 2, label: 'Delivery board' });
  }

  wireEvents();
  quests.refreshAvailability();
  checkRecipeUnlocks(state);
  // ?q=0|1|2 forces a quality tier — handy for low-end machines and for the
  // headless smoke test, which runs on a software rasteriser.
  const qParam = new URLSearchParams(location.search).get('q');
  applyQuality(qParam != null ? Number(qParam) : state.settings.quality);

  showStartScreen();
}

// ===========================================================================
// Cross-system wiring
// ===========================================================================
function wireEvents() {
  bus.on(EV.TOAST, (p) => { if (p) KIT.toast(p.text, { icon: p.icon, tone: p.tone }); });
  bus.on(EV.COINS, (p) => { if (p && p.delta > 0) audio.play('coin'); });
  bus.on(EV.XP, (p) => { if (p && p.leveledUp) audio.play('levelup'); });
  bus.on(EV.QUEST_DONE, () => audio.play('quest'));
  bus.on(EV.RECIPE_UNLOCKED, () => audio.play('bell'));
  bus.on(EV.ORDER_NEW, () => audio.play('bell'));
  bus.on(EV.FISH_CAUGHT, () => audio.play('splash'));
  bus.on(EV.PANEL_OPEN, () => audio.play('ui_open'));
  bus.on(EV.PANEL_CLOSE, () => audio.play('ui_close'));

  // Reputation can unlock districts and recipes at any moment.
  bus.on(EV.REPUTATION, () => { checkRecipeUnlocks(state); state.checkDistrictUnlocks(); });
  bus.on(EV.SHOP_UPGRADED, (p) => {
    if (p && p.id === 'tier') {
      const anchors = world.setShopTier(p.tier);
      if (restaurant && restaurant.setTier) restaurant.setTier(p.tier, anchors);
    }
  });

  // End of day → summary card → sleep.
  bus.on(EV.DAY_END, async (p) => {
    if (!ui || !game.panels) return;
    clock.pause(true);
    try {
      const summary = (restaurant && restaurant.summaryForToday) ? restaurant.summaryForToday() : (p && p.summary) || {};
      await game.panels.open('daily', { day: p ? p.day : state.clock.day, ...summary });
    } catch (err) {
      console.error('[main] daily summary failed', err);
    } finally {
      clock.pause(false);
      save.save('auto');
    }
  });

  bus.on(EV.DAY_START, () => {
    if (delivery && delivery.generateDaily) delivery.generateDaily();
    if (quests) quests.refreshAvailability();
  });

  // The single E key, routed through the interaction registry.
  window.addEventListener('keydown', (e) => {
    if (isTypingInUI() || e.repeat) return;
    if (e.code === 'KeyE' && mode === 'explore') interactions.use(game);
  });

  window.addEventListener('resize', onResize);
  window.addEventListener('beforeunload', () => { try { save.save('auto'); } catch { /* best effort */ } });
}

function onResize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  if (composer) composer.setSize(w, h);
  if (depthTarget) depthTarget.setSize(w, h);
  if (outlinePass) outlinePass.uniforms.resolution.value.set(w, h);
}

// ===========================================================================
// Start screen
// ===========================================================================
function showStartScreen() {
  const overlay = document.getElementById('start');
  if (!overlay) { begin(false); return; }
  const cont = document.getElementById('start-continue');
  const fresh = document.getElementById('start-new');
  const hasSave = save.hasAny();
  if (cont) {
    cont.style.display = hasSave ? '' : 'none';
    cont.addEventListener('click', () => { const r = save.load('auto'); begin(!!r.ok); });
  }
  if (fresh) fresh.addEventListener('click', () => begin(false));
  overlay.classList.add('ready');
}

function begin(loaded) {
  const overlay = document.getElementById('start');
  if (overlay) overlay.classList.add('gone');
  audio.unlock();

  if (loaded) {
    const p = state.data.player;
    player.teleport(p.x || HOME.spawn.x, p.z || HOME.spawn.z, p.yaw || 0);
    clock.set(state.clock.day, state.clock.hour);
  } else {
    state.fromJSON({});
    state.registerUpgrades(UPGRADES);
    checkRecipeUnlocks(state);
    player.teleport(HOME.spawn.x, HOME.spawn.z, HOME.spawn.yaw);
    clock.set(1, 7);
    quests.offer('q01_first_order');
    quests.start('q01_first_order');
    // Point the compass at the first stop so a new player is never lost.
    const first = world.poi('yuki_stall') || world.poi('supplier_yuki_stall');
    if (first) world.setWaypoint(first);
    KIT.toast('Master Kuro is waiting in the market', { icon: '🐈‍⬛', tone: 'good' });
  }

  game.setMode('explore');
  player.forceUnlock();
  bus.emit(EV.DAY_START, { day: state.clock.day });
  if (delivery && delivery.generateDaily) delivery.generateDaily();
  quests.refreshAvailability();
}

// ===========================================================================
// Frame loop
// ===========================================================================
const frameClock = new THREE.Clock();
let acc = 0;

function animate() {
  requestAnimationFrame(animate);
  game.frames = (game.frames || 0) + 1;
  const dt = Math.min(frameClock.getDelta(), 0.05);
  renderer.info.reset();

  try {
    if (mode !== 'boot') {
      clock.update(dt);
      player.update(dt);
      const p = player.position;

      world.update(dt, clock.night);
      applyDayNight(clock.night, clock.hourFloat != null ? clock.hourFloat : clock.hour);

      npcs.update(dt);
      orders.update(dt);
      restaurant.update(dt);
      cooking.update(dt);
      fishing.update(dt);
      delivery.update(dt);
      foraging.update(dt);
      quests.update(dt);
      ui.update(dt);
      audio.update(dt);

      if (mode === 'explore') interactions.update(p.x, p.z);

      // Persist position continuously so an autosave is never a frame stale.
      state.data.player.x = p.x; state.data.player.y = p.y; state.data.player.z = p.z;
      state.data.player.yaw = player.yaw;
      state.data.player.district = player.district;
      state.setClock(clock.day, clock.hourFloat != null ? clock.hourFloat : clock.hour);
      save.update(dt);

      sky.position.copy(camera.position);

      acc += dt;
      if (DEBUG.showStats && acc > 0.5) { acc = 0; logStats(); }
    }
  } catch (err) {
    console.error('[main] frame error', err);
  }

  if (usePost && composer) {
    // Depth prepass for the ink outline.
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(depthTarget);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(prev);
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

function logStats() {
  const i = renderer.info;
  console.info(`[perf] calls ${i.render.calls} · tris ${i.render.triangles} · geo ${i.memory.geometries} · tex ${i.memory.textures}`);
}

// ===========================================================================
// Exposed for the headless smoke test in tools/smoke.mjs and for debugging.
// Read-only in spirit — nothing in the game reads back off it.
window.__sushi = game;

boot().then(() => {
  console.info(`%c${GAME.title} %c${GAME.tagline}`, 'font-weight:bold', 'color:#c8503f');
  animate();
}).catch((err) => {
  console.error('[main] boot failed', err);
  const overlay = document.getElementById('start');
  if (overlay) {
    const p = overlay.querySelector('.start-error');
    if (p) { p.textContent = 'Something went wrong starting the game. Check the console.'; p.style.display = 'block'; }
  }
});
