import * as THREE from 'three';
import { paint, box, cyl, blob, merge, C } from '../engine/prim.js';

// ---------------------------------------------------------------------------
// CATUSHI — street prop library.
//
// Every prop is a tiny merged prefab that follows the SAME contract as the shop
// builders: a builder takes no required arguments and returns
//
//   { structure, glow?, neon?, collider? }
//
// …with all geometry authored in LOCAL space, facing +Z (the street side), the
// origin on the ground at the prop's centre. `collider` is {cx,cz,w,d,h} in the
// same local space — omit it for props the player can walk through (banners,
// decals, hanging lanterns, birds).
//
// Art direction: Japanese-inspired CLEAN CARTOON. Soft rounded shapes, chunky
// readable silhouettes, flat baked vertex colours, warm controlled palette. The
// player cat is ~1.05 units at the shoulder, so almost everything here is
// waist-to-shoulder height — small and chunky, never tall and thin.
// ---------------------------------------------------------------------------

// A few extra hues on top of the shared engine palette, tuned for the
// Japanese-cartoon look (vermillion shrine red, warm paper, kawara roof slate).
const P = {
  vermillion: '#d64b3a',
  vermillionD: '#a3372c',
  lantern: '#e8492b',
  lanternLit: '#ffb35c',
  paper: '#f6e7c8',
  paperWarm: '#ffe9bc',
  ink: '#2f2a26',
  charcoal: '#3a3630',
  tile: '#5a6672',       // kawara roof slate
  tileD: '#414c56',
  stone: '#cac4b5',
  stoneD: '#a49d8d',
  rope: '#d9c79a',
  sage: '#8fae7a',
  moss: '#6f8f5c',
  blossom: '#f6c3d8',
  blossomD: '#eaa8c4',
  pine: '#4e7f52',
  pineD: '#3d6642',
  water: '#7fb7c4',
  ice: '#d6ecf2',
  fish: '#b9c8d2',
  fishBelly: '#eef2f4',
  timber: '#8a5a34',
  timberD: '#5b4a3a',
};

// ---------------------------------------------------------------------------
// Local geometry helpers
// ---------------------------------------------------------------------------

/** A zero-thickness ground decal (road markings, covers, grates). */
function decal(w, d, x, z, color, y = 0.02) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  return paint(g, color);
}

/** A flat disc decal lying on the ground. */
function disc(r, x, z, color, y = 0.02, seg = 16) {
  const g = new THREE.CircleGeometry(r, seg);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  return paint(g, color);
}

/** A sagging cord in the XY plane (hangs along X, droops in Y). */
function cordX(x0, y0, x1, y1, z, color, sag = 0.35, segs = 5, t = 0.035) {
  const out = [];
  const pt = (u) => [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u - Math.sin(Math.PI * u) * sag];
  for (let i = 0; i < segs; i++) {
    const [ax, ay] = pt(i / segs);
    const [bx, by] = pt((i + 1) / segs);
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    out.push(box(len, t, t, (ax + bx) / 2, (ay + by) / 2, z, color, [0, 0, Math.atan2(dy, dx)]));
  }
  return out;
}

/** A sagging rope in the ZY plane (runs along Z, droops in Y). */
function cordZ(z0, y0, z1, y1, x, color, sag = 0.4, segs = 5, t = 0.06) {
  const out = [];
  const pt = (u) => [z0 + (z1 - z0) * u, y0 + (y1 - y0) * u - Math.sin(Math.PI * u) * sag];
  for (let i = 0; i < segs; i++) {
    const [az, ay] = pt(i / segs);
    const [bz, by] = pt((i + 1) / segs);
    const dz = bz - az, dy = by - ay;
    const len = Math.hypot(dz, dy);
    // rotateX(+θ) tips the +Z end downward — exactly what a drooping rope does.
    out.push(box(t, t, len, x, (ay + by) / 2, (az + bz) / 2, color, [-Math.atan2(dy, dz), 0, 0]));
  }
  return out;
}

/** A slatted wooden crate shell (4 walls of 2 slats + a floor). */
function crateShell(w, h, d, x, y, z, col, colD) {
  const t = 0.06;
  const s = [
    box(w, t, d, x, y - h / 2 + t / 2, z, colD),            // floor
    box(w, h, t, x, y, z + d / 2, col),                     // front
    box(w, h, t, x, y, z - d / 2, col),                     // back
    box(t, h, d, x - w / 2, y, z, col),                     // left
    box(t, h, d, x + w / 2, y, z, col),                     // right
  ];
  // Corner posts read as carpentry, not a plain box.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    s.push(box(0.09, h + 0.06, 0.09, x + sx * (w / 2 - 0.03), y, z + sz * (d / 2 - 0.03), colD));
  }
  // A single light slat gap band across the front/back.
  s.push(box(w * 0.96, 0.05, 0.02, x, y, z + d / 2 + 0.02, colD));
  s.push(box(w * 0.96, 0.05, 0.02, x, y, z - d / 2 - 0.02, colD));
  return s;
}

/** A shoji-style paper panel: warm paper with a fine timber grid. */
function shoji(w, h, x, y, z, { frame = P.timberD, panelColor = P.paper, cols = 3, rows = 3, t = 0.05 } = {}) {
  const s = [
    box(w, h, t, x, y, z, panelColor),
    box(w, 0.08, t + 0.03, x, y + h / 2 - 0.04, z, frame),
    box(w, 0.08, t + 0.03, x, y - h / 2 + 0.04, z, frame),
    box(0.08, h, t + 0.03, x - w / 2 + 0.04, y, z, frame),
    box(0.08, h, t + 0.03, x + w / 2 - 0.04, y, z, frame),
  ];
  for (let i = 1; i < cols; i++) s.push(box(0.04, h - 0.1, t + 0.02, x - w / 2 + (w / cols) * i, y, z, frame));
  for (let i = 1; i < rows; i++) s.push(box(w - 0.1, 0.04, t + 0.02, x, y - h / 2 + (h / rows) * i, z, frame));
  return s;
}

// ===========================================================================
// LANTERNS, FABRIC & SIGNAGE
// ===========================================================================

/**
 * A single chōchin paper lantern on a short cord. The paper body lives in the
 * `glow` channel so the day/night ramp lights it after dusk.
 */
export function propPaperLantern(opts = {}) {
  const { r = 0.26, h = 0.52, color = P.lantern, cord = 0.5, y = 1.9, cap = C.black } = opts;
  const cy = y;
  const structure = merge([
    box(0.035, cord, 0.035, 0, cy + h / 2 + cord / 2, 0, cap),      // hanging cord
    cyl(r * 0.55, r * 0.55, 0.07, 10, 0, cy + h / 2, 0, cap),       // top cap
    cyl(r * 0.55, r * 0.55, 0.06, 10, 0, cy - h / 2, 0, cap),       // bottom cap
    cyl(r * 1.02, r * 1.02, 0.03, 10, 0, cy, 0, P.vermillionD),     // painted mid band
    box(0.05, 0.16, 0.05, 0, cy - h / 2 - 0.1, 0, cap),             // little tassel
  ]);
  const glow = merge([
    cyl(r, r * 0.9, h * 0.46, 10, 0, cy + h * 0.24, 0, color),      // upper paper barrel
    cyl(r * 0.9, r, h * 0.46, 10, 0, cy - h * 0.24, 0, color),      // lower paper barrel
  ]);
  return { structure, glow };
}

/** A hanging row of lanterns strung between two points (festival street kit). */
export function propLanternString(opts = {}) {
  const { count = 5, span = 6, y = 3.1, sag = 0.45, color = P.lantern, poles = true } = opts;
  const s = [];
  const g = [];
  s.push(...cordX(-span / 2, y, span / 2, y, 0, C.black, sag, 8));
  if (poles) {
    for (const sx of [-span / 2, span / 2]) {
      s.push(cyl(0.07, 0.09, y + 0.2, 8, sx, (y + 0.2) / 2, 0, P.timberD));
      s.push(box(0.34, 0.09, 0.09, sx + (sx < 0 ? 0.14 : -0.14), y + 0.16, 0, P.timberD));
    }
  }
  for (let i = 0; i < count; i++) {
    const u = (i + 0.5) / count;
    const lx = -span / 2 + span * u;
    const ly = y - Math.sin(Math.PI * u) * sag - 0.34;
    s.push(box(0.03, 0.2, 0.03, lx, ly + 0.32, 0, C.black));
    s.push(cyl(0.11, 0.11, 0.05, 8, lx, ly + 0.21, 0, C.black));
    s.push(cyl(0.11, 0.11, 0.05, 8, lx, ly - 0.21, 0, C.black));
    g.push(cyl(0.2, 0.2, 0.38, 10, lx, ly, 0, i % 2 ? color : '#f0742f'));
  }
  return { structure: merge(s), glow: merge(g) };
}

