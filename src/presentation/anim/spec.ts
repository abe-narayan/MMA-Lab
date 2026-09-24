/**
 * BODY SPEC -> POSE. The standing animator never writes bone rotations by
 * hand. Every layer (stance, footwork, strikes, defences, reactions, fatigue)
 * edits one `BodySpec` — where the pelvis is and how it is turned, how the
 * torso twists and bends, where the head looks, where each hand and foot must
 * be — and `solveSpec` turns it into a `Pose` with the shared two-bone IK.
 *
 * Why effectors instead of joint angles: a fight is about contact. A planted
 * foot is a world position that must not move; a landed jab is a fist that
 * must be on a chin at an exact millisecond. Expressing both as targets and
 * letting IK find the joints makes "no foot skating" and "contact on the
 * recorded instant" properties of the solver rather than of every clip.
 *
 * Conventions: see `math.ts` (fighter frame: +Z toward the opponent, +X the
 * fighter's left, positive yaw = turn left, positive pitch = lean forward,
 * positive roll = lean right).
 */
import {
  B, BONE_COUNT, boneIndex, forwardKinematics, forwardKinematicsSubtree,
  type Pose, type RestSkeleton, type WorldPose,
} from '../rig/skeleton';
import { KNEE_MAX_FLEX, LIMBS, foldReach, solveTwoBone } from '../rig/ik';
import {
  add, at, clamp, cross, dot, len, madd, norm, qconj, qmul, qrot, qslerp, qx, qy, qypr, qz,
  scale, sub, type Frame, type Q, type V3,
} from './math';

export interface HandSpec {
  /** Target for the fist (knuckles) when `fistTarget`, else for the wrist joint. World. */
  pos: V3;
  /** A world point the elbow bends toward. */
  pole: V3;
  /** Desired palm normal (world); the forearm pronates/supinates toward it. */
  palm: V3;
  /** IK weight: 0 leaves the arm hanging from the previous layer, 1 reaches. */
  w: number;
  fistTarget: boolean;
  /** 0 open hand .. 1 tight fist. */
  fist: number;
  /** The wrist target is exact (an elbow strike's weapon): no guard room (`guardRoom`). */
  exact?: boolean;
  /**
   * How much the forearm is rolled toward `palm` (default 1). A loose arm
   * swinging past the hip (a kick's counter-swing) lets its palm follow the
   * arm: rolling it to a fixed palm took the forearm through its 180° wrap
   * mid-swing (a 50° one-frame roll).
   */
  twist?: number;
}

export interface FootSpec {
  /** Ball of the foot on the floor (world, y is the ball height above the floor). */
  ball: V3;
  /** World yaw the foot points along (sim convention). */
  yaw: number;
  /** Heel lift about the ball, radians (0 flat, + heel up). */
  lift: number;
  /** Pitch of the whole foot when it is in the air (+ toes down). */
  airPitch: number;
  /** Where the knee points (world point). */
  pole: V3;
  /** 1 while planted: the toes stay flat on the floor. */
  toeFlat: number;
  /** Direct ankle override (world) used by kicks/knees; null = derive from ball. */
  ankle: V3 | null;
}

export interface HeadSpec {
  lookAt: V3 | null;
  lookW: number;
  /** Added on top of the look (or relative to the chest when not looking). */
  yaw: number;
  pitch: number;
  roll: number;
}

export interface BodySpec {
  frame: Frame;
  /** Hips joint, world. */
  pelvis: V3;
  pelvisYaw: number;
  pelvisPitch: number;
  pelvisRoll: number;
  /** Chest relative to pelvis, spread over Spine/Spine1/Spine2. */
  spineYaw: number;
  spinePitch: number;
  spineRoll: number;
  head: HeadSpec;
  /** Clavicle raise (shrug) and protraction per side [L, R], radians. */
  clavRaise: [number, number];
  clavFwd: [number, number];
  hands: [HandSpec, HandSpec];
  feet: [FootSpec, FootSpec];
  face: Float32Array;
  /** When true (lying, falling) the feet are not clamped to the floor. */
  free: boolean;
}

