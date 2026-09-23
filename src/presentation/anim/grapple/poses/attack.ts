/**
 * Attacks in progress (§2.2.3): captured legs, the sprawl, a lift, a throw at
 * its loading point, a caught kick. Pair frame as the clinch: `a` at -Z facing
 * +Z, `b` at +Z facing -Z. `pos.td_sprawl` is the exception the node table
 * makes: slot `a` is the sprawler, `b` the shooter under him.
 */
import type { PairSpec } from '../dsl';
import { arm, guardArms, kneel, kneelLeg, mat, matSelf, on, pt, stand } from '../build';
import { level, type NodePose, type Variant } from './types';

function doubleLegIn(v: Variant): PairSpec {
  // Penetration step: a's left knee down between b's feet, right leg driving
  // behind, head outside on b's hip, chest on b's thighs, hands behind knees.
  const b = stand({ at: [0, 0.3], yaw: 180, h: 0.9, pitch: -6, chest: { bend: 30 }, lFoot: [0.15, 0.02], rFoot: [-0.15, 0.02], head: { bend: 20 } });
  return {
    a: {
      hips: { at: [-0.05, level(0.5, v.sA, v.sB, 0.6), -0.3] },
      pelvis: { up: [0.05, 0.62, 0.78], fwd: [0, -0.78, 0.62] },
      chest: { up: [0.12, 0.3, 1], fwd: [0, -1, 0.3] },
      head: { look: [0.2, -0.3, 1], side: 20 },
      lLeg: kneelLeg(0.05, 1, [0.05, 0, -1]),
      rLeg: { to: matSelf(-0.22, -0.72), pole: [-0.2, 0, 1], foot: 'toes' },
      lArm: arm(on('knee_back_R'), 'grip', [0.9, -0.2, -0.2]),
      rArm: arm(on('knee_back_L'), 'grip', [-0.9, -0.2, -0.2]),
    },
    b: {
      ...b,
      lArm: arm(on('scap_R'), 'open', [0.5, -1, 0.2]),
      rArm: arm(on('back_mid', [0.06, 0, 0]), 'open', [-0.5, -1, 0.2], 1, on('back_upper')),
    },
  };
}

function singleLegIn(v: Variant): PairSpec {
  // b's right leg (+X side) trapped at a's left hip, a's head inside on b's chest.
  const a = stand({ at: [0.02, -0.26], yaw: 10, h: level(0.78, v.sA, v.sB, 0.6), pitch: 24, chest: { bend: 20, side: -6 }, lFoot: [0.16, 0.1], rFoot: [-0.2, -0.22], head: { look: [-0.3, 0.1, 1] } });
  const b = stand({ at: [0.0, 0.2], yaw: 180, h: 0.9, pitch: -4, chest: { bend: 10, side: -6 }, lFoot: [0.04, 0.05], rFoot: [-0.1, 0.3], head: { look: [0.2, -0.4, -1] } });
  return {
    a: {
      ...a,
      lArm: arm(on('knee_back_R'), 'grip', [0.8, -0.6, 0]),
      rArm: arm(on('thigh_back_R'), 'grip', [-0.6, -0.8, 0.2]),
    },
    b: {
      ...b,
      rLeg: { to: { p: [0.18, 0.42, -0.3] }, pole: [-0.2, 0, 1], foot: 'point' },
      rArm: arm(on('lat_L'), 'grip', [-0.8, 0.4, 0]),
      lArm: arm(on('head_side_R'), 'open', [0.5, -1, 0.2]),
    },
  };
}

