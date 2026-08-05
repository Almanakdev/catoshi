# Project: Three.js Open-World City

This is a first-person, explorable 3D city built with **Three.js** and **Vite**.
Textures are generated procedurally on a canvas (no external asset files).

## Run
- `npm install` then `npm run dev` (opens the browser; click to lock the mouse).
- Build: `npm run build`, preview: `npm run preview`.

## Layout
- `src/main.js` — renderer, scene, gradient sky + sun, lights, fog, outline post-processing, animation loop, wiring.
- `src/city.js` — procedural city generator: roads, buildings, parks, instanced wind-animated grass, chunky trees, collider boxes.
- `src/character.js` — blocky low-poly player character with a procedural walk-cycle animation.
- `src/controls.js` — third-person WASD controller: camera-relative movement, follow camera, turn-to-face, collision.
- `src/textures.js` — canvas-generated toon gradient map + facade / ground / road textures.
- `index.html` — page shell, start overlay, HUD, styles.

## Controls
WASD walk (third person) · Shift sprint. The camera follows behind; the character turns to face movement.

## Conventions
- Three.js r0.169, ES modules, `import * as THREE from 'three'`.
- Add-ons come from `three/addons/...` (e.g. `three/addons/loaders/GLTFLoader.js`).
- Keep the project self-contained: prefer procedural or bundled assets over external URLs.
- The city uses a seeded RNG (`seed` in `buildCity`) so layouts are reproducible.

## Skills
Three.js skills are installed in `.claude/skills/`. Use them when relevant:
fundamentals, geometry, materials, lighting, textures, animation, loaders,
shaders, postprocessing, interaction.
