import { box, cyl, merge, C } from './common.js';
import { makeCivicFacade } from '../textures.js';

// Bank — a grand marble-faced building: a canvas-textured ashlar-stone facade,
// a classical colonnade carrying a triangular pediment, a stepped entrance with
// a brass door frame, framed tall windows, a projecting cornice + parapet, and a
// standalone ATM out on the sidewalk. Faces +Z.
export function buildBank() {
  const STONE = '#e7dfca', STONE_D = '#c8bd9e', BRASS = '#c9a24a', WHITE = C.white;

  // Textured marble facade (the main volume); the box colour is ignored — the
  // canvas map + emissive window map drive it.
  const facade = box(13, 6.5, 8, 0, 3.6, 0, WHITE);
  const facadeTex = makeCivicFacade({
    base: STONE, pattern: 'ashlar', plinth: STONE_D, cornice: '#d8cdb0',
    winCols: 4, winRows: 2, glass: '#c6d8de', frame: '#8a7a5c', lit: '#ffe6b0', wear: true,
  });

  const s = [
    // Base plinth + projecting cornice + parapet (break the box top & bottom).
    box(13.6, 0.7, 8.6, 0, 0.35, 0, STONE_D),
    box(13.8, 0.8, 8.8, 0, 6.95, 0, STONE_D),
    box(13.4, 0.35, 8.4, 0, 7.5, 0, STONE),
    // Stepped entrance out front.
    box(7.5, 0.3, 3.2, 0, 0.15, 5.2, STONE),
    box(6.5, 0.3, 2.4, 0, 0.45, 5.5, STONE),
    box(5.5, 0.3, 1.6, 0, 0.75, 5.8, STONE),
    // Portico: stylobate + entablature + triangular pediment + finial.
    box(11.5, 0.5, 2.0, 0, 1.1, 5.4, STONE),
    box(11, 1.2, 1.6, 0, 6.2, 5.4, STONE_D),
    box(6.8, 0.5, 1.6, -2.9, 7.0, 5.4, STONE_D, [0, 0, 0.32]),
    box(6.8, 0.5, 1.6, 2.9, 7.0, 5.4, STONE_D, [0, 0, -0.32]),
    box(1.0, 0.6, 1.7, 0, 7.55, 5.4, BRASS),
  ];
  // Column colonnade (shaft + capital + base).
  for (const cx of [-4.4, -2.2, 0, 2.2, 4.4]) {
    s.push(cyl(0.4, 0.46, 4.6, 12, cx, 3.6, 5.4, WHITE));
    s.push(box(1.05, 0.35, 1.05, cx, 5.9, 5.4, STONE));
    s.push(box(1.05, 0.3, 1.05, cx, 1.4, 5.4, STONE));
  }
  // Brass entrance frame + recessed glass doors.
  s.push(box(3.6, 3.6, 0.4, 0, 1.9, 4.15, BRASS));
  s.push(box(3.0, 3.2, 0.2, 0, 1.7, 4.25, C.glass));
  s.push(box(0.16, 3.2, 0.24, 0, 1.7, 4.34, BRASS));
  // 3D window frames + sills on the front flanks (over the textured windows).
  for (const wx of [-5, 5]) {
    s.push(box(2.5, 0.2, 0.4, wx, 3.15, 4.14, STONE));   // sill
    s.push(box(2.5, 0.16, 0.4, wx, 5.6, 4.14, STONE));   // lintel
    s.push(box(0.18, 2.5, 0.34, wx - 1.15, 4.4, 4.12, STONE_D)); // mullions
    s.push(box(0.18, 2.5, 0.34, wx + 1.15, 4.4, 4.12, STONE_D));
  }
  // Standalone ATM on the sidewalk.
  const mx = -6.0, mz = 7.4;
  s.push(box(1.2, 2.1, 0.9, mx, 1.05, mz, C.metalDark));
  s.push(box(0.9, 0.5, 0.15, mx, 0.85, mz + 0.48, C.steel));
  s.push(box(0.4, 0.35, 0.16, mx, 2.05, mz + 0.5, BRASS));
  // Rooftop emblem block.
  s.push(box(2.2, 1.4, 0.6, 0, 8.15, 2.6, STONE_D));

  const glow = merge([
    box(3.0, 3.0, 0.1, 0, 1.7, 4.3, C.glassWarm),         // lit entrance interior
    box(0.9, 0.5, 0.1, mx, 0.85, mz + 0.56, C.glassWarm), // ATM screen
  ]);
  const neon = merge([
    box(0.5, 0.35, 0.12, mx, 2.05, mz + 0.58, '#39d06a'), // ATM brand glow
  ]);

  return {
    structure: merge(s),
    facade, facadeTex,
    glow, neon,
    sign: { x: 0, y: 6.15, z: 6.25, w: 6, h: 1.0 }, // on the entablature front
    collider: { cx: 0, cz: 0, w: 13.2, d: 8.4 },
  };
}
