/**
 * Cageside set dressing: judges' tables with monitors, the press row with
 * laptops, corner stools and buckets, camera operators on the apron, a
 * cageside commentary desk, and stairs at the gates. Everything lit shares one
 * merged vertex-coloured mesh; everything that glows shares one more.
 */
import * as THREE from 'three/webgpu';
import type { Arena } from '../../sim';
import { MergeBuilder, cylinderBetween, roundedBox, srgb, type RGB } from './merge';
import { addStairs } from './octagon';
import { mulberry32 } from './rng';

const SKIN: RGB[] = ['#e0ac85', '#c68a62', '#a86b45', '#f1c7a5', '#8a5234'].map(srgb);

/** A static low-poly person. `pose` seated (at a table) or standing. Faces +z before `ry`. */
export function addPerson(
  mb: MergeBuilder, x: number, y: number, z: number, ry: number, pose: 'seated' | 'standing',
  shirt: RGB, skin: RGB, trousers: RGB = srgb('#15161a'),
): void {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const put = (g: THREE.BufferGeometry, lx: number, ly: number, lz: number, col: RGB, rx = 0) => {
    mb.add(g, { x: x + lx * c + lz * s, y: y + ly, z: z - lx * s + lz * c, ry, rx }, col);
  };
  const hip = pose === 'seated' ? 0.47 : 0.95;
  if (pose === 'seated') {
    put(new THREE.BoxGeometry(0.36, 0.14, 0.44), 0, hip - 0.03, 0.14, trousers);
    put(new THREE.BoxGeometry(0.3, 0.46, 0.12), 0, 0.23, 0.34, trousers);
  } else {
    put(new THREE.BoxGeometry(0.14, hip, 0.16), -0.1, hip / 2, 0, trousers);
    put(new THREE.BoxGeometry(0.14, hip, 0.16), 0.1, hip / 2, 0, trousers);
  }
  const torso = roundedBox(0.4, 0.56, 0.24, 0.07, 2);
  put(torso, 0, hip + 0.29, 0, shirt);
  const head = new THREE.IcosahedronGeometry(0.105, 1);
  head.scale(0.92, 1.12, 1);
  put(head, 0, hip + 0.72, 0.01, skin);
  const hair = new THREE.SphereGeometry(0.108, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  put(hair, 0, hip + 0.745, -0.005, srgb('#1c140e'));
  for (const sx of [-0.235, 0.235]) {
    const arm = roundedBox(0.09, 0.52, 0.1, 0.035, 1);
    put(arm, sx, hip + 0.3, pose === 'seated' ? 0.12 : 0.0, shirt, pose === 'seated' ? -0.6 : 0);
  }
}

export interface Dressing {
  lit: THREE.BufferGeometry;
  glow: THREE.BufferGeometry;
  triangles: number;
}

/**
 * Props around a stage whose outer edge (apron) is `stageR` from the centre and
 * whose floor is at `floorY`. `kind` picks cage or ring specifics.
 */
export function buildCagesideDressing(
  arena: Arena, kind: 'octagon' | 'ring', stageR: number, floorY: number, seed: number,
  cornerRed: string, cornerBlue: string, gateAngles: readonly number[],
): Dressing {
  const lit = new MergeBuilder();
  const glow = new MergeBuilder();
  const rnd = mulberry32(seed);
  const cloth: RGB = srgb('#0d0d10');
  const chrome: RGB = srgb('#2a2b30');
  const darkSuit: RGB = srgb('#15171c');
  const shirts: RGB[] = ['#1a1c22', '#23252c', '#101114', '#2b2e36', '#e6e4de', '#3a3d44'].map(srgb);
  const skin = () => SKIN[Math.floor(rnd() * SKIN.length)]!;
  const shirt = () => shirts[Math.floor(rnd() * shirts.length)]!;

  const table = (cx: number, cz: number, ang: number, width: number, seats: number, screens: 'monitor' | 'laptop') => {
    // Table faces the stage: local +z points to the centre.
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const at = (lx: number, lz: number) => [cx + lx * c + lz * s, cz - lx * s + lz * c] as const;
    const top = new THREE.BoxGeometry(width, 0.05, 0.75);
    lit.add(top, { x: cx, y: floorY + 0.74, z: cz, ry: ang }, cloth);
    const skirt = new THREE.BoxGeometry(width, 0.7, 0.03);
    const [sx, sz] = at(0, 0.36);
    lit.add(skirt, { x: sx, y: floorY + 0.37, z: sz, ry: ang }, srgb('#0a0a0c'));
    for (let i = 0; i < seats; i++) {
      const lx = (i + 0.5 - seats / 2) * (width / seats);
      const [px, pz] = at(lx, -0.55);
      addPerson(lit, px, floorY, pz, ang, 'seated', i % 3 === 0 ? darkSuit : shirt(), skin());
      // Screen on the table in front of each seat.
      const [mx, mz] = at(lx, screens === 'monitor' ? 0.05 : -0.05);
      if (screens === 'monitor') {
        lit.add(new THREE.BoxGeometry(0.5, 0.32, 0.04), { x: mx, y: floorY + 0.97, z: mz, ry: ang }, chrome);
        lit.add(new THREE.BoxGeometry(0.05, 0.18, 0.05), { x: mx, y: floorY + 0.84, z: mz, ry: ang }, chrome);
        const [gx, gz] = at(lx, 0.05 - 0.025);
        const scr = new THREE.PlaneGeometry(0.46, 0.28);
        glow.add(scr, { x: gx, y: floorY + 0.97, z: gz, ry: ang + Math.PI }, srgb(i % 2 ? '#5c86c9' : '#8fb0e0'));
      } else {
        lit.add(new THREE.BoxGeometry(0.34, 0.015, 0.24), { x: mx, y: floorY + 0.775, z: mz, ry: ang }, chrome);
        const [gx, gz] = at(lx, 0.07);
        const scr = new THREE.PlaneGeometry(0.32, 0.2);
        glow.add(scr, { x: gx, y: floorY + 0.88, z: gz, ry: ang + Math.PI, rx: -0.25 }, srgb('#a8c0e8'));
      }
    }
  };

  // Directions: the stage is viewed by the hard camera from +z. Judges sit on
  // three sides, the press row on the far side, commentary desk near +x.
  const ring = stageR + 1.35;
  const inward = (a: number) => a + Math.PI; // ry so local +z faces the centre
  table(Math.sin(Math.PI / 2) * ring, Math.cos(Math.PI / 2) * ring, inward(Math.PI / 2), 1.3, 2, 'monitor');
  table(Math.sin(-Math.PI / 2) * ring, Math.cos(-Math.PI / 2) * ring, inward(-Math.PI / 2), 1.3, 2, 'monitor');
  table(Math.sin(Math.PI) * ring, Math.cos(Math.PI) * ring, inward(Math.PI), 1.3, 2, 'monitor');
  // Press row: two long tables behind the far judge.
  for (const off of [-3.2, 3.2]) {
    const a = Math.PI + off / (ring + 1.2);
    table(Math.sin(a) * (ring + 1.2), Math.cos(a) * (ring + 1.2), inward(a), 2.6, 4, 'laptop');
  }
  // Commentary desk on the hard-camera side, off-axis.
  const ca = Math.PI * 0.72;
  table(Math.sin(ca) * (ring + 0.3), Math.cos(ca) * (ring + 0.3), inward(ca), 2.0, 3, 'monitor');

  // Corner stools and buckets at the red and blue corners, on the floor by the stage.
  const corners = kind === 'octagon' ? [[-1, 0, cornerRed], [1, 0, cornerBlue]] : [[-0.707, 0.707, cornerRed], [0.707, -0.707, cornerBlue]];
  for (const [dx, dz, col] of corners as [number, number, string][]) {
    const bx = dx * (stageR + 0.8);
    const bz = dz * (stageR + 0.8);
    const stool = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 14);
    lit.add(stool, { x: bx, y: floorY + 0.55, z: bz }, srgb('#1a1a1c'));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const leg = cylinderBetween(
        new THREE.Vector3(bx + Math.sin(a) * 0.15, floorY + 0.55, bz + Math.cos(a) * 0.15),
        new THREE.Vector3(bx + Math.sin(a) * 0.22, floorY, bz + Math.cos(a) * 0.22), 0.015, 5,
      );
      lit.add(leg.geo, leg.m, chrome);
    }
    const bucket = new THREE.CylinderGeometry(0.16, 0.13, 0.32, 14, 1, false);
    lit.add(bucket, { x: bx + 0.45, y: floorY + 0.16, z: bz + 0.2 }, srgb(col));
    const bottle = new THREE.CylinderGeometry(0.035, 0.035, 0.24, 8);
    lit.add(bottle, { x: bx + 0.4, y: floorY + 0.44, z: bz + 0.2 }, srgb('#d0d8e0'));
    // Cornermen standing behind.
    addPerson(lit, bx + dx * 0.9, floorY, bz + dz * 0.9, Math.atan2(-dx, -dz), 'standing', srgb(col), skin());
    addPerson(lit, bx + dx * 0.9 + dz * 0.8, floorY, bz + dz * 0.9 - dx * 0.8, Math.atan2(-dx, -dz), 'standing', srgb('#141418'), skin());
  }

  // Camera operators on the apron (octagon) / at ringside, shooting in.
  // On the flats either side of the hard camera's axis (+z), never on it.
  const camAngles = kind === 'octagon'
    ? [67.5, 112.5, 247.5, 292.5].map((d) => (d * Math.PI) / 180)
    : [Math.PI * 0.5 + 0.35, Math.PI * 0.5 - 0.35, -Math.PI * 0.5 + 0.35, -Math.PI * 0.5 - 0.35];
  const opR = kind === 'octagon' ? stageR - 0.45 : stageR + 0.7;
  const opY = kind === 'octagon' ? 0 : floorY;
  for (const a of camAngles) {
    const x = Math.sin(a) * opR;
    const z = Math.cos(a) * opR;
    const ry = Math.atan2(-x, -z);
    addPerson(lit, x, opY, z, ry, 'standing', srgb('#0f0f12'), skin());
    // Shoulder camera: body, lens, viewfinder.
    const hx = x + Math.sin(ry) * 0.15 + Math.cos(ry) * 0.2;
    const hz = z + Math.cos(ry) * 0.15 - Math.sin(ry) * 0.2;
    lit.add(new THREE.BoxGeometry(0.14, 0.2, 0.44), { x: hx, y: opY + 1.62, z: hz, ry }, srgb('#1e1f22'));
    const lens = new THREE.CylinderGeometry(0.06, 0.07, 0.22, 10);
    lens.rotateX(Math.PI / 2);
    lit.add(lens, { x: hx + Math.sin(ry) * 0.3, y: opY + 1.62, z: hz + Math.cos(ry) * 0.3, ry }, srgb('#0a0a0b'));
    // Tally light.
    glow.add(new THREE.BoxGeometry(0.03, 0.02, 0.03), { x: hx, y: opY + 1.74, z: hz, ry }, srgb('#ff2020'));
  }

  // Stairs at the gates.
  for (const a of gateAngles) {
    addStairs(lit, Math.sin(a) * (stageR + 0.02), Math.cos(a) * (stageR + 0.02), a, -floorY, srgb('#121214'));
  }

  // Barrier between cageside and the floor seats: low black wall with an LED strip.
  void arena;
  return { lit: lit.build(), glow: glow.build(), triangles: lit.triangles + glow.triangles };
}
