/**
 * MATCHUP GENERATORS — the calibration plans of docs/design/09 §6.5 and the
 * §7.4 edge-case cells.
 *
 * A plan is a list of cells; a cell is a deterministic `make(i)` that builds
 * bout `i`'s `SimConfig` from nothing but the plan seed, the cell id and `i`.
 * Fighters come from `randomFighter` (seeded, always valid) or from clones of
 * one generated base fighter with a single attribute moved, so every cell
 * isolates the thing it is named after. Every generated definition is run
 * through `validateFighter`; only the §7.4 cells that exist to break the rules
 * (zero stats, max stats) are allowed to fail it, and they record the result.
 *
 * Nothing here reads a clock or `Math.random()`.
 */
import {
  DEFAULT_SETTINGS, SUB_SKILLS, boutSeed, weightClassFor,
  type ArenaId, type FighterDefinition, type MatchMode, type MatchSettings, type RulesetId,
  type SimConfig, type WeightClassId,
} from '../../src/sim';
import { blankFighter, randomFighter, type RandomOptions } from '../../src/app/store/defaults';
import { validateFighter } from '../../src/app/store/validate';
import { STANDARD_ARENAS } from '../../src/app/model/matchModel';
import type { BoutTags, CellTags, JobMessage } from './types';
import { rowKey } from './types';

type FighterClass = NonNullable<FighterDefinition['body']['weightClass']>;
type Discipline = NonNullable<RandomOptions['primaryDiscipline']>;

export interface MakeCtx {
  i: number;
  seed: string;
  planSeed: string;
}

export interface Made {
  config: SimConfig;
  bt?: BoutTags;
}

export interface Cell {
  id: string;
  plan: string;
  n: number;
  tags: CellTags;
  /** Run with the §1.6 invariant sweep (edge cases, rules × arenas). */
  qa: boolean;
  /** The §7.4 cells built to be out of bounds on purpose. */
  allowInvalid?: boolean;
  make(ctx: MakeCtx): Made;
}

export interface Plan {
  id: string;
  description: string;
  defaultN: number;
  cells(n: number): Cell[];
}

// ---------------------------------------------------------------------------
// Classes and fighter factories
// ---------------------------------------------------------------------------

export interface ClassSpec {
  code: string;
  wc: FighterClass;
  sex: 'male' | 'female';
  setting: WeightClassId;
}

export const MEN: readonly ClassSpec[] = [
  { code: 'FLW', wc: 'wc.flyweight', sex: 'male', setting: 'flyweight' },
  { code: 'BW', wc: 'wc.bantamweight', sex: 'male', setting: 'bantamweight' },
  { code: 'FW', wc: 'wc.featherweight', sex: 'male', setting: 'featherweight' },
  { code: 'LW', wc: 'wc.lightweight', sex: 'male', setting: 'lightweight' },
  { code: 'WW', wc: 'wc.welterweight', sex: 'male', setting: 'welterweight' },
  { code: 'MW', wc: 'wc.middleweight', sex: 'male', setting: 'middleweight' },
  { code: 'LHW', wc: 'wc.light_heavyweight', sex: 'male', setting: 'lightHeavyweight' },
  { code: 'HW', wc: 'wc.heavyweight', sex: 'male', setting: 'heavyweight' },
];
export const WOMEN: readonly ClassSpec[] = [
  { code: 'W-SW', wc: 'wc.strawweight', sex: 'female', setting: 'strawweight' },
  { code: 'W-FLW', wc: 'wc.flyweight', sex: 'female', setting: 'flyweight' },
  { code: 'W-BW', wc: 'wc.bantamweight', sex: 'female', setting: 'bantamweight' },
];
const LW = MEN[3];

const clone = (d: FighterDefinition): FighterDefinition => JSON.parse(JSON.stringify(d)) as FighterDefinition;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const r1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * `randomFighter` has no strawweight stature profile (it falls back to the
 * welterweight one, 1.71 m for a woman). Rescale a W-SW to a 1.60 m mean so
 * the class is not taller than W-FLW; reach and leg reach keep their ratios.
 */
function fixStature(def: FighterDefinition): void {
  if (def.body.weightClass === 'wc.strawweight') {
    const k = 1.60 / 1.71;
    def.body.heightM = r3(def.body.heightM * k);
    def.body.reachM = r3(def.body.reachM * k);
    def.body.legReachM = r3(def.body.legReachM * k);
  }
}

