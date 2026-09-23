/**
 * SUBMISSIONS — stage poses per family (docs/design/04 §2.2, 08 §5.7).
 *
 * Stages: 1 entry (isolate the limb / thread the arm), 2 secure (grip locked,
 * angle set), 3 finish (squeeze, hips, arch), 4 locked (the tap, or the
 * defender going limp on a choke's loss of consciousness). Stage 0 (setup) is
 * the position itself and is not drawn here.
 *
 * Each builder knows its natural attacker slot (the triangle is a bottom
 * attack, so its attacker is `b`); if the sim's attacker is the other slot,
 * the pose is role-swapped. The defender fights hands at every stage: two
 * hands on the choking arm, posture, stacking, and the tap is a repeated palm
 * strike on the attacker or the mat.
 */
import type { ArmSpec, BodySpec, PairSpec } from './dsl';
import { swapRoles } from './dsl';
import { arm, kneesUp, legsFlat, lie, mat, matSelf, on, self } from './build';
import { evalNodePose, type Variant } from './poses/types';
import { nodePoseFor } from './poses';
import { POSITIONS, SUBMISSIONS } from '../../../sim';
import type { PairRequest, SubRequest } from './request';

const FAMILY_OF = new Map(POSITIONS.map((p) => [p.id as string, p.family as string] as const));
const SUB_SPEC = new Map((SUBMISSIONS as readonly { id: string; family: string; role: string }[]).map((s) => [s.id, s] as const));

function base(node: string, v: Variant): PairSpec | null {
  const p = nodePoseFor(node);
  return p ? evalNodePose(p, v) : null;
}

type Ctx = { node: string; family: string; v: Variant; s: SubRequest };
type Builder = (c: Ctx) => { spec: PairSpec; slot: 'a' | 'b'; variant: string } | null;

// ---------------------------------------------------------------------------
// Shared defender behaviours
// ---------------------------------------------------------------------------

/** A repeated palm tap: the hand lifts and slaps down ~3 times a second. */
function tapArm(to: ArmSpec['to'], t: number, pole?: [number, number, number]): ArmSpec {
  const lift = 0.07 * Math.abs(Math.sin(t * Math.PI * 3.2));
  const off: [number, number, number] = [0, lift, 0];
  const target = 'on' in to ? { on: to.on, off } : 'mat' in to ? { ...to, h: 0.045 + lift } : to;
  return { to: target, hand: 'open', pole };
}

/** Limp: arms fall to the mat beside the body, head lolls, eyes closed. */
function limp(body: BodySpec): BodySpec {
  return {
    ...body,
    head: { ...(body.head ?? {}), look: undefined, at: undefined, bend: 35, side: 15 },
    chest: body.chest,
    lArm: { to: matSelf(0.35, 0.05, 0.05), hand: 'relaxed', pole: [0.3, -1, -0.2] },
    rArm: { to: matSelf(-0.35, 0.05, 0.05), hand: 'relaxed', pole: [-0.3, -1, -0.2] },
    face: { eyesClosedL: 1, eyesClosedR: 1, jawSlack: 0.8 },
  };
}

function pain(body: BodySpec, k: number): BodySpec {
  return { ...body, face: { ...(body.face ?? {}), grimace: 0.5 + 0.4 * k, eyesClosedL: 0.3 * k, eyesClosedR: 0.3 * k, mouthOpen: 0.3 * k } };
}

/** Stage 4: the defender (slot `d`) taps with `hand` on `to`, or goes limp. */
function finishStage(p: PairSpec, d: 'a' | 'b', s: SubRequest, hand: 'lArm' | 'rArm', to: ArmSpec['to']): PairSpec {
  if (s.stage < 4) return p;
  const body = p[d];
  let nb: BodySpec;
  if (s.limp) nb = limp(body);
  else nb = pain({ ...body, [hand]: tapArm(to, s.tapT ?? 0, body[hand].pole) }, 1);
  return d === 'a' ? { ...p, a: nb } : { ...p, b: nb };
}

// ---------------------------------------------------------------------------
// Rear-naked choke (and the rear crank / short choke)
// ---------------------------------------------------------------------------

