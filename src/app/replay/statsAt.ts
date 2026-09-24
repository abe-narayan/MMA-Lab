/**
 * STATISTICS AT THE PLAYHEAD (Watch/replay pass).
 *
 * The stat table and the scorecards used to print `run.stats` — the finished
 * bout's numbers — whatever the playhead showed: scrub to 0:30 of round one
 * and the table already had the knockdown from round three in it. A replay
 * viewer must show the numbers as they stood at the moment on screen.
 *
 * `computeStats(events, config, ticks)` is a pure function of the event log
 * (it replays the stream and integrates the time-based rows, 09 §4.1), so the
 * numbers at tick `t` are exactly `computeStats(events with tick <= t, config,
 * t)`: a takedown still inside its three-second stabilisation window is not
 * counted yet, control time runs to `t`, and at the last tick the result is
 * identical to `run.stats` (asserted in tests/replay.polish.test.ts).
 *
 * `StatsTimeline` caches those results per tick (a small LRU) and never
 * touches the event array it was given.
 */
import {
  computeStats, type BoutStats, type SimConfig, type SimEvent,
} from '../../sim';
import { scorecardModel, type ScorecardModel } from './viewModel';

/** Number of events with `tick <= t` in a tick-ordered stream (binary search). */
export function eventsThrough(events: readonly SimEvent[], tick: number): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].tick <= tick) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const CACHE_SIZE = 48;

export class StatsTimeline {
  private readonly cache = new Map<number, BoutStats>();
  /** Last tick of the recording: at or after it the finished run's stats apply. */
  private readonly lastTick: number;

  constructor(
    private readonly events: readonly SimEvent[],
    private readonly config: SimConfig,
    private readonly final: { stats: BoutStats; ticks: number },
  ) {
    this.lastTick = final.ticks;
  }

  /** The bout's statistics as they stood at `tick`. */
  at(tick: number): BoutStats {
    const t = Math.max(0, Math.floor(tick));
    if (t >= this.lastTick) return this.final.stats;
    const hit = this.cache.get(t);
    if (hit) {
      this.cache.delete(t);
      this.cache.set(t, hit);
      return hit;
    }
    const n = eventsThrough(this.events, t);
    const stats = computeStats(this.events.slice(0, n), this.config, t);
    this.cache.set(t, stats);
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value as number);
    return stats;
  }
}

/**
 * The scorecards as they stood at `tick`: only rounds already scored, totals
 * summed from those rounds (the official totals only once the bout is over).
 */
export function scorecardAt(
  events: readonly SimEvent[], judgeTotals: readonly number[][], hidden: boolean, tick: number, ended: boolean,
): ScorecardModel {
  const n = eventsThrough(events, tick);
  return scorecardModel(n === events.length ? events : events.slice(0, n), ended ? judgeTotals : [], hidden);
}
