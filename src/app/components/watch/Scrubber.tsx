/**
 * THE SCRUBBER — the bout's timeline under the picture.
 *
 * A native range input (drag, click, keyboard, screen readers) over a drawn
 * track: the played part, round boundaries, and a lane of event markers
 * above it (knockdowns, takedowns, submission attempts, finishes, round
 * ends, big strikes) that jump to their moment on click. Hovering the track
 * shows the round clock under the pointer. Subscribes to the playhead itself
 * (20 Hz), so the rest of the screen does not re-render as it moves.
 */
import { memo, useCallback, useMemo, useState, type PointerEvent } from 'react';
import type { BoutPlayer } from '../../replay/player';
import type { PlayheadSignal } from '../../replay/playhead';
import { MARKER_KINDS, type TimelineMarker } from '../../replay/markers';
import { clock as broadcastClock } from '../broadcast/model';
import { usePlayhead } from './usePlayhead';
import { FrameStore } from '../../../sim/record/frames';

/** Recorded tick of frame `i` without decoding the frame. */
export function tickOfFrame(player: BoutPlayer, i: number): number {
  const store = FrameStore.of(player.frames);
  return (store ? store.tickAt(i) : player.frames[i]?.tick) ?? 0;
}

export interface ScrubberProps {
  player: BoutPlayer;
  signal: PlayheadSignal;
  markers: readonly TimelineMarker[];
  /** Round starts: tick and 0-1 position. */
  rounds: readonly { round: number; tick: number; at: number }[];
  onSeekFrame(frame: number): void;
  onMarker(m: TimelineMarker): void;
  /** Round clock at a tick, e.g. "R2 1:14". */
  label(tick: number): string;
}

const KIND_LABEL = new Map(MARKER_KINDS.map((k) => [k.kind, k.label]));

/** Horizontal room one marker needs, as a fraction of the lane (~12 px at ~1,000 px). */
export const MARKER_GAP = 0.012;
export const MARKER_ROWS = 3;
const ROW_PX = 11;

/**
 * Collision-stack markers: each goes in the lowest row whose previous marker
 * is at least `gap` to its left, so markers close in time sit above one
 * another instead of on top of one another. When every row is taken it uses
 * the row that freed up longest ago. Returns a row per input, in input order.
 */
export function stackMarkers(ats: readonly number[], gap = MARKER_GAP, maxRows = MARKER_ROWS): number[] {
  const order = ats.map((at, i) => ({ at, i })).sort((a, b) => a.at - b.at || a.i - b.i);
  const lastAt: number[] = [];
  const rows = new Array<number>(ats.length).fill(0);
  for (const { at, i } of order) {
    let row = lastAt.findIndex((x) => at - x >= gap);
    if (row < 0) {
      if (lastAt.length < maxRows) row = lastAt.length;
      else row = lastAt.indexOf(Math.min(...lastAt));
    }
    lastAt[row] = at;
    rows[i] = row;
  }
  return rows;
}

function ScrubberInner(props: ScrubberProps): JSX.Element {
  const { player, signal, markers } = props;
  const frame = usePlayhead(signal, () => player.frame, 20);
  const span = Math.max(1, player.total - 1);
  const pct = (frame / span) * 100;
  const [hover, setHover] = useState<{ x: number; text: string } | null>(null);

  const onMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width <= 0) return;
    const f = Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * span);
    const tick = tickOfFrame(player, f);
    setHover({ x: e.clientX - r.left, text: props.label(tick) });
  }, [player, span, props]);

  // Markers are static per bout; only their "passed" state follows the playhead.
  const tick = tickOfFrame(player, frame);
  const rows = useMemo(() => stackMarkers(markers.map((m) => m.at)), [markers]);
  const laneRows = rows.length > 0 ? Math.max(...rows) + 1 : 1;
  const lane = useMemo(() => markers.map((m, i) => (
    <button
      key={`${m.kind}-${m.eventIndex}`}
      type="button"
      className="watch-marker"
      data-kind={m.kind}
      style={{ left: `${m.at * 100}%`, marginTop: `${(laneRows - 1 - rows[i]) * ROW_PX}px` }}
      title={`${KIND_LABEL.get(m.kind) ?? m.kind} · ${props.label(m.tick)} — ${m.label}`}
      aria-label={`${KIND_LABEL.get(m.kind) ?? m.kind} at ${props.label(m.tick)}: ${m.label}`}
      onClick={() => props.onMarker(m)}
    />
    // eslint-disable-next-line react-hooks/exhaustive-deps
  )), [markers, rows, laneRows, props.onMarker, props.label]);

  const rail = useMemo(() => (
    <>
      {props.rounds.map((r) => (r.at > 0 ? (
        <span key={r.round} className="watch-scrub-round" style={{ left: `${r.at * 100}%` }}>
          <span>R{r.round}</span>
        </span>
      ) : null))}
      {markers.map((m) => (
        <span
          key={`t-${m.kind}-${m.eventIndex}`}
          className="watch-scrub-tick"
          data-kind={m.kind}
          style={{ left: `${m.at * 100}%` }}
        />
      ))}
    </>
  ), [markers, props.rounds]);

  return (
    <div className="watch-scrub">
      <div className="watch-scrub-lane" aria-label="Highlights" style={{ height: `${laneRows * ROW_PX + 1}px` }}>{lane}</div>
      <div
        className="watch-scrub-track"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <div className="watch-scrub-rail" aria-hidden="true">
          <div className="watch-scrub-played" style={{ width: `${pct}%` }} />
          {rail}
          <div className="watch-scrub-head" style={{ left: `${pct}%` }} />
        </div>
        <input
          className="watch-scrub-input"
          type="range"
          min={0}
          max={span}
          step={1}
          value={frame}
          aria-label="Seek"
          aria-valuetext={props.label(tick)}
          onChange={(e) => props.onSeekFrame(Number(e.target.value))}
        />
        {hover ? (
          <span className="watch-scrub-hover" style={{ left: hover.x }} aria-hidden="true">{hover.text}</span>
        ) : null}
      </div>
    </div>
  );
}

export const Scrubber = memo(ScrubberInner);

/**
 * "R2 · 1:14" for a tick: the round and the time left on its clock, as the
 * broadcast clock bug shows it ("R2 · end" once the round's time is up).
 */
export function roundClockLabel(
  roundStarts: readonly { round: number; tick: number }[], tickSeconds: number, roundSeconds: number,
) {
  return (tick: number): string => {
    let r = roundStarts[0] ?? { round: 1, tick: 0 };
    for (const s of roundStarts) if (s.tick <= tick) r = s;
    const left = roundSeconds - (tick - r.tick) * tickSeconds;
    return left <= 0 ? `R${r.round} · end` : `R${r.round} · ${broadcastClock(left)}`;
  };
}
