// Customer order generation and the shop queue.
//
// This module owns the *logical* queue: who wants what, how long they will
// wait, and what serving them is worth. It draws nothing — src/game/restaurant.js
// reads this queue and puts cats on the pavement for it.
//
// Everything it needs comes off `game` (state, bus, clock, rng), so it can be
// driven headless in a test with a stub clock.

import { EV } from './bus.js';
import {
  PROGRESSION, SHOP_TIERS, CUSTOMER_TYPES, REP_TIERS, gradeFor,
} from '../data/progression.js';
import { recipe, recipeTime, knownRecipes, cookableRecipes } from '../data/recipes.js';
import { eventEffects } from '../data/events.js';
import { NPCS, npc as npcById } from '../data/npcs.js';

// ---------------------------------------------------------------------------
// TUNING — every number a designer would want to nudge lives up here.
// ---------------------------------------------------------------------------
const TUNE = {
  /** Customers per REAL minute at reputation 0, tier 1, quiet hour, no events. */
  baseRate: 1.8,

  /** Multiplier per shop tier above 1 (a bigger shop pulls a bigger crowd). */
  tierRate: 0.12,

  /** Time-of-day busyness. Quiet is the floor; the two rushes stack on top. */
  quiet: 0.65,
  lunch: { from: 11, to: 14, amp: 0.95, ramp: 1.0 },
  dinner: { from: 18, to: 21, amp: 0.85, ramp: 1.0 },

  /** Spawn interval jitter: interval *= lerp(jitter[0], jitter[1], rng()). */
  jitter: [0.60, 1.40],

  /** Patience = type.patience * (base + perItem*qty) + recipeTime * cookGrace. */
  patienceBase: 0.80,
  patiencePerItem: 0.20,
  patienceCookGrace: 1.5,

  /** Patience still drains while you cook, but slowly — they can see you working. */
  cookingPatienceScale: 0.25,

  /** Chance the next customer is a named NPC from the cast rather than a walk-in. */
  namedChance: 0.25,

  /** Recipe pick weights. */
  wCookable: 4.0,        // multiplier when the basket can make it right now
  wFavourite: 6.0,       // multiplier for a named NPC's favourite dish

  /** Tip base fraction of the bill, before upgrades and the rep-tier multiplier. */
  tipBase: 0.15,

  /** Reputation lost when someone walks out: repLossFlat + recipe.rep * repLossScale. */
  repLossFlat: 0.6,
  repLossScale: 0.5,

  /** Satisfaction mix — must sum to 1. */
  satGrade: 0.55,
  satPatience: 0.30,
  satMatch: 0.15,

  /** xp = recipe.xp * (xpFloor + score * xpSpan). */
  xpFloor: 0.6,
  xpSpan: 0.6,

  /** Minimum seconds on a delivery, whatever the deadline maths says. */
  deliveryMinSeconds: 30,
};

/** Roles from npcs.js that plausibly turn up wanting lunch. */
const WALK_IN_ROLES = ['customer', 'resident', 'client', 'tourist', 'staff', 'fisher', 'supplier'];

/** Names for anonymous walk-ins, so the HUD never shows a blank. */
const WALK_IN_NAMES = [
  'Mochi', 'Tofu', 'Sora', 'Nori', 'Kuma', 'Momo', 'Hoshi', 'Anko',
  'Daifuku', 'Shiro', 'Kinako', 'Mugi', 'Tama', 'Cocoa', 'Yuzu-chan',
  'Bean', 'Pudding', 'Sesame', 'Miso', 'Peach',
];

const WALK_IN_FURS = [
  ['#e8a55c', '#c8503f'], ['#f2e4d0', '#d97b6c'], ['#3a3f4a', '#f6c445'],
  ['#b98a52', '#3f5a4a'], ['#cfc7bb', '#7ea36a'], ['#6b6f78', '#3f7fa8'],
  ['#d8c0d8', '#e0508f'], ['#a89478', '#5f97b8'], ['#f0913f', '#3f7fa8'],
  ['#c9b79a', '#6f8f5a'],
];

