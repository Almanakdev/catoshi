import * as THREE from 'three';
import { isTypingInUI } from './inputGuard.js';

// Third-person controller:
// - Drag the cursor (mouse/touch) to orbit the camera around the character.
// - WASD moves relative to the camera direction.
// - Space jumps (gravity arc, no double-jump); Ctrl / C crouches.
// - The character turns to face the way it's moving and plays a walk cycle.
// - Mouse wheel zooms; building/vendor colliders push the character out of walls.
//
// Returns { update, setEnabled, state }.

export function createThirdPerson(camera, dom, character, colliders, bounds, groundHeightAt = () => 0, dynamicColliders = [], opts = {}) {
  // Tuning is injectable so the same controller drives a 4-unit humanoid (the
  // original engine) and a 1-unit cat (Sushi Paws) without a second copy.
  const TUNE = {
    playerH: 3.5, radius: 1.4, stepUp: 3,
    gravity: 62, jumpV: 21, fallLedge: 1.5,
    walk: 9, run: 18,
    dist: 12, distMin: 5, distMax: 24,
    headScale: 3.0, headFactor: 0.7,
    ...opts,
  };
  const PLAYER_H = TUNE.playerH;
  const MAX_STEP_UP = TUNE.stepUp;
  const state = { yaw: Math.PI, pitch: 0.35 };
  let enabled = false;
  let lookMode = false; // look-around only (e.g. while riding the train)
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let dist = TUNE.dist;

  // --- Vertical motion (jump / fall) + crouch --------------------------------
  // The world is built at roughly 2.3× life size (the avatar is 4 units tall),
  // so gravity and the launch speed are scaled to match — otherwise a "realistic"
  // 9.8 m/s² makes the jump feel like it's happening on the moon.
  const GRAVITY = TUNE.gravity; // units/s²
  const JUMP_V = TUNE.jumpV; // launch speed → ~3.5 units of air, ~0.7 s hang time
  const FALL_LEDGE = TUNE.fallLedge; // drop under the feet that becomes a real fall (not a stair lip)
  let vy = 0;
  let grounded = true;
  let jumpQueued = false;  // set on the Space keydown edge, consumed next update
  let crouch = 0;          // 0 = standing … 1 = fully crouched (eased)
  // External impulse (being hit by a car). Decays exponentially, and goes through
  // the normal collision pass so you can't be shoved inside a building.
  const knock = { x: 0, z: 0 };

  let lastSpeed = 0;
  const keys = Object.create(null);
  const clearKeys = () => { for (const k in keys) keys[k] = false; };

  window.addEventListener('keydown', (e) => {
    if (isTypingInUI()) return; // typing in the chat box — not driving the character
    keys[e.code] = true;
    if (e.code === 'Space') {
      e.preventDefault();       // Space must not scroll the page or re-click the last button
      // Queue only from the ground: this is the single gate that makes
      // double-jumping impossible (update() re-checks `grounded` too).
      if (enabled && grounded) jumpQueued = true;
    }
  });
  window.addEventListener('keyup', (e) => (keys[e.code] = false));
  // Alt-tabbing away while holding W used to leave the character walking forever.
  window.addEventListener('blur', clearKeys);

  // --- Free look (no pointer lock, no click required) ---
  // The camera follows the cursor automatically: pushing the cursor toward a
  // screen edge rotates the view that way, with a comfortable dead zone in the
  // middle so the camera holds still while you're just hovering. Click-and-drag
  // still works on top of it for fast, precise swings.
  const cursor = { x: 0, y: 0, over3D: false }; // normalized -1..1 from center
  dom.addEventListener('pointerdown', (e) => {
    if (!enabled && !lookMode) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    dom.style.cursor = 'grabbing';
    if (dom.setPointerCapture) dom.setPointerCapture(e.pointerId);
  });
  window.addEventListener('pointermove', (e) => {
    cursor.x = (e.clientX / window.innerWidth) * 2 - 1;
    cursor.y = (e.clientY / window.innerHeight) * 2 - 1;
    // Only edge-steer while the cursor is over the 3D view — hovering the
    // customize panel or other UI shouldn't spin the camera.
    cursor.over3D = e.target === dom;
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    state.yaw -= dx * 0.005;
    state.pitch -= dy * 0.005;
    // Flexible pitch: negative lifts the camera above the character (look down),
    // positive drops it low (look up past them).
    state.pitch = Math.max(-0.9, Math.min(1.4, state.pitch));
  });
  // Cursor gone (left the window) — stop steering until it comes back.
  document.documentElement.addEventListener('mouseleave', () => {
    cursor.over3D = false;
  });
  const endDrag = () => {
    dragging = false;
    if (enabled) dom.style.cursor = 'grab';
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  dom.addEventListener(
    'wheel',
    (e) => {
      if (!enabled && !lookMode) return;
      dist = Math.max(TUNE.distMin, Math.min(TUNE.distMax, dist + Math.sign(e.deltaY)));
    },
    { passive: true }
  );

  let facing = state.yaw;
  const pos = character.group.position;
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const move = new THREE.Vector3();
  const target = new THREE.Vector3();
  const dir = new THREE.Vector3();

  // Static city boxes plus anything that moves (traffic). Both are handled by
  // the same push-out so a car body blocks the character exactly like a wall.
  function resolveCollisions() {
    const feetY = pos.y, headY = pos.y + PLAYER_H;
    const total = colliders.length + dynamicColliders.length;
    for (let i = 0; i < total; i++) {
      const b = i < colliders.length ? colliders[i] : dynamicColliders[i - colliders.length];
      // Skip colliders the player isn't level with (so elevated platform
      // railings only block up on the deck, not while walking underneath).
      if (headY <= b.min.y || feetY >= b.max.y) continue;
      const r = TUNE.radius;
      // Strictly INSIDE the box: the closest point on the box is the point
      // itself, so the usual push-out is a no-op and the character sinks
      // straight through. That never mattered for buildings (you can't get
      // inside one) but a moving car body drives over you — so eject along the
      // shallowest face instead.
      if (pos.x > b.min.x && pos.x < b.max.x && pos.z > b.min.z && pos.z < b.max.z) {
        const exits = [pos.x - b.min.x, b.max.x - pos.x, pos.z - b.min.z, b.max.z - pos.z];
        const m = Math.min(exits[0], exits[1], exits[2], exits[3]);
        if (m === exits[0]) pos.x = b.min.x - r;
        else if (m === exits[1]) pos.x = b.max.x + r;
        else if (m === exits[2]) pos.z = b.min.z - r;
        else pos.z = b.max.z + r;
        continue;
      }
      const cx = Math.max(b.min.x, Math.min(pos.x, b.max.x));
      const cz = Math.max(b.min.z, Math.min(pos.z, b.max.z));
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        const d = Math.sqrt(d2) || 0.0001;
        const push = (r - d) / d;
        pos.x += dx * push;
        pos.z += dz * push;
      }
    }
    const lim = bounds + 40;
    pos.x = Math.max(-lim, Math.min(lim, pos.x));
    pos.z = Math.max(-lim, Math.min(lim, pos.z));
  }

  function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return a + d * t;
  }

  // Eased steering curve: zero inside the dead zone, then ramping up toward
  // the screen edge — gentle drift near center, a brisk turn at the border.
  function steer(v) {
    const dead = 0.3;
    const a = Math.abs(v);
    if (a <= dead) return 0;
    const t = (a - dead) / (1 - dead);
    return Math.sign(v) * t * t;
  }

  function update(dt) {
    // Keys held when the chat box took focus would otherwise stay "down" for as
    // long as you type (keyup never reaches us) — drop them every frame instead.
    if (isTypingInUI()) clearKeys();

    // Cursor-follow look (skipped while dragging — drag has manual control).
    if (enabled && !dragging && cursor.over3D) {
      state.yaw -= steer(cursor.x) * 1.9 * dt;
      state.pitch -= steer(cursor.y) * 1.2 * dt;
      state.pitch = Math.max(-0.9, Math.min(1.4, state.pitch));
    }

    let speed = 0;
    forward.set(Math.sin(state.yaw), 0, Math.cos(state.yaw));
    // Screen-right = cross(forward, up); the previous sign made A/D strafe the
    // wrong way, so this is negated to match.
    right.set(-Math.cos(state.yaw), 0, Math.sin(state.yaw));

    // Crouch: held with Ctrl or C, and only on the ground — leaving the ground
    // (or letting go) eases you back up over ~0.1 s so the pose never snaps.
    const wantCrouch = enabled && grounded && (keys['ControlLeft'] || keys['ControlRight'] || keys['KeyC']);
    crouch += ((wantCrouch ? 1 : 0) - crouch) * Math.min(1, dt * 14);
    if (crouch < 0.002) crouch = 0;

    if (enabled) {
      move.set(0, 0, 0);
      if (keys['KeyW']) move.add(forward);
      if (keys['KeyS']) move.sub(forward);
      if (keys['KeyD']) move.add(right);
      if (keys['KeyA']) move.sub(right);
      if (move.lengthSq() > 0) {
        move.normalize();
        // No sprinting out of a crouch; crouch-walking is a ~40% speed waddle.
        const run = (keys['ShiftLeft'] || keys['ShiftRight']) && crouch < 0.35;
        const spd = (run ? TUNE.run : TUNE.walk) * (1 - 0.58 * crouch);
        pos.x += move.x * spd * dt;
        pos.z += move.z * spd * dt;
        speed = spd;
        facing = Math.atan2(move.x, move.z);
      }
    } else {
      jumpQueued = false; // don't bank a jump while the controller is off
    }

    // Carry any impulse from an impact before collisions are resolved.
    if (knock.x || knock.z) {
      pos.x += knock.x * dt;
      pos.z += knock.z * dt;
      const decay = Math.exp(-dt * 4.5);
      knock.x *= decay; knock.z *= decay;
      if (Math.abs(knock.x) + Math.abs(knock.z) < 0.06) { knock.x = 0; knock.z = 0; }
    }

    resolveCollisions();

    // ---- Vertical: launch, gravity, landing, ground follow ------------------
    const gy = groundHeightAt(pos.x, pos.z);
    if (jumpQueued) {
      jumpQueued = false;
      if (grounded) { grounded = false; vy = JUMP_V; } // one jump per touchdown
    }
    if (grounded && pos.y - gy > FALL_LEDGE) {
      // Walked off a real edge (the platform deck, not a stair lip) — fall
      // properly instead of gliding down the eased follow below.
      grounded = false;
      vy = 0;
    }
    if (grounded) {
      // Follow the walkable ground height (station stairs ramp + platform deck),
      // eased so steps read smooth. But NEVER auto-lift up a tall ledge: if the
      // surface under us is far above our feet, that's a platform edge / frame, not
      // a ramp — stay put and let the solid collider block us horizontally instead.
      // (The stairs rise gradually, so climbing them stays within MAX_STEP_UP.)
      if (gy - pos.y <= MAX_STEP_UP) {
        pos.y += (gy - pos.y) * Math.min(1, dt * 18);
        if (Math.abs(pos.y - gy) < 0.02) pos.y = gy;
      }
    } else {
      vy -= GRAVITY * dt;
      pos.y += vy * dt;
      // Touchdown. Testing vy <= 0 means the rising half of the arc can pass
      // through a ledge and land on top of it instead of snapping back down.
      if (vy <= 0 && pos.y <= gy) { pos.y = gy; vy = 0; grounded = true; }
    }

    // Smoothly turn the character toward the movement direction.
    character.group.rotation.y = lerpAngle(character.group.rotation.y, facing, 0.18);
    lastSpeed = speed;
    character.update(dt, speed, { crouch, airborne: !grounded, vy });

    // Orbit camera behind the character (dropping with them into the crouch).
    // Cat and humanoid rigs report their own eye height; fall back to the old
    // fixed multiple so the original engine characters still frame correctly.
    const eyeH = typeof character.eyeHeight === 'function'
      ? character.eyeHeight()
      : TUNE.headScale * character.group.scale.y;
    const headH = eyeH * (1 - 0.26 * crouch);
    target.set(pos.x, pos.y + headH * TUNE.headFactor, pos.z);
    dir.set(
      Math.sin(state.yaw) * Math.cos(state.pitch),
      Math.sin(state.pitch),
      Math.cos(state.yaw) * Math.cos(state.pitch)
    );
    camera.position.copy(target).addScaledVector(dir, -dist);
    if (camera.position.y < 1) camera.position.y = 1;
    camera.lookAt(target);
  }

  // Look-only tick (no character movement): the same cursor-follow + drag +
  // wheel that drives the walking camera, so the caller can orbit any target
  // (e.g. the moving train). Returns the current view state. Pitch stays clamped
  // (no flip-over). Enable via setLookMode(true).
  function updateLook(dt) {
    if (!dragging && cursor.over3D) {
      state.yaw -= steer(cursor.x) * 1.9 * dt;
      state.pitch -= steer(cursor.y) * 1.2 * dt;
      state.pitch = Math.max(-0.9, Math.min(1.4, state.pitch));
    }
    return { yaw: state.yaw, pitch: state.pitch, dist };
  }
  function setLookMode(v) {
    lookMode = v;
    if (v) dom.style.cursor = 'grab';
  }

  function setEnabled(v) {
    enabled = v;
    dom.style.cursor = v ? 'grab' : 'default';
  }
  // Force the follow distance (used to zoom in inside small interior rooms).
  function setDist(d) {
    dist = d;
  }
  // Snap the character's facing (and the internal target) — used after a
  // teleport so it doesn't drift back to its previous heading. Teleports also
  // reset the jump state, so you never land mid-air inside a shop.
  function setFacing(yaw) {
    facing = yaw;
    character.group.rotation.y = yaw;
    vy = 0;
    grounded = true;
    jumpQueued = false;
  }

  /** Shove the character (a car impact). Units per second, decays over ~1s. */
  function applyKnockback(kx, kz) { knock.x = kx; knock.z = kz; }

  return {
    update, setEnabled, state, setDist, setFacing, updateLook, setLookMode, applyKnockback,
    get dist() { return dist; },
    get grounded() { return grounded; },
    get enabled() { return enabled; },
    get speed() { return lastSpeed; },
    tune: TUNE,
  };
}
