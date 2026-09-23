/**
 * Retarget a parsed mocap `Source` (see mocap-lib.mjs) onto the canonical
 * 52-bone skeleton's 22 body bones (src/presentation/rig/skeleton.ts).
 *
 * Canonical convention: three.js axes (Y up, the character faces +Z, its left
 * is +X, metres); every bone's rest rotation is identity and the rest pose is
 * MPFB's T-pose, so a bone's world rotation IS its rotation away from the
 * T-pose, and a Pose local is that relative to the parent.
 *
 * Method (rotation retargeting with a per-bone offset):
 *
 *   target_world[b](f) = G · source_world[s(b)](f) · C[b]
 *
 *   G     yaw that turns the capture volume's "opponent" direction to +Z;
 *   C[b]  constant per bone, found from one calibration pose (a neutral stance)
 *         in which each target bone is the T-pose bone swung onto the source
 *         bone's direction (torso bones also match the hip/shoulder line);
 *         then the upper-arm and thigh twist in C is corrected so that the
 *         source's measured elbow/knee hinge axis maps onto the canonical
 *         anatomical hinge (elbows flex forward, knees flex backward). This is
 *         what keeps elbows and knees from bending sideways or inverting.
 *
 * Root: placed so the canonical hip joints sit on the source hip joints, scaled
 * by the leg-length ratio; vertical is mapped so the source's standing ankle
 * height becomes the canonical one.
 * Legs: a two-bone IK pass puts each canonical ankle exactly on the scaled
 * source ankle trajectory, so foot plants and floor contact survive the
 * proportion change. Foot and toe keep their captured world orientation.
 */
import {
  jointIndex, qaxis, qconj, qfromFrames, qfromTo, qmul, qnorm, qrot, sourceFK,
  vadd, vcross, vdot, vlen, vnorm, vscale, vsub,
} from './mocap-lib.mjs';

/** The bones mocap drives, in canonical (parent-before-child) order. Fingers are not captured. */
export const BODY_BONES = [
  'Hips', 'LeftUpLeg', 'RightUpLeg', 'Spine', 'Spine1', 'Spine2', 'LeftLeg', 'LeftShoulder', 'Neck',
  'RightLeg', 'RightShoulder', 'Head', 'LeftArm', 'LeftFoot', 'LeftForeArm', 'LeftHand', 'LeftToeBase',
  'RightArm', 'RightFoot', 'RightForeArm', 'RightHand', 'RightToeBase',
];

/** Parse `RIG_BONES` out of the generated rigData.ts text. */
export function parseRigData(tsText) {
  const s = tsText.indexOf('export const RIG_BONES');
  const a = tsText.indexOf('[', tsText.indexOf('=', s));
  const e = tsText.lastIndexOf('];');
  return JSON.parse(tsText.slice(a, e + 1));
}

/** Body-bone rest data with parent indices into BODY_BONES and each bone's canonical index. */
export function canonicalBody(rigBones) {
  const byName = new Map(rigBones.map((b, i) => [b.name, i]));
  const bones = BODY_BONES.map((n) => {
    const ci = byName.get(n);
    if (ci === undefined) throw new Error(`canonical bone ${n} missing`);
    const b = rigBones[ci];
    const pName = b.parent >= 0 ? rigBones[b.parent].name : null;
    const parent = pName ? BODY_BONES.indexOf(pName) : -1;
    if (pName && parent < 0) throw new Error(`parent of ${n} is not a body bone`);
    return { name: n, canonicalIndex: ci, parent, head: b.head, tail: b.tail };
  });
  const I = Object.fromEntries(bones.map((b, i) => [b.name, i]));
  return { bones, I };
}

const UP = [0, 1, 0];

/** Yaw (radians, the sim's atan2(x, z)) of the forward direction implied by a right→left hip vector. */
export function facingFromHips(lr) {
  const f = vcross(lr, UP); // left × up = forward (right-handed, Y up)
  return Math.atan2(f[0], f[2]);
}

function projectPerp(v, axis) {
  const a = vnorm(axis);
  return vnorm(vsub(v, vscale(a, vdot(v, a))));
}

