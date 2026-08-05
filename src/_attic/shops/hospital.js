import { box, cyl, merge, C } from './common.js';
import { makeCivicFacade } from '../textures.js';

// Hospital — a clean modern block with a canvas-textured multi-window panel
// facade, horizontal floor ledges, a glass entrance with a wide canopy, a raised
// red cross, a covered ambulance bay (with an ambulance), a marked "H" helipad,
// and rooftop plant. Faces +Z.
export function buildHospital() {
  const WALL = '#e6ebec', TRIM = '#c6d0d4', RED = '#d23b32', WHITE = C.white;

  const facade = box(15, 8, 8, 0, 4.3, 0, WHITE);
  const facadeTex = makeCivicFacade({
    base: '#e2e8ea', pattern: 'panel', plinth: '#c4ced2', cornice: '#eef2f3',
    winCols: 5, winRows: 3, glass: '#bcd8e2', frame: '#9aa8ae', lit: '#fff0d2', wear: false,
  });

  const s = [
    box(15.5, 0.7, 8.5, 0, 0.35, 0, TRIM),            // base plinth
    box(15.6, 0.7, 8.6, 0, 8.55, 0, TRIM),            // roof cap
    box(15.2, 0.35, 8.2, 0, 9.0, 0, WALL),            // parapet
    // Horizontal floor ledges break the facade into storeys.
    box(15.2, 0.2, 8.16, 0, 3.05, 0, TRIM),
    box(15.2, 0.2, 8.16, 0, 5.75, 0, TRIM),
    // Entrance: glass doors, wide canopy on posts, apron.
    box(4.6, 3.2, 0.3, 3.0, 1.8, 4.1, C.glass),
    box(0.2, 3.2, 0.32, 0.7, 1.8, 4.16, TRIM),        // entrance mullions
    box(0.2, 3.2, 0.32, 3.0, 1.8, 4.16, TRIM),
    box(0.2, 3.2, 0.32, 5.3, 1.8, 4.16, TRIM),
    box(5.4, 0.4, 2.6, 3.0, 3.55, 5.1, TRIM),         // canopy slab
    cyl(0.14, 0.14, 3.5, 8, 0.9, 1.75, 6.2, C.steel), // canopy posts
    cyl(0.14, 0.14, 3.5, 8, 5.1, 1.75, 6.2, C.steel),
    box(5.6, 0.22, 1.7, 3.0, 0.12, 5.0, TRIM),        // entrance apron
    // Raised red cross emblem.
    box(3.0, 0.95, 0.3, -4.6, 6.4, 4.12, RED),
    box(0.95, 3.0, 0.3, -4.6, 6.4, 4.12, RED),
    // Helipad on the roof.
    cyl(3, 3, 0.24, 24, 0, 8.9, 0, C.concreteDark),
    cyl(2.5, 2.5, 0.26, 24, 0, 8.92, 0, C.grey),
    box(0.45, 2.6, 0.12, -0.85, 9.06, 0, C.white),
    box(0.45, 2.6, 0.12, 0.85, 9.06, 0, C.white),
    box(1.7, 0.45, 0.12, 0, 9.06, 0, C.white),
    // Rooftop plant (AC units + a vent stack).
    box(1.7, 0.9, 1.7, -5.2, 9.05, 2.6, C.metalDark),
    box(1.5, 0.8, 1.5, 5.0, 9.0, -2.2, C.metalDark),
    cyl(0.4, 0.4, 1.1, 8, 4.4, 9.15, 3.0, C.steel),
    // Covered ambulance bay + an ambulance under it.
    box(5.6, 0.4, 5.6, -5.6, 3.4, 5, TRIM),
  ];
  for (const [px, pz] of [[-8, 2.6], [-8, 7.2], [-3.2, 2.6], [-3.2, 7.2]]) {
    s.push(box(0.4, 3.4, 0.4, px, 1.7, pz, TRIM));
  }
  const ax = -5.6;
  s.push(box(2.4, 1.9, 4.6, ax, 1.05, 5, WHITE));       // ambulance body
  s.push(box(2.45, 0.45, 4.6, ax, 1.55, 5, RED));       // red stripe
  s.push(box(2.1, 0.8, 1.4, ax, 1.55, 7.5, C.glassWarm)); // cab windshield
  s.push(box(0.6, 0.6, 0.16, ax + 1.23, 1.6, 4.5, RED)); // side cross
  s.push(box(0.16, 0.6, 0.6, ax + 1.23, 1.6, 4.5, RED));
  s.push(box(1.3, 0.35, 0.5, ax, 2.15, 3.2, RED));       // light bar
  for (const wz of [3.2, 6.8]) {
    for (const wx of [1.0, -1.0]) s.push(cyl(0.38, 0.38, 0.26, 10, ax + wx, 0.4, wz, C.black, [0, 0, Math.PI / 2]));
  }

  const glow = merge([
    box(4.3, 3.0, 0.1, 3.0, 1.7, 4.25, C.glassWarm),   // lit entrance lobby
    box(1.3, 0.3, 0.5, ax, 2.15, 3.2, RED),            // lit ambulance light bar
  ]);
  // The red cross reads as a lit emblem day and night.
  const neon = merge([
    box(2.6, 0.7, 0.12, -4.6, 6.4, 4.28, '#ff4c40'),
    box(0.7, 2.6, 0.12, -4.6, 6.4, 4.28, '#ff4c40'),
  ]);

  return {
    structure: merge(s),
    facade, facadeTex,
    glow, neon,
    sign: { x: 3.0, y: 6.9, z: 4.06, w: 5, h: 1.1 },
    collider: { cx: -1, cz: 0, w: 17, d: 8.4 },
  };
}
