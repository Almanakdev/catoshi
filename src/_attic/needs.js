// Character stats / needs + the money economy that feeds them.
//
// Four needs run 0-100 and decay on their own; money is spent at places around
// the city to push them back up. Everything a designer would want to tune lives
// in the two tables at the top — DECAY and SERVICES — and nothing else in the
// file hard-codes a rate or a price.
//
// The model is deliberately UI-free apart from the HUD panel it owns: other
// systems (missions, quests, items) drive it through add() / spend() / earn()
// rather than touching the numbers.

// ---------------------------------------------------------------------------
// TUNING — rates are points per second unless noted.
// ---------------------------------------------------------------------------
export const DECAY = {
  // Hunger empties in ~6 real minutes of not eating.
  hunger: 100 / 360,

  // Energy is activity-driven: a base burn plus more while walking, more again
  // while sprinting. Standing still still costs a trickle.
  energyIdle: 100 / 900,
  energyWalk: 100 / 420,
  energyRun: 100 / 170,

  // Happiness drifts down on its own — go and do something.
  happiness: 100 / 1100,

  // Health. It only falls while a need is actually empty, and heals back when
  // you're fed and rested, so neglect is recoverable rather than a death spiral.
  healthPerEmptyNeed: 100 / 90,
  healthRegen: 100 / 300,
  healthRegenAbove: 40,   // hunger AND energy must both be over this to heal

  // Sitting on a bench restores energy over time rather than instantly.
  restEnergyPerSec: 100 / 12,
  restHappinessPerSec: 100 / 60,
};

export const ECONOMY = {
  startingMoney: 140,
  // A small daily stipend so the city is never unplayable when you run dry.
  // Missions can call earn() for real income.
  dailyStipend: 65,
};

// What each kind of place sells. `need` caps stop you buying food at 99 hunger.
// `cost` of 0 is free. Keys match the shop `type` from city.js.
export const SERVICES = {
  // --- food ---------------------------------------------------------------
  minimarket: { kind: 'eat', verb: 'grab a snack', cost: 8, give: { hunger: 45, happiness: 4 } },
  bakery:     { kind: 'eat', verb: 'buy a pastry', cost: 7, give: { hunger: 30, happiness: 10, energy: 6 } },
  cafe:       { kind: 'eat', verb: 'get a coffee', cost: 6, give: { hunger: 20, happiness: 10, energy: 16 } },
  fastfood:   { kind: 'eat', verb: 'eat', cost: 11, give: { hunger: 55, happiness: 8 } },
  diner:      { kind: 'eat', verb: 'eat', cost: 16, give: { hunger: 65, happiness: 12 } },
  restaurant: { kind: 'eat', verb: 'eat ramen', cost: 19, give: { hunger: 75, happiness: 16 } },
  pub:        { kind: 'eat', verb: 'have a drink', cost: 14, give: { hunger: 22, happiness: 22, energy: -6 } },

  // --- entertainment ------------------------------------------------------
  arcade:  { kind: 'fun', verb: 'play', cost: 12, give: { happiness: 26, energy: -6 } },
  cinema:  { kind: 'fun', verb: 'watch a film', cost: 15, give: { happiness: 32, energy: 4 } },
  bowling: { kind: 'fun', verb: 'bowl a game', cost: 16, give: { happiness: 28, energy: -10 } },
  golf:    { kind: 'fun', verb: 'play a round', cost: 14, give: { happiness: 24, energy: -12 } },

  // --- rest (free, and held down rather than a one-shot) ------------------
  bench: { kind: 'rest', verb: 'sit and rest', cost: 0, hold: true },
};

// Needs above this can't be topped up further — stops prompt-spamming a full bar.
const FULL_LIMIT = 96;
// Seconds between two purchases at the same counter.
const BUY_COOLDOWN = 1.2;

const STATS = [
  { key: 'health',    label: 'Health',    color: '#e2564f', low: '#ff3b30' },
  { key: 'hunger',    label: 'Hunger',    color: '#e5a13a', low: '#ff8a1f' },
  { key: 'happiness', label: 'Happiness', color: '#4fb3e2', low: '#3aa0ff' },
  { key: 'energy',    label: 'Energy',    color: '#6bcf7a', low: '#38d16b' },
];

const clamp = (v) => Math.max(0, Math.min(100, v));

