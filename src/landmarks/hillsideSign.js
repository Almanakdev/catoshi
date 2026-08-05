import * as THREE from 'three';
import { cyl, instanced, C } from './common.js';

// Hillside letters sign — big 3D block letters standing on a conical hill at the
// city edge (à la VINEWOOD). Every letter "pixel" is one instanced box, and the
// letters use the shared glow material so the whole sign lights up at night.
//
// Each glyph is a 5x7 bitmap. The pixel size is DERIVED from SIGN_WIDTH rather
// than fixed, so the sign keeps the same span across the hillside whatever the
// word says — a longer word just gets proportionally smaller letters instead of
// running off the side of the hill.
const FONT = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['#####', '#....', '#....', '#####', '....#', '....#', '#####'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '#####'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

const WORD = 'URBAN HOOD';
const SIGN_WIDTH = 98;   // how far the sign spans across the hillside

export function buildHillsideSign(mats) {
  const g = new THREE.Group();
  const word = WORD;
  // Columns = 5 per glyph plus a one-pixel gap between them.
  const cols = word.length * 5 + (word.length - 1);
  const PX = SIGN_WIDTH / cols;
  const gap = PX; // between letters
  const letterW = 5 * PX;
  const totalW = word.length * letterW + (word.length - 1) * gap;
  const baseY = 30; // letters sit high on the hill
  const zFront = 18;

  // A sandy island base rising out of the sea, with the green hill on top — so
  // the sign stands on its own island, seen from across the water.
  const base = new THREE.Mesh(cyl(48, 64, 8, 24, 0, -3, 0, '#e3d2a0'), mats.structMat);
  base.receiveShadow = true;
  g.add(base);
  const hill = new THREE.Mesh(cyl(6, 50, 56, 20, 0, 25, 0, '#6f9a4a'), mats.structMat);
  hill.castShadow = hill.receiveShadow = true;
  g.add(hill);
  // A little terrace the letters stand on.
  const terrace = new THREE.Mesh(cyl(15, 18, 1.2, 20, 0, baseY - 0.6, 3, '#8a8574'), mats.structMat);
  g.add(terrace);

  // Letter pixels — one instanced box mesh (white; glows at night via glowMat).
  const pixGeo = new THREE.BoxGeometry(PX * 0.95, PX * 0.95, PX * 1.6);
  // paint white so the vertexColors glow material has colors to read.
  const n = pixGeo.attributes.position.count;
  const wc = new Float32Array(n * 3).fill(0.96);
  pixGeo.setAttribute('color', new THREE.BufferAttribute(wc, 3));
  const px = [];
  let x0 = -totalW / 2;
  for (const ch of word) {
    const bmp = FONT[ch];
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (bmp[r][c] === '#') px.push({ x: x0 + c * PX + PX / 2, y: baseY + (6 - r) * PX + PX / 2, z: zFront });
      }
    }
    x0 += letterW + gap;
  }
  g.add(instanced(pixGeo, mats.glowMat, px));
  return { group: g };
}
