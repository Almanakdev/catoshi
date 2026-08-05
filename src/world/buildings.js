import * as THREE from 'three';
import { box, cyl, blob, merge, C } from '../engine/prim.js';
import { makeCanvas, finish } from '../engine/textures.js';
import { GAME } from '../config.js';

// ---------------------------------------------------------------------------
// CATUSHI — building library.
//
// Same contract as the shop builders: every builder takes an options object and
// returns
//
//   { structure, glow?, neon?, sign?, signTex?, collider }
//
// …all geometry in LOCAL space with the origin on the ground at the building's
// centre, facing +Z (the street). `collider` is {cx,cz,w,d,h}.
//
// Art direction: Japanese-inspired CLEAN CARTOON — soft rounded shapes, simple
// readable geometry, deep eaves with visible rafters, kawara ridge tiles, timber
// posts, paper panels, textiles, warm controlled colour. Flat baked vertex
// colours only; each building merges down to one geometry per channel so a whole
// street is a handful of instanced draw calls.
//
// SCALE: one storey = 3.6 units. Doors 2.4 high, 1.3 wide. The player cat is
// ~1.05 units at the shoulder.
// ---------------------------------------------------------------------------

const STOREY = 3.6;

const P = {
  vermillion: '#d64b3a',
  vermillionD: '#a3372c',
  lantern: '#e8492b',
  lanternLit: '#ffb35c',
  paper: '#f6e7c8',
  paperWarm: '#ffe9bc',
  ink: '#2f2a26',
  charcoal: '#3a3630',
  tile: '#5a6672',        // kawara roof slate
  tileD: '#414c56',
  tileWarm: '#7a6a62',
  stone: '#cac4b5',
  stoneD: '#a49d8d',
  rope: '#d9c79a',
  sage: '#8fae7a',
  moss: '#6f8f5c',
  blossom: '#f6c3d8',
  pine: '#4e7f52',
  plaster: '#efe3c8',
  plasterCool: '#e2e5e0',
  timber: '#8a5a34',
  timberD: '#5b4a3a',
  ice: '#d6ecf2',
  fish: '#b9c8d2',
  seafoam: '#8fb9bd',
};

// ---------------------------------------------------------------------------
// Shared architectural helpers
// ---------------------------------------------------------------------------

/**
 * A tiled gable roof with a ridge cap, kawara ribs running up each slope,
 * eave fascia boards and exposed rafter tails. `y` is the EAVE height; the
 * ridge sits at y + rise.
 */
function tiledGable(w, d, x, y, z, opts = {}) {
  const {
    col = P.tile, ridge = P.tileD, rise = 1.0, over = 0.5,
    t = 0.16, ribs = 6, rafters = 7, fascia = true,
  } = opts;
  const hd = d / 2 + over;
  const ang = Math.atan2(rise, hd);
  const slope = Math.hypot(hd, rise);
  const ww = w + over * 2;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const s = [
    box(ww, t, slope, x, y + rise / 2, z + hd / 2, col, [ang, 0, 0]),
    box(ww, t, slope, x, y + rise / 2, z - hd / 2, col, [-ang, 0, 0]),
    box(ww + 0.16, 0.26, 0.4, x, y + rise + 0.06, z, ridge),                // ridge cap
    box(0.34, 0.36, 0.44, x - ww / 2 - 0.04, y + rise + 0.1, z, ridge),     // ridge end blocks
    box(0.34, 0.36, 0.44, x + ww / 2 + 0.04, y + rise + 0.1, z, ridge),
  ];
  // Kawara ribs, offset along each slope's normal so they sit proud of the tile.
  const k = t * 0.6;
  for (let i = 0; i < ribs; i++) {
    const rx = x - ww / 2 + (ww / ribs) * (i + 0.5);
    s.push(box(0.09, t * 0.7, slope * 0.99, rx, y + rise / 2 + k * ca, z + hd / 2 + k * sa, ridge, [ang, 0, 0]));
    s.push(box(0.09, t * 0.7, slope * 0.99, rx, y + rise / 2 + k * ca, z - hd / 2 - k * sa, ridge, [-ang, 0, 0]));
  }
  if (fascia) {
    s.push(box(ww + 0.08, 0.16, 0.11, x, y - 0.05, z + hd, ridge));
    s.push(box(ww + 0.08, 0.16, 0.11, x, y - 0.05, z - hd, ridge));
    s.push(box(0.11, 0.16, d + over * 2, x - ww / 2, y + rise / 2 - 0.05, z, ridge));
    s.push(box(0.11, 0.16, d + over * 2, x + ww / 2, y + rise / 2 - 0.05, z, ridge));
  }
  // Exposed rafter tails under the front eave (the detail that reads Japanese).
  for (let i = 0; i < rafters; i++) {
    const rx = x - w / 2 + (w / (rafters - 1)) * i;
    s.push(box(0.09, 0.13, over * 1.5, rx, y - 0.16, z + d / 2 + over * 0.45, P.timberD, [ang, 0, 0]));
    s.push(box(0.09, 0.13, over * 1.5, rx, y - 0.16, z - d / 2 - over * 0.45, P.timberD, [-ang, 0, 0]));
  }
  return s;
}

/** A shallow flat roof with a parapet band (modern shops / offices). */
function flatRoof(w, d, x, y, z, { slab = P.stoneD, band = P.stone, lip = 0.35 } = {}) {
  return [
    box(w + 0.3, 0.24, d + 0.3, x, y + 0.12, z, slab),
    box(w + 0.42, lip, 0.16, x, y + 0.24 + lip / 2, z + d / 2 + 0.15, band),
    box(w + 0.42, lip, 0.16, x, y + 0.24 + lip / 2, z - d / 2 - 0.15, band),
    box(0.16, lip, d + 0.42, x - w / 2 - 0.15, y + 0.24 + lip / 2, z, band),
    box(0.16, lip, d + 0.42, x + w / 2 + 0.15, y + 0.24 + lip / 2, z, band),
  ];
}

/** A corrugated industrial roof: a shallow gable with visible ribs. */
function corrugatedRoof(w, d, x, y, z, { col = C.steel, rib = C.metalDark, rise = 0.9, over = 0.4, ribs = 14 } = {}) {
  const hd = d / 2 + over;
  const ang = Math.atan2(rise, hd);
  const slope = Math.hypot(hd, rise);
  const ww = w + over * 2;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const s = [
    box(ww, 0.12, slope, x, y + rise / 2, z + hd / 2, col, [ang, 0, 0]),
    box(ww, 0.12, slope, x, y + rise / 2, z - hd / 2, col, [-ang, 0, 0]),
    box(ww + 0.1, 0.2, 0.3, x, y + rise + 0.04, z, rib),
  ];
  for (let i = 0; i < ribs; i++) {
    const rx = x - ww / 2 + (ww / ribs) * (i + 0.5);
    s.push(box(0.07, 0.09, slope, rx, y + rise / 2 + 0.09 * ca, z + hd / 2 + 0.09 * sa, rib, [ang, 0, 0]));
    s.push(box(0.07, 0.09, slope, rx, y + rise / 2 + 0.09 * ca, z - hd / 2 - 0.09 * sa, rib, [-ang, 0, 0]));
  }
  return s;
}

/** A shoji / paper panel with a fine timber grid. */
function shoji(w, h, x, y, z, { frame = P.timberD, panelColor = P.paper, cols = 3, rows = 3, t = 0.06 } = {}) {
  const s = [
    box(w, h, t, x, y, z, panelColor),
    box(w, 0.09, t + 0.03, x, y + h / 2 - 0.045, z, frame),
    box(w, 0.09, t + 0.03, x, y - h / 2 + 0.045, z, frame),
    box(0.09, h, t + 0.03, x - w / 2 + 0.045, y, z, frame),
    box(0.09, h, t + 0.03, x + w / 2 - 0.045, y, z, frame),
  ];
  for (let i = 1; i < cols; i++) s.push(box(0.045, h - 0.12, t + 0.02, x - w / 2 + (w / cols) * i, y, z, frame));
  for (let i = 1; i < rows; i++) s.push(box(w - 0.12, 0.045, t + 0.02, x, y - h / 2 + (h / rows) * i, z, frame));
  return s;
}

/** A timber lattice (koshi) screen — the machiya street-front signature. */
function koshi(w, h, x, y, z, { col = P.timberD, bars = 9, t = 0.05 } = {}) {
  const s = [box(w, h, 0.04, x, y, z - 0.04, P.ink)];
  for (let i = 0; i < bars; i++) {
    s.push(box(t, h, 0.07, x - w / 2 + (w / (bars - 1)) * i, y, z, col));
  }
  s.push(box(w, 0.09, 0.08, x, y + h / 2, z, col));
  s.push(box(w, 0.09, 0.08, x, y - h / 2, z, col));
  s.push(box(w, 0.06, 0.08, x, y, z, col));
  return s;
}

/** A striped fabric awning that slopes toward the street. */
function stripedAwning(w, x, y, z, { color = P.vermillion, alt = C.cream, depth = 1.4, stripes = 6, ang = -0.28 } = {}) {
  const s = [];
  const sw = w / stripes;
  for (let i = 0; i < stripes; i++) {
    s.push(box(sw + 0.01, 0.1, depth, x - w / 2 + sw * (i + 0.5), y + 0.2, z + depth * 0.42, i % 2 ? alt : color, [ang, 0, 0]));
  }
  s.push(box(w + 0.12, 0.3, 0.09, x, y - 0.02, z + depth * 0.86, color));
  for (let i = 0; i < stripes; i++) {
    if (i % 2) s.push(box(sw * 0.9, 0.28, 0.11, x - w / 2 + sw * (i + 0.5), y - 0.03, z + depth * 0.87, alt));
  }
  return s;
}

/** A split noren curtain hung across an opening. */
function noren(w, h, x, y, z, { color = P.vermillion, band = C.cream, panels = 3, mark = true } = {}) {
  const s = [cyl(0.05, 0.05, w + 0.24, 8, x, y + h / 2 + 0.06, z, P.timberD, [0, 0, Math.PI / 2])];
  const pw = (w / panels) * 0.93;
  for (let i = 0; i < panels; i++) {
    const px = x - w / 2 + (w / panels) * (i + 0.5);
    s.push(box(pw, h, 0.05, px, y, z, color));
    s.push(box(pw, 0.13, 0.06, px, y + h / 2 - 0.065, z + 0.005, band));
  }
  if (mark) {
    s.push(cyl(h * 0.24, h * 0.24, 0.02, 12, x, y + 0.05, z + 0.04, band, [Math.PI / 2, 0, 0]));
    s.push(box(h * 0.28, 0.07, 0.02, x, y + 0.05, z + 0.055, color));
  }
  return s;
}

/** A hanging chōchin lantern; returns { parts, glow } so callers can channel it. */
function lantern(x, y, z, { r = 0.25, h = 0.5, color = P.lantern, drop = 0.35 } = {}) {
  return {
    parts: [
      box(0.035, drop, 0.035, x, y + h / 2 + drop / 2, z, C.black),
      cyl(r * 0.55, r * 0.55, 0.07, 10, x, y + h / 2, z, C.black),
      cyl(r * 0.55, r * 0.55, 0.06, 10, x, y - h / 2, z, C.black),
      box(0.05, 0.14, 0.05, x, y - h / 2 - 0.09, z, C.black),
    ],
    glow: [
      cyl(r, r * 0.9, h * 0.46, 10, x, y + h * 0.24, z, color),
      cyl(r * 0.9, r, h * 0.46, 10, x, y - h * 0.24, z, color),
    ],
  };
}

/** A run of framed windows across a facade band. */
function windowBand(w, x, y, z, { n = 4, ww = 1.1, wh = 1.3, frame = P.timberD, glass = C.glass } = {}) {
  const s = [];
  for (let i = 0; i < n; i++) {
    const wx = x - w / 2 + (w / n) * (i + 0.5);
    s.push(box(ww + 0.14, wh + 0.14, 0.08, wx, y, z, frame));
    s.push(box(ww, wh, 0.06, wx, y, z + 0.03, glass));
    s.push(box(0.05, wh, 0.07, wx, y, z + 0.05, frame));
    s.push(box(ww + 0.24, 0.09, 0.16, wx, y - wh / 2 - 0.12, z + 0.03, frame));  // sill
  }
  return s;
}

/** A simple balcony with a slatted rail. */
function balcony(w, x, y, z, d = 1.0, { col = P.timberD, deck = C.wood, bars = 8 } = {}) {
  const s = [
    box(w, 0.12, d, x, y, z + d / 2, deck),
    box(w + 0.1, 0.1, 0.1, x, y + 0.85, z + d, col),
    box(w + 0.1, 0.08, 0.1, x, y + 0.45, z + d, col),
  ];
  for (let i = 0; i < bars; i++) {
    s.push(box(0.06, 0.85, 0.07, x - w / 2 + (w / (bars - 1)) * i, y + 0.42, z + d, col));
  }
  s.push(box(0.08, 0.9, 0.08, x - w / 2, y + 0.45, z + d / 2, col));
  s.push(box(0.08, 0.9, 0.08, x + w / 2, y + 0.45, z + d / 2, col));
  return s;
}

/** A low garden wall with a tiled coping. */
function gardenWall(w, d, x, z, { h = 1.1, col = P.plaster, cap = P.tile, gap = 1.6 } = {}) {
  const s = [];
  const side = (w - gap) / 2;
  for (const sx of [-1, 1]) {
    const cx = x + sx * (gap / 2 + side / 2);
    s.push(box(side, h, 0.24, cx, h / 2, z + d / 2, col));
    s.push(box(side + 0.1, 0.13, 0.36, cx, h + 0.06, z + d / 2, cap));
  }
  s.push(box(0.24, h, d, x - w / 2, h / 2, z, col));
  s.push(box(0.36, 0.13, d + 0.1, x - w / 2, h + 0.06, z, cap));
  s.push(box(0.24, h, d, x + w / 2, h / 2, z, col));
  s.push(box(0.36, 0.13, d + 0.1, x + w / 2, h + 0.06, z, cap));
  // Gate posts + a low timber gate.
  for (const sx of [-1, 1]) {
    s.push(box(0.24, h + 0.4, 0.3, x + sx * gap / 2, (h + 0.4) / 2, z + d / 2, P.timberD));
    s.push(cyl(0.0, 0.2, 0.22, 4, x + sx * gap / 2, h + 0.5, z + d / 2, cap));
  }
  s.push(box(gap - 0.24, 0.9, 0.08, x, 0.5, z + d / 2, C.wood));
  return s;
}

// ---------------------------------------------------------------------------
// Sign artwork (procedural canvases — zero external assets)
// ---------------------------------------------------------------------------

const JP_FONT = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans JP","Meiryo",system-ui,sans-serif';

/**
 * The player shop's sign motif — identical at every tier so the business stays
 * recognisable as it grows: a cream paper panel in a timber frame, a muted-red
 * disc bearing 寿, two little cat ears, and the name.
 */
export function makeSushiSign({ vertical = true, name = 'CATOSHI' } = {}) {
  const W = vertical ? 128 : 384;
  const H = vertical ? 384 : 112;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  // Neon-purple brand board (Slice City / pic 3 stall vibe).
  const PURPLE = '#6b2d8a', CREAM = '#f8e8d0', FRAME = '#3a1848', NEON = '#ff7a9a';

  ctx.fillStyle = FRAME; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = CREAM; ctx.fillRect(9, 9, W - 18, H - 18);
  ctx.fillStyle = PURPLE;
  ctx.fillRect(9, 9, W - 18, 16);
  ctx.fillRect(9, H - 25, W - 18, 16);

  // House mark: purple disc with paw + cat ears.
  const cr = vertical ? W * 0.32 : H * 0.32;
  const cx = vertical ? W / 2 : 60;
  const cy = vertical ? 34 + cr : H / 2;
  ctx.fillStyle = PURPLE;
  ctx.beginPath(); ctx.arc(cx, cy, cr, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - cr * 0.72, cy - cr * 0.6); ctx.lineTo(cx - cr * 0.34, cy - cr * 1.12); ctx.lineTo(cx - cr * 0.1, cy - cr * 0.86);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + cr * 0.72, cy - cr * 0.6); ctx.lineTo(cx + cr * 0.34, cy - cr * 1.12); ctx.lineTo(cx + cr * 0.1, cy - cr * 0.86);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = CREAM;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `900 ${Math.round(cr * 1.05)}px ${JP_FONT}`;
  ctx.fillText('寿', cx, cy + cr * 0.06);

  ctx.fillStyle = NEON;
  if (vertical) {
    const chars = ['キ', 'ャ', 'ツ'];
    const top = 34 + cr * 2 + 26;
    const cell = (H - top - 34) / chars.length;
    ctx.font = `800 ${Math.round(Math.min(cell * 0.72, W * 0.5))}px ${JP_FONT}`;
    for (let i = 0; i < chars.length; i++) ctx.fillText(chars[i], W / 2, top + cell * (i + 0.5));
  } else {
    ctx.textAlign = 'left';
    ctx.font = `800 30px ${JP_FONT}`;
    ctx.fillStyle = PURPLE;
    ctx.fillText(name, 108, H / 2 - 12);
    ctx.font = `700 22px ${JP_FONT}`;
    ctx.fillStyle = NEON;
    ctx.fillText('TOKYO KITCHEN', 108, H / 2 + 20);
  }
  return finish(canvas, { tiled: false });
}

