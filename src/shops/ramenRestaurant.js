import { box, cyl, merge, C } from './common.js';
import { makeRamenSign } from '../textures.js';

// Cozy low-poly Japanese ramen shop (in the spirit of Jesse Zhou's "Jesse's
// Ramen"): a little standalone wooden street eatery with an open counter you can
// see into, stools, a steaming pot, red paper lanterns, a noren over the front,
// a vertical glowing ラーメン sign, a small awning, and charming clutter. Faces +Z
// (the street). Stylized + cohesive with the city's soft Ghibli palette.
//
// The steam column and the warm night-time interior glow are wired up by the
// shop instancer (src/shops/index.js) from `steamAnchor` + the `glow` geometry.
export function buildRamenRestaurant() {
  const WOOD = C.wood, WOODD = C.woodDark, RED = '#c0392b', REDD = '#8f2f2f', DARK = '#2f2118';

  const s = [
    // ---- Wooden shell, open at the front ----
    box(9, 0.3, 6.4, 0, 0.15, -0.2, WOODD),               // floor slab
    box(8.6, 4.0, 0.3, 0, 2.2, -3.1, WOOD),               // back wall
    box(0.3, 4.0, 6.2, -4.15, 2.2, -0.1, WOOD),           // left wall
    box(0.3, 4.0, 6.2, 4.15, 2.2, -0.1, WOOD),            // right wall
    box(9.5, 0.5, 6.9, 0, 4.4, -0.1, REDD),               // roof
    box(9.5, 0.4, 0.5, 0, 3.95, 3.0, WOODD),              // front header beam
    box(0.35, 4.2, 0.4, -4.15, 2.1, 3.0, WOODD),          // front corner posts
    box(0.35, 4.2, 0.4, 4.15, 2.1, 3.0, WOODD),
    // ---- Counter (street side) + cook bench behind ----
    box(7.6, 1.15, 1.1, 0, 0.58, 2.3, WOOD),
    box(7.9, 0.16, 1.3, 0, 1.22, 2.3, '#6b4a2f'),
    box(7.6, 0.9, 0.9, 0, 0.5, -2.35, WOODD),
    box(7.2, 0.14, 0.5, 0, 2.7, -2.85, WOODD),            // back shelf
    // ---- Steaming pot (steam anchor) + kettle + ladle ----
    cyl(0.7, 0.62, 0.85, 12, -1.6, 1.35, -1.55, C.metalDark),
    cyl(0.74, 0.74, 0.12, 12, -1.6, 1.82, -1.55, C.steel),
    box(0.06, 0.06, 0.7, -1.6, 2.0, -1.15, WOODD, [0.5, 0, 0]), // ladle handle
    cyl(0.3, 0.34, 0.42, 10, 1.5, 1.1, -2.25, C.metalDark),     // kettle
  ];

  // Stools out front.
  for (const sx of [-2.7, -0.9, 0.9, 2.7]) {
    s.push(cyl(0.32, 0.32, 0.12, 10, sx, 0.62, 3.4, WOODD));
    s.push(cyl(0.06, 0.06, 0.55, 6, sx, 0.3, 3.4, C.metalDark));
  }
  // Bowls on the counter + coloured bottles on the back shelf.
  for (const [bx, bz] of [[-2.6, 2.3], [2.4, 2.4], [0.6, 2.2]]) {
    s.push(cyl(0.26, 0.19, 0.16, 10, bx, 1.4, bz, C.cream));
    s.push(cyl(0.2, 0.14, 0.03, 10, bx, 1.5, bz, REDD));
  }
  const bottleCols = ['#3a6ea5', '#5aa85f', '#c0392b', '#e0b13a'];
  for (let i = 0; i < 5; i++) s.push(cyl(0.1, 0.12, 0.5, 6, -2.4 + i * 1.1, 3.0, -2.85, bottleCols[i % 4]));
  // Noren rod + hanging cloth panels over the front.
  s.push(box(8.4, 0.1, 0.12, 0, 3.5, 3.05, WOODD));
  for (const nx of [-3, -1.5, 0, 1.5, 3]) s.push(box(1.35, 1.35, 0.05, nx, 2.85, 3.06, REDD));
  // Small slanted awning + valance.
  s.push(box(9.2, 0.26, 1.5, 0, 4.02, 3.25, RED, [-0.26, 0, 0]));
  s.push(box(9.2, 0.4, 0.12, 0, 3.72, 3.95, REDD));
  // Vertical sign board backing (right front, projecting toward the street).
  s.push(box(1.5, 4.3, 0.4, 4.35, 2.5, 3.1, WOODD));
  // Lantern strings + caps.
  for (const lx of [-2.8, 0, 2.8]) {
    s.push(box(0.04, 0.5, 0.04, lx, 3.5, 3.55, C.black));
    s.push(cyl(0.16, 0.16, 0.07, 8, lx, 3.16, 3.55, C.black));
    s.push(cyl(0.11, 0.11, 0.06, 8, lx, 2.5, 3.55, C.black));
  }
  // Menu board (left front) with faint chalk lines.
  s.push(box(1.5, 1.1, 0.08, -3.5, 2.7, 3.12, DARK));
  for (const my of [3.02, 2.72, 2.42]) s.push(box(1.05, 0.06, 0.02, -3.5, my, 3.17, C.cream));

  // Warm interior glow — subtle by day, glowing cosy-warm at night (ramped).
  const glow = merge([
    box(7.4, 2.4, 0.1, 0, 2.1, -2.95, C.glassWarm),      // lit back wall
    box(7.6, 0.12, 1.2, 0, 2.5, -2.35, C.glassWarm),     // interior worklight over the bench
    box(8.6, 0.12, 1.3, 0, 3.86, 3.2, C.glassWarm),      // lit awning underside
    box(1.05, 0.9, 0.02, -3.5, 2.7, 3.17, C.glassWarm),  // backlit menu board
  ]);

  // Red paper lanterns (akachōchin) — glow warm-red, haloed by bloom at night.
  const neon = merge([
    cyl(0.27, 0.27, 0.55, 10, -2.8, 2.82, 3.55, '#e8492b'),
    cyl(0.27, 0.27, 0.55, 10, 0, 2.82, 3.55, '#e8492b'),
    cyl(0.27, 0.27, 0.55, 10, 2.8, 2.82, 3.55, '#e8492b'),
  ]);

  return {
    structure: merge(s),
    glow,
    neon,
    sign: { x: 4.35, y: 2.7, z: 3.32, w: 1.15, h: 3.5 }, // vertical
    signTex: makeRamenSign(),
    steamAnchor: { x: -1.6, y: 2.1, z: -1.55 },          // above the pot
    collider: { cx: 0, cz: 0.1, w: 9.0, d: 7.0 },
  };
}
