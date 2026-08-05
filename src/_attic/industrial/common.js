import * as THREE from 'three';

export { box, cyl, blob, paint, merge, C } from '../shops/common.js';

// Build an InstancedMesh from a prototype geometry + a list of placements.
// Each item: { x,y,z, rx,ry,rz, sx,sy,sz, c }  (c = optional per-instance color).
export function instanced(geo, mat, list) {
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  const d = new THREE.Object3D();
  const col = new THREE.Color();
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    d.position.set(t.x, t.y, t.z);
    d.rotation.set(t.rx || 0, t.ry || 0, t.rz || 0);
    d.scale.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
    d.updateMatrix();
    m.setMatrixAt(i, d.matrix);
    if (t.c !== undefined) m.setColorAt(i, col.set(t.c));
  }
  m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// A soft round puff texture (procedural, shared) for smoke / steam sprites — a
// white radial falloff so puffs read as fluffy cartoon clouds, not hard discs.
let _puffTex = null;
export function puffTexture() {
  if (_puffTex) return _puffTex;
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  _puffTex = new THREE.CanvasTexture(cv);
  return _puffTex;
}

// A looping, low-count column of soft sprite puffs rising from (x,y,z) — used
// for chimney smoke and cooling-tower steam. Each puff rises, drifts with the
// "wind", grows and fades on a staggered phase, then loops. Returns
// { group, update(dt, mul) } — `mul` (0..1) scales overall opacity so callers
// can dim it at night. Cheap: `count` sprites, no per-frame allocation.
export function makeSmoke({
  x = 0, y = 0, z = 0,
  count = 4, rise = 12, drift = 3, driftZ = 0,
  size = 2.4, grow = 4, color = '#e6e8ec', speed = 0.18, opacity = 0.5,
}) {
  const group = new THREE.Group();
  const tex = puffTexture();
  const puffs = [];
  for (let i = 0; i < count; i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: true,
    });
    const sp = new THREE.Sprite(mat);
    group.add(sp);
    puffs.push({ sp, mat, phase: i / count });
  }
  function update(dt, mul = 1) {
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i];
      p.phase += dt * speed;
      if (p.phase >= 1) p.phase -= 1;
      const t = p.phase;
      p.sp.position.set(x + drift * t, y + rise * t, z + driftZ * t);
      const sc = size + grow * t;
      p.sp.scale.set(sc, sc, 1);
      // Quick fade-in off the stack, long fade-out as it dissipates.
      p.mat.opacity = opacity * mul * Math.min(1, t * 6) * (1 - t);
    }
  }
  update(0);
  return { group, update };
}
