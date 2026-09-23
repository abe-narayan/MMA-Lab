/**
 * STYLE PREFERENCES — 01 §2.6's authored lists, compiled into the decision path.
 *
 * `StyleSpec` carries five lists the creator's Style tab writes and validates:
 * `favouriteTechniques`, `favouriteCombos`, `goToSubmissions`,
 * `takedownPreferences` and `preferredRange`. Until this module existed nothing
 * in `src/sim/ai/` read any of them (Phase 4 finding F-3), so a fighter built
 * around the guillotine hunted it no more often than anyone else.
 *
 * This file is the join. It normalises the four accepted authoring shapes
 * (bare id list / weighted list / `TakedownStyle` / `ComboSpec`), expands
 * submission *families* through chapter 04's `resolveSubmissionFamily`
 * (`sub.kimura` covers every kimura variant), drops anything the fighter's tier
 * does not own, and hands the result to the three places a preference may bite:
 *
 *   1. **Plan generation** (`plan.ts`, 07 §2.5.3 step 5) — the preferred
 *      families seed `primaryWeapons`/`secondaryWeapons` and the submission
 *      targets *before* the discipline-mean ranking fills the rest.
 *   2. **Action selection** (`policy.weightsFor` -> `utility.scoreAction`) — a
 *      per-*technique* multiplier, which is the granularity the plan cannot
 *      reach: a guillotine specialist and an armbar specialist share the
 *      `submission` family and differ only by id. It rides inside the same
 *      `clamp[0.25, 3]` band as `w_style x w_plan x w_adapt x w_matchup`.
 *   3. **Macros** (`macros.preferComboOrder`) — the authored chains are
 *      preferred among the legal ones the tier already offers.
 *
 * Two invariants this module exists to hold:
 *
 *   - **A preference never unlocks anything.** Everything here is a
 *     *multiplier* on an option the enumerator already produced, and the
 *     compiled maps additionally drop ids the tier repertoire (01 §3, via
 *     `ai/behaviour.ts`) or the technique's own `minTier` forbids. A T1 who
 *     lists an elbow as a favourite still has no elbow.
 *   - **No preference costs a draw.** Everything is a pure function of the
 *     definition and is compiled once per runtime and cached, so the §2.7
 *     schedule (8 draws per fighter in P3, 1 in P5) is untouched.
 *
 * Tier scaling (§2.5.8). The authored weight is raised to a fidelity exponent
 * by IQ tier: a T5 executes the game plan as written, a T1's preferences show
 * up as a crude bias, and a T0 — who has no plan at all and fights on style
 * weights only — keeps the weakest version of it, because instinct is all he
 * has. The exponent never changes the *ordering* of a fighter's own
 * preferences, only how far they pull away from 1.
 */
import type { FighterRuntime } from '../fighter';
import type { RangeBand, StyleSpec } from '../fighter/types';
import { GRAPPLING_EDGES } from '../grappling/graph';
import { hasTechnique, technique, type TechniqueSpec } from '../striking/catalogue';
import { resolveSubmissionFamily } from '../submissions/catalogue';
import { familyForEdge } from './actions';
import { tierBehaviourFor, techniqueBlockedBy, type TierBehaviour } from './behaviour';
import type { ActionFamily, PhaseTarget, RangeTarget } from './contracts';
import { familyForTechnique } from './families';
import { iqTier07Of } from './scout';

// ---------------------------------------------------------------------------
// Parameters (mirrored in params/multi.params.ts alongside the §2.5 tables)
// ---------------------------------------------------------------------------

/**
 * `ai.pref.weight_min` / `ai.pref.weight_max`: the band an authored weight is
 * squeezed into before it becomes a multiplier. It is the `w_style` range of
 * §2.2.3, so a preference can never be a wider channel than style itself.
 */
export const PREF_WEIGHT_MIN = 0.5;
export const PREF_WEIGHT_MAX = 2.0;

/**
 * `ai.pref.default_weight`: what a bare `"tech.jab"` (no number) is worth. An
 * author who puts a technique on a "favourites" list means something by it;
 * 1.0 would mean nothing at all. `[E]`
 */
