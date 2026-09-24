/**
 * Hand-to-wrist contact: the referee's palm around a fighter's wrist.
 *
 * The contact is measured between the centre of the referee's palm (half way
 * along his Hand bone) and the fighter's wrist joint (his Hand bone's head):
 * the palm is in contact when that distance equals the wrist's radius plus
 * half the palm's thickness. `gripArm` solves an arm so its palm centre lands
 * exactly on a point (iterating the two-bone IK against the hand's own
 * direction), which is how the referee takes both fighters by the wrist and
 * raises the winner's arm without the hands drifting apart.
 */
import { forwardKinematics, type Pose, type RestSkeleton, type WorldPose } from '../rig/skeleton';
import { solveTwoBone, type LimbChain } from '../rig/ik';

type V3 = [number, number, number];

/** Radius of a wrist (m). */
export const WRIST_RADIUS_M = 0.03;
/** Half the thickness of a palm (m). */
export const PALM_HALF_M = 0.015;
/** Where the palm's centre is along the Hand bone (0 wrist .. 1 fingertips' base). */
export const PALM_FRAC = 0.5;
/** Palm centre to wrist centre when gripping. */
export const GRIP_DISTANCE_M = WRIST_RADIUS_M + PALM_HALF_M;

export function palmPoint(w: WorldPose, hand: number): V3 {
  const o = hand * 3;
  return [
    w.pos[o] + (w.tip[o] - w.pos[o]) * PALM_FRAC,
    w.pos[o + 1] + (w.tip[o + 1] - w.pos[o + 1]) * PALM_FRAC,
    w.pos[o + 2] + (w.tip[o + 2] - w.pos[o + 2]) * PALM_FRAC,
  ];
}

export function wristPoint(w: WorldPose, hand: number): V3 {
  const o = hand * 3;
  return [w.pos[o], w.pos[o + 1], w.pos[o + 2]];
}

/** Surface gap (m) between a palm and a wrist: 0 = touching, < 0 = pressed in. */
export function gripGap(holder: WorldPose, holderHand: number, held: WorldPose, heldHand: number): number {
  const p = palmPoint(holder, holderHand);
  const q = wristPoint(held, heldHand);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) - GRIP_DISTANCE_M;
}

/**
 * Where a palm goes to hold `wrist` from the side of `from` (the holder's
 * shoulder): on the line between them, `GRIP_DISTANCE_M` off the wrist.
 */
export function palmTargetFor(wrist: V3, from: V3): V3 {
  let dx = from[0] - wrist[0];
  let dy = (from[1] - wrist[1]) * 0.35;
  let dz = from[2] - wrist[2];
  const n = Math.hypot(dx, dy, dz) || 1;
  dx /= n; dy /= n; dz /= n;
  return [wrist[0] + dx * GRIP_DISTANCE_M, wrist[1] + dy * GRIP_DISTANCE_M, wrist[2] + dz * GRIP_DISTANCE_M];
}

/**
 * Solve `chain` (an arm) so its palm centre lands on `palm`. `world` must be
 * current for the arm's parent. Returns the residual distance (m).
 */
export function gripArm(
  pose: Pose, world: WorldPose, rest: RestSkeleton, chain: LimbChain, palm: V3, pole: V3,
): number {
  const hand = chain.end;
  const len = rest.length[hand] * PALM_FRAC;
  let err = Infinity;
  for (let it = 0; it < 5; it++) {
    const o = hand * 3;
    let hx = world.tip[o] - world.pos[o];
    let hy = world.tip[o + 1] - world.pos[o + 1];
    let hz = world.tip[o + 2] - world.pos[o + 2];
    const hn = Math.hypot(hx, hy, hz) || 1;
    hx /= hn; hy /= hn; hz /= hn;
    const wrist: V3 = [palm[0] - hx * len, palm[1] - hy * len, palm[2] - hz * len];
    solveTwoBone(pose, world, rest, chain, wrist, pole);
    forwardKinematics(world, pose, rest);
    const p = palmPoint(world, hand);
    err = Math.hypot(p[0] - palm[0], p[1] - palm[1], p[2] - palm[2]);
    if (err < 0.002) break;
  }
  return err;
}

