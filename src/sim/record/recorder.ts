/**
 * RECORDER — running a bout and turning it into a replay file.
 *
 * Design continuity with the v3 recorder: a replay stores the seed, the fighter
 * definitions, the event stream and a digest — never frames. Frames are only
 * kept in memory, and only when the caller asks for them (`opts.record`).
 *
 * See docs/design/09 §1.3.1 (the public surface), §1.5 (the file format).
 */
import type { BoutResult, SimConfig, MatchMode, MatchSettings, TeamAssignment } from '../core/config';
import type { FighterDefinition } from '../fighter/types';
import type { ParamOverrides } from '../params';
import { hashParams } from '../params';
import type { Arena, ArenaId } from '../rules/arenas/types';
import type { Ruleset, RulesetId } from '../rules/types';
import { BoutLoop } from '../core/loop';
import { buildWorld, matchClock, refereeRuntime } from '../core/build';
import { createModules, type BoundModules } from '../core/bind';
import type { DecisionPolicy, FighterIntent } from '../core/policy';
import type { World } from '../core/world';
import type { SimEvent } from './events';
import { buildSnapshot, type TickSnapshot } from './snapshot';
import { FrameStore } from './frames';
import { computeStats, type BoutStats } from './stats';

/**
 * Semantic version of the simulation. Bumped whenever any output can change —
 * a formula, a draw count, the phase order, the digest field list. A replay
 * recorded under a different version is reported as `engine-version`, never
 * silently re-verified.
 */
export const SIM_ENGINE_VERSION = '6.0.0';

export interface SimOptions {
  /** Keep every frame. Off in batch runs (09 §1.3.3). */
  record?: boolean;
  /** Hard stop; defaults to `core.maxTicks`. */
  maxTicks?: number;
  /**
   * The decision policy. Defaults to `IdlePolicy`.
   * TODO(chapter 07): the AI planner is injected here.
   */
  policy?: DecisionPolicy;
}

export interface BoutRun {
  config: SimConfig;
  result: BoutResult;
  events: SimEvent[];
  stats: BoutStats;
  digest: string;
  ticks: number;
  rngDraws: number;
  frames?: TickSnapshot[];
}

export interface ReplayFileV4 {
  format: 4;
  engineVersion: string;
  seed: string;
  mode: MatchMode;
  fighters: FighterDefinition[];
  teams: TeamAssignment;
  ruleset: RulesetId | Ruleset;
  arena: ArenaId | Arena;
  settings: MatchSettings;
  paramsHash: string;
  paramOverrides?: ParamOverrides;
  digest: string;
  ticks: number;
  rngDraws: number;
  result: BoutResult;
  events: SimEvent[];
  stats: BoutStats;
  meta?: {
    recordedAt?: string;
    label?: string;
    tournament?: { id: string; roundIndex: number; matchIndex: number };
  };
}

// ---------------------------------------------------------------------------
// Sim — the stepwise handle (09 §1.3.1)
// ---------------------------------------------------------------------------

export interface Sim {
  readonly config: Readonly<SimConfig>;
  readonly tick: number;
  readonly t: number;
  readonly round: number;
  readonly roundTime: number;
  readonly phase: 'pre' | 'round' | 'break' | 'ended';
  readonly finished: boolean;
  readonly result: BoutResult | null;
  readonly events: readonly SimEvent[];
  readonly digest: string;
  readonly rngDraws: number;
  step(): boolean;
  snapshot(): TickSnapshot;
  runToEnd(maxTicks?: number): BoutResult;
  intents(): readonly FighterIntent[];
  /** Internal: the world, for tests and the invariant sweep. */
  readonly world: World;
}

class BoutSim implements Sim {
  private readonly loop: BoutLoop;
  private prepared = false;

  constructor(
    readonly world: World,
    private readonly modules: BoundModules,
    private readonly cap: number,
  ) {
    const clock = matchClock(world.config, world.ruleset);
    this.loop = new BoutLoop(world, modules, {
      dtMs: world.params.get('core.dtMs'),
      roundSeconds: clock.roundSeconds,
      breakSeconds: clock.breakSeconds,
      rounds: clock.rounds,
      maxTicks: cap,
      untimed: clock.untimed,
      maxSeconds: clock.maxSeconds,
    });
  }

  get config(): Readonly<SimConfig> {
    return this.world.config;
  }

  get tick(): number {
    return this.world.tick;
  }

  get t(): number {
    return this.world.nowMs / 1000;
  }

