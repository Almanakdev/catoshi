import * as THREE from 'three';
import { makeToonGradient } from './textures.js';

// NPC pedestrians: simple blocky low-poly people strolling looping routes
// around the city blocks (on the sidewalk strip where the block meets the
// road). Built for cheapness: every body part is the SAME shared unit box
// geometry scaled per part, materials come from a small shared pool, and the
// walk cycle is pure procedural animation (sin swing on hip/shoulder pivots).

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

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

export function createNPCs(scene, opts = {}) {
  const {
    blocks = 8,
    blockSize = 34,
    road = 12,
    count = 18,
    seed = 4242,
    parkB0 = null, // central park block range to avoid (pedestrians don't loop it)
    parkB1 = null,
  } = opts;

  const isParkBlock = (bx, bz) =>
    parkB0 !== null && bx >= parkB0 && bx <= parkB1 && bz >= parkB0 && bz <= parkB1;

  const rng = mulberry32(seed);
  const stride = blockSize + road;
  const half = (blocks * stride) / 2;

  const gradientMap = makeToonGradient(4);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1); // ONE geometry for every part

  // Small shared material pools — colorful crowd, few unique materials.
  const toon = (c) => new THREE.MeshToonMaterial({ color: c, gradientMap });
  const skins = [0xe8b48c, 0xc98d5f, 0x8d5a3b, 0xf0c9a2].map(toon);
  const shirts = [0xd94f4f, 0x2fa39a, 0xffb43b, 0x4a86c5, 0x8e6bb5, 0xf4ecd8].map(toon);
  const pants = [0x6b5a45, 0x33475b, 0x8a8a8a, 0x4f5a4a].map(toon);
  const hairs = [0x3a2a1a, 0x1f1f22, 0x8a5a34, 0xd9d0c0].map(toon);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  const group = new THREE.Group();
  const npcs = [];

  // One blocky person. Root sits at the feet; legs/arms hang from pivot
  // groups hinged at hip/shoulder so the walk cycle can swing them.
  function buildPerson() {
    const g = new THREE.Group();
    const body = new THREE.Group(); // gets the walk bob
    g.add(body);

    const skin = pick(skins);
    const shirt = pick(shirts);
    const pant = pick(pants);
    const hair = pick(hairs);

    const part = (mat, sx, sy, sz, x, y, z, parent = body, shadow = false) => {
      const m = new THREE.Mesh(boxGeo, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      m.castShadow = shadow; // only the big parts cast — keeps the shadow pass cheap
      parent.add(m);
      return m;
    };

    // Torso, head, hair cap.
    const torso = part(shirt, 0.62, 0.72, 0.36, 0, 1.28, 0, body, true);
    const head = part(skin, 0.42, 0.42, 0.42, 0, 1.9, 0, body, true);
    const hairM = part(hair, 0.46, 0.16, 0.46, 0, 2.12, 0);

    // Legs — pivots at the hip.
    const legL = new THREE.Group();
    legL.position.set(-0.16, 0.92, 0);
    const legLm = part(pant, 0.22, 0.92, 0.26, 0, -0.46, 0, legL, true);
    const legR = new THREE.Group();
    legR.position.set(0.16, 0.92, 0);
    const legRm = part(pant, 0.22, 0.92, 0.26, 0, -0.46, 0, legR, true);
    body.add(legL, legR);

    // Arms — pivots at the shoulder.
    const armL = new THREE.Group();
    armL.position.set(-0.4, 1.58, 0);
    const armLm = part(shirt, 0.16, 0.66, 0.2, 0, -0.33, 0, armL);
    const armR = new THREE.Group();
    armR.position.set(0.4, 1.58, 0);
    const armRm = part(shirt, 0.16, 0.66, 0.2, 0, -0.33, 0, armR);
    body.add(armL, armR);

    g.scale.setScalar(1.4 + rng() * 0.5); // varied heights
    // The group hierarchy is a transform SOURCE only (never added to the scene);
    // the meshes are rendered as instances (see below), so the crowd is 7 draw
    // calls total instead of ~7 per person.
    return { g, body, legL, legR, armL, armR, meshes: { torso, head, hair: hairM, legLm, legRm, armLm, armRm } };
  }

  // A looping sidewalk ring around one city block — four corners walked
  // forever. `inset` staggers rings so two NPCs on the same block don't overlap.
  function blockRing(bx, bz, inset) {
    const cx = -half + bx * stride + blockSize / 2;
    const cz = -half + bz * stride + blockSize / 2;
    const s = blockSize / 2 + 1.4 + inset;
    return [
      new THREE.Vector3(cx - s, 0, cz - s),
      new THREE.Vector3(cx + s, 0, cz - s),
      new THREE.Vector3(cx + s, 0, cz + s),
      new THREE.Vector3(cx - s, 0, cz + s),
    ];
  }

  for (let i = 0; i < count; i++) {
    const person = buildPerson();

    // Random block (never the central park), random ring offset and direction.
    let bx;
    let bz;
    let guard = 0;
    do {
      bx = Math.floor(rng() * blocks);
      bz = Math.floor(rng() * blocks);
    } while (isParkBlock(bx, bz) && ++guard < 30);
    const ring = blockRing(bx, bz, rng() * 2.4);
    if (rng() < 0.5) ring.reverse();

    // Start partway along a random segment so the crowd doesn't sync up.
    const segIdx = Math.floor(rng() * 4);
    const t0 = rng();
    const a = ring[segIdx];
    const b = ring[(segIdx + 1) % 4];
    person.g.position.lerpVectors(a, b, t0);

    const npc = {
      ...person,
      ring,
      target: (segIdx + 1) % 4,
      speed: 2.2 + rng() * 1.4, // a stroll, slower than the player
      phase: rng() * Math.PI * 2,
      heading: Math.atan2(b.x - a.x, b.z - a.z),
      state: 'walk',            // 'walk' | 'down' (knocked over, recovering)
      reactT: 0,
      fall: 0,
      fallDir: 1,
      knock: new THREE.Vector3(),
    };
    person.g.rotation.y = npc.heading;
    person.g.matrixAutoUpdate = true; // updated manually each frame (off-scene)
    npcs.push(npc);
  }

  scene.add(group);

  // ---- Instance the crowd: one InstancedMesh per body part across ALL people.
  // Each frame we drive the (off-scene) person groups' animation, recompute their
  // world matrices, and copy each part's matrix into its InstancedMesh — identical
  // pixels, a handful of draw calls. Per-instance colour reproduces the palette.
  const PART_KEYS = ['torso', 'head', 'hair', 'legLm', 'legRm', 'armLm', 'armRm'];
  const PART_SHADOW = { torso: 1, head: 1, hair: 0, legLm: 1, legRm: 1, armLm: 0, armRm: 0 };
  const npcMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap }); // × per-instance colour
  const partIMs = {};
  for (const n of npcs) n.g.updateMatrixWorld(true); // initial pose
  for (const key of PART_KEYS) {
    const im = new THREE.InstancedMesh(boxGeo, npcMat, npcs.length);
    im.castShadow = !!PART_SHADOW[key];
    im.receiveShadow = false;
    im.frustumCulled = false; // instances move every frame — a 20-strong crowd is cheap to always draw
    for (let i = 0; i < npcs.length; i++) {
      const mesh = npcs[i].meshes[key];
      im.setMatrixAt(i, mesh.matrixWorld);
      im.setColorAt(i, mesh.material.color);
    }
    im.instanceMatrix.needsUpdate = true;
    im.instanceColor.needsUpdate = true;
    group.add(im);
    partIMs[key] = im;
  }

  const dir = new THREE.Vector3(); // scratch
  const HIT_RANGE = 4.0;

  // When knocked down: stumble backward + tip over, lie still, then get back up
  // and resume — the whole thing lasts a couple of seconds.
  function reactUpdate(n, dt) {
    n.reactT += dt;
    if (n.reactT < 0.45) {                  // stumbling backward + falling
      n.fall = n.reactT / 0.45;
      n.g.position.addScaledVector(n.knock, dt);
      n.knock.multiplyScalar(Math.max(0, 1 - dt * 4));
    } else if (n.reactT < 1.9) {
      n.fall = 1;                            // down on the ground
    } else if (n.reactT < 2.5) {
      n.fall = 1 - (n.reactT - 1.9) / 0.6;   // getting up
    } else {
      n.state = 'walk';                      // recovered — resume the stroll
      n.fall = 0; n.g.rotation.x = 0;
      n.legL.rotation.x = n.legR.rotation.x = 0;
      n.armL.rotation.x = n.armR.rotation.x = 0;
      return;
    }
    n.g.rotation.x = n.fall * (Math.PI * 0.47) * n.fallDir; // tip over (pivots at the feet)
    n.legL.rotation.x = 0.25; n.legR.rotation.x = -0.2;     // sprawled limbs
    n.armL.rotation.x = 1.3; n.armR.rotation.x = 1.1;
  }

  function update(dt) {
    for (let i = 0; i < npcs.length; i++) {
      const n = npcs[i];
      if (n.state !== 'walk') { reactUpdate(n, dt); continue; }

      const tgt = n.ring[n.target];
      dir.subVectors(tgt, n.g.position);
      dir.y = 0;
      const dist = dir.length();

      // Corner reached — loop on to the next one.
      if (dist < 0.25) {
        n.target = (n.target + 1) % 4;
        continue;
      }

      dir.divideScalar(dist);
      n.g.position.addScaledVector(dir, Math.min(n.speed * dt, dist));

      // Turn smoothly into the new heading at corners.
      n.heading = Math.atan2(dir.x, dir.z);
      n.g.rotation.y = lerpAngle(n.g.rotation.y, n.heading, 1 - Math.exp(-dt * 8));

      // Walk cycle: opposite-phase leg/arm swing plus a tiny bob.
      n.phase += dt * n.speed * 2.6;
      const s = Math.sin(n.phase) * 0.55;
      n.legL.rotation.x = s;
      n.legR.rotation.x = -s;
      n.armL.rotation.x = -s * 0.8;
      n.armR.rotation.x = s * 0.8;
      n.body.position.y = Math.abs(Math.sin(n.phase)) * 0.05;
    }

    // Push each person's animated part transforms into the instanced meshes.
    for (let i = 0; i < npcs.length; i++) {
      const n = npcs[i];
      n.g.updateMatrixWorld(true);
      const m = n.meshes;
      for (const key of PART_KEYS) partIMs[key].setMatrixAt(i, m[key].matrixWorld);
    }
    for (const key of PART_KEYS) partIMs[key].instanceMatrix.needsUpdate = true;
  }

  // Punch hit test: knock down the nearest standing NPC inside a short cone in
  // front of the character. Returns a chest-height hit point (for the FX), or null.
  function hit(charPos, fwd) {
    let best = -1, bestD = HIT_RANGE * HIT_RANGE;
    for (let i = 0; i < npcs.length; i++) {
      const n = npcs[i];
      if (n.state !== 'walk') continue;
      const dx = n.g.position.x - charPos.x, dz = n.g.position.z - charPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > bestD) continue;
      const len = Math.sqrt(d2) || 1;
      if ((dx / len) * fwd.x + (dz / len) * fwd.z < 0.5) continue; // must be ahead
      bestD = d2; best = i;
    }
    if (best < 0) return null;
    const n = npcs[best];
    const dx = n.g.position.x - charPos.x, dz = n.g.position.z - charPos.z;
    const len = Math.hypot(dx, dz) || 1;
    n.state = 'down'; n.reactT = 0; n.fall = 0;
    n.fallDir = rng() < 0.5 ? 1 : -1;
    n.knock.set((dx / len) * 5.5, 0, (dz / len) * 5.5); // shove away from the punch
    return new THREE.Vector3(n.g.position.x, 1.5 * n.g.scale.y, n.g.position.z);
  }

  return { group, update, hit };
}
