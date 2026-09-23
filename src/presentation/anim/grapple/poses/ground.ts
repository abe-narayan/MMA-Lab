/**
 * Ground nodes, top-control families (docs/design/08 §5.7): mount, back,
 * side control, half guard, turtle. Conventions:
 *
 *   - mount / half guard: bottom `b` supine, head toward +Z; top `a` on him
 *     facing +Z. `b`'s left is -X (the same side as `a`'s right).
 *   - side control family: `b` supine along X (head toward +X, so his left
 *     side is the far side, +Z); `a` at `b`'s right side (-Z) facing +Z.
 *   - back family: both face +Z, `a` behind at -Z.
 *   - turtle family: `b` on knees and elbows, spine toward +X; `a` at his
 *     left side (-Z), facing +Z.
 */
import type { BodySpec, PairSpec } from '../dsl';
import { arm, kneel, kneelLeg, kneesUp, lie, mat, matSelf, on, pt, self } from '../build';
import type { NodePose, Variant } from './types';

const P = pt;
const guardFists = (): Pick<BodySpec, 'lArm' | 'rArm'> => ({
  lArm: arm(self('face', [0.05, 0, 0.05]), 'fist', [0.5, -0.4, -1]),
  rArm: arm(self('face', [-0.05, 0, 0.05]), 'fist', [-0.5, -0.4, -1]),
});

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

function mountLow(v: Variant): PairSpec {
  const up = v.postured;
  const a = kneel({ at: [0, 0], yaw: 0, h: 0.34, chest: { bend: up ? 4 : 34 }, lKnee: [0.8, 0.6], rKnee: [-0.8, 0.6], lShin: [-0.3, -1], rShin: [0.3, -1], foot: 'point', head: { at: 'face' } });
  const b = lie({ at: [0, 0.02], headYaw: 0, crunch: 6, head: { at: 'face' } });
  // §10 tier tell: a novice under mount pushes straight-armed on the chest.
  const push = v.tierB <= 1;
  return {
    a: {
      ...a,
      hips: { on: 'hips', off: [0, 0.2, 0.06] },
      lArm: up ? arm(on('chest_R'), 'open', [0.5, -1, -0.3]) : arm(mat(0.34, 0.55), 'post', [0.7, -0.5, -0.4]),
      rArm: up ? arm(on('chest_L'), 'open', [-0.5, -1, -0.3]) : arm(mat(-0.34, 0.55), 'post', [-0.7, -0.5, -0.4]),
    },
    b: {
      ...b,
      ...kneesUp(0, 0.2, 0.4),
      lArm: push ? arm(on('chest_R'), 'open', [0.2, -0.4, -1]) : arm(on('hip_R'), 'grip', [0.6, -0.4, -1]),
      rArm: push ? arm(on('chest_L'), 'open', [-0.2, -0.4, -1]) : arm(on('hip_L'), 'grip', [-0.6, -0.4, -1]),
    },
  };
}

function mountHigh(v: Variant): PairSpec {
  const up = v.postured;
  const a = kneel({ at: [0, 0], yaw: 0, h: 0.42, chest: { bend: up ? 2 : 22 }, lKnee: [0.5, 1], rKnee: [-0.5, 1], lShin: [-0.2, -1], rShin: [0.2, -1], foot: 'point', head: { at: 'face' } });
  const b = lie({ at: [0, -0.05], headYaw: 0, head: { at: 'face' } });
  return {
    a: {
      ...a,
      hips: { on: 'hips', off: [0, 0.28, 0.3] },
      lArm: up ? arm(on('chest_R'), 'open', [0.5, -1, -0.3]) : arm(mat(0.28, 0.78), 'post', [0.6, -0.6, -0.3]),
      rArm: up ? arm(on('chest_L'), 'open', [-0.5, -1, -0.3]) : arm(mat(-0.28, 0.78), 'post', [-0.6, -0.6, -0.3]),
    },
    b: {
      ...b,
      ...kneesUp(0, 0.22, 0.36),
      // Arms pinned high, pushing on the top man's thighs.
      lArm: arm(on('thigh_R', [0, 0.02, 0]), 'open', [0.8, 0.3, -1]),
      rArm: arm(on('thigh_L', [0, 0.02, 0]), 'open', [-0.8, 0.3, -1]),
    },
  };
}

