/**
 * PHASE 9 EDGE-CASE QA — docs/design/QA_FINDINGS.md.
 *
 * Invariants and directions only, never exact numbers: the calibration pass is
 * tuning the sim underneath these tests, so a threshold here is either a hard
 * invariant (no NaN, a result is internally consistent, a replay verifies) or a
 * direction with a wide margin (an all-100 fighter beats an all-0 fighter).
 *
 * Tests marked `it.fails` pin a confirmed bug: they fail today, so the suite
 * stays green, and they will start "failing to fail" (turning the suite red)
 * the moment the bug is fixed — at which point drop the `.fails`. `it.todo`
 * marks a confirmed finding that cannot be pinned cheaply or robustly.
 *
 * Bouts are capped with `maxTicks` wherever the check does not need the full
 * distance, to keep the file well under a minute.
 */
import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES, DEFAULT_SETTINGS, SUB_SKILLS, createSim, simulate, toReplayFile, verifyReplay,
  type BoutResult, type FighterDefinition, type MatchMode, type SimConfig, type TickSnapshot,
} from '../src/sim';
import { validateFighter } from '../src/app/store/validate';
import { buildSimConfig, defaultDraft, slotCount, teamAssignmentFor } from '../src/app/model/matchModel';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const ALL = Object.values(ARCHETYPES) as FighterDefinition[];
const arch = (id: string): FighterDefinition => {
  const f = ALL.find((a) => a.id === id);
  if (!f) throw new Error(`no archetype ${id}`);
  return f;
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const withId = (f: FighterDefinition, id: string): FighterDefinition => {
  const c = clone(f);
  c.id = id;
  c.name = `${f.name} ${id}`;
  c.short = id.slice(0, 3).toUpperCase();
  return c;
};
const RPA = arch('arch.regional_pro_allrounder');

/** Every physical, mental and sub-skill number at `v`, every art at `years`. */
function flat(id: string, v: number, years: number): FighterDefinition {
  const f = withId(RPA, id);
  for (const k of Object.keys(f.physical) as (keyof FighterDefinition['physical'])[]) f.physical[k] = v;
  for (const k of Object.keys(f.mental) as (keyof FighterDefinition['mental'])[]) f.mental[k] = v;
  const d: Record<string, unknown> = {};
  for (const [art, subs] of Object.entries(SUB_SKILLS)) {
    d[art] = { years, sub: Object.fromEntries(subs.map((s) => [s, v])) };
  }
  f.disciplines = d as FighterDefinition['disciplines'];
  return f;
}

function config(
  seed: string, fighters: FighterDefinition[],
  o: { mode?: MatchMode; teamOf?: number[]; ruleset?: string; arena?: string; settings?: Partial<SimConfig['settings']> } = {},
): SimConfig {
  const mode = o.mode ?? '1v1';
  return {
    seed,
    mode,
    fighters,
    teams: { teamOf: o.teamOf ?? fighters.map((_, i) => (mode === 'ffa' ? i : Math.min(i, 1))) },
    ruleset: (o.ruleset ?? (mode === 'crowd' ? 'street' : 'mma.unified.3r')) as SimConfig['ruleset'],
    arena: (o.arena ?? (mode === 'crowd' ? 'street_open' : 'octagon_30')) as SimConfig['arena'],
    settings: { ...DEFAULT_SETTINGS, ...(o.settings ?? {}) },
  };
}

function snapshotProblems(s: TickSnapshot): string[] {
  const out: string[] = [];
  for (const f of s.fighters) {
    const nums: [string, number, boolean][] = [
      ['x', f.x, false], ['z', f.z, false], ['facing', f.facing, false], ['vx', f.vx, false], ['vz', f.vz, false],
      ['stamina.total', f.stamina.total, true], ['stamina.burst', f.stamina.burst, true],
      ['damage.head', f.damage.head, true], ['damage.body', f.damage.body, true],
      ['damage.legs', f.damage.legs, true], ['damage.cut', f.damage.cut, true], ['balance', f.balance, true],
      ['sub.progress', f.sub.progress, true],
    ];
    for (const [k, v, nonNeg] of nums) {
      if (!Number.isFinite(v)) out.push(`t${s.tick} f${f.id} ${k}=${v}`);
      else if (nonNeg && v < -1e-9) out.push(`t${s.tick} f${f.id} ${k}=${v} < 0`);
    }
    if (Math.abs(f.x) > 1000 || Math.abs(f.z) > 1000) out.push(`t${s.tick} f${f.id} runaway position`);
  }
  return out;
}

interface Checked { result: BoutResult; ticks: number; digest: string; draws: number; problems: string[]; events: number }

/** Step a bout, scanning a snapshot every `every` ticks. */
function runChecked(c: SimConfig, maxTicks?: number, every = 10): Checked {
  const sim = createSim(c, maxTicks ? { maxTicks } : {});
  const problems = snapshotProblems(sim.snapshot());
  while (sim.step()) {
    if (sim.tick % every === 0 && problems.length < 10) problems.push(...snapshotProblems(sim.snapshot()));
    if (maxTicks && sim.tick >= maxTicks) break;
  }
  const result = maxTicks ? sim.runToEnd(maxTicks) : (sim.result as BoutResult);
  problems.push(...snapshotProblems(sim.snapshot()));
  return { result, ticks: sim.tick, digest: sim.digest, draws: sim.rngDraws, problems, events: sim.events.length };
}

/** Bookkeeping every result must satisfy, whatever the tuning. */
function resultProblems(r: BoutResult, c: SimConfig): string[] {
  const p: string[] = [];
  if (!r) return ['no result'];
  const n = c.fighters.length;
  if (typeof r.winner === 'number') {
    if (r.winner < 0 || r.winner >= n) p.push(`winner ${r.winner} out of range`);
    else if (r.winningTeam !== null && c.teams.teamOf[r.winner] !== r.winningTeam) {
      p.push(`winner ${r.winner} is on team ${c.teams.teamOf[r.winner]}, winningTeam ${r.winningTeam}`);
    }
  }
  if (r.winningTeam !== null && !c.teams.teamOf.includes(r.winningTeam)) p.push(`winningTeam ${r.winningTeam} unknown`);
  if (!Number.isFinite(r.totalSeconds) || r.totalSeconds < 0) p.push(`totalSeconds ${r.totalSeconds}`);
  if (!Number.isFinite(r.timeSeconds) || r.timeSeconds < 0) p.push(`timeSeconds ${r.timeSeconds}`);
  if (r.round < 1) p.push(`round ${r.round}`);
  const decided = r.method.startsWith('decision') || r.method.startsWith('draw');
  if (decided && c.mode === '1v1') {
    if (r.scorecards.length === 0) p.push('decision without scorecards');
    r.scorecards.forEach((card, j) => {
      const sum = card.reduce((a, rd) => [a[0] + rd[0], a[1] + rd[1]], [0, 0]);
      const tot = r.judgeTotals[j];
      if (tot && (tot[0] !== sum[0] || tot[1] !== sum[1])) p.push(`judge ${j} total ${tot} != ${sum}`);
    });
    const votes = r.judgeTotals.map((t) => (t[0] > t[1] ? 0 : t[1] > t[0] ? 1 : -1));
    const w0 = votes.filter((v) => v === 0).length;
    const w1 = votes.filter((v) => v === 1).length;
    const isDraw = w0 === w1 || votes.filter((v) => v === -1).length >= 2;
    if (r.method.startsWith('draw') !== isDraw) p.push(`method ${r.method} vs totals ${JSON.stringify(r.judgeTotals)}`);
    if (!isDraw && r.winner !== (w0 > w1 ? 0 : 1)) p.push(`winner ${r.winner} vs totals ${JSON.stringify(r.judgeTotals)}`);
  }
  if (!decided && r.winner === 'draw' && r.method !== 'timeLimit' && r.method !== 'separated') {
    p.push(`finish ${r.method} with a draw`);
  }
  return p;
}

// ---------------------------------------------------------------------------
// 1. multi-fighter modes
// ---------------------------------------------------------------------------

describe('QA 1: 1vN, teams, ffa and crowd complete cleanly', () => {
  const shapes: [string, MatchMode, number[]][] = [
    ['1v2', 'teams', [0, 1, 1]],
    ['1v5', 'teams', [0, 1, 1, 1, 1, 1]],
    ['3v3', 'teams', [0, 0, 0, 1, 1, 1]],
    ['ffa4', 'ffa', [0, 1, 2, 3]],
    ['crowd3', 'crowd', [0, 1, 1, 1]],
  ];
  for (const [label, mode, teamOf] of shapes) {
    it(`${label}: ends with a consistent result and finite state (2 seeds, capped)`, () => {
      for (let s = 0; s < 2; s++) {
        const fs = teamOf.map((_, i) => withId(i === 0 ? arch('arch.champion_complete') : RPA, `f${i}`));
        const c = config(`qa-t-${label}-${s}`, fs, { mode, teamOf, settings: mode === 'crowd' ? { maxSeconds: 60 } : {} });
        const r = runChecked(c, 1500);
        expect(r.problems, `${label} seed ${s}`).toEqual([]);
        expect(resultProblems(r.result, c), `${label} seed ${s}`).toEqual([]);
      }
    });
  }

  it('app match model: 1v5 preset lays out six slots on two teams', () => {
    const shape = { ...defaultDraft('x'), mode: 'teams' as const, teamPreset: '1v5' as const };
    expect(slotCount(shape)).toBe(6);
    expect(teamAssignmentFor(shape).teamOf).toEqual([0, 1, 1, 1, 1, 1]);
    // An out-of-range crowd/ffa size is clamped rather than crashing the setup screen.
    expect(slotCount({ ...shape, mode: 'ffa', ffaCount: Number.NaN })).toBe(2);
    expect(slotCount({ ...shape, mode: 'crowd', crowdAttackers: 99 })).toBe(9);
  });

  it('app match model: refuses empty seeds, empty slots and duplicate fighters with messages', () => {
    const lookup = (id: string) => (id === 'a' || id === 'b' ? withId(RPA, id) : undefined);
    const empty = buildSimConfig({ ...defaultDraft('  '), slots: [null, 'a'] }, lookup);
    expect(empty.config).toBeNull();
    expect(empty.problems.join(' ')).toMatch(/seed/);
    expect(empty.problems.join(' ')).toMatch(/no fighter/);
    const dup = buildSimConfig({ ...defaultDraft('s'), slots: ['a', 'a'] }, lookup);
    expect(dup.config).toBeNull();
    expect(dup.problems.join(' ')).toMatch(/same fighter/);
    const ghost = buildSimConfig({ ...defaultDraft('s'), slots: ['a', 'zzz'] }, lookup);
    expect(ghost.problems.join(' ')).toMatch(/zzz/);
  });

  // QA-1 (critical): the referee latches `ended` after the first stoppage in a
  // bout with more than two fighters (src/sim/rules/referee.ts:726), so bind.ts
  // (~1580) re-marks the same loser out and re-emits `fighterOut` every tick,
  // and no later KO/TKO/count/stand-up is ever officiated.
  it('QA-1: a fighter is stopped at most once, and later stoppages still happen', () => {
    let checked = false;
    for (let s = 0; s < 4 && !checked; s++) {
      const fs = [0, 1, 2, 3, 4, 5].map((i) => withId(RPA, `t${i}`));
      // Full length (Phase 9): after the calibration pass a 3v3 of regional
      // pros rarely has two stoppages inside the first 2,500 ticks, so the
      // cap is the full three rounds; the assertions are unchanged.
      const sim = createSim(config(`qa-multi-3v3-${s}`, fs, { mode: 'teams', teamOf: [0, 0, 0, 1, 1, 1] }), { maxTicks: 10200 });
      sim.runToEnd(10200);
      const outs = sim.events.filter((e) => e.kind === 'fighterOut');
      if (outs.length === 0) continue;
      checked = true;
      const perFighter = new Map<number, number>();
      for (const e of outs) perFighter.set(e.actor, (perFighter.get(e.actor) ?? 0) + 1);
      expect(Math.max(...perFighter.values())).toBe(1);
      const firstOut = outs[0].tick;
      // The referee keeps officiating: some referee event after the first stoppage.
      expect(sim.events.some((e) => e.tick > firstOut + 1 && e.kind.startsWith('referee'))).toBe(true);
    }
    expect(checked).toBe(true);
  });

  // QA-3 (major): an untimed crowd/street bout that reaches the cap is recorded
  // as "separated" (09 §3.1: an indecisive ending) but `decideIfUnfinished`
  // (src/sim/core/bind.ts ~1640) awards it to the side with more live fighters.
  it('QA-3: a crowd bout that ends "separated" has no winning side', () => {
    const fs = [withId(RPA, 'def'), withId(RPA, 'a1'), withId(RPA, 'a2')];
    const c = config('qa-crowd-sep', fs, { mode: 'crowd', teamOf: [0, 1, 1], settings: { maxSeconds: 30 } });
    const r = createSim(c).runToEnd();
    expect(r.method).toBe('separated');
    expect(r.winningTeam).toBeNull();
  });

  // QA-2 (major): `streetTick` (src/sim/rules/referee.ts:1557) is never called
  // and the street ruleset has no referee, so under `street` a knocked-out
  // fighter is never stopped: crowd bouts always run to the cap.
  it('QA-2: street / crowd bouts can end by incapacitation or flight', () => {
    const methods: string[] = [];
    for (let s = 0; s < 4; s++) {
      const fs = [withId(arch('arch.champion_complete'), 'def'), withId(arch('arch.brand_new_brawler'), 'a1'), withId(arch('arch.brand_new_brawler'), 'a2')];
      const c = config(`qa-crowd-end-${s}`, fs, { mode: 'crowd', teamOf: [0, 1, 1], settings: { maxSeconds: 180 } });
      methods.push(createSim(c).runToEnd().method);
    }
    expect(methods.some((m) => m === 'allOpponentsStopped' || m === 'escaped')).toBe(true);
  });

  // QA-4 (fixed in Phase 9): teams on the bell are judged on 09 §4.3 team
  // scoring (summed §06 effective-scoring counters per round), not
  // "headcount x 1000 + sig strikes".
  it('QA-4: teams on the bell are judged on team scoring (09 §4.3)', () => {
    const fs = [0, 1, 2, 3].map((i) => withId(RPA, `q4${i}`));
    const c = config('qa-4-bell', fs, { mode: 'teams', teamOf: [0, 0, 1, 1], settings: { rounds: 1, roundSeconds: 45 } });
    const r = simulate(c).result;
    if (r.method === 'timeLimit' || r.method === 'draw') {
      expect(['team scoring', 'team scores level']).toContain(r.detail);
    }
  });
  it.todo('QA-9: a submission in a bout with >2 fighters marks the loser out instead of ending the whole bout (bind.ts resolveSubmissionContact finishBout)');
});

// ---------------------------------------------------------------------------
// 2. extreme stats and 7. tiers
// ---------------------------------------------------------------------------

describe('QA 2: extreme attributes', () => {
  const pairs: [string, () => FighterDefinition, () => FighterDefinition][] = [
    ['all-100 vs all-0', () => flat('max', 100, 30), () => flat('zero', 0, 0)],
    ['all-0 mirror', () => flat('z1', 0, 0), () => flat('z2', 0, 0)],
    ['all-100 mirror', () => flat('m1', 100, 30), () => flat('m2', 100, 30)],
    ['no disciplines vs RPA', () => { const f = withId(RPA, 'e'); f.disciplines = {} as FighterDefinition['disciplines']; return f; }, () => withId(RPA, 'r')],
    ['zero cardio/chin/recovery vs RPA', () => { const f = withId(RPA, 'g'); Object.assign(f.physical, { cardio: 0, chin: 0, recovery: 0, bodyToughness: 0, neckStrength: 0 }); return f; }, () => withId(RPA, 'r')],
    ['1 cm, 10 g, age 0.01 (validator-legal) vs RPA', () => { const f = withId(RPA, 'tiny'); Object.assign(f.body, { heightM: 0.01, reachM: 0.01, legReachM: 0.01, massKg: 0.01, ageYears: 0.01 }); delete f.body.weighInKg; delete f.body.fightNightKg; delete f.body.naturalWeightKg; return f; }, () => withId(RPA, 'r')],
    ['3 m, 500 kg, age 120 vs RPA', () => { const f = withId(RPA, 'huge'); Object.assign(f.body, { heightM: 3, reachM: 3.5, legReachM: 2, massKg: 500, ageYears: 120 }); delete f.body.weighInKg; delete f.body.fightNightKg; delete f.body.naturalWeightKg; return f; }, () => withId(RPA, 'r')],
  ];
  for (const [label, a, b] of pairs) {
    it(`${label}: no crash, no NaN, no negative condition (2 seeds, capped)`, () => {
      for (let s = 0; s < 2; s++) {
        const c = config(`qa-x-${label}-${s}`, [a(), b()]);
        const r = runChecked(c, 4000);
        expect(r.problems, `${label} seed ${s}`).toEqual([]);
        expect(resultProblems(r.result, c), `${label} seed ${s}`).toEqual([]);
      }
    });
  }

  it('an all-100 fighter beats an all-0 fighter nearly always (10 seeds)', () => {
    let wins = 0;
    for (let s = 0; s < 10; s++) {
      const r = simulate(config(`qa-dir-max-${s}`, [flat('max', 100, 30), flat('zero', 0, 0)]));
      if (r.result.winner === 0) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(9);
  });

  it('QA 7: elite skills beat novice skills on an identical body (12 seeds, >= 75 %)', () => {
    const skilled = (id: string, v: number, years: number) => {
      const f = flat(id, 60, years);
      for (const d of Object.values(f.disciplines)) {
        for (const k of Object.keys(d!.sub)) (d!.sub as Record<string, number>)[k] = v;
      }
      return f;
    };
    let wins = 0;
    for (let s = 0; s < 12; s++) {
      const r = simulate(config(`qa-tier-${s}`, [skilled('elite', 90, 15), skilled('novice', 10, 0)]));
      if (r.result.winner === 0) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(9);
  });
});

// ---------------------------------------------------------------------------
// 4. determinism
// ---------------------------------------------------------------------------

describe('QA 4: determinism', () => {
  const base = (seed = 'qa-det-1') =>
    config(seed, [withId(arch('arch.elite_wrestler_boxer'), 'a'), withId(arch('arch.thai_striker'), 'b')]);
  const sig = (c: SimConfig, cap = 3000) => {
    const r = runChecked(c, cap, 1000);
    return JSON.stringify([r.digest, r.ticks, r.draws, r.events, r.result]);
  };

  it('same seed and config give the same digest, in every mode', () => {
    const cfgs = [
      base(),
      config('qa-det-1v5', [withId(RPA, 'h'), ...[0, 1, 2, 3, 4].map((i) => withId(RPA, `g${i}`))], { mode: 'teams', teamOf: [0, 1, 1, 1, 1, 1] }),
      config('qa-det-ffa', [0, 1, 2].map((i) => withId(RPA, `f${i}`)), { mode: 'ffa' }),
      config('qa-det-crowd', [0, 1, 2].map((i) => withId(RPA, `c${i}`)), { mode: 'crowd', teamOf: [0, 1, 1], settings: { maxSeconds: 30 } }),
    ];
    for (const c of cfgs) expect(sig(clone(c))).toBe(sig(clone(c)));
  });

  it('is independent of bouts run before it, of key order, of Math.random and of the wall clock', () => {
    const want = sig(base());
    sig(config('noise', [withId(arch('arch.judoka'), 'x'), withId(arch('arch.sambo_grappler'), 'y')]), 800);
    const reversed = (v: unknown): unknown => Array.isArray(v) ? v.map(reversed) : v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reversed(x)])) : v;
    const rc = base();
    rc.fighters = rc.fighters.map((f) => reversed(f) as FighterDefinition);
    expect(sig(rc)).toBe(want);

    const rnd = Math.random;
    const now = Date.now;
    let calls = 0;
    Math.random = () => { calls++; return 0.123; };
    Date.now = () => { calls++; return 1e12; };
    try {
      expect(sig(base())).toBe(want);
    } finally {
      Math.random = rnd;
      Date.now = now;
    }
    expect(calls).toBe(0);
  });

  it('does not mutate its input config', () => {
    const c = base();
    const before = JSON.stringify(c);
    runChecked(c, 1500, 1000);
    expect(JSON.stringify(c)).toBe(before);
  });

  it('a replay survives a JSON round trip and verifies; a tampered one does not', () => {
    const c = config('qa-det-replay', [flat('a', 100, 30), flat('b', 0, 0)]);
    const run = simulate(c);
    const file = JSON.parse(JSON.stringify(toReplayFile(run)));
    expect(verifyReplay(file).verified).toBe(true);
    const tampered = clone(file);
    tampered.fighters[1].physical.chin = 99;
    expect(verifyReplay(tampered).verified).toBe(false);
  });

  it('odd seeds (empty, unicode, 100k chars) run and diverge from each other', () => {
    const digests = ['', 'ü🥊', 'x'.repeat(100_000)].map((seed) => runChecked(base(seed), 600, 1000).digest);
    expect(new Set(digests).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 5. rules
// ---------------------------------------------------------------------------

describe('QA 5: rules edge cases', () => {
  it('3- and 5-round MMA results are internally consistent (rounds, clock, cards, method)', () => {
    for (const [rs, rounds] of [['mma.unified.3r', 3], ['mma.unified.5r', 5]] as const) {
      for (let s = 0; s < 6; s++) {
        const c = config(`qa-rules-${rs}-${s}`, [withId(RPA, 'a'), withId(arch('arch.counter_striker'), 'b')], { ruleset: rs });
        const r = simulate(c).result;
        expect(resultProblems(r, c), `${rs} seed ${s}`).toEqual([]);
        expect(r.round).toBeLessThanOrEqual(rounds);
        expect(r.timeSeconds).toBeLessThanOrEqual(300 + 1e-6);
        expect(r.totalSeconds).toBeCloseTo((r.round - 1) * 360 + r.timeSeconds, 1);
      }
    }
  });

  it('the settings.rounds override is honoured (1 round, 60 s)', () => {
    const c = config('qa-rounds-override', [flat('a', 20, 1), flat('b', 20, 1)], { settings: { rounds: 1, roundSeconds: 60 } });
    const r = simulate(c).result;
    expect(r.round).toBe(1);
    expect(r.totalSeconds).toBeLessThanOrEqual(60 + 1e-6);
  });

  // QA-5 (major): grappling rulesets map to the MMA striking family in
  // src/sim/ai/actions.ts:171-173, so the AI throws punches under IBJJF/ADCC/
  // judo; bind.ts (~967) records each as a `foul` and drops it.
  it('QA-5: nobody throws strikes under IBJJF rules', () => {
    const c = config('qa-ibjjf', [withId(arch('arch.bjj_guard_player'), 'a'), withId(arch('arch.thai_striker'), 'b')], { ruleset: 'grappling.ibjjf', arena: 'mat_ibjjf' });
    const sim = createSim(c, { maxTicks: 3000 });
    sim.runToEnd(3000);
    expect(sim.events.filter((e) => e.kind === 'foul').length).toBe(0);
  });

  // QA-6 (fixed in Phase 9): detected fouls reach the referee's ladder.
  it('QA-6: a foul in a boxing bout draws a warning or a deduction', () => {
    let fouls = 0;
    let sanctions = 0;
    for (let s = 0; s < 8; s++) {
      const fs = [withId(arch('arch.champion_complete'), 'a'), withId(arch('arch.brand_new_brawler'), 'b')];
      const sim = createSim(config(`qa6-${s}`, fs, { ruleset: 'boxing.pro', arena: 'ring_20' }));
      sim.runToEnd();
      fouls += sim.events.filter((e) => e.kind === 'foul').length;
      sanctions += sim.events.filter((e) => e.kind === 'refereeWarning' || e.kind === 'deduction').length;
    }
    expect(fouls).toBeGreaterThan(0);
    expect(sanctions).toBeGreaterThan(0);
  });
  // QA-11 (fixed in Phase 9): a sub-only bout without a submission is a draw.
  it('QA-11: grappling.subonly ends a sub-less bout as a draw, not "timeLimit"', () => {
    const fs = [withId(RPA, 'a'), withId(RPA, 'b')];
    const sim = createSim(config('qa-11', fs, { ruleset: 'grappling.subonly', arena: 'mat_ibjjf' }), { maxTicks: 300 });
    const r = sim.runToEnd(300);
    if (r.method !== 'submission') {
      expect(r.method).toBe('draw');
      expect(r.winner).toBe('draw');
    }
  });
});

// ---------------------------------------------------------------------------
// 6. customisation
// ---------------------------------------------------------------------------

describe('QA 6: fighter validation', () => {
  const bad: [string, (f: any) => void, RegExp][] = [
    ['height -1', (f) => { f.body.heightM = -1; }, /^body\.heightM$/],
    ['height NaN', (f) => { f.body.heightM = Number.NaN; }, /^body\.heightM$/],
    ['height "tall"', (f) => { f.body.heightM = 'tall'; }, /^body\.heightM$/],
    ['mass 0', (f) => { f.body.massKg = 0; }, /^body\.massKg$/],
    ['strength 101', (f) => { f.physical.strength = 101; }, /^physical\.strength$/],
    ['cardio Infinity', (f) => { f.physical.cardio = Infinity; }, /^physical\.cardio$/],
    ['physical missing', (f) => { delete f.physical; }, /^physical$/],
    ['sub-skill 150', (f) => { f.disciplines.boxing.sub.jab = 150; }, /^disciplines\.boxing\.sub\.jab$/],
    ['years -3', (f) => { f.disciplines.boxing.years = -3; }, /^disciplines\.boxing\.years$/],
    ['unknown art', (f) => { f.disciplines.capoeira = { years: 1, sub: {} }; }, /^disciplines\.capoeira$/],
    ['stance', (f) => { f.body.stance = 'crane'; }, /^body\.stance$/],
    ['disciplines null', (f) => { f.disciplines = null; }, /^disciplines$/],
    ['pressureBias 101', (f) => { f.style.pressureBias = 101; }, /^style\.pressureBias$/],
  ];
  for (const [label, mut, path] of bad) {
    it(`rejects ${label} with a field path and a message, without throwing`, () => {
      const f = clone(RPA) as any;
      if (!f.disciplines.boxing) f.disciplines.boxing = { years: 1, sub: Object.fromEntries(SUB_SKILLS.boxing.map((s) => [s, 50])) };
      mut(f);
      const v = validateFighter(f);
      expect(v.ok).toBe(false);
      const errs = v.issues.filter((i) => i.severity === 'error');
      expect(errs.some((e) => path.test(e.path) && e.message.length > 5), JSON.stringify(errs)).toBe(true);
    });
  }

  it('accepts every discipline at 0 years / 0 skill and at 60 years / 100 skill (warnings allowed)', () => {
    for (const [v, y] of [[0, 0], [100, 60]] as const) {
      const f = withId(RPA, 'x');
      for (const [art, subs] of Object.entries(SUB_SKILLS)) {
        (f.disciplines as Record<string, unknown>)[art] = { years: y, sub: Object.fromEntries(subs.map((s) => [s, v])) };
      }
      expect(validateFighter(f).ok).toBe(true);
    }
  });

  it('never throws on garbage input', () => {
    for (const g of [null, undefined, 42, 'x', [], {}, { body: 1, physical: [], disciplines: 'no' }]) {
      expect(() => validateFighter(g)).not.toThrow();
      expect(validateFighter(g).ok).toBe(false);
    }
  });

  // QA-12 (minor): style.pacing outputMult / riskAppetite are only checked for
  // finiteness (src/app/store/validate.ts ~948), so 1e9 or -5 is accepted.
  it('QA-12: pacing multipliers are range-checked', () => {
    const f = withId(RPA, 'p');
    f.style.pacing = [{ round: 1, outputMult: -5, riskAppetite: 1e9 }];
    expect(validateFighter(f).ok).toBe(false);
  });

  // QA-13 (minor): body sizes the sim cannot mean (1 cm, 10 g) pass as warnings only.
  it('QA-13: a 1 cm, 10 g fighter is refused rather than warned about', () => {
    const f = withId(RPA, 't');
    Object.assign(f.body, { heightM: 0.01, reachM: 0.01, legReachM: 0.01, massKg: 0.01 });
    delete f.body.weighInKg; delete f.body.fightNightKg; delete f.body.naturalWeightKg;
    expect(validateFighter(f).ok).toBe(false);
  });
});
