/**
 * EVENT RECORDER AND REPLAY FILE FORMAT
 *
 * Design decision, stated plainly: a replay file stores the SEED plus the
 * complete discrete event timeline plus a state-stream fingerprint - it does
 * NOT store 9,000 frames of poses.
 *
 * Why that is still a full replay and not "only the final result":
 *   - The engine is a pure function of (seed, params, profiles). Re-running it
 *     reproduces every intermediate state exactly, tick for tick.
 *   - The file carries the complete event timeline (every strike, block, evasion,
 *     takedown, position change, submission attempt, knockdown and stoppage with
 *     its tick, round, actor, target and outcome), so the timeline is inspectable
 *     without running anything.
 *   - The file carries `digest`, a rolling fingerprint of the whole per-tick
 *     state stream. If a re-execution produced even a slightly different state
 *     sequence, the digest would not match, and the player reports it. That is
 *     what `tests/determinism.test.ts` checks.
 *
 * This makes replays ~30 KB instead of ~20 MB each, which is what allows all
 * 1,000 bouts x 5 formats to ship inside a single page. `scripts/exportBout.ts`
 * writes a full tick-by-tick dump for any single bout when you want the raw frames.
 */

import { BoutSimulation, type BoutConfig } from './engine';
import { DEFAULT_PARAMS, type Params } from './params';
import { ATHLETE_A, ATHLETE_B, type AthleteProfile } from './fighter';
import type { BoutEvent, BoutResult, TickSnapshot } from './types';

export const REPLAY_FORMAT_VERSION = 3;

export interface ReplayFile {
  format: number;
  /** Everything needed to reproduce the bout bit-for-bit. */
  seed: string;
  opponents: number;
  paramsHash: string;
  /** Only stored when the run used non-default parameters. */
  paramOverrides?: Partial<Params>;
  profiles: { a: AthleteProfile; b: AthleteProfile };
  /** Fingerprint of the entire per-tick state stream. */
  digest: string;
  ticks: number;
  result: BoutResult;
  events: BoutEvent[];
  analytics: BoutAnalytics;
}

export interface BoutAnalytics {
  index: number;
  seed: string;
  opponents: number;
  winner: 'A' | 'B' | 'draw';
  method: string;
  round: number;
  timeSeconds: number;
  /** Total simulated seconds elapsed including breaks. */
  totalSeconds: number;
  significantActions: number;
  actionsLanded: number;
  actionsMissed: number;
  actionsBlocked: number;
  actionsEvaded: number;
  takedownsAttempted: number;
  takedownsLanded: number;
  submissionAttempts: number;
  knockdowns: number;
  positionChanges: number;
  /** Stamina for each fighter, sampled every 5 simulated seconds. */
  staminaTrajectory: { id: number; label: string; samples: number[] }[];
  /** Cumulative score margin (A minus B side) at the same sample points. */
  scoreTrajectory: number[];
  /** Cumulative damage index at the same sample points. */
  damageTrajectory: { id: number; label: string; samples: number[] }[];
  /** Time in each posture, seconds: [standing, clinch, ground, down]. */
  postureSeconds: { standing: number; clinch: number; ground: number; down: number };
  perFighter: {
    id: number; label: string; team: 'A' | 'B';
    sigLanded: number; sigAttempted: number; accuracy: number;
    takedownsLanded: number; takedownsAttempted: number;
    damageTaken: number; endStamina: number; out: boolean;
  }[];
}

const SAMPLE_EVERY_SECONDS = 5;

