/**
 * PAIR SOLVER — turns a `PairSpec` into two `Pose`s in pair space.
 *
 * Order of work (each step runs forward kinematics before the next reads a
 * joint or socket):
 *
 *   1. torsos: hips placed (absolute, or on the partner's socket — the partner
 *      is placed first), pelvis orientation, the chest bend spread over the
 *      three spine bones;
 *   2. heads: gaze at a direction or at a partner socket;
 *   3. limbs whose targets are the mat, the own body or the partner's TORSO;
 *   4. limbs whose targets are on the partner's LIMBS (a hand on a wrist, a
 *      hook on a thigh), twice, so mutual grips settle;
 *   5. hands (palm onto the socket surface, fingers) and feet.
 *
 * Scaling. `s` is a fighter's stature / the reference body's, `sP` the pair's
 * mean. Pair-frame layout (hips `at`, targets `p`, `mat` in the pair frame)
 * scales x/z by `sP` and height by the body's own `s`; offsets from sockets
 * scale by `sP`; everything expressed on a body (sockets, `self` offsets,
 * `mat` relative to the own hips) scales by that body's `s`.
 */
import {
  B, BONE_PARENT, forwardKinematics, resetPose,
  type Pose, type RestSkeleton, type WorldPose,
} from '../../rig/skeleton';
import { LIMBS, solveTwoBone, type LimbChain } from '../../rig/ik';
import type { ArmSpec, BodySpec, HandShape, LegSpec, PairSpec, Target } from './dsl';
import { isOrient } from './dsl';
import {
  add, clamp, cross, DEG, dist, dot, getQ, getV3, len, madd, norm, qAxis, qBasis, qConj, qFromTo, qLook,
  qMul, qPow, qRot, qSlerp, scale, setQ, sub, type Q4, type V3,
} from './math';
import { isLimbSocket, restScale, sampleSocket } from './sockets';
import { coreCapsules, segSegClosest } from './capsules';

export interface SolveBuffers {
  rests: [RestSkeleton, RestSkeleton];
  poses: [Pose, Pose];
  worlds: [WorldPose, WorldPose];
}

/** One solved contact, for tests and the debug overlay. */
export interface ContactRecord {
  who: 0 | 1;
  limb: 'lArm' | 'rArm' | 'lLeg' | 'rLeg';
  socket: string;
  /** Where the effector should be (pair space). */
  want: V3;
  /** Where the effector ended up. */
  got: V3;
}

const PALM = 0.085; // wrist joint to palm centre, reference body
const HAND_T = 0.03; // palm thickness off the surface
const FOOT_T = 0.055; // ankle joint off a hooked surface
const KNEE_R = 0.055; // knee joint height when kneeling

interface BodyState {
  s: number;
  pelvisQ: Q4;
  chestQ: Q4;
  /** Radians of reach-assist lean already applied. */
  leaned: number;
}

/** Total reach-assist lean allowed per body. */
const LEAN_MAX = 30 * DEG;
/** A grip this far out of reach takes its `alt` target instead. */
const ALT_SHORT = 0.02;
/** …and this far out of reach even then, it is let go. */
const DROP_SHORT = 0.03;
const isPartnerTarget = (t: Target): boolean => 'on' in t;
/** Where a hand goes when its grip is let go: up by the own face. */
const guardArm = (k: 'lArm' | 'rArm'): ArmSpec => ({
  to: { self: 'face', off: [k === 'lArm' ? 0.06 : -0.06, 0.02, 0] }, hand: 'fist',
  pole: k === 'lArm' ? [0.4, -1, 0.2] : [-0.4, -1, 0.2],
});

/** Grips let go in the last solve (tests and the debug overlay read this). */
export const dropped: { who: 0 | 1; limb: string; socket: string }[] = [];