const rnc: Builder = ({ node, family, v, s }) => {
  const standing = family === 'clinch';
  const src = family === 'back' ? node : standing ? 'pos.clinch_body_lock_rear' : 'pos.ground_back_hooks';
  const p = base(src === 'pos.ground_back_seatbelt' ? 'pos.ground_back_hooks' : src, v);
  if (!p) return null;
  const st = s.stage;
  const squeeze = st >= 3 ? 0.5 + 0.5 * Math.sin(s.stageT * 5) : 0;
  const a: BodySpec = {
    ...p.a,
    head: { look: [0.35, -0.1, 1], side: -10 },
    chest: st >= 3 ? { bend: 8 - 10 * squeeze, twist: 6 } : p.a.chest,
    // Choking arm: elbow under the chin, hand to the far shoulder, then to
    // the own biceps (figure four) with the other hand behind the head.
    // Elbow under the chin (pole forward and down), forearm across the throat.
    rArm: st <= 1
      ? arm(on('shoulder_L', [0, -0.02, 0.02]), 'grip', [-0.3, -0.7, 1])
      : arm(self('bicep_L', [0, -0.01, 0.02]), 'grip', [-0.3, -0.7, 1]),
    lArm: st <= 1 ? arm(on('chest', [-0.03, 0, 0.02]), 'grip', [0.9, 0.5, 0]) : arm(on('neck_back', [0.03, 0.03, 0]), 'open', [0.9, 0.3, 0.1]),
  };
  let b: BodySpec = {
    ...p.b,
    head: st <= 1 ? { bend: 30 } : st === 2 ? { bend: 15 } : { bend: -12 - 8 * squeeze },
    // Two-on-one on the choking arm, then pulling at the forearm.
    lArm: arm(on('wrist_R'), 'grip', [0.5, -1, 0.3]),
    rArm: arm(on('forearm_R'), 'grip', [-0.5, -1, 0.3]),
  };
  if (st >= 3) {
    b = pain(b, squeeze);
    if (!standing) b = { ...b, ...legsFlat(0, 0.24) };
  }
  let spec: PairSpec = { a, b };
  spec = finishStage(spec, 'b', s, 'rArm', on('thigh_R'));
  return { spec, slot: 'a', variant: standing ? 'standing' : 'back' };
};

// ---------------------------------------------------------------------------
// Guillotines
// ---------------------------------------------------------------------------

const GUARD_FAMILIES = new Set(['closedGuard', 'openGuard', 'half', 'legEntanglement']);

