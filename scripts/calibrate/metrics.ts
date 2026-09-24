/**
 * THE 129 MASTER ROWS — docs/design/09 §7.1 (targets and tolerances from
 * research/FIGHT_DATA.md §3), one pure function per row.
 *
 * Each row maps to a `compute(d: Dataset) => MetricResult` or carries an
 * explicit `unmeasurable` reason. A result is one or more components; each
 * component is judged by the §6.6 rule (`stats.ts verdictOf`) and a row passes
 * when every gated component passes. `class` rows pass when at least 6 of the
 * 8 men's classes pass (and, where women's classes are in the row, all but one
 * of them) — the §7.1 preamble.
 *
 * Conventions used below (stated once, applied everywhere):
 *   - Rates "per fighter per minute" are pooled Σcount / Σfighter-minutes, with
 *     fighter-minutes = 2 x fight minutes of each 1v1 bout (breaks excluded).
 *   - Proportions are over bouts unless the row says fighter-bouts.
 *   - A target range "a–b" becomes target (a+b)/2 with the half-range added to
 *     the stated tolerance; "±20 % relative" becomes tol = 0.2 x target.
 *   - KO/TKO includes every `tko.*` method (doctor, corner, retirement), as
 *     UFCStats records them; "other" is draws, no contests and DQs.
 */
import type { ResultRow } from '../batch/types';
import {
  Dataset, MEN_CODES, WOMEN_CODES, cardTotals, fighterUnits, fmin, isDec, isDraw, isFinish, isKoTko, isOther,
  isSub, ptLA, winLose,
} from './data';
import {
  NONE, mean, median, proportion, quotient, ratio, sd, verdictOf, zOf, type Estimate, type Verdict,
} from './stats';

export type Unit = 'pct' | 'num' | 'min' | 's' | 'bool';

export interface Comp {
  label: string;
  est: Estimate;
  target: number;
  tol: number;
  unit: Unit;
  /** Class code for per-class rows. */
  grp?: string;
  /** Reported but not gated. */
  info?: boolean;
  /**
   * `band` (default): |v − target| ≤ tol and CI ≤ tol/2 (§6.6).
   * `ge` / `le`: one-sided threshold at `target` (tol unused): PASS when the
   * whole CI clears it, WIDE when only the point estimate does, FAIL otherwise.
   */
  kind?: 'band' | 'ge' | 'le';
  /** A verdict decided by the caller (composite criteria such as T8). */
  forced?: Verdict;
}

export interface MetricResult {
  comps: Comp[];
  note?: string;
}

export type RowStatus = 'core' | 'class' | 'proxy' | 'n/a';

export interface MasterRow {
  id: number;
  section: string;
  metric: string;
  target: string;
  tolerance: string;
  owner: string;
  status: RowStatus;
  /** Population / plan the row is computed on. */
  population: string;
  compute?: (d: Dataset) => MetricResult;
  /** Set when the row cannot be computed by this sim (with the reason). */
  unmeasurable?: string;
}

// ---------------------------------------------------------------------------
// Component helpers
// ---------------------------------------------------------------------------

const P = (label: string, est: Estimate, target: number, tol: number, extra: Partial<Comp> = {}): Comp =>
  ({ label, est, target, tol, unit: 'pct', ...extra });
const N = (label: string, est: Estimate, target: number, tol: number, extra: Partial<Comp> = {}): Comp =>
  ({ label, est, target, tol, unit: 'num', ...extra });
const M = (label: string, est: Estimate, target: number, tol: number, extra: Partial<Comp> = {}): Comp =>
  ({ label, est, target, tol, unit: 'min', ...extra });
const S = (label: string, est: Estimate, target: number, tol: number, extra: Partial<Comp> = {}): Comp =>
  ({ label, est, target, tol, unit: 's', ...extra });

const sum = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);
const sumBoth = (r: ResultRow, pick: (f: ResultRow['f'][number]) => number): number => sum(r.f.map(pick));
const oneVone = (rows: readonly ResultRow[]): ResultRow[] => rows.filter((r) => r.f.length === 2 && r.res.fs > 0);

/** Pooled per-fighter-minute rate (x `scale`). */
function perFighterMin(rows: readonly ResultRow[], pick: (f: ResultRow['f'][number]) => number, scale = 1): Estimate {
  const rs = oneVone(rows);
  return ratio(rs.map((r) => sumBoth(r, pick)), rs.map((r) => 2 * fmin(r)), scale);
}

/** Pooled Σlanded / Σattempted over both fighters. */
function accuracy(rows: readonly ResultRow[], la: (f: ResultRow['f'][number]) => [number, number]): Estimate {
  const rs = oneVone(rows);
  return ratio(rs.map((r) => sumBoth(r, (f) => la(f)[0])), rs.map((r) => sumBoth(r, (f) => la(f)[1])));
}

/** Share of bouts satisfying `pred`. */
function share(rows: readonly ResultRow[], pred: (r: ResultRow) => boolean): Estimate {
  return proportion(rows.filter(pred).length, rows.length);
}

/** One component per class, for the `class` rows. */
function perClass(
  d: Dataset, codes: readonly string[], targets: Readonly<Record<string, number>>, tol: number | ((t: number) => number),
  est: (rows: ResultRow[]) => Estimate, unit: Unit, label = '',
): Comp[] {
  return codes.filter((c) => targets[c] !== undefined).map((c) => {
    const t = targets[c];
    return { label: `${c}${label ? ` ${label}` : ''}`, est: est(d.byClass(c)), target: t, tol: typeof tol === 'number' ? tol : tol(t), unit, grp: c };
  });
}

const rel20 = (t: number): number => 0.2 * t;

const METHOD_KEYS = ['ko', 'sub', 'dec', 'other'] as const;
function methodShare(rows: readonly ResultRow[], k: (typeof METHOD_KEYS)[number]): Estimate {
  const pred = k === 'ko' ? isKoTko : k === 'sub' ? isSub : k === 'dec' ? isDec : isOther;
  return share(rows, (r) => pred(r.res.m));
}

/** Knockdowns scored by a head strike (not the body / leg collapse kinds). */
const headKd = (kind: string): boolean => kind !== 'body' && kind !== 'leg';

/** Distance power-head (non-jab) sig strikes `[landed, attempted]`. */
function powerHead(f: ResultRow['f'][number]): [number, number] {
  const [l, a] = ptLA(f, 'distance', 'head');
  return [l - f.jab[0], a - f.jab[1]];
}

function winnerRate(rows: readonly ResultRow[], side: 'w' | 'l', pick: (f: ResultRow['f'][number]) => number, per: (r: ResultRow) => number): Estimate {
  const rs = oneVone(rows).filter((r) => winLose(r) !== null);
  return ratio(rs.map((r) => pick(winLose(r)![side === 'w' ? 0 : 1])), rs.map(per));
}

function winnerAcc(rows: readonly ResultRow[], side: 'w' | 'l', la: (f: ResultRow['f'][number]) => [number, number]): Estimate {
  const rs = oneVone(rows).filter((r) => winLose(r) !== null);
  return ratio(rs.map((r) => la(winLose(r)![side === 'w' ? 0 : 1])[0]), rs.map((r) => la(winLose(r)![side === 'w' ? 0 : 1])[1]));
}

/** Win rate of the `bt.edge` fighter in a sweep / edge cell. */
export function edgeWinRate(rows: readonly ResultRow[]): Estimate {
  const rs = rows.filter((r) => r.bt?.edge !== undefined);
  const decided = rs.filter((r) => typeof r.res.w === 'number');
  // Draws count as half a win (standard for win-rate targets).
  const wins = decided.filter((r) => r.res.w === r.bt!.edge).length + 0.5 * (rs.length - decided.length);
  return proportion(wins, rs.length);
}

/** Round-level KD rate per head sig landed, scaled to per distance power-head landed. */
function kdRateByRound(rows: readonly ResultRow[], round: number): Estimate {
  const rs = oneVone(rows);
  // Scale factor: distance power-head landed / all head sig landed, pooled.
  const dph = sum(rs.map((r) => sumBoth(r, (f) => powerHead(f)[0])));
  const hl = sum(rs.map((r) => sumBoth(r, (f) => ptLA(f, null, 'head')[0])));
  const k = hl > 0 ? dph / hl : 1;
  const reached = rs.filter((r) => r.res.r >= round);
  return ratio(
    reached.map((r) => r.kd.filter((x) => x[0] === round && headKd(x[5])).length),
    reached.map((r) => k * sumBoth(r, (f) => f.rhl[round - 1] ?? 0)),
  );
}

function decisions(rows: readonly ResultRow[]): ResultRow[] {
  return oneVone(rows).filter((r) => isDec(r.res.m) && typeof r.res.w === 'number');
}

/** Among decisions where `more(f) > more(opp)`, the share won by that fighter. */
function decWonByMore(rows: readonly ResultRow[], key: (f: ResultRow['f'][number]) => number): Estimate {
  let k = 0;
  let n = 0;
  for (const r of decisions(rows)) {
    const a = key(r.f[0]);
    const b = key(r.f[1]);
    if (a === b) continue;
    n++;
    if ((a > b ? 0 : 1) === r.res.w) k++;
  }
  return proportion(k, n);
}

function finishesByRoundShare(rows: readonly ResultRow[], round: number | [number, number]): Estimate {
  const fin = rows.filter((r) => isFinish(r.res.m));
  const [lo, hi] = typeof round === 'number' ? [round, round] : round;
  return share(fin, (r) => r.res.r >= lo && r.res.r <= hi);
}

function bool(label: string, ok: boolean | null, info = false): Comp {
  return { label, est: ok === null ? NONE : { value: ok ? 1 : 0, ci: 0, n: 1 }, target: 1, tol: 0, unit: 'bool', info };
}

// ---------------------------------------------------------------------------
// Class tables
// ---------------------------------------------------------------------------

