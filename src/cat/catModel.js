import * as THREE from 'three';
import { box, cyl, blob, merge } from '../engine/prim.js';

// ---------------------------------------------------------------------------
// Sushi Paws — the procedural cat.
//
// A stylized low-poly QUADRUPED built entirely from the prim.js helpers, so the
// game keeps its zero-external-asset promise. No skeleton: the cat is a small
// tree of plain THREE.Group pivots (body / neck / head / 2 ears / 4 legs /
// 5 tail segments) and every rigid cluster is merged into ONE geometry, so the
// whole animal is 18 draw calls.
//
// World size (at scale = 1, feet on y = 0). Measured, not guessed — every
// number below comes off the built geometry:
//   shoulder 0.77, waist 0.72, hip 0.81 (that 0.05 dip is the spine), belly
//   clearance 0.29, nose-to-rump 1.55 (≈ 2 : 1 against the shoulder — long and
//   low, the way a cat reads), width 0.72, ear tips 1.07, eyes 0.765.
//   The resting tail curls up and ~0.12 off to one side, topping out at 1.07 —
//   level with the ear tips and a clear 0.26 above the back line, so it still
//   reads against the body from a follow camera parked behind the cat.
//   Overall 2.13 long × 1.07 tall. 18 meshes / ~1200 triangles.
// Buildings are ~3.6 units per storey, so a cat is roughly shin-high to a door.
//
// FACING NOTE (important, read before wiring the controller):
//   thirdPersonControls sets `group.rotation.y = atan2(move.x, move.z)`, which
//   means the character's LOCAL +Z must be the direction of travel. This art is
//   authored nose-toward +Z, so `inner` starts at rotation.y = 0 (a half-turn
//   here would make the cat moonwalk). `setFacingOffset(rad)` — or the
//   `facingOffset` option — adds to it if a different convention is needed.
// ---------------------------------------------------------------------------

// --- proportions (scale = 1) ----------------------------------------------
// Every pose offset below is derived from these, so the whole animal can be
// re-proportioned by editing this block and re-running tools/ measurements.
const BODY_Y = 0.55;      // torso pivot height (feet at y = 0)
const HEAD_P = [0, 0.17, 0.565];  // head pivot, relative to the body pivot
const TAIL_P = [0, 0.155, -0.52]; // tail root, relative to the body pivot
const TAIL_SEG = 5;
const TAIL_LEN = 0.15;    // per segment → 0.75 of tail
const TAIL_R0 = 0.09;     // tail radius at the root…
const TAIL_DR = 0.008;    // …shrinking this much per segment (tip ≈ 0.05)
const TAIL_LIFT = 0.22;   // resting pitch added to the mood's tail angle
const TAIL_REST = 0.09;   // per-segment resting curl (accumulates up the chain)
const TAIL_SIDE = 0.13;   // resting yaw at the root…
const TAIL_SIDE_SEG = 0.06; // …and per segment, so the tail leans to one side
const BLEND = 0.25;       // seconds for every pose cross-blend

// Front legs sit a touch shorter (and their pivot lower) than the back legs, so
// the chest rides under the hips the way a cat's does. `y` is the pivot height
// relative to the body pivot; `reach` is pivot → sole, and BODY_Y + y - reach
// must be 0 for every leg or the cat stands on stilts.
// toeF / toeB / halfW are the paw block's extents measured from the leg axis at
// sole height. The leg is one rigid piece with no ankle, so tipping it drives
// those corners under the floor — see the dig compensation in update().
const LEG_DEF = [
  { key: 'legFL', x: -0.175, y: -0.17, z: 0.375, reach: 0.38, toeF: 0.175, toeB: 0.045, halfW: 0.105, front: true, phase: 0 },
  { key: 'legFR', x: 0.175, y: -0.17, z: 0.375, reach: 0.38, toeF: 0.175, toeB: 0.045, halfW: 0.105, front: true, phase: Math.PI },
  { key: 'legBL', x: -0.20, y: -0.13, z: -0.435, reach: 0.42, toeF: 0.182, toeB: 0.048, halfW: 0.110, front: false, phase: Math.PI },
  { key: 'legBR', x: 0.20, y: -0.13, z: -0.435, reach: 0.42, toeF: 0.182, toeB: 0.048, halfW: 0.110, front: false, phase: 0 },
];

// --- action vocabulary -----------------------------------------------------
const LOCO = ['idle', 'walk', 'run'];
const AIR = ['jump', 'fall'];
const HOLD = ['sit', 'sleep', 'carry', 'cook', 'fish', 'climb'];
// One-shots and how long they play.
const SHOT = {
  land: 0.36, meow: 1.15, stretch: 1.7, lick: 1.35,
  happy: 1.25, pounce: 0.85,
};
const ACTIONS = new Set([...LOCO, ...AIR, ...HOLD, ...Object.keys(SHOT), 'tired']);
const MOODS = {
  neutral: { ear: 0.0, tail: 0.16, blink: [3, 7], swish: 1.0 },
  happy: { ear: -0.10, tail: 0.72, blink: [2.4, 5.0], swish: 1.45 },
  tired: { ear: 0.42, tail: -0.34, blink: [1.8, 4.0], swish: 0.6 },
  focused: { ear: 0.04, tail: -0.06, blink: [5, 9], swish: 1.25 },
};

// --- tiny math -------------------------------------------------------------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => clamp(v, 0, 1);
const num = (v, d) => (Number.isFinite(v) ? v : d);
const approach = (cur, tgt, k) => cur + (tgt - cur) * clamp01(k);
const bell = (p) => Math.sin(clamp01(p) * Math.PI); // 0 → 1 → 0