function mountS(_v: Variant): PairSpec {
  // S-mount: right knee up by the head, left leg folded under b's side,
  // isolating b's right arm (+X side).
  const a = kneel({ at: [0, 0], yaw: -30, h: 0.36, chest: { bend: 12, twist: 12 }, lKnee: [0.9, 0.2], rKnee: [-0.2, 1], lShin: [-0.1, -1], rShin: [0.9, -0.2], foot: 'point', head: { at: 'face' } });
  const b = lie({ at: [0, 0.0], headYaw: 0, roll: 30, head: { at: 'face' } });
  return {
    a: {
      ...a,
      hips: { on: 'chest', off: [0.06, 0.16, -0.08] },
      lArm: arm(on('wrist_R'), 'grip', [0.6, -1, -0.2]),
      rArm: arm(mat(-0.3, 0.66), 'post', [-0.6, -0.7, -0.2]),
    },
    b: {
      ...b,
      ...kneesUp(0, 0.24, 0.45),
      lArm: arm(on('thigh_R'), 'open', [0.3, -0.6, -1]),
      rArm: arm(P(0.14, 0.55, 0.42), 'open', [-0.4, 0.2, -1]),
    },
  };
}

function mountTech(_v: Variant): PairSpec {
  // Technical mount: b on his left side (belly toward -X); a's right knee
  // behind b's head, left foot posted, chest on b's shoulder.
  const a = kneel({ at: [0, 0], yaw: -30, h: 0.36, chest: { bend: 38 }, lKnee: [0.9, -0.1], rKnee: [0.15, 1], lShin: [0, -1], rShin: [0.2, -1], foot: 'point', head: { at: 'head_side_R' } });
  const b = lie({ at: [0, 0.0], headYaw: 0, roll: 75, h: 0.16, head: { look: [-1, -0.1, 0.2] } });
  return {
    a: {
      ...a,
      hips: { on: 'hips', off: [0.24, 0.24, 0.06] },
      lLeg: { to: matSelf(0.5, 0.2), pole: [0.6, 0, 1], foot: 'flat' },
      lArm: arm(on('elbow_R'), 'grip', [0.5, -1, -0.3], 1, on('shoulder_R')),
      rArm: arm(on('shoulder_R'), 'grip', [-0.5, -1, -0.2], 1, on('chest_R')),
    },
    b: {
      ...b,
      lLeg: { to: matSelf(-0.12, -0.5), pole: [0.3, 0, 1], foot: 'neutral' },
      rLeg: { to: matSelf(-0.02, -0.55), pole: [-0.1, 0, 1], foot: 'neutral' },
      lArm: arm(self('face', [0, 0, 0]), 'fist', [0.3, -1, 0.2]),
      rArm: arm(self('face', [0, 0, 0]), 'fist', [-0.3, -1, 0.2]),
    },
  };
}

// ---------------------------------------------------------------------------
// Back
// ---------------------------------------------------------------------------