/** A generated fighter: deterministic in `seed`. */
export function gen(seed: string, opts: RandomOptions): FighterDefinition {
  const def = randomFighter(seed, opts);
  fixStature(def);
  return def;
}

function settings(extra: Partial<MatchSettings> = {}): MatchSettings {
  return { ...DEFAULT_SETTINGS, blood: false, commentary: false, ...extra };
}

function config1v1(
  seed: string, a: FighterDefinition, b: FighterDefinition,
  opts: { ruleset?: RulesetId; arena?: ArenaId; settings?: Partial<MatchSettings> } = {},
): SimConfig {
  return {
    seed,
    mode: '1v1',
    fighters: [a, b],
    teams: { teamOf: [0, 1] },
    ruleset: opts.ruleset ?? 'mma.unified.3r',
    arena: opts.arena ?? 'octagon_30',
    settings: settings(opts.settings),
  };
}

function tags(plan: string, group: string, extra: Partial<CellTags> = {}): CellTags {
  return {
    plan, group, wc: LW.code, sex: 'male', mode: '1v1', ruleset: 'mma.unified.3r', arena: 'octagon_30', ...extra,
  };
}

/** Put the edge fighter on side `i % 2` so a side bias cannot masquerade as an effect. */
function sided(i: number, edge: FighterDefinition, other: FighterDefinition): { pair: [FighterDefinition, FighterDefinition]; edge: number } {
  return i % 2 === 0 ? { pair: [edge, other], edge: 0 } : { pair: [other, edge], edge: 1 };
}

// ---------------------------------------------------------------------------
// Population plans: baseline / ufc_population / mma_5r / rematch
// ---------------------------------------------------------------------------

function populationCell(plan: string, group: string, cls: ClassSpec, tier: number, n: number, ruleset: RulesetId = 'mma.unified.3r'): Cell {
  return {
    id: `${plan}/${group}/${cls.code}`,
    plan,
    n,
    qa: false,
    tags: tags(plan, group, { wc: cls.code, sex: cls.sex, tierA: tier, tierB: tier, ruleset }),
    make: ({ seed }) => {
      const o: RandomOptions = { tier, weightClass: cls.wc, sex: cls.sex };
      return {
        config: config1v1(seed, gen(`${seed}#A`, o), gen(`${seed}#B`, o), {
          ruleset, settings: { weightClass: cls.setting, mismatchMode: 'classed', weighIn: 'dayBefore' },
        }),
      };
    },
  };
}

const BASELINE: Plan = {
  id: 'baseline',
  description: 'Same-tier pairs in every class: elite (T4, all 8 men\'s + 3 women\'s classes; the §7.1 population) and regional (T3, men\'s classes; row 97).',
  defaultN: 2000,
  cells: (n) => [
    ...[...MEN, ...WOMEN].map((c) => populationCell('baseline', 'ufc', c, 4, n)),
    ...MEN.map((c) => populationCell('baseline', 'regional', c, 3, n)),
  ],
};

const UFC_POPULATION: Plan = {
  id: 'ufc_population',
  description: 'The §7.1 master population alone: T4 vs T4 in 8 men\'s and 3 women\'s classes.',
  defaultN: 2000,
  cells: (n) => [...MEN, ...WOMEN].map((c) => populationCell('ufc_population', 'ufc', c, 4, n)),
};

const MMA_5R: Plan = {
  id: 'mma_5r',
  description: 'Five-round T4 bouts (rows 102, 112).',
  defaultN: 1000,
  cells: (n) => [MEN[3], MEN[4], MEN[5]].map((c) => populationCell('mma_5r', 'five', c, 4, n, 'mma.unified.5r')),
};

const REMATCH: Plan = {
  id: 'rematch',
  description: 'Row 113 proxy: bouts 2k and 2k+1 are the same two T4 lightweights on different seeds.',
  defaultN: 1000,
  cells: (n) => [{
    id: 'rematch/pairs/LW',
    plan: 'rematch',
    n,
    qa: false,
    tags: tags('rematch', 'pairs', { tierA: 4, tierB: 4 }),
    make: ({ i, seed, planSeed }) => {
      const pair = Math.floor(i / 2);
      const o: RandomOptions = { tier: 4, weightClass: LW.wc, sex: 'male' };
      const ps = `${planSeed}::rematch::pair-${pair}`;
      return { config: config1v1(seed, gen(`${ps}#A`, o), gen(`${ps}#B`, o)), bt: { pair } };
    },
  }],
};

