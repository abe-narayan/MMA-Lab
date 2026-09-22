/**
 * BATCH GENERATOR
 *
 * Runs every bout for every format, writes the persisted replay corpus to
 * `public/replays/`, and emits `src/data/replays.ts` for the browser bundle.
 *
 *   npx tsx scripts/generate.ts                    # default run
 *   npx tsx scripts/generate.ts --bouts 1000 --formats 1,2,3,4,5
 *   npx tsx scripts/generate.ts --full             # also write EVERY full replay
 *
 * What lands on disk, and why:
 *   index.json                  run manifest: master seed, params hash, per-format aggregate
 *   1v<N>.summary.csv           one row per bout - winner, method, round, time, counts, digest
 *   1v<N>.analytics.jsonl.gz    the complete BoutAnalytics for every bout (incl. trajectories)
 *   1v<N>/bout-<i>.json         complete ReplayFile INCLUDING the full event timeline,
 *                               for the first --events bouts of each format
 *   1v<N>.replays.jsonl.gz      with --full: the complete ReplayFile for ALL bouts
 *
 * Every bout is reproducible from its seed alone, so the corpus is a
 * convenience, not the source of truth. `npm run verify` re-derives it.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { recordBout, boutSeed, DEFAULT_PARAMS_HASH, REPLAY_FORMAT_VERSION, type ReplayFile } from '../src/engine/recorder';
import { ATHLETE_A, ATHLETE_B } from '../src/engine/fighter';

const argv = process.argv.slice(2);
const arg = (name: string, dflt: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const MASTER_SEED = arg('seed', 'bout-lab-v1');
const BOUTS = Number(arg('bouts', '1000'));
const FORMATS = arg('formats', '1,2,3,4,5').split(',').map(Number);
/** Bouts per format whose stamina/score/damage trajectories ship in the bundle. */
const TRAJ = Number(arg("traj", "120"));
/** Bouts per format written to disk as individual full replay files. */
const EVENT_FILES = Number(arg('events', '100'));
const FULL = argv.includes('--full');

const OUT = join(process.cwd(), 'public', 'replays');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const bundle: Record<number, (number | string)[][]> = {};
const trajectories: Record<number, unknown[][]> = {};
const METHODS: string[] = [];
const manifest: Record<string, unknown> = {
  generatedBy: 'scripts/generate.ts',
  masterSeed: MASTER_SEED,
  replayFormat: REPLAY_FORMAT_VERSION,
  paramsHash: DEFAULT_PARAMS_HASH,
  boutsPerFormat: BOUTS,
  formats: FORMATS,
  trajectoriesBundledPerFormat: Math.min(TRAJ, BOUTS),
  fullReplayFilesPerFormat: FULL ? BOUTS : Math.min(EVENT_FILES, BOUTS),
  disclaimer:
    'Simulated output of a hand-parameterised toy model. No parameter is fitted to real data. ' +
    'These numbers describe the model in src/engine/params.ts and are not a prediction about real people. ' +
    'No injury or medical outcome is modelled; the damage index only triggers an administrative stoppage.',
  perFormat: {} as Record<string, unknown>,
};

