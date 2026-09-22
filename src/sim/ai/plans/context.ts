/**
 * PLAN CONTEXT — the inputs every plan rule reads.
 *
 * Built once per fighter, pre-bout, from (a) his own profile, (b) the
 * *scouting report* about the opponent (never the opponent's runtime: see
 * `ai/scout.ts`), and (c) the ruleset. Rules in `physical.ts`, `style.ts` and
 * `stance.ts` are pure functions of this object, which is what makes them
 * testable one at a time and what keeps the generator free of special cases.
 */
import type { Ruleset, Target, Weapon } from '../../rules/types';
import type { IqTier07 } from '../contracts';
import type { ScoutedProfile } from '../scout';

/** Δ = own − opponent, in the units §2.5.3 step 1 lists. */
export interface AdvantageVector {
  reachCm: number;
  heightCm: number;
  /** Fight-night mass difference as a percentage of the opponent's mass. */
  massPct: number;
  speedTier: number;
  strengthTier: number;
  cardioTier: number;
  chinTier: number;
  powerTier: number;
  strikingTier: number;
  wrestlingTier: number;
  bjjTier: number;
  boxing: number;
  kicking: number;
  /** own tdOffence − opp tdDefence. */
  tdOffence: number;
  /** own tdDefence − opp tdOffence. */
  tdDefence: number;
  clinch: number;
  bjjTop: number;
  bjjBottom: number;
  cageWork: number;
}

/** Everything the plan needs to know about the rules, flattened. */
export interface RulesetFacts {
  id: string;
  family: string;
  rounds: number;
  roundLengthS: number;
  takedownsAllowed: boolean;
  submissionsAllowed: boolean;
  groundFightingAllowed: boolean;
  groundStrikesAllowed: boolean;
  clinchAllowed: boolean;
  /** Boxing: holding is a foul, so the plan may only break. */
  holdingIsFoul: boolean;
  punchesAllowed: boolean;
  kicksAllowed: boolean;
  kneesAllowed: boolean;
  elbowsAllowed: boolean;
  street: boolean;
  /** `multiOpponent.allowed` — the plan gains the outnumbered contingency. */
  multiOpponent: boolean;
}

export interface PlanContext {
  iqTier: IqTier07;
  self: ScoutedProfile;
  opp: ScoutedProfile;
  delta: AdvantageVector;
  /** Closed = same stance, open = one of each. */
  stancePair: 'closed' | 'open';
  /** Fights this fighter has had against the opponent's stance (ST-5). */
  stanceExposure: number;
  rules: RulesetFacts;
  /** Own reaction-time attribute (0-100); the counter-striking fitness reads it. */
  reactionTime: number;
  /** Personality, read straight from chapter 01. */
  aggression: number;
  composure: number;
  discipline: number;
  adaptability: number;
}

const legalityOf = (ruleset: Ruleset, weapon: Weapon, target: Target): string =>
  ruleset.legal[weapon]?.[target]?.standing ?? 'legal';

/** A weapon is plannable if it is legal to the head or to the body, standing. */
export function weaponUsable(ruleset: Ruleset, weapon: Weapon): boolean {
  if (ruleset.family === 'street') return true;
  return legalityOf(ruleset, weapon, 'head') === 'legal'
    || legalityOf(ruleset, weapon, 'body') === 'legal';
}

export function rulesetFactsOf(ruleset: Ruleset): RulesetFacts {
  return {
    id: ruleset.id,
    family: ruleset.family,
    rounds: ruleset.rounds.count,
    roundLengthS: ruleset.rounds.lengthS,
    takedownsAllowed: ruleset.takedowns.allowed,
    submissionsAllowed: ruleset.submissions.allowed,
    groundFightingAllowed: ruleset.ground.fightingAllowed,
    groundStrikesAllowed: ruleset.ground.strikesAllowed,
    clinchAllowed: ruleset.clinch.allowed,
    holdingIsFoul: ruleset.clinch.activityRule === 'holding_is_foul' || !ruleset.clinch.allowed,
    punchesAllowed: weaponUsable(ruleset, 'punch'),
    kicksAllowed: weaponUsable(ruleset, 'kick'),
    kneesAllowed: weaponUsable(ruleset, 'knee'),
    elbowsAllowed: weaponUsable(ruleset, 'elbow'),
    street: ruleset.family === 'street',
    multiOpponent: ruleset.multiOpponent.allowed,
  };
}

export function advantageOf(self: ScoutedProfile, opp: ScoutedProfile): AdvantageVector {
  return {
    reachCm: (self.physical.reachM - opp.physical.reachM) * 100,
    heightCm: (self.physical.heightM - opp.physical.heightM) * 100,
    massPct: opp.physical.massKg > 0
      ? (self.physical.massKg - opp.physical.massKg) / opp.physical.massKg * 100
      : 0,
    speedTier: self.tiers.speed - opp.tiers.speed,
    strengthTier: self.tiers.strength - opp.tiers.strength,
    cardioTier: self.tiers.cardio - opp.tiers.cardio,
    chinTier: self.tiers.chin - opp.tiers.chin,
    powerTier: self.tiers.power - opp.tiers.power,
    strikingTier: self.tiers.striking - opp.tiers.striking,
    wrestlingTier: self.tiers.wrestling - opp.tiers.wrestling,
    bjjTier: self.tiers.bjj - opp.tiers.bjj,
    boxing: self.skills.boxing - opp.skills.boxing,
    kicking: self.skills.kicking - opp.skills.kicking,
    tdOffence: self.skills.tdOffence - opp.skills.tdDefence,
    tdDefence: self.skills.tdDefence - opp.skills.tdOffence,
    clinch: self.skills.clinch - opp.skills.clinch,
    bjjTop: self.skills.bjjTop - opp.skills.bjjBottom,
    bjjBottom: self.skills.bjjBottom - opp.skills.bjjTop,
    cageWork: self.skills.cageWork - opp.skills.cageWork,
  };
}

export function stancePairOf(a: ScoutedProfile, b: ScoutedProfile): 'closed' | 'open' {
  const norm = (s: string): string => (s === 'switch' ? 'orthodox' : s);
  return norm(a.physical.stance) === norm(b.physical.stance) ? 'closed' : 'open';
}
