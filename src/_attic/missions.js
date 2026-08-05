import * as THREE from 'three';

// Missions — the money loop.
//
// Job boards stand at intersections around the city. Walk up to one, press E,
// and you get a job; the HUD shows the objective and the minimap gets a
// waypoint. Finish it for cash plus a hit to your needs (work is tiring, but
// getting paid feels good). Finish one and the next is waiting at any board.
//
// Three kinds, all built from the same two primitives — "be at a place" and
// "be at a place N times":
//
//   deliver  pick up at A, drop off at B. Two legs, pays the best.
//   express  reach one place before the clock runs out. Pays a bonus for
//            whatever time you have left.
//   collect  a scatter of pickups appears; sweep them all up. No timer.
//
// Everything tunable — payouts, timers, distances, stat costs — is in MISSION
// TUNING at the top. The world-space markers are two InstancedMeshes (a bobbing
// beacon and a ground beam), the same trick entranceMarkers.js uses, so the
// whole system is a handful of draw calls.

// ---------------------------------------------------------------------------
// TUNING
// ---------------------------------------------------------------------------
export const MISSION_TUNING = {
  boardCount: 5,          // job boards spread over the road grid
  reachRadius: 5.5,       // how close counts as "arrived" (world units)
  pickupRadius: 3.4,      // ditto for collect-mission pickups

  deliver: {
    pay: [55, 95],        // paid on completion, scaled by distance within this range
    minLegDist: 60,       // don't hand out trivially short deliveries
    stats: { energy: -12, happiness: +8 },
  },
  express: {
    pay: [45, 80],
    minDist: 70,
    // Time allowed = distance / this speed, so the limit scales with the trip.
    // The player walks at 9 and sprints at 18 — 7.2 means you must jog most of
    // it, and sprinting buys the time bonus.
    paceUnitsPerSec: 7.2,
    bonusPerSecLeft: 1.2,
    stats: { energy: -20, happiness: +12 },
  },
  collect: {
    pay: [50, 85],
    count: [4, 6],        // how many pickups
    spread: 46,           // radius they're scattered over
    stats: { energy: -14, happiness: +10 },
  },
};

