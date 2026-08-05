import * as THREE from 'three';
import { box, cyl, paint, merge, C } from './common.js';

// Stadium — a large oval arena: a green pitch inside a banked seating bowl and
// outer wall, ringed by tall floodlight towers whose lamp arrays glow at night.
export function buildStadium(mats) {
  const g = new THREE.Group();
  const SX = 1.4; // oval stretch along X
  const S = [];
  const oval = (rt, rb, h, y, color, open = true) => {
    const gg = new THREE.CylinderGeometry(rt, rb, h, 44, 1, open);
    gg.scale(SX, 1, 1);
    gg.translate(0, y, 0);
    return paint(gg, new THREE.Color(color));
  };
  // Foundation pad (extends into the water so nothing floats).
  const pad = new THREE.CylinderGeometry(38, 44, 6, 44);
  pad.scale(SX, 1, 1);
  pad.translate(0, -2, 0);
  S.push(paint(pad, new THREE.Color('#b0aa9a')));
  // Pitch.
  const field = new THREE.CylinderGeometry(26, 26, 0.5, 44);
  field.scale(SX, 1, 1);
  field.translate(0, 0.25, 0);
  S.push(paint(field, new THREE.Color('#4f9c4f')));
  // Banked seating bowl + outer wall + top rim.
  S.push(oval(34, 26.5, 15, 7.5, '#7d8a9a'));
  S.push(oval(36, 36, 16, 8, '#c9c3b4'));
  S.push(oval(37.5, 34, 2, 16.5, '#a9a294'));
  // Pitch markings.
  const cc = new THREE.TorusGeometry(5, 0.16, 6, 24);
  cc.rotateX(Math.PI / 2);
  cc.translate(0, 0.56, 0);
  S.push(paint(cc, new THREE.Color('#f4ecd8')));
  S.push(box(0.3, 0.05, 26, 0, 0.56, 0, '#f4ecd8'));
  const structMesh = new THREE.Mesh(merge(S), mats.structMat);
  structMesh.castShadow = structMesh.receiveShadow = true;
  g.add(structMesh);

  // Floodlight towers.
  const poles = [];
  const floods = [];
  const nT = 6;
  for (let i = 0; i < nT; i++) {
    const a = (i / nT) * Math.PI * 2 + Math.PI / nT;
    const x = Math.cos(a) * 40 * SX;
    const z = Math.sin(a) * 40;
    poles.push(cyl(0.5, 0.65, 27, 6, x, 13.5, z, '#8a8f96'));
    const yaw = Math.atan2(-x / SX, -z); // face the pitch
    floods.push(box(5.5, 2.6, 0.6, x, 26, z, '#fff6d8', [0, yaw, 0]));
  }
  g.add(new THREE.Mesh(merge(poles), mats.structMat));
  g.add(new THREE.Mesh(merge(floods), mats.glowMat)); // lights up at night
  return { group: g };
}