/** A noren — the split fabric curtain hung across a shop doorway. */
export function propNoren(opts = {}) {
  const { w = 2.4, h = 1.0, y = 2.3, panels = 3, color = P.vermillion, band = C.cream, mark = true } = opts;
  const s = [cyl(0.045, 0.045, w + 0.3, 8, 0, y + h / 2 + 0.06, 0, P.timberD, [0, 0, Math.PI / 2])];
  const pw = (w / panels) * 0.93;
  for (let i = 0; i < panels; i++) {
    const px = -w / 2 + (w / panels) * (i + 0.5);
    s.push(box(pw, h, 0.045, px, y, 0, color));
    s.push(box(pw, 0.12, 0.05, px, y + h / 2 - 0.06, 0.005, band));   // top hem band
  }
  if (mark) {
    // The house mark: a cream disc with a simple bar, painted across the middle.
    s.push(cyl(h * 0.26, h * 0.26, 0.02, 12, 0, y + 0.04, 0.035, band, [Math.PI / 2, 0, 0]));
    s.push(box(h * 0.3, 0.08, 0.02, 0, y + 0.04, 0.05, color));
  }
  return { structure: merge(s) };
}

/** A nobori — the tall narrow banner on an L-shaped pole. */
export function propNobori(opts = {}) {
  const { h = 3.1, w = 0.5, color = P.vermillion, band = C.cream } = opts;
  const s = [
    cyl(0.05, 0.06, h, 8, 0, h / 2, 0, P.timberD),                        // pole
    box(w + 0.16, 0.06, 0.06, w / 2 + 0.02, h - 0.06, 0, P.timberD),      // top arm
    cyl(0.12, 0.16, 0.14, 8, 0, 0.07, 0, C.metalDark),                    // weighted foot
    box(0.5, 0.08, 0.5, 0, 0.04, 0, C.metalDark),
    box(w, h * 0.62, 0.04, w / 2 + 0.06, h - h * 0.31 - 0.1, 0, color),   // cloth
  ];
  // Cloth trim: top + bottom bands and two painted glyph blocks.
  s.push(box(w, 0.1, 0.05, w / 2 + 0.06, h - 0.16, 0.005, band));
  s.push(box(w, 0.1, 0.05, w / 2 + 0.06, h - h * 0.62, 0.005, band));
  for (let i = 0; i < 3; i++) {
    s.push(box(w * 0.42, w * 0.34, 0.02, w / 2 + 0.06, h - 0.5 - i * (h * 0.16), 0.035, band));
  }
  return { structure: merge(s) };
}

/** An open-fronted market stall: posts, counter, striped awning, crates. */
export function propWoodenStall(opts = {}) {
  const { w = 3.4, d = 2.0, awningColor = P.vermillion, goods = C.orange } = opts;
  const hw = w / 2, hd = d / 2, top = 2.35;
  const s = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    s.push(box(0.13, top, 0.13, sx * (hw - 0.1), top / 2, sz * (hd - 0.1), P.timberD));
  }
  s.push(box(w, 0.12, 0.12, 0, top, hd - 0.1, P.timberD));         // front header
  s.push(box(w, 0.12, 0.12, 0, top, -hd + 0.1, P.timberD));        // back header
  s.push(box(0.12, 0.12, d, hw - 0.1, top, 0, P.timberD));
  s.push(box(0.12, 0.12, d, -hw + 0.1, top, 0, P.timberD));
  // Counter + apron
  s.push(box(w - 0.1, 0.14, d * 0.62, 0, 1.02, hd * 0.28, C.wood));
  s.push(box(w - 0.24, 0.85, 0.1, 0, 0.52, hd * 0.28 + d * 0.31, P.timberD));
  // Back shelf
  s.push(box(w - 0.4, 0.1, 0.34, 0, 1.62, -hd + 0.28, C.wood));
  // Striped awning, sloping toward the street.
  const ang = -0.26, aD = 1.5;
  const stripes = 6, sw = w / stripes;
  for (let i = 0; i < stripes; i++) {
    const col = i % 2 ? C.cream : awningColor;
    s.push(box(sw + 0.01, 0.1, aD, -w / 2 + sw * (i + 0.5), top + 0.36, hd + 0.5, col, [ang, 0, 0]));
  }
  s.push(box(w + 0.2, 0.3, 0.1, 0, top + 0.16, hd + 1.16, awningColor));  // valance
  // Goods on the counter — three chunky produce piles.
  for (const gx of [-hw * 0.55, 0, hw * 0.55]) {
    s.push(box(0.62, 0.3, 0.5, gx, 1.24, hd * 0.28, C.wood));
    s.push(blob(0.2, gx - 0.12, 1.5, hd * 0.28, goods));
    s.push(blob(0.17, gx + 0.14, 1.46, hd * 0.28 + 0.08, goods));
    s.push(blob(0.15, gx, 1.52, hd * 0.28 - 0.12, C.green));
  }
  // Stacked crates at one end.
  s.push(...crateShell(0.68, 0.42, 0.5, -hw + 0.45, 0.21, -hd + 0.45, C.wood, P.timberD));
  s.push(...crateShell(0.68, 0.42, 0.5, -hw + 0.45, 0.64, -hd + 0.45, C.wood, P.timberD));
  // Small hand-lettered price board.
  s.push(box(0.7, 0.46, 0.05, hw - 0.5, 1.62, hd * 0.28 + 0.32, P.charcoal));
  for (const my of [1.72, 1.58]) s.push(box(0.48, 0.05, 0.02, hw - 0.5, my, hd * 0.28 + 0.36, C.cream));
  return { structure: merge(s), collider: { cx: 0, cz: 0, w: w + 0.2, d: d + 0.2, h: 2.5 } };
}

// ===========================================================================
// CRATES, BARRELS & CONTAINERS
// ===========================================================================

/** A slatted crate of fruit / veg. */
export function propFruitCrate(opts = {}) {
  const { w = 0.8, h = 0.44, d = 0.6, fruit = C.orange, leaf = C.green } = opts;
  const s = crateShell(w, h, d, 0, h / 2, 0, C.wood, P.timberD);
  const rows = [[-0.2, -0.12], [0.02, 0.1], [0.22, -0.08], [-0.06, 0.14]];
  for (const [fx, fz] of rows) {
    s.push(blob(0.14, fx, h + 0.05, fz, fruit));
    s.push(blob(0.07, fx + 0.09, h + 0.12, fz + 0.05, leaf));
  }
  return { structure: merge(s), collider: { cx: 0, cz: 0, w, d, h } };
}

/** A crate of iced fish for the harbour. */
export function propFishCrate(opts = {}) {
  const { w = 0.9, h = 0.4, d = 0.66 } = opts;
  const s = crateShell(w, h, d, 0, h / 2, 0, '#c8ccc4', '#9aa199');
  s.push(box(w - 0.1, 0.12, d - 0.1, 0, h - 0.02, 0, P.ice));   // crushed ice bed
  for (const [fx, fz, rot] of [[-0.24, -0.1, 0.2], [0.0, 0.08, -0.35], [0.26, -0.06, 0.5]]) {
    s.push(cyl(0.05, 0.11, 0.44, 8, fx, h + 0.09, fz, P.fish, [Math.PI / 2, rot, 0]));
    s.push(cyl(0.04, 0.07, 0.2, 8, fx, h + 0.05, fz, P.fishBelly, [Math.PI / 2, rot, 0]));
    s.push(box(0.13, 0.1, 0.02, fx - Math.sin(rot) * 0.24, h + 0.11, fz - Math.cos(rot) * 0.24, P.fish, [0, rot, 0]));
  }
  return { structure: merge(s), collider: { cx: 0, cz: 0, w, d, h } };
}

/** A wooden barrel with metal hoops. */
export function propBarrel(opts = {}) {
  const { r = 0.34, h = 0.8, color = C.wood, hoop = C.metalDark } = opts;
  const s = [
    cyl(r * 0.9, r * 0.9, h * 0.3, 12, 0, h * 0.15, 0, color),
    cyl(r, r * 0.9, h * 0.4, 12, 0, h * 0.5, 0, color),
    cyl(r * 0.9, r, h * 0.3, 12, 0, h * 0.85, 0, color),
    cyl(r * 0.94, r * 0.94, 0.07, 12, 0, h * 0.28, 0, hoop),
    cyl(r * 0.94, r * 0.94, 0.07, 12, 0, h * 0.72, 0, hoop),
    cyl(r * 0.86, r * 0.86, 0.05, 12, 0, h + 0.01, 0, P.timberD),   // lid
  ];
  return { structure: merge(s), collider: { cx: 0, cz: 0, w: r * 2, d: r * 2, h } };
}

/** A stack of decorated sake barrels (kazaridaru) — a classic festival wall. */
export function propSakeBarrelStack(opts = {}) {
  const { cols = 3, rows = 2, r = 0.3, h = 0.62, face = C.cream, band = P.vermillion } = opts;
  const s = [];
  for (let ry = 0; ry < rows; ry++) {
    for (let cx = 0; cx < cols; cx++) {
      const x = (cx - (cols - 1) / 2) * (r * 2 + 0.06);
      const y = h / 2 + ry * (h + 0.04);
      // Barrels lie on their side facing the street: axis along Z.
      s.push(cyl(r, r, 0.62, 12, x, y, 0, P.rope, [Math.PI / 2, 0, 0]));
      s.push(cyl(r * 0.96, r * 0.96, 0.06, 12, x, y, 0.32, P.timberD, [Math.PI / 2, 0, 0]));
      s.push(cyl(r * 0.8, r * 0.8, 0.04, 12, x, y, 0.35, face, [Math.PI / 2, 0, 0]));   // painted face
      s.push(cyl(r * 0.44, r * 0.44, 0.03, 12, x, y, 0.37, band, [Math.PI / 2, 0, 0]));  // house mark
      s.push(box(r * 1.7, 0.07, 0.03, x, y, 0.385, face));
      s.push(cyl(r * 1.02, r * 1.02, 0.05, 12, x, y, -0.1, P.timberD, [Math.PI / 2, 0, 0])); // rope hoop
    }
  }
  const w = cols * (r * 2 + 0.06);
  return { structure: merge(s), collider: { cx: 0, cz: 0, w, d: 0.72, h: rows * (h + 0.04) } };
}

