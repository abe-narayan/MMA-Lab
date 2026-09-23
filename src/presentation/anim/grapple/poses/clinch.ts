/**
 * Standing tie-ups (§2.2.2) and the free standing nodes. Pair frame: `a` at
 * -Z facing +Z, `b` at +Z facing -Z (yaw 180). `a`'s left is +X; `b`'s left
 * is -X, so "a's left hand to b's right arm" stays on the +X side.
 */
import type { BodySpec, PairSpec } from '../dsl';
import { arm, guardArms, on, pt, stand } from '../build';
import { level, type NodePose, type Variant } from './types';

const A = (v: Variant, z: number, o: Partial<Parameters<typeof stand>[0]> = {}, k = 0.5) => stand({ at: [0, z], yaw: 0, h: level(0.87, v.sA, v.sB, k), pitch: 12, chest: { bend: 14 }, lFoot: [0.17, 0.12], rFoot: [-0.17, -0.16], ...o });
const Bs = (v: Variant, z: number, o: Partial<Parameters<typeof stand>[0]> = {}, k = 0.5) => stand({ at: [0, z], yaw: 180, h: level(0.87, v.sB, v.sA, k), pitch: 12, chest: { bend: 14 }, lFoot: [0.17, 0.12], rFoot: [-0.17, -0.16], ...o });

/** §10: novices clinch with stiff arms and the head down. */
function tierTell(body: BodySpec, tier: number): BodySpec {
  if (tier > 1) return body;
  const k = tier === 0 ? 1 : 0.7;
  const chest = body.chest && 'bend' in body.chest ? { ...body.chest, bend: (body.chest.bend ?? 0) + 12 * k } : body.chest;
  return {
    ...body,
    chest,
    head: { ...(body.head ?? {}), bend: 25 * k },
    lArm: { ...body.lArm, pole: [0.2, -1, 0.9] },
    rArm: { ...body.rArm, pole: [-0.2, -1, 0.9] },
  };
}

function withTiers(p: PairSpec, v: Variant): PairSpec {
  return { a: tierTell(p.a, v.tierA), b: tierTell(p.b, v.tierB) };
}

// ---------------------------------------------------------------------------

function standingPair(gap: number) {
  return (_v: Variant): PairSpec => ({
    a: { ...stand({ at: [0, -gap / 2], yaw: 0, h: 0.9, pitch: 6, chest: { bend: 10 }, lFoot: [0.12, 0.2], rFoot: [-0.14, -0.18], head: { at: 'face' } }), ...guardArms() },
    b: { ...stand({ at: [0, gap / 2], yaw: 180, h: 0.9, pitch: 6, chest: { bend: 10 }, lFoot: [0.12, 0.2], rFoot: [-0.14, -0.18], head: { at: 'face' } }), ...guardArms() },
  });
}

function handFight(v: Variant): PairSpec {
  return withTiers({
    a: { ...A(v, -0.36, { lFoot: [0.14, 0.14], rFoot: [-0.16, -0.16], head: { at: 'face' } }),
      lArm: arm(on('wrist_R'), 'grip', [0.6, -1, -0.1]),
      rArm: arm(on('bicep_L'), 'grip', [-0.6, -1, -0.1]) },
    b: { ...Bs(v, 0.36, { lFoot: [0.14, 0.14], rFoot: [-0.16, -0.16], head: { at: 'face' } }),
      lArm: arm(pt(-0.14, 1.12, 0.02), 'fist', [0.5, -1, 0]),
      rArm: arm(pt(0.16, 1.1, -0.02), 'open', [-0.5, -1, 0]) },
  }, v);
}

function collarTie(v: Variant): PairSpec {
  return withTiers({
    a: { ...A(v, -0.3, { lFoot: [0.14, 0.14], rFoot: [-0.16, -0.18], head: { at: 'head_side_L' } }),
      lArm: arm(on('neck_back'), 'grip', [0.2, -1, 0.3]),
      rArm: arm(on('elbow_L'), 'grip', [-0.6, -1, -0.1]) },
    b: { ...Bs(v, 0.3, { lFoot: [0.14, 0.14], rFoot: [-0.16, -0.18], head: { at: 'head_side_L' } }),
      lArm: arm(on('neck_back'), 'grip', [0.2, -1, 0.3]),
      rArm: arm(on('bicep_L'), 'grip', [-0.6, -1, -0.1]) },
  }, v);
}