export function solvePair(spec: PairSpec, buf: SolveBuffers, contacts?: ContactRecord[]): void {
  const { rests, poses, worlds } = buf;
  const sc: [number, number] = [restScale(rests[0]), restScale(rests[1])];
  const sP = (sc[0] + sc[1]) / 2;
  const bodies = [spec.a, spec.b] as const;
  const st: [BodyState, BodyState] = [
    { s: sc[0], pelvisQ: [0, 0, 0, 1], chestQ: [0, 0, 0, 1], leaned: 0 },
    { s: sc[1], pelvisQ: [0, 0, 0, 1], chestQ: [0, 0, 0, 1], leaned: 0 },
  ];
  resetPose(poses[0]);
  resetPose(poses[1]);
  dropped.length = 0;
  armCache[0] = {}; armCache[1] = {};
  legCache[0] = {}; legCache[1] = {};

  // 1. torsos, partner-anchored body second.
  const order: (0 | 1)[] = 'on' in spec.a.hips ? [1, 0] : [0, 1];
  for (const i of order) {
    placeTorso(bodies[i], i, st[i], sP, buf);
    forwardKinematics(worlds[i], poses[i], rests[i]);
    liftOffMat(i, buf);
  }
  // 1b. chests aimed at a partner socket (needs both torsos placed).
  for (const i of [0, 1] as const) {
    const ch = bodies[i].chest;
    if (ch && !isOrient(ch) && ch.aim) {
      aimChest(i, ch.aim, ch.aimK ?? 1, st[i], buf);
      forwardKinematics(worlds[i], poses[i], rests[i]);
    }
  }
  // 2. heads
  for (const i of [0, 1] as const) {
    placeHead(bodies[i], i, st[i], buf);
    forwardKinematics(worlds[i], poses[i], rests[i]);
  }
  // 2b. bodies may press but not pass through each other: slide apart any
  // torso/head overlap before the limbs are solved (so grips stay exact).
  separateTorsos(buf);
  // 3/4. limbs in dependency passes; then, if a grip is out of reach, lean
  // that fighter's upper body toward it and solve the limbs again.
  const limbs = ['lArm', 'rArm', 'lLeg', 'rLeg'] as const;
  const late = (t: Target | undefined): boolean => !!t
    && (('on' in t && isLimbSocket(t.on)) || ('self' in t && isLimbSocket(t.self)));
  for (let iter = 0; iter < 3; iter++) {
    for (let pass = 0; pass < 3; pass++) {
      for (const i of [0, 1] as const) {
        const body = bodies[i];
        for (const k of limbs) {
          const spec = body[k];
          const isLate = late((spec as ArmSpec | LegSpec).to as Target | undefined)
            || late((spec as LegSpec).knee);
          if ((pass === 0) === isLate) continue;
          if (k === 'lArm' || k === 'rArm') solveArm(body[k], k, i, st[i], sP, buf);
          else solveLeg(body[k], k, i, st[i], sP, buf);
        }
        forwardKinematics(worlds[i], poses[i], rests[i]);
      }
    }
    if (iter === 2) break;
    let leaned = false;
    for (const i of [0, 1] as const) {
      if (st[i].leaned >= LEAN_MAX) continue;
      leaned = reachAssist(i, st[i], buf) || leaned;
    }
    if (!leaned) break;
    // Leaning in can bury a head in the partner's chest: slide apart again.
    separateTorsos(buf);
  }
  // 4b. grips still out of reach fall back to their nearer alternative.
  for (const i of [0, 1] as const) {
    const body = bodies[i];
    let changed = false;
    for (const k of ['lArm', 'rArm'] as const) {
      const c = armCache[i][k];
      if (body[k].alt && c && c.short > ALT_SHORT) { solveArm(body[k], k, i, st[i], sP, buf, true); changed = true; }
      // Still unreachable (a grip on a partner too big or too far): let go and
      // bring the hand home to a guard, never leave it hanging in the air.
      const c2 = armCache[i][k];
      if (c2 && c2.short > DROP_SHORT && isPartnerTarget(c2.alt && body[k].alt ? body[k].alt! : body[k].to)) {
        solveArm(guardArm(k), k, i, st[i], sP, buf);
        armCache[i][k] = { ...armCache[i][k], dropped: true };
        dropped.push({ who: i, limb: k, socket: (body[k].to as { on: string }).on });
        changed = true;
      }
    }
    for (const k of ['lLeg', 'rLeg'] as const) {
      const c = legCache[i][k];
      if (body[k].alt && c && c.short > ALT_SHORT) { solveLeg(body[k], k, i, st[i], sP, buf, true); changed = true; }
    }
    if (changed) forwardKinematics(worlds[i], poses[i], rests[i]);
  }
  // 4c. one more pass for grips on the partner's limbs, which may have moved.
  for (const i of [0, 1] as const) {
    const body = bodies[i];
    for (const k of limbs) {
      const spec = body[k];
      if (!late(spec.to) && !late((spec as LegSpec).knee)) continue;
      if ((k === 'lArm' || k === 'rArm') && armCache[i][k]?.dropped) continue;
      if (k === 'lArm' || k === 'rArm') {
        solveArm(body[k], k, i, st[i], sP, buf, armCache[i][k]?.alt ?? false);
        if (body[k].alt && !armCache[i][k]?.alt && (armCache[i][k]?.short ?? 0) > ALT_SHORT) {
          solveArm(body[k], k, i, st[i], sP, buf, true);
        }
        const c = armCache[i][k];
        const used = c?.alt && body[k].alt ? body[k].alt! : body[k].to;
        if (c && c.short > DROP_SHORT && isPartnerTarget(used)) {
          solveArm(guardArm(k), k, i, st[i], sP, buf);
          armCache[i][k] = { ...armCache[i][k], dropped: true };
          dropped.push({ who: i, limb: k, socket: (body[k].to as { on?: string }).on ?? '?' });
        }
      } else solveLeg(body[k], k, i, st[i], sP, buf, legCache[i][k]?.alt ?? false);
    }
    forwardKinematics(worlds[i], poses[i], rests[i]);
  }
  // 5. hands and feet
  for (const i of [0, 1] as const) {
    const body = bodies[i];
    finishHand(body.lArm, 'lArm', i, st[i], sP, buf);
    finishHand(body.rArm, 'rArm', i, st[i], sP, buf);
    forwardKinematics(worlds[i], poses[i], rests[i]);
    if (body.face) {
      for (const [ch, v] of Object.entries(body.face)) {
        const idx = FACE_INDEX[ch];
        if (idx !== undefined) poses[i].face[idx] = v as number;
      }
    }
  }
  if (contacts) recordContacts(spec, st, sP, buf, contacts);
}

