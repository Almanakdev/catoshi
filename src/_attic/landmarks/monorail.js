import * as THREE from 'three';
import { box, cyl, merge, strut, instanced, C } from './common.js';

// Elevated monorail — a closed oval guideway on pillars, with a multi-car train
// that loops smoothly along it forever. The train's windows glow at night via
// the shared glow material. Built around the local origin; placed over the water.
export function buildMonorail(mats) {
  const g = new THREE.Group();
  const { structMat, glowMat } = mats;
  const rx = 80, rz = 44, trackY = 11;
  const N = 64;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * rx, trackY, Math.sin(a) * rz));
  }

  // Guideway beam + lower rail, as merged segments around the oval.
  const beamParts = [];
  for (let i = 0; i < N; i++) {
    const p0 = pts[i], p1 = pts[(i + 1) % N];
    beamParts.push(strut(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, 1.8, '#b8bcc4'));
    beamParts.push(strut(p0.x, p0.y - 1.2, p0.z, p1.x, p1.y - 1.2, p1.z, 0.9, '#7a7f88'));
  }
  const beam = new THREE.Mesh(merge(beamParts), structMat);
  beam.castShadow = beam.receiveShadow = true;
  g.add(beam);

  // Support pillars every few segments (instanced).
  const pillarGeo = merge([
    box(2.4, trackY, 2.4, 0, trackY / 2, 0, '#9aa0a6'),
    box(3.4, 1.4, 3.4, 0, trackY - 0.6, 0, '#7a7f88'),  // cap
    box(3.8, 0.7, 3.8, 0, 0.35, 0, '#6a6f77'),          // footing
  ]);
  const pillars = [];
  for (let i = 0; i < N; i += 4) pillars.push({ x: pts[i].x, y: 0, z: pts[i].z });
  g.add(instanced(pillarGeo, structMat, pillars));

  // Train cars (body reused; windows on a shared glow material).
  const carLen = 8.4;
  const carGeo = merge([
    box(3.2, 2.6, carLen, 0, 1.3, 0, '#e8ecf0'),          // body
    box(3.26, 0.8, carLen * 0.98, 0, 2.15, 0, '#2f6bd0'), // blue roof stripe
    box(3.0, 1.0, carLen * 0.92, 0, 1.5, 0, '#20242c'),   // window band backing
    box(2.5, 1.9, 1.0, 0, 1.3, carLen / 2 + 0.35, '#e8ecf0'), // rounded nose
    box(2.5, 1.9, 1.0, 0, 1.3, -carLen / 2 - 0.35, '#e8ecf0'),// tail
  ]);
  const carGlowGeo = merge([
    box(3.08, 0.9, carLen * 0.86, 0, 1.55, 0, '#bfe0ff'),
  ]);
  const NCAR = 4;
  const cars = [];
  for (let i = 0; i < NCAR; i++) {
    const car = new THREE.Group();
    const body = new THREE.Mesh(carGeo, structMat);
    body.castShadow = true;
    car.add(body, new THREE.Mesh(carGlowGeo, glowMat));
    g.add(car);
    cars.push(car);
  }

  const carRideY = trackY + 1.6;
  const carAngGap = (carLen + 1.2) / ((rx + rz) / 2); // angular spacing along the oval
  let theta = 0;
  function update(dt) {
    theta += dt * 0.14; // loop speed
    for (let i = 0; i < NCAR; i++) {
      const a = theta - i * carAngGap;
      const car = cars[i];
      car.position.set(Math.cos(a) * rx, carRideY, Math.sin(a) * rz);
      car.rotation.y = Math.atan2(-rx * Math.sin(a), rz * Math.cos(a)); // face the tangent
    }
  }
  update(0);
  return { group: g, update };
}
