/**
 * FIGHTER VALIDATION — chapter 01's bounds, checked by hand.
 *
 * Two callers with opposite needs share this file. The creator calls it on
 * every keystroke and wants a `path` precise enough to put a red ring around
 * one input; the importer (09 §3.6) calls it on a stranger's JSON and wants to
 * know whether the sim can be trusted to run it. So the rule here is:
 *
 *   error   — `deriveRuntime` would produce nonsense, or the field is simply
 *             not one of the values the type admits. The definition is refused.
 *   warning — legal, derivable, and merely unusual. A 2.1 m fighter and a
 *             48-year-old are both allowed; the chapter's ranges are population
 *             priors for the *generator*, never a gate on what a user may type.
 *
 * Hand-written on purpose: 09 §3.6 says "`zod` or hand-written, no network",
 * and a schema library would have to restate every bound anyway while adding a
 * dependency the single-file build would have to inline.
 *
 * The sub-skill names, discipline ids, weight limits and tier bands are read
 * from the sim's public API rather than copied, so a change to chapter 01
 * surfaces here as a type error instead of as a validator that silently passes
 * a key the derivation ignores. The *enum* lists below are the one exception:
 * the sim exports those as types only, so they are restated with a `satisfies`
 * clause that makes a typo a compile error. They are exported because the
 * creator's dropdowns need exactly the same lists.
 */

import {
  SUB_SKILLS, WEIGHT_CLASS_LIMIT_KG, TIER_SKILL_BANDS, TIER_YEARS_BANDS,
  hasTechnique, SUBMISSIONS,
  type BodySpec, type BottomPriority, type Build, type CompetitionLevel,
  type CoreDisciplineId, type FighterDefinition, type GuardStyle, type Handedness,
  type HurtBehaviour, type Initiative, type LastResult, type LosingBehaviour,
  type MentalAttributes, type PhysicalAttributes, type PrimaryMode, type RangeBand,
  type Sex, type Stance, type StyleSpec, type TakedownSetup, type ThaiStyle,
  type TiredBehaviour, type TopPriority,
} from '../../sim';
import type { ValidationIssue, ValidationResult } from './types';

// --------------------------------------------------------------------------
// Vocabularies the creator's dropdowns and this validator share
// --------------------------------------------------------------------------

export const STANCES = ['orthodox', 'southpaw', 'switch'] as const satisfies readonly Stance[];
export const HANDEDNESSES = ['right', 'left'] as const satisfies readonly Handedness[];
export const SEXES = ['male', 'female'] as const satisfies readonly Sex[];
export const BUILDS = ['ectomorph', 'mesomorph', 'endomorph'] as const satisfies readonly Build[];

export const PRIMARY_MODES = [
  'pressure', 'counter', 'pointFighter', 'volume', 'power',
  'grinder', 'scrambler', 'guardPlayer', 'allRounder',
  'distanceStriking', 'pressureStriking', 'wrestleControl', 'clinchGrind', 'submissionHunt',
] as const satisfies readonly PrimaryMode[];

export const RANGE_BANDS = [
  'long', 'mid', 'short', 'close', 'clinch', 'ground',
] as const satisfies readonly RangeBand[];

export const INITIATIVES = [
  'pressure', 'counter', 'point', 'balanced',
] as const satisfies readonly Initiative[];

export const HURT_BEHAVIOURS = [
  'coverOnCage', 'clinch', 'shoot', 'circleOut', 'trade', 'counter', 'turnAway',
] as const satisfies readonly HurtBehaviour[];

export const LOSING_BEHAVIOURS = [
  'finishSeek', 'stealRound', 'unchanged', 'shell', 'gamble',
] as const satisfies readonly LosingBehaviour[];

export const TIRED_BEHAVIOURS = [
  'clinchRest', 'coast', 'gamble', 'retreat',
] as const satisfies readonly TiredBehaviour[];

export const GUARD_STYLES = [
  'highGuard', 'philly', 'longGuard', 'peekaboo', 'thai', 'hybrid',
] as const satisfies readonly GuardStyle[];

export const THAI_STYLES = [
  'muayFemur', 'muayKhao', 'muayMat', 'muayTae', 'dutch',
] as const satisfies readonly ThaiStyle[];

export const TAKEDOWN_SETUPS = [
  'naked', 'offSingleStrike', 'offCombination', 'offFeint', 'reactive', 'offClinch',
] as const satisfies readonly TakedownSetup[];

