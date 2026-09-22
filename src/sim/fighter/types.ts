/**
 * FIGHTER DEFINITION — what the creator edits, what a replay stores.
 *
 * This is the authored, serialisable description of a fighter. It is never
 * mutated during a bout: the sim derives a `FighterRuntime` from it once, and
 * everything that changes (damage, fatigue, position, plan) lives there.
 *
 * Owner: design chapter 01. See docs/design/01_FIGHTER_MODEL.md.
 *
 * Attribute convention (00_CONVENTIONS §3): every attribute and sub-skill is
 * 0-100, where 50 is an average trained professional in that weight class, 80+
 * is elite and 95+ is an outlier. Tiers T0-T5 are derived, never authored.
 *
 * Nothing here is a function or a class: a definition must survive
 * `JSON.parse(JSON.stringify(def))` unchanged, because a replay file stores
 * fighters whole rather than by reference (09 §1.3.1).
 *
 * Chapter 01 names a few fields differently from the skeleton this file grew
 * from; where that happened the original name is authoritative and the
 * chapter's name is documented on the field (`yearsTrained` = `years`,
 * `native` = `sub`, `neck` = `neckStrength`). Everything else is additive.
 */

export type Sex = 'male' | 'female';
export type Stance = 'orthodox' | 'southpaw' | 'switch';
export type Handedness = 'right' | 'left';

/** Legacy single-label somatotype. Chapter 01 §2.1 prefers the blend below. */
export type Build = 'ectomorph' | 'mesomorph' | 'endomorph';

/** Somatotype as a blend summing to 1 (01 §2.1). Drives rig proportions only. */
export interface BuildBlend {
  ecto: number;
  meso: number;
  endo: number;
}

/** Per-discipline tier, derived from sub-skills and years (01 §2.3.4). */
export type SkillTier = 0 | 1 | 2 | 3 | 4 | 5;

export const TIER_NAMES: Readonly<Record<SkillTier, string>> = Object.freeze({
  0: 'Brand new',
  1: 'Beginner',
  2: 'Amateur',
  3: 'Regional pro',
  4: 'Elite',
  5: 'Champion',
});

/**
 * Weight classes of the Unified Rules (01 §2.1, `[S: RJ §2.2]`). Boxing and
 * kickboxing rulesets map onto the same ids, so a bout never has to translate
 * between two class vocabularies.
 */
export type WeightClassId =
  | 'wc.atomweight' | 'wc.strawweight' | 'wc.flyweight' | 'wc.bantamweight' | 'wc.featherweight'
  | 'wc.lightweight' | 'wc.super_lightweight' | 'wc.welterweight' | 'wc.super_welterweight'
  | 'wc.middleweight' | 'wc.super_middleweight' | 'wc.light_heavyweight' | 'wc.cruiserweight'
  | 'wc.heavyweight' | 'wc.super_heavyweight' | 'wc.open';

/** Upper limit of each class in kg (01 §2.1). `wc.open` has none. */
export const WEIGHT_CLASS_LIMIT_KG: Readonly<Record<WeightClassId, number>> = Object.freeze({
  'wc.atomweight': 47.6,
  'wc.strawweight': 52.2,
  'wc.flyweight': 56.7,
  'wc.bantamweight': 61.2,
  'wc.featherweight': 65.8,
  'wc.lightweight': 70.3,
  'wc.super_lightweight': 74.8,
  'wc.welterweight': 77.1,
  'wc.super_welterweight': 79.4,
  'wc.middleweight': 83.9,
  'wc.super_middleweight': 88.5,
  'wc.light_heavyweight': 93.0,
  'wc.cruiserweight': 102.1,
  'wc.heavyweight': 120.2,
  'wc.super_heavyweight': 140.0,
  'wc.open': Number.POSITIVE_INFINITY,
});

export type DisciplineId =
  | 'boxing' | 'muayThai' | 'kickboxing' | 'karate' | 'taekwondo'
  | 'wrestling' | 'judo' | 'bjj' | 'sambo' | 'mma' | 'mmaIntegration';

/**
 * The ten disciplines chapter 01 §2.3 models. `mma` is kept as an accepted
 * alias of `mmaIntegration` so definitions written against the skeleton schema
 * still load; `deriveRuntime` folds it into `mmaIntegration`.
 */
export const DISCIPLINE_IDS = [
  'boxing', 'muayThai', 'kickboxing', 'karate', 'taekwondo',
  'wrestling', 'judo', 'bjj', 'sambo', 'mmaIntegration',
] as const;

