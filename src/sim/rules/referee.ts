/**
 * THE REFEREE — tick-level officiating.
 *
 * docs/design/06 §2.3, implemented as a class because a referee is stateful:
 * he remembers warnings, he is mid-count, he has already committed to stopping
 * a fight 0.6 s from now. Everything he decides is a pure function of
 * `RefObservables` (chapter 05), the ruleset and the injected RNG — never of
 * hidden damage pools, never of the wall clock.
 *
 * The one idea that makes the whole thing behave like a real official is the
 * **reaction lag**. A criterion becoming true does not stop the fight. It makes
 * the referee *commit* to stopping it at `t0 + lag`; strikes keep landing in
 * between, which is where FD #110's 3.5 s and FD #49's 2.6 extra head strikes
 * come from. If the fighter starts defending intelligently before the commit
 * time, the pending stoppage is cancelled — that is "let them work", and it is
 * the reason a fighter can survive a bad moment.
 *
 * Determinism: draws are taken in the order docs/design/09 §2.7 fixes for phase
 * P6, and every branch that can draw does draw, so the stream position after
 * the referee phase is a pure function of state.
 */
import type { RNG } from '../rng';
import { param as p } from './params';
import type { RefereeEvent } from '../record/events';
import type {
  FoulId, FoulRule, Ruleset, Strictness, WinCondition,
} from './types';
import type { RefObservables } from './observables';
import { worstCut, worstVision } from './observables';

// ---------------------------------------------------------------------------
// Strictness presets (§2.3.12)
// ---------------------------------------------------------------------------

export type RefereeExperience = 'regional' | 'standard' | 'elite';

export interface RefereeConfig {
  strictnessScalar: number;
  // stoppage thresholds
  tkoUnansweredGround: number;
  tkoUnansweredStanding: number;
  tkoNoDefenceS: number;
  tkoAbsorbed30: number;
  defenceQualityCeiling: number;
  collapseGraceS: number;
  legCollapseGraceS: number;
  secondKdWindowS: number;
  // reaction lag
  refReactionS: number;
  travelSPerM: number;
  travelMinS: number;
  travelMaxS: number;
  pLagTail: number;
  lagTailMeanS: number;
  koRecognitionS: number;
  finishingHeadStrikeRateHz: number;
  tapDetectS: number;
  tapDetectSigma: number;
  locDetectS: number;
  // counts
  gaitPassBase: number;
  gaitSlopeLogit: number;
  gaitStrictnessLogit: number;
  standingEightUnanswered: number;
  neutralCornerS: number;
  slipRiseCommands: number;
  // stand-ups and breaks
  standupWarnS: number;
  standupS: number;
  standupHazardPerS: number;
  effortAttemptCooldownS: number;
  clinchBreakS: number;
  clinchBreakOpenMult: number;
  kbClinchMaxS: number;
  boxingBreakS: number;
  mtClinchInactiveS: number;
  boxingHoldingWarnings: number;
  // fouls
  timidityWarnS: number;
  warningsBeforeDeduction: number;
  pDeductAccidentalRepeat: number;
  deductionIntentional: number;
  dqAfterDeductions: number;
  warningsBeforeIntentional: number;
  groundedJudgement: number;
  pDetectContactFoul: number;
  pDetectFenceGrab: number;
  pDetectBackOfHead: number;
  pProtestTimeout: number;
  hornGraceS: number;
  // doctor and corner
  cutDoctorCall: number;
  pDoctorStopOrbit: number;
  pDoctorStopVision: number;
  pDoctorStopOther: number;
  doctorExamMinS: number;
  doctorExamMaxS: number;
  doctorVisionStop: number;
  doctorLeniency: number;
  roundNearlyOverS: number;
  cornerCheckFraction: number;
  cornerTowelBase: number;
  cornerProtectivenessSlope: number;
  cornerTitlePenalty: number;
  inspectorDelayMinS: number;
  inspectorDelayMaxS: number;
  mtOutmatchedRatio: number;
  bellReadyConsciousness: number;
  // grappling / judo
  ibjjfStallingS: number;
  judoMateMinS: number;
  judoMateMaxS: number;
  judoAttackClockS: number;
}

/** The standard column is the parameter registry; the other two are §2.3.12. */
function standardConfig(): RefereeConfig {
  return {
    strictnessScalar: p('ref.strictnessScalar'),
    tkoUnansweredGround: p('ref.tkoUnansweredGround'),
    tkoUnansweredStanding: p('ref.tkoUnansweredStanding'),
    tkoNoDefenceS: p('ref.tkoNoDefenceS'),
    tkoAbsorbed30: p('ref.tkoAbsorbed30'),
    defenceQualityCeiling: p('ref.defenceQualityCeiling'),
    collapseGraceS: p('ref.collapseGraceS'),
    legCollapseGraceS: p('ref.legCollapseGraceS'),
    secondKdWindowS: p('ref.secondKdWindowS'),
    refReactionS: p('ref.refReactionS'),
    travelSPerM: p('ref.travelSPerM'),
    travelMinS: p('ref.travelMinS'),
    travelMaxS: p('ref.travelMaxS'),
    pLagTail: p('ref.pLagTail'),
    lagTailMeanS: p('ref.lagTailMeanS'),
    koRecognitionS: p('ref.koRecognitionS'),
    finishingHeadStrikeRateHz: p('ref.finishingHeadStrikeRateHz'),
    tapDetectS: p('ref.tapDetectS'),
    tapDetectSigma: p('ref.tapDetectSigma'),
    locDetectS: p('ref.locDetectS'),
    gaitPassBase: p('ref.gaitPassBase'),
    gaitSlopeLogit: p('ref.gaitSlopeLogit'),
    gaitStrictnessLogit: p('ref.gaitStrictnessLogit'),
    standingEightUnanswered: p('ref.standingEightUnanswered'),
    neutralCornerS: p('ref.neutralCornerS'),
    slipRiseCommands: p('ref.slipRiseCommands'),
    standupWarnS: p('ref.standupWarnS'),
    standupS: p('ref.standupS'),
    standupHazardPerS: p('ref.standupHazardPerS'),
    effortAttemptCooldownS: p('ref.effortAttemptCooldownS'),
    clinchBreakS: p('ref.clinchBreakS'),
    clinchBreakOpenMult: p('ref.clinchBreakOpenMult'),
    kbClinchMaxS: 1,          // standard: one knee, then break
    boxingBreakS: p('ref.boxingBreakS'),
    mtClinchInactiveS: p('ref.mtClinchInactiveS'),
    boxingHoldingWarnings: p('ref.boxingHoldingWarnings'),
    timidityWarnS: p('ref.timidityWarnS'),
    warningsBeforeDeduction: p('ref.warningsBeforeDeduction'),
    pDeductAccidentalRepeat: p('ref.pDeductAccidentalRepeat'),
    deductionIntentional: p('rules.foul.deductionIntentional'),
    dqAfterDeductions: p('ref.dqAfterDeductions'),
    warningsBeforeIntentional: p('ref.warningsBeforeIntentional'),
    groundedJudgement: p('ref.groundedJudgement'),
    pDetectContactFoul: p('ref.pDetectContactFoul'),
    pDetectFenceGrab: p('ref.pDetectFenceGrab'),
    pDetectBackOfHead: p('ref.pDetectBackOfHead'),
    pProtestTimeout: p('ref.pProtestTimeout'),
    hornGraceS: p('ref.hornGraceS'),
    cutDoctorCall: p('ref.cutDoctorCall'),
    pDoctorStopOrbit: p('ref.pDoctorStopOrbit'),
    pDoctorStopVision: p('ref.pDoctorStopVision'),
    pDoctorStopOther: p('ref.pDoctorStopOther'),
    doctorExamMinS: p('ref.doctorExamMinS'),
    doctorExamMaxS: p('ref.doctorExamMaxS'),
    doctorVisionStop: p('ref.doctorVisionStop'),
    doctorLeniency: 0,
    roundNearlyOverS: p('ref.roundNearlyOverS'),
    cornerCheckFraction: p('ref.cornerCheckFraction'),
    cornerTowelBase: p('ref.cornerTowelBase'),
    cornerProtectivenessSlope: p('ref.cornerProtectivenessSlope'),
    cornerTitlePenalty: p('ref.cornerTitlePenalty'),
    inspectorDelayMinS: p('ref.inspectorDelayMinS'),
    inspectorDelayMaxS: p('ref.inspectorDelayMaxS'),
    mtOutmatchedRatio: p('ref.mtOutmatchedRatio'),
    bellReadyConsciousness: p('ref.bellReadyConsciousness'),
    ibjjfStallingS: p('rules.ibjjf.stallingS'),
    judoMateMinS: p('ref.judoMateMinS'),
    judoMateMaxS: p('ref.judoMateMaxS'),
    judoAttackClockS: p('rules.judo.attackClockS'),
  };
}

/**
 * Lenient and strict columns of §2.3.12. Where the chapter gives a formula
 * rather than a column (`N x (1.4 - 0.8 S)` [S: DMG §5.1]) it is applied here
 * instead of inventing a number.
 */
function scaleByStrictness(n: number, scalar: number): number {
  return n * (1.4 - 0.8 * scalar);
}

