/**
 * A coarse capsule body for each fighter: used by the pose browser to draw
 * the skeleton and by the tests to check that two bodies do not pass through
 * each other. Radii are the *firm* body (bone and packed muscle), a little
 * inside the skin, so pressing contact is allowed and interpenetration is not.
 */
import { B, BONE_COUNT, type RestSkeleton, type WorldPose } from '../../rig/skeleton';
import { restScale } from './sockets';
import type { V3 } from './math';

export interface Capsule {
  name: string;
  a: V3;
  b: V3;
  r: number;
  /** Body region, for the test's contact allowances. */
  region: 'torso' | 'head' | 'arm' | 'hand' | 'leg' | 'foot';
}

type Seg = [name: string, from: number | [number, number], to: number | 'tip' | [number, number, number], r: number, region: Capsule['region']];

const SEGS: Seg[] = [
  ['pelvis', B.lUpLeg, B.rUpLeg, 0.095, 'torso'],
  ['belly', B.spine, B.spine1, 0.105, 'torso'],
  ['ribs', B.spine1, B.spine2, 0.11, 'torso'],
  ['chest', B.spine2, [B.spine2, 0.75, 0], 0.115, 'torso'],
  ['shoulders', B.lArm, B.rArm, 0.06, 'torso'],
  ['neck', B.neck, 'tip', 0.045, 'head'],
  ['head', [B.head, 0.35], [B.head, 0.62, 0], 0.085, 'head'],
  ['lUpperArm', B.lArm, B.lForeArm, 0.045, 'arm'],
  ['lForeArm', B.lForeArm, B.lHand, 0.038, 'arm'],
  ['lHand', B.lHand, 'tip', 0.03, 'hand'],
  ['rUpperArm', B.rArm, B.rForeArm, 0.045, 'arm'],
  ['rForeArm', B.rForeArm, B.rHand, 0.038, 'arm'],
  ['rHand', B.rHand, 'tip', 0.03, 'hand'],
  ['lThigh', B.lUpLeg, B.lLeg, 0.07, 'leg'],
  ['lShin', B.lLeg, B.lFoot, 0.048, 'leg'],
  ['lFoot', B.lFoot, B.lToe, 0.035, 'foot'],
  ['rThigh', B.rUpLeg, B.rLeg, 0.07, 'leg'],
  ['rShin', B.rLeg, B.rFoot, 0.048, 'leg'],
  ['rFoot', B.rFoot, B.rToe, 0.035, 'foot'],
];

function jointAt(w: WorldPose, i: number): V3 {
  return [w.pos[i * 3], w.pos[i * 3 + 1], w.pos[i * 3 + 2]];
}
function along(w: WorldPose, i: number, t: number): V3 {
  const a = jointAt(w, i);
  return [a[0] + (w.tip[i * 3] - a[0]) * t, a[1] + (w.tip[i * 3 + 1] - a[1]) * t, a[2] + (w.tip[i * 3 + 2] - a[2]) * t];
}

export function bodyCapsules(w: WorldPose, rest: RestSkeleton): Capsule[] {
  const s = restScale(rest);
  const out: Capsule[] = [];
  for (const [name, f, t, r, region] of SEGS) {
    const a = typeof f === 'number' ? jointAt(w, f) : along(w, f[0], f[1]);
    let b: V3;
    if (t === 'tip') b = typeof f === 'number' ? [w.tip[f * 3], w.tip[f * 3 + 1], w.tip[f * 3 + 2]] : a;
    else if (typeof t === 'number') b = jointAt(w, t);
    else b = along(w, t[0], t[1]);
    out.push({ name, a, b, r: r * s, region });
  }
  void BONE_COUNT;
  return out;
}

/** Closest distance between segments p1-q1 and p2-q2. */
export function segSegDist(p1: V3, q1: V3, p2: V3, q2: V3): number {
  return segSegClosest(p1, q1, p2, q2).d;
}

/** Closest points (c1 on the first segment, c2 on the second) and their distance. */
export function segSegClosest(p1: V3, q1: V3, p2: V3, q2: V3): { d: number; c1: V3; c2: V3 } {
  const d1: V3 = [q1[0] - p1[0], q1[1] - p1[1], q1[2] - p1[2]];
  const d2: V3 = [q2[0] - p2[0], q2[1] - p2[1], q2[2] - p2[2]];
  const r: V3 = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]];
  const a = d1[0] * d1[0] + d1[1] * d1[1] + d1[2] * d1[2];
  const e = d2[0] * d2[0] + d2[1] * d2[1] + d2[2] * d2[2];
  const f = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2];
  let s: number, t: number;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) {
    s = t = 0;
  } else if (a <= EPS) {
    s = 0; t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2];
    if (e <= EPS) {
      t = 0; s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2];
      const den = a * e - b * b;
      s = den !== 0 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
    }
  }
  const c1: V3 = [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s];
  const c2: V3 = [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t];
  return { d: Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2]), c1, c2 };
}

const CORE = new Set(['pelvis', 'belly', 'ribs', 'chest', 'shoulders', 'head']);

/** The torso and head capsules only. */
export function coreCapsules(w: WorldPose, rest: RestSkeleton): Capsule[] {
  return bodyCapsules(w, rest).filter((c) => CORE.has(c.name));
}

export interface Penetration { a: string; b: string; depth: number }

/** Deepest capsule overlaps between two bodies, sorted, depth > `min`. */
export function penetrations(ca: Capsule[], cb: Capsule[], min = 0): Penetration[] {
  const out: Penetration[] = [];
  for (const x of ca) {
    for (const y of cb) {
      const d = segSegDist(x.a, x.b, y.a, y.b);
      const depth = x.r + y.r - d;
      if (depth > min) out.push({ a: x.name, b: y.name, depth });
    }
  }
  return out.sort((p, q) => q.depth - p.depth);
}

/** Lowest point of a body (capsule bottoms), for floor checks. */
export function lowestPoint(c: Capsule[]): number {
  let m = Infinity;
  for (const k of c) m = Math.min(m, k.a[1] - k.r, k.b[1] - k.r);
  return m;
}
