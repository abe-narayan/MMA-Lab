/**
 * GROUND-AND-POUND — a strike layered on the solved pair.
 *
 * The striker postures up and turns into the shot; the striking hand travels
 * base → cocked (above and behind the own shoulder) → the partner's face at
 * the recorded contact instant → back. Punches drive straight down the line,
 * hammerfists come from higher and land vertically, elbows slice across. The
 * receiver covers: forearms up in front of the face around the contact.
 */
import { B, forwardKinematics } from '../../rig/skeleton';
import { LIMBS, solveTwoBone } from '../../rig/ik';
import type { PairRequest } from './request';
import { sampleSocket, restScale } from './sockets';
import type { SolveBuffers } from './solve';
import {
  add, clamp, getQ, getV3, lerp3, madd, norm, qAxis, qConj, qMul, qRot, scale, setQ, smooth, sub, type V3,
} from './math';

export function applyStrike(req: PairRequest, b: SolveBuffers): void {
  const s = req.strike;
  if (!s) return;
  const who = s.who === 'a' ? 0 : 1;
  const tgt = (1 - who) as 0 | 1;
  const pose = b.poses[who];
  const world = b.worlds[who];
  const rest = b.rests[who];
  const sc = restScale(rest);
  const p = clamp(s.phase, 0, 1);
  const c = clamp(s.contactAt, 0.2, 0.9);
  const left = s.side === 'L';
  const chain = left ? LIMBS.lArm : LIMBS.rArm;
  const kind = s.technique.includes('hammer') ? 'hammer' : s.technique.includes('elbow') ? 'elbow' : 'punch';

  // Envelope: 0 at rest, 1 at contact.
  const env = p < c ? smooth(p / c) : 1 - smooth((p - c) / (1 - c));

  // ---- torso: posture up and turn into the strike ------------------------------
  const twist = (left ? -1 : 1) * 16 * env * (p < c ? smooth((p / c - 0.4) / 0.6) * 2 - 1 : 1);
  const lift = -10 * env;
  const q = qMul(qAxis([0, 1, 0], (twist * Math.PI) / 180), qAxis([1, 0, 0], (lift * Math.PI) / 180));
  setQ(pose.local, B.spine1, qMul(getQ(pose.local, B.spine1), q));
  forwardKinematics(world, pose, rest);

  // ---- hand path --------------------------------------------------------------
  const face = sampleSocket('face', b.worlds[tgt], b.rests[tgt]);
  const sh = getV3(world.pos, chain.upper);
  const w0 = getV3(world.pos, chain.end);
  const chestQ = getQ(world.quat, B.spine2);
  const upW: V3 = [0, 1, 0];
  const toT = norm(sub(face.p, sh));
  const outW = qRot(chestQ, [left ? 1 : -1, 0, 0]);
  let cock: V3;
  let hit: V3;
  if (kind === 'hammer') {
    cock = add(add(sh, scale(upW, 0.42 * sc)), scale(outW, 0.08 * sc));
    hit = add(face.p, [0, 0.07 * sc, 0]);
  } else if (kind === 'elbow') {
    cock = add(add(sh, scale(upW, 0.3 * sc)), scale(outW, 0.22 * sc));
    // Slice across the face: the hand finishes past it on the far side.
    hit = add(add(face.p, scale(outW, -0.2 * sc)), [0, 0.1 * sc, 0]);
  } else {
    cock = add(add(sh, scale(upW, 0.24 * sc)), add(scale(toT, -0.12 * sc), scale(outW, 0.06 * sc)));
    hit = madd(face.p, face.n, 0.06 * sc);
  }
  let W: V3;
  const k1 = 0.55 * c;
  if (p < k1) W = lerp3(w0, cock, smooth(p / k1));
  else if (p < c) {
    const u = (p - k1) / (c - k1);
    W = lerp3(cock, hit, u * u * (1.6 - 0.6 * u));
  } else W = lerp3(hit, w0, smooth((p - c) / (1 - c)));
  const pole = add(add(sh, scale(sub(W, sh), 0.5)), qRot(chestQ, scale(norm([left ? 0.7 : -0.7, -0.5, -0.4]), 0.5)));
  solveTwoBone(pose, world, rest, chain, W, pole);
  forwardKinematics(world, pose, rest);

  // ---- the receiver covers ------------------------------------------------------
  const cover = smooth(clamp((p - (c - 0.35)) / 0.25, 0, 1)) * (1 - smooth(clamp((p - c - 0.15) / 0.3, 0, 1)));
  if (cover > 0.01) {
    const rp = b.poses[tgt];
    const rw = b.worlds[tgt];
    const rr = b.rests[tgt];
    const rs = restScale(rr);
    // §10 tier.turns_back: a novice turns away from the punches (rolls onto
    // his side about his own spine), which is how backs get given up.
    const tier = tgt === 0 ? req.variant.tierA : req.variant.tierB;
    const turn = tier <= 0 ? 1 : tier === 1 ? 0.65 : tier === 2 ? 0.3 : 0;
    if (turn > 0) {
      const rq = [rp.rootQuat[0], rp.rootQuat[1], rp.rootQuat[2], rp.rootQuat[3]];
      const spine = qRot(rq, [0, 1, 0]);
      const nq = qMul(qAxis(spine, (left ? -1 : 1) * 0.75 * turn * cover), rq);
      rp.rootQuat[0] = nq[0]; rp.rootQuat[1] = nq[1]; rp.rootQuat[2] = nq[2]; rp.rootQuat[3] = nq[3];
      forwardKinematics(rw, rp, rr);
    }
    for (const side of [0, 1] as const) {
      const ch = side === 0 ? LIMBS.lArm : LIMBS.rArm;
      const hs = sampleSocket(side === 0 ? 'head_side_L' : 'head_side_R', rw, rr);
      const guard = madd(madd(hs.p, hs.n, 0.02 * rs), sampleSocket('face', rw, rr).n, 0.1 * rs);
      const rsh = getV3(rw.pos, ch.upper);
      const rq = getQ(rw.quat, B.spine2);
      const pl = add(add(rsh, scale(sub(guard, rsh), 0.5)), qRot(rq, [side === 0 ? 0.4 : -0.4, -0.6, 0.5]));
      solveTwoBone(rp, rw, rr, ch, guard, pl, cover);
    }
    forwardKinematics(rw, rp, rr);
    rp.face[3] = Math.max(rp.face[3], 0.4 * cover); // mouthOpen → brace
    rp.face[4] = Math.max(rp.face[4], 0.6 * cover); // grimace
  }
  void qConj;
}
