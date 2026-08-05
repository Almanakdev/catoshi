import * as THREE from 'three';
import { box, cyl, merge, C } from './common.js';

// Signature skyscraper — one very tall tapering art-deco tower with a stepped
// crown, spire and antenna, standing far above the rest of the skyline. Its
// window strips glow at night, and a red aviation beacon pulses on top.
export function buildSkyscraper(mats) {
  const g = new THREE.Group();
  const wall = '#3c4a5c';
  const gold = '#c9a24a';
  const S = [
    box(22, 34, 22, 0, 17, 0, wall),
    box(17, 44, 17, 0, 56, 0, wall),
    box(12.5, 44, 12.5, 0, 100, 0, wall),
    box(8.5, 30, 8.5, 0, 137, 0, wall),
    // gold setback trims
    box(17.6, 1.2, 17.6, 0, 34.6, 0, gold),
    box(13, 1.2, 13, 0, 78.6, 0, gold),
    box(9, 1.2, 9, 0, 122.6, 0, gold),
    // crown + spire + antenna
    box(6, 8, 6, 0, 156, 0, gold),
    cyl(0, 3.2, 16, 8, 0, 168, 0, gold),
    cyl(0.25, 0.25, 14, 6, 0, 183, 0, C.metalDark),
  ];
  const structMesh = new THREE.Mesh(merge(S), mats.structMat);
  structMesh.castShadow = structMesh.receiveShadow = true;
  g.add(structMesh);

  // Window strips that glow at night (four faces per tier).
  const glow = [];
  const strip = (w, h, y, z) => {
    for (const face of [0, 1, 2, 3]) {
      const gg = box(w, h, 0.2, 0, y, z, '#ffe6ad');
      gg.rotateY((face * Math.PI) / 2);
      glow.push(gg);
    }
  };
  strip(16, 30, 17, 11.15);
  strip(12, 40, 56, 8.65);
  strip(8.5, 40, 100, 6.4);
  strip(5.5, 26, 137, 4.4);
  const glowMesh = new THREE.Mesh(merge(glow), mats.glowMat);
  g.add(glowMesh);

  // Pulsing red aviation beacon on the antenna tip.
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff3b30, toneMapped: false })
  );
  beacon.position.set(0, 190.5, 0);
  g.add(beacon);

  let t = 0;
  function update(dt) {
    t += dt;
    const p = 0.5 + 0.5 * Math.sin(t * 3);
    beacon.scale.setScalar(0.8 + p * 0.6);
    beacon.material.color.setRGB(1, 0.1 + p * 0.15, 0.1);
  }
  return { group: g, update };
}