/** Seated back take: a reclined against the mat, b reclined on a's chest. */
function backBase(v: Variant, hooks: 'two' | 'one' | 'triangle'): PairSpec {
  void v;
  const aRecline = 44 * Math.PI / 180;
  const bRecline = 50 * Math.PI / 180;
  const aUp: [number, number, number] = [0, Math.cos(aRecline), -Math.sin(aRecline)];
  const aFwd: [number, number, number] = [0, Math.sin(aRecline), Math.cos(aRecline)];
  const bUp: [number, number, number] = [0, Math.cos(bRecline), -Math.sin(bRecline)];
  const bFwd: [number, number, number] = [0, Math.sin(bRecline), Math.cos(bRecline)];
  const a: PairSpec['a'] = {
    hips: { at: [0, 0.13, -0.3] },
    pelvis: { up: aUp, fwd: aFwd },
    chest: { bend: 18 },
    head: { look: [0.25, -0.2, 1] },
    // Hooks: heels inside b's thighs.
    lLeg: hooks === 'triangle'
      ? { to: on('waist_R', [0.02, 0, 0.04]), pole: [0.7, 0.2, 0.7], foot: 'point' }
      : { to: on('thigh_in_L', [0, 0, 0.04]), pole: [0.8, 0.1, 0.6], foot: 'hook' },
    rLeg: hooks === 'two'
      ? { to: on('thigh_in_R', [0, 0, 0.04]), pole: [-0.8, 0.1, 0.6], foot: 'hook' }
      : hooks === 'triangle'
        ? { to: on('waist_R', [0.06, -0.04, 0.02]), pole: [-0.6, 0.2, 0.8], foot: 'point' }
        : { to: matSelf(-0.3, 0.55), pole: [-0.4, 0, 1], foot: 'neutral' },
    // Seatbelt: right arm under b's right armpit, left over the left shoulder.
    lArm: arm(on('chest', [-0.05, 0.02, 0.02]), 'grip', [0.9, 0.6, -0.1]),
    rArm: arm(on('chest', [0.06, -0.04, 0.02]), 'grip', [-0.9, -0.6, 0]),
  };
  const b: PairSpec['b'] = {
    hips: { on: 'hips', off: [0, 0.02, 0.3] },
    pelvis: { up: bUp, fwd: bFwd },
    chest: { bend: 22 },
    head: { bend: 25 },
    lLeg: { to: matSelf(0.24, 0.5), pole: [0.4, 0, 1], foot: 'flat' },
    rLeg: { to: matSelf(-0.24, 0.5), pole: [-0.4, 0, 1], foot: 'flat' },
    // Hand fighting the top (left) arm of the seatbelt.
    lArm: arm(on('wrist_L'), 'grip', [0.5, -1, 0.2]),
    rArm: arm(on('forearm_L'), 'grip', [-0.5, -1, 0.2]),
  };
  if (hooks === 'one') {
    // b turning toward the stripped side.
    b.pelvis = { up: bUp, fwd: [0.35, bFwd[1], bFwd[2]] };
    b.chest = { bend: 18, twist: 15 };
    b.rLeg = { to: matSelf(-0.35, 0.35), pole: [-0.5, 0, 1], foot: 'flat' };
  }
  return { a, b };
}

function backSeatbelt(_v: Variant): PairSpec {
  // b in a sit-out turtle facing +Z; a behind on his knees, chest glued to
  // b's back, seatbelt locked.
  const b = kneel({ at: [0, 0.18], yaw: 0, h: 0.4, pitch: 55, chest: { bend: 15 }, lKnee: [0.3, 1], rKnee: [-0.3, 1], head: { bend: 20 } });
  const a = kneel({ at: [0, -0.28], yaw: 0, h: 0.48, pitch: 40, chest: { bend: 25 }, lKnee: [0.5, 1], rKnee: [-0.5, 1], head: { look: [0.3, -0.5, 1] } });
  return {
    a: {
      ...a,
      lArm: arm(on('chest', [-0.06, 0, 0]), 'grip', [0.9, 0.5, 0], 1, on('chest_L')),
      rArm: arm(on('chest', [0.06, -0.05, 0]), 'grip', [-0.9, -0.6, 0], 1, on('ribs_R')),
    },
    b: {
      ...b,
      lArm: arm(mat(0.2, 0.62), 'post', [0.4, -0.6, -0.5]),
      rArm: arm(on('wrist_L'), 'grip', [-0.6, -1, 0.3]),
    },
  };
}

function crucifix(_v: Variant): PairSpec {
  // b supine along X (head +X); a lies across b's chest face down,
  // perpendicular, his legs scissoring b's near (right) arm, his left hand
  // pinning b's far wrist to the mat, right hand free.
  const b = lie({ at: [-0.36, 0.05], headYaw: 90, head: { look: [0, 1, 0.5] } });
  return {
    a: {
      hips: { at: [0.12, 0.28, -0.42] },
      pelvis: { up: [0.1, 0.1, 1], fwd: [0, -1, 0.1] },
      chest: { bend: 10 },
      head: { look: [0.3, -0.5, 1] },
      // Legs scissor b's near arm; knees bend up (a is face down).
      lLeg: { to: on('elbow_R', [0.08, 0.12, -0.05]), pole: [0.3, 0.2, -1], foot: 'neutral' },
      rLeg: { to: on('wrist_R', [-0.04, 0.13, -0.05]), pole: [-0.3, 0.2, -1], foot: 'neutral' },
      lArm: arm(on('wrist_L'), 'grip', [0.6, -0.4, -0.4]),
      rArm: arm(on('face', [0, 0.1, 0]), 'fist', [-0.6, -0.6, 0.2]),
    },
    b: {
      ...b,
      ...kneesUp(90, 0.2, 0.42),
      rArm: arm(P(0.12, 0.08, -0.55), 'open', [-0.3, -0.5, -1]),
      lArm: arm(P(0.25, 0.06, 0.55), 'open', [0.3, -0.5, -1]),
    },
  };
}

