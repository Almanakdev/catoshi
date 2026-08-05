import * as THREE from 'three';

// Floating GTA-style entrance markers: above every enterable door hovers a
// glowing, semi-transparent downward arrow (a 4-sided pyramid) that gently bobs
// and slowly spins, over a soft rising light beam. The marker the player is
// standing in pulses/enlarges to echo the "Press E to enter" prompt.
//
// Lightweight: just two InstancedMeshes (unlit emissive), driven by the same
// door list (POI) that feeds the enter flow — so markers only ever appear on
// buildings that actually have an interior.
//
// createEntranceMarkers(doors, opts) → { group, update(dt, activeDoor) }.

const TYPE_COLORS = {
  restaurant: 0xffb43a,
  minimarket: 0x46d0c0,
  cafe: 0xff7a4d,
};
const DEFAULT_COLOR = 0xffd23a; // classic marker gold

export function createEntranceMarkers(doors, { baseY = 3.6 } = {}) {
  const group = new THREE.Group();
  const n = doors.length;
  if (!n) return { group, update() {} };

  // Spinning downward arrow (4-sided pyramid, apex pointing down).
  const arrowGeo = new THREE.ConeGeometry(0.75, 1.0, 4);
  arrowGeo.rotateX(Math.PI);
  const arrowMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0.62, depthWrite: false,
    toneMapped: false, side: THREE.DoubleSide, // toneMapped:false → bloom haloes it
  });
  const arrows = new THREE.InstancedMesh(arrowGeo, arrowMat, n);
  arrows.castShadow = arrows.receiveShadow = false;
  arrows.frustumCulled = false;

  // Soft light beam rising from the ground (open, additive cylinder).
  const beamGeo = new THREE.CylinderGeometry(0.5, 0.5, 3.0, 12, 1, true);
  beamGeo.translate(0, 1.5, 0); // base sits on y = 0
  const beamMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0.11, depthWrite: false,
    toneMapped: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  const beams = new THREE.InstancedMesh(beamGeo, beamMat, n);
  beams.castShadow = beams.receiveShadow = false;
  beams.frustumCulled = false;

  const col = new THREE.Color();
  const dummy = new THREE.Object3D();
  const phase = new Float32Array(n); // per-marker offset so they aren't in lockstep
  for (let i = 0; i < n; i++) {
    col.set(TYPE_COLORS[doors[i].type] ?? DEFAULT_COLOR);
    arrows.setColorAt(i, col);
    beams.setColorAt(i, col);
    phase[i] = (i * 0.7) % (Math.PI * 2);
    // Beams are static — set their matrix once.
    dummy.position.set(doors[i].x, 0, doors[i].z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    beams.setMatrixAt(i, dummy.matrix);
  }
  arrows.instanceColor.needsUpdate = true;
  beams.instanceColor.needsUpdate = true;
  beams.instanceMatrix.needsUpdate = true;
  group.add(beams, arrows);

  let t = 0;
  function update(dt, activeDoor) {
    t += dt;
    for (let i = 0; i < n; i++) {
      const d = doors[i];
      const bob = Math.sin(t * 1.6 + phase[i]) * 0.3;
      const active = activeDoor === d;
      const sc = active ? 1.35 + Math.sin(t * 9) * 0.12 : 1.0; // pulse when in range
      dummy.position.set(d.x, baseY + bob, d.z);
      dummy.rotation.set(0, t * 1.1 + phase[i], 0); // slow spin
      dummy.scale.setScalar(sc);
      dummy.updateMatrix();
      arrows.setMatrixAt(i, dummy.matrix);
    }
    arrows.instanceMatrix.needsUpdate = true;
  }

  return { group, update };
}
