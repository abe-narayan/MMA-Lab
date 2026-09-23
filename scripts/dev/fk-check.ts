/** Sanity check: FK of the identity pose reproduces the rest joint positions. */
import { BONES, B, createPose, createWorldPose, defaultRest, forwardKinematics } from '../../src/presentation/rig/skeleton';
const rest = defaultRest();
const pose = createPose();
pose.rootPos.set(rest.head.subarray(0, 3));
const w = forwardKinematics(createWorldPose(), pose, rest);
let maxErr = 0;
for (let i = 0; i < BONES.length; i++) {
  for (let k = 0; k < 3; k++) maxErr = Math.max(maxErr, Math.abs(w.pos[i*3+k] - rest.head[i*3+k]));
}
console.log('bones', BONES.length, 'stature', rest.statureM.toFixed(3), 'max FK error', maxErr.toExponential(2));
const p = (i: number) => `(${[0,1,2].map(k => rest.head[i*3+k].toFixed(3)).join(', ')})`;
console.log('hips', p(B.hips), 'head', p(B.head), 'lHand', p(B.lHand), 'rHand', p(B.rHand), 'lFoot', p(B.lFoot));
// Drop the left arm 70 degrees about +Z and confirm the hand moves down.
const a = -70 * Math.PI / 180;
pose.local.set([0, 0, Math.sin(a/2), Math.cos(a/2)], B.lArm * 4);
forwardKinematics(w, pose, rest);
console.log('after lArm -70deg about Z: lHand', `(${[0,1,2].map(k => w.pos[B.lHand*3+k].toFixed(3)).join(', ')})`);
