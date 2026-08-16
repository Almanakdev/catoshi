// Catushi — entry point.
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

import { GAME, CAT_MODEL_URL, PLAYER_CAT, RENDER, QUALITY, DEBUG, CITY_PALETTE } from './config.js';
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
import { createGuide } from './game/guide.js';
import { createTutorial } from './game/tutorial.js';
import { createShadowTutorial } from './game/shadowTutorial.js';
import { createGuideUI } from './ui/guideUI.js';
import { createDialogueUI } from './ui/dialogueUI.js';
import { createUI, createPanelManager } from './ui/index.js';
import { createTouchControls } from './ui/touchControls.js';
import { createSocialUI } from './ui/socialUI.js';
import { createWalletStatus, readSession, writeSession } from './ui/walletStatus.js';
import { createSimpleMinimap } from './ui/simpleMinimap.js';
import { createLanding } from './landing/landing.js';
import { createAudio } from './audio/audio.js';
import { catFromOptions } from './cat/catLoader.js';
import { makeToonGradient } from './engine/textures.js';
import { isTypingInUI } from './engine/inputGuard.js';
import { initDevice, IS_TOUCH, isPhone } from './engine/device.js';
import * as KIT from './ui/kit.js';
import { HOME, DISTRICTS } from './data/districts.js';
import { SUPPLIERS, isOpenAt } from './data/suppliers.js';
import { UPGRADES } from './data/upgrades.js';
import { checkRecipeUnlocks } from './data/recipes.js';
import { NPCS } from './data/npcs.js';

// ===========================================================================
// Renderer, scene, camera
// ===========================================================================
// Writes .is-touch / .is-phone and the live --app-vh onto <html> before any
// stylesheet is asked a question, and keeps them current as the phone rotates.
initDevice();

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
const SKY = CITY_PALETTE;
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

scene.fog = new THREE.Fog(CITY_PALETTE.fogDay, RENDER.fog.near, RENDER.fog.far);

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

const hemi = new THREE.HemisphereLight(CITY_PALETTE.hemiDay, 0xc9a8b8, 0.95);
scene.add(hemi);
const ambient = new THREE.AmbientLight(CITY_PALETTE.ambient, 0.48);
scene.add(ambient);

const gradientMap = makeToonGradient(4);

// ===========================================================================
// Core services
// ===========================================================================
const bus = createBus();
const state = createState(bus);
state.registerUpgrades(UPGRADES);
const save = createSaveSystem(state, bus, { autosaveSeconds: 90 });
// A phone that has never been here gets the low tier: no post stack, no shadow
// map, DPR 1. Anyone who has chosen a quality keeps their choice on every
// device — the settings panel still offers all three.
if (!save.loadSettings() && (IS_TOUCH || isPhone())) state.settings.quality = 0;
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

  sunLight.intensity = 2.0 * (1 - night * 0.82);
  sunLight.color.setHex(dusk > 0.3 ? CITY_PALETTE.sunDusk : dawn > 0.3 ? 0xffd0e0 : CITY_PALETTE.sunDay);
  hemi.intensity = 0.95 * (1 - night * 0.5) + night * 0.35;
  hemi.color.setHex(night > 0.5 ? CITY_PALETTE.hemiNight : CITY_PALETTE.hemiDay);
  ambient.intensity = 0.48 * (1 - night * 0.3) + night * 0.28;

  // Purple night boost — neon + windows punch harder so the city reads like pic 2.
  for (const m of world.glowMats) if (m) m.emissiveIntensity = 0.08 + night * 1.35;
  for (const m of world.neonMats) if (m) m.emissiveIntensity = 0.45 + night * 1.35;
  if (bloomPass) bloomPass.strength = 0.12 + night * 0.32;
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
    warmth: { value: 0.02 },
    purple: { value: 0.08 },
    saturation: { value: 1.12 },
    vignette: { value: 0.24 },
  },
  vertexShader: OutlineShader.vertexShader,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float warmth, purple, saturation, vignette;
    varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c += vec3(warmth * 0.5 + purple * 0.15, warmth * 0.15, purple * 0.55 - warmth * 0.1);
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
  // Phone panels run at DPR 3. Rendering the city at 3x is nine times the work
  // of 1x for a difference nobody can see at arm's length, so the tier's ratio
  // is capped further on a phone even when the player picks High.
  const maxDpr = isPhone() ? Math.min(q.pixelRatio, 1.3) : q.pixelRatio;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
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
    delivery = null, foraging = null, quests = null, npcs = null, ui = null, dialogue = null,
    guide = null, tutorial = null, guideUI = null, touch = null,
    social = null, walletStatus = null, minimap = null, shadowTut = null, landing = null;
let gameStarted = false;
let muted = false;

