/**
 * EDITOR MODEL — the presenter layer between a `FighterDefinition` and the form.
 *
 * Everything here is a pure function of the definition. That is deliberate:
 * the creator's real logic (which fields exist, what a tier band is, whether
 * there are unsaved changes, how a validation path maps to a control) is
 * testable without mounting a component, and the components stay thin enough
 * to read in one pass.
 */

import {
  SUB_SKILLS, TIER_NAMES, TIER_SKILL_BANDS, DISCIPLINE_IDS, buildBlendOf,
  type ComboSpec, type CoreDisciplineId, type FighterDefinition, type SkillTier,
  type WeightedSubmission, type WeightedTechnique,
} from '../../sim';
import { DISCIPLINE_LABELS, humaniseKey, subSkillHelp } from './fieldMeta';

// --------------------------------------------------------------------------
// Tier bands — the vocabulary every 0-100 control is annotated with
// --------------------------------------------------------------------------

export interface TierBand {
  tier: SkillTier;
  name: string;
  /** Inclusive lower edge, exclusive upper edge, on the 0-100 scale. */
  lo: number;
  hi: number;
}

/** The five band edges as spans, so a slider can draw them as a track. */
export const TIER_BANDS: readonly TierBand[] = Object.freeze(
  [0, 1, 2, 3, 4, 5].map((t) => {
    const lo = t === 0 ? 0 : TIER_SKILL_BANDS[t - 1];
    const hi = t === 5 ? 100 : TIER_SKILL_BANDS[t];
    return { tier: t as SkillTier, name: TIER_NAMES[t as SkillTier], lo, hi };
  }),
);

/**
 * The band a single 0-100 value sits in.
 *
 * This is the *skill* band only. A discipline's real tier also depends on
 * training years and, at T5, on fight IQ and composure — which is exactly why
 * the slider says "band" and the derived panel says "tier". Conflating them
 * would promise the user a T5 the gate is going to refuse.
 */
export function bandOf(value: number): TierBand {
  const v = Number.isFinite(value) ? value : 0;
  for (const band of TIER_BANDS) {
    if (v < band.hi) return band;
  }
  return TIER_BANDS[5];
}

// --------------------------------------------------------------------------
// Discipline sections
// --------------------------------------------------------------------------

export interface SubSkillField {
  skill: string;
  label: string;
  path: string;
  value: number;
  help: string;
}

/**
 * One discipline's detail block (01 §8.1). Every field carries its own dotted
 * path so the detail panel can be written as a table rather than as thirty
 * hand-wired controls, and so a validation issue on any of them lands on the
 * right input through the same `focusPath` route as everything else.
 */
export interface DisciplineDetail {
  startAge: number;
  startAgePath: string;
  hoursPerWeek: number;
  hoursPath: string;
  sessionsPerWeek: number;
  sessionsPath: string;
  sparringIntensity: number;
  sparringPath: string;
  monthsSinceTrained: number;
  rustPath: string;
  coachQuality: number;
  coachPath: string;
  isBase: boolean;
  isBasePath: string;
  gradeSystem: string;
  gradeSystemPath: string;
  gradeRank: string;
  gradeRankPath: string;
  stripes: number;
  stripesPath: string;
  specialisations: string[];
  specialisationsPath: string;
  competition: {
    level: string;
    bouts: number;
    wins: number;
    losses: number;
    draws: number;
    amateurBouts: number;
    amateurWins: number;
    proBouts: number;
    proWins: number;
    bestPlacing: string;
    medals: number;
  };
  competitionPath: string;
}

export interface DisciplineSection {
  id: CoreDisciplineId;
  label: string;
  /** False when the definition carries no block for this discipline. */
  trained: boolean;
  yearsPath: string;
  years: number;
  qualityPath: string;
  trainingQuality: number;
  subSkills: SubSkillField[];
  /** 01 §8.1 depth: grade, record, volume, rust, specialisations. */
  detail: DisciplineDetail;
}