/** Anatomical hinge axis in the canonical (identity-rest) frame of the parent bone. */
export function hingeAxis(kind, dParent) {
  // left elbow: upper arm +X, flexion brings the forearm forward (+Z): X × Z = -Y
  if (kind === 'elbowL') return projectPerp([0, -1, 0], dParent);
  if (kind === 'elbowR') return projectPerp([0, 1, 0], dParent);
  // knee: thigh -Y, flexion brings the shin back (-Z): (-Y) × (-Z) = +X
  return projectPerp([1, 0, 0], dParent);
}

export const HINGES = [
  ['LeftArm', 'LeftForeArm', 'elbowL'], ['RightArm', 'RightForeArm', 'elbowR'],
  ['LeftUpLeg', 'LeftLeg', 'knee'], ['RightUpLeg', 'RightLeg', 'knee'],
];

const P = (fk, j) => [fk.pos[j * 3], fk.pos[j * 3 + 1], fk.pos[j * 3 + 2]];
const W = (fk, j) => [fk.rot[j * 4], fk.rot[j * 4 + 1], fk.rot[j * 4 + 2], fk.rot[j * 4 + 3]];

/**
 * profile = {
 *   map:   { canonicalName: sourceJointName }  (unmapped bones keep their parent's rotation)
 *   dirTo: { canonicalName: sourceJointName }  (optional: the source joint a bone points at)
 *   hipL, hipR, shoulderL, shoulderR, ankleL, ankleR: source joint names
 * }
 * calib = { src, frame } — a neutral standing pose (only bone directions are trusted).
 * hingeSamples = [{ src, frames }] — motion used to measure the elbow/knee hinge axes.
 */
