# Development log

## 2026-08-05 — Milestone 2: Catushi

Four changes requested after playing milestone 1: rename, shrink the town, make
the cat a "human cat" that can cook, and make the gameplay clearer.

### 1. Renamed to Catushi
Display name lives in `src/config.js` → `GAME.title`; nothing hardcodes it. Save
keys moved `sushipaws.*` → `catushi.*`, and `save.js` adopts pre-rename saves
once on first run (copy, never delete), so nobody loses a shop to a rename.

### 2. The town is one third the size
Not scaled down — **re-laid out**. Building sizes are untouched (a storey is
still 3.6 units); the town got smaller by dropping buildings and packing the
survivors shoulder to shoulder, which is what makes it read as a real town
rather than a diorama.

| | before | after |
| --- | --- | --- |
| bounds | ±175 | ±96 |
| buildings | 116 | 60 |
| props | 696 | 323 |
| colliders | 714 | 334 |
| triangles | 355k | 175k |
| city draw calls | 153 | 146 |

Every district is now 4–7 seconds' run from the shop. All 115 NPC schedule
points, 6 supplier stalls, 5 fishing spots and 11 forage nodes were remapped
into the new district boxes by a per-district affine transform, then validated:
none outside its district, none inside a collider.

### 3. The cat is a bipedal chef
`src/cat/catModel.js` rewritten as an anthropomorphic biped: 1.91 units tall,
2.9 heads, chef coat, hachimaki, and **mitten hands with thumbs** so it visibly
holds a knife and presses nigiri. Same public API, so `main.js`, `player.js` and
the controller were unchanged. Poses are authored freely and an auto-plant step
drops the pelvis so the lowest contact rests on y=0; the hands use a 2-link IK
solver so `cook`/`carry`/`fish` specify a target position rather than eyeballed
angles.

The default hat is a **headband, not a toque** — the toque hid the ear
silhouette and from behind the cat stopped reading as a cat.

### 4. Guidance layer — "I never know what to do next"
- `src/game/guide.js` — six priority levels resolving to one objective with a
  world position. It owns the waypoint, so the banner, the compass, the map and
  the ground arrows can never disagree. It never throws: an unresolvable
  objective falls through to the next level.
- `src/ui/guideUI.js` — a NEXT banner under the clock, a trail of ground
  chevrons pointing at the target, `!`/`?` markers over NPCs, and a destination
  pin.
- `src/game/tutorial.js` — a skippable 9-step day-one tutorial, data-driven,
  persisted in `state.data.flags` so a reload resumes on the right step.

### 5. Economy legibility — "I don't understand the money and the shop"
New `src/data/economy.js` computes the money maths once and three panels read
it: every recipe shows "Costs 22¢ to make, sells for 42¢ — profit +20¢" against
live supplier prices at the player's relationship tier; the supplier panel says
what each ingredient is for and what a basket is worth; the daily summary is now
a receipt with profit as the hero number and one plain-language line of advice;
and the HUD carries a quiet "Today: +180¢" line plus a pulsing badge when an
upgrade first becomes affordable.

### Bugs found and fixed this pass
- **The follow camera had no collision.** Standing at your own counter put the
  camera inside the shop cart. `thirdPersonControls` now marches a ray back from
  the head and stops at the first collider, easing out so leaving a tight spot
  doesn't snap.
- **The opening shot was blocked.** A building row sat 0.5 units behind where
  the chase camera hangs on a new game. The row is gone and `world.js` now has a
  `CAM_KEEP` guard that fails the build if a future edit puts anything tall back
  in the spawn camera disc.
- **17 NPC cats cost ~425 draw calls** — more than the entire city. Added an
  `npc` LOD (7 meshes instead of 26) plus distance/frustum culling with bands
  driven by the existing quality setting. Boot went 340 → **157** draw calls,
  and the soak-end figure 542 → 255.
- **`EV.TOAST` was subscribed twice**, so every toast in the game rendered
  twice.
- **The guide told the player to go to bed at 07:00** — "past closing" naively
  read as `h >= 21 || h < 9`.
- **The banner's centring transform was being wiped** by a shared keyframe
  ending on `transform: none` with `fill-mode: both`, sliding it under the
  compass. Centring is now layout, not transform, verified at 5 widths × 3 UI
  scales.
- **Supplier stalls had no world interaction at all** — the panel existed but
  nothing in the city opened it, which would have trapped tutorial step 3.
- **My own coordinate remap double-substituted** every braced `{x, z}` pair,
  moving points twice. Caught by a bounds assertion, not by eye.

### Verified
`node tools/smoke.mjs` → **ALL CHECKS PASSED**, including two new guidance
assertions. 157 draw calls at boot, 165k triangles, zero console errors.

### Still unmeasured
Real frame rate. The container has no GPU, so the ~1 fps in the log is
swiftshader, not the game.

## 2026-08-05 — Milestone 1: Phases 1–5

### What was done

**Phase 1.** Audited `ENGINE CITY` in place without modifying it. Confirmed the
stack by reading `package.json`, `vite.config.js` and the source rather than
assuming: Three.js r0.169 + Vite 5, npm, no engine, no scene files, procedural
textures. Ran `npm run build` on the original — clean, 93 modules, 5.3 s. Full
findings in `docs/AUDIT.md`.

