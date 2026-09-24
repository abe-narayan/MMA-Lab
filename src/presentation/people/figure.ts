/**
 * FIGURE POSER — people moving about the cage when nobody is fighting.
 *
 * The standing animator poses fighters in a fight; the referee animator poses
 * the official. Between rounds and after the bout the fighters walk to their
 * corner and back, celebrate, sit on the canvas, stand for the decision; the
 * cornermen walk in, kneel in front of their man and leave. This module
 * turns a small cue (`FigureCue`) into a `Pose` on any body's rest skeleton.
 *
 * It is a pure function of the cue: the gait is driven by the distance the
 * body has walked along its scripted path (`walked`), not by accumulated
 * state, so every caller can compute it from the recording and the time, and
 * a seek, a replay or a scrub gives the same picture.
 *
 * The fighter gait (not the referee's brisk, upright official walk):
 *   - a real stance/swing cycle: each foot is planted at a fixed point along
 *     the path while the body passes over it, then swings to the next point
 *     with a heel strike and a toe-off (feet do not glide at a steady pace);
 *   - the pelvis turns with the swinging leg and sways over the planted foot,
 *     the chest counter-rotates, the shoulders roll;
 *   - loose arms swinging opposite the legs, elbows soft, gloved fists half
 *     closed; the head a little down (tired, walking to the corner);
 *   - the crew style (cornermen) is the same cycle, a shorter step, a little
 *     more upright.
 *
 * Also here: kneeling on one knee (the coach in front of the stool, the
 * referee over a fallen fighter), a squat, bent over with hands on the knees,
 * arms up in celebration, hands on hips, and a sitting-on-the-canvas pose.
 * Every hand goal is two-bone IK (`rig/ik.ts`); `at` goals put the wrist
 * exactly on a world point (contacts).
 */
import {
  B, boneIndex, forwardKinematics, mulQuat,
  type Pose, type RestSkeleton, type WorldPose,
} from '../rig/skeleton';
import { LIMBS, axisAngle, conjugateInto, solveTwoBone } from '../rig/ik';

export type V3 = [number, number, number];

/**
 * A hand's goal. `w` (default 1) blends it in from the relaxed walking arm,
 * so goals can fade in and out without popping.
 */
export type HandGoal = { w?: number } & (
  /** Hanging and swinging with the walk (the default). */
  | { kind: 'swing' }
  /** Fist raised over the head; `spread` out to the side (0..1), `pump` 0..1 bends it down. */
  | { kind: 'up'; spread?: number; pump?: number }
  /** Hand on the hip, elbow out. */
  | { kind: 'hips' }
  /** Hand on the knee (bent over, or kneeling). */
  | { kind: 'knee' }
  /** The wrist (hand joint) exactly on a world point; optional elbow pole. */
  | { kind: 'at'; p: V3; pole?: V3 }
);

export type FigureStyle = 'fighter' | 'crew';

export interface FigureCue {
  x: number;
  z: number;
  /** Heading, radians, atan2(dx, dz). */
  facing: number;
  /** Distance walked along the current path (m): drives the gait phase. */
  walked: number;
  /** Walking speed (m/s); 0 = standing. */
  speed: number;
  /** 0..1 squat (knees bent, hips down, feet planted). */
  crouch?: number;
  /** 0..1 down on one knee (the right), torso upright. */
  kneel?: number;
  /** Extra forward bend of the trunk (radians). */
  bend?: number;
  /** World point the head looks at (default: ahead at eye height). */
  look?: V3 | null;
  hands?: [HandGoal | null, HandGoal | null];
  style?: FigureStyle;
  /** Seconds (breathing, weight shift); any continuous clock. */
  time?: number;
  /** Fist curl per hand 0..1 (default 0.55: gloves, half closed). */
  fist?: [number, number];
}

/** Step length (m) per style; a full gait cycle is two steps. */
export const STEP_M: Record<FigureStyle, number> = { fighter: 0.74, crew: 0.66 };
/** Fraction of a foot's cycle it is planted (the rest it swings). */
const STANCE = 0.62;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const smooth = (t: number): number => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

