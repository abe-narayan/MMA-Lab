/**
 * PERCEPTION — what a fighter is allowed to know when they decide.
 *
 * The old engine let every fighter read the exact current world state, so a
 * decision could respond to a punch that had not arrived yet. Real fighters
 * act on information that is one reaction time old, and the research is clear
 * that expertise shows up as *anticipation* (reading a setup before it
 * completes) rather than a faster simple reaction: elite and novice simple
 * reaction times barely differ, while read accuracy differs a lot
 * (LIT_B: 83% vs 69%).
 *
 * So this module does two things:
 *   1. delays the world: each fighter decides from an `ObservedState` pushed
 *      into a ring buffer `lagTicks` ago;
 *   2. leaves the *reading* of cues to chapter 07, which gets both the delayed
 *      state and the opponent's committed-but-not-landed action, gated by a
 *      read probability that does scale with tier.
 *
 * See docs/design/09 §2.5 and chapter 02 §2.4.
 */
import type { PositionId, TechniqueId } from './ids';

/** The compact view of one fighter that opponents may read. */
export interface ObservedFighter {
  id: number;
  team: number;
  x: number;
  z: number;
  facing: number;
  vx: number;
  vz: number;
  posture: 'standing' | 'clinch' | 'ground' | 'down' | 'out';
  position: PositionId;
  /** What they are visibly committed to right now, if anything. */
  action: TechniqueId | 'idle' | 'move';
  /** How far through that commitment, 0-1 — the cue a reader works from. */
  actionPhase: number;
  stance: 'orthodox' | 'southpaw';
  /** Visible condition cues, not the true pools: what a cornerman could see. */
  visiblyHurt: boolean;
  visiblyTired: boolean;
  handsDropped: boolean;
  balance: number;
}

export interface ObservedState {
  tick: number;
  fighters: ObservedFighter[];
}

/**
 * Fixed-capacity ring buffer of recent world states. Capacity is small (the
 * longest lag is a handful of ticks) and allocation happens once, because this
 * runs every tick of every bout in a calibration batch of thousands.
 */
export class PerceptionBuffer {
  private readonly frames: (ObservedState | null)[];
  private head = -1;

  constructor(readonly capacity: number) {
    this.frames = new Array<ObservedState | null>(capacity).fill(null);
  }

  push(state: ObservedState): void {
    this.head = (this.head + 1) % this.capacity;
    this.frames[this.head] = state;
  }

  /**
   * The state as it was `lagTicks` ago. Falls back to the oldest available
   * frame during the first ticks of a bout, so a fighter is never handed the
   * true current state by accident.
   */
  delayed(lagTicks: number): ObservedState | null {
    if (this.head < 0) return null;
    const back = Math.max(0, Math.min(lagTicks, this.capacity - 1));
    for (let k = back; k < this.capacity; k++) {
      const idx = (this.head - k + this.capacity * 2) % this.capacity;
      const f = this.frames[idx];
      if (f) return f;
    }
    return this.frames[this.head];
  }

  get latest(): ObservedState | null {
    return this.head < 0 ? null : this.frames[this.head];
  }

  clear(): void {
    this.frames.fill(null);
    this.head = -1;
  }
}

/**
 * Perception lag in ticks for a given reaction-time attribute.
 *
 * Chapter 01 converts the 0-100 `reactionTime` attribute into a latency in ms;
 * this rounds it to whole ticks for the buffer. The ladder in chapter 07
 * (300/200/100 ms) is the coarse version of the same thing — a slow fighter is
 * three ticks behind the world, a fast one is one.
 */
export function lagTicks(reactionLatencyMs: number, dtMs: number): number {
  return Math.max(0, Math.round(reactionLatencyMs / dtMs));
}