import { FACE } from '../../rig/skeleton';
const FACE_INDEX = FACE as unknown as Record<string, number>;

// ---------------------------------------------------------------------------
// Torso
// ---------------------------------------------------------------------------

function placeTorso(body: BodySpec, i: 0 | 1, bs: BodyState, sP: number, buf: SolveBuffers): void {
  const pose = buf.poses[i];
  const j = (1 - i) as 0 | 1;
  let hp: V3;
  if ('at' in body.hips) {
    const a = body.hips.at;
    hp = [a[0] * sP, a[1] * bs.s, a[2] * sP];
  } else {
    const sock = sampleSocket(body.hips.on, buf.worlds[j], buf.rests[j]);
    hp = add(sock.p, scale(body.hips.off ?? [0, 0, 0], sP));
  }
  pose.rootPos[0] = hp[0]; pose.rootPos[1] = hp[1]; pose.rootPos[2] = hp[2];
  const pq = qLook(body.pelvis.up, body.pelvis.fwd);
  bs.pelvisQ = pq;
  pose.rootQuat[0] = pq[0]; pose.rootQuat[1] = pq[1]; pose.rootQuat[2] = pq[2]; pose.rootQuat[3] = pq[3];

  let rel: Q4;
  if (isOrient(body.chest)) {
    const cq = qLook(body.chest.up, body.chest.fwd);
    rel = qMul(qConj(pq), cq);
  } else {
    rel = bendQ(body.chest?.bend ?? 0, body.chest?.side ?? 0, body.chest?.twist ?? 0);
  }
  bs.chestQ = qMul(pq, rel);
  // Spread over Spine, Spine1, Spine2 (lower spine takes a little less twist).
  const part = qPow(rel, 1 / 3);
  setQ(pose.local, B.spine, part);
  setQ(pose.local, B.spine1, part);
  setQ(pose.local, B.spine2, part);
}

/**
 * A lying body's back must rest ON the mat whatever its proportions: raise
 * the torso so its lowest firm surface is at floor level.
 */
const TORSO_R: [number, number][] = [
  [B.hips, 0.1], [B.spine, 0.105], [B.spine1, 0.11], [B.spine2, 0.115], [B.neck, 0.05],
];
function liftOffMat(i: 0 | 1, buf: SolveBuffers): void {
  const w = buf.worlds[i];
  const s = restScale(buf.rests[i]);
  let low = Infinity;
  for (const [b, r] of TORSO_R) {
    low = Math.min(low, w.pos[b * 3 + 1] - r * s, w.tip[b * 3 + 1] - r * s);
  }
  // Head: a sphere around the middle of the head bone; shoulders: the arm heads.
  const hy = (w.pos[B.head * 3 + 1] + w.tip[B.head * 3 + 1]) / 2;
  low = Math.min(low, hy - 0.09 * s, w.pos[B.lArm * 3 + 1] - 0.06 * s, w.pos[B.rArm * 3 + 1] - 0.06 * s);
  if (low < 0) {
    buf.poses[i].rootPos[1] -= low;
    forwardKinematics(w, buf.poses[i], buf.rests[i]);
  }
}

/**
 * Push the two torsos apart where their firm capsules overlap by more than
 * `SEP_SLOP`. The higher-hipped body moves (the man on top comes up / off);
 * bodies at similar heights share it. A body standing or kneeling on its feet
 * or knees is only slid horizontally, so nobody floats.
 */