/** The untrained default every sub-skill starts at (01 §4 preamble). */
export const UNTRAINED_SUB_SKILL = 5;

/**
 * Every discipline, in catalogue order, whether or not the fighter trains it.
 *
 * Untrained disciplines are listed too — with their block absent and the
 * 5-point default shown — because "this fighter has no wrestling" is one of
 * the most consequential facts about them, and an editor that simply omits the
 * row makes it invisible.
 */
export function disciplineSections(def: FighterDefinition): DisciplineSection[] {
  return DISCIPLINE_IDS.map((id) => {
    const block = def.disciplines[id];
    const sub = (block?.sub ?? {}) as Record<string, number>;
    const p = (suffix: string): string => `disciplines.${id}.${suffix}`;
    const comp = block?.competition;
    return {
      id,
      label: DISCIPLINE_LABELS[id] ?? id,
      trained: block !== undefined,
      yearsPath: p('years'),
      years: block?.years ?? 0,
      qualityPath: p('trainingQuality'),
      trainingQuality: block?.trainingQuality ?? 1,
      subSkills: (SUB_SKILLS[id] ?? []).map((skill) => ({
        skill,
        label: humaniseKey(skill),
        path: `disciplines.${id}.sub.${skill}`,
        value: sub[skill] ?? UNTRAINED_SUB_SKILL,
        help: subSkillHelp(id, skill),
      })),
      detail: {
        // Every default below is the neutral value of the derivation's own
        // formula, so an untouched control cannot change a derived number.
        startAge: block?.startAge ?? DISCIPLINE_DEFAULTS.startAge,
        startAgePath: p('startAge'),
        hoursPerWeek: block?.hoursPerWeek ?? DISCIPLINE_DEFAULTS.hoursPerWeek,
        hoursPath: p('hoursPerWeek'),
        sessionsPerWeek: block?.sessionsPerWeek ?? DISCIPLINE_DEFAULTS.sessionsPerWeek,
        sessionsPath: p('sessionsPerWeek'),
        sparringIntensity: block?.sparringIntensity ?? DISCIPLINE_DEFAULTS.sparringIntensity,
        sparringPath: p('sparringIntensity'),
        monthsSinceTrained: block?.monthsSinceTrained ?? 0,
        rustPath: p('monthsSinceTrained'),
        coachQuality: block?.coachQuality ?? DISCIPLINE_DEFAULTS.coachQuality,
        coachPath: p('coachQuality'),
        isBase: block?.isBase ?? false,
        isBasePath: p('isBase'),
        gradeSystem: block?.grade?.system ?? 'none',
        gradeSystemPath: p('grade.system'),
        gradeRank: block?.grade?.rank ?? 'none.unranked',
        gradeRankPath: p('grade.rank'),
        stripes: block?.grade?.stripes ?? 0,
        stripesPath: p('grade.stripes'),
        specialisations: block?.specialisations ? [...block.specialisations] : [],
        specialisationsPath: p('specialisations'),
        competition: {
          level: comp?.level ?? 'none',
          bouts: comp?.bouts ?? 0,
          wins: comp?.wins ?? 0,
          losses: comp?.losses ?? 0,
          draws: comp?.draws ?? 0,
          amateurBouts: comp?.amateurBouts ?? 0,
          amateurWins: comp?.amateurWins ?? 0,
          proBouts: comp?.proBouts ?? 0,
          proWins: comp?.proWins ?? 0,
          bestPlacing: comp?.bestPlacing ?? 'none',
          medals: comp?.medals ?? 0,
        },
        competitionPath: p('competition'),
      },
    };
  });
}

/**
 * The neutral defaults for the §8.1 depth fields.
 *
 * They are exported because three places need to agree on them — the editor
 * (so an untouched control shows what the sim assumes), the validator (so it
 * does not warn about a value nobody set) and the generator. A fourth copy
 * would be a fourth chance to disagree with `fighter.params.ts`.
 */
