// UI assembly point.
//
// `createUI(game)` builds the HUD and every panel, owns the single global
// keydown listener, and routes EV.TOAST to the kit's toast(). It also provides
// the panel manager that main.js hangs on `game.panels` — kept here rather than
// in its own module because the manager and the panels are the same concern:
// exactly one thing is modal at a time and the player is never left locked.

import { EV } from '../game/bus.js';
import { injectStyles, toast, scrim as makeScrim } from './kit.js';
import { isTypingInUI } from '../engine/inputGuard.js';

import { createHUD } from './hud.js';
import { createInventoryUI } from './inventoryUI.js';
import { createRecipeBook } from './recipeBook.js';
import { createSupplierUI } from './supplierUI.js';
import { createUpgradeUI } from './upgradeUI.js';
import { createQuestUI } from './questUI.js';
import { createMapUI } from './mapUI.js';
import { createDailySummary } from './dailySummary.js';
import { createSettingsUI } from './settingsUI.js';

/**
 * The shared panel stack.
 *
 * Opening anything switches the game to 'panel' mode and freezes the player;
 * closing the last one gives both back. Every call is defensive: a panel that
 * throws, a `game.player` that does not exist yet, or a double close must never
 * leave the player locked out of their own game.
 */
export function createPanelManager(game) {
  /** @type {Map<string, object>} */
  const registry = new Map();
  /** ids in open order; the last one is "the top panel". */
  const stack = [];
  let scrim = null;
  let destroyed = false;

  function emit(evt, payload) {
    try { if (game.bus) game.bus.emit(evt, payload); } catch (err) { console.error('[panels] emit failed', err); }
  }

  function ensureScrim() {
    if (scrim) return scrim;
    injectStyles();
    scrim = makeScrim(() => {
      const top = stack[stack.length - 1];
      if (top) close(top);
    });
    scrim.el.style.zIndex = '19';
    return scrim;
  }

  function lockPlayer(v) {
    const pl = game.player;
    if (pl && typeof pl.lock === 'function') {
      try { pl.lock(v); } catch (err) { console.error('[panels] player.lock threw', err); }
    }
    const ix = game.interactions;
    if (ix && typeof ix.lock === 'function') {
      try { ix.lock(v); } catch (err) { console.error('[panels] interactions.lock threw', err); }
    }
  }

  function setMode(mode) {
    if (typeof game.setMode === 'function') {
      try { game.setMode(mode); } catch (err) { console.error('[panels] setMode threw', err); }
    }
  }

  function enterModal() {
    ensureScrim().show();
    setMode('panel');
    lockPlayer(true);
  }

  function exitModal() {
    if (scrim) scrim.hide();
    setMode('explore');
    lockPlayer(false);
  }

  function register(id, api) {
    if (!id || !api) { console.warn('[panels] register() needs an id and an api'); return api; }
    if (registry.has(id)) console.warn(`[panels] "${id}" registered twice — replacing`);
    registry.set(id, api);
    return api;
  }

  function isOpen(id) {
    if (id == null) return stack.length > 0;
    return stack.indexOf(id) >= 0;
  }

  function open(id, payload) {
    if (destroyed) return undefined;
    const api = registry.get(id);
    if (!api) { console.warn(`[panels] no panel registered as "${id}"`); return undefined; }
    if (stack.indexOf(id) >= 0) {
      // Already open — let it refresh with the new payload, keep stack order.
      try { return api.open(payload); } catch (err) { console.error(`[panels] "${id}".open threw`, err); return undefined; }
    }

    const wasEmpty = stack.length === 0;
    stack.push(id);
    if (wasEmpty) enterModal();

    let result;
    try {
      result = api.open(payload);
    } catch (err) {
      console.error(`[panels] "${id}".open threw`, err);
      // Roll the stack back so a broken panel cannot strand the player.
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
      if (stack.length === 0) exitModal();
      return undefined;
    }
    emit(EV.PANEL_OPEN, { id });
    return result;
  }

  function close(id) {
    if (id == null) { const top = stack[stack.length - 1]; if (top) close(top); return; }
    const i = stack.indexOf(id);
    const api = registry.get(id);
    if (i < 0) {
      // Not on the stack but maybe still showing (opened directly) — tidy up.
      if (api && api.isOpen) { try { api.close(); } catch (err) { console.error(err); } }
      return;
    }
    stack.splice(i, 1);
    if (api) {
      try { api.close(); } catch (err) { console.error(`[panels] "${id}".close threw`, err); }
    }
    emit(EV.PANEL_CLOSE, { id });
    if (stack.length === 0) exitModal();
  }

  function closeAll() {
    while (stack.length) close(stack[stack.length - 1]);
    // Belt and braces: anything that thinks it is open but never made the stack.
    for (const [pid, api] of registry) {
      if (api && api.isOpen) { try { api.close(); } catch (err) { console.error(`[panels] "${pid}".close threw`, err); } }
    }
    exitModal();
  }

  function get(id) { return registry.get(id) || null; }

  function destroy() {
    destroyed = true;
    closeAll();
    for (const [pid, api] of registry) {
      if (api && typeof api.destroy === 'function') {
        try { api.destroy(); } catch (err) { console.error(`[panels] "${pid}".destroy threw`, err); }
      }
    }
    registry.clear();
    if (scrim) { scrim.el.remove(); scrim = null; }
  }

  return {
    register, open, close, closeAll, isOpen, get, destroy,
    get openIds() { return stack.slice(); },
    get registered() { return Array.from(registry.keys()); },
    /** Fan out per-frame ticks to whichever panels asked for them. */
    update(dt) {
      for (const id of stack) {
        const api = registry.get(id);
        if (api && typeof api.update === 'function') {
          try { api.update(dt); } catch (err) { console.error(`[panels] "${id}".update threw`, err); }
        }
      }
    },
  };
}

