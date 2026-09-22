/**
 * FIGHTER DERIVATION — `FighterDefinition` -> `FighterRuntime`, chapter 01 §2.
 *
 * Run once per bout, before the first tick. Everything here is a pure function
 * of the definition and the resolved parameter set: no clock, no `Math.random`,
 * no I/O. Two calls with the same inputs produce byte-identical output, which
 * is what lets a replay store a seed instead of frames.
 *
 * The order of operations matters and is the chapter's:
 *
 *   1. body and rig                       §2.1
 *   2. age curves on the stored attributes §2.2.2  -> effective attributes
 *   3. career state (layoff, KO history, weight cut) on top of those §2.4
 *   4. cross-discipline transfer, max-not-sum       §2.3.3
 *   5. tiers per discipline, then the aggregates    §2.3.4
 *   6. composites every other chapter reads         §2.7
 *
 * Step 3 comes after step 2 because the layoff and post-KO penalties are stated
 * in attribute *points*, not multipliers, so they must land on the age-adjusted
 * value or a 38-year-old would be punished twice.
 *
 * `derivation` collects the arithmetic as human-readable lines. The Model tab
 * has shown these since the v3 engine (`src/engine/fighter.ts`
 * `derivationNotes`); keeping them is how a reviewer checks a number without
 * reading the code.
 */

import type { ResolvedParams } from '../params';
import {
  buildBlendOf, recordTotal, weightClassFor,
  DISCIPLINE_IDS, GRAPPLING_DISCIPLINES, STRIKING_DISCIPLINES, SUB_SKILLS,
  type BuildBlend, type CoreDisciplineId, type FighterDefinition, type FightRecord,
  type Handedness, type Sex, type SkillTier, type Stance, type WeightClassId,
} from './types';
import { iqTierOf, tierBySkill, tierOf, TIER_SKILL_BANDS, TIER_YEARS_BANDS, type TierKey } from './tiers';

// --------------------------------------------------------------------------
// Cross-discipline transfer matrix (01 §2.3.3, 56 rows)
// --------------------------------------------------------------------------

export interface TransferRule {
  /** `xfer.*`; the parameter registry carries the factor under the same id. */
  id: string;
  from: CoreDisciplineId;
  fromSkill: string;
  to: CoreDisciplineId;
  toSkill: string;
  /** Default factor; the resolved parameter wins when the id is registered. */
  factor: number;
  tag: string;
  note?: string;
}

/**
 * Rule of thumb for adding rows (01 §2.3.3): same movement family in a
 * different rule set 0.85-0.95; same phase, different mechanics 0.5-0.7;
 * adjacent phase 0.3-0.5; incompatible 0-0.2.
 */
