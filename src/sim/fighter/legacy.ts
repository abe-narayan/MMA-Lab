/**
 * LEGACY CONVERSION — `AthleteProfile` -> `FighterDefinition`, chapter 01 §2.2.3.
 *
 * The v3 engine described a fighter with body metrics, three one-rep-max lifts,
 * years of training in three buckets and a conditioning label
 * (`src/engine/fighter.ts`). None of those is a fighting attribute, so every
 * mapping below is an explicit assumption, and every one is `[E]` unless
 * tagged. The point is corpus survival: the two shipped demo athletes and any
 * stored profile must still produce a fighter the new model can run, with the
 * old qualitative result intact (calibration hook C-15).
 *
 * The profile type is re-declared here rather than imported so that
 * `src/sim/**` keeps no dependency on the old engine directory; it is
 * structurally identical, so `fromLegacyProfile(ATHLETE_A)` type-checks.
 *
 * Three corrections to the old derivation are deliberate:
 *
 *  - Reach was `1.02 x 0.5 x height` — a half-span, which made both demo
 *    athletes identical and half as long-armed as a real person. It is now the
 *    ape-index prior `1.026 x height` `[S: LIT_B §2.4]`.
 *  - `refRelStrength` was 3.0, an *untrained* reference `[S: AUDIT §1.1]`. The
 *    attribute scale anchors 50 at 4.0 x bodyweight, so the conversion uses 4.0.
 *  - "Grappling years" were one undifferentiated bucket; they are split across
 *    wrestling and bjj at 0.8, because a year of unspecified grappling is not a
 *    year of either.
 */

import {
  weightClassFor,
  type BuildBlend, type FighterDefinition, type FighterDisciplines,
} from './types';
import type { ResolvedParams } from '../params';

/** Structural copy of `src/engine/fighter.ts`'s profile. */
export interface AthleteProfile {
  id: string;
  name: string;
  short: string;
  ageYears: number;
  heightIn: number;
  weightLb: number;
  benchLb: number;
  squatLb: number;
  deadliftLb: number;
  taekwondoYears: number;
  boxingYears: number;
  grapplingYears: number;
  /** 0-1. "Good conditioning" -> 0.80, "average conditioning" -> 0.50. */
  conditioning: number;
  /** Sessions per week; only used to nudge the technique index. */
  trainingDaysPerWeek: number;
}

const LB_TO_KG = 0.45359237;
const IN_TO_M = 0.0254;

/** Defaults mirroring `fm.legacy.*` and the §2.1/§2.3.2 priors they lean on. */
const D = {
  strengthBase: 50,
  strengthSlope: 60,
  strengthRef: 4.0,
  techniqueTau: 3,
  explosiveStrengthW: 0.6,
  explosiveBase: 20,
  explosiveConditioningW: 20,
  speedBase: 45,
  speedTechniqueW: 20,
  speedMassW: 25,
  handSpeedBase: 40,
  handSpeedSkillW: 20,
  handSpeedExplosiveW: 0.15,
  cardioBase: 30,
  cardioConditioningW: 50,
  recoveryOffset: -5,
  recoveryTrainingW: 5,
  neutralAttr: 50,
  neckBase: 40,
  neckStrengthW: 0.2,
  flexKicker: 60,
  flexDefault: 45,
  balanceBase: 45,
  balanceTechniqueW: 15,
  grapplingSplit: 0.8,
  mmaIntegrationW: 0.5,
  iqBase: 35,
  iqTechniqueW: 30,
  composureBase: 35,
  composureTechniqueW: 25,
  aggression: 55,
  heart: 50,
  disciplineBase: 40,
  disciplineTrainingW: 30,
  adaptabilityBase: 40,
  adaptabilityTechniqueW: 20,
  bodyfatTrained: 12,
  bodyfatUntrained: 20,
  quality: 0.9,
  yearsTau: 3.5,
  untrainedDefault: 5,
  apeIndex: 1.026,
  legReachRatio: 0.575,
  refKg: 77.1,
  bigFightDrop: 15,
};

type LegacyConstants = typeof D;

