/**
 * Where cameras may stand. Built from the sim's own `Arena` (the wall the
 * fighters actually hit) plus the set's `ArenaSet.bounds` (where the crowd
 * wall and the lighting rig are), so the director never parks a lens inside
 * the fence on a wide shot or behind the front row.
 *
 * Azimuths use the sim convention: a point at azimuth `a` and radius `r` is
 * (x, z) = (r sin a, r cos a). For a polygon cage with n sides the posts sit at
 * azimuths 2πk/n and the panel centres at π/n + 2πk/n (see
 * `distanceToWall` in src/sim/rules/arenas/types.ts).
 */
import type { Arena } from '../../sim';
import type { ArenaSet } from '../contract';
import { atAzimuth, clamp, type V3, wrapAngle } from './math';

export interface CameraArena {
  shape: Arena['shape'];
  sides: number;
  /** Polygon apothem, square half width or circle radius; 0 when unbounded. */
  apothem: number;
  /** Largest centre-to-wall distance (a polygon's post radius). */
  circumradius: number;
  wall: Arena['wall'];
  /** Height of the wall a lens must clear. */
  wallHeight: number;
  /** From `ArenaSet.bounds`, or derived when the set has none. */
  fightRadius: number;
  outerRadius: number;
  ceiling: number;
  /** The hard camera's platform: panel centre nearest 6 o'clock (−Z). */
  mainAzimuth: number;
  /** Radius and height of the hard-camera platform. */
  mainRadius: number;
  mainHeight: number;
}

const CAGE_HEIGHT = 1.95;
const ROPE_HEIGHT = 1.45;

export function makeCameraArena(arena: Arena, bounds?: ArenaSet['bounds'] | null): CameraArena {
  const shape = arena.shape;
  const sides = shape === 'polygon' ? arena.sides ?? 8 : shape === 'square' ? 4 : 0;
  const apothem = shape === 'polygon' || shape === 'circle'
    ? arena.apothemM ?? 4.6
    : shape === 'square' ? arena.halfWidthM ?? 3.05 : 0;
  const circumradius = shape === 'polygon'
    ? apothem / Math.cos(Math.PI / sides)
    : shape === 'square' ? apothem * Math.SQRT2 : apothem;
  const wallHeight = arena.wall === 'fence' ? CAGE_HEIGHT : arena.wall === 'ropes' ? ROPE_HEIGHT : 0;
  const unbounded = shape === 'unbounded';
  const fightRadius = bounds?.fightRadiusM ?? (unbounded ? 12 : circumradius);
  const outerRadius = Math.max(
    bounds?.outerRadiusM ?? (unbounded ? 40 : circumradius + 7),
    (unbounded ? 6 : circumradius) + 2.2,
  );
  const ceiling = bounds?.ceilingM ?? 14;

  const ca: CameraArena = {
    shape, sides, apothem, circumradius, wall: arena.wall, wallHeight,
    fightRadius, outerRadius, ceiling,
    mainAzimuth: Math.PI,
    mainRadius: 0,
    mainHeight: 0,
  };
  // A post must never sit dead-centre behind the pair on the main shot, so the
  // platform faces a panel centre rather than a post.
  ca.mainAzimuth = nearestPanelCentre(ca, Math.PI + 1e-3);
  ca.mainRadius = clamp((unbounded ? 6 : circumradius) + 3.4, 0, outerRadius - 0.6);
  ca.mainHeight = clamp(4.3, 1, ceiling - 0.5);
  return ca;
}

/** Distance from the centre to the wall along `azimuth`. Infinity when unbounded. */
export function wallDistanceAt(ca: CameraArena, azimuth: number): number {
  switch (ca.shape) {
    case 'unbounded':
      return Infinity;
    case 'circle':
      return ca.apothem;
    case 'square': {
      const s = Math.abs(Math.sin(azimuth));
      const c = Math.abs(Math.cos(azimuth));
      return ca.apothem / Math.max(s, c, 1e-6);
    }
    case 'polygon': {
      const n = ca.sides;
      let best = Infinity;
      for (let k = 0; k < n; k++) {
        const ang = Math.PI / n + (2 * Math.PI * k) / n;
        const c = Math.cos(azimuth - ang);
        if (c > 1e-6) best = Math.min(best, ca.apothem / c);
      }
      return best;
    }
  }
}

