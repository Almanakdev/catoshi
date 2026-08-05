import { box, cyl, blob, merge, C } from './common.js';

// Bowling alley — a long, low building with big front windows and a giant
// bowling-pin sign standing on the roof as a landmark.
export function buildBowling() {
  const s = [
    box(16, 4, 8, 0, 2, 0, C.cream),               // long low hall
    box(16.4, 0.5, 8.4, 0, 4.2, 0, C.concreteDark),
    box(16, 1.1, 0.35, 0, 3.5, 4.05, C.tealDark),  // fascia band
    box(9, 2.2, 0.15, -2, 1.6, 4.02, C.glass),     // long front windows
    box(2, 2.6, 0.22, 5.5, 1.3, 4.05, C.metalDark),// entrance
  ];
  // Giant bowling pin on the roof.
  const px = -5;
  const py = 4.4;
  const sc = 2.4;
  s.push(cyl(0.5 * sc, 0.5 * sc, 0.4 * sc, 12, px, py + 0.2 * sc, 0, C.white));  // base
  s.push(cyl(0.74 * sc, 0.46 * sc, 1.2 * sc, 12, px, py + 1.0 * sc, 0, C.white));// belly
  s.push(cyl(0.34 * sc, 0.74 * sc, 0.9 * sc, 12, px, py + 2.05 * sc, 0, C.white));// neck
  s.push(cyl(0.44 * sc, 0.32 * sc, 0.55 * sc, 12, px, py + 2.75 * sc, 0, C.white));// head
  s.push(blob(0.42 * sc, px, py + 3.15 * sc, 0, C.white));                        // crown
  s.push(cyl(0.36 * sc, 0.36 * sc, 0.14 * sc, 12, px, py + 2.28 * sc, 0, C.red)); // stripe
  s.push(cyl(0.31 * sc, 0.31 * sc, 0.14 * sc, 12, px, py + 2.52 * sc, 0, C.red));
  const glow = merge([
    box(8.8, 2.0, 0.13, -2, 1.65, 4.03, C.glassWarm),
    box(16, 1.0, 0.12, 0, 3.5, 4.22, C.teal), // lit fascia
  ]);
  return {
    structure: merge(s),
    glow,
    sign: { x: 4, y: 3.5, z: 4.24, w: 6, h: 0.95 },
    collider: { cx: 0, cz: 0, w: 16.2, d: 8.2 },
  };
}
