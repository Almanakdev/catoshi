import * as THREE from 'three';
import { paint, box, cyl, merge, C } from '../engine/prim.js';
import { makeGroundTexture, makeStuccoTexture } from '../engine/textures.js';
import { WORLD, ROADS, DISTRICTS, HOME, districtAt } from '../data/districts.js';
import { BUILDING_TYPES, buildBuildingInstances, buildSushiShop } from './buildings.js';
import { buildPropInstances } from './props.js';
import { SUPPLIERS } from '../data/suppliers.js';
import { NPCS } from '../data/npcs.js';
import { DEFAULT_SPOTS } from '../game/fishing.js';

// ---------------------------------------------------------------------------
// SUSHI PAWS — the hand-authored city.
//
// Everything here is placed by hand, district by district: rows of machiya
// lining narrow lanes, a working harbour, an office street, a suburb of
// gardens and a single packed neon food street. Nothing is procedurally
// generated except the *dressing* (lamp posts, planters, poles) which is
// scattered along hand-picked bands with a seeded RNG so the city is identical
// on every load.
//
// Draw-call budget: every surface is either merged into one geometry or drawn
// from an InstancedMesh, so the whole city lands well under 400 draws.
//
// Coordinates: +X east, +Z south, Y up. Buildings face +Z at yaw 0.
// ---------------------------------------------------------------------------

const PAL = {
  groundBase: '#e7dbbe',
  asphalt: '#b7b1a2',
  asphaltWarm: '#c0b8a6',
  kerb: '#d8d2c0',
  line: '#f0e7cd',
  paving: '#dcd3ba',
  pavingEdge: '#c6bda4',
  stone: '#cac4b5',
  stoneD: '#a49d8d',
  water: '#5aa3ab',
  waterDeep: '#3f8592',
  waterFoam: '#a8d6d6',
  timber: '#8a5a34',
  timberD: '#5b4a3a',
  deck: '#a87b4e',
  park: '#cdd7a8',
  parkSoft: '#c6d3a2',
  gravel: '#ddd4bb',
  plazaTile: '#d9d0bd',      // the home plaza paving — cool stone, not sand
  plazaEdge: '#bfb7a4',
  plazaJoint: '#aca492',
  neonGround: '#4a4658',
};

// ---------------------------------------------------------------------------
// Hand-authored extras that are not in districts.js
// ---------------------------------------------------------------------------

/** Narrow stone pedestrian lanes. Same shape as ROADS but paved, not asphalt. */
const LANES = [
  // Old Market — the alley grid. Deliberately 4–5 wide: alleys, not avenues.
  // (`upper`/`lower` are named for the map, not the axis: -Z is north.)
  { id: 'lane_west', x: -100, z: 2, w: 5, d: 84, name: 'Cooper Alley' },
  { id: 'lane_mid', x: -70, z: 2, w: 5, d: 84, name: 'Rice Alley' },
  { id: 'lane_east', x: -42, z: 12, w: 5, d: 64, name: 'Lantern Alley' },
  { id: 'lane_upper', x: -84, z: -24, w: 76, d: 5, name: 'Upper Lane' },
  { id: 'lane_lower', x: -84, z: 32, w: 76, d: 5, name: 'Lower Lane' },
  { id: 'shrine_walk', x: -110, z: 44, w: 4, d: 24, name: 'Shrine Walk' },
  // Residential — a garden lane behind the main loop.
  { id: 'garden_lane', x: 6, z: 84, w: 112, d: 6, name: 'Garden Lane' },
  // Downtown — the canal towpath.
  { id: 'canal_walk', x: 111, z: 59, w: 5, d: 34, name: 'Canal Walk' },
];

/** Water bodies. Non-overlapping rects; everything z < WORLD.waterZ is sea. */
const WATER = [
  { id: 'sea', x0: -260, x1: 260, z0: -420, z1: WORLD.waterZ },
  { id: 'basin', x0: -84, x1: 40, z0: WORLD.waterZ, z1: -138 },
  { id: 'inlet', x0: 110, x1: 140, z0: WORLD.waterZ, z1: -128 },
  { id: 'canal', x0: 98, x1: 107, z0: 44, z1: 74 },
];

/** Piers running north from the basin quay at z = -138. Deck at y = 0.5. */
const DECK_Y = 0.5;
const PIERS = [
  { id: 'pier_west', x: -60, w: 5, z0: -150, z1: -138 },
  { id: 'pier_mid', x: -20, w: 6, z0: -152, z1: -138 },
  { id: 'pier_east', x: 20, w: 5, z0: -149, z1: -138 },
];

/**
 * The home plaza — the paved square the player spawns on, wrapped around the
 * shop. Buildings frame it on three sides; the scatterers stay out of it so
 * the dressing inside can be placed by hand.
 */
const PLAZA = { x0: -39.8, x1: -14.2, z0: 8.5, z1: 48.5 };
const PLAZA_KEEP = { x0: -41, x1: -13, z0: 3, z1: 50 };

// ---------------------------------------------------------------------------
// Small maths helpers
// ---------------------------------------------------------------------------

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rectOf = (r) => ({ x0: r.x - r.w / 2, x1: r.x + r.w / 2, z0: r.z - r.d / 2, z1: r.z + r.d / 2 });
const overlaps = (a, b, pad = 0) =>
  a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.z0 < b.z1 + pad && a.z1 > b.z0 - pad;
const inRect = (x, z, r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

/** yaw so a prop's local +Z looks along (dx,dz). */
const yawFace = (dx, dz) => Math.atan2(dx, dz);

// ---------------------------------------------------------------------------
// Flat geometry helpers (all merged, all vertex-coloured)
// ---------------------------------------------------------------------------

function flatRect(x, z, w, d, color, y = 0.02) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  return paint(g, color);
}

function roundedRect(x, z, w, d, r, color, y = 0.012) {
  const hw = w / 2, hd = d / 2;
  const rr = Math.max(0.01, Math.min(r, hw - 0.01, hd - 0.01));
  const s = new THREE.Shape();
  s.moveTo(-hw + rr, -hd);
  s.lineTo(hw - rr, -hd);
  s.quadraticCurveTo(hw, -hd, hw, -hd + rr);
  s.lineTo(hw, hd - rr);
  s.quadraticCurveTo(hw, hd, hw - rr, hd);
  s.lineTo(-hw + rr, hd);
  s.quadraticCurveTo(-hw, hd, -hw, hd - rr);
  s.lineTo(-hw, -hd + rr);
  s.quadraticCurveTo(-hw, -hd, -hw + rr, -hd);
  const g = new THREE.ShapeGeometry(s, 5);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  return paint(g, color);
}

// ---------------------------------------------------------------------------
// createWorld
// ---------------------------------------------------------------------------

/**
 * Build the whole city.
 * @param {object} game   the shared game object (see src/game/CONTRACT.md)
 * @param {{gradientMap?: THREE.Texture}} opts
 */
