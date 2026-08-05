import { box, cyl, merge, C } from './common.js';

// American diner — a long, low, stainless-steel retro building with a chrome
// eave, a red stripe, big front windows, a rooftop neon sign, and a small
// striped parking strip out front.
export function buildDiner() {
  const s = [
    box(16, 3.0, 6, 0, 1.5, 0, C.steel),          // long low body
    box(16, 0.9, 6, 0, 3.35, 0, C.cream),         // roof band
    cyl(0.4, 0.4, 16, 12, 0, 3.35, 3.0, C.steel, [0, 0, Math.PI / 2]), // chrome eave
    box(13, 2.0, 0.14, 0, 1.7, 3.02, C.glass),    // big front windows
    box(1.4, 2.3, 0.2, 0, 1.15, 3.05, C.metalDark), // door
  ];
  for (const mxp of [-5, -2.5, 2.5, 5]) s.push(box(0.16, 2.0, 0.16, mxp, 1.7, 3.04, C.metalDark)); // mullions
  // Rooftop neon sign facing the street.
  for (const fx of [-6.4, -3.1]) s.push(box(0.35, 4, 0.35, fx, 5.2, 2.2, C.metalDark));
  s.push(box(3.8, 2.6, 0.35, -4.75, 6.0, 2.2, C.navy)); // sign backing
  // Small parking strip with painted bays.
  s.push(box(14, 0.06, 4.4, 0, 0.07, 8.4, C.concreteDark));
  for (const lx of [-5.5, -2.7, 0, 2.7, 5.5]) s.push(box(0.2, 0.05, 3.6, lx, 0.1, 8.4, C.white));
  const glow = merge([
    box(12.8, 1.8, 0.13, 0, 1.75, 3.03, C.glassWarm), // warm interior
    box(16.3, 0.4, 0.34, 0, 2.55, 0, C.red),          // red neon stripe
    box(4.0, 0.42, 0.34, -4.75, 7.2, 2.22, C.red),    // neon top bar
    box(4.0, 0.42, 0.34, -4.75, 4.8, 2.22, C.teal),   // neon bottom bar
  ]);
  return {
    structure: merge(s),
    glow,
    sign: { x: -4.75, y: 6.0, z: 2.4, w: 3.4, h: 2.1 },
    collider: { cx: 0, cz: 0, w: 16.2, d: 6.2 },
  };
}