// ---------------------------------------------------------------------------
// Side control family (b supine along X, head +X; a at -Z)
// ---------------------------------------------------------------------------

function side(v: Variant): PairSpec {
  const up = v.postured;
  const b = lie({ at: [-0.3, 0.12], headYaw: 90, head: { look: [0.3, 1, -0.4] } });
  return {
    a: {
      ...kneel({ at: [0.02, -0.4], yaw: 0, h: up ? 0.46 : 0.3, pitch: up ? 15 : 50, chest: up ? { bend: 25 } : { up: [0.1, -0.12, 1], fwd: [0, -1, -0.12] }, lKnee: [0.5, 0.8], rKnee: [-0.55, 0.75], lShin: [0.1, -1], rShin: [-0.1, -1], foot: 'toes', head: { look: [0.5, -0.4, 1] } }),
      // Crossface under the head to the far shoulder; near arm blocks the hip.
      lArm: arm(on('shoulder_L', [0, -0.04, 0]), 'grip', [0.2, -0.6, -1]),
      rArm: arm(on('hip_R'), 'grip', [-0.6, -1, -0.2]),
    },
    b: {
      ...b,
      ...kneesUp(90, 0.18, 0.4),
      lArm: arm(on('neck_side_L'), 'open', [0.7, -0.3, -0.6]),
      rArm: arm(on('hip_R'), 'open', [-0.3, -0.8, -0.8]),
    },
  };
}

function kesa(_v: Variant): PairSpec {
  // Scarf hold: a sits at b's right ribs facing b's head (+X), right arm
  // around b's head, b's right arm trapped under a's left armpit.
  const b = lie({ at: [-0.3, 0.12], headYaw: 90, roll: -12, head: { look: [0, 1, -0.6] } });
  return {
    a: {
      hips: { at: [-0.05, 0.17, -0.22] },
      pelvis: { up: [0.1, 0.9, 0.42], fwd: [1, 0, -0.1] },
      chest: { bend: 20, side: -18 },
      head: { look: [0.6, -0.3, 0.6] },
      lLeg: { to: matSelf(-0.55, -0.3), pole: [0.3, 1, 0], foot: 'neutral' },
      rLeg: { to: matSelf(0.45, -0.12), pole: [-0.2, 1, 0.3], foot: 'neutral' },
      rArm: arm(on('neck_back', [0, -0.03, 0]), 'grip', [-0.6, -0.4, 0.2]),
      lArm: arm(on('elbow_R'), 'grip', [0.8, -0.4, 0]),
    },
    b: {
      ...b,
      ...kneesUp(90, 0.2, 0.4),
      rArm: arm(on('ribs_L', [0, 0, 0]), 'open', [-0.3, 0.2, -1]),
      lArm: arm(on('head_side_R'), 'open', [0.6, -0.2, -0.6]),
    },
  };
}

function reverseKesa(_v: Variant): PairSpec {
  // a faces b's legs (-X), hips by b's head, chest on b's chest.
  const b = lie({ at: [-0.32, 0.14], headYaw: 90, head: { look: [0, 1, -0.4] } });
  return {
    a: {
      hips: { at: [0.3, 0.15, -0.22] },
      pelvis: { up: [-0.35, 0.8, 0.45], fwd: [-1, 0, 0.2] },
      chest: { bend: 28, side: 16 },
      head: { look: [-1, -0.3, 0.2] },
      lLeg: { to: matSelf(0.1, -0.55), pole: [0.3, 1, 0], foot: 'neutral' },
      rLeg: { to: matSelf(0.45, 0.25), pole: [-0.2, 1, 0.3], foot: 'neutral' },
      lArm: arm(on('hip_L'), 'grip', [0.6, -0.5, 0]),
      rArm: arm(mat(-0.05, 0.05), 'post', [-0.6, -0.6, 0]),
    },
    b: {
      ...b,
      ...kneesUp(90, 0.2, 0.4),
      lArm: arm(on('ribs_R'), 'open', [0.6, -0.2, -0.6]),
      rArm: arm(on('ribs_L'), 'open', [-0.3, -0.5, -1]),
    },
  };
}

