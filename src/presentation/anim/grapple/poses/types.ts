import type { PairSpec } from '../dsl';

/** Context a node pose may vary with. */
export interface Variant {
  /** Ground top slot postured up to strike (EngagementSnapshot.posture). */
  postured: boolean;
  /** Against the fence. */
  cage: boolean;
  /** Seconds, for breathing / idle life (deterministic). */
  t: number;
  /** Grappling tier of a and b (0..5), for §10 tier tells. */
  tierA: number;
  tierB: number;
  /** Body scales (stature / reference). Filled in by the composer. */
  sA?: number;
  sB?: number;
}

/**
 * Hips height (in the body's own scale units) that brings a body of scale
 * `self` level with a partner of scale `other`: a taller man changes level to
 * get under a shorter man's arms. `h` is the height for equal bodies; `k` how
 * much of the difference is absorbed (1 = fully level).
 */
export function level(h: number, self: number | undefined, other: number | undefined, k = 0.8): number {
  const s = self ?? 1;
  const o = other ?? 1;
  if (s <= o) return h; // the shorter man cannot stand taller than standing
  return (h * s - k * (s - o) * h) / s;
}

export type NodePose = PairSpec | ((v: Variant) => PairSpec);

export const DEFAULT_VARIANT: Variant = { postured: false, cage: false, t: 0, tierA: 4, tierB: 4 };

export function evalNodePose(p: NodePose, v: Variant): PairSpec {
  return typeof p === 'function' ? p(v) : p;
}
