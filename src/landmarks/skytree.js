import * as THREE from 'three';
import { cyl, box, merge, strut, C } from './common.js';

// Skytree-style broadcast tower — a very tall, slender tapering shaft with two
// observation bulbs and a long thin gain-tower antenna. Its signature vertical
// LED strands slowly cycle blue → purple and blaze at night; a red beacon blinks
// on top. The tallest thing on the map by far.
export function buildSkytree(mats) {
  const g = new THREE.Group();
  const STEEL = '#c3cad2', WHITEB = '#e8edf2', DARK = '#5a6270';
  const H = 210;

  const parts = [box(34, 0.6, 34, 0, 0.3, 0, STEEL)]; // foundation pad
  // Tapering shaft (stacked 6-sided segments — triangular base feel → slim top).
  const stack = [
    { r0: 12, r1: 8, y0: 0, h: 72 },
    { r0: 8, r1: 5, y0: 72, h: 72 },
    { r0: 5, r1: 3, y0: 144, h: 56 },
  ];
  for (const s of stack) parts.push(cyl(s.r1, s.r0, s.h, 6, 0, s.y0 + s.h / 2, 0, STEEL));
  // Observation decks (Tembo Deck + Galleria).
  parts.push(cyl(9, 9, 6, 12, 0, 148, 0, WHITEB));
  parts.push(cyl(9.4, 9.4, 1.2, 12, 0, 151.6, 0, DARK));
  parts.push(cyl(5.6, 5.6, 5, 12, 0, 184, 0, WHITEB));
  parts.push(cyl(5.9, 5.9, 1.0, 12, 0, 187, 0, DARK));
  // Gain tower (antenna) — long and thin.
  parts.push(cyl(1.2, 2.6, 42, 6, 0, H + 21, 0, STEEL));
  parts.push(cyl(0.2, 0.6, 28, 6, 0, H + 55, 0, DARK));

  const struct = new THREE.Mesh(merge(parts), mats.structMat);
  struct.castShadow = struct.receiveShadow = true;
  g.add(struct);

  // Deck window glow — warms at night via the shared glow material.
  const glow = [
    cyl(9.05, 9.05, 2.6, 12, 0, 148, 0, '#ffe6ad'),
    cyl(5.65, 5.65, 2.4, 12, 0, 184, 0, '#ffe6ad'),
  ];
  g.add(new THREE.Mesh(merge(glow), mats.glowMat));

  // Signature vertical LED strands up the shaft (own emissive material, ramped).
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x1a2a55, toneMapped: false });
  const leds = [];
  const strands = 9;
  for (let i = 0; i < strands; i++) {
    const a = (i / strands) * Math.PI * 2;
    leds.push(strut(Math.cos(a) * 11.5, 0, Math.sin(a) * 11.5, Math.cos(a) * 3.2, 198, Math.sin(a) * 3.2, 0.35, '#3a6bff'));
  }
  g.add(new THREE.Mesh(merge(leds), ledMat));

  // Red beacon on the gain tower.
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false })
  );
  beacon.position.set(0, H + 72, 0);
  g.add(beacon);
  const beaconLight = new THREE.PointLight(0xff3a2a, 0, 70, 2);
  beaconLight.position.copy(beacon.position);
  g.add(beaconLight);

  const _c = new THREE.Color();
  let t = 0;
  function update(dt, night) {
    t += dt;
    // Strands cycle blue → purple, and brighten at night.
    const hue = 0.62 + 0.07 * Math.sin(t * 0.3);
    const f = 0.14 + night * 1.0;
    _c.setHSL(hue, 0.9, Math.min(0.6, 0.12 + 0.5 * f));
    ledMat.color.copy(_c);
    const blink = Math.sin(t * 2.3) > 0.2 ? 1 : 0.12;
    beacon.scale.setScalar(0.8 + blink * 0.5);
    beaconLight.intensity = (0.3 + night) * 16 * blink;
  }
  update(0, 0);
  return { group: g, update };
}