/** A plain, non-branded shop board: coloured panel, glyph block, roman label. */
export function makeBuildingSign(label = 'SHOP', { bg = '#7a2c2c', fg = '#f6ecd8', accent = '#d94f4f', kana = '' } = {}) {
  const W = 384, H = 96;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = accent; ctx.lineWidth = 7; ctx.strokeRect(5, 5, W - 10, H - 10);
  ctx.textBaseline = 'middle';
  if (kana) {
    ctx.fillStyle = accent;
    ctx.fillRect(18, 18, 60, H - 36);
    ctx.fillStyle = fg; ctx.textAlign = 'center';
    ctx.font = `900 40px ${JP_FONT}`;
    ctx.fillText(kana[0], 48, H / 2 + 2);
  }
  ctx.fillStyle = fg; ctx.textAlign = 'left';
  ctx.font = `bold 42px ${JP_FONT}`;
  ctx.fillText(label, kana ? 96 : 28, H / 2 + 2);
  return finish(canvas, { tiled: false });
}

// ===========================================================================
// TOWN BUILDINGS
// ===========================================================================

/**
 * A machiya — the classic narrow two-storey wooden townhouse-shop: timber posts,
 * a koshi lattice street front, plastered upper floor with a mushikomado window,
 * deep tiled eaves, noren and a hanging lantern.
 */
export function buildMachiya(opts = {}) {
  const {
    width = 8, storeys = 2, wallColor = P.plaster, roofColor = P.tile, awning = true,
    accent = P.vermillion,
  } = opts;
  const w = width, d = 6.4, hw = w / 2, hd = d / 2;
  const h = storeys * STOREY;
  const s = [];
  const g = [];

  // Shell
  s.push(box(w, h, d, 0, h / 2, 0, wallColor));
  s.push(box(w + 0.24, 0.4, d + 0.24, 0, 0.2, 0, P.stoneD));                 // stone plinth
  // Corner + intermediate timber posts on the street face.
  for (const px of [-hw + 0.12, -hw / 3, hw / 3, hw - 0.12]) {
    s.push(box(0.22, h, 0.22, px, h / 2, hd + 0.02, P.timberD));
  }
  s.push(box(w + 0.16, 0.26, 0.3, 0, STOREY - 0.1, hd + 0.06, P.timberD));   // floor band
  s.push(box(w + 0.16, 0.2, 0.26, 0, h - 0.16, hd + 0.06, P.timberD));       // head band

  // Ground floor: a wide shop opening with a lattice screen + sliding door.
  s.push(box(w - 0.9, 2.9, 0.4, 0, 1.5, hd - 0.05, P.ink));                  // recessed shopfront
  s.push(...koshi(w * 0.42, 2.5, -w * 0.22, 1.45, hd + 0.14));
  s.push(...shoji(1.3, 2.4, w * 0.2, 1.24, hd + 0.14, { cols: 2, rows: 4 }));
  s.push(box(1.5, 0.16, 0.5, w * 0.2, 0.1, hd + 0.32, P.stone));             // door step
  s.push(box(w - 0.9, 0.2, 0.3, 0, 2.98, hd + 0.16, P.timberD));             // lintel
  g.push(box(w * 0.4, 2.3, 0.06, -w * 0.22, 1.45, hd - 0.02, P.paperWarm));  // warm interior
  g.push(box(1.2, 2.2, 0.05, w * 0.2, 1.2, hd - 0.02, P.paperWarm));

  // Upper floor: plaster wall with a barred mushikomado window + a small rail.
  if (storeys >= 2) {
    const uy = STOREY + 1.5;
    s.push(box(w * 0.56, 1.5, 0.16, -w * 0.12, uy, hd + 0.06, P.ink));
    for (let i = 0; i < 9; i++) {
      s.push(box(0.07, 1.36, 0.1, -w * 0.12 - w * 0.26 + (w * 0.52 / 8) * i, uy, hd + 0.13, P.plaster));
    }
    s.push(box(w * 0.6, 0.12, 0.24, -w * 0.12, uy + 0.8, hd + 0.12, P.timberD));
    s.push(box(w * 0.6, 0.12, 0.24, -w * 0.12, uy - 0.8, hd + 0.12, P.timberD));
    s.push(...shoji(1.5, 1.6, w * 0.28, uy, hd + 0.08, { cols: 3, rows: 3 }));
    g.push(box(1.34, 1.44, 0.05, w * 0.28, uy, hd + 0.02, P.paperWarm));
    s.push(box(1.9, 0.1, 0.5, w * 0.28, uy - 0.9, hd + 0.24, P.timberD));    // window shelf
    for (let i = 0; i < 6; i++) s.push(box(0.06, 0.5, 0.06, w * 0.28 - 0.8 + i * 0.32, uy - 0.62, hd + 0.42, P.timberD));
  }

  // Side wall plaster panels so flanks aren't blank.
  for (const sx of [-1, 1]) {
    s.push(box(0.1, h * 0.5, d * 0.7, sx * (hw + 0.04), h * 0.32, -0.4, P.timber));
  }

  // Deep tiled roof + a small pent roof over the shopfront.
  s.push(...tiledGable(w, d, 0, h, 0, { col: roofColor, ridge: P.tileD, rise: 1.15, over: 0.72, ribs: Math.max(5, Math.round(w / 1.2)) }));
  s.push(box(w + 0.5, 0.14, 1.2, 0, STOREY + 0.12, hd + 0.55, roofColor, [-0.3, 0, 0]));
  s.push(box(w + 0.56, 0.14, 0.16, 0, STOREY - 0.14, hd + 1.12, P.tileD));

  // Textiles + signage.
  s.push(...noren(w * 0.42, 0.95, -w * 0.22, 2.42, hd + 0.3, { color: accent }));
  if (awning) s.push(...stripedAwning(w * 0.42, w * 0.2, 2.9, hd + 0.1, { color: accent, depth: 1.1, stripes: 4 }));
  for (const lx of [-hw + 0.7, hw - 0.7]) {
    const L = lantern(lx, 2.55, hd + 0.5, { color: P.lantern });
    s.push(...L.parts); g.push(...L.glow);
  }
  s.push(box(0.5, 1.9, 0.16, hw - 0.05, 2.0, hd + 0.5, P.timberD));          // vertical sign board
  s.push(box(0.9, 0.16, 0.16, hw - 0.05, 2.95, hd + 0.5, P.timberD));

  return {
    structure: merge(s),
    glow: merge(g),
    sign: { x: -w * 0.22, y: h - 0.05, z: hd + 0.3, w: w * 0.5, h: 0.75 },
    signTex: makeBuildingSign('MACHIYA', { bg: '#5b4a3a', accent: '#d9b06a', kana: '町' }),
    collider: { cx: 0, cz: 0, w: w + 0.3, d: d + 0.3, h: h + 1.2 },
  };
}

/** An open-front market stall with a striped awning and goods on the counter. */
export function buildMarketStall(opts = {}) {
  const { awningColor = P.vermillion, goods = 'veg' } = opts;
  const w = 4.6, d = 3.0, hw = w / 2, hd = d / 2, top = 2.7;
  const s = [];
  const g = [];

  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    s.push(box(0.16, top, 0.16, sx * (hw - 0.12), top / 2, sz * (hd - 0.12), P.timberD));
  }
  s.push(box(w, 0.15, 0.15, 0, top, hd - 0.12, P.timberD));
  s.push(box(w, 0.15, 0.15, 0, top, -hd + 0.12, P.timberD));
  s.push(box(0.15, 0.15, d, hw - 0.12, top, 0, P.timberD));
  s.push(box(0.15, 0.15, d, -hw + 0.12, top, 0, P.timberD));
  s.push(box(w - 0.2, 0.15, d - 0.5, 0, 0.08, -0.2, C.wood));                // duckboard floor
  s.push(box(w - 0.3, 2.0, 0.12, 0, 1.0, -hd + 0.1, P.plaster));             // back panel
  s.push(box(w - 0.6, 0.12, 0.36, 0, 1.9, -hd + 0.26, C.wood));              // back shelf

  // Counter
  s.push(box(w - 0.2, 0.16, 1.3, 0, 1.06, hd - 0.75, C.wood));
  s.push(box(w - 0.3, 0.9, 0.12, 0, 0.55, hd - 0.14, P.timberD));
  s.push(box(w - 0.1, 0.08, 1.42, 0, 1.16, hd - 0.75, '#9a6a3f'));

  // Awning
  s.push(...stripedAwning(w + 0.3, 0, top + 0.1, hd - 0.1, { color: awningColor, depth: 1.7, stripes: 7 }));

  // Goods vary by trade.
  const piles = [-1.4, 0, 1.4];
  if (goods === 'fish') {
    for (const px of piles) {
      s.push(box(1.1, 0.24, 0.9, px, 1.26, hd - 0.75, '#c8ccc4'));
      s.push(box(0.98, 0.1, 0.8, px, 1.42, hd - 0.75, P.ice));
      for (const o of [-0.24, 0.02, 0.26]) {
        s.push(cyl(0.05, 0.1, 0.46, 8, px + o, 1.5, hd - 0.75, P.fish, [Math.PI / 2, o * 2, 0]));
      }
    }
  } else if (goods === 'rice') {
    for (const px of piles) {
      for (let i = 0; i < 2; i++) s.push(box(0.8, 0.42, 0.6, px, 1.36 + i * 0.44, hd - 0.75, '#e6dcbe'));
      s.push(box(0.5, 0.1, 0.42, px, 1.8, hd - 0.72, P.vermillionD));
    }
  } else if (goods === 'sweets') {
    for (const px of piles) {
      s.push(box(1.0, 0.5, 0.8, px, 1.4, hd - 0.75, C.cream));
      for (let i = 0; i < 3; i++) s.push(box(0.24, 0.16, 0.24, px - 0.3 + i * 0.3, 1.73, hd - 0.75, i % 2 ? P.blossom : '#f0e0a8'));
      s.push(box(1.06, 0.06, 0.86, px, 1.68, hd - 0.75, C.glass));
    }
  } else {
    for (const px of piles) {
      s.push(box(1.06, 0.34, 0.84, px, 1.31, hd - 0.75, C.wood));
      s.push(blob(0.22, px - 0.24, 1.62, hd - 0.8, C.orange));
      s.push(blob(0.2, px + 0.2, 1.6, hd - 0.66, C.orange));
      s.push(blob(0.18, px, 1.66, hd - 0.86, C.green));
      s.push(blob(0.15, px - 0.06, 1.72, hd - 0.62, C.leaf));
    }
  }

  // Price boards + a lantern.
  s.push(box(1.5, 0.6, 0.06, 0, 1.9, -hd + 0.34, P.charcoal));
  for (const my of [2.02, 1.86, 1.7]) s.push(box(1.0, 0.06, 0.03, 0, my, -hd + 0.38, C.cream));
  const L = lantern(hw - 0.5, top - 0.5, hd - 0.25);
  s.push(...L.parts); g.push(...L.glow);
  g.push(box(w - 0.6, 0.1, 1.2, 0, top - 0.14, hd - 0.7, P.paperWarm));      // counter worklight

  return {
    structure: merge(s),
    glow: merge(g),
    sign: { x: 0, y: top + 0.55, z: hd + 1.32, w: 2.6, h: 0.65 },
    signTex: makeBuildingSign(goods.toUpperCase(), { bg: '#5b4a3a', accent: awningColor, kana: '市' }),
    collider: { cx: 0, cz: 0, w: w + 0.3, d: d + 0.3, h: top + 0.6 },
  };
}

/** A tea house: a low pavilion with an engawa veranda and shoji screens. */
export function buildTeaHouse() {
  const w = 7.4, d = 6.2, hw = w / 2, hd = d / 2, h = 3.3;
  const s = [];
  const g = [];

  s.push(box(w + 1.6, 0.3, d + 1.6, 0, 0.15, 0.2, P.stoneD));                // stone base
  s.push(box(w, h, d, 0, h / 2 + 0.3, 0, P.plaster));
  // Engawa (the raised timber veranda running along the street face).
  s.push(box(w + 1.2, 0.22, 1.5, 0, 0.52, hd + 0.75, C.wood));
  s.push(box(w + 1.2, 0.12, 0.16, 0, 0.4, hd + 1.5, P.timberD));
  for (let i = 0; i < 7; i++) s.push(box(0.08, 0.34, 0.08, -w / 2 - 0.5 + i * ((w + 1) / 6), 0.24, hd + 1.42, P.timberD));
  // Shoji screen wall onto the veranda.
  for (let i = 0; i < 3; i++) s.push(...shoji(1.9, 2.3, -2.1 + i * 2.1, 1.85, hd + 0.06, { cols: 3, rows: 4 }));
  for (let i = 0; i < 3; i++) g.push(box(1.76, 2.16, 0.05, -2.1 + i * 2.1, 1.85, hd - 0.02, P.paperWarm));
  // Timber posts + head beam.
  for (const px of [-hw + 0.1, -1.05, 1.05, hw - 0.1]) s.push(box(0.18, 2.9, 0.18, px, 1.75, hd + 0.14, P.timberD));
  s.push(box(w + 0.4, 0.24, 0.3, 0, 3.28, hd + 0.14, P.timberD));
  // Side windows.
  s.push(...windowBand(d * 0.6, 0, 2.2, 0, { n: 2, ww: 0.9, wh: 1.1 }).map((geo) => { geo.rotateY(Math.PI / 2); geo.translate(-hw - 0.02, 0, 0); return geo; }));

  // Low hipped roof: a wide gable with a second, smaller ridge over the entry.
  s.push(...tiledGable(w + 0.6, d + 0.4, 0, h + 0.3, 0, { col: P.tile, ridge: P.tileD, rise: 1.25, over: 1.0, ribs: 7 }));
  s.push(box(3.0, 0.14, 1.5, 0, 3.15, hd + 1.0, P.tile, [-0.34, 0, 0]));     // entry pent roof
  s.push(box(3.1, 0.16, 0.18, 0, 2.9, hd + 1.66, P.tileD));

  // Textiles, lanterns, a stone basin and a bonsai on the veranda.
  s.push(...noren(2.0, 0.9, 0, 2.55, hd + 0.38, { color: '#4e7f8f', band: C.cream, panels: 3 }));
  for (const lx of [-2.6, 2.6]) {
    const L = lantern(lx, 2.7, hd + 1.1, { color: '#f0a24a' });
    s.push(...L.parts); g.push(...L.glow);
  }
  s.push(cyl(0.4, 0.44, 0.5, 10, hw + 0.9, 0.25, hd + 0.4, P.stoneD));       // tsukubai basin
  s.push(cyl(0.3, 0.3, 0.06, 10, hw + 0.9, 0.52, hd + 0.4, P.seafoam));
  s.push(cyl(0.05, 0.06, 0.7, 6, hw + 1.3, 0.35, hd + 0.4, P.pine, [0.3, 0, 0]));
  s.push(box(0.6, 0.14, 0.42, -hw + 0.8, 0.7, hd + 0.9, '#6a5240'));         // bonsai tray
  s.push(cyl(0.05, 0.07, 0.3, 6, -hw + 0.8, 0.92, hd + 0.9, C.wood));
  s.push(cyl(0.24, 0.24, 0.09, 8, -hw + 0.72, 1.12, hd + 0.9, P.pine));
  s.push(cyl(0.17, 0.17, 0.08, 8, -hw + 0.94, 1.24, hd + 0.86, P.pine));

  return {
    structure: merge(s),
    glow: merge(g),
    sign: { x: 0, y: 3.6, z: hd + 1.6, w: 2.8, h: 0.7 },
    signTex: makeBuildingSign('TEA HOUSE', { bg: '#3f5f52', accent: '#8fae7a', kana: '茶' }),
    collider: { cx: 0, cz: 0.3, w: w + 1.4, d: d + 1.8, h: h + 1.9 },
  };
}

/** A small convenience store: bright glowing glass front, simple flat sign. */
export function buildKonbini() {
  const w = 8.6, d = 6.0, hw = w / 2, hd = d / 2, h = 3.9;
  const s = [];
  const g = [];
  const neon = [];

  s.push(box(w, h, d, 0, h / 2, 0, P.plasterCool));
  s.push(box(w + 0.2, 0.3, d + 0.2, 0, 0.15, 0, P.stoneD));
  s.push(...flatRoof(w, d, 0, h, 0, { slab: P.stoneD, band: P.plasterCool }));
  // The signature horizontal colour band across the parapet.
  s.push(box(w + 0.5, 0.5, 0.14, 0, h + 0.42, hd + 0.2, '#3f8f6a'));
  s.push(box(w + 0.5, 0.16, 0.16, 0, h + 0.6, hd + 0.22, '#e07a3a'));
  s.push(box(w + 0.5, 0.16, 0.16, 0, h + 0.24, hd + 0.22, '#e07a3a'));

  // Full-width glazed front in a metal frame.
  s.push(box(w - 0.5, 2.9, 0.14, 0, 1.65, hd + 0.02, C.metalDark));
  for (let i = 0; i < 4; i++) s.push(box(0.12, 2.9, 0.2, -w / 2 + 0.6 + i * ((w - 1.2) / 3), 1.65, hd + 0.08, C.metalDark));
  s.push(box(w - 0.7, 0.14, 0.2, 0, 3.06, hd + 0.08, C.metalDark));
  s.push(box(w - 0.7, 0.16, 0.2, 0, 0.24, hd + 0.08, C.metalDark));
  g.push(box(w - 0.8, 2.6, 0.06, 0, 1.65, hd - 0.02, '#fff0cf'));            // lit interior
  // Shelving and a fridge run visible through the glass.
  for (let i = 0; i < 3; i++) {
    s.push(box(1.4, 1.4, 0.5, -2.4 + i * 2.4, 1.0, hd - 0.9, C.steel));
    for (let r = 0; r < 3; r++) s.push(box(1.3, 0.07, 0.44, -2.4 + i * 2.4, 0.5 + r * 0.42, hd - 0.9, '#e0c88a'));
  }
  s.push(box(2.2, 2.3, 0.5, hw - 1.6, 1.35, -hd + 0.4, C.steel));
  g.push(box(2.0, 2.0, 0.1, hw - 1.6, 1.35, -hd + 0.68, '#cfe8f2'));         // fridge glow

  // Entrance: sliding doors under a small canopy.
  s.push(box(2.0, 2.5, 0.22, -w * 0.06, 1.35, hd + 0.14, C.metalDark));
  s.push(box(0.9, 2.3, 0.1, -w * 0.06 - 0.5, 1.3, hd + 0.2, C.glass));
  s.push(box(0.9, 2.3, 0.1, -w * 0.06 + 0.5, 1.3, hd + 0.2, C.glass));
  s.push(box(2.6, 0.16, 1.0, -w * 0.06, 2.72, hd + 0.6, '#3f8f6a'));
  s.push(box(1.6, 0.2, 0.4, -w * 0.06, 0.1, hd + 0.6, P.stone));

  // Forecourt: bollards, a bin and a small ice cabinet.
  for (const bx of [-hw + 0.6, hw - 0.6]) {
    s.push(cyl(0.11, 0.13, 0.8, 8, bx, 0.4, hd + 1.3, C.metal));
    s.push(cyl(0.13, 0.13, 0.09, 8, bx, 0.78, hd + 1.3, '#e07a3a'));
  }
  s.push(box(1.2, 1.0, 0.8, hw - 1.2, 0.5, hd + 0.9, C.cream));
  g.push(box(1.0, 0.7, 0.06, hw - 1.2, 0.62, hd + 1.32, '#bfe8f2'));
  neon.push(box(w - 1.0, 0.34, 0.06, 0, h + 0.42, hd + 0.3, '#ffe9a8'));     // lit fascia strip

  return {
    structure: merge(s),
    glow: merge(g),
    neon: merge(neon),
    sign: { x: 0, y: h + 0.42, z: hd + 0.34, w: w - 1.4, h: 0.62 },
    signTex: makeBuildingSign('24H STORE', { bg: '#2f6a52', accent: '#e07a3a', kana: '店' }),
    collider: { cx: 0, cz: 0, w: w + 0.3, d: d + 0.3, h: h + 0.9 },
  };
}

