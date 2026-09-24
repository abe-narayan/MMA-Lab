/**
 * INVERSE KINEMATICS — shared by every animation layer.
 *
 * Fighting animation is mostly about contact: a jab has to arrive at the
 * opponent's chin on the exact millisecond the sim resolved it, a planted foot
 * must not skate, a grip has to be on the far shoulder. Keyframes get the style
 * right; IK gets the contact right. This module holds the two solvers every
 * layer needs, written once so the standing and grappling animators cannot
 * disagree about how an arm bends.
 *
 * All solvers work under the identity-rest convention of `skeleton.ts`: a bone
 * at rest points from its head to its tail in model space, and a pose stores
 * each bone's rotation relative to its parent.
 */
import {
  B, BONE_PARENT, mulQuat, rotateInto,
  type Pose, type RestSkeleton, type WorldPose,
} from './skeleton';

type V3 = [number, number, number];

/**
 * A two-bone limb. `hinge` is the rest-space axis about which the middle joint
 * flexes, oriented so that anatomical flexion is a POSITIVE rotation about it
 * (right-hand rule). Derived from the T-pose:
 *   left arm lies along +X and flexes toward +Z: axis = X x Z = -Y
 *   right arm lies along -X and flexes toward +Z: axis = -X x Z = +Y
 *   legs lie along -Y and the shin flexes toward -Z: axis = -Y x -Z = +X
 */
export interface LimbChain {
  upper: number;
  lower: number;
  end: number;
  hinge: V3;
}

/**
 * Anatomical flexion limits of the middle joints (radians). The elbow limit is
 * not applied by the standing animator: measured, it made the arm's pole
 * unstable for fists pulled in near the shoulder (hook windups) and doubled the
 * one-frame arm pops; it is here for callers that want it.
 */
export const ELBOW_MAX_FLEX = 150 * Math.PI / 180;
export const KNEE_MAX_FLEX = 160 * Math.PI / 180;

export const LIMBS = Object.freeze({
  lArm: { upper: B.lArm, lower: B.lForeArm, end: B.lHand, hinge: [0, -1, 0] } as LimbChain,
  rArm: { upper: B.rArm, lower: B.rForeArm, end: B.rHand, hinge: [0, 1, 0] } as LimbChain,
  lLeg: { upper: B.lUpLeg, lower: B.lLeg, end: B.lFoot, hinge: [1, 0, 0] } as LimbChain,
  rLeg: { upper: B.rUpLeg, lower: B.rLeg, end: B.rFoot, hinge: [1, 0, 0] } as LimbChain,
});

const tmpQ = new Float32Array(4);
const tmpQ2 = new Float32Array(4);
const tmpV = new Float32Array(3);

/**
 * Solve a two-bone limb so its end joint reaches `target` (world space), with
 * the middle joint bending toward `pole` (world space). Writes the upper and
 * lower bones' local rotations into `pose`.
 *
 * `world` must hold a forward-kinematics result for `pose` that is current for
 * the upper bone's parent (call `forwardKinematics` first; re-run it after if
 * later code needs this limb's world positions).
 *
 * `weight` blends from the pose's existing rotations (0) to the solution (1),
 * so IK can fade in over a strike's startup and out over its recovery.
 *
 * `maxFlex` (radians, optional) is the joint limit of the middle joint: a
 * target closer to the root than that flexion allows is met at the limit, on
 * the line toward it (an elbow folds to ~150°, a knee to ~160°; without the
 * limit a hand pulled in to the shoulder folded the forearm flat onto the
 * upper arm). Omitted: only the geometric limit (the grappling solver's grips).
 *
 * Returns how far short of the target the limb fell, in metres (0 when the
 * target was reachable). A strike that falls short is a strike that missed on
 * range, and the caller may want to lean the torso to close the gap.
 */