function kneeOnBelly(_v: Variant): PairSpec {
  const b = lie({ at: [-0.3, 0.14], headYaw: 90, head: { look: [-0.3, 1, -0.5] } });
  return {
    a: {
      hips: { at: [0.02, 0.5, -0.3] },
      pelvis: { up: [0, 0.9, 0.42], fwd: [0, -0.42, 0.9] },
      chest: { bend: 20 },
      head: { at: 'face' },
      rLeg: { knee: on('belly', [0.03, 0, 0]), to: { p: [-0.42, 0.12, -0.05] }, foot: 'neutral' },
      lLeg: { to: matSelf(0.34, -0.2), pole: [0.4, 0, 1], foot: 'flat' },
      lArm: arm(on('chest_L'), 'grip', [0.5, -1, 0], 1, on('chest')),
      rArm: arm(on('ribs_R'), 'grip', [-0.5, -1, 0], 1, on('chest_R')),
    },
    b: {
      ...b,
      ...kneesUp(90, 0.2, 0.42),
      lArm: arm(on('knee_front_R'), 'open', [0.4, -0.5, -1]),
      rArm: arm(on('shin_R'), 'open', [-0.4, -0.5, -1]),
    },
  };
}

function northSouth(_v: Variant): PairSpec {
  // b supine with the head toward a (-Z); a beyond b's head, chest on chest.
  const b = lie({ at: [0, 0.42], headYaw: 180, head: { look: [0, 1, 0] } });
  return {
    a: {
      ...kneel({ at: [0, -0.5], yaw: 0, h: 0.32, pitch: 55, chest: { up: [0, -0.1, 1], fwd: [0, -1, -0.1] }, lKnee: [0.55, 0.8], rKnee: [-0.55, 0.8], lShin: [0.1, -1], rShin: [-0.1, -1], foot: 'toes', head: { look: [0.5, -0.5, 1] } }),
      lArm: arm(on('lat_L'), 'grip', [0.8, -0.3, 0]),
      rArm: arm(on('lat_R'), 'grip', [-0.8, -0.3, 0]),
    },
    b: {
      ...b,
      ...kneesUp(180, 0.2, 0.42),
      lArm: arm(on('hip_L'), 'open', [0.6, -0.3, -1]),
      rArm: arm(on('hip_R'), 'open', [-0.6, -0.3, -1]),
    },
  };
}

// ---------------------------------------------------------------------------
// Half guard (b supine head +Z; a's right leg trapped between b's legs)
// ---------------------------------------------------------------------------

function halfTop(up: boolean, h = 0.3): Omit<BodySpec, 'lArm' | 'rArm'> {
  return {
    // Right knee trapped between b's thighs, down toward his knees; left knee
    // posted on the mat outside his right hip.
    ...kneel({ at: [0.12, -0.12], yaw: 0, h: up ? 0.46 : h, pitch: up ? 10 : 45, chest: up ? { bend: 12 } : { bend: 30 }, lKnee: [0.8, 0.5], rKnee: [-0.2, -0.6], lShin: [-0.2, -1], rShin: [0.1, -1], foot: 'toes', head: { at: 'face' } }),
  };
}

function halfFlat(v: Variant): PairSpec {
  const b = lie({ at: [0, 0.05], headYaw: 0, head: { look: [0.3, 1, 0.3] } });
  return {
    a: {
      ...halfTop(v.postured),
      rArm: arm(on('head_side_L', [0, -0.02, 0]), 'grip', [-0.3, -0.6, -1]),
      lArm: arm(on('scap_R'), 'grip', [0.7, -0.8, 0]),
    },
    b: {
      ...b,
      lLeg: { to: on('calf_R', [0, 0.02, 0]), pole: [0.6, 0, 1], foot: 'hook' },
      rLeg: { to: on('shin_R', [-0.04, 0, 0]), alt: on('calf_R', [0, -0.04, 0]), pole: [-0.2, 0, 1], foot: 'hook' },
      lArm: arm(on('neck_side_R'), 'open', [0.6, -0.4, -1]),
      rArm: arm(on('hip_L'), 'open', [-0.6, -0.4, -1]),
    },
  };
}