export const STRICTNESS_PRESETS: Record<Strictness, RefereeConfig> = (() => {
  const standard = standardConfig();
  const lenient: RefereeConfig = {
    ...standard,
    strictnessScalar: 0.2,
    tkoUnansweredGround: 6,
    tkoUnansweredStanding: 8,
    tkoNoDefenceS: 3.0,
    tkoAbsorbed30: 24,
    collapseGraceS: 8,
    legCollapseGraceS: scaleByStrictness(standard.legCollapseGraceS, 0.2),
    refReactionS: 1.2,
    pLagTail: 0.35,
    lagTailMeanS: 2.0,
    cutDoctorCall: 0.75,
    pDoctorStopOrbit: 0.6,
    pDoctorStopVision: 0.5,
    standupWarnS: 45,
    standupS: 75,
    clinchBreakS: 40,
    kbClinchMaxS: 5,                 // lenient: 5 s if the clinch is effective
    boxingHoldingWarnings: 3,
    warningsBeforeDeduction: 2,
    pDeductAccidentalRepeat: 0.3,
    dqAfterDeductions: 4,
    timidityWarnS: 60,
    groundedJudgement: 0.70,
    gaitStrictnessLogit: -0.85,
    mtOutmatchedRatio: 6,
    pDetectContactFoul: 0.75,
    pDetectFenceGrab: 0.70,
    pDetectBackOfHead: 0.60,
    warningsBeforeIntentional: 3,
    standingEightUnanswered: 4,
  };
  const strict: RefereeConfig = {
    ...standard,
    strictnessScalar: 0.8,
    tkoUnansweredGround: 3,
    tkoUnansweredStanding: 4,
    tkoNoDefenceS: 1.2,
    tkoAbsorbed30: 14,
    collapseGraceS: 4,
    legCollapseGraceS: scaleByStrictness(standard.legCollapseGraceS, 0.8),
    refReactionS: 0.5,
    pLagTail: 0.20,
    lagTailMeanS: 1.0,
    cutDoctorCall: 0.45,
    pDoctorStopOrbit: 0.95,
    pDoctorStopVision: 0.85,
    standupWarnS: 15,
    standupS: 30,
    clinchBreakS: 12,
    kbClinchMaxS: 0,                 // strict: one knee, immediate break
    boxingHoldingWarnings: 1,
    warningsBeforeDeduction: 0,
    pDeductAccidentalRepeat: 0.9,
    dqAfterDeductions: 2,
    timidityWarnS: 25,
    groundedJudgement: 0.97,
    gaitStrictnessLogit: 1.4,
    mtOutmatchedRatio: 3,
    pDetectContactFoul: 0.95,
    pDetectFenceGrab: 0.95,
    pDetectBackOfHead: 0.90,
    warningsBeforeIntentional: 1,
    standingEightUnanswered: 2,
  };
  return { lenient, standard, strict };
})();

/**
 * A referee's working config. The experience overlay is separate from
 * strictness: a regional official is not more lenient, he is *slower* and more
 * variable (+0.3 s reaction, +0.1 tail probability); an elite one is 0.1 s
 * quicker. [E]
 */
export function refereeConfig(
  strictness: Strictness,
  experience: RefereeExperience = 'standard',
  doctorLeniency = 0,
): RefereeConfig {
  const base = { ...STRICTNESS_PRESETS[strictness] };
  if (experience === 'regional') {
    base.refReactionS += p('ref.experienceRegionalReactionS');
    base.pLagTail = Math.min(1, base.pLagTail + p('ref.experienceRegionalTailP'));
  } else if (experience === 'elite') {
    base.refReactionS = Math.max(0.1, base.refReactionS - p('ref.experienceEliteReactionS'));
  }
  // The doctor's own leniency shifts every doctor-stop probability by +-15 %.
  base.doctorLeniency = Math.max(-1, Math.min(1, doctorLeniency));
  return base;
}

// ---------------------------------------------------------------------------
// Reaction lag (§2.3.2)
// ---------------------------------------------------------------------------

/** Default referee-to-fighter distance, chosen so mean travel is 1.2 s [E]. */
export const DEFAULT_REF_DISTANCE_M = 3.0;

function travelS(cfg: RefereeConfig, distanceM: number): number {
  return Math.max(cfg.travelMinS, Math.min(cfg.travelMaxS, cfg.travelSPerM * distanceM));
}

/**
 * One reaction lag. Always consumes exactly two draws so the RNG stream does
 * not depend on whether the heavy tail fired.
 */
export function sampleReactionLag(
  rng: RNG, cfg: RefereeConfig, distanceM = DEFAULT_REF_DISTANCE_M,
): number {
  const u1 = rng.next();
  const u2 = rng.next();
  // The tail is what produces the stoppages viewers hate. Hutchison observed
  // 0-20 s; an exponential tail on 30 % of stoppages reproduces the shape.
  const tail = u1 < cfg.pLagTail ? -cfg.lagTailMeanS * Math.log(Math.max(u2, 1e-12)) : 0;
  return cfg.refReactionS + travelS(cfg, distanceM) + tail;
}

/** Mean of `sampleReactionLag` in closed form. */
export function expectedReactionLagS(
  cfg: RefereeConfig, distanceM = DEFAULT_REF_DISTANCE_M,
): number {
  return cfg.refReactionS + travelS(cfg, distanceM) + cfg.pLagTail * cfg.lagTailMeanS;
}

/**
 * KO blow -> stoppage, the quantity FD #110 measures at 3.5 s. The referee
 * model supplies 2.45 s of it; the last ~1.05 s is chapter 05's KO criterion
 * lagging the punch (the fall and the limp animation).            [S: FD #110]
 */
export function expectedKoStoppageLagS(
  cfg: RefereeConfig, distanceM = DEFAULT_REF_DISTANCE_M,
): number {
  return expectedReactionLagS(cfg, distanceM) + cfg.koRecognitionS;
}

/** Extra head strikes landed during that lag. Target 2.6 +- 1.   [S: FD #49] */
export function expectedExtraHeadStrikes(
  cfg: RefereeConfig, distanceM = DEFAULT_REF_DISTANCE_M,
): number {
  return expectedKoStoppageLagS(cfg, distanceM) * cfg.finishingHeadStrikeRateHz;
}

/** Tap detection: LogNormal around a 0.3 s median. Two draws, like the above. */
export function sampleTapLag(rng: RNG, cfg: RefereeConfig): number {
  return cfg.tapDetectS * Math.exp(cfg.tapDetectSigma * rng.normal());
}

// ---------------------------------------------------------------------------
// Fouls: occurrence and detection (§2.3.6a, §2.3.6b) — drawn in phase P4
// ---------------------------------------------------------------------------

export type FoulActionId =
  | 'straight_punch' | 'long_guard_per_s' | 'front_kick_knee_body' | 'round_kick_body'
  | 'head_strike_vs_turning' | 'gnp_on_turtle' | 'knee_head_near_grounded'
  | 'head_kick_vs_rising' | 'sprawl_at_fence' | 'clinch_at_fence' | 'guard_pass'
  | 'scramble_handfight' | 'slam_inverted' | 'strike_near_horn' | 'clinch_entry'
  | 'boxing_tieup' | 'boxing_body_punch' | 'boxing_hook_vs_turning'
  | 'judo_throw_low_tier' | 'judo_throw_high_tier';

export interface FoulAction {
  foul: FoulId;
  pBase: number;
  intent: 'accidental' | 'intentional' | 'by_context';
  /** Scaled by (1 - ref.groundedJudgement): the referee misreading the status. */
  scaledByGroundedJudgement?: boolean;
}

/** §2.3.6(a). `pBase` is per attempt unless the id says "per_s". */
export const FOUL_ACTIONS: Record<FoulActionId, FoulAction> = {
  straight_punch: { foul: 'fingers_extended', pBase: p('foul.pEyePokeStraight'), intent: 'accidental' },
  long_guard_per_s: { foul: 'fingers_extended', pBase: p('foul.pEyePokeLongGuardPerS'), intent: 'accidental' },
  front_kick_knee_body: { foul: 'groin', pBase: p('foul.pGroinFrontKickKnee'), intent: 'accidental' },
  round_kick_body: { foul: 'groin', pBase: p('foul.pGroinRoundKick'), intent: 'accidental' },
  head_strike_vs_turning: { foul: 'back_of_head', pBase: p('foul.pBackOfHeadTurn'), intent: 'accidental' },
  gnp_on_turtle: { foul: 'back_of_head', pBase: p('foul.pBackOfHeadTurtle'), intent: 'accidental' },
  knee_head_near_grounded: {
    foul: 'grounded_head_kick_knee', pBase: p('foul.pGroundedKnee'),
    intent: 'accidental', scaledByGroundedJudgement: true,
  },
  head_kick_vs_rising: { foul: 'grounded_head_kick_knee', pBase: p('foul.pGroundedKick'), intent: 'accidental' },
  sprawl_at_fence: { foul: 'fence_grab', pBase: p('foul.pFenceGrabTdd'), intent: 'accidental' },
  clinch_at_fence: { foul: 'fence_grab', pBase: p('foul.pFenceGrabClinch'), intent: 'accidental' },
  guard_pass: { foul: 'finger_in_cut', pBase: p('foul.pFingerInCut'), intent: 'accidental' },
  scramble_handfight: { foul: 'small_joint', pBase: p('foul.pSmallJoint'), intent: 'accidental' },
  slam_inverted: { foul: 'spike', pBase: p('foul.pSpike'), intent: 'by_context' },
  strike_near_horn: { foul: 'after_bell', pBase: p('foul.pAfterBell'), intent: 'accidental' },
  clinch_entry: { foul: 'headbutt', pBase: p('foul.pHeadClashClinch'), intent: 'accidental' },
  boxing_tieup: { foul: 'holding', pBase: p('foul.pBoxingHolding'), intent: 'by_context' },
  boxing_body_punch: { foul: 'low_blow', pBase: p('foul.pLowBlow'), intent: 'accidental' },
  boxing_hook_vs_turning: { foul: 'rabbit_punch', pBase: p('foul.pRabbit'), intent: 'accidental' },
  judo_throw_low_tier: { foul: 'leg_grab_judo', pBase: p('foul.pJudoLegGrabLow'), intent: 'accidental' },
  judo_throw_high_tier: { foul: 'leg_grab_judo', pBase: p('foul.pJudoLegGrabHigh'), intent: 'accidental' },
};

