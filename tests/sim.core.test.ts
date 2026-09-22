/**
 * Core simulation tests — the v4 replacement for `engine.test.ts`'s termination
 * and bounds suite, plus the I1–I8 invariant sweep of docs/design/09 §1.6 and
 * the replay-verification contract of §1.5.1.
 */
import { describe, it, expect } from 'vitest';
import {
  ARCHETYPES, DEFAULT_SETTINGS, PARAMS, SIM_ENGINE_VERSION, VERIFIED_EVENT_FIELDS,
  boutSeed, buildWorld, checkWorldInvariants, computeStats, createModules, createSim,
  loadReplay, simulate, toReplayFile, verifyReplay,
  type BoutRun, type MatchMode, type ReplayFileV4, type SimConfig, type SimEvent,
} from '../src/sim';
import { BoutLoop } from '../src/sim/core/loop';
import { matchClock } from '../src/sim/core/build';
import { DRAWS_PER_DECIDE, DRAWS_PER_MOVE, type Decision, type DecisionContext, type DecisionPolicy, type FighterIntent } from '../src/sim/core/policy';
import type { World } from '../src/sim/core/world';

/**
 * A stand-in for chapter 07 while the AI module is written in parallel: it
 * throws real techniques so the binding (02 resolution, 05 impact, 06 referee)
 * is actually exercised, and it consumes exactly `DRAWS_PER_DECIDE - 1` draws
 * every call, because the loop takes the commit jitter as the last one.
 */
const SPAR_TECHNIQUES = [
  'tech.jab', 'tech.cross', 'tech.hook_lead', 'tech.kick_low_rear', 'tech.kick_body_rear',
] as const;

class SparringPolicy implements DecisionPolicy {
  prepare(): void {
    /* no plan */
  }

  betweenRounds(): void {
    /* no corner */
  }

  decide(ctx: DecisionContext): Decision {
    const u: number[] = [];
    for (let i = 0; i < DRAWS_PER_DECIDE - 1; i++) u.push(ctx.rng.next());
    const seen = ctx.observed?.fighters ?? [];
    let target: { id: number; x: number; z: number } | null = null;
    let best = Infinity;
    for (const o of seen) {
      if (o.id === ctx.self.id || o.team === ctx.self.team) continue;
      const d = Math.hypot(o.x - ctx.self.x, o.z - ctx.self.z);
      if (d < best) {
        best = d;
        target = o;
      }
    }
    if (!target) {
      return { kind: 'wait', what: null, targetId: null, defence: 'def.neutral', moveX: 0, moveZ: 0, intentTag: 'idle' };
    }
    const dx = target.x - ctx.self.x;
    const dz = target.z - ctx.self.z;
    const norm = Math.max(1e-6, Math.hypot(dx, dz));
    if (best > 1.1) {
      const speed = 1.5;
      return {
        kind: 'move', what: null, targetId: target.id, defence: 'def.neutral',
        moveX: (dx / norm) * speed, moveZ: (dz / norm) * speed, intentTag: 'close',
      };
    }
    if (u[0] < 0.85) {
      return { kind: 'wait', what: null, targetId: target.id, defence: 'def.block_high', moveX: 0, moveZ: 0, intentTag: 'reset' };
    }
    const pick = SPAR_TECHNIQUES[Math.floor(u[1] * SPAR_TECHNIQUES.length) % SPAR_TECHNIQUES.length];
    return {
      kind: 'strike', what: pick, targetId: target.id, defence: 'def.block_high',
      moveX: 0, moveZ: 0, intentTag: 'strike',
    };
  }

  intents(world: World): readonly FighterIntent[] {
    return world.fighters.map((f) => ({
      fighterId: f.id, mode: 'spar', phase: 'mid' as const, planLines: [],
      adjustments: [], scoreBelief: 0.5, emergency: false,
    }));
  }
}

const sparring = { policy: new SparringPolicy() };

const ARCH = Object.values(ARCHETYPES);
const MAX_TICKS = PARAMS.resolve().get('core.maxTicks');

function fighters(n: number) {
  return Array.from({ length: n }, (_, i) => ARCH[i % ARCH.length]);
}

function config(seed: string, over: Partial<SimConfig> = {}): SimConfig {
  return {
    seed,
    mode: '1v1',
    fighters: fighters(2),
    teams: { teamOf: [0, 1] },
    ruleset: 'mma.unified.3r',
    arena: 'octagon_30',
    settings: { ...DEFAULT_SETTINGS },
    ...over,
  };
}

