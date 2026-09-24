/**
 * BATCH SIMULATION MODEL — seeds, per-bout summaries and the aggregate.
 *
 * Pure and environment-free, so the workers, the main-thread fallback and the
 * tests all share it. Two properties the Batch screen promises rest here:
 *
 *   1. **Deterministic seeds per bout.** Bout i of a batch is always
 *      `boutSeed(master, 'batch', i)` (09 §6), whichever worker runs it.
 *   2. **Worker count cannot change the answer.** Summaries are keyed by bout
 *      index and `aggregate` sorts by index before it reads them, so the
 *      order bouts *finish* in (which does depend on scheduling) never reaches
 *      a number on screen. `fingerprint` hashes the digests in index order to
 *      make that checkable at a glance.
 */

import {
  boutSeed, type BoutMethod, type BoutRun, type SimConfig,
} from '../../sim';

export const BATCH_SIZES = [10, 100, 1000, 5000] as const;
export const BATCH_MAX = 20000;
export const MAX_WORKERS = 4;

/** navigator.hardwareConcurrency minus two, clamped to 1..MAX_WORKERS. */
export function workerCountFor(hardwareConcurrency: number | undefined): number {
  const cores = Number.isFinite(hardwareConcurrency) && (hardwareConcurrency as number) > 0 ? (hardwareConcurrency as number) : 4;
  return Math.max(1, Math.min(MAX_WORKERS, Math.floor(cores) - 2));
}

export function batchBoutSeed(master: string, index: number): string {
  return boutSeed(master, 'batch', index);
}

/** The per-bout config: the template with bout i's seed. */
export function batchConfig(template: Omit<SimConfig, 'seed'>, master: string, index: number): SimConfig {
  return { ...template, seed: batchBoutSeed(master, index) };
}

/**
 * How the batch charts group a bout's method. `other` holds the endings that
 * are neither a finish nor the scorecards nor a draw: a disqualification, and
 * the street/team outcomes where a fighter escapes or the fight is separated.
 * `draw` is kept for real draws and no contests.
 */
export type MethodClass = 'ko' | 'sub' | 'dec' | 'other' | 'draw';

export function methodClass(m: BoutMethod): MethodClass {
  if (m === 'ko' || m.startsWith('tko') || m === 'allOpponentsStopped') return 'ko';
  if (m.startsWith('submission')) return 'sub';
  if (m.startsWith('decision') || m === 'timeLimit') return 'dec';
  if (m === 'dq' || m === 'escaped' || m === 'separated') return 'other';
  return 'draw';
}

export interface FighterLine {
  sigL: number;
  sigA: number;
  kd: number;
  tdL: number;
  tdA: number;
  sub: number;
  ctrl: number;
}

/** Everything the aggregate needs from one bout, ~120 bytes. */
export interface BoutSummary {
  index: number;
  winner: number | 'draw' | 'none';
  method: BoutMethod;
  round: number;
  totalSeconds: number;
  digest: string;
  f: [FighterLine, FighterLine];
}

export function summarise(index: number, run: BoutRun): BoutSummary {
  const line = (i: number): FighterLine => {
    const s = run.stats.fighters[i];
    return {
      sigL: s?.sig.landed ?? 0,
      sigA: s?.sig.attempted ?? 0,
      kd: s?.knockdowns ?? 0,
      tdL: s?.takedowns.landed ?? 0,
      tdA: s?.takedowns.attempted ?? 0,
      sub: s?.subAttempts ?? 0,
      ctrl: s?.controlSeconds ?? 0,
    };
  };
  return {
    index,
    winner: run.result.winner,
    method: run.result.method,
    round: run.result.round,
    totalSeconds: run.result.totalSeconds,
    digest: run.digest,
    f: [line(0), line(1)],
  };
}

// --------------------------------------------------------------------------
// Statistics
// --------------------------------------------------------------------------

export interface Interval { value: number; lo: number; hi: number }

