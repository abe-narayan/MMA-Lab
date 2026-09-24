/**
 * FOOT-PRESERVING CROSSFADE — the inertialization stand-in, done so the feet
 * stay where the floor says they are.
 *
 * Every mode switch (standing ↔ clinch ↔ ground ↔ down ↔ getting up) and every
 * action ending (a strike's recovery, a block, a kick's leg coming home) fades
 * from the last displayed pose to the new one. A plain pose blend (root lerp +
 * per-bone slerp) moves the feet: two poses with the same planted foot blend
 * to a foot that dips through the canvas and skates (measured before this:
 * toes 12 cm under the floor and 16 cm/frame sliding on the grapple → standing
 * fade). So after the blend:
 *
 *   - a foot that is ON THE FLOOR, at the same spot, in both poses is put back
 *     exactly where the target has it (two-bone IK to the target's ankle, knee
 *     bending the way the target's knee bends, the target's foot and toe
 *     rotation): the body blends over a fixed foot;
 *   - any other foot follows the blend, lifted just enough that neither its
 *     ball nor its ankle goes under the canvas.
 *
 * Pure function of (from pose, target pose, weight); no allocation per frame
 * beyond the scratch below.
 */
import { KNEE_MAX_FLEX, LIMBS, solveTwoBone } from '../rig/ik';
import {
  B, blendPose, createWorldPose, forwardKinematics, type Pose, type RestSkeleton, type WorldPose,
} from '../rig/skeleton';

type V3 = [number, number, number];

const legOf = [
  { chain: LIMBS.lLeg, hip: B.lUpLeg, knee: B.lLeg, ankle: B.lFoot, toe: B.lToe },
  { chain: LIMBS.rLeg, hip: B.rUpLeg, knee: B.rLeg, ankle: B.rFoot, toe: B.rToe },
] as const;

interface FootTarget {
  grounded: boolean;
  /** 0..1: on the floor, at the same spot, in both poses (then it is pinned). */
  pin: number;
  /** 0..1: planted in the target somewhere else than in the from pose (it steps there). */
  stepW: number;
  ankle: V3;
  footQ: [number, number, number, number];
  toeL: [number, number, number, number];
}
const tgt: [FootTarget, FootTarget] = [
  { grounded: false, pin: 0, stepW: 0, ankle: [0, 0, 0], footQ: [0, 0, 0, 1], toeL: [0, 0, 0, 1] },
  { grounded: false, pin: 0, stepW: 0, ankle: [0, 0, 0], footQ: [0, 0, 0, 1], toeL: [0, 0, 0, 1] },
];

const fromWorld = createWorldPose();
const P = (w: WorldPose, b: number): V3 => [w.pos[b * 3]!, w.pos[b * 3 + 1]!, w.pos[b * 3 + 2]!];

/** Is this foot standing on the floor in `w` (ball near the canvas, ankle no higher than a raised heel)? */
export function footGrounded(w: WorldPose, rest: RestSkeleton, side: 0 | 1): boolean {
  return groundW(w, rest, side) >= 0.5;
}

/**
 * How much a foot stands on the floor in `w`, 0..1, continuous in its height:
 * 1 with the ball within 1.5 cm of its rest height and the ankle no higher than
 * a raised heel, fading to 0 over the next 2 cm.
 */
export function groundW(w: WorldPose, rest: RestSkeleton, side: 0 | 1): number {
  const L = legOf[side];
  const k = rest.statureM / 1.7332;
  const toe = (w.pos[L.toe * 3 + 1]! - rest.head[L.toe * 3 + 1]! - 0.015 * k) / (0.02 * k);
  const ank = (w.pos[L.ankle * 3 + 1]! - rest.head[L.ankle * 3 + 1]! - 0.08 * k) / (0.02 * k);
  const c = (x: number): number => (x <= 0 ? 1 : x >= 1 ? 0 : 1 - x);
  return Math.min(c(toe), c(ank));
}

/**
 * `pose` holds the target (this frame's) pose and `world` its forward
 * kinematics. Blend `from` over it with weight `wFrom` (1: all `from`), keeping
 * the target's planted feet planted and every foot above the floor. Leaves
 * `world` current. Every decision is a continuous weight (how grounded each
 * foot is in each pose, how close the two plants are), so a foot never
 * switches from following the blend to being pinned in one frame.
 */