export const BOTTOM_PRIORITIES = ['standUp', 'sweep', 'submit'] as const satisfies readonly BottomPriority[];
export const TOP_PRIORITIES = ['control', 'strike', 'pass', 'submit'] as const satisfies readonly TopPriority[];
export const WHEN_LOSING = ['press', 'stall', 'gamble', 'hold'] as const satisfies readonly StyleSpec['whenLosing'][];
export const LAST_RESULTS = ['win', 'loss', 'draw', 'none'] as const satisfies readonly LastResult[];
export const COMPETITION_LEVELS = [
  'none', 'local', 'national', 'international',
] as const satisfies readonly CompetitionLevel[];

/** The fourteen of 01 §2.2, in the chapter's order. */
export const PHYSICAL_KEYS = [
  'strength', 'explosiveness', 'speed', 'handSpeed', 'kickSpeed', 'cardio', 'chin',
  'bodyToughness', 'recovery', 'flexibility', 'balance', 'reactionTime', 'gripStrength',
  'neckStrength',
] as const satisfies readonly (keyof PhysicalAttributes)[];

/** The six of 01 §2.5. */
export const MENTAL_KEYS = [
  'fightIQ', 'aggression', 'composure', 'heart', 'discipline', 'adaptability',
] as const satisfies readonly (keyof MentalAttributes)[];

export const WEIGHT_CLASS_IDS = Object.keys(WEIGHT_CLASS_LIMIT_KG) as NonNullable<BodySpec['weightClass']>[];

/**
 * `mma` is the schema's accepted alias of `mmaIntegration` (01 §2.3); the
 * derivation folds them together, so validation has to as well or every
 * skeleton-era definition reports ten unknown sub-skills.
 */
const DISCIPLINE_KEYS: Readonly<Record<string, CoreDisciplineId>> = {
  ...Object.fromEntries(Object.keys(SUB_SKILLS).map((d) => [d, d as CoreDisciplineId])),
  mma: 'mmaIntegration',
};

// --------------------------------------------------------------------------
// Plausible-but-not-mandatory ranges (01 §2.1 population priors)
// --------------------------------------------------------------------------

/** `[error low, warn low, warn high, error high]` for each body measurement. */
const BODY_RANGES = {
  // The warn bands are the extremes of the real sport (Struve at 2.13 m is
  // the tallest fighter the UFC has licensed), not a limit on what may be typed.
  heightM: [0, 1.45, 2.05, 3],
  reachM: [0, 1.45, 2.20, 3.5],
  legReachM: [0, 0.75, 1.25, 2],
  massKg: [0, 40, 180, 500],
  ageYears: [0, 16, 50, 120],
  // 4-40 % is the chapter's creator range; outside it is still derivable.
  bodyFatPct: [0, 4, 40, 75],
} as const;

// --------------------------------------------------------------------------
// Issue plumbing
// --------------------------------------------------------------------------

class Issues {
  readonly list: ValidationIssue[] = [];

  error(path: string, message: string): void {
    this.list.push({ path, message, severity: 'error' });
  }

  warn(path: string, message: string): void {
    this.list.push({ path, message, severity: 'warning' });
  }

