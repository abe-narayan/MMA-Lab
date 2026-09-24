/**
 * OCCLUSION — does something stand between the lens and the fighters?
 *
 * The referee (and, for a shot about one fighter, the other fighter) is
 * approximated by a few capsules; the subject by weighted sample points
 * (head, chest, hips; the head counts most, because a broadcast can lose a
 * fighter's legs but never his face). `occlusion()` is the weighted share of
 * sample points whose line of sight from the lens passes through a capsule in
 * front of them. The director uses it to walk a handheld along the apron or
 * slide the hard camera along its platform (`AVOID`), and the planner to pick
 * an operator spot the referee is not standing in front of.
 *
 * Pure geometry, no scene access: the inputs are the referee's world pose
 * (or, in the planner, his placement on the floor) and the fighters' points.
 */
import { B, type WorldPose } from '../rig/skeleton';
import type { FighterPoints } from './keypoints';
import type { V3 } from './math';

export interface Capsule {
  a: V3;
  b: V3;
  r: number;
}

export interface SamplePoint {
  p: V3;
  w: number;
}

/** Share of the subject that may be hidden before the director reacts. */
export const OCCLUSION_LIMIT = 0.3;

/** How the operators may move to see past an occluder. */
export const AVOID = {
  /** Handhelds walk the apron: azimuth offsets (rad), tried smallest first. */
  handheldAzimuths: [0.14, -0.14, 0.28, -0.28, 0.42, -0.42, 0.56, -0.56] as const,
  /** The hard camera slides on its platform and booms up: (lateral m, up m). */
  mainOffsets: [[0.9, 0], [-0.9, 0], [0, 0.9], [1.8, 0], [-1.8, 0], [0.9, 0.9], [-0.9, 0.9], [1.8, 0.9], [-1.8, 0.9]] as const,
  /** An offset is taken only if it clears the subject to at most this. */
  clearTo: 0.15,
  /** Back home once the home position is this clear. */
  homeBelow: 0.1,
  /** Operator walk / platform slide spring, rad/s. */
  omega: 1.4,
} as const;

const v = (arr: Float32Array, i: number): V3 => [arr[i * 3]!, arr[i * 3 + 1]!, arr[i * 3 + 2]!];

/** Capsules for a posed body (torso, head, thighs+shins as one per leg, upper arms). */
export function bodyCapsules(w: WorldPose): Capsule[] {
  const hips = v(w.pos, B.hips);
  const neck = v(w.pos, B.neck);
  const head = v(w.pos, B.head);
  const crown = v(w.tip, B.head);
  return [
    { a: hips, b: neck, r: 0.17 },
    { a: head, b: crown, r: 0.11 },
    { a: v(w.pos, B.lUpLeg), b: v(w.pos, B.lFoot), r: 0.085 },
    { a: v(w.pos, B.rUpLeg), b: v(w.pos, B.rFoot), r: 0.085 },
    { a: v(w.pos, B.lArm), b: v(w.pos, B.lHand), r: 0.06 },
    { a: v(w.pos, B.rArm), b: v(w.pos, B.rHand), r: 0.06 },
  ];
}

/** A standing (or crouched) official on the floor at (x, z), for the planner. */
export function standingCapsules(x: number, z: number, crouch = 0, statureM = 1.8): Capsule[] {
  const k = statureM / 1.8;
  const drop = crouch * 0.35;
  return [
    { a: [x, (0.95 - drop) * k, z], b: [x, (1.48 - drop * 1.2) * k, z], r: 0.17 },
    { a: [x, (1.58 - drop * 1.3) * k, z], b: [x, (1.72 - drop * 1.3) * k, z], r: 0.11 },
    { a: [x, 0.1, z], b: [x, (0.9 - drop) * k, z], r: 0.15 },
  ];
}

/** Capsules of a fighter from his framing points (the other fighter as an occluder). */
export function fighterCapsules(p: FighterPoints): Capsule[] {
  return [
    { a: p.hips, b: p.neck, r: 0.17 },
    { a: p.head, b: p.crown, r: 0.11 },
  ];
}

/** What the camera must see of a fighter: head counts most. */
export function subjectSamples(p: FighterPoints): SamplePoint[] {
  return [
    { p: p.head, w: 2 },
    { p: p.chest, w: 1.5 },
    { p: p.hips, w: 1 },
  ];
}

/** Closest distance between segments p1-q1 and p2-q2; also the parameter along the first. */
function segSeg(p1: V3, q1: V3, p2: V3, q2: V3): { d: number; s: number } {
  const d1: V3 = [q1[0] - p1[0], q1[1] - p1[1], q1[2] - p1[2]];
  const d2: V3 = [q2[0] - p2[0], q2[1] - p2[1], q2[2] - p2[2]];
  const r: V3 = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]];
  const a = d1[0] * d1[0] + d1[1] * d1[1] + d1[2] * d1[2];
  const e = d2[0] * d2[0] + d2[1] * d2[1] + d2[2] * d2[2];
  const f = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2];
  let s = 0;
  let t = 0;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) {
    s = 0; t = 0;
  } else if (a <= EPS) {
    s = 0; t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2];
    if (e <= EPS) {
      t = 0; s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2];
      const denom = a * e - b * b;
      s = denom > EPS ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  const c1: V3 = [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s];
  const c2: V3 = [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t];
  return { d: Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2]), s };
}

/**
 * Weighted share (0..1) of `samples` hidden from `cam` by `occluders`. A
 * sample is hidden when its sight line passes within a capsule's radius at a
 * point clearly in front of it (not the sample's own surface).
 */
export function occlusion(cam: V3, samples: readonly SamplePoint[], occluders: readonly Capsule[]): number {
  let hidden = 0;
  let total = 0;
  for (const sp of samples) {
    total += sp.w;
    const len = Math.hypot(sp.p[0] - cam[0], sp.p[1] - cam[1], sp.p[2] - cam[2]);
    if (len < 1e-6) continue;
    // Ignore the last 0.3 m before the sample: that is the subject's own body.
    const stop = Math.max(0, 1 - 0.3 / len);
    for (const c of occluders) {
      const { d, s } = segSeg(cam, sp.p, c.a, c.b);
      if (d < c.r && s < stop) { hidden += sp.w; break; }
    }
  }
  return total > 0 ? hidden / total : 0;
}
