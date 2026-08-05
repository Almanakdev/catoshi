import * as THREE from 'three';
import { box, cyl, merge, C } from './common.js';

// Lighthouse — a tall red-and-white striped tower on the coast, a glass lantern
// room, and a rotating light beam that sweeps at night (its opacity, beam and a
// point light all fade in with the day-night `night` factor).
export function buildLighthouse(mats) {
  const g = new THREE.Group();
  const S = [
    cyl(7, 12, 12, 12, 0, 0, 0, '#8a8f83'), // rocky base (down into the water)
  ];
  // Striped tapering shaft.
  let y = 3;
  const bandH = 4;
  const bands = 7;
  for (let i = 0; i < bands; i++) {
    const rB = 4 - i * 0.32;
    const rT = 4 - (i + 1) * 0.32;
    S.push(cyl(rT, rB, bandH, 16, 0, y + bandH / 2, 0, i % 2 ? '#f4ecd8' : '#d33a2a'));
    y += bandH;
  }
  const gallery = y; // top of shaft
  S.push(cyl(3.4, 3.4, 0.6, 16, 0, gallery + 0.3, 0, '#3a3a3a')); // gallery deck
  // Lantern room frame + dome.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    S.push(cyl(0.15, 0.15, 2.4, 5, Math.cos(a) * 2, gallery + 1.7, Math.sin(a) * 2, '#3a3a3a'));
  }
  S.push(cyl(0, 2.6, 2.2, 12, 0, gallery + 4, 0, '#c05a44')); // dome
  const structMesh = new THREE.Mesh(merge(S), mats.structMat);
  structMesh.castShadow = structMesh.receiveShadow = true;
  g.add(structMesh);

  // Lantern glow (warms up at night via the shared glow material).
  const lampY = gallery + 1.6;
  g.add(new THREE.Mesh(merge([cyl(1.7, 1.7, 2.0, 12, 0, lampY, 0, '#ffe6ad')]), mats.glowMat));

  // Rotating beam.
  const beamPivot = new THREE.Group();
  beamPivot.position.set(0, lampY, 0);
  g.add(beamPivot);
  const beamGeo = new THREE.ConeGeometry(5, 48, 16, 1, true);
  beamGeo.rotateX(-Math.PI / 2);
  beamGeo.translate(0, 0, 24);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xfff2c0,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.visible = false;
  beamPivot.add(beam);

  // A real point light at the lantern, on only at night.
  const light = new THREE.PointLight(0xfff0d0, 0, 140, 2);
  light.position.set(0, lampY, 0);
  g.add(light);

  let a = 0;
  function update(dt, night) {
    a += dt * 0.6;
    beamPivot.rotation.y = a;
    beamMat.opacity = night * 0.32;
    beam.visible = night > 0.02;
    light.intensity = night * 55;
  }
  update(0, 0);
  return { group: g, update };
}
