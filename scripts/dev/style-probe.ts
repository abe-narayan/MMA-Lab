/** Outcome breakdown of one style_matrix cell. npx tsx scripts/dev/style-probe.ts <cell> [--n 16] */
import { simulate, computeStats } from '../../src/sim';
import { PLANS, buildJob } from '../batch/plans';
const cellId = process.argv[2];
const n = Number(process.argv[process.argv.indexOf('--n') + 1] || 16);
const cell = PLANS.style_matrix.cells(n).find((c) => c.id === cellId)!;
const agg = [0, 1].map(() => ({ win: 0, ko: 0, sub: 0, dec: 0, sigL: 0, sigA: 0, td: [0, 0], ctrl: 0, subAtt: 0 }));
const subs: Record<string, number> = {};
for (let i = 0; i < n; i++) {
  const job = buildJob(cell, i, 'probe');
  const run = simulate(job.config);
  const st = computeStats(run.events, job.config, run.ticks);
  for (const k of [0, 1]) {
    const a = agg[k]; const f = st.fighters[k];
    a.sigL += f.sig.landed; a.sigA += f.sig.attempted; a.td[0] += f.takedowns.landed; a.td[1] += f.takedowns.attempted;
    a.ctrl += f.controlSeconds; a.subAtt += f.subAttempts;
    if (run.result.winner === k) { a.win++; const m = run.result.method; if (/ko|tko/.test(m)) a.ko++; else if (/sub/.test(m)) { a.sub++; const fin = run.events.find((e) => e.kind === 'submissionFinish') as { detail?: { technique?: string } } | undefined; const t = fin?.detail?.technique ?? '?'; subs[t] = (subs[t] ?? 0) + 1; } else a.dec++; }
  }
}
for (const k of [0, 1]) { const a = agg[k]; console.log(`side ${k}: wins ${a.win} (KO ${a.ko} SUB ${a.sub} DEC ${a.dec}) sig ${a.sigL}/${a.sigA} TD ${a.td[0]}/${a.td[1]} ctrl ${(a.ctrl / n / 60).toFixed(2)} min subAtt ${a.subAtt}`); }
console.log('finishing subs', subs);