const guillotine: Builder = (c) => {
  const { family, v, s } = c;
  const st = s.stage;
  if (s.attacker === 'b' && GUARD_FAMILIES.has(family)) {
    // From guard: a's head trapped under b's right arm, b's legs closed.
    const p = base('pos.ground_closed_posture_broken', v)!;
    const arch = st >= 3;
    const b: BodySpec = {
      ...p.b,
      chest: { bend: arch ? 4 : 16 },
      head: { at: 'head_back' },
      rArm: arm(on('throat', [0.07, -0.03, 0]), 'grip', [-0.9, 0.2, 0.2]),
      lArm: st <= 1 ? arm(on('neck_back', [0.04, 0.02, 0]), 'grip', [0.6, 0.2, -0.6]) : arm(self('wrist_R'), 'grip', [0.6, 0, -0.6]),
      pelvis: arch ? { up: [0, -0.45, 1], fwd: [0, 1, 0.45] } : p.b.pelvis,
    };
    let a: BodySpec = {
      ...p.a,
      chest: { aim: 'chest_R' },
      head: { look: [0.3, -0.6, 1], side: 20 },
      lArm: arm(on('forearm_R'), 'grip', [0.6, -0.5, -0.2]),
      rArm: st >= 2 ? arm(on('wrist_R'), 'grip', [-0.6, -0.5, -0.2]) : p.a.rArm,
    };
    if (st >= 3) a = pain(a, 0.7);
    let spec: PairSpec = { a, b };
    spec = finishStage(spec, 'a', s, 'lArm', on('thigh_R'));
    return { spec, slot: 'b', variant: 'guard' };
  }
  if (family === 'mount') {
    const p = base('pos.ground_mount_low', v)!;
    const a: BodySpec = {
      ...p.a,
      chest: { bend: 42 },
      head: { look: [0.4, -0.5, 1] },
      rArm: arm(on('throat', [0.05, -0.03, 0]), 'grip', [-0.9, 0.3, 0.2]),
      lArm: st <= 1 ? arm(on('neck_back'), 'grip', [0.7, -0.5, 0]) : arm(self('wrist_R'), 'grip', [0.7, -0.5, 0]),
    };
    let b: BodySpec = { ...p.b, lArm: arm(on('forearm_R'), 'grip', [0.5, -0.5, -1]), rArm: arm(on('wrist_R'), 'grip', [-0.5, -0.5, -1]) };
    if (st >= 3) b = pain(b, 0.8);
    let spec: PairSpec = { a, b };
    spec = finishStage(spec, 'b', s, 'lArm', on('ribs_R'));
    return { spec, slot: 'a', variant: 'mount' };
  }
  // Front: from the front headlock (standing or on the knees), attacker a.
  const ground = family === 'turtle' || c.node === 'pos.ground_front_headlock' || c.node === 'pos.td_sprawl';
  const p = base(ground ? 'pos.ground_front_headlock' : 'pos.clinch_front_headlock', v)!;
  const arch = st >= 3;
  const a: BodySpec = {
    ...p.a,
    pelvis: arch ? { up: [0, 0.97, -0.25], fwd: [0, 0.25, 0.97] } : p.a.pelvis,
    chest: { bend: arch ? -8 : 20 },
    rArm: arm(on('throat', [0.06, -0.02, 0]), 'grip', [-0.9, -0.2, 0.1]),
    lArm: st <= 1 ? arm(on('elbow_R'), 'grip', [0.8, -0.5, 0.1]) : arm(self('wrist_R'), 'grip', [0.8, -0.4, 0.2]),
  };
  let b: BodySpec = {
    ...p.b,
    lArm: arm(on('forearm_R'), 'grip', [0.5, -1, 0]),
    rArm: st >= 2 ? arm(on('wrist_R'), 'grip', [-0.5, -1, 0]) : p.b.rArm,
  };
  if (st >= 3) b = pain(b, 0.8);
  let spec: PairSpec = { a, b };
  spec = finishStage(spec, 'b', s, 'rArm', on('thigh_L'));
  return { spec, slot: 'a', variant: ground ? 'front-ground' : 'front-standing' };
};

// ---------------------------------------------------------------------------
// Arm-in chokes from the front (D'Arce, anaconda, neckties, bulldog)
// ---------------------------------------------------------------------------

const darce: Builder = ({ v, s }) => {
  const p = base('pos.ground_front_headlock', v)!;
  const st = s.stage;
  const a: BodySpec = {
    ...p.a,
    chest: { bend: st >= 3 ? 40 : 28, side: st >= 3 ? 12 : 0 },
    rArm: arm(on('neck_side_L', [0, -0.02, 0]), 'grip', [-0.9, -0.3, 0.2]),
    lArm: st <= 1 ? arm(on('back_upper'), 'grip', [0.8, -0.5, 0]) : arm(self('bicep_R'), 'grip', [0.8, -0.3, 0.2]),
  };
  let b: BodySpec = { ...p.b, rArm: arm(on('forearm_R'), 'grip', [-0.5, -1, 0]) };
  if (st >= 3) b = pain(b, 0.8);
  let spec: PairSpec = { a, b };
  spec = finishStage(spec, 'b', s, 'lArm', mat(0.3, 0.25));
  return { spec, slot: 'a', variant: 'front' };
};

// ---------------------------------------------------------------------------
// Arm triangle and top chokes (side / mount / north-south / Ezekiel)
// ---------------------------------------------------------------------------

