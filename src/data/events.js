// Scheduled city events.
//
// The city runs on a very simple calendar: `day` is an integer starting at 1
// (see state.clock.day) and `hour` is 0..24. Each event declares when it is on
// with a pure predicate, so "every fifth day" and "weekends" cost the same to
// evaluate and nothing has to be pre-generated at save time.
//
// District ids match districts.js: old_market | fish_harbor | downtown |
// residential | neon_street. Ingredient ids match ingredients.js.
//
// effects keys (all optional, all read by gameplay systems by name):
//   priceMult       multiplies supplier prices in that district (<1 = cheaper)
//   stockBonus      extra units added to each stall's daily stock
//   customerMult    multiplies customer spawn rate
//   payMult         multiplies what customers pay
//   repMult         multiplies reputation gained
//   spawnIngredient ingredient id pushed into local stock for the day

/** Ingredients the seasonal event rotates through, in order. */
export const SEASONAL_ROTATION = ['sakura', 'yuzu', 'shiso', 'uni', 'roe', 'gold_leaf'];

export const CITY_EVENTS = [
  {
    id: 'morning_auction',
    name: 'Morning Auction',
    icon: '🔔',
    district: 'fish_harbor',
    blurb: 'Boats land at first light and the whole catch goes under the hammer. Early cats eat well.',
    days: (day) => day >= 1,
    fromHour: 6,
    toHour: 8,
    effects: { priceMult: 0.72, stockBonus: 14 },
  },
  {
    id: 'weekend_market',
    name: 'Weekend Market',
    icon: '🏮',
    district: 'old_market',
    blurb: 'Twice the stalls, half the prices, and traders who only show up on weekends.',
    days: (day) => day % 7 === 6 || day % 7 === 0,
    fromHour: 9,
    toHour: 18,
    effects: { priceMult: 0.85, stockBonus: 8, customerMult: 1.2 },
  },
  {
    id: 'night_festival',
    name: 'Night Festival',
    icon: '🎆',
    district: 'neon_street',
    blurb: 'Lanterns down the whole street, drums until midnight, and a crowd that came out to spend.',
    days: (day) => day % 5 === 0,
    fromHour: 19,
    toHour: 24,
    effects: { customerMult: 1.9, payMult: 1.35, repMult: 1.25 },
  },
  {
    id: 'seasonal_ingredient',
    name: 'Seasonal Delivery',
    icon: '🌸',
    district: 'old_market',
    blurb: 'A crate of something the city only sees a few times a year turns up on the market floor.',
    days: (day) => day % 12 === 0,
    fromHour: 8,
    toHour: 20,
    // The concrete ingredient rotates — call seasonalIngredientFor(day), or read
    // the resolved value out of eventEffects(). This is the day-0 default.
    effects: { spawnIngredient: 'sakura', stockBonus: 5, priceMult: 0.95 },
    rotation: SEASONAL_ROTATION,
  },
  {
    id: 'sushi_competition',
    name: 'Sushi Competition',
    icon: '🏆',
    district: 'downtown',
    blurb: 'Open bracket on the plaza stage. Pay the entry, cook three rounds, try not to look at the judges.',
    days: (day) => day % 10 === 0,
    fromHour: 12,
    toHour: 16,
    entryFee: 150,
    prizePool: 1400,
    effects: { customerMult: 1.4, payMult: 1.15, repMult: 1.6 },
  },
];

const INDEX = Object.create(null);
for (const e of CITY_EVENTS) INDEX[e.id] = e;

export function cityEvent(id) { return INDEX[id] || null; }

/** Never let a hand-written predicate take the frame down with it. */
function onDay(e, day) {
  try { return !!e.days(day); } catch { return false; }
}

/** Which special ingredient the seasonal delivery brings on a given day. */
export function seasonalIngredientFor(day) {
  const n = SEASONAL_ROTATION.length;
  if (!n) return null;
  // Day 12 is the first delivery and brings the first entry in the rotation.
  const cycle = Math.floor(Math.max(0, day) / 12) - 1;
  return SEASONAL_ROTATION[((cycle % n) + n) % n];
}

/** Every event running at this exact moment. */
export function activeEvents(day, hour) {
  return CITY_EVENTS.filter((e) => onDay(e, day) && hour >= e.fromHour && hour < e.toHour);
}

/** True when a specific event is running now. */
export function isEventActive(id, day, hour) {
  const e = INDEX[id];
  return !!e && onDay(e, day) && hour >= e.fromHour && hour < e.toHour;
}

/**
 * The soonest event that has not started yet.
 * @returns {{ event, inDays: number, atHour: number } | null}
 */
export function nextEvent(day, hour, lookaheadDays = 40) {
  let best = null;
  for (let d = day; d <= day + lookaheadDays; d++) {
    for (const e of CITY_EVENTS) {
      if (!onDay(e, d)) continue;
      if (d === day && e.fromHour <= hour) continue;   // already started (or over)
      const when = (d - day) * 24 + e.fromHour;
      if (!best || when < best.when) best = { event: e, inDays: d - day, atHour: e.fromHour, when };
    }
    if (best) break;                                   // later days can only be further away
  }
  if (!best) return null;
  return { event: best.event, inDays: best.inDays, atHour: best.atHour };
}

/**
 * Merged effects of everything running right now, optionally narrowed to one
 * district. Multipliers combine multiplicatively, bonuses add, and the seasonal
 * ingredient is resolved through the rotation.
 */
export function eventEffects(day, hour, districtId = null) {
  const out = { priceMult: 1, stockBonus: 0, customerMult: 1, payMult: 1, repMult: 1, spawnIngredient: null };
  for (const e of activeEvents(day, hour)) {
    if (districtId && e.district !== districtId) continue;
    const fx = e.effects || {};
    if (fx.priceMult != null) out.priceMult *= fx.priceMult;
    if (fx.stockBonus != null) out.stockBonus += fx.stockBonus;
    if (fx.customerMult != null) out.customerMult *= fx.customerMult;
    if (fx.payMult != null) out.payMult *= fx.payMult;
    if (fx.repMult != null) out.repMult *= fx.repMult;
    if (fx.spawnIngredient != null) {
      out.spawnIngredient = e.rotation ? seasonalIngredientFor(day) : fx.spawnIngredient;
    }
  }
  return out;
}

/** Everything happening on a day, for the calendar/journal UI. */
export function eventsOnDay(day) {
  return CITY_EVENTS.filter((e) => onDay(e, day));
}