function highCrotchIn(v: Variant): PairSpec {
  const b = stand({ at: [0, 0.22], yaw: 180, h: 0.9, pitch: -2, chest: { bend: 12, side: -8 }, lFoot: [0.16, 0.05], rFoot: [-0.14, 0.12], head: { look: [0.2, -0.4, -1] } });
  return {
    a: {
      hips: { at: [-0.06, level(0.52, v.sA, v.sB, 0.6), -0.3] },
      pelvis: { up: [0.1, 0.8, 0.6], fwd: [0, -0.6, 0.8] },
      chest: { up: [0.25, 0.55, 1], fwd: [0, -1, 0.5] },
      head: { look: [-0.3, 0, 1] },
      lLeg: kneelLeg(0.25, 1, [0, 0, -1]),
      rLeg: { to: matSelf(-0.25, -0.55), pole: [-0.2, 0, 1], foot: 'toes' },
      lArm: arm(on('thigh_back_R'), 'grip', [0.8, -0.3, 0]),
      rArm: arm(on('knee_back_R'), 'grip', [-0.5, -0.8, 0]),
    },
    b: {
      ...b,
      rArm: arm(on('lat_L'), 'grip', [-0.8, 0.5, 0]),
      lArm: arm(on('head_side_R'), 'open', [0.5, -1, 0.2]),
    },
  };
}

function lowSingleIn(_v: Variant): PairSpec {
  const a = kneel({ at: [0.14, -0.36], yaw: 10, h: 0.4, pitch: 40, chest: { bend: 30, side: 10 }, lKnee: [0.3, 1], rKnee: [-0.3, 0.6], head: { look: [0.6, -0.5, 1] } });
  const b = stand({ at: [0.05, 0.22], yaw: 180, h: 0.84, pitch: 30, chest: { bend: 30 }, lFoot: [0.1, 0.12], rFoot: [-0.18, -0.25], head: { bend: 20 } });
  return {
    a: { ...a, lArm: arm(on('ankle_R'), 'grip', [0.6, -1, 0.2], 1, on('calf_R')), rArm: arm(on('calf_R'), 'grip', [-0.6, -1, 0.2], 1, on('knee_back_R')) },
    b: { ...b, lArm: arm(on('neck_back'), 'open', [0.4, -1, 0.3]), rArm: arm(on('scap_L'), 'open', [-0.4, -1, 0.3]) },
  };
}

function sprawl(_v: Variant): PairSpec {
  // b (the shooter) stuffed on his knees, head down; a sprawled over him,
  // hips heavy and low, legs kicked back, chest on b's upper back.
  const b = kneel({ at: [0, 0.3], yaw: 180, h: 0.4, pitch: 68, chest: { bend: 18 }, lKnee: [0.28, 1], rKnee: [-0.28, 1], head: { bend: 25 } });
  return {
    a: {
      hips: { at: [0, 0.34, -0.66] },
      pelvis: { up: [0, 0.3, 1], fwd: [0, -1, 0.3] },
      chest: { up: [0, 0.05, 1], fwd: [0, -1, 0.05] },
      head: { look: [0.2, -0.6, 1] },
      lLeg: { to: matSelf(0.34, -0.72), pole: [0.3, 0, 1], foot: 'toes' },
      rLeg: { to: matSelf(-0.34, -0.72), pole: [-0.3, 0, 1], foot: 'toes' },
      lArm: arm(on('tricep_R'), 'grip', [0.8, -0.4, 0]),
      rArm: arm(on('back_upper', [-0.08, 0, 0]), 'grip', [-0.8, -0.4, 0]),
    },
    b: {
      ...b,
      lArm: arm(on('ribs_R'), 'grip', [0.6, -1, 0], 1, on('chest_R')),
      rArm: arm(on('ribs_L'), 'grip', [-0.6, -1, 0], 1, on('chest_L')),
    },
  };
}

