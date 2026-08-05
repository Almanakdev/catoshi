import * as THREE from 'three';

// All textures here are generated procedurally on a <canvas>, so the project
// has ZERO external asset dependencies — nothing to download, nothing to break.
//
// The whole city uses a low-poly "Summer Afternoon" cartoon look: flat warm
// colors, banded toon shading (see makeToonGradient), soft window art, and
// emissive maps so windows can glow at night.

// ---------------------------------------------------------------------------
// Central texture language — one place to tune the stylized surface look so
// every generated texture (facades, ground, roads, shopfronts, signs, awnings)
// reads as one material family: the same colour space and the same anisotropic
// filtering. Everything is built on a 256px grid (512 for the two big tileable
// surfaces) so detail density is consistent across the world.
// ---------------------------------------------------------------------------
export const TEX = {
  colorSpace: THREE.SRGBColorSpace,
  anisotropy: 8,
};

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Finalize any canvas into a THREE texture with the shared colour space +
// anisotropy, optionally tiled. Everything goes through here so no surface ends
// up with an odd colour space or filtering that makes it look out of place.
function finish(canvas, { repeatX = 1, repeatY = 1, tiled = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = TEX.colorSpace;
  tex.anisotropy = TEX.anisotropy;
  if (tiled) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
  }
  return tex;
}

// Backwards-compatible tiled-texture helper used by the big surfaces.
function toTexture(canvas, repeatX = 1, repeatY = 1) {
  return finish(canvas, { repeatX, repeatY, tiled: true });
}

/**
 * A tiny 1-D ramp texture that MeshToonMaterial samples to decide how many
 * discrete shading "bands" a surface has. NearestFilter keeps the steps hard,
 * which is what gives the cel-shaded / cartoon banding.
 */
// A WARM, LOW-CONTRAST cel ramp for the Ghibli look. Instead of a neutral
// black→white intensity ramp, the shaded band is a soft warm tan (not dark) and
// the lit band a warm cream — so every toon surface reads hand-painted and
// nostalgic, with gentle shadows (the shadow floor is high, keeping contrast
// low). Returns an RGBA ramp so the tint carries through the toon shading.
const TOON_SHADOW = [0.48, 0.48, 0.5];  // shadow band — soft form (not harsh, not milky-flat)
const TOON_LIGHT = [0.99, 0.98, 0.94];  // gently below pure white so lit surfaces don't blow out
export function makeToonGradient(steps = 4) {
  const data = new Uint8Array(steps * 4);
  for (let i = 0; i < steps; i++) {
    const t = Math.pow(i / (steps - 1), 0.85); // ease toward the light band
    for (let c = 0; c < 3; c++) {
      data[i * 4 + c] = Math.round((TOON_SHADOW[c] + (TOON_LIGHT[c] - TOON_SHADOW[c]) * t) * 255);
    }
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// Warm, sun-washed cartoon facade colors (soft sand, peach, terracotta, sage…).
const FACADE_COLORS = [
  '#f2cd9a', // warm sand
  '#f0b58a', // peach
  '#e79274', // terracotta
  '#c9d69a', // sage green
  '#f4dd97', // butter yellow
  '#b8cfd6', // dusty sky blue
  '#e8b7a0', // clay
  '#d9c7a0', // oatmeal
];

// Shared window paint colors.
const GLASS_TOP = '#cfe8f2';
const GLASS_BOT = '#a9cfe0';
const LIT_TOP = '#ffe9b0';
const LIT_BOT = '#ffcf82';
const FRAME = '#5b4a3a';

function glassFill(ctx, x, y, w, h, lit) {
  const g = ctx.createLinearGradient(x, y, x, y + h);
  g.addColorStop(0, lit ? LIT_TOP : GLASS_TOP);
  g.addColorStop(1, lit ? LIT_BOT : GLASS_BOT);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

// Paint a lit window into the emissive canvas with a faint halo for bloom.
function litGlow(em, x, y, w, h) {
  em.fillStyle = 'rgba(255,175,85,0.4)';
  em.fillRect(x - 5, y - 5, w + 10, h + 10);
  em.fillStyle = '#ffcf82';
  em.fillRect(x, y, w, h);
}

// ---------------------------------------------------------------------------
// Facade painters — four different window "languages" so buildings across the
// city stop looking copy-pasted. Each draws into both the color canvas and the
// emissive canvas (lit windows only).
// ---------------------------------------------------------------------------

/** Classic chunky-framed window grid with mullions (the residential look). */
function paintGrid(ctx, em, rng, W, H) {
  const cols = 3 + Math.floor(rng() * 3);
  const margin = 20;
  const gap = 16;
  const winW = (W - margin * 2 - gap * (cols - 1)) / cols;
  const winH = winW * 1.3;
  const rowStep = winH + gap + 10;
  const rows = Math.floor((H - margin) / rowStep);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = margin + c * (winW + gap);
      const y = margin + r * rowStep;

      // Header shadow + sill for a bit of relief.
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fillRect(x - 4, y - 7, winW + 8, 4);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x - 4, y + winH + 3, winW + 8, 4);

      ctx.fillStyle = FRAME;
      ctx.fillRect(x - 3, y - 3, winW + 6, winH + 6);

      const lit = rng() < 0.4;
      glassFill(ctx, x, y, winW, winH, lit);

      // Mullions (window cross-bars).
      ctx.fillStyle = 'rgba(70,55,40,0.45)';
      ctx.fillRect(x + winW / 2 - 1, y, 2, winH);
      ctx.fillRect(x, y + winH / 2 - 1, winW, 2);

      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(x + winW * 0.12, y + winH * 0.1, winW * 0.2, winH * 0.65);

      if (lit) litGlow(em, x, y, winW, winH);
    }
  }
}

