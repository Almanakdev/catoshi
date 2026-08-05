import { box, merge, C } from './common.js';

// Arcade — a dark facade plastered with colourful neon signs and rows of
// glowing game-cabinet windows. The neon layer is unlit vertex-color, so it
// stays vivid day and night (and blooms).
export function buildArcade() {
  const s = [
    box(11, 5.5, 7, 0, 2.75, 0, '#1c1830'),        // dark walls
    box(11.4, 0.6, 7.4, 0, 5.8, 0, '#12101f'),     // roof cap
    box(2.4, 3, 0.2, 0, 1.5, 3.55, '#0e0c18'),     // dark entrance
    box(11, 1.3, 0.4, 0, 5.0, 3.55, '#0e0c18'),    // sign fascia backing
  ];
  const neonC = ['#ff4da6', '#3ad1ff', '#ffd23f', '#8f5cff', '#4dff88', '#ff6a3d'];
  const neon = [];
  // Neon tube border around the facade.
  neon.push(box(11, 0.22, 0.14, 0, 5.55, 3.62, neonC[0]));
  neon.push(box(11, 0.22, 0.14, 0, 0.35, 3.62, neonC[1]));
  neon.push(box(0.22, 5.4, 0.14, -5.4, 2.75, 3.62, neonC[2]));
  neon.push(box(0.22, 5.4, 0.14, 5.4, 2.75, 3.62, neonC[3]));
  // A big neon sign band + a couple of neon accent shapes.
  neon.push(box(8, 1.0, 0.12, 0, 5.0, 3.63, neonC[4]));
  neon.push(box(0.18, 2.2, 0.12, -3.6, 2.7, 3.63, neonC[0]));
  neon.push(box(0.18, 2.2, 0.12, 3.6, 2.7, 3.63, neonC[2]));
  // Rows of glowing game-cabinet windows (colourful screens).
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 5; c++) {
      const x = -3.8 + c * 1.9;
      const y = 1.5 + r * 1.5;
      s.push(box(1.5, 1.2, 0.14, x, y, 3.5, '#0a0812')); // cabinet frame
      neon.push(box(1.1, 0.85, 0.12, x, y + 0.05, 3.57, neonC[(r * 5 + c) % neonC.length]));
    }
  }
  return {
    structure: merge(s),
    neon: merge(neon),
    sign: { x: 0, y: 5.0, z: 3.66, w: 5.5, h: 0.95 },
    collider: { cx: 0, cz: 0, w: 11.2, d: 7.2 },
  };
}
