/**
 * BATCH SIMULATION — many seeded bouts of one matchup, read as a distribution.
 *
 * Pick two fighters, the ruleset and arena, a bout count and a master seed.
 * The batch runs on a pool of Web Workers (cores minus two, at most four;
 * `run/batchRun.ts`), streams progress with a steady ETA, can be cancelled at
 * any time, and reports win probability, method mix, round of finish and
 * per-fighter averages, each with a 95 % interval.
 *
 * Bout i always has the seed `boutSeed(master, 'batch', i)`, and every number
 * here is computed from index-sorted summaries, so the same master seed gives
 * the same results on any machine and with any number of workers. The
 * fingerprint under the results is a hash of every bout's digest in order:
 * two runs that agree on it ran the same fights.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ARENAS, DEFAULT_SETTINGS, type ArenaId, type MatchSettings, type RulesetId } from '../../sim';
import type { FighterRecord } from '../store/types';
import type { FighterStoreApi } from '../storeApi';
import {
  ARENA_IDS, DAMAGE_REALISM, REFEREE_STRICTNESS, RULESET_IDS, RULESET_LABELS, newSeed, pairingWarning,
} from '../model/matchModel';
import {
  BATCH_MAX, BATCH_SIZES, EtaEstimator, MAX_WORKERS, aggregate, formatDuration,
  type BatchAggregate, type BoutSummary, type Interval, type MethodClass,
} from '../model/batchModel';
import { defaultWorkerCount, runBatch, type BatchHandle, type BatchOutcome } from '../run/batchRun';
import { topDisciplineLabel } from '../model/fieldMeta';
import {
  Alert, Button, EmptyState, ErrorState, Field, InfoTip, Progress, Segmented, Select, StatusBadge,
  IconBatch, IconDice, IconDownload, IconPlay, IconStop, IconUsers,
} from '../ui';

export interface BatchSimProps {
  store: FighterStoreApi;
  revision: number;
}

const METHOD_LABEL: Readonly<Record<MethodClass, string>> = {
  ko: 'KO / TKO', sub: 'Submission', dec: 'Decision', other: 'DQ / other', draw: 'Draw / NC',
};
const METHOD_ORDER: readonly MethodClass[] = ['ko', 'sub', 'dec', 'other', 'draw'];
/** The ways a fighter can win (a draw is nobody's). */
const WIN_METHODS: readonly MethodClass[] = ['ko', 'sub', 'dec', 'other'];
const METHOD_COLOR: Readonly<Record<MethodClass, string>> = {
  ko: 'var(--chart-1)', sub: 'var(--chart-2)', dec: 'var(--chart-3)', other: 'var(--muted)', draw: 'var(--chart-4)',
};

/**
 * What a batch was run with, captured when it starts. Results render from this
 * snapshot, never from the live form, so changing a corner or the seed after a
 * run cannot relabel numbers that belong to a different matchup.
 */
export interface BatchRunInfo {
  names: [string, string];
  master: string;
}

export type BatchPhase =
  | { kind: 'idle' }
  | { kind: 'running'; run: BatchRunInfo; done: number; errors: number; total: number; eta: number | null; rate: number; startedAt: number }
  | { kind: 'finished'; run: BatchRunInfo; outcome: BatchOutcome; agg: BatchAggregate }
  | { kind: 'failed'; message: string };
type Phase = BatchPhase;

/** The corner names the results panel shows: the run's own, else the form's. */
export function batchResultNames(phase: BatchPhase, current: [string, string]): [string, string] {
  return phase.kind === 'running' || phase.kind === 'finished' ? phase.run.names : current;
}

/** The CSV file name for a finished batch, from the seed it actually ran with. */
export function batchCsvFileName(run: BatchRunInfo): string {
  return `boutlab-batch-${run.master.replace(/[^a-z0-9]+/gi, '_')}.csv`;
}

const pct = (v: number, dp = 1): string => `${(v * 100).toFixed(dp)}%`;
const ci = (i: Interval, f: (v: number) => string): string => `${f(i.lo)} – ${f(i.hi)}`;