const armTriangle: Builder = ({ v, s }) => {
  const p = base('pos.ground_side', v)!;
  const st = s.stage;
  // a slides toward b's head, head beside b's head on the far side; b's near
  // (right) arm pinned across his own throat.
  const a: BodySpec = {
    ...p.a,
    hips: { at: [0.18, 0.3, -0.42] },
    pelvis: { up: [0.25, 0.2, 1], fwd: [0, -1, 0.2] },
    chest: { up: [0.35, -0.1, 1], fwd: [0, -1, -0.1] },
    head: { look: [0.6, -0.6, 0.5] },
    lArm: arm(on('neck_back', [0, -0.03, 0]), 'grip', [0.8, -0.2, 0.3]),
    rArm: st >= 2 ? arm(self('bicep_L', [0, 0, 0]), 'grip', [-0.8, 0.2, 0.2]) : arm(on('elbow_R'), 'grip', [-0.6, -0.6, 0.2]),
  };
  let b: BodySpec = {
    ...p.b,
    head: { look: [0.2, 1, 0.3] },
    rArm: arm(self('neck_side_L', [0, 0.03, 0]), 'open', [-0.3, 0.4, -0.3]),
    lArm: arm(on('scap_L'), 'grip', [0.6, -0.3, -0.5]),
  };
  if (st >= 3) b = pain(b, 0.7);
  let spec: PairSpec = { a, b };
  spec = finishStage(spec, 'b', s, 'lArm', on('back_upper'));
  return { spec, slot: 'a', variant: 'side' };
};

const topChoke: Builder = ({ node, family, v, s }) => {
  // North-south choke, Ezekiel, von Flue: the node's own pose with the
  // choking arm around the neck and a hand clasp.
  const src = family === 'mount' || family === 'side' ? node : 'pos.ground_north_south';
  const p = base(src, v);
  if (!p) return null;
  const st = s.stage;
  const a: BodySpec = {
    ...p.a,
    lArm: arm(on('head_back'), 'grip', [0.7, -0.5, 0]),
    rArm: st >= 2 ? arm(on('throat', [0.03, 0, 0]), 'fist', [-0.7, -0.5, 0]) : p.a.rArm,
  };
  let b: BodySpec = { ...p.b, lArm: arm(on('forearm_R'), 'grip', [0.5, -0.4, -1]), rArm: arm(on('wrist_R'), 'grip', [-0.5, -0.4, -1]) };
  if (st >= 3) b = pain(b, 0.7);
  let spec: PairSpec = { a, b };
  spec = finishStage(spec, 'b', s, 'lArm', on('back_upper'));
  return { spec, slot: 'a', variant: `top:${src}` };
};

// ---------------------------------------------------------------------------
// Triangle (from guard, attacker b)
// ---------------------------------------------------------------------------

const triangle: Builder = ({ v, s }) => {
  const p = base('pos.ground_closed_posture_broken', v)!;
  const st = s.stage;
  // b's right leg over a's left shoulder (a's left arm out, right arm in),
  // the calf behind a's neck, then the figure-four.
  const b: BodySpec = {
    ...p.b,
    pelvis: { up: [-0.25, -0.35, 1], fwd: [0.2, 1, 0.3] },
    chest: { bend: st >= 3 ? 22 : 14, twist: -10 },
    head: { at: 'face' },
    // Knee over a's left shoulder, calf behind his neck.
    rLeg: { knee: on('shoulder_L', [0.08, 0.1, 0.02]), to: on('neck_side_R', [0, 0, -0.08]), foot: 'point' },
    lLeg: st <= 1
      ? { to: on('back_lower'), pole: [0.9, 0, 0.45], foot: 'point' }
      : { knee: self('ankle_R', [0.03, 0, 0]), to: on('scap_R', [0, 0.1, 0]), foot: 'point' },
    lArm: arm(on('head_back', [0, 0.02, 0]), 'grip', [0.5, 0.3, -1]),
    rArm: arm(on('wrist_R'), 'grip', [-0.5, -0.4, -1]),
  };
  let a: BodySpec = {
    ...p.a,
    chest: { aim: 'belly' },
    head: { look: [0, -1, 0.2], side: 25 },
    rArm: arm(on('chest'), 'open', [-0.4, -1, 0]),
  };
  if (st >= 3) a = pain(a, 0.8);
  let spec: PairSpec = { a, b };
  spec = finishStage(spec, 'a', s, 'lArm', on('thigh_R'));
  return { spec, slot: 'b', variant: 'guard' };
};

