/** Live counters vs computeStats, per fighter (QA2 #6). npx tsx scripts/dev/count-check.ts [--n 30] */
import { createSim, computeStats } from '../../src/sim';
import { PLANS, buildJob } from '../batch/plans';
const n = Number(process.argv[process.argv.indexOf('--n') + 1] || 30);
const cells = PLANS.baseline.cells(n).filter((c) => c.id.includes('/ufc/'));
let bad = 0; let tot = 0;
for (let i = 0; i < n; i++) {
  const cell = cells[i % cells.length];
  const job = buildJob(cell, i, 'count-check');
  const sim = createSim(job.config);
  while (sim.step()) { /* run */ }
  const stats = computeStats(sim.events, job.config, sim.tick);
  for (const f of sim.world.fighters) {
    const s = stats.fighters[f.id];
    tot++;
    const ok = s.sig.attempted === f.sigAttempted && s.sig.landed === f.sigLanded
      && s.total.attempted === f.totalAttempted && s.total.landed === f.totalLanded;
    if (!ok) {
      bad++;
      console.log(`${job.key} f${f.id}: live sig ${f.sigLanded}/${f.sigAttempted} tot ${f.totalLanded}/${f.totalAttempted} · stats sig ${s.sig.landed}/${s.sig.attempted} tot ${s.total.landed}/${s.total.attempted}`);
    }
  }
}
console.log(`${bad} mismatched fighter-bouts of ${tot}`);
