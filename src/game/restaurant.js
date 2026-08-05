// The restaurant hub: the physical half of the shop.
//
// orders.js decides WHO is waiting and what it is worth. This module puts them
// on the pavement — a pool of procedural cats that walk in, queue up, hold a
// little order bubble over their heads and leave. It also owns the four things
// the player can press E on at the shop, rebuilds the visible building when the
// tier changes, and keeps the day's books.
//
// Nothing is allocated per customer: cats, sprites, canvases and textures all
// come out of a fixed pool built once at construction.

import * as THREE_NS from 'three';
import { EV } from './bus.js';
import * as UI from '../ui/kit.js';
import { createCat } from '../cat/catModel.js';
import { buildSushiShop } from '../world/buildings.js';
import { recipe as recipeById } from '../data/recipes.js';
import { SHOP_TIERS } from '../data/progression.js';

// ---------------------------------------------------------------------------
const TUNE = {
  poolSize: 12,             // >= max queue (8 at tier 5) + upgrades + slack
  walkSpeed: 1.55,          // world units / second
  arriveEps: 0.18,          // distance at which a cat is "there"
  turnRate: 7.0,            // radians / second
  spawnOut: 4.2,            // how far beyond the door customers appear
  spawnSpread: 1.6,
  laneGap: 0.85,            // spacing when there are more customers than anchors
  bubbleSize: 0.62,
  bubbleLift: 0.42,         // above the cat's eye height
  bubbleRedrawStep: 1 / 28, // patience ring quantisation, to skip canvas work
  sizeVariation: [0.86, 1.06],
  interactRadius: 2.8,
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const lerpAngle = (a, b, t) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * clamp(t, 0, 1);
};

/** Depth-first dispose of everything hanging off a THREE object. */
function disposeSubtree(root) {
  if (!root) return;
  const seenGeo = new Set();
  const seenMat = new Set();
  root.traverse((o) => {
    if (!o.isMesh && !o.isPoints && !o.isLine && !o.isSprite) return;
    const geo = o.geometry;
    if (geo && !seenGeo.has(geo)) { seenGeo.add(geo); try { geo.dispose(); } catch (e) { /* ignore */ } }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || seenMat.has(m)) continue;
      seenMat.add(m);
      for (const k of ['map', 'emissiveMap', 'alphaMap', 'normalMap', 'gradientMap']) {
        const tex = m[k];
        if (tex && tex.dispose && tex.isCanvasTexture) { try { tex.dispose(); } catch (e) { /* ignore */ } }
      }
      try { m.dispose(); } catch (e) { /* ignore */ }
    }
  });
  for (let i = root.children.length - 1; i >= 0; i--) root.remove(root.children[i]);
}