const FINGERS: { bone: number; side: 0 | 1; k: number; thumb: boolean }[] = [];
for (const [side, pre] of [[0, 'Left'], [1, 'Right']] as const) {
  for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) {
    FINGERS.push({ bone: boneIndex(`${pre}Hand${f}1`), side, k: 1.25, thumb: false });
    FINGERS.push({ bone: boneIndex(`${pre}Hand${f}2`), side, k: 1.6, thumb: false });
    FINGERS.push({ bone: boneIndex(`${pre}Hand${f}3`), side, k: 1.0, thumb: false });
  }
  FINGERS.push({ bone: boneIndex(`${pre}HandThumb2`), side, k: 0.5, thumb: true });
  FINGERS.push({ bone: boneIndex(`${pre}HandThumb3`), side, k: 0.6, thumb: true });
}

/** Curl the fingers of both hands (0 open .. 1 fist). */
export function curlFingers(pose: Pose, fist: readonly [number, number]): void {
  for (const fb of FINGERS) {
    const a = clamp(fist[fb.side], 0, 1) * fb.k * (fb.side === 0 ? -1 : 1);
    pose.local.set(fb.thumb ? axisAngle([0, 1, 0], a * 0.6) : axisAngle([0, 0, 1], a), fb.bone * 4);
  }
}

/**
 * Where foot `k` (0 left, 1 right) is along the path and how high, for a
 * body that has walked `s` metres with step length `step`. Pure.
 * Returns [along offset from the body (m), lift (m), 0..1 swing progress or
 * -1 when planted, heel pitch (rad, + = heel up / toes down)].
 */
export function footCycle(s: number, k: 0 | 1, step: number): [number, number, number, number] {
  const S = step * 2;
  const c = s / S + (k === 0 ? 0 : 0.5);
  const n = Math.floor(c);
  const u = c - n;
  // Planted in the middle of its stance under the body.
  const anchor = (m: number): number => (m + STANCE / 2 - (k === 0 ? 0 : 0.5)) * S;
  if (u < STANCE) {
    // Heel strike at u = 0 (toes up), rolling to the toe by the end of stance.
    const pitch = u < 0.12 ? -0.22 * (1 - u / 0.12) : u > STANCE - 0.18 ? 0.45 * ((u - (STANCE - 0.18)) / 0.18) : 0;
    return [anchor(n) - s, 0, -1, pitch];
  }
  const v = (u - STANCE) / (1 - STANCE);
  const e = smooth(v);
  const a = anchor(n) + (anchor(n + 1) - anchor(n)) * e;
  const lift = Math.sin(Math.PI * v) * 0.075 + (v < 0.3 ? 0.03 * (v / 0.3) : 0.03 * (1 - (v - 0.3) / 0.7));
  const pitch = v < 0.35 ? 0.45 * (1 - v / 0.35) : v > 0.8 ? -0.22 * ((v - 0.8) / 0.2) : 0;
  return [a - s, lift, v, pitch];
}

export class FigurePoser {
  private readonly q1 = new Float32Array(4);

  constructor(readonly rest: RestSkeleton) {}