/** A clean low-rise office block, 3–6 storeys, with banded glazing. */
export function buildOfficeBlock(opts = {}) {
  const { storeys = 4, width = 11, depth = 8.5, wallColor = '#dcd8cd', accent = '#4e7f9a' } = opts;
  const w = width, d = depth, hw = w / 2, hd = d / 2;
  const n = Math.max(3, Math.min(6, storeys));
  const h = n * STOREY;
  const s = [];
  const g = [];

  s.push(box(w, h, d, 0, h / 2, 0, wallColor));
  s.push(box(w + 0.3, 0.5, d + 0.3, 0, 0.25, 0, P.stoneD));                  // plinth
  s.push(...flatRoof(w, d, 0, h, 0, { slab: P.stoneD, band: wallColor }));
  // Roof plant + a small planted terrace (cozy, not corporate).
  s.push(box(2.2, 0.9, 1.8, -hw + 2.0, h + 0.7, -hd + 1.6, C.steel));
  s.push(box(2.3, 0.12, 1.9, -hw + 2.0, h + 1.2, -hd + 1.6, C.metalDark));
  s.push(box(2.6, 0.4, 0.7, hw - 2.2, h + 0.5, hd - 1.2, C.wood));
  s.push(blob(0.4, hw - 2.6, h + 0.9, hd - 1.2, P.moss));
  s.push(blob(0.34, hw - 1.8, h + 0.86, hd - 1.2, P.sage));

  // Glazed bands, front + sides, with a spandrel below each.
  for (let f = 0; f < n; f++) {
    const by = f * STOREY + STOREY * 0.62;
    s.push(box(w - 0.8, 1.5, 0.12, 0, by, hd + 0.02, C.metalDark));
    s.push(box(w - 1.0, 1.3, 0.1, 0, by, hd + 0.08, C.glass));
    s.push(box(w + 0.16, 0.24, 0.3, 0, by - 0.9, hd + 0.06, accent));        // sill band
    for (let i = 1; i < 4; i++) s.push(box(0.1, 1.3, 0.16, -w / 2 + (w / 4) * i, by, hd + 0.12, wallColor));
    if (f > 0) g.push(box(w - 1.1, 1.2, 0.05, 0, by, hd - 0.02, '#ffe6b4'));
    for (const sx of [-1, 1]) {
      s.push(box(0.12, 1.4, d - 1.0, sx * (hw + 0.02), by, 0, C.metalDark));
      s.push(box(0.08, 1.2, d - 1.4, sx * (hw + 0.08), by, 0, C.glass));
      if (f % 2 === 0) g.push(box(0.05, 1.1, d - 1.6, sx * (hw - 0.02), by, 0, '#ffe6b4'));
    }
  }
  // Vertical accent pilasters.
  for (const px of [-hw + 0.25, hw - 0.25]) s.push(box(0.4, h, 0.4, px, h / 2, hd - 0.2, accent));

  // Entrance: a glass lobby under a flat canopy, with steps.
  s.push(box(3.4, 3.0, 0.24, 0, 1.55, hd + 0.06, C.metalDark));
  s.push(box(3.0, 2.6, 0.14, 0, 1.45, hd + 0.14, C.glass));
  s.push(box(0.1, 2.6, 0.2, 0, 1.45, hd + 0.18, C.metalDark));
  g.push(box(3.0, 2.4, 0.06, 0, 1.4, hd - 0.02, '#ffeecb'));
  s.push(box(4.4, 0.22, 1.6, 0, 3.35, hd + 0.7, accent));
  s.push(box(4.4, 0.12, 0.12, 0, 3.2, hd + 1.46, C.metalDark));
  s.push(box(4.6, 0.18, 1.2, 0, 0.09, hd + 0.9, P.stone));
  s.push(box(4.2, 0.18, 0.9, 0, 0.27, hd + 0.75, P.stone));
  // A planter and a small bike rack out front.
  s.push(box(1.6, 0.5, 0.7, -hw + 1.4, 0.25, hd + 1.1, C.wood));
  s.push(blob(0.3, -hw + 1.0, 0.62, hd + 1.1, P.sage));
  s.push(blob(0.26, -hw + 1.8, 0.6, hd + 1.1, P.moss));

  return {
    structure: merge(s),
    glow: merge(g),
    sign: { x: 0, y: 3.9, z: hd + 0.3, w: 3.2, h: 0.6 },
    signTex: makeBuildingSign('OFFICES', { bg: '#2f4f60', accent: '#7fb0c8', kana: '会' }),
    collider: { cx: 0, cz: 0, w: w + 0.4, d: d + 0.4, h: h + 1.4 },
  };
}

/** A compact station: platform, canopy on columns, ticket gates and a sign. */
export function buildTrainStation() {
  const w = 14, d = 9, hw = w / 2, hd = d / 2;
  const s = [];
  const g = [];

  // Platform slab (rear) + tactile edge strip.
  s.push(box(w + 2, 0.75, 3.6, 0, 0.375, -hd - 0.6, P.stone));
  s.push(box(w + 2, 0.08, 0.5, 0, 0.78, -hd - 2.2, '#e0b13a'));
  s.push(box(w + 2, 0.4, 0.3, 0, 0.2, -hd - 2.45, P.stoneD));
  // Concourse building.
  s.push(box(w, 3.9, d - 3.0, 0, 1.95, 0.6, P.plaster));
  s.push(box(w + 0.3, 0.36, d - 2.7, 0, 0.18, 0.6, P.stoneD));
  s.push(...flatRoof(w, d - 3.0, 0, 3.9, 0.6, { slab: P.tileD, band: P.plaster }));
  s.push(box(w + 0.6, 0.3, 0.3, 0, 4.3, hd - 1.9, '#3f6a8f'));               // livery band

  // Front canopy on slim columns.
  s.push(box(w + 1.6, 0.24, 3.0, 0, 3.5, hd + 1.0, '#3f6a8f'));
  s.push(box(w + 1.6, 0.16, 0.2, 0, 3.32, hd + 2.45, C.metalDark));
  for (const cx of [-hw + 0.6, -2.5, 2.5, hw - 0.6]) {
    s.push(cyl(0.16, 0.18, 3.4, 8, cx, 1.7, hd + 2.2, C.metalDark));
    s.push(box(0.34, 0.34, 0.34, cx, 3.36, hd + 2.2, C.metalDark));
  }
  // Entrance opening + glazed screens.
  s.push(box(4.6, 2.8, 0.3, 0, 1.5, hd - 1.4, P.ink));
  g.push(box(4.4, 2.6, 0.06, 0, 1.45, hd - 1.55, '#ffeecb'));
  for (const sx of [-1, 1]) {
    s.push(box(3.6, 2.6, 0.14, sx * 5.0, 1.6, hd - 1.42, C.metalDark));
    s.push(box(3.3, 2.3, 0.1, sx * 5.0, 1.6, hd - 1.36, C.glass));
    g.push(box(3.2, 2.2, 0.05, sx * 5.0, 1.6, hd - 1.5, '#ffeecb'));
  }
  // Ticket gates in the entrance mouth.
  for (let i = 0; i < 3; i++) {
    const gx = -1.6 + i * 1.6;
    s.push(box(0.36, 1.0, 1.5, gx, 0.5, hd - 0.6, C.steel));
    s.push(box(0.42, 0.1, 1.6, gx, 1.02, hd - 0.6, C.metalDark));
    g.push(box(0.2, 0.08, 0.3, gx, 1.08, hd - 0.3, '#8ff0a8'));
  }
  // Clock, benches and a departure board.
  s.push(cyl(0.5, 0.5, 0.16, 14, 0, 3.0, hd - 1.6, C.cream, [Math.PI / 2, 0, 0]));
  s.push(cyl(0.55, 0.55, 0.1, 14, 0, 3.0, hd - 1.68, C.metalDark, [Math.PI / 2, 0, 0]));
  s.push(box(0.05, 0.34, 0.04, 0, 3.12, hd - 1.5, P.ink));
  s.push(box(0.3, 0.05, 0.04, 0.1, 3.0, hd - 1.5, P.ink));
  s.push(box(3.2, 0.9, 0.12, -4.6, 2.9, hd - 1.4, P.ink));
  g.push(box(3.0, 0.75, 0.05, -4.6, 2.9, hd - 1.32, '#8fd6ff'));
  for (const bx of [-5.4, 5.4]) {
    s.push(box(1.7, 0.1, 0.5, bx, 0.45, hd + 1.6, C.wood));
    s.push(box(1.7, 0.5, 0.08, bx, 0.72, hd + 1.35, C.wood));
    s.push(box(0.1, 0.45, 0.5, bx - 0.75, 0.22, hd + 1.6, C.metalDark));
    s.push(box(0.1, 0.45, 0.5, bx + 0.75, 0.22, hd + 1.6, C.metalDark));
  }
  // Platform lamps.
  for (const lx of [-hw + 1.5, hw - 1.5]) {
    s.push(cyl(0.08, 0.1, 2.6, 8, lx, 2.05, -hd - 1.2, C.metalDark));
    s.push(box(0.7, 0.14, 0.34, lx, 3.35, -hd - 1.2, C.metalDark));
    g.push(box(0.6, 0.08, 0.26, lx, 3.26, -hd - 1.2, P.paperWarm));
  }

  return {
    structure: merge(s),
    glow: merge(g),
    sign: { x: 0, y: 4.35, z: hd + 2.5, w: 5.0, h: 0.85 },
    signTex: makeBuildingSign('STATION', { bg: '#1b3a52', accent: '#7fb0c8', kana: '駅' }),
    collider: { cx: 0, cz: -0.2, w: w + 2.2, d: d + 4.0, h: 4.6 },
  };
}

/** A harbour warehouse: corrugated roof, big sliding doors, loading dock. */
export function buildWarehouse() {
  const w = 15, d = 10.5, hw = w / 2, hd = d / 2, h = 5.4;
  const s = [];
  const g = [];

  s.push(box(w, h, d, 0, h / 2, 0, '#c8cbc2'));
  s.push(box(w + 0.3, 0.6, d + 0.3, 0, 0.3, 0, P.stoneD));
  s.push(...corrugatedRoof(w, d, 0, h, 0, { col: '#9aa5a0', rib: '#6f7a76', rise: 1.5, over: 0.6, ribs: 18 }));
  // Wall ribs so the big flat sides read as sheet metal.
  for (let i = 0; i < 12; i++) {
    const rx = -hw + (w / 12) * (i + 0.5);
    s.push(box(0.1, h - 0.4, 0.08, rx, h / 2, hd + 0.04, '#aeb5ae'));
    s.push(box(0.1, h - 0.4, 0.08, rx, h / 2, -hd - 0.04, '#aeb5ae'));
  }
  s.push(box(w + 0.2, 0.3, d + 0.2, 0, h - 0.5, 0, '#6f7a76'));              // eave band

  // Two big sliding doors with X bracing, on a track.
  for (const dx of [-3.4, 3.4]) {
    s.push(box(6.0, 4.2, 0.2, dx, 2.2, hd + 0.06, '#7f8f95'));
    s.push(box(6.0, 0.18, 0.26, dx, 4.3, hd + 0.1, C.metalDark));
    s.push(box(0.2, 4.2, 0.26, dx - 2.9, 2.2, hd + 0.1, C.metalDark));
    s.push(box(0.2, 4.2, 0.26, dx + 2.9, 2.2, hd + 0.1, C.metalDark));
    s.push(box(6.6, 0.16, 0.24, dx, 2.2, hd + 0.12, C.metalDark, [0, 0, 0.62]));
    s.push(box(6.6, 0.16, 0.24, dx, 2.2, hd + 0.12, C.metalDark, [0, 0, -0.62]));
  }
  s.push(box(w - 0.4, 0.26, 0.34, 0, 4.5, hd + 0.16, C.metalDark));          // door track
  // Loading dock + steps + bollards.
  s.push(box(w - 1.0, 1.1, 2.2, 0, 0.55, hd + 1.2, P.stoneD));
  s.push(box(w - 1.0, 0.1, 0.4, 0, 1.13, hd + 2.2, '#e0b13a'));
  s.push(box(2.2, 0.36, 0.7, -hw + 2.0, 0.18, hd + 2.5, P.stone));
  for (const bx of [-hw + 0.8, hw - 0.8]) s.push(cyl(0.18, 0.2, 0.7, 8, bx, 0.35, hd + 2.7, '#e07a3a'));
  // Ventilators + high strip windows.
  for (const vx of [-4.5, 0, 4.5]) {
    s.push(cyl(0.42, 0.42, 0.5, 10, vx, h + 1.7, 0, C.metalDark));
    s.push(cyl(0.6, 0.36, 0.24, 10, vx, h + 2.05, 0, '#6f7a76'));
  }
  for (let i = 0; i < 5; i++) {
    const wx = -hw + 1.6 + i * ((w - 3.2) / 4);
    s.push(box(1.5, 0.9, 0.1, wx, h - 1.1, hd + 0.06, C.metalDark));
    s.push(box(1.3, 0.7, 0.06, wx, h - 1.1, hd + 0.1, C.glass));
    g.push(box(1.25, 0.65, 0.05, wx, h - 1.1, hd - 0.02, '#ffe6b4'));
  }
  // Stacked crates and a pallet beside the dock.
  for (let i = 0; i < 3; i++) {
    s.push(box(1.1, 0.8, 0.9, hw - 2.2, 1.5 + i * 0.84, hd + 1.2, C.wood));
    s.push(box(1.14, 0.08, 0.94, hw - 2.2, 1.9 + i * 0.84, hd + 1.2, P.timberD));
  }

  return {
    structure: merge(s),
    glow: merge(g),
    sign: { x: 0, y: 4.9, z: hd + 0.22, w: 4.4, h: 0.8 },
    signTex: makeBuildingSign('WAREHOUSE', { bg: '#3a4a52', accent: '#8fa5ae', kana: '倉' }),
    collider: { cx: 0, cz: 0.6, w: w + 0.4, d: d + 2.6, h: h + 2.4 },
  };
}

