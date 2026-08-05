import * as THREE from 'three';
import { buildDocks } from './docks.js';
import { buildFactory } from './factory.js';
import { buildConstruction } from './construction.js';
import { buildFarm } from './farm.js';
import { buildPowerPlant } from './powerPlant.js';
import { latticeTexture, corrugatedSiding } from './textures.js';

// Places the industrial / outskirts installations in a ring around the city
// edge (each brings its own ground pad, so they sit on the margin or over the
// water). Every installation has a looping animation; call update(dt, night)
// each frame (dt-based, so it's framerate-independent) to drive them and tie
// their night lights into the day-night cycle. Returns
// { group, pois, glowMat, update } — push the pois onto the minimap and glowMat
// onto the night-ramp list so lit windows warm up after dark.
export function createIndustrial({ gradientMap }) {
  const structMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
  const glowMat = new THREE.MeshToonMaterial({
    vertexColors: true,
    gradientMap,
    emissive: new THREE.Color(0xffd9a0),
    emissiveIntensity: 0,
  });
  const instMat = new THREE.MeshToonMaterial({ gradientMap }); // white base; per-instance colors
  // Textured surfaces (shared): crane trusses, corrugated factory siding, dark
  // cables/hooks. latticeMat keeps vertexColors so each crane's baked colour
  // (orange / yellow) multiplies through the greyscale truss art.
  const latticeMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap, map: latticeTexture() });
  const sidingMat = new THREE.MeshToonMaterial({ gradientMap, map: corrugatedSiding() });
  const cableMat = new THREE.MeshToonMaterial({ color: 0x24262c, gradientMap });
  const mats = { gradientMap, structMat, glowMat, instMat, latticeMat, sidingMat, cableMat };

  const group = new THREE.Group();
  const pois = [];
  const updates = [];
  const place = (fn, x, z, yaw, poi) => {
    const r = fn(mats);
    r.group.position.set(x, 0, z);
    r.group.rotation.y = yaw;
    group.add(r.group);
    if (r.update) updates.push(r.update);
    pois.push({ x, z, ...poi });
  };

  // Docks on the west shore; the rest ring the northern / eastern outskirts.
  place(buildDocks, -224, 8, 0, { label: 'DOCKS', short: 'Docks', color: '#7d8894' });
  place(buildConstruction, -20, 202, Math.PI, { label: 'CONSTRUCTION', short: 'Site', color: '#e0b13a' });
  place(buildFactory, 120, 200, Math.PI, { label: 'FACTORY', short: 'Factory', color: '#9a8c72' });
  place(buildFarm, -150, 196, Math.PI, { label: 'FARM', short: 'Farm', color: '#7f9a52' });
  place(buildPowerPlant, 214, -70, -Math.PI / 2, { label: 'POWER PLANT', short: 'Power', color: '#b0aa9a' });

  // Soft transparent FX (smoke/steam sprites, welding-spark points) must be kept
  // out of the outline/normal prepass — it uses an override material and would
  // stamp stray quads into the sky. main.js hides these during that pass, just
  // like the grass.
  const fx = [];
  group.traverse((o) => { if (o.isSprite || o.isPoints) fx.push(o); });

  function update(dt, night) {
    for (let i = 0; i < updates.length; i++) updates[i](dt, night);
  }
  return { group, pois, glowMat, update, fx };
}
