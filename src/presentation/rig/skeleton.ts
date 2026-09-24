/**
 * CANONICAL SKELETON AND POSE BUFFER — the contract between animation and the body.
 *
 * Two modules meet here and must never disagree:
 *
 *   - `anim/` decides where every bone points, every frame;
 *   - `character/` owns a skinned mesh that has to follow.
 *
 * They share exactly three things, all defined in this file:
 *
 *   1. The bone list and its order (`BONES`, generated from MPFB2's Mixamo rig).
 *   2. The rest convention: **every bone's rest rotation is identity in model
 *      space**, and the rest pose is MPFB's T-pose. A bone's local rotation in a
 *      `Pose` is therefore its rotation relative to its parent's frame, where
 *      "no rotation" means "as in the T-pose". This deliberately discards
 *      Blender's per-bone roll: with identity rest frames an animator can say
 *      "rotate LeftArm about +Z by -70° to drop the arm to the side" and mean it
 *      in every body, and a retargeted mocap clip only needs one alignment per
 *      bone, not a roll correction as well.
 *   3. `RestSkeleton`: per-fighter joint positions. The character module derives
 *      them from the morphed body (so a long-armed fighter's elbow is where his
 *      elbow actually is); the animation module needs them for IK chain lengths.
 *
 * Coordinates: three.js convention, Y up, the fighter faces +Z, metres. The
 * fighter's left is +X.
 */
import { RIG_BONES } from './rigData';

export const BONE_COUNT = RIG_BONES.length;

/** Bone names in pose-buffer order (parent before child). */
export const BONES: readonly string[] = RIG_BONES.map((b) => b.name);

/** Parent index per bone; -1 for the root. */
export const BONE_PARENT: Int16Array = Int16Array.from(RIG_BONES.map((b) => b.parent));

const INDEX = new Map(BONES.map((n, i) => [n, i]));

/** Index of a bone by its Mixamo name (without the `mixamorig:` prefix). */
export function boneIndex(name: string): number {
  const i = INDEX.get(name);
  if (i === undefined) throw new Error(`Unknown bone: ${name}`);
  return i;
}

/**
 * Named indices for the bones animation code touches directly. Fingers are
 * reachable through `boneIndex` but are only posed by the grip layer.
 */
export const B = Object.freeze({
  hips: boneIndex('Hips'),
  spine: boneIndex('Spine'),
  spine1: boneIndex('Spine1'),
  spine2: boneIndex('Spine2'),
  neck: boneIndex('Neck'),
  head: boneIndex('Head'),
  lShoulder: boneIndex('LeftShoulder'),
  lArm: boneIndex('LeftArm'),
  lForeArm: boneIndex('LeftForeArm'),
  lHand: boneIndex('LeftHand'),
  rShoulder: boneIndex('RightShoulder'),
  rArm: boneIndex('RightArm'),
  rForeArm: boneIndex('RightForeArm'),
  rHand: boneIndex('RightHand'),
  lUpLeg: boneIndex('LeftUpLeg'),
  lLeg: boneIndex('LeftLeg'),
  lFoot: boneIndex('LeftFoot'),
  lToe: boneIndex('LeftToeBase'),
  rUpLeg: boneIndex('RightUpLeg'),
  rLeg: boneIndex('RightLeg'),
  rFoot: boneIndex('RightFoot'),
  rToe: boneIndex('RightToeBase'),
});

// ---------------------------------------------------------------------------
// Rest skeleton
// ---------------------------------------------------------------------------

/**
 * Joint positions of one fighter's body in the T-pose, model space, metres.
 * `head[i]` is bone i's joint; `tail[i]` is where bone i ends (its child's
 * joint, or an end site for leaves). Rest rotations are all identity.
 */
export interface RestSkeleton {
  head: Float32Array; // BONE_COUNT * 3
  tail: Float32Array; // BONE_COUNT * 3
  /** |tail - head| per bone, cached for IK. */
  length: Float32Array; // BONE_COUNT
  /** Stature from floor to crown, metres, for camera framing and labels. */
  statureM: number;
}