export function solveTwoBone(
  pose: Pose, world: WorldPose, rest: RestSkeleton, chain: LimbChain,
  target: V3, pole: V3, weight = 1, maxFlex = Math.PI,
): number {
  const { upper, lower, end } = chain;
  const parent = BONE_PARENT[upper];

  // Rest geometry of the limb.
  const d1 = restDir(rest, upper, lower);
  const d2 = restDir(rest, lower, end);
  const L1 = dist(rest.head, upper, rest.head, lower);
  const L2 = dist(rest.head, lower, rest.head, end);
  const hRest = orthonormalHinge(chain.hinge, d1);

  // World position of the shoulder / hip joint.
  const A: V3 = [world.pos[upper * 3], world.pos[upper * 3 + 1], world.pos[upper * 3 + 2]];
  let vx = target[0] - A[0], vy = target[1] - A[1], vz = target[2] - A[2];
  const reachRaw = Math.hypot(vx, vy, vz);
  const maxReach = (L1 + L2) * 0.9995;
  const minReach = Math.abs(L1 - L2) * 1.001 + 1e-4;
  const reach = Math.min(maxReach, Math.max(minReach, reachRaw));
  const shortfall = Math.max(0, reachRaw - maxReach);
  const inv = reachRaw > 1e-6 ? 1 / reachRaw : 0;
  vx *= inv; vy *= inv; vz *= inv;
  if (reachRaw <= 1e-6) { vx = d1[0]; vy = d1[1]; vz = d1[2]; }

  // Direction from the shoulder toward the pole, orthogonal to the reach line.
  let px = pole[0] - A[0], py = pole[1] - A[1], pz = pole[2] - A[2];
  const pd = px * vx + py * vy + pz * vz;
  px -= pd * vx; py -= pd * vy; pz -= pd * vz;
  let pn = Math.hypot(px, py, pz);
  if (pn < 1e-6) {
    // Pole on the reach line: bend in whatever plane the rest hinge implies.
    const alt = cross([vx, vy, vz], rotateByParent(world, parent, hRest));
    px = alt[0]; py = alt[1]; pz = alt[2];
    pn = Math.hypot(px, py, pz) || 1;
  }
  px /= pn; py /= pn; pz /= pn;

  // Law of cosines: angle at the shoulder.
  const cosA = clamp((L1 * L1 + reach * reach - L2 * L2) / (2 * L1 * reach), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const E: V3 = [
    A[0] + (vx * cosA + px * sinA) * L1,
    A[1] + (vy * cosA + py * sinA) * L1,
    A[2] + (vz * cosA + pz * sinA) * L1,
  ];
  const T: V3 = [A[0] + vx * reach, A[1] + vy * reach, A[2] + vz * reach];
  const eDir = normalize([E[0] - A[0], E[1] - A[1], E[2] - A[2]]);
  let fDir = normalize([T[0] - E[0], T[1] - E[1], T[2] - E[2]]);

  // Flexion axis in world space: rotating eDir toward fDir is flexion.
  let h = cross(eDir, fDir);
  if (Math.hypot(h[0], h[1], h[2]) < 1e-6) h = cross(eDir, [px, py, pz]);
  h = normalize(h);
  // Joint limit: the lower bone opens back to \`maxFlex\` about the same hinge
  // (the upper bone stays as solved, so a target pulled in to the shoulder
  // leaves the hand a little short instead of swinging the arm around).
  if (maxFlex < Math.PI && eDir[0] * fDir[0] + eDir[1] * fDir[1] + eDir[2] * fDir[2] < Math.cos(maxFlex)) {
    const hx = cross(h, eDir);
    const c = Math.cos(maxFlex), sn = Math.sin(maxFlex);
    fDir = normalize([eDir[0] * c + hx[0] * sn, eDir[1] * c + hx[1] * sn, eDir[2] * c + hx[2] * sn]);
  }

  // World rotations that carry the rest frames (d, hRest) onto (dir, h).
  const Qu = frameToFrame(d1, hRest, eDir, h);
  const hRest2 = orthonormalHinge(chain.hinge, d2);
  const Ql = frameToFrame(d2, hRest2, fDir, h);

  // Convert to local rotations and blend by weight.
  const parentQ = parent >= 0 ? world.quat.subarray(parent * 4, parent * 4 + 4) : IDENTITY;
  conjugateInto(tmpQ, parentQ);
  mulQuat(tmpQ2, 0, tmpQ, 0, Qu, 0);
  writeLocal(pose, upper, tmpQ2, weight);
  conjugateInto(tmpQ, Qu);
  mulQuat(tmpQ2, 0, tmpQ, 0, Ql, 0);
  writeLocal(pose, lower, tmpQ2, weight);
  return shortfall;
}

/**
 * Rotate one bone so its rest direction points along `dirWorld`. Used for the
 * head (look at the opponent), the neck and the spine segments. `weight`
 * blends from the current local rotation.
 */
export function aimBone(
  pose: Pose, world: WorldPose, rest: RestSkeleton, bone: number, child: number,
  dirWorld: V3, weight = 1,
): void {
  const parent = BONE_PARENT[bone];
  const d = restDir(rest, bone, child);
  const want = normalize(dirWorld);
  const q = fromTo(d, want);
  const parentQ = parent >= 0 ? world.quat.subarray(parent * 4, parent * 4 + 4) : IDENTITY;
  conjugateInto(tmpQ, parentQ);
  mulQuat(tmpQ2, 0, tmpQ, 0, q, 0);
  writeLocal(pose, bone, tmpQ2, weight);
}

// ---------------------------------------------------------------------------
// Quaternion helpers (exported for the animators)
// ---------------------------------------------------------------------------

export const IDENTITY = new Float32Array([0, 0, 0, 1]);

/** Quaternion rotating unit vector `a` onto unit vector `b` by the shortest arc. */
export function fromTo(a: V3, b: V3): Float32Array {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d < -0.999999) {
    // Opposite: rotate 180 degrees about any axis perpendicular to a.
    let ax = cross([1, 0, 0], a);
    if (Math.hypot(ax[0], ax[1], ax[2]) < 1e-6) ax = cross([0, 1, 0], a);
    ax = normalize(ax);
    return new Float32Array([ax[0], ax[1], ax[2], 0]);
  }
  const c = cross(a, b);
  const q = new Float32Array([c[0], c[1], c[2], 1 + d]);
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  q[0] /= n; q[1] /= n; q[2] /= n; q[3] /= n;
  return q;
}

