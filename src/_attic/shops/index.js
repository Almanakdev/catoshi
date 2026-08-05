import * as THREE from 'three';
import { makeShopSign } from '../textures.js';
import { makeSmoke } from '../industrial/common.js';
import { buildRamenRestaurant } from './ramenRestaurant.js';
import { buildCafe } from './cafe.js';
import { buildBarber } from './barber.js';
import { buildSalon } from './salon.js';
import { buildFlorist } from './florist.js';
import { buildMinimarket } from './minimarket.js';
import { buildGasStation } from './gasStation.js';
import { buildCarWash } from './carWash.js';
import { buildFastFood } from './fastFood.js';
import { buildDiner } from './diner.js';
import { buildPub } from './pub.js';
import { buildBakery } from './bakery.js';
import { buildHospital } from './hospital.js';
import { buildPolice } from './police.js';
import { buildFire } from './fire.js';
import { buildBank } from './bank.js';
import { buildCinema } from './cinema.js';
import { buildArcade } from './arcade.js';
import { buildBowling } from './bowling.js';
import { buildGolfTennis } from './golfTennis.js';

// The shop registry. Each place has a `size` class that decides how much land
// it gets and how it's packed onto a block (see src/city.js):
//   large  — fills a whole block, one per block (low-to-mid civic/retail boxes)
//   medium — about half a block, two side by side per block
//   small  — a quarter block, 2–4 packed into one block, low and cosy
// `foot` is the type's natural footprint (matches each builder's collider) so
// the city can scale every instance to fill its lot. Colors/labels drive the
// signboard + minimap POI.
// `zone` places each type in a realistic ring of the city (see src/city.js):
//   downtown — the dense tall core: finance, entertainment, big civic/retail
//   inner    — mixed neighbourhood streets: small everyday shops
//   arterial — the edge + main roads: things needing road access + parking
export const SHOP_TYPES = [
  { key: 'restaurant', label: 'RAMEN', short: 'Ramen', icon: '🍜', awn: '#d94f4f', signBg: '#7a2c2c', build: buildRamenRestaurant, size: 'medium', zone: 'downtown', foot: { w: 9.2, d: 7.2 } },
  { key: 'cafe', label: 'CAFÉ', short: 'Café', icon: '☕', awn: '#a9713d', signBg: '#5f3d22', build: buildCafe, size: 'small', zone: 'inner', foot: { w: 7.7, d: 6.2 } },
  { key: 'barber', label: 'BARBER', short: 'Barber', icon: '💈', awn: '#3a6ea5', signBg: '#26456b', build: buildBarber, size: 'small', zone: 'inner', foot: { w: 7.2, d: 5.7 } },
  { key: 'salon', label: 'SALON', short: 'Salon', icon: '✂', awn: '#c86bd8', signBg: '#7d3f90', build: buildSalon, size: 'small', zone: 'inner', foot: { w: 7.7, d: 5.7 } },
  { key: 'florist', label: 'FLORIST', short: 'Florist', icon: '🌸', awn: '#4b9e5f', signBg: '#2f6640', build: buildFlorist, size: 'small', zone: 'inner', foot: { w: 7.2, d: 5.2 } },
  { key: 'minimarket', label: 'MINIMART', short: 'Mart', icon: '🛒', awn: '#f0913a', signBg: '#a85e17', build: buildMinimarket, size: 'large', zone: 'inner', foot: { w: 12.2, d: 6.2 } },
  { key: 'gas', label: 'GAS', short: 'Gas', icon: '⛽', awn: '#25a05a', signBg: '#17603a', build: buildGasStation, size: 'large', zone: 'arterial', foot: { w: 15.5, d: 12 } },
  { key: 'carwash', label: 'CAR WASH', short: 'Wash', icon: '🚿', awn: '#2f9ac8', signBg: '#1e5f8a', build: buildCarWash, size: 'large', zone: 'arterial', foot: { w: 9, d: 12 } },
  { key: 'fastfood', label: 'BURGERS', short: 'Burgers', icon: '🍔', awn: '#e23b3b', signBg: '#b81d1d', build: buildFastFood, size: 'large', zone: 'arterial', foot: { w: 9.4, d: 7.2 } },
  { key: 'diner', label: 'DINER', short: 'Diner', icon: '🥞', awn: '#d94f4f', signBg: '#22304f', build: buildDiner, size: 'medium', zone: 'arterial', foot: { w: 16.2, d: 6.2 } },
  { key: 'pub', label: 'PUB', short: 'Pub', icon: '🍺', awn: '#8a5a34', signBg: '#4a3320', build: buildPub, size: 'medium', zone: 'downtown', foot: { w: 7.7, d: 6.2 } },
  { key: 'bakery', label: 'BAKERY', short: 'Bakery', icon: '🥐', awn: '#e0913a', signBg: '#8a5220', build: buildBakery, size: 'small', zone: 'inner', foot: { w: 7.2, d: 5.7 } },
  { key: 'hospital', label: 'HOSPITAL', short: 'Hospital', icon: '🏥', awn: '#e23b3b', signBg: '#c22', build: buildHospital, size: 'large', zone: 'downtown', foot: { w: 17, d: 8.4 } },
  { key: 'police', label: 'POLICE', short: 'Police', icon: '🚓', awn: '#2f5aa8', signBg: '#22304f', build: buildPolice, size: 'large', zone: 'arterial', foot: { w: 12.2, d: 7.2 } },
  { key: 'fire', label: 'FIRE STATION', short: 'Fire', icon: '🚒', awn: '#d63a2a', signBg: '#8f2318', build: buildFire, size: 'large', zone: 'arterial', foot: { w: 15.5, d: 8.4 } },
  { key: 'bank', label: 'BANK', short: 'Bank', icon: '🏦', awn: '#3a8f5a', signBg: '#1f6640', build: buildBank, size: 'medium', zone: 'downtown', foot: { w: 13.2, d: 8.4 } },
  { key: 'cinema', label: 'CINEMA', short: 'Cinema', icon: '🎬', awn: '#c0392b', signBg: '#5a1f2a', build: buildCinema, size: 'large', zone: 'downtown', foot: { w: 15.2, d: 8.2 } },
  { key: 'arcade', label: 'ARCADE', short: 'Arcade', icon: '🕹', awn: '#8f5cff', signBg: '#241a44', build: buildArcade, size: 'medium', zone: 'downtown', foot: { w: 11.2, d: 7.2 } },
  { key: 'bowling', label: 'BOWLING', short: 'Bowling', icon: '🎳', awn: '#2f9aa0', signBg: '#1c5257', build: buildBowling, size: 'large', zone: 'downtown', foot: { w: 16.2, d: 8.2 } },
  { key: 'golf', label: 'SPORTS', short: 'Sports', icon: '⛳', awn: '#5aa85f', signBg: '#2f6640', build: buildGolfTennis, size: 'large', zone: 'arterial', foot: { w: 9.5, d: 12.4 } },
];

