/**
 * Leg entanglements (§2.2.11) plus X, K and HQ guard. The node table puts the
 * isolated leg on slot `a` (top, standing or kneeling) and the attacker on
 * slot `b` (bottom). The shared picture a viewer recognises as "leg lock
 * territory": b on his back, a's right foot pinned in b's armpit and hugged
 * to his chest, b's legs wrapped around a's right thigh/knee line.
 */
import type { BodySpec, LegSpec, PairSpec } from '../dsl';
import { arm, kneel, lie, matSelf, on, stand } from '../build';
import type { NodePose, Variant } from './types';

type V3 = [number, number, number];

function entangle(o: {
  aKneel?: boolean;
  lLeg: LegSpec;
  rLeg: LegSpec;
  bRoll?: number;
}): PairSpec {
  const b = lie({ at: [-0.08, 0.22], headYaw: 0, roll: o.bRoll ?? 0, crunch: 18, head: { look: [0, 0.4, -1] } });
  // a's right foot pinned at b's right armpit (b's right is +X).
  const trapped: LegSpec = { to: { p: [0.08, 0.3, 0.52] }, pole: [0, 0.4, 1], foot: 'point' };
  const aBody: Omit<BodySpec, 'lArm' | 'rArm'> = o.aKneel
    ? { ...kneel({ at: [0.02, -0.34], yaw: 0, h: 0.5, pitch: 14, chest: { bend: 12 }, lKnee: [0.4, 0.8], rKnee: [-0.3, 1], head: { look: [0, -0.8, 1] } }), rLeg: trapped }
    : { ...stand({ at: [0.02, -0.34], yaw: 0, h: 0.86, pitch: 18, chest: { bend: 14 }, lFoot: [0.22, -0.05], rFoot: [-0.1, 0.4], head: { look: [0, -0.8, 1] } }), rLeg: trapped };
  return {
    a: { ...aBody, lArm: arm(on('knee_front_R'), 'open', [0.6, -1, 0], 1, on('shin_R')), rArm: arm(on('knee_front_L'), 'open', [-0.6, -1, 0], 1, on('shin_L')) },
    b: {
      ...b,
      lLeg: o.lLeg,
      rLeg: o.rLeg,
      lArm: arm(on('ankle_R', [0, 0.02, 0]), 'grip', [0.7, -0.4, -1]),
      rArm: arm(on('heel_R'), 'grip', [-0.7, -0.4, -1]),
    },
  };
}

// Single-leg X: bottom foot behind a's knee, top foot on a's hip.
const slx = (): PairSpec => entangle({
  lLeg: { to: on('thigh_out_R', [0, 0.1, 0]), alt: on('knee_out_R'), pole: [0.4, 0.3, 1], foot: 'neutral' },
  rLeg: { to: on('thigh_back_R', [0.02, -0.05, 0]), pole: [-0.2, 0.3, 1], foot: 'hook' },
});
// Outside ashi: outside leg across a's hip, inside leg behind the thigh.
const ashiOutside = (): PairSpec => entangle({
  aKneel: true,
  lLeg: { to: on('hip_L', [0, 0, 0]), pole: [0.2, 0.3, 1], foot: 'point' },
  rLeg: { to: on('thigh_back_R'), pole: [-0.3, 0.3, 1], foot: 'hook' },
});
// Reap: inside leg across the knee line to the far hip.
const reap = (): PairSpec => entangle({
  aKneel: true,
  lLeg: { to: on('thigh_back_R', [0, 0.05, 0]), pole: [0.3, 0.3, 1], foot: 'hook' },
  rLeg: { to: on('hip_L', [0, -0.03, 0]), pole: [-0.4, 0.2, 1], foot: 'point' },
});
// Cross ashi: both legs crossed over a's trapped leg from the outside.
const ashiCross = (): PairSpec => entangle({
  aKneel: true,
  lLeg: { to: on('knee_out_R', [0.1, 0.02, 0]), pole: [0.4, 0.3, 1], foot: 'hook' },
  rLeg: { to: on('thigh_out_R', [0.12, 0.04, 0]), pole: [-0.2, 0.4, 1], foot: 'point' },
});