/** A drinks vending machine — the glowing front is its whole character. */
export function propVendingMachine(opts = {}) {
  const { w = 1.0, h = 1.9, d = 0.7, body = '#e2503f', trim = C.cream } = opts;
  const s = [
    box(w, h, d, 0, h / 2, 0, body),
    box(w + 0.06, 0.16, d + 0.06, 0, h - 0.08, 0, trim),          // top cap band
    box(w + 0.06, 0.12, d + 0.06, 0, 0.06, 0, C.metalDark),       // plinth
    box(w * 0.9, 0.26, 0.06, 0, 0.55, d / 2 + 0.02, C.metalDark), // collection flap
    box(w * 0.24, 0.5, 0.06, w * 0.32, 1.1, d / 2 + 0.02, C.metalDark), // coin column
    box(w * 0.16, 0.06, 0.04, w * 0.32, 1.28, d / 2 + 0.05, trim),
  ];
  const g = [box(w * 0.82, h * 0.52, 0.05, -w * 0.06, h * 0.66, d / 2 + 0.02, '#ffeec4')]; // lit display
  // Product rows drawn as little coloured cans across the lit window.
  const cans = ['#e0574f', '#4f9ad4', '#e8b93c', '#5aa85f'];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      s.push(box(0.1, 0.16, 0.04, -w * 0.36 + c * 0.19, h * 0.46 + r * 0.24, d / 2 + 0.05, cans[(r + c) % 4]));
    }
  }
  const neon = merge([box(w * 0.9, 0.14, 0.05, 0, h - 0.3, d / 2 + 0.03, '#ffd45a')]); // lit header strip
  return { structure: merge(s), glow: merge(g), neon, collider: { cx: 0, cz: 0, w, d, h } };
}

// ===========================================================================
// STREET FURNITURE
// ===========================================================================

/** A timber utility pole with crossbars, insulators and drooping wires. */
export function propUtilityPole(opts = {}) {
  const { h = 6.4, span = 7, wires = true } = opts;
  const s = [
    cyl(0.11, 0.16, h, 8, 0, h / 2, 0, C.wood),
    cyl(0.2, 0.22, 0.18, 10, 0, 0.09, 0, C.concreteDark),      // concrete collar
  ];
  const bars = [h - 0.5, h - 1.3];
  for (const by of bars) {
    s.push(box(1.7, 0.11, 0.11, 0, by, 0, P.timberD));
    s.push(box(0.09, 0.34, 0.09, 0, by - 0.2, 0, P.timberD, [0.55, 0, 0]));  // brace
    for (const ix of [-0.68, -0.24, 0.24, 0.68]) {
      s.push(cyl(0.055, 0.07, 0.13, 6, ix, by + 0.12, 0, C.glass));          // insulator
    }
  }
  if (wires) {
    // Two drooping runs per crossbar, offset in Z so they read as a bundle.
    for (const by of bars) {
      for (const wz of [-0.06, 0.06]) {
        for (const seg of cordX(-span / 2, by + 0.16, span / 2, by + 0.16, wz, C.black, 0.5, 5, 0.03)) s.push(seg);
      }
    }
    // A transformer can and a service drop toward the shopfront.
    s.push(cyl(0.19, 0.19, 0.5, 10, 0.3, h - 2.1, 0, C.metalDark));
    s.push(...cordZ(0, h - 1.9, 2.4, 2.6, 0.3, C.black, 0.35, 4, 0.035));
  }
  return { structure: merge(s), collider: { cx: 0, cz: 0, w: 0.42, d: 0.42, h } };
}

/** A cozy street lamp with a warm shaded head. */
export function propStreetLamp(opts = {}) {
  const { h = 3.5, post = C.metalDark, shade = P.vermillionD } = opts;
  const s = [
    cyl(0.19, 0.26, 0.24, 10, 0, 0.12, 0, post),
    cyl(0.08, 0.11, h, 8, 0, h / 2, 0, post),
    box(0.6, 0.09, 0.09, 0.28, h - 0.06, 0, post),        // arm
    box(0.09, 0.3, 0.09, 0.08, h - 0.2, 0, post, [0, 0, -0.7]),
    cyl(0.3, 0.09, 0.3, 10, 0.56, h - 0.2, 0, shade),     // conical shade
    cyl(0.06, 0.06, 0.1, 8, 0.56, h + 0.0, 0, post),
    box(0.22, 0.3, 0.03, 0, h - 0.9, 0.06, C.cream),      // small street plate
  ];
  const glow = merge([
    cyl(0.19, 0.19, 0.14, 10, 0.56, h - 0.38, 0, P.paperWarm),
    cyl(0.24, 0.03, 0.02, 10, 0.56, h - 0.45, 0, P.lanternLit),
  ]);
  return { structure: merge(s), glow, collider: { cx: 0, cz: 0, w: 0.4, d: 0.4, h } };
}

/** A little traffic cone. */
export function propTrafficCone(opts = {}) {
  const { h = 0.6, color = '#e8703a' } = opts;
  const s = [
    box(0.42, 0.05, 0.42, 0, 0.025, 0, P.charcoal),
    cyl(0.05, 0.19, h, 10, 0, h / 2 + 0.03, 0, color),
    cyl(0.14, 0.16, 0.09, 10, 0, h * 0.55, 0, C.cream),
  ];
  return { structure: merge(s) };
}

/** A slatted timber bench with a low back. */
export function propBenchWood(opts = {}) {
  const { w = 1.8, seat = C.wood, frame = P.timberD } = opts;
  const s = [];
  for (const sz of [-0.16, 0.0, 0.16]) s.push(box(w, 0.07, 0.13, 0, 0.46, sz, seat));
  for (const by of [0.72, 0.88]) s.push(box(w, 0.12, 0.06, 0, by, -0.24, seat));
  for (const sx of [-w / 2 + 0.16, w / 2 - 0.16]) {
    s.push(box(0.09, 0.46, 0.09, sx, 0.23, 0.16, frame));
    s.push(box(0.09, 0.46, 0.09, sx, 0.23, -0.2, frame));
    s.push(box(0.09, 0.5, 0.09, sx, 0.7, -0.24, frame));
    s.push(box(0.09, 0.07, 0.5, sx, 0.44, -0.02, frame));
  }
  return { structure: merge(s), collider: { cx: 0, cz: -0.04, w, d: 0.56, h: 0.95 } };
}

/** A timber planter box with a soil bed and shrubs. */
export function propPlanterBox(opts = {}) {
  const { w = 1.6, d = 0.6, h = 0.5, leaf = P.sage } = opts;
  const s = crateShell(w, h, d, 0, h / 2, 0, C.wood, P.timberD);
  s.push(box(w - 0.12, 0.08, d - 0.12, 0, h - 0.06, 0, '#5b4632'));   // soil
  s.push(box(w + 0.08, 0.07, d + 0.08, 0, h + 0.01, 0, P.timberD));   // capping rail
  for (const bx of [-w * 0.28, 0, w * 0.28]) {
    s.push(blob(0.22, bx, h + 0.14, 0, leaf));
    s.push(blob(0.14, bx + 0.13, h + 0.24, 0.06, C.leaf));
  }
  s.push(blob(0.08, -w * 0.28 + 0.1, h + 0.3, -0.08, P.blossom));
  return { structure: merge(s), collider: { cx: 0, cz: 0, w, d, h } };
}

/** A terracotta pot with a leafy plant. */
export function propPottedPlant(opts = {}) {
  const { r = 0.26, leaf = C.green } = opts;
  const s = [
    cyl(r, r * 0.74, 0.36, 10, 0, 0.18, 0, C.terracotta),
    cyl(r * 1.08, r * 1.08, 0.07, 10, 0, 0.36, 0, '#b04f3c'),
    box(r * 1.4, 0.04, r * 1.4, 0, 0.005, 0, '#a04838'),
    blob(0.24, 0, 0.58, 0, leaf),
    blob(0.17, 0.16, 0.72, 0.06, C.leaf),
    blob(0.14, -0.14, 0.68, -0.07, C.greenDark),
  ];
  return { structure: merge(s), collider: { cx: 0, cz: 0, w: r * 2.2, d: r * 2.2, h: 0.5 } };
}

