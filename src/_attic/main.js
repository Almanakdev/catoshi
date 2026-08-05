import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildCity } from './city.js';
import { createEnvironment } from './environment.js';
import { createPier } from './pier.js';
import { createIndustrial } from './industrial/index.js';
import { createLandmarks } from './landmarks/index.js';
import { makeToonGradient } from './textures.js';
import { createMinimap } from './minimap.js';
import { createSkyDetails } from './skyDetails.js';
import { createTraffic, doorPose } from './traffic.js';
import { createWeather, LensRainShader } from './weather.js';
import { createHitEffect } from './hitEffect.js';
import { createInteriors } from './interiors.js';
import { createEntranceMarkers } from './entranceMarkers.js';
import { createVRMCharacter } from './vrmCharacter.js';
import { createThirdPerson } from './thirdPersonControls.js';
import { createCrowd } from './crowd.js';
import { createSocialUI } from './socialUI.js';
import { createNeeds, SERVICES } from './needs.js';
import { createMissions } from './missions.js';
import { createOpeningScene } from './openingScene.js';
import { createDriving } from './driving.js';
import { playBrief } from './missionBrief.js';
import { isTypingInUI } from './inputGuard.js';

// ===========================================================================
// WORLD LOOK — single source of truth for the scene's cohesive grade.
// ---------------------------------------------------------------------------
// The whole frame is rendered LINEAR, then ONE final post-processing pass
// (ColorGradeShader) tone-maps it with ACES Filmic at a single global exposure
// and applies the warm cinematic grade. Because it's a full-screen pass, every
// surface — buildings, ground, ocean, bridge, park, shops, character — shares
// the exact same tone map + grade in day and night. There is no per-object or
// duplicate grading anywhere else. Tweak the entire look from here.
// ===========================================================================
// A warm, nostalgic, hand-painted "Ghibli" grade: golden light, lush colour,
// LOW contrast with lifted (open, warm) shadows — nothing harsh anywhere.
// Soft Ghibli grade: a gentle hue-preserving tone curve (no hard ACES shoulder,
// so bright windows/walls compress smoothly and keep their colour instead of
// blowing to white/yellow), low contrast, a small toe-lift on ONLY the darkest
// crushed shadows (no milky global lift), and clean-but-eased saturation.
const GRADE = {
  exposure: 0.98,  // pulled down a touch → lower, calmer highlights
  warmTint: new THREE.Vector3(0.92, 0.97, 1.11),   // cool, distinctly bluish overall balance
  shadowTint: new THREE.Vector3(0.84, 0.94, 1.19), // deep cool-blue shadows (split-tone)
  highTint: new THREE.Vector3(0.94, 0.98, 1.09),   // cool bluish highlights
  saturation: 1.05,  // pulled back — more muted, less colourful
  highDesat: 0.22,   // ease saturation back on the most intense / brightest colours
  contrast: 1.12,    // deeper — more separation between darks and brights
  toeLift: 0.0,      // no shadow lift → shadows sink deep (no milky floor)
  shoulder: 0.55,    // lower knee → highlights roll off sooner (dimmer highlights)
  vignette: 0.22,
};

// Fog blends the world into the sky at the horizon. Its colour is kept exactly
// equal to the sky's horizon band every frame (see updateDayNight), so sea and
// sky never show a seam — only the distances live here.
const FOG = { near: 520, far: 2400 }; // pushed back so nothing near the camera is hazed

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// Cap pixel ratio at 1.5 — the multi-pass post stack is fill-rate bound, and
// this is the single biggest win for smoothness on high-DPI screens.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// The renderer stays on NoToneMapping so materials render pure linear into the
// composer. The scene's SINGLE tone map — ACES Filmic at GRADE.exposure — is
// applied once, at the end, inside ColorGradeShader (doing it here as well would
// double-tone through OutputPass). One tone map, one exposure, whole scene.
renderer.toneMapping = THREE.NoToneMapping;
renderer.info.autoReset = false; // reset manually per frame → totals across ALL passes
app.appendChild(renderer.domElement);

// ---------------------------------------------------------------------------
// Scene + camera
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
// Far plane pushed out so the ocean runs all the way to the horizon. The near
// plane is raised to 0.5 (the follow camera never gets closer than ~5) — depth
// precision scales with the near plane, and this 5x jump is what stops distant
// coplanar surfaces (sea vs beach) from z-fighting and flickering.
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.5, 8000);
camera.position.set(0, 6, 12);

// ---------------------------------------------------------------------------
// Sky — a warm vertical gradient dome (soft blue up top → peach at the horizon)
// ---------------------------------------------------------------------------
const SKY_TOP = new THREE.Color(0x6fa8e0);     // soft natural blue
const SKY_HORIZON = new THREE.Color(0xbfd0d7); // cleaner blue-grey haze (also the fog)
const SKY_BOTTOM = new THREE.Color(0xb2c2c9);  // blue-grey below the horizon

// The dome carries the warm gradient plus a procedural FBM cloud layer that
// drifts slowly. Clouds are projected onto a virtual high plane (uv = dir.xz /
// dir.y), which compresses them toward the horizon just like real clouds, and
// they're painted two-tone — lit tops, warm shaded undersides — for a soft,
// cinematic look. No texture files: the "cloud texture" is noise in the shader.
const skyMat = new THREE.ShaderMaterial({
  uniforms: {
    topColor: { value: SKY_TOP },
    horizonColor: { value: SKY_HORIZON },
    bottomColor: { value: SKY_BOTTOM },
    offset: { value: 0.02 },
    exponent: { value: 0.8 },
    uTime: { value: 0 },
    cloudColor: { value: new THREE.Color(0xfffdfa) },   // sunlit cloud tops
    cloudShadow: { value: new THREE.Color(0xd4dde3) },  // cool blue-grey undersides
    cloudCover: { value: 0.3 },                         // subtle haze base (sprite clouds carry the sky)
  },
  vertexShader: /* glsl */ `
    varying vec3 vWorldPosition;
    void main() {
      vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 topColor;
    uniform vec3 horizonColor;
    uniform vec3 bottomColor;
    uniform float offset;
    uniform float exponent;
    uniform float uTime;
    uniform vec3 cloudColor;
    uniform vec3 cloudShadow;
    uniform float cloudCover;
    varying vec3 vWorldPosition;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }
    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p = p * 2.03 + vec2(17.0);
        a *= 0.5;
      }
      return v;
    }

    void main() {
      vec3 d = normalize(vWorldPosition);
      float h = d.y + offset;
      vec3 sky = mix(horizonColor, topColor, pow(clamp(h, 0.0, 1.0), exponent));
      vec3 ground = mix(horizonColor, bottomColor, clamp(-h * 3.0, 0.0, 1.0));
      vec3 col = h > 0.0 ? sky : ground;

      if (h > 0.0) {
        // Project onto a high cloud plane; drift very slowly.
        vec2 uv = d.xz / (d.y + 0.12) * 0.9;
        uv += uTime * vec2(0.006, 0.0025);
        float n = fbm(uv * 1.6);
        n += 0.5 * fbm(uv * 3.7 - uTime * 0.004); // second layer, slight parallax
        n /= 1.5;

        float dens = smoothstep(1.0 - cloudCover, 1.0 - cloudCover + 0.35, n);
        dens *= smoothstep(0.0, 0.18, h); // dissolve at the horizon line

        vec3 cloud = mix(cloudShadow, cloudColor, smoothstep(0.2, 0.9, n));
        col = mix(col, cloud, dens * 0.85); // soft blend, never harsh
      }
      gl_FragColor = vec4(col, 1.0);
    }
  `,
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(6000, 32, 20), skyMat);
scene.add(sky);

// Sun direction — a warm late-afternoon angle.
const sun = new THREE.Vector3();
const elevation = 22;
const azimuth = 135;
const phi = THREE.MathUtils.degToRad(90 - elevation);
const theta = THREE.MathUtils.degToRad(azimuth);
sun.setFromSphericalCoords(1, phi, theta);

// Gentle fog that fades everything to the peachy horizon color. The far
// distance is long enough that the open ocean dissolves smoothly into the
// horizon well inside the sky dome — no hard sea/sky seam.
scene.fog = new THREE.Fog(SKY_HORIZON, FOG.near, FOG.far);

// ---------------------------------------------------------------------------
// Lights
// ---------------------------------------------------------------------------
const sunLight = new THREE.DirectionalLight(0xffe4b4, 1.9); // warm, gentle golden sun
sunLight.position.copy(sun).multiplyScalar(400);
sunLight.castShadow = true;
// Full-quality shadows (single shadow-casting light) — unchanged from the
// original look: 2048 map over a wide frustum, soft wide PCF penumbra.
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 900;
const s = 320;
sunLight.shadow.camera.left = -s;
sunLight.shadow.camera.right = s;
sunLight.shadow.camera.top = s;
sunLight.shadow.camera.bottom = -s;
sunLight.shadow.bias = -0.0003;
sunLight.shadow.normalBias = 0.05;  // pushes samples off the surface (less acne)
sunLight.shadow.radius = 11;         // wide, very soft PCF penumbra — gentle painted shadows
sunLight.shadow.blurSamples = 16;    // smoother soft-shadow filtering
scene.add(sunLight);
scene.add(sunLight.target);

// Generous soft fill so shadows stay open and gentle (low contrast, storybook):
// a warm sky above and a warm sandy bounce below, plus warm ambient.
const hemi = new THREE.HemisphereLight(0xdcecf2, 0xf0dcae, 1.15);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0xfff1dc, 0.5);
scene.add(ambient);

// ---------------------------------------------------------------------------
// City
// ---------------------------------------------------------------------------
const {
  group: cityGroup,
  colliders,
  enterableDoors,
  serviceSpots,
  signalSpots,
  bounds,
  windTime,
  grass,
  parkGrass,
  spawn,
  lamps,
  buildingMats,
  neonMats,
  monorail,
  shops,
  park,
  map: cityMap,
} = buildCity(scene, {
  blocks: 8,
  blockSize: 34,
  road: 12,
  seed: 1337,
});

