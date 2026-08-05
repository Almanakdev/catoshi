# Phase 1 — Audit of `ENGINE CITY`

Audited 2026‑08‑05 against `~/Documents/ROXX/2. MOCKUP/ENGINE CITY`.
Nothing in that folder was modified. Sushi Paws is a clone.

## 1. Technology stack — verified, not assumed

| Question | Answer |
| --- | --- |
| Engine | None. Hand-written **Three.js r0.169** application |
| Language | Modern JavaScript, ES modules. No TypeScript, no JSX |
| Build system | **Vite 5.4** (`vite` / `vite build` / `vite preview`), `base: './'` |
| Package manager | **npm** (`package-lock.json` present, lockfileVersion 3) |
| Dependencies | `three@^0.169.0`, `@pixiv/three-vrm@^3.5.5`. That is the entire runtime dependency list |
| Scenes | No scene files. The world is **generated in code** at boot |
| Asset pipeline | Deliberately assetless — every texture is drawn on a `<canvas>` at runtime. The only binary assets are `public/models/*.vrm` (5 crowd avatars), `Soldier.glb`, a 26 MB car pack, and 3 Mixamo `.fbx` animations |
| Repo state | Git repo present, clean. `dist/` and `node_modules/` were committed (130 MB + 68 MB) |
| Build health | **`npm run build` succeeds**: 93 modules → 1.12 MB JS (316 kB gzip), 5.3 s. Zero errors, one chunk-size warning |

Project size: 393 MB total — 130 MB `public/`, 131 MB `dist/`, 68 MB `node_modules/`, **780 KB of actual source** across 74 modules.

## 2. System inventory

| System asked about | Present? | Where | Verdict |
| --- | --- | --- | --- |
| Player movement | ✅ | `thirdPersonControls.js` (316 L) | **Reuse** — WASD camera-relative, jump/crouch, AABB push-out, step-up, knockback. Genuinely good |
| Camera | ✅ | same file | **Reuse** — single orbit follow camera, cursor-edge steering + drag, wheel zoom |
| City environment | ✅ | `city.js` (2329 L) | **Replace** — procedural 8×8 grid with downtown/inner/outer rings. Excellent code, wrong game |
| NPCs | ⚠️ | `crowd.js` (live), `npcs.js` (dead code) | **Replace** — VRM crowd is a stateless random walk. No dialogue, no schedules, no interaction hooks at all |
| Interactions | ⚠️ | `main.js` `checkDoors()` + a hardcoded E-key priority chain | **Rebuild** — worked, but not extensible. Became `game/interactions.js` |
| Vehicles | ✅ | `traffic.js` (703 L), `driving.js` | **Not used** — a cat delivering sushi does not drive. Kept in `_attic/` |
| Buildings | ✅ | `shops/` (20 types), `landmarks/`, `industrial/` | **Reuse the contract, replace the content** — the merge-then-instance builder pattern is excellent and Sushi Paws follows it exactly |
| UI | ⚠️ | static markup in `index.html` + `getElementById` | **Rebuild** — dark glass HUD, wrong art direction, no reusable panel component |
| Save system | ❌ | — | **Missing.** Grep for `localStorage` / `JSON.stringify` across `src/`: **zero matches**. Every reload was a fresh run |
| Quest system | ⚠️ | `missions.js` (563 L) | **Replace** — three hardcoded mission kinds, one at a time, no ids, no chain, no persistence. Objectives are only ever "be at a place" |
| Inventory | ❌ | — | **Missing.** No item concept anywhere |
| Economy | ⚠️ | `needs.js` — one `money` variable + a 12-entry `SERVICES` table | **Extend** — buying is "pay coins, gain a stat". No stock, no catalogue, nothing you own afterwards |
| Day/night cycle | ✅ | `main.js` lines 473–590 | **Reuse the idea, rebuild the code** — it was module-private with no API. Sushi Paws has `game/clock.js` |
| Weather | ✅ | `weather.js` | **Reuse as-is** — clean, self-restoring, cheap when clear |
| Post-processing | ✅ | `main.js` — outline / GTAO / bloom / godrays / grade | **Partially reuse** — the depth+normal outline needs a second full scene render. Replaced with a cheaper depth-only sobel |
| Textures | ✅ | `textures.js` (869 L) | **Reuse wholesale** — 20 canvas texture generators and the toon gradient ramp |
| Geometry helpers | ✅ | `shops/common.js` | **Reuse wholesale** — `paint/box/cyl/blob/merge` + a 33-colour palette. Now `engine/prim.js` |

### Dead code found in the engine
`character.js`, `characterModel.js`, `controls.js`, `npcs.js`, `shops/restaurant.js` are never imported. `CLAUDE.md` describes the old first-person architecture and is stale.

### Architectural gotchas worth recording
- `buildCity()` uses one shared `mulberry32` stream. Inserting any `rng()` call anywhere reflows the entire city layout.
- `colliders` is a single mutable array shared by reference; interiors swap it in place (`colliders.length = 0; push(...)`).
- `minimap` snapshots its POI list at construction — POIs added later are invisible.
- Four separate modules re-derive the road grid from `blocks/blockSize/road` rather than sharing one graph.
- The outline pass re-renders the whole scene with an override material, so every transparent effect must be hidden during it.

## 3. What Sushi Paws reuses, changes, and adds

**Reused unchanged** (`src/engine/`): `textures.js`, `prim.js`, `inputGuard.js`, `weather.js`, `skyDetails.js`, `cinematic.js`, `entranceMarkers.js`, `minimap.js`, `interiors.js`.

**Reused with a documented change**: `thirdPersonControls.js` — the constants were hardcoded for a 4-unit humanoid (`PLAYER_H 3.5`, `radius 1.4`, `gravity 62`, `walk 9`, `headH = 3.0 × scale`). They are now an injectable `TUNE` object with the old values as defaults, and the camera asks the character for `eyeHeight()` when it offers one. The original engine characters still frame identically.

**Replaced by design** (the user chose hand-authored districts over the procedural generator): `city.js` → `src/world/world.js` + `src/world/buildings.js` + `src/world/props.js`.

**Kept but not wired** (`src/_attic/`, never imported so never bundled): the VRM crowd, traffic, driving, the monorail, landmarks, industrial zone, pier, the old mission system, needs, socialUI, the opening cutscene, and all 20 original shop builders. They remain available if a later phase wants them.

**Net new**: save system, inventory, economy, orders/customers, cooking mini-games, fishing, delivery, foraging, quests, NPC schedules and dialogue, relationships, upgrades, the whole UI layer, the cat character, and the audio.

## 4. Backup / restore point

The clone was made without `.git`, `dist/` or `node_modules/`, then re-initialised as its own repository with the engine baseline committed first and tagged, so `git diff engine-baseline` shows exactly what Sushi Paws changed. `ENGINE CITY` itself was never opened for writing.