const TIER_MULT = [
  p('foul.tierMult.t0'), p('foul.tierMult.t1'), p('foul.tierMult.t2'),
  p('foul.tierMult.t3'), p('foul.tierMult.t4'), p('foul.tierMult.t5'),
];

/**
 * Novices point their fingers, grab reflexively and mis-time the bell; elite
 * fighters foul less often but more deliberately.                        [E]
 */
export function foulTierMult(tier: number): number {
  const i = Math.max(0, Math.min(5, Math.round(tier)));
  return TIER_MULT[i];
}

export interface FoulContext {
  tier: number;
  /** Rocked, or fatigue >= 0.8: control goes first.                   [E] */
  rockedOrGassed?: boolean;
  /** The AI's `dirty` personality trait (chapter 07). Doubles the rate and
   *  flags the foul intentional.                                      [E] */
  dirty?: boolean;
}

/** `p = pBase x tierMult x contextMult`, clamped to a probability. */
export function foulProbability(
  action: FoulActionId, ctx: FoulContext, cfg: RefereeConfig,
): number {
  const a = FOUL_ACTIONS[action];
  let q = a.pBase * foulTierMult(ctx.tier);
  if (a.scaledByGroundedJudgement) q *= 1 - cfg.groundedJudgement;
  if (ctx.rockedOrGassed) q *= p('foul.rockedFatigueMult');
  if (ctx.dirty) q *= p('foul.dirtyMult');
  return Math.max(0, Math.min(1, q));
}

/** Detection probability by foul class (§2.3.6b). */
export function foulDetectProbability(foul: FoulId, cfg: RefereeConfig): number {
  if (foul === 'fence_grab') return cfg.pDetectFenceGrab;
  if (foul === 'back_of_head') return cfg.pDetectBackOfHead;
  return cfg.pDetectContactFoul;
}

export type FoulEffect = 'none' | 'minor' | 'substantial' | 'cannot_continue';

const EFFECT_RANK: Record<FoulEffect, number> = {
  none: 0, minor: 1, substantial: 2, cannot_continue: 3,
};

/** One foul that resolution flagged this tick. Chapter 05 fills `effect`. */
export interface FoulOccurrence {
  foul: FoulId;
  fouler: number;
  victim: number;
  intent: 'accidental' | 'intentional';
  /** Rolled in P4 by `rollFoulDetection`; undetected fouls still do damage. */
  detected: boolean;
  effect: FoulEffect;
  /** Fence grab that gained a position: the restart goes back to neutral. */
  positionGained?: boolean;
  /** Flagrant fouls end the fight on the spot regardless of the ladder. */
  flagrant?: boolean;
  /**
   * The resolver already put a `foul` event on the log for this technique
   * (I6); the referee then rules on it without logging it a second time.
   */
  announced?: boolean;
}

/**
 * The two P4 draws for a resolved action. Always draws both, so the stream is
 * independent of whether the foul happened.
 */
export function rollFoul(
  rng: RNG, action: FoulActionId, ctx: FoulContext, cfg: RefereeConfig,
): { occurred: boolean; detected: boolean; foul: FoulId; intent: 'accidental' | 'intentional' } {
  const a = FOUL_ACTIONS[action];
  const occurred = rng.next() < foulProbability(action, ctx, cfg);
  const detected = rng.next() < foulDetectProbability(a.foul, cfg);
  const intent: 'accidental' | 'intentional' =
    ctx.dirty || a.intent === 'intentional' ? 'intentional' : 'accidental';
  return { occurred, detected, foul: a.foul, intent };
}

// ---------------------------------------------------------------------------
// Stand-up position multipliers (§2.3.6b)
// ---------------------------------------------------------------------------

/**
 * How much longer the referee lets a position run before the stand-up clock
 * expires. Dominant top positions buy 50 % more time [S: BJJ R2]; standing
 * over a guard buys half, because nothing is happening and everyone can see it.
 */
export function positionMult(position: string | undefined): number {
  if (!position) return p('ref.positionMult.guard');
  if (/^pos\.ground_(mount|back|side|crucifix|north_south)/.test(position)) {
    return p('ref.positionMult.dominant');
  }
  if (/^pos\.ground_(turtle|referee|front_headlock)/.test(position)) {
    return p('ref.positionMult.turtle');
  }
  if (position === 'pos.ground_open_legs_up') return p('ref.positionMult.standingOver');
  if (/^pos\.ground_(cage_seated|wall_walk)/.test(position)) return p('ref.positionMult.cageSeated');
  return p('ref.positionMult.guard');
}

// ---------------------------------------------------------------------------
// Referee inputs and outputs
// ---------------------------------------------------------------------------

export interface RefFighterInput {
  id: number;
  obs: RefObservables;
  tier?: number;
  /** Metres from the referee. Drives the travel component of the lag. */
  refDistanceM?: number;
  /** Observable proxy for acute head damage, 0-100 (wobble / legs cues). */
  acuteHeadProxy?: number;
  /** Outside range, moving away, nothing attempted — the timidity condition. */
  nonEngaging?: boolean;
  /** Muay Thai "outmatched" clause inputs. */
  damageDealt?: number;
  damageTaken?: number;
  /** Corner stoppage inputs (§2.3.8). */
  cornerProtectiveness?: number;
  titleFight?: boolean;
  structuralHead?: number;
  fatigue?: number;
  mobility?: number;
  lostLastRoundDecisively?: boolean;
  opponentDominant?: boolean;
  /** Muay Thai: refusing to get up after a slip. */
  refusesToRise?: boolean;
}

export interface RefEngagementInput {
  kind: 'ground' | 'clinch';
  a: number;
  b: number;
  position?: string;
  /** Seconds since either fighter did anything that counts as effort. */
  sSinceEffort?: number;
  /** The bottom fighter is attacking: the referee rarely stands them up. */
  bottomActive?: boolean;
  atFence?: boolean;
  sInClinch?: number;
  strikesSinceEntry?: number;
  sSinceStrikeOrSweep?: number;
  sSinceStrikeOrTdAttempt?: number;
}

export interface RefTickInput {
  tick: number;
  /** Seconds elapsed inside the current round. */
  roundT: number;
  /** Total elapsed simulated seconds. */
  t: number;
  round: number;
  dt?: number;
  fighters: RefFighterInput[];
  engagements?: RefEngagementInput[];
  /** Fouls flagged by resolution this tick (already rolled in P4). */
  fouls?: FoulOccurrence[];
  /** Defaults to "the other fighter" for a two-man bout. */
  opponentOf?: (id: number) => number;
  /** Rounds already completed, for the NC / technical-decision threshold. */
  roundsCompleted?: number;
  /** Who is ahead on the cards, for a technical decision after a foul. */
  aheadOnCards?: number | null;
}

export type PauseKind = 'count' | 'foul' | 'doctor' | 'equipment' | null;

export interface BoutEnding {
  method: WinCondition | 'no_contest';
  winner: number | 'draw' | 'none';
  loser: number | null;
  reason: string;
  lagS?: number;
}

export interface RefereeOutcome {
  events: RefereeEvent[];
  ended: BoutEnding | null;
  paused: PauseKind;
}

type StoppageKind = 'ko' | 'tko' | 'tap' | 'loc' | 'injury' | 'collapse';

interface PendingStoppage {
  method: WinCondition;
  winner: number;
  loser: number;
  reason: string;
  kind: StoppageKind;
  commitAtS: number;
  queuedAtS: number;
  lagS: number;
}

interface FighterRecord {
  warnings: Map<FoulId, number>;
  deductionsByRound: Map<number, number>;
  totalDeductions: number;
  kdRound: number;
  kdBout: number;
  nonEngagementS: number;
  timidityWarnings: number;
  markedInjury: { byFoul: FoulId; intentional: boolean } | null;
  slipCommands: number;
  cutWatched: boolean;
  /** Worst cut severity at the last in-round doctor check (-1: never). */
  examinedCutSeverity: number;
  holdingWarnings: number;
}

interface CountState {
  fighter: number;
  count: number;
  nextAtS: number;
  standing: boolean;
  limit: number;
}