/** MPFB's default body, unscaled. The reference every other rest derives from. */
export function defaultRest(): RestSkeleton {
  const head = new Float32Array(BONE_COUNT * 3);
  const tail = new Float32Array(BONE_COUNT * 3);
  RIG_BONES.forEach((b, i) => {
    head.set(b.head, i * 3);
    tail.set(b.tail, i * 3);
  });
  return finishRest(head, tail, DEFAULT_STATURE_M);
}

/**
 * MPFB's default body stands about 1.75 m to the crown; the Head bone's tail
 * sits at the crown. Computed once from the rig so nothing hard-codes it.
 */
const DEFAULT_STATURE_M = (() => {
  const h = RIG_BONES.find((b) => b.name === 'Head')!;
  return h.tail[1];
})();

export function finishRest(head: Float32Array, tail: Float32Array, statureM: number): RestSkeleton {
  const length = new Float32Array(BONE_COUNT);
  for (let i = 0; i < BONE_COUNT; i++) {
    const dx = tail[i * 3] - head[i * 3];
    const dy = tail[i * 3 + 1] - head[i * 3 + 1];
    const dz = tail[i * 3 + 2] - head[i * 3 + 2];
    length[i] = Math.hypot(dx, dy, dz);
  }
  return { head, tail, length, statureM };
}

// ---------------------------------------------------------------------------
// Pose buffer
// ---------------------------------------------------------------------------

/**
 * Facial channels driven by animation (damage, fatigue, flinch, KO). The
 * character maps each onto its morph targets; a body without a face mesh
 * ignores them. Values are 0-1.
 */
export const FACE_CHANNELS = [
  'eyesClosedL', 'eyesClosedR', 'browDown', 'mouthOpen', 'grimace', 'jawSlack', 'wince', 'breathe',
] as const;
export type FaceChannel = (typeof FACE_CHANNELS)[number];
export const FACE = Object.freeze(
  Object.fromEntries(FACE_CHANNELS.map((c, i) => [c, i])) as Record<FaceChannel, number>,
);

/**
 * One fighter's pose for one rendered frame.
 *
 *  - `rootPos` is the Hips joint in world space (metres). Ground height is 0.
 *  - `rootQuat` is the Hips world rotation. A fighter facing along `facing`
 *    radians (the sim's convention: atan2(dx, dz)) with no lean has
 *    rootQuat = rotationY(facing).
 *  - `local[4i..4i+3]` is bone i's rotation (x, y, z, w) relative to its parent,
 *    under the identity-rest convention above. Bone 0 (Hips) must be identity:
 *    its orientation lives in `rootQuat`.
 *  - `face` holds `FACE_CHANNELS` weights.
 */
export interface Pose {
  rootPos: Float32Array; // 3
  rootQuat: Float32Array; // 4
  local: Float32Array; // BONE_COUNT * 4
  face: Float32Array; // FACE_CHANNELS.length
}

export function createPose(): Pose {
  const p: Pose = {
    rootPos: new Float32Array(3),
    rootQuat: new Float32Array([0, 0, 0, 1]),
    local: new Float32Array(BONE_COUNT * 4),
    face: new Float32Array(FACE_CHANNELS.length),
  };
  resetPose(p);
  return p;
}

/** The T-pose standing at the origin. */
export function resetPose(p: Pose): void {
  p.rootPos.fill(0);
  p.rootQuat.set([0, 0, 0, 1]);
  for (let i = 0; i < BONE_COUNT; i++) p.local.set([0, 0, 0, 1], i * 4);
  p.face.fill(0);
}

export function copyPose(dst: Pose, src: Pose): void {
  dst.rootPos.set(src.rootPos);
  dst.rootQuat.set(src.rootQuat);
  dst.local.set(src.local);
  dst.face.set(src.face);
}

/**
 * Blend two poses: shortest-arc slerp per bone, lerp for root position and
 * face. `t` = 0 gives `a`, 1 gives `b`. Allocation-free; `out` may alias `a`.
 */
export function blendPose(out: Pose, a: Pose, b: Pose, t: number): void {
  for (let k = 0; k < 3; k++) out.rootPos[k] = a.rootPos[k] + (b.rootPos[k] - a.rootPos[k]) * t;
  slerpInto(out.rootQuat, 0, a.rootQuat, 0, b.rootQuat, 0, t);
  for (let i = 0; i < BONE_COUNT; i++) slerpInto(out.local, i * 4, a.local, i * 4, b.local, i * 4, t);
  for (let k = 0; k < out.face.length; k++) out.face[k] = a.face[k] + (b.face[k] - a.face[k]) * t;
}