export type CoreDisciplineId = (typeof DISCIPLINE_IDS)[number];

/** Disciplines that count toward `strikingMean` (01 §2.3.4). */
export const STRIKING_DISCIPLINES = ['boxing', 'muayThai', 'kickboxing', 'karate', 'taekwondo'] as const;
/** Disciplines that count toward `grapplingMean` (01 §2.3.4). */
export const GRAPPLING_DISCIPLINES = ['wrestling', 'judo', 'bjj', 'sambo'] as const;

// --------------------------------------------------------------------------
// Sub-skill sets (01 §2.3.1). Declared as type *aliases*, not interfaces, so
// they keep TypeScript's implicit index signature and stay assignable to the
// `Record<string, number>` the generic definition schema stores.
// --------------------------------------------------------------------------

export type BoxingSkills = {
  jab: number; power: number; combinations: number; headMovement: number; footwork: number;
  guard: number; bodyWork: number; counters: number; feints: number; ringCraft: number;
};
export type MuayThaiSkills = {
  kicks: number; teep: number; knees: number; elbows: number; clinch: number;
  checks: number; catches: number; hands: number;
};
export type KickboxingSkills = {
  punches: number; kicks: number; lowKicks: number; combinations: number; footwork: number;
  checks: number; spinning: number; defence: number;
};
export type WrestlingSkills = {
  shots: number; takedownDefence: number; topControl: number; scrambles: number; cageWrestling: number;
  clinch: number; chains: number; finishes: number; getUps: number; matReturns: number;
};
export type JudoSkills = {
  gripFighting: number; throws: number; footSweeps: number; counters: number; kuzushi: number;
  newaza: number; ukemi: number;
};
export type BjjSkills = {
  guard: number; passing: number; topControl: number; backControl: number; chokes: number;
  jointLocks: number; legLocks: number; escapes: number; sweeps: number; subDefence: number;
  subAttack: number; wrestleUps: number;
};
export type KarateSkills = {
  distanceControl: number; blitz: number; kicks: number; counters: number; footwork: number; timing: number;
};
export type SamboSkills = {
  throws: number; takedowns: number; legLocks: number; gripFighting: number; topControl: number;
  transitions: number; strikingToGrappling: number;
};
export type TaekwondoSkills = {
  kicks: number; headKicks: number; spinning: number; footwork: number; distance: number; counters: number;
};
export type MmaIntegrationSkills = {
  levelChanges: number; clinchStriking: number; cageWork: number; groundAndPound: number; getUps: number;
  transitions: number; subDefenceUnderStrikes: number; gameplanExecution: number;
};

/** The sub-skill names of every discipline, in catalogue order (01 §2.3.1). */
export const SUB_SKILLS: Readonly<Record<CoreDisciplineId, readonly string[]>> = Object.freeze({
  boxing: ['jab', 'power', 'combinations', 'headMovement', 'footwork', 'guard', 'bodyWork', 'counters', 'feints', 'ringCraft'],
  muayThai: ['kicks', 'teep', 'knees', 'elbows', 'clinch', 'checks', 'catches', 'hands'],
  kickboxing: ['punches', 'kicks', 'lowKicks', 'combinations', 'footwork', 'checks', 'spinning', 'defence'],
  wrestling: ['shots', 'takedownDefence', 'topControl', 'scrambles', 'cageWrestling', 'clinch', 'chains', 'finishes', 'getUps', 'matReturns'],
  judo: ['gripFighting', 'throws', 'footSweeps', 'counters', 'kuzushi', 'newaza', 'ukemi'],
  bjj: ['guard', 'passing', 'topControl', 'backControl', 'chokes', 'jointLocks', 'legLocks', 'escapes', 'sweeps', 'subDefence', 'subAttack', 'wrestleUps'],
  karate: ['distanceControl', 'blitz', 'kicks', 'counters', 'footwork', 'timing'],
  sambo: ['throws', 'takedowns', 'legLocks', 'gripFighting', 'topControl', 'transitions', 'strikingToGrappling'],
  taekwondo: ['kicks', 'headKicks', 'spinning', 'footwork', 'distance', 'counters'],
  mmaIntegration: ['levelChanges', 'clinchStriking', 'cageWork', 'groundAndPound', 'getUps', 'transitions', 'subDefenceUnderStrikes', 'gameplanExecution'],
});

export type CompetitionLevel = 'none' | 'local' | 'national' | 'international';

export interface DisciplineCompetition {
  bouts: number;
  wins: number;
  level: CompetitionLevel;
}

