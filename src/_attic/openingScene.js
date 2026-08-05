import * as THREE from 'three';
import { box, cyl, merge } from './shops/common.js';
import { createCutscene } from './cinematic.js';
import { onVrmLibraryReady } from './vrmLibrary.js';
import { poseLocomotion, strideRate } from './humanoidPose.js';

// The opening cutscene: you come round in a hospital bed with no memory.
//
// Structure — three timelines running off one clock, so retiming the scene is a
// matter of editing numbers rather than rewiring anything:
//
//   CAMERA     a shot list (position + aim point per beat) played by the shared
//              cutscene player in cinematic.js, which eases between beats. Aim
//              is keyed separately from position, which is what gives the
//              drifting, hand-held-dolly feel.
//   ACTOR      keyframed body pose: lying flat, then sitting up on the edge of
//              the bed, then standing. Feeds character.setCutscene().
//   SUBTITLES  a cue list, each revealed with a typewriter effect.
//
// SCRIPT is placeholder text — edit it freely, the timeline reads its own
// durations from the cues.
//
// The room is a self-lit inverted shell like the shop interiors, so it needs no
// extra lights and can't occlude the camera from outside.

// ---------------------------------------------------------------------------
// SCRIPT — edit me. `t` is seconds from the start, `hold` how long it stays up.
// ---------------------------------------------------------------------------
export const SCRIPT = [
  { t: 1.5,  hold: 4.5, who: 'Nurse',  text: 'Easy now. You’ve been out for two days.' },
  { t: 6.5,  hold: 5.0, who: 'Nurse',  text: 'A ferryman found you washed ashore by the bridge.' },
  { t: 12.0, hold: 4.5, who: 'Nurse',  text: 'No wallet, no papers. Nothing but the clothes you had on.' },
  { t: 17.0, hold: 4.5, who: 'Nurse',  text: 'Do you remember your name? …Anything at all?' },
  { t: 22.0, hold: 4.0, who: '',       text: 'You don’t.' },
  { t: 26.5, hold: 4.0, who: 'Nurse',  text: 'Then start here. The city’s all you’ve got now.' },
];

export const SCENE_LENGTH = 32;   // seconds; the hand-off happens at the end


// Bed geometry, shared by the room builder and the actor timeline.
// Bed geometry, shared by the room builder and the actor timeline. The surface
// height matters: a seated adult's feet only reach the floor if the mattress is
// about a lower-leg above it, which at this scale (character = 4 units ≈ 1.8 m)
// is ~1.1 units. The old 1.62 was waist-high, which is why getting out of it
// could never look grounded.
const BED = { x: 0, z: 0.4, surfaceY: 1.12, len: 4.6, wide: 2.4 };
const BED_TOP = BED.surfaceY;

