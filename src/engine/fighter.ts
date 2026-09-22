/**
 * FIGHTER MODEL - how the supplied athlete profiles become model parameters.
 *
 * The profiles give body metrics, three one-rep-max lifts, training history and
 * a conditioning label. None of those is a fighting attribute, so each is
 * translated explicitly below. Every translation is an assumption; the
 * `derivationNotes` array on each derived fighter records the arithmetic so the
 * UI can show exactly where each number came from.
 *
 * Deliberate modelling choices:
 *  1. Lifting strength is NEVER used as a direct proxy for fighting ability.
 *     It enters only as RELATIVE strength (total / bodyweight), on a log scale,
 *     and only feeds the power index and the grappling indices.
 *  2. Experience saturates (1 - e^(-years/tau)); the fifth year of training is
 *     worth far less than the first.
 *  3. Taekwondo is discounted to 0.6 of a boxing year for this ruleset - kicking,
 *     distance management and timing transfer; gloved hand-fighting and head
 *     movement largely do not. That 0.6 is a judgement call, not a measurement.
 *  4. Conditioning changes only stamina economy. It never adds fresh capability.
 */

import type { Params } from './params';

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

export const ATHLETE_A: AthleteProfile = {
  id: 'A',
  name: 'Athlete A',
  short: 'A',
  ageYears: 20,
  heightIn: 70,
  weightLb: 200,
  benchLb: 280,
  squatLb: 365,
  deadliftLb: 405,
  taekwondoYears: 5,
  boxingYears: 3,
  grapplingYears: 0,
  conditioning: 0.8,
  trainingDaysPerWeek: 7,
};

export const ATHLETE_B: AthleteProfile = {
  id: 'B',
  name: 'Athlete B',
  short: 'B',
  ageYears: 20,
  heightIn: 70,
  weightLb: 150,
  benchLb: 100,
  squatLb: 150,
  deadliftLb: 200,
  taekwondoYears: 0,
  boxingYears: 0,
  grapplingYears: 0,
  conditioning: 0.5,
  trainingDaysPerWeek: 0,
};

export interface DerivedAttributes {
  massKg: number;
  heightM: number;
  reachM: number;
  /** ln(mass / reference mass). Positive = heavier than the reference. */
  massIndex: number;
  relStrength: number;
  /** ln(relative strength / reference). Positive = stronger per kg. */
  strengthIndex: number;
  /** 0-1 saturating striking experience. */
  strikingIndex: number;
  /** 0-1 saturating grappling experience. */
  grapplingIndex: number;
  /** 0-1 saturating general ring craft / technique. */
  techniqueIndex: number;
  /** Composite striking power multiplier. */
  powerIndex: number;
  /** Top speed, m/s. */
  speed: number;
  /** Stamina regeneration, points per second. */
  staminaRegen: number;
  /** Stamina pool. */
  staminaMax: number;
  /** How much impact this fighter absorbs before the referee intervenes. */
  durability: number;
  derivationNotes: string[];
}

const LB_TO_KG = 0.45359237;

function saturate(years: number, tau: number): number {
  return years > 0 ? 1 - Math.exp(-years / tau) : 0;
}

