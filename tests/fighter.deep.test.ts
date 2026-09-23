/**
 * DEEP CUSTOMISATION SUITE — design chapter 01 §8.
 *
 * Section 8 adds about forty authorable fields to the fighter schema. Two
 * things have to be true of every one of them, and this suite exists to hold
 * both:
 *
 *   1. **An old fighter still derives to the old numbers.** A saved definition
 *      written before §8 existed must produce a byte-identical runtime. This is
 *      not a nicety — a user's fighter database is on their disk, and a schema
 *      that silently re-rates their fighters has lost their work as surely as
 *      deleting it. `PRE_DEEP_FIGHTER` below is a frozen literal, deliberately
 *      not built from any helper, so that a future edit to `blankFighter` or
 *      the archetypes cannot quietly move the baseline it is testing against.
 *
 *   2. **Every new field measurably changes a derived value, in the documented
 *      direction.** A field the sim does not read is decoration (§8 preamble),
 *      so each one is tested by deriving twice and comparing — never by
 *      asserting a magic constant, which would only prove that the code does
 *      what the code does.
 *
 * The suite resolves the full parameter registry rather than chapter 01's
 * alone, because §8 reads `fm.disc.*`, `fm.injury.*` and `fm.hist.*` and a
 * missing registration must fail here rather than at run time.
 */

import { describe, it, expect } from 'vitest';
import {
  ARCHETYPES, ARCHETYPE_IDS, GRADE_PRIORS, GRADE_RANKS, PARAMS, SPECIALISATIONS,
  SPECIALISATIONS_BY_DISCIPLINE, competitionPriorOf, deriveRuntime, gradePriorOf,
  resolveParams, specialisationById,
  type FighterDefinition, type FighterRuntime,
} from '../src/sim';
import { validateFighter } from '../src/app/store';

const P = resolveParams();

const derive = (def: FighterDefinition): FighterRuntime =>
  deriveRuntime(def, P, { explain: true });

/** Deep clone; a definition is plain JSON by contract (01). */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Everything on the runtime except the definition it was derived from and the
 * derivation strings. Comparing this is how "derives identically" is checked:
 * the derivation lines are allowed to gain a line, the numbers are not allowed
 * to move.
 */
function numbersOf(rt: FighterRuntime): string {
  const { def: _def, derivation: _d, ...rest } = rt;
  return JSON.stringify(rest);
}

// --------------------------------------------------------------------------
// The frozen pre-§8 fighter
// --------------------------------------------------------------------------

/**
 * A complete definition as the schema looked before §8: no per-discipline
 * depth, no overall-experience block, no history, no physique extras.
 *
 * Written out in full rather than generated. The whole value of a
 * compatibility fixture is that it does not move when the code moves.
 */
const PRE_DEEP_FIGHTER: FighterDefinition = Object.freeze({
  schema: 1,
  id: 'fighter.legacy.tomas_vargas',
  name: 'Tomas Vargas',
  short: 'TVA',
  body: {
    heightM: 1.8,
    reachM: 1.85,
    legReachM: 1.04,
    massKg: 84.1,
    weighInKg: 77.1,
    fightNightKg: 84.1,
    weightClass: 'wc.welterweight',
    ageYears: 29,
    bodyFatPct: 9,
    build: { ecto: 0.2, meso: 0.65, endo: 0.15 },
    stance: 'orthodox',
    handedness: 'right',
    dominantLeg: 'right',
    sex: 'male',
  },
  appearance: {
    skinTone: 0.5, hair: 'short', face: 'preset0', tattoos: [],
    shorts: 'mma_short', gloves: 'mma_4oz',
  },
  physical: {
    strength: 70, explosiveness: 68, speed: 62, handSpeed: 66, kickSpeed: 58,
    cardio: 74, chin: 66, bodyToughness: 68, recovery: 70, flexibility: 55,
    balance: 74, reactionTime: 60, gripStrength: 66, neckStrength: 70,
  },
  disciplines: {
    wrestling: {
      years: 12, trainingQuality: 1.05, styleTags: ['folkstyle'],
      sub: {
        shots: 72, takedownDefence: 76, topControl: 70, scrambles: 68, cageWrestling: 70,
        clinch: 66, chains: 68, finishes: 66, getUps: 64, matReturns: 70,
      },
    },
    boxing: {
      years: 6, trainingQuality: 1.0, styleTags: [],
      sub: {
        jab: 62, power: 64, combinations: 58, headMovement: 54, footwork: 60,
        guard: 60, bodyWork: 52, counters: 56, feints: 54, ringCraft: 58,
      },
    },
    bjj: {
      years: 5, trainingQuality: 0.95, styleTags: ['no-gi'],
      sub: {
        guard: 48, passing: 58, topControl: 62, backControl: 58, chokes: 54,
        jointLocks: 46, legLocks: 28, escapes: 56, sweeps: 44, subDefence: 60,
        subAttack: 50, wrestleUps: 64,
      },
    },
    mmaIntegration: {
      years: 7, trainingQuality: 1.0, styleTags: [],
      sub: {
        levelChanges: 70, clinchStriking: 60, cageWork: 68, groundAndPound: 64,
        getUps: 66, transitions: 62, subDefenceUnderStrikes: 60, gameplanExecution: 64,
      },
    },
  },
  mental: {
    fightIQ: 68, aggression: 60, composure: 66, heart: 72, discipline: 70, adaptability: 62,
  },
  record: {
    proWins: 12, proLosses: 3, proDraws: 0, amWins: 5, amLosses: 2,
    koLosses: 1, knockdownsSuffered: 2, titleFights: 0, layoffMonths: 5,
    bigFightComposure: 60,
    pro: {
      wins: 12, losses: 3, draws: 0, noContests: 0,
      koWins: 4, subWins: 3, decWins: 5, koLosses: 1, subLosses: 0, decLosses: 2,
    },
    amateur: { wins: 5, losses: 2 },
    daysSinceLastBout: 150,
    lastResult: 'win',
    lastResultWasKoLoss: false,
    stanceExposure: { orthodox: 12, southpaw: 3 },
    weightCut: { cutPct: 7, regainPct: 9, residualDehydration: 0.01 },
    winStreak: 3,
  },
  style: {
    primaryMode: 'wrestleControl',
    preferredRange: 'mid',
    favouriteTechniques: [{ techId: 'tech.jab', weight: 1.2 }],
    favouriteCombos: [],
    goToSubmissions: [{ subId: 'sub.rnc', weight: 1.2 }],
    takedownPreferences: { prefs: [], setup: 'offCombination', cageBias: 0.7 },
    whenLosing: 'press',
    initiative: 'pressure',
    pressureBias: 65,
    fallbackMode: 'clinchGrind',
    hurtBehaviour: 'clinch',
    losingBehaviour: 'stealRound',
    tiredBehaviour: 'clinchRest',
    stanceSwitching: 5,
    guardStyle: 'highGuard',
  },
}) as FighterDefinition;