// Open world beyond the city: sea, beach, bridge and a distant island.
// The Water shader gets the sun direction so its specular glints match the sky.
const environment = createEnvironment({ sunDirection: sun });
scene.add(environment.group);

// Living sky: soft cumulus clouds drifting at layered depths + V-flocks of
// birds. Sprite-based and cheap; follows the camera so it always surrounds us.
const skyDetails = createSkyDetails();
scene.add(skyDetails.group);

// Seaside pier with a rotating Ferris wheel, out over the north-east water.
const pier = createPier({ x: 60, z: 202, yaw: 0, length: 95 });
scene.add(pier.group);
cityMap.pois.push(pier.poi); // show it on the minimap too

// Industrial / outskirts installations ringing the city edge.
const industrial = createIndustrial({ gradientMap: makeToonGradient(4) });
scene.add(industrial.group);
cityMap.pois.push(...industrial.pois);   // minimap markers
buildingMats.push(industrial.glowMat);   // lit windows warm up at night

// Iconic landmarks (hillside sign, signature tower, stadium, lighthouse).
const landmarks = createLandmarks({ gradientMap: makeToonGradient(4), towerSpot: cityMap.towerSpot });
scene.add(landmarks.group);
cityMap.pois.push(...landmarks.pois);
buildingMats.push(landmarks.glowMat);

// Minimap — built from the real world data returned by the city + environment.
const minimapWrap = document.getElementById('minimap-wrap');
const minimap = createMinimap({ ...cityMap, ...environment.map });

// ---------------------------------------------------------------------------
// Population — every person in the city is a real rigged VRM.
// ---------------------------------------------------------------------------
// The five .vrm files are loaded once and skeleton-cloned (see vrmLibrary.js),
// then crowd.js walks them around: 14 sidewalk locals plus 16 simulated "other
// players" with floating username labels, all driven by the same procedural
// gait as the player.
//
// An avatar costs ~17 draw calls and ~36k triangles, so `count` and
// `maxVisible` are the real budget — everything else is spent by distance
// (spring bones and shadows on the nearest few, gait rate stepped down with
// range, facial detail meshes dropped past 30 units, frustum-culled avatars
// skipped entirely). Raise pedCount/playerCount for a denser city and watch the
// `crowd` line in the stats HUD (P).
const crowd = createCrowd(scene, {
  blocks: 8, blockSize: 34, road: 12,
  pedCount: 12, playerCount: 16, seed: 20713,
  parkB0: park.b0, parkB1: park.b1,
  maxVisible: 8, springNear: 3, shadowNear: 3,
  targetHeight: 4,
  // MRT passengers: they wait on the platform decks and board when the train
  // actually halts at their station.
  commutersPerStation: 3,
  transit: {
    stations: monorail.stations,
    platLen: monorail.platLen,
    platW: monorail.platW,
    deckTop: monorail.deckTop,
    stoppedIndex: () => monorail.stoppedIndex(),
  },
});

// NPC cars looping the road grid (InstancedMesh, avoid-each-other traffic).
const traffic = createTraffic(scene, {
  blocks: 8, blockSize: 34, road: 12, seed: 777,
  // The graph skips the crossing inside the park, and cars stop on buildings
  // when the player is driving one.
  parkMin: park.minX, parkMax: park.maxX,
  colliders, signalSpots,
  onReady: (models) => console.log(
    `car pack: ${models.length} models driving —`,
    models.map((m) => `${m.name} (${m.length}u)`).join(', ')
  ),
});

// Pooled cartoon impact effect for landed punches.
const hitEffect = createHitEffect();
scene.add(hitEffect.group);

// Enterable shop interiors (one small room per type, all at the origin, hidden
// until entered). Kept out of the exterior world so we can hide the whole city
// while inside.
const interiors = createInteriors(makeToonGradient(4));
scene.add(interiors.group);

// Floating GTA-style markers over every enterable door (tied to the same door
// list, so they only appear where an interior exists).
const entranceMarkers = createEntranceMarkers(enterableDoors, { baseY: 3.6 });
scene.add(entranceMarkers.group);

// Holographic "ride up" pads at the foot of each station stair.
const stairMarkerGroup = new THREE.Group();
scene.add(stairMarkerGroup);
const stairMarkers = [];
{
  const holoMat = new THREE.MeshBasicMaterial({
    color: 0x5fd6ff, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false,
  });
  const arrowGeo = new THREE.ConeGeometry(0.7, 1.1, 4);   // apex up = "go up"
  const ringGeo = new THREE.TorusGeometry(0.95, 0.11, 6, 20);
  for (const s of monorail.stations) {
    const g = new THREE.Group();
    g.position.set(s.stairBottom.x, 0, s.stairBottom.z);
    const arrow = new THREE.Mesh(arrowGeo, holoMat); arrow.position.y = 2.6;
    const ring = new THREE.Mesh(ringGeo, holoMat); ring.rotation.x = Math.PI / 2; ring.position.y = 0.12;
    g.add(arrow, ring);
    stairMarkerGroup.add(g);
    stairMarkers.push({ g, arrow, station: s });
  }
}
let stairT = 0;
function updateStairMarkers(dt) {
  stairT += dt;
  for (const m of stairMarkers) {
    m.arrow.position.y = 2.6 + Math.sin(stairT * 2 + m.station.stopS) * 0.24;
    m.arrow.rotation.y = stairT * 1.2;
    m.g.scale.setScalar(nearStair === m.station ? 1.3 + Math.sin(stairT * 9) * 0.08 : 1.0);
  }
}

// Live train-schedule panel (shown only while standing on a platform).
const schedEl = document.createElement('div');
schedEl.style.cssText = 'position:fixed;left:50%;top:20px;transform:translateX(-50%);min-width:230px;padding:12px 16px;border-radius:12px;background:rgba(14,20,30,.82);border:1px solid rgba(90,150,220,.35);color:#eaf2fb;font:600 13px system-ui,sans-serif;opacity:0;transition:opacity .2s ease;pointer-events:none;z-index:22;box-shadow:0 8px 26px rgba(0,0,0,.4);';
document.body.appendChild(schedEl);
const fmtT = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function updateSchedule() {
  if (!started || mode !== 'outside') { schedEl.style.opacity = '0'; return; }
  const p = character.group.position;
  const idx = monorail.platformIndexAt(p.x, p.z, p.y);
  if (idx < 0) { schedEl.style.opacity = '0'; return; }
  const st = monorail.stations[idx];
  const eta = monorail.eta(idx);
  let status;
  if (monorail.stoppedIndex() === idx) status = '<span style="color:#7cffa0">● Boarding now</span>';
  else if (eta < 4) status = '<span style="color:#ffd23a">▶ Arriving</span>';
  else status = `<span>Next train</span><b style="font-size:15px">${fmtT(eta)}</b>`;
  schedEl.innerHTML =
    `<div style="font-size:15px;letter-spacing:.06em;margin-bottom:7px">🚉 ${st.name} STATION</div>` +
    `<div style="display:flex;justify-content:space-between;align-items:center;gap:20px">${status}</div>` +
    `<div style="opacity:.62;margin-top:5px;display:flex;justify-content:space-between;gap:20px"><span>Following</span><span>${fmtT(eta + monorail.period)}</span></div>`;
  schedEl.style.opacity = '1';
}

// Animated "Now arriving: <Station>" banner, fired by the REAL arrival event
// (the train transitioning into a station stop) — shown while riding, and when
// standing on the platform the train pulls into.
const arrivalEl = document.createElement('div');
arrivalEl.style.cssText = 'position:fixed;left:50%;top:66px;transform:translate(-50%,-26px);opacity:0;z-index:36;padding:13px 30px;border-radius:14px;background:linear-gradient(180deg,rgba(22,30,48,.95),rgba(13,19,31,.95));border:1px solid rgba(120,175,245,.55);box-shadow:0 12px 38px rgba(0,0,0,.5);color:#eaf2fb;font:700 21px/1.15 system-ui,sans-serif;letter-spacing:.03em;white-space:nowrap;pointer-events:none;transition:transform .45s cubic-bezier(.2,.9,.25,1),opacity .4s ease;';
document.body.appendChild(arrivalEl);
let arrivalOutT = null;
function showArrival(name) {
  clearTimeout(arrivalOutT);
  arrivalEl.innerHTML = `<span style="opacity:.75;font-weight:600;font-size:15px">Now arriving</span>&nbsp;&nbsp;<b style="color:#8fd0ff">${name}</b>`;
  arrivalEl.style.transform = 'translate(-50%,0)';   // slide down + fade in
  arrivalEl.style.opacity = '1';
  arrivalOutT = setTimeout(() => {                   // hold, then slide up + fade out
    arrivalEl.style.transform = 'translate(-50%,-26px)';
    arrivalEl.style.opacity = '0';
  }, 2600);
}
let prevStoppedIdx = -1;
function checkArrival() {
  const si = monorail.stoppedIndex();               // >= 0 only while halted at a station
  if (si >= 0 && si !== prevStoppedIdx) {            // just pulled into station `si`
    const p = character.group.position;
    const onThisPlatform = monorail.platformIndexAt(p.x, p.z, p.y) === si;
    if (started && (mode === 'riding' || onThisPlatform)) showArrival(monorail.stations[si].name);
  }
  prevStoppedIdx = si;
}

// ---------------------------------------------------------------------------
// Street-lamp illumination + day / night
// ---------------------------------------------------------------------------
// Hundreds of real lights would be far too expensive, so instead we keep a
// small pool of warm PointLights that snap to whichever lamps are nearest the
// character each frame — the bulbs themselves glow (emissive + bloom) for all
// the lamps. Press N to fade between afternoon and night.
const LAMP_POOL = 8;
const lampLights = [];
for (let i = 0; i < LAMP_POOL; i++) {
  const p = new THREE.PointLight(0xffb56b, 0, 34, 2);
  p.castShadow = false; // pool lights are cheap fill; shadows stay on the sun
  scene.add(p);
  lampLights.push(p);
}