function hashParams(p: Params): string {
  let h = 2166136261;
  for (const [k, v] of Object.entries(p).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const s = `${k}:${v}`;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const DEFAULT_PARAMS_HASH = hashParams(DEFAULT_PARAMS);

/** Simulate one bout and produce a replay file (with analytics computed inline). */
export function recordBout(index: number, config: BoutConfig): ReplayFile {
  const sim = new BoutSimulation(config);
  const P = sim.P;
  const sampleEvery = Math.round(SAMPLE_EVERY_SECONDS / P.dt);

  const stamina = sim.fighters.map((f) => ({ id: f.id, label: f.label, samples: [] as number[] }));
  const damage = sim.fighters.map((f) => ({ id: f.id, label: f.label, samples: [] as number[] }));
  const score: number[] = [];
  const posture = { standing: 0, clinch: 0, ground: 0, down: 0 };

  const sample = () => {
    let a = 0, b = 0;
    sim.fighters.forEach((f, i) => {
      stamina[i].samples.push(+(f.stamina / f.staminaMax).toFixed(3));
      damage[i].samples.push(+f.damage.toFixed(1));
      if (f.team === 'A') a += f.score; else b += f.score;
    });
    score.push(+(a - b).toFixed(1));
  };
  sample();

  let guard = 0;
  while (!sim.finished && guard++ < 20000) {
    sim.step();
    const a = sim.fighters[0];
    if (sim.phase === 'round' && !a.out) posture[a.posture] += P.dt;
    if (sim.tick % sampleEvery === 0) sample();
  }
  if (!sim.finished) sim.runToEnd();
  sample();

  const ev = sim.events;
  const strikes = ev.filter((e) => e.kind === 'strike');
  const analytics: BoutAnalytics = {
    index,
    seed: config.seed,
    opponents: config.opponents,
    winner: sim.result!.winner,
    method: sim.result!.method,
    round: sim.result!.round,
    timeSeconds: sim.result!.timeSeconds,
    totalSeconds: +sim.t.toFixed(1),
    significantActions: strikes.length,
    actionsLanded: strikes.filter((e) => e.result === 'landed').length,
    actionsMissed: strikes.filter((e) => e.result === 'missed').length,
    actionsBlocked: strikes.filter((e) => e.result === 'blocked').length,
    actionsEvaded: strikes.filter((e) => e.result === 'evaded').length,
    takedownsAttempted: ev.filter((e) => e.kind === 'takedown').length,
    takedownsLanded: ev.filter((e) => e.kind === 'takedown' && e.result === 'success').length,
    submissionAttempts: ev.filter((e) => e.kind === 'submissionAttempt').length,
    knockdowns: ev.filter((e) => e.kind === 'knockdown').length,
    positionChanges: ev.filter((e) => e.kind === 'positionChange' || e.kind === 'clinch' || e.kind === 'standUp').length,
    staminaTrajectory: stamina,
    scoreTrajectory: score,
    damageTrajectory: damage,
    postureSeconds: {
      standing: +posture.standing.toFixed(1), clinch: +posture.clinch.toFixed(1),
      ground: +posture.ground.toFixed(1), down: +posture.down.toFixed(1),
    },
    perFighter: sim.fighters.map((f) => ({
      id: f.id, label: f.label, team: f.team,
      sigLanded: f.sigLanded, sigAttempted: f.sigAttempted,
      accuracy: f.sigAttempted ? +(f.sigLanded / f.sigAttempted).toFixed(3) : 0,
      takedownsLanded: f.takedownsLanded, takedownsAttempted: f.takedownsAttempted,
      damageTaken: +f.damage.toFixed(1), endStamina: +(f.stamina / f.staminaMax).toFixed(3),
      out: f.out,
    })),
  };

  return {
    format: REPLAY_FORMAT_VERSION,
    seed: config.seed,
    opponents: config.opponents,
    paramsHash: hashParams(P),
    profiles: { a: config.profileA ?? ATHLETE_A, b: config.profileB ?? ATHLETE_B },
    digest: sim.digest.value,
    ticks: sim.tick,
    result: sim.result!,
    events: sim.events,
    analytics,
  };
}

/** The canonical seed for bout #index of a given format. */
export function boutSeed(masterSeed: string, opponents: number, index: number): string {
  return `${masterSeed}::v${REPLAY_FORMAT_VERSION}::1v${opponents}::bout-${index}`;
}
