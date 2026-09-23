/**
 * Guard nodes (closed, open), leg entanglements, cage ground nodes and the
 * transient scramble / knockdown. Bottom `b` is the guard player, supine with
 * the head toward +Z unless noted; top `a` at -Z facing +Z.
 */
import type { BodySpec, PairSpec } from '../dsl';
import { arm, guardArms, kneel, kneelLeg, kneesUp, legsFlat, lie, mat, matSelf, on, pt, self, stand } from '../build';
import { level, type NodePose, type Variant } from './types';

const fistsUp = (): Pick<BodySpec, 'lArm' | 'rArm'> => ({
  lArm: arm(self('face', [0.06, 0.05, 0.1]), 'fist', [0.5, -0.3, -1]),
  rArm: arm(self('face', [-0.06, 0.05, 0.1]), 'fist', [-0.5, -0.3, -1]),
});

// ---------------------------------------------------------------------------
// Closed guard
// ---------------------------------------------------------------------------

function guardTop(o: { h?: number; pitch?: number; chest?: number; head?: BodySpec['head'] } = {}): Omit<BodySpec, 'lArm' | 'rArm'> {
  return kneel({
    at: [0, -0.26], yaw: 0, h: o.h ?? 0.46, pitch: o.pitch ?? 4, chest: { bend: o.chest ?? 4 },
    lKnee: [0.55, 1], rKnee: [-0.55, 1], lShin: [0.15, -1], rShin: [-0.15, -1], foot: 'toes',
    head: o.head ?? { at: 'face' },
  });
}

/**
 * Closed guard: legs wrapped round the waist, knees out at the top man's
 * hips, ankles crossed low behind him (just above the belt line).
 */
const crossedAnkles = (y = 0): Pick<BodySpec, 'lLeg' | 'rLeg'> => ({
  lLeg: { to: on('pelvis_back', [0.07, 0.07 + y, 0]), alt: on('back_lower', [0.07, 0, 0]), pole: [1, -0.25, 0.25], foot: 'point' },
  rLeg: { to: on('pelvis_back', [-0.07, 0.05 + y, 0]), alt: on('back_lower', [-0.07, 0, 0]), pole: [-1, -0.25, 0.25], foot: 'point' },
});

/** Guard player's pelvis on the top man's lap: hips raised, back on the mat. */
const onLap = { up: [0, -0.3, 1] as [number, number, number], fwd: [0, 1, 0.3] as [number, number, number] };

function closedUp(v: Variant): PairSpec {
  const b = lie({ at: [0, 0.1], headYaw: 0, crunch: 16, head: { at: 'face' } });
  return {
    a: {
      ...guardTop({ h: 0.42, pitch: 8, chest: v.postured ? 2 : 8 }),
      lArm: arm(on('belly', [0.08, 0, 0]), 'open', [0.5, -1, -0.2]),
      rArm: arm(on('hip_L'), 'grip', [-0.5, -1, -0.2]),
    },
    b: {
      ...b,
      pelvis: onLap,
      hips: { on: 'hips', off: [0, -0.22, 0.25] },
      ...crossedAnkles(),
      lArm: arm(on('wrist_R'), 'grip', [0.5, -0.5, -0.8]),
      rArm: arm(on('wrist_L'), 'grip', [-0.5, -0.5, -0.8]),
    },
  };
}

function closedBroken(_v: Variant): PairSpec {
  const b = lie({ at: [0, 0.1], headYaw: 0, h: 0.16, crunch: 18, head: { look: [0, 0.6, -1] } });
  return {
    a: {
      ...guardTop({ h: 0.34, pitch: 45, head: { look: [0, -1, 0.3] } }),
      // Posture broken: head pulled down onto b's chest.
      chest: { aim: 'chest', aimK: 1 },
      lArm: arm(mat(0.34, 0.3), 'post', [0.6, -0.6, -0.3]),
      rArm: arm(mat(-0.34, 0.3), 'post', [-0.6, -0.6, -0.3]),
    },
    b: {
      ...b,
      pelvis: onLap,
      hips: { on: 'hips', off: [0, -0.14, 0.24] },
      ...crossedAnkles(0),
      lArm: arm(on('neck_back'), 'grip', [0.4, 0.2, -1]),
      rArm: arm(on('tricep_L'), 'grip', [-0.8, 0.3, -0.3]),
    },
  };
}

