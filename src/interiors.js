import * as THREE from 'three';
import { box, cyl, blob, merge, C } from './shops/common.js';

// Small enterable interior rooms — one per enterable shop type. Each is an
// inverted BackSide "box" shell (so the follow-camera never gets occluded from
// outside) plus a wood floor, warm self-lit surfaces, a couple of ceiling lamps,
// a marked EXIT door, and basic props for that shop. All rooms sit at the origin
// and only one is shown at a time. createInteriors() → { group, rooms }.
//
// rooms[type] = { group, entrance:Vector3, entranceYaw, exitZone:{x,z}, colliders:[Box3] }.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Box = (a, b) => new THREE.Box3(a, b);

export function createInteriors(gradientMap) {
  const group = new THREE.Group();

  // Warm, self-lit materials so the rooms read as "lit" day and night without
  // adding real lights (keeps the scene's light budget + shader unchanged).
  const shellMat = new THREE.MeshToonMaterial({
    color: 0xe9ddc8, gradientMap, side: THREE.BackSide,
    emissive: new THREE.Color(0xffe6c2), emissiveIntensity: 0.4,
  });
  const propMat = new THREE.MeshToonMaterial({
    vertexColors: true, gradientMap, emissive: new THREE.Color(0xffe0bc), emissiveIntensity: 0.16,
  });
  const lampMat = new THREE.MeshToonMaterial({ color: 0xfff2d0, emissive: new THREE.Color(0xfff0cf), emissiveIntensity: 0.9 });
  const signMat = new THREE.MeshToonMaterial({ color: 0x0f3a22, emissive: new THREE.Color(0x2fd06a), emissiveIntensity: 0.8 });
  const floorMat = (c) => new THREE.MeshToonMaterial({ color: c, gradientMap, emissive: new THREE.Color(c), emissiveIntensity: 0.22 });

  const W = 16, H = 4.4, D = 13;

  function wallColliders() {
    const t = 2;
    return [
      Box(V(-W / 2, 0, -D / 2 - t), V(W / 2, H, -D / 2)),  // back (-Z)
      Box(V(-W / 2, 0, D / 2), V(W / 2, H, D / 2 + t)),    // front (+Z)
      Box(V(-W / 2 - t, 0, -D / 2), V(-W / 2, H, D / 2)),  // left (-X)
      Box(V(W / 2, 0, -D / 2), V(W / 2 + t, H, D / 2)),    // right (+X)
    ];
  }

  function buildRoom(floorColor, propsFn) {
    const g = new THREE.Group();
    // Shell (inverted box): visible from inside, see-through from outside.
    const shell = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), shellMat);
    shell.position.y = H / 2;
    g.add(shell);
    // Wood/tile floor overlay.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat(floorColor));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.02;
    floor.receiveShadow = true;
    g.add(floor);
    // Ceiling lamps.
    for (const lx of [-4.5, 4.5]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.2, 2.6), lampMat);
      lamp.position.set(lx, H - 0.16, 0);
      g.add(lamp);
    }
    // EXIT door + sign on the -Z wall.
    const dz = -D / 2 + 0.05;
    g.add(new THREE.Mesh(merge([
      box(2.4, 3.0, 0.16, 0, 1.5, dz, C.woodDark),
      box(2.8, 0.26, 0.24, 0, 3.18, dz, C.wood),
      box(0.2, 0.4, 0.2, 0.85, 1.5, dz + 0.1, C.metal), // handle
    ]), propMat));
    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 0.08), signMat);
    sign.position.set(0, 3.55, dz + 0.05);
    g.add(sign);

    const colliders = wallColliders();
    propsFn(g, colliders);
    group.add(g);
    return {
      group: g,
      entrance: V(0, 0, -1),
      entranceYaw: 0, // face +Z, into the room
      exitZone: { x: 0, z: -D / 2 + 1.8 },
      colliders,
    };
  }

  // ---- Props per shop type -------------------------------------------------
  function restaurant(g, col) {
    // Bar / kitchen pass along the back (+Z) wall.
    g.add(new THREE.Mesh(merge([
      box(11, 1.1, 1.3, 0, 0.55, 4.7, C.wood),
      box(11.2, 0.16, 1.45, 0, 1.18, 4.7, C.woodDark),
      box(11, 1.8, 0.3, 0, 2.0, 5.4, '#5a3a22'),          // back shelf
    ]), propMat));
    col.push(Box(V(-5.5, 0, 3.9), V(5.5, 2, 5.4)));
    for (let i = 0; i < 6; i++) g.add(new THREE.Mesh(merge([blob(0.22, -4 + i * 1.6, 2.2, 5.35, i % 2 ? '#d94f4f' : '#f4d774')]), propMat));
    // Dining tables + chairs.
    for (const [tx, tz] of [[-4.2, -1], [4.2, -1], [-4.2, 2.3], [4.2, 2.3]]) {
      g.add(new THREE.Mesh(merge([
        cyl(0.15, 0.15, 0.9, 8, tx, 0.45, tz, C.metalDark),
        cyl(0.95, 0.95, 0.12, 14, tx, 0.92, tz, C.cream),
        box(0.6, 0.5, 0.6, tx - 1.35, 0.28, tz, C.woodDark),
        box(0.6, 1.0, 0.14, tx - 1.62, 0.72, tz, C.woodDark),
        box(0.6, 0.5, 0.6, tx + 1.35, 0.28, tz, C.woodDark),
        box(0.6, 1.0, 0.14, tx + 1.62, 0.72, tz, C.woodDark),
        blob(0.3, tx, 1.05, tz, '#f2e0bd'),                // a plate of food
        cyl(0.06, 0.06, 0.5, 6, tx + 0.4, 1.2, tz, '#e05a6f'), // a flower in a vase
      ]), propMat));
    }
  }

  function minimarket(g, col) {
    // Shelf aisles down the middle.
    const shelfCols = ['#e05a6f', '#f2c14e', '#4bb39a', '#8f6fd0', '#ef5f5f', '#f0913a'];
    for (const ax of [-3.2, 3.2]) {
      const parts = [box(3.4, 2.2, 1.2, ax, 1.1, 0.5, C.steel)];
      let k = 0;
      for (const sy of [0.7, 1.35, 2.0]) for (const sz of [-0.1, 1.1]) for (let c = 0; c < 4; c++)
        parts.push(box(0.7, 0.5, 0.5, ax - 1.3 + c * 0.85, sy, sz, shelfCols[k++ % shelfCols.length]));
      g.add(new THREE.Mesh(merge(parts), propMat));
      col.push(Box(V(ax - 1.7, 0, -0.1), V(ax + 1.7, 2, 1.1)));
    }
    // Chiller cabinet along the back wall.
    g.add(new THREE.Mesh(merge([
      box(11, 2.6, 1.1, 0, 1.3, 5.0, C.metalDark),
      box(10.6, 2.2, 0.1, 0, 1.4, 4.45, C.glassWarm),
    ]), propMat));
    col.push(Box(V(-5.5, 0, 4.4), V(5.5, 2.2, 5.5)));
    // Checkout counter near the entrance.
    g.add(new THREE.Mesh(merge([
      box(2.6, 1.0, 1.4, -5, 0.5, -2.6, C.wood),
      box(2.7, 0.14, 1.5, -5, 1.05, -2.6, C.woodDark),
      box(0.7, 0.4, 0.5, -5, 1.3, -2.6, C.black),          // register
    ]), propMat));
    col.push(Box(V(-6.3, 0, -3.3), V(-3.7, 1.3, -1.9)));
  }

  function cafe(g, col) {
    // Coffee bar + espresso machine at the back.
    g.add(new THREE.Mesh(merge([
      box(8, 1.1, 1.4, 0, 0.55, 4.6, C.wood),
      box(8.2, 0.16, 1.5, 0, 1.18, 4.6, '#3a2a1a'),
      box(1.6, 0.9, 0.9, -1.5, 1.65, 4.6, C.steel),        // espresso machine
      box(0.5, 0.5, 0.5, 1.8, 1.45, 4.6, '#d9743a'),       // grinder
      box(3.4, 1.4, 0.14, 0, 3.0, 5.35, C.black),          // chalkboard menu
    ]), propMat));
    col.push(Box(V(-4, 0, 3.9), V(4, 2, 5.35)));
    for (let i = 0; i < 5; i++) g.add(new THREE.Mesh(merge([box(0.28, 0.34, 0.28, -3 + i * 0.7, 1.35, 4.6, C.cream)]), propMat));
    // A few bistro tables.
    for (const [tx, tz] of [[-3.5, 0.5], [3.5, 0.5], [0, -2.2]]) {
      g.add(new THREE.Mesh(merge([
        cyl(0.12, 0.12, 0.85, 8, tx, 0.42, tz, C.metalDark),
        cyl(0.7, 0.7, 0.12, 14, tx, 0.86, tz, C.white),
        cyl(0.35, 0.35, 0.1, 8, tx - 0.9, 0.55, tz, C.terracotta),
        cyl(0.05, 0.05, 0.55, 6, tx - 0.9, 0.28, tz, C.metalDark),
        cyl(0.35, 0.35, 0.1, 8, tx + 0.9, 0.55, tz, C.terracotta),
        cyl(0.05, 0.05, 0.55, 6, tx + 0.9, 0.28, tz, C.metalDark),
        cyl(0.13, 0.11, 0.14, 8, tx, 0.99, tz, C.white),   // a coffee cup
      ]), propMat));
    }
  }

  const rooms = {
    restaurant: buildRoom(0x8a5a34, restaurant),
    minimarket: buildRoom(0xb8b0a0, minimarket),
    cafe: buildRoom(0x9a6b43, cafe),
  };
  for (const k in rooms) rooms[k].group.visible = false;

  return { group, rooms };
}
