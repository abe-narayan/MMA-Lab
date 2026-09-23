/**
 * Authoring shorthands over the DSL: body templates (standing, kneeling,
 * supine, prone, seated, turtled) and small target constructors, so a paired
 * pose reads like a coach describing it.
 *
 * Every template takes a yaw in degrees (the direction the body faces in the
 * pair frame, 0 = toward +Z, i.e. `a` toward `b`; 180 = `b` toward `a`) and a
 * hips placement, and returns a complete `BodySpec` that the caller overrides
 * piecemeal with `{ ...base, lArm: … }`.
 */
import type { ArmSpec, BodySpec, Bend, FootShape, HandShape, LegSpec, Orient, Target } from './dsl';
import { DEG, norm, type V3 } from './math';

// ---- targets ---------------------------------------------------------------

/** Partner socket. */
export const on = (socket: string, off?: V3): Target => ({ on: socket, off });
/** Own socket. */
export const self = (socket: string, off?: V3): Target => ({ self: socket, off });
/** Pair-frame point. */
export const pt = (x: number, y: number, z: number): Target => ({ p: [x, y, z] });
/** Mat contact in the pair frame. */
export const mat = (x: number, z: number, h?: number): Target => ({ mat: [x, z], rel: 'pair', h });
/** Mat contact relative to the own hips (pair-frame offset). */
export const matSelf = (x: number, z: number, h?: number): Target => ({ mat: [x, z], rel: 'self', h });
/** Mat contact relative to the partner's hips. */
export const matPartner = (x: number, z: number, h?: number): Target => ({ mat: [x, z], rel: 'partner', h });

export const arm = (to: Target, hand?: HandShape, pole?: V3, w?: number, alt?: Target): ArmSpec => ({ to, hand, pole, w, alt });
/** An arm grip with a nearer fallback grip for when bodies are badly mismatched. */
export const grip = (to: Target, alt: Target, hand: HandShape = 'grip', pole?: V3): ArmSpec => ({ to, alt, hand, pole });
export const leg = (to: Target, pole?: V3, foot?: FootShape): LegSpec => ({ to, pole, foot });
export const kneelLeg = (dx: number, dz: number, shin?: V3, foot?: FootShape): LegSpec => ({ kneel: [dx, dz], shin, foot });

// ---- frames ----------------------------------------------------------------

/** Unit vectors of a body yawed `deg` in the pair frame: facing and left. */
export function yawFrame(deg: number): { f: V3; l: V3 } {
  const t = deg * DEG;
  return { f: [Math.sin(t), 0, Math.cos(t)], l: [Math.cos(t), 0, -Math.sin(t)] };
}
/** Body-local horizontal offset (x = own left, z = own front) to the pair frame. */
export function local(deg: number, x: number, z: number): [number, number] {
  const { f, l } = yawFrame(deg);
  return [l[0] * x + f[0] * z, l[2] * x + f[2] * z];
}
/** Body-local 3D vector (x left, y up, z front) of a body yawed `deg`, to the pair frame. */
export function lv(deg: number, x: number, y: number, z: number): V3 {
  const [px, pz] = local(deg, x, z);
  return [px, y, pz];
}

// ---- guard hands -----------------------------------------------------------

/** Fists by the own face, elbows in (standing or ground guard). */
export function guardArms(): { lArm: ArmSpec; rArm: ArmSpec } {
  return {
    lArm: { to: self('face', [0, 0, 0]), hand: 'fist', pole: [0.3, -1, 0.1] },
    rArm: { to: self('face', [0, 0, 0]), hand: 'fist', pole: [-0.3, -1, 0.1] },
  };
}

// ---- standing ----------------------------------------------------------------

export interface StandOpts {
  /** Hips pair-frame x/z. */
  at: [number, number];
  /** Facing, degrees in the pair frame. */
  yaw: number;
  /** Hips height (reference body ≈ 0.96 upright). */
  h?: number;
  /** Chest bend relative to the pelvis. */
  chest?: Bend;
  /** Pelvis pitch forward (hips back), degrees. */
  pitch?: number;
  /** Feet in body-local (x left, z front) metres from the hips. */
  lFoot?: [number, number];
  rFoot?: [number, number];
  head?: BodySpec['head'];
}

export function stand(o: StandOpts): Omit<BodySpec, 'lArm' | 'rArm'> & Partial<BodySpec> {
  const { f } = yawFrame(o.yaw);
  const pitch = (o.pitch ?? 0) * DEG;
  // Pelvis tipped forward about its own left axis.
  const up: V3 = norm([f[0] * Math.sin(pitch), Math.cos(pitch), f[2] * Math.sin(pitch)]);
  const fwd: V3 = norm([f[0] * Math.cos(pitch), -Math.sin(pitch), f[2] * Math.cos(pitch)]);
  const lf = o.lFoot ?? [0.16, 0.08];
  const rf = o.rFoot ?? [-0.16, -0.08];
  const l = local(o.yaw, lf[0], lf[1]);
  const r = local(o.yaw, rf[0], rf[1]);
  return {
    hips: { at: [o.at[0], o.h ?? 0.9, o.at[1]] },
    pelvis: { up, fwd },
    chest: o.chest ?? { bend: 8 },
    head: o.head,
    lLeg: { to: matSelf(l[0], l[1]), pole: [0.15, 0, 1], foot: 'flat' },
    rLeg: { to: matSelf(r[0], r[1]), pole: [-0.15, 0, 1], foot: 'flat' },
  };
}

// ---- kneeling ----------------------------------------------------------------