interface DoctorExam {
  fighter: number;
  endsAtS: number;
  trigger: 'laceration' | 'vision' | 'fracture' | 'foul';
}

// ---------------------------------------------------------------------------
// The referee
// ---------------------------------------------------------------------------

export interface RefereeOptions {
  rng: RNG;
  strictness?: Strictness;
  experience?: RefereeExperience;
  doctorLeniency?: number;
}

/**
 * Damaging head strikes a grounded fighter must have gone without answering
 * before a static cover counts as "not intelligently defending" [E: Phase 9].
 */
export const COVERING_MIN_UNANSWERED = 2;

/** 05 §2.7 / §22: seconds of static cover under fire that count as not defending. */
export const COVERING_STATIC_S = 3;

/**
 * Damaging head strikes a visibly hurt fighter (05 limpness 1) may go without
 * answering before the referee steps in [E: Phase 9].
 */
export const HURT_TKO_UNANSWERED = 2;

export class Referee {
  readonly cfg: RefereeConfig;
  readonly rs: Ruleset;
  private readonly rng: RNG;
  private readonly records = new Map<number, FighterRecord>();
  private readonly foulRules = new Map<FoulId, FoulRule>();
  private pending: PendingStoppage[] = [];
  private pauseKind: PauseKind = null;
  private pauseUntilS = 0;
  private count: CountState | null = null;
  private exam: DoctorExam | null = null;
  private ended: BoutEnding | null = null;
  private events: RefereeEvent[] = [];
  private tickNo = 0;
  private round = 1;

  constructor(ruleset: Ruleset, opts: RefereeOptions) {
    this.rs = ruleset;
    this.rng = opts.rng;
    this.cfg = refereeConfig(
      opts.strictness ?? ruleset.referee.strictness,
      opts.experience ?? 'standard',
      opts.doctorLeniency ?? 0,
    );
    for (const f of ruleset.fouls) this.foulRules.set(f.id, f);
  }

  // ---- bookkeeping ------------------------------------------------------

  private rec(id: number): FighterRecord {
    let r = this.records.get(id);
    if (!r) {
      r = {
        warnings: new Map(), deductionsByRound: new Map(), totalDeductions: 0,
        kdRound: 0, kdBout: 0, nonEngagementS: 0, timidityWarnings: 0,
        markedInjury: null, slipCommands: 0, cutWatched: false, examinedCutSeverity: -1, holdingWarnings: 0,
      };
      this.records.set(id, r);
    }
    return r;
  }

  /** Point deductions the judges must apply to this fighter's card. */
  deductions(fighter: number, round: number): number {
    return this.rec(fighter).deductionsByRound.get(round) ?? 0;
  }

  totalDeductions(fighter: number): number {
    return this.rec(fighter).totalDeductions;
  }

  warningCount(fighter: number, foul: FoulId): number {
    return this.rec(fighter).warnings.get(foul) ?? 0;
  }

  knockdownsThisRound(fighter: number): number {
    return this.rec(fighter).kdRound;
  }

  knockdownsThisBout(fighter: number): number {
    return this.rec(fighter).kdBout;
  }

  get isPaused(): boolean {
    return this.pauseKind !== null;
  }

  get boutEnding(): BoutEnding | null {
    return this.ended;
  }

  /**
   * QA-1 (Phase 9): a stoppage in a bout with more than two fighters takes one
   * fighter out, not the bout. The bout flow calls this after it has marked
   * the loser out, and the referee goes back to officiating everyone else —
   * before, `ended` stayed latched, `tick` returned it every tick (the same
   * fighter was re-stopped each tick) and nothing else was ever officiated.
   */
  resumeAfterStoppage(loser: number | null): void {
    this.ended = null;
    this.pauseKind = null;
    this.pending = this.pending.filter((p) => p.loser !== loser);
    if (this.count && this.count.fighter === loser) this.count = null;
  }

  /** Called by the bout flow at the horn: the per-round knockdown tally resets. */
  startRound(round: number): void {
    this.round = round;
    for (const r of this.records.values()) r.kdRound = 0;
  }

  private emit(
    kind: RefereeEvent['kind'], actor: number, target: number,
    detail: RefereeEvent['detail'], text: string,
  ): void {
    this.events.push({
      tick: this.tickNo, subMs: 0, round: this.round, kind, actor, target, text, detail,
    });
  }

  // ---- the tick ---------------------------------------------------------

  /**
   * One referee phase. Returns the events emitted and, if the bout is over,
   * how. Draw order follows docs/design/09 §2.7 P6.
   */
  tick(input: RefTickInput): RefereeOutcome {
    this.events = [];
    this.tickNo = input.tick;
    this.round = input.round;
    if (this.ended) return { events: [], ended: this.ended, paused: this.pauseKind };

    // No referee at all: the street has its own end conditions.
    if (!this.rs.referee.present || !this.rs.stoppage.refereeStops) {
      return { events: this.events, ended: null, paused: null };
    }

    const opp = input.opponentOf ?? defaultOpponent(input.fighters);
    const dt = input.dt ?? 0.1;

    // 1. Pending stoppages: commit, or cancel because he started defending.
    //    Array in insertion order — never a Set or a Map, because iteration
    //    order would then leak into the outcome.               [09 §1.2 REVIEW]
    for (let i = 0; i < this.pending.length; i++) {
      const pnd = this.pending[i];
      const loser = input.fighters.find((f) => f.id === pnd.loser);
      const stillTrue = loser ? this.criterionStillTrue(pnd, loser) : false;
      if (input.t >= pnd.commitAtS && stillTrue) {
        return this.endBout(pnd.method, pnd.winner, pnd.loser, pnd.reason, pnd.lagS);
      }
      if (!stillTrue) {
        // "Let them work": the fighter answered before the referee moved.
        this.pending.splice(i, 1);
        i--;
      }
    }

    // 2. Paused: counts, foul recovery clocks and doctor examinations.
    if (this.pauseKind) {
      const out = this.pausedTick(input, opp);
      if (out) return out;
      return { events: this.events, ended: null, paused: this.pauseKind };
    }

    // 3. Per fighter, ascending id.
    const ordered = [...input.fighters].sort((a, b) => a.id - b.id);
    for (const f of ordered) {
      this.checkSubmission(f, opp(f.id), input);
      this.checkKO(f, opp(f.id), input);
      this.checkTKOStrikes(f, opp(f.id), input);
      this.checkCollapse(f, opp(f.id), input);
      if (this.rs.knockdown.counts) {
        const out = this.checkKnockdownEvent(f, opp(f.id), input);
        if (out) return out;
      }
      if (this.rs.stoppage.outmatchedTko) {
        const out = this.checkOutmatched(f, opp(f.id), input);
        if (out) return out;
      }
      const dOut = this.checkDoctorTriggers(f, input);
      if (dOut) return dOut;
    }

    // 4. Fouls flagged by resolution this tick.
    for (const occ of input.fouls ?? []) {
      const out = this.onFoul(occ, input);
      if (out) return out;
    }

    // 5. Stand-ups, clinch breaks, timidity.
    this.checkStandupsAndBreaks(input);
    this.checkTimidity(input, dt);

    return { events: this.events, ended: null, paused: this.pauseKind };
  }

  private criterionStillTrue(pnd: PendingStoppage, f: RefFighterInput): boolean {
    const o = f.obs;
    switch (pnd.kind) {
      case 'ko':
        return o.ko || o.limpness >= 2;
      case 'tap':
        return o.tapped || o.verbalTap || o.screams;
      case 'loc':
        return o.consciousness <= 0;
      case 'injury':
        return o.jointFailed;
      case 'collapse':
        return o.bodyCollapse.on || o.legCollapse.on;
      case 'tko':
        // The fighter cancels a pending TKO by defending intelligently again.
        return !o.intelligentDefence || o.ko || o.limp;
    }
  }

  private queueStoppage(
    method: WinCondition, winner: number, loser: number, reason: string,
    kind: StoppageKind, input: RefTickInput, explicitLag?: number,
  ): void {
    if (this.pending.some((q) => q.loser === loser && q.kind === kind)) return;
    const f = input.fighters.find((x) => x.id === loser);
    const lag = explicitLag ?? sampleReactionLag(
      this.rng, this.cfg, f?.refDistanceM ?? DEFAULT_REF_DISTANCE_M,
    );
    this.pending.push({
      method, winner, loser, reason, kind,
      queuedAtS: input.t, commitAtS: input.t + lag, lagS: lag,
    });
  }

  private endBout(
    method: WinCondition | 'no_contest', winner: number | 'draw' | 'none',
    loser: number | null, reason: string, lagS?: number,
  ): RefereeOutcome {
    this.ended = { method, winner, loser, reason, lagS };
    this.pending = [];
    this.pauseKind = null;
    this.emit('refereeStoppage', -1, typeof winner === 'number' ? winner : -1,
      { method, reason, lagS }, `Referee stops it: ${method} (${reason})`);
    return { events: this.events, ended: this.ended, paused: null };
  }

  // ---- §2.3.3 stoppage checks ------------------------------------------

