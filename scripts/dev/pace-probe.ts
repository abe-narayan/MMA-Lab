/** Pace by round and minute, and time at distance. npx tsx scripts/dev/pace-probe.ts [--n 30] */
import { createSim, isSignificantStrike } from '../../src/sim';
import { PLANS, buildJob } from '../batch/plans';
const n = Number(process.argv[process.argv.indexOf('--n') + 1] || 30);
const cells = PLANS.baseline.cells(n).filter((c) => c.id.includes('/ufc/'));
const att = [[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]]; const distT = [[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]];
const fat = [[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]]; const cnt = [[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]];
for (let i = 0; i < n; i++) {
  const job = buildJob(cells[i % cells.length], i, 'pace');
  const sim = createSim(job.config);
  let seen = 0;
  while (sim.step()) {
    const w = sim.world;
    if (w.phase !== 'round' || w.round > 3) continue;
    const m = Math.min(4, Math.floor(w.roundTick / 600));
    cnt[w.round - 1][m]++;
    if (w.fighters.every((f) => f.posture === 'standing')) distT[w.round - 1][m]++;
    fat[w.round - 1][m] += (w.fighters[0].damage.f + w.fighters[1].damage.f) / 2;
    const ev = w.events;
    for (; seen < ev.length; seen++) {
      const e = ev[seen] as { kind: string; round: number; detail?: { technique?: string; sig?: boolean; pos?: string } };
      if (e.kind === 'strike' && e.detail?.sig) att[w.round - 1][m]++;
    }
  }
}
for (let r = 0; r < 3; r++) console.log(`R${r + 1} sigAtt/min/fighter by minute: ${att[r].map((a, m) => (a / Math.max(1, cnt[r][m]) * 600 / 2).toFixed(1)).join(' ')}  | standing ${distT[r].map((a, m) => (100 * a / Math.max(1, cnt[r][m])).toFixed(0)).join(' ')} % | f ${fat[r].map((a, m) => (a / Math.max(1, cnt[r][m])).toFixed(2)).join(' ')}`);