// ---------------------------------------------------------------------------
// tier_matrix / identical
// ---------------------------------------------------------------------------

const SIZE_KEYS = ['heightM', 'reachM', 'legReachM', 'massKg', 'weighInKg', 'fightNightKg', 'naturalWeightKg', 'bodyFatPct', 'build'] as const;

function copySize(from: FighterDefinition, to: FighterDefinition): void {
  const src = from.body as unknown as Record<string, unknown>;
  const dst = to.body as unknown as Record<string, unknown>;
  for (const k of SIZE_KEYS) if (src[k] !== undefined) dst[k] = JSON.parse(JSON.stringify(src[k]));
}

const TIER_MATRIX: Plan = {
  id: 'tier_matrix',
  description: '6 x 6 nominal tiers (T0..T5), lightweight men, both sides given the same body (§7.3).',
  defaultN: 500,
  cells: (n) => {
    const out: Cell[] = [];
    for (let a = 0; a <= 5; a++) {
      for (let b = 0; b <= 5; b++) {
        out.push({
          id: `tier_matrix/T${a}xT${b}`,
          plan: 'tier_matrix',
          n,
          qa: false,
          tags: tags('tier_matrix', 'tiers', { tierA: a, tierB: b }),
          make: ({ seed }) => {
            const size = gen(`${seed}#size`, { tier: 3, weightClass: LW.wc, sex: 'male' });
            const A = gen(`${seed}#A`, { tier: a, weightClass: LW.wc, sex: 'male' });
            const B = gen(`${seed}#B`, { tier: b, weightClass: LW.wc, sex: 'male' });
            copySize(size, A);
            copySize(size, B);
            return { config: config1v1(seed, A, B) };
          },
        });
      }
    }
    return out;
  },
};

const IDENTICAL: Plan = {
  id: 'identical',
  description: 'One definition on both sides (a fresh T4 lightweight per bout): the 50/50 check (§7.3 T5).',
  defaultN: 4000,
  cells: (n) => [{
    id: 'identical/mirror',
    plan: 'identical',
    n,
    qa: false,
    tags: tags('identical', 'mirror', { tierA: 4, tierB: 4 }),
    make: ({ seed }) => {
      const f = gen(`${seed}#A`, { tier: 4, weightClass: LW.wc, sex: 'male' });
      return { config: config1v1(seed, f, clone(f)) };
    },
  }],
};

// ---------------------------------------------------------------------------
// physical_sweeps
// ---------------------------------------------------------------------------

type Mutate = (f: FighterDefinition, val: number | string) => void;

function shiftAttr(keys: readonly (keyof FighterDefinition['physical'])[]): Mutate {
  return (f, val) => {
    const p = f.physical as unknown as Record<string, number>;
    for (const k of keys) p[k] = Math.round(clamp(p[k] + Number(val), 1, 99));
  };
}

function shiftSkills(f: FighterDefinition, val: number): void {
  const ds = f.disciplines as unknown as Record<string, { sub: Record<string, number> } | undefined>;
  for (const d of Object.values(ds)) {
    if (!d) continue;
    for (const k of Object.keys(d.sub)) d.sub[k] = Math.round(clamp(d.sub[k] + val, 1, 99));
  }
}

function setMass(f: FighterDefinition, delta: number): void {
  const b = f.body;
  b.massKg = r1(b.massKg + delta);
  if (b.weighInKg !== undefined) b.weighInKg = r1(b.weighInKg + delta);
  if (b.fightNightKg !== undefined) b.fightNightKg = r1(b.fightNightKg + delta);
  if (b.naturalWeightKg !== undefined) b.naturalWeightKg = r1(b.naturalWeightKg + delta);
  b.weightClass = weightClassFor(b.weighInKg ?? b.massKg);
}

interface SweepVar {
  id: string;
  points: readonly (number | string)[];
  /** Absolute (age) vs delta variables. */
  absolute?: boolean;
  apply: Mutate;
  /** Applied to both fighters before the edge (age: both 31). */
  prep?: (f: FighterDefinition) => void;
}

