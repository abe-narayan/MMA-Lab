/**
 * MOTION CAPTURE FOR THE POST-FIGHT SCRIPT — the get-up off the canvas and the
 * winner's celebration, from the library's `ground.get_up_*` and
 * `celebrate.victory_*` takes (unused until this pass).
 *
 * Retargeted the way the standing animator's capture pass is (`anim/capture.ts`):
 * every clip sample is forward-kinematised on THIS fighter's rest skeleton and
 * reduced to body targets — pelvis position and orientation (from the hip line
 * and the lower spine, not the Hips bone, which some takes rotate
 * arbitrarily), chest relative to pelvis, head relative to chest, clavicles,
 * the fists / elbows and ankles / knees in world space — and the shared
 * `solveSpec` IK builds the pose. Nothing plays bones directly, so a short
 * fighter's hands still reach his knees and every joint keeps the IK's limits.
 *
 * Placement: a clip is laid onto the scene by one rigid transform (a yaw and a
 * floor offset) chosen when the script is built — for the get-up, so the
 * performer's first lying frame lies along the loser's body (hips on his hips,
 * legs along his legs); for the celebration, so the performer starts on the
 * winner's spot facing the crowd. Pure functions of (clip, time, placement).
 */
import type { MotionLibrary } from '../assets/motionLibrary';
import { CapRig, type CapFrame } from '../anim/capture';
import {
  clamp, frame as mkFrame, qconj, qmul, qypr, toWorld, dirToWorld, type Frame, type Q, type V3,
} from '../anim/math';
import { rigInfo, solveSpec, type BodySpec, type RigInfo } from '../anim/spec';
import { createSpec } from '../anim/state';
import { B, forwardKinematics, type Pose, type RestSkeleton, type WorldPose } from '../rig/skeleton';

/** A clip laid onto the scene: clip id, handle, and the rigid placement. */
export interface PlacedClip {
  id: string;
  h: number;
  /** Clip seconds of the part used: [from, to]. */
  from: number;
  to: number;
  place: Frame;
}

/** Where the lying body turns into standing in a get-up take (clip seconds). */
export interface RiseWindow {
  /** The head starts to come up. */
  start: number;
  /** The hips reach standing height. */
  end: number;
}

function eulerYPR(q: Q): [number, number, number] {
  const [x, y, z, w] = q;
  const yaw = Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
  const pitch = Math.asin(clamp(-2 * (y * z - w * x), -1, 1));
  const roll = Math.atan2(2 * (x * y + w * z), 1 - 2 * (x * x + z * z));
  return [yaw, pitch, roll];
}

const mid = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const away = (j: V3, a: V3, b: V3, k: number): V3 => {
  const m = mid(a, b);
  return [j[0] + (j[0] - m[0]) * k, j[1] + (j[1] - m[1]) * k, j[2] + (j[2] - m[2]) * k];
};

/** Flesh radii of the joints kept above the canvas (m, scale 1). */
const FLOOR_JOINTS: [number, number][] = [
  [B.lToe, 0.012], [B.rToe, 0.012], [B.lFoot, 0.04], [B.rFoot, 0.04], [B.lLeg, 0.04], [B.rLeg, 0.04],
  [B.lHand, 0.02], [B.rHand, 0.02], [B.hips, 0.07], [B.spine2, 0.08],
];

/** One fighter's view of the capture for the post-fight script. */
export class FinishCapture {
  readonly rig: RigInfo;
  readonly cap: CapRig;
  private readonly spec: BodySpec = createSpec(mkFrame(0, 0, 0));
  private readonly restPitch: [number, number];

  constructor(readonly lib: MotionLibrary, rest: RestSkeleton) {
    this.rig = rigInfo(rest);
    this.cap = new CapRig(lib, this.rig);
    const pitch = (foot: number, toe: number): number => {
      const h = rest.head;
      const dy = h[foot * 3 + 1]! - h[toe * 3 + 1]!;
      const dh = Math.hypot(h[toe * 3]! - h[foot * 3]!, h[toe * 3 + 2]! - h[foot * 3 + 2]!);
      return Math.atan2(dy, dh);
    };
    this.restPitch = [pitch(B.lFoot, B.lToe), pitch(B.rFoot, B.rToe)];
  }

  has(id: string): boolean {
    return this.lib.has(id);
  }

  frame(id: string, t: number): CapFrame {
    return this.cap.frame(this.lib.handle(id), t);
  }

  /** The rise of a get-up take: from the head starting up to the hips at standing height. */
  riseWindow(id: string): RiseWindow {
    const info = this.lib.info(id);
    const h = this.lib.handle(id);
    const n = Math.max(2, Math.floor(info.duration * 15));
    const heads: number[] = [];
    const hips: number[] = [];
    for (let k = 0; k <= n; k++) {
      const f = this.cap.frame(h, (k / n) * info.duration);
      heads.push(f.head[1]);
      hips.push(f.pel[1]);
    }
    const s = this.rig.scale;
    const head0 = Math.min(...heads.slice(0, Math.max(1, Math.floor(n / 4))));
    const hipTop = Math.max(...hips);
    let start = 0;
    for (let k = 0; k <= n; k++) if (heads[k]! > head0 + 0.05 * s) { start = (Math.max(0, k - 1) / n) * info.duration; break; }
    let end = info.duration;
    for (let k = 0; k <= n; k++) if (hips[k]! > 0.95 * hipTop) { end = (k / n) * info.duration; break; }
    return { start, end: Math.max(end, start + 0.5) };
  }

