/**
 * SIM GOLDEN — bit-exact regression harness for the simulation core.
 *
 *   npx tsx scripts/dev/sim-golden.ts --write <file> [--subset N | --all]   record a corpus
 *   npx tsx scripts/dev/sim-golden.ts --check <file>                re-run and compare
 *   npx tsx scripts/dev/sim-golden.ts --list                        list case ids
 *   [--filter <regex>]  only cases whose id matches
 *
 * `--write` onto an existing file re-records exactly the case ids it holds
 * (the committed fixture `tests/fixtures/sim-golden.json` is a curated ~40-case
 * subset covering every ruleset and mode); onto a new file, or with `--all`,
 * it records the whole corpus (310 cases); `--subset N` keeps every k-th case.
 * `--check` runs exactly the case ids stored in the file. Run it through the
 * governor:
 *
 *   node scripts/dev/heavy.mjs npx tsx scripts/dev/sim-golden.ts --check <file>
 *
 * The rows are described in `sim-golden-lib.ts`. When SIM_ENGINE_VERSION is
 * bumped on purpose, regenerate the committed fixture with
 *
 *   npx tsx scripts/dev/sim-golden.ts --write tests/fixtures/sim-golden.json
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SIM_ENGINE_VERSION } from '../../src/sim';
import { diffRow, goldenCases, runGoldenCase, type GoldenFile, type GoldenRow } from './sim-golden-lib';

const argv = process.argv.slice(2);
const arg = (k: string): string | undefined => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : undefined;
};

const all = goldenCases();
const filter = arg('--filter');
const re = filter ? new RegExp(filter) : null;

function subsetOf<T>(xs: T[], n: number): T[] {
  if (n >= xs.length) return xs;
  const out: T[] = [];
  for (let k = 0; k < n; k++) out.push(xs[Math.floor((k * xs.length) / n)]);
  return out;
}

if (argv.includes('--list')) {
  for (const c of all) console.log(c.id);
  console.log(`${all.length} cases`);
} else if (arg('--write')) {
  const file = arg('--write')!;
  let cases = re ? all.filter((c) => re.test(c.id)) : all;
  const sub = arg('--subset');
  if (sub) cases = subsetOf(cases, Number(sub));
  else if (existsSync(file) && !argv.includes('--all')) {
    // Re-record exactly the cases the file already holds (the committed
    // fixture is a curated subset), in the same order.
    const ids = (JSON.parse(readFileSync(file, 'utf8')) as GoldenFile).rows.map((r) => r.id);
    const byId = new Map(all.map((c) => [c.id, c]));
    cases = ids.map((id) => {
      const c = byId.get(id);
      if (!c) throw new Error(`case ${id} in ${file} no longer exists; pass --all or --subset N`);
      return c;
    });
    console.log(`re-recording the ${cases.length} cases already in ${file}`);
  }
  const t0 = performance.now();
  const rows: GoldenRow[] = [];
  for (const c of cases) {
    const row = runGoldenCase(c);
    if (row.recordedDigest !== row.digest) throw new Error(`${c.id}: recorded run diverged from the unrecorded run`);
    rows.push(row);
    if (rows.length % 25 === 0) console.log(`  ${rows.length}/${cases.length} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
  }
  const out: GoldenFile = { engineVersion: SIM_ENGINE_VERSION, cases: rows.length, rows };
  writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`wrote ${rows.length} rows to ${file} in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
} else if (arg('--check')) {
  const file = arg('--check')!;
  const want = JSON.parse(readFileSync(file, 'utf8')) as GoldenFile;
  if (want.engineVersion !== SIM_ENGINE_VERSION) {
    console.log(`note: file engine ${want.engineVersion}, code engine ${SIM_ENGINE_VERSION}`);
  }
  const byId = new Map(all.map((c) => [c.id, c]));
  const t0 = performance.now();
  let bad = 0;
  let ran = 0;
  for (const w of want.rows) {
    if (re && !re.test(w.id)) continue;
    const c = byId.get(w.id);
    if (!c) { console.log(`MISSING case ${w.id}`); bad++; continue; }
    const got = runGoldenCase(c);
    ran++;
    const d = diffRow(w, got);
    if (d.length) { bad++; console.log(`MISMATCH ${w.id}\n    ${d.join('\n    ')}`); }
    if (ran % 25 === 0) console.log(`  ${ran}/${want.rows.length} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
  }
  console.log(`${bad === 0 ? 'OK' : 'FAIL'}: ${ran - bad}/${ran} identical in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  process.exitCode = bad === 0 ? 0 : 1;
} else {
  console.log('usage: sim-golden.ts --write <file> [--subset N] | --check <file> | --list [--filter re]');
}