const started = Date.now();
for (const n of FORMATS) {
  const t0 = Date.now();
  const dir = join(OUT, `1v${n}`);
  mkdirSync(dir, { recursive: true });

  const analyticsLines: string[] = [];
  const replayLines: string[] = [];
  const csv: string[] = [
    'index,seed,winner,method,round,timeSeconds,totalSeconds,significantActions,landed,missed,blocked,evaded,takedownsAttempted,takedownsLanded,submissionAttempts,knockdowns,aAccuracy,aDamageTaken,aEndStamina,digest',
  ];
  const rows: (number | string)[][] = [];
  const traj: unknown[][] = [];
  let aWins = 0;
  const methods: Record<string, number> = {};

  for (let i = 1; i <= BOUTS; i++) {
    const seed = boutSeed(MASTER_SEED, n, i);
    const replay = recordBout(i, { seed, opponents: n });
    const a = replay.analytics;
    const af = a.perFighter[0];

    if (replay.result.winner === 'A') aWins++;
    methods[replay.result.method] = (methods[replay.result.method] || 0) + 1;

    analyticsLines.push(JSON.stringify(a));
    if (FULL) replayLines.push(JSON.stringify(replay));
    if (i <= EVENT_FILES) {
      writeFileSync(join(dir, `bout-${i}.json`), JSON.stringify(replay));
    }
    csv.push([
      i, seed, replay.result.winner, `"${replay.result.method}"`, replay.result.round,
      replay.result.timeSeconds, a.totalSeconds, a.significantActions, a.actionsLanded,
      a.actionsMissed, a.actionsBlocked, a.actionsEvaded, a.takedownsAttempted,
      a.takedownsLanded, a.submissionAttempts, a.knockdowns, af.accuracy, af.damageTaken,
      af.endStamina, replay.digest,
    ].join(','));

    // Bundle row: compact columnar encoding. The event timeline is dropped
    // (the player re-derives an identical one from the seed) and trajectories
    // are kept, downsampled to every 10 simulated seconds, for the first
    // TRAJ bouts of each format. See src/data/replays.ts for the decoder.
    let mi = METHODS.indexOf(replay.result.method);
    if (mi < 0) { METHODS.push(replay.result.method); mi = METHODS.length - 1; }
    const ps = a.postureSeconds;
    const row: (number | string)[] = [
      i, replay.result.winner === 'A' ? 0 : replay.result.winner === 'B' ? 1 : 2, mi,
      replay.result.round, replay.result.timeSeconds, a.totalSeconds, replay.ticks,
      a.significantActions, a.actionsLanded, a.actionsMissed, a.actionsBlocked, a.actionsEvaded,
      a.takedownsAttempted, a.takedownsLanded, a.submissionAttempts, a.knockdowns, a.positionChanges,
      ps.standing, ps.clinch, ps.ground, ps.down, replay.digest,
    ];
    for (const f of a.perFighter) {
      row.push(f.sigLanded, f.sigAttempted, f.takedownsLanded, f.takedownsAttempted,
               f.damageTaken, f.endStamina, f.out ? 1 : 0);
    }
    rows.push(row);

    if (i <= TRAJ) {
      // Kept at the engine's native 5-second sampling so the dashboard's time
      // axis is correct; only the precision is reduced.
      traj.push([
        i,
        a.staminaTrajectory.map((t) => t.samples.map((v) => Math.round(v * 100))),
        a.damageTrajectory.map((t) => t.samples.map((v) => Math.round(v))),
        a.scoreTrajectory.map((v) => Math.round(v)),
      ]);
    }
  }

  writeFileSync(join(OUT, `1v${n}.analytics.jsonl.gz`), gzipSync(Buffer.from(analyticsLines.join('\n'))));
  writeFileSync(join(OUT, `1v${n}.summary.csv`), csv.join('\n'));
  if (FULL) writeFileSync(join(OUT, `1v${n}.replays.jsonl.gz`), gzipSync(Buffer.from(replayLines.join('\n'))));
  bundle[n] = rows;
  trajectories[n] = traj;

  manifest.perFormat = {
    ...(manifest.perFormat as object),
    [`1v${n}`]: {
      bouts: BOUTS,
      aWins,
      aWinRate: +(aWins / BOUTS).toFixed(4),
      methods,
      seconds: +((Date.now() - t0) / 1000).toFixed(1),
    },
  };
  console.log(`1v${n}: ${BOUTS} bouts in ${((Date.now() - t0) / 1000).toFixed(1)}s  A wins ${aWins}/${BOUTS} (${(100 * aWins / BOUTS).toFixed(1)}%)`);
}

writeFileSync(join(OUT, 'index.json'), JSON.stringify(manifest, null, 2));