const SWEEP_VARS: readonly SweepVar[] = [
  { id: 'reach', points: [-15, -10, -5, 5, 7.5, 10, 15, 18], apply: (f, v) => { f.body.reachM = r3(f.body.reachM + Number(v) / 100); } },
  { id: 'height', points: [-10, -5, 5, 10], apply: (f, v) => { f.body.heightM = r3(f.body.heightM + Number(v) / 100); } },
  { id: 'mass', points: [-10, -5, 2.7, 5, 6.8, 10, 13.6, 20], apply: (f, v) => setMass(f, Number(v)) },
  {
    id: 'age', points: [22, 25, 28, 31, 34, 37, 40], absolute: true,
    prep: (f) => { f.body.ageYears = 31; },
    apply: (f, v) => { f.body.ageYears = Number(v); },
  },
  { id: 'cardio', points: [-14, -7, 7, 14], apply: shiftAttr(['cardio']) },
  { id: 'speed', points: [-14, -7, 7, 14], apply: shiftAttr(['speed', 'handSpeed', 'kickSpeed']) },
  { id: 'strength', points: [-14, -7, 7, 14], apply: shiftAttr(['strength']) },
  { id: 'chin', points: [-14, -7, 7, 14], apply: shiftAttr(['chin']) },
  { id: 'skill', points: [-14, -7, 7, 14], apply: (f, v) => shiftSkills(f, Number(v)) },
  {
    id: 'stance', points: ['southpaw'],
    prep: (f) => { f.body.stance = 'orthodox'; f.body.handedness = 'right'; f.body.dominantLeg = 'right'; },
    apply: (f) => { f.body.stance = 'southpaw'; f.body.handedness = 'left'; f.body.dominantLeg = 'left'; },
  },
  {
    id: 'experience', points: ['debut'],
    apply: (f) => { f.record = clone(blankFighter()).record; },
  },
];

function sweepCell(v: SweepVar, val: number | string, n: number): Cell {
  return {
    id: `physical_sweeps/${v.id}/${val}`,
    plan: 'physical_sweeps',
    n,
    qa: false,
    tags: tags('physical_sweeps', 'sweep', { tierA: 4, tierB: 4, sweepVar: v.id, sweepVal: val }),
    make: ({ i, seed }) => {
      const base = gen(`${seed}#base`, { tier: 4, weightClass: LW.wc, sex: 'male' });
      v.prep?.(base);
      const edge = clone(base);
      v.apply(edge, val);
      const s = sided(i, edge, clone(base));
      return { config: config1v1(seed, s.pair[0], s.pair[1]), bt: { edge: s.edge } };
    },
  };
}

const PHYSICAL_SWEEPS: Plan = {
  id: 'physical_sweeps',
  description: 'T4 vs T4 clones differing in one attribute (reach, height, mass, age, cardio, speed, strength, chin, skill, stance, experience); edge side alternates; plus the openweight FLW vs HW cell (§7.2, §7.3 T4/T8).',
  defaultN: 1000,
  cells: (n) => {
    const out: Cell[] = [{
      id: 'physical_sweeps/control/0',
      plan: 'physical_sweeps',
      n,
      qa: false,
      tags: tags('physical_sweeps', 'sweep', { tierA: 4, tierB: 4, sweepVar: 'control', sweepVal: 0 }),
      make: ({ i, seed }) => {
        const base = gen(`${seed}#base`, { tier: 4, weightClass: LW.wc, sex: 'male' });
        const s = sided(i, clone(base), base);
        return { config: config1v1(seed, s.pair[0], s.pair[1]), bt: { edge: s.edge } };
      },
    }];
    for (const v of SWEEP_VARS) for (const p of v.points) out.push(sweepCell(v, p, n));
    out.push({
      id: 'physical_sweeps/openweight/FLWvHW',
      plan: 'physical_sweeps',
      n,
      qa: false,
      tags: tags('physical_sweeps', 'sweep', { wc: 'open', tierA: 4, tierB: 4, sweepVar: 'openweight', sweepVal: 'FLWvHW' }),
      make: ({ i, seed }) => {
        const fly = gen(`${seed}#FLW`, { tier: 4, weightClass: 'wc.flyweight', sex: 'male' });
        const hw = gen(`${seed}#HW`, { tier: 4, weightClass: 'wc.heavyweight', sex: 'male' });
        const s = sided(i, hw, fly);
        return {
          config: config1v1(seed, s.pair[0], s.pair[1], { settings: { weightClass: 'openweight', mismatchMode: 'openweight' } }),
          bt: { edge: s.edge },
        };
      },
    });
    return out;
  },
};

// ---------------------------------------------------------------------------
// style_matrix / judging
// ---------------------------------------------------------------------------