/**
 * The exact numbers `PRE_DEEP_FIGHTER` derived to before §8 existed.
 *
 * Captured by running the fixture above through a pristine checkout of the
 * pre-§8 build, not by copying what the current code happens to produce — the
 * distinction is the entire point of the table. Any change to these is a
 * compatibility break, whatever else it is.
 */
const PRE_DEEP_BASELINE = Object.freeze({
  chinEff: 54,
  experience: 0.9587743172446407,
  composureEff: 64.4,
  strikingMean: 57.8,
  grapplingMean: 72,
  mmaMean: 64.70499999999998,
  strikingTier: 3,
  grapplingTier: 4,
  mmaTier: 3,
  rearHandN: 4798.997371407574,
  rearKickN: 3030.3796231027923,
  effectiveReachM: 0.845,
  effectiveKickReachM: 1.19,
  tdDefenceBase: 73.5065303115171,
  subDefence: 59.2,
  cardio: 74,
  recovery: 68.607,
  balance: 74,
});

// --------------------------------------------------------------------------
// 1. Backward compatibility — the hard contract
// --------------------------------------------------------------------------

describe('01 §8 backward compatibility', () => {
  it('derives a pre-§8 definition to exactly its pre-§8 numbers', () => {
    const rt = derive(PRE_DEEP_FIGHTER);
    expect(rt.chinEff).toBeCloseTo(PRE_DEEP_BASELINE.chinEff, 6);
    expect(rt.experience).toBeCloseTo(PRE_DEEP_BASELINE.experience, 10);
    expect(rt.composureEff).toBeCloseTo(PRE_DEEP_BASELINE.composureEff, 6);
    expect(rt.strikingMean).toBeCloseTo(PRE_DEEP_BASELINE.strikingMean, 6);
    expect(rt.grapplingMean).toBeCloseTo(PRE_DEEP_BASELINE.grapplingMean, 6);
    expect(rt.mmaMean).toBeCloseTo(PRE_DEEP_BASELINE.mmaMean, 6);
    expect(rt.strikingTier).toBe(PRE_DEEP_BASELINE.strikingTier);
    expect(rt.grapplingTier).toBe(PRE_DEEP_BASELINE.grapplingTier);
    expect(rt.mmaTier).toBe(PRE_DEEP_BASELINE.mmaTier);
    expect(rt.powerIndex.rearHand).toBeCloseTo(PRE_DEEP_BASELINE.rearHandN, 6);
    expect(rt.powerIndex.rearKick).toBeCloseTo(PRE_DEEP_BASELINE.rearKickN, 6);
    expect(rt.effectiveReachM).toBeCloseTo(PRE_DEEP_BASELINE.effectiveReachM, 10);
    expect(rt.effectiveKickReachM).toBeCloseTo(PRE_DEEP_BASELINE.effectiveKickReachM, 10);
    expect(rt.grappling.tdDefenceBase).toBeCloseTo(PRE_DEEP_BASELINE.tdDefenceBase, 6);
    expect(rt.grappling.subDefence).toBeCloseTo(PRE_DEEP_BASELINE.subDefence, 6);
    expect(rt.effective.cardio).toBeCloseTo(PRE_DEEP_BASELINE.cardio, 6);
    expect(rt.effective.recovery).toBeCloseTo(PRE_DEEP_BASELINE.recovery, 6);
    expect(rt.effective.balance).toBeCloseTo(PRE_DEEP_BASELINE.balance, 6);
  });

  it('leaves every §8 surface at its identity value when nothing is authored', () => {
    const rt = derive(PRE_DEEP_FIGHTER);
    expect(rt.injury.load).toBe(0);
    expect(rt.injury.capabilities).toEqual({ punchPower: 1, kickPower: 1, headKick: 1 });
    expect(rt.experienceDerived).toBeCloseTo(rt.experience, 12);
    for (const d of Object.values(rt.disciplines)) {
      expect(d.rustMult, d.id).toBe(1);
      expect(d.yearsQualityMult, d.id).toBeCloseTo(1, 12);
      expect(d.gradePrior, d.id).toBe(0);
      expect(d.competitionPrior, d.id).toBe(0);
      expect(d.specialisations, d.id).toEqual([]);
    }
  });

  it('is unchanged by writing every §8 field at its documented default', () => {
    // The point of "the default is the identity value of the formula" is that a
    // definition can be *upgraded* in place without re-rating the fighter. If
    // this fails, the creator cannot safely fill in the new fields for a user.
    const upgraded = clone(PRE_DEEP_FIGHTER);
    for (const block of Object.values(upgraded.disciplines)) {
      if (!block) continue;
      block.startAge = 18;
      block.hoursPerWeek = 8;
      block.sessionsPerWeek = 5;
      block.sparringIntensity = 50;
      block.coachQuality = 50;
      block.monthsSinceTrained = 0;
      block.specialisations = [];
      block.grade = { system: 'none', rank: 'none.unranked' };
    }
    upgraded.record.totalRounds = 0;
    upgraded.record.oppositionLevel = 50;
    upgraded.record.mainEvents = 0;
    upgraded.record.warFights = 0;
    upgraded.record.hardSparringYears = 0;
    upgraded.body.naturalWeightKg = upgraded.body.weighInKg;
    upgraded.body.handStrengthSplit = 50;
    upgraded.body.limbAsymmetry = { armPct: 0, legPct: 0 };
    upgraded.history = {
      injuries: [], surgeries: 0,
      weightCutHistory: { hardCuts: 0, worstCutPct: 7, missedWeight: 0 },
      cardioBackground: { sport: 'none', years: 0 },
    };

    expect(numbersOf(derive(upgraded))).toBe(numbersOf(derive(PRE_DEEP_FIGHTER)));
  });

  it('still round-trips through JSON and still validates', () => {
    expect(validateFighter(PRE_DEEP_FIGHTER).ok).toBe(true);
    const round = clone(PRE_DEEP_FIGHTER);
    expect(round).toEqual(PRE_DEEP_FIGHTER);
    expect(numbersOf(derive(round))).toBe(numbersOf(derive(PRE_DEEP_FIGHTER)));
  });
});

