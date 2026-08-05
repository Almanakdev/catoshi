// World interaction registry.
//
// Anything the cat can walk up to and press E on registers here: supplier
// stalls, the cooking counter, NPCs, fishing spots, doors, quest props. One
// registry means one prompt, one priority rule, and no two systems fighting
// over the E key.

import { EV } from './bus.js';
import * as UI from '../ui/kit.js';

export function createInteractions(bus, { defaultRadius = 2.6 } = {}) {
  /** @type {Map<string, object>} */
  const all = new Map();
  let near = null;
  let locked = false;
  let lastPromptText = null;

  /**
   * @param {object} def
   *   id        unique string
   *   x, z      world position
   *   r         reach radius (default 2.6)
   *   label     prompt text, or a function returning it (return null to hide)
   *   key       key hint shown in the prompt (default 'E')
   *   priority  higher wins when several are in range (default 0)
   *   enabled   optional () => boolean
   *   onUse     (ctx) => void
   *   marker    optional { color, height } for the world beacon
   *   data      free-form payload for the consumer
   */
  function add(def) {
    if (!def || !def.id) { console.warn('[interactions] add() needs an id'); return () => {}; }
    all.set(def.id, {
      r: defaultRadius, key: 'E', priority: 0, enabled: () => true, onUse: () => {},
      ...def,
    });
    return () => remove(def.id);
  }

  function remove(id) { all.delete(id); if (near && near.id === id) near = null; }
  function get(id) { return all.get(id) || null; }
  function move(id, x, z) { const it = all.get(id); if (it) { it.x = x; it.z = z; } }
  function setEnabled(id, v) { const it = all.get(id); if (it) it.enabled = () => !!v; }
  function clear() { all.clear(); near = null; }

  /** Suspend prompts + E handling (used during cutscenes, panels, mini-games). */
  function lock(v = true) {
    locked = !!v;
    if (locked) { near = null; UI.prompt(null); lastPromptText = null; }
  }

  function labelOf(it) {
    try {
      const l = typeof it.label === 'function' ? it.label() : it.label;
      return l == null ? null : String(l);
    } catch (err) { console.error('[interactions] label threw for', it.id, err); return null; }
  }

  /** Call every frame with the player's world position. */
  function update(px, pz) {
    if (locked) return null;
    let best = null, bestScore = -Infinity;
    for (const it of all.values()) {
      let ok = true;
      try { ok = it.enabled(); } catch { ok = false; }
      if (!ok) continue;
      const dx = it.x - px, dz = it.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 > it.r * it.r) continue;
      // Priority first, then proximity.
      const score = it.priority * 1000 - d2;
      if (score > bestScore) { bestScore = score; best = it; }
    }
    near = best;
    const text = best ? labelOf(best) : null;
    if (text !== lastPromptText) {
      lastPromptText = text;
      UI.prompt(text, text && best ? best.key : null);
      bus.emit(EV.PROMPT, text ? { text, id: best.id } : null);
    }
    return best;
  }

  /** Fire the nearest interaction. Returns true if something handled it. */
  function use(ctx) {
    if (locked || !near) return false;
    const it = near;
    try {
      it.onUse(ctx, it);
      bus.emit(EV.INTERACT, { kind: it.data && it.data.kind, id: it.id, target: it.data });
      return true;
    } catch (err) {
      console.error('[interactions] onUse threw for', it.id, err);
      UI.toast('Something went wrong there', { icon: '⚠️', tone: 'bad' });
      return false;
    }
  }

  return {
    add, remove, get, move, setEnabled, clear, update, use, lock,
    get near() { return near; },
    get locked() { return locked; },
    get all() { return all; },
    list() { return Array.from(all.values()); },
  };
}
