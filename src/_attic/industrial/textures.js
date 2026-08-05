import * as THREE from 'three';

// Procedural canvas textures for the industrial props. Each is generated ONCE
// and cached, so the dozens of shipping containers, both cranes and the factory
// all share a single texture / material (cheap, InstancedMesh-friendly).

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// ---- Shipping-container atlas (2×2 cells: SIDE, DOOR, END, TOP) -------------
// One 256² texture; the container box's UVs are remapped so each face samples
// the right cell (see containerGeometry). The art is near-white/greyscale so a
// per-instance colour multiplies through to give varied faded container bodies,
// while rust / logos / IDs read as painted markings on any colour.
let _atlas = null;
export function containerAtlas() {
  if (_atlas) return _atlas;
  const cv = canvas(256, 256);
  const x = cv.getContext('2d');
  const C = 128;

  // SIDE — top-left: vertical corrugation + rust streaks + faded logo + ID.
  const side = (ox, oy) => {
    x.fillStyle = '#ececec'; x.fillRect(ox, oy, C, C);
    for (let i = 0; i < C; i += 4) {
      x.fillStyle = 'rgba(0,0,0,0.10)'; x.fillRect(ox + i, oy, 1.6, C);
      x.fillStyle = 'rgba(255,255,255,0.16)'; x.fillRect(ox + i + 2, oy, 1.3, C);
    }
    x.fillStyle = 'rgba(30,30,34,0.22)'; x.fillRect(ox, oy, C, 7); x.fillRect(ox, oy + C - 7, C, 7);
    for (let i = 0; i < 5; i++) {
      const rx = ox + 12 + i * 24 + ((i * 37) % 9), rh = 22 + ((i * 53) % 55);
      const g = x.createLinearGradient(0, oy + 7, 0, oy + 7 + rh);
      g.addColorStop(0, 'rgba(110,58,30,0.30)'); g.addColorStop(1, 'rgba(110,58,30,0)');
      x.fillStyle = g; x.fillRect(rx, oy + 7, 3, rh);
    }
    x.globalAlpha = 0.55; x.fillStyle = '#d8d2c6'; x.fillRect(ox + 42, oy + 40, 44, 24); x.globalAlpha = 1;
    x.fillStyle = 'rgba(60,64,72,0.5)'; x.font = 'bold 15px sans-serif'; x.fillText('MSK', ox + 50, oy + 58);
    x.fillStyle = 'rgba(40,40,44,0.5)'; x.font = 'bold 10px monospace'; x.fillText('TCLU 4827 21', ox + 26, oy + 88);
    x.fillStyle = 'rgba(0,0,0,0.10)'; x.fillRect(ox, oy, 10, 18); x.fillRect(ox + C - 10, oy, 10, 18);
  };
  // DOOR — top-right: horizontal ribs, centre seam, 4 locking bars, hinges, ID.
  const door = (ox, oy) => {
    x.fillStyle = '#e6e6e6'; x.fillRect(ox, oy, C, C);
    for (let i = 6; i < C - 6; i += 5) {
      x.fillStyle = 'rgba(0,0,0,0.08)'; x.fillRect(ox, oy + i, C, 1.4);
      x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(ox, oy + i + 2, C, 1.1);
    }
    x.fillStyle = 'rgba(30,30,34,0.25)';
    x.fillRect(ox, oy, C, 7); x.fillRect(ox, oy + C - 7, C, 7); x.fillRect(ox, oy, 7, C); x.fillRect(ox + C - 7, oy, 7, C);
    x.fillStyle = 'rgba(20,20,24,0.3)'; x.fillRect(ox + C / 2 - 1, oy + 6, 2, C - 12);
    for (const b of [26, 52, 76, 102]) {
      x.fillStyle = 'rgba(38,38,42,0.72)'; x.fillRect(ox + b, oy + 8, 3.5, C - 16);      // bar
      x.fillStyle = 'rgba(20,20,24,0.85)'; x.fillRect(ox + b - 2, oy + 58, 8, 11);        // handle
      x.fillStyle = 'rgba(55,55,60,0.8)'; x.fillRect(ox + b - 1, oy + 14, 6, 5); x.fillRect(ox + b - 1, oy + C - 20, 6, 5); // keepers
    }
    x.fillStyle = 'rgba(40,40,44,0.7)';
    for (const hy of [16, 60, 104]) { x.fillRect(ox + 3, oy + hy, 6, 10); x.fillRect(ox + C - 9, oy + hy, 6, 10); }
    x.fillStyle = 'rgba(214,210,198,0.7)'; x.fillRect(ox + 44, oy + 30, 40, 12);
    x.fillStyle = 'rgba(40,40,44,0.6)'; x.font = 'bold 8px monospace'; x.fillText('4827 21', ox + 48, oy + 39);
    const g = x.createLinearGradient(0, oy + C - 30, 0, oy + C);
    g.addColorStop(0, 'rgba(110,58,30,0)'); g.addColorStop(1, 'rgba(110,58,30,0.28)');
    x.fillStyle = g; x.fillRect(ox, oy + C - 30, C, 30);
  };
  // END — bottom-left: corrugated end panel + frame + faint type code + rust.
  const end = (ox, oy) => {
    x.fillStyle = '#e9e9e9'; x.fillRect(ox, oy, C, C);
    for (let i = 6; i < C - 6; i += 5) {
      x.fillStyle = 'rgba(0,0,0,0.08)'; x.fillRect(ox, oy + i, C, 1.3);
      x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(ox, oy + i + 2, C, 1.0);
    }
    x.fillStyle = 'rgba(30,30,34,0.22)';
    x.fillRect(ox, oy, C, 7); x.fillRect(ox, oy + C - 7, C, 7); x.fillRect(ox, oy, 7, C); x.fillRect(ox + C - 7, oy, 7, C);
    x.fillStyle = 'rgba(45,45,50,0.4)'; x.font = 'bold 9px monospace'; x.fillText('22G1', ox + 50, oy + 68);
    const g = x.createLinearGradient(0, oy + C - 26, 0, oy + C);
    g.addColorStop(0, 'rgba(110,58,30,0)'); g.addColorStop(1, 'rgba(110,58,30,0.24)');
    x.fillStyle = g; x.fillRect(ox, oy + C - 26, C, 26);
  };
  // TOP — bottom-right: longitudinal ribs, corner castings, rust patches.
  const top = (ox, oy) => {
    x.fillStyle = '#d8d8d6'; x.fillRect(ox, oy, C, C);
    for (let i = 14; i < C; i += 14) { x.fillStyle = 'rgba(0,0,0,0.10)'; x.fillRect(ox, oy + i, C, 1.4); }
    x.fillStyle = 'rgba(40,40,44,0.55)';
    x.fillRect(ox + 2, oy + 2, 14, 14); x.fillRect(ox + C - 16, oy + 2, 14, 14);
    x.fillRect(ox + 2, oy + C - 16, 14, 14); x.fillRect(ox + C - 16, oy + C - 16, 14, 14);
    for (let i = 0; i < 6; i++) {
      x.fillStyle = 'rgba(110,58,30,0.16)';
      x.beginPath(); x.arc(ox + 20 + i * 16, oy + 30 + ((i * 29) % 60), 6 + ((i * 13) % 8), 0, Math.PI * 2); x.fill();
    }
  };

  side(0, 0); door(128, 0); end(0, 128); top(128, 128);

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  _atlas = t; return t;
}

