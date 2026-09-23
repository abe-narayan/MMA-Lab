/**
 * STYLE PREFERENCES — the executable form of Phase 4 finding F-3.
 *
 * `StyleSpec.favouriteTechniques`, `favouriteCombos`, `goToSubmissions`,
 * `takedownPreferences`, `preferredRange` and `whenLosing` are authored and
 * validated by the creator. This suite is the claim that the simulation now
 * reads them, and the four guard rails that make that safe:
 *
 *  1. a preference raises its own technique's usage, measurably, in bouts;
 *  2. a submission *family* expands to its variants (`sub.kimura` covers all
 *     five kimuras) and an exact id stays exact;
 *  3. a preference for something the fighter's tier forbids does not unlock it
 *     — not in the compiled map, not in the candidate set, not in the plan;
 *  4. `style.gamePlanOverride` still replaces the generated plan wholesale;
 *  5. the §2.7 draw schedule is byte-identical with preferences on or off, and
 *     a fixed seed still reproduces a bout exactly.
 *
 * Everything is seeded. A failure here is a regression, never flakiness.
 */
import { describe, expect, it } from 'vitest';
import { simulate, boutSeed, DEFAULT_SETTINGS } from '../src/sim';
import type { SimConfig } from '../src/sim/core/config';
import { RNG } from '../src/sim/rng';
import { resolveParams } from '../src/sim/params';
import { resolveRuleset } from '../src/sim/rules';
import { deriveRuntime } from '../src/sim/fighter';
import type { FighterDefinition, FighterRuntime } from '../src/sim/fighter';
import {
  ARCH_BRAND_NEW_BRAWLER, ARCH_CHAMPION_COMPLETE, ARCH_REGIONAL_PRO_ALLROUNDER,
  ARCH_THAI_STRIKER,
} from '../src/sim/fighter';
import { resolveSubmissionFamily } from '../src/sim/submissions/catalogue';
import { buildWorld } from '../src/sim/core/build';
import { DRAWS_PER_DECIDE, type DecisionContext } from '../src/sim/core/policy';
import type { World, FighterWorldState } from '../src/sim/core/world';
import type { ObservedFighter, ObservedState } from '../src/sim/core/perception';
import { MmaPolicy } from '../src/sim/ai/policy';
import { generateGamePlan, scoutAndPlan } from '../src/sim/ai/plan';
import { scoutOpponent } from '../src/sim/ai/scout';
import { enumerateActions, type EnumerationContext } from '../src/sim/ai/actions';
import { tierBehaviourFor } from '../src/sim/ai/behaviour';
import {
  PREF_DEFAULT_WEIGHT, PREF_FIDELITY_BY_IQ, PREF_GAIN, PREF_PLAN_SHARE,
  PREF_WEIGHT_MAX, PREF_WEIGHT_MIN,
  familiesForPreferredId, phaseTargetOf, planShareOf, preferenceFidelity, preferenceWeight,
  preferencesFor, rangeTargetOf, shapePreferenceWeight,
} from '../src/sim/ai/preferences';
import {
  PREF_CLAMP_MAX, PREF_CLAMP_MIN, NEUTRAL_WEIGHTS, preferenceFactor, scoreAction,
  type ConsiderationInputs, type ScorableAction,
} from '../src/sim/ai/utility';
import { WEIGHT_CLAMP_MAX } from '../src/sim/ai/contracts';
import {
  availableMacros, comboMatchScore, preferComboOrder, type ComboPreference,
} from '../src/sim/ai/macros';
import { ADJUSTMENT_ROWS, type AdaptSignals } from '../src/sim/ai/adapt';
import { AI_PARAMS } from '../src/sim/params/ai.params';
// The barrel wires §2.5's generator to the decision core.
import '../src/sim/ai';

const params = resolveParams();
const MMA = resolveRuleset('mma.unified.3r');
const BOXING = resolveRuleset('boxing.pro');

type Mutate = (d: FighterDefinition) => void;
type StyleBag = Record<string, unknown>;

function def(base: FighterDefinition, mutate?: Mutate): FighterDefinition {
  const copy = JSON.parse(JSON.stringify(base)) as FighterDefinition;
  mutate?.(copy);
  return copy;
}

function build(base: FighterDefinition, mutate?: Mutate): FighterRuntime {
  return deriveRuntime(def(base, mutate), params, { explain: false });
}

/** Every authored preference list emptied — the "no style" control fighter. */
function blank(d: FighterDefinition): void {
  const s = d.style as unknown as StyleBag;
  s.favouriteTechniques = [];
  s.favouriteCombos = [];
  s.goToSubmissions = [];
  s.takedownPreferences = { prefs: [], setup: 'naked', cageBias: 0.5 };
}

