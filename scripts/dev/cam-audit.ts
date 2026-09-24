/**
 * Camera QA audit (see `cam-audit-lib.ts` for what is measured and how).
 *
 *   node scripts/dev/heavy.mjs npx tsx scripts/dev/cam-audit.ts [options]
 *
 * Options:
 *   --bouts a,b        only these bouts (names from CAM_BOUTS)
 *   --full             play every bout end to end (default: the first 150 s, the
 *                      first break and the last 60 s of each)
 *   --cache DIR        recording cache (default: <tmp>/boutlab-cam-audit)
 *   --rerecord         refresh the cache from the current sim
 *   --standin          stand-in bodies instead of the animator (fast)
 *   --fps N            frames per second of the live pass (default 30)
 *   --locks            also audit every manual camera (override slots and user
 *                      modes) over the first 120 s of each bout
 *   --json FILE        write the flat summary (per bout, per lock) as JSON
 *   --compare FILE     print a before / after table against an earlier --json
 *   --examples         print the worst examples
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  animatedBodies, auditCamera, CAM_BOUTS, cachedCamRecording, camWindows, groundFraction, mergeCam, standInBodies,
  summarizeCam, type CamResult,
} from './cam-audit-lib';
import type { CameraRequest } from '../../src/presentation/contract';
import type { ShotKind } from '../../src/presentation/camera';

const args = process.argv.slice(2);
const opt = (k: string): string | undefined => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const has = (k: string): boolean => args.includes(k);

const pick = opt('--bouts')?.split(',');
const bouts = CAM_BOUTS.filter((b) => !pick || pick.includes(b.name));
const fps = Number(opt('--fps') ?? 30);
const cache = opt('--cache') ?? join(tmpdir(), 'boutlab-cam-audit');

/** The manual cameras: Watch slots 2-9 plus the wide jib and the corner. */
const LOCKS: { name: string; lock?: ShotKind; request?: CameraRequest }[] = [
  { name: 'main', lock: 'main' },
  { name: 'close (mainTight)', lock: 'mainTight' },
  { name: 'side (cageside)', lock: 'cageside' },
  { name: 'low (ground)', lock: 'ground' },
  { name: 'overhead', lock: 'overhead' },
  { name: 'reverse', lock: 'reverse' },
  { name: 'wide (jib)', lock: 'jib' },
  { name: 'corner', lock: 'corner' },
  { name: 'follow', request: { mode: 'follow', followId: 0 } },
  { name: 'orbit', request: { mode: 'orbit' } },
  { name: 'free', request: { mode: 'free' } },
];

async function main(): Promise<void> {
  const results: CamResult[] = [];
  const perBout: Record<string, Record<string, string>> = {};
  const lockRes = new Map<string, CamResult[]>();
  const t00 = Date.now();
  for (const spec of bouts) {
    const t0 = Date.now();
    const rec = cachedCamRecording(spec, cache, has('--rerecord'));
    const end = rec.frames[rec.frames.length - 1]!.t;
    const windows = camWindows(rec, has('--full'));
    const bodies = has('--standin') ? await standInBodies(rec) : await animatedBodies(rec);
    const r = auditCamera(rec, { bodies, windows, fps, pre: 8, post: 30, replays: true, examples: 4 });
    results.push(r);
    perBout[spec.name] = summarizeCam(r);
    const endEv = rec.events.find((e) => e.kind === 'boutEnd');
    console.log(`# ${spec.name} (${rec.seed}): ${spec.ruleset} @ ${spec.arena}, ${end.toFixed(0)} s, ${(endEv?.detail as { method?: string } | undefined)?.method ?? '?'}, ground ${(groundFraction(rec) * 100).toFixed(0)} %; ${r.frames} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    if (has('--locks')) {
      for (const L of LOCKS) {
        const b = has('--standin') ? await standInBodies(rec) : await animatedBodies(rec);
        const lr = auditCamera(rec, { bodies: b, windows: [[0, Math.min(120, end)]], fps, lock: L.lock, request: L.request, examples: 2 });
        (lockRes.get(L.name) ?? lockRes.set(L.name, []).get(L.name)!).push(lr);
      }
    }
  }
  const all = mergeCam(results);
  const sum = summarizeCam(all);
  console.log(`\n## All bouts (${bouts.length}), ${all.frames} frames, ${((Date.now() - t00) / 1000).toFixed(0)} s\n`);
  const cmpFile = opt('--compare');
  const before = cmpFile && existsSync(cmpFile) ? (JSON.parse(readFileSync(cmpFile, 'utf8')) as { all: Record<string, string>; locks?: Record<string, Record<string, string>> }) : null;
  if (before) {
    console.log('| Metric | Before | After |\n|---|---|---|');
    for (const k of Object.keys({ ...before.all, ...sum })) console.log(`| ${k} | ${before.all[k] ?? '-'} | ${sum[k] ?? '-'} |`);
  } else {
    for (const [k, v] of Object.entries(sum)) console.log(`${k.padEnd(62)} ${v}`);
  }
  const locks: Record<string, Record<string, string>> = {};
  if (lockRes.size) {
    console.log('\n## Manual cameras (first 120 s of each bout)\n');
    const cols = [
      'visibility: subject head outside safe frame (90 %)', 'occlusion: frames > 30 % hidden (referee+cage+crew)',
      'composition: too tight (fill > 0.95)', 'composition: headroom < 2 % (standing)',
      'motion: aim speed p50 / p95 / max (screens/s)', 'motion: aim jerk p50 / p95 (screens/s^3)',
      'motion: pan reversals / min (hunting)', 'clipping: frames (all kinds)',
    ];
    console.log(`| Camera | ${cols.map((c) => c.split(': ')[1]).join(' | ')} |`);
    console.log(`|---|${cols.map(() => '---').join('|')}|`);
    for (const [name, rs] of lockRes) {
      const s = summarizeCam(mergeCam(rs));
      locks[name] = s;
      const b = before?.locks?.[name];
      console.log(`| ${name} | ${cols.map((c) => (b ? `${b[c] ?? '-'} → ${s[c]}` : s[c])).join(' | ')} |`);
      const clipKinds = Object.keys(s).filter((k) => k.startsWith('clipping: ') && k !== 'clipping: frames (all kinds)');
      if (clipKinds.length) console.log(`|   clip detail | ${clipKinds.map((k) => `${k.slice(10)} ${s[k]}`).join(', ')} |`);
    }
  }
  if (has('--examples')) {
    console.log('\n## Worst examples');
    for (const e of all.examples) console.log(`  ${e.bout} t=${e.t.toFixed(2)} ${e.shot}: ${e.what} = ${e.value.toFixed(2)}`);
    console.log('\n## By shot');
    for (const [k, v] of Object.entries(all.byShot)) {
      console.log(`  ${k.padEnd(10)} frames ${String(v.frames).padStart(6)}  headOut ${(100 * v.headOut / v.frames).toFixed(2)} %  occBad ${(100 * v.occBad / v.frames).toFixed(2)} %  speed p95 ${v.speed.pct(0.95).toFixed(2)}  jerk p95 ${v.jerk.pct(0.95).toFixed(1)}  fill p50 ${v.fill.pct(0.5).toFixed(2)}`);
    }
  }
  const json = opt('--json');
  if (json) writeFileSync(json, JSON.stringify({ all: sum, perBout, locks }, null, 1));
}

void main();
