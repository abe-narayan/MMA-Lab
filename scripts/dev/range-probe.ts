/** Distance management probe. npx tsx scripts/dev/range-probe.ts <cell> [--n 6] */
import { createSim } from '../../src/sim';
import { PLANS, buildJob } from '../batch/plans';
const cellId = process.argv[2] ?? 'style_matrix/distancexpressure';
const n = Number(process.argv[process.argv.indexOf('--n') + 1] || 6);
const plan = PLANS[cellId.split('/')[0]];
const cell = plan.cells(n).find((c) => c.id === cellId)!;
for (let i = 0; i < n; i++) {
  const job = buildJob(cell, i, 'range');
  const sim = createSim(job.config);
  let dSum = 0; let dN = 0; const adv = [0, 0]; const ret = [0, 0]; const hist = new Array(12).fill(0);
  while (sim.step()) {
    const w = sim.world;
    if (w.phase !== 'round') continue;
    const [A, B] = w.fighters;
    if (A.posture !== 'standing' || B.posture !== 'standing') continue;
    const d = Math.hypot(A.x - B.x, A.z - B.z);
    dSum += d; dN++; hist[Math.min(11, Math.floor(d / 0.2))]++;
    for (const [k, f, o] of [[0, A, B], [1, B, A]] as const) {
      const vr = (f.vx * (o.x - f.x) + f.vz * (o.z - f.z)) / (d || 1);
      if (vr > 0.2) adv[k]++; else if (vr < -0.2) ret[k]++;
    }
  }
  const ai = sim.world.fighters.map((f) => (f.ai as { rangeCache?: { dStar: number }; intent: { rangeTarget: string } }));
  console.log(`bout ${i}: d* ${ai.map((a) => `${a.intent.rangeTarget}:${a.rangeCache?.dStar.toFixed(2)}`).join(' ')}  mean d ${(dSum / dN).toFixed(2)}  adv ${adv.map((x) => (100 * x / dN).toFixed(0)).join('/')}%  ret ${ret.map((x) => (100 * x / dN).toFixed(0)).join('/')}%  hist ${hist.map((x) => Math.round(100 * x / dN)).join(' ')}`);
}
