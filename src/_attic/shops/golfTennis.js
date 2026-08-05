import { box, cyl, merge, C } from './common.js';

// Golf & tennis area — an open green with a putting green (hole + flag) and a
// sand bunker on one side, and a fenced, net-divided tennis court on the other,
// with a small sign on a post.
export function buildGolfTennis() {
  const s = [
    box(20, 0.12, 15, 0, 0.06, 0, C.green), // green field
  ];
  // Putting green: darker disc, hole + flagstick, sand bunker.
  s.push(cyl(4.4, 4.4, 0.1, 22, -5, 0.13, -1.5, C.greenDark));
  s.push(cyl(0.35, 0.35, 0.12, 12, -4, 0.15, -0.5, C.black)); // hole
  s.push(cyl(0.05, 0.05, 2.4, 6, -4, 1.25, -0.5, C.white));   // flagstick
  s.push(box(1.3, 0.75, 0.04, -3.3, 2.05, -0.5, C.red));      // flag
  s.push(cyl(1.6, 1.6, 0.09, 16, -7.5, 0.12, 3.5, C.sand));   // bunker
  // Tennis court: coloured surface, white lines, net + posts, and a fence.
  const tx = 6;
  s.push(box(9, 0.12, 12, tx, 0.13, 0, '#3f7d5a')); // court
  // Lines (perimeter + service + centre).
  s.push(box(9, 0.04, 0.16, tx, 0.2, -6, C.white));
  s.push(box(9, 0.04, 0.16, tx, 0.2, 6, C.white));
  s.push(box(0.16, 0.04, 12, tx - 4.4, 0.2, 0, C.white));
  s.push(box(0.16, 0.04, 12, tx + 4.4, 0.2, 0, C.white));
  s.push(box(0.14, 0.04, 12, tx, 0.2, 0, C.white));
  // Net.
  s.push(box(9.6, 0.7, 0.08, tx, 0.55, 0, C.metalDark));
  s.push(box(9.6, 0.1, 0.1, tx, 0.9, 0, C.white));
  for (const nx of [tx - 4.8, tx + 4.8]) s.push(cyl(0.08, 0.08, 1.1, 6, nx, 0.55, 0, C.metalDark));
  // Fence: corner + side posts and a top rail around the court.
  const fx0 = tx - 4.9;
  const fx1 = tx + 4.9;
  for (const fz of [-6.3, -3, 0, 3, 6.3]) {
    s.push(cyl(0.07, 0.07, 2.6, 6, fx0, 1.3, fz, C.metalDark));
    s.push(cyl(0.07, 0.07, 2.6, 6, fx1, 1.3, fz, C.metalDark));
  }
  for (const fx of [fx0 + 2.45, fx1 - 2.45]) {
    s.push(cyl(0.07, 0.07, 2.6, 6, fx, 1.3, -6.3, C.metalDark));
    s.push(cyl(0.07, 0.07, 2.6, 6, fx, 1.3, 6.3, C.metalDark));
  }
  s.push(box(0.06, 0.1, 12.6, fx0, 2.6, 0, C.metal)); // top rails
  s.push(box(0.06, 0.1, 12.6, fx1, 2.6, 0, C.metal));
  s.push(box(9.8, 0.1, 0.06, tx, 2.6, -6.3, C.metal));
  s.push(box(9.8, 0.1, 0.06, tx, 2.6, 6.3, C.metal));
  // Sign post.
  s.push(cyl(0.12, 0.12, 3, 6, -1, 1.5, 7, C.metalDark));
  s.push(box(3.2, 1.0, 0.2, -1, 3.1, 7, C.greenDark));
  return {
    structure: merge(s),
    sign: { x: -1, y: 3.1, z: 7.12, w: 2.9, h: 0.9 },
    collider: { cx: 6, cz: 0, w: 9.5, d: 12.4 }, // block the court; the green stays walkable
  };
}