// --------------------------------------------------------------------------
// 2. Per-discipline depth (§8.1)
// --------------------------------------------------------------------------

/** `PRE_DEEP_FIGHTER` with one wrestling field changed. */
function withWrestling(patch: Record<string, unknown>): FighterRuntime {
  const def = clone(PRE_DEEP_FIGHTER);
  Object.assign(def.disciplines.wrestling!, patch);
  return derive(def);
}

describe('01 §8.1.1 rust', () => {
  const base = derive(PRE_DEEP_FIGHTER);

  it('does nothing inside the grace period', () => {
    expect(withWrestling({ monthsSinceTrained: 3 }).disciplines.wrestling.rustMult).toBe(1);
  });

  it('decays the art monotonically with time away', () => {
    const months = [6, 12, 24, 60, 120];
    let previous = 1;
    for (const m of months) {
      const rt = withWrestling({ monthsSinceTrained: m });
      const mult = rt.disciplines.wrestling.rustMult;
      expect(mult, `${m} months`).toBeLessThanOrEqual(previous);
      expect(rt.disciplines.wrestling.mean, `${m} months`).toBeLessThan(base.disciplines.wrestling.mean);
      previous = mult;
    }
  });

  it('never decays below the floor, however long the layoff', () => {
    const floor = P.get('fm.disc.rust_floor');
    expect(withWrestling({ monthsSinceTrained: 480 }).disciplines.wrestling.rustMult).toBeCloseTo(floor, 10);
  });

  it('reaches the composites that read the art, and the arts it transfers to', () => {
    const rusty = withWrestling({ monthsSinceTrained: 96 });
    // takedownDefence feeds tdDefenceBase directly (§2.7).
    expect(rusty.grappling.tdDefenceBase).toBeLessThan(base.grappling.tdDefenceBase);
    // And the rusted value is what transfers: judo gripFighting is credited
    // from wrestling clinch at 0.40.
    expect(rusty.disciplines.judo.effective.gripFighting)
      .toBeLessThan(base.disciplines.judo.effective.gripFighting);
  });

  it('does not touch the stored values the user authored', () => {
    const rusty = withWrestling({ monthsSinceTrained: 96 });
    expect(rusty.disciplines.wrestling.native.shots).toBe(72);
  });
});

describe('01 §8.1.2 what a training year is worth', () => {
  const base = derive(PRE_DEEP_FIGHTER);
  const baseYears = base.disciplines.wrestling.effectiveYears;

  it('raises effective years with volume, and with diminishing return', () => {
    const double = withWrestling({ hoursPerWeek: 16 }).disciplines.wrestling;
    expect(double.effectiveYears).toBeGreaterThan(baseYears);
    // sqrt(2) ~ 1.414, comfortably short of doubling.
    expect(double.yearsQualityMult).toBeLessThan(1.5);
    expect(double.yearsQualityMult).toBeGreaterThan(1.3);
  });

  it('weights frequency below total volume', () => {
    const moreHours = withWrestling({ hoursPerWeek: 16 }).disciplines.wrestling.yearsQualityMult;
    const moreSessions = withWrestling({ sessionsPerWeek: 10 }).disciplines.wrestling.yearsQualityMult;
    expect(moreSessions).toBeGreaterThan(1);
    expect(moreSessions).toBeLessThan(moreHours);
  });

  it('pays for coaching and for a childhood start', () => {
    expect(withWrestling({ coachQuality: 100 }).disciplines.wrestling.effectiveYears).toBeGreaterThan(baseYears);
    expect(withWrestling({ coachQuality: 0 }).disciplines.wrestling.effectiveYears).toBeLessThan(baseYears);
    expect(withWrestling({ startAge: 6 }).disciplines.wrestling.effectiveYears).toBeGreaterThan(baseYears);
    // A start age at or above the reference buys nothing.
    expect(withWrestling({ startAge: 25 }).disciplines.wrestling.effectiveYears).toBeCloseTo(baseYears, 10);
  });

  it('gives the base art a premium', () => {
    const basedMult = withWrestling({ isBase: true }).disciplines.wrestling.yearsQualityMult;
    expect(basedMult).toBeCloseTo(P.get('fm.disc.base_art_years_mult'), 10);
  });

  it('can lift a discipline over the years cap into a higher tier', () => {
    // A fighter authored above his training age is held down by the cap; give
    // him a childhood start at an elite camp and the cap moves.
    const def = clone(PRE_DEEP_FIGHTER);
    def.disciplines.bjj!.years = 3;
    const capped = derive(def).disciplines.bjj.tier;
    def.disciplines.bjj!.startAge = 6;
    def.disciplines.bjj!.hoursPerWeek = 20;
    def.disciplines.bjj!.sessionsPerWeek = 10;
    def.disciplines.bjj!.coachQuality = 100;
    def.disciplines.bjj!.isBase = true;
    expect(derive(def).disciplines.bjj.tier).toBeGreaterThanOrEqual(capped);
    expect(derive(def).disciplines.bjj.effectiveYears)
      .toBeGreaterThan(derive(PRE_DEEP_FIGHTER).disciplines.bjj.effectiveYears * 0.5);
  });
});

