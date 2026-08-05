# Development log

## 2026-08-05 — Milestone 1: Phases 1–5

### What was done

**Phase 1.** Audited `ENGINE CITY` in place without modifying it. Confirmed the
stack by reading `package.json`, `vite.config.js` and the source rather than
assuming: Three.js r0.169 + Vite 5, npm, no engine, no scene files, procedural
textures. Ran `npm run build` on the original — clean, 93 modules, 5.3 s. Full
findings in `docs/AUDIT.md`.

**Backup.** Cloned to `SUSHI PAWS` (source + config only; `dist/`, `.git` and the
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