// ---------------------------------------------------------------------------
// Armbars
// ---------------------------------------------------------------------------

const armbarMount: Builder = ({ v, s }) => {
  const st = s.stage;
  if (st <= 1) {
    // Entry from S-mount: both hands isolating b's right arm.
    const p = base('pos.ground_mount_s', v)!;
    const a: BodySpec = { ...p.a, rArm: arm(on('elbow_R'), 'grip', [-0.6, -1, 0]) };
    return { spec: { a, b: p.b }, slot: 'a', variant: 'mount' };
  }
  const b0 = lie({ at: [0, 0], headYaw: 0, roll: -10, head: { look: [0.3, 1, 0.3] } });
  const fallen = st >= 3;
  // a sits (stage 2) or lies back (stage 3+) perpendicular, beside b's right
  // shoulder, left leg across b's face, right leg across his chest, b's right
  // arm clamped along a's torso.
  const a: BodySpec = {
    hips: { on: 'shoulder_R', off: [0.14, fallen ? 0.02 : 0.06, 0.02] },
    pelvis: fallen ? { up: [1, 0.1, 0], fwd: [0, 1, -0.1] } : { up: [0.45, 0.9, 0], fwd: [-0.9, 0.45, 0] },
    chest: { bend: fallen ? 12 : 20 },
    head: { look: fallen ? [-0.2, 1, 0.1] : [-1, -0.4, 0] },
    // Knees pinched, heels pulling down across b's face and chest.
    lLeg: { to: { p: [-0.28, 0.12, 0.74] }, pole: [0.3, 0.2, 1], foot: 'point' },
    rLeg: { to: { p: [-0.3, 0.13, 0.3] }, pole: [-0.3, 0.2, 1], foot: 'point' },
    lArm: arm(on('wrist_R'), 'grip', [0.6, -0.2, 0.6]),
    rArm: arm(on('forearm_R'), 'grip', [-0.6, -0.2, 0.6]),
  };
  let b: BodySpec = {
    ...b0,
    ...kneesUp(0, 0.2, 0.42),
    // The trapped arm, extended along a's torso (thumb up).
    rArm: arm(on('chest', [0, fallen ? 0.08 : 0.02, 0]), 'fist', [-0.2, 1, 0]),
    lArm: arm(on('forearm_R', [0, 0, 0]), 'grip', [0.5, -0.4, -1]),
  };
  if (st >= 3) b = pain(b, 0.9);
  let spec: PairSpec = { a, b };
  spec = finishStage(spec, 'b', s, 'lArm', on('thigh_R'));
  return { spec, slot: 'a', variant: 'mount' };
};

const armbarGuard: Builder = ({ v, s }) => {
  const p = base('pos.ground_closed_posture_broken', v)!;
  const st = s.stage;
  // b cuts the angle, right leg over a's face, left across his back, a's
  // right arm clamped to b's chest; a stacks.
  const b: BodySpec = {
    ...p.b,
    pelvis: { up: [-0.5, st >= 3 ? -0.45 : -0.3, 1], fwd: [0.25, 1, 0.3] },
    chest: { bend: 10, twist: -15 },
    head: { at: 'face' },
    rLeg: { to: on('head_side_L', [0.05, 0.05, -0.05]), pole: [-0.2, 0.5, 1], foot: 'point' },
    lLeg: { to: on('scap_R', [0, 0.04, 0]), pole: [0.6, 0.2, 1], foot: 'point' },
    lArm: arm(on('wrist_R'), 'grip', [0.6, -0.4, -1]),
    rArm: arm(on('forearm_R'), 'grip', [-0.6, -0.4, -1]),
  };
  let a: BodySpec = {
    ...p.a,
    chest: { bend: 20 },
    head: { look: [0.3, -0.8, 1] },
    rArm: arm(on('chest', [0, 0.04, 0]), 'fist', [-0.3, 0.6, 1]),
  };
  if (st >= 3) a = pain(a, 0.9);
  let spec: PairSpec = { a, b };
  spec = finishStage(spec, 'a', s, 'lArm', on('thigh_L'));
  return { spec, slot: 'b', variant: 'guard' };
};