function halfKneeShield(v: Variant): PairSpec {
  const b = lie({ at: [0, 0.08], headYaw: 0, roll: -40, crunch: 12, head: { at: 'face' } });
  return {
    a: {
      ...kneel({ at: [0.04, -0.34], yaw: 0, h: v.postured ? 0.48 : 0.42, pitch: 22, chest: { bend: 18 }, lKnee: [0.6, 0.7], rKnee: [-0.2, 1], foot: 'toes', head: { at: 'face' } }),
      lArm: arm(on('hip_R'), 'grip', [0.6, -1, 0], 1, on('knee_front_L')),
      rArm: arm(on('chest_L'), 'grip', [-0.6, -1, 0], 1, on('chest')),
    },
    b: {
      ...b,
      lLeg: { to: on('hip_L', [0.02, 0.05, 0]), pole: [0.1, 0.4, 1], foot: 'neutral' },
      rLeg: { to: on('calf_R'), pole: [-0.4, 0, 1], foot: 'hook' },
      lArm: arm(on('bicep_R'), 'grip', [0.5, -0.5, -1], 1, on('chest_R')),
      rArm: arm(self('face', [-0.05, 0.02, 0]), 'fist', [-0.5, -0.5, 0.5]),
    },
  };
}

function halfUnderhook(v: Variant): PairSpec {
  const b = lie({ at: [0, 0.02], headYaw: 0, roll: 35, crunch: 18, head: { look: [-0.3, 0.6, 1] } });
  return {
    a: {
      ...halfTop(v.postured, 0.34),
      rArm: arm(on('shoulder_L'), 'grip', [-0.5, -0.8, -0.3]),
      lArm: arm(on('scap_R'), 'grip', [0.9, 0.3, 0]),
    },
    b: {
      ...b,
      lLeg: { to: on('calf_R'), pole: [0.6, 0, 1], foot: 'hook' },
      rLeg: { to: on('shin_R', [-0.04, 0, 0]), pole: [-0.2, 0, 1], foot: 'hook' },
      rArm: arm(on('scap_L'), 'grip', [-0.8, -0.2, -0.5]),
      lArm: arm(on('neck_side_R'), 'open', [0.6, -0.4, -1]),
    },
  };
}

function halfDogfight(_v: Variant): PairSpec {
  // Both up on the knees; b (bottom) has come up on the underhook side and
  // drives into a, who whizzers.
  const a = kneel({ at: [0.1, -0.18], yaw: -25, h: 0.42, pitch: 35, chest: { bend: 18, twist: -10 }, lKnee: [0.5, 0.8], rKnee: [-0.4, 0.8], head: { look: [-0.5, -0.4, 1] } });
  const b = kneel({ at: [-0.14, 0.14], yaw: 150, h: 0.4, pitch: 38, chest: { bend: 20 }, lKnee: [0.5, 0.8], rKnee: [-0.4, 0.9], head: { look: [0.5, -0.3, -1] } });
  return {
    a: { ...a, rArm: arm(on('scap_R'), 'grip', [-0.8, 0.5, 0]), lArm: arm(mat(0.35, 0.1), 'post', [0.5, -0.8, 0]) },
    b: { ...b, rArm: arm(on('scap_R', [0.02, 0, 0]), 'grip', [-0.9, -0.3, 0]), lArm: arm(on('thigh_R'), 'grip', [0.5, -1, 0]) },
  };
}

function halfDeep(v: Variant): PairSpec {
  // b under a's hips, perpendicular, hugging a's right thigh.
  const b = lie({ at: [-0.5, 0.0], headYaw: 90, roll: -20, crunch: 20, head: { look: [0.3, 0.5, -1] } });
  return {
    a: {
      ...kneel({ at: [0.05, -0.12], yaw: 0, h: v.postured ? 0.5 : 0.46, pitch: 10, chest: { bend: 16 }, lKnee: [0.7, 0.3], rKnee: [-0.45, -0.35], head: { look: [-0.4, -0.8, 0.3] } }),
      lArm: arm(on('head_side_L'), 'open', [0.6, -1, 0]),
      rArm: arm(matSelf(-0.3, 0.25), 'post', [-0.6, -1, 0]),
    },
    b: {
      ...b,
      lArm: arm(on('thigh_back_R'), 'grip', [0.6, 0.3, -1]),
      rArm: arm(on('thigh_R'), 'grip', [-0.6, 0.3, -1]),
      lLeg: { to: on('knee_back_R'), pole: [0.3, 0, 1], foot: 'hook' },
      rLeg: { to: on('shin_R'), pole: [-0.3, 0, 1], foot: 'hook' },
    },
  };
}

