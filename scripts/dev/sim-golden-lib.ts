/**
 * SIM GOLDEN — the bit-exact regression corpus for the simulation core.
 *
 * `sim-golden.ts` (CLI) and `tests/sim.golden.test.ts` share this file. A case
 * is a deterministic `SimConfig` built from nothing but the sim's own public
 * exports (archetypes, rulesets, arenas), so the corpus cannot drift when the
 * app's fighter generator changes. Each case is run twice:
 *
 *   1. unrecorded, through `simulate()` — the hot path every batch uses — for
 *      the digest, tick count, RNG draw count, result, event log and stats;
 *   2. stepped by hand with a `snapshot()` after every step, exactly as
 *      `simulate({ record: true })` collects frames, hashing every snapshot as
 *      JSON at full float precision (the world digest quantises to 1e-3; the
 *      frame hash does not). The recorded run's digest must equal the
 *      unrecorded one, which also proves that building snapshots never
 *      perturbs the bout.
 *
 * Every hash is SHA-1 over `JSON.stringify`, which prints the shortest decimal
 * that round-trips a double, so any change to any bit of any number shows up.
 */
import { createHash } from 'node:crypto';
import {
  ARCHETYPES, ARENAS, DEFAULT_SETTINGS, RULESETS, SUB_SKILLS, computeStats, createSim, simulate,
  type ArenaId, type FighterDefinition, type MatchMode, type MatchSettings, type RulesetId, type SimConfig,
} from '../../src/sim';

export interface GoldenCase {
  id: string;
  config: SimConfig;
}

export interface GoldenRow {
  id: string;
  digest: string;
  ticks: number;
  rngDraws: number;
  result: string;
  events: string;
  eventCount: number;
  stats: string;
  frames: string;
  frameCount: number;
  /** Digest of the recorded run (must equal `digest`). */
  recordedDigest: string;
}

export interface GoldenFile {
  engineVersion: string;
  cases: number;
  rows: GoldenRow[];
}

const sha = (s: string): string => createHash('sha1').update(s).digest('hex');
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---------------------------------------------------------------------------
// Fighters
// ---------------------------------------------------------------------------

const ARCH = Object.values(ARCHETYPES) as FighterDefinition[];
const ARCH_BY_ID = new Map(ARCH.map((a) => [a.id, a]));
const arch = (id: string): FighterDefinition => {
  const f = ARCH_BY_ID.get(id);
  if (!f) throw new Error(`no archetype ${id}`);
  return f;
};

function withId(f: FighterDefinition, id: string): FighterDefinition {
  const c = clone(f);
  c.id = id;
  c.name = `${f.name} ${id}`;
  c.short = id.slice(0, 3).toUpperCase();
  return c;
}

function flat(id: string, v: number, years: number, base = 'arch.regional_pro_allrounder'): FighterDefinition {
  const f = withId(arch(base), id);
  for (const k of Object.keys(f.physical) as (keyof FighterDefinition['physical'])[]) f.physical[k] = v;
  for (const k of Object.keys(f.mental) as (keyof FighterDefinition['mental'])[]) f.mental[k] = v;
  const d: Record<string, unknown> = {};
  for (const [disc, subs] of Object.entries(SUB_SKILLS)) {
    d[disc] = { years, sub: Object.fromEntries(subs.map((s) => [s, v])) };
  }
  f.disciplines = d as FighterDefinition['disciplines'];
  return f;
}

function mod(id: string, base: string, fn: (f: FighterDefinition) => void): FighterDefinition {
  const f = withId(arch(base), id);
  fn(f);
  return f;
}

function body(id: string, base: string, b: Partial<FighterDefinition['body']>): FighterDefinition {
  return mod(id, base, (f) => { Object.assign(f.body, b); });
}

// ---------------------------------------------------------------------------
// Configs
// ---------------------------------------------------------------------------

interface Opts {
  mode?: MatchMode;
  teamOf?: number[];
  ruleset?: RulesetId;
  arena?: ArenaId;
  settings?: Partial<MatchSettings>;
  paramOverrides?: SimConfig['paramOverrides'];
}

