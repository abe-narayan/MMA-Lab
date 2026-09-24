/**
 * POST-FIGHT SCREEN — docs/design/09 §4.1 (stats) and §4.2 (scorecards).
 *
 * Two things, laid out the way a fan would look for them: what happened, then
 * the numbers behind it.
 *
 * The stat table is the UFCStats layout, because that is the one people can
 * read without a legend — significant strikes split by target and by position,
 * totals, takedowns, submission attempts, control time, knockdowns, reversals,
 * per round and for the bout. Every figure comes from `computeStats`, which is
 * a pure function of the event stream; nothing is recomputed here, so the
 * screen cannot disagree with the replay.
 *
 * The scorecards are shown per judge per round. When `judgingMode` is
 * `hidden` (the default, and what commissions do) the cards are still shown
 * *after* the bout — hiding them here would hide the only evidence for the
 * decision — with a note saying they were hidden during it.
 */

import { useMemo, useState } from 'react';
import type {
  BoutResult as BoutResultData, BoutRun, FighterRoundStats, LandedAttempted, RoundStats,
} from '../../sim';
import { RULESET_LABELS } from '../model/matchModel';
import type { RulesetId } from '../../sim';
import { EmptyState, IconResult } from '../ui';
import { clockText, methodText } from '../model/format';

export interface BoutResultProps {
  run: BoutRun | null;
  /** Hand the run to the replay view. Absent while the replay tab is not wired. */
  onWatch?: (run: BoutRun) => void;
  onExport?: (run: BoutRun) => void;
  onRematch?: (run: BoutRun) => void;
}

// --------------------------------------------------------------------------
// Formatting
// --------------------------------------------------------------------------

export function clockOf(seconds: number): string {
  return clockText(seconds);
}

export function methodLabel(method: string): string {
  return methodText(method);
}

/** "Red team", "Blue team", then "Team 3"… — the corner colours of 09 §3.2. */
export function teamName(team: number): string {
  if (team === 0) return 'Red team';
  if (team === 1) return 'Blue team';
  return `Team ${team + 1}`;
}

/**
 * Who won, in words. Team modes (teams, crowd, team scoring) return
 * `winner: 'none'` with `winningTeam` set — a team win, not a no contest —
 * so the team is named, with its members when the team layout is known.
 */
export function winnerLabel(
  result: Pick<BoutResultData, 'winner' | 'winningTeam' | 'method'>,
  names: readonly string[],
  teamOf?: readonly number[],
): string {
  if (result.winner === 'draw') return 'Draw';
  if (typeof result.winner === 'number') return names[result.winner] ?? `Fighter ${result.winner + 1}`;
  if (typeof result.winningTeam === 'number') {
    const members = teamOf ? names.filter((_, i) => teamOf[i] === result.winningTeam) : [];
    return members.length > 0 ? `${teamName(result.winningTeam)} (${members.join(', ')})` : teamName(result.winningTeam);
  }
  return result.method === 'noContest' ? 'No contest' : 'No winner';
}

/** True when the result has someone to name as the winner. */
export function hasWinner(result: Pick<BoutResultData, 'winner' | 'winningTeam'>): boolean {
  return typeof result.winner === 'number' || typeof result.winningTeam === 'number';
}

const pct = (la: LandedAttempted): string =>
  la.attempted === 0 ? '—' : `${Math.round((la.landed / la.attempted) * 100)} %`;

const la = (x: LandedAttempted): string => `${x.landed} of ${x.attempted}`;

// --------------------------------------------------------------------------
// The stat table
// --------------------------------------------------------------------------

interface StatRow {
  label: string;
  help?: string;
  value: (f: FighterRoundStats, round: RoundStats) => string;
}

