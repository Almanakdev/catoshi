import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { poseLocomotion, strideRate, REST } from './humanoidPose.js';
import { loadMixamoClip } from './mixamoRetarget.js';

// Loads a VRoid/VRM avatar and drives it as the player character. The VRM ships
// with NO animation clips, so idle / walk / run are animated procedurally by
// rotating the humanoid bones (via vrm.humanoid.getNormalizedBoneNode). Hair and
// clothes sway on their own because vrm.update(dt) advances the spring bones.
//
// Exposes the SAME interface the third-person controller + UI expect, so it drops
// in for the old robot model: { group, update(dt, speed, opts), setHeight, setTint,
// setFacingOffset, punch }.
//
// `opts` carries the controller's vertical/stance state — { crouch, airborne, vy }
// — which is layered on top of the idle/walk/run pose:
//   · crouch  additively bends the knees, sinks the pelvis and tucks the elbows,
//             so a crouch-walk keeps its (shortened) stride.
//   · airborne blends (not adds) toward a jump pose, so the gait gets out of the
//             way completely while the feet are off the ground.

// Mixamo one-shots, retargeted onto the humanoid rig at load time.
// `rootMotion: 'none'` pins the hips for the car animations: they're played in
// place at a spot the game has already chosen (the driver's door), so ANY
// translation from the clip is drift. The knock-down keeps its vertical motion
// so the body can still go down to the road.
const ACTION_FILES = {
  'enter-car': { file: 'entering-car.fbx', rootMotion: 'none' },
  'exit-car': { file: 'exiting-car.fbx', rootMotion: 'none' },
  'hit-by-car': { file: 'hit-by-car.fbx', rootMotion: 'vertical' },
};
const BASE = import.meta.env?.BASE_URL ?? '/';

