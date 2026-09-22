/**
 * FINISH MECHANICS - the locked clock (04 §2.6).
 *
 * Once S3 succeeds the lock is fully closed and a different process runs: the
 * defender is no longer fighting for position, only deciding whether to tap.
 * Four things can end it.
 *
 *  - A choke that is *functional* (both carotids) takes a fighter out in about
 *    9 s (7.2 s for the arm-triangle, 10.2 s for the arm-in guillotine). A
 *    fighter who taps does so 2-8 s in, before that clock runs out.
 *  - A joint lock hurts before it breaks, so the tap comes first for almost
 *    everyone; a refuser gets the injury instead, 0-10 s later depending on the
 *    joint. The heel hook is the exception the literature is loud about: the
 *    tear can precede the pain, so even a tapper is sometimes hurt first.
 *  - Cranks accumulate `state.neck_cranked` severity rather than producing a
 *    discrete injury.
 *  - A rare escape: 0.01-0.10 per second, per technique.
 *
 * P(goes out instead of tapping) is the single most calibration-sensitive
 * number here: 11 % of UFC chokes end in unconsciousness, which is exactly the
 * T2-T4 `pGoOut` band, and the judo cadet-to-senior gradient gives the tier
 * ladder around it (0.19 novice, 0.05 elite).
 *
 * Everything takes its randomness from the injected RNG and never reads a
 * clock.
 */
import type { Arena } from '../rules/arenas/types';
import type { SubmissionSpec } from './catalogue';
import { MODIFIER_PARAMS, type RandomSource, type SubFighter, type Tier, logit, sigmoid } from './stages';

// ---------------------------------------------------------------------------
// parameters (§2.6, §7)
// ---------------------------------------------------------------------------

export const FINISH_PARAMS = {
  /** Pooled mean time to unconsciousness, seconds, where no per-type value exists. */
  locMeanPooledS: 9.0,
  locSdS: 1.5,
  locClampMinS: 6,
  locClampMaxS: 13,
  /** A tap is forced at least this long before unconsciousness would arrive. */
  tapClampBeforeLocS: 0.5,
  /** P(goes out instead of tapping) by defender tier (§2.6.2, §6.3). */
  pGoOutTier: [0.40, 0.19, 0.11, 0.11, 0.11, 0.05] as readonly number[],
  /** Title fights raise the stubbornness. */
  stakesTitleMult: 1.2,
  /** Two or more career submission losses lower it. */
  injuryHistoryMult: 0.8,
  stubbornnessMin: 0.02,
  stubbornnessMax: 0.5,
  /** The refusesToTap trait floors stubbornness here. */
  refusesToTapFloor: 0.5,
  /** Joint locks: refusal is half as likely as a choke refusal (T0 is flat 0.40). */
  pRefuseFactor: 0.5,
  /** Air-hunger / pain tap hazard on a non-functional mixed choke, per second. */
  hTapAirT4: 0.06,
  hTapAirLowTierMult: 2.0,
  hTapAirT5Mult: 0.5,
  /** Locked escape hazard for blood chokes and for non-functional mixed chokes. */
  hEscBloodT4: 0.02,
  hEscBloodT5: 0.04,
  hEscBloodLowTier: 0.005,
  hEscAirT4: 0.06,
  hEscAirT5: 0.10,
  hEscAirLowTier: 0.02,
  /** A successful locked escape usually only loosens the lock back to S2. */
  escapeSplitRegressChoke: 0.6,
  escapeSplitRegressLock: 0.7,
  /** Mixed choke that never became functional: the attacker's forearms give out. */
  enduranceFatigueAdd: 0.05,
  /** Referee latency (§2.6.4). The LOC number is §06's `cfg.locDetectS`. */
  locDetectS: 1.0,
  refLagInjuryMinS: 0.5,
  refLagInjuryMaxS: 1.5,
  pRefStopsOnInjury: 0.7,
  /** The attacker notices the limp body and releases within 1 s. */
  attackerReleaseT4: 0.6,
  attackerReleaseT5: 0.8,
  attackerReleaseLowTier: 0.2,
  postLocSymptomHoldS: 4,
  postLocSymptomP: 0.6,
  /** Heel hooks: P(injury before the tap) by defender tier (§2.6.5). */
  pInjBeforeTapTier: [0.30, 0.25, 0.15, 0.10, 0.05, 0.05] as readonly number[],
  /** Cranks: cumulative neck strain and the referee threshold. */
  neckStrainPer5s: 0.15,
  neckStrainRefThreshold: 0.6,
  neckStrainRefStopPerS: 0.3,
  /** Doctor stop at the round break, by severity. */
  doctorStopHigh: 0.8,
  doctorStopMedium: 0.3,
  layoffMonthsHigh: 10,
  /** Share of locked submissions expected to be saved by the bell. */
  bellSaveTarget: 0.03,
} as const;

