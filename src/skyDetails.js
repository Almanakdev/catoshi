import * as THREE from 'three';

// Lightweight "living sky": big soft cumulus cloud billboards drifting at layered
// depths, plus a few loose V-flocks of birds gliding across the sky. Everything
// is a sprite (billboard), so the whole thing is cheap. The group follows the
// camera horizontally so the sky always surrounds the player.
// createSkyDetails() → { group, update(dt, camera, night) }.

// A small deterministic RNG so the sky looks the same each load.
function rngFrom(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

// A soft, well-defined fluffy cumulus: overlapping white lobes (billowy top,
// flatter base) with a soft blue-grey underside shadow painted only on the body.
function makeCloudTexture(rng) {
  const W = 256, H = 168;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const lobe = (x, y, r, a, tint) => {
    const g = ctx.createRadialGradient(x, y, r * 0.15, x, y, r);
    g.addColorStop(0, `rgba(${tint},${a})`);
    g.addColorStop(1, `rgba(${tint},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  };
  const n = 8 + Math.floor(rng() * 5);
  const baseY = H * 0.66;
  const lobes = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const arch = Math.sin(t * Math.PI);                 // billowy in the middle
    const x = W * 0.14 + t * W * 0.72 + (rng() - 0.5) * 12;
    const r = 20 + arch * 34 + rng() * 14;
    const y = baseY - r * 0.4 - arch * (H * 0.16) - rng() * 8;
    lobes.push({ x, y, r });
  }
  for (const p of lobes) lobe(p.x, p.y, p.r, 0.9, '255,255,255');
  for (const p of lobes) lobe(p.x, p.y - p.r * 0.25, p.r * 0.68, 0.95, '255,255,255');
  // Soft blue-grey underside, only where cloud pixels already exist.
  ctx.globalCompositeOperation = 'source-atop';
  const sg = ctx.createLinearGradient(0, H * 0.4, 0, H);
  sg.addColorStop(0, 'rgba(150,170,198,0)');
  sg.addColorStop(1, 'rgba(120,145,182,0.55)');
  ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A tiny dark seagull "M" silhouette.
function makeBirdTexture() {
  const W = 64, H = 34;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.strokeStyle = 'rgba(44,50,62,0.92)';
  ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(5, 15);
  ctx.quadraticCurveTo(20, 25, 32, 15);
  ctx.quadraticCurveTo(44, 25, 59, 15);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createSkyDetails() {
  const group = new THREE.Group();

  // ---- Clouds: layered depths, drifting ----
  const cloudMats = [];
  for (let i = 0; i < 4; i++) {
    cloudMats.push(new THREE.SpriteMaterial({
      map: makeCloudTexture(rngFrom(1013 + i * 971)),
      transparent: true, depthWrite: false, opacity: 0.96, fog: false,
    }));
  }
  const clouds = [];
  const CLOUD_R = 2200;
  const layers = [
    { y: 230, size: 320, spd: 7, n: 8 },   // near, big, faster
    { y: 380, size: 240, spd: 4.5, n: 8 }, // mid
    { y: 560, size: 165, spd: 3, n: 9 },   // far, small, slow
  ];
  const crng = rngFrom(4242);
  for (const L of layers) {
    for (let i = 0; i < L.n; i++) {
      const sp = new THREE.Sprite(cloudMats[Math.floor(crng() * cloudMats.length)]);
      const s = L.size * (0.7 + crng() * 0.6);
      sp.scale.set(s, s * 0.6, 1);
      sp.position.set((crng() * 2 - 1) * CLOUD_R, L.y + (crng() - 0.5) * 40, (crng() * 2 - 1) * CLOUD_R);
      group.add(sp);
      clouds.push({ sp, spd: L.spd * (0.8 + crng() * 0.4) });
    }
  }

  // ---- Birds: a few loose V-flocks ----
  const birdMat = new THREE.SpriteMaterial({
    map: makeBirdTexture(), transparent: true, depthWrite: false, fog: false, opacity: 0.9,
  });
  const flocks = [];
  const brng = rngFrom(90210);
  for (let f = 0; f < 4; f++) {
    const count = 5 + Math.floor(brng() * 4);
    const size = 3.5 + brng() * 2.5;
    const birds = [];
    for (let i = 0; i < count; i++) {
      const sp = new THREE.Sprite(birdMat);
      sp.scale.set(size, size * 0.5, 1);
      group.add(sp);
      birds.push({ sp, phase: brng() * Math.PI * 2 });
    }
    flocks.push({
      birds, size,
      a: brng() * Math.PI * 2,
      y: 130 + brng() * 170,
      R: 320 + brng() * 440,
      w: (0.05 + brng() * 0.05) * (brng() < 0.5 ? 1 : -1),
      spacing: size * 1.6,
      spread: size * 1.3,
    });
  }

  const _white = new THREE.Color(0xffffff);
  const _dark = new THREE.Color(0x2a3452);
  const _col = new THREE.Color();
  let t = 0;
  function update(dt, camera, night = 0) {
    t += dt;
    if (camera) group.position.set(camera.position.x, 0, camera.position.z);

    // Clouds drift on the wind and wrap; dim + go blue-grey toward night.
    for (const c of clouds) {
      c.sp.position.x += c.spd * dt;
      if (c.sp.position.x > CLOUD_R) c.sp.position.x -= CLOUD_R * 2;
    }
    _col.copy(_white).lerp(_dark, night * 0.8);
    for (const m of cloudMats) { m.color.copy(_col); m.opacity = 0.96 - night * 0.4; }

    // Birds fly by day and fade away at dusk.
    birdMat.opacity = Math.max(0, 0.9 * (1 - night * 1.4));
    for (const fl of flocks) {
      fl.a += fl.w * dt;
      const cx = Math.cos(fl.a) * fl.R, cz = Math.sin(fl.a) * fl.R;
      const sgn = Math.sign(fl.w) || 1;
      const hx = -Math.sin(fl.a) * sgn, hz = Math.cos(fl.a) * sgn; // heading (tangent)
      const px = Math.cos(fl.a), pz = Math.sin(fl.a);              // radial (perpendicular)
      for (let i = 0; i < fl.birds.length; i++) {
        const b = fl.birds[i];
        const rank = Math.ceil(i / 2);
        const side = i === 0 ? 0 : (i % 2 ? -1 : 1);
        const bx = cx - hx * rank * fl.spacing + px * side * fl.spread * rank;
        const bz = cz - hz * rank * fl.spacing + pz * side * fl.spread * rank;
        b.sp.position.set(bx, fl.y + Math.sin(t * 0.6 + b.phase) * 4, bz);
        const flap = 0.4 + 0.6 * Math.abs(Math.sin(t * 5 + b.phase)); // slow wing flap
        b.sp.scale.set(fl.size, fl.size * 0.5 * flap, 1);
      }
    }
  }
  update(0, null, 0);
  return { group, update };
}
