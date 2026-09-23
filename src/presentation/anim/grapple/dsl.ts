/**
 * PAIRED-POSE AUTHORING DSL.
 *
 * A paired pose describes two bodies in the **pair frame**: origin at the
 * interaction root, +Z pointing from fighter `a` toward fighter `b` (the sim's
 * root yaw), +X is `a`'s left when he faces `b`, Y up, metres. Distances are
 * authored for MPFB's default body (1.73 m to the crown) and scale with the
 * fighters (see `solve.ts` for the exact rules).
 *
 * The description is deliberately *goal-based* rather than a list of joint
 * angles: where the pelvis is and which way it faces, how the chest bends
 * relative to it, where each hand and foot must be. Two-bone IK then finds the
 * elbows and knees for *these* two bodies, so a flyweight mounting a
 * heavyweight still has his knees on the mat and his hands on the chest.
 *
 * Directions ("up", "fwd", look) are pair-frame vectors. Poles (which way an
 * elbow or knee points) are in the body's own frame: +X its left, +Y along the
 * spine toward the head, +Z out of the belly — so "elbows down and out" is the
 * same vector whether the fighter is standing, supine or upside down.
 */
import type { FaceChannel } from '../../rig/skeleton';
import type { V3 } from './math';

/** Pelvis or chest orientation: spine direction and belly direction. */
export interface Orient {
  up: V3;
  fwd: V3;
}

/** Chest (or head) relative to the pelvis (or chest), degrees. */
export interface Bend {
  /** Forward flexion (+) / extension (-). */
  bend?: number;
  /** Lateral bend toward the body's left (+). */
  side?: number;
  /** Twist toward the body's left (+). */
  twist?: number;
  /**
   * Chest only: point the upper spine at this partner socket (the head goes
   * down onto his chest, into his armpit…), blended by `aimK` (default 1).
   * Applied after both hips are placed; bend/side/twist are ignored.
   */
  aim?: string;
  aimK?: number;
}

/**
 * Where a hand or foot goes.
 *  - `p`: a pair-frame point (x/z scale with the pair, y with the body);
 *  - `on`: a socket on the PARTNER (surface contact; the palm, not the wrist,
 *    lands on it), `off` a pair-frame nudge;
 *  - `self`: a socket on the fighter's own body;
 *  - `mat`: a floor contact at pair-frame (x, z), or relative to the fighter's
 *    own hips (`rel: 'self'`) or the partner's (`rel: 'partner'`).
 */
export type Target =
  | { p: V3 }
  | { on: string; off?: V3 }
  | { self: string; off?: V3 }
  | { mat: [number, number]; rel?: 'self' | 'partner' | 'pair'; h?: number };

export type HandShape = 'fist' | 'grip' | 'open' | 'post' | 'relaxed';
export type FootShape = 'flat' | 'point' | 'hook' | 'neutral' | 'toes';

export interface ArmSpec {
  to: Target;
  /** Elbow direction, chest frame. Default: down, out and slightly back. */
  pole?: V3;
  hand?: HandShape;
  /** 0..1 blend from a relaxed arm toward the IK solution. */
  w?: number;
  /**
   * Fallback grip for when `to` is out of reach even after the torso leans
   * (a flyweight cannot put a hand where a heavyweight would): the hand takes
   * this nearer target instead of hanging in the air.
   */
  alt?: Target;
}

export interface LegSpec {
  /** Ankle target. Omitted with `kneel`. */
  to?: Target;
  /** Knee direction, pelvis frame. Default forward. */
  pole?: V3;
  /**
   * Kneeling: the knee goes on the mat, in this pair-frame horizontal
   * direction from the hip joint; the shin lies along `shin` (pair frame,
   * default: behind the knee along the mat).
   */
  kneel?: [number, number];
  shin?: V3;
  /**
   * Knee target (knee on belly, knee pinning a thigh): the thigh aims at it and
   * the shin continues toward `to` (or along `shin`).
   */
  knee?: Target;
  foot?: FootShape;
  /** Fallback ankle target when `to` is out of reach. */
  alt?: Target;
}

export interface HeadSpec {
  /** Pair-frame gaze direction. */
  look?: V3;
  /** Gaze at a partner socket. */
  at?: string;
  /** Head relative to the chest (applied when neither look nor at is given, or on top). */
  bend?: number;
  side?: number;
  twist?: number;
}

export interface BodySpec {
  /**
   * Hips joint: `at` a pair-frame point (x/z × pair scale, y × body scale), or
   * `on` a partner socket plus a pair-frame offset (× pair scale).
   */
  hips: { at: V3 } | { on: string; off?: V3 };
  pelvis: Orient;
  /** Absolute chest orientation, or a bend relative to the pelvis. */
  chest?: Orient | Bend;
  head?: HeadSpec;
  lArm: ArmSpec;
  rArm: ArmSpec;
  lLeg: LegSpec;
  rLeg: LegSpec;
  face?: Partial<Record<FaceChannel, number>>;
}

export interface PairSpec {
  a: BodySpec;
  b: BodySpec;
}

// ---------------------------------------------------------------------------
// Mirroring (left/right variants)
// ---------------------------------------------------------------------------

import { mirrorSocket } from './sockets';

const mx = (v: V3): V3 => [-v[0], v[1], v[2]];

