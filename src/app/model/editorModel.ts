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
    return {
      id,
      label: DISCIPLINE_LABELS[id] ?? id,
      trained: block !== undefined,
      yearsPath: `disciplines.${id}.years`,
      years: block?.years ?? 0,
      qualityPath: `disciplines.${id}.trainingQuality`,
      trainingQuality: block?.trainingQuality ?? 1,
      subSkills: (SUB_SKILLS[id] ?? []).map((skill) => ({
        skill,
        label: humaniseKey(skill),
        path: `disciplines.${id}.sub.${skill}`,
        value: sub[skill] ?? UNTRAINED_SUB_SKILL,
        help: subSkillHelp(id, skill),
      })),
    };
  });
}

/** A fresh, fully-populated block for a discipline the fighter is taking up. */
export function blankDisciplineBlock(id: CoreDisciplineId): { years: number; trainingQuality: number; styleTags: string[]; sub: Record<string, number> } {
  const sub: Record<string, number> = {};
  for (const skill of SUB_SKILLS[id] ?? []) sub[skill] = UNTRAINED_SUB_SKILL;
  return { years: 0, trainingQuality: 1, styleTags: [], sub };
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

/** JSON with sorted keys, so two equal definitions always compare equal. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
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