describe('01 §8.1.3 grade and competition prior', () => {
  it('scores every rank of every system, and nothing else', () => {
    for (const [system, ranks] of Object.entries(GRADE_RANKS)) {
      for (const rank of ranks) {
        const prior = gradePriorOf({ system: system as never, rank });
        expect(GRADE_PRIORS[rank], `${system}/${rank}`).toBeDefined();
        if (system === 'none') expect(prior).toBe(0);
        else expect(prior, `${system}/${rank}`).toBe(GRADE_PRIORS[rank]);
      }
    }
    // An unknown rank attests nothing rather than throwing (09 §3.6).
    expect(gradePriorOf({ system: 'bjjBelt', rank: 'bjj.plaid' })).toBe(0);
    expect(gradePriorOf(undefined)).toBe(0);
  });

  it('orders every ladder strictly upward', () => {
    for (const [system, ranks] of Object.entries(GRADE_RANKS)) {
      if (system === 'none') continue;
      for (let i = 1; i < ranks.length; i++) {
        expect(GRADE_PRIORS[ranks[i]], `${system} ${ranks[i]}`)
          .toBeGreaterThan(GRADE_PRIORS[ranks[i - 1]]);
      }
    }
  });

  it('adds stripes to a belt and only to a belt', () => {
    const plain = gradePriorOf({ system: 'bjjBelt', rank: 'bjj.purple' });
    expect(gradePriorOf({ system: 'bjjBelt', rank: 'bjj.purple', stripes: 4 })).toBeGreaterThan(plain);
    const judo = gradePriorOf({ system: 'judoKyuDan', rank: 'judo.shodan' });
    expect(gradePriorOf({ system: 'judoKyuDan', rank: 'judo.shodan', stripes: 4 })).toBe(judo);
  });

  it('raises the art when the grade outranks the authored skills', () => {
    const base = derive(PRE_DEEP_FIGHTER);
    const def = clone(PRE_DEEP_FIGHTER);
    def.disciplines.bjj!.grade = { system: 'bjjBelt', rank: 'bjj.black' };
    const rt = derive(def);
    expect(rt.disciplines.bjj.gradePrior).toBe(GRADE_PRIORS['bjj.black']);
    expect(rt.disciplines.bjj.mean).toBeGreaterThan(base.disciplines.bjj.mean);
    // And it reaches the composite that reads the art.
    expect(rt.grappling.subDefence).toBeGreaterThan(base.grappling.subDefence);
  });

  it('preserves the shape of the art it lifts', () => {
    const base = derive(PRE_DEEP_FIGHTER).disciplines.bjj.effective;
    const def = clone(PRE_DEEP_FIGHTER);
    def.disciplines.bjj!.grade = { system: 'bjjBelt', rank: 'bjj.black' };
    const lifted = derive(def).disciplines.bjj.effective;
    // The gap between the strongest and the weakest skill is unchanged: this
    // is the difference between flooring the mean and flooring each skill.
    const gapBefore = base.topControl - base.legLocks;
    const gapAfter = lifted.topControl - lifted.legLocks;
    expect(gapAfter).toBeCloseTo(gapBefore, 6);
  });

  it('does nothing when the fighter is already better than his grade', () => {
    const base = derive(PRE_DEEP_FIGHTER);
    const def = clone(PRE_DEEP_FIGHTER);
    def.disciplines.wrestling!.grade = { system: 'wrestlingCredential', rank: 'wr.club' };
    const rt = derive(def);
    expect(rt.disciplines.wrestling.mean).toBeCloseTo(base.disciplines.wrestling.mean, 10);
  });

  it('scores a competition record by room, sample size and form', () => {
    const none = competitionPriorOf(undefined, P);
    expect(none).toBe(0);
    const local = competitionPriorOf({ level: 'local', bouts: 20, wins: 15 }, P);
    const national = competitionPriorOf({ level: 'national', bouts: 20, wins: 15 }, P);
    const international = competitionPriorOf({ level: 'international', bouts: 20, wins: 15 }, P);
    expect(local).toBeLessThan(national);
    expect(national).toBeLessThan(international);

    // Sample size saturates rather than compounding.
    const few = competitionPriorOf({ level: 'national', bouts: 2, wins: 2 }, P);
    const many = competitionPriorOf({ level: 'national', bouts: 40, wins: 40 }, P);
    const more = competitionPriorOf({ level: 'national', bouts: 200, wins: 200 }, P);
    expect(few).toBeLessThan(many);
    expect(more - many).toBeLessThan(many - few);

    // Losing at a level is still worth being at that level.
    expect(competitionPriorOf({ level: 'national', bouts: 20, wins: 0 }, P)).toBeGreaterThan(0);

    // A placing raises the room, and a win rate can never exceed it.
    const plain = competitionPriorOf({ level: 'national', bouts: 30, wins: 30 }, P);
    const medalled = competitionPriorOf(
      { level: 'national', bouts: 30, wins: 30, bestPlacing: 'olympicMedal', medals: 5 }, P,
    );
    expect(medalled).toBeGreaterThan(plain);
    expect(plain).toBeLessThanOrEqual(P.get('fm.disc.comp_level.national') + 1e-9);
  });

  it('takes the larger of the grade and the record, not their sum', () => {
    const def = clone(PRE_DEEP_FIGHTER);
    def.disciplines.bjj!.grade = { system: 'bjjBelt', rank: 'bjj.black' };
    const gradeOnly = derive(def).disciplines.bjj.mean;
    def.disciplines.bjj!.competition = { level: 'local', bouts: 10, wins: 5 };
    const both = derive(def).disciplines.bjj.mean;
    expect(both).toBeCloseTo(gradeOnly, 10);
  });
});