const T = (o: Record<string, number>): Record<string, number> => o;
const SLPM_CLASS = T({ FLW: 3.5, BW: 3.9, FW: 4.0, LW: 3.9, WW: 3.7, MW: 3.7, LHW: 3.9, HW: 3.7 });
const SATT_CLASS = T({ FLW: 7.8, BW: 8.7, FW: 8.8, LW: 8.6, WW: 8.1, MW: 7.9, LHW: 7.8, HW: 7.5 });
const SACC_CLASS = T({ FLW: 0.44, BW: 0.45, FW: 0.45, LW: 0.46, WW: 0.46, MW: 0.47, LHW: 0.49, HW: 0.50 });
const W_SLPM = T({ 'W-SW': 4.1, 'W-FLW': 4.0, 'W-BW': 3.7 });
const W_SATT = T({ 'W-SW': 9.1, 'W-FLW': 9.3, 'W-BW': 8.1 });
const W_SACC = T({ 'W-SW': 0.45, 'W-FLW': 0.43, 'W-BW': 0.46 });
const KD15_CLASS = T({ FLW: 0.29, BW: 0.32, FW: 0.33, LW: 0.31, WW: 0.36, MW: 0.35, LHW: 0.44, HW: 0.33 });
const W_KD15 = T({ 'W-SW': 0.10, 'W-FLW': 0.10, 'W-BW': 0.12 });
const KD100_CLASS = T({ FLW: 0.87, BW: 0.90, FW: 0.88, LW: 0.83, WW: 1.03, MW: 0.98, LHW: 1.20, HW: 0.92, 'W-SW': 0.305, 'W-FLW': 0.305, 'W-BW': 0.305 });
const KDKO_CLASS = T({ FLW: 0.53, BW: 0.58, FW: 0.59, LW: 0.67, WW: 0.65, MW: 0.69, LHW: 0.75, HW: 0.84, 'W-SW': 0.44, 'W-FLW': 0.47, 'W-BW': 0.53 });
const KO100SIG_CLASS = T({ FLW: 0.28, BW: 0.30, FW: 0.34, LW: 0.39, WW: 0.40, MW: 0.49, LHW: 0.64, HW: 0.64, 'W-SW': 0.13, 'W-FLW': 0.15, 'W-BW': 0.21 });
const KO100HEAD_CLASS = T({ FLW: 0.44, BW: 0.49, FW: 0.53, LW: 0.61, WW: 0.64, MW: 0.77, LHW: 1.01, HW: 0.99 });
const TDL_CLASS = T({ FLW: 1.8, BW: 1.5, FW: 1.6, LW: 1.6, WW: 1.5, MW: 1.4, LHW: 1.3, HW: 1.2 });
const TDA_CLASS = T({ FLW: 4.8, BW: 4.4, FW: 4.2, LW: 4.3, WW: 4.0, MW: 4.0, LHW: 3.7, HW: 3.1 });
const TDACC_CLASS = T({ FLW: 0.365, BW: 0.365, FW: 0.365, LW: 0.365, WW: 0.365, MW: 0.365, LHW: 0.365, HW: 0.38 });
const W_TDL = T({ 'W-SW': 1.4, 'W-FLW': 1.3, 'W-BW': 1.2 });
const W_TDA = T({ 'W-SW': 3.7, 'W-FLW': 3.3, 'W-BW': 3.2 });
const ZEROTD_CLASS = T({ FLW: 0.21, BW: 0.28, FW: 0.27, LW: 0.27, WW: 0.28, MW: 0.30, LHW: 0.39, HW: 0.44 });
const SUB15_CLASS = T({ FLW: 0.63, BW: 0.48, FW: 0.53, LW: 0.56, WW: 0.47, MW: 0.51, LHW: 0.36, HW: 0.31 });
const GROUNDKO_CLASS = T({ FLW: 0.21, BW: 0.226, FW: 0.241, LW: 0.257, WW: 0.273, MW: 0.289, LHW: 0.304, HW: 0.32, 'W-SW': 0.43, 'W-FLW': 0.43, 'W-BW': 0.43 });
const FINISH_CLASS = T({ HW: 0.66, LHW: 0.61, MW: 0.59, WW: 0.52, LW: 0.51, FW: 0.45, FLW: 0.45, BW: 0.45 });
const KO_CLASS = T({ HW: 0.48, LHW: 0.44, MW: 0.37, WW: 0.33, LW: 0.30, FW: 0.29, BW: 0.26, FLW: 0.25 });
const SUB_CLASS = T({ HW: 0.21, LHW: 0.19, MW: 0.22, WW: 0.19, LW: 0.22, FW: 0.175, BW: 0.19, FLW: 0.22 });
const W_MIX: Record<string, [number, number, number]> = { 'W-SW': [0.14, 0.20, 0.66], 'W-FLW': [0.17, 0.20, 0.63], 'W-BW': [0.22, 0.17, 0.60] };
const DUR_CLASS = T({ HW: 9.6, LHW: 9.4, MW: 10.5, LW: 10.6, WW: 11.1, FW: 11.3, BW: 11.5, FLW: 11.6, 'W-BW': 12.4, 'W-SW': 12.7, 'W-FLW': 12.8 });
const ALL_CODES = [...MEN_CODES, ...WOMEN_CODES] as const;

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

const UFC = 'ufc (baseline T4 x T4, all classes)';

