import { box, cyl, car, merge, C } from './common.js';
import { makeCivicFacade } from '../textures.js';

// Police station — an official brick/concrete building: a canvas-textured facade
// with barred windows, a stepped entrance flanked by lamps, a portico, a glowing
// blue signage band, a flag on a pole, a rooftop antenna, and two black-and-white
// patrol cars parked out front. Faces +Z.
export function buildPolice() {
  const CONC = '#c0b498', CONC_D = '#9a8f78', BLUE = C.navy, WHITE = C.white;

  const facade = box(12, 6, 7, 0, 3.3, 0, WHITE);
  const facadeTex = makeCivicFacade({
    base: '#b4a890', pattern: 'brick', plinth: CONC_D, cornice: CONC,
    winCols: 4, winRows: 2, glass: '#aeb8bc', frame: '#5a5142', lit: '#ffe0a0', bars: true, wear: true,
  });

  const s = [
    box(12.5, 0.7, 7.5, 0, 0.35, 0, CONC_D),          // base plinth
    box(12.6, 0.7, 7.6, 0, 6.3, 0, CONC_D),           // roof cap
    box(12.2, 0.35, 7.2, 0, 6.8, 0, CONC),            // parapet
    box(12.2, 1.1, 0.4, 0, 5.35, 3.55, BLUE),         // blue signage band
    // Stepped entrance + portico.
    box(5.0, 0.3, 2.2, 0, 0.15, 4.0, CONC),
    box(4.2, 0.3, 1.4, 0, 0.45, 4.3, CONC),
    box(3.0, 3.0, 0.2, 0, 1.65, 3.55, C.glass),       // entrance glazing
    box(0.18, 3.0, 0.24, -0.75, 1.65, 3.62, CONC),    // door mullions
    box(0.18, 3.0, 0.24, 0.75, 1.65, 3.62, CONC),
    box(4.8, 0.4, 1.8, 0, 3.7, 4.4, CONC_D),          // portico roof
  ];
  for (const cx of [-1.9, 1.9]) s.push(cyl(0.3, 0.34, 3.7, 10, cx, 1.85, 5.0, WHITE)); // columns
  // Entrance lamps on short posts flanking the steps.
  for (const lx of [-2.9, 2.9]) {
    s.push(cyl(0.1, 0.12, 2.4, 8, lx, 1.2, 4.2, C.metalDark));
    s.push(box(0.5, 0.5, 0.5, lx, 2.55, 4.2, C.steel));
  }
  // 3D bars over the ground-floor front windows (reinforce the barred look).
  for (const wx of [-4, 4]) {
    s.push(box(2.4, 0.16, 0.3, wx, 3.5, 3.55, CONC_D)); // sill
    s.push(box(2.4, 0.16, 0.3, wx, 1.9, 3.55, CONC_D)); // head
    for (let i = 0; i < 5; i++) s.push(box(0.08, 1.6, 0.24, wx - 0.9 + i * 0.45, 2.7, 3.58, C.metalDark));
  }
  // Flag on a pole at the corner.
  s.push(cyl(0.12, 0.12, 6.5, 6, -5.5, 3.25, 3.6, C.steel));
  s.push(box(1.7, 1.05, 0.08, -4.6, 6.0, 3.6, C.blue));
  // Rooftop antenna mast.
  s.push(cyl(0.09, 0.09, 3.0, 6, 4.8, 8.0, -1.5, C.metalDark));
  s.push(box(1.4, 0.1, 0.1, 4.8, 9.2, -1.5, C.metalDark));
  // Two black-and-white patrol cars out front.
  for (const cx of [-3.5, 3.5]) {
    for (const g of car(cx, 6.4, WHITE, { cabin: WHITE, w: 2.1, len: 4.2 })) s.push(g);
    s.push(box(2.15, 0.9, 1.3, cx, 0.75, 6.4, BLUE));
    s.push(box(1.2, 0.32, 0.5, cx, 2.05, 6.25, C.metalDark)); // light bar base
    s.push(box(0.5, 0.3, 0.45, cx - 0.32, 2.1, 6.25, C.red));
    s.push(box(0.5, 0.3, 0.45, cx + 0.32, 2.1, 6.25, C.blue));
  }

  const glow = merge([
    box(2.8, 2.8, 0.1, 0, 1.65, 3.68, C.glassWarm),   // lit lobby
    box(0.42, 0.42, 0.42, -2.9, 2.55, 4.2, C.glassWarm), // entrance lamps
    box(0.42, 0.42, 0.42, 2.9, 2.55, 4.2, C.glassWarm),
    box(0.5, 0.28, 0.45, -3.5 - 0.32, 2.1, 6.26, C.red),
    box(0.5, 0.28, 0.45, -3.5 + 0.32, 2.1, 6.26, C.blue),
    box(0.5, 0.28, 0.45, 3.5 - 0.32, 2.1, 6.26, C.red),
    box(0.5, 0.28, 0.45, 3.5 + 0.32, 2.1, 6.26, C.blue),
  ]);
  // Glowing blue "POLICE" signage band.
  const neon = merge([
    box(12.0, 0.85, 0.12, 0, 5.35, 3.76, '#2f6bff'),
  ]);

  return {
    structure: merge(s),
    facade, facadeTex,
    glow, neon,
    sign: { x: 0, y: 5.35, z: 3.78, w: 6, h: 0.9 },
    collider: { cx: 0, cz: 0, w: 12.2, d: 7.2 },
  };
}
