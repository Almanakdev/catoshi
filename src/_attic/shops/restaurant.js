import { box, cyl, merge, C } from './common.js';

// Restaurant — a cosy eatery with a red pitched-ish roof, a chunky red awning,
// a chimney, and an outdoor dining terrace (tables under parasols) out front.
export function buildRestaurant() {
  const s = [
    box(9, 4, 7, 0, 2, 0, C.cream),               // walls
    box(9.8, 0.7, 7.8, 0, 4.35, 0, C.terracotta), // roof slab
    box(0.9, 1.8, 0.9, -3, 5.1, -2, C.redDark),   // chimney
    box(1.6, 2.8, 0.25, 0, 1.4, 3.55, C.woodDark),// door
    box(9, 0.35, 2, 0, 3.5, 4.15, C.red, [-0.22, 0, 0]), // awning
    box(6.2, 1.3, 0.35, 0, 4.85, 3.5, C.redDark), // signboard backing
  ];
  // Outdoor terrace: two tables with parasols in the forecourt.
  for (const tx of [-2.8, 2.8]) {
    s.push(cyl(0.08, 0.08, 0.9, 6, tx, 0.45, 6.2, C.metal));       // table leg
    s.push(cyl(0.75, 0.75, 0.16, 10, tx, 0.95, 6.2, C.white));    // table top
    s.push(cyl(0.06, 0.06, 2.3, 6, tx, 1.4, 6.2, C.metalDark));   // parasol pole
    s.push(cyl(0.04, 1.55, 0.6, 10, tx, 2.7, 6.2, C.red));        // parasol canopy
    for (const cz of [5.5, 6.9]) s.push(box(0.6, 0.6, 0.6, tx, 0.4, cz, C.woodDark)); // stools
  }
  const glow = merge([
    box(5.6, 1.9, 0.15, 0, 2.3, 3.56, C.glassWarm), // warm-lit front window
  ]);
  return {
    structure: merge(s),
    glow,
    sign: { x: 0, y: 4.85, z: 3.72, w: 5.2, h: 1.05 },
    collider: { cx: 0, cz: 0, w: 9.2, d: 7.2 },
  };
}
