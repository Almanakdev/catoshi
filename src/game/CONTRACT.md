# Catushi — runtime contracts

Every gameplay system is a factory `createX(game, opts)` returning an object
with (at minimum) `update(dt)`. `main.js` owns construction order and the frame
loop; systems never import each other's instances — they talk over the bus.

## The `game` object passed to every factory

```js
game = {
  THREE,                    // the three namespace (avoid re-importing in leaf systems)
  scene, camera, renderer,
  bus, EV,                  // src/game/bus.js
  state,                    // src/game/state.js  (createState)
  save,                     // src/game/save.js
  interactions,             // src/game/interactions.js
  clock,                    // src/game/clock.js  — see below
  world,                    // src/world/world.js — see below
  player,                   // see below
  ui,                       // src/ui/kit.js namespace
  audio,                    // src/audio/audio.js
  guide,                    // src/game/guide.js     — see below
  tutorial,                 // src/game/tutorial.js  — day-one steps, feeds the guide
  guideUI,                  // src/ui/guideUI.js     — banner + arrows + markers + pin
  hideInDepthPass(obj),     // keep sprites/points out of the outline depth prepass
  panels,                   // { open(id), close(id), closeAll(), isOpen(id), register(id, api) }
  setMode(mode),            // 'explore' | 'panel' | 'cooking' | 'fishing' | 'dialogue' | 'cutscene'
  get mode(),
  rng,                      // seeded () => 0..1 for anything that must be reproducible
}
```

### `game.clock`
```js
{ get day(), get hour(), get minute(), get phase(),   // 'morning'|'day'|'evening'|'night'
  get night(),                                        // 0..1 blend factor
  get timeString(),                                   // 'HH:MM'
  set(day, hour), advance(hours), pause(v), get paused(),
  update(dt) }
```
Emits `EV.TIME` every in-game minute, `EV.PHASE` on phase change,
`EV.DAY_START` / `EV.DAY_END` on rollover.

### `game.world`
```js
{ group, colliders,          // THREE.Group, THREE.Box3[]  (colliders is a stable ref)
  districtAt(x, z),          // district data object | null
  poi(id), pois,             // named world points  { id, x, z, label, icon, district }
  setWaypoint(target|null),  // { x, z, label } — drives the compass + minimap
  get waypoint(),
  spawnAt(id),               // { x, z, yaw } for HOME/gates/etc
  groundHeightAt(x, z),
  glowMats, neonMats,        // materials whose emissiveIntensity the day/night ramp drives
  update(dt, night) }
```

### `game.guide`
```js
{ get current(),             // { id, title, hint, target:{x,z}|null, npcId, poiId, kind, distance }
  update(dt), refresh(),     // recomputes; also drives world.setWaypoint()
  setEnabled(v), on(cb),     // cb(next, prev) whenever the objective *changes*
  resolve(spec),             // {kind:'npc'|'poi'|'district'|'counter'|'item'|…} -> {x,z}|null
  destroy() }
```
The guide is the only thing that decides "what now?". Nothing else should own
the waypoint while it is enabled. It never throws: an unresolvable objective
falls through to the next priority level and warns once.

### `game.player`
```js
{ cat,                       // src/cat/catModel.js instance
  controls,                  // engine follow controller
  get position(),            // THREE.Vector3 (live ref — do not mutate directly)
  get yaw(),
  teleport(x, z, yaw),
  lock(v),                   // freeze input (panels, mini-games, cutscenes)
  setAction(name, opts), setMood(m), setTired(v),
  carry(meshOrNull),         // attach/detach a carried object to the cat's carryAnchor
  get carrying(),
  update(dt) }
```

## Events

All event names live in `src/game/bus.js` as `EV.*`. Systems must not invent
string literals — add to `EV` instead.

## Panels

A panel module exports `createXPanel(game)` returning
`{ id, open(payload), close(), get isOpen(), update?(dt), destroy() }` and
registers itself with `game.panels.register(id, api)` on construction.
Opening any panel calls `game.setMode('panel')` and `game.player.lock(true)`;
closing the last one restores `'explore'`.

## Mini-games

`createCooking(game)` and `createFishing(game)` own a full-screen mode. They
must:
1. `game.setMode('cooking'|'fishing')` and `game.player.lock(true)` on start,
2. restore `'explore'` and unlock on finish or abort (Esc always aborts),
3. resolve a Promise with a result object, never leave the game stuck.
