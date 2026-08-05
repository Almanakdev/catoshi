import * as THREE from 'three';
import { box, cyl, merge, instanced, C } from './common.js';

// Farm / ranch — a red barn with a gambrel roof, a tall grain silo, tilled
// fields striped with instanced crop rows, and a post-and-rail fence around the
// paddock, with a three-blade wind turbine off to the side.
// ANIMATE: the turbine rotor spins, and the crop rows sway in the wind (a light
// vertex sway driven by a shared time uniform, like the city's grass).
export function buildFarm(mats) {
  const g = new THREE.Group();
  const { structMat, instMat, gradientMap } = mats;
  const S = [
    box(40, 0.2, 30, 0, 0.1, 0, '#7f9a52'),       // grass base
    box(18, 0.16, 22, 11, 0.16, 2, '#9c7a4a'),    // tilled field soil
    // Red barn with gambrel roof + white trim.
    box(12, 5.5, 9, -11, 2.75, -6, C.red),
    box(12.5, 0.8, 5, -11, 5.9, -6, C.redDark, [0.5, 0, 0]),
    box(12.5, 0.8, 5, -11, 5.9, -6, C.redDark, [-0.5, 0, 0]),
    box(12.6, 1.4, 3, -11, 6.9, -6, C.redDark),   // roof ridge cap
    box(4, 4, 0.2, -11, 2, -1.45, C.cream),       // barn doors
    box(0.3, 4, 0.25, -11, 2, -1.4, C.red),       // door split
    // Silo.
    cyl(2.4, 2.4, 13, 14, -2, 6.5, -8, C.concrete),
    cyl(0, 2.6, 2.2, 14, -2, 14, -8, C.metalDark),// dome top
  ];
  const structMesh = new THREE.Mesh(merge(S), structMat);
  structMesh.castShadow = structMesh.receiveShadow = true;
  g.add(structMesh);

  // --- Crop rows — instanced tufts that sway in the wind ---------------------
  // Dedicated toon material with a tiny vertex-wind injection (tip sways, base
  // anchored), driven by a `uTime` uniform advanced in update().
  const cropWind = { value: 0 };
  const cropMat = new THREE.MeshToonMaterial({ gradientMap });
  cropMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = cropWind;
    sh.vertexShader =
      'uniform float uTime;\n' +
      sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         {
           float ax = instanceMatrix[3][0];
           float az = instanceMatrix[3][2];
           float bend = clamp((position.y + 0.55) / 1.1, 0.0, 1.0);
           transformed.x += sin(uTime * 1.6 + ax * 0.3 + az * 0.2) * 0.16 * bend;
           transformed.z += cos(uTime * 1.3 + ax * 0.25) * 0.09 * bend;
         }`
      );
  };
  cropMat.customProgramCacheKey = () => 'farm-cropwind';

  const cropGeo = new THREE.ConeGeometry(0.45, 1.1, 5);
  const cropCols = [0x8fbf4a, 0xa9c85a, 0xc7c24a];
  const crops = [];
  let k = 0;
  for (let row = 0; row < 9; row++) {
    const z = -8 + row * 2.2;
    for (let x = 3.5; x <= 18.5; x += 1.1) crops.push({ x, y: 0.7, z, c: cropCols[k++ % 3] });
  }
  g.add(instanced(cropGeo, cropMat, crops));

  // Post-and-rail paddock fence (instanced posts + merged rails).
  const postGeo = new THREE.BoxGeometry(0.25, 1.6, 0.25);
  const posts = [];
  const railS = [];
  const x0 = -19, x1 = 1, z0 = -13, z1 = 13;
  for (let x = x0; x <= x1; x += 2.5) {
    posts.push({ x, y: 0.8, z: z0, c: 0x9a6a3a });
    posts.push({ x, y: 0.8, z: z1, c: 0x9a6a3a });
  }
  for (let z = z0; z <= z1; z += 2.5) {
    posts.push({ x: x0, y: 0.8, z, c: 0x9a6a3a });
    posts.push({ x: x1, y: 0.8, z, c: 0x9a6a3a });
  }
  for (const yy of [0.7, 1.3]) {
    railS.push(box(x1 - x0, 0.12, 0.12, (x0 + x1) / 2, yy, z0, '#8a5a34'));
    railS.push(box(x1 - x0, 0.12, 0.12, (x0 + x1) / 2, yy, z1, '#8a5a34'));
    railS.push(box(0.12, 0.12, z1 - z0, x0, yy, (z0 + z1) / 2, '#8a5a34'));
    railS.push(box(0.12, 0.12, z1 - z0, x1, yy, (z0 + z1) / 2, '#8a5a34'));
  }
  g.add(instanced(postGeo, instMat, posts));
  g.add(new THREE.Mesh(merge(railS), structMat));

  // --- Wind turbine — tower + nacelle + spinning three-blade rotor -----------
  const TX = 16, TZ = -11, hubY = 16;
  g.add(new THREE.Mesh(merge([
    cyl(0.4, 0.8, hubY, 8, TX, hubY / 2, TZ, C.white),      // tower
    box(1.3, 1.3, 2.6, TX, hubY, TZ + 0.2, C.concrete),     // nacelle
  ]), structMat));

  const R = [cyl(0.35, 0.35, 0.7, 10, 0, 0, 0.4, C.metalDark, [Math.PI / 2, 0, 0])]; // hub
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * Math.PI * 2;
    R.push(box(0.6, 6.8, 0.2, -Math.sin(a) * 3.6, Math.cos(a) * 3.6, 0.4, C.white, [0, 0, a]));
    R.push(box(0.65, 1.1, 0.24, -Math.sin(a) * 6.9, Math.cos(a) * 6.9, 0.4, C.red, [0, 0, a])); // tip accent
  }
  const rotor = new THREE.Mesh(merge(R), structMat);
  rotor.position.set(TX, hubY, TZ + 1.3);
  rotor.castShadow = true;
  g.add(rotor);

  let t = 0;
  function update(dt) {
    t += dt;
    cropWind.value = t;
    rotor.rotation.z = t * 1.1;
  }
  update(0);
  return { group: g, update };
}