/** A bonsai in a shallow tray — the classic three-pad silhouette. */
export function propBonsai(opts = {}) {
  const { tray = '#6a5240', leaf = P.pine } = opts;
  const s = [
    box(0.62, 0.14, 0.42, 0, 0.07, 0, tray),
    box(0.68, 0.05, 0.48, 0, 0.16, 0, '#7b6250'),
    box(0.5, 0.05, 0.32, 0, 0.19, 0, '#5b4632'),
    cyl(0.05, 0.08, 0.34, 6, -0.06, 0.36, 0, C.wood),
    cyl(0.04, 0.05, 0.24, 6, 0.06, 0.55, 0.02, C.wood, [0, 0, -0.7]),
    cyl(0.035, 0.04, 0.2, 6, -0.16, 0.5, -0.02, C.wood, [0, 0, 0.8]),
    cyl(0.2, 0.2, 0.08, 8, 0.18, 0.66, 0.03, leaf),      // right pad
    cyl(0.17, 0.17, 0.08, 8, -0.22, 0.6, -0.03, leaf),   // left pad
    cyl(0.15, 0.15, 0.08, 8, -0.02, 0.8, 0, P.pineD),    // crown pad
  ];
  return { structure: merge(s), collider: { cx: 0, cz: 0, w: 0.7, d: 0.5, h: 0.9 } };
}

/** A chunky city bicycle, leaning slightly, with a front basket. */
export function propBicycle(opts = {}) {
  const { frame = '#4f7fa8', tyre = C.black } = opts;
  const wr = 0.3, wz = 0.62;
  const s = [];
  for (const z of [wz, -wz]) {
    s.push(cyl(wr, wr, 0.06, 14, 0, wr, z, tyre, [0, 0, Math.PI / 2]));
    s.push(cyl(wr * 0.72, wr * 0.72, 0.07, 14, 0, wr, z, C.steel, [0, 0, Math.PI / 2]));
    s.push(cyl(0.06, 0.06, 0.1, 8, 0, wr, z, C.metalDark, [0, 0, Math.PI / 2]));
  }
  s.push(box(0.07, 0.07, 1.0, 0, 0.62, -0.06, frame, [0.22, 0, 0]));    // top tube
  s.push(box(0.07, 0.07, 0.98, 0, 0.36, -0.02, frame, [-0.1, 0, 0]));   // down tube
  s.push(box(0.06, 0.5, 0.06, 0, 0.5, -wz + 0.06, frame, [-0.2, 0, 0]));// seat tube
  s.push(box(0.06, 0.62, 0.06, 0, 0.6, wz - 0.04, frame, [0.16, 0, 0]));// fork/head
  s.push(box(0.44, 0.05, 0.05, 0, 0.94, wz + 0.04, C.metalDark));       // handlebar
  s.push(box(0.24, 0.1, 0.34, 0, 0.72, wz + 0.14, C.steel));            // basket
  s.push(box(0.22, 0.02, 0.32, 0, 0.78, wz + 0.14, C.metalDark));
  s.push(box(0.16, 0.07, 0.3, 0, 0.78, -wz + 0.1, C.black));            // saddle
  s.push(cyl(0.09, 0.09, 0.04, 10, 0.06, 0.28, 0.04, C.metalDark, [0, 0, Math.PI / 2])); // chainring
  s.push(box(0.05, 0.05, 0.7, 0, 0.9, wz - 0.2, C.cream));              // mudguard-ish light
  return { structure: merge(s), collider: { cx: 0, cz: 0, w: 0.5, d: 1.7, h: 1.0 } };
}

/** A row of hoop bike racks. */
export function propBicycleRack(opts = {}) {
  const { loops = 3, gap = 0.7, color = C.metal } = opts;
  const s = [];
  const w = (loops - 1) * gap;
  s.push(box(w + 0.5, 0.07, 0.09, 0, 0.04, 0, C.metalDark));
  for (let i = 0; i < loops; i++) {
    const x = -w / 2 + i * gap;
    s.push(box(0.07, 0.62, 0.07, x - 0.16, 0.31, 0, color));
    s.push(box(0.07, 0.62, 0.07, x + 0.16, 0.31, 0, color));
    s.push(box(0.39, 0.07, 0.07, x, 0.6, 0, color));
    s.push(cyl(0.045, 0.045, 0.1, 8, x - 0.16, 0.62, 0, color));
    s.push(cyl(0.045, 0.045, 0.1, 8, x + 0.16, 0.62, 0, color));
  }
  return { structure: merge(s), collider: { cx: 0, cz: 0, w: w + 0.5, d: 0.3, h: 0.7 } };
}

/** A pair of sorted recycling bins with lids. */
export function propTrashBins(opts = {}) {
  const { colors = ['#4f8f6a', '#4f7fa8', '#c8a03a'], r = 0.27, h = 0.72 } = opts;
  const s = [];
  const n = colors.length;
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * (r * 2 + 0.1);
    s.push(cyl(r, r * 0.86, h, 12, x, h / 2, 0, colors[i]));
    s.push(cyl(r * 1.06, r * 1.06, 0.07, 12, x, h + 0.03, 0, C.metalDark));   // lid
    s.push(cyl(r * 0.4, r * 0.4, 0.05, 10, x, h + 0.08, 0, C.metalDark));
    s.push(box(r * 1.5, 0.2, 0.03, x, h * 0.62, r * 0.9, C.cream));           // label plate
    s.push(box(r * 2.1, 0.05, r * 2.1, x, 0.025, 0, C.metalDark));
  }
  const w = n * (r * 2 + 0.1);
  return { structure: merge(s), collider: { cx: 0, cz: 0, w, d: r * 2.2, h: h + 0.1 } };
}

/** A wall-mounted air-conditioning unit (defaults to first-floor height). */
export function propAcUnit(opts = {}) {
  const { y = 2.6, w = 0.8, h = 0.55, d = 0.34 } = opts;
  const s = [
    box(w, h, d, 0, y, 0, C.steel),
    box(w + 0.05, 0.07, d + 0.05, 0, y + h / 2, 0, C.metalDark),
    box(w + 0.05, 0.07, d + 0.05, 0, y - h / 2, 0, C.metalDark),
    cyl(h * 0.36, h * 0.36, 0.05, 12, 0, y, d / 2 + 0.02, C.metalDark, [Math.PI / 2, 0, 0]),
  ];
  for (let i = 0; i < 4; i++) s.push(box(w * 0.9, 0.03, 0.03, 0, y - h / 2 + 0.1 + i * 0.1, d / 2 + 0.03, C.metalDark));
  for (const bx of [-w / 2 + 0.06, w / 2 - 0.06]) {
    s.push(box(0.06, 0.1, d * 0.8, bx, y - h / 2 - 0.06, -0.02, C.metalDark));
  }
  return { structure: merge(s) };
}

// ===========================================================================
// SHRINE & CIVIC
// ===========================================================================

/** A small vermillion torii gate — walkable, so no collider. */
export function propTorii(opts = {}) {
  const { w = 2.6, h = 3.0, color = P.vermillion, top = P.vermillionD } = opts;
  const hw = w / 2;
  const s = [
    cyl(0.14, 0.17, h, 10, -hw, h / 2, 0, color),
    cyl(0.14, 0.17, h, 10, hw, h / 2, 0, color),
    cyl(0.24, 0.26, 0.14, 10, -hw, 0.07, 0, P.stoneD),           // stone shoes
    cyl(0.24, 0.26, 0.14, 10, hw, 0.07, 0, P.stoneD),
    box(w + 1.0, 0.2, 0.36, 0, h + 0.02, 0, top),                // kasagi (top lintel)
    box(w + 0.7, 0.14, 0.28, 0, h - 0.16, 0, top),               // shimaki
    box(w + 0.45, 0.16, 0.24, 0, h - 0.6, 0, color),             // nuki (second beam)
    box(0.22, 0.5, 0.2, 0, h - 0.36, 0, color),                  // gakuzuka
    box(0.34, 0.24, 0.05, 0, h - 0.36, 0.13, C.cream),           // small plaque
  ];
  // Gently upturned ends on the top lintel (a wedge each side).
  for (const sx of [-1, 1]) {
    s.push(box(0.55, 0.16, 0.34, sx * (w / 2 + 0.42), h + 0.1, 0, top, [0, 0, -sx * 0.16]));
  }
  return { structure: merge(s) };
}

/** A stone lantern (tōrō) with a lit fire box. */
export function propStoneLantern(opts = {}) {
  const { stone = P.stone, dark = P.stoneD } = opts;
  const s = [
    cyl(0.32, 0.38, 0.16, 8, 0, 0.08, 0, dark),          // base
    cyl(0.11, 0.13, 0.55, 8, 0, 0.44, 0, stone),         // shaft
    cyl(0.26, 0.2, 0.12, 8, 0, 0.78, 0, dark),           // mid platform
    cyl(0.24, 0.24, 0.34, 6, 0, 1.0, 0, stone),          // fire box
    cyl(0.44, 0.3, 0.2, 6, 0, 1.26, 0, dark),            // roof
    cyl(0.0, 0.1, 0.16, 6, 0, 1.42, 0, stone),           // finial
    cyl(0.05, 0.05, 0.07, 6, 0, 1.52, 0, stone),
  ];
  const glow = merge([
    box(0.24, 0.2, 0.05, 0, 1.0, 0.2, P.paperWarm),
    box(0.05, 0.2, 0.24, 0.2, 1.0, 0, P.paperWarm),
    box(0.05, 0.2, 0.24, -0.2, 1.0, 0, P.paperWarm),
    cyl(0.14, 0.14, 0.14, 8, 0, 1.0, 0, P.lanternLit),
  ]);
  return { structure: merge(s), glow, collider: { cx: 0, cz: 0, w: 0.8, d: 0.8, h: 1.6 } };
}