export const MASTER_ROWS: readonly MasterRow[] = [
  // ---- Striking output ------------------------------------------------------
  { id: 1, section: 'Striking output', metric: 'Sig strikes landed per fighter per min (SLpM), pooled', target: '3.9', tolerance: '±0.4', owner: '§02/§07', status: 'core', population: UFC,
    compute: (d) => ({ comps: [N('SLpM', perFighterMin(d.ufc, (f) => f.sig[0]), 3.9, 0.4)] }) },
  { id: 2, section: 'Striking output', metric: 'Sig strikes attempted per fighter per min', target: '8.4', tolerance: '±0.6', owner: '§07', status: 'core', population: UFC,
    compute: (d) => ({ comps: [N('sig att/min', perFighterMin(d.ufc, (f) => f.sig[1]), 8.4, 0.6)] }) },
  { id: 3, section: 'Striking output', metric: 'Sig strike accuracy, pooled', target: '46%', tolerance: '±3 pp', owner: '§02', status: 'core', population: UFC,
    compute: (d) => ({ comps: [P('sig accuracy', accuracy(d.ufc, (f) => f.sig), 0.46, 0.03)] }) },
  { id: 4, section: 'Striking output', metric: 'Striking defence (1 − opponent accuracy)', target: '54%', tolerance: '±3 pp', owner: '§02', status: 'core', population: UFC,
    compute: (d) => {
      const a = accuracy(d.ufc, (f) => f.sig);
      return { comps: [P('sig defence', { ...a, value: a.value === null ? null : 1 - a.value }, 0.54, 0.03)] };
    } },
  { id: 5, section: 'Striking output', metric: 'Total strikes landed per fighter per min', target: '5.4', tolerance: '±0.6', owner: '§02/§4.1', status: 'core', population: UFC,
    compute: (d) => ({ comps: [N('total landed/min', perFighterMin(d.ufc, (f) => f.tot[0]), 5.4, 0.6)] }) },
  { id: 6, section: 'Striking output', metric: 'Total strike accuracy', target: '53%', tolerance: '±3 pp', owner: '§02', status: 'core', population: UFC,
    compute: (d) => ({ comps: [P('total accuracy', accuracy(d.ufc, (f) => f.tot), 0.53, 0.03)] }) },
  { id: 7, section: 'Striking output', metric: 'Sig landed : total landed ratio', target: '0.72', tolerance: '±0.05', owner: '§4.1', status: 'core', population: UFC,
    compute: (d) => {
      const rs = oneVone(d.ufc);
      return { comps: [N('sig/total landed', ratio(rs.map((r) => sumBoth(r, (f) => f.sig[0])), rs.map((r) => sumBoth(r, (f) => f.tot[0]))), 0.72, 0.05)] };
    } },
  { id: 8, section: 'Striking output', metric: 'Sig strikes landed per fighter per fight (mean / median)', target: '42 / 35', tolerance: '±6 / ±5', owner: '§02/§06', status: 'core', population: UFC,
    compute: (d) => {
      const xs = fighterUnits(d.ufc).map((u) => u.f.sig[0]);
      return { comps: [N('mean', mean(xs), 42, 6), N('median', median(xs), 35, 5)] };
    } },
  { id: 9, section: 'Striking output', metric: 'Winner − loser SLpM (all outcomes)', target: 'winner 4.3, loser 2.9', tolerance: '±0.4 each', owner: '§07', status: 'core', population: UFC,
    compute: (d) => ({ comps: [
      N('winner SLpM', winnerRate(d.ufc, 'w', (f) => f.sig[0], fmin), 4.3, 0.4),
      N('loser SLpM', winnerRate(d.ufc, 'l', (f) => f.sig[0], fmin), 2.9, 0.4),
    ] }) },
  { id: 10, section: 'Striking output', metric: 'Winner vs loser sig accuracy', target: '50% vs 41%', tolerance: '±3 pp each', owner: '§02', status: 'core', population: UFC,
    compute: (d) => ({ comps: [
      P('winner acc', winnerAcc(d.ufc, 'w', (f) => f.sig), 0.50, 0.03),
      P('loser acc', winnerAcc(d.ufc, 'l', (f) => f.sig), 0.41, 0.03),
    ] }) },
  { id: 11, section: 'Striking output', metric: 'SLpM by men\'s class', target: 'FLW 3.5 · BW 3.9 · FW 4.0 · LW 3.9 · WW 3.7 · MW 3.7 · LHW 3.9 · HW 3.7', tolerance: '±0.4', owner: '§01/§07', status: 'class', population: UFC,
    compute: (d) => ({ comps: perClass(d, MEN_CODES, SLPM_CLASS, 0.4, (rs) => perFighterMin(rs, (f) => f.sig[0]), 'num') }) },
  { id: 12, section: 'Striking output', metric: 'Sig attempts/min by men\'s class', target: 'FLW 7.8 · BW 8.7 · FW 8.8 · LW 8.6 · WW 8.1 · MW 7.9 · LHW 7.8 · HW 7.5', tolerance: '±0.6', owner: '§01/§07', status: 'class', population: UFC,
    compute: (d) => ({ comps: perClass(d, MEN_CODES, SATT_CLASS, 0.6, (rs) => perFighterMin(rs, (f) => f.sig[1]), 'num') }) },
  { id: 13, section: 'Striking output', metric: 'Sig accuracy by men\'s class', target: 'FLW 44 · BW 45 · FW 45 · LW 46 · WW 46 · MW 47 · LHW 49 · HW 50 (%)', tolerance: '±3 pp', owner: '§02', status: 'class', population: UFC,
    compute: (d) => ({ comps: perClass(d, MEN_CODES, SACC_CLASS, 0.03, (rs) => accuracy(rs, (f) => f.sig), 'pct') }) },
  { id: 14, section: 'Striking output', metric: 'Women\'s SLpM / attempts / accuracy', target: 'W-SW 4.1/9.1/45% · W-FLW 4.0/9.3/43% · W-BW 3.7/8.1/46%', tolerance: '±0.4 / ±0.6 / ±3 pp', owner: '§01/§07', status: 'class', population: UFC,
    compute: (d) => ({ comps: [
      ...perClass(d, WOMEN_CODES, W_SLPM, 0.4, (rs) => perFighterMin(rs, (f) => f.sig[0]), 'num', 'SLpM'),
      ...perClass(d, WOMEN_CODES, W_SATT, 0.6, (rs) => perFighterMin(rs, (f) => f.sig[1]), 'num', 'att/min'),
      ...perClass(d, WOMEN_CODES, W_SACC, 0.03, (rs) => accuracy(rs, (f) => f.sig), 'pct', 'acc'),
    ] }) },
  { id: 15, section: 'Striking output', metric: 'Accuracy by target (sig)', target: 'head 38% · body 70% · leg 81%', tolerance: '±3 pp', owner: '§02', status: 'core', population: UFC,
    compute: (d) => ({ comps: (['head', 'body', 'leg'] as const).map((t, k) =>
      P(t, accuracy(d.ufc, (f) => ptLA(f, null, t)), [0.38, 0.70, 0.81][k], 0.03)) }) },
  { id: 16, section: 'Striking output', metric: 'Accuracy by position (sig)', target: 'distance 42% · clinch 72% · ground 72%', tolerance: '±3 pp', owner: '§02', status: 'core', population: UFC,
    compute: (d) => ({ comps: (['distance', 'clinch', 'ground'] as const).map((p, k) =>
      P(p, accuracy(d.ufc, (f) => ptLA(f, p, null)), [0.42, 0.72, 0.72][k], 0.03)) }) },
  { id: 17, section: 'Striking output', metric: 'Accuracy distance x target', target: 'head 31% · body 63% · leg 80%', tolerance: '±3 pp', owner: '§02', status: 'core', population: UFC,
    compute: (d) => ({ comps: (['head', 'body', 'leg'] as const).map((t, k) =>
      P(`distance ${t}`, accuracy(d.ufc, (f) => ptLA(f, 'distance', t)), [0.31, 0.63, 0.80][k], 0.03)) }) },
  { id: 18, section: 'Striking output', metric: 'Accuracy clinch x target', target: 'head 58% · body 86% · leg 91%', tolerance: '±4 pp', owner: '§02/§03', status: 'core', population: UFC,
    compute: (d) => ({ comps: (['head', 'body', 'leg'] as const).map((t, k) =>
      P(`clinch ${t}`, accuracy(d.ufc, (f) => ptLA(f, 'clinch', t)), [0.58, 0.86, 0.91][k], 0.04)) }) },
  { id: 19, section: 'Striking output', metric: 'Accuracy ground x target', target: 'head 67% · body 94% · leg 87%', tolerance: '±4 pp', owner: '§02/§03', status: 'core', population: UFC,
    compute: (d) => ({ comps: (['head', 'body', 'leg'] as const).map((t, k) =>
      P(`ground ${t}`, accuracy(d.ufc, (f) => ptLA(f, 'ground', t)), [0.67, 0.94, 0.87][k], 0.04)) }) },
  { id: 20, section: 'Striking output', metric: 'Share of sig attempts by target', target: 'head 77% · body 13.5% · leg 9%', tolerance: '±3 pp', owner: '§07', status: 'core', population: UFC,
    compute: (d) => {
      const rs = oneVone(d.ufc);
      const all = rs.map((r) => sumBoth(r, (f) => ptLA(f, null, null)[1]));
      return { comps: (['head', 'body', 'leg'] as const).map((t, k) =>
        P(t, ratio(rs.map((r) => sumBoth(r, (f) => ptLA(f, null, t)[1])), all), [0.77, 0.135, 0.09][k], 0.03)) };
    } },
  { id: 21, section: 'Striking output', metric: 'Share of sig landed by target', target: 'head 63% · body 21% · leg 16%', tolerance: '±3 pp', owner: '§02/§07', status: 'core', population: UFC,
    compute: (d) => {
      const rs = oneVone(d.ufc);
      const all = rs.map((r) => sumBoth(r, (f) => ptLA(f, null, null)[0]));
      return { comps: (['head', 'body', 'leg'] as const).map((t, k) =>
        P(t, ratio(rs.map((r) => sumBoth(r, (f) => ptLA(f, null, t)[0])), all), [0.63, 0.21, 0.16][k], 0.03)) };
    } },
  { id: 22, section: 'Striking output', metric: 'Share of sig landed by position', target: 'distance 78% · clinch 11% · ground 11%', tolerance: '±4 pp', owner: '§03/§07', status: 'core', population: UFC,
    compute: (d) => {
      const rs = oneVone(d.ufc);
      const all = rs.map((r) => sumBoth(r, (f) => ptLA(f, null, null)[0]));
      return { comps: (['distance', 'clinch', 'ground'] as const).map((p, k) =>
        P(p, ratio(rs.map((r) => sumBoth(r, (f) => ptLA(f, p, null)[0])), all), [0.78, 0.11, 0.11][k], 0.04)) };
    } },
  { id: 23, section: 'Striking output', metric: 'Share of sig attempts by position', target: 'distance 86% · clinch 7% · ground 7%', tolerance: '±3 pp', owner: '§03/§07', status: 'core', population: UFC,
    compute: (d) => {
      const rs = oneVone(d.ufc);
      const all = rs.map((r) => sumBoth(r, (f) => ptLA(f, null, null)[1]));
      return { comps: (['distance', 'clinch', 'ground'] as const).map((p, k) =>
        P(p, ratio(rs.map((r) => sumBoth(r, (f) => ptLA(f, p, null)[1])), all), [0.86, 0.07, 0.07][k], 0.03)) };
    } },
  { id: 24, section: 'Striking output', metric: 'Fight time by phase', target: 'distance 61% · clinch 15% · ground 24%', tolerance: '±5 pp', owner: '§03/§07', status: 'core', population: UFC,
    compute: (d) => {
      const rs = oneVone(d.ufc);
      return { comps: ['distance', 'clinch', 'ground'].map((p, k) =>
        P(p, ratio(rs.map((r) => r.pos[k]), rs.map((r) => r.res.fs)), [0.61, 0.15, 0.24][k], 0.05)) };
    } },
  { id: 25, section: 'Striking output', metric: 'Distance power-head accuracy (fighter-level SD 7.8 pp)', target: '25% (SD 7.8 pp)', tolerance: '±3 pp; SD ±2 pp', owner: '§02/§01', status: 'core', population: UFC,
    compute: (d) => {
      const acc = accuracy(d.ufc, powerHead);
      const per = fighterUnits(d.ufc).map((u) => powerHead(u.f)).filter(([, a]) => a >= 10).map(([l, a]) => l / a);
      return { comps: [P('power-head acc', acc, 0.25, 0.03), P('fighter SD', sd(per), 0.078, 0.02)], note: 'SD over fighter-bouts with ≥ 10 distance power-head attempts (a fighter-bout, not a career, is the unit here).' };
    } },
  { id: 26, section: 'Striking output', metric: 'Distance jab (head) accuracy', target: '29%', tolerance: '±3 pp', owner: '§02', status: 'core', population: UFC,
    compute: (d) => ({ comps: [P('jab head acc', accuracy(d.ufc, (f) => f.jab), 0.29, 0.03)] }) },
  { id: 27, section: 'Striking output', metric: 'Strike-type share of KO-causing strikes', target: 'punch 85% · knee 6% · kick 8% · other 1%', tolerance: '±5 pp', owner: '§05', status: 'core', population: UFC,
    compute: (d) => {
      const fins = d.ufc.filter((r) => isKoTko(r.res.m) && r.fin?.k === 'strike');
      const sh = (c: string[]) => share(fins, (r) => c.includes(r.fin!.cls));
      return { comps: [P('punch', sh(['punch']), 0.85, 0.05), P('knee', sh(['knee']), 0.06, 0.05), P('kick', sh(['kick']), 0.08, 0.05), P('other (incl. elbow)', sh(['elbow', 'other']), 0.01, 0.05)],
        note: 'Finishing strike = the winner\'s last landed strike before a KO/TKO.' };
    } },
  { id: 28, section: 'Striking output', metric: 'Ground finishing strikes', target: 'punches 83% · elbows 14% · knees 3%', tolerance: '±5 pp', owner: '§05/§03', status: 'core', population: UFC,
    compute: (d) => {
      const fins = d.ufc.filter((r) => isKoTko(r.res.m) && r.fin?.k === 'strike' && r.fin.pos === 'ground');
      const sh = (c: string) => share(fins, (r) => r.fin!.cls === c);
      return { comps: [P('punch', sh('punch'), 0.83, 0.05), P('elbow', sh('elbow'), 0.14, 0.05), P('knee', sh('knee'), 0.03, 0.05)] };
    } },
  { id: 29, section: 'Striking output', metric: 'Fight-ending punch type (KO/TKO)', target: 'rear straight 29% · lead hook 27% · rear hook 24% · other 20%', tolerance: '±6 pp', owner: '§02/§05', status: 'core', population: UFC,
    compute: (d) => {
      const fins = d.ufc.filter((r) => isKoTko(r.res.m) && r.fin?.k === 'strike' && r.fin.cls === 'punch');
      const kind = (id: string): string => id.startsWith('tech.cross') ? 'rs' : id.startsWith('tech.hook_lead') || id === 'tech.check_hook' ? 'lh' : id.startsWith('tech.hook_rear') ? 'rh' : 'o';
      const sh = (k: string) => share(fins, (r) => kind(r.fin!.id) === k);
      return { comps: [P('rear straight', sh('rs'), 0.29, 0.06), P('lead hook', sh('lh'), 0.27, 0.06), P('rear hook', sh('rh'), 0.24, 0.06), P('other', sh('o'), 0.20, 0.06)] };
    } },
  // ---- Knockdowns --------------------------------------------------------------
  { id: 30, section: 'Knockdowns', metric: 'Knockdowns per fighter per 15 min', target: '0.30', tolerance: '±0.05', owner: '§05', status: 'core', population: UFC,
    compute: (d) => ({ comps: [N('KD/15', perFighterMin(d.ufc, (f) => f.kd, 15), 0.30, 0.05)] }) },
  { id: 31, section: 'Knockdowns', metric: 'Knockdowns per fight (both fighters)', target: '0.44', tolerance: '±0.06', owner: '§05', status: 'core', population: UFC,
    compute: (d) => ({ comps: [N('KD/fight', mean(oneVone(d.ufc).map((r) => r.kd.length)), 0.44, 0.06)] }) },
  { id: 32, section: 'Knockdowns', metric: 'Share of fights with ≥1 KD', target: '36%', tolerance: '±5 pp', owner: '§05', status: 'core', population: UFC,
    compute: (d) => ({ comps: [P('fights with KD', share(d.ufc, (r) => r.kd.length > 0), 0.36, 0.05)] }) },
  { id: 33, section: 'Knockdowns', metric: 'KDs per fight distribution (0/1/2/3/4+)', target: '64 / 30 / 5 / 1 / 0.2 %', tolerance: '±4 pp on 0 and 1', owner: '§05', status: 'core', population: UFC,
    compute: (d) => ({ comps: [
      P('0 KD', share(d.ufc, (r) => r.kd.length === 0), 0.64, 0.04),
      P('1 KD', share(d.ufc, (r) => r.kd.length === 1), 0.30, 0.04),
      P('2 KD', share(d.ufc, (r) => r.kd.length === 2), 0.05, 0.04, { info: true }),
      P('3+ KD', share(d.ufc, (r) => r.kd.length >= 3), 0.012, 0.04, { info: true }),
    ] }) },
  { id: 34, section: 'Knockdowns', metric: 'KD per 15 min by men\'s class', target: 'FLW 0.29 · BW 0.32 · FW 0.33 · LW 0.31 · WW 0.36 · MW 0.35 · LHW 0.44 · HW 0.33', tolerance: '±0.06', owner: '§05/§01', status: 'class', population: UFC,
    compute: (d) => ({ comps: perClass(d, MEN_CODES, KD15_CLASS, 0.06, (rs) => perFighterMin(rs, (f) => f.kd, 15), 'num') }) },
  { id: 35, section: 'Knockdowns', metric: 'KD per 15 min, women', target: 'W-SW 0.10 · W-FLW 0.10 · W-BW 0.12', tolerance: '±0.04', owner: '§05/§01', status: 'class', population: UFC,
    compute: (d) => ({ comps: perClass(d, WOMEN_CODES, W_KD15, 0.04, (rs) => perFighterMin(rs, (f) => f.kd, 15), 'num') }) },
  { id: 36, section: 'Knockdowns', metric: 'KD per landed distance power head strike', target: '3.9%', tolerance: '±1 pp', owner: '§05', status: 'core', population: UFC,
    compute: (d) => {
      const rs = oneVone(d.ufc);
      return { comps: [P('KD / dist power-head landed', ratio(rs.map((r) => r.kd.filter((x) => headKd(x[5])).length), rs.map((r) => sumBoth(r, (f) => powerHead(f)[0]))), 0.039, 0.01)],
        note: 'Numerator: every head-kind knockdown (flash/hurt/ko), whatever position it came from.' };
    } },
  { id: 37, section: 'Knockdowns', metric: 'KD per 100 head sig landed, by class', target: 'FLW 0.87 · BW 0.90 · FW 0.88 · LW 0.83 · WW 1.03 · MW 0.98 · LHW 1.20 · HW 0.92; women 0.26–0.35', tolerance: '±0.2', owner: '§05/§01', status: 'class', population: UFC,
    compute: (d) => ({ comps: perClass(d, ALL_CODES, KD100_CLASS, (t) => (t < 0.4 ? 0.245 : 0.2), (rs) => {
      const r1 = oneVone(rs);
      return ratio(r1.map((r) => r.kd.length), r1.map((r) => sumBoth(r, (f) => ptLA(f, null, 'head')[0])), 100);
    }, 'num') }) },
  { id: 38, section: 'Knockdowns', metric: 'KD rate by round (per landed distance power head strike)', target: 'R1 5.3% → R2 2.4% → R3 1.5%', tolerance: '±1 pp', owner: '§05/§07', status: 'core', population: UFC,
    compute: (d) => ({ comps: [1, 2, 3].map((k) => P(`R${k}`, kdRateByRound(d.ufc, k), [0.053, 0.024, 0.015][k - 1], 0.01)),
      note: 'Per-round power-head counts are not tallied per round; the round\'s head-sig-landed count is scaled by the bout-pooled distance-power-head share.' }) },
  { id: 39, section: 'Knockdowns', metric: 'KD → KO/TKO conversion (fight level)', target: '65% KO/TKO; 74% any finish', tolerance: '±5 pp', owner: '§05/§06/§07', status: 'core', population: UFC,
    compute: (d) => {
      const kdf = d.ufc.filter((r) => r.kd.length > 0);
      return { comps: [P('→ KO/TKO', share(kdf, (r) => isKoTko(r.res.m)), 0.65, 0.05), P('→ any finish', share(kdf, (r) => isFinish(r.res.m)), 0.74, 0.05)] };
    } },
  { id: 40, section: 'Knockdowns', metric: 'KD → same-round KO/TKO by KD scorer', target: '57%', tolerance: '±5 pp', owner: '§05/§06/§07', status: 'core', population: UFC,
    compute: (d) => {
      let k = 0;
      let n = 0;
      for (const r of d.ufc) for (const x of r.kd) {
        n++;
        if (isKoTko(r.res.m) && r.res.r === x[0] && r.res.w === x[2]) k++;
      }
      return { comps: [P('same-round KO/TKO', proportion(k, n), 0.57, 0.05)], note: 'Unit: knockdown event.' };
    } },
  { id: 41, section: 'Knockdowns', metric: 'KD-fight → KO/TKO by class', target: 'FLW 53 · BW 58 · FW 59 · LW 67 · WW 65 · MW 69 · LHW 75 · HW 84; W-SW 44 · W-FLW 47 · W-BW 53 (%)', tolerance: '±7 pp', owner: '§05/§01', status: 'class', population: UFC,
    compute: (d) => ({ comps: perClass(d, ALL_CODES, KDKO_CLASS, 0.07, (rs) => share(rs.filter((r) => r.kd.length > 0), (r) => isKoTko(r.res.m)), 'pct') }) },
  { id: 42, section: 'Knockdowns', metric: 'Fighter scoring ≥1 KD wins', target: '86% (61% by KO/TKO)', tolerance: '±4 pp', owner: '§05/§06', status: 'core', population: UFC,
    compute: (d) => {
      const us = fighterUnits(d.ufc).filter((u) => u.f.kd > 0);
      return { comps: [P('wins', proportion(us.filter((u) => u.won).length, us.length), 0.86, 0.04), P('wins by KO/TKO', proportion(us.filter((u) => u.won && isKoTko(u.row.res.m)).length, us.length), 0.61, 0.04)] };
    } },
  { id: 43, section: 'Knockdowns', metric: 'KO/TKO fights containing ≥1 KD', target: '74%', tolerance: '±5 pp', owner: '§05/§06', status: 'core', population: UFC,
    compute: (d) => ({ comps: [P('KO/TKO with KD', share(d.ufc.filter((r) => isKoTko(r.res.m)), (r) => r.kd.length > 0), 0.74, 0.05)] }) },
  // ---- Strikes to finish / absorption ---------------------------------------
  { id: 44, section: 'Strikes to finish / absorption', metric: 'KO/TKO fights: winner sig landed (mean / median)', target: '38 / 29', tolerance: '±5 / ±4', owner: '§05', status: 'core', population: UFC,
    compute: (d) => {
      const xs = d.ufc.filter((r) => isKoTko(r.res.m) && winLose(r)).map((r) => winLose(r)![0].sig[0]);
      return { comps: [N('mean', mean(xs), 38, 5), N('median', median(xs), 29, 4)] };
    } },
  { id: 45, section: 'Strikes to finish / absorption', metric: 'KO/TKO fights: winner head sig landed (mean / median)', target: '27 / 20', tolerance: '±4 / ±3', owner: '§05', status: 'core', population: UFC,
    compute: (d) => {
      const xs = d.ufc.filter((r) => isKoTko(r.res.m) && winLose(r)).map((r) => ptLA(winLose(r)![0], null, 'head')[0]);
      return { comps: [N('mean', mean(xs), 27, 4), N('median', median(xs), 20, 3)] };
    } },
  { id: 46, section: 'Strikes to finish / absorption', metric: 'KO/TKO fights: loser head sig absorbed before stoppage (mean / median)', target: '11 / 6', tolerance: '±3 / ±2', owner: '§05/§06', status: 'core', population: UFC,
    compute: (d) => {
      const xs = d.ufc.filter((r) => isKoTko(r.res.m) && winLose(r)).map((r) => winLose(r)![1].habs);
      return { comps: [N('mean', mean(xs), 11, 3), N('median', median(xs), 6, 2)] };
    } },
  { id: 47, section: 'Strikes to finish / absorption', metric: 'KO/TKO fight duration (mean / median)', target: '6.1 / 4.9 min', tolerance: '±0.7 / ±0.6', owner: '§05/§06', status: 'core', population: UFC,
    compute: (d) => {
      const xs = d.ufc.filter((r) => isKoTko(r.res.m)).map(fmin);
      return { comps: [M('mean', mean(xs), 6.1, 0.7), M('median', median(xs), 4.9, 0.6)] };
    } },
  { id: 48, section: 'Strikes to finish / absorption', metric: 'Strikes in final 30 s before TKO', target: '18.5 (5–46), 92% to head', tolerance: '±4', owner: '§06/§07', status: 'core', population: UFC,
    compute: (d) => {
      const rs = d.ufc.filter((r) => r.res.m.startsWith('tko') && r.l30);
      return { comps: [
        N('strikes in last 30 s', mean(rs.map((r) => r.l30![0])), 18.5, 4),
        P('to head', ratio(rs.map((r) => r.l30![1]), rs.map((r) => r.l30![0])), 0.92, 0.05, { info: true }),
      ], note: 'Winner\'s strike attempts in the last 30 s of fight time before a TKO.' };
    } },
  { id: 49, section: 'Strikes to finish / absorption', metric: 'Post-KO strikes before referee intervenes; time to stoppage', target: '2.6 (0–20); 3.5 s (0–20)', tolerance: '±1; ±1.5 s', owner: '§06', status: 'core', population: UFC,
    compute: (d) => {
      const rs = d.ufc.filter((r) => isKoTko(r.res.m) && r.lag);
      return { comps: [N('extra strikes', mean(rs.map((r) => r.lag![1])), 2.6, 1), S('lag', mean(rs.map((r) => r.lag![0])), 3.5, 1.5)],
        note: 'Referee stoppages carrying a lag; extra strikes = winner\'s landed strikes inside the lag window.' };
    } },
  { id: 50, section: 'Strikes to finish / absorption', metric: 'Head sig strikes absorbed per fighter per min (mean / median)', target: '2.4 / 1.7', tolerance: '±0.3 / ±0.3', owner: '§02', status: 'core', population: UFC,
    compute: (d) => {
      const xs = fighterUnits(d.ufc).filter((u) => u.row.res.fs > 0).map((u) => u.f.habs / fmin(u.row));
      return { comps: [N('mean', mean(xs), 2.4, 0.3), N('median', median(xs), 1.7, 0.3)], note: 'Fighter-bout level (a career rate in the source).' };
    } },
  { id: 51, section: 'Strikes to finish / absorption', metric: 'Head sig strikes absorbed per fighter per fight', target: '26', tolerance: '±4', owner: '§02', status: 'core', population: UFC,
    compute: (d) => ({ comps: [N('mean', mean(fighterUnits(d.ufc).map((u) => u.f.habs)), 26, 4)] }) },
  { id: 52, section: 'Strikes to finish / absorption', metric: 'Total head strikes per min (both, incl. non-sig)', target: '6.3', tolerance: '±0.8', owner: '§02', status: 'core', population: UFC,
    compute: (d) => {
      const rs = oneVone(d.ufc);
      return { comps: [N('head strikes landed/min (both)', ratio(rs.map((r) => sumBoth(r, (f) => f.hd[0])), rs.map(fmin)), 6.3, 0.8)] };
    } },
  { id: 53, section: 'Strikes to finish / absorption', metric: 'KO/TKO per 100 sig strikes landed (both), by class', target: 'FLW 0.28 · BW 0.30 · FW 0.34 · LW 0.39 · WW 0.40 · MW 0.49 · LHW 0.64 · HW 0.64; W-SW 0.13 · W-FLW 0.15 · W-BW 0.21', tolerance: '±20% relative', owner: '§05/§01', status: 'class', population: UFC,
    compute: (d) => ({ comps: perClass(d, ALL_CODES, KO100SIG_CLASS, rel20, (rs) => {
      const r1 = oneVone(rs);
      return ratio(r1.map((r) => (isKoTko(r.res.m) ? 1 : 0)), r1.map((r) => sumBoth(r, (f) => f.sig[0])), 100);
    }, 'num') }) },
  { id: 54, section: 'Strikes to finish / absorption', metric: 'KO/TKO per 100 head sig landed, by class', target: 'FLW 0.44 · BW 0.49 · FW 0.53 · LW 0.61 · WW 0.64 · MW 0.77 · LHW 1.01 · HW 0.99', tolerance: '±20% relative', owner: '§05/§01', status: 'class', population: UFC,
    compute: (d) => ({ comps: perClass(d, MEN_CODES, KO100HEAD_CLASS, rel20, (rs) => {
      const r1 = oneVone(rs);
      return ratio(r1.map((r) => (isKoTko(r.res.m) ? 1 : 0)), r1.map((r) => sumBoth(r, (f) => ptLA(f, null, 'head')[0])), 100);
    }, 'num') }) },
  // ---- Grappling -----------------------------------------------------------------
  { id: 55, section: 'Grappling', metric: 'TD attempts per fighter per 15 min', target: '4.0', tolerance: '±0.5', owner: '§07', status: 'core', population: UFC,
    compute: (d) => ({ comps: [N('TD att/15', perFighterMin(d.ufc, (f) => f.td[1], 15), 4.0, 0.5)] }) },
  { id: 56, section: 'Grappling', metric: 'TD landed per fighter per 15 min', target: '1.45', tolerance: '±0.2', owner: '§03', status: 'core', population: UFC,
    compute: (d) => ({ comps: [N('TD landed/15', perFighterMin(d.ufc, (f) => f.td[0], 15), 1.45, 0.2)] }) },
  { id: 57, section: 'Grappling', metric: 'TD accuracy', target: '38%', tolerance: '±3 pp', owner: '§03', status: 'core', population: UFC,
    compute: (d) => ({ comps: [P('TD accuracy', accuracy(d.ufc, (f) => f.td), 0.38, 0.03)] }) },
  { id: 58, section: 'Grappling', metric: 'TD defence', target: '62%', tolerance: '±3 pp', owner: '§03', status: 'core', population: UFC,
    compute: (d) => {
      const a = accuracy(d.ufc, (f) => f.td);
      return { comps: [P('TD defence', { ...a, value: a.value === null ? null : 1 - a.value }, 0.62, 0.03)] };
    } },
  { id: 59, section: 'Grappling', metric: 'TD landed per 15 by men\'s class', target: 'FLW 1.8 · BW 1.5 · FW 1.6 · LW 1.6 · WW 1.5 · MW 1.4 · LHW 1.3 · HW 1.2', tolerance: '±0.25', owner: '§03/§01', status: 'class', population: UFC,
    compute: (d) => ({ comps: perClass(d, MEN_CODES, TDL_CLASS, 0.25, (rs) => perFighterMin(rs, (f) => f.td[0], 15), 'num') }) },
  { id: 60, section: 'Grappling', metric: 'TD attempted per 15 by men\'s class', target: 'FLW 4.8 · BW 4.4 · FW 4.2 · LW 4.3 · WW 4.0 · MW 4.0 · LHW 3.7 · HW 3.1', tolerance: '±0.5', owner: '§07/§01', status: 'class', population: UFC,
    compute: (d) => ({ comps: perClass(d, MEN_CODES, TDA_CLASS, 0.5, (rs) => perFighterMin(rs, (f) => f.td[1], 15), 'num') }) },
  { id: 61, section: 'Grappling', metric: 'TD accuracy by class', target: 'flat 35–38% (HW 38)', tolerance: '±3 pp', owner: '§03', status: 'class', population: UFC,
    compute: (d) => ({ comps: perClass(d, MEN_CODES, TDACC_CLASS, (t) => (t === 0.38 ? 0.03 : 0.045), (rs) => accuracy(rs, (f) => f.td), 'pct') }) },
  { id: 62, section: 'Grappling', metric: 'Women\'s TD landed / attempted per 15', target: 'W-SW 1.4/3.7 · W-FLW 1.3/3.3 · W-BW 1.2/3.2', tolerance: '±0.25 / ±0.5', owner: '§03/§07', status: 'class', population: UFC,
    compute: (d) => ({ comps: [
      ...perClass(d, WOMEN_CODES, W_TDL, 0.25, (rs) => perFighterMin(rs, (f) => f.td[0], 15), 'num', 'landed/15'),
      ...perClass(d, WOMEN_CODES, W_TDA, 0.5, (rs) => perFighterMin(rs, (f) => f.td[1], 15), 'num', 'att/15'),
    ] }) },
  { id: 63, section: 'Grappling', metric: 'TD landed per fight (both), mean / median', target: '2.1 / 2', tolerance: '±0.3', owner: '§03', status: 'core', population: UFC,
    compute: (d) => {
      const xs = oneVone(d.ufc).map((r) => sumBoth(r, (f) => f.td[0]));
      return { comps: [N('mean', mean(xs), 2.1, 0.3), N('median', median(xs), 2, 0.3)] };
    } },
  { id: 64, section: 'Grappling', metric: 'TD-per-fight distribution (0/1/2/3/4/5/6+)', target: '28.5 / 21 / 16 / 11 / 8 / 6 / 8 %', tolerance: '±4 pp on 0', owner: '§03/§07', status: 'core', population: UFC,
    compute: (d) => {
      const rs = oneVone(d.ufc);
      const tds = (r: ResultRow) => sumBoth(r, (f) => f.td[0]);
      const t = [0.285, 0.21, 0.16, 0.11, 0.08, 0.06, 0.08];
      return { comps: t.map((tv, k) => P(k === 6 ? '6+' : String(k), share(rs, (r) => (k === 6 ? tds(r) >= 6 : tds(r) === k)), tv, 0.04, { info: k !== 0 })) };
    } },
  { id: 65, section: 'Grappling', metric: 'Zero-TD-landed fights by class', target: 'FLW 21 · BW 28 · FW 27 · LW 27 · WW 28 · MW 30 · LHW 39 · HW 44 %', tolerance: '±5 pp', owner: '§03/§07', status: 'class', population: UFC,
    compute: (d) => ({ comps: perClass(d, MEN_CODES, ZEROTD_CLASS, 0.05, (rs) => share(oneVone(rs), (r) => sumBoth(r, (f) => f.td[0]) === 0), 'pct') }) },
  { id: 66, section: 'Grappling', metric: 'Fighter-bouts with zero TD landed', target: '55%', tolerance: '±4 pp', owner: '§03/§07', status: 'core', population: UFC,
    compute: (d) => {
      const us = fighterUnits(d.ufc);
      return { comps: [P('zero TD', proportion(us.filter((u) => u.f.td[0] === 0).length, us.length), 0.55, 0.04)] };
    } },
  { id: 67, section: 'Grappling', metric: 'Winner vs loser TD accuracy', target: '45–51% vs 26–29%', tolerance: '±4 pp', owner: '§03', status: 'core', population: UFC,
    compute: (d) => ({ comps: [
      P('winner', winnerAcc(d.ufc, 'w', (f) => f.td), 0.48, 0.07),
      P('loser', winnerAcc(d.ufc, 'l', (f) => f.td), 0.275, 0.055),
    ] }) },
  { id: 68, section: 'Grappling', metric: 'Slam share of landed TDs', target: '9%', tolerance: '±3 pp', owner: '§03', status: 'core', population: UFC,
    compute: (d) => {
      const rs = oneVone(d.ufc);
      return { comps: [P('slams / TD landed', ratio(rs.map((r) => r.slam), rs.map((r) => sumBoth(r, (f) => f.td[0]))), 0.09, 0.03)],
        note: 'A slam = a successful grappling edge whose id names a slam (`tech.double_lift_slam`).' };
    } },
  { id: 69, section: 'Grappling', metric: 'Sub attempts per fighter per 15 min', target: '0.45', tolerance: '±0.15', owner: '§04/§07', status: 'core', population: UFC,
    compute: (d) => ({ comps: [N('sub att/15', perFighterMin(d.ufc, (f) => f.sub, 15), 0.45, 0.15)] }) },
  { id: 70, section: 'Grappling', metric: 'Sub attempts per fight (both)', target: '0.65', tolerance: '±0.15', owner: '§04/§07', status: 'core', population: UFC,
    compute: (d) => ({ comps: [N('sub att/fight', mean(oneVone(d.ufc).map((r) => sumBoth(r, (f) => f.sub))), 0.65, 0.15)] }) },
  { id: 71, section: 'Grappling', metric: 'Fights with zero sub attempts', target: '60%', tolerance: '±5 pp', owner: '§04/§07', status: 'core', population: UFC,
    compute: (d) => ({ comps: [P('zero sub att', share(oneVone(d.ufc), (r) => sumBoth(r, (f) => f.sub) === 0), 0.60, 0.05)] }) },
  { id: 72, section: 'Grappling', metric: 'Sub attempts per 15 by class', target: 'FLW 0.63 · BW 0.48 · FW 0.53 · LW 0.56 · WW 0.47 · MW 0.51 · LHW 0.36 · HW 0.31', tolerance: '±0.15', owner: '§04/§01', status: 'class', population: UFC,
    compute: (d) => ({ comps: perClass(d, MEN_CODES, SUB15_CLASS, 0.15, (rs) => perFighterMin(rs, (f) => f.sub, 15), 'num') }) },
  { id: 73, section: 'Grappling', metric: 'Sub finish rate per (locked-in) attempt', target: '25%', tolerance: '±5 pp', owner: '§04', status: 'core', population: UFC,
    compute: (d) => {
      const rs = oneVone(d.ufc);
      return { comps: [P('sub finishes / attempts', ratio(rs.map((r) => (isSub(r.res.m) ? 1 : 0)), rs.map((r) => sumBoth(r, (f) => f.sub))), 0.25, 0.05)],
        note: 'Attempt = a §4.1 sub attempt (stage ≥ 2, re-grips within 5 s merged).' };
    } },
  { id: 74, section: 'Grappling', metric: 'Finishing-sub mix', target: 'RNC 39 · guillotine 18 · armbar 12 · arm-triangle 7.5 · triangle 6 · D\'Arce 3 · kimura 3 · anaconda 2.5 · heel hook 1.5 · kneebar 1 · other 7.5 (%)', tolerance: '±3 pp on RNC', owner: '§04', status: 'core', population: UFC,
    compute: (d) => {
      const subs = d.ufc.filter((r) => isSub(r.res.m) && r.fin?.k === 'sub');
      const sh = (re: RegExp) => share(subs, (r) => re.test(r.fin!.id));
      return { comps: [
        P('RNC', sh(/^sub\.rnc/), 0.39, 0.03),
        P('guillotine', sh(/guillotine/), 0.18, 0.03, { info: true }),
        P('armbar', sh(/armbar/), 0.12, 0.03, { info: true }),
        P('arm-triangle', sh(/arm_triangle/), 0.075, 0.03, { info: true }),
        P('triangle', sh(/^sub\.triangle/), 0.06, 0.03, { info: true }),
        P('kimura', sh(/kimura/), 0.03, 0.03, { info: true }),
      ] };
    } },
  { id: 75, section: 'Grappling', metric: 'Chokes / arm locks / leg locks share of subs', target: '79 / 15 / 3 %', tolerance: '±4 pp', owner: '§04', status: 'core', population: UFC,
    compute: (d) => {
      const subs = d.ufc.filter((r) => isSub(r.res.m) && r.fin?.k === 'sub');
      return { comps: [
        P('chokes', share(subs, (r) => r.fin!.cls === 'choke'), 0.79, 0.04),
        P('arm locks', share(subs, (r) => r.fin!.cls === 'jointLock'), 0.15, 0.04),
        P('leg locks', share(subs, (r) => r.fin!.cls === 'legLock'), 0.03, 0.04),
      ] };
    } },
  { id: 76, section: 'Grappling', metric: 'Chokes ending in unconsciousness', target: '11%', tolerance: '±4 pp', owner: '§04/§06', status: 'core', population: UFC,
    compute: (d) => ({ comps: [P('choke → unconscious', share(d.ufc.filter((r) => isSub(r.res.m) && r.fin?.cls === 'choke'), (r) => r.fin!.tgt === 'loc'), 0.11, 0.04)] }) },
  { id: 77, section: 'Grappling', metric: 'Control time per fighter per fight (mean / median)', target: '2.2 / 1.0 min', tolerance: '±0.4 / ±0.3', owner: '§03', status: 'core', population: UFC,
    compute: (d) => {
      const xs = fighterUnits(d.ufc).map((u) => u.f.ctrl / 60);
      return { comps: [M('mean', mean(xs), 2.2, 0.4), M('median', median(xs), 1.0, 0.3)] };
    } },
  { id: 78, section: 'Grappling', metric: 'Control time as share of fight minutes (both fighters)', target: '39%', tolerance: '±5 pp', owner: '§03', status: 'core', population: UFC,
    compute: (d) => {
      const rs = oneVone(d.ufc);
      return { comps: [P('control share', ratio(rs.map((r) => sumBoth(r, (f) => f.ctrl)), rs.map((r) => r.res.fs)), 0.39, 0.05)] };
    } },
  { id: 79, section: 'Grappling', metric: 'Winner vs loser control (all / decisions)', target: '3.0 vs 1.4 min / 4.3 vs 1.9 min', tolerance: '±0.5', owner: '§03/§06', status: 'core', population: UFC,
    compute: (d) => {
      const all = oneVone(d.ufc).filter((r) => winLose(r));
      const dec = decisions(d.ufc);
      const m = (rs: ResultRow[], k: 0 | 1) => mean(rs.map((r) => winLose(r)![k].ctrl / 60));
      return { comps: [M('winner (all)', m(all, 0), 3.0, 0.5), M('loser (all)', m(all, 1), 1.4, 0.5), M('winner (dec)', m(dec, 0), 4.3, 0.5), M('loser (dec)', m(dec, 1), 1.9, 0.5)] };
    } },
  { id: 80, section: 'Grappling', metric: 'Reversals per fight', target: '0.26 (83% of fights none)', tolerance: '±0.1', owner: '§03', status: 'core', population: UFC,
    compute: (d) => {
      const rs = oneVone(d.ufc);
      return { comps: [N('reversals/fight', mean(rs.map((r) => sumBoth(r, (f) => f.rev))), 0.26, 0.1), P('fights with none', share(rs, (r) => sumBoth(r, (f) => f.rev) === 0), 0.83, 0.05, { info: true })] };
    } },
  { id: 81, section: 'Grappling', metric: 'Share of sig strikes landed on the ground', target: '11% (trending to 9.5%)', tolerance: '±3 pp', owner: '§03/§07', status: 'core', population: UFC,
    compute: (d) => {
      const rs = oneVone(d.ufc);
      return { comps: [P('ground share', ratio(rs.map((r) => sumBoth(r, (f) => ptLA(f, 'ground', null)[0])), rs.map((r) => sumBoth(r, (f) => ptLA(f, null, null)[0]))), 0.11, 0.03)] };
    } },
  { id: 82, section: 'Grappling', metric: 'KO/TKO by position', target: 'distance 58 · ground 28 · clinch 14 %', tolerance: '±6 pp', owner: '§05', status: 'core', population: UFC,
    compute: (d) => {
      const fins = d.ufc.filter((r) => isKoTko(r.res.m) && r.fin?.k === 'strike');
      return { comps: (['distance', 'ground', 'clinch'] as const).map((p, k) => P(p, share(fins, (r) => r.fin!.pos === p), [0.58, 0.28, 0.14][k], 0.06)) };
    } },
  { id: 83, section: 'Grappling', metric: 'Ground KO/TKO share by class', target: 'men 21–32% (rising with weight); women 39–47%', tolerance: '±7 pp', owner: '§05/§01', status: 'class', population: UFC,
    compute: (d) => ({ comps: perClass(d, ALL_CODES, GROUNDKO_CLASS, (t) => (t > 0.4 ? 0.11 : 0.07), (rs) =>
      share(rs.filter((r) => isKoTko(r.res.m) && r.fin?.k === 'strike'), (r) => r.fin!.pos === 'ground'), 'pct'),
      note: 'Men\'s per-class targets interpolated linearly 21 % (FLW) → 32 % (HW); women 43 % with the half-range added to the tolerance.' }) },
  { id: 84, section: 'Grappling', metric: 'Decisions won by fighter with more control time', target: '68%', tolerance: '±4 pp', owner: '§06', status: 'core', population: UFC,
    compute: (d) => ({ comps: [P('more control wins', decWonByMore(d.ufc, (f) => f.ctrl), 0.68, 0.04)] }) },
  { id: 85, section: 'Grappling', metric: 'Decisions won by fighter with more sig strikes', target: '78%', tolerance: '±4 pp', owner: '§06', status: 'core', population: UFC,
    compute: (d) => ({ comps: [P('more sig wins', decWonByMore(d.ufc, (f) => f.sig[0]), 0.78, 0.04)] }) },
  { id: 86, section: 'Grappling', metric: 'Decisions won by fighter with more TDs', target: '69%', tolerance: '±4 pp', owner: '§06', status: 'core', population: UFC,
    compute: (d) => ({ comps: [P('more TD wins', decWonByMore(d.ufc, (f) => f.td[0]), 0.69, 0.04)] }) },
  { id: 87, section: 'Grappling', metric: 'Striker wins when more strikes but fewer TDs/control', target: '60–63%', tolerance: '±5 pp', owner: '§06', status: 'core', population: UFC,
    compute: (d) => {
      let k = 0;
      let n = 0;
      for (const r of decisions(d.ufc)) {
        for (let s = 0; s < 2; s++) {
          const a = r.f[s];
          const b = r.f[1 - s];
          if (a.sig[0] > b.sig[0] && a.td[0] <= b.td[0] && a.ctrl < b.ctrl) {
            n++;
            if (r.res.w === s) k++;
          }
        }
      }
      return { comps: [P('striker wins', proportion(k, n), 0.615, 0.065)] };
    } },
  // ---- Outcomes --------------------------------------------------------------------
  { id: 88, section: 'Outcomes', metric: 'Outcome mix (all divisions, modern)', target: 'KO/TKO 32% · SUB 18% · DEC 49% · other 1%', tolerance: '±3 pp each', owner: '§05/§04/§06', status: 'core', population: UFC,
    compute: (d) => ({ comps: METHOD_KEYS.map((k, j) => P(k === 'ko' ? 'KO/TKO' : k.toUpperCase(), methodShare(d.ufc, k), [0.32, 0.18, 0.49, 0.01][j], 0.03)) }) },
  { id: 89, section: 'Outcomes', metric: 'Outcome mix (all-time)', target: 'KO/TKO 33% · SUB 19.5% · DEC 47% · other 1.4%', tolerance: '±2 pp', owner: '—', status: 'n/a', population: '—',
    unmeasurable: 'Era statistic; row 88 governs (§7.1 marks it n/a).' },
  { id: 90, section: 'Outcomes', metric: 'KO : TKO ratio', target: 'KO 11.5%, TKO 22.4% of fights', tolerance: '±5 pp', owner: '§05/§06', status: 'core', population: UFC,
    compute: (d) => ({ comps: [P('KO', share(d.ufc, (r) => r.res.m === 'ko'), 0.115, 0.05), P('TKO', share(d.ufc, (r) => r.res.m.startsWith('tko')), 0.224, 0.05)] }) },
  { id: 91, section: 'Outcomes', metric: 'Finish rate by men\'s class', target: 'HW 66 · LHW 61 · MW 59 · WW 52 · LW 51 · FW 45 · FLW 45 · BW 45 (%)', tolerance: '±4 pp', owner: '§05/§01', status: 'class', population: UFC,
    compute: (d) => ({ comps: perClass(d, MEN_CODES, FINISH_CLASS, 0.04, (rs) => share(rs, (r) => isFinish(r.res.m)), 'pct') }) },
  { id: 92, section: 'Outcomes', metric: 'KO/TKO % by men\'s class', target: 'HW 48 · LHW 44 · MW 37 · WW 33 · LW 30 · FW 29 · BW 26 · FLW 25', tolerance: '±4 pp', owner: '§05/§01', status: 'class', population: UFC,
    compute: (d) => ({ comps: perClass(d, MEN_CODES, KO_CLASS, 0.04, (rs) => share(rs, (r) => isKoTko(r.res.m)), 'pct') }) },
  { id: 93, section: 'Outcomes', metric: 'SUB % by men\'s class', target: 'HW 21 · LHW 19 · MW 22 · WW 19 · LW 22 · FW 17.5 · BW 19 · FLW 22', tolerance: '±3 pp', owner: '§04/§01', status: 'class', population: UFC,
    compute: (d) => ({ comps: perClass(d, MEN_CODES, SUB_CLASS, 0.03, (rs) => share(rs, (r) => isSub(r.res.m)), 'pct') }) },
  { id: 94, section: 'Outcomes', metric: 'Women\'s outcome mix (KO / SUB / DEC %)', target: 'W-SW 14/20/66 · W-FLW 17/20/63 · W-BW 22/17/60', tolerance: '±4 pp', owner: '§05/§04/§01', status: 'class', population: UFC,
    compute: (d) => ({ comps: WOMEN_CODES.flatMap((c) => {
      const rs = d.byClass(c);
      const t = W_MIX[c];
      return [
        P(`${c} KO/TKO`, share(rs, (r) => isKoTko(r.res.m)), t[0], 0.04, { grp: c }),
        P(`${c} SUB`, share(rs, (r) => isSub(r.res.m)), t[1], 0.04, { grp: c }),
        P(`${c} DEC`, share(rs, (r) => isDec(r.res.m)), t[2], 0.04, { grp: c }),
      ];
    }) }) },
  { id: 95, section: 'Outcomes', metric: 'Women vs men finish rate', target: '37% vs 54%', tolerance: '±4 pp', owner: '§01', status: 'core', population: UFC,
    compute: (d) => ({ comps: [P('women', share(d.women, (r) => isFinish(r.res.m)), 0.37, 0.04), P('men', share(d.men, (r) => isFinish(r.res.m)), 0.54, 0.04)] }) },
  { id: 96, section: 'Outcomes', metric: 'Era drift (finish rate)', target: '74% → 55% → 49%', tolerance: '—', owner: '—', status: 'n/a', population: '—',
    unmeasurable: 'Era statistic; the sim has no era parameter (§7.1 marks it n/a).' },
  { id: 97, section: 'Outcomes', metric: 'Regional / amateur finish rate', target: 'amateur ~60% (DEC 40, TKO 28, SUB 23, KO 8); regional pro ~69% (DEC 31, TKO 30, SUB 26, KO 12)', tolerance: '±5 pp', owner: '§01 tiers', status: 'core', population: 'tier_matrix T2xT2 (amateur); baseline regional T3 + tier_matrix T3xT3 (regional pro)',
    compute: (d) => {
      const t2 = d.tiers(2, 2);
      const t3 = [...d.all.filter((r) => r.tags.group === 'regional'), ...d.tiers(3, 3)];
      const mix = (rs: ResultRow[], tag: string, t: [number, number, number, number, number]): Comp[] => [
        P(`${tag} finish`, share(rs, (r) => isFinish(r.res.m)), t[0], 0.05),
        P(`${tag} DEC`, share(rs, (r) => isDec(r.res.m)), t[1], 0.05, { info: true }),
        P(`${tag} TKO`, share(rs, (r) => r.res.m.startsWith('tko')), t[2], 0.05, { info: true }),
        P(`${tag} SUB`, share(rs, (r) => isSub(r.res.m)), t[3], 0.05, { info: true }),
        P(`${tag} KO`, share(rs, (r) => r.res.m === 'ko'), t[4], 0.05, { info: true }),
      ];
      return { comps: [...mix(t2, 'T2', [0.60, 0.40, 0.28, 0.23, 0.08]), ...mix(t3, 'T3', [0.69, 0.31, 0.30, 0.26, 0.12])] };
    } },
  { id: 98, section: 'Outcomes', metric: 'Share of finishes by round', target: 'R1 53 · R2 30 · R3 15 · R4–5 2 (%)', tolerance: '±4 pp', owner: '§05/§07', status: 'core', population: UFC,
    compute: (d) => ({ comps: [P('R1', finishesByRoundShare(d.ufc, 1), 0.53, 0.04), P('R2', finishesByRoundShare(d.ufc, 2), 0.30, 0.04), P('R3', finishesByRoundShare(d.ufc, 3), 0.15, 0.04)],
      note: 'The master population is 3-round; the R4–5 share (2 %) belongs to the mma_5r plan.' }) },
  { id: 99, section: 'Outcomes', metric: 'Share of ALL fights ending in R1', target: '26%', tolerance: '±3 pp', owner: '§05/§07', status: 'core', population: UFC,
    compute: (d) => ({ comps: [P('R1 finishes / fights', share(d.ufc, (r) => isFinish(r.res.m) && r.res.r === 1), 0.26, 0.03)] }) },
  { id: 100, section: 'Outcomes', metric: 'Conditional finish hazard per round (3R)', target: 'R1 0.25 · R2|reached 0.21 · R3|reached 0.16', tolerance: '±0.04', owner: '§05/§07', status: 'core', population: UFC,
    compute: (d) => ({ comps: [1, 2, 3].map((k) => {
      const reached = d.ufc.filter((r) => r.res.r >= k);
      return N(`R${k}`, share(reached, (r) => r.res.r === k && isFinish(r.res.m)), [0.25, 0.21, 0.16][k - 1], 0.04);
    }) }) },
  { id: 101, section: 'Outcomes', metric: 'Mean / median fight duration (3R)', target: '10.6 / 15.0 min', tolerance: '±0.8 / —', owner: '§05/§06', status: 'core', population: UFC,
    compute: (d) => {
      const xs = d.ufc.map(fmin);
      return { comps: [M('mean', mean(xs), 10.6, 0.8), M('median', median(xs), 15.0, 0.8, { info: true })] };
    } },
  { id: 102, section: 'Outcomes', metric: '5R fights: mean duration / decision rate', target: '15.5 min / 41%', tolerance: '±1.0 / ±5 pp', owner: '§05/§06', status: 'core', population: 'mma_5r (LW/WW/MW T4, 5 rounds)',
    compute: (d) => {
      const rs = d.plan('mma_5r');
      return { comps: [M('mean duration', mean(rs.map(fmin)), 15.5, 1.0), P('decision rate', share(rs, (r) => isDec(r.res.m)), 0.41, 0.05)] };
    } },
  { id: 103, section: 'Outcomes', metric: 'Mean duration by finish type', target: 'KO/TKO 6.0 · SUB 6.8 · DEC 15.8 · doctor 9.4 min', tolerance: '±0.7', owner: '§05/§04/§06', status: 'core', population: UFC,
    compute: (d) => ({ comps: [
      M('KO/TKO', mean(d.ufc.filter((r) => isKoTko(r.res.m) && r.res.m !== 'tko.doctor').map(fmin)), 6.0, 0.7),
      M('SUB', mean(d.ufc.filter((r) => isSub(r.res.m)).map(fmin)), 6.8, 0.7),
      M('DEC', mean(d.ufc.filter((r) => isDec(r.res.m)).map(fmin)), 15.8, 0.7),
      M('doctor', mean(d.ufc.filter((r) => r.res.m === 'tko.doctor').map(fmin)), 9.4, 0.7),
    ], note: 'DEC target 15.8 reflects the 5-round share of real decisions; a 3-round decision is 15.0 min.' }) },
  { id: 104, section: 'Outcomes', metric: 'Mean duration by class (min)', target: 'HW 9.6 · LHW 9.4 · MW 10.5 · LW 10.6 · WW 11.1 · FW 11.3 · BW 11.5 · FLW 11.6 · W-BW 12.4 · W-SW 12.7 · W-FLW 12.8', tolerance: '±0.8', owner: '§05/§01', status: 'class', population: UFC,
    compute: (d) => ({ comps: perClass(d, ALL_CODES, DUR_CLASS, 0.8, (rs) => mean(rs.map(fmin)), 'min') }) },
  { id: 105, section: 'Outcomes', metric: 'Decision type split', target: 'unanimous 77 · split 20 · majority 2.5 (%)', tolerance: '±3 pp', owner: '§06', status: 'core', population: UFC,
    compute: (d) => {
      const dec = d.ufc.filter((r) => isDec(r.res.m) && r.res.m !== 'decision.technical');
      return { comps: [
        P('unanimous', share(dec, (r) => r.res.m === 'decision.unanimous'), 0.77, 0.03),
        P('split', share(dec, (r) => r.res.m === 'decision.split'), 0.20, 0.03),
        P('majority', share(dec, (r) => r.res.m === 'decision.majority'), 0.025, 0.03),
      ] };
    } },
  { id: 106, section: 'Outcomes', metric: 'Split-or-majority as share of all fights', target: '9.5–11%', tolerance: '±2 pp', owner: '§06', status: 'core', population: UFC,
    compute: (d) => ({ comps: [P('split+majority', share(d.ufc, (r) => r.res.m === 'decision.split' || r.res.m === 'decision.majority'), 0.1025, 0.0275)] }) },
  { id: 107, section: 'Outcomes', metric: 'Draws', target: '0.7% of fights (1.5% of decisions)', tolerance: '±0.3 pp', owner: '§06', status: 'core', population: UFC,
    compute: (d) => ({ comps: [
      P('draws / fights', share(d.ufc, (r) => isDraw(r.res.m)), 0.007, 0.003),
      P('draws / decisions', share(d.ufc.filter((r) => isDec(r.res.m) || isDraw(r.res.m)), (r) => isDraw(r.res.m)), 0.015, 0.006, { info: true }),
    ] }) },
  { id: 108, section: 'Outcomes', metric: 'No contest + DQ', target: '1.3% of fights', tolerance: '±0.5 pp', owner: '§06', status: 'core', population: UFC,
    compute: (d) => ({ comps: [P('NC + DQ', share(d.ufc, (r) => r.res.m === 'noContest' || r.res.m === 'dq'), 0.013, 0.005)] }) },
  { id: 109, section: 'Outcomes', metric: 'Doctor stoppages', target: '≈0.8–1.1% of fights', tolerance: '±0.4 pp', owner: '§05/§06', status: 'core', population: UFC,
    compute: (d) => ({ comps: [P('doctor stoppages', share(d.ufc, (r) => r.res.m === 'tko.doctor'), 0.0095, 0.0055)] }) },
  { id: 110, section: 'Outcomes', metric: 'Referee stoppage lag after KO blow', target: '3.5 s; 2.6 extra head strikes', tolerance: '±1.5 s', owner: '§06', status: 'core', population: UFC,
    compute: (d) => {
      const rs = d.ufc.filter((r) => isKoTko(r.res.m) && r.lag);
      return { comps: [S('lag', mean(rs.map((r) => r.lag![0])), 3.5, 1.5), N('extra strikes', mean(rs.map((r) => r.lag![1])), 2.6, 1, { info: true })] };
    } },
  { id: 111, section: 'Outcomes', metric: 'Within-round finish timing', target: 'hazard highest in minute 1, declining; final-second finishes ≈0', tolerance: 'qualitative', owner: '§07', status: 'proxy', population: UFC,
    compute: (d) => {
      const fins = d.ufc.filter((r) => isFinish(r.res.m) && r.rl > 0);
      const minutes = [0, 0, 0, 0, 0];
      for (const r of fins) minutes[Math.min(4, Math.floor(r.res.t / 60))]++;
      let mono = fins.length > 0;
      for (let k = 1; k < 5; k++) if (fins.length > 0 && (minutes[k] - minutes[k - 1]) / fins.length > 0.02) mono = false;
      return { comps: [
        bool('minute histogram non-increasing (2 pp slack)', fins.length > 0 ? mono : null),
        P('finishes in last 5 s of a round', share(fins, (r) => r.rl - r.res.t <= 5), 0.005, 0.005),
      ], note: `Finishes by minute of round: ${minutes.join(' / ')}.` };
    } },
  { id: 112, section: 'Outcomes', metric: 'Title-fight finish rate (5R)', target: '57% (47% within first 15 min)', tolerance: '±5 pp', owner: '§05/§07', status: 'core', population: 'mma_5r',
    compute: (d) => {
      const rs = d.plan('mma_5r');
      return { comps: [P('finish rate', share(rs, (r) => isFinish(r.res.m)), 0.57, 0.05), P('finished in R1–3', share(rs, (r) => isFinish(r.res.m) && r.res.r <= 3), 0.47, 0.05)] };
    } },
  { id: 113, section: 'Outcomes', metric: 'Rematch: first-fight winner repeats', target: '63–66%', tolerance: '±5 pp', owner: '§01', status: 'proxy', population: 'rematch (same pair, new seed)',
    compute: (d) => {
      const rs = d.plan('rematch');
      const byPair = new Map<number, ResultRow[]>();
      for (const r of rs) {
        const p = r.bt?.pair;
        if (p === undefined) continue;
        const list = byPair.get(p) ?? [];
        list.push(r);
        byPair.set(p, list);
      }
      let k = 0;
      let n = 0;
      for (const list of byPair.values()) {
        if (list.length < 2) continue;
        list.sort((a, b) => a.i - b.i);
        if (typeof list[0].res.w !== 'number' || typeof list[1].res.w !== 'number') continue;
        n++;
        if (list[0].res.w === list[1].res.w) k++;
      }
      return { comps: [P('winner repeats', proportion(k, n), 0.645, 0.065)], note: 'Same two definitions, new seed; no career effects between the bouts.' };
    } },
  { id: 114, section: 'Outcomes', metric: 'Judge round agreement (3/3 same winner)', target: '77%', tolerance: '±4 pp', owner: '§06', status: 'core', population: UFC,
    compute: (d) => {
      let k = 0;
      let n = 0;
      for (const r of d.ufc) {
        if (!r.cards || r.cards.length < 3) continue;
        const rounds = Math.min(...r.cards.map((j) => j.length));
        for (let q = 0; q < rounds; q++) {
          const w = r.cards.map((j) => Math.sign((j[q]?.[0] ?? 0) - (j[q]?.[1] ?? 0)));
          n++;
          if (w.every((x) => x === w[0]) && w[0] !== 0) k++;
        }
      }
      return { comps: [P('3/3 agree', proportion(k, n), 0.77, 0.04)], note: 'Every scored round, finishes included.' };
    } },
  // ---- Mismatch ----------------------------------------------------------------------
  { id: 115, section: 'Mismatch', metric: 'Favourite (better-skilled) win rate at typical odds', target: '65–69% overall; −400…−900 → 88–93%; pick\'em 50–51%', tolerance: '±3 pp', owner: '§01/§07', status: 'core', population: `${UFC}; rating = §01 mmaMean`,
    compute: (d) => {
      const b = ratingBuckets(d.ufc);
      return { comps: [
        P('typical favourite (gap 0.5–1.0 SD)', b.typical, 0.67, 0.05),
        P('pick\'em (gap < 0.1 SD)', b.pickem, 0.505, 0.035),
        P('heavy favourite (gap ≥ 2.5 SD)', b.heavy, 0.905, 0.055, { info: true }),
      ], note: 'Rating gaps in SD units of the population\'s mmaMean; the heavy bucket is thin in a same-tier population (see §7.3 T6).' };
    } },
  { id: 116, section: 'Mismatch', metric: 'Reach edge win rate', target: 'any 51.7%; ≥2.5 in standing-heavy 60%; >7 in 63%; ground-heavy 49%', tolerance: '±3 pp', owner: '§01/§02/§07', status: 'core', population: 'ufc population (any edge); physical_sweeps reach cells (the rest)',
    compute: (d) => {
      const us = fighterUnits(d.ufc).filter((u) => u.f.m.reach > u.opp.m.reach && typeof u.row.res.w === 'number');
      const cells = SWEEP_REACH_7.flatMap((v) => d.sweep('reach', v));
      const standing = cells.filter((r) => r.res.fs > 0 && r.pos[0] / r.res.fs >= 0.6);
      const ground = cells.filter((r) => r.res.fs > 0 && r.pos[2] / r.res.fs >= 0.7);
      return { comps: [
        P('any reach edge (population)', proportion(us.filter((u) => u.won).length, us.length), 0.517, 0.03),
        P('≥ 7 cm, standing-heavy', edgeWinRate(standing), 0.60, 0.03),
        P('≥ 17.8 cm (7 in)', edgeWinRate(d.sweep('reach', 18)), 0.63, 0.03),
        P('≥ 7 cm, ground-heavy', edgeWinRate(ground), 0.49, 0.03),
      ] };
    } },
  { id: 117, section: 'Mismatch', metric: 'Age edge win rate', target: '≥3–4 yr younger → 58–60%', tolerance: '±3 pp', owner: '§01', status: 'core', population: 'physical_sweeps age 28 / 34 vs 31',
    compute: (d) => {
      const younger = [...d.sweep('age', 28).map((r) => ({ r, youngIsEdge: true })), ...d.sweep('age', 34).map((r) => ({ r, youngIsEdge: false }))];
      let k = 0;
      for (const { r, youngIsEdge } of younger) {
        const young = youngIsEdge ? r.bt!.edge! : 1 - r.bt!.edge!;
        if (r.res.w === young) k++;
        else if (typeof r.res.w !== 'number') k += 0.5;
      }
      return { comps: [P('younger by 3 yr wins', proportion(k, younger.length), 0.59, 0.04)] };
    } },
  { id: 118, section: 'Mismatch', metric: 'Win rate by absolute age', target: '<25 58% → 28–30 52% → 34–36 42.5% → 37+ 38%', tolerance: '±3 pp', owner: '§01', status: 'core', population: 'physical_sweeps age (vs a 31-year-old clone)',
    compute: (d) => ({ comps: [
      P('age 22', edgeWinRate(d.sweep('age', 22)), 0.58, 0.03),
      P('age 28', edgeWinRate(d.sweep('age', 28)), 0.52, 0.03),
      P('age 34', edgeWinRate(d.sweep('age', 34)), 0.425, 0.03),
      P('age 37–40', edgeWinRate([...d.sweep('age', 37), ...d.sweep('age', 40)]), 0.38, 0.03),
    ], note: 'Opponent is the same fighter at 31, not the population; the source is a population rate.' }) },
  { id: 119, section: 'Mismatch', metric: 'KO-loss rate by age / KD history', target: '<25 ≈10% → 37+ 25%; never-dropped 14% → 5+ KDs 25%', tolerance: '±4 pp', owner: '§01/§05', status: 'core', population: 'physical_sweeps age (age parts); ufc population (KD history)',
    compute: (d) => {
      const koLoss = (rows: ResultRow[]): Estimate => {
        const rs = rows.filter((r) => r.bt?.edge !== undefined);
        return proportion(rs.filter((r) => isKoTko(r.res.m) && r.res.w === 1 - r.bt!.edge!).length, rs.length);
      };
      const us = fighterUnits(d.ufc);
      const kl = (xs: typeof us) => proportion(xs.filter((u) => u.lost && isKoTko(u.row.res.m)).length, xs.length);
      return { comps: [
        P('age 22 KO-loss', koLoss(d.sweep('age', 22)), 0.10, 0.04),
        P('age 37–40 KO-loss', koLoss([...d.sweep('age', 37), ...d.sweep('age', 40)]), 0.25, 0.04),
        P('never dropped', kl(us.filter((u) => u.f.m.kdHist === 0)), 0.14, 0.04),
        P('5+ career KDs', kl(us.filter((u) => u.f.m.kdHist >= 5)), 0.25, 0.04),
      ] };
    } },
  { id: 120, section: 'Mismatch', metric: 'Southpaw vs orthodox', target: '50–57% for southpaw (use ≈52%)', tolerance: '±3 pp', owner: '§02/§07', status: 'core', population: 'physical_sweeps stance (southpaw clone vs orthodox)',
    compute: (d) => ({ comps: [P('southpaw wins', edgeWinRate(d.sweep('stance', 'southpaw')), 0.52, 0.03)] }) },
  { id: 121, section: 'Mismatch', metric: 'Heavier at weigh-in (≤6 lb)', target: '54.5%', tolerance: '±3 pp', owner: '§01', status: 'core', population: 'physical_sweeps mass +2.7 kg',
    compute: (d) => ({ comps: [P('+2.7 kg wins', edgeWinRate(d.sweep('mass', 2.7)), 0.545, 0.03)] }) },
  { id: 122, section: 'Mismatch', metric: 'Debutant vs veteran', target: '43%', tolerance: '±4 pp', owner: '§01', status: 'proxy', population: 'physical_sweeps experience (record zeroed)',
    compute: (d) => ({ comps: [P('debutant wins', edgeWinRate(d.sweep('experience', 'debut')), 0.43, 0.04)], note: 'Same fighter with an empty record: isolates the experience attribute only.' }) },
  { id: 123, section: 'Mismatch', metric: 'Late replacement', target: '37%', tolerance: '±4 pp', owner: '—', status: 'n/a', population: '—',
    unmeasurable: 'No short-notice / camp-length attribute in the fighter model (§7.1 marks it n/a).' },
  { id: 124, section: 'Mismatch', metric: 'Layoff >210 d / ≥1 yr', target: '41% / 35%', tolerance: '±5 pp', owner: '—', status: 'n/a', population: '—',
    unmeasurable: 'Layoff is authored (`daysSinceLastBout`) but not wired to performance (§7.1 marks it n/a).' },
  // ---- Round dynamics --------------------------------------------------------------------
  { id: 125, section: 'Round dynamics', metric: 'Knockdown-rate decay by round (relative to R1)', target: 'x1.0 → x0.45 → x0.28', tolerance: '±0.1', owner: '§05/§07', status: 'core', population: UFC,
    compute: (d) => {
      const r1 = kdRateByRound(d.ufc, 1);
      return { comps: [N('R2 / R1', quotient(kdRateByRound(d.ufc, 2), r1), 0.45, 0.1), N('R3 / R1', quotient(kdRateByRound(d.ufc, 3), r1), 0.28, 0.1)] };
    } },
  { id: 126, section: 'Round dynamics', metric: 'Submission success decay', target: 'R3 ≈ 0.5x R1–R2 success per attempt', tolerance: '±0.15', owner: '§04/§05', status: 'core', population: UFC,
    compute: (d) => {
      const rs = oneVone(d.ufc);
      const succ = (rounds: number[]) => ratio(
        rs.map((r) => (isSub(r.res.m) && rounds.includes(r.res.r) ? 1 : 0)),
        rs.map((r) => rounds.reduce((s, q) => s + sumBoth(r, (f) => f.rsu[q - 1] ?? 0), 0)),
      );
      return { comps: [N('R3 / R1–2', quotient(succ([3]), succ([1, 2])), 0.5, 0.15)] };
    } },
  { id: 127, section: 'Round dynamics', metric: 'Standing low-intensity time per round (median)', target: 'R1 154 s · R2 157 s · R3 127 s', tolerance: '±20 s', owner: '§07', status: 'core', population: `${UFC}; rounds that ran their full length`,
    compute: (d) => ({ comps: [1, 2, 3].map((k) => {
      const rs = d.ufc.filter((r) => r.rl > 0 && (r.live[k - 1] ?? 0) >= r.rl - 0.5);
      return S(`R${k}`, median(rs.map((r) => r.low[k - 1] ?? 0)), [154, 157, 127][k - 1], 20);
    }), note: 'Low intensity = both at distance and no strike attempt by either in the last 2 s.' }) },
  { id: 128, section: 'Round dynamics', metric: 'High-intensity action count decline (striking sports)', target: '−8% R1→R3 (kickboxing proxy)', tolerance: '±5%', owner: '§07/§05', status: 'proxy', population: `${UFC}; bouts that went the distance`,
    compute: (d) => {
      const rs = oneVone(d.ufc).filter((r) => r.res.r >= 3 && isDec(r.res.m));
      const r3 = ratio(rs.map((r) => sumBoth(r, (f) => f.rst[2] ?? 0)), rs.map((r) => sumBoth(r, (f) => f.rst[0] ?? 0)));
      return { comps: [P('R3 vs R1 strike attempts', { ...r3, value: r3.value === null ? null : r3.value - 1 }, -0.08, 0.05)],
        note: 'Computed on MMA (no kickboxing plan yet): all strike attempts R3 / R1 − 1.' };
    } },
  { id: 129, section: 'Round dynamics', metric: 'Trailing fighter TD / sub attempts', target: '−38% / −49%', tolerance: '±15%', owner: '§07', status: 'core', population: `${UFC}; behind after R2 on the true cards`,
    compute: (d) => {
      const t = trailing(d.ufc);
      return { comps: [P('TD attempts, behind vs ahead', t.td, -0.38, 0.15), P('sub attempts, behind vs ahead', t.sub, -0.49, 0.15)], note: 'R3 attempts of the fighter behind after R2 relative to the fighter ahead.' };
    } },
];