/** Per-technique time to unconsciousness, seconds (§2.6.1). */
export const LOC_MEAN_S: Readonly<Record<string, number>> = {
  'sub.arm_triangle_mount': 7.2,
  'sub.arm_triangle_side': 7.2,
  'sub.arm_triangle_standing': 7.2,
  'sub.rnc': 8.9,
  'sub.guillotine_standard': 8.9,
  'sub.north_south_choke': 9.4,
  'sub.triangle_guard': 9.5,
  'sub.triangle_mounted': 9.5,
  'sub.triangle_rear': 9.5,
  'sub.triangle_side': 9.5,
  'sub.triangle_inverted': 9.5,
  'sub.triangle_flying': 9.5,
  'sub.guillotine_arm_in': 10.2,
};

/** The mean the technique uses: its own measurement, else the pooled 9.0 s. */
export function locMeanS(spec: SubmissionSpec): number {
  return spec.finishClock.locMeanS ?? LOC_MEAN_S[spec.id] ?? FINISH_PARAMS.locMeanPooledS;
}

// ---------------------------------------------------------------------------
// the tap decision (§2.6.2, §2.6.5)
// ---------------------------------------------------------------------------

export interface TapProfile {
  readonly tier: Tier;
  readonly heart: number;
  /** Career submission losses (01 §2.7.7). */
  readonly subLosses: number;
  readonly refusesToTap: boolean;
  readonly titleFight: boolean;
}

/**
 * `stubbornness` exactly as 01 §2.7.7 defines it, so the two chapters cannot
 * drift: the tier base scaled by heart, clamped, reduced by injury history,
 * floored by the `refusesToTap` trait. At heart 50 the tier bases come back
 * unchanged; a heart-90 fighter is 1.4x more likely to go out.
 */
export function stubbornness(p: TapProfile): number {
  const base = FINISH_PARAMS.pGoOutTier[p.tier];
  let s = base * (0.5 + p.heart / 100);
  s = Math.min(Math.max(s, FINISH_PARAMS.stubbornnessMin), FINISH_PARAMS.stubbornnessMax);
  if (p.subLosses >= 2) s *= FINISH_PARAMS.injuryHistoryMult;
  if (p.refusesToTap) s = Math.max(s, FINISH_PARAMS.refusesToTapFloor);
  return s;
}

/** P(goes out instead of tapping) for a choke. */
export function pGoOut(p: TapProfile): number {
  const stakes = p.titleFight ? FINISH_PARAMS.stakesTitleMult : 1;
  return Math.min(stubbornness(p) * stakes, 1);
}

/**
 * P(refuses to tap) for a joint lock, crank or compression. Half the choke
 * value - pain is a louder argument than a fading vision - except at T0, where
 * the fighter simply does not know to tap.
 */
export function pRefuse(p: TapProfile): number {
  if (p.tier === 0) return FINISH_PARAMS.pGoOutTier[0];
  return pGoOut(p) * FINISH_PARAMS.pRefuseFactor;
}

/** Heel hooks only: P(the knee goes before the tap does), by defender tier. */
export function pInjuryBeforeTap(spec: SubmissionSpec, tier: Tier): number {
  if (!spec.finishClock.noWarning) return 0;
  return FINISH_PARAMS.pInjBeforeTapTier[tier] * (spec.finishClock.noWarningMult ?? 1);
}

/**
 * Per-second tap hazard equivalent of the uniform tap time, for callers that
 * prefer a hazard formulation. [D: uniform on [min, max] -> h(t) = 1/(max - t)]
 */
export function tapHazard(spec: SubmissionSpec, tMs: number): number {
  const { tapMinMs, tapMaxMs } = spec.finishClock;
  if (tMs < tapMinMs || tMs >= tapMaxMs) return 0;
  return 1 / ((tapMaxMs - tMs) / 1000);
}