export function createOpeningScene(opts = {}) {
  const {
    scene, camera, character, gradientMap,
    onFinish = () => {},
  } = opts;

  // ------------------------------------------------------------------ room --
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const W = 18, H = 4.8, D = 15;
  const shellMat = new THREE.MeshToonMaterial({
    color: 0xdfe7ea, gradientMap, side: THREE.BackSide,
    emissive: new THREE.Color(0xe8f2f6), emissiveIntensity: 0.42,
  });
  const propMat = new THREE.MeshToonMaterial({
    vertexColors: true, gradientMap,
    emissive: new THREE.Color(0xdfe9ee), emissiveIntensity: 0.18,
  });
  const lampMat = new THREE.MeshToonMaterial({
    color: 0xfdfff4, emissive: new THREE.Color(0xfdfff4), emissiveIntensity: 0.95,
  });
  // Blown-out daylight through the window — the brightest thing in the room, so
  // the camera's first move naturally reads as "drifting toward the light".
  const dayMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });

  const shell = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), shellMat);
  shell.position.y = H / 2;
  group.add(shell);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D),
    new THREE.MeshToonMaterial({
      color: 0xbfc9cc, gradientMap,
      emissive: new THREE.Color(0xbfc9cc), emissiveIntensity: 0.2,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.02;
  group.add(floor);

  for (const lx of [-5, 5]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.18, 1.1), lampMat);
    lamp.position.set(lx, H - 0.14, -1);
    group.add(lamp);
  }

  // Window on the back wall, with a frame and a sill.
  const win = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 3.0), dayMat);
  win.position.set(-0.4, 2.7, -D / 2 + 0.06);
  group.add(win);

  const WHITE = '#f2f6f7', STEEL = '#aab4bb', SHEET = '#eef4f6';
  const MINT = '#bfe0d8', WOOD = '#b9906a', DARK = '#5c666d';

  const props = [
    // --- bed (surface at BED_TOP so a seated figure's feet reach the floor) --
    box(BED.wide, 0.26, BED.len, BED.x, BED_TOP - 0.26, BED.z, WHITE),          // base
    box(BED.wide - 0.1, 0.22, BED.len - 0.1, BED.x, BED_TOP - 0.02, BED.z, SHEET), // mattress
    box(BED.wide + 0.14, 0.12, 0.12, BED.x, BED_TOP - 0.42, BED.z - BED.len / 2, STEEL),
    box(BED.wide + 0.14, 0.12, 0.12, BED.x, BED_TOP - 0.42, BED.z + BED.len / 2, STEEL),
    box(1.5, 0.2, 0.9, BED.x, BED_TOP + 0.18, BED.z - BED.len / 2 + 0.85, WHITE),  // pillow
    box(BED.wide - 0.04, 0.12, 1.8, BED.x, BED_TOP + 0.14, BED.z + 1.35, MINT),    // folded blanket
    // headboard + footboard
    box(BED.wide + 0.2, 0.95, 0.12, BED.x, BED_TOP + 0.45, BED.z - BED.len / 2 - 0.1, STEEL),
    box(BED.wide + 0.2, 0.6, 0.12, BED.x, BED_TOP + 0.28, BED.z + BED.len / 2 + 0.1, STEEL),
    // legs
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) =>
      box(0.12, BED_TOP - 0.39, 0.12, BED.x + sx * (BED.wide / 2 - 0.2), (BED_TOP - 0.39) / 2, BED.z + sz * (BED.len / 2 - 0.3), STEEL))),

    // --- bedside table + monitor ------------------------------------------
    box(1.5, 1.05, 1.2, 3.0, 0.52, BED.z - 1.2, WOOD),
    box(1.2, 0.09, 1.0, 3.0, 1.09, BED.z - 1.2, WHITE),
    cyl(0.2, 0.24, 0.45, 10, 3.0, 1.36, BED.z - 1.4, MINT),                    // a cup
    // monitor on a stand
    cyl(0.09, 0.09, 2.1, 8, 4.4, 1.05, BED.z - 1.8, STEEL),
    box(1.1, 0.8, 0.5, 4.4, 2.4, BED.z - 1.8, DARK),
    box(0.92, 0.6, 0.06, 4.4, 2.42, BED.z - 1.55, '#7fe3b0'),                // its glowing readout

    // --- IV stand ----------------------------------------------------------
    cyl(0.06, 0.06, 3.0, 8, -2.5, 1.5, BED.z - 1.6, STEEL),
    cyl(0.5, 0.5, 0.08, 10, -2.5, 0.05, BED.z - 1.6, STEEL),
    box(0.36, 0.7, 0.24, -2.5, 2.75, BED.z - 1.6, '#dff0ff'),                // drip bag

    // --- curtain rail + curtain -------------------------------------------
    box(0.08, 0.08, 7.0, -4.3, H - 0.5, BED.z, STEEL),
    box(0.12, 2.7, 3.2, -4.3, H - 1.9, BED.z + 1.6, MINT),

    // --- door with an exit sign -------------------------------------------
    box(0.16, 3.1, 1.9, W / 2 - 0.02, 1.55, 3.6, WOOD),
    box(0.1, 0.34, 1.0, W / 2 - 0.12, 3.5, 3.6, '#2fd06a'),

    // --- a visitor's chair -------------------------------------------------
    box(1.0, 0.12, 1.0, -3.4, 0.9, BED.z + 2.6, WOOD),
    box(1.0, 1.0, 0.12, -3.4, 1.4, BED.z + 3.05, WOOD),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) =>
      box(0.1, 0.9, 0.1, -3.4 + sx * 0.4, 0.45, BED.z + 2.6 + sz * 0.4, WOOD))),
  ];
  const propMesh = new THREE.Mesh(merge(props), propMat);
  propMesh.castShadow = propMesh.receiveShadow = false;
  group.add(propMesh);

  // ----------------------------------------------------------------- nurse --
  // One of the city's five VRoid avatars, recoloured into a uniform. VRoid tags
  // every material with its role, so tintClothing() can repaint the garments
  // white-and-teal without turning her skin and hair teal as well. She stands
  // at the bedside for the whole scene, breathing on the shared idle pose.
  const NURSE = {
    model: 1,                       // ling1
    uniform: 0xf2fbff,              // near-white scrubs
    trim: 0x7fd9c8,                 // teal accents on the shoes/second layer
    height: 3.95,
    x: BED.x - BED.wide / 2 - 1.35,
    z: BED.z - 0.2,
    yaw: Math.PI / 2,               // facing across the bed, toward the patient
  };

  let nurse = null;                 // { avatar, phase, elapsed }
  onVrmLibraryReady((lib) => {
    const avatar = lib.make(NURSE.model);
    if (!avatar) return;
    avatar.tintClothing(new THREE.Color(NURSE.uniform));
    avatar.tintClothing(new THREE.Color(NURSE.trim), /Shoes/i);
    avatar.setDetail(true);
    avatar.setShadow(false);
    avatar.root.visible = true;
    avatar.root.matrixWorldAutoUpdate = true;
    avatar.root.scale.setScalar(NURSE.height / lib.baseHeight);
    avatar.root.position.set(NURSE.x, 0, NURSE.z);
    avatar.root.rotation.y = NURSE.yaw;

    // A little nurse's cap, parented to the RAW head bone so it rides along
    // with every head movement for free.
    if (avatar.rawHead) {
      const capMat = new THREE.MeshToonMaterial({
        color: 0xffffff, gradientMap,
        emissive: new THREE.Color(0xdfeef4), emissiveIntensity: 0.25,
      });
      const crossMat = new THREE.MeshToonMaterial({
        color: 0x4fc4b0, gradientMap,
        emissive: new THREE.Color(0x4fc4b0), emissiveIntensity: 0.4,
      });
      const cap = new THREE.Group();
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.05, 12), capMat);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.018, 0.13), capMat);
      brim.position.set(0, -0.02, 0.02);
      const barV = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.006, 0.052), crossMat);
      const barH = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.006, 0.018), crossMat);
      barV.position.set(0, 0.026, -0.01);
      barH.position.set(0, 0.026, -0.01);
      cap.add(crown, brim, barV, barH);
      // Head-bone local space is the model's own scale, hence the small numbers.
      cap.position.set(0, 0.15, 0.01);
      cap.rotation.x = -0.12;
      avatar.rawHead.add(cap);
    }

    group.add(avatar.root);
    nurse = { avatar, phase: 0, elapsed: 0 };
  });

  function updateNurse(dt) {
    if (!nurse || dt <= 0) return;
    // Idle: the shared city gait at zero speed, so she breathes and sways like
    // everyone else rather than standing frozen.
    nurse.phase += dt * strideRate(0);
    nurse.elapsed += dt;
    poseLocomotion(nurse.avatar.bones, nurse.avatar.hipsRestY,
      { speed: 0, phase: nurse.phase, elapsed: nurse.elapsed });
    nurse.avatar.humanoid.update();
    if (nurse.avatar.springs) nurse.avatar.springs.update(dt);
  }

  // ---------------------------------------------------------------- camera --
  // Shot list handed to the shared cutscene player. `p` = camera position,
  // `a` = what it looks at; the player eases between them with a smoothstep.
  const SHOTS = [
    // 1. establishing drift across the room, toward the window light
    { t: 0.0,  p: [-7.2, 3.6, 6.4],  a: [-2.0, 2.4, -5.0] },
    { t: 5.0,  p: [-5.0, 3.2, 3.0],  a: [-1.4, 2.2, -5.4] },
    // 2. come around and find the bed — the nurse is already at the bedside
    { t: 9.5,  p: [3.6, 3.0, 5.8],   a: [-0.7, 1.9, 0.2] },
    { t: 14.0, p: [4.2, 2.4, 2.8],   a: [-1.0, 1.9, 0.0] },
    // 3. push in on the patient as they stir and fold upright
    { t: 18.0, p: [2.7, 1.95, 1.1],  a: [0.0, 1.5, -0.5] },
    { t: 21.2, p: [2.9, 2.15, 1.7],  a: [0.0, 2.0, -0.2] },

    // 4. CUT — round to the side of the bed. Cutting on the action covers the
    //    legs swinging over the edge, which is the one move a single pivot
    //    can't sell, and lands on a framing that shows the feet on the floor.
    { t: 21.6, cut: true, p: [6.2, 2.1, 3.8], a: [1.9, 1.25, 0.8] },
    { t: 26.6, p: [5.7, 2.7, 4.4],   a: [2.1, 2.2, 0.9] },
    // 5. settle into the gameplay framing
    { t: 32.0, p: [4.2, 3.4, 6.8],   a: [2.0, 2.0, 1.2] },
  ];

  // The get-up, in four beats. The old version rotated the WHOLE body upright
  // about its own origin (which sits at the feet) and then slid it down through
  // the air to the floor — that pivot and that slide are what read as floating.
  //
  // Now:
  //   1. lying      body flat on the mattress
  //   2. sit up     a bone-level fold at the waist — the torso comes up while
  //                 the legs stay flat on the bed. Nothing translates.
  //   3. CUT        the camera cuts, and we place the figure seated on the edge
  //                 of the bed. Swinging the legs round is the one motion that
  //                 can't be faked with a single pivot, so it happens on the cut
  //                 — which is how a film would do it anyway.
  //   4. stand      the seated pose blends out. The feet are ALREADY planted, so
  //                 the body rises out of the pose instead of being flown down
  //                 to the floor.
  //
  // Through beats 3 and 4 a grounding pass reads the real world position of the
  // foot bones each frame and lifts the root so the soles stay exactly on the
  // floor, whatever the pose is doing.
  const lerp = (a, b, f) => a + (b - a) * f;
  const smooth = (f) => f * f * (3 - 2 * f);

  const BEAT = {
    sitUpStart: 18.0,
    sitUpEnd: 21.2,
    cut: 21.6,          // camera cut — matches the SHOTS cut below
    standStart: 23.4,
    standEnd: 26.6,
  };

  // Where the hips rest while lying, and where the figure sits on the edge.
  const HIP_LIE_Z = BED.z - 0.15;
  const EDGE = { x: BED.x + BED.wide / 2 + 0.28, z: BED.z + 0.5, yaw: Math.PI / 2 };

  let soleOffset = null;   // foot-bone height above the floor in the rest pose

  function actorAt(t) {
    if (t < BEAT.cut) {
      // Beats 1-2: lying, with the torso folding up at the waist.
      const f = smooth(Math.max(0, Math.min(1,
        (t - BEAT.sitUpStart) / Math.max(0.001, BEAT.sitUpEnd - BEAT.sitUpStart))));
      return { phase: 'bed', lie: 1, sit: 0, sitUp: f };
    }
    // Beats 3-4: seated on the edge, then standing.
    const f = smooth(Math.max(0, Math.min(1,
      (t - BEAT.standStart) / Math.max(0.001, BEAT.standEnd - BEAT.standStart))));
    return { phase: 'edge', lie: 0, sit: 1 - f, sitUp: 0, stand: f };
  }

  // ------------------------------------------------------------------ flow --
  // Everything cinematic — letterbox, fade, typewriter subtitles, skip, and the
  // exactly-once hand-off — comes from the shared player, so the intro and the
  // mission briefings behave identically.
  // Measure how far the foot BONE sits above the sole in the rest pose, so the
  // grounding pass has a real reference instead of an assumed leg length. Runs
  // once, as soon as the VRM has finished loading (there are ~18 seconds of
  // lying still before the number is first needed).
  function calibrateSole() {
    character.setCutscene(0, 0, 0);
    character.group.position.set(0, 0, 0);
    character.group.rotation.set(0, 0, 0);
    character.update(1 / 60, 0);
    character.group.updateMatrixWorld(true);
    const fy = character.footWorldY();
    if (fy !== null) soleOffset = fy;   // the caller overwrites the transform next
  }

  function applyActor(t, dt) {
    if (soleOffset === null) calibrateSole();
    const a = actorAt(t);
    character.setCutscene(a.lie, a.sit, a.sitUp);

    if (a.phase === 'bed') {
      // Lying on the back: the body runs along -Z from its origin, so the origin
      // sits at the foot of the bed. Raised by half a torso so the back rests ON
      // the mattress rather than sinking into it.
      character.group.position.set(BED.x, BED_TOP + 0.22, HIP_LIE_Z + 1.95);
      character.group.rotation.set(-Math.PI / 2, 0, 0);
    } else {
      character.group.rotation.set(0, EDGE.yaw, 0);
      // Ease forward off the bed as the legs straighten, so standing carries a
      // small step rather than rising on the spot.
      const fwd = a.stand * 0.55;
      character.group.position.set(EDGE.x + fwd, character.group.position.y, EDGE.z);
    }

    if (dt > 0) character.update(dt, 0);

    // ---- grounding -------------------------------------------------------
    // Pose first, then measure. footWorldY() reads the RAW foot bones — where
    // the feet actually ended up — and the root is lifted so the soles sit on
    // the floor. This is what guarantees "no floating" regardless of how the
    // pose blends; nothing here assumes a leg length.
    if (a.phase === 'edge') {
      character.group.updateMatrixWorld(true);
      const fy = character.footWorldY();
      if (fy !== null && soleOffset !== null) {
        character.group.position.y += soleOffset - fy;   // soles onto y = 0
        character.group.updateMatrixWorld(true);
      }
    }
  }

  const cut = createCutscene({
    camera,
    shots: SHOTS,
    cues: SCRIPT,
    length: SCENE_LENGTH,
    fadeIn: 1.2,
    fadeOut: 1.2,
    onFrame: (t, dt) => { applyActor(t, dt); updateNurse(dt); },
    onFinish: () => {
      character.setCutscene(0, 0);
      character.group.rotation.set(0, 0, 0);
      onFinish();
      group.visible = false;
    },
  });

  function play() {
    group.visible = true;
    cut.play();
  }

  return {
    group,
    play,
    update: (dt) => cut.update(dt),
    skip: () => cut.skip(),
    get running() { return cut.running; },
    get finished() { return cut.finished; },
  };
}