export function makeRetargeter(body, profile, calib, hingeSamples) {
  const { bones, I } = body;
  const B = bones.length;
  const sk = calib.src;
  const sIdx = bones.map((b) => (profile.map[b.name] ? jointIndex(sk, profile.map[b.name]) : -1));
  const restDir = bones.map((b) => vnorm(vsub(b.tail, b.head)));
  const dirTarget = bones.map((b, i) => {
    if (profile.dirTo?.[b.name]) return { joint: profile.dirTo[b.name] };
    const c = bones.findIndex((k, ci) => k.parent === i && vlen(vsub(k.head, b.tail)) < 1e-3 && sIdx[ci] >= 0);
    return c >= 0 ? { joint: profile.map[bones[c].name] } : { tip: true };
  });
  const srcDir = (src, fk, i) => {
    const s = jointIndex(src, profile.map[bones[i].name]);
    const d = dirTarget[i];
    if (d.joint) return vsub(P(fk, jointIndex(src, d.joint)), P(fk, s));
    return qrot(W(fk, s), src.joints[s].tip);
  };
  const hipLR = (src, fk) => vsub(P(fk, jointIndex(src, profile.hipL)), P(fk, jointIndex(src, profile.hipR)));
  const shLR = (src, fk) => vsub(P(fk, jointIndex(src, profile.shoulderL)), P(fk, jointIndex(src, profile.shoulderR)));
  const restHipLR = vsub(bones[I.LeftUpLeg].head, bones[I.RightUpLeg].head);
  const restShLR = vsub(bones[I.LeftArm].head, bones[I.RightArm].head);
  const secondary = { Hips: 'hip', Spine: 'hip', Spine1: 'sh', Spine2: 'sh', Neck: 'sh', Head: 'sh' };

  // --- calibration
  const fk0 = sourceFK(sk, calib.frame);
  const yaw0 = facingFromHips(hipLR(sk, fk0));
  const G0 = qaxis(UP, -yaw0);
  const C = bones.map(() => [0, 0, 0, 1]);
  for (let i = 0; i < B; i++) {
    const s = sIdx[i];
    if (s < 0) continue;
    const dS = qrot(G0, srcDir(sk, fk0, i));
    if (vlen(dS) < 1e-4) throw new Error(`retarget: ${bones[i].name} has no direction in the source rest pose (fix profile.dirTo)`);
    const sec = secondary[bones[i].name];
    const Rt = sec
      ? qfromFrames(restDir[i], sec === 'hip' ? restHipLR : restShLR, dS, qrot(G0, sec === 'hip' ? hipLR(sk, fk0) : shLR(sk, fk0)))
      : qfromTo(restDir[i], dS);
    C[i] = qnorm(qmul(qmul(qconj(W(fk0, s)), qconj(G0)), Rt));
  }

  // --- hinge twist correction
  const hingeReport = {};
  for (const [pn, cn, kind] of HINGES) {
    const p = I[pn], c = I[cn];
    if (sIdx[p] < 0 || sIdx[c] < 0) continue;
    const dP = restDir[p];
    const want = hingeAxis(kind, dP);
    const acc = [0, 0, 0];
    let n = 0;
    for (const hs of hingeSamples) {
      const J = hs.src.joints.length;
      const pos = new Float64Array(J * 3), rot = new Float64Array(J * 4);
      const sp = jointIndex(hs.src, profile.map[pn]), sc = jointIndex(hs.src, profile.map[cn]);
      for (const f of hs.frames) {
        const fk = sourceFK(hs.src, f, pos, rot);
        const L = qmul(qconj(qmul(W(fk, sp), C[p])), qmul(W(fk, sc), C[c]));
        const u = vnorm(qrot(L, restDir[c]));
        const bend = Math.acos(Math.max(-1, Math.min(1, vdot(dP, u))));
        if (bend < 0.5) continue; // only clearly bent frames define the hinge
        const a = vnorm(vcross(dP, u));
        acc[0] += a[0] * bend; acc[1] += a[1] * bend; acc[2] += a[2] * bend;
        n++;
      }
    }
    if (n < 10) continue;
    const mean = projectPerp(acc, dP), tgt = projectPerp(want, dP);
    const th = Math.atan2(vdot(vcross(tgt, mean), dP), vdot(tgt, mean));
    C[p] = qnorm(qmul(C[p], qaxis(dP, th)));
    hingeReport[pn] = { samples: n, twistDeg: Math.round(th * 1800 / Math.PI) / 10 };
  }

  // --- scale: canonical leg length / source leg length
  const len = (a, b) => vlen(vsub(bones[I[b]].head, bones[I[a]].head));
  const tgtLeg = len('LeftUpLeg', 'LeftLeg') + len('LeftLeg', 'LeftFoot');
  const srcLeg = vlen(vsub(P(fk0, jointIndex(sk, profile.map.LeftLeg)), P(fk0, jointIndex(sk, profile.map.LeftUpLeg))))
    + vlen(vsub(P(fk0, jointIndex(sk, profile.ankleL)), P(fk0, jointIndex(sk, profile.map.LeftLeg))));
  const scale = tgtLeg / srcLeg;
  return { body, profile, C, scale, hingeReport, calibYaw: yaw0 };
}

/**
 * Retarget frames [f0, f1) of a source take.
 * opts: { yaw: source yaw (atan2(x, z)) that becomes +Z,
 *         origin: [x, z] source floor point that becomes (0, 0),
 *         floorY: source ankle height when standing (becomes the canonical ankle height),
 *         floorRef: 'ankle' (default) | 'ball' — which part floorY measures,
 *         footIK: default true }
 * Returns { frames, rootPos: Float64Array(F*3), world: Float64Array(F*B*4) } in canonical space.
 */