// ---------------------------------------------------------------------------
// Kimura / Americana (top, attacker a from side control)
// ---------------------------------------------------------------------------

const kimuraTop = (americana: boolean): Builder => ({ v, s }) => {
  const p = base('pos.ground_side', v)!;
  const st = s.stage;
  // b's far (left) arm bent 90°: elbow out on the mat, hand up; the finish
  // paints it toward the head (americana) or behind the back (kimura).
  const hand: [number, number, number] = st <= 1
    ? [0.02, 0.22, 0.18]
    : st === 2 ? (americana ? [0.18, 0.06, 0.22] : [-0.02, 0.22, 0.2])
      : americana ? [0.26, 0.02, 0.16] : [-0.12, 0.1, 0.1];
  let b: BodySpec = {
    ...p.b,
    lArm: arm(self('shoulder_L', hand), 'fist', [1, -0.2, -0.3]),
  };
  const a: BodySpec = {
    ...p.a,
    lArm: arm(on('wrist_L'), 'grip', [0.6, -0.8, 0.2]),
    rArm: st >= 2 ? arm(self('wrist_L', [0, 0, 0]), 'grip', [-0.6, 0.3, 0.8]) : arm(on('elbow_L'), 'grip', [-0.6, -0.3, 0.6]),
    chest: { up: [0.1, -0.05, 1], fwd: [0, -1, -0.05] },
  };
  if (st >= 3) b = pain(b, 0.9);
  let spec: PairSpec = { a, b };
  spec = finishStage(spec, 'b', s, 'rArm', on('back_upper'));
  return { spec, slot: 'a', variant: americana ? 'americana' : 'kimura' };
};

const kimuraGuard: Builder = ({ v, s }) => {
  const p = base('pos.ground_closed_posture_broken', v)!;
  const st = s.stage;
  // b sits up to his left, right hand on a's right wrist, left arm over a's
  // right shoulder into the figure four; then falls back turning the arm.
  const b: BodySpec = {
    ...p.b,
    chest: { bend: st >= 3 ? 20 : 45, twist: 25, side: 10 },
    head: { look: [-0.5, 0, -1] },
    rArm: arm(on('wrist_R'), 'grip', [-0.5, -0.4, -1]),
    lArm: st >= 2 ? arm(self('wrist_R'), 'grip', [0.8, 0.5, 0]) : arm(on('tricep_R'), 'grip', [0.8, 0.5, 0]),
    lLeg: { to: matSelf(0.25, -0.35), pole: [0.4, 0.3, 1], foot: 'flat' },
  };
  let a: BodySpec = {
    ...p.a,
    rArm: arm(st >= 3 ? on('back_lower', [-0.1, 0.1, -0.05]) : mat(-0.26, 0.36), st >= 3 ? 'open' : 'post', [-0.6, 0.2, -0.3]),
    chest: { bend: 30, twist: st >= 3 ? -20 : 0 },
  };
  if (st >= 3) a = pain(a, 0.9);
  let spec: PairSpec = { a, b };
  spec = finishStage(spec, 'a', s, 'lArm', mat(0.3, 0.2));
  return { spec, slot: 'b', variant: 'guard' };
};

// ---------------------------------------------------------------------------
// Omoplata (bottom)
// ---------------------------------------------------------------------------

