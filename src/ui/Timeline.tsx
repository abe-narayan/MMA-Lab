/**
 * EVENT TIMELINE
 *
 * The event log is the part of a replay file you can read without running
 * anything: every strike, block, evasion, takedown, position change, submission
 * attempt, knockdown and stoppage, with its tick. Clicking a line seeks the
 * playhead to the tick that produced it.
 */

import { useEffect, useRef } from 'react';
import type { BoutEvent } from '../engine/types';

export interface TimelineProps {
  events: BoutEvent[];
  /** Frame index for each event, parallel to `events`. */
  eventFrameIndex: number[];
  /** Index of the latest event at or before the playhead, or -1. */
  currentIndex: number;
  teams: ('A' | 'B')[];
  loading: boolean;
  onSeek(frame: number): void;
}

/** Events that change the state of the contest rather than trade a strike. */
const MAJOR = new Set([
  'boutStart', 'roundStart', 'roundEnd', 'boutEnd', 'knockdown',
  'submissionFinish', 'refereeStoppage', 'fighterOut', 'decision', 'takedown',
]);

const KIND_LABEL: Record<string, string> = {
  boutStart: 'bout', roundStart: 'round', roundEnd: 'round', boutEnd: 'bout',
  strike: 'strike', takedown: 'takedown', clinch: 'clinch', clinchBreak: 'break',
  positionChange: 'position', submissionAttempt: 'submission',
  submissionFinish: 'submission', knockdown: 'knockdown', standUp: 'stand-up',
  refereeStoppage: 'referee', fighterOut: 'referee', decision: 'decision',
};

function stamp(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function Timeline(props: TimelineProps) {
  const { events, eventFrameIndex, currentIndex, teams, loading } = props;
  const listRef = useRef<HTMLUListElement | null>(null);

  // Keep the playhead's event in view without ever scrolling the page itself.
  useEffect(() => {
    const list = listRef.current;
    if (!list || currentIndex < 0) return;
    const node = list.children[currentIndex] as HTMLElement | undefined;
    if (!node) return;
    const top = node.offsetTop - list.offsetTop;
    const bottom = top + node.offsetHeight;
    if (top < list.scrollTop || bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - list.clientHeight / 2 + node.offsetHeight / 2);
    }
  }, [currentIndex, events]);

  return (
    <section className="panel timeline" aria-label="Event timeline">
      <div className="panel-head">
        <span className="panel-title">Event log</span>
        <span className="frame-read" style={{ marginLeft: 'auto' }}>
          {events.length ? `${Math.max(0, currentIndex + 1)} / ${events.length}` : '—'}
        </span>
      </div>

      {events.length === 0 ? (
        <p className="empty">{loading ? 'Rebuilding the event log…' : 'No events.'}</p>
      ) : (
        <ul className="timeline-list" ref={listRef}>
          {events.map((e, i) => {
            const corner = e.actor < 0 ? '' : (teams[e.actor] ?? 'B');
            return (
              <li key={`${e.tick}-${i}`}>
              <button
                type="button"
                className="event"
                data-current={i === currentIndex ? 'true' : 'false'}
                data-future={i > currentIndex ? 'true' : 'false'}
                data-major={MAJOR.has(e.kind) ? 'true' : 'false'}
                aria-current={i === currentIndex ? 'true' : undefined}
                onClick={() => props.onSeek(eventFrameIndex[i] ?? e.tick)}
                title={`Seek to ${stamp(e.t)} (tick ${e.tick})`}
              >
                <span className="ev-time">
                  <b>R{e.round}</b>
                  {stamp(e.t)}
                </span>
                <span className="ev-body">
                  <span className="ev-text">{e.text}</span>
                  <span className="ev-meta">
                    <span className="ev-dot" data-actor={corner} aria-hidden="true" />
                    <span className="ev-kind">{KIND_LABEL[e.kind] ?? e.kind}</span>
                    {e.detail && e.detail !== e.kind ? (
                      <span className="ev-kind">{e.detail}</span>
                    ) : null}
                    {e.result ? (
                      <span className="ev-res" data-r={e.result}>
                        {e.result}
                      </span>
                    ) : null}
                    {typeof e.value === 'number' && e.value > 0 ? (
                      <span className="ev-kind">impact {e.value.toFixed(1)}</span>
                    ) : null}
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