/** A stylized guardian lion-dog (komainu) on a plinth. */
export function propKomaInu(opts = {}) {
  const { stone = P.stone, dark = P.stoneD, mirrored = false } = opts;
  const m = mirrored ? -1 : 1;
  const s = [
    box(0.72, 0.14, 0.6, 0, 0.07, 0, dark),
    box(0.6, 0.4, 0.5, 0, 0.34, 0, stone),
    box(0.66, 0.07, 0.56, 0, 0.57, 0, dark),
    // Seated body + haunches
    blob(0.26, 0, 0.8, -0.04, stone),
    blob(0.16, 0.16 * m, 0.72, 0.06, stone),
    blob(0.16, -0.16 * m, 0.72, 0.06, stone),
    // Front legs
    box(0.11, 0.34, 0.12, 0.14, 0.76, 0.18, stone),
    box(0.11, 0.34, 0.12, -0.14, 0.76, 0.18, stone),
    box(0.13, 0.07, 0.2, 0.14, 0.62, 0.24, dark),
    box(0.13, 0.07, 0.2, -0.14, 0.62, 0.24, dark),
    // Head + mane + ears + muzzle
    blob(0.23, 0, 1.15, 0.06, stone),
    blob(0.14, 0.17, 1.12, -0.04, dark),
    blob(0.14, -0.17, 1.12, -0.04, dark),
    blob(0.12, 0, 1.3, -0.06, dark),
    box(0.16, 0.12, 0.14, 0, 1.1, 0.24, stone),
    box(0.09, 0.05, 0.05, 0, 1.06, 0.3, P.charcoal),
    box(0.05, 0.05, 0.04, 0.09, 1.18, 0.24, P.charcoal),
    box(0.05, 0.05, 0.04, -0.09, 1.18, 0.24, P.charcoal),
    cyl(0.0, 0.08, 0.14, 6, 0.14, 1.34, 0.02, stone, [0.3, 0, 0.4]),
    cyl(0.0, 0.08, 0.14, 6, -0.14, 1.34, 0.02, stone, [0.3, 0, -0.4]),
    // Curled tail
    blob(0.13, 0, 1.0, -0.28, stone),
    blob(0.09, 0.06 * m, 1.16, -0.3, stone),
  ];
  return { structure: merge(s), collider: { cx: 0, cz: 0, w: 0.75, d: 0.65, h: 1.45 } };
}

/** A shrine offering box with a shimenawa rope and two sake cups. */
export function propShrineOffering(opts = {}) {
  const { w = 1.3, h = 0.6, d = 0.7 } = opts;
  const s = [
    box(w, h, d, 0, h / 2, 0, C.wood),
    box(w + 0.1, 0.09, d + 0.1, 0, h + 0.03, 0, P.timberD),
    box(w + 0.1, 0.09, d + 0.1, 0, 0.05, 0, P.timberD),
  ];
  for (let i = 0; i < 7; i++) s.push(box(0.05, 0.1, d - 0.06, -w / 2 + 0.14 + i * ((w - 0.24) / 6), h + 0.06, 0, P.timberD)); // slatted slot
  // Shimenawa rope + paper streamers on a small crossbeam.
  s.push(box(0.08, 0.9, 0.08, -w / 2 - 0.14, 0.45, 0, P.timberD));
  s.push(box(0.08, 0.9, 0.08, w / 2 + 0.14, 0.45, 0, P.timberD));
  s.push(cyl(0.08, 0.08, w + 0.4, 8, 0, 0.9, 0, P.rope, [0, 0, Math.PI / 2]));
  for (const sx of [-0.36, 0, 0.36]) {
    s.push(box(0.11, 0.22, 0.02, sx, 0.76, 0.05, C.white));
    s.push(box(0.11, 0.1, 0.02, sx + 0.05, 0.62, 0.05, C.white));
  }
  // Two small cups on the lid.
  for (const cx of [-0.22, 0.22]) s.push(cyl(0.08, 0.06, 0.09, 8, cx, h + 0.12, 0.2, C.cream));
  return { structure: merge(s), collider: { cx: 0, cz: 0, w: w + 0.4, d, h: 1.0 } };
}

/** A rounded red post box on a short pillar. */
export function propMailbox(opts = {}) {
  const { color = P.vermillion, h = 1.15, r = 0.24 } = opts;
  const s = [
    cyl(r * 1.3, r * 1.5, 0.1, 12, 0, 0.05, 0, C.metalDark),
    cyl(r, r, h, 12, 0, h / 2 + 0.08, 0, color),
    cyl(r * 0.98, r * 0.6, 0.2, 12, 0, h + 0.16, 0, color),      // domed top
    cyl(r * 0.2, r * 0.2, 0.08, 8, 0, h + 0.3, 0, P.vermillionD),
    box(r * 1.3, 0.09, 0.06, 0, h - 0.06, r * 0.95, P.ink),      // slot
    box(r * 1.5, 0.13, 0.05, 0, h - 0.28, r * 0.98, C.cream),    // name plate
    cyl(r * 1.08, r * 1.08, 0.06, 12, 0, 0.22, 0, P.vermillionD),
  ];
  return { structure: merge(s), collider: { cx: 0, cz: 0, w: r * 2.2, d: r * 2.2, h: h + 0.4 } };
}

/** A fingerpost with arrow boards pointing to the districts. */
export function propSignPost(opts = {}) {
  const {
    h = 2.5,
    arrows = [
      { y: 2.2, yaw: 0.0, color: '#c8503f', dir: 1 },
      { y: 1.85, yaw: 1.05, color: '#4e8fa8', dir: -1 },
      { y: 1.5, yaw: -0.8, color: '#7ea36a', dir: 1 },
      { y: 1.15, yaw: 2.2, color: '#3f7fa8', dir: -1 },
    ],
  } = opts;
  const s = [
    cyl(0.09, 0.12, h, 8, 0, h / 2, 0, C.wood),
    cyl(0.16, 0.2, 0.14, 8, 0, 0.07, 0, P.stoneD),
    cyl(0.0, 0.13, 0.2, 8, 0, h + 0.1, 0, P.timberD),      // little pyramidal cap
  ];
  for (const a of arrows) {
    const len = 0.95, dep = 0.05;
    const cxo = a.dir * (len / 2 + 0.08);
    const g = [
      box(len, 0.26, dep, cxo, a.y, 0, a.color),
      box(0.2, 0.19, dep + 0.01, cxo + a.dir * (len / 2), a.y, 0, a.color, [0, 0, Math.PI / 4]),
      box(len * 0.7, 0.06, dep + 0.02, cxo, a.y, 0.005, C.cream),
    ];
    for (const gg of g) { gg.rotateY(a.yaw); s.push(gg); }
  }
  return { structure: merge(s), collider: { cx: 0, cz: 0, w: 0.34, d: 0.34, h } };
}

// ===========================================================================
// HARBOUR
// ===========================================================================

/** A small wooden fishing boat with a cabin, mast and tyre fenders. */
export function propFishingBoat(opts = {}) {
  const { len = 5.6, beam = 1.9, hull = '#5f8fa8', deck = C.wood, cabin = C.cream } = opts;
  const hl = len / 2, hb = beam / 2;
  const s = [
    box(beam, 0.7, len * 0.72, 0, 0.35, -len * 0.06, hull),          // main hull
    box(beam * 0.8, 0.7, len * 0.2, 0, 0.35, len * 0.36, hull, [0, 0, 0]),
    box(beam * 0.45, 0.7, len * 0.16, 0, 0.35, len * 0.46, hull),    // tapered bow
    box(beam * 0.2, 0.62, len * 0.1, 0, 0.36, len * 0.52, hull),
    box(beam + 0.08, 0.13, len * 0.94, 0, 0.74, 0, P.timberD),       // gunwale
    box(beam - 0.2, 0.06, len * 0.8, 0, 0.72, -len * 0.04, deck),    // deck
    box(beam * 0.7, 0.85, len * 0.24, 0, 1.15, -len * 0.2, cabin),   // cabin
    box(beam * 0.76, 0.12, len * 0.28, 0, 1.62, -len * 0.2, P.vermillionD),
    box(beam * 0.52, 0.34, 0.05, 0, 1.32, -len * 0.2 + len * 0.12, C.glass),
    cyl(0.06, 0.07, 2.0, 6, 0, 2.3, -len * 0.24, P.timberD),         // mast
    box(0.5, 0.34, 0.03, 0.3, 2.9, -len * 0.24, P.vermillion),       // pennant
    cyl(0.05, 0.05, 1.1, 6, 0, 1.9, len * 0.18, P.timberD),          // bow post
  ];
  // Tyre fenders + a coil of rope + two fish crates on deck.
  for (const z of [len * 0.22, 0, -len * 0.24]) {
    for (const sx of [-1, 1]) {
      s.push(cyl(0.18, 0.18, 0.11, 10, sx * (hb + 0.06), 0.6, z, P.charcoal, [0, 0, Math.PI / 2]));
    }
  }
  s.push(cyl(0.24, 0.24, 0.1, 10, hb * 0.45, 0.8, len * 0.1, P.rope));
  s.push(cyl(0.14, 0.14, 0.1, 10, hb * 0.45, 0.89, len * 0.1, P.rope));
  s.push(...crateShell(0.66, 0.32, 0.5, -hb * 0.42, 0.91, len * 0.06, '#c8ccc4', '#9aa199'));
  s.push(...crateShell(0.66, 0.32, 0.5, -hb * 0.42, 1.23, len * 0.06, '#c8ccc4', '#9aa199'));
  void hl;
  return { structure: merge(s), collider: { cx: 0, cz: 0, w: beam + 0.4, d: len, h: 1.8 } };
}

