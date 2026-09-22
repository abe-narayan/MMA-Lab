/**
 * scripts/exportBout.ts - dump one bout as raw, tick-by-tick frames.
 *
 *   npx tsx scripts/exportBout.ts <opponents> <index>
 *   npx tsx scripts/exportBout.ts 3 42
 *
 * Writes `exports/bout-1v<N>-<index>.json`.
 *
 * Shipped replay files store a seed, an event timeline and a digest - about
 * 30 KB - because the engine is a pure function of its seed and can rebuild
 * every frame on demand. That is the right trade for shipping thousands of
 * bouts inside one page, but it is the wrong format for looking at the raw
 * state stream in another tool. This script produces the other form: the
 * complete `TickSnapshot` for every tick of the bout, alongside the replay
 * metadata, the event timeline and the analytics block, so the dump is
 * self-describing.
 *
 * The bout is the SAME bout the app shows for that format and index, because
 * the seed is built with the same `boutSeed(MASTER_SEED, opponents, index)`.
 *
 * Expect a few megabytes per bout. That size difference is the whole argument
 * for the seed-plus-events replay format.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { recordBout, boutSeed, REPLAY_FORMAT_VERSION } from '../src/engine/recorder';
import { loadReplay } from '../src/replay/player';
import { DEFAULT_PARAMS } from '../src/engine/params';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'exports');
const DEFAULT_MASTER_SEED = 'bout-lab-v1';
const MAX_OPPONENTS = 5;

function usage(message: string): never {
  console.error(`error: ${message}`);
  console.error('');
  console.error('usage: npx tsx scripts/exportBout.ts <opponents> <index>');
  console.error(`  opponents   number of Athlete-B-side opponents, 1..${MAX_OPPONENTS}`);
  console.error('  index       bout number within that format, 1 or greater');
  console.error('');
  console.error('example: npx tsx scripts/exportBout.ts 3 42');
  console.error('         -> exports/bout-1v3-42.json');
  console.error('');
  console.error('The master seed is taken from $MASTER_SEED, else src/data/replays.ts,');
  console.error(`else the built-in default "${DEFAULT_MASTER_SEED}".`);
  process.exit(2);
}

/** Matches the master seed the app uses, so the dump is the bout the UI shows. */
async function resolveMasterSeed(): Promise<{ seed: string; source: string }> {
  if (process.env.MASTER_SEED) return { seed: process.env.MASTER_SEED, source: '$MASTER_SEED' };
  const dataFile = path.join(ROOT, 'src', 'data', 'replays.ts');
  if (fs.existsSync(dataFile)) {
    try {
      const mod = (await import(pathToFileURL(dataFile).href)) as { MASTER_SEED?: string };
      if (typeof mod.MASTER_SEED === 'string' && mod.MASTER_SEED) {
        return { seed: mod.MASTER_SEED, source: 'src/data/replays.ts' };
      }
    } catch { /* fall through to the default */ }
  }
  return { seed: DEFAULT_MASTER_SEED, source: 'built-in default' };
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// ---------------------------------------------------------------- arguments
const [rawOpponents, rawIndex, ...rest] = process.argv.slice(2);
if (rawOpponents === undefined || rawIndex === undefined) usage('expected two arguments');
if (rest.length) usage(`unexpected extra argument "${rest[0]}"`);

const opponents = Number(rawOpponents);
const index = Number(rawIndex);
if (!Number.isInteger(opponents) || opponents < 1 || opponents > MAX_OPPONENTS) {
  usage(`<opponents> must be an integer from 1 to ${MAX_OPPONENTS}, got "${rawOpponents}"`);
}
if (!Number.isInteger(index) || index < 1) {
  usage(`<index> must be an integer of 1 or more, got "${rawIndex}"`);
}

// ---------------------------------------------------------------- export
const { seed: masterSeed, source } = await resolveMasterSeed();
const seed = boutSeed(masterSeed, opponents, index);

console.log(`Exporting bout 1v${opponents} #${index}`);
console.log(`  master seed : ${masterSeed}  (${source})`);
console.log(`  bout seed   : ${seed}`);

const t0 = Date.now();
const file = recordBout(index, { seed, opponents });
const loaded = loadReplay(file);
const simMs = Date.now() - t0;

if (!loaded.verified) {
  console.error(`\nFATAL: the bout did not reproduce its own digest (${loaded.digest} != ${file.digest}).`);
  console.error('The export would not be a faithful record of the bout, so nothing was written.');
  process.exit(1);
}
if (loaded.frames.length !== file.ticks + 1) {
  console.error(`\nFATAL: expected ${file.ticks + 1} frames, reconstructed ${loaded.frames.length}.`);
  process.exit(1);
}

const dump = {
  kind: 'full-frame-dump' as const,
  note:
    'Every tick of this bout, expanded. Shipped replays store seed + events + digest instead; ' +
    'see README.md. The damage index is an abstract modelling quantity, not a medical one.',
  format: REPLAY_FORMAT_VERSION,
  exportedAt: new Date().toISOString(),
  masterSeed,
  seed: file.seed,
  opponents: file.opponents,
  index,
  paramsHash: file.paramsHash,
  tickSeconds: DEFAULT_PARAMS.dt,
  ticks: file.ticks,
  frameCount: loaded.frames.length,
  digest: file.digest,
  verified: loaded.verified,
  fighterLabels: loaded.fighterLabels,
  durationSeconds: loaded.durationSeconds,
  profiles: file.profiles,
  result: file.result,
  analytics: file.analytics,
  events: file.events,
  eventFrameIndex: loaded.eventFrameIndex,
  frames: loaded.frames,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const outPath = path.join(OUT_DIR, `bout-1v${opponents}-${index}.json`);
const json = JSON.stringify(dump);
fs.writeFileSync(outPath, json);
const bytes = fs.statSync(outPath).size;

const replayBytes = Buffer.byteLength(JSON.stringify(file), 'utf8');
const rel = path.relative(process.cwd(), outPath) || outPath;

console.log(`  verified    : yes (digest ${file.digest})`);
console.log(`  result      : ${file.result.winner} by ${file.result.method}, round ${file.result.round} at ${file.result.timeSeconds.toFixed(1)}s`);
console.log(`  frames      : ${loaded.frames.length} (${file.ticks} ticks x ${DEFAULT_PARAMS.dt}s = ${(file.ticks * DEFAULT_PARAMS.dt).toFixed(1)}s simulated)`);
console.log(`  events      : ${file.events.length}`);
console.log(`  simulated in: ${simMs} ms`);
console.log('');
console.log(`Wrote ${rel}`);
console.log(`  size        : ${humanBytes(bytes)} (${bytes.toLocaleString('en-US')} bytes)`);
console.log(`  compare     : the shipped replay for this bout is ${humanBytes(replayBytes)} ` +
  `(${(bytes / Math.max(1, replayBytes)).toFixed(0)}x smaller)`);
