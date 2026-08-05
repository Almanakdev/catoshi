import * as THREE from 'three';
import { sharedVrmLibrary, onVrmLibraryReady, VRM_MODEL_COUNT } from './vrmLibrary.js';
import { poseLocomotion, strideRate } from './humanoidPose.js';

// The city crowd. EVERY person is a real rigged VRM at every distance — there
// are no box stand-ins anywhere. Three populations share one simulation:
//
//  · pedestrians — locals strolling the sidewalk ring of a block.
//  · "players"   — simulated other people playing the game. They roam the road
//                  grid intersection to intersection, stop to look around,
//                  sprint, spam the jump button, and carry a billboarded
//                  username label. Nothing is networked; it just reads like a
//                  populated server.
//  · commuters   — passengers on the MRT platforms. They wait along the deck,
//                  step to the platform edge and board when the train actually
//                  halts at their station, then a fresh batch turns up for the
//                  next service.
//
// Everyone walks with the SAME procedural humanoid gait as the player
// (humanoidPose.js), written onto their normalized VRM bones.
//
// ---------------------------------------------------------------------------
// PERFORMANCE
// ---------------------------------------------------------------------------
// A VRM avatar costs ~17 draw calls and ~36k triangles, so the population is a
// hard budget, not a free dial: `count` is the total number of avatars that
// exist, and `maxVisible` is the most that may render in any single frame.
// Everything else is spent by distance band:
//
//   off-screen / beyond drawFar → root.visible = false AND
//                                 matrixWorldAutoUpdate = false, so the
//                                 renderer and the scene-graph walk both skip
//                                 the entire ~260-node rig. Their route still
//                                 ticks, at 1/8 rate, for a few vector ops —
//                                 so they haven't teleported when you turn back.
//   far    (> animMid)          → visible, gait re-posed at ~10 Hz, no springs,
//                                 facial detail meshes off (~35% fewer calls)
//   mid    (> animFull)         → visible, gait re-posed every other frame,
//                                 no springs, facial detail off
//   near                        → full-rate gait, facial detail on
//   nearest springNear/shadowNear → spring bones (hair + cloth) / shadow casting
//
// Note the LOD bands trade DRAW CALLS and CPU, not triangles: the facial detail
// meshes are only ~2% of an avatar's geometry. Triangle load is governed by
// `maxVisible` and the frustum test, which is why those are the hard caps.

const USERNAMES = [
  'NeonFox', 'kaito_99', 'PixelWren', 'ramen_lord', 'Bluejay', 'Mochi', 'VoltRabbit',
  'sunny_exe', 'GhostTram', 'Yuzu', 'NoScopeNina', 'tako8', 'DriftKing', 'Marzipan',
  'LO_FI', 'kenji_r', 'AzureCat', 'PocketRocket', 'hanabi', 'SlowLoris', 'Truffle',
  'BitCrush', 'MidnightOwl', 'Sango', 'peppermint', 'Karou', 'ZipZap', 'Umeboshi',
  'RustyGull', 'Nomad42', 'plum_rain', 'Sable', 'TinCan', 'Koi', 'FiveSeven', 'Wisp',
  'Onigiri', 'gravyboat', 'Skylark', 'Mothlight', 'Cassette', 'BentoBox', 'Halcyon',
  'quietstorm', 'Pom', 'JellyBean', 'Static', 'Tangerine',
];

// Outfit tints, multiplied over each VRM's own colours. They have to stay near
// white or the skin and hair tint too — this is a change of clothes, not a
// repaint. Locals get muted city colours, "players" louder ones.
const LOCAL_TINTS = [0xffffff, 0xffe8d8, 0xdfe8ff, 0xe6ffe8, 0xfff4d0, 0xf0e2ff];
const PLAYER_TINTS = [0xffd0d8, 0xd0fff4, 0xfff0b0, 0xd0e0ff, 0xecd0ff, 0xd6ffcc, 0xffdcc0, 0xc8f4ff];

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

