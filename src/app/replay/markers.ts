/**
 * TIMELINE MARKERS — the moments a viewer jumps to (Watch/replay pass).
 *
 * The scrubber shows the bout's shape: a tick for every knockdown, landed
 * takedown, submission attempt and finish, round end, and big strike, placed
 * by frame index so a marker sits exactly where a click on it seeks. Pure
 * function of the recording; the event array is only read.
 */
import type { SimEvent } from '../../sim';
import { REPLAY_RULES } from '../../presentation/camera';

export type MarkerKind = 'knockdown' | 'takedown' | 'submission' | 'finish' | 'roundEnd' | 'bigStrike' | 'slam';

export interface TimelineMarker {
  kind: MarkerKind;
  tick: number;
  /** Index into `events`. */
  eventIndex: number;
  /** Fighter credited (-1 for bout-level markers). */
  actor: number;
  /** Tooltip text. */
  label: string;
  /** 0-1 along the scrubber (by frame index). */
  at: number;
}

/** Display order / legend, strongest first. */
export const MARKER_KINDS: readonly { kind: MarkerKind; label: string }[] = [
  { kind: 'finish', label: 'Finish' },
  { kind: 'knockdown', label: 'Knockdown' },
  { kind: 'submission', label: 'Submission attempt' },
  { kind: 'takedown', label: 'Takedown' },
  { kind: 'slam', label: 'Slam' },
  { kind: 'bigStrike', label: 'Big strike' },
  { kind: 'roundEnd', label: 'End of round' },
];

/** Submission attempts re-gripped within this many ticks are one marker. */
const SUB_MERGE_TICKS = 50;

function kindOf(e: SimEvent): MarkerKind | null {
  switch (e.kind) {
    case 'knockdown':
      return 'knockdown';
    case 'slam':
      return 'slam';
    case 'submissionFinish':
    case 'refereeStoppage':
    case 'cornerStop':
      return 'finish';
    case 'roundEnd':
      return 'roundEnd';
    case 'takedown': {
      const d = (e as { detail?: { result?: string } }).detail;
      return d?.result === 'success' ? 'takedown' : null;
    }
    case 'submissionStage': {
      // An attempt that got past the entry (stage 2 "secure" or later).
      const d = (e as { detail?: { stage?: number } }).detail;
      return (d?.stage ?? 0) >= 2 ? 'submission' : null;
    }
    case 'strike': {
      const d = (e as { detail?: { result?: string; forceN?: number } }).detail;
      return d?.result === 'landed' && (d.forceN ?? 0) >= REPLAY_RULES.bigStrikeForceN ? 'bigStrike' : null;
    }
    default:
      return null;
  }
}

/**
 * Markers for a recording. `frameOfTick` maps a tick to its frame index (the
 * transport's `indexForTick`), `frameCount` is the number of frames.
 */
export function timelineMarkers(
  events: readonly SimEvent[], frameOfTick: (tick: number) => number, frameCount: number,
): TimelineMarker[] {
  const out: TimelineMarker[] = [];
  const lastSub = new Map<number, number>();
  const span = Math.max(1, frameCount - 1);
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const kind = kindOf(e);
    if (!kind) continue;
    if (kind === 'submission') {
      const prev = lastSub.get(e.actor);
      lastSub.set(e.actor, e.tick);
      if (prev !== undefined && e.tick - prev <= SUB_MERGE_TICKS) continue;
    }
    out.push({
      kind,
      tick: e.tick,
      eventIndex: i,
      actor: e.actor,
      label: kind === 'roundEnd' ? `End of round ${e.round}` : (e.text || e.kind),
      at: Math.min(1, Math.max(0, frameOfTick(e.tick) / span)),
    });
  }
  return out;
}

/** The next (+1) or previous (-1) marker from `tick`, optionally of the given kinds. */
export function adjacentMarker(
  markers: readonly TimelineMarker[], tick: number, dir: 1 | -1, kinds?: ReadonlySet<MarkerKind>,
): TimelineMarker | null {
  const ok = (m: TimelineMarker): boolean => !kinds || kinds.has(m.kind);
  if (dir > 0) {
    for (const m of markers) if (m.tick > tick && ok(m)) return m;
    return null;
  }
  for (let i = markers.length - 1; i >= 0; i--) if (markers[i].tick < tick && ok(markers[i])) return markers[i];
  return null;
}