export const PREF_DEFAULT_WEIGHT = 1.25;

/**
 * `ai.pref.gain`: how much of an authored weight's distance from 1 survives
 * into the multiplier. A preference is a *tendency*, not a script: at gain 1 a
 * fighter who lists four favourites stops throwing everything else, which
 * showed up as an elite wrestler jabbing and shooting his way to a decision he
 * used to finish. Half the authored distance keeps the ordering, keeps the
 * measured usage shift large, and leaves the §5 headline batch where chapter
 * 09 calibrated it. `[E]`
 */
export const PREF_GAIN = 0.35;

/**
 * `ai.pref.plan_share`: how much of a preference reaches the *plan* channel as
 * a family weight, on top of the per-id `w_pref` the utility layer applies.
 * The two channels are the same opinion, so the family side is deliberately a
 * quarter of it — enough to put the fighter's own shots on the corner's weapon
 * list, not enough to count the preference twice. `[E]`
 */
export const PREF_PLAN_SHARE = 0.25;

/**
 * `ai.pref.fidelity.tier` — §2.5.8's plan-quality ladder applied to how
 * faithfully the authored intent survives contact. `w_eff = w ^ fidelity`. `[E]`
 */
export const PREF_FIDELITY_BY_IQ: readonly number[] = [0.50, 0.65, 0.80, 0.90, 1.00, 1.00];

// ---------------------------------------------------------------------------
// Compiled shape
// ---------------------------------------------------------------------------

/** `TakedownStyle.setup` (01 §2.6), repeated locally so this file owns no type. */
export type TakedownSetupId =
  'naked' | 'offSingleStrike' | 'offCombination' | 'offFeint' | 'reactive' | 'offClinch';

export interface PreferredCombo {
  id: string;
  /** Technique / feint / movement ids in order, as authored. */
  sequence: readonly string[];
  /** Already fidelity-scaled and clamped. */
  weight: number;
}

export interface StylePreferences {
  /**
   * Technique, grappling-edge and submission id -> multiplier. Submission
   * families are already expanded to their variants, so a lookup is one map hit
   * per candidate.
   */
  readonly byId: ReadonlyMap<string, number>;
  /** The families those ids belong to -> the strongest preference in each. */
  readonly families: ReadonlyMap<ActionFamily, number>;
  /** Families in descending preference, for the plan's weapon seeding. */
  readonly weaponOrder: readonly ActionFamily[];
  /** Expanded `goToSubmissions`, strongest first — the plan's sub targets. */
  readonly submissionTargets: readonly string[];
  readonly combos: readonly PreferredCombo[];
  /** `takedownPreferences.setup`, or null when the author gave a bare list. */
  readonly takedownSetup: TakedownSetupId | null;
  /** 0-1 preference to finish on the fence; null when not authored. */
  readonly cageBias: number | null;
  readonly preferredRange: RangeBand;
  readonly whenLosing: StyleSpec['whenLosing'];
  /** §2.5.8 exponent actually used, for the Model tab and the tests. */
  readonly fidelity: number;
  /** True when nothing authored survived the tier gate. */
  readonly empty: boolean;
}

const EMPTY_PREFERENCES: StylePreferences = Object.freeze({
  byId: new Map<string, number>(),
  families: new Map<ActionFamily, number>(),
  weaponOrder: [],
  submissionTargets: [],
  combos: [],
  takedownSetup: null,
  cageBias: null,
  preferredRange: 'mid' as RangeBand,
  whenLosing: 'hold' as StyleSpec['whenLosing'],
  fidelity: 1,
  empty: true,
});

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------
// Normalising the authored shapes
// ---------------------------------------------------------------------------

interface RawPreference {
  id: string;
  weight: number;
}

