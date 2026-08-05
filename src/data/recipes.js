// Recipe catalogue + the modular cooking-step vocabulary.
//
// A recipe is a list of ingredient requirements plus an ordered list of step
// ids. The cooking mini-game engine (src/game/cooking.js) knows how to play
// each STEP_TYPE; recipes only reference them by id, so new recipes are pure
// data and need no gameplay code.

/** The reusable interaction primitives every cooking step is built from. */
export const STEP_TYPES = {
  // Stop a sweeping indicator inside a target zone.
  timing: { name: 'Timing', hint: 'Press SPACE in the green zone' },
  // Hold a key for the right duration.
  hold:   { name: 'Hold',   hint: 'Hold SPACE — release at the marker' },
  // Repeated directional strokes (slicing).
  slice:  { name: 'Slice',  hint: 'Swipe / press the arrow shown' },
  // Drag items into slots.
  drag:   { name: 'Place',  hint: 'Drag each item into its outline' },
  // Rapid rhythmic taps in time with a beat.
  roll:   { name: 'Roll',   hint: 'Tap SPACE on the beat' },
  // Arrange pieces to match a target pattern.
  arrange:{ name: 'Plate',  hint: 'Match the pattern shown' },
};

/**
 * Step library. `type` picks the mini-game, `cfg` tunes it.
 * `secs` is the nominal duration used for pacing an order (15–40s per order).
 */
export const STEPS = {
  wash_rice:  { id: 'wash_rice',  label: 'Rinse the rice',   type: 'hold',    icon: '💧', secs: 4, cfg: { target: 1.5, tolerance: 0.35 } },
  cook_rice:  { id: 'cook_rice',  label: 'Season the rice',  type: 'timing',  icon: '🍚', secs: 4, cfg: { speed: 1.05, zone: 0.24, rounds: 1 } },
  slice_fish: { id: 'slice_fish', label: 'Slice the fish',   type: 'slice',   icon: '🔪', secs: 6, cfg: { strokes: 4, window: 1.0 } },
  slice_veg:  { id: 'slice_veg',  label: 'Slice vegetables', type: 'slice',   icon: '🥒', secs: 5, cfg: { strokes: 3, window: 1.1 } },
  cook_egg:   { id: 'cook_egg',   label: 'Fold the tamago',  type: 'timing',  icon: '🍳', secs: 6, cfg: { speed: 0.9, zone: 0.22, rounds: 2 } },
  boil:       { id: 'boil',       label: 'Blanch the shrimp',type: 'hold',    icon: '♨️', secs: 5, cfg: { target: 2.0, tolerance: 0.3 } },
  place:      { id: 'place',      label: 'Add ingredients',  type: 'drag',    icon: '🫳', secs: 6, cfg: { slots: 3 } },
  roll:       { id: 'roll',       label: 'Roll the maki',    type: 'roll',    icon: '🍥', secs: 6, cfg: { beats: 6, window: 0.20 } },
  shape:      { id: 'shape',      label: 'Shape the nigiri', type: 'timing',  icon: '🤲', secs: 5, cfg: { speed: 1.2, zone: 0.20, rounds: 2 } },
  sauce:      { id: 'sauce',      label: 'Brush the sauce',  type: 'hold',    icon: '🖌️', secs: 4, cfg: { target: 1.2, tolerance: 0.3 } },
  garnish:    { id: 'garnish',    label: 'Garnish',          type: 'drag',    icon: '🌿', secs: 4, cfg: { slots: 2 } },
  plate:      { id: 'plate',      label: 'Plate the order',  type: 'arrange', icon: '🍽️', secs: 6, cfg: { pieces: 4 } },
};

/**
 * unlock:
 *   { free: true }                       known from the start
 *   { reputation: n }                    earned by fame
 *   { quest: 'id' }                      taught by a quest
 *   { relationship: { npc, level } }     taught by a friend
 *   { discover: 'recipe_page_id' }       found in the world
 */