export function BatchSim({ store, revision }: BatchSimProps): JSX.Element {
  const records = useMemo<FighterRecord[]>(() => {
    try {
      return [...store.list()].sort((x, y) => x.summary.name.localeCompare(y.summary.name));
    } catch {
      return [];
    }
  }, [store, revision]);

  const [aId, setAId] = useState<string>('');
  const [bId, setBId] = useState<string>('');
  const [ruleset, setRuleset] = useState<RulesetId>('mma.unified.3r');
  const [arena, setArena] = useState<ArenaId>('octagon_30');
  const [realism, setRealism] = useState<MatchSettings['damageRealism']>('realism');
  const [strictness, setStrictness] = useState<MatchSettings['refereeStrictness']>('standard');
  const [size, setSize] = useState<string>('100');
  const [custom, setCustom] = useState<number>(2500);
  const [master, setMaster] = useState<string>(() => newSeed('batch', Date.now()));
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [live, setLive] = useState<BatchAggregate | null>(null);
  const handle = useRef<BatchHandle | null>(null);
  const autoWorkers = useMemo(() => defaultWorkerCount(), []);
  // "Auto" is cores minus two, at most four. Fewer workers leave more of the
  // machine free (useful when something else is running); the results are
  // identical for any choice.
  const [workerChoice, setWorkerChoice] = useState<string>('auto');
  const workers = workerChoice === 'auto' ? autoWorkers : Math.max(1, Math.min(MAX_WORKERS, Number(workerChoice)));
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;

  // Sensible defaults once the database is readable: the first two fighters.
  useEffect(() => {
    if (records.length >= 2 && aId === '' && bId === '') {
      const pref = (id: string): string | undefined => records.find((r) => r.definition.id === id)?.definition.id;
      setAId(pref('arch.regional_pro_allrounder') ?? records[0].definition.id);
      setBId(pref('arch.thai_striker') ?? records[1].definition.id);
    }
  }, [records, aId, bId]);

  // A running batch must not outlive the screen.
  useEffect(() => () => handle.current?.cancel(), []);

  const bouts = size === 'custom' ? Math.max(1, Math.min(BATCH_MAX, Math.round(custom || 0))) : Number(size);
  const a = records.find((r) => r.definition.id === aId);
  const b = records.find((r) => r.definition.id === bId);
  const running = phase.kind === 'running';
  const warning = pairingWarning(ruleset, arena);

  const problems: string[] = [];
  if (!a || !b) problems.push('Choose two fighters.');
  if (a && b && a.definition.id === b.definition.id) problems.push('Pick two different fighters (duplicate one in the database for a mirror match).');
  if (master.trim() === '') problems.push('The master seed cannot be empty; it defines every bout in the batch.');

  const start = useCallback(() => {
    if (!a || !b || problems.length > 0) return;
    const bDef = { ...b.definition };
    const template = {
      mode: '1v1' as const,
      fighters: [a.definition, bDef],
      teams: { teamOf: [0, 1] },
      ruleset,
      arena,
      settings: { ...DEFAULT_SETTINGS, damageRealism: realism, refereeStrictness: strictness, commentary: false },
    };
    const eta = new EtaEstimator();
    const startedAt = performance.now();
    const collected: BoutSummary[] = [];
    let lastPaint = 0;
    const run: BatchRunInfo = { names: [a.summary.name, b.summary.name], master: master.trim() };
    setLive(null);
    setPhase({ kind: 'running', run, done: 0, errors: 0, total: bouts, eta: null, rate: 0, startedAt });
    const h = runBatch({ template, master: master.trim(), bouts }, {
      workers,
      onSummary: (s) => collected.push(s),
      onProgress: (p) => {
        const t = performance.now();
        const e = eta.update(t, p.done + p.errors, p.total);
        // Paint at most ~6 times a second: thousands of results must not
        // turn into thousands of renders.
        if (t - lastPaint < 160 && p.done + p.errors < p.total) return;
        lastPaint = t;
        setPhase({ kind: 'running', run, done: p.done, errors: p.errors, total: p.total, eta: e, rate: eta.rate(t, p.done), startedAt });
        if (collected.length >= 5) setLive(aggregate(collected));
      },
    });
    handle.current = h;
    h.promise.then(
      (outcome) => {
        handle.current = null;
        setLive(null);
        setPhase({ kind: 'finished', run, outcome, agg: aggregate(outcome.summaries) });
      },
      (err: unknown) => {
        handle.current = null;
        setPhase({ kind: 'failed', message: err instanceof Error ? err.message : String(err) });
      },
    );
  }, [a, b, arena, bouts, master, problems.length, realism, ruleset, strictness, workers]);

  const cancel = useCallback(() => handle.current?.cancel(), []);

  const exportCsv = useCallback(() => {
    if (phase.kind !== 'finished') return;
    const head = 'index,winner,method,round,total_seconds,a_sig_landed,a_sig_attempted,a_kd,a_td_landed,a_td_attempted,a_sub_attempts,a_control_s,b_sig_landed,b_sig_attempted,b_kd,b_td_landed,b_td_attempted,b_sub_attempts,b_control_s,digest';
    const rows = phase.outcome.summaries.map((s) => [
      s.index, s.winner, s.method, s.round, s.totalSeconds.toFixed(1),
      ...s.f.flatMap((f) => [f.sigL, f.sigA, f.kd, f.tdL, f.tdA, f.sub, f.ctrl.toFixed(1)]), s.digest,
    ].join(','));
    const url = URL.createObjectURL(new Blob([`${head}\n${rows.join('\n')}\n`], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = batchCsvFileName(phase.run);
    link.click();
    URL.revokeObjectURL(url);
  }, [phase]);

  const shown: BatchAggregate | null = phase.kind === 'finished' ? phase.agg : live;
  const names = batchResultNames(phase, [a?.summary.name ?? 'Fighter A', b?.summary.name ?? 'Fighter B']);

  return (
    <div className="batch">
      <header className="page-head">
        <div>
          <h1 className="page-title">Batch simulation</h1>
          <p className="page-sub">
            Run the same matchup hundreds or thousands of times, each bout on its own deterministic
            seed, and read the result as a distribution with confidence intervals rather than one
            fight&rsquo;s story.
          </p>
        </div>
      </header>

      <div className="batch-layout">
        <section className="ui-card batch-setup" aria-labelledby="batch-setup-h">
          <div className="ui-card-head"><h2 className="ui-card-title" id="batch-setup-h">Setup</h2></div>
          <div className="ui-card-body batch-form">
            {records.length < 2 ? (
              <EmptyState compact icon={<IconUsers />} title="Not enough fighters">
                A batch needs at least two fighters in the database.
              </EmptyState>
            ) : (
              <>
                <div className="batch-corners">
                  <FighterPick corner="a" label="Red corner" value={aId} onChange={setAId} records={records} disabled={running} />
                  <Button
                    size="sm" variant="ghost" className="batch-swap" disabled={running}
                    aria-label="Swap corners" title="Swap corners"
                    onClick={() => { setAId(bId); setBId(aId); }}
                  >
                    ⇄
                  </Button>
                  <FighterPick corner="b" label="Blue corner" value={bId} onChange={setBId} records={records} disabled={running} />
                </div>

                <div className="batch-grid">
                  <Select<RulesetId>
                    label="Ruleset" value={ruleset} disabled={running} onChange={setRuleset}
                    options={RULESET_IDS.map((id) => ({ value: id, label: RULESET_LABELS[id] ?? id }))}
                  />
                  <Select<ArenaId>
                    label="Arena" value={arena} disabled={running} onChange={setArena}
                    hint={warning ?? undefined}
                    options={ARENA_IDS.map((id) => ({ value: id, label: ARENAS[id].name }))}
                  />
                  <Select<MatchSettings['damageRealism']>
                    label="Damage realism" value={realism} disabled={running} onChange={setRealism}
                    options={DAMAGE_REALISM.map((r) => ({ value: r.id, label: r.label }))}
                  />
                  <Select<MatchSettings['refereeStrictness']>
                    label="Referee" value={strictness} disabled={running} onChange={setStrictness}
                    options={REFEREE_STRICTNESS.map((r) => ({ value: r.id, label: r.label }))}
                  />
                  <Select<string>
                    label="Workers" value={workerChoice} disabled={running} onChange={setWorkerChoice}
                    options={[
                      { value: 'auto', label: `Auto (${autoWorkers})` },
                      ...Array.from({ length: MAX_WORKERS }, (_, i) => ({ value: String(i + 1), label: `${i + 1}` })),
                    ]}
                  />
                </div>

                <div className="ui-field">
                  <span className="ui-field-label" id="batch-size-l">Number of bouts</span>
                  <div className="batch-size">
                    <Segmented<string>
                      label="Number of bouts"
                      value={size}
                      onChange={(v) => { if (!running) setSize(v); }}
                      options={[
                        ...BATCH_SIZES.map((n) => ({ value: String(n), label: n.toLocaleString() })),
                        { value: 'custom', label: 'Custom' },
                      ]}
                    />
                    {size === 'custom' ? (
                      <input
                        className="field batch-custom"
                        type="number"
                        min={1}
                        max={BATCH_MAX}
                        step={100}
                        value={custom}
                        disabled={running}
                        aria-label={`Custom number of bouts, up to ${BATCH_MAX.toLocaleString()}`}
                        onChange={(e) => setCustom(Number(e.target.value))}
                      />
                    ) : null}
                  </div>
                  <p className="ui-field-hint">
                    {bouts.toLocaleString()} bouts on {workers} worker{workers === 1 ? '' : 's'}
                    {cores ? ` (${cores} logical cores)` : ''}. Results are identical for any worker count.
                  </p>
                </div>

                <Field
                  label={<>Master seed <InfoTip text="Bout i of the batch uses the seed master::batch::bout-i. The same master seed reproduces every bout exactly, on any machine and with any number of workers." /></>}
                  error={master.trim() === '' ? 'The master seed cannot be empty.' : null}
                >
                  {(p) => (
                    <div className="batch-seed">
                      <input
                        id={p.id} className="field mono" type="text" value={master} disabled={running}
                        aria-invalid={p.invalid || undefined} aria-describedby={p.describedBy}
                        spellCheck={false}
                        onChange={(e) => setMaster(e.target.value)}
                      />
                      <Button size="sm" icon={<IconDice />} disabled={running} onClick={() => setMaster(newSeed('batch', Date.now()))}>
                        New
                      </Button>
                    </div>
                  )}
                </Field>

                {problems.length > 0 && !(problems.length === 1 && master.trim() === '') ? (
                  <Alert tone="warn">{problems.filter((p) => !p.startsWith('The master seed')).join(' ')}</Alert>
                ) : null}

                <div className="batch-actions">
                  {running ? (
                    <Button variant="danger" icon={<IconStop />} onClick={cancel}>Cancel batch</Button>
                  ) : (
                    <Button variant="primary" size="lg" icon={<IconPlay />} disabled={problems.length > 0} onClick={start}>
                      Run {bouts.toLocaleString()} bouts
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </section>

        <div className="batch-results">
          {phase.kind === 'running' ? (
            <section className="ui-card ui-card--pad batch-progress" aria-labelledby="batch-prog-h">
              <div className="batch-progress-head">
                <h2 className="ui-card-title" id="batch-prog-h">Running</h2>
                <StatusBadge tone="accent" dot>{workers} worker{workers === 1 ? '' : 's'}</StatusBadge>
              </div>
              <Progress
                value={(phase.done + phase.errors) / Math.max(1, phase.total)}
                label="Batch progress"
                indeterminate={phase.done === 0}
              />
              <dl className="batch-progress-stats" aria-live="polite">
                <div><dt>Completed</dt><dd className="mono">{phase.done.toLocaleString()} / {phase.total.toLocaleString()}</dd></div>
                <div><dt>Rate</dt><dd className="mono">{phase.rate > 0 ? `${phase.rate.toFixed(1)} bouts/s` : '—'}</dd></div>
                <div><dt>Elapsed</dt><dd className="mono">{formatDuration((performance.now() - phase.startedAt) / 1000)}</dd></div>
                <div><dt>Remaining</dt><dd className="mono">{phase.eta === null ? 'estimating…' : `≈ ${formatDuration(phase.eta)}`}</dd></div>
                {phase.errors > 0 ? <div><dt>Errors</dt><dd className="mono" style={{ color: 'var(--alert)' }}>{phase.errors}</dd></div> : null}
              </dl>
            </section>
          ) : null}

          {phase.kind === 'failed' ? (
            <ErrorState title="The batch could not run" detail={phase.message}
              actions={<Button onClick={() => setPhase({ kind: 'idle' })}>Dismiss</Button>}>
              Nothing was saved. Check the fighters are still valid, then try again.
            </ErrorState>
          ) : null}

          {phase.kind === 'finished' ? (
            <>
              {phase.outcome.cancelled ? (
                <Alert tone="warn">
                  Cancelled after {phase.outcome.summaries.length.toLocaleString()} bouts. The results below
                  cover only the bouts that finished, which are the lowest-numbered seeds; they are still
                  reproducible, but the intervals are wider.
                </Alert>
              ) : (
                <Alert tone="ok">
                  {phase.outcome.summaries.length.toLocaleString()} bouts in{' '}
                  {formatDuration(phase.outcome.wallMs / 1000)}
                  {phase.outcome.ranOn === 'workers' ? ` on ${phase.outcome.workers} workers.` : '.'}
                </Alert>
              )}
              {phase.outcome.fallbackReason ? <Alert tone="warn">{phase.outcome.fallbackReason}</Alert> : null}
              {phase.outcome.errors.length > 0 ? (
                <Alert tone="alert">
                  {phase.outcome.errors.length} bout{phase.outcome.errors.length === 1 ? '' : 's'} failed and
                  {phase.outcome.errors.length === 1 ? ' is' : ' are'} excluded. First: bout {phase.outcome.errors[0].index}
                  {' '}— {phase.outcome.errors[0].message}
                </Alert>
              ) : null}
            </>
          ) : null}

          {shown && shown.n > 0 ? (
            <Results agg={shown} names={names} provisional={phase.kind === 'running'}
              onExport={phase.kind === 'finished' ? exportCsv : undefined} />
          ) : phase.kind === 'idle' ? (
            <EmptyState icon={<IconBatch />} title="No results yet">
              Choose a matchup and a number of bouts, then run the batch. A hundred bouts take a few
              seconds; five thousand take several minutes and can be cancelled at any time.
            </EmptyState>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------

function FighterPick({
  corner, label, value, onChange, records, disabled,
}: {
  corner: 'a' | 'b';
  label: string;
  value: string;
  onChange: (id: string) => void;
  records: readonly FighterRecord[];
  disabled: boolean;
}): JSX.Element {
  const r = records.find((x) => x.definition.id === value);
  return (
    <div className="batch-pick" data-corner={corner}>
      <Select<string>
        label={label}
        value={value}
        disabled={disabled}
        onChange={onChange}
        options={[
          { value: '', label: 'Choose a fighter…', disabled: true },
          ...records.map((x) => ({ value: x.definition.id, label: `${x.summary.name} · T${x.summary.overallTier}` })),
        ]}
      />
      {r ? (
        <p className="batch-pick-meta">
          {r.summary.recordLine} · {r.summary.weightClass} · {r.summary.stance} · {topDisciplineLabel(r.summary.topDiscipline)}
        </p>
      ) : null}
    </div>
  );
}

function Results({
  agg, names, provisional, onExport,
}: { agg: BatchAggregate; names: [string, string]; provisional: boolean; onExport?: () => void }): JSX.Element {
  const [a, b] = agg.fighters;
  const rows: { label: string; hint: string; get: (f: typeof a) => Interval; fmt: (v: number) => string }[] = [
    { label: 'Sig. strikes landed / min', hint: 'Mean per bout', get: (f) => f.sigLandedPerMin, fmt: (v) => v.toFixed(2) },
    { label: 'Sig. strike accuracy', hint: 'Pooled; Wilson interval', get: (f) => f.sigAccuracy, fmt: (v) => pct(v) },
    { label: 'Knockdowns scored', hint: 'Mean per bout', get: (f) => f.knockdowns, fmt: (v) => v.toFixed(2) },
    { label: 'Takedowns landed / 15 min', hint: 'Mean per bout', get: (f) => f.takedownsPer15, fmt: (v) => v.toFixed(2) },
    { label: 'Takedown accuracy', hint: 'Pooled; Wilson interval', get: (f) => f.tdAccuracy, fmt: (v) => pct(v) },
    { label: 'Submission attempts', hint: 'Mean per bout', get: (f) => f.subAttempts, fmt: (v) => v.toFixed(2) },
    { label: 'Control time (min)', hint: 'Mean per bout', get: (f) => f.controlMinutes, fmt: (v) => v.toFixed(2) },
  ];
  const maxRound = Math.max(1, ...agg.finishRounds);
  const totalFinishes = agg.finishRounds.reduce((s, x) => s + x, 0);

  return (
    <div className="batch-out" aria-busy={provisional || undefined}>
      <div className="batch-out-head">
        <h2 className="section-title">
          Results {provisional ? <StatusBadge tone="info">provisional · {agg.n.toLocaleString()} bouts so far</StatusBadge> : null}
        </h2>
        {onExport ? <Button size="sm" icon={<IconDownload />} onClick={onExport}>Export CSV</Button> : null}
      </div>

      <div className="ui-kpis">
        <Kpi label={`${names[0]} wins`} tone="a" value={pct(a.wins.value)} sub={`95% CI ${ci(a.wins, (v) => pct(v))}`} />
        <Kpi label={`${names[1]} wins`} tone="b" value={pct(b.wins.value)} sub={`95% CI ${ci(b.wins, (v) => pct(v))}`} />
        <Kpi label="Draws / no contest" value={pct(agg.draws.value)} sub={`95% CI ${ci(agg.draws, (v) => pct(v))}`} />
        <Kpi label="Finish rate" value={pct(agg.finishRate.value)} sub={`95% CI ${ci(agg.finishRate, (v) => pct(v))}`} />
        <Kpi label="Mean bout length" value={`${agg.duration.value.toFixed(1)} min`} sub={`95% CI ${ci(agg.duration, (v) => v.toFixed(1))}`} />
      </div>

      <div className="batch-charts">
        <section className="ui-card ui-card--pad" aria-labelledby="bc-methods">
          <h3 className="ui-card-title" id="bc-methods">How the bouts ended</h3>
          <p className="batch-chart-sub">Share of all bouts, by winner and method.</p>
          <ul className="batch-legend" aria-label="Legend">
            {METHOD_ORDER.map((m) => (
              <li key={m}><i style={{ background: METHOD_COLOR[m] }} aria-hidden="true" />{METHOD_LABEL[m]}</li>
            ))}
          </ul>
          {[0, 1].map((i) => {
            const f = agg.fighters[i];
            return (
              <div className="batch-stack-row" key={i}>
                <span className="batch-stack-name" data-corner={i === 0 ? 'a' : 'b'}>{names[i]}</span>
                <div className="batch-stack" role="img" aria-label={`${names[i]}: ${WIN_METHODS.map((m) => `${METHOD_LABEL[m]} ${pct(f.methods[m] / agg.n)}`).join(', ')}`}>
                  {WIN_METHODS.map((m) => {
                    const share = f.methods[m] / agg.n;
                    return share > 0 ? (
                      <span key={m} className="batch-seg" style={{ width: `${share * 100}%`, background: METHOD_COLOR[m] }}
                        title={`${names[i]} by ${METHOD_LABEL[m]}: ${f.methods[m].toLocaleString()} bouts (${pct(share)})`}>
                        {share >= 0.07 ? <b>{pct(share, 0)}</b> : null}
                      </span>
                    ) : null;
                  })}
                </div>
              </div>
            );
          })}
          <div className="batch-stack-row">
            <span className="batch-stack-name">Overall</span>
            <div className="batch-stack" role="img" aria-label={METHOD_ORDER.map((m) => `${METHOD_LABEL[m]} ${pct(agg.methodMix[m])}`).join(', ')}>
              {METHOD_ORDER.map((m) => (agg.methodMix[m] > 0 ? (
                <span key={m} className="batch-seg" style={{ width: `${agg.methodMix[m] * 100}%`, background: METHOD_COLOR[m] }}
                  title={`${METHOD_LABEL[m]}: ${pct(agg.methodMix[m])}`}>
                  {agg.methodMix[m] >= 0.07 ? <b>{pct(agg.methodMix[m], 0)}</b> : null}
                </span>
              ) : null))}
            </div>
          </div>
        </section>

        <section className="ui-card ui-card--pad" aria-labelledby="bc-rounds">
          <h3 className="ui-card-title" id="bc-rounds">Round of finish</h3>
          <p className="batch-chart-sub">
            {totalFinishes.toLocaleString()} finishes; {agg.decisions.toLocaleString()} bouts went to the scorecards.
          </p>
          {totalFinishes === 0 ? (
            <p className="batch-chart-empty">No finishes in this batch.</p>
          ) : (
            <div className="batch-bars" role="list">
              {agg.finishRounds.map((n, r) => (
                <div className="batch-bar" role="listitem" key={r} title={`Round ${r + 1}: ${n} finishes (${pct(n / totalFinishes)})`}>
                  <span className="batch-bar-val mono">{n.toLocaleString()}</span>
                  <span className="batch-bar-col"><i style={{ height: `${(n / maxRound) * 100}%` }} /></span>
                  <span className="batch-bar-label">R{r + 1}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="ui-card" aria-labelledby="bc-table">
        <div className="ui-card-head">
          <h3 className="ui-card-title" id="bc-table">Per-fighter averages</h3>
          <span className="batch-chart-sub" style={{ marginLeft: 'auto' }}>value (95% interval)</span>
        </div>
        <div className="table-wrap" style={{ border: 0, borderRadius: 0 }}>
          <table className="ui-table">
            <thead>
              <tr>
                <th scope="col">Statistic</th>
                <th scope="col" className="num"><span className="batch-dot" data-corner="a" />{names[0]}</th>
                <th scope="col" className="num"><span className="batch-dot" data-corner="b" />{names[1]}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row" style={{ fontWeight: 500 }}>{r.label} <span className="batch-row-hint">{r.hint}</span></th>
                  {[a, b].map((f, i) => {
                    const v = r.get(f);
                    return (
                      <td className="num" key={i}>
                        {r.fmt(v.value)} <span className="batch-ci">({r.fmt(v.lo)}–{r.fmt(v.hi)})</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="batch-foot">
        Fingerprint <code className="mono">{agg.fingerprint}</code> — a hash of all {agg.n.toLocaleString()} bout
        digests in seed order. The same master seed and matchup reproduce it exactly, with any number of workers.
      </p>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'a' | 'b' }): JSX.Element {
  return (
    <div className="ui-kpi" data-corner={tone}>
      <div className="ui-kpi-label">{label}</div>
      <div className="ui-kpi-value">{value}</div>
      <div className="ui-kpi-sub">{sub}</div>
    </div>
  );
}
