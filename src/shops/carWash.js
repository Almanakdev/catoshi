import { box, cyl, blob, merge, C } from './common.js';

// Car wash — an open drive-through tunnel (side walls + roof, open both ends)
// with big rotating brushes and an overhead roller inside, a marked queue lane
// leading in, a pay booth, and a bright bubbly car-wash sign over the entrance.
export function buildCarWash() {
  const s = [
    box(0.6, 4.2, 12, -4, 2.1, 0, C.concrete),    // left wall
    box(0.6, 4.2, 12, 4, 2.1, 0, C.concrete),     // right wall
    box(9, 0.6, 12, 0, 4.4, 0, C.tealDark),       // roof
    box(9.2, 1.3, 0.6, 0, 3.7, 6.1, C.teal),      // entrance fascia band
    // Pay booth beside the entrance.
    box(1.8, 2.6, 1.8, 5.6, 1.3, 5, C.cream),
    box(2.1, 0.4, 2.1, 5.6, 2.75, 5, C.tealDark),
    box(0.9, 1.1, 0.12, 5.6, 1.4, 5.9, C.glass),
  ];
  // Vertical spinning brushes (blue) in two rows, plus an overhead roller.
  for (const bz of [3, -1, -4]) {
    for (const bx of [-2.6, 2.6]) {
      s.push(cyl(0.75, 0.75, 3.4, 12, bx, 1.9, bz, C.blue));
      s.push(cyl(0.82, 0.82, 0.35, 12, bx, 3.0, bz, C.blueLight)); // accent ring
      s.push(cyl(0.82, 0.82, 0.35, 12, bx, 0.9, bz, C.blueLight));
    }
  }
  s.push(cyl(0.5, 0.5, 7.4, 12, 0, 3.4, 1, C.blueLight, [0, 0, Math.PI / 2])); // overhead roller
  // Marked queue lane leading to the entrance.
  s.push(box(4, 0.06, 5, 0, 0.08, 9, C.concreteDark));
  for (const lz of [7.5, 9.5, 11]) {
    s.push(box(0.3, 0.05, 1.1, 0, 0.11, lz, C.white)); // centre dashes
  }
  // Bubble motif near the sign.
  for (const [bx, by, bz] of [[-3, 5.4, 6.2], [-2, 6.0, 6.2], [3.2, 5.6, 6.2]]) {
    s.push(blob(0.35, bx, by, bz, C.white));
  }
  const glow = merge([
    box(9, 1.1, 0.14, 0, 3.7, 6.32, C.glassWarm),  // lit entrance band
    box(0.85, 1.0, 0.1, 5.6, 1.4, 5.97, C.glassWarm), // booth window
  ]);
  return {
    structure: merge(s),
    glow,
    sign: { x: 0, y: 5.2, z: 6.35, w: 5.4, h: 1.5 },
    collider: { cx: 0, cz: 0, w: 9, d: 12 },
  };
}