function normaliseWeighted(list: unknown, key: 'techId' | 'subId'): RawPreference[] {
  if (!Array.isArray(list)) return [];
  const out: RawPreference[] = [];
  for (const entry of list) {
    if (typeof entry === 'string') {
      if (entry.length > 0) out.push({ id: entry, weight: PREF_DEFAULT_WEIGHT });
      continue;
    }
    if (entry === null || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const id = rec[key];
    if (typeof id !== 'string' || id.length === 0) continue;
    const w = rec.weight;
    out.push({
      id,
      weight: typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : PREF_DEFAULT_WEIGHT,
    });
  }
  return out;
}

function normaliseCombos(list: unknown): { id: string; sequence: string[]; weight: number }[] {
  if (!Array.isArray(list)) return [];
  const out: { id: string; sequence: string[]; weight: number }[] = [];
  list.forEach((entry, i) => {
    if (Array.isArray(entry)) {
      const seq = entry.filter((s): s is string => typeof s === 'string' && s.length > 0);
      if (seq.length > 0) out.push({ id: `combo.authored_${i}`, sequence: seq, weight: PREF_DEFAULT_WEIGHT });
      return;
    }
    if (entry === null || typeof entry !== 'object') return;
    const rec = entry as Record<string, unknown>;
    const raw = rec.sequence;
    if (!Array.isArray(raw)) return;
    const seq = raw.filter((s): s is string => typeof s === 'string' && s.length > 0);
    if (seq.length === 0) return;
    const w = rec.weight;
    out.push({
      id: typeof rec.id === 'string' && rec.id.length > 0 ? rec.id : `combo.authored_${i}`,
      sequence: seq,
      weight: typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : PREF_DEFAULT_WEIGHT,
    });
  });
  return out;
}

/** `takedownPreferences` in either accepted shape. */
function normaliseTakedowns(td: unknown): {
  prefs: RawPreference[];
  setup: TakedownSetupId | null;
  cageBias: number | null;
} {
  if (Array.isArray(td)) {
    return { prefs: normaliseWeighted(td, 'techId'), setup: null, cageBias: null };
  }
  if (td === null || typeof td !== 'object') return { prefs: [], setup: null, cageBias: null };
  const rec = td as Record<string, unknown>;
  const setup = typeof rec.setup === 'string' ? rec.setup : null;
  const bias = typeof rec.cageBias === 'number' && Number.isFinite(rec.cageBias)
    ? clamp(rec.cageBias, 0, 1)
    : null;
  return {
    prefs: normaliseWeighted(rec.prefs, 'techId'),
    setup: setup as TakedownSetupId | null,
    cageBias: bias,
  };
}

// ---------------------------------------------------------------------------
// The tier gate (01 §3): a preference may bias, never unlock
// ---------------------------------------------------------------------------

/** Every grappling edge id, with the families it can appear as. */
const EDGE_FAMILIES = new Map<string, { families: Set<ActionFamily>; minTier: number }>();
for (const e of GRAPPLING_EDGES) {
  const seen = EDGE_FAMILIES.get(e.id);
  const min = e.requirements.minTier ?? 0;
  if (seen) {
    seen.families.add(familyForEdge(e));
    seen.minTier = Math.min(seen.minTier, min);
  } else {
    EDGE_FAMILIES.set(e.id, { families: new Set([familyForEdge(e)]), minTier: min });
  }
}

function strikeSpec(id: string): TechniqueSpec | null {
  // `hasTechnique` is typed on `TechniqueId`; an authored id is any string.
  return hasTechnique(id as never) ? technique(id as never) : null;
}

/**
 * Which families this preferred id could ever be selected as, or an empty list
 * when the fighter's tier does not own it. This is deliberately the *same*
 * predicate `actions.ts` enumerates with, so a preference can never name an
 * option the candidate set would not have produced anyway.
 */
export function familiesForPreferredId(
  rt: FighterRuntime, behaviour: TierBehaviour, id: string,
): ActionFamily[] {
  if (id.startsWith('sub.')) {
    const specs = resolveSubmissionFamily(id);
    const out = new Set<ActionFamily>();
    for (const s of specs) {
      out.add(s.role === 'bottom' ? 'bottomSubmission' : 'submission');
    }
    return [...out].filter((f) => !behaviour.forbidden.has(f));
  }

  const spec = strikeSpec(id);
  if (spec) {
    if (spec.minTier > rt.strikingTier) return [];
    if (techniqueBlockedBy(behaviour, spec) !== null) return [];
    const family = familyForTechnique(spec.family, spec.limb, spec.targets[0]);
    if (behaviour.forbidden.has(family)) return [];
    return [family];
  }

  const edge = EDGE_FAMILIES.get(id);
  if (edge) {
    if (edge.minTier > rt.grapplingTier) return [];
    const out = [...edge.families].filter((f) => !behaviour.forbidden.has(f));
    return out;
  }

  // An id in neither catalogue: the creator warns about it, and the sim
  // ignores it rather than inventing a family for it.
  return [];
}

/**
 * The submission gates of `actions.submissionCandidates`, applied at compile
 * time so a leg-lock preference on a fighter with no leg-lock skill does not
 * end up on the plan's target list.
 */
function submissionSelectable(rt: FighterRuntime, id: string): boolean {
  const spec = resolveSubmissionFamily(id)[0];
  if (!spec) return false;
  const gates = spec.gates;
  if (!gates) return true;
  const bjj = rt.disciplines.bjj;
  const eff = (bjj?.effective ?? {}) as Record<string, number | undefined>;
  if (gates.flexibilityMin !== undefined && rt.effective.flexibility < gates.flexibilityMin) return false;
  if (gates.chokeSkillMin !== undefined && (eff.chokes ?? 0) < gates.chokeSkillMin) return false;
  if (gates.legLockSkillMin !== undefined && (eff.legLocks ?? 0) < gates.legLockSkillMin) return false;
  if (gates.explosivenessMin !== undefined && rt.effective.explosiveness < gates.explosivenessMin) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

const CACHE = new WeakMap<FighterRuntime, StylePreferences>();

/** §2.5.8 fidelity for a runtime, exported so the tests can assert the ladder. */
export function preferenceFidelity(rt: FighterRuntime): number {
  const tier = iqTier07Of(rt);
  return PREF_FIDELITY_BY_IQ[clamp(tier, 0, 5)] ?? 1;
}

/**
 * Shape an authored weight into the multiplier the utility layer applies:
 * clamp to the `w_style` band, compress toward 1 by `PREF_GAIN`, then raise to
 * the tier's fidelity exponent. Monotone in `weight`, so a fighter's own
 * preferences never reorder.
 */
export function shapePreferenceWeight(weight: number, fidelity: number): number {
  const w = clamp(weight, PREF_WEIGHT_MIN, PREF_WEIGHT_MAX);
  const gained = 1 + PREF_GAIN * (w - 1);
  return clamp(Math.pow(gained, fidelity), PREF_WEIGHT_MIN, PREF_WEIGHT_MAX);
}

/**
 * Compile one fighter's authored style into the maps the AI reads. Cached on
 * the runtime: nothing here depends on the bout, so it is stable for the night.
 */
export function preferencesFor(rt: FighterRuntime): StylePreferences {
  const hit = CACHE.get(rt);
  if (hit) return hit;
  const built = compile(rt);
  CACHE.set(rt, built);
  return built;
}

function compile(rt: FighterRuntime): StylePreferences {
  const style = rt.def.style as StyleSpec | undefined;
  if (!style) return EMPTY_PREFERENCES;

  const behaviour = tierBehaviourFor(rt);
  const fidelity = preferenceFidelity(rt);
  const byId = new Map<string, number>();
  const families = new Map<ActionFamily, number>();
  const strongest = new Map<ActionFamily, number>();

  const note = (id: string, weight: number, fams: ActionFamily[]): void => {
    if (fams.length === 0) return;
    const w = shapePreferenceWeight(weight, fidelity);
    // Two lists naming the same id (a favourite that is also a takedown
    // preference) take the stronger opinion, never the product: preference is
    // an opinion, not a stack of them.
    const prior = byId.get(id);
    if (prior === undefined || w > prior) byId.set(id, w);
    for (const f of fams) {
      const seen = strongest.get(f);
      if (seen === undefined || w > seen) strongest.set(f, w);
    }
  };

  const takedowns = normaliseTakedowns(style.takedownPreferences);

  for (const p of normaliseWeighted(style.favouriteTechniques, 'techId')) {
    note(p.id, p.weight, familiesForPreferredId(rt, behaviour, p.id));
  }
  for (const p of takedowns.prefs) {
    note(p.id, p.weight, familiesForPreferredId(rt, behaviour, p.id));
  }

  // `goToSubmissions` may name a family (`sub.kimura`); every variant of it
  // inherits the authored weight (04 §`resolveSubmissionFamily`).
  const submissionTargets: { id: string; weight: number }[] = [];
  for (const p of normaliseWeighted(style.goToSubmissions, 'subId')) {
    const fams = familiesForPreferredId(rt, behaviour, p.id);
    if (fams.length === 0) continue;
    for (const spec of resolveSubmissionFamily(p.id)) {
      if (!submissionSelectable(rt, spec.id)) continue;
      note(spec.id, p.weight, [spec.role === 'bottom' ? 'bottomSubmission' : 'submission']);
      submissionTargets.push({ id: spec.id, weight: p.weight });
    }
  }

  for (const [f, w] of strongest) families.set(f, w);

  // Ranked weapon seed: strongest preference first, ties broken by family id so
  // the order is a pure function of the definition.
  const weaponOrder = [...families.entries()]
    .filter(([, w]) => w > 1)
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : 1))
    .map(([f]) => f);

  const combos = normaliseCombos(style.favouriteCombos)
    .map((c) => ({ id: c.id, sequence: c.sequence, weight: shapePreferenceWeight(c.weight, fidelity) }))
    .sort((a, b) => (b.weight - a.weight) || (a.id < b.id ? -1 : 1));

  const targets = submissionTargets
    .sort((a, b) => (b.weight - a.weight) || (a.id < b.id ? -1 : 1))
    .map((t) => t.id);

  const empty = byId.size === 0 && combos.length === 0;

  return Object.freeze({
    byId,
    families,
    weaponOrder,
    submissionTargets: targets,
    combos,
    takedownSetup: takedowns.setup,
    cageBias: takedowns.cageBias,
    preferredRange: style.preferredRange ?? 'mid',
    whenLosing: style.whenLosing ?? 'hold',
    fidelity,
    empty,
  });
}