export const TRANSFER_MATRIX: readonly TransferRule[] = Object.freeze([
  { id: 'xfer.tkd_kicks_kb', from: 'taekwondo', fromSkill: 'kicks', to: 'kickboxing', toSkill: 'kicks', factor: 0.60, tag: '[S: AUDIT §1.1 (legacy tkdTransfer 0.6)]' },
  { id: 'xfer.tkd_kicks_mt', from: 'taekwondo', fromSkill: 'kicks', to: 'muayThai', toSkill: 'kicks', factor: 0.50, tag: '[E]', note: 'TKD snap vs Thai swing-through, MT §2 S1' },
  { id: 'xfer.tkd_head_kb', from: 'taekwondo', fromSkill: 'headKicks', to: 'kickboxing', toSkill: 'kicks', factor: 0.80, tag: '[E]', note: 'Head kicks only; 02 reads the head variant separately' },
  { id: 'xfer.tkd_spin_kb', from: 'taekwondo', fromSkill: 'spinning', to: 'kickboxing', toSkill: 'spinning', factor: 0.85, tag: '[E]' },
  { id: 'xfer.tkd_foot_karate', from: 'taekwondo', fromSkill: 'footwork', to: 'karate', toSkill: 'footwork', factor: 0.70, tag: '[E]' },
  { id: 'xfer.tkd_dist_karate', from: 'taekwondo', fromSkill: 'distance', to: 'karate', toSkill: 'distanceControl', factor: 0.60, tag: '[E]' },

  { id: 'xfer.box_hands_mt', from: 'boxing', fromSkill: 'power', to: 'muayThai', toSkill: 'hands', factor: 0.90, tag: '[E]' },
  { id: 'xfer.box_punch_kb', from: 'boxing', fromSkill: 'power', to: 'kickboxing', toSkill: 'punches', factor: 0.90, tag: '[E]' },
  { id: 'xfer.box_combo_kb', from: 'boxing', fromSkill: 'combinations', to: 'kickboxing', toSkill: 'combinations', factor: 0.70, tag: '[E]', note: 'Kick chaining is not covered' },
  { id: 'xfer.box_foot_kb', from: 'boxing', fromSkill: 'footwork', to: 'kickboxing', toSkill: 'footwork', factor: 0.80, tag: '[E]' },
  { id: 'xfer.box_guard_kb', from: 'boxing', fromSkill: 'guard', to: 'kickboxing', toSkill: 'defence', factor: 0.60, tag: '[E]', note: 'No kick defence' },
  { id: 'xfer.box_head_karate', from: 'boxing', fromSkill: 'headMovement', to: 'karate', toSkill: 'counters', factor: 0.30, tag: '[E]' },

  { id: 'xfer.mt_kicks_kb', from: 'muayThai', fromSkill: 'kicks', to: 'kickboxing', toSkill: 'kicks', factor: 0.90, tag: '[E]' },
  { id: 'xfer.mt_checks_kb', from: 'muayThai', fromSkill: 'checks', to: 'kickboxing', toSkill: 'checks', factor: 0.95, tag: '[E]' },
  { id: 'xfer.mt_knees_wrclinch', from: 'muayThai', fromSkill: 'clinch', to: 'wrestling', toSkill: 'clinch', factor: 0.40, tag: '[E]', note: 'Collar ties yes, pummelling no' },
  { id: 'xfer.mt_clinch_mmaclinch', from: 'muayThai', fromSkill: 'clinch', to: 'mmaIntegration', toSkill: 'clinchStriking', factor: 0.60, tag: '[E]' },

  { id: 'xfer.kb_kicks_mt', from: 'kickboxing', fromSkill: 'kicks', to: 'muayThai', toSkill: 'kicks', factor: 0.85, tag: '[E]' },
  { id: 'xfer.kb_punch_box', from: 'kickboxing', fromSkill: 'punches', to: 'boxing', toSkill: 'power', factor: 0.75, tag: '[E]' },
  { id: 'xfer.kb_combo_box', from: 'kickboxing', fromSkill: 'combinations', to: 'boxing', toSkill: 'combinations', factor: 0.70, tag: '[E]' },
  { id: 'xfer.kb_low_mt', from: 'kickboxing', fromSkill: 'lowKicks', to: 'muayThai', toSkill: 'kicks', factor: 0.70, tag: '[E]' },

  { id: 'xfer.karate_dist_box', from: 'karate', fromSkill: 'distanceControl', to: 'boxing', toSkill: 'footwork', factor: 0.40, tag: '[E]' },
  { id: 'xfer.karate_kicks_kb', from: 'karate', fromSkill: 'kicks', to: 'kickboxing', toSkill: 'kicks', factor: 0.55, tag: '[E]', note: 'Exec time 1.29 s vs MT 1.02 s, MT §7.1' },
  { id: 'xfer.karate_counter_box', from: 'karate', fromSkill: 'counters', to: 'boxing', toSkill: 'counters', factor: 0.50, tag: '[E]' },

  { id: 'xfer.wr_clinch_ju', from: 'wrestling', fromSkill: 'clinch', to: 'judo', toSkill: 'gripFighting', factor: 0.40, tag: '[E]', note: 'No-gi grips' },
  { id: 'xfer.wr_top_bjj', from: 'wrestling', fromSkill: 'topControl', to: 'bjj', toSkill: 'topControl', factor: 0.70, tag: '[E]' },
  { id: 'xfer.wr_scr_bjj', from: 'wrestling', fromSkill: 'scrambles', to: 'bjj', toSkill: 'escapes', factor: 0.50, tag: '[E]' },
  { id: 'xfer.wr_getup_bjj', from: 'wrestling', fromSkill: 'getUps', to: 'bjj', toSkill: 'wrestleUps', factor: 0.80, tag: '[E]' },
  { id: 'xfer.wr_shots_mma', from: 'wrestling', fromSkill: 'shots', to: 'mmaIntegration', toSkill: 'levelChanges', factor: 0.50, tag: '[E]' },
  { id: 'xfer.wr_cage_mma', from: 'wrestling', fromSkill: 'cageWrestling', to: 'mmaIntegration', toSkill: 'cageWork', factor: 0.70, tag: '[E]' },
  { id: 'xfer.wr_clinch_mt', from: 'wrestling', fromSkill: 'clinch', to: 'muayThai', toSkill: 'clinch', factor: 0.40, tag: '[E]' },

  { id: 'xfer.ju_throws_wr', from: 'judo', fromSkill: 'throws', to: 'wrestling', toSkill: 'clinch', factor: 0.60, tag: '[S: WR §7]', note: 'judo/sambo upper-body +10' },
  { id: 'xfer.ju_throws_wrfin', from: 'judo', fromSkill: 'throws', to: 'wrestling', toSkill: 'finishes', factor: 0.40, tag: '[E]' },
  { id: 'xfer.ju_grip_wr', from: 'judo', fromSkill: 'gripFighting', to: 'wrestling', toSkill: 'clinch', factor: 0.50, tag: '[E]' },
  { id: 'xfer.ju_sweep_wr', from: 'judo', fromSkill: 'footSweeps', to: 'wrestling', toSkill: 'finishes', factor: 0.60, tag: '[E]', note: 'Trips' },
  { id: 'xfer.ju_newaza_bjj', from: 'judo', fromSkill: 'newaza', to: 'bjj', toSkill: 'topControl', factor: 0.50, tag: '[E]' },
  { id: 'xfer.ju_newaza_bjjpin', from: 'judo', fromSkill: 'newaza', to: 'bjj', toSkill: 'passing', factor: 0.35, tag: '[E]' },
  { id: 'xfer.ju_counter_wr', from: 'judo', fromSkill: 'counters', to: 'wrestling', toSkill: 'takedownDefence', factor: 0.35, tag: '[E]', note: 'Throw counters, not sprawls' },
  { id: 'xfer.ju_ukemi_bjj', from: 'judo', fromSkill: 'ukemi', to: 'bjj', toSkill: 'guard', factor: 0.30, tag: '[E]' },

  { id: 'xfer.bjj_guard_ju', from: 'bjj', fromSkill: 'guard', to: 'judo', toSkill: 'newaza', factor: 0.50, tag: '[E]' },
  { id: 'xfer.bjj_scr_wr', from: 'bjj', fromSkill: 'escapes', to: 'wrestling', toSkill: 'scrambles', factor: 0.50, tag: '[S: WR §7]', note: 'BJJ-only scrambles +5' },
  { id: 'xfer.bjj_wrestleup_wr', from: 'bjj', fromSkill: 'wrestleUps', to: 'wrestling', toSkill: 'getUps', factor: 0.70, tag: '[E]' },
  { id: 'xfer.bjj_shots_wr', from: 'bjj', fromSkill: 'sweeps', to: 'wrestling', toSkill: 'shots', factor: 0.20, tag: '[S: WR §7]', note: 'BJJ-only leg attacks -15 -> weak' },
  { id: 'xfer.bjj_top_wr', from: 'bjj', fromSkill: 'topControl', to: 'wrestling', toSkill: 'topControl', factor: 0.60, tag: '[E]' },
  { id: 'xfer.bjj_subdef_mma', from: 'bjj', fromSkill: 'subDefence', to: 'mmaIntegration', toSkill: 'subDefenceUnderStrikes', factor: 0.60, tag: '[E]' },
  { id: 'xfer.bjj_legs_sambo', from: 'bjj', fromSkill: 'legLocks', to: 'sambo', toSkill: 'legLocks', factor: 0.90, tag: '[E]' },

  { id: 'xfer.sambo_throws_ju', from: 'sambo', fromSkill: 'throws', to: 'judo', toSkill: 'throws', factor: 0.70, tag: '[E]' },
  { id: 'xfer.sambo_td_wr', from: 'sambo', fromSkill: 'takedowns', to: 'wrestling', toSkill: 'shots', factor: 0.65, tag: '[E]' },
  { id: 'xfer.sambo_grip_ju', from: 'sambo', fromSkill: 'gripFighting', to: 'judo', toSkill: 'gripFighting', factor: 0.70, tag: '[E]' },
  { id: 'xfer.sambo_legs_bjj', from: 'sambo', fromSkill: 'legLocks', to: 'bjj', toSkill: 'legLocks', factor: 0.80, tag: '[E]' },
  { id: 'xfer.sambo_top_bjj', from: 'sambo', fromSkill: 'topControl', to: 'bjj', toSkill: 'topControl', factor: 0.60, tag: '[E]' },
  { id: 'xfer.sambo_trans_bjj', from: 'sambo', fromSkill: 'transitions', to: 'bjj', toSkill: 'subAttack', factor: 0.50, tag: '[E]' },
  { id: 'xfer.sambo_s2g_mma', from: 'sambo', fromSkill: 'strikingToGrappling', to: 'mmaIntegration', toSkill: 'levelChanges', factor: 0.70, tag: '[E]', note: 'Combat sambo' },
  { id: 'xfer.sambo_throws_wr', from: 'sambo', fromSkill: 'throws', to: 'wrestling', toSkill: 'clinch', factor: 0.55, tag: '[E]' },

  { id: 'xfer.mma_lc_wr', from: 'mmaIntegration', fromSkill: 'levelChanges', to: 'wrestling', toSkill: 'shots', factor: 0.30, tag: '[E]' },
  { id: 'xfer.mma_gnp_bjj', from: 'mmaIntegration', fromSkill: 'groundAndPound', to: 'bjj', toSkill: 'topControl', factor: 0.40, tag: '[E]' },
  { id: 'xfer.mma_getup_bjj', from: 'mmaIntegration', fromSkill: 'getUps', to: 'bjj', toSkill: 'wrestleUps', factor: 0.60, tag: '[E]' },
]);

/**
 * Wrestling background offsets, applied to the *effective* sub-skills after the
 * transfer max `[S: WR §7]`. The four columns are leg attacks, upper body, mat
 * returns and scrambles.
 */
export const WRESTLING_BACKGROUND_OFFSETS: Readonly<Record<string, readonly [number, number, number, number]>> =
  Object.freeze({
    freestyle: [10, 0, 5, 5],
    folkstyle: [8, 2, 10, 10],
    greco: [-5, 15, 5, 0],
    judoSambo: [-5, 10, 5, 0],
    bjjOnly: [-15, -5, -5, 5],
  });

const BACKGROUND_OFFSET_SKILLS = ['shots', 'clinch', 'matReturns', 'scrambles'] as const;

// --------------------------------------------------------------------------
// Age curves (01 §2.2.2)
// --------------------------------------------------------------------------

/**
 * A piecewise-linear age multiplier: it rises to the peak window at `rise`
 * %/yr from age 18, sits at 1.0 inside the window, then compounds two decline
 * slopes. Compounding (rather than summing) is the reading of "%/yr" the
 * chapter's own worked example uses (0.95 x 0.90 at age 38).
 */
export interface AgeCurve {
  risePerYear: number;
  peakStart: number;
  peakEnd: number;
  declineA: number;
  declineBFrom: number;
  declineB: number;
}

