import { box, cyl, merge, C } from './common.js';
import { makeCivicFacade } from '../textures.js';

// Fire station — a red-brick hall with a canvas-textured brick facade, big red
// panelled roll-up doors, a hose-drying / bell tower to one side, an engine bay
// with a fire truck rolling out, an apron, and a rooftop parapet. Faces +Z.
export function buildFire() {
  const BRICK = '#a5543a', BRICK_D = '#7a3f2e', WHITE = C.white, DOOR = '#c33a2c', DOOR_D = '#8f2a20';

  const facade = box(13, 5.5, 8, 0, 3.05, 0, WHITE);
  const facadeTex = makeCivicFacade({
    base: BRICK, pattern: 'brick', plinth: BRICK_D, cornice: '#8f4a36',
    winCols: 4, winRows: 1, glass: '#bcd2dc', frame: '#5a3324', lit: '#ffdca0', wear: true,
  });

  const s = [
    box(13.5, 0.7, 8.5, 0, 0.35, 0, BRICK_D),         // base plinth
    box(13.6, 0.7, 8.6, 0, 5.85, 0, BRICK_D),         // roof cap
    box(13.2, 0.4, 8.2, 0, 6.3, 0, BRICK),            // parapet
    box(13, 1.1, 0.35, 0, 5.15, 4.05, WHITE),         // white fascia (sign band)
    // Concrete apron the trucks roll over.
    box(11, 0.15, 3.2, 1.0, 0.08, 5.6, C.concrete),
    // Hose-drying / bell tower to one side.
    box(3, 8.5, 3, -6.5, 4.25, -1, BRICK_D),
    box(3.3, 0.5, 3.3, -6.5, 8.6, -1, C.concreteDark),
    box(0.7, 0.7, 0.7, -6.5, 9.1, -1, C.yellow),      // bell
    box(1.4, 3.0, 0.16, -6.5, 5.0, 0.55, C.metalDark), // hanging hose panel
  ];
  // Tall narrow tower windows (drying slots).
  for (const ty of [3.0, 5.0, 7.0]) s.push(box(0.9, 1.1, 0.14, -6.5, ty, 0.56, C.glassWarm));

  // Two big red PANELLED roll-up doors (framed, embossed panels + segment lines).
  for (const dx of [-3, 3]) {
    s.push(box(4.8, 4.2, 0.25, dx, 2.1, 4.02, BRICK_D)); // brick reveal / frame
    s.push(box(4.4, 3.8, 0.22, dx, 2.05, 4.12, DOOR));   // door leaf
    for (let r = 0; r < 4; r++) {
      s.push(box(4.2, 0.9, 0.06, dx, 0.55 + r * 0.95, 4.2, DOOR_D)); // embossed panel rows
      s.push(box(4.4, 0.07, 0.24, dx, 0.98 + r * 0.95, 4.16, BRICK_D)); // segment seams
    }
    s.push(box(4.4, 0.2, 0.28, dx, 3.95, 4.16, C.metalDark)); // top roller box
  }

  // A fire truck rolling out of the right bay.
  const tx = 3;
  s.push(box(2.6, 2.0, 6, tx, 1.1, 7.0, C.red));
  s.push(box(2.6, 1.6, 2.0, tx, 1.9, 9.5, C.red));
  s.push(box(2.2, 0.8, 1.6, tx, 2.1, 10.4, C.glassWarm));
  s.push(box(2.65, 0.4, 6, tx, 1.9, 7.0, WHITE));
  s.push(box(0.4, 0.3, 5, tx, 3.0, 6.0, C.steel, [0.06, 0, 0]));  // ladder
  s.push(box(1.6, 0.35, 0.6, tx, 2.9, 10.4, C.red));             // light bar
  for (const wz of [4.9, 9.1]) {
    for (const wx of [1.1, -1.1]) s.push(cyl(0.42, 0.42, 0.3, 10, tx + wx, 0.42, wz, C.black, [0, 0, Math.PI / 2]));
  }

  const glow = merge([
    box(13, 1.0, 0.12, 0, 5.15, 4.22, C.glassWarm),   // lit fascia
    box(0.9, 1.0, 0.1, -6.5, 3.0, 0.63, C.glassWarm), // tower windows
    box(0.9, 1.0, 0.1, -6.5, 5.0, 0.63, C.glassWarm),
    box(0.9, 1.0, 0.1, -6.5, 7.0, 0.63, C.glassWarm),
    box(1.6, 0.32, 0.5, tx, 2.9, 10.4, C.red),        // lit truck light bar
  ]);

  return {
    structure: merge(s),
    facade, facadeTex,
    glow,
    sign: { x: 3, y: 5.15, z: 4.24, w: 6.5, h: 0.95 },
    collider: { cx: -0.5, cz: 0, w: 15.5, d: 8.4 },
  };
}
