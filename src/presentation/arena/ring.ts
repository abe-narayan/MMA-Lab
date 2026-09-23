/**
 * Boxing / kickboxing ring: raised platform, canvas and apron, four corner
 * posts with padded turnbuckle covers in corner colours (red, blue, two
 * neutral whites), four ropes per side with a slight sag and vinyl covers,
 * vertical rope ties, skirt and steps.
 *
 * Wall placement contract: each rope's inner surface lies on the sim's wall
 * plane |x| = halfWidthM or |z| = halfWidthM at its mid-span (the ropes sag
 * down, not in), so a fighter clamped by `clampToArena` touches the ropes.
 */
import * as THREE from 'three/webgpu';
import type { Arena } from '../../sim';
import {
  RING_APRON_M, RING_PLATFORM_M, RING_POST_INSET_M, ROPE_HEIGHTS_M, ROPE_RADIUS_M, wallInradius,
} from './geometry';
import { MergeBuilder, cylinderBetween, roundedBox, srgb, type RGB } from './merge';
import { floorExtent } from './textures';
import { polygonFloor } from './octagon';

export const ROPE_SAG_M = 0.035;

/** Rope centreline point at parameter t in [0, 1] along side `side` (0:+z, 1:+x, 2:-z, 3:-x), rope `i`. */
export function ropePoint(arena: Arena, side: number, i: number, t: number): [number, number, number] {
  const h = wallInradius(arena);
  const c = h + ROPE_RADIUS_M; // centre so the inner surface is on the plane
  // Ropes run corner to corner of the rope square (the posts sit just outside it).
  const along = -c + 2 * c * t;
  const sag = ROPE_SAG_M * (1 - (2 * t - 1) ** 2);
  const y = ROPE_HEIGHTS_M[i]! - sag;
  switch (side) {
    case 0: return [along, y, c];
    case 1: return [c, y, -along];
    case 2: return [-along, y, -c];
    default: return [-c, y, along];
  }
}

export interface RingParts {
  canvas: THREE.BufferGeometry;
  hardware: THREE.BufferGeometry;
  ropes: THREE.BufferGeometry;
  skirt: THREE.BufferGeometry;
  triangles: number;
}

export function buildRingParts(arena: Arena, red: string, blue: string): RingParts {
  const h = wallInradius(arena);
  const L = floorExtent(arena);
  const e = h + RING_APRON_M;
  const canvas = polygonFloor([[-e, e], [e, e], [e, -e], [-e, -e]], 0, L);
  const hw = new MergeBuilder();
  const post = h + RING_POST_INSET_M;
  const steel: RGB = srgb('#2a2c31');
  const white: RGB = srgb('#dcdcdc');
  const corners: [number, number, RGB][] = [
    [-post, post, srgb(red)], [post, post, white], [post, -post, srgb(blue)], [-post, -post, white],
  ];
  for (const [x, z, col] of corners) {
    hw.add(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 10), { x, y: 0.8, z }, steel);
    // Turnbuckle cover: tall padded cushion on the inside of the post, diagonal-facing.
    const pad = roundedBox(0.26, 1.2, 0.2, 0.07, 3);
    const ang = Math.atan2(-x, -z);
    hw.add(pad, { x: x - Math.sin(ang + Math.PI) * 0.12, y: 0.9, z: z - Math.cos(ang + Math.PI) * 0.12, ry: ang }, col);
    hw.add(new THREE.SphereGeometry(0.06, 10, 6), { x, y: 1.62, z }, steel);
  }
  // Rope ties: two vertical straps per side at the thirds.
  const tie: RGB = srgb('#1c1c20');
  for (let side = 0; side < 4; side++) {
    for (const t of [1 / 3, 2 / 3]) {
      const a = ropePoint(arena, side, 0, t);
      const b = ropePoint(arena, side, 3, t);
      const c = cylinderBetween(new THREE.Vector3(...a), new THREE.Vector3(...b), 0.012, 5);
      hw.add(c.geo, c.m, tie);
    }
  }
  // Ropes: tubes along the sagging centreline, vinyl covers.
  const ropes = new MergeBuilder();
  const ropeCols: RGB[] = [srgb('#e8e8ea'), srgb('#e8e8ea'), srgb('#e8e8ea'), srgb('#e8e8ea')];
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < 4; i++) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 16; k++) pts.push(new THREE.Vector3(...ropePoint(arena, side, i, k / 16)));
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.TubeGeometry(curve, 32, ROPE_RADIUS_M, 10, false);
      ropes.add(tube, null, ropeCols[i]!);
    }
  }
  // Skirt.
  const sk = new THREE.BoxGeometry(2 * e, RING_PLATFORM_M - 0.05, 2 * e, 1, 1, 1);
  sk.translate(0, -(RING_PLATFORM_M + 0.05) / 2, 0);
  // Keep only the side faces' uv so the LED board wraps around.
  const skirt = sk;
  // Apron bumper.
  const loop: [number, number][] = [[-e, e], [e, e], [e, -e], [-e, -e]];
  for (let k = 0; k < 4; k++) {
    const [ax, az] = loop[k]!;
    const [bx, bz] = loop[(k + 1) % 4]!;
    const c = cylinderBetween(new THREE.Vector3(ax, -0.03, az), new THREE.Vector3(bx, -0.03, bz), 0.06, 10);
    hw.add(c.geo, c.m, srgb('#16213a'));
  }
  const hardware = hw.build();
  const ropesG = ropes.build();
  return {
    canvas, hardware, ropes: ropesG, skirt,
    triangles: 4 + hw.triangles + ropes.triangles + 12,
  };
}