export function fadeKeepFeet(pose: Pose, world: WorldPose, from: Pose, wFrom: number, rest: RestSkeleton): void {
  if (wFrom <= 0) return;
  // Where the from-pose's feet are (scratch FK).
  forwardKinematics(fromWorld, from, rest);
  const k = rest.statureM / 1.7332;
  // 1. The target's feet.
  for (const side of [0, 1] as const) {
    const L = legOf[side];
    const t = tgt[side];
    const gT = groundW(world, rest, side);
    const gF = groundW(fromWorld, rest, side);
    const ank = P(world, L.ankle);
    t.ankle = ank;
    const o = L.ankle * 4;
    t.footQ = [world.quat[o]!, world.quat[o + 1]!, world.quat[o + 2]!, world.quat[o + 3]!];
    const lo = L.toe * 4;
    t.toeL = [pose.local[lo]!, pose.local[lo + 1]!, pose.local[lo + 2]!, pose.local[lo + 3]!];
    // Pinned: the same planted foot in both poses (an action ending). A foot
    // planted somewhere else in the target (the body re-seated) follows the
    // blend and steps there instead of teleporting.
    const fa = P(fromWorld, L.ankle);
    const d = Math.hypot(fa[0] - ank[0], fa[2] - ank[2]);
    const near = 1 - Math.min(1, Math.max(0, (d - 0.03 * k) / (0.07 * k)));
    t.pin = gT * gF * near;
    t.grounded = gT >= 0.5;
    t.stepW = gT * (1 - near);
  }
  // 2. The blend.
  blendPose(pose, from, pose, 1 - Math.min(1, wFrom));
  forwardKinematics(world, pose, rest);
  // 3. Feet back on the floor.
  let touched = false;
  for (const side of [0, 1] as const) {
    const L = legOf[side];
    const t = tgt[side];
    const ank = P(world, L.ankle);
    const knee = P(world, L.knee), hip = P(world, L.hip);
    // The knee keeps bending the way the blend bends it.
    const pole: V3 = [
      knee[0] + (knee[0] - (hip[0] + ank[0]) / 2) * 2,
      knee[1] + (knee[1] - (hip[1] + ank[1]) / 2) * 2,
      knee[2] + (knee[2] - (hip[2] + ank[2]) / 2) * 2,
    ];
    let goal: V3 = [
      ank[0] + (t.ankle[0] - ank[0]) * t.pin,
      ank[1] + (t.ankle[1] - ank[1]) * t.pin,
      ank[2] + (t.ankle[2] - ank[2]) * t.pin,
    ];
    // Never under the canvas; a foot planted somewhere else in the target steps
    // there (lifted over the blend) rather than sliding along it.
    const toeY = world.pos[L.toe * 3 + 1]! + (goal[1] - ank[1]);
    const lift = Math.max(0, 0.012 * k - toeY, 0.045 * k - goal[1])
      + 0.07 * k * t.stepW * Math.sin(Math.PI * (1 - Math.min(1, wFrom)));
    goal = [goal[0], goal[1] + lift, goal[2]];
    if (Math.hypot(goal[0] - ank[0], goal[1] - ank[1], goal[2] - ank[2]) < 1e-5 && t.pin <= 0) continue;
    const o = L.ankle * 4;
    const fq: [number, number, number, number] = [world.quat[o]!, world.quat[o + 1]!, world.quat[o + 2]!, world.quat[o + 3]!];
    solveTwoBone(pose, world, rest, L.chain, goal, pole, 1, KNEE_MAX_FLEX);
    forwardKinematics(world, pose, rest);
    setWorldRot(pose, world, L.ankle, L.knee, nlerpQ(fq, t.footQ, t.pin));
    if (t.pin > 0) {
      const lo = L.toe * 4;
      const cur: [number, number, number, number] = [pose.local[lo]!, pose.local[lo + 1]!, pose.local[lo + 2]!, pose.local[lo + 3]!];
      pose.local.set(nlerpQ(cur, t.toeL, t.pin), lo);
    }
    touched = true;
  }
  if (touched) forwardKinematics(world, pose, rest);
}

