// Where the money comes from.
//
// Three different panels need to answer the same question — "what does this
// dish actually earn me?" — so the arithmetic lives here once, as pure data
// helpers with no DOM and no THREE. Everything is computed against the
// player's real situation: their relationship tier at each stall and which
// districts they can currently walk into.
//
// Vocabulary used throughout:
//   cost     what the ingredient list would cost to buy right now, at the
//            cheapest stall that will actually sell to you today
//   sell     the recipe's basePrice — what an average plate pays
//   perfect  what a Perfect grade pays (basePrice * the 'perfect' payMult)
//   profit   sell - cost
//
// Note: `cost` is a REPLACEMENT cost. It does not go to zero just because the
// ingredient is already in the basket, because the number the player is trying
// to reason about is "is this dish worth making at all".

import { SUPPLIERS, supplier as supplierById, priceFor } from './suppliers.js';
import { ingredient } from './ingredients.js';
import { RECIPES, recipe as recipeById } from './recipes.js';
import { districtById } from './districts.js';
import { QUALITY_GRADES } from './progression.js';

/** Pay multiplier for a Perfect plate, read from the grade table. */
export const PERFECT_MULT = (QUALITY_GRADES.find((g) => g.id === 'perfect') || { payMult: 1.6 }).payMult;

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Friendship level with whoever runs a stall. Never throws on a partial state. */
function relFor(state, sup) {
  if (!state || !sup || !sup.npc) return 0;
  try {
    return typeof state.relationship === 'function' ? num(state.relationship(sup.npc), 0) : 0;
  } catch { return 0; }
}

/**
 * Has the player been shown this district yet?
 *
 * NOTE: this is NOT a travel gate. Nothing in the world stops the cat walking
 * into a "locked" district and buying there — the flag only drives customer
 * spawns, delivery targets and guidance. So it must never remove a stall from
 * the price search, or the recipe book would claim salmon is unbuyable on day
 * one while the tutorial is busy telling the player to go and buy salmon. It
 * is used for one thing only: adding "you have not been there yet" as a hint.
 */
function districtKnown(state, sup) {
  if (!sup || !sup.district) return true;
  if (!state || typeof state.districtUnlocked !== 'function') return true;
  try { return !!state.districtUnlocked(sup.district); } catch { return true; }
}

/**
 * Cheapest stall that will sell `id` to this player right now, anywhere in the
 * city. Returns null only when nobody will sell it at any price — which means
 * a real gate: stall friendship, or an ingredient you have to catch/forage.
 *
 * @returns {{ price:number, supplier:object }|null}
 */
export function bestBuy(id, state) {
  let best = null;
  for (const sup of SUPPLIERS) {
    const price = priceFor(sup, id, relFor(state, sup));
    if (price == null) continue;
    if (!best || price < best.price) best = { price, supplier: sup };
  }
  return best;
}

/**
 * One short sentence explaining where an ingredient the player cannot buy
 * actually comes from. Prefers the concrete gate (stall friendship) over the
 * generic source tag.
 */
export function whereFrom(id, state) {
  const ing = ingredient(id);
  const name = ing ? ing.name : String(id);

  // Callers normally only ask when bestBuy() came back empty, but the helper
  // has to stay honest on its own: if somebody IS selling it, say so rather
  // than quoting a gate the player can simply walk around.
  const onSale = bestBuy(id, state);
  if (onSale) {
    const d = districtById(onSale.supplier.district);
    return `${name} is ${onSale.price}¢ at ${onSale.supplier.name}${d ? ` in ${d.name}` : ''}`;
  }

  // Some stall lists it but will not sell yet — that is a friendship gate.
  let friendship = null;
  for (const sup of SUPPLIERS) {
    const gatedAt = (sup.tiers || []).find((t) => (t.unlock || []).includes(id));
    if (!gatedAt) continue;
    if (!friendship || gatedAt.at < friendship.at) friendship = { at: gatedAt.at, sup };
  }
  if (friendship) {
    return `${name} needs friendship ${friendship.at} with ${friendship.sup.name}`;
  }

  switch (ing && ing.source) {
    case 'fishing': return `${name} has to be caught with a rod`;
    case 'forage':  return `${name} is foraged around the city`;
    case 'quest':   return `${name} comes from a quest`;
    case 'harbor':  return `${name} only turns up at the harbour`;
    default:        return `${name} is not on sale anywhere yet`;
  }
}

/**
 * Full money picture for one recipe.
 *
 * @returns {{
 *   recipe:object, cost:number, sell:number, perfect:number,
 *   profit:number, perfectProfit:number, margin:number,
 *   ok:boolean, missing:{id:string,name:string,where:string}|null,
 *   lines:{id:string,qty:number,unit:number,total:number,supplier:object|null,ok:boolean}[]
 * }|null}
 *
 * `ok` is false when at least one ingredient cannot be bought anywhere today —
 * in that case `cost` covers only the buyable part and must not be shown as a
 * total. Use `missing` instead.
 */