function halfLockdown(v: Variant): PairSpec {
  const b = lie({ at: [0, 0.04], headYaw: 0, head: { look: [0.3, 1, 0.3] } });
  return {
    a: {
      ...kneel({ at: [0.12, -0.08], yaw: 0, h: v.postured ? 0.44 : 0.3, pitch: v.postured ? 10 : 45, chest: { bend: v.postured ? 12 : 30 }, lKnee: [0.8, 0.5], rKnee: [-0.15, -0.3], rShin: [0, -1], foot: 'toes', head: { at: 'face' } }),
      rArm: arm(on('head_side_L'), 'grip', [-0.3, -0.6, -1]),
      lArm: arm(on('hip_R'), 'grip', [0.6, -1, 0]),
    },
    b: {
      ...b,
      lLeg: { to: on('calf_R', [0, 0.03, 0]), pole: [0.5, 0, 1], foot: 'hook' },
      rLeg: { to: on('shin_R', [-0.02, 0.03, 0]), pole: [-0.3, 0, 1], foot: 'hook' },
      lArm: arm(on('neck_side_R'), 'open', [0.6, -0.4, -1]),
      rArm: arm(on('scap_L'), 'grip', [-0.6, -0.4, -1]),
    },
  };
}

function halfQuarter(v: Variant): PairSpec {
  const s = side(v);
  return {
    a: { ...s.a, rLeg: kneelLeg(-0.6, 0.2, [-1, 0, -0.1], 'point') },
    b: {
      ...s.b,
      lLeg: { to: on('calf_R'), pole: [0.5, 0, 1], foot: 'hook' },
      rLeg: { to: on('calf_R', [0, 0, -0.06]), pole: [-0.3, 0, 1], foot: 'hook' },
    },
  };
}

function halfButterfly(v: Variant): PairSpec {
  const b = lie({ at: [0, 0.1], headYaw: 0, roll: 30, crunch: 20, head: { at: 'face' } });
  return {
    a: {
      ...kneel({ at: [0.05, -0.28], yaw: 0, h: v.postured ? 0.48 : 0.42, pitch: 25, chest: { bend: 20 }, lKnee: [0.6, 0.8], rKnee: [-0.3, 0.9], head: { at: 'face' } }),
      lArm: arm(on('hip_R'), 'grip', [0.6, -1, 0], 1, on('knee_front_R')),
      rArm: arm(on('shoulder_L'), 'grip', [-0.6, -1, 0], 1, on('chest_L')),
    },
    b: {
      ...b,
      lLeg: { to: on('calf_R'), pole: [0.5, 0, 1], foot: 'hook' },
      rLeg: { to: on('thigh_in_L', [0, -0.05, 0]), pole: [-0.2, 0.2, 1], foot: 'hook' },
      rArm: arm(on('ribs_L'), 'grip', [-0.8, -0.2, -0.5], 1, on('chest_L')),
      lArm: arm(on('bicep_R'), 'grip', [0.5, -0.5, -1], 1, on('chest_R')),
    },
  };
}

// ---------------------------------------------------------------------------
// Turtle family (b on knees and elbows, spine toward +X; a at -Z)
// ---------------------------------------------------------------------------

function turtleBody(x: number, z: number, onHands = false): Omit<BodySpec, 'lArm' | 'rArm'> & Pick<BodySpec, 'lArm' | 'rArm'> {
  return {
    hips: { at: [x, onHands ? 0.5 : 0.46, z] },
    pelvis: { up: [1, onHands ? 0.05 : -0.12, 0], fwd: [0, -1, 0] },
    chest: { bend: onHands ? 10 : 22 },
    head: { bend: onHands ? 0 : 30 },
    lLeg: kneelLeg(0.25, -0.14, [-1, 0.02, -0.05], 'point'),
    rLeg: kneelLeg(0.25, 0.14, [-1, 0.02, 0.05], 'point'),
    lArm: onHands ? arm({ mat: [0.5, -0.16], rel: 'self' }, 'post', [0.4, -0.3, -0.6]) : arm({ mat: [0.34, -0.12], rel: 'self', h: 0.08 }, 'fist', [0.2, -0.3, 1]),
    rArm: onHands ? arm({ mat: [0.5, 0.16], rel: 'self' }, 'post', [-0.4, -0.3, -0.6]) : arm({ mat: [0.34, 0.12], rel: 'self', h: 0.08 }, 'fist', [-0.2, -0.3, 1]),
  };
}