/** A small timber dock shed on stilts, with nets and buoys. */
export function buildDockShed() {
  const w = 6.0, d = 5.0, hw = w / 2, hd = d / 2, h = 3.2, deck = 0.7;
  const s = [];
  const g = [];

  // Piled deck.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    s.push(cyl(0.17, 0.19, deck + 1.2, 8, sx * (hw - 0.35), (deck - 1.2) / 2 + 0.2, sz * (hd - 0.35), C.wood));
  }
  s.push(box(w + 1.2, 0.22, d + 1.2, 0, deck, 0.3, C.wood));
  for (let i = 0; i < 9; i++) s.push(box(w + 1.2, 0.06, 0.1, 0, deck + 0.13, -hd - 0.3 + i * ((d + 1.2) / 8), P.timberD));

  // Shed shell in weathered board.
  s.push(box(w, h, d, 0, deck + h / 2, 0, '#b8a98c'));
  for (let i = 0; i < 8; i++) s.push(box(0.09, h, 0.08, -hw + (w / 8) * (i + 0.5), deck + h / 2, hd + 0.05, P.timberD));
  s.push(box(w + 0.1, 0.16, d + 0.1, 0, deck + h - 0.1, 0, P.timberD));
  s.push(...corrugatedRoof(w, d, 0, deck + h, 0, { col: '#8f9a92', rib: '#6b756e', rise: 0.85, over: 0.5, ribs: 9 }));

  // Door + window + a lamp over the door.
  s.push(box(1.4, 2.4, 0.14, -1.2, deck + 1.2, hd + 0.05, P.timberD));
  s.push(box(1.2, 2.2, 0.08, -1.2, deck + 1.2, hd + 0.11, C.wood));
  s.push(box(1.5, 1.2, 0.12, 1.4, deck + 1.9, hd + 0.05, P.timberD));
  s.push(box(1.3, 1.0, 0.08, 1.4, deck + 1.9, hd + 0.1, C.glass));
  g.push(box(1.25, 0.95, 0.05, 1.4, deck + 1.9, hd - 0.02, '#ffe6b4'));
  s.push(box(0.34, 0.16, 0.34, -1.2, deck + 2.6, hd + 0.3, C.metalDark));
  g.push(cyl(0.14, 0.18, 0.16, 8, -1.2, deck + 2.48, hd + 0.3, P.lanternLit));

  // Nets, floats and a stack of fish crates on the deck.
  s.push(box(1.6, 0.5, 0.1, hw - 1.0, deck + 1.5, hd + 0.12, '#9aa88f'));
  for (const [bx, by] of [[hw - 1.5, 1.1], [hw - 0.9, 0.9], [hw - 0.4, 1.3]]) {
    s.push(blob(0.24, bx, deck + by, hd + 0.2, i2c(bx)));
  }
  for (let i = 0; i < 2; i++) {
    s.push(box(0.9, 0.4, 0.66, -hw + 0.1, deck + 0.32 + i * 0.44, hd + 0.9, '#c8ccc4'));
    s.push(box(0.94, 0.07, 0.7, -hw + 0.1, deck + 0.5 + i * 0.44, hd + 0.9, '#9aa199'));
  }
  s.push(cyl(0.28, 0.28, 0.12, 10, hw - 0.6, deck + 0.18, hd + 1.0, P.rope));
  s.push(cyl(0.17, 0.17, 0.1, 10, hw - 0.6, deck + 0.28, hd + 1.0, P.rope));

  return {
    structure: merge(s),
    glow: merge(g),
    sign: { x: 0, y: deck + h + 0.5, z: hd + 0.6, w: 3.0, h: 0.6 },
    signTex: makeBuildingSign('DOCK SHED', { bg: '#33525c', accent: '#8fb9bd', kana: '港' }),
    collider: { cx: 0, cz: 0.3, w: w + 1.4, d: d + 1.4, h: deck + h + 1.2 },
  };
}

// A tiny helper so the dock-shed floats aren't all the same colour.
function i2c(v) {
  const cols = ['#e0713a', '#e0c05a', '#6f9ab0'];
  return cols[Math.abs(Math.round(v * 3)) % cols.length];
}

/** A small suburban home with a tiled roof and a walled front garden. */
export function buildHouse(opts = {}) {
  const { wallColor = P.plaster, roofColor = P.tileWarm, garden = true } = opts;
  const w = 7.2, d = 6.4, hw = w / 2, hd = d / 2, h = 4.6;
  const s = [];
  const g = [];

  s.push(box(w, h, d, 0, h / 2, 0, wallColor));
  s.push(box(w + 0.24, 0.34, d + 0.24, 0, 0.17, 0, P.stoneD));
  s.push(box(w + 0.1, 0.22, d + 0.1, 0, 2.5, 0, P.timberD));                 // string course
  s.push(...tiledGable(w, d, 0, h, 0, { col: roofColor, ridge: P.tileD, rise: 1.5, over: 0.65, ribs: 7 }));
  // A little dormer-style gablet over the entry.
  s.push(box(2.6, 1.0, 0.3, -1.2, h + 0.5, hd + 0.45, wallColor));
  s.push(box(2.9, 0.14, 1.1, -1.2, h + 1.05, hd + 0.6, roofColor, [-0.42, 0, 0]));

  // Entry: recessed genkan door with a small pent roof.
  s.push(box(1.5, 2.5, 0.24, -1.2, 1.25, hd + 0.02, P.timberD));
  s.push(box(1.3, 2.3, 0.12, -1.2, 1.2, hd + 0.12, C.wood));
  s.push(box(0.1, 0.34, 0.1, -0.75, 1.2, hd + 0.2, C.metalDark));
  s.push(box(2.2, 0.14, 0.9, -1.2, 2.7, hd + 0.4, roofColor, [-0.32, 0, 0]));
  s.push(box(1.9, 0.16, 0.7, -1.2, 0.08, hd + 0.4, P.stone));
  // Windows: a broad shoji-glazed window and two upper ones.
  s.push(...shoji(2.4, 1.6, 1.6, 1.7, hd + 0.06, { cols: 4, rows: 2 }));
  g.push(box(2.2, 1.44, 0.05, 1.6, 1.7, hd - 0.02, P.paperWarm));
  s.push(box(2.9, 0.14, 0.5, 1.6, 0.86, hd + 0.2, P.timberD));               // window box
  s.push(blob(0.2, 1.0, 1.02, hd + 0.28, P.blossom));
  s.push(blob(0.18, 2.2, 1.0, hd + 0.28, P.sage));
  for (const ux of [-1.6, 1.6]) {
    s.push(...windowBand(1.4, ux, 3.5, hd + 0.06, { n: 1, ww: 1.1, wh: 1.0 }));
    g.push(box(1.0, 0.9, 0.05, ux, 3.5, hd - 0.02, P.paperWarm));
  }
  // Side wall window + an AC unit so flanks aren't blank.
  s.push(box(0.12, 1.0, 1.2, hw + 0.02, 2.4, -0.8, P.timberD));
  s.push(box(0.08, 0.8, 1.0, hw + 0.08, 2.4, -0.8, C.glass));
  s.push(box(0.36, 0.5, 0.7, hw + 0.2, 1.2, 1.4, C.steel));

  if (garden) {
    s.push(...gardenWall(w + 2.4, d + 2.6, 0, -0.2, { h: 1.0, col: wallColor, cap: roofColor, gap: 1.8 }));
    // Garden: gravel, stepping stones, a shrub, a small pine and a lantern.
    s.push(box(w + 1.8, 0.06, 2.2, 0, 0.03, hd + 1.9, '#ded6c0'));
    for (let i = 0; i < 3; i++) s.push(cyl(0.3, 0.3, 0.08, 8, -1.2, 0.08, hd + 1.0 + i * 0.8, P.stone));
    s.push(blob(0.5, 1.8, 0.5, hd + 1.9, P.moss));
    s.push(blob(0.34, 2.5, 0.42, hd + 1.6, P.sage));
    s.push(cyl(0.1, 0.15, 1.1, 6, -2.5, 0.55, hd + 1.9, '#6b5238'));
    s.push(cyl(0.5, 0.55, 0.18, 10, -2.5, 1.25, hd + 1.9, P.pine));
    s.push(cyl(0.36, 0.4, 0.16, 10, -2.2, 1.5, hd + 1.8, P.pine));
    s.push(cyl(0.24, 0.28, 0.12, 8, 2.9, 0.06, hd + 2.2, P.stoneD));
    s.push(cyl(0.09, 0.1, 0.4, 8, 2.9, 0.28, hd + 2.2, P.stone));
    s.push(cyl(0.2, 0.16, 0.24, 6, 2.9, 0.6, hd + 2.2, P.stone));
    s.push(cyl(0.32, 0.22, 0.16, 6, 2.9, 0.78, hd + 2.2, P.stoneD));
    g.push(cyl(0.11, 0.11, 0.12, 8, 2.9, 0.6, hd + 2.2, P.lanternLit));
    // Mailbox by the gate.
    s.push(cyl(0.09, 0.1, 0.9, 8, 1.1, 0.45, hd + 3.0, P.timberD));
    s.push(box(0.4, 0.28, 0.24, 1.1, 1.02, hd + 3.0, P.vermillion));
  }

  return {
    structure: merge(s),
    glow: merge(g),
    collider: { cx: 0, cz: garden ? 0.6 : 0, w: w + (garden ? 2.6 : 0.3), d: d + (garden ? 3.0 : 0.3), h: h + 1.8 },
  };
}

/** A three-storey walk-up: exterior stair, balconies, laundry poles, AC units. */
export function buildApartment(opts = {}) {
  const { storeys = 3, wallColor = '#e4dcc8', accent = '#8fa5ae' } = opts;
  const n = Math.max(2, Math.min(4, storeys));
  const w = 11, d = 7.5, hw = w / 2, hd = d / 2;
  const h = n * STOREY;
  const s = [];
  const g = [];

  s.push(box(w, h, d, 0, h / 2, 0, wallColor));
  s.push(box(w + 0.26, 0.4, d + 0.26, 0, 0.2, 0, P.stoneD));
  s.push(...flatRoof(w, d, 0, h, 0, { slab: P.stoneD, band: wallColor }));
  s.push(box(w + 0.4, 0.2, 0.24, 0, h + 0.75, hd + 0.16, accent));
  // Water tank + aerial on the roof.
  s.push(box(1.8, 1.0, 1.4, hw - 2.0, h + 1.0, -hd + 1.4, C.steel));
  for (const tx of [-0.7, 0.7]) for (const tz of [-0.5, 0.5]) {
    s.push(box(0.14, 0.55, 0.14, hw - 2.0 + tx, h + 0.32, -hd + 1.4 + tz, C.metalDark));
  }
  s.push(cyl(0.05, 0.05, 1.8, 6, -hw + 1.2, h + 1.3, -hd + 1.0, C.metalDark));

  // Per-floor: a walkway/balcony strip, doors, windows, laundry poles.
  for (let f = 0; f < n; f++) {
    const fy = f * STOREY;
    s.push(...balcony(w - 1.6, -0.6, fy + 0.06 + (f ? 0 : 0.12), hd, 1.1, { col: accent, deck: P.stone, bars: 12 }));
    for (let u = 0; u < 3; u++) {
      const ux = -3.4 + u * 3.0;
      // Door + a window per unit.
      s.push(box(1.2, 2.3, 0.16, ux - 0.55, fy + 1.2, hd + 0.02, P.timberD));
      s.push(box(1.0, 2.1, 0.1, ux - 0.55, fy + 1.15, hd + 0.08, '#9a6a3f'));
      s.push(box(0.08, 0.28, 0.08, ux - 0.15, fy + 1.15, hd + 0.14, C.metalDark));
      s.push(box(1.3, 1.4, 0.14, ux + 0.85, fy + 1.75, hd + 0.02, P.timberD));
      s.push(box(1.15, 1.25, 0.08, ux + 0.85, fy + 1.75, hd + 0.08, C.glass));
      if ((f + u) % 2 === 0) g.push(box(1.1, 1.2, 0.05, ux + 0.85, fy + 1.75, hd - 0.02, '#ffe6b4'));
      // Laundry pole + two hanging cloths on the balcony rail.
      if (f > 0 && u !== 1) {
        s.push(cyl(0.035, 0.035, 1.6, 6, ux + 0.3, fy + 1.9, hd + 1.0, C.metalDark, [0, 0, Math.PI / 2]));
        s.push(box(0.4, 0.7, 0.03, ux - 0.1, fy + 1.5, hd + 1.0, C.cream));
        s.push(box(0.34, 0.55, 0.03, ux + 0.6, fy + 1.58, hd + 1.0, '#8fb9bd'));
      }
      // AC unit clipped to the wall between units.
      if (u < 2) s.push(box(0.7, 0.5, 0.3, ux + 1.6, fy + 2.9, hd + 0.16, C.steel));
    }
    // Side windows.
    for (const sx of [-1, 1]) {
      s.push(box(0.12, 1.1, 1.4, sx * (hw + 0.02), fy + 1.9, -1.2, P.timberD));
      s.push(box(0.08, 0.95, 1.2, sx * (hw + 0.08), fy + 1.9, -1.2, C.glass));
    }
  }

  // Exterior stair up the left flank, with landings.
  for (let f = 0; f < n - 1; f++) {
    const y0 = f * STOREY, y1 = (f + 1) * STOREY;
    const rise = y1 - y0, run = 3.2;
    const ang = Math.atan2(rise, run);
    const len = Math.hypot(rise, run);
    s.push(box(1.3, 0.2, len, -hw - 0.75, (y0 + y1) / 2, hd - 1.2 - run / 2, P.stone, [-ang, 0, 0]));
    for (let st = 0; st < 8; st++) {
      const u = (st + 0.5) / 8;
      s.push(box(1.2, 0.12, 0.3, -hw - 0.75, y0 + rise * u + 0.12, hd - 1.2 - run * u, P.stoneD));
    }
    s.push(box(0.09, 0.95, len, -hw - 1.36, (y0 + y1) / 2 + 0.55, hd - 1.2 - run / 2, accent, [-ang, 0, 0]));
    s.push(box(1.4, 0.22, 1.4, -hw - 0.75, y1 + 0.05, hd - 0.6, P.stone));
  }
  for (const cx of [hd - 0.6, hd - 4.4]) s.push(cyl(0.11, 0.13, h, 8, -hw - 1.3, h / 2, cx, accent));
  // Ground-floor bike parking + bins.
  s.push(box(2.6, 0.08, 1.4, hw - 2.0, 0.04, hd + 1.6, P.stone));
  for (let i = 0; i < 3; i++) s.push(box(0.07, 0.6, 0.07, hw - 2.8 + i * 0.8, 0.3, hd + 1.6, C.metal));
  for (let i = 0; i < 2; i++) s.push(cyl(0.26, 0.24, 0.7, 10, -hw + 1.4 + i * 0.65, 0.35, hd + 1.4, i ? '#4f8f6a' : '#4f7fa8'));

  return {
    structure: merge(s),
    glow: merge(g),
    collider: { cx: -0.4, cz: 0.2, w: w + 2.4, d: d + 1.4, h: h + 1.6 },
  };
}

/** A yatai — the night food cart on wheels, with a fabric roof and stools. */
export function buildYatai() {
  const w = 3.6, d = 2.2, hw = w / 2, hd = d / 2;
  const s = [];
  const g = [];
  const neon = [];

  // Cart body + wheels + handle.
  for (const wx of [-1, 1]) {
    s.push(cyl(0.32, 0.32, 0.1, 12, wx * (hw - 0.35), 0.32, -0.35, P.timberD, [0, 0, Math.PI / 2]));
    s.push(cyl(0.09, 0.09, 0.14, 8, wx * (hw - 0.35), 0.32, -0.35, C.metalDark, [0, 0, Math.PI / 2]));
  }
  s.push(box(w - 0.2, 0.14, d - 0.3, 0, 0.62, -0.05, P.timberD));
  s.push(box(w - 0.3, 0.9, d - 0.6, 0, 1.14, -0.2, C.wood));
  s.push(box(w, 0.14, d - 0.2, 0, 1.64, -0.15, '#9a6a3f'));                  // counter top
  s.push(box(0.1, 0.1, 1.0, hw - 0.1, 0.62, hd + 0.5, P.timberD, [0.25, 0, 0]));
  s.push(box(0.1, 0.1, 1.0, -hw + 0.1, 0.62, hd + 0.5, P.timberD, [0.25, 0, 0]));
  s.push(box(w - 0.1, 0.09, 0.09, 0, 0.86, hd + 0.95, P.timberD));           // pull handle

  // Four corner posts + fabric roof.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    s.push(box(0.09, 1.5, 0.09, sx * (hw - 0.12), 2.4, sz * (hd - 0.15), P.timberD));
  }
  s.push(box(w + 0.5, 0.12, d + 0.7, 0, 3.16, 0, P.vermillion));
  s.push(box(w + 0.6, 0.34, 0.1, 0, 2.95, hd + 0.35, P.vermillionD));
  s.push(box(w + 0.6, 0.34, 0.1, 0, 2.95, -hd - 0.35, P.vermillionD));
  s.push(box(0.1, 0.34, d + 0.7, hw + 0.25, 2.95, 0, P.vermillionD));
  s.push(box(0.1, 0.34, d + 0.7, -hw - 0.25, 2.95, 0, P.vermillionD));
  // Noren strip across the back and a menu board.
  s.push(...noren(w - 0.4, 0.75, 0, 2.35, -hd + 0.02, { color: P.vermillion, panels: 3 }));
  s.push(box(1.1, 0.8, 0.05, -hw + 0.7, 2.3, hd + 0.02, P.charcoal));
  for (const my of [2.5, 2.3, 2.1]) s.push(box(0.8, 0.05, 0.02, -hw + 0.7, my, hd + 0.06, C.cream));

  // Cooking kit on the counter: pot, kettle, bowls, bottles.
  s.push(cyl(0.36, 0.32, 0.42, 12, -0.9, 1.92, -0.3, C.metalDark));
  s.push(cyl(0.38, 0.38, 0.07, 12, -0.9, 2.16, -0.3, C.steel));
  s.push(cyl(0.2, 0.23, 0.28, 10, 0.9, 1.85, -0.5, C.metalDark));
  for (const bx of [-0.1, 0.5, 1.2]) {
    s.push(cyl(0.16, 0.11, 0.11, 10, bx, 1.76, 0.3, C.cream));
    s.push(cyl(0.12, 0.08, 0.02, 10, bx, 1.83, 0.3, P.vermillionD));
  }
  for (let i = 0; i < 4; i++) s.push(cyl(0.06, 0.07, 0.28, 6, -1.5 + i * 0.3, 1.85, -0.65, ['#3a6ea5', '#5aa85f', '#c0392b', '#e0b13a'][i]));

  // Stools out front.
  for (const sx of [-1.0, 0.0, 1.0]) {
    s.push(cyl(0.22, 0.22, 0.09, 10, sx, 0.6, hd + 0.7, P.timberD));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      s.push(box(0.05, 0.55, 0.05, sx + Math.cos(a) * 0.13, 0.3, hd + 0.7 + Math.sin(a) * 0.13, C.metalDark));
    }
  }

  // Red lanterns + a warm glow under the roof.
  for (const lx of [-1.3, 0, 1.3]) {
    const L = lantern(lx, 2.5, hd + 0.42, { r: 0.22, h: 0.46 });
    s.push(...L.parts); neon.push(...L.glow);
  }
  g.push(box(w - 0.2, 0.1, d - 0.2, 0, 3.02, -0.1, P.paperWarm));
  g.push(box(w - 0.6, 0.9, 0.05, 0, 2.35, -hd + 0.1, P.paperWarm));

  return {
    structure: merge(s),
    glow: merge(g),
    neon: merge(neon),
    sign: { x: 0, y: 2.72, z: hd + 0.46, w: 2.0, h: 0.5 },
    signTex: makeBuildingSign('YATAI', { bg: '#7a2c2c', accent: '#e8492b', kana: '屋' }),
    steamAnchor: { x: -0.9, y: 2.3, z: -0.3 },
    collider: { cx: 0, cz: 0, w: w + 0.6, d: d + 1.6, h: 3.3 },
  };
}