function constantsFrom(params?: ResolvedParams): LegacyConstants {
  if (!params) return D;
  const g = (id: string, fallback: number): number => (params.index.has(id) ? params.get(id) : fallback);
  return {
    strengthBase: g('fm.legacy.strength_base', D.strengthBase),
    strengthSlope: g('fm.legacy.strength_slope', D.strengthSlope),
    strengthRef: g('fm.legacy.strength_ref', D.strengthRef),
    techniqueTau: g('fm.legacy.technique_tau', D.techniqueTau),
    explosiveStrengthW: g('fm.legacy.explosive_strength_w', D.explosiveStrengthW),
    explosiveBase: g('fm.legacy.explosive_base', D.explosiveBase),
    explosiveConditioningW: g('fm.legacy.explosive_conditioning_w', D.explosiveConditioningW),
    speedBase: g('fm.legacy.speed_base', D.speedBase),
    speedTechniqueW: g('fm.legacy.speed_technique_w', D.speedTechniqueW),
    speedMassW: g('fm.legacy.speed_mass_w', D.speedMassW),
    handSpeedBase: g('fm.legacy.hand_speed_base', D.handSpeedBase),
    handSpeedSkillW: g('fm.legacy.hand_speed_skill_w', D.handSpeedSkillW),
    handSpeedExplosiveW: g('fm.legacy.hand_speed_explosive_w', D.handSpeedExplosiveW),
    cardioBase: g('fm.legacy.cardio_base', D.cardioBase),
    cardioConditioningW: g('fm.legacy.cardio_conditioning_w', D.cardioConditioningW),
    recoveryOffset: g('fm.legacy.recovery_offset', D.recoveryOffset),
    recoveryTrainingW: g('fm.legacy.recovery_training_w', D.recoveryTrainingW),
    neutralAttr: g('fm.legacy.neutral_attr', D.neutralAttr),
    neckBase: g('fm.legacy.neck_base', D.neckBase),
    neckStrengthW: g('fm.legacy.neck_strength_w', D.neckStrengthW),
    flexKicker: g('fm.legacy.flex_kicker', D.flexKicker),
    flexDefault: g('fm.legacy.flex_default', D.flexDefault),
    balanceBase: g('fm.legacy.balance_base', D.balanceBase),
    balanceTechniqueW: g('fm.legacy.balance_technique_w', D.balanceTechniqueW),
    grapplingSplit: g('fm.legacy.grappling_split', D.grapplingSplit),
    mmaIntegrationW: g('fm.legacy.mma_integration_w', D.mmaIntegrationW),
    iqBase: g('fm.legacy.iq_base', D.iqBase),
    iqTechniqueW: g('fm.legacy.iq_technique_w', D.iqTechniqueW),
    composureBase: g('fm.legacy.composure_base', D.composureBase),
    composureTechniqueW: g('fm.legacy.composure_technique_w', D.composureTechniqueW),
    aggression: g('fm.legacy.aggression', D.aggression),
    heart: g('fm.legacy.heart', D.heart),
    disciplineBase: g('fm.legacy.discipline_base', D.disciplineBase),
    disciplineTrainingW: g('fm.legacy.discipline_training_w', D.disciplineTrainingW),
    adaptabilityBase: g('fm.legacy.adaptability_base', D.adaptabilityBase),
    adaptabilityTechniqueW: g('fm.legacy.adaptability_technique_w', D.adaptabilityTechniqueW),
    bodyfatTrained: g('fm.legacy.bodyfat_trained', D.bodyfatTrained),
    bodyfatUntrained: g('fm.legacy.bodyfat_untrained', D.bodyfatUntrained),
    quality: g('fm.legacy.quality', D.quality),
    yearsTau: g('fm.skill.years_tau', D.yearsTau),
    untrainedDefault: g('fm.skill.untrained_default', D.untrainedDefault),
    apeIndex: g('fm.gen.ape_index_mean', D.apeIndex),
    legReachRatio: g('fm.gen.leg_reach_ratio_mean', D.legReachRatio),
    refKg: g('fm.mass.ref_kg', D.refKg),
    bigFightDrop: g('fm.career.bigfight_base_drop', D.bigFightDrop),
  };
}

const clamp100 = (v: number): number => (v < 0 ? 0 : v > 100 ? 100 : v);

/**
 * Years -> skill prior of 01 §2.3.2: `S(y, q) = 100 q y / (y + tau)`.
 * q = 0.9 (amateur competitor) is the quality a legacy profile implies.
 */
export function yearsToSkill(years: number, quality: number, tau = D.yearsTau): number {
  if (years <= 0) return 0;
  return clamp100((100 * quality * years) / (years + tau));
}

/** Fill every sub-skill of a discipline with the same value; the creator spreads them later. */
function flat<K extends string>(names: readonly K[], value: number): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const n of names) out[n] = value;
  return out;
}

