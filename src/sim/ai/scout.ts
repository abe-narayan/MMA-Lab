/**
 * SCOUTING — what a camp believes about the opponent before the first bell.
 *
 * Design chapter 07 §2.5.1. The important idea is structural, not cosmetic:
 * **the game plan is built from the scouting report, not from the opponent.**
 * A low-fight-IQ fighter is not handed a correct plan and then penalised; he
 * is handed a *distorted picture* and plans correctly against it. That is why
 * this module exists as a separate layer in front of `plan.ts`, and why the
 * plan generator never takes the opponent's `FighterRuntime` directly.
 *
 * Noise model (§2.5.1):
 *   scouted = true × (1 + N(0, σ)),  σ by iqTier07:
 *   T0 no report at all · T1 30 % · T2 20 % · T3 12 % · T4 8 % · T5 5 %
 *   `[S: MMA_INTEGRATION §6.4 (est.)]`
 * Physical traits (stance, reach, height, mass, age) are exact from T1 — they
 * are visible at the weigh-in — but the draws are still taken and discarded so
 * the stream position does not depend on the tier of the fighter reading it.
 *
 * Draw discipline: `scoutOpponent` consumes exactly `SCOUT_DRAWS` uniforms,
 * always, for every tier. Chapter 07 §2.1 puts these pre-bout draws in
 * fighter-id order before tick 0.
 */
import type { FighterRuntime } from '../fighter';
import type { CoreDisciplineId } from '../fighter';
import type { RNG } from '../rng';
import type { IqTier07 } from './contracts';

// ---------------------------------------------------------------------------
// Profile shapes
// ---------------------------------------------------------------------------

export interface ScoutedPhysical {
  stance: 'orthodox' | 'southpaw' | 'switch';
  reachM: number;
  heightM: number;
  /** Fight-night mass, i.e. after the regain. */
  massKg: number;
  ageYears: number;
}

/** Coarse 0-5 tiers. Everything the plan's fitness table reads as `t(x)`. */
export interface ScoutedTiers {
  striking: number;
  wrestling: number;
  bjj: number;
  cardio: number;
  chin: number;
  power: number;
  speed: number;
  strength: number;
}

/** 0-100 sub-skill composites. Everything the fitness table reads as `s(x)`. */
export interface ScoutedSkills {
  boxing: number;
  kicking: number;
  strikingDefence: number;
  tdOffence: number;
  tdDefence: number;
  clinch: number;
  bjjTop: number;
  bjjBottom: number;
  cageWork: number;
  subDefence: number;
  subAttack: number;
  getUps: number;
}

/** What film gives a camp. All 0-1 shares unless the name says otherwise. */
export interface ScoutedTendencies {
  /** Share of exchanges this fighter initiates. */
  leadShare: number;
  /** Significant strikes landed per minute the camp expects. */
  paceSLpM: number;
  meanComboLength: number;
  /** Takedown attempts per 15 minutes. */
  tdAttemptRate: number;
  /** Share of those shots set up by a strike rather than taken naked. */
  tdOffStrikesShare: number;
  counterRate: number;
  kickCatchRate: number;
  guillotineRate: number;
  /** 0 pure counter … 100 pure pressure. */
  pressureBias: number;
  volumeIndex: number;
  powerIndex: number;
  /** How often pressure puts this fighter's back on the fence. */
  cageBackShare: number;
  /** When hurt, how often he clinches rather than covering or running. */
  hurtClinchShare: number;
  paceDropWhenTired: number;
  controlHeavy: number;
  /** Share of his finishes that came in round 1. */
  finishEarlyShare: number;
}

export interface ScoutedFamiliarity {
  vsOrthodox: number;
  vsSouthpaw: number;
}

export interface ScoutedRecord {
  wins: number;
  losses: number;
  koLosses: number;
  layoffDays: number;
  shortNotice: boolean;
}

/** Style labels the matchup rules of §2.5.5 key on. Derived from the *scouted* numbers. */
export interface ScoutedStyleFlags {
  striker: boolean;
  wrestler: boolean;
  bjjPlayer: boolean;
  pressure: boolean;
  counter: boolean;
  volume: boolean;
  power: boolean;
  usesLongGuard: boolean;
}