/** Per-body constants derived once from a rest skeleton. */
export interface RigInfo {
  rest: RestSkeleton;
  scale: number;
  hipsY: number;
  /** Hip joints relative to the Hips joint, rest. */
  hipOff: [V3, V3];
  thigh: number;
  shin: number;
  legLen: number;
  upperArm: number;
  foreArm: number;
  armLen: number;
  /** Ankle relative to the ball-of-foot floor point (rest, foot pointing +Z). */
  ankleFromBall: [V3, V3];
  ballHeight: number;
  fistLen: number;
  /** Shoulder joint (upper arm head) relative to the Hips joint, rest. */
  shoulderOff: [V3, V3];
  headOff: V3;
  neckOff: V3;
  spine1Off: V3;
}

export function rigInfo(rest: RestSkeleton): RigInfo {
  const h = rest.head;
  const hips = at(h, B.hips);
  const rel = (i: number): V3 => sub(at(h, i), hips);
  const d = (a: number, b: number): number => len(sub(at(h, a), at(h, b)));
  const ankleFromBall = (foot: number, toe: number): V3 => {
    const ankle = at(h, foot);
    const toeJ = at(h, toe);
    return [ankle[0] - toeJ[0], ankle[1], ankle[2] - toeJ[2]];
  };
  const thigh = d(B.lUpLeg, B.lLeg);
  const shin = d(B.lLeg, B.lFoot);
  const upperArm = d(B.lArm, B.lForeArm);
  const foreArm = d(B.lForeArm, B.lHand);
  const scaleF = rest.statureM / 1.7332;
  return {
    rest,
    scale: scaleF,
    hipsY: hips[1],
    hipOff: [rel(B.lUpLeg), rel(B.rUpLeg)],
    thigh, shin, legLen: thigh + shin,
    upperArm, foreArm, armLen: upperArm + foreArm,
    ankleFromBall: [ankleFromBall(B.lFoot, B.lToe), ankleFromBall(B.rFoot, B.rToe)],
    ballHeight: h[B.lToe * 3 + 1],
    fistLen: 0.085 * scaleF,
    shoulderOff: [rel(B.lArm), rel(B.rArm)],
    headOff: rel(B.head),
    neckOff: rel(B.neck),
    spine1Off: rel(B.spine1),
  };
}

export function createHand(): HandSpec {
  return { pos: [0, 1, 0], pole: [0, 0, 0], palm: [0, -1, 0], w: 1, fistTarget: false, fist: 1 };
}
export function createFoot(): FootSpec {
  return { ball: [0, 0, 0], yaw: 0, lift: 0, airPitch: 0, pole: [0, 0, 1], toeFlat: 1, ankle: null };
}

/** Largest forearm pronation / supination applied toward a wanted palm (radians). */
const TWIST_MAX = 1.9;

const NECK_YAW = 78 * Math.PI / 180;
const NECK_FLEX = 55 * Math.PI / 180;
const NECK_EXT = 60 * Math.PI / 180;
const NECK_ROLL = 40 * Math.PI / 180;

/** `head` (world) limited to the neck's range relative to `chest` (world). */
function clampNeck(chest: Q, head: Q): Q {
  const r = qmul(qconj(chest), head);
  const [x, y, z, w] = r;
  // YXZ Euler (yaw, pitch, roll) as `qypr` composes them.
  const yaw = Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
  const pitch = Math.asin(clamp(-2 * (y * z - w * x), -1, 1));
  const roll = Math.atan2(2 * (x * y + w * z), 1 - 2 * (x * x + z * z));
  const cy = clamp(yaw, -NECK_YAW, NECK_YAW);
  const cp = clamp(pitch, -NECK_EXT, NECK_FLEX);
  const cr = clamp(roll, -NECK_ROLL, NECK_ROLL);
  if (cy === yaw && cp === pitch && cr === roll) return head;
  return qmul(chest, qypr(cy, cp, cr));
}

/** Where footwork keeps a leg's reach (fraction of the leg); `clampPelvis` lowers the hips to stay inside it. */
export const LEG_REACH = 0.985;