const SEP_SLOP = 0.015;
function separateTorsos(buf: SolveBuffers): void {
  for (let it = 0; it < 10; it++) {
    const ca = coreCapsules(buf.worlds[0], buf.rests[0]);
    const cb = coreCapsules(buf.worlds[1], buf.rests[1]);
    let depth = 0;
    let c1: V3 = [0, 0, 0];
    let c2: V3 = [0, 0, 0];
    for (const x of ca) {
      for (const y of cb) {
        const r = segSegClosest(x.a, x.b, y.a, y.b);
        const dd = x.r + y.r - r.d;
        if (dd > depth) { depth = dd; c1 = r.c1; c2 = r.c2; }
      }
    }
    if (depth < SEP_SLOP) return;
    const pa = buf.poses[0].rootPos;
    const pb = buf.poses[1].rootPos;
    let dir = sub(c1, c2);
    if (len(dir) < 1e-5) dir = [pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]];
    dir = norm(dir);
    const sa = restScale(buf.rests[0]);
    const sb = restScale(buf.rests[1]);
    let wa = 0.5;
    if (pa[1] > pb[1] + 0.15) wa = 1;
    else if (pb[1] > pa[1] + 0.15) wa = 0;
    const push = depth - SEP_SLOP * 0.5;
    for (const [i, w, sgn, s] of [[0, wa, 1, sa], [1, 1 - wa, -1, sb]] as const) {
      if (w <= 0) continue;
      const p = buf.poses[i].rootPos;
      let d: V3 = scale(dir, sgn);
      // Upright bodies (hips well off the mat) slide, they do not fly; and
      // nobody is pushed down into the floor.
      if (p[1] > 0.55 * s || d[1] < 0) {
        const h = Math.hypot(d[0], d[2]);
        d = h > 1e-3 ? [d[0] / h, 0, d[2] / h] : [0, 0, 0];
      }
      const k = w * (len(d) > 0 ? 1 : 0);
      p[0] += d[0] * push * k; p[1] += d[1] * push * k; p[2] += d[2] * push * k;
      forwardKinematics(buf.worlds[i], buf.poses[i], buf.rests[i]);
    }
  }
}

/** Point the upper spine (Spine1 → neck) at a partner socket. */
function aimChest(i: 0 | 1, socket: string, k: number, bs: BodyState, buf: SolveBuffers): void {
  const j = (1 - i) as 0 | 1;
  const world = buf.worlds[i];
  const pose = buf.poses[i];
  const tgt = sampleSocket(socket, buf.worlds[j], buf.rests[j]).p;
  const from = getV3(world.pos, B.spine1);
  const up = norm(sub(tgt, from));
  const curFwd = qRot(bs.pelvisQ, [0, 0, 1]);
  let want = qLook(up, curFwd);
  if (k < 1) want = qSlerp(qMul(bs.pelvisQ, [0, 0, 0, 1]), want, k);
  const rel = qMul(qConj(bs.pelvisQ), want);
  bs.chestQ = want;
  const part = qPow(rel, 1 / 3);
  setQ(pose.local, B.spine, part);
  setQ(pose.local, B.spine1, part);
  setQ(pose.local, B.spine2, part);
}

/** Flexion about +X, side bend about -Z, twist about +Y — in that order. */
export function bendQ(bend: number, side: number, twist: number): Q4 {
  let q: Q4 = [0, 0, 0, 1];
  if (twist) q = qMul(q, qAxis([0, 1, 0], twist * DEG));
  if (bend) q = qMul(q, qAxis([1, 0, 0], bend * DEG));
  if (side) q = qMul(q, qAxis([0, 0, -1], side * DEG));
  return q;
}

