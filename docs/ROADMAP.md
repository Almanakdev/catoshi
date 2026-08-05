# Catushi — implementation roadmap

Working title. Everything is namespaced `catushi.*` (save keys) and `sp-`
(CSS), and the display name lives in one place (`src/config.js` → `GAME.title`),
so renaming the project is a one-line change plus a save-key migration.

## Architectural decisions, and why

**1. Systems are factories that talk over a bus, not objects that hold each other.**
The engine's `main.js` was 1824 lines because every system reached into every
other one. Here each system is `createX(game)` returning `{ update(dt), … }` and
communicates through `src/game/bus.js`. `main.js` is ~430 lines and does only
three jobs: render setup, construction order, frame loop. Adding a system is one
import, one construction line, one `update()` call.

**2. All state lives in one serialisable object.**
`state.data` holds no THREE objects, no DOM nodes, no functions — which is the
only reason saving is a `JSON.stringify` rather than a bespoke walker. Every
mutation goes through a method so the bus stays truthful.

**3. Content is data, gameplay is code.**
Recipes, ingredients, quests, NPCs, suppliers, upgrades, prices, districts and
city events are plain arrays in `src/data/`. Adding a recipe is a data entry —
the cooking engine already knows how to play its steps, because steps are drawn
from a fixed vocabulary of six interaction primitives. Nothing in `src/game/`
contains a content list.

**4. The city is hand-authored, not generated.**
You chose compact readable districts over the engine's procedural grid, so
`city.js` was retired to `_attic/` and `src/world/world.js` places every building
by hand against a validator that rejects overlaps with other buildings, roads,
water and the plaza. The engine's *building contract* (merge geometry → one
`InstancedMesh` per channel) is reused exactly, which is why 60 buildings and
323 props still render in 146 draw calls.

**5. One interaction registry, one prompt.**
Everything you can press E on registers with `src/game/interactions.js`, which
resolves priority and proximity and owns the prompt. The engine's hardcoded
door/service/board/car chain in `main.js` does not scale past a handful of verbs;
this handles 44 at boot without a single conditional in `main.js`.

**6. The follow controller was parameterised, not forked.**
Its constants were tuned for a 4-unit humanoid. They are now an injectable
`TUNE` object defaulting to the original values, and the camera asks the
character for `eyeHeight()` when it offers one. The original engine characters
frame identically; the cat gets its own numbers from `src/config.js`.

## Phase status

| Phase | Status |
| --- | --- |
| **1 — Audit** | ✅ Done. `docs/AUDIT.md`, backup tag, this roadmap |
| **2 — Core player** | ✅ Done. Procedural cat with 18 actions + personality layer, cat-tuned controls, interaction system, sushi shop hub at 5 visual tiers |
| **3 — Vertical slice** | ✅ Done and verified headlessly. Buy → carry → cook → serve → earn → save |
| **4 — Restaurant systems** | ✅ Done. Order queue, customer cats with patience bubbles, six cooking mini-games, satisfaction, tips, daily summary, 18 upgrades, 5 shop tiers |
| **5 — City integration** | ✅ Done. All five districts, 6 suppliers, fishing (5 spots), deliveries, foraging (11 nodes), waypoints + compass + map |
| **6 — Progression** | ✅ Data and systems complete: reputation tiers, chef levels, relationships, recipe/district unlock rules, upgrade tree. **Needs balancing across a full playthrough** |
| **7 — Story & content** | 🟡 17 quests authored and wired; the main chain runs. Three quests (`q06`, `q08`, `q12`) have `minigame`/`compete` objectives that still need their bespoke set-piece — see below |
| **8 — Polish** | 🟡 Art direction, lighting and UI are in. Remaining: controller support, audio pass, save migration test at v2, perf profiling on real hardware |

## What is deliberately not done yet

- **Rival duel and championship set-pieces.** `q08_rival_duel` and
  `q12_championship` expect a `compete` objective to be satisfied by a timed
  head-to-head mini-game that does not exist yet. The quest engine will accept
  `game.quests.progress('compete', 'ryu_duel')` from whatever drives it.
- **`q06_lost_crate`** needs a findable crate prop placed at the harbour with an
  interaction that calls `progress('minigame', 'lost_crate')`.
- **Hiring Hana** grants the flag but there is no staff simulation behind it.
- **Interiors.** The engine's interior system is vendored and working but no
  Catushi room is built yet — the shop is exterior-only, which suits a street
  cart and a market stall but tier 4–5 want an inside.
- **Weather** is vendored but not wired into the frame loop.
- **Controller support.**

## Next three steps, in order

1. **Balance pass.** Play days 1–10 and tune `data/progression.js`,
   supplier prices and `SHOP_TIERS` costs. The numbers are reasoned, not played.
2. **The two competition set-pieces**, which unlock the last third of the story.
3. **Shop interior** for tiers 3+, reusing `engine/interiors.js`.
