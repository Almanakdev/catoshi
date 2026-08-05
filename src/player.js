// The playable cat: model + follow controller + the small behaviours that make
// it feel alive (footstep audio, stamina drain, tired posture, carrying).
//
// Satisfies the `game.player` contract in src/game/CONTRACT.md.

import * as THREE from 'three';
import { createThirdPerson } from './engine/thirdPersonControls.js';
import { isTypingInUI } from './engine/inputGuard.js';
import { CAT_CONTROLS, PLAYER_CAT } from './config.js';
import { PROGRESSION } from './data/progression.js';
import { EV } from './game/bus.js';

export function createPlayer(game, cat, { spawn }) {
  const { scene, camera, renderer, state, bus, world } = game;

  scene.add(cat.group);
  cat.group.position.set(spawn.x, 0, spawn.z);
  cat.group.rotation.y = spawn.yaw || 0;

  const controls = createThirdPerson(
    camera,
    renderer.domElement,
    cat,
    world.colliders,
    175,
    world.groundHeightAt,
    [],
    CAT_CONTROLS
  );
  controls.setFacing(spawn.yaw || 0);
  // Camera dir uses the same yaw as the character, which puts it BEHIND them.
  controls.state.yaw = spawn.yaw || 0;
  controls.state.pitch = 0.45;

  let locked = 0;              // reference-counted so two systems can't unlock each other
  let carried = null;
  let stepTimer = 0;
  let idleTimer = 0;
  let lastDistrict = null;
  let staminaAcc = 0;

  // ------------------------------------------------------------- one-shots
  // Playful verbs the player can trigger while exploring.
  window.addEventListener('keydown', onKey);
  function onKey(e) {
    if (isTypingInUI() || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (locked > 0 || game.mode !== 'explore') return;
    if (e.code === 'KeyF') { cat.setAction('meow'); game.audio.play('meow'); }
    else if (e.code === 'KeyG') { cat.setAction(cat.action === 'sit' ? 'idle' : 'sit'); }
    else if (e.code === 'KeyH') { cat.setAction('stretch'); }
  }

  function lock(v) {
    locked = v ? locked + 1 : Math.max(0, locked - 1);
    controls.setEnabled(locked === 0);
  }
  /** Hard reset — used when a system dies mid-lock so the cat can never freeze. */
  function forceUnlock() { locked = 0; controls.setEnabled(true); }

  function teleport(x, z, yaw = cat.group.rotation.y) {
    cat.group.position.set(x, world.groundHeightAt(x, z) || 0, z);
    controls.setFacing(yaw);
    controls.state.yaw = yaw;
  }

  function carry(obj) {
    if (carried && carried.parent) carried.parent.remove(carried);
    carried = obj || null;
    if (carried && cat.carryAnchor) {
      cat.carryAnchor.add(carried);
      cat.setAction('carry');
    } else if (!carried && cat.action === 'carry') {
      cat.setAction('idle');
    }
  }

  function update(dt) {
    controls.update(dt);

    const pos = cat.group.position;
    const speed = controls.speed || 0;

    // --- stamina ------------------------------------------------------------
    const rate = speed > CAT_CONTROLS.walk + 0.5
      ? PROGRESSION.staminaRunPerSec
      : speed > 0.2 ? PROGRESSION.staminaWalkPerSec : -PROGRESSION.staminaRestPerSec * 0.25;
    staminaAcc += rate * dt;
    if (Math.abs(staminaAcc) > 0.5) { state.addStamina(-staminaAcc); staminaAcc = 0; }
    const tired = state.stamina < PROGRESSION.staminaLowThreshold
      ? 1 - state.stamina / PROGRESSION.staminaLowThreshold
      : 0;
    cat.setTired(tired);
    cat.setMood(tired > 0.5 ? 'tired' : 'neutral');

    // --- footsteps ----------------------------------------------------------
    if (speed > 0.4 && controls.grounded) {
      stepTimer -= dt * (0.6 + speed * 0.22);
      if (stepTimer <= 0) { stepTimer = 1; game.audio.play('step'); }
    } else {
      stepTimer = 0;
    }

    // --- idle personality ---------------------------------------------------
    if (speed < 0.1 && locked === 0 && game.mode === 'explore') {
      idleTimer += dt;
      if (idleTimer > 14) {
        idleTimer = 0;
        cat.setAction(Math.random() < 0.5 ? 'lick' : 'stretch');
      }
    } else {
      idleTimer = 0;
    }

    // --- district transitions ----------------------------------------------
    const d = world.districtAt(pos.x, pos.z);
    const id = d ? d.id : null;
    if (id !== lastDistrict) {
      lastDistrict = id;
      if (d) {
        bus.emit(EV.DISTRICT_ENTER, { id: d.id, name: d.name });
        game.audio.setAmbience(d.ambience);
        game.audio.setMusicTrack(d.music);
      }
    }
  }

  function dispose() {
    window.removeEventListener('keydown', onKey);
    controls.setEnabled(false);
    if (cat.dispose) cat.dispose();
    scene.remove(cat.group);
  }

  return {
    cat, controls,
    get position() { return cat.group.position; },
    get yaw() { return cat.group.rotation.y; },
    get speed() { return controls.speed || 0; },
    get district() { return lastDistrict; },
    teleport, lock, forceUnlock,
    setAction: (n, o) => cat.setAction(n, o),
    setMood: (m) => cat.setMood(m),
    setTired: (v) => cat.setTired(v),
    carry,
    get carrying() { return carried; },
    get locked() { return locked > 0; },
    update, dispose,
  };
}