function placeHead(body: BodySpec, i: 0 | 1, bs: BodyState, buf: SolveBuffers): void {
  const pose = buf.poses[i];
  const world = buf.worlds[i];
  const h = body.head ?? {};
  const chestUp = qRot(bs.chestQ, [0, 1, 0]);
  let rel: Q4 = [0, 0, 0, 1];
  let dir: V3 | null = null;
  if (h.at) {
    const j = (1 - i) as 0 | 1;
    const t = sampleSocket(h.at, buf.worlds[j], buf.rests[j]).p;
    dir = norm(sub(t, getV3(world.pos, B.head)));
  } else if (h.look) {
    dir = norm(h.look);
  }
  if (dir) {
    const want = qLook(chestUp, dir);
    // The face points along the chest-up-orthogonal gaze; allow looking up/down
    // by tilting the head frame toward the gaze.
    const flat = qLook(chestUp, dir);
    const tilt = qFromTo(qRot(flat, [0, 0, 1]), dir);
    rel = qMul(qConj(bs.chestQ), qMul(tilt, want));
    // Limit to ~75° from neutral.
    const ang = 2 * Math.acos(clamp(Math.abs(rel[3]), 0, 1));
    const lim = 75 * DEG;
    if (ang > lim) rel = qPow(rel, lim / ang);
  }
  if (h.bend || h.side || h.twist) rel = qMul(rel, bendQ(h.bend ?? 0, h.side ?? 0, h.twist ?? 0));
  setQ(pose.local, B.neck, qPow(rel, 0.45));
  // qPow(rel, .45) * qPow(rel, .55) = rel (same axis).
  setQ(pose.local, B.head, qPow(rel, 0.55));
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

interface Resolved {
  p: V3;
  /** Surface normal when the target is a socket. */
  n: V3 | null;
  socket: string | null;
}

function resolveTarget(t: Target, i: 0 | 1, bs: BodyState, sP: number, buf: SolveBuffers): Resolved {
  const j = (1 - i) as 0 | 1;
  if ('p' in t) return { p: [t.p[0] * sP, t.p[1] * bs.s, t.p[2] * sP], n: null, socket: null };
  if ('on' in t) {
    const k = sampleSocket(t.on, buf.worlds[j], buf.rests[j]);
    return { p: add(k.p, scale(t.off ?? [0, 0, 0], sP)), n: k.n, socket: t.on };
  }
  if ('self' in t) {
    const k = sampleSocket(t.self, buf.worlds[i], buf.rests[i]);
    return { p: add(k.p, scale(t.off ?? [0, 0, 0], bs.s)), n: k.n, socket: null };
  }
  const h = (t.h ?? 0.045) * bs.s;
  const rel = t.rel ?? 'pair';
  if (rel === 'self') {
    const r = buf.poses[i].rootPos;
    return { p: [r[0] + t.mat[0] * bs.s, h, r[2] + t.mat[1] * bs.s], n: [0, 1, 0], socket: null };
  }
  if (rel === 'partner') {
    const r = buf.poses[j].rootPos;
    return { p: [r[0] + t.mat[0] * sP, h, r[2] + t.mat[1] * sP], n: [0, 1, 0], socket: null };
  }
  return { p: [t.mat[0] * sP, h, t.mat[1] * sP], n: [0, 1, 0], socket: null };
}

// ---------------------------------------------------------------------------
// Arms
// ---------------------------------------------------------------------------

const DEFAULT_ARM_POLE_L: V3 = [0.5, -1, -0.35];
const DEFAULT_ARM_POLE_R: V3 = [-0.5, -1, -0.35];

interface ArmSolve { wrist: V3; contact: V3 | null; n: V3 | null; short: number; alt: boolean; dropped?: boolean }
interface LegSolve { short: number; alt: boolean }
const legCache: [Record<string, LegSolve>, Record<string, LegSolve>] = [{}, {}];
const armCache: [Record<string, ArmSolve>, Record<string, ArmSolve>] = [{}, {}];

function solveArm(
  spec: ArmSpec, k: 'lArm' | 'rArm', i: 0 | 1, bs: BodyState, sP: number, buf: SolveBuffers, useAlt = false,
): void {
  const pose = buf.poses[i];
  const world = buf.worlds[i];
  const rest = buf.rests[i];
  const chain: LimbChain = k === 'lArm' ? LIMBS.lArm : LIMBS.rArm;
  const clav = k === 'lArm' ? B.lShoulder : B.rShoulder;
  const to = useAlt && spec.alt ? spec.alt : spec.to;
  const tgt = resolveTarget(to, i, bs, sP, buf);
  const s = bs.s;

  let contact: V3 | null = null;
  let wrist: V3;
  const handShape = spec.hand ?? (tgt.n ? 'grip' : 'fist');
  if (tgt.n && handShape !== 'fist' && !('mat' in to)) {
    // Palm onto the surface: contact point just off it, wrist behind it along
    // the approach direction.
    contact = madd(tgt.p, tgt.n, HAND_T * s);
    const sh = getV3(world.pos, chain.upper);
    let appr = sub(contact, sh);
    // Remove most of the normal component so the hand lies along the surface.
    appr = sub(appr, scale(tgt.n, dot(appr, tgt.n) * 0.6));
    const ad = norm(appr);
    wrist = madd(contact, ad, -PALM * s);
  } else if ('mat' in to && handShape === 'post') {
    // Post: palm flat on the mat; the wrist sits above and behind the palm.
    contact = [tgt.p[0], 0.02 * s, tgt.p[2]];
    const sh = getV3(world.pos, chain.upper);
    const hz = norm([contact[0] - sh[0], 0, contact[2] - sh[2]]);
    wrist = [contact[0] - hz[0] * PALM * 0.8 * s, 0.06 * s, contact[2] - hz[2] * PALM * 0.8 * s];
  } else {
    wrist = tgt.p;
  }

  // Clavicle: let the shoulder girdle follow the reach a little.
  const parentQ = getQ(world.quat, B.spine2);
  const cHead = getV3(world.pos, clav);
  const restClav = norm(sub(getV3(rest.head, chain.upper), getV3(rest.head, clav)));
  const d0 = qRot(parentQ, restClav);
  const d1 = norm(sub(wrist, cHead));
  let rot = qFromTo(d0, d1);
  rot = qPow(rot, 0.18);
  const localClav = qMul(qConj(parentQ), qMul(rot, qMul(parentQ, [0, 0, 0, 1])));
  setQ(pose.local, clav, localClav);
  forwardKinematics(world, pose, rest);

  const pole = spec.pole ?? (k === 'lArm' ? DEFAULT_ARM_POLE_L : DEFAULT_ARM_POLE_R);
  const sh = getV3(world.pos, chain.upper);
  const pw = add(add(sh, scale(sub(wrist, sh), 0.5)), qRot(bs.chestQ, scale(norm(pole), 0.5)));
  const short = solveTwoBone(pose, world, rest, chain, wrist, liftPole(pw, sh, wrist, s), spec.w ?? 1);
  armCache[i][k] = { wrist, contact, n: tgt.n, short, alt: useAlt && !!spec.alt };
}

/**
 * Keep elbows and knees out of the mat: when both ends of a limb are low
 * (an arm of a man on his back, a leg scissoring an arm on the mat), a pole
 * that points into the floor would bury the middle joint, so lift it.
 */
function liftPole(pole: V3, root: V3, end: V3, s: number): V3 {
  const low = Math.min(root[1], end[1]);
  if (low > 0.3 * s) return pole;
  const minY = low + 0.25 * s;
  if (pole[1] >= minY) return pole;
  return [pole[0], minY, pole[2]];
}

/**
 * Lean the upper body toward any hand target that fell short (a small man's
 * collar tie on a big man, a hand fight across a wide stance). Rotates at the
 * Spine1 joint, at most 28° per call. Returns true if it moved.
 */
function reachAssist(i: 0 | 1, bs: BodyState, buf: SolveBuffers): boolean {
  const world = buf.worlds[i];
  const pose = buf.poses[i];
  const pivot = getV3(world.pos, B.spine1);
  let ax: V3 = [0, 0, 0];
  let moved = false;
  for (const k of ['lArm', 'rArm'] as const) {
    const c = armCache[i][k];
    if (!c || c.short < 0.012) continue;
    const sh = getV3(world.pos, k === 'lArm' ? B.lArm : B.rArm);
    const u = sub(sh, pivot);
    const w = sub(c.wrist, pivot);
    const axis = cross(u, w);
    const n = len(axis);
    if (n < 1e-6) continue;
    const ang = Math.min(28 * DEG, (c.short * 1.15) / Math.max(0.2, len(u)));
    ax = add(ax, scale(axis, ang / n));
    moved = true;
  }
  if (!moved) return false;
  const ang = Math.min(28 * DEG, len(ax), LEAN_MAX - bs.leaned);
  if (ang < 0.5 * DEG) return false;
  bs.leaned += ang;
  const R = qAxis(norm(ax), ang);
  const parentQ = getQ(world.quat, B.spine);
  const local = getQ(pose.local, B.spine1);
  setQ(pose.local, B.spine1, qMul(qConj(parentQ), qMul(R, qMul(parentQ, local))));
  bs.chestQ = qMul(R, bs.chestQ);
  forwardKinematics(world, pose, buf.rests[i]);
  return true;
}

// ---------------------------------------------------------------------------
// Legs
// ---------------------------------------------------------------------------

/** Solve a leg and set its foot, so grips on the partner's feet see the final foot. */
function solveLeg(
  spec: LegSpec, k: 'lLeg' | 'rLeg', i: 0 | 1, bs: BodyState, sP: number, buf: SolveBuffers, useAlt = false,
): void {
  solveLegCore(spec, k, i, bs, sP, buf, useAlt);
  forwardKinematics(buf.worlds[i], buf.poses[i], buf.rests[i]);
  if (k === 'lLeg') finishFoot(spec, B.lLeg, B.lFoot, i, bs, buf);
  else finishFoot(spec, B.rLeg, B.rFoot, i, bs, buf);
}

function solveLegCore(
  spec: LegSpec, k: 'lLeg' | 'rLeg', i: 0 | 1, bs: BodyState, sP: number, buf: SolveBuffers, useAlt = false,
): void {
  legCache[i][k] = { short: 0, alt: false };
  const pose = buf.poses[i];
  const world = buf.worlds[i];
  const rest = buf.rests[i];
  const chain = k === 'lLeg' ? LIMBS.lLeg : LIMBS.rLeg;
  const s = bs.s;
  const H = getV3(world.pos, chain.upper);
  const L1 = rest.length[chain.upper];
  const L2 = rest.length[chain.lower];
  if (spec.kneel) {
    // Knee on the mat in the given direction, at exactly thigh length.
    const kr = KNEE_R * s;
    const dy = kr - H[1];
    let K: V3;
    if (-dy >= L1 * 0.985) {
      K = [H[0], H[1] - L1 * 0.985, H[2]];
      const h = norm([spec.kneel[0], 0, spec.kneel[1]]);
      K = add(K, scale(h, L1 * 0.17));
    } else {
      const hmag = Math.sqrt(Math.max(0, L1 * L1 - dy * dy));
      const h = norm([spec.kneel[0], 0, spec.kneel[1]]);
      K = [H[0] + h[0] * hmag, kr, H[2] + h[2] * hmag];
    }
    let shin: V3;
    if (spec.shin) shin = norm(spec.shin);
    else {
      // Behind the knee, along the mat, away from the hips' facing.
      const f = qRot(bs.pelvisQ, [0, 0, 1]);
      shin = norm([-f[0], 0, -f[2]]);
      if (len([f[0], 0, f[2]]) < 0.2) shin = norm([K[0] - H[0], 0, K[2] - H[2]]);
    }
    // Toes tucked lift the ankle (ball of the foot on the mat); laces down
    // keep it low.
    const ankleH = (spec.foot ?? 'toes') === 'toes' ? 0.145 * s : 0.07 * s;
    let F = add(K, scale(shin, L2));
    if (F[1] < ankleH) {
      // Keep the shin length: lift the ankle and pull it toward the knee.
      const dyF = ankleH - K[1];
      const hz = Math.sqrt(Math.max(0, L2 * L2 - dyF * dyF));
      const hd = norm([shin[0], 0, shin[2]]);
      F = [K[0] + hd[0] * hz, ankleH, K[2] + hd[2] * hz];
    }
    solveTwoBone(pose, world, rest, chain, F, add(K, scale(norm(sub(K, H)), 0.05)));
    return;
  }
  if (spec.knee) {
    const kt = resolveTarget(spec.knee, i, bs, sP, buf);
    const kp = kt.n ? madd(kt.p, kt.n, KNEE_R * s) : kt.p;
    const K = add(H, scale(norm(sub(kp, H)), L1));
    let shin: V3;
    if (spec.to) {
      const ft = resolveTarget(spec.to, i, bs, sP, buf);
      shin = norm(sub(ft.p, K));
    } else if (spec.shin) shin = norm(spec.shin);
    else shin = norm(sub(K, H));
    let F = add(K, scale(shin, L2));
    if (F[1] < 0.065 * s) F = [F[0], 0.065 * s, F[2]];
    solveTwoBone(pose, world, rest, chain, F, add(K, scale(norm(sub(K, H)), 0.05)));
    return;
  }
  const to = useAlt && spec.alt ? spec.alt : spec.to;
  const tgt = to ? resolveTarget(to, i, bs, sP, buf) : { p: add(H, [0, -L1 - L2, 0]) as V3, n: null, socket: null };
  let ankle = tgt.p;
  if (tgt.n && to && !('mat' in to)) ankle = madd(tgt.p, tgt.n, FOOT_T * s);
  if (to && 'mat' in to) {
    // Standing on the ball of the foot lifts the ankle; flat foot keeps it low.
    const minH = spec.foot === 'toes' ? 0.14 * s : 0.068 * s;
    ankle = [tgt.p[0], Math.max(tgt.p[1], minH), tgt.p[2]];
  }
  const pole = spec.pole ?? [0, 0, 1];
  const pw = add(add(H, scale(sub(ankle, H), 0.5)), qRot(bs.pelvisQ, scale(norm(pole), 0.6)));
  const short = solveTwoBone(pose, world, rest, chain, ankle, liftPole(pw, H, ankle, s));
  legCache[i][k] = { short, alt: useAlt && !!spec.alt };
}

// ---------------------------------------------------------------------------
// Hands and feet
// ---------------------------------------------------------------------------

const FINGERS_L = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27];
const THUMB_L = [28, 29, 30];
const FINGERS_R = [36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47];
const THUMB_R = [48, 49, 50];