describe('01 §8.1.4 specialisations and sparring', () => {
  it('has a well-formed catalogue keyed to real sub-skills', () => {
    expect(SPECIALISATIONS.length).toBeGreaterThan(20);
    const ids = SPECIALISATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const rt = derive(PRE_DEEP_FIGHTER);
    for (const spec of SPECIALISATIONS) {
      expect(spec.id, spec.id).toMatch(/^spec\.[a-z]+\.[A-Za-z]+$/);
      expect(spec.emphasis.length, spec.id).toBeGreaterThan(0);
      const known = rt.disciplines[spec.discipline].effective;
      for (const skill of [...spec.emphasis, ...(spec.tradeoff ?? [])]) {
        expect(known[skill], `${spec.id} -> ${skill}`).toBeDefined();
      }
      expect(specialisationById(spec.id)).toBe(spec);
    }
    expect(specialisationById('spec.nope.nope')).toBeUndefined();
  });

  it('biases exactly the sub-skills the catalogue names', () => {
    const base = derive(PRE_DEEP_FIGHTER).disciplines.bjj.effective;
    const def = clone(PRE_DEEP_FIGHTER);
    def.disciplines.bjj!.specialisations = ['spec.bjj.legLocks'];
    const rt = derive(def).disciplines.bjj.effective;
    const spec = specialisationById('spec.bjj.legLocks')!;
    for (const skill of spec.emphasis) {
      expect(rt[skill], `emphasis ${skill}`).toBeGreaterThan(base[skill]);
    }
    for (const skill of spec.tradeoff ?? []) {
      expect(rt[skill], `tradeoff ${skill}`).toBeLessThan(base[skill]);
    }
    // A skill in neither list is untouched.
    expect(rt.escapes).toBeCloseTo(base.escapes, 10);
  });

  it('is mean-neutral, so nobody climbs a tier by ticking boxes', () => {
    const base = derive(PRE_DEEP_FIGHTER).disciplines.bjj;
    for (const id of (SPECIALISATIONS_BY_DISCIPLINE.bjj ?? []).map((s) => s.id)) {
      const def = clone(PRE_DEEP_FIGHTER);
      def.disciplines.bjj!.specialisations = [id];
      const rt = derive(def).disciplines.bjj;
      expect(rt.mean, id).toBeCloseTo(base.mean, 6);
      expect(rt.tier, id).toBe(base.tier);
    }
  });

  it('gives each further specialisation less than the last', () => {
    const def = clone(PRE_DEEP_FIGHTER);
    def.disciplines.bjj!.specialisations = ['spec.bjj.legLocks'];
    const one = derive(def).disciplines.bjj.effective.legLocks;
    const base = derive(PRE_DEEP_FIGHTER).disciplines.bjj.effective.legLocks;
    def.disciplines.bjj!.specialisations = ['spec.bjj.backAttack', 'spec.bjj.legLocks'];
    const second = derive(def).disciplines.bjj.effective.legLocks;
    // The leg-lock bonus applied second is smaller than applied first, though
    // the back-attack trade-off also touches legLocks, so compare gains.
    expect(second - base).toBeLessThan(one - base);
  });

  it('ignores a specialisation that belongs to another art', () => {
    const def = clone(PRE_DEEP_FIGHTER);
    def.disciplines.bjj!.specialisations = ['spec.wr.chain', 'spec.box.power'];
    const rt = derive(def);
    expect(rt.disciplines.bjj.specialisations).toEqual([]);
    expect(rt.disciplines.bjj.mean).toBeCloseTo(derive(PRE_DEEP_FIGHTER).disciplines.bjj.mean, 10);
  });

  it('scales the art by sparring intensity, in both directions', () => {
    const base = derive(PRE_DEEP_FIGHTER).disciplines.wrestling.mean;
    expect(withWrestling({ sparringIntensity: 100 }).disciplines.wrestling.mean).toBeGreaterThan(base);
    expect(withWrestling({ sparringIntensity: 0 }).disciplines.wrestling.mean).toBeLessThan(base);
    expect(withWrestling({ sparringIntensity: 50 }).disciplines.wrestling.mean).toBeCloseTo(base, 10);
  });
});

// --------------------------------------------------------------------------
// 3. Overall experience (§8.2)
// --------------------------------------------------------------------------

function withRecord(patch: Record<string, unknown>): FighterRuntime {
  const def = clone(PRE_DEEP_FIGHTER);
  Object.assign(def.record, patch);
  return derive(def);
}

