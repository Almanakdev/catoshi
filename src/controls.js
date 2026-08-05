import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

/**
 * First-person walk/fly controller.
 * - WASD moves relative to where you look.
 * - Shift sprints.
 * - Space / C move up / down (fly).
 * - Building colliders push the player out so you can't walk through walls.
 */
export function createPlayerControls(camera, domElement, colliders, bounds) {
  const controls = new PointerLockControls(camera, domElement);

  const keys = Object.create(null);
  const onKey = (e, down) => {
    keys[e.code] = down;
  };
  document.addEventListener('keydown', (e) => onKey(e, true));
  document.addEventListener('keyup', (e) => onKey(e, false));

  const velocity = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const PLAYER_RADIUS = 1.2;
  const EYE_HEIGHT = 4.5;

  // Start the player at eye height.
  camera.position.set(0, EYE_HEIGHT, 0);

  function resolveCollisions() {
    const p = camera.position;
    for (let i = 0; i < colliders.length; i++) {
      const box = colliders[i];
      // Only care about boxes near current XZ.
      const closestX = Math.max(box.min.x, Math.min(p.x, box.max.x));
      const closestZ = Math.max(box.min.z, Math.min(p.z, box.max.z));
      const dx = p.x - closestX;
      const dz = p.z - closestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq < PLAYER_RADIUS * PLAYER_RADIUS) {
        const dist = Math.sqrt(distSq) || 0.0001;
        const push = (PLAYER_RADIUS - dist) / dist;
        p.x += dx * push;
        p.z += dz * push;
      }
    }
    // Keep inside the world bounds.
    const limit = bounds + 40;
    p.x = Math.max(-limit, Math.min(limit, p.x));
    p.z = Math.max(-limit, Math.min(limit, p.z));
    // Don't drop below the street or fly absurdly high.
    p.y = Math.max(1.5, Math.min(160, p.y));
  }

  function update(dt) {
    if (!controls.isLocked) return;

    const speed = (keys['ShiftLeft'] || keys['ShiftRight'] ? 90 : 34);

    // Damping
    velocity.x -= velocity.x * 10 * dt;
    velocity.z -= velocity.z * 10 * dt;
    velocity.y -= velocity.y * 10 * dt;

    direction.z = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
    direction.x = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
    direction.normalize();

    if (keys['KeyW'] || keys['KeyS']) velocity.z -= direction.z * speed * dt;
    if (keys['KeyA'] || keys['KeyD']) velocity.x -= direction.x * speed * dt;

    // Vertical fly
    const up = (keys['Space'] ? 1 : 0) - (keys['KeyC'] ? 1 : 0);
    velocity.y += up * speed * dt;

    controls.moveRight(-velocity.x * dt);
    controls.moveForward(-velocity.z * dt);
    camera.position.y += velocity.y * dt;

    resolveCollisions();
  }

  return { controls, update };
}