  /**
   * Phase 9: the KO stoppage is for a fighter who is out or fully limp (05
   * `limpness` 2: KO, or acute head >= 85 for over a second). 05's limpness 1
   * — arms dropped, head lolling, which a `knockdown_hurt` sets — used to be
   * enough on its own, so every hurt knockdown was stopped on the spot as a KO
   * (two thirds of all bouts ended "KO" against a real 11.5 %, FIGHT_DATA §3
   * #90). A hurt fighter is instead stopped on a *lowered* strike count
   * ("the going-limp signal referees use to stop even when the strike count is
   * low", 05 §2.7): see `HURT_TKO_UNANSWERED` in `checkTKOStrikes`.
   */
  private checkKO(f: RefFighterInput, oppId: number, input: RefTickInput): void {
    if (f.obs.ko) {
      this.queueStoppage('ko', oppId, f.id, 'strikes', 'ko', input);
    } else if (f.obs.limpness >= 2) {
      // Limp but conscious (acute >= 85 for over a second, 05 §2.7): the
      // referee is stopping a barrage, which the record books as a TKO; a KO
      // is the fighter being put out (FIGHT_DATA §3 #90's split).
      this.queueStoppage('tko_strikes', oppId, f.id, 'limp under strikes', 'ko', input);
    }
  }

  private checkTKOStrikes(f: RefFighterInput, oppId: number, input: RefTickInput): void {
    const o = f.obs;
    const c = this.cfg;
    const nGround = Math.round(c.tkoUnansweredGround);
    const nStand = Math.round(c.tkoUnansweredStanding);

    if (o.grounded && !o.intelligentDefence && o.unansweredHead >= nGround) {
      this.queueStoppage('tko_strikes', oppId, f.id,
        'not intelligently defending (ground)', 'tko', input);
    }
    // A hurt fighter (05 limpness 1: arms dropped, head lolling) is stopped on
    // far fewer unanswered strikes.
    if (o.limp && !o.intelligentDefence && o.unansweredHead >= HURT_TKO_UNANSWERED) {
      this.queueStoppage('tko_strikes', oppId, f.id, 'hurt and not defending', 'tko', input);
    }
    // A static double-forearm cover is not defence: the fighter has to change
    // something. This is the rule the 2026 ABC text makes explicit.
    //
    // It is a *strike* stoppage, so it needs strikes. `tSinceDefenceS` alone
    // says only "this fighter has not answered", which is also true of a
    // fighter who is grounded by a body shot and taking the count, or one the
    // §04 battle is holding still — and that stopped bouts in which nobody had
    // thrown anything. The cover has to be a cover of something: either clean
    // head strikes are going unanswered, or the fighter is blocking and doing
    // nothing else (`coveringStaticS`, which §05 accrues on a glove block and
    // clears on any answer).
    // Phase 9: "under fire" is a string of strikes, not one: at least two
    // damaging head strikes unanswered, or a static cover being hit.
    // A static cover counts after 05 §2.7's three seconds of it, not on the
    // first blocked punch.
    const underFire = o.unansweredHead >= COVERING_MIN_UNANSWERED
      || o.coveringStaticS >= COVERING_STATIC_S;
    if (o.grounded && !o.intelligentDefence && underFire
      && o.tSinceDefenceS >= c.tkoNoDefenceS) {
      this.queueStoppage('tko_strikes', oppId, f.id,
        'covering without positional change', 'tko', input);
    }
    if (!o.grounded && o.rocked && o.unansweredHead >= nStand && !(o.clinching || o.moving)) {
      this.queueStoppage('tko_strikes', oppId, f.id,
        'rocked and not defending (standing)', 'tko', input);
    }
    if (o.rocked && o.knockdownsLast10s >= 2) {
      this.queueStoppage('tko_strikes', oppId, f.id,
        'second knockdown while hurt', 'tko', input);
    }
    // "Repetitive strikes": partly-defended volume also ends fights. Real
    // referees allow ~15-20 partly-defended strikes but only 3-5 undefended
    // ones [S: DMG §5.1], which is why this threshold is so much higher.
    if (o.absorbedWindow30 >= c.tkoAbsorbed30
      && o.defenceQuality30 < c.defenceQualityCeiling
      && (o.grounded || o.rocked)) {
      this.queueStoppage('tko_strikes', oppId, f.id, 'repetitive strikes', 'tko', input);
    }
  }

  private checkCollapse(f: RefFighterInput, oppId: number, input: RefTickInput): void {
    const o = f.obs;
    if (o.bodyCollapse.on && !o.attemptingToRise && o.bodyCollapse.tSinceS > this.cfg.collapseGraceS) {
      this.queueStoppage('tko_strikes', oppId, f.id,
        'body shot - cannot continue', 'collapse', input);
    }
    if (o.legCollapse.on && o.legCollapse.tSinceS > this.cfg.legCollapseGraceS) {
      this.queueStoppage('tko_strikes', oppId, f.id, 'leg - cannot stand', 'collapse', input);
    }
  }

  // ---- §2.3.5 submissions ----------------------------------------------

  private checkSubmission(f: RefFighterInput, oppId: number, input: RefTickInput): void {
    const o = f.obs;
    if (o.tapped || o.verbalTap || o.screams) {
      // A scream is a verbal submission under the unified rules, and the
      // referee is required to treat it as one.               [S: RULES §2.2]
      this.queueStoppage('submission', oppId, f.id,
        o.tapped ? 'tap' : 'verbal submission', 'tap', input,
        sampleTapLag(this.rng, this.cfg));
    } else if (o.consciousness <= 0 && o.underChoke) {
      this.queueStoppage('technical_submission', oppId, f.id,
        'unconscious', 'loc', input, this.cfg.locDetectS);
    } else if (o.jointFailed) {
      // A refused tap that became a fracture. The submission still wins; the
      // record says "technical" because nobody gave up.
      this.queueStoppage('technical_submission', oppId, f.id,
        'injury', 'injury', input, this.cfg.refReactionS);
    }
  }

  // ---- §2.3.4 knockdowns and counts ------------------------------------

  private checkKnockdownEvent(
    f: RefFighterInput, oppId: number, input: RefTickInput,
  ): RefereeOutcome | null {
    const kd = f.obs.knockedDown;
    const r = this.rec(f.id);
    if (!kd) {
      // Muay Thai: a fighter who will not rise from a slip after repeated
      // commands gets counted anyway.                          [S: RULES §2.5]
      if (this.rs.family === 'muay_thai' && f.refusesToRise) {
        r.slipCommands += 1;
        if (r.slipCommands >= this.cfg.slipRiseCommands) {
          r.slipCommands = 0;
          this.startCount(f.id, input, false);
        }
      }
      return null;
    }
    if (kd.cause !== 'legal_strike') {
      this.emit('refereeBreak', -1, f.id, { reason: 'slip' }, 'No knockdown - slip.');
      return null;
    }
    this.startCount(f.id, input, false);
    return null;
  }

  private startCount(fighter: number, input: RefTickInput, standing: boolean): void {
    if (this.count) return;
    const r = this.rec(fighter);
    r.kdRound += 1;
    r.kdBout += 1;
    this.count = {
      fighter, count: 0, nextAtS: input.t + 1.0, standing,
      limit: this.rs.knockdown.koCount,
    };
    this.pauseKind = 'count';
    // The opponent goes to a neutral corner; hitting the downed fighter now is
    // foul `hit_downed`.
    this.pauseUntilS = input.t + this.cfg.neutralCornerS;
    this.emit(standing ? 'standingEight' : 'refereeCount', -1, fighter,
      { count: 0 }, standing ? 'Standing eight count.' : 'Count is on.');
  }

  /** GLORY only: a rocked fighter still on his feet is given a standing eight. */
  checkStandingEight(f: RefFighterInput, input: RefTickInput): void {
    if (!this.rs.knockdown.standingEight || this.count) return;
    if (f.obs.rocked && !f.obs.grounded
      && f.obs.unansweredHead >= this.cfg.standingEightUnanswered) {
      this.startCount(f.id, input, true);
    }
  }

  private pausedTick(input: RefTickInput, opp: (id: number) => number): RefereeOutcome | null {
    // --- counts ---
    if (this.count) {
      const cs = this.count;
      const f = input.fighters.find((x) => x.id === cs.fighter);
      if (input.t >= cs.nextAtS) {
        cs.count += 1;
        cs.nextAtS += 1.0;
        this.emit('refereeCount', -1, cs.fighter,
          { count: cs.count }, `${cs.count}!`);
        if (cs.count === this.rs.knockdown.mandatoryCount && f) {
          // Eyes closed or spasms: there is no point in counting to ten.
          if (f.obs.ko || f.obs.limpness >= 2) {
            this.count = null;
            this.pauseKind = null;
            return this.endBout('ko', opp(cs.fighter), cs.fighter,
              'count stopped - no need to continue');
          }
          // The gait test. One draw, always taken at the mandatory count.
          const passed = this.gaitTest(f);
          if (passed && !f.obs.cannotStand) {
            this.count = null;
            this.pauseKind = null;
            return this.resumeAfterCount(cs.fighter, opp(cs.fighter));
          }
        } else if (f) {
          // Keep the stream aligned: a draw is taken at the mandatory count
          // only, so nothing else to do here.
        }
        if (cs.count >= cs.limit) {
          this.count = null;
          this.pauseKind = null;
          return this.endBout('tko_count', opp(cs.fighter), cs.fighter, 'count-out');
        }
      }
      return null;
    }

    // --- doctor examination ---
    if (this.exam && input.t >= this.exam.endsAtS) {
      const ex = this.exam;
      this.exam = null;
      this.pauseKind = null;
      const f = input.fighters.find((x) => x.id === ex.fighter);
      if (f) {
        const stop = this.doctorDecision(f, ex.trigger);
        this.emit('doctorCheck', -1, f.id,
          { reason: ex.trigger, decisionMade: stop ? 'stop' : 'continue' },
          stop ? 'The doctor waves it off.' : 'The doctor lets it continue.');
        if (stop) {
          return this.endBout('tko_doctor', opp(f.id), f.id, ex.trigger);
        }
        this.rec(f.id).cutWatched = true;
      }
      return null;
    }

    // --- foul recovery / equipment timeout ---
    if (this.pauseKind && this.pauseKind !== 'doctor' && input.t >= this.pauseUntilS) {
      this.pauseKind = null;
    }
    return null;
  }