/** The UFCStats row set, in the order that sheet prints them (09 §4.1). */
export const STAT_ROWS: readonly StatRow[] = Object.freeze([
  {
    label: 'Significant strikes',
    help: 'Every strike landed at distance, plus power strikes landed in the clinch or on the '
      + 'ground. Short clinch and ground strikes count towards totals only.',
    value: (f) => `${la(f.sig)} (${pct(f.sig)})`,
  },
  { label: '— head', value: (f) => la(f.sigByTarget.head) },
  { label: '— body', value: (f) => la(f.sigByTarget.body) },
  { label: '— leg', value: (f) => la(f.sigByTarget.leg) },
  { label: '— at distance', value: (f) => la(f.sigByPosition.distance) },
  { label: '— in clinch', value: (f) => la(f.sigByPosition.clinch) },
  { label: '— on the ground', value: (f) => la(f.sigByPosition.ground) },
  {
    label: 'Total strikes',
    help: 'All landed strikes, significant or not.',
    value: (f) => `${la(f.total)} (${pct(f.total)})`,
  },
  {
    label: 'Takedowns',
    help: 'Landed means the opponent reached a ground position with this fighter on top and it '
      + 'was held for three seconds.',
    value: (f) => `${la(f.takedowns)} (${pct(f.takedowns)})`,
  },
  {
    label: 'Submission attempts',
    help: 'Attempts that reached the "secure" stage. Re-grips within five seconds are the same attempt.',
    value: (f) => String(f.subAttempts),
  },
  {
    label: 'Control time',
    help: 'Clinch control plus ground top and back control. Not counted from the bottom, in a '
      + 'neutral clinch, or during a scramble.',
    value: (f) => clockOf(f.controlSeconds),
  },
  { label: 'Knockdowns', value: (f) => String(f.knockdowns) },
  { label: 'Reversals', value: (f) => String(f.reversals) },
  {
    label: 'Sig. strikes absorbed',
    help: 'The mirror of the opponent’s tally; head-only in brackets.',
    value: (f) => `${f.sigAbsorbed} (${f.headSigAbsorbed} head)`,
  },
  { label: 'Sub. attempts against', value: (f) => String(f.subAttemptsAgainst) },
]);

