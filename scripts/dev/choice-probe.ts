/** Where does the choice mass go? npx tsx scripts/dev/choice-probe.ts <cell> [--n 2] */
import { createSim } from '../../src/sim';
import { MmaPolicy } from '../../src/sim/ai/policy';
import { PLANS, buildJob } from '../batch/plans';
const cellId = process.argv[2] ?? 'style_matrix/distancexpressure';
const n = Number(process.argv[process.argv.indexOf('--n') + 1] || 2);
const cell = PLANS[cellId.split('/')[0]].cells(n).find((c) => c.id === cellId)!;
const mass: Record<string, number> = {}; const comps: Record<string, { style: number; plan: number; adapt: number; matchup: number; pref: number; score: number; k: number }> = {};
let decisions = 0;
MmaPolicy.debugHook = ({ candidates, scores, tau, weights }) => {
  if (!candidates.some((c) => c.kind === 'move')) return; // standing decisions only
  decisions++;
  const max = Math.max(...scores);
  const cnt: Record<string, number> = {};
  for (const c of candidates) cnt[c.family] = (cnt[c.family] ?? 0) + 1;
  const w = scores.map((s, i) => (s <= 0 ? 0 : Math.pow(s / max, 1 / tau) / cnt[candidates[i].family]));
  const tot = w.reduce((a, b) => a + b, 0);
  candidates.forEach((c, i) => {
    mass[c.family] = (mass[c.family] ?? 0) + w[i] / tot;
    const r = (comps[c.family] ??= { style: 0, plan: 0, adapt: 0, matchup: 0, pref: 0, score: 0, k: 0 });
    r.style += weights[i].style; r.plan += weights[i].plan; r.adapt += weights[i].adapt; r.matchup += weights[i].matchup; r.pref += weights[i].pref ?? 1; r.score += scores[i] / max; r.k++;
  });
};
for (let i = 0; i < n; i++) { const sim = createSim(buildJob(cell, i, 'choice').config); while (sim.step()) { /* */ } }
console.log(decisions, 'standing decisions (pre-cap softmax mass by family)');
for (const [f, m] of Object.entries(mass).sort((a, b) => b[1] - a[1]).slice(0, 18)) {
  const r = comps[f];
  console.log(f.padEnd(16), (100 * m / decisions).toFixed(1).padStart(5) + '%', 'rel score', (r.score / r.k).toFixed(2), 'style', (r.style / r.k).toFixed(2), 'plan', (r.plan / r.k).toFixed(2), 'adapt', (r.adapt / r.k).toFixed(2), 'matchup', (r.matchup / r.k).toFixed(2), 'pref', (r.pref / r.k).toFixed(2));
}
