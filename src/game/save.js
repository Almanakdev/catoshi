// Versioned save system with autosave, manual slots and safe fallback.
//
// Failure policy: a corrupt or future-version blob is never loaded into the
// live state. It is quarantined under a `.broken` key so nothing is lost, and
// the caller gets `{ ok:false, reason }` so it can start a fresh run instead of
// crashing the game.

import { EV } from './bus.js';
import { SAVE_VERSION } from './state.js';

const PREFIX = 'catushi.save.';
const SETTINGS_KEY = 'catushi.settings';
// The game shipped as "Sushi Paws" / "Catushi" before CATOSHI. Saves
// written under the old namespace are adopted once, on first run, so a rename
// never costs anybody their shop.
const LEGACY_PREFIX = 'sushipaws.save.';
const LEGACY_SETTINGS = 'sushipaws.settings';
const AUTOSAVE_SLOT = 'auto';
export const SLOTS = ['auto', 'slot1', 'slot2', 'slot3'];

function storage() {
  try {
    const t = '__sp_probe__';
    window.localStorage.setItem(t, '1');
    window.localStorage.removeItem(t);
    return window.localStorage;
  } catch {
    return null; // private mode / disabled storage — game still runs, just no persistence
  }
}

/**
 * Migration chain. Each entry takes the blob at version N and returns N+1.
 * Add a new function whenever SAVE_VERSION is bumped; never edit an old one.
 */
const MIGRATIONS = {
  // 1: (d) => { d.newField = 0; return d; },
};

function migrate(blob) {
  let d = blob;
  let v = Number(d.version) || 0;
  while (v < SAVE_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) { d.version = SAVE_VERSION; break; } // no-op gaps are fine
    d = step(d);
    v = Number(d.version) || v + 1;
    d.version = v;
  }
  return d;
}

/** One-time adoption of pre-rename saves. Copies, never deletes. */
function adoptLegacy(store) {
  if (!store) return;
  try {
    if (store.getItem('catushi.migrated')) return;
    for (const slot of SLOTS) {
      const old = store.getItem(LEGACY_PREFIX + slot);
      if (old && !store.getItem(PREFIX + slot)) store.setItem(PREFIX + slot, old);
    }
    const oldSet = store.getItem(LEGACY_SETTINGS);
    if (oldSet && !store.getItem(SETTINGS_KEY)) store.setItem(SETTINGS_KEY, oldSet);
    store.setItem('catushi.migrated', '1');
  } catch { /* a failed migration must never block a new game */ }
}

export function createSaveSystem(state, bus, { autosaveSeconds = 90 } = {}) {
  const store = storage();
  adoptLegacy(store);
  let sinceAuto = 0;
  let lastError = null;

  function key(slot) { return PREFIX + slot; }

  function listSlots() {
    return SLOTS.map((slot) => {
      const raw = store && store.getItem(key(slot));
      if (!raw) return { slot, empty: true };
      try {
        const d = JSON.parse(raw);
        return {
          slot, empty: false,
          version: d.version,
          day: d.clock ? d.clock.day : 1,
          hour: d.clock ? d.clock.hour : 8,
          coins: d.coins || 0,
          reputation: d.reputation || 0,
          tier: d.shop ? d.shop.tier : 1,
          savedAt: d.savedAt || 0,
          broken: false,
        };
      } catch {
        return { slot, empty: false, broken: true };
      }
    });
  }

  function save(slot = AUTOSAVE_SLOT) {
    if (!store) { lastError = 'no-storage'; bus.emit(EV.SAVE, { slot, ok: false, reason: 'no-storage' }); return false; }
    try {
      const blob = state.toJSON();
      blob.savedAt = Date.now();
      store.setItem(key(slot), JSON.stringify(blob));
      lastError = null;
      bus.emit(EV.SAVE, { slot, ok: true });
      if (slot !== AUTOSAVE_SLOT) bus.emit(EV.TOAST, { text: 'Game saved', icon: '💾', tone: 'good' });
      return true;
    } catch (err) {
      lastError = String(err && err.message || err);
      console.error('[save] failed', err);
      bus.emit(EV.SAVE, { slot, ok: false, reason: lastError });
      bus.emit(EV.TOAST, { text: 'Could not save', icon: '⚠️', tone: 'bad' });
      return false;
    }
  }

  function load(slot = AUTOSAVE_SLOT) {
    if (!store) return { ok: false, reason: 'no-storage' };
    const raw = store.getItem(key(slot));
    if (!raw) return { ok: false, reason: 'empty' };
    let blob;
    try {
      blob = JSON.parse(raw);
    } catch (err) {
      quarantine(slot, raw, 'parse');
      return { ok: false, reason: 'corrupt' };
    }
    if (!blob || typeof blob !== 'object' || !blob.clock) {
      quarantine(slot, raw, 'shape');
      return { ok: false, reason: 'corrupt' };
    }
    if (Number(blob.version) > SAVE_VERSION) {
      // Save is from a newer build — refuse rather than silently dropping fields.
      return { ok: false, reason: 'future-version' };
    }
    try {
      state.fromJSON(migrate(blob));
      bus.emit(EV.LOAD, { slot, ok: true });
      return { ok: true, data: state.data };
    } catch (err) {
      console.error('[save] migrate/apply failed', err);
      quarantine(slot, raw, 'apply');
      return { ok: false, reason: 'corrupt' };
    }
  }

  function quarantine(slot, raw, why) {
    try { store.setItem(key(slot) + '.broken.' + why, raw); store.removeItem(key(slot)); } catch { /* ignore */ }
    bus.emit(EV.TOAST, { text: 'Save file was damaged — kept a copy', icon: '⚠️', tone: 'bad' });
  }

  function erase(slot) {
    if (!store) return false;
    try { store.removeItem(key(slot)); return true; } catch { return false; }
  }

  function hasAny() { return listSlots().some((s) => !s.empty && !s.broken); }

  // Settings live outside the save file so they survive a New Game.
  function saveSettings() {
    if (!store) return;
    try { store.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch { /* ignore */ }
  }
  function loadSettings() {
    if (!store) return;
    try {
      const raw = store.getItem(SETTINGS_KEY);
      if (!raw) return;
      Object.assign(state.settings, JSON.parse(raw));
    } catch { /* ignore */ }
  }

  function update(dt) {
    sinceAuto += dt;
    if (sinceAuto >= autosaveSeconds) { sinceAuto = 0; save(AUTOSAVE_SLOT); }
  }

  return {
    save, load, erase, listSlots, hasAny, update,
    saveSettings, loadSettings,
    get lastError() { return lastError; },
    AUTOSAVE_SLOT,
  };
}
