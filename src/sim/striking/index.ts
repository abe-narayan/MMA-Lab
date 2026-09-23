/**
 * STRIKING MODULE — chapter 02 (docs/design/02_STRIKING.md).
 *
 * Owns everything that happens while both fighters are standing and not tied
 * up: range geometry, the 54-technique catalogue, timing, combinations and
 * feints, the reactive defence layer, counters, and hit resolution up to the
 * point where a landed strike becomes a `StrikeImpact` for chapter 05.
 *
 * Not owned here: damage application and the KO logistic (05), clinch and
 * takedowns (03), technique and target selection (07). Those boundaries are
 * marked `TODO(chapter NN)` where this module has to name them.
 *
 * `StrikeImpact` is the public type: it is the frozen contract with 05
 * (§2.6.5), repeated verbatim in 05 §2.1.
 */

export type {
  Weapon, TargetRegion, RangeBand, TechniqueFamily, Limb, CommitClass, SkillAlias,
  TechniqueFlag, Commitment, TechniqueSpec, GloveType, GloveModifiers, StrikingRulesetFlags,
} from './catalogue';
export {
  TECHNIQUES, REFERENCE_MASS_KG, BAND_ORDER, GLOVE_MODIFIERS,
  technique, hasTechnique, techniquesInBand, techniquesForTier, totalMs,
  isRotational, isKickFamily, skillGapK, isBoxingGlove, gloveLandLogit, techniqueLegal,
} from './catalogue';

export type {
  Stance, ReachProfile, BandLimits, RangeFit, BladednessEffects, AngleEffects, LeadFootState,
  StanceRule, WeightClassScale, CageZone, CageEffects, CutoffInput, CutoffState, MovementSpec,
  FamiliarityPenalty,
} from './range';
export {
  GEOM, BAND_BOUNDS, RANGE_FIT, BLADED, ANGLE, LEAD_FOOT, STANCE_MATCHUP, STANCE_FAMILIARITY,
  REACH, REACH_CLASS_SCALE, CAGE, CUTOFF, MOVEMENTS, FEET_CROSS_P, FEET_CROSS_MS,
  reachProfile, bandLimits, bandFor, reachShellM, rangeFit, bandReachable, bladednessEffects, angleEffects,
  isOpenStance, leadFootBattle, stanceMatchupLogit, stanceRuleFor, stanceFamiliarity,
  familiarityPenalty, reachAccuracyLogit, cageZone, cageEffects, cutoffState,
} from './range';

export type {
  StrikeClass, GuardId, GuardColumn, GuardSpec, DefenceOutcome, CounterQuality,
  DefenceSpec, LatencyInput, PatternReadInput, CueReadInput, AvailabilityInput,
} from './defence';
export {
  GUARDS, DEFENCES, REACT, READ, PASSIVE, READ_BASE_BY_TIER, HURT_PENALTY_BY_TIER,
  guard, defence, hasDefence, defencesAgainst, defenceSuccessFor, defenceExecMs,
  guardColumnFor, guardLogit, strikeClasses, reactionLatencyMs, patternReadP, cueReadP,
  anticipationLeadMs, defenceWindowMs, availableDefences, rankDefences,
  counterOnReadP, feintBiteP, passiveBlockP, sigmoid, logit,
} from './defence';

export type {
  ChainCheck, SetupState, ComboToken, ComboStep, ComboSpec, FeintId, FeintSpec, BiteInput, Beat,
} from './combos';
export {
  CHAIN, COMBO_CAP_BY_TIER, ILLEGAL_CHAIN_RATE_BY_TIER, COMBINATIONS, FEINT, FEINTS,
  FEINT_RATE_BY_TIER, RHYTHM, RhythmTracker, SETUP_WINDOWS,
  chainStep, nextLaunchOffsetMs, chainDurationMs, comboStepBonus, setupLogit, dutchGateOpen,
  comboCap, combination, combinationsForTier, comboSpecs, feint, feintsForTier,
  feintBiteProbability, feintBonus, setupFlagFor,
} from './combos';

export type {
  StrikeOutcomeForWindow, CounterWindow, CounterId, CounterSpec, SimultaneousOutcome,
  KickCatchRule, CatchTreeOption, HabitualReturnState,
} from './counters';
export {
  CTR, COUNTERS, OWNED_COUNTERS, CATCH_TREE, CATCH_ESCAPES,
  counterWindow, realisedCounterBonus, genericCounterBonus, counter, countersAgainst,
  bestCounterFor, counterMatrixReferencesValid, simultaneousCounter, closingForceMult,
  catchTreeFor, delayedCounter,
} from './counters';

// The public type: the frozen 02 <-> 05 contract (§2.6.5).
export type {
  StrikeImpact, HeadSite, BodySite, LegSite, ArmSite, SubLocation, Placement,
  ImpactDefence, ImpactPosture, ReferenceDefenceMix, ReferenceFamily, ArrivalContext,
  PlacementFamily, PlacementContext, SubLocationFamily, CommitMode, ForceContext,
  StrikeOutcome, ResolvedDefence, StrikeResolveInput, StrikeResolution,
} from './resolve';
export {
  PA, REFERENCE_MIX, PA_FIRST_PASS, ARRIVAL, PLACEMENT_BASE, PLACEMENT, SUB_HEAD, SUB_BODY,
  FORCE, DRAWS_PER_STRIKE, BLOCKED_COUNTS_LANDED_P, FAILED_EVASION_FLUSH_ADD,
  solvePA, arrivalBase, referenceFamilyFor, arrivalLogit, placementFamilyFor, placementWeights,
  subLocationFamilyFor, subLocationWeights, commitMult, tierForceMult, powerMult, massMult,
  fatigueForceMult, relativeVelocity, effectiveMass, forceScale, resolveStrike, pickWeighted,
  referenceDefenderInput, marginalLandP, arrivalSkillK, baseDefenceSuccess,
} from './resolve';
