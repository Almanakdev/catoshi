import * as THREE from 'three';
import { box, cyl, merge, instanced, C } from './common.js';

// Construction site — a fenced dirt lot with a tall tower crane, a half-built
// steel building frame (instanced columns + beams), a scaffold, and material
// piles (sand, pipes, bricks).
// ANIMATE: the tower crane's jib slowly slews (rotates) about the mast while a
// slung load raises and lowers on its cable; a welder throws blinking sparks
// (bright additive Points) on the frame, with a cold flickering glow.
export function buildConstruction(mats) {
  const g = new THREE.Group();
  const { structMat, instMat, latticeMat, cableMat } = mats;
  const yl = '#e0b13a'; // crane yellow
  const MAST_X = -6, MAST_Z = -6, jibY = 28.8;
  const S = [
    box(30, 0.3, 24, 0, 0.15, 0, '#b8a684'),      // dirt pad
  ];
  // Scaffold on the near side of the frame (static).
  for (let x = 1; x <= 9; x += 2) {
    S.push(box(0.12, 10, 0.12, x, 5, 8, C.metalDark));
    S.push(box(0.12, 10, 0.12, x, 5, 9.2, C.metalDark));
  }
  for (const yy of [3.5, 7, 9.8]) S.push(box(9, 0.12, 0.12, 5, yy, 8, C.metalDark));
  for (const yy of [3.5, 7]) S.push(box(9, 0.5, 1.2, 5, yy, 8.6, C.wood)); // planks
  const structMesh = new THREE.Mesh(merge(S), structMat);
  structMesh.castShadow = structMesh.receiveShadow = true;
  g.add(structMesh);

  // Static lattice mast (truss texture).
  const mastMesh = new THREE.Mesh(merge([box(1.7, 28, 1.7, MAST_X, 14, MAST_Z, yl)]), latticeMat);
  mastMesh.castShadow = mastMesh.receiveShadow = true;
  g.add(mastMesh);

  // --- Slewing crane top (cab + jib + counter-jib + weight) ------------------
  // Built in mast-local coordinates and pivoted at the mast so the whole
  // assembly rotates cleanly about the vertical axis. The jib + counter-jib are
  // lattice trusses; the cab + counterweight stay solid.
  const craneTop = new THREE.Group();
  craneTop.position.set(MAST_X, 0, MAST_Z);
  const jibMesh = new THREE.Mesh(merge([
    box(28, 0.9, 1, 10, jibY, 0, yl),             // jib
    box(8, 0.9, 1, -6, jibY, 0, yl),              // counter-jib
  ]), latticeMat);
  jibMesh.castShadow = true;
  craneTop.add(jibMesh);
  const solidTop = new THREE.Mesh(merge([
    box(2.2, 2, 2.2, 0, 27.5, 0, yl),                       // cab
    box(2.4, 1.6, 2, -8.5, jibY - 0.2, 0, C.concreteDark),  // counterweight
  ]), structMat);
  solidTop.castShadow = true;
  craneTop.add(solidTop);

  // Hoist line + hook + a slung load, hanging from the jib at local x = 12.
  const HOOK_X = 12;
  const cable = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1, 0.16), cableMat);
  craneTop.add(cable);
  const payload = new THREE.Group();
  payload.add(new THREE.Mesh(merge([
    box(1, 0.6, 1.1, 0, 0, 0, C.metalDark),                 // hook block / pulley
    cyl(0.13, 0.13, 0.8, 8, 0, -0.7, 0, C.metalDark),       // shank
    box(0.18, 0.7, 0.18, 0.34, -1.2, 0, C.metalDark, [0, 0, 0.6]),  // hook throat
    box(0.18, 0.45, 0.18, 0.05, -1.62, 0, C.metalDark, [0, 0, 1.2]), // hook tip
  ]), cableMat));
  payload.add(new THREE.Mesh(merge([
    box(4.6, 0.5, 1.0, 0, -1.6, 0, '#d67b3a'),  // bundled steel beams
    box(4.6, 0.5, 1.0, 0, -2.2, 0, '#c96f30'),
  ]), structMat));
  craneTop.add(payload);
  g.add(craneTop);

  // Steel frame — instanced columns on a grid.
  const colGeo = new THREE.BoxGeometry(0.5, 11, 0.5);
  const cols = [];
  for (let x = 1; x <= 9; x += 4) for (let z = -2; z <= 6; z += 4) cols.push({ x, y: 5.5, z, c: 0xd67b3a });
  g.add(instanced(colGeo, instMat, cols));
  // Frame beams — instanced horizontals per floor.
  const beamGeo = new THREE.BoxGeometry(8.2, 0.4, 0.4);
  const beams = [];
  for (const yy of [3.6, 7.2, 10.6]) {
    for (const z of [-2, 2, 6]) beams.push({ x: 5, y: yy, z, c: 0xd67b3a });
    for (const x of [1, 5, 9]) beams.push({ x, y: yy, z: 2, ry: Math.PI / 2, c: 0xd67b3a });
  }
  g.add(instanced(beamGeo, instMat, beams));

  // Fence hoarding around the perimeter (instanced panels).
  const panelGeo = new THREE.BoxGeometry(3, 2.4, 0.14);
  const fence = [];
  for (let x = -14; x <= 14; x += 3) {
    fence.push({ x, y: 1.2, z: -11.5, c: 0x9fb0c0 });
    fence.push({ x, y: 1.2, z: 11.5, c: 0x9fb0c0 });
  }
  for (let z = -10.5; z <= 10.5; z += 3) {
    fence.push({ x: -14.5, y: 1.2, z, ry: Math.PI / 2, c: 0x9fb0c0 });
    fence.push({ x: 14.5, y: 1.2, z, ry: Math.PI / 2, c: 0x9fb0c0 });
  }
  g.add(instanced(panelGeo, instMat, fence));

  // Material piles: sand heap, pipe stack, bricks.
  g.add(new THREE.Mesh(cyl(0, 2.4, 2.2, 12, -11, 1.1, 8, C.sand), structMat));
  const pipeGeo = new THREE.CylinderGeometry(0.4, 0.4, 5, 8);
  const pipes = [];
  for (let i = 0; i < 6; i++) pipes.push({ x: 9 + (i % 3) * 0.85, y: 0.4 + (i < 3 ? 0 : 0.75), z: -9, rx: Math.PI / 2, c: 0x8a8f96 });
  g.add(instanced(pipeGeo, instMat, pipes));
  const brickGeo = new THREE.BoxGeometry(1.6, 0.9, 1.2);
  const bricks = [];
  for (let i = 0; i < 4; i++) bricks.push({ x: -2, y: 0.5 + i * 0.95, z: -9, c: 0xb5654a });
  g.add(instanced(brickGeo, instMat, bricks));

  // --- Welder sparks — a small pool of bright additive Points on the frame ---
  const SPARK_N = 16;
  const WELD = new THREE.Vector3(5, 7.4, 6.1); // a beam joint on the frame
  const sparkPos = new Float32Array(SPARK_N * 3);
  const sparkBase = new Float32Array(SPARK_N * 3);
  for (let i = 0; i < SPARK_N; i++) {
    // Deterministic scatter around the weld point.
    sparkBase[i * 3] = WELD.x + Math.sin(i * 2.3) * 0.5;
    sparkBase[i * 3 + 1] = WELD.y + Math.sin(i * 1.7) * 0.4;
    sparkBase[i * 3 + 2] = WELD.z + Math.cos(i * 2.9) * 0.3;
  }
  sparkPos.set(sparkBase);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparkMat = new THREE.PointsMaterial({
    color: 0xffe08a,
    size: 0.55,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  });
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  g.add(sparks);
  // A cold flickering weld glow (short range, so it costs almost nothing).
  const weldLight = new THREE.PointLight(0xbfe0ff, 0, 16, 2);
  weldLight.position.copy(WELD);
  g.add(weldLight);

  let t = 0;
  function update(dt) {
    t += dt;
    // Slow slew + a gentle raise / lower of the load.
    craneTop.rotation.y = t * 0.16;
    const hookY = 16 + Math.sin(t * 0.5) * 8;   // 8 → 24
    const len = jibY - 0.5 - hookY;
    cable.scale.y = len;
    cable.position.set(HOOK_X, jibY - 0.5 - len / 2, 0);
    payload.position.set(HOOK_X, hookY, 0);

    // Welding bursts: ~1.4 s on (fast flicker + spitting sparks) then ~1.1 s off.
    const local = t % 2.5;
    if (local < 1.4) {
      const flick = 0.45 + 0.55 * Math.abs(Math.sin(t * 47));
      sparkMat.opacity = 0.95 * flick;
      weldLight.intensity = 9 * flick;
      for (let i = 0; i < SPARK_N; i++) {
        const s = Math.sin(t * 30 + i * 5.1);
        sparkPos[i * 3] = sparkBase[i * 3] + s * 0.6;
        sparkPos[i * 3 + 1] = sparkBase[i * 3 + 1] - Math.abs(s) * 0.9 + 0.3;
        sparkPos[i * 3 + 2] = sparkBase[i * 3 + 2] + Math.cos(t * 26 + i * 3.7) * 0.5;
      }
      sparkGeo.attributes.position.needsUpdate = true;
    } else {
      sparkMat.opacity = 0;
      weldLight.intensity = 0;
    }
  }
  update(0);
  return { group: g, update };
}
