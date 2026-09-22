/**
 * FIGHTER PROFILE — the §1 interface table ("in, from §01") as one object.
 *
 * Chapter 05 never reads a `FighterDefinition` directly: it reads the derived
 * values chapter 01 owns (`chinEff`, `neck`, the energy composites, the career
 * multipliers). Until 01 lands its runtime, `profileFromDefinition` derives
 * them here using exactly the formulas 05 quotes, each marked with the 01
 * section that will own it. Replacing those three helpers with calls into 01 is
 * the whole migration.
 */
import type { FighterDefinition } from '../fighter/types';
import type { GloveType } from './impact';

/** How big the occasion is, for the adrenaline dump (§2.5.7). */
export type EventMagnitude = 'regional' | 'main' | 'title';

export interface EnergyComposites {
  /** 01 §2.7.5 `energy.pcrRefillHalfLifeS` — in-round PCr half-time, seconds. */
  pcrRefillHalfLifeS: number;
  /** 01 `energy.lactateClearance` — multiplier on `fat.lacClearPerMin`. */
  lactateClearance: number;
  /** 01 `energy.breakRefillFrac` — multiplier on the break's PCr refill. */
  breakRefillFrac: number;
  /** 01 `energy.actionCostMult` — grappling-class cost multiplier by tier. */
  actionCostMult: number;
}

export interface FighterDamageProfile {
  id: number;
  // ---- 01 attributes ------------------------------------------------------
  /** 01 §2.4.3 — age and KO history are already inside. Every `chin` is this. */
  chinEff: number;
  /** 01 §2.2.1 `neck`; drives `kBrace` (§2.2.2) and 04's `M_NECK`. */
  neck: number;
  bodyToughness: number;
  cardio: number;
  recovery: number;
  strength: number;
  /** 01 `fightNightKg`. */
  massKg: number;
  ageYears: number;
  composureEff: number;
  heart: number;
  discipline: number;
  /** 01 §2.4.1: `0.1 + 0.9 * (1 - exp(-totalFights/6))`. Debut 0.10. */
  experience: number;
  /** Striking sub-skill mean, for `skillCostMult` (§2.5.1). */
  strikingSkill: number;
  // ---- career -------------------------------------------------------------
  koLosses: number;
  priorCutsCareer: number;
  // ---- 01 energy composites ----------------------------------------------
  energy: EnergyComposites;
  // ---- camp / venue / ruleset --------------------------------------------
  /** Fraction of body mass still down at fight time, 0-0.05 (§2.5.6). */
  residualDehydration: number;
  acclimatised: boolean;
  altitudeM: number;
  gloveType: GloveType;
  eventMagnitude: EventMagnitude;
  hostileCrowd: boolean;
  /** Corner quality flags (§2.5.4) — the only corner inputs this section takes. */
  corner: { sitDown: boolean; breatheCue: boolean; affirmation: boolean; cutmanSkill: number };
}

const DEFAULT_ENERGY: EnergyComposites = {
  pcrRefillHalfLifeS: 30,
  lactateClearance: 1,
  breakRefillFrac: 1,
  actionCostMult: 1,
};

/** A UFC-average (T4) fighter, for tests and for filling gaps. */
export function defaultProfile(over: Partial<FighterDamageProfile> = {}): FighterDamageProfile {
  return {
    id: 0,
    chinEff: 50,
    neck: 50,
    bodyToughness: 50,
    cardio: 50,
    recovery: 50,
    strength: 50,
    massKg: 77,
    ageYears: 29,
    composureEff: 50,
    heart: 50,
    discipline: 50,
    experience: 0.83,
    strikingSkill: 50,
    koLosses: 0,
    priorCutsCareer: 0,
    energy: { ...DEFAULT_ENERGY },
    residualDehydration: 0,
    acclimatised: true,
    altitudeM: 0,
    gloveType: 'mma4oz',
    eventMagnitude: 'main',
    hostileCrowd: false,
    corner: { sitDown: true, breatheCue: true, affirmation: true, cutmanSkill: 1 },
    ...over,
  };
}

/**
 * 01 §2.4.1. Ten pro fights gives 0.83; a debutant 0.10. Quoted verbatim in
 * 05 §2.5.7, which is why it can be reproduced here.
 */
export function experienceFrom(totalFights: number): number {
  return 0.1 + 0.9 * (1 - Math.exp(-Math.max(0, totalFights) / 6));
}

/**
 * 01 §2.2.2 owns the age curve on chin; 05 §2.4.2 (REVIEW N2) quotes it as
 * -1.75 pts/yr from 25-30 and -2.5 pts/yr from 30-40, attenuated x0.6, and
 * forbids this section from adding any *second* age term. Reproduced here only
 * so the module runs before 01's runtime exists.
 */
export function chinEffFrom(chin: number, ageYears: number, koLosses: number): number {
  const a = Math.min(Math.max(ageYears, 0), 60);
  const decline = (Math.min(Math.max(a - 25, 0), 5) * 1.75 + Math.min(Math.max(a - 30, 0), 10) * 2.5) * 0.6;
  // 01 §2.4.3 also takes chin down for KO history; `ko.careerChinLoss` is 3
  // points per KO/TKO loss (§2.4.6) and this is the same write, replayed.
  return Math.max(0, chin - decline - 3 * koLosses);
}

/** Mean of a discipline's sub-skills, or 0 if the fighter never trained it. */
function skillMean(def: FighterDefinition, ids: readonly string[]): number {
  let sum = 0;
  let n = 0;
  for (const id of ids) {
    const d = def.disciplines[id as keyof typeof def.disciplines];
    if (!d) continue;
    for (const v of Object.values(d.sub)) {
      sum += v;
      n++;
    }
  }
  return n === 0 ? 0 : sum / n;
}

export function profileFromDefinition(
  def: FighterDefinition,
  id: number,
  over: Partial<FighterDamageProfile> = {},
): FighterDamageProfile {
  const rec = def.record;
  const totalFights = rec.proWins + rec.proLosses + rec.proDraws + rec.amWins + rec.amLosses;
  return defaultProfile({
    id,
    chinEff: chinEffFrom(def.physical.chin, def.body.ageYears, rec.koLosses),
    neck: def.physical.neckStrength,
    bodyToughness: def.physical.bodyToughness,
    cardio: def.physical.cardio,
    recovery: def.physical.recovery,
    strength: def.physical.strength,
    massKg: def.body.massKg,
    ageYears: def.body.ageYears,
    composureEff: def.mental.composure,
    heart: def.mental.heart,
    discipline: def.mental.discipline,
    experience: experienceFrom(totalFights),
    strikingSkill: skillMean(def, ['boxing', 'muayThai', 'kickboxing', 'karate', 'taekwondo']),
    koLosses: rec.koLosses,
    ...over,
  });
}

/** 01 `kKOHistoryMult` = `1 + 0.25 * min(koLosses, 4)` (§2.4.2). */
export function koHistoryMult(koLosses: number, perKO: number, cap: number): number {
  return 1 + perKO * Math.min(Math.max(koLosses, 0), cap);
}
