/**
 * ANALYTICS — the optional side panel (closed by default; `A` toggles it).
 *
 * Tabs: statistics and scorecards **as they stood at the playhead**
 * (`statsAt.ts`: scrub back to round one and the table goes back with it),
 * the commentary spoken so far, the event log, the visible game plan and the
 * debug readout. Only the open tab renders, and each subscribes to the
 * playhead at the rate it needs (statistics 4 Hz, the log only when the
 * playhead crosses an event), so an open panel costs little during playback
 * and a closed one costs nothing.
 */
import { memo, useCallback, useMemo, useState } from 'react';
import type { BoutPlayer } from '../../replay/player';
import type { PlayheadSignal } from '../../replay/playhead';
import type { WatchBout } from '../../replay/bout';
import { StatsTimeline, eventsThrough, scorecardAt } from '../../replay/statsAt';
import {
  commentaryUpTo, cornerOf, debugRows, gamePlanRows, intentsAt, statRows, type Corner,
} from '../../replay/viewModel';
import { StatTable } from '../StatTable';
import { Scorecard } from '../Scorecard';
import { CommentaryFeed } from '../CommentaryFeed';
import { EventTimeline, TIMELINE_GROUPS } from '../EventTimeline';
import { GamePlanPanel } from '../GamePlanPanel';
import { DebugOverlay } from '../DebugOverlay';
import { Tabs, TabPanel, Switch } from '../../ui';
import { usePlayhead } from './usePlayhead';
import { tickOfFrame } from './Scrubber';

export type AnalyticsTab = 'stats' | 'cards' | 'commentary' | 'events' | 'plan' | 'debug';

const TABS: readonly { id: AnalyticsTab; label: string; hint: string }[] = [
  { id: 'stats', label: 'Stats', hint: 'UFCStats-style tallies as of the playhead' },
  { id: 'cards', label: 'Cards', hint: 'Judges’ scorecards for the rounds scored so far' },
  { id: 'commentary', label: 'Commentary', hint: 'What the commentators have said so far' },
  { id: 'events', label: 'Events', hint: 'The recorded event log; click a row to seek' },
  { id: 'plan', label: 'Plan', hint: 'Each fighter’s plan, straight from the AI' },
  { id: 'debug', label: 'Debug', hint: 'State graph, AI decision state, pools' },
];

const MemoTimeline = memo(EventTimeline);
const MemoCommentary = memo(CommentaryFeed);

interface Common {
  player: BoutPlayer;
  signal: PlayheadSignal;
  bout: WatchBout;
  names: readonly string[];
  corners: readonly Corner[];
  onSeekTick(tick: number): void;
}

function StatsTab(props: Common & { timeline: StatsTimeline; label: (t: number) => string }): JSX.Element {
  const { player, signal } = props;
  const tick = usePlayhead(signal, () => tickOfFrame(player, player.frame), 4);
  const [round, setRound] = useState(0);
  const stats = props.timeline.at(tick);
  const row = round === 0 ? stats.total : stats.perRound.find((r) => r.round === round);
  return (
    <div className="wa-tab">
      <p className="wa-asof">As of <b>{props.label(tick)}</b>{tick >= props.bout.run.ticks ? ' · final' : ''}</p>
      <StatTable
        title="Statistics"
        rows={statRows(row)}
        names={props.names}
        corners={props.corners}
        rounds={stats.perRound.map((r) => r.round)}
        selectedRound={round}
        onSelectRound={setRound}
      />
    </div>
  );
}

function CardsTab(props: Common): JSX.Element {
  const { player, signal, bout } = props;
  const events = bout.run.events;
  // Changes only when a round is scored or the bout ends.
  const key = usePlayhead(signal, () => {
    const t = tickOfFrame(player, player.frame);
    let n = 0;
    const upto = eventsThrough(events, t);
    for (let i = 0; i < upto; i++) if (events[i].kind === 'scorecardRound') n++;
    return `${n}|${player.atEnd}`;
  }, 4);
  const ended = key.endsWith('true');
  const hidden = player.current?.score.hidden ?? true;
  const model = useMemo(
    () => scorecardAt(events, bout.run.result.judgeTotals, hidden, tickOfFrame(player, player.frame), ended),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, hidden, events],
  );
  return (
    <Scorecard model={model} names={props.names} corners={props.corners} result={ended ? bout.run.result : null} reveal={ended} />
  );
}

