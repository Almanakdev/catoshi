import * as THREE from 'three';
import { paint } from '../shops/common.js';

export { box, cyl, blob, merge, C } from '../shops/common.js';
export { paint };
export { instanced } from '../industrial/common.js';

const _UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();

// A coloured box "strut" of thickness `th` spanning (ax,ay,az)→(bx,by,bz).
// Used for the lattice legs + diagonal bracing on the towers and the monorail
// guideway, so arbitrary angled members are cheap to build and merge.
export function strut(ax, ay, az, bx, by, bz, th, color) {
  _dir.set(bx - ax, by - ay, bz - az);
  const len = _dir.length() || 0.001;
  const g = new THREE.BoxGeometry(th, len, th);
  _q.setFromUnitVectors(_UP, _dir.normalize());
  g.applyQuaternion(_q);
  g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  return paint(g, color);
}
