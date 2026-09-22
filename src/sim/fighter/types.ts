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
 */

export type Stance = 'orthodox' | 'southpaw' | 'switch';
export type Handedness = 'right' | 'left';
export type Build = 'ectomorph' | 'mesomorph' | 'endomorph';

/** Per-discipline tier, derived from sub-skills and years (01 §2.4). */
export type SkillTier = 0 | 1 | 2 | 3 | 4 | 5;

export const TIER_NAMES: Readonly<Record<SkillTier, string>> = Object.freeze({
  0: 'Brand new',
  1: 'Beginner',
  2: 'Amateur',
  3: 'Regional pro',
  4: 'Elite',
  5: 'Champion',
});

export type DisciplineId =
  | 'boxing' | 'muayThai' | 'kickboxing' | 'karate' | 'taekwondo'
  | 'wrestling' | 'judo' | 'bjj' | 'sambo' | 'mma';

/** Sub-skill ids per discipline (01 §2.3). All 0-100. */
export interface DisciplineSkills {
  /** Years trained, used for the tier derivation and the experience prior. */
  years: number;
  /** Named sub-skills; the set differs per discipline (see 01 §2.3). */
  sub: Record<string, number>;
}

export interface BodySpec {
  heightM: number;
  /** Fingertip-to-fingertip span; the creator may derive it from height. */
  reachM: number;
  /** Hip-to-floor, drives kick range. */
  legReachM: number;
  massKg: number;
  ageYears: number;
  bodyFatPct: number;
  build: Build;
  stance: Stance;
  handedness: Handedness;
}

export interface AppearanceSpec {
  skinTone: number;
  hair: string;
  face: string;
  tattoos: string[];
  shorts: string;
  gloves: string;
  /** Free-text nickname shown on the HUD. */
  nickname?: string;
}

/** 0-100 each (01 §2.2). */
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
  /** Higher is better; converted to a latency in ms by 01 §2.7. */
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

export interface CareerRecord {
  proWins: number;
  proLosses: number;
  proDraws: number;
  amWins: number;
  amLosses: number;
  /** Losses by knockout; feeds the chin decay in 01 §2.4. */
  koLosses: number;
  /** Knockdowns suffered across the career. */
  knockdownsSuffered: number;
  titleFights: number;
  /** Months since the last bout; long layoffs cost performance (LIT_B). */
  layoffMonths: number;
  bigFightComposure: number;
}

export type PrimaryMode =
  | 'pressure' | 'counter' | 'pointFighter' | 'volume' | 'power'
  | 'grinder' | 'scrambler' | 'guardPlayer' | 'allRounder';

export interface StyleSpec {
  primaryMode: PrimaryMode;
  /** Where this fighter wants the fight: 0 = far range, 1 = on the ground. */
  preferredRange: 'long' | 'mid' | 'close' | 'clinch' | 'ground';
  favouriteTechniques: string[];
  favouriteCombos: string[][];
  goToSubmissions: string[];
  takedownPreferences: string[];
  /** What they do when losing: press, stall, gamble, or hold the plan. */
  whenLosing: 'press' | 'stall' | 'gamble' | 'hold';
  /** Optional author override that replaces the generated game plan (07 §2.5). */
  gamePlanOverride?: Record<string, unknown>;
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
  disciplines: Partial<Record<DisciplineId, DisciplineSkills>>;
  mental: MentalAttributes;
  record: CareerRecord;
  style: StyleSpec;
  /** Free-form notes shown in the creator; never read by the sim. */
  notes?: string;
}