const CURL: Record<HandShape, number> = { fist: 1.45, grip: 1.0, open: 0.05, post: 0.1, relaxed: 0.45 };

function finishHand(spec: ArmSpec, k: 'lArm' | 'rArm', i: 0 | 1, bs: BodyState, _sP: number, buf: SolveBuffers): void {
  const pose = buf.poses[i];
  const world = buf.worlds[i];
  const left = k === 'lArm';
  const hand = left ? B.lHand : B.rHand;
  const fore = left ? B.lForeArm : B.rForeArm;
  const shape: HandShape = armCache[i][k]?.dropped ? 'fist' : spec.hand ?? ('on' in spec.to ? 'grip' : 'fist');
  const cache = armCache[i][k];
  const foreQ = getQ(world.quat, fore);
  let handW: Q4 | null = null;
  const sgn = left ? 1 : -1;
  if (cache && cache.contact && cache.n && shape !== 'post') {
    const w = getV3(world.pos, hand);
    const long = norm(sub(cache.contact, w));
    let up = sub(cache.n, scale(long, dot(cache.n, long)));
    if (len(up) < 1e-4) up = qRot(foreQ, [0, 1, 0]);
    up = norm(up);
    // rest: long axis = ±X, back of hand = +Y (palm down).
    const x = scale(long, sgn);
    handW = qBasis(x, up, cross(x, up));
  } else if (shape === 'post') {
    const w = getV3(world.pos, hand);
    const f = cache?.contact ? norm([cache.contact[0] - w[0], 0, cache.contact[2] - w[2]]) : norm([qRot(foreQ, [sgn, 0, 0])[0], 0, qRot(foreQ, [sgn, 0, 0])[2]]);
    const x = scale(f, sgn);
    const up: V3 = [0, 1, 0];
    handW = qBasis(x, up, cross(x, up));
  }
  if (handW) {
    // Limit wrist deviation to ~70°.
    let local = qMul(qConj(foreQ), handW);
    const ang = 2 * Math.acos(clamp(Math.abs(local[3]), 0, 1));
    const lim = 70 * DEG;
    if (ang > lim) local = qPow(local, lim / ang);
    setQ(pose.local, hand, local);
  }
  const curl = CURL[shape];
  const axis: V3 = left ? [0, 0, -1] : [0, 0, 1];
  const fq = qAxis(axis, curl * 0.62);
  for (const b of left ? FINGERS_L : FINGERS_R) setQ(pose.local, b, fq);
  const tq = qAxis(left ? [0.3, 0, -1] : [-0.3, 0, 1], curl * 0.3);
  for (const b of left ? THUMB_L : THUMB_R) setQ(pose.local, b, tq);
  void bs;
}

