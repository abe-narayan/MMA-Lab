// Edge-fighter win rate per physical_sweeps cell: node scripts/dev/sweep-summary.mjs <runDir>
import { readFileSync } from 'node:fs';
const rows = readFileSync(process.argv[2] + '/results.jsonl', 'utf8').split('\n').filter(Boolean).map(JSON.parse)
  .filter((r) => r.tags.plan === 'physical_sweeps' || r.tags.plan === 'skill_domains');
const by = new Map();
for (const r of rows) {
  const k = `${r.tags.sweepVar}/${r.tags.sweepVal}`;
  const e = r.bt?.edge ?? (r.i % 2);
  const s = by.get(k) ?? { n: 0, w: 0, d: 0, ko: 0, dec: 0 };
  s.n++;
  if (r.res.w === e) s.w++; else if (r.res.w !== 0 && r.res.w !== 1) s.d++;
  if (/ko|tko/.test(r.res.m)) s.ko++;
  if (/decision/.test(r.res.m)) s.dec++;
  by.set(k, s);
}
for (const [k, s] of [...by.entries()].sort()) {
  const p = s.w / s.n; const ci = 1.96 * Math.sqrt(p * (1 - p) / s.n);
  console.log(`${k.padEnd(28)} n ${String(s.n).padStart(4)}  edge wins ${(100 * p).toFixed(1).padStart(5)} % ±${(100 * ci).toFixed(1)}  KO/TKO ${(100 * s.ko / s.n).toFixed(0)} %  dec ${(100 * s.dec / s.n).toFixed(0)} %`);
}
