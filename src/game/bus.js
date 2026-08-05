// Tiny synchronous event bus. Every gameplay system talks through this instead
// of holding references to each other, which keeps modules independently
// testable and stops main.js turning into a spaghetti hub.

export function createBus() {
  const map = new Map();

  function on(evt, cb) {
    if (typeof cb !== 'function') return () => {};
    let set = map.get(evt);
    if (!set) { set = new Set(); map.set(evt, set); }
    set.add(cb);
    return () => off(evt, cb);
  }

  function once(evt, cb) {
    const un = on(evt, (p) => { un(); cb(p); });
    return un;
  }

  function off(evt, cb) {
    const set = map.get(evt);
    if (set) set.delete(cb);
  }

  function emit(evt, payload) {
    const set = map.get(evt);
    if (!set || set.size === 0) return;
    // Copy so handlers can unsubscribe during dispatch without skipping peers.
    for (const cb of Array.from(set)) {
      try { cb(payload); } catch (err) { console.error(`[bus] handler for "${evt}" threw`, err); }
    }
  }

  function clear() { map.clear(); }

  return { on, once, off, emit, clear };
}

/**
 * Canonical event names. Keep them here so a typo is a missing import rather
 * than a silently dead listener.
 */
export const EV = {
  // economy / progression
  COINS: 'coins',                 // { coins, delta, reason }
  REPUTATION: 'reputation',       // { reputation, delta, tier }
  XP: 'xp',                       // { xp, level, leveledUp }
  STAMINA: 'stamina',             // { stamina, max }
  RELATIONSHIP: 'relationship',   // { npcId, level, delta }

  // inventory
  INVENTORY: 'inventory',         // { items }
  ITEM_GAINED: 'item-gained',     // { id, qty, quality, freshness }
  ITEM_LOST: 'item-lost',         // { id, qty }

  // time
  TIME: 'time',                   // { day, hour, minute, phase }
  DAY_START: 'day-start',         // { day }
  DAY_END: 'day-end',             // { day, summary }
  DAY_SUMMARY: 'day-summary',     // { day, earned, spent, served, failed, tips, rep, best }
  PHASE: 'phase',                 // { phase, prev }  morning|day|evening|night

  // restaurant
  ORDER_NEW: 'order-new',         // { order }
  ORDER_SERVED: 'order-served',   // { order, quality, pay, tip }
  ORDER_FAILED: 'order-failed',   // { order, reason }
  COOK_START: 'cook-start',       // { recipeId }
  COOK_DONE: 'cook-done',         // { recipeId, quality, score }
  SHOP_UPGRADED: 'shop-upgraded', // { id, tier }

  // world
  DISTRICT_ENTER: 'district-enter',   // { id, name }
  DISTRICT_UNLOCK: 'district-unlock', // { id, name }
  INTERACT: 'interact',               // { kind, target }
  FISH_CAUGHT: 'fish-caught',         // { id, quality, size }
  DELIVERY_DONE: 'delivery-done',     // { missionId, onTime, quality }

  // quests
  QUEST_OFFERED: 'quest-offered',     // { quest }
  QUEST_STARTED: 'quest-started',     // { quest }
  QUEST_PROGRESS: 'quest-progress',   // { quest, objective }
  QUEST_DONE: 'quest-done',           // { quest, rewards }
  RECIPE_UNLOCKED: 'recipe-unlocked', // { id, name }

  // ui
  TOAST: 'toast',                 // { text, icon, tone }
  PROMPT: 'prompt',               // { text } | null
  PANEL_OPEN: 'panel-open',       // { id }
  PANEL_CLOSE: 'panel-close',     // { id }
  DIALOGUE: 'dialogue',           // { npcId, lines, onDone }
  SAVE: 'save',                   // { slot, ok }
  LOAD: 'load',                   // { slot, ok }
};
