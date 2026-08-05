// Upgrade catalogue.
//
// Every upgrade is a purchasable, levelled bonus. state.js reads owned levels
// out of `state.shop.upgrades` and sums effects with upgradeValue(key), so the
// ONLY contract that matters here is the effect key names below — gameplay code
// looks them up by string.
//
// Effect keys (values are ADDITIVE per level):
//   inventory      + basket slots
//   stamina        + max stamina
//   timingZone     + fraction added to mini-game success zones
//   sliceSpeed     + fraction, more forgiving slice strokes
//   freshness      0..1 fraction reducing freshness loss
//   tipChance      + fraction
//   tipAmount      + fraction
//   queueSize      + customers allowed to wait
//   cookSpeed      + fraction faster cooking
//   fishingLuck    + fraction
//   deliveryTime   + seconds of grace on deliveries
//   dailySpecials  + extra daily special slots
//   prepQuality    + flat quality bonus 0..1
//   buyDiscount    + fraction off supplier prices

export const UPGRADE_CATEGORIES = {
  kitchen: { name: 'Kitchen', icon: '🔪', color: '#c8503f' },
  shop:    { name: 'Shop',    icon: '🏪', color: '#4e8fa8' },
  cat:     { name: 'Cat',     icon: '🐾', color: '#e0a24a' },
  menu:    { name: 'Menu',    icon: '📋', color: '#7ea36a' },
};

export const UPGRADES = [
  // ------------------------------------------------------------------ kitchen
  {
    id: 'kitchen_knife',
    category: 'kitchen',
    name: 'Better Knife',
    icon: '🔪',
    desc: 'A properly forged yanagiba. Cleaner cuts, and the fish stops fighting back.',
    maxLevel: 4,
    cost: [180, 520, 1400, 3600],
    requires: null,
    effects: { sliceSpeed: 0.07, prepQuality: 0.02 },
  },
  {
    id: 'cutting_board',
    category: 'kitchen',
    name: 'Hinoki Cutting Board',
    icon: '🪵',
    desc: 'Soft cypress that holds the blade instead of skidding it. Steadier hands, wider margins.',
    maxLevel: 3,
    cost: [150, 420, 1100],
    requires: null,
    effects: { sliceSpeed: 0.05, timingZone: 0.02 },
  },
  {
    id: 'rice_cooker',
    category: 'kitchen',
    name: 'Pro Rice Cooker',
    icon: '🍚',
    desc: 'Holds temperature to the degree, so every batch of shari comes out the same.',
    maxLevel: 4,
    cost: [260, 700, 1800, 4200],
    requires: { shopTier: 2 },
    effects: { cookSpeed: 0.08, prepQuality: 0.025 },
  },
  {
    id: 'kitchen_chiller',
    category: 'kitchen',
    name: 'Prep Chiller',
    icon: '🧊',
    desc: 'A cold drawer under the board. Fish keeps its edge through the lunch rush.',
    maxLevel: 3,
    cost: [400, 1200, 3000],
    requires: { shopTier: 2 },
    effects: { freshness: 0.10 },
  },
  {
    id: 'grill_station',
    category: 'kitchen',
    name: 'Charcoal Grill',
    icon: '🔥',
    desc: 'Binchotan and a wire rack. Sears eel and aburi in seconds instead of minutes.',
    maxLevel: 3,
    cost: [900, 2400, 5600],
    requires: { shopTier: 3, level: 6 },
    effects: { cookSpeed: 0.06, timingZone: 0.03 },
  },

  // --------------------------------------------------------------------- shop
  {
    id: 'shop_counter',
    category: 'shop',
    name: 'Longer Counter',
    icon: '🪑',
    desc: 'More elbow room in front of you means more cats waiting patiently in front of that.',
    maxLevel: 4,
    cost: [300, 900, 2200, 5000],
    requires: null,
    effects: { queueSize: 1, tipChance: 0.03 },
  },
  {
    id: 'shop_seats',
    category: 'shop',
    name: 'Extra Seats',
    icon: '💺',
    desc: 'Cushioned stools. People who sit down order a second plate.',
    maxLevel: 4,
    cost: [350, 950, 2400, 5600],
    requires: { shopTier: 2 },
    effects: { queueSize: 1, tipAmount: 0.03 },
  },
  {
    id: 'shop_sign',
    category: 'shop',
    name: 'Painted Sign',
    icon: '🪧',
    desc: 'A name people can read from the corner — and suppliers start taking your calls.',
    maxLevel: 3,
    cost: [220, 700, 1900],
    requires: null,
    effects: { tipChance: 0.04, buyDiscount: 0.03 },
  },
  {
    id: 'shop_decor',
    category: 'shop',
    name: 'Interior Decor',
    icon: '🎐',
    desc: 'Noren curtains, a paper lamp, one very smug ceramic cat. People linger, and linger costs money.',
    maxLevel: 4,
    cost: [260, 800, 2100, 4800],
    requires: null,
    effects: { tipAmount: 0.06, tipChance: 0.02 },
  },
  {
    id: 'chiller_display',
    category: 'shop',
    name: 'Chilled Display Case',
    icon: '🧊',
    desc: 'Glass-fronted, lit from below. The fish sells itself before you touch it.',
    maxLevel: 3,
    cost: [1200, 3400, 7200],
    requires: { shopTier: 3 },
    effects: { freshness: 0.06, tipAmount: 0.05 },
  },
  {
    id: 'shop_awning',
    category: 'shop',
    name: 'Street Awning',
    icon: '⛱️',
    desc: 'Shade for the queue and shelter from the rain. Nobody wanders off mid-wait anymore.',
    maxLevel: 2,
    cost: [480, 1500],
    requires: null,
    effects: { queueSize: 1, freshness: 0.03 },
  },

  // ---------------------------------------------------------------------- cat
  {
    id: 'running_shoes',
    category: 'cat',
    name: 'Running Shoes',
    icon: '👟',
    desc: 'Grippy little soles. Deliveries stop being a race you lose on the stairs.',
    maxLevel: 3,
    cost: [200, 620, 1600],
    requires: null,
    effects: { stamina: 15, deliveryTime: 8 },
  },
  {
    id: 'big_basket',
    category: 'cat',
    name: 'Bigger Basket',
    icon: '🧺',
    desc: 'Woven wide and deep. One market trip instead of three.',
    maxLevel: 4,
    cost: [180, 540, 1500, 3800],
    requires: null,
    effects: { inventory: 8 },
  },
  {
    id: 'lucky_charm',
    category: 'cat',
    name: 'Lucky Charm',
    icon: '🧿',
    desc: 'A shrine omamori on your collar. Traders soften, fish surface, tips appear.',
    maxLevel: 3,
    cost: [900, 2600, 6000],
    requires: { reputation: 60 },
    effects: { tipChance: 0.05, fishingLuck: 0.06, buyDiscount: 0.02 },
  },
  {
    id: 'fishing_rod',
    category: 'cat',
    name: 'Fishing Rod',
    icon: '🎣',
    desc: 'From a bent stick to a rod Kaito would admit to owning.',
    maxLevel: 4,
    cost: [350, 1000, 2600, 6400],
    requires: { quest: 'q02_first_catch_intro' },
    effects: { fishingLuck: 0.09 },
  },
  {
    id: 'chef_apron',
    category: 'cat',
    name: "Chef's Apron",
    icon: '🥼',
    desc: 'Pockets in the right places and a towel loop. You work longer and drop less.',
    maxLevel: 3,
    cost: [240, 780, 2000],
    requires: null,
    effects: { stamina: 10, prepQuality: 0.02 },
  },

  // --------------------------------------------------------------------- menu
  {
    id: 'daily_special',
    category: 'menu',
    name: 'Daily Special Slot',
    icon: '📌',
    desc: 'Chalk one dish on the board each morning. Regulars come back just to see what it is.',
    maxLevel: 3,
    cost: [1400, 4000, 9000],
    requires: { shopTier: 2, reputation: 45 },
    effects: { dailySpecials: 1, tipAmount: 0.03 },
  },
  {
    id: 'tasting_menu',
    category: 'menu',
    name: 'Omakase Tasting Menu',
    icon: '🍱',
    desc: 'No choosing. They sit, they trust you, they pay accordingly.',
    maxLevel: 2,
    cost: [6000, 15000],
    requires: { shopTier: 4, reputation: 200, quest: 'q09_lost_page' },
    effects: { dailySpecials: 1, tipAmount: 0.12, prepQuality: 0.03 },
  },
];

