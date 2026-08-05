import * as THREE from 'three';

// A tiny pooled "impact" effect — a bright cartoon starburst that pops at a hit
// point, expands and fades. Sprites (billboards), additive, unlit → cheap and
// always readable. createHitEffect() → { group, trigger(pos), update(dt) }.

function makeBurstTexture() {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.translate(S / 2, S / 2);
  // soft core
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, S * 0.34);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.5, 'rgba(255,226,140,0.8)');
  g.addColorStop(1, 'rgba(255,180,60,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, S * 0.34, 0, Math.PI * 2); ctx.fill();
  // radiating spikes
  ctx.fillStyle = 'rgba(255,238,170,0.95)';
  const spikes = 8;
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 2;
    ctx.save(); ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(S * 0.46, 0);
    ctx.lineTo(0, 6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createHitEffect() {
  const group = new THREE.Group();
  const tex = makeBurstTexture();
  const POOL = 5;
  const items = [];
  for (let i = 0; i < POOL; i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0,
    });
    const sp = new THREE.Sprite(mat);
    sp.visible = false;
    group.add(sp);
    items.push({ sp, mat, t: -1 });
  }
  let cursor = 0;

  function trigger(pos) {
    const it = items[cursor];
    cursor = (cursor + 1) % POOL;
    it.sp.position.copy(pos);
    it.t = 0;
    it.sp.visible = true;
  }

  const DUR = 0.34;
  function update(dt) {
    for (const it of items) {
      if (it.t < 0) continue;
      it.t += dt;
      const p = it.t / DUR;
      if (p >= 1) { it.t = -1; it.sp.visible = false; it.mat.opacity = 0; continue; }
      const s = 1.5 + p * 5.5;               // expand
      it.sp.scale.set(s, s, 1);
      it.mat.opacity = (1 - p) * (1 - p);    // ease-out fade
    }
  }

  return { group, trigger, update };
}
