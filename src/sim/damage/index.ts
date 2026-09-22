/**
 * DAMAGE, FATIGUE AND CONSCIOUSNESS — design chapter 05.
 *
 * Everything that happens to a fighter's body and nervous system *after* a
 * strike, throw or submission has been resolved, and everything that happens to
 * their energy supply *while* they act.
 *
 *   impact.ts        the `StrikeImpact` contract (chapter 02 owns it)
 *   regions.ts       six pools, sub-sites, thresholds, states, capability table
 *   ko.ts            delivered force -> rotational equivalent -> KD/KO model
 *   fatigue.ts       the three-pool energy model and its capability effects
 *   state.ts         `DamageState`: pools + states + timers + the ten-draw block
 *   observables.ts   `RefObservables`, the frozen cue contract with chapter 06
 *   profile.ts       the chapter-01 inputs this module reads
 *   tuning.ts        the parameter-registry reader
 *
 * The three rules the rest of the sim depends on:
 *  1. Nobody outside this module reads a raw pool. 06 reads `observables()`,
 *     02/03/04/07 read `caps`, the presenter reads `snapshotFields()`.
 *  2. `applyImpact` consumes exactly ten RNG draws, always, in the §2.10 order.
 *  3. `upkeep` and `roundBreak` consume none: decay, timers and `caps` are
 *     deterministic functions of (dt, state, parameters).
 */
export type {
  ArmSite, BodySite, ElbowArc, GloveType, HeadSite, ImpactDefence, ImpactPlacement, ImpactPosture,
  ImpactRegion, ImpactSite, ImpactWeapon, LegSite, PunchKind, StrikeImpact, WeaponClass,
} from './impact';
export { elbowArc, isLegRegion, punchKind, weaponClass } from './impact';

export type {
  CapabilityMultipliers, Cut, CutSite, DamageStateBase, DecayConfig, Joint, LegPools, LegSubPool,
  RegionSet, ScalarCaps, Side, SideMult,
} from './regions';
export {
  DAMAGE_STATE_IDS, HEAD_SITES, BODY_SITES, LEG_SITES, ARM_SITES, JOINTS, RegionPool, S, SIDES,
  acuteAttrMult, baseOf, bleedsIntoEye, combinedMovement, cutSide, cutSiteFor, isBrowZone,
  legCheckSpeed, legKickPower, legKickRate, legLoad, legMobility, legSeverity, legTdd,
  massScaleTarget, multiplyScalar, neutralCaps, newLegPools, newRegionSet, rearHandPower,
  recoveryHalfLifeMult, shinPenalty, sideId, stateCaps, visionCaps, visionFor,
} from './regions';

export type { AlphaBreakdown, AlphaContext, CareerWrites, ConcussiveOutcome, FrontEnd, OutcomeWeights, OutcomeWindows } from './ko';
export {
  alphaEquivalent, attackerLimbSide, computeAbsorb, concussionProbability, emptyCareerWrites,
  footInjuryProbability, frontEnd, handInjuryProbability, koWeaponKey, outcomeWeights,
  outcomeWindows, recordKnockout, splitOutcome,
} from './ko';

export type { BreakOptions, ChargeOptions, ChargeRate, EnergyContext, FatigueCaps, TechClass } from './fatigue';
export { CLASS_RATE, EnergyState, fatigueCaps, isGrapplePosture } from './fatigue';

export type {
  ActiveState, AttackerInjury, ImpactContext, ImpactResult, RoundBreakOptions, UpkeepContext,
} from './state';
export { DamageState, STATE_BITS } from './state';

export type {
  CollapseCue, EyesCue, FractureFlag, KnockdownCue, LegsCue, ReactionCue, RefCut, RefObservables,
} from './observables';
export {
  ABSORBED_WINDOW_S, INTELLIGENT_DEFENCE_WINDOW_S, KNOCKDOWN_WINDOW_S, NO_REACTION_WINDOW_S,
  STATIC_COVER_LIMIT_S, emptyObservables,
} from './observables';

export type { EnergyComposites, EventMagnitude, FighterDamageProfile } from './profile';
export {
  chinEffFrom, defaultProfile, experienceFrom, koHistoryMult, profileFromDefinition,
} from './profile';

export type { ParamSource } from './tuning';
export {
  Tuning, clamp, damageDefaults, decayBy, defaultTuning, lerpDraw, sigmoid, tuningFrom, tuningWith,
} from './tuning';
