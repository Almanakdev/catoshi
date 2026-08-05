// Delivery missions.
//
// A delivery is a small errand loop: take a job from the board, cook the dish
// it asks for, carry it across the city before it goes cold, hand it over.
//
// The important rule is that the FOOD IS PHYSICAL. A mission only arms itself
// when the player actually cooks a matching recipe — at that moment a package
// mesh is attached to the cat's carryAnchor, the cat switches to the 'carry'
// action, and freshness starts draining faster than it would in the basket.
// Arriving late, or arriving with a limp package, drops the grade and the pay.

import { EV } from './bus.js';
import * as UI from '../ui/kit.js';
import { recipe as recipeById, RECIPES } from '../data/recipes.js';
import { PROGRESSION, QUALITY_GRADES, gradeFor } from '../data/progression.js';
import { DISTRICTS, districtById, HOME } from '../data/districts.js';
import { NPCS, npc as npcById, npcPositionAt } from '../data/npcs.js';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

const TUNING = {
  arriveRadius: 2.8,
  carryFreshnessMult: 3.0,   // vs. sitting in the basket
  keepWarmFloor: 0.62,       // 'keep it warm' twist fails below this freshness
  runSpeed: 4.6,             // m/s that counts as running for 'don't run'
  runGraceSeconds: 1.1,      // how long you may sprint before the twist breaks
  lateMaxPenalty: 0.35,
  latePenaltySeconds: 120,
  // How long past the deadline (plus grace) before they stop waiting at all.
  // Comfortably longer than latePenaltySeconds so "late but delivered" is the
  // normal outcome and an outright failure takes real neglect.
  expireAfterSeconds: 190,
  boardSlots: 3,
  boardSlotsPerTier: 1,
  baseDeadline: 105,         // seconds, before distance + grace
  secondsPerMetre: 0.55,
};

/** Coin/rep weight per district — the far side of town pays better. */
const DISTRICT_PAY = {
  old_market: 1.00,
  residential: 1.06,
  fish_harbor: 1.12,
  downtown: 1.26,
  neon_street: 1.42,
};

const TWISTS = [
  null,
  { id: 'keep_warm', label: 'Keep it warm', icon: '♨️', pay: 0.12, hint: 'Do not let it go cold on the way.' },
  { id: 'no_run',    label: 'Do not run',   icon: '🍶', pay: 0.10, hint: 'It will spill. Walk it over.' },
];

const WEATHERS = [null, { id: 'rain', label: 'Rain run', icon: '🌧️', pay: 0.10 }];

const TIME_WINDOWS = [
  { id: 'morning', label: 'Morning', from: 7,  to: 11 },
  { id: 'lunch',   label: 'Lunch',   from: 11, to: 15 },
  { id: 'evening', label: 'Evening', from: 17, to: 21 },
  { id: 'night',   label: 'Late',    from: 21, to: 26 },
];

const gradeRank = (id) => {
  const i = QUALITY_GRADES.findIndex((g) => g.id === id);
  return i < 0 ? QUALITY_GRADES.length - 1 : i;
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v) => clamp(v, 0, 1);

// ---------------------------------------------------------------------------