// ---- browser bundle ---------------------------------------------------------
// Emitted as a JSON string parsed at module load: much smaller and faster to
// parse than an equivalent JavaScript object literal.
const payload = JSON.stringify({ methods: METHODS, rows: bundle, traj: trajectories });
const ts = `/**
 * GENERATED FILE - do not edit by hand.
 * Written by scripts/generate.ts from master seed ${JSON.stringify(MASTER_SEED)}
 * against parameter hash ${DEFAULT_PARAMS_HASH}. Deliberately carries no
 * timestamp: regenerating from the same seed must produce a byte-identical
 * file, and CI asserts exactly that.
 *
 * ${FORMATS.length} formats x ${BOUTS} bouts, stored in a compact columnar form and
 * expanded at module load. Two things are deliberately NOT stored here:
 *
 *  - the event timeline. The replay player re-executes the engine from the
 *    seed and re-derives a byte-identical timeline; the full timelines are also
 *    written to public/replays/ by this script.
 *  - trajectories beyond the first ${Math.min(TRAJ, BOUTS)} bouts of each format, and the
 *    trajectories that ARE here keep the engine's native 5-second sampling,
 *    stored at reduced precision. Charts report their own sample size.
 *
 * Every row carries its digest, so any bout can be reconstructed and verified.
 */
import type { ReplayFile, BoutAnalytics } from '../engine/recorder';
import { boutSeed } from '../engine/recorder';
import { ATHLETE_A, ATHLETE_B } from '../engine/fighter';
import type { Method } from '../engine/types';

export const MASTER_SEED = ${JSON.stringify(MASTER_SEED)};
export const BOUTS_PER_FORMAT = ${BOUTS};
export const TRAJECTORY_BOUTS_PER_FORMAT = ${Math.min(TRAJ, BOUTS)};
export const TRAJECTORY_SAMPLE_SECONDS = 5;
export const PARAMS_HASH = ${JSON.stringify(DEFAULT_PARAMS_HASH)};

type Packed = {
  methods: string[];
  rows: Record<string, (number | string)[][]>;
  traj: Record<string, [number, number[][], number[][], number[]][]>;
};
const RAW: Packed = JSON.parse(${JSON.stringify(payload)});

const FIGHTER_FIELDS = 7;
const HEAD = 22;

function expand(opponents: number, row: (number | string)[], t?: [number, number[][], number[][], number[]]): ReplayFile {
  const num = (i: number) => row[i] as number;
  const index = num(0);
  const winner = (['A', 'B', 'draw'] as const)[num(1)];
  const method = RAW.methods[num(2)] as Method;
  const labels = ['A', ...Array.from({ length: opponents }, (_, i) => (opponents === 1 ? 'B' : \`B\${i + 1}\`))];

  const perFighter = labels.map((label, k) => {
    const o = HEAD + k * FIGHTER_FIELDS;
    const landed = num(o), attempted = num(o + 1);
    return {
      id: k, label, team: (k === 0 ? 'A' : 'B') as 'A' | 'B',
      sigLanded: landed, sigAttempted: attempted,
      accuracy: attempted ? +(landed / attempted).toFixed(3) : 0,
      takedownsLanded: num(o + 2), takedownsAttempted: num(o + 3),
      damageTaken: num(o + 4), endStamina: num(o + 5), out: num(o + 6) === 1,
    };
  });

  const analytics: BoutAnalytics = {
    index, seed: boutSeed(MASTER_SEED, opponents, index), opponents,
    winner, method, round: num(3), timeSeconds: num(4), totalSeconds: num(5),
    significantActions: num(7), actionsLanded: num(8), actionsMissed: num(9),
    actionsBlocked: num(10), actionsEvaded: num(11),
    takedownsAttempted: num(12), takedownsLanded: num(13),
    submissionAttempts: num(14), knockdowns: num(15), positionChanges: num(16),
    staminaTrajectory: labels.map((label, k) => ({ id: k, label, samples: (t?.[1][k] ?? []).map((v) => v / 100) })),
    scoreTrajectory: t?.[3] ?? [],
    damageTrajectory: labels.map((label, k) => ({ id: k, label, samples: t?.[2][k] ?? [] })),
    postureSeconds: { standing: num(17), clinch: num(18), ground: num(19), down: num(20) },
    perFighter,
  };

  return {
    format: ${REPLAY_FORMAT_VERSION}, seed: analytics.seed, opponents,
    paramsHash: PARAMS_HASH, profiles: { a: ATHLETE_A, b: ATHLETE_B },
    digest: row[21] as string, ticks: num(6),
    result: { winner, method, round: num(3), timeSeconds: num(4), scorecards: [], judgeTotals: [] },
    events: [], analytics,
  };
}

export const REPLAY_INDEX: Record<number, ReplayFile[]> = Object.fromEntries(
  Object.entries(RAW.rows).map(([k, rows]) => {
    const n = Number(k);
    const tmap = new Map((RAW.traj[k] ?? []).map((t) => [t[0], t]));
    return [n, rows.map((r) => expand(n, r, tmap.get(r[0] as number)))];
  })
);
`;
writeFileSync(join(process.cwd(), 'src', 'data', 'replays.ts'), ts);

const size = (p: string) => (existsSync(p) ? (statSync(p).size / 1048576).toFixed(2) + ' MB' : '-');
console.log(`\nbundle  src/data/replays.ts  ${size(join(process.cwd(), 'src', 'data', 'replays.ts'))}`);
console.log(`corpus  public/replays/`);
console.log(`total   ${((Date.now() - started) / 1000).toFixed(1)}s`);
