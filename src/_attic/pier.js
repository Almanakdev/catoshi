import * as THREE from 'three';
import { box, cyl, paint, merge, C } from './shops/common.js';
import { makeToonGradient } from './textures.js';

// A seaside pleasure pier reaching out over the water, carrying stalls, lamp
// posts and a large ROTATING Ferris wheel. The rim spins while the cabins — an
// InstancedMesh, the "repeated part" — orbit the hub but stay upright, so a
// dozen cabins are one draw call plus one small per-frame matrix update.
//
// Returns { group, update(dt), poi }. Local +Z runs out to sea.
export function createPier({ x = 50, z = 200, yaw = 0, length = 95 } = {}) {
  const gradientMap = makeToonGradient(4);
  const toon = (c) => new THREE.MeshToonMaterial({ color: c, gradientMap });
  const vcToon = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
  const vcBasic = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });

  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = yaw;

  const W = 14;

  // ---- Deck + railings ----
  const deckParts = [box(W, 0.5, length, 0, 0.25, length / 2, '#b98a52')];
  for (let zz = 0; zz <= length; zz += 3) {
    for (const px of [-W / 2 + 0.4, W / 2 - 0.4]) deckParts.push(box(0.18, 1.0, 0.18, px, 0.9, zz, '#8a6a44'));
  }
  for (const px of [-W / 2 + 0.4, W / 2 - 0.4]) deckParts.push(box(0.14, 0.16, length, px, 1.35, length / 2, '#8a6a44'));
  const deck = new THREE.Mesh(merge(deckParts), toon(0xb98a52));
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  // ---- Pilings into the water ----
  const pilings = [];
  for (let zz = 6; zz < length; zz += 10) {
    for (const px of [-W / 2 + 1, W / 2 - 1]) pilings.push(cyl(0.5, 0.6, 3.4, 7, px, -1.5, zz, '#6b5033'));
  }
  const pileMesh = new THREE.Mesh(merge(pilings), toon(0x6b5033));
  pileMesh.castShadow = true;
  group.add(pileMesh);

  // ---- Lamp posts (warm bulbs, always lit — festive pier lights) ----
  const posts = [];
  const bulbs = [];
  for (let zz = 8; zz < length - 8; zz += 16) {
    for (const px of [-W / 2 + 0.9, W / 2 - 0.9]) {
      posts.push(cyl(0.12, 0.15, 3.2, 6, px, 1.6, zz, '#3a3532'));
      bulbs.push(cyl(0.22, 0.22, 0.3, 8, px, 3.25, zz, '#ffca7a'));
    }
  }
  group.add(new THREE.Mesh(merge(posts), toon(0x3a3532)));
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xffca7a,
    emissive: new THREE.Color(0xffb14d),
    emissiveIntensity: 1.1,
    roughness: 0.6, // matches the city street-lamp bulbs
    metalness: 0,
  });
  group.add(new THREE.Mesh(merge(bulbs), bulbMat));

  // ---- Striped stalls ----
  const stalls = [];
  for (const [sx, sz] of [[-4, 20], [4, 42]]) {
    stalls.push(box(3.4, 2.4, 3, sx, 1.7, sz, 0xe8d3a0));
    for (let i = 0; i < 5; i++) stalls.push(box(0.68, 0.3, 3.2, sx - 1.36 + i * 0.68, 3.05, sz, i % 2 ? 0xf4ecd8 : 0xe23b3b));
  }
  const stallMesh = new THREE.Mesh(merge(stalls), vcToon);
  stallMesh.castShadow = true;
  group.add(stallMesh);

  // ---- Ferris wheel ----
  const R = 11;
  const N = 12;
  const hub = new THREE.Vector3(0, 14, length - 6);

  // A-frame support legs + hub housing.
  const legs = [];
  for (const s of [-1, 1]) {
    legs.push(box(0.7, 19, 0.7, s * 5, 9.3, hub.z + 3, '#b8c0c6', [0.16, 0, 0]));
    legs.push(box(0.7, 19, 0.7, s * 5, 9.3, hub.z - 3, '#b8c0c6', [-0.16, 0, 0]));
  }
  legs.push(box(11, 1.4, 2.6, 0, hub.y, hub.z, '#9aa0a6'));
  group.add(new THREE.Mesh(merge(legs), toon(0xb8c0c6)));

  // Spinning rim (rims + spokes + hub) in the X-Y plane.
  const rimGroup = new THREE.Group();
  rimGroup.position.copy(hub);
  group.add(rimGroup);
  const rimParts = [paint(new THREE.TorusGeometry(R, 0.24, 6, N * 2), new THREE.Color(0xe23b3b))];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const spoke = new THREE.BoxGeometry(0.14, R, 0.14);
    spoke.translate(0, R / 2, 0);
    spoke.rotateZ(a);
    rimParts.push(paint(spoke, new THREE.Color(0xf4ecd8)));
  }
  const hubCyl = new THREE.CylinderGeometry(0.8, 0.8, 1.4, 12);
  hubCyl.rotateX(Math.PI / 2);
  rimParts.push(paint(hubCyl, new THREE.Color(0x9aa0a6)));
  const rimMesh = new THREE.Mesh(merge(rimParts), vcToon);
  rimMesh.castShadow = true;
  rimGroup.add(rimMesh);

  // Fairy lights around the rim (always-bright, blooms) — spin with the rim.
  const dots = [];
  const dotCols = [0xffe08a, 0x66d9ff, 0xff7ac0, 0x8fff9a];
  for (let i = 0; i < N * 2; i++) {
    const a = (i / (N * 2)) * Math.PI * 2;
    const d = new THREE.SphereGeometry(0.3, 6, 5);
    d.translate(Math.cos(a) * R, Math.sin(a) * R, 0);
    dots.push(paint(d, new THREE.Color(dotCols[i % dotCols.length])));
  }
  rimGroup.add(new THREE.Mesh(merge(dots), vcBasic));

  // Cabins — instanced, orbit the hub but stay upright.
  const cabins = new THREE.InstancedMesh(new THREE.BoxGeometry(1.9, 1.9, 1.6), new THREE.MeshToonMaterial({ gradientMap }), N);
  cabins.castShadow = true;
  const cabinCols = [0xe23b3b, 0x3ad1ff, 0xffd23f, 0x6fae4e, 0xff7ac0, 0x8f5cff];
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    c.setHex(cabinCols[i % cabinCols.length]);
    cabins.setColorAt(i, c);
  }
  group.add(cabins);

  const dummy = new THREE.Object3D();
  let spin = 0;
  function update(dt) {
    spin += dt * 0.32;
    rimGroup.rotation.z = spin;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + spin;
      dummy.position.set(hub.x + Math.cos(a) * R, hub.y + Math.sin(a) * R, hub.z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      cabins.setMatrixAt(i, dummy.matrix);
    }
    cabins.instanceMatrix.needsUpdate = true;
  }
  update(0);

  // Minimap POI at the wheel's world position.
  const poiV = new THREE.Vector3(hub.x, 0, hub.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(x, 0, z));

  return { group, update, poi: { x: poiV.x, z: poiV.z, label: 'PIER', short: 'Pier', color: '#ff7ac0' } };
}
