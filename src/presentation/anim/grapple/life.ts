/**
 * Idle life: breathing and small weight shifts so a held position never
 * freezes, and a harder "working" rhythm while a long edge (a pass, an
 * escape) is being fought for before it moves. Deterministic in sim time.
 */
import { B, forwardKinematics } from '../../rig/skeleton';
import type { PairRequest } from './request';
import type { SolveBuffers } from './solve';
import { getQ, qAxis, qMul, setQ, wobble } from './math';

export function applyLife(req: PairRequest, b: SolveBuffers): void {
  const t = req.variant.t;
  const working = req.flight !== null && req.flight.phase < 0.98 ? 1 : 0;
  const limp = req.sub?.limp ?? false;
  for (const i of [0, 1] as const) {
    const pose = b.poses[i];
    if (limp && ((req.sub!.attacker === 'a') === (i === 1))) continue;
    const ch = i * 3 + 1;
    // Breathing: ~0.35 Hz chest rise, faster and deeper when working.
    const br = Math.sin(t * (2.2 + 1.2 * working) + i * 1.3);
    const breath = qAxis([1, 0, 0], (0.012 + 0.01 * working) * br);
    setQ(pose.local, B.spine2, qMul(getQ(pose.local, B.spine2), breath));
    // Weight shifts / struggle.
    const amp = 0.004 + 0.012 * working;
    pose.rootPos[0] += amp * wobble(t, ch);
    pose.rootPos[2] += amp * wobble(t, ch + 1);
    const tw = qAxis([0, 1, 0], (0.01 + 0.04 * working) * wobble(t * 1.3, ch + 2));
    setQ(pose.local, B.spine1, qMul(getQ(pose.local, B.spine1), tw));
    forwardKinematics(b.worlds[i], pose, b.rests[i]);
  }
}
