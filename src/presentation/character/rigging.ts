/**
 * Skeleton construction and pose application for one fighter.
 *
 * Two `THREE.Skeleton`s share the same 52 bones:
 *  - `skelA` binds meshes authored in MakeHuman's A-pose (body, shorts, mouthguard, eyes, hair):
 *    inverse bind = R_AtoT · translate(-jointA), so the identity pose renders the T-pose;
 *  - `skelT` binds meshes authored directly in the canonical T-pose (gloves): inverse bind =
 *    translate(-jointT), the plain identity-rest convention of `skeleton.ts`.
 */
import * as THREE from 'three/webgpu';
import { BONES, BONE_COUNT, BONE_PARENT, boneIndex, type Pose } from '../rig/skeleton';
import type { BuiltBody } from './body';

export interface Rig {
  root: THREE.Bone;
  bones: THREE.Bone[];
  skelA: THREE.Skeleton;
  skelT: THREE.Skeleton;
}

export function buildRig(body: BuiltBody): Rig {
  const { headT } = body.aToT;
  const bones = BONES.map((name) => {
    const b = new THREE.Bone();
    b.name = name;
    return b;
  });
  for (let i = 0; i < BONE_COUNT; i++) {
    const p = BONE_PARENT[i];
    if (p >= 0) {
      bones[p].add(bones[i]);
      bones[i].position.set(headT[i * 3] - headT[p * 3], headT[i * 3 + 1] - headT[p * 3 + 1], headT[i * 3 + 2] - headT[p * 3 + 2]);
    } else {
      bones[i].position.set(headT[0], headT[1], headT[2]);
    }
  }
  const invA: THREE.Matrix4[] = [];
  const invT: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  for (let i = 0; i < BONE_COUNT; i++) {
    const { rot } = body.aToT;
    q.set(rot[i * 4], rot[i * 4 + 1], rot[i * 4 + 2], rot[i * 4 + 3]);
    const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
    const ja = body.jointsA.head;
    m.multiply(new THREE.Matrix4().makeTranslation(-ja[i * 3], -ja[i * 3 + 1], -ja[i * 3 + 2]));
    invA.push(m);
    invT.push(new THREE.Matrix4().makeTranslation(-headT[i * 3], -headT[i * 3 + 1], -headT[i * 3 + 2]));
  }
  return { root: bones[0], bones, skelA: new THREE.Skeleton(bones, invA), skelT: new THREE.Skeleton(bones, invT) };
}

// ---------------------------------------------------------------------------
// Hands
// ---------------------------------------------------------------------------

const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'] as const;

export interface FingerBones { side: 1 | -1; fingers: number[][]; thumb: number[] }

export const HANDS: readonly FingerBones[] = (['Left', 'Right'] as const).map((s) => ({
  side: s === 'Left' ? 1 : -1,
  fingers: FINGERS.map((f) => [1, 2, 3].map((k) => boneIndex(`${s}Hand${f}${k}`))),
  thumb: [1, 2, 3].map((k) => boneIndex(`${s}HandThumb${k}`)),
})) as FingerBones[];

export const FINGER_BONES: readonly number[] = HANDS.flatMap((h) => [...h.fingers.flat(), ...h.thumb]);

/** How tightly the hands close when the animation leaves the fingers at rest. */
export type HandShape = 'fist' | 'gloveFist' | 'relaxed';

const tmpQ = new THREE.Quaternion();
const axisZ = new THREE.Vector3(0, 0, 1);
const axisX = new THREE.Vector3(1, 0, 0);
const axisY = new THREE.Vector3(0, 1, 0);

/**
 * Local rotations (x, y, z, w per finger bone, in FINGER_BONES order) for a hand shape. In the
 * T-pose the left fingers point +X with the palm down, so curling is a negative rotation about +Z
 * (mirrored for the right hand).
 */
export function handShapeRotations(shape: HandShape): Float32Array {
  const out = new Float32Array(FINGER_BONES.length * 4);
  const curl = shape === 'relaxed' ? [0.25, 0.35, 0.25] : shape === 'gloveFist' ? [1.35, 1.5, 1.0] : [1.45, 1.65, 1.15];
  let k = 0;
  for (const h of HANDS) {
    for (let f = 0; f < 4; f++) {
      for (let seg = 0; seg < 3; seg++) {
        // Outer fingers curl a little more (a real fist rolls toward the pinky).
        const a = curl[seg] * (1 + f * 0.03) * -h.side;
        tmpQ.setFromAxisAngle(axisZ, a);
        out.set([tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w], k * 4);
        k++;
      }
    }
    // Thumb: roll down under the palm (about the hand's long axis), then sweep across the front
    // of the curled index and middle fingers (about the vertical), mirrored for the right hand.
    const relax = shape === 'relaxed' ? 0.3 : 1;
    const roll = [0.75, 0, 0], sweep = [0.45, 0.55, 0.45];
    for (let seg = 0; seg < 3; seg++) {
      const qa = new THREE.Quaternion().setFromAxisAngle(axisX, roll[seg] * relax);
      const qb = new THREE.Quaternion().setFromAxisAngle(axisY, h.side * sweep[seg] * relax);
      const qc = new THREE.Quaternion().setFromAxisAngle(axisZ, -h.side * (seg === 0 ? 0.25 : 0.15) * relax);
      qa.multiply(qb).multiply(qc);
      out.set([qa.x, qa.y, qa.z, qa.w], k * 4);
      k++;
    }
  }
  return out;
}

/** True when every finger bone in the pose is at rest (the animation does not pose fingers). */
export function fingersAtRest(pose: Pose): boolean {
  for (const b of FINGER_BONES) if (pose.local[b * 4 + 3] < 0.99999) return false;
  return true;
}
