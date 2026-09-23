/**
 * COMMENTARY FEED — the lines `generateCommentary` produced for this run, as
 * far as the playhead has got (09 §5).
 *
 * The two registers are visually distinct because they do different jobs: the
 * play-by-play says what happened, the colour says why. Clicking a line seeks
 * to the moment it describes.
 */
import { useEffect, useRef } from 'react';
import type { CommentaryLine } from '../../sim';
import { clockString, type Corner } from '../replay/viewModel';

export interface CommentaryFeedProps {
  lines: readonly CommentaryLine[];
  cornerOf(fighterId: number): Corner;
  onSeekTick(tick: number): void;
  /** Hide the play-by-play and keep only the strategy/colour register. */
  colourOnly?: boolean;
}

export function CommentaryFeed(props: CommentaryFeedProps): JSX.Element {
  const listRef = useRef<HTMLOListElement | null>(null);
  const rows = props.colourOnly
    ? props.lines.filter((l) => l.voice === 'colour')
    : props.lines;

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [rows.length]);

  return (
    <section className="panel watch-commentary" aria-label="Commentary">
      <div className="panel-head">
        <span className="panel-title">Commentary</span>
        <span className="frame-read" style={{ marginLeft: 'auto' }}>{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="empty">Nothing said yet.</p>
      ) : (
        <ol className="watch-comm-list" ref={listRef}>
          {rows.map((l, i) => (
            <li key={`${l.tick}-${l.subMs}-${i}`}>
              <button
                type="button"
                className="watch-comm"
                data-voice={l.voice}
                data-priority={l.priority}
                onClick={() => props.onSeekTick(l.tick)}
                title={`Seek to tick ${l.tick} — ${l.tags.join(', ')}`}
              >
                <span className="watch-comm-time num">
                  R{l.round} {clockString(l.t)}
                </span>
                <span className="watch-comm-text">
                  {l.actor >= 0 ? (
                    <span className="watch-dot" data-actor={props.cornerOf(l.actor)} aria-hidden="true" />
                  ) : null}
                  {l.text}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
