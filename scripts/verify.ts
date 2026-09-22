/**
 * scripts/verify.ts - replay verification CLI.
 *
 *   npx tsx scripts/verify.ts [--sample=N] [--formats=1,2,3,4,5] [--quiet]
 *
 * A replay file stores a seed, an event timeline and a digest of the per-tick
 * state stream - not the frames themselves. "Verifying" a replay means
 * re-executing the engine from its seed and checking that the state stream it
 * produces fingerprints to the digest recorded in the file, that the file's
 * tick count matches the frames that came back, and that the stored event
 * timeline is the timeline the re-execution actually produced.
 *
 * Two sources are checked:
 *   1. every *.json under public/replays/ (written by the batch generator), and
 *   2. a freshly regenerated sample of bouts for each format, which catches the
 *      case where there are no stored replays at all, or where the engine has
 *      drifted away from the seeds the app will recompute at runtime.
 *
 * Exit code is 0 only if every replay checked verified. Anything else - a
 * mismatched digest, a bad frame count, an unreadable file, a format-version
 * mismatch - exits non-zero so this can be used as a CI gate.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_PARAMS_HASH, recordBout, boutSeed, REPLAY_FORMAT_VERSION, type ReplayFile } from '../src/engine/recorder';
import { loadReplay } from '../src/replay/player';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPLAY_DIR = path.join(ROOT, 'public', 'replays');
const DEFAULT_MASTER_SEED = 'bout-lab-v1';

// ---------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const QUIET = argv.includes('--quiet');
const SAMPLE = Math.max(1, Number(flag('sample', '3')) || 3);
const FORMATS = flag('formats', '1,2,3,4,5').split(',').map((s) => Number(s.trim())).filter((n) => n >= 1);

/**
 * The master seed the app uses. `src/data/replays.ts` is written by the batch
 * generator and may not exist yet, so it is loaded dynamically through a
 * runtime-computed path and falls back to the documented default.
 */
async function resolveMasterSeed(): Promise<{ seed: string; source: string }> {
  const fromEnv = process.env.MASTER_SEED;
  if (fromEnv) return { seed: fromEnv, source: 'MASTER_SEED environment variable' };
  const dataFile = path.join(ROOT, 'src', 'data', 'replays.ts');
  if (fs.existsSync(dataFile)) {
    try {
      const mod = (await import(pathToFileURL(dataFile).href)) as { MASTER_SEED?: string };
      if (typeof mod.MASTER_SEED === 'string' && mod.MASTER_SEED.length > 0) {
        return { seed: mod.MASTER_SEED, source: 'src/data/replays.ts' };
      }
    } catch (err) {
      console.warn(`  ! could not read src/data/replays.ts (${(err as Error).message}); using the default master seed`);
    }
  }
  return { seed: DEFAULT_MASTER_SEED, source: 'built-in default' };
}

// ---------------------------------------------------------------- checking
interface Check { name: string; ok: boolean; detail: string }

/** Re-executes one replay from its seed and compares everything that can be compared. */
function verifyOne(name: string, file: ReplayFile): Check {
  const problems: string[] = [];
  if (file.format !== REPLAY_FORMAT_VERSION) {
    problems.push(`format v${file.format}, this build writes v${REPLAY_FORMAT_VERSION}`);
  }
  let loaded;
  try {
    loaded = loadReplay(file);
  } catch (err) {
    return { name, ok: false, detail: `threw while loading: ${(err as Error).message}` };
  }
  if (!loaded.verified) problems.push(`digest ${loaded.digest} != stored ${file.digest}`);
  if (loaded.frames.length !== file.ticks + 1) {
    problems.push(`reconstructed ${loaded.frames.length} frames, file claims ${file.ticks} ticks`);
  }
  if (loaded.events.length !== file.events.length) {
    problems.push(`re-executed ${loaded.events.length} events, file stores ${file.events.length}`);
  }
  if (JSON.stringify(loaded.file.result) !== JSON.stringify(file.result)) {
    problems.push('result disagrees with the stored result');
  }
  const detail = problems.length
    ? problems.join('; ')
    : `${file.ticks} ticks, ${file.events.length} events, digest ${file.digest}, ${file.result.winner} by ${file.result.method}`;
  return { name, ok: problems.length === 0, detail };
}

/** A stored file may hold one replay, an array of them, or an object wrapping an array. */
function extractReplays(parsed: unknown): ReplayFile[] {
  if (Array.isArray(parsed)) return parsed as ReplayFile[];
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.seed === 'string' && typeof obj.digest === 'string') return [parsed as ReplayFile];
    for (const key of ['replays', 'bouts', 'files', 'data']) {
      if (Array.isArray(obj[key])) return obj[key] as ReplayFile[];
    }
  }
  return [];
}