describe('01 §8.2 overall experience', () => {
  const base = derive(PRE_DEEP_FIGHTER);

  it('counts rounds as a surplus over the bout total', () => {
    // 15 pro + 7 amateur bouts: a record of finishes has fewer rounds than
    // bouts and must change nothing.
    expect(withRecord({ totalRounds: 15 }).experience).toBeCloseTo(base.experience, 12);
    // A record of decisions has far more, and must be worth more.
    expect(withRecord({ totalRounds: 60 }).experience).toBeGreaterThan(base.experience);
  });

  it('scales experience and composure by the level of the opposition', () => {
    const soft = withRecord({ oppositionLevel: 20 });
    const hard = withRecord({ oppositionLevel: 90 });
    expect(soft.experience).toBeLessThan(base.experience);
    expect(hard.experience).toBeGreaterThan(base.experience);
    expect(soft.composureEff).toBeLessThan(base.composureEff);
    expect(hard.composureEff).toBeGreaterThan(base.composureEff);
    expect(withRecord({ oppositionLevel: 50 }).experience).toBeCloseTo(base.experience, 12);
    // Experience drives decision noise, which is the thing the AI reads.
    expect(hard.decisionNoiseMult).toBeLessThan(base.decisionNoiseMult);
  });

  it('pays composure for main events, with a cap', () => {
    const few = withRecord({ mainEvents: 3 });
    const many = withRecord({ mainEvents: 40 });
    expect(few.composureEff).toBeGreaterThan(base.composureEff);
    expect(many.composureEff).toBeGreaterThan(few.composureEff);
    expect(withRecord({ mainEvents: 400 }).composureEff).toBeCloseTo(many.composureEff, 10);
  });

  it('decays the chin for wars and for hard sparring, each with a cap', () => {
    const wars = withRecord({ warFights: 5 });
    expect(wars.chinEff).toBeLessThan(base.chinEff);
    expect(withRecord({ warFights: 50 }).chinEff)
      .toBeCloseTo(withRecord({ warFights: P.get('fm.career.war_cap') }).chinEff, 10);

    const spar = withRecord({ hardSparringYears: 10 });
    expect(spar.chinEff).toBeLessThan(base.chinEff);
    expect(withRecord({ hardSparringYears: 100 }).chinEff)
      .toBeCloseTo(withRecord({ hardSparringYears: P.get('fm.career.hard_spar_cap') }).chinEff, 10);

    // A war costs less than a KO loss, which is the documented ordering.
    const oneWar = base.chinEff - withRecord({ warFights: 1 }).chinEff;
    expect(oneWar).toBeLessThan(P.get('fm.career.chin_per_ko_loss'));
    expect(oneWar).toBeGreaterThan(0);
  });

  it('honours an authored experience override while still reporting the derived value', () => {
    const rt = withRecord({ experienceOverride: 25 });
    expect(rt.experience).toBeCloseTo(0.25, 12);
    expect(rt.experienceDerived).toBeCloseTo(base.experience, 12);
    expect(rt.derivation.some((l) => l.includes('authored override'))).toBe(true);
    // The override is what the sim actually uses downstream.
    expect(rt.decisionNoiseMult).toBeGreaterThan(base.decisionNoiseMult);
  });
});

// --------------------------------------------------------------------------
// 4. Physique, biography and injuries (§8.3, §8.4)
// --------------------------------------------------------------------------

describe('01 §8.3 physique and background', () => {
  const base = derive(PRE_DEEP_FIGHTER);

  it('treats the walk-around mass as a floor under the authored cut', () => {
    const def = clone(PRE_DEEP_FIGHTER);
    // 77.1 from 95 kg is a ~19 % cut, far above the authored 7 %.
    def.body.naturalWeightKg = 95;
    expect(derive(def).residualDehydration).toBeGreaterThan(base.residualDehydration);
    // A walk-around mass implying a *smaller* cut never overrides the author.
    def.body.naturalWeightKg = 78;
    expect(derive(def).residualDehydration).toBeCloseTo(base.residualDehydration, 12);
  });

  it('moves lead-hand power with the handedness split, and nothing else', () => {
    const def = clone(PRE_DEEP_FIGHTER);
    def.body.handStrengthSplit = 100;
    const lopsided = derive(def);
    expect(lopsided.powerIndex.leadHand).toBeLessThan(base.powerIndex.leadHand);
    expect(lopsided.powerIndex.rearHand).toBeCloseTo(base.powerIndex.rearHand, 10);
    def.body.handStrengthSplit = 0;
    expect(derive(def).powerIndex.leadHand).toBeGreaterThan(base.powerIndex.leadHand);
  });

  it('moves the reach that matters with limb asymmetry', () => {
    const def = clone(PRE_DEEP_FIGHTER);
    def.body.limbAsymmetry = { armPct: 3, legPct: -3 };
    const rt = derive(def);
    expect(rt.effectiveReachM).toBeGreaterThan(base.effectiveReachM);
    expect(rt.effectiveKickReachM).toBeLessThan(base.effectiveKickReachM);
    // Half of the asymmetry, because the span already averages the two arms.
    const armHalf = (def.body.reachM - P.get('fm.reach.shoulder_ratio') * def.body.heightM) / 2;
    expect(rt.effectiveReachM - base.effectiveReachM).toBeCloseTo(0.5 * 0.03 * armHalf, 10);
  });

  it('gives and takes cardio for the endurance and cutting histories', () => {
    const def = clone(PRE_DEEP_FIGHTER);
    def.history = { cardioBackground: { sport: 'rowing', years: 8 } };
    const fit = derive(def);
    expect(fit.effective.cardio).toBeGreaterThan(base.effective.cardio);
    expect(fit.energy.pcrRefillHalfLifeS).toBeLessThan(base.energy.pcrRefillHalfLifeS);

    def.history = { weightCutHistory: { hardCuts: 12, worstCutPct: 11, missedWeight: 0 } };
    expect(derive(def).effective.cardio).toBeLessThan(base.effective.cardio);

    // 'none' is genuinely none, however many years are attached to it.
    def.history = { cardioBackground: { sport: 'none', years: 20 } };
    expect(derive(def).effective.cardio).toBeCloseTo(base.effective.cardio, 10);
  });

  it('adds residual dehydration for a cut that has stopped working', () => {
    const def = clone(PRE_DEEP_FIGHTER);
    def.history = { weightCutHistory: { hardCuts: 0, worstCutPct: 7, missedWeight: 2 } };
    expect(derive(def).residualDehydration).toBeGreaterThan(base.residualDehydration);
  });

  it('costs recovery for career surgeries, with a cap', () => {
    const def = clone(PRE_DEEP_FIGHTER);
    def.history = { surgeries: 3 };
    const cut = derive(def);
    expect(cut.effective.recovery).toBeLessThan(base.effective.recovery);
    expect(cut.recoveryHalfLifeMult).toBeGreaterThan(base.recoveryHalfLifeMult);
    def.history = { surgeries: 60 };
    const capped = derive(def);
    def.history = { surgeries: P.get('fm.hist.surgery_cap') };
    expect(capped.effective.recovery).toBeCloseTo(derive(def).effective.recovery, 10);
  });
});

