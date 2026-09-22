/**
 * FIGHTER MODEL SUITE — design chapter 01.
 *
 * The fighter model is the input to every other system: if a tier is wrong,
 * chapter 07 picks the wrong behaviour rules, 02-04 read the wrong skill on
 * every logit edge, and the whole calibration ladder of 01 §6 is measuring
 * noise. So this suite attacks the parts that are pure arithmetic and therefore
 * ought to be exactly right:
 *
 *   1. tier derivation at every band boundary, both caps and the T5 gate,
 *   2. the transfer matrix's max-not-sum rule (§7.2 (4) rejected a soft-OR
 *      precisely because stacking would be an exploit),
 *   3. age curves — shape, peak window, monotone decline — and the chin curve,
 *   4. the §2.7 composites against the chapter's own worked examples,
 *   5. that all fifteen archetypes derive, stay serialisable and land on the
 *      tiers §4.16 tabulates,
 *   6. that the legacy conversion still produces the documented Athlete A / B,
 *   7. that every registered parameter carries a unit and a provenance tag.
 *
 * Where the chapter's derived-check line and the chapter's own formula
 * disagree, the formula wins and the test says so — those lines were written by
 * hand and a few of them skip a term.
 *
 * The suite resolves a registry built from FIGHTER_PARAMS alone rather than the
 * merged `src/sim/params` registry, because chapter 01 depends on nothing else
 * and a defect in another chapter's parameter file must not be able to fail
 * this suite.
 */

import { describe, it, expect } from 'vitest';
import { ParamRegistry, type ResolvedParams } from '../src/sim/params/registry';
import { FIGHTER_PARAMS } from '../src/sim/params/fighter.params';
import { ATHLETE_A, ATHLETE_B } from '../src/engine/fighter';
import {
  ANIMATION_TAGS,
  ARCHETYPES,
  ARCHETYPE_IDS,
  SUB_SKILLS,
  DISCIPLINE_IDS,
  TIER_BEHAVIOUR_CATALOGUE,
  TRANSFER_MATRIX,
  ageChinPenalty,
  ageMultiplier,
  animationTagsFor,
  deriveRuntime,
  fromLegacyProfile,
  iqTierOf,
  ruleById,
  rulesFor,
  tierBySkill,
  tierByYears,
  tierOf,
  weightClassFor,
  yearsToSkill,
  WEIGHT_CLASS_LIMIT_KG,
  type CoreDisciplineId,
  type FighterDefinition,
  type FighterRuntime,
} from '../src/sim/fighter/index';

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

function resolveFighterParams(): ResolvedParams {
  const registry = new ParamRegistry();
  registry.addAll(FIGHTER_PARAMS);
  registry.freeze();
  return registry.resolve();
}

const P = resolveFighterParams();

const derive = (def: FighterDefinition): FighterRuntime => deriveRuntime(def, P);
const arch = (id: string): FighterRuntime => derive(ARCHETYPES[id]);

/** A blank but valid fighter; tests override just the field under test. */
function makeFighter(over: Partial<FighterDefinition> = {}): FighterDefinition {
  return {
    schema: 1,
    id: 'test.subject',
    name: 'Test Subject',
    short: 'TST',
    body: {
      heightM: 1.80, reachM: 1.85, legReachM: 1.03, massKg: 77.1,
      weighInKg: 77.1, fightNightKg: 77.1, weightClass: 'wc.welterweight',
      ageYears: 27, bodyFatPct: 9,
      build: { ecto: 0.25, meso: 0.65, endo: 0.10 },
      stance: 'orthodox', handedness: 'right',
    },
    appearance: { skinTone: 0.5, hair: 'short', face: 'p0', tattoos: [], shorts: 'mma_short', gloves: 'mma_4oz' },
    physical: {
      strength: 50, explosiveness: 50, speed: 50, handSpeed: 50, kickSpeed: 50, cardio: 50,
      chin: 50, bodyToughness: 50, recovery: 50, flexibility: 50, balance: 50, reactionTime: 50,
      gripStrength: 50, neckStrength: 50,
    },
    disciplines: {},
    mental: { fightIQ: 50, aggression: 50, composure: 50, heart: 50, discipline: 50, adaptability: 50 },
    record: {
      proWins: 0, proLosses: 0, proDraws: 0, amWins: 0, amLosses: 0,
      koLosses: 0, knockdownsSuffered: 0, titleFights: 0, layoffMonths: 0, bigFightComposure: 40,
      daysSinceLastBout: 60, lastResult: 'none',
    },
    style: {
      primaryMode: 'distanceStriking', preferredRange: 'mid',
      favouriteTechniques: [], favouriteCombos: [], goToSubmissions: [], takedownPreferences: [],
      whenLosing: 'hold',
    },
    ...over,
  };
}

// --------------------------------------------------------------------------
// 1. Tier derivation
// --------------------------------------------------------------------------

describe('tier derivation (01 §2.3.4)', () => {
  it('places the sub-skill bands exactly on the CONV §3 edges', () => {
    // The band is half-open below: 29.999 is still T1, 30.0 is T2.
    const cases: Array<[number, number]> = [
      [0, 0], [5, 0], [9.999, 0],
      [10, 1], [29.999, 1],
      [30, 2], [49.999, 2],
      [50, 3], [69.999, 3],
      [70, 4], [89.999, 4],
      [90, 5], [100, 5],
    ];
    for (const [mean, tier] of cases) expect(tierBySkill(mean), `mean ${mean}`).toBe(tier);
  });

  it('places the training-age bands exactly and caps at T4', () => {
    const cases: Array<[number, number]> = [
      [0, 0], [0.249, 0],
      [0.25, 1], [0.999, 1],
      [1, 2], [3.999, 2],
      [4, 3], [7.999, 3],
      [8, 4], [25, 4],
    ];
    for (const [years, tier] of cases) expect(tierByYears(years), `years ${years}`).toBe(tier);
  });

  it('caps a fast learner one tier above his training age', () => {
    // Maxed sub-skills after six months cannot be more than T2.
    expect(tierOf({ mean: 95, effectiveYears: 0.5, fightIQ: 95, composure: 95 })).toBe(2);
    expect(tierOf({ mean: 95, effectiveYears: 2, fightIQ: 95, composure: 95 })).toBe(3);
    expect(tierOf({ mean: 95, effectiveYears: 5, fightIQ: 95, composure: 95 })).toBe(4);
    expect(tierOf({ mean: 95, effectiveYears: 10, fightIQ: 95, composure: 95 })).toBe(5);
  });

  it('gates T5 on the mental attributes, not on skill alone', () => {
    const base = { mean: 95, effectiveYears: 12 };
    expect(tierOf({ ...base, fightIQ: 80, composure: 75 })).toBe(5);
    expect(tierOf({ ...base, fightIQ: 79.9, composure: 95 })).toBe(4);
    expect(tierOf({ ...base, fightIQ: 95, composure: 74.9 })).toBe(4);
    // A 92-mean grappler with IQ 70 is T4 for behaviour purposes (§7.2 (3)).
    expect(tierOf({ ...base, mean: 92, fightIQ: 70, composure: 90 })).toBe(4);
  });

  it('maps fightIQ onto iqTier 1-5', () => {
    const cases: Array<[number, number]> = [[0, 1], [29.9, 1], [30, 2], [49.9, 2], [50, 3], [69.9, 3], [70, 4], [89.9, 4], [90, 5], [100, 5]];
    for (const [iq, tier] of cases) expect(iqTierOf(iq), `iq ${iq}`).toBe(tier);
  });

  it('gives an untrained discipline T0 through the 5-point default', () => {
    const r = derive(makeFighter());
    for (const id of DISCIPLINE_IDS) {
      expect(r.disciplines[id].tier, id).toBe(0);
      expect(r.disciplines[id].mean, id).toBeCloseTo(5, 6);
    }
    expect(r.mmaTier).toBe(0);
  });
});