// ---------------------------------------------------------------------------
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => clamp(Number.isFinite(v) ? v : 0, 0, 1);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const smooth = (t) => { const x = clamp01(t); return x * x * (3 - 2 * x); };

/** A soft rectangular bump: `amp` inside [from,to], smoothly ramping either side. */
function bump(h, { from, to, amp, ramp }) {
  const r = Math.max(0.0001, ramp);
  if (h <= from - r || h >= to + r) return 0;
  if (h >= from && h <= to) return amp;
  const t = h < from ? (h - (from - r)) / r : ((to + r) - h) / r;
  return amp * smooth(t);
}

/**
 * REP_TIERS has no `repMult` column, so we derive one: fame compounds more
 * slowly the more of it you already have, which keeps the late game honest.
 * Stray = 1.00, Known = 0.82, Local = 0.69 ... Legend = 0.43.
 */
function repTierMult(tier) {
  const i = Math.max(0, REP_TIERS.indexOf(tier));
  return 1 / (1 + i * 0.22);
}

function shopTierRow(tier) {
  const t = Math.round(num(tier, 1));
  return SHOP_TIERS.find((r) => r.tier === t) || SHOP_TIERS[0];
}

// ---------------------------------------------------------------------------
export function createOrders(game) {
  const g = game || {};
  const bus = g.bus || { emit() {}, on() { return () => {}; } };
  const state = g.state;
  const rng = typeof g.rng === 'function' ? g.rng : Math.random;

  if (!state) {
    console.warn('[orders] created without game.state — running inert');
  }

  /** @type {object[]} */
  let queue = [];
  let activeId = null;
  let seq = 0;
  let nextIn = 3;                 // seconds until the next spawn attempt
  let lastRate = 0;               // cached for spawnRate() so the HUD is cheap

  const SECS_PER_GAME_HOUR = Math.max(1, PROGRESSION.dayLengthSeconds / 24);

  // ------------------------------------------------------------------ helpers
  const emit = (e, p) => { try { bus.emit(e, p); } catch (err) { console.error('[orders] emit', e, err); } };
  const upVal = (key) => (state && typeof state.upgradeValue === 'function' ? num(state.upgradeValue(key, 0), 0) : 0);
  const hourNow = () => (g.clock
    ? num(g.clock.hourFloat, num(g.clock.hour, 0))
    : num(state && state.clock && state.clock.hour, 0));
  const dayNow = () => (g.clock ? num(g.clock.day, 1) : num(state && state.clock && state.clock.day, 1));

  function shopHours() {
    const s = (state && state.shop) || {};
    return {
      open: num(s.openHour, PROGRESSION.shopOpenHour),
      close: num(s.closeHour, PROGRESSION.shopCloseHour),
    };
  }

  /** True while the wall clock is inside the shop's trading window (wrap-safe). */
  function withinTradingHours() {
    const { open, close } = shopHours();
    const h = hourNow();
    if (open === close) return true;
    return open < close ? (h >= open && h < close) : (h >= open || h < close);
  }

  function isOpenNow() {
    const s = (state && state.shop) || {};
    return !!s.isOpen && withinTradingHours();
  }

  /** City-wide event effects. Events are city moods, not shop-local weather. */
  function effects() {
    try { return eventEffects(dayNow(), hourNow(), null); }
    catch (err) {
      console.error('[orders] eventEffects threw', err);
      return { customerMult: 1, payMult: 1, repMult: 1 };
    }
  }

  function capacity() {
    const tier = shopTierRow(state && state.shop ? state.shop.tier : 1);
    return Math.max(1, Math.round(num(tier.queue, 3) + upVal('queueSize')));
  }

  /** Orders physically standing in the shop (deliveries queue nowhere). */
  function walkInCount() {
    let n = 0;
    for (const o of queue) if (!o.delivery && (o.state === 'waiting' || o.state === 'cooking')) n++;
    return n;
  }

  function find(orderId) {
    if (orderId == null) return null;
    for (const o of queue) if (o.id === orderId) return o;
    return null;
  }

  function requireOrder(orderId, who) {
    const o = find(orderId);
    if (!o) console.warn(`[orders] ${who}: no such order "${orderId}"`);
    return o;
  }

  // ------------------------------------------------------------- spawn rating
  function busyness(h) {
    return TUNE.quiet + bump(h, TUNE.lunch) + bump(h, TUNE.dinner);
  }

  /** Customers per real minute right now. 0 when nobody could arrive. */
  function spawnRate() {
    if (!state || !isOpenNow()) { lastRate = 0; return 0; }
    const tierRow = shopTierRow(state.shop ? state.shop.tier : 1);
    const rep = typeof state.repTier === 'function' ? state.repTier() : REP_TIERS[0];
    const fx = effects();
    const rate = TUNE.baseRate
      * num(rep && rep.customerRate, 1)
      * (1 + Math.max(0, num(tierRow.tier, 1) - 1) * TUNE.tierRate)
      * Math.max(0, num(fx.customerMult, 1))
      * Math.max(0, busyness(hourNow()));
    lastRate = Math.max(0, rate);
    return lastRate;
  }

  // -------------------------------------------------------------- composition
  function pickCustomerType() {
    const rep = state ? num(state.reputation, 0) : 0;
    const pool = CUSTOMER_TYPES.filter((t) => num(t.minRep, 0) <= rep);
    if (!pool.length) return CUSTOMER_TYPES[0];
    let total = 0;
    for (const t of pool) total += Math.max(0, num(t.weight, 1));
    if (total <= 0) return pool[0];
    let r = rng() * total;
    for (const t of pool) { r -= Math.max(0, num(t.weight, 1)); if (r <= 0) return t; }
    return pool[pool.length - 1];
  }

  /** A named cast member, if the dice say so and their district is open. */
  function pickNamedNpc() {
    if (rng() >= TUNE.namedChance) return null;
    const pool = NPCS.filter((n) => {
      if (!n || !WALK_IN_ROLES.includes(n.role)) return false;
      if (state && typeof state.districtUnlocked === 'function' && !state.districtUnlocked(n.district)) return false;
      return true;
    });
    if (!pool.length) return null;
    return pool[Math.floor(rng() * pool.length) % pool.length] || null;
  }

  function makeCustomer(type) {
    const person = pickNamedNpc();
    if (person) {
      return {
        typeId: type.id,
        name: person.name || person.id,
        fur: person.fur || '#e8a55c',
        accent: person.accent || '#c8503f',
        npcId: person.id,
      };
    }
    const i = Math.floor(rng() * WALK_IN_NAMES.length) % WALK_IN_NAMES.length;
    const pal = WALK_IN_FURS[Math.floor(rng() * WALK_IN_FURS.length) % WALK_IN_FURS.length] || WALK_IN_FURS[0];
    return { typeId: type.id, name: WALK_IN_NAMES[i], fur: pal[0], accent: pal[1], npcId: null };
  }

  /**
   * Weighted recipe pick over what the player KNOWS.
   *   base 1  ×wCookable if the basket can make it  ×wFavourite for an NPC's
   *   favourite, and a difficulty affinity that pushes big spenders upmarket.
   */
  function pickRecipe(type, customer) {
    if (!state) return null;
    const known = knownRecipes(state);
    if (!known.length) return null;
    const cookableIds = new Set(cookableRecipes(state).map((r) => r.id));
    const fav = customer && customer.npcId ? (npcById(customer.npcId) || {}).favorite : null;

    const weights = [];
    let total = 0;
    for (const r of known) {
      let w = 1;
      if (cookableIds.has(r.id)) w *= TUNE.wCookable;
      if (fav && r.id === fav) w *= TUNE.wFavourite;
      // Big tippers ask for the harder things; neighbours ask for nigiri.
      w *= 1 + (num(type.payMult, 1) - 1) * ((num(r.difficulty, 1) - 1) / 4);
      w = Math.max(0.0001, w);
      weights.push(w);
      total += w;
    }
    let x = rng() * total;
    for (let i = 0; i < known.length; i++) { x -= weights[i]; if (x <= 0) return known[i]; }
    return known[known.length - 1];
  }

  function rollQty(type) {
    const range = Array.isArray(type.items) ? type.items : [1, 1];
    const lo = Math.max(1, Math.round(num(range[0], 1)));
    const hi = Math.max(lo, Math.round(num(range[1], lo)));
    return lo + Math.floor(rng() * (hi - lo + 1));
  }

  function patienceFor(type, rec, qty) {
    const base = num(type.patience, 120);
    const cook = rec ? recipeTime(rec) : 0;
    return Math.max(15,
      base * (TUNE.patienceBase + TUNE.patiencePerItem * qty) + cook * TUNE.patienceCookGrace);
  }

  // --------------------------------------------------------------- generation
  function makeOrder({ type, customer, rec, qty, patience, delivery = null }) {
    const o = {
      id: `o${++seq}`,
      customer,
      recipeId: rec.id,
      qty,
      placedAt: dayNow() * 24 + hourNow(),
      patience,
      patienceLeft: patience,
      state: 'waiting',
      reward: { base: num(rec.basePrice, 0) * qty, payMult: num(type.payMult, 1) },
      delivery,
    };
    queue.push(o);
    emit(EV.ORDER_NEW, { order: o });
    return o;
  }

  function spawnOne() {
    if (!state) return null;
    if (walkInCount() >= capacity()) return null;
    const type = pickCustomerType();
    if (!type) return null;
    const customer = makeCustomer(type);
    const rec = pickRecipe(type, customer);
    if (!rec) return null;                      // player knows nothing yet
    const qty = rollQty(type);
    return makeOrder({ type, customer, rec, qty, patience: patienceFor(type, rec, qty) });
  }

  function scheduleNext() {
    const rate = spawnRate();
    if (rate <= 0) { nextIn = 1; return; }
    const mean = 60 / rate;
    const j = TUNE.jitter[0] + (TUNE.jitter[1] - TUNE.jitter[0]) * rng();
    nextIn = Math.max(1.5, mean * j);
  }

  // ------------------------------------------------------------------- public
  function take(orderId) {
    const o = requireOrder(orderId, 'take');
    if (!o) return null;
    if (o.state !== 'waiting' && o.state !== 'cooking') {
      console.warn(`[orders] take: order "${orderId}" is ${o.state}`);
      return null;
    }
    if (activeId && activeId !== o.id) {
      const prev = find(activeId);
      if (prev && prev.state === 'cooking') prev.state = 'waiting';
    }
    o.state = 'cooking';
    activeId = o.id;
    return o;
  }

  /** Put a taken order back in the queue (cook aborted). Not a failure. */
  function release(orderId) {
    const o = find(orderId);
    if (!o) return null;
    if (o.state === 'cooking') o.state = 'waiting';
    if (activeId === o.id) activeId = null;
    return o;
  }

  function remove(o) {
    queue = queue.filter((x) => x !== o);
    if (activeId === o.id) activeId = null;
  }

  function serve(orderId, cookResult) {
    const o = requireOrder(orderId, 'serve');
    if (!o) return null;
    if (o.state === 'served' || o.state === 'left') {
      console.warn(`[orders] serve: order "${orderId}" already ${o.state}`);
      return null;
    }
    const rec = recipe(o.recipeId);
    if (!rec) {
      console.warn(`[orders] serve: unknown recipe "${o.recipeId}"`);
      o.state = 'left';
      remove(o);
      return null;
    }

    const cr = cookResult && typeof cookResult === 'object' ? cookResult : {};
    const score = clamp01(num(cr.score, num(cr.quality, 0.7)));
    const grade = gradeFor(score);
    const matched = cr.recipeId == null || cr.recipeId === o.recipeId;
    const servedQty = Math.max(1, Math.round(num(cr.qty, o.qty)));

    const type = CUSTOMER_TYPES.find((t) => t.id === (o.customer && o.customer.typeId))
      || CUSTOMER_TYPES[0];
    const repTier = state && typeof state.repTier === 'function' ? state.repTier() : REP_TIERS[0];
    const fx = effects();

    // --- money ------------------------------------------------------------
    const pay = Math.round(
      num(rec.basePrice, 0) * servedQty
      * num(grade.payMult, 1)
      * num(type.payMult, 1)
      * Math.max(0, num(fx.payMult, 1))
    );

    const tipChance = clamp01(num(type.tipChance, 0) + upVal('tipChance'));
    const tipFrac = TUNE.tipBase + upVal('tipAmount');
    const tip = rng() < tipChance
      ? Math.max(1, Math.round(pay * tipFrac * num(repTier && repTier.tipMult, 1)))
      : 0;

    // --- satisfaction (needed before rep so a wrong dish stings) ------------
    const patienceFrac = o.patience > 0 ? clamp01(o.patienceLeft / o.patience) : 0;
    const satisfaction = clamp01(
      TUNE.satGrade * score
      + TUNE.satPatience * patienceFrac
      + TUNE.satMatch * (matched ? 1 : 0)
    );

    // --- fame + xp ---------------------------------------------------------
    let rep = num(rec.rep, 0) * num(grade.repMult, 0)
      * repTierMult(repTier)
      * Math.max(0, num(fx.repMult, 1));
    if (!matched) rep = rep > 0 ? rep * 0.35 : rep * 1.5;   // wrong dish: little credit, extra blame
    rep = Math.round(rep * 100) / 100;

    const xp = Math.max(1, Math.round(num(rec.xp, 0) * (TUNE.xpFloor + score * TUNE.xpSpan)));

    // --- apply -------------------------------------------------------------
    o.state = 'served';
    o.servedAt = dayNow() * 24 + hourNow();
    o.result = { pay, tip, rep, xp, satisfaction, grade: grade.id, score };
    remove(o);

    if (state) {
      if (pay + tip !== 0) state.addCoins(pay + tip, 'order');
      if (rep) state.addReputation(rep);
      if (xp) state.addXp(xp);
      const today = state.today || {};
      today.served = num(today.served, 0) + 1;
      today.tips = num(today.tips, 0) + tip;
      const stats = state.stats || {};
      stats.ordersServed = num(stats.ordersServed, 0) + 1;
      if (grade.id === 'perfect') stats.perfectOrders = num(stats.perfectOrders, 0) + 1;
      if (o.customer && o.customer.npcId && typeof state.addRelationship === 'function') {
        state.addRelationship(o.customer.npcId, Math.round(1 + satisfaction * 3));
      }
    }

    emit(EV.ORDER_SERVED, {
      order: o, quality: grade.id, grade, score, pay, tip, rep, xp, satisfaction, matched,
    });
    return { pay, tip, rep, xp, satisfaction };
  }

  /**
   * Drop an order. `reason` decides whether it costs the shop anything:
   * 'patience' | 'timeout' | 'wrong' hurt; everything else is a clean exit.
   */
  function cancel(orderId, reason = 'cancelled') {
    const o = requireOrder(orderId, 'cancel');
    if (!o) return null;
    if (o.state === 'served' || o.state === 'left') return null;

    const punish = reason === 'patience' || reason === 'timeout' || reason === 'wrong';
    o.state = 'left';
    remove(o);

    if (punish && state) {
      const rec = recipe(o.recipeId);
      const loss = TUNE.repLossFlat + num(rec && rec.rep, 1) * TUNE.repLossScale;
      state.addReputation(-Math.round(loss * 100) / 100);
      const stats = state.stats || {};
      stats.failedOrders = num(stats.failedOrders, 0) + 1;
    }

    emit(EV.ORDER_FAILED, { order: o, reason });
    return o;
  }

  /** Injected by the delivery system. Deliveries never occupy a queue slot. */
  function addDeliveryOrder(spec) {
    if (!spec || typeof spec !== 'object') { console.warn('[orders] addDeliveryOrder needs a spec'); return null; }
    if (!state) return null;

    const rec = recipe(spec.recipeId) || pickRecipe(CUSTOMER_TYPES[0], null);
    if (!rec) { console.warn('[orders] addDeliveryOrder: no usable recipe'); return null; }

    const type = CUSTOMER_TYPES.find((t) => t.id === spec.typeId) || CUSTOMER_TYPES[0];
    const person = spec.toNpcId ? npcById(spec.toNpcId) : null;
    const customer = spec.customer || (person
      ? { typeId: type.id, name: person.name, fur: person.fur, accent: person.accent, npcId: person.id }
      : makeCustomer(type));

    const qty = Math.max(1, Math.round(num(spec.qty, 1)));

    // Deadline may be an absolute in-game hour; otherwise take explicit seconds.
    let secs = num(spec.patience, NaN);
    if (!Number.isFinite(secs)) {
      const deadline = num(spec.deadline, NaN);
      if (Number.isFinite(deadline)) {
        const nowAbs = dayNow() * 24 + hourNow();
        secs = (deadline - nowAbs) * SECS_PER_GAME_HOUR;
      }
    }
    if (!Number.isFinite(secs)) secs = patienceFor(type, rec, qty);
    secs = Math.max(TUNE.deliveryMinSeconds, secs + upVal('deliveryTime'));

    return makeOrder({
      type, customer, rec, qty, patience: secs,
      delivery: {
        toNpcId: spec.toNpcId || (person ? person.id : null),
        x: num(spec.x, person && person.home ? person.home.x : 0),
        z: num(spec.z, person && person.home ? person.home.z : 0),
        deadline: num(spec.deadline, dayNow() * 24 + hourNow() + secs / SECS_PER_GAME_HOUR),
      },
    });
  }

  // ------------------------------------------------------------- open / close
  function openShop() {
    if (!state || !state.shop) return false;
    if (state.shop.isOpen) return true;
    state.shop.isOpen = true;
    nextIn = Math.min(nextIn, 4);
    emit(EV.TOAST, { text: 'Shop open!', icon: '🏮', tone: 'good' });
    return true;
  }

  function closeShop() {
    if (!state || !state.shop) return false;
    if (!state.shop.isOpen) return true;
    state.shop.isOpen = false;
    // Politely send the standing queue home — no penalty for closing on time.
    for (const o of queue.slice()) {
      if (!o.delivery && o.state === 'waiting') cancel(o.id, 'closing');
    }
    emit(EV.TOAST, { text: 'Shop closed', icon: '🌙', tone: '' });
    return true;
  }

  // -------------------------------------------------------------------- frame
  function update(dt) {
    const d = clamp(num(dt, 0), 0, 0.25);
    if (!state || d <= 0) return;

    // Patience.
    for (const o of queue.slice()) {
      if (o.state !== 'waiting' && o.state !== 'cooking') continue;
      const scale = o.state === 'cooking' ? TUNE.cookingPatienceScale : 1;
      o.patienceLeft -= d * scale;
      if (o.patienceLeft <= 0) {
        o.patienceLeft = 0;
        cancel(o.id, 'patience');
      }
    }

    // Auto-close when the trading window ends, so the player can walk away.
    if (state.shop && state.shop.isOpen && !withinTradingHours()) closeShop();

    // Generation.
    if (!isOpenNow()) { lastRate = 0; nextIn = Math.min(nextIn, 2); return; }
    nextIn -= d;
    if (nextIn <= 0) {
      if (walkInCount() < capacity()) spawnOne();
      scheduleNext();
    } else {
      spawnRate();                                  // keeps lastRate fresh for the HUD
    }
  }

  function reset() {
    queue = [];
    activeId = null;
    seq = 0;
    nextIn = 3;
    lastRate = 0;
  }

  return {
    update,
    get queue() { return queue; },
    get active() { return activeId ? find(activeId) : null; },
    take,
    release,
    serve,
    cancel,
    addDeliveryOrder,
    openShop,
    closeShop,
    get isOpen() { return isOpenNow(); },
    spawnRate,
    reset,
    // read-only extras the HUD / restaurant find useful
    get capacity() { return capacity(); },
    find,
    get lastRate() { return lastRate; },
  };
}

export default createOrders;