/**
 * Soft limit on a stepping / standing leg's reach: past `LEG_REACH` of the leg
 * the ankle target is eased toward (never beyond) 99.8 % of it. Near full
 * extension the knee angle is extremely sensitive to reach (0.985 L is a 20°
 * knee, 0.9995 L a 4° one), so a hard clamp snapped the knee straight in one
 * frame whenever a long step's target left the leg's reach. Kicks and knees
 * (explicit ankle targets) keep the hard limit: their snap is the technique.
 */
function softReach(hip: V3, ankle: V3, rig: RigInfo): V3 {
  const d = sub(ankle, hip);
  const r = len(d);
  // Pass 2: eased in KNEE-ANGLE space. Easing the reach itself (toward 99.8 %
  // of the leg) still left the knee angle hypersensitive in the eased zone —
  // 1 cm of target moved the knee 7 → 20° in a frame, the leg pops left while
  // stepping. Past `LEG_REACH` (a ~20° knee) the knee now opens toward
  // `MIN_KNEE` exponentially with the excess reach, at the slope it had
  // there (~7° per cm, falling), so it never snaps and never locks straight.
  const L1 = rig.thigh, L2 = rig.shin;
  const r0 = LEG_REACH * rig.legLen; // where the footwork's pelvis clamp keeps planted legs
  if (r <= r0) return ankle;
  const rAt = (flex: number): number => Math.sqrt(L1 * L1 + L2 * L2 + 2 * L1 * L2 * Math.cos(flex));
  const soft = Math.acos(clamp((r0 * r0 - L1 * L1 - L2 * L2) / (2 * L1 * L2), -1, 1)); // ~20°
  const slope = r0 / (L1 * L2 * Math.sin(soft)); // |dθ/dr| at r0
  const flex = MIN_KNEE + (soft - MIN_KNEE) * Math.exp(-(r - r0) * slope / (soft - MIN_KNEE));
  return madd(hip, d, rAt(flex) / r);
}
/** The least a standing leg's knee opens to under the soft reach limit (radians). */
const MIN_KNEE = 5 * Math.PI / 180;

/** World ankle position for a foot spec on this body. */
export function ankleOf(rig: RigInfo, side: 0 | 1, f: FootSpec): V3 {
  if (f.ankle) return f.ankle;
  const q = qmul(qy(f.yaw), qx(f.lift + f.airPitch));
  const off = rig.ankleFromBall[side];
  // Rotate the ankle about the ball point (the ball sits at floor + ballHeight).
  const r = qrot(q, [off[0], off[1] - rig.ballHeight, off[2]]);
  return [f.ball[0] + r[0], f.ball[1] + rig.ballHeight + r[1], f.ball[2] + r[2]];
}

// Finger bones, for the fist curl.
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

const SPINE_SHARE = [0.3, 0.33, 0.37];

function setLocal(pose: Pose, bone: number, q: ArrayLike<number>): void {
  pose.local[bone * 4] = q[0];
  pose.local[bone * 4 + 1] = q[1];
  pose.local[bone * 4 + 2] = q[2];
  pose.local[bone * 4 + 3] = q[3];
}
export function getLocal(pose: Pose, bone: number): Q {
  const o = bone * 4;
  return [pose.local[o], pose.local[o + 1], pose.local[o + 2], pose.local[o + 3]];
}
export function worldQ(world: WorldPose, bone: number): Q {
  const o = bone * 4;
  return [world.quat[o], world.quat[o + 1], world.quat[o + 2], world.quat[o + 3]];
}
export function worldP(world: WorldPose, bone: number): V3 {
  return at(world.pos, bone);
}

/** Set a bone's local rotation from a desired WORLD rotation (parent must be current in `world`). */
export function setWorldRot(pose: Pose, world: WorldPose, bone: number, parent: number, q: Q): void {
  setLocal(pose, bone, qmul(qconj(worldQ(world, parent)), q));
}

/** Fist (knuckle) point of a hand in a solved world pose. */
export function fistPoint(world: WorldPose, rig: RigInfo, side: 0 | 1): V3 {
  const fore = side === 0 ? B.lForeArm : B.rForeArm;
  const hand = side === 0 ? B.lHand : B.rHand;
  const dir = norm(sub(worldP(world, hand), worldP(world, fore)));
  return madd(worldP(world, hand), dir, rig.fistLen);
}