/** Air-hunger tap hazard on a mixed choke that never became functional. */
export function airTapHazard(tier: Tier): number {
  const base = FINISH_PARAMS.hTapAirT4;
  if (tier <= 2) return base * FINISH_PARAMS.hTapAirLowTierMult;
  if (tier >= 5) return base * FINISH_PARAMS.hTapAirT5Mult;
  return base;
}

/**
 * Per-second escape hazard while locked, with the skill term applied on its
 * logit (`M_SKILL` at k = 1.0, §2.6.2). Chokes and joint locks use the
 * technique's own hazard; a mixed choke that failed to become functional uses
 * the much higher air-choke ladder.
 */
export function lockedEscapeHazard(
  spec: SubmissionSpec,
  attacker: SubFighter,
  defender: SubFighter,
  functional: boolean,
): number {
  let base = spec.finishClock.escapeHazardPerS;
  if (spec.family === 'choke' && !functional) {
    base = spec.finishClock.escapeHazardAirPerS ?? FINISH_PARAMS.hEscAirT4;
    if (defender.tier >= 5) base = FINISH_PARAMS.hEscAirT5;
    else if (defender.tier <= 2) base = FINISH_PARAMS.hEscAirLowTier;
  } else if (spec.family === 'choke') {
    if (defender.tier >= 5) base = FINISH_PARAMS.hEscBloodT5;
    else if (defender.tier <= 2) base = FINISH_PARAMS.hEscBloodLowTier;
  }
  const skAtt = familySkillOf(attacker, spec);
  const term = MODIFIER_PARAMS.kSkillLocked * (skAtt - defender.escapes) / 100;
  return sigmoid(logit(base) - term);
}

function familySkillOf(f: SubFighter, spec: SubmissionSpec): number {
  switch (spec.family) {
    case 'choke': return f.chokes;
    case 'jointLock': return f.jointLocks;
    case 'legLock': return f.legLocks;
    default: return f.cranks;
  }
}

// ---------------------------------------------------------------------------
// the locked clock
// ---------------------------------------------------------------------------

/**
 * Draws taken once at `lockedAtMs`, in order (§2.4.3 plus the two the chapter
 * defines in §2.6.1 and §2.6.5 but leaves out of that list). Every one is
 * always consumed, so the stream position after a lock is a pure function of
 * state, exactly as 09 §2.7 requires.
 *
 *   1 functional  - mixed choke becomes a blood choke (§2.6.1)
 *   2 tapOrLoc    - pGoOut / pRefuse (§2.6.2, §2.6.5)
 *   3 tLoc        - Normal(mu, 1.5 s) = 2 RNG calls
 *   5 tTap        - uniform over the technique's tap range
 *   6 noWarning   - heel hook: injury before the tap (§2.6.5)
 *   7 injuryDelay - uniform over the technique's injury delay
 */
export const LOCK_DRAW_COUNT = 7;

/** Draws taken every second of the locked clock: escape, its split, air tap. */
export const LOCKED_SECOND_DRAW_COUNT = 3;

export type LockedOutcomeKind = 'tap' | 'loc' | 'injury' | 'escape' | 'regress' | 'bellSave' | 'enduranceRegress';

export interface LockedClockResult {
  readonly outcome: LockedOutcomeKind;
  /** Time from `lockedAtMs` to the outcome, ms. */
  readonly timeMs: number;
  /** Did the choke close both carotids? Always false for non-chokes. */
  readonly functional: boolean;
  /** Whether the defender was drawn as a tapper or as a refuser. */
  readonly stubborn: boolean;
  /** Time to unconsciousness that was drawn, seconds (chokes only). */
  readonly tLocS: number;
  /** Tap time that was drawn, ms. */
  readonly tTapMs: number;
  /** Heel hook: the knee went before the tap did. */
  readonly injuredBeforeTap: boolean;
  /** Cranks: cumulative `state.neck_cranked` severity accrued while locked. */
  readonly neckStrain: number;
}

export interface LockedClockInput {
  readonly spec: SubmissionSpec;
  readonly attacker: SubFighter;
  readonly defender: SubFighter;
  readonly tap: TapProfile;
  /** Time left in the round, ms; the clock stops there (§2.4.5 bell save). */
  readonly msToBell?: number;
}

/**
 * Run the locked clock to its end (§2.6). One call is one finish-or-not, which
 * is what the calibration batch samples; the live engine calls the same
 * primitives a second at a time.
 */