function mirrorTarget(t: Target): Target {
  if ('p' in t) return { p: mx(t.p) };
  if ('on' in t) return { on: mirrorSocket(t.on), off: t.off ? mx(t.off) : undefined };
  if ('self' in t) return { self: mirrorSocket(t.self), off: t.off ? mx(t.off) : undefined };
  return { mat: [-t.mat[0], t.mat[1]], rel: t.rel, h: t.h };
}

function mirrorArm(a: ArmSpec): ArmSpec {
  return { ...a, to: mirrorTarget(a.to), alt: a.alt ? mirrorTarget(a.alt) : undefined, pole: a.pole ? mx(a.pole) : undefined };
}

function mirrorLeg(l: LegSpec): LegSpec {
  return {
    ...l,
    to: l.to ? mirrorTarget(l.to) : undefined,
    alt: l.alt ? mirrorTarget(l.alt) : undefined,
    knee: l.knee ? mirrorTarget(l.knee) : undefined,
    pole: l.pole ? mx(l.pole) : undefined,
    kneel: l.kneel ? [-l.kneel[0], l.kneel[1]] : undefined,
    shin: l.shin ? mx(l.shin) : undefined,
  };
}

export function isOrient(c: Orient | Bend | undefined): c is Orient {
  return !!c && 'up' in c;
}

function mirrorBody(b: BodySpec): BodySpec {
  const chest = b.chest === undefined ? undefined : isOrient(b.chest)
    ? { up: mx(b.chest.up), fwd: mx(b.chest.fwd) }
    : { bend: b.chest.bend, side: b.chest.side === undefined ? undefined : -b.chest.side,
      twist: b.chest.twist === undefined ? undefined : -b.chest.twist,
      aim: b.chest.aim ? mirrorSocket(b.chest.aim) : undefined, aimK: b.chest.aimK };
  const head = b.head === undefined ? undefined : {
    look: b.head.look ? mx(b.head.look) : undefined,
    at: b.head.at ? mirrorSocket(b.head.at) : undefined,
    bend: b.head.bend,
    side: b.head.side === undefined ? undefined : -b.head.side,
    twist: b.head.twist === undefined ? undefined : -b.head.twist,
  };
  return {
    hips: 'at' in b.hips ? { at: mx(b.hips.at) } : { on: mirrorSocket(b.hips.on), off: b.hips.off ? mx(b.hips.off) : undefined },
    pelvis: { up: mx(b.pelvis.up), fwd: mx(b.pelvis.fwd) },
    chest,
    head,
    lArm: mirrorArm(b.rArm),
    rArm: mirrorArm(b.lArm),
    lLeg: mirrorLeg(b.rLeg),
    rLeg: mirrorLeg(b.lLeg),
    face: b.face,
  };
}

/** The same pose with left and right exchanged (reflection across pair X). */
export function mirrorPair(p: PairSpec): PairSpec {
  return { a: mirrorBody(p.a), b: mirrorBody(p.b) };
}

/**
 * Exchange the roles: what was `a` becomes `b`. The pair frame turns 180°
 * about Y (the sim's root yaw points from the new `a` to the new `b`), so
 * every pair-frame vector has x and z negated.
 */
const rz = (v: V3): V3 => [-v[0], v[1], -v[2]];
function turnTarget(t: Target): Target {
  if ('p' in t) return { p: rz(t.p) };
  if ('on' in t) return { on: t.on, off: t.off ? rz(t.off) : undefined };
  if ('self' in t) return { self: t.self, off: t.off ? rz(t.off) : undefined };
  return { mat: [-t.mat[0], -t.mat[1]], rel: t.rel, h: t.h };
}
function turnBody(b: BodySpec): BodySpec {
  return {
    ...b,
    hips: 'at' in b.hips ? { at: rz(b.hips.at) } : { on: b.hips.on, off: b.hips.off ? rz(b.hips.off) : undefined },
    pelvis: { up: rz(b.pelvis.up), fwd: rz(b.pelvis.fwd) },
    chest: isOrient(b.chest) ? { up: rz(b.chest.up), fwd: rz(b.chest.fwd) } : b.chest,
    head: b.head ? { ...b.head, look: b.head.look ? rz(b.head.look) : undefined } : undefined,
    lArm: { ...b.lArm, to: turnTarget(b.lArm.to), alt: b.lArm.alt ? turnTarget(b.lArm.alt) : undefined },
    rArm: { ...b.rArm, to: turnTarget(b.rArm.to), alt: b.rArm.alt ? turnTarget(b.rArm.alt) : undefined },
    lLeg: { ...b.lLeg, to: b.lLeg.to ? turnTarget(b.lLeg.to) : undefined, alt: b.lLeg.alt ? turnTarget(b.lLeg.alt) : undefined, knee: b.lLeg.knee ? turnTarget(b.lLeg.knee) : undefined, kneel: b.lLeg.kneel ? [-b.lLeg.kneel[0], -b.lLeg.kneel[1]] : undefined, shin: b.lLeg.shin ? rz(b.lLeg.shin) : undefined },
    rLeg: { ...b.rLeg, to: b.rLeg.to ? turnTarget(b.rLeg.to) : undefined, alt: b.rLeg.alt ? turnTarget(b.rLeg.alt) : undefined, knee: b.rLeg.knee ? turnTarget(b.rLeg.knee) : undefined, kneel: b.rLeg.kneel ? [-b.rLeg.kneel[0], -b.rLeg.kneel[1]] : undefined, shin: b.rLeg.shin ? rz(b.rLeg.shin) : undefined },
  };
}
export function swapRoles(p: PairSpec): PairSpec {
  return { a: turnBody(p.b), b: turnBody(p.a) };
}