/**
 * Solve the spec into `pose` (and leave `world` holding its forward
 * kinematics). Pass `armsOnly` to re-solve just the arms after an earlier full
 * solve (the strike pass, which needs the opponent's solved body first).
 */
export function solveSpec(spec: BodySpec, rig: RigInfo, pose: Pose, world: WorldPose, armsOnly = false): void {
  const rest = rig.rest;
  if (!armsOnly) {
    for (let i = 0; i < BONE_COUNT; i++) setLocal(pose, i, [0, 0, 0, 1]);
    pose.rootPos[0] = spec.pelvis[0];
    pose.rootPos[1] = spec.pelvis[1];
    pose.rootPos[2] = spec.pelvis[2];
    const rq = qypr(spec.frame.yaw + spec.pelvisYaw, spec.pelvisPitch, spec.pelvisRoll);
    pose.rootQuat.set(rq);

    const sb = [B.spine, B.spine1, B.spine2];
    for (let k = 0; k < 3; k++) {
      const a = SPINE_SHARE[k];
      setLocal(pose, sb[k], qypr(spec.spineYaw * a, spec.spinePitch * a, spec.spineRoll * a));
    }
    setLocal(pose, B.lShoulder, qmul(qz(spec.clavRaise[0]), qy(-spec.clavFwd[0])));
    setLocal(pose, B.rShoulder, qmul(qz(-spec.clavRaise[1]), qy(spec.clavFwd[1])));
    forwardKinematics(world, pose, rest);

    // Head and neck.
    const chest = worldQ(world, B.spine2);
    const hs = spec.head;
    const rel = qmul(chest, qypr(hs.yaw, hs.pitch, hs.roll));
    let qHead = rel;
    if (hs.lookAt && hs.lookW > 0) {
      const hp = worldP(world, B.head);
      const eye: V3 = [hp[0], hp[1] + 0.09 * rig.scale, hp[2]];
      const d = sub(hs.lookAt, eye);
      const yawL = Math.atan2(d[0], d[2]);
      const pitchL = Math.atan2(-d[1], Math.hypot(d[0], d[2]));
      const look = qypr(yawL + hs.yaw, pitchL + hs.pitch, hs.roll);
      qHead = qslerp(rel, look, clamp(hs.lookW, 0, 1));
    }
    // Limit how far the head may turn from the chest (anatomical neck range:
    // ~78° of rotation, 55° of flexion, 60° of extension, 40° of side bend). A
    // look-at past it (a jab turns the chest 60° off the line, a bladed stance
    // already 45°) used to twist the head round to 100-180° of neck yaw.
    qHead = clampNeck(chest, qHead);
    const qNeck = qslerp(chest, qHead, 0.42);
    setWorldRot(pose, world, B.neck, B.spine2, qNeck);
    setLocal(pose, B.head, qmul(qconj(qNeck), qHead));
    forwardKinematicsSubtree(world, pose, rest, B.neck);

    // Legs.
    for (const side of [0, 1] as const) {
      const f = spec.feet[side];
      const chain = side === 0 ? LIMBS.lLeg : LIMBS.rLeg;
      let ankle = ankleOf(rig, side, f);
      const hip = worldP(world, chain.upper);
      if (!f.ankle) ankle = softReach(hip, ankle, rig);
      solveTwoBone(pose, world, rest, chain, ankle, f.pole, 1, KNEE_MAX_FLEX);
    }
    forwardKinematicsSubtree(world, pose, rest, B.lUpLeg);
    forwardKinematicsSubtree(world, pose, rest, B.rUpLeg);
    for (const side of [0, 1] as const) {
      const f = spec.feet[side];
      const shinB = side === 0 ? B.lLeg : B.rLeg;
      const footB = side === 0 ? B.lFoot : B.rFoot;
      const toeB = side === 0 ? B.lToe : B.rToe;
      setWorldRot(pose, world, footB, shinB, qmul(qy(f.yaw), qx(f.lift + f.airPitch)));
      setLocal(pose, toeB, qx(-(f.lift + f.airPitch) * f.toeFlat * 0.85));
    }
    forwardKinematicsSubtree(world, pose, rest, B.lFoot);
    forwardKinematicsSubtree(world, pose, rest, B.rFoot);
  }

  // Arms.
  for (const side of [0, 1] as const) solveHand(spec, rig, pose, world, side);

  // Fingers: fist curl.
  for (const fb of FINGERS) {
    const fist = spec.hands[fb.side].fist;
    const a = fist * fb.k * (fb.side === 0 ? -1 : 1);
    setLocal(pose, fb.bone, fb.thumb ? qy(a * (fb.side === 0 ? 1 : 1) * 0.6) : qz(a));
  }
  pose.face.set(spec.face);
  // Only the forearms down changed since the arms were solved (the twist, the fingers).
  forwardKinematicsSubtree(world, pose, rest, B.lForeArm);
  forwardKinematicsSubtree(world, pose, rest, B.rForeArm);
}

