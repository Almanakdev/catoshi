# Sushi Paws

**From street cat to sushi legend.**

A cozy semi-open-world game about a cat who dreams of becoming the greatest
sushi master in a Japanese-inspired city. Built on the `ENGINE CITY` Three.js
base (see `docs/AUDIT.md` for what was reused and what was replaced).

## Run it

```bash
npm install     # first time only
npm run dev     # opens the browser
```

Production build: `npm run build`, then `npm run preview`.

## Controls

| | |
| --- | --- |
| `W A S D` | Walk · `Shift` to run |
| `Space` | Jump |
| Mouse drag / edge | Look · wheel zooms |
| `E` | Interact — talk, buy, cook, fish, pick up |
| `I` | Basket (inventory) |
| `R` | Recipe book |
| `Q` | Journal (quests) |
| `M` | City map |
| `U` | Upgrades |
| `F` / `G` / `H` | Meow · sit · stretch |
| `N` | Advance time 2 hours (debug) |
| `Esc` | Close panel, or open Settings |

## The loop

Wake at the shop → check orders → head into the city to buy, fish or forage
ingredients → come back → cook through a short mini-game → serve or deliver →
earn coins, reputation and chef XP → upgrade the shop → unlock districts,
suppliers, recipes and story.

## The city

Five compact hand-authored districts, each with a job:

| District | What it's for |
| --- | --- |
| **Old Market** | Rice, vegetables, sauces. Your shop and the plaza. Master Kuro and Yuki |
| **Fish Harbour** | Fresh fish, fishing spots, the morning auction. Mikan and Goro |
| **Downtown** | Premium deliveries, competitions, business upgrades |
| **Residential** | Family deliveries, relationships, hiring staff |
| **Neon Food Street** | Advanced recipes, rival chefs, night festivals |

## Project layout

```
src/
  main.js          renderer, sky, lights, post stack, construction order, frame loop
  player.js        the playable cat: model + controller + stamina/footsteps/districts
  config.js        every tuning switch, including CAT_MODEL_URL
  cat/             procedural cat rig + optional GLB/VRM loader
  world/           world.js (the hand-authored city), buildings.js, props.js
  game/            state, save, clock, interactions, orders, restaurant, cooking,
                   fishing, delivery, foraging, quests, npc runtime, bus
  data/            ALL content: recipes, ingredients, npcs, quests, suppliers,
                   upgrades, districts, events, progression
  ui/              kit.js (the toolkit) + one module per panel
  engine/          modules vendored unchanged from ENGINE CITY
  _attic/          ENGINE CITY systems kept for reference; never imported
docs/              AUDIT.md · ROADMAP.md · DEVLOG.md
tools/             smoke.mjs (headless playthrough test), shots/
```

## Adding content

Everything below is a data edit — no gameplay code changes needed.

- **A recipe** → `src/data/recipes.js`. Reference ingredient ids and steps from
  the `STEPS` vocabulary; the cooking engine already knows how to play them.
- **An ingredient** → `src/data/ingredients.js`, then stock it in `suppliers.js`.
- **A quest** → `src/data/quests.js` using the `OBJECTIVE_TYPES` vocabulary.
- **An NPC** → `src/data/npcs.js` with a gapless 24-hour schedule.
- **An upgrade** → `src/data/upgrades.js`. The `effects` keys are read by name.
- **A building or prop** → a builder in `src/world/buildings.js` / `props.js`,
  then a registry entry and a placement in `src/world/world.js`.

## Testing

```bash
npm run build
node tools/smoke.mjs --shots
```

Boots the built game in headless Chromium, plays the whole loop, and fails on
any console error. `--shots` writes screenshots to `tools/shots/`.

## Assets

There are none. Every texture, model, sound and icon is generated in code, so
the repo is source-only and nothing needs licensing. To use your own cat model,
drop a `.glb` or `.vrm` into `public/models/` and set `CAT_MODEL_URL` in
`src/config.js`.
