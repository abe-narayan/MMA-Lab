/**
 * ARENA GEOMETRY.
 *
 * The arena is a simulation input, not scenery: it decides where the wall is,
 * what the wall does to a fighter pinned against it, and how hard the floor is
 * when someone lands on it. Chapter 08 reads the same object to build the set.
 *
 * See docs/design/09 §3.3.
 */

export type ArenaId =
  | 'octagon_30' | 'octagon_25'
  | 'ring_16' | 'ring_20' | 'ring_24'
  | 'mat_ibjjf' | 'tatami_ijf'
  | 'street_open' | 'street_grass';

export type WallKind = 'fence' | 'ropes' | 'edge' | 'none';
export type SurfaceKind = 'canvas' | 'mat' | 'tatami' | 'concrete' | 'grass';

export interface Arena {
  id: ArenaId;
  name: string;
  shape: 'polygon' | 'circle' | 'square' | 'unbounded';
  /** Polygon only. */
  sides?: number;
  /** Polygon: centre-to-flat distance, metres. */
  apothemM?: number;
  /** Square: centre-to-edge distance, metres. */
  halfWidthM?: number;
  wall: WallKind;
  surface: SurfaceKind;
  /** Multiplies fall and slam impact in chapter 05. Canvas is the 1.0 reference. */
  surfaceHardness: number;
  outOfBounds: 'clamp' | 'restart-centre' | 'penalty' | 'none';
  obstacles?: { x: number; z: number; r: number }[];
}

const FT = 0.3048;

/**
 * Perf: the edge-plane angles of an n-gon and their sines and cosines,
 * computed once per `n` with exactly the expressions the geometry below used
 * to evaluate per call (`Math.sin` of the same double is the same double), so
 * every result is unchanged.
 */
interface PolygonTable { ang: Float64Array; sin: Float64Array; cos: Float64Array }
const POLYGON_TABLES = new Map<number, PolygonTable>();
function polygonTable(n: number): PolygonTable {
  let t = POLYGON_TABLES.get(n);
  if (t !== undefined) return t;
  const phase = Math.PI / n;
  const m = Math.max(0, Math.ceil(n)) || 0;
  t = { ang: new Float64Array(m), sin: new Float64Array(m), cos: new Float64Array(m) };
  for (let k = 0; k < n; k++) {
    const ang = phase + (2 * Math.PI * k) / n;
    t.ang[k] = ang;
    t.sin[k] = Math.sin(ang);
    t.cos[k] = Math.cos(ang);
  }
  POLYGON_TABLES.set(n, t);
  return t;
}

/**
 * Distance from a point to the nearest wall, metres. Infinity when unbounded.
 * Used by chapter 07 (cage proximity, cutting off) and chapter 03 (cage nodes).
 */
export function distanceToWall(arena: Arena, x: number, z: number): number {
  switch (arena.shape) {
    case 'unbounded':
      return Infinity;
    case 'circle':
      return Math.max(0, (arena.apothemM ?? 0) - Math.hypot(x, z));
    case 'square': {
      const h = arena.halfWidthM ?? 0;
      return Math.max(0, Math.min(h - Math.abs(x), h - Math.abs(z)));
    }
    case 'polygon': {
      const n = arena.sides ?? 8;
      const a = arena.apothemM ?? 0;
      // Distance to the nearest of n edge planes, each at distance `a` from the
      // centre with outward normal at angle (2*pi*k/n + phase).
      const tab = polygonTable(n);
      let best = Infinity;
      for (let k = 0; k < n; k++) {
        const d = a - (x * tab.sin[k] + z * tab.cos[k]);
        if (d < best) best = d;
      }
      return Math.max(0, best);
    }
  }
}

/** Outward wall normal angle (radians) nearest to a point; 0 when unbounded. */
export function wallNormalAngle(arena: Arena, x: number, z: number): number {
  if (arena.shape === 'unbounded') return 0;
  if (arena.shape === 'circle') return Math.atan2(x, z);
  if (arena.shape === 'square') {
    const h = arena.halfWidthM ?? 0;
    const dx = h - Math.abs(x);
    const dz = h - Math.abs(z);
    return dx < dz ? (x >= 0 ? Math.PI / 2 : -Math.PI / 2) : z >= 0 ? 0 : Math.PI;
  }
  const n = arena.sides ?? 8;
  const a = arena.apothemM ?? 0;
  const tab = polygonTable(n);
  let best = Infinity;
  let bestAng = 0;
  for (let k = 0; k < n; k++) {
    const d = a - (x * tab.sin[k] + z * tab.cos[k]);
    if (d < best) {
      best = d;
      bestAng = tab.ang[k];
    }
  }
  return bestAng;
}

