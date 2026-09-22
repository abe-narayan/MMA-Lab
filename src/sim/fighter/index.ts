/**
 * Public surface of the fighter module (design chapter 01).
 *
 * Every other sim module imports fighters through this barrel and nothing else;
 * `src/sim/index.ts` re-exports it to the app and presentation layers
 * (09 §1.1). Adding to this list is additive by contract — removing from it is
 * a breaking change to the replay schema.
 */

export {
  TIER_NAMES,
  WEIGHT_CLASS_LIMIT_KG,
  DISCIPLINE_IDS,
  STRIKING_DISCIPLINES,
  GRAPPLING_DISCIPLINES,
  SUB_SKILLS,
  buildBlendOf,
  recordTotal,
  weightClassFor,
} from './types';

export type {
  Sex, Stance, Handedness, Build, BuildBlend, SkillTier, WeightClassId,
  DisciplineId, CoreDisciplineId,
  BoxingSkills, MuayThaiSkills, KickboxingSkills, WrestlingSkills, JudoSkills, BjjSkills,
  KarateSkills, SamboSkills, TaekwondoSkills, MmaIntegrationSkills,
  CompetitionLevel, DisciplineCompetition, DisciplineSkills, FighterDisciplines,
  BodySpec, AppearanceSpec, HairLength, FacialHairId, TattooSlot, ShortsStyle, GloveType,
  PhysicalAttributes, MentalAttributes,
  FightRecord, LastResult, WeightCut, CareerRecord,
  PrimaryMode, RangeBand, Initiative, HurtBehaviour, LosingBehaviour, TiredBehaviour,
  GuardStyle, ThaiStyle, TakedownSetup, BottomPriority, TopPriority,
  WeightedTechnique, ComboSpec, WeightedSubmission, TakedownStyle, StyleSpec,
  FighterDefinition,
} from './types';

export {
  TIER_SKILL_BANDS,
  TIER_YEARS_BANDS,
  IQ_BANDS,
  EXEC_TIME_MULT,
  TELEGRAPH_MOD,
  HIP_ROTATION_MULT,
  TIER_ENERGY_COST_MULT,
  ANIMATION_TAGS,
  TIER_BEHAVIOUR_CATALOGUE,
  tierBySkill,
  tierByYears,
  tierOf,
  iqTierOf,
  rulesFor,
  ruleById,
  animationTagsFor,
} from './tiers';

export type {
  BehaviourDomain, TierKey, TierBehaviourRule, TierSource, TierGateInput, RulesForOptions,
} from './tiers';

export {
  TRANSFER_MATRIX,
  WRESTLING_BACKGROUND_OFFSETS,
  ageMultiplier,
  ageChinPenalty,
  deriveRuntime,
  regainPctFor,
} from './derive';

export type {
  TransferRule, AgeCurve, RigProportions, EffectiveAttributes, PowerIndex,
  GrapplingComposites, EnergyComposites, AnticipationDomain, AnticipationBlock,
  DisciplineRuntime, CareerAdjustments, FighterRuntime, DeriveContext,
} from './derive';

export {
  ARCHETYPES,
  ARCHETYPE_IDS,
  PRESET_ID_ALIASES,
  resolvePresetId,
  ARCH_ELITE_WRESTLER_BOXER,
  ARCH_THAI_STRIKER,
  ARCH_BJJ_GUARD_PLAYER,
  ARCH_JUDOKA,
  ARCH_PRESSURE_BOXER,
  ARCH_COUNTER_STRIKER,
  ARCH_BRAND_NEW_BRAWLER,
  ARCH_GYM_FIT_BEGINNER,
  ARCH_REGIONAL_PRO_ALLROUNDER,
  ARCH_AGEING_VETERAN,
  ARCH_HEAVYWEIGHT_POWER_PUNCHER,
  ARCH_FLYWEIGHT_VOLUME_STRIKER,
  ARCH_SAMBO_GRAPPLER,
  ARCH_TKD_CONVERT,
  ARCH_CHAMPION_COMPLETE,
} from './archetypes';

export { fromLegacyProfile, yearsToSkill } from './legacy';
export type { AthleteProfile } from './legacy';
