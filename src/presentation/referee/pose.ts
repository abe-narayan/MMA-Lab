/**
 * REFEREE POSE — a simple procedural body for the third man in the cage.
 *
 * The sim has no referee body (presentation only): `arena/referee.ts` says
 * where he stands, which way he faces, how low he crouches and what he is
 * doing (`gesture`). This turns that placement into a `Pose` on the canonical
 * skeleton:
 *
 *   - stance and crouch: hips drop and the trunk leans in as `crouch` rises
 *     (ground work, counts), feet widen and stagger;
 *   - walking: a two-foot gait whose phase advances with the distance he
 *     actually travelled, so feet cycle only while he moves and plant when he
 *     stops; step length and lift scale with his speed;
 *   - head: pitched to keep his eyes on the action over the lean;
 *   - arms (two-bone IK, `rig/ik.ts`): hands ready in front of the belt while
 *     watching, on the knees when crouched over ground work, both arms out
 *     between the fighters when separating, the lead arm in on a stoppage, a
 *     raised hand counting over a downed fighter, a pointing arm for a warning.
 *
 * Hand targets are smoothed in body space (so they never lag the walk) and
 * snap on a discontinuity. Deterministic for a given call sequence; no
 * `Math.random()`, no sim access.
 */
import type { RefereeGesture, RefereePlacement } from '../arena/referee';
import {
  B, createPose, createWorldPose, forwardKinematics, mulQuat,
  type Pose, type RestSkeleton, type WorldPose,
} from '../rig/skeleton';
import { LIMBS, axisAngle, conjugateInto, solveTwoBone } from '../rig/ik';
import { curlFingers, kneelLegs } from '../people/figure';
import { gripArm } from '../finish/grip';

type V3 = [number, number, number];

/** One step every this many metres travelled (a referee's brisk walk). */
export const STRIDE_M = 0.62;

export interface RefereeFrame {
  placement: RefereePlacement;
  /** The fighters' world poses this frame (arm and gaze targets). */
  fighters: readonly WorldPose[];
  realDt: number;
  /** Simulated seconds that passed (realDt × playback rate; 0 when paused). */
  simDt: number;
  /** First frame after a seek: every filter snaps. */
  snap: boolean;
  /** Scripted extras (the end of the bout, `finish/`): override the gesture's hands and legs. */
  extra?: RefereeExtras;
}