export interface ScoutedProfile {
  id: string;
  name: string;
  physical: ScoutedPhysical;
  tiers: ScoutedTiers;
  skills: ScoutedSkills;
  tendencies: ScoutedTendencies;
  familiarity: ScoutedFamiliarity;
  record: ScoutedRecord;
  style: ScoutedStyleFlags;
}

export interface ScoutingReport {
  /** False for T0: no report at all, and therefore no plan (§2.5.8). */
  knows: boolean;
  /** Relative σ actually applied (after the age and short-notice multipliers). */
  sigma: number;
  iqTier: IqTier07;
  /** The distorted picture the plan is built from. `null` at T0. */
  opponent: ScoutedProfile | null;
  /** Own profile, exact, except the T0–T1 self-overrating of §2.5.1. */
  self: ScoutedProfile;
  /** Human-readable notes for the game-plan panel. */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Parameters (mirrored in params/multi.params.ts as `ai.scout.*`)
// ---------------------------------------------------------------------------

/** `ai.scout.sigma.tier` — relative σ by iqTier07. T0 never gets a report. */
export const SCOUT_SIGMA_BY_TIER: readonly number[] = [0, 0.30, 0.20, 0.12, 0.08, 0.05];
/** `ai.rule.AG1` — veterans read film better. */
export const SCOUT_AGE_THRESHOLD_YEARS = 34;
export const SCOUT_AGE_SIGMA_MULT = 0.8;
/** `ai.scout.self_overrate` — T0–T1 over-rate their own tiers by one. */
export const SELF_OVERRATE_TIERS = 1;

const TIER_KEYS = ['striking', 'wrestling', 'bjj', 'cardio', 'chin', 'power', 'speed', 'strength'] as const;
const SKILL_KEYS = [
  'boxing', 'kicking', 'strikingDefence', 'tdOffence', 'tdDefence', 'clinch',
  'bjjTop', 'bjjBottom', 'cageWork', 'subDefence', 'subAttack', 'getUps',
] as const;
const TENDENCY_KEYS = [
  'leadShare', 'paceSLpM', 'meanComboLength', 'tdAttemptRate', 'tdOffStrikesShare',
  'counterRate', 'kickCatchRate', 'guillotineRate', 'pressureBias', 'volumeIndex',
  'powerIndex', 'cageBackShare', 'hurtClinchShare', 'paceDropWhenTired', 'controlHeavy',
  'finishEarlyShare',
] as const;

/**
 * Uniforms consumed by one `scoutOpponent` call, whatever the tier. Two per
 * noised field (Box-Muller), so the count is a pure function of the schema.
 */
export const SCOUT_DRAWS =
  2 * (TIER_KEYS.length + SKILL_KEYS.length + TENDENCY_KEYS.length);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** 0-100 → 0-5 tier using the chapter-01 sub-skill bands. */
export function bandTier(value0to100: number): number {
  const bands = [10, 30, 50, 70, 90];
  for (let i = 0; i < bands.length; i++) if (value0to100 < bands[i]) return i;
  return 5;
}

/**
 * The IQ tier chapter 07 keys on. Chapter 01's `iqTier` is 1-5; 07 adds T0 for
 * a fighter who is untrained overall (07 numbering note).
 */
export function iqTier07Of(rt: FighterRuntime): IqTier07 {
  const overall = Math.max(rt.strikingTier, rt.grapplingTier, rt.mmaTier);
  if (overall === 0) return 0;
  return rt.iqTier as IqTier07;
}

function sub(rt: FighterRuntime, d: CoreDisciplineId, name: string, fallback = 5): number {
  const block = rt.disciplines[d];
  if (!block) return fallback;
  const v = block.effective[name];
  return typeof v === 'number' ? v : fallback;
}

function disciplineMean(rt: FighterRuntime, d: CoreDisciplineId): number {
  return rt.disciplines[d]?.mean ?? 5;
}

function mean(...xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return xs.length === 0 ? 0 : s / xs.length;
}

// ---------------------------------------------------------------------------
// The true profile
// ---------------------------------------------------------------------------

/**
 * Everything a perfect camp would know, read straight off the runtime.
 *
 * Several tendency fields are *proxies* derived from skills and style rather
 * than from observed film: until the career layer stores real per-opponent
 * histories (§2.4.6) there is no film to read. Each proxy is tagged `[E]` in
 * the parameter registry and is the obvious place to plug the career layer in.
 */
export function trueProfile(rt: FighterRuntime): ScoutedProfile {
  const style = rt.def.style;
  const skills: ScoutedSkills = {
    boxing: disciplineMean(rt, 'boxing'),
    kicking: Math.max(
      disciplineMean(rt, 'muayThai'), disciplineMean(rt, 'kickboxing'),
      disciplineMean(rt, 'taekwondo'), disciplineMean(rt, 'karate'),
    ),
    strikingDefence: mean(
      sub(rt, 'boxing', 'headMovement'), sub(rt, 'boxing', 'guard'),
      sub(rt, 'kickboxing', 'defence'), sub(rt, 'muayThai', 'checks'),
    ),
    tdOffence: mean(
      sub(rt, 'wrestling', 'shots'), sub(rt, 'wrestling', 'chains'),
      sub(rt, 'wrestling', 'finishes'), sub(rt, 'judo', 'throws'),
      sub(rt, 'mmaIntegration', 'levelChanges'),
    ),
    tdDefence: mean(sub(rt, 'wrestling', 'takedownDefence'), sub(rt, 'wrestling', 'scrambles')),
    clinch: mean(
      sub(rt, 'wrestling', 'clinch'), sub(rt, 'muayThai', 'clinch'),
      sub(rt, 'mmaIntegration', 'clinchStriking'),
    ),
    bjjTop: mean(
      sub(rt, 'bjj', 'topControl'), sub(rt, 'bjj', 'passing'),
      sub(rt, 'mmaIntegration', 'groundAndPound'),
    ),
    bjjBottom: mean(
      sub(rt, 'bjj', 'guard'), sub(rt, 'bjj', 'sweeps'), sub(rt, 'bjj', 'escapes'),
    ),
    cageWork: mean(sub(rt, 'wrestling', 'cageWrestling'), sub(rt, 'mmaIntegration', 'cageWork')),
    subDefence: rt.grappling.subDefence,
    subAttack: rt.grappling.subAttack,
    getUps: mean(
      sub(rt, 'wrestling', 'getUps'), sub(rt, 'mmaIntegration', 'getUps'),
      sub(rt, 'bjj', 'wrestleUps'),
    ),
  };

  const eff = rt.effective;
  const powerAttr = 0.4 * eff.strength + 0.3 * eff.explosiveness + 0.3 * sub(rt, 'boxing', 'power');
  const tiers: ScoutedTiers = {
    striking: rt.strikingTier,
    wrestling: rt.disciplines.wrestling?.tier ?? 0,
    bjj: rt.disciplines.bjj?.tier ?? 0,
    cardio: bandTier(eff.cardio),
    chin: bandTier(rt.chinEff),
    power: bandTier(powerAttr),
    speed: bandTier(mean(eff.speed, eff.handSpeed, eff.kickSpeed)),
    strength: bandTier(eff.strength),
  };

  const pressureBias = style.pressureBias
    ?? (style.initiative === 'pressure' ? 75 : style.initiative === 'counter' ? 25 : 50);
  const volumeIndex = clamp(
    (style.primaryMode === 'volume' ? 0.7 : 0.4) + 0.3 * (eff.cardio - 50) / 50, 0, 1,
  );
  const powerIndex = clamp((powerAttr - 40) / 55, 0, 1);

  const tendencies: ScoutedTendencies = {
    leadShare: rt.attackShare,
    paceSLpM: clamp(2.5 + 3.0 * volumeIndex + 0.015 * (eff.cardio - 50), 0.5, 9),
    meanComboLength: clamp(1.5 + 0.5 * rt.strikingTier, 1, 4),
    tdAttemptRate: clamp(0.09 * skills.tdOffence, 0, 14),
    tdOffStrikesShare: clamp(0.1 + 0.15 * rt.mmaTier, 0, 0.95),
    counterRate: clamp(sub(rt, 'boxing', 'counters') / 100, 0, 1),
    kickCatchRate: clamp(sub(rt, 'muayThai', 'catches') / 100, 0, 1),
    guillotineRate: clamp(mean(sub(rt, 'bjj', 'chokes'), skills.subAttack) / 100, 0, 1),
    pressureBias,
    volumeIndex,
    powerIndex,
    cageBackShare: clamp(0.6 - 0.09 * (rt.disciplines.boxing?.tier ?? 0), 0, 1),
    hurtClinchShare: style.hurtBehaviour === 'clinch' ? 0.8
      : style.hurtBehaviour === 'coverOnCage' ? 0.15 : 0.45,
    paceDropWhenTired: clamp(0.45 - 0.004 * (eff.cardio - 50) * 2, 0.05, 0.8),
    controlHeavy: clamp((skills.bjjTop + skills.cageWork) / 200, 0, 1),
    finishEarlyShare: 0.53,
  };

  // ST-5 keys on *fights* against a stance, not on the 0-1 familiarity scalar,
  // so the exposure counts are read from the record.
  const exposure = rt.def.record.stanceExposure ?? { orthodox: 0, southpaw: 0 };

  return {
    id: rt.id,
    name: rt.name,
    physical: {
      stance: rt.body.stance,
      reachM: rt.body.reachM,
      heightM: rt.body.heightM,
      massKg: rt.body.fightNightKg,
      ageYears: rt.body.ageYears,
    },
    tiers,
    skills,
    tendencies,
    familiarity: { vsOrthodox: exposure.orthodox, vsSouthpaw: exposure.southpaw },
    record: {
      wins: rt.def.record.proWins,
      losses: rt.def.record.proLosses,
      koLosses: rt.def.record.koLosses,
      layoffDays: rt.career.layoffDays,
      shortNotice: rt.career.shortNotice,
    },
    style: styleFlagsOf(tiers, skills, tendencies, rt.def.style.guardStyle === 'longGuard'),
  };
}

/**
 * Style labels from numbers. Derived from the *scouted* values, so a noisy
 * report can label a wrestler a striker — exactly the failure mode §2.5.9 (1)
 * asks for.
 */
export function styleFlagsOf(
  tiers: ScoutedTiers, skills: ScoutedSkills, tend: ScoutedTendencies, longGuard: boolean,
): ScoutedStyleFlags {
  const grappling = Math.max(tiers.wrestling, tiers.bjj);
  return {
    striker: tiers.striking >= grappling,
    wrestler: tiers.wrestling >= 2 && tiers.wrestling >= tiers.bjj && skills.tdOffence >= 45,
    bjjPlayer: tiers.bjj >= 2 && tiers.bjj >= tiers.wrestling && skills.subAttack >= 45,
    pressure: tend.pressureBias >= 60,
    counter: tend.pressureBias <= 40,
    volume: tend.volumeIndex >= 0.55,
    power: tend.powerIndex >= 0.55,
    usesLongGuard: longGuard,
  };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export interface ScoutOptions {
  /** Overrides the derived iqTier07 (tests and the career layer). */
  iqTier?: IqTier07;
  /** Extra σ multiplier, e.g. a rematch bonus. Defaults to 1. */
  sigmaMult?: number;
}

/**
 * Build this fighter's picture of the opponent.
 *
 * Always consumes `SCOUT_DRAWS` uniforms, in field order, regardless of tier —
 * so a tier change on one fighter never shifts the stream for the other.
 */
export function scoutOpponent(
  self: FighterRuntime, opp: FighterRuntime, rng: RNG, options: ScoutOptions = {},
): ScoutingReport {
  const iqTier = options.iqTier ?? iqTier07Of(self);
  const ageMult = self.body.ageYears > SCOUT_AGE_THRESHOLD_YEARS ? SCOUT_AGE_SIGMA_MULT : 1;
  const sigma = SCOUT_SIGMA_BY_TIER[iqTier]
    * ageMult
    * self.career.scoutingSigmaMult
    * (options.sigmaMult ?? 1);

  const truth = trueProfile(opp);
  const selfProfile = selfView(self, iqTier);

  // Draws are taken in a fixed order whatever the tier; at T0 they are
  // discarded, because a fighter with no camp still occupies his slot in the
  // pre-bout stream.
  const noise: number[] = [];
  const fields = TIER_KEYS.length + SKILL_KEYS.length + TENDENCY_KEYS.length;
  for (let i = 0; i < fields; i++) noise.push(rng.normal(0, 1));

  if (iqTier === 0) {
    return {
      knows: false, sigma: 0, iqTier, opponent: null, self: selfProfile,
      notes: ['No camp, no film: fights whatever is in front of him (07 §2.5.8 T0).'],
    };
  }

  let k = 0;
  const tiers = { ...truth.tiers };
  for (const key of TIER_KEYS) {
    tiers[key] = clamp(Math.round(truth.tiers[key] * (1 + sigma * noise[k++])), 0, 5);
  }
  const skills = { ...truth.skills };
  for (const key of SKILL_KEYS) {
    skills[key] = clamp(truth.skills[key] * (1 + sigma * noise[k++]), 0, 100);
  }
  const tendencies = { ...truth.tendencies };
  for (const key of TENDENCY_KEYS) {
    tendencies[key] = Math.max(0, truth.tendencies[key] * (1 + sigma * noise[k++]));
  }

  const notes: string[] = [];
  notes.push(`Scouting fidelity: sigma ${(sigma * 100).toFixed(0)} % (iqTier ${iqTier}).`);
  if (ageMult !== 1) notes.push('Veteran: reads film better (AG-1).');
  if (self.career.shortNotice) notes.push('Short notice: the picture is worse (01 career).');
  if (iqTier === 1) notes.push('Knows only the size and "he is a wrestler" (07 §2.5.8 T1).');

  return {
    knows: true,
    sigma,
    iqTier,
    opponent: {
      ...truth,
      // Physical traits are exact from T1: they are visible at the weigh-in.
      physical: { ...truth.physical },
      tiers,
      skills,
      tendencies,
      style: styleFlagsOf(tiers, skills, tendencies, truth.style.usesLongGuard),
    },
    self: selfProfile,
    notes,
  };
}

/**
 * A fighter's picture of himself: exact, except that T0–T1 over-rate their own
 * tiers by one when choosing a mode (`ai.scout.self_overrate`, the novice
 * "obsession with offence" `[S: BOXING §6]`).
 */
export function selfView(self: FighterRuntime, iqTier: IqTier07): ScoutedProfile {
  const truth = trueProfile(self);
  if (iqTier > 1) return truth;
  const tiers = { ...truth.tiers };
  for (const key of TIER_KEYS) {
    tiers[key] = Math.min(5, tiers[key] + SELF_OVERRATE_TIERS);
  }
  return { ...truth, tiers };
}

/**
 * Mean absolute relative error of a report against the truth, over every
 * noised field. The §5 check "scouting noise falls with fight IQ" measures
 * this; it is exported so calibration and the Model tab read the same number.
 */
export function reportError(report: ScoutingReport, truth: ScoutedProfile): number {
  if (!report.opponent) return 1;
  const o = report.opponent;
  let sum = 0;
  let n = 0;
  const rel = (a: number, b: number): void => {
    const denom = Math.abs(b) > 1e-9 ? Math.abs(b) : 1;
    sum += Math.abs(a - b) / denom;
    n++;
  };
  for (const key of TIER_KEYS) rel(o.tiers[key], truth.tiers[key]);
  for (const key of SKILL_KEYS) rel(o.skills[key], truth.skills[key]);
  for (const key of TENDENCY_KEYS) rel(o.tendencies[key], truth.tendencies[key]);
  return n === 0 ? 0 : sum / n;
}