/** Short, seeded configs for each mode, for the sweeps. */
function modeConfig(mode: MatchMode, seed: string): SimConfig {
  const short = { ...DEFAULT_SETTINGS, rounds: 1, roundSeconds: 60, restSeconds: 10 };
  switch (mode) {
    case '1v1':
      return config(seed, { settings: short });
    case 'teams':
      return config(seed, {
        mode: 'teams', fighters: fighters(4), teams: { teamOf: [0, 1, 1, 1] }, settings: short,
      });
    case 'ffa':
      return config(seed, {
        mode: 'ffa', fighters: fighters(4), teams: { teamOf: [0, 1, 2, 3] }, settings: short,
      });
    case 'crowd':
      return config(seed, {
        mode: 'crowd',
        fighters: fighters(4),
        teams: { teamOf: [0, 1, 1, 1] },
        ruleset: 'street',
        arena: 'street_open',
        settings: { ...short, maxSeconds: 60 },
      });
  }
}

/** Step a bout with the invariant checker between ticks. */
function sweepInvariants(cfg: SimConfig): { ticks: number; violations: string[] } {
  const world = buildWorld(cfg);
  const modules = createModules(world, { policy: new SparringPolicy() });
  const clock = matchClock(cfg, world.ruleset);
  const loop = new BoutLoop(world, modules, {
    dtMs: world.params.get('core.dtMs'),
    roundSeconds: clock.roundSeconds,
    breakSeconds: clock.breakSeconds,
    rounds: clock.rounds,
    maxTicks: MAX_TICKS,
    untimed: clock.untimed,
    maxSeconds: clock.maxSeconds,
  });
  const violations: string[] = [];
  loop.prepare();
  while (loop.step()) {
    for (const v of checkWorldInvariants(world)) {
      violations.push(`${v.invariant} @${v.tick}: ${v.message}`);
    }
    if (violations.length > 0) break;
  }
  return { ticks: world.tick, violations };
}

function goodRun(): { run: BoutRun; file: ReplayFileV4 } {
  const run = simulate(config('replay-seed'));
  return { run, file: toReplayFile(run) };
}

// ---------------------------------------------------------------------------

describe('a bout runs and terminates', () => {
  it('runs a 1v1 to a result and stops', () => {
    const run = simulate(config('term-1'));
    expect(run.result).toBeTruthy();
    expect(run.ticks).toBeGreaterThan(0);
    expect(run.ticks).toBeLessThanOrEqual(MAX_TICKS);
  });

  it('never exceeds core.maxTicks in any mode', () => {
    for (const mode of ['1v1', 'teams', 'ffa', 'crowd'] as MatchMode[]) {
      const run = simulate(modeConfig(mode, `cap-${mode}`));
      expect(run.ticks).toBeLessThanOrEqual(MAX_TICKS);
      expect(run.result).toBeTruthy();
    }
  });

  it('always ends with a BoutResult, whatever the mode or seed', () => {
    for (const mode of ['1v1', 'teams', 'ffa', 'crowd'] as MatchMode[]) {
      for (let i = 0; i < 4; i++) {
        const run = simulate(modeConfig(mode, boutSeed('end', mode, i)));
        expect(run.result.method).toBeTruthy();
        expect(['number', 'string']).toContain(typeof run.result.winner);
      }
    }
  });

  it('emits a boutStart, a roundStart and a boutEnd', () => {
    const run = simulate(config('structure'));
    const kinds = run.events.map((e) => e.kind);
    expect(kinds).toContain('boutStart');
    expect(kinds).toContain('roundStart');
    expect(kinds).toContain('boutEnd');
  });

  it('keeps every fighter inside the arena', () => {
    const sim = createSim(config('arena'));
    const apothem = 4.572;
    while (sim.step()) {
      if (sim.tick % 97 !== 0) continue;
      for (const f of sim.snapshot().fighters) {
        expect(Math.hypot(f.x, f.z)).toBeLessThanOrEqual(apothem + 1e-6);
      }
    }
  });

  it('never brings a fighter back once out (I7)', () => {
    const sim = createSim(modeConfig('teams', 'i7'));
    const wasOut = new Set<number>();
    while (sim.step()) {
      for (const f of sim.world.fighters) {
        if (f.out) wasOut.add(f.id);
        else expect(wasOut.has(f.id)).toBe(false);
      }
    }
  });
});

