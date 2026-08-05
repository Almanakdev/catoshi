import * as THREE from 'three';
import { box, cyl, merge, strut, C } from './common.js';

// Tokyo-Tower-style communications tower — a tapering red-and-white lattice on
// four legs with two observation decks, an antenna mast, "landmark light"
// strands up the legs that warm at night, and a blinking red aviation beacon.
export function buildTokyoTower(mats) {
  const g = new THREE.Group();
  const ORANGE = '#e8492b', WHITE = '#efe9df', STEEL = '#9aa0a6';
  const H = 118;              // lattice height
  const bw = 18, tw = 3.2;    // base / top half-width
  const segs = 9;
  const hwAt = (y) => bw + (tw - bw) * (y / H);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

  // Foundation pad (grounds it over the reclaimed water's edge).
  const parts = [box(bw * 2 + 12, 0.6, bw * 2 + 12, 0, 0.3, 0, STEEL)];

  for (let s = 0; s < segs; s++) {
    const y0 = (s / segs) * H, y1 = ((s + 1) / segs) * H;
    const hw0 = hwAt(y0), hw1 = hwAt(y1);
    const col = s % 2 === 0 ? ORANGE : WHITE;
    for (const [cx, cz] of corners) {                       // four tapering legs
      parts.push(strut(cx * hw0, y0, cz * hw0, cx * hw1, y1, cz * hw1, 1.4, col));
    }
    for (let k = 0; k < 4; k++) {                           // horizontal ring
      const a = corners[k], b = corners[(k + 1) % 4];
      parts.push(strut(a[0] * hw1, y1, a[1] * hw1, b[0] * hw1, y1, b[1] * hw1, 0.8, STEEL));
      // X bracing on each face
      parts.push(strut(a[0] * hw0, y0, a[1] * hw0, b[0] * hw1, y1, b[1] * hw1, 0.5, STEEL));
      parts.push(strut(b[0] * hw0, y0, b[1] * hw0, a[0] * hw1, y1, a[1] * hw1, 0.5, STEEL));
    }
  }

  // Observation decks.
  const deckY1 = H * 0.42, deckY2 = H * 0.72;
  const decks = [[deckY1, hwAt(deckY1)], [deckY2, hwAt(deckY2)]];
  for (const [y, hw] of decks) {
    parts.push(box(hw * 2.5, 4.6, hw * 2.5, 0, y, 0, WHITE));
    parts.push(box(hw * 2.65, 1.0, hw * 2.65, 0, y - 2.5, 0, STEEL));
  }

  // Antenna mast above the lattice.
  parts.push(box(tw * 1.7, 6, tw * 1.7, 0, H + 3, 0, ORANGE));
  for (let i = 0; i < 5; i++) parts.push(box(2.6 - i * 0.35, 8, 2.6 - i * 0.35, 0, H + 8 + i * 8, 0, i % 2 ? WHITE : ORANGE));
  parts.push(cyl(0.2, 0.5, 22, 6, 0, H + 55, 0, STEEL)); // top antenna

  const struct = new THREE.Mesh(merge(parts), mats.structMat);
  struct.castShadow = struct.receiveShadow = true;
  g.add(struct);

  // Deck window glow (warms at night via the shared glow material).
  const glow = [];
  for (const [y, hw] of decks) {
    for (const f of [0, 1, 2, 3]) {
      const gg = box(hw * 2.4, 2.2, 0.2, 0, y, hw * 2.5 + 0.02, '#ffe6ad');
      gg.rotateY((f * Math.PI) / 2);
      glow.push(gg);
    }
  }
  g.add(new THREE.Mesh(merge(glow), mats.glowMat));

  // "Landmark light" strands running up the outer legs — own emissive material,
  // dim by day and glowing warm-orange at night (ramped in update).
  const strandMat = new THREE.MeshBasicMaterial({ color: 0x3a2410, toneMapped: false });
  const strands = [];
  for (const [cx, cz] of corners) {
    strands.push(strut(cx * bw, 0, cz * bw, cx * tw, H, cz * tw, 0.45, '#ffb060'));
  }
  g.add(new THREE.Mesh(merge(strands), strandMat));

  // Blinking red aviation beacon on the mast tip.
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(1.0, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false })
  );
  beacon.position.set(0, H + 68, 0);
  g.add(beacon);
  const beaconLight = new THREE.PointLight(0xff3a2a, 0, 60, 2);
  beaconLight.position.copy(beacon.position);
  g.add(beaconLight);

  let t = 0;
  function update(dt, night) {
    t += dt;
    const f = 0.12 + night * 1.0;                 // warm strands ramp up at night
    strandMat.color.setRGB(1.0 * f, 0.66 * f, 0.32 * f);
    const blink = Math.sin(t * 2.5) > 0.2 ? 1 : 0.12;
    beacon.scale.setScalar(0.8 + blink * 0.5);
    beaconLight.intensity = (0.3 + night) * 14 * blink;
  }
  update(0, 0);
  return { group: g, update };
}
