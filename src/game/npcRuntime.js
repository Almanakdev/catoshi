// Living cast.
//
// Spawns one procedural cat per entry in NPCS, walks each of them along their
// authored daily schedule, and hangs the whole social layer (name labels, quest
// markers, the "press E to talk" interaction and the dialogue flow) off that.
//
// Budget: seventeen cats at the player's 25-mesh rig would be ~425 draw calls,
// more than the entire city, so the cast is built at `lod: 'npc'` (7 meshes)
// and the catModel's own distance bands do the rest. This file feeds it a
// camera distance and a frustum test every frame; catModel decides whether to
// animate at full rate, at 10 Hz, or not at all. The bands come from
// QUALITY[].npcDistance so the graphics setting actually moves them.
//
// Nothing is created or destroyed while the game runs: the cats, the labels and
// the markers are all pooled from construction, and the label canvases are
// built lazily the first time a cat comes close enough to read.

import * as THREE from 'three';
import { createCat } from '../cat/catModel.js';
import { EV } from './bus.js';
import {
  NPCS, npc as npcById, npcsInDistrict,
  scheduledSpot, dialogueTier, lineFor,
} from '../data/npcs.js';
import { createDialogueUI } from '../ui/dialogueUI.js';
import { QUALITY } from '../config.js';

// QUALITY[].npcDistance is 45 / 70 / 95. `far` is where a cat stops being drawn
// and `near` where it drops to the 10 Hz update; at the default (medium) tier
// that lands on ~45 and ~20 units, and both scale with the graphics setting.
const LOD_FAR_OF_QUALITY = 0.64;
const LOD_NEAR_OF_FAR = 0.45;
// Padding on the frustum test. A cat just off the edge of the screen can still
// throw a shadow into it, so the sphere is generous — this is about skipping
// the pose solver, not about shaving the last few culls.
const FRUSTUM_R = 3.0;

const LABEL_DIST = 18;
const MARKER_DIST = 42;

const WALK_SPEED = 1.5;
const ARRIVE_R = 0.9;
const TURN_RATE = 6.0;

const MARKER_REFRESH = 0.5;   // seconds between quest-marker re-evaluations
const OCCLUSION_REFRESH = 0.2; // seconds between name-label line-of-sight tests

/** schedule `what` -> a catModel action for when the NPC has arrived. */
const IDLE_ACTION = {
  shop: 'idle',
  stall: 'idle',
  dock: 'fish',
  walk: 'idle',
  home: 'sleep',
  sleep: 'sleep',
  cook: 'cook',
};

const shortAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------------------------------------------------------------- textures
function labelTexture(T, text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);

  const pad = 8;
  const w = c.width - pad * 2, h = 40, x = pad, y = 12, r = 20;
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  g.fillStyle = 'rgba(251,243,226,.92)';
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(59,47,38,.28)';
  g.stroke();

  g.font = '700 24px "Hiragino Maru Gothic ProN", Quicksand, system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#3b2f26';
  g.fillText(String(text || ''), c.width / 2, y + h / 2 + 1, w - 16);

  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace || tex.colorSpace;
  tex.needsUpdate = true;
  return tex;
}