function thaiPlum(v: Variant): PairSpec {
  return withTiers({
    a: { ...A(v, -0.3, { pitch: 4, chest: { bend: 4 }, h: 0.92, head: { at: 'crown' } }),
      lArm: arm(on('head_back', [0.03, 0.02, 0]), 'grip', [0.15, -1, 0.9]),
      rArm: arm(on('head_back', [-0.03, 0.0, 0]), 'grip', [-0.15, -1, 0.9]) },
    b: { ...Bs(v, 0.36, { pitch: 22, chest: { bend: 28 }, h: 0.86, head: { bend: 25 } }),
      lArm: arm(on('hip_R'), 'open', [0.5, -1, 0]),
      rArm: arm(on('hip_L'), 'open', [-0.5, -1, 0]) },
  }, v);
}

function overUnder(v: Variant): PairSpec {
  return withTiers({
    a: { ...A(v, -0.25, { yaw: 12, chest: { bend: 12, twist: -8 }, head: { look: [-0.35, -0.1, 1] } }),
      lArm: arm(on('tricep_R'), 'grip', [0.8, 0.2, -0.2]),
      rArm: arm(on('scap_L'), 'grip', [-0.8, -0.8, 0.2]) },
    b: { ...Bs(v, 0.25, { yaw: 192, chest: { bend: 12, twist: -8 }, head: { look: [0.35, -0.1, -1] } }),
      lArm: arm(on('tricep_R'), 'grip', [0.8, 0.2, -0.2]),
      rArm: arm(on('scap_L'), 'grip', [-0.8, -0.8, 0.2]) },
  }, v);
}

function underhook(v: Variant): PairSpec {
  return withTiers({
    a: { ...A(v, -0.24, { yaw: 14, chest: { bend: 14, twist: -10 }, head: { look: [-0.4, -0.2, 1] } }),
      lArm: arm(on('wrist_R'), 'grip', [0.6, -1, -0.2]),
      rArm: arm(on('scap_L', [0, 0.04, 0]), 'grip', [-0.9, -0.7, 0.2]) },
    b: { ...Bs(v, 0.28, { yaw: 196, pitch: 16, chest: { bend: 16, twist: -6 }, head: { look: [0.3, -0.1, -1] } }),
      lArm: arm(on('scap_R'), 'grip', [0.9, 0.5, -0.1]),
      rArm: arm(on('chest_L'), 'open', [-0.6, -1, 0]) },
  }, v);
}

function overhookControl(v: Variant): PairSpec {
  return withTiers({
    a: { ...A(v, -0.26, { yaw: -14, pitch: 6, chest: { bend: 8, twist: 10 }, head: { look: [0.2, -0.2, 1] } }),
      lArm: arm(on('scap_R'), 'grip', [0.9, 0.6, -0.1]),
      rArm: arm(on('head_side_L'), 'open', [-0.6, -1, 0]) },
    b: { ...Bs(v, 0.3, { yaw: 164, pitch: 24, chest: { bend: 26, side: -6 }, head: { bend: 10, look: [0.1, -0.4, -1] } }),
      lArm: arm(on('chest_R'), 'open', [0.6, -1, 0]),
      rArm: arm(on('scap_L'), 'grip', [-0.9, -0.7, 0.2]) },
  }, v);
}

function doubleUnder(v: Variant): PairSpec {
  return withTiers({
    // Arms UNDER b's armpits, hands locked low on his back; head on his chest.
    a: { ...A(v, -0.22, { pitch: 6, chest: { bend: 14, side: -6 }, head: { look: [-0.8, -0.5, 1], side: -15 } }, 1.3),
      lArm: arm(on('back_lower', [-0.05, 0.06, 0]), 'grip', [0.7, -1, 0.3], 1, on('lat_R', [0, -0.08, 0])),
      rArm: arm(on('back_lower', [0.05, 0.04, 0]), 'grip', [-0.7, -1, 0.3], 1, on('lat_L', [0, -0.08, 0])) },
    b: { ...Bs(v, 0.3, { pitch: 20, chest: { bend: 10 }, head: { look: [0.3, 0, -1] } }),
      lArm: arm(on('scap_R'), 'grip', [0.9, 0.4, 0]),
      rArm: arm(on('scap_L'), 'grip', [-0.9, 0.4, 0]) },
  }, v);
}