function finishFoot(spec: LegSpec, shinBone: number, foot: number, i: 0 | 1, bs: BodyState, buf: SolveBuffers): void {
  const pose = buf.poses[i];
  const world = buf.worlds[i];
  const shape = spec.foot ?? (spec.kneel ? 'toes' : spec.to && 'mat' in spec.to ? 'flat' : 'neutral');
  const shinQ = getQ(world.quat, shinBone);
  let local: Q4;
  switch (shape) {
    case 'flat': {
      // Sole on the mat, toes along the knee's horizontal direction.
      const kneeFwd = qRot(shinQ, [0, 0, 1]);
      let f: V3 = [kneeFwd[0], 0, kneeFwd[2]];
      if (len(f) < 0.2) { const pf = qRot(bs.pelvisQ, [0, 0, 1]); f = [pf[0], 0, pf[2]]; }
      const want = qLook([0, 1, 0], norm(f));
      local = qMul(qConj(shinQ), want);
      const ang = 2 * Math.acos(clamp(Math.abs(local[3]), 0, 1));
      if (ang > 55 * DEG) local = qPow(local, (55 * DEG) / ang);
      break;
    }
    case 'point': local = qAxis([1, 0, 0], 60 * DEG); break;
    case 'hook': local = qAxis([1, 0, 0], -18 * DEG); break;
    case 'toes': {
      // Ball of the foot on the mat: toes point down, the top of the foot
      // faces away from the knee.
      const knee = getV3(world.pos, shinBone);
      const ank = getV3(world.pos, foot);
      const away = norm([ank[0] - knee[0], 0, ank[2] - knee[2]]);
      const down = norm([-away[0] * 0.9, -1, -away[2] * 0.9]);
      const want = qLook(away, down);
      local = qMul(qConj(shinQ), want);
      break;
    }
    default: local = qAxis([1, 0, 0], 20 * DEG);
  }
  setQ(pose.local, foot, local);
  // Toes: bend back when tucked.
  const toe = foot === B.lFoot ? B.lToe : B.rToe;
  setQ(pose.local, toe, shape === 'toes' ? qAxis([1, 0, 0], -45 * DEG) : [0, 0, 0, 1]);
}

