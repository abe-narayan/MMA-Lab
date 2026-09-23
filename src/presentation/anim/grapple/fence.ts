/**
 * Fence geometry, re-derived from the public `Arena` record (the sim's own
 * helpers are internal). Used to put a pinned fighter's back on the fence and
 * to keep every other pose from poking through it.
 */
import type { Arena } from '../../../sim';

export interface WallPlane { nx: number; nz: number; d: number }

export function wallPlanes(arena: Arena): WallPlane[] {
  if (arena.wall === 'none' || arena.shape === 'unbounded') return [];
  if (arena.shape === 'square') {
    const h = arena.halfWidthM ?? 0;
    return [{ nx: 1, nz: 0, d: h }, { nx: -1, nz: 0, d: h }, { nx: 0, nz: 1, d: h }, { nx: 0, nz: -1, d: h }];
  }
  if (arena.shape === 'circle') {
    // Approximate the ring of a circle by 32 facets.
    const a = arena.apothemM ?? 0;
    const out: WallPlane[] = [];
    for (let k = 0; k < 32; k++) {
      const ang = (2 * Math.PI * k) / 32;
      out.push({ nx: Math.sin(ang), nz: Math.cos(ang), d: a });
    }
    return out;
  }
  const n = arena.sides ?? 8;
  const a = arena.apothemM ?? 0;
  const phase = Math.PI / n;
  const out: WallPlane[] = [];
  for (let k = 0; k < n; k++) {
    const ang = phase + (2 * Math.PI * k) / n;
    out.push({ nx: Math.sin(ang), nz: Math.cos(ang), d: a });
  }
  return out;
}

/** Signed distance from (x, z) to the nearest wall (positive inside) and that wall. */
export function nearestWall(planes: readonly WallPlane[], x: number, z: number): { dist: number; plane: WallPlane } | null {
  let best: WallPlane | null = null;
  let bd = Infinity;
  for (const p of planes) {
    const d = p.d - (x * p.nx + z * p.nz);
    if (d < bd) { bd = d; best = p; }
  }
  return best ? { dist: bd, plane: best } : null;
}