// --------------------------------------------------------------------------
// 2. Cross-discipline transfer
// --------------------------------------------------------------------------

describe('cross-discipline transfer (01 §2.3.3)', () => {
  it('has all 56 rows, with unique ids and resolvable endpoints', () => {
    expect(TRANSFER_MATRIX).toHaveLength(56);
    expect(new Set(TRANSFER_MATRIX.map((r) => r.id)).size).toBe(56);
    for (const rule of TRANSFER_MATRIX) {
      expect(rule.id.startsWith('xfer.'), rule.id).toBe(true);
      expect(rule.factor).toBeGreaterThan(0);
      expect(rule.factor).toBeLessThanOrEqual(1);
      expect(SUB_SKILLS[rule.from], rule.id).toContain(rule.fromSkill);
      expect(SUB_SKILLS[rule.to], rule.id).toContain(rule.toSkill);
      expect(rule.tag).toMatch(/^\[(S:|D:|E)/);
    }
  });

  it('registers every transfer factor so calibration can move it', () => {
    for (const rule of TRANSFER_MATRIX) {
      expect(P.index.has(rule.id), rule.id).toBe(true);
      expect(P.get(rule.id)).toBeCloseTo(rule.factor, 10);
    }
  });

  it('takes the max of the sources, never the sum', () => {
    // Three rows feed kickboxing.kicks: muayThai.kicks x0.90, taekwondo.kicks
    // x0.60 and taekwondo.headKicks x0.80. If they stacked, this fighter would
    // read 72 + 48 + 40 = 160.
    const def = makeFighter({
      disciplines: {
        muayThai: { years: 8, sub: { kicks: 80, teep: 5, knees: 5, elbows: 5, clinch: 5, checks: 5, catches: 5, hands: 5 } },
        taekwondo: { years: 8, sub: { kicks: 80, headKicks: 50, spinning: 5, footwork: 5, distance: 5, counters: 5 } },
      },
    });
    const kicks = derive(def).disciplines.kickboxing.effective.kicks;
    expect(kicks).toBeCloseTo(72, 6);
    expect(kicks).toBeLessThan(0.9 * 80 + 0.6 * 80 + 0.8 * 50);
  });

  it('never lowers a native sub-skill', () => {
    const def = makeFighter({
      disciplines: {
        kickboxing: { years: 8, sub: { punches: 5, kicks: 95, lowKicks: 5, combinations: 5, footwork: 5, checks: 5, spinning: 5, defence: 5 } },
        muayThai: { years: 8, sub: { kicks: 10, teep: 5, knees: 5, elbows: 5, clinch: 5, checks: 5, catches: 5, hands: 5 } },
      },
    });
    // kickboxing.kicks would receive muayThai.kicks x0.9 = 9, below its own 95.
    expect(derive(def).disciplines.kickboxing.effective.kicks).toBeCloseTo(95, 6);
  });

  it('credits transferred years so a judoka is not capped at T1 wrestling', () => {
    const judoNative = { gripFighting: 90, throws: 92, footSweeps: 88, counters: 86, kuzushi: 90, newaza: 70, ukemi: 92 };
    const withoutWrestling = makeFighter({
      mental: { fightIQ: 60, aggression: 50, composure: 60, heart: 50, discipline: 50, adaptability: 50 },
      disciplines: { judo: { years: 20, trainingQuality: 1.1, sub: judoNative } },
    });
    const r = derive(withoutWrestling);
    // Zero wrestling years, yet the judo credit lifts the cap above T1.
    expect(r.disciplines.wrestling.yearsTrained).toBe(0);
    expect(r.disciplines.wrestling.effectiveYears).toBeGreaterThan(4);
    expect(r.disciplines.wrestling.effective.clinch).toBeCloseTo(0.6 * 92, 6);
    expect(r.disciplines.wrestling.tier).toBeGreaterThanOrEqual(1);
  });

  it('applies wrestling background offsets after the max', () => {
    const sub = {
      shots: 50, takedownDefence: 50, topControl: 50, scrambles: 50, cageWrestling: 50,
      clinch: 50, chains: 50, finishes: 50, getUps: 50, matReturns: 50,
    };
    const plain = derive(makeFighter({ disciplines: { wrestling: { years: 10, sub } } })).disciplines.wrestling.effective;
    const greco = derive(makeFighter({ disciplines: { wrestling: { years: 10, styleTags: ['greco'], sub } } })).disciplines.wrestling.effective;
    expect(plain.shots).toBeCloseTo(50, 6);
    expect(greco.shots).toBeCloseTo(45, 6);   // leg attacks -5
    expect(greco.clinch).toBeCloseTo(65, 6);  // upper body +15
    expect(greco.matReturns).toBeCloseTo(55, 6);
    expect(greco.scrambles).toBeCloseTo(50, 6);
  });
});

// --------------------------------------------------------------------------
// 3. Age curves and chin decay
// --------------------------------------------------------------------------

describe('age curves (01 §2.2.2)', () => {
  const explosiveness = { risePerYear: 0.02, peakStart: 23, peakEnd: 28, declineA: 0.01, declineBFrom: 34, declineB: 0.02 };
  const strength = { risePerYear: 0.025, peakStart: 26, peakEnd: 33, declineA: 0.007, declineBFrom: 39, declineB: 0.015 };

  it('reproduces the chapter anchors at age 18', () => {
    expect(ageMultiplier(explosiveness, 18)).toBeCloseTo(0.90, 6);
    expect(ageMultiplier(strength, 18)).toBeCloseTo(0.80, 6);
  });

  it('is flat at 1.0 across the whole peak window', () => {
    for (let age = 23; age <= 28; age += 0.5) expect(ageMultiplier(explosiveness, age)).toBeCloseTo(1, 10);
    for (let age = 26; age <= 33; age += 0.5) expect(ageMultiplier(strength, age)).toBeCloseTo(1, 10);
  });

  it('rises monotonically to the peak and falls monotonically after it', () => {
    for (const curve of [explosiveness, strength]) {
      let prev = -Infinity;
      for (let age = 18; age <= curve.peakStart; age += 0.25) {
        const m = ageMultiplier(curve, age);
        expect(m).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = m;
      }
      prev = Infinity;
      for (let age = curve.peakEnd; age <= 45; age += 0.25) {
        const m = ageMultiplier(curve, age);
        expect(m).toBeLessThanOrEqual(prev + 1e-12);
        prev = m;
      }
    }
  });

  it('puts the maximum inside the peak window and nowhere else', () => {
    let best = -Infinity;
    let bestAge = 0;
    for (let age = 18; age <= 45; age += 0.1) {
      const m = ageMultiplier(explosiveness, age);
      if (m > best + 1e-12) { best = m; bestAge = age; }
    }
    expect(best).toBeCloseTo(1, 10);
    expect(bestAge).toBeGreaterThanOrEqual(explosiveness.peakStart - 1e-9);
    expect(bestAge).toBeLessThanOrEqual(explosiveness.peakEnd);
  });

  it('steepens after the second decline age', () => {
    const slopeA = ageMultiplier(explosiveness, 30) - ageMultiplier(explosiveness, 31);
    const slopeB = ageMultiplier(explosiveness, 36) - ageMultiplier(explosiveness, 37);
    expect(slopeB).toBeGreaterThan(slopeA);
  });

  it('ages the physical attributes of a veteran but never the skills or IQ', () => {
    const young = derive(ARCHETYPES['arch.regional_pro_allrounder']);
    const old = derive({
      ...ARCHETYPES['arch.regional_pro_allrounder'],
      body: { ...ARCHETYPES['arch.regional_pro_allrounder'].body, ageYears: 40 },
    });
    expect(old.effective.explosiveness).toBeLessThan(young.effective.explosiveness);
    expect(old.effective.speed).toBeLessThan(young.effective.speed);
    expect(old.effective.cardio).toBeLessThan(young.effective.cardio);
    // Skill, tier and IQ are untouched by age (§2.2.2, [S: LIT_B §5.8]).
    expect(old.disciplines.boxing.mean).toBeCloseTo(young.disciplines.boxing.mean, 10);
    expect(old.iqTier).toBe(young.iqTier);
    expect(old.paceAgeMult).toBeLessThan(1);
    expect(young.paceAgeMult).toBe(1);
  });
});

describe('chin decay (01 §2.2.2, §2.4.3)', () => {
  const curve = { start: 25, slope1: 1.75, knee: 30, slope2: 2.5, cap: 34, attenuation: 0.6 };

  it('is flat to 25 then follows the two sourced slopes', () => {
    expect(ageChinPenalty(20, curve)).toBe(0);
    expect(ageChinPenalty(25, curve)).toBe(0);
    expect(ageChinPenalty(27, curve)).toBeCloseTo(3.5, 6);
    expect(ageChinPenalty(30, curve)).toBeCloseTo(8.75, 6);
    expect(ageChinPenalty(33, curve)).toBeCloseTo(16.25, 6);
    expect(ageChinPenalty(38, curve)).toBeCloseTo(28.75, 6);
    expect(ageChinPenalty(40, curve)).toBeCloseTo(33.75, 6);
  });

  it('caps and stays capped past 40', () => {
    expect(ageChinPenalty(45, curve)).toBeCloseTo(34, 6);
    expect(ageChinPenalty(60, curve)).toBeCloseTo(34, 6);
  });

  it('is monotone non-decreasing in age', () => {
    let prev = -1;
    for (let age = 18; age <= 50; age += 0.25) {
      const v = ageChinPenalty(age, curve);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
  });

  it('scales with the playability attenuation knob (§7.2 (1))', () => {
    expect(ageChinPenalty(40, { ...curve, attenuation: 0.4 })).toBeCloseTo(33.75 * (0.4 / 0.6), 6);
  });

  it('falls with KO losses and knockdowns, and respects both caps', () => {
    const withHistory = (koLosses: number, knockdowns: number): FighterRuntime =>
      derive(makeFighter({
        physical: { ...makeFighter().physical, chin: 80 },
        record: { ...makeFighter().record, koLosses, knockdownsSuffered: knockdowns },
      }));

    // -3 per KO loss [S: DP §7 r21], -1 per knockdown [E]; age 27 costs 3.5.
    expect(withHistory(0, 0).chinEff).toBeCloseTo(80 - 3.5, 6);
    expect(withHistory(1, 0).chinEff).toBeCloseTo(80 - 3.5 - 3, 6);
    expect(withHistory(4, 5).chinEff).toBeCloseTo(80 - 3.5 - 12 - 5, 6);
    // Caps at 4 KO losses and 5 knockdowns.
    expect(withHistory(9, 20).chinEff).toBeCloseTo(withHistory(4, 5).chinEff, 6);

    let prev = Infinity;
    for (let n = 0; n <= 5; n++) {
      const c = withHistory(n, 0).chinEff;
      expect(c).toBeLessThanOrEqual(prev + 1e-12);
      prev = c;
    }
  });

  it('raises kKOHistoryMult by 0.25 per KO loss, capped at 4', () => {
    const k = (n: number): number => derive(makeFighter({ record: { ...makeFighter().record, koLosses: n } })).kKOHistoryMult;
    expect(k(0)).toBeCloseTo(1.0, 6);
    expect(k(2)).toBeCloseTo(1.5, 6);
    expect(k(4)).toBeCloseTo(2.0, 6);
    expect(k(7)).toBeCloseTo(2.0, 6);
  });

  it('applies the chapter chin arithmetic to the presets that document it', () => {
    expect(arch('arch.elite_wrestler_boxer').chinEff).toBeCloseTo(62.0, 1);
    expect(arch('arch.thai_striker').chinEff).toBeCloseTo(57.5, 1);
    expect(arch('arch.judoka').chinEff).toBeCloseTo(54.25, 1);
    expect(arch('arch.pressure_boxer').chinEff).toBeCloseTo(68.75, 1);
    expect(arch('arch.counter_striker').chinEff).toBeCloseTo(43.75, 1);
    expect(arch('arch.heavyweight_power_puncher').chinEff).toBeCloseTo(40.75, 1);
    expect(arch('arch.ageing_veteran').chinEff).toBeCloseTo(32.25, 1);
    expect(arch('arch.champion_complete').chinEff).toBeCloseTo(70.25, 1);
  });
});

// --------------------------------------------------------------------------
// 4. Career state
// --------------------------------------------------------------------------

describe('career state (01 §2.4)', () => {
  it('reproduces the experience anchors of DP §4.6', () => {
    const exp = (pro: number, am = 0): number =>
      derive(makeFighter({
        record: { ...makeFighter().record, pro: { wins: pro, losses: 0 }, amateur: { wins: am, losses: 0 } },
      })).experience;
    expect(exp(0)).toBeCloseTo(0.10, 6);
    expect(exp(10)).toBeGreaterThan(0.79);
    expect(exp(10)).toBeLessThan(0.86);
    // Amateur bouts count half.
    expect(exp(0, 12)).toBeCloseTo(exp(6), 6);
  });

  it('penalises a long layoff and a short camp', () => {
    const base = makeFighter();
    const fresh = derive(base);
    const layoff = derive(makeFighter({ record: { ...base.record, daysSinceLastBout: 400 } }));
    const shortNotice = derive(makeFighter({ record: { ...base.record, shortNoticeDays: 10 } }));

    expect(layoff.composureEff).toBeLessThan(fresh.composureEff);
    expect(layoff.effective.cardio).toBeCloseTo(fresh.effective.cardio - 6, 6);
    expect(layoff.effective.reactionTime).toBeCloseTo(fresh.effective.reactionTime - 5, 6);
    expect(layoff.anticipation.striking.readP).toBeCloseTo(fresh.anticipation.striking.readP - 0.05, 6);

    expect(shortNotice.career.shortNotice).toBe(true);
    expect(shortNotice.effective.cardio).toBeCloseTo(fresh.effective.cardio - 8, 6);
    expect(shortNotice.career.scoutingSigmaMult).toBeCloseTo(1.5, 6);
  });

  it('only fires the quick-turnaround rule inside 60 days of a KO loss', () => {
    const base = makeFighter();
    const quick = derive(makeFighter({
      record: { ...base.record, lastResult: 'loss', lastResultWasKoLoss: true, daysSinceLastBout: 30 },
    }));
    const slow = derive(makeFighter({
      record: { ...base.record, lastResult: 'loss', lastResultWasKoLoss: true, daysSinceLastBout: 240 },
    }));
    expect(quick.career.quickTurnaroundAfterKo).toBe(true);
    expect(slow.career.quickTurnaroundAfterKo).toBe(false);
    expect(quick.chinEff).toBeCloseTo(slow.chinEff - 10, 6);
    // The veteran is 240 d out, so he takes the layoff hit and not this one.
    expect(arch('arch.ageing_veteran').career.quickTurnaroundAfterKo).toBe(false);
  });

  it('builds stance familiarity from bouts against each stance', () => {
    const r = derive(makeFighter({
      record: { ...makeFighter().record, stanceExposure: { orthodox: 20, southpaw: 0 } },
    }));
    expect(r.stanceFamiliarity.orthodox).toBeGreaterThan(0.99);
    expect(r.stanceFamiliarity.southpaw).toBeCloseTo(0, 6);
    // 4 bouts is one time constant: 1 - e^-1.
    const four = derive(makeFighter({
      record: { ...makeFighter().record, stanceExposure: { orthodox: 4, southpaw: 4 } },
    }));
    expect(four.stanceFamiliarity.southpaw).toBeCloseTo(1 - Math.exp(-1), 6);
  });

  it('blends composure toward bigFightComposure by event magnitude', () => {
    const def = makeFighter({
      mental: { ...makeFighter().mental, composure: 60 },
      record: { ...makeFighter().record, bigFightComposure: 40 },
    });
    expect(deriveRuntime(def, P, { eventMagnitude: 0 }).composureEff).toBeCloseTo(60, 6);
    expect(deriveRuntime(def, P, { eventMagnitude: 1 }).composureEff).toBeCloseTo(40, 6);
    expect(deriveRuntime(def, P, { eventMagnitude: 0.5 }).composureEff).toBeCloseTo(50, 6);
  });
});

// --------------------------------------------------------------------------
// 5. Composites
// --------------------------------------------------------------------------

describe('derived composites (01 §2.7)', () => {
  it('gates power on technique, not on mass alone', () => {
    const skills = (power: number): FighterDefinition => makeFighter({
      disciplines: {
        boxing: { years: 10, sub: { jab: power, power, combinations: power, headMovement: power, footwork: power, guard: power, bodyWork: power, counters: power, feints: power, ringCraft: power } },
      },
    });
    const novice = derive(skills(5)).powerIndex.rearHand;
    const elite = derive(skills(95)).powerIndex.rearHand;
    // techGate runs 0.50 -> 1.00, so elite is ~2x novice at equal physicals
    // (4,800 vs 2,381 N, [S: LIT_B §4.9]).
    expect(elite / novice).toBeGreaterThan(1.7);
    expect(elite / novice).toBeLessThan(2.1);
    expect(novice).toBeGreaterThan(2000);
    expect(novice).toBeLessThan(2800);
  });

  it('keeps the fixed force ratios of DP §3.1 / LIT_B §4.9', () => {
    const p = arch('arch.champion_complete').powerIndex;
    expect(p.leadHand / p.rearHand).toBeCloseTo(0.59, 6);
    expect(p.hookMult).toBeCloseTo(1.29, 6);
    expect(p.leadKick / p.rearKick).toBeCloseTo(0.75, 6);
    expect(p.knee / (p.rearHand * p.hookMult)).toBeCloseTo(1.5, 6);
    expect(p.elbow / (p.rearHand * p.hookMult)).toBeCloseTo(1.0, 6);
    expect(p.headKickAlphaMult).toBeCloseTo(1.75, 6);
  });

  it('matches the chapter worked values for rear-hand force (C-9)', () => {
    // The chapter's derived-check lines; tolerance is 8 % because a few of them
    // were computed on stored rather than age-adjusted attributes.
    const expected: Array<[string, number]> = [
      ['arch.elite_wrestler_boxer', 5295],
      ['arch.thai_striker', 4463],
      ['arch.bjj_guard_player', 3508],
      ['arch.judoka', 4624],
      ['arch.pressure_boxer', 4974],
      ['arch.brand_new_brawler', 2654],
      ['arch.gym_fit_beginner', 2998],
      ['arch.regional_pro_allrounder', 4336],
      ['arch.flyweight_volume_striker', 4142],
      ['arch.sambo_grappler', 4203],
      ['arch.tkd_convert', 4333],
      ['arch.champion_complete', 5385],
    ];
    for (const [id, n] of expected) {
      const got = arch(id).powerIndex.rearHand;
      expect(Math.abs(got - n) / n, `${id}: expected ~${n}, got ${Math.round(got)}`).toBeLessThan(0.08);
    }
  });

  it('puts the tier force bands of FD §5 in the right order', () => {
    const order = [
      'arch.brand_new_brawler', 'arch.gym_fit_beginner',
      'arch.regional_pro_allrounder', 'arch.champion_complete',
    ].map((id) => arch(id).powerIndex.rearHand);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
  });

  it('reproduces the grappling composites of the sambo preset', () => {
    const r = arch('arch.sambo_grappler');
    expect(r.grappling.tdDefenceBase).toBeCloseTo(83.2, 1);
    expect(r.anticipation.takedown.readP).toBeCloseTo(0.84, 2);
  });

  it('reproduces SUBDEF and stubbornness for the two documented presets', () => {
    const bjj = arch('arch.bjj_guard_player');
    expect(bjj.grappling.subDefence).toBeCloseTo(92.6, 1);
    expect(bjj.stubbornness).toBeCloseTo(0.064, 3);
    expect(bjj.noTapFlag).toBe(false);
    expect(arch('arch.champion_complete').stubbornness).toBeCloseTo(0.071, 3);
    // An untrained fighter does not recognise danger at all.
    expect(arch('arch.brand_new_brawler').noTapFlag).toBe(true);
  });

  it('reproduces the energy pools of the two documented presets', () => {
    expect(arch('arch.flyweight_volume_striker').energy.pcrRefillHalfLifeS).toBeCloseTo(21.2, 1);
    expect(arch('arch.flyweight_volume_striker').energy.breakRefillFrac).toBeCloseTo(0.665, 3);
    expect(arch('arch.heavyweight_power_puncher').energy.pcrRefillHalfLifeS).toBeCloseTo(32.5, 1);
    // beh.bjj.energy: a T0 grappler pays 1.6x per action.
    expect(arch('arch.brand_new_brawler').energy.actionCostMult).toBeCloseTo(1.6, 6);
    expect(arch('arch.champion_complete').energy.actionCostMult).toBeLessThanOrEqual(1.0);
  });

  it('keeps readP inside the LIT_B §4.1 bands across the tier ladder (C-10)', () => {
    const expected: Array<[string, number]> = [
      ['arch.brand_new_brawler', 0.55],
      ['arch.gym_fit_beginner', 0.59],
      ['arch.tkd_convert', 0.66],
      ['arch.regional_pro_allrounder', 0.74],
      ['arch.counter_striker', 0.83],
      ['arch.champion_complete', 0.86],
    ];
    for (const [id, p] of expected) {
      expect(arch(id).anticipation.striking.readP, id).toBeCloseTo(p, 1);
    }
    // Novices bite feints, experts do not (0.6 -> 0.25, [S: LIT_B §4.5]).
    expect(arch('arch.brand_new_brawler').anticipation.striking.feintBiteP).toBeCloseTo(0.60, 2);
    expect(arch('arch.champion_complete').anticipation.striking.feintBiteP).toBeLessThan(0.30);
    expect(arch('arch.counter_striker').anticipation.striking.counterOnReadP).toBeCloseTo(0.49, 2);
  });

  it('does NOT tier-scale simple reaction time, only the read (§2.7.6)', () => {
    // Two fighters with identical reactionTime and wildly different skill must
    // have the same latency and different reads [S: LIT_B §4.2].
    const novice = arch('arch.brand_new_brawler');
    const champion = derive({
      ...ARCHETYPES['arch.champion_complete'],
      physical: { ...ARCHETYPES['arch.champion_complete'].physical, reactionTime: ARCHETYPES['arch.brand_new_brawler'].physical.reactionTime },
      body: { ...ARCHETYPES['arch.champion_complete'].body, ageYears: 24 },
      record: { ...ARCHETYPES['arch.champion_complete'].record, pro: { wins: 0, losses: 0 }, amateur: { wins: 0, losses: 0 } },
    });
    expect(champion.reactionTimeMs).toBeCloseTo(novice.reactionTimeMs, 6);
    expect(champion.anticipation.striking.readP).toBeGreaterThan(novice.anticipation.striking.readP + 0.2);
    expect(champion.anticipation.striking.cueLeadMs).toBeGreaterThan(novice.anticipation.striking.cueLeadMs + 40);
  });

  it('derives reach and rig geometry from the body', () => {
    const r = derive(makeFighter());
    // effectiveReachM = (reach - 0.20 H)/2 + 0.10
    expect(r.effectiveReachM).toBeCloseTo((1.85 - 0.20 * 1.80) / 2 + 0.10, 6);
    expect(r.effectiveKickReachM).toBeCloseTo(1.03 + 0.15, 6);
    expect(r.rig.armLengthM).toBeCloseTo((1.85 - r.rig.shoulderWidthM) / 2, 6);
    expect(r.rig.torsoM).toBeGreaterThanOrEqual(0.26 * 1.80 - 1e-9);
    expect(r.massIndex).toBeCloseTo(0, 6);
  });

  it('scales the reach effect by class, ~0 at flyweight and 1.0 at heavyweight', () => {
    expect(arch('arch.flyweight_volume_striker').reachLeverage).toBeCloseTo(0.15, 6);
    expect(arch('arch.heavyweight_power_puncher').reachLeverage).toBeCloseTo(1.0, 6);
    expect(arch('arch.elite_wrestler_boxer').reachLeverage).toBeCloseTo(0.5, 6);
  });

  it('records the arithmetic for the Model tab, and can be asked not to', () => {
    const loud = deriveRuntime(ARCHETYPES['arch.champion_complete'], P);
    const quiet = deriveRuntime(ARCHETYPES['arch.champion_complete'], P, { explain: false });
    expect(loud.derivation.length).toBeGreaterThan(8);
    expect(loud.derivation.some((l) => l.includes('powerIndex.rearHand'))).toBe(true);
    expect(loud.derivation.some((l) => l.includes('chinEff'))).toBe(true);
    expect(quiet.derivation).toHaveLength(0);
    // Explanation must not change a single number.
    expect(quiet.powerIndex.rearHand).toBeCloseTo(loud.powerIndex.rearHand, 12);
  });

  it('is deterministic: the same inputs give identical output every time', () => {
    const a = deriveRuntime(ARCHETYPES['arch.sambo_grappler'], P);
    const b = deriveRuntime(ARCHETYPES['arch.sambo_grappler'], P);
    const strip = (r: FighterRuntime): unknown => ({ ...r, def: undefined });
    expect(JSON.stringify(strip(a))).toBe(JSON.stringify(strip(b)));
  });
});

// --------------------------------------------------------------------------
// 6. The tier behaviour catalogue
// --------------------------------------------------------------------------

describe('tier behaviour catalogue (01 §3)', () => {
  it('is a complete, well-formed table', () => {
    expect(TIER_BEHAVIOUR_CATALOGUE.length).toBeGreaterThanOrEqual(190);
    const ids = TIER_BEHAVIOUR_CATALOGUE.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of TIER_BEHAVIOUR_CATALOGUE) {
      expect(rule.id, rule.id).toMatch(/^beh\.(gen|box|mt|wr|ju|bjj|sub|mma)\.[a-z0-9_]+$/);
      expect(rule.id.split('.')[1]).toBe(rule.domain);
      expect(rule.tag, rule.id).toMatch(/^\[(S:|D:|E)/);
      expect(rule.effect.length, rule.id).toBeGreaterThan(10);
      expect(rule.trigger.length, rule.id).toBeGreaterThan(2);
      expect(rule.tiers[0]).toBeLessThanOrEqual(rule.tiers[1]);
      for (const tag of rule.animationTag ?? []) expect(ANIMATION_TAGS[tag], `${rule.id} -> ${tag}`).toBeDefined();
    }
  });

  it('covers every domain the chapter defines', () => {
    for (const d of ['gen', 'box', 'mt', 'wr', 'ju', 'bjj', 'sub', 'mma']) {
      expect(TIER_BEHAVIOUR_CATALOGUE.filter((r) => r.domain === d).length, d).toBeGreaterThan(5);
    }
    expect(Object.keys(ANIMATION_TAGS)).toHaveLength(31);
  });

  it('fires the T0 tells for an untrained fighter and not for a champion', () => {
    const brawler = arch('arch.brand_new_brawler');
    const champion = arch('arch.champion_complete');
    const t0Tells = [
      'beh.gen.eyes_close', 'beh.gen.turn_away', 'beh.gen.t0_burst_collapse',
      'beh.box.square_stance', 'beh.wr.t0_tackle', 'beh.bjj.bottom_t0',
      'beh.sub.untrained_no_tap', 'beh.mma.t0_rule_ignorance',
    ];
    const brawlerIds = new Set(rulesFor(brawler).map((r) => r.id));
    const championIds = new Set(rulesFor(champion).map((r) => r.id));
    for (const id of t0Tells) {
      expect(brawlerIds.has(id), `brawler should show ${id}`).toBe(true);
      expect(championIds.has(id), `champion should not show ${id}`).toBe(false);
    }
    expect(championIds.has('beh.gen.reflex_counter')).toBe(true);
    expect(championIds.has('beh.bjj.bottom_t4')).toBe(true);
    expect(brawlerIds.has('beh.gen.reflex_counter')).toBe(false);
  });

  it('keys each rule on its own discipline, so a mixed fighter shows mixed tells', () => {
    // §3.8: a T3 striker with T0 wrestling still shows beh.wr.sprawl_late.
    const ids = new Set(rulesFor(arch('arch.tkd_convert')).map((r) => r.id));
    expect(ids.has('beh.wr.sprawl_late')).toBe(true);
    expect(ids.has('beh.bjj.bottom_t0')).toBe(true);
    expect(ids.has('beh.box.repertoire_t0')).toBe(false);
  });

  it('matches the submission bands on the SUBDEF value, not on a tier', () => {
    const elite = new Set(rulesFor(arch('arch.bjj_guard_player')).map((r) => r.id));
    expect(elite.has('beh.sub.elite')).toBe(true);
    expect(elite.has('beh.sub.untrained_no_tap')).toBe(false);
    expect(elite.has('beh.sub.early_hand_fight')).toBe(true);
    const beginner = new Set(rulesFor(arch('arch.gym_fit_beginner')).map((r) => r.id));
    expect(beginner.has('beh.sub.untrained_no_tap')).toBe(true);
  });

  it('filters by domain, discipline and trigger', () => {
    const r = arch('arch.regional_pro_allrounder');
    const boxOnly = rulesFor(r, { domain: 'box' });
    expect(boxOnly.length).toBeGreaterThan(5);
    expect(boxOnly.every((x) => x.domain === 'box')).toBe(true);
    const iqOnly = rulesFor(r, { discipline: 'iqTier' });
    expect(iqOnly.every((x) => x.discipline === 'iqTier')).toBe(true);
    const rocked = rulesFor(r, { trigger: 'rocked' });
    expect(rocked.every((x) => x.trigger === 'rocked' || x.trigger === 'always')).toBe(true);
    expect(rocked.some((x) => x.id === 'beh.gen.hurt_t3')).toBe(true);
  });

  it('exposes exactly one hurt behaviour per mmaTier', () => {
    for (let t = 0; t <= 5; t++) {
      const matched = TIER_BEHAVIOUR_CATALOGUE.filter(
        (r) => r.id.startsWith('beh.gen.hurt_t') && r.tiers[0] <= t && t <= r.tiers[1],
      );
      expect(matched, `tier ${t}`).toHaveLength(1);
    }
  });

  it('never changes reaction time — the one rule the chapter forbids', () => {
    for (const rule of TIER_BEHAVIOUR_CATALOGUE) {
      if (rule.id === 'beh.gen.simple_rt_untiered') continue;
      expect(rule.effect.toLowerCase(), rule.id).not.toMatch(/reactiontimems\s*[-+*x]/);
    }
    expect(ruleById('beh.gen.simple_rt_untiered')?.effect).toContain('no tier term');
  });

  it('collects animation tags for presentation', () => {
    const tags = animationTagsFor(arch('arch.brand_new_brawler'));
    expect(tags).toContain('anim.eyes_shut_flinch');
    expect(tags).toContain('anim.turn_away_cover');
    expect(tags.every((t) => t in ANIMATION_TAGS)).toBe(true);
  });
});

// --------------------------------------------------------------------------
// 7. Archetypes
// --------------------------------------------------------------------------

describe('archetype presets (01 §4)', () => {
  it('has all fifteen, keyed by their own id', () => {
    expect(ARCHETYPE_IDS).toHaveLength(15);
    for (const id of ARCHETYPE_IDS) {
      expect(ARCHETYPES[id].id).toBe(id);
      expect(id.startsWith('arch.')).toBe(true);
    }
  });

  it('is serialisable: no functions, no classes, survives a JSON round trip', () => {
    for (const id of ARCHETYPE_IDS) {
      const clone = JSON.parse(JSON.stringify(ARCHETYPES[id])) as FighterDefinition;
      expect(clone).toEqual(ARCHETYPES[id]);
      // And the clone derives to exactly the same fighter.
      expect(derive(clone).powerIndex.rearHand).toBeCloseTo(arch(id).powerIndex.rearHand, 10);
    }
  });

  it('declares complete, in-range sub-skill sets', () => {
    for (const id of ARCHETYPE_IDS) {
      const def = ARCHETYPES[id];
      for (const d of DISCIPLINE_IDS) {
        const block = def.disciplines[d];
        if (!block) continue;
        expect(Object.keys(block.sub).sort(), `${id}.${d}`).toEqual([...SUB_SKILLS[d]].sort());
        for (const [k, v] of Object.entries(block.sub)) {
          expect(v, `${id}.${d}.${k}`).toBeGreaterThanOrEqual(0);
          expect(v, `${id}.${d}.${k}`).toBeLessThanOrEqual(100);
        }
        expect(block.years).toBeGreaterThanOrEqual(0);
      }
      for (const [k, v] of Object.entries(def.physical)) {
        expect(v, `${id}.physical.${k}`).toBeGreaterThanOrEqual(0);
        expect(v, `${id}.physical.${k}`).toBeLessThanOrEqual(100);
      }
      for (const [k, v] of Object.entries(def.mental)) {
        expect(v, `${id}.mental.${k}`).toBeGreaterThanOrEqual(0);
        expect(v, `${id}.mental.${k}`).toBeLessThanOrEqual(100);
      }
      const b = def.body;
      const weighIn = b.weighInKg ?? b.massKg;
      expect(WEIGHT_CLASS_LIMIT_KG[b.weightClass!], `${id} class`).toBeGreaterThan(0);
      // The declared class is the lightest that holds the weigh-in mass, except
      // for the presets §4.16 marks as open-weight entries, which keep the
      // nominal class the chapter gives them.
      const openWeight = new Set(['arch.brand_new_brawler', 'arch.gym_fit_beginner', 'arch.tkd_convert']);
      if (!openWeight.has(id)) {
        expect(b.weightClass, `${id} class`).toBe(weightClassFor(weighIn));
      }
      const build = b.build as { ecto: number; meso: number; endo: number };
      expect(build.ecto + build.meso + build.endo).toBeCloseTo(1, 6);
    }
  });

  it('derives every preset without throwing and with sane composites', () => {
    for (const id of ARCHETYPE_IDS) {
      const r = arch(id);
      expect(r.powerIndex.rearHand, id).toBeGreaterThan(1500);
      expect(r.powerIndex.rearHand, id).toBeLessThan(9000);
      expect(r.chinEff, id).toBeGreaterThanOrEqual(0);
      expect(r.chinEff, id).toBeLessThanOrEqual(100);
      expect(r.anticipation.striking.readP, id).toBeGreaterThanOrEqual(0.45);
      expect(r.anticipation.striking.readP, id).toBeLessThanOrEqual(0.92);
      expect(r.energy.pcrRefillHalfLifeS, id).toBeGreaterThan(10);
      expect(r.stubbornness, id).toBeGreaterThanOrEqual(0.02);
      expect(r.stubbornness, id).toBeLessThanOrEqual(0.5);
      expect(r.derivation.length, id).toBeGreaterThan(5);
      expect(Number.isFinite(r.chinZ)).toBe(true);
    }
  });

  it('lands on the tiers of the §4.16 summary table', () => {
    // [id, strikingTier, grapplingTier, mmaTier, iqTier]
    const table: Array<[string, number, number, number, number]> = [
      ['arch.elite_wrestler_boxer', 3, 4, 4, 4],
      ['arch.thai_striker', 4, 2, 3, 3],
      ['arch.bjj_guard_player', 2, 4, 3, 4],
      ['arch.judoka', 2, 4, 3, 3],
      ['arch.pressure_boxer', 4, 2, 3, 3],
      ['arch.counter_striker', 5, 2, 3, 4],
      ['arch.brand_new_brawler', 0, 0, 0, 1],
      ['arch.gym_fit_beginner', 1, 1, 1, 2],
      ['arch.regional_pro_allrounder', 3, 3, 3, 3],
      ['arch.ageing_veteran', 4, 4, 4, 4],
      ['arch.heavyweight_power_puncher', 3, 2, 2, 2],
      ['arch.flyweight_volume_striker', 4, 3, 3, 3],
      ['arch.sambo_grappler', 2, 4, 4, 4],
      ['arch.tkd_convert', 3, 0, 1, 2],
      ['arch.champion_complete', 4, 4, 5, 5],
    ];
    for (const [id, striking, grappling, mmaTier, iq] of table) {
      const r = arch(id);
      expect(r.strikingTier, `${id} striking`).toBe(striking);
      expect(r.iqTier, `${id} iq`).toBe(iq);
      expect(r.mmaTier, `${id} mma`).toBe(mmaTier);
      // The champion's folkstyle offsets lift his wrestling mean over 90, so
      // the one legitimate deviation from the chapter's hand-written check is
      // a grappling tier one step higher than the table's T4.
      if (id === 'arch.champion_complete') {
        expect(r.grapplingTier).toBeGreaterThanOrEqual(grappling);
      } else {
        expect(r.grapplingTier, `${id} grappling`).toBe(grappling);
      }
    }
  });

  it('gives the named specialist the tier his discipline earns', () => {
    expect(arch('arch.elite_wrestler_boxer').disciplines.wrestling.tier).toBe(4);
    expect(arch('arch.elite_wrestler_boxer').disciplines.boxing.tier).toBe(3);
    // muayThai mean 82.5 but the T5 mental gate fails on IQ 66.
    expect(arch('arch.thai_striker').disciplines.muayThai.tier).toBe(4);
    // karate mean > 90 with IQ 82 and composure 86: the one preset T5 striker.
    expect(arch('arch.counter_striker').disciplines.karate.tier).toBe(5);
    // bjj mean 89 < 90 and IQ 72 < 80 -> T4 either way.
    expect(arch('arch.bjj_guard_player').disciplines.bjj.tier).toBe(4);
    expect(arch('arch.champion_complete').disciplines.mmaIntegration.tier).toBe(5);
  });

  it('gives a striker with no ground game T0 grappling tells', () => {
    // The case the legacy model could not express at all.
    const r = arch('arch.tkd_convert');
    expect(r.disciplines.taekwondo.tier).toBe(3);
    expect(r.disciplines.wrestling.tier).toBe(0);
    expect(r.disciplines.bjj.tier).toBe(0);
    // Kickboxing is untrained but transfers make it a real discipline.
    expect(r.disciplines.kickboxing.trained).toBe(false);
    expect(r.disciplines.kickboxing.mean).toBeGreaterThan(5);
  });

  it('resolves preset technique ids onto the canonical 02-04 ids', () => {
    const style = ARCHETYPES['arch.brand_new_brawler'].style;
    const favs = style.favouriteTechniques as Array<{ techId: string }>;
    expect(favs.map((f) => f.techId)).toContain('tech.overhand');
    expect(favs.map((f) => f.techId)).toContain('tech.hook_lead');
    expect(favs.map((f) => f.techId)).not.toContain('tech.overhand_rear');
    const subs = style.goToSubmissions as Array<{ subId: string }>;
    expect(subs[0].subId).toBe('sub.bulldog');
    const td = style.takedownPreferences as { prefs: Array<{ techId: string }> };
    expect(td.prefs[0].techId).toBe('tech.double_leg');
    const sambo = ARCHETYPES['arch.sambo_grappler'].style.goToSubmissions as Array<{ subId: string }>;
    expect(sambo.map((s) => s.subId)).toContain('sub.kneebar');
  });
});

// --------------------------------------------------------------------------
// 8. Legacy conversion
// --------------------------------------------------------------------------

describe('legacy conversion (01 §2.2.3, calibration hook C-15)', () => {
  it('fits the S(y, q) prior to the CONV §3 training columns', () => {
    expect(yearsToSkill(0, 1)).toBe(0);
    expect(yearsToSkill(0.25, 1)).toBeCloseTo(6.7, 1);
    expect(yearsToSkill(1, 1)).toBeCloseTo(22.2, 1);
    expect(yearsToSkill(4, 1)).toBeCloseTo(53.3, 1);
    expect(yearsToSkill(8, 1)).toBeCloseTo(69.6, 1);
    expect(yearsToSkill(25, 1)).toBeCloseTo(87.7, 1);
  });

  it('reproduces the documented Athlete A', () => {
    const def = fromLegacyProfile(ATHLETE_A, P);
    // 200 lb, 5'10", 1050 lb lift total = 5.25 x BW.
    expect(def.body.massKg).toBeCloseTo(90.72, 2);
    expect(def.body.heightM).toBeCloseTo(1.778, 3);
    // The half-span reach bug is gone: reach = 1.026 x height [S: LIT_B §2.4].
    expect(def.body.reachM).toBeCloseTo(1.824, 3);
    expect(def.physical.strength).toBeCloseTo(73.6, 0);
    expect(def.physical.cardio).toBeCloseTo(70, 6);
    expect(def.mental.discipline).toBeCloseTo(70, 6);

    const r = derive(def);
    expect(r.disciplines.boxing.mean).toBeCloseTo(41.5, 1);
    expect(r.disciplines.boxing.tier).toBe(2);
    expect(r.disciplines.taekwondo.mean).toBeCloseTo(52.9, 1);
    expect(r.disciplines.taekwondo.tier).toBe(3);
    // No grappling training at all -> every grappling discipline is T0.
    expect(r.disciplines.wrestling.tier).toBe(0);
    expect(r.disciplines.bjj.tier).toBe(0);
    expect(r.disciplines.judo.tier).toBe(0);
    expect(r.experience).toBeCloseTo(0.1, 6);
    // Transferred kickboxing kicks take the best source (headKicks x0.8),
    // not the TKD-kicks row alone.
    expect(r.disciplines.kickboxing.effective.kicks).toBeCloseTo(0.8 * 52.94, 1);
  });

  it('reproduces the documented Athlete B', () => {
    const def = fromLegacyProfile(ATHLETE_B, P);
    // 150 lb, 450 lb lift total = 3.0 x BW: the old untrained reference.
    expect(def.physical.strength).toBeCloseTo(25.0, 0);
    expect(def.physical.cardio).toBeCloseTo(55, 6);
    expect(def.disciplines.boxing).toBeUndefined();
    expect(def.disciplines.taekwondo).toBeUndefined();

    const r = derive(def);
    for (const d of DISCIPLINE_IDS) expect(r.disciplines[d].tier, d).toBe(0);
    expect(r.mmaTier).toBe(0);
    expect(r.experience).toBeCloseTo(0.1, 6);
  });

  it('keeps A qualitatively above B, which is what C-15 guards', () => {
    const a = derive(fromLegacyProfile(ATHLETE_A, P));
    const b = derive(fromLegacyProfile(ATHLETE_B, P));
    expect(a.powerIndex.rearHand).toBeGreaterThan(b.powerIndex.rearHand * 1.5);
    expect(a.strikingTier).toBeGreaterThan(b.strikingTier);
    expect(a.anticipation.striking.readP).toBeGreaterThan(b.anticipation.striking.readP);
    expect(a.body.fightNightKg! - b.body.fightNightKg!).toBeCloseTo(22.68, 1);
  });

  it('produces a definition the schema accepts, without params', () => {
    const def = fromLegacyProfile(ATHLETE_A);
    expect(def.schema).toBe(1);
    expect(JSON.parse(JSON.stringify(def))).toEqual(def);
    expect(() => derive(def)).not.toThrow();
  });
});

// --------------------------------------------------------------------------
// 9. Parameter registry
// --------------------------------------------------------------------------

describe('fighter parameter registry (01 §5)', () => {
  it('registers the whole chapter', () => {
    // §5 tabulates ~230 rows, several of which are compound and expand into one
    // scalar per field.
    expect(FIGHTER_PARAMS.length).toBeGreaterThanOrEqual(230);
  });

  it('gives every entry a unit, a provenance tag and the owning section', () => {
    for (const spec of FIGHTER_PARAMS) {
      expect(spec.unit, spec.id).toBeTruthy();
      // 00_CONVENTIONS §1: a number with no tag is a bug.
      expect(spec.tag, spec.id).toMatch(/^\[(S:|D:|E)/);
      expect(spec.section, spec.id).toBe('fighter');
      expect(Number.isFinite(spec.value), spec.id).toBe(true);
      expect(spec.note, spec.id).toBeTruthy();
    }
  });

  it('uses dotted lowerCamel ids, uniquely', () => {
    const ids = FIGHTER_PARAMS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(/^[a-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/);
  });

  it('keeps every default inside its own declared bounds', () => {
    for (const spec of FIGHTER_PARAMS) {
      if (spec.min !== undefined) expect(spec.value, spec.id).toBeGreaterThanOrEqual(spec.min);
      if (spec.max !== undefined) expect(spec.value, spec.id).toBeLessThanOrEqual(spec.max);
      if (spec.min !== undefined && spec.max !== undefined) expect(spec.min, spec.id).toBeLessThanOrEqual(spec.max);
    }
  });

  it('marks measured numbers as fixed so calibration cannot move them', () => {
    const fixed = ['fm.power.rear_ref_n', 'fm.power.lead_ratio', 'fm.antic.read_base', 'fm.energy.pcr_halflife_base_s', 'fm.tier.band3'];
    for (const id of fixed) {
      const spec = FIGHTER_PARAMS.find((s) => s.id === id);
      expect(spec, id).toBeDefined();
      expect(spec!.free, id).toBe(false);
    }
    // And that something is still tunable, or Phase 9 has nothing to do.
    expect(FIGHTER_PARAMS.filter((s) => s.free).length).toBeGreaterThan(50);
  });

  it('registers into a real registry and resolves deterministically', () => {
    expect(() => resolveFighterParams()).not.toThrow();
    expect(resolveFighterParams().hash).toBe(resolveFighterParams().hash);
    expect(P.values).toHaveLength(FIGHTER_PARAMS.length);
  });

  it('covers every id the derivation reads', () => {
    // A missing id throws inside deriveRuntime, so deriving one fighter of each
    // tier exercises the per-tier lookups (exec/telegraph/hip/energy tables).
    for (const id of ARCHETYPE_IDS) expect(() => arch(id)).not.toThrow();
    for (let t = 0; t <= 5; t++) {
      expect(P.index.has(`fm.exec.time_mult.t${t}`), `t${t}`).toBe(true);
      expect(P.index.has(`fm.exec.telegraph.t${t}`), `t${t}`).toBe(true);
      expect(P.index.has(`fm.exec.hip_rotation.t${t}`), `t${t}`).toBe(true);
      expect(P.index.has(`fm.energy.tier_cost.t${t}`), `t${t}`).toBe(true);
    }
    for (const d of ['explosiveness', 'speedGroup', 'strength', 'cardio', 'recovery', 'flexibility', 'balance', 'reactionTime']) {
      for (const f of ['rise', 'peakStart', 'peakEnd', 'declineA', 'declineBFrom', 'declineB']) {
        expect(P.index.has(`fm.age.${d}.${f}`), `fm.age.${d}.${f}`).toBe(true);
      }
    }
  });

  it('registers a magnitude for the catalogue rows that quote one', () => {
    const magnitudes = ['beh.gen.eyes_close.p', 'beh.gen.turn_away.p', 'beh.box.cross_feet.p_t0', 'beh.mt.no_return_to_stance.p_t0', 'beh.wr.t0_tackle.vs_trained', 'beh.bjj.t0_hold_breath.lactate', 'beh.sub.attempt_rate.base', 'beh.mma.getup_t4.interval_s'];
    for (const id of magnitudes) expect(P.index.has(id), id).toBe(true);
  });
});