export function resolveLockedClock(rng: RandomSource, input: LockedClockInput): LockedClockResult {
  const { spec, attacker, defender, tap } = input;
  const clock = spec.finishClock;
  const isChoke = spec.family === 'choke';

  // ---- the lock block: seven draws, always -------------------------------
  const uFunctional = rng.next();
  const uTapOrLoc = rng.next();
  const tLocRaw = normal(rng, locMeanS(spec), FINISH_PARAMS.locSdS);
  const uTap = rng.next();
  const uNoWarning = rng.next();
  const uInjuryDelay = rng.next();

  const functional = isChoke
    ? (spec.chokeType === 'blood' ? true
      : spec.chokeType === 'air' ? false
      : uFunctional < (clock.pBlood ?? 0.5))
    : false;

  // A thicker neck buys time under the choke as well as resisting it.
  const neckBonusS = MODIFIER_PARAMS.kNeckTLocS * (defender.neck / 100 - 0.5) / 0.5;
  const tLocS = Math.min(
    Math.max(tLocRaw, FINISH_PARAMS.locClampMinS),
    FINISH_PARAMS.locClampMaxS,
  ) + neckBonusS;

  const stubborn = uTapOrLoc < (isChoke ? pGoOut(tap) : pRefuse(tap));

  let tTapMs = clock.tapMinMs + uTap * (clock.tapMaxMs - clock.tapMinMs);
  if (functional) {
    // A tap always lands before the lights go out (§2.6.2).
    tTapMs = Math.min(tTapMs, tLocS * 1000 - FINISH_PARAMS.tapClampBeforeLocS * 1000);
    tTapMs = Math.max(tTapMs, 0);
  }

  const injuredBeforeTap = !stubborn && uNoWarning < pInjuryBeforeTap(spec, tap.tier);
  const injuryAtMs = (clock.injuryDelayMinMs ?? 0)
    + uInjuryDelay * ((clock.injuryDelayMaxMs ?? 0) - (clock.injuryDelayMinMs ?? 0))
    // Flexible joints buy time before the ligament goes (M_FLX_DEF).
    + Math.max(0, defender.flexibility - 50) * MODIFIER_PARAMS.kFlxDefInjuryDelayS * 1000;

  const hEsc = lockedEscapeHazard(spec, attacker, defender, functional);
  const hAir = airTapHazard(tap.tier);
  const regressShare = isChoke
    ? FINISH_PARAMS.escapeSplitRegressChoke
    : FINISH_PARAMS.escapeSplitRegressLock;

  const enduranceMs = clock.enduranceMs;
  const bellMs = input.msToBell ?? Number.POSITIVE_INFINITY;

  // The deterministic end time of this lock, if nothing intervenes.
  let endMs: number;
  let endKind: LockedOutcomeKind;
  if (!stubborn) {
    endMs = tTapMs;
    endKind = 'tap';
  } else if (isChoke && functional) {
    endMs = tLocS * 1000;
    endKind = 'loc';
  } else if (!isChoke && clock.injuryDelayMaxMs !== undefined) {
    endMs = injuryAtMs;
    endKind = 'injury';
  } else {
    // A refuser under a crank or a non-functional choke: nothing structural
    // ever arrives, only the endurance clock and the per-second hazards.
    endMs = Number.POSITIVE_INFINITY;
    endKind = 'enduranceRegress';
  }

  let neckStrain = 0;
  const strainRate = clock.neckStrainPer5s ?? 0;

  for (let second = 1; second <= 600; second++) {
    const tMs = second * 1000;

    // Constant per-second draw block (three draws, always).
    const uEsc = rng.next();
    const uSplit = rng.next();
    const uAirTap = rng.next();

    if (bellMs <= Math.min(tMs, endMs)) {
      return result('bellSave', bellMs, functional, stubborn, tLocS, tTapMs, injuredBeforeTap, neckStrain);
    }

    // A deterministic end inside this second wins: the lock closes faster than
    // the defender can work their way out of it.
    if (endMs <= tMs) {
      return result(endKind, endMs, functional, stubborn, tLocS, tTapMs, injuredBeforeTap, neckStrain);
    }

    if (strainRate > 0) neckStrain += strainRate / 5;

    if (uEsc < hEsc) {
      const kind: LockedOutcomeKind = uSplit < regressShare ? 'regress' : 'escape';
      return result(kind, tMs, functional, stubborn, tLocS, tTapMs, injuredBeforeTap, neckStrain);
    }

    // Non-functional mixed chokes still hurt: air hunger produces its own taps,
    // and they are the only way such a choke ever ends in a submission.
    if (isChoke && !functional && uAirTap < hAir) {
      return result('tap', tMs, functional, stubborn, tLocS, tTapMs, injuredBeforeTap, neckStrain);
    }

    // The attacker's own forearms give out on a choke that never closed.
    if (enduranceMs !== undefined && !functional && isChoke && tMs >= enduranceMs) {
      return result('enduranceRegress', tMs, functional, stubborn, tLocS, tTapMs, injuredBeforeTap, neckStrain);
    }
  }

  return result('regress', 600000, functional, stubborn, tLocS, tTapMs, injuredBeforeTap, neckStrain);
}

