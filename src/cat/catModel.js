import * as THREE from 'three';
import { paint, box, cyl, blob, merge } from '../engine/prim.js';

// ---------------------------------------------------------------------------
// Oshicat — the player/NPC cat: an ANTHROPOMORPHIC chef who stands on two
// legs, built entirely from the prim.js helpers (zero external assets).
//
// Chibi-heroic proportions: 1.91 units tall (2.12 with the toque), which is
// 2.9 heads counting the ears or 3.7 counting the cranium alone. The world uses
// ~3.6 units per building storey, so the cat reads as a small person.
// Everything is sized for a silhouette that holds up at the 8-14 unit camera
// distance: big round head, ears splayed clear of the hat, arms held off the
// coat, mitten hands that read as hands, and a tail that keeps moving.
//
// Key heights (scale = 1): sole 0, hip 0.76, shoulder 1.21, eye 1.58 standing
// and 1.21 seated, crown 1.78, ear tips 1.91. 25 meshes / ~1530 triangles on a
// single material; update() costs ~33 us per cat per frame.
//
// RIG — plain THREE.Group pivots, no skeleton:
//   group                       world transform, soles on y = 0
//    └ inner                    facing correction (see FACING NOTE)
//       └ body                  pelvis: bob, weight shift, lean
//          ├ hips mesh
//          ├ legL / legR        hip pivot → thigh → shin(Group) → foot(Group)
//          ├ tail → 5 segments
//          └ torso              waist pivot: lean + counter-rotation
//             ├ torso mesh (chef coat, wrap front, collar, apron)
//             ├ armL / armR     shoulder pivot → upper → fore(Group) → hand(Group)
//             ├ carryAnchor     between the hands, in front of the chest
//             └ neck → head     skull, muzzle, nose, eyes, 2 ear Groups,
//                               whiskers, hachimaki, optional hat
//
// FACING NOTE (read before wiring the controller):
//   thirdPersonControls sets `group.rotation.y = atan2(move.x, move.z)`, so the
//   character's LOCAL +Z must be the direction of travel. This art is authored
//   nose-toward +Z, so `inner` starts at rotation.y = 0 — a half-turn here
//   would make the cat moonwalk. `setFacingOffset(rad)` (or the `facingOffset`
//   option) adds to it if a model with another convention is dropped in.
//
// SIGN CONVENTIONS (art faces +Z):
//   * A limb hanging along −Y swings BACKWARD for positive rotation.x, so
//     forward swing is NEGATIVE.
//   * An upright part (torso, neck) leans FORWARD for positive rotation.x.
//   * The tail points −Z, so positive rotation.x lifts the tip.
// ---------------------------------------------------------------------------

// --- skeleton metrics (scale = 1, soles on y = 0) --------------------------
const HIP_Y = 0.76;        // pelvis pivot — `body` sits here
const THIGH = 0.33;
const SHIN = 0.31;
const FOOT_H = 0.12;       // ankle → sole
const HIP_X = 0.12;
const TORSO_Y = 0.06;      // waist pivot, relative to the pelvis (world 0.82)
const SH_X = 0.245;
const SH_Y = 0.39;         // shoulder, relative to the waist (world 1.21)
const UPPER = 0.27;
const FORE = 0.25;
const NECK_Y = 0.44;       // relative to the waist (world 1.26)
const HEAD_Y = 0.055;      // relative to the neck (world 1.315)
const SKULL_Y = 0.205;     // skull centre, relative to the head pivot (world 1.52)
const SKULL_R = 0.26;
const EYE = [0.105, 0.27, 0.228];  // head-local (world y ≈ 1.58)
const TAIL_P = [0, -0.04, -0.185];
const TAIL_SEG = 5;
const TAIL_LEN = 0.15;
const TAIL_REST_LIFT = 0.24; // per-segment pitch that curves the chain into a J
const BLEND = 0.25;        // seconds for every pose cross-blend

// --- level of detail -------------------------------------------------------
// 'full' is the 25-mesh player rig. 'npc' collapses it to 7 meshes (head, torso,
// 2 arms, 2 legs, tail) by baking the joints a townsfolk cat will never be seen
// articulating at 20+ units. Seventeen NPCs at 25 meshes each was more draw
// calls than the entire city.
const ELBOW_BAKE = -0.42;  // fixed elbow angle baked into the NPC arm mesh
const LOD_STEP = 0.1;      // mid-band animation period (10 Hz)

// --- action vocabulary -----------------------------------------------------
const LOCO = ['idle', 'walk', 'run'];
const AIR = ['jump', 'fall'];
const HOLD = ['sit', 'sleep', 'carry', 'cook', 'fish', 'climb'];
const SHOT = { land: 0.36, meow: 1.15, stretch: 1.7, lick: 1.35, happy: 1.25, pounce: 0.85 };
const ACTIONS = new Set([...LOCO, ...AIR, ...HOLD, ...Object.keys(SHOT), 'tired']);
const MOODS = {
  // `tail` is the pitch at the ROOT; the per-segment lift below curves the rest
  // of the chain back up into the usual cat J.
  neutral: { ear: 0.0, tail: -0.20, blink: [3, 7], swish: 1.0 },
  happy: { ear: -0.10, tail: 0.34, blink: [2.4, 5.0], swish: 1.45 },
  tired: { ear: 0.42, tail: -0.62, blink: [1.8, 4.0], swish: 0.6 },
  focused: { ear: 0.04, tail: -0.30, blink: [5, 9], swish: 1.25 },
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

/** A rounder low-poly ball than blob() — used for the hero head. */
function ball(r, x, y, z, color, detail = 1) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  g.translate(x, y, z);
  return paint(g, color);
}

// ---------------------------------------------------------------------------
// Head accessories. Head-local space: the skull is centred at y = SKULL_Y with
// radius SKULL_R, so the crown sits at y ≈ 0.465.
// ---------------------------------------------------------------------------
function buildHat(kind, col) {
  const { accent, belly } = col;
  const white = '#f7f2e6';
  switch (kind) {
    case 'chef': // tall toque — kept narrow enough that the ears stay outside it
      return [
        cyl(0.175, 0.195, 0.08, 14, 0, 0.495, -0.04, white),
        ball(0.185, 0, 0.615, -0.04, white, 1),
        blob(0.105, -0.115, 0.575, 0.01, white),
        blob(0.105, 0.115, 0.575, -0.06, white),
        blob(0.10, 0, 0.585, -0.155, white),
      ];
    case 'bandana':
      return [
        box(0.45, 0.135, 0.40, 0, 0.375, -0.02, accent),
        box(0.11, 0.10, 0.10, 0.225, 0.335, -0.145, accent, [0, 0.5, 0]),
        box(0.18, 0.035, 0.06, 0.30, 0.30, -0.20, accent, [0, 0.5, 0.4]),
      ];
    case 'straw':
      return [
        cyl(0.40, 0.42, 0.032, 16, 0, 0.44, -0.01, '#e3c37a'),
        cyl(0.19, 0.225, 0.175, 14, 0, 0.53, -0.01, '#ecd79a'),
        cyl(0.196, 0.196, 0.04, 14, 0, 0.475, -0.01, accent),
      ];
    case 'cap':
      return [
        ball(0.265, 0, 0.30, -0.02, accent, 1),
        box(0.31, 0.035, 0.22, 0, 0.365, 0.235, accent, [0.14, 0, 0]),
        cyl(0.032, 0.032, 0.035, 8, 0, 0.565, -0.02, belly),
      ];
    case 'flower': {
      const parts = [blob(0.042, 0.185, 0.40, 0.06, '#f4d774')];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        parts.push(blob(0.052, 0.185 + Math.cos(a) * 0.07, 0.40 + Math.sin(a) * 0.065, 0.06, '#f3a6cf'));
      }
      parts.push(box(0.06, 0.02, 0.06, 0.185, 0.365, 0.03, '#6fae4e'));
      return parts;
    }
    case 'headband': // a wide sports band (the hachimaki is skipped for this one)
      return [
        box(0.42, 0.085, 0.06, 0, 0.325, 0.215, accent),
        box(0.06, 0.14, 0.42, -0.215, 0.30, -0.01, accent),
        box(0.06, 0.14, 0.42, 0.215, 0.30, -0.01, accent),
        box(0.42, 0.085, 0.06, 0, 0.325, -0.235, accent),
        blob(0.062, 0.235, 0.40, 0.07, accent),
      ];
    default:
      return null;
  }
}