function cfg(seed: string, fighters: FighterDefinition[], o: Opts = {}): SimConfig {
  const mode = o.mode ?? '1v1';
  const teamOf = o.teamOf ?? fighters.map((_, i) => (mode === 'ffa' ? i : Math.min(i, 1)));
  return {
    seed,
    mode,
    fighters,
    teams: { teamOf },
    ruleset: o.ruleset ?? (mode === 'crowd' ? 'street' : 'mma.unified.3r'),
    arena: o.arena ?? (mode === 'crowd' ? 'street_open' : 'octagon_30'),
    settings: { ...DEFAULT_SETTINGS, ...(o.settings ?? {}) },
    ...(o.paramOverrides ? { paramOverrides: o.paramOverrides } : {}),
  };
}

const RULESET_IDS = Object.keys(RULESETS) as RulesetId[];
const ARENA_IDS = Object.keys(ARENAS) as ArenaId[];

/** The full corpus, in a fixed order. Case ids are stable names, not indices. */
export function goldenCases(): GoldenCase[] {
  const out: GoldenCase[] = [];
  const add = (id: string, config: SimConfig): void => { out.push({ id, config }); };
  const n = ARCH.length;

  // A. Every ruleset x a cycle of arenas and archetype pairings (1v1).
  for (let r = 0; r < RULESET_IDS.length; r++) {
    const ruleset = RULESET_IDS[r];
    for (let k = 0; k < 13; k++) {
      const a = ARCH[(r + k) % n];
      const b = ARCH[(r * 3 + k * 7 + 1) % n];
      const arena = ARENA_IDS[(r + k) % ARENA_IDS.length];
      add(`rs:${ruleset}:${k}`, cfg(`golden-rs-${ruleset}-${k}`, [withId(a, 'a'), withId(b, 'b')], { ruleset, arena }));
    }
  }

  // B. Tier ladder: every archetype against two others, 3R and 5R.
  for (let i = 0; i < n; i++) {
    add(`tier3:${i}`, cfg(`golden-tier3-${i}`, [withId(ARCH[i], 'a'), withId(ARCH[(i + 4) % n], 'b')]));
    add(`tier5:${i}`, cfg(`golden-tier5-${i}`, [withId(ARCH[i], 'a'), withId(ARCH[(i + 9) % n], 'b')], { ruleset: 'mma.unified.5r' }));
  }

  // C. Extreme stats.
  const rpa = 'arch.regional_pro_allrounder';
  const extremes: [string, () => FighterDefinition, () => FighterDefinition][] = [
    ['max-v-zero', () => flat('max', 100, 30), () => flat('zero', 0, 0)],
    ['max-v-max', () => flat('mxa', 100, 30), () => flat('mxb', 100, 30)],
    ['zero-v-zero', () => flat('zra', 0, 0), () => flat('zrb', 0, 0)],
    ['flat20', () => flat('fla', 20, 1), () => flat('flb', 20, 1)],
    ['nocardio', () => mod('noc', rpa, (f) => { f.physical.cardio = 0; f.physical.recovery = 0; }), () => withId(arch(rpa), 'rpa')],
    ['glass', () => mod('gls', rpa, (f) => { f.physical.chin = 0; f.physical.neckStrength = 0; f.physical.bodyToughness = 0; }), () => withId(arch(rpa), 'rpa')],
    ['iron', () => mod('irn', rpa, (f) => { f.physical.chin = 100; f.physical.neckStrength = 100; f.physical.bodyToughness = 100; }), () => withId(arch('arch.heavyweight_power_puncher'), 'hwp')],
    ['wild', () => mod('wld', rpa, (f) => { f.mental.aggression = 100; f.mental.discipline = 0; }), () => withId(arch('arch.counter_striker'), 'ctr')],
    ['nodisc', () => mod('emp', rpa, (f) => { f.disciplines = {} as FighterDefinition['disciplines']; }), () => withId(arch(rpa), 'rpa')],
    ['slow', () => mod('slw', rpa, (f) => { f.physical.reactionTime = 0; }), () => withId(arch('arch.flyweight_volume_striker'), 'fvs')],
  ];
  for (const [name, a, b] of extremes) {
    add(`ext3:${name}`, cfg(`golden-ext3-${name}`, [a(), b()]));
    add(`ext5:${name}`, cfg(`golden-ext5-${name}`, [a(), b()], { ruleset: 'mma.unified.5r', arena: 'octagon_25' }));
  }

  // D. Extreme bodies.
  const bodies: [string, () => FighterDefinition, () => FighterDefinition][] = [
    ['tiny-v-giant', () => body('tny', 'arch.flyweight_volume_striker', { heightM: 1.5, reachM: 1.48, legReachM: 0.84, massKg: 50, weighInKg: 50, fightNightKg: 50 }),
      () => body('gnt', 'arch.heavyweight_power_puncher', { heightM: 2.18, reachM: 2.3, legReachM: 1.3, massKg: 160, weighInKg: 158, fightNightKg: 160 })],
    ['old-v-young', () => body('old', 'arch.ageing_veteran', { ageYears: 48 }), () => body('yng', 'arch.tkd_convert', { ageYears: 18 })],
    ['fat-v-lean', () => body('fat', 'arch.brand_new_brawler', { bodyFatPct: 40 }), () => body('len', 'arch.thai_striker', { bodyFatPct: 4 })],
    ['longarms', () => body('lng', 'arch.counter_striker', { reachM: 2.2 }), () => body('shr', 'arch.pressure_boxer', { reachM: 1.55 })],
    ['heavy-grap', () => body('hgr', 'arch.sambo_grappler', { massKg: 130, fightNightKg: 130, weighInKg: 125 }), () => withId(arch('arch.bjj_guard_player'), 'bjj')],
    ['southpaw', () => body('sth', 'arch.judoka', { stance: 'southpaw', handedness: 'left' }), () => body('swt', 'arch.elite_wrestler_boxer', { stance: 'switch' })],
  ];
  for (const [name, a, b] of bodies) {
    add(`body3:${name}`, cfg(`golden-body3-${name}`, [a(), b()]));
    add(`body5:${name}`, cfg(`golden-body5-${name}`, [a(), b()], { ruleset: 'mma.unified.5r', arena: 'ring_20' }));
  }

  // E. Multi-fighter modes.
  const roster = (id: string, k: number, pfx: string) => Array.from({ length: k }, (_, i) => withId(arch(id), `${pfx}${i}`));
  for (const [a, b] of [[1, 2], [1, 3], [1, 5], [2, 2], [3, 3]] as const) {
    for (let s = 0; s < 4; s++) {
      const hero = s % 2 === 0 ? 'arch.champion_complete' : rpa;
      const f = [...roster(hero, a, 'a'), ...roster(s < 2 ? 'arch.brand_new_brawler' : rpa, b, 'b')];
      add(`teams:${a}v${b}:${s}`, cfg(`golden-teams-${a}v${b}-${s}`, f, {
        mode: 'teams', teamOf: f.map((_, i) => (i < a ? 0 : 1)),
        ruleset: s === 3 ? 'mma.unified.5r' : 'mma.unified.3r', arena: s % 2 ? 'octagon_25' : 'octagon_30',
      }));
    }
  }
  for (const k of [3, 4, 6]) {
    for (let s = 0; s < 4; s++) {
      const f = Array.from({ length: k }, (_, i) => withId(ARCH[(i * 2 + s) % n], `f${i}`));
      add(`ffa:${k}:${s}`, cfg(`golden-ffa-${k}-${s}`, f, { mode: 'ffa' }));
    }
  }
  for (const k of [2, 5, 8]) {
    for (let s = 0; s < 3; s++) {
      const f = [withId(arch('arch.champion_complete'), 'def'), ...roster(s === 2 ? 'arch.brand_new_brawler' : rpa, k, 'at')];
      add(`crowd:1v${k}:${s}`, cfg(`golden-crowd-${k}-${s}`, f, {
        mode: 'crowd', teamOf: f.map((_, i) => (i === 0 ? 0 : 1)),
        arena: s === 1 ? 'street_grass' : 'street_open', settings: { maxSeconds: 180 },
      }));
    }
  }
  add('crowd:untimed', cfg('golden-crowd-untimed', [withId(arch(rpa), 'def'), ...roster(rpa, 3, 'at')], { mode: 'crowd', teamOf: [0, 1, 1, 1] }));

  // F. Street 1v1.
  for (let s = 0; s < 6; s++) {
    add(`street:${s}`, cfg(`golden-street-${s}`, [withId(ARCH[s], 'a'), withId(ARCH[(s + 6) % n], 'b')], {
      ruleset: 'street', arena: s % 2 ? 'street_grass' : 'street_open', settings: { maxSeconds: 120 + 30 * s },
    }));
  }

  // G. Settings that change the fight.
  const settings: [string, Partial<MatchSettings>, RulesetId?][] = [
    ['arcade', { damageRealism: 'arcade' }],
    ['ironman', { damageRealism: 'ironman' }],
    ['lenient', { refereeStrictness: 'lenient' }],
    ['strict', { refereeStrictness: 'strict' }],
    ['open-judging', { judgingMode: 'open' }],
    ['legacy', { judgeCulture: 'legacy_2016' }],
    ['thai', { judgeCulture: 'thai_stadium' }, 'muay_thai.stadium'],
    ['glory', { judgeCulture: 'glory' }, 'kickboxing.glory'],
    ['abc', { judgeCulture: 'boxing_abc' }, 'boxing.pro'],
    ['whole', { judgeCulture: 'whole_fight' }],
    ['rounds1', { rounds: 1, roundSeconds: 240 }],
    ['rounds7', { rounds: 7, roundSeconds: 120, restSeconds: 30 }],
    ['home', { homeFighter: 1 }],
    ['classed', { weightClass: 'lightweight', weighIn: 'sameDay', mismatchMode: 'classed' }],
    ['daybefore', { weightClass: 'welterweight', weighIn: 'dayBefore', mismatchMode: 'classed' }],
  ];
  for (const [name, s, ruleset] of settings) {
    add(`set:${name}`, cfg(`golden-set-${name}`, [withId(arch('arch.elite_wrestler_boxer'), 'a'), withId(arch('arch.thai_striker'), 'b')], { settings: s, ruleset }));
  }

  // H. Parameter overrides and timestep.
  add('dt:50', cfg('golden-dt-50', [withId(arch(rpa), 'a'), withId(arch('arch.pressure_boxer'), 'b')], { paramOverrides: { 'core.dtMs': 50 } }));
  add('dt:200', cfg('golden-dt-200', [withId(arch(rpa), 'a'), withId(arch('arch.pressure_boxer'), 'b')], { paramOverrides: { 'core.dtMs': 200 } }));
  add('dt:50:teams', cfg('golden-dt-50-teams', [withId(arch(rpa), 'a'), ...roster(rpa, 2, 'b')], { mode: 'teams', teamOf: [0, 1, 1], paramOverrides: { 'core.dtMs': 50 } }));

  return out;
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

export function runGoldenCase(c: GoldenCase): GoldenRow {
  // 1. The unrecorded hot path.
  const run = simulate(clone(c.config));

  // 2. Recorded: a snapshot before the first step, after each step and after
  //    the end, exactly as simulate({ record: true }) collects them.
  const recCfg = clone(c.config);
  const sim = createSim(recCfg);
  const h = createHash('sha1');
  let frames = 0;
  const push = (): void => { h.update(JSON.stringify(sim.snapshot())); h.update('\n'); frames++; };
  push();
  while (sim.step()) push();
  push();
  const recStats = computeStats([...sim.events], recCfg, sim.tick);
  const recordedDigest = JSON.stringify(recStats) === JSON.stringify(run.stats) ? sim.digest : `stats-differ:${sim.digest}`;

  return {
    id: c.id,
    digest: run.digest,
    ticks: run.ticks,
    rngDraws: run.rngDraws,
    result: sha(JSON.stringify(run.result)),
    events: sha(JSON.stringify(run.events)),
    eventCount: run.events.length,
    stats: sha(JSON.stringify(run.stats)),
    frames: h.digest('hex'),
    frameCount: frames,
    recordedDigest,
  };
}

/** Human-readable differences between two rows (empty when identical). */
export function diffRow(want: GoldenRow, got: GoldenRow): string[] {
  const out: string[] = [];
  for (const k of Object.keys(want) as (keyof GoldenRow)[]) {
    if (want[k] !== got[k]) out.push(`${k}: expected ${String(want[k])}, got ${String(got[k])}`);
  }
  if (got.recordedDigest !== got.digest) out.push(`recorded run digest ${got.recordedDigest} != unrecorded ${got.digest}`);
  return out;
}