function closedHigh(_v: Variant): PairSpec {
  const b = lie({ at: [0, 0.14], headYaw: 0, h: 0.2, crunch: 25, head: { at: 'face' } });
  return {
    a: {
      ...guardTop({ h: 0.4, pitch: 40, chest: 30, head: { look: [0, -1, 0.4] } }),
      lArm: arm(on('belly', [0.1, 0, 0]), 'open', [0.6, -0.6, -0.3]),
      rArm: arm(mat(-0.3, 0.3), 'post', [-0.6, -0.6, -0.3]),
    },
    b: {
      ...b,
      pelvis: onLap,
      hips: { on: 'hips', off: [0, -0.18, 0.24] },
      lLeg: { to: on('scap_R', [0.02, 0.04, 0]), pole: [0.8, 0.2, 0.6], foot: 'point' },
      rLeg: { to: on('scap_L', [-0.02, 0.04, 0]), pole: [-0.8, 0.2, 0.6], foot: 'point' },
      lArm: arm(on('neck_back'), 'grip', [0.4, 0.2, -1]),
      rArm: arm(on('wrist_L'), 'grip', [-0.6, -0.3, -0.6]),
    },
  };
}

function closedRubber(_v: Variant): PairSpec {
  const b = lie({ at: [0, 0.14], headYaw: 0, h: 0.2, crunch: 28, head: { at: 'face' } });
  return {
    a: {
      ...guardTop({ h: 0.38, pitch: 48, chest: 32, head: { look: [0, -1, 0.3] } }),
      lArm: arm(mat(0.32, 0.3), 'post', [0.6, -0.6, -0.3]),
      rArm: arm(on('belly', [-0.1, 0, 0]), 'open', [-0.6, -0.6, -0.3]),
    },
    b: {
      ...b,
      pelvis: onLap,
      hips: { on: 'hips', off: [0, -0.18, 0.24] },
      // Left shin across the back of a's neck, held by b's own left hand.
      lLeg: { to: on('scap_L', [0.06, 0.08, 0]), pole: [0.5, 0.2, 0.9], foot: 'point' },
      rLeg: { to: on('back_lower', [-0.06, 0, 0]), pole: [-0.9, 0, 0.45], foot: 'point' },
      lArm: arm(self('shin_L'), 'grip', [0.6, -0.3, -0.5]),
      rArm: arm(on('neck_back'), 'grip', [-0.4, 0.2, -1]),
    },
  };
}

function closedTopStanding(_v: Variant): PairSpec {
  // a stands in the guard; b's hips come off the mat, shoulders down.
  const a = stand({ at: [0, -0.32], yaw: 0, h: 0.86, pitch: 18, chest: { bend: 10 }, lFoot: [0.24, 0.12], rFoot: [-0.24, 0.1], head: { at: 'face' } });
  return {
    a: {
      ...a,
      lArm: arm(on('hip_R'), 'grip', [0.6, -1, 0]),
      rArm: arm(on('hip_L'), 'grip', [-0.6, -1, 0]),
    },
    b: {
      hips: { on: 'hips', off: [0, -0.28, 0.22] },
      pelvis: { up: [0, -0.62, 0.78], fwd: [0, 0.78, 0.62] },
      chest: { up: [0, -0.1, 1], fwd: [0, 1, 0.1] },
      head: { at: 'face' },
      ...crossedAnkles(),
      lArm: arm(on('wrist_R'), 'grip', [0.5, -0.5, -0.8]),
      rArm: arm(on('wrist_L'), 'grip', [-0.5, -0.5, -0.8]),
    },
  };
}

// ---------------------------------------------------------------------------
// Open guard
// ---------------------------------------------------------------------------

function legsUp(v: Variant): PairSpec {
  // a stands over b's feet, bent at the waist to reach; b on his back, hips
  // up, feet on a's hips and thigh.
  const a = stand({ at: [0, -0.32], yaw: 0, h: level(0.84, v.sA, v.sB, 0.6), pitch: 34, chest: { bend: 20 }, lFoot: [0.22, 0.02], rFoot: [-0.22, -0.18], head: { at: 'face' } });
  const b = lie({ at: [0, 0.34], headYaw: 0, crunch: 22, head: { at: 'face' } });
  return {
    a: { ...a, lArm: arm(on('knee_front_R'), 'grip', [0.6, -1, 0]), rArm: arm(on('shin_L'), 'grip', [-0.6, -1, 0]) },
    b: {
      ...b,
      pelvis: { up: [0, -0.35, 1], fwd: [0, 1, 0.35] },
      lLeg: { to: on('thigh_R', [0, 0.06, 0]), pole: [0.3, 0.2, 1], foot: 'neutral' },
      rLeg: { to: on('thigh_L', [0, 0.02, 0]), pole: [-0.3, 0.2, 1], foot: 'neutral' },
      ...fistsUp(),
    },
  };
}