export function fromLegacyProfile(p: AthleteProfile, params?: ResolvedParams): FighterDefinition {
  const c = constantsFrom(params);

  const massKg = p.weightLb * LB_TO_KG;
  const heightM = p.heightIn * IN_TO_M;
  const reachM = c.apeIndex * heightM;
  const legReachM = c.legReachRatio * heightM;
  const bodyFatPct = p.trainingDaysPerWeek >= 3 ? c.bodyfatTrained : c.bodyfatUntrained;

  // Lifting strength is never a direct proxy for fighting ability: it enters
  // only as relative strength, on a log scale.
  const relStrength = (p.benchLb + p.squatLb + p.deadliftLb) / p.weightLb;
  const strength = clamp100(c.strengthBase + c.strengthSlope * Math.log2(relStrength / c.strengthRef));

  const bmi = massKg / (heightM * heightM);
  const endo = Math.min(0.6, Math.max(0, (bmi - 24) / 8));
  const meso = Math.min(0.7, Math.max(0, (relStrength - 3) / 3)) * (1 - endo);
  const build: BuildBlend = { endo, meso, ecto: Math.max(0, 1 - endo - meso) };

  const allYears = p.boxingYears + p.taekwondoYears + p.grapplingYears;
  const techniqueIdx = allYears > 0 ? 1 - Math.exp(-allYears / c.techniqueTau) : 0;

  const explosiveness = clamp100(c.explosiveStrengthW * strength + c.explosiveBase + c.explosiveConditioningW * p.conditioning);
  const speed = clamp100(
    c.speedBase + c.speedTechniqueW * techniqueIdx - c.speedMassW * Math.max(0, Math.log(massKg / c.refKg)),
  );
  const boxSkill = yearsToSkill(p.boxingYears, c.quality, c.yearsTau);
  const tkdSkill = yearsToSkill(p.taekwondoYears, c.quality, c.yearsTau);
  const grapSkill = c.grapplingSplit * yearsToSkill(p.grapplingYears, c.quality, c.yearsTau);

  const handSpeed = clamp100(c.handSpeedBase + c.handSpeedSkillW * (boxSkill / 100) + c.handSpeedExplosiveW * explosiveness);
  const kickSpeed = clamp100(c.handSpeedBase + c.handSpeedSkillW * (tkdSkill / 100) + c.handSpeedExplosiveW * explosiveness);
  const cardio = clamp100(c.cardioBase + c.cardioConditioningW * p.conditioning);
  const recovery = clamp100(cardio + c.recoveryOffset + c.recoveryTrainingW * (p.trainingDaysPerWeek / 7));

  const strikingMean = Math.max(boxSkill, tkdSkill);
  const grapplingMean = grapSkill;
  const integration = Math.max(c.untrainedDefault, c.mmaIntegrationW * Math.min(strikingMean, grapplingMean));

  const disciplines: FighterDisciplines = {};
  if (p.boxingYears > 0) {
    disciplines.boxing = {
      years: p.boxingYears, trainingQuality: c.quality, styleTags: [],
      sub: flat(['jab', 'power', 'combinations', 'headMovement', 'footwork', 'guard', 'bodyWork', 'counters', 'feints', 'ringCraft'] as const, boxSkill),
    };
  }
  if (p.taekwondoYears > 0) {
    disciplines.taekwondo = {
      years: p.taekwondoYears, trainingQuality: c.quality, styleTags: [],
      sub: flat(['kicks', 'headKicks', 'spinning', 'footwork', 'distance', 'counters'] as const, tkdSkill),
    };
  }
  if (p.grapplingYears > 0) {
    // "Grappling" is unspecified in the legacy schema, so it is split rather
    // than credited to one art.
    disciplines.wrestling = {
      years: p.grapplingYears, trainingQuality: c.quality, styleTags: [],
      sub: flat(['shots', 'takedownDefence', 'topControl', 'scrambles', 'cageWrestling', 'clinch', 'chains', 'finishes', 'getUps', 'matReturns'] as const, grapSkill),
    };
    disciplines.bjj = {
      years: p.grapplingYears, trainingQuality: c.quality, styleTags: [],
      sub: flat(['guard', 'passing', 'topControl', 'backControl', 'chokes', 'jointLocks', 'legLocks', 'escapes', 'sweeps', 'subDefence', 'subAttack', 'wrestleUps'] as const, grapSkill),
    };
  }
  disciplines.mmaIntegration = {
    years: 0, trainingQuality: c.quality, styleTags: [],
    sub: flat(['levelChanges', 'clinchStriking', 'cageWork', 'groundAndPound', 'getUps', 'transitions', 'subDefenceUnderStrikes', 'gameplanExecution'] as const, integration),
  };

  const composure = clamp100(c.composureBase + c.composureTechniqueW * techniqueIdx);
  // A kicker's preferred range is long; everyone else defaults to mid (§2.6).
  const kickLed = tkdSkill > boxSkill;

  return {
    schema: 1,
    id: `legacy.${p.id}`,
    name: p.name,
    short: p.short,
    notes: `Converted from the v3 AthleteProfile ${p.id} (01 §2.2.3).`,
    body: {
      heightM, reachM, legReachM,
      massKg,
      // No cut is modelled for a legacy amateur: weigh-in == fight night.
      weighInKg: massKg, fightNightKg: massKg,
      weightClass: weightClassFor(massKg),
      ageYears: p.ageYears,
      bodyFatPct,
      build,
      stance: 'orthodox',
      handedness: 'right',
      dominantLeg: 'right',
      sex: 'male',
    },
    appearance: {
      skinTone: 0.5, hair: 'short', face: 'preset0', tattoos: [],
      shorts: 'mma_short', gloves: 'mma_4oz', nickname: p.short,
    },
    physical: {
      strength,
      explosiveness,
      speed,
      handSpeed,
      kickSpeed,
      cardio,
      chin: c.neutralAttr,
      bodyToughness: c.neutralAttr,
      recovery,
      flexibility: p.taekwondoYears > 0 ? c.flexKicker : c.flexDefault,
      balance: clamp100(c.balanceBase + c.balanceTechniqueW * techniqueIdx),
      reactionTime: c.neutralAttr,
      gripStrength: clamp100(c.neckBase + c.neckStrengthW * strength),
      neckStrength: clamp100(c.neckBase + c.neckStrengthW * strength),
    },
    disciplines,
    mental: {
      fightIQ: clamp100(c.iqBase + c.iqTechniqueW * techniqueIdx),
      aggression: c.aggression,
      composure,
      heart: c.heart,
      discipline: clamp100(c.disciplineBase + c.disciplineTrainingW * (p.trainingDaysPerWeek / 7)),
      adaptability: clamp100(c.adaptabilityBase + c.adaptabilityTechniqueW * techniqueIdx),
    },
    record: {
      proWins: 0, proLosses: 0, proDraws: 0, amWins: 0, amLosses: 0,
      koLosses: 0, knockdownsSuffered: 0, titleFights: 0, layoffMonths: 0,
      bigFightComposure: clamp100(composure - c.bigFightDrop),
      pro: { wins: 0, losses: 0, draws: 0, noContests: 0, koWins: 0, subWins: 0, decWins: 0, koLosses: 0, subLosses: 0, decLosses: 0 },
      amateur: { wins: 0, losses: 0 },
      daysSinceLastBout: 0,
      lastResult: 'none',
      lastResultWasKoLoss: false,
      stanceExposure: { orthodox: 0, southpaw: 0 },
      weightCut: { cutPct: 0, regainPct: 0, residualDehydration: 0 },
      winStreak: 0,
    },
    style: {
      primaryMode: 'distanceStriking',
      preferredRange: kickLed ? 'long' : 'mid',
      favouriteTechniques: kickLed
        ? [{ techId: 'tech.kick_head_rear', weight: 1.3 }, { techId: 'tech.kick_side', weight: 1.2 }, { techId: 'tech.jab', weight: 1.1 }]
        : [{ techId: 'tech.jab', weight: 1.3 }, { techId: 'tech.cross', weight: 1.2 }],
      favouriteCombos: [{ id: 'combo.one_two', sequence: ['tech.jab', 'tech.cross'], weight: 1.2 }],
      goToSubmissions: [],
      takedownPreferences: { prefs: [], setup: 'naked', cageBias: 0 },
      whenLosing: 'hold',
      initiative: 'balanced',
      pressureBias: 50,
      fallbackMode: 'pressureStriking',
      bottomPriority: ['standUp', 'sweep', 'submit'],
      topPriority: ['control', 'strike', 'pass', 'submit'],
      hurtBehaviour: 'coverOnCage',
      losingBehaviour: 'unchanged',
      tiredBehaviour: 'retreat',
      stanceSwitching: 0,
      pacing: [],
      guardStyle: 'highGuard',
    },
  };
}
