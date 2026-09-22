/**
 * DECISION POLICY — the interface between the tick loop and chapter 07.
 *
 * The loop knows nothing about game plans, opponent models or utility scores.
 * It calls `decide()` once per fighter in phase P3, in ascending id order, and
 * commits whatever comes back. Everything about *how* the choice is made lives
 * in `src/sim/ai/`.
 *
 * Two constraints the loop enforces on every policy:
 *
 *  1. **Fixed draw count.** A policy must consume exactly `DRAWS_PER_DECIDE`
 *     draws from the bout RNG every time it is called, whether or not the
 *     branch that would use them is active. The stream position after P3 is
 *     then a pure function of state, which is what makes a replay reproduce.
 *     (docs/design/09 §2.7: 8 draws per fighter, 9 in multi-opponent modes.)
 *
 *  2. **Delayed information only.** The policy is handed the fighter's
 *     `ObservedState` from its perception buffer, not the live world. Reading
 *     the world directly would let a fighter react to a punch before it lands.
 */
import type { ObservedState } from './perception';
import type { World, FighterWorldState } from './world';
import type { DefenceId, SubmissionId, TechniqueId } from './ids';
import type { RNG } from '../rng';

/** Draws every policy must consume per fighter per tick. */
export const DRAWS_PER_DECIDE = 8;
/** One extra draw for target switching when more than two fighters are live. */
export const DRAWS_PER_DECIDE_MULTI = 9;
/** Draws the loop itself takes per live fighter in P5 (the steering jitter). */
export const DRAWS_PER_MOVE = 1;

export type DecisionKind =
  | 'strike' | 'grapple' | 'submission' | 'defend' | 'move' | 'wait';

export interface Decision {
  kind: DecisionKind;
  /** Technique, grappling edge or submission id, depending on `kind`. */
  what: string | null;
  targetId: number | null;
  /** Defensive posture held while this action runs. */
  defence: DefenceId;
  /** Desired movement in world space, m/s; the loop steers toward it in P5. */
  moveX: number;
  moveZ: number;
  /** Short id for the HUD, commentary and the game-plan panel. */
  intentTag: string;
  /** Optional structured payload for the resolving module. */
  payload?: unknown;
}

export interface DecisionContext {
  world: World;
  self: FighterWorldState;
  /** Perception-delayed view. The policy may not read `world.fighters` state. */
  observed: ObservedState | null;
  rng: RNG;
  tick: number;
  nowMs: number;
}

export interface DecisionPolicy {
  /** Called once pre-bout, in fighter-id order, to build plans and style jitter. */
  prepare(world: World): void;
  /** Called once per fighter per tick in P3. Must consume a fixed draw count. */
  decide(ctx: DecisionContext): Decision;
  /** Called at each break, in fighter-id order, for corner advice. */
  betweenRounds(world: World, round: number): void;
  /** Read-only view of every fighter's current plan, for the UI panel. */
  intents(world: World): readonly FighterIntent[];
}

/** What the game-plan panel shows (docs/design/07 §2.6, 09 §4.4). */
export interface FighterIntent {
  fighterId: number;
  /** Primary mode this fighter is fighting in right now. */
  mode: string;
  /** Where they want the fight. */
  phase: 'long' | 'mid' | 'close' | 'clinch' | 'ground';
  /** Plan summary lines, in the order the corner would say them. */
  planLines: string[];
  /** Adjustments currently active, with what triggered each. */
  adjustments: { id: string; trigger: string; sinceRound: number }[];
  /** This fighter's belief about the scorecards, 0-1 for "I am ahead". */
  scoreBelief: number;
  /** True when hurt or badly behind and acting accordingly. */
  emergency: boolean;
}

/**
 * A policy that stands still. Used by tests that exercise the loop without the
 * AI, and as the fallback for a fighter whose policy throws. It still consumes
 * the mandated draws so a bout that falls back stays reproducible.
 */
export class IdlePolicy implements DecisionPolicy {
  prepare(): void {
    /* nothing to prepare */
  }

  decide(ctx: DecisionContext): Decision {
    // `DRAWS_PER_DECIDE - 1`, because the loop takes `u_commit` (the §2.2
    // jitter) itself as the last of the mandated draws.
    for (let i = 0; i < DRAWS_PER_DECIDE - 1; i++) ctx.rng.next();
    return {
      kind: 'wait', what: null, targetId: null, defence: 'def.neutral',
      moveX: 0, moveZ: 0, intentTag: 'idle',
    };
  }

  betweenRounds(): void {
    /* no corner */
  }

  intents(world: World): readonly FighterIntent[] {
    return world.fighters.map((f) => ({
      fighterId: f.id, mode: 'idle', phase: 'mid' as const, planLines: [],
      adjustments: [], scoreBelief: 0.5, emergency: false,
    }));
  }
}

/** Narrow the `what` of a decision to the id type the resolver expects. */
export function asTechnique(d: Decision): TechniqueId | null {
  return d.kind === 'strike' ? (d.what as TechniqueId) : null;
}

export function asSubmission(d: Decision): SubmissionId | null {
  return d.kind === 'submission' ? (d.what as SubmissionId) : null;
}
