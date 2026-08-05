import * as THREE from 'three';
import { paint, box, cyl, merge, C } from '../engine/prim.js';
import { makeGroundTexture, makeStuccoTexture } from '../engine/textures.js';
import { WORLD, ROADS, DISTRICTS, HOME, districtAt } from '../data/districts.js';
import { GAME } from '../config.js';
import { BUILDING_TYPES, buildBuildingInstances, buildSushiShop } from './buildings.js';
import { buildPropInstances } from './props.js';
import { SUPPLIERS } from '../data/suppliers.js';
import { NPCS } from '../data/npcs.js';
import { DEFAULT_SPOTS } from '../game/fishing.js';

// ---------------------------------------------------------------------------
// CATUSHI — the hand-authored city.
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
  // Old Market — the back lane behind the Market Road frontage, and the gravel
  // walk down into the shrine precinct. Both deliberately narrow.
  { id: 'lane_back', x: -48, z: -7.9, w: 20, d: 6, name: 'Back Lane' },
  { id: 'lane_shrine', x: -51, z: 10, w: 3.6, d: 10, name: 'Shrine Walk' },
  { id: 'lane_market', x: -31.5, z: 15, w: 3.6, d: 22, name: 'Lantern Alley' },
  // Downtown — the canal towpath.
  { id: 'canal_walk', x: 52.6, z: 33, w: 4, d: 16, name: 'Canal Walk' },
];

/**
 * Water bodies. Non-overlapping rects. The open sea runs north from
 * WORLD.waterZ (-62); the harbour frontage is notched 1.6 units further south
 * so the quay wall has a face to stand on, and Harbour Avenue runs out onto a
 * mole that splits the two halves of the basin.
 */
const WATER = [
  { id: 'sea_w', x0: -160, x1: -6, z0: -300, z1: WORLD.waterZ },
  { id: 'sea_e', x0: 6, x1: 160, z0: -300, z1: WORLD.waterZ },
  { id: 'sea_n', x0: -6, x1: 6, z0: -300, z1: -68 },
  { id: 'basin_w', x0: -30, x1: -6, z0: WORLD.waterZ, z1: -60.4 },
  { id: 'basin_e', x0: 6, x1: 24, z0: WORLD.waterZ, z1: -60.4 },
  { id: 'inlet', x0: 50.5, x1: 62, z0: WORLD.waterZ, z1: -49 },
  { id: 'canal', x0: 45.4, x1: 50.2, z0: 25.5, z1: 41 },
];

/** Piers running north from the basin edge at z = -60.4. Deck at y = 0.5. */
const DECK_Y = 0.5;
const PIERS = [
  { id: 'pier_west', x: -10.1, w: 5, z0: -67, z1: -60.4 },
  { id: 'pier_east', x: 15, w: 4.5, z0: -66, z1: -60.4 },
];

/**
 * The home plaza — the paved square the player spawns on, wrapped around the
 * shop. Market Road closes it to the north and Harbour Avenue to the east;
 * buildings close the other two sides. The scatterers stay out of it so the
 * dressing inside can be placed by hand.
 *
 * The square runs a long way south of the spawn on purpose. The chase camera
 * sits ~9.5 units behind the player, so on a new game it hangs over (-12, 28):
 * that whole apron has to stay open or the opening shot is a wall of masonry.
 * See CAM_KEEP / CAM_LANE below — every hand-placed prop is checked against
 * them, and the south building row is set back to z = 36.5.
 */
const PLAZA = { x0: -21.5, x1: -4.5, z0: 4.4, z1: 34.0 };
const PLAZA_KEEP = { x0: -22, x1: -4.2, z0: 4, z1: 34.6 };

/**
 * The opening-shot keep-outs.
 *  · CAM_KEEP  — the disc the chase camera lives in on a new game. Nothing
 *                taller than CAM_LOW may stand in it.
 *  · CAM_LANE  — the walk from the spawn to the shop door plus the camera's
 *                run-back behind it. Same height rule.
 * Flat decals, planters and potted plants (all ≤ 0.5 tall) are welcome in
 * both — it is only the shoulder-height stuff that ruins the shot.
 */