/** A narrow neon-lit izakaya front — the classic alley restaurant. */
export function buildIzakaya() {
  const w = 6.4, d = 7.0, hw = w / 2, hd = d / 2, h = 2 * STOREY;
  const s = [];
  const g = [];
  const neon = [];

  s.push(box(w, h, d, 0, h / 2, 0, '#5b4a3a'));
  s.push(box(w + 0.22, 0.36, d + 0.22, 0, 0.18, 0, P.stoneD));
  s.push(...tiledGable(w, d, 0, h, 0, { col: P.tileD, ridge: P.ink, rise: 0.9, over: 0.55, ribs: 5 }));
  // Dark timber street front with a lit counter window.
  s.push(box(w - 0.4, 3.1, 0.3, 0, 1.6, hd - 0.05, P.ink));
  s.push(...koshi(2.4, 2.2, -1.5, 1.5, hd + 0.14, { bars: 11 }));
  s.push(box(2.2, 2.4, 0.16, 1.5, 1.35, hd + 0.1, P.timberD));
  s.push(box(2.0, 2.2, 0.1, 1.5, 1.35, hd + 0.16, C.glass));
  g.push(box(1.95, 2.1, 0.05, 1.5, 1.35, hd + 0.02, '#ffe0a0'));
  g.push(box(2.3, 2.0, 0.05, -1.5, 1.5, hd + 0.02, '#ffd08a'));
  s.push(box(w - 0.2, 0.24, 0.4, 0, 3.25, hd + 0.16, P.timberD));            // lintel
  s.push(box(w + 0.3, 0.16, 1.1, 0, 3.5, hd + 0.55, P.tileD, [-0.32, 0, 0]));// pent roof
  // Door + noren + a small step.
  s.push(box(1.4, 2.3, 0.2, 1.5, 1.15, hd + 0.2, P.timberD));
  s.push(...noren(w - 1.0, 0.9, 0, 2.72, hd + 0.42, { color: '#2f3a4a', band: '#e8c46a', panels: 4 }));
  s.push(box(1.8, 0.16, 0.5, 1.5, 0.08, hd + 0.5, P.stone));
  // Upper floor: two shoji windows behind a timber rail.
  for (const ux of [-1.5, 1.5]) {
    s.push(...shoji(1.9, 1.7, ux, STOREY + 1.6, hd + 0.06, { cols: 3, rows: 3 }));
    g.push(box(1.75, 1.55, 0.05, ux, STOREY + 1.6, hd - 0.02, P.paperWarm));
  }
  s.push(box(w + 0.2, 0.12, 0.3, 0, STOREY + 0.5, hd + 0.16, P.timberD));
  for (let i = 0; i < 10; i++) s.push(box(0.06, 0.55, 0.08, -hw + 0.4 + i * ((w - 0.8) / 9), STOREY + 0.8, hd + 0.2, P.timberD));

  // Signage: a projecting vertical neon board + a lantern row + wall lamps.
  s.push(box(0.9, 3.4, 0.24, hw + 0.35, 4.2, hd - 1.4, P.ink));
  neon.push(box(0.7, 3.0, 0.1, hw + 0.5, 4.2, hd - 1.4, '#ff5f8f'));
  neon.push(box(0.16, 3.2, 0.12, hw + 0.52, 4.2, hd - 1.4, '#18e0ff'));
  for (const lx of [-2.2, -0.7, 0.7, 2.2]) {
    const L = lantern(lx, 3.05, hd + 0.75, { r: 0.22, h: 0.46 });
    s.push(...L.parts); neon.push(...L.glow);
  }
  neon.push(box(w - 0.6, 0.14, 0.1, 0, 3.62, hd + 0.34, '#ffd45a'));
  // Alley clutter: crates and a bottle rack.
  s.push(box(0.8, 0.8, 0.6, -hw + 0.6, 0.4, hd + 1.2, C.wood));
  s.push(box(0.84, 0.08, 0.64, -hw + 0.6, 0.82, hd + 1.2, P.timberD));
  for (let i = 0; i < 4; i++) s.push(cyl(0.07, 0.08, 0.34, 6, -hw + 0.3 + i * 0.2, 1.03, hd + 1.2, i % 2 ? '#4f7f4f' : '#7a5230'));

  return {
    structure: merge(s),
    glow: merge(g),
    neon: merge(neon),
    sign: { x: 0, y: 3.28, z: hd + 0.34, w: w - 1.2, h: 0.7 },
    signTex: makeBuildingSign('IZAKAYA', { bg: '#22232c', accent: '#e8492b', kana: '居' }),
    collider: { cx: 0, cz: 0, w: w + 0.4, d: d + 0.4, h: h + 1.2 },
  };
}

/** A festival booth: striped canopy, prize shelves and a lantern pair. */
export function buildFestivalStall(opts = {}) {
  const { canopyColor = '#e0508f', game = 'goldfish' } = opts;
  const w = 4.0, d = 2.6, hw = w / 2, hd = d / 2, top = 2.55;
  const s = [];
  const g = [];
  const neon = [];

  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    s.push(box(0.12, top, 0.12, sx * (hw - 0.1), top / 2, sz * (hd - 0.1), P.timberD));
  }
  s.push(box(w, 0.12, 0.12, 0, top, hd - 0.1, P.timberD));
  s.push(box(w, 0.12, 0.12, 0, top, -hd + 0.1, P.timberD));
  s.push(box(w - 0.2, 1.9, 0.1, 0, 0.95, -hd + 0.05, C.cream));              // back board
  s.push(box(w - 0.1, 0.16, 1.1, 0, 1.0, hd - 0.6, C.wood));                 // counter
  s.push(box(w - 0.2, 0.85, 0.1, 0, 0.5, hd - 0.06, canopyColor));           // painted apron
  s.push(box(w - 0.2, 0.14, 0.12, 0, 0.94, hd - 0.06, C.cream));

  // Striped canopy with a scalloped valance.
  s.push(...stripedAwning(w + 0.5, 0, top + 0.05, hd - 0.1, { color: canopyColor, alt: C.cream, depth: 1.6, stripes: 7 }));
  s.push(box(w + 0.5, 0.1, d + 0.4, 0, top + 0.28, -0.4, canopyColor));
  s.push(box(w + 0.55, 0.28, 0.09, 0, top + 0.1, -hd - 0.18, C.cream));

  // The game itself.
  if (game === 'goldfish') {
    s.push(box(2.6, 0.4, 1.0, 0, 1.28, hd - 0.6, '#9ad6e0'));
    s.push(box(2.7, 0.06, 1.1, 0, 1.5, hd - 0.6, '#bfe8f2'));
    for (const fx of [-0.8, -0.2, 0.5, 1.0]) s.push(blob(0.09, fx, 1.36, hd - 0.6 + (fx % 0.3), '#f08a3a'));
    for (const px of [-1.6, 1.6]) {
      s.push(cyl(0.05, 0.05, 0.5, 6, px, 1.62, hd - 0.5, P.timberD, [0.5, 0, 0]));
      s.push(cyl(0.13, 0.13, 0.03, 10, px, 1.86, hd - 0.28, C.cream, [0.5, 0, 0]));
    }
  } else {
    for (let r = 0; r < 3; r++) {
      s.push(box(w - 0.6, 0.08, 0.3, 0, 1.3 + r * 0.5, -hd + 0.28, C.wood));
      for (let i = 0; i < 4; i++) s.push(box(0.28, 0.3, 0.22, -1.3 + i * 0.86, 1.5 + r * 0.5, -hd + 0.28, ['#f0913a', '#e0508f', '#5aa85f', '#e8c46a'][i]));
    }
  }
  // Lanterns + a strip of little flags.
  for (const lx of [-hw + 0.4, hw - 0.4]) {
    const L = lantern(lx, top - 0.45, hd + 0.15, { r: 0.2, h: 0.42, color: '#f0742f' });
    s.push(...L.parts); neon.push(...L.glow);
  }
  for (let i = 0; i < 7; i++) {
    s.push(box(0.26, 0.22, 0.02, -hw + 0.3 + i * ((w - 0.6) / 6), top - 0.16, hd + 0.62, i % 2 ? C.cream : canopyColor));
  }
  g.push(box(w - 0.4, 0.1, 1.0, 0, top - 0.06, hd - 0.5, P.paperWarm));

  return {
    structure: merge(s),
    glow: merge(g),
    neon: merge(neon),
    sign: { x: 0, y: 1.75, z: -hd + 0.12, w: 2.6, h: 0.6 },
    signTex: makeBuildingSign('MATSURI', { bg: '#8f2f5a', accent: '#f0c05a', kana: '祭' }),
    collider: { cx: 0, cz: 0, w: w + 0.4, d: d + 0.4, h: top + 0.6 },
  };
}

/** A sentō bathhouse: karahafu entry gable, tall chimney, split noren. */
export function buildBathhouse() {
  const w = 11.5, d = 8.5, hw = w / 2, hd = d / 2, h = 4.6;
  const s = [];
  const g = [];

  s.push(box(w, h, d, 0, h / 2, 0, P.plaster));
  s.push(box(w + 0.3, 0.5, d + 0.3, 0, 0.25, 0, P.stoneD));
  s.push(box(w + 0.2, 0.24, d + 0.2, 0, 2.6, 0, P.timberD));
  s.push(...tiledGable(w, d, 0, h, 0, { col: P.tile, ridge: P.tileD, rise: 1.7, over: 0.8, ribs: 10 }));

  // The grand entry: a projecting porch with a curved (karahafu) gable.
  s.push(box(5.4, 3.4, 1.6, 0, 1.7, hd + 0.7, P.plaster));
  s.push(box(5.8, 0.16, 2.1, 0, 3.5, hd + 0.9, P.tile, [-0.3, 0, 0]));
  // Curved gable built from three stepped, tilted boards.
  s.push(box(4.6, 0.9, 0.24, 0, 4.15, hd + 1.5, P.tileD));
  s.push(box(3.4, 0.55, 0.26, 0, 4.6, hd + 1.5, P.tileD));
  s.push(box(1.9, 0.4, 0.28, 0, 4.92, hd + 1.5, P.tileD));
  s.push(box(4.9, 0.16, 0.3, 0, 3.66, hd + 1.56, P.timberD));
  s.push(box(0.5, 0.4, 0.3, 0, 5.16, hd + 1.5, '#e0b13a'));                  // gilt finial
  for (const sx of [-1, 1]) s.push(box(1.0, 0.26, 0.26, sx * 2.5, 4.28, hd + 1.5, P.tileD, [0, 0, -sx * 0.3]));
  // Porch posts + the split noren (men / women).
  for (const px of [-2.4, 2.4]) s.push(box(0.24, 3.3, 0.24, px, 1.65, hd + 1.42, P.timberD));
  s.push(box(5.2, 0.24, 0.3, 0, 3.42, hd + 1.42, P.timberD));
  s.push(...noren(2.0, 1.0, -1.2, 2.6, hd + 1.5, { color: '#3f6a9a', panels: 2, mark: true }));
  s.push(...noren(2.0, 1.0, 1.2, 2.6, hd + 1.5, { color: '#c8503f', panels: 2, mark: true }));
  s.push(box(5.0, 0.18, 1.0, 0, 0.09, hd + 1.9, P.stone));
  g.push(box(4.6, 2.2, 0.06, 0, 1.7, hd + 1.38, P.paperWarm));

  // Frosted high windows down the flanks + a plaster panel band.
  for (let i = 0; i < 5; i++) {
    const wx = -hw + 1.5 + i * ((w - 3) / 4);
    if (Math.abs(wx) < 2.9) continue;
    s.push(box(1.4, 1.3, 0.12, wx, 3.4, hd + 0.02, P.timberD));
    s.push(box(1.2, 1.1, 0.08, wx, 3.4, hd + 0.08, '#cfe8f2'));
    g.push(box(1.15, 1.05, 0.05, wx, 3.4, hd - 0.02, '#ffeecb'));
  }
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      s.push(box(0.12, 1.2, 1.6, sx * (hw + 0.02), 3.2, -2.4 + i * 2.4, P.timberD));
      s.push(box(0.08, 1.0, 1.4, sx * (hw + 0.08), 3.2, -2.4 + i * 2.4, '#cfe8f2'));
    }
  }
  // Boiler chimney at the back.
  s.push(box(1.5, 1.2, 1.5, -hw + 1.8, h + 0.4, -hd + 1.4, P.stoneD));
  s.push(cyl(0.42, 0.5, 5.0, 10, -hw + 1.8, h + 3.4, -hd + 1.4, '#b8ac96'));
  s.push(cyl(0.5, 0.5, 0.3, 10, -hw + 1.8, h + 5.9, -hd + 1.4, P.stoneD));
  s.push(cyl(0.36, 0.36, 0.2, 10, -hw + 1.8, h + 6.1, -hd + 1.4, P.ink));
  // A bench and a couple of plants by the door.
  s.push(box(1.6, 0.1, 0.5, -hw + 1.6, 0.5, hd + 1.6, C.wood));
  for (const bx of [-hw + 1.0, -hw + 2.2]) s.push(box(0.12, 0.44, 0.44, bx, 0.24, hd + 1.6, P.timberD));
  for (const px of [hw - 1.2, hw - 2.2]) {
    s.push(cyl(0.28, 0.22, 0.4, 10, px, 0.2, hd + 1.5, C.terracotta));
    s.push(blob(0.3, px, 0.6, hd + 1.5, P.moss));
  }

  return {
    structure: merge(s),
    glow: merge(g),
    sign: { x: 0, y: 4.3, z: hd + 1.66, w: 3.4, h: 0.7 },
    signTex: makeBuildingSign('SENTO', { bg: '#2f5f7a', accent: '#e8c46a', kana: '湯' }),
    collider: { cx: 0, cz: 0.5, w: w + 0.4, d: d + 2.4, h: h + 2.6 },
  };
}

/** A big open fish-market hall: low roof on columns, auction boards, crates. */
export function buildFishMarketHall() {
  const w = 19, d = 12.5, hw = w / 2, hd = d / 2, h = 4.8;
  const s = [];
  const g = [];

  s.push(box(w + 1.5, 0.3, d + 1.5, 0, 0.15, 0, P.stone));                   // concrete apron
  // Back and side walls only — the street side is open.
  s.push(box(w, h, 0.4, 0, h / 2, -hd, '#dcd6c4'));
  s.push(box(0.4, h, d, -hw, h / 2, 0, '#dcd6c4'));
  s.push(box(0.4, h, d, hw, h / 2, 0, '#dcd6c4'));
  s.push(box(w + 0.6, 0.3, 0.5, 0, h - 0.2, -hd, P.seafoam));
  // Columns down the open front + a mid row.
  for (let i = 0; i < 5; i++) {
    const cx = -hw + 1.5 + i * ((w - 3) / 4);
    s.push(box(0.34, h, 0.34, cx, h / 2, hd - 0.4, P.stone));
    s.push(box(0.5, 0.3, 0.5, cx, h - 0.15, hd - 0.4, P.stoneD));
    s.push(box(0.28, h - 0.4, 0.28, cx, (h - 0.4) / 2, -0.5, P.stone));
  }
  s.push(box(w, 0.36, 0.5, 0, h - 0.18, hd - 0.4, P.stoneD));                // front beam
  s.push(...corrugatedRoof(w + 1.2, d + 1.2, 0, h, 0, { col: '#9aa5a0', rib: '#6f7a76', rise: 1.3, over: 0.8, ribs: 20 }));
  // Roof lights + hanging lamps over the floor.
  for (const lx of [-6, -2, 2, 6]) {
    s.push(box(0.06, 0.9, 0.06, lx, h - 0.5, 1.5, C.metalDark));
    s.push(cyl(0.42, 0.16, 0.28, 10, lx, h - 1.05, 1.5, C.metalDark));
    g.push(cyl(0.3, 0.3, 0.08, 10, lx, h - 1.2, 1.5, P.paperWarm));
  }

  // Auction boards along the back wall.
  for (let i = 0; i < 3; i++) {
    const bx = -6 + i * 6;
    s.push(box(4.4, 2.2, 0.14, bx, 2.6, -hd + 0.28, P.charcoal));
    s.push(box(4.6, 0.14, 0.18, bx, 3.78, -hd + 0.3, P.timberD));
    for (let r = 0; r < 4; r++) s.push(box(3.6, 0.06, 0.03, bx, 3.3 - r * 0.45, -hd + 0.37, C.cream));
    g.push(box(4.0, 1.9, 0.05, bx, 2.6, -hd + 0.36, '#ffe6b4'));
  }
  // Sorting tables + iced crates + a hose reel.
  for (let i = 0; i < 4; i++) {
    const tx = -6.6 + i * 4.4;
    s.push(box(3.0, 0.14, 1.6, tx, 0.9, 1.2, C.steel));
    for (const lx of [-1.3, 1.3]) for (const lz of [-0.6, 0.6]) {
      s.push(box(0.1, 0.9, 0.1, tx + lx, 0.45, 1.2 + lz, C.metalDark));
    }
    s.push(box(2.8, 0.12, 1.4, tx, 1.0, 1.2, P.ice));
    for (const fx of [-0.9, 0, 0.9]) {
      s.push(cyl(0.09, 0.16, 0.75, 8, tx + fx, 1.1, 1.2, P.fish, [Math.PI / 2, fx * 0.6, 0]));
    }
  }
  for (let i = 0; i < 6; i++) {
    const cx2 = -hw + 1.6 + i * 1.3;
    s.push(box(0.95, 0.4, 0.7, cx2, 0.5, -hd + 1.6, '#c8ccc4'));
    s.push(box(0.99, 0.07, 0.74, cx2, 0.72, -hd + 1.6, '#9aa199'));
    if (i % 2) s.push(box(0.95, 0.4, 0.7, cx2, 0.94, -hd + 1.6, '#c8ccc4'));
  }
  s.push(cyl(0.4, 0.4, 0.3, 10, hw - 1.2, 0.9, -hd + 1.2, '#3f6a8f', [0, 0, Math.PI / 2]));
  // Kerb bollards + a puddle-free drain channel out front.
  for (let i = 0; i < 6; i++) s.push(cyl(0.13, 0.15, 0.6, 8, -hw + 1.6 + i * 3.2, 0.3, hd + 1.0, '#e07a3a'));
  s.push(box(w, 0.06, 0.5, 0, 0.31, hd + 0.4, P.stoneD));

  return {
    structure: merge(s),
    glow: merge(g),
    sign: { x: 0, y: h + 0.45, z: hd + 0.6, w: 6.5, h: 1.0 },
    signTex: makeBuildingSign('FISH MARKET', { bg: '#2f5f6a', accent: '#8fb9bd', kana: '魚' }),
    collider: { cx: 0, cz: 0, w: w + 1.6, d: d + 1.6, h: h + 2.0 },
  };
}

