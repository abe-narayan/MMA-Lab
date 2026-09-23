/**
 * COMMENTARY — public shapes (docs/design/09 §5.1).
 *
 * A `CommentaryLine` is the whole output contract: a tick, a voice, a priority
 * and a rendered sentence. Nothing here imports React, the DOM or a wall clock,
 * and nothing here draws from the bout RNG — `generateCommentary` forks its own
 * stream from the seed, so commentary can never move a bout (09 §5.1).
 */
import type { SimEventKind } from '../record/events';
import type { FighterIntent } from '../core/policy';

export type CommentaryVoice = 'pbp' | 'colour';

/** 3 = finish/KD/stoppage, 2 = TD/sub/foul/strategy, 1 = sig strike, 0 = texture. */
export type CommentaryPriority = 0 | 1 | 2 | 3;

export interface CommentaryLine {
  tick: number;
  /** Intra-tick offset, copied from the source event so order is total. */
  subMs: number;
  /** Simulated seconds; `tick * dt`. */
  t: number;
  round: number;
  voice: CommentaryVoice;
  priority: CommentaryPriority;
  text: string;
  /** Template key plus semantic tags, for filtering and for the tests. */
  tags: readonly string[];
  /** Fighter this line is about, or -1. */
  actor: number;
  /** The other fighter, or -1. */
  target: number;
}

/** One `Sim.intents()` reading, tagged with the tick it was taken at. */
export interface IntentSample {
  tick: number;
  intents: readonly FighterIntent[];
}

export interface CommentaryOptions {
  /**
   * Base seed for the phrasing stream. Defaults to the run's own seed; the
   * stream is always `new RNG(seed + '|commentary')`, never the bout's.
   */
  seed?: string;
  /** Optional live readings of the game plan, for the colour register. */
  intents?: readonly IntentSample[];
  /**
   * `street` switches to the restrained register of 09 §5.4: consequence and
   * flight, no glorification. Defaults from `run.config.mode`.
   */
  register?: 'broadcast' | 'street';
  /** Max play-by-play lines per second. Default 1/1.5 (09 §5.4). */
  pbpPerSecond?: number;
  /** Seconds without a landed significant strike that count as a lull. */
  lullSeconds?: number;
  /** Per-key cooldown so the same sentence does not repeat. Default 20 s. */
  keyCooldownSeconds?: number;
  /** Minimum gap between stat drops. Default 60 s. */
  statDropSeconds?: number;
  /** Lines per round break. Default 3. */
  breakBudget?: number;
  /** Streaming mode: only emit lines whose tick is in `(fromTick, toTick]`. */
  fromTick?: number;
  toTick?: number;
  /** Language pack id. Only `en` ships. */
  language?: 'en';
}

/** Every event kind the generator has at least one template family for. */
export const COMMENTABLE_KINDS: ReadonlySet<SimEventKind> = new Set<SimEventKind>([
  'boutStart', 'roundStart', 'roundEnd', 'boutEnd', 'decision',
  'strike', 'feint', 'read',
  'takedown', 'clinch', 'clinchBreak', 'positionChange', 'scramble', 'reversal',
  'standUp', 'engagementJoin', 'disengage', 'slam',
  'submissionStage', 'submissionFinish',
  'knockdown', 'rocked', 'stateChange', 'injury',
  'refereeWarning', 'refereeCount', 'standingEight', 'refereeBreak', 'refereeTimeout',
  'foul', 'deduction', 'refereeStoppage', 'doctorCheck', 'cornerStop', 'timidityWarning',
  'fighterOut', 'scorecardRound', 'pointsAwarded', 'judoScore',
  'planSet', 'intentChange', 'adjustment', 'cornerCue', 'scoreUpdate',
  'paceShift', 'stanceSwitch', 'targetSwitch', 'roleAssign', 'trap', 'emergency',
  'flight', 'streetEnd',
]);