/** id opened by each shortcut key (lowercased `event.key`). */
const SHORTCUTS = {
  i: 'inventory',
  r: 'recipes',
  q: 'quests',
  m: 'map',
  u: 'upgrades',
};

/** Modes in which panel shortcuts are allowed at all. */
const INTERACTIVE_MODES = new Set(['explore', 'panel']);

export function createUI(game) {
  injectStyles();

  // main.js normally assigns this before constructing the UI, but building it
  // here keeps `createUI(game)` usable on its own (tests, editor previews).
  if (!game.panels || typeof game.panels.register !== 'function') {
    game.panels = createPanelManager(game);
  }
  const panels = game.panels;

  const offs = [];
  const hud = createHUD(game);

  const built = {
    inventory: createInventoryUI(game),
    recipes: createRecipeBook(game),
    supplier: createSupplierUI(game),
    upgrades: createUpgradeUI(game),
    quests: createQuestUI(game),
    map: createMapUI(game),
    daily: createDailySummary(game),
    settings: createSettingsUI(game),
  };

  // ------------------------------------------------------------- toasts
  offs.push(game.bus.on(EV.TOAST, (p) => {
    if (!p || !p.text) return;
    toast(p.text, { icon: p.icon, tone: p.tone, ms: p.ms });
  }));

  // ------------------------------------------------------------ keyboard
  function onKeyDown(ev) {
    if (ev.repeat) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (isTypingInUI()) return;

    const mode = game.mode;
    // Cooking, fishing, dialogue and cutscenes own their own keys — including
    // Esc, which is their abort. Never steal it from them.
    if (mode && !INTERACTIVE_MODES.has(mode)) return;

    if (ev.key === 'Escape') {
      ev.preventDefault();
      const openNow = panels.openIds;
      if (openNow.length) panels.close(openNow[openNow.length - 1]);
      else panels.open('settings');
      return;
    }

    // Tab is deliberately untouched: it belongs to the browser's focus order.
    if (ev.key === 'Tab') return;

    const key = typeof ev.key === 'string' ? ev.key.toLowerCase() : '';
    const id = SHORTCUTS[key];
    if (!id) return;
    ev.preventDefault();
    if (panels.isOpen(id)) panels.close(id);
    else panels.open(id);
  }
  window.addEventListener('keydown', onKeyDown);

  // --------------------------------------------------------------- frame
  function update(dt) {
    hud.update(dt);
    panels.update(dt);
  }

  function destroy() {
    window.removeEventListener('keydown', onKeyDown);
    for (const un of offs) { try { un(); } catch { /* ignore */ } }
    offs.length = 0;
    hud.destroy();
    if (typeof panels.destroy === 'function') panels.destroy();
    else for (const k in built) { try { built[k].destroy(); } catch { /* ignore */ } }
  }

  return {
    hud,
    panels,
    ui: built,
    update,
    destroy,
    /** The map main.js can print in a help overlay. */
    shortcuts: { ...SHORTCUTS, Escape: 'close top panel / settings' },
  };
}
