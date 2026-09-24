/**
 * HEADLESS BATCH RUNNER — CLI (docs/design/09 §6.3).
 *
 *   npx tsx scripts/batch/run.ts --plan baseline,tier_matrix,identical --n 40 \
 *       --seed cal-2026-09 --out runs/pre-tuning [--max-workers 2] [--resume]
 *       [--params overrides.json] [--filter cell=LW] [--cap 0.93] [--resume-below 0.85]
 *       [--affinity 3F] [--per-worker-mb 200] [--sample-ms 2000] [--list]
 *
 *   --plan         plan id(s), comma-separated (see --list)
 *   --n            bouts per cell: one number, or `plan=n,plan=n`; default = each plan's
 *   --seed         plan seed; bout seed = boutSeed(seed, cellId, i)
 *   --out          run directory (manifest.json, results.jsonl, monitor.jsonl)
 *   --max-workers  upper bound on the pool (default 2 on this shared machine; the
 *                  §6.1 CPU/RAM budget and the live monitor can only lower it)
 *   --resume       skip bouts already in results.jsonl
 *   --params       JSON file of parameter overrides (SimConfig.paramOverrides)
 *   --filter       keep cells whose id matches the regex (`cell=` prefix optional)
 *
 * The process always lowers its own priority and, on Windows, confines itself
 * (and so every worker thread) to the `--affinity` cores. The monitor pauses
 * dispatch above the cap and never starts while RAM is already over it.
 */
import { readFileSync } from 'node:fs';
import type { ParamOverrides } from '../../src/sim';
import { runBatch } from './batch';
import { PLANS } from './plans';

function parseArgs(argv: string[]): Map<string, string | true> {
  const out = new Map<string, string | true>();
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[k + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out.set(key, next);
      k++;
    } else out.set(key, true);
  }
  return out;
}

function str(args: Map<string, string | true>, key: string, dflt?: string): string {
  const v = args.get(key);
  if (typeof v === 'string') return v;
  if (dflt !== undefined) return dflt;
  throw new Error(`--${key} is required`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.has('list') || !args.has('plan')) {
    console.log('plans:');
    for (const p of Object.values(PLANS)) {
      const cells = p.cells(p.defaultN);
      console.log(`  ${p.id.padEnd(16)} ${String(cells.length).padStart(3)} cells x ${p.defaultN}  ${p.description}`);
    }
    if (!args.has('plan')) console.log('\nusage: npx tsx scripts/batch/run.ts --plan <id[,id]> --seed <s> --out <dir> [--n N] [--max-workers 2] [--resume]');
    return;
  }
  const plans = str(args, 'plan').split(',').map((s) => s.trim()).filter(Boolean);
  let n: number | Record<string, number> | undefined;
  const nArg = args.get('n');
  if (typeof nArg === 'string') {
    if (nArg.includes('=')) {
      n = {};
      for (const part of nArg.split(',')) {
        const [k, v] = part.split('=');
        n[k.trim()] = Number(v);
      }
    } else n = Number(nArg);
  }
  const filterArg = args.get('filter');
  const filter = typeof filterArg === 'string' ? new RegExp(filterArg.replace(/^cell=/, '')) : undefined;
  const paramsArg = args.get('params');
  const overrides = typeof paramsArg === 'string'
    ? (JSON.parse(readFileSync(paramsArg, 'utf8')) as ParamOverrides)
    : undefined;
  if (args.has('record-golden')) console.warn('[batch] --record-golden is not implemented yet; rows only (no frames)');

  const cap = Number(str(args, 'cap', '0.93'));
  const summary = await runBatch({
    plans,
    n,
    seed: str(args, 'seed', 'cal-2026-09'),
    out: str(args, 'out'),
    maxWorkers: Number(str(args, 'max-workers', '2')),
    resume: args.has('resume'),
    overrides,
    filter,
    throttle: { cap, resumeBelow: Number(str(args, 'resume-below', '0.85')) },
    sampleMs: Number(str(args, 'sample-ms', '2000')),
    perWorkerMB: Number(str(args, 'per-worker-mb', '200')),
    affinity: str(args, 'affinity', '3F'),
    confine: true,
  });
  if (summary.errors > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