  /** True when `v` is a usable number; reports and returns false when it is not. */
  finite(path: string, v: unknown, label: string): v is number {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.error(path, `${label} must be a finite number`);
      return false;
    }
    return true;
  }

  /** 0-100, the convention every attribute and sub-skill obeys (00 §3). */
  score(path: string, v: unknown, label: string): void {
    if (!this.finite(path, v, label)) return;
    if (v < 0 || v > 100) this.error(path, `${label} must be 0-100 (got ${v})`);
  }

  ranged(path: string, v: unknown, label: string, r: readonly [number, number, number, number]): void {
    if (!this.finite(path, v, label)) return;
    const [errLo, warnLo, warnHi, errHi] = r;
    if (v <= errLo || v > errHi) {
      this.error(path, `${label} of ${v} is outside the possible range ${errLo}-${errHi}`);
    } else if (v < warnLo || v > warnHi) {
      this.warn(path, `${label} of ${v} is unusual (typical ${warnLo}-${warnHi})`);
    }
  }

  enumOf<T extends string>(path: string, v: unknown, label: string, allowed: readonly T[]): void {
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
      this.error(path, `${label} must be one of ${allowed.join(', ')} (got ${JSON.stringify(v)})`);
    }
  }

  /** A counter that cannot be negative and is meaningless as a fraction. */
  counter(path: string, v: unknown, label: string): void {
    if (v === undefined) return;
    if (!this.finite(path, v, label)) return;
    if (v < 0) this.error(path, `${label} cannot be negative (got ${v})`);
    else if (!Number.isInteger(v)) this.warn(path, `${label} should be a whole number (got ${v})`);
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Same arithmetic as `tierBySkill`/`tierByYears`, over the sim's own bands. */
const tierFromBands = (v: number, bands: readonly number[], max: number): number => {
  for (let i = 0; i < bands.length; i++) if (v < bands[i]) return i;
  return max;
};

// --------------------------------------------------------------------------
// The validator
// --------------------------------------------------------------------------

/**
 * Check a definition against chapter 01. Takes `unknown` because the import
 * path hands it whatever was in the file; a `FighterDefinition` from the
 * creator type-checks and simply passes through.
 */
export function validateFighter(def: unknown): ValidationResult {
  const iss = new Issues();

  if (!isObject(def)) {
    iss.error('', 'a fighter must be a JSON object');
    return { ok: false, issues: iss.list };
  }

  validateIdentity(def, iss);
  validateBody(def.body, iss);
  validateAppearance(def.appearance, iss);
  validateBlock(def.physical, 'physical', PHYSICAL_KEYS, iss);
  validateBlock(def.mental, 'mental', MENTAL_KEYS, iss);
  validateDisciplines(def.disciplines, def.mental, iss);
  validateRecord(def.record, def.body, iss);
  validateStyle(def.style, iss);

  if (def.notes !== undefined && typeof def.notes !== 'string') {
    iss.error('notes', 'notes must be a string');
  }

  return { ok: !iss.list.some((i) => i.severity === 'error'), issues: iss.list };
}

function validateIdentity(def: Record<string, unknown>, iss: Issues): void {
  // A missing `schema` is an older hand-written file, which is fine; a schema
  // this build has no migration for is not (09 §3.6).
  if (def.schema !== undefined && def.schema !== 1) {
    iss.error('schema', `unsupported definition schema ${JSON.stringify(def.schema)} (this build reads 1)`);
  }
  for (const key of ['id', 'name', 'short'] as const) {
    const v = def[key];
    if (typeof v !== 'string' || v.trim() === '') iss.error(key, `${key} must be a non-empty string`);
  }
  if (typeof def.short === 'string' && def.short.length > 6) {
    iss.warn('short', 'the HUD truncates a short name past 6 characters');
  }
}

function validateBody(body: unknown, iss: Issues): void {
  if (!isObject(body)) {
    iss.error('body', 'body is required');
    return;
  }

  for (const [key, range] of Object.entries(BODY_RANGES)) {
    iss.ranged(`body.${key}`, body[key], key, range);
  }

  const h = body.heightM;
  const r = body.reachM;
  const l = body.legReachM;
  if (typeof h === 'number' && h > 0) {
    // Ape index: UFC pooled A:S ~ N(1.026, 0.028), so ±5 σ is about 0.89-1.17.
    if (typeof r === 'number' && r > 0) {
      const ape = r / h;
      if (ape < 0.89 || ape > 1.17) {
        iss.warn('body.reachM', `reach is ${ape.toFixed(2)}x height; real spans run 0.89-1.17x`);
      }
    }
    if (typeof l === 'number' && l > 0) {
      const ratio = l / h;
      if (ratio < 0.50 || ratio > 0.65) {
        iss.warn('body.legReachM', `leg reach is ${ratio.toFixed(2)}x height; real values cluster at 0.57-0.58x`);
      }
    }
  }

  // The mass triple: `massKg` is required, the other two default to it.
  const weighIn = body.weighInKg;
  const fightNight = body.fightNightKg;
  if (weighIn !== undefined) iss.ranged('body.weighInKg', weighIn, 'weigh-in mass', BODY_RANGES.massKg);
  if (fightNight !== undefined) iss.ranged('body.fightNightKg', fightNight, 'fight-night mass', BODY_RANGES.massKg);
  if (typeof weighIn === 'number' && typeof fightNight === 'number' && weighIn > 0) {
    const regain = (fightNight / weighIn - 1) * 100;
    if (regain < 0) {
      iss.warn('body.fightNightKg', 'fight-night mass is below the weigh-in mass; no fighter loses weight after the scale');
    } else if (regain > 20) {
      iss.warn('body.fightNightKg', `${regain.toFixed(1)} % regain is far above the 3-10 % medians of LIT_B §2.8`);
    }
  }

  validateBuild(body.build, iss);
  iss.enumOf('body.stance', body.stance, 'stance', STANCES);
  iss.enumOf('body.handedness', body.handedness, 'handedness', HANDEDNESSES);
  if (body.sex !== undefined) iss.enumOf('body.sex', body.sex, 'sex', SEXES);
  if (body.dominantLeg !== undefined) {
    iss.enumOf('body.dominantLeg', body.dominantLeg, 'dominant leg', HANDEDNESSES);
  }

  if (body.weightClass !== undefined) {
    iss.enumOf('body.weightClass', body.weightClass, 'weight class', WEIGHT_CLASS_IDS);
    const limit = WEIGHT_CLASS_LIMIT_KG[body.weightClass as NonNullable<BodySpec['weightClass']>];
    const scale = typeof weighIn === 'number' ? weighIn : body.massKg;
    if (limit !== undefined && typeof scale === 'number' && scale > limit) {
      iss.warn('body.weightClass', `${scale} kg misses the ${limit} kg limit of ${String(body.weightClass)}`);
    }
  }
}

function validateBuild(build: unknown, iss: Issues): void {
  if (typeof build === 'string') {
    iss.enumOf('body.build', build, 'build', BUILDS);
    return;
  }
  if (!isObject(build)) {
    iss.error('body.build', 'build must be a somatotype name or an {ecto, meso, endo} blend');
    return;
  }
  let sum = 0;
  for (const k of ['ecto', 'meso', 'endo'] as const) {
    const v = build[k];
    if (!iss.finite(`body.build.${k}`, v, k)) return;
    if (v < 0 || v > 1) iss.error(`body.build.${k}`, `${k} must be 0-1 (got ${v})`);
    sum += v;
  }
  if (Math.abs(sum - 1) > 0.01) {
    iss.warn('body.build', `somatotype blend sums to ${sum.toFixed(2)}; 01 §2.1 expects 1`);
  }
}

/** Appearance never enters a formula (01 §2.1.1), so nothing here is an error unless it breaks JSON. */
function validateAppearance(app: unknown, iss: Issues): void {
  if (app === undefined) {
    iss.warn('appearance', 'no appearance block; the viewer will use defaults');
    return;
  }
  if (!isObject(app)) {
    iss.error('appearance', 'appearance must be an object');
    return;
  }
  if (app.skinTone !== undefined) {
    if (typeof app.skinTone !== 'number' || !Number.isFinite(app.skinTone)) {
      iss.error('appearance.skinTone', 'skin tone must be a number');
    } else if (app.skinTone < 0 || app.skinTone > 1) {
      iss.warn('appearance.skinTone', 'skin tone is a 0-1 ramp position');
    }
  }
  if (app.tattoos !== undefined && !Array.isArray(app.tattoos)) {
    iss.error('appearance.tattoos', 'tattoos must be an array');
  }
}

/** The physical and mental blocks differ only in their key list. */
function validateBlock(
  block: unknown, path: string, keys: readonly string[], iss: Issues,
): void {
  if (!isObject(block)) {
    iss.error(path, `${path} is required`);
    return;
  }
  for (const k of keys) {
    if (!(k in block)) {
      iss.error(`${path}.${k}`, `${k} is missing`);
      continue;
    }
    iss.score(`${path}.${k}`, block[k], k);
  }
}

function validateDisciplines(disciplines: unknown, mental: unknown, iss: Issues): void {
  if (!isObject(disciplines)) {
    iss.error('disciplines', 'disciplines is required (an empty object means "untrained")');
    return;
  }

  const fightIQ = isObject(mental) && typeof mental.fightIQ === 'number' ? mental.fightIQ : 0;
  const composure = isObject(mental) && typeof mental.composure === 'number' ? mental.composure : 0;

  for (const [key, raw] of Object.entries(disciplines)) {
    const path = `disciplines.${key}`;
    const canonical = DISCIPLINE_KEYS[key];
    if (canonical === undefined) {
      iss.error(path, `unknown discipline "${key}"; 01 §2.3 models ${Object.keys(SUB_SKILLS).join(', ')}`);
      continue;
    }
    if (!isObject(raw)) {
      iss.error(path, 'a discipline must be an object with `years` and `sub`');
      continue;
    }

    let years = 0;
    if (!iss.finite(`${path}.years`, raw.years, 'years trained')) {
      // fall through: the sub-skills are still worth checking
    } else if (raw.years < 0) {
      iss.error(`${path}.years`, `years trained cannot be negative (got ${raw.years})`);
    } else {
      years = raw.years;
      if (years > 50) iss.warn(`${path}.years`, `${years} years of training is longer than most careers`);
    }

    if (raw.trainingQuality !== undefined
      && iss.finite(`${path}.trainingQuality`, raw.trainingQuality, 'training quality')) {
      const q = raw.trainingQuality as number;
      if (q <= 0) iss.error(`${path}.trainingQuality`, 'training quality must be positive');
      else if (q < 0.6 || q > 1.15) {
        iss.warn(`${path}.trainingQuality`, `01 §2.3.2 spans 0.6 (hobbyist) to 1.15 (elite camp); got ${q}`);
      }
    }

    const mean = validateSubSkills(raw.sub, canonical, path, iss);
    if (mean !== null) validateTierConsistency(mean, years, fightIQ, composure, path, iss);
    validateCompetition(raw.competition, path, iss);

    if (raw.styleTags !== undefined && !Array.isArray(raw.styleTags)) {
      iss.error(`${path}.styleTags`, 'styleTags must be an array of strings');
    }
  }
}

/** Returns the mean of the stored sub-skills, or null when they are unusable. */
function validateSubSkills(
  sub: unknown, discipline: CoreDisciplineId, path: string, iss: Issues,
): number | null {
  if (!isObject(sub)) {
    iss.error(`${path}.sub`, 'sub is required: the named sub-skills of 01 §2.3.1');
    return null;
  }
  const expected = SUB_SKILLS[discipline];
  let sum = 0;
  let count = 0;

  for (const [k, v] of Object.entries(sub)) {
    if (!expected.includes(k)) {
      iss.error(`${path}.sub.${k}`, `"${k}" is not a ${discipline} sub-skill; expected ${expected.join(', ')}`);
      continue;
    }
    iss.score(`${path}.sub.${k}`, v, k);
    if (typeof v === 'number' && Number.isFinite(v)) {
      sum += v;
      count++;
    }
  }
  // Missing keys derive as absent rather than as zero, which is survivable but
  // almost always an authoring slip.
  const missing = expected.filter((k) => !(k in sub));
  if (missing.length > 0) {
    iss.warn(`${path}.sub`, `missing ${discipline} sub-skills: ${missing.join(', ')}`);
  }
  return count > 0 ? sum / count : null;
}

/**
 * 01 §2.3.4 caps the derived tier at `tierByYears + 1`. Skills above that cap
 * are not illegal — they are silently thrown away by the derivation, which is
 * exactly the surprise worth warning about while the user can still fix it.
 */
function validateTierConsistency(
  mean: number, years: number, fightIQ: number, composure: number, path: string, iss: Issues,
): void {
  const bySkill = tierFromBands(mean, TIER_SKILL_BANDS, 5);
  const byYears = tierFromBands(years, TIER_YEARS_BANDS, 4);
  const cap = Math.min(5, byYears + 1);
  if (bySkill > cap) {
    iss.warn(
      `${path}.years`,
      `sub-skills average ${mean.toFixed(0)} (T${bySkill}) but ${years} years caps the derived tier at T${cap}`,
    );
  }
  if (bySkill === 5 && cap === 5 && (fightIQ < 80 || composure < 75)) {
    iss.warn(
      `${path}.sub`,
      'T5 also needs fightIQ >= 80 and composure >= 75 (01 §2.3.4 gate); this derives as T4',
    );
  }
}

function validateCompetition(comp: unknown, path: string, iss: Issues): void {
  if (comp === undefined) return;
  if (!isObject(comp)) {
    iss.error(`${path}.competition`, 'competition must be an object');
    return;
  }
  iss.counter(`${path}.competition.bouts`, comp.bouts, 'bouts');
  iss.counter(`${path}.competition.wins`, comp.wins, 'wins');
  iss.enumOf(`${path}.competition.level`, comp.level, 'level', COMPETITION_LEVELS);
  if (typeof comp.bouts === 'number' && typeof comp.wins === 'number' && comp.wins > comp.bouts) {
    iss.warn(`${path}.competition.wins`, `${comp.wins} wins from ${comp.bouts} bouts`);
  }
}

const CAREER_COUNTERS = [
  'proWins', 'proLosses', 'proDraws', 'amWins', 'amLosses', 'koLosses',
  'knockdownsSuffered', 'titleFights',
] as const;

function validateRecord(record: unknown, body: unknown, iss: Issues): void {
  if (!isObject(record)) {
    iss.error('record', 'record is required');
    return;
  }
  for (const k of CAREER_COUNTERS) {
    if (!(k in record)) {
      iss.error(`record.${k}`, `${k} is missing`);
      continue;
    }
    iss.counter(`record.${k}`, record[k], k);
  }

  if ('layoffMonths' in record && iss.finite('record.layoffMonths', record.layoffMonths, 'layoff')) {
    if ((record.layoffMonths as number) < 0) {
      iss.error('record.layoffMonths', 'a layoff cannot be negative');
    }
  }
  iss.score('record.bigFightComposure', record.bigFightComposure, 'bigFightComposure');
  if (record.daysSinceLastBout !== undefined) {
    iss.counter('record.daysSinceLastBout', record.daysSinceLastBout, 'daysSinceLastBout');
  }
  if (record.shortNoticeDays !== undefined) {
    iss.counter('record.shortNoticeDays', record.shortNoticeDays, 'shortNoticeDays');
  }
  if (record.winStreak !== undefined) iss.counter('record.winStreak', record.winStreak, 'winStreak');
  if (record.lastResult !== undefined) {
    iss.enumOf('record.lastResult', record.lastResult, 'lastResult', LAST_RESULTS);
  }

  validateFightRecord(record.pro, 'record.pro', iss);
  validateFightRecord(record.amateur, 'record.amateur', iss);

  // A KO-loss counter above the loss counter would make the §2.4.3 chin decay
  // read more KOs than there were fights.
  const losses = typeof record.proLosses === 'number' ? record.proLosses : 0;
  if (typeof record.koLosses === 'number' && record.koLosses > losses) {
    iss.warn('record.koLosses', `${record.koLosses} KO losses against ${losses} losses`);
  }

  validateWeightCut(record.weightCut, iss);

  if (record.stanceExposure !== undefined) {
    if (!isObject(record.stanceExposure)) {
      iss.error('record.stanceExposure', 'stanceExposure must be { orthodox, southpaw }');
    } else {
      iss.counter('record.stanceExposure.orthodox', record.stanceExposure.orthodox, 'orthodox exposure');
      iss.counter('record.stanceExposure.southpaw', record.stanceExposure.southpaw, 'southpaw exposure');
    }
  }

  // A professional record on a 16-year-old is a data-entry error somewhere.
  const age = isObject(body) && typeof body.ageYears === 'number' ? body.ageYears : undefined;
  const proBouts = (typeof record.proWins === 'number' ? record.proWins : 0)
    + (typeof record.proLosses === 'number' ? record.proLosses : 0);
  if (age !== undefined && age < 18 && proBouts > 0) {
    iss.warn('record.proWins', `${proBouts} professional bouts at age ${age}`);
  }
}

function validateFightRecord(rec: unknown, path: string, iss: Issues): void {
  if (rec === undefined) return;
  if (!isObject(rec)) {
    iss.error(path, 'a fight record must be an object');
    return;
  }
  for (const k of ['wins', 'losses', 'draws', 'noContests', 'koWins', 'subWins', 'decWins',
    'koLosses', 'subLosses', 'decLosses'] as const) {
    if (k in rec) iss.counter(`${path}.${k}`, rec[k], k);
  }
  const byMethod = (a: unknown, b: unknown, c: unknown): number | null => {
    if (typeof a !== 'number' || typeof b !== 'number' || typeof c !== 'number') return null;
    return a + b + c;
  };
  const wins = byMethod(rec.koWins, rec.subWins, rec.decWins);
  if (wins !== null && typeof rec.wins === 'number' && wins !== rec.wins) {
    iss.warn(`${path}.wins`, `${rec.wins} wins but ${wins} accounted for by method`);
  }
  const losses = byMethod(rec.koLosses, rec.subLosses, rec.decLosses);
  if (losses !== null && typeof rec.losses === 'number' && losses !== rec.losses) {
    iss.warn(`${path}.losses`, `${rec.losses} losses but ${losses} accounted for by method`);
  }
}

function validateWeightCut(cut: unknown, iss: Issues): void {
  if (cut === undefined) return;
  if (!isObject(cut)) {
    iss.error('record.weightCut', 'weightCut must be { cutPct, regainPct, residualDehydration }');
    return;
  }
  for (const k of ['cutPct', 'regainPct'] as const) {
    if (!iss.finite(`record.weightCut.${k}`, cut[k], k)) continue;
    const v = cut[k] as number;
    if (v < 0) iss.error(`record.weightCut.${k}`, `${k} cannot be negative`);
    else if (v > 25) iss.warn(`record.weightCut.${k}`, `${v} % is beyond anything in the CSAC data`);
  }
  if (iss.finite('record.weightCut.residualDehydration', cut.residualDehydration, 'residual dehydration')) {
    const d = cut.residualDehydration as number;
    // 05 reads this directly as a fraction; > 1 means somebody typed a percent.
    if (d < 0 || d > 1) {
      iss.error('record.weightCut.residualDehydration', `residual dehydration is a 0-1 fraction (got ${d})`);
    } else if (d > 0.05) {
      iss.warn('record.weightCut.residualDehydration', '01 §2.4.4 bounds residual dehydration at 0.05');
    }
  }
}

const SUBMISSION_IDS = new Set(SUBMISSIONS.map((s) => s.id));

function validateStyle(style: unknown, iss: Issues): void {
  if (!isObject(style)) {
    iss.error('style', 'style is required');
    return;
  }

  iss.enumOf('style.primaryMode', style.primaryMode, 'primaryMode', PRIMARY_MODES);
  iss.enumOf('style.preferredRange', style.preferredRange, 'preferredRange', RANGE_BANDS);
  iss.enumOf('style.whenLosing', style.whenLosing, 'whenLosing', WHEN_LOSING);

  const optionalEnums = [
    ['initiative', INITIATIVES], ['fallbackMode', PRIMARY_MODES], ['hurtBehaviour', HURT_BEHAVIOURS],
    ['losingBehaviour', LOSING_BEHAVIOURS], ['tiredBehaviour', TIRED_BEHAVIOURS],
    ['guardStyle', GUARD_STYLES], ['thaiStyle', THAI_STYLES],
  ] as const;
  for (const [key, allowed] of optionalEnums) {
    if (style[key] !== undefined) iss.enumOf(`style.${key}`, style[key], key, allowed as readonly string[]);
  }
  for (const [key, allowed] of [['bottomPriority', BOTTOM_PRIORITIES], ['topPriority', TOP_PRIORITIES]] as const) {
    const v = style[key];
    if (v === undefined) continue;
    if (!Array.isArray(v)) {
      iss.error(`style.${key}`, `${key} must be an ordered array`);
      continue;
    }
    v.forEach((entry, i) => iss.enumOf(`style.${key}[${i}]`, entry, key, allowed as readonly string[]));
  }

  for (const [key, hi] of [['pressureBias', 100], ['stanceSwitching', 100]] as const) {
    if (style[key] === undefined) continue;
    if (!iss.finite(`style.${key}`, style[key], key)) continue;
    const v = style[key] as number;
    if (v < 0 || v > hi) iss.error(`style.${key}`, `${key} must be 0-${hi} (got ${v})`);
  }

  validateTechniqueList(style.favouriteTechniques, 'style.favouriteTechniques', 'techId', iss);
  validateSubmissionList(style.goToSubmissions, iss);
  validateCombos(style.favouriteCombos, iss);
  validateTakedowns(style.takedownPreferences, iss);

  if (style.pacing !== undefined) {
    if (!Array.isArray(style.pacing)) {
      iss.error('style.pacing', 'pacing must be an array of per-round entries');
    } else {
      style.pacing.forEach((p: unknown, i: number) => {
        if (!isObject(p)) {
          iss.error(`style.pacing[${i}]`, 'a pacing entry must be an object');
          return;
        }
        iss.counter(`style.pacing[${i}].round`, p.round, 'round');
        iss.finite(`style.pacing[${i}].outputMult`, p.outputMult, 'outputMult');
        iss.finite(`style.pacing[${i}].riskAppetite`, p.riskAppetite, 'riskAppetite');
      });
    }
  }
}

/**
 * Technique ids are warned about, never refused. Chapter 02's catalogue is the
 * only one the sim exports; the grappling entries of 03 and the feints of
 * §2.3.4 are equally real ids that `hasTechnique` does not know, and the
 * built-in archetypes reference plenty of them.
 */
function validateTechniqueList(list: unknown, path: string, idKey: string, iss: Issues): void {
  if (list === undefined) return;
  if (!Array.isArray(list)) {
    iss.error(path, `${path} must be an array`);
    return;
  }
  list.forEach((entry, i) => {
    const at = `${path}[${i}]`;
    let id: unknown = entry;
    if (isObject(entry)) {
      id = entry[idKey];
      if (entry.weight !== undefined && iss.finite(`${at}.weight`, entry.weight, 'weight')) {
        if ((entry.weight as number) < 0) iss.error(`${at}.weight`, 'a weight cannot be negative');
      }
    }
    checkTechniqueId(id, isObject(entry) ? `${at}.${idKey}` : at, iss);
  });
}

function checkTechniqueId(id: unknown, path: string, iss: Issues): void {
  if (typeof id !== 'string' || id === '') {
    iss.error(path, 'a technique reference must be a non-empty id string');
    return;
  }
  if (!/^(tech|feint|def)\./.test(id)) {
    iss.error(path, `"${id}" is not a technique id (expected tech.*, feint.* or def.*)`);
    return;
  }
  if (id.startsWith('tech.') && !hasTechnique(id)) {
    iss.warn(path, `"${id}" is not in chapter 02's striking catalogue; it must be a chapter 03 action`);
  }
}

function validateSubmissionList(list: unknown, iss: Issues): void {
  if (list === undefined) return;
  if (!Array.isArray(list)) {
    iss.error('style.goToSubmissions', 'goToSubmissions must be an array');
    return;
  }
  list.forEach((entry, i) => {
    const at = `style.goToSubmissions[${i}]`;
    const id = isObject(entry) ? entry.subId : entry;
    const path = isObject(entry) ? `${at}.subId` : at;
    if (isObject(entry) && entry.weight !== undefined) {
      if (iss.finite(`${at}.weight`, entry.weight, 'weight') && (entry.weight as number) < 0) {
        iss.error(`${at}.weight`, 'a weight cannot be negative');
      }
    }
    if (typeof id !== 'string' || id === '') {
      iss.error(path, 'a submission reference must be a non-empty id string');
    } else if (!id.startsWith('sub.')) {
      iss.error(path, `"${id}" is not a submission id (expected sub.*)`);
    } else if (!SUBMISSION_IDS.has(id)) {
      iss.warn(path, `"${id}" is not in chapter 04's submission catalogue`);
    }
  });
}

function validateCombos(list: unknown, iss: Issues): void {
  if (list === undefined) return;
  if (!Array.isArray(list)) {
    iss.error('style.favouriteCombos', 'favouriteCombos must be an array');
    return;
  }
  list.forEach((entry, i) => {
    const at = `style.favouriteCombos[${i}]`;
    const sequence = Array.isArray(entry) ? entry : isObject(entry) ? entry.sequence : undefined;
    if (!Array.isArray(sequence)) {
      iss.error(at, 'a combo is an array of technique ids, or { id, sequence, weight }');
      return;
    }
    if (sequence.length === 0) iss.warn(at, 'an empty combo is never selected');
    const base = Array.isArray(entry) ? at : `${at}.sequence`;
    sequence.forEach((id: unknown, j: number) => checkTechniqueId(id, `${base}[${j}]`, iss));
  });
}

function validateTakedowns(td: unknown, iss: Issues): void {
  if (td === undefined) return;
  if (Array.isArray(td)) {
    td.forEach((id, i) => checkTechniqueId(id, `style.takedownPreferences[${i}]`, iss));
    return;
  }
  if (!isObject(td)) {
    iss.error('style.takedownPreferences', 'takedownPreferences must be an array of ids or a TakedownStyle');
    return;
  }
  validateTechniqueList(td.prefs, 'style.takedownPreferences.prefs', 'techId', iss);
  iss.enumOf('style.takedownPreferences.setup', td.setup, 'setup', TAKEDOWN_SETUPS);
  if (iss.finite('style.takedownPreferences.cageBias', td.cageBias, 'cageBias')) {
    const v = td.cageBias as number;
    if (v < 0 || v > 1) iss.error('style.takedownPreferences.cageBias', `cageBias must be 0-1 (got ${v})`);
  }
}

// --------------------------------------------------------------------------
// Convenience for the creator's field-level display
// --------------------------------------------------------------------------

/** The issues touching one field, for the ring around an input. */
export function issuesAt(result: ValidationResult, path: string): ValidationIssue[] {
  return result.issues.filter((i) => i.path === path);
}

/** The issues under a subtree, for the badge on a creator tab. */
export function issuesUnder(result: ValidationResult, prefix: string): ValidationIssue[] {
  return result.issues.filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`) || i.path.startsWith(`${prefix}[`));
}

export function errorCount(result: ValidationResult): number {
  return result.issues.filter((i) => i.severity === 'error').length;
}

export function warningCount(result: ValidationResult): number {
  return result.issues.filter((i) => i.severity === 'warning').length;
}