/** Scripted hands and legs for the post-fight staging. Index 0 = left hand, 1 = right. */
export interface RefereeExtras {
  /** Palm centres placed exactly (hand-to-wrist contact); not smoothed. */
  grips?: [V3 | null, V3 | null];
  /** Soft wrist targets (a hand on a shoulder, hovering over a chest); smoothed like gestures. */
  reach?: [V3 | null, V3 | null];
  /** 0..1 down on one knee. */
  kneel?: number;
  /** 0..1 waving the bout off (arms crossing over the loser). */
  wave?: number;
  /** Seconds (the wave's rhythm). */
  time?: number;
  /** Where he looks (overrides the attended fighter / the pair's middle). */
  look?: V3;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export class RefereeAnimator {
  readonly pose: Pose = createPose();
  readonly world: WorldPose = createWorldPose();
  /** Gait phase (radians) and smoothed speed (m/s of sim time), for tests and debug. */
  phase = 0;
  speed = 0;
  private lastX = 0;
  private lastZ = 0;
  private primed = false;
  /** Smoothed hand targets relative to the root's floor point, world axes. */
  private readonly hands: [V3, V3] = [[0, 0, 0], [0, 0, 0]];
  private readonly q1 = new Float32Array(4);
  private readonly q2 = new Float32Array(4);

  constructor(readonly rest: RestSkeleton) {}

  reset(): void {
    this.primed = false;
  }

  evaluate(f: RefereeFrame): Pose {
    const p = f.placement;
    const rest = this.rest;
    const pose = this.pose;
    const world = this.world;
    const snap = f.snap || !this.primed;

    // ---- gait -----------------------------------------------------------------
    if (snap) {
      this.lastX = p.x; this.lastZ = p.z; this.phase = 0; this.speed = 0;
    }
    const moved = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    this.lastX = p.x; this.lastZ = p.z;
    const vInst = f.simDt > 1e-4 ? Math.min(5, moved / f.simDt) : 0;
    if (!snap) this.speed += (vInst - this.speed) * Math.min(1, Math.max(0, f.realDt) * 6);
    this.phase = (this.phase + (moved / STRIDE_M) * Math.PI) % (Math.PI * 2);
    const gait = clamp(this.speed / 1.2, 0, 1);

    const face = p.facing;
    const fwd: V3 = [Math.sin(face), 0, Math.cos(face)];
    // The body's left (+X in model space) turned by `facing`.
    const left: V3 = [Math.cos(face), 0, -Math.sin(face)];
    const c = clamp(p.crouch, 0, 1);
    const g = p.gesture;
    const reaching = g === 'break' || g === 'stop' || g === 'ready';

    // ---- root and trunk ---------------------------------------------------------
    for (let i = 0; i < pose.local.length; i += 4) {
      pose.local[i] = 0; pose.local[i + 1] = 0; pose.local[i + 2] = 0; pose.local[i + 3] = 1;
    }
    pose.face.fill(0);
    const hipY = rest.head[B.hips * 3 + 1];
    const ankleY = rest.head[B.lFoot * 3 + 1];
    const bob = Math.abs(Math.sin(this.phase)) * 0.022 * gait;
    const drop = 0.03 + c * 0.34 + gait * 0.02 + bob;
    pose.rootPos[0] = p.x;
    pose.rootPos[1] = hipY - drop;
    pose.rootPos[2] = p.z;
    const hipPitch = c * 0.28 + (reaching ? 0.08 : 0);
    const yaw = axisAngle([0, 1, 0], face);
    const pitch = axisAngle([1, 0, 0], hipPitch);
    mulQuat(pose.rootQuat, 0, yaw, 0, pitch, 0);
    const lean = c * 0.4 + (reaching ? 0.14 : 0) + gait * 0.04;
    const sp = axisAngle([1, 0, 0], lean / 3);
    for (const b of [B.spine, B.spine1, B.spine2]) pose.local.set(sp, b * 4);

    // Gaze: eyes on the focus over the lean.
    const focus = f.extra?.look ?? this.focusPoint(p, f.fighters, fwd);
    const eyeY = pose.rootPos[1] + 0.72 * (1 - c * 0.25);
    const horiz = Math.max(0.3, Math.hypot(focus[0] - p.x, focus[2] - p.z));
    const wantPitch = Math.atan2(eyeY - focus[1], horiz);
    const headPitch = clamp(wantPitch - (hipPitch + lean), -0.7, 0.9);
    pose.local.set(axisAngle([1, 0, 0], headPitch * 0.4), B.neck * 4);
    pose.local.set(axisAngle([1, 0, 0], headPitch * 0.6), B.head * 4);

    forwardKinematics(world, pose, rest);

    // ---- legs -----------------------------------------------------------------
    const w = 0.12 + c * 0.13;
    const stagger = 0.08 * c;
    for (const s of [1, -1] as const) {
      const ph = this.phase + (s > 0 ? 0 : Math.PI);
      const along = Math.sin(ph) * 0.26 * gait + stagger * s;
      const lift = Math.max(0, Math.cos(ph)) * 0.09 * gait;
      const target: V3 = [
        p.x + left[0] * s * w + fwd[0] * along,
        ankleY + lift,
        p.z + left[2] * s * w + fwd[2] * along,
      ];
      const chain = s > 0 ? LIMBS.lLeg : LIMBS.rLeg;
      const hip = chain.upper * 3;
      const pole: V3 = [
        (world.pos[hip] + target[0]) / 2 + fwd[0] + left[0] * s * 0.15,
        (world.pos[hip + 1] + target[1]) / 2,
        (world.pos[hip + 2] + target[2]) / 2 + fwd[2] + left[2] * s * 0.15,
      ];
      solveTwoBone(pose, world, rest, chain, target, pole);
    }
    forwardKinematics(world, pose, rest);
    // Feet flat on the floor, pointing where he faces (toes out a little).
    for (const s of [1, -1] as const) {
      const shin = s > 0 ? B.lLeg : B.rLeg;
      const foot = s > 0 ? B.lFoot : B.rFoot;
      conjugateInto(this.q1, world.quat.subarray(shin * 4, shin * 4 + 4));
      const out = axisAngle([0, 1, 0], face + s * 0.12);
      mulQuat(this.q2, 0, this.q1, 0, out, 0);
      pose.local.set(this.q2, foot * 4);
    }
    forwardKinematics(world, pose, rest);
    const ex = f.extra;
    if (ex?.kneel && ex.kneel > 0) kneelLegs(pose, world, rest, face, clamp(ex.kneel, 0, 1));

    // ---- arms -----------------------------------------------------------------
    const armLen = rest.length[B.lArm] + rest.length[B.lForeArm];
    const k = snap ? 1 : Math.min(1, Math.max(0, f.realDt) * 7);
    const wave = clamp(ex?.wave ?? 0, 0, 1);
    for (const s of [1, -1] as const) {
      const chain = s > 0 ? LIMBS.lArm : LIMBS.rArm;
      const sh: V3 = [world.pos[chain.upper * 3], world.pos[chain.upper * 3 + 1], world.pos[chain.upper * 3 + 2]];
      let t = this.handTarget(g, s, c, sh, focus, fwd, left, armLen, world);
      const soft = ex?.reach?.[s > 0 ? 0 : 1];
      if (soft) t = soft;
      if (wave > 0) {
        // Waving it off: both arms scissor across in front of the chest, over the loser.
        const ph = (ex?.time ?? 0) * Math.PI * 2 * 1.35 + (s > 0 ? 0 : Math.PI);
        const across = Math.sin(ph) * 0.34;
        const wv: V3 = [
          sh[0] + fwd[0] * 0.42 + left[0] * (across - s * 0.12),
          sh[1] - 0.12 + Math.cos(ph) * 0.06,
          sh[2] + fwd[2] * 0.42 + left[2] * (across - s * 0.12),
        ];
        t = [t[0] + (wv[0] - t[0]) * wave, t[1] + (wv[1] - t[1]) * wave, t[2] + (wv[2] - t[2]) * wave];
      }
      const h = this.hands[s > 0 ? 0 : 1];
      const lx = t[0] - p.x, ly = t[1], lz = t[2] - p.z;
      const kk = wave > 0 ? Math.min(1, k * 3) : k;
      h[0] += (lx - h[0]) * kk; h[1] += (ly - h[1]) * kk; h[2] += (lz - h[2]) * kk;
      const target: V3 = [p.x + h[0], h[1], p.z + h[2]];
      const pole: V3 = [
        sh[0] - fwd[0] * 0.3 + left[0] * s * 0.45,
        sh[1] - 1,
        sh[2] - fwd[2] * 0.3 + left[2] * s * 0.45,
      ];
      solveTwoBone(pose, world, rest, chain, target, pole);
    }
    forwardKinematics(world, pose, rest);
    // Exact grips last (hand-to-wrist contact), fingers closed round the wrist.
    const grips = ex?.grips;
    if (grips && (grips[0] || grips[1])) {
      for (const s of [1, -1] as const) {
        const palm = grips[s > 0 ? 0 : 1];
        if (!palm) continue;
        const chain = s > 0 ? LIMBS.lArm : LIMBS.rArm;
        const sh: V3 = [world.pos[chain.upper * 3], world.pos[chain.upper * 3 + 1], world.pos[chain.upper * 3 + 2]];
        // Elbow out to the side and a little back (up and out when the arm is raised).
        const up = palm[1] > sh[1] ? 1 : 0;
        const pole: V3 = [
          sh[0] + left[0] * s * 0.5 - fwd[0] * 0.25,
          sh[1] - 0.6 + up * 0.5,
          sh[2] + left[2] * s * 0.5 - fwd[2] * 0.25,
        ];
        gripArm(pose, world, rest, chain, palm, pole);
        const hnd = this.hands[s > 0 ? 0 : 1];
        const e = chain.end * 3;
        hnd[0] = world.pos[e] - p.x; hnd[1] = world.pos[e + 1]; hnd[2] = world.pos[e + 2] - p.z;
      }
      curlFingers(pose, [grips[0] ? 0.75 : 0.2, grips[1] ? 0.75 : 0.2]);
      forwardKinematics(world, pose, rest);
    }
    this.primed = true;
    return pose;
  }

  /** Where he is looking and reaching: the attended fighter, else the pair's middle. */
  private focusPoint(p: RefereePlacement, fighters: readonly WorldPose[], fwd: V3): V3 {
    const at = (w: WorldPose): V3 => [w.pos[B.spine2 * 3], w.pos[B.spine2 * 3 + 1], w.pos[B.spine2 * 3 + 2]];
    const focused = p.focusId >= 0 ? fighters[p.focusId] : undefined;
    if (focused) return at(focused);
    if (fighters.length >= 2) {
      const a = at(fighters[0]);
      const b = at(fighters[1]);
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    }
    if (fighters.length === 1) return at(fighters[0]);
    return [p.x + fwd[0] * 2, 1.2, p.z + fwd[2] * 2];
  }

  private handTarget(
    g: RefereeGesture, s: 1 | -1, c: number, sh: V3, focus: V3, fwd: V3, left: V3, armLen: number, world: WorldPose,
  ): V3 {
    const reach = (frac: number, dy = 0): V3 => {
      let dx = focus[0] - sh[0], dyy = focus[1] + dy - sh[1], dz = focus[2] - sh[2];
      const n = Math.hypot(dx, dyy, dz) || 1;
      dx /= n; dyy /= n; dz /= n;
      return [sh[0] + dx * armLen * frac, sh[1] + dyy * armLen * frac, sh[2] + dz * armLen * frac];
    };
    const hips = B.hips * 3;
    const ready = (): V3 => [
      world.pos[hips] + fwd[0] * 0.27 + left[0] * s * 0.11,
      world.pos[hips + 1] + 0.12,
      world.pos[hips + 2] + fwd[2] * 0.27 + left[2] * s * 0.11,
    ];
    const onKnee = (): V3 => {
      const kn = (s > 0 ? B.lLeg : B.rLeg) * 3;
      return [world.pos[kn] + fwd[0] * 0.05, world.pos[kn + 1] + 0.07, world.pos[kn + 2] + fwd[2] * 0.05];
    };
    const relaxed = (): V3 => [
      sh[0] + fwd[0] * 0.08 + left[0] * s * 0.05, sh[1] - armLen * 0.92, sh[2] + fwd[2] * 0.08 + left[2] * s * 0.05,
    ];
    const lead = s < 0; // the right hand does the signalling
    // Raising the winner's hand: the arm on the winner's side goes straight up
    // beside the winner's shoulder (holding his wrist), the other hangs.
    const winnerSide = (focus[0] - sh[0]) * left[0] + (focus[2] - sh[2]) * left[2] > 0 ? 1 : -1;
    switch (g) {
      case 'raise':
        return s === winnerSide
          ? [sh[0] + (focus[0] - sh[0]) * 0.45, sh[1] + armLen * 0.92, sh[2] + (focus[2] - sh[2]) * 0.45]
          : relaxed();
      case 'ready':
        return [
          sh[0] + fwd[0] * 0.4 + left[0] * s * 0.1, sh[1] - 0.3, sh[2] + fwd[2] * 0.4 + left[2] * s * 0.1,
        ];
      case 'break': return reach(0.92);
      case 'stop': return lead ? reach(0.96) : reach(0.8, -0.15);
      case 'count':
        return lead
          ? [sh[0] + fwd[0] * 0.3 + left[0] * 0.02, sh[1] + 0.3, sh[2] + fwd[2] * 0.3 + left[2] * 0.02]
          : reach(0.82);
      case 'warn': return lead ? reach(0.98, 0.1) : ready();
      case 'start': return lead ? reach(0.88) : ready();
      case 'neutral': return relaxed();
      case 'watch':
      default:
        return c > 0.3 ? onKnee() : ready();
    }
  }
}
