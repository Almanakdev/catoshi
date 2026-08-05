import * as THREE from 'three';

// A customizable, smooth low-poly human — built from capsules and spheres with
// smooth shading (no flat faces), so limbs are rounded and it reads as a person
// rather than a stack of boxes. Inspired by the "Summer Afternoon" look.
// No external model required. Limbs sit on pivot groups for the walk cycle.

const DEFAULTS = {
  skin: '#e8b98a',
  hair: '#3a2416',
  shirt: '#3f8ad0',
  pants: '#33475b',
  shoes: '#20242a',
  height: 1,
};

// Rounded, slightly soft material. flatShading OFF = smooth curved surfaces.
const softMat = (c) =>
  new THREE.MeshStandardMaterial({
    color: new THREE.Color(c),
    roughness: 0.9,
    metalness: 0,
    flatShading: false,
  });

export function createCharacter(config = {}) {
  const o = { ...DEFAULTS, ...config };

  const group = new THREE.Group(); // world transform; feet at y = 0
  const body = new THREE.Group();  // gets the bob/breathing offset
  group.add(body);

  const mats = {
    skin: softMat(o.skin),
    hair: softMat(o.hair),
    shirt: softMat(o.shirt),
    pants: softMat(o.pants),
    shoes: softMat(o.shoes),
  };
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.5 });

  // Moderate segment counts: smooth but still lightly faceted (low-poly feel).
  const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 5, 12);
  const sphere = (r) => new THREE.SphereGeometry(r, 14, 12);

  const mesh = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  // --- Proportions (world units), feet at y = 0 ---
  const legR = 0.22, legLen = 1.0;                 // capsule half-height = 0.72
  const legHalf = legLen / 2 + legR;
  const hipY = legHalf;                            // 0.72

  const armR = 0.15, armLen = 0.95;
  const armHalf = armLen / 2 + armR;               // 0.625

  const shoulderY = hipY + 1.5;
  const shoulderX = 0.46;
  const headY = hipY + 2.12;
  const headR = 0.4;

  // --- Legs (hip pivots) ---
  const legL = new THREE.Group();
  const legR2 = new THREE.Group();
  legL.position.set(-0.24, hipY, 0);
  legR2.position.set(0.24, hipY, 0);
  for (const g of [legL, legR2]) {
    const leg = mesh(capsule(legR, legLen), mats.pants);
    leg.position.y = -legHalf + 0.02;
    g.add(leg);
    // knee hint
    const knee = mesh(sphere(legR * 0.95), mats.pants);
    knee.position.y = -legHalf * 0.55;
    g.add(knee);
    // rounded shoe
    const shoe = mesh(sphere(legR + 0.04), mats.shoes);
    shoe.scale.set(1.05, 0.7, 1.7);
    shoe.position.set(0, -legHalf - legR * 0.2, 0.16);
    g.add(shoe);
    body.add(g);
  }

  // --- Pelvis + torso (torso is a capsule squashed front-to-back) ---
  const pelvis = mesh(sphere(0.42), mats.pants);
  pelvis.scale.set(1.15, 0.7, 0.85);
  pelvis.position.y = hipY + 0.12;
  body.add(pelvis);

  const torso = mesh(capsule(0.4, 0.95), mats.shirt);
  torso.scale.set(1.18, 1.0, 0.72);
  torso.position.y = hipY + 0.92;
  body.add(torso);

  // shoulders (round off the tops)
  for (const sx of [-shoulderX, shoulderX]) {
    const sh = mesh(sphere(0.2), mats.shirt);
    sh.position.set(sx, shoulderY, 0);
    body.add(sh);
  }

  // --- Arms (shoulder pivots) ---
  const armL = new THREE.Group();
  const armR3 = new THREE.Group();
  armL.position.set(-shoulderX, shoulderY, 0);
  armR3.position.set(shoulderX, shoulderY, 0);
  for (const g of [armL, armR3]) {
    const upper = mesh(capsule(armR, armLen), mats.shirt);
    upper.position.y = -armHalf + 0.05;
    g.add(upper);
    const forearm = mesh(capsule(armR * 0.9, armLen * 0.5), mats.skin);
    forearm.position.y = -armHalf - armLen * 0.28;
    g.add(forearm);
    const hand = mesh(sphere(armR * 1.15), mats.skin);
    hand.position.y = -armHalf - armLen * 0.6;
    g.add(hand);
    body.add(g);
  }

  // --- Neck, head, hair, eyes ---
  const neck = mesh(capsule(0.15, 0.16), mats.skin);
  neck.position.y = shoulderY + 0.28;
  body.add(neck);

  const head = mesh(sphere(headR), mats.skin);
  head.scale.set(1, 1.12, 1);
  head.position.y = headY;
  body.add(head);

  // hair as a smooth cap over the top/back of the head
  const hair = mesh(new THREE.SphereGeometry(headR * 1.06, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), mats.hair);
  hair.scale.set(1, 1.15, 1);
  hair.position.y = headY + 0.02;
  hair.rotation.x = -0.18;
  body.add(hair);

  // eyes on the +Z face
  for (const ex of [-0.15, 0.15]) {
    const eye = mesh(sphere(0.05), eyeMat);
    eye.position.set(ex, headY + 0.03, headR * 0.92);
    body.add(eye);
  }

  group.scale.setScalar(o.height);

  // --- Animation ---
  let walkPhase = 0;
  let idleTime = 0;
  function update(dt, speed) {
    idleTime += dt;
    if (speed > 0.1) {
      walkPhase += dt * (4 + speed * 0.4);
      const amp = Math.min(1.0, 0.35 + speed * 0.02);
      const s = Math.sin(walkPhase) * amp;
      legL.rotation.x = s;
      legR2.rotation.x = -s;
      armL.rotation.x = -s * 0.7;
      armR3.rotation.x = s * 0.7;
      body.position.y = Math.abs(Math.sin(walkPhase)) * 0.08;
    } else {
      legL.rotation.x *= 0.8;
      legR2.rotation.x *= 0.8;
      armL.rotation.x *= 0.8;
      armR3.rotation.x *= 0.8;
      // subtle idle arm sway + breathing
      armL.rotation.x = Math.sin(idleTime * 1.2) * 0.04;
      armR3.rotation.x = -Math.sin(idleTime * 1.2) * 0.04;
      body.position.y = Math.sin(idleTime * 1.5) * 0.03;
    }
  }

  function setColor(part, hex) {
    if (mats[part]) mats[part].color.set(hex);
  }
  function setHeight(h) {
    group.scale.setScalar(h);
  }

  return { group, update, setColor, setHeight, materials: mats };
}
