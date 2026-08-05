import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Splits generic_passenger_car_pack.glb into individual, road-ready vehicles.
//
// The pack is a Sketchfab display turntable: ten car bodies named `*_Body`
// arranged in a ring on a `Cylinder001` plinth, with all forty wheels as
// SIBLING nodes rather than children of the cars. Each body is rotated to face
// along its own radius, so every model sits at a different angle and there is
// no single "forward" for the file.
//
// For each car this module therefore:
//   1. groups the body with its four nearest wheels (that assignment is exact —
//      the ring is sparse enough that nearest-four never crosses cars),
//   2. finds the length axis by PCA over the body vertices,
//   3. resolves which END of that axis is the front — see FRONT_SIGN below,
//   4. bakes a canonical transform into the geometry: origin at the centre of
//      the footprint, wheels exactly on y = 0, front facing +Z,
//   5. merges everything into ONE geometry with per-material groups, so a whole
//      car type is a single InstancedMesh.
//
// After that the traffic system only has to supply a position and a yaw.

// ---------------------------------------------------------------------------
// Which end of each car's PCA length-axis is the FRONT (+1 = the axis
// direction, -1 = the opposite end).
//
// This is not a guess. The pack's ten cars share one `Optics` texture atlas, so
// the lamp colours were read straight out of it offline: every optics triangle
// was sampled at its UV and classified as red or white. Red tail lamps mark the
// rear, white headlamps the front, and the two centroids were compared along
// the length axis. (glTF puts the UV origin at the TOP-LEFT — sampling the
// decoded PNG with a flipped V mirrors the atlas and silently inverts the
// answer for half the pack.)
//
// That was then cross-checked against a completely independent geometric
// signal — the roofline profile, where the cabin sits behind the bonnet — and
// the two methods agree on all ten. If any car still drives backwards in game,
// flipping its sign here is the whole fix.
const FRONT_SIGN = {
  Compact_Body: +1,
  Coupe_Body: +1,
  Hatchback_Body: +1,
  minivan_body: +1,
  Offroad_Body: -1,
  Pickup_Body: +1,
  Sedan_Body: -1,
  Sport_body: -1,
  SUV_Body: -1,
  Wagon_Body: -1,
};

// Friendly names for the HUD / logs, in pack order.
const NICE_NAME = {
  Compact_Body: 'compact', Coupe_Body: 'coupe', Hatchback_Body: 'hatchback',
  minivan_body: 'minivan', Offroad_Body: 'offroader', Pickup_Body: 'pickup',
  Sedan_Body: 'sedan', Sport_body: 'sports car', SUV_Body: 'SUV', Wagon_Body: 'wagon',
};

// The city is built to a human reference: the character is 4 units ≈ 1.8 m, so
// 1 unit ≈ 0.45 m and the roads are 12 units (≈ 5.4 m) wide. Scaling the whole
// pack by ONE factor keeps the models' relative sizes (a pickup stays longer
// than a compact) and is pinned so the sedan comes out at 9.5 units ≈ 4.3 m —
// the same length the old procedural sedan used, which is what the lane offsets
// and the avoidance spacing were tuned around.
const SEDAN_TARGET_LENGTH = 9.5;

// Only position/normal/uv are kept, so geometries from different source meshes
// can be merged into one buffer with groups.
function normalizeAttributes(geo) {
  const keep = ['position', 'normal', 'uv'];
  for (const name of Object.keys(geo.attributes)) {
    if (!keep.includes(name)) geo.deleteAttribute(name);
  }
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) {
    // The glass material carries no map, so its meshes ship without UVs.
    const n = geo.attributes.position.count;
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  }
  return geo;
}

// The pack exports metalness 1 / roughness 1. With no environment map in this
// scene a fully metallic surface has nothing to reflect and renders black, so
// every car would be a silhouette. Retune to painted bodywork and keep the maps.
function tuneMaterial(mat, kind) {
  const m = mat.clone();
  m.side = THREE.FrontSide;
  if (kind === 'Glass') {
    m.metalness = 0.1; m.roughness = 0.12;
    m.color.setHex(0x2b333d);          // the pack ships pure black glass
  } else if (kind === 'Wheel') {
    m.metalness = 0.15; m.roughness = 0.8;
  } else if (kind === 'Optics') {
    m.metalness = 0.0; m.roughness = 0.25;
  } else {
    m.metalness = 0.18; m.roughness = 0.5; // body paint
  }
  return m;
}

/**
 * Load the pack and return one ready-to-instance entry per car.
 * Each entry: { key, name, geometry (grouped), materials[], length, width, height }
 * `onReady(cars)` fires once, with the cars sorted by length.
 */
export function loadCarPack(opts = {}) {
  const { url = `${import.meta.env?.BASE_URL ?? '/'}models/generic_passenger_car_pack.glb`,
    onReady = () => {}, onError = () => {} } = opts;

  new GLTFLoader().load(url, (gltf) => {
    try {
      onReady(extract(gltf.scene));
    } catch (e) {
      console.error('car pack: extraction failed', e);
      onError(e);
    }
  }, undefined, (e) => {
    console.error('car pack: failed to load', url, e);
    onError(e);
  });
}

