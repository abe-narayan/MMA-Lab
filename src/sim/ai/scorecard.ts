/**
 * SCORECARD AWARENESS — fighters estimate the cards like a corner does
 * (Realism pass; 07 §2.6.3 SC-0..SC-5 made live).
 *
 * Until this pass the "true running card" the belief was built around read a
 * field (`runningRoundsUp`) that nothing ever wrote, so every fighter's belief
 * was zero plus noise: nobody knew whether he was ahead, trailing fighters did
 * not press and leaders did not protect (CALIBRATION §2 S4: R3 output of the
 * fighter behind +4 % against a +15 % floor; the audit found the belief's sign
 * right 48 % of the time).
 *
 * The model, in the order a fighter lives it:
 *
 * 1. At each bell he scores the round he just fought from what he could see:
 *    strikes landed both ways, knockdowns, takedowns, control, damage — the
 *    same effective-scoring quantities the judges weigh (06 §2.4.2), read
 *    through the unified-rules weights, plus perception error. The error is
 *    his fight IQ's (SC-1 sigma by tier) halved by his corner's view (§2.6.6),
 *    and it is one draw per break (the existing `uScore`), so the schedule is
 *    unchanged. Under open scoring (SC-0) he is simply told the cards.
 * 2. His belief is a *soft* count of rounds up: each round contributes
 *    `2 P(I won it) - 1`, so a clear round counts ~1 and a coin-flip ~0.
 * 3. During a round he knows roughly how the current round is going — the
 *    same visible quantities, running — with no noise (he felt every punch).
 * 4. From belief, current-round lead, rounds left and time left comes one
 *    urgency number: positive presses (pace, risk, the finish), negative
 *    protects (risk down, pace a little down, control for grapplers).
 *
 * Research anchors: FIGHT_DATA §3 #129 / 09 §7.2 S4 (R3 attempts of the
 * fighter behind after R2 >= +15 % over his own R2; TD attempts of the
 * fighter behind -38 % vs the leader, sub attempts -49 % — leaders are the
 * grapplers who built the lead); LIT_B §3.3 (Miarka: less low-intensity
 * standing time in R3, pace rises late); LIT_B §3.5 (Holmes: round-win
 * marginal effects, which the margin reads through 06's weights).
 */
import type { RoundLedger } from '../rules/judges';
import { effectiveScore, mmaWeights } from '../rules/judges';

/** SC-1 perception sigma in *margin* units (06 effective score), by IQ tier. */
export const SCORE_MARGIN_SIGMA_BY_IQ: readonly number[] = [Infinity, 1.10, 0.80, 0.60, 0.40, 0.30];
/** The corner's view halves the fighter's own error (§2.6.6 CORNER_SIGMA_MULT). */
export const CORNER_VIEW_MULT = 0.6;
/** Effective-score margin at which a round is "clearly" won: P(won) = sigmoid(m / scale). */
export const ROUND_MARGIN_SCALE = 0.45;

export interface ScoreBelief {
  /** Soft rounds-up count over completed rounds (negative = behind). */
  roundsUp: number;
  /** Per completed round, P(I won it) as perceived. */
  perRound: number[];
}

export function newScoreBelief(): ScoreBelief {
  return { roundsUp: 0, perRound: [] };
}

const sig = (x: number): number => 1 / (1 + Math.exp(-x));
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

let WEIGHTS: ReturnType<typeof mmaWeights> | null = null;
function weights(): ReturnType<typeof mmaWeights> {
  if (WEIGHTS === null) WEIGHTS = mmaWeights();
  return WEIGHTS;
}

/** The visible effective-score margin of one round, self minus opponent. */
export function visibleMargin(self: RoundLedger, opp: RoundLedger, roundS: number): number {
  const w = weights();
  return effectiveScore(self, w, roundS) - effectiveScore(opp, w, roundS);
}

/**
 * Fold a finished round into the belief. `z` is a standard normal (one per
 * break); `trueWon` is the fighter's share of the panel's round (0, 0.5, 1)
 * when scoring is open.
 */