// THREE.Color doesn't throw on garbage — it console.warns and quietly stays
// white — so unrecognised input is rejected up front instead.
const CSS_COLOR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgb\(|rgba\(|hsl\(|hsla\()/i;
function safeColor(v, fallback) {
  try {
    if (typeof v === 'number' && Number.isFinite(v)) return `#${new THREE.Color(v).getHexString()}`;
    if (v && v.isColor) return `#${v.getHexString()}`;
    if (typeof v !== 'string') return fallback;
    const s = v.trim();
    const named = THREE.Color.NAMES && Object.prototype.hasOwnProperty.call(THREE.Color.NAMES, s.toLowerCase());
    if (!CSS_COLOR.test(s) && !named) return fallback;
    return `#${new THREE.Color(s).getHexString()}`;
  } catch (e) {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Hats. Each returns an array of geometries in HEAD-LOCAL space (skull centred
// on the origin, radius ≈ 0.21, so the crown sits around y = 0.21).
// ---------------------------------------------------------------------------
function buildHat(kind, col) {
  const { accent, belly } = col;
  const white = '#f6f1e4';
  switch (kind) {
    case 'chef':
      return [
        cyl(0.165, 0.175, 0.07, 12, 0, 0.21, -0.01, white),
        blob(0.155, 0, 0.31, -0.01, white),
        blob(0.10, -0.11, 0.28, 0.02, white),
        blob(0.10, 0.11, 0.28, -0.04, white),
        blob(0.09, 0, 0.29, -0.12, white),
      ];
    case 'bandana':
      return [
        box(0.36, 0.11, 0.30, 0, 0.155, -0.02, accent),
        box(0.09, 0.08, 0.08, 0.175, 0.125, -0.11, accent, [0, 0.5, 0]),
        box(0.14, 0.03, 0.05, 0.24, 0.10, -0.15, accent, [0, 0.5, 0.4]),
      ];
    case 'straw':
      return [
        cyl(0.31, 0.33, 0.028, 14, 0, 0.185, -0.01, '#e3c37a'),
        cyl(0.145, 0.175, 0.15, 12, 0, 0.265, -0.01, '#ecd79a'),
        cyl(0.152, 0.152, 0.035, 12, 0, 0.215, -0.01, accent),
      ];
    case 'cap':
      return [
        blob(0.20, 0, 0.11, -0.02, accent),
        box(0.24, 0.032, 0.17, 0, 0.135, 0.16, accent, [0.12, 0, 0]),
        cyl(0.028, 0.028, 0.03, 8, 0, 0.27, -0.02, belly),
      ];
    case 'flower': {
      const parts = [blob(0.034, 0.135, 0.175, 0.045, '#f4d774')];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        parts.push(blob(0.042, 0.135 + Math.cos(a) * 0.055, 0.175 + Math.sin(a) * 0.05, 0.045, '#f3a6cf'));
      }
      parts.push(box(0.05, 0.015, 0.05, 0.135, 0.152, 0.02, '#6fae4e'));
      return parts;
    }
    case 'headband':
      return [
        box(0.30, 0.045, 0.045, 0, 0.135, 0.145, accent),
        box(0.045, 0.10, 0.30, -0.155, 0.10, -0.01, accent),
        box(0.045, 0.10, 0.30, 0.155, 0.10, -0.01, accent),
        box(0.30, 0.045, 0.045, 0, 0.135, -0.155, accent),
        blob(0.05, 0.16, 0.20, 0.05, accent),
      ];
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
export function createCat(opts = {}) {
  const src = opts && typeof opts === 'object' ? opts : {};
  const col = {
    fur: safeColor(src.fur, '#e8a55c'),
    belly: safeColor(src.belly, '#f7ead6'),
    accent: safeColor(src.accent, '#c8503f'),
    eye: safeColor(src.eye, '#2f2a24'),
  };
  const scale = Math.max(0.01, num(src.scale, 1));
  const hat = typeof src.hat === 'string' ? src.hat : null;
  const apron = !!src.apron;
  const gradientMap = src.gradientMap || null;
  const facingBase = num(src.facingOffset, 0);
  let speedScale = Math.max(0.0001, num(src.speedScale, 1));

  const geos = [];
  const track = (g) => { if (g) geos.push(g); return g; };

  // ---- material -----------------------------------------------------------
  const material = gradientMap
    ? new THREE.MeshToonMaterial({ vertexColors: true, gradientMap })
    : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true });
  const mats = [material];

  const meshOf = (parts, { shadow = false } = {}) => {
    const list = (Array.isArray(parts) ? parts : [parts]).filter(Boolean);
    if (!list.length) return null;
    const geo = list.length === 1 ? list[0] : merge(list);
    if (!geo) return null;
    track(geo);
    const m = new THREE.Mesh(geo, material);
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    return m;
  };

  // ---- hierarchy ----------------------------------------------------------
  const group = new THREE.Group();          // world transform, feet at y = 0
  group.name = 'cat';
  const inner = new THREE.Group();          // facing correction (see FACING NOTE)
  inner.rotation.y = facingBase;
  group.add(inner);
  const body = new THREE.Group();           // bob + spine flex live here
  body.position.y = BODY_Y;
  inner.add(body);
  group.scale.setScalar(scale);

  // ---- torso --------------------------------------------------------------
  {
    // The barrel is three tapered sections rather than one tube: a narrow
    // chest, a waist that sits ~0.05 lower (the visible dip in the spine) and a
    // wider, taller loin running back into the haunches.
    const parts = [
      cyl(0.200, 0.193, 0.34, 10, 0, 0.022, 0.29, col.fur, [Math.PI / 2, 0, 0]),   // ribs
      cyl(0.193, 0.200, 0.34, 10, 0, -0.020, -0.02, col.fur, [Math.PI / 2, 0, 0]), // waist dip
      // The loin stops short of the rump (the haunch blob covers the gap): its
      // rear rim is the first thing to touch down when the sit pose pitches the
      // chest up by 0.44.
      cyl(0.208, 0.230, 0.30, 10, 0, 0.030, -0.31, col.fur, [Math.PI / 2, 0, 0]),  // loin
      blob(0.198, 0, 0.012, 0.45, col.fur),                                    // chest cap
      blob(0.150, -0.172, 0.055, 0.335, col.fur),                              // shoulders
      blob(0.150, 0.172, 0.055, 0.335, col.fur),
      blob(0.250, 0, 0.020, -0.455, col.fur),                                  // haunch
      blob(0.180, -0.205, 0.020, -0.425, col.fur),                             // hips
      blob(0.180, 0.205, 0.020, -0.425, col.fur),
      box(0.33, 0.14, 0.78, 0, -0.178, 0.015, col.belly),                      // belly
      blob(0.165, 0, -0.085, 0.42, col.belly),                                 // chest bib
    ];
    if (apron) {
      parts.push(box(0.30, 0.34, 0.07, 0, -0.055, 0.335, '#f6f1e4', [0.12, 0, 0]));
      parts.push(box(0.05, 0.04, 0.32, -0.10, 0.10, 0.29, '#f6f1e4', [0.5, 0, 0]));
      parts.push(box(0.05, 0.04, 0.32, 0.10, 0.10, 0.29, '#f6f1e4', [0.5, 0, 0]));
      parts.push(box(0.32, 0.05, 0.05, 0, -0.045, 0.355, col.accent));
    }
    // neck stub, so the head never separates from the shoulders mid-turn
    parts.push(cyl(0.135, 0.175, 0.26, 8, 0, 0.105, 0.455, col.fur, [0.70, 0, 0]));
    const m = meshOf(parts, { shadow: true });
    if (m) body.add(m);
  }

  // ---- legs ---------------------------------------------------------------
  // Short and stocky: the upper segment is nearly as thick as the torso is deep
  // and the paw is a rounded block wider than the ankle, so the legs still read
  // as legs from behind at this shoulder height.
  const legGeo = {
    front: track(merge([
      cyl(0.098, 0.086, 0.20, 8, 0, -0.098, 0.005, col.fur),   // upper arm
      cyl(0.082, 0.072, 0.175, 8, 0, -0.282, 0.008, col.fur),  // forearm
      box(0.205, 0.085, 0.20, 0, -0.3375, 0.06, col.belly),    // paw block → sole at -0.38
      blob(0.050, -0.055, -0.318, 0.135, col.belly),           // toes
      blob(0.050, 0.055, -0.318, 0.135, col.belly),
    ])),
    back: track(merge([
      cyl(0.128, 0.100, 0.225, 8, 0, -0.100, -0.020, col.fur), // thigh
      cyl(0.094, 0.076, 0.21, 8, 0, -0.305, 0.005, col.fur),   // shank
      box(0.215, 0.085, 0.215, 0, -0.3775, 0.065, col.belly),  // paw block → sole at -0.42
      blob(0.052, -0.058, -0.358, 0.140, col.belly),           // toes
      blob(0.052, 0.058, -0.358, 0.140, col.belly),
    ])),
  };
  const legs = [];
  for (const def of LEG_DEF) {
    const g = new THREE.Group();
    g.name = def.key;
    g.position.set(def.x, def.y, def.z);
    const m = new THREE.Mesh(def.front ? legGeo.front : legGeo.back, material);
    m.castShadow = true;
    g.add(m);
    const paw = new THREE.Object3D();       // marker at the sole, for groundFeet()
    paw.position.y = -def.reach;
    g.add(paw);
    g.userData = { def, mesh: m, paw, baseY: def.y, reach: def.reach };
    body.add(g);
    legs.push(g);
  }
  const [legFL, legFR, legBL, legBR] = legs;

  // ---- head ---------------------------------------------------------------
  const head = new THREE.Group();
  head.name = 'catHead';
  head.position.set(HEAD_P[0], HEAD_P[1], HEAD_P[2]);
  body.add(head);
  {
    // The head is deliberately a touch oversized for the body — a stylized
    // proportion that keeps the face readable at gameplay distance.
    const parts = [
      blob(0.215, 0, 0.010, 0, col.fur),                       // skull
      blob(0.140, -0.145, -0.040, 0.020, col.fur),             // cheeks — widen the skull
      blob(0.140, 0.145, -0.040, 0.020, col.fur),
      blob(0.088, 0, 0.075, -0.10, col.fur),                   // occiput
      box(0.185, 0.115, 0.185, 0, -0.062, 0.205, col.belly),   // muzzle, pushed forward
      box(0.105, 0.062, 0.095, 0, -0.128, 0.215, col.belly),   // chin
      box(0.062, 0.048, 0.052, 0, -0.030, 0.292, col.accent),  // nose
      box(0.215, 0.052, 0.105, 0, 0.145, 0.10, col.belly, [0.35, 0, 0]), // brow blaze
    ];
    const m = meshOf(parts, { shadow: true });
    if (m) head.add(m);
  }

  // mouth (opens on 'meow')
  const mouth = new THREE.Mesh(track(box(0.078, 0.05, 0.03, 0, 0, 0, '#7d3b3b')), material);
  mouth.position.set(0, -0.126, 0.272);
  mouth.scale.y = 0.12;
  head.add(mouth);

  // eyes
  const eyeGeo = track(blob(0.052, 0, 0, 0, col.eye));
  const eyes = [];
  for (const ex of [-0.105, 0.105]) {
    const e = new THREE.Mesh(eyeGeo, material);
    e.position.set(ex, 0.045, 0.178);
    e.scale.set(1, 1, 0.62);
    head.add(e);
    eyes.push(e);
  }
  const [eyeL, eyeR] = eyes;

  // ears — one Group each so they can twitch / flatten independently. Taller and
  // wider at the base than the head is deep, which is what makes the profile
  // read "cat" rather than "sphere with bumps".
  const earGeo = track(merge([
    cyl(0.004, 0.115, 0.20, 5, 0, 0.10, 0, col.fur),
    cyl(0.003, 0.070, 0.155, 5, 0, 0.092, 0.016, col.accent),
  ]));
  const ears = [];
  for (const ex of [-0.135, 0.135]) {
    const g = new THREE.Group();
    g.position.set(ex, 0.150, -0.015);
    const m = new THREE.Mesh(earGeo, material);
    m.castShadow = true;
    g.add(m);
    g.userData = { side: Math.sign(ex) };
    head.add(g);
    ears.push(g);
  }
  const [earL, earR] = ears;

  // whiskers — a merged fan per side, hung off a pivot at the muzzle
  const whiskers = [];
  for (const side of [-1, 1]) {
    const parts = [];
    for (let i = -1; i <= 1; i++) {
      parts.push(box(0.20, 0.008, 0.008, side * 0.105, i * 0.026, i * 0.012, '#f6f1e4', [0, side * i * 0.22, i * 0.16]));
    }
    const m = meshOf(parts);
    if (!m) continue;
    m.position.set(side * 0.095, -0.035, 0.19);
    head.add(m);
    whiskers.push(m);
  }

  // optional hat
  let hatMesh = null;
  if (hat) {
    const parts = buildHat(hat, col);
    if (parts) {
      hatMesh = meshOf(parts, { shadow: true });
      if (hatMesh) head.add(hatMesh);
    }
  }

  // ---- tail ---------------------------------------------------------------
  const tail = new THREE.Group();
  tail.name = 'catTail';
  tail.position.set(TAIL_P[0], TAIL_P[1], TAIL_P[2]);
  body.add(tail);
  const tailSegs = [];
  {
    let parent = tail;
    for (let i = 0; i < TAIL_SEG; i++) {
      const g = new THREE.Group();
      if (i > 0) g.position.z = -TAIL_LEN;
      const r0 = TAIL_R0 - i * TAIL_DR;
      const r1 = TAIL_R0 - (i + 1) * TAIL_DR;
      const tip = i === TAIL_SEG - 1;
      const parts = [cyl(r0, Math.max(0.012, r1), TAIL_LEN, 7, 0, 0, -TAIL_LEN / 2, col.fur, [Math.PI / 2, 0, 0])];
      if (tip) parts.push(blob(Math.max(0.02, r1), 0, 0, -TAIL_LEN, col.belly));
      const m = meshOf(parts, { shadow: true });
      if (m) g.add(m);
      parent.add(g);
      parent = g;
      tailSegs.push(g);
    }
  }

  // Underside-of-the-belly marker. footWorldY() takes the minimum of this and
  // the four paws, because a curled-up sleeping cat rests on its belly with the
  // paws tucked well clear of the floor — measuring only the paws would leave
  // groundFeet() hovering it.
  // -0.271 is the belly plate's lowest CORNER once the sleep pose's 0.16 roll is
  // applied, not the flat underside, so groundFeet() rests the cat on the part
  // that actually touches.
  const bellyMark = new THREE.Object3D();
  bellyMark.position.set(0, -0.271, -0.03);
  body.add(bellyMark);

  // ---- carry anchor -------------------------------------------------------
  const carryAnchor = new THREE.Object3D();
  carryAnchor.name = 'catCarryAnchor';
  carryAnchor.position.set(0, 0.0, 0.70);     // just in front of the chest, under the chin
  body.add(carryAnchor);

  // =========================================================================
  // STATE
  // =========================================================================
  let time = 0;
  let phase = 0;               // gait phase
  let loco = 'idle';
  let hold = null;             // one of HOLD, or null
  let shot = null;             // one-shot name
  let shotT = 0, shotDur = 0;
  let manualAir = 0;           // seconds of forced 'jump'/'fall'
  let manualAirName = 'jump';
  let tired = 0;
  let mood = 'neutral';
  let punchCd = 0;
  let cut = { lie: 0, sit: 0, sitUp: 0 };
  let disposed = false;

  const w = { sit: 0, sleep: 0, carry: 0, cook: 0, fish: 0, climb: 0, upright: 0, air: 0 };

  // personality timers
  const rnd = (a, b) => a + Math.random() * (b - a);
  let blinkIn = rnd(1, 4), blinkT = -1;
  let twitchIn = rnd(2, 6), twitchT = -1, twitchEar = 0;
  let lookIn = rnd(5, 12), lookT = -1, lookYaw = 0;

  const _v = new THREE.Vector3();
  const _v2 = new THREE.Vector3();

  // =========================================================================
  // API — actions
  // =========================================================================
  function setAction(name, options = {}) {
    if (disposed) return 0;
    if (typeof name !== 'string') return 0;
    const n = name.toLowerCase().trim();
    if (!ACTIONS.has(n)) return 0;

    if (n === 'tired') { setTired(num(options && options.amount, 1)); return BLEND; }

    if (LOCO.includes(n)) { hold = null; shot = null; shotT = 0; shotDur = 0; return BLEND; }

    if (AIR.includes(n)) {
      shot = null; shotT = 0; shotDur = 0;
      manualAirName = n;
      manualAir = Math.max(0.05, num(options && options.duration, n === 'jump' ? 0.6 : 0.5));
      return manualAir;
    }

    if (HOLD.includes(n)) { hold = n; shot = null; shotT = 0; shotDur = 0; return BLEND; }

    // one-shot
    const base = SHOT[n];
    if (!base) return 0;
    const spd = Math.max(0.1, num(options && options.speed, 1));
    shot = n;
    shotT = 0;
    shotDur = base / spd;
    return shotDur;
  }
  const playAction = setAction; // engine-compat alias

  function stopAction() {
    shot = null; shotT = 0; shotDur = 0;
    hold = null;
    manualAir = 0;
  }

  const actionReady = (name) => typeof name === 'string' && ACTIONS.has(name.toLowerCase().trim());

  function currentAction() {
    if (shot) return shot;
    if (manualAir > 0) return manualAirName;
    if (hold) return hold;
    return loco;
  }

  function setTired(v) { tired = clamp01(num(v, 0)); }
  function setMood(m) { if (typeof m === 'string' && MOODS[m]) mood = m; }
  function setTint(hex) {
    const c = safeColor(hex, null);
    if (!c) return;
    for (const m of mats) if (m.color) m.color.set(c);
  }
  function setHeight(h) {
    const s = num(h, 1);
    if (s > 0) group.scale.setScalar(s);
  }
  function setFacingOffset(rad) { inner.rotation.y = facingBase + num(rad, 0); }
  function setCutscene(lie = 0, sit = 0, sitUp = 0) {
    cut = { lie: clamp01(num(lie, 0)), sit: clamp01(num(sit, 0)), sitUp: clamp01(num(sitUp, 0)) };
  }
  function setSpeedScale(k) { speedScale = Math.max(0.0001, num(k, 1)); }

  /** A playful paw swipe. Returns false while on cooldown / already busy. */
  function punch() {
    if (disposed || punchCd > 0 || shot) return false;
    punchCd = 0.55;
    return setAction('pounce', { speed: 1.35 }) > 0;
  }

  // =========================================================================
  // API — grounding / camera
  // =========================================================================
  function footWorldY() {
    if (disposed) return null;
    let y = Infinity;
    for (const g of legs) {
      const paw = g.userData && g.userData.paw;
      if (!paw) continue;
      paw.getWorldPosition(_v);
      if (_v.y < y) y = _v.y;
    }
    bellyMark.getWorldPosition(_v);
    if (_v.y < y) y = _v.y;
    return Number.isFinite(y) ? y : null;
  }

  function groundFeet(floorY = 0, maxCorrection = 1.5) {
    if (disposed) return;
    const f = num(floorY, 0);
    const lim = Math.abs(num(maxCorrection, 1.5));
    group.updateMatrixWorld(true);
    const fy = footWorldY();
    if (fy === null) return;
    const d = clamp(f - fy, -lim, lim);
    group.position.y += d;
    group.updateMatrixWorld(true);
  }

  /**
   * Height of the eyes above the feet, in world units (group scale included).
   * ≈ 0.77 × scale on all fours, ≈ 1.5 × scale while reared up on the back legs.
   * Measured from the live transform, never hardcoded — the fallback below is
   * only for the disposed / degenerate case. thirdPersonControls parks the
   * follow camera at eyeHeight() × headFactor, so this landing in the
   * 0.75 – 0.85 band on all fours is what frames the cat.
   */
  const EYE_H_FALLBACK = BODY_Y + HEAD_P[1] + 0.045;
  function eyeHeight() {
    if (disposed) return EYE_H_FALLBACK * group.scale.y;
    group.updateMatrixWorld(true);
    eyeL.getWorldPosition(_v);
    group.getWorldPosition(_v2);
    const h = _v.y - _v2.y;
    return Number.isFinite(h) && h > 0.02 ? h : EYE_H_FALLBACK * group.scale.y;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const g of geos) { try { g.dispose(); } catch (e) { /* ignore */ } }
    geos.length = 0;
    for (const m of mats) { try { m.dispose(); } catch (e) { /* ignore */ } }
    if (group.parent) group.parent.remove(group);
    group.traverse((o) => { if (o.isMesh) o.geometry = null; });
  }

  // =========================================================================
  // UPDATE
  // =========================================================================
  function update(dt, speed = 0, options = {}) {
    if (disposed) return;
    const d = clamp(num(dt, 0.016), 0, 0.1);
    const O = options && typeof options === 'object' ? options : {};
    time += d;
    if (punchCd > 0) punchCd -= d;

    const ss = Math.max(0.0001, num(O.speedScale, speedScale));
    const s = Math.abs(num(speed, 0)) * ss;
    const crouch = clamp01(num(O.crouch, 0));
    const vy = num(O.vy, 0);

    if (manualAir > 0) manualAir -= d;
    const airborne = !!O.airborne || manualAir > 0;

    if (shot) {
      shotT += d;
      if (shotT >= shotDur) { shot = null; shotT = 0; shotDur = 0; }
    }

    // -- locomotion pick ----------------------------------------------------
    loco = s < 0.15 ? 'idle' : s < 3.2 ? 'walk' : 'run';
    const runness = clamp01((s - 3.2) / 6);
    const moving = loco !== 'idle';

    // -- blend targets ------------------------------------------------------
    const uprightWanted = (hold === 'cook' || shot === 'meow' || shot === 'happy') ? 1 : 0;
    const t = {
      sit: Math.max(hold === 'sit' ? 1 : 0, hold === 'fish' ? 1 : 0, cut.sit),
      sleep: Math.max(hold === 'sleep' ? 1 : 0, cut.lie),
      carry: hold === 'carry' ? 1 : 0,
      cook: hold === 'cook' ? 1 : 0,
      fish: hold === 'fish' ? 1 : 0,
      climb: hold === 'climb' ? 1 : 0,
      upright: Math.max(uprightWanted, cut.sitUp),
      air: airborne ? 1 : 0,
    };
    const k = d / BLEND;
    for (const key in w) w[key] = approach(w[key], t[key] || 0, k);

    // -- personality timers -------------------------------------------------
    const M = MOODS[mood] || MOODS.neutral;
    // blink
    if (blinkT >= 0) {
      blinkT += d;
      if (blinkT > 0.15) { blinkT = -1; blinkIn = rnd(M.blink[0], M.blink[1]); }
    } else {
      blinkIn -= d;
      if (blinkIn <= 0) { blinkT = 0; }
    }
    // ear twitch
    if (twitchT >= 0) {
      twitchT += d;
      if (twitchT > 0.3) { twitchT = -1; twitchIn = rnd(2, 6); }
    } else {
      twitchIn -= d;
      if (twitchIn <= 0) { twitchT = 0; twitchEar = Math.random() < 0.5 ? 0 : 1; }
    }
    // idle look-around
    if (lookT >= 0) {
      lookT += d;
      if (lookT > 1.4) { lookT = -1; lookIn = rnd(5, 12); }
    } else {
      lookIn -= d;
      if (lookIn <= 0 && !moving && !w.sleep) { lookT = 0; lookYaw = (Math.random() < 0.5 ? -1 : 1) * rnd(0.3, 0.62); }
    }

    // -- gait phase ---------------------------------------------------------
    const gaitMul = (1 - 0.35 * tired) * (w.carry > 0.5 ? 0.86 : 1);
    if (moving) phase += d * (4.5 + Math.min(s, 10) * 1.5) * gaitMul;
    else phase += d * 0.6; // keeps the tail/idle cycle alive

    // ======================= pose accumulators ============================
    let bY = 0, bZ = 0, bRotX = 0, bRotZ = 0;
    // Stance absorption: the part of the body's vertical offset / spine twist
    // that the STANDING legs should soak up by changing length, so the planted
    // paws stay welded to y = 0 instead of sinking through it. Poses that lift
    // the paws off the floor (sit, sleep, upright, air) leave these at 0.
    let absorbY = 0, absorbRX = 0, absorbRZ = 0;
    let hRotX = 0, hRotY = 0, hRotZ = 0, hDy = 0, hDz = 0;
    let tRotX = TAIL_LIFT + M.tail * (1 - 0.8 * tired) - 0.35 * tired;
    let tCurl = 1;             // scales the per-segment resting curl
    let tAmp = 1, tRate = M.swish;
    let earBase = M.ear + 0.55 * tired;
    let eyeOpen = 1;
    let mouthOpen = 0.12;
    const legRot = [0, 0, 0, 0];
    const legRotZ = [0, 0, 0, 0];
    const legScale = [1, 1, 1, 1];
    const legDy = [0, 0, 0, 0];

    // ---- locomotion (suppressed by any pose that leaves the ground stance)
    const groundW = clamp01(1 - Math.max(w.sit, w.sleep, w.upright, w.air, w.climb));
    if (groundW > 0.001) {
      const amp = moving ? (0.26 + 0.24 * runness) * (w.carry > 0.5 ? 0.6 : 1) : 0;
      for (let i = 0; i < 4; i++) {
        const sw = Math.sin(phase + LEG_DEF[i].phase);
        // +rotation.x swings a hanging leg BACKWARD, so forward swing is -sin.
        legRot[i] += -sw * amp * groundW;
        // toe-off lift: the leg shortens slightly on the swing half
        legScale[i] *= 1 - clamp01(sw) * 0.05 * amp * groundW;
      }
      // body bob runs at 2× the stride frequency
      const bob = moving ? Math.sin(phase * 2) * (0.009 + 0.019 * runness) : Math.sin(time * 1.6) * 0.005;
      bY += bob * groundW;
      absorbY += bob * groundW;
      const flex = moving ? Math.sin(phase * 2 + 0.6) * (0.025 + 0.05 * runness) : 0;
      bRotX += flex * groundW;
      absorbRX += flex * groundW;
      const roll = moving ? Math.sin(phase) * 0.035 * runness * groundW : 0;
      bRotZ += roll;
      absorbRZ += roll;
      // head counter-bobs so the eyes stay level
      hDy -= bob * 0.85 * groundW;
      hRotX -= flex * 0.9 * groundW;
      // tail streams with speed
      tRotX += (moving ? 0.10 + 0.32 * runness : 0) * groundW;
      tRate *= 1 + runness * 0.8;
      // crouch (controller's Ctrl/C) — the legs fold, the paws do not move
      if (crouch > 0.001) {
        const dip = -0.115 * crouch * groundW;
        bY += dip;
        absorbY += dip;
        earBase += 0.22 * crouch;
        tRotX -= 0.25 * crouch;
      }
    }

    // ---- airborne: jump / fall -------------------------------------------
    if (w.air > 0.001) {
      const rising = vy > 0.4;
      const a = w.air;
      bRotX += (rising ? -0.30 : 0.22) * a;
      bY += 0.02 * a;
      for (let i = 0; i < 4; i++) {
        // tuck: front legs forward, back legs back, all shortened
        legRot[i] += (LEG_DEF[i].front ? -0.85 : 0.95) * a;
        legScale[i] *= 1 - 0.32 * a;
      }
      tRotX += (rising ? 0.55 : -0.15) * a;   // tail streams back
      tAmp *= 0.45;
      tCurl *= 1 - 0.55 * a;                  // …and straightens out of its resting curl
      earBase += 0.18 * a;
      hRotX += (rising ? -0.18 : 0.14) * a;
    }

    // ---- sit (and fish, which is sit + a paw dab) -------------------------
    if (w.sit > 0.001) {
      const a = w.sit;
      // The hind fold SHORTENS on sqrt(a) but SWINGS on a, so the folding paw
      // rides above the floor for the whole cross-blend instead of scuffing
      // through it at the halfway point.
      const fold = Math.sqrt(a);
      bY -= 0.176 * a;
      bRotX -= 0.44 * a;
      for (let i = 0; i < 4; i++) {
        if (LEG_DEF[i].front) {
          legRot[i] += 0.44 * a;             // cancels the body pitch → front legs vertical
        } else {
          // The hip rides UP into the haunch as the rump comes down: a rigid
          // hind leg reaching the floor from the lowered hip would have to lie
          // almost flat, and a flat leg drives its heel through the ground.
          legDy[i] += 0.16 * a;
          legRot[i] -= 0.16 * a;             // paw tucks forward, under the belly
          legScale[i] *= 1 - 0.45 * fold;
        }
      }
      hRotX += 0.36 * a;                      // head stays level
      tRotX -= 0.42 * a;                      // tail comes down and wraps around
      tCurl *= 1 - 0.30 * a;
      tAmp *= 1 - 0.55 * a;
    }
    if (w.fish > 0.001) {
      // repeating paw dab with the right front paw
      const cyc = (time * 0.75) % 1;
      const dab = cyc < 0.45 ? bell(cyc / 0.45) : 0;
      legRot[1] += -(0.35 + 1.0 * dab) * w.fish;
      legScale[1] *= 1 - 0.12 * w.fish;
      hRotX += 0.12 * dab * w.fish;
      earBase -= 0.10 * w.fish;
      tAmp *= 1 - 0.4 * w.fish;
    }

    // ---- sleep ------------------------------------------------------------
    if (w.sleep > 0.001) {
      const a = w.sleep;
      const breath = Math.sin(time * 1.05) * 0.5 + 0.5;
      bY -= (0.278 - breath * 0.014) * a;    // belly comes down onto the floor
      bRotZ += 0.16 * a;
      for (let i = 0; i < 4; i++) {
        // Paws tuck FORWARD into a loaf, not back: swinging them back tips the
        // toes down and a shortened leg still carries a full-length paw block,
        // so the toes end up 0.1 under the floor.
        legRot[i] -= (LEG_DEF[i].front ? 1.05 : 0.85) * a;
        legScale[i] *= 1 - 0.55 * a;
        legDy[i] += 0.05 * a;
      }
      hRotX += 0.42 * a;
      hRotZ += 0.22 * a;
      hDy -= 0.055 * a;              // head rests ON the tucked paws, not inside the chest
      hDz -= 0.04 * a;
      eyeOpen = Math.min(eyeOpen, 1 - 0.94 * a);
      earBase += 0.55 * a;
      tRotX -= 0.34 * a;                     // tail lies along the flank, not through the floor
      tCurl *= 1 - 0.55 * a;
      tAmp *= 1 - 0.85 * a;
      tRate *= 0.35;
    }

    // ---- upright (cook / meow / happy / cutscene sit-up) -------------------
    if (w.upright > 0.001) {
      const a = w.upright;
      // The lift has to LEAD the pitch: the hips swing backwards as sin(pitch),
      // so a lift linear in `a` leaves the hind paws ~0.06 under the floor at
      // the halfway point. Easing it on sin(a·π/2) tracks that arc.
      const aLift = Math.sin(a * Math.PI * 0.5);
      bRotX -= 1.15 * a;                     // rear up on the back legs
      bY += 0.325 * aLift;
      for (let i = 0; i < 4; i++) {
        if (LEG_DEF[i].front) legRot[i] += 0.45 * a;   // front paws come up
        else legRot[i] += 1.15 * a;                    // back legs stay vertical
      }
      hRotX += 1.05 * a;               // …head levels off instead of gazing at the sky
      hDy += 0.08 * a;
      tRotX += 0.85 * a;                     // tail trails back as a counterweight
      tCurl *= 1 - 0.4 * a;
      tAmp *= 1 + 0.3 * a;
    }
    if (w.cook > 0.001) {
      const chop = Math.sin(time * 8.5);
      legRot[0] += (-0.30 + chop * 0.32) * w.cook;
      legRot[1] += (-0.30 - chop * 0.32) * w.cook;
      hRotX += 0.34 * w.cook;                // looks DOWN at the chopping board
      earBase -= 0.08 * w.cook;
    }

    // ---- carry ------------------------------------------------------------
    if (w.carry > 0.001) {
      const a = w.carry;
      legRot[0] += -1.00 * a;              // paws held UP and out front, not pawing the floor
      legRot[1] += -1.00 * a;
      legScale[0] *= 1 - 0.10 * a;
      legScale[1] *= 1 - 0.10 * a;
      legRot[2] += 0.12 * a;                 // back legs stay vertical under the lean
      legRot[3] += 0.12 * a;
      bRotX -= 0.12 * a;
      bY += 0.052 * a;                       // …and the lean is pivoted so the hind paws don't sink
      hRotX += 0.10 * a;
      tRotX += 0.20 * a;
    }

    // ---- climb ------------------------------------------------------------
    if (w.climb > 0.001) {
      const a = w.climb;
      bRotX -= 0.90 * a;
      // Same lead-the-pitch easing as `upright`, one notch shallower.
      bY += 0.32 * Math.sin(a * Math.PI * 0.5); // pitched onto a wall — hind paws just clear the floor
      const c = Math.sin(time * 5.2);
      legRot[0] += (0.60 - c * 0.55) * a;
      legRot[1] += (0.60 + c * 0.55) * a;
      legRot[2] += (0.95 + c * 0.35) * a;
      legRot[3] += (0.95 - c * 0.35) * a;
      tRotX -= 0.20 * a;
      tAmp *= 0.5;
      hRotX += 0.55 * a;
    }

    // ---- one-shots (self-enveloping, no blend weights needed) --------------
    if (shot && shotDur > 0) {
      const p = clamp01(shotT / shotDur);
      const e = bell(p);
      switch (shot) {
        case 'land': {
          // The squash is routed through absorbY, so the legs fold by exactly
          // as much as the body drops and the paws never punch the floor.
          bY -= 0.075 * e;
          absorbY -= 0.075 * e;
          bRotX += 0.04 * e;
          absorbRX += 0.04 * e;
          for (let i = 0; i < 4; i++) {
            legRotZ[i] += (LEG_DEF[i].x < 0 ? -1 : 1) * 0.28 * e;
          }
          earBase += 0.35 * e;
          tRotX += 0.45 * e;
          break;
        }
        case 'stretch': {
          // Chest sinks and the front paws slide FORWARD along the floor while
          // the rump lifts. The leg angles are picked so the front paws stay on
          // y = 0 through the whole arc instead of ploughing under it.
          bRotX += 0.36 * e;                 // front end dips, rump lifts
          bY -= 0.11 * e;
          // The front legs shorten through the middle of the arc: the reach
          // angle alone would drive the sliding paws ~0.06 under the floor.
          const slide = Math.sin(e * Math.PI);
          legRot[0] += -1.53 * e;
          legRot[1] += -1.53 * e;
          legScale[0] *= 1 - 0.18 * slide;
          legScale[1] *= 1 - 0.18 * slide;
          legRot[2] += -0.36 * e;            // hind legs straighten under the raised rump
          legRot[3] += -0.36 * e;
          legScale[2] *= 1 + 0.127 * e;
          legScale[3] *= 1 + 0.127 * e;
          hRotX += 0.30 * e - 0.5 * bell(clamp01((p - 0.45) / 0.35));
          mouthOpen = Math.max(mouthOpen, 0.9 * bell(clamp01((p - 0.4) / 0.4)));
          eyeOpen = Math.min(eyeOpen, 1 - 0.85 * bell(clamp01((p - 0.35) / 0.45)));
          tRotX += 0.85 * e;
          earBase += 0.20 * e;
          break;
        }
        case 'lick': {
          const dab = Math.sin(p * Math.PI * 3);
          bRotX -= 0.10 * e;
          absorbRX -= 0.10 * e;              // the three planted legs take up the lean
          legRot[1] += -(0.55 + 0.25 * dab) * e;
          legScale[1] *= 1 - 0.16 * e;
          hRotX += (0.55 + 0.22 * dab) * e;
          hRotZ += 0.30 * e;
          hRotY += 0.22 * e;
          mouthOpen = Math.max(mouthOpen, 0.4 + 0.35 * dab);
          eyeOpen = Math.min(eyeOpen, 1 - 0.55 * e);
          tAmp *= 0.6;
          break;
        }
        case 'happy': {
          const hop = Math.abs(Math.sin(p * Math.PI * 3));
          bY += 0.07 * hop * e;
          bRotZ += Math.sin(p * Math.PI * 6) * 0.10 * e;
          hRotZ += Math.sin(p * Math.PI * 6) * 0.14 * e;
          tRotX += 0.55 * e;
          tRate *= 2.2;
          earBase -= 0.16 * e;
          mouthOpen = Math.max(mouthOpen, 0.35 * e);
          break;
        }
        case 'meow': {
          const cry = bell(clamp01((p - 0.15) / 0.55));
          hRotX += 0.35 * cry;
          mouthOpen = Math.max(mouthOpen, 0.15 + 0.85 * cry);
          eyeOpen = Math.min(eyeOpen, 1 - 0.5 * cry);
          earBase -= 0.12 * e;
          tRotX += 0.25 * e;
          break;
        }
        case 'pounce': {
          const crouchP = clamp01(p / 0.32);
          const leapP = clamp01((p - 0.32) / 0.68);
          const leap = bell(leapP);
          const wind = p < 0.32 ? crouchP : 0;   // the wind-up crouch
          const dip = p < 0.32 ? crouchP : 1 - leapP;
          // The wind-up crouch goes through absorbY/absorbRX, so the folding
          // legs keep the paws planted right up to the moment of take-off.
          bY += -0.05 * dip + 0.23 * leap;
          absorbY += -0.05 * dip;
          bZ += 0.13 * leap;
          bRotX += 0.10 * wind - 0.32 * leap;
          absorbRX += 0.10 * wind;
          for (let i = 0; i < 4; i++) {
            if (LEG_DEF[i].front) legRot[i] += -1.05 * leap + 0.10 * wind;
            else legRot[i] += 0.85 * leap;
          }
          tRotX += 0.70 * leap;
          tAmp *= 0.4;
          earBase -= 0.18;
          break;
        }
        default: break;
      }
    }

    // ---- tired modifier ---------------------------------------------------
    if (tired > 0.001) {
      hRotX += 0.22 * tired;                 // head dips
      hDy -= 0.025 * tired;
      bY -= 0.02 * tired;                    // …and the legs give with it, so the paws stay planted
      absorbY -= 0.02 * tired;
      tAmp *= 1 - 0.5 * tired;
      tCurl *= 1 - 0.45 * tired;
      eyeOpen = Math.min(eyeOpen, 1 - 0.35 * tired);
    }

    // ---- personality layer (always on) ------------------------------------
    if (blinkT >= 0) eyeOpen = Math.min(eyeOpen, 1 - bell(blinkT / 0.15));
    if (lookT >= 0) {
      const l = Math.sin(clamp01(lookT / 1.4) * Math.PI);
      hRotY += lookYaw * l;
      hRotZ += lookYaw * 0.18 * l;
    }

    // =================== commit to the scene graph =========================
    body.position.set(0, BODY_Y + bY, bZ);
    body.rotation.set(bRotX, 0, bRotZ);

    // Stance absorption. `absorb*` is the slice of the body transform the
    // planted legs are supposed to swallow; work out how far it moves each leg
    // pivot vertically and trade that against the leg's length. Euler order is
    // XYZ, so with no yaw the pivot goes through Rz then Rx.
    const azC = Math.cos(absorbRZ), azS = Math.sin(absorbRZ);
    const axC = Math.cos(absorbRX), axS = Math.sin(absorbRX);
    // …and the same decomposition for the FULL body transform, used by the
    // floor clamp below to find where each paw actually lands.
    const bzC = Math.cos(bRotZ), bzS = Math.sin(bRotZ);
    const bxC = Math.cos(bRotX), bxS = Math.sin(bRotX);
    const bodyY = BODY_Y + bY;
    for (let i = 0; i < 4; i++) {
      const g = legs[i];
      const u = g.userData;
      const d = u.def;
      const py = u.baseY + legDy[i];
      const pitch = bRotX + legRot[i];
      const cp = Math.cos(pitch);
      // 1. Stance absorption, resolved along the leg's own (pitched) axis.
      const lift = (d.x * azS + py * azC) * axC - d.z * axS + absorbY - py;
      let sc = legScale[i] + lift / (u.reach * Math.max(0.35, cp));
      // 2. Floor clamp. The leg is one rigid piece: tipping it swings the toe
      //    (or the heel) of the paw block below the sole. Where that would put
      //    the lowest corner under y = 0, shorten the leg until it just rests
      //    on it — only while the stance actually owns the floor, so sit /
      //    sleep / upright / airborne poses keep their lifted paws.
      if (groundW > 0.001 && cp > 0.2) {
        const sp = Math.sin(pitch);
        const corner = Math.max(d.toeF * sp, d.toeB * -sp)
          + d.halfW * Math.abs(Math.sin(legRotZ[i] + bRotZ));
        const pivotY = bodyY + (d.x * bzS + py * bzC) * bxC - d.z * bxS;
        const soleY = pivotY - u.reach * sc * cp - corner;
        if (soleY < 0) sc -= (-soleY / (u.reach * cp)) * groundW;
      }
      sc = clamp(sc, 0.15, 2.2);
      g.rotation.set(legRot[i], 0, legRotZ[i]);
      g.position.set(d.x, py, d.z);
      u.mesh.scale.y = sc;
      u.paw.position.y = -u.reach * sc;
    }

    head.position.set(HEAD_P[0], HEAD_P[1] + hDy, HEAD_P[2] + hDz);
    head.rotation.set(hRotX, hRotY, hRotZ);

    const eo = clamp(eyeOpen, 0.04, 1);
    eyeL.scale.set(1, eo, 0.62);
    eyeR.scale.set(1, eo, 0.62);
    mouth.scale.y = clamp(mouthOpen, 0.08, 1.6);

    // ears: base angle + per-ear twitch
    for (let i = 0; i < ears.length; i++) {
      const g = ears[i];
      const side = g.userData.side;
      let tw = 0;
      if (twitchT >= 0 && twitchEar === i) tw = Math.sin(twitchT * 34) * 0.30 * (1 - twitchT / 0.3);
      g.rotation.set(-earBase * 0.9, 0, side * (0.16 + earBase * 0.55) + tw);
    }

    // whisker jitter
    for (let i = 0; i < whiskers.length; i++) {
      const m = whiskers[i];
      m.rotation.z = Math.sin(time * 6.5 + i * 1.7) * 0.035 + Math.sin(time * 17 + i) * 0.012;
      m.rotation.y = Math.sin(time * 4.1 + i * 2.3) * 0.03;
    }

    // tail: base pitch + per-segment sway with a phase lag down the chain
    // A per-segment yaw that accumulates down the chain sweeps the tail around
    // the body: sitting wraps it about the front paws, sleeping curls it along
    // the flank. Both are the poses where a straight tail looks like a stick.
    // The resting curl (TAIL_REST / TAIL_SIDE_SEG) is scaled by tCurl, NOT by
    // tAmp: tAmp only damps the sway, so a still tail still holds its shape.
    const curl = w.sit * 0.40 + w.sleep * 0.42;
    tail.rotation.set(tRotX, TAIL_SIDE * tCurl + w.sit * 0.30 + w.sleep * 0.25, 0);
    for (let i = 0; i < tailSegs.length; i++) {
      const g = tailSegs[i];
      const lag = i * 0.55;
      const seg = 0.5 + i * 0.16;
      g.rotation.y = Math.sin(time * 2.1 * tRate - lag) * 0.16 * seg * tAmp
        + curl + (i > 0 ? TAIL_SIDE_SEG * tCurl : 0);
      g.rotation.x = Math.sin(time * 1.5 * tRate - lag * 0.8) * 0.10 * seg * tAmp
        + (i > 0 ? TAIL_REST * tCurl + 0.30 * w.sit + 0.05 * w.sleep : 0);
    }
  }

  // =========================================================================
  return {
    group, inner, body, head, tail, tailSegs, ears, legs, carryAnchor,
    legFL, legFR, legBL, legBR,
    material, materials: mats,
    update,
    setAction, playAction, stopAction, actionReady,
    get actionPlaying() { return !!shot; },
    get action() { return currentAction(); },
    setTired, setMood, setTint, setHeight, setFacingOffset, setCutscene, setSpeedScale,
    groundFeet, footWorldY, punch, eyeHeight, dispose,
    isProcedural: true,
  };
}

export default createCat;