/** A weathered mooring pile at the dock edge. */
export function propDockPiling(opts = {}) {
  const { h = 1.5, r = 0.16 } = opts;
  const s = [
    cyl(r, r * 1.12, h, 8, 0, h / 2, 0, C.wood),
    cyl(r * 1.12, r * 1.12, 0.1, 8, 0, h - 0.05, 0, P.timberD),   // top cap
    cyl(r * 1.2, r * 1.2, 0.07, 8, 0, h * 0.62, 0, P.rope),       // rope wrap
    cyl(r * 1.2, r * 1.2, 0.07, 8, 0, h * 0.52, 0, P.rope),
    cyl(r * 1.15, r * 1.15, 0.16, 8, 0, 0.12, 0, '#6f7f74'),      // waterline band
  ];
  return { structure: merge(s), collider: { cx: 0, cz: 0, w: r * 2.4, d: r * 2.4, h } };
}

/** A rope drooping from a dockside cleat toward the water. */
export function propMooringRope(opts = {}) {
  const { span = 2.6, sag = 0.55, y = 0.7, color = P.rope } = opts;
  const s = [
    box(0.34, 0.1, 0.2, 0, 0.05, -span / 2, C.metalDark),                 // cleat plate
    cyl(0.05, 0.05, 0.34, 8, 0, 0.2, -span / 2, C.metalDark, [0, 0, Math.PI / 2]),
    cyl(0.06, 0.06, 0.16, 8, -0.16, 0.24, -span / 2, C.metalDark),
    cyl(0.06, 0.06, 0.16, 8, 0.16, 0.24, -span / 2, C.metalDark),
  ];
  s.push(...cordZ(-span / 2, y * 0.35, span / 2, y * 0.2, 0, color, sag, 6, 0.06));
  s.push(cyl(0.22, 0.22, 0.09, 10, 0.34, 0.05, -span / 2 + 0.5, color));  // coil on the deck
  s.push(cyl(0.13, 0.13, 0.09, 10, 0.34, 0.13, -span / 2 + 0.5, color));
  return { structure: merge(s) };
}

/**
 * A tiny seagull. `flap` is the local offset of the wing pivot so an animator
 * can rock the wings around it (the wings are baked into the structure).
 */
export function propSeagull(opts = {}) {
  const { y = 0.0, body = C.white, wing = '#d6dbe0', beak = C.orange } = opts;
  const s = [
    blob(0.15, 0, y + 0.2, 0, body),
    blob(0.09, 0, y + 0.33, 0.1, body),                          // head
    cyl(0.0, 0.035, 0.13, 6, 0, y + 0.32, 0.2, beak, [Math.PI / 2, 0, 0]),
    box(0.26, 0.04, 0.16, 0, y + 0.22, -0.18, wing, [0.2, 0, 0]),// tail
    box(0.3, 0.04, 0.14, 0.2, y + 0.26, 0.0, wing, [0, 0, 0.28]),// wings
    box(0.3, 0.04, 0.14, -0.2, y + 0.26, 0.0, wing, [0, 0, -0.28]),
    box(0.03, 0.11, 0.03, 0.05, y + 0.07, 0.02, beak),           // legs
    box(0.03, 0.11, 0.03, -0.05, y + 0.07, 0.02, beak),
    box(0.05, 0.02, 0.04, 0.06, y + 0.33, 0.14, P.ink),          // eyes
    box(0.05, 0.02, 0.04, -0.06, y + 0.33, 0.14, P.ink),
  ];
  return { structure: merge(s), flap: { x: 0, y: y + 0.26, z: 0 } };
}

// ===========================================================================
// INTERIOR-FLAVOUR PROPS
// ===========================================================================

/** A tatami mat with a dark cloth border. */
export function propTatamiMat(opts = {}) {
  const { w = 1.8, d = 0.9, color = '#c9c48a', border = '#3c4a3a' } = opts;
  const s = [
    box(w, 0.07, d, 0, 0.035, 0, color),
    box(w, 0.075, 0.09, 0, 0.036, d / 2 - 0.045, border),
    box(w, 0.075, 0.09, 0, 0.036, -d / 2 + 0.045, border),
  ];
  for (let i = 1; i < 5; i++) s.push(box(0.015, 0.078, d - 0.2, -w / 2 + (w / 5) * i, 0.037, 0, '#bdb87e'));
  return { structure: merge(s) };
}

/** A kotatsu — low table with a quilt skirt and a warm underglow. */
export function propKotatsu(opts = {}) {
  const { w = 1.15, d = 0.95, quilt = '#d98a76', top = C.wood } = opts;
  const s = [
    box(w + 0.35, 0.5, d + 0.35, 0, 0.28, 0, quilt),           // draped quilt
    box(w + 0.4, 0.08, d + 0.4, 0, 0.53, 0, '#c07863'),        // quilt fold
    box(w, 0.07, d, 0, 0.6, 0, top),                           // table top
    box(w + 0.08, 0.04, d + 0.08, 0, 0.63, 0, '#9a6a3f'),
  ];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    s.push(box(0.08, 0.5, 0.08, sx * (w / 2 - 0.1), 0.25, sz * (d / 2 - 0.1), P.timberD));
  }
  // Two cups + a small pot on top.
  s.push(cyl(0.08, 0.06, 0.09, 8, -0.28, 0.68, 0.16, C.cream));
  s.push(cyl(0.08, 0.06, 0.09, 8, 0.28, 0.68, -0.16, C.cream));
  s.push(cyl(0.13, 0.13, 0.14, 10, 0, 0.71, 0, '#4a6f7a'));
  const glow = merge([box(w * 0.9, 0.05, d * 0.9, 0, 0.09, 0, P.lanternLit)]);
  return { structure: merge(s), glow, collider: { cx: 0, cz: 0, w: w + 0.4, d: d + 0.4, h: 0.65 } };
}

/** A projecting ramen-bowl shop sign on a bracket. */
export function propRamenBowlSign(opts = {}) {
  const { y = 2.6, panel = C.cream, band = P.vermillion } = opts;
  const s = [
    box(0.12, 0.5, 0.12, 0, y, -0.3, P.timberD),           // wall bracket
    box(0.1, 0.1, 0.7, 0, y + 0.2, 0.05, P.timberD),
    box(1.0, 0.7, 0.09, 0, y, 0.42, panel),                // sign board
    box(1.06, 0.1, 0.11, 0, y + 0.34, 0.42, band),
    box(1.06, 0.1, 0.11, 0, y - 0.34, 0.42, band),
    // The bowl motif, modelled in relief.
    cyl(0.26, 0.15, 0.2, 12, 0, y - 0.08, 0.5, band),
    cyl(0.28, 0.28, 0.04, 12, 0, y + 0.03, 0.5, C.cream),
    box(0.5, 0.03, 0.03, 0.06, y + 0.2, 0.52, P.timberD, [0, 0, 0.42]),
    box(0.5, 0.03, 0.03, 0.02, y + 0.22, 0.52, P.timberD, [0, 0, 0.5]),
  ];
  const glow = merge([box(0.92, 0.5, 0.03, 0, y, 0.48, P.paperWarm)]);
  return { structure: merge(s), glow };
}

/** A standalone striped awning that can be pinned onto any plain wall. */
export function propAwningStripe(opts = {}) {
  const { w = 3.2, y = 2.8, depth = 1.3, color = P.vermillion, alt = C.cream, stripes = 6 } = opts;
  const ang = -0.3;
  const s = [];
  const sw = w / stripes;
  for (let i = 0; i < stripes; i++) {
    s.push(box(sw + 0.01, 0.09, depth, -w / 2 + sw * (i + 0.5), y + 0.2, depth * 0.42, i % 2 ? alt : color, [ang, 0, 0]));
  }
  s.push(box(w + 0.1, 0.28, 0.08, 0, y - 0.02, depth * 0.86, color));  // scalloped valance band
  for (let i = 0; i < stripes; i++) {
    if (i % 2) s.push(box(sw * 0.9, 0.26, 0.1, -w / 2 + sw * (i + 0.5), y - 0.03, depth * 0.87, alt));
  }
  s.push(box(w + 0.12, 0.12, 0.12, 0, y + 0.42, 0.02, P.timberD));     // wall rail
  for (const sx of [-w / 2 + 0.2, w / 2 - 0.2]) {
    s.push(box(0.07, 0.07, depth * 0.9, sx, y + 0.3, depth * 0.4, P.timberD, [ang, 0, 0]));
  }
  return { structure: merge(s) };
}

// ===========================================================================
// GREENERY
// ===========================================================================