function turtle(_v: Variant): PairSpec {
  return {
    a: {
      ...kneel({ at: [-0.05, -0.42], yaw: 0, h: 0.5, pitch: 42, chest: { bend: 30 }, lKnee: [0.5, 0.8], rKnee: [-0.5, 0.8], head: { look: [0.4, -0.6, 1] } }),
      rArm: arm(on('belly', [0, 0, 0]), 'grip', [-0.7, -0.5, 0.3]),
      lArm: arm(on('elbow_R'), 'grip', [0.6, -0.6, 0.3], 1, on('tricep_R')),
    },
    b: turtleBody(-0.2, 0.08),
  };
}

function referee(_v: Variant): PairSpec {
  return {
    a: {
      ...kneel({ at: [-0.1, -0.36], yaw: 0, h: 0.46, pitch: 30, chest: { bend: 22 }, lKnee: [0.4, 0.8], rKnee: [-0.6, 0.6], head: { look: [0.2, -0.5, 1] } }),
      rArm: arm(on('belly', [0, 0, 0]), 'grip', [-0.7, -0.5, 0.3]),
      lArm: arm(on('elbow_L'), 'grip', [0.6, -0.8, 0.3]),
    },
    b: turtleBody(-0.2, 0.08, true),
  };
}

function frontHeadlockGround(_v: Variant): PairSpec {
  // b on his knees facing a (-Z), head under a's chest; a on one knee,
  // sprawled forward, chin strap and far elbow.
  const b = kneel({ at: [0, 0.3], yaw: 180, h: 0.36, pitch: 60, chest: { bend: 20 }, lKnee: [0.25, 1], rKnee: [-0.25, 1], head: { bend: 15 } });
  const a = kneel({ at: [0, -0.52], yaw: 0, h: 0.5, pitch: 40, chest: { bend: 28 }, lKnee: [0.4, 0.8], rKnee: [-0.3, 0.5], head: { look: [0, -0.8, 1] } });
  return {
    a: {
      ...a,
      lLeg: { to: matSelf(0.3, 0.1), pole: [0.4, 0, 1], foot: 'flat' },
      rArm: arm(on('throat', [0.04, -0.02, 0]), 'grip', [-0.9, -0.3, 0.1]),
      lArm: arm(on('elbow_R'), 'grip', [0.8, -0.5, 0.1]),
    },
    b: {
      ...b,
      lArm: arm(on('thigh_R'), 'grip', [0.5, -1, 0]),
      rArm: arm(on('thigh_L'), 'grip', [-0.5, -1, 0]),
    },
  };
}

export const GROUND_POSES: Record<string, NodePose> = {
  'pos.ground_mount_low': mountLow,
  'pos.ground_mount_high': mountHigh,
  'pos.ground_mount_s': mountS,
  'pos.ground_mount_tech': mountTech,
  'pos.ground_back_hooks': (v) => backBase(v, 'two'),
  'pos.ground_back_body_triangle': (v) => backBase(v, 'triangle'),
  'pos.ground_back_one_hook': (v) => backBase(v, 'one'),
  'pos.ground_back_seatbelt': backSeatbelt,
  'pos.ground_crucifix': crucifix,
  'pos.ground_side': side,
  'pos.ground_side_kesa': kesa,
  'pos.ground_side_reverse_kesa': reverseKesa,
  'pos.ground_side_kob': kneeOnBelly,
  'pos.ground_north_south': northSouth,
  'pos.ground_half_flat': halfFlat,
  'pos.ground_half_knee_shield': halfKneeShield,
  'pos.ground_half_underhook': halfUnderhook,
  'pos.ground_half_dogfight': halfDogfight,
  'pos.ground_half_deep': halfDeep,
  'pos.ground_half_lockdown': halfLockdown,
  'pos.ground_half_quarter': halfQuarter,
  'pos.ground_half_butterfly': halfButterfly,
  'pos.ground_turtle': turtle,
  'pos.ground_referee': referee,
  'pos.ground_front_headlock': frontHeadlockGround,
};

export { guardFists };
