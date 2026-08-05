// Central, fully serialisable game state for Catushi.
//
// Rules:
//  - `state.data` is a plain JSON-safe object. Nothing in here may hold a
//    THREE object, a DOM node or a function. That is what makes saving cheap.
//  - Every mutation goes through a method so the event bus stays truthful.
//  - Content (recipes, prices, quests) lives in src/data/*, never here.

import { EV } from './bus.js';
import { RECIPES } from '../data/recipes.js';
import { PROGRESSION, REP_TIERS, LEVEL_CURVE } from '../data/progression.js';
import { DISTRICTS } from '../data/districts.js';

export const SAVE_VERSION = 1;

const START_DISTRICT = 'old_market';

export function defaultData() {
  return {
    version: SAVE_VERSION,
    createdAt: 0,
    playedSeconds: 0,

    player: { x: 0, y: 0, z: 0, yaw: Math.PI, district: START_DISTRICT },
    clock: { day: 1, hour: PROGRESSION.dayStartHour },

    coins: PROGRESSION.startingCoins,
    reputation: 0,
    xp: 0,
    level: 1,
    stamina: PROGRESSION.baseStamina,

    // [{ id, qty, quality (0..1), freshness (0..1) }]
    inventory: [],

    recipes: RECIPES.filter((r) => !r.unlock || r.unlock.free).map((r) => r.id),

    quests: { active: {}, done: [], offered: [] },

    shop: {
      tier: 1,
      upgrades: {},           // upgradeId -> level
      decorations: [],        // [{ id, x, z, yaw }]
      openHour: PROGRESSION.shopOpenHour,
      closeHour: PROGRESSION.shopCloseHour,
      isOpen: false,
    },

    relationships: {},        // npcId -> 0..100
    districts: [START_DISTRICT],
    tools: ['knife_basic'],

    stats: {
      ordersServed: 0,
      perfectOrders: 0,
      failedOrders: 0,
      fishCaught: 0,
      deliveries: 0,
      totalEarned: 0,
      totalSpent: 0,
      daysPlayed: 1,
    },

    today: { earned: 0, spent: 0, served: 0, tips: 0, rep: 0 },

    settings: {
      master: 0.8, music: 0.55, sfx: 0.9,
      quality: 1,             // 0 low, 1 medium, 2 high
      uiScale: 1,
      invertY: false,
      showHints: true,
      cameraShake: false,
      tutorial: true,         // day-one tutorial; flip back on to replay it
    },

    flags: {},
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createState(bus) {
  let data = defaultData();

  // ---------------------------------------------------------------- helpers
  const emit = (e, p) => bus && bus.emit(e, p);

  function repTier() {
    let tier = REP_TIERS[0];
    for (const t of REP_TIERS) if (data.reputation >= t.min) tier = t;
    return tier;
  }

  function xpForLevel(l) {
    return Math.round(LEVEL_CURVE.base * Math.pow(l, LEVEL_CURVE.exp));
  }

  function staminaMax() {
    return PROGRESSION.baseStamina + upgradeValue('stamina', 0);
  }

  /** Summed numeric effect of every owned upgrade that declares `key`. */
  function upgradeValue(key, fallback = 0) {
    let sum = fallback;
    const owned = data.shop.upgrades;
    for (const id in owned) {
      const lvl = owned[id];
      const up = UPGRADE_INDEX[id];
      if (!up || !up.effects || up.effects[key] == null) continue;
      sum += up.effects[key] * lvl;
    }
    return sum;
  }

  // Lazily filled by registerUpgrades() so state.js does not import the
  // upgrade table directly (avoids a data<->state import cycle).
  let UPGRADE_INDEX = Object.create(null);
  function registerUpgrades(list) {
    UPGRADE_INDEX = Object.create(null);
    for (const u of list || []) UPGRADE_INDEX[u.id] = u;
  }

  // ---------------------------------------------------------------- economy
  function addCoins(n, reason = '') {
    n = Math.round(n);
    if (!n) return data.coins;
    data.coins = Math.max(0, data.coins + n);
    if (n > 0) { data.stats.totalEarned += n; data.today.earned += n; }
    else { data.stats.totalSpent += -n; data.today.spent += -n; }
    emit(EV.COINS, { coins: data.coins, delta: n, reason });
    return data.coins;
  }

  function canAfford(n) { return data.coins >= Math.round(n); }

  function spendCoins(n, reason = '') {
    n = Math.round(n);
    if (n <= 0) return true;
    if (data.coins < n) return false;
    addCoins(-n, reason);
    return true;
  }

  function addReputation(n) {
    if (!n) return data.reputation;
    const before = repTier();
    data.reputation = clamp(data.reputation + n, 0, PROGRESSION.maxReputation);
    data.today.rep += n;
    const tier = repTier();
    emit(EV.REPUTATION, { reputation: data.reputation, delta: n, tier });
    if (tier.id !== before.id) {
      emit(EV.TOAST, { text: `Reputation: ${tier.name}!`, icon: '⭐', tone: 'good' });
      checkDistrictUnlocks();
    }
    return data.reputation;
  }

  function addXp(n) {
    if (!n) return data.xp;
    data.xp += n;
    let leveledUp = false;
    while (data.level < LEVEL_CURVE.max && data.xp >= xpForLevel(data.level)) {
      data.xp -= xpForLevel(data.level);
      data.level++;
      leveledUp = true;
    }
    emit(EV.XP, { xp: data.xp, level: data.level, next: xpForLevel(data.level), leveledUp });
    if (leveledUp) emit(EV.TOAST, { text: `Chef level ${data.level}!`, icon: '🍣', tone: 'good' });
    return data.xp;
  }

  function addStamina(n) {
    const max = staminaMax();
    data.stamina = clamp(data.stamina + n, 0, max);
    emit(EV.STAMINA, { stamina: data.stamina, max });
    return data.stamina;
  }

  // -------------------------------------------------------------- inventory
  function invCapacity() { return PROGRESSION.baseInventory + upgradeValue('inventory', 0); }

  function invCount() {
    let n = 0;
    for (const it of data.inventory) n += it.qty;
    return n;
  }

  /** Items stack when id + rounded quality band match, so freshness averages. */
  function addItem(id, qty = 1, { quality = 0.7, freshness = 1 } = {}) {
    qty = Math.max(0, Math.floor(qty));
    if (!qty) return 0;
    const room = invCapacity() - invCount();
    if (room <= 0) {
      emit(EV.TOAST, { text: 'Basket is full', icon: '🧺', tone: 'bad' });
      return 0;
    }
    const take = Math.min(qty, room);
    const band = Math.round(quality * 4) / 4;
    const slot = data.inventory.find((s) => s.id === id && Math.round(s.quality * 4) / 4 === band);
    if (slot) {
      const total = slot.qty + take;
      slot.freshness = (slot.freshness * slot.qty + freshness * take) / total;
      slot.quality = (slot.quality * slot.qty + quality * take) / total;
      slot.qty = total;
    } else {
      data.inventory.push({ id, qty: take, quality, freshness });
    }
    emit(EV.ITEM_GAINED, { id, qty: take, quality, freshness });
    emit(EV.INVENTORY, { items: data.inventory, count: invCount(), capacity: invCapacity() });
    if (take < qty) emit(EV.TOAST, { text: 'Basket is full', icon: '🧺', tone: 'bad' });
    return take;
  }

  function countItem(id) {
    let n = 0;
    for (const it of data.inventory) if (it.id === id) n += it.qty;
    return n;
  }

  function hasItems(list) {
    for (const need of list) if (countItem(need.id) < (need.qty || 1)) return false;
    return true;
  }

  /** Consumes freshest-first and returns the weighted average quality used. */
  function removeItem(id, qty = 1) {
    qty = Math.floor(qty);
    if (qty <= 0) return { taken: 0, quality: 0, freshness: 0 };
    const slots = data.inventory.filter((s) => s.id === id)
      .sort((a, b) => (b.freshness * 0.6 + b.quality * 0.4) - (a.freshness * 0.6 + a.quality * 0.4));
    let need = qty, taken = 0, qAcc = 0, fAcc = 0;
    for (const s of slots) {
      if (need <= 0) break;
      const t = Math.min(s.qty, need);
      qAcc += s.quality * t; fAcc += s.freshness * t;
      s.qty -= t; need -= t; taken += t;
    }
    data.inventory = data.inventory.filter((s) => s.qty > 0);
    if (taken) {
      emit(EV.ITEM_LOST, { id, qty: taken });
      emit(EV.INVENTORY, { items: data.inventory, count: invCount(), capacity: invCapacity() });
    }
    return { taken, quality: taken ? qAcc / taken : 0, freshness: taken ? fAcc / taken : 0 };
  }

  /** Called once per in-game hour: ingredients slowly lose freshness. */
  function decayFreshness(hours) {
    const rate = PROGRESSION.freshnessLossPerHour * Math.max(0, 1 - upgradeValue('freshness', 0));
    let changed = false;
    for (const s of data.inventory) {
      const nf = clamp(s.freshness - rate * hours, PROGRESSION.freshnessFloor, 1);
      if (nf !== s.freshness) { s.freshness = nf; changed = true; }
    }
    if (changed) emit(EV.INVENTORY, { items: data.inventory, count: invCount(), capacity: invCapacity() });
  }

  // ---------------------------------------------------------------- recipes
  function knowsRecipe(id) { return data.recipes.includes(id); }
  function unlockRecipe(id) {
    if (knowsRecipe(id)) return false;
    data.recipes.push(id);
    const r = RECIPES.find((x) => x.id === id);
    emit(EV.RECIPE_UNLOCKED, { id, name: r ? r.name : id });
    emit(EV.TOAST, { text: `New recipe: ${r ? r.name : id}`, icon: '📖', tone: 'good' });
    return true;
  }

  // ---------------------------------------------------------- relationships
  function relationship(npcId) { return data.relationships[npcId] || 0; }
  function addRelationship(npcId, n) {
    const before = relationship(npcId);
    const now = clamp(before + n, 0, 100);
    data.relationships[npcId] = now;
    if (now !== before) emit(EV.RELATIONSHIP, { npcId, level: now, delta: now - before });
    return now;
  }

  // -------------------------------------------------------------- districts
  function districtUnlocked(id) { return data.districts.includes(id); }
  function unlockDistrict(id) {
    if (districtUnlocked(id)) return false;
    data.districts.push(id);
    const d = DISTRICTS.find((x) => x.id === id);
    emit(EV.DISTRICT_UNLOCK, { id, name: d ? d.name : id });
    emit(EV.TOAST, { text: `${d ? d.name : id} unlocked!`, icon: '🗺️', tone: 'good' });
    return true;
  }
  function checkDistrictUnlocks() {
    for (const d of DISTRICTS) {
      if (districtUnlocked(d.id)) continue;
      const req = d.unlock || {};
      if (req.reputation != null && data.reputation < req.reputation) continue;
      if (req.quest && !questDone(req.quest)) continue;
      if (req.shopTier != null && data.shop.tier < req.shopTier) continue;
      unlockDistrict(d.id);
    }
  }

  // ----------------------------------------------------------------- quests
  function questDone(id) { return data.quests.done.includes(id); }
  function questActive(id) { return !!data.quests.active[id]; }

  // ------------------------------------------------------------------ flags
  function flag(key) { return !!data.flags[key]; }
  function setFlag(key, v = true) { data.flags[key] = v; return v; }

  // -------------------------------------------------------------- upgrades
  function upgradeLevel(id) { return data.shop.upgrades[id] || 0; }
  function setUpgradeLevel(id, lvl) {
    data.shop.upgrades[id] = lvl;
    emit(EV.SHOP_UPGRADED, { id, level: lvl, tier: data.shop.tier });
  }
  function setShopTier(tier) {
    if (tier <= data.shop.tier) return false;
    data.shop.tier = tier;
    emit(EV.SHOP_UPGRADED, { id: 'tier', level: tier, tier });
    checkDistrictUnlocks();
    return true;
  }

  // ------------------------------------------------------------------ clock
  function setClock(day, hour) {
    data.clock.day = day;
    data.clock.hour = hour;
  }

  function resetToday() { data.today = { earned: 0, spent: 0, served: 0, tips: 0, rep: 0 }; }

  // ------------------------------------------------------------ (de)serialise
  function toJSON() {
    data.version = SAVE_VERSION;
    return JSON.parse(JSON.stringify(data));
  }

  /** Merge a loaded blob over defaults so old saves never miss new fields. */
  function fromJSON(obj) {
    const base = defaultData();
    data = deepMerge(base, obj || {});
    data.version = SAVE_VERSION;
    // Re-emit everything so UI rebuilds from scratch.
    emit(EV.COINS, { coins: data.coins, delta: 0, reason: 'load' });
    emit(EV.REPUTATION, { reputation: data.reputation, delta: 0, tier: repTier() });
    emit(EV.XP, { xp: data.xp, level: data.level, next: xpForLevel(data.level), leveledUp: false });
    emit(EV.STAMINA, { stamina: data.stamina, max: staminaMax() });
    emit(EV.INVENTORY, { items: data.inventory, count: invCount(), capacity: invCapacity() });
    return data;
  }

  return {
    get data() { return data; },
    // economy
    addCoins, spendCoins, canAfford,
    get coins() { return data.coins; },
    addReputation, get reputation() { return data.reputation; }, repTier,
    addXp, get xp() { return data.xp; }, get level() { return data.level; }, xpForLevel,
    addStamina, get stamina() { return data.stamina; }, staminaMax,
    // inventory
    addItem, removeItem, countItem, hasItems, invCount, invCapacity, decayFreshness,
    get inventory() { return data.inventory; },
    // content
    knowsRecipe, unlockRecipe,
    relationship, addRelationship,
    districtUnlocked, unlockDistrict, checkDistrictUnlocks,
    questDone, questActive,
    flag, setFlag,
    upgradeLevel, setUpgradeLevel, setShopTier, upgradeValue, registerUpgrades,
    get shop() { return data.shop; },
    // clock
    setClock, get clock() { return data.clock; }, resetToday,
    get settings() { return data.settings; },
    get stats() { return data.stats; },
    get today() { return data.today; },
    // persistence
    toJSON, fromJSON,
  };
}

/** Recursive merge that keeps arrays from `src` wholesale (saves are authoritative). */
function deepMerge(base, src) {
  if (Array.isArray(base)) return Array.isArray(src) ? src.slice() : base;
  if (base && typeof base === 'object') {
    const out = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(src || {})]);
    for (const k of keys) {
      const b = base[k];
      const s = src ? src[k] : undefined;
      if (s === undefined) out[k] = b;
      else if (b && typeof b === 'object' && !Array.isArray(b)) out[k] = deepMerge(b, s);
      else out[k] = Array.isArray(b) ? (Array.isArray(s) ? s.slice() : b) : s;
    }
    return out;
  }
  return src === undefined ? base : src;
}