/** Full-width horizontal glass ribbons per floor (the modern office look). */
function paintRibbon(ctx, em, rng, W, H) {
  const floors = 9 + Math.floor(rng() * 4);
  const floorH = H / floors;
  const bandH = floorH * 0.55;
  const segs = 6 + Math.floor(rng() * 3);
  const segW = (W - 12) / segs;

  for (let f = 0; f < floors; f++) {
    const y = f * floorH + (floorH - bandH) / 2;
    // Slab shadow above the band.
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fillRect(6, y - 3, W - 12, 3);

    glassFill(ctx, 6, y, W - 12, bandH, false);
    for (let s = 0; s < segs; s++) {
      const sx = 6 + s * segW;
      if (rng() < 0.35) {
        glassFill(ctx, sx + 2, y, segW - 4, bandH, true);
        litGlow(em, sx + 2, y, segW - 4, bandH);
      }
      ctx.fillStyle = 'rgba(70,55,40,0.5)';
      ctx.fillRect(sx, y, 2, bandH);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(10, y + 2, W * 0.3, bandH * 0.3);
  }
}

/** Tall continuous vertical glass strips (the sleek tower look). */
function paintVertical(ctx, em, rng, W, H) {
  const strips = 4 + Math.floor(rng() * 3);
  const margin = 16;
  const gap = 14;
  const stripW = (W - margin * 2 - gap * (strips - 1)) / strips;
  const top = 14;
  const bottom = H - 14;
  const floorStep = 42;

  for (let s = 0; s < strips; s++) {
    const x = margin + s * (stripW + gap);
    ctx.fillStyle = FRAME;
    ctx.fillRect(x - 2, top - 2, stripW + 4, bottom - top + 4);
    glassFill(ctx, x, top, stripW, bottom - top, false);

    // Per-floor cells within the strip; some are lit.
    for (let y = top; y < bottom - 4; y += floorStep) {
      const cellH = Math.min(floorStep - 4, bottom - y);
      if (rng() < 0.3) {
        glassFill(ctx, x + 2, y + 2, stripW - 4, cellH - 2, true);
        litGlow(em, x + 2, y + 2, stripW - 4, cellH - 2);
      }
      ctx.fillStyle = 'rgba(70,55,40,0.4)';
      ctx.fillRect(x, y + cellH, stripW, 2);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(x + stripW * 0.15, top, stripW * 0.18, bottom - top);
  }
}

/** Small punched windows with lots of wall — offset rows (the old-town look). */
function paintPunched(ctx, em, rng, W, H) {
  const cols = 5 + Math.floor(rng() * 3);
  const margin = 18;
  const gap = 14;
  const winW = (W - margin * 2 - gap * (cols - 1)) / cols;
  const winH = winW * 1.15;
  const rowStep = winH + gap + 14;
  const rows = Math.floor((H - margin) / rowStep);

  for (let r = 0; r < rows; r++) {
    const offset = r % 2 === 1 ? (winW + gap) / 2 : 0;
    const rowCols = r % 2 === 1 ? cols - 1 : cols;
    for (let c = 0; c < rowCols; c++) {
      const x = margin + offset + c * (winW + gap);
      const y = margin + r * rowStep;

      ctx.fillStyle = FRAME;
      ctx.fillRect(x - 2, y - 2, winW + 4, winH + 4);

      const lit = rng() < 0.35;
      glassFill(ctx, x, y, winW, winH, lit);

      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x + winW * 0.15, y + winH * 0.12, winW * 0.22, winH * 0.5);

      // Little sill.
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(x - 3, y + winH + 2, winW + 6, 3);

      if (lit) litGlow(em, x, y, winW, winH);
    }
  }
}

const FACADE_PAINTERS = [paintGrid, paintRibbon, paintVertical, paintPunched];

/**
 * Paint one facade art set: a color canvas + an emissive canvas, using a
 * randomly chosen wall color and window style. Cheap to make; meant to be
 * pooled and shared by many buildings (see facadeTextures).
 */
export function makeFacadeSet(rng) {
  const W = 256;
  const H = 512;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const emCanvas = makeCanvas(W, H);
  const em = emCanvas.getContext('2d');
  em.fillStyle = '#000000';
  em.fillRect(0, 0, W, H);

  const base = FACADE_COLORS[Math.floor(rng() * FACADE_COLORS.length)];
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  paintWall(ctx, rng, W, H); // soft painted plaster/stucco + the odd brick course

  // Faint horizontal floor lines add architecture without breaking the flat look.
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  for (let y = 0; y < H; y += 64) ctx.fillRect(0, y, W, 2);

  FACADE_PAINTERS[Math.floor(rng() * FACADE_PAINTERS.length)](ctx, em, rng, W, H);

  return { canvas, emCanvas };
}

// ---------------------------------------------------------------------------
// Hand-painted-style surface textures — kept SOFT and stylized (Ghibli
// background painting), low-contrast, gentle colour variation. They ride on the
// existing MeshToonMaterial + warm gradient ramp, so the cel-shaded look stays.
// ---------------------------------------------------------------------------

// Soft, base-agnostic plaster/stucco mottling (+ an occasional faint brick
// course) painted over a facade base colour. Additive light/dark dabs so it
// works on any wall colour without a hard tint.
function paintWall(ctx, rng, W, H) {
  for (let i = 0; i < 70; i++) {
    ctx.globalAlpha = 0.03 + rng() * 0.045;
    ctx.fillStyle = rng() < 0.5 ? '#000000' : '#ffffff';
    ctx.beginPath();
    ctx.arc(rng() * W, rng() * H, 8 + rng() * 44, 0, Math.PI * 2);
    ctx.fill();
  }
  if (rng() < 0.34) { // ~1 in 3 walls read as soft brick
    ctx.globalAlpha = 0.05;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    const bh = 20;
    for (let y = 0, r = 0; y < H; y += bh, r++) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      const off = (r % 2) * 24;
      for (let x = off; x < W; x += 48) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + bh); ctx.stroke(); }
    }
  }
  ctx.globalAlpha = 1;
}

