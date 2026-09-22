/**
 * EXECUTION QUALITY — §2.3.
 *
 * Choosing the right punch and landing the right punch are different skills.
 * This layer is the gap between them: at commit it decides how far in advance
 * the technique was readable, whether it fired on the beat, how far off the
 * intended target it lands, and which of the novice tells fire.
 *
 * Every number is keyed to the tier catalogue of chapter 01 §3 rather than
 * re-derived here. `beh.gen.eyes_close` owns the eyes-shut flinch,
 * `beh.box.cross_feet` owns the crossed feet, `beh.box.overcommit` owns the
 * lunge for power, and 01's `telegraphMod` owns the readable cue. What this
 * module adds is the *fatigue* terms (a tired fighter telegraphs more and
 * times worse) and the two RNG draws the schedule allots: `u_timing` and
 * `u_target`.
 *
 * Draw discipline: `executionQuality` takes the two uniforms as arguments and
 * never touches the generator, so it cannot move the stream.
 */
import type { TechniqueSpec, TargetRegion } from '../striking/catalogue';
import { FEET_CROSS_P } from '../striking/range';
import type { FighterRuntime } from '../fighter';
import { TELEGRAPH_MOD } from '../fighter/tiers';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number): number => clamp(v, 0, 1);
const tierIndex = (t: number): number => Math.max(0, Math.min(5, Math.round(t)));

// ---------------------------------------------------------------------------
// Parameters (§4, "execution quality")
// ---------------------------------------------------------------------------

/** `ai.exec.p_ontime.tier`. */
export const P_ONTIME_BY_TIER: readonly number[] = [0.55, 0.65, 0.75, 0.85, 0.92, 0.95];
/** `ai.exec.late_share`: of the mistimed attempts, three in four are late. */
export const LATE_SHARE = 0.75;
/** `ai.exec.p_ontime_fatigue`. */
export const P_ONTIME_FATIGUE = 0.15;
/** `ai.exec.tele_fatigue`: telegraph x (1 + 0.5 f). */
export const TELEGRAPH_FATIGUE = 0.5;
/** `ai.exec.k_accuracy`, in logit units. */
export const K_ACCURACY = 0.6;
/** `ai.exec.accuracy_fatigue`: -18 % accuracy at f = 0.8, linear. */
export const ACCURACY_FATIGUE_AT_0P8 = 0.18;
/** `ai.exec.target_error.tier`. */
export const TARGET_ERROR_BY_TIER: readonly number[] = [0.10, 0.06, 0.03, 0.015, 0.008, 0.005];
/** `ai.exec.overcommit`: p by tier, then power x1.15 and balance -0.2. */
export const OVERCOMMIT_P_BY_TIER: readonly number[] = [0.40, 0.25, 0, 0, 0, 0];
export const OVERCOMMIT_POWER = 1.15;
export const OVERCOMMIT_BALANCE = -0.2;
/** `ai.exec.eyes_closed_p` = 01 `beh.gen.eyes_close`. */
export const EYES_CLOSED_P_BY_TIER: readonly number[] = [0.70, 0.30, 0, 0, 0, 0];

/** The adjacency the target error swaps into (§2.3 "head -> body etc."). */
const ADJACENT_TARGET: Readonly<Record<TargetRegion, TargetRegion>> = Object.freeze({
  head: 'body',
  body: 'head',
  leadLeg: 'body',
  rearLeg: 'leadLeg',
  arms: 'head',
});

// ---------------------------------------------------------------------------
// Inputs and outputs
// ---------------------------------------------------------------------------

export interface ExecutionInput {
  /** The technique being committed; null for a movement or a grappling edge. */
  spec: TechniqueSpec | null;
  /** The discipline tier that governs this action (striking, wrestling, bjj). */
  tier: number;
  /** Fatigue index `f`, 0-1. */
  fatigue: number;
  /** The region the action layer asked for. */
  requestedTarget: TargetRegion;
  /** 01 `telegraphMod`, -1 .. +1; overrides the tier table when supplied. */
  telegraphMod?: number;
  /** True for a lateral movement step — the crossed-feet tell only fires there. */
  lateralStep: boolean;
  /** True when the technique is a power strike (the overcommit tell). */
  powerStrike: boolean;
}

export interface ExecutionQuality {
  /** Readable cue before launch, ms. The opponent's anticipation reads this. */
  telegraphMs: number;
  /** -1 early (on nothing), 0 on the beat, +1 late. */
  timingOffsetTicks: -1 | 0 | 1;
  /** Logit added to the strike's arrival. Never positive. */
  accuracyLogit: number;
  /** The region actually attacked; differs from the request on a target error. */
  target: TargetRegion;
  targetErrored: boolean;
  /** Multiplier on delivered power (T0-T1 overcommit). */
  powerMult: number;
  /** Balance delta applied at commit; negative for the overcommit. */
  balanceDelta: number;
  /** `state.feet_crossed` for 300 ms (§2.1.5). */
  feetCrossed: boolean;
  /** P(eyes shut) per incoming power strike — a *state*, not a roll made here. */
  eyesClosedP: number;
}

// ---------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------