const omoplata: Builder = ({ v, s }) => {
  const p = base('pos.ground_closed_posture_broken', v)!;
  const st = s.stage;
  // a driven face-down; b sits up beside a's shoulder, legs figure-four on it.
  let a: BodySpec = {
    ...p.a,
    pelvis: { up: [0.2, 0.45, 1], fwd: [0, -1, 0.45] },
    chest: { up: [0.3, -0.35, 1], fwd: [0, -1, -0.35] },
    head: { look: [0.5, -0.8, 0.2] },
    lArm: arm(mat(0.35, 0.25), 'post', [0.5, -1, 0]),
    rArm: arm(on('back_mid', [0.1, 0, -0.08]), 'open', [-0.4, 0.8, 0.2]),
  };
  let b: BodySpec = {
    hips: { on: 'shoulder_R', off: [-0.3, -0.25, 0.25] },
    pelvis: { up: [0.2, 0.9, 0.35], fwd: [0.9, -0.2, -0.3] },
    chest: { bend: st >= 3 ? 40 : 25 },
    head: { look: [0.5, -0.5, -0.5] },
    rLeg: { to: on('scap_R', [0.1, 0.05, 0]), alt: on('shoulder_R', [0, 0.04, 0]), pole: [-0.3, 0.3, 1], foot: 'point' },
    lLeg: { to: matSelf(0.4, 0.2), pole: [0.4, 0.3, 1], foot: 'neutral' },
    lArm: arm(on('back_lower'), 'grip', [0.6, -0.8, 0]),
    rArm: arm(mat(-0.2, 0.2), 'post', [-0.6, -0.8, 0]),
  };
  if (st >= 3) a = pain(a, 0.8);
  let spec: PairSpec = { a, b };
  spec = finishStage(spec, 'a', s, 'lArm', mat(0.35, 0.25));
  void b;
  return { spec, slot: 'b', variant: 'guard' };
};

// ---------------------------------------------------------------------------
// Leg locks (attacker b from the entanglement)
// ---------------------------------------------------------------------------

const legLock = (kind: 'heel' | 'ankle' | 'knee' | 'toe'): Builder => ({ node, family, v, s }) => {
  const src = family === 'legEntanglement' ? node : 'pos.ground_saddle';
  const p = base(src, v);
  if (!p) return null;
  const st = s.stage;
  const b: BodySpec = {
    ...p.b,
    chest: kind === 'ankle' || kind === 'knee' ? { bend: st >= 3 ? -15 : 10 } : { bend: 20, twist: st >= 3 ? -30 : -10 },
    lArm: arm(on(kind === 'toe' ? 'foot_R' : 'heel_R'), 'grip', [0.6, -0.3, -1]),
    rArm: st >= 2 ? arm(self('wrist_L'), 'grip', [-0.6, -0.3, -1]) : arm(on('ankle_R'), 'grip', [-0.6, -0.3, -1]),
  };
  let a: BodySpec = { ...p.a };
  if (st >= 3) a = pain(a, 1);
  let spec: PairSpec = { a, b };
  spec = finishStage(spec, 'a', s, 'lArm', matSelf(0.3, 0.1));
  return { spec, slot: 'b', variant: `leg:${src}` };
};

// ---------------------------------------------------------------------------
// Can opener / cranks from inside the guard (attacker a on top)
// ---------------------------------------------------------------------------

const canOpener: Builder = ({ v, s }) => {
  const p = base('pos.ground_closed_posture_up', v)!;
  const st = s.stage;
  const a: BodySpec = {
    ...p.a,
    chest: { bend: 35 },
    lArm: arm(on('head_back', [0.03, 0, 0]), 'grip', [0.8, -0.5, 0]),
    rArm: arm(on('head_back', [-0.03, 0, 0]), 'grip', [-0.8, -0.5, 0]),
  };
  let b: BodySpec = {
    ...p.b,
    chest: { bend: st >= 3 ? 45 : 25 },
    head: { bend: 30 },
    lArm: arm(on('wrist_R'), 'grip', [0.5, -0.5, -0.8]),
    rArm: arm(on('wrist_L'), 'grip', [-0.5, -0.5, -0.8]),
  };
  if (st >= 3) b = pain(b, 0.8);
  let spec: PairSpec = { a, b };
  spec = finishStage(spec, 'b', s, 'lArm', on('ribs_R'));
  return { spec, slot: 'a', variant: 'guard' };
};

// ---------------------------------------------------------------------------
// Technique → builder
// ---------------------------------------------------------------------------