/** id -> upgrade */
export const UPGRADE_INDEX = Object.create(null);
for (const u of UPGRADES) UPGRADE_INDEX[u.id] = u;

export function upgrade(id) { return UPGRADE_INDEX[id] || null; }

/**
 * Coin price to buy the NEXT level.
 * @returns {number|null} null when already at maxLevel.
 */
export function upgradeCost(u, currentLevel = 0) {
  const up = typeof u === 'string' ? UPGRADE_INDEX[u] : u;
  if (!up) return null;
  const lvl = Math.max(0, Math.floor(currentLevel || 0));
  if (lvl >= up.maxLevel) return null;
  const costs = up.cost || [];
  const c = costs[lvl];
  return c == null ? (costs[costs.length - 1] ?? null) : c;
}

/** Does the run satisfy an upgrade's `requires` block? Never throws. */
export function upgradeUnlocked(u, state) {
  const up = typeof u === 'string' ? UPGRADE_INDEX[u] : u;
  if (!up) return false;
  const req = up.requires;
  if (!req) return true;
  if (!state) return false;
  if (req.shopTier != null && ((state.shop && state.shop.tier) || 0) < req.shopTier) return false;
  if (req.reputation != null && (state.reputation || 0) < req.reputation) return false;
  if (req.level != null && (state.level || 0) < req.level) return false;
  if (req.quest) {
    const done = typeof state.questDone === 'function' ? state.questDone(req.quest) : false;
    if (!done) return false;
  }
  return true;
}

/** Level the player currently owns, defensively. */
function ownedLevel(state, id) {
  if (!state) return 0;
  if (typeof state.upgradeLevel === 'function') return state.upgradeLevel(id) || 0;
  const owned = state.shop && state.shop.upgrades;
  return (owned && owned[id]) || 0;
}

/** Everything buyable right now: requirements met and not yet maxed. */
export function upgradesAvailable(state) {
  return UPGRADES.filter((u) => upgradeUnlocked(u, state) && ownedLevel(state, u.id) < u.maxLevel);
}

/** Summed bonus for one effect key across every owned upgrade level. */
export function effectTotal(state, key) {
  let sum = 0;
  for (const u of UPGRADES) {
    const per = u.effects && u.effects[key];
    if (per == null) continue;
    const lvl = ownedLevel(state, u.id);
    if (lvl > 0) sum += per * lvl;
  }
  return sum;
}

/** Coins needed to take an upgrade from its current level to max. */
export function upgradeRemainingCost(u, currentLevel = 0) {
  const up = typeof u === 'string' ? UPGRADE_INDEX[u] : u;
  if (!up) return 0;
  let total = 0;
  for (let l = Math.max(0, Math.floor(currentLevel)); l < up.maxLevel; l++) {
    total += upgradeCost(up, l) || 0;
  }
  return total;
}

/** Upgrades grouped by category id, for the shop panel. */
export function upgradesByCategory(cat) {
  return UPGRADES.filter((u) => u.category === cat);
}
