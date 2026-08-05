import * as THREE from 'three';
import { isTypingInUI } from './inputGuard.js';
import { doorPose, exitPose } from './traffic.js';

// Arcade driving for a hijacked car, plus its chase camera.
//
// Deliberately not a physics sim: throttle and brake move a scalar speed,
// steering is proportional to how fast you're going (so you can't spin on the
// spot), and the body slides along walls instead of stopping dead on them. That
// reads well at this scale and costs almost nothing.
//
// The car handle comes from traffic.js — while the player holds it the car is
// out of the AI entirely, so there are no lanes, lights or followers to fight.

export const DRIVE = {
  accel: 26,           // units/s² on the throttle
  brake: 42,           // …on the brake / reverse
  drag: 5.5,           // coasting deceleration
  maxSpeed: 46,        // forward top speed (the fleet cruises at ~11)
  maxReverse: 14,
  steer: 1.9,          // radians/s at full effect
  steerAtSpeed: 12,    // speed at which steering reaches full effect
  gripLoss: 0.12,      // how much speed a hard turn scrubs off

  camBack: 17,         // chase camera distance behind
  camHeight: 7.2,
  camLag: 3.4,         // how quickly the camera catches up
  camLookAhead: 9,

  wallBounce: 0.35,    // speed kept after clipping a building
  bodyRadius: 2.4,     // collision radius used against the city's boxes
};

export function createDriving(camera, opts = {}) {
  const { colliders = [], groundY = 0.12 } = opts;

  const keys = Object.create(null);
  window.addEventListener('keydown', (e) => { if (!isTypingInUI()) keys[e.code] = true; });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  let car = null;              // the handle from traffic.hijack()
  let speed = 0;
  const camPos = new THREE.Vector3();
  const camAim = new THREE.Vector3();
  let camInit = false;

  function enter(handle) {
    car = handle;
    speed = handle.speed || 0;
    camInit = false;
  }

  function exit() {
    const h = car;
    car = null;
    speed = 0;
    return h;
  }

  /** Frozen copy of the car's pose — usable after exit() has cleared the handle. */
  function carSnapshot() {
    if (!car) return null;
    return { x: car.x, z: car.z, yaw: car.yaw, length: car.length, width: car.width };
  }

  /** Where the character should stand after getting out: beside the door, facing
   *  away from the car, nudged clear of any wall it would otherwise land in. */
  function exitSpot() {
    if (!car) return null;
    const e = exitPose(car);
    const r = resolveWalls(e.x, e.z);
    return { x: r.x, z: r.z, yaw: e.yaw };
  }

  // Push the car out of anything solid, and scrub speed for the impact. Walls
  // are treated as slides rather than stops so you can't get wedged.
  function resolveWalls(x, z) {
    let px = x, pz = z, hit = false;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (let i = 0; i < colliders.length; i++) {
        const b = colliders[i];
        if (b.max.y <= 0.3 || b.min.y >= 2.4) continue;   // not at bumper height
        const cx = Math.max(b.min.x, Math.min(px, b.max.x));
        const cz = Math.max(b.min.z, Math.min(pz, b.max.z));
        const dx = px - cx, dz = pz - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < DRIVE.bodyRadius * DRIVE.bodyRadius) {
          const d = Math.sqrt(d2) || 1e-4;
          const push = (DRIVE.bodyRadius - d) / d;
          px += dx * push; pz += dz * push;
          moved = true; hit = true;
        }
      }
      if (!moved) break;
    }
    return { x: px, z: pz, hit };
  }

  function update(dt) {
    if (!car) return;

    const throttle = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
    const steerIn = (keys['KeyA'] ? 1 : 0) - (keys['KeyD'] ? 1 : 0);
    const handbrake = !!keys['Space'];

    // --- longitudinal ---------------------------------------------------
    if (handbrake) {
      speed -= Math.sign(speed) * Math.min(Math.abs(speed), DRIVE.brake * 1.5 * dt);
    } else if (throttle > 0) {
      speed += DRIVE.accel * dt;
    } else if (throttle < 0) {
      speed -= (speed > 0 ? DRIVE.brake : DRIVE.accel) * dt;
    } else {
      speed -= Math.sign(speed) * Math.min(Math.abs(speed), DRIVE.drag * dt);
    }
    speed = Math.max(-DRIVE.maxReverse, Math.min(DRIVE.maxSpeed, speed));

    // --- steering -------------------------------------------------------
    // Effect ramps in with speed, so the car turns like a car rather than a
    // turret, and reverses its sense when reversing.
    const grip = Math.min(1, Math.abs(speed) / DRIVE.steerAtSpeed);
    let yaw = car.yaw + steerIn * DRIVE.steer * grip * Math.sign(speed || 1) * dt;
    if (steerIn && Math.abs(speed) > 6) {
      speed -= Math.abs(speed) * DRIVE.gripLoss * dt * Math.abs(steerIn);
    }

    // --- move + walls ---------------------------------------------------
    const nx = car.x + Math.sin(yaw) * speed * dt;
    const nz = car.z + Math.cos(yaw) * speed * dt;
    const r = resolveWalls(nx, nz);
    if (r.hit) speed *= DRIVE.wallBounce;
    car.set(r.x, r.z, yaw, speed);

    // --- chase camera ---------------------------------------------------
    // Aims ahead of the car so you see where you're going, and lags behind so
    // corners feel like corners.
    const back = DRIVE.camBack + Math.abs(speed) * 0.16;
    const wantX = car.x - Math.sin(yaw) * back;
    const wantZ = car.z - Math.cos(yaw) * back;
    const wantY = groundY + DRIVE.camHeight;
    if (!camInit) { camPos.set(wantX, wantY, wantZ); camInit = true; }
    const k = Math.min(1, dt * DRIVE.camLag);
    camPos.x += (wantX - camPos.x) * k;
    camPos.y += (wantY - camPos.y) * k;
    camPos.z += (wantZ - camPos.z) * k;
    camAim.set(
      car.x + Math.sin(yaw) * DRIVE.camLookAhead,
      groundY + 2.2,
      car.z + Math.cos(yaw) * DRIVE.camLookAhead
    );
    camera.position.copy(camPos);
    camera.lookAt(camAim);
  }

  // Where to put the character when they get out: the SAME driver-door spot
  // that entering used, pushed clear of anything solid so they can't be left
  // inside a wall.
  function dropOffPoint() {
    if (!car) return null;
    const d = doorPose(car);
    const r = resolveWalls(d.x, d.z);
    return { x: r.x, z: r.z, yaw: d.yaw };
  }

  return {
    enter, exit, update, dropOffPoint, exitSpot, carSnapshot,
    /** Where the car is — the hidden character is parked here so the shadow
     *  frustum, minimap arrow and crowd LOD all keep tracking the player. */
    get pos() { return car ? { x: car.x, z: car.z, yaw: car.yaw } : null; },
    get active() { return !!car; },
    get speed() { return speed; },
  };
}