describe('01 §8.4 injury history', () => {
  const base = derive(PRE_DEEP_FIGHTER);

  const withInjury = (entry: Record<string, unknown>): FighterRuntime => {
    const def = clone(PRE_DEEP_FIGHTER);
    def.history = { injuries: [entry as never] };
    return derive(def);
  };

  it('lowers exactly the attributes of the injured region', () => {
    const knee = withInjury({ region: 'knee', severity: 80, monthsAgo: 0 });
    expect(knee.effective.balance).toBeLessThan(base.effective.balance);
    expect(knee.effective.speed).toBeLessThan(base.effective.speed);
    expect(knee.effective.kickSpeed).toBeLessThan(base.effective.kickSpeed);
    // A knee does not cost grip or the chin.
    expect(knee.effective.gripStrength).toBeCloseTo(base.effective.gripStrength, 10);
    expect(knee.chinEff).toBeCloseTo(base.chinEff, 10);

    const ribs = withInjury({ region: 'ribs', severity: 80, monthsAgo: 0 });
    expect(ribs.effective.bodyToughness).toBeLessThan(base.effective.bodyToughness);
    expect(ribs.effective.balance).toBeCloseTo(base.effective.balance, 10);

    const head = withInjury({ region: 'head', severity: 80, monthsAgo: 0 });
    expect(head.chinEff).toBeLessThan(base.chinEff);
    expect(head.chinZ).toBeGreaterThan(base.chinZ);
    expect(head.effective.reactionTime).toBeLessThan(base.effective.reactionTime);

    const neck = withInjury({ region: 'neck', severity: 80, monthsAgo: 0 });
    expect(neck.effective.neck).toBeLessThan(base.effective.neck);
    expect(neck.neckMult).toBeGreaterThan(base.neckMult);
  });

  it('heals: the same injury costs less the longer ago it was', () => {
    const fresh = withInjury({ region: 'knee', severity: 80, monthsAgo: 0 });
    const old = withInjury({ region: 'knee', severity: 80, monthsAgo: 36 });
    const ancient = withInjury({ region: 'knee', severity: 80, monthsAgo: 240 });
    expect(old.effective.balance).toBeGreaterThan(fresh.effective.balance);
    expect(ancient.effective.balance).toBeGreaterThan(old.effective.balance);
    expect(ancient.effective.balance).toBeCloseTo(base.effective.balance, 2);
  });

  it('never fully heals an operated or a recurrent joint', () => {
    const plain = withInjury({ region: 'knee', severity: 80, monthsAgo: 240 });
    const operated = withInjury({ region: 'knee', severity: 80, monthsAgo: 240, surgery: true });
    const recurrent = withInjury({ region: 'knee', severity: 80, monthsAgo: 240, recurrent: true });
    expect(operated.effective.balance).toBeLessThan(plain.effective.balance);
    expect(recurrent.effective.balance).toBeLessThan(operated.effective.balance);
    // The residues do not stack: the worse of the two applies.
    const both = withInjury({ region: 'knee', severity: 80, monthsAgo: 240, surgery: true, recurrent: true });
    expect(both.effective.balance).toBeCloseTo(recurrent.effective.balance, 10);
  });

  it('scales with severity and vanishes at zero', () => {
    const mild = withInjury({ region: 'back', severity: 20, monthsAgo: 0 });
    const bad = withInjury({ region: 'back', severity: 90, monthsAgo: 0 });
    expect(mild.effective.strength).toBeGreaterThan(bad.effective.strength);
    expect(withInjury({ region: 'back', severity: 0, monthsAgo: 0 }).effective.strength)
      .toBeCloseTo(base.effective.strength, 10);
  });

  it('caps a capability once the injury is bad enough, and not before', () => {
    const nuisance = withInjury({ region: 'hand', severity: 20, monthsAgo: 12 });
    expect(nuisance.injury.capabilities.punchPower).toBe(1);
    expect(nuisance.powerIndex.rearHand).toBeCloseTo(base.powerIndex.rearHand, 10);

    const broken = withInjury({ region: 'hand', severity: 95, monthsAgo: 0 });
    expect(broken.injury.capabilities.punchPower).toBeLessThan(1);
    expect(broken.powerIndex.rearHand).toBeLessThan(base.powerIndex.rearHand);
    expect(broken.powerIndex.leadHand).toBeLessThan(base.powerIndex.leadHand);
    // A hand does not cap the kick.
    expect(broken.injury.capabilities.kickPower).toBe(1);
    expect(broken.powerIndex.rearKick).toBeCloseTo(base.powerIndex.rearKick, 10);

    const knee = withInjury({ region: 'knee', severity: 95, monthsAgo: 0 });
    expect(knee.injury.capabilities.kickPower).toBeLessThan(1);
    expect(knee.powerIndex.rearKick).toBeLessThan(base.powerIndex.rearKick);

    const hip = withInjury({ region: 'hip', severity: 95, monthsAgo: 0 });
    expect(hip.injury.capabilities.headKick).toBeLessThan(1);
    expect(hip.flexKickQualityMult).toBeLessThan(base.flexKickQualityMult);
  });

  it('accumulates across entries and reports its working', () => {
    const def = clone(PRE_DEEP_FIGHTER);
    def.history = {
      injuries: [
        { region: 'knee', severity: 70, monthsAgo: 6, surgery: true },
        { region: 'knee', severity: 50, monthsAgo: 2 },
        { region: 'hand', severity: 60, monthsAgo: 1 },
      ],
    };
    const rt = derive(def);
    expect(rt.injury.load).toBeGreaterThan(1);
    expect(rt.injury.notes).toHaveLength(3);
    expect(rt.injury.attributePenalties.balance).toBeGreaterThan(0);
    expect(rt.derivation.some((l) => l.startsWith('injury load'))).toBe(true);
  });

  it('ignores an unknown region rather than refusing the fighter', () => {
    const rt = withInjury({ region: 'tail', severity: 90, monthsAgo: 0 });
    expect(rt.injury.load).toBe(0);
    expect(rt.effective.balance).toBeCloseTo(base.effective.balance, 10);
  });
});