const CAM_KEEP = { x: HOME.spawn.x, z: HOME.spawn.z + 9, r: 7 };
const CAM_LANE = { x0: -15, x1: -9, z0: 12, z1: 34 };
const CAM_LOW = 0.6;

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
  // basin, the mole Harbour Avenue runs out on and the neon inlet, with the
  // downtown canal punched out as a hole. Walked west → east along the coast.
  const land = new THREE.Shape();
  const P = (x, z) => land.lineTo(x, -z);
  land.moveTo(-160, -140);            // (x=-160, z=140) SW
  P(160, 140); P(160, WORLD.waterZ);
  P(62, WORLD.waterZ); P(62, -49); P(50.5, -49); P(50.5, WORLD.waterZ);   // neon inlet
  P(24, WORLD.waterZ); P(24, -60.4); P(6, -60.4);                          // east basin
  P(6, -68); P(-6, -68);                                                   // the mole
  P(-6, -60.4); P(-30, -60.4); P(-30, WORLD.waterZ);                       // west basin
  P(-160, WORLD.waterZ);
  land.closePath();
  const canalHole = new THREE.Path();
  canalHole.moveTo(45.4, -25.5);
  canalHole.lineTo(50.2, -25.5);
  canalHole.lineTo(50.2, -41);
  canalHole.lineTo(45.4, -41);
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
    old_market: [{ x: -34, z: 4, w: 50, d: 54, r: 12 }],
    fish_harbor: [{ x: 2, z: -44, w: 70, d: 33, r: 10 }],
    // Clipped around the canal so the towpath green never paints over water.
    downtown: [{ x: 31, z: 10, w: 28, d: 54, r: 10 },
      { x: 44, z: 2, w: 18, d: 38, r: 8 },
      { x: 57.5, z: 20, w: 15, d: 34, r: 8 }],
    residential: [{ x: 0, z: 52, w: 62, d: 38, r: 12 }],
    neon_street: [{ x: 36, z: -40, w: 26, d: 34, r: 8 }, { x: 56, z: -33, w: 18, d: 20, r: 7 }],
  };
  for (const d of DISTRICTS) {
    for (const p of districtPatch[d.id] || []) {
      patchParts.push(roundedRect(p.x, p.z, p.w, p.d, p.r, d.ground, 0.012));
    }
  }

  // Gap fillers: small parks and plazas so no bare ground shows between zones.
  const FILLERS = [
    { x: -50, z: 10, w: 18, d: 22, r: 7, c: PAL.gravel },        // shrine precinct
    { x: -46, z: 40, w: 26, d: 16, r: 7, c: PAL.park },          // market green
    { x: 12, z: 22, w: 22, d: 24, r: 8, c: PAL.park },           // mid park
    { x: -20, z: -18, w: 22, d: 16, r: 6, c: PAL.park },         // north green
    { x: 20, z: -12, w: 24, d: 18, r: 7, c: PAL.park },          // link park
    { x: -20, z: 44, w: 24, d: 16, r: 7, c: PAL.park },          // suburb green
    { x: 24, z: 42, w: 20, d: 16, r: 7, c: PAL.park },
    { x: 4, z: -50, w: 46, d: 12, r: 4, c: PAL.gravel },         // harbour apron
    { x: -22, z: -50, w: 18, d: 12, r: 4, c: PAL.gravel },
    { x: 33, z: -50, w: 12, d: 12, r: 4, c: PAL.neonGround },    // festival square
    { x: 54, z: 33, w: 12, d: 20, r: 6, c: PAL.park },           // canal green
    { x: 60, z: 4, w: 12, d: 20, r: 6, c: PAL.park },            // east green
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
    // A darker inlaid runway down the middle: it runs from the shop door all
    // the way to the south edge of the square, so the eye is pulled from the
    // spawn point straight to the counter — and it is the *only* dressing in
    // the camera lane, because it is flat.
    const rz = (CAM_LANE.z0 + CAM_LANE.z1) / 2;
    const rd = CAM_LANE.z1 - CAM_LANE.z0;
    patchParts.push(flatRect(HOME.shop.x, rz, 4.4, rd, PAL.plazaEdge, 0.032));
    patchParts.push(flatRect(HOME.shop.x, rz, 3.6, rd - 0.8, PAL.plazaTile, 0.034));
    // Paving chevrons across the runway — flat, so the camera flies over them.
    for (let z = CAM_LANE.z0 + 2.2; z < CAM_LANE.z1 - 1; z += 2.6) {
      patchParts.push(flatRect(HOME.shop.x, z, 3.0, 0.16, PAL.plazaJoint, 0.036));
    }
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

  // Open coast either side of the harbour, set back so the wall stands on land.
  shorelineX(-108, -30, WORLD.waterZ + 0.7);
  shorelineX(24, 50.5, WORLD.waterZ + 0.7);
  shorelineX(62, 108, WORLD.waterZ + 0.7);
  // The harbour frontage itself: a thinner bulkhead, because the quay road runs
  // 0.9 units behind it. Pier mouths are cut out automatically.
  shorelineX(-30, -6, -59.95, 0.9);
  shorelineX(6, 24, -59.95, 0.9);
  quayWall(-30.45, -61.2, 0.9, 1.6);          // returns at the basin corners
  quayWall(24.45, -61.2, 0.9, 1.6);
  // Harbour Avenue's mole, walled on three sides.
  quayWall(-5.55, -64.2, 0.9, 7.6);
  quayWall(5.55, -64.2, 0.9, 7.6);
  quayWall(0, -67.55, 12, 0.9);
  // Neon inlet.
  quayWall(50.05, -55.5, 0.9, 13);
  quayWall(56.25, -49.45, 13.3, 0.9);
  quayWall(62.45, -55.5, 0.9, 13);
  // Downtown canal — low kerbs, open at both ends so nobody gets boxed in.
  quayParts.push(box(0.6, 0.5, 15.5, 45.1, 0.05, 33.25, PAL.stone));
  quayParts.push(box(0.6, 0.5, 15.5, 50.5, 0.05, 33.25, PAL.stone));
  colliders.push(new THREE.Box3(new THREE.Vector3(44.8, 0, 25.5), new THREE.Vector3(45.4, 0.4, 41)));
  colliders.push(new THREE.Box3(new THREE.Vector3(50.2, 0, 25.5), new THREE.Vector3(50.8, 0.4, 41)));

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

  // ---------------------------------------------------- OLD MARKET (17) ----
  // The compact rebuild: half the buildings of the old sprawl, packed twice as
  // tight. Rows sit shoulder to shoulder with 0.5-1.5 unit gaps so Market Road
  // reads as a canyon, and every gap in a row is a courtyard an NPC lives in —
  // every home and schedule point is checked against the finished colliders.

  // -- north side of Market Road (fronts look south onto it) ----------------
  shelf({ face: '+z', edge: -4.3, a0: -37.5, a1: -24, district: 'old_market', tag: 'market_road_n',
    items: [M('sand'), { id: 'yatai' }], gap: 0.9 });
  // Taro's Pantry sits mid-run, on the kerb right by his stall spot.
  place('marketStall', -21, -5.95, 0, 'rice', 'old_market', 'market_pantry');
  shelf({ face: '+z', edge: -4.3, a0: -18.5, a1: -4.4, district: 'old_market', tag: 'market_road_n',
    items: [S('veg'), M('cream')], gap: 0.9 });

  // -- the back lane: a second row behind the frontage. Taro and Chacha live
  //    in the courtyard between the two, which is why the lane is here at all.
  place('machiya', -50, -14.55, 0, 'single', 'old_market', 'back_lane');
  place('machiya', -41.5, -14.55, 0, 'sage', 'old_market', 'back_lane');

  // -- south side of Market Road: the stall run onto the market square ------
  // The goldfish stall used to sit at x = -27, two units in front of Yuki's
  // counter: you shopped from a 3-unit slot with the camera in your back. It
  // is now further west, which leaves Yuki's frontage open to the road.
  place('marketStall', -41.5, 5.95, Math.PI, 'sweets', 'old_market', 'market_road_s');
  place('festivalStall', -36, 6, Math.PI, 'goldfish', 'old_market', 'market_road_s');

  // -- the market square, west of the plaza ---------------------------------
  place('marketStall', -27, 12, Math.PI, 'veg', 'old_market', 'yuki_stall');
  place('marketStall', -36, 14, Math.PI, 'fish', 'old_market', 'square');
  // Master Kuro's tea house closes the square to the south; the bathhouse
  // anchors the far west end of the quarter.
  place('teaHouse', -40, 24, Math.PI, null, 'old_market', 'tea_house');
  place('bathhouse', -54, 24.5, Math.PI, null, 'old_market', 'bathhouse');

  // -- the home plaza frame -------------------------------------------------
  // Market Road closes the plaza to the north, Harbour Avenue to the east and
  // this machiya to the west.
  place('machiya', -25.85, 22, Math.PI / 2, 'sage', 'old_market', 'plaza_w');
  // There is deliberately NO south row. One used to front at z = 29, which put
  // the opening shot inside a machiya wall — the chase camera hangs over
  // (-12, 28) on a new game (CAM_KEEP). The square is closed instead by the
  // residential house row at z = 38.5, ten units behind the camera, with an
  // avenue of cherry trees and lantern posts at z ~ 36 reading as its south
  // edge. The approach the player walks in from stays open, which is its job.

  // --------------------------------------------------- FISH HARBOUR (11) ---
  // Everything faces the water across the quay road. The hall sits back on the
  // approach so you meet it head-on coming up Harbour Avenue.
  place('fishMarketHall', -17, -28, Math.PI, null, 'fish_harbor', 'fish_market');
  place('warehouse', -21, -45.65, Math.PI, null, 'fish_harbor', 'quay_west');
  place('marketStall', -6.8, -49, Math.PI, 'fish', 'fish_harbor', 'mikan_catch');
  // This shed used to sit 1.9 units north of Mikan's stall, which made the walk
  // to the quay a slot. It is now tucked against the market hall instead, and
  // the apron in front of the stall is open ground.
  place('dockShed', -8.5, -38.65, Math.PI, null, 'fish_harbor', 'sheds');
  place('dockShed', -33, -44, Math.PI, null, 'fish_harbor', 'sheds');
  place('marketStall', -30, -34.5, Math.PI / 2, 'veg', 'fish_harbor', 'quayside');
  place('marketStall', 16.3, -49.5, Math.PI, 'fish', 'fish_harbor', 'harbor_auction');
  place('dockShed', 9.5, -45.5, Math.PI, null, 'fish_harbor', 'sheds');
  place('dockShed', 26, -49.2, Math.PI, null, 'fish_harbor', 'sheds');
  // The two quay machiya are spread out so the walk from Harbour Avenue up to
  // Neon Lane is a street, not a pair of 1.7-unit slots.
  place('machiya', 23.5, -34.5, 0, 'sand', 'fish_harbor', 'quay_machiya');
  place('machiya', 11, -32, 0, 'sage', 'fish_harbor', 'quay_machiya');

  // ------------------------------------------------------- DOWNTOWN (11) ---
  // Tower Row is the spine. The station takes the whole west block, the towers
  // stack up east of the canal, and the konbini holds the Market Road corner.
  place('trainStation', 27, 22, Math.PI, null, 'downtown', 'station');
  place('konbini', 22.5, 8.5, Math.PI, null, 'downtown', 'konbini');
  // Held back from the kerb: at edge 43.8 this block stood square across the
  // head of Neon Lane, so walking north up the lane put the camera in its wall.
  shelf({ face: '-x', edge: 48, a0: -16.5, a1: -4.3, district: 'downtown', tag: 'tower_row_e',
    items: [{ id: 'officeBlock', v: 'low' }] });
  place('officeBlock', 63, -10, Math.PI, 'tall', 'downtown', 'east_block');
  place('officeBlock', 59, 10, Math.PI, 'mid', 'downtown', 'east_block');
  place('izakaya', 48, 8, -Math.PI / 2, null, 'downtown', 'tower_row_e');
  place('izakaya', 50, 19, -Math.PI / 2, null, 'downtown', 'canal_west');
  place('konbini', 60, 26, Math.PI, null, 'downtown', 'canal_east');
  place('officeBlock', 62.5, 37, Math.PI, 'low', 'downtown', 'canal_east');
  place('apartment', 20, 34, Math.PI, 'four', 'downtown', 'apartments');
  place('warehouse', 20, -11.9, 0, null, 'downtown', 'service');
  place('apartment', 11, 12, Math.PI, 'two', 'downtown', 'market_block');

  // ---------------------------------------------------- RESIDENTIAL (14) ---
  // Gardens are switched off on the tight plots: the fence line reaches 1.3
  // units past the wall and would otherwise swallow a neighbour's doorstep.
  const H = (v) => ({ id: 'house', v });
  const HN = (wall, roof) => ({ id: 'house', v: { garden: false, wallColor: wall, roofColor: roof } });
  const H_BLUE = HN('#dfe6ea', '#4e6a7a');
  const H_CREAM = HN('#efe3c8', '#7a6a62');
  const H_SAGE = HN('#e2e8d8', '#5a6672');
  const H_PINK = HN('#f3e2dd', '#8f6a62');
  shelf({ face: '+z', edge: 47.9, a0: -29, a1: -19.2, district: 'residential', tag: 'home_lane_n',
    items: [H_BLUE] });
  shelf({ face: '+z', edge: 47.9, a0: -14.1, a1: -4.3, district: 'residential', tag: 'home_lane_n',
    items: [H_CREAM] });
  shelf({ face: '+z', edge: 47.9, a0: 4.3, a1: 14.1, district: 'residential', tag: 'home_lane_n',
    items: [H_SAGE] });
  shelf({ face: '+z', edge: 47.9, a0: 26, a1: 35.8, district: 'residential', tag: 'home_lane_n',
    items: [H_PINK] });
  place('house', -25, 61, Math.PI, H_BLUE.v, 'residential', 'home_lane_s');
  place('machiya', -12, 66, Math.PI, 'cream', 'residential', 'garden_row');
  place('machiya', 20, 59.55, Math.PI, 'sand', 'residential', 'home_lane_s');
  place('house', 32, 61, Math.PI, H_SAGE.v, 'residential', 'home_lane_s');
  // Machiya infill fronting Harbour Avenue where it enters the suburb.
  place('machiya', 9, 66, Math.PI, 'sand', 'residential', 'garden_row');
  // The west lane. There used to be a third house at (-38, 34): it left the
  // corner konbini wedged with 1.2 units either side, so it is now a garden
  // corner instead (dressed by the green pass below) and the konbini has room.
  place('konbini', -36, 35.2, Math.PI, null, 'residential', 'konbini');
  place('house', -42, 46, 0, H_CREAM.v, 'residential', 'west_lane');
  place('house', -38, 61, 0, H_PINK.v, 'residential', 'west_lane');
  place('house', 44, 58, 0, H_BLUE.v, 'residential', 'east_lane');

  // ---------------------------------------------------- NEON STREET (10) ---
  // One packed lane, both kerbs shoulder to shoulder, plus a festival square
  // on the gravel between the lane and the quay.
  // Kiba works the west kerb between z -51 and -40, so the west row starts
  // north of him and the festival square fills the gravel behind.
  shelf({ face: '+x', edge: 40.2, a0: -40, a1: -30, district: 'neon_street', tag: 'neon_w',
    items: [{ id: 'izakaya' }] });
  place('festivalStall', 31, -28, Math.PI / 2, 'prizes', 'neon_street', 'neon_w');
  shelf({ face: '-x', edge: 49.5, a0: -48, a1: -41, district: 'neon_street', tag: 'neon_e',
    items: [{ id: 'izakaya' }] });
  place('izakaya', 60.2, -36, Math.PI, null, 'neon_street', 'neon_e');
  place('yatai', 50, -28, 0, null, 'neon_street', 'neon_e');
  // Kiba's exotics: turned to face the lane so the customer stands on the kerb
  // with the open street at their back. Fronting north, as it did, buried the
  // camera in the izakaya behind it.
  place('festivalStall', 54.5, -34.3, -Math.PI / 2, 'goldfish', 'neon_street', 'neon_exotics');
  place('konbini', 61, -24, Math.PI, null, 'neon_street', 'neon_e');
  place('yatai', 60, -46, 0, null, 'neon_street', 'neon_e');
  place('yatai', 33, -45, Math.PI, null, 'neon_street', 'festival_square');
  place('yatai', 19, -41, 0, null, 'neon_street', 'festival_square');

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
  // Spacings are tuned to the compact street lengths: Market Road is 124 long,
  // not 260, so a 46-unit lamp spacing would give three lamps for the whole
  // town. Everything below is roughly one piece every 20-30 units per kerb.
  const LAMP = -Math.PI / 2;   // the lamp's arm points along its local +X
  scatterAlong('market_road', 'streetLamp', { spacing: 28, offset: 1.6, yawOffset: LAMP });
  scatterAlong('harbor_ave', 'streetLamp', { spacing: 30, offset: 1.6, yawOffset: LAMP });
  scatterAlong('quay', 'streetLamp', { spacing: 24, offset: 1.5, yawOffset: LAMP });
  scatterAlong('neon_lane', 'streetLamp', { spacing: 13, offset: 1.4, yawOffset: LAMP });
  scatterAlong('neon_cross', 'streetLamp', { spacing: 24, offset: 1.5, yawOffset: LAMP });
  scatterAlong('home_lane', 'streetLamp', { spacing: 24, offset: 1.5, yawOffset: LAMP });
  scatterAlong('tower_row', 'streetLamp', { spacing: 20, offset: 1.5, yawOffset: LAMP });

  scatterAlong('market_road', 'utilityPole', { spacing: 34, offset: 2.4, phase: 0.2 });
  scatterAlong('harbor_ave', 'utilityPole', { spacing: 38, offset: 2.4, phase: 0.35, sides: [1] });
  scatterAlong('home_lane', 'utilityPole', { spacing: 30, offset: 2.4, phase: 0.15, sides: [1] });
  scatterAlong('neon_lane', 'utilityPole', { spacing: 20, offset: 2.2, phase: 0.7, sides: [1] });
  scatterAlong('quay', 'utilityPole', { spacing: 30, offset: 2.2, phase: 0.6, sides: [1] });

  scatterAlong('market_road', 'planterBox', { spacing: 30, offset: 1.4, phase: 0.75 });
  scatterAlong('tower_row', 'planterBox', { spacing: 18, offset: 1.4, phase: 0.3 });
  scatterAlong('home_lane', 'hedge', { spacing: 18, offset: 2.0, phase: 0.6, districts: ['residential'] });
  scatterAlong('home_lane', 'bicycle', { spacing: 20, offset: 2.2, phase: 0.25, districts: ['residential'] });
  scatterAlong('home_lane', 'mailbox', { spacing: 22, offset: 1.5, phase: 0.9, districts: ['residential'] });
  scatterAlong('home_lane', 'cherryTree', { spacing: 22, offset: 3.2, phase: 0.45, districts: ['residential'] });
  scatterAlong('market_road', 'cherryTree', { spacing: 34, offset: 3.2, phase: 0.35, districts: ['old_market'] });
  scatterAlong('tower_row', 'cherryTree', { spacing: 24, offset: 3.0, phase: 0.65, districts: ['downtown'] });
  scatterAlong('canal_walk', 'cherryTree', { spacing: 9, offset: 1.3, phase: 0.5, jitter: 0.3, sides: [1] });
  scatterAlong('lane_back', 'pottedPlant', { spacing: 9, offset: 0.9, jitter: 0.3 });
  scatterAlong('lane_market', 'pottedPlant', { spacing: 8, offset: 0.9, jitter: 0.3 });
  scatterAlong('lane_shrine', 'bonsai', { spacing: 6, offset: 0.9, jitter: 0.25 });
  scatterAlong('market_road', 'benchWood', { spacing: 44, offset: 1.5, phase: 0.5 });
  scatterAlong('tower_row', 'benchWood', { spacing: 26, offset: 1.5, phase: 0.85 });
  scatterAlong('quay', 'benchWood', { spacing: 30, offset: 1.5, phase: 0.4, sides: [1] });
  scatterAlong('market_road', 'trashBins', { spacing: 46, offset: 1.5, phase: 0.15 });
  scatterAlong('neon_lane', 'trashBins', { spacing: 22, offset: 1.4, phase: 0.55 });
  scatterAlong('tower_row', 'vendingMachine', { spacing: 24, offset: 1.5, phase: 0.6 });
  scatterAlong('neon_lane', 'vendingMachine', { spacing: 18, offset: 1.4, phase: 0.3 });
  scatterAlong('home_lane', 'vendingMachine', { spacing: 34, offset: 1.5, phase: 0.7, sides: [-1] });
  scatterAlong('tower_row', 'bicycleRack', { spacing: 26, offset: 1.7, phase: 0.4, sides: [1] });
  scatterAlong('quay', 'trafficCone', { spacing: 22, offset: 1.3, phase: 0.2, jitter: 1.0, sides: [1] });

  // Ground decals — lifted above the road surface so they read.
  scatterAlong('market_road', 'manholeCover', { spacing: 34, offset: -2.2, phase: 0.3, y: 0.1, jitter: 0.4 });
  scatterAlong('harbor_ave', 'manholeCover', { spacing: 38, offset: -2.2, phase: 0.6, y: 0.1, jitter: 0.4, sides: [1] });
  scatterAlong('market_road', 'gutterGrate', { spacing: 28, offset: 0.2, phase: 0.8, y: 0.1, jitter: 0.2 });
  scatterAlong('home_lane', 'gutterGrate', { spacing: 26, offset: 0.2, phase: 0.4, y: 0.1, jitter: 0.2 });

  // Zebra crossings on every approach to every road intersection.
  for (const it of intersections) {
    for (const r of [it.a, it.b]) {
      const alongX = r.w >= r.d;
      const halfLong = (alongX ? r.w : r.d) / 2;
      const other = r === it.a ? it.b : it.a;
      const halfOther = (alongX ? other.d : other.w) / 2;
      const back = halfOther + 2.6;
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

  // Old Market: the shrine precinct at the foot of Shrine Walk. The three
  // foraging beds at (-53,4), (-50,8.5) and (-47,11.9) are the reason the yard
  // is open ground — nothing here may sit on top of them.
  prop('torii', -51, 5.5, 0, { scale: 1.4 });
  prop('torii', -51, 10.5, 0, { scale: 1.15 });
  prop('shrineOffering', -51, 16.5, Math.PI);
  prop('komaInu', -53.6, 14.4, Math.PI, { scale: 1.2 });
  prop('komaInu', -48.4, 14.4, Math.PI, { scale: 1.2 });
  for (const [lx, lz] of [[-53.8, 7.6], [-48.2, 7.6], [-53.8, 12.2], [-48.2, 12.2]]) {
    prop('stoneLantern', lx, lz, 0);
  }
  prop('pineTree', -56.5, 13.5, 0, { scale: 1.25 });
  prop('pineTree', -45.5, 6.6, 0);
  prop('cherryTree', -47.5, 17.8, 0, { scale: 1.15 });

  // Lantern Alley: banners down both kerbs and strings strung across it.
  for (let i = 0; i < 3; i++) {
    sway.push(prop('nobori', -33.9, 8 + i * 6, Math.PI / 2));
    sway.push(prop('nobori', -29.1, 11 + i * 6, -Math.PI / 2));
  }
  for (const lz of [9, 16, 23]) prop('lanternString', -31.5, lz, Math.PI / 2, { scale: 0.62 });
  // Noren hung 0.15 proud of the actual machiya facades.
  for (const [nx, nz, ny] of [[-33.3, -4.15, 0], [-8.55, -4.15, 0],
    [-50, -11.05, 0], [-41.5, -11.05, 0], [-40, 4.15, Math.PI]]) {
    sway.push(prop('noren', nx, nz, ny));
  }
  // Market square dressing.
  for (const [sx, sz] of [[-30.5, 9.5], [-24.5, 15.5], [-38.5, 17.5], [-33, 3.2]]) {
    prop('fruitCrate', sx, sz, rng() * Math.PI * 2);
  }
  // Barrels and the west stall are 4+ units apart: they used to leave a
  // 1.7-unit slot between them at the mouth of the square.
  prop('sakeBarrelStack', -46.6, 13.5, Math.PI / 2);
  prop('woodenStall', -44.5, 13.5, Math.PI / 2);
  prop('ramenBowlSign', -33.3, -4.4, 0);
  prop('signPost', -14.5, 6.2, 0.2);
  prop('signPost', 6.5, -6.4, -0.3);

  // ---- THE HOME PLAZA -----------------------------------------------------
  // The first thing every player sees: a 17 x 30 paved square wrapped by Market
  // Road, Harbour Avenue and two building rows. It is dressed down BOTH FLANKS
  // and left open down the middle, because three things run through the middle:
  //   · the walk from HOME.spawn (-12, 19) to the shop door (-12, 15);
  //   · HOME.board at (-5, 17), which needs its 2.6-unit reach clear;
  //   · CAM_KEEP — the chase camera hangs over (-12, 28) on a new game.
  // Everything with a collider taller than CAM_LOW therefore lives at x <= -19
  // or x >= -6.1; the middle carries only planters, potted plants, flat paving
  // and the overhead lantern runs (which have no collider at all). `plazaProp`
  // enforces that, so a careless edit fails the build loudly instead of quietly
  // parking a wall in front of the opening shot.
  // Footprints of the props that carry a collider, at yaw 0, taken from
  // props.js. Only the ones the plaza uses need to be here.
  const PROP_FOOT = {
    hedge: { w: 3.1, d: 0.7, h: 0.85 }, benchWood: { w: 1.8, d: 0.56, h: 0.95 },
    cherryTree: { w: 0.7, d: 0.7, h: 2.0 }, pineTree: { w: 0.75, d: 0.75, h: 2.8 },
    woodenStall: { w: 3.6, d: 2.2, h: 2.5 }, lanternPost: { w: 0.42, d: 0.42, h: 2.5 },
    signPost: { w: 0.34, d: 0.34, h: 2.5 }, trashBins: { w: 1.92, d: 0.59, h: 0.82 },
    bicycleRack: { w: 1.9, d: 0.3, h: 0.7 }, bicycle: { w: 0.5, d: 1.7, h: 1.0 },
    vendingMachine: { w: 0.7, d: 1.0, h: 1.9 }, stoneLantern: { w: 0.8, d: 0.8, h: 1.6 },
    sakeBarrelStack: { w: 1.98, d: 0.72, h: 1.32 }, stoneWall: { w: 3.4, d: 0.64, h: 0.68 },
    planterBox: { w: 1.6, d: 0.6, h: 0.5 }, pottedPlant: { w: 0.57, d: 0.57, h: 0.5 },
    fruitCrate: { w: 0.8, d: 0.6, h: 0.44 },
  };
  /**
   * Place a plaza prop, refusing anything over CAM_LOW that lands in the
   * camera's keep-out disc or the spawn lane. Anything flat or knee-high (and
   * anything with no collider at all — lantern strings, noren, paper lanterns)
   * goes through untouched: those are the things that dress the middle.
   */
  function plazaProp(id, x, z, yaw = 0, extra) {
    const f = PROP_FOOT[id];
    if (f && f.h > CAM_LOW) {
      const horiz = Math.abs(Math.sin(yaw)) > 0.5;
      const hx = (horiz ? f.d : f.w) / 2;
      const hz = (horiz ? f.w : f.d) / 2;
      const dx = Math.max(0, Math.abs(x - CAM_KEEP.x) - hx);
      const dz = Math.max(0, Math.abs(z - CAM_KEEP.z) - hz);
      const why = Math.hypot(dx, dz) < CAM_KEEP.r ? 'inside the camera keep-out'
        : (x + hx > CAM_LANE.x0 && x - hx < CAM_LANE.x1
          && z + hz > CAM_LANE.z0 && z - hz < CAM_LANE.z1) ? 'inside the camera lane' : null;
      if (why) { rejects.push({ id, x, z, district: 'old_market', tag: 'plaza', why }); return null; }
    }
    return prop(id, x, z, yaw, extra);
  }

  // -- west flank ------------------------------------------------------------
  // North of z = 19 the flank is wide (the machiya behind it starts at z=17.9),
  // so it carries the solid furniture: the hedge line, the bike rack and the
  // noren-hung side stall. South of that the walkway between the machiya and
  // the square is only ~3 units, so it carries point obstacles only — trees,
  // benches and lantern posts, which you walk around rather than along.
  plazaProp('hedge', -19.8, 6.5, Math.PI / 2);
  plazaProp('hedge', -19.8, 9.0, Math.PI / 2);
  plazaProp('bicycleRack', -19.0, 11.8, -Math.PI / 2);
  plazaProp('bicycle', -18.1, 11.2, -Math.PI / 2);
  plazaProp('bicycle', -18.1, 12.5, -Math.PI / 2);
  plazaProp('woodenStall', -18.8, 15.6, Math.PI / 2);
  sway.push(prop('noren', -17.6, 15.6, Math.PI / 2));
  plazaProp('fruitCrate', -17.3, 17.9, 0.4);
  plazaProp('benchWood', -19.6, 20.6, Math.PI / 2);
  plazaProp('cherryTree', -19.8, 23.8, 0.4, { scale: 1.2 });
  plazaProp('cherryTree', -19.8, 27.4, -0.3, { scale: 1.1 });
  plazaProp('benchWood', -19.6, 30.6, Math.PI / 2);
  plazaProp('lanternPost', -19.9, 33.6, Math.PI / 2);

  // -- east flank: the job-board side, kept walkable around HOME.board -------
  plazaProp('cherryTree', -6.6, 14.2, -0.5, { scale: 1.1 });
  plazaProp('lanternPost', -6.1, 8.6, -Math.PI / 2);
  plazaProp('benchWood', -7.0, 20.6, Math.PI);
  plazaProp('signPost', -6.2, 23.4, 0.3);
  plazaProp('pottedPlant', -6.4, 27.4, 0);
  plazaProp('lanternPost', -5.8, 32.6, -Math.PI / 2);

  // -- south edge: an avenue of cherry trees closing the square, far enough
  //    back (z >= 35.4) to stay clear of the camera disc, and all point
  //    obstacles so the walk through to Home Lane never narrows.
  plazaProp('cherryTree', -18.4, 35.8, 0.2, { scale: 1.15 });
  plazaProp('cherryTree', -13.0, 36.4, -0.4, { scale: 1.25 });
  plazaProp('cherryTree', -7.6, 35.8, 0.6, { scale: 1.1 });
  plazaProp('lanternPost', -15.8, 36.6, 0);
  plazaProp('lanternPost', -10.2, 36.6, 0);
  plazaProp('pottedPlant', -16.9, 33.4, 0);
  plazaProp('pottedPlant', -7.1, 33.4, 0);

  // -- the middle: only knee-high planting, and lanterns strung overhead -----
  plazaProp('planterBox', -15.6, 17.6, 0);
  plazaProp('planterBox', -8.4, 17.6, 0);
  plazaProp('pottedPlant', -14.4, 20.4, 0);
  plazaProp('pottedPlant', -9.6, 20.4, 0);
  plazaProp('planterBox', -15.8, 26.6, 0);
  plazaProp('planterBox', -8.2, 26.6, 0);
  plazaProp('pottedPlant', -13.4, 31.4, 0);
  plazaProp('pottedPlant', -10.6, 31.4, 0);
  // Lantern strings and paper lanterns: no colliders, so they dress the middle
  // and the camera flies straight under them.
  for (const lz of [20.4, 25.2, 30.0]) prop('lanternString', -12, lz, 0, { scale: 1.05 });
  for (const [px, pz] of [[-16.6, 23.6], [-7.4, 29.2], [-17.0, 30.6]]) prop('paperLantern', px, pz, 0);

  // ---- Fish Harbour: crates, pilings, ropes, boats, gulls ------------------
  for (let i = 0; i < 7; i++) {
    const x = -26 + i * 8 + (rng() - 0.5) * 1.6;
    prop('fishCrate', x, -51.4 + (rng() - 0.5) * 1.2, rng() * 0.5 - 0.25);
    if (i % 2 === 0) prop('fishCrate', x + 1.1, -50.4, rng() * 0.5);
  }
  for (const bx of [-27, 4, 21]) {
    prop('barrel', bx, -51.6, 0);
    prop('barrel', bx + 0.9, -50.6, 0);
  }
  for (const p of PIERS) {
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        prop('dockPiling', p.x + sx * (p.w / 2 + 0.8), p.z0 + 1.6 + i * (p.z1 - p.z0 - 3.4), 0, { y: -0.3 });
      }
    }
    prop('mooringRope', p.x + p.w / 2 - 0.4, p.z0 + 2.6, Math.PI / 2, { y: DECK_Y });
    prop('fishCrate', p.x, p.z1 - 1.6, 0.3, { y: DECK_Y });
    prop('fishCrate', p.x - 0.9, p.z1 - 2.8, -0.2, { y: DECK_Y });
  }
  for (const [bx, bz, byaw] of [[-19, -65, 0.12], [-2.5, -71.5, -0.08], [9, -66, 0.05], [21, -68, -0.14]]) {
    prop('fishingBoat', bx, bz, byaw, { y: -0.34 });
  }
  for (let i = 0; i < 4; i++) {
    gulls.push(prop('seagull', -18 + i * 13, -66 - rng() * 5, rng() * Math.PI * 2, { y: 3.0 + rng() * 2.5 }));
  }
  prop('seagull', -24, -51.5, 1.2, { y: 0 });
  prop('seagull', 12, -51.6, -0.7, { y: 0 });
  for (const nx of [-24, -12, 6, 20]) sway.push(prop('nobori', nx, -51.8, Math.PI));
  prop('pineTree', -30, -24, 0, { scale: 1.15 });
  prop('pineTree', 6, -24, 0);
  prop('signPost', 5.5, -22, 0.2);

  // ---- Downtown: canal walk, station forecourt, office frontages -----------
  for (let i = 0; i < 3; i++) prop('benchWood', 52.2, 28 + i * 5, -Math.PI / 2);
  prop('signPost', 35, 5.5, 0);
  for (const [vx, vz] of [[19, 12], [44.6, 3], [53.4, 24]]) prop('vendingMachine', vx, vz, Math.PI);
  for (let i = 0; i < 3; i++) prop('acUnit', 44.1, -14 + i * 3.2, -Math.PI / 2);
  prop('bicycleRack', 27, 13.5, 0);
  for (let i = 0; i < 4; i++) prop('bicycle', 25.4 + i * 1.4, 13.4, (rng() - 0.5) * 0.2);
  prop('planterBox', 20, 13.6, 0);
  prop('planterBox', 34, 13.6, 0);

  // ---- Residential: gardens, bikes, hedges, mailboxes ---------------------
  for (let i = 0; i < 6; i++) {
    const x = -26 + i * 11;
    if (Math.abs(x) < 6) continue;
    prop('hedge', x, 37.2, 0, { scale: 1.05 });
  }
  for (const cx of [-30, -18, 4, 24]) prop('cherryTree', cx, 68, 0, { scale: 1.05 + rng() * 0.2 });
  for (let i = 0; i < 4; i++) prop('bicycle', -22 + i * 13, 56.6, Math.PI + (rng() - 0.5) * 0.4);
  prop('benchWood', -4, 42, Math.PI);
  prop('benchWood', 2, 42, Math.PI);
  prop('pottedPlant', -6.5, 44.4, 0);
  prop('bonsai', 6, 44, 0);
  prop('kotatsu', -33, 52, 0);
  for (let i = 0; i < 3; i++) prop('pineTree', -34 + i * 12, 70, 0, { scale: 1.1 });

  // ---- Neon Food Street: lantern strings, noren, barrels, signs -----------
  for (let i = 0; i < 6; i++) prop('lanternString', 44, -56 + i * 6.4, 0, { scale: 1.2, y: 0 });
  for (let i = 0; i < 3; i++) {
    sway.push(prop('noren', 40.35, -38 + i * 5, Math.PI / 2));
    sway.push(prop('noren', 49.35, -46 + i * 5, -Math.PI / 2));
  }
  for (let i = 0; i < 3; i++) sway.push(prop('nobori', 40.9, -50 + i * 7, Math.PI / 2));
  for (let i = 0; i < 2; i++) prop('ramenBowlSign', 49.4, -44 + i * 6, -Math.PI / 2);
  for (let i = 0; i < 2; i++) prop('sakeBarrelStack', 40.9, -35 + i * 7, Math.PI / 2);
  for (let i = 0; i < 4; i++) prop('paperLantern', 41.2 + (i % 2) * 6, -52 + i * 4, 0);
  // Festival square, on the gravel between the lane and the quay.
  for (let i = 0; i < 3; i++) prop('lanternString', 33, -52 + i * 4, Math.PI / 2, { scale: 1.0 });
  prop('woodenStall', 28, -50, Math.PI / 2);
  for (let i = 0; i < 3; i++) prop('barrel', 30 + i * 2.4, -54, 0);
  prop('signPost', 45.5, -20, 0);

  // Gap-filler greenery so no zone butts onto bare ground.
  const GREEN_BANDS = [
    { x0: -20, x1: 14, z0: -24, z1: -12, n: 5, ids: ['pineTree', 'hedge', 'cherryTree'] },
    { x0: 6, x1: 22, z0: 12, z1: 30, n: 5, ids: ['cherryTree', 'hedge', 'benchWood'] },
    { x0: -46, x1: -32, z0: 34, z1: 46, n: 4, ids: ['cherryTree', 'pineTree', 'hedge'] },
    { x0: 18, x1: 34, z0: 38, z1: 50, n: 4, ids: ['cherryTree', 'hedge'] },
    { x0: 52, x1: 66, z0: -18, z1: 2, n: 4, ids: ['pineTree', 'hedge'] },
    { x0: -34, x1: -18, z0: -40, z1: -26, n: 4, ids: ['pineTree', 'hedge', 'benchWood'] },
    { x0: 6, x1: 22, z0: -38, z1: -26, n: 3, ids: ['pineTree', 'hedge'] },
    { x0: 34, x1: 44, z0: 44, z1: 62, n: 4, ids: ['cherryTree', 'hedge', 'benchWood'] },
    { x0: -46, x1: -34, z0: -30, z1: -16, n: 3, ids: ['hedge', 'pineTree'] },
    // The garden corner where the third west-lane house used to stand.
    { x0: -42, x1: -32, z0: 28, z1: 42, n: 4, ids: ['cherryTree', 'pineTree', 'hedge', 'benchWood'] },
  ];
  /** The chase camera's keep-out disc behind the spawn (see CAM_KEEP). */
  const inCamKeep = (x, z, pad = 0) =>
    Math.hypot(x - CAM_KEEP.x, z - CAM_KEEP.z) < CAM_KEEP.r + pad;
  const placedGreen = [];
  for (const b of GREEN_BANDS) {
    for (let i = 0; i < b.n; i++) {
      const x = b.x0 + rng() * (b.x1 - b.x0);
      const z = b.z0 + rng() * (b.z1 - b.z0);
      if (onPaving(x, z, 1.6) || inWater(x, z, 2) || inRect(x, z, PLAZA_KEEP)) continue;
      if (inCamKeep(x, z, 1.6)) continue;
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
      || inRect(x, z, PLAZA_KEEP) || inCamKeep(x, z, 2)
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
    const CORE_BOX = { x0: -66, x1: 70, z0: WORLD.waterZ, z1: 78 };
    const barFor = (x, z) => (inRect(x, z, CORE_BOX) ? 13.5 : 15.0);
    const STEP = 6;
    // Two budgets, because the two jobs are different sizes: the city core is
    // dressed properly, and whatever is left over is spent breaking up the
    // outskirts. Together they stay well inside the prop budget.
    const CORE_BUDGET = 44;
    const BUDGET = 76;

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
      { x0: -B0 + 4, x1: -68, z0: WORLD.waterZ + 8, z1: B0 - 4 },     // west
      { x0: 72, x1: B0 - 4, z0: WORLD.waterZ + 8, z1: B0 - 4 },       // east
      { x0: -68, x1: 72, z0: 80, z1: B0 - 4 },                        // south
    ];
    for (const s of STRIPS) {
      for (let x = s.x0 + 8; x <= s.x1; x += 18) {
        for (let z = s.z0 + 8; z <= s.z1; z += 18) {
          const fx = x + (rng() - 0.5) * 9;
          const fz = z + (rng() - 0.5) * 9;
          if (inWater(fx, fz, 8) || onPaving(fx, fz, 4)) continue;
          patchParts.push(roundedRect(fx, fz, 18 + rng() * 12, 16 + rng() * 10, 5,
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
    label: GAME.title, icon: '🍣', district: 'old_market', kind: 'shop',
  });
  addPoi({
    id: 'home_bed', x: HOME.bed.x, z: HOME.bed.z,
    label: 'Your Bed', icon: '🛏️', district: 'old_market', kind: 'home',
  });
  addPoi({
    id: 'delivery_board', x: HOME.board.x, z: HOME.board.z,
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
    { id: 'lm_shrine', x: -51, z: 16, label: 'Little Shrine', icon: '⛩️', district: 'old_market' },
    { id: 'lm_torii', x: -51, z: 5.5, label: 'Shrine Gate', icon: '⛩️', district: 'old_market' },
    { id: 'lm_tea_house', x: -40, z: 22, label: 'Tea House', icon: '🍵', district: 'old_market' },
    { id: 'lm_bathhouse', x: -54, z: 24.5, label: 'Bathhouse', icon: '♨️', district: 'old_market' },
    { id: 'lm_market_square', x: -31, z: 12, label: 'Market Square', icon: '🏮', district: 'old_market' },
    { id: 'lm_fish_market', x: -17, z: -28, label: 'Fish Market Hall', icon: '🐟', district: 'fish_harbor' },
    { id: 'lm_docks', x: -10, z: -64, label: 'The Docks', icon: '⚓', district: 'fish_harbor' },
    { id: 'lm_station', x: 27, z: 22, label: 'Central Station', icon: '🚉', district: 'downtown' },
    { id: 'lm_tower_row', x: 40, z: 6, label: 'Tower Row', icon: '🏙️', district: 'downtown' },
    { id: 'lm_canal', x: 48, z: 33, label: 'Tower Canal', icon: '🌊', district: 'downtown' },
    { id: 'lm_home_lane', x: 0, z: 52, label: 'Home Lane', icon: '🏡', district: 'residential' },
    { id: 'lm_festival', x: 33, z: -50, label: 'Festival Square', icon: '🎆', district: 'neon_street' },
    { id: 'lm_neon_lane', x: 44, z: -38, label: 'Neon Lane', icon: '🏮', district: 'neon_street' },
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
    mkSign(40.35, -33, -Math.PI / 2, 3.0, 1.3, '#ff6aa8');
    mkSign(49.4, -32, Math.PI / 2, 2.8, 1.2, '#6ad8ff');
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
  let drawCalls = 0;
  group.traverse((o) => {
    if (!o.isMesh) return;
    drawCalls++;
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
    drawCalls,
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
    _water: WATER,
    _lanes: LANES,
    _rejects: rejects,
    _props: props,
    _fill: fill,
    _stats: {
      buildings: built.count, props: propBuilt.count, instancedMeshes,
      colliders: colliders.length, triangles, drawCalls, byDistrict,
    },
  };
}

export default createWorld;
