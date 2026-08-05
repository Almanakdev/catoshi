import * as THREE from 'three';
import { loadCarPack } from './carPack.js';

// NPC traffic driving a real road NETWORK.
//
// The old version put every car on one of six closed rounded-rectangle loops and
// braked for any car within 30 units that was roughly ahead of it. Loops overlap,
// so cars from different loops met head-on on shared tarmac, each saw the other
// "ahead", and both braked to zero — permanent gridlock with no way out. That's
// what the piling-up and the stopping was.
//
// This is a directed graph instead:
//
//   NODES  every road intersection on the grid (the crossing inside the central
//          park doesn't exist, and neither do the two stubs that would run into
//          it, so they're simply absent from the graph).
//   EDGES  one per direction between adjacent intersections. A car drives on the
//          RIGHT of its edge, so opposing traffic is physically separated and
//          head-on meetings are impossible by construction.
//
// Following only ever considers the car ahead ON THE SAME EDGE, ordered by
// progress along it — an O(1) lookup that cannot deadlock across directions.
// Intersections are gated by traffic lights, and there's a hard stuck-timeout
// that creeps a car forward if it has somehow been stationary too long, so no
// single bug can bring the network to a halt again.

// ---------------------------------------------------------------------------
// TUNING
// ---------------------------------------------------------------------------
export const TRAFFIC = {
  count: 14,
  crazy: 3,              // speeders that run reds and will hit the player

  lane: 3.0,             // offset from the road centreline to the driving lane
  roadY: 0.12,           // road surface — the car geometry has its tyres at y = 0

  cruise: [9, 13],       // normal cruising speed range
  crazyMul: 1.9,         // …and what the maniacs do to it
  accel: 7,              // units/s² toward the target speed
  brake: 16,             // …and away from it
  turnRate: 2.6,         // radians/s of steering at speed (scaled by speed)

  gapBase: 4.0,          // bumper gap, plus a share of both cars' lengths
  gapPerLen: 0.30,
  lookAhead: 34,         // how far up the lane a car looks

  stopLine: 7.0,         // distance before the junction centre where cars wait
  boxClear: 9.0,         // forward cone radius used to keep junctions clear
  stuckLimit: 2.2,       // seconds stationary before a car creeps regardless

  laneTolerance: 1.0,    // how far off its lane a car may ever be
  laneCorrect: 16,       // units/s it is pulled back (smooth, but hard-bounded)

  // Lights: one axis green at a time, with an all-red gap to clear the box.
  greenTime: 6.5,
  allRed: 1.2,

  hijackRange: 5.5,      // how close you can be to press E and take a car
  hitRadius: 2.6,        // car-vs-player impact radius
  hitDamage: 14,         // Health removed per impact
  hitKnockback: 16,      // units/s of shove
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

/**
 * Where the player stands to use a car's driver door: out to the car's own side,
 * biased toward the cabin rather than the boot, facing the bodywork.
 *
 * Works on anything with { x, z, yaw, length, width } — the internal car objects
 * and the hijack handle both qualify — so entering and leaving agree on the same
 * spot to the millimetre.
 */
export function doorPose(c, standOff = 1.45) {
  const sx = Math.cos(c.yaw), sz = -Math.sin(c.yaw);   // the car's right-hand side
  const out = c.width / 2 + standOff;
  const fwd = c.length * 0.10;                         // alongside the cabin
  return {
    x: c.x + sx * out + Math.sin(c.yaw) * fwd,
    z: c.z + sz * out + Math.cos(c.yaw) * fwd,
    yaw: Math.atan2(-sx, -sz),                         // turned to face the door
  };
}

/**
 * Where the character stands after getting OUT: the same door side, a little
 * further out so they're clearly beside the car rather than touching it, and
 * turned to face AWAY from it — they've just climbed out, they're not reaching
 * for the handle.
 */
export function exitPose(c, standOff = 1.95) {
  const sx = Math.cos(c.yaw), sz = -Math.sin(c.yaw);   // the car's right-hand side
  const out = c.width / 2 + standOff;
  const fwd = c.length * 0.10;                         // alongside the cabin
  return {
    x: c.x + sx * out + Math.sin(c.yaw) * fwd,
    z: c.z + sz * out + Math.cos(c.yaw) * fwd,
    yaw: Math.atan2(sx, sz),                           // facing out, away from the car
  };
}

// Direction indices: 0 = +X, 1 = -X, 2 = +Z, 3 = -Z
const DIR = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const AXIS = [0, 0, 1, 1];          // which light phase each direction obeys
const OPPOSITE = [1, 0, 3, 2];

export function createTraffic(scene, opts = {}) {
  const {
    blocks = 8, blockSize = 34, road = 12, seed = 777,
    count = TRAFFIC.count,
    parkMin = null, parkMax = null,   // park extent, so its crossing is skipped
    colliders = [],                   // buildings — the player's car stops on them
    signalSpots = [],                 // signal housings from city.js, to be lit
    onReady = () => {},
  } = opts;

  const T = TRAFFIC;
  const rng = mulberry32(seed);
  const stride = blockSize + road;
  const half = (blocks * stride) / 2;
  const rc = (i) => -half + i * stride - road / 2;   // road centreline coordinate

  const group = new THREE.Group();
  scene.add(group);

  // ---- Road graph ---------------------------------------------------------
  // Interior crossings only (1 … blocks-1).
  const LO = 1, HI = blocks - 1;
  const N = HI - LO + 1;
  const gi = (gx, gz) => (gx - LO) * N + (gz - LO);
  const inPark = (v) => parkMin !== null && v > parkMin && v < parkMax;
  const nodeOK = (gx, gz) =>
    gx >= LO && gx <= HI && gz >= LO && gz <= HI && !(inPark(rc(gx)) && inPark(rc(gz)));

  const nodes = [];   // { gx, gz, x, z, nb: [dir -> nodeIndex | -1], lightOffset }
  for (let gx = LO; gx <= HI; gx++) {
    for (let gz = LO; gz <= HI; gz++) {
      nodes[gi(gx, gz)] = nodeOK(gx, gz)
        ? { gx, gz, x: rc(gx), z: rc(gz), nb: [-1, -1, -1, -1], lightOffset: 0 }
        : null;
    }
  }
  // Link neighbours. A missing node simply has no edge to it, which is exactly
  // how the broken road either side of the park should behave.
  for (const n of nodes) {
    if (!n) continue;
    const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let d = 0; d < 4; d++) {
      const gx = n.gx + steps[d][0], gz = n.gz + steps[d][1];
      n.nb[d] = nodeOK(gx, gz) ? gi(gx, gz) : -1;
    }
    // De-synchronise the lights so the whole city doesn't flip at once.
    n.lightOffset = ((n.gx * 7 + n.gz * 13) % 10) / 10 * (T.greenTime + T.allRed) * 2;
  }
  const liveNodes = nodes.filter(Boolean);
  if (!liveNodes.length) console.warn('traffic: no road nodes');

  // Which axis has green at a node, or -1 during the all-red gap.
  const CYCLE = (T.greenTime + T.allRed) * 2;
  let clock = 0;
  function greenAxis(n) {
    const p = (clock + n.lightOffset) % CYCLE;
    if (p < T.greenTime) return 0;                                   // EW
    if (p < T.greenTime + T.allRed) return -1;                       // all red
    if (p < T.greenTime * 2 + T.allRed) return 1;                    // NS
    return -1;
  }

  // Lane-offset point: driving on the right of the direction of travel.
  // right of (hx,hz) is (hz,-hx), matching the convention the old fleet used.
  const laneAt = (nx, nz, d) => ({
    x: nx + DIR[d][1] * T.lane,
    z: nz - DIR[d][0] * T.lane,
  });

  // ---- Signal lenses ------------------------------------------------------
  // city.js builds the housings (pole + hood) but no longer lights the lenses —
  // they're drawn here as three InstancedMeshes, one per lamp, so a single
  // per-instance colour switch turns each lamp on or off. Three draw calls for
  // every signal in the city.
  //
  // Every housing faces along ±X, so each one governs the EAST-WEST approach:
  // exactly the axis a driver looking at it is travelling on.
  const lenses = (() => {
    const spots = signalSpots.filter((sp) => nodeOK(sp.gx, sp.gz));
    if (!spots.length) return null;
    const LAMP_Y = [4.96, 4.6, 4.24];              // red, amber, green
    const LIT = [new THREE.Color(0xff3131), new THREE.Color(0xffe11a), new THREE.Color(0x39ff88)];
    const DARK = [new THREE.Color(0x2a1010), new THREE.Color(0x2a2410), new THREE.Color(0x102a1c)];
    const geo = new THREE.CylinderGeometry(0.14, 0.14, 0.06, 10);
    geo.rotateX(Math.PI / 2);                      // face outward along +Z locally
    const mats = LIT.map(() => new THREE.MeshBasicMaterial({ toneMapped: false }));
    const meshes = [];
    const d = new THREE.Object3D();
    for (let l = 0; l < 3; l++) {
      const im = new THREE.InstancedMesh(geo, mats[l], spots.length);
      im.castShadow = im.receiveShadow = false;
      im.frustumCulled = false;
      for (let i = 0; i < spots.length; i++) {
        const sp = spots[i];
        d.position.set(sp.x, LAMP_Y[l], sp.z);
        d.rotation.set(0, sp.ry || 0, 0);
        d.translateZ(0.2);
        d.updateMatrix();
        im.setMatrixAt(i, d.matrix);
        im.setColorAt(i, DARK[l]);
      }
      im.instanceMatrix.needsUpdate = true;
      im.instanceColor.needsUpdate = true;
      group.add(im);
      meshes.push(im);
    }
    return { spots, meshes, LIT, DARK, state: new Int8Array(spots.length).fill(-9) };
  })();

  // Light one lamp per housing from the live phase. Only touched when a signal
  // actually changes, so a steady city costs nothing.
  function updateLenses() {
    if (!lenses) return;
    let dirty = false;
    for (let i = 0; i < lenses.spots.length; i++) {
      const sp = lenses.spots[i];
      const n = nodes[gi(sp.gx, sp.gz)];
      if (!n) continue;
      const g = greenAxis(n);
      // What an east-west driver sees: green when their axis is green, amber in
      // the clearing gap right after it, red otherwise.
      const lamp = g === 0 ? 2 : (g === -1 && ((clock + n.lightOffset) % CYCLE) < T.greenTime + T.allRed ? 1 : 0);
      if (lenses.state[i] === lamp) continue;
      lenses.state[i] = lamp;
      for (let l = 0; l < 3; l++) lenses.meshes[l].setColorAt(i, l === lamp ? lenses.LIT[l] : lenses.DARK[l]);
      dirty = true;
    }
    if (dirty) for (const m of lenses.meshes) m.instanceColor.needsUpdate = true;
  }

  // ---- Fleet --------------------------------------------------------------
  const cars = [];
  let typeMeshes = [];
  let ready = false;
  const dummy = new THREE.Object3D();

  loadCarPack({
    onReady: (models) => { build(models); ready = true; onReady(models.map((m) => ({ name: m.name, length: +m.length.toFixed(2) }))); },
  });

  function build(models) {
    const order = [];
    for (let i = 0; i < count; i++) order.push(i % models.length);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }

    const per = models.map(() => 0);
    for (const t of order) per[t]++;
    typeMeshes = models.map((car, i) => {
      if (!per[i]) return null;
      const im = new THREE.InstancedMesh(car.geometry, car.materials, per[i]);
      im.castShadow = true; im.receiveShadow = false;
      im.frustumCulled = false;
      group.add(im);
      return { im, cursor: 0, car };
    });

    // Spread the fleet over distinct edges so nobody spawns inside anybody.
    const spawnEdges = [];
    for (const n of liveNodes) for (let d = 0; d < 4; d++) if (n.nb[d] >= 0) spawnEdges.push([gi(n.gx, n.gz), d]);
    for (let i = spawnEdges.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [spawnEdges[i], spawnEdges[j]] = [spawnEdges[j], spawnEdges[i]]; }

    for (let i = 0; i < count && i < spawnEdges.length; i++) {
      const type = order[i];
      const tm = typeMeshes[type];
      if (!tm) continue;
      const [from, d] = spawnEdges[i];
      const crazy = i < T.crazy;
      const base = (T.cruise[0] + rng() * (T.cruise[1] - T.cruise[0])) * (crazy ? T.crazyMul : 1);
      const a = nodes[from], b = nodes[a.nb[d]];
      const p0 = laneAt(a.x, a.z, d), p1 = laneAt(b.x, b.z, d);
      const f = 0.15 + rng() * 0.6;
      cars.push({
        type, inst: tm.cursor++, length: tm.car.length, width: tm.car.width,
        from, dir: d, to: a.nb[d],
        x: p0.x + (p1.x - p0.x) * f, z: p0.z + (p1.z - p0.z) * f,
        yaw: Math.atan2(DIR[d][0], DIR[d][1]),
        speed: base * 0.5, base, crazy,
        stuck: 0, prog: 0, runRed: false, next: -1, creeping: false, distNode: 1e9,
        ai: true,           // false while the player is driving it
        box: new THREE.Box3(),
      });
    }
    refreshBoxes();
    place();
  }

  // ---- Per-frame ----------------------------------------------------------
  const buckets = new Map();   // "from,dir" -> cars sorted by progress
  const carColliders = [];     // solid boxes handed to the player controller
  let hijacked = null;         // the car the player is driving, if any
  let onHit = () => {};

  const edgeKey = (c) => c.from * 4 + c.dir;

  function edgeGeom(c) {
    const a = nodes[c.from], b = nodes[c.to];
    if (!a || !b) return null;
    const p0 = laneAt(a.x, a.z, c.dir);
    const p1 = laneAt(b.x, b.z, c.dir);
    const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    return { a, b, p0, p1, len };
  }

  // Progress along the current edge, measured from the entry point.
  function progressOf(c) {
    const g = edgeGeom(c);
    if (!g) return 0;
    return (c.x - g.p0.x) * DIR[c.dir][0] + (c.z - g.p0.z) * DIR[c.dir][1];
  }

  // Pick where to go next: straight if possible, otherwise a turn, never a
  // U-turn unless it's a dead end.
  function chooseNext(c) {
    const n = nodes[c.to];
    if (!n) return c.dir;
    const options = [];
    for (let d = 0; d < 4; d++) {
      if (n.nb[d] < 0 || d === OPPOSITE[c.dir]) continue;
      options.push(d);
    }
    if (!options.length) return OPPOSITE[c.dir];       // cul-de-sac: turn around
    // Favour going straight so traffic reads as purposeful rather than random.
    if (options.includes(c.dir) && rng() < 0.62) return c.dir;
    return options[Math.floor(rng() * options.length)];
  }

  function update(dt, playerPos) {
    if (!cars.length) return;
    clock += dt;

    // Bucket by directed edge and order by progress, so "the car ahead" is just
    // the next entry. Buckets hold one or two cars, so this is trivial work.
    buckets.clear();
    for (const c of cars) {
      if (!c.ai) continue;
      c.prog = progressOf(c);
      const gg = edgeGeom(c);
      c.distNode = gg ? gg.len - c.prog : 1e9;   // used to order who has priority
      const k = edgeKey(c);
      let list = buckets.get(k);
      if (!list) { list = []; buckets.set(k, list); }
      list.push(c);
    }
    for (const list of buckets.values()) list.sort((p, q) => p.prog - q.prog);

    for (const c of cars) {
      if (!c.ai) continue;
      const g = edgeGeom(c);
      if (!g) { c.speed = 0; continue; }

      let target = c.base;
      // Two distinct reasons to be stopped, and the anti-gridlock creep must
      // treat them differently:
      //   queued   — a car directly ahead on this lane. Never creep into it; the
      //              front of a queue is always gated by a light, which changes,
      //              so a queue always resolves on its own.
      //   waiting  — a red light being obeyed. Not stuck at all; obeying.
      // Anything else that stops a car is unexplained, and THAT is what the
      // creep exists for.
      let queued = false;
      let waitingAtLight = false;
      let nearestAhead = Infinity;   // closest car in the forward cone, any lane

      // --- car ahead on this lane ---------------------------------------
      const list = buckets.get(edgeKey(c));
      const idx = list.indexOf(c);
      const ahead = idx >= 0 && idx + 1 < list.length ? list[idx + 1] : null;
      if (ahead) {
        const gap = ahead.prog - c.prog;
        const minGap = T.gapBase + (c.length + ahead.length) * T.gapPerLen;
        if (gap < minGap * 1.35) queued = true;
        if (gap < T.lookAhead) {
          // Match the leader's speed, closing the excess gap gradually. A pure
          // "stop if too close" rule is what used to lock the whole line up.
          target = Math.min(target, Math.max(0, ahead.speed + (gap - minGap) * 1.6));
        }
      }

      // --- traffic light at the junction we're approaching ----------------
      const distToNode = g.len - c.prog;
      const node = nodes[c.to];
      const axisGreen = greenAxis(node);
      const mustStop = axisGreen !== AXIS[c.dir];
      // Maniacs treat a red as a suggestion — decided ONCE per approach, so they
      // either sail through or stop properly instead of stuttering.
      if (distToNode > T.stopLine + 16) c.runRed = c.crazy && rng() < 0.45;
      const obeys = !c.runRed;
      if (mustStop && obeys && distToNode < T.stopLine + 14 && distToNode > 0) {
        const toLine = distToNode - T.stopLine;
        const lightTarget = Math.max(0, toLine * 1.5);
        if (lightTarget < 0.6) waitingAtLight = true;
        target = Math.min(target, lightTarget);
      }

      // --- yield before turning into an occupied lane ----------------------
      // The next direction is chosen on APPROACH rather than at the moment of
      // arrival, so a car can see that the lane it's about to turn into is
      // already occupied and wait its turn. Two cars on the same green (say one
      // turning left and one turning right into the same outgoing lane) used to
      // arrive together and briefly interpenetrate.
      if (distToNode < 22 && c.next < 0) c.next = chooseNext(c);
      if (c.next >= 0 && distToNode < T.stopLine + 3) {
        const nn = nodes[c.to];
        const nextDir = nn.nb[c.next] >= 0 ? c.next : OPPOSITE[c.next];
        const entry = laneAt(nn.x, nn.z, nextDir);
        // Deliberately a light touch: a tight radius and a slow-down rather
        // than a stop. Checking a full car-length here (and braking to nearly
        // zero) meant any car queued on the outgoing lane blocked the turn
        // completely, and throughput collapsed.
        const YIELD_R = 5.0;
        for (const o of cars) {
          if (o === c || !o.ai) continue;
          const d2 = (o.x - entry.x) ** 2 + (o.z - entry.z) ** 2;
          if (d2 < YIELD_R * YIELD_R) { target = Math.min(target, 2.5); break; }
        }
      }

      // --- keep the junction box clear ------------------------------------
      // Only applies to cars that have entered the crossing, and only slows —
      // combined with the stuck-timeout below it can't deadlock.
      // Crazy drivers still respect this one: they're meant to speed and jump
      // reds, not bulldoze the fleet. They just leave less room.
      if (distToNode < T.stopLine + 4) {
        const reach = c.crazy ? T.boxClear * 0.7 : T.boxClear;
        for (const o of cars) {
          if (o === c || !o.ai) continue;
          // PRIORITY, and this is the whole reason junctions used to lock up:
          // two cars already inside the box each sat in the other's forward cone
          // and each braked to a standstill, waiting for the other, forever.
          // Yield only to a car that is FURTHER through its own approach — that
          // is a strict ordering, so the yield relation can never be circular.
          const hasPriority = o.distNode < c.distNode
            || (o.distNode === c.distNode && cars.indexOf(o) < cars.indexOf(c));
          if (!hasPriority) {
            // No priority, but still worth knowing about: the creep below must
            // not drive into a car just because it has right of way over it.
            const ddx = o.x - c.x, ddz = o.z - c.z;
            const dd = Math.hypot(ddx, ddz) || 1;
            if ((ddx / dd) * Math.sin(c.yaw) + (ddz / dd) * Math.cos(c.yaw) > 0.5
                && dd < nearestAhead) nearestAhead = dd;
            continue;
          }
          const dx = o.x - c.x, dz = o.z - c.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > reach * reach) continue;
          const len = Math.sqrt(d2) || 1;
          const fwd = (dx / len) * Math.sin(c.yaw) + (dz / len) * Math.cos(c.yaw);
          const clearance = (c.length + o.length) * 0.5 + 1.2;
          if (fwd > 0.5) {
            if (len < nearestAhead) nearestAhead = len;
            target = Math.min(target, Math.max(0, (len - clearance) * 1.5));
          }
        }
      }

      // --- accelerate / brake --------------------------------------------
      const rate = target < c.speed ? T.brake : T.accel;
      c.speed += Math.max(-rate * dt, Math.min(rate * dt, target - c.speed));
      if (c.speed < 0) c.speed = 0;

      // Anti-gridlock backstop: nothing may sit still forever — but the creep
      // must NOT apply when a car is directly in front, or a queue at a red
      // light slowly rear-ends itself, which is exactly what it used to do.
      if (c.speed < 0.25 && !queued && !waitingAtLight) {
        c.stuck += dt;
      } else if (!c.creeping) {
        c.stuck = 0;
      }
      // Once engaged the creep HOLDS until the car has actually cleared the
      // junction, rather than cancelling itself the moment speed ticks above
      // zero — which just produced a nudge/brake oscillation going nowhere.
      if (c.stuck > T.stuckLimit) c.creeping = true;
      if (c.creeping) {
        // Escape hatch, but never a battering ram: with the yield now strictly
        // ordered, whoever has priority WILL move, so simply holding still when
        // something is close is safe and can no longer deadlock.
        if (nearestAhead > 4.5) c.speed = Math.max(c.speed, 1.3);
        if (c.distNode > T.stopLine + 6 || c.distNode < 1.0) { c.creeping = false; c.stuck = 0; }
      }

      // --- steer + move ---------------------------------------------------
      // Pure pursuit: aim at a point a fixed distance AHEAD ALONG THE LANE, not
      // at the far end of it. Aiming at the end let a car converge on its lane
      // only near the finish, so mid-block it sat diagonally across the
      // centreline and clipped oncoming traffic — every interpenetration in the
      // 180-second soak was a pair on opposing lanes of the same road. Aiming at
      // a rolling look-ahead point pulls the car onto its lane within a few
      // metres and keeps it there, and still arcs nicely through corners.
      const LOOK = 7;
      const reach2 = Math.min(g.len, Math.max(0, c.prog) + LOOK);
      const aimX = g.p0.x + DIR[c.dir][0] * reach2;
      const aimZ = g.p0.z + DIR[c.dir][1] * reach2;
      const want = Math.atan2(aimX - c.x, aimZ - c.z);
      const agility = Math.min(1, 0.35 + c.speed / 14);
      c.yaw = lerpAngle(c.yaw, want, Math.min(1, dt * T.turnRate * agility * 2.2));
      c.x += Math.sin(c.yaw) * c.speed * dt;
      c.z += Math.cos(c.yaw) * c.speed * dt;

      // Lane keeping. Steering alone converges on the lane over several metres,
      // and at 12 units/s a car coming out of a turn spent that distance sitting
      // across the centreline — which is where every remaining car-to-car
      // contact came from (always a pair on opposing lanes of one road). This
      // caps how far a car may stray and pulls it back at a bounded rate, so
      // the correction is smooth but the bound is absolute.
      const perpX = DIR[c.dir][1], perpZ = -DIR[c.dir][0];
      const lat = (c.x - g.p0.x) * perpX + (c.z - g.p0.z) * perpZ;
      if (Math.abs(lat) > T.laneTolerance) {
        const fix = Math.min(Math.abs(lat) - T.laneTolerance, T.laneCorrect * dt) * Math.sign(lat);
        c.x -= perpX * fix;
        c.z -= perpZ * fix;
      }

      // --- arrive at the junction ----------------------------------------
      if (progressOf(c) >= g.len - 0.6) {
        const nd = c.next >= 0 ? c.next : chooseNext(c);
        c.next = -1;
        c.from = c.to;
        c.dir = nd;
        c.to = nodes[c.from].nb[nd];
        if (c.to < 0) { c.dir = OPPOSITE[nd]; c.to = nodes[c.from].nb[c.dir]; }
        // NOTE: deliberately no position snap here. Each direction's lane sits on
        // a different side of the centreline, so snapping to the new lane's entry
        // point teleported a turning car up to ~8 units sideways — sometimes
        // straight into a car already waiting there. The steering below pulls it
        // onto the new lane over the first few metres instead, which is both
        // smoother and collision-free.
      }
    }

    clearGhostIfClear(playerPos);
    refreshBoxes();
    place();
    updateLenses();
    if (playerPos) checkPlayerHit(dt, playerPos);
  }

  // ---- Solid bodies -------------------------------------------------------
  // An axis-aligned box around each car's oriented footprint. Cars mostly travel
  // along the grid, so the AABB is tight; through a corner it's a little loose,
  // which errs toward "solid" and is the right way round for a collider.
  // The car the player has just stepped out of is kept OUT of the player's
  // collider list until they've moved clear. Its own footprint necessarily
  // overlaps the spot they were standing in, and being shoved by the car you just
  // left reads as the exit sliding.
  let ghost = null;
  function setGhostCar(c) { ghost = c; }
  function clearGhostIfClear(p) {
    if (!ghost || !p) return;
    const dx = ghost.x - p.x, dz = ghost.z - p.z;
    if (dx * dx + dz * dz > 12 * 12) ghost = null;
  }

  function refreshBoxes() {
    carColliders.length = 0;
    for (const c of cars) {
      const s = Math.abs(Math.sin(c.yaw)), co = Math.abs(Math.cos(c.yaw));
      const hx = (c.length * s + c.width * co) / 2;
      const hz = (c.length * co + c.width * s) / 2;
      c.box.min.set(c.x - hx, 0, c.z - hz);
      c.box.max.set(c.x + hx, 2.6, c.z + hz);
      if (c !== ghost) carColliders.push(c.box);
    }
  }

  function place() {
    for (const c of cars) {
      dummy.position.set(c.x, T.roadY, c.z);
      dummy.rotation.set(0, c.yaw, 0);
      dummy.updateMatrix();
      const tm = typeMeshes[c.type];
      if (tm) tm.im.setMatrixAt(c.inst, dummy.matrix);
    }
    for (const tm of typeMeshes) if (tm) tm.im.instanceMatrix.needsUpdate = true;
  }

  // ---- Hitting the player -------------------------------------------------
  let hitCooldown = 0;
  function checkPlayerHit(dt, p) {
    if (hitCooldown > 0) { hitCooldown -= dt; return; }
    for (const c of cars) {
      if (!c.ai) continue;                     // the car you're driving can't hit you
      if (c.speed < 3) continue;               // a crawling car just nudges
      const dx = p.x - c.x, dz = p.z - c.z;
      if (dx * dx + dz * dz > T.hitRadius * T.hitRadius * 4) continue;
      // Precise-ish: test against the car's own footprint, expanded a little.
      if (!c.box.containsPoint(new THREE.Vector3(p.x, 1, p.z))
        && dx * dx + dz * dz > T.hitRadius * T.hitRadius) continue;
      const len = Math.hypot(dx, dz) || 1;
      hitCooldown = 1.1;
      onHit({
        car: c,
        damage: T.hitDamage * (c.crazy ? 1.4 : 1),
        knock: { x: (dx / len) * T.hitKnockback, z: (dz / len) * T.hitKnockback },
        speed: c.speed,
      });
      return;
    }
  }

  // ---- Hijacking ----------------------------------------------------------
  function nearestCar(p, range = T.hijackRange) {
    let best = null, bd = range * range;
    for (const c of cars) {
      if (!c.ai) continue;
      const dx = c.x - p.x, dz = c.z - p.z;
      // Measure to the body, not the centre, so long cars are grabbable anywhere.
      const cx = Math.max(c.box.min.x, Math.min(p.x, c.box.max.x));
      const cz = Math.max(c.box.min.z, Math.min(p.z, c.box.max.z));
      const d2 = (p.x - cx) ** 2 + (p.z - cz) ** 2;
      if (d2 < bd) { bd = d2; best = c; }
    }
    return best;
  }

  // Hand a car over to the player. It leaves the AI entirely — no lane, no
  // light, no following — and stops being a collider for the character.
  function hijack(c) {
    if (!c || hijacked) return null;
    c.ai = false;
    c.speed = 0;
    hijacked = c;
    return {
      get x() { return c.x; }, get z() { return c.z; }, get yaw() { return c.yaw; },
      get speed() { return c.speed; },
      get length() { return c.length; }, get width() { return c.width; },
      set(x, z, yaw, speed) { c.x = x; c.z = z; c.yaw = yaw; c.speed = speed; },
    };
  }

  // Give it back. The car rejoins the network at whichever lane entry is
  // nearest, so an abandoned car never sits dead in the road.
  function release(keepClearOf = null) {
    const c = hijacked;
    if (!c) return;
    hijacked = null;
    let best = null, bd = Infinity, bp = null;
    for (const n of liveNodes) {
      for (let d = 0; d < 4; d++) {
        if (n.nb[d] < 0) continue;
        const p = laneAt(n.x, n.z, d);
        const d2 = (p.x - c.x) ** 2 + (p.z - c.z) ** 2;
        if (d2 < bd) { bd = d2; best = { from: gi(n.gx, n.gz), dir: d, to: n.nb[d] }; bp = p; }
      }
    }
    if (best) {
      c.from = best.from; c.dir = best.dir; c.to = best.to;
      // Rejoining the network normally means snapping onto the lane entry — but
      // that is a TELEPORT, and after an exit animation the player is standing
      // right beside the car. Materialising the car on top of them (or yanking it
      // out from under the animation) is exactly the bug this guards against: if
      // the destination is close to the player, leave the car where it is and let
      // the lane-keeping steer it back onto the tarmac instead.
      const clash = keepClearOf && bp
        && (bp.x - keepClearOf.x) ** 2 + (bp.z - keepClearOf.z) ** 2 < 7 * 7;
      if (!clash) {
        const e = edgeGeom(c);
        if (e) { c.x = e.p0.x; c.z = e.p0.z; c.yaw = Math.atan2(DIR[c.dir][0], DIR[c.dir][1]); }
      }
    }
    c.speed = 0;
    c.stuck = 0;
    c.next = -1;
    c.creeping = false;
    c.ai = true;
  }

  return {
    group,
    update,
    get ready() { return ready; },
    /** Solid boxes for the player controller — same array every frame. */
    carColliders,
    /** Traffic-light state for the signal visuals: (node) => 0 EW, 1 NS, -1 red. */
    lights: { nodes: liveNodes, greenAxis, cycle: CYCLE },
    nearestCar, hijack, release, setGhostCar,
    get hijacked() { return hijacked; },
    onPlayerHit(cb) { onHit = cb; },
    /** Read-only snapshot for diagnostics. */
    get carsDebug() { return cars.map((c, i) => ({ i, x: c.x, z: c.z, speed: c.speed, from: c.from, to: c.to, dir: c.dir, next: c.next, crazy: c.crazy, stuck: c.stuck, ai: c.ai })); },
    get stats() { return { cars: cars.length, crazy: cars.filter((c) => c.crazy).length, nodes: liveNodes.length }; },
  };
}
