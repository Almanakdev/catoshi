// Global tuning knobs. Everything a designer would want to nudge lives here so
// gameplay code never hardcodes a number.

export const PROGRESSION = {
  startingCoins: 120,
  baseStamina: 100,
  baseInventory: 24,
  maxReputation: 1000,

  // Clock
  dayStartHour: 7,
  dayLengthSeconds: 900,   // one in-game day = 15 real minutes
  shopOpenHour: 9,
  shopCloseHour: 21,
  sleepHour: 23,           // forced end-of-day if the player is still out

  // Freshness
  freshnessLossPerHour: 0.045,
  freshnessFloor: 0.15,
  freshnessQualityWeight: 0.25,   // how much freshness feeds final dish quality

  // Stamina
  staminaWalkPerSec: 0.10,
  staminaRunPerSec: 0.55,
  staminaCookPerAction: 1.6,
  staminaRestPerSec: 3.5,
  staminaLowThreshold: 25,

  // Safety net so the player can never soft-lock
  bailoutCoins: 25,        // handed out at day start if broke and holding nothing
  bailoutThreshold: 12,
};

export const LEVEL_CURVE = { base: 60, exp: 1.35, max: 30 };

export const REP_TIERS = [
  { id: 'stray',     name: 'Stray Cat',      min: 0,   tipMult: 1.00, customerRate: 1.00 },
  { id: 'known',     name: 'Known Face',     min: 15,  tipMult: 1.06, customerRate: 1.10 },
  { id: 'local',     name: 'Local Favourite',min: 45,  tipMult: 1.14, customerRate: 1.22 },
  { id: 'rising',    name: 'Rising Chef',    min: 100, tipMult: 1.24, customerRate: 1.35 },
  { id: 'renowned',  name: 'Renowned',       min: 200, tipMult: 1.38, customerRate: 1.5 },
  { id: 'master',    name: 'Sushi Master',   min: 380, tipMult: 1.55, customerRate: 1.7 },
  { id: 'legend',    name: 'Sushi Legend',   min: 650, tipMult: 1.8,  customerRate: 2.0 },
];

/** Dish grade bands, best first. `min` is the 0..1 quality score. */
export const QUALITY_GRADES = [
  { id: 'perfect',    label: 'Perfect',    min: 0.92, payMult: 1.60, repMult: 2.0, color: '#f6c445' },
  { id: 'great',      label: 'Great',      min: 0.78, payMult: 1.30, repMult: 1.4, color: '#7ec96a' },
  { id: 'good',       label: 'Good',       min: 0.60, payMult: 1.08, repMult: 1.0, color: '#79b7e0' },
  { id: 'acceptable', label: 'Acceptable', min: 0.38, payMult: 0.85, repMult: 0.4, color: '#c8a97a' },
  { id: 'poor',       label: 'Poor',       min: 0.00, payMult: 0.55, repMult: -0.6, color: '#d97b6c' },
];

export function gradeFor(score) {
  for (const g of QUALITY_GRADES) if (score >= g.min) return g;
  return QUALITY_GRADES[QUALITY_GRADES.length - 1];
}

/** Restaurant tiers. Cost is the coin price to advance INTO this tier. */
export const SHOP_TIERS = [
  { tier: 1, id: 'cart',      name: 'Street Sushi Cart',   cost: 0,    seats: 2, queue: 3, repReq: 0,   desc: 'A wooden cart, a rice tub, and a dream.' },
  { tier: 2, id: 'shop',      name: 'Neighbourhood Shop',  cost: 900,  seats: 4, queue: 4, repReq: 40,  desc: 'A tiny storefront with a noren curtain.' },
  { tier: 3, id: 'bar',       name: 'Modern Sushi Bar',    cost: 3200, seats: 6, queue: 5, repReq: 120, desc: 'Polished counter, proper chiller, warm lamps.' },
  { tier: 4, id: 'premium',   name: 'Premium Restaurant',  cost: 9000, seats: 8, queue: 6, repReq: 280, desc: 'Two floors, private booths, a real kitchen.' },
  { tier: 5, id: 'legendary', name: 'Famous Destination',  cost: 22000,seats: 10,queue: 8, repReq: 550, desc: 'People queue down the street for this place.' },
];

/** Customer archetypes — drives order size, patience and payout. */
export const CUSTOMER_TYPES = [
  { id: 'local',    name: 'Neighbour',   weight: 40, items: [1, 1], patience: 150, payMult: 1.0,  tipChance: 0.35, minRep: 0 },
  { id: 'worker',   name: 'Office Cat',  weight: 26, items: [1, 2], patience: 120, payMult: 1.15, tipChance: 0.45, minRep: 20 },
  { id: 'tourist',  name: 'Tourist',     weight: 16, items: [2, 3], patience: 180, payMult: 1.3,  tipChance: 0.6,  minRep: 40 },
  { id: 'foodie',   name: 'Food Critic', weight: 10, items: [2, 3], patience: 100, payMult: 1.7,  tipChance: 0.7,  minRep: 110 },
  { id: 'vip',      name: 'VIP Guest',   weight: 8,  items: [3, 4], patience: 95,  payMult: 2.2,  tipChance: 0.85, minRep: 240 },
];