function bodyLockFront(v: Variant): PairSpec {
  return withTiers({
    a: { ...A(v, -0.2, { pitch: 2, chest: { bend: 12, side: -6 }, head: { look: [-0.8, -0.3, 1], side: -15 } }, 1.1),
      lArm: arm(on('back_lower', [-0.04, -0.03, 0]), 'grip', [0.9, -0.7, 0], 1, on('waist_R', [0, 0, -0.05])),
      rArm: arm(on('back_lower', [0.04, -0.03, 0]), 'grip', [-0.9, -0.7, 0], 1, on('waist_L', [0, 0, -0.05])) },
    b: { ...Bs(v, 0.34, { pitch: 26, chest: { bend: 12 }, lFoot: [0.2, -0.05], rFoot: [-0.2, -0.2], head: { look: [0, -0.2, -1] } }),
      lArm: arm(on('shoulder_R', [0, 0.02, 0]), 'open', [0.5, -1, 0]),
      rArm: arm(on('shoulder_L', [0, 0.02, 0]), 'open', [-0.5, -1, 0]) },
  }, v);
}

function bodyLockRear(v: Variant): PairSpec {
  return withTiers({
    a: { ...stand({ at: [0, -0.2], yaw: 0, h: 0.86, pitch: 10, chest: { bend: 14 }, lFoot: [0.2, 0.05], rFoot: [-0.2, -0.1], head: { look: [0.3, -0.3, 1] } }),
      lArm: arm(on('belly', [0.03, 0, 0]), 'grip', [0.9, -0.4, 0]),
      rArm: arm(on('belly', [-0.03, 0, 0]), 'grip', [-0.9, -0.4, 0]) },
    b: { ...stand({ at: [0, 0.12], yaw: 0, h: 0.86, pitch: 12, chest: { bend: 12 }, lFoot: [0.24, 0.12], rFoot: [-0.24, 0.0], head: { look: [0, 0, 1] } }),
      lArm: arm(on('wrist_L'), 'grip', [0.6, -1, 0.1]),
      rArm: arm(on('wrist_R'), 'grip', [-0.6, -1, 0.1]) },
  }, v);
}

function frontHeadlock(v: Variant): PairSpec {
  return withTiers({
    a: { ...A(v, -0.4, { pitch: 16, chest: { bend: 22 }, h: 0.86, lFoot: [0.2, 0.0], rFoot: [-0.2, -0.2], head: { look: [0, -0.8, 1] } }),
      lArm: arm(on('elbow_R'), 'grip', [0.8, -0.5, 0.1]),
      rArm: arm(on('throat', [0.05, -0.02, 0]), 'grip', [-0.9, -0.6, 0.2]) },
    b: { ...Bs(v, 0.36, { pitch: 70, chest: { bend: 12 }, h: 0.8, lFoot: [0.2, 0.05], rFoot: [-0.2, -0.05], head: { bend: 10 } }),
      lArm: arm(on('thigh_R'), 'open', [0.5, -1, 0]),
      rArm: arm(on('thigh_L'), 'open', [-0.5, -1, 0]) },
  }, v);
}

function headAndArm(v: Variant): PairSpec {
  return withTiers({
    a: { ...A(v, -0.24, { yaw: -10, pitch: 8, chest: { bend: 10, twist: 8 }, head: { look: [0.3, -0.2, 1] } }),
      lArm: arm(on('bicep_R'), 'grip', [0.7, -0.8, 0]),
      rArm: arm(on('neck_side_R', [0, 0, 0]), 'grip', [-0.8, 0.3, 0.3]) },
    b: { ...Bs(v, 0.3, { yaw: 170, pitch: 20, chest: { bend: 20, side: 8 }, head: { bend: 10, side: 10 } }),
      lArm: arm(on('ribs_R'), 'open', [0.6, -1, 0]),
      rArm: arm(on('scap_L'), 'grip', [-0.8, 0.2, 0]) },
  }, v);
}

