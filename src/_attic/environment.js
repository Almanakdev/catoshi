import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { makeToonGradient, makeRoadTexture } from './textures.js';

// A seamless (tileable) water normal map generated on a canvas — integer wave
// frequencies wrap perfectly at the edges, so the Water shader can scroll and
// blend it forever without seams or glitches. No external image needed.
function makeWaterNormals(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const waves = [
    { ax: 1, ay: 2, amp: 1.0, ph: 0.0 },
    { ax: 3, ay: 1, amp: 0.6, ph: 1.7 },
    { ax: 2, ay: 5, amp: 0.4, ph: 3.1 },
    { ax: 6, ay: 3, amp: 0.3, ph: 4.2 },
    { ax: 5, ay: 7, amp: 0.22, ph: 0.9 },
    { ax: 9, ay: 4, amp: 0.15, ph: 2.4 },
  ];
  const TAU = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0;
      let dy = 0;
      for (const w of waves) {
        const c = Math.cos((TAU * (w.ax * x + w.ay * y)) / size + w.ph) * w.amp;
        dx += (c * TAU * w.ax * 18) / size;
        dy += (c * TAU * w.ay * 18) / size;
      }
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
      img.data[i + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Generated synchronously on a canvas — there is no file to fail loading.
  // Linear color space (default) is correct for normal data; mipmaps + a bit of
  // anisotropy stop the distant water from sparkling/shimmering.
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// The world beyond the city: a vast animated ocean (three.js Water), a small
// sandy strip of land ringing the city, a suspension bridge over the sea, and a
// green island in the distance. Returns { group, water } — `water` is the
// Water shader's time uniform; advance `water.value` (seconds) each frame.
export function createEnvironment({ sunDirection } = {}) {
  const group = new THREE.Group();
  const gradientMap = makeToonGradient(4);

  // -------------------------------------------------------------------------
  // Ocean — the three.js Water object: normal-map-driven waves with real
  // reflections. Stable and glitch-free (no vertex displacement), colored a
  // clear blue. It sits below the beach/land so there's no z-fighting, and it
  // stretches far past the fog so the sea meets the horizon seamlessly.
  // -------------------------------------------------------------------------
  const WATER_Y = -1.2; // well below the beach (-0.45) — no near-coplanar overlap
  const ocean = new Water(new THREE.PlaneGeometry(16000, 16000), {
    textureWidth: 256, // reflection RT kept small — plenty for a stylized sea
    textureHeight: 256,
    waterNormals: makeWaterNormals(),
    sunDirection: (sunDirection ? sunDirection.clone() : new THREE.Vector3(0.5, 0.7, 0.5)).normalize(),
    sunColor: 0xfff3d6,
    waterColor: 0x1f8fce, // clear summer blue
    distortionScale: 2.4,  // gentle ripple, not stormy
    fog: true,             // fades into the scene fog like everything else
  });
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = WATER_Y;
  group.add(ocean);
  const water = ocean.material.uniforms.time; // main.js drives water.value

  // A flat stand-in for the sea used ONLY during the outline/AO depth prepass
  // (the real Water can't go in that pass — its onBeforeRender would re-render
  // the whole reflection). Without it, those passes see the geometry *behind*
  // the water and paint shimmering edge/AO artifacts onto the sea surface.
  const oceanProxy = new THREE.Mesh(ocean.geometry, new THREE.MeshBasicMaterial());
  oceanProxy.rotation.copy(ocean.rotation);
  oceanProxy.position.copy(ocean.position);
  oceanProxy.visible = false;
  group.add(oceanProxy);

  // -------------------------------------------------------------------------
  // Beach — a thin sandy ring hugging the city land (land reaches ~±210, this
  // ring runs out to ~±235), sitting between the ground (y=0) and the flat sea
  // (y=-1.2) so the shoreline reads as sand and the sea starts close to the
  // city. It's above the water and below the land, so nothing flickers.
  // -------------------------------------------------------------------------
  const beach = new THREE.Mesh(
    new THREE.PlaneGeometry(470, 470),
    new THREE.MeshToonMaterial({ color: 0xe0cd98, gradientMap })
  );
  beach.rotation.x = -Math.PI / 2;
  beach.position.y = -0.45;
  beach.receiveShadow = true;
  group.add(beach);

  // -------------------------------------------------------------------------
  // Roadway — the city's main road (vertical road grid index 4, centered at
  // x = -6, width 12) continues straight out here at road grade, across the
  // bridge deck and onto the island, as ONE unbroken road-textured strip so the
  // center line never breaks: road → bridge deck → island road, same width and
  // height, no gap. All the shared roadway numbers live here.
  // -------------------------------------------------------------------------
  const ROAD_X = -6;   // matches the city vertical road at grid index 4
  const ROAD_W = 12;   // matches the city road width
  const ROAD_Y = 0.06; // top surface height ≈ city road grade (planes at y≈0.02)

  const CITY_ROAD_END = -190; // south end of the city road plane
  const ISLAND_ROAD_END = -762; // road runs to the island's far side
  const roadLen = CITY_ROAD_END - ISLAND_ROAD_END; // 572
  const roadTex = makeRoadTexture();
  roadTex.repeat.set(1, roadLen / 380); // same dash scale as the city roads
  const roadSurf = new THREE.Mesh(
    new THREE.BoxGeometry(ROAD_W, 0.12, roadLen),
    new THREE.MeshToonMaterial({ map: roadTex, gradientMap })
  );
  roadSurf.position.set(ROAD_X, ROAD_Y - 0.06, (CITY_ROAD_END + ISLAND_ROAD_END) / 2);
  roadSurf.receiveShadow = true;
  group.add(roadSurf);

  // -------------------------------------------------------------------------
  // Bridge — a Golden Gate–style suspension bridge carrying that roadway over
  // the water: International Orange towers flanking the deck, draped main cables
  // with vertical suspenders, and a structural deck body beneath the road. Built
  // at local x = 0 and shifted onto the road line (ROAD_X).
  // -------------------------------------------------------------------------
  const bridge = new THREE.Group();
  bridge.position.x = ROAD_X;
  group.add(bridge);

  const GG = 0xc4472e; // international orange
  const towerMat = new THREE.MeshToonMaterial({ color: GG, gradientMap });
  const cableMat = new THREE.MeshToonMaterial({ color: 0x9a3826, gradientMap });
  const deckMat = new THREE.MeshToonMaterial({ color: 0x565b60, gradientMap });

  const zStart = -210; // structural deck begins at the coast (land edge)
  const zEnd = -584;   // and lands on the island's grass
  const zc = (zStart + zEnd) / 2;
  const span = Math.abs(zStart - zEnd);
  const HALF_W = 7;    // towers / cables sit at x = ±7, just outside the 12-wide road
  const TOWER_TOP = 38;

  // Structural deck body, just beneath the road surface (which overlaps its top).
  const deck = new THREE.Mesh(new THREE.BoxGeometry(ROAD_W + 0.8, 0.9, span), deckMat);
  deck.position.set(0, ROAD_Y - 0.5, zc); // top ~0.0, road surface sits on it
  deck.castShadow = true;
  deck.receiveShadow = true;
  bridge.add(deck);
  // Orange railings running along the deck edges.
  for (const gx of [-ROAD_W / 2, ROAD_W / 2]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, span), towerMat);
    rail.position.set(gx, ROAD_Y + 0.5, zc);
    rail.castShadow = true;
    bridge.add(rail);
  }

  // Two towers (two legs braced by cross-beams) rising from the water.
  const towerZ = [zStart - span / 3, zStart - (2 * span) / 3];
  const legGeo = new THREE.BoxGeometry(2.4, TOWER_TOP - WATER_Y, 2.4);
  for (const tz of towerZ) {
    for (const tx of [-HALF_W, HALF_W]) {
      const leg = new THREE.Mesh(legGeo, towerMat);
      leg.position.set(tx, (TOWER_TOP + WATER_Y) / 2, tz);
      leg.castShadow = true;
      bridge.add(leg);
    }
    for (const by of [10, 26, TOWER_TOP - 1]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(HALF_W * 2 + 2.4, 1.8, 2.2), towerMat);
      brace.position.set(0, by, tz);
      brace.castShadow = true;
      bridge.add(brace);
    }
  }

  // Main cables draped over the towers with a mid-span sag, plus the vertical
  // suspender cables hanging down to the deck.
  const suspGeo = new THREE.CylinderGeometry(0.12, 0.12, 1, 5);
  for (const cx of [-HALF_W, HALF_W]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(cx, ROAD_Y + 2.5, zStart),
      new THREE.Vector3(cx, TOWER_TOP, towerZ[0]),
      new THREE.Vector3(cx, ROAD_Y + 14, zc),
      new THREE.Vector3(cx, TOWER_TOP, towerZ[1]),
      new THREE.Vector3(cx, ROAD_Y + 2.5, zEnd),
    ]);
    const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 90, 0.5, 6), cableMat);
    cable.castShadow = true;
    bridge.add(cable);

    const N = 34;
    for (let i = 1; i < N; i++) {
      const pt = curve.getPoint(i / N);
      const bottom = ROAD_Y + 0.6;
      if (pt.y - bottom < 0.6) continue;
      const susp = new THREE.Mesh(suspGeo, cableMat);
      susp.position.set(cx, (pt.y + bottom) / 2, pt.z);
      susp.scale.y = pt.y - bottom;
      bridge.add(susp);
    }
  }

  // -------------------------------------------------------------------------
  // Island — a low, flat green islet just above the water, dropped so its grass
  // surface sits at road grade: the roadway runs straight onto it. The whole
  // group is lowered by 1.95 (grass top 2.0 -> 0.05) so every part keeps its
  // relative shape; the grass disc is widened so it reaches the bridge landing.
  // -------------------------------------------------------------------------
  const island = new THREE.Group();
  island.position.set(ROAD_X, -1.95, -700);

  const sand = new THREE.Mesh(
    new THREE.CylinderGeometry(120, 135, 3.2, 28),
    new THREE.MeshToonMaterial({ color: 0xe3d2a0, gradientMap })
  );
  sand.position.y = -0.4;
  sand.receiveShadow = true;
  sand.castShadow = true;
  island.add(sand);

  const grassTop = new THREE.Mesh(
    new THREE.CylinderGeometry(110, 120, 2.0, 24), // widened so the road lands on grass
    new THREE.MeshToonMaterial({ color: 0x86c65a, gradientMap })
  );
  grassTop.position.y = 1.0;
  grassTop.receiveShadow = true;
  island.add(grassTop);

  const hill = new THREE.Mesh(
    new THREE.SphereGeometry(48, 16, 12),
    new THREE.MeshToonMaterial({ color: 0x7cbb52, gradientMap, flatShading: true })
  );
  hill.scale.set(1, 0.4, 1);
  hill.position.set(-52, 1.4, -46); // off to the side so it doesn't block the road
  hill.castShadow = true;
  hill.receiveShadow = true;
  island.add(hill);

  const trunkG = new THREE.CylinderGeometry(1.2, 1.6, 8, 6);
  const trunkM = new THREE.MeshToonMaterial({ color: 0x8a5a34, gradientMap, flatShading: true });
  const leafG = new THREE.ConeGeometry(7, 15, 7);
  const leafM = new THREE.MeshToonMaterial({ color: 0x4f9c3f, gradientMap, flatShading: true });
  // Trees kept off the road corridor (|x| > 12) so the roadway stays clear.
  const spots = [[42, -18], [62, 30], [-52, 38], [40, 62], [-30, -42], [78, -40]];
  for (const [tx, tz] of spots) {
    const tr = new THREE.Mesh(trunkG, trunkM);
    tr.position.set(tx, 6, tz);
    tr.castShadow = true;
    const lf = new THREE.Mesh(leafG, leafM);
    lf.position.set(tx, 14, tz);
    lf.castShadow = true;
    island.add(tr, lf);
  }
  group.add(island);

  return {
    group,
    water,
    ocean,
    oceanProxy,
    map: {
      beachHalf: 235, // beach plane is 470 wide
      bridge: { x: ROAD_X, z0: zStart, z1: zEnd, w: 14 },
      island: { x: ROAD_X, z: -700, r: 120 },
    },
  };
}