/** A cherry tree — dark trunk, three soft blossom clouds. */
export function propCherryTree(opts = {}) {
  const { h = 3.4, blossom = P.blossom, trunk = '#6f5340' } = opts;
  const s = [
    cyl(0.16, 0.26, h * 0.55, 8, 0, h * 0.275, 0, trunk),
    cyl(0.1, 0.14, h * 0.3, 6, 0.28, h * 0.62, 0.06, trunk, [0, 0, -0.5]),
    cyl(0.1, 0.14, h * 0.3, 6, -0.3, h * 0.6, -0.05, trunk, [0, 0, 0.55]),
    cyl(0.09, 0.12, h * 0.26, 6, 0.02, h * 0.72, 0.2, trunk, [-0.4, 0, 0]),
    blob(0.9, 0, h * 0.94, 0, blossom),
    blob(0.7, 0.72, h * 0.8, 0.16, P.blossomD),
    blob(0.66, -0.68, h * 0.78, -0.18, blossom),
    blob(0.44, 0.18, h * 0.72, 0.62, P.blossomD),
    disc(0.9, 0, 0, '#e2b3c8', 0.02, 12),      // a few fallen petals
  ];
  return { structure: merge(s), collider: { cx: 0, cz: 0, w: 0.7, d: 0.7, h: h * 0.6 } };
}

/** A layered Japanese pine — flat cloud pads on a leaning trunk. */
export function propPineTree(opts = {}) {
  const { h = 3.2, needle = P.pine } = opts;
  const s = [
    cyl(0.13, 0.24, h * 0.7, 8, 0, h * 0.35, 0, '#6b5238'),
    cyl(0.09, 0.12, h * 0.34, 6, 0.3, h * 0.66, 0.04, '#6b5238', [0, 0, -0.62]),
    cyl(0.08, 0.11, h * 0.3, 6, -0.28, h * 0.58, -0.06, '#6b5238', [0, 0, 0.7]),
    cyl(0.62, 0.68, 0.22, 10, 0.62, h * 0.72, 0.06, needle),
    cyl(0.5, 0.56, 0.2, 10, -0.56, h * 0.64, -0.08, P.pineD),
    cyl(0.56, 0.62, 0.22, 10, 0.06, h * 0.9, 0.02, needle),
    cyl(0.36, 0.4, 0.18, 10, -0.2, h * 1.02, 0.1, P.pineD),
    cyl(0.28, 0.3, 0.14, 10, 0.4, h * 0.5, -0.24, needle),
  ];
  return { structure: merge(s), collider: { cx: 0, cz: 0, w: 0.6, d: 0.6, h: h * 0.7 } };
}

/** A clipped hedge with softly rounded ends. */
export function propHedge(opts = {}) {
  const { w = 2.4, h = 0.85, d = 0.7, color = P.moss } = opts;
  const s = [
    box(w, h, d, 0, h / 2, 0, color),
    cyl(d / 2, d / 2, h, 10, -w / 2, h / 2, 0, color),
    cyl(d / 2, d / 2, h, 10, w / 2, h / 2, 0, color),
    box(w * 0.96, 0.1, d * 0.9, 0, h + 0.02, 0, C.leaf),      // sunlit top
    box(w + d, 0.09, d + 0.06, 0, 0.045, 0, '#5b4632'),       // soil strip
  ];
  s.push(blob(0.13, w * 0.2, h + 0.06, d * 0.2, C.leaf));
  s.push(blob(0.11, -w * 0.25, h + 0.04, -d * 0.2, C.leaf));
  return { structure: merge(s), collider: { cx: 0, cz: 0, w: w + d, d, h } };
}

/**
 * A low dry-stone boundary wall. Used to edge plots and garden patches out in
 * the quiet stretches between districts, where a hedge alone reads too soft.
 */
export function propStoneWall(opts = {}) {
  const { w = 3.2, h = 0.68, d = 0.44, color = P.stone, shade = P.stoneD } = opts;
  const s = [
    box(w, h, d, 0, h / 2, 0, color),
    box(w + 0.18, 0.13, d + 0.16, 0, h + 0.05, 0, shade),               // capping course
    box(w * 0.3, h * 0.4, d + 0.02, -w * 0.28, h * 0.26, 0, shade),     // a few darker stones
    box(w * 0.2, h * 0.3, d + 0.02, w * 0.24, h * 0.62, 0, shade),
    box(w * 0.16, h * 0.26, d + 0.02, w * 0.36, h * 0.2, 0, '#bdb6a6'),
    box(w * 0.22, h * 0.28, d + 0.02, -w * 0.04, h * 0.7, 0, '#bdb6a6'),
    box(w + 0.34, 0.1, d + 0.24, 0, 0.05, 0, '#5b4632'),                // packed earth base
  ];
  return { structure: merge(s), collider: { cx: 0, cz: 0, w: w + 0.2, d: d + 0.2, h } };
}

/**
 * A paper lantern hung from a short timber post — the standing version of
 * `paperLantern`, so a plaza can be lit without a wall to hang from.
 */
export function propLanternPost(opts = {}) {
  const { h = 2.5, r = 0.28, color = P.lantern } = opts;
  const s = [
    cyl(0.17, 0.23, 0.18, 8, 0, 0.09, 0, P.stoneD),           // stone footing
    cyl(0.08, 0.1, h, 8, 0, h / 2, 0, P.timberD),             // post
    cyl(0.0, 0.14, 0.2, 8, 0, h + 0.1, 0, P.timberD),         // pyramidal cap
    box(0.66, 0.09, 0.09, 0.28, h - 0.12, 0, P.timberD),      // arm
    box(0.07, 0.07, 0.24, 0.16, h - 0.28, 0, P.timberD, [0.9, 0, 0]),
    box(0.035, 0.26, 0.035, 0.52, h - 0.31, 0, C.black),      // cord
    cyl(r * 0.55, r * 0.55, 0.07, 10, 0.52, h - 0.5, 0, C.black),
    cyl(r * 1.02, r * 1.02, 0.03, 10, 0.52, h - 0.74, 0, P.vermillionD),
    cyl(r * 0.55, r * 0.55, 0.06, 10, 0.52, h - 0.98, 0, C.black),
    box(0.05, 0.16, 0.05, 0.52, h - 1.1, 0, C.black),         // tassel
  ];
  const g = [
    cyl(r, r * 0.92, 0.24, 10, 0.52, h - 0.62, 0, color),
    cyl(r * 0.92, r, 0.24, 10, 0.52, h - 0.86, 0, color),
  ];
  return { structure: merge(s), glow: merge(g), collider: { cx: 0, cz: 0, w: 0.42, d: 0.42, h } };
}

// ===========================================================================
// GROUND DECALS
// ===========================================================================

/** A zebra crossing painted flat on the road at y=0.02. */
export function propRoadCrossing(opts = {}) {
  const { width = 9, bars = 7, barW = 0.55, depth = 3.0, color = '#f2ead4' } = opts;
  const s = [];
  const step = width / bars;
  for (let i = 0; i < bars; i++) {
    s.push(decal(barW, depth, -width / 2 + step * (i + 0.5), 0, color));
  }
  return { structure: merge(s) };
}

/** A cast-iron manhole cover, flat on the road. */
export function propManholeCover(opts = {}) {
  const { r = 0.42, color = '#6f7379', inner = '#5c6066' } = opts;
  const s = [
    disc(r, 0, 0, color, 0.02, 16),
    disc(r * 0.82, 0, 0, inner, 0.025, 16),
    disc(r * 0.28, 0, 0, color, 0.03, 12),
  ];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    s.push(decal(r * 0.7, 0.05, Math.cos(a) * 0, Math.sin(a) * 0, color, 0.028).rotateY(a));
  }
  return { structure: merge(s) };
}

/** A gutter grate at the kerb, flat on the ground. */
export function propGutterGrate(opts = {}) {
  const { w = 0.9, d = 0.4, frame = '#6f7379', slot = '#3a3d42' } = opts;
  const s = [decal(w, d, 0, 0, frame, 0.02)];
  for (let i = 0; i < 5; i++) {
    s.push(decal(w * 0.11, d * 0.72, -w * 0.34 + i * (w * 0.17), 0, slot, 0.025));
  }
  s.push(decal(w * 0.94, 0.05, 0, d * 0.4, slot, 0.024));
  s.push(decal(w * 0.94, 0.05, 0, -d * 0.4, slot, 0.024));
  return { structure: merge(s) };
}

// ===========================================================================
// REGISTRY
// ===========================================================================

const ALL = ['old_market', 'fish_harbor', 'downtown', 'residential', 'neon_street'];

/**
 * The prop registry. A scatterer picks by `tags` and `districts`; `nightGlow`
 * flags props that carry a glow/neon channel worth lighting after dusk.
 */
