import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Shared helpers for the modular shop builders. Every builder assembles a few
// primitives — coloured per-vertex — and merges them into ONE geometry, so a
// whole shop type is a single instanced draw call. Builders face +Z (the
// street side); props/forecourts extend toward +Z.

// Bake a flat vertex color onto a geometry so many parts can share one
// vertexColors material (and merge into one buffer).
export function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function applyRot(g, rot) {
  if (!rot) return g;
  if (rot[0]) g.rotateX(rot[0]);
  if (rot[1]) g.rotateY(rot[1]);
  if (rot[2]) g.rotateZ(rot[2]);
  return g;
}

/** Coloured box at (x,y,z), optional [rx,ry,rz] rotation applied before move. */
export function box(w, h, d, x, y, z, color, rot) {
  const g = applyRot(new THREE.BoxGeometry(w, h, d), rot);
  g.translate(x, y, z);
  return paint(g, color);
}

/** Coloured cylinder / cone (rTop=0 → cone) at (x,y,z). */
export function cyl(rTop, rBot, h, seg, x, y, z, color, rot) {
  const g = applyRot(new THREE.CylinderGeometry(rTop, rBot, h, seg), rot);
  g.translate(x, y, z);
  return paint(g, color);
}

/** Coloured low-poly blob (for foliage / bushes / flowers). */
export function blob(r, x, y, z, color) {
  const g = new THREE.IcosahedronGeometry(r, 0);
  g.translate(x, y, z);
  return paint(g, color);
}

/** A simple low-poly car at (x,z) facing +Z. Returns an array of geometries. */
export function car(x, z, bodyColor, opts = {}) {
  const { cabin = bodyColor, w = 2, len = 4, glass = C.glass } = opts;
  const parts = [
    box(w, 0.9, len, x, 0.75, z, bodyColor),                  // lower body
    box(w * 0.9, 0.8, len * 0.5, x, 1.5, z - 0.15, cabin),    // cabin
    box(w * 0.68, 0.55, len * 0.46, x, 1.55, z - 0.15, glass),// windows
  ];
  for (const wz of [len * 0.3, -len * 0.3]) {
    for (const wx of [w * 0.5, -w * 0.5]) {
      parts.push(cyl(0.34, 0.34, 0.24, 10, x + wx, 0.34, z + wz, C.black, [0, 0, Math.PI / 2]));
    }
  }
  return parts;
}

export function merge(parts) {
  // mergeGeometries() fails (returns null) if some inputs are indexed and some
  // aren't — Box/Cylinder are indexed but Icosahedron (blob) is not. Normalize
  // everything to non-indexed first so any mix merges cleanly.
  const geos = parts.filter(Boolean).map((g) => (g.index ? g.toNonIndexed() : g));
  return mergeGeometries(geos);
}

// Warm cartoon palette, matching the scene's toon grade.
export const C = {
  cream: '#f2e0bd', sand: '#e6cf9e', warm: '#efc79a', tan: '#e8d3a0',
  red: '#d94f4f', redDark: '#8f2f2f', terracotta: '#c05a44',
  teal: '#2f9aa0', tealDark: '#1e5f8a', blue: '#5a92c8', blueLight: '#cfe0ef', navy: '#274b6b',
  pink: '#e58fce', pinkLight: '#f6cbe6', purple: '#9a55b0',
  green: '#5aa85f', greenDark: '#2f6640', leaf: '#6fae4e',
  orange: '#f0913a', orangeDark: '#c46a15', yellow: '#f4d774',
  wood: '#8a5a34', woodDark: '#5b4a3a',
  glass: '#bfe0ef', glassWarm: '#ffe6ad',
  metal: '#9aa0a6', metalDark: '#565b60', steel: '#b8c0c6',
  concrete: '#c9c3b4', concreteDark: '#a9a294',
  white: '#f4ecd8', black: '#2b2b2b', grey: '#7d7f83',
};
