// Lightweight corner minimap for CATOSHI — adapts ROADS + world POIs without
// requiring ENGINE CITY's full road-graph payload.

import { ROADS, DISTRICTS, HOME } from '../data/districts.js';

export function createSimpleMinimap(world) {
  const wrap = document.getElementById('minimap-wrap');
  const canvas = document.getElementById('minimap');
  const backdrop = document.getElementById('mm-backdrop');
  const infoEl = document.getElementById('mm-info');
  const clearBtn = document.getElementById('mm-clear');
  const closeBtn = document.getElementById('mm-close');
  if (!wrap || !canvas) {
    return { show() {}, hide() {}, update() {}, setDestination() {}, clearDestination() {} };
  }
  const ctx = canvas.getContext('2d');

  const roads = ROADS.map((r) => ({ cx: r.x, cz: r.z, w: r.w, d: r.d }));
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const r of roads) {
    minX = Math.min(minX, r.cx - r.w / 2); maxX = Math.max(maxX, r.cx + r.w / 2);
    minZ = Math.min(minZ, r.cz - r.d / 2); maxZ = Math.max(maxZ, r.cz + r.d / 2);
  }
  for (const d of DISTRICTS) {
    if (d.center && d.half) {
      minX = Math.min(minX, d.center.x - d.half.x);
      maxX = Math.max(maxX, d.center.x + d.half.x);
      minZ = Math.min(minZ, d.center.z - d.half.z);
      maxZ = Math.max(maxZ, d.center.z + d.half.z);
    }
  }
  const PAD = 12;
  minX -= PAD; maxX += PAD; minZ -= PAD; maxZ += PAD;

  const pois = (world && world.pois) ? world.pois.slice() : [];
  if (!pois.find((p) => p.id === 'home')) {
    pois.push({ id: 'home', x: HOME.shop.x, z: HOME.shop.z, label: 'CATOSHI Stall', kind: 'shop' });
  }

  const cityAspect = (maxX - minX) / (maxZ - minZ);
  const SMALL_H = 168;
  const SMALL_W = Math.round(Math.max(140, Math.min(240, SMALL_H * cityAspect)));
  let CSS_W = SMALL_W;
  let CSS_H = SMALL_H;
  let scale = 1, offX = 0, offY = 0;
  let expanded = false;
  let dest = null;

  function layout() {
    const pad = 8;
    scale = Math.min((CSS_W - pad * 2) / (maxX - minX), (CSS_H - pad * 2) / (maxZ - minZ));
    offX = (CSS_W - (maxX - minX) * scale) / 2;
    offY = (CSS_H - (maxZ - minZ) * scale) / 2;
  }
  function setSize(w, h) {
    CSS_W = w; CSS_H = h;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout();
  }
  const mx = (x) => offX + (x - minX) * scale;
  const my = (z) => offY + (z - minZ) * scale;

  setSize(SMALL_W, SMALL_H);

  function expand() {
    expanded = true;
    const m = 48;
    const availW = window.innerWidth - m * 2;
    const availH = window.innerHeight - m * 2;
    let h = availH, w = h * cityAspect;
    if (w > availW) { w = availW; h = w / cityAspect; }
    setSize(Math.round(w), Math.round(h));
    wrap.classList.add('expanded');
    if (backdrop) backdrop.classList.add('show');
    if (closeBtn) closeBtn.style.display = '';
  }
  function shrink() {
    expanded = false;
    setSize(SMALL_W, SMALL_H);
    wrap.classList.remove('expanded');
    if (backdrop) backdrop.classList.remove('show');
    if (closeBtn) closeBtn.style.display = 'none';
  }

  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * CSS_W;
    const sy = ((e.clientY - r.top) / r.height) * CSS_H;
    // Hit-test POIs
    for (const p of pois) {
      const px = mx(p.x), pz = my(p.z);
      if (Math.hypot(sx - px, sy - pz) < 10) {
        setDestination({ x: p.x, z: p.z, label: p.label || p.id });
        return;
      }
    }
    if (expanded) shrink(); else expand();
  });
  if (backdrop) backdrop.addEventListener('click', shrink);
  if (closeBtn) { closeBtn.style.display = 'none'; closeBtn.addEventListener('click', shrink); }
  if (clearBtn) clearBtn.addEventListener('click', () => clearDestination());

  function setDestination(d) {
    dest = d;
    wrap.classList.add('has-dest');
    if (infoEl) infoEl.textContent = d.label || 'Destination';
    if (clearBtn) clearBtn.style.display = '';
    if (world && world.setWaypoint) world.setWaypoint(d);
  }
  function clearDestination() {
    dest = null;
    wrap.classList.remove('has-dest');
    if (infoEl) infoEl.textContent = 'Click a pin · expand map';
    if (clearBtn) clearBtn.style.display = 'none';
    if (world && world.setWaypoint) world.setWaypoint(null);
  }
  if (clearBtn) clearBtn.style.display = 'none';
  if (infoEl) infoEl.textContent = 'Click a pin · expand map';

  function update(px, pz, yaw = 0) {
    // Background
    ctx.clearRect(0, 0, CSS_W, CSS_H);
    const g = ctx.createLinearGradient(0, 0, 0, CSS_H);
    g.addColorStop(0, '#2a1450');
    g.addColorStop(1, '#12081f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CSS_W, CSS_H);

    // District washes
    for (const d of DISTRICTS) {
      if (!d.center || !d.half) continue;
      const x0 = d.center.x - d.half.x, z0 = d.center.z - d.half.z;
      ctx.fillStyle = 'rgba(180,120,220,0.12)';
      ctx.fillRect(mx(x0), my(z0), d.half.x * 2 * scale, d.half.z * 2 * scale);
    }

    // Roads
    ctx.fillStyle = 'rgba(120,100,150,0.55)';
    for (const r of roads) {
      ctx.fillRect(mx(r.cx - r.w / 2), my(r.cz - r.d / 2), r.w * scale, r.d * scale);
    }

    // Route to dest
    if (dest) {
      ctx.strokeStyle = 'rgba(255,180,120,0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(mx(px), my(pz));
      ctx.lineTo(mx(dest.x), my(dest.z));
      ctx.stroke();
      ctx.setLineDash([]);
      const dist = Math.hypot(dest.x - px, dest.z - pz);
      if (infoEl) infoEl.textContent = `${dest.label || 'Dest'} · ${dist.toFixed(0)}m`;
    }

    // POIs
    for (const p of pois) {
      const isShop = p.kind === 'shop' || p.id === 'home' || /shop|stall|catoshi/i.test(p.label || '');
      ctx.fillStyle = isShop ? '#ff7a9a' : '#a8d8ff';
      ctx.beginPath();
      ctx.arc(mx(p.x), my(p.z), isShop ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Player arrow
    const ax = mx(px), az = my(pz);
    ctx.save();
    ctx.translate(ax, az);
    ctx.rotate(yaw); // world yaw 0 = +Z = down on map
    ctx.fillStyle = '#ffe08a';
    ctx.beginPath();
    ctx.moveTo(0, 7);
    ctx.lineTo(-5, -6);
    ctx.lineTo(5, -6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Frame
    ctx.strokeStyle = 'rgba(255,200,255,0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, CSS_W - 2, CSS_H - 2);
  }

  return {
    show: () => wrap.classList.add('show'),
    hide: () => { wrap.classList.remove('show'); shrink(); },
    update,
    setDestination,
    clearDestination,
  };
}
