// Hand-authored city layout. The city is compact on purpose: five readable
// districts around a short road cross, so every journey is a walk of seconds,
// not minutes.
//
// Coordinate convention (inherited from the engine): +X east, +Z south, Y up.
// 1 unit ~= 1 metre. Everything faces +Z at yaw 0.

export const WORLD = {
  bounds: 96,            // hard clamp for the player controller
  groundY: 0,
  waterZ: -62,           // harbour water starts here and runs north
  seed: 20260805,
};

// The city was rebuilt at roughly a third of its original footprint: every
// district is now 4-7 seconds' run from the shop, so a shopping trip is a
// pleasant errand rather than a commute. Building sizes did NOT shrink — the
// districts are denser instead, which is what makes them read as a real town.
export const SCALE_NOTE = 'compact rebuild, 2026-08-05';

/** Road segments are axis-aligned strips: {x, z} is the centre. */
export const ROADS = [
  // Main east–west street, straight past the shop
  { id: 'market_road', x: 1,  z: 0,   w: 124, d: 8, name: 'Market Road' },
  // Main north–south avenue
  { id: 'harbor_ave',  x: 0,  z: -1,  w: 8,   d: 132, name: 'Harbour Avenue' },
  // Harbour frontage
  { id: 'quay',        x: 3,  z: -56, w: 68,  d: 7, name: 'The Quay' },
  // Up to the neon street
  { id: 'neon_lane',   x: 44, z: -41, w: 7,   d: 40, name: 'Neon Lane' },
  { id: 'neon_cross',  x: 24, z: -22, w: 48,  d: 7, name: 'Lantern Cut' },
  // Residential loop
  { id: 'home_lane',   x: 1,  z: 52,  w: 60,  d: 7, name: 'Home Lane' },
  // Downtown block edge
  { id: 'tower_row',   x: 40, z: 10,  w: 7,   d: 50, name: 'Tower Row' },
];

export const DISTRICTS = [
  {
    id: 'old_market',
    name: 'Old Market',
    short: 'Market',
    icon: '🏮',
    center: { x: -34, z: 4 },
    half: { x: 24, z: 26 },
    ground: '#e6d7b6',
    accent: '#c8503f',
    music: 'market',
    ambience: 'market',
    unlock: { free: true },
    blurb: 'Narrow lanes, fabric banners and the smell of fresh rice.',
    // Where the fast-travel / arrival marker sits
    gate: { x: -14, z: 3 },
    purpose: ['Buy rice, vegetables and sauces', 'Small errands', 'Hidden recipes'],
  },
  {
    id: 'fish_harbor',
    name: 'Fish Harbour',
    short: 'Harbour',
    icon: '⚓',
    center: { x: 2, z: -46 },
    half: { x: 34, z: 20 },
    ground: '#cfd8d3',
    accent: '#4e8fa8',
    music: 'harbor',
    ambience: 'harbor',
    unlock: { reputation: 0, quest: 'q02_first_catch_intro' },
    blurb: 'Wooden docks, crates of ice, and gulls that steal your lunch.',
    gate: { x: 0, z: -26 },
    purpose: ['Buy fresh fish', 'Fishing', 'Rare ingredients'],
  },
  {
    id: 'downtown',
    name: 'Downtown',
    short: 'Downtown',
    icon: '🏙️',
    center: { x: 40, z: 10 },
    half: { x: 22, z: 26 },
    ground: '#d6d3cc',
    accent: '#3f7fa8',
    music: 'downtown',
    ambience: 'downtown',
    unlock: { reputation: 45 },
    blurb: 'Office cats, vending machines and a very small train station.',
    gate: { x: 19, z: 4 },
    purpose: ['Premium deliveries', 'Competitions', 'Business upgrades'],
  },
  {
    id: 'residential',
    name: 'Residential',
    short: 'Homes',
    icon: '🏡',
    center: { x: 0, z: 52 },
    half: { x: 30, z: 18 },
    ground: '#dfe0c9',
    accent: '#7ea36a',
    music: 'home',
    ambience: 'suburb',
    unlock: { reputation: 18 },
    blurb: 'Quiet streets, bicycles, and neighbours who remember your name.',
    gate: { x: 0, z: 33 },
    purpose: ['Family deliveries', 'Relationship quests', 'Hire staff'],
  },
  {
    id: 'neon_street',
    name: 'Neon Food Street',
    short: 'Neon',
    icon: '🎆',
    center: { x: 44, z: -40 },
    half: { x: 20, z: 18 },
    ground: '#3b3a4a',
    accent: '#e0508f',
    music: 'neon',
    ambience: 'festival',
    unlock: { reputation: 130, shopTier: 3 },
    blurb: 'It is always night here. Rival chefs, festivals, and the best crowds.',
    gate: { x: 44, z: -21 },
    purpose: ['Advanced recipes', 'Rival chefs', 'Night festivals'],
  },
];

/** The player's shop + home sit on the plaza at the east edge of Old Market. */
export const HOME = {
  shop: { x: -12, z: 11, yaw: 0 },       // +Z front faces the plaza and the spawn point
  shopDoor: { x: -12, z: 15, yaw: Math.PI },
  bed: { x: -16, z: 9 },
  spawn: { x: -12, z: 19, yaw: Math.PI },
  plaza: { x: -11, z: 17, r: 11 },
  board: { x: -5, z: 17 },               // delivery job board, on the plaza edge
};

export function districtAt(x, z) {
  for (const d of DISTRICTS) {
    if (Math.abs(x - d.center.x) <= d.half.x && Math.abs(z - d.center.z) <= d.half.z) return d;
  }
  return null;
}

export function districtById(id) {
  return DISTRICTS.find((d) => d.id === id) || null;
}