const TITLES = {
  deliver: ['Parcel run', 'Courier job', 'Hot delivery', 'Package drop'],
  express: ['Express run', 'Beat the clock', 'Urgent callout', 'Rush job'],
  collect: ['Lost property', 'Scattered cargo', 'Litter sweep', 'Supply pickup'],
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

const fmtTime = (s) => {
  const m = Math.floor(Math.max(0, s) / 60);
  const r = Math.floor(Math.max(0, s) % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
};

/**
 * @param scene   THREE.Scene
 * @param opts    { pois, blocks, blockSize, road, seed, needs, minimap, onToast }
 */
export function createMissions(scene, opts = {}) {
  const {
    pois = [],
    blocks = 8, blockSize = 34, road = 12,
    seed = 5150,
    needs = null,
    minimap = null,
    colliders = [],     // the city's solid boxes — boards must stand clear of them
    onToast = () => {},
  } = opts;

  const T = MISSION_TUNING;
  const rng = mulberry32(seed);
  const stride = blockSize + road;
  const half = (blocks * stride) / 2;
  // Interior street intersections — the same grid the simulated players walk.
  const nodeX = (i) => -half + (i + 1) * stride - road / 2;
  const NODE_N = blocks - 1;

  const group = new THREE.Group();
  scene.add(group);

  // ---- Job boards ---------------------------------------------------------
  // A board is only useful if you can walk up to it, so placement is checked
  // rather than assumed:
  //
  //   · the central intersection is skipped — the park replaces that crossing,
  //     so a board there stands in the middle of the fountain,
  //   · every candidate spot is tested against the city's real colliders (the
  //     same boxes that push the player around) and nudged onto the first clear
  //     spot, working outward from the middle of the crossing.
  //
  // If a whole intersection is boxed in, it's dropped and the next one is used.
  const parkLo = Math.floor(blocks / 2) - 1;
  const parkHi = parkLo + 1;
  // Node i is the road between blocks i and i+1, so a node sits inside the park
  // when its index falls in the park's block span.
  const nodeInPark = (g) => g >= parkLo && g <= parkHi;

  // Clear of anything solid at walking height, with room for the player's own
  // 1.4-unit collision radius plus a margin to stand in.
  const CLEAR = 2.6;
  function blockedAt(x, z) {
    for (let i = 0; i < colliders.length; i++) {
      const b = colliders[i];
      if (b.max.y <= 0.3 || b.min.y >= 3.5) continue;  // nothing at body height here
      const cx = Math.max(b.min.x, Math.min(x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(z, b.max.z));
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz < CLEAR * CLEAR) return true;
    }
    return false;
  }

  // Candidate offsets from the crossing centre. The KERB is tried first: traffic
  // runs at ±3 from the centreline (traffic.js's LANE), so a board pushed out to
  // the roadside sits clear of the cars and reads as street furniture rather
  // than an obstacle in the middle of a junction. The centre of the crossing is
  // the last resort, kept only so a boxed-in junction still yields a board.
  const kerb = road / 2 - 1.0;
  const OFFSETS = [
    [kerb, 0], [-kerb, 0], [0, kerb], [0, -kerb],
    [kerb, kerb], [-kerb, kerb], [kerb, -kerb], [-kerb, -kerb],
    [0, 0],
  ];

  function placeBoard(gx, gz) {
    const bx = nodeX(gx), bz = nodeX(gz);
    for (const [ox, oz] of OFFSETS) {
      const x = bx + ox, z = bz + oz;
      if (!blockedAt(x, z)) return { x, z, label: 'JOB BOARD' };
    }
    return null;
  }

  const boards = [];
  {
    // Preferred spots first — corners and edge midpoints, so the set is spread
    // across the city — then any remaining intersection as a fallback.
    const mid = Math.floor(NODE_N / 2);
    const wanted = [
      // The ring of crossings around the central park first — that's where the
      // player spawns, so there's work within a short walk of the start.
      [2, 2], [NODE_N - 3, 2], [2, NODE_N - 3], [NODE_N - 3, NODE_N - 3],
      // Then the outer corners and edge midpoints, for coverage further out.
      [1, 1], [NODE_N - 2, 1], [1, NODE_N - 2], [NODE_N - 2, NODE_N - 2],
      [mid, 1], [1, mid], [mid, NODE_N - 2], [NODE_N - 2, mid],
    ];
    for (let gx = 0; gx < NODE_N; gx++) for (let gz = 0; gz < NODE_N; gz++) wanted.push([gx, gz]);

    const used = new Set();
    for (const [gx, gz] of wanted) {
      if (boards.length >= T.boardCount) break;
      const key = `${gx},${gz}`;
      if (used.has(key)) continue;
      used.add(key);
      if (nodeInPark(gx) && nodeInPark(gz)) continue;  // the fountain lives there
      const spot = placeBoard(gx, gz);
      if (spot) boards.push(spot);
    }
    if (!boards.length) {
      // Nothing passed — better a board in an awkward spot than no work at all.
      boards.push({ x: nodeX(1), z: nodeX(1), label: 'JOB BOARD' });
      console.warn('missions: no clear job-board spot found; using a fallback');
    }
  }

  // ---- Markers ------------------------------------------------------------
  // One instanced beacon + beam covers the boards, the current objective and
  // any collect pickups. Slot 0..boards.length-1 are the boards; the rest are
  // dynamic (objective + pickups) and hidden by scaling to zero when unused.
  const DYNAMIC = 10;
  const total = boards.length + DYNAMIC;

  // An octahedron reads as a "waypoint gem" and is only 8 triangles.
  const gemGeo = new THREE.OctahedronGeometry(0.85, 0);
  const gemMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0.72, depthWrite: false,
    toneMapped: false, side: THREE.DoubleSide, // toneMapped:false → bloom haloes it
  });
  const gems = new THREE.InstancedMesh(gemGeo, gemMat, total);
  gems.castShadow = gems.receiveShadow = false;
  gems.frustumCulled = false;

  const beamGeo = new THREE.CylinderGeometry(0.6, 0.6, 4.0, 12, 1, true);
  beamGeo.translate(0, 2.0, 0);
  const beamMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0.1, depthWrite: false,
    toneMapped: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  const beams = new THREE.InstancedMesh(beamGeo, beamMat, total);
  beams.castShadow = beams.receiveShadow = false;
  beams.frustumCulled = false;
  group.add(beams, gems);

  const COL_BOARD = new THREE.Color(0x6ad0ff);   // available work — cool blue
  const COL_TARGET = new THREE.Color(0xffd23f);  // your current objective — gold
  const COL_PICKUP = new THREE.Color(0x8dffb0);  // collectables — green

  const _dummy = new THREE.Object3D();
  const _hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const slots = new Array(total).fill(null); // { x, z, color, y, kind }

  // ---- HUD ---------------------------------------------------------------
  const root = document.getElementById('mission');
  const elTitle = document.getElementById('mission-title');
  const elObj = document.getElementById('mission-objective');
  const elMeta = document.getElementById('mission-meta');
  const elProg = document.getElementById('mission-progress');
  const elFill = document.getElementById('mission-fill');

  // ---- State -------------------------------------------------------------
  let active = null;    // the mission being worked
  let offered = null;   // the job waiting at the boards
  let completed = 0;
  let totalEarned = 0;

  const dist2 = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2;

  // A destination that isn't right on top of the player, drawn from the POI
  // list so deliveries go to real, named places in the city.
  function pickPoi(awayFrom, minDist) {
    if (!pois.length) return null;
    for (let tries = 0; tries < 40; tries++) {
      const p = pois[Math.floor(rng() * pois.length)];
      if (!awayFrom || dist2(p.x, p.z, awayFrom.x, awayFrom.z) > minDist * minDist) {
        return { x: p.x, z: p.z, label: p.short || p.label };
      }
    }
    return { x: pois[0].x, z: pois[0].z, label: pois[0].short || pois[0].label };
  }

  const payFor = (range, d, dRef) => {
    const t = Math.max(0, Math.min(1, d / dRef));
    return Math.round(range[0] + (range[1] - range[0]) * t);
  };

  // ---- Mission generation -------------------------------------------------
  function makeMission(near) {
    const kinds = ['deliver', 'express', 'collect'];
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const title = TITLES[kind][Math.floor(rng() * TITLES[kind].length)];

    if (kind === 'deliver') {
      const from = pickPoi(near, 25) || { x: near.x, z: near.z, label: 'depot' };
      const to = pickPoi(from, T.deliver.minLegDist) || from;
      const d = Math.sqrt(dist2(from.x, from.z, to.x, to.z));
      return {
        kind, title,
        pay: payFor(T.deliver.pay, d, 260),
        stats: T.deliver.stats,
        stage: 0,               // 0 = collect the parcel, 1 = deliver it
        from, to,
      };
    }
    if (kind === 'express') {
      const to = pickPoi(near, T.express.minDist) || { x: near.x, z: near.z, label: 'site' };
      const d = Math.sqrt(dist2(near.x, near.z, to.x, to.z));
      return {
        kind, title,
        pay: payFor(T.express.pay, d, 260),
        stats: T.express.stats,
        to,
        limit: d / T.express.paceUnitsPerSec,
        left: d / T.express.paceUnitsPerSec,
      };
    }
    // collect: a cluster of pickups near a named place
    const at = pickPoi(near, 40) || { x: near.x, z: near.z, label: 'the area' };
    const n = Math.floor(T.collect.count[0] + rng() * (T.collect.count[1] - T.collect.count[0] + 1));
    const items = [];
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const r = T.collect.spread * (0.35 + rng() * 0.65);
      items.push({ x: at.x + Math.cos(a) * r, z: at.z + Math.sin(a) * r, got: false });
    }
    return {
      kind, title,
      pay: payFor(T.collect.pay, n, 8),
      stats: T.collect.stats,
      at, items, got: 0, need: n,
    };
  }

  // The place the player currently has to go, or null.
  function targetOf(m) {
    if (!m) return null;
    if (m.kind === 'deliver') return m.stage === 0 ? m.from : m.to;
    if (m.kind === 'express') return m.to;
    // collect: the nearest pickup still out there
    let best = null, bd = Infinity;
    for (const it of m.items) {
      if (it.got) continue;
      const d = dist2(it.x, it.z, _px, _pz);
      if (d < bd) { bd = d; best = it; }
    }
    return best ? { x: best.x, z: best.z, label: m.at.label } : null;
  }

  function objectiveText(m) {
    if (!m) return '';
    if (m.kind === 'deliver') {
      return m.stage === 0 ? `Collect the parcel at ${m.from.label}` : `Deliver to ${m.to.label}`;
    }
    if (m.kind === 'express') return `Reach ${m.to.label} before time runs out`;
    return `Collect the scattered items near ${m.at.label}`;
  }

  // ---- HUD render ---------------------------------------------------------
  let hudEnabled = false; // stays hidden behind the start overlay until show()

  function renderHUD() {
    if (!root) return;
    const m = active;
    root.classList.toggle('show', hudEnabled && !!(m || offered));

    if (!m) {
      elTitle.textContent = offered ? 'Work available' : 'No job';
      elObj.textContent = offered ? `${offered.title} — find a job board` : '';
      elMeta.textContent = offered ? `$${offered.pay}` : '';
      elProg.textContent = '';
      elFill.style.width = '0%';
      elFill.parentElement.style.display = 'none';
      return;
    }
    elTitle.textContent = m.title;
    elObj.textContent = objectiveText(m);
    elMeta.textContent = `$${m.pay}`;

    if (m.kind === 'express') {
      elProg.textContent = fmtTime(m.left);
      elProg.classList.toggle('urgent', m.left < 15);
      elFill.parentElement.style.display = '';
      elFill.style.width = `${Math.max(0, Math.min(1, m.left / m.limit)) * 100}%`;
      elFill.style.background = m.left < 15 ? '#ff5a4d' : '#ffd23f';
    } else if (m.kind === 'collect') {
      elProg.textContent = `${m.got}/${m.need}`;
      elProg.classList.remove('urgent');
      elFill.parentElement.style.display = '';
      elFill.style.width = `${(m.got / m.need) * 100}%`;
      elFill.style.background = '#8dffb0';
    } else {
      elProg.textContent = m.stage === 0 ? 'Pick up' : 'Deliver';
      elProg.classList.remove('urgent');
      elFill.parentElement.style.display = '';
      elFill.style.width = m.stage === 0 ? '10%' : '60%';
      elFill.style.background = '#ffd23f';
    }
  }

  // ---- Waypoint -----------------------------------------------------------
  function syncWaypoint() {
    if (!minimap) return;
    const t = active ? targetOf(active) : (offered ? nearestBoard(_px, _pz) : null);
    if (t) minimap.setDestination({ x: t.x, z: t.z, label: active ? t.label : 'Job board' });
    else minimap.clearDestination();
  }

  function nearestBoard(x, z) {
    let best = null, bd = Infinity;
    for (const b of boards) {
      const d = dist2(b.x, b.z, x, z);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // ---- Accept / complete --------------------------------------------------
  function accept() {
    if (active || !offered) return null;
    active = offered;
    offered = null;
    renderHUD();
    syncWaypoint();
    onToast({ kind: 'accept', title: active.title, text: objectiveText(active) });
    return active;
  }

  function complete() {
    const m = active;
    if (!m) return null;
    let pay = m.pay;
    let bonus = 0;
    if (m.kind === 'express') {
      bonus = Math.round(Math.max(0, m.left) * T.express.bonusPerSecLeft);
      pay += bonus;
    }
    if (needs) {
      needs.earn(pay);
      for (const [k, v] of Object.entries(m.stats || {})) needs.add(k, v);
    }
    completed++;
    totalEarned += pay;
    active = null;
    // Line up the next job so there's always something waiting.
    offered = makeMission({ x: _px, z: _pz });
    renderHUD();
    syncWaypoint();
    onToast({ kind: 'complete', title: m.title, pay, bonus, stats: m.stats });
    return { pay, bonus };
  }

  function fail(reason) {
    const m = active;
    if (!m) return;
    active = null;
    offered = makeMission({ x: _px, z: _pz });
    renderHUD();
    syncWaypoint();
    onToast({ kind: 'fail', title: m.title, text: reason });
  }

  // ---- Per-frame ----------------------------------------------------------
  let _px = 0, _pz = 0;
  let t = 0;
  let nearBoardSpot = null;

  /**
   * @param canProgress false while the player is indoors or on the train — the
   *   clock still runs (so you can't shelter in a shop to freeze an express
   *   job) but interior coordinates can't accidentally trip a city objective.
   */
  function update(dt, playerPos, canProgress = true) {
    t += dt;
    if (canProgress) { _px = playerPos.x; _pz = playerPos.z; }

    // Which board (if any) the player can take work from.
    nearBoardSpot = null;
    if (canProgress && offered && !active) {
      for (const b of boards) {
        if (dist2(b.x, b.z, _px, _pz) < T.reachRadius * T.reachRadius) { nearBoardSpot = b; break; }
      }
    }

    const m = active;
    if (m) {
      if (m.kind === 'express') {
        m.left -= dt;
        renderHUD();
        if (m.left <= 0) { fail('Out of time'); return refreshMarkers(); }
      }
      if (!canProgress) return refreshMarkers();

      const rr = T.reachRadius * T.reachRadius;
      if (m.kind === 'deliver') {
        const tgt = m.stage === 0 ? m.from : m.to;
        if (dist2(tgt.x, tgt.z, _px, _pz) < rr) {
          if (m.stage === 0) {
            m.stage = 1;
            renderHUD(); syncWaypoint();
            onToast({ kind: 'stage', title: m.title, text: `Parcel collected — take it to ${m.to.label}` });
          } else { complete(); return refreshMarkers(); }
        }
      } else if (m.kind === 'express') {
        if (dist2(m.to.x, m.to.z, _px, _pz) < rr) { complete(); return refreshMarkers(); }
      } else {
        const pr = T.pickupRadius * T.pickupRadius;
        for (const it of m.items) {
          if (it.got) continue;
          if (dist2(it.x, it.z, _px, _pz) < pr) {
            it.got = true; m.got++;
            onToast({ kind: 'pickup', title: m.title, text: `${m.got}/${m.need} collected` });
            if (m.got >= m.need) { complete(); return refreshMarkers(); }
            renderHUD(); syncWaypoint();
          }
        }
      }
      // Collect missions re-point at the nearest remaining pickup as you move.
      if (m && m.kind === 'collect') syncWaypoint();
    }

    refreshMarkers();
  }

  // Rebuild the instanced marker slots: boards, the live objective, pickups.
  function refreshMarkers() {
    slots.fill(null);
    for (let i = 0; i < boards.length; i++) {
      slots[i] = { x: boards[i].x, z: boards[i].z, color: COL_BOARD, y: 3.2, live: !!offered && !active };
    }
    let s = boards.length;
    const m = active;
    if (m) {
      if (m.kind === 'collect') {
        for (const it of m.items) {
          if (it.got || s >= total) continue;
          slots[s++] = { x: it.x, z: it.z, color: COL_PICKUP, y: 1.9, live: true };
        }
      } else {
        const tgt = targetOf(m);
        if (tgt && s < total) slots[s++] = { x: tgt.x, z: tgt.z, color: COL_TARGET, y: 3.2, live: true };
      }
    }

    for (let i = 0; i < total; i++) {
      const sl = slots[i];
      if (!sl) {
        gems.setMatrixAt(i, _hidden);
        beams.setMatrixAt(i, _hidden);
        continue;
      }
      const bob = Math.sin(t * 1.7 + i * 0.7) * 0.28;
      const pulse = sl.live ? 1 + Math.sin(t * 4 + i) * 0.08 : 0.8;
      _dummy.position.set(sl.x, sl.y + bob, sl.z);
      _dummy.rotation.set(0, t * 1.2 + i, 0);
      _dummy.scale.setScalar(pulse);
      _dummy.updateMatrix();
      gems.setMatrixAt(i, _dummy.matrix);
      gems.setColorAt(i, sl.color);

      _dummy.position.set(sl.x, 0, sl.z);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(1, sl.y / 3.2, 1);
      _dummy.updateMatrix();
      beams.setMatrixAt(i, _dummy.matrix);
      beams.setColorAt(i, sl.color);
    }
    gems.instanceMatrix.needsUpdate = true;
    beams.instanceMatrix.needsUpdate = true;
    if (gems.instanceColor) gems.instanceColor.needsUpdate = true;
    if (beams.instanceColor) beams.instanceColor.needsUpdate = true;
  }

  // Seed the first job.
  offered = makeMission({ x: 0, z: 0 });
  renderHUD();
  refreshMarkers();

  return {
    group,
    update,
    accept,
    /** The board the player is standing at, or null — drives the E prompt. */
    get boardInRange() { return nearBoardSpot; },
    get offered() { return offered; },
    get active() { return active; },
    /** Where the player currently has to go — the briefing camera frames this. */
    get activeTarget() { return active ? targetOf(active) : null; },
    get stats() { return { completed, totalEarned }; },
    show() { hudEnabled = true; renderHUD(); syncWaypoint(); },
    // For missions handed out by other systems later.
    give(mission) { if (!active) { offered = mission; renderHUD(); syncWaypoint(); } },
  };
}