function lifted(v: Variant): PairSpec {
  // a stands tall with b's hips at his chest; b airborne, folded over a's shoulder.
  const a = stand({ at: [0, -0.12], yaw: 0, h: level(0.9, v.sA, v.sB, 0), pitch: -8, chest: { bend: -6 }, lFoot: [0.2, 0.08], rFoot: [-0.2, -0.1], head: { look: [0.5, 0.2, 1] } });
  return {
    a: {
      ...a,
      lArm: arm(on('thigh_back_R'), 'grip', [0.9, -0.5, 0]),
      rArm: arm(on('thigh_back_L'), 'grip', [-0.9, -0.5, 0]),
    },
    b: {
      hips: { on: 'chest', off: [-0.05, 0.12, 0.22] },
      pelvis: { up: [0, 0.35, -1], fwd: [0, -1, -0.35] },
      chest: { bend: 40 },
      head: { look: [0, -1, -0.3] },
      lLeg: { to: { p: [-0.18, 0.45, 0.25] }, pole: [0.3, 0, 1], foot: 'point' },
      rLeg: { to: { p: [0.12, 0.5, 0.3] }, pole: [-0.3, 0, 1], foot: 'point' },
      lArm: arm(on('back_upper', [0.1, 0, 0]), 'open', [0.5, -1, 0]),
      rArm: arm(on('scap_L'), 'open', [-0.5, -1, 0]),
    },
  };
}

function throwInProgress(v: Variant): PairSpec {
  // Hip throw at kake: tori (a) turned in, hips under uke's centre, bent over;
  // uke (b) loaded across a's hip and back, feet leaving the mat.
  const a = stand({ at: [0.02, 0.02], yaw: 170, h: level(0.8, v.sA, v.sB, 0.7), pitch: 40, chest: { bend: 30, twist: -15 }, lFoot: [0.16, 0.05], rFoot: [-0.16, 0.08], head: { look: [0.6, -0.5, 0.5] } });
  return {
    a: {
      ...a,
      lArm: arm(on('wrist_R'), 'grip', [0.6, -1, 0]),
      rArm: arm(on('back_mid', [-0.05, 0, 0]), 'grip', [-0.8, 0.3, 0]),
    },
    b: {
      hips: { on: 'pelvis_back', off: [0.02, 0.25, -0.02] },
      pelvis: { up: [0.1, 0.25, -1], fwd: [0.2, -1, -0.2] },
      chest: { bend: 20, twist: 10 },
      head: { look: [0.3, -0.5, -1] },
      lLeg: { to: { p: [-0.25, 0.45, 0.45] }, pole: [0.3, 0, 1], foot: 'point' },
      rLeg: { to: { p: [0.1, 0.7, 0.5] }, pole: [-0.3, 0, 1], foot: 'point' },
      lArm: arm(pt(-0.35, 0.8, -0.35), 'open', [0.6, -1, 0]),
      rArm: arm(on('neck_back'), 'grip', [-0.5, -1, 0]),
    },
  };
}

function kickCaught(_v: Variant): PairSpec {
  const a = stand({ at: [0, -0.4], yaw: 0, h: 0.9, pitch: 4, chest: { bend: 8, twist: -12 }, lFoot: [0.16, 0.14], rFoot: [-0.16, -0.18], head: { at: 'face' } });
  const b = stand({ at: [0.1, 0.35], yaw: 180, h: 0.92, pitch: -12, chest: { bend: -2, twist: 10 }, lFoot: [0.05, 0.0], rFoot: [0, 0], head: { at: 'face' } });
  return {
    a: {
      ...a,
      lArm: arm(on('calf_R'), 'grip', [0.7, -1, 0]),
      rArm: arm(on('knee_front_R', [0, 0.02, 0]), 'open', [-0.5, -1, 0.1]),
    },
    b: {
      ...b,
      rLeg: { to: { p: [0.2, 0.9, -0.3] }, pole: [0, 1, 0.2], foot: 'point' },
      ...guardArms(),
    },
  };
}

export const ATTACK_POSES: Record<string, NodePose> = {
  'pos.td_double_leg_in': doubleLegIn,
  'pos.td_single_leg_in': singleLegIn,
  'pos.td_high_crotch_in': highCrotchIn,
  'pos.td_low_single_in': lowSingleIn,
  'pos.td_sprawl': sprawl,
  'pos.td_lifted': lifted,
  'pos.throw_in_progress': throwInProgress,
  'pos.td_kick_caught': kickCaught,
};

void mat;