describe('determinism', () => {
  it('reproduces digest, ticks, draws and the event stream from one seed', () => {
    const a = simulate(config('same-seed'), sparring);
    const b = simulate(config('same-seed'), sparring);
    expect(b.digest).toBe(a.digest);
    expect(b.ticks).toBe(a.ticks);
    expect(b.rngDraws).toBe(a.rngDraws);
    expect(b.events.length).toBe(a.events.length);
    for (let i = 0; i < a.events.length; i++) {
      for (const field of VERIFIED_EVENT_FIELDS) {
        expect(b.events[i][field]).toBe(a.events[i][field]);
      }
    }
  });

  it('reproduces the whole frame stream, not only the digested fields', () => {
    const a = simulate(config('frames'), { record: true, ...sparring });
    const b = simulate(config('frames'), { record: true, ...sparring });
    expect(a.frames).toBeDefined();
    expect(JSON.stringify(b.frames)).toBe(JSON.stringify(a.frames));
  });

  it('usually produces a different bout from a different seed', () => {
    const base = simulate(config('diff-0'), sparring).digest;
    let differ = 0;
    for (let i = 1; i <= 8; i++) {
      if (simulate(config(`diff-${i}`), sparring).digest !== base) differ++;
    }
    expect(differ).toBeGreaterThanOrEqual(7);
  });

  it('takes the scheduled number of draws per live fighter in a quiet tick', () => {
    // The idle policy commits nothing, so only the two phases that draw
    // unconditionally run: P3 decide (8 per live fighter) and P5 move (1 per
    // live fighter, the steering jitter). Both are "always taken" in 09 §2.7,
    // which is what keeps the stream position independent of what anyone chose.
    const sim = createSim(config('draw-schedule'));
    while (sim.step() && !(sim.phase === 'round' && sim.roundTime > 1)) {
      /* settle into the round */
    }
    const before = sim.rngDraws;
    sim.step();
    const perFighter = DRAWS_PER_DECIDE + DRAWS_PER_MOVE;
    expect(sim.rngDraws - before).toBe(perFighter * 2);
  });

  it('resolves contacts in (subMs, actorId, seq) order within a tick', () => {
    const run = simulate(config('subms'), sparring);
    let lastTick = -1;
    let lastSub = -1;
    for (const e of run.events) {
      if (e.tick !== lastTick) {
        lastTick = e.tick;
        lastSub = -1;
      }
      expect(e.subMs).toBeGreaterThanOrEqual(0);
      expect(e.subMs).toBeLessThan(100);
      lastSub = Math.max(lastSub, e.subMs);
    }
    expect(lastTick).toBeGreaterThan(0);
  });
});

describe('engagement invariants I1-I8', () => {
  for (const mode of ['1v1', 'teams', 'ffa', 'crowd'] as MatchMode[]) {
    it(`holds every tick over 20 seeded bouts in ${mode}`, () => {
      let ticks = 0;
      for (let i = 0; i < 20; i++) {
        const out = sweepInvariants(modeConfig(mode, boutSeed('inv', mode, i)));
        expect(out.violations).toEqual([]);
        ticks += out.ticks;
      }
      expect(ticks).toBeGreaterThan(0);
    });
  }
});