const BUILDERS: Record<string, Builder> = {
  'sub.rnc': rnc,
  'sub.rnc_short': rnc,
  'sub.neck_crank_rear': rnc,
  'sub.suloev_stretch': rnc,
  'sub.crucifix_choke': rnc,
  'sub.crucifix_armlock': rnc,
  'sub.armbar_back': armbarMount,
  'sub.triangle_rear': rnc,
  'sub.guillotine_standard': guillotine,
  'sub.guillotine_arm_in': guillotine,
  'sub.guillotine_high_elbow': guillotine,
  'sub.guillotine_ten_finger': guillotine,
  'sub.guillotine_standing': guillotine,
  'sub.guillotine_mounted': guillotine,
  'sub.ezekiel_bottom': guillotine,
  'sub.darce': darce,
  'sub.anaconda': darce,
  'sub.peruvian_necktie': darce,
  'sub.japanese_necktie': darce,
  'sub.bulldog': darce,
  'sub.arm_triangle_mount': armTriangle,
  'sub.arm_triangle_side': armTriangle,
  'sub.arm_triangle_standing': guillotine,
  'sub.north_south_choke': topChoke,
  'sub.von_flue': topChoke,
  'sub.ezekiel_top': topChoke,
  'sub.neck_crank_generic': topChoke,
  'sub.triangle_guard': triangle,
  'sub.triangle_mounted': triangle,
  'sub.triangle_side': triangle,
  'sub.triangle_inverted': triangle,
  'sub.triangle_flying': triangle,
  'sub.gogoplata': triangle,
  'sub.buggy_choke': triangle,
  'sub.armbar_mount': armbarMount,
  'sub.armbar_belly_down': armbarMount,
  'sub.armbar_guard': armbarGuard,
  'sub.armbar_flying': armbarGuard,
  'sub.americana': kimuraTop(true),
  'sub.kimura_side': kimuraTop(false),
  'sub.kimura_north_south': kimuraTop(false),
  'sub.kimura_guard': kimuraGuard,
  'sub.kimura_half': kimuraGuard,
  'sub.kimura_grip': kimuraGuard,
  'sub.omoplata': omoplata,
  'sub.heel_hook_inside': legLock('heel'),
  'sub.heel_hook_outside': legLock('heel'),
  'sub.kneebar': legLock('knee'),
  'sub.ankle_lock_straight': legLock('ankle'),
  'sub.toe_hold': legLock('toe'),
  'sub.calf_slicer': legLock('knee'),
  'sub.banana_split': legLock('knee'),
  'sub.twister': rnc,
  'sub.can_opener': canOpener,
};

/** Which submissions have a builder (all 54 — asserted by the tests). */
export function subCoverage(): { id: string; builder: string }[] {
  return [...SUB_SPEC.keys()].map((id) => ({ id, builder: BUILDERS[id] ? BUILDERS[id].name || 'builder' : 'none' }));
}

export function subPose(req: PairRequest, v: Variant): { spec: PairSpec; variant: string } | null {
  const s = req.sub;
  if (!s || s.stage < 1) return null;
  const b = BUILDERS[s.technique];
  if (!b) return null;
  const family = FAMILY_OF.get(req.node) ?? 'transient';
  const r = b({ node: req.node, family, v, s });
  if (!r) return null;
  const spec = r.slot === s.attacker ? r.spec : swapRoles(r.spec);
  return { spec, variant: r.variant };
}

/** A sensible node to show a submission from in the pose browser. */
export function defaultNodeForSub(sub: string): string {
  const b = BUILDERS[sub];
  if (b === rnc) return 'pos.ground_back_hooks';
  if (b === guillotine) return sub === 'sub.guillotine_mounted' ? 'pos.ground_mount_high' : sub === 'sub.guillotine_standing' ? 'pos.clinch_front_headlock' : 'pos.ground_closed_posture_broken';
  if (b === darce) return 'pos.ground_front_headlock';
  if (b === armTriangle) return 'pos.ground_side';
  if (b === topChoke) return sub === 'sub.ezekiel_top' ? 'pos.ground_mount_low' : 'pos.ground_north_south';
  if (b === triangle || b === armbarGuard || b === kimuraGuard || b === omoplata) return 'pos.ground_closed_posture_broken';
  if (b === armbarMount) return 'pos.ground_mount_high';
  if (b === canOpener) return 'pos.ground_closed_posture_up';
  if (sub === 'sub.americana' || sub.startsWith('sub.kimura_')) return 'pos.ground_side';
  return 'pos.ground_saddle';
}

void legsFlat;