  /**
   * The referee's gait test after the mandatory eight. Exactly one draw.
   * `acuteHeadProxy` is an observable (wobble / legs cue), not the hidden pool.
   */
  private gaitTest(f: RefFighterInput): boolean {
    const proxy = f.acuteHeadProxy ?? (f.obs.rocked ? 55 : 20);
    const l = logit(this.cfg.gaitPassBase)
      - this.cfg.gaitSlopeLogit * (Math.max(0, proxy - 45) / 45)
      - this.cfg.gaitStrictnessLogit;
    return this.rng.next() < sigmoid(l);
  }

  private resumeAfterCount(fighter: number, oppId: number): RefereeOutcome | null {
    const r = this.rec(fighter);
    const kd = this.rs.knockdown;
    if (kd.threeKdRound !== null && r.kdRound >= kd.threeKdRound) {
      return this.endBout('tko_three_kd', oppId, fighter,
        `${r.kdRound} knockdowns in the round`);
    }
    if (kd.fourKdBout !== null && r.kdBout >= kd.fourKdBout) {
      return this.endBout('tko_three_kd', oppId, fighter,
        `${r.kdBout} knockdowns in the bout`);
    }
    this.emit('refereeBreak', -1, fighter, { reason: 'count-complete' }, 'Fight on!');
    return null;
  }

  // ---- §2.3.6 fouls ------------------------------------------------------

  /**
   * The foul consequence state machine. Two draws per detected foul
   * (`deductAccidentalRepeat`, `protestTimeout`), always taken.
   */
  private onFoul(occ: FoulOccurrence, input: RefTickInput): RefereeOutcome | null {
    const rule = this.foulRules.get(occ.foul);
    const r = this.rec(occ.fouler);
    const deductRoll = this.rng.next();
    const protestRoll = this.rng.next();

    let detected = occ.detected;
    if (!detected) {
      // The victim protests loudly enough that the referee calls time anyway.
      if (protestRoll < this.cfg.pProtestTimeout) detected = true;
      else {
        this.emit('foul', occ.fouler, occ.victim,
          { foul: occ.foul, detected: false }, 'Missed foul (replay only).');
        return null;
      }
    }
    if (!rule) {
      // The foul is not in this ruleset's catalogue — nothing is a foul here.
      return null;
    }

    this.pauseKind = 'foul';
    this.pauseUntilS = input.t;
    if (!occ.announced) {
      this.emit('foul', occ.fouler, occ.victim,
        { foul: occ.foul, detected: true, effect: occ.effect } as RefereeEvent['detail'],
        `Foul: ${occ.foul}.`);
    }

    const priorWarnings = r.warnings.get(occ.foul) ?? 0;
    const intentional = occ.intent === 'intentional'
      || priorWarnings >= this.cfg.warningsBeforeIntentional
      || (rule.hard && occ.intent !== 'accidental');

    // --- recovery clock ---
    if (rule.recoveryMaxS > 0) {
      const scale = p('flow.foulTimeoutScale');
      this.pauseUntilS = input.t + rule.recoveryMaxS * scale;
      this.emit('refereeTimeout', -1, occ.victim,
        { reason: 'foul' }, `Up to ${Math.round(rule.recoveryMaxS / 60)} minutes to recover.`);
    }

    // --- the fouled fighter cannot continue ---
    if (occ.effect === 'cannot_continue') {
      this.pauseKind = null;
      if (intentional) {
        return this.endBout('dq', occ.victim, occ.fouler, `intentional ${occ.foul}`);
      }
      // Boxing's cruel special case: an accidental low blow that ends the
      // fight costs the *fouled* boxer the bout by TKO.       [S: RULES §2.3]
      if (this.rs.family === 'boxing' && occ.foul === 'low_blow') {
        return this.endBout('tko_strikes', occ.fouler, occ.victim,
          'unable to continue after an accidental low blow');
      }
      const done = input.roundsCompleted ?? this.round - 1;
      if (done >= this.rs.scoring.ncThresholdRounds(this.rs.rounds.count)) {
        return this.endBout('technical_decision', input.aheadOnCards ?? 'draw',
          occ.victim, `accidental ${occ.foul}`);
      }
      return this.endBout('no_contest', 'none', null, `accidental ${occ.foul}`);
    }

    // --- sanction ---
    if (intentional) {
      this.deduct(occ.fouler, this.cfg.deductionIntentional, occ.foul, true);
    } else if (occ.foul === 'fence_grab' && EFFECT_RANK[occ.effect] >= EFFECT_RANK.substantial) {
      // Grabbing the fence "with substantial effect" is a one-point deduction
      // on its own, and any position gained by it is given back. [S: RULES §2.2 #15]
      this.deduct(occ.fouler, 1, occ.foul, false);
      if (occ.positionGained) {
        this.emit('refereeBreak', -1, occ.fouler,
          { reason: 'restart-neutral' }, 'Restart standing, neutral position.');
      }
    } else if (priorWarnings < this.warningsAllowed(occ.foul, rule)) {
      this.warn(occ.fouler, occ.foul);
    } else if (deductRoll < this.cfg.pDeductAccidentalRepeat) {
      this.deduct(occ.fouler, Math.max(1, rule.deductionAccidental), occ.foul, false);
    } else {
      this.warn(occ.fouler, occ.foul);
    }

    if (occ.effect !== 'none') {
      r.markedInjury = { byFoul: occ.foul, intentional };
    }

    if (r.totalDeductions >= this.cfg.dqAfterDeductions
      || (occ.flagrant ?? (rule.hard && intentional))) {
      this.pauseKind = null;
      return this.endBout('dq', occ.victim, occ.fouler, occ.foul);
    }
    return null;
  }

  private warningsAllowed(foul: FoulId, rule: FoulRule): number {
    // Boxing's holding ladder is its own number (3/2/1 by strictness).
    if (foul === 'holding') return this.cfg.boxingHoldingWarnings;
    // The strictness preset overrides the catalogue default, per §2.1's note
    // on `FoulRule.warningsBeforeDeduction`.
    return Math.min(rule.warningsBeforeDeduction, this.cfg.warningsBeforeDeduction);
  }

  private warn(fighter: number, foul: FoulId): void {
    const r = this.rec(fighter);
    const n = (r.warnings.get(foul) ?? 0) + 1;
    r.warnings.set(foul, n);
    this.emit('refereeWarning', -1, fighter, { foul, count: n }, `Warning: ${foul}.`);
  }

  private deduct(fighter: number, points: number, foul: FoulId, intentional: boolean): void {
    const r = this.rec(fighter);
    r.totalDeductions += points;
    r.deductionsByRound.set(this.round, (r.deductionsByRound.get(this.round) ?? 0) + points);
    this.emit('deduction', -1, fighter, { foul, points, intentional },
      `${points} point${points === 1 ? '' : 's'} off for ${foul}.`);
  }

  /** (d) Timidity — the clock, not a probability.                [S: RULES §5] */
  private checkTimidity(input: RefTickInput, dt: number): void {
    for (const f of input.fighters) {
      const r = this.rec(f.id);
      if (f.nonEngaging) r.nonEngagementS += dt;
      else r.nonEngagementS = 0;
      if (r.nonEngagementS >= this.cfg.timidityWarnS) {
        r.nonEngagementS = 0;
        r.timidityWarnings += 1;
        if (r.timidityWarnings === 1) {
          this.emit('timidityWarning', -1, f.id,
            { foul: 'timidity' }, 'Warning for timidity - engage!');
        } else {
          this.deduct(f.id, 1, 'timidity', false);
        }
      }
    }
  }

  // ---- §2.3.6b stand-ups and clinch breaks -------------------------------

