/**
 * WORKSTREAM 3 - ANALYTICS DASHBOARD
 *
 * Aggregates every supplied replay's `BoutAnalytics` per format (1v1 .. 1v5)
 * and renders the result as hand-written inline SVG (see `charts.tsx`).
 *
 * WHAT THE UNCERTAINTY NUMBERS MEAN
 * ---------------------------------
 * Every interval on this page - Wilson intervals, interquartile bands,
 * standard errors - describes ONE thing: how much the reported statistic
 * would wobble if the same model were re-run with different random seeds.
 * It is Monte Carlo sampling error over this toy model's own output. It says
 * nothing whatsoever about real fights, real athletes, or the real world; the
 * model's assumptions are not in the interval. A tight interval here means the
 * simulator is being consistent with itself, not that it is right.
 *
 * PERFORMANCE
 * -----------
 * Up to 5 formats x 1000 bouts. All aggregation happens in `useMemo`, keyed on
 * the selected format, and the bout table is paginated - never 5000 rows at once.
 */

// dashboard.css is a Vite side-effect import; the repo has no ambient CSS module
// declaration, and adding one would mean touching another workstream's file.
// @ts-ignore
import './dashboard.css';

import { useCallback, useMemo, useState } from 'react';
import type { ReplayFile, BoutAnalytics } from '../engine/recorder';
import {
  ChartCard, ColumnBars, BarRows, StackedShare, QuartileStrip,
  IntervalDotPlot, TrajectoryChart, DivergingTrajectory, StatTile, IntervalMeter,
  SERIES, fmtClock, fmtNum, fmtPct,
  type IntervalRow, type TableView, type TrajectorySeries,
} from './charts';

/* ================================================================== */
/* statistics                                                          */
/* ================================================================== */

const Z95 = 1.959963985;

export interface Interval { p: number; lo: number; hi: number; k: number; n: number }

/** 95% Wilson score interval for a binomial proportion. */
export function wilson(k: number, n: number, z = Z95): Interval {
  if (n <= 0) return { p: 0, lo: 0, hi: 0, k, n };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return {
    p,
    lo: Math.max(0, (centre - spread) / d),
    hi: Math.min(1, (centre + spread) / d),
    k, n,
  };
}

