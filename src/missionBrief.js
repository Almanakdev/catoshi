import * as THREE from 'three';
import { createCutscene } from './cinematic.js';

// The short cinematic that plays when you take a job.
//
// Same presentation as the hospital intro — it's the same player from
// cinematic.js — but the shot list is generated at runtime from where the
// player is standing and where the work is, so every briefing frames its own
// objective.
//
// Three beats:
//   1. the dispatcher — a slow arc around the player at the job board
//   2. the objective  — a hard CUT to an aerial three-quarter over the target,
//                       drifting in. This is why cinematic.js supports cuts:
//                       interpolating 200 units across the city would be a
//                       nauseating whip pan rather than an edit.
//   3. back to you    — cut back and settle into the normal gameplay framing,
//                       so the hand-off to the follow camera doesn't jump.
//
// If the objective is very close the aerial would just be the same street from
// above, so beat 2 tightens in instead of pulling way out.

// ---------------------------------------------------------------------------
// DIALOGUE — edit me. `{target}` is replaced with the objective's name and
// `{pay}` with the reward. One entry per mission kind; a line is picked at
// random so repeat jobs don't read identically.
// ---------------------------------------------------------------------------
export const BRIEFS = {
  deliver: [
    [
      { who: 'Dispatch', text: 'Parcel’s waiting at {target}. Don’t open it.' },
      { who: 'Dispatch', text: 'Get it across town in one piece and it’s ${pay}.' },
    ],
    [
      { who: 'Dispatch', text: 'Courier run. Pick up at {target}, then straight on.' },
      { who: 'Dispatch', text: '${pay} on delivery. The client is not a patient man.' },
    ],
  ],
  express: [
    [
      { who: 'Dispatch', text: 'This one’s time-critical. {target}, and the clock’s already running.' },
      { who: 'Dispatch', text: 'Beat it and there’s a bonus on top of the ${pay}.' },
    ],
    [
      { who: 'Dispatch', text: 'Urgent callout at {target}. Move now.' },
      { who: 'Dispatch', text: '${pay}, more if you’re quick about it.' },
    ],
  ],
  collect: [
    [
      { who: 'Dispatch', text: 'A load came off the back of a van near {target}.' },
      { who: 'Dispatch', text: 'Bring every piece back and it’s ${pay}. Nothing left behind.' },
    ],
    [
      { who: 'Dispatch', text: 'Scattered cargo all over {target}. Sweep it up.' },
      { who: 'Dispatch', text: '${pay} for the full set.' },
    ],
  ],
};

export const BRIEF_TUNING = {
  length: 11.5,       // seconds — short enough not to wear out its welcome
  fadeOut: 0.5,
  cueStart: 0.7,      // when the first line appears
  cueGap: 4.6,        // seconds per line
  nearTarget: 70,     // closer than this and beat 2 stays low instead of aerial
  aerialHeight: 26,
  aerialBack: 30,
};

const V = (x, y, z) => [x, y, z];

/**
 * Build the shot list + cues for one mission.
 * @param player  THREE.Vector3 where the player is standing (the job board)
 * @param target  { x, z, label } the first objective
 * @param mission { kind, pay }
 */
export function buildBrief(player, target, mission, rand = Math.random) {
  const T = BRIEF_TUNING;
  const px = player.x, pz = player.z;
  const tx = target ? target.x : px;
  const tz = target ? target.z : pz;

  // Bearing from the player to the work.
  let bx = tx - px, bz = tz - pz;
  const dist = Math.hypot(bx, bz) || 1;
  bx /= dist; bz /= dist;
  // Perpendicular, for arcing around things.
  const sx = -bz, sz = bx;

  const near = dist < T.nearTarget;
  const h = near ? 11 : T.aerialHeight;
  const back = near ? 15 : T.aerialBack;

  const shots = [
    // --- beat 1: around the player at the board ----------------------------
    { t: 0.0, p: V(px - bx * 5.5 + sx * 4.5, 3.4, pz - bz * 5.5 + sz * 4.5), a: V(px, 2.2, pz) },
    { t: 3.4, p: V(px - bx * 4.0 - sx * 5.0, 2.6, pz - bz * 4.0 - sz * 5.0), a: V(px, 2.4, pz) },

    // --- beat 2: cut to the objective, drifting in -------------------------
    { t: 3.4, cut: true,
      p: V(tx - bx * back + sx * 8, h, tz - bz * back + sz * 8), a: V(tx, 1.6, tz) },
    { t: 8.0, p: V(tx - bx * (back * 0.62) - sx * 3, h * 0.72, tz - bz * (back * 0.62) - sz * 3), a: V(tx, 1.4, tz) },

    // --- beat 3: cut back, settle into the gameplay framing ----------------
    { t: 8.0, cut: true, p: V(px - bx * 13 + sx * 2, 5.0, pz - bz * 13 + sz * 2), a: V(px, 2.4, pz) },
    { t: 11.5, p: V(px - bx * 11.5, 3.9, pz - bz * 11.5), a: V(px, 2.2, pz) },
  ];

  // Cues from the template for this mission kind.
  const bank = BRIEFS[mission.kind] || BRIEFS.deliver;
  const lines = bank[Math.floor(rand() * bank.length)] || bank[0];
  const label = (target && target.label) || 'the site';
  const cues = lines.map((l, i) => ({
    t: T.cueStart + i * T.cueGap,
    hold: T.cueGap - 0.25,
    who: l.who,
    text: l.text.replace('{target}', label).replace('{pay}', String(mission.pay)),
  }));

  return { shots, cues, length: T.length };
}

/**
 * Play a briefing. `onFinish` runs exactly once — restore control there.
 */
export function playBrief(opts) {
  const { camera, player, target, mission, onFinish = () => {}, rand } = opts;
  const { shots, cues, length } = buildBrief(player, target, mission, rand);
  const cut = createCutscene({
    camera, shots, cues, length,
    fadeIn: 0,                       // no fade in — we cut straight from gameplay
    fadeOut: BRIEF_TUNING.fadeOut,   // brief dip to black on the way back
    onFinish,
  });
  cut.play();
  return cut;
}
