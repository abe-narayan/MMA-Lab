/**
 * TRANSPORT — the essential fight controls, directly under the picture.
 *
 *   [restart][◀ frame][▶ play][frame ▶]  R2 1:14 · 6:14 / 12:30   speed   camera   [replay 8 s] [⛶] [?]
 *   ───────────────────── scrubber with highlight markers ─────────────────────
 *
 * Every control has a tooltip naming its key. The time readout subscribes to
 * the playhead at 10 Hz; the rest re-renders only when play state, speed,
 * camera or the replay on air change.
 */
import { memo } from 'react';
import type { BoutPlayer } from '../../replay/player';
import { SPEED_STEPS, TICK_SECONDS } from '../../replay/player';
import type { PlayheadSignal } from '../../replay/playhead';
import type { TimelineMarker } from '../../replay/markers';
import { clockString } from '../../replay/viewModel';
import { Button } from '../../ui';
import { usePlayhead } from './usePlayhead';
import { Scrubber, tickOfFrame } from './Scrubber';
import { CAMERA_SLOTS } from './cameras';
import {
  IconExitFullscreen, IconFullscreen, IconKeyboard, IconPause, IconPlayFilled, IconReplay, IconRestart,
  IconStepBack, IconStepFwd,
} from './icons';

export interface TransportBarProps {
  player: BoutPlayer;
  signal: PlayheadSignal;
  markers: readonly TimelineMarker[];
  rounds: readonly { round: number; tick: number; at: number }[];
  label(tick: number): string;
  playing: boolean;
  speed: number;
  /** Title of the instant replay on air, or null when live. */
  replay: string | null;
  cameraId: string;
  cameraChoices: readonly string[];
  fullscreen: boolean;
  onToggle(): void;
  onRestart(): void;
  onStep(frames: number): void;
  onSpeed(speed: number): void;
  onSeekFrame(frame: number): void;
  onMarker(m: TimelineMarker): void;
  onCamera(id: string): void;
  onReplayLast(): void;
  onBackToLive(): void;
  onFullscreen(): void;
  onHelp(): void;
}

function TimeReadout(props: { player: BoutPlayer; signal: PlayheadSignal; label(tick: number): string }): JSX.Element {
  const { player, signal } = props;
  const frame = usePlayhead(signal, () => player.frame, 10);
  const tick = tickOfFrame(player, frame);
  const last = tickOfFrame(player, player.total - 1);
  return (
    <span className="wt-time" aria-live="off">
      <b className="num">{props.label(tick)}</b>
      <span className="num wt-total" title="Bout time / total (tick)">
        {clockString(tick * TICK_SECONDS)} / {clockString(last * TICK_SECONDS)}
        <small> · tick {tick}</small>
      </span>
    </span>
  );
}

function fmtSpeed(s: number): string {
  return `${s < 1 ? String(s).replace(/^0/, '') : s}×`;
}

function TransportBarInner(props: TransportBarProps): JSX.Element {
  const { player, signal } = props;
  const speedKnown = (SPEED_STEPS as readonly number[]).some((s) => Math.abs(s - props.speed) < 1e-6);
  return (
    <div className="watch-transport" role="group" aria-label="Playback">
      <Scrubber
        player={player}
        signal={signal}
        markers={props.markers}
        rounds={props.rounds}
        label={props.label}
        onSeekFrame={props.onSeekFrame}
        onMarker={props.onMarker}
      />
      <div className="wt-row">
        <div className="wt-group">
          <Button size="sm" iconOnly variant="ghost" aria-label="Restart" title="Restart from the walkout (Home)" icon={<IconRestart />} onClick={props.onRestart} />
          <Button size="sm" iconOnly variant="ghost" aria-label="Back one frame" title="Back one frame (←; Shift+← one second)" icon={<IconStepBack />} onClick={() => props.onStep(-1)} />
          <Button
            className="wt-play"
            variant="primary"
            iconOnly
            aria-label={props.playing ? 'Pause' : 'Play'}
            title={props.playing ? 'Pause (Space or K)' : 'Play (Space or K)'}
            icon={props.playing ? <IconPause /> : <IconPlayFilled />}
            onClick={props.onToggle}
          />
          <Button size="sm" iconOnly variant="ghost" aria-label="Forward one frame" title="Forward one frame (→; Shift+→ one second)" icon={<IconStepFwd />} onClick={() => props.onStep(1)} />
          <TimeReadout player={player} signal={signal} label={props.label} />
        </div>

        {props.replay ? (
          <div className="wt-group wt-replay" role="status">
            <span className="wt-replay-tag">REPLAY</span>
            <span className="wt-replay-title">{props.replay}</span>
            <Button size="sm" onClick={props.onBackToLive} title="End the replay and return to where you were">Back to live</Button>
          </div>
        ) : null}

        <div className="wt-group wt-right">
          <label className="wt-select" title="Playback speed (J slower, L faster, Shift+K back to 1×)">
            <span className="wt-select-label">Speed</span>
            <select
              value={speedKnown ? String(props.speed) : 'custom'}
              onChange={(e) => props.onSpeed(Number(e.target.value))}
              aria-label="Playback speed"
            >
              {!speedKnown ? <option value="custom">{fmtSpeed(Math.round(props.speed * 100) / 100)}</option> : null}
              {SPEED_STEPS.map((s) => <option key={s} value={String(s)}>{fmtSpeed(s)}{s < 1 ? ' slow' : ''}</option>)}
            </select>
          </label>
          <label className="wt-select" title="Camera (keys 1–9)">
            <span className="wt-select-label">Camera</span>
            <select value={props.cameraId} onChange={(e) => props.onCamera(e.target.value)} aria-label="Camera">
              {CAMERA_SLOTS.filter((c) => props.cameraChoices.includes(c.id)).map((c) => (
                <option key={c.id} value={c.id}>{c.slot ? `${c.slot} · ` : ''}{c.label}</option>
              ))}
            </select>
          </label>
          <Button size="sm" icon={<IconReplay />} title="Instant replay of the last 8 seconds, in slow motion (R)" onClick={props.onReplayLast}>
            Replay
          </Button>
          <Button
            size="sm"
            iconOnly
            variant="ghost"
            aria-label={props.fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            title={props.fullscreen ? 'Exit fullscreen (F or Esc)' : 'Fullscreen (F)'}
            icon={props.fullscreen ? <IconExitFullscreen /> : <IconFullscreen />}
            onClick={props.onFullscreen}
          />
          <Button size="sm" iconOnly variant="ghost" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" icon={<IconKeyboard />} onClick={props.onHelp} />
        </div>
      </div>
    </div>
  );
}

export const TransportBar = memo(TransportBarInner);