  /** Pose the body for `c` into `pose` (and its FK into `world`). */
  evaluate(c: FigureCue, pose: Pose, world: WorldPose): Pose {
    const rest = this.rest;
    const style = c.style ?? 'fighter';
    const k = rest.statureM / 1.733;
    const step = STEP_M[style] * k;
    const time = c.time ?? 0;
    const gait = clamp(c.speed / 0.7, 0, 1);
    const crouch = clamp(c.crouch ?? 0, 0, 1);
    const kneel = clamp(c.kneel ?? 0, 0, 1);
    const fighter = style === 'fighter';

    for (let i = 0; i < pose.local.length; i += 4) {
      pose.local[i] = 0; pose.local[i + 1] = 0; pose.local[i + 2] = 0; pose.local[i + 3] = 1;
    }
    pose.face.fill(0);
    const face = c.facing;
    const fwd: V3 = [Math.sin(face), 0, Math.cos(face)];
    const left: V3 = [Math.cos(face), 0, -Math.sin(face)];
    const S = step * 2;
    const cyc = (c.walked / S) * Math.PI * 2;
    const breath = Math.sin(time * 2.1);

    // ---- pelvis and trunk --------------------------------------------------
    const hipY = rest.head[B.hips * 3 + 1];
    const legLen = rest.length[B.lUpLeg] + rest.length[B.lLeg];
    const bob = (1 - Math.cos(cyc * 2)) * 0.5 * 0.022 * gait * k;
    const sway = Math.sin(cyc) * (fighter ? 0.028 : 0.02) * gait * k;
    const idleShift = (1 - gait) * Math.sin(time * 0.37) * 0.012 * k;
    const drop = 0.025 * k + gait * 0.018 * k + bob + crouch * legLen * 0.38;
    const pelvisYaw = Math.sin(cyc) * (fighter ? 0.13 : 0.09) * gait;
    const bend = c.bend ?? 0;
    const hipPitch = crouch * 0.45 + bend * 0.45 + gait * 0.03;
    pose.rootPos[0] = c.x + left[0] * (sway + idleShift);
    pose.rootPos[1] = hipY - drop;
    pose.rootPos[2] = c.z + left[2] * (sway + idleShift);
    mulQuat(pose.rootQuat, 0, axisAngle([0, 1, 0], face + pelvisYaw), 0, axisAngle([1, 0, 0], hipPitch), 0);
    const pelvisRoll = -Math.sin(cyc) * 0.05 * gait;
    mulQuat(pose.rootQuat, 0, pose.rootQuat, 0, axisAngle([0, 0, 1], pelvisRoll), 0);
    // Chest: counter-rotation, a slight slump for a fighter, the rest of the bend.
    const lean = (fighter ? 0.1 : 0.05) + gait * 0.05 + bend * 0.55 + crouch * 0.25 + breath * 0.012;
    const spineYaw = -pelvisYaw * 1.6;
    for (const [b, share] of [[B.spine, 0.3], [B.spine1, 0.33], [B.spine2, 0.37]] as const) {
      mulQuat(this.q1, 0, axisAngle([0, 1, 0], spineYaw * share), 0, axisAngle([1, 0, 0], lean * share), 0);
      mulQuat(this.q1, 0, this.q1, 0, axisAngle([0, 0, 1], -pelvisRoll * share), 0);
      pose.local.set(this.q1, b * 4);
    }
    // Shoulders roll with the arm swing (a fighter's loose walk).
    const roll = fighter ? 0.07 : 0.03;
    pose.local.set(axisAngle([0, 1, 0], -Math.sin(cyc) * roll * gait - 0.05), B.lShoulder * 4);
    pose.local.set(axisAngle([0, 1, 0], -Math.sin(cyc) * roll * gait + 0.05), B.rShoulder * 4);
    forwardKinematics(world, pose, rest);

    // Head: toward the look point (default: ahead, a little down), split neck/head.
    const hp: V3 = [world.pos[B.head * 3], world.pos[B.head * 3 + 1] + 0.1 * k, world.pos[B.head * 3 + 2]];
    const look = c.look ?? [hp[0] + fwd[0] * 4, fighter ? 0.9 : 1.2, hp[2] + fwd[2] * 4];
    const dx = look[0] - hp[0], dy = look[1] - hp[1], dz = look[2] - hp[2];
    const chestYaw = face + pelvisYaw + spineYaw;
    const relYaw = clamp(wrap(Math.atan2(dx, dz) - chestYaw), -1.2, 1.2);
    const relPitch = clamp(Math.atan2(-dy, Math.hypot(dx, dz)) - (hipPitch + lean), -0.7, 0.8);
    mulQuat(this.q1, 0, axisAngle([0, 1, 0], relYaw * 0.4), 0, axisAngle([1, 0, 0], relPitch * 0.4), 0);
    pose.local.set(this.q1, B.neck * 4);
    mulQuat(this.q1, 0, axisAngle([0, 1, 0], relYaw * 0.6), 0, axisAngle([1, 0, 0], relPitch * 0.6), 0);
    pose.local.set(this.q1, B.head * 4);
    forwardKinematics(world, pose, rest);

    // ---- legs ------------------------------------------------------------------
    const ankleY = rest.head[B.lFoot * 3 + 1];
    const width = (0.11 + crouch * 0.1) * k;
    const pitches: [number, number] = [0, 0];
    for (const s of [1, -1] as const) {
      const side = s > 0 ? 0 : 1;
      const [along, lift, , pitch] = footCycle(c.walked, side, step);
      pitches[side] = pitch * gait;
      const stagger = crouch * 0.06 * s * k;
      const a = along * gait + stagger;
      const target: V3 = [
        c.x + left[0] * s * width + fwd[0] * a,
        ankleY + lift * gait + Math.max(0, pitch * gait) * 0.06 * k,
        c.z + left[2] * s * width + fwd[2] * a,
      ];
      const chain = s > 0 ? LIMBS.lLeg : LIMBS.rLeg;
      const hip = chain.upper * 3;
      const pole: V3 = [
        (world.pos[hip] + target[0]) / 2 + fwd[0] + left[0] * s * 0.12,
        (world.pos[hip + 1] + target[1]) / 2,
        (world.pos[hip + 2] + target[2]) / 2 + fwd[2] + left[2] * s * 0.12,
      ];
      solveTwoBone(pose, world, rest, chain, target, pole);
    }
    forwardKinematics(world, pose, rest);
    orientFeet(pose, world, rest, face, pitches);
    kneelLegs(pose, world, rest, face, kneel);

    // ---- arms ------------------------------------------------------------------
    const armLen = rest.length[B.lArm] + rest.length[B.lForeArm];
    const goals = c.hands ?? [null, null];
    for (const s of [1, -1] as const) {
      const side = s > 0 ? 0 : 1;
      const chain = s > 0 ? LIMBS.lArm : LIMBS.rArm;
      const sh: V3 = [world.pos[chain.upper * 3], world.pos[chain.upper * 3 + 1], world.pos[chain.upper * 3 + 2]];
      const g: HandGoal = goals[side] ?? { kind: 'swing' };
      // The relaxed arm: hanging, swinging opposite the leg on this side (the
      // left arm comes forward with the right foot).
      const swing = Math.sin(cyc) * (fighter ? 0.2 : 0.16) * gait * s * k;
      const bent = fighter ? 0.86 : 0.9;
      const relaxed: V3 = [
        sh[0] + fwd[0] * (0.06 + swing) + left[0] * s * 0.07 * k,
        sh[1] - armLen * bent + Math.abs(swing) * 0.25,
        sh[2] + fwd[2] * (0.06 + swing) + left[2] * s * 0.07 * k,
      ];
      const relaxedPole: V3 = [sh[0] - fwd[0] * 0.4 + left[0] * s * 0.25, sh[1] - 0.5, sh[2] - fwd[2] * 0.4 + left[2] * s * 0.25];
      let target: V3 = relaxed;
      let pole: V3 = relaxedPole;
      switch (g.kind) {
        case 'up': {
          const spread = clamp(g.spread ?? 0.35, 0, 1);
          const pump = clamp(g.pump ?? 0, 0, 1);
          const reach = armLen * (0.97 - pump * 0.45);
          const dir: V3 = [left[0] * s * spread * 0.6 + fwd[0] * 0.12, 1, left[2] * s * spread * 0.6 + fwd[2] * 0.12];
          const n = Math.hypot(dir[0], dir[1], dir[2]);
          target = [sh[0] + (dir[0] / n) * reach, sh[1] + (dir[1] / n) * reach, sh[2] + (dir[2] / n) * reach];
          pole = [sh[0] + left[0] * s * 0.6 - fwd[0] * 0.2, sh[1] + 0.1, sh[2] + left[2] * s * 0.6 - fwd[2] * 0.2];
          break;
        }
        case 'hips': {
          const h = s > 0 ? B.lUpLeg : B.rUpLeg;
          target = [
            world.pos[h * 3] + left[0] * s * 0.07 * k - fwd[0] * 0.02,
            world.pos[h * 3 + 1] + 0.1 * k,
            world.pos[h * 3 + 2] + left[2] * s * 0.07 * k - fwd[2] * 0.02,
          ];
          pole = [sh[0] + left[0] * s * 0.7 - fwd[0] * 0.3, sh[1] - 0.2, sh[2] + left[2] * s * 0.7 - fwd[2] * 0.3];
          break;
        }
        case 'knee': {
          const kn = (s > 0 ? B.lLeg : B.rLeg) * 3;
          target = [world.pos[kn] + fwd[0] * 0.05 * k, world.pos[kn + 1] + 0.1 * k, world.pos[kn + 2] + fwd[2] * 0.05 * k];
          pole = [sh[0] + left[0] * s * 0.6, sh[1] - 0.3, sh[2] + left[2] * s * 0.6];
          break;
        }
        case 'at':
          target = g.p;
          if (g.pole) pole = g.pole;
          break;
        case 'swing':
        default:
          break;
      }
      const gw = clamp(g.w ?? 1, 0, 1);
      if (gw < 1) {
        target = [relaxed[0] + (target[0] - relaxed[0]) * gw, relaxed[1] + (target[1] - relaxed[1]) * gw, relaxed[2] + (target[2] - relaxed[2]) * gw];
        pole = [relaxedPole[0] + (pole[0] - relaxedPole[0]) * gw, relaxedPole[1] + (pole[1] - relaxedPole[1]) * gw, relaxedPole[2] + (pole[2] - relaxedPole[2]) * gw];
      }
      solveTwoBone(pose, world, rest, chain, target, pole);
    }
    curlFingers(pose, c.fist ?? [0.55, 0.55]);
    pose.face[7] = 0.3 + 0.3 * breath; // breathe
    forwardKinematics(world, pose, rest);
    return pose;
  }

}