/**
 * The elbow pole an arm is actually solved with. Two-bone IK bends the elbow
 * in the plane of the reach line and the pole; when the pole lies on the
 * reach line — typically a high guard with the glove straight above the
 * shoulder and the "elbow down" pole straight below it, or a body shot aimed
 * down toward the pole — that plane is undefined and the elbow flips to the
 * other side of the arm in one frame (measured: the upper arm swinging 90-180°
 * in a frame, the arm's pops left while standing). The pole is pushed out to
 * the arm's own side of the chest as the reach line closes in on the pole line
 * (either way, within ~30°), continuously, so the elbow plane never
 * degenerates; elsewhere the layer's pole is used as given.
 */
function armPole(world: WorldPose, side: 0 | 1, sh: V3, target: V3, pole: V3): V3 {
  const v = sub(target, sh);
  const vl = len(v);
  const p = sub(pole, sh);
  const pl = len(p);
  if (vl < 1e-4 || pl < 1e-4) return pole;
  const c = Math.abs(dot(v, p) / (vl * pl));
  const c0 = Math.cos(POLE_CONE);
  const k = clamp((c - c0) / (1 - c0), 0, 1);
  if (k <= 0) return pole;
  // Out to the arm's own side, less its part along the reach line; when the
  // reach itself points out to that side (a jab from a chest bladed ~90° off
  // the target), "out" is along the line and would not move the pole off it
  // (measured: the fist then ended 13-17 cm off a target 35-45 cm from the
  // shoulder): the elbow goes down instead.
  const cq = worldQ(world, B.spine2);
  const u: V3 = [v[0] / vl, v[1] / vl, v[2] / vl];
  const out = qrot(cq, [side === 0 ? 1 : -1, 0, 0]);
  let dir = madd(out, u, -dot(out, u));
  const ol = len(dir);
  if (ol < 0.6) {
    const down = qrot(cq, [0, -1, 0]);
    const dp = madd(down, u, -dot(down, u));
    dir = madd(scale(dir, ol / 0.6), dp, 1 - ol / 0.6);
  }
  dir = norm(dir);
  const w = k * k * (3 - 2 * k) * pl;
  return [pole[0] + dir[0] * w, pole[1] + dir[1] * w, pole[2] + dir[2] * w];
}
/**
 * A guard / defence hand is kept in FRONT of its shoulder, at least the reach
 * of a ~135° elbow away: with a bladed chest the lead shoulder comes forward
 * under the head-anchored guard, and the glove ended up 8-15 cm from the
 * shoulder joint, nearly straight above it. There the reach direction swings
 * tens of degrees for a centimetre of hand motion and the elbow orbited the
 * shoulder (measured: most of the remaining guard-arm pops, up to 180° a
 * frame). The target is slid forward along the chest's facing onto that
 * sphere — continuous, zero outside it.
 */
function guardRoom(world: WorldPose, rig: RigInfo, sh: V3, target: V3): V3 {
  const L1 = rig.upperArm, L2 = rig.foreArm;
  const r = Math.sqrt(L1 * L1 + L2 * L2 + 2 * L1 * L2 * Math.cos(GUARD_FOLD));
  const d = sub(target, sh);
  const dd = dot(d, d);
  if (dd >= r * r) return target;
  const f = qrot(worldQ(world, B.spine2), [0, 0, 1]);
  const b = dot(d, f);
  // Only for a hand in front of the shoulder (fading in over its first 5 cm):
  // a hand behind it is not a guard, and sliding it forward through the sphere
  // would jump.
  const w = clamp(b / (0.05 * rig.scale), 0, 1);
  if (w <= 0) return target;
  const k = -b + Math.sqrt(Math.max(0, b * b - (dd - r * r)));
  return madd(target, f, k * w * w * (3 - 2 * w));
}
/** Elbow flexion whose reach a guard hand is kept outside of (`guardRoom`). */
const GUARD_FOLD = 135 * Math.PI / 180;