// Day/night colour targets (lerped by `night` 0→1).
const DAY = {
  top: new THREE.Color(0x6fa8e0),      // soft natural blue
  horizon: new THREE.Color(0xbfd0d7),  // cleaner blue-grey haze (drives the fog)
  bottom: new THREE.Color(0xb2c2c9),
  cloud: new THREE.Color(0xfffdfa),    // clean soft-white clouds
  cloudShadow: new THREE.Color(0xd4dde3), // cool blue-grey undersides
  sun: 1.85,
  hemi: 1.1,
  ambient: 0.48,
};
const NIGHT = {
  top: new THREE.Color(0x141d3c),
  horizon: new THREE.Color(0x2c3358),  // warmer, gentler night
  bottom: new THREE.Color(0x1c2038),
  cloud: new THREE.Color(0x36415e),
  cloudShadow: new THREE.Color(0x232c46),
  sun: 0.16,
  hemi: 0.38,
  ambient: 0.2,
};
// In-game clock: one full day passes in a few real minutes. `dayTime` is in
// hours [0..24) and starts mid-afternoon to match the scene's golden mood.
const DAY_LENGTH_SEC = 240; // 4 real minutes per in-game day
let dayTime = 15.0;
let night = 0; // derived each frame from the sun's elevation
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyN' && !isTypingInUI()) dayTime = (dayTime + 6) % 24; // skip ahead 6 hours
});

// Scratch vectors/colors for the per-frame sky & light math (no allocations).
const MOON_DIR = new THREE.Vector3(0.4, 0.55, -0.3).normalize();
const SUN_NOON = new THREE.Color(0xffe9c2);
const SUN_LOW = new THREE.Color(0xff9a55);
const SUN_MOON = new THREE.Color(0x9fb3e0);
const DUSK_GLOW = new THREE.Color(0xff9e5e);
const _sunRaw = new THREE.Vector3();

const clockEl = document.getElementById('clock');
let clockText = '';

const _order = lamps.positions.map((_, i) => i); // reused scratch index list
function updateDayNight(dt) {
  // Advance the in-game clock and put the sun on its arc: rises at 6:00,
  // peaks at noon, sets at 18:00, and swings below the horizon overnight.
  const prevDayTime = dayTime;
  dayTime = (dayTime + (dt * 24) / DAY_LENGTH_SEC) % 24;
  // Midnight rollover pays the daily stipend, so you can't get permanently
  // stranded with an empty wallet and an empty stomach.
  if (started && dayTime < prevDayTime) needs.payStipend();
  const arc = ((dayTime - 6) / 12) * Math.PI;
  _sunRaw.set(Math.cos(arc) * 0.8, Math.sin(arc), 0.45).normalize();

  // Day/night factor comes straight from solar elevation, so dusk and dawn
  // fade in gradually as the sun crosses the horizon.
  night = 1 - THREE.MathUtils.smoothstep(_sunRaw.y, -0.08, 0.2);

  // The light direction used for shadows and water glints: the sun by day,
  // easing over to a fixed moon direction at night so shadows never shine up
  // from below the horizon.
  const dayF = THREE.MathUtils.smoothstep(_sunRaw.y, -0.05, 0.15);
  sun.copy(MOON_DIR).multiplyScalar(1 - dayF).addScaledVector(_sunRaw, dayF).normalize();
  environment.ocean.material.uniforms.sunDirection.value.copy(sun);

  // On-screen clock (HH:MM), updated only when the text actually changes.
  const hh = String(Math.floor(dayTime)).padStart(2, '0');
  const mm = String(Math.floor((dayTime % 1) * 60)).padStart(2, '0');
  const t = hh + ':' + mm;
  if (t !== clockText) {
    clockText = t;
    clockEl.textContent = t;
  }

  // Sky + fog fade toward a deep evening blue.
  skyMat.uniforms.topColor.value.lerpColors(DAY.top, NIGHT.top, night);
  skyMat.uniforms.horizonColor.value.lerpColors(DAY.horizon, NIGHT.horizon, night);
  skyMat.uniforms.bottomColor.value.lerpColors(DAY.bottom, NIGHT.bottom, night);
  skyMat.uniforms.cloudColor.value.lerpColors(DAY.cloud, NIGHT.cloud, night);
  skyMat.uniforms.cloudShadow.value.lerpColors(DAY.cloudShadow, NIGHT.cloudShadow, night);
  // Golden hour: as the sun nears the horizon, blush the horizon band orange.
  const dusk = Math.max(0, 1 - Math.abs(_sunRaw.y) / 0.3) * (1 - night * 0.6);
  skyMat.uniforms.horizonColor.value.lerp(DUSK_GLOW, dusk * 0.7);
  scene.fog.color.copy(skyMat.uniforms.horizonColor.value);

  // Sun/fill dim toward night; the sun deepens to orange near the horizon and
  // hands over to cool moonlight after dark.
  sunLight.intensity = THREE.MathUtils.lerp(DAY.sun, NIGHT.sun, night);
  const lowSun = THREE.MathUtils.clamp(1 - _sunRaw.y / 0.45, 0, 1);
  sunLight.color.copy(SUN_NOON).lerp(SUN_LOW, lowSun * (1 - night)).lerp(SUN_MOON, night);
  hemi.intensity = THREE.MathUtils.lerp(DAY.hemi, NIGHT.hemi, night);
  ambient.intensity = THREE.MathUtils.lerp(DAY.ambient, NIGHT.ambient, night);

  // Bulbs glow softly by day, warmly by night (gentle, no harsh glow).
  lamps.material.emissiveIntensity = THREE.MathUtils.lerp(0.3, 1.05, night);

  // Building windows light up after dark — a soft warm wash.
  const winGlow = night * 0.9;
  for (let i = 0; i < buildingMats.length; i++) {
    buildingMats[i].emissiveIntensity = winGlow;
  }

  // Neon / LED signs — kept gentle for the painterly grade: a soft warm evening
  // glow rather than a harsh blaze, still tied to the day-night cycle.
  const neonGlow = 0.22 + night * 0.85;
  for (let i = 0; i < neonMats.length; i++) {
    neonMats[i].emissiveIntensity = neonGlow;
  }

  // Point the light pool at the nearest lamps to the character.
  if (night > 0.02 && lamps.positions.length) {
    const cp = character.group.position;
    _order.sort((a, b) => {
      return (
        lamps.positions[a].distanceToSquared(cp) -
        lamps.positions[b].distanceToSquared(cp)
      );
    });
    const intensity = night * 90;
    for (let i = 0; i < LAMP_POOL; i++) {
      const light = lampLights[i];
      const src = lamps.positions[_order[i]];
      if (src) {
        light.position.copy(src);
        light.intensity = intensity;
      } else {
        light.intensity = 0;
      }
    }
  } else {
    for (let i = 0; i < LAMP_POOL; i++) lampLights[i].intensity = 0;
  }

  // Keep the bloom whisper-soft day and night — just a gentle painterly halo.
  bloomPass.strength = 0.12 + night * 0.1;
}

// ---------------------------------------------------------------------------
// Character (VRM avatar, third-person)
// ---------------------------------------------------------------------------
const character = createVRMCharacter({ targetHeight: 4, height: 1 });
character.group.position.copy(spawn);
character.setFacingOffset(0); // this VRM already faces its movement direction
scene.add(character.group);

// Keep the shadow frustum centered on the character.
function updateShadowCamera() {
  sunLight.position.copy(character.group.position).addScaledVector(sun, 400);
  sunLight.target.position.copy(character.group.position);
}

// ---------------------------------------------------------------------------
// Third-person controls
// ---------------------------------------------------------------------------
// traffic.carColliders is the same array every frame, so the controller sees
// live car bodies as solid walls without any per-frame plumbing.
const controls = createThirdPerson(
  camera, renderer.domElement, character, colliders, bounds,
  monorail.groundHeightAt, traffic.carColliders
);

const overlay = document.getElementById('overlay');
const hud = document.getElementById('hud');
const panel = document.getElementById('panel');

// Chat + leaderboard overlays, populated with the SAME usernames that are
// walking around the city, so the feed and the street agree with each other.
// ---------------------------------------------------------------------------
// Needs + economy. Rates and prices all live in src/needs.js.
// ---------------------------------------------------------------------------
const flashEl = document.getElementById('needs-flash');
let flashT = 0;
const needs = createNeeds({
  onFlash: ({ cost, gained }) => {
    flashEl.innerHTML =
      `<span class="gain">${gained.join('  ')}</span>` +
      (cost > 0 ? `<span class="cost">-$${cost}</span>` : '');
    flashEl.classList.add('show');
    flashT = 2.2;
  },
});
// Only the shop types listed in SERVICES sell anything; the rest are scenery.
const shopServices = serviceSpots.filter((s) => SERVICES[s.type]);

// Missions — the way money comes IN. Job boards around the grid hand out
// delivery / timed / collection work; rewards pay cash and move the needs.
const missions = createMissions(scene, {
  pois: cityMap.pois,
  blocks: 8, blockSize: 34, road: 12, seed: 5150,
  needs, minimap,
  colliders,                  // boards get placed clear of anything solid (read once, at build)
  onToast: (ev) => {
    if (ev.kind === 'complete') {
      const bonus = ev.bonus > 0 ? ` (+$${ev.bonus} time bonus)` : '';
      showMissionToast(`✓ ${ev.title} — $${ev.pay}${bonus}`, '#8dffb0');
      social.addScore(25);
    } else if (ev.kind === 'accept') showMissionToast(`New job: ${ev.title}`, '#ffd23f');
    else if (ev.kind === 'stage') showMissionToast(ev.text, '#ffd23f');
    else if (ev.kind === 'fail') showMissionToast(`✗ ${ev.title} — ${ev.text}`, '#ff7a6d');
    else if (ev.kind === 'pickup') showMissionToast(ev.text, '#8dffb0');
  },
});
// Reuse the purchase-receipt pill for mission notifications.
function showMissionToast(text, color) {
  flashEl.innerHTML = `<span style="color:${color}">${text}</span>`;
  flashEl.classList.add('show');
  flashT = 3.0;
}

const social = createSocialUI({ myName: 'You' });
// The crowd's usernames only exist once the five VRMs have loaded and the
// population is spawned, so the chat + leaderboard are filled in from here.
crowd.onPopulated((names) => social.setNames(names));

