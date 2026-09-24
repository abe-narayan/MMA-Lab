/**
 * POLICY ERROR PROBE — the policy swallows exceptions (a fault costs a tick,
 * never a replay), which also hides bugs. This runs a few bouts with the
 * policy's `think` wrapped so every exception is counted and the first few
 * printed.   npx tsx scripts/dev/policy-errors.ts [--n 6]
 */
import { MmaPolicy } from '../../src/sim/ai';
import { simulate } from '../../src/sim';
import { PLANS, buildJob } from '../batch/plans';

const n = Number(process.argv[process.argv.indexOf('--n') + 1] || 6);
const proto = MmaPolicy.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
const orig = proto.think;
let errors = 0;
proto.think = function (this: unknown, ...a: unknown[]) {
  try {
    return orig.apply(this, a);
  } catch (e) {
    errors++;
    if (errors <= 3) console.error(e);
    throw e;
  }
};
const cells = PLANS.style_matrix.cells(n);
let bouts = 0;
for (const cell of cells.slice(0, 12)) {
  for (let i = 0; i < 1; i++) {
    const job = buildJob(cell, i, 'probe');
    const run = simulate(job.config);
    bouts++;
    const feints = run.events.filter((e) => e.kind === 'feint').length;
    const bites = run.events.filter((e) => e.kind === 'feint' && (e as { detail: { bite?: boolean } }).detail.bite).length;
    const strikes = run.events.filter((e) => e.kind === 'strike');
    const counters = strikes.filter((e) => (e as { detail: { counter?: boolean } }).detail.counter).length;
    console.log(`${cell.id.padEnd(34)} ${run.result.method.padEnd(18)} feints ${feints} bites ${bites} strikes ${strikes.length} counters ${counters}`);
  }
}
console.log(`${bouts} bouts, ${errors} policy exceptions`);
