// Foraging — the quiet system.
//
// A forage node is a small plant/fruit prop standing in the world with an
// interaction on it. The cat pounces on it, the item goes in the basket, the
// prop hides, and it grows back after a few in-game hours. No mini-game, no
// timer, no failure state: it is the thing you do on the walk home.

import { EV } from './bus.js';
import * as UI from '../ui/kit.js';
import { ingredient, ingredientAvailable } from '../data/ingredients.js';

// ---------------------------------------------------------------------------
// Seasons
//
// The clock only tracks days, so a season is derived from the day number.
// 28 in-game days per season, four seasons, starting in spring.
// ---------------------------------------------------------------------------
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const DAYS_PER_SEASON = 28;

export function seasonForDay(day) {
  const d = Math.max(1, Math.floor(Number(day) || 1)) - 1;
  return SEASONS[Math.floor(d / DAYS_PER_SEASON) % SEASONS.length];
}

// ---------------------------------------------------------------------------
// Node table
// ---------------------------------------------------------------------------

/**
 * A forage node.
 *   id, x, z                world anchor
 *   ingredientId            what it yields
 *   respawnHours            in-game hours before it grows back
 *   qtyRange [min, max]     units per pick
 *   season                  optional 'spring' | 'summer' | 'autumn' | 'winter'
 *   look                    'leaf' | 'petal' | 'fruit' | 'herb'   (visual only)
 *   quality [min, max]      optional override of the rolled quality band
 */
export const DEFAULT_NODES = [
  // --- Old Market: shiso growing out of the alley walls --------------------
  { id: 'forage_shiso_alley_a', name: 'Shiso patch',  x: -40, z: -1.7,  ingredientId: 'shiso', respawnHours: 8,  qtyRange: [1, 2], look: 'leaf' },
  { id: 'forage_shiso_alley_b', name: 'Shiso patch',  x: -31, z: 13,  ingredientId: 'shiso', respawnHours: 10, qtyRange: [1, 2], look: 'leaf' },
  { id: 'forage_shiso_alley_c', name: 'Shiso patch',  x: -48, z: -10.7, ingredientId: 'shiso', respawnHours: 12, qtyRange: [1, 3], look: 'leaf' },

  // --- Residential: petals under the cherry trees, spring only -------------
  { id: 'forage_sakura_a', name: 'Fallen petals', x: -6.4, z: 57.4, ingredientId: 'sakura', respawnHours: 14, qtyRange: [1, 2], season: 'spring', look: 'petal' },
  { id: 'forage_sakura_b', name: 'Fallen petals', x: 6.4, z: 48.4,  ingredientId: 'sakura', respawnHours: 14, qtyRange: [1, 2], season: 'spring', look: 'petal' },
  { id: 'forage_sakura_c', name: 'Fallen petals', x: 15, z: 60.1, ingredientId: 'sakura', respawnHours: 18, qtyRange: [1, 3], season: 'spring', look: 'petal' },

  // --- Old Market: yuzu tree behind the tea house --------------------------
  { id: 'forage_yuzu_a', name: 'Yuzu tree', x: -42, z: -6.2, ingredientId: 'yuzu', respawnHours: 20, qtyRange: [1, 2], look: 'fruit' },
  { id: 'forage_yuzu_b', name: 'Yuzu tree', x: -46, z: -2.8,  ingredientId: 'yuzu', respawnHours: 24, qtyRange: [1, 1], look: 'fruit' },

  // --- Old Market: herb bed by the shrine at the west end ------------------
  { id: 'forage_herbs_shrine_a', name: 'Herb bed', x: -50, z: 8.5, ingredientId: 'shiso',  respawnHours: 9,  qtyRange: [1, 2], look: 'herb' },
  { id: 'forage_herbs_shrine_b', name: 'Shrine ginger', x: -53, z: 4, ingredientId: 'ginger', respawnHours: 7, qtyRange: [1, 3], look: 'herb' },
  { id: 'forage_herbs_shrine_c', name: 'Wild sesame', x: -47, z: 11.9, ingredientId: 'sesame', respawnHours: 6, qtyRange: [2, 3], look: 'herb' },
];

// ---------------------------------------------------------------------------