function saddle(_v: Variant): PairSpec {
  // Inside sankaku: a down on his left hip, posting; b's legs triangled
  // around a's right thigh, both hands on a's heel.
  const b = lie({ at: [-0.05, 0.28], headYaw: 0, roll: -20, crunch: 22, head: { look: [0, 0.3, -1] } });
  return {
    a: {
      hips: { at: [0.06, 0.16, -0.32] },
      pelvis: { up: [0.2, 0.75, -0.62], fwd: [0.3, 0.6, 0.75] },
      chest: { bend: 20 },
      head: { look: [0, -0.3, 1] },
      rLeg: { to: { p: [0.1, 0.28, 0.5] }, pole: [0, 0.6, 1], foot: 'point' },
      lLeg: { to: matSelf(0.35, 0.25), pole: [0.5, 0.2, 1], foot: 'neutral' },
      lArm: arm(matSelf(0.3, -0.25), 'post', [0.5, -1, 0]),
      rArm: arm(on('knee_front_L'), 'open', [-0.5, -1, 0]),
    },
    b: {
      ...b,
      lLeg: { to: on('thigh_out_R', [0.08, 0.02, 0]), pole: [0.3, 0.4, 1], foot: 'point' },
      rLeg: { to: on('thigh_back_R', [0, 0.02, 0]), pole: [-0.4, 0.4, 1], foot: 'hook' },
      lArm: arm(on('ankle_R'), 'grip', [0.6, -0.4, -1]),
      rArm: arm(on('heel_R'), 'grip', [-0.6, -0.4, -1]),
    },
  };
}

function fiftyFifty(_v: Variant): PairSpec {
  // Both seated facing each other, right legs interlaced along the centreline,
  // each holding the other's right heel.
  const seat = (z: number, face: 1 | -1): Omit<BodySpec, 'lArm' | 'rArm'> => ({
    hips: { at: [0.1 * -face, 0.13, z] },
    pelvis: { up: [0, 0.82, -0.57 * face], fwd: [0, 0.57, 0.82 * face] },
    chest: { bend: 34 },
    head: { at: 'face' },
    lLeg: { to: matSelf(0.25 * face, 0.4 * face), pole: [0.4, 0.3, 1], foot: 'neutral' },
    rLeg: { to: { p: [-0.12 * face, 0.28, 0.22 * face] }, pole: [-0.5, 0.4, 1], foot: 'neutral' },
  });
  return {
    a: { ...seat(-0.4, 1), lArm: arm(on('heel_R'), 'grip', [0.6, -1, 0]), rArm: arm(on('ankle_R'), 'grip', [-0.6, -1, 0]) },
    b: { ...seat(0.4, -1), lArm: arm(on('heel_R'), 'grip', [0.6, -1, 0]), rArm: arm(on('ankle_R'), 'grip', [-0.6, -1, 0]) },
  };
}

function truck(_v: Variant): PairSpec {
  // b rolled onto his left side from the turtle, spine toward +X; a kneels
  // behind his hips with b's left leg triangled, right hand on the far wrist,
  // left forearm to the chin.
  const b = lie({ at: [0.0, 0.26], headYaw: 90, roll: 80, crunch: 35, h: 0.16, head: { look: [1, 0.2, -0.3] } });
  const a = kneel({ at: [-0.18, -0.2], yaw: 25, h: 0.36, pitch: 40, chest: { bend: 25 }, lKnee: [0.5, 0.8], rKnee: [-0.4, 0.8], head: { look: [0.6, -0.4, 1] } });
  return {
    a: {
      ...a,
      rLeg: { to: on('thigh_in_L', [0, 0.02, 0]), pole: [-0.3, 0.3, 1], foot: 'hook' },
      rArm: arm(on('hip_R'), 'grip', [-0.6, -0.6, 0], 1, on('waist_R')),
      lArm: arm(on('chin'), 'grip', [0.8, -0.3, 0], 1, on('shoulder_L')),
    },
    b: {
      ...b,
      lLeg: { to: matSelf(-0.4, -0.2), pole: [0.3, 0, 1], foot: 'point' },
      rLeg: { to: matSelf(-0.35, 0.15, 0.13), pole: [-0.3, 0, 1], foot: 'point' },
      lArm: arm(matSelf(0.35, -0.15), 'post', [0.5, -1, 0]),
      rArm: arm({ self: 'face' }, 'fist', [-0.5, -1, 0]),
    },
  };
}

// ---------------------------------------------------------------------------
// X, K and HQ guard
// ---------------------------------------------------------------------------