function butterfly(v: Variant): PairSpec {
  const a = kneel({ at: [0, -0.34], yaw: 0, h: v.postured ? 0.5 : 0.46, pitch: 14, chest: { bend: 14 }, lKnee: [0.6, 0.9], rKnee: [-0.6, 0.9], head: { look: [-0.3, -0.2, 1] } });
  return {
    a: { ...a, lArm: arm(on('bicep_R'), 'grip', [0.6, -1, 0]), rArm: arm(on('scap_L'), 'grip', [-0.8, -0.4, 0]) },
    b: {
      hips: { at: [0, 0.13, 0.22] },
      pelvis: { up: [0, 0.9, 0.42], fwd: [0, 0.42, -0.9] },
      chest: { bend: 26 },
      head: { look: [0.3, -0.1, -1] },
      lLeg: { to: on('thigh_in_R', [0, -0.04, 0]), pole: [0.8, 0.2, 0.6], foot: 'hook' },
      rLeg: { to: on('thigh_in_L', [0, -0.04, 0]), pole: [-0.8, 0.2, 0.6], foot: 'hook' },
      rArm: arm(on('lat_L', [0, -0.03, 0]), 'grip', [-0.9, -0.4, 0], 1, on('ribs_L')),
      lArm: arm(on('tricep_R'), 'grip', [0.8, 0.3, 0], 1, on('bicep_R')),
    },
  };
}

function seated(_v: Variant): PairSpec {
  const a = stand({ at: [0, -0.3], yaw: 0, h: 0.88, pitch: 16, chest: { bend: 16 }, lFoot: [0.2, 0.05], rFoot: [-0.2, -0.2], head: { at: 'face' } });
  return {
    a: { ...a, ...guardArms() },
    b: {
      hips: { at: [0.05, 0.13, 0.3] },
      pelvis: { up: [0.1, 0.85, 0.5], fwd: [0, 0.5, -0.85] },
      chest: { bend: 10, twist: 10 },
      head: { at: 'face' },
      lLeg: { to: on('shin_R', [0.03, 0, 0]), pole: [0.6, 0.3, 0.7], foot: 'hook' },
      rLeg: { to: matSelf(0.15, -0.35), pole: [-0.5, 0.3, 0.7], foot: 'flat' },
      lArm: arm(on('shin_L'), 'grip', [0.5, -1, 0], 1, on('knee_front_L')),
      rArm: arm(matSelf(-0.3, 0.3), 'post', [-0.5, -1, 0]),
    },
  };
}

function kneelingTop(v: Variant): PairSpec {
  const a = kneel({ at: [0, -0.42], yaw: 0, h: v.postured ? 0.52 : 0.5, pitch: 10, chest: { bend: 10 }, lKnee: [0.55, 0.9], rKnee: [-0.55, 0.9], head: { at: 'face' } });
  const b = lie({ at: [0, 0.2], headYaw: 0, crunch: 26, head: { at: 'face' } });
  return {
    a: { ...a, lArm: arm(on('hip_R'), 'grip', [0.6, -1, 0], 1, on('knee_front_R')), rArm: arm(on('hip_L'), 'grip', [-0.6, -1, 0], 1, on('knee_front_L')) },
    b: {
      ...b,
      lLeg: { to: on('hip_R', [0, 0, 0]), pole: [0.4, 0.2, 1], foot: 'neutral' },
      rLeg: { to: on('hip_L', [0, 0, 0]), pole: [-0.4, 0.2, 1], foot: 'neutral' },
      lArm: arm(on('wrist_R'), 'grip', [0.5, -0.5, -0.8], 1, self('shin_L', [0, 0.03, 0])),
      rArm: arm(on('wrist_L'), 'grip', [-0.5, -0.5, -0.8], 1, self('shin_R', [0, 0.03, 0])),
    },
  };
}

// ---------------------------------------------------------------------------
// Cage ground and transient
// ---------------------------------------------------------------------------

function cageSeated(_v: Variant): PairSpec {
  // b sitting with his back on the fence (+Z); a on his knees in front,
  // body lock, head on b's chest. (The solver slides the pair onto the fence.)
  const b: Omit<BodySpec, 'lArm' | 'rArm'> = {
    hips: { at: [0, 0.13, 0.22] },
    pelvis: { up: [0, 0.94, 0.33], fwd: [0, 0.33, -0.94] },
    chest: { bend: 4 },
    head: { look: [0, -0.3, -1] },
    lLeg: { to: matSelf(-0.25, -0.5), pole: [0.5, 0.2, 1], foot: 'flat' },
    rLeg: { to: matSelf(0.25, -0.5), pole: [-0.5, 0.2, 1], foot: 'flat' },
  };
  const a = kneel({ at: [0, -0.4], yaw: 0, h: 0.45, pitch: 35, chest: { bend: 20 }, lKnee: [0.4, 0.9], rKnee: [-0.4, 0.9], head: { look: [0.3, 0.2, 1] } });
  return {
    a: { ...a, lArm: arm(on('waist_R', [0, 0, -0.04]), 'grip', [0.9, -0.3, 0]), rArm: arm(on('waist_L', [0, 0, -0.04]), 'grip', [-0.9, -0.3, 0]) },
    b: { ...b, lArm: arm(on('shoulder_R'), 'open', [0.6, -1, 0]), rArm: arm(on('neck_side_L'), 'open', [-0.6, -1, 0]) },
  };
}