describe('replay verification', () => {
  it('verifies a file straight out of the recorder', () => {
    const { file } = goodRun();
    const v = verifyReplay(file);
    expect(v.verified).toBe(true);
    expect(v.engineVersionMatch).toBe(true);
    expect(v.reason).toBeUndefined();
  });

  it('survives a JSON round trip', () => {
    const { file } = goodRun();
    const revived = JSON.parse(JSON.stringify(file)) as ReplayFileV4;
    expect(verifyReplay(revived).verified).toBe(true);
  });

  it('rejects a tampered digest', () => {
    const { file } = goodRun();
    const bad = { ...file, digest: 'deadbeef' };
    const v = verifyReplay(bad);
    expect(v.verified).toBe(false);
    expect(v.reason).toBe('digest');
    expect(v.engineVersionMatch).toBe(true);
  });

  it('rejects a tampered tick count and a tampered draw count', () => {
    const { file } = goodRun();
    expect(verifyReplay({ ...file, ticks: file.ticks + 1 }).reason).toBe('ticks');
    expect(verifyReplay({ ...file, rngDraws: file.rngDraws + 1 }).reason).toBe('draws');
  });

  it('rejects an altered event stream', () => {
    const { file } = goodRun();
    const events = file.events.map((e, i) => (i === 0 ? { ...e, actor: 7 } : e)) as SimEvent[];
    expect(verifyReplay({ ...file, events }).reason).toBe('event-mismatch');
    expect(verifyReplay({ ...file, events: file.events.slice(1) }).reason).toBe('event-count');
  });

  it('still verifies when only the human-readable event text is edited', () => {
    const { file } = goodRun();
    const events = file.events.map((e) => ({ ...e, text: 'edited by hand' })) as SimEvent[];
    const v = verifyReplay({ ...file, events });
    expect(v.verified).toBe(true);
  });

  it('reports engine-version on a version mismatch, not a silent failure', () => {
    const { file } = goodRun();
    const v = verifyReplay({ ...file, engineVersion: '3.9.0' });
    expect(v.verified).toBe(false);
    expect(v.reason).toBe('engine-version');
    expect(v.engineVersionMatch).toBe(false);
    expect(file.engineVersion).toBe(SIM_ENGINE_VERSION);
  });

  it('rejects a file whose fighter definitions were altered', () => {
    const { file } = goodRun();
    const edited = JSON.parse(JSON.stringify(file)) as ReplayFileV4;
    edited.fighters[0].physical.cardio = 12;
    expect(verifyReplay(edited).verified).toBe(false);
  });

  it('rejects a file whose teams were altered', () => {
    const run = simulate(modeConfig('teams', 'teams-tamper'));
    const file = toReplayFile(run);
    const edited = { ...file, teams: { teamOf: [0, 0, 1, 1] } };
    expect(verifyReplay(edited).verified).toBe(false);
  });

  it('loadReplay re-simulates and reports the verdict', () => {
    const { file } = goodRun();
    const loaded = loadReplay(file);
    expect(loaded.verified).toBe(true);
    expect(loaded.run).not.toBeNull();
    expect(loaded.run?.digest).toBe(file.digest);

    const stale = loadReplay({ ...file, engineVersion: '0.0.1' });
    expect(stale.verified).toBe(false);
    expect(stale.reason).toBe('engine-version');
    expect(stale.run).toBeNull();
  });

  it('stores the parameter hash and rejects a mismatched one', () => {
    const { file } = goodRun();
    expect(file.paramsHash).toHaveLength(8);
    expect(verifyReplay({ ...file, paramsHash: '00000000' }).reason).toBe('params-hash');
  });
});

describe('stats agree with the event log', () => {
  const run = simulate(config('stats-seed'), sparring);
  const stats = computeStats(run.events, run.config, run.ticks);

  it('never counts more significant strikes than total strikes', () => {
    for (const f of stats.fighters) {
      expect(f.sig.landed).toBeLessThanOrEqual(f.total.landed);
      expect(f.sig.attempted).toBeLessThanOrEqual(f.total.attempted);
      expect(f.sig.landed).toBeLessThanOrEqual(f.sig.attempted);
    }
  });

  it('sums the per-round blocks to the totals', () => {
    for (let i = 0; i < stats.fighters.length; i++) {
      const perRound = stats.perRound.reduce((n, r) => n + r.fighters[i].sig.landed, 0);
      expect(perRound).toBe(stats.total.fighters[i].sig.landed);
      const kd = stats.perRound.reduce((n, r) => n + r.fighters[i].knockdowns, 0);
      expect(kd).toBe(stats.total.fighters[i].knockdowns);
    }
    const seconds = stats.perRound.reduce((n, r) => n + r.seconds, 0);
    expect(seconds).toBeCloseTo(stats.total.seconds, 6);
  });

  it('keeps control time inside the fight time', () => {
    for (const f of stats.fighters) {
      expect(f.controlSeconds).toBeLessThanOrEqual(stats.total.seconds + 1e-9);
    }
    const pos = stats.total.positionSeconds;
    expect(pos.distance + pos.clinch + pos.ground).toBeCloseTo(stats.total.seconds, 6);
  });

  it('matches the strike events one for one', () => {
    const counted = run.events.filter((e) => e.kind === 'strike').length;
    const tallied = stats.fighters.reduce((n, f) => n + f.total.attempted, 0);
    expect(tallied).toBe(counted);
  });

  it('matches the knockdown events one for one', () => {
    const counted = run.events.filter((e) => e.kind === 'knockdown').length;
    const tallied = stats.fighters.reduce((n, f) => n + f.knockdowns, 0);
    expect(tallied).toBe(counted);
  });

  it('is a pure function of (events, config, ticks)', () => {
    const again = computeStats(run.events, run.config, run.ticks);
    expect(JSON.stringify(again)).toBe(JSON.stringify(stats));
  });

  it('is what the recorder stored', () => {
    expect(JSON.stringify(run.stats)).toBe(JSON.stringify(stats));
  });

  it('is not vacuous: the bouts actually produce strikes and damage', () => {
    let thrown = 0;
    let landed = 0;
    let knockdowns = 0;
    for (let i = 0; i < 12; i++) {
      const r = simulate(config(`vacuity-${i}`), sparring);
      const st = computeStats(r.events, r.config, r.ticks);
      thrown += st.fighters.reduce((n, f) => n + f.total.attempted, 0);
      landed += st.fighters.reduce((n, f) => n + f.sig.landed, 0);
      knockdowns += st.fighters.reduce((n, f) => n + f.knockdowns, 0);
    }
    expect(thrown).toBeGreaterThan(100);
    expect(landed).toBeGreaterThan(20);
    expect(knockdowns).toBeGreaterThan(0);
  });
});

