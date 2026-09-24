/**
 * FIGHTER BAR — the fighters and the round clock under the transport.
 *
 * Compact on purpose (the picture is the screen): per fighter the name,
 * record, gas tank, head/body/leg damage, significant strikes for the bout
 * and the round, and any state worth shouting (down, rocked). Everything is
 * `hudModel` of the frame on screen, so scrubbing moves it with the picture;
 * it subscribes to the playhead at 10 Hz rather than re-rendering with every
 * tick of the whole screen.
 */
import { memo } from 'react';
import type { BoutPlayer } from '../../replay/player';
import type { PlayheadSignal } from '../../replay/playhead';
import { clock as broadcastClock } from '../broadcast/model';
import { hudModel, type HudFighterRow, type HudModel } from '../../replay/viewModel';
import type { WatchBout } from '../../replay/bout';
import { usePlayhead } from './usePlayhead';

function pct(v: number): number {
  return Math.round(Math.max(0, Math.min(1, v)) * 100);
}

function Bar(props: { label: string; value: number; kind: 'gas' | 'dmg'; warn: boolean }): JSX.Element {
  const p = pct(props.value);
  return (
    <div className="wf-bar" data-kind={props.kind} data-warn={props.warn || undefined} title={`${props.label}: ${p}%`}>
      <span className="wf-bar-label">{props.label}</span>
      <span className="wf-bar-track" aria-hidden="true"><i style={{ width: `${p}%` }} /></span>
      <span className="wf-bar-value num">{p}</span>
    </div>
  );
}

const PRETTY: Record<string, string> = { rocked: 'Rocked', knockdown_hurt: 'Hurt', ko: 'KO', flash: 'Flash down' };

function FighterCard(props: { f: HudFighterRow; side: 'left' | 'right' }): JSX.Element {
  const f = props.f;
  const states = f.states.map((s) => s.replace(/^state\./, '')).filter((s) => s.length > 0).slice(0, 2);
  return (
    <article className="wf-card" data-corner={f.corner} data-side={props.side} data-down={f.down || undefined}>
      <header className="wf-head">
        <span className="wf-name" title={f.name}>{f.name}</span>
        <span className="wf-record num" title="Professional record">{f.record}</span>
        {f.down ? <span className="wf-flag" data-tone="alert">DOWN</span> : null}
        {!f.down && states.map((s) => (
          <span key={s} className="wf-flag" data-tone="warn">{PRETTY[s] ?? s.replace(/_/g, ' ')}</span>
        ))}
      </header>
      <div className="wf-bars">
        <Bar label="Gas" value={f.stamina} kind="gas" warn={f.stamina < 0.35} />
        <Bar label="Head" value={f.damage.head} kind="dmg" warn={f.damage.head > 0.7} />
        <Bar label="Body" value={f.damage.body} kind="dmg" warn={f.damage.body > 0.7} />
        <Bar label="Legs" value={f.damage.legs} kind="dmg" warn={f.damage.legs > 0.7} />
      </div>
      <dl className="wf-stats">
        <div title="Significant strikes landed / attempted, whole bout">
          <dt>Sig. strikes</dt>
          <dd className="num">{f.sig.landed}<small>/{f.sig.attempted}</small></dd>
        </div>
        <div title="Significant strikes this round">
          <dt>This round</dt>
          <dd className="num">{f.roundSig.landed}<small>/{f.roundSig.attempted}</small></dd>
        </div>
        <div title="Where the fighter is in the grappling graph">
          <dt>Position</dt>
          <dd className="wf-pos">{f.position}</dd>
        </div>
      </dl>
    </article>
  );
}

function Clock(props: { m: HudModel; roundTime: number; roundSeconds: number }): JSX.Element {
  const m = props.m;
  // Time left, like the broadcast clock bug.
  let left = m.clock;
  if (m.phase === 'round') left = broadcastClock(props.roundSeconds - props.roundTime);
  else if (m.phase === 'break') left = 'Break';
  const phase = m.phase === 'break' ? 'Between rounds' : m.phase === 'ended' ? 'Final' : m.phase === 'pre' ? 'Walkout' : null;
  return (
    <div className="wf-clock" aria-label={`Round ${m.round} of ${m.rounds}, ${left}`}>
      <span className="wf-round">Round {m.round}<small>/{m.rounds}</small></span>
      <span className="wf-time num" title={m.phase === 'ended' ? 'Finish time (elapsed in the round, as on the result)' : 'Time left in the round'}>{left}</span>
      <span className="wf-phase">{phase ?? `Referee: ${m.referee.state}`}</span>
    </div>
  );
}

export interface FighterBarProps {
  player: BoutPlayer;
  signal: PlayheadSignal;
  bout: WatchBout;
  rounds: number;
  roundSeconds: number;
  baselines: Parameters<typeof hudModel>[6];
}

function FighterBarInner(props: FighterBarProps): JSX.Element | null {
  const { player, signal, bout } = props;
  // Re-render when the frame changes, at most ten times a second.
  const frameIndex = usePlayhead(signal, () => player.frame, 10);
  const frame = player.frames[frameIndex] ?? null;
  const m = hudModel(frame, bout.fighters, bout.runtimes, bout.run.stats, bout.config.teams.teamOf, props.rounds, props.baselines);
  if (!m) return null;
  const two = m.fighters.length === 2;
  return (
    <section className="watch-fighters" data-count={m.fighters.length} aria-label="Fighters">
      {two ? (
        <>
          <FighterCard f={m.fighters[0]} side="left" />
          <Clock m={m} roundTime={frame?.roundTime ?? 0} roundSeconds={props.roundSeconds} />
          <FighterCard f={m.fighters[1]} side="right" />
        </>
      ) : (
        <>
          <Clock m={m} roundTime={frame?.roundTime ?? 0} roundSeconds={props.roundSeconds} />
          {m.fighters.map((f, i) => <FighterCard key={f.id} f={f} side={i % 2 ? 'right' : 'left'} />)}
        </>
      )}
    </section>
  );
}

export const FighterBar = memo(FighterBarInner);