/** Wilson score interval for a proportion (95 %). */
export function wilson(successes: number, n: number, z = 1.96): Interval {
  if (n <= 0) return { value: 0, lo: 0, hi: 0 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { value: p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

/** Mean with a 95 % normal-approximation interval (t is ~z above n = 30). */
export function meanCi(values: readonly number[], z = 1.96): Interval {
  const n = values.length;
  if (n === 0) return { value: 0, lo: 0, hi: 0 };
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;
  if (n === 1) return { value: mean, lo: mean, hi: mean };
  let ss = 0;
  for (const v of values) ss += (v - mean) ** 2;
  const se = Math.sqrt(ss / (n - 1) / n);
  return { value: mean, lo: mean - z * se, hi: mean + z * se };
}

export interface FighterAggregate {
  wins: Interval;
  methods: Record<MethodClass, number>;
  sigLandedPerMin: Interval;
  sigAccuracy: Interval;
  knockdowns: Interval;
  takedownsPer15: Interval;
  tdAccuracy: Interval;
  subAttempts: Interval;
  controlMinutes: Interval;
}

export interface BatchAggregate {
  n: number;
  draws: Interval;
  finishRate: Interval;
  /** Fraction of all bouts by method class (winner-agnostic). */
  methodMix: Record<MethodClass, number>;
  /** Finishes by the round they happened in (index 0 = round 1). */
  finishRounds: number[];
  decisions: number;
  duration: Interval;
  fighters: [FighterAggregate, FighterAggregate];
  fingerprint: string;
}

function fnv1a(text: string, h = 0x811c9dc5): number {
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A short hash of every bout's digest, in index order. */
export function fingerprint(summaries: readonly BoutSummary[]): string {
  const sorted = [...summaries].sort((a, b) => a.index - b.index);
  let h = 0x811c9dc5;
  for (const s of sorted) h = fnv1a(`${s.index}:${s.digest};`, h);
  return h.toString(16).padStart(8, '0');
}

export function aggregate(input: readonly BoutSummary[]): BatchAggregate {
  const all = [...input].sort((a, b) => a.index - b.index);
  const n = all.length;
  const methodMix: Record<MethodClass, number> = { ko: 0, sub: 0, dec: 0, other: 0, draw: 0 };
  const finishRounds: number[] = [];
  let decisions = 0;
  let finishes = 0;
  let draws = 0;
  const durations: number[] = [];

  const per = [0, 1].map(() => ({
    wins: 0,
    methods: { ko: 0, sub: 0, dec: 0, other: 0, draw: 0 } as Record<MethodClass, number>,
    slpm: [] as number[], kd: [] as number[], td15: [] as number[], sub: [] as number[], ctrl: [] as number[],
    sigL: 0, sigA: 0, tdL: 0, tdA: 0,
  }));

  for (const s of all) {
    const cls = methodClass(s.method);
    methodMix[cls] += 1;
    durations.push(s.totalSeconds / 60);
    if (typeof s.winner === 'number') {
      if (cls === 'ko' || cls === 'sub') {
        finishes += 1;
        const r = Math.max(1, s.round) - 1;
        while (finishRounds.length <= r) finishRounds.push(0);
        finishRounds[r] += 1;
      } else if (cls === 'dec') {
        decisions += 1;
      }
      // A DQ (or an escape/separation) win is neither a finish nor a decision.
      const w = per[s.winner];
      if (w) {
        w.wins += 1;
        w.methods[cls] += 1;
      }
    } else {
      draws += 1;
      if (cls === 'dec') decisions += 1;
    }
    const minutes = Math.max(1e-6, s.totalSeconds / 60);
    s.f.forEach((f, i) => {
      const p = per[i];
      p.slpm.push(f.sigL / minutes);
      p.kd.push(f.kd);
      p.td15.push((f.tdL / minutes) * 15);
      p.sub.push(f.sub);
      p.ctrl.push(f.ctrl / 60);
      p.sigL += f.sigL; p.sigA += f.sigA; p.tdL += f.tdL; p.tdA += f.tdA;
    });
  }

  const fighter = (i: number): FighterAggregate => {
    const p = per[i];
    return {
      wins: wilson(p.wins, n),
      methods: p.methods,
      sigLandedPerMin: meanCi(p.slpm),
      sigAccuracy: wilson(p.sigL, p.sigA),
      knockdowns: meanCi(p.kd),
      takedownsPer15: meanCi(p.td15),
      tdAccuracy: wilson(p.tdL, p.tdA),
      subAttempts: meanCi(p.sub),
      controlMinutes: meanCi(p.ctrl),
    };
  };

  for (const k of Object.keys(methodMix) as MethodClass[]) methodMix[k] = n > 0 ? methodMix[k] / n : 0;

  return {
    n,
    draws: wilson(draws, n),
    finishRate: wilson(finishes, n),
    methodMix,
    finishRounds,
    decisions,
    duration: meanCi(durations),
    fighters: [fighter(0), fighter(1)],
    fingerprint: fingerprint(all),
  };
}

// --------------------------------------------------------------------------
// ETA
// --------------------------------------------------------------------------

/**
 * A steady ETA: completed bouts over elapsed wall time, blended with an
 * exponentially smoothed recent rate so a slow start (worker spin-up, JIT)
 * does not dominate, and withheld until there is enough signal to mean
 * something. Returns seconds, or null while it would be a guess.
 */
export class EtaEstimator {
  private startMs: number | null = null;
  private lastMs = 0;
  private lastDone = 0;
  private ema: number | null = null;

  constructor(private readonly alpha = 0.25) {}

  update(nowMs: number, done: number, total: number): number | null {
    if (this.startMs === null) {
      this.startMs = nowMs;
      this.lastMs = nowMs;
      this.lastDone = done;
      return null;
    }
    const dt = (nowMs - this.lastMs) / 1000;
    if (dt >= 0.5 && done > this.lastDone) {
      const rate = (done - this.lastDone) / dt;
      this.ema = this.ema === null ? rate : this.alpha * rate + (1 - this.alpha) * this.ema;
      this.lastMs = nowMs;
      this.lastDone = done;
    }
    const elapsed = (nowMs - this.startMs) / 1000;
    if (done < 3 || elapsed < 2 || this.ema === null) return null;
    const overall = done / elapsed;
    const rate = 0.5 * overall + 0.5 * this.ema;
    return rate > 0 ? (total - done) / rate : null;
  }

  rate(nowMs: number, done: number): number {
    if (this.startMs === null) return 0;
    const elapsed = (nowMs - this.startMs) / 1000;
    return elapsed > 0 ? done / elapsed : 0;
  }
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
