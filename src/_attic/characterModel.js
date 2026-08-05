import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeToonGradient } from './textures.js';

// Shared cel-shading ramp so the character bands its light like the city does.
const CHAR_GRADIENT = makeToonGradient(4);

// Loads a real rigged human (.glb) and drives its Idle / Walk / Run animation
// clips from the current movement speed. Exposes the SAME interface the
// third-person controller expects: { group, update(dt, speed), setHeight, setTint }.
//
// The model loads asynchronously: `group` exists immediately (empty) and the
// rigged mesh is added to it once the file finishes loading, so the rest of the
// app can wire everything up without waiting.

export function createCharacterModel(config = {}) {
  const { url = `${import.meta.env.BASE_URL}models/Soldier.glb`, targetHeight = 4, height = 1 } = config;

  const group = new THREE.Group();
  const inner = new THREE.Group(); // holds the loaded model, lets us re-orient it
  group.add(inner);
  group.scale.setScalar(height);

  // Procedural punch: a fist thrusts forward and the body leans into a quick jab.
  // Works with no rigged "punch" clip; gated by a short cooldown so it can't spam.
  const fist = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 10, 8),
    new THREE.MeshToonMaterial({ color: 0xe8b48c, gradientMap: CHAR_GRADIENT })
  );
  fist.castShadow = true;
  fist.visible = false;
  group.add(fist);
  let punchT = -1;        // >= 0 while a punch is playing
  let punchCd = 0;        // cooldown
  function punch() {
    if (punchT >= 0 || punchCd > 0) return false;
    punchT = 0; punchCd = 0.5;
    return true;
  }

  let mixer = null;
  const actions = {}; // name -> AnimationAction
  let current = null;
  const materials = [];

  const loader = new GLTFLoader();
  loader.load(
    url,
    (gltf) => {
      const model = gltf.scene;

      model.traverse((obj) => {
        if (obj.isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
          obj.frustumCulled = false; // skinned bounds can be wrong; avoid pop-out

          // Re-skin the model in the city's cartoon toon style, keeping its
          // color texture. Skinning stays intact — the renderer applies it
          // automatically for SkinnedMeshes regardless of material type.
          const src = obj.material;
          const toon = new THREE.MeshToonMaterial({
            map: src && src.map ? src.map : null,
            color: src && src.color ? src.color.clone() : new THREE.Color(0xffffff),
            gradientMap: CHAR_GRADIENT,
          });
          toon.skinning = true; // harmless on newer three; explicit for clarity
          obj.material = toon;
          materials.push(toon);
        }
      });

      // Scale the model so its real-world height matches our world (~4 units),
      // then drop it so the feet sit on y = 0.
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);
      const s = targetHeight / size.y;
      model.scale.setScalar(s);

      const box2 = new THREE.Box3().setFromObject(model);
      model.position.y -= box2.min.y;

      inner.add(model);

      // Animations: this model ships with "Idle", "Walk", "Run".
      mixer = new THREE.AnimationMixer(model);
      for (const clip of gltf.animations) {
        actions[clip.name] = mixer.clipAction(clip);
      }
      // Start in idle.
      current = actions['Idle'] || Object.values(actions)[0] || null;
      if (current) current.play();
    },
    undefined,
    (err) => {
      console.error('Failed to load character model:', err);
    }
  );

  // Crossfade to a named action.
  function fadeTo(name, duration = 0.25) {
    const next = actions[name];
    if (!next || next === current) return;
    next.reset().play();
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (current) current.crossFadeTo(next, duration, false);
    current = next;
  }

  function update(dt, speed) {
    // Punch first (independent of the rigged clips, so it works pre-load too).
    if (punchCd > 0) punchCd -= dt;
    if (punchT >= 0) {
      punchT += dt;
      const DUR = 0.34;
      if (punchT >= DUR) { punchT = -1; fist.visible = false; inner.rotation.x = 0; }
      else {
        const j = Math.sin((punchT / DUR) * Math.PI); // 0 → 1 → 0
        inner.rotation.x = j * 0.3;                     // lean into the jab
        fist.visible = true;
        fist.position.set(0.32, 2.35, 0.5 + j * 1.3);   // thrust forward (+Z = facing)
      }
    }
    if (mixer) mixer.update(dt);
    if (!Object.keys(actions).length) return;
    // Pick a clip from speed. (Walk speed is 9, run is 18 in the controller.)
    if (speed < 0.1) fadeTo('Idle');
    else if (speed < 13) fadeTo('Walk');
    else fadeTo('Run');
  }

  function setHeight(h) {
    group.scale.setScalar(h);
  }
  // Light tint of the outfit (default white = no change).
  function setTint(hex) {
    const c = new THREE.Color(hex);
    for (const m of materials) if (m.color) m.color.copy(c);
  }
  // Optional: face-direction fix if a model's forward axis differs.
  function setFacingOffset(rad) {
    inner.rotation.y = rad;
  }

  return { group, update, setHeight, setTint, setFacingOffset, punch };
}