  private checkStandupsAndBreaks(input: RefTickInput): void {
    const dt = input.dt ?? 0.1;
    for (const e of input.engagements ?? []) {
      if (e.kind === 'ground') {
        if (this.rs.ground.standupPolicy === 'none') continue;
        const mult = positionMult(e.position);
        const since = e.sSinceEffort ?? 0;
        // "Work!" is said once, on the tick the stall crosses the warning
        // threshold — not repeated every 0.1 s until something happens. The
        // unlatched version emitted a warning per tick for as long as a
        // position stayed static: 87% of a typical bout's event log.
        const warnAt = this.cfg.standupWarnS * mult;
        if (since >= warnAt && since - dt < warnAt) {
          this.emit('refereeWarning', -1, e.a, { reason: 'work' }, 'Work!');
        }
        if (since >= this.cfg.standupS * mult) {
          // A hazard rather than a cliff, so stand-ups do not all land on the
          // same second, and an active bottom player buys time.  [09 §2.7]
          const hazard = e.bottomActive
            ? this.cfg.standupHazardPerS * (1 - this.cfg.strictnessScalar)
            : this.cfg.standupHazardPerS;
          const pTick = 1 - Math.exp(-hazard * dt);
          if (this.rng.next() < pTick) {
            this.emit('refereeBreak', -1, e.a,
              { reason: 'stand-up' }, 'Stand them up.');
          }
        }
        continue;
      }
      // --- clinch ---
      const rule = this.rs.clinch.activityRule;
      let shouldBreak = false;
      if (rule === 'one_strike_then_break') {
        shouldBreak = (e.strikesSinceEntry ?? 0) >= 1
          || (e.sInClinch ?? 0) >= this.cfg.kbClinchMaxS;
      } else if (rule === 'holding_is_foul') {
        shouldBreak = (e.sInClinch ?? 0) >= this.cfg.boxingBreakS;
      } else if (rule === 'continuous') {
        shouldBreak = (e.sSinceStrikeOrSweep ?? 0) >= this.cfg.mtClinchInactiveS;
      } else {
        const limit = e.atFence
          ? this.cfg.clinchBreakS
          : this.cfg.clinchBreakS * this.cfg.clinchBreakOpenMult;
        shouldBreak = (e.sSinceStrikeOrTdAttempt ?? 0) >= limit;
      }
      if (shouldBreak) {
        // 0.5 per 5 s once past the threshold [09 §2.7], so a break is not
        // instantaneous the moment the clock ticks over.
        const pTick = 1 - Math.exp(-0.1 * dt);
        const roll = this.rng.next();
        if (roll < pTick || rule === 'one_strike_then_break' || rule === 'holding_is_foul') {
          this.emit('refereeBreak', -1, e.a, { reason: 'clinch' }, 'Break!');
        }
      }
    }
  }

  // ---- §2.3.7 doctor -----------------------------------------------------

  private checkDoctorTriggers(f: RefFighterInput, input: RefTickInput): RefereeOutcome | null {
    if (!this.rs.stoppage.doctor || this.exam) return null;
    const o = f.obs;
    const cut = worstCut(o);
    const severityCall = this.cfg.cutDoctorCall * 3;

    const laceration = cut !== null && cut.severity >= severityCall;
    const eyelid = cut !== null && cut.site === 'eyelid' && cut.severity >= 2;
    const blood = o.bloodInEyeS > 60;
    const swollen = o.eyeSwollenShut;
    const fracture = o.fractureFlag === 'jaw' || o.fractureFlag === 'leg'
      || o.fractureFlag === 'nose';
    const vision = worstVision(o) <= this.cfg.doctorVisionStop;

    if (!(laceration || eyelid || blood || swollen || fracture || vision)) return null;

    // In-round the referee may call time for a laceration only; everything
    // else waits for the break.                                [S: RULES §2.2]
    const inRoundAllowed = laceration || eyelid;
    if (!inRoundAllowed) return null;
    // Phase 9: once the doctor has looked at a cut and let it go on, the same
    // cut is not re-examined until it gets worse. The trigger used to stay
    // true, so a new exam started on the tick the last one ended and the
    // bout sat in a doctor pause ("separating") until the final bell.
    const r = this.rec(f.id);
    if (cut !== null && cut.severity <= r.examinedCutSeverity) return null;
    if (cut !== null) r.examinedCutSeverity = cut.severity;

    const trigger: DoctorExam['trigger'] = vision ? 'vision'
      : fracture ? 'fracture' : 'laceration';
    return this.startDoctorExam(f.id, trigger, input);
  }

  /** Between rounds, the bout flow calls this at `flow.doctorStartS`. */
  startDoctorExam(
    fighter: number, trigger: DoctorExam['trigger'], input: RefTickInput,
  ): RefereeOutcome | null {
    const span = this.cfg.doctorExamMaxS - this.cfg.doctorExamMinS;
    const durationS = this.cfg.doctorExamMinS + span * 0.5;
    this.exam = { fighter, endsAtS: input.t + durationS, trigger };
    this.pauseKind = 'doctor';
    this.pauseUntilS = this.exam.endsAtS;
    this.emit('doctorCheck', -1, fighter, { reason: trigger }, 'Doctor, have a look.');
    return null;
  }

  /** One draw. Chapter 05 supplies the cues; the doctor supplies the judgement. */
  private doctorDecision(f: RefFighterInput, trigger: DoctorExam['trigger']): boolean {
    const o = f.obs;
    const cut = worstCut(o);
    const orbit = cut !== null
      && (cut.site === 'eyelid' || cut.site === 'orbit')
      && cut.severity >= 3;
    const visionImpaired = worstVision(o) <= this.cfg.doctorVisionStop;
    const fracture = o.fractureFlag === 'jaw' || o.fractureFlag === 'leg';
    const hardStop = orbit || fracture
      || (cut !== null && cut.severity >= 3 && this.rec(f.id).cutWatched);

    let pStop = hardStop ? this.cfg.pDoctorStopOrbit
      : visionImpaired ? this.cfg.pDoctorStopVision
        : this.cfg.pDoctorStopOther;
    // The doctor's own leniency shifts it by up to +-15 %.     [S: DMG §5.2]
    pStop = Math.max(0, Math.min(1,
      pStop * (1 + this.cfg.doctorLeniency * p('ref.doctorLeniencyRange'))));
    void trigger;
    return this.rng.next() < pStop;
  }

  // ---- §2.3.8 corner stoppage -------------------------------------------

  /**
   * Evaluated at 75 % of the break and continuously in-round. In MMA and Muay
   * Thai the towel *is* the stoppage; in US boxing it goes through the
   * inspector, which costs 5-15 s — long enough for another exchange.
   */
  cornerCheck(f: RefFighterInput, input: RefTickInput): RefereeOutcome | null {
    if (this.rs.stoppage.cornerTowel === 'none') return null;
    const wantsOut =
      ((f.structuralHead ?? 0) >= 80 && (f.lostLastRoundDecisively ?? false))
      || ((f.fatigue ?? 0) >= 0.9 && (f.opponentDominant ?? false))
      || ((f.mobility ?? 1) <= 0.4);
    const protectiveness = f.cornerProtectiveness ?? 0.5;
    const pTowel = wantsOut
      ? sigmoid(logit(this.cfg.cornerTowelBase)
        + this.cfg.cornerProtectivenessSlope * (protectiveness - 0.5)
        - this.cfg.cornerTitlePenalty * (f.titleFight ? 1 : 0))
      : 0;
    if (this.rng.next() >= pTowel) return null;

    const via = this.rs.stoppage.cornerTowel === 'direct' ? 'towel' : 'inspector';
    this.emit('cornerStop', -1, f.id, { reason: via }, 'The corner throws in the towel.');
    if (via === 'inspector') {
      // The delay is real: the towel cannot stop a fight in US boxing, so the
      // referee only learns about it when the inspector reaches him.
      this.pauseKind = null;
      this.pauseUntilS = input.t
        + (this.cfg.inspectorDelayMinS + this.cfg.inspectorDelayMaxS) / 2;
    }
    const opp = (input.opponentOf ?? defaultOpponent(input.fighters))(f.id);
    return this.endBout('tko_corner', opp, f.id, via);
  }

  // ---- Muay Thai "outmatched" -------------------------------------------

  private checkOutmatched(
    f: RefFighterInput, oppId: number, input: RefTickInput,
  ): RefereeOutcome | null {
    const taken = f.damageTaken ?? 0;
    const dealt = f.damageDealt ?? 0;
    if (taken <= 0) return null;
    // Health-and-safety clause: no knockdown needed, just a fighter who is
    // being beaten badly enough that continuing serves nobody. [S: RULES §2.5]
    if (dealt * this.cfg.mtOutmatchedRatio <= taken && taken > 20) {
      return this.endBout('tko_outmatched', oppId, f.id, 'outmatched');
    }
    void input;
    return null;
  }

  // ---- §2.5 the horn and the break --------------------------------------

  /**
   * A strike that lands within `hornGraceS` of the horn counts; one *initiated*
   * after it is foul #24. The count does not stop for the bell — there is no
   * saved-by-the-bell anywhere in this design.              [S: RULES §6.2]
   */
  strikeCountsAtHorn(impactT: number, hornT: number): boolean {
    return impactT <= hornT + this.cfg.hornGraceS;
  }

  /** End of the break: can this fighter answer the bell?           [E] */
  readyForBell(f: RefFighterInput, input: RefTickInput): RefereeOutcome | null {
    if (f.obs.cannotStand || f.obs.consciousness < this.cfg.bellReadyConsciousness) {
      const opp = (input.opponentOf ?? defaultOpponent(input.fighters))(f.id);
      return this.endBout('tko_bell', opp, f.id, 'unable to answer the bell');
    }
    return null;
  }
}

