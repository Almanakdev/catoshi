// The city's one and only walk cycle.
//
// Every humanoid in the game — the player and every cloned VRM in the crowd —
// is posed by this function. None of the VRMs ship with animation clips, so the
// gait is written directly onto the NORMALIZED humanoid bones (rest pose =
// identity, so a rotation is absolute and model-independent). Callers own their
// own `phase` accumulator and layer extras (crouch, jump, punch) on top.

export const REST = 1.15; // shoulder-down angle so the arms hang by the sides

// Stride frequency for a given speed — shared so a crowd avatar and the player
// take steps at the same cadence when they're moving at the same speed.
export function strideRate(speed) {
  return 5 + speed * 0.6;
}

/**
 * Write the idle → walk → run pose onto a set of normalized humanoid bones.
 *
 * @param bones      map of VRM humanoid bone name → Object3D (missing = skipped)
 * @param hipsRestY  the hips node's rest height, for the vertical bob
 * @param o          { speed, phase, elapsed, crouch }
 * @returns          { s, loco, runW, idle } so callers can blend their own layers
 */
export function poseLocomotion(bones, hipsRestY, o) {
  const { speed, phase, elapsed, crouch = 0 } = o;

  // loco: 0 (idle) → 1 (walking). runW: 0 (walk) → 1 (run). The player's
  // controller uses walk = 9, run = 18; crowd avatars stroll well under that,
  // so they sit at loco 1 / runW 0 — a plain walk.
  const loco = Math.min(speed / 3, 1);
  const runW = Math.max(0, Math.min((speed - 9) / 9, 1));
  const idle = 1 - loco;
  const s = Math.sin(phase);

  // Amplitudes grow with speed and shrink in a crouch (a crouch-walk is a
  // short, low waddle rather than a full stride).
  const strideK = 1 - 0.45 * crouch;
  const legAmp = (0.45 + runW * 0.5) * loco * strideK;
  const armAmp = (0.4 + runW * 0.55) * loco * strideK;
  const kneeAmp = (0.8 + runW * 0.9) * loco * strideK;
  const bob = (0.03 + runW * 0.05) * loco * (1 - crouch);

  const set = (bone, x, y, z) => { if (bone) bone.rotation.set(x, y, z); };

  // Legs swing about X; the trailing leg's knee bends to clear the ground.
  set(bones.leftUpperLeg, s * legAmp, 0, 0);
  set(bones.rightUpperLeg, -s * legAmp, 0, 0);
  set(bones.leftLowerLeg, Math.max(0, -s) * kneeAmp, 0, 0);
  set(bones.rightLowerLeg, Math.max(0, s) * kneeAmp, 0, 0);
  // The ankles rest flat during the gait, but the caller's crouch/jump layers
  // are additive — so they must be zeroed here or the offsets would compound
  // frame after frame. (Normalized humanoid bones rest at identity.)
  set(bones.leftFoot, 0, 0, 0);
  set(bones.rightFoot, 0, 0, 0);

  // Arms hang down (Z) and swing opposite the legs (X). A gentle idle sway
  // keeps them alive when standing still.
  const armIdle = idle * Math.sin(elapsed * 1.2) * 0.05;
  set(bones.leftUpperArm, -s * armAmp + armIdle, 0, -REST);
  set(bones.rightUpperArm, s * armAmp - armIdle, 0, REST);
  // A little constant elbow bend, more at a run.
  set(bones.leftLowerArm, 0, 0, -0.12 - runW * 0.3 * loco);
  set(bones.rightLowerArm, 0, 0, 0.12 + runW * 0.3 * loco);

  // Body: a 2×-frequency vertical bob, subtle hip sway + forward lean, and a
  // slow breathing motion of the chest/spine while idle.
  const breath = Math.sin(elapsed * 1.5);
  if (bones.hips) {
    bones.hips.position.y = hipsRestY + Math.abs(s) * bob + idle * breath * 0.004;
    bones.hips.rotation.set(0, s * 0.06 * loco, 0);
  }
  set(bones.spine, 0.05 * loco + idle * breath * 0.012, -s * 0.05 * loco, 0);
  set(bones.chest, idle * (0.02 + breath * 0.03), 0, 0);
  set(bones.head, -0.02 * loco, 0, 0);

  return { s, loco, runW, idle };
}
