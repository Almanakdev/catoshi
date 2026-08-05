import { box, cyl, blob, merge, C } from './common.js';

// Café — a small warm-timber corner coffee house with a striped-look brown
// awning, a round bistro terrace, a planter, and a chalkboard menu.
export function buildCafe() {
  const s = [
    box(7.5, 3.6, 6, 0, 1.8, 0, C.warm),          // walls
    box(8.2, 0.6, 6.6, 0, 3.9, 0, C.wood),        // roof
    box(4.4, 2.2, 0.16, 0, 1.7, 3.05, C.glass),   // shopfront glass (behind counter)
    box(1.3, 2.4, 0.22, 2.4, 1.2, 3.05, C.woodDark), // door
    box(7.5, 0.32, 1.7, 0, 3.05, 3.7, C.wood, [-0.24, 0, 0]), // awning
    box(5, 1.1, 0.32, 0, 4.35, 2.95, C.woodDark), // sign backing
    box(1.4, 1.6, 0.12, -3.4, 1.3, 3.2, C.black), // chalkboard menu
  ];
  // Bistro terrace: two round tables + chairs, and a leafy planter.
  for (const tx of [-1.8, 2.2]) {
    s.push(cyl(0.06, 0.06, 0.85, 6, tx, 0.42, 5.6, C.metalDark));
    s.push(cyl(0.55, 0.55, 0.14, 10, tx, 0.9, 5.6, C.white));
    for (const cz of [5.0, 6.2]) {
      s.push(cyl(0.35, 0.35, 0.1, 8, tx, 0.55, cz, C.terracotta));
      s.push(cyl(0.05, 0.05, 0.55, 6, tx, 0.28, cz, C.metalDark));
    }
  }
  s.push(box(1.6, 0.7, 0.9, -3.2, 0.35, 5.4, C.woodDark)); // planter box
  s.push(blob(0.7, -3.2, 1.1, 5.4, C.leaf));               // planter foliage
  const glow = merge([box(4.2, 1.9, 0.14, 0, 1.8, 3.06, C.glassWarm)]);
  return {
    structure: merge(s),
    glow,
    sign: { x: 0, y: 4.35, z: 3.15, w: 4.2, h: 0.95 },
    collider: { cx: 0, cz: 0, w: 7.7, d: 6.2 },
  };
}
