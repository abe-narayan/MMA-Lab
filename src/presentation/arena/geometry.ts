/**
 * Venue geometry derived from the sim's `Arena` record — pure, no three.js.
 *
 * The sim clamps fighters to the arena's walls (`clampToArena`, `distanceToWall`
 * in src/sim/rules/arenas/types.ts). The picture must put the fence, the ropes
 * and the mat edge exactly there, so every set builder reads its wall line from
 * here and the tests check this file against the sim's own functions.
 *
 * Conventions shared with the sim:
 *  - Polygon: `sides` edge planes, each at `apothemM` from the centre, outward
 *    normal at angle phi_k = pi/n + 2*pi*k/n measured as (sin phi, cos phi) in
 *    (x, z). The vertices therefore sit at theta_k = 2*pi*k/n at the
 *    circumradius a / cos(pi/n).
 *  - Square: walls at |x| = halfWidthM and |z| = halfWidthM.
 *  - y = 0 is the fighting surface (canvas / mat / ground).
 */
import type { Arena } from '../../sim';

export type SetKind = 'octagon' | 'ring' | 'mat' | 'street';

export function setKindOf(arena: Arena): SetKind {
  if (arena.shape === 'unbounded') return 'street';
  if (arena.wall === 'fence') return 'octagon';
  if (arena.wall === 'ropes') return 'ring';
  return 'mat';
}

/** Fence height above the canvas (UFC-style cage, docs/design/08 §6: 1.95 m to the top of the pad). */
export const FENCE_HEIGHT_M = 1.8;
/** Padded top rail radius. */
export const TOP_RAIL_R = 0.085;
/** Raised stage heights: the canvas is at y = 0, the arena floor below it. */
export const OCTAGON_PLATFORM_M = 0.95;
export const RING_PLATFORM_M = 1.0;
/** Canvas apron outside the fence / ropes. */
export const OCTAGON_APRON_M = 1.25;
export const RING_APRON_M = 0.6;
/** Ring rope heights above the canvas, lowest first (docs/design/08 §6). */
export const ROPE_HEIGHTS_M = [0.46, 0.76, 1.07, 1.37] as const;
export const ROPE_RADIUS_M = 0.022;
/** Corner posts sit this far outside the rope square, on the diagonal axes. */
export const RING_POST_INSET_M = 0.1;

/** Distance from the centre to a polygon vertex. */
export function circumradius(arena: Arena): number {
  if (arena.shape === 'polygon') {
    const n = arena.sides ?? 8;
    return (arena.apothemM ?? 0) / Math.cos(Math.PI / n);
  }
  if (arena.shape === 'square') return (arena.halfWidthM ?? 0) * Math.SQRT2;
  if (arena.shape === 'circle') return arena.apothemM ?? 0;
  return Infinity;
}

/** The distance from the centre to the nearest wall (apothem or half-width). */
export function wallInradius(arena: Arena): number {
  if (arena.shape === 'polygon' || arena.shape === 'circle') return arena.apothemM ?? 0;
  if (arena.shape === 'square') return arena.halfWidthM ?? 0;
  return Infinity;
}

/**
 * The wall line as a closed loop of floor points (x, z), in the order the sim
 * numbers its edges: segment k runs from vertex k to vertex k+1 and has the
 * outward normal angle pi/n + 2*pi*k/n (polygon) — the same k the sim loops over.
 * Empty for unbounded arenas. A circle is approximated by 64 vertices.
 */
export function wallLoop(arena: Arena): [number, number][] {
  switch (arena.shape) {
    case 'unbounded':
      return [];
    case 'polygon': {
      const n = arena.sides ?? 8;
      const r = circumradius(arena);
      const out: [number, number][] = [];
      for (let k = 0; k < n; k++) {
        const t = (2 * Math.PI * k) / n;
        out.push([r * Math.sin(t), r * Math.cos(t)]);
      }
      return out;
    }
    case 'square': {
      const h = arena.halfWidthM ?? 0;
      // Walk so each segment's outward normal is +z, +x, -z, -x in turn.
      return [[-h, h], [h, h], [h, -h], [-h, -h]];
    }
    case 'circle': {
      const r = arena.apothemM ?? 0;
      const out: [number, number][] = [];
      for (let k = 0; k < 64; k++) {
        const t = (2 * Math.PI * k) / 64;
        out.push([r * Math.sin(t), r * Math.cos(t)]);
      }
      return out;
    }
  }
}

export interface WallSegment {
  ax: number; az: number;
  bx: number; bz: number;
  /** Outward normal (unit) in (x, z). */
  nx: number; nz: number;
  length: number;
}

export function wallSegments(arena: Arena): WallSegment[] {
  const loop = wallLoop(arena);
  const out: WallSegment[] = [];
  for (let k = 0; k < loop.length; k++) {
    const [ax, az] = loop[k]!;
    const [bx, bz] = loop[(k + 1) % loop.length]!;
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const len = Math.hypot(bx - ax, bz - az);
    // Outward normal: perpendicular to the segment, pointing away from the centre.
    let nx = (bz - az) / len;
    let nz = -(bx - ax) / len;
    if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
    out.push({ ax, az, bx, bz, nx, nz, length: len });
  }
  return out;
}

/** Point on the wall line `inset` metres inside (negative = outside) along a direction from the centre. */
export function wallPointToward(arena: Arena, angle: number, inset = 0): [number, number] {
  const dx = Math.sin(angle);
  const dz = Math.cos(angle);
  if (arena.shape === 'unbounded') return [dx * 1e6, dz * 1e6];
  // Ray/wall intersection: smallest t with n.(t d) = inradius for any edge.
  let best = Infinity;
  for (const s of wallSegments(arena)) {
    const dn = dx * s.nx + dz * s.nz;
    if (dn <= 1e-9) continue;
    const planeD = s.ax * s.nx + s.az * s.nz;
    const t = (planeD - inset) / dn;
    if (t < best) best = t;
  }
  return [dx * best, dz * best];
}

/** Camera bounds for the director (ArenaSet.bounds). */
export function venueBounds(arena: Arena): { fightRadiusM: number; outerRadiusM: number; ceilingM: number } {
  switch (setKindOf(arena)) {
    case 'octagon':
      return { fightRadiusM: circumradius(arena) - 0.3, outerRadiusM: 28, ceilingM: 16 };
    case 'ring':
      return { fightRadiusM: (arena.halfWidthM ?? 3) - 0.2, outerRadiusM: 26, ceilingM: 16 };
    case 'mat':
      return { fightRadiusM: (arena.halfWidthM ?? 4) + 2.5, outerRadiusM: 22, ceilingM: 11 };
    case 'street':
      return { fightRadiusM: 12, outerRadiusM: 30, ceilingM: 20 };
  }
}

/** Fence corner name for the two painted corners (red at vertex 0 side, blue opposite). */
export function cornerPositions(arena: Arena): { red: [number, number]; blue: [number, number] } {
  if (arena.shape === 'square') {
    const h = (arena.halfWidthM ?? 3) + RING_POST_INSET_M * 0.5;
    return { red: [-h, h], blue: [h, -h] };
  }
  if (arena.shape === 'polygon') {
    const loop = wallLoop(arena);
    const n = loop.length;
    const r = loop[0]!;
    const b = loop[Math.floor(n / 2)]!;
    return { red: [r[0], r[1]], blue: [b[0], b[1]] };
  }
  return { red: [-3, 3], blue: [3, -3] };
}