  get round(): number {
    return this.world.round;
  }

  get roundTime(): number {
    return (this.world.roundTick * this.world.params.get('core.dtMs')) / 1000;
  }

  get phase(): 'pre' | 'round' | 'break' | 'ended' {
    return this.world.phase;
  }

  get finished(): boolean {
    return this.world.finished;
  }

  get result(): BoutResult | null {
    return refereeRuntime(this.world).result;
  }

  get events(): readonly SimEvent[] {
    return this.world.events;
  }

  get digest(): string {
    return this.world.digest.value;
  }

  get rngDraws(): number {
    return this.world.rng.draws;
  }

  step(): boolean {
    if (!this.prepared) {
      this.prepared = true;
      this.loop.prepare();
    }
    const more = this.loop.step();
    if (!more) this.settle();
    return more;
  }

  snapshot(): TickSnapshot {
    return buildSnapshot(this.world);
  }

  runToEnd(maxTicks?: number): BoutResult {
    const limit = maxTicks ?? this.cap;
    while (this.world.tick < limit && this.step()) {
      /* advance */
    }
    this.settle();
    return this.result as BoutResult;
  }

  intents(): readonly FighterIntent[] {
    return this.modules.policy.intents(this.world);
  }

  /** The bell (or the tick cap) has rung: the judges decide if nobody finished. */
  private settle(): void {
    this.world.finished = true;
    this.modules.decideIfUnfinished(this.world);
    this.world.phase = 'ended';
  }
}

/** Build a stepwise simulation from a config. Deterministic in the seed. */
export function createSim(config: SimConfig, opts: SimOptions = {}): Sim {
  const world = buildWorld(config);
  const modules = createModules(world, { policy: opts.policy });
  const cap = opts.maxTicks ?? world.params.get('core.maxTicks');
  world.emit({
    tick: 0, subMs: 0, round: 1, kind: 'boutStart', actor: -1, target: -1,
    text: `${config.fighters.map((f) => f.short).join(' vs ')}`,
    detail: { label: config.mode },
  });
  return new BoutSim(world, modules, cap);
}

/**
 * Run a whole bout. The app, the worker and the batch runner all go through
 * this; a `BoutRun` is what a loaded replay looks like, so the two paths are
 * interchangeable (09 §1.3.3).
 */
export function simulate(config: SimConfig, opts: SimOptions = {}): BoutRun {
  const sim = createSim(config, opts);
  // Frames go into compact columns (09 §4.5, frames.ts); `run.frames` is a
  // read-only TickSnapshot[] view over them.
  const store = opts.record ? new FrameStore() : undefined;
  if (store) store.push(sim.snapshot());
  while (sim.step()) {
    if (store) store.push(sim.snapshot());
  }
  if (store) store.push(sim.snapshot());
  const frames = store?.view();
  const result = sim.result;
  if (!result) throw new Error('A bout must always end with a BoutResult');
  const events = [...sim.events];
  return {
    config,
    result,
    events,
    stats: computeStats(events, config, sim.tick),
    digest: sim.digest,
    ticks: sim.tick,
    rngDraws: sim.rngDraws,
    ...(frames ? { frames } : {}),
  };
}

/** A run, as the self-contained file of 09 §1.5. */
export function toReplayFile(run: BoutRun): ReplayFileV4 {
  const c = run.config;
  return {
    format: 4,
    engineVersion: SIM_ENGINE_VERSION,
    seed: c.seed,
    mode: c.mode,
    fighters: c.fighters,
    teams: c.teams,
    ruleset: c.ruleset,
    arena: c.arena,
    settings: c.settings,
    paramsHash: hashParams(c.paramOverrides),
    ...(c.paramOverrides && Object.keys(c.paramOverrides).length > 0
      ? { paramOverrides: c.paramOverrides }
      : {}),
    digest: run.digest,
    ticks: run.ticks,
    rngDraws: run.rngDraws,
    result: run.result,
    events: run.events,
    stats: run.stats,
    // The one place wall-clock is allowed to appear (09 §3.6).
    meta: { recordedAt: new Date().toISOString() },
  };
}

/** The config a replay file re-simulates from. */
export function configFromReplay(file: ReplayFileV4): SimConfig {
  return {
    seed: file.seed,
    mode: file.mode,
    fighters: file.fighters,
    teams: file.teams,
    ruleset: file.ruleset,
    arena: file.arena,
    settings: file.settings,
    ...(file.paramOverrides ? { paramOverrides: file.paramOverrides } : {}),
  };
}
