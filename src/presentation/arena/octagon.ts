/**
 * The cage: raised octagonal platform, canvas and apron, eight padded posts,
 * chain-link fence panels exactly on the sim's wall planes, padded top rail and
 * bottom edge, two gates, apron bumper and LED skirt.
 *
 * Wall placement contract (tests/presentation.arena.test.ts): the fence panel's
 * inner face lies on the edge plane `apothemM` from the centre — where
 * `distanceToWall` is zero and where `clampToArena` stops a fighter's centre
 * (minus his body margin).
 */
import * as THREE from 'three/webgpu';
import type { Arena } from '../../sim';
import {
  FENCE_HEIGHT_M, TOP_RAIL_R, OCTAGON_APRON_M, OCTAGON_PLATFORM_M, wallSegments, wallLoop, wallInradius,
} from './geometry';
import { MergeBuilder, cylinderBetween, roundedBox, srgb, type RGB } from './merge';
import { floorExtent, floorUV } from './textures';

export const FENCE_BOTTOM_M = 0.17;

/** Fence panels: one quad per side, uv = (metres along, metres up), plus `alongDir`. */
export function buildFenceGeometry(arena: Arena): THREE.BufferGeometry {
  const segs = wallSegments(arena);
  const pos: number[] = [];
  const nrm: number[] = [];
  const uvs: number[] = [];
  const along: number[] = [];
  const idx: number[] = [];
  let v = 0;
  const y0 = FENCE_BOTTOM_M;
  const y1 = FENCE_HEIGHT_M;
  for (const s of segs) {
    const ux = (s.bx - s.ax) / s.length;
    const uz = (s.bz - s.az) / s.length;
    pos.push(s.ax, y0, s.az, s.bx, y0, s.bz, s.bx, y1, s.bz, s.ax, y1, s.az);
    for (let i = 0; i < 4; i++) { nrm.push(-s.nx, 0, -s.nz); along.push(ux, 0, uz); }
    uvs.push(0, y0, s.length, y0, s.length, y1, 0, y1);
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    v += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('alongDir', new THREE.Float32BufferAttribute(along, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Flat polygon (fan) at height y with floor UVs for extent L. */
export function polygonFloor(loop: [number, number][], y: number, L: number): THREE.BufferGeometry {
  const pos: number[] = [0, y, 0];
  const uvs: number[] = [...floorUV(0, 0, L)];
  for (const [x, z] of loop) { pos.push(x, y, z); uvs.push(...floorUV(x, z, L)); }
  const idx: number[] = [];
  const n = loop.length;
  // Wind so the face points up (+y) for loops ordered like wallLoop().
  for (let i = 0; i < n; i++) idx.push(0, 1 + i, 1 + ((i + 1) % n));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array((n + 1) * 3).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** A loop scaled so its edges sit `inradius + off` from the centre. */
export function grow(loop: [number, number][], inradius: number, off: number): [number, number][] {
  const s = (inradius + off) / inradius;
  return loop.map(([x, z]) => [x * s, z * s]);
}

export interface OctagonParts {
  canvas: THREE.BufferGeometry;
  fence: THREE.BufferGeometry;
  /** Posts, pads, rails, gates, bumper: vinyl, vertex coloured. */
  hardware: THREE.BufferGeometry;
  /** Platform skirt (LED boards), uv u = metres around, v 0..1. */
  skirt: THREE.BufferGeometry;
  triangles: number;
}

export function buildOctagonParts(arena: Arena, cornerRed: string, cornerBlue: string): OctagonParts {
  const a = wallInradius(arena);
  const loop = wallLoop(arena);
  const n = loop.length;
  const L = floorExtent(arena);
  const apronLoop = grow(loop, a, OCTAGON_APRON_M);
  const canvas = polygonFloor(apronLoop, 0, L);

  const hw = new MergeBuilder();
  const black: RGB = srgb('#101012');
  const blackPad: RGB = srgb('#141417');
  const metal: RGB = srgb('#1c1c1f');
  const red: RGB = srgb(cornerRed);
  const blue: RGB = srgb(cornerBlue);
  const R = a / Math.cos(Math.PI / n);

  // Posts at the vertices: a steel post just outside the vertex, wrapped in a
  // tall padded cushion that faces the inside of the cage.
  for (let k = 0; k < n; k++) {
    const [vx, vz] = loop[k]!;
    const ang = Math.atan2(vx, vz);
    const dx = Math.sin(ang);
    const dz = Math.cos(ang);
    const post = new THREE.CylinderGeometry(0.055, 0.055, FENCE_HEIGHT_M + 0.2, 10);
    hw.add(post, { x: dx * (R + 0.09), y: (FENCE_HEIGHT_M + 0.2) / 2, z: dz * (R + 0.09) }, metal);
    const pad = roundedBox(0.3, FENCE_HEIGHT_M + 0.12, 0.2, 0.07, 3);
    hw.add(pad, { x: dx * (R + 0.04), y: (FENCE_HEIGHT_M + 0.12) / 2, z: dz * (R + 0.04), ry: ang }, blackPad);
    // Rounded cap; corner colour on the red and blue posts.
    const cap = new THREE.SphereGeometry(0.16, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, 0.7, 1);
    const capCol = k === 6 ? red : k === 2 ? blue : blackPad;
    hw.add(cap, { x: dx * (R + 0.05), y: FENCE_HEIGHT_M + 0.13, z: dz * (R + 0.05) }, capCol);
    // Corner colour band on the pad.
    if (k === 6 || k === 2) {
      const band = roundedBox(0.31, 0.22, 0.21, 0.05, 2);
      hw.add(band, { x: dx * (R + 0.04), y: FENCE_HEIGHT_M - 0.05, z: dz * (R + 0.04), ry: ang }, k === 6 ? red : blue);
    }
  }

  // Top rail and bottom edge along each side.
  for (const s of wallSegments(arena)) {
    const ya = FENCE_HEIGHT_M + TOP_RAIL_R * 0.6;
    const out = 0.02;
    const rail = cylinderBetween(
      new THREE.Vector3(s.ax + s.nx * out, ya, s.az + s.nz * out),
      new THREE.Vector3(s.bx + s.nx * out, ya, s.bz + s.nz * out), TOP_RAIL_R, 14,
    );
    // Close the tube ends (the post caps hide them anyway).
    hw.add(rail.geo, rail.m, black);
    const ang = Math.atan2(s.nx, s.nz);
    const mx = (s.ax + s.bx) / 2;
    const mz = (s.az + s.bz) / 2;
    const bottom = roundedBox(s.length - 0.2, FENCE_BOTTOM_M + 0.02, 0.07, 0.025, 2);
    hw.add(bottom, { x: mx + s.nx * 0.035, y: (FENCE_BOTTOM_M + 0.02) / 2, z: mz + s.nz * 0.035, ry: ang }, black);
    // Apron bumper roll along the apron edge.
  }
  const apronSegs = apronLoop.length;
  for (let k = 0; k < apronSegs; k++) {
    const [ax, az] = apronLoop[k]!;
    const [bx, bz] = apronLoop[(k + 1) % apronSegs]!;
    const c = cylinderBetween(new THREE.Vector3(ax, -0.02, az), new THREE.Vector3(bx, -0.02, bz), 0.075, 10);
    hw.add(c.geo, c.m, black);
  }

  // Two gates, on flats 1 and 5: a tube frame in the fence plane plus a latch.
  for (const k of [1, 5]) {
    const s = wallSegments(arena)[k]!;
    const ux = (s.bx - s.ax) / s.length;
    const uz = (s.bz - s.az) / s.length;
    const mx = (s.ax + s.bx) / 2 + s.nx * 0.03;
    const mz = (s.az + s.bz) / 2 + s.nz * 0.03;
    const gw = 0.62;
    const tubes: [number, number, number, number][] = [
      [-gw, FENCE_BOTTOM_M, -gw, FENCE_HEIGHT_M], [gw, FENCE_BOTTOM_M, gw, FENCE_HEIGHT_M],
      [-gw, FENCE_HEIGHT_M - 0.03, gw, FENCE_HEIGHT_M - 0.03], [-gw, FENCE_BOTTOM_M + 0.02, gw, FENCE_BOTTOM_M + 0.02],
      [-gw, 0.95, gw, 0.95],
    ];
    for (const [o0, y0, o1, y1] of tubes) {
      const c = cylinderBetween(
        new THREE.Vector3(mx + ux * o0, y0, mz + uz * o0), new THREE.Vector3(mx + ux * o1, y1, mz + uz * o1), 0.02, 6,
      );
      hw.add(c.geo, c.m, metal);
    }
    const latch = new THREE.BoxGeometry(0.08, 0.16, 0.06);
    hw.add(latch, { x: mx + ux * gw + s.nx * 0.03, y: 1.0, z: mz + uz * gw + s.nz * 0.03, ry: Math.atan2(s.nx, s.nz) }, metal);
  }

  // Skirt: vertical faces from the apron edge down to the arena floor.
  const sk: number[] = [];
  const sn: number[] = [];
  const su: number[] = [];
  const si: number[] = [];
  let around = 0;
  let vi = 0;
  const yTop = -0.08;
  const yBot = -OCTAGON_PLATFORM_M;
  for (let k = 0; k < apronSegs; k++) {
    const [ax, az] = apronLoop[k]!;
    const [bx, bz] = apronLoop[(k + 1) % apronSegs]!;
    const len = Math.hypot(bx - ax, bz - az);
    const nx = (ax + bx) / 2;
    const nz = (az + bz) / 2;
    const nl = Math.hypot(nx, nz);
    sk.push(ax, yTop, az, bx, yTop, bz, bx, yBot, bz, ax, yBot, az);
    for (let i = 0; i < 4; i++) sn.push(nx / nl, 0, nz / nl);
    // u in "board lengths" (a board texture spans 8 m).
    su.push(around / 8, 1, (around + len) / 8, 1, (around + len) / 8, 0, around / 8, 0);
    si.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
    vi += 4;
    around += len;
  }
  const skirt = new THREE.BufferGeometry();
  skirt.setAttribute('position', new THREE.Float32BufferAttribute(sk, 3));
  skirt.setAttribute('normal', new THREE.Float32BufferAttribute(sn, 3));
  skirt.setAttribute('uv', new THREE.Float32BufferAttribute(su, 2));
  skirt.setIndex(si);
  skirt.computeBoundingSphere();

  const hardware = hw.build();
  const fence = buildFenceGeometry(arena);
  return {
    canvas, fence, hardware, skirt,
    triangles: n + fence.index!.count / 3 + hw.triangles + si.length / 3,
  };
}

/** Stairs up to the apron at a gate: `angle` is the gate's outward direction. */
export function addStairs(mb: MergeBuilder, x: number, z: number, angle: number, height: number, colour: RGB): void {
  const steps = Math.max(3, Math.round(height / 0.22));
  const rise = height / steps;
  const tread = 0.3;
  const dx = Math.sin(angle);
  const dz = Math.cos(angle);
  for (let i = 0; i < steps; i++) {
    const g = new THREE.BoxGeometry(1.1, rise * (i + 1), tread);
    const d = (steps - i - 0.5) * tread;
    mb.add(g, { x: x + dx * d, y: -height + (rise * (i + 1)) / 2, z: z + dz * d, ry: angle }, colour);
  }
  // Handrails.
  for (const side of [-0.55, 0.55]) {
    const px = -dz * side;
    const pz = dx * side;
    const top = new THREE.Vector3(x + px, 0.9, z + pz);
    const bot = new THREE.Vector3(x + px + dx * steps * tread, -height + 0.9, z + pz + dz * steps * tread);
    const c = cylinderBetween(top, bot, 0.02, 6);
    mb.add(c.geo, c.m, colour);
  }
}