/**
 * `telegraphMs(tech) + p.strike.tier.telegraphAdd[tier]` x (1 + 0.5 f).
 *
 * 01's `telegraphMod` is a -1..+1 scalar; x 600 ms gives the +150/+120/+90/0/
 * -30/-60 ms ladder the chapter quotes. The fatigue term is this section's.
 */
export function telegraphMs(input: ExecutionInput): number {
  const base = input.spec ? input.spec.telegraph : 100;
  const mod = input.telegraphMod ?? TELEGRAPH_MOD[tierIndex(input.tier)] ?? 0;
  const add = mod * 600;
  const fatigued = (base + add) * (1 + TELEGRAPH_FATIGUE * clamp01(input.fatigue));
  return Math.max(0, fatigued);
}

/** `p_ontime(tier) x (1 - 0.15 f)`. */
export function pOnTime(tier: number, fatigue: number): number {
  return clamp01(P_ONTIME_BY_TIER[tierIndex(tier)] * (1 - P_ONTIME_FATIGUE * clamp01(fatigue)));
}

/**
 * The timing roll. One uniform decides all three outcomes: on the beat below
 * `p_ontime`, then the remainder split 75/25 late/early. Early is the worse
 * error — the fighter fires on nothing and eats the counter.
 */
export function timingOffset(tier: number, fatigue: number, u: number): -1 | 0 | 1 {
  const p = pOnTime(tier, fatigue);
  if (u < p) return 0;
  const remainder = 1 - p;
  if (remainder <= 0) return 0;
  const within = (u - p) / remainder;
  return within < LATE_SHARE ? 1 : -1;
}

/** `-k_exec x (1 - p_ontime) - 0.18 x f/0.8` in logit units. */
export function accuracyLogit(tier: number, fatigue: number): number {
  const exec = -K_ACCURACY * (1 - P_ONTIME_BY_TIER[tierIndex(tier)]);
  const tired = -(ACCURACY_FATIGUE_AT_0P8 * clamp01(fatigue)) / 0.8;
  return exec + tired;
}

export function targetErrorP(tier: number): number {
  return TARGET_ERROR_BY_TIER[tierIndex(tier)];
}

/** `beh.box.cross_feet` / `p.strike.move.feetCrossP`. */
export function feetCrossP(tier: number): number {
  return FEET_CROSS_P[tierIndex(tier)] ?? 0;
}

/** `beh.gen.eyes_close`: read probability 0 for the exchange, absorb -0.15. */
export function eyesClosedP(tier: number): number {
  return EYES_CLOSED_P_BY_TIER[tierIndex(tier)];
}

// ---------------------------------------------------------------------------
// The layer
// ---------------------------------------------------------------------------

/**
 * Applied at commit, consuming exactly the two uniforms the schedule allots:
 * draw 6 `u_timing` and draw 7 `u_target`.
 *
 * `u_target` does triple duty — the target swap, the crossed feet and the
 * overcommit are mutually exclusive tells partitioned across the same uniform,
 * because the draw budget is fixed and a tell that needed its own draw would
 * break the stream. Each partition is sized by its own probability, so the
 * marginal rates are exactly the catalogue's.
 */
export function executionQuality(
  input: ExecutionInput,
  uTiming: number,
  uTarget: number,
): ExecutionQuality {
  const tier = tierIndex(input.tier);
  const f = clamp01(input.fatigue);

  const offset = timingOffset(tier, f, uTiming);

  // Partition [0, 1) for the three tells, in a fixed order.
  const pTarget = targetErrorP(tier);
  const pFeet = input.lateralStep ? feetCrossP(tier) : 0;
  const pOver = input.powerStrike ? OVERCOMMIT_P_BY_TIER[tier] : 0;

  const u = clamp01(uTarget);
  const targetErrored = u < pTarget;
  const feetCrossed = !targetErrored && u >= pTarget && u < pTarget + pFeet;
  const overcommitted = !targetErrored && !feetCrossed
    && u >= pTarget + pFeet && u < pTarget + pFeet + pOver;

  const target = targetErrored
    ? ADJACENT_TARGET[input.requestedTarget]
    : input.requestedTarget;

  return {
    telegraphMs: telegraphMs(input),
    timingOffsetTicks: offset,
    accuracyLogit: accuracyLogit(tier, f),
    target,
    targetErrored,
    powerMult: overcommitted ? OVERCOMMIT_POWER : 1,
    balanceDelta: overcommitted ? OVERCOMMIT_BALANCE : 0,
    feetCrossed,
    eyesClosedP: eyesClosedP(tier),
  };
}

/**
 * The discipline tier that governs execution for an action: striking when a
 * strike, wrestling in the clinch and on entries, bjj on the ground.
 */
export function executionTierFor(
  rt: FighterRuntime,
  kind: 'strike' | 'grapple' | 'submission' | 'move' | 'defend' | 'wait',
): number {
  switch (kind) {
    case 'strike': return rt.strikingTier;
    case 'grapple': return rt.disciplines.wrestling.tier;
    case 'submission': return rt.disciplines.bjj.tier;
    default: return rt.mmaTier;
  }
}