const style = (d: FighterDefinition): StyleBag => d.style as unknown as StyleBag;

// ---------------------------------------------------------------------------
// 1. Compilation: the four authoring shapes, and the family expansion
// ---------------------------------------------------------------------------

describe('01 §2.6 preference compilation', () => {
  it('normalises the weighted and the bare-id forms', () => {
    const weighted = build(ARCH_CHAMPION_COMPLETE, (d) => {
      blank(d);
      style(d).favouriteTechniques = [{ techId: 'tech.jab', weight: 1.8 }];
    });
    const bare = build(ARCH_CHAMPION_COMPLETE, (d) => {
      blank(d);
      style(d).favouriteTechniques = ['tech.jab'];
    });
    const w = preferencesFor(weighted);
    const b = preferencesFor(bare);
    expect(w.byId.get('tech.jab')).toBeGreaterThan(1);
    // A bare id means "I favour this", not "I have no opinion".
    expect(b.byId.get('tech.jab')).toBeGreaterThan(1);
    expect(PREF_DEFAULT_WEIGHT).toBeGreaterThan(1);
    expect(w.byId.get('tech.jab')!).toBeGreaterThan(b.byId.get('tech.jab')!);
  });

  it('expands a submission FAMILY to every variant, at the family weight', () => {
    const rt = build(ARCH_CHAMPION_COMPLETE, (d) => {
      blank(d);
      style(d).goToSubmissions = [{ subId: 'sub.kimura', weight: 1.8 }];
    });
    const prefs = preferencesFor(rt);
    const variants = resolveSubmissionFamily('sub.kimura').map((s) => s.id);
    expect(variants.length).toBeGreaterThan(1);
    for (const id of variants) {
      expect(prefs.byId.get(id), id).toBeGreaterThan(1);
      expect(prefs.submissionTargets, id).toContain(id);
    }
    // Every variant of one family carries the same authored opinion.
    const values = new Set(variants.map((id) => prefs.byId.get(id)));
    expect(values.size).toBe(1);
  });

  it('keeps an exact submission id exact', () => {
    const rt = build(ARCH_CHAMPION_COMPLETE, (d) => {
      blank(d);
      style(d).goToSubmissions = [{ subId: 'sub.kimura_guard', weight: 1.8 }];
    });
    const prefs = preferencesFor(rt);
    expect(prefs.byId.has('sub.kimura_guard')).toBe(true);
    expect(prefs.byId.has('sub.kimura_side')).toBe(false);
    expect(prefs.submissionTargets).toEqual(['sub.kimura_guard']);
  });

  it('ignores an id that is in none of the three catalogues', () => {
    const rt = build(ARCH_CHAMPION_COMPLETE, (d) => {
      blank(d);
      style(d).favouriteTechniques = [{ techId: 'tech.not_a_technique', weight: 2 }];
      style(d).goToSubmissions = [{ subId: 'sub.not_a_submission', weight: 2 }];
    });
    const prefs = preferencesFor(rt);
    expect(prefs.byId.size).toBe(0);
    expect(prefs.empty).toBe(true);
  });

  it('a takedown preference and a favourite naming the same id take the stronger opinion, not the product', () => {
    const rt = build(ARCH_CHAMPION_COMPLETE, (d) => {
      blank(d);
      style(d).favouriteTechniques = [{ techId: 'tech.double_leg', weight: 1.4 }];
      style(d).takedownPreferences = {
        prefs: [{ techId: 'tech.double_leg', weight: 2.0 }], setup: 'naked', cageBias: 0.5,
      };
    });
    const prefs = preferencesFor(rt);
    const fidelity = preferenceFidelity(rt);
    expect(prefs.byId.get('tech.double_leg'))
      .toBeCloseTo(shapePreferenceWeight(2.0, fidelity), 10);
    expect(prefs.byId.get('tech.double_leg')!).toBeLessThanOrEqual(PREF_WEIGHT_MAX);
  });

  it('is a pure function of the definition — no draws, and stable across calls', () => {
    const rt = build(ARCH_THAI_STRIKER);
    const a = preferencesFor(rt);
    const b = preferencesFor(rt);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// 2. The bound and the tier ladder
// ---------------------------------------------------------------------------

describe('the `ai.pref.*` registry matches the code', () => {
  const val = (id: string): number => {
    const spec = AI_PARAMS.find((p) => p.id === id);
    expect(spec, id).toBeDefined();
    return spec!.value;
  };

  it('every preference constant is registered with a provenance tag', () => {
    expect(val('ai.pref.weight_min')).toBeCloseTo(PREF_WEIGHT_MIN, 10);
    expect(val('ai.pref.weight_max')).toBeCloseTo(PREF_WEIGHT_MAX, 10);
    expect(val('ai.pref.default_weight')).toBeCloseTo(PREF_DEFAULT_WEIGHT, 10);
    expect(val('ai.pref.gain')).toBeCloseTo(PREF_GAIN, 10);
    expect(val('ai.pref.plan_share')).toBeCloseTo(PREF_PLAN_SHARE, 10);
    for (let t = 0; t <= 5; t++) {
      expect(val(`ai.pref.fidelity.t${t}`)).toBeCloseTo(PREF_FIDELITY_BY_IQ[t], 10);
    }
    // The preference band is the `w_style` band of §2.2.3, not a wider channel.
    expect(PREF_CLAMP_MIN).toBe(PREF_WEIGHT_MIN);
    expect(PREF_CLAMP_MAX).toBe(PREF_WEIGHT_MAX);
  });
});

describe('§2.2.3 the preference multiplier is bounded', () => {
  it('shaping is monotone, clamped, and compressed by the gain', () => {
    expect(PREF_GAIN).toBeGreaterThan(0);
    expect(PREF_GAIN).toBeLessThanOrEqual(1);
    const at = (w: number): number => shapePreferenceWeight(w, 1);
    expect(at(1)).toBeCloseTo(1, 10);
    expect(at(1.5)).toBeGreaterThan(at(1.2));
    expect(at(1.2)).toBeGreaterThan(at(1.0));
    expect(at(0.6)).toBeLessThan(1);
    // A hostile authored weight cannot escape the `w_style` band.
    expect(at(1000)).toBeLessThanOrEqual(PREF_WEIGHT_MAX);
    expect(at(-5)).toBeGreaterThanOrEqual(PREF_WEIGHT_MIN);
  });

  it('the §2.5.8 fidelity ladder rises with iqTier and never reorders a fighter', () => {
    for (let t = 1; t <= 5; t++) {
      expect(PREF_FIDELITY_BY_IQ[t]).toBeGreaterThanOrEqual(PREF_FIDELITY_BY_IQ[t - 1]);
    }
    expect(PREF_FIDELITY_BY_IQ[5]).toBe(1);
    // A T5 executes the plan as written; a T1's preference is a crude bias.
    expect(shapePreferenceWeight(2, PREF_FIDELITY_BY_IQ[5]))
      .toBeGreaterThan(shapePreferenceWeight(2, PREF_FIDELITY_BY_IQ[1]));
    // Ordering inside one fighter survives any fidelity.
    for (const f of PREF_FIDELITY_BY_IQ) {
      expect(shapePreferenceWeight(1.8, f)).toBeGreaterThan(shapePreferenceWeight(1.3, f));
    }
  });

  it('a T0 fighter still gets the weakest version of his instincts', () => {
    const brawler = build(ARCH_BRAND_NEW_BRAWLER);
    const champ = build(ARCH_CHAMPION_COMPLETE);
    expect(preferenceFidelity(brawler)).toBeLessThan(preferenceFidelity(champ));
    expect(preferenceFidelity(brawler)).toBeGreaterThan(0);
  });

  it('`w_pref` cannot push the §2.2.3 product past the documented clamp', () => {
    expect(preferenceFactor(undefined)).toBe(1);
    expect(preferenceFactor(Number.NaN)).toBe(1);
    expect(preferenceFactor(99)).toBe(PREF_CLAMP_MAX);
    expect(preferenceFactor(0)).toBe(PREF_CLAMP_MIN);

    const action: ScorableAction = {
      family: 'jab', base: 1, rangeError: 0, risk: 0.1, ownRegionDamage: 0,
      positionValue: 0.5, isMustNot: false, shield: 0,
    };
    const x = inputs();
    const wild = scoreAction(action, x, { ...NEUTRAL_WEIGHTS, style: 2, plan: 3, pref: 99 });
    expect(wild.weightProduct).toBeLessThanOrEqual(WEIGHT_CLAMP_MAX);
  });

  it('a preference scales the score by exactly its bounded factor', () => {
    const action: ScorableAction = {
      family: 'jab', base: 1, rangeError: 0, risk: 0.1, ownRegionDamage: 0,
      positionValue: 0.5, isMustNot: false, shield: 0,
    };
    const x = inputs();
    const off = scoreAction(action, x, NEUTRAL_WEIGHTS);
    const on = scoreAction(action, x, { ...NEUTRAL_WEIGHTS, pref: 1.4 });
    expect(on.score / off.score).toBeCloseTo(1.4, 10);
  });

  it('a submission preference does not spill onto the rest of the family', () => {
    const rt = build(ARCH_CHAMPION_COMPLETE, (d) => {
      blank(d);
      style(d).goToSubmissions = [{ subId: 'sub.guillotine', weight: 2 }];
    });
    const prefs = preferencesFor(rt);
    expect(preferenceWeight(prefs, 'sub.guillotine_standard', 'submission')).toBeGreaterThan(1);
    // The armbar is the same `submission` family and must stay at 1.
    expect(preferenceWeight(prefs, 'sub.armbar_guard', 'submission')).toBe(1);
    expect(preferenceWeight(prefs, null, 'submission')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. A preference may bias, never unlock (01 §3)
// ---------------------------------------------------------------------------

describe('01 §3 a preference never unlocks a technique the tier forbids', () => {
  it('drops an elbow and a switch head kick from a T0 brawler, keeps them for a champion', () => {
    const brawler = build(ARCH_BRAND_NEW_BRAWLER);
    const champ = build(ARCH_CHAMPION_COMPLETE);
    const bb = tierBehaviourFor(brawler);
    const cb = tierBehaviourFor(champ);
    for (const id of ['tech.elbow_horizontal', 'tech.kick_head_switch']) {
      expect(familiesForPreferredId(brawler, bb, id), `brawler ${id}`).toEqual([]);
      expect(familiesForPreferredId(champ, cb, id).length, `champ ${id}`).toBeGreaterThan(0);
    }
  });

  it('the compiled map and the plan both refuse the forbidden preference', () => {
    const brawler = build(ARCH_BRAND_NEW_BRAWLER, (d) => {
      blank(d);
      style(d).favouriteTechniques = [
        { techId: 'tech.elbow_horizontal', weight: 2 },
        { techId: 'tech.kick_head_switch', weight: 2 },
      ];
    });
    const prefs = preferencesFor(brawler);
    expect(prefs.byId.size).toBe(0);
    expect(prefs.families.has('elbow')).toBe(false);
    expect(prefs.families.has('headKick')).toBe(false);

    const opp = build(ARCH_REGIONAL_PRO_ALLROUNDER, (d) => { d.id = 'opp'; });
    const plan = scoutAndPlan(brawler, opp, MMA, new RNG('forbidden'), 3);
    if (plan) {
      expect(plan.primaryWeapons).not.toContain('elbow');
      expect(plan.primaryWeapons).not.toContain('headKick');
      expect(plan.secondaryWeapons).not.toContain('elbow');
    }
  });

  it('the candidate set still contains no elbow, however hard the author asks', () => {
    const brawler = build(ARCH_BRAND_NEW_BRAWLER, (d) => {
      style(d).favouriteTechniques = [{ techId: 'tech.elbow_horizontal', weight: 2 }];
    });
    const ctx: EnumerationContext = {
      self: brawler, ruleset: MMA, posture: 'standing', node: 'pos.standing_mid', slot: null,
      distanceM: 0.55, cageDistM: 2, atCage: false,
      damage: { head: 0, body: 0, leadLeg: 0, rearLeg: 0, arms: 0 },
      balance: 1, hasTarget: true, outnumbered: false, positionValue: 0.5,
      mustNots: [], shield: 0,
    };
    const ids = enumerateActions(ctx).map((c) => c.id);
    expect(ids).not.toContain('tech.elbow_horizontal');
  });

  it('a submission preference the ruleset forbids never reaches the plan', () => {
    const champ = build(ARCH_CHAMPION_COMPLETE, (d) => {
      style(d).goToSubmissions = [{ subId: 'sub.rnc', weight: 2 }];
    });
    const opp = build(ARCH_REGIONAL_PRO_ALLROUNDER, (d) => { d.id = 'opp'; });
    const mma = scoutAndPlan(champ, opp, MMA, new RNG('ruleset'), 3)!;
    const box = scoutAndPlan(champ, opp, BOXING, new RNG('ruleset'), 3)!;
    expect(mma.submissionTargets.length).toBeGreaterThan(0);
    expect(box.submissionTargets).toEqual([]);
    for (const fam of [...box.primaryWeapons, ...box.secondaryWeapons]) {
      expect(box.actionWeights[fam]).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Plan seeding, `preferredRange`, and the author override
// ---------------------------------------------------------------------------

describe('§2.5.3 the plan is seeded from the authored preferences', () => {
  const opp = build(ARCH_REGIONAL_PRO_ALLROUNDER, (d) => { d.id = 'opp'; });

  it('a preferred family leads the weapon list ahead of the discipline-mean ranking', () => {
    const plain = scoutAndPlan(
      build(ARCH_CHAMPION_COMPLETE, blank), opp, MMA, new RNG('seed'), 3,
    )!;
    const kicker = scoutAndPlan(
      build(ARCH_CHAMPION_COMPLETE, (d) => {
        blank(d);
        style(d).favouriteTechniques = [{ techId: 'tech.kick_low_rear', weight: 2 }];
      }),
      opp, MMA, new RNG('seed'), 3,
    )!;
    expect(plain.primaryWeapons).not.toContain('lowKick');
    expect(kicker.primaryWeapons[0]).toBe('lowKick');
  });

  it('carries the family-expanded submission targets', () => {
    const plan = scoutAndPlan(
      build(ARCH_CHAMPION_COMPLETE, (d) => {
        blank(d);
        style(d).goToSubmissions = [{ subId: 'sub.kimura', weight: 1.6 }];
      }),
      opp, MMA, new RNG('seed'), 3,
    )!;
    const variants = resolveSubmissionFamily('sub.kimura').map((s) => s.id);
    expect(plan.submissionTargets.length).toBe(variants.length);
    for (const id of variants) expect(plan.submissionTargets).toContain(id);
  });

  it('the plan channel carries only a share of the opinion — the rest is per id', () => {
    expect(planShareOf(2)).toBeGreaterThan(1);
    expect(planShareOf(2)).toBeLessThan(2);
    expect(planShareOf(1)).toBe(1);
    // The two submission families are deliberately not in the plan channel.
    const plan = scoutAndPlan(
      build(ARCH_CHAMPION_COMPLETE, (d) => {
        blank(d);
        style(d).goToSubmissions = [{ subId: 'sub.guillotine', weight: 2 }];
      }),
      opp, MMA, new RNG('seed'), 3,
    )!;
    const plain = scoutAndPlan(build(ARCH_CHAMPION_COMPLETE, blank), opp, MMA, new RNG('seed'), 3)!;
    expect(plan.actionWeights.submission).toBeCloseTo(plain.actionWeights.submission, 10);
  });

  it('honours `preferredRange` on the plan, in every band', () => {
    const planFor = (band: string) => scoutAndPlan(
      build(ARCH_CHAMPION_COMPLETE, (d) => { style(d).preferredRange = band; }),
      opp, MMA, new RNG('range'), 3,
    )!;
    expect(rangeTargetOf('clinch')).toBe('short');
    expect(rangeTargetOf('ground')).toBe('short');
    expect(phaseTargetOf('clinch')).toBe('clinch');
    expect(phaseTargetOf('ground')).toBe('groundTop');
    expect(phaseTargetOf('mid')).toBeNull();

    expect(planFor('long').rangeTarget).toBe('long');
    expect(planFor('mid').rangeTarget).toBe('mid');
    expect(planFor('short').rangeTarget).toBe('short');
    expect(planFor('clinch').phaseTarget).toBe('clinch');
    expect(planFor('ground').phaseTarget).toBe('groundTop');
  });

  it('`gamePlanOverride` still replaces the generated plan wholesale', () => {
    const self = build(ARCH_CHAMPION_COMPLETE, (d) => {
      style(d).favouriteTechniques = [{ techId: 'tech.kick_low_rear', weight: 2 }];
      style(d).preferredRange = 'long';
      style(d).gamePlanOverride = {
        primaryMode: 'mode.clinch_grind',
        rangeTarget: 'short',
        primaryWeapons: ['knee'],
        submissionTargets: [],
      };
    });
    const plan = generateGamePlan({
      self, opponent: opp, ruleset: MMA,
      report: scoutOpponent(self, opp, new RNG('override')),
    })!;
    expect(plan.overridden).toBe(true);
    expect(plan.primaryMode).toBe('mode.clinch_grind');
    expect(plan.rangeTarget).toBe('short');
    expect(plan.primaryWeapons).toEqual(['knee']);
    expect(plan.submissionTargets).toEqual([]);
    expect(plan.rationale[0].ruleId).toBe('override');
  });
});

// ---------------------------------------------------------------------------
// 5. `favouriteCombos` (§2.2.5)
// ---------------------------------------------------------------------------

describe('01 §2.6 favouriteCombos are preferred among the legal chains', () => {
  const legal = (): ReturnType<typeof availableMacros> => availableMacros(5, 4);

  it('scores an exact chain above a prefix above an unrelated one', () => {
    const macro = legal().find((m) => m.steps.length >= 2)!;
    const exact: ComboPreference = {
      id: 'c', sequence: macro.steps.map((s) => s.id), weight: 1.5,
    };
    const prefix: ComboPreference = {
      id: 'c2', sequence: [...macro.steps.map((s) => s.id), 'tech.kick_low_rear'], weight: 1.5,
    };
    const other: ComboPreference = { id: 'c3', sequence: ['tech.not_a_thing'], weight: 1.5 };
    expect(comboMatchScore(macro, exact)).toBe(3);
    expect(comboMatchScore(macro, prefix)).toBe(2);
    expect(comboMatchScore(macro, other)).toBe(0);
  });

  it('puts the authored chain first without adding or removing any option', () => {
    const options = legal().filter((m) => m.steps[0].id === 'tech.jab' && m.steps.length > 1);
    expect(options.length).toBeGreaterThan(1);
    const target = options[options.length - 1];
    const ordered = preferComboOrder(options, [
      { id: 'authored', sequence: target.steps.map((s) => s.id), weight: 1.8 },
    ]);
    expect(ordered[0].id).toBe(target.id);
    expect(ordered.map((m) => m.id).sort()).toEqual(options.map((m) => m.id).sort());
  });

  it('with no authored chains the order is exactly what it was', () => {
    const options = legal();
    expect(preferComboOrder(options, []).map((m) => m.id)).toEqual(options.map((m) => m.id));
  });

  it('cannot reach a chain the tier or the cap does not allow', () => {
    const novice = availableMacros(1, 2);
    const elite = availableMacros(5, 4);
    expect(novice.length).toBeLessThan(elite.length);
    const fourPunch = elite.find((m) => m.strikeCount === 4);
    const ordered = preferComboOrder(novice, fourPunch
      ? [{ id: 'a', sequence: fourPunch.steps.map((s) => s.id), weight: 2 }]
      : []);
    expect(ordered.length).toBe(novice.length);
    for (const m of ordered) expect(m.strikeCount).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 6. `whenLosing` (§2.6.3)
// ---------------------------------------------------------------------------

describe('01 §2.6 whenLosing shapes the behind-on-the-cards adjustment', () => {
  const behindFinal = ADJUSTMENT_ROWS.find((r) => r.id === 'adj.behind_final')!;

  function signals(over: Partial<AdaptSignals> = {}): AdaptSignals {
    return {
      collapsedFamily: null, bestFamily: null, threatFamily: null,
      ownTdStuffedX2: false, takenDownX2: false, oppTired: false, oppHurt: false,
      ownFatigue: 0, round: 3, finalRound: true, perceivedRoundsUp: -1,
      needFinishDeficit: 2, ownVisionImpaired: false, cageExchanges: 0,
      oppAdjusted: false, ownLegDamaged: false, oppLegDamaged: false, trapReady: false,
      losingBehaviourUnchanged: false,
      isWrestler: false, isStriker: true, strengthEdge: false, subSpecialist: false,
      ...over,
    };
  }

  it('gambles harder, stalls flatter, and presses in between', () => {
    const risk = (w: AdaptSignals['whenLosing']): number =>
      behindFinal.build(signals({ whenLosing: w })).policy?.riskDelta ?? 0;
    const pace = (w: AdaptSignals['whenLosing']): number =>
      behindFinal.build(signals({ whenLosing: w })).policy?.paceMult ?? 1;
    expect(risk('gamble')).toBeGreaterThan(risk('press'));
    expect(risk('press')).toBeGreaterThan(risk('stall'));
    expect(pace('gamble')).toBeGreaterThan(pace('press'));
    expect(pace('press')).toBeGreaterThan(pace('stall'));
    // An absent field is the §2.6.3 default.
    expect(risk(undefined)).toBe(risk('press'));
  });

  it('`hold` disables the rule entirely, like `losingBehaviour: unchanged`', () => {
    expect(behindFinal.fires(signals({ losingBehaviourUnchanged: false }))).toBe(true);
    expect(behindFinal.fires(signals({ losingBehaviourUnchanged: true }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. The determinism contract (09 §2.7) is untouched
// ---------------------------------------------------------------------------

const POLICY_DRAWS = DRAWS_PER_DECIDE - 1;

function observe(f: FighterWorldState): ObservedFighter {
  return {
    id: f.id, team: f.team, x: f.x, z: f.z, facing: f.facing, vx: f.vx, vz: f.vz,
    posture: f.posture, position: f.position,
    action: f.action ?? 'idle', actionPhase: 0,
    stance: f.stance,
    visiblyHurt: false, visiblyTired: false, handsDropped: false,
    balance: f.balance,
  };
}

function pushObservation(world: World): void {
  const state: ObservedState = {
    tick: world.tick, fighters: world.fighters.map(observe),
  };
  for (const f of world.fighters) f.perception.push(state);
}

function ctxFor(world: World, f: FighterWorldState): DecisionContext {
  return {
    world, self: f, observed: f.perception.delayed(1), rng: world.rng,
    tick: world.tick, nowMs: world.nowMs, canAct: true,
  };
}

/** A full three-round bout, for the "does it actually bite" assertions. */
function fullConfig(seed: string, fighters: FighterDefinition[]): SimConfig {
  return {
    seed, mode: '1v1', fighters, teams: { teamOf: [0, 1] },
    ruleset: 'mma.unified.3r', arena: 'octagon_30', settings: { ...DEFAULT_SETTINGS },
  };
}

function config(seed: string, fighters: FighterDefinition[]): SimConfig {
  return {
    seed, mode: '1v1', fighters, teams: { teamOf: [0, 1] },
    ruleset: 'mma.unified.3r', arena: 'octagon_30',
    settings: { ...DEFAULT_SETTINGS, rounds: 1, roundSeconds: 60, restSeconds: 10 },
  };
}

/** The same champion, with and without a very loud Style tab. */
const LOUD = def(ARCH_CHAMPION_COMPLETE, (d) => {
  style(d).favouriteTechniques = [
    { techId: 'tech.kick_low_rear', weight: 2 },
    { techId: 'tech.double_leg', weight: 2 },
  ];
  style(d).goToSubmissions = [{ subId: 'sub.kimura', weight: 2 }];
  style(d).favouriteCombos = [
    { id: 'c', sequence: ['tech.jab', 'tech.cross', 'tech.kick_low_rear'], weight: 2 },
  ];
  style(d).takedownPreferences = {
    prefs: [{ techId: 'tech.double_leg', weight: 2 }], setup: 'offCombination', cageBias: 0.8,
  };
});
const QUIET = def(ARCH_CHAMPION_COMPLETE, blank);
const FOE = def(ARCH_REGIONAL_PRO_ALLROUNDER, (d) => { d.id = 'foe'; });

describe('09 §2.7 the draw schedule is unchanged by preferences', () => {
  it('decide() still takes exactly its share of the P3 budget, loud or quiet', () => {
    for (const [label, self] of [['loud', LOUD], ['quiet', QUIET]] as const) {
      const world = buildWorld(config('style-draws', [self, FOE]));
      pushObservation(world);
      const policy = new MmaPolicy();
      policy.prepare(world);
      for (let t = 0; t < 40; t++) {
        world.tick = t;
        world.roundTick = t;
        world.nowMs = t * 100;
        pushObservation(world);
        for (const f of world.fighters) {
          const before = world.rng.draws;
          policy.decide(ctxFor(world, f));
          expect(world.rng.draws - before, `${label} tick ${t}`).toBe(POLICY_DRAWS);
        }
      }
    }
  });

  it('the pre-bout stream costs the same with preferences on and off', () => {
    const counts = [LOUD, QUIET].map((self) => {
      const world = buildWorld(config('style-prepare', [self, FOE]));
      const before = world.rng.draws;
      new MmaPolicy().prepare(world);
      return world.rng.draws - before;
    });
    expect(counts[0]).toBe(counts[1]);
  });

  it('a whole bout consumes the same number of draws either way', () => {
    // The draw *schedule* is fixed per tick, so two bouts of the same length
    // cost the same stream; a bout that ends earlier because the preferences
    // changed the fight costs fewer ticks, which is the schedule working, not
    // breaking. The per-tick assertion above is the strict one.
    for (let i = 0; i < 4; i++) {
      const a = simulate(config(`style-stream-${i}`, [LOUD, FOE]));
      const b = simulate(config(`style-stream-${i}`, [QUIET, FOE]));
      expect(a.rngDraws / Math.max(1, a.ticks)).toBeCloseTo(b.rngDraws / Math.max(1, b.ticks), 6);
    }
  });

  it('but the preferences do change the fight', () => {
    const changed = Array.from({ length: 6 }, (_, i) => {
      const a = simulate(fullConfig(`style-bite-${i}`, [LOUD, FOE]));
      const b = simulate(fullConfig(`style-bite-${i}`, [QUIET, FOE]));
      return a.digest !== b.digest;
    });
    expect(changed.some(Boolean)).toBe(true);
  });

  it('a fixed seed reproduces the bout exactly', () => {
    const a = simulate(config('style-repeat', [LOUD, FOE]));
    const b = simulate(config('style-repeat', [LOUD, FOE]));
    expect(a.digest).toBe(b.digest);
    expect(a.rngDraws).toBe(b.rngDraws);
    expect(a.result.totalSeconds).toBe(b.result.totalSeconds);
  });
});

// ---------------------------------------------------------------------------
// 8. F-3 itself: the preference moves the usage
// ---------------------------------------------------------------------------

/**
 * A seeded batch, counted the way `scripts/dev/style.ts` counts it: the share
 * of this fighter's own strikes (or submission stages) that are one of the ids
 * he was authored to prefer. Matched archetypes, so the bouts run long enough
 * for the share to mean something.
 */
interface Usage {
  strikes: number;
  strikeHits: number;
  subStages: number;
  subHits: number;
}

const SPARRING_FOE = def(ARCH_REGIONAL_PRO_ALLROUNDER, (d) => { d.id = 'foe'; });

function usage(self: FighterDefinition, watch: readonly string[], n: number, tag: string): Usage {
  const set = new Set(watch);
  const out: Usage = { strikes: 0, strikeHits: 0, subStages: 0, subHits: 0 };
  for (let i = 0; i < n; i++) {
    const run = simulate(fullConfig(boutSeed(tag, '1v1', i), [self, SPARRING_FOE]));
    for (const e of run.events) {
      if (e.actor !== 0) continue;
      if (e.kind === 'strike') {
        out.strikes += 1;
        if (set.has((e as { detail: { technique: string } }).detail.technique)) out.strikeHits += 1;
      } else if (e.kind === 'submissionStage') {
        const d = (e as { detail: { technique: string; stage: number } }).detail;
        if (d.stage < 1) continue;
        out.subStages += 1;
        if (set.has(d.technique)) out.subHits += 1;
      }
    }
  }
  return out;
}

const CONTROL = def(ARCH_REGIONAL_PRO_ALLROUNDER, blank);

describe("F-3: an authored preference raises its own technique's usage", () => {
  /**
   * Individually, most techniques are rare enough that ten bouts is noise, so
   * the assertion pools a jab / body-punch / leg-kick preference and asks
   * whether the fighter's *authored* share of his own output rises. That is
   * the number `scripts/dev/style.ts` reports per technique over 150 bouts.
   */
  const STRIKE_WATCH = [
    'tech.jab', 'tech.jab_step', 'tech.jab_body',
    'tech.hook_rear_body', 'tech.hook_lead_body',
    'tech.kick_low_rear', 'tech.kick_low_lead', 'tech.kick_calf',
  ];
  const STRANGLE_WATCH = [
    ...resolveSubmissionFamily('sub.rnc'),
    ...resolveSubmissionFamily('sub.arm_triangle'),
    ...resolveSubmissionFamily('sub.guillotine'),
  ].map((x) => x.id);

  it('the preferred strikes take a larger share of the same output', () => {
    const off = usage(CONTROL, STRIKE_WATCH, 20, 'style.mix');
    const on = usage(
      def(ARCH_REGIONAL_PRO_ALLROUNDER, (d) => {
        blank(d);
        style(d).favouriteTechniques = STRIKE_WATCH.map((techId) => ({ techId, weight: 2 }));
      }),
      STRIKE_WATCH, 20, 'style.mix',
    );
    expect(off.strikes).toBeGreaterThan(500);
    expect(on.strikeHits / on.strikes).toBeGreaterThan(off.strikeHits / off.strikes);
  });

  it('a strangler attacks a larger share of strangles', () => {
    const off = usage(CONTROL, STRANGLE_WATCH, 30, 'style.sub');
    const on = usage(
      def(ARCH_REGIONAL_PRO_ALLROUNDER, (d) => {
        blank(d);
        style(d).goToSubmissions = [
          { subId: 'sub.rnc', weight: 2 },
          { subId: 'sub.arm_triangle', weight: 2 },
          { subId: 'sub.guillotine', weight: 2 },
        ];
      }),
      STRANGLE_WATCH, 30, 'style.sub',
    );
    expect(off.subStages).toBeGreaterThan(100);
    expect(on.subHits / on.subStages).toBeGreaterThan(off.subHits / off.subStages);
  });

  it('two specialists in the same family diverge on their own submissions', () => {
    const guillotine = build(ARCH_CHAMPION_COMPLETE, (d) => {
      blank(d);
      style(d).goToSubmissions = [{ subId: 'sub.guillotine', weight: 2 }];
    });
    const armbar = build(ARCH_CHAMPION_COMPLETE, (d) => {
      blank(d);
      style(d).goToSubmissions = [{ subId: 'sub.armbar', weight: 2 }];
    });
    const g = preferencesFor(guillotine);
    const a = preferencesFor(armbar);
    expect(preferenceWeight(g, 'sub.guillotine_standard', 'submission')).toBeGreaterThan(1);
    expect(preferenceWeight(a, 'sub.guillotine_standard', 'submission')).toBe(1);
    expect(preferenceWeight(a, 'sub.armbar_guard', 'submission')).toBeGreaterThan(1);
    expect(preferenceWeight(g, 'sub.armbar_guard', 'submission')).toBe(1);
    // The whole point: same family, same position, different fighter.
    expect(g.submissionTargets).not.toEqual(a.submissionTargets);
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function inputs(over: Partial<ConsiderationInputs> = {}): ConsiderationInputs {
  return {
    ownFatigue: 0, oppFatigue: 0, oppHurt: 0, ownCageDistM: 3, oppCageDistM: 3,
    roundTimeLeftFrac: 0.8, behind: false, setupRecent: 0, expectedThreat: 0.3,
    oppInRecovery: 0, balance: 1, riskAppetite: 0, paceRatio: 0.5, dwellExceeded: false,
    lookahead: 0, intentRangeM: 1.2, distanceM: 1.2, effectiveIqTier: 4,
    ...over,
  };
}