let started = false;

// The whole gameplay HUD comes up together, whether that's after the opening
// cutscene or straight away if it's skipped.
function showGameplayHUD() {
  hud.classList.add('show');
  clockEl.classList.add('show');
  minimapWrap.classList.add('show');
  social.show();
  needs.show();
  missions.show();
}

// Hand-off out of the opening scene. This is the ONLY place control is granted,
// and it runs identically whether the scene played out or was skipped — so
// there's no path that leaves the player stuck in a cutscene.
function beginGameplay() {
  for (const g of worldGroups) g.visible = true;
  opening.group.visible = false;
  colliders.length = 0; for (const b of cityColliders) colliders.push(b);

  // Step outside the hospital: stand on its pavement spot, facing the street.
  const exit = hospitalExit();
  character.group.position.set(exit.x, 0, exit.z);
  character.setCutscene(0, 0);
  character.group.rotation.set(0, exit.yaw, 0);
  controls.setFacing(exit.yaw);
  controls.state.yaw = exit.yaw;
  controls.state.pitch = 0.35;
  controls.setDist(12);

  mode = 'outside';
  transitioning = false;
  controls.setEnabled(true);
  started = true;
  showGameplayHUD();
}

// The pavement spot in front of the hospital, facing out toward the street.
// Falls back to the normal spawn if the generator didn't place a hospital.
function hospitalExit() {
  const h = serviceSpots.find((s) => s.type === 'hospital');
  return h ? { x: h.x, z: h.z, yaw: h.yaw } : { x: spawn.x, z: spawn.z, yaw: 0 };
}

overlay.addEventListener('click', () => {
  overlay.classList.add('hidden');
  // Straight into the hospital: hide the city, disable everything, roll film.
  // (The interior rooms are already individually hidden, so they're left alone —
  // blanking interiors.group here would break every shop after the scene.)
  for (const g of worldGroups) g.visible = false;
  minimapWrap.classList.remove('show');
  controls.setEnabled(false);
  mode = 'opening';
  opening.play();
});
// Esc toggles the customize panel (drag the scene to look around — no lock).
window.addEventListener('keydown', (e) => {
  if (isTypingInUI()) return;      // chat box has the keyboard
  if (mode === 'opening') return;  // the cutscene owns Esc / Space (skip)
  if (e.code === 'Escape') panel.classList.toggle('show');
  if (e.code === 'KeyF') doPunch();
});

// Punch: F key or a left click. Throws a quick jab; if an NPC is in a short cone
// directly in front, knock it down and pop a hit effect at the contact point.
const _fwd = new THREE.Vector3();
function doPunch() {
  if (!started) return;
  if (!character.punch()) return; // still on cooldown / mid-punch
  const yaw = character.group.rotation.y;
  _fwd.set(Math.sin(yaw), 0, Math.cos(yaw)); // character's forward
  // A small impact burst just in front of the jab (no NPC knock-downs anymore).
  const p = character.group.position;
  hitEffect.trigger(new THREE.Vector3(p.x + _fwd.x * 2.2, p.y + 2.3, p.z + _fwd.z * 2.2));
  social.addScore(4); // shadow-boxing counts for something on the board
}
renderer.domElement.addEventListener('pointerdown', (e) => { if (e.button === 0) doPunch(); });

// ---------------------------------------------------------------------------
// Enterable shops — press E at a door to fade inside; press E at the interior
// EXIT to fade back out where you entered.
// ---------------------------------------------------------------------------
const worldGroups = [
  cityGroup, environment.group, traffic.group,
  landmarks.group, industrial.group, pier.group, skyDetails.group, sky,
  entranceMarkers.group, stairMarkerGroup,
  crowd.group, crowd.labels, missions.group,
];
const cityColliders = colliders.slice(); // restored on exit

// ---------------------------------------------------------------------------
// Opening cutscene — you wake up in a hospital bed with no memory. Built after
// worldGroups so the hand-off can restore the city in one place.
// ---------------------------------------------------------------------------
const opening = createOpeningScene({
  scene, camera, character,
  gradientMap: makeToonGradient(4),
  onFinish: beginGameplay,
});

// Fade overlay + interaction prompt (built dynamically — no HTML edits needed).
const fadeEl = document.createElement('div');
fadeEl.style.cssText = 'position:fixed;inset:0;background:#0b0b10;opacity:0;pointer-events:none;transition:opacity .32s ease;z-index:40;';
document.body.appendChild(fadeEl);
const promptEl = document.createElement('div');
promptEl.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);padding:8px 16px;border-radius:999px;background:rgba(14,18,26,.72);border:1px solid rgba(255,255,255,.18);color:#f5ead8;font:600 14px system-ui,sans-serif;opacity:0;transition:opacity .18s ease;pointer-events:none;z-index:20;white-space:nowrap;';
document.body.appendChild(promptEl);
const showPrompt = (t) => { promptEl.textContent = t; promptEl.style.opacity = '1'; };
const hidePrompt = () => { promptEl.style.opacity = '0'; };

let mode = 'outside'; // 'outside' | 'inside' | 'riding' | 'warping'
let curRoom = null;
let curRoomType = null;   // shop key of the room we're inside (drives its counter service)
let nearDoor = null;
let nearExit = false;
let nearBoard = null; // stopped station the player can board, or null
let nearStair = null; // stair-bottom pad the player can ride up, or null
let canAlight = false; // riding + train stopped → can get off
let transitioning = false;
const savedOut = new THREE.Vector3();
let savedYaw = 0;
const rideLook = new THREE.Vector3(); // smoothed onboard look-at target
let warpT = 0, warpYaw = 0;           // stairs-up ease state
const warpStart = new THREE.Vector3(), warpEnd = new THREE.Vector3(), warpLook = new THREE.Vector3();

function fadeThen(fn) {
  transitioning = true;
  controls.setEnabled(false);
  hidePrompt();
  fadeEl.style.opacity = '1';
  setTimeout(() => {
    fn();
    fadeEl.style.opacity = '0';
    setTimeout(() => { transitioning = false; controls.setEnabled(true); }, 320);
  }, 330);
}

function enterShop(door) {
  const room = interiors.rooms[door.type];
  if (!room) return;
  fadeThen(() => {
    savedOut.copy(character.group.position);
    savedYaw = character.group.rotation.y;
    for (const g of worldGroups) g.visible = false;
    room.group.visible = true;
    curRoom = room; curRoomType = door.type; mode = 'inside';
    character.group.position.copy(room.entrance);
    controls.setFacing(room.entranceYaw);
    controls.state.yaw = room.entranceYaw;
    colliders.length = 0; for (const b of room.colliders) colliders.push(b);
    controls.setDist(5.5);           // zoom in for the small room
    minimapWrap.classList.remove('show'); // the map is meaningless indoors
  });
}

function exitShop() {
  fadeThen(() => {
    if (curRoom) curRoom.group.visible = false;
    for (const g of worldGroups) g.visible = true;
    mode = 'outside'; curRoom = null; curRoomType = null;
    character.group.position.set(savedOut.x, 0, savedOut.z);
    controls.setFacing(savedYaw);
    controls.state.yaw = savedYaw;
    colliders.length = 0; for (const b of cityColliders) colliders.push(b);
    controls.setDist(12);
    minimapWrap.classList.add('show');
  });
}

// --- Ride the train ---------------------------------------------------------
// Board from a platform when the train is halted there; the camera then rides
// on the train high above the city until you get off at a station.
function boardTrain() {
  mode = 'riding';
  controls.setEnabled(false);   // no walking…
  controls.setLookMode(true);   // …but free look-around (cursor / drag / wheel)
  character.group.visible = false;
  const r = monorail.getRide();
  controls.state.yaw = r.yaw;   // start looking forward along the rail
  controls.state.pitch = -0.2;  // slightly above, looking forward over the city
  controls.setDist(11);
  hidePrompt();
}

function getOffTrain() {
  const st = monorail.getStoppedStation();
  if (!st) return;
  const r = monorail.getRide();
  character.group.position.set(st.x, monorail.groundHeightAt(st.x, st.z), st.z); // onto the deck
  character.group.visible = true;
  controls.setLookMode(false);
  controls.setFacing(r.yaw);
  controls.state.yaw = r.yaw;
  controls.setDist(12);
  controls.setEnabled(true);
  mode = 'outside';
  canAlight = false;
  hidePrompt();
}

// Onboard camera: orbit a point on the moving train, with the LOOK direction
// (and zoom) driven by the cursor — so the player rides along and freely watches
// the city pass by. Called after the train has moved so the anchor is current.
const _rideTarget = new THREE.Vector3(), _rideDir = new THREE.Vector3();
function updateRide(dt) {
  const r = monorail.getRide();
  character.group.position.set(r.x, 0, r.z); // keeps the minimap arrow on the train
  character.group.rotation.y = r.yaw;        // …pointing along the rail
  const look = controls.updateLook(dt);      // cursor-follow + drag + wheel → yaw/pitch/dist
  const target = _rideTarget.set(r.x, r.y + 1.6, r.z); // window height on the car
  const cp = Math.cos(look.pitch);
  _rideDir.set(Math.sin(look.yaw) * cp, Math.sin(look.pitch), Math.cos(look.yaw) * cp);
  camera.position.copy(target).addScaledVector(_rideDir, -look.dist); // locked to the train, no lag
  camera.lookAt(target);
}

// Ride up the stairs: a gentle eased climb from the pad onto the platform.
function warpUp(station) {
  mode = 'warping';
  controls.setEnabled(false);
  hidePrompt();
  warpT = 0;
  warpYaw = station.upYaw;
  warpStart.copy(character.group.position);
  warpEnd.set(station.deckSpot.x, monorail.groundHeightAt(station.deckSpot.x, station.deckSpot.z), station.deckSpot.z);
  warpLook.set(warpStart.x, warpStart.y + 2, warpStart.z);
}

