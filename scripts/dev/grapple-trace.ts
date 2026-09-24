/**
 * GRAPPLE TRACE — where does control come from?
 *   npx tsx scripts/dev/grapple-trace.ts [--cell style_matrix/wrestlerxdistance] [--n 20] [--verbose 1]
 * Tallies, per style side, the grappling edges that *handed control* (the
 * events whose `detail.a` makes a fighter slot a of a mat node), control
 * seconds by the edge that started the spell, and takedown outcomes.
 */
import { simulate, computeStats, type SimEvent } from '../../src/sim';
import { PLANS, buildJob } from '../batch/plans';

const argv = process.argv.slice(2);
const arg = (k: string, d: string): string => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const cellId = arg('cell', 'style_matrix/wrestlerxdistance');
const n = Number(arg('n', '20'));
const verbose = Number(arg('verbose', '0'));
const plan = PLANS[cellId.split('/')[0]];
const cell = plan.cells(n).find((c) => c.id === cellId)!;
const gainedBy: Record<string, Record<string, number>> = { A: {}, B: {} };
const ctrlBy: Record<string, Record<string, number>> = { A: {}, B: {} };
const tot = { A: { ctrl: 0, win: 0, td: [0, 0] }, B: { ctrl: 0, win: 0, td: [0, 0] } };
for (let i = 0; i < n; i++) {
  const job = buildJob(cell, i, 'trace');
  const run = simulate(job.config);
  const stats = computeStats(run.events, job.config, run.ticks);
  for (const k of [0, 1]) {
    const K = k === 0 ? 'A' : 'B';
    tot[K].ctrl += stats.fighters[k].controlSeconds;
    tot[K].td[0] += stats.fighters[k].takedowns.landed;
    tot[K].td[1] += stats.fighters[k].takedowns.attempted;
    if (run.result.winner === k) tot[K].win++;
  }
  let top: number | null = null; let since = 0; let via = '';
  const dt = 0.1;
  for (const e of run.events as SimEvent[]) {
    const d = (e as { detail?: { a?: number; to?: string; edge?: string; result?: string } }).detail;
    if (!d || d.a === undefined || !d.to) continue;
    const mat = !/standing|clinch/.test(d.to);
    const newTop = mat ? d.a : null;
    if (newTop !== top) {
      if (top !== null) {
        const K = top === 0 ? 'A' : 'B';
        ctrlBy[K][via] = (ctrlBy[K][via] ?? 0) + (e.tick - since) * dt;
      }
      if (newTop !== null) {
        const K = newTop === 0 ? 'A' : 'B';
        const who = e.actor === newTop ? 'own' : 'opp';
        via = `${d.edge ?? e.kind} (${who})`;
        gainedBy[K][via] = (gainedBy[K][via] ?? 0) + 1;
        if (verbose) console.log(`bout ${i} t=${(e.tick / 10).toFixed(1)} ${K} gets top via ${via} -> ${d.to}`);
      }
      top = newTop; since = e.tick;
    }
  }
}
console.log(cellId, n, 'bouts');
for (const K of ['A', 'B'] as const) {
  console.log(`${K}: wins ${tot[K].win}, control ${(tot[K].ctrl / n / 60).toFixed(2)} min/bout, TD ${tot[K].td[0]}/${tot[K].td[1]}`);
  const rows = Object.entries(gainedBy[K]).sort((a, b) => b[1] - a[1]).slice(0, 12);
  for (const [k, v] of rows) console.log(`   ${String(v).padStart(4)} x  ${k.padEnd(48)} ${((ctrlBy[K][k] ?? 0) / n).toFixed(0)} s/bout`);
}

// ---- where is control spent? (stepped) -------------------------------------
import { createSim } from '../../src/sim';
import { hasPositionNode as hasNode, positionNode as nodeOf, roleFor as roleOf } from '../../src/sim/grappling/graph';
const byNode: Record<string, Record<string, number>> = { A: {}, B: {} };
for (let i = 0; i < Math.min(n, 8); i++) {
  const job = buildJob(cell, i, 'trace');
  const sim = createSim(job.config);
  while (sim.step()) {
    const w = sim.world;
    if (w.phase !== 'round') continue;
    for (const e of w.engagements.all) {
      if (!hasNode(e.node)) continue;
      const nd = nodeOf(e.node);
      if (nd.symmetric) continue;
      const r = roleOf(e.node, 'a');
      if (r !== 'top' && r !== 'attacker') continue;
      const K = e.a === 0 ? 'A' : 'B';
      byNode[K][e.node] = (byNode[K][e.node] ?? 0) + 0.1;
    }
  }
}
for (const K of ['A', 'B'] as const) {
  console.log(`${K} control seconds by node (8 bouts):`);
  for (const [k, v] of Object.entries(byNode[K]).sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   ${k.padEnd(34)} ${v.toFixed(0)}`);
}