function defaultOpponent(fighters: readonly RefFighterInput[]): (id: number) => number {
  const ids = fighters.map((f) => f.id);
  return (id: number) => ids.find((x) => x !== id) ?? id;
}

// ---------------------------------------------------------------------------
// §2.3.9 grappling referees
// ---------------------------------------------------------------------------

export type GrapplingScoreEvent =
  | 'takedown' | 'takedown_past_guard' | 'sweep' | 'sweep_past_guard'
  | 'knee_on_belly' | 'pass' | 'mount' | 'back_hooks' | 'exit_to_escape_sub';

/** §2.3.9's position-to-points table. Both systems need 3 s of stabilisation. */
export const IBJJF_POINTS: Record<GrapplingScoreEvent, number> = {
  takedown: 2, takedown_past_guard: 2, sweep: 2, sweep_past_guard: 2,
  knee_on_belly: 2, pass: 3, mount: 4, back_hooks: 4,
  exit_to_escape_sub: 2,     // awarded to the attacker, not the escaper
};

export const ADCC_POINTS: Record<GrapplingScoreEvent, number> = {
  takedown: 2, takedown_past_guard: 4, sweep: 2, sweep_past_guard: 4,
  knee_on_belly: 2, pass: 3, mount: 2, back_hooks: 3,
  exit_to_escape_sub: -1,    // fleeing: a negative for the escaper
};

export interface GrapplingScore {
  points: [number, number];
  advantages: [number, number];
  penalties: [number, number];
  negatives: [number, number];
  subLocked: [number, number];
}

export function emptyGrapplingScore(): GrapplingScore {
  return {
    points: [0, 0], advantages: [0, 0], penalties: [0, 0],
    negatives: [0, 0], subLocked: [0, 0],
  };
}

/** The IBJJF stalling ladder: warning -> advantage -> 2 points -> DQ. */
export const IBJJF_STALL_LADDER = ['warning', 'advantage', 'points2', 'dq'] as const;
export type IbjjfStallStep = typeof IBJJF_STALL_LADDER[number];

export function ibjjfStallStep(count: number): IbjjfStallStep {
  return IBJJF_STALL_LADDER[Math.min(count, IBJJF_STALL_LADDER.length - 1)];
}

/**
 * ADCC: nothing positive scores in the first half. Warnings issued there
 * convert to -1 when the scoring half starts, which is why a passive first
 * five minutes is so expensive.                              [S: RULES §2.6]
 */
export function adccPositivePointsAllowed(rs: Ruleset, t: number): boolean {
  return t >= rs.rounds.noPositivePointsBeforeS;
}

// ---------------------------------------------------------------------------
// §2.3.10 judo referee
// ---------------------------------------------------------------------------

export interface JudoScore {
  ippon: [boolean, boolean];
  wazaAri: [number, number];
  yuko: [number, number];
  shido: [number, number];
  hansokuMake: [boolean, boolean];
}

export function emptyJudoScore(): JudoScore {
  return {
    ippon: [false, false], wazaAri: [0, 0], yuko: [0, 0],
    shido: [0, 0], hansokuMake: [false, false],
  };
}

export interface ThrowLanding {
  onBack: boolean;
  angleDeg: number;
  speed: boolean;
  force: boolean;
  control: boolean;
}

export type JudoScoreValue = 'ippon' | 'waza_ari' | 'yuko' | 'none';

/** Throw landing -> score. [S: RULES §2.7; JUDO §9] */
export function judoThrowScore(l: ThrowLanding): JudoScoreValue {
  if (l.onBack && l.speed && l.force && l.control) return 'ippon';
  // Landing past 90 degrees of the shoulder axis but not on the back, or an
  // ippon missing exactly one criterion, is waza-ari.
  const missing = [l.speed, l.force, l.control].filter((x) => !x).length;
  if ((l.angleDeg > 90 && !l.onBack) || (l.onBack && missing === 1)) return 'waza_ari';
  if (l.angleDeg >= 90) return 'yuko';
  return 'none';
}

/** Osaekomi timer -> score. In golden score 5 s of yuko ends the contest. */
export function judoOsaekomiScore(seconds: number): JudoScoreValue {
  if (seconds >= p('rules.judo.osaekomiIppon')) return 'ippon';
  if (seconds >= p('rules.judo.osaekomiWazaAri')) return 'waza_ari';
  if (seconds >= p('rules.judo.osaekomiYuko')) return 'yuko';
  return 'none';
}

/** Apply one score. Two waza-ari make an ippon; yuko never accumulates. */
export function applyJudoScore(s: JudoScore, fighter: 0 | 1, v: JudoScoreValue): void {
  if (v === 'ippon') s.ippon[fighter] = true;
  else if (v === 'waza_ari') {
    s.wazaAri[fighter] += 1;
    if (s.wazaAri[fighter] >= 2) s.ippon[fighter] = true;   // waza-ari awasete ippon
  } else if (v === 'yuko') s.yuko[fighter] += 1;
}

/** Third shido is hansoku-make (the athlete may continue in the competition). */
export function applyShido(s: JudoScore, fighter: 0 | 1): void {
  s.shido[fighter] += 1;
  if (s.shido[fighter] >= 3) s.hansokuMake[fighter] = true;
}

/** The direct hansoku-make list. [S: RULES §2.7] */
export const JUDO_DIRECT_HANSOKU_MAKE = [
  'head_dive', 'kani_basami', 'kawazu_gake', 'do_jime', 'ashi_garami',
  'standing_kansetsu_waza', 'standing_shime_waza', 'somersault_with_uke',
  'lift_and_slam', 'disregard_referee',
] as const;

// ---------------------------------------------------------------------------
// §2.3.11 street mode
// ---------------------------------------------------------------------------

export type StreetEndReason =
  | 'incapacitation' | 'flight' | 'surrender' | 'separation' | 'weapon' | 'arrival';

export interface StreetParticipant {
  id: number;
  side: number;
  obs: RefObservables;
  mobility: number;
  cannotStandForS: number;
  wantsToFlee?: boolean;
  wantsToSurrender?: boolean;
  state?: 'active' | 'incapacitated' | 'fled' | 'surrendered';
}

export interface StreetTickResult {
  ended: { reason: StreetEndReason; participant: number } | null;
  changes: { participant: number; state: 'incapacitated' | 'fled' | 'surrendered' }[];
}

/**
 * The street has no referee, so this is not officiating — it is the set of
 * ways a real fight actually ends. The design rule from the research is
 * binding: fleeing is a win, and attacking an incapacitated or surrendered
 * person is never rewarded for the player.                   [S: RULES §2.8]
 */
export function streetTick(
  participants: readonly StreetParticipant[],
  rng: RNG,
  t: number,
  dt: number,
  bystanders: number,
  weaponHazardPerS = p('street.weaponHazardPerS'),
): StreetTickResult {
  const changes: StreetTickResult['changes'] = [];
  let ended: StreetTickResult['ended'] = null;

  for (const q of [...participants].sort((a, b) => a.id - b.id)) {
    if (q.state && q.state !== 'active') continue;
    if (q.obs.ko
      || (q.obs.grounded && q.cannotStandForS >= p('street.incapStandS'))
      || q.obs.fractureFlag === 'leg') {
      changes.push({ participant: q.id, state: 'incapacitated' });
      continue;
    }
    if (q.wantsToFlee) {
      const fastest = Math.max(
        0,
        ...participants.filter((o) => o.side !== q.side && (o.state ?? 'active') === 'active')
          .map((o) => o.mobility),
      );
      const canOutrun = q.mobility > fastest * p('street.fleeMobilityRatio');
      const success = canOutrun && rng.next() < p('street.fleeSuccess');
      if (success) changes.push({ participant: q.id, state: 'fled' });
    } else if (q.wantsToSurrender) {
      changes.push({ participant: q.id, state: 'surrendered' });
    }
  }

  // Hazards: separation by bystanders, a weapon appearing, authority arriving.
  // Median time to the first ending condition is 20-40 s, which these rates
  // reproduce [D: ln2 / 0.02 ~ 35 s].
  if (t >= p('street.sepStartS')) {
    const lambdaSep = p('street.sepHazardPerS') * (1 + p('street.sepBystanderMult') * bystanders);
    if (rng.next() < 1 - Math.exp(-lambdaSep * dt)) {
      ended = { reason: 'separation', participant: -1 };
    }
  }
  if (!ended && rng.next() < 1 - Math.exp(-weaponHazardPerS * dt)) {
    ended = { reason: 'weapon', participant: -1 };
  }
  if (!ended && rng.next() < 1 - Math.exp(-p('street.arrivalHazardPerS') * dt)) {
    ended = { reason: 'arrival', participant: -1 };
  }
  return { ended, changes };
}

// ---------------------------------------------------------------------------
// small maths
// ---------------------------------------------------------------------------

/** Quantised to 1e-9 before the sigmoid, per 09 §2.6's determinism rule. */
export function sigmoid(x: number): number {
  const q = Math.round(x * 1e9) / 1e9;
  return 1 / (1 + Math.exp(-q));
}

export function logit(p0: number): number {
  const c = Math.min(1 - 1e-9, Math.max(1e-9, p0));
  return Math.log(c / (1 - c));
}