function updateWarp(dt) {
  warpT += dt;
  const t = Math.min(warpT / 1.3, 1);
  const e = t * t * (3 - 2 * t); // smoothstep ease
  const x = warpStart.x + (warpEnd.x - warpStart.x) * e;
  const z = warpStart.z + (warpEnd.z - warpStart.z) * e;
  const y = monorail.groundHeightAt(x, z); // follow the actual stair ramp
  character.group.position.set(x, y, z);
  character.group.rotation.y = warpYaw;
  character.update(dt, 9); // play the walk cycle while ascending
  const up = new THREE.Vector3(Math.sin(warpYaw), 0, Math.cos(warpYaw));
  const camT = new THREE.Vector3(x, y, z).addScaledVector(up, -10); camT.y += 7;
  camera.position.lerp(camT, 0.14);
  warpLook.lerp(new THREE.Vector3(x, y + 2, z), 0.18);
  camera.lookAt(warpLook);
  if (t >= 1) {
    mode = 'outside';
    controls.setFacing(warpYaw);
    controls.state.yaw = warpYaw;
    controls.setDist(12);
    controls.setEnabled(true);
  }
}

window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyE' || isTypingInUI() || !started || transitioning || mode === 'warping' || mode === 'carAnim') return;
  if (mode === 'inside') {
    if (nearExit) exitShop();
    else if (nearService) useService(nearService);
    return;
  }
  if (mode === 'riding') { if (canAlight) getOffTrain(); return; }
  if (mode === 'driving') { exitCar(); return; }
  if (nearCar) { enterCar(nearCar); return; }
  if (nearDoor) enterShop(nearDoor);
  else if (nearBoard) boardTrain();
  else if (nearStair) warpUp(nearStair);
  else if (missions.boardInRange) acceptMissionWithBrief();
  else if (nearService) useService(nearService);
});

// ---- Needs services: eat / rest / entertainment at places around the city ---
// A service is offered by proximity, exactly like a shop door. `bench` is a
// HOLD action — energy trickles back for as long as you stand there — while
// food and entertainment are one-shot purchases.
let nearService = null;   // { type, label, dist } or null
let resting = false;

function serviceAt(type) {
  const svc = SERVICES[type];
  return svc ? { type, label: type, svc } : null;
}

function servicePrompt(s) {
  const { svc } = s;
  if (svc.hold) return resting ? 'Resting… (walk away to stop)' : 'Press E to sit and rest';
  const check = needs.checkService(s.type);
  const price = svc.cost > 0 ? ` — $${svc.cost}` : '';
  if (!check.ok && check.reason) return `${check.reason} to ${svc.verb}`;
  return `Press E to ${svc.verb}${price}`;
}

// Nearest service point we're standing at, outdoors.
function findService(p) {
  let best = null, bestD = 16; // same 4-unit reach as the shop doors
  for (const s of shopServices) {
    if (s.enterable) continue;             // those are bought inside instead
    const dd = (p.x - s.x) ** 2 + (p.z - s.z) ** 2;
    if (dd < bestD) { bestD = dd; best = s; }
  }
  return best ? { type: best.type, label: best.label, svc: SERVICES[best.type] } : null;
}

function useService(s) {
  if (!s) return;
  if (s.svc.hold) { resting = true; return; }   // benches: handled per-frame
  needs.useService(s.type);
}

// Per-frame needs tick. Energy burn is driven by how hard the character is
// actually working, so sprinting across town costs real stamina.
const _prevPos = new THREE.Vector3();
let _prevPosInit = false;
function updateNeeds(dt) {
  if (!started) return;
  const p = character.group.position;
  if (!_prevPosInit) { _prevPos.copy(p); _prevPosInit = true; }
  const moved = Math.hypot(p.x - _prevPos.x, p.z - _prevPos.z) / Math.max(dt, 1e-4);
  _prevPos.copy(p);
  // The controller walks at 9 and sprints at 18 units/s.
  // Sitting in a car isn't exercise, however fast it's going.
  const activity = mode === 'driving' ? 0 : (moved > 13 ? 2 : moved > 1.5 ? 1 : 0);
  needs.update(dt, activity, resting && moved < 1.5);

  if (flashT > 0) {
    flashT -= dt;
    if (flashT <= 0) flashEl.classList.remove('show');
  }
}

// ---------------------------------------------------------------------------
// Hijacking a car. The car leaves the traffic AI, the character is hidden
// inside it, and the arcade controller in driving.js takes over the camera.
// ---------------------------------------------------------------------------
const driving = createDriving(camera, { colliders, groundY: 0.12 });
let nearCar = null;

// The get-in / get-out animations are retargeted Mixamo clips, so the character
// performs them on foot BEFORE the camera hands over (and after it hands back).
// `carAnim` holds that in-between state: no player input, camera still on the
// character, and a timer that carries out whatever the clip was leading up to.
// If a clip hasn't finished loading, playAction returns 0 and the transition
// happens immediately — a missing FBX can never strand the player.
// `lock` pins the character to a fixed spot and facing for the whole clip. The
// car animations are played IN PLACE (the clips are retargeted with the hips
// pinned) at the driver's door, and the lock is re-applied every frame AFTER the
// controller runs — so collision push-out, the ground follow and any residual
// knockback can't slide the character off its mark mid-animation.
let carAnim = null;   // { t, dur, then, lock }

function playCarAnim(dur, then, lock = null) {
  if (dur <= 0) { then(); return; }
  mode = 'carAnim';
  controls.setEnabled(false);
  hidePrompt();
  carAnim = { t: 0, dur, then, lock };
  if (lock) applyCarLock();
}

// Snap to the locked door pose and plant the soles on the road.
function applyCarLock() {
  const l = carAnim && carAnim.lock;
  if (!l) return;
  character.group.position.x = l.x;
  character.group.position.z = l.z;
  character.group.position.y = 0;
  character.group.rotation.set(0, l.yaw, 0);
  character.groundFeet(0);
}

function enterCar(c) {
  const handle = traffic.hijack(c);
  if (!handle) return;
  // Stand at the driver's door, on the ground, facing the bodywork — the same
  // spot getting out will use.
  const door = doorPose(c);
  controls.setFacing(door.yaw);
  controls.state.yaw = door.yaw;
  // Trim the tail: the last stretch settles into a seat this car doesn't have,
  // and the camera should be inside by then.
  const dur = character.playAction('enter-car', { fadeOut: 0.25 }) * 0.72;
  playCarAnim(dur, () => {
    carAnim = null;
    character.stopAction();
    character.group.visible = false;
    driving.enter(handle);
    mode = 'driving';
  }, door);
}

function exitCar() {
  // ORDER MATTERS HERE. traffic.release() rejoins the car to the road network by
  // snapping it onto the nearest lane entry — a teleport. Doing that first (as
  // this used to) moved the car the instant you pressed E, so the door spot the
  // animation was about to be locked to was already stale: the character ended up
  // standing where the car had been, or inside where it had jumped to. So:
  //   1. read the spot while the car is still exactly where you parked it,
  //   2. play the whole animation with the car held in place,
  //   3. only hand it back to the traffic AI once the character is clear.
  const spot = driving.exitSpot();               // beside the door, facing outward
  const parked = driving.carSnapshot();
  driving.exit();

  // Keep the car solid for everything except the player until they walk away:
  // its footprint necessarily overlaps the spot they're standing in, and being
  // shoved by the car you just left is what read as the exit sliding.
  if (traffic.hijacked) traffic.setGhostCar(traffic.hijacked);

  character.group.visible = true;
  controls.setDist(12);
  controls.state.pitch = 0.35;

  // Place the character on the ground beside the door BEFORE anything renders.
  // Done here rather than only inside playCarAnim so the no-clip fallback (a
  // duration of 0 because the FBX hasn't loaded) still puts them in the right
  // place instead of leaving them at the car's centre.
  if (spot) {
    character.group.position.set(spot.x, 0, spot.z);
    character.group.rotation.set(0, spot.yaw, 0);
    controls.setFacing(spot.yaw);
    controls.state.yaw = spot.yaw;
    character.groundFeet(0);
  }

  const finish = () => {
    carAnim = null;
    // Now the car can rejoin traffic — and it won't be snapped on top of the
    // character, who is standing right next to it.
    traffic.release(character.group.position);
    mode = 'outside';
    controls.setEnabled(true);
  };

  const dur = character.playAction('exit-car', { fadeOut: 0.35 }) * 0.8;
  playCarAnim(dur, finish, spot);
}

// Getting run over: health down, and a shove away from the car.
traffic.onPlayerHit(({ damage, knock, speed }) => {
  if (!started || mode !== 'outside') return;
  needs.add('health', -damage);
  controls.applyKnockback(knock.x, knock.z);
  const p = character.group.position;
  hitEffect.trigger(new THREE.Vector3(p.x, p.y + 2.0, p.z));
  showMissionToast(`Hit by a car!  -${Math.round(damage)} health`, '#ff7a6d');

  // Face into the impact so the retargeted knock-down reads the right way, then
  // stagger for the clip. Control is only taken for as long as the animation
  // actually runs, and capped so a long clip can't feel like a lockout.
  const face = Math.atan2(-knock.x, -knock.z);
  controls.setFacing(face);
  const dur = character.playAction('hit-by-car', { fadeIn: 0.06, fadeOut: 0.45 });
  if (dur > 0) {
    // No lock here: the knockback is supposed to carry the character.
    playCarAnim(Math.min(dur, 2.2), () => {
      carAnim = null;
      mode = 'outside';
      controls.setEnabled(true);
    });
  }
});

// Taking a job plays a short cinematic: the camera arcs around you at the
// board, cuts to an aerial over the objective, then cuts back and settles into
// the normal follow framing. Control is off for the duration and restored in
// exactly one place, whether the scene ran out or was skipped.
let brief = null;
function acceptMissionWithBrief() {
  const m = missions.accept();
  if (!m) return;
  const target = missions.activeTarget;
  if (!target) return;                    // nothing to frame — stay in gameplay

  mode = 'briefing';
  controls.setEnabled(false);
  hidePrompt();
  brief = playBrief({
    camera,
    player: character.group.position,
    target,
    mission: m,
    onFinish: () => {
      // Single restore path: whatever happened, the player drives again.
      brief = null;
      mode = 'outside';
      controls.setEnabled(true);
      controls.state.pitch = 0.35;
      controls.setDist(12);
    },
  });
}