export interface KneelOpts {
  at: [number, number];
  yaw: number;
  /** Hips joint height: ~0.5 tall kneel, ~0.3 sitting on a partner, ~0.22 on heels. */
  h?: number;
  chest?: Bend | Orient;
  pitch?: number;
  /** Knee directions in body-local (x left, z front). */
  lKnee?: [number, number];
  rKnee?: [number, number];
  /** Shin directions, body-local (x, z); default straight back. */
  lShin?: [number, number];
  rShin?: [number, number];
  foot?: FootShape;
  head?: BodySpec['head'];
}

export function kneel(o: KneelOpts): Omit<BodySpec, 'lArm' | 'rArm'> & Partial<BodySpec> {
  const { f } = yawFrame(o.yaw);
  const pitch = (o.pitch ?? 0) * DEG;
  const up: V3 = norm([f[0] * Math.sin(pitch), Math.cos(pitch), f[2] * Math.sin(pitch)]);
  const fwd: V3 = norm([f[0] * Math.cos(pitch), -Math.sin(pitch), f[2] * Math.cos(pitch)]);
  const lk = o.lKnee ?? [0.35, 1];
  const rk = o.rKnee ?? [-0.35, 1];
  const ls = o.lShin ?? [0.05, -1];
  const rs = o.rShin ?? [-0.05, -1];
  const lkp = local(o.yaw, lk[0], lk[1]);
  const rkp = local(o.yaw, rk[0], rk[1]);
  const lsp = local(o.yaw, ls[0], ls[1]);
  const rsp = local(o.yaw, rs[0], rs[1]);
  return {
    hips: { at: [o.at[0], o.h ?? 0.5, o.at[1]] },
    pelvis: { up, fwd },
    chest: o.chest ?? { bend: 10 },
    head: o.head,
    lLeg: { kneel: lkp, shin: [lsp[0], 0.02, lsp[1]], foot: o.foot ?? 'toes' },
    rLeg: { kneel: rkp, shin: [rsp[0], 0.02, rsp[1]], foot: o.foot ?? 'toes' },
  };
}

// ---- lying -------------------------------------------------------------------

export interface LieOpts {
  /** Hips x/z in the pair frame. */
  at: [number, number];
  /** Direction the head points, degrees in the pair frame (0 = +Z). */
  headYaw: number;
  /** Roll about the spine: 0 = flat on the back (supine), 90 = on the left side, -90 on the right, 180 = prone. */
  roll?: number;
  /** Hips height (0.11 supine on the reference body). */
  h?: number;
  /** Upper body raised off the mat (crunch / propped on elbow), degrees. */
  crunch?: number;
  /** Twist of the chest relative to the pelvis, degrees (toward own left). */
  twist?: number;
  side?: number;
  head?: BodySpec['head'];
}

/**
 * A body lying on the mat. Pelvis up = the head direction (horizontal); belly
 * faces up for `roll = 0`, rolled about the spine otherwise.
 */
export function lie(o: LieOpts): Omit<BodySpec, 'lArm' | 'rArm' | 'lLeg' | 'rLeg'> & Partial<BodySpec> {
  const { f } = yawFrame(o.headYaw);
  const roll = (o.roll ?? 0) * DEG;
  // Belly direction: +Y rolled about the spine axis f. Lying on the left side
  // (roll +90) the belly faces where the body's left used to point.
  // Body left for a supine body with head along f: up x fwd = f x Y.
  const left0: V3 = [-f[2], 0, f[0]];
  const fwd: V3 = norm([
    Math.sin(roll) * left0[0],
    Math.cos(roll),
    Math.sin(roll) * left0[2],
  ]);
  const h = o.h ?? (0.11 + 0.05 * Math.abs(Math.sin(roll)));
  return {
    hips: { at: [o.at[0], h, o.at[1]] },
    pelvis: { up: f, fwd },
    chest: { bend: o.crunch ?? 0, twist: o.twist ?? 0, side: o.side ?? 0 },
    head: o.head,
  };
}

/** Supine legs: knees up, feet flat near the hips (body-local x = own left). */
export function kneesUp(headYaw: number, spread = 0.2, back = 0.42): { lLeg: LegSpec; rLeg: LegSpec } {
  const { f } = yawFrame(headYaw);
  // Own left for a supine body with head along f is f x Y... (see lie()).
  const left: V3 = [-f[2], 0, f[0]];
  return {
    lLeg: { to: matSelf(left[0] * spread - f[0] * back, left[2] * spread - f[2] * back), pole: [0.25, 0, 1], foot: 'flat' },
    rLeg: { to: matSelf(-left[0] * spread - f[0] * back, -left[2] * spread - f[2] * back), pole: [-0.25, 0, 1], foot: 'flat' },
  };
}

/** Supine legs extended along the mat. */
export function legsFlat(headYaw: number, spread = 0.14): { lLeg: LegSpec; rLeg: LegSpec } {
  const { f } = yawFrame(headYaw);
  const left: V3 = [-f[2], 0, f[0]];
  return {
    lLeg: { to: matSelf(left[0] * spread - f[0] * 0.82, left[2] * spread - f[2] * 0.82, 0.05), pole: [0.1, 0, 1], foot: 'neutral' },
    rLeg: { to: matSelf(-left[0] * spread - f[0] * 0.82, -left[2] * spread - f[2] * 0.82, 0.05), pole: [-0.1, 0, 1], foot: 'neutral' },
  };
}

/** Own-left unit vector of a supine body whose head points along yaw. */
export function supineLeft(headYaw: number): V3 {
  const { f } = yawFrame(headYaw);
  return [-f[2], 0, f[0]];
}
