// Ingredient catalogue. Purely data — no THREE, no DOM.
//
// quality      0..1 baseline quality of a normal-grade unit from its supplier
// price        default purchase price per unit in coins
// value        contribution to a finished dish's sale price
// perish       multiplier on the global freshness loss rate (1 = normal)
// source       'market' | 'harbor' | 'fishing' | 'forage' | 'quest' | 'neon'
// unlock       null (available from the start) or { reputation, quest, relationship }

export const CATEGORIES = {
  staple:   { name: 'Staples',    color: '#e8dcc0', icon: '🍚' },
  seaweed:  { name: 'Seaweed',    color: '#3f5a4a', icon: '🌿' },
  fish:     { name: 'Fish',       color: '#e8836a', icon: '🐟' },
  shellfish:{ name: 'Shellfish',  color: '#f0a284', icon: '🦐' },
  veg:      { name: 'Vegetables', color: '#8fbf6a', icon: '🥒' },
  dairy:    { name: 'Egg & Soy',  color: '#f2d47a', icon: '🥚' },
  season:   { name: 'Seasoning',  color: '#a8794f', icon: '🧂' },
  special:  { name: 'Special',    color: '#d9a3e0', icon: '✨' },
};

export const INGREDIENTS = [
  // --- staples ------------------------------------------------------------
  { id: 'rice',      name: 'Sushi Rice',   cat: 'staple',  icon: '🍚', color: '#f6efe0', quality: 0.7, price: 6,  value: 4,  perish: 0.4, source: 'market', unlock: null },
  { id: 'nori',      name: 'Nori Sheet',   cat: 'seaweed', icon: '🌿', color: '#2f4a3c', quality: 0.7, price: 5,  value: 4,  perish: 0.2, source: 'market', unlock: null },
  { id: 'vinegar',   name: 'Rice Vinegar', cat: 'season',  icon: '🍶', color: '#efe3c4', quality: 0.7, price: 4,  value: 2,  perish: 0.1, source: 'market', unlock: null },

  // --- fish ---------------------------------------------------------------
  { id: 'salmon',    name: 'Salmon',       cat: 'fish',    icon: '🐟', color: '#f08a63', quality: 0.7, price: 16, value: 16, perish: 1.4, source: 'harbor', unlock: null },
  { id: 'tuna',      name: 'Tuna',         cat: 'fish',    icon: '🐟', color: '#c8483f', quality: 0.72,price: 22, value: 22, perish: 1.4, source: 'harbor', unlock: null },
  { id: 'mackerel',  name: 'Mackerel',     cat: 'fish',    icon: '🐟', color: '#7f9bb0', quality: 0.6, price: 11, value: 11, perish: 1.6, source: 'fishing', unlock: null },
  { id: 'sea_bream', name: 'Sea Bream',    cat: 'fish',    icon: '🐠', color: '#e8b8c0', quality: 0.78,price: 30, value: 32, perish: 1.5, source: 'fishing', unlock: { reputation: 30 } },
  { id: 'eel',       name: 'Eel',          cat: 'fish',    icon: '🐍', color: '#5a4632', quality: 0.75,price: 34, value: 34, perish: 1.2, source: 'harbor', unlock: { reputation: 60 } },
  { id: 'toro',      name: 'Fatty Toro',   cat: 'fish',    icon: '🍥', color: '#f0a8a0', quality: 0.9, price: 78, value: 88, perish: 1.8, source: 'harbor', unlock: { relationship: { npc: 'mikan', level: 45 } } },

  // --- shellfish ----------------------------------------------------------
  { id: 'shrimp',    name: 'Shrimp',       cat: 'shellfish', icon: '🦐', color: '#f4a184', quality: 0.68, price: 14, value: 14, perish: 1.5, source: 'harbor', unlock: null },
  { id: 'scallop',   name: 'Scallop',      cat: 'shellfish', icon: '🐚', color: '#f2e2c4', quality: 0.76, price: 26, value: 27, perish: 1.6, source: 'harbor', unlock: { reputation: 45 } },
  { id: 'uni',       name: 'Sea Urchin',   cat: 'shellfish', icon: '🟠', color: '#f0a03a', quality: 0.88, price: 64, value: 72, perish: 2.2, source: 'harbor', unlock: { reputation: 150 } },
  { id: 'roe',       name: 'Salmon Roe',   cat: 'shellfish', icon: '🟠', color: '#e8642f', quality: 0.8,  price: 38, value: 40, perish: 1.7, source: 'harbor', unlock: { reputation: 90 } },

  // --- vegetables ---------------------------------------------------------
  { id: 'cucumber',  name: 'Cucumber',     cat: 'veg', icon: '🥒', color: '#7fbf5a', quality: 0.7, price: 5,  value: 5,  perish: 0.8, source: 'market', unlock: null },
  { id: 'avocado',   name: 'Avocado',      cat: 'veg', icon: '🥑', color: '#6f9a4a', quality: 0.7, price: 9,  value: 9,  perish: 0.9, source: 'market', unlock: null },
  { id: 'daikon',    name: 'Daikon',       cat: 'veg', icon: '🥬', color: '#eef0e2', quality: 0.68,price: 6,  value: 6,  perish: 0.7, source: 'market', unlock: null },
  { id: 'shiso',     name: 'Shiso Leaf',   cat: 'veg', icon: '🍃', color: '#5f8f4a', quality: 0.74,price: 8,  value: 9,  perish: 1.1, source: 'forage', unlock: { reputation: 25 } },

  // --- egg & soy ----------------------------------------------------------
  { id: 'egg',       name: 'Egg',          cat: 'dairy', icon: '🥚', color: '#f5dc8a', quality: 0.7, price: 5,  value: 6,  perish: 0.6, source: 'market', unlock: null },
  { id: 'tofu',      name: 'Tofu',         cat: 'dairy', icon: '⬜', color: '#f4f0e2', quality: 0.7, price: 7,  value: 7,  perish: 1.0, source: 'market', unlock: null },

  // --- seasoning ----------------------------------------------------------
  { id: 'wasabi',    name: 'Wasabi',       cat: 'season', icon: '🟢', color: '#8fc25f', quality: 0.72, price: 9, value: 5, perish: 0.5, source: 'market', unlock: null },
  { id: 'soy_sauce', name: 'Soy Sauce',    cat: 'season', icon: '🧴', color: '#3a2a1e', quality: 0.7,  price: 6, value: 3, perish: 0.1, source: 'market', unlock: null },
  { id: 'ginger',    name: 'Pickled Ginger',cat:'season', icon: '🫚', color: '#f0bfa8', quality: 0.7,  price: 6, value: 4, perish: 0.4, source: 'market', unlock: null },
  { id: 'sesame',    name: 'Sesame',       cat: 'season', icon: '⚪', color: '#e0d0a8', quality: 0.7,  price: 4, value: 3, perish: 0.2, source: 'market', unlock: null },

  // --- special / seasonal -------------------------------------------------
  { id: 'sakura',    name: 'Sakura Petal', cat: 'special', icon: '🌸', color: '#f2b8cf', quality: 0.85, price: 30, value: 34, perish: 1.3, source: 'forage', unlock: { season: 'spring' } },
  { id: 'yuzu',      name: 'Yuzu',         cat: 'special', icon: '🍋', color: '#f2d24a', quality: 0.82, price: 26, value: 28, perish: 0.9, source: 'market', unlock: { reputation: 70 } },
  { id: 'gold_leaf', name: 'Gold Leaf',    cat: 'special', icon: '🟨', color: '#f5cf5a', quality: 0.95, price: 120,value: 150,perish: 0.05,source: 'neon',   unlock: { reputation: 200 } },
  { id: 'golden_koi',name: 'Golden Koi',   cat: 'special', icon: '🎏', color: '#f2b03a', quality: 0.98, price: 0,  value: 220,perish: 1.0, source: 'fishing', unlock: { quest: 'q07_rare_fish' } },
];

const INDEX = Object.create(null);
for (const i of INGREDIENTS) INDEX[i.id] = i;

export function ingredient(id) { return INDEX[id] || null; }

export function ingredientName(id) { const i = INDEX[id]; return i ? i.name : id; }

export function ingredientsBySource(source) {
  return INGREDIENTS.filter((i) => i.source === source);
}

/** True when the run's progression satisfies the ingredient's unlock rule. */
export function ingredientAvailable(id, state) {
  const ing = INDEX[id];
  if (!ing) return false;
  const u = ing.unlock;
  if (!u) return true;
  if (u.reputation != null && state.reputation < u.reputation) return false;
  if (u.quest && !state.questDone(u.quest)) return false;
  if (u.relationship && state.relationship(u.relationship.npc) < u.relationship.level) return false;
  return true;
}