export const STYLES: readonly { label: string; disc: Discipline; mode: FighterDefinition['style']['primaryMode'] }[] = [
  { label: 'distance', disc: 'kickboxing', mode: 'distanceStriking' },
  { label: 'pressure', disc: 'boxing', mode: 'pressureStriking' },
  { label: 'counter', disc: 'karate', mode: 'counter' },
  { label: 'wrestler', disc: 'wrestling', mode: 'wrestleControl' },
  { label: 'clinch', disc: 'judo', mode: 'clinchGrind' },
  { label: 'bjj', disc: 'bjj', mode: 'guardPlayer' },
];

function styled(seed: string, st: (typeof STYLES)[number]): FighterDefinition {
  const f = gen(seed, { tier: 4, weightClass: LW.wc, sex: 'male', primaryDiscipline: st.disc });
  f.style.primaryMode = st.mode;
  return f;
}

const STYLE_MATRIX: Plan = {
  id: 'style_matrix',
  description: '6 x 6 archetypes (distance, pressure, counter, wrestler, clinch grinder, BJJ), T4 lightweights (§7.2 S3, S7).',
  defaultN: 1000,
  cells: (n) => {
    const out: Cell[] = [];
    for (const a of STYLES) {
      for (const b of STYLES) {
        out.push({
          id: `style_matrix/${a.label}x${b.label}`,
          plan: 'style_matrix',
          n,
          qa: false,
          tags: tags('style_matrix', 'styles', { tierA: 4, tierB: 4, styleA: a.label, styleB: b.label }),
          make: ({ seed }) => ({ config: config1v1(seed, styled(`${seed}#A`, a), styled(`${seed}#B`, b)) }),
        });
      }
    }
    return out;
  },
};

const JUDGING: Plan = {
  id: 'judging',
  description: 'T4 lightweight population under hidden vs open scoring and three judge cultures (§7.2 S4b, rows 84–87, 105–107, 114).',
  defaultN: 1000,
  cells: (n) => {
    const combos: [MatchSettings['judgingMode'], MatchSettings['judgeCulture']][] = [
      ['hidden', 'unified_2025'], ['open', 'unified_2025'], ['hidden', 'legacy_2016'], ['hidden', 'whole_fight'],
    ];
    return combos.map(([mode, culture]) => ({
      id: `judging/${mode}/${culture}`,
      plan: 'judging',
      n,
      qa: false,
      tags: tags('judging', 'judging', { tierA: 4, tierB: 4, judgingMode: mode, judgeCulture: culture }),
      make: ({ seed }: MakeCtx) => {
        const o: RandomOptions = { tier: 4, weightClass: LW.wc, sex: 'male' };
        return { config: config1v1(seed, gen(`${seed}#A`, o), gen(`${seed}#B`, o), { settings: { judgingMode: mode, judgeCulture: culture } }) };
      },
    }));
  },
};

// ---------------------------------------------------------------------------
// multi / rules_arenas / edge_cases
// ---------------------------------------------------------------------------

interface MultiSpec {
  id: string;
  mode: MatchMode;
  tiers: number[];
  teamOf: number[];
  ruleset: RulesetId;
  arena: ArenaId;
  qaCase: string;
}

function multiCell(plan: string, s: MultiSpec, n: number): Cell {
  return {
    id: `${plan}/${s.id}`,
    plan,
    n,
    qa: true,
    tags: tags(plan, s.mode, {
      mode: s.mode, ruleset: s.ruleset, arena: s.arena, tierA: s.tiers[0], tierB: s.tiers[1], qaCase: s.qaCase,
    }),
    make: ({ seed }) => {
      const fighters = s.tiers.map((t, k) => gen(`${seed}#${k}`, { tier: t, weightClass: LW.wc, sex: 'male' }));
      return {
        config: {
          seed,
          mode: s.mode,
          fighters,
          teams: { teamOf: s.teamOf.slice() },
          ruleset: s.ruleset,
          arena: s.arena,
          settings: settings(s.ruleset === 'street' ? { maxSeconds: 180 } : {}),
        },
      };
    },
  };
}

