import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import {
  VRMLoaderPlugin, VRMUtils, VRMHumanoid,
  VRMSpringBoneManager, VRMSpringBoneJoint, VRMSpringBoneCollider,
} from '@pixiv/three-vrm';

// Loads the five VRoid avatars ONCE and hands out skeleton-aware clones, so
// every person in the city can be a real VRM without paying for five model
// loads per person.
//
// three-vrm has no `VRM.clone()`, so each avatar is rebuilt by hand:
//   1. `SkeletonUtils.clone` duplicates the rig. Geometry and textures are
//      SHARED with the source — a clone costs a bone hierarchy and a skeleton
//      texture (a few hundred KB), not a second model.
//   2. Cloned spring-bone COLLIDERS are stripped: `Object3D.clone()` rebuilds
//      nodes via `new this.constructor()`, so a cloned VRMSpringBoneCollider
//      keeps its class but has `shape === undefined`, and its
//      `updateWorldMatrix` override throws the moment anything traverses it.
//   3. The humanoid is rebuilt with `new VRMHumanoid(bones)`, mapping each human
//      bone to the cloned node of the same name. That regenerates the NORMALIZED
//      rig, which is what lets one shared walk cycle (humanoidPose.js) drive
//      every model with identical numbers.
//   4. Spring bones are rebuilt joint by joint against the cloned nodes.
//   5. Materials are cloned per avatar (texture refs are shared, so this is
//      cheap) so each person can wear a different outfit tint.
//
// Each avatar also exposes two LOD handles the crowd drives by distance:
//   `setDetail(on)`  the small facial meshes — eyelashes, brows, eye highlights,
//                    mouth — are invisible past a few metres but each is a full
//                    DRAW CALL, so switching them off cuts ~35% of an avatar's
//                    draw calls for nothing you can see.
//   `setShadow(on)`  shadow casting, budgeted to the nearest few.

const MODELS = ['milo1', 'ling1', 'corck1', 'aoka1', 'kimi1'];
export const VRM_MODEL_COUNT = MODELS.length;

// A facial detail mesh: named Face* by the VRoid exporter and tiny. The main
// head and skin meshes are 1.7k–4.2k triangles and stay in at every distance.
const DETAIL_MAX_TRIS = 900;

function isDetailMesh(mesh) {
  if (!/^face/i.test(mesh.name)) return false;
  const g = mesh.geometry;
  const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
  return tris < DETAIL_MAX_TRIS;
}

// Rebuild a humanoid for a cloned rig by matching bone NAMES — SkeletonUtils
// preserves them, so the source's raw bone map says which cloned node plays
// which humanoid role.
function rebuildHumanoid(srcVrm, cloneRoot, nameMap) {
  const srcBones = srcVrm.humanoid.rawHumanBones;
  const humanBones = {};
  for (const boneName of Object.keys(srcBones)) {
    const srcNode = srcBones[boneName]?.node;
    if (!srcNode) continue;
    const node = nameMap.get(srcNode.name);
    if (node) humanBones[boneName] = { node };
  }
  if (!humanBones.hips) return null; // hips is the only bone the spec demands
  const humanoid = new VRMHumanoid(humanBones);
  // The normalized rig is a parallel bone tree; it has to live in the graph or
  // its world matrices never update (this is what VRMLoaderPlugin does too).
  cloneRoot.add(humanoid.normalizedHumanBonesRoot);
  return humanoid;
}

// Rebuild spring bones against the cloned nodes. Collider shapes are stateless
// with respect to the instance, so they're shared with the source.
function rebuildSpringBones(srcVrm, nameMap) {
  const srcMgr = srcVrm.springBoneManager;
  if (!srcMgr || srcMgr.joints.size === 0) return null;

  const manager = new VRMSpringBoneManager();
  const groupMap = new Map();

  for (const group of srcMgr.colliderGroups) {
    const colliders = [];
    for (const col of group.colliders) {
      const parent = col.parent ? nameMap.get(col.parent.name) : null;
      if (!parent) continue;
      const nc = new VRMSpringBoneCollider(col.shape);
      nc.name = col.name;
      nc.position.copy(col.position);
      nc.quaternion.copy(col.quaternion);
      nc.scale.copy(col.scale);
      parent.add(nc);
      colliders.push(nc);
    }
    groupMap.set(group, { name: group.name, colliders });
  }

  let added = 0;
  for (const joint of srcMgr.joints) {
    const bone = nameMap.get(joint.bone.name);
    if (!bone) continue;
    const child = joint.child ? nameMap.get(joint.child.name) || null : null;
    const groups = joint.colliderGroups.map((g) => groupMap.get(g)).filter(Boolean);
    manager.addJoint(new VRMSpringBoneJoint(bone, child, joint.settings, groups));
    added++;
  }
  if (!added) return null;
  manager.setInitState();
  return manager;
}

