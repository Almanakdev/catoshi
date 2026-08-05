import { box, cyl, merge, C } from './common.js';

// Barber shop — crisp blue-and-white front with the iconic spinning barber
// pole (red / white / blue) beside the door, and a big shopfront window.
export function buildBarber() {
  const s = [
    box(7, 3.6, 5.5, 0, 1.8, 0, C.blueLight),     // walls
    box(7.6, 0.55, 6.1, 0, 3.85, 0, C.navy),      // roof
    box(7, 1.0, 0.3, 0, 3.3, 2.9, C.navy),        // sign band
    box(1.4, 2.6, 0.22, 2.1, 1.3, 2.8, C.woodDark), // door
    box(3.8, 2.1, 0.16, -1, 1.7, 2.82, C.glass),  // shopfront window
  ];
  // Barber pole: a striped cylinder in a little bracket by the door.
  const px = -3.2;
  s.push(box(0.5, 0.5, 0.4, px, 3.0, 2.9, C.steel));  // top cap
  s.push(box(0.5, 0.5, 0.4, px, 0.9, 2.9, C.steel));  // bottom cap
  const poleColors = [C.red, C.white, C.blue, C.white, C.red, C.white];
  for (let i = 0; i < poleColors.length; i++) {
    s.push(cyl(0.22, 0.22, 0.32, 10, px, 1.25 + i * 0.32, 2.95, poleColors[i]));
  }
  const glow = merge([box(3.6, 1.8, 0.14, -1, 1.75, 2.83, C.glassWarm)]);
  return {
    structure: merge(s),
    glow,
    sign: { x: 0, y: 3.3, z: 3.06, w: 4.6, h: 0.9 },
    collider: { cx: 0, cz: 0, w: 7.2, d: 5.7 },
  };
}