/** Half-angle of the cone about the reach line inside which the elbow pole is pushed out (`armPole`). */
const POLE_CONE = 30 * Math.PI / 180;

/**
 * Solve one arm of the spec onto its hand target (two-bone IK; with
 * `fistTarget` the knuckles, not the wrist, land on it) and roll the forearm
 * toward the wanted palm. `world` must be current for the chest; it is left
 * current for this arm.
 */
export function solveHand(spec: BodySpec, rig: RigInfo, pose: Pose, world: WorldPose, side: 0 | 1): void {
  const rest = rig.rest;
  {
    const h = spec.hands[side];
    if (h.w <= 0) return;
    const chain = side === 0 ? LIMBS.lArm : LIMBS.rArm;
    const sh = worldP(world, chain.upper);
    // The elbow's fold limit, softly, in target space (see `foldReach`).
    const fold = (t: V3): V3 => foldReach(sh, t, rig.upperArm, rig.foreArm);
    const pole = armPole(world, side, sh, h.pos, h.pole);
    let target: V3 = h.fistTarget || h.exact ? h.pos : guardRoom(world, rig, sh, h.pos);
    if (h.fistTarget) {
      // Aim the wrist so the knuckles, not the wrist, arrive on the target.
      target = madd(h.pos, norm(sub(h.pos, sh)), -rig.fistLen);
      // Out of reach: keep the fist on the shoulder -> target line (the closest it can get).
      const reachable = len(sub(target, sh)) < rig.armLen * 0.995;
      for (let it = 0; it < (reachable ? 3 : 1); it++) {
        solveTwoBone(pose, world, rest, chain, fold(target), pole, h.w);
        forwardKinematicsSubtree(world, pose, rest, chain.upper);
        const fp = fistPoint(world, rig, side);
        const err = sub(h.pos, fp);
        if (len(err) < 0.002) break;
        target = add(target, scale(err, h.w));
      }
    } else {
      solveTwoBone(pose, world, rest, chain, fold(target), pole, h.w);
      forwardKinematicsSubtree(world, pose, rest, chain.upper);
    }
    // Pronate / supinate the forearm so the palm faces `palm`.
    const fore = side === 0 ? B.lForeArm : B.rForeArm;
    // Twist about the forearm's true rest direction, so the hand does not move.
    const handB = side === 0 ? B.lHand : B.rHand;
    const restAxis = norm(sub(at(rest.head, handB), at(rest.head, fore)));
    const qf = worldQ(world, fore);
    const axis = norm(qrot(qf, restAxis));
    const cur = qrot(qf, [0, -1, 0]);
    const want = h.palm;
    const cp = norm(madd(cur, axis, -dot(cur, axis)));
    const wp = norm(madd(want, axis, -dot(want, axis)));
    // Continuous at the wrap: a wanted palm almost opposite the IK's is
    // ambiguous (pronate or supinate the long way?), and the old hard clamp at
    // ±126° flipped the forearm 250° in one frame when it crossed ±180°. Past
    // 109° the twist eases back to 0 at 180°, the same from either side.
    const raw = Math.atan2(dot(axis, cross(cp, wp)), dot(cp, wp));
    const ang = (Math.abs(raw) <= TWIST_MAX ? raw : Math.sign(raw) * TWIST_MAX * (Math.PI - Math.abs(raw)) / (Math.PI - TWIST_MAX)) * (h.twist ?? 1);
    const lq = getLocal(pose, fore);
    const sa = Math.sin(ang / 2);
    setLocal(pose, fore, qmul(lq, [restAxis[0] * sa, restAxis[1] * sa, restAxis[2] * sa, Math.cos(ang / 2)]));
  }
}