export const SWEEP_REACH_7 = [7.5, 10, 15, 18] as const;

// ---------------------------------------------------------------------------
// Shared helpers used by rows and checks
// ---------------------------------------------------------------------------

/** R3 behaviour of the fighter behind after R2 (true cards), relative to the one ahead. */
export function trailing(rows: readonly ResultRow[]): { td: Estimate; sub: Estimate; sigUp: Estimate; n: number } {
  const behindTd: number[] = [];
  const aheadTd: number[] = [];
  const behindSub: number[] = [];
  const aheadSub: number[] = [];
  const r3: number[] = [];
  const r2: number[] = [];
  for (const r of oneVone(rows)) {
    if (r.res.r < 3) continue;
    const c = cardTotals(r, 2);
    if (!c || c[0] === c[1]) continue;
    const behind = c[0] < c[1] ? 0 : 1;
    const b = r.f[behind];
    const a = r.f[1 - behind];
    behindTd.push(b.rta[2] ?? 0);
    aheadTd.push(a.rta[2] ?? 0);
    behindSub.push(b.rsu[2] ?? 0);
    aheadSub.push(a.rsu[2] ?? 0);
    r3.push(b.rsa[2] ?? 0);
    r2.push(b.rsa[1] ?? 0);
  }
  const rel = (x: number[], y: number[]): Estimate => {
    const e = ratio(x, y);
    return { ...e, value: e.value === null ? null : e.value - 1 };
  };
  return { td: rel(behindTd, aheadTd), sub: rel(behindSub, aheadSub), sigUp: rel(r3, r2), n: r3.length };
}