// ---------------------------------------------------------------- run
const checks: Check[] = [];
const note = (s: string) => { if (!QUIET) console.log(s); };

note('Replay verification');
note('='.repeat(72));

// --- 1. stored replays -------------------------------------------------
let storedFiles: string[] = [];
if (fs.existsSync(REPLAY_DIR)) {
  // Recurse one level: the generator writes per-format subdirectories
  // (public/replays/1v3/bout-7.json). index.json is a run manifest, not a
  // replay, and is handled separately below.
  const walk = (dir: string, prefix = ''): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
      else if (entry.name.endsWith('.json') && rel !== 'index.json') out.push(rel);
    }
    return out;
  };
  storedFiles = walk(REPLAY_DIR).sort();

  // Cross-check the manifest's parameter hash: a corpus generated before a
  // parameter change would otherwise verify against the wrong engine.
  const manifestPath = path.join(REPLAY_DIR, 'index.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { paramsHash?: string };
      if (manifest.paramsHash && manifest.paramsHash !== DEFAULT_PARAMS_HASH) {
        console.error(`  ! corpus was generated with params hash ${manifest.paramsHash}, ` +
          `but src/engine/params.ts now hashes to ${DEFAULT_PARAMS_HASH}. Re-run the generator.`);
        process.exitCode = 1;
      } else if (manifest.paramsHash) {
        note(`  manifest params hash ${manifest.paramsHash} matches the current parameters`);
      }
    } catch (err) {
      console.error(`  ! could not read the run manifest: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  }
}
note(`\nStored replays in public/replays/: ${storedFiles.length ? `${storedFiles.length} file(s)` : 'none found'}`);
if (!storedFiles.length) {
  note('  (nothing to check here - run the batch generator to produce them)');
}
for (const f of storedFiles) {
  const full = path.join(REPLAY_DIR, f);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (err) {
    checks.push({ name: f, ok: false, detail: `unreadable JSON: ${(err as Error).message}` });
    continue;
  }
  const replays = extractReplays(parsed);
  if (!replays.length) {
    checks.push({ name: f, ok: false, detail: 'contains no recognisable replay files' });
    continue;
  }
  let failedHere = 0;
  for (let i = 0; i < replays.length; i++) {
    const check = verifyOne(`${f}[${i}]`, replays[i]);
    checks.push(check);
    if (!check.ok) {
      failedHere++;
      if (failedHere <= 3) note(`  FAIL ${check.name}: ${check.detail}`);
    }
  }
  note(`  ${f}: ${replays.length - failedHere}/${replays.length} verified`);
}

// --- 2. regenerated sample --------------------------------------------
const { seed: MASTER_SEED, source } = await resolveMasterSeed();
note(`\nRegenerated sample (master seed "${MASTER_SEED}" from ${source})`);
note(`  ${SAMPLE} bout(s) per format for formats ${FORMATS.map((n) => `1v${n}`).join(', ')}`);
for (const opponents of FORMATS) {
  let ok = 0;
  for (let index = 1; index <= SAMPLE; index++) {
    const seed = boutSeed(MASTER_SEED, opponents, index);
    let check: Check;
    try {
      check = verifyOne(`regenerated 1v${opponents} #${index}`, recordBout(index, { seed, opponents }));
    } catch (err) {
      check = { name: `regenerated 1v${opponents} #${index}`, ok: false, detail: `threw: ${(err as Error).message}` };
    }
    checks.push(check);
    if (check.ok) ok++;
    else note(`  FAIL ${check.name}: ${check.detail}`);
  }
  note(`  1v${opponents}: ${ok}/${SAMPLE} verified`);
}

// --- 3. report ---------------------------------------------------------
const total = checks.length;
const verified = checks.filter((c) => c.ok).length;
const failed = checks.filter((c) => !c.ok);

console.log('\n' + '='.repeat(72));
console.log(`verified ${verified}/${total} replays`);
if (failed.length) {
  console.error(`\n${failed.length} replay(s) FAILED verification:`);
  for (const f of failed.slice(0, 25)) console.error(`  - ${f.name}: ${f.detail}`);
  if (failed.length > 25) console.error(`  ... and ${failed.length - 25} more`);
  console.error('\nA failure means re-running the stored seed did not reproduce the stored bout.');
  process.exit(1);
}
console.log('every replay reproduced its stored state stream exactly.');
process.exit(0);