// Each frame: work out whether we're standing at a door / exit and prompt.
function checkDoors() {
  if (!started || transitioning || mode === 'warping' || mode === 'briefing' || mode === 'carAnim') { hidePrompt(); return; }
  if (mode === 'driving') { showPrompt('Press E to get out'); nearCar = null; return; }
  const p = character.group.position;
  if (mode === 'inside') {
    nearDoor = null;
    const ez = curRoom.exitZone;
    nearExit = (p.x - ez.x) ** 2 + (p.z - ez.z) ** 2 < 5.3;
    // Inside an eatery: the door zone leaves, anywhere else is the counter.
    // That's why enterable shops don't sell at the kerb — you buy in here.
    nearService = nearExit ? null : serviceAt(curRoomType);
    if (nearExit) showPrompt('Press E to exit');
    else if (nearService) showPrompt(servicePrompt(nearService));
    else hidePrompt();
    return;
  }
  if (mode === 'riding') {
    nearDoor = null; nearBoard = null;
    canAlight = !!monorail.getStoppedStation();
    if (canAlight) showPrompt('Press E to get off'); else hidePrompt();
    return;
  }
  // outside: nearest enterable shop door, or a train stopped at a nearby station
  nearExit = false;
  let best = null, bestD = 16;
  for (const d of enterableDoors) {
    const dd = (p.x - d.x) ** 2 + (p.z - d.z) ** 2;
    if (dd < bestD) { bestD = dd; best = d; }
  }
  nearDoor = best;
  nearBoard = null;
  const st = monorail.getStoppedStation();
  if (st && (p.x - st.x) ** 2 + (p.z - st.z) ** 2 < 64) nearBoard = st; // within 8 units
  nearStair = null;
  if (!nearDoor && !nearBoard && p.y < 1.5) { // on the ground, near a stair pad
    for (const m of stairMarkers) {
      if ((p.x - m.station.stairBottom.x) ** 2 + (p.z - m.station.stairBottom.z) ** 2 < 9) { nearStair = m.station; break; }
    }
  }
  // A car within arm's reach outranks everything else: if you're standing at a
  // bumper, E means "get in".
  nearCar = traffic.nearestCar(p);

  // A job board you can take work from outranks a shop counter — it's a
  // deliberate destination, and the two can sit on the same street corner.
  const jobBoard = (!nearCar && !nearDoor && !nearBoard && !nearStair) ? missions.boardInRange : null;
  // Services rank below doors, transit and job boards, so E never changes meaning.
  nearService = (!nearCar && !nearDoor && !nearBoard && !nearStair && !jobBoard) ? findService(p) : null;
  if (!nearService || !nearService.svc.hold) resting = false;

  if (nearCar) showPrompt('Press E to hijack the car');
  else if (nearDoor) showPrompt('Press E to enter the ' + nearDoor.label);
  else if (nearBoard) showPrompt('Press E to board');
  else if (nearStair) showPrompt('Press E to go up');
  else if (jobBoard) showPrompt(`Press E to accept: ${missions.offered.title} — $${missions.offered.pay}`);
  else if (nearService) showPrompt(servicePrompt(nearService));
  else hidePrompt();
}

// Customization panel wiring.
document
  .getElementById('c-tint')
  .addEventListener('input', (e) => character.setTint(e.target.value));
document
  .getElementById('c-height')
  .addEventListener('input', (e) => character.setHeight(parseFloat(e.target.value)));

// ---------------------------------------------------------------------------
// Cartoon outlines + AO + bloom + warm grade (post-processing)
// ---------------------------------------------------------------------------
// We render the scene once with a normal material into an offscreen target that
// also captures depth, then reuse those buffers for both the ink-line outline
// pass and GTAO ambient occlusion (so AO costs no extra geometry pass).
const dpr = renderer.getDrawingBufferSize(new THREE.Vector2());
const normalTarget = new THREE.WebGLRenderTarget(dpr.x, dpr.y, {
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
});
normalTarget.depthTexture = new THREE.DepthTexture(dpr.x, dpr.y);
normalTarget.depthTexture.type = THREE.UnsignedIntType;

const normalMaterial = new THREE.MeshNormalMaterial();

const OutlineShader = {
  uniforms: {
    tDiffuse: { value: null },
    tNormal: { value: normalTarget.texture },
    tDepth: { value: normalTarget.depthTexture },
    resolution: { value: new THREE.Vector2(dpr.x, dpr.y) },
    cameraNear: { value: camera.near },
    cameraFar: { value: camera.far },
    outlineColor: { value: new THREE.Color(0x2a2018) },
    outlineStrength: { value: 0.55 },
    thickness: { value: 1.0 },
    depthThreshold: { value: 0.6 },
    normalThreshold: { value: 0.35 },
    fadeNear: { value: 130.0 },
    fadeFar: { value: 380.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tNormal;
    uniform sampler2D tDepth;
    uniform vec2 resolution;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform vec3 outlineColor;
    uniform float outlineStrength;
    uniform float thickness;
    uniform float depthThreshold;
    uniform float normalThreshold;
    uniform float fadeNear;
    uniform float fadeFar;
    varying vec2 vUv;

    float eyeDepth(vec2 uv) {
      float d = texture2D(tDepth, uv).x;
      return -(cameraNear * cameraFar) / ((cameraFar - cameraNear) * d - cameraFar);
    }

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);

      vec2 texel = thickness / resolution;
      vec2 offX = vec2(texel.x, 0.0);
      vec2 offY = vec2(0.0, texel.y);

      float dC = eyeDepth(vUv);
      float dEdge =
        abs(dC - eyeDepth(vUv + offX)) +
        abs(dC - eyeDepth(vUv - offX)) +
        abs(dC - eyeDepth(vUv + offY)) +
        abs(dC - eyeDepth(vUv - offY));
      float depthEdge = smoothstep(depthThreshold, depthThreshold * 3.0, dEdge);

      vec3 nC = texture2D(tNormal, vUv).xyz;
      float nEdge =
        distance(nC, texture2D(tNormal, vUv + offX).xyz) +
        distance(nC, texture2D(tNormal, vUv - offX).xyz) +
        distance(nC, texture2D(tNormal, vUv + offY).xyz) +
        distance(nC, texture2D(tNormal, vUv - offY).xyz);
      float normalEdge = smoothstep(normalThreshold, normalThreshold * 2.0, nEdge);

      float edge = max(depthEdge, normalEdge);
      float fade = 1.0 - smoothstep(fadeNear, fadeFar, dC);
      edge *= fade * outlineStrength;

      gl_FragColor = vec4(mix(base.rgb, outlineColor, edge), base.a);
    }
  `,
};

// The scene's ONE final pass: ACES Filmic tone map at a single global exposure,
// followed by the warm "summer afternoon" grade (white balance, split-tone,
// contrast, saturation, vignette). This is the only place the whole frame is
// tone-mapped and graded, so every surface matches. All values come from GRADE.
const ColorGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    exposure: { value: GRADE.exposure },
    warmTint: { value: GRADE.warmTint },
    shadowTint: { value: GRADE.shadowTint },
    highTint: { value: GRADE.highTint },
    saturation: { value: GRADE.saturation },
    highDesat: { value: GRADE.highDesat },
    contrast: { value: GRADE.contrast },
    toeLift: { value: GRADE.toeLift },
    shoulder: { value: GRADE.shoulder },
    vignette: { value: GRADE.vignette },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float exposure;
    uniform vec3 warmTint;
    uniform vec3 shadowTint;
    uniform vec3 highTint;
    uniform float saturation;
    uniform float highDesat;
    uniform float contrast;
    uniform float toeLift;
    uniform float shoulder;
    uniform float vignette;
    varying vec2 vUv;

    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

    // Gentle soft-shoulder tone curve on a scalar: linear below the knee k,
    // then a smooth rolloff that ASYMPTOTES to 1.0 — bright values compress
    // softly instead of clipping to white (no hard ACES shoulder).
    float softTone(float x, float k) {
      if (x <= k) return x;
      float e = x - k;
      return k + e / (1.0 + e / (1.0 - k));
    }

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb * exposure;

      // 1) Hue-preserving tone map: curve the LUMINANCE and scale RGB to match,
      // so bright windows/walls keep their hue and just soften — never blow out.
      float l = max(luma(c), 1e-5);
      c *= softTone(l, shoulder) / l;

      // 2) Gentle warm/cool split tone (cool shadows, softly-warm highlights).
      float y = luma(c);
      c *= mix(shadowTint, highTint, smoothstep(0.35, 0.9, y));

      // 3) Low, gentle contrast around mid grey (also eases darks up / brights down).
      c = (c - 0.5) * contrast + 0.5;

      // 4) Raise ONLY the darkest crushed shadows a touch (fades out by ~0.16
      // luma — deliberately NOT a milky lift across the midtones).
      float yb = luma(c);
      c += toeLift * (1.0 - smoothstep(0.0, 0.16, yb));

      // 5) Saturation — clean, but eased back on the most intense/bright colours.
      float g = luma(c);
      float sat = saturation - highDesat * smoothstep(0.55, 1.0, g);
      c = mix(vec3(g), c, sat);

      // 6) Soft vignette.
      float dd = length(vUv - 0.5);
      c *= mix(1.0, smoothstep(0.9, 0.3, dd), vignette);

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }
  `,
};

