import * as THREE from 'three';
import { box, cyl, merge, instanced, makeSmoke, C } from './common.js';

// Power plant — two hyperbolic cooling towers, a powerhouse with a chimney,
// storage tanks, connecting pipes, and a line of instanced lattice transmission
// pylons marching away with the power lines.
// ANIMATE: the cooling towers exhale slow rising steam, a rooftop turbine fan
// spins, and a red aircraft-warning beacon blinks on top after dark.
export function buildPowerPlant(mats) {
  const g = new THREE.Group();
  const { structMat, instMat } = mats;
  const S = [
    box(24, 0.3, 20, 0, 0.15, 0, C.concreteDark), // yard pad
    box(16, 9, 12, -4, 4.5, 0, C.concrete),       // powerhouse
    box(16.4, 0.5, 12.4, -4, 9.1, 0, C.concreteDark),
    cyl(1.2, 1.5, 16, 10, -10, 8, -3, C.concreteDark), // chimney (top ~16)
  ];
  // Two cooling towers (waisted: wide base → narrow waist → flared top).
  for (const tz of [-5, 5]) {
    S.push(cyl(3.6, 6, 11, 16, 9, 5.5, tz, '#cbc6b8'));   // lower flare
    S.push(cyl(4.4, 3.6, 7, 16, 9, 13.5, tz, '#cbc6b8')); // upper flare
    S.push(cyl(4.6, 4.4, 0.6, 16, 9, 17.2, tz, '#b0aa9a'));// rim (top ~17.5)
  }
  // Storage tanks + connecting pipes.
  for (const [tx, tz] of [[-11, 6], [-11, -6]]) {
    S.push(cyl(2, 2, 4, 12, tx, 2, tz, C.steel));
    S.push(cyl(2, 2, 0.6, 12, tx, 4.2, tz, C.metalDark));
  }
  S.push(cyl(0.4, 0.4, 8, 8, -6, 1, 6, C.metal, [0, 0, Math.PI / 2])); // pipe run
  S.push(cyl(0.4, 0.4, 12, 8, 4, 1.2, 0, C.metal, [Math.PI / 2, 0, 0]));
  const structMesh = new THREE.Mesh(merge(S), structMat);
  structMesh.castShadow = structMesh.receiveShadow = true;
  g.add(structMesh);

  // A lattice transmission pylon (built once) instanced into a receding line.
  const P = [];
  const pc = 0x8a8f96;
  for (const s of [-1, 1]) {
    P.push(box(0.3, 15, 0.3, s * 1.6, 7.5, 0, pc, [0, 0, s * 0.09]));
    P.push(box(0.3, 15, 0.3, 0, 7.5, s * 1.6, pc, [s * 0.09, 0, 0]));
  }
  P.push(box(7, 0.35, 0.35, 0, 10, 0, pc)); // cross arm
  P.push(box(0.35, 0.35, 7, 0, 12.5, 0, pc));
  P.push(box(5, 0.35, 0.35, 0, 15, 0, pc)); // top arm
  const pylonGeo = merge(P);
  const pylons = [];
  for (let i = 0; i < 4; i++) pylons.push({ x: 16 + i * 14, y: 0, z: 8, c: pc });
  g.add(instanced(pylonGeo, instMat, pylons));
  // Power lines (thin catenary-ish boxes between pylons).
  const lines = [];
  for (let i = 0; i < 3; i++) lines.push(box(56, 0.08, 0.08, 44, 11.2, 8 - 3 + i * 3, C.black));
  g.add(new THREE.Mesh(merge(lines), structMat));

  // --- Rooftop turbine fan (spins about the vertical axis) -------------------
  const F = [cyl(0.3, 0.3, 0.5, 10, 0, 0, 0, C.steel)]; // hub
  for (let b = 0; b < 6; b++) {
    const a = (b / 6) * Math.PI * 2;
    F.push(box(2.0, 0.08, 0.55, Math.cos(a) * 1.05, 0, Math.sin(a) * 1.05, C.metalDark, [0, a, 0.3]));
  }
  const fan = new THREE.Mesh(merge(F), structMat);
  fan.position.set(-4, 9.6, 3.5);
  fan.castShadow = true;
  g.add(fan);

  // --- Cooling-tower steam (low-count sprite puffs, mostly vertical) ---------
  const steam = [
    makeSmoke({ x: 9, y: 18, z: -5, count: 5, rise: 12, drift: 1.5, size: 4.0, grow: 4.5, color: '#eef0f2', speed: 0.13, opacity: 0.5 }),
    makeSmoke({ x: 9, y: 18, z: 5, count: 5, rise: 12, drift: 1.5, size: 4.0, grow: 4.5, color: '#eef0f2', speed: 0.15, opacity: 0.5 }),
  ];
  for (const s of steam) g.add(s.group);

  // --- Red aircraft-warning beacon on the chimney (blinks at night) ----------
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false, transparent: true, opacity: 1 });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), beaconMat);
  beacon.position.set(-10, 16.6, -3);
  g.add(beacon);
  const beaconLight = new THREE.PointLight(0xff3a2a, 0, 34, 2);
  beaconLight.position.copy(beacon.position);
  g.add(beaconLight);

  let t = 0;
  function update(dt, night) {
    t += dt;
    fan.rotation.y = t * 2.0;
    const n = night || 0;
    for (let i = 0; i < steam.length; i++) steam[i].update(dt, 1 - n * 0.25);
    // Slow ~1.4 s blink; only lit at night (fades in with the day-night factor).
    const blink = Math.sin(t * 2.2) > 0.4 ? 1 : 0.08;
    beaconMat.opacity = 0.15 + n * 0.85 * blink;
    beacon.visible = n > 0.05 || blink > 0.5;
    beaconLight.intensity = n * 14 * blink;
  }
  update(0, 0);
  return { group: g, update };
}
