/**
 * The painted corners of a venue (pure, no three.js): where the corner stools
 * go and which way a seated fighter faces. Shared by the rest-period staging
 * (`corner/index.ts`) and the camera planner (the corner robotic cameras).
 */
import type { Arena } from '../../sim';

/** How far in from the corner post the stool stands (m). */
export const STOOL_INSET_M = 0.5;

export interface CornerSpot {
  /** The corner post (floor point). */
  post: [number, number];
  /** Where the stool stands: in from the post toward the centre. */
  stool: [number, number];
  /** The fighter's facing on the stool (toward the centre). */
  facing: number;
}

/**
 * The red (index 0) and blue (index 1) corners, or null where the venue has
 * none. Octagon: the posts with the corner-colour caps (vertices 3n/4 and
 * n/4); ring: the red and blue turnbuckles.
 */
export function cornerSpots(arena: Arena): [CornerSpot, CornerSpot] | null {
  let posts: [[number, number], [number, number]];
  if (arena.shape === 'polygon' && arena.wall === 'fence') {
    const n = arena.sides ?? 8;
    const r = (arena.apothemM ?? 4.57) / Math.cos(Math.PI / n);
    const at = (k: number): [number, number] => {
      const t = (2 * Math.PI * k) / n;
      return [r * Math.sin(t), r * Math.cos(t)];
    };
    posts = [at(Math.round((3 * n) / 4) % n), at(Math.round(n / 4) % n)];
  } else if (arena.shape === 'square' && arena.wall === 'ropes') {
    const h = arena.halfWidthM ?? 3;
    posts = [[-h, h], [h, -h]];
  } else {
    return null;
  }
  return posts.map((p) => {
    const d = Math.hypot(p[0], p[1]) || 1;
    const inset = STOOL_INSET_M;
    const stool: [number, number] = [p[0] - (p[0] / d) * inset, p[1] - (p[1] / d) * inset];
    return { post: p, stool, facing: Math.atan2(-p[0], -p[1]) };
  }) as [CornerSpot, CornerSpot];
}