/** Clamp a position inside the arena, leaving `margin` metres of body radius. */
export function clampToArena(
  arena: Arena, x: number, z: number, margin: number
): { x: number; z: number; hitWall: boolean } {
  if (arena.shape === 'unbounded') return { x, z, hitWall: false };
  if (arena.shape === 'circle') {
    const r = Math.hypot(x, z);
    const max = (arena.apothemM ?? 0) - margin;
    if (r <= max || r === 0) return { x, z, hitWall: false };
    return { x: (x / r) * max, z: (z / r) * max, hitWall: true };
  }
  if (arena.shape === 'square') {
    const h = (arena.halfWidthM ?? 0) - margin;
    const cx = Math.max(-h, Math.min(h, x));
    const cz = Math.max(-h, Math.min(h, z));
    return { x: cx, z: cz, hitWall: cx !== x || cz !== z };
  }
  // Polygon: push inside each violated edge plane. Two passes converge for a
  // convex polygon and keep the operation deterministic.
  const n = arena.sides ?? 8;
  const a = (arena.apothemM ?? 0) - margin;
  const tab = polygonTable(n);
  let cx = x;
  let cz = z;
  let hit = false;
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < n; k++) {
      const sx = tab.sin[k];
      const sz = tab.cos[k];
      const over = cx * sx + cz * sz - a;
      if (over > 0) {
        cx -= sx * over;
        cz -= sz * over;
        hit = true;
      }
    }
  }
  return { x: cx, z: cz, hitWall: hit };
}

export const ARENAS: Readonly<Record<ArenaId, Arena>> = Object.freeze({
  // 30 ft across the flats [S: 09 §3.3] -> apothem = 30 * 0.3048 / 2.
  octagon_30: {
    id: 'octagon_30', name: 'Octagon (30 ft)', shape: 'polygon', sides: 8,
    apothemM: (30 * FT) / 2, wall: 'fence', surface: 'canvas', surfaceHardness: 1.0,
    outOfBounds: 'clamp',
  },
  octagon_25: {
    id: 'octagon_25', name: 'Octagon (25 ft)', shape: 'polygon', sides: 8,
    apothemM: (25 * FT) / 2, wall: 'fence', surface: 'canvas', surfaceHardness: 1.0,
    outOfBounds: 'clamp',
  },
  ring_16: {
    id: 'ring_16', name: 'Ring (16 ft)', shape: 'square', halfWidthM: (16 * FT) / 2,
    wall: 'ropes', surface: 'canvas', surfaceHardness: 1.0, outOfBounds: 'clamp',
  },
  ring_20: {
    id: 'ring_20', name: 'Ring (20 ft)', shape: 'square', halfWidthM: (20 * FT) / 2,
    wall: 'ropes', surface: 'canvas', surfaceHardness: 1.0, outOfBounds: 'clamp',
  },
  ring_24: {
    id: 'ring_24', name: 'Ring (24 ft)', shape: 'square', halfWidthM: (24 * FT) / 2,
    wall: 'ropes', surface: 'canvas', surfaceHardness: 1.0, outOfBounds: 'clamp',
  },
  mat_ibjjf: {
    id: 'mat_ibjjf', name: 'Competition mat', shape: 'square', halfWidthM: 4.0,
    wall: 'edge', surface: 'mat', surfaceHardness: 1.0, outOfBounds: 'restart-centre',
  },
  tatami_ijf: {
    id: 'tatami_ijf', name: 'Tatami', shape: 'square', halfWidthM: 4.0,
    wall: 'edge', surface: 'tatami', surfaceHardness: 1.0, outOfBounds: 'penalty',
  },
  street_open: {
    id: 'street_open', name: 'Open ground (concrete)', shape: 'unbounded',
    wall: 'none', surface: 'concrete', surfaceHardness: 3.0, outOfBounds: 'none',
  },
  street_grass: {
    id: 'street_grass', name: 'Open ground (grass)', shape: 'unbounded',
    wall: 'none', surface: 'grass', surfaceHardness: 1.2, outOfBounds: 'none',
  },
});

export function resolveArena(a: ArenaId | Arena): Arena {
  return typeof a === 'string' ? ARENAS[a] : a;
}