export function scoreRound(
  b: ScoreBelief, margin: number, iqTier: number, z: number,
  open: { trueWon: number } | null,
): void {
  let p: number;
  if (open) {
    p = open.trueWon;
  } else {
    const t = clamp(Math.round(iqTier), 0, 5);
    const sigma = SCORE_MARGIN_SIGMA_BY_IQ[t];
    if (!Number.isFinite(sigma)) {
      // T0 has no estimate at all (SC-1): every round is a coin flip to him.
      p = 0.5;
    } else {
      p = sig((margin + sigma * CORNER_VIEW_MULT * z) / ROUND_MARGIN_SCALE);
    }
  }
  b.perRound.push(p);
  b.roundsUp += 2 * p - 1;
}

/** How the current round is going, -1 .. 1 (no noise: he felt it). */
export function currentRoundLead(margin: number): number {
  return Math.tanh(margin / (2 * ROUND_MARGIN_SCALE));
}

export interface UrgencyInput {
  /** Soft rounds up before this round. */
  roundsUp: number;
  /** Current round lead, -1 .. 1. */
  lead: number;
  round: number;
  rounds: number;
  /** Seconds elapsed in this round / round length. */
  elapsedFrac: number;
  iqTier: number;
  /** 01 `whenLosing` / `losingBehaviour`: 'hold' disables pressing. */
  holdWhenLosing: boolean;
}

export interface Urgency {
  /** 0..1: need to win this round or more (press). */
  press: number;
  /** 0..1: need a finish (the cards are gone). */
  desperation: number;
  /** 0..1: comfortably ahead (protect the lead). */
  protect: number;
}

export const NO_URGENCY: Urgency = Object.freeze({ press: 0, desperation: 0, protect: 0 });

/**
 * The urgency of this moment. Final round: the card decides — behind by a
 * round or more he must win the round (press), behind by two he needs the
 * finish (desperation), ahead by more than a round he protects; the effect
 * builds as the clock runs. Earlier rounds: only a round being lost late
 * produces pressing ("steal the round"), and a round being won late a little
 * protection. T0 fighters have no card awareness (SC-1).
 */
export function urgency(x: UrgencyInput): Urgency {
  if (x.iqTier <= 0 || x.rounds <= 1) return NO_URGENCY;
  const t = clamp(x.elapsedFrac, 0, 1);
  const finalRound = x.round >= x.rounds;
  const lead = clamp(x.lead, -1, 1);
  if (finalRound) {
    // Projected rounds up if the current round ends as it is going.
    const projected = x.roundsUp + lead * (0.35 + 0.65 * t);
    const behind = -projected;
    // Pressing starts as soon as the projection is a loss or a coin flip, and
    // grows with the clock: a fighter down on the cards in the last minute
    // throws everything.
    const press = clamp((behind + 0.4) / 1.2, 0, 1) * (0.55 + 0.45 * t);
    const desperation = clamp((-x.roundsUp - 1.2) / 0.8, 0, 1) * (0.4 + 0.6 * t);
    const protect = clamp((projected - 0.8) / 1.0, 0, 1) * (0.5 + 0.5 * t);
    return {
      press: x.holdWhenLosing ? 0 : press,
      desperation: x.holdWhenLosing ? 0 : desperation,
      protect,
    };
  }
  // Non-final rounds: the last ~90 s of a round being lost or won.
  const late = clamp((t - 0.7) / 0.3, 0, 1);
  return {
    press: x.holdWhenLosing ? 0 : clamp(-lead, 0, 1) * late * 0.6,
    desperation: 0,
    protect: clamp(lead - 0.3, 0, 1) * late * 0.4,
  };
}

/** Effects of urgency on the plan's levers [E: Realism pass, tuned to S4]. */
export const URGENCY_EFFECT = Object.freeze({
  /** Strike pace multiplier: 1 + press x p - protect x q. */
  pacePress: 0.30,
  paceDesperation: 0.25,
  paceProtect: 0.12,
  /** Risk appetite shift (c.risk, -2..2). */
  riskPress: 1.0,
  riskDesperation: 1.5,
  riskProtect: 1.0,
  /** Takedown hazard: grapplers behind shoot more, strikers behind less. */
  tdPressGrappler: 0.5,
  tdPressStriker: -0.35,
  tdProtectGrappler: 0.35,
  tdProtectStriker: -0.4,
  /** Submission hazard when a finish is needed / when protecting a lead. */
  subDesperation: 0.8,
  subProtect: -0.4,
});
