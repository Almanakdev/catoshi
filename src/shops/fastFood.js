import { box, cyl, blob, merge, C } from './common.js';

// Fast-food joint — bright, cheerful red-and-yellow box with a big grinning
// mascot on the roof, a side drive-thru lane (canopy + menu board), and a
// cluster of colourful outdoor tables.
export function buildFastFood() {
  const s = [
    box(9, 3.6, 7, 0, 1.8, 0, C.yellow),          // walls
    box(9.6, 0.6, 7.6, 0, 3.9, 0, C.red),         // roof
    box(9, 1.1, 0.35, 0, 3.35, 3.05, C.red),      // fascia band
    box(5, 2.3, 0.15, -0.8, 1.65, 3.06, C.glass), // front glass
    box(2, 2.6, 0.22, 3, 1.3, 3.05, C.metalDark), // entrance
  ];
  // Roof mascot — a cheerful round character on a plinth + pole.
  const m = -2.5;
  s.push(box(2, 0.5, 2, m, 4.2, 0, C.white));
  s.push(cyl(0.28, 0.32, 2, 8, m, 5.4, 0, C.metalDark));
  s.push(blob(1.4, m, 7.1, 0, C.orange));         // head
  s.push(blob(0.34, m - 0.5, 7.4, 1.15, C.white));
  s.push(blob(0.34, m + 0.5, 7.4, 1.15, C.white));
  s.push(box(0.18, 0.18, 0.18, m - 0.5, 7.4, 1.45, C.black));
  s.push(box(0.18, 0.18, 0.18, m + 0.5, 7.4, 1.45, C.black));
  s.push(box(1.3, 0.32, 0.3, m, 6.55, 1.2, C.red)); // smile
  // Drive-thru lane along the +X side: canopy, posts and a menu board.
  s.push(box(2.2, 0.3, 6, 5.7, 3.25, 1, C.red));
  for (const pz of [-1.6, 1.4, 4]) s.push(cyl(0.14, 0.14, 3.3, 6, 5.7, 1.6, pz, C.metalDark));
  s.push(box(1.6, 2.0, 0.35, 5.7, 1.3, 4.4, C.metalDark)); // menu board
  // Outdoor seating.
  for (const tx of [-3.2, 3.2]) {
    s.push(cyl(0.1, 0.1, 0.9, 6, tx, 0.45, 6.4, C.metal));
    s.push(cyl(0.7, 0.7, 0.15, 8, tx, 0.95, 6.4, C.red));
    for (const cz of [5.6, 7.2]) s.push(box(0.6, 0.5, 0.6, tx, 0.3, cz, C.yellow));
  }
  const glow = merge([
    box(4.8, 2.0, 0.14, -0.8, 1.7, 3.07, C.glassWarm),
    box(9, 0.9, 0.12, 0, 3.35, 3.22, C.yellow),   // lit fascia
    box(1.5, 1.6, 0.1, 5.7, 1.4, 4.57, C.glassWarm), // lit menu board
  ]);
  return {
    structure: merge(s),
    glow,
    sign: { x: 0, y: 3.35, z: 3.24, w: 5.2, h: 0.92 },
    collider: { cx: 0, cz: 0, w: 9.4, d: 7.2 },
  };
}