/** The always-on sushi-chef hachimaki: a band with a knot and two trailing ends. */
function buildHachimaki(accent) {
  return [
    // Sized to the skull's radius at forehead height (0.197), so the band hugs
    // the head and sits ABOVE the eyes instead of across them.
    box(0.39, 0.07, 0.05, 0, 0.375, 0.19, accent),
    box(0.05, 0.075, 0.38, -0.19, 0.375, -0.01, accent),
    box(0.05, 0.075, 0.38, 0.19, 0.375, -0.01, accent),
    box(0.39, 0.07, 0.05, 0, 0.375, -0.21, accent),
    blob(0.05, 0, 0.375, -0.235, accent),
    box(0.032, 0.02, 0.19, -0.042, 0.35, -0.32, accent, [0.35, 0.2, 0]),
    box(0.032, 0.02, 0.19, 0.042, 0.36, -0.31, accent, [0.25, -0.2, 0]),
  ];
}

// ---------------------------------------------------------------------------
export function createCat(opts = {}) {
  const src = opts && typeof opts === 'object' ? opts : {};
  const col = {
    fur: safeColor(src.fur, '#4a7ec8'),
    belly: safeColor(src.belly, '#f4f7fb'),      // chef coat / muzzle / paw pads
    accent: safeColor(src.accent, '#f5f5f5'),    // headband, coat trim, nose
    eye: safeColor(src.eye, '#2a3d5c'),
  };
  const scale = Math.max(0.01, num(src.scale, 1));
  const lod = src.lod === 'npc' ? 'npc' : 'full';
  const NPC = lod === 'npc';
  // 'chef' is the default LOOK, but only when the caller never mentions a hat.
  // npcRuntime passes `hat: def.hat` for every townsfolk cat and most of those
  // defs have no hat at all, so testing `=== undefined` would have put a chef's
  // toque on the whole city. Checking for the KEY tells the two apart:
  //   createCat({})                 -> chef toque + apron   (the player)
  //   createCat({ hat: undefined }) -> bare head            (a plain NPC)
  //   createCat({ hat: 'straw' })   -> straw hat
  const hasHat = Object.prototype.hasOwnProperty.call(src, 'hat');
  const hat = hasHat ? (typeof src.hat === 'string' ? src.hat : null) : 'chef';
  // The apron follows the toque unless asked for explicitly, so only cats that
  // read as chefs wear one.
  const apron = Object.prototype.hasOwnProperty.call(src, 'apron') ? !!src.apron : hat === 'chef';
  const gradientMap = src.gradientMap || null;
  const facingBase = num(src.facingOffset, 0);
  let speedScale = Math.max(0.0001, num(src.speedScale, 1));

  const geos = [];
  const track = (g) => { if (g) geos.push(g); return g; };

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
  const add = (parent, parts, o) => { const m = meshOf(parts, o); if (m) parent.add(m); return m; };

  // ===== hierarchy ==========================================================
  // The Group rig is IDENTICAL for both LODs — only how many meshes hang off it
  // changes — so every pose, the IK and the auto-plant work the same either way.
  const group = new THREE.Group();
  group.name = 'cat';
  const inner = new THREE.Group();
  inner.rotation.y = facingBase;
  group.add(inner);
  const body = new THREE.Group();          // pelvis
  body.position.y = HIP_Y;
  inner.add(body);
  const torso = new THREE.Group();         // waist
  torso.position.y = TORSO_Y;
  body.add(torso);
  group.scale.setScalar(scale);

  // Baking helpers: to collapse a child pivot's parts into its parent's mesh,
  // its geometry has to be moved into the parent's space first.
  const _bm = new THREE.Matrix4();
  const _bq = new THREE.Matrix4();
  const xf = (parts, m) => parts.filter(Boolean).map((g) => g.applyMatrix4(m));
  const shift = (parts, x, y, z) => xf(parts, _bm.makeTranslation(x, y, z));
  /** Rotate about X then translate — the transform a bent child joint applies. */
  const bendTo = (parts, rx, x, y, z) => {
    _bm.makeRotationX(rx);
    _bm.premultiply(_bq.makeTranslation(x, y, z));
    return xf(parts, _bm);
  };

  // ---- part geometry ------------------------------------------------------
  // Each list is consumed exactly once (the bake helpers mutate in place).
  const hipsParts = [
    box(0.36, 0.25, 0.29, 0, -0.02, 0, col.fur),
    blob(0.15, -0.155, -0.03, 0, col.fur),
    blob(0.15, 0.155, -0.03, 0, col.fur),
    box(0.30, 0.09, 0.24, 0, -0.145, 0, col.fur),
  ];
  const torsoParts = [
    box(0.44, 0.43, 0.31, 0, 0.235, 0, col.belly),                     // coat body
    blob(0.145, -0.205, 0.395, 0, col.belly),                          // shoulders
    blob(0.145, 0.205, 0.395, 0, col.belly),
    box(0.33, 0.075, 0.24, 0, 0.455, 0.01, col.belly),                 // collar
    box(0.13, 0.10, 0.10, 0, 0.455, 0.14, col.accent),                 // collar knot
    // wrap front: two angled panels + the accent trim edge
    box(0.28, 0.34, 0.035, -0.075, 0.235, 0.158, col.belly, [0, 0, -0.34]),
    box(0.28, 0.34, 0.035, 0.075, 0.245, 0.162, col.belly, [0, 0, 0.34]),
    box(0.045, 0.36, 0.03, 0.055, 0.245, 0.178, col.accent, [0, 0, 0.34]),
    // neck stub — merged here so the neck Group stays a pure pivot
    cyl(0.115, 0.135, 0.16, 10, 0, 0.49, 0.012, col.fur),
  ];
  if (apron) {
    torsoParts.push(
      box(0.36, 0.30, 0.05, 0, 0.135, 0.163, '#f2e7d2'),
      box(0.47, 0.06, 0.32, 0, 0.27, 0, col.accent),
      box(0.09, 0.045, 0.10, -0.14, 0.235, -0.175, col.accent, [0, 0.4, 0]),
      box(0.09, 0.045, 0.10, 0.14, 0.235, -0.175, col.accent, [0, -0.4, 0]),
    );
  }
  const thighParts = () => [
    cyl(0.115, 0.098, THIGH, 10, 0, -THIGH / 2, 0, col.fur),
    blob(0.115, 0, -0.02, 0, col.fur),
  ];
  const shinParts = () => [
    cyl(0.092, 0.072, SHIN, 10, 0, -SHIN / 2, 0.005, col.fur),
    blob(0.088, 0, -0.01, 0, col.fur),
  ];
  const footParts = () => [
    box(0.145, FOOT_H, 0.235, 0, -FOOT_H / 2, 0.055, col.fur),
    blob(0.068, 0, -0.048, 0.15, col.fur),
    box(0.10, 0.03, 0.10, 0, -0.108, 0.10, col.belly),
  ];
  const upperParts = () => [
    cyl(0.098, 0.088, UPPER, 10, 0, -UPPER / 2, 0, col.belly),         // coat sleeve
    blob(0.10, 0, -0.015, 0, col.belly),
    cyl(0.092, 0.092, 0.035, 10, 0, -UPPER + 0.015, 0, col.accent),    // rolled cuff
  ];
  const foreParts = () => [
    cyl(0.082, 0.07, FORE, 10, 0, -FORE / 2, 0, col.fur),
    blob(0.082, 0, -0.01, 0, col.fur),
  ];
  /** Mitten paw that reads as a hand: palm, finger bulge, opposed thumb, pad. */
  const handParts = (side) => [
    box(0.115, 0.135, 0.095, 0, -0.062, 0.005, col.fur),
    blob(0.062, 0, -0.115, 0.012, col.fur),
    box(0.05, 0.075, 0.055, -side * 0.075, -0.05, 0.028, col.fur, [0, 0, -side * 0.35]),
    box(0.075, 0.09, 0.025, 0, -0.07, 0.055, col.belly),
  ];
  const skullParts = () => {
    const parts = [
      ball(SKULL_R, 0, SKULL_Y, 0, col.fur, 1),                        // skull
      blob(0.09, -0.105, 0.135, 0.175, col.fur),                       // cheeks
      blob(0.09, 0.105, 0.135, 0.175, col.fur),
      box(0.225, 0.135, 0.14, 0, 0.11, 0.205, col.belly),              // muzzle
      box(0.10, 0.05, 0.075, 0, 0.05, 0.225, col.belly),               // chin
      box(0.07, 0.055, 0.055, 0, 0.175, 0.282, col.accent),            // nose
    ];
    if (hat !== 'bandana' && hat !== 'headband') parts.push(...buildHachimaki(col.accent));
    return parts;
  };
  const earParts = () => [
    cyl(0.005, 0.10, 0.20, 5, 0, 0.10, 0, col.fur),
    cyl(0.004, 0.062, 0.15, 5, 0, 0.09, 0.018, col.accent),
  ];
  const eyeParts = () => [
    blob(0.056, -EYE[0], 0, 0, col.eye),
    blob(0.056, EYE[0], 0, 0, col.eye),
  ];
  const tailSegParts = (i) => {
    const r0 = 0.058 - i * 0.0072;
    const r1 = 0.058 - (i + 1) * 0.0072;
    const parts = [cyl(r0, Math.max(0.014, r1), TAIL_LEN, 7, 0, 0, -TAIL_LEN / 2, col.fur, [Math.PI / 2, 0, 0])];
    if (i === TAIL_SEG - 1) parts.push(blob(Math.max(0.024, r1), 0, 0, -TAIL_LEN, col.belly));
    return parts;
  };
  const EAR_SPLAY = 0.50;   // resting rotation.z, also baked into the NPC head
  const EAR_POS = [0.185, 0.37, 0.03];

  // ---- assemble -----------------------------------------------------------
  if (!NPC) add(body, hipsParts, { shadow: true });
  add(torso, NPC ? [...torsoParts, ...shift(hipsParts, 0, -TORSO_Y, 0)] : torsoParts, { shadow: true });

  // legs: full = thigh / shin / foot on their own pivots; npc = one rigid mesh
  const thighGeo = NPC ? null : track(merge(thighParts()));
  const shinGeo = NPC ? null : track(merge(shinParts()));
  const footGeo = NPC ? null : track(merge(footParts()));
  const legs = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.name = side < 0 ? 'legL' : 'legR';
    leg.position.set(side * HIP_X, 0, 0);

    const shin = new THREE.Group();
    shin.position.y = -THIGH;
    leg.add(shin);
    const foot = new THREE.Group();
    foot.position.y = -SHIN;
    shin.add(foot);

    if (NPC) {
      // One mesh for the whole leg, baked in the STRAIGHT rest pose. update()
      // zeroes the knee and ankle to match, so the contact markers still sit
      // exactly where the drawn foot is.
      add(leg, [
        ...thighParts(),
        ...shift(shinParts(), 0, -THIGH, 0),
        ...shift(footParts(), 0, -THIGH - SHIN, 0),
      ], { shadow: true });
    } else {
      const t = new THREE.Mesh(thighGeo, material); t.castShadow = true; leg.add(t);
      const s = new THREE.Mesh(shinGeo, material); s.castShadow = true; shin.add(s);
      const f = new THREE.Mesh(footGeo, material); f.castShadow = true; foot.add(f);
    }

    leg.userData = { side, shin, foot };
    body.add(leg);
    legs.push(leg);
  }
  const [legL, legR] = legs;

  // arms: full = upper / fore / hand; npc = one mesh with the elbow baked in
  const upperGeo = NPC ? null : track(merge(upperParts()));
  const foreGeo = NPC ? null : track(merge(foreParts()));
  const arms = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.name = side < 0 ? 'armL' : 'armR';
    arm.position.set(side * SH_X, SH_Y, 0);

    const fore = new THREE.Group();
    fore.position.y = -UPPER;
    arm.add(fore);
    const hand = new THREE.Group();
    hand.position.y = -FORE;
    fore.add(hand);

    if (NPC) {
      // A permanent gentle elbow bend reads far better than a straight stick;
      // update() pins fore.rotation.x to the same angle so the hand pivot (and
      // its contact sphere) tracks the drawn mesh.
      const handOff = new THREE.Vector3(0, -FORE, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), ELBOW_BAKE);
      add(arm, [
        ...upperParts(),
        ...bendTo(foreParts(), ELBOW_BAKE, 0, -UPPER, 0),
        ...bendTo(handParts(side), ELBOW_BAKE, handOff.x, -UPPER + handOff.y, handOff.z),
      ], { shadow: true });
    } else {
      const u = new THREE.Mesh(upperGeo, material); u.castShadow = true; arm.add(u);
      const f = new THREE.Mesh(foreGeo, material); f.castShadow = true; fore.add(f);
      const h = new THREE.Mesh(track(merge(handParts(side))), material); h.castShadow = true; hand.add(h);
    }

    const grip = new THREE.Object3D();
    grip.position.set(0, -0.10, 0.03);
    hand.add(grip);

    arm.userData = { side, fore, hand, grip };
    torso.add(arm);
    arms.push(arm);
  }
  const [armL, armR] = arms;

  // ---- neck + head --------------------------------------------------------
  const neck = new THREE.Group();
  neck.name = 'catNeck';
  neck.position.set(0, NECK_Y, 0.012);
  torso.add(neck);

  const head = new THREE.Group();
  head.name = 'catHead';
  head.position.y = HEAD_Y;
  neck.add(head);

  // Camera / speech-bubble reference. A marker rather than the eye mesh, so
  // eyeHeight() still works at the NPC LOD where the eyes are baked in.
  const eyeAnchor = new THREE.Object3D();
  eyeAnchor.position.set(0, EYE[1], EYE[2]);
  head.add(eyeAnchor);

  let mouth = null;
  let eyes = null;
  let whiskers = null;
  let hatMesh = null;
  const ears = [];

  if (NPC) {
    // Head, ears, eyes and hat all in ONE mesh. Blinking, ear twitches and
    // whisker jitter have nothing to drive and become no-ops (see update()).
    const parts = skullParts();
    for (const side of [-1, 1]) {
      _bm.makeRotationZ(side * EAR_SPLAY);
      _bm.premultiply(_bq.makeTranslation(side * EAR_POS[0], EAR_POS[1], EAR_POS[2]));
      parts.push(...xf(earParts(), _bm));
    }
    parts.push(...xf(eyeParts(), _bm.makeScale(1, 1, 0.6).premultiply(_bq.makeTranslation(0, EYE[1], EYE[2]))));
    if (hat) {
      const h = buildHat(hat, col);
      if (h) parts.push(...h);
    }
    // One mesh for the whole head, so there is no separate `hatMesh` to hand
    // back — callers that poke at it must null-check (they already do).
    add(head, parts, { shadow: true });
  } else {
    add(head, skullParts(), { shadow: true });

    mouth = new THREE.Mesh(track(box(0.085, 0.055, 0.03, 0, 0, 0, '#7d3b3b')), material);
    mouth.position.set(0, 0.072, 0.268);
    mouth.scale.y = 0.12;
    head.add(mouth);

    // Both eyes in ONE mesh (they always blink together) — the geometry is built
    // around y = 0 so scale.y closes the lids about the eye line.
    eyes = new THREE.Mesh(track(merge(eyeParts())), material);
    eyes.position.set(0, EYE[1], EYE[2]);
    eyes.scale.set(1, 1, 0.6);
    head.add(eyes);

    // ears — one Group each so they twitch and flatten independently
    const earGeo = track(merge(earParts()));
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      // Forward and splayed, so the ears stay clear of the toque instead of
      // being swallowed by it — they are half the silhouette at camera distance.
      g.position.set(side * EAR_POS[0], EAR_POS[1], EAR_POS[2]);
      const m = new THREE.Mesh(earGeo, material); m.castShadow = true; g.add(m);
      g.userData = { side };
      head.add(g);
      ears.push(g);
    }

    // whiskers — both fans in one mesh, jittered together
    const wp = [];
    for (const side of [-1, 1]) {
      for (let i = -1; i <= 1; i++) {
        wp.push(box(0.21, 0.009, 0.009, side * 0.20, 0.14 + i * 0.03, 0.20 + i * 0.012,
          '#f6f1e4', [0, side * i * 0.22, i * 0.17]));
      }
    }
    whiskers = meshOf(wp);
    if (whiskers) head.add(whiskers);

    if (hat) {
      const parts = buildHat(hat, col);
      if (parts) hatMesh = add(head, parts, { shadow: true });
    }
  }

  // ---- tail ---------------------------------------------------------------
  const tail = new THREE.Group();
  tail.name = 'catTail';
  tail.position.set(TAIL_P[0], TAIL_P[1], TAIL_P[2]);
  body.add(tail);
  const tailSegs = [];
  if (NPC) {
    // The 5-link chain collapses to one mesh on a single pivot, baked with the
    // resting J-curve. It still sways as a whole — a moving tail is the most
    // cat-like thing about the silhouette at distance, so it keeps its pivot.
    const seg = new THREE.Group();
    const parts = [];
    _bm.identity();
    for (let i = 0; i < TAIL_SEG; i++) {
      if (i > 0) {
        _bm.multiply(_bq.makeTranslation(0, 0, -TAIL_LEN));
        _bm.multiply(_bq.makeRotationX(TAIL_REST_LIFT));
      }
      parts.push(...xf(tailSegParts(i), _bm.clone()));
    }
    add(seg, parts, { shadow: true });
    tail.add(seg);
    tailSegs.push(seg);
  } else {
    let parent = tail;
    for (let i = 0; i < TAIL_SEG; i++) {
      const g = new THREE.Group();
      if (i > 0) g.position.z = -TAIL_LEN;
      add(g, tailSegParts(i), { shadow: true });
      parent.add(g);
      parent = g;
      tailSegs.push(g);
    }
  }

  // ---- carry anchor: between the hands, in front of the chest -------------
  const carryAnchor = new THREE.Object3D();
  carryAnchor.name = 'catCarryAnchor';
  carryAnchor.position.set(0, 0.24, 0.46);   // world ≈ (0, 1.06, 0.46)
  torso.add(carryAnchor);

  // ---- ground-contact volumes --------------------------------------------
  // The auto-plant (see the commit stage) drops the pelvis until the lowest
  // contact rests on y = 0, which is what keeps every pose out of the floor
  // without hand-tuning each one. Each contact is a point or a sphere; limbs
  // are registered as CAPSULES (a sphere at each end) because a single sphere
  // around a thigh either misses the low side or floats the whole body.
  // Everything is always live and the plant takes the minimum — gating them
  // per-pose would make the set change discontinuously mid-blend, which is
  // exactly when a limb slips through. The NPC LOD registers a reduced set
  // (its knee and ankle are frozen, so the shin adds nothing the thigh capsule
  // and the sole corners do not already cover).
  const CONTACTS = [];
  const pt = (parent, x, y, z) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    CONTACTS.push({ obj: o, r: 0 });
    return o;
  };
  const sph = (parent, x, y, z, r) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    parent.add(o);
    CONTACTS.push({ obj: o, r });
    return o;
  };
  const cap = (parent, y0, r0, y1, r1) => { sph(parent, 0, y0, 0, r0); sph(parent, 0, y1, 0, r1); };
  // The top radii are sized to swallow the joint blob as well as the tapered
  // cylinder — a blob of radius r sitting at −dy needs r + dy from the origin.

  for (const leg of legs) {
    // Feet are flat boxes, so they use exact corner POINTS — a sphere around a
    // foot would always dip below its own sole. All four bottom CORNERS: edge
    // midpoints alone let the front-outer corner dig in when the foot rolls.
    const f = leg.userData.foot;
    pt(f, 0.0725, -FOOT_H, 0.1725);
    pt(f, -0.0725, -FOOT_H, 0.1725);
    pt(f, 0.0725, -FOOT_H, -0.0625);
    pt(f, -0.0725, -FOOT_H, -0.0625);
    cap(leg, -0.02, 0.14, -THIGH, 0.10);
    if (!NPC) cap(leg.userData.shin, -0.01, 0.11, -SHIN, 0.075);
  }
  for (const arm of arms) {
    cap(arm, -0.015, 0.12, -UPPER, 0.092);
    if (!NPC) cap(arm.userData.fore, -0.01, 0.10, -FORE, 0.082);
    sph(arm.userData.hand, 0, -0.075, 0, 0.135);
  }
  sph(body, -0.13, -0.02, 0, 0.18);              // hips
  sph(body, 0.13, -0.02, 0, 0.18);
  const seatMark = pt(body, 0, -0.185, -0.10);   // what you sit on
  sph(torso, -0.12, 0.20, 0, 0.24);              // chest
  sph(torso, 0.12, 0.20, 0, 0.24);
  if (!NPC) { sph(torso, -0.19, 0.395, 0, 0.16); sph(torso, 0.19, 0.395, 0, 0.16); }
  sph(head, 0, SKULL_Y, 0, SKULL_R + 0.01);      // skull

  // =========================================================================
  // STATE
  // =========================================================================
  let time = 0;
  let phase = 0;
  let loco = 'idle';
  let hold = null;
  let shot = null;
  let shotT = 0, shotDur = 0;
  let manualAir = 0, manualAirName = 'jump';
  let tired = 0;
  let mood = 'neutral';
  let punchCd = 0;
  let cut = { lie: 0, sit: 0, sitUp: 0 };
  let disposed = false;
  let lodNear = 20, lodFar = 45;   // see setLodDistance()
  let lodAcc = 0;                  // dt banked while running at the mid-band rate
  let paused = false;

  const w = { sit: 0, sleep: 0, carry: 0, cook: 0, fish: 0, climb: 0, air: 0 };

  const rnd = (a, b) => a + Math.random() * (b - a);
  let blinkIn = rnd(1, 4), blinkT = -1;
  let twitchIn = rnd(2, 6), twitchT = -1, twitchEar = 0;
  let lookIn = rnd(5, 12), lookT = -1, lookYaw = 0;

  const _v = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _inv = new THREE.Matrix4();

  // =========================================================================
  // Two-link arm IK. The target is given in TORSO space; the shoulder offset is
  // removed here. cook / carry / fish / sit / climb / lick use it so the hands
  // land exactly where the pose needs them rather than being eyeballed.
  // =========================================================================
  const _ik = { sx: 0, sz: 0, el: 0 };
  function solveArm(arm, tx, ty, tz, out) {
    const dx = tx - arm.position.x;
    const dy = ty - arm.position.y;
    const dz = tz - arm.position.z;
    const n = Math.hypot(dx, dy, dz) || 1e-6;
    const ux = dx / n, uy = dy / n, uz = dz / n;
    const d = clamp(n, Math.abs(UPPER - FORE) + 0.02, UPPER + FORE - 0.015);
    const gamma = Math.acos(clamp((UPPER * UPPER + FORE * FORE - d * d) / (2 * UPPER * FORE), -1, 1));
    const alpha = Math.acos(clamp((UPPER * UPPER + d * d - FORE * FORE) / (2 * UPPER * d), -1, 1));
    out.sz = Math.asin(clamp(ux, -1, 1));   // sideways (applied first in XYZ order)
    // The elbow bends forward, so the upper arm leans back off the target line by alpha.
    out.sx = Math.atan2(-uz, -uy) + alpha;
    out.el = -(Math.PI - gamma);            // negative = bend forward
    return out;
  }

  // =========================================================================
  // API — actions
  // =========================================================================
  function setAction(name, options = {}) {
    if (disposed || typeof name !== 'string') return 0;
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
    const base = SHOT[n];
    if (!base) return 0;
    const spd = Math.max(0.1, num(options && options.speed, 1));
    shot = n; shotT = 0; shotDur = base / spd;
    return shotDur;
  }
  const playAction = setAction;

  function stopAction() { shot = null; shotT = 0; shotDur = 0; hold = null; manualAir = 0; }
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
  function setHeight(h) { const s = num(h, 1); if (s > 0) group.scale.setScalar(s); }
  function setFacingOffset(rad) { inner.rotation.y = facingBase + num(rad, 0); }
  function setCutscene(lie = 0, sit = 0, sitUp = 0) {
    cut = { lie: clamp01(num(lie, 0)), sit: clamp01(num(sit, 0)), sitUp: clamp01(num(sitUp, 0)) };
  }
  function setSpeedScale(k) { speedScale = Math.max(0.0001, num(k, 1)); }

  /**
   * Distance bands, in world units from the camera. Callers pass the current
   * distance to update() via `opts.distance` and this decides what to do with
   * it: inside `near` animate every frame, between `near` and `far` animate at
   * 10 Hz with the personality layer switched off, past `far` (or with
   * `opts.inFrustum === false`) hide the group and skip the pose solver
   * entirely. Drive it from QUALITY[].npcDistance — see npcRuntime.
   */
  function setLodDistance(near, far) {
    const n = Math.max(0, num(near, lodNear));
    const f = Math.max(n + 0.5, num(far, lodFar));
    lodNear = n; lodFar = f;
  }
  /** Freeze this cat in place (update() becomes a no-op) without hiding it. */
  function setPaused(v) { paused = !!v; }

  /** A playful lunging paw swipe. False while on cooldown or already busy. */
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
    const sy = group.scale.y || 1;
    for (const c of CONTACTS) {
      c.obj.getWorldPosition(_v);
      const h = _v.y - c.r * sy;
      if (h < y) y = h;
    }
    return Number.isFinite(y) ? y : null;
  }

  function groundFeet(floorY = 0, maxCorrection = 1.5) {
    if (disposed) return;
    const f = num(floorY, 0);
    const lim = Math.abs(num(maxCorrection, 1.5));
    group.updateMatrixWorld(true);
    const fy = footWorldY();
    if (fy === null) return;
    group.position.y += clamp(f - fy, -lim, lim);
    group.updateMatrixWorld(true);
  }

  /**
   * Eye height above the soles, in world units (group scale included).
   * ≈ 1.60 × scale standing, ≈ 1.02 × scale sitting. Measured off the eye mesh
   * so every pose reports honestly — thirdPersonControls uses it for the camera
   * target and restaurant.js hangs speech bubbles off it.
   */
  function eyeHeight() {
    if (disposed) return 1.60 * group.scale.y;
    group.updateMatrixWorld(true);
    eyeAnchor.getWorldPosition(_v);
    group.getWorldPosition(_v2);
    const h = _v.y - _v2.y;
    return Number.isFinite(h) && h > 0.02 ? h : 1.60 * group.scale.y;
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
  // Allocated once — update() runs for the player plus every NPC, every frame.
  const hipA = [0, 0], hipZ = [0, 0], kneeA = [0, 0], ankleA = [0, 0];
  const shA = [0, 0], shZ = [0, 0], shY = [0, 0], elbA = [0, 0];
  const ikX = [0, 0], ikY = [0, 0], ikZ = [0, 0], ikW = [0, 0];

  function update(dt, speed = 0, options = {}) {
    if (disposed || paused) return;
    const O = options && typeof options === 'object' ? options : {};
    let d = clamp(num(dt, 0.016), 0, 0.1);

    // ---- distance / visibility gate ---------------------------------------
    // `opts.distance` is opt-in: the player's cat never passes one and so is
    // always animated at full rate.
    let cheap = false;
    const viewDist = num(O.distance, -1);
    if (viewDist >= 0) {
      if (viewDist >= lodFar || O.inFrustum === false) {
        if (group.visible) group.visible = false;
        lodAcc = 0;
        return;                       // not drawn, not solved
      }
      if (!group.visible) group.visible = true;
      if (viewDist >= lodNear) {
        lodAcc += d;
        if (lodAcc < LOD_STEP) return;
        d = Math.min(lodAcc, 0.1);    // one bigger step instead of many small ones
        lodAcc = 0;
        cheap = true;                 // …and no personality layer out here
      } else {
        lodAcc = 0;
      }
    }
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

    loco = s < 0.15 ? 'idle' : s < 3.2 ? 'walk' : 'run';
    const runness = clamp01((s - 3.2) / 5);
    const moving = loco !== 'idle';

    // ---- blend weights ----------------------------------------------------
    const t = {
      sit: Math.max(hold === 'sit' ? 1 : 0, cut.sit, cut.sitUp),
      sleep: Math.max(hold === 'sleep' ? 1 : 0, cut.lie),
      carry: hold === 'carry' ? 1 : 0,
      cook: hold === 'cook' ? 1 : 0,
      fish: hold === 'fish' ? 1 : 0,
      climb: hold === 'climb' ? 1 : 0,
      air: airborne ? 1 : 0,
    };
    const k = d / BLEND;
    for (const key in w) w[key] = approach(w[key], t[key] || 0, k);

    // ---- personality timers ----------------------------------------------
    // Skipped in the mid band, and there is nothing to drive them at the NPC
    // LOD anyway (the eyes, ears and whiskers are baked into the head mesh).
    const M = MOODS[mood] || MOODS.neutral;
    const personality = !cheap && !NPC;
    if (personality) {
      if (blinkT >= 0) { blinkT += d; if (blinkT > 0.15) { blinkT = -1; blinkIn = rnd(M.blink[0], M.blink[1]); } }
      else { blinkIn -= d; if (blinkIn <= 0) blinkT = 0; }
      if (twitchT >= 0) { twitchT += d; if (twitchT > 0.3) { twitchT = -1; twitchIn = rnd(2, 6); } }
      else { twitchIn -= d; if (twitchIn <= 0) { twitchT = 0; twitchEar = Math.random() < 0.5 ? 0 : 1; } }
      if (lookT >= 0) { lookT += d; if (lookT > 1.4) { lookT = -1; lookIn = rnd(5, 12); } }
      else {
        lookIn -= d;
        if (lookIn <= 0 && !moving && w.sleep < 0.3) { lookT = 0; lookYaw = (Math.random() < 0.5 ? -1 : 1) * rnd(0.3, 0.62); }
      }
    }

    // ---- gait phase -------------------------------------------------------
    const gaitMul = (1 - 0.35 * tired) * (w.carry > 0.5 ? 0.86 : 1);
    if (moving) phase += d * (3.4 + Math.min(s, 10) * 1.25) * gaitMul;
    else phase += d * 0.6;

    // ======================= pose accumulators ============================
    let bY = 0, bX = 0, bZ = 0, bRotX = 0, bRotY = 0, bRotZ = 0;
    let tRotX = 0, tRotY = 0, tRotZ = 0;
    let nRotX = 0;
    let hRotX = 0, hRotY = 0, hRotZ = 0, hDy = 0, hDz = 0;
    let tlRotX = M.tail * (1 - 0.8 * tired) - 0.35 * tired;
    let tlAmp = 1, tlRate = M.swish, tlCurl = 0;
    let earBase = M.ear + 0.55 * tired;
    let eyeOpen = 1;
    let mouthOpen = 0.12;
    let plantW = 1;                       // 1 = glue the active contacts to y = 0
    for (let i = 0; i < 2; i++) {
      hipA[i] = 0; hipZ[i] = 0; kneeA[i] = 0; ankleA[i] = 0;
      shA[i] = 0; shZ[i] = 0; shY[i] = 0; elbA[i] = 0;
      ikX[i] = 0; ikY[i] = 0; ikZ[i] = 0; ikW[i] = 0;
    }
    const aimHand = (i, x, y, z, weight) => {
      ikX[i] += x * weight; ikY[i] += y * weight; ikZ[i] += z * weight; ikW[i] += weight;
    };

    // ---- locomotion -------------------------------------------------------
    const groundW = clamp01(1 - Math.max(w.sit, w.sleep, w.air, w.climb));
    if (groundW > 0.001) {
      const ampN = moving ? clamp01(0.55 + runness * 0.45) : 0;
      const A = (0.42 + 0.30 * runness) * ampN;
      const sp = Math.sin(phase);
      for (let i = 0; i < 2; i++) {
        const ph = i === 0 ? phase : phase + Math.PI;    // left / right
        const sw = Math.sin(ph);
        const hipRot = -sw * A * groundW;                // forward swing = negative
        // The knee bends through the swing half and stays near straight in stance.
        const knee = (0.18 + 0.95 * clamp01(Math.sin(ph - 0.5))) * A * groundW;
        // The ankle keeps the sole level, plus a toe-off push once the leg is back.
        const toeOff = 0.55 * A * clamp01(-sw) * groundW;
        hipA[i] += hipRot;
        kneeA[i] += knee;
        ankleA[i] += clamp(-(hipRot + knee) + toeOff, -0.7, 0.7);
        // Contralateral arm swing. The constant abduction holds the arms off
        // the coat so they stay part of the silhouette at camera distance —
        // hanging flush, cream sleeve against cream coat, they disappeared.
        shA[i] += sw * (0.34 + 0.30 * runness) * ampN * groundW;
        shZ[i] += (i === 0 ? -1 : 1) * (0.15 - 0.05 * runness) * groundW;
        elbA[i] += -(0.22 + 0.55 * clamp01(-sw) * ampN) * groundW;
      }
      // Pelvis: 2× bob, side-to-side weight shift, hip rotation.
      const bob = moving ? Math.sin(phase * 2) * (0.018 + 0.030 * runness) : Math.sin(time * 1.5) * 0.006;
      bY += bob * groundW;
      bRotY += sp * 0.11 * ampN * groundW;
      bRotZ += (moving ? sp * 0.05 * ampN : Math.sin(time * 0.7) * 0.03) * groundW;
      bX += (moving ? sp * 0.012 * ampN : Math.sin(time * 0.7) * 0.018) * groundW;
      // The torso counter-rotates against the hips and leans into a run.
      tRotY -= sp * 0.17 * ampN * groundW;
      tRotX += (moving ? 0.05 + 0.30 * runness : 0.02) * groundW;
      nRotX -= (moving ? 0.04 + 0.24 * runness : 0) * groundW;
      if (!moving) {                                     // breathing while standing
        tRotX += Math.sin(time * 1.5) * 0.012 * groundW;
        hDy += Math.sin(time * 1.5) * 0.004 * groundW;
      }
      tlRotX += (moving ? 0.10 + 0.30 * runness : 0) * groundW;
      tlRate *= 1 + runness * 0.8;
      if (crouch > 0.001) {
        for (let i = 0; i < 2; i++) {
          hipA[i] += -0.55 * crouch * groundW;
          kneeA[i] += 1.05 * crouch * groundW;
          ankleA[i] += -0.45 * crouch * groundW;
        }
        tRotX += 0.22 * crouch * groundW;
        earBase += 0.22 * crouch;
      }
    }

    // ---- airborne: jump / fall --------------------------------------------
    if (w.air > 0.001) {
      const a = w.air;
      const rising = vy > 0.4;
      plantW *= 1 - a;
      for (let i = 0; i < 2; i++) {
        hipA[i] += (rising ? -0.85 : -0.35) * a;
        kneeA[i] += (rising ? 1.35 : 0.55) * a;
        ankleA[i] += (rising ? -0.25 : 0.30) * a;
      }
      shA[0] += (rising ? -1.30 : -0.55) * a;
      shA[1] += (rising ? -1.30 : -0.55) * a;
      shZ[0] += 0.35 * a; shZ[1] += -0.35 * a;
      elbA[0] += -0.55 * a; elbA[1] += -0.55 * a;
      tRotX += (rising ? -0.18 : 0.16) * a;
      tlRotX += (rising ? 0.55 : -0.10) * a;
      tlAmp *= 0.5;
      earBase += 0.18 * a;
      nRotX += (rising ? -0.14 : 0.10) * a;
    }

    // ---- sit: on the ground, legs forward, hands on the knees --------------
    if (w.sit > 0.001) {
      const a = w.sit;
      const upright = clamp01(cut.sitUp);
      bY -= 0.46 * a;                                    // the auto-plant fine-tunes this
      bRotX += (0.12 - 0.10 * upright) * a;
      for (let i = 0; i < 2; i++) {
        hipA[i] += -1.42 * a;                            // thighs forward, roughly level
        kneeA[i] += 0.62 * a;                            // shins angle down and out
        ankleA[i] += 0.55 * a;
        hipZ[i] += (i === 0 ? -1 : 1) * 0.16 * a;
      }
      tRotX += (0.10 - 0.08 * upright) * a;
      aimHand(0, -0.235, -0.10, 0.34, a);                // hands rest on the knees
      aimHand(1, 0.235, -0.10, 0.34, a);
      tlRotX -= 0.30 * a;
      tlCurl += 0.34 * a;
      tlAmp *= 1 - 0.45 * a;
    }

    // ---- sleep: curled on one side ----------------------------------------
    if (w.sleep > 0.001) {
      const a = w.sleep;
      const breath = Math.sin(time * 1.05) * 0.5 + 0.5;
      bY -= 0.60 * a;
      bRotZ += 1.42 * a;                                 // roll onto the flank
      bRotX += 0.18 * a;
      for (let i = 0; i < 2; i++) {
        hipA[i] += -1.15 * a;
        kneeA[i] += (1.55 + breath * 0.05) * a;
        ankleA[i] += 0.30 * a;
        hipZ[i] += (i === 0 ? -1 : 1) * 0.10 * a;
      }
      tRotX += (0.30 + breath * 0.05) * a;               // curl + breathing
      tRotZ += 0.12 * a;
      shA[0] += -0.95 * a; shA[1] += -1.05 * a;
      elbA[0] += -1.35 * a; elbA[1] += -1.45 * a;
      shZ[0] += 0.18 * a; shZ[1] += -0.10 * a;
      nRotX += 0.22 * a;
      hRotZ += 0.12 * a;
      eyeOpen = Math.min(eyeOpen, 1 - 0.94 * a);
      earBase += 0.55 * a;
      tlRotX += 0.14 * a;
      tlCurl -= 0.40 * a;      // −X is UP once the body has rolled onto its flank
      tlAmp *= 1 - 0.85 * a;
      tlRate *= 0.35;
    }

    // ---- cook: THE hero pose ----------------------------------------------
    if (w.cook > 0.001) {
      const a = w.cook;
      for (let i = 0; i < 2; i++) {                      // feet planted, knees soft
        hipZ[i] += (i === 0 ? -1 : 1) * 0.10 * a;
        hipA[i] += -0.14 * a;
        kneeA[i] += 0.26 * a;
        ankleA[i] += -0.12 * a;
      }
      bY -= 0.03 * a;
      tRotX += 0.24 * a;                                 // lean over the counter
      nRotX += 0.34 * a;                                 // look down at the board
      hRotX += 0.12 * a;
      const chop = Math.sin(time * 8.2);
      const chopUp = clamp01(chop);
      aimHand(0, -0.155, 0.19, 0.415 + Math.sin(time * 2.4) * 0.012, a);   // left steadies
      aimHand(1, 0.145, 0.215 + chopUp * 0.135, 0.40 - chopUp * 0.055, a); // right chops
      hRotZ += chop * 0.03 * a;
      tlRotX -= 0.10 * a;
      tlAmp *= 0.7;
      earBase -= 0.06 * a;
    }

    // ---- carry: both hands out front, shorter stride -----------------------
    if (w.carry > 0.001) {
      const a = w.carry;
      aimHand(0, -0.175, 0.235, 0.435, a);
      aimHand(1, 0.175, 0.235, 0.435, a);
      tRotX -= 0.06 * a;
      nRotX += 0.05 * a;
      tlRotX += 0.18 * a;
    }

    // ---- fish: standing, rod out front, casting and reeling -----------------
    if (w.fish > 0.001) {
      const a = w.fish;
      const cast = Math.sin(time * 0.85);
      const reel = Math.sin(time * 3.1);
      for (let i = 0; i < 2; i++) {
        hipZ[i] += (i === 0 ? -1 : 1) * 0.12 * a;
        hipA[i] += -0.10 * a;
        kneeA[i] += 0.20 * a;
        ankleA[i] += -0.10 * a;
      }
      aimHand(1, 0.185, 0.335 + cast * 0.055, 0.325 + cast * 0.05, a);  // rod hand, high
      aimHand(0, -0.115, 0.135 + reel * 0.02, 0.315 + reel * 0.018, a); // reel hand, low
      tRotX += (0.06 + cast * 0.05) * a;
      tRotY -= 0.10 * a;
      nRotX += 0.10 * a;
      hRotY -= 0.08 * a;
      tlRotX += 0.10 * a;
      tlAmp *= 0.6;
      earBase -= 0.08 * a;
    }

    // ---- climb ------------------------------------------------------------
    if (w.climb > 0.001) {
      const a = w.climb;
      const c = Math.sin(time * 4.6);
      plantW *= 1 - 0.85 * a;
      bY += 0.10 * a;
      tRotX += 0.34 * a;
      for (let i = 0; i < 2; i++) {
        const sgn = i === 0 ? 1 : -1;
        hipA[i] += (-0.75 + sgn * c * 0.45) * a;
        kneeA[i] += (0.95 - sgn * c * 0.35) * a;
        ankleA[i] += -0.25 * a;
      }
      aimHand(0, -0.255, 0.60 + c * 0.14, 0.235, a);
      aimHand(1, 0.255, 0.60 - c * 0.14, 0.235, a);
      nRotX -= 0.28 * a;
      tlRotX -= 0.15 * a;
      tlAmp *= 0.55;
    }

    // ---- one-shots --------------------------------------------------------
    if (shot && shotDur > 0) {
      const p = clamp01(shotT / shotDur);
      const e = bell(p);
      switch (shot) {
        case 'land': {
          for (let i = 0; i < 2; i++) { hipA[i] += -0.70 * e; kneeA[i] += 1.25 * e; ankleA[i] += -0.55 * e; }
          tRotX += 0.30 * e;
          shA[0] += -0.55 * e; shA[1] += -0.55 * e;
          elbA[0] += -0.85 * e; elbA[1] += -0.85 * e;
          nRotX += 0.20 * e;
          earBase += 0.35 * e;
          tlRotX += 0.40 * e;
          break;
        }
        case 'stretch': {
          const up = bell(clamp01((p - 0.15) / 0.6));    // reach up, arch back, onto the toes
          shA[0] += -2.85 * up; shA[1] += -2.85 * up;
          shZ[0] += 0.34 * up; shZ[1] += -0.34 * up;
          elbA[0] += -0.30 * up; elbA[1] += -0.30 * up;
          tRotX -= 0.30 * up;
          nRotX -= 0.32 * up;
          for (let i = 0; i < 2; i++) { kneeA[i] += 0.10 * up; ankleA[i] += 0.36 * up; }
          mouthOpen = Math.max(mouthOpen, 0.9 * bell(clamp01((p - 0.3) / 0.45)));
          eyeOpen = Math.min(eyeOpen, 1 - 0.85 * bell(clamp01((p - 0.25) / 0.5)));
          tlRotX += 0.85 * e;
          earBase += 0.20 * e;
          break;
        }
        case 'lick': {
          const dab = Math.sin(p * Math.PI * 3);         // paw up to the muzzle
          aimHand(1, 0.10 + 0.02 * dab, 0.50 + 0.03 * dab, 0.30, e);
          nRotX += 0.30 * e;
          hRotZ += 0.16 * e;
          hRotY += 0.14 * e;
          tRotY -= 0.10 * e;
          mouthOpen = Math.max(mouthOpen, 0.4 + 0.35 * dab);
          eyeOpen = Math.min(eyeOpen, 1 - 0.55 * e);
          tlAmp *= 0.6;
          break;
        }
        case 'happy': {
          const hop = Math.abs(Math.sin(p * Math.PI * 3));
          bY += 0.11 * hop * e;
          plantW *= 1 - 0.85 * hop * e;
          shA[0] += -2.75 * e; shA[1] += -2.75 * e;
          shZ[0] += 0.55 * e; shZ[1] += -0.55 * e;
          elbA[0] += -0.45 * e; elbA[1] += -0.45 * e;
          for (let i = 0; i < 2; i++) { kneeA[i] += 0.45 * hop * e; hipA[i] += -0.25 * hop * e; }
          nRotX -= 0.30 * e;
          bRotZ += Math.sin(p * Math.PI * 6) * 0.07 * e;
          tlRotX += 0.70 * e;
          tlRate *= 2.2;
          earBase -= 0.16 * e;
          mouthOpen = Math.max(mouthOpen, 0.35 * e);
          break;
        }
        case 'meow': {
          const cry = bell(clamp01((p - 0.15) / 0.55));
          nRotX -= 0.45 * cry;                           // head back
          hRotX -= 0.12 * cry;
          shA[0] += -2.30 * e; shA[1] += -2.30 * e;
          shZ[0] += 0.60 * e; shZ[1] += -0.60 * e;
          elbA[0] += -0.70 * e; elbA[1] += -0.70 * e;
          tRotX -= 0.14 * e;
          mouthOpen = Math.max(mouthOpen, 0.15 + 0.9 * cry);
          eyeOpen = Math.min(eyeOpen, 1 - 0.5 * cry);
          earBase -= 0.12 * e;
          tlRotX += 0.45 * e;
          break;
        }
        case 'pounce': {
          const wind = clamp01(p / 0.32);                // wind up, then lunge
          const leapP = clamp01((p - 0.32) / 0.68);
          const leap = bell(leapP);
          const dip = p < 0.32 ? wind : 1 - leapP;
          plantW *= 1 - 0.9 * leap;
          bY += -0.13 * dip + 0.20 * leap;
          bZ += 0.26 * leap;
          tRotX += 0.26 * dip + 0.34 * leap;
          for (let i = 0; i < 2; i++) {
            hipA[i] += -0.55 * dip + 0.75 * leap;
            kneeA[i] += 1.15 * dip - 0.35 * leap;
            ankleA[i] += -0.45 * dip + 0.55 * leap;
          }
          shA[0] += 0.35 * dip - 1.45 * leap;
          shA[1] += 0.35 * dip - 1.45 * leap;
          elbA[0] += -(0.9 * dip + 0.15 * leap);
          elbA[1] += -(0.9 * dip + 0.15 * leap);
          nRotX -= 0.18 * leap;
          tlRotX += 0.70 * leap;
          tlAmp *= 0.4;
          earBase -= 0.18;
          break;
        }
        default: break;
      }
    }

    // ---- tired modifier ---------------------------------------------------
    if (tired > 0.001) {
      tRotX += 0.16 * tired;                             // shoulders droop forward
      nRotX += 0.24 * tired;                             // head dips
      shA[0] += 0.10 * tired; shA[1] += 0.10 * tired;
      elbA[0] += -0.12 * tired; elbA[1] += -0.12 * tired;
      for (let i = 0; i < 2; i++) kneeA[i] += 0.10 * tired;
      tlAmp *= 1 - 0.5 * tired;
      eyeOpen = Math.min(eyeOpen, 1 - 0.35 * tired);
    }

    // ---- personality layer ------------------------------------------------
    if (personality && blinkT >= 0) eyeOpen = Math.min(eyeOpen, 1 - bell(blinkT / 0.15));
    if (personality && lookT >= 0) {
      const l = Math.sin(clamp01(lookT / 1.4) * Math.PI);
      hRotY += lookYaw * l;
      hRotZ += lookYaw * 0.16 * l;
    }

    // =================== commit ===========================================
    body.position.set(bX, HIP_Y + bY, bZ);
    body.rotation.set(bRotX, bRotY, bRotZ);
    torso.rotation.set(tRotX, tRotY, tRotZ);

    if (NPC) {
      // The NPC leg is one rigid mesh and the arm has its elbow baked in, so
      // fold what those joints would have done back into the pivot that IS
      // drawn, then pin them to the baked angle. Pinning (rather than leaving
      // them free) matters because the contact markers hang off these pivots —
      // the auto-plant has to measure where the mesh actually is.
      for (let i = 0; i < 2; i++) {
        hipA[i] += kneeA[i] * 0.45;
        kneeA[i] = 0;
        ankleA[i] = 0;
      }
    }

    for (let i = 0; i < 2; i++) {
      const leg = legs[i];
      leg.rotation.set(hipA[i], 0, hipZ[i]);
      leg.userData.shin.rotation.x = Math.max(0, kneeA[i]);      // knees never hyperextend
      leg.userData.foot.rotation.x = clamp(ankleA[i], -0.9, 0.9);
    }

    for (let i = 0; i < 2; i++) {
      const arm = arms[i];
      let sx = shA[i], sz = shZ[i], el = elbA[i];
      if (ikW[i] > 0.001) {
        const iw = clamp01(ikW[i]);
        solveArm(arm, ikX[i] / ikW[i], ikY[i] / ikW[i], ikZ[i] / ikW[i], _ik);
        sx = sx * (1 - iw) + _ik.sx * iw;
        sz = sz * (1 - iw) + _ik.sz * iw;
        el = el * (1 - iw) + _ik.el * iw;
      }
      if (NPC) { sx += (el - ELBOW_BAKE) * 0.35; el = ELBOW_BAKE; }
      arm.rotation.set(sx, shY[i], sz);
      arm.userData.fore.rotation.x = clamp(el, -2.5, 0);         // elbows only bend forward
    }

    neck.rotation.set(nRotX, 0, 0);
    head.position.set(0, HEAD_Y + hDy, hDz);
    head.rotation.set(hRotX, hRotY, hRotZ);

    if (eyes) eyes.scale.set(1, clamp(eyeOpen, 0.04, 1), 0.6);
    if (mouth) mouth.scale.y = clamp(mouthOpen, 0.08, 1.6);

    for (let i = 0; i < ears.length; i++) {
      const g = ears[i];
      let tw = 0;
      if (twitchT >= 0 && twitchEar === i) tw = Math.sin(twitchT * 34) * 0.30 * (1 - twitchT / 0.3);
      g.rotation.set(-earBase * 0.9, 0, g.userData.side * (0.50 + earBase * 0.55) + tw);
    }

    if (whiskers) {
      whiskers.rotation.z = Math.sin(time * 6.5) * 0.035 + Math.sin(time * 17) * 0.012;
      whiskers.rotation.y = Math.sin(time * 4.1) * 0.03;
    }

    tail.rotation.set(tlRotX, tlCurl * 0.8, 0);
    for (let i = 0; i < tailSegs.length; i++) {
      const g = tailSegs[i];
      const lag = i * 0.55;
      const seg = 0.5 + i * 0.16;
      g.rotation.y = Math.sin(time * 2.1 * tlRate - lag) * 0.16 * seg * tlAmp + tlCurl;
      g.rotation.x = Math.sin(time * 1.5 * tlRate - lag * 0.8) * 0.10 * seg * tlAmp
        + (i > 0 ? TAIL_REST_LIFT * tlAmp + 0.22 * w.sit + 0.20 * w.sleep : 0);
    }

    // ---- auto-plant -------------------------------------------------------
    // Every pose above is authored freely; this drops (or lifts) the pelvis so
    // the lowest ACTIVE contact — the soles normally, the seat when sitting,
    // the flank when asleep — comes to rest exactly on y = 0. That is what
    // keeps the feet out of the floor across all 18 actions and every blend
    // between them, without per-pose tuning.
    if (plantW > 0.002) {
      group.updateMatrixWorld(true);
      _inv.copy(group.matrixWorld).invert();   // one inverse per frame, not per contact
      let low = Infinity;
      for (const c of CONTACTS) {
        _v.setFromMatrixPosition(c.obj.matrixWorld).applyMatrix4(_inv);
        const h = _v.y - c.r;                  // group-local Y == body-local Y
        if (h < low) low = h;
      }
      if (Number.isFinite(low)) body.position.y -= clamp(low, -1.2, 1.2) * clamp01(plantW);
    }
  }

  // =========================================================================
  return {
    group, inner, body, torso, neck, head, tail, tailSegs, ears, eyes,
    legs, legL, legR, arms, armL, armR, carryAnchor, hatMesh,
    handL: armL.userData.grip, handR: armR.userData.grip,
    material, materials: mats,
    update,
    setAction, playAction, stopAction, actionReady,
    get actionPlaying() { return !!shot; },
    get action() { return currentAction(); },
    setTired, setMood, setTint, setHeight, setFacingOffset, setCutscene, setSpeedScale,
    setLodDistance, setPaused,
    groundFeet, footWorldY, punch, eyeHeight, dispose,
    isProcedural: true,
    get lod() { return lod; },
    get paused() { return paused; },
  };
}

export default createCat;