function StatTable({ round, names }: { round: RoundStats; names: readonly string[] }): JSX.Element {
  return (
    <div className="table-wrap">
      <table className="ms-stats">
        <caption className="visually-hidden">
          {round.round === 0 ? 'Bout totals' : `Round ${round.round}`} statistics per fighter.
        </caption>
        <thead>
          <tr>
            <th scope="col">Statistic</th>
            {round.fighters.map((f) => (
              <th key={f.fighter} scope="col">{names[f.fighter] ?? `Fighter ${f.fighter}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {STAT_ROWS.map((row) => (
            <tr key={row.label}>
              <th scope="row" title={row.help}>{row.label}</th>
              {round.fighters.map((f) => (
                <td key={f.fighter} className="num mono">{row.value(f, round)}</td>
              ))}
            </tr>
          ))}
          <tr>
            <th scope="row" title="Shared phase time: both fighters are always in the same phase.">
              Time at distance / clinch / ground
            </th>
            <td className="num mono" colSpan={round.fighters.length}>
              {clockOf(round.positionSeconds.distance)} / {clockOf(round.positionSeconds.clinch)}
              {' / '}{clockOf(round.positionSeconds.ground)}
              <span className="ms-dim"> of {clockOf(round.seconds)}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// --------------------------------------------------------------------------
// Scorecards
// --------------------------------------------------------------------------

function Scorecards({
  result, names, hidden,
}: { result: BoutResultData; names: readonly string[]; hidden: boolean }): JSX.Element {
  if (result.scorecards.length === 0) {
    return (
      <p className="ms-note">
        No cards: the bout ended inside the distance, so the judges never turned one in.
      </p>
    );
  }
  const rounds = result.scorecards[0].length;
  return (
    <>
      {hidden ? (
        <p className="ms-note">
          Cards were hidden during the bout, as they are under a commission. They are shown here
          because the decision is not evidence of itself.
        </p>
      ) : null}
      <div className="table-wrap">
        <table className="ms-cards">
          <caption className="visually-hidden">Official scorecards, per judge and round.</caption>
          <thead>
            <tr>
              <th scope="col">Judge</th>
              <th scope="col">Fighter</th>
              {Array.from({ length: rounds }, (_, r) => (
                <th key={r} scope="col">R{r + 1}</th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {result.scorecards.map((card, judge) => (
              card[0].map((_, fighter) => (
                <tr key={`${judge}-${fighter}`} className={fighter === 0 ? 'ms-card-first' : undefined}>
                  {fighter === 0 ? (
                    <th scope="row" rowSpan={card[0].length}>Judge {judge + 1}</th>
                  ) : null}
                  <td>{names[fighter] ?? `Fighter ${fighter}`}</td>
                  {card.map((roundScores, r) => (
                    <td key={r} className="num mono">{roundScores[fighter]}</td>
                  ))}
                  <td className="num mono">
                    <b>{result.judgeTotals[judge]?.[fighter] ?? '—'}</b>
                  </td>
                </tr>
              ))
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// --------------------------------------------------------------------------
// Screen
// --------------------------------------------------------------------------

export function BoutResultScreen({ run, onWatch, onExport, onRematch }: BoutResultProps): JSX.Element {
  const [tab, setTab] = useState<'total' | number>('total');

  const names = useMemo(
    () => (run ? run.config.fighters.map((f) => f.short || f.name) : []),
    [run],
  );

  if (!run) {
    return (
      <div className="ms">
        <EmptyState icon={<IconResult />} title="No bout to show yet">
          Build and run a bout in Match setup, or open a past bout from History. Its scorecards and
          the full round-by-round stat sheet will appear here.
        </EmptyState>
      </div>
    );
  }

  const r = run.result;
  const shown = tab === 'total' ? run.stats.total : run.stats.perRound[tab] ?? run.stats.total;
  const rulesetId = typeof run.config.ruleset === 'string'
    ? run.config.ruleset
    : (run.config.ruleset.id as RulesetId);
  const realism = run.config.settings.damageRealism;

  return (
    <div className="ms">
      <header className="ms-head page-head">
        <div>
          <h1 className="page-title">{names.join(' vs ')}</h1>
          <p className="ms-verdict">
            <b>{winnerLabel(r, names, run.config.teams?.teamOf)}</b>
            {typeof r.winner === 'number'
              ? ` def. ${names.filter((_, i) => i !== r.winner).join(', ')}`
              : ''}
            {' · '}
            {methodLabel(r.method)}
            {r.detail ? ` (${r.detail})` : ''}
            {' · '}
            R{r.round} {clockOf(r.timeSeconds)}
          </p>
          <p className="ms-sub mono">
            {RULESET_LABELS[rulesetId] ?? rulesetId} · {run.config.mode} ·{' '}
            {clockOf(r.totalSeconds)} of fight · {run.ticks.toLocaleString()} ticks ·{' '}
            {run.rngDraws.toLocaleString()} draws
          </p>
          <p className="ms-sub mono">
            seed <code>{run.config.seed}</code> · digest <code>{run.digest.slice(0, 16)}</code>
          </p>
        </div>
        <div className="page-actions">
          {onWatch ? (
            <button type="button" className="btn btn--play" onClick={() => onWatch(run)}>Watch</button>
          ) : null}
          {onRematch ? (
            <button type="button" className="btn" onClick={() => onRematch(run)} title="Same fighters, same settings, a new seed">
              Rematch
            </button>
          ) : null}
          {onExport ? (
            <button type="button" className="btn" onClick={() => onExport(run)}>Export replay</button>
          ) : null}
        </div>
      </header>

      {realism !== 'realism' ? (
        <p className="ms-warn ms-warn--warning" role="status">
          Damage realism was set to <b>{realism}</b>. The chapter 09 §7 calibration targets do not
          apply to this bout — treat the numbers below as a description of this setting, not of
          fighting.
        </p>
      ) : null}

      <section className="fc-section">
        <h3 className="fc-h fc-h--sub">Scorecards</h3>
        <Scorecards result={r} names={names} hidden={run.config.settings.judgingMode === 'hidden'} />
      </section>

      <section className="fc-section">
        <h3 className="fc-h fc-h--sub">Statistics</h3>
        <div className="ms-roundtabs" role="tablist" aria-label="Round">
          <button
            type="button"
            role="tab"
            className="btn btn--chip"
            aria-selected={tab === 'total'}
            onClick={() => setTab('total')}
          >
            Bout total
          </button>
          {run.stats.perRound.map((round, i) => (
            <button
              key={round.round}
              type="button"
              role="tab"
              className="btn btn--chip"
              aria-selected={tab === i}
              onClick={() => setTab(i)}
            >
              R{round.round}
            </button>
          ))}
        </div>
        <StatTable round={shown} names={names} />
      </section>
    </div>
  );
}
