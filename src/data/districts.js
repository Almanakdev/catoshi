// Hand-authored city layout. The city is compact on purpose: five readable
// districts around a short road cross, so every journey is a walk of seconds,
// not minutes.
//
// Coordinate convention (inherited from the engine): +X east, +Z south, Y up.
// 1 unit ~= 1 metre. Everything faces +Z at yaw 0.

export const WORLD = {
  bounds: 175,           // hard clamp for the player controller
  groundY: 0,
  waterZ: -152,          // harbour water starts here and runs north
  seed: 20260805,
};

/** Road segments are axis-aligned strips: {x, z} is the centre. */
export const ROADS = [
  // Main east–west street through the whole city
  { id: 'market_road', x: 5,   z: 0,    w: 260, d: 11, name: 'Market Road' },
  // Main north–south avenue
  { id: 'harbor_ave',  x: 0,   z: -20,  w: 11,  d: 250, name: 'Harbour Avenue' },
  // Harbour frontage
  { id: 'quay',        x: -5,  z: -122, w: 150, d: 10, name: 'The Quay' },
  // Link up to the neon street
  { id: 'neon_lane',   x: 95,  z: -78,  w: 10,  d: 130, name: 'Neon Lane' },
  { id: 'neon_cross',  x: 55,  z: -60,  w: 92,  d: 9,  name: 'Lantern Cut' },
  // Residential loop
  { id: 'home_lane',   x: 0,   z: 104,  w: 130, d: 9,  name: 'Home Lane' },
  // Downtown block edge
  { id: 'tower_row',   x: 92,  z: 22,   w: 9,   d: 96, name: 'Tower Row' },
];

export const DISTRICTS = [
  {
    id: 'old_market',
    name: 'Old Market',
    short: 'Market',
    icon: '🏮',
    center: { x: -72, z: 4 },
    half: { x: 48, z: 46 },
    ground: '#e6d7b6',
    accent: '#c8503f',
    music: 'market',
    ambience: 'market',
    unlock: { free: true },
    blurb: 'Narrow lanes, fabric banners and the smell of fresh rice.',
    // Where the fast-travel / arrival marker sits
    gate: { x: -30, z: 6 },
    purpose: ['Buy rice, vegetables and sauces', 'Small errands', 'Hidden recipes'],
  },
  {
    id: 'fish_harbor',
    name: 'Fish Harbour',
    short: 'Harbour',
    icon: '⚓',
    center: { x: -8, z: -112 },
    half: { x: 62, z: 40 },
    ground: '#cfd8d3',
    accent: '#4e8fa8',
    music: 'harbor',
    ambience: 'harbor',
    unlock: { reputation: 0, quest: 'q02_first_catch_intro' },
    blurb: 'Wooden docks, crates of ice, and gulls that steal your lunch.',
    gate: { x: -4, z: -78 },
    purpose: ['Buy fresh fish', 'Fishing', 'Rare ingredients'],
  },
  {
    id: 'downtown',
    name: 'Downtown',
    short: 'Downtown',
    icon: '🏙️',
    center: { x: 88, z: 22 },
    half: { x: 44, z: 52 },
    ground: '#d6d3cc',
    accent: '#3f7fa8',
    music: 'downtown',
    ambience: 'downtown',
    unlock: { reputation: 45 },
    blurb: 'Office cats, vending machines and a very small train station.',
    gate: { x: 48, z: 4 },
    purpose: ['Premium deliveries', 'Competitions', 'Business upgrades'],
  },
  {
    id: 'residential',
    name: 'Residential',
    short: 'Homes',
    icon: '🏡',
    center: { x: 6, z: 104 },
    half: { x: 56, z: 40 },
    ground: '#dfe0c9',
    accent: '#7ea36a',
    music: 'home',
    ambience: 'suburb',
    unlock: { reputation: 18 },
    blurb: 'Quiet streets, bicycles, and neighbours who remember your name.',
    gate: { x: 2, z: 66 },
    purpose: ['Family deliveries', 'Relationship quests', 'Hire staff'],
  },
  {
    id: 'neon_street',
    name: 'Neon Food Street',
    short: 'Neon',
    icon: '🎆',
    center: { x: 96, z: -104 },
    half: { x: 40, z: 38 },
    ground: '#3b3a4a',
    accent: '#e0508f',
    music: 'neon',
    ambience: 'festival',
    unlock: { reputation: 130, shopTier: 3 },
    blurb: 'It is always night here. Rival chefs, festivals, and the best crowds.',
    gate: { x: 94, z: -66 },
    purpose: ['Advanced recipes', 'Rival chefs', 'Night festivals'],
  },
];

/** The player's shop + home sit on the plaza at the east edge of Old Market. */
export const HOME = {
  shop: { x: -28, z: 16, yaw: 0 },             // +Z front faces the plaza and the spawn point
  shopDoor: { x: -28, z: 22.5, yaw: Math.PI },
  bed: { x: -34, z: 12 },
  spawn: { x: -28, z: 28, yaw: Math.PI },
  plaza: { x: -26, z: 26, r: 20 },
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
