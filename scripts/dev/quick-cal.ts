/**
 * QUICK CALIBRATION VIEW — the §7 rows that matter for an iteration, compact.
 *
 *   npx tsx scripts/dev/quick-cal.ts runs/<a>[,runs/<b>...] [--vs runs/<base>[,...]] [--rows 1,2,3,...] [--all]
 *
 * Several run directories are pooled (one results.jsonl each). With `--vs` the
 * baseline value of each component is printed alongside. Default rows are the
 * headline rows of docs/CALIBRATION.md plus the realism-pass rows
 * (predictability, reach, trailing fighters, finishing strikes, by-class KDs).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ResultRow } from '../batch/types';
import { Dataset } from '../calibrate/data';
import { evaluateAll, type RowResult } from '../calibrate/metrics';
import { strategyChecks, tierChecks } from '../calibrate/checks';

const argv = process.argv.slice(2);
const arg = (k: string): string | undefined => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

function load(dirs: string): ResultRow[] {
  const out: ResultRow[] = [];
  const seen = new Set<string>();
  for (const d of dirs.split(',')) {
    const p = join(d, 'results.jsonl');
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (!line) continue;
      const r = JSON.parse(line) as ResultRow;
      const k = `${r.cell}#${r.i}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
  }
  return out;
}

const main = load(argv[0]);
const vsArg = arg('vs');
const base = vsArg ? load(vsArg) : null;
const DEFAULT_ROWS = [1, 2, 3, 5, 7, 16, 18, 19, 24, 25, 27, 29, 30, 34, 36, 38, 39, 40, 48, 49, 53, 55, 57, 60, 69, 73, 74, 75,
  77, 79, 84, 85, 86, 87, 88, 90, 91, 92, 97, 98, 101, 105, 107, 115, 116, 125, 128, 129];
const rowsArg = arg('rows');
const wanted = argv.includes('--all') ? null : new Set((rowsArg ? rowsArg.split(',').map(Number) : DEFAULT_ROWS));

function fmt(v: number | null | undefined, unit: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (unit === 'pct') return `${(100 * v).toFixed(1)}%`;
  if (unit === 'bool') return v === 1 ? 'yes' : 'no';
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2);
}

const res = evaluateAll(new Dataset(main));
const resB = base ? evaluateAll(new Dataset(base)) : null;
const byIdB = new Map<string, RowResult>();
if (resB) for (const r of resB) byIdB.set(`${r.row.id}`, r);
console.log(`${main.length} rows${base ? ` (baseline ${base.length})` : ''}`);
for (const r of res) {
  if (wanted && !wanted.has(r.row.id)) continue;
  if (r.verdict === 'N/A' || r.verdict === 'NO DATA') continue;
  const b = byIdB.get(`${r.row.id}`);
  for (let i = 0; i < r.comps.length; i++) {
    const c = r.comps[i];
    if (c.est.value === null) continue;
    const bc = b?.comps.find((x) => x.label === c.label && x.grp === c.grp);
    const label = `#${r.row.id} ${r.row.metric.slice(0, 34)} · ${c.label}`.slice(0, 64).padEnd(64);
    console.log(`${label} ${fmt(c.est.value, c.unit).padStart(8)}${bc ? ` (was ${fmt(bc.est.value, bc.unit)})`.padEnd(15) : ''}  target ${fmt(c.target, c.unit).padStart(7)}  ${c.verdict}`);
  }
}
if (!argv.includes('--no-checks')) {
  const d = new Dataset(main);
  const dB = base ? new Dataset(base) : null;
  const sc = [...strategyChecks(d), ...tierChecks(d)];
  const scB = dB ? [...strategyChecks(dB), ...tierChecks(dB)] : [];
  for (const c of sc) {
    for (const p of c.parts) {
      if (p.est.value === null) continue;
      const bp = scB.find((x) => x.id === c.id)?.parts.find((x) => x.label === p.label);
      console.log(`${`${c.id} ${c.title.slice(0, 26)} · ${p.label}`.slice(0, 64).padEnd(64)} ${fmt(p.est.value, p.unit).padStart(8)}${bp ? ` (was ${fmt(bp.est.value, bp.unit)})`.padEnd(15) : ''}  ${p.verdict}`);
    }
  }
}