/**
 * Build one avatar from a loaded source VRM. Exported (rather than buried in
 * the factory) so it can be exercised against the real .vrm files without a GPU.
 *
 * @returns an avatar, or null if the rig couldn't be rebuilt
 */
export function createAvatar(srcVrm, fit, modelIdx, modelName = '?', mtoonOutlines = false) {
  let model;
  try {
    model = skeletonClone(srcVrm.scene);
  } catch (e) {
    console.error('VRM library: skeleton clone failed for', modelName, e);
    return null;
  }

  // Strip the broken cloned colliders BEFORE anything else touches the graph
  // (see note 2 at the top). rebuildSpringBones recreates them properly.
  const broken = [];
  model.traverse((o) => { if (o instanceof VRMSpringBoneCollider) broken.push(o); });
  for (const c of broken) c.removeFromParent();

  const nameMap = new Map();
  model.traverse((o) => { if (o.name && !nameMap.has(o.name)) nameMap.set(o.name, o); });

  const humanoid = rebuildHumanoid(srcVrm, model, nameMap);
  if (!humanoid) {
    console.error('VRM library: no humanoid rebuilt for', modelName);
    return null;
  }

  let springs = null;
  try {
    springs = rebuildSpringBones(srcVrm, nameMap);
  } catch (e) {
    console.warn('VRM library: spring bones unavailable for', modelName, e);
  }

  // Per-avatar materials so people can be tinted individually. `clone()` copies
  // uniforms but shares texture objects, so this costs no VRAM.
  //
  // This is also the biggest per-avatar saving. three-vrm draws MToon outlines
  // by turning `mesh.material` into [surface, outline] over two geometry groups
  // — a SECOND draw call and a second rasterization of every triangle, roughly
  // doubling an avatar's cost. This scene already draws its own screen-space ink
  // outline over the whole frame, so for the crowd the geometric outline pays
  // twice for the same look. Hiding the cloned outline material skips the draw
  // call outright (the renderer checks `material.visible` per group) without
  // touching the shared geometry. The player's own VRM keeps its real outline.
  const tintMats = [];
  const detailMeshes = [];
  const meshes = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    meshes.push(o);
    o.frustumCulled = false; // we cull whole avatars ourselves; skinned bounds go stale
    o.receiveShadow = false; // crowd avatars only ever cast
    if (isDetailMesh(o)) detailMeshes.push(o);
    const wasArray = Array.isArray(o.material);
    const mats = wasArray ? o.material : [o.material];
    const cloned = mats.map((m) => {
      if (!m) return m;
      try {
        const c = m.clone();
        if (c.isOutline && !mtoonOutlines) c.visible = false;
        if (c.color) c.userData._baseColor = c.color.clone();
        return c;
      } catch (e) {
        return m; // shared fallback — this avatar just can't be tinted
      }
    });
    o.material = wasArray ? cloned : cloned[0];
    for (const m of cloned) if (m && m.color && m.visible) tintMats.push(m);
  });

  // root carries the world placement; the model inside is scaled to the
  // library's base height and pushed down so the feet sit on y = 0.
  model.scale.setScalar(fit);
  const bb = new THREE.Box3().setFromObject(model);
  model.position.y -= bb.min.y;

  const root = new THREE.Group();
  root.add(model);
  root.visible = false;
  root.matrixWorldAutoUpdate = false; // off-screen avatars cost nothing to traverse

  const bones = {};
  for (const n of [
    'hips', 'spine', 'chest', 'head',
    'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
    'leftFoot', 'rightFoot',
    'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm',
  ]) bones[n] = humanoid.getNormalizedBoneNode(n);

  const avatar = {
    modelIdx, root, model, humanoid, springs, bones, tintMats, meshes, detailMeshes,
    // The RAW head bone is the one the visible mesh follows, so anything parented
    // to it (a nurse's cap, a hat) rides along for free.
    rawHead: humanoid.getRawBoneNode('head'),
    hipsRestY: bones.hips ? bones.hips.position.y : 0,
    _detail: true,
    _shadow: false,
    setDetail(on) {
      if (avatar._detail === on) return;
      avatar._detail = on;
      for (let i = 0; i < detailMeshes.length; i++) detailMeshes[i].visible = on;
    },
    setShadow(on) {
      if (avatar._shadow === on) return;
      avatar._shadow = on;
      for (let i = 0; i < meshes.length; i++) meshes[i].castShadow = on;
    },
    setTint(color) {
      for (const m of tintMats) {
        if (m.userData._baseColor) m.color.copy(m.userData._baseColor).multiply(color);
      }
    },
    /**
     * Recolour only the CLOTHING. VRoid tags every material with its role —
     * `_CLOTH`, `_SKIN`, `_HAIR`, `_FACE`, `_EYE` — so a uniform can be applied
     * without turning the wearer's skin and hair the same colour.
     * @param color  multiplied over the garment's own texture
     * @param match  which garments (default: all cloth). e.g. /Shoes/ for shoes.
     */
    tintClothing(color, match = /_CLOTH/i) {
      let n = 0;
      for (const m of tintMats) {
        if (!m.userData._baseColor || !match.test(m.name || '')) continue;
        m.color.copy(m.userData._baseColor).multiply(color);
        n++;
      }
      return n;
    },
  };
  avatar.setShadow(false);
  return avatar;
}