function xGuard(_v: Variant): PairSpec {
  // b on his back under a standing man, head toward a's feet, shoulders by
  // his right leg; feet hooking inside his thighs, arms hugging his right leg.
  const a = stand({ at: [0, -0.1], yaw: 0, h: 0.84, pitch: 34, chest: { bend: 24 }, lFoot: [0.25, 0.12], rFoot: [-0.18, 0.02], head: { look: [0, -0.8, 0.5] } });
  const b = lie({ at: [-0.06, 0.36], headYaw: 180, crunch: 24, head: { look: [0, 0.5, 1] } });
  return {
    a: { ...a, lArm: arm(on('knee_front_R'), 'grip', [0.6, -1, 0], 1, on('shin_R')), rArm: arm(on('knee_front_L'), 'grip', [-0.6, -1, 0], 1, on('shin_L')) },
    b: {
      ...b,
      lLeg: { to: on('thigh_in_L', [0, -0.08, 0]), pole: [0.4, 0.3, 1], foot: 'hook' },
      rLeg: { to: on('thigh_in_R', [0, -0.02, 0]), pole: [-0.4, 0.3, 1], foot: 'hook' },
      lArm: arm(on('calf_R'), 'grip', [0.6, -0.4, -1]),
      rArm: arm(on('knee_back_R'), 'grip', [-0.6, -0.4, -1]),
    },
  };
}

function kGuard(_v: Variant): PairSpec {
  // b turned onto his right hip, left shin across a's belly, right foot
  // hooking behind a's right knee, right hand gripping behind it.
  const a = kneel({ at: [0, -0.3], yaw: 0, h: 0.48, pitch: 12, chest: { bend: 12 }, lKnee: [0.55, 0.8], rKnee: [-0.55, 0.8], head: { at: 'face' } });
  const b = lie({ at: [-0.02, 0.22], headYaw: -25, roll: -40, crunch: 25, head: { at: 'face' } });
  return {
    a: { ...a, lArm: arm(on('hip_R'), 'grip', [0.6, -1, 0], 1, on('knee_front_L')), rArm: arm(on('ribs_L'), 'grip', [-0.6, -1, 0], 1, on('knee_front_L')) },
    b: {
      ...b,
      lLeg: { to: on('ribs_L', [0.02, -0.05, 0]), pole: [0.3, 0.3, 1], foot: 'neutral' },
      rLeg: { to: on('knee_back_R', [0.02, 0, 0]), pole: [-0.3, 0.3, 1], foot: 'hook' },
      rArm: arm({ self: 'face', off: [-0.06, 0.03, 0] }, 'fist', [-0.5, -0.4, -1]),
      lArm: arm({ self: 'face', off: [0.06, 0.03, 0] }, 'fist', [0.5, -0.4, -1]),
    },
  };
}

function hq(v: Variant): PairSpec {
  // Half-kneeling: a's right knee pins b's left thigh, left foot posted wide.
  const b = lie({ at: [0, 0.2], headYaw: 0, roll: 15, crunch: 14, head: { at: 'face' } });
  return {
    a: {
      hips: { at: [-0.05, v.postured ? 0.56 : 0.52, -0.28] },
      pelvis: { up: [0, 0.94, 0.34], fwd: [0, -0.34, 0.94] },
      chest: { bend: 18 },
      head: { at: 'face' },
      rLeg: { knee: on('thigh_L', [0, 0.02, 0]), shin: [0, -0.35, -1], foot: 'toes' },
      lLeg: { to: matSelf(0.36, 0.12), pole: [0.6, 0, 1], foot: 'flat' },
      lArm: arm(on('knee_front_R'), 'grip', [0.6, -1, 0]),
      rArm: arm(on('knee_front_L'), 'grip', [-0.6, -1, 0]),
    },
    b: {
      ...b,
      lLeg: { to: matSelf(-0.2, -0.55), pole: [0.3, 0.3, 1], foot: 'neutral' },
      rLeg: { to: matSelf(0.22, -0.3), pole: [-0.3, 0, 1], foot: 'flat' },
      lArm: arm(on('knee_front_R'), 'open', [0.5, -0.5, -1], 1, on('shin_R')),
      rArm: arm(on('thigh_L'), 'open', [-0.5, -0.5, -1], 1, on('knee_front_R')),
    },
  };
}

export const LEG_POSES: Record<string, NodePose> = {
  'pos.ground_ashi_slx': slx,
  'pos.ground_ashi_outside': ashiOutside,
  'pos.ground_5050': fiftyFifty,
  'pos.ground_saddle': saddle,
  'pos.ground_reap': reap,
  'pos.ground_ashi_cross': ashiCross,
  'pos.ground_truck': truck,
  'pos.ground_open_x': xGuard,
  'pos.ground_open_k': kGuard,
  'pos.ground_hq': hq,
};

export type { V3 };