export const RECIPES = [
  {
    id: 'salmon_nigiri', name: 'Salmon Nigiri', icon: '🍣',
    desc: 'The classic. A slice of salmon over hand-pressed rice.',
    ingredients: [{ id: 'rice', qty: 1 }, { id: 'salmon', qty: 1 }],
    steps: ['cook_rice', 'slice_fish', 'shape'],
    difficulty: 1, basePrice: 42, rep: 1.0, xp: 8,
    unlock: { free: true },
  },
  {
    id: 'tamago_nigiri', name: 'Tamago Nigiri', icon: '🍳',
    desc: 'Sweet folded omelette on rice, tied with a nori ribbon.',
    ingredients: [{ id: 'rice', qty: 1 }, { id: 'egg', qty: 1 }, { id: 'nori', qty: 1 }],
    steps: ['cook_rice', 'cook_egg', 'shape'],
    difficulty: 1, basePrice: 34, rep: 0.8, xp: 7,
    unlock: { free: true },
  },
  {
    id: 'cucumber_maki', name: 'Cucumber Maki', icon: '🥒',
    desc: 'Crisp, cheap and always welcome. Six neat pieces.',
    ingredients: [{ id: 'rice', qty: 1 }, { id: 'nori', qty: 1 }, { id: 'cucumber', qty: 1 }],
    steps: ['cook_rice', 'slice_veg', 'roll'],
    difficulty: 1, basePrice: 30, rep: 0.7, xp: 6,
    unlock: { free: true },
  },
  {
    id: 'tuna_nigiri', name: 'Tuna Nigiri', icon: '🍣',
    desc: 'Deep red akami, cut against the grain.',
    ingredients: [{ id: 'rice', qty: 1 }, { id: 'tuna', qty: 1 }, { id: 'wasabi', qty: 1 }],
    steps: ['cook_rice', 'slice_fish', 'shape', 'sauce'],
    difficulty: 2, basePrice: 58, rep: 1.3, xp: 11,
    unlock: { reputation: 10 },
  },
  {
    id: 'salmon_maki', name: 'Salmon Maki', icon: '🍥',
    desc: 'Salmon and avocado rolled tight in nori.',
    ingredients: [{ id: 'rice', qty: 1 }, { id: 'nori', qty: 1 }, { id: 'salmon', qty: 1 }, { id: 'avocado', qty: 1 }],
    steps: ['cook_rice', 'slice_fish', 'place', 'roll'],
    difficulty: 2, basePrice: 66, rep: 1.4, xp: 13,
    unlock: { reputation: 18 },
  },
  {
    id: 'shrimp_nigiri', name: 'Shrimp Sushi', icon: '🦐',
    desc: 'Butterflied shrimp, blanched just enough to curl.',
    ingredients: [{ id: 'rice', qty: 1 }, { id: 'shrimp', qty: 2 }],
    steps: ['cook_rice', 'boil', 'shape', 'sauce'],
    difficulty: 2, basePrice: 62, rep: 1.3, xp: 12,
    unlock: { quest: 'q04_market_errand' },
  },
  {
    id: 'mixed_plate', name: 'Mixed Sushi Plate', icon: '🍱',
    desc: 'A little of everything — the safest way to please a table.',
    ingredients: [{ id: 'rice', qty: 2 }, { id: 'salmon', qty: 1 }, { id: 'tuna', qty: 1 }, { id: 'cucumber', qty: 1 }, { id: 'ginger', qty: 1 }],
    steps: ['cook_rice', 'slice_fish', 'slice_veg', 'shape', 'plate'],
    difficulty: 3, basePrice: 128, rep: 2.4, xp: 24,
    unlock: { reputation: 55 },
  },
  {
    id: 'chefs_roll', name: "Chef's Special Roll", icon: '🌯',
    desc: 'Your own invention: eel, avocado, roe and a sesame crust.',
    ingredients: [{ id: 'rice', qty: 2 }, { id: 'nori', qty: 1 }, { id: 'eel', qty: 1 }, { id: 'avocado', qty: 1 }, { id: 'sesame', qty: 1 }],
    steps: ['cook_rice', 'slice_fish', 'place', 'roll', 'sauce', 'plate'],
    difficulty: 4, basePrice: 190, rep: 3.4, xp: 36,
    unlock: { quest: 'q08_rival_duel' },
  },
  {
    id: 'sashimi_deluxe', name: 'Deluxe Sashimi Set', icon: '🐟',
    desc: 'No rice to hide behind. All knife, all presentation.',
    ingredients: [{ id: 'tuna', qty: 1 }, { id: 'sea_bream', qty: 1 }, { id: 'toro', qty: 1 }, { id: 'daikon', qty: 1 }, { id: 'shiso', qty: 1 }],
    steps: ['slice_fish', 'slice_veg', 'garnish', 'plate'],
    difficulty: 5, basePrice: 320, rep: 5.0, xp: 55,
    unlock: { reputation: 190 },
  },
  {
    id: 'secret_city_roll', name: 'Secret City Roll', icon: '✨',
    desc: 'The recipe on the torn page. Nobody agrees what is in it.',
    ingredients: [{ id: 'rice', qty: 2 }, { id: 'nori', qty: 1 }, { id: 'uni', qty: 1 }, { id: 'roe', qty: 1 }, { id: 'yuzu', qty: 1 }, { id: 'gold_leaf', qty: 1 }],
    steps: ['cook_rice', 'slice_fish', 'place', 'roll', 'garnish', 'plate'],
    difficulty: 5, basePrice: 520, rep: 8.0, xp: 90,
    unlock: { quest: 'q09_lost_page' },
  },
];

const INDEX = Object.create(null);
for (const r of RECIPES) INDEX[r.id] = r;

export function recipe(id) { return INDEX[id] || null; }

/** Nominal seconds an order of this recipe takes to cook. */
export function recipeTime(r) {
  const rec = typeof r === 'string' ? INDEX[r] : r;
  if (!rec) return 0;
  return rec.steps.reduce((s, id) => s + (STEPS[id] ? STEPS[id].secs : 4), 0);
}

/** Recipes the player currently knows, sorted cheap-first. */
export function knownRecipes(state) {
  return RECIPES.filter((r) => state.knowsRecipe(r.id)).sort((a, b) => a.basePrice - b.basePrice);
}

/** Recipes whose ingredients are all in the basket right now. */
export function cookableRecipes(state) {
  return knownRecipes(state).filter((r) => state.hasItems(r.ingredients));
}

/** Unlock rules that resolve purely from progression (quest unlocks are pushed). */
export function checkRecipeUnlocks(state) {
  for (const r of RECIPES) {
    if (state.knowsRecipe(r.id)) continue;
    const u = r.unlock || {};
    if (u.free) { state.unlockRecipe(r.id); continue; }
    if (u.reputation != null && state.reputation >= u.reputation) { state.unlockRecipe(r.id); continue; }
    if (u.relationship && state.relationship(u.relationship.npc) >= u.relationship.level) { state.unlockRecipe(r.id); continue; }
  }
}
