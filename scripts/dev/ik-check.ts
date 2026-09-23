/** Sanity check: two-bone IK reaches targets and bends the right way. */
import { B, createPose, createWorldPose, defaultRest, forwardKinematics } from '../../src/presentation/rig/skeleton';
import { LIMBS, solveTwoBone } from '../../src/presentation/rig/ik';
const rest = defaultRest();
const pose = createPose();
pose.rootPos.set(rest.head.subarray(0, 3));
const w = createWorldPose();
const at = (i: number) => [0,1,2].map(k => +w.pos[i*3+k].toFixed(3));
function check(name: string, chain: any, target: [number,number,number], pole: [number,number,number], mid: number, end: number) {
  forwardKinematics(w, pose, rest);
  const short = solveTwoBone(pose, w, rest, chain, target, pole);
  forwardKinematics(w, pose, rest);
  const e = at(end), m = at(mid);
  const err = Math.hypot(e[0]-target[0], e[1]-target[1], e[2]-target[2]);
  console.log(`${name.padEnd(28)} end ${JSON.stringify(e)} err ${err.toFixed(4)} short ${short.toFixed(3)} mid ${JSON.stringify(m)}`);
}
// Left jab-ish: hand forward of the chin, elbow down and out.
check('lArm forward (jab guard)', LIMBS.lArm, [0.12, 1.45, 0.35], [0.4, 0.9, 0.0], B.lForeArm, B.lHand);
// Right hand at the chin (guard): elbow should point down/back.
check('rArm to chin', LIMBS.rArm, [-0.08, 1.5, 0.18], [-0.3, 1.0, -0.1], B.rForeArm, B.rHand);
// Left foot planted forward, knee bent forward.
check('lLeg planted forward', LIMBS.lLeg, [0.12, 0.08, 0.30], [0.12, 0.5, 1.0], B.lLeg, B.lFoot);
// Unreachable target: reports shortfall.
check('rArm out of reach', LIMBS.rArm, [-0.2, 1.4, 1.6], [-0.3, 1.0, 0.0], B.rForeArm, B.rHand);
