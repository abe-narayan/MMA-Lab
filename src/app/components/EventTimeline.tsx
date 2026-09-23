/**
 * EVENT TIMELINE (v4).
 *
 * The recorded event stream is the part of a bout you can read without running
 * anything. Clicking a line seeks the playhead to the tick that produced it —
 * the one idea worth carrying over verbatim from `src/ui/Timeline.tsx`, which
 * still drives the legacy engine and is left alone.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { SimEvent } from '../../sim';
import { clockString, type Corner } from '../replay/viewModel';

export interface EventTimelineProps {
  events: readonly SimEvent[];
  currentIndex: number;
  cornerOf(fighterId: number): Corner;
  /** Round start ticks, so each row shows a round clock rather than bout time. */
  roundStartTick(tick: number): number;
  onSeekTick(tick: number): void;
  /** Kind filter; empty means everything. */
  filter?: ReadonlySet<string>;
}

/** Events that change the state of the contest rather than trade a strike. */
const MAJOR = new Set([
  'boutStart', 'roundStart', 'roundEnd', 'boutEnd', 'knockdown', 'rocked',
  'submissionFinish', 'refereeStoppage', 'fighterOut', 'decision', 'takedown',
  'reversal', 'slam', 'deduction', 'cornerStop',
]);

const GROUP: Record<string, string> = {
  strike: 'strike', feint: 'strike', read: 'strike',
  takedown: 'grapple', clinch: 'grapple', clinchBreak: 'grapple', positionChange: 'grapple',
  scramble: 'grapple', reversal: 'grapple', standUp: 'grapple', engagementJoin: 'grapple',
  disengage: 'grapple', slam: 'grapple',
  submissionStage: 'submission', submissionFinish: 'submission',
  knockdown: 'damage', rocked: 'damage', stateChange: 'damage', injury: 'damage',
  planSet: 'strategy', intentChange: 'strategy', adjustment: 'strategy', cornerCue: 'strategy',
  scoreUpdate: 'strategy', paceShift: 'strategy', stanceSwitch: 'strategy',
  targetSwitch: 'strategy', roleAssign: 'strategy', trap: 'strategy', emergency: 'strategy',
};

export const TIMELINE_GROUPS = ['strike', 'grapple', 'submission', 'damage', 'strategy', 'official'] as const;

export function groupOf(kind: string): string {
  return GROUP[kind] ?? 'official';
}

export function EventTimeline(props: EventTimelineProps): JSX.Element {
  const { events, currentIndex, filter } = props;
  const listRef = useRef<HTMLUListElement | null>(null);

  const rows = useMemo(
    () => events
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => !filter || filter.size === 0 || filter.has(groupOf(e.kind))),
    [events, filter],
  );

  // Keep the playhead's event in view without ever scrolling the page itself.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const at = rows.findIndex((r) => r.i === currentIndex);
    if (at < 0) return;
    const node = list.children[at] as HTMLElement | undefined;
    if (!node) return;
    const top = node.offsetTop - list.offsetTop;
    const bottom = top + node.offsetHeight;
    if (top < list.scrollTop || bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - list.clientHeight / 2 + node.offsetHeight / 2);
    }
  }, [currentIndex, rows]);

  return (
    <section className="panel watch-timeline" aria-label="Event timeline">
      <div className="panel-head">
        <span className="panel-title">Event log</span>
        <span className="frame-read" style={{ marginLeft: 'auto' }}>
          {rows.length ? `${Math.max(0, currentIndex + 1)} / ${events.length}` : '—'}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="empty">No events match this filter.</p>
      ) : (
        <ul className="timeline-list" ref={listRef}>
          {rows.map(({ e, i }) => {
            const seconds = (e.tick - props.roundStartTick(e.tick)) / 10;
            return (
              <li key={`${e.tick}-${i}`}>
                <button
                  type="button"
                  className="event"
                  data-current={i === currentIndex ? 'true' : 'false'}
                  data-future={i > currentIndex ? 'true' : 'false'}
                  data-major={MAJOR.has(e.kind) ? 'true' : 'false'}
                  aria-current={i === currentIndex ? 'true' : undefined}
                  onClick={() => props.onSeekTick(e.tick)}
                  title={`Seek to tick ${e.tick}`}
                >
                  <span className="ev-time">
                    <b>R{e.round}</b>
                    {clockString(seconds)}
                  </span>
                  <span className="ev-body">
                    <span className="ev-text">{e.text || e.kind}</span>
                    <span className="ev-meta">
                      {e.actor >= 0 ? (
                        <span className="watch-dot" data-actor={props.cornerOf(e.actor)} aria-hidden="true" />
                      ) : null}
                      <span className="ev-kind">{e.kind}</span>
                      <span className="ev-kind">{groupOf(e.kind)}</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
