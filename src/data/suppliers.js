// Shops the player buys from. Pure data — no THREE, no DOM.
//
// `stock[].price` overrides the catalogue price in ingredients.js, so a stall
// can be cheap on the things it actually grows or lands.
// `daily` is how many units sit on the table each morning, `restock` how many
// come back when the day rolls over.
//
// Availability is tier-gated: an ingredient named in any tier's `unlock` list
// can only be bought once the player has reached that tier. Anything in
// `stock` that no tier mentions is on sale from day one.
//
// Day-one balance: rice 6 at yuki_stall + salmon 16 at mikan_catch = 22 for a
// salmon_nigiri that sells for 42, so 120 starting coins turn a profit.

import { ingredient } from './ingredients.js';

export const SUPPLIERS = [
  {
    id: 'yuki_stall',
    name: "Yuki's Rice & Greens",
    npc: 'yuki',
    district: 'old_market',
    icon: '🍚',
    color: '#e8dcc0',
    x: -58, z: 14, yaw: Math.PI,
    blurb: 'A tidy stall of rice sacks and washed vegetables, everything sorted by size.',
    stock: [
      { id: 'rice',     price: 6,  daily: 12, restock: 12 },
      { id: 'cucumber', price: 5,  daily: 10, restock: 10 },
      { id: 'daikon',   price: 6,  daily: 8,  restock: 8 },
      { id: 'avocado',  price: 9,  daily: 6,  restock: 6 },
      { id: 'vinegar',  price: 4,  daily: 8,  restock: 8 },
      { id: 'ginger',   price: 6,  daily: 6,  restock: 6 },
      { id: 'sesame',   price: 4,  daily: 8,  restock: 8 },
      { id: 'shiso',    price: 8,  daily: 4,  restock: 4 },
      { id: 'yuzu',     price: 26, daily: 2,  restock: 2 },
      { id: 'sakura',   price: 30, daily: 2,  restock: 2 },
    ],
    openHour: 7,
    closeHour: 18,
    tiers: [
      { at: 0,  discount: 0,    extraStock: 0, unlock: [] },
      { at: 25, discount: 0.07, extraStock: 2, unlock: ['shiso'] },
      { at: 50, discount: 0.14, extraStock: 4, unlock: ['yuzu'] },
      { at: 80, discount: 0.22, extraStock: 8, unlock: ['sakura'] },
    ],
  },
  {
    id: 'market_pantry',
    name: "Taro's Pantry",
    npc: 'taro',
    district: 'old_market',
    icon: '🧺',
    color: '#c8a24a',
    x: -46, z: -6, yaw: -Math.PI / 2,
    blurb: 'Dry goods, sauces and stacked nori tins, with a price board that never changes.',
    stock: [
      { id: 'nori',      price: 5,  daily: 12, restock: 12 },
      { id: 'egg',       price: 5,  daily: 12, restock: 12 },
      { id: 'soy_sauce', price: 6,  daily: 10, restock: 10 },
      { id: 'vinegar',   price: 4,  daily: 10, restock: 10 },
      { id: 'tofu',      price: 7,  daily: 8,  restock: 8 },
      { id: 'sesame',    price: 4,  daily: 10, restock: 10 },
      { id: 'wasabi',    price: 9,  daily: 6,  restock: 6 },
      { id: 'ginger',    price: 6,  daily: 6,  restock: 6 },
      { id: 'yuzu',      price: 27, daily: 2,  restock: 2 },
    ],
    openHour: 8,
    closeHour: 19,
    tiers: [
      { at: 0,  discount: 0,    extraStock: 0, unlock: [] },
      { at: 25, discount: 0.07, extraStock: 2, unlock: ['tofu', 'sesame'] },
      { at: 50, discount: 0.14, extraStock: 4, unlock: ['wasabi', 'ginger'] },
      { at: 80, discount: 0.22, extraStock: 8, unlock: ['yuzu'] },
    ],
  },
  {
    id: 'mikan_catch',
    name: "Mikan's Morning Catch",
    npc: 'mikan',
    district: 'fish_harbor',
    icon: '🐟',
    color: '#f08a63',
    x: -16, z: -120, yaw: 0,
    blurb: 'A plank table on the quay, iced boxes, and whatever came off the boat at dawn.',
    stock: [
      { id: 'salmon',    price: 16, daily: 8, restock: 8 },
      { id: 'mackerel',  price: 11, daily: 8, restock: 8 },
      { id: 'shrimp',    price: 14, daily: 6, restock: 6 },
      { id: 'sea_bream', price: 28, daily: 3, restock: 3 },
      { id: 'roe',       price: 36, daily: 2, restock: 2 },
      { id: 'toro',      price: 74, daily: 1, restock: 1 },
    ],
    openHour: 5,
    closeHour: 16,
    tiers: [
      { at: 0,  discount: 0,    extraStock: 0, unlock: [] },
      { at: 25, discount: 0.07, extraStock: 2, unlock: ['sea_bream'] },
      { at: 50, discount: 0.14, extraStock: 4, unlock: ['roe'] },
      { at: 80, discount: 0.22, extraStock: 8, unlock: ['toro'] },
    ],
  },
  {
    id: 'harbor_auction',
    name: 'Harbour Auction Floor',
    npc: 'goro',
    district: 'fish_harbor',
    icon: '⚓',
    color: '#4e8fa8',
    x: 18, z: -126, yaw: Math.PI / 2,
    blurb: 'Concrete, meltwater and a bell. The grading here is brutal and the fish is the best in the city.',
    stock: [
      { id: 'tuna',      price: 22, daily: 6, restock: 6 },
      { id: 'scallop',   price: 26, daily: 5, restock: 5 },
      { id: 'sea_bream', price: 30, daily: 4, restock: 4 },
      { id: 'eel',       price: 34, daily: 3, restock: 3 },
      { id: 'roe',       price: 38, daily: 3, restock: 3 },
      { id: 'uni',       price: 64, daily: 2, restock: 2 },
      { id: 'toro',      price: 78, daily: 1, restock: 1 },
    ],
    openHour: 3,
    closeHour: 18,
    tiers: [
      { at: 0,  discount: 0,    extraStock: 0, unlock: [] },
      { at: 25, discount: 0.07, extraStock: 2, unlock: ['sea_bream'] },
      { at: 50, discount: 0.14, extraStock: 4, unlock: ['eel', 'roe'] },
      { at: 80, discount: 0.22, extraStock: 8, unlock: ['uni', 'toro'] },
    ],
  },
  {
    id: 'konbini',
    name: 'Neko-Mart 24H',
    npc: 'beni',
    district: 'downtown',
    icon: '🏪',
    color: '#3f7fa8',
    // Never closes — the emergency option when a stall shut before you got there.
    x: 60, z: 10, yaw: Math.PI,
    blurb: 'Everything, any hour, at a price that quietly punishes bad planning.',
    stock: [
      { id: 'rice',      price: 8,  daily: 10, restock: 10 },
      { id: 'nori',      price: 7,  daily: 10, restock: 10 },
      { id: 'egg',       price: 7,  daily: 10, restock: 10 },
      { id: 'cucumber',  price: 7,  daily: 8,  restock: 8 },
      { id: 'daikon',    price: 8,  daily: 6,  restock: 6 },
      { id: 'avocado',   price: 12, daily: 6,  restock: 6 },
      { id: 'tofu',      price: 9,  daily: 6,  restock: 6 },
      { id: 'vinegar',   price: 6,  daily: 8,  restock: 8 },
      { id: 'soy_sauce', price: 8,  daily: 8,  restock: 8 },
      { id: 'wasabi',    price: 12, daily: 6,  restock: 6 },
      { id: 'ginger',    price: 8,  daily: 6,  restock: 6 },
      { id: 'sesame',    price: 6,  daily: 8,  restock: 8 },
      { id: 'salmon',    price: 22, daily: 4,  restock: 4 },
      { id: 'mackerel',  price: 15, daily: 4,  restock: 4 },
      { id: 'shrimp',    price: 19, daily: 3,  restock: 3 },
      { id: 'tuna',      price: 30, daily: 3,  restock: 3 },
      { id: 'scallop',   price: 34, daily: 2,  restock: 2 },
    ],
    openHour: 0,
    closeHour: 24,
    tiers: [
      { at: 0,  discount: 0,    extraStock: 0, unlock: [] },
      { at: 25, discount: 0.07, extraStock: 2, unlock: ['mackerel'] },
      { at: 50, discount: 0.14, extraStock: 4, unlock: ['shrimp'] },
      { at: 80, discount: 0.22, extraStock: 8, unlock: ['tuna', 'scallop'] },
    ],
  },
  {
    id: 'neon_exotics',
    name: "Rin's Lantern Stall",
    npc: 'rin',
    district: 'neon_street',
    icon: '✨',
    color: '#e0508f',
    x: 112, z: -92, yaw: Math.PI,
    // Night trader: openHour > closeHour means the window wraps past midnight.
    blurb: 'Folding tables under paper lanterns, selling things no daylight shop will carry.',
    stock: [
      { id: 'yuzu',      price: 24,  daily: 4, restock: 4 },
      { id: 'sakura',    price: 28,  daily: 4, restock: 4 },
      { id: 'shiso',     price: 10,  daily: 6, restock: 6 },
      { id: 'sea_bream', price: 34,  daily: 3, restock: 3 },
      { id: 'roe',       price: 42,  daily: 2, restock: 2 },
      { id: 'uni',       price: 70,  daily: 2, restock: 2 },
      { id: 'toro',      price: 88,  daily: 1, restock: 1 },
      { id: 'gold_leaf', price: 120, daily: 1, restock: 1 },
    ],
    openHour: 18,
    closeHour: 3,
    tiers: [
      { at: 0,  discount: 0,    extraStock: 0, unlock: [] },
      { at: 25, discount: 0.07, extraStock: 2, unlock: ['shiso', 'sea_bream'] },
      { at: 50, discount: 0.14, extraStock: 4, unlock: ['roe', 'uni'] },
      { at: 80, discount: 0.22, extraStock: 8, unlock: ['toro', 'gold_leaf'] },
    ],
  },
];