function extract(root) {
  root.updateMatrixWorld(true);

  // Split the pack into car bodies and loose wheels. `Cylinder001` is the
  // turntable plinth the models are displayed on, not a vehicle.
  const bodyNodes = [];
  const wheelNodes = [];
  root.traverse((o) => {
    if (o.isMesh || !o.name) return;
    if (!o.children.some((c) => c.isMesh)) return;
    if (/^cylinder/i.test(o.name)) return;
    const bb = new THREE.Box3().setFromObject(o);
    const rec = { node: o, name: o.name, ctr: bb.getCenter(new THREE.Vector3()) };
    (/^wheel/i.test(o.name) ? wheelNodes : bodyNodes).push(rec);
  });

  const raw = [];
  for (const b of bodyNodes) {
    const bodyMesh = b.node.children.find((c) => c.isMesh && /Body_0$/.test(c.name));
    if (!bodyMesh) continue;

    // ---- length axis by PCA over the body's world-space vertices ------------
    bodyMesh.updateWorldMatrix(true, false);
    const pos = bodyMesh.geometry.attributes.position;
    const v = new THREE.Vector3();
    let mx = 0, mz = 0;
    const pts = [];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(bodyMesh.matrixWorld);
      pts.push(v.clone()); mx += v.x; mz += v.z;
    }
    mx /= pts.length; mz /= pts.length;
    let sxx = 0, szz = 0, sxz = 0;
    for (const q of pts) {
      const dx = q.x - mx, dz = q.z - mz;
      sxx += dx * dx; szz += dz * dz; sxz += dx * dz;
    }
    // Identical formula to the offline lamp-colour analysis, so FRONT_SIGN
    // refers to exactly this axis direction.
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    const sign = FRONT_SIGN[b.name] ?? 1;
    const fx = Math.cos(ang) * sign, fz = Math.sin(ang) * sign;
    // Yaw that carries the car's forward vector onto +Z (three's rotateY maps
    // x' = x·cosθ + z·sinθ, z' = −x·sinθ + z·cosθ).
    const theta = Math.atan2(-fx, fz);

    // ---- the four nearest wheels belong to this car ------------------------
    const wheels = wheelNodes
      .map((w) => ({ w, d: (w.ctr.x - b.ctr.x) ** 2 + (w.ctr.z - b.ctr.z) ** 2 }))
      .sort((p, q) => p.d - q.d)
      .slice(0, 4)
      .map((r) => r.w);

    // ---- bake position → centred, upright, facing +Z -----------------------
    // Bucketed by material kind so the merged geometry ends up with one group
    // per material instead of one per source mesh.
    const byKind = new Map();
    const addMesh = (mesh) => {
      const kindMatch = mesh.name.match(/_([A-Za-z]+)_0$/);
      const kind = kindMatch ? kindMatch[1] : 'Body';
      mesh.updateWorldMatrix(true, false);
      const g = normalizeAttributes(mesh.geometry.clone());
      g.applyMatrix4(mesh.matrixWorld);   // into pack world space
      g.translate(-mx, 0, -mz);           // origin to the car's own centre
      g.rotateY(theta);                   // front to +Z
      if (!byKind.has(kind)) byKind.set(kind, { geos: [], material: mesh.material });
      byKind.get(kind).geos.push(g);
    };
    for (const c of b.node.children) if (c.isMesh) addMesh(c);
    for (const wn of wheels) for (const c of wn.node.children) if (c.isMesh) addMesh(c);

    raw.push({ key: b.name, byKind, theta });
  }

  // ---- one uniform scale for the whole pack --------------------------------
  // Measured off the sedan so the fleet keeps the pack's own proportions.
  const measure = (entry) => {
    const bb = new THREE.Box3();
    const tmp = new THREE.Vector3();
    for (const { geos } of entry.byKind.values()) {
      for (const g of geos) {
        g.computeBoundingBox();
        bb.union(g.boundingBox);
      }
    }
    return { bb, size: bb.getSize(tmp.clone()) };
  };
  const sedan = raw.find((r) => r.key === 'Sedan_Body') || raw[0];
  const scale = SEDAN_TARGET_LENGTH / Math.max(measure(sedan).size.z, 0.001);

  const cars = [];
  for (const entry of raw) {
    const { bb } = measure(entry);
    const cx = (bb.min.x + bb.max.x) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    const floor = bb.min.y;

    const geos = [];
    const materials = [];
    for (const [kind, { geos: list, material }] of entry.byKind) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) continue;
      // Centre on the footprint, drop the wheels onto y = 0, then scale.
      merged.translate(-cx, -floor, -cz);
      merged.scale(scale, scale, scale);
      geos.push(merged);
      materials.push(tuneMaterial(material, kind));
    }
    const geometry = mergeGeometries(geos, true); // useGroups → one group per material
    if (!geometry) continue;
    geometry.computeBoundingBox();
    const size = geometry.boundingBox.getSize(new THREE.Vector3());

    cars.push({
      key: entry.key,
      name: NICE_NAME[entry.key] || entry.key,
      geometry,
      materials,
      length: size.z,
      width: size.x,
      height: size.y,
      groups: geometry.groups.length,
    });
  }

  cars.sort((a, b) => a.length - b.length);
  return cars;
}
