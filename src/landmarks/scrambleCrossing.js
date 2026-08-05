import * as THREE from 'three';
import { box, merge, C } from './common.js';

// Shibuya-style scramble crossing — a reclaimed plaza with an X of zebra
// crosswalks, framed by boxy buildings that each carry a GIANT animated screen
// (a procedural shader "ad": scrolling bands, flickering cells, a sweeping bar).
// The screens run day + night but blaze brighter after dark (tied to `night`),
// and the building windows warm at night via the shared glow material.

// One animated-billboard material. `phase` staggers them; colours pick from the
// neon palette so each screen reads differently.
const NEON = [0xff2d95, 0x18e0ff, 0xffe11a, 0xb558ff, 0x39ff9e, 0xff3131];
function makeScreenMat(i) {
  const a = NEON[i % NEON.length];
  const b = NEON[(i * 3 + 2) % NEON.length];
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: i * 1.7 },
      uBright: { value: 0.8 },
      uColA: { value: new THREE.Color(a) },
      uColB: { value: new THREE.Color(b) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime, uBright;
      uniform vec3 uColA, uColB;
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9, 78.2))) * 43758.5453); }
      void main() {
        vec2 uv = vUv;
        float t = uTime;
        float bands = sin(uv.y * 20.0 - t * 3.5) * 0.5 + 0.5;          // scrolling bands
        vec2 cell = vec2(floor(uv.x * 8.0), floor(uv.y * 6.0));
        float flick = step(0.45, hash(cell + floor(t * 3.0)));         // flickering cells
        float bar = smoothstep(0.05, 0.0, abs(fract(uv.y * 0.5 - t * 0.12) - 0.5)); // sweep
        vec3 col = mix(uColA, uColB, bands);
        col *= mix(0.35, 1.15, flick);
        col += bar * 0.7;
        col *= 0.85 + 0.15 * sin(uv.y * 160.0);                        // fine scanlines
        gl_FragColor = vec4(col * uBright, 1.0);
      }
    `,
    toneMapped: false,
    fog: false,
  });
}

export function buildScrambleCrossing(mats) {
  const g = new THREE.Group();
  const { gradientMap, structMat, glowMat } = mats;
  const P = 60;

  // Reclaimed platform + asphalt plaza.
  const platform = new THREE.Mesh(
    new THREE.BoxGeometry(P + 16, 3, P + 16),
    new THREE.MeshToonMaterial({ color: 0x6a6f77, gradientMap })
  );
  platform.position.y = -1.3;
  platform.receiveShadow = true;
  g.add(platform);
  const asphalt = new THREE.Mesh(
    new THREE.PlaneGeometry(P, P),
    new THREE.MeshToonMaterial({ color: 0x2b2b30, gradientMap })
  );
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.y = 0.05;
  asphalt.receiveShadow = true;
  g.add(asphalt);

  // Zebra crosswalks: an orthogonal "+" and a diagonal "X" (the scramble).
  const white = '#e8e4dc';
  const Wc = 7; // crossing width
  const stripes = [];
  for (let z = -P / 2 + 3; z <= P / 2 - 3; z += 2.4) stripes.push(box(Wc, 0.06, 1.2, 0, 0.07, z, white)); // N-S
  for (let x = -P / 2 + 3; x <= P / 2 - 3; x += 2.4) stripes.push(box(1.2, 0.06, Wc, x, 0.07, 0, white)); // E-W
  for (let d = -P * 0.42; d <= P * 0.42; d += 2.4) {
    const b1 = box(1.1, 0.06, Wc, d, 0.08, d, white); b1.rotateY(Math.PI / 4); stripes.push(b1);
    const b2 = box(1.1, 0.06, Wc, d, 0.08, -d, white); b2.rotateY(-Math.PI / 4); stripes.push(b2);
  }
  g.add(new THREE.Mesh(merge(stripes), structMat));

  // Framing buildings, each facing the plaza centre with a giant screen.
  const R = P * 0.6;
  const bDefs = [
    { x: -R, z: 0, w: 22, d: 16, h: 74 },
    { x: R, z: 0, w: 22, d: 16, h: 52 },
    { x: 0, z: -R, w: 26, d: 16, h: 64 },
    { x: 0, z: R, w: 26, d: 16, h: 44 },
    { x: -R * 0.8, z: R * 0.8, w: 18, d: 15, h: 84 },
    { x: R * 0.8, z: -R * 0.8, w: 18, d: 15, h: 58 },
  ];
  const screenMats = [];
  const CONCRETE = '#3a4048', DARK = '#22262c';
  bDefs.forEach((b, i) => {
    const bg = new THREE.Group();
    bg.position.set(b.x, 0, b.z);
    bg.rotation.y = Math.atan2(-b.x, -b.z); // front (+Z) faces plaza centre
    // Body + parapet.
    const body = new THREE.Mesh(merge([
      box(b.w, b.h, b.d, 0, b.h / 2, 0, CONCRETE),
      box(b.w + 1, 1.2, b.d + 1, 0, b.h + 0.2, 0, DARK),
    ]), structMat);
    body.castShadow = body.receiveShadow = true;
    bg.add(body);
    // Window glow on the side faces + a lit crown band on the front.
    const gparts = [];
    for (let yy = 6; yy < b.h - 4; yy += 5.5) {
      gparts.push(box(0.2, 2.2, b.d * 0.82, b.w / 2 + 0.05, yy, 0, '#ffe6ad'));
      gparts.push(box(0.2, 2.2, b.d * 0.82, -b.w / 2 - 0.05, yy, 0, '#ffe6ad'));
    }
    gparts.push(box(b.w * 0.94, 1.2, 0.2, 0, b.h - 2.4, b.d / 2 + 0.06, '#ffe6ad'));
    bg.add(new THREE.Mesh(merge(gparts), glowMat));
    // Giant animated screen on the front face.
    const sw = b.w * 0.86, sh = b.h * 0.42;
    const sm = makeScreenMat(i);
    screenMats.push(sm);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), sm);
    screen.position.set(0, b.h * 0.52, b.d / 2 + 0.16);
    bg.add(screen);
    g.add(bg);
  });

  function update(dt, night) {
    const bright = 0.7 + night * 1.1; // billboards blaze brighter at night
    for (let i = 0; i < screenMats.length; i++) {
      screenMats[i].uniforms.uTime.value += dt;
      screenMats[i].uniforms.uBright.value = bright;
    }
  }
  update(0, 0);
  return { group: g, update };
}