export function retargetFrames(rt, src, f0, f1, opts) {
  const { body, C, scale, profile } = rt;
  const { bones, I } = body;
  const B = bones.length;
  const F = f1 - f0;
  const G = qaxis(UP, -opts.yaw);
  const rootPos = new Float64Array(F * 3);
  const world = new Float64Array(F * B * 4);
  const J = src.joints.length;
  const pos = new Float64Array(J * 3), rot = new Float64Array(J * 4);
  const srcIdx = bones.map((b) => (profile.map[b.name] ? jointIndex(src, profile.map[b.name]) : -1));
  const aL = jointIndex(src, profile.ankleL), aR = jointIndex(src, profile.ankleR);
  const hL = jointIndex(src, profile.hipL), hR = jointIndex(src, profile.hipR);
  const hipMidOffset = vsub(vscale(vadd(bones[I.LeftUpLeg].head, bones[I.RightUpLeg].head), 0.5), bones[I.Hips].head);
  // opts.floorY is the source height of the ankle (default) or of the ball of the
  // foot (floorRef: 'ball') when that part rests on the floor
  const restRefY = opts.floorRef === 'ball' ? bones[I.LeftToeBase].head[1] : bones[I.LeftFoot].head[1];
  const mapPoint = (p) => {
    const q = qrot(G, [p[0] - opts.origin[0], 0, p[2] - opts.origin[1]]);
    return [q[0] * scale, (p[1] - opts.floorY) * scale + restRefY, q[2] * scale];
  };
  const Rt = bones.map(() => [0, 0, 0, 1]);
  for (let k = 0; k < F; k++) {
    sourceFK(src, f0 + k, pos, rot);
    for (let i = 0; i < B; i++) {
      const s = srcIdx[i];
      if (s >= 0) Rt[i] = qnorm(qmul(qmul(G, [rot[s * 4], rot[s * 4 + 1], rot[s * 4 + 2], rot[s * 4 + 3]]), C[i]));
      else Rt[i] = Rt[bones[i].parent].slice();
    }
    // Place the canonical hips so its hip joints sit where the scaled source hip
    // joints are (the root joint itself is at a different height above the hip
    // joints in every skeleton; matching it would leave the legs short or long).
    const hm = mapPoint([(pos[hL * 3] + pos[hR * 3]) / 2, (pos[hL * 3 + 1] + pos[hR * 3 + 1]) / 2, (pos[hL * 3 + 2] + pos[hR * 3 + 2]) / 2]);
    const off = qrot(Rt[I.Hips], hipMidOffset);
    const root = [hm[0] - off[0], hm[1] - off[1], hm[2] - off[2]];
    rootPos.set(root, k * 3);
    if (opts.footIK !== false) {
      solveLeg(body, Rt, root, 'Left', mapPoint([pos[aL * 3], pos[aL * 3 + 1], pos[aL * 3 + 2]]));
      solveLeg(body, Rt, root, 'Right', mapPoint([pos[aR * 3], pos[aR * 3 + 1], pos[aR * 3 + 2]]));
    }
    for (let i = 0; i < B; i++) world.set(Rt[i], (k * B + i) * 4);
  }
  return { frames: F, rootPos, world };
}

/** Canonical FK from world rotations: joint positions and bone tips (B*3 each). */
export function bodyFK(body, root, Rt, out) {
  const { bones } = body;
  out ??= { pos: new Float64Array(bones.length * 3), tip: new Float64Array(bones.length * 3) };
  for (let i = 0; i < bones.length; i++) {
    const b = bones[i];
    let p;
    if (b.parent < 0) p = [root[0], root[1], root[2]];
    else {
      const pp = [out.pos[b.parent * 3], out.pos[b.parent * 3 + 1], out.pos[b.parent * 3 + 2]];
      p = vadd(pp, qrot(Rt[b.parent], vsub(b.head, bones[b.parent].head)));
    }
    out.pos.set(p, i * 3);
    out.tip.set(vadd(p, qrot(Rt[i], vsub(b.tail, b.head))), i * 3);
  }
  return out;
}

/**
 * Two-bone leg IK on world rotations. The knee is a hinge: the shin is placed
 * in the plane through the thigh perpendicular to the thigh's hinge axis (its
 * +X), flexed by exactly the angle that makes hip→ankle the target distance
 * (so it can never bend backwards), then the whole leg is swung onto the
 * target. The foot and toe keep their captured world orientation.
 */