export function createWorld(game, { gradientMap = null } = {}) {
  const group = new THREE.Group();
  group.name = 'city';

  /** @type {THREE.Box3[]} stable reference — never reassigned. */
  const colliders = [];
  const glowMats = [];
  const neonMats = [];

  const rng = mulberry32(WORLD.seed >>> 0);
  const textures = [];
  const ownedMats = [];
  const ownedGeos = [];

  const trackTex = (t) => { if (t) textures.push(t); return t; };
  const trackMat = (m) => { if (m) ownedMats.push(m); return m; };
  const trackGeo = (g) => { if (g) ownedGeos.push(g); return g; };

  const ROAD_RECTS = ROADS.map((r) => ({ ...rectOf(r), id: r.id, road: r }));
  const LANE_RECTS = LANES.map((r) => ({ ...rectOf(r), id: r.id, road: r }));
  const PAVED = ROAD_RECTS.concat(LANE_RECTS);

  const onPaving = (x, z, pad = 0) => PAVED.some((r) => inRect(x, z, {
    x0: r.x0 - pad, x1: r.x1 + pad, z0: r.z0 - pad, z1: r.z1 + pad,
  }));
  const inWater = (x, z, pad = 0) => WATER.some((w) => inRect(x, z, {
    x0: w.x0 - pad, x1: w.x1 + pad, z0: w.z0 - pad, z1: w.z1 + pad,
  }));

  // =========================================================================
  // 1. GROUND — one shape for the land (notched around the water), plus
  //    per-district colour patches and gap-filling parks.
  // =========================================================================

  const groundTex = trackTex(makeGroundTexture());
  groundTex.repeat.set(26, 26);

  const groundMat = trackMat(new THREE.MeshToonMaterial({
    color: PAL.groundBase, map: groundTex, gradientMap,
  }));

  // Land outline: a big rect from the shoreline south, notched for the harbour
  // basin and the neon inlet, with the downtown canal punched out as a hole.
  const land = new THREE.Shape();
  const P = (x, z) => land.lineTo(x, -z);
  land.moveTo(-260, -260);            // (x=-260, z=260) SW
  P(260, 260); P(260, WORLD.waterZ);
  P(140, WORLD.waterZ); P(140, -128); P(110, -128); P(110, WORLD.waterZ);
  P(40, WORLD.waterZ); P(40, -138); P(-84, -138); P(-84, WORLD.waterZ);
  P(-260, WORLD.waterZ);
  land.closePath();
  const canalHole = new THREE.Path();
  canalHole.moveTo(98, -44);
  canalHole.lineTo(107, -44);
  canalHole.lineTo(107, -74);
  canalHole.lineTo(98, -74);
  canalHole.closePath();
  land.holes.push(canalHole);

  const groundGeo = trackGeo(new THREE.ShapeGeometry(land, 4));
  groundGeo.rotateX(-Math.PI / 2);
  {
    // ShapeGeometry hands back raw x/y as UV — rescale to a 16-unit tile.
    const uv = groundGeo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 16, uv.getY(i) / 16);
    uv.needsUpdate = true;
  }
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.name = 'ground';
  groundMesh.receiveShadow = true;
  groundMesh.position.y = 0;
  group.add(groundMesh);

  // -- district colour patches + filler parks/plazas ------------------------
  const patchParts = [];
  // Patches are clipped by hand so none of them ever paints over water.
  const districtPatch = {
    old_market: [{ x: -72, z: 4, w: 96, d: 92, r: 16 }],
    fish_harbor: [{ x: -8, z: -104.5, w: 124, d: 67, r: 14 }],
    downtown: [{ x: 70.5, z: 22, w: 53, d: 104, r: 16 }, { x: 119.5, z: 22, w: 25, d: 104, r: 12 }],
    residential: [{ x: 6, z: 104, w: 112, d: 80, r: 18 }],
    neon_street: [{ x: 82, z: -104, w: 52, d: 76, r: 16 }, { x: 123, z: -96, w: 26, d: 60, r: 12 }],
  };
  for (const d of DISTRICTS) {
    for (const p of districtPatch[d.id] || []) {
      patchParts.push(roundedRect(p.x, p.z, p.w, p.d, p.r, d.ground, 0.012));
    }
  }

  // Gap fillers: small parks and plazas so no bare ground shows between zones.
  const FILLERS = [
    { x: -110, z: 46, w: 26, d: 28, r: 10, c: PAL.gravel },      // shrine precinct
    { x: -12, z: -60, w: 52, d: 30, r: 12, c: PAL.park },        // harbour park
    { x: -96, z: -60, w: 44, d: 26, r: 12, c: PAL.park },        // west green
    { x: 26, z: 40, w: 36, d: 44, r: 12, c: PAL.park },          // mid park
    { x: 30, z: -30, w: 46, d: 34, r: 12, c: PAL.park },         // link park
    { x: -46, z: 74, w: 40, d: 26, r: 12, c: PAL.park },         // suburb green
    { x: 92, z: 92, w: 44, d: 30, r: 12, c: PAL.park },          // east green
    { x: 74, z: -134, w: 26, d: 26, r: 10, c: PAL.neonGround },  // festival square
    { x: -60, z: -132, w: 60, d: 12, r: 4, c: PAL.gravel },      // harbour apron
    { x: 16, z: -132, w: 56, d: 12, r: 4, c: PAL.gravel },
    { x: 120, z: 59, w: 22, d: 36, r: 8, c: PAL.park },          // canal green
    { x: -30, z: -88, w: 60, d: 26, r: 12, c: PAL.park },        // harbour approach
    { x: 30, z: -88, w: 46, d: 26, r: 12, c: PAL.park },
    { x: 62, z: -84, w: 22, d: 30, r: 10, c: PAL.park },         // neon approach
    { x: 46, z: 62, w: 34, d: 30, r: 12, c: PAL.park },          // downtown green
  ];
  for (const f of FILLERS) patchParts.push(roundedRect(f.x, f.z, f.w, f.d, f.r, f.c, 0.02));

  // -- the home plaza paving ------------------------------------------------
  // A cool stone square, deliberately a different family of colour from the
  // warm sand ground so the plaza reads as *built* the moment you spawn on it:
  // a kerbed apron, a tiled field inside it, and a grid of paving joints.
  {
    const cx = (PLAZA.x0 + PLAZA.x1) / 2;
    const cz = (PLAZA.z0 + PLAZA.z1) / 2;
    const pw = PLAZA.x1 - PLAZA.x0;
    const pd = PLAZA.z1 - PLAZA.z0;
    patchParts.push(roundedRect(cx, cz, pw, pd, 5, PAL.plazaEdge, 0.022));
    patchParts.push(roundedRect(cx, cz, pw - 1.8, pd - 1.8, 4.2, PAL.plazaTile, 0.026));
    for (let x = PLAZA.x0 + 3.2; x < PLAZA.x1 - 1.5; x += 3.2) {
      patchParts.push(flatRect(x, cz, 0.13, pd - 2.6, PAL.plazaJoint, 0.03));
    }
    for (let z = PLAZA.z0 + 3.2; z < PLAZA.z1 - 1.5; z += 3.2) {
      patchParts.push(flatRect(cx, z, pw - 2.6, 0.13, PAL.plazaJoint, 0.03));
    }
    // A darker inlaid band right in front of the shop door, so the eye is
    // pulled from the spawn point straight to the counter.
    patchParts.push(flatRect(HOME.shop.x, 27.5, 4.4, 9.5, PAL.plazaEdge, 0.032));
    patchParts.push(flatRect(HOME.shop.x, 27.5, 3.6, 8.7, PAL.plazaTile, 0.034));
  }

  // =========================================================================
  // 2. ROADS — asphalt strips, kerbs, centre lines, stone alleys.
  // =========================================================================

  const roadParts = [];
  for (const r of ROADS) {
    const along = r.w >= r.d ? 'x' : 'z';
    roadParts.push(flatRect(r.x, r.z, r.w, r.d, PAL.asphalt, 0.05));
    if (along === 'x') {
      roadParts.push(flatRect(r.x, r.z - r.d / 2 + 0.35, r.w, 0.7, PAL.kerb, 0.07));
      roadParts.push(flatRect(r.x, r.z + r.d / 2 - 0.35, r.w, 0.7, PAL.kerb, 0.07));
      const n = Math.max(2, Math.floor(r.w / 6));
      for (let i = 0; i < n; i++) {
        roadParts.push(flatRect(r.x - r.w / 2 + (r.w / n) * (i + 0.5), r.z, 3.0, 0.24, PAL.line, 0.08));
      }
    } else {
      roadParts.push(flatRect(r.x - r.w / 2 + 0.35, r.z, 0.7, r.d, PAL.kerb, 0.07));
      roadParts.push(flatRect(r.x + r.w / 2 - 0.35, r.z, 0.7, r.d, PAL.kerb, 0.07));
      const n = Math.max(2, Math.floor(r.d / 6));
      for (let i = 0; i < n; i++) {
        roadParts.push(flatRect(r.x, r.z - r.d / 2 + (r.d / n) * (i + 0.5), 0.24, 3.0, PAL.line, 0.08));
      }
    }
  }
  // Stone alleys: paving + a darker gutter band each side. No centre lines —
  // these read as pedestrian, not vehicular.
  for (const l of LANES) {
    const along = l.w >= l.d ? 'x' : 'z';
    roadParts.push(flatRect(l.x, l.z, l.w, l.d, PAL.paving, 0.045));
    if (along === 'x') {
      roadParts.push(flatRect(l.x, l.z - l.d / 2 + 0.28, l.w, 0.56, PAL.pavingEdge, 0.06));
      roadParts.push(flatRect(l.x, l.z + l.d / 2 - 0.28, l.w, 0.56, PAL.pavingEdge, 0.06));
      const n = Math.max(2, Math.round(l.w / 2.4));
      for (let i = 0; i < n; i++) {
        roadParts.push(flatRect(l.x - l.w / 2 + (l.w / n) * (i + 0.5), l.z, 0.1, l.d - 1.2, PAL.pavingEdge, 0.055));
      }
    } else {
      roadParts.push(flatRect(l.x - l.w / 2 + 0.28, l.z, 0.56, l.d, PAL.pavingEdge, 0.06));
      roadParts.push(flatRect(l.x + l.w / 2 - 0.28, l.z, 0.56, l.d, PAL.pavingEdge, 0.06));
      const n = Math.max(2, Math.round(l.d / 2.4));
      for (let i = 0; i < n; i++) {
        roadParts.push(flatRect(l.x, l.z - l.d / 2 + (l.d / n) * (i + 0.5), l.w - 1.2, 0.1, PAL.pavingEdge, 0.055));
      }
    }
  }

  const roadMat = trackMat(new THREE.MeshToonMaterial({
    vertexColors: true, gradientMap,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
  }));
  const roadGeo = trackGeo(merge(roadParts));
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.name = 'roads';
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // Road intersections → zebra crossings on every approach.
  const intersections = [];
  for (let i = 0; i < ROAD_RECTS.length; i++) {
    for (let j = i + 1; j < ROAD_RECTS.length; j++) {
      const a = ROAD_RECTS[i], b = ROAD_RECTS[j];
      if (!overlaps(a, b)) continue;
      const cx = (Math.max(a.x0, b.x0) + Math.min(a.x1, b.x1)) / 2;
      const cz = (Math.max(a.z0, b.z0) + Math.min(a.z1, b.z1)) / 2;
      intersections.push({ x: cx, z: cz, a: a.road, b: b.road });
    }
  }

  // =========================================================================
  // 3. WATER — the harbour, the neon inlet and the downtown canal.
  // =========================================================================

  const waterParts = [];
  for (const w of WATER) {
    const ww = w.x1 - w.x0, dd = w.z1 - w.z0;
    const g = new THREE.PlaneGeometry(ww, dd, Math.max(1, Math.round(ww / 20)), Math.max(1, Math.round(dd / 20)));
    g.rotateX(-Math.PI / 2);
    g.translate((w.x0 + w.x1) / 2, 0, (w.z0 + w.z1) / 2);
    waterParts.push(paint(g, w.id === 'sea' ? PAL.water : PAL.waterDeep));
  }
  const waterGeo = trackGeo(merge(waterParts));
  const waterMat = trackMat(new THREE.MeshToonMaterial({
    vertexColors: true, gradientMap, transparent: true, opacity: 0.94,
  }));
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.name = 'water';
  waterMesh.position.y = -0.28;
  waterMesh.receiveShadow = false;
  group.add(waterMesh);
  const waterPos = waterGeo.attributes.position;
  const waterBase = Float32Array.from(waterPos.array);

  // -- quay edge walls + piers ----------------------------------------------
  const quayParts = [];
  /** A stone bulkhead: `side` says which way the land is. */
  function quayWall(x, z, w, d, color = PAL.stoneD) {
    quayParts.push(box(w, 1.5, d, x, 0.0, z, color));
    quayParts.push(box(w + 0.2, 0.22, d + 0.2, x, 0.62, z, PAL.stone));
    colliders.push(new THREE.Box3(
      new THREE.Vector3(x - w / 2, 0, z - d / 2),
      new THREE.Vector3(x + w / 2, 1.4, z + d / 2),
    ));
  }
  const pierMouths = PIERS.map((p) => ({ x0: p.x - p.w / 2 - 0.4, x1: p.x + p.w / 2 + 0.4 }));
  /** Walk a shoreline run along X, skipping the pier mouths. */
  function shorelineX(x0, x1, z, thickness = 1.4) {
    const cuts = pierMouths.filter((m) => m.x1 > x0 && m.x0 < x1).sort((a, b) => a.x0 - b.x0);
    let cur = x0;
    for (const c of cuts) {
      if (c.x0 > cur) quayWall((cur + c.x0) / 2, z, c.x0 - cur, thickness);
      cur = Math.max(cur, c.x1);
    }
    if (cur < x1) quayWall((cur + x1) / 2, z, x1 - cur, thickness);
  }

  // Open coast either side of the basin / inlet.
  shorelineX(-178, -84, WORLD.waterZ + 0.7);
  shorelineX(40, 110, WORLD.waterZ + 0.7);
  shorelineX(140, 178, WORLD.waterZ + 0.7);
  // Basin: west wall, south quay (with pier mouths), east wall.
  quayWall(-84.7, -145, 1.4, 14);
  shorelineX(-84, 40, -137.3);
  quayWall(40.7, -145, 1.4, 14);
  // Neon inlet.
  quayWall(109.3, -140, 1.4, 24);
  quayWall(125, -127.3, 30, 1.4);
  quayWall(140.7, -140, 1.4, 24);
  // Downtown canal — low kerbs, open at both ends so nobody gets boxed in.
  quayParts.push(box(0.6, 0.5, 30, 97.7, 0.05, 59, PAL.stone));
  quayParts.push(box(0.6, 0.5, 30, 107.3, 0.05, 59, PAL.stone));
  colliders.push(new THREE.Box3(new THREE.Vector3(97.4, 0, 44), new THREE.Vector3(98.0, 0.4, 74)));
  colliders.push(new THREE.Box3(new THREE.Vector3(107.0, 0, 44), new THREE.Vector3(107.6, 0.4, 74)));

  // Piers: plank decks, edge kerbs, cross beams.
  for (const p of PIERS) {
    const len = p.z1 - p.z0;
    const cz = (p.z0 + p.z1) / 2;
    quayParts.push(box(p.w, 0.24, len, p.x, DECK_Y - 0.12, cz, PAL.deck));
    const planks = Math.round(len / 1.2);
    for (let i = 0; i < planks; i++) {
      quayParts.push(box(p.w - 0.2, 0.06, 0.16, p.x, DECK_Y + 0.02, p.z0 + (len / planks) * (i + 0.5), PAL.timberD));
    }
    for (const sx of [-1, 1]) {
      quayParts.push(box(0.24, 0.34, len, p.x + sx * (p.w / 2 - 0.12), DECK_Y + 0.1, cz, PAL.timberD));
      colliders.push(new THREE.Box3(
        new THREE.Vector3(p.x + sx * (p.w / 2 - 0.12) - 0.12, 0, p.z0),
        new THREE.Vector3(p.x + sx * (p.w / 2 - 0.12) + 0.12, DECK_Y + 0.34, p.z1),
      ));
      // Support posts down into the water.
      for (let i = 0; i <= 3; i++) {
        quayParts.push(cyl(0.16, 0.18, 1.6, 6, p.x + sx * (p.w / 2 - 0.2), -0.5, p.z0 + (len / 3) * i, PAL.timber));
      }
    }
    // End stop so nobody walks off the north end.
    quayParts.push(box(p.w, 0.5, 0.3, p.x, DECK_Y + 0.15, p.z0 + 0.15, PAL.timberD));
    colliders.push(new THREE.Box3(
      new THREE.Vector3(p.x - p.w / 2, 0, p.z0),
      new THREE.Vector3(p.x + p.w / 2, DECK_Y + 0.5, p.z0 + 0.3),
    ));
  }

  const quayMat = trackMat(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap }));
  const quayGeo = trackGeo(merge(quayParts));
  const quayMesh = new THREE.Mesh(quayGeo, quayMat);
  quayMesh.name = 'quay';
  quayMesh.castShadow = true;
  quayMesh.receiveShadow = true;
  group.add(quayMesh);

  // =========================================================================
  // 4. BUILDINGS — hand placed, district by district.
  // =========================================================================

  /** @type {Array<{id:string,x:number,z:number,yaw:number,variant?:string,district:string,tag?:string}>} */
  const placements = [];
  const rejects = [];

  const footOf = (id, yaw) => {
    const f = (BUILDING_TYPES[id] && BUILDING_TYPES[id].foot) || { w: 8, d: 8 };
    const horiz = Math.abs(Math.sin(yaw)) > 0.5;
    return horiz ? { w: f.d, d: f.w } : { w: f.w, d: f.d };
  };

  function place(id, x, z, yaw, variant, district, tag) {
    if (!BUILDING_TYPES[id]) { rejects.push({ id, x, z, why: 'unknown type' }); return null; }
    const p = { id, x, z, yaw: yaw || 0, district, tag };
    if (variant) p.variant = variant;
    placements.push(p);
    return p;
  }

  /**
   * A run of buildings shoulder-to-shoulder along a street.
   * `face` is the direction the fronts look; `edge` is the coordinate of the
   * street-side face plane. Items are laid out left→right (or top→bottom),
   * centred inside [a0,a1].
   */
  function shelf({ face, edge, a0, a1, items, gap = 0.9, district, tag }) {
    const yaw = face === '+z' ? 0 : face === '-z' ? Math.PI : face === '+x' ? Math.PI / 2 : -Math.PI / 2;
    const along = face === '+z' || face === '-z' ? 'x' : 'z';
    const sizes = items.map((it) => footOf(it.id, yaw));
    const total = sizes.reduce((s, f) => s + (along === 'x' ? f.w : f.d), 0) + gap * (items.length - 1);
    const span = a1 - a0;
    if (total > span + 0.001) {
      console.warn(`[world] shelf overflows band by ${(total - span).toFixed(2)} (${district}/${tag || ''})`);
    }
    let cur = (a0 + a1) / 2 - total / 2;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const f = sizes[i];
      const halfAlong = (along === 'x' ? f.w : f.d) / 2;
      const across = (along === 'x' ? f.d : f.w) / 2;
      const a = cur + halfAlong;
      cur += halfAlong * 2 + gap;
      const x = along === 'x' ? a : (face === '+x' ? edge - across : edge + across);
      const z = along === 'x' ? (face === '+z' ? edge - across : edge + across) : a;
      place(it.id, x, z, yaw, it.v, district, tag);
    }
  }

  const M = (v) => ({ id: 'machiya', v });
  const S = (v) => ({ id: 'marketStall', v });

  // ---------------------------------------------------- OLD MARKET (27) ----
  // Dense machiya rows along Market Road and the alley grid, a stall square,
  // the tea house, the bathhouse and a shrine precinct (props) to the north.
  // Bands sit BETWEEN the alleys so no row ever crosses one.
  // North side of Market Road (fronts look south).
  shelf({ face: '+z', edge: -7.2, a0: -121, a1: -103, district: 'old_market', tag: 'market_road_n',
    items: [M('sand'), M('cream')] });
  shelf({ face: '+z', edge: -7.2, a0: -97, a1: -73, district: 'old_market', tag: 'market_road_n',
    items: [M('sand'), M('cream'), { id: 'yatai' }] });
  shelf({ face: '+z', edge: -7.2, a0: -67, a1: -51, district: 'old_market', tag: 'market_road_n',
    items: [M('cream'), { id: 'yatai' }] });
  // South side of Market Road.
  shelf({ face: '-z', edge: 7.2, a0: -121, a1: -103, district: 'old_market', tag: 'market_road_s',
    items: [{ id: 'teaHouse' }, M('cream')] });
  shelf({ face: '-z', edge: 7.2, a0: -97, a1: -73, district: 'old_market', tag: 'market_road_s',
    items: [{ id: 'bathhouse' }, M('sand')] });

  // Taro's Pantry — on the corner of Lantern Alley, facing west.
  place('marketStall', -47.6, -8.9, -Math.PI / 2, 'rice', 'old_market', 'market_pantry');

  // The stall square (Yuki's is the centrepiece).
  place('marketStall', -64.8, 10.6, Math.PI, 'sweets', 'old_market', 'square');
  place('marketStall', -58, 14, Math.PI, 'rice', 'old_market', 'yuki_stall');
  place('marketStall', -51, 10.6, Math.PI, 'veg', 'old_market', 'square');
  place('marketStall', -64.8, 19.2, Math.PI, 'fish', 'old_market', 'square');
  place('festivalStall', -51, 19.2, Math.PI, 'goldfish', 'old_market', 'square');

  // ---- the home plaza frame -----------------------------------------------
  // Before this the plaza was a bare apron with the nearest row 25 units away.
  // These four runs close it into a courtyard: a shallow stall row backing
  // Market Road to the north, a machiya terrace facing west down the east
  // side, a terrace facing north across the south side, and a single stall on
  // the far bank of Lantern Alley to the west. The rows are set out so the
  // shop's reserved rect, Market Road, Harbour Avenue and both alleys stay
  // clear — see the placement validator below, which rejects anything that
  // does not.
  // Directly behind the shop the stalls turn around and trade onto Market Road
  // — a stall facing a blank wall a metre away would be nonsense.
  shelf({ face: '-z', edge: 5.65, a0: -39, a1: -24, district: 'old_market', tag: 'plaza_n',
    items: [S('veg'), S('sweets')] });
  shelf({ face: '+z', edge: 8.9, a0: -22, a1: -8, district: 'old_market', tag: 'plaza_n',
    items: [S('rice'), { id: 'festivalStall', v: 'goldfish' }] });
  shelf({ face: '-x', edge: -14, a0: 13, a1: 43, district: 'old_market', tag: 'plaza_e',
    items: [M('cream'), S('fish'), M('sand')], gap: 1.2 });
  // The south terrace is held back to z = 50: the chase camera trails ~6 units
  // behind the player, so anything nearer would put it inside a wall whenever
  // the player stands at the south end of the square and looks back at the shop.
  shelf({ face: '-z', edge: 50, a0: -39, a1: -14, district: 'old_market', tag: 'plaza_s',
    items: [M('sage'), { id: 'teaHouse' }, S('sweets')], gap: 1.0 });
  place('marketStall', -46.65, 25.35, Math.PI / 2, 'veg', 'old_market', 'plaza_w');

  // North of Upper Lane (fronts look south onto it).
  shelf({ face: '+z', edge: -26.8, a0: -121, a1: -103, district: 'old_market', tag: 'upper_lane_n',
    items: [M('single'), { id: 'festivalStall', v: 'prizes' }] });
  shelf({ face: '+z', edge: -26.8, a0: -97, a1: -73, district: 'old_market', tag: 'upper_lane_n',
    items: [M('sand'), M('sage'), { id: 'yatai' }] });
  shelf({ face: '+z', edge: -26.8, a0: -67, a1: -45, district: 'old_market', tag: 'upper_lane_n',
    items: [S('sweets'), M('cream')] });
  // South of Lower Lane (fronts look north onto it).
  shelf({ face: '-z', edge: 34.8, a0: -97, a1: -73, district: 'old_market', tag: 'lower_lane_s',
    items: [M('cream'), M('sage')] });
  shelf({ face: '-z', edge: 34.8, a0: -67, a1: -45, district: 'old_market', tag: 'lower_lane_s',
    items: [M('sand'), S('fish')] });

  // --------------------------------------------------- FISH HARBOUR (18) ---
  // Everything faces the water across the quay road.
  place('fishMarketHall', -40, -108.9, Math.PI, null, 'fish_harbor', 'fish_market');
  shelf({ face: '-z', edge: -116, a0: 14, a1: 54, district: 'fish_harbor', tag: 'warehouses',
    items: [{ id: 'warehouse' }, { id: 'warehouse' }] });
  shelf({ face: '-z', edge: -116, a0: -79, a1: -52, district: 'fish_harbor', tag: 'quay_machiya',
    items: [M('sage'), M('cream'), M('sand')] });
  // Dock sheds on the working apron, facing back at the quay road.
  shelf({ face: '+z', edge: -128.4, a0: -80, a1: -63, district: 'fish_harbor', tag: 'sheds',
    items: [{ id: 'dockShed' }, { id: 'dockShed' }] });
  shelf({ face: '+z', edge: -128.4, a0: -50, a1: -33, district: 'fish_harbor', tag: 'sheds',
    items: [{ id: 'dockShed' }, { id: 'dockShed' }] });
  shelf({ face: '+z', edge: -128.4, a0: -15, a1: -7, district: 'fish_harbor', tag: 'sheds',
    items: [{ id: 'dockShed' }] });
  shelf({ face: '+z', edge: -128.4, a0: 7, a1: 15, district: 'fish_harbor', tag: 'sheds',
    items: [{ id: 'dockShed' }] });
  shelf({ face: '+z', edge: -128.4, a0: 26, a1: 43, district: 'fish_harbor', tag: 'sheds',
    items: [{ id: 'dockShed' }, { id: 'dockShed' }] });
  // Suppliers: Mikan's catch (kerbside) and the auction floor (on the apron).
  place('marketStall', -16, -114.5, Math.PI, 'fish', 'fish_harbor', 'mikan_catch');
  place('marketStall', 18, -131.5, Math.PI / 2, 'fish', 'fish_harbor', 'harbor_auction');
  place('marketStall', -26, -114.5, Math.PI, 'veg', 'fish_harbor', 'quayside');
  place('marketStall', 8, -114.5, Math.PI, 'fish', 'fish_harbor', 'quayside');

  // ------------------------------------------------------- DOWNTOWN (20) ---
  place('trainStation', 64, -13.6, 0, null, 'downtown', 'station');
  place('konbini', 60, 10, Math.PI, null, 'downtown', 'konbini');
  // Tower Row — offices down both sides. The canal blocks the east side
  // north of z = 44, so that run stops short and a konbini caps it.
  shelf({ face: '+x', edge: 86.4, a0: 8, a1: 74, district: 'downtown', tag: 'tower_row_w',
    items: [{ id: 'officeBlock', v: 'mid' }, { id: 'officeBlock', v: 'tall' },
      { id: 'officeBlock', v: 'low' }, { id: 'officeBlock', v: 'warm' },
      { id: 'officeBlock', v: 'mid' }], gap: 2.2 });
  shelf({ face: '+x', edge: 86.4, a0: -26, a1: -14, district: 'downtown', tag: 'tower_row_w',
    items: [{ id: 'officeBlock', v: 'low' }], gap: 2.2 });
  shelf({ face: '-x', edge: 97.6, a0: 7, a1: 34, district: 'downtown', tag: 'tower_row_e',
    items: [{ id: 'officeBlock', v: 'tall' }, { id: 'officeBlock', v: 'mid' }], gap: 2.2 });
  shelf({ face: '-x', edge: 97.6, a0: 34, a1: 44, district: 'downtown', tag: 'tower_row_e',
    items: [{ id: 'konbini' }] });
  shelf({ face: '-x', edge: 101.6, a0: -26, a1: -8, district: 'downtown', tag: 'east_service',
    items: [{ id: 'warehouse' }] });
  // Canal-side office, east bank.
  shelf({ face: '-x', edge: 114, a0: 42, a1: 58, district: 'downtown', tag: 'canal_east',
    items: [{ id: 'officeBlock', v: 'warm' }] });
  // Market Road frontage, east end.
  shelf({ face: '-z', edge: 7.2, a0: 107, a1: 132, district: 'downtown', tag: 'market_road_s',
    items: [{ id: 'apartment', v: 'four' }, { id: 'konbini' }] });
  shelf({ face: '+z', edge: -7.2, a0: 116, a1: 132, district: 'downtown', tag: 'market_road_n',
    items: [{ id: 'apartment', v: 'three' }] });
  shelf({ face: '-z', edge: 7.2, a0: 44, a1: 56, district: 'downtown', tag: 'market_road_s',
    items: [{ id: 'izakaya' }] });
  shelf({ face: '+z', edge: -7.2, a0: 44, a1: 56, district: 'downtown', tag: 'market_road_n',
    items: [{ id: 'izakaya' }] });
  shelf({ face: '+z', edge: -7.2, a0: 78, a1: 88, district: 'downtown', tag: 'market_road_n',
    items: [{ id: 'konbini' }] });

  // ---------------------------------------------------- RESIDENTIAL (24) ---
  const H = (v) => ({ id: 'house', v });
  shelf({ face: '+z', edge: 98.2, a0: -52, a1: -18, district: 'residential', tag: 'home_lane_n',
    items: [{ id: 'teaHouse' }, H('blue'), H('sage')], gap: 1.4 });
  shelf({ face: '+z', edge: 98.2, a0: 10, a1: 44, district: 'residential', tag: 'home_lane_n',
    items: [{ id: 'konbini' }, H('cream'), H('blue')], gap: 1.4 });
  shelf({ face: '-z', edge: 110.2, a0: -52, a1: -30, district: 'residential', tag: 'home_lane_s',
    items: [H('sage'), H('pink')], gap: 1.4 });
  shelf({ face: '-z', edge: 110.2, a0: -24, a1: -7, district: 'residential', tag: 'home_lane_s',
    items: [H('cream')], gap: 1.4 });
  shelf({ face: '-z', edge: 110.2, a0: 7, a1: 24, district: 'residential', tag: 'home_lane_s',
    items: [H('blue')], gap: 1.4 });
  shelf({ face: '-z', edge: 110.2, a0: 30, a1: 52, district: 'residential', tag: 'home_lane_s',
    items: [H('sage'), H('cream')], gap: 1.4 });
  // Garden Lane, both sides (the lane runs east–west at z = 84).
  shelf({ face: '+z', edge: 80.4, a0: -50, a1: -28, district: 'residential', tag: 'garden_lane_n',
    items: [H('blue'), H('pink')], gap: 1.4 });
  shelf({ face: '+z', edge: 80.4, a0: 14, a1: 36, district: 'residential', tag: 'garden_lane_n',
    items: [H('cream'), H('sage')], gap: 1.4 });
  shelf({ face: '+z', edge: 80.4, a0: 40, a1: 62, district: 'residential', tag: 'garden_lane_n',
    items: [H('pink'), H('blue')], gap: 1.4 });
  // Machiya infill fronting Harbour Avenue.
  shelf({ face: '-x', edge: 6.6, a0: 122, a1: 140, district: 'residential', tag: 'harbor_ave_e',
    items: [M('sand'), M('sage')], gap: 1.2 });
  shelf({ face: '+x', edge: -6.6, a0: 122, a1: 140, district: 'residential', tag: 'harbor_ave_w',
    items: [M('cream'), M('sand')], gap: 1.2 });
  // Apartments at the east end of Home Lane.
  place('apartment', 60, 93.5, 0, 'three', 'residential', 'apartments');
  place('apartment', 60, 114.5, Math.PI, 'two', 'residential', 'apartments');

  // ---------------------------------------------------- NEON STREET (16) ---
  shelf({ face: '+x', edge: 89, a0: -122, a1: -66, district: 'neon_street', tag: 'neon_w',
    items: [{ id: 'izakaya' }, { id: 'yatai' }, { id: 'izakaya' },
      { id: 'festivalStall', v: 'goldfish' }, { id: 'izakaya' }, { id: 'yatai' }], gap: 1.2 });
  shelf({ face: '-x', edge: 101, a0: -104, a1: -66, district: 'neon_street', tag: 'neon_e',
    items: [M('sand'), { id: 'izakaya' }, { id: 'festivalStall', v: 'prizes' }, { id: 'yatai' }], gap: 1.2 });
  shelf({ face: '-x', edge: 101, a0: -140, a1: -122, district: 'neon_street', tag: 'neon_e',
    items: [{ id: 'izakaya' }, { id: 'konbini' }], gap: 1.2 });
  // The festival square west of the lane, and the exotics stall.
  place('festivalStall', 112, -96.5, Math.PI, 'prizes', 'neon_street', 'neon_exotics');
  place('yatai', 74, -126, 0, null, 'neon_street', 'festival_square');
  place('yatai', 74, -142, Math.PI, null, 'neon_street', 'festival_square');
  place('izakaya', 62, -134, Math.PI / 2, null, 'neon_street', 'festival_square');

  // ------------------------------------------------- validate placements ---
  const shopRect = { x0: HOME.shop.x - 9, x1: HOME.shop.x + 9, z0: HOME.shop.z - 7, z1: HOME.shop.z + 7 };
  const kept = [];
  const keptRects = [];
  for (const p of placements) {
    const f = footOf(p.id, p.yaw);
    const r = { x0: p.x - f.w / 2, x1: p.x + f.w / 2, z0: p.z - f.d / 2, z1: p.z + f.d / 2 };
    let why = null;
    for (let i = 0; i < keptRects.length; i++) {
      if (overlaps(r, keptRects[i])) { why = `overlaps ${kept[i].id}@${kept[i].x.toFixed(0)},${kept[i].z.toFixed(0)}`; break; }
    }
    if (!why) for (const rd of ROAD_RECTS) if (overlaps(r, rd)) { why = `on road ${rd.id}`; break; }
    if (!why) for (const ln of LANE_RECTS) if (overlaps(r, ln)) { why = `on lane ${ln.id}`; break; }
    if (!why && overlaps(r, shopRect)) why = 'inside the shop plaza';
    if (!why) for (const w of WATER) if (overlaps(r, { x0: w.x0, x1: w.x1, z0: w.z0, z1: w.z1 })) { why = `in water (${w.id})`; break; }
    if (why) { rejects.push({ id: p.id, x: p.x, z: p.z, district: p.district, tag: p.tag, why }); continue; }
    kept.push(p); keptRects.push(r);
  }
  if (rejects.length) {
    for (const r of rejects) {
      console.warn(`[world] rejected ${r.id} at ${r.x.toFixed(1)},${r.z.toFixed(1)} (${r.district}/${r.tag || '-'}) — ${r.why}`);
    }
  }

  const onBuilding = (x, z, pad = 0) => keptRects.some((r) => inRect(x, z, {
    x0: r.x0 - pad, x1: r.x1 + pad, z0: r.z0 - pad, z1: r.z1 + pad,
  }));

  const buildingsGroup = new THREE.Group();
  buildingsGroup.name = 'buildings';
  group.add(buildingsGroup);
  const stuccoTex = trackTex(makeStuccoTexture());
  const built = buildBuildingInstances(null, kept, {
    gradientMap, group: buildingsGroup, colliders, glowMats, neonMats, stuccoTex,
  });

  // =========================================================================
  // 5. PROPS — seeded scatter along hand-authored bands + hero placements.
  // =========================================================================

  /** @type {Array<{id:string,x:number,z:number,yaw:number,y?:number,scale?:number}>} */
  const props = [];
  const propCounts = new Map();
  function prop(id, x, z, yaw = 0, extra) {
    const p = { id, x, z, yaw };
    if (extra) Object.assign(p, extra);
    props.push(p);
    const n = propCounts.get(id) || 0;
    propCounts.set(id, n + 1);
    return { id, i: n, x, z, yaw };
  }

  const roadById = (id) => ROADS.find((r) => r.id === id) || LANES.find((r) => r.id === id) || null;

  /**
   * Drop a prop repeatedly along a road, on both kerbs, honouring district
   * filters and never landing on another road.
   */
  function scatterAlong(roadId, propId, opts = {}) {
    const r = roadById(roadId);
    if (!r) { console.warn(`[world] scatterAlong: unknown road ${roadId}`); return 0; }
    const {
      spacing = 20, offset = 1.8, jitter = 0.7, districts = null,
      sides = [-1, 1], yawOffset = 0, phase = 0.5, y = 0, scale = null, limit = Infinity,
    } = opts;
    const alongX = r.w >= r.d;
    const len = alongX ? r.w : r.d;
    const half = (alongX ? r.d : r.w) / 2;
    const a0 = (alongX ? r.x : r.z) - len / 2;
    const n = Math.max(1, Math.floor(len / spacing));
    let made = 0;
    for (const side of sides) {
      for (let i = 0; i < n && made < limit; i++) {
        const t = a0 + (len / n) * (i + phase);
        const cross = (alongX ? r.z : r.x) + side * (half + offset);
        let x = alongX ? t : cross;
        let z = alongX ? cross : t;
        x += (rng() - 0.5) * jitter * 2;
        z += (rng() - 0.5) * jitter * 2;
        if (Math.abs(x) > WORLD.bounds - 4 || Math.abs(z) > WORLD.bounds - 4) continue;
        if (districts) {
          const d = districtAt(x, z);
          if (!d || !districts.includes(d.id)) continue;
        }
        if (onPaving(x, z, 0.2)) continue;
        if (inWater(x, z, 1.5)) continue;
        if (onBuilding(x, z, 0)) continue;
        if (inRect(x, z, PLAZA_KEEP)) continue;
        // Face the road.
        const dx = alongX ? 0 : -side, dz = alongX ? -side : 0;
        const p = { id: propId, x, z, yaw: yawFace(dx, dz) + yawOffset };
        if (y) p.y = y;
        if (scale) p.scale = scale;
        props.push(p);
        propCounts.set(propId, (propCounts.get(propId) || 0) + 1);
        made++;
      }
    }
    return made;
  }

  // ---- street dressing along every road -----------------------------------
  const LAMP = -Math.PI / 2;   // the lamp's arm points along its local +X
  scatterAlong('market_road', 'streetLamp', { spacing: 46, offset: 1.6, yawOffset: LAMP });
  scatterAlong('harbor_ave', 'streetLamp', { spacing: 46, offset: 1.6, yawOffset: LAMP });
  scatterAlong('quay', 'streetLamp', { spacing: 40, offset: 1.6, yawOffset: LAMP });
  scatterAlong('neon_lane', 'streetLamp', { spacing: 26, offset: 1.5, yawOffset: LAMP });
  scatterAlong('neon_cross', 'streetLamp', { spacing: 40, offset: 1.5, yawOffset: LAMP });
  scatterAlong('home_lane', 'streetLamp', { spacing: 42, offset: 1.6, yawOffset: LAMP });
  scatterAlong('tower_row', 'streetLamp', { spacing: 34, offset: 1.6, yawOffset: LAMP });
  scatterAlong('lane_west', 'streetLamp', { spacing: 54, offset: 1.2, yawOffset: LAMP, scale: 0.85 });
  scatterAlong('lane_mid', 'streetLamp', { spacing: 54, offset: 1.2, yawOffset: LAMP, scale: 0.85 });

  scatterAlong('market_road', 'utilityPole', { spacing: 58, offset: 2.6, phase: 0.2 });
  scatterAlong('harbor_ave', 'utilityPole', { spacing: 58, offset: 2.6, phase: 0.35 });
  scatterAlong('home_lane', 'utilityPole', { spacing: 48, offset: 2.6, phase: 0.15, sides: [1] });
  scatterAlong('neon_lane', 'utilityPole', { spacing: 40, offset: 2.4, phase: 0.7, sides: [1] });
  scatterAlong('quay', 'utilityPole', { spacing: 50, offset: 2.4, phase: 0.6, sides: [1] });

  scatterAlong('market_road', 'planterBox', { spacing: 44, offset: 1.4, phase: 0.75 });
  scatterAlong('tower_row', 'planterBox', { spacing: 26, offset: 1.4, phase: 0.3 });
  scatterAlong('home_lane', 'hedge', { spacing: 32, offset: 2.2, phase: 0.6, districts: ['residential'] });
  scatterAlong('garden_lane', 'hedge', { spacing: 30, offset: 1.6, phase: 0.4, districts: ['residential'] });
  scatterAlong('home_lane', 'bicycle', { spacing: 34, offset: 2.4, phase: 0.25, districts: ['residential'] });
  scatterAlong('garden_lane', 'bicycle', { spacing: 32, offset: 1.5, phase: 0.8, districts: ['residential'] });
  scatterAlong('home_lane', 'mailbox', { spacing: 44, offset: 1.5, phase: 0.9, districts: ['residential'] });
  scatterAlong('home_lane', 'cherryTree', { spacing: 44, offset: 3.4, phase: 0.45, districts: ['residential'] });
  scatterAlong('garden_lane', 'cherryTree', { spacing: 50, offset: 3.0, phase: 0.2, districts: ['residential'] });
  scatterAlong('market_road', 'cherryTree', { spacing: 58, offset: 3.4, phase: 0.35, districts: ['old_market'] });
  scatterAlong('tower_row', 'cherryTree', { spacing: 44, offset: 3.2, phase: 0.65, districts: ['downtown'] });
  scatterAlong('canal_walk', 'cherryTree', { spacing: 22, offset: 1.4, phase: 0.5, jitter: 0.3 });
  scatterAlong('lane_west', 'pottedPlant', { spacing: 20, offset: 0.9, jitter: 0.35 });
  scatterAlong('lane_mid', 'pottedPlant', { spacing: 20, offset: 0.9, jitter: 0.35 });
  scatterAlong('lane_east', 'pottedPlant', { spacing: 18, offset: 0.9, jitter: 0.35 });
  scatterAlong('lane_upper', 'bonsai', { spacing: 26, offset: 0.9, jitter: 0.3 });
  scatterAlong('lane_lower', 'bonsai', { spacing: 26, offset: 0.9, jitter: 0.3 });
  scatterAlong('market_road', 'benchWood', { spacing: 80, offset: 1.6, phase: 0.5 });
  scatterAlong('tower_row', 'benchWood', { spacing: 46, offset: 1.6, phase: 0.85 });
  scatterAlong('quay', 'benchWood', { spacing: 54, offset: 1.6, phase: 0.4 });
  scatterAlong('market_road', 'trashBins', { spacing: 74, offset: 1.5, phase: 0.15 });
  scatterAlong('neon_lane', 'trashBins', { spacing: 46, offset: 1.4, phase: 0.55 });
  scatterAlong('tower_row', 'vendingMachine', { spacing: 40, offset: 1.5, phase: 0.6 });
  scatterAlong('neon_lane', 'vendingMachine', { spacing: 34, offset: 1.4, phase: 0.3 });
  scatterAlong('home_lane', 'vendingMachine', { spacing: 60, offset: 1.5, phase: 0.7, sides: [-1] });
  scatterAlong('tower_row', 'bicycleRack', { spacing: 44, offset: 1.8, phase: 0.4 });
  scatterAlong('quay', 'trafficCone', { spacing: 36, offset: 1.3, phase: 0.2, jitter: 1.2 });

  // Ground decals — lifted above the road surface so they read.
  scatterAlong('market_road', 'manholeCover', { spacing: 52, offset: -2.6, phase: 0.3, y: 0.1, jitter: 0.4 });
  scatterAlong('harbor_ave', 'manholeCover', { spacing: 58, offset: -2.6, phase: 0.6, y: 0.1, jitter: 0.4, sides: [1] });
  scatterAlong('market_road', 'gutterGrate', { spacing: 40, offset: 0.2, phase: 0.8, y: 0.1, jitter: 0.2 });
  scatterAlong('home_lane', 'gutterGrate', { spacing: 36, offset: 0.2, phase: 0.4, y: 0.1, jitter: 0.2 });

  // Zebra crossings on every approach to every road intersection.
  for (const it of intersections) {
    for (const r of [it.a, it.b]) {
      const alongX = r.w >= r.d;
      const halfLong = (alongX ? r.w : r.d) / 2;
      const other = r === it.a ? it.b : it.a;
      const halfOther = (alongX ? other.d : other.w) / 2;
      const back = halfOther + 3.2;
      for (const s of [-1, 1]) {
        const cx = alongX ? it.x + s * back : it.x;
        const cz = alongX ? it.z : it.z + s * back;
        if (Math.abs(alongX ? cx - r.x : cz - r.z) > halfLong) continue;
        // Bars must run across the carriageway: spread along the road's short axis.
        prop('roadCrossing', cx, cz, alongX ? Math.PI / 2 : 0, { y: 0.11, scale: (alongX ? r.d : r.w) / 9 });
      }
    }
  }

  // ---- hero props ---------------------------------------------------------
  const sway = [];
  const gulls = [];

  // Old Market: the shrine precinct at the head of Shrine Walk (z 32 → 56).
  prop('torii', -110, 36, 0, { scale: 1.6 });
  prop('torii', -110, 43, 0, { scale: 1.25 });
  prop('shrineOffering', -110, 54, Math.PI);
  prop('komaInu', -113.4, 51, Math.PI, { scale: 1.3 });
  prop('komaInu', -106.6, 51, Math.PI, { scale: 1.3 });
  for (let i = 0; i < 4; i++) {
    prop('stoneLantern', -113.4, 39 + i * 4.2, 0);
    prop('stoneLantern', -106.6, 39 + i * 4.2, 0);
  }
  prop('pineTree', -118, 52, 0, { scale: 1.3 });
  prop('pineTree', -102, 53, 0, { scale: 1.15 });
  prop('pineTree', -117, 40, 0);
  prop('cherryTree', -102, 40, 0, { scale: 1.2 });

  // Market banners down the alley edges + lantern strings strung across them.
  for (let i = 0; i < 6; i++) {
    sway.push(prop('nobori', -96.8, -12 + i * 9, Math.PI / 2));
    sway.push(prop('nobori', -73.2, -12 + i * 9, -Math.PI / 2));
  }
  for (let i = 0; i < 4; i++) {
    prop('lanternString', -100, -8 + i * 14, 0, { scale: 0.85 });
    prop('lanternString', -70, -8 + i * 14, 0, { scale: 0.85 });
  }
  // Noren hung on the actual shopfronts (0.15 proud of each facade).
  for (const nx of [-116.55, -107.45, -92.15, -83.85, -61.55]) {
    sway.push(prop('noren', nx, -7.35, 0));
  }
  for (const nx of [-107.85, -78.65]) sway.push(prop('noren', nx, 7.35, Math.PI));
  for (const nx of [-116.55, -92.15, -61.55]) sway.push(prop('noren', nx, -26.95, 0));
  // Stall square dressing.
  for (const [sx, sz] of [[-66.5, 15], [-55, 16.4], [-47, 15.2], [-62, 6.6]]) {
    prop('fruitCrate', sx, sz, rng() * Math.PI * 2);
  }
  prop('sakeBarrelStack', -56, 7, Math.PI);
  prop('sakeBarrelStack', -90, 19.6, 0);
  prop('woodenStall', -47.5, -14, Math.PI / 2);
  prop('woodenStall', -47.5, -20, Math.PI / 2);
  prop('ramenBowlSign', -83.85, -7.4, 0);
  prop('signPost', -30.5, 6.4, 0);
  prop('signPost', -7.8, 7.2, 0);

  // ---- THE HOME PLAZA -----------------------------------------------------
  // The first thing every player sees. Two corridors are kept deliberately
  // empty and everything below is placed around them:
  //   · the walking line from HOME.spawn (-28, 28) to the shop door (-28, 22.5)
  //     — nothing within 1.6 units of x = -28 between z = 21 and z = 31;
  //   · the delivery board at (-20, 24), which needs its 2.6-unit reach clear.
  // Blossom at the corners of the square.
  prop('cherryTree', -37.6, 25.5, 0.4, { scale: 1.25 });
  prop('cherryTree', -16.6, 25.5, -0.5, { scale: 1.1 });
  prop('cherryTree', -37.6, 41.0, 1.1, { scale: 1.15 });
  // A clipped hedge line frames the south side, split on the shop's axis so
  // the player can always walk straight out of the square.
  for (const hx of [-36.6, -33.4, -30.2, -23.8, -20.6, -17.4]) prop('hedge', hx, 43.4, 0);
  // A shorter run frames the east flank beside the shop.
  prop('hedge', -15.6, 13.5, Math.PI / 2);
  prop('hedge', -15.6, 16.7, Math.PI / 2);
  // Planters either side of the approach to the door, and one at the west gate.
  prop('planterBox', -32.6, 24.4, 0);
  prop('planterBox', -23.4, 24.4, 0);
  prop('planterBox', -38.6, 24.5, Math.PI / 2);
  // Pots against the shopfront and along the stall row.
  prop('pottedPlant', -30.4, 23.3, 0);
  prop('pottedPlant', -25.6, 23.3, 0);
  prop('pottedPlant', -17.6, 9.6, 0);
  prop('pottedPlant', -19.2, 11.5, 0);
  prop('pottedPlant', -34.6, 37.0, 0);
  // A noren-hung side stall on the west edge, with its crates.
  prop('woodenStall', -36.8, 33.5, Math.PI / 2);
  sway.push(prop('noren', -35.5, 33.5, Math.PI / 2));
  prop('fruitCrate', -36.8, 30.6, 0.4);
  prop('fruitCrate', -36.2, 36.4, -0.3);
  // Benches looking back at the shop.
  prop('benchWood', -33.0, 41.0, Math.PI);
  prop('benchWood', -21.0, 41.0, Math.PI);
  prop('benchWood', -36.2, 28.5, Math.PI / 2);
  prop('benchWood', -18.2, 30.5, -Math.PI / 2);
  // Paper lanterns on posts at the four corners of the open square.
  prop('lanternPost', -35.5, 29.5, Math.PI / 2);
  prop('lanternPost', -19.5, 29.5, -Math.PI / 2);
  prop('lanternPost', -35.5, 38.5, Math.PI / 2);
  prop('lanternPost', -19.5, 38.5, -Math.PI / 2);
  // Lantern strings overhead, in two runs across the square. The runs are set
  // out so no post lands in the spawn → door corridor and no two posts end up
  // close enough to read as one fat pole.
  for (const lx of [-35.5, -20.0]) prop('lanternString', lx, 32.0, 0, { scale: 1.05 });
  for (const lx of [-35.5, -27.75, -20.0]) prop('lanternString', lx, 39.8, 0, { scale: 1.05 });
  // A signpost at the Lantern Alley gate, bins and bikes on the east side.
  prop('signPost', -38.4, 27.5, 0.3);
  prop('trashBins', -16.8, 35.5, -Math.PI / 2);
  prop('bicycleRack', -17.0, 20.0, -Math.PI / 2);
  prop('bicycle', -17.6, 19.4, -Math.PI / 2 + 0.15);
  prop('bicycle', -17.6, 20.8, -Math.PI / 2 - 0.12);

  // Harbour: crates, pilings, ropes, boats, gulls.
  for (let i = 0; i < 9; i++) {
    const x = -76 + i * 12 + (rng() - 0.5) * 2;
    prop('fishCrate', x, -130.5 + (rng() - 0.5) * 1.4, rng() * 0.5 - 0.25);
    if (i % 2 === 0) prop('fishCrate', x + 1.1, -129.4, rng() * 0.5);
  }
  // Barrels tucked into the gaps between the dock sheds.
  for (const bx of [-58, -24, 20, 48]) {
    prop('barrel', bx, -132, 0);
    prop('barrel', bx + 0.9, -133.1, 0);
  }
  for (const p of PIERS) {
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        prop('dockPiling', p.x + sx * (p.w / 2 + 0.9), p.z0 + 2.5 + i * (p.z1 - p.z0 - 5), 0, { y: -0.3 });
      }
    }
    prop('mooringRope', p.x + p.w / 2 - 0.4, p.z0 + 4.5, Math.PI / 2, { y: DECK_Y });
    prop('mooringRope', p.x - p.w / 2 + 0.4, p.z1 - 3.5, -Math.PI / 2, { y: DECK_Y });
    prop('fishCrate', p.x, p.z1 - 2.2, 0.3, { y: DECK_Y });
    prop('fishCrate', p.x - 0.9, p.z1 - 3.4, -0.2, { y: DECK_Y });
  }
  const boats = [
    [-66, -144, 0.12], [-54, -146, -0.08], [-27, -145, 0.05],
    [-13, -147, -0.14], [26, -144, 0.1], [33, -148, -0.06],
  ];
  for (const [bx, bz, byaw] of boats) prop('fishingBoat', bx, bz, byaw, { y: -0.34 });
  for (let i = 0; i < 6; i++) {
    gulls.push(prop('seagull', -60 + i * 22, -142 - rng() * 8, rng() * Math.PI * 2, { y: 3.2 + rng() * 3 }));
  }
  prop('seagull', -40, -128.5, 1.2, { y: 0 });
  prop('seagull', 14, -130.2, -0.7, { y: 0 });
  for (const nx of [-68, -50, -30, -12, 12, 30]) sway.push(prop('nobori', nx, -116.4, Math.PI));
  prop('pineTree', -80, -100, 0, { scale: 1.2 });
  prop('pineTree', -74, -92, 0);
  prop('pineTree', 46, -96, 0, { scale: 1.15 });

  // Downtown: canal, station forecourt, office frontages.
  for (let i = 0; i < 4; i++) {
    prop('benchWood', 109.6, 48 + i * 6.5, -Math.PI / 2);
  }
  prop('signPost', 97.4, 8, 0);
  prop('signPost', 84.2, -6.6, 0);
  for (const [vx, vz] of [[57, -6.4], [70, -6.4], [97.3, 30], [114.6, 61]]) prop('vendingMachine', vx, vz, Math.PI);
  for (let i = 0; i < 3; i++) prop('acUnit', 86.5, -23 + i * 3.5, Math.PI / 2);
  prop('acUnit', 101.5, -20, -Math.PI / 2);
  prop('bicycleRack', 60, -6.5, Math.PI);
  for (let i = 0; i < 5; i++) prop('bicycle', 57.6 + i * 1.4, -6.6, Math.PI + (rng() - 0.5) * 0.2);
  prop('planterBox', 52, -6.5, Math.PI);
  prop('planterBox', 76, -6.5, Math.PI);

  // Residential: gardens, bikes, hedges, mailboxes, kids' clutter.
  for (let i = 0; i < 9; i++) {
    const x = -48 + i * 12;
    if (Math.abs(x) < 8) continue;
    prop('hedge', x, 87.8, 0, { scale: 1.1 });
    prop('mailbox', x + 4.4, 98.7, Math.PI);
  }
  for (const cx of [-44, -26, -17, 26, 35, 46]) prop('cherryTree', cx, 128, 0, { scale: 1.05 + rng() * 0.2 });
  for (let i = 0; i < 6; i++) prop('bicycle', -40 + i * 16, 109.4, Math.PI + (rng() - 0.5) * 0.4);
  prop('benchWood', -20, 76, Math.PI);
  prop('benchWood', -14, 76, Math.PI);
  prop('pottedPlant', -27.5, 79.6, 0);
  prop('pottedPlant', -20.5, 79.6, 0);
  prop('bonsai', 14, 90, 0);
  prop('kotatsu', -30, 68, 0);
  for (let i = 0; i < 4; i++) prop('pineTree', -44 + i * 26, 70, 0, { scale: 1.1 });
  for (let i = 0; i < 5; i++) prop('hedge', 66 + i * 6, 100, Math.PI / 2, { scale: 1.2 });

  // Neon Food Street: lantern strings the whole length, noren, barrels, signs.
  for (let i = 0; i < 10; i++) {
    prop('lanternString', 95, -136 + i * 7.6, 0, { scale: 1.25, y: 0 });
  }
  for (let i = 0; i < 6; i++) {
    sway.push(prop('noren', 89.3, -118 + i * 9, Math.PI / 2));
    sway.push(prop('noren', 100.7, -110 + i * 9, -Math.PI / 2));
  }
  for (let i = 0; i < 5; i++) sway.push(prop('nobori', 89.9, -122 + i * 11, Math.PI / 2));
  for (let i = 0; i < 4; i++) prop('ramenBowlSign', 100.6, -128 + i * 13, -Math.PI / 2);
  for (let i = 0; i < 4; i++) prop('sakeBarrelStack', 89.9, -132 + i * 12, Math.PI / 2);
  for (let i = 0; i < 6; i++) prop('paperLantern', 90.2 + (i % 2) * 9.6, -140 + i * 5, 0);
  // Festival square.
  for (let i = 0; i < 4; i++) prop('lanternString', 74, -140 + i * 5, Math.PI / 2, { scale: 1.1 });
  prop('woodenStall', 68, -130, Math.PI / 2);
  prop('woodenStall', 80, -130, -Math.PI / 2);
  for (let i = 0; i < 4; i++) prop('barrel', 70 + i * 3, -138, 0);
  prop('signPost', 101.6, -66.5, 0);
  prop('signPost', 85.6, -52.8, 0);

  // Gap-filler greenery so no zone butts onto bare ground.
  const GREEN_BANDS = [
    { x0: -30, x1: 14, z0: -70, z1: -50, n: 8, ids: ['pineTree', 'hedge', 'cherryTree'] },
    { x0: -118, x1: -78, z0: -72, z1: -50, n: 7, ids: ['pineTree', 'hedge'] },
    { x0: 12, x1: 44, z0: 22, z1: 60, n: 7, ids: ['cherryTree', 'hedge', 'benchWood'] },
    { x0: 12, x1: 50, z0: -46, z1: -18, n: 7, ids: ['pineTree', 'hedge'] },
    { x0: -64, x1: -28, z0: 60, z1: 86, n: 7, ids: ['cherryTree', 'pineTree', 'hedge'] },
    { x0: 72, x1: 112, z0: 80, z1: 104, n: 7, ids: ['cherryTree', 'hedge'] },
    { x0: 112, x1: 132, z0: -46, z1: -12, n: 4, ids: ['pineTree', 'hedge'] },
    { x0: -76, x1: -40, z0: -100, z1: -76, n: 6, ids: ['pineTree', 'hedge', 'benchWood'] },
    { x0: -38, x1: -8, z0: -100, z1: -78, n: 6, ids: ['pineTree', 'cherryTree', 'hedge'] },
    { x0: 8, x1: 44, z0: -100, z1: -78, n: 6, ids: ['pineTree', 'hedge', 'benchWood'] },
    { x0: 52, x1: 72, z0: -96, z1: -70, n: 4, ids: ['pineTree', 'hedge'] },
    { x0: -40, x1: -20, z0: -48, z1: -28, n: 3, ids: ['pineTree', 'hedge', 'benchWood'] },
    { x0: 30, x1: 62, z0: 46, z1: 76, n: 6, ids: ['cherryTree', 'hedge', 'benchWood'] },
    { x0: 116, x1: 134, z0: -140, z1: -72, n: 16, ids: ['pineTree', 'hedge', 'cherryTree'] },
    { x0: 114, x1: 132, z0: 20, z1: 70, n: 9, ids: ['cherryTree', 'hedge', 'benchWood'] },
    { x0: 50, x1: 64, z0: 122, z1: 140, n: 6, ids: ['cherryTree', 'hedge'] },
    { x0: -46, x1: -26, z0: -36, z1: -16, n: 5, ids: ['hedge', 'pineTree'] },
    { x0: 8, x1: 26, z0: -104, z1: -84, n: 5, ids: ['pineTree', 'hedge'] },
    { x0: 44, x1: 62, z0: 14, z1: 40, n: 5, ids: ['cherryTree', 'hedge'] },
  ];
  const placedGreen = [];
  for (const b of GREEN_BANDS) {
    for (let i = 0; i < b.n; i++) {
      const x = b.x0 + rng() * (b.x1 - b.x0);
      const z = b.z0 + rng() * (b.z1 - b.z0);
      if (onPaving(x, z, 1.6) || inWater(x, z, 2) || inRect(x, z, PLAZA_KEEP)) continue;
      if (onBuilding(x, z, 1.4)) continue;
      if (placedGreen.some((p) => Math.hypot(p.x - x, p.z - z) < 4.2)) continue;
      placedGreen.push({ x, z });
      prop(b.ids[Math.floor(rng() * b.ids.length)], x, z, rng() * Math.PI * 2);
    }
  }

  // =========================================================================
  // 5b. GAP FILL — no bare plain anywhere inside WORLD.bounds
  // =========================================================================
  // The hand-authored bands above dress the places I knew were thin. This pass
  // finds the ones I missed: it walks a grid over the whole playable square and
  // wherever a sample is further than `thresh` from the nearest building, prop
  // or road it drops a small cluster — a grove, a hedgerow, a run of low wall,
  // a planter group, or a pocket park (green ground decal + trees + a bench).
  //
  // Everything it places goes through the same paving / water / building /
  // keep-out tests as the scatterers, and every piece is fed straight back into
  // the search structure, so the pass stops the moment the ground is covered
  // and never stacks props on top of each other. The RNG is the same seeded
  // stream as the rest of the city, so the result is identical on every load.

  const fill = { clusters: 0, props: 0, byKind: {} };
  {
    const CELL = 24;                       // ≥ the largest threshold below
    const fhash = new Map();
    const fkey = (i, j) => `${i}|${j}`;
    const addFeature = (x, z) => {
      const k = fkey(Math.floor(x / CELL), Math.floor(z / CELL));
      let a = fhash.get(k);
      if (!a) fhash.set(k, (a = []));
      a.push(x, z);
    };
    /** Distance to the nearest known feature (Infinity if none within a cell). */
    const nearFeature = (x, z) => {
      const ci = Math.floor(x / CELL);
      const cj = Math.floor(z / CELL);
      let best = Infinity;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const a = fhash.get(fkey(ci + di, cj + dj));
          if (!a) continue;
          for (let n = 0; n < a.length; n += 2) {
            const d = Math.hypot(a[n] - x, a[n + 1] - z);
            if (d < best) best = d;
          }
        }
      }
      return best;
    };

    for (const p of props) addFeature(p.x, p.z);
    for (const r of keptRects) {
      for (let i = 0; i <= 2; i++) {
        for (let j = 0; j <= 2; j++) {
          addFeature(r.x0 + ((r.x1 - r.x0) * i) / 2, r.z0 + ((r.z1 - r.z0) * j) / 2);
        }
      }
    }
    for (const r of PAVED) {
      const alongX = r.x1 - r.x0 >= r.z1 - r.z0;
      const len = alongX ? r.x1 - r.x0 : r.z1 - r.z0;
      const n = Math.max(1, Math.round(len / 6));
      for (let i = 0; i <= n; i++) {
        const t = (alongX ? r.x0 : r.z0) + (len / n) * i;
        addFeature(alongX ? t : r.x0, alongX ? r.z0 : t);
        addFeature(alongX ? t : r.x1, alongX ? r.z1 : t);
      }
    }

    // Anything the game needs to be able to stand on, reach or path to.
    const KEEP_OUT = [
      { x: HOME.spawn.x, z: HOME.spawn.z, r: 7 },
      { x: HOME.bed.x, z: HOME.bed.z, r: 5 },
      { x: HOME.plaza.x + 6, z: HOME.plaza.z - 2, r: 5 },   // the delivery board
    ];
    for (const s of SUPPLIERS) KEEP_OUT.push({ x: s.x, z: s.z, r: 5 });
    for (const s of DEFAULT_SPOTS || []) KEEP_OUT.push({ x: s.x, z: s.z, r: (s.r || 3) + 4 });
    for (const d of DISTRICTS) if (d.gate) KEEP_OUT.push({ x: d.gate.x, z: d.gate.z, r: 6 });
    for (const n of NPCS) {
      if (n.home) KEEP_OUT.push({ x: n.home.x, z: n.home.z, r: 4 });
      for (const s of n.schedule || []) if (s.at) KEEP_OUT.push({ x: s.at.x, z: s.at.z, r: 4 });
    }

    const LIMIT = WORLD.bounds - 6;
    const blockedAt = (x, z) =>
      onPaving(x, z, 2) || inWater(x, z, 3.5) || onBuilding(x, z, 2.5)
      || inRect(x, z, PLAZA_KEEP)
      || KEEP_OUT.some((k) => Math.hypot(k.x - x, k.z - z) < k.r);

    /** Place one piece of filler, or refuse. Returns 1/0 so callers can count. */
    const put = (id, x, z, yaw = 0, extra) => {
      if (Math.abs(x) > LIMIT || Math.abs(z) > LIMIT) return 0;
      if (z < WORLD.waterZ + 5) return 0;
      if (blockedAt(x, z)) return 0;
      if (nearFeature(x, z) < 2.7) return 0;
      prop(id, x, z, yaw, extra);
      addFeature(x, z);
      fill.props++;
      return 1;
    };
    const anyTree = () => (rng() < 0.45 ? 'cherryTree' : 'pineTree');

    // Clusters are deliberately small — two or three pieces. A cluster's job is
    // to give the eye something at a readable distance, and a lone tree in a
    // field looks like an accident where a pair reads as planting.
    const CLUSTERS = {
      grove(x, z) {
        let n = 0;
        for (let i = 0; i < 2; i++) {
          const a = rng() * Math.PI * 2;
          const rr = 3.2 + rng() * 3.4;
          n += put(anyTree(), x + Math.cos(a) * rr, z + Math.sin(a) * rr,
            rng() * Math.PI * 2, { scale: 0.95 + rng() * 0.35 });
        }
        if (rng() < 0.35) n += put('hedge', x + 3.2, z - 3.0, rng() < 0.5 ? 0 : Math.PI / 2);
        return n;
      },
      hedgerow(x, z) {
        const along = rng() < 0.5;
        const yaw = along ? 0 : Math.PI / 2;
        let n = 0;
        for (let i = 0; i < 2; i++) {
          const t = (i - 0.5) * 3.3;
          n += put('hedge', x + (along ? t : 0), z + (along ? 0 : t), yaw);
        }
        n += put(anyTree(), x + (along ? 2.2 : 3.6), z + (along ? 3.6 : 2.2), rng() * Math.PI * 2);
        return n;
      },
      wall(x, z) {
        const along = rng() < 0.5;
        const yaw = along ? 0 : Math.PI / 2;
        let n = 0;
        for (let i = 0; i < 2; i++) {
          const t = (i - 0.5) * 3.6;
          n += put('stoneWall', x + (along ? t : 0), z + (along ? 0 : t), yaw);
        }
        n += put(anyTree(), x + (along ? -3.0 : 3.8), z + (along ? 3.8 : -3.0), rng() * Math.PI * 2);
        return n;
      },
      planters(x, z) {
        let n = 0;
        n += put('planterBox', x, z, rng() < 0.5 ? 0 : Math.PI / 2);
        n += put('planterBox', x + 3.0, z + 1.4, rng() < 0.5 ? 0 : Math.PI / 2);
        n += put('pottedPlant', x - 1.4, z + 3.0, 0);
        return n;
      },
      park(x, z) {
        // A pocket park: a soft green decal with trees around it and a bench
        // to sit on. The decal is only laid if the planting actually landed.
        const w = 15 + rng() * 6;
        const d = 13 + rng() * 5;
        let n = 0;
        n += put('benchWood', x, z + d * 0.2, rng() < 0.5 ? 0 : Math.PI);
        for (const [ox, oz] of [[-w * 0.3, -d * 0.24], [w * 0.3, -d * 0.22]]) {
          n += put(anyTree(), x + ox, z + oz, rng() * Math.PI * 2, { scale: 1 + rng() * 0.3 });
        }
        if (rng() < 0.35) n += put('stoneLantern', x - w * 0.26, z + d * 0.26, rng() * Math.PI * 2);
        if (n >= 2) patchParts.push(roundedRect(x, z, w, d, 4.5, PAL.parkSoft, 0.018));
        return n;
      },
      // The outskirts: a pair of trees set wide apart, sometimes with a field
      // wall between them. Spread out on purpose — out here each piece has to
      // hold a lot of ground on its own.
      treeline(x, z) {
        const a = rng() * Math.PI * 2;
        const rr = 4.5 + rng() * 5.0;
        const dx = Math.cos(a) * rr;
        const dz = Math.sin(a) * rr;
        let n = put(anyTree(), x + dx, z + dz, rng() * Math.PI * 2, { scale: 1.0 + rng() * 0.35 });
        n += put(anyTree(), x - dx, z - dz, rng() * Math.PI * 2, { scale: 1.0 + rng() * 0.35 });
        if (rng() < 0.4) n += put('stoneWall', x, z, rng() < 0.5 ? 0 : Math.PI / 2);
        // A meadow under the planting. Out here the decal does most of the
        // work: it costs nothing (it merges into the one patch mesh) and it is
        // what stops the outskirts reading as a bare tan plain.
        if (n >= 1) {
          patchParts.push(roundedRect(x, z, Math.abs(dx) * 2 + 22, Math.abs(dz) * 2 + 20, 8, PAL.parkSoft, 0.016));
        }
        return n;
      },
    };

    // Inside the built-up box the bar is high (nothing further than ~17 units
    // from something); the outskirts are deliberately looser so they read as
    // countryside rather than a second city.
    const CORE_BOX = { x0: -138, x1: 148, z0: WORLD.waterZ, z1: 152 };
    const barFor = (x, z) => (inRect(x, z, CORE_BOX) ? 13.5 : 16.5);
    const STEP = 6;
    // Two budgets, because the two jobs are different sizes: the city core is
    // dressed properly, and whatever is left over is spent breaking up the
    // outskirts. Together they stay well inside the prop budget.
    const CORE_BUDGET = 166;
    const BUDGET = 186;

    // Pass 1: survey. Every grid sample that is too far from anything, with how
    // bare it is. Pass 2: fill the *worst* first (city before outskirts) so a
    // tight prop budget is always spent on the emptiest ground.
    const candidates = [];
    for (let x = -LIMIT; x <= LIMIT; x += STEP) {
      for (let z = -LIMIT; z <= LIMIT; z += STEP) {
        if (z < WORLD.waterZ + 5) continue;
        if (blockedAt(x, z)) continue;
        const d = nearFeature(x, z);
        if (d <= barFor(x, z)) continue;
        candidates.push({ x, z, d, core: inRect(x, z, CORE_BOX) ? 0 : 1 });
      }
    }
    candidates.sort((a, b) => a.core - b.core || b.d - a.d || a.x - b.x || a.z - b.z);

    for (const c of candidates) {
      if (fill.props >= (c.core === 0 ? CORE_BUDGET : BUDGET)) {
        if (c.core === 1) break;
        continue;
      }
      if (nearFeature(c.x, c.z) <= barFor(c.x, c.z)) continue;   // a neighbour already covered it
      const cx = c.x + (rng() - 0.5) * 3;
      const cz = c.z + (rng() - 0.5) * 3;
      const roll = rng();
      const kind = c.core === 0
        ? (roll < 0.3 ? 'park' : roll < 0.55 ? 'grove' : roll < 0.76 ? 'hedgerow' : roll < 0.92 ? 'wall' : 'planters')
        : (roll < 0.75 ? 'treeline' : roll < 0.9 ? 'wall' : 'grove');
      if (CLUSTERS[kind](cx, cz) > 0) {
        fill.clusters++;
        fill.byKind[kind] = (fill.byKind[kind] || 0) + 1;
      }
    }
  }

  // Outskirt fields. The map keeps going for a while past the last district,
  // and there is no prop budget left to build a second city out there — so the
  // outer ring is dressed as farmland instead: a patchwork of meadow and gravel
  // decals under the treelines the gap fill planted. Decals are free (they
  // merge into the one patch mesh below) and they are what stops the edge of
  // the world reading as a bare tan plain.
  {
    const FIELD_C = [PAL.parkSoft, PAL.park, PAL.parkSoft, PAL.gravel];
    const B0 = WORLD.bounds;
    const STRIPS = [
      { x0: -B0 + 6, x1: -140, z0: WORLD.waterZ + 10, z1: B0 - 6 },   // west
      { x0: 150, x1: B0 - 6, z0: WORLD.waterZ + 10, z1: B0 - 6 },     // east
      { x0: -140, x1: 150, z0: 150, z1: B0 - 6 },                     // south
    ];
    for (const s of STRIPS) {
      for (let x = s.x0 + 10; x <= s.x1; x += 22) {
        for (let z = s.z0 + 10; z <= s.z1; z += 22) {
          const fx = x + (rng() - 0.5) * 9;
          const fz = z + (rng() - 0.5) * 9;
          if (inWater(fx, fz, 8) || onPaving(fx, fz, 4)) continue;
          patchParts.push(roundedRect(fx, fz, 22 + rng() * 16, 19 + rng() * 14, 6,
            FIELD_C[Math.floor(rng() * FIELD_C.length)], 0.014));
        }
      }
    }
  }

  // The district / park decals are one merged, vertex-coloured surface. It is
  // built here, after the gap fill, so the pocket parks can add to it without
  // costing a second draw call.
  const patchMat = trackMat(new THREE.MeshToonMaterial({
    vertexColors: true, gradientMap,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  }));
  const patchGeo = trackGeo(merge(patchParts));
  const patchMesh = new THREE.Mesh(patchGeo, patchMat);
  patchMesh.name = 'district-patches';
  patchMesh.receiveShadow = true;
  group.add(patchMesh);

  const propsGroup = new THREE.Group();
  propsGroup.name = 'props';
  group.add(propsGroup);
  const propBuilt = buildPropInstances(null, props, {
    gradientMap, group: propsGroup, colliders, glowMats, neonMats,
  });

  // Resolve the animated instances now that the meshes exist.
  const meshById = new Map();
  for (const child of propsGroup.children) {
    if (child.isInstancedMesh && child.name.startsWith('prop:')) {
      const parts = child.name.split(':');
      const id = parts[1];
      if (!meshById.has(id)) meshById.set(id, []);
      meshById.get(id).push(child);
    }
  }
  const swayers = [];
  for (const s of sway) {
    const meshes = meshById.get(s.id);
    if (!meshes) continue;
    swayers.push({ meshes, i: s.i, x: s.x, z: s.z, yaw: s.yaw, phase: rng() * Math.PI * 2, amp: 0.055 + rng() * 0.045 });
  }
  const gullers = [];
  for (const g of gulls) {
    const meshes = meshById.get(g.id);
    if (!meshes) continue;
    gullers.push({
      meshes, i: g.i, cx: g.x, cz: g.z, r: 6 + rng() * 10,
      y: 3 + rng() * 3.5, phase: rng() * Math.PI * 2, speed: 0.14 + rng() * 0.12,
    });
  }

  // =========================================================================
  // 6. THE PLAYER'S SUSHI SHOP
  // =========================================================================

  const shopGroup = new THREE.Group();
  shopGroup.name = 'sushi-shop';
  shopGroup.position.set(HOME.shop.x, 0, HOME.shop.z);
  shopGroup.rotation.y = HOME.shop.yaw || 0;
  group.add(shopGroup);

  const shopStructMat = trackMat(new THREE.MeshToonMaterial({ vertexColors: true, map: stuccoTex, gradientMap }));
  const shopGlowMat = trackMat(new THREE.MeshToonMaterial({
    vertexColors: true, gradientMap, emissive: new THREE.Color(0xffd9a0), emissiveIntensity: 0,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
  }));
  const shopNeonMat = trackMat(new THREE.MeshToonMaterial({
    vertexColors: true, gradientMap, emissive: new THREE.Color(0xfff0d0), emissiveIntensity: 0.12,
    toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3,
  }));
  glowMats.push(shopGlowMat);
  neonMats.push(shopNeonMat);

  let shopTier = Math.max(1, Math.min(5, Math.round(
    (game && game.state && game.state.shop && game.state.shop.tier) || 1,
  )));
  let shopBuilt = null;
  let shopSignTex = null;
  let shopSignMat = null;
  let shopCollider = null;
  const shopAnchors = { door: { x: 0, y: 0, z: 0, yaw: 0 }, counterAnchor: { x: 0, y: 0, z: 0 }, queueAnchors: [], seatAnchors: [] };

  const _v = new THREE.Vector3();
  function toWorld(p, y = 0) {
    _v.set(p.x || 0, p.y != null ? p.y : y, p.z || 0).applyMatrix4(shopGroup.matrixWorld);
    return { x: _v.x, y: _v.y, z: _v.z };
  }

  function clearShop() {
    for (let i = shopGroup.children.length - 1; i >= 0; i--) {
      const c = shopGroup.children[i];
      shopGroup.remove(c);
      if (c.geometry) c.geometry.dispose();
    }
    if (shopSignMat) { shopSignMat.dispose(); shopSignMat = null; }
    if (shopSignTex) { shopSignTex.dispose(); shopSignTex = null; }
    if (shopCollider) {
      const i = colliders.indexOf(shopCollider);
      if (i >= 0) colliders.splice(i, 1);
      shopCollider = null;
    }
  }

  function buildShop(tier) {
    clearShop();
    shopBuilt = buildSushiShop(tier);
    const add = (geo, mat, name) => {
      if (!geo) return;
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      m.castShadow = true;
      m.receiveShadow = true;
      shopGroup.add(m);
    };
    add(shopBuilt.structure, shopStructMat, 'shop:structure');
    add(shopBuilt.glow, shopGlowMat, 'shop:glow');
    add(shopBuilt.neon, shopNeonMat, 'shop:neon');
    if (shopBuilt.sign && shopBuilt.signTex) {
      shopSignTex = shopBuilt.signTex;
      shopSignMat = new THREE.MeshToonMaterial({
        map: shopSignTex, gradientMap, emissive: 0xffffff, emissiveMap: shopSignTex,
        emissiveIntensity: 0.5, side: THREE.DoubleSide,
      });
      const sg = new THREE.PlaneGeometry(shopBuilt.sign.w || 3, shopBuilt.sign.h || 0.8);
      sg.translate(shopBuilt.sign.x || 0, shopBuilt.sign.y || 3, (shopBuilt.sign.z || 0) + 0.03);
      const sm = new THREE.Mesh(sg, shopSignMat);
      sm.name = 'shop:sign';
      shopGroup.add(sm);
    }

    shopGroup.updateMatrixWorld(true);

    // Anchors → world space.
    const d = shopBuilt.door || { x: 0, z: 2, yaw: 0 };
    const dw = toWorld(d, 0);
    shopAnchors.door = { x: dw.x, y: 0, z: dw.z, yaw: (d.yaw || 0) + (HOME.shop.yaw || 0) };
    const ca = shopBuilt.counterAnchor || { x: 0, y: 1.2, z: 0 };
    shopAnchors.counterAnchor = toWorld(ca, 1.2);
    shopAnchors.queueAnchors = (shopBuilt.queueAnchors || []).map((p) => {
      const w = toWorld(p, 0);
      return { x: w.x, y: 0, z: w.z };
    });
    shopAnchors.seatAnchors = (shopBuilt.seatAnchors || []).map((p) => {
      const w = toWorld(p, 0);
      return { x: w.x, y: 0, z: w.z };
    });

    // Collider (world space, yaw-aware).
    const col = shopBuilt.collider;
    if (col) {
      const c = toWorld({ x: col.cx || 0, y: 0, z: col.cz || 0 }, 0);
      const horiz = Math.abs(Math.sin(HOME.shop.yaw || 0)) > 0.5;
      const cw = (horiz ? col.d : col.w) / 2;
      const cd = (horiz ? col.w : col.d) / 2;
      shopCollider = new THREE.Box3(
        new THREE.Vector3(c.x - cw, 0, c.z - cd),
        new THREE.Vector3(c.x + cw, col.h || 6, c.z + cd),
      );
      colliders.push(shopCollider);
    }
  }
  buildShop(shopTier);

  // =========================================================================
  // 7. POINTS OF INTEREST
  // =========================================================================

  const pois = [];
  const addPoi = (p) => { pois.push(p); return p; };

  addPoi({
    id: 'home_shop', x: HOME.shop.x, z: HOME.shop.z,
    label: 'Sushi Paws', icon: '🍣', district: 'old_market', kind: 'shop',
  });
  addPoi({
    id: 'home_bed', x: HOME.bed.x, z: HOME.bed.z,
    label: 'Your Bed', icon: '🛏️', district: 'old_market', kind: 'home',
  });
  addPoi({
    id: 'delivery_board', x: HOME.shop.x + 3, z: HOME.shop.z + 4,
    label: 'Delivery Board', icon: '📋', district: 'old_market', kind: 'job_board',
  });
  for (const s of SUPPLIERS) {
    addPoi({ id: s.id, x: s.x, z: s.z, label: s.name, icon: s.icon, district: s.district, kind: 'supplier' });
  }
  for (const d of DISTRICTS) {
    if (!d.gate) continue;
    const gd = districtAt(d.gate.x, d.gate.z);
    addPoi({
      id: `gate_${d.id}`, x: d.gate.x, z: d.gate.z,
      label: `${d.name} gate`, icon: '🚩', district: (gd && gd.id) || d.id, kind: 'gate',
    });
  }
  for (const s of DEFAULT_SPOTS || []) {
    const sd = districtAt(s.x, s.z);
    addPoi({
      id: s.id, x: s.x, z: s.z, label: s.name || 'Fishing spot', icon: '🎣',
      district: (sd && sd.id) || 'fish_harbor', kind: 'fishing',
    });
  }
  const LANDMARKS = [
    { id: 'lm_shrine', x: -110, z: 42, label: 'Little Shrine', icon: '⛩️', district: 'old_market' },
    { id: 'lm_torii', x: -110, z: 26.5, label: 'Shrine Gate', icon: '⛩️', district: 'old_market' },
    { id: 'lm_tea_house', x: -113, z: 11.2, label: 'Tea House', icon: '🍵', district: 'old_market' },
    { id: 'lm_bathhouse', x: -89, z: 12.6, label: 'Bathhouse', icon: '♨️', district: 'old_market' },
    { id: 'lm_market_square', x: -58, z: 16, label: 'Market Square', icon: '🏮', district: 'old_market' },
    { id: 'lm_fish_market', x: -40, z: -109, label: 'Fish Market Hall', icon: '🐟', district: 'fish_harbor' },
    { id: 'lm_docks', x: -20, z: -144, label: 'The Docks', icon: '⚓', district: 'fish_harbor' },
    { id: 'lm_station', x: 64, z: -14, label: 'Central Station', icon: '🚉', district: 'downtown' },
    { id: 'lm_tower_row', x: 92, z: 30, label: 'Tower Row', icon: '🏙️', district: 'downtown' },
    { id: 'lm_canal', x: 102, z: 59, label: 'Tower Canal', icon: '🌊', district: 'downtown' },
    { id: 'lm_home_lane', x: 0, z: 104, label: 'Home Lane', icon: '🏡', district: 'residential' },
    { id: 'lm_festival', x: 74, z: -134, label: 'Festival Square', icon: '🎆', district: 'neon_street' },
    { id: 'lm_neon_lane', x: 95, z: -100, label: 'Neon Lane', icon: '🏮', district: 'neon_street' },
  ];
  for (const l of LANDMARKS) addPoi({ ...l, kind: 'landmark' });

  const poiById = new Map(pois.map((p) => [p.id, p]));
  const poi = (id) => poiById.get(id) || null;

  // =========================================================================
  // 8. WAYPOINT BEACON
  // =========================================================================

  let waypoint = null;
  const beacon = new THREE.Group();
  beacon.name = 'waypoint';
  beacon.visible = false;
  group.add(beacon);
  {
    const beamGeo = trackGeo(new THREE.CylinderGeometry(0.34, 0.5, 14, 10, 1, true));
    beamGeo.translate(0, 7, 0);
    const beamMat = trackMat(new THREE.MeshBasicMaterial({
      color: 0xffcf6a, transparent: true, opacity: 0.28, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    beacon.add(new THREE.Mesh(beamGeo, beamMat));
    const ringGeo = trackGeo(new THREE.RingGeometry(1.5, 2.1, 24));
    ringGeo.rotateX(-Math.PI / 2);
    ringGeo.translate(0, 0.14, 0);
    const ringMat = trackMat(new THREE.MeshBasicMaterial({
      color: 0xffcf6a, transparent: true, opacity: 0.45, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false,
    }));
    beacon.add(new THREE.Mesh(ringGeo, ringMat));
    const diaGeo = trackGeo(new THREE.OctahedronGeometry(0.62, 0));
    const diaMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xffd98a, toneMapped: false }));
    const diamond = new THREE.Mesh(diaGeo, diaMat);
    diamond.name = 'waypoint:diamond';
    diamond.position.y = 3.2;
    beacon.add(diamond);
    beacon.userData.diamond = diamond;
  }

  function setWaypoint(target) {
    if (!target) {
      waypoint = null;
      beacon.visible = false;
      return null;
    }
    const t = {
      x: Number(target.x) || 0,
      z: Number(target.z) || 0,
      label: target.label || target.id || 'Waypoint',
      id: target.id || null,
    };
    waypoint = t;
    beacon.position.set(t.x, groundHeightAt(t.x, t.z), t.z);
    beacon.visible = true;
    return t;
  }

  // =========================================================================
  // 9. SPAWNS + GROUND HEIGHT
  // =========================================================================

  function spawnAt(id) {
    if (!id || id === 'home' || id === 'spawn' || id === 'home_spawn') {
      return { x: HOME.spawn.x, z: HOME.spawn.z, yaw: HOME.spawn.yaw || 0 };
    }
    if (id === 'shop' || id === 'home_shop') {
      return { x: shopAnchors.door.x, z: shopAnchors.door.z, yaw: shopAnchors.door.yaw || 0 };
    }
    if (id === 'bed' || id === 'home_bed') return { x: HOME.bed.x, z: HOME.bed.z, yaw: 0 };
    const gate = poi(`gate_${id}`) || poi(id);
    if (gate) {
      // Face the district centre so an arrival always looks into the zone.
      const d = DISTRICTS.find((dd) => dd.id === (gate.district || id));
      const yaw = d ? yawFace(d.center.x - gate.x, d.center.z - gate.z) : 0;
      return { x: gate.x, z: gate.z, yaw };
    }
    return { x: HOME.spawn.x, z: HOME.spawn.z, yaw: HOME.spawn.yaw || 0 };
  }

  // Cheap AABB list: only the decks stand above y=0.
  const DECKS = PIERS.map((p) => ({
    x0: p.x - p.w / 2, x1: p.x + p.w / 2, z0: p.z0, z1: p.z1, y: DECK_Y,
  }));
  function groundHeightAt(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
    for (let i = 0; i < DECKS.length; i++) {
      const d = DECKS[i];
      if (x >= d.x0 && x <= d.x1 && z >= d.z0 && z <= d.z1) return d.y;
    }
    return 0;
  }

  // =========================================================================
  // 10. WORLD BOUNDS + FLICKERING SIGNS
  // =========================================================================

  const B = WORLD.bounds;
  const T = 6;
  for (const b of [
    [-B - T, -B - T, B + T, -B],   // north
    [-B - T, B, B + T, B + T],     // south
    [-B - T, -B - T, -B, B + T],   // west
    [B, -B - T, B + T, B + T],     // east
  ]) {
    colliders.push(new THREE.Box3(
      new THREE.Vector3(b[0], 0, b[1]), new THREE.Vector3(b[2], 24, b[3]),
    ));
  }

  // Two hand-placed neon boards that flicker on their own (not part of the
  // day/night ramp, so main.js can't stomp the effect).
  const flickers = [];
  {
    const mkSign = (x, z, yaw, w, h, color) => {
      const g = trackGeo(merge([
        box(w, h, 0.22, 0, h / 2, 0, color),
        box(w + 0.2, 0.16, 0.3, 0, h + 0.08, 0, C.metalDark),
        box(w + 0.2, 0.16, 0.3, 0, -0.08, 0, C.metalDark),
      ]));
      const mat = trackMat(new THREE.MeshToonMaterial({
        vertexColors: true, gradientMap, emissive: new THREE.Color(color),
        emissiveIntensity: 0.2, toneMapped: false,
      }));
      const m = new THREE.Mesh(g, mat);
      m.position.set(x, 4.6, z);
      m.rotation.y = yaw;
      m.name = 'neon:flicker';
      group.add(m);
      flickers.push({ mat, phase: rng() * 10, rate: 6 + rng() * 5 });
      // Support post.
      const post = new THREE.Mesh(
        trackGeo(cyl(0.14, 0.16, 4.6, 8, 0, 2.3, 0, C.metalDark)),
        quayMat,
      );
      post.position.set(x, 0, z);
      post.rotation.y = yaw;
      group.add(post);
    };
    mkSign(88.2, -92, -Math.PI / 2, 3.4, 1.4, '#ff6aa8');
    mkSign(101.8, -84, Math.PI / 2, 3.0, 1.3, '#6ad8ff');
  }

  // =========================================================================
  // 11. UPDATE / DISPOSE / STATS
  // =========================================================================

  let clock = 0;
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _s = new THREE.Vector3(1, 1, 1);
  const _p = new THREE.Vector3();

  function update(dt, night = 0) {
    const d = Number.isFinite(dt) ? Math.min(dt, 0.1) : 0;
    clock += d;

    // Water: a calm, cheap two-wave displacement.
    for (let i = 0; i < waterPos.count; i++) {
      const x = waterBase[i * 3];
      const z = waterBase[i * 3 + 2];
      waterPos.array[i * 3 + 1] = waterBase[i * 3 + 1]
        + Math.sin(x * 0.07 + clock * 0.9) * 0.13
        + Math.sin(z * 0.11 - clock * 0.65) * 0.1;
    }
    waterPos.needsUpdate = true;

    // Banners + noren sway.
    for (const s of swayers) {
      const a = Math.sin(clock * 1.35 + s.phase) * s.amp;
      _e.set(0, s.yaw + a * 0.5, a);
      _q.setFromEuler(_e);
      _p.set(s.x, 0, s.z);
      _m.compose(_p, _q, _s);
      for (const mesh of s.meshes) {
        if (s.i < mesh.count) { mesh.setMatrixAt(s.i, _m); mesh.instanceMatrix.needsUpdate = true; }
      }
    }

    // Gulls drifting over the harbour.
    for (const g of gullers) {
      const a = clock * g.speed + g.phase;
      _p.set(g.cx + Math.cos(a) * g.r, g.y + Math.sin(a * 2.1) * 0.5, g.cz + Math.sin(a) * g.r * 0.6);
      _e.set(0, -a + Math.PI / 2, Math.sin(a * 3) * 0.16);
      _q.setFromEuler(_e);
      _m.compose(_p, _q, _s);
      for (const mesh of g.meshes) {
        if (g.i < mesh.count) { mesh.setMatrixAt(g.i, _m); mesh.instanceMatrix.needsUpdate = true; }
      }
    }

    // Neon flicker (only meaningful once it is dark).
    const n = Math.max(0, Math.min(1, night));
    for (const f of flickers) {
      const t = clock * f.rate + f.phase;
      const jitter = 0.75 + 0.25 * Math.sin(t) * Math.sin(t * 2.7 + 1.3);
      const drop = Math.sin(t * 0.37) > 0.985 ? 0.25 : 1;
      f.mat.emissiveIntensity = 0.18 + n * 1.5 * jitter * drop;
    }

    // Waypoint beacon bob + spin.
    if (waypoint && beacon.visible) {
      const dia = beacon.userData.diamond;
      if (dia) {
        dia.position.y = 3.2 + Math.sin(clock * 2.1) * 0.35;
        dia.rotation.y = clock * 1.1;
        dia.rotation.x = Math.sin(clock * 0.7) * 0.2;
      }
      beacon.rotation.y = clock * 0.25;
    }
  }

  function dispose() {
    setWaypoint(null);
    clearShop();
    const seenGeo = new Set();
    const seenMat = new Set();
    group.traverse((o) => {
      if (o.geometry && !seenGeo.has(o.geometry)) { seenGeo.add(o.geometry); o.geometry.dispose(); }
      const m = o.material;
      if (!m) return;
      for (const mm of Array.isArray(m) ? m : [m]) {
        if (seenMat.has(mm)) continue;
        seenMat.add(mm);
        if (mm.map && mm.map.dispose) mm.map.dispose();
        if (mm.emissiveMap && mm.emissiveMap !== mm.map && mm.emissiveMap.dispose) mm.emissiveMap.dispose();
        mm.dispose();
      }
    });
    for (const g of ownedGeos) { if (!seenGeo.has(g)) { seenGeo.add(g); g.dispose(); } }
    for (const m of ownedMats) { if (!seenMat.has(m)) { seenMat.add(m); m.dispose(); } }
    for (const t of textures) { if (t && t.dispose) t.dispose(); }
    if (group.parent) group.parent.remove(group);
    colliders.length = 0;
    glowMats.length = 0;
    neonMats.length = 0;
    pois.length = 0;
  }

  // ---- startup report -----------------------------------------------------
  let instancedMeshes = 0;
  let triangles = 0;
  group.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    if (!g) return;
    const tri = (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) / 3;
    if (o.isInstancedMesh) { instancedMeshes++; triangles += tri * o.count; }
    else triangles += tri;
  });
  const byDistrict = {};
  for (const p of kept) byDistrict[p.district] = (byDistrict[p.district] || 0) + 1;

  console.info('[world] city built', {
    buildings: built.count,
    props: propBuilt.count,
    instancedMeshes,
    colliders: colliders.length,
    triangles: Math.round(triangles),
    drawCalls: (() => { let n = 0; group.traverse((o) => { if (o.isMesh) n++; }); return n; })(),
    rejected: rejects.length,
    byDistrict,
    pois: pois.length,
    gapFill: { clusters: fill.clusters, props: fill.props, byKind: fill.byKind },
  });

  if (game && game.scene && typeof game.scene.add === 'function') game.scene.add(group);

  return {
    group,
    colliders,
    districtAt,
    poi,
    pois,
    setWaypoint,
    get waypoint() { return waypoint; },
    spawnAt,
    groundHeightAt,
    glowMats,
    neonMats,
    gradientMap,
    update,
    shopGroup,
    shopAnchors,
    setShopTier(tier) {
      const t = Math.max(1, Math.min(5, Math.round(Number(tier) || 1)));
      if (t === shopTier && shopBuilt) return shopAnchors;
      shopTier = t;
      buildShop(t);
      return shopAnchors;
    },
    get shopTier() { return shopTier; },
    dispose,
    // Handy for tooling/tests; not part of the contract.
    _placements: kept,
    _rejects: rejects,
    _props: props,
    _fill: fill,
    _stats: { buildings: built.count, props: propBuilt.count, instancedMeshes, colliders: colliders.length, triangles, byDistrict },
  };
}

export default createWorld;