const SUPPLIER_INDEX = Object.create(null);
for (const s of SUPPLIERS) SUPPLIER_INDEX[s.id] = s;

export { SUPPLIER_INDEX };

export function supplier(id) {
  if (id && typeof id === 'object') return id;
  return SUPPLIER_INDEX[id] || null;
}

export function suppliersInDistrict(id) {
  return SUPPLIERS.filter((s) => s.district === id);
}

/** Highest tier the player has earned; always returns a tier, never null. */
export function tierFor(sup, relationshipLevel) {
  const s = supplier(sup);
  if (!s || !s.tiers || !s.tiers.length) return { at: 0, discount: 0, extraStock: 0, unlock: [] };
  const lvl = Number(relationshipLevel) || 0;
  let best = s.tiers[0];
  for (const t of s.tiers) if (lvl >= t.at && t.at >= best.at) best = t;
  return best;
}

/** Ids this supplier gates behind any tier at all. */
function gatedIds(s) {
  const set = new Set();
  for (const t of s.tiers || []) for (const id of t.unlock || []) set.add(id);
  return set;
}

/** Ids the player has actually earned at this relationship level. */
function unlockedIds(s, relationshipLevel) {
  const lvl = Number(relationshipLevel) || 0;
  const set = new Set();
  for (const t of s.tiers || []) if (lvl >= t.at) for (const id of t.unlock || []) set.add(id);
  return set;
}