function wallWalk(_v: Variant): PairSpec {
  // b's back sliding up the fence, hips off the mat, right hand on the fence;
  // a kneeling on one knee, arms locked around b's hips.
  const b = stand({ at: [0, 0.2], yaw: 180, h: 0.62, pitch: -18, chest: { bend: -4 }, lFoot: [0.22, 0.3], rFoot: [-0.2, 0.15], head: { look: [0, -0.3, -1] } });
  const a = kneel({ at: [0, -0.26], yaw: 0, h: 0.5, pitch: 32, chest: { bend: 20 }, lKnee: [0.4, 0.8], rKnee: [-0.3, 0.3], head: { look: [0.3, 0.1, 1] } });
  return {
    a: { ...a, lLeg: { to: matSelf(0.3, 0.25), pole: [0.4, 0, 1], foot: 'flat' }, lArm: arm(on('pelvis_back', [-0.08, 0, 0]), 'grip', [0.9, -0.3, 0]), rArm: arm(on('pelvis_back', [0.08, 0, 0]), 'grip', [-0.9, -0.3, 0]) },
    b: { ...b, lArm: arm(pt(-0.35, 1.05, 0.42), 'open', [0.8, -0.4, -0.4]), rArm: arm(on('wrist_L'), 'grip', [-0.6, -1, 0]) },
  };
}

function scramble(_v: Variant): PairSpec {
  // b coming up to a knee and turning away; a chasing on his knees with an
  // arm around b's waist, the other hand on b's near wrist.
  const b = kneel({ at: [0.18, 0.24], yaw: 70, h: 0.46, pitch: 30, chest: { bend: 18, twist: 10 }, lKnee: [0.3, 0.9], rKnee: [-0.3, 0.5], head: { look: [1, -0.2, 0.3] } });
  const a = kneel({ at: [-0.12, -0.3], yaw: 20, h: 0.48, pitch: 40, chest: { bend: 22 }, lKnee: [0.4, 0.8], rKnee: [-0.4, 0.8], head: { look: [0.6, -0.4, 1] } });
  return {
    a: { ...a, lArm: arm(on('belly'), 'grip', [0.7, -0.4, 0], 1, on('waist_L')), rArm: arm(on('waist_L'), 'grip', [-0.7, -0.4, 0]) },
    b: { ...b, rLeg: { to: matSelf(-0.05, 0.45), pole: [-0.2, 0, 1], foot: 'flat' }, lArm: arm(matSelf(0.35, 0.3), 'post', [0.5, -0.8, 0]), rArm: arm(on('wrist_R'), 'grip', [-0.6, -0.6, 0], 1, on('forearm_R')) },
  };
}

function knockdown(_v: Variant): PairSpec {
  const a = stand({ at: [0, -0.62], yaw: 0, h: 0.84, pitch: 30, chest: { bend: 20 }, lFoot: [0.2, 0.25], rFoot: [-0.22, -0.15], head: { look: [0, -0.8, 0.7] } });
  const b = lie({ at: [0, 0.1], headYaw: 0, crunch: 8, head: { look: [0.3, 1, 0.4] } });
  return {
    a: { ...a, lArm: arm(self('face', [0.1, 0, 0.2]), 'fist', [0.6, -1, 0]), rArm: arm(self('shoulder_R', [-0.05, 0.1, 0.1]), 'fist', [-0.5, -1, -0.4]) },
    b: {
      ...b,
      ...legsFlat(0, 0.2),
      lArm: arm(pt(-0.42, 0.06, 0.4), 'relaxed', [0.2, -0.5, -1]),
      rArm: arm(pt(0.4, 0.06, 0.3), 'relaxed', [-0.2, -0.5, -1]),
    },
  };
}

export const GUARD_POSES: Record<string, NodePose> = {
  'pos.ground_closed_posture_up': closedUp,
  'pos.ground_closed_posture_broken': closedBroken,
  'pos.ground_closed_high': closedHigh,
  'pos.ground_closed_rubber': closedRubber,
  'pos.ground_closed_top_standing': closedTopStanding,
  'pos.ground_open_legs_up': legsUp,
  'pos.ground_open_butterfly': butterfly,
  'pos.ground_open_seated': seated,
  'pos.ground_open_kneeling_top': kneelingTop,
  'pos.ground_cage_seated': cageSeated,
  'pos.ground_wall_walk': wallWalk,
  'pos.scramble': scramble,
  'pos.ground_knockdown': knockdown,
};

void kneelLeg; void kneesUp;