// A rounded name plate drawn on a canvas → sprite texture. Sprites are
// billboards by construction, so the label always faces the camera for free.
function makeLabelSprite(name, accentHex) {
  const pad = 26;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = '700 40px system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.font = font;
  const textW = Math.ceil(ctx.measureText(name).width);
  canvas.width = textW + pad * 2 + 34;
  canvas.height = 68;

  const w = canvas.width, h = canvas.height, r = h / 2;
  ctx.font = font; // resizing the canvas resets the context
  ctx.fillStyle = 'rgba(14,18,26,0.74)';
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(2, 2, w - 4, h - 4, r);
  else ctx.rect(2, 2, w - 4, h - 4);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = `#${accentHex.toString(16).padStart(6, '0')}`;
  ctx.beginPath();
  ctx.arc(pad + 2, h / 2, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#f5ead8';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, pad + 22, h / 2 + 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;

  const LABEL_H = 1.15;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 })
  );
  sprite.scale.set(LABEL_H * (w / h), LABEL_H, 1);
  sprite.visible = false;
  return sprite;
}

export function createCrowd(scene, opts = {}) {
  const {
    blocks = 8,
    blockSize = 34,
    road = 12,
    pedCount = 12,      // sidewalk locals
    playerCount = 16,   // simulated "other players" (each also gets a label)
    commutersPerStation = 3,
    transit = null,     // { stations, platLen, platW, deckTop, stoppedIndex() }
    seed = 20713,
    parkB0 = null,
    parkB1 = null,
    maxVisible = 8,     // HARD cap on avatars rendered in one frame
    springNear = 3,     // spring-bone physics: the priciest per-frame VRM cost
    shadowNear = 3,
    drawFar = 190,      // beyond this nobody renders at all
    animFull = 45,      // full-rate gait inside this radius
    animMid = 95,       // half-rate gait inside this; ~10 Hz beyond
    detailFar = 30,     // facial detail meshes switch off past this
    outlineFar = 70,    // past this, skip the ink/AO prepass (line is sub-pixel)
    labelFar = 105,
    targetHeight = 4,
  } = opts;

  const rng = mulberry32(seed);
  const stride = blockSize + road;
  const half = (blocks * stride) / 2;
  const drawFar2 = drawFar * drawFar;
  const labelFar2 = labelFar * labelFar;
  const outlineFar2 = outlineFar * outlineFar;

  const isParkBlock = (bx, bz) =>
    parkB0 !== null && bx >= parkB0 && bx <= parkB1 && bz >= parkB0 && bz <= parkB1;

  const group = new THREE.Group();   // avatar roots
  const labels = new THREE.Group();  // username sprites (kept apart so the
  labels.name = 'crowd-labels';      // outline/AO prepass can hide them)
  scene.add(group, labels);

  const people = [];
  const players = [];
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const range = (a, b) => a + rng() * (b - a);

  // A looping sidewalk ring around one city block.
  function blockRing(bx, bz, inset) {
    const cx = -half + bx * stride + blockSize / 2;
    const cz = -half + bz * stride + blockSize / 2;
    const s = blockSize / 2 + 1.5 + inset;
    return [
      new THREE.Vector3(cx - s, 0, cz - s),
      new THREE.Vector3(cx + s, 0, cz - s),
      new THREE.Vector3(cx + s, 0, cz + s),
      new THREE.Vector3(cx - s, 0, cz + s),
    ];
  }

  // Road-grid nodes for the roaming players: interior street intersections.
  const NODE_N = blocks - 1;
  const nodeX = (i) => -half + (i + 1) * stride - road / 2;

  // ---- Population (built once the five models have loaded) ------------------
  const nameBag = USERNAMES.slice();
  let onPopulated = () => {};
  let visibleCap = maxVisible;

  // Shared with the opening scene's nurse, so the five VRMs are parsed once.
  const library = sharedVrmLibrary({ baseHeight: targetHeight });
  onVrmLibraryReady(spawn);

  // A spot on a station platform: `a` runs along the track, `p` across it,
  // with p = -platW/2 the trackside edge the train doors open onto.
  function platformSpot(st, a, p) {
    return {
      x: st.x + st.along.x * a + st.perp.x * p,
      z: st.z + st.along.z * a + st.perp.z * p,
    };
  }

  function spawn() {
    if (library.loadedCount === 0) {
      console.error('crowd: no VRM models loaded — the city will be empty');
      return;
    }

    const stations = transit?.stations || [];
    const commuterTotal = stations.length * commutersPerStation;

    for (let i = 0; i < pedCount + playerCount + commuterTotal; i++) {
      const isCommuter = i >= pedCount + playerCount;
      const isPlayer = !isCommuter && i >= pedCount;
      // Models are handed out round-robin over a spatially random population:
      // an even 1-in-5 spread, where per-agent randomness could clump.
      const avatar = library.make(i % VRM_MODEL_COUNT);
      if (!avatar) continue;

      const tintHex = isPlayer ? pick(PLAYER_TINTS) : pick(LOCAL_TINTS);
      avatar.setTint(new THREE.Color(tintHex));
      // Vary stature so five models don't read as five clones.
      const worldH = range(3.5, 4.3);
      avatar.root.scale.setScalar(worldH / library.baseHeight);
      group.add(avatar.root);

      const n = {
        avatar,
        root: avatar.root,
        worldH,
        kind: isCommuter ? 'commuter' : isPlayer ? 'player' : 'ped',
        speed: 0,
        animSpeed: 0,
        heading: 0,
        phase: rng() * Math.PI * 2,
        elapsed: rng() * 10,
        jumpY: 0,
        jumpV: 0,
        idleT: 0,
        // LOD bookkeeping
        visible: false,
        d2: Infinity,
        poseAcc: 0,   // dt banked since the last re-pose (keeps the gait in time)
        offAcc: 0,    // dt banked while off-screen (cheap route catch-up)
      };

      if (isPlayer) {
        const name = nameBag.length
          ? nameBag.splice(Math.floor(rng() * nameBag.length), 1)[0]
          : `guest${100 + i}`;
        // Each player keeps a fixed lateral offset from the street centreline,
        // so they walk their own lane instead of single file down the middle.
        n.name = name;
        n.lane = new THREE.Vector2(range(-4.2, 4.2), range(-4.2, 4.2));
        n.gx = Math.floor(rng() * NODE_N);
        n.gz = Math.floor(rng() * NODE_N);
        n.root.position.set(nodeX(n.gx) + n.lane.x, 0, nodeX(n.gz) + n.lane.y);
        n.tx = n.root.position.x;
        n.tz = n.root.position.z;
        n.walkSpeed = range(3.4, 4.6);
        n.state = 'walk';
        n.sprint = 0;
        n.nextJump = range(4, 16);
        n.label = makeLabelSprite(name, tintHex);
        labels.add(n.label);
        players.push(n);
      } else if (isCommuter) {
        n.station = Math.floor((i - pedCount - playerCount) / commutersPerStation);
        n.walkSpeed = range(2.2, 3.2);
        n.deckY = transit.deckTop;
        placeWaiting(n, true);
      } else {
        let bx, bz, guard = 0;
        do {
          bx = Math.floor(rng() * blocks);
          bz = Math.floor(rng() * blocks);
        } while (isParkBlock(bx, bz) && ++guard < 30);
        const ring = blockRing(bx, bz, rng() * 2.6);
        if (rng() < 0.5) ring.reverse();
        const segIdx = Math.floor(rng() * 4);
        const a = ring[segIdx], b = ring[(segIdx + 1) % 4];
        n.ring = ring;
        n.target = (segIdx + 1) % 4;
        n.root.position.lerpVectors(a, b, rng());
        n.speed = range(2.0, 3.6);
        n.heading = Math.atan2(b.x - a.x, b.z - a.z);
      }
      n.root.rotation.y = n.heading;
      people.push(n);
    }
    onPopulated(players.map((p) => p.name));
  }

  // ---- Commuters -----------------------------------------------------------
  // Waiting spots are spread along the deck and set back from the track edge;
  // the boarding spot is the same point pushed forward to the yellow line.
  function placeWaiting(n, snap) {
    const st = transit.stations[n.station];
    const a = range(-transit.platLen / 2 + 3, transit.platLen / 2 - 3);
    const p = range(-transit.platW / 2 + 2.2, transit.platW / 2 - 2.6);
    n.wait = platformSpot(st, a, p);
    n.board = platformSpot(st, a, -transit.platW / 2 + 1.0);
    n.state = 'wait';
    n.hidden = false;
    n.waitYaw = Math.atan2(-st.perp.x, -st.perp.z); // face the track
    if (snap) {
      n.root.position.set(n.wait.x, n.deckY, n.wait.z);
      n.root.rotation.y = n.waitYaw;
      n.heading = n.waitYaw;
    }
  }

  function stepCommuter(n, dt) {
    const p = n.root.position;
    p.y = n.deckY;
    const stopped = transit.stoppedIndex();

    if (n.state === 'wait') {
      n.animSpeed = 0;
      // Look up the line for the train now and then.
      n.heading = n.waitYaw + Math.sin(n.elapsed * 0.5 + n.phase) * 0.35;
      if (stopped === n.station) { n.state = 'board'; n.boardDelay = rng() * 1.1; }
    } else if (n.state === 'board') {
      // A short stagger so the platform empties as a queue, not a block.
      if (n.boardDelay > 0) { n.boardDelay -= dt; n.animSpeed = 0; }
      else {
        _dir.set(n.board.x - p.x, 0, n.board.z - p.z);
        const dist = _dir.length();
        n.animSpeed = n.walkSpeed;
        if (dist < 0.4) {
          // Through the doors: park them off-platform until the next service.
          n.state = 'gone';
          n.hidden = true;
          n.animSpeed = 0;
        } else {
          _dir.divideScalar(dist);
          p.addScaledVector(_dir, Math.min(n.walkSpeed * dt, dist));
          n.heading = Math.atan2(_dir.x, _dir.z);
        }
      }
    } else { // 'gone' — reappear as a new passenger once the train has left
      n.animSpeed = 0;
      if (stopped !== n.station) {
        n.reappear = (n.reappear ?? range(2, 12)) - dt;
        if (n.reappear <= 0) { n.reappear = null; placeWaiting(n, true); }
      }
    }
    n.root.rotation.y = lerpAngle(n.root.rotation.y, n.heading, 1 - Math.exp(-dt * 6));
  }

  // ---- Route simulation (unchanged by LOD — only posing is rate-limited) ----
  const _dir = new THREE.Vector3();
  const PLAYER_GRAV = 46;
  const PLAYER_JUMP = 13;

  function retarget(n) {
    const gx0 = n.gx, gz0 = n.gz;
    for (let tries = 0; tries < 8; tries++) {
      const step = rng() < 0.5 ? 1 : -1;
      if (rng() < 0.5) n.gx = Math.max(0, Math.min(NODE_N - 1, gx0 + step));
      else n.gz = Math.max(0, Math.min(NODE_N - 1, gz0 + step));
      if (n.gx !== gx0 || n.gz !== gz0) break;
    }
    n.tx = nodeX(n.gx) + n.lane.x;
    n.tz = nodeX(n.gz) + n.lane.y;
  }

  function stepRoute(n, dt) {
    const p = n.root.position;
    if (n.kind === 'commuter') {
      stepCommuter(n, dt);
    } else if (n.kind === 'player') {
      n.nextJump -= dt;
      if (n.nextJump <= 0 && n.jumpY === 0) { n.jumpV = PLAYER_JUMP; n.nextJump = range(5, 18); }
      if (n.jumpV !== 0 || n.jumpY > 0) {
        n.jumpV -= PLAYER_GRAV * dt;
        n.jumpY += n.jumpV * dt;
        if (n.jumpY <= 0) { n.jumpY = 0; n.jumpV = 0; }
      }

      if (n.state === 'idle') {
        n.idleT -= dt;
        n.speed += (0 - n.speed) * Math.min(1, dt * 8);
        n.heading += Math.sin(n.phase * 0.7) * dt * 0.6; // look around while stopped
        if (n.idleT <= 0) n.state = 'walk';
      } else {
        if (n.sprint > 0) n.sprint -= dt;
        const want = n.walkSpeed * (n.sprint > 0 ? 2.1 : 1);
        n.speed += (want - n.speed) * Math.min(1, dt * 5);

        _dir.set(n.tx - p.x, 0, n.tz - p.z);
        const dist = _dir.length();
        if (dist < 0.6) {
          retarget(n);
          const r = rng();
          if (r < 0.22) { n.state = 'idle'; n.idleT = range(1.2, 4.0); }
          else if (r < 0.36) n.sprint = range(1.5, 4.0);
        } else {
          _dir.divideScalar(dist);
          p.addScaledVector(_dir, Math.min(n.speed * dt, dist));
          n.heading = Math.atan2(_dir.x, _dir.z);
        }
      }
      n.root.rotation.y = lerpAngle(n.root.rotation.y, n.heading, 1 - Math.exp(-dt * 7));
      p.y = n.jumpY;
      n.animSpeed = n.speed;
    } else {
      n.animSpeed = n.idleT > 0 ? 0 : n.speed;
      if (n.idleT > 0) {
        n.idleT -= dt;
      } else {
        const tgt = n.ring[n.target];
        _dir.set(tgt.x - p.x, 0, tgt.z - p.z);
        const dist = _dir.length();
        if (dist < 0.3) {
          n.target = (n.target + 1) % 4;
          if (rng() < 0.12) n.idleT = range(0.8, 2.6);
        } else {
          _dir.divideScalar(dist);
          p.addScaledVector(_dir, Math.min(n.speed * dt, dist));
          n.heading = Math.atan2(_dir.x, _dir.z);
          n.root.rotation.y = lerpAngle(n.root.rotation.y, n.heading, 1 - Math.exp(-dt * 8));
        }
      }
    }
  }

  // Write the gait onto the normalized bones and copy it through to the raw rig.
  function pose(n, dt) {
    n.phase += dt * strideRate(n.animSpeed);
    n.elapsed += dt;
    poseLocomotion(n.avatar.bones, n.avatar.hipsRestY, {
      speed: n.animSpeed, phase: n.phase, elapsed: n.elapsed,
    });
    if (n.jumpY > 0.05) { // airborne: tuck the knees, arms up
      const b = n.avatar.bones;
      if (b.leftUpperLeg) b.leftUpperLeg.rotation.x = 0.9;
      if (b.leftLowerLeg) b.leftLowerLeg.rotation.x = 1.1;
      if (b.rightUpperLeg) b.rightUpperLeg.rotation.x = -0.4;
      if (b.rightLowerLeg) b.rightLowerLeg.rotation.x = 0.6;
      if (b.leftUpperArm) b.leftUpperArm.rotation.x = -1.2;
      if (b.rightUpperArm) b.rightUpperArm.rotation.x = -1.2;
    }
    // Humanoid half of vrm.update(dt): normalized rig → raw bones. Expressions
    // and look-at are deliberately skipped; the crowd has no use for them.
    n.avatar.humanoid.update();
  }

  // ---- Per-frame ------------------------------------------------------------
  const _frustum = new THREE.Frustum();
  const _fmat = new THREE.Matrix4();
  const _sphere = new THREE.Sphere(new THREE.Vector3(), 3);
  const shown = [];
  let frame = 0;
  let visibleCount = 0;

  function update(dt, camera, playerPos) {
    frame++;
    // Refresh the view matrix first — the controller has just moved the camera
    // this frame, and a stale inverse would cull against where it *was*, popping
    // people in a frame late at the screen edge during a fast turn.
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    _fmat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_fmat);
    shown.length = 0;

    for (let i = 0; i < people.length; i++) {
      const n = people[i];
      const p = n.root.position;
      const dx = p.x - playerPos.x, dz = p.z - playerPos.z;
      n.d2 = dx * dx + dz * dz;

      // Frustum test against a body-sized sphere at chest height. Cheap, and
      // unlike per-mesh culling it doesn't depend on skinned bounds.
      _sphere.center.set(p.x, p.y + n.worldH * 0.5, p.z);
      _sphere.radius = n.worldH * 0.75; // a little margin for swung limbs + hair
      // `hidden` is a commuter who has boarded the train — they keep ticking
      // (so they can reappear for the next service) but never render.
      const onScreen = !n.hidden && n.d2 < drawFar2 && _frustum.intersectsSphere(_sphere);
      if (onScreen) shown.push(n);
      else park(n, dt);
    }

    // Nearest first, then the hard cap: anything past it is parked outright.
    shown.sort((a, b) => a.d2 - b.d2);
    visibleCount = Math.min(shown.length, visibleCap);
    for (let i = visibleCount; i < shown.length; i++) park(shown[i], dt);

    for (let i = 0; i < visibleCount; i++) {
      const n = shown[i];
      const p = n.root.position;
      if (!n.visible) {
        n.visible = true;
        n.root.visible = true;
        n.root.matrixWorldAutoUpdate = true;
        if (n.avatar.springs) n.avatar.springs.reset(); // no whiplash on re-entry
      }

      // The route always runs at full rate for anyone on screen, so nobody
      // slides or stutters along the pavement.
      stepRoute(n, dt + n.offAcc);
      n.offAcc = 0;

      const d = Math.sqrt(n.d2);
      // Gait: full rate up close, every other frame at mid range, ~10 Hz far
      // away. Banked dt keeps the stride in time whichever rate is in play.
      const every = d < animFull ? 1 : d < animMid ? 2 : 6;
      n.poseAcc += dt;
      if (every === 1 || (frame + i) % every === 0) {
        pose(n, n.poseAcc);
        n.poseAcc = 0;
      }

      n.avatar.setDetail(d < detailFar);
      n.avatar.setShadow(i < shadowNear);
      // Spring bones (hair / cloth) only for the very nearest.
      if (n.avatar.springs && i < springNear) n.avatar.springs.update(dt);

      if (n.label) {
        const show = n.d2 < labelFar2;
        if (n.label.visible !== show) n.label.visible = show;
        if (show) {
          n.label.position.set(p.x, p.y + n.worldH + 0.75, p.z);
          n.label.material.opacity = Math.min(1, (labelFar - d) / 25);
        }
      }
    }
  }

  // Off-screen: hide the avatar AND stop the scene graph descending into its
  // ~260-node rig, then tick the route at 1/8 rate so it hasn't teleported by
  // the time you look back.
  function park(n, dt) {
    if (n.visible) {
      n.visible = false;
      n.root.visible = false;
      n.root.matrixWorldAutoUpdate = false;
      if (n.label) n.label.visible = false;
    }
    n.offAcc += dt;
    if (n.offAcc > 0.12) {
      stepRoute(n, n.offAcc);
      n.offAcc = 0;
    }
  }

  // The ink-outline / AO prepass re-renders everything a second time. Distant
  // avatars are excluded: at that range the line is sub-pixel, and skipping
  // them halves their cost.
  const _prepassHidden = [];
  function beginNormalPass() {
    _prepassHidden.length = 0;
    for (let i = 0; i < visibleCount; i++) {
      const n = shown[i];
      if (n.d2 > outlineFar2 && n.root.visible) {
        n.root.visible = false;
        _prepassHidden.push(n.root);
      }
    }
  }
  function endNormalPass() {
    for (let i = 0; i < _prepassHidden.length; i++) _prepassHidden[i].visible = true;
    _prepassHidden.length = 0;
  }

  return {
    group,
    labels,
    update,
    beginNormalPass,
    endNormalPass,
    // The five models load async, so the chat/leaderboard can't know the
    // usernames up front — they arrive through here.
    onPopulated(cb) { onPopulated = cb; if (players.length) cb(players.map((p) => p.name)); },
    get playerNames() { return players.map((p) => p.name); },
    // Hard cap on avatars rendered per frame — the perf tiers drive this.
    setMaxVisible(n) { visibleCap = Math.max(0, n); },
    get stats() {
      return { total: people.length, visible: visibleCount, cap: visibleCap };
    },
  };
}