// --------------------------------------------------------------------------
// 5. The archetypes still hold
// --------------------------------------------------------------------------

describe('01 §8 archetypes', () => {
  it('validates and derives every preset with its §8 fields populated', () => {
    for (const id of ARCHETYPE_IDS) {
      const def = ARCHETYPES[id];
      const result = validateFighter(def);
      expect(result.issues.filter((i) => i.severity === 'error'), id).toEqual([]);
      expect(() => derive(def), id).not.toThrow();
    }
  });

  it('gives every preset a described career in every art it trains', () => {
    for (const id of ARCHETYPE_IDS) {
      const def = ARCHETYPES[id];
      for (const [art, block] of Object.entries(def.disciplines)) {
        if (!block) continue;
        expect(block.startAge, `${id}.${art}.startAge`).toBeGreaterThan(0);
        expect(block.hoursPerWeek, `${id}.${art}.hoursPerWeek`).toBeGreaterThan(0);
        expect(block.sessionsPerWeek, `${id}.${art}.sessionsPerWeek`).toBeGreaterThan(0);
        expect(block.coachQuality, `${id}.${art}.coachQuality`).toBeGreaterThan(0);
        expect(block.isBase, `${id}.${art}.isBase`).toBeDefined();
        // Start age must be consistent with the years trained and the age.
        expect(block.startAge! + block.years, `${id}.${art} start age`)
          .toBeLessThanOrEqual(def.body.ageYears + 0.5);
      }
      // Exactly one base art per fighter.
      // The brand-new brawler trains nothing at all, which is the one honest
      // way to have no base art.
      const trained = Object.values(def.disciplines).filter(Boolean).length;
      const bases = Object.values(def.disciplines).filter((b) => b?.isBase).length;
      expect(bases, `${id} base arts`).toBe(trained > 0 ? 1 : 0);
      expect(def.record.totalRounds, `${id} rounds`).toBeGreaterThanOrEqual(0);
      expect(def.history, `${id} history`).toBeDefined();
      expect(def.body.naturalWeightKg, `${id} walk-around`).toBeGreaterThanOrEqual(def.body.weighInKg!);
    }
  });

  it('survives a JSON round trip with the §8 fields intact', () => {
    for (const id of ARCHETYPE_IDS) {
      const round = clone(ARCHETYPES[id]);
      expect(round, id).toEqual(ARCHETYPES[id]);
      expect(numbersOf(derive(round)), id).toBe(numbersOf(derive(ARCHETYPES[id])));
    }
  });

  it('keeps the §8 depth calibration-neutral on the presets', () => {
    // The archetypes are the §6 calibration fixtures; their sub-skills are the
    // finished picture of each art. Sparring intensity therefore stays at the
    // neutral 50 on every one of them (see the note in archetypes.ts).
    for (const id of ARCHETYPE_IDS) {
      for (const [art, block] of Object.entries(ARCHETYPES[id].disciplines)) {
        if (!block) continue;
        expect(block.sparringIntensity, `${id}.${art}`).toBe(50);
      }
    }
  });
});

// --------------------------------------------------------------------------
// 6. Every new parameter is registered properly
// --------------------------------------------------------------------------

describe('01 §5.8 parameter registry', () => {
  it('registers every §8 knob with a unit, a tag and bounds', () => {
    const prefixes = ['fm.disc.', 'fm.injury.', 'fm.hist.'];
    const rows = PARAMS.all.filter((s) => prefixes.some((p) => s.id.startsWith(p)));
    expect(rows.length).toBeGreaterThan(50);
    for (const spec of rows) {
      expect(spec.section, spec.id).toBe('fighter');
      expect(spec.unit, spec.id).toBeTruthy();
      expect(spec.tag, spec.id).toMatch(/^\[(S:|D:|E)/);
      expect(spec.note, spec.id).toBeTruthy();
      expect(spec.min, spec.id).toBeDefined();
      expect(spec.max, spec.id).toBeDefined();
      expect(spec.value, spec.id).toBeGreaterThanOrEqual(spec.min!);
      expect(spec.value, spec.id).toBeLessThanOrEqual(spec.max!);
    }
  });

  it('registers the §8.2 and §8.3 knobs that live under existing prefixes', () => {
    for (const id of [
      'fm.exp.rounds_per_fight', 'fm.exp.rounds_weight', 'fm.exp.opposition_slope',
      'fm.career.opposition_composure', 'fm.career.main_event_composure', 'fm.career.main_event_cap',
      'fm.career.chin_per_war', 'fm.career.war_cap',
      'fm.career.chin_per_hard_spar_year', 'fm.career.hard_spar_cap',
      'fm.power.hand_split_slope', 'fm.reach.asym_share',
    ]) {
      expect(P.index.has(id), id).toBe(true);
    }
  });
});