const MULTI_SPECS: readonly MultiSpec[] = [
  { id: '1v2', mode: 'teams', tiers: [4, 2, 2], teamOf: [0, 1, 1], ruleset: 'mma.unified.3r', arena: 'octagon_30', qaCase: '1vN' },
  { id: '1v3', mode: 'teams', tiers: [4, 2, 2, 2], teamOf: [0, 1, 1, 1], ruleset: 'mma.unified.3r', arena: 'octagon_30', qaCase: '1vN' },
  { id: '1v5', mode: 'teams', tiers: [4, 2, 2, 2, 2, 2], teamOf: [0, 1, 1, 1, 1, 1], ruleset: 'mma.unified.3r', arena: 'octagon_30', qaCase: '1v5' },
  { id: '2v2', mode: 'teams', tiers: [4, 4, 4, 4], teamOf: [0, 0, 1, 1], ruleset: 'mma.unified.3r', arena: 'octagon_30', qaCase: 'teams' },
  { id: 'ffa4', mode: 'ffa', tiers: [4, 4, 4, 4], teamOf: [0, 1, 2, 3], ruleset: 'mma.unified.3r', arena: 'octagon_30', qaCase: 'ffa' },
  { id: 'crowd_T5v5T0', mode: 'crowd', tiers: [5, 0, 0, 0, 0, 0], teamOf: [0, 1, 1, 1, 1, 1], ruleset: 'street', arena: 'street_open', qaCase: 'crowd_T5v5T0' },
  { id: 'crowd_T0v3T0', mode: 'crowd', tiers: [0, 0, 0, 0], teamOf: [0, 1, 1, 1], ruleset: 'street', arena: 'street_open', qaCase: 'crowd_T0v3T0' },
];

const MULTI: Plan = {
  id: 'multi',
  description: '1v2, 1v3, 1v5 (T4 vs T2s), 2v2, ffa-4, crowd T5 vs 5xT0, crowd T0 vs 3xT0 (§7.4, §3.1).',
  defaultN: 500,
  cells: (n) => MULTI_SPECS.map((s) => multiCell('multi', s, n)),
};

const NON_STANDARD: readonly [RulesetId, ArenaId][] = [
  ['boxing.pro', 'octagon_30'], ['mma.unified.3r', 'mat_ibjjf'], ['judo.ijf', 'octagon_30'],
  ['grappling.adcc', 'octagon_30'], ['street', 'octagon_30'], ['muay_thai.abc', 'street_grass'],
];

function rulesCell(ruleset: RulesetId, arena: ArenaId, standard: boolean, n: number, strictness: MatchSettings['refereeStrictness'] = 'standard'): Cell {
  const suffix = strictness === 'standard' ? '' : `/${strictness}`;
  return {
    id: `rules_arenas/${ruleset}@${arena}${suffix}`,
    plan: 'rules_arenas',
    n,
    qa: true,
    tags: tags('rules_arenas', standard ? 'standard' : 'nonstandard', {
      ruleset, arena, tierA: 4, tierB: 4, standard, strictness, qaCase: 'rules_arenas',
    }),
    make: ({ seed }) => {
      const o: RandomOptions = { tier: 4, weightClass: LW.wc, sex: 'male' };
      return {
        config: config1v1(seed, gen(`${seed}#A`, o), gen(`${seed}#B`, o), {
          ruleset, arena, settings: { refereeStrictness: strictness, ...(ruleset === 'street' ? { maxSeconds: 180 } : {}) },
        }),
      };
    },
  };
}

const RULES_ARENAS: Plan = {
  id: 'rules_arenas',
  description: 'Every standard ruleset x arena pair, six non-standard pairs, and referee strictness lenient/strict (§7.4).',
  defaultN: 100,
  cells: (n) => {
    const out: Cell[] = [];
    for (const [rs, arenas] of Object.entries(STANDARD_ARENAS) as [RulesetId, readonly ArenaId[]][]) {
      for (const a of arenas) out.push(rulesCell(rs, a, true, n));
    }
    for (const [rs, a] of NON_STANDARD) out.push(rulesCell(rs, a, false, n));
    out.push(rulesCell('mma.unified.3r', 'octagon_30', true, n, 'lenient'));
    out.push(rulesCell('mma.unified.3r', 'octagon_30', true, n, 'strict'));
    return out;
  },
};

/** Every attribute, sub-skill and mental value set to `v` (the §7.4 zero/max cells). */
export function flatFighter(id: string, v: number): FighterDefinition {
  const f = blankFighter(`fighter.${id}`, id);
  const p = f.physical as unknown as Record<string, number>;
  for (const k of Object.keys(p)) p[k] = v;
  const m = f.mental as unknown as Record<string, number>;
  for (const k of Object.keys(m)) m[k] = v;
  const ds = f.disciplines as unknown as Record<string, unknown>;
  for (const d of Object.keys(SUB_SKILLS) as (keyof typeof SUB_SKILLS)[]) {
    const sub: Record<string, number> = {};
    for (const k of SUB_SKILLS[d]) sub[k] = v;
    const base = (ds[d] as Record<string, unknown> | undefined) ?? {};
    ds[d] = { ...base, years: v === 0 ? 0 : 20, trainingQuality: v === 0 ? 0.6 : 1.15, sub };
  }
  return f;
}