/**
 * Load the five models, then call `onReady(library)`.
 * `library.make(modelIdx)` returns a fresh avatar clone.
 */
export function createVrmLibrary(opts = {}) {
  const { baseHeight = 4, mtoonOutlines = false, onReady = () => {} } = opts;

  const sources = new Array(MODELS.length).fill(null);
  let pending = MODELS.length;

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  MODELS.forEach((name, modelIdx) => {
    loader.load(
      // Optional-chained so the module can also be driven outside Vite (the
      // headless crowd test); Vite still substitutes the env object statically.
      `${import.meta.env?.BASE_URL ?? '/'}models/${name}.vrm`,
      (gltf) => {
        const vrm = gltf.userData.vrm;
        VRMUtils.rotateVRM0(vrm); // normalise VRM0 → faces +Z like VRM1
        try { VRMUtils.removeUnnecessaryVertices(gltf.scene); } catch (e) {}
        try { VRMUtils.combineSkeletons(gltf.scene); } catch (e) {}

        const size = new THREE.Vector3();
        new THREE.Box3().setFromObject(vrm.scene).getSize(size);
        sources[modelIdx] = { vrm, name, fit: baseHeight / Math.max(size.y, 0.001) };
        if (--pending === 0) onReady(library);
      },
      undefined,
      (err) => {
        console.error('VRM library: failed to load', name, err);
        if (--pending === 0) onReady(library);
      }
    );
  });

  const library = {
    baseHeight,
    // Nearest available model to the one asked for (so a failed load degrades
    // to a different avatar instead of an invisible person).
    make(modelIdx) {
      for (let i = 0; i < MODELS.length; i++) {
        const src = sources[(modelIdx + i) % MODELS.length];
        if (!src) continue;
        const a = createAvatar(src.vrm, src.fit, modelIdx, src.name, mtoonOutlines);
        if (a) return a;
      }
      return null;
    },
    get loadedCount() { return sources.filter(Boolean).length; },
  };
  return library;
}

// The five models are ~26 MB of textures; every caller shares ONE library so
// they're parsed once. The first caller's options win.
let _shared = null;
export function sharedVrmLibrary(opts = {}) {
  if (!_shared) {
    const waiting = [];
    let ready = false;
    const lib = createVrmLibrary({
      ...opts,
      onReady: (l) => { ready = true; for (const cb of waiting.splice(0)) cb(l); if (opts.onReady) opts.onReady(l); },
    });
    _shared = {
      lib,
      whenReady(cb) { if (ready) cb(lib); else waiting.push(cb); },
    };
  } else if (opts.onReady) {
    _shared.whenReady(opts.onReady);
  }
  return _shared.lib;
}

export function onVrmLibraryReady(cb) {
  if (!_shared) { sharedVrmLibrary({}); }
  _shared.whenReady(cb);
}