**Backup.** Cloned to `CATUSHI` (source + config only; `dist/`, `.git` and the
130 MB `public/` were left behind). Re-initialised as its own git repo, committed
the untouched engine source as the first commit, tagged it `engine-baseline`.
`git diff engine-baseline` is the complete change set.

**Phases 2–5** built in one pass, integrated and verified after each system.

### Verified, not assumed

`tools/smoke.mjs` boots the production build in Chromium (software rasteriser),
plays the loop, and fails on any console error or page error. Latest run:

```
✓ boot completed without throwing        ✓ 714 colliders · 32 POIs · 17 NPCs
✓ mode = explore                         ✓ 38 interactions registered
✓ starting coins 120                     ✓ 144 draw calls
✓ cat walked 1.6 of a possible 2.1 units ✓ cat is on the ground
✓ inventory / recipes / quests / map each open and close, mode restored
✓ ingredients in basket, coins deducted
✓ cooked salmon_nigiri, grade good, 6.6 s, 3 steps · mode restored after cooking
✓ served cucumber_maki: +48¢ pay, +1.4 rep · coins and reputation increased
✓ save → wipe → load restores coins, inventory and quest progress exactly
✓ corrupt save rejected safely and quarantined
✓ night factor 1.00 at 21:30
✓ fishing started and mode restored after
✓ still in explore mode after a 10 s soak
ALL CHECKS PASSED
```

Screenshots of all five districts at different times of day are in
`tools/shots/`.

### Problems found and fixed during integration

- **Camera was in front of the cat.** I set the camera yaw to `spawn.yaw + PI`.
  The controller places the camera at `target − dir·dist` where `dir` is built
  from the same yaw, so camera yaw must *equal* character yaw to sit behind it.
- **Camera aimed two units over the cat's head.** `thirdPersonControls` hardcoded
  `headH = 3.0 × scale` for a 4-unit humanoid. Parameterised, and it now prefers
  `character.eyeHeight()` when the character offers one.
- **Cat silhouette read as a table.** First build had 1.04 shoulder height on long
  thin legs with an invisible tail. Rebuilt at 0.78 shoulder / 1.55 long with
  thick legs, a raised curling tail and bigger ears. Fixing the proportions
  surfaced three latent pose bugs (sit, sleep and the upright blend each pushed
  paws through the floor) which are also fixed, plus a new floor clamp so planted
  paws stay welded during gait bob.
- **07:00 on day one looked like dusk.** The night curve ran dawn 5→8 so the game
  opened at half-night; and the sky's warm tint used the dusk palette for dawn
  too. Dawn now finishes at 6.8 and has its own paler palette on a narrower
  window.
- **The home plaza was a bare tan plain.** Now paved, framed by 11 buildings and
  dressed with 43 props, with the spawn→door line kept clear. A survey pass then
  filled the empty ground between districts: points more than 18 units from
  anything dropped from ~800 to 17 inside the district box.
- **`cooking.start()` had two callers with two signatures.** The restaurant called
  it with an object, the recipe book with a string. It now accepts both.
- **Two agents invented different NPC id sets.** Reconciled against the roster in
  `data/npcs.js`; a script now cross-checks every quest `giver`, `turnIn` and
  objective target against it.
- **`audio.js` exported `setMusic` twice** (district track vs volume). The track
  setter is `setMusicTrack`.
- **Three.js `FileLoader` bug**: it registers `loading[url]` before constructing
  the `Request`, so an unparseable URL throws outside the fetch's `.catch()` and
  every later load of that URL hangs forever. `catLoader.js` absolutises URLs and
  races every load against a timeout, so a bad model path can never wedge boot.

### Known issues carried forward

- Frame rate was measured at ~1–4 fps, but that is a software rasteriser in a
  headless container with no GPU. **Real performance is unmeasured** — 320k
  triangles at ~150 draw calls should be comfortable on an M2, but that needs
  confirming on your machine.
- `q06`, `q08` and `q12` need their set-piece mini-games (see ROADMAP).
- No shop interior yet.
- Economy numbers are reasoned from anchors, not playtested.

### Placeholder assets still to replace

Everything in this project is generated in code — there are no asset files at
all. The following are deliberate placeholders:

| Placeholder | Where | Replace with |
| --- | --- | --- |
| Procedural cat | `src/cat/catModel.js` | A GLB/VRM cat: drop it in `public/models/` and set `CAT_MODEL_URL` in `src/config.js`. The loader maps clip names to the action vocabulary and falls back to the procedural cat on any failure |
| Synthesised audio | `src/audio/audio.js` | Recorded sfx/music. `play(name)` is the single swap point; the sfx table names 24 cues |
| Emoji icons | all UI panels | Illustrated icon set |
| Canvas-drawn signage | `buildings.js`, `props.js` | Hand-painted sign textures |
| Text-label signs ("DOCK SHED") | harbour buildings | Proper illustrated signage |
| NPC portraits | `ui/dialogueUI.js` | Canvas-drawn cat faces → real portrait art |