const AGE_CURVE_PARAM_GROUP: Readonly<Record<string, string>> = Object.freeze({
  explosiveness: 'explosiveness',
  speed: 'speedGroup',
  handSpeed: 'speedGroup',
  kickSpeed: 'speedGroup',
  strength: 'strength',
  cardio: 'cardio',
  recovery: 'recovery',
  flexibility: 'flexibility',
  balance: 'balance',
  reactionTime: 'reactionTime',
});

export function ageMultiplier(curve: AgeCurve, ageYears: number): number {
  const age = Math.max(18, ageYears);
  if (age < curve.peakStart) {
    return Math.max(0.1, 1 - curve.risePerYear * (curve.peakStart - age));
  }
  if (age <= curve.peakEnd) return 1;
  const yearsA = Math.max(0, Math.min(age, curve.declineBFrom) - curve.peakEnd);
  const yearsB = Math.max(0, age - curve.declineBFrom);
  return Math.pow(1 - curve.declineA, yearsA) * Math.pow(1 - curve.declineB, yearsB);
}

/**
 * Points subtracted from the stored `chin` (01 §2.2.3). Flat to 25, then
 * -1.75/yr to 30, -2.5/yr to 40, capped at -34.
 *
 * The slopes already carry the 0.6 attenuation of the chapter's derivation
 * (the raw hazard ratios imply 14/35/55 points), so the registered
 * `attenuation` knob is applied relative to that baked-in 0.6 — dropping it to
 * 0.4 is the playability lever §7.2 (1) describes.
 */
export function ageChinPenalty(
  ageYears: number,
  p: { start: number; slope1: number; knee: number; slope2: number; cap: number; attenuation: number },
): number {
  const seg1 = Math.max(0, Math.min(ageYears, p.knee) - p.start) * p.slope1;
  const seg2 = Math.max(0, ageYears - p.knee) * p.slope2;
  const raw = Math.min(p.cap, seg1 + seg2);
  return raw * (p.attenuation / 0.6);
}

// --------------------------------------------------------------------------
// Runtime shape
// --------------------------------------------------------------------------

export interface RigProportions {
  shoulderWidthM: number;
  armLengthM: number;
  upperArmM: number;
  forearmM: number;
  handM: number;
  legLengthM: number;
  thighM: number;
  shankM: number;
  footHeightM: number;
  headHeightM: number;
  neckM: number;
  torsoM: number;
  refMassKg: number;
  bulk: number;
  limbRadiusScale: number;
  waistScale: number;
  chestScale: number;
  definition: number;
}

export interface EffectiveAttributes {
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
  reactionTime: number;
  gripStrength: number;
  neck: number;
}

export interface PowerIndex {
  rearHand: number;
  leadHand: number;
  hookMult: number;
  rearKick: number;
  leadKick: number;
  knee: number;
  elbow: number;
  headKickAlphaMult: number;
}

export interface GrapplingComposites {
  grapplingStrength: number;
  clinchPower: number;
  sprawlSpeedMult: number;
  tdDefenceBase: number;
  subAttack: number;
  subDefence: number;
}

export interface EnergyComposites {
  pcrCapacity: number;
  pcrRefillHalfLifeS: number;
  lactateClearance: number;
  breakRefillFrac: number;
  actionCostMult: number;
}

export type AnticipationDomain = 'striking' | 'takedown' | 'submission';

export interface AnticipationBlock {
  defSkill: number;
  readP: number;
  cueLeadMs: number;
  counterOnReadP: number;
  feintBiteP: number;
  anxietyReadPenalty: number;
}

export interface DisciplineRuntime {
  id: CoreDisciplineId;
  yearsTrained: number;
  trainingQuality: number;
  styleTags: readonly string[];
  /** Stored sub-skills, untrained disciplines filled with the 5-point default. */
  native: Record<string, number>;
  /** native (+) transfers (+) background offsets. */
  effective: Record<string, number>;
  mean: number;
  /** Years plus the transfer-years credit used by the tier cap. */
  effectiveYears: number;
  tier: SkillTier;
  /** False when the definition listed no block for this discipline. */
  trained: boolean;
}

export interface CareerAdjustments {
  layoffDays: number;
  /** Attribute-point deltas applied on top of the age curves. */
  composure: number;
  reactionTime: number;
  cardio: number;
  chin: number;
  /** Subtracted from every `readP`. */
  readP: number;
  residualDehydration: number;
  /** 07 multiplies its scouting noise by this (short notice = 1.5). */
  scoutingSigmaMult: number;
  shortNotice: boolean;
  quickTurnaroundAfterKo: boolean;
}

export interface FighterRuntime {
  readonly def: FighterDefinition;
  id: string;
  name: string;

  body: {
    sex: Sex;
    heightM: number;
    reachM: number;
    legReachM: number;
    weighInKg: number;
    fightNightKg: number;
    weightClass: WeightClassId;
    ageYears: number;
    bodyFatPct: number;
    build: BuildBlend;
    stance: Stance;
    handedness: Handedness;
    dominantLeg: 'right' | 'left';
  };
  rig: RigProportions;

  /** Stored values, unmodified. */
  base: EffectiveAttributes;
  /** Age- and career-adjusted; every consumer reads these. */
  effective: EffectiveAttributes;
  ageMultipliers: Readonly<Record<string, number>>;
  career: CareerAdjustments;

  disciplines: Readonly<Record<CoreDisciplineId, DisciplineRuntime>>;
  strikingMean: number;
  grapplingMean: number;
  mmaMean: number;
  /** Everything `rulesFor` matches against (`TierSource`). */
  tiers: Readonly<Partial<Record<TierKey, number>>>;
  strikingTier: SkillTier;
  grapplingTier: SkillTier;
  mmaTier: SkillTier;
  iqTier: 1 | 2 | 3 | 4 | 5;

  experience: number;
  composureEff: number;
  paceAgeMult: number;
  decisionNoiseMult: number;
  attackShare: number;
  stanceFamiliarity: { orthodox: number; southpaw: number; switch: number };

  massIndex: number;
  massVsClass: number;
  effectiveReachM: number;
  effectiveKickReachM: number;
  reachLeverage: number;
  reactionTimeMs: number;
  footSpeedMs: number;
  handSpeedMs: number;
  kickSpeedMs: number;
  bodyToughnessThresholdMult: number;
  recoveryHalfLifeMult: number;
  neckMult: number;
  flexKickQualityMult: number;
  balanceStumbleMult: number;
  chinEff: number;
  chinZ: number;
  kKOHistoryMult: number;
  residualDehydration: number;

  powerIndex: PowerIndex;
  grappling: GrapplingComposites;
  energy: EnergyComposites;
  anticipation: Readonly<Record<AnticipationDomain, AnticipationBlock>>;

  execTimeMultKick: number;
  execTimeMultPunch: number;
  telegraphMod: number;
  hipRotationMult: number;
  stubbornness: number;
  noTapFlag: boolean;

  /** Human-readable arithmetic, in evaluation order. Shown by the Model tab. */
  derivation: string[];
}

export interface DeriveContext {
  /** Blends `composure` toward `bigFightComposure`: title 1.0 … amateur 0.3. */
  eventMagnitude?: number;
  /** Used for `stanceFamiliarity` and the reach advantage the caller reads. */
  opponentStance?: Stance;
  /** Ruleset override; `wc.open` disables the class-relative mass term. */
  weightClass?: WeightClassId;
  /** Set false to skip building the `derivation` strings in batch runs. */
  explain?: boolean;
}

// --------------------------------------------------------------------------
// Small helpers
// --------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clamp100 = (v: number): number => clamp(v, 0, 100);
const round = (v: number, dp = 2): number => {
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
};

/** Mean of a record's values; 0 for an empty record (never happens in practice). */
function meanOf(rec: Record<string, number>): number {
  const keys = Object.keys(rec);
  if (keys.length === 0) return 0;
  let sum = 0;
  for (const k of keys) sum += rec[k];
  return sum / keys.length;
}

