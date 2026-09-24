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
  // Knees: a knee under the canvas first swings up about the hip–ankle line
  // (the only freedom a two-bone leg has with both ends fixed) toward the
  // nearest angle that clears it — hinge-aware and continuous: a knee just
  // touching the floor barely moves and never flips to the other side
  // (flipping the pole was itself a pop). What the (limited) swing leaves is
  // then taken by raising the knee itself: the thigh aims at the knee lifted
  // to the floor, and the shin keeps its direction (the foot comes up with it).
  for (const L of limbs.slice(0, 2)) {
    const minY = KNEE_FLOOR_R * k;
    const K = P(world, L.mid);
    if (K[1] >= minY - 1e-4) continue;
    const H = P(world, L.chain.upper);
    const A = P(world, L.end);
    const eq = L.end * 4;
    const endQ: [number, number, number, number] = [world.quat[eq]!, world.quat[eq + 1]!, world.quat[eq + 2]!, world.quat[eq + 3]!];
    const goal = kneeAboveFloor(H, K, A, minY);
    let knee = goal.knee;
    let ankle: V3 = A;
    if (knee[1] < minY) {
      // The knee on the floor line: the point at thigh length from the hip, at
      // `minY`, in the knee's own horizontal direction from the hip.
      const L1 = Math.hypot(K[0] - H[0], K[1] - H[1], K[2] - H[2]);
      let hx = knee[0] - H[0], hz = knee[2] - H[2];
      const hl = Math.hypot(hx, hz);
      if (hl > 1e-5) { hx /= hl; hz /= hl; } else { hx = 0; hz = 1; }
      const R = Math.sqrt(Math.max(0, L1 * L1 - (H[1] - minY) * (H[1] - minY)));
      const k2: V3 = [H[0] + hx * R, Math.max(minY, H[1] - L1), H[2] + hz * R];
      ankle = [A[0] + k2[0] - knee[0], A[1] + k2[1] - knee[1], A[2] + k2[2] - knee[2]];
      knee = k2;
    }
    const mid: V3 = [(H[0] + ankle[0]) / 2, (H[1] + ankle[1]) / 2, (H[2] + ankle[2]) / 2];
    const pole: V3 = [knee[0] + (knee[0] - mid[0]) * 2, knee[1] + (knee[1] - mid[1]) * 2, knee[2] + (knee[2] - mid[2]) * 2];
    solveTwoBone(pose, world, rest, L.chain, ankle, pole, 1);
    forwardKinematics(world, pose, rest);
    setWorldRot(pose, world, L.end, L.mid, endQ);
    forwardKinematics(world, pose, rest);
    worst = Math.max(worst, minY - K[1]);
  }
  return worst;
}

/** Knee joints are kept this high (m, scale 1): the knee's flesh radius. */
const KNEE_FLOOR_R = 0.045;
/** Most a knee swings about its hip–ankle line to clear the floor (radians). */
const KNEE_SWING = 1.0;

/**
 * Where a knee at `K` (hip `H`, ankle `A`) should go to be at least `minY`
 * high: the nearest point of its circle about the hip–ankle axis that clears
 * the floor, the circle's centre, and how much the ankle must rise when no
 * point does.
 */
export function kneeAboveFloor(H: V3, K: V3, A: V3, minY: number): { knee: V3; c: V3; lift: number } {
  const ha: V3 = [A[0] - H[0], A[1] - H[1], A[2] - H[2]];
  const hl = Math.hypot(ha[0], ha[1], ha[2]) || 1;
  const u: V3 = [ha[0] / hl, ha[1] / hl, ha[2] / hl];
  const hk: V3 = [K[0] - H[0], K[1] - H[1], K[2] - H[2]];
  const t = hk[0] * u[0] + hk[1] * u[1] + hk[2] * u[2];
  const c: V3 = [H[0] + u[0] * t, H[1] + u[1] * t, H[2] + u[2] * t];
  const rv: V3 = [K[0] - c[0], K[1] - c[1], K[2] - c[2]];
  const r = Math.hypot(rv[0], rv[1], rv[2]);
  if (r < 1e-5) return { knee: K, c, lift: Math.max(0, minY - K[1]) };
  const d: V3 = [rv[0] / r, rv[1] / r, rv[2] / r];
  const e: V3 = [u[1] * d[2] - u[2] * d[1], u[2] * d[0] - u[0] * d[2], u[0] * d[1] - u[1] * d[0]];
  // y(θ) = c.y + r·R·cos(θ − φ); the current knee is θ = 0.
  const R = Math.hypot(d[1], e[1]);
  const phi = Math.atan2(e[1], d[1]);
  const need = R > 1e-6 ? (minY - c[1]) / (r * R) : Infinity;
  const dlt = Math.atan2(Math.sin(-phi), Math.cos(-phi)); // current angle relative to the top
  let th = 0;
  if (need <= 1) {
    const half = Math.acos(Math.max(-1, need));
    th = Math.abs(dlt) <= half ? 0 : phi + Math.sign(dlt) * half;
  } else th = phi;
  // Continuity: a knee pointing straight down has no "nearer" side to swing up
  // (the two ways round are equal, and choosing flipped it 80 cm in a frame),
  // so the swing is limited to `KNEE_SWING` and fades out as the knee points
  // down; the rest is made up by lifting the leg.
  th = Math.max(-KNEE_SWING, Math.min(KNEE_SWING, th)) * Math.min(1, Math.max(0, (Math.PI - Math.abs(dlt)) / 0.8));
  const cs = Math.cos(th), sn = Math.sin(th);
  const knee: V3 = [c[0] + r * (cs * d[0] + sn * e[0]), c[1] + r * (cs * d[1] + sn * e[1]), c[2] + r * (cs * d[2] + sn * e[2])];
  return { knee, c, lift: Math.max(0, minY - knee[1]) };
}