// ===========================================================================
// THE PLAYER'S SHOP — five tiers of the same business
// ===========================================================================

/**
 * The player's sushi restaurant. `tier` 1..5 matches SHOP_TIERS in
 * src/data/progression.js:
 *
 *   1 street cart · 2 neighbourhood shop · 3 modern sushi bar
 *   4 premium restaurant · 5 famous destination
 *
 * Every tier keeps the SAME identity — muted red + warm cream, the 寿 disc with
 * cat ears, a timber counter, a red noren — and gets visibly bigger, taller and
 * better appointed. In addition to the usual contract this returns local-space
 * gameplay anchors:
 *
 *   door          {x,z,yaw}     where a customer walks in
 *   counterAnchor {x,y,z}       where the player cooks
 *   queueAnchors  [{x,z}]       the customer queue, nearest the counter first
 *   seatAnchors   [{x,z}]       seats at the counter / in the room
 *   size          {w,d,h}       overall local footprint + height
 */
export function buildSushiShop(tier = 1) {
  const t = Math.max(1, Math.min(5, Math.round(tier)));
  // CATOSHI stall palette — warm timber + lantern reds on purple-city nights (pic 3).
  const RED = '#d94a3a', REDD = '#8f2a2c', CREAM = '#f2e3c2';
  const WOOD = '#6b3f2a', WOODD = '#4a2a1a', PURPLE = '#6b2d8a';
  const s = [];
  const g = [];
  const neon = [];

  // -------------------------------------------------------------------------
  // TIER 1 — Street Sushi Cart (cozy yatai: tiled roof, lanterns, sushi plates)
  // -------------------------------------------------------------------------
  if (t === 1) {
    const w = 3.8, d = 2.8, hw = w / 2, hd = d / 2;
    // Raised timber platform
    s.push(box(w + 0.4, 0.18, d + 0.5, 0, 0.12, -0.05, WOODD));
    s.push(box(w + 0.2, 0.12, d + 0.3, 0, 0.28, -0.05, WOOD));
    // Cart body + open service bay
    s.push(box(w - 0.15, 1.15, d - 0.5, 0, 0.95, -0.2, WOOD));
    s.push(box(w + 0.05, 0.14, d - 0.2, 0, 1.58, -0.1, '#8a5535')); // counter top
    s.push(box(w - 0.3, 0.55, 0.12, 0, 1.25, hd - 0.08, RED));       // front apron
    // Wave crest carving under counter
    s.push(box(w - 0.5, 0.18, 0.08, 0, 0.55, hd - 0.02, WOODD));
    // Back wall shelves + bottles
    s.push(box(w - 0.4, 1.4, 0.12, 0, 1.9, -hd + 0.15, WOODD));
    for (let row = 0; row < 2; row++) {
      s.push(box(w - 0.7, 0.08, 0.22, 0, 1.45 + row * 0.45, -hd + 0.28, '#8a5535'));
      for (let i = 0; i < 5; i++) {
        const bx = -1.2 + i * 0.55;
        s.push(cyl(0.08, 0.07, 0.22 + (i % 2) * 0.08, 8, bx, 1.58 + row * 0.45, -hd + 0.28, ['#c8503f', '#f0e8d0', '#4a7ec8', '#3a8f5a', '#e8b84a'][i]));
      }
    }
    // Glass neta case + sushi plates on counter
    s.push(box(1.55, 0.38, 0.58, -0.85, 1.82, -0.25, '#8a5535'));
    s.push(box(1.48, 0.32, 0.52, -0.85, 1.86, -0.25, C.glass));
    for (let i = 0; i < 4; i++) s.push(box(0.26, 0.1, 0.28, -1.4 + i * 0.38, 1.78, -0.25, ['#e8724f', '#f0a04f', '#e0e0d0', '#e8845f'][i]));
    // Plates of sushi on the service ledge
    for (const px of [-1.1, 0.05, 1.15]) {
      s.push(cyl(0.22, 0.22, 0.04, 12, px, 1.68, hd - 0.55, '#f8f2e6'));
      s.push(box(0.28, 0.08, 0.12, px, 1.74, hd - 0.55, ['#e8724f', '#f0c040', '#2a2a2a'][Math.abs(Math.round(px)) % 3]));
    }
    // Soy bottle + sake
    s.push(cyl(0.07, 0.09, 0.28, 8, -1.55, 1.78, hd - 0.7, '#2a1a12'));
    s.push(cyl(0.08, 0.06, 0.32, 8, 1.55, 1.8, hd - 0.65, '#f0ebe0'));
    s.push(cyl(0.22, 0.2, 0.28, 12, 1.05, 1.78, -0.35, WOODD)); // rice tub
    s.push(cyl(0.18, 0.18, 0.05, 12, 1.05, 1.94, -0.35, CREAM));
    // Posts + tiled gable roof (pic 3)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      s.push(box(0.12, 1.35, 0.12, sx * (hw - 0.15), 2.25, sz * (hd - 0.25), WOODD));
    }
    s.push(...tiledGable(w + 0.6, d + 0.5, 0, 2.95, -0.05, { col: '#5a3a2a', ridge: '#3a2418', rise: 0.85, over: 0.35, ribs: 7 }));
    // Bamboo accent on the side
    s.push(cyl(0.05, 0.05, 1.6, 6, hw + 0.15, 1.4, -0.4, '#6a8f4a'));
    s.push(cyl(0.045, 0.045, 1.4, 6, hw + 0.22, 1.3, -0.55, '#5a7f3a'));
    // Stools + hanging lanterns with paw / sushi motifs
    for (const sx of [-1.0, 1.0]) {
      s.push(cyl(0.22, 0.22, 0.09, 10, sx, 0.62, hd + 0.65, WOOD));
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        s.push(box(0.05, 0.55, 0.05, sx + Math.cos(a) * 0.12, 0.32, hd + 0.65 + Math.sin(a) * 0.12, C.metalDark));
      }
    }
    for (const lx of [-1.35, 1.35]) {
      const L = lantern(lx, 2.45, hd + 0.15, { r: 0.24, h: 0.48, color: '#e85a3a', drop: 0.32 });
      s.push(...L.parts); neon.push(...L.glow);
    }
    g.push(box(w - 0.2, 0.12, d - 0.2, 0, 2.85, -0.1, P.paperWarm));
    g.push(box(1.45, 0.28, 0.48, -0.85, 2.0, -0.25, P.paperWarm));
    // Noren under the eaves + CATOSHI sign
    s.push(...noren(w * 0.55, 0.55, 0, 2.7, -hd + 0.2, { color: PURPLE, band: CREAM, panels: 3 }));
    s.push(box(2.15, 0.55, 0.1, 0, 2.35, hd + 0.22, WOODD));

    return {
      structure: merge(s), glow: merge(g), neon: merge(neon),
      sign: { x: 0, y: 2.35, z: hd + 0.28, w: 2.0, h: 0.48 },
      signTex: makeSushiSign({ vertical: false, name: 'CATOSHI' }),
      steamAnchor: { x: 1.05, y: 2.1, z: -0.35 },
      door: { x: 0, z: hd + 1.0, yaw: 0 },
      counterAnchor: { x: 0.15, y: 1.62, z: -0.15 },
      queueAnchors: [{ x: 0, z: 2.4 }, { x: 0.5, z: 3.3 }, { x: -0.4, z: 4.2 }],
      seatAnchors: [{ x: -1.0, z: hd + 0.65 }, { x: 1.0, z: hd + 0.65 }],
      size: { w: 3.8, d: 2.8, h: 3.6 },
      collider: { cx: 0, cz: -0.1, w: 4.0, d: 3.0, h: 3.6 },
    };
  }

  // -------------------------------------------------------------------------
  // TIER 2 — Neighbourhood Shop
  // -------------------------------------------------------------------------
  if (t === 2) {
    const w = 7.2, d = 6.2, hw = w / 2, hd = d / 2, h = STOREY;
    s.push(box(w, h, d, 0, h / 2, 0, CREAM));
    s.push(box(w + 0.24, 0.34, d + 0.24, 0, 0.17, 0, P.stoneD));
    for (const px of [-hw + 0.14, -0.4, hw - 0.14]) s.push(box(0.2, h, 0.2, px, h / 2, hd + 0.02, P.timberD));
    s.push(box(w + 0.16, 0.24, 0.28, 0, h - 0.14, hd + 0.06, P.timberD));
    s.push(...tiledGable(w, d, 0, h, 0, { col: P.tile, ridge: P.tileD, rise: 1.15, over: 0.6, ribs: 6 }));
    // Serving window (left) — the counter you can see into.
    s.push(box(3.4, 2.2, 0.34, -1.6, 1.85, hd - 0.06, P.ink));
    s.push(box(3.6, 0.16, 0.6, -1.6, 0.85, hd + 0.14, '#9a6a3f'));           // sill counter
    s.push(box(3.6, 0.75, 0.14, -1.6, 0.42, hd + 0.32, C.wood));
    s.push(box(3.6, 0.22, 0.4, -1.6, 3.05, hd + 0.16, P.timberD));
    g.push(box(3.2, 2.0, 0.06, -1.6, 1.9, hd - 0.1, P.paperWarm));
    // Neta display case in the window.
    s.push(box(2.8, 0.4, 0.5, -1.6, 1.14, hd - 0.15, '#9a6a3f'));
    s.push(box(2.7, 0.34, 0.44, -1.6, 1.2, hd - 0.15, C.glass));
    for (let i = 0; i < 6; i++) s.push(box(0.3, 0.12, 0.26, -2.8 + i * 0.48, 1.1, hd - 0.15, ['#e8724f', '#f0a04f', '#e0e0d0', '#e8845f', '#d9705a', '#f2c48a'][i]));
    // Sliding shoji entrance (right).
    s.push(...shoji(1.4, 2.4, 1.9, 1.24, hd + 0.1, { cols: 2, rows: 4 }));
    s.push(box(1.7, 0.2, 0.3, 1.9, 2.56, hd + 0.16, P.timberD));
    s.push(box(1.9, 0.16, 0.55, 1.9, 0.1, hd + 0.36, P.stone));
    g.push(box(1.26, 2.26, 0.05, 1.9, 1.24, hd - 0.02, P.paperWarm));
    // Awning + noren + lanterns.
    s.push(...stripedAwning(4.0, -1.6, 3.1, hd + 0.1, { color: RED, alt: CREAM, depth: 1.3, stripes: 5 }));
    s.push(...noren(1.5, 0.85, 1.9, 2.62, hd + 0.34, { color: RED, band: CREAM, panels: 3 }));
    for (const lx of [-hw + 0.6, hw - 0.6]) {
      const L = lantern(lx, 2.6, hd + 0.55, { r: 0.22, h: 0.46 });
      s.push(...L.parts); neon.push(...L.glow);
    }
    // A little vertical sign board and a menu case.
    s.push(box(0.55, 2.2, 0.18, hw + 0.16, 2.3, hd - 0.8, P.timberD));
    s.push(box(0.9, 0.7, 0.06, -hw + 0.7, 1.6, hd + 0.42, P.charcoal));
    for (const my of [1.78, 1.6, 1.42]) s.push(box(0.66, 0.05, 0.03, -hw + 0.7, my, hd + 0.46, CREAM));
    // Side wall + a planter and two stools out front.
    s.push(box(0.12, 1.1, 1.6, -hw - 0.02, 2.3, -0.6, P.timberD));
    s.push(box(0.08, 0.9, 1.4, -hw - 0.08, 2.3, -0.6, C.glass));
    s.push(box(1.3, 0.45, 0.5, hw - 0.9, 0.22, hd + 1.1, C.wood));
    s.push(blob(0.26, hw - 1.2, 0.56, hd + 1.1, P.moss));
    s.push(blob(0.22, hw - 0.6, 0.54, hd + 1.1, P.sage));
    for (const sx of [-2.6, -0.7]) {
      s.push(cyl(0.2, 0.2, 0.08, 10, sx, 0.56, hd + 0.75, P.timberD));
      s.push(cyl(0.05, 0.06, 0.52, 6, sx, 0.28, hd + 0.75, C.metalDark));
    }

    return {
      structure: merge(s), glow: merge(g), neon: merge(neon),
      sign: { x: hw + 0.16, y: 2.3, z: hd - 0.8, w: 0.5, h: 2.0 },
      signTex: makeSushiSign({ vertical: true }),
      steamAnchor: { x: -1.6, y: 2.2, z: -0.6 },
      door: { x: 1.9, z: hd + 0.5, yaw: 0 },
      counterAnchor: { x: -1.6, y: 1.3, z: -0.9 },
      queueAnchors: [{ x: 1.9, z: hd + 1.4 }, { x: 1.9, z: hd + 2.4 }, { x: 1.2, z: hd + 3.3 }, { x: 2.4, z: hd + 4.2 }],
      seatAnchors: [{ x: -2.6, z: hd + 0.75 }, { x: -0.7, z: hd + 0.75 }, { x: -2.2, z: -1.2 }, { x: -0.9, z: -1.2 }],
      size: { w: 7.2, d: 6.2, h: 4.75 },
      collider: { cx: 0, cz: 0, w: 7.5, d: 6.5, h: 4.9 },
    };
  }

  // -------------------------------------------------------------------------
  // TIER 3 — Modern Sushi Bar
  // -------------------------------------------------------------------------
  if (t === 3) {
    const w = 9.6, d = 7.6, hw = w / 2, hd = d / 2, h = 3.9;
    s.push(box(w, h, d, 0, h / 2, 0, CREAM));
    s.push(box(w + 0.3, 0.4, d + 0.3, 0, 0.2, 0, P.stoneD));
    s.push(...flatRoof(w, d, 0, h, 0, { slab: P.tileD, band: CREAM, lip: 0.5 }));
    // A clerestory box on the roof gives it a second-level silhouette.
    s.push(box(w * 0.5, 1.5, d * 0.55, -0.6, h + 0.9, -0.6, CREAM));
    s.push(...tiledGable(w * 0.52, d * 0.58, -0.6, h + 1.65, -0.6, { col: P.tile, ridge: P.tileD, rise: 0.7, over: 0.45, ribs: 5, rafters: 5 }));
    for (let i = 0; i < 3; i++) {
      s.push(box(1.0, 0.8, 0.1, -2.0 + i * 1.4, h + 1.0, -0.6 + d * 0.28, C.glass));
      g.push(box(0.95, 0.75, 0.05, -2.0 + i * 1.4, h + 1.0, -0.6 + d * 0.26, P.paperWarm));
    }
    // Timber-slat screen band across the upper facade (the modern signature).
    s.push(box(w + 0.2, 0.9, 0.2, 0, 3.35, hd + 0.1, P.timberD));
    for (let i = 0; i < 18; i++) s.push(box(0.16, 0.8, 0.14, -hw + 0.35 + i * ((w - 0.7) / 17), 3.35, hd + 0.2, C.wood));
    // Full-width glazed front with a polished counter behind it.
    s.push(box(w - 0.8, 2.7, 0.16, 0, 1.6, hd + 0.02, P.timberD));
    s.push(box(w - 1.1, 2.5, 0.1, 0, 1.6, hd + 0.08, C.glass));
    for (const mx of [-2.6, 0.6]) s.push(box(0.12, 2.5, 0.16, mx, 1.6, hd + 0.12, P.timberD));
    g.push(box(w - 1.2, 2.4, 0.06, 0, 1.6, hd - 0.04, '#ffeecb'));
    // The bar counter, chiller case and stools, visible through the glass.
    s.push(box(w - 1.6, 0.9, 0.9, -0.4, 0.45, hd - 1.5, C.wood));
    s.push(box(w - 1.4, 0.16, 1.1, -0.4, 0.98, hd - 1.5, '#9a6a3f'));
    s.push(box(w - 2.4, 0.5, 0.6, -0.4, 1.31, hd - 1.7, '#9a6a3f'));
    s.push(box(w - 2.5, 0.42, 0.54, -0.4, 1.36, hd - 1.7, C.glass));
    for (let i = 0; i < 8; i++) s.push(box(0.3, 0.14, 0.3, -3.6 + i * 0.85, 1.2, hd - 1.7, ['#e8724f', '#f0a04f', '#e0e0d0', '#e8845f'][i % 4]));
    for (let i = 0; i < 4; i++) {
      const sx = -3.0 + i * 1.9;
      s.push(cyl(0.22, 0.22, 0.1, 10, sx, 0.62, hd - 0.7, P.timberD));
      s.push(cyl(0.06, 0.07, 0.56, 8, sx, 0.31, hd - 0.7, C.metalDark));
    }
    // Entrance bay on the right with a stone step and a noren.
    s.push(box(2.0, 2.6, 0.4, hw - 1.6, 1.35, hd - 0.06, P.ink));
    s.push(...shoji(1.6, 2.4, hw - 1.6, 1.25, hd + 0.12, { cols: 2, rows: 4 }));
    g.push(box(1.44, 2.24, 0.05, hw - 1.6, 1.25, hd - 0.02, P.paperWarm));
    s.push(box(2.3, 0.18, 0.7, hw - 1.6, 0.1, hd + 0.42, P.stone));
    s.push(...noren(1.7, 0.9, hw - 1.6, 2.62, hd + 0.36, { color: RED, band: CREAM, panels: 3 }));
    // Deep entrance canopy + a projecting vertical sign fin.
    s.push(box(w + 0.4, 0.2, 1.5, 0, 3.9, hd + 0.6, REDD));
    s.push(box(w + 0.44, 0.28, 0.14, 0, 3.72, hd + 1.32, RED));
    s.push(box(0.7, 3.0, 0.3, hw + 0.4, 2.6, hd - 1.2, P.timberD));
    neon.push(box(0.5, 2.6, 0.1, hw + 0.58, 2.6, hd - 1.2, '#ff7a5a'));
    // Lantern row + warm underside light + planters.
    for (let i = 0; i < 4; i++) {
      const L = lantern(-3.2 + i * 2.1, 3.35, hd + 1.05, { r: 0.24, h: 0.5 });
      s.push(...L.parts); neon.push(...L.glow);
    }
    g.push(box(w - 0.4, 0.1, 1.2, 0, 3.79, hd + 0.62, P.paperWarm));
    for (const px of [-hw + 0.8, -hw + 2.2]) {
      s.push(cyl(0.3, 0.24, 0.5, 10, px, 0.25, hd + 1.0, C.terracotta));
      s.push(blob(0.32, px, 0.72, hd + 1.0, P.moss));
      s.push(blob(0.2, px + 0.2, 0.92, hd + 1.05, P.sage));
    }
    // Queue rope posts.
    for (let i = 0; i < 2; i++) {
      s.push(cyl(0.09, 0.11, 0.9, 8, hw - 0.4, 0.45, hd + 1.6 + i * 1.6, C.metalDark));
      s.push(cyl(0.13, 0.13, 0.1, 8, hw - 0.4, 0.94, hd + 1.6 + i * 1.6, '#c8a03a'));
    }

    return {
      structure: merge(s), glow: merge(g), neon: merge(neon),
      sign: { x: hw + 0.4, y: 2.6, z: hd - 1.2, w: 0.62, h: 2.7 },
      signTex: makeSushiSign({ vertical: true }),
      steamAnchor: { x: -2.4, y: 1.9, z: hd - 2.2 },
      door: { x: hw - 1.6, z: hd + 0.55, yaw: 0 },
      counterAnchor: { x: -0.4, y: 1.05, z: hd - 2.3 },
      queueAnchors: [
        { x: hw - 1.6, z: hd + 1.5 }, { x: hw - 1.6, z: hd + 2.5 }, { x: hw - 2.4, z: hd + 3.4 },
        { x: hw - 1.2, z: hd + 4.3 }, { x: hw - 2.2, z: hd + 5.2 },
      ],
      seatAnchors: [
        { x: -3.0, z: hd - 0.7 }, { x: -1.1, z: hd - 0.7 }, { x: 0.8, z: hd - 0.7 }, { x: 2.7, z: hd - 0.7 },
        { x: -2.6, z: -1.9 }, { x: -0.6, z: -1.9 },
      ],
      size: { w: 9.6, d: 7.6, h: 5.6 },
      collider: { cx: 0, cz: 0, w: 9.9, d: 7.9, h: 5.8 },
    };
  }

  // -------------------------------------------------------------------------
  // TIER 4 — Premium Restaurant
  // -------------------------------------------------------------------------
  if (t === 4) {
    const w = 12.4, d = 9.6, hw = w / 2, hd = d / 2, h = 2 * STOREY;
    s.push(box(w, h, d, 0, h / 2, 0, CREAM));
    s.push(box(w + 0.4, 0.7, d + 0.4, 0, 0.35, 0, P.stone));                 // stone plinth
    s.push(box(w + 0.44, 0.16, d + 0.44, 0, 0.72, 0, P.stoneD));
    s.push(box(w + 0.2, 0.3, d + 0.2, 0, STOREY, 0, P.timberD));             // floor band
    s.push(...tiledGable(w, d, 0, h, 0, { col: P.tile, ridge: P.tileD, rise: 1.6, over: 0.9, ribs: 10, rafters: 9 }));
    // Upturned corner tails on the main roof.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      s.push(box(1.0, 0.22, 0.3, sx * (hw + 0.55), h + 0.12, sz * (hd + 0.75), P.tileD, [0, 0, -sx * 0.28]));
    }
    // Ground floor: timber posts, lattice bays and paper-panel booth windows.
    for (const px of [-hw + 0.2, -3.6, 3.6, hw - 0.2]) s.push(box(0.26, STOREY, 0.26, px, STOREY / 2 + 0.2, hd + 0.04, P.timberD));
    for (const bx of [-4.6, -1.6]) {
      s.push(...koshi(2.4, 1.9, bx, 2.1, hd + 0.16, { bars: 11 }));
      s.push(...shoji(2.2, 1.6, bx, 2.1, hd + 0.02, { cols: 4, rows: 2 }));
      g.push(box(2.1, 1.5, 0.05, bx, 2.1, hd - 0.06, P.paperWarm));
      s.push(box(2.7, 0.14, 0.5, bx, 1.1, hd + 0.22, P.timberD));
    }
    s.push(box(w + 0.2, 0.28, 0.4, 0, 3.3, hd + 0.14, P.timberD));
    // Grand entrance: gate posts, a deep pent roof, a wide noren, stone steps.
    s.push(box(4.6, 3.2, 0.5, 1.9, 1.7, hd - 0.1, P.ink));
    s.push(...shoji(1.5, 2.6, 0.9, 1.45, hd + 0.16, { cols: 2, rows: 4 }));
    s.push(...shoji(1.5, 2.6, 2.9, 1.45, hd + 0.16, { cols: 2, rows: 4 }));
    g.push(box(3.6, 2.5, 0.06, 1.9, 1.45, hd - 0.02, P.paperWarm));
    for (const px of [-0.2, 4.0]) s.push(box(0.34, 3.6, 0.34, px, 1.8, hd + 0.9, P.timberD));
    s.push(box(4.9, 0.3, 0.36, 1.9, 3.5, hd + 0.9, P.timberD));
    s.push(box(5.6, 0.18, 2.0, 1.9, 3.95, hd + 1.1, P.tile, [-0.3, 0, 0]));
    s.push(box(5.7, 0.2, 0.2, 1.9, 3.62, hd + 2.06, P.tileD));
    s.push(...noren(3.6, 1.1, 1.9, 2.9, hd + 0.5, { color: RED, band: CREAM, panels: 4 }));
    for (let i = 0; i < 3; i++) s.push(box(5.0 - i * 0.5, 0.18, 1.4 - i * 0.35, 1.9, 0.09 + i * 0.18, hd + 1.9 - i * 0.35, P.stone));
    // Upper floor: a balcony with shoji screens behind.
    s.push(...balcony(w - 1.6, 0, STOREY + 0.2, hd, 1.2, { col: P.timberD, deck: C.wood, bars: 16 }));
    for (let i = 0; i < 4; i++) {
      const ux = -4.2 + i * 2.8;
      s.push(...shoji(2.3, 2.0, ux, STOREY + 1.6, hd + 0.04, { cols: 4, rows: 3 }));
      g.push(box(2.15, 1.85, 0.05, ux, STOREY + 1.6, hd - 0.04, P.paperWarm));
    }
    s.push(box(w + 0.16, 0.24, 0.34, 0, h - 0.18, hd + 0.1, P.timberD));
    // Side elevations get lattice + windows so they aren't blank.
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        s.push(box(0.14, 1.6, 2.2, sx * (hw + 0.02), 2.2, -2.6 + i * 4.2, P.timberD));
        s.push(box(0.08, 1.4, 2.0, sx * (hw + 0.08), 2.2, -2.6 + i * 4.2, C.glass));
        s.push(box(0.14, 1.5, 2.0, sx * (hw + 0.02), STOREY + 1.7, -2.6 + i * 4.2, P.timberD));
        s.push(box(0.08, 1.3, 1.8, sx * (hw + 0.08), STOREY + 1.7, -2.6 + i * 4.2, P.paper));
      }
    }
    // Signage: a big vertical fin + a lantern row + wall lamps.
    s.push(box(0.9, 4.2, 0.4, -hw - 0.35, 3.6, hd - 1.6, P.timberD));
    neon.push(box(0.66, 3.8, 0.12, -hw - 0.56, 3.6, hd - 1.6, '#ff7a5a'));
    for (let i = 0; i < 6; i++) {
      const L = lantern(-5.0 + i * 2.0, 3.85, hd + 1.35, { r: 0.26, h: 0.54 });
      s.push(...L.parts); neon.push(...L.glow);
    }
    g.push(box(5.2, 0.1, 1.6, 1.9, 3.82, hd + 1.15, P.paperWarm));
    // Forecourt garden: gravel, stone lanterns, a clipped pine, a low fence.
    s.push(box(5.4, 0.06, 3.0, -4.0, 0.03, hd + 2.0, '#ded6c0'));
    for (const lx of [-6.0, -1.8]) {
      s.push(cyl(0.3, 0.34, 0.14, 8, lx, 0.07, hd + 2.2, P.stoneD));
      s.push(cyl(0.1, 0.12, 0.5, 8, lx, 0.39, hd + 2.2, P.stone));
      s.push(cyl(0.22, 0.18, 0.3, 6, lx, 0.79, hd + 2.2, P.stone));
      s.push(cyl(0.4, 0.28, 0.18, 6, lx, 1.03, hd + 2.2, P.stoneD));
      g.push(cyl(0.13, 0.13, 0.14, 8, lx, 0.79, hd + 2.2, P.lanternLit));
    }
    s.push(cyl(0.12, 0.18, 1.3, 6, -3.9, 0.65, hd + 2.4, '#6b5238'));
    s.push(cyl(0.62, 0.66, 0.2, 10, -3.9, 1.45, hd + 2.4, P.pine));
    s.push(cyl(0.44, 0.48, 0.18, 10, -3.5, 1.75, hd + 2.2, P.pine));
    for (let i = 0; i < 7; i++) s.push(box(0.08, 0.7, 0.08, -6.8 + i * 0.9, 0.35, hd + 3.3, C.wood));
    s.push(box(6.0, 0.08, 0.1, -3.9, 0.66, hd + 3.3, P.timberD));

    return {
      structure: merge(s), glow: merge(g), neon: merge(neon),
      sign: { x: -hw - 0.35, y: 3.6, z: hd - 1.6, w: 0.8, h: 3.9 },
      signTex: makeSushiSign({ vertical: true }),
      steamAnchor: { x: -3.0, y: 2.6, z: -1.6 },
      door: { x: 1.9, z: hd + 0.7, yaw: 0 },
      counterAnchor: { x: -1.4, y: 1.15, z: -1.8 },
      queueAnchors: [
        { x: 1.9, z: hd + 2.2 }, { x: 1.9, z: hd + 3.2 }, { x: 2.6, z: hd + 4.1 },
        { x: 1.2, z: hd + 5.0 }, { x: 2.4, z: hd + 5.9 }, { x: 1.0, z: hd + 6.8 },
      ],
      seatAnchors: [
        { x: -4.2, z: -1.0 }, { x: -2.4, z: -1.0 }, { x: -0.6, z: -1.0 }, { x: 1.2, z: -1.0 },
        { x: -4.2, z: -3.4 }, { x: -2.4, z: -3.4 }, { x: 2.8, z: -2.6 }, { x: 4.4, z: -2.6 },
      ],
      size: { w: 12.4, d: 9.6, h: 8.8 },
      collider: { cx: 0, cz: 0, w: 12.8, d: 10.0, h: 8.8 },
    };
  }

  // -------------------------------------------------------------------------
  // TIER 5 — Famous Destination
  // -------------------------------------------------------------------------
  const w = 15.6, d = 11.6, hw = w / 2, hd = d / 2, h = 2 * STOREY;
  s.push(box(w, h, d, 0, h / 2, 0, CREAM));
  s.push(box(w + 0.6, 0.9, d + 0.6, 0, 0.45, 0, P.stone));
  s.push(box(w + 0.64, 0.18, d + 0.64, 0, 0.94, 0, P.stoneD));
  s.push(box(w + 0.24, 0.34, d + 0.24, 0, STOREY + 0.1, 0, P.timberD));
  // Main sweeping roof + a third-level roof lantern (yagura) on top.
  s.push(...tiledGable(w, d, 0, h, 0, { col: P.tile, ridge: P.tileD, rise: 2.0, over: 1.15, ribs: 12, rafters: 11 }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    s.push(box(1.4, 0.26, 0.36, sx * (hw + 0.75), h + 0.16, sz * (hd + 0.95), P.tileD, [0, 0, -sx * 0.3]));
  }
  s.push(box(4.6, 1.9, 3.6, 0, h + 2.9, -0.4, CREAM));
  for (const px of [-2.1, 2.1]) s.push(box(0.22, 1.9, 0.22, px, h + 2.9, 1.42, P.timberD));
  for (let i = 0; i < 3; i++) {
    s.push(...shoji(1.2, 1.3, -1.4 + i * 1.4, h + 2.95, 1.44, { cols: 2, rows: 2 }));
    g.push(box(1.1, 1.2, 0.05, -1.4 + i * 1.4, h + 2.95, 1.36, P.paperWarm));
  }
  s.push(...tiledGable(4.8, 3.8, 0, h + 3.85, -0.4, { col: P.tile, ridge: P.tileD, rise: 1.0, over: 0.6, ribs: 5, rafters: 5 }));
  // Abstract ridge finials (a nod to shachihoko) at each end of the main ridge.
  for (const sx of [-1, 1]) {
    s.push(cyl(0.1, 0.24, 0.7, 8, sx * (hw + 0.6), h + 2.35, 0, '#c8a03a', [0, 0, -sx * 0.35]));
    s.push(blob(0.22, sx * (hw + 0.85), h + 2.7, 0, '#c8a03a'));
  }

  // Ground floor: a colonnade of timber posts over a stone base, lattice bays.
  for (let i = 0; i < 6; i++) {
    const px = -hw + 0.4 + i * ((w - 0.8) / 5);
    s.push(box(0.3, STOREY - 0.2, 0.3, px, (STOREY - 0.2) / 2 + 0.95, hd + 0.12, P.timberD));
  }
  s.push(box(w + 0.3, 0.34, 0.44, 0, STOREY + 0.85, hd + 0.14, P.timberD));
  for (const bx of [-5.6, -2.4]) {
    s.push(...koshi(2.6, 2.1, bx, 2.5, hd + 0.24, { bars: 12 }));
    s.push(...shoji(2.4, 1.9, bx, 2.5, hd + 0.06, { cols: 4, rows: 3 }));
    g.push(box(2.3, 1.8, 0.05, bx, 2.5, hd - 0.02, P.paperWarm));
    s.push(box(2.9, 0.16, 0.6, bx, 1.4, hd + 0.3, P.timberD));
  }
  // The famous window: a wide glazed bay showing the whole sushi counter.
  s.push(box(5.6, 2.6, 0.2, 4.6, 2.35, hd + 0.06, P.timberD));
  s.push(box(5.3, 2.35, 0.12, 4.6, 2.35, hd + 0.12, C.glass));
  for (const mx of [2.8, 4.6, 6.4]) s.push(box(0.13, 2.35, 0.18, mx, 2.35, hd + 0.16, P.timberD));
  g.push(box(5.2, 2.25, 0.06, 4.6, 2.35, hd - 0.02, '#ffeecb'));
  s.push(box(5.2, 0.9, 1.0, 4.6, 1.45, hd - 1.2, C.wood));
  s.push(box(5.4, 0.18, 1.2, 4.6, 1.99, hd - 1.2, '#9a6a3f'));
  s.push(box(4.6, 0.5, 0.7, 4.6, 2.33, hd - 1.35, C.glass));
  for (let i = 0; i < 7; i++) s.push(box(0.32, 0.16, 0.34, 2.6 + i * 0.66, 2.16, hd - 1.35, ['#e8724f', '#f0a04f', '#e0e0d0', '#e8845f'][i % 4]));

  // Grand entrance in the centre: gate posts, deep karahafu-ish porch, steps.
  s.push(box(4.4, 3.4, 0.6, -0.4, 2.15, hd - 0.1, P.ink));
  s.push(...shoji(1.6, 2.8, -1.3, 1.85, hd + 0.2, { cols: 2, rows: 4 }));
  s.push(...shoji(1.6, 2.8, 0.5, 1.85, hd + 0.2, { cols: 2, rows: 4 }));
  g.push(box(3.6, 2.7, 0.06, -0.4, 1.85, hd + 0.02, P.paperWarm));
  for (const px of [-2.9, 2.1]) {
    s.push(box(0.4, 4.2, 0.4, px, 2.55, hd + 1.5, P.timberD));
    s.push(cyl(0.0, 0.3, 0.34, 4, px, 4.78, hd + 1.5, P.tileD));
  }
  s.push(box(5.6, 0.34, 0.42, -0.4, 4.5, hd + 1.5, P.timberD));
  s.push(box(6.4, 0.2, 2.6, -0.4, 4.95, hd + 1.7, P.tile, [-0.28, 0, 0]));
  s.push(box(5.0, 0.5, 0.3, -0.4, 5.35, hd + 1.5, P.tileD));
  s.push(box(3.2, 0.4, 0.32, -0.4, 5.7, hd + 1.5, P.tileD));
  s.push(box(0.5, 0.4, 0.34, -0.4, 5.98, hd + 1.5, '#c8a03a'));
  s.push(...noren(3.6, 1.2, -0.4, 3.35, hd + 0.62, { color: RED, band: CREAM, panels: 4 }));
  for (let i = 0; i < 3; i++) s.push(box(5.8 - i * 0.6, 0.2, 1.6 - i * 0.4, -0.4, 0.1 + i * 0.2, hd + 2.4 - i * 0.4, P.stone));

  // Upper floor: a long balcony, shoji bays and a rail of lanterns.
  s.push(...balcony(w - 2.0, 0, STOREY + 0.3, hd, 1.5, { col: P.timberD, deck: C.wood, bars: 20 }));
  for (let i = 0; i < 5; i++) {
    const ux = -5.6 + i * 2.8;
    s.push(...shoji(2.4, 2.2, ux, STOREY + 1.8, hd + 0.04, { cols: 4, rows: 3 }));
    g.push(box(2.25, 2.05, 0.05, ux, STOREY + 1.8, hd - 0.04, P.paperWarm));
  }
  s.push(box(w + 0.2, 0.28, 0.4, 0, h - 0.2, hd + 0.12, P.timberD));
  // Side elevations.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      s.push(box(0.16, 1.8, 2.3, sx * (hw + 0.02), 2.6, -3.6 + i * 3.6, P.timberD));
      s.push(box(0.1, 1.6, 2.1, sx * (hw + 0.08), 2.6, -3.6 + i * 3.6, C.glass));
      s.push(box(0.16, 1.6, 2.1, sx * (hw + 0.02), STOREY + 1.9, -3.6 + i * 3.6, P.timberD));
      s.push(box(0.1, 1.4, 1.9, sx * (hw + 0.08), STOREY + 1.9, -3.6 + i * 3.6, P.paper));
    }
  }

  // Signage: twin vertical fins + a long lantern row + a banner pair.
  for (const sx of [-1, 1]) {
    s.push(box(1.0, 5.0, 0.44, sx * (hw + 0.4), 4.2, hd - 1.8, P.timberD));
    neon.push(box(0.74, 4.5, 0.14, sx * (hw + 0.64), 4.2, hd - 1.8, '#ff7a5a'));
  }
  for (let i = 0; i < 8; i++) {
    const L = lantern(-6.3 + i * 1.8, 4.35, hd + 1.9, { r: 0.28, h: 0.58 });
    s.push(...L.parts); neon.push(...L.glow);
  }
  g.push(box(6.0, 0.12, 2.2, -0.4, 4.82, hd + 1.75, P.paperWarm));
  for (const bx of [-hw + 1.0, hw - 1.0]) {
    s.push(cyl(0.07, 0.09, 4.2, 8, bx, 2.1, hd + 2.6, P.timberD));
    s.push(box(0.6, 0.07, 0.07, bx + 0.3, 4.14, hd + 2.6, P.timberD));
    s.push(box(0.55, 2.6, 0.05, bx + 0.3, 2.9, hd + 2.6, RED));
    s.push(box(0.55, 0.12, 0.06, bx + 0.3, 4.04, hd + 2.62, CREAM));
    s.push(box(0.55, 0.12, 0.06, bx + 0.3, 1.66, hd + 2.62, CREAM));
  }

  // A destination forecourt: gravel garden, cherry tree, stone lanterns,
  // a queue rail and a waiting bench — people queue down the street for this.
  s.push(box(6.4, 0.06, 3.6, -5.0, 0.03, hd + 3.0, '#ded6c0'));
  for (let i = 0; i < 4; i++) s.push(cyl(0.36, 0.36, 0.1, 8, -2.4 + i * 0.0, 0.06, hd + 1.6 + i * 0.9, P.stone));
  s.push(cyl(0.2, 0.32, 2.0, 8, -5.6, 1.0, hd + 3.0, '#6f5340'));
  s.push(blob(1.0, -5.6, 2.6, hd + 3.0, P.blossom));
  s.push(blob(0.7, -4.7, 2.35, hd + 3.3, '#eaa8c4'));
  s.push(blob(0.62, -6.5, 2.3, hd + 2.7, P.blossom));
  for (const lx of [-7.6, -2.6]) {
    s.push(cyl(0.34, 0.4, 0.16, 8, lx, 0.08, hd + 2.2, P.stoneD));
    s.push(cyl(0.12, 0.14, 0.58, 8, lx, 0.45, hd + 2.2, P.stone));
    s.push(cyl(0.26, 0.2, 0.34, 6, lx, 0.91, hd + 2.2, P.stone));
    s.push(cyl(0.46, 0.32, 0.2, 6, lx, 1.18, hd + 2.2, P.stoneD));
    g.push(cyl(0.15, 0.15, 0.16, 8, lx, 0.91, hd + 2.2, P.lanternLit));
  }
  s.push(box(2.0, 0.12, 0.55, hw - 1.6, 0.5, hd + 2.2, C.wood));
  s.push(box(2.0, 0.55, 0.1, hw - 1.6, 0.78, hd + 1.96, C.wood));
  for (const bx of [hw - 2.4, hw - 0.8]) s.push(box(0.12, 0.5, 0.5, bx, 0.25, hd + 2.2, P.timberD));
  for (let i = 0; i < 4; i++) {
    s.push(cyl(0.1, 0.12, 0.95, 8, 4.2, 0.48, hd + 2.6 + i * 1.7, C.metalDark));
    s.push(cyl(0.14, 0.14, 0.12, 8, 4.2, 1.0, hd + 2.6 + i * 1.7, '#c8a03a'));
    if (i < 3) s.push(box(0.05, 0.06, 1.7, 4.2, 0.82, hd + 3.45 + i * 1.7, RED));
  }

  return {
    structure: merge(s), glow: merge(g), neon: merge(neon),
    sign: { x: hw + 0.4, y: 4.2, z: hd - 1.8, w: 0.88, h: 4.6 },
    signTex: makeSushiSign({ vertical: true }),
    steamAnchor: { x: 4.6, y: 2.9, z: hd - 2.0 },
    door: { x: -0.4, z: hd + 0.9, yaw: 0 },
    counterAnchor: { x: 4.6, y: 2.1, z: hd - 1.9 },
    queueAnchors: [
      { x: -0.4, z: hd + 2.8 }, { x: -0.4, z: hd + 4.0 }, { x: 0.6, z: hd + 5.2 }, { x: -0.6, z: hd + 6.4 },
      { x: 0.8, z: hd + 7.6 }, { x: -0.8, z: hd + 8.8 }, { x: 0.4, z: hd + 10.0 }, { x: -0.2, z: hd + 11.2 },
    ],
    seatAnchors: [
      { x: 2.8, z: hd - 2.4 }, { x: 4.0, z: hd - 2.4 }, { x: 5.2, z: hd - 2.4 }, { x: 6.4, z: hd - 2.4 },
      { x: -5.6, z: -1.4 }, { x: -3.6, z: -1.4 }, { x: -5.6, z: -4.0 }, { x: -3.6, z: -4.0 },
      { x: 2.0, z: -4.2 }, { x: 4.4, z: -4.2 },
    ],
    size: { w: 15.6, d: 11.6, h: 12.1 },
    collider: { cx: 0, cz: 0, w: 16.0, d: 12.0, h: 12.1 },
  };
}