/**
 * One discipline's stored experience (01 §2.3). `years` is the chapter's
 * `yearsTrained`; `sub` is the chapter's `native` map. Nothing derived is
 * stored here — `effective`, `mean` and `tier` live on the runtime.
 */
export interface DisciplineSkills<S extends Record<string, number> = Record<string, number>> {
  /** Years trained, used for the tier derivation and the experience prior. */
  years: number;
  /** Named sub-skills; the set differs per discipline (see 01 §2.3). */
  sub: S;
  /** 0.6 hobbyist … 1.15 elite camp (01 §2.3.2). Defaults to 1.0. */
  trainingQuality?: number;
  /** Discipline-specific tags, e.g. wrestling `folkstyle`, Thai `muayFemur`. */
  styleTags?: string[];
  competition?: DisciplineCompetition;
}

/**
 * Per-discipline blocks with their sub-skill names typed. The intersection with
 * the generic record keeps the block assignable to the loose schema a JSON
 * import produces, while giving the creator and the archetypes real key
 * checking.
 */
export type FighterDisciplines = Partial<Record<DisciplineId, DisciplineSkills>> & {
  boxing?: DisciplineSkills<BoxingSkills>;
  muayThai?: DisciplineSkills<MuayThaiSkills>;
  kickboxing?: DisciplineSkills<KickboxingSkills>;
  wrestling?: DisciplineSkills<WrestlingSkills>;
  judo?: DisciplineSkills<JudoSkills>;
  bjj?: DisciplineSkills<BjjSkills>;
  karate?: DisciplineSkills<KarateSkills>;
  sambo?: DisciplineSkills<SamboSkills>;
  taekwondo?: DisciplineSkills<TaekwondoSkills>;
  mmaIntegration?: DisciplineSkills<MmaIntegrationSkills>;
};

export interface BodySpec {
  heightM: number;
  /** Fingertip-to-fingertip span; the creator may derive it from height. */
  reachM: number;
  /** Hip-to-floor, drives kick range. */
  legReachM: number;
  /** Fight-night mass. Kept as the single required mass for older definitions. */
  massKg: number;
  ageYears: number;
  bodyFatPct: number;
  build: Build | BuildBlend;
  stance: Stance;
  handedness: Handedness;

  // --- chapter 01 §2.1 additions -----------------------------------------
  sex?: Sex;
  /** Official weigh-in mass. Defaults to `massKg` (no cut modelled). */
  weighInKg?: number;
  /** Mass at the first bell after regain. Defaults to `massKg`. */
  fightNightKg?: number;
  /** Derived from `weighInKg` when omitted, unless the ruleset is open-weight. */
  weightClass?: WeightClassId;
  /** Defaults to the handedness side. */
  dominantLeg?: 'right' | 'left';
}

export type HairLength = 'shaved' | 'short' | 'medium' | 'tied';
export type FacialHairId = 'none' | 'stubble' | 'goatee' | 'full' | 'moustache';
export type TattooSlot =
  | 'leftArmFull' | 'rightArmFull' | 'leftForearm' | 'rightForearm' | 'chest' | 'stomach'
  | 'back' | 'neck' | 'leftLeg' | 'rightLeg' | 'leftCalf' | 'rightCalf';
export type ShortsStyle = 'mma_short' | 'vale_tudo' | 'boxing_trunk' | 'thai_short' | 'compression';
export type GloveType = 'mma_4oz' | 'boxing_8oz' | 'boxing_10oz' | 'kb_10oz' | 'bare';

/**
 * Appearance (01 §2.1.1). Read only by chapter 08; no field here may ever enter
 * a simulation formula. Glove *type* is normally set by the ruleset — this
 * field is the visual override.
 */
export interface AppearanceSpec {
  skinTone: number;
  hair: string;
  face: string;
  tattoos: string[];
  shorts: string;
  gloves: string;
  /** Free-text nickname shown on the HUD. */
  nickname?: string;

  // --- chapter 01 §2.1.1 additions ---------------------------------------
  hairStyle?: { styleId: string; colorId: string; length: HairLength };
  facialHair?: FacialHairId;
  facePreset?: number;
  faceMorphs?: Record<string, number>;
  tattooPlacements?: Array<{ slot: TattooSlot; textureId: string; tint?: string }>;
  shortsKit?: {
    style: ShortsStyle; primary: string; secondary: string; trim: string; sponsorSet?: string;
  };
  gloveKit?: { type: GloveType; color: string };
  handWrapColor?: string;
  mouthguardColor?: string;
  shinGuards?: boolean;
  /** ISO country code for chyrons. */
  flag?: string;
}