/** Better-rated fighter's win rate by rating-gap bucket (SD units of the population). */
export function ratingBuckets(rows: readonly ResultRow[]): { typical: Estimate; pickem: Estimate; heavy: Estimate; sdRating: number; points: { gap: number; win: number }[] } {
  const rs = oneVone(rows).filter((r) => Number.isFinite(r.f[0].m.rating) && Number.isFinite(r.f[1].m.rating));
  const ratings = rs.flatMap((r) => [r.f[0].m.rating, r.f[1].m.rating]);
  const mu = ratings.reduce((s, x) => s + x, 0) / Math.max(1, ratings.length);
  const sdR = Math.sqrt(ratings.reduce((s, x) => s + (x - mu) * (x - mu), 0) / Math.max(1, ratings.length - 1));
  const points: { gap: number; win: number }[] = [];
  for (const r of rs) {
    const g = r.f[0].m.rating - r.f[1].m.rating;
    const fav = g >= 0 ? 0 : 1;
    const win = r.res.w === fav ? 1 : typeof r.res.w === 'number' ? 0 : 0.5;
    points.push({ gap: sdR > 0 ? Math.abs(g) / sdR : 0, win });
  }
  const bucket = (lo: number, hi: number): Estimate => {
    const xs = points.filter((p) => p.gap >= lo && p.gap < hi);
    return proportion(xs.reduce((s, p) => s + p.win, 0), xs.length);
  };
  return { typical: bucket(0.5, 1.0), pickem: bucket(0, 0.1), heavy: bucket(2.5, Infinity), sdRating: sdR, points };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface CompResult extends Comp {
  verdict: Verdict;
  z: number | null;
}

export interface RowResult {
  row: MasterRow;
  comps: CompResult[];
  verdict: Verdict | 'N/A';
  note?: string;
  /** class rows: classes passing / classes with data. */
  classPass?: { men: [number, number]; women: [number, number] };
}

export function judgeComp(c: Comp): CompResult {
  if (c.forced) return { ...c, verdict: c.est.value === null ? 'NO DATA' : c.forced, z: null };
  if (c.kind === 'ge' || c.kind === 'le') {
    const v = c.est.value;
    if (v === null || !Number.isFinite(v)) return { ...c, verdict: 'NO DATA', z: null };
    const ci = c.est.ci ?? Infinity;
    const ok = c.kind === 'ge' ? v >= c.target : v <= c.target;
    const sure = c.kind === 'ge' ? v - ci >= c.target : v + ci <= c.target;
    const verdict: Verdict = !ok ? 'FAIL' : sure ? 'PASS' : 'WIDE';
    return { ...c, verdict: c.info ? 'INFO' : verdict, z: null };
  }
  if (c.unit === 'bool') {
    const v = c.est.value;
    return { ...c, verdict: v === null ? 'NO DATA' : c.info ? 'INFO' : v === 1 ? 'PASS' : 'FAIL', z: null };
  }
  const v = verdictOf({ value: c.est.value, ci: c.est.ci, target: c.target, tol: c.tol });
  return { ...c, verdict: c.info && v !== 'NO DATA' ? 'INFO' : v, z: zOf({ value: c.est.value, ci: c.est.ci, target: c.target, tol: c.tol }) };
}

/** Combine gated component verdicts: any FAIL → FAIL; all PASS → PASS; no data → NO DATA; else WIDE. */
export function combine(vs: readonly Verdict[]): Verdict {
  const gated = vs.filter((v) => v !== 'INFO');
  if (gated.length === 0) return 'NO DATA';
  if (gated.every((v) => v === 'NO DATA')) return 'NO DATA';
  if (gated.some((v) => v === 'FAIL')) return 'FAIL';
  if (gated.every((v) => v === 'PASS')) return 'PASS';
  return 'WIDE';
}

export function evaluateRow(row: MasterRow, d: Dataset): RowResult {
  if (!row.compute || row.status === 'n/a') return { row, comps: [], verdict: 'N/A', note: row.unmeasurable };
  const res = row.compute(d);
  const comps = res.comps.map(judgeComp);
  if (row.status !== 'class') return { row, comps, verdict: combine(comps.map((c) => c.verdict)), note: res.note };

  // class rows: a class passes when all of its components pass.
  const groups = new Map<string, CompResult[]>();
  for (const c of comps) {
    const g = c.grp ?? c.label;
    const list = groups.get(g) ?? [];
    list.push(c);
    groups.set(g, list);
  }
  const menCodes = [...groups.keys()].filter((g) => (MEN_CODES as readonly string[]).includes(g));
  const womenCodes = [...groups.keys()].filter((g) => (WOMEN_CODES as readonly string[]).includes(g));
  const classVerdict = (g: string): Verdict => combine(groups.get(g)!.map((c) => c.verdict));
  const menV = menCodes.map(classVerdict);
  const womenV = womenCodes.map(classVerdict);
  const menPass = menV.filter((v) => v === 'PASS').length;
  const womenPass = womenV.filter((v) => v === 'PASS').length;
  const needMen = Math.min(6, menCodes.length);
  const needWomen = Math.max(0, womenCodes.length - 1);
  const all = [...menV, ...womenV];
  let verdict: Verdict;
  if (all.length === 0 || all.every((v) => v === 'NO DATA')) verdict = 'NO DATA';
  else if (menPass >= needMen && womenPass >= needWomen) verdict = 'PASS';
  else {
    // FAIL when too many classes are outright off target to reach the quota.
    const menFail = menV.filter((v) => v === 'FAIL').length;
    const womenFail = womenV.filter((v) => v === 'FAIL').length;
    verdict = menCodes.length - menFail < needMen || womenCodes.length - womenFail < needWomen ? 'FAIL' : 'WIDE';
  }
  return {
    row, comps, verdict, note: res.note,
    classPass: { men: [menPass, menCodes.length], women: [womenPass, womenCodes.length] },
  };
}

export function evaluateAll(d: Dataset): RowResult[] {
  return MASTER_ROWS.map((r) => evaluateRow(r, d));
}