// A container box (6×2.6×2.5) with its UVs remapped into the atlas cells:
// long sides → SIDE, one end → DOOR, the other → END, top/bottom → TOP. Cached.
let _contGeo = null;
export function containerGeometry() {
  if (_contGeo) return _contGeo;
  const geo = new THREE.BoxGeometry(6, 2.6, 2.5);
  const uv = geo.attributes.uv;
  // BoxGeometry face order: +X, -X, +Y, -Y, +Z, -Z  (4 verts each).
  const cell = [
    [0.0, 0.0], // +X END
    [0.5, 0.5], // -X DOOR
    [0.5, 0.0], // +Y TOP
    [0.5, 0.0], // -Y TOP
    [0.0, 0.5], // +Z SIDE
    [0.0, 0.5], // -Z SIDE
  ];
  for (let f = 0; f < 6; f++) {
    const [ou, ov] = cell[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * 0.5 + ou, uv.getY(i) * 0.5 + ov);
    }
  }
  uv.needsUpdate = true;
  _contGeo = geo; return geo;
}

// ---- Crane lattice / truss (greyscale, multiplies over the crane colour) ----
let _lattice = null;
export function latticeTexture() {
  if (_lattice) return _lattice;
  const S = 128, cv = canvas(S, S), x = cv.getContext('2d');
  x.fillStyle = '#dedede'; x.fillRect(0, 0, S, S);           // near-white base
  x.strokeStyle = 'rgba(35,35,40,0.5)';
  x.lineWidth = 7; x.strokeRect(3, 3, S - 6, S - 6);          // edge chords
  x.lineWidth = 6; x.beginPath();
  x.moveTo(4, 4); x.lineTo(S - 4, S - 4); x.moveTo(S - 4, 4); x.lineTo(4, S - 4); x.stroke(); // X brace
  x.lineWidth = 4; x.beginPath(); x.moveTo(4, S / 2); x.lineTo(S - 4, S / 2); x.stroke();      // mid chord
  x.fillStyle = 'rgba(20,20,24,0.5)';
  for (const [bx, by] of [[8, 8], [S - 8, 8], [8, S - 8], [S - 8, S - 8], [S / 2, S / 2]]) {
    x.beginPath(); x.arc(bx, by, 3, 0, Math.PI * 2); x.fill();  // bolts
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 2);
  _lattice = t; return t;
}

// ---- Corrugated metal siding (full colour: steel base + ribs + rust) --------
let _siding = null;
export function corrugatedSiding() {
  if (_siding) return _siding;
  const W = 128, H = 128, cv = canvas(W, H), x = cv.getContext('2d');
  x.fillStyle = '#9aa6ad'; x.fillRect(0, 0, W, H);            // steel-blue base
  for (let i = 0; i < W; i += 6) {                             // vertical corrugation
    x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(i, 0, 2.4, H);
    x.fillStyle = 'rgba(255,255,255,0.14)'; x.fillRect(i + 3, 0, 2.0, H);
  }
  x.fillStyle = 'rgba(40,45,50,0.25)'; x.fillRect(0, H * 0.5 - 1, W, 2);  // mid seam
  x.fillStyle = 'rgba(255,255,255,0.10)'; x.fillRect(0, 0, W, 4);          // top flashing
  for (let i = 0; i < 4; i++) {                                            // light rust streaks
    const rx = 8 + i * 32 + ((i * 17) % 12);
    const g = x.createLinearGradient(0, H * 0.5, 0, H);
    g.addColorStop(0, 'rgba(120,62,32,0.30)'); g.addColorStop(1, 'rgba(120,62,32,0)');
    x.fillStyle = g; x.fillRect(rx, H * 0.5, 3.5, H * 0.45);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 1);
  _siding = t; return t;
}