/**
 * The fourteen physical attributes of 01 §2.2, 0-100 each.
 *
 * `neckStrength` is the chapter's `neck` (05's KO model reads it directly,
 * `[S: DP §3.2 Collins 2014]`); `gripStrength` is carried from the skeleton and
 * feeds 03's grip edges.
 */
export interface PhysicalAttributes {
  strength: number;
  explosiveness: number;
  speed: number;
  handSpeed: number;
  kickSpeed: number;
  cardio: number;
  chin: number;
  bodyToughness: number;
  recovery: number;
  flexibility: number;
  balance: number;
  /** Higher is better; converted to a latency in ms by 01 §2.2.1. */
  reactionTime: number;
  gripStrength: number;
  neckStrength: number;
}

/** 0-100 each (01 §2.5). */
export interface MentalAttributes {
  fightIQ: number;
  aggression: number;
  composure: number;
  heart: number;
  discipline: number;
  adaptability: number;
}

/** One line of a career record (01 §2.4). */
export interface FightRecord {
  wins: number;
  losses: number;
  draws?: number;
  noContests?: number;
  koWins?: number;
  subWins?: number;
  decWins?: number;
  koLosses?: number;
  subLosses?: number;
  decLosses?: number;
}

export type LastResult = 'win' | 'loss' | 'draw' | 'none';

/** Fight-week weight management (01 §2.4.4). */
export interface WeightCut {
  /** Mass lost during fight week, % of walk-around mass. */
  cutPct: number;
  /** Mass regained after the weigh-in, % of weigh-in mass. */
  regainPct: number;
  /** 0-0.05; 05 reads it for the aerobic/PCr/chin penalties (`[S: DP §4.7]`). */
  residualDehydration: number;
}

/**
 * Record, experience and career state (01 §2.4). The flat counters are the
 * skeleton's; the `pro` / `amateur` blocks are chapter 01's richer form and win
 * where both are present.
 */
export interface CareerRecord {
  proWins: number;
  proLosses: number;
  proDraws: number;
  amWins: number;
  amLosses: number;
  /** Losses by knockout; feeds the chin decay in 01 §2.4.3. */
  koLosses: number;
  /** Knockdowns suffered across the career. */
  knockdownsSuffered: number;
  titleFights: number;
  /** Months since the last bout; long layoffs cost performance (LIT_B). */
  layoffMonths: number;
  bigFightComposure: number;

  // --- chapter 01 §2.4 additions -----------------------------------------
  pro?: FightRecord;
  amateur?: FightRecord;
  /** Preferred over `layoffMonths` when present. */
  daysSinceLastBout?: number;
  /** Days of camp when replacing an opponent; < 21 is short notice. */
  shortNoticeDays?: number;
  lastResult?: LastResult;
  lastResultWasKoLoss?: boolean;
  /** Bouts contested against each stance; drives `stanceFamiliarity`. */
  stanceExposure?: { orthodox: number; southpaw: number };
  weightCut?: WeightCut;
  winStreak?: number;
}

/**
 * Plan archetype. The first nine values are the skeleton's; the six `MIS §6.2`
 * modes chapter 01 §2.6 names are added because 07 keys its plan table on them.
 */
export type PrimaryMode =
  | 'pressure' | 'counter' | 'pointFighter' | 'volume' | 'power'
  | 'grinder' | 'scrambler' | 'guardPlayer' | 'allRounder'
  | 'distanceStriking' | 'pressureStriking' | 'wrestleControl' | 'clinchGrind' | 'submissionHunt';

export type RangeBand = 'long' | 'mid' | 'short' | 'close' | 'clinch' | 'ground';
export type Initiative = 'pressure' | 'counter' | 'point' | 'balanced';
export type HurtBehaviour =
  | 'coverOnCage' | 'clinch' | 'shoot' | 'circleOut' | 'trade' | 'counter' | 'turnAway';
export type LosingBehaviour = 'finishSeek' | 'stealRound' | 'unchanged' | 'shell' | 'gamble';
export type TiredBehaviour = 'clinchRest' | 'coast' | 'gamble' | 'retreat';
export type GuardStyle = 'highGuard' | 'philly' | 'longGuard' | 'peekaboo' | 'thai' | 'hybrid';
export type ThaiStyle = 'muayFemur' | 'muayKhao' | 'muayMat' | 'muayTae' | 'dutch';
export type TakedownSetup =
  | 'naked' | 'offSingleStrike' | 'offCombination' | 'offFeint' | 'reactive' | 'offClinch';