function sells(s, ingredientId, relationshipLevel) {
  const gated = gatedIds(s);
  if (gated.has(ingredientId)) return unlockedIds(s, relationshipLevel).has(ingredientId);
  return (s.stock || []).some((r) => r.id === ingredientId);
}

/** Final per-unit price, or null when this supplier will not sell it yet. */
export function priceFor(sup, ingredientId, relationshipLevel) {
  const s = supplier(sup);
  if (!s) return null;
  if (!sells(s, ingredientId, relationshipLevel)) return null;
  const row = (s.stock || []).find((r) => r.id === ingredientId);
  const ing = ingredient(ingredientId);
  const base = row ? row.price : (ing ? ing.price : null);
  if (base == null) return null;
  const t = tierFor(s, relationshipLevel);
  return Math.max(1, Math.round(base * (1 - t.discount)));
}

/** Today's shelf: everything on sale at this relationship level. */
export function stockFor(sup, relationshipLevel) {
  const s = supplier(sup);
  if (!s) return [];
  const t = tierFor(s, relationshipLevel);
  const unlocked = unlockedIds(s, relationshipLevel);
  const gated = gatedIds(s);
  const out = [];
  const seen = new Set();
  for (const row of s.stock || []) {
    if (gated.has(row.id) && !unlocked.has(row.id)) continue;
    seen.add(row.id);
    out.push({ id: row.id, price: priceFor(s, row.id, relationshipLevel), qty: row.daily + t.extraStock });
  }
  // Tier unlocks with no stock row of their own fall back to the catalogue.
  for (const id of unlocked) {
    if (seen.has(id) || !ingredient(id)) continue;
    out.push({ id, price: priceFor(s, id, relationshipLevel), qty: Math.max(1, t.extraStock) });
  }
  return out;
}

/** Handles the neon stall's wrap-past-midnight window. */
export function isOpenAt(sup, hour) {
  const s = supplier(sup);
  if (!s) return false;
  const h = ((Number(hour) || 0) % 24 + 24) % 24;
  if (s.openHour === 0 && s.closeHour >= 24) return true;
  if (s.openHour <= s.closeHour) return h >= s.openHour && h < s.closeHour;
  return h >= s.openHour || h < s.closeHour;
}