export function createVRMCharacter(config = {}) {
  const {
    url = `${import.meta.env?.BASE_URL ?? '/'}models/piff1.vrm`,
    targetHeight = 4,
    height = 1,
  } = config;

  const group = new THREE.Group();
  const inner = new THREE.Group(); // orients the avatar (face its movement dir)
  inner.rotation.y = Math.PI;      // VRM faces -Z after rotateVRM0 → flip to +Z
  group.add(inner);
  group.scale.setScalar(height);

  let vrm = null;
  const bones = {};                // cached normalized humanoid bone nodes
  let hipsRestY = 0;               // rest height of the hips node (for the bob)
  const tintMats = [];             // materials we can recolour for the UI tint

  // Locomotion + timing state.
  let smoothSpeed = 0;             // eased movement speed → smooth gait blends
  let phase = 0;                   // stride phase accumulator
  let elapsed = 0;                 // for the breathing idle
  let punchT = -1;                 // >= 0 while a jab plays
  let punchCd = 0;
  let cutLie = 0, cutSit = 0, cutSitUp = 0; // opening-cutscene pose weights (see setCutscene)

  // ---- Retargeted Mixamo actions ------------------------------------------
  // The gait in humanoidPose.js is procedural, so a keyframed clip can't just be
  // layered onto it — both write the same normalized bones. Instead the
  // procedural pose is computed first, snapshotted, then the mixer overwrites
  // the bones, and finally each bone is blended back toward the snapshot by
  // (1 - weight). That crossfades in AND out of a clip with one mechanism.
  const mixer = { m: null, clips: new Map(), action: null, weight: 0, fadeIn: 0.18, fadeOut: 0.3, dur: 0, t: 0 };
  const blendNodes = [];                    // normalized bone nodes to blend
  const snapQ = [];                         // their procedural rotations
  const snapHips = new THREE.Vector3();
  let soleK = null;   // foot-bone height above the sole, in the rest pose
  let airW = 0;                    // eased 0→1 jump-pose weight (no snap on take-off)
  let wasAir = false;              // previous frame's airborne flag → landing edge
  let landT = 0;                   // >0 while the touchdown recoil dip plays
  const LAND_DUR = 0.26;

  const B = (name) => (vrm ? vrm.humanoid.getNormalizedBoneNode(name) : null);

  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  loader.load(
    url,
    (gltf) => {
      vrm = gltf.userData.vrm;
      // Normalise VRM0 orientation (rotate 180° so it faces -Z like VRM1); no-op
      // for VRM1. Then inner.rotation.y = PI turns it to face +Z (forward).
      VRMUtils.rotateVRM0(vrm);
      // Perf: drop hidden verts + merge skeletons where possible (best-effort).
      try { VRMUtils.removeUnnecessaryVertices(gltf.scene); } catch (e) {}
      try { VRMUtils.combineSkeletons(gltf.scene); } catch (e) {}

      const model = vrm.scene;
      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.frustumCulled = false; // skinned bounds can be wrong; avoid pop-out
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (m && m.color) { m.userData._baseColor = m.color.clone(); tintMats.push(m); }
          }
        }
      });

      // Scale so the avatar is ~targetHeight tall and the feet sit on y = 0.
      let bb = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      bb.getSize(size);
      model.scale.setScalar(targetHeight / Math.max(size.y, 0.001));
      bb = new THREE.Box3().setFromObject(model);
      model.position.y -= bb.min.y;

      inner.add(model);

      // Cache the humanoid bones we animate.
      for (const n of [
        'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
        'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
        'leftFoot', 'rightFoot',
        'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm',
      ]) bones[n] = B(n);
      if (bones.hips) hipsRestY = bones.hips.position.y;

      // Every normalized humanoid bone gets blended, so a clip that moves the
      // fingers or toes fades out as cleanly as one that only moves the legs.
      for (const key of Object.keys(vrm.humanoid.normalizedHumanBones)) {
        const node = vrm.humanoid.getNormalizedBoneNode(key);
        if (node) { blendNodes.push(node); snapQ.push(new THREE.Quaternion()); }
      }
      // The mixer binds by node name, and the normalized rig lives under
      // vrm.scene, so this root resolves every retargeted track.
      mixer.m = new THREE.AnimationMixer(vrm.scene);
      for (const [name, cfg] of Object.entries(ACTION_FILES)) {
        loadMixamoClip(`${BASE}anim/${cfg.file}`, vrm, {
          name, rootMotion: cfg.rootMotion, restHipsY: hipsRestY,
        })
          .then((clip) => { mixer.clips.set(name, clip); })
          .catch((e) => console.error('Mixamo retarget failed for', cfg.file, e));
      }

      // How far the foot BONE sits above the sole, in the rest pose. Measured
      // once, before any gait has run, so groundFeet() has a real reference
      // rather than an assumed leg length.
      group.updateMatrixWorld(true);
      const restFoot = footWorldY();
      if (restFoot !== null) soleK = restFoot - group.position.y;
    },
    undefined,
    (err) => console.error('Failed to load VRM character:', err)
  );

  // Procedural jab (works with no punch clip). Gated by a short cooldown.
  function punch() {
    if (punchT >= 0 || punchCd > 0) return false;
    punchT = 0; punchCd = 0.5;
    return true;
  }

  function update(dt, speed = 0, opts = null) {
    elapsed += dt;
    if (punchCd > 0) punchCd -= dt;

    // ---- Stance state, resolved before the gait so it can shorten the stride.
    const crouch = opts && opts.crouch ? opts.crouch : 0;
    const airborne = !!(opts && opts.airborne);
    const vy = opts && opts.vy ? opts.vy : 0;

    // Landing recoil: the frame the feet touch down, play a short knee dip.
    if (wasAir && !airborne) landT = 1e-4;
    wasAir = airborne;
    if (landT > 0) {
      landT += dt;
      if (landT >= LAND_DUR) landT = 0;
    }
    const landDip = landT > 0 ? Math.sin((landT / LAND_DUR) * Math.PI) * 0.5 : 0;
    const squat = Math.min(1, crouch + landDip); // total "how low" the knees go
    airW += ((airborne ? 1 : 0) - airW) * Math.min(1, dt * 16);

    if (!vrm) return;

    // Ease the input speed so the gait fades in/out instead of snapping.
    smoothSpeed += (speed - smoothSpeed) * Math.min(1, dt * 10);
    const sp = smoothSpeed;

    // Base idle/walk/run pose — the SAME shared gait every crowd VRM uses.
    phase += dt * strideRate(sp);
    poseLocomotion(bones, hipsRestY, { speed: sp, phase, elapsed, crouch });

    const set = (bone, x, y, z) => { if (bone) bone.rotation.set(x, y, z); };
    const addX = (bone, x) => { if (bone) bone.rotation.x += x; };
    const addZ = (bone, z) => { if (bone) bone.rotation.z += z; };
    const mixX = (bone, x, w) => { if (bone) bone.rotation.x += (x - bone.rotation.x) * w; };
    const mixZ = (bone, z, w) => { if (bone) bone.rotation.z += (z - bone.rotation.z) * w; };

    // ---- Crouch layer (Ctrl / C) + landing recoil ---------------------------
    // Purely ADDITIVE on top of the gait above, so the stride survives the squat.
    // The pelvis has to sink by roughly what the bent knees shorten the legs by,
    // otherwise the feet would lift off the pavement: with the thigh swung
    // forward ~1.05 rad and the shin folded back ~1.65 rad the leg chain loses
    // about a third of its height, hence the 0.34 factor on the rest hip height.
    if (squat > 0.001) {
      // Signs and the hip drop are MEASURED off the rig, not guessed: on these
      // VRMs a positive lowerLeg rotation folds the heel UP toward the buttock
      // (which is right for a walk cycle's trailing leg, and wrong for a squat).
      // Bending the shin the other way, with a 0.26 hip drop, keeps the soles on
      // the pavement to within 0.005 units at full crouch.
      const thigh = 1.05 * squat;
      const shin = -1.65 * squat;
      addX(bones.leftUpperLeg, thigh);
      addX(bones.rightUpperLeg, thigh);
      addX(bones.leftLowerLeg, shin);
      addX(bones.rightLowerLeg, shin);
      addX(bones.leftFoot, 0.62 * squat);    // ankles keep the soles flat
      addX(bones.rightFoot, 0.62 * squat);
      if (bones.hips) {
        bones.hips.position.y -= hipsRestY * 0.26 * squat;
        bones.hips.rotation.x += 0.18 * squat;
      }
      addX(bones.spine, 0.22 * squat);       // fold forward over the knees
      addX(bones.chest, 0.10 * squat);
      addX(bones.head, -0.24 * squat);       // …but keep the eyes on the horizon
      addZ(bones.leftUpperArm, 0.30 * squat); // elbows tuck in to the ribs
      addZ(bones.rightUpperArm, -0.30 * squat);
      addZ(bones.leftLowerArm, -0.38 * squat);
      addZ(bones.rightLowerArm, 0.38 * squat);
    }

    // ---- Jump layer ---------------------------------------------------------
    // Blended (not added) so the walk cycle stops driving the legs mid-air. The
    // pose reads off the *sign* of the vertical velocity: knees tucked and arms
    // thrown up on the way up, legs reaching and arms out on the way down.
    if (airW > 0.001) {
      const rise = Math.max(-1, Math.min(1, vy / 14)); // +1 launching … -1 falling
      const tuck = 0.5 + 0.5 * rise;
      mixX(bones.leftUpperLeg, 0.15 + 0.85 * tuck, airW);   // lead knee up
      mixX(bones.leftLowerLeg, 0.20 + 1.15 * tuck, airW);
      mixX(bones.rightUpperLeg, -0.45 + 0.30 * tuck, airW); // trailing leg reaches back
      mixX(bones.rightLowerLeg, 0.55 + 0.30 * tuck, airW);
      mixX(bones.leftFoot, 0.25 * tuck, airW);
      mixX(bones.rightFoot, -0.30, airW);                   // toes point on the trail leg
      mixX(bones.leftUpperArm, -0.55 * rise - 0.15, airW);
      mixX(bones.rightUpperArm, -0.55 * rise - 0.15, airW);
      mixZ(bones.leftUpperArm, -(REST - 0.55 - 0.30 * rise), airW); // arms lift + open out
      mixZ(bones.rightUpperArm, REST - 0.55 - 0.30 * rise, airW);
      mixZ(bones.leftLowerArm, -0.45, airW);
      mixZ(bones.rightLowerArm, 0.45, airW);
      mixX(bones.spine, 0.14 * (1 - rise), airW);           // curl forward as you fall
      if (bones.hips) bones.hips.rotation.x += (-0.10 * rise - bones.hips.rotation.x) * airW;
    }

    // ---- Cutscene layer (opening scene only) --------------------------------
    // `lie` flattens the body out for the hospital bed — limbs straight, arms
    // tucked in at the sides. `sit` folds the hips and knees to perch on the
    // edge of the bed. Both blend over the gait so the hand-off into normal
    // gameplay is seamless.
    if (cutLie > 0.001) {
      const w = cutLie;
      mixX(bones.leftUpperLeg, 0.04, w);
      mixX(bones.rightUpperLeg, -0.04, w);
      mixX(bones.leftLowerLeg, 0.06, w);
      mixX(bones.rightLowerLeg, 0.06, w);
      mixX(bones.leftFoot, 0.5, w);        // toes relaxed, pointing up off the bed
      mixX(bones.rightFoot, 0.5, w);
      mixZ(bones.leftUpperArm, -1.42, w);  // arms flat against the sides
      mixZ(bones.rightUpperArm, 1.42, w);
      mixX(bones.leftUpperArm, 0.06, w);
      mixX(bones.rightUpperArm, 0.06, w);
      mixZ(bones.leftLowerArm, -0.06, w);
      mixZ(bones.rightLowerArm, 0.06, w);
      mixX(bones.spine, 0, w);
      mixX(bones.chest, 0, w);
      mixX(bones.head, 0.18, w);           // chin tipped toward the chest
    }
    // Sitting up IN BED: the torso folds at the waist while the legs stay lying
    // flat. This is a bone-level fold, not a rotation of the whole body — which
    // is what stops it reading as the figure pivoting stiffly about its feet.
    if (cutSitUp > 0.001) {
      const w = cutSitUp;
      mixX(bones.spine, 1.02, w);
      mixX(bones.chest, 0.44, w);
      mixX(bones.head, -0.34, w);          // look down the bed, not at the ceiling
      mixZ(bones.leftUpperArm, -1.15, w);  // hands come in to push up off the mattress
      mixZ(bones.rightUpperArm, 1.15, w);
      mixX(bones.leftUpperArm, -0.45, w);
      mixX(bones.rightUpperArm, -0.45, w);
      mixZ(bones.leftLowerArm, -0.55, w);
      mixZ(bones.rightLowerArm, 0.55, w);
    }
    if (cutSit > 0.001) {
      const w = cutSit;
      // Thigh forward to horizontal, shin hanging DOWN from the knee (negative —
      // see the crouch note above). Measured: this puts the feet 1.13 units
      // below the hips, i.e. a real sitting posture rather than a tucked ball.
      mixX(bones.leftUpperLeg, 1.5, w);
      mixX(bones.rightUpperLeg, 1.5, w);
      mixX(bones.leftLowerLeg, -1.35, w);
      mixX(bones.rightLowerLeg, -1.35, w);
      mixX(bones.leftFoot, -0.2, w);
      mixX(bones.rightFoot, -0.2, w);
      mixX(bones.spine, 0.12, w);
      mixZ(bones.leftUpperArm, -1.28, w);
      mixZ(bones.rightUpperArm, 1.28, w);
      mixX(bones.leftUpperArm, 0.3, w);    // hands resting on the mattress
      mixX(bones.rightUpperArm, 0.3, w);
      if (bones.hips) bones.hips.rotation.x += (0.1 - bones.hips.rotation.x) * w;
    }

    // Punch: a quick right-arm thrust forward + a torso twist into the jab. This
    // runs last so it overrides the walk pose on the punching arm.
    if (punchT >= 0) {
      punchT += dt;
      const DUR = 0.34;
      if (punchT >= DUR) { punchT = -1; }
      else {
        const j = Math.sin((punchT / DUR) * Math.PI); // 0 → 1 → 0
        set(bones.rightUpperArm, -1.5 * j, 0, REST * (1 - 0.7 * j));
        set(bones.rightLowerArm, 0, 0, 0.12 + 0.3 * j);
        if (bones.spine) bones.spine.rotation.y = -0.28 * j;
      }
    }

    // ---- Mixamo action layer ------------------------------------------------
    // Snapshot the procedural pose, let the mixer overwrite the bones, then pull
    // each bone back toward the snapshot by (1 - weight). At weight 1 the clip
    // plays untouched; as it fades the body eases back into the live gait, so
    // the hand-off to idle/walk is seamless in both directions.
    if (mixer.action && mixer.m) {
      mixer.t += dt;
      const inW = mixer.fadeIn > 0 ? Math.min(1, mixer.t / mixer.fadeIn) : 1;
      const left = mixer.dur - mixer.t;
      const outW = mixer.fadeOut > 0 ? Math.min(1, Math.max(0, left / mixer.fadeOut)) : 1;
      mixer.weight = Math.min(inW, outW);

      for (let i = 0; i < blendNodes.length; i++) snapQ[i].copy(blendNodes[i].quaternion);
      if (bones.hips) snapHips.copy(bones.hips.position);

      mixer.m.update(dt);

      const back = 1 - mixer.weight;
      if (back > 0.0001) {
        for (let i = 0; i < blendNodes.length; i++) blendNodes[i].quaternion.slerp(snapQ[i], back);
        if (bones.hips) bones.hips.position.lerp(snapHips, back);
      }

      if (mixer.t >= mixer.dur) {
        mixer.action.stop();
        mixer.action = null;
        mixer.weight = 0;
      }
    }

    // Advance humanoid → raw rig, expressions, look-at AND spring bones (hair /
    // skirt sway) for this frame.
    vrm.update(dt);
  }

  function setHeight(h) { group.scale.setScalar(h); }

  // Multiply each material's base colour by the picked tint (white = unchanged).
  function setTint(hex) {
    const c = new THREE.Color(hex);
    for (const m of tintMats) m.color.copy(m.userData._baseColor).multiply(c);
  }

  function setFacingOffset(rad) { inner.rotation.y = rad; }

  // Opening cutscene: `lie` 0→1 flattens onto the bed, `sit` 0→1 perches on the
  // edge. The scene drives both, and the character module knows nothing about
  // the timeline.
  function setCutscene(lie = 0, sit = 0, sitUp = 0) { cutLie = lie; cutSit = sit; cutSitUp = sitUp; }

  /**
   * Play one of the retargeted Mixamo one-shots ('enter-car' | 'exit-car' |
   * 'hit-by-car'). Returns its duration in seconds, or 0 if it isn't available
   * yet — callers use that to time whatever they're gating on, and a 0 means
   * "carry on immediately" rather than "hang forever".
   */
  function playAction(name, { fadeIn = 0.18, fadeOut = 0.3, speed = 1 } = {}) {
    if (!mixer.m) return 0;
    const clip = mixer.clips.get(name);
    if (!clip) return 0;
    if (mixer.action) mixer.action.stop();
    const action = mixer.m.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.timeScale = speed;
    action.play();
    mixer.action = action;
    mixer.dur = clip.duration / speed;
    mixer.t = 0;
    mixer.weight = 0;
    mixer.fadeIn = fadeIn;
    mixer.fadeOut = fadeOut;
    return mixer.dur;
  }

  function stopAction() {
    if (mixer.action) { mixer.action.stop(); mixer.action = null; }
    mixer.weight = 0;
  }

  const actionReady = (name) => mixer.clips.has(name);

  /**
   * Plant the soles on `floorY`, whatever the current pose is doing. Reads the
   * real world position of the lower foot bone, so it works for a keyframed clip
   * exactly as well as for the procedural gait. The correction is clamped so a
   * pose that lifts BOTH feet (mid-stride, or seated) can't yank the body
   * underground.
   */
  // The clamp needs headroom: the exit clip lifts both feet ~0.89 units at one
  // point, and a limit any tighter would start letting the soles float.
  function groundFeet(floorY = 0, maxCorrection = 1.5) {
    if (!vrm || soleK === null) return;
    group.updateMatrixWorld(true);
    const fy = footWorldY();
    if (fy === null) return;
    let d = (floorY + soleK) - fy;
    if (d > maxCorrection) d = maxCorrection;
    else if (d < -maxCorrection) d = -maxCorrection;
    group.position.y += d;
    group.updateMatrixWorld(true);
  }

  // World Y of the lower foot. The RAW bones are the ones the visible mesh
  // follows, so this is where the feet actually ARE — which is what the opening
  // scene uses to plant them on the floor instead of guessing an offset.
  // Callers must have updated world matrices first.
  const _fw = new THREE.Vector3();
  function footWorldY() {
    if (!vrm) return null;
    let y = Infinity;
    for (const n of ['leftFoot', 'rightFoot']) {
      const b = vrm.humanoid.getRawBoneNode(n);
      if (!b) continue;
      b.getWorldPosition(_fw);
      if (_fw.y < y) y = _fw.y;
    }
    return Number.isFinite(y) ? y : null;
  }

  return {
    group, update, setHeight, setTint, setFacingOffset, punch, setCutscene, footWorldY,
    playAction, stopAction, actionReady, groundFeet,
    get actionPlaying() { return !!mixer.action; },
  };
}