/** Normalised-lerp slerp on packed quaternions, shortest arc. */
export function slerpInto(
  out: Float32Array, o: number, a: Float32Array, ai: number, b: Float32Array, bi: number, t: number,
): void {
  let bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
  const ax = a[ai], ay = a[ai + 1], az = a[ai + 2], aw = a[ai + 3];
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let s0: number, s1: number;
  if (cos > 0.9995) {
    s0 = 1 - t; s1 = t;
  } else {
    const theta = Math.acos(cos);
    const sin = Math.sin(theta);
    s0 = Math.sin((1 - t) * theta) / sin;
    s1 = Math.sin(t * theta) / sin;
  }
  let x = s0 * ax + s1 * bx, y = s0 * ay + s1 * by, z = s0 * az + s1 * bz, w = s0 * aw + s1 * bw;
  const n = Math.hypot(x, y, z, w) || 1;
  x /= n; y /= n; z /= n; w /= n;
  out[o] = x; out[o + 1] = y; out[o + 2] = z; out[o + 3] = w;
}

// ---------------------------------------------------------------------------
// Forward kinematics
// ---------------------------------------------------------------------------

/** World-space joint positions and rotations produced by `forwardKinematics`. */
export interface WorldPose {
  pos: Float32Array; // BONE_COUNT * 3 — joint (head) positions
  quat: Float32Array; // BONE_COUNT * 4 — bone world rotations
  tip: Float32Array; // BONE_COUNT * 3 — bone tail positions
}

export function createWorldPose(): WorldPose {
  return {
    pos: new Float32Array(BONE_COUNT * 3),
    quat: new Float32Array(BONE_COUNT * 4),
    tip: new Float32Array(BONE_COUNT * 3),
  };
}

/**
 * Evaluate a pose on a rest skeleton. Needed by IK, contact checks, the debug
 * skeleton and the camera (to frame heads and hands). The skinned mesh does the
 * same arithmetic on the GPU; this is the CPU copy.
 */
export function forwardKinematics(out: WorldPose, pose: Pose, rest: RestSkeleton): WorldPose {
  const { head, tail } = rest;
  for (let i = 0; i < BONE_COUNT; i++) {
    const p = BONE_PARENT[i];
    const q = i * 4;
    if (p < 0) {
      out.pos.set(pose.rootPos, 0);
      mulQuat(out.quat, q, pose.rootQuat, 0, pose.local, q);
    } else {
      const pq = p * 4;
      // Joint position: parent's joint + parent's world rotation applied to the
      // rest offset between the two joints (rest rotations are identity).
      const ox = head[i * 3] - head[p * 3];
      const oy = head[i * 3 + 1] - head[p * 3 + 1];
      const oz = head[i * 3 + 2] - head[p * 3 + 2];
      rotateInto(out.pos, i * 3, out.quat, pq, ox, oy, oz);
      out.pos[i * 3] += out.pos[p * 3];
      out.pos[i * 3 + 1] += out.pos[p * 3 + 1];
      out.pos[i * 3 + 2] += out.pos[p * 3 + 2];
      mulQuat(out.quat, q, out.quat, pq, pose.local, q);
    }
    const tx = tail[i * 3] - head[i * 3];
    const ty = tail[i * 3 + 1] - head[i * 3 + 1];
    const tz = tail[i * 3 + 2] - head[i * 3 + 2];
    rotateInto(out.tip, i * 3, out.quat, q, tx, ty, tz);
    out.tip[i * 3] += out.pos[i * 3];
    out.tip[i * 3 + 1] += out.pos[i * 3 + 1];
    out.tip[i * 3 + 2] += out.pos[i * 3 + 2];
  }
  return out;
}

