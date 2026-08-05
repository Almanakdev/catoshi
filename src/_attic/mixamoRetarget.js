import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// Retargets a Mixamo FBX animation onto a VRM's humanoid rig, following the same
// approach as @pixiv/three-vrm's Mixamo example.
//
// Why a conversion is needed at all: a Mixamo clip animates bones called
// `mixamorigHips`, `mixamorigSpine`… whose rest pose is whatever Mixamo's
// skeleton happens to be. A VRM's NORMALIZED humanoid rig has a different node
// naming AND a rest pose that is identity by definition. So each rotation has to
// be moved out of Mixamo's rest frame and into the normalized bone's frame:
//
//     q' = parentRestWorldRotation · q · restWorldRotation⁻¹
//
// and the hips translation has to be rescaled from Mixamo's centimetre-ish rig
// to the VRM's own hip height.
//
// The output clip targets the normalized bone NODES by name, so an
// AnimationMixer built on `vrm.scene` binds it, and `vrm.humanoid.update()`
// (which `vrm.update()` calls) copies the result through to the raw skeleton.

// Mixamo bone name → VRM humanoid bone name. Fingers included: the clips carry
// hand tracks and dropping them leaves the fingers frozen mid-animation.
export const MIXAMO_TO_VRM = {
  mixamorigHips: 'hips',
  mixamorigSpine: 'spine',
  mixamorigSpine1: 'chest',
  mixamorigSpine2: 'upperChest',
  mixamorigNeck: 'neck',
  mixamorigHead: 'head',

  mixamorigLeftShoulder: 'leftShoulder',
  mixamorigLeftArm: 'leftUpperArm',
  mixamorigLeftForeArm: 'leftLowerArm',
  mixamorigLeftHand: 'leftHand',
  mixamorigLeftHandThumb1: 'leftThumbMetacarpal',
  mixamorigLeftHandThumb2: 'leftThumbProximal',
  mixamorigLeftHandThumb3: 'leftThumbDistal',
  mixamorigLeftHandIndex1: 'leftIndexProximal',
  mixamorigLeftHandIndex2: 'leftIndexIntermediate',
  mixamorigLeftHandIndex3: 'leftIndexDistal',
  mixamorigLeftHandMiddle1: 'leftMiddleProximal',
  mixamorigLeftHandMiddle2: 'leftMiddleIntermediate',
  mixamorigLeftHandMiddle3: 'leftMiddleDistal',
  mixamorigLeftHandRing1: 'leftRingProximal',
  mixamorigLeftHandRing2: 'leftRingIntermediate',
  mixamorigLeftHandRing3: 'leftRingDistal',
  mixamorigLeftHandPinky1: 'leftLittleProximal',
  mixamorigLeftHandPinky2: 'leftLittleIntermediate',
  mixamorigLeftHandPinky3: 'leftLittleDistal',

  mixamorigRightShoulder: 'rightShoulder',
  mixamorigRightArm: 'rightUpperArm',
  mixamorigRightForeArm: 'rightLowerArm',
  mixamorigRightHand: 'rightHand',
  mixamorigRightHandThumb1: 'rightThumbMetacarpal',
  mixamorigRightHandThumb2: 'rightThumbProximal',
  mixamorigRightHandThumb3: 'rightThumbDistal',
  mixamorigRightHandIndex1: 'rightIndexProximal',
  mixamorigRightHandIndex2: 'rightIndexIntermediate',
  mixamorigRightHandIndex3: 'rightIndexDistal',
  mixamorigRightHandMiddle1: 'rightMiddleProximal',
  mixamorigRightHandMiddle2: 'rightMiddleIntermediate',
  mixamorigRightHandMiddle3: 'rightMiddleDistal',
  mixamorigRightHandRing1: 'rightRingProximal',
  mixamorigRightHandRing2: 'rightRingIntermediate',
  mixamorigRightHandRing3: 'rightRingDistal',
  mixamorigRightHandPinky1: 'rightLittleProximal',
  mixamorigRightHandPinky2: 'rightLittleIntermediate',
  mixamorigRightHandPinky3: 'rightLittleDistal',

  mixamorigLeftUpLeg: 'leftUpperLeg',
  mixamorigLeftLeg: 'leftLowerLeg',
  mixamorigLeftFoot: 'leftFoot',
  mixamorigLeftToeBase: 'leftToes',
  mixamorigRightUpLeg: 'rightUpperLeg',
  mixamorigRightLeg: 'rightLowerLeg',
  mixamorigRightFoot: 'rightFoot',
  mixamorigRightToeBase: 'rightToes',
};

const _loader = new FBXLoader();