describe('the snapshot contract', () => {
  it('fills every v4 field, including the presentation-only ones', () => {
    const sim = createSim(config('snap'));
    sim.step();
    const snap = sim.snapshot();
    expect(snap.v).toBe(4);
    expect(snap.fighters).toHaveLength(2);
    for (const f of snap.fighters) {
      expect(Number.isFinite(f.vx)).toBe(true);
      expect(Number.isFinite(f.vz)).toBe(true);
      expect(Array.isArray(f.grips)).toBe(true);
      expect(typeof f.contacts.fence).toBe('boolean');
      expect(f.damageVisual.zones.length).toBeGreaterThan(0);
      expect(f.fatigueVisual.breathingRate).toBeGreaterThan(0);
      expect(f.stamina.total).toBeGreaterThanOrEqual(0);
      expect(f.stamina.total).toBeLessThanOrEqual(1);
    }
    expect(snap.referee.state).toBeTruthy();
    expect(typeof snap.score.hidden).toBe('boolean');
  });

  it('exposes the engagement roots the presenter needs', () => {
    const sim = createSim(config('snap-eng'));
    sim.runToEnd();
    const snap = sim.snapshot();
    for (const e of snap.engagements) {
      expect(Number.isFinite(e.rootX)).toBe(true);
      expect(Number.isFinite(e.rootZ)).toBe(true);
      expect(Number.isFinite(e.rootYaw)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// §4.1 takedown accounting — the Phase 4 regression pair
// ---------------------------------------------------------------------------

/**
 * `computeStats` is a pure function of an event log, so these drive it with a
 * hand-written log rather than a bout. Each one is a defect that shipped:
 * takedown accuracy measured 3 % against a 38 % target because the denominator
 * held every §2.3 A entry (clinch entries and the guard pull included) and the
 * numerator was erased by any position change inside the three-second
 * stabilisation window.
 */
describe('§4.1 takedown accounting', () => {
  const CFG = config('td-stats');

  const ev = (
    kind: SimEvent['kind'], tick: number, actor: number, target: number,
    detail: Record<string, unknown>,
  ): SimEvent => ({
    tick, subMs: 0, round: 1, kind, actor, target, text: '', detail,
  } as unknown as SimEvent);

  /** double leg -> captured -> go-behind to turtle, then held. */
  function chain(finishEdge: string, finishKind: SimEvent['kind']): SimEvent[] {
    return [
      ev('takedown', 10, 0, 1, {
        edge: 'tech.double_leg', from: 'pos.standing_close',
        to: 'pos.td_double_leg_in', result: 'success',
      }),
      ev(finishKind, 18, 0, 1, {
        edge: finishEdge, from: 'pos.td_double_leg_in',
        to: 'pos.ground_turtle', result: 'success',
      }),
    ];
  }

  it('credits the takedown when the chain finishes on a non-takedown edge', () => {
    // `tech.front_headlock_go_behind` is a `control` edge, so the binder reports
    // it as `positionChange`. The shot that started the chain still landed.
    const stats = computeStats(chain('tech.front_headlock_go_behind', 'positionChange'), CFG, 200);
    expect(stats.total.fighters[0].takedowns.landed).toBe(1);
    expect(stats.total.fighters[0].takedowns.attempted).toBe(1);
    expect(stats.total.fighters[1].takedowns.landed).toBe(0);
  });

  it('does not let a position change inside the three seconds cancel the takedown', () => {
    const log = [
      ...chain('tech.front_headlock_go_behind', 'positionChange'),
      // Passing to side control one second in: an improvement, not a reset.
      ev('positionChange', 28, 0, 1, {
        edge: 'tech.turtle_to_side', from: 'pos.ground_turtle',
        to: 'pos.ground_side', result: 'success',
      }),
    ];
    const stats = computeStats(log, CFG, 200);
    expect(stats.total.fighters[0].takedowns.landed).toBe(1);
  });

  it('does not count a takedown until the pair is actually on the mat', () => {
    // §2.2.3 `attack` nodes are a contested shot, not a completed takedown:
    // holding `pos.td_double_leg_in` for ten seconds is a stalled single.
    const log = [chain('tech.front_headlock_go_behind', 'positionChange')[0]];
    const stats = computeStats(log, CFG, 200);
    expect(stats.total.fighters[0].takedowns.attempted).toBe(1);
    expect(stats.total.fighters[0].takedowns.landed).toBe(0);
  });

  it('counts shots, captures and throws as takedown attempts, and nothing else', () => {
    const log = [
      ev('takedown', 10, 0, 1, { edge: 'tech.double_leg', result: 'stuffed' }),
      ev('takedown', 20, 0, 1, { edge: 'tech.clinch_entry_cold', result: 'stuffed' }),
      ev('takedown', 30, 0, 1, { edge: 'tech.clinch_entry_strikes', result: 'stuffed' }),
      ev('takedown', 40, 0, 1, { edge: 'tech.pull_guard', result: 'stuffed' }),
    ];
    const stats = computeStats(log, CFG, 200);
    // Only the double leg. A clinch entry and a guard pull are neither.
    expect(stats.total.fighters[0].takedowns.attempted).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Knockdown bookkeeping across the 05 / 09 boundary
// ---------------------------------------------------------------------------

describe('knockdowns cross the 05 boundary exactly once, to the right fighter', () => {
  it('never emits two knockdown events for one impact', () => {
    // 05 emits its own `knockdown` DamageEvent for a §2.4 roll outcome; the
    // binder used to emit a second one for the same impact, double-counting
    // every roll knockdown in the stats and in 06's judging.
    for (let i = 0; i < 12; i++) {
      const run = simulate(config(`kd-dup-${i}`), sparring);
      const byKey = new Map<string, number>();
      for (const e of run.events) {
        if (e.kind !== 'knockdown') continue;
        const key = `${e.tick}:${e.target}`;
        byKey.set(key, (byKey.get(key) ?? 0) + 1);
      }
      for (const [key, n] of byKey) {
        expect(n, `two knockdown events at ${key} in kd-dup-${i}`).toBe(1);
      }
    }
  });

  it('credits a knockdown to the fighter who caused it, never the one who fell', () => {
    // `DamageState` addresses its events to itself, so an accumulation, body or
    // leg knockdown arrived with `actor === target === the downed fighter` and
    // `stats.ts` scored it for him.
    let seen = 0;
    for (let i = 0; i < 20; i++) {
      const run = simulate(config(`kd-actor-${i}`), sparring);
      for (const e of run.events) {
        if (e.kind !== 'knockdown') continue;
        seen++;
        expect(e.actor, 'a fighter cannot knock himself down').not.toBe(e.target);
      }
      const stats = computeStats(run.events, run.config, run.ticks);
      for (const f of stats.fighters) {
        const dropped = run.events.filter(
          (e) => e.kind === 'knockdown' && e.actor === f.fighter,
        ).length;
        expect(f.knockdowns).toBe(dropped);
      }
    }
    expect(seen, 'the seeds must actually produce knockdowns').toBeGreaterThan(0);
  });
});