function proTotal(rec: FightRecord | undefined, fallback: number): number {
  return rec ? recordTotal(rec) : fallback;
}

// --------------------------------------------------------------------------
// The derivation
// --------------------------------------------------------------------------

export function deriveRuntime(
  def: FighterDefinition,
  params: ResolvedParams,
  ctx: DeriveContext = {},
): FighterRuntime {
  const P = (id: string): number => params.get(id);
  const explain = ctx.explain !== false;
  const lines: string[] = [];
  const say = (line: string): void => {
    if (explain) lines.push(line);
  };

  // ---- 1. body and rig (§2.1, §2.1.2) ------------------------------------
  const b = def.body;
  const build = buildBlendOf(b.build);
  const weighInKg = b.weighInKg ?? b.massKg;
  const fightNightKg = b.fightNightKg ?? b.massKg;
  const weightClass = ctx.weightClass ?? b.weightClass ?? weightClassFor(weighInKg);
  const sex: Sex = b.sex ?? 'male';
  const handedness = b.handedness;
  const dominantLeg = b.dominantLeg ?? handedness;

  const shoulderWidthM = P('fm.rig.shoulder_ratio') * b.heightM * (0.92 + P('fm.rig.shoulder_meso_gain') * build.meso);
  const armLengthM = (b.reachM - shoulderWidthM) / 2;
  const legLengthM = b.legReachM;
  const headHeightM = P('fm.rig.head_ratio') * b.heightM;
  const neckM = P('fm.rig.neck_ratio') * b.heightM;
  const refMassKg = P('fm.rig.ref_bmi') * b.heightM * b.heightM;
  const bulk = fightNightKg / refMassKg;
  const rig: RigProportions = {
    shoulderWidthM,
    armLengthM,
    upperArmM: P('fm.rig.arm_upper') * armLengthM,
    forearmM: P('fm.rig.arm_fore') * armLengthM,
    handM: P('fm.rig.arm_hand') * armLengthM,
    legLengthM,
    thighM: P('fm.rig.leg_thigh') * legLengthM,
    shankM: P('fm.rig.leg_shank') * legLengthM,
    footHeightM: P('fm.rig.leg_foot') * legLengthM,
    headHeightM,
    neckM,
    torsoM: Math.max(P('fm.rig.torso_floor_ratio') * b.heightM, b.heightM - legLengthM - headHeightM - neckM),
    refMassKg,
    bulk,
    limbRadiusScale: Math.pow(bulk, P('fm.rig.limb_radius_exp')),
    waistScale: 1 + P('fm.rig.waist_per_fat_pct') * (b.bodyFatPct - 10),
    chestScale: 1 + P('fm.rig.chest_meso_gain') * build.meso - P('fm.rig.chest_ecto_loss') * build.ecto,
    definition: clamp(1 - b.bodyFatPct / P('fm.rig.definition_fat_cap'), 0, 1),
  };
  say(
    `body: ${b.heightM.toFixed(3)} m, reach ${b.reachM.toFixed(3)} m, ${fightNightKg.toFixed(1)} kg fight night ` +
      `(${weighInKg.toFixed(1)} kg weigh-in), ${weightClass}, age ${b.ageYears}`,
  );
  say(
    `rig: shoulder ${rig.shoulderWidthM.toFixed(3)} m, arm ${rig.armLengthM.toFixed(3)} m, ` +
      `refMass ${rig.refMassKg.toFixed(1)} kg, bulk ${rig.bulk.toFixed(2)}`,
  );

  // ---- 2. age curves (§2.2.2) --------------------------------------------
  const curveFor = (attr: string): AgeCurve => {
    const g = AGE_CURVE_PARAM_GROUP[attr];
    return {
      risePerYear: P(`fm.age.${g}.rise`) / 100,
      peakStart: P(`fm.age.${g}.peakStart`),
      peakEnd: P(`fm.age.${g}.peakEnd`),
      declineA: P(`fm.age.${g}.declineA`) / 100,
      declineBFrom: P(`fm.age.${g}.declineBFrom`),
      declineB: P(`fm.age.${g}.declineB`) / 100,
    };
  };

  const phys = def.physical;
  const base: EffectiveAttributes = {
    strength: phys.strength,
    explosiveness: phys.explosiveness,
    speed: phys.speed,
    handSpeed: phys.handSpeed,
    kickSpeed: phys.kickSpeed,
    cardio: phys.cardio,
    chin: phys.chin,
    bodyToughness: phys.bodyToughness,
    recovery: phys.recovery,
    flexibility: phys.flexibility,
    balance: phys.balance,
    reactionTime: phys.reactionTime,
    gripStrength: phys.gripStrength,
    neck: phys.neckStrength,
  };

  const ageMultipliers: Record<string, number> = {};
  const aged: EffectiveAttributes = { ...base };
  for (const attr of Object.keys(AGE_CURVE_PARAM_GROUP)) {
    const m = ageMultiplier(curveFor(attr), b.ageYears);
    ageMultipliers[attr] = m;
    const key = attr as keyof EffectiveAttributes;
    aged[key] = clamp100(base[key] * m);
  }
  // bodyToughness, neck, gripStrength and chin have no attribute-level age
  // curve: chin ages through its own points curve below, the others not at all.
  ageMultipliers.chin = 1;
  ageMultipliers.bodyToughness = 1;
  ageMultipliers.neck = 1;
  say(
    `age ${b.ageYears}: explosiveness x${ageMultipliers.explosiveness.toFixed(3)} -> ${aged.explosiveness.toFixed(1)}, ` +
      `speed x${ageMultipliers.speed.toFixed(3)} -> ${aged.speed.toFixed(1)}, ` +
      `cardio x${ageMultipliers.cardio.toFixed(3)} -> ${aged.cardio.toFixed(1)} (skill and IQ do not age)`,
  );

  // ---- 3. career state (§2.4) --------------------------------------------
  const rec = def.record;
  const pro = rec.pro;
  const amateur = rec.amateur;
  const proFights = proTotal(pro, rec.proWins + rec.proLosses + rec.proDraws);
  const amFights = proTotal(amateur, rec.amWins + rec.amLosses);
  const koLosses = pro?.koLosses ?? rec.koLosses;
  const subLosses = pro?.subLosses ?? 0;
  const knockdowns = rec.knockdownsSuffered;
  const layoffDays = rec.daysSinceLastBout ?? rec.layoffMonths * 30.4375;

  const career: CareerAdjustments = {
    layoffDays,
    composure: 0, reactionTime: 0, cardio: 0, chin: 0, readP: 0,
    residualDehydration: rec.weightCut?.residualDehydration ?? 0,
    scoutingSigmaMult: 1,
    shortNotice: false,
    quickTurnaroundAfterKo: false,
  };

  if (layoffDays >= P('fm.career.layoff365.days')) {
    career.composure -= P('fm.career.layoff365.composure');
    career.reactionTime -= P('fm.career.layoff365.rt');
    career.cardio -= P('fm.career.layoff365.cardio');
    career.readP += P('fm.career.layoff365.readP');
    say(`layoff ${Math.round(layoffDays)} d (>= 365): composure -12, reactionTime -5, cardio -6, readP -0.05 [S: FD §2.4]`);
  } else if (layoffDays > P('fm.career.layoff210.days')) {
    career.composure -= P('fm.career.layoff210.composure');
    career.reactionTime -= P('fm.career.layoff210.rt');
    career.cardio -= P('fm.career.layoff210.cardio');
    career.readP += P('fm.career.layoff210.readP');
    say(`layoff ${Math.round(layoffDays)} d (> 210): composure -8, reactionTime -3, cardio -4, readP -0.03 [S: FD §2.4]`);
  }

  if (rec.lastResultWasKoLoss && layoffDays < P('fm.career.post_ko_60d.days')) {
    career.quickTurnaroundAfterKo = true;
    career.chin -= P('fm.career.post_ko_60d.chin');
    career.composure -= P('fm.career.post_ko_60d.composure');
    say(`< 60 d after a KO loss: chinEff -10, composureEff -10 [S: FD §2.4, n = 16]`);
  }

  const shortNoticeDays = rec.shortNoticeDays;
  if (shortNoticeDays !== undefined && shortNoticeDays < P('fm.career.short_notice.days')) {
    career.shortNotice = true;
    career.cardio -= P('fm.career.short_notice.cardio');
    career.residualDehydration += P('fm.career.short_notice.dehydration');
    career.scoutingSigmaMult = P('fm.career.short_notice.scouting_sigma_mult');
    say(`short notice (${shortNoticeDays} d camp): cardio -8, dehydration +0.01, scouting sigma x1.5 [S: FD §2.4]`);
  }

  if (rec.lastResult === 'loss') career.composure -= P('fm.career.last_result.loss');
  else if (rec.lastResult === 'win') career.composure += P('fm.career.last_result.win');

  // Weight cut: only the residual-dehydration penalty is modelled; the regain
  // *benefit* enters purely through `fightNightKg` (01 §7.2 (7)).
  const cut = rec.weightCut;
  if (cut) {
    const d = clamp(
      P('fm.career.dehydration_slope') *
        Math.max(0, cut.cutPct - P('fm.career.dehydration_threshold_pct')) *
        (1 - def.mental.discipline / 100) *
        P('fm.career.dehydration_discipline_scale'),
      0,
      P('fm.career.dehydration_cap'),
    );
    career.residualDehydration = Math.max(career.residualDehydration, d) +
      (career.shortNotice ? P('fm.career.short_notice.dehydration') : 0);
    career.residualDehydration = clamp(career.residualDehydration, 0, P('fm.career.dehydration_cap'));
  }

  const effective: EffectiveAttributes = { ...aged };
  effective.cardio = clamp100(aged.cardio + career.cardio);
  effective.reactionTime = clamp100(
    aged.reactionTime + career.reactionTime -
      P('fm.age.exposure_rt_per_fight') * Math.max(0, proFights - P('fm.age.exposure_rt_fights')),
  );

  // Chin decay (§2.4.3) — the single age term for KO susceptibility. 05 must
  // not add another one on top.
  const chinAgePenalty = ageChinPenalty(b.ageYears, {
    start: P('fm.age.chin.start'), slope1: P('fm.age.chin.slope1'), knee: P('fm.age.chin.knee'),
    slope2: P('fm.age.chin.slope2'), cap: P('fm.age.chin.cap'), attenuation: P('fm.age.chin.attenuation'),
  });
  const koLossTerm = P('fm.career.chin_per_ko_loss') * Math.min(koLosses, P('fm.career.ko_loss_cap'));
  const kdTerm = P('fm.career.chin_per_kd') * Math.min(knockdowns, P('fm.career.kd_cap'));
  const chinEff = clamp100(base.chin - chinAgePenalty - koLossTerm - kdTerm + career.chin);
  effective.chin = chinEff;
  const chinZ = -(chinEff / 100 - 0.5) * 2;
  const kKOHistoryMult = 1 + P('fm.career.kko_history_per_ko') * Math.min(koLosses, P('fm.career.ko_loss_cap'));
  say(
    `chinEff = ${base.chin} - ${chinAgePenalty.toFixed(2)} (age) - ${koLossTerm} (${koLosses} KO losses) ` +
      `- ${kdTerm} (${knockdowns} KDs)${career.chin ? ` ${career.chin.toFixed(0)} (quick turnaround)` : ''} = ${chinEff.toFixed(1)}; ` +
      `kKOHistoryMult = ${kKOHistoryMult.toFixed(2)} [S: DP §3.2, §7 r21]`,
  );

  // Experience and composure (§2.4.1, §2.4.2).
  const totalFights = proFights + P('fm.exp.amateur_weight') * amFights;
  const experience = P('fm.exp.floor') + (1 - P('fm.exp.floor')) * (1 - Math.exp(-totalFights / P('fm.exp.tau_fights')));
  const eventMagnitude = ctx.eventMagnitude ?? P('fm.career.event_magnitude.regional');
  const composureStored = def.mental.composure;
  const bigFight = rec.bigFightComposure;
  const composureEff = clamp100(composureStored + (bigFight - composureStored) * eventMagnitude + career.composure);
  say(
    `experience = 0.1 + 0.9(1 - e^(-${totalFights.toFixed(1)}/6)) = ${experience.toFixed(3)}; ` +
      `composureEff = ${composureStored} + (${bigFight} - ${composureStored}) x ${eventMagnitude} ` +
      `${career.composure >= 0 ? '+' : '-'} ${Math.abs(career.composure).toFixed(0)} = ${composureEff.toFixed(1)}`,
  );

  const stanceTau = P('fm.career.stance_familiarity_tau');
  const exposure = rec.stanceExposure ?? { orthodox: 0.8 * proFights, southpaw: 0.2 * proFights };
  const fam = (bouts: number): number => 1 - Math.exp(-Math.max(0, bouts) / stanceTau);
  const stanceFamiliarity = {
    orthodox: fam(exposure.orthodox),
    southpaw: fam(exposure.southpaw),
    // A switch-stance opponent is only as familiar as the rarer of the two.
    switch: Math.min(fam(exposure.orthodox), fam(exposure.southpaw)),
  };

  // ---- 4. transfer and 5. tiers (§2.3.3, §2.3.4) -------------------------
  const untrainedDefault = P('fm.skill.untrained_default');
  const nativeByDiscipline: Record<string, Record<string, number>> = {};
  const yearsByDiscipline: Record<string, number> = {};
  const qualityByDiscipline: Record<string, number> = {};
  const tagsByDiscipline: Record<string, string[]> = {};

  for (const id of DISCIPLINE_IDS) {
    // `mma` is an accepted alias of `mmaIntegration` for definitions written
    // against the earlier skeleton schema.
    const block = def.disciplines[id] ?? (id === 'mmaIntegration' ? def.disciplines.mma : undefined);
    const native: Record<string, number> = {};
    for (const skill of SUB_SKILLS[id]) {
      native[skill] = block?.sub?.[skill] ?? untrainedDefault;
    }
    nativeByDiscipline[id] = native;
    yearsByDiscipline[id] = block?.years ?? 0;
    qualityByDiscipline[id] = block?.trainingQuality ?? 1.0;
    tagsByDiscipline[id] = block?.styleTags ? [...block.styleTags] : [];
  }

  const effectiveByDiscipline: Record<string, Record<string, number>> = {};
  for (const id of DISCIPLINE_IDS) effectiveByDiscipline[id] = { ...nativeByDiscipline[id] };

  // max, not sum: stacking two sources never exceeds the best of them (§2.3.3,
  // §7.2 (4) records why a soft-OR was rejected).
  const transferCredit: Record<string, Record<string, number>> = {};
  for (const rule of TRANSFER_MATRIX) {
    const factor = params.index.has(rule.id) ? P(rule.id) : rule.factor;
    const source = nativeByDiscipline[rule.from]?.[rule.fromSkill];
    if (source === undefined) continue;
    const transferred = factor * source;
    const target = effectiveByDiscipline[rule.to];
    if (target === undefined || target[rule.toSkill] === undefined) continue;
    if (transferred > target[rule.toSkill]) {
      target[rule.toSkill] = transferred;
      say(
        `transfer ${rule.id}: ${rule.to}.${rule.toSkill} = max(${nativeByDiscipline[rule.to][rule.toSkill].toFixed(0)}, ` +
          `${factor} x ${rule.from}.${rule.fromSkill} ${source.toFixed(0)}) = ${transferred.toFixed(1)} ${rule.tag}`,
      );
    }
    // Years credit is tracked per source discipline at its best factor into the
    // target, so a 10-year judoka is not held to T1 wrestling by the years cap.
    const credit = (transferCredit[rule.to] ??= {});
    credit[rule.from] = Math.max(credit[rule.from] ?? 0, factor);
  }

  // Wrestling background offsets land after the max (§2.3.3).
  for (const tag of tagsByDiscipline.wrestling) {
    const defaults = WRESTLING_BACKGROUND_OFFSETS[tag];
    if (!defaults) continue;
    // Read through the registry so Phase 9 can move a background's profile.
    const offsets = ['legAttacks', 'upperBody', 'matReturns', 'scrambles'].map((col, i) =>
      params.index.has(`fm.wr.offset.${tag}.${col}`) ? P(`fm.wr.offset.${tag}.${col}`) : defaults[i],
    );
    for (let i = 0; i < BACKGROUND_OFFSET_SKILLS.length; i++) {
      const skill = BACKGROUND_OFFSET_SKILLS[i];
      effectiveByDiscipline.wrestling[skill] = clamp100(effectiveByDiscipline.wrestling[skill] + offsets[i]);
    }
    say(
      `wrestling background '${tag}': legs ${offsets[0]}, upper ${offsets[1]}, ` +
        `mat returns ${offsets[2]}, scrambles ${offsets[3]} [S: WR §7]`,
    );
  }

  for (const id of DISCIPLINE_IDS) {
    const eff = effectiveByDiscipline[id];
    for (const skill of Object.keys(eff)) eff[skill] = clamp100(eff[skill]);
  }

  const transferYearsFactor = P('fm.tier.transfer_years_factor');
  const skillBands = [P('fm.tier.band1'), P('fm.tier.band2'), P('fm.tier.band3'), P('fm.tier.band4'), P('fm.tier.band5')];
  const yearsBands = [P('fm.tier.years_band1'), P('fm.tier.years_band2'), P('fm.tier.years_band3'), P('fm.tier.years_band4')];
  const disciplines = {} as Record<CoreDisciplineId, DisciplineRuntime>;
  for (const id of DISCIPLINE_IDS) {
    const eff = effectiveByDiscipline[id];
    const mean = meanOf(eff);
    let credited = 0;
    for (const [src, factor] of Object.entries(transferCredit[id] ?? {})) {
      credited += yearsByDiscipline[src] * factor;
    }
    const effectiveYears = yearsByDiscipline[id] + transferYearsFactor * credited;
    const tier = tierOf({
      mean,
      effectiveYears,
      fightIQ: def.mental.fightIQ,
      composure: composureStored,
      yearsCapOffset: P('fm.tier.years_cap_offset'),
      t5IqGate: P('fm.tier.t5_iq_gate'),
      t5ComposureGate: P('fm.tier.t5_composure_gate'),
      skillBands,
      yearsBands,
    });
    disciplines[id] = {
      id,
      yearsTrained: yearsByDiscipline[id],
      trainingQuality: qualityByDiscipline[id],
      styleTags: tagsByDiscipline[id],
      native: nativeByDiscipline[id],
      effective: eff,
      mean,
      effectiveYears,
      tier,
      trained: def.disciplines[id] !== undefined || (id === 'mmaIntegration' && def.disciplines.mma !== undefined),
    };
    if (disciplines[id].trained || mean > untrainedDefault + 0.01) {
      say(
        `${id}: mean ${mean.toFixed(1)} -> T${tierBySkill(mean, skillBands)} by skill, ` +
          `${effectiveYears.toFixed(2)} effective yr -> cap T${Math.min(5, tierOf({ mean: 100, effectiveYears, fightIQ: 100, composure: 100, skillBands, yearsBands }))}` +
          ` => T${tier}`,
      );
    }
  }

  const bestOf = (ids: readonly CoreDisciplineId[]): { mean: number; best: CoreDisciplineId } => {
    let best = ids[0];
    for (const id of ids) if (disciplines[id].mean > disciplines[best].mean) best = id;
    return { mean: disciplines[best].mean, best };
  };
  const striking = bestOf(STRIKING_DISCIPLINES);
  const grappling = bestOf(GRAPPLING_DISCIPLINES);
  const strikingMean = striking.mean;
  const grapplingMean = grappling.mean;
  const integration = disciplines.mmaIntegration;
  const mmaMean =
    P('fm.tier.mma_mean_striking') * strikingMean +
    P('fm.tier.mma_mean_grappling') * grapplingMean +
    P('fm.tier.mma_mean_integration') * integration.mean;

  // The aggregate tiers use the years cap of the best contributing discipline.
  const strikingTier = disciplines[striking.best].tier >= tierBySkill(strikingMean, skillBands)
    ? tierBySkill(strikingMean, skillBands)
    : disciplines[striking.best].tier;
  const grapplingTier = disciplines[grappling.best].tier >= tierBySkill(grapplingMean, skillBands)
    ? tierBySkill(grapplingMean, skillBands)
    : disciplines[grappling.best].tier;
  // T5 on the mmaTier is gated on the *integration* discipline: a complete
  // champion is one whose mixing is championship level, not one whose parts
  // average high (01 §4.15's derived check).
  const mmaTier = Math.max(
    tierOf({
      mean: mmaMean, effectiveYears: integration.effectiveYears, fightIQ: def.mental.fightIQ,
      composure: composureStored, yearsCapOffset: P('fm.tier.years_cap_offset'),
      t5IqGate: P('fm.tier.t5_iq_gate'), t5ComposureGate: P('fm.tier.t5_composure_gate'),
      skillBands, yearsBands,
    }),
    integration.tier,
  ) as SkillTier;
  const iqTier = iqTierOf(def.mental.fightIQ, [P('fm.tier.iq_band1'), P('fm.tier.iq_band2'), P('fm.tier.iq_band3'), P('fm.tier.iq_band4')]);
  say(
    `aggregates: strikingMean ${strikingMean.toFixed(1)} (${striking.best}) T${strikingTier}, ` +
      `grapplingMean ${grapplingMean.toFixed(1)} (${grappling.best}) T${grapplingTier}, ` +
      `mmaMean = 0.35x${strikingMean.toFixed(1)} + 0.35x${grapplingMean.toFixed(1)} + 0.30x${integration.mean.toFixed(1)} = ${mmaMean.toFixed(1)} -> T${mmaTier}; iqTier ${iqTier}`,
  );

  const S = (d: CoreDisciplineId, k: string): number => disciplines[d].effective[k] ?? 0;

  // ---- 6. composites (§2.7) ----------------------------------------------
  const refKg = P('fm.mass.ref_kg');
  const massIndex = Math.log(fightNightKg / refKg);
  const classLimit = weightClassLimitKg(weightClass);
  const regainPct = regainPctFor(weightClass, params, rec.weightCut?.regainPct);
  const classRefKg = Number.isFinite(classLimit) ? classLimit * (1 + regainPct / 100) : fightNightKg;
  const massVsClass = Math.log(fightNightKg / classRefKg);

  const effectiveReachM = (b.reachM - P('fm.reach.shoulder_ratio') * b.heightM) / 2 + P('fm.reach.shoulder_turn_m');
  const effectiveKickReachM = b.legReachM + P('fm.reach.kick_extra_m');
  const reachLeverage = P(`fm.reach.leverage.${weightClassKey(weightClass)}`);

  const reactionTimeMs = P('fm.attr.rt_base_ms') - P('fm.attr.rt_slope_ms_per_pt') * (effective.reactionTime - 50);
  const footSpeedMs = P('fm.attr.foot_speed_base') + P('fm.attr.foot_speed_slope') * (effective.speed - 50);
  const handSpeedMs = P('fm.attr.hand_speed_base') + P('fm.attr.hand_speed_slope') * (effective.handSpeed - 50);
  const kickSpeedMs = P('fm.attr.kick_speed_base') + P('fm.attr.kick_speed_slope') * (effective.kickSpeed - 50);
  const bodyToughnessThresholdMult = 1 + P('fm.attr.toughness_threshold_range') * (effective.bodyToughness / 100 - 0.5);
  const recoveryHalfLifeMult = 1 - P('fm.attr.recovery_halflife_range') * (effective.recovery / 100 - 0.5);
  const neckMult = P('fm.attr.neck_mult_a') - P('fm.attr.neck_mult_b') * (effective.neck / 100);
  const flexKickQualityMult = P('fm.attr.flex_kick_base') + P('fm.attr.flex_kick_slope') * (effective.flexibility / 100);
  const balanceStumbleMult = P('fm.attr.balance_stumble_a') - P('fm.attr.balance_stumble_b') * (effective.balance / 100);

  // Technique gates physical power: elite rear-hand force is 2x novice at
  // similar body mass `[S: LIT_B §4.9]`, so the sub-skill multiplies, never adds.
  const gateFloor = P('fm.power.gate_floor');
  const gateSpan = P('fm.power.gate_span');
  const gateExp = P('fm.power.gate_exp');
  const techGate = (s: number): number => gateFloor + gateSpan * Math.pow(clamp(s, 0, 100) / 100, gateExp);
  const attrTerm = (v: number): number =>
    Math.pow(P('fm.power.phys_attr_base') + P('fm.power.phys_attr_weight') * (v / P('fm.power.phys_attr_ref')), P('fm.power.phys_exp'));
  const physTerm =
    Math.pow(fightNightKg / refKg, P('fm.power.phys_mass_exp')) *
    attrTerm(effective.strength) * attrTerm(effective.explosiveness);
  const handTerm = P('fm.power.hand_term_base') + P('fm.power.hand_term_slope') * (handSpeedMs / P('fm.power.hand_term_ref'));
  const kickTerm = P('fm.power.kick_term_base') + P('fm.power.kick_term_slope') * (kickSpeedMs / P('fm.power.kick_term_ref'));

  const punchGateSkill = Math.max(S('boxing', 'power'), S('kickboxing', 'punches'), S('muayThai', 'hands'));
  const kickGateSkill = Math.max(
    S('muayThai', 'kicks'), S('kickboxing', 'kicks'),
    P('fm.power.tkd_kick_gate') * S('taekwondo', 'kicks'),
    P('fm.power.karate_kick_gate') * S('karate', 'kicks'),
  );
  const rearHand = P('fm.power.rear_ref_n') * techGate(punchGateSkill) * physTerm * handTerm;
  const hookMult = P('fm.power.hook_mult');
  const rearKick = P('fm.power.kick_pad_ref_n') * techGate(kickGateSkill) * physTerm * kickTerm * P('fm.power.kick_pad_to_fight');
  const powerIndex: PowerIndex = {
    rearHand,
    leadHand: P('fm.power.lead_ratio') * rearHand,
    hookMult,
    rearKick,
    leadKick: P('fm.power.lead_kick_ratio') * rearKick,
    knee: P('fm.power.knee_mult') * rearHand * hookMult,
    elbow: P('fm.power.elbow_mult') * rearHand * hookMult,
    headKickAlphaMult: P('fm.power.head_kick_alpha_mult'),
  };
  say(
    `powerIndex.rearHand = 4800 x techGate(${punchGateSkill.toFixed(0)})=${techGate(punchGateSkill).toFixed(3)} ` +
      `x physTerm ${physTerm.toFixed(3)} x handTerm ${handTerm.toFixed(3)} = ${Math.round(rearHand)} N [S: LIT_B §4.9]`,
  );
  say(`powerIndex.rearKick = 1400 x techGate(${kickGateSkill.toFixed(0)}) x physTerm x ${kickTerm.toFixed(3)} x 3.4 = ${Math.round(rearKick)} N [S: MT §7.1]`);

  const grapplingStrength = clamp100(effective.strength + P('fm.grap.strength_mass_slope') * massVsClass);
  const grappling2: GrapplingComposites = {
    grapplingStrength,
    clinchPower:
      P('fm.grap.clinch_power_strength') * grapplingStrength +
      P('fm.grap.clinch_power_explosive') * effective.explosiveness +
      P('fm.grap.clinch_power_balance') * effective.balance,
    sprawlSpeedMult: P('fm.grap.sprawl_speed_base') + P('fm.grap.sprawl_speed_slope') * (effective.explosiveness / 100),
    tdDefenceBase:
      P('fm.grap.tdd_w_tdd') * S('wrestling', 'takedownDefence') +
      P('fm.grap.tdd_w_balance') * effective.balance +
      P('fm.grap.tdd_w_strength') * grapplingStrength +
      P('fm.grap.tdd_w_cage') * S('mmaIntegration', 'cageWork'),
    subAttack:
      P('fm.grap.sub_w_attack') * S('bjj', 'subAttack') +
      P('fm.grap.sub_w_best') * Math.max(S('bjj', 'chokes'), S('bjj', 'jointLocks'), S('bjj', 'legLocks')) +
      P('fm.grap.sub_w_top') * S('bjj', 'topControl'),
    subDefence:
      P('fm.grap.subdef_w_def') * S('bjj', 'subDefence') +
      P('fm.grap.subdef_w_escapes') * S('bjj', 'escapes') +
      P('fm.grap.subdef_w_understrikes') * S('mmaIntegration', 'subDefenceUnderStrikes'),
  };
  say(
    `grappling: strength ${grappling2.grapplingStrength.toFixed(1)}, clinchPower ${grappling2.clinchPower.toFixed(1)}, ` +
      `tdDefenceBase ${grappling2.tdDefenceBase.toFixed(1)}, SUB ${grappling2.subAttack.toFixed(1)}, SUBDEF ${grappling2.subDefence.toFixed(1)}`,
  );

  const energy: EnergyComposites = {
    pcrCapacity: P('fm.energy.pcr_capacity'),
    pcrRefillHalfLifeS: P('fm.energy.pcr_halflife_base_s') * (P('fm.energy.pcr_cardio_a') - P('fm.energy.pcr_cardio_b') * (effective.cardio / 100)),
    lactateClearance: P('fm.energy.lactate_clear_base') * (P('fm.energy.lactate_cardio_a') + P('fm.energy.lactate_cardio_b') * (effective.cardio / 100)),
    breakRefillFrac: P('fm.energy.break_refill_base') * (P('fm.energy.break_recovery_a') + P('fm.energy.break_recovery_b') * (effective.recovery / 100)),
    actionCostMult: P(`fm.energy.tier_cost.t${disciplines.bjj.tier}`),
  };
  say(
    `energy: PCr half-life ${energy.pcrRefillHalfLifeS.toFixed(1)} s, lactate clearance ${energy.lactateClearance.toFixed(3)} mmol/L/min, ` +
      `break refill ${energy.breakRefillFrac.toFixed(3)}, action cost x${energy.actionCostMult.toFixed(2)} (bjj T${disciplines.bjj.tier}) [S: DP §4.1, BJJ §6]`,
  );

  // Anticipation: this is the expert edge. Reaction *latency* is untouched by
  // tier `[S: LIT_B §4.2]`; what skill buys is the read, the cue lead, the
  // counter and resistance to feints.
  const defSkillStriking =
    (S('boxing', 'headMovement') + S('boxing', 'guard') + Math.max(S('muayThai', 'checks'), S('kickboxing', 'defence'))) / 3;
  const defSkillTakedown = S('wrestling', 'takedownDefence');
  const defSkillSubmission = grappling2.subDefence;
  const iqTermRead = P('fm.antic.read_iq_slope') * ((def.mental.fightIQ - 50) / 50);
  const anticipationOf = (defSkill: number, counterSkill: number): AnticipationBlock => ({
    defSkill,
    readP: clamp(
      P('fm.antic.read_base') + P('fm.antic.read_skill_slope') * (defSkill / 100) + iqTermRead - career.readP,
      P('fm.antic.read_min'), P('fm.antic.read_max'),
    ),
    cueLeadMs: P('fm.antic.cue_lead_max_ms') * (defSkill / 100),
    counterOnReadP:
      P('fm.antic.counter_base') +
      P('fm.antic.counter_range') *
        clamp((counterSkill - P('fm.antic.counter_lo')) / (P('fm.antic.counter_hi') - P('fm.antic.counter_lo')), 0, 1),
    feintBiteP: P('fm.antic.feint_a') - P('fm.antic.feint_b') * (defSkill / 100),
    anxietyReadPenalty:
      (P('fm.antic.anxiety_a') - P('fm.antic.anxiety_b') * (defSkill / 100)) *
      P('fm.antic.anxiety_composure_scale') * (1 - composureEff / 100),
  });
  const anticipation = {
    striking: anticipationOf(defSkillStriking, S('boxing', 'counters')),
    takedown: anticipationOf(defSkillTakedown, S('wrestling', 'chains')),
    submission: anticipationOf(defSkillSubmission, S('bjj', 'subAttack')),
  };
  say(
    `anticipation (striking, defSkill ${defSkillStriking.toFixed(1)}): readP ${anticipation.striking.readP.toFixed(3)}, ` +
      `cueLead ${anticipation.striking.cueLeadMs.toFixed(0)} ms, counterOnRead ${anticipation.striking.counterOnReadP.toFixed(3)}, ` +
      `feintBite ${anticipation.striking.feintBiteP.toFixed(3)}; reactionTimeMs ${reactionTimeMs.toFixed(0)} is NOT tier-scaled [S: LIT_B §4.1-4.2]`,
  );

  // Tap behaviour (§2.7.7).
  const subDef = grappling2.subDefence;
  const noTapFlag = subDef < P('fm.mental.stubbornness_band_edge1');
  const stubbornnessBase = noTapFlag
    ? P('fm.mental.no_tap_untrained')
    : subDef < P('fm.mental.stubbornness_band_edge2')
      ? P('fm.mental.stubbornness_band_novice')
      : subDef < P('fm.mental.stubbornness_band_edge3')
        ? P('fm.mental.stubbornness_band_intermediate')
        : P('fm.mental.stubbornness_band_advanced');
  let stubbornness = clamp(
    stubbornnessBase * (P('fm.mental.stubbornness_heart_base') + def.mental.heart / 100),
    P('fm.mental.stubbornness_min'), P('fm.mental.stubbornness_max'),
  );
  if (subLosses >= P('fm.mental.sub_loss_threshold')) stubbornness *= P('fm.mental.injury_tap_early');
  if (def.style.refusesToTap) stubbornness = Math.max(stubbornness, P('fm.mental.refuse_tap_floor'));

  const execTimeMultKick = P(`fm.exec.time_mult.t${mmaTier}`);
  const punchBlend = P('fm.exec.punch_time_blend');
  const paceAgeMult = 1 - P('fm.age.pace_slope') * Math.max(0, b.ageYears - P('fm.age.pace_start'));

  const runtime: FighterRuntime = {
    def,
    id: def.id,
    name: def.name,
    body: {
      sex, heightM: b.heightM, reachM: b.reachM, legReachM: b.legReachM,
      weighInKg, fightNightKg, weightClass, ageYears: b.ageYears, bodyFatPct: b.bodyFatPct,
      build, stance: b.stance, handedness, dominantLeg,
    },
    rig,
    base,
    effective,
    ageMultipliers,
    career,
    disciplines,
    strikingMean,
    grapplingMean,
    mmaMean,
    tiers: {
      boxing: disciplines.boxing.tier,
      muayThai: disciplines.muayThai.tier,
      kickboxing: disciplines.kickboxing.tier,
      karate: disciplines.karate.tier,
      taekwondo: disciplines.taekwondo.tier,
      wrestling: disciplines.wrestling.tier,
      judo: disciplines.judo.tier,
      bjj: disciplines.bjj.tier,
      sambo: disciplines.sambo.tier,
      mmaIntegration: disciplines.mmaIntegration.tier,
      subDefence: grappling2.subDefence,
      subAttack: grappling2.subAttack,
      mmaTier,
      iqTier,
      strikingTier,
      grapplingTier,
      experience,
    },
    strikingTier,
    grapplingTier,
    mmaTier,
    iqTier,
    experience,
    composureEff,
    paceAgeMult,
    decisionNoiseMult: P('fm.exp.decision_noise_base') - P('fm.exp.decision_noise_slope') * experience,
    attackShare: P('fm.mental.attack_share_base') + P('fm.mental.attack_share_slope') * ((def.mental.aggression - 50) / 50),
    stanceFamiliarity,
    massIndex,
    massVsClass,
    effectiveReachM,
    effectiveKickReachM,
    reachLeverage,
    reactionTimeMs,
    footSpeedMs,
    handSpeedMs,
    kickSpeedMs,
    bodyToughnessThresholdMult,
    recoveryHalfLifeMult,
    neckMult,
    flexKickQualityMult,
    balanceStumbleMult,
    chinEff,
    chinZ,
    kKOHistoryMult,
    residualDehydration: career.residualDehydration,
    powerIndex,
    grappling: grappling2,
    energy,
    anticipation,
    execTimeMultKick,
    execTimeMultPunch: punchBlend + punchBlend * execTimeMultKick,
    telegraphMod: P(`fm.exec.telegraph.t${mmaTier}`),
    hipRotationMult: P(`fm.exec.hip_rotation.t${disciplines.muayThai.tier}`),
    stubbornness,
    noTapFlag,
    derivation: lines,
  };
  say(
    `reach: effective fist ${round(effectiveReachM, 3)} m, kick ${round(effectiveKickReachM, 3)} m, ` +
      `leverage ${reachLeverage} (${weightClass}); massIndex ${round(massIndex, 3)}, massVsClass ${round(massVsClass, 3)}`,
  );
  return runtime;
}