/** Bone indices of the subtree rooted at each bone (itself first, parents before children). */
const SUBTREE: Int16Array[] = (() => {
  const lists: number[][] = Array.from({ length: BONE_COUNT }, () => []);
  for (let i = 0; i < BONE_COUNT; i++) {
    // Every ancestor of i (and i itself) gets i, in index order (parents first).
    for (let a = i; a >= 0; a = BONE_PARENT[a]) lists[a].push(i);
  }
  return lists.map((l) => Int16Array.from(l.sort((x, y) => x - y)));
})();

/**
 * Forward kinematics of one subtree only (the bone `root` and everything below
 * it), assuming `out` is already current for `root`'s parent. The animator's
 * solves change one limb at a time (a leg's IK, an arm's, the fingers' curl):
 * a full pass after each of them was a quarter of the animation's cost.
 */
export function forwardKinematicsSubtree(out: WorldPose, pose: Pose, rest: RestSkeleton, root: number): WorldPose {
  const { head, tail } = rest;
  const list = SUBTREE[root];
  for (let k = 0; k < list.length; k++) {
    const i = list[k];
    const p = BONE_PARENT[i];
    const q = i * 4;
    if (p < 0) {
      out.pos.set(pose.rootPos, 0);
      mulQuat(out.quat, q, pose.rootQuat, 0, pose.local, q);
    } else {
      const pq = p * 4;
      const ox = head[i * 3] - head[p * 3];
      const oy = head[i * 3 + 1] - head[p * 3 + 1];
      const oz = head[i * 3 + 2] - head[p * 3 + 2];
      rotateInto(out.pos, i * 3, out.quat, pq, ox, oy, oz);
      out.pos[i * 3] += out.pos[p * 3];
      out.pos[i * 3 + 1] += out.pos[p * 3 + 1];
      out.pos[i * 3 + 2] += out.pos[p * 3 + 2];
      mulQuat(out.quat, q, out.quat, pq, pose.local, q);
    }
    const tx = tail[i * 3] - head[i * 3];
    const ty = tail[i * 3 + 1] - head[i * 3 + 1];
    const tz = tail[i * 3 + 2] - head[i * 3 + 2];
    rotateInto(out.tip, i * 3, out.quat, q, tx, ty, tz);
    out.tip[i * 3] += out.pos[i * 3];
    out.tip[i * 3 + 1] += out.pos[i * 3 + 1];
    out.tip[i * 3 + 2] += out.pos[i * 3 + 2];
  }
  return out;
}

/**
 * Move a whole world pose by (dx, dy, dz): what forward kinematics gives after
 * a pure root translation, without redoing it.
 */
export function translateWorld(w: WorldPose, dx: number, dy: number, dz: number): void {
  for (let i = 0; i < BONE_COUNT; i++) {
    w.pos[i * 3] += dx; w.pos[i * 3 + 1] += dy; w.pos[i * 3 + 2] += dz;
    w.tip[i * 3] += dx; w.tip[i * 3 + 1] += dy; w.tip[i * 3 + 2] += dz;
  }
}

/** out[o..o+3] = a[ai..] * b[bi..] (Hamilton product). Safe when out aliases a. */
export function mulQuat(
  out: Float32Array, o: number, a: Float32Array, ai: number, b: Float32Array, bi: number,
): void {
  const ax = a[ai], ay = a[ai + 1], az = a[ai + 2], aw = a[ai + 3];
  const bx = b[bi], by = b[bi + 1], bz = b[bi + 2], bw = b[bi + 3];
  out[o] = aw * bx + ax * bw + ay * bz - az * by;
  out[o + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[o + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** out[o..o+2] = q * v, for the unit quaternion at q[qi..]. */
export function rotateInto(
  out: Float32Array, o: number, q: Float32Array, qi: number, vx: number, vy: number, vz: number,
): void {
  const x = q[qi], y = q[qi + 1], z = q[qi + 2], w = q[qi + 3];
  // v' = v + 2w(u×v) + 2u×(u×v), u = (x,y,z)
  const cx = y * vz - z * vy;
  const cy = z * vx - x * vz;
  const cz = x * vy - y * vx;
  out[o] = vx + 2 * (w * cx + (y * cz - z * cy));
  out[o + 1] = vy + 2 * (w * cy + (z * cx - x * cz));
  out[o + 2] = vz + 2 * (w * cz + (x * cy - y * cx));
}
