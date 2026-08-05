# Three.js City — Open-World Prototype

A realistic-ish, explorable 3D city built with [Three.js](https://threejs.org/)
and [Vite](https://vitejs.dev/). Walk or fly through a procedurally generated
metropolis in first person — textured buildings with lit windows, a scattering
sky with a real sun, soft shadows, roads, and parks. No external 3D assets: all
textures are generated in-browser on a canvas, so nothing needs downloading.

## Run it

You need [Node.js](https://nodejs.org/) 18+ installed.

```bash
npm install     # install Three.js + Vite (first time only)
npm run dev      # start the dev server; it opens your browser automatically
```

Then click the screen to lock the mouse and start exploring.

To make a production build:

```bash
npm run build    # outputs to dist/
npm run preview  # serve the built version locally
```

## Controls

| Action        | Key            |
| ------------- | -------------- |
| Move          | `W` `A` `S` `D`|
| Look          | Mouse          |
| Sprint        | `Shift`        |
| Fly up / down | `Space` / `C`  |
| Release mouse | `Esc`          |

## How it's organized

```
index.html        Page shell, start overlay, HUD, styles
vite.config.js    Vite config (base './' so builds run from any path)
src/
  main.js         Renderer, scene, sky/sun, lights, loop, wiring
  city.js         Procedural city generator (roads, buildings, parks, colliders)
  controls.js     First-person WASD + mouse-look controller with collision
  textures.js     Canvas-generated facade / ground / road textures
```

## Tweak it

Most of the fun knobs live at the top of the relevant file:

- **City size / density** — `buildCity(scene, { blocks, blockSize, road, seed })`
  in `src/main.js`. Bump `blocks` to 12–16 for a bigger city. Change `seed` to
  regenerate a completely different layout.
- **Time of day** — `elevation` and `azimuth` in `src/main.js` move the sun.
  Lower elevation = golden hour; try `elevation: 4` for sunset.
- **Building heights** — the `h = 8 + Math.pow(rng(), 1.6) * 62` line in
  `src/city.js` controls the height distribution.
- **Window glow** — `emissiveIntensity` on the building material in `src/city.js`.

## Where to take it next

Ideas for turning this prototype into a fuller open world:

- Swap the box buildings for real `.glb` models loaded with `GLTFLoader`
  (the `cloudai-x/threejs-skills` loaders skill covers this).
- Add cars driving along the road grid, and pedestrians.
- Instanced meshes (`InstancedMesh`) for thousands of props at high frame rate.
- A minimap, collectibles, or objectives to make it a game.
- Post-processing (bloom on the lit windows) via `EffectComposer`.

---

Built as a starting point — everything here is meant to be edited. Have fun.
