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

/**
 * The between-rounds corner handheld works 1.9 m from a seated fighter with the
 * cornermen kneeling and leaning in between (performance pass 2): at that range
 * a cornerman's back grazing the sight line to the fighter's chest or hips fills
 * a quarter of the frame, which the broadcast-distance thresholds above let
 * through (the hips alone are 22 % of the subject). So that shot counts the
 * people in the cage with a margin for their clothes and lean, reacts to any
 * hidden sample, and may cross to the other side of the fighter.
 */
export const CORNER_AVOID = {
  /** Added to the referee's and cornermen's torso capsule radius (m; thinner parts in proportion). */
  margin: 0.1,
  /** Capsules thinner than this are arms: counted from the shoulder to just past the elbow. */
  minR: 0.07,
  limit: 0.05,
  clearTo: 0.02,
  homeBelow: 0.02,
  /**
   * Offsets from the home spot, smallest move first: (azimuth rad, lens lift m).
   * A lift of 25-40 cm (a standing operator's shoulder height) puts a kneeling
   * coach below the bottom of the frame; the same list is also tried about the
   * fighter's other side.
   */
  offsets: [
    [0.1, 0], [-0.1, 0], [0, 0.25], [0.1, 0.25], [-0.1, 0.25], [0.2, 0], [-0.2, 0], [0, 0.4],
    [0.2, 0.25], [-0.2, 0.25], [0.2, 0.4], [-0.2, 0.4], [0.3, 0], [-0.3, 0], [0.3, 0.4], [-0.3, 0.4],
  ] as const,
} as const;

/**
 * What the corner handheld must see of the seated fighter: `subjectSamples`
 * plus the rest of him — his shoulders and hips either side of the chest and
 * pelvis and his lap toward the lens — so a cornerman's back across his lap or
 * his arm counts, not only one across his face. A coach's head at the foot of
 * the picture beside him is how a corner shot looks and is not counted.
 * `toLens` is the horizontal direction from the fighter toward the lens.
 * Writes into `out` (reused).
 */
export function cornerSamples(p: FighterPoints, toLens: readonly [number, number], out: SamplePoint[]): SamplePoint[] {
  const [lx, lz] = toLens;
  const rx = lz, rz = -lx;
  const at = (q: V3, side: number, fwd: number, dy: number): V3 => [q[0] + rx * side + lx * fwd, q[1] + dy, q[2] + rz * side + lz * fwd];
  out.length = 0;
  out.push(
    { p: p.head, w: 2 }, { p: p.chest, w: 1.5 }, { p: p.hips, w: 1 },
    { p: at(p.chest, 0.22, 0, 0), w: 0.75 }, { p: at(p.chest, -0.22, 0, 0), w: 0.75 },
    { p: at(p.hips, 0.22, 0.1, 0), w: 0.75 }, { p: at(p.hips, -0.22, 0.1, 0), w: 0.75 },
    { p: at(p.hips, 0, 0.35, -0.05), w: 0.75 },
  );
  return out;
}

/**
 * `caps` grown for clothes and lean: the torso (r 0.17) by `margin`, thinner
 * parts in proportion. Arms (thinner than `armR`) count from the shoulder to
 * just past the elbow only: a cornerman's hand on the fighter's knee or face is
 * part of the picture, his shoulder and upper arm across the frame are not.
 * Written into `out` (reused; no allocation once warm).
 */
export function inflateCapsules(caps: readonly Capsule[], margin: number, out: Capsule[], armR = 0): Capsule[] {
  for (let i = 0; i < caps.length; i++) {
    const c = caps[i]!;
    const o = out[i] ?? (out[i] = { a: c.a, b: [0, 0, 0], r: 0 });
    const k = c.r < armR ? 0.55 : 1;
    o.a = c.a;
    o.b = [c.a[0] + (c.b[0] - c.a[0]) * k, c.a[1] + (c.b[1] - c.a[1]) * k, c.a[2] + (c.b[2] - c.a[2]) * k];
    o.r = c.r + margin * Math.min(1, c.r / 0.17);
  }
  out.length = caps.length;
  return out;
}

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

/** `segSeg`'s parameter along the first segment (module scratch: no allocation per call). */
let segS = 0;

/** Closest distance between segments p1-q1 and p2-q2; the parameter along the first is left in `segS`. */
function segSeg(p1: V3, q1: V3, p2: V3, q2: V3): number {
  const d1x = q1[0] - p1[0], d1y = q1[1] - p1[1], d1z = q1[2] - p1[2];
  const d2x = q2[0] - p2[0], d2y = q2[1] - p2[1], d2z = q2[2] - p2[2];
  const rx = p1[0] - p2[0], ry = p1[1] - p2[1], rz = p1[2] - p2[2];
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s = 0;
  let t = 0;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) {
    s = 0; t = 0;
  } else if (a <= EPS) {
    s = 0; t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      t = 0; s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > EPS ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  segS = s;
  const dx = p1[0] + d1x * s - (p2[0] + d2x * t);
  const dy = p1[1] + d1y * s - (p2[1] + d2y * t);
  const dz = p1[2] + d1z * s - (p2[2] + d2z * t);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
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
    // Bounding box of the sight line, for a cheap reject of far occluders.
    const x0 = Math.min(cam[0], sp.p[0]), x1 = Math.max(cam[0], sp.p[0]);
    const y0 = Math.min(cam[1], sp.p[1]), y1 = Math.max(cam[1], sp.p[1]);
    const z0 = Math.min(cam[2], sp.p[2]), z1 = Math.max(cam[2], sp.p[2]);
    for (const c of occluders) {
      const r = c.r;
      if (Math.min(c.a[0], c.b[0]) - r > x1 || Math.max(c.a[0], c.b[0]) + r < x0
        || Math.min(c.a[1], c.b[1]) - r > y1 || Math.max(c.a[1], c.b[1]) + r < y0
        || Math.min(c.a[2], c.b[2]) - r > z1 || Math.max(c.a[2], c.b[2]) + r < z0) continue;
      const d = segSeg(cam, sp.p, c.a, c.b);
      if (d < c.r && segS < stop) { hidden += sp.w; break; }
    }
  }
  return total > 0 ? hidden / total : 0;
}

/**
 * The cage itself as occluders (camera polish pass): the padded posts and the
 * top rail (fence) or top rope (ring) between them. The mesh is see-through and
 * is not counted; a post or the rail across a fighter's face is.
 */
export function cageCapsules(ca: {
  shape: string; wall: string; wallHeight: number; circumradius: number; sides: number;
}, postAz: readonly number[]): Capsule[] {
  if (ca.shape === 'unbounded' || ca.wall === 'none' || ca.wallHeight <= 0 || postAz.length === 0) return [];
  const out: Capsule[] = [];
  const r = ca.circumradius + 0.05;
  const h = ca.wallHeight + 0.1;
  for (const a of postAz) {
    out.push({ a: [Math.sin(a) * r, 0.05, Math.cos(a) * r], b: [Math.sin(a) * r, h, Math.cos(a) * r], r: 0.15 });
  }
  for (let k = 0; k < postAz.length; k++) {
    const a0 = postAz[k]!;
    const a1 = postAz[(k + 1) % postAz.length]!;
    out.push({
      a: [Math.sin(a0) * r, ca.wallHeight, Math.cos(a0) * r], b: [Math.sin(a1) * r, ca.wallHeight, Math.cos(a1) * r],
      r: ca.wall === 'fence' ? 0.06 : 0.03,
    });
  }
  return out;
}