// ---------------------------------------------------------------------------
export function createRestaurant(game, { shopGroup, anchors } = {}) {
  const g = game || {};
  const THREE = g.THREE || THREE_NS;
  const bus = g.bus || { emit() {}, on() { return () => {}; } };
  const state = g.state;
  const rng = typeof g.rng === 'function' ? g.rng : Math.random;
  const group = shopGroup || new THREE.Group();

  if (!state) console.warn('[restaurant] created without game.state');

  const ordersSys = () => g.orders || null;

  // World-space anchors. Seeded from the caller, recomputed from local space
  // whenever we rebuild the building ourselves.
  let world = normaliseAnchors(anchors);
  let localAnchors = null;
  let builtRoot = null;
  let tier = Math.max(1, Math.round(num(state && state.shop && state.shop.tier, 1)));

  function normaliseAnchors(a) {
    const src = a && typeof a === 'object' ? a : {};
    const pt = (p, d) => ({
      x: num(p && p.x, d.x), y: num(p && p.y, d.y), z: num(p && p.z, d.z), yaw: num(p && p.yaw, 0),
    });
    const door = pt(src.door, { x: 0, y: 0, z: 2 });
    const counter = pt(src.counterAnchor, { x: 0, y: 1.2, z: 0 });
    const queueAnchors = (Array.isArray(src.queueAnchors) ? src.queueAnchors : [])
      .map((p) => pt(p, { x: door.x, y: 0, z: door.z }));
    const seatAnchors = (Array.isArray(src.seatAnchors) ? src.seatAnchors : [])
      .map((p) => pt(p, { x: door.x, y: 0, z: door.z }));
    if (!queueAnchors.length) queueAnchors.push({ x: door.x, y: 0, z: door.z + 1.4, yaw: 0 });
    return { door, counter, queueAnchors, seatAnchors };
  }

  // ------------------------------------------------------------ geometry pool
  const gradientMap = (g.world && g.world.gradientMap) || null;
  const groundY = (x, z) => {
    if (g.world && typeof g.world.groundHeightAt === 'function') {
      try { return num(g.world.groundHeightAt(x, z), 0); } catch (e) { return 0; }
    }
    return 0;
  };

  /** One reusable bubble: canvas → CanvasTexture → SpriteMaterial → Sprite. */
  function makeBubble() {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.setScalar(TUNE.bubbleSize);
    sprite.visible = false;
    sprite.renderOrder = 6;
    return { canvas, ctx, tex, mat, sprite, lastIcon: null, lastRing: -1, lastColor: null };
  }

  function drawBubble(b, icon, ring, color) {
    const q = Math.round(ring / TUNE.bubbleRedrawStep);
    if (b.lastIcon === icon && b.lastRing === q && b.lastColor === color) return;
    b.lastIcon = icon; b.lastRing = q; b.lastColor = color;
    const { ctx } = b;
    const S = 128, c = S / 2;
    ctx.clearRect(0, 0, S, S);

    // cream disc + ink outline
    ctx.beginPath(); ctx.arc(c, c, 50, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(251,243,226,0.96)'; ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(59,47,38,0.28)'; ctx.stroke();

    // little tail pointing down at the cat
    ctx.beginPath();
    ctx.moveTo(c - 11, c + 46); ctx.lineTo(c, c + 62); ctx.lineTo(c + 11, c + 46);
    ctx.closePath(); ctx.fillStyle = 'rgba(251,243,226,0.96)'; ctx.fill();

    // patience ring
    ctx.beginPath();
    ctx.arc(c, c, 55, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(ring, 0, 1));
    ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.strokeStyle = color; ctx.stroke();

    // recipe icon
    ctx.font = '54px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(icon || '🍣', c, c + 3);
    b.tex.needsUpdate = true;
  }

  /** @type {Array<object>} */
  const pool = [];
  for (let i = 0; i < TUNE.poolSize; i++) {
    const cat = createCat({ fur: '#e8a55c', accent: '#c8503f', gradientMap, scale: 1 });
    cat.group.visible = false;
    cat.group.name = `customer:${i}`;
    group.add(cat.group);
    const bubble = makeBubble();
    cat.group.add(bubble.sprite);
    pool.push({
      cat, bubble,
      orderId: null,
      phase: 'idle',        // 'idle' | 'arriving' | 'waiting' | 'leaving'
      x: 0, z: 0, yaw: 0,
      tx: 0, tz: 0,
      speed: 0,
      scale: 1,
      idleT: 0,
      sitting: false,
    });
  }

  const byOrder = new Map();      // orderId -> slot

  function acquire(order) {
    for (const s of pool) {
      if (s.phase !== 'idle') continue;
      const cust = order.customer || {};
      const scale = TUNE.sizeVariation[0]
        + rng() * (TUNE.sizeVariation[1] - TUNE.sizeVariation[0]);
      s.scale = scale;
      s.cat.setHeight(scale);
      s.cat.setTint(cust.fur || '#e8a55c');
      s.cat.setMood('neutral');
      s.cat.setAction('walk');
      s.orderId = order.id;
      s.phase = 'arriving';
      s.idleT = rng() * 4;
      s.sitting = false;

      // Appear outside, beyond the door, on the street side.
      const dir = outwardDir();
      const lat = (rng() - 0.5) * TUNE.spawnSpread;
      s.x = world.door.x + dir.x * TUNE.spawnOut - dir.z * lat;
      s.z = world.door.z + dir.z * TUNE.spawnOut + dir.x * lat;
      s.yaw = Math.atan2(-dir.x, -dir.z);
      s.cat.group.position.set(s.x, groundY(s.x, s.z), s.z);
      s.cat.group.rotation.y = s.yaw;
      s.cat.group.visible = true;
      s.bubble.sprite.visible = true;
      s.bubble.sprite.position.set(0, (s.cat.eyeHeight() / Math.max(0.01, scale)) + TUNE.bubbleLift, 0);
      s.bubble.lastRing = -1;                        // force a first draw
      byOrder.set(order.id, s);
      return s;
    }
    return null;                                     // pool exhausted: order still queues, just invisibly
  }

  function releaseSlot(s, walkOff = true) {
    if (!s) return;
    if (s.orderId) byOrder.delete(s.orderId);
    s.orderId = null;
    s.bubble.sprite.visible = false;
    if (!walkOff) { s.phase = 'idle'; s.cat.group.visible = false; return; }
    const dir = outwardDir();
    s.phase = 'leaving';
    s.tx = world.door.x + dir.x * (TUNE.spawnOut + 3);
    s.tz = world.door.z + dir.z * (TUNE.spawnOut + 3);
    s.sitting = false;
    s.cat.setAction('walk');
  }

  /** Unit vector pointing from the counter out through the door (street side). */
  function outwardDir() {
    let dx = world.door.x - world.counter.x;
    let dz = world.door.z - world.counter.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.001) return { x: 0, z: 1 };
    return { x: dx / len, z: dz / len };
  }

  /** Where the n-th cat in line should stand. Falls back to a straight lane. */
  function queueSpot(i) {
    const a = world.queueAnchors;
    if (i < a.length) return a[i];
    const last = a[a.length - 1];
    const dir = outwardDir();
    const over = i - a.length + 1;
    return { x: last.x + dir.x * TUNE.laneGap * over, z: last.z + dir.z * TUNE.laneGap * over };
  }

  // -------------------------------------------------------- order-select panel
  const select = createOrderSelect();

  function createOrderSelect() {
    let p = null;
    let scrim = null;
    let list = null;
    let open = false;

    function ensure() {
      if (p) return;
      UI.injectStyles();
      scrim = UI.scrim(() => close());
      p = UI.panel({
        id: 'sp-order-select',
        title: 'Orders',
        sub: '',
        pos: { left: '50%', top: '50%', width: 'min(380px, 86vw)', transform: 'translate(-50%,-50%)' },
        onClose: () => close(),
      });
      list = UI.el('div', 'sp-list');
      list.style.maxHeight = '46vh';
      p.body.append(list);
    }

    function close() {
      if (!open) return;
      open = false;
      if (p) p.hide();
      if (scrim) scrim.hide();
      try { bus.emit(EV.PANEL_CLOSE, { id: 'order-select' }); } catch (e) { /* ignore */ }
      if (g.interactions && typeof g.interactions.lock === 'function') g.interactions.lock(false);
      if (g.player && typeof g.player.lock === 'function') g.player.lock(false);
      if (typeof g.setMode === 'function') g.setMode('explore');
    }

    function show() {
      const sys = ordersSys();
      if (!sys) { UI.toast('The kitchen is not ready yet', { icon: '🍳', tone: 'bad' }); return; }
      const waiting = sys.queue.filter((o) => o.state === 'waiting' || o.state === 'cooking');
      if (!waiting.length) { UI.toast('Nobody is waiting', { icon: '💤' }); return; }

      ensure();
      list.innerHTML = '';
      for (const o of waiting) {
        const rec = recipeById(o.recipeId);
        const left = Math.max(0, Math.round(o.patienceLeft));
        const cust = o.customer || {};
        const row = UI.item({
          icon: (rec && rec.icon) || '🍣',
          name: `${(rec && rec.name) || o.recipeId} ×${o.qty}`,
          meta: `${cust.name || 'Customer'} · ${left}s`,
          onClick: () => { close(); startCook(o.id); },
        });
        list.append(row);
      }
      p.setTitle('Orders', `${waiting.length} waiting`);
      scrim.show();
      p.show();
      open = true;
      try { bus.emit(EV.PANEL_OPEN, { id: 'order-select' }); } catch (e) { /* ignore */ }
      if (g.interactions && typeof g.interactions.lock === 'function') g.interactions.lock(true);
      if (g.player && typeof g.player.lock === 'function') g.player.lock(true);
      if (typeof g.setMode === 'function') g.setMode('panel');
    }

    const api = {
      id: 'order-select',
      open: show,
      close,
      get isOpen() { return open; },
      destroy() { if (p) p.destroy(); if (scrim && scrim.el) scrim.el.remove(); p = null; scrim = null; },
    };
    if (g.panels && typeof g.panels.register === 'function') {
      try { g.panels.register('order-select', api); } catch (e) { /* ignore */ }
    }
    return api;
  }

  /** Take the order, run the cooking mini-game, hand the result back. */
  function startCook(orderId) {
    const sys = ordersSys();
    if (!sys) return;
    const order = sys.take(orderId);
    if (!order) return;

    const cooking = g.cooking;
    if (!cooking || typeof cooking.start !== 'function') {
      console.warn('[restaurant] game.cooking is not available');
      UI.toast('The cooking station is not built yet', { icon: '🔪', tone: 'bad' });
      sys.release(orderId);
      return;
    }

    let p;
    try {
      p = cooking.start({ recipeId: order.recipeId, qty: order.qty, orderId: order.id, order });
    } catch (err) {
      console.error('[restaurant] cooking.start threw', err);
      sys.release(orderId);
      return;
    }

    Promise.resolve(p).then((res) => {
      if (!res || res.aborted || res.cancelled) { sys.release(orderId); return; }
      sys.serve(orderId, res);
    }).catch((err) => {
      console.error('[restaurant] cooking failed', err);
      sys.release(orderId);
    });
  }

  // --------------------------------------------------------------- interactions
  const removers = [];

  function openPanel(id) {
    if (g.panels && typeof g.panels.open === 'function') {
      try { g.panels.open(id); return; } catch (e) { console.error('[restaurant] panels.open', id, e); }
    }
    bus.emit(EV.PANEL_OPEN, { id });
  }

  function registerInteractions() {
    const it = g.interactions;
    if (!it || typeof it.add !== 'function') return;
    for (const off of removers.splice(0)) { try { off(); } catch (e) { /* ignore */ } }

    const dir = outwardDir();
    const side = { x: -dir.z, z: dir.x };            // counter-local "right"

    removers.push(it.add({
      id: 'shop_counter',
      x: world.counter.x + dir.x * 0.9,
      z: world.counter.z + dir.z * 0.9,
      r: TUNE.interactRadius,
      priority: 3,
      label: () => {
        const sys = ordersSys();
        const n = sys ? sys.queue.filter((o) => o.state === 'waiting').length : 0;
        return n ? `Cook an order (${n})` : 'Cook an order';
      },
      data: { kind: 'shop', id: 'counter' },
      onUse: () => select.open(),
    }));

    removers.push(it.add({
      id: 'shop_sign',
      x: world.door.x + dir.x * 1.1 + side.x * 1.2,
      z: world.door.z + dir.z * 1.1 + side.z * 1.2,
      r: TUNE.interactRadius,
      priority: 2,
      label: () => {
        const sys = ordersSys();
        const open = sys ? sys.isOpen : !!(state && state.shop && state.shop.isOpen);
        return open ? 'Close the shop' : 'Open the shop';
      },
      data: { kind: 'shop', id: 'sign' },
      onUse: () => {
        const sys = ordersSys();
        if (!sys) return;
        if (sys.isOpen) sys.closeShop(); else sys.openShop();
      },
    }));

    removers.push(it.add({
      id: 'shop_upgrade',
      x: world.counter.x - side.x * 1.1 + dir.x * 0.5,
      z: world.counter.z - side.z * 1.1 + dir.z * 0.5,
      r: TUNE.interactRadius,
      priority: 2,
      label: 'Shop upgrades',
      data: { kind: 'shop', id: 'till' },
      onUse: () => openPanel('upgrades'),
    }));

    removers.push(it.add({
      id: 'shop_storage',
      x: world.counter.x + side.x * 1.3 - dir.x * 0.7,
      z: world.counter.z + side.z * 1.3 - dir.z * 0.7,
      r: TUNE.interactRadius,
      priority: 2,
      label: 'Check the storage',
      data: { kind: 'shop', id: 'storage' },
      onUse: () => openPanel('inventory'),
    }));
  }

  // ------------------------------------------------------------ tier rebuilding
  function setTier(newTier) {
    const t = clamp(Math.round(num(newTier, tier)), 1, SHOP_TIERS.length);
    let built = null;
    try { built = buildSushiShop(t); } catch (err) { console.error('[restaurant] buildSushiShop threw', err); }
    if (!built || !built.structure) { console.warn('[restaurant] setTier: nothing built for tier', t); return false; }

    tier = t;

    // Dispose whatever was standing here (ours or the world's initial placement),
    // but never the pooled customer cats.
    const keep = new Set(pool.map((s) => s.cat.group));
    for (let i = group.children.length - 1; i >= 0; i--) {
      const child = group.children[i];
      if (keep.has(child)) continue;
      group.remove(child);
      disposeSubtree(child);
      if (child.geometry) { try { child.geometry.dispose(); } catch (e) { /* ignore */ } }
      const mats = Array.isArray(child.material) ? child.material : (child.material ? [child.material] : []);
      for (const m of mats) { try { m.dispose(); } catch (e) { /* ignore */ } }
    }
    builtRoot = null;

    const root = new THREE.Group();
    root.name = `sushi-shop:t${t}`;

    const structMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
    const sm = new THREE.Mesh(built.structure, structMat);
    sm.castShadow = true; sm.receiveShadow = true;
    root.add(sm);

    if (built.glow) {
      const m = new THREE.MeshToonMaterial({
        vertexColors: true, gradientMap,
        emissive: new THREE.Color(0xffd9a0), emissiveIntensity: 0,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
      });
      if (g.world && Array.isArray(g.world.glowMats)) g.world.glowMats.push(m);
      root.add(new THREE.Mesh(built.glow, m));
    }
    if (built.neon) {
      const m = new THREE.MeshToonMaterial({
        vertexColors: true, gradientMap,
        emissive: new THREE.Color(0xfff0d0), emissiveIntensity: 0.12, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3,
      });
      if (g.world && Array.isArray(g.world.neonMats)) g.world.neonMats.push(m);
      root.add(new THREE.Mesh(built.neon, m));
    }
    if (built.sign && built.signTex) {
      const tex = built.signTex;
      const signMat = new THREE.MeshToonMaterial({
        map: tex, gradientMap, emissive: 0xffffff, emissiveMap: tex,
        emissiveIntensity: 0.5, side: THREE.DoubleSide,
      });
      const sg = new THREE.PlaneGeometry(num(built.sign.w, 3), num(built.sign.h, 0.8));
      sg.translate(num(built.sign.x, 0), num(built.sign.y, 3), num(built.sign.z, 0) + 0.03);
      root.add(new THREE.Mesh(sg, signMat));
    }

    group.add(root);
    builtRoot = root;

    // Local anchors -> world, through whatever transform the shop group carries.
    localAnchors = {
      door: built.door, counterAnchor: built.counterAnchor,
      queueAnchors: built.queueAnchors, seatAnchors: built.seatAnchors,
    };
    world = toWorld(localAnchors);
    registerInteractions();
    return true;
  }

  const _v = new THREE.Vector3();
  function toWorld(local) {
    group.updateMatrixWorld(true);
    const conv = (p, d) => {
      const src = p && typeof p === 'object' ? p : d;
      _v.set(num(src.x, d.x), num(src.y, d.y), num(src.z, d.z)).applyMatrix4(group.matrixWorld);
      return { x: _v.x, y: _v.y, z: _v.z, yaw: num(src.yaw, 0) + num(group.rotation.y, 0) };
    };
    const door = conv(local.door, { x: 0, y: 0, z: 2 });
    const counter = conv(local.counterAnchor, { x: 0, y: 1.2, z: 0 });
    const queueAnchors = (Array.isArray(local.queueAnchors) ? local.queueAnchors : [])
      .map((p) => conv(p, { x: 0, y: 0, z: 2 }));
    const seatAnchors = (Array.isArray(local.seatAnchors) ? local.seatAnchors : [])
      .map((p) => conv(p, { x: 0, y: 0, z: 2 }));
    if (!queueAnchors.length) queueAnchors.push({ x: door.x, y: door.y, z: door.z + 1.4, yaw: 0 });
    return { door, counter, queueAnchors, seatAnchors };
  }

  // --------------------------------------------------------------- daily books
  //
  // state.today already tracks earned / spent / served / tips / rep for the whole
  // game, so we only keep the two figures nobody else counts: walk-outs and the
  // biggest single ticket. summaryForToday() merges the two views.
  let books = { failed: 0, best: 0 };

  function summaryForToday() {
    const t = (state && state.today) || {};
    return {
      day: Math.round(num(state && state.clock && state.clock.day, 1)),
      earned: Math.round(num(t.earned, 0)),
      spent: Math.round(num(t.spent, 0)),
      served: Math.round(num(t.served, 0)),
      failed: books.failed,
      tips: Math.round(num(t.tips, 0)),
      rep: Math.round(num(t.rep, 0) * 100) / 100,
      best: Math.round(books.best),
    };
  }

  // -------------------------------------------------------------------- events
  const offs = [];
  const sub = (evt, fn) => { try { offs.push(bus.on(evt, fn)); } catch (e) { /* ignore */ } };

  sub(EV.SHOP_UPGRADED, (p) => {
    if (!p || p.id !== 'tier') return;
    const t = num(p.tier, num(p.level, tier));
    if (t === tier) return;
    setTier(t);
    UI.toast('The shop has grown!', { icon: '🏗️', tone: 'good' });
  });

  sub(EV.ORDER_SERVED, (p) => {
    if (!p || !p.order) return;
    const ticket = num(p.pay, 0) + num(p.tip, 0);
    if (ticket > books.best) books.best = ticket;
    const s = byOrder.get(p.order.id);
    if (s) {
      s.cat.setMood('happy');
      if (typeof s.cat.playAction === 'function') s.cat.playAction('happy');
      releaseSlot(s, true);
    }
  });

  sub(EV.ORDER_FAILED, (p) => {
    if (!p || !p.order) return;
    if (p.reason === 'patience' || p.reason === 'timeout' || p.reason === 'wrong') books.failed++;
    const s = byOrder.get(p.order.id);
    if (s) { s.cat.setMood('tired'); releaseSlot(s, true); }
  });

  sub(EV.DAY_START, () => { books = { failed: 0, best: 0 }; });

  // The clock emits DAY_END *before* it calls state.resetToday(), so the books
  // are still the finished day's when we read them here.
  sub(EV.DAY_END, (p) => {
    const payload = summaryForToday();
    payload.day = Math.round(num(p && p.day, payload.day));
    bus.emit(EV.DAY_SUMMARY, payload);
    bus.emit(EV.PANEL_OPEN, { id: 'day-summary', payload });
  });

  // ---------------------------------------------------------------- frame loop
  function syncQueue() {
    const sys = ordersSys();
    if (!sys) return;

    const live = sys.queue.filter((o) => !o.delivery && (o.state === 'waiting' || o.state === 'cooking'));
    const liveIds = new Set(live.map((o) => o.id));

    // Anyone whose order vanished without an event (reset, save load) goes home.
    for (const [id, s] of Array.from(byOrder.entries())) {
      if (!liveIds.has(id)) releaseSlot(s, true);
    }

    // New arrivals + queue positions.
    for (let i = 0; i < live.length; i++) {
      const o = live[i];
      let s = byOrder.get(o.id);
      if (!s) s = acquire(o);
      if (!s) continue;
      const spot = queueSpot(i);
      s.tx = spot.x;
      s.tz = spot.z;
    }
  }

  const PATIENCE_COLORS = ['#7ec96a', '#f0b93f', '#c8503f'];
  function ringColor(f) {
    if (f > 0.55) return PATIENCE_COLORS[0];
    if (f > 0.25) return PATIENCE_COLORS[1];
    return PATIENCE_COLORS[2];
  }

  function update(dt) {
    const d = clamp(num(dt, 0), 0, 0.1);
    syncQueue();
    const sys = ordersSys();

    for (const s of pool) {
      if (s.phase === 'idle') continue;

      const dx = s.tx - s.x, dz = s.tz - s.z;
      const dist = Math.hypot(dx, dz);

      if (s.phase === 'leaving' && dist < 1.2) {
        s.phase = 'idle';
        s.cat.group.visible = false;
        s.bubble.sprite.visible = false;
        s.speed = 0;
        continue;
      }

      if (dist > TUNE.arriveEps) {
        const step = Math.min(dist, TUNE.walkSpeed * d);
        s.x += (dx / dist) * step;
        s.z += (dz / dist) * step;
        s.speed = TUNE.walkSpeed;
        s.yaw = lerpAngle(s.yaw, Math.atan2(dx, dz), TUNE.turnRate * d);
        if (s.sitting) { s.sitting = false; s.cat.setAction('walk'); }
        if (s.phase === 'arriving') s.cat.setAction('walk');
      } else {
        s.speed = 0;
        if (s.phase === 'arriving') { s.phase = 'waiting'; s.cat.setAction('idle'); }
        if (s.phase === 'waiting') {
          // Face the counter and settle: long waits sit down.
          const fx = world.counter.x - s.x, fz = world.counter.z - s.z;
          if (Math.hypot(fx, fz) > 0.05) s.yaw = lerpAngle(s.yaw, Math.atan2(fx, fz), TUNE.turnRate * 0.5 * d);
          s.idleT += d;
          if (!s.sitting && s.idleT > 6) { s.sitting = true; s.cat.setAction('sit'); }
          else if (s.sitting && s.cat.actionReady && s.idleT > 18 && rng() < d * 0.12) {
            s.cat.playAction && s.cat.playAction('meow');
            s.idleT = 6;
          }
        }
      }

      s.cat.group.position.set(s.x, groundY(s.x, s.z), s.z);
      s.cat.group.rotation.y = s.yaw;
      s.cat.update(d, s.speed);

      // Bubble.
      if (s.orderId && sys) {
        const o = sys.find(s.orderId);
        if (o) {
          const rec = recipeById(o.recipeId);
          const frac = o.patience > 0 ? clamp(o.patienceLeft / o.patience, 0, 1) : 0;
          drawBubble(s.bubble, (rec && rec.icon) || '🍣', frac, o.state === 'cooking' ? '#5f97b8' : ringColor(frac));
          s.bubble.sprite.visible = true;
        } else {
          s.bubble.sprite.visible = false;
        }
      } else {
        s.bubble.sprite.visible = false;
      }
    }
  }

  // -------------------------------------------------------------------- public
  function customers() {
    const out = [];
    for (const s of pool) {
      if (s.phase === 'idle') continue;
      out.push({ orderId: s.orderId, x: s.x, z: s.z, phase: s.phase, scale: s.scale, group: s.cat.group });
    }
    return out;
  }

  function dispose() {
    for (const off of offs.splice(0)) { try { off(); } catch (e) { /* ignore */ } }
    for (const off of removers.splice(0)) { try { off(); } catch (e) { /* ignore */ } }
    for (const s of pool) {
      try { s.bubble.tex.dispose(); } catch (e) { /* ignore */ }
      try { s.bubble.mat.dispose(); } catch (e) { /* ignore */ }
      if (s.bubble.sprite.parent) s.bubble.sprite.parent.remove(s.bubble.sprite);
      try { s.cat.dispose(); } catch (e) { /* ignore */ }
    }
    pool.length = 0;
    byOrder.clear();
    if (builtRoot) { group.remove(builtRoot); disposeSubtree(builtRoot); builtRoot = null; }
    select.destroy();
  }

  registerInteractions();

  return {
    update,
    get customers() { return customers(); },
    setTier,
    summaryForToday,
    dispose,
    // handy extras
    get tier() { return tier; },
    get anchors() { return world; },
    get group() { return group; },
  };
}

export default createRestaurant;