  /**
   * Placement laying the take's frame `t` along a body: its hips on `hips`
   * (floor x, z) and its hips-to-feet direction along `legs` (radians, atan2).
   * Returns the placement and how well the take's chest direction agrees with
   * `chestUp` (+1 on his back, -1 face down) as a score.
   */
  placeLying(id: string, t: number, hips: [number, number], legs: number): Frame {
    const f = this.frame(id, t);
    const feet = mid(f.ank[0], f.ank[1]);
    const a = Math.atan2(feet[0] - f.pel[0], feet[2] - f.pel[2]);
    return placeAt(f.pel, legs - a, hips);
  }

  /** Placement starting the take's frame `t` on `spot`, its chest facing `facing`. */
  placeStanding(id: string, t: number, spot: [number, number], facing: number): Frame {
    const f = this.frame(id, t);
    return placeAt(f.pel, facing - f.chYaw, spot);
  }

  /** Chest "up" of a take frame (the chest's forward vector's height: + on the back, - face down). */
  chestUp(id: string, t: number): number {
    const f = this.frame(id, t);
    return -Math.sin(f.chPitch);
  }

  /** Where the take's hips are at clip time `t`, placed (floor x, z). */
  hipsAt(c: PlacedClip, t: number): [number, number] {
    const f = this.cap.frame(c.h, clamp(t, 0, this.lib.info(c.h).duration));
    const w = toWorld(c.place, f.pel);
    return [w[0], w[2]];
  }

  /** Pose the body from placed clip `c` at clip time `t`; `world` is left current. */
  pose(c: PlacedClip, t: number, out: Pose, world: WorldPose): void {
    const f = this.cap.frame(c.h, clamp(t, 0, this.lib.info(c.h).duration));
    const fr = c.place;
    const W = (p: V3): V3 => toWorld(fr, p);
    const spec = this.spec;
    spec.frame = fr;
    spec.free = true;
    spec.pelvis = W(f.pel);
    spec.pelvisYaw = f.pelYaw;
    spec.pelvisPitch = f.pelPitch;
    spec.pelvisRoll = f.pelRoll;
    const qP = qypr(f.pelYaw, f.pelPitch, f.pelRoll);
    const qC = qypr(f.chYaw, f.chPitch, f.chRoll);
    const qH = qypr(f.hdYaw, f.hdPitch, f.hdRoll);
    [spec.spineYaw, spec.spinePitch, spec.spineRoll] = eulerYPR(qmul(qconj(qP), qC));
    const [hy, hp, hr] = eulerYPR(qmul(qconj(qC), qH));
    spec.head.lookAt = null;
    spec.head.lookW = 0;
    spec.head.yaw = hy;
    spec.head.pitch = hp;
    spec.head.roll = hr;
    spec.clavRaise = [f.clav[0], f.clav[2]];
    spec.clavFwd = [f.clav[1], f.clav[3]];
    for (const side of [0, 1] as const) {
      const hd = spec.hands[side];
      hd.pos = W(f.fist[side]);
      hd.fistTarget = true;
      hd.pole = W(away(f.el[side], f.sh[side], f.fist[side], 1.5));
      hd.palm = dirToWorld(fr, f.palm[side]);
      hd.w = 1;
      hd.fist = 0.6;
      const ft = spec.feet[side];
      ft.ankle = W(f.ank[side]);
      ft.ball = W(f.toe[side]);
      ft.pole = W(away(f.knee[side], f.hip[side], f.ank[side], 1.5));
      ft.yaw = fr.yaw + f.fYaw[side];
      ft.lift = f.fPitch[side] - this.restPitch[side];
      ft.airPitch = 0;
      ft.toeFlat = 0;
    }
    spec.face.fill(0);
    solveSpec(spec, this.rig, out, world, false);
    // The performer's floor is not quite ours (his proportions): nothing under the canvas.
    const s = this.rig.scale;
    let low = 0;
    for (const [j, r] of FLOOR_JOINTS) low = Math.max(low, r * s - world.pos[j * 3 + 1]!);
    if (low > 1e-4) {
      out.rootPos[1] += low;
      forwardKinematics(world, out, this.rig.rest);
    }
  }
}

function placeAt(p: V3, yaw: number, at: [number, number]): Frame {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // toWorld(frame, p) = [ox + p.x c + p.z s, ., oz - p.x s + p.z c] = at
  return mkFrame(at[0] - (p[0] * c + p[2] * s), at[1] - (-p[0] * s + p[2] * c), yaw);
}

/** Best start (clip seconds) of a `len`-second window of a celebration take: the most time with the hands high. */
export function celebrationStart(fc: FinishCapture, id: string, len: number): number {
  const info = fc.lib.info(id);
  const h = fc.lib.handle(id);
  const step = 0.25;
  const n = Math.floor(info.duration / step);
  const score: number[] = [];
  for (let k = 0; k <= n; k++) {
    const f = fc.cap.frame(h, k * step);
    score.push(Math.max(f.fist[0][1], f.fist[1][1]) - f.head[1]);
  }
  const w = Math.max(1, Math.round(len / step));
  let best = 0, bestV = -Infinity;
  for (let k = 0; k + w <= n; k++) {
    let v = 0;
    for (let j = k; j < k + w; j++) v += score[j]!;
    if (v > bestV) { bestV = v; best = k; }
  }
  return best * step;
}