/**
 * Load a Mixamo FBX and return an AnimationClip that plays on `vrm`.
 *
 * @param url        path to the .fbx
 * @param vrm        the target VRM (needs .humanoid and .scene)
 * @param name       clip name
 * @param rootMotion what to do with the hips translation track:
 *   'vertical' keeps the up/down component and drops the horizontal — the
 *      character performs on the spot but can still drop to the floor. These
 *      clips travel 1.7–1.9 m horizontally, which would slide the body several
 *      units from where the game thinks the player is.
 *   'full'     keeps the translation as authored.
 *   'none'     pins the hips at their rest height: a purely rotational
 *      performance that cannot float, rise or sink at all.
 * @param restHipsY the normalized hips node's LOCAL rest height. MUST be passed
 *      by the caller — see the note on hipsPositionScale below.
 */
export async function loadMixamoClip(url, vrm, { name = 'mixamo', rootMotion = 'vertical', restHipsY = null } = {}) {
  const asset = await _loader.loadAsync(url);
  const clip = THREE.AnimationClip.findByName(asset.animations, 'mixamo.com') || asset.animations[0];
  if (!clip) throw new Error(`no animation in ${url}`);

  const tracks = [];
  const restRotationInverse = new THREE.Quaternion();
  const parentRestWorldRotation = new THREE.Quaternion();
  const _q = new THREE.Quaternion();
  const _v = new THREE.Vector3();

  // Scale Mixamo's translation into the normalized rig's units.
  //
  // This has to be the hips' LOCAL rest height, not a world measurement. The
  // animation writes `position` on the normalized bone, whose parent chain is
  // scaled by the model's fit factor (the VRM is resized to 4 units tall) — so a
  // world-space hip height is that factor too large. Measured on piff1.vrm the
  // local rest height is 0.989 while the world height is 2.243: a 2.27x
  // over-scale, which lifted the hips to nearly 5 units and left the character
  // floating three units above the pavement.
  const mixamoHips = asset.getObjectByName('mixamorigHips');
  const motionHipsHeight = mixamoHips ? mixamoHips.position.y : 100;
  const hipsNode = vrm.humanoid.getNormalizedBoneNode('hips');
  // Prefer the caller's cached rest value: by the time clips finish loading the
  // live node has already been moved by the procedural gait's vertical bob.
  const restLocalHipsY = restHipsY !== null ? restHipsY : (hipsNode ? hipsNode.position.y : 1);
  const hipsPositionScale = motionHipsHeight ? restLocalHipsY / motionHipsHeight : 1;

  // VRM 0.x faces -Z where 1.0 faces +Z, so 0.x needs its X and Z negated.
  const isVRM0 = vrm.meta?.metaVersion === '0';

  for (const track of clip.tracks) {
    const [mixamoRigName, propertyName] = track.name.split('.');
    const vrmBoneName = MIXAMO_TO_VRM[mixamoRigName];
    if (!vrmBoneName) continue;
    const vrmNode = vrm.humanoid.getNormalizedBoneNode(vrmBoneName);
    if (!vrmNode) continue;                 // this VRM doesn't have that bone
    const mixamoRigNode = asset.getObjectByName(mixamoRigName);
    if (!mixamoRigNode) continue;

    // Mixamo's rest pose for this bone, and its parent's, in world space.
    mixamoRigNode.getWorldQuaternion(restRotationInverse).invert();
    mixamoRigNode.parent.getWorldQuaternion(parentRestWorldRotation);

    if (track instanceof THREE.QuaternionKeyframeTrack) {
      const values = Float32Array.from(track.values);
      for (let i = 0; i < values.length; i += 4) {
        _q.fromArray(values, i);
        // Out of Mixamo's rest frame, into the normalized bone's frame.
        _q.premultiply(parentRestWorldRotation).multiply(restRotationInverse);
        _q.toArray(values, i);
        if (isVRM0) { values[i] = -values[i]; values[i + 2] = -values[i + 2]; }
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${vrmNode.name}.quaternion`, track.times, values));
    } else if (track instanceof THREE.VectorKeyframeTrack) {
      // Only the hips carry translation.
      const values = Float32Array.from(track.values);
      for (let i = 0; i < values.length; i += 3) {
        let x = values[i], y = values[i + 1], z = values[i + 2];
        if (isVRM0) { x = -x; z = -z; }
        x *= hipsPositionScale; y *= hipsPositionScale; z *= hipsPositionScale;
        if (rootMotion === 'vertical') { x = 0; z = 0; }
        else if (rootMotion === 'none') { x = 0; z = 0; y = restLocalHipsY; }
        values[i] = x; values[i + 1] = y; values[i + 2] = z;
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${vrmNode.name}.position`, track.times, values));
    }
  }

  if (!tracks.length) throw new Error(`retargeting produced no tracks for ${url}`);
  return new THREE.AnimationClip(name, clip.duration, tracks);
}
