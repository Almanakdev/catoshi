import { box, cyl, blob, merge, C } from './common.js';

// Florist — a green shopfront overflowing with colour: a striped-look green
// awning and rows of tilted buckets full of bright flower blooms out front.
export function buildFlorist() {
  const s = [
    box(7, 3.4, 5, 0, 1.7, 0, C.greenDark),       // walls
    box(7.6, 0.55, 5.6, 0, 3.65, 0, C.green),     // roof
    box(4.6, 2.1, 0.14, -0.6, 1.6, 2.57, C.glass),// window
    box(1.3, 2.4, 0.2, 2.4, 1.2, 2.57, C.wood),   // door
    box(7, 0.32, 1.6, 0, 3.0, 3.3, C.green, [-0.24, 0, 0]), // awning
    box(4.6, 1.0, 0.3, 0, 4.25, 2.55, C.greenDark), // sign backing
  ];
  // A tiered flower stand of tilted buckets brimming with colourful blooms.
  const bloom = ['#e05a6f', '#f2c14e', '#e58fce', '#f0913a', '#8f6fd0', '#ef5f5f', '#f6d774'];
  let bi = 0;
  for (let row = 0; row < 2; row++) {
    const z = 4.2 + row * 1.2;
    const y = 0.4 + row * 0.5;
    for (const x of [-2.6, -1.3, 0, 1.3, 2.6]) {
      s.push(cyl(0.32, 0.24, 0.7, 8, x, y + 0.35, z, C.metalDark)); // bucket
      // a little bunch of blooms
      for (let k = 0; k < 3; k++) {
        s.push(
          blob(
            0.22,
            x + (k - 1) * 0.16,
            y + 0.8 + (k % 2) * 0.12,
            z + (k - 1) * 0.1,
            bloom[bi++ % bloom.length]
          )
        );
      }
    }
  }
  const glow = merge([box(4.4, 1.8, 0.13, -0.6, 1.65, 2.58, C.glassWarm)]);
  return {
    structure: merge(s),
    glow,
    sign: { x: 0, y: 4.25, z: 2.72, w: 4.2, h: 0.9 },
    collider: { cx: 0, cz: 0, w: 7.2, d: 5.2 },
  };
}