const LOOKS = {
  leaf:  { color: 0x5f8f4a, stem: 0x4a6f3a, count: 5, scale: 1.0,  icon: '🍃' },
  petal: { color: 0xf2b8cf, stem: 0xd8a0b8, count: 7, scale: 0.62, icon: '🌸' },
  fruit: { color: 0xf2d24a, stem: 0x6f8f4a, count: 3, scale: 1.15, icon: '🍋' },
  herb:  { color: 0x7fa85a, stem: 0x5a7a42, count: 6, scale: 0.85, icon: '🌿' },
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createForaging(game) {
  const THREE = game.THREE;
  const bus = game.bus;
  const state = game.state;
  const rng = typeof game.rng === 'function' ? game.rng : Math.random;

  /** @type {Map<string, object>} */
  const nodes = new Map();
  let group = null;
  const disposables = [];

  const toast = (text, opts = {}) => {
    if (bus) bus.emit(EV.TOAST, { text, icon: opts.icon || '🌿', tone: opts.tone || '' });
    else UI.toast(text, opts);
  };
  const sfx = (name) => {
    const a = game.audio;
    if (a && typeof a.play === 'function') { try { a.play(name); } catch (e) { /* silent */ } }
  };

  /** Absolute in-game hours since day 1, 00:00 — the respawn clock. */
  function nowHours() {
    const c = game.clock;
    if (!c) return 0;
    const day = Number(c.day) || 1;
    const hour = Number(c.hour) || 0;
    const minute = Number(c.minute) || 0;
    return (day - 1) * 24 + hour + minute / 60;
  }

  function currentSeason() {
    const c = game.clock;
    return seasonForDay(c ? c.day : (state.clock ? state.clock.day : 1));
  }

  function ensureGroup() {
    if (group || !THREE || !game.scene) return group;
    group = new THREE.Group();
    group.name = 'forageNodes';
    game.scene.add(group);
    return group;
  }

  // =========================================================================
  // Visuals — a tiny clump of leaves/fruit, one merged-ish group per node
  // =========================================================================
  function buildNodeMesh(node) {
    if (!THREE) return null;
    const look = LOOKS[node.look] || LOOKS.herb;
    const g = new THREE.Group();

    // Tracked per node so unregisterNode() can free it immediately; the
    // module-level `disposables` list is only the safety net for destroy().
    const own = node.disposables || (node.disposables = []);

    const leafGeo = new THREE.SphereGeometry(0.13 * look.scale, 8, 6);
    const stemGeo = new THREE.CylinderGeometry(0.018, 0.026, 0.26, 5);
    const baseGeo = new THREE.CylinderGeometry(0.20, 0.26, 0.06, 10);
    own.push(leafGeo, stemGeo, baseGeo);

    const leafMat = new THREE.MeshStandardMaterial({ color: look.color, roughness: 0.75 });
    const stemMat = new THREE.MeshStandardMaterial({ color: look.stem, roughness: 0.85 });
    const soilMat = new THREE.MeshStandardMaterial({ color: 0x6b5540, roughness: 0.95 });
    own.push(leafMat, stemMat, soilMat);
    for (const d of own) if (!disposables.includes(d)) disposables.push(d);

    const base = new THREE.Mesh(baseGeo, soilMat);
    base.position.y = 0.03;
    g.add(base);

    for (let i = 0; i < look.count; i++) {
      const a = (i / look.count) * Math.PI * 2 + rng() * 0.5;
      const r = 0.06 + rng() * 0.13;
      const h = 0.18 + rng() * 0.16;
      const stem = new THREE.Mesh(stemGeo, stemMat);
      stem.position.set(Math.cos(a) * r * 0.5, h * 0.5, Math.sin(a) * r * 0.5);
      stem.rotation.z = (rng() - 0.5) * 0.5;
      stem.scale.y = h / 0.26;
      g.add(stem);

      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.set(Math.cos(a) * r, h + 0.04, Math.sin(a) * r);
      leaf.scale.set(1, 0.62 + rng() * 0.3, 1.35);
      leaf.rotation.y = a;
      g.add(leaf);
    }

    const y = (game.world && typeof game.world.groundHeightAt === 'function')
      ? game.world.groundHeightAt(node.x, node.z) : 0;
    g.position.set(node.x, Number.isFinite(y) ? y : 0, node.z);
    g.rotation.y = rng() * Math.PI * 2;
    return g;
  }

  // =========================================================================
  // Gates
  // =========================================================================
  function seasonOk(node) {
    if (!node.season) return true;
    return currentSeason() === node.season;
  }

  function nodeReady(node) {
    if (node.picked) return false;
    if (!seasonOk(node)) return false;
    // Unlock rules on the ingredient still apply — an unknown herb is invisible.
    if (!ingredientAvailable(node.ingredientId, state)) {
      // sakura's unlock is a season rule, which ingredientAvailable ignores;
      // seasonOk above already covers it, so only hard gates land here.
      const ing = ingredient(node.ingredientId);
      const u = ing && ing.unlock;
      if (u && (u.reputation != null || u.quest || u.relationship)) return false;
    }
    return true;
  }

  function setVisible(node, v) {
    if (node.mesh) node.mesh.visible = v;
    if (game.interactions && typeof game.interactions.setEnabled === 'function') {
      game.interactions.setEnabled(node.interactionId, v);
    }
  }

  // =========================================================================
  // Picking
  // =========================================================================
  function pick(nodeId) {
    const node = nodes.get(nodeId);
    if (!node || !nodeReady(node)) return null;

    const ing = ingredient(node.ingredientId);
    const [qmin, qmax] = Array.isArray(node.qtyRange) ? node.qtyRange : [1, 1];
    const lo = Math.max(1, Math.floor(qmin));
    const hi = Math.max(lo, Math.floor(qmax));
    const qty = lo + Math.floor(rng() * (hi - lo + 1));

    const band = Array.isArray(node.quality) ? node.quality : null;
    const baseQ = ing ? ing.quality : 0.7;
    const quality = clamp(
      band ? band[0] + rng() * Math.max(0, band[1] - band[0]) : baseQ - 0.06 + rng() * 0.18,
      0.05, 1,
    );

    const taken = state.addItem(node.ingredientId, qty, { quality, freshness: 1 });
    if (!taken) return null;   // basket full — leave the node standing

    // Cat pounces on it.
    const cat = game.player && game.player.cat;
    if (cat && typeof cat.setAction === 'function') cat.setAction('pounce', { speed: 1.15 });
    sfx('forage');

    node.picked = true;
    node.readyAt = nowHours() + Math.max(0.25, Number(node.respawnHours) || 6);
    setVisible(node, false);

    const xp = 2 + Math.round(quality * 3) + (taken > 1 ? 1 : 0);
    state.addXp(xp);

    const look = LOOKS[node.look] || LOOKS.herb;
    toast(`${ing ? ing.name : node.ingredientId} ×${taken}`, {
      icon: ing ? ing.icon : look.icon, tone: 'good',
    });
    if (bus) bus.emit(EV.ITEM_GAINED, { id: node.ingredientId, qty: taken, quality, freshness: 1, source: 'forage' });

    return { id: node.ingredientId, qty: taken, quality };
  }

  // =========================================================================
  // Registration
  // =========================================================================
  function registerNode(def) {
    if (!def || !def.id) { console.warn('[foraging] registerNode needs an id'); return () => {}; }
    if (nodes.has(def.id)) unregisterNode(def.id);

    const node = {
      respawnHours: 8,
      qtyRange: [1, 2],
      look: 'herb',
      r: 2.0,
      season: null,
      ...def,
      picked: false,
      readyAt: 0,
      mesh: null,
      interactionId: `forage:${def.id}`,
      offInteraction: null,
    };
    nodes.set(node.id, node);

    const parent = ensureGroup();
    if (parent) {
      node.mesh = buildNodeMesh(node);
      if (node.mesh) parent.add(node.mesh);
    }

    if (game.interactions && typeof game.interactions.add === 'function') {
      const ing = ingredient(node.ingredientId);
      node.offInteraction = game.interactions.add({
        id: node.interactionId,
        x: node.x, z: node.z, r: node.r,
        key: 'E',
        priority: 0,
        enabled: () => nodeReady(node),
        label: () => `Pick ${ing ? ing.name : node.ingredientId}`,
        marker: { color: '#7ea36a', height: 0.8 },
        data: { kind: 'forage', nodeId: node.id, ingredientId: node.ingredientId },
        onUse: () => { pick(node.id); },
      });
    }

    setVisible(node, nodeReady(node));
    return () => unregisterNode(node.id);
  }

  function unregisterNode(id) {
    const node = nodes.get(id);
    if (!node) return;
    if (node.offInteraction) { try { node.offInteraction(); } catch (e) { /* silent */ } }
    if (node.mesh && node.mesh.parent) node.mesh.parent.remove(node.mesh);
    for (const d of node.disposables || []) {
      try { if (d && typeof d.dispose === 'function') d.dispose(); } catch (e) { /* silent */ }
      const i = disposables.indexOf(d);
      if (i >= 0) disposables.splice(i, 1);
    }
    if (node.disposables) node.disposables.length = 0;
    node.mesh = null;
    nodes.delete(id);
  }

  function registerDefaults(list = DEFAULT_NODES) {
    for (const n of list) registerNode(n);
    return api;
  }

  // =========================================================================
  // Frame — respawn + gentle idle sway
  // =========================================================================
  let swayT = 0;

  function update(dt) {
    if (!(dt > 0)) dt = 0;
    swayT += dt;
    const hours = nowHours();

    for (const node of nodes.values()) {
      if (node.picked && hours >= node.readyAt) {
        node.picked = false;
        node.readyAt = 0;
      }
      const ready = nodeReady(node);
      if (node.mesh && node.mesh.visible !== ready) setVisible(node, ready);
      else if (game.interactions && typeof game.interactions.setEnabled === 'function' && !node.mesh) {
        game.interactions.setEnabled(node.interactionId, ready);
      }
      if (ready && node.mesh) {
        node.mesh.rotation.z = Math.sin(swayT * 0.9 + node.x * 0.3) * 0.035;
      }
    }
  }

  // =========================================================================
  function destroy() {
    for (const id of Array.from(nodes.keys())) unregisterNode(id);
    for (const d of disposables) {
      try { if (d && typeof d.dispose === 'function') d.dispose(); } catch (e) { /* silent */ }
    }
    disposables.length = 0;
    if (group && group.parent) group.parent.remove(group);
    group = null;
  }

  const api = {
    id: 'foraging',
    registerNode,
    unregisterNode,
    registerDefaults,
    pick,
    update,
    destroy,
    currentSeason,
    get nodes() { return Array.from(nodes.values()); },
    get ready() { return Array.from(nodes.values()).filter(nodeReady); },
  };
  return api;
}

export default createForaging;
