import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  makeFacadeSet,
  facadeTextures,
  makeGroundTexture,
  makeRoadTexture,
  makeToonGradient,
  makeVerticalSign,
  makeBillboard,
  makeStorefrontSign,
  makeStationSign,
  makeBarkTexture,
  makeFoliageTexture,
  makeParkGrassTexture,
  makeStuccoTexture,
  makeBrickTexture,
} from './textures.js';
import { buildShops, SHOP_TYPES, SIZE_SCALE } from './shops/index.js';
import { box, cyl, blob, merge, C } from './shops/common.js';
import { strut } from './landmarks/common.js';

// ---------------------------------------------------------------------------
// MRT train — a modular low-poly (toon-styled) EMU: a rounded, tapered nose car
// with a sloped windshield + headlights, curved/beveled bodies with a row of
// passenger windows, sliding doors, a coloured livery stripe, roof AC units +
// pantograph, and gangways between cars. Geometry is reused: one merged geo per
// car TYPE (nose / plain middle / pantograph middle), shared across the cars.
// Returns { cars:[Group], carDoors:[[{mesh,sign,base}]] } — drop-in for the
// existing beam-follow + door-slide animation.
// ---------------------------------------------------------------------------
function buildTrain({ carLen, carW, carH, CARS, monoMat, monoGlowMat }) {
  const half = carLen / 2, rW = carW / 2, roofY = 4.2, roofTop = roofY + rW;
  const LIVERY = '#e9edf0', STRIPE = '#3a8f86', ACCENT = '#e6c063', SKIRT = '#565c64',
    EQUIP = '#8a9099', DARK = '#232a33', GANG = '#2b3038', GLOW = '#cfe6ff';
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8, toneMapped: false }); // headlights glow

  // One sliding door leaf (panel + aligned window), reused for every door.
  const doorLeafGeo = merge([
    box(0.16, 3.6, 1.2, 0, 2.0, 0, '#dfe4e8'),   // panel (floor → above window)
    box(0.1, 1.0, 0.9, 0.05, 3.5, 0, DARK),      // door window, aligned with the passenger row
  ]);

  // Merge one car's whole body into a single geo (+ a separate window-glow geo).
  function carGeo(isNose, hasPanto) {
    const body = [], glow = [];
    // Beveled body + rounded (cylindrical) roof.
    body.push(box(carW, roofY, carLen, 0, roofY / 2, 0, LIVERY));
    body.push(cyl(rW, rW, carLen, 12, 0, roofY, 0, LIVERY, [Math.PI / 2, 0, 0]));  // curved roof
    body.push(box(carW - 0.3, 0.5, carLen - 0.2, 0, 0.28, 0, SKIRT));              // underframe skirt
    // Coloured livery stripe + a thin pin-stripe accent.
    body.push(box(carW + 0.04, 0.55, carLen * 0.985, 0, 2.7, 0, STRIPE));
    body.push(box(carW + 0.06, 0.1, carLen * 0.985, 0, 3.05, 0, ACCENT));
    // Passenger windows: a glowing band, framed, split by mullions into panes.
    const winY = 3.75;
    const winLen = isNose ? carLen - 5.6 : carLen - 1.5;
    const winC = isNose ? (-half + 0.75 + winLen / 2) : 0;
    glow.push(box(carW + 0.02, 1.0, winLen, 0, winY, winC, GLOW));
    body.push(box(carW + 0.06, 0.16, winLen + 0.1, 0, winY + 0.55, winC, DARK));   // top frame
    body.push(box(carW + 0.06, 0.16, winLen + 0.1, 0, winY - 0.55, winC, DARK));   // bottom frame
    const nMul = Math.max(2, Math.round(winLen / 1.9));
    for (let m = 0; m <= nMul; m++) {
      body.push(box(carW + 0.08, 1.15, 0.16, 0, winY, winC - winLen / 2 + winLen * (m / nMul), DARK));
    }
    // Roof AC units + gangway rings (rear always; front only on plain middles).
    for (const zz of [-carLen * 0.26, carLen * 0.26]) body.push(box(1.5, 0.55, 1.3, 0, roofTop - 0.05, zz, EQUIP));
    body.push(box(carW * 0.72, carH * 0.55, 0.8, 0, carH * 0.32, -half - 0.3, GANG));
    if (!isNose) body.push(box(carW * 0.72, carH * 0.55, 0.8, 0, carH * 0.32, half + 0.3, GANG));
    // Aerodynamic nose: tapered cone + rounded tip + sloped windshield + stripe.
    if (isNose) {
      body.push(cyl(1.5, rW + 0.05, 3.2, 12, 0, 2.4, half + 1.0, LIVERY, [Math.PI / 2, 0, 0]));
      body.push(blob(1.2, 0, 2.4, half + 2.6, LIVERY));
      body.push(box(2.6, 0.24, 2.6, 0, 4.35, half + 0.5, DARK, [-0.6, 0, 0]));     // sloped windshield
      body.push(box(2.6, 0.55, 1.1, 0, 2.4, half + 2.1, STRIPE));                  // nose livery flash
    }
    // Pantograph — a folded arm + contact bar.
    if (hasPanto) {
      const pz = carLen * 0.12;
      body.push(box(0.9, 0.18, 0.9, 0, roofTop + 0.05, pz, EQUIP));
      body.push(box(0.1, 1.4, 0.1, -0.3, roofTop + 0.7, pz - 0.2, EQUIP, [0.5, 0, 0]));
      body.push(box(0.1, 1.4, 0.1, 0.3, roofTop + 0.7, pz + 0.2, EQUIP, [-0.5, 0, 0]));
      body.push(box(1.9, 0.1, 0.14, 0, roofTop + 1.45, pz, EQUIP));
    }
    return { bodyGeo: merge(body), glowGeo: merge(glow) };
  }

  const noseGeos = carGeo(true, false);
  const midGeos = carGeo(false, false);
  const pantoGeos = carGeo(false, true);

  const cars = [], carDoors = [];
  for (let i = 0; i < CARS; i++) {
    const car = new THREE.Group();
    const g = i === 0 ? noseGeos : i === 1 ? pantoGeos : midGeos; // reuse midGeos for the rest
    const bodyMesh = new THREE.Mesh(g.bodyGeo, monoMat);
    bodyMesh.castShadow = true;
    car.add(bodyMesh, new THREE.Mesh(g.glowGeo, monoGlowMat));
    if (i === 0) { // headlights on the nose
      for (const hx of [-1.0, 1.0]) {
        const hl = new THREE.Mesh(box(0.5, 0.35, 0.2, 0, 0, 0, '#fff2c8'), headMat);
        hl.position.set(hx, 1.7, half + 2.7);
        car.add(hl);
      }
    }
    // One sliding doorway per side (two leaves), shifted back from the cab on the nose car.
    const doorZ = i === 0 ? -carLen * 0.18 : 0;
    const doors = [];
    for (const sx of [rW + 0.06, -(rW + 0.06)]) {
      for (const s of [1, -1]) {
        const base = doorZ + s * 0.65;
        const d = new THREE.Mesh(doorLeafGeo, monoMat);
        d.position.set(sx, 0, base);
        car.add(d);
        doors.push({ mesh: d, sign: s, base });
      }
    }
    carDoors.push(doors);
    cars.push(car);
  }
  return { cars, carDoors };
}

// A tiny seeded RNG so the city looks the same every reload (deterministic).
// Change the seed to regenerate a different city layout.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds the whole cartoon city and returns
 * { group, colliders, bounds, windTime, grass, spawn }.
 * `colliders` is a list of axis-aligned building boxes used for walk collision.
 * `windTime` is a shared uniform the animation loop advances to sway the grass
 * and tree canopies. `grass` is the instanced lawn; `spawn` a clear start point.
 */
