import * as THREE from 'three';
import { buildHillsideSign } from './hillsideSign.js';
import { buildSkyscraper } from './skyscraper.js';
import { buildStadium } from './stadium.js';
import { buildLighthouse } from './lighthouse.js';
import { buildTokyoTower } from './tokyoTower.js';
import { buildSkytree } from './skytree.js';
import { buildScrambleCrossing } from './scrambleCrossing.js';

// Places the iconic landmarks around the map. Returns
// { group, pois, glowMat, update(dt, night) } — push pois onto the minimap and
// glowMat onto the night-ramp; call update each frame with the day-night factor
// so the lighthouse beam sweeps and fades in with nightfall.
export function createLandmarks({ gradientMap, towerSpot }) {
  const structMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
  const glowMat = new THREE.MeshToonMaterial({
    vertexColors: true,
    gradientMap,
    emissive: new THREE.Color(0xffd9a0),
    emissiveIntensity: 0,
  });
  const mats = { gradientMap, structMat, glowMat };

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

  // Hill sign on its own island out in the northern water (seen from afar); the
  // tower on the reserved city block; the stadium on reclaimed land off the east
  // coast; the lighthouse on the south-west shore.
  place(buildHillsideSign, -30, 305, Math.PI, { label: 'URBAN HOOD SIGN', short: 'Sign', color: '#f4ecd8' });
  place(buildSkyscraper, towerSpot.x, towerSpot.z, 0, { label: 'GRAND TOWER', short: 'Tower', color: '#c9a24a' });
  place(buildStadium, 268, 15, 0, { label: 'STADIUM', short: 'Stadium', color: '#7d8a9a' });
  place(buildLighthouse, -232, -120, 0.4, { label: 'LIGHTHOUSE', short: 'Lighthouse', color: '#d33a2a' });

  // Neo-Tokyo icons: a red-and-white comms tower, a very tall broadcast tower,
  // a Shibuya-style scramble with animated screens, and a looping monorail.
  place(buildTokyoTower, 214, -150, 0, { label: 'TOKYO TOWER', short: 'Comm Tower', color: '#e8492b' });
  place(buildSkytree, -205, 150, 0, { label: 'SKY TREE', short: 'Skytree', color: '#8fa0ff' });
  place(buildScrambleCrossing, 255, 190, 0.3, { label: 'SCRAMBLE', short: 'Crossing', color: '#ff2d95' });
  // (The monorail now runs across the city itself — built in city.js.)

  function update(dt, night) {
    for (let i = 0; i < updates.length; i++) updates[i](dt, night);
  }
  return { group, pois, glowMat, update };
}