const fq1 = new Float32Array(4);
const fq2 = new Float32Array(4);

/** Feet: pointing where he faces (toes out a little), pitched (+ = heel up, toes down). */
export function orientFeet(pose: Pose, world: WorldPose, rest: RestSkeleton, face: number, pitches: readonly [number, number]): void {
  for (const s of [1, -1] as const) {
    const shin = s > 0 ? B.lLeg : B.rLeg;
    const foot = s > 0 ? B.lFoot : B.rFoot;
    conjugateInto(fq1, world.quat.subarray(shin * 4, shin * 4 + 4));
    mulQuat(fq2, 0, axisAngle([0, 1, 0], face + s * 0.1), 0, axisAngle([1, 0, 0], pitches[s > 0 ? 0 : 1]), 0);
    mulQuat(fq2, 0, fq1, 0, fq2, 0);
    pose.local.set(fq2, foot * 4);
  }
  forwardKinematics(world, pose, rest);
}

/**
 * Down on the right knee: the hips drop to thigh height over the knee, the
 * left foot planted in front, the right knee on the canvas under the hip with
 * the shin flat behind on the toes. Blended in by `w` over whatever standing
 * legs `pose` has (the hips and legs only; the trunk and arms are the caller's).
 */
export function kneelLegs(pose: Pose, world: WorldPose, rest: RestSkeleton, facing: number, w: number): void {
  if (w <= 0) return;
  const k = rest.statureM / 1.733;
  const fwd: V3 = [Math.sin(facing), 0, Math.cos(facing)];
  const left: V3 = [Math.cos(facing), 0, -Math.sin(facing)];
  const thigh = rest.length[B.lUpLeg];
  const shin = rest.length[B.lLeg];
  const hipsToHip = rest.head[B.hips * 3 + 1] - rest.head[B.lUpLeg * 3 + 1];
  const ankleY = rest.head[B.lFoot * 3 + 1];
  // Knee on the canvas (its radius ~5 cm), thigh near vertical.
  const hipsY = 0.05 * k + thigh * 0.97 + hipsToHip;
  pose.rootPos[1] += (hipsY - pose.rootPos[1]) * w;
  forwardKinematics(world, pose, rest);
  for (const s of [1, -1] as const) {
    const chain = s > 0 ? LIMBS.lLeg : LIMBS.rLeg;
    const hip = chain.upper * 3;
    let target: V3;
    let pole: V3;
    if (s > 0) {
      // Front foot: planted ahead, shin about vertical.
      const ahead = Math.sqrt(Math.max(0.01, thigh * thigh - Math.pow(Math.max(0, world.pos[hip + 1] - shin - ankleY), 2)));
      target = [
        world.pos[hip] + fwd[0] * ahead * 0.95 + left[0] * 0.04 * k,
        ankleY,
        world.pos[hip + 2] + fwd[2] * ahead * 0.95 + left[2] * 0.04 * k,
      ];
      pole = [world.pos[hip] + fwd[0] * 1.2, world.pos[hip + 1] + 0.2, world.pos[hip + 2] + fwd[2] * 1.2];
    } else {
      // Back leg: knee under the hip on the canvas, shin flat behind.
      target = [
        world.pos[hip] - fwd[0] * shin * 0.92 - left[0] * 0.03 * k,
        ankleY + 0.04 * k,
        world.pos[hip + 2] - fwd[2] * shin * 0.92 - left[2] * 0.03 * k,
      ];
      pole = [world.pos[hip] + fwd[0] * 0.3, -1, world.pos[hip + 2] + fwd[2] * 0.3];
    }
    solveTwoBone(pose, world, rest, chain, target, pole, w);
  }
  forwardKinematics(world, pose, rest);
  orientFeet(pose, world, rest, facing, [0, 0.9 * w]);
}