export function buildCity(scene, opts = {}) {
  const {
    blocks = 8,          // number of city blocks per side (blocks x blocks)
    blockSize = 34,      // world units per block (building footprint area)
    road = 12,           // road width between blocks
    seed = 1337,
  } = opts;

  const rng = mulberry32(seed);
  const group = new THREE.Group();
  const colliders = [];
  const parkAreas = []; // {cx, cz, size} — filled as parks are generated
  const buildingMats = []; // facade materials whose windows light up at night
  const mapRoads = [];     // {cx,cz,w,d} road rects for the minimap
  const footprints = [];   // {x0,z0,x1,z1} building footprints for the minimap

  // Shared cel-shading ramp — every toon material samples this so the whole
  // city bands its light identically. 4 steps = crisp low-poly cartoon look.
  const gradientMap = makeToonGradient(4);

  const stride = blockSize + road;
  const total = blocks * stride;
  const half = total / 2;

  // ---- Central park region -----------------------------------------------
  // The central 2x2 blocks (and the road between them) become one big park.
  const parkB0 = Math.floor(blocks / 2) - 1; // first park block index
  const parkB1 = Math.floor(blocks / 2);     // last park block index
  const centralRoadIdx = Math.floor(blocks / 2); // road that runs through the park
  const parkMinX = -half + parkB0 * stride;
  const parkMaxX = -half + parkB1 * stride + blockSize;
  const parkMinZ = parkMinX;
  const parkMaxZ = parkMaxX;
  const parkCX = (parkMinX + parkMaxX) / 2;
  const parkCZ = (parkMinZ + parkMaxZ) / 2;
  const parkRingR = 15;      // ring path radius around the centerpiece
  const parkPathHalf = 3.2;  // half-width of the cross paths
  const parkCenterKeep = 13; // keep-clear radius for the fountain / statue
  const parkBlock = (bx, bz) =>
    bx >= parkB0 && bx <= parkB1 && bz >= parkB0 && bz <= parkB1;
  const inPark = (x, z) => x >= parkMinX && x <= parkMaxX && z >= parkMinZ && z <= parkMaxZ;
  function onParkPath(x, z) {
    const dx = x - parkCX;
    const dz = z - parkCZ;
    if (Math.abs(dx) < parkPathHalf || Math.abs(dz) < parkPathHalf) return true; // cross paths
    return Math.abs(Math.hypot(dx, dz) - parkRingR) < 2.6; // ring path
  }
  // Where a tree/bench/grass may go inside the park: off the paths and clear of
  // the central fountain/statue.
  const parkPlantable = (x, z) =>
    Math.hypot(x - parkCX, z - parkCZ) >= parkCenterKeep && !onParkPath(x, z);

  // Reserve one whole block for the signature landmark tower (built in
  // landmarks/). It's skipped in the building loop and given a collider so no
  // trees / vendors / the player wander into its footprint.
  const towerBX = 5; // clear of the MRT station reserved blocks (station E uses col 6)
  const towerBZ = 4;
  const towerSpot = new THREE.Vector3(
    -half + towerBX * stride + blockSize / 2,
    0,
    -half + towerBZ * stride + blockSize / 2
  );
  colliders.push(
    new THREE.Box3(
      new THREE.Vector3(towerSpot.x - 12, 0, towerSpot.z - 12),
      new THREE.Vector3(towerSpot.x + 12, 190, towerSpot.z + 12)
    )
  );

  // ---- Ground plane -------------------------------------------------------
  // Just a small strip of land around the city — the ocean owns everything
  // beyond it (see environment.js).
  const groundTex = makeGroundTexture();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(total + 52, total + 52), // land: just a thin margin past the city
    new THREE.MeshToonMaterial({ map: groundTex, gradientMap })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // ---- Roads (a grid of strips) ------------------------------------------
  // Every road is a single flat plane at ONE consistent height just above the
  // ground. polygonOffset biases the road's depth toward the camera so it sits
  // cleanly on the ground with no z-fighting shimmer at any distance. Where the
  // grids cross, the horizontal set gets a slightly stronger bias so exactly one
  // plane wins the depth test — no two coplanar surfaces fighting.
  const roadTex = makeRoadTexture();
  const ROAD_LEVEL = 0.05; // small, consistent offset above the ground
  const roadMat = new THREE.MeshToonMaterial({
    map: roadTex,
    gradientMap,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const roadMatH = roadMat.clone(); // shares the texture; stronger bias for crossings
  roadMatH.polygonOffsetFactor = -4;
  roadMatH.polygonOffsetUnits = -8;

  const roadEnd = half + road / 2; // roads span [-roadEnd, roadEnd]
  // Build one road strip: `vertical` runs along Z at x=cross (else along X at z=cross).
  function addRoadStrip(mat, vertical, cross, a, b) {
    const len = b - a;
    if (len <= 0.5) return;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(road, len), mat);
    m.rotation.x = -Math.PI / 2;
    if (vertical) {
      m.position.set(cross, ROAD_LEVEL, (a + b) / 2);
      mapRoads.push({ cx: cross, cz: (a + b) / 2, w: road, d: len });
    } else {
      m.rotation.z = Math.PI / 2;
      m.position.set((a + b) / 2, ROAD_LEVEL, cross);
      mapRoads.push({ cx: (a + b) / 2, cz: cross, w: len, d: road });
    }
    m.receiveShadow = true;
    group.add(m);
  }
  for (let i = 0; i <= blocks; i++) {
    const c = -half + i * stride - road / 2; // road center coordinate
    if (i === centralRoadIdx) {
      // The central road is broken by the park — build the two segments outside it.
      addRoadStrip(roadMat, true, c, -roadEnd, parkMinZ);
      addRoadStrip(roadMat, true, c, parkMaxZ, roadEnd);
      addRoadStrip(roadMatH, false, c, -roadEnd, parkMinX);
      addRoadStrip(roadMatH, false, c, parkMaxX, roadEnd);
    } else {
      addRoadStrip(roadMat, true, c, -roadEnd, roadEnd);
      addRoadStrip(roadMatH, false, c, -roadEnd, roadEnd);
    }
  }

  // ---- Buildings ----------------------------------------------------------
  // Reuse a single box geometry; each building scales it. Cheap and fast.
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  // Buildings + trees are collected here and merged into InstancedMeshes after
  // the layout loop, so the whole skyline/greenery costs a handful of draw calls
  // instead of hundreds (identical geometry, just batched).
  const buildingBatch = new Map(); // facade material -> [Matrix4]
  const _bDummy = new THREE.Object3D();
  const treePlace = [];            // { x, z, s } for every park/yard tree
  const parkPlaneGeo = new THREE.PlaneGeometry(1, 1); // shared, scaled per block
  // A shared unit cylinder, reused by the central fountain + statue below.
  const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);

  // Facade art pool: a fixed set of pre-painted canvases (mixed window styles
  // and wall colors) shared by every building. Materials are cached by
  // (art, tiling), so buildings with the same look reuse the SAME material and
  // textures — far fewer GPU uploads than one-per-building.
  const facadePool = [];
  for (let i = 0; i < 18; i++) facadePool.push(makeFacadeSet(rng));
  const facadeMatCache = new Map();
  function getFacadeMat(repeatX, repeatY) {
    const idx = Math.floor(rng() * facadePool.length);
    const key = idx + ':' + repeatX + ':' + repeatY;
    let m = facadeMatCache.get(key);
    if (!m) {
      const { map, emissiveMap } = facadeTextures(facadePool[idx], repeatX, repeatY);
      m = new THREE.MeshToonMaterial({
        map,
        gradientMap,
        emissive: 0xffffff,
        emissiveMap,
        emissiveIntensity: 0, // raised at night from main.js so windows glow
      });
      facadeMatCache.set(key, m);
      buildingMats.push(m);
    }
    return m;
  }

  // Each shop is a distinctive standalone low-poly structure (see src/shops/).
  // Some blocks become "shop blocks": either one large place filling the whole
  // block, or the block subdivided into medium/small lots packed side by side.
  // We collect the placements here and instance the structures after the loop.
  const shopPlacements = []; // { x, z, yaw, typeIdx, scale }
  const SHOP_CAP = 80;       // keep collider / POI counts reasonable

  // Shop types grouped by ZONE and land-size class, each round-robined so every
  // district shows its full natural variety without repeating side by side.
  const zonePool = {
    downtown: { large: [], medium: [], small: [] },
    inner: { large: [], medium: [], small: [] },
    arterial: { large: [], medium: [], small: [] },
  };
  SHOP_TYPES.forEach((t, i) => { zonePool[t.zone][t.size].push(i); });
  const zoneCur = { downtown: {}, inner: {}, arterial: {} };
  for (const z in zoneCur) zoneCur[z] = { large: 0, medium: 0, small: 0 };
  function nextType(zone, size) {
    const arr = zonePool[zone][size];
    if (arr.length) return arr[zoneCur[zone][size]++ % arr.length];
    const all = [...zonePool[zone].large, ...zonePool[zone].medium, ...zonePool[zone].small];
    return all.length ? all[Math.floor(rng() * all.length)] : 0;
  }

  // Fit scale for one instance: fill the lot (footprint = lot − margin), clamped
  // to the type's class range and jittered a little so no two look identical.
  function shopScale(typeIdx, lot) {
    const t = SHOP_TYPES[typeIdx];
    const lim = SIZE_SCALE[t.size];
    const natMax = Math.max(t.foot.w, t.foot.d);
    const base = ((lot - lim.margin) / natMax) * (0.92 + rng() * 0.16);
    return Math.min(lim.max, Math.max(lim.min, base));
  }

  // Facing directions: the shop's forecourt/props face +Z locally, so yaw turns
  // that toward a street. `ax` is the axis siblings spread along to sit side by
  // side, both fronting the same road.
  const SHOP_DIRS = [
    { yaw: 0, ax: 'x' },            // faces +Z, row spreads along X
    { yaw: Math.PI / 2, ax: 'z' },  // faces +X, row spreads along Z
    { yaw: Math.PI, ax: 'x' },      // faces −Z
    { yaw: -Math.PI / 2, ax: 'z' }, // faces −X
  ];

  // Lay a shop block appropriate to its zone (a natural mix stays WITHIN a zone).
  function placeShopBlock(cx, cz, zone) {
    if (shopPlacements.length >= SHOP_CAP) return;
    const q = blockSize / 4;
    const dir = SHOP_DIRS[Math.floor(rng() * 4)];

    if (zone === 'arterial') {
      // A road place needing parking/access fills the block (gas, car wash,
      // fast food, diner, civic) — or two mediums side by side.
      if (zonePool.arterial.large.length && rng() < 0.75) {
        const ti = nextType('arterial', 'large');
        shopPlacements.push({ x: cx, z: cz, yaw: dir.yaw, typeIdx: ti, scale: shopScale(ti, blockSize) });
      } else {
        for (const o of [-q, q]) {
          const ti = nextType('arterial', 'medium');
          shopPlacements.push({ x: cx + (dir.ax === 'x' ? o : 0), z: cz + (dir.ax === 'z' ? o : 0), yaw: dir.yaw, typeIdx: ti, scale: shopScale(ti, blockSize / 2) });
        }
      }
      return;
    }

    if (zone === 'downtown') {
      // A big anchor (bank, cinema, bowling, hospital…) or two medium places.
      if (zonePool.downtown.large.length && rng() < 0.45) {
        const ti = nextType('downtown', 'large');
        shopPlacements.push({ x: cx, z: cz, yaw: dir.yaw, typeIdx: ti, scale: shopScale(ti, blockSize) });
      } else {
        for (const o of [-q, q]) {
          const ti = nextType('downtown', 'medium');
          shopPlacements.push({ x: cx + (dir.ax === 'x' ? o : 0), z: cz + (dir.ax === 'z' ? o : 0), yaw: dir.yaw, typeIdx: ti, scale: shopScale(ti, blockSize / 2) });
        }
      }
      return;
    }

    // inner: an occasional minimart anchor, else a tidy 2–4 pack of small shops.
    if (zonePool.inner.large.length && rng() < 0.22) {
      const ti = nextType('inner', 'large');
      shopPlacements.push({ x: cx, z: cz, yaw: dir.yaw, typeIdx: ti, scale: shopScale(ti, blockSize) });
      return;
    }
    for (const sx of [-q, q]) {
      for (const sz of [-q, q]) {
        if (rng() < 0.18) continue;
        const ti = nextType('inner', 'small');
        shopPlacements.push({ x: cx + sx, z: cz + sz, yaw: sz > 0 ? 0 : Math.PI, typeIdx: ti, scale: shopScale(ti, blockSize / 2) });
      }
    }
  }

  // Soft-green cartoon park + tree materials (flat-shaded for faceted leaves).
  // Park ground shares the same anti-shimmer bias (flat plane above the ground).
  // Shared hand-painted surface textures (soft, stylized) — reused everywhere so
  // no extra draw cost. color:0xffffff lets the painted map read through the toon
  // ramp instead of a flat single colour.
  const barkTex = makeBarkTexture();
  const foliageTex = makeFoliageTexture();
  const parkGrassTex = makeParkGrassTexture();
  const stuccoTex = makeStuccoTexture();

  const parkMat = new THREE.MeshToonMaterial({
    color: 0xffffff,
    map: parkGrassTex,
    gradientMap,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const trunkMat = new THREE.MeshToonMaterial({ color: 0xffffff, map: barkTex, gradientMap });
  const leafMat = new THREE.MeshToonMaterial({
    color: 0xffffff,
    map: foliageTex,
    gradientMap,
    flatShading: true,
  });
  const treeTrunk = new THREE.CylinderGeometry(0.35, 0.5, 3, 6);
  const treeLeaf = new THREE.IcosahedronGeometry(2, 0);

  // -------------------------------------------------------------------------
  // Neo-Tokyo rooftop clutter — water tanks, AC units, stairwell shacks,
  // antennas and vent pipes. Each is ONE merged canonical geometry; every
  // tower's roof props are collected and drawn as a single InstancedMesh per
  // type, so the whole cluttered skyline costs only a handful of draw calls.
  // -------------------------------------------------------------------------
  const roofMetalMat = new THREE.MeshToonMaterial({ color: 0x8a8f96, gradientMap }); // AC/antenna/pipes
  const tankMat = new THREE.MeshToonMaterial({ color: 0x6f7d88, gradientMap });      // water tanks
  const shackMat = new THREE.MeshToonMaterial({ color: 0xa9a08c, gradientMap });     // rooftop shacks

  // Classic elevated cylindrical water tank on four legs.
  const tankGeo = (() => {
    const p = [];
    const legH = 1.5, r = 1.25, bodyH = 2.1;
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      p.push(new THREE.BoxGeometry(0.2, legH, 0.2).translate(sx * 0.8, legH / 2, sz * 0.8));
    p.push(new THREE.CylinderGeometry(r, r, bodyH, 12).translate(0, legH + bodyH / 2, 0));
    p.push(new THREE.CylinderGeometry(r * 0.85, r, 0.35, 12).translate(0, legH + bodyH + 0.15, 0));
    return mergeGeometries(p);
  })();
  // Boxy air-conditioning condenser with a top fan + front grille.
  const acGeo = mergeGeometries([
    new THREE.BoxGeometry(1.6, 1.0, 1.2).translate(0, 0.5, 0),
    new THREE.CylinderGeometry(0.42, 0.42, 0.14, 10).translate(0, 1.05, 0),
    new THREE.BoxGeometry(1.5, 0.5, 0.08).translate(0, 0.45, 0.6),
  ]);
  // Small rooftop stairwell / penthouse shack with a flat roof slab + door.
  const shackGeo = mergeGeometries([
    new THREE.BoxGeometry(2.6, 2.4, 2.6).translate(0, 1.2, 0),
    new THREE.BoxGeometry(3.0, 0.3, 3.0).translate(0, 2.55, 0),
    new THREE.BoxGeometry(1.0, 1.6, 0.12).translate(0, 0.8, 1.32),
  ]);
  // Antenna mast with a couple of cross elements.
  const antennaGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.07, 0.11, 5, 6).translate(0, 2.5, 0),
    new THREE.BoxGeometry(1.5, 0.09, 0.09).translate(0, 4.0, 0),
    new THREE.BoxGeometry(1.0, 0.09, 0.09).translate(0, 4.5, 0),
    new THREE.BoxGeometry(0.09, 0.09, 1.1).translate(0, 3.4, 0),
  ]);
  // A little cluster of capped vent pipes.
  const pipeGeo = (() => {
    const p = [];
    const hs = [1.7, 2.3, 1.3], xs = [-0.45, 0.05, 0.5];
    for (let i = 0; i < 3; i++) {
      p.push(new THREE.CylinderGeometry(0.16, 0.16, hs[i], 8).translate(xs[i], hs[i] / 2, 0));
      p.push(new THREE.CylinderGeometry(0.2, 0.2, 0.16, 8).translate(xs[i], hs[i] + 0.05, 0));
    }
    return mergeGeometries(p);
  })();

  const roofTanks = [], roofACs = [], roofShacks = [], roofAntennas = [], roofPipes = [];
  const roofPots = []; // little rooftop / balcony potted plants (instanced below)
  // Scatter a believable jumble of props across one tower's (top) roof.
  function clutterRoof(px, pz, fw, fd, roofY, h) {
    const hw = fw / 2 - 0.9;
    const hd = fd / 2 - 0.9;
    if (hw < 0.4 || hd < 0.4) {
      // Tiny roof: at most a single unit / a mast on tall spikes.
      if (rng() < 0.5) roofACs.push({ x: px, y: roofY, z: pz, ry: Math.floor(rng() * 4) * Math.PI / 2, s: 0.75 });
      if (h > 45 && rng() < 0.5) roofAntennas.push({ x: px, y: roofY, z: pz, ry: rng() * Math.PI, s: 0.8 });
      return;
    }
    const rx = () => px + (rng() * 2 - 1) * hw;
    const rz = () => pz + (rng() * 2 - 1) * hd;
    const area = fw * fd;
    if (rng() < 0.6) roofTanks.push({ x: px + (rng() * 2 - 1) * hw * 0.7, y: roofY, z: pz + (rng() * 2 - 1) * hd * 0.7, ry: rng() * Math.PI, s: 0.7 + rng() * 0.5 });
    if (area > 42 && rng() < 0.4) roofShacks.push({ x: px + (rng() * 2 - 1) * hw * 0.5, y: roofY, z: pz + (rng() * 2 - 1) * hd * 0.5, ry: Math.floor(rng() * 4) * Math.PI / 2, s: 0.8 + rng() * 0.4 });
    const nAC = 1 + Math.floor(rng() * Math.min(3, area / 20));
    for (let i = 0; i < nAC; i++) roofACs.push({ x: rx(), y: roofY, z: rz(), ry: Math.floor(rng() * 4) * Math.PI / 2, s: 0.75 + rng() * 0.5 });
    if (h > 38 && rng() < 0.55) roofAntennas.push({ x: rx(), y: roofY, z: rz(), ry: rng() * Math.PI, s: 0.9 + h / 180 + rng() * 0.4 });
    if (rng() < 0.4) roofPipes.push({ x: rx(), y: roofY, z: rz(), ry: rng() * Math.PI, s: 0.8 + rng() * 0.5 });
    // A few rooftop potted plants — the lived-in Ghibli touch (esp. lower roofs).
    const nPot = h < 60 ? 1 + Math.floor(rng() * 2) : (rng() < 0.4 ? 1 : 0);
    for (let i = 0; i < nPot; i++) roofPots.push({ x: rx(), y: roofY, z: rz(), ry: rng() * Math.PI * 2, s: 0.8 + rng() * 0.6 });
  }

  // -------------------------------------------------------------------------
  // Neon / LED signage — the heart of the Neo-Tokyo look. A small POOL of
  // emissive canvas signs (vertical kanji signs, big billboards, storefront
  // strips) is generated ONCE and reused across every building via InstancedMesh
  // (one draw call per pooled texture). Their materials are collected in
  // `neonMats` so main.js can ramp emissiveIntensity up at night.
  // -------------------------------------------------------------------------
  const neonMats = [];
  const signGeo = new THREE.PlaneGeometry(1, 1); // unit plane, scaled per instance
  function signMaterial(tex) {
    const m = new THREE.MeshToonMaterial({
      map: tex,               // colourful board by day…
      gradientMap,
      emissive: 0xffffff,
      emissiveMap: tex,       // …the same art glows when ramped at night
      emissiveIntensity: 0.45,
      side: THREE.DoubleSide,
    });
    neonMats.push(m);
    return m;
  }
  function makeSignPool(maker, count) {
    const pool = [];
    for (let i = 0; i < count; i++) {
      const tex = maker(rng);
      pool.push({ mat: signMaterial(tex), aspect: tex.image.width / tex.image.height });
    }
    return pool;
  }
  const vSignPool = makeSignPool(makeVerticalSign, 12);
  const billPool = makeSignPool(makeBillboard, 8);
  const storePool = makeSignPool(makeStorefrontSign, 8);

  // Collected sign placements, grouped by kind. Each entry:
  // { poolIdx, x, y, z, ry, w, hgt } — a plane scaled (w×hgt), turned to face out.
  const signPlace = { vertical: [], billboard: [], storefront: [] };

  // Plaster a building's four faces with signs. Signs sit flush-and-proud on the
  // facade, facing outward, so tightly-packed towers form a glowing canyon.
  function placeSigns(px, pz, fw, fd, h) {
    const eps = 0.2;
    const faces = [
      { ry: 0,           half: fw / 2, off: fd / 2, dir: 1, axis: 'z' }, // +Z
      { ry: Math.PI,     half: fw / 2, off: fd / 2, dir: -1, axis: 'z' }, // -Z
      { ry: Math.PI / 2, half: fd / 2, off: fw / 2, dir: 1, axis: 'x' }, // +X
      { ry: -Math.PI / 2, half: fd / 2, off: fw / 2, dir: -1, axis: 'x' }, // -X
    ];
    for (const f of faces) {
      if (rng() < 0.3) continue; // leave some faces dark
      const at = (dx) =>
        f.axis === 'z'
          ? { x: px + dx, z: pz + f.dir * (f.off + eps) }
          : { x: px + f.dir * (f.off + eps), z: pz + dx };

      // 1–2 vertical stacked kanji signs.
      const nV = 1 + (rng() < 0.45 ? 1 : 0);
      for (let k = 0; k < nV; k++) {
        const idx = Math.floor(rng() * vSignPool.length);
        const hgt = 4 + rng() * Math.min(15, h * 0.5);
        const w = hgt * vSignPool[idx].aspect;
        const room = f.half - w / 2 - 0.3;
        if (room < 0) continue;
        const top = Math.min(h - 0.6, h * 0.85);
        const yc = 3.5 + hgt / 2 + rng() * Math.max(0, top - hgt - 3.5);
        if (yc + hgt / 2 > top) continue;
        const c = at((rng() * 2 - 1) * room);
        signPlace.vertical.push({ poolIdx: idx, x: c.x, y: yc, z: c.z, ry: f.ry, w, hgt });
      }

      // Storefront strip near street level.
      if (rng() < 0.55) {
        const idx = Math.floor(rng() * storePool.length);
        let hgt = 1.3 + rng() * 1.0;
        let w = hgt * storePool[idx].aspect;
        const maxW = f.half * 1.75;
        if (w > maxW) { const s = maxW / w; w *= s; hgt *= s; }
        const room = f.half - w / 2 - 0.2;
        const c = at(room > 0 ? (rng() * 2 - 1) * room : 0);
        signPlace.storefront.push({ poolIdx: idx, x: c.x, y: 3 + rng() * 1.8, z: c.z, ry: f.ry, w, hgt });
      }

      // Big billboard high on tall, wide faces.
      if (h > 30 && f.half > 4 && rng() < 0.35) {
        const idx = Math.floor(rng() * billPool.length);
        let hgt = 4 + rng() * 4.5;
        let w = hgt * billPool[idx].aspect;
        const maxW = f.half * 1.8;
        if (w > maxW) { const s = maxW / w; w *= s; hgt *= s; }
        const room = f.half - w / 2 - 0.3;
        if (room < 0) continue;
        const yc = h * (0.5 + rng() * 0.32);
        if (yc + hgt / 2 > h - 1) continue;
        const c = at((rng() * 2 - 1) * room);
        signPlace.billboard.push({ poolIdx: idx, x: c.x, y: yc, z: c.z, ry: f.ry, w, hgt });
      }
    }
  }

  // ---- Realistic zoning: districts by distance from the city centre --------
  // downtown (dense tall core) → inner (mixed neighbourhood) → outer (quiet
  // residential houses + small parks, with the odd arterial road-place). Density
  // and height fall off from the centre outward; heavy industry / farms live
  // beyond the grid entirely (see industrial/*).
  const CB = (blocks - 1) / 2;
  const zoneOf = (bx, bz) => {
    const d = Math.hypot(bx - CB, bz - CB);
    return d < 2.3 ? 'downtown' : d < 3.3 ? 'inner' : 'outer';
  };

  // A leafy block: lawn + a few chunky trees (small parks + residential yards).
  function parkBlockAt(cx, cz) {
    const park = new THREE.Mesh(parkPlaneGeo, parkMat);
    park.rotation.x = -Math.PI / 2;
    park.scale.set(blockSize, blockSize, 1);
    park.position.set(cx, 0.03, cz);
    park.receiveShadow = true;
    group.add(park);
    parkAreas.push({ cx, cz, size: blockSize });
    const trees = 3 + Math.floor(rng() * 4);
    for (let t = 0; t < trees; t++) {
      treePlace.push({                       // batched into 2 InstancedMeshes below
        x: cx + (rng() - 0.5) * (blockSize - 6),
        z: cz + (rng() - 0.5) * (blockSize - 6),
        s: 0.8 + rng() * 0.6,
      });
    }
  }

  // Warm low-poly houses for residential blocks (a few variants), instanced
  // after the loop; their windows warm at night via buildingMats.
  // Vertex colours carry each house's palette; the near-white stucco map only
  // multiplies in soft painted plaster/roof grain (no colour shift).
  const houseMat = new THREE.MeshToonMaterial({ vertexColors: true, map: stuccoTex, gradientMap });
  const houseGlowMat = new THREE.MeshToonMaterial({
    color: 0x2a2418, gradientMap, emissive: new THREE.Color(0xffe6ad), emissiveIntensity: 0,
  });
  buildingMats.push(houseGlowMat);
  const makeHouse = (wall, roof) => merge([
    box(8, 4, 6.6, 0, 2, 0, wall),                              // walls
    cyl(0.01, 5.9, 3, 4, 0, 5.5, 0, roof, [0, Math.PI / 4, 0]), // hip roof (square pyramid)
    box(1.3, 2.3, 0.15, 0, 1.15, 3.32, C.woodDark),            // door
    box(0.6, 1.6, 0.6, 2.6, 5.6, -1.4, C.concreteDark),        // chimney
  ]);
  const houseGlowGeo = merge([
    box(1.4, 1.2, 0.12, -2.3, 2.3, 3.33, C.glassWarm),
    box(1.4, 1.2, 0.12, 2.3, 2.3, 3.33, C.glassWarm),
    box(0.12, 1.2, 1.5, 4.03, 2.3, 0, C.glassWarm),
    box(0.12, 1.2, 1.5, -4.03, 2.3, 0, C.glassWarm),
  ]);
  const houseGeo = [
    makeHouse('#e6cfa8', '#b5654a'), makeHouse('#dcc59a', '#8a5a34'),
    makeHouse('#ecd9b0', '#a0553a'), makeHouse('#d8c7ad', '#9a6b43'),
  ];
  const housePlace = houseGeo.map(() => []);
  const houseGlowPlace = [];
  function houseBlock(cx, cz) {
    parkBlockAt(cx, cz); // green lawn + trees underneath the houses
    const q = blockSize / 4;
    for (const sx of [-q, q]) {
      for (const sz of [-q, q]) {
        if (rng() < 0.18) continue; // a garden gap
        const v = Math.floor(rng() * houseGeo.length);
        const yaw = sz > 0 ? 0 : Math.PI; // front the N/S street
        const px = cx + sx, pz = cz + sz;
        housePlace[v].push({ x: px, z: pz, ry: yaw });
        houseGlowPlace.push({ x: px, z: pz, ry: yaw });
        colliders.push(new THREE.Box3(new THREE.Vector3(px - 4.2, 0, pz - 3.6), new THREE.Vector3(px + 4.2, 6, pz + 3.6)));
        footprints.push({ x0: px - 4, z0: pz - 3.3, x1: px + 4, z1: pz + 3.3 });
      }
    }
  }

  // A packed cluster of towers, sized + heighted for its district.
  function towerCluster(cx, cz, opts) {
    const gridN = rng() < opts.dense ? 3 : 2;
    const cell = blockSize / gridN;
    for (let ix = 0; ix < gridN; ix++) {
      for (let iz = 0; iz < gridN; iz++) {
        if (rng() < 0.08) continue; // a vacant lot / wider alley
        const alley = 1.3 + rng() * 1.6;
        let fw = cell - alley, fd = cell - alley;
        if (rng() < 0.4) { if (rng() < 0.5) fw *= 0.5 + rng() * 0.25; else fd *= 0.5 + rng() * 0.25; }
        if (fw < 3.5 || fd < 3.5) continue;
        // Jitter, then CLAMP inside the block so nothing ever stands in the road.
        const bhalf = blockSize / 2 - 1.0;
        let px = cx - blockSize / 2 + cell * (ix + 0.5) + (rng() - 0.5) * alley * 0.4;
        let pz = cz - blockSize / 2 + cell * (iz + 0.5) + (rng() - 0.5) * alley * 0.4;
        px = Math.max(cx - bhalf + fw / 2, Math.min(cx + bhalf - fw / 2, px));
        pz = Math.max(cz - bhalf + fd / 2, Math.min(cz + bhalf - fd / 2, pz));
        const h = Math.max(9, opts.hMin + Math.pow(rng(), opts.hPow) * (opts.hMax - opts.hMin));
        const tiers = rng() < 0.35 ? (rng() < 0.4 ? 3 : 2) : 1;
        const fracs = tiers === 1 ? [1] : tiers === 2 ? [0.72, 0.28] : [0.6, 0.26, 0.14];
        let baseY = 0, curW = fw, curD = fd, roofW = fw, roofD = fd;
        for (let t = 0; t < tiers; t++) {
          const th = h * fracs[t];
          // Window tiling sized so each floor reads a bit taller than the ~4-unit
          // character (was th/12 ≈ 2-unit floors, which made the player look giant).
          const mat = getFacadeMat(Math.max(1, Math.round(curW / 15)), Math.max(1, Math.round(th / 26)));
          _bDummy.position.set(px, baseY + th / 2, pz);
          _bDummy.scale.set(curW, th, curD);
          _bDummy.updateMatrix();
          let arr = buildingBatch.get(mat);
          if (!arr) { arr = []; buildingBatch.set(mat, arr); }
          arr.push(_bDummy.matrix.clone()); // batched into one InstancedMesh per material
          baseY += th; roofW = curW; roofD = curD;
          curW *= 0.72 + rng() * 0.12; curD *= 0.72 + rng() * 0.12;
        }
        clutterRoof(px, pz, roofW, roofD, baseY, h);
        placeSigns(px, pz, fw, fd, h);
        colliders.push(new THREE.Box3(new THREE.Vector3(px - fw / 2, 0, pz - fd / 2), new THREE.Vector3(px + fw / 2, h, pz + fd / 2)));
        footprints.push({ x0: px - fw / 2, z0: pz - fd / 2, x1: px + fw / 2, z1: pz + fd / 2 });
      }
    }
  }

  // Guarantee one police + one fire station. The arterial pool is otherwise
  // probabilistic and can drop one on some seeds, so we reserve two well-separated
  // outer blocks up front — one for each — and force the civic build there.
  const policeIdx = SHOP_TYPES.findIndex((t) => t.key === 'police');
  const fireIdx = SHOP_TYPES.findIndex((t) => t.key === 'fire');
  const outerBlocks = [];
  for (let bx = 0; bx < blocks; bx++)
    for (let bz = 0; bz < blocks; bz++)
      if (zoneOf(bx, bz) === 'outer' && !parkBlock(bx, bz) && !(bx === towerBX && bz === towerBZ))
        outerBlocks.push([bx, bz]);
  let policeBlock = null, fireBlock = null;
  if (outerBlocks.length >= 2) {
    policeBlock = outerBlocks[0];                      // one corner of the outer ring
    let best = -1;                                     // fire on the block farthest from it
    for (const b of outerBlocks) {
      const d = Math.hypot(b[0] - policeBlock[0], b[1] - policeBlock[1]);
      if (d > best) { best = d; fireBlock = b; }
    }
  }
  const forcedCivicAt = (bx, bz) =>
    policeBlock && bx === policeBlock[0] && bz === policeBlock[1] ? policeIdx
    : fireBlock && bx === fireBlock[0] && bz === fireBlock[1] ? fireIdx
    : -1;

  // Reserve open land beside each MRT station so the platform + stairs + supports
  // sit on the block, off the road. Stations are at the mid-points of the outer
  // avenues (monorail road indices 1 and blocks-1). Reserve the two inland blocks
  // the platform + its stairs reach over → they become plazas.
  const _rcS = (i) => -half + i * stride - road / 2;
  const _loA = _rcS(1), _hiA = _rcS(blocks - 1), _midA = (_loA + _hiA) / 2;
  const _bkey = (wx, wz) =>
    `${Math.max(0, Math.min(blocks - 1, Math.round((wx + half - blockSize / 2) / stride)))},` +
    `${Math.max(0, Math.min(blocks - 1, Math.round((wz + half - blockSize / 2) / stride)))}`;
  const stationBlocks = new Set();
  // [midX, midZ, alongX, alongZ, perpX(inland), perpZ] per avenue.
  for (const [sx, sz, ax, az, px, pz] of [
    [_midA, _loA, 1, 0, 0, 1],   // south
    [_hiA, _midA, 0, 1, -1, 0],  // east
    [_midA, _hiA, 1, 0, 0, -1],  // north
    [_loA, _midA, 0, 1, 1, 0],   // west
  ]) {
    const ix = sx + px * (stride / 2), iz = sz + pz * (stride / 2); // inland block centre
    stationBlocks.add(_bkey(ix, iz));
    stationBlocks.add(_bkey(ix - ax * stride, iz - az * stride));   // + the block the stairs reach into
  }

  for (let bx = 0; bx < blocks; bx++) {
    for (let bz = 0; bz < blocks; bz++) {
      const cx = -half + bx * stride + blockSize / 2;
      const cz = -half + bz * stride + blockSize / 2;
      if (parkBlock(bx, bz)) continue;                 // central park (built below)
      if (bx === towerBX && bz === towerBZ) continue;   // reserved landmark tower
      if (stationBlocks.has(`${bx},${bz}`)) {           // MRT station forecourt → bare plaza
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(blockSize, blockSize), parkMat);
        pl.rotation.x = -Math.PI / 2; pl.position.set(cx, 0.03, cz); pl.receiveShadow = true;
        group.add(pl); parkAreas.push({ cx, cz, size: blockSize });
        continue;
      }

      const zone = zoneOf(bx, bz);
      const canShop = shopPlacements.length < SHOP_CAP;
      if (zone === 'downtown') {
        // Dense tall core: big civic/retail anchors or tall tower clusters.
        if (canShop && rng() < 0.42) placeShopBlock(cx, cz, 'downtown');
        else towerCluster(cx, cz, { dense: 0.78, hMin: 34, hMax: 155, hPow: 1.35 });
      } else if (zone === 'inner') {
        // Mixed neighbourhood: tidy small shops + mid-rise blocks + the odd park.
        const r = rng();
        if (r < 0.12) parkBlockAt(cx, cz);
        else if (r < 0.55 && canShop) placeShopBlock(cx, cz, 'inner');
        else towerCluster(cx, cz, { dense: 0.45, hMin: 14, hMax: 62, hPow: 1.7 });
      } else {
        // Outer: quiet residential houses + small parks; the odd arterial place.
        // Two reserved blocks always get the guaranteed police / fire station.
        const forced = forcedCivicAt(bx, bz);
        if (forced >= 0) {
          const dir = SHOP_DIRS[Math.floor(rng() * 4)];
          shopPlacements.push({ x: cx, z: cz, yaw: dir.yaw, typeIdx: forced, scale: shopScale(forced, blockSize) });
        } else {
          const r = rng();
          if (r < 0.16 && canShop) placeShopBlock(cx, cz, 'arterial');
          else if (r < 0.42) parkBlockAt(cx, cz);
          else houseBlock(cx, cz);
        }
      }
    }
  }

  // Batch the tower buildings: one InstancedMesh per shared facade material for
  // the WHOLE skyline (was one mesh per tier → hundreds of draw calls). The
  // instances span the city so they're never off-screen as a group.
  for (const [mat, mats] of buildingBatch) {
    const im = new THREE.InstancedMesh(boxGeo, mat, mats.length);
    im.castShadow = true;
    im.receiveShadow = true;
    for (let i = 0; i < mats.length; i++) im.setMatrixAt(i, mats[i]);
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere(); // instance-aware bounds → correct frustum culling
    group.add(im);
  }
  // Batch every park/yard tree into two InstancedMeshes (trunks + leaves).
  if (treePlace.length) {
    const tDummy = new THREE.Object3D();
    const trunkIM = new THREE.InstancedMesh(treeTrunk, trunkMat, treePlace.length);
    const leafIM = new THREE.InstancedMesh(treeLeaf, leafMat, treePlace.length);
    trunkIM.castShadow = leafIM.castShadow = true;
    for (let i = 0; i < treePlace.length; i++) {
      const t = treePlace[i];
      tDummy.position.set(t.x, 1.5, t.z); tDummy.scale.setScalar(1); tDummy.updateMatrix();
      trunkIM.setMatrixAt(i, tDummy.matrix);
      tDummy.position.set(t.x, 4, t.z); tDummy.scale.setScalar(t.s); tDummy.updateMatrix();
      leafIM.setMatrixAt(i, tDummy.matrix);
    }
    trunkIM.instanceMatrix.needsUpdate = leafIM.instanceMatrix.needsUpdate = true;
    trunkIM.computeBoundingSphere(); leafIM.computeBoundingSphere(); // enable frustum culling
    group.add(trunkIM, leafIM);
  }

  // Instance every rooftop prop collected during the tower loop — one draw call
  // per prop type for the whole skyline.
  const roofDummy = new THREE.Object3D();
  function addRoofInstances(geo, mat, list, shadow) {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    im.castShadow = shadow;
    im.receiveShadow = false;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      roofDummy.position.set(p.x, p.y, p.z);
      roofDummy.rotation.set(0, p.ry || 0, 0);
      roofDummy.scale.setScalar(p.s || 1);
      roofDummy.updateMatrix();
      im.setMatrixAt(i, roofDummy.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
  }
  addRoofInstances(tankGeo, tankMat, roofTanks, true);
  addRoofInstances(acGeo, roofMetalMat, roofACs, true);
  addRoofInstances(shackGeo, shackMat, roofShacks, true);
  addRoofInstances(antennaGeo, roofMetalMat, roofAntennas, false);
  addRoofInstances(pipeGeo, roofMetalMat, roofPipes, false);

  // Instance the residential houses collected from the outer zone.
  for (let v = 0; v < houseGeo.length; v++) addRoofInstances(houseGeo[v], houseMat, housePlace[v], true);
  addRoofInstances(houseGlowGeo, houseGlowMat, houseGlowPlace, false);

  // Instance the collected neon signs — one InstancedMesh per pooled texture, so
  // the whole glowing skyline of signage is only a couple dozen draw calls.
  const signDummy = new THREE.Object3D();
  function buildSignInstances(pool, list) {
    const groups = pool.map(() => []);
    for (const p of list) groups[p.poolIdx].push(p);
    for (let idx = 0; idx < pool.length; idx++) {
      const arr = groups[idx];
      if (!arr.length) continue;
      const im = new THREE.InstancedMesh(signGeo, pool[idx].mat, arr.length);
      im.castShadow = false;
      im.receiveShadow = false;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i];
        signDummy.position.set(p.x, p.y, p.z);
        signDummy.rotation.set(0, p.ry, 0);
        signDummy.scale.set(p.w, p.hgt, 1);
        signDummy.updateMatrix();
        im.setMatrixAt(i, signDummy.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
      group.add(im);
    }
  }
  buildSignInstances(vSignPool, signPlace.vertical);
  buildSignInstances(billPool, signPlace.billboard);
  buildSignInstances(storePool, signPlace.storefront);

  // Build the distinctive standalone shops from the collected placements.
  const shopResult = buildShops(shopPlacements, { gradientMap, group, colliders, buildingMats, stuccoTex });

  // -------------------------------------------------------------------------
  // Wind — a single shared time uniform drives every animated material's
  // vertex shader. main.js just advances windTime.value each frame.
  // -------------------------------------------------------------------------
  const windTime = { value: 0 };

  // Injects a wind sway into a MeshToonMaterial's vertex stage without giving
  // up toon shading / fog / shadows. `bend` is a GLSL expression in [0..1]
  // controlling how much a given vertex moves (0 at the anchored base, 1 at the
  // free tip). Works for both instanced (grass) and plain (tree) meshes.
  function makeWindMaterial(material, { freq, strength, bend, key }) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = windTime;
      shader.uniforms.uWindStrength = { value: strength };
      shader.uniforms.uWindFreq = { value: freq };
      shader.vertexShader =
        'uniform float uTime;\nuniform float uWindStrength;\nuniform float uWindFreq;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           {
           #ifdef USE_INSTANCING
             vec3 windAnchor = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
           #else
             vec3 windAnchor = vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]);
           #endif
             float phase = windAnchor.x * 0.12 + windAnchor.z * 0.15;
             float bend = ${bend};
             float gust = sin(uTime * uWindFreq + phase)
                        + 0.35 * sin(uTime * uWindFreq * 2.3 + phase * 1.7);
             transformed.x += gust * uWindStrength * bend;
             transformed.z += cos(uTime * uWindFreq * 0.9 + phase) * uWindStrength * 0.6 * bend;
           }`
        );
    };
    material.customProgramCacheKey = () => 'wind-' + key;
  }

  function insideBuilding(x, z) {
    for (let i = 0; i < colliders.length; i++) {
      const b = colliders[i];
      if (x >= b.min.x - 0.6 && x <= b.max.x + 0.6 && z >= b.min.z - 0.6 && z <= b.max.z + 0.6) {
        return true;
      }
    }
    return false;
  }

  // Roads sit on the grid lines (centered at -half + i*stride - road/2). A point
  // is on a road if it falls inside a road band along X or Z — grass and trees
  // stay off the streets.
  function onRoadAxis(v) {
    for (let i = 0; i <= blocks; i++) {
      const c = -half + i * stride - road / 2;
      if (Math.abs(v - c) <= road / 2 + 0.4) return true;
    }
    return false;
  }
  function onRoad(x, z) {
    return onRoadAxis(x) || onRoadAxis(z);
  }

  // -------------------------------------------------------------------------
  // Grass field — thousands of blades in ONE InstancedMesh, swaying in the wind
  // -------------------------------------------------------------------------
  const bladeH = 0.9;
  const bladeGeo = new THREE.PlaneGeometry(0.16, bladeH, 1, 4);
  bladeGeo.translate(0, bladeH / 2, 0); // base sits on the ground (y = 0)
  {
    const p = bladeGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) / bladeH;
      p.setX(i, p.getX(i) * (1 - 0.85 * t)); // taper toward a point
    }
    bladeGeo.computeVertexNormals();
  }

  const grassMat = new THREE.MeshToonMaterial({
    color: 0xffffff, // white base; per-instance colors do the tinting
    gradientMap,
    side: THREE.DoubleSide,
  });
  makeWindMaterial(grassMat, {
    freq: 1.6,
    strength: 0.18,
    bend: `pow(clamp(position.y / ${bladeH.toFixed(3)}, 0.0, 1.0), 1.5)`,
    key: 'grass',
  });

  // Grass lives in parks only now — no sidewalk/margin grass on the streets.
  // Fill each small green park block densely (the central park has its own mesh).
  const placements = [];
  for (let pi = 0; pi < parkAreas.length; pi++) {
    const pk = parkAreas[pi];
    for (let k = 0; k < 320; k++) {
      const x = pk.cx + (rng() - 0.5) * pk.size;
      const z = pk.cz + (rng() - 0.5) * pk.size;
      if (onRoad(x, z) || insideBuilding(x, z)) continue;
      placements.push({ x, z, lush: true });
    }
  }

  const grass = new THREE.InstancedMesh(bladeGeo, grassMat, placements.length);
  grass.castShadow = false;
  grass.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  for (let i = 0; i < placements.length; i++) {
    const pl = placements[i];
    dummy.position.set(pl.x, 0, pl.z);
    dummy.rotation.set((rng() - 0.5) * 0.15, rng() * Math.PI * 2, (rng() - 0.5) * 0.2);
    const s = 0.6 + rng() * 1.0;
    const hs = pl.lush ? 1.0 + rng() * 1.1 : 0.7 + rng() * 1.0;
    dummy.scale.set(s, hs, s);
    dummy.updateMatrix();
    grass.setMatrixAt(i, dummy.matrix);

    if (pl.lush) col.setRGB(0.3 + rng() * 0.16, 0.58 + rng() * 0.3, 0.24 + rng() * 0.12);
    else if (rng() < 0.12) col.setRGB(0.72, 0.68, 0.34);
    else col.setRGB(0.34 + rng() * 0.18, 0.5 + rng() * 0.32, 0.22 + rng() * 0.14);
    grass.setColorAt(i, col);
  }
  grass.instanceMatrix.needsUpdate = true;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  group.add(grass);

  // -------------------------------------------------------------------------
  // Chunky low-poly trees — faceted canopy blobs that bob in the wind
  // -------------------------------------------------------------------------
  const trunkGeo = new THREE.CylinderGeometry(0.5, 0.85, 5, 6);
  const canopyGeo = new THREE.DodecahedronGeometry(2.4, 0);
  const bigTrunkMat = new THREE.MeshToonMaterial({
    color: 0xffffff,
    map: barkTex,
    gradientMap,
    flatShading: true,
  });
  const canopyMat = new THREE.MeshToonMaterial({
    color: 0xffffff,
    map: foliageTex,
    gradientMap,
    flatShading: true,
  });
  makeWindMaterial(canopyMat, { freq: 1.05, strength: 0.22, bend: '1.0', key: 'canopy' });

  const TREE_COUNT = 24;
  let treesPlaced = 0;
  let treeTries = 0;
  while (treesPlaced < TREE_COUNT && treeTries < TREE_COUNT * 40) {
    treeTries++;
    const x = (rng() * 2 - 1) * half * 1.05;
    const z = (rng() * 2 - 1) * half * 1.05;
    if (onRoad(x, z) || insideBuilding(x, z) || inPark(x, z)) continue;

    const th = 4 + rng() * 3;
    const trunk = new THREE.Mesh(trunkGeo, bigTrunkMat);
    trunk.scale.y = th / 5;
    trunk.position.set(x, th / 2, z);
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    group.add(trunk);

    const blobs = 2 + Math.floor(rng() * 2);
    for (let bI = 0; bI < blobs; bI++) {
      const canopy = new THREE.Mesh(canopyGeo, canopyMat);
      canopy.position.set(
        x + (rng() - 0.5) * 2.4,
        th + 0.5 + rng() * 1.6,
        z + (rng() - 0.5) * 2.4
      );
      canopy.scale.setScalar(1.1 + rng() * 0.9);
      canopy.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      canopy.castShadow = true;
      canopy.receiveShadow = true;
      group.add(canopy);
    }
    treesPlaced++;
  }

  // -------------------------------------------------------------------------
  // Street lamps — one merged low-poly post geometry drawn as a single
  // InstancedMesh, plus a matching InstancedMesh of emissive bulbs. Placed
  // evenly along every road line so the whole grid is lit.
  // -------------------------------------------------------------------------
  const POLE_H = 5.0;
  const ARM = 1.3;                 // how far the lamp head reaches over the road
  const bulbLocal = new THREE.Vector3(ARM, POLE_H - 0.55, 0);

  // Build the post from a few primitives merged into ONE geometry (base + pole
  // + arm + lantern head), so every lamp is a single instanced draw call.
  const postGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.28, 0.34, 0.4, 6).translate(0, 0.2, 0),        // base
    new THREE.CylinderGeometry(0.11, 0.14, POLE_H, 6).translate(0, POLE_H / 2, 0), // pole
    new THREE.BoxGeometry(ARM, 0.12, 0.12).translate(ARM / 2, POLE_H - 0.15, 0),   // arm
    new THREE.CylinderGeometry(0.34, 0.22, 0.5, 6).translate(ARM, POLE_H - 0.4, 0),// head
  ]);
  const postMat = new THREE.MeshToonMaterial({ color: 0x3a3532, gradientMap });

  // Bulb geometry baked at the head offset so one instance matrix places both
  // the post and its bulb consistently.
  const bulbGeo = new THREE.SphereGeometry(0.2, 8, 6).translate(
    bulbLocal.x,
    bulbLocal.y,
    0
  );
  // Emissive so the bulb glows (and the bloom pass blooms it). emissiveIntensity
  // is turned up at night from main.js.
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xffca7a,
    emissive: new THREE.Color(0xffb14d),
    emissiveIntensity: 0.35,
    roughness: 0.6,
    metalness: 0,
  });

  // Collect lamp placements along each road line at block-center spacing, the
  // post set just off the tarmac and its arm reaching over the road.
  const lampPlacements = []; // { x, z, ry }
  const off = road / 2 + 0.6;
  for (let i = 0; i <= blocks; i++) {
    const rx = -half + i * stride - road / 2; // vertical road (runs along Z)
    const rz = -half + i * stride - road / 2; // horizontal road (runs along X)
    // Skip lamps that fall inside the park interior (the park lights itself);
    // a small margin keeps the park's boundary-road lamps.
    const inParkInner = (x, z) =>
      x > parkMinX + 3 && x < parkMaxX - 3 && z > parkMinZ + 3 && z < parkMaxZ - 3;
    for (let b = 0; b < blocks; b++) {
      const c = -half + b * stride + blockSize / 2; // block center coordinate
      if (!inParkInner(rx + off, c)) lampPlacements.push({ x: rx + off, z: c, ry: Math.PI });
      if (!inParkInner(c, rz + off)) lampPlacements.push({ x: c, z: rz + off, ry: Math.PI / 2 });
    }
  }

  const lampCount = lampPlacements.length;
  const posts = new THREE.InstancedMesh(postGeo, postMat, lampCount);
  posts.castShadow = true;
  posts.receiveShadow = true;
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, lampCount);
  const bulbPositions = []; // world-space bulb positions for the light pool

  const lampDummy = new THREE.Object3D();
  for (let k = 0; k < lampCount; k++) {
    const L = lampPlacements[k];
    lampDummy.position.set(L.x, 0, L.z);
    lampDummy.rotation.set(0, L.ry, 0);
    lampDummy.updateMatrix();
    posts.setMatrixAt(k, lampDummy.matrix);
    bulbs.setMatrixAt(k, lampDummy.matrix);
    bulbPositions.push(bulbLocal.clone().applyMatrix4(lampDummy.matrix));
  }
  posts.instanceMatrix.needsUpdate = true;
  bulbs.instanceMatrix.needsUpdate = true;
  group.add(posts, bulbs);

  // -------------------------------------------------------------------------
  // Lived-in town clutter — potted plants, bushes, flowers, crates and barrels
  // packed along the sidewalks and into corners, like a Ghibli town. Each prop
  // is a small merged (vertex-coloured, faceted) geometry; every type is drawn
  // as ONE InstancedMesh, so the whole cluttered street costs ~6 draw calls.
  // -------------------------------------------------------------------------
  const propMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap, flatShading: true });

  const pottedPlantGeo = merge([
    cyl(0.24, 0.18, 0.34, 8, 0, 0.17, 0, '#b5623c'),   // terracotta pot
    cyl(0.28, 0.26, 0.08, 8, 0, 0.35, 0, '#8f4a2c'),   // rim
    cyl(0.22, 0.22, 0.05, 8, 0, 0.38, 0, '#3a2a1a'),   // soil
    blob(0.34, 0, 0.66, 0, '#5a9a3e'),
    blob(0.26, 0.12, 0.82, 0.08, '#7bb84e'),
    blob(0.2, -0.1, 0.78, -0.1, '#6fae4e'),
  ]);
  const bushGeo = merge([
    blob(0.5, 0, 0.42, 0, '#5f9a44'),
    blob(0.38, 0.28, 0.55, 0.2, '#78b850'),
    blob(0.34, -0.26, 0.5, -0.18, '#6aa84a'),
    blob(0.09, 0.3, 0.68, 0.28, '#e87ea8'),            // flowers
    blob(0.09, -0.2, 0.62, 0.3, '#f2c94c'),
    blob(0.08, 0.1, 0.72, -0.3, '#f4ede0'),
    blob(0.08, -0.34, 0.46, -0.1, '#d9843f'),
  ]);
  const flowerGeo = merge([
    blob(0.16, 0, 0.13, 0, '#5f9a44'),
    blob(0.1, 0.14, 0.17, 0.1, '#6fae4e'),
    blob(0.07, 0.05, 0.28, 0.05, '#e87ea8'),
    blob(0.06, -0.12, 0.24, -0.08, '#f2c94c'),
    blob(0.06, 0.16, 0.26, -0.12, '#f4ede0'),
  ]);
  const crateGeo = merge([
    box(0.6, 0.58, 0.6, 0, 0.29, 0, '#9c7448'),
    box(0.64, 0.08, 0.64, 0, 0.57, 0, '#7a5834'),
    box(0.08, 0.6, 0.08, 0.28, 0.3, 0.28, '#6a4a2a'),
    box(0.08, 0.6, 0.08, -0.28, 0.3, 0.28, '#6a4a2a'),
    box(0.08, 0.6, 0.08, 0.28, 0.3, -0.28, '#6a4a2a'),
    box(0.08, 0.6, 0.08, -0.28, 0.3, -0.28, '#6a4a2a'),
  ]);
  const barrelGeo = merge([
    cyl(0.26, 0.26, 0.7, 10, 0, 0.35, 0, '#8a5f38'),
    cyl(0.28, 0.28, 0.06, 10, 0, 0.15, 0, '#4a3826'),
    cyl(0.28, 0.28, 0.06, 10, 0, 0.55, 0, '#4a3826'),
    cyl(0.23, 0.23, 0.04, 10, 0, 0.71, 0, '#6a4a2a'),
  ]);

  const PROPS = [
    { geo: pottedPlantGeo, list: [], w: 26, sMin: 0.75, sMax: 1.15, shadow: true },
    { geo: bushGeo, list: [], w: 24, sMin: 0.8, sMax: 1.5, shadow: true },
    { geo: flowerGeo, list: [], w: 22, sMin: 0.9, sMax: 1.7, shadow: false },
    { geo: crateGeo, list: [], w: 12, sMin: 0.8, sMax: 1.2, shadow: true },
    { geo: barrelGeo, list: [], w: 10, sMin: 0.85, sMax: 1.15, shadow: true },
  ];
  const wSum = PROPS.reduce((a, p) => a + p.w, 0);
  const pickProp = () => { let r = rng() * wSum; for (const p of PROPS) if ((r -= p.w) <= 0) return p; return PROPS[0]; };

  // Distance from a world coord to the nearest road centre-line (roads sit every
  // `stride`, centred at -half + i*stride - road/2).
  const nearestRoadDist = (v) => {
    const m = (((v + half + road / 2) % stride) + stride) % stride;
    return Math.min(m, stride - m);
  };
  const CLUTTER_CAP = 520;
  let clutterN = 0, clutterTries = 0;
  while (clutterN < CLUTTER_CAP && clutterTries < CLUTTER_CAP * 14) {
    clutterTries++;
    const x = (rng() * 2 - 1) * (half - 2);
    const z = (rng() * 2 - 1) * (half - 2);
    if (onRoad(x, z) || insideBuilding(x, z) || inPark(x, z)) continue;
    // Keep to the sidewalk band just off a road — where a town's clutter lives.
    const dRoad = Math.min(nearestRoadDist(x), nearestRoadDist(z));
    if (dRoad < road / 2 + 0.4 || dRoad > road / 2 + 3.2) continue;
    const p = pickProp();
    p.list.push({ x, y: 0, z, ry: rng() * Math.PI * 2, s: p.sMin + rng() * (p.sMax - p.sMin) });
    clutterN++;
  }

  // Extra lushness in the central park: flowers + bushes dotted across the lawn
  // (kept clear of the fountain / statue at the centre).
  const pCX = (parkMinX + parkMaxX) / 2, pCZ = (parkMinZ + parkMaxZ) / 2;
  for (let pk = 0, pkTries = 0; pk < 70 && pkTries < 700; pkTries++) {
    const x = parkMinX + 4 + rng() * (parkMaxX - parkMinX - 8);
    const z = parkMinZ + 4 + rng() * (parkMaxZ - parkMinZ - 8);
    if (Math.hypot(x - pCX, z - pCZ) < 12) continue;
    const p = rng() < 0.62 ? PROPS[2] : PROPS[1]; // flowers or bushes
    p.list.push({ x, y: 0, z, ry: rng() * Math.PI * 2, s: p.sMin + rng() * (p.sMax - p.sMin) });
    pk++;
  }

  for (const p of PROPS) addRoofInstances(p.geo, propMat, p.list, p.shadow);
  addRoofInstances(pottedPlantGeo, propMat, roofPots, false); // rooftop / balcony plants

  // -------------------------------------------------------------------------
  // Central park — green lawn, stone walking paths, lots of (instanced) trees,
  // benches, extra lamp posts, a fountain, and a statue on a stone pedestal as
  // the landmark. Everything reuses geometry/materials defined above, so the
  // whole park costs only a couple dozen draw calls.
  // -------------------------------------------------------------------------
  const parkLen = parkMaxX - parkMinX;

  // Lawn.
  const parkGround = new THREE.Mesh(new THREE.PlaneGeometry(parkLen, parkLen), parkMat);
  parkGround.rotation.x = -Math.PI / 2;
  parkGround.position.set(parkCX, 0.03, parkCZ);
  parkGround.receiveShadow = true;
  group.add(parkGround);

  // Stone walking paths: a cross through the centre + a ring around the fountain.
  const pathMat = new THREE.MeshToonMaterial({
    color: 0xcbb994,
    gradientMap,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -6,
  });
  const pathW = parkPathHalf * 2;
  const nsPath = new THREE.Mesh(new THREE.PlaneGeometry(pathW, parkLen), pathMat);
  nsPath.rotation.x = -Math.PI / 2;
  nsPath.position.set(parkCX, 0.05, parkCZ);
  nsPath.receiveShadow = true;
  const ewPath = new THREE.Mesh(new THREE.PlaneGeometry(parkLen, pathW), pathMat);
  ewPath.rotation.x = -Math.PI / 2;
  ewPath.position.set(parkCX, 0.05, parkCZ);
  ewPath.receiveShadow = true;
  const ringPath = new THREE.Mesh(
    new THREE.RingGeometry(parkRingR - 2.5, parkRingR + 2.5, 44),
    pathMat
  );
  ringPath.rotation.x = -Math.PI / 2;
  ringPath.position.set(parkCX, 0.05, parkCZ);
  ringPath.receiveShadow = true;
  group.add(nsPath, ewPath, ringPath);

  // Lush lawn grass (its own InstancedMesh — reuses the swaying blade + material).
  const parkGrassPlace = [];
  {
    let t = 0;
    while (parkGrassPlace.length < 2200 && t < 14000) {
      t++;
      const x = parkMinX + rng() * parkLen;
      const z = parkMinZ + rng() * parkLen;
      if (parkPlantable(x, z)) parkGrassPlace.push({ x, z });
    }
  }
  const parkGrass = new THREE.InstancedMesh(bladeGeo, grassMat, parkGrassPlace.length);
  parkGrass.castShadow = false;
  parkGrass.receiveShadow = true;
  {
    const d = new THREE.Object3D();
    const c = new THREE.Color();
    for (let i = 0; i < parkGrassPlace.length; i++) {
      const p = parkGrassPlace[i];
      d.position.set(p.x, 0, p.z);
      d.rotation.set((rng() - 0.5) * 0.15, rng() * Math.PI * 2, (rng() - 0.5) * 0.2);
      const s = 0.7 + rng() * 0.9;
      d.scale.set(s, 1.0 + rng() * 1.1, s);
      d.updateMatrix();
      parkGrass.setMatrixAt(i, d.matrix);
      c.setRGB(0.3 + rng() * 0.16, 0.6 + rng() * 0.28, 0.25 + rng() * 0.12);
      parkGrass.setColorAt(i, c);
    }
  }
  parkGrass.instanceMatrix.needsUpdate = true;
  if (parkGrass.instanceColor) parkGrass.instanceColor.needsUpdate = true;
  group.add(parkGrass);

  // Lots of trees — two InstancedMeshes (trunks + canopies) reusing the chunky
  // tree geometry and the wind-swaying canopy material.
  const treeSpots = [];
  {
    let t = 0;
    while (treeSpots.length < 24 && t < 5000) {
      t++;
      const x = parkMinX + rng() * parkLen;
      const z = parkMinZ + rng() * parkLen;
      if (!parkPlantable(x, z)) continue;
      let ok = true;
      for (let j = 0; j < treeSpots.length; j++) {
        const s = treeSpots[j];
        if ((s.x - x) ** 2 + (s.z - z) ** 2 < 90) { ok = false; break; }
      }
      if (ok) treeSpots.push({ x, z, th: 4 + rng() * 3.5, cs: 1.3 + rng() * 1.1, ry: rng() * Math.PI });
    }
  }
  const parkTrunks = new THREE.InstancedMesh(trunkGeo, bigTrunkMat, treeSpots.length);
  const parkCanopies = new THREE.InstancedMesh(canopyGeo, canopyMat, treeSpots.length);
  parkTrunks.castShadow = parkTrunks.receiveShadow = true;
  parkCanopies.castShadow = parkCanopies.receiveShadow = true;
  {
    const d = new THREE.Object3D();
    for (let i = 0; i < treeSpots.length; i++) {
      const s = treeSpots[i];
      d.position.set(s.x, s.th / 2, s.z);
      d.rotation.set(0, 0, 0);
      d.scale.set(1, s.th / 5, 1); // trunkGeo is 5 tall
      d.updateMatrix();
      parkTrunks.setMatrixAt(i, d.matrix);
      d.position.set(s.x, s.th + 0.8, s.z);
      d.rotation.set(0, s.ry, 0);
      d.scale.setScalar(s.cs);
      d.updateMatrix();
      parkCanopies.setMatrixAt(i, d.matrix);
    }
  }
  parkTrunks.instanceMatrix.needsUpdate = true;
  parkCanopies.instanceMatrix.needsUpdate = true;
  group.add(parkTrunks, parkCanopies);

  // Benches, ringing the fountain and facing inward — one merged bench geometry,
  // instanced, with a collider each.
  const benchMat = new THREE.MeshToonMaterial({ color: 0x8a5a34, gradientMap });
  const benchGeo = mergeGeometries([
    new THREE.BoxGeometry(3.2, 0.2, 0.9).translate(0, 0.75, 0),      // seat
    new THREE.BoxGeometry(3.2, 0.9, 0.16).translate(0, 1.2, -0.37),  // backrest
    new THREE.BoxGeometry(0.2, 0.75, 0.2).translate(-1.4, 0.375, 0.3),
    new THREE.BoxGeometry(0.2, 0.75, 0.2).translate(1.4, 0.375, 0.3),
    new THREE.BoxGeometry(0.2, 0.75, 0.2).translate(-1.4, 0.375, -0.3),
    new THREE.BoxGeometry(0.2, 0.75, 0.2).translate(1.4, 0.375, -0.3),
  ]);
  const benchSpots = [];   // where you can sit down to rest (needs system)
  const benchN = 8;
  const benches = new THREE.InstancedMesh(benchGeo, benchMat, benchN);
  benches.castShadow = benches.receiveShadow = true;
  {
    const d = new THREE.Object3D();
    for (let i = 0; i < benchN; i++) {
      const a = (i / benchN) * Math.PI * 2 + 0.3;
      const r = parkRingR + 4;
      const x = parkCX + Math.cos(a) * r;
      const z = parkCZ + Math.sin(a) * r;
      // Stand-in spot just outside the bench collider, where you can sit down.
      benchSpots.push({ x: x + Math.cos(a) * 2.6, z: z + Math.sin(a) * 2.6 });
      const ry = Math.atan2(parkCX - x, parkCZ - z); // face the fountain
      d.position.set(x, 0, z);
      d.rotation.set(0, ry, 0);
      d.updateMatrix();
      benches.setMatrixAt(i, d.matrix);
      colliders.push(
        new THREE.Box3(
          new THREE.Vector3(x - 1.8, 0, z - 1.8),
          new THREE.Vector3(x + 1.8, 1.4, z + 1.8)
        )
      );
    }
  }
  benches.instanceMatrix.needsUpdate = true;
  group.add(benches);

  // Extra lamp posts around the park (reuse the street-lamp meshes + material,
  // and feed their bulbs into the night light pool via bulbPositions).
  const parkLampPlace = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const r = parkRingR + 6;
    const x = parkCX + Math.cos(a) * r;
    const z = parkCZ + Math.sin(a) * r;
    parkLampPlace.push({ x, z, ry: Math.atan2(parkCX - x, parkCZ - z) });
  }
  parkLampPlace.push({ x: parkCX, z: parkMinZ + 6, ry: 0 });
  parkLampPlace.push({ x: parkCX, z: parkMaxZ - 6, ry: Math.PI });
  parkLampPlace.push({ x: parkMinX + 6, z: parkCZ, ry: -Math.PI / 2 });
  parkLampPlace.push({ x: parkMaxX - 6, z: parkCZ, ry: Math.PI / 2 });
  const parkPosts = new THREE.InstancedMesh(postGeo, postMat, parkLampPlace.length);
  const parkBulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, parkLampPlace.length);
  parkPosts.castShadow = parkPosts.receiveShadow = true;
  {
    const d = new THREE.Object3D();
    for (let i = 0; i < parkLampPlace.length; i++) {
      const L = parkLampPlace[i];
      d.position.set(L.x, 0, L.z);
      d.rotation.set(0, L.ry, 0);
      d.updateMatrix();
      parkPosts.setMatrixAt(i, d.matrix);
      parkBulbs.setMatrixAt(i, d.matrix);
      bulbPositions.push(bulbLocal.clone().applyMatrix4(d.matrix));
    }
  }
  parkPosts.instanceMatrix.needsUpdate = true;
  parkBulbs.instanceMatrix.needsUpdate = true;
  group.add(parkPosts, parkBulbs);

  // Fountain — stone basins with toon-blue water, at the very centre.
  const stoneMat = new THREE.MeshToonMaterial({ color: 0xb8b0a0, gradientMap });
  const stoneDark = new THREE.MeshToonMaterial({ color: 0x9a9284, gradientMap });
  const waterMat = new THREE.MeshToonMaterial({
    color: 0x4aa6c8,
    gradientMap,
    transparent: true,
    opacity: 0.9,
  });
  const stack = (geo, mat, sx, sy, sz, y, shadow = false) => {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(parkCX, y, parkCZ);
    m.castShadow = shadow;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  stack(cylGeo, stoneMat, 24, 1.2, 24, 0.6, true);   // outer basin (radius 12)
  stack(cylGeo, waterMat, 22, 0.4, 22, 1.1);          // outer water
  stack(cylGeo, stoneMat, 8, 2.0, 8, 1.8, true);      // pedestal drum
  stack(cylGeo, waterMat, 6, 0.3, 6, 2.9);            // upper water bowl

  // Statue on a stepped stone pedestal — the park's landmark.
  stack(boxGeo, stoneMat, 5, 1.0, 5, 3.4, true);      // base step
  stack(boxGeo, stoneDark, 3.4, 3.0, 3.4, 5.4, true); // column
  stack(boxGeo, stoneMat, 4, 0.6, 4, 7.0, true);      // cap

  const bronze = new THREE.MeshToonMaterial({ color: 0x9c8b5a, gradientMap });
  const statue = new THREE.Group();
  statue.position.set(parkCX, 7.3, parkCZ);
  const limb = (geo, sx, sy, sz, x, y, z, rz = 0) => {
    const m = new THREE.Mesh(geo, bronze);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    m.rotation.z = rz;
    m.castShadow = true;
    statue.add(m);
  };
  limb(boxGeo, 0.5, 1.8, 0.6, -0.35, 0.9, 0);   // left leg
  limb(boxGeo, 0.5, 1.8, 0.6, 0.35, 0.9, 0);    // right leg
  limb(boxGeo, 1.3, 1.9, 0.8, 0, 2.75, 0);      // torso
  limb(cylGeo, 0.75, 0.95, 0.75, 0, 4.1, 0);    // head
  limb(boxGeo, 0.38, 1.8, 0.38, 0.95, 3.7, 0, -0.95); // raised arm
  limb(boxGeo, 0.38, 1.6, 0.38, -0.8, 2.7, 0, 0.35);  // resting arm
  group.add(statue);

  // Keep the player out of the fountain (a box around the basin footprint).
  colliders.push(
    new THREE.Box3(
      new THREE.Vector3(parkCX - 12, 0, parkCZ - 12),
      new THREE.Vector3(parkCX + 12, 9, parkCZ + 12)
    )
  );

  // -------------------------------------------------------------------------
  // Street market stalls + food carts (pedagang kaki lima). Each prefab is a
  // handful of primitives baked into ONE vertex-colored geometry, then drawn as
  // a single InstancedMesh — colorful and low-poly, but cheap (2 draw calls for
  // every stall and cart on the street). Scattered on corners near intersections.
  // -------------------------------------------------------------------------
  const paint = (geo, hex) => {
    const c = new THREE.Color(hex);
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return geo;
  };

  // A booth: legs, a red-cloth table with goods, four posts and a striped awning.
  function buildStall() {
    const parts = [];
    const post = '#5a4632';
    for (const lx of [-1.0, 1.0])
      for (const lz of [-0.55, 0.55])
        parts.push(paint(new THREE.BoxGeometry(0.12, 1.0, 0.12).translate(lx, 0.5, lz), post));
    parts.push(paint(new THREE.BoxGeometry(2.3, 0.14, 1.3).translate(0, 1.02, 0), '#d94f4f')); // cloth
    for (const px of [-1.05, 1.05])
      for (const pz of [-0.6, 0.6])
        parts.push(paint(new THREE.BoxGeometry(0.1, 1.65, 0.1).translate(px, 1.85, pz), post));
    const stripes = 8;
    const cw = 2.6 / stripes;
    for (let s = 0; s < stripes; s++) {
      const x = -1.3 + (s + 0.5) * cw;
      parts.push(paint(new THREE.BoxGeometry(cw * 0.98, 0.1, 1.7).translate(x, 2.68, 0), s % 2 ? '#f4ecd8' : '#e23b3b'));
    }
    const goods = ['#ffcf5a', '#4bb39a', '#ff8c42'];
    for (let g = 0; g < 3; g++)
      parts.push(paint(new THREE.BoxGeometry(0.3, 0.3, 0.3).translate(-0.7 + g * 0.7, 1.24, 0.1), goods[g]));
    return mergeGeometries(parts);
  }

  // A little cart: body, counter, two wheels, a handle and a striped umbrella.
  function buildCart() {
    const parts = [];
    const handle = '#5a4632';
    parts.push(paint(new THREE.BoxGeometry(1.7, 0.7, 0.95).translate(0, 0.95, 0), '#2fa39a'));
    parts.push(paint(new THREE.BoxGeometry(1.5, 0.5, 0.85).translate(0, 0.55, 0), '#1f7a73'));
    parts.push(paint(new THREE.BoxGeometry(1.85, 0.12, 1.05).translate(0, 1.34, 0), '#f4ecd8'));
    for (const wz of [-0.5, 0.5]) {
      parts.push(paint(new THREE.CylinderGeometry(0.34, 0.34, 0.14, 10).rotateX(Math.PI / 2).translate(-0.15, 0.34, wz), '#2b2b2b'));
      parts.push(paint(new THREE.CylinderGeometry(0.12, 0.12, 0.16, 8).rotateX(Math.PI / 2).translate(-0.15, 0.34, wz), '#8a8a8a'));
    }
    parts.push(paint(new THREE.BoxGeometry(0.9, 0.08, 0.08).translate(1.2, 1.0, 0), handle));
    parts.push(paint(new THREE.BoxGeometry(0.08, 1.2, 0.08).translate(-0.3, 1.95, -0.2), handle));
    const stripes = 6;
    const uw = 2.2 / stripes;
    for (let s = 0; s < stripes; s++) {
      const x = -1.1 + (s + 0.5) * uw;
      parts.push(paint(new THREE.BoxGeometry(uw * 0.98, 0.09, 1.5).translate(x - 0.3, 2.55, -0.2), s % 2 ? '#f4ecd8' : '#ffb43b'));
    }
    parts.push(paint(new THREE.BoxGeometry(0.4, 0.28, 0.4).translate(0.4, 1.53, 0), '#d94f4f')); // pot
    return mergeGeometries(parts);
  }

  const marketMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
  const stallGeo = buildStall();
  const cartGeo = buildCart();

  const stallPlace = [];
  const cartPlace = [];
  for (let i = 0; i <= blocks; i++) {
    for (let j = 0; j <= blocks; j++) {
      if (rng() > 0.4) continue; // only some corners get a vendor
      const rx = -half + i * stride - road / 2;
      const rz = -half + j * stride - road / 2;
      const sx = rng() < 0.5 ? -1 : 1;
      const sz = rng() < 0.5 ? -1 : 1;
      const d = road / 2 + 2.3;
      const x = rx + sx * d;
      const z = rz + sz * d;
      if (insideBuilding(x, z) || inPark(x, z)) continue;
      const yaw = Math.atan2(-sx, -sz); // face back toward the intersection
      (rng() < 0.5 ? stallPlace : cartPlace).push({ x, z, yaw });
      // Solid enough that you bump into it rather than walk through.
      const r = 1.0;
      colliders.push(
        new THREE.Box3(
          new THREE.Vector3(x - r, 0, z - r),
          new THREE.Vector3(x + r, 1.6, z + r)
        )
      );
    }
  }

  const marketDummy = new THREE.Object3D();
  const fillMarket = (geo, list) => {
    const im = new THREE.InstancedMesh(geo, marketMat, list.length);
    im.castShadow = true;
    im.receiveShadow = true;
    for (let k = 0; k < list.length; k++) {
      marketDummy.position.set(list[k].x, 0, list[k].z);
      marketDummy.rotation.set(0, list[k].yaw, 0);
      marketDummy.updateMatrix();
      im.setMatrixAt(k, marketDummy.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
  };
  fillMarket(stallGeo, stallPlace);
  fillMarket(cartGeo, cartPlace);

  // -------------------------------------------------------------------------
  // Neo-Tokyo street details — glowing vending machines, red paper lanterns,
  // traffic signals, tangled overhead power cables, alley clutter, bicycles and
  // little food stalls. Every repeated prop is an InstancedMesh (a dozen-odd
  // draw calls total). Glowing parts join `neonMats`, so they ramp up at night.
  // -------------------------------------------------------------------------
  const streetDummy = new THREE.Object3D();
  const streetCol = new THREE.Color();
  function instProps(geo, mat, list, { shadow = true, applyColor = false } = {}) {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    im.castShadow = shadow;
    im.receiveShadow = shadow;
    let colored = false;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      streetDummy.position.set(p.x, p.y || 0, p.z);
      streetDummy.rotation.set(0, p.ry || 0, 0);
      streetDummy.scale.setScalar(p.s || 1);
      streetDummy.updateMatrix();
      im.setMatrixAt(i, streetDummy.matrix);
      if (applyColor && p.c !== undefined) { im.setColorAt(i, streetCol.set(p.c)); colored = true; }
    }
    im.instanceMatrix.needsUpdate = true;
    if (colored && im.instanceColor) im.instanceColor.needsUpdate = true;
    group.add(im);
  }

  // Glowing parts keep a dark diffuse so the emissive dominates; night raises
  // emissiveIntensity (via neonMats) and the bloom pass halos them.
  const vendGlowMat = new THREE.MeshToonMaterial({ color: 0x141414, emissive: new THREE.Color(0xfff0d2), emissiveIntensity: 0.45, gradientMap });
  const lanternGlowMat = new THREE.MeshToonMaterial({ color: 0x330a06, emissive: new THREE.Color(0xff3a1e), emissiveIntensity: 0.45, gradientMap });
  neonMats.push(vendGlowMat, lanternGlowMat);
  // Traffic-signal lenses are lit day + night (unlit vertex colours, bloom-able).
  const lensMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  const cableMat = new THREE.MeshToonMaterial({ color: 0x191920, gradientMap });

  // ---- Prop geometries (built once, faces +Z) ----
  const vendStructGeo = merge([
    box(1.1, 1.9, 0.72, 0, 1.05, 0, C.white),        // cabinet (tinted per instance)
    box(1.18, 0.22, 0.8, 0, 0.11, 0, C.black),       // base
    box(0.5, 0.3, 0.1, 0.26, 0.72, 0.36, C.black),   // pickup tray
    box(1.12, 0.16, 0.76, 0, 2.02, 0, C.metalDark),  // top cap
  ]);
  const vendGlowGeo = merge([
    box(0.86, 1.05, 0.05, 0, 1.4, 0.37, C.glassWarm),// product window
    box(0.92, 0.14, 0.05, 0, 0.52, 0.38, C.glassWarm),// button strip
  ]);

  // Bicycle — sized to the human reference (a ~4-unit person can actually ride
  // it): wheels ~0.72r, saddle + bars around hip/chest height, real wheelbase.
  const bR = 0.72;
  const bWheel = (x) => cyl(bR, bR, 0.14, 14, x, bR, 0, C.black, [Math.PI / 2, 0, 0]);
  const bRim = (x) => cyl(bR * 0.58, bR * 0.58, 0.08, 12, x, bR, 0, C.steel, [Math.PI / 2, 0, 0]);
  const bikeGeo = merge([
    bWheel(-1.15), bWheel(1.15), bRim(-1.15), bRim(1.15),
    cyl(0.09, 0.09, 2.35, 6, 0, 1.32, 0, C.teal, [0, 0, Math.PI / 2]),   // top tube (coloured frame)
    box(0.12, 1.2, 0.12, -0.95, 1.3, 0, C.teal),                        // seat tube
    box(0.12, 1.4, 0.12, 1.05, 1.42, 0, C.teal, [0, 0, -0.4]),          // head tube (raked)
    cyl(0.08, 0.08, 1.4, 6, 0.5, 1.05, 0, C.teal, [0, 0, 0.5]),         // down tube
    box(0.12, 0.12, 1.0, 1.12, 2.02, 0, C.metalDark),                   // handlebar (across)
    box(0.6, 0.22, 0.42, -0.95, 2.04, 0, C.woodDark),                   // saddle
    cyl(0.18, 0.18, 0.1, 8, 0, 0.62, 0, C.metalDark, [Math.PI / 2, 0, 0]), // chainring
    box(0.09, 0.52, 0.09, 0, 0.55, 0.2, C.black, [0.5, 0, 0]),          // crank arm
    box(0.3, 0.07, 0.15, 0, 0.32, 0.36, C.black),                       // pedal
  ]);

  const clutterAGeo = merge([                                              // stacked crates
    box(0.9, 0.7, 0.8, 0, 0.35, 0, C.woodDark),
    box(0.8, 0.6, 0.7, 0.06, 0.98, 0.05, C.wood),
    box(0.7, 0.5, 0.6, -0.1, 1.5, -0.05, C.sand),
  ]);
  const clutterBGeo = merge([                                              // bin + trash bags
    cyl(0.34, 0.3, 0.9, 10, -0.4, 0.45, 0, C.metalDark),
    cyl(0.36, 0.36, 0.1, 10, -0.4, 0.95, 0, C.grey),
    blob(0.42, 0.4, 0.4, 0.1, C.concreteDark),
    blob(0.34, 0.55, 0.32, -0.35, C.grey),
    blob(0.3, 0.15, 0.28, 0.4, C.woodDark),
  ]);

  const stallStructGeo = merge([
    box(2.6, 0.9, 1.3, 0, 0.45, 0, C.wood),          // counter
    box(2.85, 0.14, 1.5, 0, 0.97, 0, C.woodDark),    // counter top
    ...[[-1.2, -0.55], [1.2, -0.55], [-1.2, 0.55], [1.2, 0.55]].map(([x, z]) => cyl(0.06, 0.06, 2.0, 6, x, 1.0, z, C.metalDark)),
    box(3.1, 0.18, 1.8, 0, 2.05, 0, C.red),          // roof
    box(3.14, 0.12, 0.44, 0, 1.82, 0.9, C.redDark),  // valance
    ...[-0.85, 0, 0.85].map((x) => box(0.5, 0.5, 0.5, x, 0.25, 1.15, C.woodDark)), // stools
  ]);
  const stallGlowGeo = merge([
    box(2.7, 0.42, 0.05, 0, 1.62, 0.92, C.glassWarm),// lit signage strip under the eave
  ]);

  // Lantern string: dark string + caps (struct) + 3 glowing red bodies (glow).
  const lanternStructGeo = merge([
    box(1.8, 0.05, 0.05, 0, 0, 0, C.black),
    ...[-0.6, 0, 0.6].flatMap((x) => [
      box(0.14, 0.06, 0.14, x, -0.06, 0, C.black),
      box(0.12, 0.05, 0.12, x, -0.72, 0, C.black),
    ]),
  ]);
  const lanternGlowGeo = merge(
    [-0.6, 0, 0.6].map((x) => cyl(0.24, 0.24, 0.5, 10, x, -0.38, 0, C.red))
  );

  const signalStructGeo = merge([
    cyl(0.1, 0.13, 5, 8, 0, 2.5, 0, C.metalDark),    // pole
    box(0.44, 1.25, 0.4, 0, 4.6, 0, C.black),        // 3-light housing
    box(0.52, 0.16, 0.48, 0, 5.28, 0, C.metalDark),  // hood
  ]);
  const signalLensGeo = merge([
    cyl(0.14, 0.14, 0.06, 10, 0, 4.96, 0.2, '#ff3131', [Math.PI / 2, 0, 0]), // red
    cyl(0.14, 0.14, 0.06, 10, 0, 4.6, 0.2, '#ffe11a', [Math.PI / 2, 0, 0]),  // amber
    cyl(0.14, 0.14, 0.06, 10, 0, 4.24, 0.2, '#39ff88', [Math.PI / 2, 0, 0]), // green
  ]);

  // Tall, sturdier utility pole — stands clearly above the 1–2 story shops,
  // reaching roughly a 3rd–4th floor height, with its cross-arms + insulators up
  // near the top so cables run high over the street.
  const poleGeo = merge([
    cyl(0.19, 0.28, 13, 6, 0, 6.5, 0, C.woodDark),   // pole shaft (top at y≈13)
    box(1.8, 0.16, 0.16, 0, 12.1, 0, C.woodDark),    // upper cross-arm (cables attach here)
    box(1.3, 0.14, 0.14, 0, 11.55, 0, C.woodDark),   // lower cross-arm
    ...[-0.7, 0, 0.7].map((x) => box(0.13, 0.22, 0.13, x, 12.32, 0, C.grey)), // insulators
    box(0.6, 0.85, 0.4, 0.32, 8.6, 0.14, C.metalDark), // transformer can (mid-pole)
  ]);

  // ---- Placement ----
  const vendP = [], bikeP = [], clutAP = [], clutBP = [], stallP = [], lanternP = [], signalP = [], poleP = [];
  const VEND_TINT = ['#d63a2e', '#2f6bd0', '#2f9a5a', '#e8e4dc', '#e0b13a'];

  // A prop spot is a point off the tarmac, out of the park, and NOT inside a
  // building box (no buffer — props hug the walls of the narrow sidewalks).
  function propSpot(x, z) {
    if (onRoad(x, z) || inPark(x, z)) return false;
    if (x < -half - 4 || x > half + 4 || z < -half - 4 || z > half + 4) return false;
    for (let i = 0; i < colliders.length; i++) {
      const b = colliders[i];
      if (x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z) return false;
    }
    return true;
  }

  const swOff = road / 2 + 0.55; // the thin sidewalk strip between road and wall
  for (let i = 0; i <= blocks; i++) {
    const rc = -half + i * stride - road / 2;
    for (let t = -half + 3; t <= half - 3; t += 4.5) {
      const cands = [
        { x: rc + swOff, z: t, ry: -Math.PI / 2 },
        { x: rc - swOff, z: t, ry: Math.PI / 2 },
        { x: t, z: rc + swOff, ry: Math.PI },
        { x: t, z: rc - swOff, ry: 0 },
      ];
      for (const cd of cands) {
        if (!propSpot(cd.x, cd.z)) continue;
        const r = rng();
        if (r < 0.05) vendP.push({ x: cd.x, z: cd.z, ry: cd.ry, c: VEND_TINT[Math.floor(rng() * VEND_TINT.length)] });
        else if (r < 0.10) bikeP.push({ x: cd.x, z: cd.z, ry: cd.ry + (rng() - 0.5) * 0.6 });
        else if (r < 0.19) (rng() < 0.5 ? clutAP : clutBP).push({ x: cd.x, z: cd.z, ry: rng() * Math.PI * 2, s: 0.85 + rng() * 0.4 });
        else if (r < 0.215) {
          stallP.push({ x: cd.x, z: cd.z, ry: cd.ry });
          lanternP.push({ x: cd.x, y: 2.7, z: cd.z, ry: cd.ry, s: 0.9 + rng() * 0.3 });
        } else if (r < 0.235) {
          lanternP.push({ x: cd.x, y: 3.0 + rng() * 0.6, z: cd.z, ry: cd.ry, s: 0.9 + rng() * 0.4 });
        }
      }
    }
  }

  // Traffic signals — one per interior intersection, on a corner facing the road.
  for (let i = 1; i < blocks; i++) {
    for (let j = 1; j < blocks; j++) {
      const rx = -half + i * stride - road / 2;
      const rz = -half + j * stride - road / 2;
      if (inPark(rx, rz)) continue;
      const cs = [
        { x: rx + swOff + 0.5, z: rz + swOff + 0.5, ry: -Math.PI / 2 },
        { x: rx - swOff - 0.5, z: rz + swOff + 0.5, ry: Math.PI / 2 },
        { x: rx - swOff - 0.5, z: rz - swOff - 0.5, ry: Math.PI / 2 },
        { x: rx + swOff + 0.5, z: rz - swOff - 0.5, ry: -Math.PI / 2 },
      ][Math.floor(rng() * 4)];
      if (propSpot(cs.x, cs.z)) { cs.gx = i; cs.gz = j; signalP.push(cs); }
    }
  }

  // Utility poles down one side of every road, kept as sequences for stringing.
  const poleSpans = [];
  const poleTopY = 12.2; // cables attach up at the cross-arm, well clear of the street
  for (let i = 0; i <= blocks; i++) {
    const rc = -half + i * stride - road / 2;
    const seqV = [], seqH = [];
    for (let b = 0; b < blocks; b++) {
      const c = -half + b * stride + blockSize / 2;
      if (propSpot(rc + swOff, c)) { poleP.push({ x: rc + swOff, z: c, ry: 0 }); seqV.push(new THREE.Vector3(rc + swOff, poleTopY, c)); }
      if (propSpot(c, rc + swOff)) { poleP.push({ x: c, z: rc + swOff, ry: Math.PI / 2 }); seqH.push(new THREE.Vector3(c, poleTopY, rc + swOff)); }
    }
    if (seqV.length > 1) poleSpans.push(seqV);
    if (seqH.length > 1) poleSpans.push(seqH);
  }

  // Cables — sagging tubes between consecutive poles + random diagonal crossings,
  // all merged into ONE mesh (one draw call for the whole tangle).
  const cableTubes = [];
  const addCable = (a, b, sag, rad = 0.035) => {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y -= sag;
    cableTubes.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, mid, b]), 10, rad, 4, false));
  };
  for (const seq of poleSpans) {
    for (let k = 0; k + 1 < seq.length; k++) {
      const a = seq[k], b = seq[k + 1];
      // Gentle sag only — cables stay high above the street (never droop low).
      const sag = Math.min(0.8, a.distanceTo(b) * 0.025);
      for (let n = 0; n < 3; n++) {
        const off = (n - 1) * 0.22;
        const a2 = a.clone(), b2 = b.clone();
        a2.set(a.x + off, a.y + off * 0.6, a.z + off);
        b2.set(b.x + off, b.y + off * 0.6, b.z + off);
        addCable(a2, b2, sag + Math.abs(off) * 0.4);
      }
    }
  }
  for (let n = 0; n < poleP.length; n++) {
    if (rng() < 0.55) continue; // only some poles start a crossing
    const a = new THREE.Vector3(poleP[n].x, poleTopY, poleP[n].z);
    let best = -1, bestD = Infinity;
    for (let m = 0; m < poleP.length; m++) {
      if (m === n) continue;
      const dx = poleP[m].x - poleP[n].x, dz = poleP[m].z - poleP[n].z;
      const d = dx * dx + dz * dz;
      if (d > 120 && d < 800 && d < bestD) { bestD = d; best = m; }
    }
    // Crossings attach near both cross-arms and only sag gently.
    if (best >= 0) addCable(a, new THREE.Vector3(poleP[best].x, poleTopY - 0.25, poleP[best].z), 0.5 + rng() * 0.5);
  }
  if (cableTubes.length) {
    const cableMesh = new THREE.Mesh(mergeGeometries(cableTubes), cableMat);
    cableMesh.castShadow = false;
    cableMesh.receiveShadow = false;
    group.add(cableMesh);
  }

  // ---- Instance everything ----
  instProps(vendStructGeo, marketMat, vendP, { applyColor: true });
  instProps(vendGlowGeo, vendGlowMat, vendP, { shadow: false });
  instProps(bikeGeo, marketMat, bikeP);
  instProps(clutterAGeo, marketMat, clutAP);
  instProps(clutterBGeo, marketMat, clutBP);
  instProps(stallStructGeo, marketMat, stallP);
  instProps(stallGlowGeo, vendGlowMat, stallP, { shadow: false });
  instProps(lanternStructGeo, marketMat, lanternP, { shadow: false });
  instProps(lanternGlowGeo, lanternGlowMat, lanternP, { shadow: false });
  instProps(signalStructGeo, marketMat, signalP);
  // The lenses are NOT instanced here any more: traffic.js builds them so it can
  // light one at a time from the live signal state. signalP is exported below.
  instProps(poleGeo, marketMat, poleP);

  // -------------------------------------------------------------------------
  // Elevated sky-train — a rounded-rectangle monorail loop that threads ACROSS
  // the city, riding above the avenues (the roads are already clear of
  // buildings, so nothing needs demolishing). A four-car train loops it forever.
  // Returns monorail.update(dt), driven from the main animation loop.
  // -------------------------------------------------------------------------
  const monorail = (() => {
    const rcoord = (i) => -half + i * stride - road / 2; // road-centre coordinate
    const x0 = rcoord(1), x1 = rcoord(blocks - 1);
    const z0 = rcoord(1), z1 = rcoord(blocks - 1);
    const trackY = 12.5, cr = 16;

    // Sample the rounded-rectangle centre-line into a closed world-space loop.
    const pts = [];
    const push = (x, z) => pts.push(new THREE.Vector3(x, trackY, z));
    const edge = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(2, Math.round(len / 12));
      for (let s = 0; s < n; s++) { const f = s / n; push(ax + (bx - ax) * f, az + (bz - az) * f); }
    };
    const arcSeg = (ccx, ccz, a0, a1) => {
      const n = 6;
      for (let s = 0; s < n; s++) { const a = a0 + (a1 - a0) * (s / n); push(ccx + Math.cos(a) * cr, ccz + Math.sin(a) * cr); }
    };
    edge(x1, z0 + cr, x1, z1 - cr);                           // east avenue
    arcSeg(x1 - cr, z1 - cr, 0, Math.PI / 2);                 // NE corner
    edge(x1 - cr, z1, x0 + cr, z1);                           // north avenue
    arcSeg(x0 + cr, z1 - cr, Math.PI / 2, Math.PI);           // NW corner
    edge(x0, z1 - cr, x0, z0 + cr);                           // west avenue
    arcSeg(x0 + cr, z0 + cr, Math.PI, Math.PI * 1.5);         // SW corner
    edge(x0 + cr, z0, x1 - cr, z0);                           // south avenue
    arcSeg(x1 - cr, z0 + cr, Math.PI * 1.5, Math.PI * 2);     // SE corner
    const NP = pts.length;

    // Cumulative arc length for smooth constant-speed train motion.
    const segLen = [];
    const cum = [0];
    let total = 0;
    for (let i = 0; i < NP; i++) {
      const d = pts[i].distanceTo(pts[(i + 1) % NP]);
      segLen.push(d); total += d; cum.push(total);
    }

    const monoMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
    // Guideway beam + lower rail as merged struts.
    const beamParts = [];
    for (let i = 0; i < NP; i++) {
      const a = pts[i], b = pts[(i + 1) % NP];
      beamParts.push(strut(a.x, a.y, a.z, b.x, b.y, b.z, 1.8, '#c2c6cc'));
      beamParts.push(strut(a.x, a.y - 1.2, a.z, b.x, b.y - 1.2, b.z, 0.9, '#8a8f97'));
    }
    const beam = new THREE.Mesh(merge(beamParts), monoMat);
    beam.castShadow = beam.receiveShadow = true;
    group.add(beam);

    // Support columns — NEVER on the road. Columns stand at BLOCK CENTRES (mid-
    // block, far from every cross-road), stepped sideways onto the ~1-unit strip
    // between the road edge and the building line, and a cantilever arm reaches
    // out over the road to carry the continuous beam. Placing them mid-block (not
    // at points along the avenue) guarantees no column ever lands on a driving
    // lane or an intersection; the corner arcs stay unsupported over crossings.
    const offOff = road / 2 + 1.4; // clear of the road edge → fully on the roadside verge
    const colH = trackY - 0.7;
    const pillarParts = [];
    const addColumn = (ox, oz, bx, bz) => {
      pillarParts.push(box(1.0, colH, 1.0, ox, colH / 2, oz, '#9aa0a6'));      // column (on the verge)
      pillarParts.push(box(1.2, 0.5, 1.2, ox, 0.25, oz, '#6f747c'));           // footing (kept off the road)
      pillarParts.push(strut(ox, colH, oz, bx, colH, bz, 0.55, '#8a8f97'));    // cantilever arm over the road
      pillarParts.push(box(1.2, 1.0, 1.2, bx, trackY - 0.6, bz, '#8a8f97'));   // bracket under the beam
      colliders.push(new THREE.Box3(
        new THREE.Vector3(ox - 0.6, 0, oz - 0.6),
        new THREE.Vector3(ox + 0.6, trackY, oz + 0.6)
      ));
    };
    for (let b = 0; b < blocks; b++) {
      const c = -half + b * stride + blockSize / 2; // block-centre coordinate
      if (c > z0 + cr && c < z1 - cr) {             // east + west avenues (vertical)
        addColumn(x1 + offOff, c, x1, c);           //  → outer verge, arm reaches -x to the beam
        addColumn(x0 - offOff, c, x0, c);
      }
      if (c > x0 + cr && c < x1 - cr) {             // north + south avenues (horizontal)
        addColumn(c, z1 + offOff, c, z1);
        addColumn(c, z0 - offOff, c, z0);
      }
    }
    const pillars = new THREE.Mesh(merge(pillarParts), monoMat);
    pillars.castShadow = pillars.receiveShadow = true;
    group.add(pillars);

    // ---- Elevated MRT stations --------------------------------------------
    // One at the mid-point of each of the four avenues (well spread, on the
    // straight sections, clear of the corner arcs). Each has a platform beside
    // the guideway, a stair to the ground, a canopy, benches and name signs.
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const midX = (x0 + x1) / 2, midZ = (z0 + z1) / 2;
    const stationDefs = [
      { name: 'SHIBUYA', mid: V(midX, trackY, z0), along: V(1, 0, 0), perp: V(0, 0, 1) },  // south
      { name: 'GINZA', mid: V(x1, trackY, midZ), along: V(0, 0, 1), perp: V(-1, 0, 0) },   // east
      { name: 'UENO', mid: V(midX, trackY, z1), along: V(1, 0, 0), perp: V(0, 0, -1) },    // north
      { name: 'SHINJUKU', mid: V(x0, trackY, midZ), along: V(0, 0, 1), perp: V(1, 0, 0) }, // west
    ];
    const STA_PLAT = '#cfd3d8', STA_EDGE = '#e8c24a', STA_ROOF = '#46536a';
    const STA_ROOF_D = '#333d4e', STA_STEEL = '#8a8f97', STA_WOOD = '#8a6a44';
    // Train dimensions (human reference: character ≈ 4 units tall). A carriage is
    // clearly bigger than a person: ~1.6× as tall and ~3.7 characters long.
    const carLen = 15, carW = 4.4, carH = 6.4;
    const rideY = trackY + 0.9;               // car floor sits on top of the guideway beam
    const platLen = 28, platW = 11.6, platThick = 0.5;
    // The deck bridges from beside the train (inner edge) across the road edge onto
    // the reserved plaza, so the stairs + supports come down on LAND, not the road.
    const platOff = carW / 2 + 0.5 + platW / 2; // ≈ 8.5 → platform centre well past the road edge
    const deckTop = rideY + 0.5;              // platform deck ≈ the train's floor / door sill
    const deckY = deckTop - platThick / 2;
    const roofY = deckTop + carH + 1.4;       // canopy clears the taller train + headroom
    const stN = 20, stRun = 0.85, stW = 3.4;  // stairs → a walkable ramp, down onto the plaza

    const staParts = [];      // merged toon structure
    const staGlowParts = [];  // warm under-canopy strip (ramps at night)
    const brickParts = [];    // brick safety wall closing the stairless platform end
    const staGlowMat = new THREE.MeshToonMaterial({
      color: 0x2a2620, gradientMap, emissive: new THREE.Color(0xffdca0), emissiveIntensity: 0,
    });
    buildingMats.push(staGlowMat);
    const brickMat = new THREE.MeshToonMaterial({ map: makeBrickTexture(), gradientMap });
    const stationsInfo = [];  // { name, stopS, x, z } per station — train stops + boarding

    for (const st of stationDefs) {
      const { mid, along, perp, name } = st;
      const pcx = mid.x + perp.x * platOff, pcz = mid.z + perp.z * platOff;
      // Local box: aS along the track, pS across; placed at (aP along, y, pP across).
      const put = (arr, aS, pS, h, aP, yP, pP, color) => {
        const cx = pcx + along.x * aP + perp.x * pP;
        const cz = pcz + along.z * aP + perp.z * pP;
        const wx = Math.abs(along.x) * aS + Math.abs(perp.x) * pS;
        const wz = Math.abs(along.z) * aS + Math.abs(perp.z) * pS;
        arr.push(box(wx, h, wz, cx, yP, cz, color));
      };
      // Deck + track-edge warning strip.
      put(staParts, platLen, platW, platThick, 0, deckY, 0, STA_PLAT);
      put(staParts, platLen, 0.25, 0.16, 0, deckTop + 0.05, -platW / 2 + 0.2, STA_EDGE);
      // Canopy roof + fascia.
      put(staParts, platLen * 0.94, platW + 1.0, 0.3, 0, roofY, 0.1, STA_ROOF);
      put(staParts, platLen * 0.94, 0.5, 0.55, 0, roofY - 0.45, -platW / 2 - 0.35, STA_ROOF_D);
      // Roof posts + outer railing.
      for (const aP of [-platLen * 0.42, -platLen * 0.14, platLen * 0.14, platLen * 0.42])
        put(staParts, 0.28, 0.28, roofY - deckTop, aP, (roofY + deckTop) / 2, platW / 2 - 0.4, STA_STEEL);
      put(staParts, platLen, 0.12, 0.6, 0, deckTop + 0.55, platW / 2 - 0.06, STA_STEEL);
      for (const aP of [-platLen * 0.45, -platLen * 0.15, platLen * 0.15, platLen * 0.45])
        put(staParts, 0.1, 0.1, 0.6, aP, deckTop + 0.3, platW / 2 - 0.06, STA_STEEL);
      // Benches (seat + back), facing the track.
      for (const aP of [-platLen * 0.3, 0, platLen * 0.3]) {
        put(staParts, 2.4, 0.9, 0.16, aP, deckTop + 0.42, platW * 0.16, STA_WOOD);
        put(staParts, 2.4, 0.14, 0.5, aP, deckTop + 0.68, platW * 0.16 + 0.34, STA_WOOD);
      }
      // Warm under-canopy light strip (night glow).
      put(staGlowParts, platLen * 0.9, 0.16, 0.12, 0, roofY - 0.2, 0.1, '#ffffff');

      // Stairs from the platform end down to the ground (visual steps; the
      // player walks a smooth ramp — see groundHeightAt below, no blocking box).
      const stRise = deckTop / stN, stW2 = stW / 2;
      const stA0 = -platLen / 2;
      for (let i = 0; i < stN; i++) {
        const aP = stA0 - (i + 0.5) * stRun;
        const yTop = deckTop - (i + 0.5) * stRise;
        put(staParts, stRun + 0.06, stW, 0.16, aP, yTop, 0, STA_PLAT);
        put(staParts, stRun + 0.06, 0.12, yTop, aP, yTop / 2, -stW2 + 0.06, STA_STEEL);
        put(staParts, stRun + 0.06, 0.12, yTop, aP, yTop / 2, stW2 - 0.06, STA_STEEL);
      }
      const stairBottomA = stA0 - stN * stRun;
      put(staParts, 0.7, 0.7, deckTop, stairBottomA + 0.3, deckTop / 2, stW2 + 0.6, STA_STEEL); // stair-side support
      put(staParts, 0.9, 0.9, deckTop, 0, deckTop / 2, platW / 2 - 0.5, STA_STEEL);              // deck support

      // Perimeter railings — DECK-HEIGHT colliders (not ground-to-top), so they
      // keep you on the deck up top but leave the road/plaza surface below clear.
      // Climbing onto the deck from the sides is already prevented by the
      // controller's max-step-up; the stair mouth is the only walkable way up.
      const bar = (aP, pP, aS, pS) => {
        const bcx = pcx + along.x * aP + perp.x * pP;
        const bcz = pcz + along.z * aP + perp.z * pP;
        const wx = Math.abs(along.x) * aS + Math.abs(perp.x) * pS;
        const wz = Math.abs(along.z) * aS + Math.abs(perp.z) * pS;
        colliders.push(new THREE.Box3(V(bcx - wx / 2, deckTop, bcz - wz / 2), V(bcx + wx / 2, deckTop + 1.6, bcz + wz / 2)));
      };
      bar(0, platW / 2, platLen, 0.3);        // outer edge
      bar(0, -platW / 2, platLen, 0.3);       // track edge
      bar(platLen / 2, 0, 0.3, platW);        // far end

      // The far end has no stairs — close it off with a full-height brick safety
      // wall (a ~1.1 m parapet) so nobody can walk off that end of the platform.
      const wallH = 2.4;
      put(brickParts, 0.5, platW, wallH, platLen / 2 - 0.25, deckTop + wallH / 2, 0, '#9c4b3b');
      put(staParts, 0.7, platW + 0.2, 0.18, platLen / 2 - 0.25, deckTop + wallH + 0.09, 0, STA_ROOF_D); // coping cap
      const flankW = platW / 2 - stW2, flankC = (stW2 + platW / 2) / 2;
      bar(-platLen / 2, flankC, 0.3, flankW); // near end, outer flank of the stair mouth
      bar(-platLen / 2, -flankC, 0.3, flankW);// near end, track flank

      // Name signs — SUSPENDED below the canopy fascia edge on hanger rods, so
      // they sit in open air clear of the roof (no clipping / z-fighting). Two
      // back-to-back boards (track + platform facing), each nudged onto its own
      // side by a hair so the pair never z-fights either.
      const signTex = makeStationSign(name);
      const signMat = new THREE.MeshToonMaterial({
        map: signTex, gradientMap, emissive: 0xffffff, emissiveMap: signTex,
        emissiveIntensity: 0.45, side: THREE.DoubleSide,
      });
      const signPlane = new THREE.PlaneGeometry(6.4, 1.5);
      const signY = roofY - 1.9;          // hangs well below the fascia (roofY-0.7)
      const signPerp = -platW / 2 - 0.3;  // at the roof edge, out toward the track
      const trackYaw = Math.atan2(-perp.x, -perp.z);
      for (const aP of [-2.3, 2.3]) put(staParts, 0.08, 0.08, 0.9, aP, signY + 1.15, signPerp, STA_STEEL); // hanger rods
      for (const facing of [0, Math.PI]) {
        const sm = new THREE.Mesh(signPlane, signMat);
        const dir = facing === 0 ? -1 : 1;  // -perp = faces track, +perp = faces platform
        sm.position.set(pcx + perp.x * (signPerp + dir * 0.05), signY, pcz + perp.z * (signPerp + dir * 0.05));
        sm.rotation.y = trackYaw + facing;
        group.add(sm);
      }

      // Train stop = arc length of the loop sample nearest this station.
      let bi = 0, bd = Infinity;
      for (let i = 0; i < NP; i++) {
        const dd = (pts[i].x - mid.x) ** 2 + (pts[i].z - mid.z) ** 2;
        if (dd < bd) { bd = dd; bi = i; }
      }
      const deckSpotA = -platLen / 2 + 3;
      stationsInfo.push({
        name, stopS: cum[bi], x: pcx, z: pcz, along, perp, stairBottomA,
        upYaw: Math.atan2(along.x, along.z),                             // facing up the stairs
        stairBottom: { x: pcx + along.x * stairBottomA, z: pcz + along.z * stairBottomA },
        deckSpot: { x: pcx + along.x * deckSpotA, z: pcz + along.z * deckSpotA },
      });

      // Station POI (feeds the minimap + POI list).
      shopResult.pois.push({ x: pcx, z: pcz, label: name + ' STATION', short: name, color: '#3a7bd0' });
    }
    stationsInfo.sort((a, b) => a.stopS - b.stopS); // ordered along the loop
    const stationMesh = new THREE.Mesh(merge(staParts), monoMat);
    stationMesh.castShadow = stationMesh.receiveShadow = true;
    group.add(stationMesh);
    group.add(new THREE.Mesh(merge(staGlowParts), staGlowMat));
    const brickMesh = new THREE.Mesh(merge(brickParts), brickMat);
    brickMesh.castShadow = brickMesh.receiveShadow = true;
    group.add(brickMesh);

    // Walkable ground height: platform deck (flat) + stair ramp (smooth incline
    // under the visual steps), 0 everywhere else. Fed to the third-person controller.
    const stW2Tol = stW / 2 + 0.35; // stair walk half-width (a little forgiving)
    const groundHeightAt = (x, z) => {
      let h = 0;
      for (const s of stationsInfo) {
        const dx = x - s.x, dz = z - s.z;
        const aP = dx * s.along.x + dz * s.along.z;
        const pP = dx * s.perp.x + dz * s.perp.z;
        if (aP >= -platLen / 2 && aP <= platLen / 2 && Math.abs(pP) <= platW / 2) {
          if (deckTop > h) h = deckTop;
        } else if (aP >= s.stairBottomA && aP < -platLen / 2 && Math.abs(pP) <= stW2Tol) {
          const hh = deckTop * (aP - s.stairBottomA) / (-platLen / 2 - s.stairBottomA);
          if (hh > h) h = hh;
        }
      }
      return h;
    };

    // Train: a realistic low-poly EMU (see buildTrain) — nose car + coupled
    // middle carriages — that cruises the loop, halts at each station to open its
    // sliding doors for a few seconds, then continues forever.
    const monoGlowMat = new THREE.MeshToonMaterial({
      color: 0x1a2028, gradientMap, emissive: new THREE.Color(0xbfe0ff), emissiveIntensity: 0,
    });
    buildingMats.push(monoGlowMat); // train windows warm up at night with the city

    const CARS = 4;
    const { cars, carDoors } = buildTrain({ carLen, carW, carH, CARS, monoMat, monoGlowMat });
    for (const car of cars) group.add(car);

    const carGap = carLen + 1.4; // tight enough that the gangway rings bridge the gaps
    const midIdx = (CARS - 1) / 2;
    const sampleAt = (s, car) => {
      s = ((s % total) + total) % total;
      let seg = 0;
      while (seg < NP - 1 && s >= cum[seg + 1]) seg++;
      const a = pts[seg], b = pts[(seg + 1) % NP];
      const f = segLen[seg] > 0 ? (s - cum[seg]) / segLen[seg] : 0;
      car.position.set(a.x + (b.x - a.x) * f, rideY, a.z + (b.z - a.z) * f);
      car.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    };

    // Stop schedule (already sorted along the loop) + accel/cruise/brake model.
    const stops = stationsInfo.map((s) => s.stopS);
    const CRUISE = 24, ACCEL = 11, DWELL = 4.0, DOOR_T = 0.7, DOOR_TRAVEL = 1.5;
    const distAhead = (from, to) => { let d = (to - from) % total; if (d < 0) d += total; return d; };

    let sHead = stops[0] + 25;             // reference (middle) car arc position
    let vel = 0, targetIdx = 1 % stops.length, dwellT = -1, doorOpen = 0;

    function update(dt) {
      if (dwellT >= 0) {                    // stopped at a station
        dwellT += dt;
        doorOpen = dwellT < DOOR_T ? dwellT / DOOR_T
          : dwellT > DWELL - DOOR_T ? Math.max(0, (DWELL - dwellT) / DOOR_T) : 1;
        if (dwellT >= DWELL) { dwellT = -1; doorOpen = 0; targetIdx = (targetIdx + 1) % stops.length; }
      } else {                              // running toward the next stop
        const d = distAhead(sHead, stops[targetIdx]);
        const vDes = Math.min(CRUISE, Math.sqrt(Math.max(0, 2 * ACCEL * d))); // brake to 0 at the stop
        vel += Math.sign(vDes - vel) * Math.min(ACCEL * dt, Math.abs(vDes - vel));
        const stepS = vel * dt;
        if (stepS >= d - 0.05) { sHead = stops[targetIdx]; vel = 0; dwellT = 0; } // arrived
        else sHead = (sHead + stepS) % total;
      }
      for (let i = 0; i < CARS; i++) sampleAt(sHead + (midIdx - i) * carGap, cars[i]);
      for (const doors of carDoors)
        for (const dr of doors) dr.mesh.position.z = dr.base + dr.sign * DOOR_TRAVEL * doorOpen;
    }
    // Accurate arrival prediction: replay the exact accel/cruise/brake/dwell
    // model on a copy of the live state until it next halts at `stationIdx`.
    function eta(stationIdx) {
      if (dwellT >= 0 && targetIdx === stationIdx) return 0; // boarding now
      let s = sHead, v = vel, dw = dwellT, tg = targetIdx, t = 0;
      const DT = 0.1;
      for (let g = 0; g < 8000; g++) {
        if (dw >= 0) { dw += DT; if (dw >= DWELL) { dw = -1; tg = (tg + 1) % stops.length; } }
        else {
          const d = distAhead(s, stops[tg]);
          const vDes = Math.min(CRUISE, Math.sqrt(Math.max(0, 2 * ACCEL * d)));
          v += Math.sign(vDes - v) * Math.min(ACCEL * DT, Math.abs(vDes - v));
          const step = v * DT;
          if (step >= d - 0.05) { s = stops[tg]; v = 0; dw = 0; if (tg === stationIdx) return t + DT; }
          else s = (s + step) % total;
        }
        t += DT;
      }
      return t;
    }
    // Full arrival-to-arrival period (same for every station) → the "then" time.
    function computePeriod() {
      let s = stops[0], v = 0, dw = -1, tg = 1 % stops.length, t = 0;
      const DT = 0.1;
      for (let g = 0; g < 16000; g++) {
        if (dw >= 0) { dw += DT; if (dw >= DWELL) { dw = -1; tg = (tg + 1) % stops.length; } }
        else {
          const d = distAhead(s, stops[tg]);
          const vDes = Math.min(CRUISE, Math.sqrt(Math.max(0, 2 * ACCEL * d)));
          v += Math.sign(vDes - v) * Math.min(ACCEL * DT, Math.abs(vDes - v));
          const step = v * DT;
          if (step >= d - 0.05) { s = stops[tg]; v = 0; dw = 0; if (tg === 0) return t + DWELL; }
          else s = (s + step) % total;
        }
        t += DT;
      }
      return t;
    }
    const period = computePeriod();

    // Which platform (if any) a point at height y is standing on.
    const platformIndexAt = (x, z, y) => {
      if (y < deckTop - 1.5) return -1;
      for (let i = 0; i < stationsInfo.length; i++) {
        const s = stationsInfo[i];
        const dx = x - s.x, dz = z - s.z;
        const aP = dx * s.along.x + dz * s.along.z;
        const pP = dx * s.perp.x + dz * s.perp.z;
        if (aP >= -platLen / 2 && aP <= platLen / 2 && Math.abs(pP) <= platW / 2) return i;
      }
      return -1;
    };

    update(0);
    return {
      update,
      // Live pose of the train (middle car) for the onboard ride camera.
      getRide: () => ({ x: cars[1].position.x, y: cars[1].position.y, z: cars[1].position.z, yaw: cars[1].rotation.y }),
      // The station the train is currently halted at (doors dwelling), else null.
      getStoppedStation: () => (dwellT >= 0 ? stationsInfo[targetIdx] : null),
      stoppedIndex: () => (dwellT >= 0 ? targetIdx : -1),
      groundHeightAt, stations: stationsInfo, eta, period, platformIndexAt,
      // Platform dimensions, so waiting commuters can be placed on the deck and
      // queue against the track edge (perp = -platW/2 is the trackside).
      platLen, platW, deckTop,
    };
  })();

  // Spawn on the main road just south of the park (facing into it), clear of
  // the fountain that now occupies the city centre.
  const spawn = new THREE.Vector3(parkCX, 0, parkMinZ - road / 2);

  // POI markers for the minimap come from the shop builder (real positions).
  const pois = shopResult.pois;

  // Enterable shops: a door point out in front of every restaurant / minimart /
  // café so the player can walk up and press E. `type` matches an interior room.
  const ENTERABLE = { restaurant: 1, minimarket: 1, cafe: 1 };
  const enterableDoors = [];
  for (const p of shopPlacements) {
    const t = SHOP_TYPES[p.typeIdx];
    if (!ENTERABLE[t.key]) continue;
    const d = (t.foot.d / 2) * p.scale + 2.2;           // stand-out distance from the shop centre
    enterableDoors.push({
      x: p.x + Math.sin(p.yaw) * d,
      z: p.z + Math.cos(p.yaw) * d,
      yaw: p.yaw,
      type: t.key,
      label: t.label,
    });
  }

  // Service points for the needs/economy system: a spot on the pavement in
  // front of EVERY shop, tagged with its type, plus the park benches. main.js
  // decides which types sell what — this just says where the counters are.
  // Shops you can walk into keep `enterable`, so pressing E there opens the
  // door instead of buying at the kerb (you buy inside).
  const serviceSpots = [];
  for (const p of shopPlacements) {
    const t = SHOP_TYPES[p.typeIdx];
    const d = (t.foot.d / 2) * p.scale + 2.2;
    serviceSpots.push({
      x: p.x + Math.sin(p.yaw) * d,
      z: p.z + Math.cos(p.yaw) * d,
      yaw: p.yaw,          // faces out of the shop, toward the street
      type: t.key,
      label: t.label,
      enterable: !!ENTERABLE[t.key],
    });
  }
  for (const b of benchSpots) serviceSpots.push({ x: b.x, z: b.z, type: 'bench', label: 'BENCH', enterable: false });

  scene.add(group);
  return {
    group,
    colliders,
    enterableDoors,
    serviceSpots,
    signalSpots: signalP,   // traffic.js lights these
    bounds: half,
    windTime,
    grass,
    parkGrass,
    spawn,
    lamps: { material: bulbMat, positions: bulbPositions },
    buildingMats,
    neonMats,
    monorail,
    shops: { update: shopResult.update, fx: shopResult.steamGroup },
    park: { b0: parkB0, b1: parkB1, minX: parkMinX, maxX: parkMaxX },
    map: {
      roads: mapRoads,
      footprints,
      pois,
      towerSpot: { x: towerSpot.x, z: towerSpot.z },
      landHalf: (total + 52) / 2,
      roadLines: {
        xs: Array.from({ length: blocks + 1 }, (_, i) => -half + i * stride - road / 2),
        centralX: -half + centralRoadIdx * stride - road / 2,
      },
      park: {
        minX: parkMinX,
        maxX: parkMaxX,
        minZ: parkMinZ,
        maxZ: parkMaxZ,
        cx: parkCX,
        cz: parkCZ,
        ringR: parkRingR,
        fountainR: 12,
      },
    },
  };
}