/** Quaternion for a rotation of `angle` radians about unit `axis`. */
export function axisAngle(axis: V3, angle: number): Float32Array {
  const s = Math.sin(angle / 2);
  return new Float32Array([axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)]);
}

/**
 * The rotation that maps the orthonormal pair (d0, h0) onto (d1, h1): built
 * from the two frames [d, h, d x h]. Deterministic and twist-correct, which a
 * bare from-to rotation is not.
 */
export function frameToFrame(d0: V3, h0: V3, d1: V3, h1: V3): Float32Array {
  const s0 = cross(d0, h0);
  const s1 = cross(d1, h1);
  // R = F1 * F0^T, where F = [d h s] as columns.
  const m00 = d1[0] * d0[0] + h1[0] * h0[0] + s1[0] * s0[0];
  const m01 = d1[0] * d0[1] + h1[0] * h0[1] + s1[0] * s0[1];
  const m02 = d1[0] * d0[2] + h1[0] * h0[2] + s1[0] * s0[2];
  const m10 = d1[1] * d0[0] + h1[1] * h0[0] + s1[1] * s0[0];
  const m11 = d1[1] * d0[1] + h1[1] * h0[1] + s1[1] * s0[1];
  const m12 = d1[1] * d0[2] + h1[1] * h0[2] + s1[1] * s0[2];
  const m20 = d1[2] * d0[0] + h1[2] * h0[0] + s1[2] * s0[0];
  const m21 = d1[2] * d0[1] + h1[2] * h0[1] + s1[2] * s0[1];
  const m22 = d1[2] * d0[2] + h1[2] * h0[2] + s1[2] * s0[2];
  return matToQuat(m00, m01, m02, m10, m11, m12, m20, m21, m22);
}

function matToQuat(
  m00: number, m01: number, m02: number,
  m10: number, m11: number, m12: number,
  m20: number, m21: number, m22: number,
): Float32Array {
  const q = new Float32Array(4);
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    q[3] = 0.25 / s; q[0] = (m21 - m12) * s; q[1] = (m02 - m20) * s; q[2] = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q[3] = (m21 - m12) / s; q[0] = 0.25 * s; q[1] = (m01 + m10) / s; q[2] = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q[3] = (m02 - m20) / s; q[0] = (m01 + m10) / s; q[1] = 0.25 * s; q[2] = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q[3] = (m10 - m01) / s; q[0] = (m02 + m20) / s; q[1] = (m12 + m21) / s; q[2] = 0.25 * s;
  }
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  q[0] /= n; q[1] /= n; q[2] /= n; q[3] /= n;
  return q;
}

export function conjugateInto(out: Float32Array, q: ArrayLike<number>): void {
  out[0] = -q[0]; out[1] = -q[1]; out[2] = -q[2]; out[3] = q[3];
}

function writeLocal(pose: Pose, bone: number, q: Float32Array, weight: number): void {
  const o = bone * 4;
  if (weight >= 1) {
    pose.local[o] = q[0]; pose.local[o + 1] = q[1]; pose.local[o + 2] = q[2]; pose.local[o + 3] = q[3];
    return;
  }
  if (weight <= 0) return;
  // nlerp from the existing rotation, shortest arc.
  let x = q[0], y = q[1], z = q[2], w = q[3];
  const ax = pose.local[o], ay = pose.local[o + 1], az = pose.local[o + 2], aw = pose.local[o + 3];
  if (ax * x + ay * y + az * z + aw * w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const rx = ax + (x - ax) * weight, ry = ay + (y - ay) * weight;
  const rz = az + (z - az) * weight, rw = aw + (w - aw) * weight;
  const n = Math.hypot(rx, ry, rz, rw) || 1;
  pose.local[o] = rx / n; pose.local[o + 1] = ry / n; pose.local[o + 2] = rz / n; pose.local[o + 3] = rw / n;
}

function restDir(rest: RestSkeleton, from: number, to: number): V3 {
  return normalize([
    rest.head[to * 3] - rest.head[from * 3],
    rest.head[to * 3 + 1] - rest.head[from * 3 + 1],
    rest.head[to * 3 + 2] - rest.head[from * 3 + 2],
  ]);
}

function orthonormalHinge(hinge: V3, d: V3): V3 {
  const k = hinge[0] * d[0] + hinge[1] * d[1] + hinge[2] * d[2];
  return normalize([hinge[0] - k * d[0], hinge[1] - k * d[1], hinge[2] - k * d[2]]);
}

function rotateByParent(world: WorldPose, parent: number, v: V3): V3 {
  if (parent < 0) return v;
  rotateInto(tmpV, 0, world.quat, parent * 4, v[0], v[1], v[2]);
  return [tmpV[0], tmpV[1], tmpV[2]];
}

function dist(a: Float32Array, i: number, b: Float32Array, j: number): number {
  return Math.hypot(a[i * 3] - b[j * 3], a[i * 3 + 1] - b[j * 3 + 1], a[i * 3 + 2] - b[j * 3 + 2]);
}

function cross(a: ArrayLike<number>, b: ArrayLike<number>): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: V3): V3 {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
