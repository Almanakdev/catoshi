import { box, cyl, merge, C } from './common.js';

// Minimarket — a wide, low convenience store: a big glazed storefront under a
// bright branded fascia band, a produce stand, and a row of shopping carts.
export function buildMinimarket() {
  const s = [
    box(12, 3.6, 6, 0, 1.8, 0, C.cream),          // walls
    box(12.6, 0.6, 6.6, 0, 3.9, 0, C.concreteDark), // flat roof
    box(12, 1.3, 0.4, 0, 3.35, 3.0, C.orange),    // branded fascia band
    box(8.5, 2.4, 0.16, -1, 1.7, 3.05, C.glass),  // big storefront glass
    box(2.2, 2.6, 0.22, 4, 1.3, 3.05, C.metalDark), // entrance
  ];
  // Produce stand under an awning.
  s.push(box(3, 0.9, 1.4, -4, 0.45, 4.3, C.wood));
  for (const [px, col] of [[-4.8, C.red], [-4, C.orange], [-3.2, C.green]]) {
    s.push(box(0.8, 0.4, 1.2, px, 1.1, 4.3, col)); // produce crates
  }
  s.push(box(3.4, 0.12, 1.6, -4, 1.7, 4.3, C.orange, [-0.3, 0, 0])); // stand awning
  // A nested row of shopping carts.
  for (let i = 0; i < 4; i++) {
    const x = 3.4 + i * 0.35;
    const z = 4.8;
    s.push(box(0.7, 0.7, 0.9, x, 0.75, z, C.steel));
    s.push(cyl(0.12, 0.12, 0.1, 8, x - 0.25, 0.15, z + 0.3, C.black, [Math.PI / 2, 0, 0]));
    s.push(cyl(0.12, 0.12, 0.1, 8, x + 0.25, 0.15, z + 0.3, C.black, [Math.PI / 2, 0, 0]));
  }
  const glow = merge([
    box(8.3, 2.0, 0.14, -1, 1.75, 3.06, C.glassWarm),
    box(12, 1.1, 0.12, 0, 3.35, 3.22, C.yellow), // lit fascia
  ]);
  return {
    structure: merge(s),
    glow,
    sign: { x: 0, y: 3.35, z: 3.24, w: 6, h: 1.0 },
    collider: { cx: 0, cz: 0, w: 12.2, d: 6.2 },
  };
}