/**
 * Sitting on the canvas: hips on the floor, knees up, leaning back on both
 * hands posted behind, head hanging. `x, z` is the pelvis, `facing` the way
 * his legs point. `slump` 0..1 (0 propped up and alert .. 1 dazed).
 */
export function floorSitPose(
  out: Pose, world: WorldPose, restSk: RestSkeleton, x: number, z: number, facing: number, slump: number, breath = 0,
): Pose {
  for (let i = 0; i < out.local.length; i += 4) {
    out.local[i] = 0; out.local[i + 1] = 0; out.local[i + 2] = 0; out.local[i + 3] = 1;
  }
  out.face.fill(0);
  const k = restSk.statureM / 1.733;
  const fwd: V3 = [Math.sin(facing), 0, Math.cos(facing)];
  const left: V3 = [Math.cos(facing), 0, -Math.sin(facing)];
  const hipsToHip = restSk.head[B.hips * 3 + 1] - restSk.head[B.lUpLeg * 3 + 1];
  out.rootPos[0] = x;
  out.rootPos[1] = 0.1 * k + hipsToHip;
  out.rootPos[2] = z;
  // Pelvis rolled back, chest forward over it (a seated C-curve), head down.
  const q = new Float32Array(4);
  mulQuat(out.rootQuat, 0, axisAngle([0, 1, 0], facing), 0, axisAngle([1, 0, 0], -0.55 - slump * 0.1), 0);
  for (const b of [B.spine, B.spine1, B.spine2]) {
    out.local.set(axisAngle([1, 0, 0], 0.12 + slump * 0.08 + breath * 0.015), b * 4);
  }
  mulQuat(q, 0, axisAngle([1, 0, 0], 0.15 + slump * 0.2), 0, axisAngle([0, 0, 1], slump * 0.12), 0);
  out.local.set(q, B.neck * 4);
  out.local.set(axisAngle([1, 0, 0], 0.2 + slump * 0.3), B.head * 4);
  forwardKinematics(world, out, restSk);
  const legLen = restSk.length[B.lUpLeg] + restSk.length[B.lLeg];
  const ankleY = restSk.head[B.lFoot * 3 + 1];
  for (const s of [1, -1] as const) {
    const chain = s > 0 ? LIMBS.lLeg : LIMBS.rLeg;
    const hip = chain.upper * 3;
    const foot: V3 = [
      world.pos[hip] + fwd[0] * legLen * (0.72 + slump * 0.12) + left[0] * s * 0.1 * k,
      ankleY,
      world.pos[hip + 2] + fwd[2] * legLen * (0.72 + slump * 0.12) + left[2] * s * 0.1 * k,
    ];
    const pole: V3 = [world.pos[hip] + fwd[0] * 0.8 + left[0] * s * 0.2, 1.2, world.pos[hip + 2] + fwd[2] * 0.8 + left[2] * s * 0.2];
    solveTwoBone(out, world, restSk, chain, foot, pole);
  }
  forwardKinematics(world, out, restSk);
  const q1 = new Float32Array(4);
  const q2 = new Float32Array(4);
  for (const s of [1, -1] as const) {
    const shin = s > 0 ? B.lLeg : B.rLeg;
    const footB = s > 0 ? B.lFoot : B.rFoot;
    conjugateInto(q1, world.quat.subarray(shin * 4, shin * 4 + 4));
    mulQuat(q2, 0, q1, 0, axisAngle([0, 1, 0], facing + s * 0.25), 0);
    out.local.set(q2, footB * 4);
  }
  forwardKinematics(world, out, restSk);
  // Hands posted on the canvas behind and beside the hips.
  for (const s of [1, -1] as const) {
    const chain = s > 0 ? LIMBS.lArm : LIMBS.rArm;
    const sh = chain.upper * 3;
    const hand: V3 = [
      x - fwd[0] * 0.2 * k + left[0] * s * 0.26 * k,
      0.05 * k,
      z - fwd[2] * 0.2 * k + left[2] * s * 0.26 * k,
    ];
    const pole: V3 = [world.pos[sh] - fwd[0] * 0.6 + left[0] * s * 0.3, world.pos[sh + 1], world.pos[sh + 2] - fwd[2] * 0.6 + left[2] * s * 0.3];
    solveTwoBone(out, world, restSk, chain, hand, pole);
  }
  curlFingers(out, [0.15, 0.15]);
  out.face[7] = 0.5 + 0.5 * breath;
  forwardKinematics(world, out, restSk);
  return out;
}