function edgeCell(id: string, n: number, extra: Partial<CellTags>, make: Cell['make'], allowInvalid = false): Cell {
  return {
    id: `edge_cases/${id}`,
    plan: 'edge_cases',
    n,
    qa: true,
    allowInvalid,
    tags: tags('edge_cases', 'edge', { qaCase: id, ...extra }),
    make,
  };
}

const EDGE_CASES: Plan = {
  id: 'edge_cases',
  description: '§7.4 hand-built cells: zero stats, max stats, zero vs max, extreme anthropometrics, age 18 vs 45, all-T0 crowd (3v3 street), T5 vs 5xT0 crowd.',
  defaultN: 100,
  cells: (n) => [
    edgeCell('zero_stats', n, { wc: 'open' }, ({ seed }) =>
      ({ config: config1v1(seed, flatFighter('zero_a', 0), flatFighter('zero_b', 0)) }), true),
    edgeCell('max_stats', n, { wc: 'open' }, ({ seed }) =>
      ({ config: config1v1(seed, flatFighter('max_a', 100), flatFighter('max_b', 100)) }), true),
    edgeCell('zero_vs_max', n, { wc: 'open' }, ({ i, seed }) => {
      const s = sided(i, flatFighter('max', 100), flatFighter('zero', 0));
      return { config: config1v1(seed, s.pair[0], s.pair[1]), bt: { edge: s.edge } };
    }, true),
    edgeCell('extreme_anthro', n, { wc: 'open' }, ({ i, seed }) => {
      const base = gen(`${seed}#base`, { tier: 4, weightClass: LW.wc, sex: 'male' });
      const small = clone(base);
      Object.assign(small.body, { heightM: 1.40, reachM: 1.42, legReachM: 0.80, massKg: 45, weighInKg: 45, fightNightKg: 45, naturalWeightKg: 45 });
      small.body.weightClass = weightClassFor(45);
      const big = clone(base);
      Object.assign(big.body, { heightM: 2.10, reachM: 2.16, legReachM: 1.21, massKg: 150, weighInKg: 150, fightNightKg: 150, naturalWeightKg: 150 });
      big.body.weightClass = weightClassFor(150);
      const s = sided(i, big, small);
      return {
        config: config1v1(seed, s.pair[0], s.pair[1], { settings: { weightClass: 'openweight', mismatchMode: 'openweight' } }),
        bt: { edge: s.edge },
      };
    }),
    edgeCell('age_18_vs_45', n, {}, ({ i, seed }) => {
      const base = gen(`${seed}#base`, { tier: 4, weightClass: LW.wc, sex: 'male' });
      const young = clone(base);
      young.body.ageYears = 18;
      const old = clone(base);
      old.body.ageYears = 45;
      const s = sided(i, young, old);
      return { config: config1v1(seed, s.pair[0], s.pair[1]), bt: { edge: s.edge } };
    }),
    edgeCell('crowd_T0_3v3', n, { mode: 'teams', ruleset: 'street', arena: 'street_open' }, ({ seed }) => ({
      config: {
        seed,
        mode: 'teams',
        fighters: [0, 1, 2, 3, 4, 5].map((k) => gen(`${seed}#${k}`, { tier: 0, weightClass: LW.wc, sex: 'male' })),
        teams: { teamOf: [0, 0, 0, 1, 1, 1] },
        ruleset: 'street',
        arena: 'street_open',
        settings: settings({ maxSeconds: 180 }),
      },
    })),
    multiCell('edge_cases', MULTI_SPECS[5], n),
  ],
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// skill_domains (Realism pass): what is a point of each kind of skill worth?
// ---------------------------------------------------------------------------

const STRIKING_ARTS = ['boxing', 'muayThai', 'kickboxing', 'karate', 'taekwondo'];
const GRAPPLING_ARTS = ['wrestling', 'judo', 'bjj', 'sambo'];

function shiftArts(f: FighterDefinition, arts: readonly string[], val: number): void {
  const ds = f.disciplines as unknown as Record<string, { sub: Record<string, number> } | undefined>;
  for (const a of arts) {
    const d = ds[a];
    if (!d) continue;
    for (const k of Object.keys(d.sub)) d.sub[k] = Math.round(clamp(d.sub[k] + val, 1, 99));
  }
}

const DOMAIN_SHIFTS: readonly { id: string; apply: (f: FighterDefinition, v: number) => void }[] = [
  { id: 'striking', apply: (f, v) => shiftArts(f, STRIKING_ARTS, v) },
  { id: 'grappling', apply: (f, v) => shiftArts(f, GRAPPLING_ARTS, v) },
  { id: 'integration', apply: (f, v) => shiftArts(f, ['mmaIntegration', 'mma'], v) },
  { id: 'all', apply: (f, v) => shiftSkills(f, v) },
];

const SKILL_DOMAINS: Plan = {
  id: 'skill_domains',
  description: 'Realism pass: T4 lightweight vs its own clone with one skill domain (striking arts, grappling arts, MMA integration, all) lowered by 10 points; edge side alternates.',
  defaultN: 300,
  cells: (n) => DOMAIN_SHIFTS.map((dsh) => ({
    id: `skill_domains/${dsh.id}/10`,
    plan: 'skill_domains',
    n,
    qa: false,
    tags: tags('skill_domains', 'domain', { tierA: 4, tierB: 4, sweepVar: `domain_${dsh.id}`, sweepVal: 10 }),
    make: ({ i, seed }) => {
      const base = gen(`${seed}#base`, { tier: 4, weightClass: LW.wc, sex: 'male' });
      const weaker = clone(base);
      dsh.apply(weaker, -10);
      const s = sided(i, clone(base), weaker);
      return { config: config1v1(seed, s.pair[0], s.pair[1]), bt: { edge: s.edge } };
    },
  })),
};

export const PLANS: Readonly<Record<string, Plan>> = Object.freeze({
  skill_domains: SKILL_DOMAINS,
  baseline: BASELINE,
  ufc_population: UFC_POPULATION,
  tier_matrix: TIER_MATRIX,
  physical_sweeps: PHYSICAL_SWEEPS,
  style_matrix: STYLE_MATRIX,
  judging: JUDGING,
  multi: MULTI,
  rules_arenas: RULES_ARENAS,
  identical: IDENTICAL,
  edge_cases: EDGE_CASES,
  mma_5r: MMA_5R,
  rematch: REMATCH,
});

/** Cells of the named plans, with per-plan bouts-per-cell. */
export function planCells(ids: readonly string[], nFor: (plan: Plan) => number): Cell[] {
  const out: Cell[] = [];
  for (const id of ids) {
    const plan = PLANS[id];
    if (!plan) throw new Error(`unknown plan "${id}"; have ${Object.keys(PLANS).join(', ')}`);
    out.push(...plan.cells(nFor(plan)));
  }
  const seen = new Set<string>();
  for (const c of out) {
    if (seen.has(c.id)) throw new Error(`duplicate cell id ${c.id}`);
    seen.add(c.id);
  }
  return out;
}

/**
 * Build bout `i` of `cell`: the seed is `boutSeed(planSeed, cell, i)` (09 §6.4),
 * so any row can be reproduced on its own from the plan seed.
 */
export function buildJob(cell: Cell, i: number, planSeed: string, overrides?: SimConfig['paramOverrides']): JobMessage {
  const seed = boutSeed(planSeed, cell.id, i);
  const made = cell.make({ i, seed, planSeed });
  const config: SimConfig = overrides && Object.keys(overrides).length > 0
    ? { ...made.config, paramOverrides: overrides }
    : made.config;
  const valid = config.fighters.map((f) => validateFighter(f).ok);
  if (!cell.allowInvalid && valid.some((v) => !v)) {
    const bad = config.fighters.map((f) => validateFighter(f)).find((r) => !r.ok);
    const why = bad?.issues.filter((x) => x.severity === 'error').map((x) => `${x.path}: ${x.message}`).join('; ');
    throw new Error(`plan ${cell.plan} cell ${cell.id} bout ${i} generated an invalid fighter: ${why}`);
  }
  return {
    type: 'job',
    key: rowKey(cell.id, i),
    cell: cell.id,
    i,
    tags: cell.tags,
    ...(made.bt ? { bt: made.bt } : {}),
    config,
    qa: cell.qa,
    valid,
  };
}