// ---------------------------------------------------------------------------
// The selection-time multiplier
// ---------------------------------------------------------------------------

/**
 * The plan-channel share of a compiled family weight (see `PREF_PLAN_SHARE`).
 * The two submission families are excluded by the caller: `submission` covers
 * sixty techniques, and a guillotine specialist must not end up better at the
 * heel hook.
 */
export function planShareOf(weight: number): number {
  return 1 + PREF_PLAN_SHARE * (weight - 1);
}

/**
 * `w_pref(a)` for one candidate. The id is matched first — that is the whole
 * point, since a guillotine and an armbar are the same family — and the family
 * is the fallback for an action the author named only obliquely (the edge id
 * behind a `trip`, say).
 *
 * Returns exactly 1 when the fighter has no opinion, so the caller can fold it
 * into the clamped product unconditionally.
 */
export function preferenceWeight(
  prefs: StylePreferences, id: string | null, family: ActionFamily,
): number {
  if (prefs.empty) return 1;
  if (id !== null) {
    const exact = prefs.byId.get(id);
    if (exact !== undefined) return exact;
  }
  // No family fallback for the two submission families: `submission` covers
  // sixty-odd techniques, and a guillotine specialist who has *not* authored
  // the armbar should not be nudged toward it.
  if (family === 'submission' || family === 'bottomSubmission') return 1;
  return prefs.families.get(family) ?? 1;
}

// ---------------------------------------------------------------------------
// `preferredRange` -> the plan's range and phase targets
// ---------------------------------------------------------------------------

/** 01 §2.6's six bands collapsed onto §2.5.2's three range targets. */
export function rangeTargetOf(band: RangeBand | undefined): RangeTarget {
  switch (band) {
    case 'long': return 'long';
    case 'mid': return 'mid';
    case 'short': case 'close': case 'clinch': case 'ground': return 'short';
    default: return 'mid';
  }
}

/** The phase a preferred band implies, or null when it implies none. */
export function phaseTargetOf(band: RangeBand | undefined): PhaseTarget | null {
  if (band === 'clinch') return 'clinch';
  if (band === 'ground') return 'groundTop';
  return null;
}