// ===========================================================================
// REGISTRY
// ===========================================================================

const ALL = ['old_market', 'fish_harbor', 'downtown', 'residential', 'neon_street'];

/**
 * Building registry. `foot` matches each builder's collider so a lot-packer can
 * size its plots; `variants` are named option sets that the instancer caches
 * one geometry per — so a street of six differently-coloured machiya is still
 * six instanced draws, not six hundred.
 */
export const BUILDING_TYPES = {
  machiya: {
    build: buildMachiya, foot: { w: 8.3, d: 6.7 }, label: 'Machiya', icon: '🏮',
    districts: ['old_market', 'neon_street', 'residential'],
    variants: {
      cream: { wallColor: '#efe3c8', roofColor: '#5a6672' },
      sand: { wallColor: '#e6cf9e', roofColor: '#414c56', accent: '#c05a44' },
      sage: { wallColor: '#dfe4d4', roofColor: '#4a5560', accent: '#4e7f8f' },
      wide: { width: 10, wallColor: '#f2e0bd', roofColor: '#5a6672' },
      single: { width: 7, storeys: 1, awning: false },
    },
  },
  marketStall: {
    build: buildMarketStall, foot: { w: 4.9, d: 3.3 }, label: 'Market Stall', icon: '🧺',
    districts: ['old_market', 'fish_harbor'],
    variants: {
      veg: { goods: 'veg', awningColor: '#5aa85f' },
      fish: { goods: 'fish', awningColor: '#4e8fa8' },
      rice: { goods: 'rice', awningColor: '#e0b13a' },
      sweets: { goods: 'sweets', awningColor: '#e58fce' },
    },
  },
  teaHouse: { build: buildTeaHouse, foot: { w: 8.8, d: 8.0 }, label: 'Tea House', icon: '🍵', districts: ['old_market', 'residential'] },
  konbini: { build: buildKonbini, foot: { w: 8.9, d: 6.3 }, label: 'Convenience Store', icon: '🏪', districts: ['downtown', 'residential', 'neon_street'] },
  officeBlock: {
    build: buildOfficeBlock, foot: { w: 11.4, d: 8.9 }, label: 'Offices', icon: '🏢',
    districts: ['downtown'],
    variants: {
      low: { storeys: 3, width: 10, depth: 8 },
      mid: { storeys: 4, width: 11, depth: 8.5 },
      tall: { storeys: 6, width: 12, depth: 9, wallColor: '#d2d6d2' },
      warm: { storeys: 5, width: 11, depth: 8.5, wallColor: '#e6dcc4', accent: '#c05a44' },
    },
  },
  trainStation: { build: buildTrainStation, foot: { w: 16.2, d: 13.0 }, label: 'Station', icon: '🚉', districts: ['downtown'] },
  warehouse: { build: buildWarehouse, foot: { w: 15.4, d: 13.1 }, label: 'Warehouse', icon: '📦', districts: ['fish_harbor', 'downtown'] },
  dockShed: { build: buildDockShed, foot: { w: 7.4, d: 6.4 }, label: 'Dock Shed', icon: '🛶', districts: ['fish_harbor'] },
  house: {
    build: buildHouse, foot: { w: 9.8, d: 9.4 }, label: 'House', icon: '🏡',
    districts: ['residential'],
    variants: {
      cream: { wallColor: '#efe3c8', roofColor: '#7a6a62' },
      blue: { wallColor: '#dfe6ea', roofColor: '#4e6a7a' },
      sage: { wallColor: '#e2e8d8', roofColor: '#5a6672' },
      pink: { wallColor: '#f3e2dd', roofColor: '#8f6a62' },
      nogarden: { garden: false },
    },
  },
  apartment: {
    build: buildApartment, foot: { w: 13.4, d: 8.9 }, label: 'Apartments', icon: '🏘️',
    districts: ['residential', 'downtown'],
    variants: {
      two: { storeys: 2 },
      three: { storeys: 3 },
      four: { storeys: 4, wallColor: '#e0dccc', accent: '#7a8f9a' },
    },
  },
  yatai: { build: buildYatai, foot: { w: 4.2, d: 3.8 }, label: 'Yatai', icon: '🍢', districts: ['neon_street', 'old_market'] },
  izakaya: { build: buildIzakaya, foot: { w: 6.8, d: 7.4 }, label: 'Izakaya', icon: '🏮', districts: ['neon_street', 'downtown'] },
  festivalStall: {
    build: buildFestivalStall, foot: { w: 4.4, d: 3.0 }, label: 'Festival Stall', icon: '🎏',
    districts: ['neon_street', 'old_market'],
    variants: { goldfish: { game: 'goldfish', canopyColor: '#e0508f' }, prizes: { game: 'prizes', canopyColor: '#4e8fa8' } },
  },
  bathhouse: { build: buildBathhouse, foot: { w: 11.9, d: 10.9 }, label: 'Bathhouse', icon: '♨️', districts: ['old_market', 'residential'] },
  fishMarketHall: { build: buildFishMarketHall, foot: { w: 20.6, d: 14.1 }, label: 'Fish Market', icon: '🐟', districts: ['fish_harbor'] },
  sushiShop: {
    build: (o = {}) => buildSushiShop(o.tier || 1),
    foot: { w: 16.0, d: 12.0 }, label: GAME.title, icon: '🍣', districts: ALL,
    variants: { t1: { tier: 1 }, t2: { tier: 2 }, t3: { tier: 3 }, t4: { tier: 4 }, t5: { tier: 5 } },
  },
};