// Objects that must not appear in the outline's depth prepass (sprites, points
// and anything else whose billboard quad would carve a hole in the depth
// buffer). Systems register into this list; the frame loop hides them for the
// prepass and puts them straight back.
const depthHidden = [];
function hideInDepthPass(obj) {
  if (!obj || depthHidden.indexOf(obj) >= 0) return () => {};
  depthHidden.push(obj);
  return () => { const i = depthHidden.indexOf(obj); if (i >= 0) depthHidden.splice(i, 1); };
}
game.hideInDepthPass = hideInDepthPass;

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

  // Guidance layer: the brain, the day-one tutorial that feeds it, and the
  // banner / arrows / markers / pin that show it. Built after quests + npcs
  // (it reads both) and before the UI, so the HUD can sit around the banner.
  guide = createGuide(game);          game.guide = guide;
  tutorial = createTutorial(game, guide); game.tutorial = tutorial;
  guideUI = createGuideUI(game, guide);   game.guideUI = guideUI;
  if (guideUI && guideUI.fx) hideInDepthPass(guideUI.fx);

  ui = createUI(game);                game.ui2 = ui;

  // Thumbstick + action buttons. A no-op handle on desktop, so nothing below
  // has to ask what kind of device this is.
  touch = createTouchControls(game);  game.touch = touch;

  // ENGINE CITY-style social + wallet + minimap chrome
  const session = readSession();
  const myName = (session && session.username) || 'You';
  social = createSocialUI({
    myName,
    names: NPCS.map((n) => n.name).filter(Boolean).slice(0, 24),
  });
  walletStatus = createWalletStatus();
  minimap = createSimpleMinimap(world);
  game.social = social;
  game.minimap = minimap;

  shadowTut = createShadowTutorial({
    audio,
    menuTarget: document.getElementById('btn-home'),
    onUi: () => audio.play('click'),
  });
  game.shadowTutorial = shadowTut;

  // Content registration
  for (const s of DEFAULT_SPOTS) fishing.registerSpot(s);
  if (foraging.registerDefaults) foraging.registerDefaults();
  if (delivery.registerBoard) {
    delivery.registerBoard({ id: 'job_board', x: HOME.board.x, z: HOME.board.z, label: 'Delivery board' });
  }
  // Stalls: the supplier panel existed but nothing in the world opened it, so
  // "press E at the stall" was a promise the city could not keep.
  for (const s of SUPPLIERS) {
    interactions.add({
      id: `supplier:${s.id}`,
      x: s.x, z: s.z, r: 3.0,
      priority: 2,
      key: 'E',
      label: () => (isOpenAt(s, clock.hour) ? `Shop at ${s.name}` : `${s.name} — closed`),
      data: { kind: 'supplier', supplierId: s.id, id: s.id },
      onUse: () => { game.panels.open('supplier', { supplierId: s.id }); },
    });
  }

  wireEvents();
  wireGameChrome();
  quests.refreshAvailability();
  checkRecipeUnlocks(state);
  // ?q=0|1|2 forces a quality tier — handy for low-end machines and for the
  // headless smoke test, which runs on a software rasteriser.
  const qParam = new URLSearchParams(location.search).get('q');
  applyQuality(qParam != null ? Number(qParam) : state.settings.quality);

  // Landing page first; smoke / ?play=1 can skip straight in.
  landing = createLanding({
    audio,
    onPlay: (sess) => {
      walletStatus = createWalletStatus();
      if (social && sess && sess.username) social.setNames([
        sess.username,
        ...NPCS.map((n) => n.name).filter(Boolean).slice(0, 20),
      ]);
      showStartScreen();
    },
  });
  game.landing = landing;

  const params = new URLSearchParams(location.search);
  const autoPlay = params.has('smoke') || params.get('play') === '1' || params.has('q');
  if (autoPlay) {
    if (!readSession()) {
      writeSession({
        username: 'SmokeChef',
        wallet: { provider: 'demo', address: 'DemoSmokeWallet000000000000000000000001' },
        at: Date.now(),
      });
    }
    if (landing) landing.hide();
    walletStatus = createWalletStatus();
    showStartScreen();
    // Smoke test clicks #start-new — keep the start overlay ready.
  }
}

// ===========================================================================
// Cross-system wiring
// ===========================================================================
function wireEvents() {
  // EV.TOAST is owned by the UI layer (src/ui/index.js), which is constructed
  // above and unsubscribes on destroy. Routing it here as well rendered every
  // toast in the game twice.
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
  // iOS reports the pre-rotation size for a frame or two, and the URL bar
  // collapsing fires visualViewport rather than window resize.
  window.addEventListener('orientationchange', () => {
    onResize();
    setTimeout(onResize, 160);
    setTimeout(onResize, 480);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onResize, { passive: true });
  }
  window.addEventListener('beforeunload', () => { try { save.save('auto'); } catch { /* best effort */ } });

  // The canvas is a game surface, not a document: a long press must not raise
  // the copy/share sheet, and a double tap must not zoom the page.
  const canvas = renderer.domElement;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('dblclick', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());
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
// Start screen + chrome
// ===========================================================================
function wireGameChrome() {
  const home = document.getElementById('btn-home');
  const mute = document.getElementById('btn-mute');
  if (home) {
    home.addEventListener('click', () => {
      audio.play('ui_close');
      try { save.save('auto'); } catch { /* best effort */ }
      // Soft return: hide game HUD, show landing again (world keeps ticking quietly).
      showGameChrome(false);
      if (social) social.hide();
      if (minimap) minimap.hide();
      if (walletStatus) walletStatus.hide();
      game.setMode('boot');
      gameStarted = false;
      if (landing) landing.show();
      const overlay = document.getElementById('start');
      if (overlay) {
        overlay.classList.remove('show', 'gone', 'ready');
        overlay.style.display = 'none';
      }
    });
  }
  if (mute) {
    mute.addEventListener('click', () => {
      muted = !muted;
      if (muted) {
        audio.setMaster(0);
        mute.textContent = '♪̸';
      } else {
        audio.applySettings(state.settings);
        mute.textContent = '♪';
      }
      audio.play('click');
    });
  }
  document.querySelectorAll('[data-buy-coin]').forEach((btn) => {
    if (btn.dataset.boundBuy) return;
    btn.dataset.boundBuy = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      window.open(GAME.robinhoodUrl || 'https://www.sushi.com/robinhood/launchpad/token/0x4af955ec23941363FAcD33A9562C611f2cBAC68b', '_blank', 'noopener,noreferrer');
    });
  });
}

