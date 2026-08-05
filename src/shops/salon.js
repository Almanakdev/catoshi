import { box, cyl, merge, C } from './common.js';

// Beauty salon — a chic pink-and-white front with a full glass window (styling
// chairs hinted inside), a rounded canopy, a giant scissors emblem, and a
// planter of ornamental topiary.
export function buildSalon() {
  const s = [
    box(7.5, 3.8, 5.5, 0, 1.9, 0, C.pinkLight),   // walls
    box(8.1, 0.55, 6.1, 0, 4.05, 0, C.pink),      // roof
    box(6, 2.4, 0.14, 0, 1.8, 2.82, C.glass),     // big glass front
    box(1.3, 2.5, 0.2, 2.6, 1.25, 2.9, C.purple), // door
    box(7.5, 0.3, 1.4, 0, 3.35, 3.2, C.pink, [-0.26, 0, 0]), // canopy
    box(4.6, 1.0, 0.3, 0, 4.5, 2.85, C.purple),   // sign backing
  ];
  // Two styling chairs visible through the glass.
  for (const cx of [-1.8, 0.4]) {
    s.push(cyl(0.05, 0.05, 0.9, 8, cx, 0.45, 1.4, C.metalDark));
    s.push(box(0.8, 0.35, 0.8, cx, 0.95, 1.4, C.white));
    s.push(box(0.8, 1.0, 0.2, cx, 1.6, 1.05, C.white));
  }
  // Scissors emblem on the wall (two crossed blades + rings).
  s.push(box(0.15, 1.4, 0.1, -2.9, 2.0, 2.86, C.metalDark, [0, 0, 0.4]));
  s.push(box(0.15, 1.4, 0.1, -2.9, 2.0, 2.86, C.metalDark, [0, 0, -0.4]));
  // Topiary planters flanking the door.
  for (const cx of [-3.2, 3.2]) {
    s.push(box(0.8, 0.7, 0.8, cx, 0.35, 3.4, C.white));
    s.push(cyl(0.45, 0.5, 0.9, 8, cx, 1.15, 3.4, C.greenDark));
  }
  const glow = merge([box(5.6, 2.0, 0.13, 0, 1.85, 2.83, C.glassWarm)]);
  return {
    structure: merge(s),
    glow,
    sign: { x: 0, y: 4.5, z: 3.05, w: 4.2, h: 0.9 },
    collider: { cx: 0, cz: 0, w: 7.7, d: 5.7 },
  };
}