export function createNeeds(opts = {}) {
  const { onFlash = () => {} } = opts;

  const stat = { health: 100, hunger: 82, happiness: 78, energy: 90 };
  let money = ECONOMY.startingMoney;
  let cooldown = 0;

  // ---- HUD ---------------------------------------------------------------
  const root = document.getElementById('needs');
  const moneyEl = document.getElementById('needs-money');
  const bars = {};
  if (root) {
    const list = document.getElementById('needs-list');
    for (const s of STATS) {
      const row = document.createElement('div');
      row.className = 'need-row';
      row.innerHTML =
        `<span class="need-name">${s.label}</span>` +
        '<span class="need-track"><span class="need-fill"></span></span>' +
        '<span class="need-val"></span>';
      list.appendChild(row);
      bars[s.key] = { fill: row.querySelector('.need-fill'), val: row.querySelector('.need-val'), row, def: s };
    }
  }

  let hudAcc = 0;
  function renderHUD() {
    if (!root) return;
    for (const s of STATS) {
      const b = bars[s.key];
      const v = stat[s.key];
      b.fill.style.width = `${v}%`;
      b.fill.style.background = v <= 20 ? s.low : s.color;
      b.val.textContent = Math.round(v);
      b.row.classList.toggle('critical', v <= 20);
    }
    if (moneyEl) moneyEl.textContent = `$${Math.floor(money)}`;
  }

  // ---- decay -------------------------------------------------------------
  // `activity` is 0 standing, 1 walking, 2 sprinting — the controller's speed
  // maps onto it in main.js.
  function update(dt, activity = 0, resting = false) {
    if (cooldown > 0) cooldown -= dt;

    stat.hunger = clamp(stat.hunger - DECAY.hunger * dt);
    stat.happiness = clamp(stat.happiness - DECAY.happiness * dt);

    if (resting) {
      stat.energy = clamp(stat.energy + DECAY.restEnergyPerSec * dt);
      stat.happiness = clamp(stat.happiness + DECAY.restHappinessPerSec * dt);
    } else {
      const burn = activity >= 2 ? DECAY.energyRun : activity >= 1 ? DECAY.energyWalk : DECAY.energyIdle;
      stat.energy = clamp(stat.energy - burn * dt);
    }

    // Health: one penalty per empty need, so being both starving and exhausted
    // hurts twice as fast.
    let empty = 0;
    if (stat.hunger <= 0) empty++;
    if (stat.energy <= 0) empty++;
    if (empty > 0) {
      stat.health = clamp(stat.health - DECAY.healthPerEmptyNeed * empty * dt);
    } else if (stat.hunger > DECAY.healthRegenAbove && stat.energy > DECAY.healthRegenAbove) {
      stat.health = clamp(stat.health + DECAY.healthRegen * dt);
    }

    hudAcc += dt;
    if (hudAcc > 0.1) { hudAcc = 0; renderHUD(); }
  }

  // ---- public API for other systems --------------------------------------
  const api = {
    update,
    show() { if (root) root.classList.add('show'); renderHUD(); },

    get(key) { return key ? stat[key] : { ...stat, money }; },
    /** Add (or subtract, with a negative) to one need. Clamped 0-100. */
    add(key, amount) {
      if (!(key in stat)) return 0;
      const before = stat[key];
      stat[key] = clamp(before + amount);
      renderHUD();
      return stat[key] - before;
    },
    set(key, value) { if (key in stat) { stat[key] = clamp(value); renderHUD(); } },

    get money() { return money; },
    earn(amount) { money += amount; renderHUD(); return money; },
    canAfford(amount) { return money >= amount; },
    /** Spend if affordable. Returns true when the money actually left. */
    spend(amount) {
      if (money < amount) return false;
      money -= amount;
      renderHUD();
      return true;
    },

    // ---- services -------------------------------------------------------
    serviceFor(type) { return SERVICES[type] || null; },

    /**
     * Can this service be used right now? Returns a reason string when not, so
     * the prompt can explain itself ("Too full", "Need $12").
     */
    checkService(type) {
      const svc = SERVICES[type];
      if (!svc) return { ok: false, reason: null };
      if (cooldown > 0) return { ok: false, reason: null };
      if (svc.cost > money) return { ok: false, reason: `Need $${svc.cost}` };
      if (svc.give) {
        // If every need it would raise is already full, don't offer it.
        const raises = Object.entries(svc.give).filter(([, v]) => v > 0);
        if (raises.length && raises.every(([k]) => stat[k] >= FULL_LIMIT)) {
          return { ok: false, reason: 'Not needed right now' };
        }
      }
      return { ok: true, reason: null };
    },

    /** Buy/use a service. Returns a summary for the toast, or null. */
    useService(type) {
      const svc = SERVICES[type];
      if (!svc || svc.hold) return null;
      const check = api.checkService(type);
      if (!check.ok) return null;
      if (svc.cost > 0 && !api.spend(svc.cost)) return null;
      cooldown = BUY_COOLDOWN;

      const gained = [];
      for (const [k, v] of Object.entries(svc.give || {})) {
        const d = api.add(k, v);
        if (Math.abs(d) >= 1) gained.push(`${d > 0 ? '+' : ''}${Math.round(d)} ${k}`);
      }
      const summary = { cost: svc.cost, gained };
      onFlash(summary);
      return summary;
    },

    /** Called once per in-game day rollover. */
    payStipend() {
      api.earn(ECONOMY.dailyStipend);
      return ECONOMY.dailyStipend;
    },
  };
  return api;
}