function twoOnOne(v: Variant): PairSpec {
  return withTiers({
    a: { ...stand({ at: [0.12, -0.24], yaw: 35, h: 0.86, pitch: 12, chest: { bend: 14, twist: 10 }, head: { at: 'shoulder_R' } }),
      lArm: arm(on('bicep_R'), 'grip', [0.5, -1, -0.2]),
      rArm: arm(on('wrist_R'), 'grip', [-0.6, -1, 0]) },
    b: { ...Bs(v, 0.28, { yaw: 200, pitch: 14, chest: { bend: 12, twist: 12 }, head: { look: [-0.4, -0.1, -1] } }),
      lArm: arm(on('shoulder_R'), 'open', [0.6, -1, 0]),
      rArm: arm(pt(0.08, 1.02, -0.18), 'grip', [-0.3, -1, 0.4]) },
  }, v);
}

function cagePinFront(v: Variant): PairSpec {
  return withTiers({
    a: { ...A(v, -0.2, { yaw: 8, pitch: 18, chest: { bend: 10, twist: -6 }, h: 0.86, lFoot: [0.2, 0.0], rFoot: [-0.18, -0.35], head: { look: [-0.3, 0.2, 1] } }),
      lArm: arm(on('wrist_R'), 'grip', [0.6, -1, 0]),
      rArm: arm(on('scap_L', [0, 0.02, 0]), 'grip', [-0.9, -0.7, 0.2]) },
    b: { ...Bs(v, 0.22, { pitch: -4, chest: { bend: -2 }, h: 0.9, lFoot: [0.2, 0.12], rFoot: [-0.2, 0.08], head: { look: [0.2, 0.1, -1] } }),
      lArm: arm(pt(-0.42, 1.05, 0.34), 'open', [0.8, -0.5, -0.3]),
      rArm: arm(on('chest_L'), 'open', [-0.6, -1, 0]) },
  }, v);
}

function cagePinRear(v: Variant): PairSpec {
  return withTiers({
    a: { ...stand({ at: [0, -0.16], yaw: 0, h: 0.86, pitch: 14, chest: { bend: 12 }, lFoot: [0.2, 0.0], rFoot: [-0.2, -0.3], head: { look: [0.3, -0.2, 1] } }),
      lArm: arm(on('belly', [0.03, 0, 0]), 'grip', [0.9, -0.4, 0]),
      rArm: arm(on('belly', [-0.03, 0, 0]), 'grip', [-0.9, -0.4, 0]) },
    b: { ...stand({ at: [0, 0.14], yaw: 0, h: 0.88, pitch: 6, chest: { bend: 4 }, lFoot: [0.22, 0.05], rFoot: [-0.22, 0.0], head: { look: [0.3, 0, 1] } }),
      lArm: arm(pt(0.28, 1.25, 0.42), 'open', [0.8, -0.6, 0]),
      rArm: arm(pt(-0.28, 1.2, 0.42), 'open', [-0.8, -0.6, 0]) },
  }, v);
}

export const CLINCH_POSES: Record<string, NodePose> = {
  'pos.standing_long': standingPair(2.2),
  'pos.standing_mid': standingPair(1.3),
  'pos.standing_close': standingPair(0.85),
  'pos.standing_cage': standingPair(1.0),
  'pos.clinch_hand_fight': handFight,
  'pos.clinch_collar_tie': collarTie,
  'pos.clinch_thai_plum': thaiPlum,
  'pos.clinch_over_under': overUnder,
  'pos.clinch_underhook': underhook,
  'pos.clinch_overhook_control': overhookControl,
  'pos.clinch_double_under': doubleUnder,
  'pos.clinch_body_lock_front': bodyLockFront,
  'pos.clinch_body_lock_rear': bodyLockRear,
  'pos.clinch_front_headlock': frontHeadlock,
  'pos.clinch_head_and_arm': headAndArm,
  'pos.clinch_two_on_one': twoOnOne,
  'pos.clinch_cage_pin_front': cagePinFront,
  'pos.clinch_cage_pin_rear': cagePinRear,
};
