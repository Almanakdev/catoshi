import { box, cyl, merge, C } from './common.js';

// Gas station — a large flat canopy on four pillars sheltering a fuel-pump
// island, a small kiosk shop behind, and a tall bright branded sign on a pole.
export function buildGasStation() {
  const s = [
    // Kiosk shop at the back.
    box(7, 3.5, 5, 0, 1.75, -6, C.cream),
    box(7.5, 0.5, 5.5, 0, 3.7, -6, C.terracotta),
    box(1.4, 2.6, 0.2, 1.6, 1.3, -3.45, C.woodDark), // door
    // Forecourt curb / island.
    box(15, 0.25, 2.4, 0, 0.12, 2, C.concrete),
    // Canopy on four pillars.
    box(16, 0.9, 12, 0, 6.1, 2, C.white),         // canopy slab
    box(16.4, 0.5, 12.4, 0, 5.5, 2, C.red),       // bright branded edge band
  ];
  for (const px of [-6.8, 6.8]) {
    for (const pz of [-3, 7]) s.push(box(0.7, 5.5, 0.7, px, 2.75, pz, C.steel));
  }
  // Three fuel pumps on the island.
  for (const px of [-4.5, 0, 4.5]) {
    s.push(box(1.0, 1.9, 1.3, px, 0.95, 2, C.metalDark)); // pump body
    s.push(box(1.1, 0.45, 1.3, px, 1.95, 2, C.red));      // pump topper
    s.push(box(0.14, 0.9, 0.14, px + 0.55, 1.2, 2.2, C.black)); // hose/nozzle
  }
  // Tall brand sign on a pole at the front corner.
  s.push(box(0.5, 9, 0.5, -7.6, 4.5, 8, C.steel));
  s.push(box(3.8, 2.4, 0.5, -7.6, 8.4, 8, C.green)); // logo panel backing
  s.push(box(4.2, 0.6, 0.5, -7.6, 6.9, 8, C.white)); // price strip

  const glow = merge([
    box(16.2, 0.35, 12.2, 0, 5.5, 2, C.glassWarm), // lit canopy underside band
    box(3.4, 0.6, 0.12, 0, 2, -3.44, C.glassWarm), // kiosk window
    box(0.75, 0.6, 0.12, -4.5, 1.5, 2.66, C.glassWarm), // pump displays
    box(0.75, 0.6, 0.12, 0, 1.5, 2.66, C.glassWarm),
    box(0.75, 0.6, 0.12, 4.5, 1.5, 2.66, C.glassWarm),
  ]);
  return {
    structure: merge(s),
    glow,
    sign: { x: -7.6, y: 8.4, z: 8.28, w: 3.4, h: 2.0 },
    collider: { cx: 0, cz: -2, w: 15.5, d: 12 },
  };
}