function showGameChrome(on) {
  const chrome = document.getElementById('game-chrome');
  if (chrome) chrome.classList.toggle('show', !!on);
  if (touch) touch.setVisible(!!on);
  if (on) {
    if (social) social.show();
    if (minimap) minimap.show();
    if (walletStatus) walletStatus.show();
  }
}

function showStartScreen() {
  const overlay = document.getElementById('start');
  if (!overlay) { begin(false); return; }
  overlay.style.display = 'flex';
  overlay.classList.add('show');
  overlay.classList.remove('gone');
  const cont = document.getElementById('start-continue');
  const fresh = document.getElementById('start-new');
  const hasSave = save.hasAny();
  if (cont) {
    cont.style.display = hasSave ? '' : 'none';
    cont.onclick = () => { const r = save.load('auto'); begin(!!r.ok); };
  }
  if (fresh) fresh.onclick = () => begin(false);
  overlay.classList.add('ready');
}

function begin(loaded) {
  const overlay = document.getElementById('start');
  if (overlay) {
    overlay.classList.add('gone');
    setTimeout(() => { overlay.classList.remove('show'); overlay.style.display = 'none'; }, 500);
  }
  audio.unlock();
  audio.setMusicTrack('neon');
  audio.setAmbience('market');
  gameStarted = true;
  document.body.style.overflow = 'hidden';

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
    KIT.toast('Master Kuro is waiting in the market', { icon: '🐈‍⬛', tone: 'good' });
  }

  game.setMode('explore');
  player.forceUnlock();
  bus.emit(EV.DAY_START, { day: state.clock.day });
  if (delivery && delivery.generateDaily) delivery.generateDaily();
  quests.refreshAvailability();

  showGameChrome(true);

  // Shadow cursor controls tutorial first; day-one loop tutorial after.
  const params = new URLSearchParams(location.search);
  const skipShadow = params.has('smoke') || params.get('skipTutorial') === '1';
  if (!skipShadow && shadowTut) shadowTut.start();

  if (tutorial) {
    if (loaded) tutorial.syncFromState();
    else if (state.settings.tutorial !== false) tutorial.restart();
  }
  if (guide) guide.refresh();
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
    if (mode !== 'boot' && gameStarted) {
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
      // Tutorial first (it may advance a step), then the guide (which reads it),
      // then the guide's visuals (which read the guide).
      if (shadowTut) shadowTut.update(dt);
      tutorial.update(dt);
      guide.update(dt);
      guideUI.update(dt);
      ui.update(dt);
      if (touch) touch.update(dt);
      audio.update(dt);
      if (social) social.update(dt, p);
      if (minimap) minimap.update(p.x, p.z, player.yaw || 0);

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
    } else {
      // Idle boot / landing: keep a soft night sky render alive.
      applyDayNight(0.55, 20);
      sky.position.copy(camera.position);
      audio.update(dt);
    }
  } catch (err) {
    console.error('[main] frame error', err);
  }

  if (usePost && composer) {
    // Depth prepass for the ink outline. Billboards are pulled out of it first:
    // a sprite quad always faces the camera, so it would stamp a flat plate of
    // depth into the buffer and the sobel would ring it in ink.
    const prev = renderer.getRenderTarget();
    const restore = [];
    for (const o of depthHidden) {
      if (o && o.visible) { o.visible = false; restore.push(o); }
    }
    renderer.setRenderTarget(depthTarget);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(prev);
    for (const o of restore) o.visible = true;
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
window.__catoshi = game;

// index.html ships a static placeholder; the real name lives in config.js.
try { document.title = `${GAME.title} — ${GAME.tagline}`; } catch { /* non-DOM host */ }

boot().then(() => {
  console.info(`%c${GAME.title} %c${GAME.tagline}`, 'font-weight:bold', 'color:#8b5cf6');
  animate();
}).catch((err) => {
  console.error('[main] boot failed', err);
  const overlay = document.getElementById('start');
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.classList.add('show', 'ready');
    const p = overlay.querySelector('.start-error');
    if (p) { p.textContent = 'Something went wrong starting the game. Check the console.'; p.style.display = 'block'; }
  }
});
