// Project-wide switches. Kept tiny and dependency-free so anything can import it.

export const GAME = {
  title: 'Sushi Paws',
  tagline: 'From street cat to sushi legend.',
  build: '0.3.0-vertical-slice',
};

/**
 * Drop a cat model into public/models/ and point this at it (e.g. './models/cat.glb'
 * or './models/cat.vrm') to replace the procedural cat. Null = use the built-in one.
 */
export const CAT_MODEL_URL = null;

/** Player cat look — also the fallback tint when no model is loaded. */
export const PLAYER_CAT = {
  fur: '#e8a55c',
  belly: '#f9efdd',
  accent: '#c8503f',
  eye: '#3a5f3a',
  scale: 1.0,
  hat: null,
  apron: true,
};

/** Controller tuning for a cat-sized character (the engine default is a 4-unit human). */
export const CAT_CONTROLS = {
  playerH: 1.1,
  radius: 0.5,
  stepUp: 0.9,
  gravity: 22,
  jumpV: 7.4,
  fallLedge: 0.7,
  walk: 4.6,
  run: 9.2,
  dist: 7.6,
  distMin: 2.6,
  distMax: 14,
  headFactor: 1.35,   // lifts the camera target above the low cat silhouette
};

export const RENDER = {
  maxPixelRatio: 1.6,
  shadowMapSize: 2048,
  fog: { near: 90, far: 340 },
  // Post-processing is opt-in per quality tier (see QUALITY below).
  outlineColor: 0x4a3a2c,
  outlineStrength: 0.42,
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
