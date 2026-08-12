# Project: Catushi

A cozy semi-open-world Three.js game: a cat becomes a sushi master in a
Japanese-inspired city. Built on the `ENGINE CITY` base.

## Run
`npm install` then `npm run dev`. Build with `npm run build`.
Test with `npm run build && node tools/smoke.mjs` — it must print ALL CHECKS PASSED.
`node tools/mobile.mjs` is the same game at three phone viewports, driven by
touch; it must print MOBILE LAYOUT OK. Add `--shots` to keep screenshots.

## Architecture rules
- Systems are factories `createX(game)` returning `{ update(dt), … }`. They talk
  through `src/game/bus.js` (`EV.*` names only — never string literals) and never
  hold references to each other. `main.js` owns construction order and the loop.
- `state.data` must stay JSON-safe: no THREE objects, no DOM, no functions. That
  is what makes saving cheap. Mutations go through `state` methods so events fire.
- Content lives in `src/data/`. Gameplay code must not contain content lists.
- Geometry: build with the `src/engine/prim.js` helpers, `merge()` into one
  geometry per prefab, render with `InstancedMesh`. Prefabs face `+Z`.
- Emissive materials go into `world.glowMats` (warm windows) or `world.neonMats`
  (signs) so the day/night ramp can drive them.
- UI is built from `src/ui/kit.js` primitives and its CSS custom properties.
  Never hardcode a second palette.
- Panels register with `game.panels` and follow the contract in
  `src/game/CONTRACT.md`. Mini-games must restore `game.setMode('explore')` and
  unlock the player on *every* exit path, including Esc and thrown errors.

## Conventions
- Three.js r0.169, ES modules, `import * as THREE from 'three'`.
- Add-ons from `three/addons/...`.
- No asset files — textures are canvas-drawn, audio is synthesised.
- Scale: 1 unit ≈ 1 metre, one storey = 3.6, streets 9–11 wide, the cat is
  0.78 at the shoulder.
- Coordinates: +X east, +Z south, Y up. Yaw 0 faces +Z.
- Comment only where the intent is not obvious from the code.

## Do not
- Import anything from `src/_attic/` — it is ENGINE CITY reference code, kept
  deliberately unwired.
- Edit `~/Documents/ROXX/2. MOCKUP/ENGINE CITY`. It is the upstream base.

## Docs
`docs/AUDIT.md` (what the engine had), `docs/ROADMAP.md` (decisions + phase
status), `docs/DEVLOG.md` (what changed and what broke).