// ===========================================================================
// INSTANCER
// ===========================================================================

/**
 * Build a placed set of buildings. Geometry is cached per (id, variant) key so
 * variants still batch: each cache entry becomes one InstancedMesh per channel
 * (structure / glow / neon / sign).
 *
 * placements: [{ id, x, z, yaw, scale, variant }]
 * returns { group, count, pois }
 */
export function buildBuildingInstances(scene, placements = [], opts = {}) {
  const { gradientMap = null, group, colliders, glowMats, neonMats, stuccoTex } = opts;
  const root = group || new THREE.Group();
  if (!group && scene) scene.add(root);

  // vertexColors carry each building's palette; the near-white stucco map only
  // adds soft painted surface grain (no colour shift).
  const structMat = new THREE.MeshToonMaterial({ vertexColors: true, map: stuccoTex || null, gradientMap });

  let glowMat = null;
  const getGlowMat = () => {
    if (!glowMat) {
      glowMat = new THREE.MeshToonMaterial({
        vertexColors: true,
        gradientMap,
        emissive: new THREE.Color(0xffd9a0),
        emissiveIntensity: 0,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      });
      if (glowMats) glowMats.push(glowMat);
    }
    return glowMat;
  };

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

  // Resolve a placement's variant into builder options + a stable cache key.
  const variantOpts = (type, variant) => {
    if (variant == null) return {};
    if (typeof variant === 'object') return variant;
    return (type.variants && type.variants[variant]) || {};
  };
  const cacheKey = (id, variant) =>
    `${id}|${variant == null ? '' : typeof variant === 'object' ? JSON.stringify(variant) : String(variant)}`;

  // Bucket placements by (id, variant).
  const buckets = new Map();
  for (const p of placements) {
    const type = BUILDING_TYPES[p.id];
    if (!type) continue;
    const key = cacheKey(p.id, p.variant);
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { type, id: p.id, variant: p.variant, list: [] }));
    b.list.push(p);
  }

  const dummy = new THREE.Object3D();
  const localCenter = new THREE.Vector3();
  const pois = [];
  let count = 0;

  for (const [, b] of buckets) {
    const built = b.type.build(variantOpts(b.type, b.variant));   // ONE geometry per (id, variant)
    if (!built || !built.structure) continue;
    const n = b.list.length;

    const meshes = [];
    const sMesh = new THREE.InstancedMesh(built.structure, structMat, n);
    sMesh.name = `building:${b.id}`;
    sMesh.castShadow = true;
    sMesh.receiveShadow = true;
    meshes.push(sMesh);

    if (built.glow) {
      const m = new THREE.InstancedMesh(built.glow, getGlowMat(), n);
      m.name = `building:${b.id}:glow`;
      meshes.push(m);
    }
    if (built.neon) {
      const m = new THREE.InstancedMesh(built.neon, getNeonMat(), n);
      m.name = `building:${b.id}:neon`;
      meshes.push(m);
    }
    if (built.sign && built.signTex) {
      const tex = built.signTex;
      const signMat = new THREE.MeshToonMaterial({
        map: tex,
        gradientMap,
        emissive: 0xffffff,
        emissiveMap: tex,
        emissiveIntensity: 0.5,   // signs read as lit day and night
        side: THREE.DoubleSide,
        transparent: false,
      });
      const sg = new THREE.PlaneGeometry(built.sign.w || 3, built.sign.h || 0.8);
      sg.translate(built.sign.x || 0, built.sign.y || 3, (built.sign.z || 0) + 0.03);
      const m = new THREE.InstancedMesh(sg, signMat, n);
      m.name = `building:${b.id}:sign`;
      meshes.push(m);
    }

    for (let i = 0; i < n; i++) {
      const p = b.list[i];
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
        const ch = (col.h || 6) * s;
        colliders.push(new THREE.Box3(
          new THREE.Vector3(localCenter.x - cw, 0, localCenter.z - cd),
          new THREE.Vector3(localCenter.x + cw, ch, localCenter.z + cd)
        ));
      }

      pois.push({ x: p.x || 0, z: p.z || 0, id: b.id, label: b.type.label, icon: b.type.icon });
      count++;
    }

    for (const m of meshes) {
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
      root.add(m);
    }
  }

  return { group: root, count, pois };
}