export function recipeEconomy(r, state) {
  const rec = typeof r === 'string' ? recipeById(r) : r;
  if (!rec) return null;

  const lines = [];
  let cost = 0;
  let missing = null;
  let trip = null;

  for (const need of rec.ingredients || []) {
    const qty = num(need.qty, 1) || 1;
    const buy = bestBuy(need.id, state);
    if (!buy) {
      if (!missing) {
        const ing = ingredient(need.id);
        missing = { id: need.id, name: ing ? ing.name : need.id, where: whereFrom(need.id, state) };
      }
      lines.push({ id: need.id, qty, unit: 0, total: 0, supplier: null, ok: false });
      continue;
    }
    const total = buy.price * qty;
    cost += total;
    lines.push({ id: need.id, qty, unit: buy.price, total, supplier: buy.supplier, ok: true });

    // Buyable, but somewhere the player has not been sent yet.
    if (!trip && !districtKnown(state, buy.supplier)) {
      const d = districtById(buy.supplier.district);
      const ing = ingredient(need.id);
      trip = {
        ingredient: ing ? ing.name : need.id,
        district: d ? d.name : buy.supplier.district,
        supplier: buy.supplier.name,
      };
    }
  }

  const sell = num(rec.basePrice, 0);
  const perfect = Math.round(sell * PERFECT_MULT);
  const profit = sell - cost;

  return {
    recipe: rec,
    cost: Math.round(cost),
    sell: Math.round(sell),
    perfect,
    profit: Math.round(profit),
    perfectProfit: Math.round(perfect - cost),
    margin: sell > 0 ? profit / sell : 0,
    ok: !missing,
    missing,
    /** Set when the cheapest source sits in a district the player has not met. */
    trip,
    lines,
  };
}

/**
 * Traffic light for a profit figure. Green is a dish worth building a day
 * around, amber still pays, red loses money.
 */
export function profitTone(econ) {
  if (!econ || !econ.ok) return 'bad';
  if (econ.profit <= 0) return 'bad';
  return econ.margin >= 0.4 ? 'good' : 'ok';
}

/** Recipes the player knows, each with its money picture attached. */
export function knownEconomies(state) {
  const out = [];
  for (const rec of RECIPES) {
    let known = true;
    try { known = typeof state.knowsRecipe === 'function' ? state.knowsRecipe(rec.id) : true; } catch { known = true; }
    if (!known) continue;
    const e = recipeEconomy(rec, state);
    if (e) out.push(e);
  }
  return out;
}

/**
 * The single best thing the player could cook this second: highest profit
 * among recipes they know AND already have the ingredients for. Falls back to
 * the best *buyable* recipe when the basket is empty, flagged via `cookable`.
 */
export function bestCookableRecipe(state) {
  const all = knownEconomies(state).filter((e) => e.ok && e.profit > 0);
  if (!all.length) return null;

  const hasItems = (rec) => {
    try { return typeof state.hasItems === 'function' ? state.hasItems(rec.ingredients) : false; }
    catch { return false; }
  };

  const ready = all.filter((e) => hasItems(e.recipe));
  const pool = ready.length ? ready : all;
  let best = pool[0];
  for (const e of pool) if (e.profit > best.profit) best = e;
  return { ...best, cookable: ready.length > 0 };
}

/**
 * The recipe that best justifies buying an ingredient — the highest-paying
 * dish that uses it. Prefers recipes the player has actually learned.
 */
export function topRecipeFor(id, state) {
  let known = null, any = null;
  for (const rec of RECIPES) {
    if (!(rec.ingredients || []).some((n) => n.id === id)) continue;
    if (!any || rec.basePrice > any.basePrice) any = rec;
    let isKnown = false;
    try { isKnown = typeof state.knowsRecipe === 'function' && state.knowsRecipe(rec.id); } catch { isKnown = false; }
    if (isKnown && (!known || rec.basePrice > known.basePrice)) known = rec;
  }
  if (known) return { recipe: known, known: true };
  if (any) return { recipe: any, known: false };
  return null;
}

/**
 * Greedy "how many plates does this pile of ingredients become?".
 *
 * @param {Object<string,number>} counts ingredient id -> units available
 * @returns {{ dishes:number, value:number, best:object|null }} `value` is the
 *   summed basePrice of those plates, i.e. what they sell for at average grade.
 */
export function dishesFrom(counts, state) {
  const pool = Object.create(null);
  for (const k in counts) pool[k] = num(counts[k], 0);

  const menu = knownEconomies(state)
    .slice()
    .sort((a, b) => b.profit - a.profit);

  let dishes = 0, value = 0, best = null;
  // Bounded so a pathological pool can never spin: no basket makes 200 plates.
  for (let guard = 0; guard < 200; guard++) {
    let made = false;
    for (const e of menu) {
      const needs = e.recipe.ingredients || [];
      if (!needs.every((n) => (pool[n.id] || 0) >= (num(n.qty, 1) || 1))) continue;
      for (const n of needs) pool[n.id] -= (num(n.qty, 1) || 1);
      dishes++; value += e.sell;
      if (!best || e.profit > best.profit) best = e;
      made = true;
      break;
    }
    if (!made) break;
  }
  return { dishes, value: Math.round(value), best };
}

/** Ingredient counts currently in the basket, as a plain map. */
export function inventoryCounts(state) {
  const out = Object.create(null);
  const inv = (state && state.inventory) || [];
  for (const slot of inv) {
    if (!slot || !slot.id) continue;
    out[slot.id] = (out[slot.id] || 0) + num(slot.qty, 0);
  }
  return out;
}

/** Nice name for a supplier id or object, for "cheapest at …" lines. */
export function supplierName(sup) {
  const s = supplierById(sup);
  return s ? s.name : '';
}
