import * as THREE from 'three';
import { box, merge, instanced, C } from './common.js';
import { containerAtlas, containerGeometry } from './textures.js';

// Docks / port — a concrete quay along the water carrying a big container
// gantry crane, stacks of shipping containers (instanced, colourful), and a
// line of bollards on the edge.
// ANIMATE: the gantry trolley traverses the boom while its cable + hook +
// container lift and lower together in a smooth loop (pick up quay-side, carry
// out over the water, set down, and back). A small boat bobs on the sea.
export function buildDocks(mats) {
  const g = new THREE.Group();
  const { structMat, instMat, latticeMat, cableMat } = mats;
  const cr = '#e08e2a';
  const boomY = 17.3;
  const WATER_Y = -1.2; // matches environment.js sea level (group sits at y=0)
  const S = [
    box(20, 0.8, 54, 0, 0.4, 0, C.concrete),       // quay slab
    box(1.2, 1.4, 54, -10, 1.1, 0, C.concreteDark),// water-edge curb
  ];
  const structMesh = new THREE.Mesh(merge(S), structMat);
  structMesh.castShadow = structMesh.receiveShadow = true;
  g.add(structMesh);

  // Container gantry crane straddling the quay — a lattice/truss steel frame.
  const L = [];
  for (const lz of [-8, 8]) for (const lx of [-8, -1]) L.push(box(1, 17, 1, lx, 8.5, lz, cr));
  L.push(box(8.5, 1.3, 17, -4.5, boomY, 0, cr));   // top girder
  L.push(box(34, 1.1, 2, -18, boomY, 0, cr));      // boom over the water
  L.push(box(8, 1.1, 2, 5.5, boomY, 0, cr));       // counter-boom
  const craneMesh = new THREE.Mesh(merge(L), latticeMat);
  craneMesh.castShadow = craneMesh.receiveShadow = true;
  g.add(craneMesh);

  // Stacked shipping containers — one textured (corrugation + doors + logos +
  // rust) InstancedMesh, varied faded colours, tilted at slight angles.
  const contGeo = containerGeometry();
  const contMat = new THREE.MeshToonMaterial({ map: containerAtlas(), gradientMap: mats.gradientMap });
  const FADED = [0xb0574a, 0x4a6f92, 0x4f8560, 0xc0913f, 0x4a8b90, 0x7d6f9c, 0x9a6250, 0xa9a052, 0x6d7d8a];
  const cont = [];
  let ci = 0;
  const piles = [[3, -18, 2], [3, -11, 3], [6, -1, 1], [3, 9, 2], [6, 18, 3], [6, 11, 2]];
  for (const [px, pz, hn] of piles) {
    for (let y = 0; y < hn; y++) {
      const j = ci;
      cont.push({
        x: px + Math.sin(j * 1.7) * 0.18, y: 1.7 + y * 2.62, z: pz + Math.cos(j * 2.3) * 0.16,
        ry: Math.sin(j * 2.9) * 0.07, rz: Math.sin(j * 1.3) * 0.012,
        c: FADED[ci % FADED.length],
      });
      ci++;
    }
  }
  g.add(instanced(contGeo, contMat, cont));

  // Bollards along the water edge.
  const bolGeo = new THREE.CylinderGeometry(0.35, 0.45, 1.1, 8);
  const bol = [];
  for (let z = -24; z <= 24; z += 6) bol.push({ x: -9, y: 0.95, z, c: 0x3a3a3a });
  g.add(instanced(bolGeo, instMat, bol));

  // --- Animated hoist: trolley + cable + hook + a slung container ------------
  const trolley = new THREE.Mesh(merge([box(2.0, 2.2, 2.6, 0, 0, 0, C.metalDark)]), structMat);
  trolley.position.set(-18, boomY - 1.6, 0);
  trolley.castShadow = true;
  g.add(trolley);

  // Twin visible hoist cables + a spreader beam carrying a container.
  const cable = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 0.2), cableMat);
  const cable2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 0.2), cableMat);
  g.add(cable, cable2); // scaled + positioned each frame

  const payload = new THREE.Group(); // spreader + hanging container
  payload.add(new THREE.Mesh(merge([
    box(6.2, 0.5, 0.7, 0, 0, 0, C.metalDark),                 // spreader beam
    box(0.5, 0.5, 0.5, 2.9, -0.1, 0, C.metalDark), box(0.5, 0.5, 0.5, -2.9, -0.1, 0, C.metalDark), // twist-locks
  ]), structMat));
  const slungMat = new THREE.MeshToonMaterial({ map: containerAtlas(), color: 0xb0574a, gradientMap: mats.gradientMap });
  const slung = new THREE.Mesh(containerGeometry(), slungMat);
  slung.position.y = -1.8;
  slung.castShadow = true;
  payload.add(slung);
  g.add(payload);

  // --- Bobbing boat out on the water -----------------------------------------
  const boat = new THREE.Group();
  const B = [
    box(6.5, 1.4, 2.6, 0, 0, 0, '#b5654a'),        // hull
    box(2.4, 1.0, 1.0, 3.6, 0.1, 0, '#b5654a', [0, 0, -0.5]), // raked bow
    box(3.2, 1.5, 2.0, -0.6, 1.3, 0, C.cream),     // cabin
    box(0.9, 1.2, 0.9, -0.6, 2.3, 0, '#c05a44'),   // funnel
    box(0.18, 4.2, 0.18, 1.8, 2.4, 0, C.metalDark),// mast
  ];
  const boatMesh = new THREE.Mesh(merge(B), structMat);
  boatMesh.castShadow = boatMesh.receiveShadow = true;
  boat.add(boatMesh);
  boat.position.set(-26, WATER_Y + 0.4, -15);
  boat.rotation.y = 0.5;
  g.add(boat);

  let t = 0;
  function update(dt) {
    t += dt;
    // Trolley traverses the boom; the load is lowered at both ends (pick / set)
    // and carried raised across the middle — a smooth, continuous cycle.
    const theta = t * 0.5;
    const midX = -18, ampX = 12;
    const trolleyX = midX + ampX * Math.sin(theta);
    const lift = Math.abs(Math.sin(theta));      // 0 raised (mid) → 1 lowered (ends)
    const len = 2.2 + lift * 12.5;               // cable length
    const hookY = boomY - 1.8 - len;

    trolley.position.x = trolleyX;
    const cy = boomY - 1.8 - len / 2;
    cable.scale.y = len; cable.position.set(trolleyX, cy, 1.3);
    cable2.scale.y = len; cable2.position.set(trolleyX, cy, -1.3);
    payload.position.set(trolleyX, hookY, 0);

    // Boat bobs and rocks on the swell (time-based, framerate-independent).
    boat.position.y = WATER_Y + 0.4 + Math.sin(t * 1.3) * 0.35;
    boat.rotation.z = Math.sin(t * 1.1) * 0.06;
    boat.rotation.x = Math.sin(t * 0.9 + 1.0) * 0.05;
  }
  update(0);
  return { group: g, update };
}