// Soft radial dabs that fade to transparent — a painterly "clump" brush used by
// the foliage / grass textures so they mottle without covering the base colour.
function paintDabs(ctx, W, H, col, alpha, n, rMin, rMax) {
  for (let i = 0; i < n; i++) {
    const x = Math.random() * W, y = Math.random() * H, r = rMin + Math.random() * (rMax - rMin);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Painted warm wood-grain bark for tree trunks. */
export function makeBarkTexture() {
  const W = 128, H = 256;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#946242'; ctx.fillRect(0, 0, W, H);
  paintDabs(ctx, W, H, '#8a5c38', 0.5, 16, 12, 30);  // cooler patches
  paintDabs(ctx, W, H, '#b0824f', 0.45, 16, 12, 28); // warmer highlights
  ctx.lineCap = 'round';
  for (let i = 0; i < 46; i++) {                      // vertical wavy grain
    ctx.strokeStyle = Math.random() < 0.55 ? '#6f4a2c' : '#b98a55';
    ctx.globalAlpha = 0.1 + Math.random() * 0.16;
    ctx.lineWidth = 1 + Math.random() * 3;
    let cx = Math.random() * W;
    ctx.beginPath(); ctx.moveTo(cx, -4);
    for (let y = 0; y <= H; y += 18) { cx += (Math.random() - 0.5) * 5; ctx.lineTo(cx, y); }
    ctx.stroke();
  }
  ctx.globalAlpha = 0.3;                              // a couple of knots
  for (let i = 0; i < 3; i++) {
    const kx = Math.random() * W, ky = Math.random() * H;
    for (let r = 9; r > 0; r -= 2) {
      ctx.strokeStyle = r % 4 ? '#5f3f26' : '#7a5334'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(kx, ky, r * 0.7, r, 0, 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  return finish(canvas, { repeatX: 1, repeatY: 2 });
}

/** Painted soft foliage — mottled leaf clumps with gentle green variation. */
export function makeFoliageTexture() {
  const W = 256, H = 256;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#75b34c'; ctx.fillRect(0, 0, W, H);
  paintDabs(ctx, W, H, '#4d8a38', 0.4, 26, 14, 36);  // deep shade pockets
  paintDabs(ctx, W, H, '#5a9a3e', 0.5, 38, 12, 32);  // darker leaf clumps
  paintDabs(ctx, W, H, '#a0d06a', 0.45, 38, 12, 30); // lighter clumps
  paintDabs(ctx, W, H, '#c8e59a', 0.28, 18, 8, 20);  // pale sun highlights
  ctx.globalAlpha = 0.4;                              // tiny leaf dabs
  for (let i = 0; i < 130; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? '#6fb046' : '#8fc862';
    ctx.beginPath();
    ctx.ellipse(Math.random() * W, Math.random() * H, 2 + Math.random() * 3, 1 + Math.random() * 2, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return finish(canvas, { tiled: true });
}

/** Painted grass + moss for park lawns — soft, gently varied. */
export function makeParkGrassTexture() {
  const W = 256, H = 256;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#8fc25a'; ctx.fillRect(0, 0, W, H);
  paintDabs(ctx, W, H, '#79ab4a', 0.4, 30, 20, 52);  // darker grass
  paintDabs(ctx, W, H, '#a6d472', 0.35, 30, 18, 48); // lighter grass
  paintDabs(ctx, W, H, '#6f9a5a', 0.3, 14, 16, 42);  // mossy (bluer) patches
  ctx.globalAlpha = 0.32;                            // grass-blade dabs
  for (let i = 0; i < 260; i++) {
    ctx.strokeStyle = Math.random() < 0.5 ? '#6fa348' : '#a3d06a';
    ctx.lineWidth = 1;
    const x = Math.random() * W, y = Math.random() * H, len = 3 + Math.random() * 4;
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * 0.6;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return finish(canvas, { repeatX: 4, repeatY: 4 });
}

/** Very subtle worn-stucco grain (average ≈ white) to multiply over vertex-
 *  coloured walls/roofs without shifting their colour — just adds hand-painted
 *  texture. */
export function makeStuccoTexture() {
  const W = 128, H = 128;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 46; i++) {
    ctx.globalAlpha = 0.03 + Math.random() * 0.04;
    ctx.fillStyle = Math.random() < 0.5 ? '#4a4038' : '#ffffff';
    ctx.beginPath(); ctx.arc(Math.random() * W, Math.random() * H, 5 + Math.random() * 22, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 0.05; ctx.strokeStyle = '#4a4038'; ctx.lineWidth = 1; // faint worn cracks
  for (let i = 0; i < 8; i++) {
    let x = Math.random() * W, y = Math.random() * H;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 4; s++) { x += (Math.random() - 0.5) * 26; y += (Math.random() - 0.5) * 26; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return finish(canvas, { repeatX: 2, repeatY: 2 });
}

// A tileable brick-wall texture: staggered courses of warm terracotta bricks
// with grey mortar, gentle per-brick colour variation, top-light / bottom-shade
// on each brick, and a little grime. Used for the MRT platform safety wall.
export function makeBrickTexture() {
  const W = 128, H = 128;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#b3a48f'; ctx.fillRect(0, 0, W, H); // mortar base
  const bw = 26, bh = 12, gap = 3;
  const cols = ['#9c4b3b', '#a85a44', '#8f4433', '#af6450', '#96503e', '#a15544'];
  let row = 0;
  for (let y = 0; y < H; y += bh + gap) {
    const off = (row % 2) * (bw + gap) / 2;
    for (let x = -bw; x < W; x += bw + gap) {
      const bx = x + off + gap / 2, by = y + gap / 2;
      ctx.fillStyle = cols[Math.floor(Math.random() * cols.length)];
      ctx.fillRect(bx, by, bw, bh);
      ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(bx, by, bw, 2);          // top light
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(bx, by + bh - 2, bw, 2);       // bottom shade
    }
    row++;
  }
  ctx.globalAlpha = 0.05; ctx.fillStyle = '#3a2f28'; // faint grime blotches
  for (let i = 0; i < 14; i++) {
    ctx.beginPath(); ctx.arc(Math.random() * W, Math.random() * H, 4 + Math.random() * 14, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  return finish(canvas, { repeatX: 3, repeatY: 0.8 });
}

/**
 * Turn a pooled facade art set into repeat-tiled textures for one building
 * size. Returns { map, emissiveMap } with matching repeats.
 */
export function facadeTextures(set, repeatX, repeatY) {
  return {
    map: toTexture(set.canvas, repeatX, repeatY),
    emissiveMap: toTexture(set.emCanvas, repeatX, repeatY),
  };
}

// ---------------------------------------------------------------------------
// Storefront art — a signboard, a striped awning, and a lit shopfront window.
// Each shop type passes its own colors/label/icon so the street reads as a
// row of distinct little businesses.
// ---------------------------------------------------------------------------

/** A readable signboard: colored panel with an emoji icon + the shop name. */
export function makeShopSign(shop) {
  const W = 320;
  const H = 96;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = shop.signBg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = shop.awn;
  ctx.lineWidth = 7;
  ctx.strokeRect(5, 5, W - 10, H - 10);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.font = '54px serif';
  ctx.fillText(shop.icon, 52, H / 2 + 4); // emoji icon

  ctx.fillStyle = '#f6ecd8';
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(shop.label, 96, H / 2 + 2); // shop name

  return finish(canvas, { tiled: false });
}

/** A metro-style MRT station name board: navy panel, roundel, accent line. */
export function makeStationSign(name) {
  const W = 320, H = 88;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1b2740'; ctx.fillRect(0, 0, W, H);          // navy panel
  ctx.fillStyle = '#3a7bd0';
  ctx.fillRect(0, 0, W, 7); ctx.fillRect(0, H - 12, W, 12);      // accent lines
  // Station roundel (ring + bar).
  ctx.strokeStyle = '#e8edf4'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(46, H / 2 - 2, 21, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#3a7bd0'; ctx.fillRect(22, H / 2 - 7, 48, 10);
  // Name.
  ctx.fillStyle = '#f2f6fb';
  ctx.font = 'bold 38px system-ui, sans-serif';
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText(name, 84, H / 2 - 1);
  return finish(canvas, { tiled: false });
}

/**
 * A tall vertical ramen-shop sign — a warm paper panel in a wooden frame with
 * bold red ラーメン (ramen) stacked down it. Used as BOTH the colour map and the
 * emissive map so it glows warmly (and reads as lit at night).
 */
export function makeRamenSign() {
  const W = 128, H = 384;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#5a3a22'; ctx.fillRect(0, 0, W, H);          // wooden frame
  ctx.fillStyle = '#f4e6c6'; ctx.fillRect(9, 9, W - 18, H - 18); // warm paper panel
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(9, 9, W - 18, 28);                               // red band top
  ctx.fillRect(9, H - 37, W - 18, 28);                          // red band bottom
  const chars = ['ラ', 'ー', 'メ', 'ン'];
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#a5281f';
  ctx.font = 'bold 62px "Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans JP","Meiryo",sans-serif';
  const top = 56, cellH = (H - 112) / chars.length;
  for (let i = 0; i < chars.length; i++) ctx.fillText(chars[i], W / 2, top + cellH * (i + 0.5));
  return finish(canvas, { tiled: false });
}

/**
 * A reusable civic-building facade: a material pattern (brick / ashlar stone /
 * modern panels), a base plinth + top cornice band, a grid of framed windows
 * (optionally barred), and subtle wear — so no wall is a flat single colour.
 * Returns { map, emissiveMap }; the emissive map lights a few windows at night.
 * Made once per building type and shared across every instance.
 */
export function makeCivicFacade(style = {}) {
  const {
    base = '#d8cfb8', pattern = 'panel',
    plinth = '#b8ac90', cornice = '#c8bfa6',
    winCols = 4, winRows = 2, glass = '#bcd2dc', frame = '#6b5a44', lit = '#ffdca0',
    bars = false, wear = true,
  } = style;
  const W = 256, H = 168;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const emc = makeCanvas(W, H);
  const em = emc.getContext('2d');
  em.fillStyle = '#000'; em.fillRect(0, 0, W, H);

  ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);

  // Material pattern (mortar / panel lines).
  ctx.strokeStyle = 'rgba(0,0,0,0.13)'; ctx.lineWidth = 1.4;
  const hline = (y) => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); };
  const vseg = (x, y0, y1) => { ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); };
  if (pattern === 'brick') {
    for (let y = 0, r = 0; y < H; y += 11, r++) { hline(y); const o = (r % 2) * 19; for (let x = o; x < W; x += 38) vseg(x, y, y + 11); }
  } else if (pattern === 'ashlar') {
    for (let y = 0, r = 0; y < H; y += 24, r++) { hline(y); const o = (r % 2) * 32; for (let x = o; x < W; x += 64) vseg(x, y, y + 24); }
  } else { // panel
    for (let x = 0; x <= W; x += 42) vseg(x, 0, H);
    for (let y = 0; y <= H; y += 46) hline(y);
  }

  // Plinth (bottom) + cornice (top) bands.
  ctx.fillStyle = plinth; ctx.fillRect(0, H - 26, W, 26);
  ctx.fillStyle = cornice; ctx.fillRect(0, 0, W, 16);
  ctx.fillStyle = 'rgba(0,0,0,0.16)'; ctx.fillRect(0, 16, W, 2); ctx.fillRect(0, H - 27, W, 2);

  // Framed windows (+ optional bars) and a few lit ones on the emissive map.
  const wTop = 26, wBot = H - 34, areaH = wBot - wTop;
  const cellW = W / winCols, cellH = areaH / winRows;
  for (let r = 0; r < winRows; r++) {
    for (let c = 0; c < winCols; c++) {
      const cx = cellW * (c + 0.5), cy = wTop + cellH * (r + 0.5);
      const ww = cellW * 0.5, wh = cellH * 0.6;
      ctx.fillStyle = frame; ctx.fillRect(cx - ww / 2 - 3, cy - wh / 2 - 3, ww + 6, wh + 6);
      ctx.fillStyle = glass; ctx.fillRect(cx - ww / 2, cy - wh / 2, ww, wh);
      ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(cx - ww / 2, cy - wh / 2, ww * 0.3, wh * 0.62);
      ctx.fillStyle = 'rgba(60,50,40,0.4)'; ctx.fillRect(cx - 1, cy - wh / 2, 2, wh);
      if (bars) { ctx.fillStyle = 'rgba(40,42,48,0.75)'; for (let bx = -ww / 2 + 4; bx < ww / 2; bx += 6) ctx.fillRect(cx + bx, cy - wh / 2, 1.4, wh); }
      if ((r * winCols + c) % 3 === 1) { em.fillStyle = lit; em.fillRect(cx - ww / 2, cy - wh / 2, ww, wh); }
    }
  }

  // Subtle wear: soft grime blotches + streaks under the cornice.
  if (wear) {
    ctx.fillStyle = '#3a2f22';
    ctx.globalAlpha = 0.05;
    for (let i = 0; i < 36; i++) { const x = Math.random() * W, y = Math.random() * H, rr = 3 + Math.random() * 9; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 0.07;
    for (let i = 0; i < 14; i++) ctx.fillRect(Math.random() * W, 18, 2, 8 + Math.random() * 22);
    ctx.globalAlpha = 1;
  }

  return { map: finish(canvas, { tiled: false }), emissiveMap: finish(emc, { tiled: false }) };
}

/** A striped awning texture in the shop's color. */
export function makeAwningTexture(colorCss) {
  const W = 128;
  const H = 64;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const stripes = 7;
  const sw = W / stripes;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? colorCss : '#f4ecd8';
    ctx.fillRect(i * sw, 0, sw + 1, H);
  }
  return finish(canvas, { tiled: true });
}

/**
 * A ground-floor shopfront: a big glass display window and a glass door, with a
 * warm interior. Returns { map, emissiveMap } so the interior glows at night.
 * Shared by every shop (one material) — the awning/sign give each its identity.
 */
export function makeShopfrontTexture() {
  const W = 256;
  const H = 256;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const emCanvas = makeCanvas(W, H);
  const em = emCanvas.getContext('2d');
  em.fillStyle = '#000000';
  em.fillRect(0, 0, W, H);

  const m = 16;
  ctx.fillStyle = '#5b4a3a'; // wooden frame
  ctx.fillRect(0, 0, W, H);

  // Display window (left ~2/3).
  const wgX = m;
  const wgW = W * 0.62 - m;
  ctx.fillStyle = '#bfe0ef';
  ctx.fillRect(wgX, m, wgW, H - m * 2);
  // Warm lit interior in the lower half.
  ctx.fillStyle = '#ffe3b0';
  ctx.fillRect(wgX, H * 0.46, wgW, H * 0.54 - m);
  em.fillStyle = '#ffd89a';
  em.fillRect(wgX, H * 0.46, wgW, H * 0.54 - m);
  // Mullions.
  ctx.fillStyle = 'rgba(70,55,40,0.5)';
  ctx.fillRect(wgX + wgW / 2 - 2, m, 4, H - m * 2);
  ctx.fillRect(wgX, H / 2 - 2, wgW, 4);

  // Glass door (right ~1/3).
  const dX = W * 0.66;
  const dW = W - dX - m;
  ctx.fillStyle = '#7a5230';
  ctx.fillRect(dX, m, dW, H - m * 2);
  ctx.fillStyle = '#a9cfe0';
  ctx.fillRect(dX + 6, m + 8, dW - 12, H * 0.42);
  em.fillStyle = '#cdd8c4';
  em.fillRect(dX + 6, H * 0.55, dW - 12, H * 0.4 - m);
  ctx.fillStyle = '#ffe3b0';
  ctx.fillRect(dX + 6, H * 0.55, dW - 12, H * 0.4 - m);
  ctx.fillStyle = '#d8c15a'; // handle
  ctx.fillRect(dX + 9, H * 0.6, 6, 22);

  return {
    map: finish(canvas, { tiled: false }),
    emissiveMap: finish(emCanvas, { tiled: false }),
  };
}

/** Warm sandy ground with layered mottling — richer, painterly, still cartoon. */
export function makeGroundTexture() {
  const S = 512;
  const canvas = makeCanvas(S, S);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#e6d3a3';
  ctx.fillRect(0, 0, S, S);

  const blob = (colors, count, min, max, alpha) => {
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
      ctx.globalAlpha = alpha;
      const r = min + Math.random() * (max - min);
      ctx.beginPath();
      ctx.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  // Large tonal variation, dry-grass green patches, then finer sand mottling.
  blob(['#e9d8ab', '#ddc793', '#e2cf9c', '#d9d3a0'], 60, 40, 90, 0.35);
  blob(['#c7cf8e', '#b9c882', '#cdd39a'], 40, 18, 50, 0.28);
  blob(['#ddc793', '#ecdcb0', '#d8cc9a', '#e8d7a8'], 200, 6, 22, 0.4);
  ctx.globalAlpha = 1;

  // Tiny pebble speckle.
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.random() < 0.06) {
      const n = (Math.random() - 0.5) * 40;
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n;
    }
  }
  ctx.putImageData(img, 0, 0);

  return toTexture(canvas, 40, 40);
}

/** A soft sandy path tile with mottling and a gentle cream center line. */
export function makeRoadTexture() {
  const W = 128;
  const H = 512;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#cdb98a';
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < 140; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? '#c4ae7d' : '#d6c395';
    ctx.globalAlpha = 0.4;
    const r = 4 + Math.random() * 12;
    ctx.beginPath();
    ctx.arc(Math.random() * W, Math.random() * H, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Curb edges + dashed cream center line.
  ctx.fillStyle = 'rgba(90,74,52,0.35)';
  ctx.fillRect(3, 0, 3, H);
  ctx.fillRect(W - 6, 0, 3, H);
  ctx.fillStyle = '#f4ead0';
  const dashH = 44;
  const dashGap = 44;
  for (let y = 10; y < H; y += dashH + dashGap) {
    ctx.fillRect(W / 2 - 4, y, 8, dashH);
  }

  return toTexture(canvas, 1, 1);
}

// ---------------------------------------------------------------------------
// Neo-Tokyo neon signage — bright art painted on a near-black panel and used as
// BOTH the colour map and the emissive map, so a sign reads as a lit board by
// day and TRULY glows once the day-night ramp raises its emissiveIntensity (and
// the bloom pass halos the brightest tubes). A small pool is generated once in
// city.js and reused across the whole skyline via InstancedMesh.
// ---------------------------------------------------------------------------
const NEON = ['#ff2d95', '#18e0ff', '#ff3131', '#b558ff', '#ffe11a', '#39ff9e']; // pink, cyan, red, purple, yellow, green
// Single kanji for vertical stacks…
const NEON_KANJI = ['寿', '司', '麺', '酒', '湯', '力', '龍', '猫', '星', '光', '夢', '花', '月', '風', '神', '電', '気', '薬', '楽', '天', '食', '堂', '夜', '都', '海', '山', '火', '水', '鳥', '雷'];
// …and short kanji/katakana words for billboards + storefronts.
const NEON_WORDS = ['ラーメン', '寿司', '居酒屋', 'カラオケ', '電気', '珈琲', 'バー', 'ホテル', '東京', 'ネオン', 'クラブ', '食堂', '焼肉', '酒場', '薬局', '書店', '喫茶', '麻雀'];

const neonFont = (size, weight = '900') =>
  `${weight} ${Math.round(size)}px "Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans JP","Meiryo",system-ui,sans-serif`;
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// A hot neon glyph/word: a coloured glow halo + a bright near-white core.
function glowText(ctx, text, x, y, color, size, weight = '900') {
  ctx.font = neonFont(size, weight);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = size * 0.55;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.fillText(text, x, y); // twice → denser glow
  ctx.shadowBlur = size * 0.26;
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x, y); // white-hot core
  ctx.restore();
}

/** Tall vertical shop sign: a neon frame around a stack of glowing kanji. */
export function makeVerticalSign(rng = Math.random) {
  const W = 128, H = 512;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#08080f';
  ctx.fillRect(0, 0, W, H);
  const frame = pick(rng, NEON);
  ctx.save();
  ctx.shadowColor = frame; ctx.shadowBlur = 16;
  ctx.strokeStyle = frame; ctx.lineWidth = 7;
  roundRectPath(ctx, 9, 9, W - 18, H - 18, 12);
  ctx.stroke();
  ctx.restore();
  const n = 3 + Math.floor(rng() * 2); // 3–4 characters
  const mono = rng() < 0.5 ? frame : null; // some signs are one colour
  const pad = 34;
  const cellH = (H - pad * 2) / n;
  for (let i = 0; i < n; i++) {
    glowText(ctx, pick(rng, NEON_KANJI), W / 2, pad + cellH * (i + 0.5), mono || pick(rng, NEON), cellH * 0.7);
  }
  return finish(canvas, { tiled: false });
}

/** Large billboard: neon frame, accent bars, a big word + a subtitle. */
export function makeBillboard(rng = Math.random) {
  const W = 512, H = 320;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0a0a16';
  ctx.fillRect(0, 0, W, H);
  const a = pick(rng, NEON), b = pick(rng, NEON);
  ctx.save();
  ctx.shadowColor = a; ctx.shadowBlur = 22; ctx.fillStyle = a;
  ctx.fillRect(26, 26, W - 52, 12);            // top accent bar
  ctx.shadowColor = b; ctx.fillStyle = b;
  ctx.fillRect(26, H - 38, W - 52, 12);        // bottom accent bar
  ctx.restore();
  ctx.save();
  ctx.shadowColor = b; ctx.shadowBlur = 18; ctx.strokeStyle = b; ctx.lineWidth = 6;
  roundRectPath(ctx, 12, 12, W - 24, H - 24, 16);
  ctx.stroke();
  ctx.restore();
  const word = pick(rng, NEON_WORDS);
  glowText(ctx, word, W / 2, H / 2 - 6, pick(rng, NEON), word.length > 3 ? 92 : 128);
  glowText(ctx, pick(rng, NEON_WORDS), W / 2, H - 62, pick(rng, NEON), 40, '700');
  return finish(canvas, { tiled: false });
}

/** Horizontal storefront sign: a glowing word over an underline, end blocks. */
export function makeStorefrontSign(rng = Math.random) {
  const W = 512, H = 96;
  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#08080f';
  ctx.fillRect(0, 0, W, H);
  const c = pick(rng, NEON), c2 = pick(rng, NEON);
  ctx.save();
  ctx.shadowColor = c; ctx.shadowBlur = 16; ctx.fillStyle = c;
  ctx.fillRect(20, H - 20, W - 40, 8);         // glowing underline
  ctx.shadowColor = c2; ctx.fillStyle = c2;
  ctx.fillRect(16, 20, 14, H - 46);            // end blocks
  ctx.fillRect(W - 30, 20, 14, H - 46);
  ctx.restore();
  glowText(ctx, pick(rng, NEON_WORDS), W / 2, H / 2 - 4, pick(rng, NEON), 56, '800');
  return finish(canvas, { tiled: false });
}
