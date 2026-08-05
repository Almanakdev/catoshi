import { box, cyl, merge, C } from './common.js';

// Bar / pub — a cosy dark-timber facade with a gabled roof, warm glowing
// windows, a projecting hanging sign on a wrought bracket, and a couple of
// barrels and a bench out front.
export function buildPub() {
  const s = [
    box(7.5, 3.8, 6, 0, 1.9, 0, C.woodDark),      // dark-wood facade
    box(8.1, 0.6, 6.6, 0, 4.1, 0, C.wood),        // roof
    box(6.8, 1.4, 0.5, 0, 3.0, 3.05, C.wood, [0, 0, 0]), // timber lintel beam
    box(1.6, 2.6, 0.22, 0, 1.3, 3.05, C.woodDark),// double door
    box(2.3, 1.7, 0.16, -2.6, 1.75, 3.06, C.glass), // window L
    box(2.3, 1.7, 0.16, 2.6, 1.75, 3.06, C.glass),  // window R
    // Timber crossbeams for a mock-Tudor look.
    box(7.5, 0.18, 0.1, 0, 2.1, 3.12, C.wood),
    box(0.18, 3.6, 0.1, -3.4, 1.9, 3.12, C.wood),
    box(0.18, 3.6, 0.1, 3.4, 1.9, 3.12, C.wood),
  ];
  // Hanging sign on a wrought bracket at the front-left corner.
  const b = -3.5;
  s.push(box(1.7, 0.16, 0.16, b + 0.85, 3.6, 3.2, C.black)); // bracket arm
  s.push(box(0.12, 0.55, 0.12, b + 1.55, 3.35, 3.2, C.black)); // hanger
  s.push(box(1.9, 1.25, 0.14, b + 1.55, 2.65, 3.2, C.woodDark)); // hanging board
  // Barrels + a bench outside.
  for (const bx2 of [-3.2, -2.05]) s.push(cyl(0.5, 0.56, 1.1, 10, bx2, 0.55, 5.4, C.wood));
  s.push(cyl(0.42, 0.42, 0.9, 10, -2.6, 1.5, 5.4, C.wood)); // barrel used as a table
  s.push(box(2.4, 0.2, 0.6, 2.6, 0.72, 5.4, C.wood));       // bench seat
  s.push(box(2.4, 0.7, 0.15, 2.6, 1.15, 5.1, C.wood));      // bench back
  for (const lx of [1.6, 3.6]) s.push(box(0.16, 0.72, 0.5, lx, 0.36, 5.4, C.woodDark)); // bench legs
  const glow = merge([
    box(2.1, 1.5, 0.13, -2.6, 1.8, 3.07, C.glassWarm), // warm window glow L
    box(2.1, 1.5, 0.13, 2.6, 1.8, 3.07, C.glassWarm),  // warm window glow R
    box(0.9, 2.0, 0.1, 0, 1.4, 3.13, C.glassWarm),     // glow around the doorway
    box(1.7, 1.05, 0.1, b + 1.55, 2.65, 3.28, C.glassWarm), // lit hanging sign
  ]);
  return {
    structure: merge(s),
    glow,
    sign: { x: b + 1.55, y: 2.65, z: 3.29, w: 1.7, h: 1.05 },
    collider: { cx: 0, cz: 0, w: 7.7, d: 6.2 },
  };
}
