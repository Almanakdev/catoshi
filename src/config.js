// Project-wide switches. Kept tiny and dependency-free so anything can import it.

export const GAME = {
  title: 'OSHICAT',
  tagline: 'Blue cat. Neon knives. Oshicat.',
  ticker: '$OSHICAT',
  build: '0.5.0-oshicat',
  /** All "Buy Coin" buttons open this. */
  robinhoodUrl: 'https://www.sushi.com/robinhood/launchpad/token/0x4af955ec23941363FAcD33A9562C611f2cBAC68b',
  twitterUrl: 'https://x.com/catoshi',
  sessionKey: 'catoshi:session',
};

/**
 * Drop a cat model into public/models/ and point this at it (e.g. './models/cat.glb'
 * or './models/cat.vrm') to replace the procedural cat. Null = use the built-in one.
 */
export const CAT_MODEL_URL = null;

/**
 * Player cat look — also the fallback tint when no model is loaded.
 * Blue fur + white headband matches the Oshicat brand art (pic 1).
 * `belly` is the chef coat, `accent` the headband / coat trim / apron ties.
 */
export const PLAYER_CAT = {
  fur: '#4a7ec8',
  belly: '#f4f7fb',
  accent: '#f5f5f5',
  eye: '#2a3d5c',
  scale: 1.0,
  // White sports headband — ears stay readable at camera distance.
  hat: 'headband',
  apron: true,
  // The model's gait thresholds are normalised (idle < 0.15, walk < 3.2, run
  // above). CAT_CONTROLS drives the player at 5.0 / 9.8 world units, so scale
  // them down or the walk cycle would always read as a full sprint. NPCs move
  // at ~1.5 and use the default of 1.
  speedScale: 0.5,
};

/**
 * Controller tuning for the bipedal chef cat (the engine default is a 4-unit
 * human). The cat stands 1.94 units to the ear tips with its eyes at 1.58, and
 * one building storey is ~3.6 units, so it reads as a small person.
 *
 * Deliberately NOT realistic: gravity is ~3x Earth and the jump clears 1.5
 * units, which keeps hopping around the city snappy and playful rather than
 * floaty. If you change `walk`, update the budget constant in tools/smoke.mjs
 * (it normalises the movement check against it) and PLAYER_CAT.speedScale.
 */
export const CAT_CONTROLS = {
  playerH: 1.9,       // vertical span used for collider overlap
  radius: 0.55,
  stepUp: 1.0,        // tallest ledge the longer legs will walk up
  gravity: 30,
  jumpV: 9.4,         // → ~1.47 units of air, ~0.63 s hang time
  fallLedge: 1.0,     // drop that becomes a real fall rather than a stair lip
  walk: 5.0,
  run: 9.8,
  dist: 9.5,          // silhouette reads best at 8–14 units
  distMin: 3.6,
  distMax: 18,
  headFactor: 0.92,   // camera aims at eyeHeight * this ≈ 1.45 (chin height)
};

export const RENDER = {
  maxPixelRatio: 1.6,
  shadowMapSize: 2048,
  fog: { near: 90, far: 340 },
  // Post-processing is opt-in per quality tier (see QUALITY below).
  // Cool ink edge so the sakura night city stays crisp.
  outlineColor: 0x2a121c,
  outlineStrength: 0.42,
};

/** Sakura-lantern Oshicat palette — sky / fog / grade. */
export const CITY_PALETTE = {
  day:   { top: 0x7a5a8a, mid: 0xf0b0c8, bot: 0xf8d8e4 },
  dusk:  { top: 0x4a1a38, mid: 0xe07898, bot: 0xf0a878 },
  dawn:  { top: 0x8a6a9a, mid: 0xf0b8d0, bot: 0xf8dce8 },
  night: { top: 0x1a0814, mid: 0x4a1838, bot: 0xc45a78 },
  fogDay: 0xf0b0c8,
  hemiDay: 0xf0d8e4,
  hemiNight: 0x4a2840,
  sunDay: 0xffe8f0,
  sunDusk: 0xffb0c8,
  ambient: 0xfff0f4,
};

export const QUALITY = [
  { id: 'low',    label: 'Low',    shadows: false, post: false, bloom: false, ao: false, pixelRatio: 1.0, npcDistance: 45 },
  { id: 'medium', label: 'Medium', shadows: true,  post: true,  bloom: true,  ao: false, pixelRatio: 1.4, npcDistance: 70 },
  { id: 'high',   label: 'High',   shadows: true,  post: true,  bloom: true,  ao: true,  pixelRatio: 1.6, npcDistance: 95 },
];

export const DEBUG = {
  showStats: false,
  freeCamera: false,
  skipIntro: false,
};
