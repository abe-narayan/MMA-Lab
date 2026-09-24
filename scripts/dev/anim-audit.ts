/**
 * Animation QA audit (see `anim-audit-lib.ts` for what is measured and how).
 *
 *   node scripts/dev/heavy.mjs npx tsx scripts/dev/anim-audit.ts [options]
 *
 * Options:
 *   --bouts a,b        only these bouts (names from AUDIT_BOUTS)
 *   --full             record afresh and play every bout end to end (default: the
 *                      first 150 s, the first break and the last 45 s of each, from
 *                      a cached recording so before / after compare the same bout
 *                      while the sim is being tuned)
 *   --cache DIR        recording cache (default: <tmp>/boutlab-anim-audit)
 *   --rerecord         refresh the cache from the current sim
 *   --post S           seconds of post-roll after the end (default 20)
 *   --procedural       without the motion-capture library
 *   --json FILE        write the flat summary (and examples) as JSON
 *   --compare FILE     print a before / after table against an earlier --json
 *   --examples         print the worst examples per category
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUDIT_BOUTS, audit, auditWindows, cachedRecording, mergeResults, recordBout, summarize, type AuditResult } from './anim-audit-lib';

const args = process.argv.slice(2);
const opt = (k: string): string | undefined => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const has = (k: string): boolean => args.includes(k);

const pick = opt('--bouts')?.split(',');
const bouts = AUDIT_BOUTS.filter((b) => !pick || pick.includes(b.name));
const post = Number(opt('--post') ?? 20);
const results: AuditResult[] = [];
const perBout: Record<string, Record<string, string>> = {};
const t00 = Date.now();
for (const spec of bouts) {
  const t0 = Date.now();
  const rec = has('--full') ? recordBout(spec) : cachedRecording(spec, opt('--cache') ?? join(tmpdir(), 'boutlab-anim-audit'), has('--rerecord'));
  const end = rec.frames[rec.frames.length - 1]!.t;
  const windows = auditWindows(rec, has('--full'));
  const r = audit(rec, { windows, post, motion: has('--procedural') ? null : undefined, examples: 4 });
  results.push(r);
  perBout[spec.name] = summarize(r);
  const last = rec.frames[rec.frames.length - 1]!;
  const endEv = rec.events.find((e) => e.kind === 'boutEnd');
  console.log(`# ${spec.name}: ${spec.ruleset}, ${end.toFixed(0)} s (${(endEv?.detail as { method?: string } | undefined)?.method ?? last.phase}), audited ${r.frames} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
const all = mergeResults(results);
const sum = summarize(all);
console.log(`\n## All bouts (${bouts.length}), ${all.frames} frames, ${((Date.now() - t00) / 1000).toFixed(0)} s\n`);
const cmpFile = opt('--compare');
const before = cmpFile && existsSync(cmpFile) ? (JSON.parse(readFileSync(cmpFile, 'utf8')) as { all: Record<string, string> }).all : null;
if (before) {
  console.log('| Metric | Before | After |\n|---|---|---|');
  for (const k of Object.keys({ ...before, ...sum })) console.log(`| ${k} | ${before[k] ?? '-'} | ${sum[k] ?? '-'} |`);
} else {
  for (const [k, v] of Object.entries(sum)) console.log(`${k.padEnd(78)} ${v}`);
}
if (has('--examples')) {
  console.log('\n## Unexplained rotation pops by bucket:bone:layer (top 25)');
  for (const [k, v] of Object.entries(all.popHist).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(v).padStart(6)}  ${k}`);
  console.log('\n## Joint-limit frames by limit:bucket:layer (top 25)');
  for (const [k, v] of Object.entries(all.jointHist).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(v).padStart(6)}  ${k}`);
  console.log('\n## Worst examples');
  const byCat = new Map<string, typeof all.examples>();
  for (const e of all.examples) {
    const c = e.what.split(' · ')[0]!;
    (byCat.get(c) ?? byCat.set(c, []).get(c)!).push(e);
  }
  for (const [c, l] of byCat) {
    l.sort((a, b) => b.value - a.value);
    console.log(`\n${c}`);
    for (const e of l.slice(0, 5)) console.log(`  ${e.bout} t=${e.t.toFixed(2)} f${e.fighter} ${e.what.split(' · ')[1]} = ${e.value.toFixed(1)}  [${e.layer}]`);
  }
}
const json = opt('--json');
if (json) writeFileSync(json, JSON.stringify({ all: sum, perBout, examples: all.examples }, null, 1));
