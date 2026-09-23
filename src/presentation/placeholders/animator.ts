/**
 * PLACEHOLDER ANIMATOR — a fighting stance at the recorded position.
 *
 * Until `anim/` lands, every fighter stands in a guard: feet shoulder-width
 * apart and staggered by stance, knees soft, hands up by the chin (two-bone IK
 * from `rig/ik.ts`), body bladed toward the lead side, facing and position
 * interpolated between the two recorded snapshots. Grounded and downed
 * fighters are laid on the canvas so a takedown at least reads as one.
 *
 * It is a pure function of (frame, next, alpha): no state survives between
 * frames, so there is nothing to reset on a seek.
 */
import type { FighterSnapshot } from '../../sim';
import type { AnimDebug, Animator, BoutPresentation, FrameInput } from '../contract';
import {
  B, createWorldPose, forwardKinematics, resetPose, type Pose, type RestSkeleton, type WorldPose,
} from '../rig/skeleton';
import { LIMBS, axisAngle, solveTwoBone } from '../rig/ik';

type V3 = [number, number, number];

/** Shortest-arc angle interpolation. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

function quatY(out: Float32Array, yaw: number): void {
  out[0] = 0; out[1] = Math.sin(yaw / 2); out[2] = 0; out[3] = Math.cos(yaw / 2);
}

/** Rotate a fighter-local offset (x = fighter's left, z = forward) into world space. */
function local(yaw: number, x: number, y: number, z: number, ox: number, oz: number): V3 {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [ox + x * c + z * s, y, oz - x * s + z * c];
}

export class PlaceholderAnimator implements Animator {
  private rests: readonly RestSkeleton[] = [];
  private readonly worlds: WorldPose[] = [];
  private last: { layer: string }[] = [];

  setBout(_bout: BoutPresentation, rests: readonly RestSkeleton[]): void {
    this.rests = rests;
    this.worlds.length = 0;
    for (let i = 0; i < rests.length; i++) this.worlds.push(createWorldPose());
    this.last = rests.map(() => ({ layer: 'guard' }));
  }

  reset(): void { /* stateless */ }

  evaluate(input: FrameInput, _realDt: number, out: Pose[]): void {
    const { frame, next, alpha } = input;
    for (let i = 0; i < out.length && i < this.rests.length; i++) {
      const a = frame.fighters[i];
      if (!a) continue;
      const b = next?.fighters[i] ?? a;
      this.poseFighter(i, a, b, alpha, out[i]);
    }
  }

  private poseFighter(i: number, a: FighterSnapshot, b: FighterSnapshot, t: number, pose: Pose): void {
    const rest = this.rests[i];
    const world = this.worlds[i];
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const facing = lerpAngle(a.facing, b.facing, t);
    const hipH = rest.head[B.hips * 3 + 1];
    const s = rest.statureM / 1.75;
    resetPose(pose);

    const lying = a.posture === 'down' || a.posture === 'out'
      || (a.posture === 'ground' && a.role !== 'top' && a.role !== 'attacker');
    if (lying) {
      this.last[i].layer = 'lying';
      // On the back, head toward the fighter's facing, arms by the sides.
      pose.rootPos.set([x, 0.12 * s, z]);
      const yaw = new Float32Array(4);
      quatY(yaw, facing);
      const pitch = axisAngle([1, 0, 0], -Math.PI / 2);
      mulInto(pose.rootQuat, yaw, pitch);
      armsDown(pose);
      return;
    }

    const kneeling = a.posture === 'ground';
    this.last[i].layer = kneeling ? 'top' : 'guard';
    const orthodox = a.stance === 'orthodox';
    const side = orthodox ? 1 : -1; // lead side: +X (left) for orthodox
    // Bladed: the lead shoulder turns toward the opponent.
    const blade = -0.38 * side;
    const drop = kneeling ? hipH * 0.42 : 0.07 * s;
    pose.rootPos.set([x, hipH - drop, z]);
    quatY(pose.rootQuat, facing + blade);

    // Counter-rotate the chest and head so the eyes face the opponent.
    pose.local.set(axisAngle([0, 1, 0], -blade * 0.45), B.spine2 * 4);
    pose.local.set(axisAngle([0, 1, 0], -blade * 0.5), B.neck * 4);
    if (kneeling) pose.local.set(axisAngle([1, 0, 0], 0.55), B.spine * 4);

    forwardKinematics(world, pose, rest);

    // Feet: shoulder-width, staggered along the stance line (in the facing frame).
    const halfStance = 0.2 * s;
    const stagger = 0.24 * s;
    const lead: V3 = local(facing, 0.13 * s * side, 0.08 * s, stagger, x, z);
    const rear: V3 = local(facing, -0.13 * s * side, 0.08 * s, -stagger, x, z);
    const lFoot = orthodox ? lead : rear;
    const rFoot = orthodox ? rear : lead;
    if (kneeling) {
      lFoot[1] = 0.1 * s; rFoot[1] = 0.1 * s;
    }
    const kneePole = (f: V3): V3 => local(facing, 0, 0.5, 1.5, f[0], f[2]);
    solveTwoBone(pose, world, rest, LIMBS.lLeg, [lFoot[0] + 0 * halfStance, lFoot[1], lFoot[2]], kneePole(lFoot));
    solveTwoBone(pose, world, rest, LIMBS.rLeg, rFoot, kneePole(rFoot));
    forwardKinematics(world, pose, rest);

    // Hands: lead hand a forearm in front of the chin, rear hand at the jaw.
    const chinY = rest.head[B.head * 3 + 1] - drop - 0.04 * s;
    const lead3: V3 = local(facing, 0.1 * s * side, chinY - 0.02, 0.3 * s, x, z);
    const rear3: V3 = local(facing, -0.12 * s * side, chinY - 0.03, 0.17 * s, x, z);
    const lHand = orthodox ? lead3 : rear3;
    const rHand = orthodox ? rear3 : lead3;
    const elbowPole = (sideSign: number): V3 => local(facing, 0.5 * sideSign, chinY - 0.9, 0.1, x, z);
    solveTwoBone(pose, world, rest, LIMBS.lArm, lHand, elbowPole(1));
    solveTwoBone(pose, world, rest, LIMBS.rArm, rHand, elbowPole(-1));
  }

  debug(fighter: number): AnimDebug {
    return {
      layer: this.last[fighter]?.layer ?? 'none',
      technique: null,
      phase: 0,
      ikTargets: [],
      tierRules: [],
    };
  }
}

function mulInto(out: Float32Array, a: Float32Array, b: Float32Array): void {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** Arms from the T-pose down to the sides (left arm lies along +X, right along -X). */
function armsDown(pose: Pose): void {
  pose.local.set(axisAngle([0, 0, 1], -1.3), B.lArm * 4);
  pose.local.set(axisAngle([0, 0, 1], 1.3), B.rArm * 4);
}

export function createPlaceholderAnimator(): Animator {
  return new PlaceholderAnimator();
}