export function createDelivery(game) {
  const THREE = game.THREE;
  const bus = game.bus;
  const state = game.state;
  const rng = typeof game.rng === 'function' ? game.rng : Math.random;

  /** @type {Map<string, object>} */
  const missions = new Map();
  let seq = 0;
  let lastDay = -1;
  let lastPair = { toNpc: null, recipeId: null };
  let lastWindow = null;
  let boardHandle = null;
  let boardDef = null;
  let boardOffer = null;          // for the no-panel fallback flow

  // The carried package (one at a time — the cat has one pair of paws).
  let pkg = null;                 // { missionId, mesh, quality, freshness, geos, mats }
  const unsubs = [];
  const _prevPos = THREE ? new THREE.Vector3() : null;
  let hasPrevPos = false;
  let runTimer = 0;

  // ------------------------------------------------------------------ utils
  const toast = (text, opts = {}) => {
    if (bus) bus.emit(EV.TOAST, { text, icon: opts.icon || '📦', tone: opts.tone || '' });
    else UI.toast(text, opts);
  };
  const sfx = (name) => {
    const a = game.audio;
    if (a && typeof a.play === 'function') { try { a.play(name); } catch (e) { /* silent */ } }
  };
  const graceSeconds = () => (typeof state.upgradeValue === 'function'
    ? Math.max(0, state.upgradeValue('deliveryTime', 0)) : 0);
  const hoursPerSecond = () => 24 / Math.max(60, PROGRESSION.dayLengthSeconds || 900);
  const playerPos = () => (game.player && game.player.position) || null;
  const raining = () => !!(game.weather && game.weather.raining);

  function unlockedDistricts() {
    return DISTRICTS.filter((d) => state.districtUnlocked(d.id));
  }

  function npcSpot(id) {
    const rec = npcById(id);
    if (!rec) return { x: 0, z: 0 };
    const hour = game.clock ? game.clock.hour : 12;
    const p = npcPositionAt(rec, hour) || rec.home || { x: 0, z: 0 };
    return { x: p.x, z: p.z };
  }

  function shopOrigin() {
    const p = playerPos();
    if (p) return { x: p.x, z: p.z };
    return { x: HOME.shop.x, z: HOME.shop.z };
  }

  function dist2d(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

  // =========================================================================
  // Reward formula
  // =========================================================================
  /**
   * Base (advertised) reward. The actual payout is this scaled by the grade
   * the package arrives in — see `settle()`.
   */
  function computeReward({ recipeId, qty, district, distance, deadline, twist, weather }) {
    const rec = recipeById(recipeId);
    const base = (rec ? rec.basePrice : 40) * qty;
    const legFee = Math.round(distance * TUNING.secondsPerMetre);
    const dMult = DISTRICT_PAY[district] != null ? DISTRICT_PAY[district] : 1;
    const twistMult = 1 + (twist ? twist.pay : 0) + (weather ? weather.pay : 0);
    const urgency = deadline ? 1.18 : 1;
    const tier = state.repTier ? state.repTier() : null;
    const repMult = tier ? 0.9 + (tier.tipMult - 1) * 0.6 + 0.1 : 1;

    const coins = Math.round((base * 0.55 + legFee) * dMult * twistMult * urgency * repMult);
    const rep = Math.max(1, Math.round((1 + qty * 0.7 + (rec ? rec.rep * 0.4 : 0)) * dMult * twistMult));
    const xp = Math.round((6 + qty * 3 + distance * 0.05) * twistMult + (rec ? rec.xp * 0.25 : 0));
    const relationship = Math.round(2 + (deadline ? 1 : 0) + (twist ? 1 : 0));
    return { coins, rep, xp, relationship };
  }

  // =========================================================================
  // Package mesh
  // =========================================================================
  function buildPackageMesh(rec) {
    if (!THREE) return null;
    const geos = [];
    const mats = [];
    const g = new THREE.Group();
    g.name = 'deliveryPackage';

    const boxGeo = new THREE.BoxGeometry(0.34, 0.20, 0.26);
    const lidGeo = new THREE.BoxGeometry(0.36, 0.05, 0.28);
    const bandGeo = new THREE.BoxGeometry(0.37, 0.215, 0.05);
    geos.push(boxGeo, lidGeo, bandGeo);

    const boxMat = new THREE.MeshStandardMaterial({ color: 0xe8d9b6, roughness: 0.85 });
    const lidMat = new THREE.MeshStandardMaterial({ color: 0xf6efe0, roughness: 0.8 });
    const bandMat = new THREE.MeshStandardMaterial({ color: 0xc8503f, roughness: 0.7 });
    mats.push(boxMat, lidMat, bandMat);

    const body = new THREE.Mesh(boxGeo, boxMat);
    const lid = new THREE.Mesh(lidGeo, lidMat);
    lid.position.y = 0.12;
    const band = new THREE.Mesh(bandGeo, bandMat);
    g.add(body, lid, band);
    g.userData.recipeId = rec ? rec.id : null;
    return { mesh: g, geos, mats };
  }

  function attachPackage(mission, quality) {
    dropPackage(false);
    const rec = recipeById(mission.recipeId);
    const built = buildPackageMesh(rec);
    pkg = {
      missionId: mission.id,
      mesh: built ? built.mesh : null,
      geos: built ? built.geos : [],
      mats: built ? built.mats : [],
      quality: clamp01(quality != null ? quality : 0.7),
      freshness: 1,
    };
    if (built && game.player && typeof game.player.carry === 'function') {
      try { game.player.carry(built.mesh); } catch (e) { console.error('[delivery] carry failed', e); }
    }
    const cat = game.player && game.player.cat;
    if (cat && typeof cat.setAction === 'function') cat.setAction('carry');
    mission.armed = true;
    mission.carrying = true;
  }

  function dropPackage(clearCat = true) {
    if (!pkg) return;
    if (game.player && typeof game.player.carry === 'function') {
      try { game.player.carry(null); } catch (e) { /* silent */ }
    }
    if (pkg.mesh && pkg.mesh.parent) pkg.mesh.parent.remove(pkg.mesh);
    for (const g of pkg.geos) { try { g.dispose(); } catch (e) { /* silent */ } }
    for (const m of pkg.mats) { try { m.dispose(); } catch (e) { /* silent */ } }
    const owner = missions.get(pkg.missionId);
    if (owner) { owner.armed = false; owner.carrying = false; }
    pkg = null;
    if (clearCat) {
      const cat = game.player && game.player.cat;
      if (cat && typeof cat.stopAction === 'function') cat.stopAction();
    }
  }

  // =========================================================================
  // Waypoint
  // =========================================================================
  function refreshWaypoint() {
    if (!game.world || typeof game.world.setWaypoint !== 'function') return;
    const act = activeMissions();
    if (!act.length) { game.world.setWaypoint(null); return; }
    // Prefer the one we are actually carrying for.
    const m = act.find((x) => x.armed) || act[0];
    game.world.setWaypoint({ x: m.x, z: m.z, label: m.title });
  }

  // =========================================================================
  // Mission lifecycle
  // =========================================================================
  function activeMissions() {
    const out = [];
    for (const m of missions.values()) if (m.state === 'active') out.push(m);
    return out;
  }
  function availableMissions() {
    const out = [];
    for (const m of missions.values()) if (m.state === 'offered') out.push(m);
    return out;
  }

  /**
   * Register a mission. `spec` may be partial — everything below has a sane
   * default so quests can hand-author one line and get a valid mission.
   */
  function offer(spec = {}) {
    const toNpc = spec.toNpc || pickToNpc(spec.district);
    const rec = npcById(toNpc);
    const district = spec.district || (rec ? rec.district : 'old_market');
    if (!state.districtUnlocked(district)) return null;

    const recipeId = spec.recipeId || pickRecipe(rec);
    const recipeRec = recipeById(recipeId);
    const qty = Math.max(1, Math.floor(spec.qty || 1));
    const dest = spec.x != null && spec.z != null ? { x: spec.x, z: spec.z } : npcSpot(toNpc);
    const from = shopOrigin();
    const distance = Math.round(dist2d(from, dest));
    const twist = spec.twist !== undefined ? spec.twist : TWISTS[Math.floor(rng() * TWISTS.length)];
    const weather = spec.weather !== undefined ? spec.weather
      : (rng() < 0.22 ? WEATHERS[1] : null);
    const window = spec.window || pickWindow();

    const grace = graceSeconds();
    const wantsDeadline = spec.deadline !== undefined
      ? !!spec.deadline
      : rng() < 0.7;
    const deadline = wantsDeadline
      ? Math.round(TUNING.baseDeadline + distance * TUNING.secondsPerMetre + grace)
      : null;

    const id = spec.id || `del_${++seq}_${Math.floor(rng() * 9999)}`;
    const districtRec = districtById(district);
    const minGrade = spec.minGrade || (spec.quality && spec.quality.minGrade) || 'acceptable';

    const mission = {
      id,
      kind: 'delivery',
      title: spec.title || `${recipeRec ? recipeRec.name : recipeId} for ${rec ? rec.name : toNpc}`,
      fromNpc: spec.fromNpc || null,
      toNpc,
      district,
      recipeId,
      qty,
      x: dest.x,
      z: dest.z,
      deadline,
      secondsLeft: deadline,
      reward: computeReward({ recipeId, qty, district, distance, deadline, twist, weather }),
      quality: { minGrade },
      state: 'offered',
      route: {
        hint: `${districtRec ? districtRec.name : district} — ${rec ? rec.name : toNpc}`,
        distance,
      },
      twist: twist || null,
      weather: weather || null,
      window,
      icon: recipeRec ? recipeRec.icon : '🍱',
      armed: false,
      carrying: false,
      accepted: false,
      warned: false,
      keepWarmBroken: false,
      noRunBroken: false,
      createdDay: state.clock ? state.clock.day : 1,
    };

    missions.set(id, mission);
    return mission;
  }

  function pickToNpc(districtId) {
    const pool = NPCS.filter((n) => {
      if (districtId && n.district !== districtId) return false;
      if (!state.districtUnlocked(n.district)) return false;
      return n.role !== 'chef';
    });
    if (!pool.length) return 'yuki';
    // Rotate: never the same recipient two jobs in a row if we can help it.
    const filtered = pool.filter((n) => n.id !== lastPair.toNpc);
    const list = filtered.length ? filtered : pool;
    return list[Math.floor(rng() * list.length)].id;
  }

  function pickRecipe(npcRec) {
    const known = RECIPES.filter((r) => state.knowsRecipe(r.id));
    const list = known.length ? known : RECIPES.filter((r) => r.unlock && r.unlock.free);
    if (!list.length) return 'salmon_nigiri';
    // Their favourite, if we can cook it — a nice touch and it repeats less.
    if (npcRec && npcRec.favorite && list.some((r) => r.id === npcRec.favorite)
        && npcRec.favorite !== lastPair.recipeId && rng() < 0.45) {
      return npcRec.favorite;
    }
    const filtered = list.filter((r) => r.id !== lastPair.recipeId);
    const use = filtered.length ? filtered : list;
    return use[Math.floor(rng() * use.length)].id;
  }

  function pickWindow() {
    const list = TIME_WINDOWS.filter((w) => w.id !== lastWindow);
    const w = (list.length ? list : TIME_WINDOWS)[Math.floor(rng() * (list.length ? list.length : TIME_WINDOWS.length))];
    lastWindow = w.id;
    return w;
  }

  /** Rebuild the day's board. Safe to call more than once per day. */
  function generateDaily() {
    // Clear untouched offers; leave anything the player already accepted.
    for (const [id, m] of Array.from(missions.entries())) {
      if (m.state === 'offered') missions.delete(id);
      if (m.state === 'done' || m.state === 'failed') missions.delete(id);
    }
    const tier = (state.shop && state.shop.tier) || 1;
    const count = TUNING.boardSlots + Math.floor((tier - 1) * TUNING.boardSlotsPerTier);
    const districts = unlockedDistricts();
    const out = [];
    const seen = new Set();
    for (let i = 0; i < count; i++) {
      let m = null;
      // Re-roll a couple of times so one board never lists the same job twice.
      for (let attempt = 0; attempt < 4 && !m; attempt++) {
        const d = districts.length ? districts[Math.floor(rng() * districts.length)] : null;
        const cand = offer({ district: d ? d.id : undefined, qty: 1 + (rng() < 0.28 ? 1 : 0) });
        if (!cand) continue;
        const key = `${cand.toNpc}|${cand.recipeId}`;
        if (seen.has(key) && attempt < 3) { missions.delete(cand.id); continue; }
        seen.add(key);
        m = cand;
      }
      if (!m) continue;
      // Enforce the no-repeat rule across the freshly generated board too.
      lastPair = { toNpc: m.toNpc, recipeId: m.recipeId };
      out.push(m);
    }
    lastDay = state.clock ? state.clock.day : 0;
    return out;
  }

  function accept(missionId) {
    const m = missions.get(missionId);
    if (!m) return null;
    if (m.state !== 'offered') return m;
    if (!state.districtUnlocked(m.district)) {
      toast('You do not know that part of the city yet', { icon: '🗺️', tone: 'bad' });
      return null;
    }
    m.state = 'active';
    m.accepted = true;
    m.secondsLeft = m.deadline;
    refreshWaypoint();

    const rec = recipeById(m.recipeId);
    const dest = npcById(m.toNpc);
    // The cat has to physically carry the food, so unless it is already in
    // hand the first job is the kitchen.
    if (pkg && pkg.missionId === m.id) {
      m.armed = true; m.carrying = true;
    } else {
      toast(`Cook ${m.qty}× ${rec ? rec.name : m.recipeId} first`, { icon: rec ? rec.icon : '🍣' });
    }
    if (bus) bus.emit(EV.TOAST, {
      text: `Job accepted — ${dest ? dest.name : m.toNpc}${m.twist ? ` (${m.twist.label})` : ''}`,
      icon: '📋', tone: 'good',
    });
    sfx('job_accept');
    return m;
  }

  function abandon(missionId) {
    const m = missions.get(missionId);
    if (!m || (m.state !== 'active' && m.state !== 'offered')) return false;
    if (pkg && pkg.missionId === m.id) dropPackage();
    m.state = 'failed';
    m.reason = 'abandoned';
    refreshWaypoint();
    toast('Delivery dropped', { icon: '📭', tone: 'bad' });
    if (bus) bus.emit(EV.DELIVERY_DONE, { missionId: m.id, onTime: false, quality: 0, failed: true });
    return true;
  }

  function fail(m, reason) {
    if (!m || m.state !== 'active') return;
    if (pkg && pkg.missionId === m.id) dropPackage();
    m.state = 'failed';
    m.reason = reason;
    refreshWaypoint();
    const rec = npcById(m.toNpc);
    toast(`${rec ? rec.name : 'They'} gave up waiting`, { icon: '⌛', tone: 'bad' });
    state.addRelationship(m.toNpc, -2);
    if (bus) bus.emit(EV.DELIVERY_DONE, { missionId: m.id, onTime: false, quality: 0, failed: true, reason });
  }

  /**
   * Hand the package over. Public so a dialogue/quest can force it, but the
   * normal path is `update()` noticing the cat standing on the destination.
   */
  function complete(missionId) {
    const m = missions.get(missionId);
    if (!m || m.state !== 'active') return null;
    if (!m.armed || !pkg || pkg.missionId !== m.id) {
      const rec = recipeById(m.recipeId);
      toast(`You are not carrying the ${rec ? rec.name : 'order'}`, { icon: '🤲', tone: 'bad' });
      return null;
    }
    return settle(m);
  }

  function settle(m) {
    const grace = graceSeconds();
    const late = m.deadline != null && m.secondsLeft != null ? Math.max(0, -(m.secondsLeft)) : 0;
    const onTime = late <= 0;

    // ---- score ------------------------------------------------------------
    const fw = PROGRESSION.freshnessQualityWeight;
    let score = clamp01(pkg.quality * (1 - fw) + pkg.freshness * fw);
    if (late > 0) {
      score -= Math.min(TUNING.lateMaxPenalty, (late / TUNING.latePenaltySeconds) * TUNING.lateMaxPenalty);
    }
    if (m.keepWarmBroken) score -= 0.10;
    if (m.noRunBroken) score -= 0.12;
    if (m.weather && m.weather.id === 'rain' && raining()) score += 0.03;   // ran it in the rain anyway
    score = clamp01(score);

    const grade = gradeFor(score);
    const belowBar = gradeRank(grade.id) > gradeRank(m.quality.minGrade);

    // ---- payout -----------------------------------------------------------
    let coins = Math.round(m.reward.coins * grade.payMult);
    let rep = Math.round(m.reward.rep * grade.repMult);
    let xp = Math.round(m.reward.xp * (0.6 + score * 0.6));
    let rel = Math.round(m.reward.relationship * (score >= 0.6 ? 1 : 0.5));
    if (belowBar) {
      coins = Math.round(coins * 0.5);
      rep = Math.min(rep, 0);
      rel = Math.min(rel, 0);
    }

    state.addCoins(coins, 'delivery');
    if (rep) state.addReputation(rep);
    if (xp) state.addXp(xp);
    if (rel) state.addRelationship(m.toNpc, rel);
    if (state.stats) state.stats.deliveries = (state.stats.deliveries || 0) + 1;

    dropPackage();
    m.state = 'done';
    m.finalGrade = grade.id;
    m.finalScore = score;
    refreshWaypoint();

    const who = npcById(m.toNpc);
    const cat = game.player && game.player.cat;
    if (cat && typeof cat.setAction === 'function') cat.setAction('happy');

    if (belowBar) {
      toast(`${who ? who.name : 'They'} took it… reluctantly (${grade.label})`, { icon: '📦', tone: 'bad' });
    } else {
      toast(`Delivered! ${grade.label} · +${coins}¢`, { icon: '📦', tone: 'good' });
    }
    sfx(belowBar ? 'delivery_meh' : 'delivery_good');

    if (bus) {
      bus.emit(EV.DELIVERY_DONE, {
        missionId: m.id, onTime, quality: score, grade: grade.id,
        toNpc: m.toNpc, recipeId: m.recipeId, coins, rep, xp,
      });
    }
    return { missionId: m.id, onTime, score, grade: grade.id, coins, rep, xp };
  }

  // =========================================================================
  // Job board
  // =========================================================================
  function boardText() {
    const list = availableMissions();
    if (!list.length) return 'The board is empty today.';
    return `${list.length} job${list.length === 1 ? '' : 's'} on the board`;
  }

  function openBoard() {
    const day = state.clock ? state.clock.day : 0;
    if (day !== lastDay || !availableMissions().length) generateDaily();

    // Prefer a real panel if the UI layer registered one.
    if (game.panels && typeof game.panels.open === 'function') {
      try {
        game.panels.open('deliveries', { missions: availableMissions() });
        return;
      } catch (e) { /* no panel — fall through to the inline flow */ }
    }

    // Fallback: E cycles the board, a second E on the same job accepts it.
    const list = availableMissions();
    if (!list.length) { toast('Nothing on the board today', { icon: '📋' }); return; }
    if (boardOffer && list.some((m) => m.id === boardOffer)) {
      const m = missions.get(boardOffer);
      boardOffer = null;
      accept(m.id);
      return;
    }
    const m = list[0];
    boardOffer = m.id;
    const rec = recipeById(m.recipeId);
    toast(
      `${m.title} · ${m.route.hint} · ${m.reward.coins}¢${m.deadline ? ` · ${m.deadline}s` : ''}` +
      `${m.twist ? ` · ${m.twist.label}` : ''} — press E to take it`,
      { icon: rec ? rec.icon : '📋' },
    );
  }

  /** Put a job board in the world. `def` is an interactions entry seed. */
  function registerBoard(def = {}) {
    if (!game.interactions || typeof game.interactions.add !== 'function') return () => {};
    if (boardHandle) { try { boardHandle(); } catch (e) { /* silent */ } }
    boardDef = { id: 'delivery_board', x: HOME.shop.x + 3, z: HOME.shop.z + 4, r: 2.6, ...def };
    boardHandle = game.interactions.add({
      id: boardDef.id,
      x: boardDef.x, z: boardDef.z, r: boardDef.r,
      key: 'E',
      priority: boardDef.priority != null ? boardDef.priority : 1,
      label: () => `Delivery board — ${boardText()}`,
      marker: { color: '#c8a24a', height: 1.4 },
      data: { kind: 'delivery_board' },
      onUse: () => openBoard(),
    });
    return () => {
      if (boardHandle) { try { boardHandle(); } catch (e) { /* silent */ } }
      boardHandle = null;
    };
  }

  // =========================================================================
  // Cooking hook — this is what arms a mission
  // =========================================================================
  function onCookDone(payload) {
    if (!payload || !payload.recipeId) return;
    // A dish cooked against a counter order belongs to that customer — only a
    // free cook (no orderId) can be wrapped up for a delivery.
    if (payload.orderId) return;
    const q = payload.quality != null ? payload.quality
      : (payload.score != null ? clamp01(payload.score) : 0.7);
    // Oldest matching active mission wins, so a queue of jobs drains in order.
    const match = activeMissions()
      .filter((m) => m.recipeId === payload.recipeId && !m.armed)
      .sort((a, b) => (a.deadline || 1e9) - (b.deadline || 1e9))[0];
    if (!match) return;
    if (pkg) {
      toast('Your paws are already full', { icon: '🤲', tone: 'bad' });
      return;
    }
    attachPackage(match, q);
    const who = npcById(match.toNpc);
    toast(`Wrapped for ${who ? who.name : match.toNpc} — get moving`, { icon: '📦', tone: 'good' });
    refreshWaypoint();
  }

  function onDayStart() {
    generateDaily();
    if (availableMissions().length) {
      toast(`${availableMissions().length} new delivery jobs on the board`, { icon: '📋' });
    }
  }

  if (bus) {
    unsubs.push(bus.on(EV.COOK_DONE, onCookDone));
    unsubs.push(bus.on(EV.DAY_START, onDayStart));
  }

  // =========================================================================
  // Frame
  // =========================================================================
  function update(dt) {
    if (!(dt > 0)) return;
    if (dt > 0.25) dt = 0.25;

    // ---- 'don't run' watchdog ---------------------------------------------
    const p = playerPos();
    let speed = 0;
    if (p && _prevPos) {
      if (hasPrevPos) speed = Math.hypot(p.x - _prevPos.x, p.z - _prevPos.z) / dt;
      _prevPos.set(p.x, p.y || 0, p.z);
      hasPrevPos = true;
    }
    if (speed > TUNING.runSpeed) runTimer += dt; else runTimer = Math.max(0, runTimer - dt * 2);

    // ---- carried package decays faster than the basket ---------------------
    if (pkg) {
      const rate = PROGRESSION.freshnessLossPerHour
        * Math.max(0, 1 - (typeof state.upgradeValue === 'function' ? state.upgradeValue('freshness', 0) : 0))
        * TUNING.carryFreshnessMult * hoursPerSecond();
      pkg.freshness = clamp(pkg.freshness - rate * dt, PROGRESSION.freshnessFloor, 1);
    }

    const act = activeMissions();
    for (const m of act) {
      // Timer
      if (m.secondsLeft != null) {
        m.secondsLeft -= dt;
        if (!m.warned && m.secondsLeft <= 20 && m.secondsLeft > 0) {
          m.warned = true;
          toast('Delivery is running late!', { icon: '⏰', tone: 'bad' });
        }
        if (m.secondsLeft < -graceSeconds() - TUNING.expireAfterSeconds) { fail(m, 'expired'); continue; }
      }

      // Twists only matter while the food is in hand.
      if (m.armed && pkg && pkg.missionId === m.id) {
        if (m.twist && m.twist.id === 'keep_warm' && pkg.freshness < TUNING.keepWarmFloor && !m.keepWarmBroken) {
          m.keepWarmBroken = true;
          toast('It has gone cold…', { icon: '❄️', tone: 'bad' });
        }
        if (m.twist && m.twist.id === 'no_run' && runTimer > TUNING.runGraceSeconds && !m.noRunBroken) {
          m.noRunBroken = true;
          toast('You spilled some — slow down', { icon: '🍶', tone: 'bad' });
        }
        // Arrival
        if (p) {
          const d = Math.hypot(p.x - m.x, p.z - m.z);
          if (d <= TUNING.arriveRadius) { settle(m); continue; }
        }
      }

      // Destinations move with the NPC schedule, so keep the marker honest.
      if (!m.fixed) {
        const s = npcSpot(m.toNpc);
        if (s && (s.x !== m.x || s.z !== m.z)) {
          m.x = s.x; m.z = s.z;
          if (m.armed) refreshWaypoint();
        }
      }
    }

    // A day rollover without a DAY_START listener still refreshes the board.
    const day = state.clock ? state.clock.day : 0;
    if (lastDay >= 0 && day !== lastDay && !act.length) generateDaily();
  }

  // =========================================================================
  function destroy() {
    for (const off of unsubs) { try { off(); } catch (e) { /* silent */ } }
    unsubs.length = 0;
    dropPackage();
    if (boardHandle) { try { boardHandle(); } catch (e) { /* silent */ } boardHandle = null; }
    if (game.world && typeof game.world.setWaypoint === 'function') game.world.setWaypoint(null);
    missions.clear();
  }

  return {
    id: 'delivery',
    update,
    offer,
    accept,
    abandon,
    complete,
    generateDaily,
    registerBoard,
    openBoard,
    destroy,
    get(id) { return missions.get(id) || null; },
    get active() { return activeMissions(); },
    get available() { return availableMissions(); },
    get all() { return Array.from(missions.values()); },
    get carrying() { return pkg ? { missionId: pkg.missionId, quality: pkg.quality, freshness: pkg.freshness } : null; },
    get board() { return boardDef; },
  };
}

export default createDelivery;