/** Type-7 (linear interpolation) quantile of an already-sorted array. */
export function quantileSorted(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const h = (n - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export interface FiveNumber { min: number; q1: number; med: number; q3: number; max: number; n: number }

function fiveNumber(values: number[]): FiveNumber {
  if (values.length === 0) return { min: 0, q1: 0, med: 0, q3: 0, max: 0, n: 0 };
  const s = [...values].sort((a, b) => a - b);
  return {
    min: s[0], q1: quantileSorted(s, 0.25), med: quantileSorted(s, 0.5),
    q3: quantileSorted(s, 0.75), max: s[s.length - 1], n: s.length,
  };
}

function meanOf(v: number[]): number {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

/** Mean with a 95% Monte Carlo standard-error interval. */
function meanCI(v: number[]): { mean: number; lo: number; hi: number; sd: number; n: number } {
  const n = v.length;
  if (n === 0) return { mean: 0, lo: 0, hi: 0, sd: 0, n: 0 };
  const mean = meanOf(v);
  if (n === 1) return { mean, lo: mean, hi: mean, sd: 0, n };
  let ss = 0;
  for (const x of v) ss += (x - mean) * (x - mean);
  const sd = Math.sqrt(ss / (n - 1));
  const se = sd / Math.sqrt(n);
  return { mean, lo: mean - Z95 * se, hi: mean + Z95 * se, sd, n };
}

/**
 * Per-sample-index statistics over RAGGED trajectories.
 *
 * Bouts end at different times, so their sample arrays have different lengths.
 * At index i we use only the bouts that actually reached i - no padding, no
 * carry-forward, no truncation to the shortest bout. `counts[i]` records how
 * many bouts that was, so the UI can show where the sample size collapses.
 */
export interface RaggedStat { mean: number[]; lo: number[]; hi: number[]; counts: number[]; length: number }

function raggedStats(rows: (number[] | undefined)[], maxLen: number): RaggedStat {
  const len = Math.min(maxLen, rows.reduce((m, r) => Math.max(m, r ? r.length : 0), 0));
  const buckets: number[][] = Array.from({ length: len }, () => []);
  for (const r of rows) {
    if (!r) continue;
    const upto = Math.min(r.length, len);
    for (let i = 0; i < upto; i++) {
      const v = r[i];
      if (typeof v === 'number' && isFinite(v)) buckets[i].push(v);
    }
  }
  const mean = new Array<number>(len);
  const lo = new Array<number>(len);
  const hi = new Array<number>(len);
  const counts = new Array<number>(len);
  for (let i = 0; i < len; i++) {
    const b = buckets[i];
    counts[i] = b.length;
    if (b.length === 0) {
      mean[i] = i > 0 ? mean[i - 1] : 0; lo[i] = mean[i]; hi[i] = mean[i];
      continue;
    }
    b.sort((x, y) => x - y);
    mean[i] = meanOf(b);
    lo[i] = quantileSorted(b, 0.25);
    hi[i] = quantileSorted(b, 0.75);
  }
  return { mean, lo, hi, counts, length: len };
}

/* ================================================================== */
/* aggregation                                                         */
/* ================================================================== */

const SAMPLE_SECONDS = 5;
/** Hard cap on trajectory length so a runaway bout cannot blow up the chart. */
const MAX_SAMPLES = 400;

const DECISION_METHODS = new Set([
  'unanimous decision', 'split decision', 'majority decision', 'draw',
]);

export interface FormatAggregate {
  opponents: number;
  bouts: number;
  aWins: number; bWins: number; draws: number;
  winRate: Interval;
  methods: { label: string; count: number; aShare: number }[];
  roundBins: { label: string; value: number }[];
  finishTime: FiveNumber;
  durationAll: FiveNumber;
  durationHistogram: { label: string; value: number }[];
  strikes: { landed: number; missed: number; blocked: number; evaded: number; total: number };
  meanSignificant: { mean: number; lo: number; hi: number; sd: number; n: number };
  takedowns: Interval;
  meanTakedownAttempts: number;
  subRate: { mean: number; lo: number; hi: number; sd: number; n: number };
  subBoutShare: Interval;
  knockdownRate: { mean: number; lo: number; hi: number; sd: number; n: number };
  posture: { standing: number; clinch: number; ground: number; down: number; total: number };
  staminaA: RaggedStat;
  staminaB: RaggedStat;
  score: RaggedStat;
  accuracyA: { mean: number; lo: number; hi: number; sd: number; n: number };
}

function analyticsOf(r: ReplayFile): BoutAnalytics { return r.analytics; }

function aggregate(opponents: number, replays: ReplayFile[]): FormatAggregate {
  const n = replays.length;
  const all = replays.map(analyticsOf);

  let aWins = 0, bWins = 0, draws = 0;
  const methodMap = new Map<string, { count: number; a: number }>();
  const roundFinish = [0, 0, 0];
  let decisions = 0;
  const finishTimes: number[] = [];
  const durations: number[] = [];
  const sig: number[] = [];
  const subs: number[] = [];
  const kds: number[] = [];
  const accA: number[] = [];
  let landed = 0, missed = 0, blocked = 0, evaded = 0;
  let tdA = 0, tdL = 0, tdAttemptsTotal = 0;
  let subBouts = 0;
  const posture = { standing: 0, clinch: 0, ground: 0, down: 0 };

  const staminaARows: (number[] | undefined)[] = [];
  const staminaBRows: (number[] | undefined)[] = [];
  const scoreRows: (number[] | undefined)[] = [];

  for (const a of all) {
    if (a.winner === 'A') aWins++; else if (a.winner === 'B') bWins++; else draws++;

    const m = methodMap.get(a.method) ?? { count: 0, a: 0 };
    m.count++; if (a.winner === 'A') m.a++;
    methodMap.set(a.method, m);

    const isDecision = DECISION_METHODS.has(a.method);
    if (isDecision) decisions++;
    else {
      const r = Math.min(3, Math.max(1, a.round));
      roundFinish[r - 1]++;
      // Time to the finish: full rounds elapsed plus the time into the last one.
      finishTimes.push(a.totalSeconds);
    }
    durations.push(a.totalSeconds);
    sig.push(a.significantActions);
    subs.push(a.submissionAttempts);
    kds.push(a.knockdowns);
    if (a.submissionAttempts > 0) subBouts++;

    landed += a.actionsLanded; missed += a.actionsMissed;
    blocked += a.actionsBlocked; evaded += a.actionsEvaded;

    tdA += a.takedownsAttempted; tdL += a.takedownsLanded;
    tdAttemptsTotal += a.takedownsAttempted;

    posture.standing += a.postureSeconds.standing;
    posture.clinch += a.postureSeconds.clinch;
    posture.ground += a.postureSeconds.ground;
    posture.down += a.postureSeconds.down;

    const teamOf = new Map<number, 'A' | 'B'>();
    for (const f of a.perFighter) teamOf.set(f.id, f.team);
    const fa = a.perFighter.find((f) => f.team === 'A');
    if (fa) accA.push(fa.accuracy);

    const aTraj = a.staminaTrajectory.find((t) => teamOf.get(t.id) === 'A');
    staminaARows.push(aTraj?.samples);

    const bTrajs = a.staminaTrajectory.filter((t) => teamOf.get(t.id) === 'B');
    if (bTrajs.length === 1) staminaBRows.push(bTrajs[0].samples);
    else if (bTrajs.length > 1) {
      // B side of a 1-v-N bout: average the opponents at each sample point.
      const len = bTrajs.reduce((mx, t) => Math.max(mx, t.samples.length), 0);
      const avg = new Array<number>(len);
      for (let i = 0; i < len; i++) {
        let s = 0, c = 0;
        for (const t of bTrajs) { if (i < t.samples.length) { s += t.samples[i]; c++; } }
        avg[i] = c ? s / c : NaN;
      }
      staminaBRows.push(avg);
    } else staminaBRows.push(undefined);

    scoreRows.push(a.scoreTrajectory);
  }

  const methods = [...methodMap.entries()]
    .map(([label, v]) => ({ label, count: v.count, aShare: v.count ? v.a / v.count : 0 }))
    .sort((x, y) => y.count - x.count);

  const durationAll = fiveNumber(durations);
  const histTop = Math.max(60, durationAll.max);
  const binW = histTop > 900 ? 120 : histTop > 450 ? 60 : 30;
  const nb = Math.max(1, Math.ceil(histTop / binW));
  const hist = Array.from({ length: nb }, (_, i) => ({
    label: `${Math.round((i * binW) / 60)}m`, value: 0,
  }));
  for (const d of durations) {
    const i = Math.min(nb - 1, Math.floor(d / binW));
    hist[i].value++;
  }

  return {
    opponents,
    bouts: n,
    aWins, bWins, draws,
    winRate: wilson(aWins, n),
    methods,
    roundBins: [
      { label: 'R1', value: roundFinish[0] },
      { label: 'R2', value: roundFinish[1] },
      { label: 'R3', value: roundFinish[2] },
      { label: 'decision', value: decisions },
    ],
    finishTime: fiveNumber(finishTimes),
    durationAll,
    durationHistogram: hist,
    strikes: {
      landed, missed, blocked, evaded,
      total: landed + missed + blocked + evaded,
    },
    meanSignificant: meanCI(sig),
    takedowns: wilson(tdL, tdA),
    meanTakedownAttempts: n ? tdAttemptsTotal / n : 0,
    subRate: meanCI(subs),
    subBoutShare: wilson(subBouts, n),
    knockdownRate: meanCI(kds),
    posture: {
      ...posture,
      total: posture.standing + posture.clinch + posture.ground + posture.down,
    },
    staminaA: raggedStats(staminaARows, MAX_SAMPLES),
    staminaB: raggedStats(staminaBRows, MAX_SAMPLES),
    score: raggedStats(scoreRows, MAX_SAMPLES),
    accuracyA: meanCI(accA),
  };
}

/* ================================================================== */
/* bout table                                                          */
/* ================================================================== */

type SortKey = 'index' | 'winner' | 'method' | 'round' | 'time' | 'sig' | 'acc' | 'td' | 'sub';
type SortDir = 'asc' | 'desc';

interface Row {
  index: number; winner: string; method: string; round: number;
  time: number; sig: number; acc: number; td: string; tdRatio: number; sub: number;
}

const PAGE_SIZE = 40;

const COLUMNS: { key: SortKey; label: string; numeric: boolean; title: string }[] = [
  { key: 'index', label: '#', numeric: true, title: 'Bout index within this format' },
  { key: 'winner', label: 'Winner', numeric: false, title: 'A side, B side, or draw' },
  { key: 'method', label: 'Method', numeric: false, title: 'How the bout ended' },
  { key: 'round', label: 'Rd', numeric: true, title: 'Round the bout ended in' },
  { key: 'time', label: 'Time', numeric: true, title: 'Total simulated bout time' },
  { key: 'sig', label: 'Sig. actions', numeric: true, title: 'Significant actions attempted, both sides' },
  { key: 'acc', label: 'A accuracy', numeric: true, title: 'A-side significant strike accuracy' },
  { key: 'td', label: 'TD', numeric: true, title: 'Takedowns landed / attempted' },
  { key: 'sub', label: 'Sub att.', numeric: true, title: 'Submission attempts' },
];

function BoutTable({ rows, opponents, onOpenBout }: {
  rows: Row[]; opponents: number; onOpenBout?: (opponents: number, index: number) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'index', dir: 'asc' });
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      String(r.index).includes(q) ||
      r.winner.toLowerCase().includes(q) ||
      r.method.toLowerCase().includes(q));
  }, [rows, query]);

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const key = sort.key;
    const copy = filtered.slice();
    copy.sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      if (key === 'td') { av = a.tdRatio; bv = b.tdRatio; }
      else { av = a[key] as number | string; bv = b[key] as number | string; }
      if (typeof av === 'string' || typeof bv === 'string') {
        const s = String(av).localeCompare(String(bv));
        return s !== 0 ? s * dir : (a.index - b.index);
      }
      return av === bv ? a.index - b.index : (av < bv ? -1 : 1) * dir;
    });
    return copy;
  }, [filtered, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const slice = useMemo(
    () => sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE),
    [sorted, safePage],
  );

  const toggle = useCallback((key: SortKey) => {
    setSort((s) => (s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'index' || key === 'winner' || key === 'method' ? 'asc' : 'desc' }));
    setPage(0);
  }, []);

  return (
    <section className="dash-card dash-card-wide">
      <header className="dash-card-head">
        <h3 className="dash-card-title">Every bout</h3>
        <p className="dash-card-sub">
          {sorted.length.toLocaleString()} bouts in 1v{opponents}. Sort by any column.
          {onOpenBout ? ' Select a row to open that bout in the replay tab.' : ''}
        </p>
      </header>
      <div className="dash-table-tools">
        <label className="dash-field">
          <span>Filter</span>
          <input
            type="search" value={query} placeholder="index, winner or method"
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
          />
        </label>
        <div className="dash-pager">
          <button type="button" onClick={() => setPage(0)} disabled={safePage === 0} aria-label="First page">&laquo;</button>
          <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0} aria-label="Previous page">&lsaquo;</button>
          <span className="dash-pager-label">
            {sorted.length === 0 ? '0' : `${safePage * PAGE_SIZE + 1}–${Math.min(sorted.length, (safePage + 1) * PAGE_SIZE)}`}
            {' of '}{sorted.length.toLocaleString()}
          </span>
          <button type="button" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={safePage >= pageCount - 1} aria-label="Next page">&rsaquo;</button>
          <button type="button" onClick={() => setPage(pageCount - 1)} disabled={safePage >= pageCount - 1} aria-label="Last page">&raquo;</button>
        </div>
      </div>
      <div className="dash-table-scroll">
        <table className="dash-table">
          <caption className="dash-visually-hidden">
            All simulated bouts for format 1v{opponents}, sortable and paginated.
          </caption>
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                const active = sort.key === c.key;
                return (
                  <th
                    key={c.key} scope="col" title={c.title}
                    className={`${c.numeric ? 'num' : ''}${active ? ' is-sorted' : ''}`}
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <button type="button" onClick={() => toggle(c.key)}>
                      {c.label}
                      <span className="dash-sort" aria-hidden="true">
                        {active ? (sort.dir === 'asc' ? '▲' : '▼') : '·'}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => (
              <tr
                key={r.index}
                className={onOpenBout ? 'is-clickable' : undefined}
                tabIndex={onOpenBout ? 0 : undefined}
                onClick={onOpenBout ? () => onOpenBout(opponents, r.index) : undefined}
                onKeyDown={onOpenBout ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenBout(opponents, r.index); }
                } : undefined}
              >
                <th scope="row" className="num">{r.index}</th>
                <td>
                  <span
                    className="dash-key dash-key-swatch"
                    style={{ background: r.winner === 'A' ? SERIES[0] : r.winner === 'B' ? SERIES[1] : 'var(--dash-muted)' }}
                    aria-hidden="true"
                  />
                  {r.winner}
                </td>
                <td className="dash-method">{r.method}</td>
                <td className="num">{r.round}</td>
                <td className="num">{fmtClock(r.time)}</td>
                <td className="num">{r.sig}</td>
                <td className="num">{fmtPct(r.acc, 0)}</td>
                <td className="num">{r.td}</td>
                <td className="num">{r.sub}</td>
              </tr>
            ))}
            {slice.length === 0 ? (
              <tr><td colSpan={COLUMNS.length} className="dash-empty">No bouts match that filter.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ================================================================== */
/* the dashboard                                                       */
/* ================================================================== */

const MC_NOTE = 'Monte Carlo sampling error over the model’s own output — not real-world uncertainty.';

export function Dashboard(props: {
  replays: Record<number, ReplayFile[]>;
  onOpenBout?: (opponents: number, index: number) => void;
}) {
  const { replays, onOpenBout } = props;

  const formats = useMemo(
    () => Object.keys(replays)
      .map(Number)
      .filter((k) => Number.isFinite(k) && (replays[k]?.length ?? 0) > 0)
      .sort((a, b) => a - b),
    [replays],
  );

  const [selected, setSelected] = useState<number | null>(null);
  const active = selected !== null && formats.includes(selected) ? selected : (formats[0] ?? 1);

  /** Cheap cross-format summary: only the winner field is touched. */
  const perFormatWin = useMemo<IntervalRow[]>(
    () => formats.map((f) => {
      const list = replays[f] ?? [];
      let k = 0;
      for (const r of list) if (r.analytics.winner === 'A') k++;
      const w = wilson(k, list.length);
      return {
        id: String(f), label: `1v${f}`, p: w.p, lo: w.lo, hi: w.hi,
        k, n: list.length, selected: f === active,
      };
    }),
    [formats, replays, active],
  );

  const agg = useMemo(
    () => aggregate(active, replays[active] ?? []),
    [active, replays],
  );

  const rows = useMemo<Row[]>(
    () => (replays[active] ?? []).map((r) => {
      const a = r.analytics;
      const fa = a.perFighter.find((f) => f.team === 'A');
      return {
        index: a.index,
        winner: a.winner === 'draw' ? 'draw' : a.winner,
        method: a.method,
        round: a.round,
        time: a.totalSeconds,
        sig: a.significantActions,
        acc: fa ? fa.accuracy : 0,
        td: `${a.takedownsLanded}/${a.takedownsAttempted}`,
        tdRatio: a.takedownsAttempted ? a.takedownsLanded / a.takedownsAttempted : -1,
        sub: a.submissionAttempts,
      };
    }),
    [active, replays],
  );

  if (formats.length === 0) {
    return (
      <div className="dash-root">
        <p className="dash-empty-state">
          No replays supplied yet. Once bouts are generated they will be aggregated here.
        </p>
      </div>
    );
  }

  const s = agg.strikes;
  const strikeParts = [
    { label: 'landed', value: s.landed, color: SERIES[0] },
    { label: 'missed', value: s.missed, color: SERIES[1] },
    { label: 'blocked', value: s.blocked, color: SERIES[2] },
    { label: 'evaded', value: s.evaded, color: SERIES[3] },
  ];
  const postureParts = [
    { label: 'standing', value: agg.posture.standing, color: SERIES[0] },
    { label: 'clinch', value: agg.posture.clinch, color: SERIES[1] },
    { label: 'ground', value: agg.posture.ground, color: SERIES[2] },
    { label: 'down', value: agg.posture.down, color: SERIES[3] },
  ];

  const staminaSeries: TrajectorySeries[] = [
    { key: 'a', label: 'A side', color: SERIES[0], mean: agg.staminaA.mean, lo: agg.staminaA.lo, hi: agg.staminaA.hi },
    { key: 'b', label: `B side${agg.opponents > 1 ? ' (mean of opponents)' : ''}`, color: SERIES[1], mean: agg.staminaB.mean, lo: agg.staminaB.lo, hi: agg.staminaB.hi },
  ];

  const staminaTable: TableView = {
    columns: ['Time', 'A mean', 'A IQR', 'B mean', 'B IQR', 'bouts (n)'],
    rows: sampleRowsEvery(agg.staminaA.length, 6).map((i) => [
      fmtClock(i * SAMPLE_SECONDS),
      fmtPct(agg.staminaA.mean[i] ?? 0, 0),
      `${fmtPct(agg.staminaA.lo[i] ?? 0, 0)}–${fmtPct(agg.staminaA.hi[i] ?? 0, 0)}`,
      fmtPct(agg.staminaB.mean[i] ?? 0, 0),
      `${fmtPct(agg.staminaB.lo[i] ?? 0, 0)}–${fmtPct(agg.staminaB.hi[i] ?? 0, 0)}`,
      agg.staminaA.counts[i] ?? 0,
    ]),
  };

  const scoreTable: TableView = {
    columns: ['Time', 'Mean margin (A − B)', 'IQR', 'bouts (n)'],
    rows: sampleRowsEvery(agg.score.length, 6).map((i) => [
      fmtClock(i * SAMPLE_SECONDS),
      `${(agg.score.mean[i] ?? 0) >= 0 ? '+' : ''}${fmtNum(agg.score.mean[i] ?? 0, 2)}`,
      `${fmtNum(agg.score.lo[i] ?? 0, 2)} … ${fmtNum(agg.score.hi[i] ?? 0, 2)}`,
      agg.score.counts[i] ?? 0,
    ]),
  };

  return (
    <div className="dash-root">
      <header className="dash-head">
        <div>
          <h2 className="dash-h2">Batch analytics</h2>
          <p className="dash-lede">
            Aggregated across {totalBouts(replays).toLocaleString()} simulated bouts in{' '}
            {formats.length} format{formats.length === 1 ? '' : 's'}.
          </p>
        </div>
        <p className="dash-disclaimer" role="note">
          <strong>Read every interval on this page as model noise.</strong> Wilson
          intervals, interquartile bands and standard errors here measure only how much
          a number would move if the simulator were re-run with different seeds. They
          are Monte Carlo sampling error over this toy model&rsquo;s own output. They are
          not real-world uncertainty, and they say nothing about real athletes: the
          model&rsquo;s assumptions sit outside every interval shown.
        </p>
      </header>

      <div className="dash-filterbar" role="group" aria-label="Format">
        <span className="dash-filter-label">Format</span>
        {formats.map((f) => (
          <button
            key={f} type="button"
            className={`dash-chip${f === active ? ' is-active' : ''}`}
            aria-pressed={f === active}
            onClick={() => setSelected(f)}
          >
            1v{f}
            <span className="dash-chip-n">{(replays[f]?.length ?? 0).toLocaleString()}</span>
          </button>
        ))}
      </div>

      <div className="dash-kpis">
        <StatTile
          hero
          label={`A-side win rate · 1v${agg.opponents}`}
          value={fmtPct(agg.winRate.p, 1)}
          sub={<>
            {agg.aWins.toLocaleString()} / {agg.bouts.toLocaleString()} bouts<br />
            95% Wilson {fmtPct(agg.winRate.lo, 1)}&ndash;{fmtPct(agg.winRate.hi, 1)}
          </>}
          accent={SERIES[0]}
        />
        <StatTile
          label="Median bout length"
          value={fmtClock(agg.durationAll.med)}
          sub={`IQR ${fmtClock(agg.durationAll.q1)}–${fmtClock(agg.durationAll.q3)}`}
        />
        <StatTile
          label="Mean significant actions"
          value={fmtNum(agg.meanSignificant.mean, 1)}
          sub={`95% ${fmtNum(agg.meanSignificant.lo, 1)}–${fmtNum(agg.meanSignificant.hi, 1)} · sd ${fmtNum(agg.meanSignificant.sd, 1)}`}
        />
        <StatTile
          label="Takedown success"
          value={fmtPct(agg.takedowns.p, 1)}
          sub={`${agg.takedowns.k.toLocaleString()} / ${agg.takedowns.n.toLocaleString()} attempts · 95% ${fmtPct(agg.takedowns.lo, 1)}–${fmtPct(agg.takedowns.hi, 1)}`}
        />
        <StatTile
          label="Submission attempts / bout"
          value={fmtNum(agg.subRate.mean, 2)}
          sub={`95% ${fmtNum(agg.subRate.lo, 2)}–${fmtNum(agg.subRate.hi, 2)} · ${fmtPct(agg.subBoutShare.p, 0)} of bouts see one`}
        />
        <StatTile
          label="A-side strike accuracy"
          value={fmtPct(agg.accuracyA.mean, 1)}
          sub={`95% ${fmtPct(agg.accuracyA.lo, 1)}–${fmtPct(agg.accuracyA.hi, 1)}`}
        />
      </div>

      <div className="dash-grid">
        <ChartCard
          wide
          title="A-side win rate by format"
          subtitle={<>Dot is the observed rate; the bar is the 95% Wilson score interval. {MC_NOTE}</>}
          note="Select a format to re-scope every other chart on this page."
          table={{
            columns: ['Format', 'A wins', 'Bouts', 'Win rate', '95% Wilson low', '95% Wilson high'],
            rows: perFormatWin.map((r) => [r.label, r.k, r.n, fmtPct(r.p, 2), fmtPct(r.lo, 2), fmtPct(r.hi, 2)]),
          }}
        >
          {(w) => (
            <IntervalDotPlot width={w} rows={perFormatWin} onPick={(id) => setSelected(Number(id))} />
          )}
        </ChartCard>

        <ChartCard
          title="Method of victory"
          subtitle={`How all ${agg.bouts.toLocaleString()} bouts in 1v${agg.opponents} ended.`}
          table={{
            columns: ['Method', 'Bouts', 'Share', 'Won by A'],
            rows: agg.methods.map((m) => [
              m.label, m.count, fmtPct(agg.bouts ? m.count / agg.bouts : 0, 1), fmtPct(m.aShare, 1),
            ]),
          }}
        >
          {(w) => (
            <BarRows
              width={w}
              rows={agg.methods.map((m) => ({ label: m.label, value: m.count }))}
              valueLabel={(v) => `${v.toLocaleString()} (${fmtPct(agg.bouts ? v / agg.bouts : 0, 0)})`}
            />
          )}
        </ChartCard>

        <ChartCard
          title="Round of finish"
          subtitle="Finishes by round, with bouts that reached the scorecards shown separately."
          table={{
            columns: ['Outcome', 'Bouts', 'Share'],
            rows: agg.roundBins.map((b) => [b.label, b.value, fmtPct(agg.bouts ? b.value / agg.bouts : 0, 1)]),
          }}
        >
          {(w) => (
            <ColumnBars width={w} bins={agg.roundBins} yLabel="bouts"
              valueLabel={(v) => `${v.toLocaleString()} bouts`} />
          )}
        </ChartCard>

        <ChartCard
          title="Time to finish"
          subtitle={<>Median and interquartile range over the {agg.finishTime.n.toLocaleString()} bouts that ended early. {MC_NOTE}</>}
          note={`Bouts that went the distance are excluded here; they are in the round-of-finish chart as "decision".`}
          table={{
            columns: ['Statistic', 'Value'],
            rows: [
              ['minimum', fmtClock(agg.finishTime.min)],
              ['first quartile', fmtClock(agg.finishTime.q1)],
              ['median', fmtClock(agg.finishTime.med)],
              ['third quartile', fmtClock(agg.finishTime.q3)],
              ['maximum', fmtClock(agg.finishTime.max)],
              ['finishes (n)', agg.finishTime.n],
            ],
          }}
        >
          {(w) => (
            <QuartileStrip
              width={w} fmt={fmtClock}
              min={agg.finishTime.min} q1={agg.finishTime.q1} med={agg.finishTime.med}
              q3={agg.finishTime.q3} max={agg.finishTime.max}
              domainMax={Math.max(agg.finishTime.max, agg.durationAll.max)}
            />
          )}
        </ChartCard>

        <ChartCard
          title="Bout length"
          subtitle="All bouts, including decisions. Total simulated time from the opening horn."
          table={{
            columns: ['Bin', 'Bouts'],
            rows: agg.durationHistogram.map((b) => [b.label, b.value]),
          }}
        >
          {(w) => (
            <ColumnBars
              width={w} bins={agg.durationHistogram} yLabel="bouts"
              labelEvery={agg.durationHistogram.length > 12 ? 2 : 1}
              valueLabel={(v) => `${v.toLocaleString()} bouts`}
            />
          )}
        </ChartCard>

        <ChartCard
          title="Strike outcome split"
          subtitle={`${s.total.toLocaleString()} significant actions across the format.`}
          legend={strikeParts.map((p) => ({ label: p.label, color: p.color }))}
          table={{
            columns: ['Outcome', 'Actions', 'Share', 'Per bout'],
            rows: strikeParts.map((p) => [
              p.label, p.value.toLocaleString(),
              fmtPct(s.total ? p.value / s.total : 0, 1),
              fmtNum(agg.bouts ? p.value / agg.bouts : 0, 1),
            ]),
          }}
        >
          {(w) => <StackedShare width={w} parts={strikeParts} total={s.total}
            unit={(v) => v.toLocaleString()} />}
        </ChartCard>

        <ChartCard
          title="Posture-time split"
          subtitle="Where the A-side fighter spent the bout, summed over every bout in this format."
          legend={postureParts.map((p) => ({ label: p.label, color: p.color }))}
          table={{
            columns: ['Posture', 'Seconds', 'Share', 'Seconds per bout'],
            rows: postureParts.map((p) => [
              p.label, Math.round(p.value).toLocaleString(),
              fmtPct(agg.posture.total ? p.value / agg.posture.total : 0, 1),
              fmtNum(agg.bouts ? p.value / agg.bouts : 0, 1),
            ]),
          }}
        >
          {(w) => <StackedShare width={w} parts={postureParts} total={agg.posture.total}
            unit={(v) => `${Math.round(v).toLocaleString()}s`} />}
        </ChartCard>

        <ChartCard
          title="Grappling rates"
          subtitle={<>Proportions with 95% Wilson intervals; rates with 95% standard-error intervals. {MC_NOTE}</>}
          table={{
            columns: ['Measure', 'Value', '95% interval', 'Denominator'],
            rows: [
              ['takedown success', fmtPct(agg.takedowns.p, 2), `${fmtPct(agg.takedowns.lo, 2)}–${fmtPct(agg.takedowns.hi, 2)}`, `${agg.takedowns.n.toLocaleString()} attempts`],
              ['bouts with a submission attempt', fmtPct(agg.subBoutShare.p, 2), `${fmtPct(agg.subBoutShare.lo, 2)}–${fmtPct(agg.subBoutShare.hi, 2)}`, `${agg.bouts.toLocaleString()} bouts`],
              ['submission attempts per bout', fmtNum(agg.subRate.mean, 3), `${fmtNum(agg.subRate.lo, 3)}–${fmtNum(agg.subRate.hi, 3)}`, `${agg.bouts.toLocaleString()} bouts`],
              ['takedown attempts per bout', fmtNum(agg.meanTakedownAttempts, 3), '—', `${agg.bouts.toLocaleString()} bouts`],
              ['knockdowns per bout', fmtNum(agg.knockdownRate.mean, 3), `${fmtNum(agg.knockdownRate.lo, 3)}–${fmtNum(agg.knockdownRate.hi, 3)}`, `${agg.bouts.toLocaleString()} bouts`],
            ],
          }}
        >
          {(w) => (
            <div className="dash-meters">
              <div className="dash-meter">
                <p className="dash-meter-label">
                  Takedown success
                  <b>{fmtPct(agg.takedowns.p, 1)}</b>
                </p>
                <IntervalMeter width={w} p={agg.takedowns.p} lo={agg.takedowns.lo} hi={agg.takedowns.hi} />
                <p className="dash-meter-sub">
                  {agg.takedowns.k.toLocaleString()} landed of {agg.takedowns.n.toLocaleString()} attempts
                  {' · '}95% {fmtPct(agg.takedowns.lo, 1)}&ndash;{fmtPct(agg.takedowns.hi, 1)}
                </p>
              </div>
              <div className="dash-meter">
                <p className="dash-meter-label">
                  Bouts with a submission attempt
                  <b>{fmtPct(agg.subBoutShare.p, 1)}</b>
                </p>
                <IntervalMeter width={w} p={agg.subBoutShare.p} lo={agg.subBoutShare.lo} hi={agg.subBoutShare.hi} />
                <p className="dash-meter-sub">
                  {agg.subBoutShare.k.toLocaleString()} of {agg.bouts.toLocaleString()} bouts
                  {' · '}{fmtNum(agg.subRate.mean, 2)} attempts per bout
                  {' (95% '}{fmtNum(agg.subRate.lo, 2)}&ndash;{fmtNum(agg.subRate.hi, 2)})
                </p>
              </div>
            </div>
          )}
        </ChartCard>

        <ChartCard
          wide
          title="Mean stamina trajectory"
          subtitle={<>Mean fraction of maximum stamina, sampled every {SAMPLE_SECONDS}s. Shaded band is the interquartile range across bouts. {MC_NOTE}</>}
          legend={[
            { label: 'A side (mean)', color: SERIES[0], shape: 'line' },
            { label: `B side (mean)`, color: SERIES[1], shape: 'line' },
            { label: 'interquartile range', color: 'var(--dash-band-key)', shape: 'band' },
          ]}
          note={<>
            Bouts end at different times, so the sample sizes are ragged: each point uses
            only the bouts that were still running at that moment, with no padding or
            carry-forward. The <b>n</b> strip under the plot is that count; past the marked
            line fewer than half the bouts remain and the line is drawn faded, because the
            surviving bouts are a biased sub-sample (long fights).
          </>}
          table={staminaTable}
        >
          {(w) => (
            <TrajectoryChart
              width={w} series={staminaSeries}
              counts={agg.staminaA.counts} totalBouts={agg.bouts}
              sampleSeconds={SAMPLE_SECONDS}
              yDomain={[0, 1.02]} yFormat={(v) => fmtPct(v, 0)}
              height={280}
            />
          )}
        </ChartCard>

        <ChartCard
          wide
          title="Mean score margin (A − B)"
          subtitle={<>Cumulative scoring margin at each sample point. Above the line is A ahead, below is the B side ahead. Grey band is the interquartile range. {MC_NOTE}</>}
          note="Same ragged-sample rule as the stamina chart: each point averages only the bouts still running then."
          legend={[
            { label: 'A side ahead', color: 'var(--dash-pos)', shape: 'swatch' },
            { label: 'B side ahead', color: 'var(--dash-neg)', shape: 'swatch' },
            { label: 'interquartile range', color: 'var(--dash-band-key)', shape: 'band' },
          ]}
          table={scoreTable}
        >
          {(w) => (
            <DivergingTrajectory
              width={w} mean={agg.score.mean} lo={agg.score.lo} hi={agg.score.hi}
              counts={agg.score.counts} totalBouts={agg.bouts} sampleSeconds={SAMPLE_SECONDS}
              height={250}
            />
          )}
        </ChartCard>
      </div>

      <BoutTable rows={rows} opponents={agg.opponents} onOpenBout={onOpenBout} />

      <p className="dash-footnote">
        Every number here is produced by a toy simulation. Each probability in the
        engine is an assumption someone chose, not a measurement. Nothing on this page
        is a validated prediction about real people or real fights.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function totalBouts(replays: Record<number, ReplayFile[]>): number {
  let n = 0;
  for (const k of Object.keys(replays)) n += replays[Number(k)]?.length ?? 0;
  return n;
}

/** Indices for a readable table view of a long trajectory (~`rows` entries). */
function sampleRowsEvery(length: number, rows: number): number[] {
  if (length <= 0) return [];
  const step = Math.max(1, Math.floor(length / Math.max(1, rows)));
  const out: number[] = [];
  for (let i = 0; i < length; i += step) out.push(i);
  if (out[out.length - 1] !== length - 1) out.push(length - 1);
  return out;
}

export default Dashboard;