// --------------------------------------------------------------------------
// Class helpers
// --------------------------------------------------------------------------

const CLASS_KEYS: Readonly<Record<WeightClassId, string>> = Object.freeze({
  'wc.atomweight': 'atomweight',
  'wc.strawweight': 'strawweight',
  'wc.flyweight': 'flyweight',
  'wc.bantamweight': 'bantamweight',
  'wc.featherweight': 'featherweight',
  'wc.lightweight': 'lightweight',
  'wc.super_lightweight': 'super_lightweight',
  'wc.welterweight': 'welterweight',
  'wc.super_welterweight': 'super_welterweight',
  'wc.middleweight': 'middleweight',
  'wc.super_middleweight': 'super_middleweight',
  'wc.light_heavyweight': 'light_heavyweight',
  'wc.cruiserweight': 'cruiserweight',
  'wc.heavyweight': 'heavyweight',
  'wc.super_heavyweight': 'super_heavyweight',
  'wc.open': 'open',
});

function weightClassKey(id: WeightClassId): string {
  return CLASS_KEYS[id];
}

function weightClassLimitKg(id: WeightClassId): number {
  // Re-exported through types.ts; kept local so derive has no import cycle.
  const limits: Record<string, number> = {
    atomweight: 47.6, strawweight: 52.2, flyweight: 56.7, bantamweight: 61.2, featherweight: 65.8,
    lightweight: 70.3, super_lightweight: 74.8, welterweight: 77.1, super_welterweight: 79.4,
    middleweight: 83.9, super_middleweight: 88.5, light_heavyweight: 93.0, cruiserweight: 102.1,
    heavyweight: 120.2, super_heavyweight: 140.0,
  };
  return limits[weightClassKey(id)] ?? Number.POSITIVE_INFINITY;
}

/** Median post-weigh-in regain for the class `[S: LIT_B §2.8]`. */
export function regainPctFor(id: WeightClassId, params: ResolvedParams, override?: number): number {
  if (override !== undefined) return override;
  const key = `fm.body.regain_pct.${weightClassKey(id)}`;
  return params.index.has(key) ? params.get(key) : params.get('fm.body.regain_pct.default_other');
}