export const PROPS = {
  paperLantern:   { build: propPaperLantern,   tags: ['hanging', 'festive', 'light'], districts: ['old_market', 'neon_street', 'downtown'], nightGlow: true },
  lanternString:  { build: propLanternString,  tags: ['hanging', 'festive', 'light'], districts: ['old_market', 'neon_street'], nightGlow: true },
  noren:          { build: propNoren,          tags: ['fabric', 'shopfront'], districts: ['old_market', 'neon_street', 'residential'], nightGlow: false },
  nobori:         { build: propNobori,         tags: ['fabric', 'signage'], districts: ['old_market', 'neon_street', 'fish_harbor'], nightGlow: false },
  woodenStall:    { build: propWoodenStall,    tags: ['market', 'blocking'], districts: ['old_market', 'fish_harbor'], nightGlow: false },
  fruitCrate:     { build: propFruitCrate,     tags: ['market', 'clutter'], districts: ['old_market', 'residential'], nightGlow: false },
  fishCrate:      { build: propFishCrate,      tags: ['market', 'clutter', 'harbour'], districts: ['fish_harbor', 'old_market'], nightGlow: false },
  barrel:         { build: propBarrel,         tags: ['clutter'], districts: ALL, nightGlow: false },
  sakeBarrelStack:{ build: propSakeBarrelStack,tags: ['festive', 'wall'], districts: ['old_market', 'neon_street'], nightGlow: false },
  vendingMachine: { build: propVendingMachine, tags: ['street', 'light'], districts: ['downtown', 'residential', 'neon_street'], nightGlow: true },
  utilityPole:    { build: propUtilityPole,    tags: ['street', 'tall'], districts: ['old_market', 'residential', 'downtown', 'neon_street'], nightGlow: false },
  streetLamp:     { build: propStreetLamp,     tags: ['street', 'light'], districts: ALL, nightGlow: true },
  trafficCone:    { build: propTrafficCone,    tags: ['street', 'clutter'], districts: ['downtown', 'fish_harbor'], nightGlow: false },
  benchWood:      { build: propBenchWood,      tags: ['seating', 'street'], districts: ALL, nightGlow: false },
  planterBox:     { build: propPlanterBox,     tags: ['green', 'street'], districts: ALL, nightGlow: false },
  pottedPlant:    { build: propPottedPlant,    tags: ['green', 'clutter'], districts: ALL, nightGlow: false },
  bonsai:         { build: propBonsai,         tags: ['green', 'clutter'], districts: ['old_market', 'residential'], nightGlow: false },
  bicycle:        { build: propBicycle,        tags: ['street', 'clutter'], districts: ['residential', 'old_market', 'downtown'], nightGlow: false },
  bicycleRack:    { build: propBicycleRack,    tags: ['street'], districts: ['downtown', 'residential'], nightGlow: false },
  trashBins:      { build: propTrashBins,      tags: ['street', 'clutter'], districts: ALL, nightGlow: false },
  acUnit:         { build: propAcUnit,         tags: ['wall'], districts: ['downtown', 'neon_street', 'old_market'], nightGlow: false },
  torii:          { build: propTorii,          tags: ['shrine', 'landmark'], districts: ['old_market', 'residential'], nightGlow: false },
  stoneLantern:   { build: propStoneLantern,   tags: ['shrine', 'green', 'light'], districts: ['old_market', 'residential'], nightGlow: true },
  komaInu:        { build: propKomaInu,        tags: ['shrine', 'statue'], districts: ['old_market'], nightGlow: false },
  shrineOffering: { build: propShrineOffering, tags: ['shrine'], districts: ['old_market'], nightGlow: false },
  mailbox:        { build: propMailbox,        tags: ['street'], districts: ['residential', 'old_market', 'downtown'], nightGlow: false },
  signPost:       { build: propSignPost,       tags: ['street', 'signage'], districts: ALL, nightGlow: false },
  fishingBoat:    { build: propFishingBoat,    tags: ['harbour', 'blocking'], districts: ['fish_harbor'], nightGlow: false },
  dockPiling:     { build: propDockPiling,     tags: ['harbour'], districts: ['fish_harbor'], nightGlow: false },
  mooringRope:    { build: propMooringRope,    tags: ['harbour', 'clutter'], districts: ['fish_harbor'], nightGlow: false },
  seagull:        { build: propSeagull,        tags: ['critter', 'harbour'], districts: ['fish_harbor'], nightGlow: false },
  tatamiMat:      { build: propTatamiMat,      tags: ['interior'], districts: ['old_market', 'residential'], nightGlow: false },
  kotatsu:        { build: propKotatsu,        tags: ['interior', 'light'], districts: ['residential', 'old_market'], nightGlow: true },
  ramenBowlSign:  { build: propRamenBowlSign,  tags: ['signage', 'wall', 'light'], districts: ['old_market', 'neon_street'], nightGlow: true },
  awningStripe:   { build: propAwningStripe,   tags: ['fabric', 'wall'], districts: ['old_market', 'downtown', 'residential'], nightGlow: false },
  cherryTree:     { build: propCherryTree,     tags: ['tree', 'green'], districts: ['old_market', 'residential', 'downtown'], nightGlow: false },
  pineTree:       { build: propPineTree,       tags: ['tree', 'green'], districts: ['old_market', 'residential', 'fish_harbor'], nightGlow: false },
  hedge:          { build: propHedge,          tags: ['green'], districts: ['residential', 'downtown'], nightGlow: false },
  stoneWall:      { build: propStoneWall,      tags: ['green', 'wall'], districts: ALL, nightGlow: false },
  lanternPost:    { build: propLanternPost,    tags: ['street', 'festive', 'light'], districts: ALL, nightGlow: true },
  roadCrossing:   { build: propRoadCrossing,   tags: ['decal', 'road'], districts: ALL, nightGlow: false },
  manholeCover:   { build: propManholeCover,   tags: ['decal', 'road'], districts: ALL, nightGlow: false },
  gutterGrate:    { build: propGutterGrate,    tags: ['decal', 'road'], districts: ALL, nightGlow: false },
};

// ===========================================================================
// INSTANCER
// ===========================================================================

/**
 * Build a scattered prop set. Each unique prop id is built ONCE, then every
 * placement of that id is drawn from a single InstancedMesh per geometry
 * channel (structure / glow / neon) — so a street of 400 props is a couple of
 * dozen draw calls.
 *
 * placements: [{ id, x, z, yaw, scale }]
 * returns { group, count }
 */
export function buildPropInstances(scene, placements = [], opts = {}) {
  const { gradientMap = null, group, colliders, glowMats, neonMats } = opts;
  const root = group || new THREE.Group();
  if (!group && scene) scene.add(root);

  // Flat vertex-coloured toon surfaces — the whole prop library shares one.
  const structMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });

  // Warm interior/paper light. Starts dark and is ramped up at dusk by the
  // day/night system through `glowMats`.
  let glowMat = null;
  const getGlowMat = () => {
    if (!glowMat) {
      glowMat = new THREE.MeshToonMaterial({
        vertexColors: true,
        gradientMap,
        emissive: new THREE.Color(0xffd9a0),
        emissiveIntensity: 0,
        // Glow shells sit right on the structure — bias them toward the camera
        // so they win the depth test without z-fighting.
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      });
      if (glowMats) glowMats.push(glowMat);
    }
    return glowMat;
  };

  // Neon/sign tubes: bright vertex colours by day, ramped emissive at night so
  // the bloom pass haloes them.
  let neonMat = null;
  const getNeonMat = () => {
    if (!neonMat) {
      neonMat = new THREE.MeshToonMaterial({
        vertexColors: true,
        gradientMap,
        emissive: new THREE.Color(0xfff0d0),
        emissiveIntensity: 0.12,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -3,
      });
      if (neonMats) neonMats.push(neonMat);
    }
    return neonMat;
  };

  // Bucket the placements by prop id.
  const byId = new Map();
  for (const p of placements) {
    if (!PROPS[p.id]) continue;
    let list = byId.get(p.id);
    if (!list) byId.set(p.id, (list = []));
    list.push(p);
  }

  const dummy = new THREE.Object3D();
  const localCenter = new THREE.Vector3();
  let count = 0;

  for (const [id, list] of byId) {
    const built = PROPS[id].build();          // ONE canonical geometry per prop
    if (!built || !built.structure) continue;

    const meshes = [];
    const sMesh = new THREE.InstancedMesh(built.structure, structMat, list.length);
    sMesh.name = `prop:${id}`;
    sMesh.castShadow = true;
    sMesh.receiveShadow = true;
    meshes.push(sMesh);

    let gMesh = null;
    if (built.glow) {
      gMesh = new THREE.InstancedMesh(built.glow, getGlowMat(), list.length);
      gMesh.name = `prop:${id}:glow`;
      meshes.push(gMesh);
    }
    let nMesh = null;
    if (built.neon) {
      nMesh = new THREE.InstancedMesh(built.neon, getNeonMat(), list.length);
      nMesh.name = `prop:${id}:neon`;
      meshes.push(nMesh);
    }

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const s = p.scale || 1;
      const yaw = p.yaw || 0;
      dummy.position.set(p.x || 0, p.y || 0, p.z || 0);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      for (const m of meshes) m.setMatrixAt(i, dummy.matrix);

      const col = built.collider;
      if (col && colliders) {
        localCenter.set(col.cx || 0, 0, col.cz || 0).applyMatrix4(dummy.matrix);
        const horiz = Math.abs(Math.sin(yaw)) > 0.5;      // faces ±X → swap w/d
        const cw = ((horiz ? col.d : col.w) * s) / 2;
        const cd = ((horiz ? col.w : col.d) * s) / 2;
        const ch = (col.h || 1) * s;
        colliders.push(new THREE.Box3(
          new THREE.Vector3(localCenter.x - cw, 0, localCenter.z - cd),
          new THREE.Vector3(localCenter.x + cw, ch, localCenter.z + cd)
        ));
      }
      count++;
    }

    for (const m of meshes) {
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
      root.add(m);
    }
  }

  return { group: root, count };
}
