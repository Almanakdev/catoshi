import * as THREE from 'three';
import { box, cyl, merge, instanced, makeSmoke, C } from './common.js';

// Factory / warehouse — a big boxy hall with a corrugated (ridged) roof, tall
// chimneys and roof vents, a lit clerestory window band, and a row of roll-up
// loading-dock doors on a raised platform, with pallets/crates stacked outside.
// ANIMATE: the chimneys puff rising smoke that drifts and fades on a loop, and
// the roof extractor vents slowly spin.
export function buildFactory(mats) {
  const g = new THREE.Group();
  const { structMat, glowMat, instMat, sidingMat } = mats;

  // Main hall — its own mesh so it wears the corrugated metal siding texture
  // (vertical ribs, seam, light rust) instead of a flat concrete box.
  const hallMesh = new THREE.Mesh(new THREE.BoxGeometry(34, 9, 20), sidingMat);
  hallMesh.position.set(0, 4.5, 0);
  hallMesh.castShadow = hallMesh.receiveShadow = true;
  g.add(hallMesh);

  const S = [
    box(34.4, 0.5, 20.4, 0, 9.1, 0, C.concreteDark), // roof slab
    cyl(1.2, 1.5, 13, 10, 12, 13, -6, C.concreteDark), // big chimney  (top ~19.5)
    cyl(1.0, 1.2, 10, 10, 8, 11, -2, C.concreteDark),  // 2nd chimney  (top ~16)
    box(34, 1.2, 3, 0, 0.6, 11.5, C.concreteDark),     // loading platform
    // Roof pipework: a long run + elbows + a wall riser.
    cyl(0.4, 0.4, 18, 10, 4, 9.9, -3, C.metalDark, [0, 0, Math.PI / 2]),
    cyl(0.4, 0.4, 2.4, 10, 13, 10.8, -3, C.metalDark),
    cyl(0.3, 0.3, 12, 10, -11, 9.8, 5, C.metalDark, [0, 0, Math.PI / 2]),
    cyl(0.35, 0.35, 8, 10, 17.15, 5, 8, C.metalDark),   // vertical wall riser (on the exterior face)
  ];
  const ventBases = [-9, -1, 7];
  for (const vx of ventBases) S.push(box(1.8, 1.4, 1.8, vx, 9.7, 4, C.metalDark)); // vent housings
  // Roll-up loading dock doors.
  for (const dx of [-12, -4, 4, 12]) {
    S.push(box(4.6, 4.6, 0.2, dx, 2.4, 10.02, C.metalDark));
    S.push(box(4.2, 4.1, 0.24, dx, 2.35, 10.08, C.steel));
    for (let s = 0; s < 5; s++) S.push(box(4.2, 0.06, 0.26, dx, 0.7 + s * 0.85, 10.1, C.metalDark));
  }
  const structMesh = new THREE.Mesh(merge(S), structMat);
  structMesh.castShadow = structMesh.receiveShadow = true;
  g.add(structMesh);

  // Corrugated roof — many parallel ridge bars (instanced).
  const ridgeGeo = new THREE.BoxGeometry(0.5, 0.4, 20.2);
  const ridges = [];
  for (let x = -16.5; x <= 16.5; x += 1.0) ridges.push({ x, y: 9.4, z: 0, c: 0xb9b3a2 });
  g.add(instanced(ridgeGeo, instMat, ridges));

  // Lit clerestory window band (warms up at night).
  const glowMesh = new THREE.Mesh(merge([box(30, 1.1, 0.12, 0, 6.6, 10.05, C.glassWarm)]), glowMat);
  g.add(glowMesh);

  // Pallets / crates stacked in the yard.
  const crateGeo = new THREE.BoxGeometry(1.7, 1.6, 1.7);
  const crateCols = [0x8a5a34, 0xc0a060, 0x9a8c72];
  const crates = [];
  for (let i = 0; i < 10; i++) {
    crates.push({ x: -16 + (i % 5) * 1.9, y: 0.9 + (i >= 5 ? 1.6 : 0), z: 15, c: crateCols[i % 3] });
  }
  g.add(instanced(crateGeo, instMat, crates));

  // --- Spinning roof extractor fans (one small blade mesh per vent) ----------
  function makeFan() {
    const F = [cyl(0.22, 0.22, 0.3, 8, 0, 0, 0, C.steel)]; // hub
    for (let b = 0; b < 4; b++) {
      const a = (b / 4) * Math.PI * 2;
      F.push(box(1.5, 0.06, 0.4, Math.cos(a) * 0.75, 0, Math.sin(a) * 0.75, C.metalDark, [0, a, 0.35]));
    }
    return new THREE.Mesh(merge(F), structMat);
  }
  const fans = ventBases.map((vx) => {
    const f = makeFan();
    f.position.set(vx, 10.55, 4);
    f.castShadow = true;
    g.add(f);
    return f;
  });

  // --- Chimney smoke (low-count sprite puffs) --------------------------------
  const smoke = [
    makeSmoke({ x: 12, y: 19.5, z: -6, count: 5, rise: 14, drift: 5, size: 2.4, grow: 4.5, color: '#cfd2d6', speed: 0.16, opacity: 0.5 }),
    makeSmoke({ x: 8, y: 16, z: -2, count: 4, rise: 11, drift: 4, size: 1.8, grow: 3.6, color: '#d7dade', speed: 0.2, opacity: 0.45 }),
  ];
  for (const s of smoke) g.add(s.group);

  let t = 0;
  function update(dt, night) {
    t += dt;
    for (let i = 0; i < fans.length; i++) fans[i].rotation.y = t * (1.4 + i * 0.25);
    const mul = 1 - (night || 0) * 0.35; // smoke reads a little softer after dark
    for (let i = 0; i < smoke.length; i++) smoke[i].update(dt, mul);
  }
  update(0, 0);
  return { group: g, update };
}