// ---------------------------------------------------------------------------
// Gentle Ghibli atmosphere — warm rim light on edges + soft god-ray light
// shafts + floating pollen/dust motes. All read the sun direction and fade with
// daylight, and stay deliberately subtle so the warm-highlight / cool-soft-
// shadow grade and low contrast are untouched.
// ---------------------------------------------------------------------------
const RimShader = {
  uniforms: {
    tDiffuse: { value: null },
    tNormal: { value: normalTarget.texture },
    tDepth: { value: normalTarget.depthTexture },
    cameraNear: { value: camera.near },
    cameraFar: { value: camera.far },
    sunView: { value: new THREE.Vector3(0, 0, 1) },  // sun direction in view space
    rimColor: { value: new THREE.Color(0xffdca6) },  // warm
    rimStrength: { value: 0.16 },
    rimPower: { value: 2.2 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tNormal, tDepth;
    uniform float cameraNear, cameraFar, rimStrength, rimPower;
    uniform vec3 sunView, rimColor;
    varying vec2 vUv;
    float eyeDepth(vec2 uv){ float d=texture2D(tDepth,uv).x; return -(cameraNear*cameraFar)/((cameraFar-cameraNear)*d-cameraFar); }
    void main(){
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      vec3 N = texture2D(tNormal, vUv).rgb * 2.0 - 1.0;
      float len = length(N);
      if (len < 0.1) { gl_FragColor = vec4(base, 1.0); return; } // sky / no geometry
      N /= len;
      float graze = clamp(1.0 - N.z, 0.0, 1.0);                  // grazing-angle edges
      float rim = pow(graze, rimPower);
      float sunw = 0.45 + 0.55 * max(0.0, dot(N, sunView));      // warmer on the sun side
      float distFade = 1.0 - smoothstep(150.0, 340.0, eyeDepth(vUv)); // near/mid only
      rim *= sunw * distFade * rimStrength;
      gl_FragColor = vec4(base + rimColor * rim, 1.0);
    }
  `,
};

const GodrayShader = {
  uniforms: {
    tDiffuse: { value: null },
    sunUV: { value: new THREE.Vector2(0.5, 0.5) },
    strength: { value: 0.0 },   // set per-frame (daylight × looking toward the sun)
    decay: { value: 0.96 },
    density: { value: 0.7 },
    rayColor: { value: new THREE.Color(0xfff0cf) }, // warm
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec2 sunUV;
    uniform float strength, decay, density;
    uniform vec3 rayColor;
    varying vec2 vUv;
    float luma(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
    void main(){
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      if (strength <= 0.001) { gl_FragColor = vec4(base, 1.0); return; }
      const int SAMPLES = 24;
      vec2 delta = (vUv - sunUV) * (density / float(SAMPLES));
      vec2 coord = vUv;
      float illum = 1.0;
      vec3 accum = vec3(0.0);
      for (int i = 0; i < SAMPLES; i++) {
        coord -= delta;
        vec3 s = texture2D(tDiffuse, coord).rgb;
        accum += s * max(0.0, luma(s) - 0.55) * illum; // only bright sky/lights streak
        illum *= decay;
      }
      accum *= strength / float(SAMPLES);
      gl_FragColor = vec4(base + accum * rayColor, 1.0);
    }
  `,
};

// Floating pollen / dust motes that drift gently in the light.
function makeMoteTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d').createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,248,224,0.55)');
  g.addColorStop(1, 'rgba(255,248,224,0)');
  const x = c.getContext('2d'); x.fillStyle = g; x.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const MOTE_N = 600;
const _motePos = new Float32Array(MOTE_N * 3);
const _motePhase = new Float32Array(MOTE_N);
for (let i = 0; i < MOTE_N; i++) {
  _motePos[i * 3] = (Math.random() * 2 - 1) * 70;
  _motePos[i * 3 + 1] = 1.5 + Math.random() * 30;
  _motePos[i * 3 + 2] = (Math.random() * 2 - 1) * 70;
  _motePhase[i] = Math.random() * 6.283;
}
const moteGeo = new THREE.BufferGeometry();
moteGeo.setAttribute('position', new THREE.BufferAttribute(_motePos, 3));
moteGeo.setAttribute('aPhase', new THREE.BufferAttribute(_motePhase, 1));
const moteMat = new THREE.PointsMaterial({
  size: 0.5, map: makeMoteTexture(), transparent: true, depthWrite: false,
  blending: THREE.AdditiveBlending, color: 0xfff0cf, opacity: 0.5,
  sizeAttenuation: true, toneMapped: false,
});
const moteTime = { value: 0 };
moteMat.onBeforeCompile = (sh) => {
  sh.uniforms.uTime = moteTime;
  sh.vertexShader = 'uniform float uTime;\nattribute float aPhase;\n' + sh.vertexShader.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
     transformed.x += sin(uTime * 0.18 + aPhase) * 1.4;
     transformed.y += sin(uTime * 0.13 + aPhase * 1.7) * 0.9;
     transformed.z += cos(uTime * 0.15 + aPhase * 1.3) * 1.4;`
  );
};
const motes = new THREE.Points(moteGeo, moteMat);
motes.frustumCulled = false; // follows the player; always present
scene.add(motes);

const composer = new EffectComposer(renderer);
// Post stack renders at the SAME capped pixel ratio as the renderer (≤ 1.5).
composer.setPixelRatio(renderer.getPixelRatio());
composer.addPass(new RenderPass(scene, camera));

// Ambient occlusion / soft contact shadows, reusing the outline gbuffer.
const gtaoPass = new GTAOPass(scene, camera, dpr.x, dpr.y);
gtaoPass.setGBuffer(normalTarget.depthTexture, normalTarget.texture);
gtaoPass.output = GTAOPass.OUTPUT.Default;
gtaoPass.blendIntensity = 0.48; // softer contact shadows (less crushed corners)
gtaoPass.updateGtaoMaterial({
  radius: 2.6, // a touch broader → soft painterly occlusion in corners / under eaves
  distanceExponent: 1.0,
  thickness: 1.2,
  distanceFallOff: 1.0,
  scale: 1.0,
  samples: 8, // trimmed from 16 for performance — still smooth AO
  screenSpaceRadius: false,
});
gtaoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 8 });
composer.addPass(gtaoPass);

const outlinePass = new ShaderPass(OutlineShader);
composer.addPass(outlinePass);

// Warm rim light on edges (reads the shared normal/depth gbuffer).
const rimPass = new ShaderPass(RimShader);
composer.addPass(rimPass);

// Very soft, subtle bloom — a gentle painterly haze around the brightest lights,
// never a harsh glow. Low strength, wide soft radius, high threshold.
// Full-resolution bloom (unchanged look).
const bloomPass = new UnrealBloomPass(new THREE.Vector2(dpr.x, dpr.y), 0.12, 0.85, 0.85);
composer.addPass(bloomPass);

// Soft god-ray light shafts radiating from the sun (through gaps in trees/buildings).
const godrayPass = new ShaderPass(GodrayShader);
composer.addPass(godrayPass);

const gradePass = new ShaderPass(ColorGradeShader);
composer.addPass(gradePass);

// Rain-on-lens droplets — a no-op (disabled) unless it's raining.
const lensPass = new ShaderPass(LensRainShader);
lensPass.enabled = false;
composer.addPass(lensPass);

composer.addPass(new OutputPass());

// ---------------------------------------------------------------------------
// Weather (clear ⇄ rain): world rain streaks, lens droplets, overcast sky/light.
// Toggle with R; it also changes on its own occasionally. Hidden inside shops.
const weather = createWeather({
  scene, camera, renderer, sunLight, hemi, ambient,
  skyMat, fog: scene.fog, gradePass, godrayPass, lensPass,
});
// Rain follows the camera; indoors it's suppressed via the `indoor` flag in the
// loop (not worldGroups, since renderNormalPass restores group visibility).
window.addEventListener('keydown', (e) => { if (e.code === 'KeyR' && !isTypingInUI()) weather.toggle(); });

// ---------------------------------------------------------------------------
// Performance tiers + diagnostics
// ---------------------------------------------------------------------------
// The dominant cost is fill-rate: at pixel-ratio 1.5 the beauty pass, a full
// SECOND scene render for the normal/AO gbuffer, GTAO, bloom and several
// full-screen shader passes all run every frame. These tiers trim that in the
// sanctioned order (bloom/AO resolution → shadow map size + tighter frustum),
// while KEEPING pixel ratio at 1.5 and bloom/AO ON. Cycle with K.
// NOTE: bloom is kept FULL-RES in every tier. Half-res bloom made the scene's
// many tiny ultra-bright emissives (lamp bulbs, lit signs, holograms, tail
// lights) shimmer/flicker — that was the "post glitch". The tiers now trim only
// the shadow map size + frustum and the AO sample count (no flicker).
// `vrmCrowd` is the hard cap on how many crowd avatars may render in one frame
// — the single biggest lever in the scene. Measured against these five models,
// one avatar costs ~17 draw calls and ~36k triangles in the beauty pass, and
// again in the shadow and normal prepasses. Balanced is the default.
const PERF_TIERS = [
  { name: 'High',        shadowMap: 2048, shadowS: 320, gtaoSamples: 8, vrmCrowd: 14 },
  { name: 'Balanced',    shadowMap: 1024, shadowS: 220, gtaoSamples: 6, vrmCrowd: 8 },
  { name: 'Performance', shadowMap: 1024, shadowS: 160, gtaoSamples: 4, vrmCrowd: 4 },
];
let perfLevel = 1; // default to Balanced — the 20 fps case needs the fill-rate cuts
function applyPerf(level) {
  perfLevel = (level + PERF_TIERS.length) % PERF_TIERS.length;
  const t = PERF_TIERS[perfLevel];
  gtaoPass.updateGtaoMaterial({ samples: t.gtaoSamples });
  crowd.setMaxVisible(t.vrmCrowd);
  sunLight.shadow.mapSize.set(t.shadowMap, t.shadowMap);
  const c = sunLight.shadow.camera;
  c.left = -t.shadowS; c.right = t.shadowS; c.top = t.shadowS; c.bottom = -t.shadowS;
  c.updateProjectionMatrix();
  if (sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; } // force rebuild at new size
}
applyPerf(perfLevel);

// Diagnostic: O toggles the ENTIRE post stack (incl. the normal prepass) so you
// can read the FPS HUD (P) with post ON vs OFF and see how much is fill-rate.
let usePost = true;
window.addEventListener('keydown', (e) => {
  if (isTypingInUI()) return;
  if (e.code === 'KeyO') usePost = !usePost;
  else if (e.code === 'KeyK') applyPerf(perfLevel + 1);
});

// Fill the normal + depth buffers each frame. Grass is hidden so the thousands
// of thin blades don't each pick up an ink line — outlines stay on the big
// shapes (buildings, trees, character), and grass reads as a soft mass.
function renderNormalPass() {
  scene.overrideMaterial = normalMaterial;
  grass.visible = false;
  parkGrass.visible = false;
  // Industrial smoke/steam sprites + spark points: soft additive FX that must
  // not pick up ink lines or write into the normal/depth gbuffer.
  for (let i = 0; i < industrial.fx.length; i++) industrial.fx[i].visible = false;
  skyDetails.group.visible = false; // clouds + birds stay out of the ink/AO prepass
  hitEffect.group.visible = false;  // impact bursts too
  shops.fx.visible = false;         // ramen steam sprites too
  entranceMarkers.group.visible = false; // transparent markers too
  stairMarkerGroup.visible = false;      // station holo pads too
  motes.visible = false;                 // floating dust motes too
  // Username sprites: no ink outline, no AO. This one has to save/restore its
  // flag rather than force it back on — it's also in worldGroups, which hides
  // the whole outdoor world while you're inside a shop.
  const labelsWereVisible = crowd.labels.visible;
  crowd.labels.visible = false;
  crowd.beginNormalPass();               // drop distant avatars from the ink/AO pass
  weather.group.visible = false;         // rain streaks stay out of the ink/AO prepass
  // Swap the Water for its flat depth proxy: the real Water can't render here
  // (its onBeforeRender would re-render the reflection), but the prepass still
  // needs the sea's depth/normal so outlines + AO composite correctly on it.
  environment.ocean.visible = false;
  environment.oceanProxy.visible = true;
  renderer.setRenderTarget(normalTarget);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  grass.visible = true;
  parkGrass.visible = true;
  environment.ocean.visible = true;
  environment.oceanProxy.visible = false;
  for (let i = 0; i < industrial.fx.length; i++) industrial.fx[i].visible = true;
  skyDetails.group.visible = true;
  hitEffect.group.visible = true;
  shops.fx.visible = true;
  entranceMarkers.group.visible = true;
  stairMarkerGroup.visible = true;
  motes.visible = true;
  crowd.labels.visible = labelsWereVisible;
  crowd.endNormalPass();
  weather.group.visible = true;
  scene.overrideMaterial = null;
}

// Drive the atmosphere passes + motes from the live sun direction and daylight,
// so rim light / god rays / motes fade out at night and shafts only appear when
// you're looking toward the sun. Kept subtle.
const _sunView = new THREE.Vector3(), _sunProj = new THREE.Vector3(), _camFwd = new THREE.Vector3();
function updateAtmosphere() {
  camera.updateMatrixWorld();
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  const day = 1 - night;
  _sunView.copy(sun).transformDirection(camera.matrixWorldInverse);
  rimPass.uniforms.sunView.value.copy(_sunView);
  rimPass.uniforms.rimStrength.value = 0.16 * (0.5 + 0.5 * day);
  camera.getWorldDirection(_camFwd);
  const facing = _camFwd.dot(sun);
  _sunProj.copy(camera.position).addScaledVector(sun, 6000).project(camera);
  godrayPass.uniforms.sunUV.value.set(_sunProj.x * 0.5 + 0.5, _sunProj.y * 0.5 + 0.5);
  godrayPass.uniforms.strength.value = 0.34 * day * THREE.MathUtils.smoothstep(facing, 0.05, 0.45);
  motes.position.set(camera.position.x, 0, camera.position.z);
  moteTime.value = elapsed;
  moteMat.opacity = 0.5 * (0.35 + 0.65 * day);
}

// ---------------------------------------------------------------------------
// Resize
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  normalTarget.setSize(size.x, size.y);
  outlinePass.uniforms.resolution.value.set(size.x, size.y);
  renderer.getDrawingBufferSize(dpr);   // refresh cached buffer size…
  applyPerf(perfLevel);                 // …then re-apply bloom/shadow tier (composer.setSize reset them)
});

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------
// --- Performance HUD (FPS · draw calls · triangles). Toggle with P. ----------
const statsEl = document.createElement('div');
// Bottom centre: the top-left corner now belongs to the leaderboard.
statsEl.style.cssText = 'position:fixed;bottom:8px;left:50%;transform:translateX(-50%);text-align:center;z-index:60;padding:6px 9px;border-radius:6px;background:rgba(10,14,20,.78);color:#8dffb0;font:600 12px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;pointer-events:none;';
document.body.appendChild(statsEl);
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyP' && !isTypingInUI()) {
    statsEl.style.display = statsEl.style.display === 'none' ? 'block' : 'none';
  }
});
// Frustum-gate the expensive far-away animation updates: a system only ticks
// when its bounding sphere is on-screen (its animation is invisible otherwise,
// and being delta-driven it resumes seamlessly when it comes back into view).
const _frustum = new THREE.Frustum();
const _fmat = new THREE.Matrix4();
function sphereOf(group, pad = 1.3) {
  const s = new THREE.Sphere();
  new THREE.Box3().setFromObject(group).getBoundingSphere(s);
  if (!isFinite(s.radius) || s.radius <= 0) s.radius = 1e6; // safe fallback: always update
  s.radius *= pad;
  return s;
}
const pierSphere = sphereOf(pier.group);
const industrialSphere = sphereOf(industrial.group);
const landmarksSphere = sphereOf(landmarks.group);
const onScreen = (sphere) => _frustum.intersectsSphere(sphere);

let _fpsAcc = 0, _fpsFrames = 0;
function updateStats(dt) {
  _fpsAcc += dt; _fpsFrames++;
  if (_fpsAcc >= 0.5) {
    const r = renderer.info.render;
    const v = crowd.stats;
    statsEl.textContent =
      `${Math.round(_fpsFrames / _fpsAcc)} fps\n` +
      `${r.calls} draw calls\n` +
      `${(r.triangles / 1000).toFixed(0)}k tris\n` +
      `crowd ${v.visible}/${v.cap} drawn · ${v.total} alive\n` +
      `${PERF_TIERS[perfLevel].name}${usePost ? '' : ' · POST OFF'} (K/O)`;
    _fpsAcc = 0; _fpsFrames = 0;
  }
}

const clock = new THREE.Clock();
let elapsed = 0;
function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  renderer.info.reset(); // start counting this frame's draw calls (all passes)
  if (mode === 'opening') opening.update(dt);  // scripted hospital cutscene owns the camera
  else if (mode === 'carAnim') {
    // Controls are disabled, but update() still runs so the follow camera keeps
    // framing the character (and any knockback keeps carrying them).
    controls.update(dt);
    // Re-assert the lock after the controller has had its say, so nothing it
    // does (collision push-out, ground follow) can drift the character.
    applyCarLock();
    if (carAnim) {
      carAnim.t += dt;
      if (carAnim.t >= carAnim.dur) { const done = carAnim.then; carAnim = null; done(); }
    }
  }
  else if (mode === 'driving') {
    driving.update(dt);                      // hijacked car owns the camera
    // Keep the (hidden) character with the car so the shadow frustum, minimap
    // arrow, crowd LOD and mission objectives all follow where you actually are.
    const cp = driving.pos;
    if (cp) { character.group.position.set(cp.x, 0, cp.z); character.group.rotation.y = cp.yaw; }
  }
  else if (mode === 'briefing') { if (brief) brief.update(dt); } // mission briefing owns the camera
  else if (mode === 'warping') updateWarp(dt); // eased climb up the station stairs
  else if (mode !== 'riding') controls.update(dt); // ride camera is driven after the train moves
  // Rigged VRM locals + simulated other players. Frustum-culled and LOD'd
  // internally, so this is cheap even though everyone is a full avatar.
  crowd.update(dt, camera, character.group.position);
  social.update(dt, character.group.position);  // chat chatter + live leaderboard
  updateNeeds(dt);           // stat decay, resting, purchase receipt
  // Paused during a briefing — the player has no control, so no clock runs.
  if (started && mode !== 'briefing') missions.update(dt, character.group.position, mode === 'outside' || mode === 'driving');
  traffic.update(dt, started && mode === 'outside' ? character.group.position : null);
  hitEffect.update(dt);      // animate any active punch impact bursts
  checkDoors();              // enterable-shop proximity prompt
  entranceMarkers.update(dt, nearDoor); // bob/spin markers; pulse the one in range
  updateStairMarkers(dt);    // station stair "ride up" holograms
  // Refresh the camera frustum, then only tick far systems that are on-screen.
  _fmat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_fmat);
  if (onScreen(pierSphere)) pier.update(dt);        // spin the Ferris wheel
  minimap.update(character.group.position.x, character.group.position.z, character.group.rotation.y);
  updateDayNight(dt);        // advance the clock, move the sun, fade sky/lights
  if (onScreen(landmarksSphere)) landmarks.update(dt, night);   // lighthouse beam, beacon
  if (onScreen(industrialSphere)) industrial.update(dt, night); // cranes, smoke, turbines, sparks
  monorail.update(dt);         // loop the sky-train around the city
  checkArrival();              // fire the "Now arriving" banner on a real station stop
  if (mode === 'riding') updateRide(dt); // ride the camera on the moving train
  updateSchedule();            // live platform train-schedule panel
  shops.update(dt);            // rising steam from the ramen pots
  skyDetails.update(dt, camera, night); // drift clouds + fly the bird flocks
  updateShadowCamera();      // then aim the shadow frustum along the new sun
  windTime.value = elapsed;  // drive the grass + tree-canopy wind shaders
  environment.water.value = elapsed; // roll the ocean waves
  skyMat.uniforms.uTime.value = elapsed; // drift the clouds
  updateAtmosphere();        // sun-driven rim light / god rays / drifting motes
  weather.update(dt, night, mode === 'inside'); // rain / overcast (after atmosphere, before render)
  if (usePost) {
    renderNormalPass();      // fill normal + depth buffers for outline + GTAO
    composer.render();       // beauty -> AO -> outline -> bloom -> grade -> output
  } else {
    renderer.render(scene, camera); // diagnostic: raw render, no post + no normal prepass
  }
  updateStats(dt);           // read this frame's draw-call / triangle totals
  requestAnimationFrame(animate);
}
animate();