// ---------------------------------------------------------------------------
// Contact bookkeeping
// ---------------------------------------------------------------------------

function recordContacts(
  spec: PairSpec, st: [BodyState, BodyState], sP: number, buf: SolveBuffers, out: ContactRecord[],
): void {
  for (const i of [0, 1] as const) {
    const body = i === 0 ? spec.a : spec.b;
    for (const k of ['lArm', 'rArm'] as const) {
      const a = body[k];
      const c = armCache[i][k];
      const to = c?.alt && a.alt ? a.alt : a.to;
      if (!('on' in to) || (a.hand === 'fist')) continue;
      if (!c || !c.contact || c.dropped) continue;
      // Re-read the socket now: the partner may have moved since this arm solved.
      const tgt = resolveTarget(to, i, st[i], sP, buf);
      const want = madd(tgt.p, tgt.n ?? [0, 1, 0], HAND_T * st[i].s);
      const hand = k === 'lArm' ? B.lHand : B.rHand;
      const w = getV3(buf.worlds[i].pos, hand);
      const got = madd(w, norm(sub(want, w)), PALM * st[i].s);
      out.push({ who: i, limb: k, socket: to.on, want, got });
    }
    for (const k of ['lLeg', 'rLeg'] as const) {
      const l = body[k];
      const lc = legCache[i][k];
      const to = lc?.alt && l.alt ? l.alt : l.to;
      if (!to || !('on' in to) || l.knee) continue;
      const tgt = resolveTarget(to, i, st[i], sP, buf);
      const want = tgt.n ? madd(tgt.p, tgt.n, FOOT_T * st[i].s) : tgt.p;
      const foot = k === 'lLeg' ? B.lFoot : B.rFoot;
      out.push({ who: i, limb: k, socket: to.on, want, got: getV3(buf.worlds[i].pos, foot) });
    }
  }
}

/** Distance helper used by tests. */
export const contactError = (c: ContactRecord): number => dist(c.want, c.got);

// Silence unused-import lint for helpers kept for authoring convenience.
void qSlerp; void BONE_PARENT;