/** True when (x, z) lies inside the wall (with `margin` metres of slack outward). */
export function insideWall(ca: CameraArena, x: number, z: number, margin = 0): boolean {
  if (ca.shape === 'unbounded') return false;
  const r = Math.hypot(x, z);
  return r < wallDistanceAt(ca, Math.atan2(x, z)) + margin;
}

export function postAzimuths(ca: CameraArena): number[] {
  if (ca.shape === 'polygon') return Array.from({ length: ca.sides }, (_, k) => (2 * Math.PI * k) / ca.sides);
  if (ca.shape === 'square') return [0, 1, 2, 3].map((k) => Math.PI / 4 + (k * Math.PI) / 2);
  return [];
}

export function panelCentres(ca: CameraArena): number[] {
  if (ca.shape === 'polygon') return Array.from({ length: ca.sides }, (_, k) => Math.PI / ca.sides + (2 * Math.PI * k) / ca.sides);
  if (ca.shape === 'square') {
    // Three operator spots per side of a ring: centre and either side of it.
    const out: number[] = [];
    for (let k = 0; k < 4; k++) {
      const c = (k * Math.PI) / 2;
      out.push(c - 0.38, c, c + 0.38);
    }
    return out;
  }
  return Array.from({ length: 16 }, (_, k) => (2 * Math.PI * k) / 16);
}

export function nearestPanelCentre(ca: CameraArena, azimuth: number): number {
  const list = panelCentres(ca);
  let best = list[0] ?? azimuth;
  let bd = Infinity;
  for (const a of list) {
    const d = Math.abs(wrapAngle(a - azimuth));
    if (d < bd - 1e-9) {
      bd = d;
      best = a;
    }
  }
  return best;
}

/** Angular distance (rad) from `azimuth` to the nearest post; Infinity without posts. */
export function postClearance(ca: CameraArena, azimuth: number): number {
  let best = Infinity;
  for (const p of postAzimuths(ca)) best = Math.min(best, Math.abs(wrapAngle(p - azimuth)));
  return best;
}

/**
 * Keep a lens where a real camera could be:
 *  - never behind the crowd wall or above the rig;
 *  - on a wide shot, outside the wall by a clear margin (`wideMargin`);
 *  - otherwise never *inside the fence volume* — below the top rail and inside
 *    the wall — unless the shot explicitly allows it (an in-cage handheld).
 */
export function clampToBounds(
  ca: CameraArena, p: V3, opts: { wide: boolean; allowInside?: boolean; anchor?: V3 },
): V3 {
  const out: V3 = [p[0], p[1], p[2]];
  const ax = opts.anchor ? opts.anchor[0] : 0;
  const az = opts.anchor ? opts.anchor[2] : 0;
  // Crowd wall: radius from the arena centre (or, unbounded, from the action).
  let dx = out[0] - ax;
  let dz = out[2] - az;
  let r = Math.hypot(dx, dz);
  const maxR = ca.outerRadius - 0.5;
  if (r > maxR) {
    out[0] = ax + (dx / r) * maxR;
    out[2] = az + (dz / r) * maxR;
  }
  out[1] = clamp(out[1], 0.25, ca.ceiling - 0.3);
  if (ca.shape === 'unbounded' || opts.allowInside) return out;

  dx = out[0];
  dz = out[2];
  r = Math.hypot(dx, dz);
  const az0 = Math.atan2(dx, dz);
  const wallR = Math.max(wallDistanceAt(ca, az0), opts.wide ? ca.fightRadius : 0);
  const aboveRail = out[1] > ca.wallHeight + 1.6;
  if (opts.wide) {
    const need = wallR + 0.6;
    if (r < need) {
      const q = atAzimuth(az0, need, out[1]);
      out[0] = q[0];
      out[2] = q[2];
    }
  } else if (!aboveRail && r < wallR + 0.25) {
    const q = atAzimuth(az0, wallR + 0.25, out[1]);
    out[0] = q[0];
    out[2] = q[2];
  }
  return out;
}
