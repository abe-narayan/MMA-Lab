/**
 * Print the parameter-effect table for docs/design/UI_PASS.md.
 *
 *   node scripts/dev/heavy.mjs npx tsx scripts/dev/param-effects.ts [--only id1,id2] [--json out.json]
 *
 * Runs the same probe as tests/ui.params-effect.test.ts for every live
 * profile parameter and prints: parameter, schema path, metric, low, high,
 * relative change, pass. Divergence probes (`boutsChanged`) print the share of
 * paired bouts whose digest differed instead of a low/high statistic.
 */
import { writeFileSync } from 'node:fs';
import { PROFILE_PARAMS } from '../../src/app/model/profileModel';
import { probeBase, probeParam } from '../../src/app/model/paramEffect';

const args = process.argv.slice(2);
const opt = (n: string): string | undefined => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const only = opt('only')?.split(',');
const base = probeBase();
const rows = [];
console.log('| Parameter | Schema path | Metric | Low → High | Low value | High value | Change | Result |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const p of PROFILE_PARAMS) {
  if (!p.probe || p.status !== 'live') continue;
  if (only && !only.includes(p.id)) continue;
  const t0 = Date.now();
  const r = probeParam(p, base, opt('prefix') ? { seedPrefix: opt('prefix') } : {});
  rows.push({ ...r, label: p.label, ms: Date.now() - t0 });
  const f = (v: number): string => (Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const path = `\`${p.paths[0]}\`${p.paths.length > 1 ? ` +${p.paths.length - 1}` : ''}`;
  if (r.metric === 'boutsChanged') {
    console.log(`| ${p.label} | ${path} | bouts diverged (of ${r.seeds}) | ${p.probe.lo} → ${p.probe.hi} | — | — | ${(r.hi * 100).toFixed(0)}% (need ${((p.probe.minRel ?? 0.5) * 100).toFixed(0)}%) | ${r.pass ? 'pass' : '**FAIL**'} (${secs} s) |`);
  } else {
    const dir = p.probe.dir === 1 ? ' ↑' : p.probe.dir === -1 ? ' ↓' : '';
    console.log(`| ${p.label} | ${path} | ${r.metric}${dir} | ${p.probe.lo} → ${p.probe.hi} | ${f(r.lo)} | ${f(r.hi)} | ${(r.relChange * 100).toFixed(1)}% | ${r.pass ? 'pass' : '**FAIL**'} (${secs} s) |`);
  }
}
const out = opt('json');
if (out) writeFileSync(out, JSON.stringify(rows, null, 2));