export type BottomPriority = 'standUp' | 'sweep' | 'submit';
export type TopPriority = 'control' | 'strike' | 'pass' | 'submit';

export interface WeightedTechnique {
  techId: string;
  weight: number;
}

export interface ComboSpec {
  id: string;
  sequence: string[];
  weight: number;
}

export interface WeightedSubmission {
  subId: string;
  weight: number;
}

export interface TakedownStyle {
  prefs: WeightedTechnique[];
  setup: TakedownSetup;
  /** 0-1 preference to finish on the fence. */
  cageBias: number;
}

/**
 * Style is descriptive, not prescriptive (01 §2.6): it multiplies 07's action
 * weights. A style the sub-skills cannot support is still selected and simply
 * executed badly — that is how a T1 "counter striker" looks.
 */
export interface StyleSpec {
  primaryMode: PrimaryMode;
  /** Where this fighter wants the fight: 0 = far range, 1 = on the ground. */
  preferredRange: RangeBand;
  favouriteTechniques: string[] | WeightedTechnique[];
  favouriteCombos: string[][] | ComboSpec[];
  goToSubmissions: string[] | WeightedSubmission[];
  takedownPreferences: string[] | TakedownStyle;
  /** What they do when losing: press, stall, gamble, or hold the plan. */
  whenLosing: 'press' | 'stall' | 'gamble' | 'hold';
  /** Optional author override that replaces the generated game plan (07 §2.5). */
  gamePlanOverride?: Record<string, unknown>;

  // --- chapter 01 §2.6 additions -----------------------------------------
  initiative?: Initiative;
  /** 0 pure counter … 100 pure pressure. */
  pressureBias?: number;
  fallbackMode?: PrimaryMode;
  bottomPriority?: BottomPriority[];
  topPriority?: TopPriority[];
  hurtBehaviour?: HurtBehaviour;
  losingBehaviour?: LosingBehaviour;
  tiredBehaviour?: TiredBehaviour;
  /** 0-100 propensity; needs stance 'switch' for full effect. */
  stanceSwitching?: number;
  pacing?: Array<{ round: number; outputMult: number; riskAppetite: number }>;
  guardStyle?: GuardStyle;
  thaiStyle?: ThaiStyle;
  /** `SUB §4` trait: floors `stubbornness` at 0.5. */
  refusesToTap?: boolean;
}

export interface FighterDefinition {
  /** Schema version inside the definition, so imports can be migrated. */
  schema: 1;
  id: string;
  name: string;
  short: string;
  body: BodySpec;
  appearance: AppearanceSpec;
  physical: PhysicalAttributes;
  /** Only the disciplines this fighter has actually trained need to appear. */
  disciplines: FighterDisciplines;
  mental: MentalAttributes;
  record: CareerRecord;
  style: StyleSpec;
  /** Free-form notes shown in the creator; never read by the sim. */
  notes?: string;
}

/** Total bouts on a record line, tolerating the optional counters. */
export function recordTotal(r: FightRecord | undefined): number {
  if (!r) return 0;
  return r.wins + r.losses + (r.draws ?? 0) + (r.noContests ?? 0);
}

/** Normalise the two accepted somatotype spellings onto the blend. */
export function buildBlendOf(build: Build | BuildBlend): BuildBlend {
  if (typeof build !== 'string') return build;
  if (build === 'ectomorph') return { ecto: 0.7, meso: 0.25, endo: 0.05 };
  if (build === 'endomorph') return { ecto: 0.05, meso: 0.35, endo: 0.60 };
  return { ecto: 0.20, meso: 0.70, endo: 0.10 };
}

/** The lightest class whose limit the weigh-in mass does not exceed. */
export function weightClassFor(weighInKg: number): WeightClassId {
  const ordered: WeightClassId[] = [
    'wc.atomweight', 'wc.strawweight', 'wc.flyweight', 'wc.bantamweight', 'wc.featherweight',
    'wc.lightweight', 'wc.super_lightweight', 'wc.welterweight', 'wc.super_welterweight',
    'wc.middleweight', 'wc.super_middleweight', 'wc.light_heavyweight', 'wc.cruiserweight',
    'wc.heavyweight', 'wc.super_heavyweight',
  ];
  for (const id of ordered) {
    if (weighInKg <= WEIGHT_CLASS_LIMIT_KG[id]) return id;
  }
  return 'wc.super_heavyweight';
}