export const DISCIPLINE_DEFAULTS = Object.freeze({
  startAge: 18,
  hoursPerWeek: 8,
  sessionsPerWeek: 5,
  sparringIntensity: 50,
  coachQuality: 50,
});

/** A fresh, fully-populated block for a discipline the fighter is taking up. */
export function blankDisciplineBlock(id: CoreDisciplineId): {
  years: number; trainingQuality: number; styleTags: string[]; sub: Record<string, number>;
  startAge: number; hoursPerWeek: number; sessionsPerWeek: number; sparringIntensity: number;
  monthsSinceTrained: number; coachQuality: number; specialisations: string[];
} {
  const sub: Record<string, number> = {};
  for (const skill of SUB_SKILLS[id] ?? []) sub[skill] = UNTRAINED_SUB_SKILL;
  return {
    years: 0,
    trainingQuality: 1,
    styleTags: [],
    sub,
    ...DISCIPLINE_DEFAULTS,
    monthsSinceTrained: 0,
    specialisations: [],
  };
}

// --------------------------------------------------------------------------
// Style normalisation
// --------------------------------------------------------------------------

/**
 * `StyleSpec` accepts both a bare id list and a weighted list, because
 * definitions written against the skeleton schema still have to load. The
 * editor only ever edits the weighted form: offering two shapes for the same
 * field would mean two sets of controls and two sets of bugs.
 */
export function weightedTechniques(v: string[] | WeightedTechnique[] | undefined): WeightedTechnique[] {
  if (!v) return [];
  return v.map((e) => (typeof e === 'string' ? { techId: e, weight: 1 } : e));
}

export function weightedSubmissions(v: string[] | WeightedSubmission[] | undefined): WeightedSubmission[] {
  if (!v) return [];
  return v.map((e) => (typeof e === 'string' ? { subId: e, weight: 1 } : e));
}

export function comboSpecs(v: string[][] | ComboSpec[] | undefined): ComboSpec[] {
  if (!v) return [];
  return v.map((e, i) =>
    Array.isArray(e) ? { id: `combo.${i + 1}`, sequence: e, weight: 1 } : e,
  );
}

export function takedownPrefs(v: FighterDefinition['style']['takedownPreferences']): WeightedTechnique[] {
  if (!v) return [];
  if (Array.isArray(v)) return weightedTechniques(v);
  return v.prefs ?? [];
}

// --------------------------------------------------------------------------
// Dirty tracking
// --------------------------------------------------------------------------

/**
 * Whether the draft differs from the last saved baseline.
 *
 * A structural comparison of the serialised form, not a reference check: the
 * editor rebuilds the definition on every keystroke, so identity says nothing.
 * Key order is stable because every write goes through `setAtPath`, which
 * spreads the existing object rather than rebuilding it from scratch.
 */
export function isDirty(baseline: FighterDefinition | null, draft: FighterDefinition): boolean {
  if (baseline === null) return true;
  return stableStringify(baseline) !== stableStringify(draft);
}

/**
 * JSON with sorted keys, so two equal definitions always compare equal.
 *
 * Keys whose value is `undefined` are dropped, matching `JSON.stringify`. A
 * definition must survive a JSON round-trip unchanged (01), so `{thaiStyle:
 * undefined}` and `{}` are the same fighter — and a saved record, which has
 * been through storage, must not read as dirty against the draft it came from.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

// --------------------------------------------------------------------------
// Convenience readouts the header strip shows
// --------------------------------------------------------------------------

export function buildBlendOfDefinition(def: FighterDefinition): { ecto: number; meso: number; endo: number } {
  return buildBlendOf(def.body.build);
}

/** Slug-safe id from a name, for a fighter the user has just created. */
export function idFromName(name: string, salt: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `fighter.${slug || 'unnamed'}.${salt}`;
}