function result(
  outcome: LockedOutcomeKind, timeMs: number, functional: boolean, stubborn: boolean,
  tLocS: number, tTapMs: number, injuredBeforeTap: boolean, neckStrain: number,
): LockedClockResult {
  return { outcome, timeMs, functional, stubborn, tLocS, tTapMs, injuredBeforeTap, neckStrain };
}

/** Box-Muller, matching `RNG.normal` - always two draws. */
function normal(rng: RandomSource, mean: number, sd: number): number {
  const u = Math.max(rng.next(), 1e-12);
  const v = rng.next();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------------------
// referee detection (§2.6.4)
// ---------------------------------------------------------------------------

export type TechnicalSubmissionReason = 'loc' | 'injury';

/**
 * Seconds between the fight-ending moment and the referee's intervention.
 * The LOC number belongs to §06 (`cfg.locDetectS`, 1.0 s median); the injury
 * lag is this chapter's and only fires 70 % of the time - the other 30 % of
 * broken limbs are fought on with.
 */
export function refereeStop(
  rng: RandomSource,
  reason: TechnicalSubmissionReason,
  opts: { refereeStopsOnLoc?: boolean } = {},
): { stops: boolean; lagS: number } {
  // Both draws are always consumed so the stream position does not depend on
  // which kind of stoppage this is.
  const u = rng.next();
  const uLag = rng.next();
  if (reason === 'loc') {
    // A street ruleset has no referee: the attacker decides when to let go.
    const stops = opts.refereeStopsOnLoc !== false;
    return { stops, lagS: stops ? FINISH_PARAMS.locDetectS : 0 };
  }
  const lag = FINISH_PARAMS.refLagInjuryMinS
    + uLag * (FINISH_PARAMS.refLagInjuryMaxS - FINISH_PARAMS.refLagInjuryMinS);
  return { stops: u < FINISH_PARAMS.pRefStopsOnInjury, lagS: lag };
}

/** P(the attacker notices the limp body and lets go within 1 s). */
export function attackerReleaseOnLoc(tier: Tier): number {
  if (tier >= 5) return FINISH_PARAMS.attackerReleaseT5;
  if (tier <= 2) return FINISH_PARAMS.attackerReleaseLowTier;
  return FINISH_PARAMS.attackerReleaseT4;
}

/** P(post-LOC symptoms) once the hold has run 4 s past unconsciousness. */
export function postLocSymptoms(holdPastLocS: number): number {
  return holdPastLocS >= FINISH_PARAMS.postLocSymptomHoldS ? FINISH_PARAMS.postLocSymptomP : 0;
}

/** Cranks: the referee may stop a neck that has taken enough. */
export function neckStrainRefereeStopPerS(strain: number): number {
  return strain >= FINISH_PARAMS.neckStrainRefThreshold ? FINISH_PARAMS.neckStrainRefStopPerS : 0;
}

// ---------------------------------------------------------------------------
// the injury ladder (§2.6.5)
// ---------------------------------------------------------------------------

export type InjuredJoint = 'elbow' | 'shoulder' | 'knee' | 'ankle' | 'spine' | 'hip' | 'calf' | 'hamstring';

/**
 * The abstract injury state handed to §05 (`state.joint_failure`). This chapter
 * decides *that* a joint failed and how badly; §05 owns the health model, the
 * doctor and the recovery.
 */
export interface JointFailure {
  readonly state: 'state.joint_failure';
  readonly joint: InjuredJoint;
  readonly severity: 'medium' | 'high';
  readonly cause: string;
  /** Capability loss while the state persists. */
  readonly capability: CapabilityLoss;
  /** P(the doctor stops it at the round break). */
  readonly doctorStopP: number;
  /** Career layoff for the commentary and career layers, months. */
  readonly layoffMonths: number;
}

export interface CapabilityLoss {
  /** Multiplier on strike power with the injured limb. */
  readonly strikePowerMult: number;
  /** Multiplier on how often the fighter uses it. */
  readonly strikeUsageMult: number;
  /** Logit penalty on grip-dependent grappling edges. */
  readonly gripLogit: number;
  /** Multiplier on mobility. */
  readonly mobilityMult: number;
  /** Logit penalty on takedowns. */
  readonly takedownLogit: number;
  /** Kicks with that leg. */
  readonly kicksMult: number;
  /** Effective `sk.escapes` penalty for grip-based options. */
  readonly escapeSkillPenalty: number;
}

const NO_LOSS: CapabilityLoss = {
  strikePowerMult: 1, strikeUsageMult: 1, gripLogit: 0, mobilityMult: 1,
  takedownLogit: 0, kicksMult: 1, escapeSkillPenalty: 0,
};

/** §2.6.5 capability-loss table, by limb and severity. */
export function capabilityLoss(joint: InjuredJoint, severity: 'medium' | 'high'): CapabilityLoss {
  const arm = joint === 'elbow' || joint === 'shoulder';
  if (arm) {
    return severity === 'high'
      ? { ...NO_LOSS, strikePowerMult: 0.4, strikeUsageMult: 0.3, gripLogit: -1.0, escapeSkillPenalty: 20 }
      : { ...NO_LOSS, strikePowerMult: 0.7, strikeUsageMult: 0.6, gripLogit: -0.5, escapeSkillPenalty: 10 };
  }
  if (joint === 'knee') {
    return severity === 'high'
      ? { ...NO_LOSS, mobilityMult: 0.5, takedownLogit: -1.0, kicksMult: 0 }
      : { ...NO_LOSS, mobilityMult: 0.75, takedownLogit: -0.5, kicksMult: 0.6 };
  }
  if (joint === 'ankle' || joint === 'calf' || joint === 'hamstring' || joint === 'hip') {
    return severity === 'high'
      ? { ...NO_LOSS, mobilityMult: 0.5, kicksMult: 0.4 }
      : { ...NO_LOSS, mobilityMult: 0.75, kicksMult: 0.6 };
  }
  // Spine: the twister. Everything gets worse, nothing specific breaks.
  return severity === 'high'
    ? { ...NO_LOSS, mobilityMult: 0.6, takedownLogit: -0.5, strikePowerMult: 0.8 }
    : { ...NO_LOSS, mobilityMult: 0.8 };
}

/** Build the injury state a refused lock hands to §05. */
export function jointFailure(spec: SubmissionSpec): JointFailure | null {
  const joint = spec.finishClock.injuryJoint;
  const severity = spec.finishClock.severity;
  if (!joint || !severity) return null;
  return {
    state: 'state.joint_failure',
    joint,
    severity,
    cause: spec.id,
    capability: capabilityLoss(joint, severity),
    doctorStopP: severity === 'high' ? FINISH_PARAMS.doctorStopHigh : FINISH_PARAMS.doctorStopMedium,
    layoffMonths: severity === 'high' ? FINISH_PARAMS.layoffMonthsHigh : 3,
  };
}

/**
 * After any injury the fighter stops refusing: a fighter who has felt a joint
 * go taps to the next one (§2.6.5).
 */
export function tapProfileAfterInjury(p: TapProfile): TapProfile {
  return { ...p, heart: 0, refusesToTap: false, tier: p.tier, subLosses: p.subLosses, titleFight: false };
}

// ---------------------------------------------------------------------------
// slams (§2.6.6)
// ---------------------------------------------------------------------------

export type SlamHeight = 'knees' | 'waist' | 'shoulder' | 'overhead';

export const SLAM_PARAMS = {
  pAttemptT4: 0.15,
  pAttemptWrestlerGnp: 0.30,
  minStrength: 60,
  minMassAdvantageKg: 10,
  pLiftBase: 0.6,
  /** P(the lock breaks) once the attacker is off the mat, by technique family. */
  pBreak: { triangle: 0.7, armbar: 0.8, guillotine: 0.5, omoplata: 0.6, flying: 0.8 } as const,
  heightDraw: { knees: 0.35, waist: 0.40, shoulder: 0.20, overhead: 0.05 } as const,
  /** x the hook-punch reference force (DAMAGE §3.1). */
  forceMult: { knees: 0.8, waist: 1.2, shoulder: 1.6, overhead: 2.0 } as const,
  overheadMinStrength: 80,
  /** DAMAGE §3.1 hook reference force, newtons. */
  hookReferenceN: 4400,
  /** A slam this close to unconsciousness no longer saves the defender. */
  tooLateS: 2,
} as const;

/**
 * `StrikeImpact` as 02 §2.6.5 defines it, narrowed to what a slam sets.
 *
 * TODO(chapter 02): when `src/sim/striking/impact.ts` lands, replace this with
 * `import type { StrikeImpact }` - the field names here are already 02's, so
 * the swap is a one-line change and nothing else in this file moves.
 */
export interface SlamImpact {
  tick: number;
  subTickMs: number;
  attacker: number;
  target: number;
  tech: 'slam';
  weapon: 'mat';
  region: 'head' | 'body';
  subLocation: 'topback' | 'sternum';
  placement: 'flush';
  forceN: number;
  vRel: number;
  effMassKg: number;
  absorb: 0;
  defence: 'none';
  seen: false;
  counter: false;
  simultaneous: false;
  closingSpeedMs: 0;
  attackerState: { rocked: boolean; fatigue: number };
  targetState: {
    midAction: boolean; mouthOpen: boolean; guardHand: 'up' | 'away';
    braced: boolean; grounded: true;
  };
  posture: 'groundTop';
  gloveType: 'mma4oz' | 'boxing8oz' | 'boxing10oz' | 'boxing12oz' | 'bare';
}

/** Which `pBreak` row a submission uses. */
export function slamBreakFamily(subId: string): keyof typeof SLAM_PARAMS.pBreak {
  if (subId.includes('flying')) return 'flying';
  if (subId.includes('omoplata')) return 'omoplata';
  if (subId.includes('guillotine')) return 'guillotine';
  if (subId.includes('armbar')) return 'armbar';
  return 'triangle';
}

/** Is the slam option even on the table for this defender (§2.6.6)? */
export function slamAvailable(
  defender: SubFighter,
  attacker: SubFighter,
  ruleset: { slamsLegal: boolean; slamsOnlyFromLockedSub?: boolean },
  locked: boolean,
): boolean {
  if (!ruleset.slamsLegal) return false;
  if (ruleset.slamsOnlyFromLockedSub && !locked) return false;
  return defender.strength >= SLAM_PARAMS.minStrength
    || defender.massKg - attacker.massKg >= SLAM_PARAMS.minMassAdvantageKg;
}

export function pSlamAttempt(defender: SubFighter): number {
  return defender.wrestlerGnp ? SLAM_PARAMS.pAttemptWrestlerGnp : SLAM_PARAMS.pAttemptT4;
}

/** P(the lift comes off), reusing the M_STR_DEF and M_MASS coefficients. */
export function pSlamLift(defender: SubFighter, attacker: SubFighter): number {
  const P = MODIFIER_PARAMS;
  const x = logit(SLAM_PARAMS.pLiftBase)
    + P.kStrDef * (defender.strength - attacker.strength) / 10
    + P.kMass * (defender.massKg - attacker.massKg) / 5
    - 0.3 * defender.fatigue;
  return sigmoid(x);
}

export function slamHeight(u: number, strength: number): SlamHeight {
  const d = SLAM_PARAMS.heightDraw;
  let acc = d.knees;
  if (u < acc) return 'knees';
  acc += d.waist;
  if (u < acc) return 'waist';
  acc += d.shoulder;
  if (u < acc) return 'shoulder';
  // Overhead needs the strength to get there; otherwise it is a shoulder slam.
  return strength >= SLAM_PARAMS.overheadMinStrength ? 'overhead' : 'shoulder';
}

export interface SlamResult {
  readonly attempted: boolean;
  readonly lifted: boolean;
  readonly lockBroken: boolean;
  readonly height: SlamHeight;
  readonly impact: SlamImpact | null;
}

/**
 * Resolve one `def.slam` option (§2.6.6). Four draws, always consumed in the
 * order 09 §2.7 fixes: `slamAttempt`, `lift`, `lockBreak`, `height`. The
 * resulting `StrikeImpact` is handed to §05, which owns everything that happens
 * to the body afterwards.
 */
export function resolveSlam(
  rng: RandomSource,
  opts: {
    spec: SubmissionSpec;
    attacker: SubFighter;
    defender: SubFighter;
    attackerId: number;
    defenderId: number;
    tick: number;
    subTickMs: number;
    arena?: Pick<Arena, 'surfaceHardness'>;
    gloveType?: SlamImpact['gloveType'];
    /** Slamming a fighter this close to being choked out no longer helps. */
    secondsToLoc?: number;
  },
): SlamResult {
  const uAttempt = rng.next();
  const uLift = rng.next();
  const uBreak = rng.next();
  const uHeight = rng.next();

  const height = slamHeight(uHeight, opts.defender.strength);
  const attempted = uAttempt < pSlamAttempt(opts.defender);
  if (!attempted) return { attempted: false, lifted: false, lockBroken: false, height, impact: null };

  const lifted = uLift < pSlamLift(opts.defender, opts.attacker);
  if (!lifted) return { attempted: true, lifted: false, lockBroken: false, height, impact: null };

  const breakP = SLAM_PARAMS.pBreak[slamBreakFamily(opts.spec.id)];
  let lockBroken = uBreak < breakP;
  // Past this point the choke finishes regardless of what the mat does.
  if (opts.secondsToLoc !== undefined && opts.secondsToLoc <= SLAM_PARAMS.tooLateS) lockBroken = false;

  const hardness = opts.arena?.surfaceHardness ?? 1.0;
  const forceN = SLAM_PARAMS.forceMult[height] * SLAM_PARAMS.hookReferenceN * hardness;
  // The head hits on a guard-position slam; a standing-guillotine dump lands on
  // the upper back instead.
  const headLanding = opts.spec.id !== 'sub.guillotine_standing';

  const impact: SlamImpact = {
    tick: opts.tick,
    subTickMs: opts.subTickMs,
    attacker: opts.defenderId, // the slammer is the submission's defender
    target: opts.attackerId,
    tech: 'slam',
    weapon: 'mat',
    region: headLanding ? 'head' : 'body',
    subLocation: headLanding ? 'topback' : 'sternum',
    placement: 'flush',
    forceN,
    vRel: 0,
    effMassKg: opts.attacker.massKg,
    absorb: 0,
    defence: 'none',
    seen: false,
    counter: false,
    simultaneous: false,
    closingSpeedMs: 0,
    attackerState: { rocked: opts.defender.rocked, fatigue: opts.defender.fatigue },
    targetState: {
      midAction: true, mouthOpen: false, guardHand: 'away', braced: false, grounded: true,
    },
    posture: 'groundTop',
    gloveType: opts.gloveType ?? 'mma4oz',
  };

  return { attempted: true, lifted: true, lockBroken, height, impact };
}

// ---------------------------------------------------------------------------
// von Flue and mutual exposure (§2.6.6)
// ---------------------------------------------------------------------------

/**
 * P(the guillotine attacker lets go before the von Flue closes), per window.
 * The whole counter exists because low-tier fighters will not let go of a
 * choke that is already lost.
 */
export function vonFlueReleaseP(attackerTier: Tier): number {
  if (attackerTier >= 3) return 0.8;
  if (attackerTier === 2) return 0.4;
  return 0.1;
}

/**
 * Resolution order in a mutual leg entanglement (50-50, cross-ashi): the better
 * leg locker resolves first, ties broken by the lower fighter index so the
 * order never depends on iteration order (§2.4.3).
 */
export function mutualResolutionOrder(
  a: { id: number; legLocks: number },
  b: { id: number; legLocks: number },
): [number, number] {
  if (a.legLocks > b.legLocks) return [a.id, b.id];
  if (b.legLocks > a.legLocks) return [b.id, a.id];
  return a.id <= b.id ? [a.id, b.id] : [b.id, a.id];
}

/** Two strikes landed inside one window force the attacker to consider letting go. */
export const MUTUAL_STRIKE_ABANDON_P = 0.2;
/** Ground strikes land at this rate inside an entanglement [S: BJJ_POS §7.3]. */
export const STRIKE_LANDED_RATE = 0.586;
/** Damage multipliers for strikes thrown from or into an entanglement. */
export const STRIKE_DMG_MULT = { topIntoEntanglement: 0.6, insideTriangle: 0.3 } as const;