function markerTexture(T, glyph, fill) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2);
  g.fillStyle = 'rgba(251,243,226,.9)'; g.fill();
  g.lineWidth = 7; g.strokeStyle = fill; g.stroke();
  g.font = '900 76px "Hiragino Maru Gothic ProN", Quicksand, system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = fill;
  g.fillText(glyph, 64, 70);
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace || tex.colorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
export function createNpcs(game, { gradientMap = null } = {}) {
  const T = (game && game.THREE) || THREE;
  const bus = game && game.bus;
  const state = game && game.state;

  const group = new T.Group();
  group.name = 'npcs';
  if (game && game.scene) game.scene.add(group);

  const offs = [];
  const records = [];
  const byId = Object.create(null);
  let disposed = false;
  let markerClock = 0;
  let ownDialogue = null;
  // The guidance layer (src/ui/guideUI.js) draws a richer, capped marker set of
  // its own. When it is present it switches these off so no head wears two.
  let markersOn = true;

  const markerTex = {
    '!': markerTexture(T, '!', '#c8503f'),
    '?': markerTexture(T, '?', '#f0b93f'),
  };

  const camPos = new T.Vector3();
  const rngOf = (i) => ((Math.sin(i * 127.1 + 311.7) * 43758.5453) % 1 + 1) % 1;

  // ---- level of detail ----------------------------------------------------
  const _frustum = new T.Frustum();
  const _projView = new T.Matrix4();
  const _sphere = new T.Sphere(new T.Vector3(), FRUSTUM_R);
  let lodQuality = -1;   // last quality tier pushed into the cats

  /** Re-derive the distance bands from the graphics setting, when it changes. */
  function syncLod() {
    let q = 1;
    try { q = Number(state && state.settings && state.settings.quality); } catch { /* default */ }
    if (!Number.isFinite(q)) q = 1;
    q = Math.max(0, Math.min(QUALITY.length - 1, q | 0));
    if (q === lodQuality) return;
    lodQuality = q;
    const far = (QUALITY[q].npcDistance || 70) * LOD_FAR_OF_QUALITY;
    const near = far * LOD_NEAR_OF_FAR;
    for (const rec of records) {
      try { rec.cat.setLodDistance(near, far); } catch (err) { console.error('[npcs] setLodDistance', err); }
    }
  }

  // Line-of-sight scratch for the name labels.
  const _ray = new T.Ray();
  const _labelPt = new T.Vector3();
  const _hit = new T.Vector3();
  let occlusionClock = 0;

  /**
   * Is a wall between the camera and this cat's name label?
   *
   * A label is a sprite, so it depth-tests against the world and a building in
   * front of it slices the pill in half — which reads as a rendering fault
   * rather than as "they are behind that wall". Cheap enough to run on the
   * handful of cats close enough to be labelled, five times a second.
   */
  function labelOccluded(rec, headY) {
    const cols = game && game.world && game.world.colliders;
    if (!cols || !cols.length) return false;
    _labelPt.set(rec.pos.x, headY, rec.pos.z);
    _labelPt.sub(camPos);
    const len = _labelPt.length();
    if (len < 0.5) return false;
    _labelPt.multiplyScalar(1 / len);
    _ray.set(camPos, _labelPt);
    for (let i = 0; i < cols.length; i++) {
      const box = cols[i];
      if (!box || box.containsPoint(camPos)) continue;   // standing inside it: ignore
      if (!_ray.intersectBox(box, _hit)) continue;
      if (_hit.distanceTo(camPos) < len - 0.6) return true;
    }
    return false;
  }

  // --------------------------------------------------------------- helpers
  function hour() {
    try { if (game && game.clock && typeof game.clock.hour === 'number') return game.clock.hour; } catch { /* ignore */ }
    const c = state && state.data && state.data.clock;
    return c && typeof c.hour === 'number' ? c.hour : 8;
  }

  function day() {
    try { if (game && game.clock && typeof game.clock.day === 'number') return game.clock.day; } catch { /* ignore */ }
    const c = state && state.data && state.data.clock;
    return c && typeof c.day === 'number' ? c.day : 1;
  }

  function groundY(x, z) {
    try {
      if (game && game.world && typeof game.world.groundHeightAt === 'function') {
        const y = game.world.groundHeightAt(x, z);
        if (Number.isFinite(y)) return y;
      }
    } catch { /* ignore */ }
    return 0;
  }

  function quests() { return (game && game.quests) || null; }

  function dialogue() {
    if (game && game.dialogue && typeof game.dialogue.say === 'function') return game.dialogue;
    if (game && game.ui && game.ui.dialogue && typeof game.ui.dialogue.say === 'function') return game.ui.dialogue;
    if (!ownDialogue) {
      try {
        ownDialogue = createDialogueUI(game);
        if (game && !game.dialogue) game.dialogue = ownDialogue;
      } catch (err) {
        console.error('[npcs] could not build a dialogue UI', err);
        ownDialogue = null;
      }
    }
    return ownDialogue;
  }

  // ------------------------------------------------------------------ spawn
  for (let i = 0; i < NPCS.length; i++) {
    const def = NPCS[i];
    if (!def || !def.id) { console.warn('[npcs] skipping a nameless entry at', i); continue; }
    if (byId[def.id]) { console.warn(`[npcs] duplicate id "${def.id}" — keeping the first`); continue; }

    let cat = null;
    try {
      cat = createCat({
        fur: def.fur, accent: def.accent, hat: def.hat,
        scale: Number(def.size) || 1,
        gradientMap,
        lod: 'npc',
      });
    } catch (err) {
      console.error(`[npcs] createCat failed for "${def.id}"`, err);
      continue;
    }

    const slot = scheduledSpot(def, hour());
    const at = (slot && slot.at) || def.home || { x: 0, z: 0 };

    const rec = {
      id: def.id,
      def,
      cat,
      slot,
      pos: new T.Vector3(at.x, groundY(at.x, at.z), at.z),
      target: new T.Vector3(at.x, 0, at.z),
      yaw: rngOf(i) * Math.PI * 2,
      speed: 0,
      action: null,
      wanderT: 1 + rngOf(i + 7) * 4,
      lineIdx: Math.floor(rngOf(i + 21) * 4),
      band: 'full',
      label: null,          // { sprite, mat, tex }
      marker: null,         // { sprite, mat }
      markerKind: null,
      spotT: 0,
      talking: false,
      labelBlocked: false,   // wall between the camera and the name label
      bob: rngOf(i + 3) * Math.PI * 2,
    };

    cat.group.position.copy(rec.pos);
    cat.group.rotation.y = rec.yaw;
    group.add(cat.group);

    // Quest marker sprite: pooled per NPC (its own material so it can fade),
    // sharing the two canvas textures.
    const mMat = new T.SpriteMaterial({ map: markerTex['!'], transparent: true, opacity: 0, depthWrite: false });
    const mSpr = new T.Sprite(mMat);
    mSpr.scale.set(0.7, 0.7, 1);
    mSpr.visible = false;
    cat.group.add(mSpr);
    rec.marker = { sprite: mSpr, mat: mMat };

    records.push(rec);
    byId[rec.id] = rec;

    registerInteraction(rec);
  }

  // ----------------------------------------------------------- interactions
  function registerInteraction(rec) {
    if (!game || !game.interactions || typeof game.interactions.add !== 'function') return;
    game.interactions.add({
      id: `npc:${rec.id}`,
      x: rec.pos.x, z: rec.pos.z,
      r: 3,
      priority: 1,
      key: 'E',
      label: () => {
        const q = quests();
        if (q && typeof q.markerFor === 'function' && q.markerFor(rec.id)) return `${rec.def.name} — quest!`;
        return `Talk to ${rec.def.name}`;
      },
      data: { kind: 'npc', npcId: rec.id },
      onUse: () => { talk(rec.id); },
    });
  }

  // -------------------------------------------------------------- dialogue
  /** +1 relationship the first time you talk to someone on a given day. */
  function dailyBond(rec) {
    if (!state) return;
    const key = `talked.${rec.id}.${day()}`;
    try {
      if (state.flag(key)) return;
      state.setFlag(key, true);
      state.addRelationship(rec.id, 1);
    } catch (err) { console.error('[npcs] dailyBond', err); }
  }

  function chatLines(rec, count = 2) {
    const rel = state && typeof state.relationship === 'function' ? state.relationship(rec.id) : 0;
    const out = [];
    for (let i = 0; i < count; i++) {
      const l = lineFor(rec.def, rel, rec.lineIdx + i);
      if (l && !out.includes(l)) out.push(l);
    }
    rec.lineIdx += count;
    if (!out.length) out.push('…');
    return out;
  }

  async function talk(npcId) {
    const rec = byId[npcId];
    if (!rec || rec.talking) return null;
    const ui = dialogue();
    if (!ui) return null;

    rec.talking = true;
    try {
      const q = quests();
      const lines = chatLines(rec);
      dailyBond(rec);
      if (bus) bus.emit(EV.DIALOGUE, { npcId: rec.id, lines, tier: dialogueTier(state ? state.relationship(rec.id) : 0) });

      const ready = q && typeof q.readyFor === 'function' ? q.readyFor(rec.id) : [];
      const offers = q && typeof q.availableFrom === 'function' ? q.availableFrom(rec.id) : [];

      // ---- hand-in takes priority over a new offer
      if (ready && ready.length) {
        const quest = ready[0];
        const choice = await ui.say(rec.def, [...lines, `About “${quest.title}” — is it done?`], {
          choices: [
            { id: 'handin', label: 'Hand it in', tone: 'good', icon: '🏅' },
            { id: 'later', label: 'Not yet', tone: 'ghost' },
          ],
        });
        if (choice === 'handin') {
          let ok = false;
          try { ok = q.turnIn(quest.id); } catch (err) { console.error('[npcs] turnIn', err); }
          const closing = Array.isArray(quest.onCompleteLines) && quest.onCompleteLines.length
            ? quest.onCompleteLines
            : ['Good work.'];
          if (ok) await ui.say(rec.def, closing);
        }
        return choice;
      }

      // ---- a new quest on offer
      if (offers && offers.length) {
        const quest = offers[0];
        const choice = await ui.say(rec.def, [...lines, quest.desc || quest.title], {
          choices: [
            { id: 'accept', label: 'Accept', tone: 'good', icon: '📜' },
            { id: 'ask', label: 'Ask about…', tone: 'ghost' },
            { id: 'decline', label: 'Decline', tone: 'ghost' },
          ],
        });

        if (choice === 'ask') {
          const hints = (quest.objectives || [])
            .map((o) => o && o.hint)
            .filter(Boolean)
            .slice(0, 3);
          const again = await ui.say(rec.def, hints.length ? hints : ['There is not much more to tell.'], {
            choices: [
              { id: 'accept', label: 'Accept', tone: 'good', icon: '📜' },
              { id: 'decline', label: 'Maybe later', tone: 'ghost' },
            ],
          });
          if (again === 'accept') acceptQuest(quest, rec);
          return again;
        }
        if (choice === 'accept') acceptQuest(quest, rec);
        return choice;
      }

      // ---- ordinary chat
      return await ui.say(rec.def, lines);
    } catch (err) {
      console.error('[npcs] dialogue flow failed', err);
      return null;
    } finally {
      rec.talking = false;
    }
  }

  function acceptQuest(quest, rec) {
    const q = quests();
    if (!q || !quest) return false;
    try {
      const ok = q.start(quest.id);
      if (ok && typeof q.setTracked === 'function') q.setTracked(quest.id);
      return ok;
    } catch (err) {
      console.error(`[npcs] could not start "${quest && quest.id}" from ${rec && rec.id}`, err);
      return false;
    }
  }

  // ---------------------------------------------------------------- visuals
  function ensureLabel(rec) {
    if (rec.label) return rec.label;
    try {
      const tex = labelTexture(T, rec.def.name);
      const mat = new T.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
      const spr = new T.Sprite(mat);
      spr.scale.set(2.0, 0.5, 1);
      spr.position.y = 1.62 * (Number(rec.def.size) || 1) + 0.18;
      spr.visible = false;
      rec.cat.group.add(spr);
      rec.label = { sprite: spr, mat, tex };
    } catch (err) {
      console.error('[npcs] label failed for', rec.id, err);
      rec.label = { sprite: null, mat: null, tex: null };
    }
    return rec.label;
  }

  function refreshMarkers() {
    const q = quests();
    for (const rec of records) {
      let kind = null;
      if (markersOn && q && typeof q.markerFor === 'function') {
        try { kind = q.markerFor(rec.id); } catch { kind = null; }
      }
      if (kind !== rec.markerKind) {
        rec.markerKind = kind;
        const m = rec.marker;
        if (m && m.mat) {
          if (kind && markerTex[kind]) { m.mat.map = markerTex[kind]; m.mat.needsUpdate = true; }
          m.sprite.visible = !!kind;
          if (!kind) m.mat.opacity = 0;
        }
      }
    }
  }

  // ------------------------------------------------------------------ steer
  function pickTarget(rec, dt) {
    const h = hour();
    const slot = scheduledSpot(rec.def, h);
    if (slot !== rec.slot) {
      rec.slot = slot;
      rec.wanderT = 0;   // force a fresh destination for the new activity
    }
    const at = (slot && slot.at) || rec.def.home || { x: 0, z: 0 };
    const what = (slot && slot.what) || 'walk';

    if (what !== 'walk') {
      rec.target.set(at.x, 0, at.z);
      return what;
    }

    // 'walk' slots pace a small loop around the authored spot.
    rec.wanderT -= dt;
    const dx = rec.pos.x - rec.target.x, dz = rec.pos.z - rec.target.z;
    if (rec.wanderT <= 0 || dx * dx + dz * dz < ARRIVE_R * ARRIVE_R) {
      if (rec.wanderT <= 0) {
        const a = Math.random() * Math.PI * 2;
        const r = 1.5 + Math.random() * 3.0;
        rec.target.set(at.x + Math.cos(a) * r, 0, at.z + Math.sin(a) * r);
        rec.wanderT = 3 + Math.random() * 5;
      }
    }
    return what;
  }

  function step(rec, dt) {
    const what = pickTarget(rec, dt);

    const dx = rec.target.x - rec.pos.x;
    const dz = rec.target.z - rec.pos.z;
    const dist = Math.hypot(dx, dz);

    if (dist > ARRIVE_R) {
      // ease off over the last couple of metres so nobody skids to a stop
      const v = WALK_SPEED * Math.min(1, dist / 2.5);
      const nx = dx / dist, nz = dz / dist;
      rec.pos.x += nx * v * dt;
      rec.pos.z += nz * v * dt;
      rec.speed = v;
      const want = Math.atan2(nx, nz);
      rec.yaw += shortAngle(want - rec.yaw) * Math.min(1, TURN_RATE * dt);
    } else {
      rec.speed += (0 - rec.speed) * Math.min(1, 8 * dt);
      if (rec.speed < 0.02) rec.speed = 0;
    }

    rec.pos.y = groundY(rec.pos.x, rec.pos.z);

    // Action: travelling overrides the schedule pose (setAction clears holds).
    const want = rec.speed > 0.15 ? 'walk' : (IDLE_ACTION[what] || 'idle');
    if (want !== rec.action) {
      rec.action = want;
      try { rec.cat.setAction(want); } catch (err) { console.error('[npcs] setAction', err); }
    }

    if (game && game.interactions && typeof game.interactions.move === 'function') {
      game.interactions.move(`npc:${rec.id}`, rec.pos.x, rec.pos.z);
    }
  }

  // ------------------------------------------------------------------ frame
  function update(dt) {
    if (disposed) return;
    const d = Math.max(0, Math.min(0.1, Number(dt) || 0));

    markerClock -= d;
    if (markerClock <= 0) { markerClock = MARKER_REFRESH; refreshMarkers(); }

    occlusionClock -= d;
    const occlusionDue = occlusionClock <= 0;
    if (occlusionDue) occlusionClock = OCCLUSION_REFRESH;

    syncLod();

    const cam = game && game.camera;
    if (cam) {
      cam.getWorldPosition(camPos);
      cam.updateMatrixWorld();
      _projView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_projView);
    }

    for (const rec of records) {
      try {
        // Everyone keeps walking their schedule regardless of the LOD band —
        // only the drawing and the pose solver are throttled, so nobody is
        // standing in the wrong place when you turn around.
        step(rec, d);

        const dx = rec.pos.x - camPos.x, dz = rec.pos.z - camPos.z;
        const dist = Math.hypot(dx, dz);

        rec.cat.group.position.copy(rec.pos);
        rec.cat.group.rotation.y = rec.yaw;

        // catModel owns the bands: it hides itself past `far` or off-screen,
        // runs at 10 Hz in the middle, and animates normally up close.
        _sphere.center.set(rec.pos.x, rec.pos.y + 1.0, rec.pos.z);
        const inFrustum = cam ? _frustum.intersectsSphere(_sphere) : true;
        rec.cat.update(d, rec.speed, { distance: dist, inFrustum });

        if (!rec.cat.group.visible) {
          if (rec.label && rec.label.sprite) rec.label.sprite.visible = false;
          if (rec.marker && rec.marker.sprite) rec.marker.sprite.visible = false;
          if (rec.spotT > 0) rec.spotT = Math.max(0, rec.spotT - d);
          continue;
        }

        // ---- name label: fades in over the last few metres, shrinks with
        //      distance, and disappears completely behind a wall rather than
        //      being sliced in half by one.
        if (dist < LABEL_DIST) {
          const lab = ensureLabel(rec);
          if (lab.sprite) {
            const scl = Number(rec.def.size) || 1;
            const headY = rec.pos.y + 1.62 * scl + 0.18;
            if (occlusionDue) rec.labelBlocked = labelOccluded(rec, headY);
            const t = Math.max(0, Math.min(1, (LABEL_DIST - dist) / 6));
            lab.mat.opacity = rec.labelBlocked ? 0 : t * (rec.spotT > 0 ? 1 : 0.92);
            // Far labels read as small ambience, near ones as a real name tag.
            const s = 0.74 + t * 0.26;
            lab.sprite.scale.set(2.0 * s, 0.5 * s, 1);
            lab.sprite.visible = lab.mat.opacity > 0.02;
          }
        } else if (rec.label && rec.label.sprite) {
          rec.label.sprite.visible = false;
        }

        // ---- quest marker
        const m = rec.marker;
        if (m && m.sprite) {
          if (markersOn && rec.markerKind && dist < MARKER_DIST) {
            rec.bob += d * 2.4;
            const scl = (Number(rec.def.size) || 1);
            const pulse = rec.spotT > 0 ? 1.35 + Math.sin(rec.bob * 3) * 0.15 : 1;
            m.sprite.visible = true;
            m.sprite.position.y = 1.62 * scl + 0.62 + Math.sin(rec.bob) * 0.08;
            m.sprite.scale.set(0.7 * pulse, 0.7 * pulse, 1);
            m.mat.opacity = Math.max(0, Math.min(1, (MARKER_DIST - dist) / 8));
          } else {
            m.sprite.visible = false;
          }
        }

        if (rec.spotT > 0) rec.spotT = Math.max(0, rec.spotT - d);
      } catch (err) {
        console.error(`[npcs] update failed for "${rec.id}"`, err);
      }
    }
  }

  // ------------------------------------------------------------------- bus
  if (bus) {
    // A load moves the clock — snap everyone to their new schedule spot rather
    // than have the whole cast stroll across town.
    offs.push(bus.on(EV.LOAD, () => {
      const h = hour();
      for (const rec of records) {
        try {
          const slot = scheduledSpot(rec.def, h);
          const at = (slot && slot.at) || rec.def.home || { x: 0, z: 0 };
          rec.slot = slot;
          rec.pos.set(at.x, groundY(at.x, at.z), at.z);
          rec.target.set(at.x, 0, at.z);
          rec.speed = 0;
          rec.action = null;
          rec.cat.group.position.copy(rec.pos);
          if (game && game.interactions && typeof game.interactions.move === 'function') {
            game.interactions.move(`npc:${rec.id}`, rec.pos.x, rec.pos.z);
          }
        } catch (err) { console.error('[npcs] LOAD resync', err); }
      }
      markerClock = 0;
    }));
    const bump = () => { markerClock = 0; };
    offs.push(bus.on(EV.QUEST_DONE, bump));
    offs.push(bus.on(EV.QUEST_STARTED, bump));
    offs.push(bus.on(EV.QUEST_OFFERED, bump));
    offs.push(bus.on(EV.QUEST_PROGRESS, bump));
  }

  // ------------------------------------------------------------------- api
  function find(id) { return byId[id] || null; }

  function positionOf(id) {
    const rec = byId[id];
    return rec ? rec.pos.clone() : null;
  }

  /** Point the compass at someone and make their marker shout for a moment. */
  function spotlight(id) {
    const rec = byId[id];
    if (!rec) return null;
    rec.spotT = 6;
    try {
      if (game && game.world && typeof game.world.setWaypoint === 'function') {
        game.world.setWaypoint({ x: rec.pos.x, z: rec.pos.z, label: rec.def.name });
      }
    } catch (err) { console.error('[npcs] spotlight waypoint', err); }
    return rec.pos.clone();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    while (offs.length) { const off = offs.pop(); try { off(); } catch { /* ignore */ } }
    for (const rec of records) {
      try {
        if (game && game.interactions && typeof game.interactions.remove === 'function') {
          game.interactions.remove(`npc:${rec.id}`);
        }
        if (rec.label) {
          if (rec.label.tex) rec.label.tex.dispose();
          if (rec.label.mat) rec.label.mat.dispose();
          if (rec.label.sprite) rec.label.sprite.removeFromParent();
        }
        if (rec.marker) {
          if (rec.marker.mat) rec.marker.mat.dispose();
          if (rec.marker.sprite) rec.marker.sprite.removeFromParent();
        }
        rec.cat.dispose();
      } catch (err) { console.error('[npcs] dispose', err); }
    }
    for (const k in markerTex) { try { markerTex[k].dispose(); } catch { /* ignore */ } }
    records.length = 0;
    for (const k in byId) delete byId[k];
    if (group.parent) group.parent.remove(group);
    if (ownDialogue && typeof ownDialogue.destroy === 'function') {
      try { ownDialogue.destroy(); } catch { /* ignore */ }
      if (game && game.dialogue === ownDialogue) game.dialogue = null;
      ownDialogue = null;
    }
  }

  return {
    group,
    update, dispose,
    talk,
    get npcs() { return records.slice(); },
    find, positionOf, spotlight,
    /** Turn the built-in ! / ? head sprites on or off. */
    setMarkersEnabled(v) {
      markersOn = !!v;
      markerClock = 0;
      refreshMarkers();
      return markersOn;
    },
    get markersEnabled() { return markersOn; },
    inDistrict: (districtId) => npcsInDistrict(districtId)
      .map((n) => byId[n.id])
      .filter(Boolean),
    def: (id) => npcById(id),
  };
}

export default createNpcs;
