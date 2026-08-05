import { box, cyl, blob, merge, C } from './common.js';

// Bakery — a snug shop with a big glazed display window full of pastries, a
// warm striped awning, a chimney (for the ovens), and a bread/cake signboard.
export function buildBakery() {
  const s = [
    box(7, 3.4, 5.5, 0, 1.7, 0, C.warm),          // walls
    box(7.6, 0.6, 6.1, 0, 3.7, 0, C.terracotta),  // roof
    box(5, 2.4, 0.15, -0.6, 1.5, 2.82, C.glass),  // big display window
    box(1.3, 2.4, 0.2, 2.5, 1.2, 2.82, C.wood),   // door
    box(7, 0.32, 1.7, 0, 3.05, 3.4, C.orange, [-0.24, 0, 0]), // awning
    box(4.6, 1.0, 0.3, 0, 4.15, 2.78, C.terracotta), // sign backing
    box(0.7, 1.5, 0.7, -2.6, 4.3, -1.6, C.concreteDark), // oven chimney
  ];
  // Pastries on two shelves inside the display window.
  const treats = ['#e8b04a', '#d9743a', '#f2d17a', '#c9895a', '#e5a06f'];
  let t = 0;
  for (const y of [1.05, 1.85]) {
    s.push(box(4.4, 0.1, 0.5, -0.6, y - 0.06, 1.55, C.white)); // shelf
    for (const px of [-2.4, -1.4, -0.4, 0.6, 1.2]) {
      s.push(blob(0.22, px, y + 0.16, 1.65, treats[t++ % treats.length]));
    }
  }
  const glow = merge([
    box(4.8, 2.2, 0.13, -0.6, 1.55, 2.83, C.glassWarm), // warm-lit display
  ]);
  return {
    structure: merge(s),
    glow,
    sign: { x: 0, y: 4.15, z: 2.96, w: 4.2, h: 0.9 },
    collider: { cx: 0, cz: 0, w: 7.2, d: 5.7 },
  };
}