export function solveLeg(body, Rt, root, side, target) {
  const { bones, I } = body;
  const u = I[`${side}UpLeg`], k = I[`${side}Leg`], a = I[`${side}Foot`];
  const hp = vadd(root, qrot(Rt[I.Hips], vsub(bones[u].head, bones[I.Hips].head)));
  const off1 = vsub(bones[k].head, bones[u].head), off2 = vsub(bones[a].head, bones[k].head);
  const l1 = vlen(off1), l2 = vlen(off2);
  const kp = vadd(hp, qrot(Rt[u], off1));
  const t = vnorm(vsub(kp, hp));
  const n = projectPerp(qrot(Rt[u], [1, 0, 0]), t);
  const d = Math.min(Math.max(vlen(vsub(target, hp)), Math.abs(l1 - l2) + 1e-4), (l1 + l2) * 0.9995);
  const interior = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2))));
  const flex = Math.PI - interior;
  // flexion about +X carries the shin from the thigh direction towards the back
  const shinWant = qrot(qaxis(n, flex), t);
  const shinNow = vnorm(qrot(Rt[k], off2));
  Rt[k] = qnorm(qmul(qfromTo(shinNow, shinWant), Rt[k]));
  const ap = vadd(kp, qrot(Rt[k], off2));
  const Q = qfromTo(vsub(ap, hp), vsub(target, hp));
  Rt[u] = qnorm(qmul(Q, Rt[u]));
  Rt[k] = qnorm(qmul(Q, Rt[k]));
}

/** World rotations → parent-relative locals. Hips' local is identity; its world rotation is the root quat. */
export function worldToLocal(body, world, frames) {
  const { bones } = body;
  const B = bones.length;
  const rootQuat = new Float64Array(frames * 4);
  const local = new Float64Array(frames * B * 4);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < B; i++) {
      const o = (f * B + i) * 4;
      const w = [world[o], world[o + 1], world[o + 2], world[o + 3]];
      let l;
      if (bones[i].parent < 0) { rootQuat.set(w, f * 4); l = [0, 0, 0, 1]; } else {
        const po = (f * B + bones[i].parent) * 4;
        l = qnorm(qmul(qconj([world[po], world[po + 1], world[po + 2], world[po + 3]]), w));
      }
      if (l[3] < 0) l = [-l[0], -l[1], -l[2], -l[3]];
      local.set(l, (f * B + i) * 4);
    }
    const r = rootQuat.subarray(f * 4, f * 4 + 4);
    if (f > 0) {
      const a = rootQuat.subarray((f - 1) * 4, f * 4);
      if (a[0] * r[0] + a[1] * r[1] + a[2] * r[2] + a[3] * r[3] < 0) for (let k = 0; k < 4; k++) r[k] = -r[k];
    } else if (r[3] < 0) for (let k = 0; k < 4; k++) r[k] = -r[k];
  }
  return { rootQuat, local };
}

/** Locals → world rotations for frame f. */
export function localToWorld(body, rootQuat, local, f, Rt) {
  const { bones } = body;
  const B = bones.length;
  Rt ??= bones.map(() => [0, 0, 0, 1]);
  for (let i = 0; i < B; i++) {
    const o = (f * B + i) * 4;
    const l = [local[o], local[o + 1], local[o + 2], local[o + 3]];
    Rt[i] = bones[i].parent < 0
      ? qnorm(qmul([rootQuat[f * 4], rootQuat[f * 4 + 1], rootQuat[f * 4 + 2], rootQuat[f * 4 + 3]], l))
      : qnorm(qmul(Rt[bones[i].parent], l));
  }
  return Rt;
}

// ---------------------------------------------------------------------------
// Mirroring (left ↔ right across the sagittal plane, X → -X)
// ---------------------------------------------------------------------------

export function mirrorName(n) {
  if (n.startsWith('Left')) return 'Right' + n.slice(4);
  if (n.startsWith('Right')) return 'Left' + n.slice(5);
  return n;
}
/** Reflect a rotation through the YZ plane: (x, y, z, w) → (x, -y, -z, w). */
export const mirrorQuat = (q) => [q[0], -q[1], -q[2], q[3]];

/** Signed hinge flexion (radians) of child relative to parent: positive = anatomical flexion. */
export function hingeFlexion(body, Rt, parentName, childName, kind) {
  const { bones, I } = body;
  const p = I[parentName], c = I[childName];
  const dP = vnorm(vsub(bones[p].tail, bones[p].head));
  const dC = vnorm(vsub(bones[c].tail, bones[c].head));
  const L = qmul(qconj(Rt[p]), Rt[c]);
  const u = vnorm(qrot(L, dC));
  const axis = hingeAxis(kind, dP);
  const bend = Math.acos(Math.max(-1, Math.min(1, vdot(dP, u))));
  const s = vdot(vcross(dP, u), axis);
  return s >= 0 ? bend : -bend;
}
