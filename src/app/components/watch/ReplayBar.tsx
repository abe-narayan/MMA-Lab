/**
 * REPLAY CONTROLS — instant replays, the loop range, and saving/opening
 * replays, in one row under the fighters.
 *
 * The highlight chips are the broadcast's planned replays whose moment is
 * already behind the playhead (knockdowns, the finish, each round's best
 * moment): a click airs that multi-angle slow-motion replay. The row
 * re-renders only when a new moment passes (or the loop / save state
 * changes), not with the clock.
 */
import { memo } from 'react';
import type { BoutPlayer } from '../../replay/player';
import type { ReplayPlan } from '../../../presentation/camera';
import type { PlayheadSignal } from '../../replay/playhead';
import type { Verification } from '../../replay/saved';
import { Button, StatusBadge, IconDownload } from '../../ui';
import { usePlayhead } from './usePlayhead';
import { IconChart, IconFolder, IconLoop, IconSave } from './icons';

export interface ReplayBarProps {
  player: BoutPlayer;
  signal: PlayheadSignal;
  /** The broadcast's planned replays (knockdowns, the finish, each round's best moment). */
  plans: readonly ReplayPlan[];
  onPlan(plan: ReplayPlan): void;
  /** Round clock for a tick ("R2 1:14"). */
  label(tick: number): string;
  loopOn: boolean;
  loopFrom: number | null;
  onSetIn(): void;
  onToggleLoop(): void;
  onSave(): void;
  saving: boolean;
  savedHere: boolean;
  onLibrary(): void;
  onDownload(): void;
  verification: { kind: Verification | 'checking'; message: string } | null;
  analyticsOpen: boolean;
  onAnalytics(): void;
}

const TONE: Record<Verification | 'checking', 'ok' | 'warn' | 'alert' | 'info' | 'neutral'> = {
  verified: 'ok', cached: 'info', mismatch: 'alert', 'other-engine': 'warn', checking: 'neutral',
};
const WORD: Record<Verification | 'checking', string> = {
  verified: 'Verified', cached: 'Saved recording', mismatch: 'Digest mismatch', 'other-engine': 'Other engine', checking: 'Verifying…',
};

function ReplayBarInner(props: ReplayBarProps): JSX.Element {
  const { player, signal } = props;
  // How many moments are behind the playhead: the re-render trigger.
  const passed = usePlayhead(signal, () => {
    const t = player.tick;
    let n = 0;
    for (const pl of props.plans) if (pl.keyTick <= t) n++;
    return n;
  }, 4);
  void passed;
  const tick = player.tick;
  const chips = props.plans.filter((pl) => pl.keyTick <= tick).sort((a, b) => a.keyTick - b.keyTick).slice(-4);
  return (
    <section className="watch-replaybar" aria-label="Replays and library">
      <div className="wr-group" role="group" aria-label="Instant replays">
        <span className="wr-label">Highlights</span>
        {chips.length === 0 ? <span className="wr-empty">none yet</span> : null}
        {chips.map((pl) => (
          <button
            key={pl.id}
            type="button"
            className="wa-chip"
            title={`Replay (${pl.segments.length} angle${pl.segments.length > 1 ? 's' : ''}, slow motion): ${pl.label}`}
            onClick={() => props.onPlan(pl)}
          >
            <b>{pl.title.charAt(0) + pl.title.slice(1).toLowerCase()}</b> · {props.label(pl.keyTick)}
          </button>
        ))}
      </div>

      <div className="wr-group" role="group" aria-label="Loop">
        <Button size="sm" variant="ghost" onClick={props.onSetIn} title="Mark the loop start at the playhead">
          {props.loopFrom === null ? 'Set loop in' : `In: tick ${props.loopFrom}`}
        </Button>
        <Button
          size="sm"
          icon={<IconLoop />}
          aria-pressed={props.loopOn}
          disabled={props.loopFrom === null && !props.loopOn}
          onClick={props.onToggleLoop}
          title={props.loopOn ? 'Stop looping' : 'Loop from the in point to the playhead'}
        >
          {props.loopOn ? 'Looping' : 'Loop to here'}
        </Button>
      </div>

      <div className="wr-group wr-right" role="group" aria-label="Saved replays">
        {props.verification ? (
          <StatusBadge tone={TONE[props.verification.kind]} dot title={props.verification.message}>
            {WORD[props.verification.kind]}
          </StatusBadge>
        ) : null}
        <Button size="sm" icon={<IconSave />} busy={props.saving} onClick={props.onSave} title="Save this bout to the replay library in this browser">
          {props.savedHere ? 'Saved' : 'Save'}
        </Button>
        <Button size="sm" iconOnly icon={<IconDownload />} aria-label="Download replay file" title="Download a .boutreplay file (seed and setup; re-simulates exactly)" onClick={props.onDownload} />
        <Button size="sm" icon={<IconFolder />} onClick={props.onLibrary} title="Saved replays and import">Library</Button>
        <Button
          size="sm"
          variant={props.analyticsOpen ? 'primary' : 'default'}
          icon={<IconChart />}
          aria-pressed={props.analyticsOpen}
          aria-controls="watch-analytics"
          onClick={props.onAnalytics}
          title="Statistics, scorecards, commentary, events, game plan (A)"
        >
          Analytics
        </Button>
      </div>
    </section>
  );
}

export const ReplayBar = memo(ReplayBarInner);
