import { box, merge, C } from './common.js';

// Cinema — a wide building with a projecting marquee sign over the entrance
// (ringed with warm bulbs that light up at night) and a row of framed movie
// poster panels along the facade.
export function buildCinema() {
  const s = [
    box(15, 6.5, 8, 0, 3.25, 0, '#7a3346'),        // burgundy walls
    box(15.4, 0.6, 8.4, 0, 6.8, 0, C.concreteDark),// roof cap
    box(4, 3, 0.2, 0, 1.5, 4.05, C.glass),         // entrance glazing
    // Projecting marquee.
    box(9, 2.2, 2.6, 0, 4.5, 4.9, '#2a2a38'),
    box(9.3, 0.4, 2.8, 0, 5.7, 4.9, '#1c1c28'),
    box(0.35, 1.6, 2.6, -4.5, 3.4, 4.9, '#1c1c28'),
    box(0.35, 1.6, 2.6, 4.5, 3.4, 4.9, '#1c1c28'),
  ];
  // Framed poster panels.
  const posters = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad'];
  for (let i = 0; i < 4; i++) {
    const x = -5.4 + i * 3.6;
    s.push(box(2.0, 2.7, 0.12, x, 2.5, 4.03, '#141018'));
    s.push(box(1.7, 2.4, 0.14, x, 2.5, 4.05, posters[i]));
  }
  const glow = merge([
    box(9.2, 0.3, 0.16, 0, 3.45, 6.25, C.glassWarm), // marquee bulb ring
    box(9.2, 0.3, 0.16, 0, 5.55, 6.25, C.glassWarm),
    box(0.3, 2.2, 0.16, -4.5, 4.5, 6.25, C.glassWarm),
    box(0.3, 2.2, 0.16, 4.5, 4.5, 6.25, C.glassWarm),
    box(8.4, 1.5, 0.1, 0, 4.5, 6.22, C.glassWarm),   // sign backlight
    box(1.7, 2.4, 0.1, -5.4, 2.5, 4.06, C.glassWarm),// lit poster cases
    box(1.7, 2.4, 0.1, 5.4, 2.5, 4.06, C.glassWarm),
  ]);
  return {
    structure: merge(s),
    glow,
    sign: { x: 0, y: 4.5, z: 6.3, w: 7.2, h: 1.5 },
    collider: { cx: 0, cz: 0, w: 15.2, d: 8.2 },
  };
}