function CommentaryTab(props: Common & { cornerOfId: (id: number) => Corner }): JSX.Element {
  const { player, signal, bout } = props;
  const [colourOnly, setColourOnly] = useState(false);
  const count = usePlayhead(signal, () => {
    const t = tickOfFrame(player, player.frame);
    let n = 0;
    while (n < bout.commentary.length && bout.commentary[n].tick <= t) n++;
    return n;
  }, 4);
  const lines = useMemo(
    () => commentaryUpTo(bout.commentary, count > 0 ? bout.commentary[count - 1].tick : -1),
    [bout.commentary, count],
  );
  return (
    <div className="wa-tab">
      <div className="wa-toolbar">
        <Switch checked={colourOnly} onChange={setColourOnly} label="Strategy lines only" />
      </div>
      <MemoCommentary lines={lines} cornerOf={props.cornerOfId} colourOnly={colourOnly} onSeekTick={props.onSeekTick} />
    </div>
  );
}

function EventsTab(props: Common & { cornerOfId: (id: number) => Corner; roundStartTick: (t: number) => number }): JSX.Element {
  const { player, signal, bout } = props;
  const [groups, setGroups] = useState<ReadonlySet<string>>(new Set());
  const current = usePlayhead(signal, () => eventsThrough(bout.run.events, tickOfFrame(player, player.frame)) - 1, 10);
  return (
    <div className="wa-tab">
      <div className="wa-toolbar" role="group" aria-label="Filter the event log">
        {TIMELINE_GROUPS.map((g) => (
          <button
            key={g}
            type="button"
            className="wa-chip"
            aria-pressed={groups.has(g)}
            onClick={() => setGroups((prev) => {
              const next = new Set(prev);
              if (next.has(g)) next.delete(g);
              else next.add(g);
              return next;
            })}
          >
            {g}
          </button>
        ))}
      </div>
      <MemoTimeline
        events={bout.run.events}
        currentIndex={current}
        cornerOf={props.cornerOfId}
        roundStartTick={props.roundStartTick}
        filter={groups}
        onSeekTick={props.onSeekTick}
      />
    </div>
  );
}

function PlanTab(props: Common & { debug: boolean }): JSX.Element {
  const { player, signal, bout } = props;
  const sample = usePlayhead(signal, () => {
    const t = tickOfFrame(player, player.frame);
    let i = 0;
    while (i + 1 < bout.intents.length && bout.intents[i + 1].tick <= t) i++;
    return i;
  }, 4);
  const rows = useMemo(
    () => gamePlanRows(intentsAt(bout.intents, bout.intents[sample]?.tick ?? 0), bout.fighters, bout.config.teams.teamOf),
    [bout, sample],
  );
  const cur = player.current;
  return <GamePlanPanel rows={rows} trueCards={cur?.score.hidden ? null : cur?.score.cards ?? null} showTierRules={props.debug} />;
}

function DebugTab(props: Common): JSX.Element {
  const { player, signal, bout } = props;
  const frame = usePlayhead(signal, () => player.frame, 10);
  const f = player.frames[frame] ?? null;
  const tick = f?.tick ?? 0;
  return (
    <DebugOverlay
      rows={debugRows(f, intentsAt(bout.intents, tick), bout.fighters)}
      tick={tick}
      digest={bout.run.digest}
      rngDraws={bout.run.rngDraws}
    />
  );
}

export interface AnalyticsPanelProps extends Common {
  tab: AnalyticsTab;
  onTab(tab: AnalyticsTab): void;
  debug: boolean;
  label(tick: number): string;
  roundStartTick(tick: number): number;
}

function AnalyticsPanelInner(props: AnalyticsPanelProps): JSX.Element {
  const { bout } = props;
  const timeline = useMemo(
    () => new StatsTimeline(bout.run.events, bout.config, { stats: bout.run.stats, ticks: bout.run.ticks }),
    [bout],
  );
  const teamOf = bout.config.teams.teamOf;
  const cornerOfId = useCallback((id: number) => cornerOf(id, teamOf), [teamOf]);
  return (
    <aside className="watch-analytics" aria-label="Analytics">
      <Tabs items={TABS} value={props.tab} onChange={props.onTab} label="Analytics" idPrefix="wa" />
      <div className="wa-body">
        {TABS.map((t) => (
          <TabPanel key={t.id} idPrefix="wa" id={t.id} active={props.tab === t.id}>
            {t.id === 'stats' ? <StatsTab {...props} timeline={timeline} label={props.label} /> : null}
            {t.id === 'cards' ? <CardsTab {...props} /> : null}
            {t.id === 'commentary' ? <CommentaryTab {...props} cornerOfId={cornerOfId} /> : null}
            {t.id === 'events' ? <EventsTab {...props} cornerOfId={cornerOfId} roundStartTick={props.roundStartTick} /> : null}
            {t.id === 'plan' ? <PlanTab {...props} debug={props.debug} /> : null}
            {t.id === 'debug' ? <DebugTab {...props} /> : null}
          </TabPanel>
        ))}
      </div>
    </aside>
  );
}

export const AnalyticsPanel = memo(AnalyticsPanelInner);