function nlerpQ(a: readonly number[], b: readonly number[], t: number): [number, number, number, number] {
  if (t <= 0) return [a[0]!, a[1]!, a[2]!, a[3]!];
  if (t >= 1) return [b[0]!, b[1]!, b[2]!, b[3]!];
  const sgn = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]! < 0 ? -1 : 1;
  const r: [number, number, number, number] = [
    a[0]! + (sgn * b[0]! - a[0]!) * t, a[1]! + (sgn * b[1]! - a[1]!) * t,
    a[2]! + (sgn * b[2]! - a[2]!) * t, a[3]! + (sgn * b[3]! - a[3]!) * t,
  ];
  const n = Math.hypot(r[0], r[1], r[2], r[3]) || 1;
  return [r[0] / n, r[1] / n, r[2] / n, r[3] / n];
}

/** Local rotation of `bone` so its world rotation is `q` (parent current in `world`). */
function setWorldRot(pose: Pose, world: WorldPose, bone: number, parent: number, q: readonly number[]): void {
  const po = parent * 4;
  const ax = -world.quat[po]!, ay = -world.quat[po + 1]!, az = -world.quat[po + 2]!, aw = world.quat[po + 3]!;
  const bx = q[0]!, by = q[1]!, bz = q[2]!, bw = q[3]!;
  const o = bone * 4;
  pose.local[o] = aw * bx + ax * bw + ay * bz - az * by;
  pose.local[o + 1] = aw * by - ax * bz + ay * bw + az * bx;
  pose.local[o + 2] = aw * bz + ax * by - ay * bx + az * bw;
  pose.local[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** Flesh radii (m, scale 1) of the joints kept above the canvas, by group. */
const FLOOR_TORSO: [number, number][] = [[B.hips, 0.07], [B.spine2, 0.08], [B.neck, 0.05], [B.head, 0.06]];

/**
 * Nothing under the canvas: a pose whose torso dips into the floor is lifted
 * whole; a foot or a hand under it is lifted by two-bone IK (the knee / elbow
 * keeps its bend direction), so a lying body does not hover to rescue a heel.
 * Used after the pair solver (a thrown uke rotated about tori's chest swung his
 * feet up to 73 cm under the mat) and on the fall poses. Recomputes `world`.
 * Returns the largest correction made (m).
 */
export function floorFix(pose: Pose, world: WorldPose, rest: RestSkeleton): number {
  forwardKinematics(world, pose, rest);
  const k = rest.statureM / 1.7332;
  let worst = 0;
  let lift = 0;
  for (const [j, r] of FLOOR_TORSO) lift = Math.max(lift, r * k - world.pos[j * 3 + 1]!);
  if (lift > 1e-4) {
    pose.rootPos[1] += lift;
    forwardKinematics(world, pose, rest);
    worst = lift;
  }
  const limbs = [
    { chain: LIMBS.lLeg, mid: B.lLeg, end: B.lFoot, tip: B.lToe, r: 0.04, rt: 0.012 },
    { chain: LIMBS.rLeg, mid: B.rLeg, end: B.rFoot, tip: B.rToe, r: 0.04, rt: 0.012 },
    { chain: LIMBS.lArm, mid: B.lForeArm, end: B.lHand, tip: B.lHand, r: 0.03, rt: 0.03 },
    { chain: LIMBS.rArm, mid: B.rForeArm, end: B.rHand, tip: B.rHand, r: 0.03, rt: 0.03 },
  ];
  for (const L of limbs) {
    const endY = world.pos[L.end * 3 + 1]!;
    const tipY = world.pos[L.tip * 3 + 1]!;
    const up = Math.max(0, L.r * k - endY, L.rt * k - tipY);
    if (up <= 1e-4) continue;
    const e = P(world, L.end);
    const m = P(world, L.mid);
    const root = P(world, L.chain.upper);
    const pole: V3 = [m[0] + (m[0] - (root[0] + e[0]) / 2) * 2, m[1] + (m[1] - (root[1] + e[1]) / 2) * 2, m[2] + (m[2] - (root[2] + e[2]) / 2) * 2];
    const eq = L.end * 4;
    const endQ: [number, number, number, number] = [world.quat[eq]!, world.quat[eq + 1]!, world.quat[eq + 2]!, world.quat[eq + 3]!];
    solveTwoBone(pose, world, rest, L.chain, [e[0], e[1] + up, e[2]], pole, 1);
    forwardKinematics(world, pose, rest);
    setWorldRot(pose, world, L.end, L.mid, endQ);
    forwardKinematics(world, pose, rest);
    worst = Math.max(worst, up);
  }
  return worst;
}