// Per-class scale clamp. A place is scaled to fill its lot (footprint = lot
// minus margin), but bounded so large civic boxes stay low-to-mid, and small
// shops stay small even when their quarter-lot is generous. The city varies the
// actual scale within [min,max] per instance so nothing looks uniform.
export const SIZE_SCALE = {
  large: { min: 1.2, max: 2.0, margin: 4 },
  medium: { min: 1.0, max: 1.55, margin: 3 },
  small: { min: 0.9, max: 1.3, margin: 3 },
};

// Rough silhouette height per class (× the instance scale) for the walk
// collider — only needs to be tall enough to block the player.
const SIZE_COLLIDER_H = { large: 9, medium: 6, small: 4.5 };

/**
 * Instantiate the shops from a placement list. Each type builds ONE canonical
 * geometry (structure + glow + sign), then all instances of that type share it
 * via InstancedMesh — so the whole high street is only a few dozen draw calls.
 *
 * placements: [{ x, z, yaw, typeIdx }]
 * opts: { gradientMap, group, colliders, buildingMats }
 * returns { pois }
 */
export function buildShops(placements, { gradientMap, group, colliders, buildingMats, stuccoTex }) {
  // vertexColors carry each shop's palette; the near-white stucco map only adds
  // soft painted surface grain (no colour shift).
  const structMat = new THREE.MeshToonMaterial({ vertexColors: true, map: stuccoTex, gradientMap });
  // Windows/signage: lit interior that warms up at night (ramped via buildingMats).
  const glowMat = new THREE.MeshToonMaterial({
    vertexColors: true,
    gradientMap,
    emissive: new THREE.Color(0xffd9a0),
    emissiveIntensity: 0,
    // The lit glow windows sit right on top of the structure glass/wall — bias
    // them toward the camera so they win the depth test cleanly (no z-fighting
    // streaks / flicker on the storefront glass).
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  buildingMats.push(glowMat);
  // Neon: always full-bright vertex colors (unlit), so colourful neon signs
  // read day and night and the bloom pass picks up the brightest tubes.
  const neonMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });

  const dummy = new THREE.Object3D();
  const localCenter = new THREE.Vector3();
  const pois = [];

  // Animated steam (e.g. the ramen pot). Collected here and driven each frame.
  const steamGroup = new THREE.Group();
  group.add(steamGroup);
  const steamUpdates = [];
  const _steamV = new THREE.Vector3();

  for (let ti = 0; ti < SHOP_TYPES.length; ti++) {
    const list = placements.filter((p) => p.typeIdx === ti);
    if (!list.length) continue;
    const type = SHOP_TYPES[ti];
    const built = type.build(); // canonical geometry for this type

    const sMesh = new THREE.InstancedMesh(built.structure, structMat, list.length);
    sMesh.castShadow = true;
    sMesh.receiveShadow = true;

    const gMesh = built.glow ? new THREE.InstancedMesh(built.glow, glowMat, list.length) : null;
    const nMesh = built.neon ? new THREE.InstancedMesh(built.neon, neonMat, list.length) : null;

    let signMesh = null;
    if (built.sign) {
      const tex = built.signTex || makeShopSign(type); // custom (e.g. vertical ramen) sign if provided
      const signMat = new THREE.MeshToonMaterial({
        map: tex,
        gradientMap,
        emissive: 0xffffff,
        emissiveMap: tex,
        emissiveIntensity: 0.5, // signs read as lit day and night
        side: THREE.DoubleSide,
      });
      const g = new THREE.PlaneGeometry(built.sign.w || 4, built.sign.h || 1.2);
      g.translate(built.sign.x, built.sign.y, built.sign.z + 0.02);
      signMesh = new THREE.InstancedMesh(g, signMat, list.length);
    }

    // Optional canvas-textured facade (civic buildings): a material-pattern +
    // window map on the main volume, with an emissive window map that lights up
    // at night (ramped via buildingMats, like the towers).
    let facadeMesh = null;
    if (built.facade && built.facadeTex) {
      const fMat = new THREE.MeshToonMaterial({
        map: built.facadeTex.map,
        emissiveMap: built.facadeTex.emissiveMap,
        emissive: 0xffffff,
        emissiveIntensity: 0,
        gradientMap,
      });
      buildingMats.push(fMat);
      facadeMesh = new THREE.InstancedMesh(built.facade, fMat, list.length);
      facadeMesh.castShadow = true;
      facadeMesh.receiveShadow = true;
    }

    const colH = SIZE_COLLIDER_H[type.size] || 6;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      // Each instance is scaled uniformly to fill its lot (the city computes the
      // fit factor per lot size). Uniform scale keeps the prefab's proportions —
      // no stretched props — while sizing the whole place to its land.
      const s = p.scale || 1;
      dummy.position.set(p.x, 0, p.z);
      dummy.rotation.set(0, p.yaw, 0);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      sMesh.setMatrixAt(i, dummy.matrix);
      if (gMesh) gMesh.setMatrixAt(i, dummy.matrix);
      if (nMesh) nMesh.setMatrixAt(i, dummy.matrix);
      if (signMesh) signMesh.setMatrixAt(i, dummy.matrix);
      if (facadeMesh) facadeMesh.setMatrixAt(i, dummy.matrix);

      // Collider from the builder's local box, scaled and transformed by the
      // (cardinal) yaw.
      const col = built.collider;
      localCenter.set(col.cx, 0, col.cz).applyMatrix4(dummy.matrix);
      const horiz = Math.abs(Math.sin(p.yaw)) > 0.5; // faces ±X → swap w/d
      const cw = ((horiz ? col.d : col.w) * s) / 2;
      const cd = ((horiz ? col.w : col.d) * s) / 2;
      colliders.push(
        new THREE.Box3(
          new THREE.Vector3(localCenter.x - cw, 0, localCenter.z - cd),
          new THREE.Vector3(localCenter.x + cw, colH * s, localCenter.z + cd)
        )
      );

      pois.push({ x: p.x, z: p.z, label: type.label, short: type.short, color: type.awn });

      // A steam column rising from this instance's pot (world-space, per instance).
      if (built.steamAnchor) {
        _steamV.set(built.steamAnchor.x, built.steamAnchor.y, built.steamAnchor.z).applyMatrix4(dummy.matrix);
        const sm = makeSmoke({
          x: _steamV.x, y: _steamV.y, z: _steamV.z,
          count: 4, rise: 3.2 * s, drift: 0.4, driftZ: 0.25,
          size: 0.5 * s, grow: 0.85 * s, color: '#efe7d6', speed: 0.24, opacity: 0.5,
        });
        steamGroup.add(sm.group);
        steamUpdates.push(sm.update);
      }
    }

    sMesh.instanceMatrix.needsUpdate = true;
    group.add(sMesh);
    if (gMesh) {
      gMesh.instanceMatrix.needsUpdate = true;
      group.add(gMesh);
    }
    if (nMesh) {
      nMesh.instanceMatrix.needsUpdate = true;
      group.add(nMesh);
    }
    if (signMesh) {
      signMesh.instanceMatrix.needsUpdate = true;
      group.add(signMesh);
    }
    if (facadeMesh) {
      facadeMesh.instanceMatrix.needsUpdate = true;
      group.add(facadeMesh);
    }
  }

  return {
    pois,
    steamGroup, // hidden from the outline/AO prepass by main.js
    update: (dt) => { for (let k = 0; k < steamUpdates.length; k++) steamUpdates[k](dt); },
  };
}