export function deriveAttributes(p: AthleteProfile, P: Params): DerivedAttributes {
  const notes: string[] = [];

  const massKg = p.weightLb * LB_TO_KG;
  const heightM = p.heightIn * 0.0254;
  // Reach is not supplied, so it is derived from height alone and is therefore
  // IDENTICAL for both athletes (both 5'10"). It confers no advantage here.
  const reachM = heightM * 1.02 * 0.5;
  const massIndex = Math.log(massKg / P.refBodyMassKg);
  notes.push(
    `mass = ${p.weightLb} lb = ${massKg.toFixed(1)} kg; massIndex = ln(${massKg.toFixed(1)}/${P.refBodyMassKg}) = ${massIndex.toFixed(3)}`
  );

  const total = p.benchLb + p.squatLb + p.deadliftLb;
  const relStrength = total / p.weightLb;
  const strengthIndex = Math.log(relStrength / P.refRelStrength);
  notes.push(
    `lift total = ${total} lb; relative strength = ${total}/${p.weightLb} = ${relStrength.toFixed(2)}x bodyweight; ` +
      `strengthIndex = ln(${relStrength.toFixed(2)}/${P.refRelStrength}) = ${strengthIndex.toFixed(3)} ` +
      `(ABSOLUTE load is deliberately not used)`
  );

  const strikingYears = p.boxingYears * P.boxTransfer + p.taekwondoYears * P.tkdTransfer;
  const strikingIndex = saturate(strikingYears, P.tauStriking);
  notes.push(
    `striking years = ${p.boxingYears}x${P.boxTransfer} boxing + ${p.taekwondoYears}x${P.tkdTransfer} TKD = ${strikingYears.toFixed(1)}; ` +
      `strikingIndex = 1 - e^(-${strikingYears.toFixed(1)}/${P.tauStriking}) = ${strikingIndex.toFixed(3)}`
  );

  const grapplingIndex = saturate(p.grapplingYears, P.tauGrappling);
  notes.push(
    `grappling years = ${p.grapplingYears}; grapplingIndex = ${grapplingIndex.toFixed(3)} ` +
      `(neither profile lists grappling training, so this term cancels)`
  );

  const allYears = p.boxingYears + p.taekwondoYears + p.grapplingYears;
  const freqBonus = Math.min(0.12, p.trainingDaysPerWeek * 0.017);
  const techniqueIndex = Math.min(1, saturate(allYears, P.tauTechnical) + (allYears > 0 ? freqBonus : 0));
  notes.push(
    `total training = ${allYears} yr; techniqueIndex = 1 - e^(-${allYears}/${P.tauTechnical}) ` +
      `+ ${freqBonus.toFixed(3)} (daily-training bonus) = ${techniqueIndex.toFixed(3)}`
  );

  // Power: mass and relative strength both matter, but technique gates how much
  // of that force actually reaches a moving target.
  const rawPower = Math.exp(P.massPowerWeight * massIndex + P.strengthWeight * strengthIndex);
  const powerIndex = rawPower * (0.70 + 0.30 * techniqueIndex);
  notes.push(
    `powerIndex = exp(${P.massPowerWeight}*${massIndex.toFixed(3)} + ${P.strengthWeight}*${strengthIndex.toFixed(3)}) ` +
      `x (0.70 + 0.30*${techniqueIndex.toFixed(3)}) = ${powerIndex.toFixed(3)} ` +
      `(technique gates how much force lands on a moving target)`
  );

  const speed = Math.max(
    0.55,
    P.baseSpeed + P.speedSkillBonus * techniqueIndex - P.speedMassPenalty * Math.max(0, massIndex)
  );
  notes.push(
    `speed = ${P.baseSpeed} + ${P.speedSkillBonus}*${techniqueIndex.toFixed(3)} - ${P.speedMassPenalty}*max(0,${massIndex.toFixed(3)}) = ${speed.toFixed(2)} m/s`
  );

  const staminaRegen = P.staminaRegenStanding + P.staminaRegenConditioning * p.conditioning;
  const staminaMax = P.staminaMax * (0.85 + 0.3 * p.conditioning);
  notes.push(
    `conditioning ${p.conditioning.toFixed(2)} -> stamina pool ${staminaMax.toFixed(0)}, ` +
      `regen ${staminaRegen.toFixed(2)}/s (conditioning affects stamina economy ONLY)`
  );

  // Durability scales mildly with mass: more mass to move per unit of impact.
  const durability = P.tkoDamage * (0.55 + 0.55 * Math.exp(massIndex));
  notes.push(`durability (damage index tolerated before a referee stoppage) = ${durability.toFixed(0)}`);

  return {
    massKg, heightM, reachM, massIndex, relStrength, strengthIndex,
    strikingIndex, grapplingIndex, techniqueIndex, powerIndex, speed,
    staminaRegen, staminaMax, durability, derivationNotes: notes,
  };
}
