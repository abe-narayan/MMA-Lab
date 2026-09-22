/**
 * WORLD CONSTRUCTION — `SimConfig` in, a ready-to-tick `World` out.
 *
 * This is the other half of the module binding (see `bind.ts`): `build.ts`
 * assembles the state, `bind.ts` drives it. Everything that happens here runs
 * *before* tick 1 and in the pre-bout draw order of docs/design/09 §2.7:
 *
 *   1. params / ruleset / arena resolution        (no draws)
 *   2. per-fighter runtime derivation, ascending id (no draws)
 *   3. damage + energy state per fighter          (no draws)
 *   4. placement per mode                         (no draws)
 *   5. judge traits, in judge order               (3 draws per judge — 06)
 *
 * The AI's pre-bout block (style jitter, scouting noise, plan generation) is
 * `TODO(chapter 07)`: `DecisionPolicy.prepare` is called by `BoutLoop.prepare`
 * after this function returns, which is where those draws will land.
 */
import type { BoutResult, SimConfig } from './config';
import type { FighterWorldState, World } from './world';
import { distanceBetween } from './world';
import { PerceptionBuffer } from './perception';
import { Scheduler } from './scheduler';
import { Digest, RNG } from '../rng';
import { resolveParams, type ResolvedParams } from '../params';
import type { Ruleset } from '../rules/types';
import { resolveRuleset } from '../rules/rulesets';
import { resolveArena, type Arena } from '../rules/arenas/types';
import { Referee } from '../rules/referee';
import { createPanel, emptyLedger, type JudgePanel, type RoundLedger } from '../rules/judges';
import { deriveRuntime, type FighterRuntime } from '../fighter';
import {
  DamageState, emptyObservables, profileFromDefinition, tuningFrom,
  type FighterDamageProfile, type GloveType, type RefObservables,
} from '../damage';
import { EngagementSet } from '../grappling';
import type { SimEvent } from '../record/events';

// ---------------------------------------------------------------------------
// Opaque state the `World` carries for chapters 06 and the recorder
// ---------------------------------------------------------------------------

/** What `world.referee` holds. `bind.ts` and `snapshot.ts` read it through `refereeRuntime`. */
export interface RefereeRuntime {
  readonly ref: Referee;
  /** Set once the bout is decided; the recorder reads it. */
  result: BoutResult | null;
  /** Latest `RefObservables` per fighter id, refreshed in P2. */
  readonly obs: RefObservables[];
  /** Presentation-only referee state for the snapshot. */
  display: {
    state: 'watching' | 'counting' | 'warning' | 'separating' | 'stopping';
    count?: number;
    target?: number;
  };
}

/** What `world.judges` holds. */
export interface JudgeRuntime {
  /** null in modes the ten-point-must system does not model (>2 fighters). */
  readonly panel: JudgePanel | null;
  /** The round currently being accumulated, per fighter id. */
  ledgers: RoundLedger[];
  /** Frozen ledgers, `[roundIndex][fighterId]`. */
  readonly history: RoundLedger[][];
  /** Index of the next event in `world.events` the judges have not folded in. */
  cursor: number;
  /** Rounds scored so far. */
  scored: number;
}

export function refereeRuntime(world: World): RefereeRuntime {
  return world.referee as RefereeRuntime;
}

export function judgeRuntime(world: World): JudgeRuntime {
  return world.judges as JudgeRuntime;
}

// ---------------------------------------------------------------------------
// Match settings → module inputs
// ---------------------------------------------------------------------------

/** Rounds, round length and break length, ruleset first, settings overriding. */
export function matchClock(config: SimConfig, ruleset: Ruleset): {
  rounds: number; roundSeconds: number; breakSeconds: number; untimed: boolean; maxSeconds?: number;
} {
  const s = config.settings;
  const untimed = ruleset.family === 'street';
  return {
    rounds: s.rounds ?? ruleset.rounds.count,
    roundSeconds: s.roundSeconds ?? ruleset.rounds.lengthS,
    breakSeconds: s.restSeconds ?? ruleset.rounds.breakS,
    untimed,
    maxSeconds: s.maxSeconds ?? (untimed ? 180 : undefined),
  };
}

/** 09 §3.2: `refereeStrictness` writes `Ruleset.referee.strictness`, `judgingMode` the open-scoring flag. */
export function applySettingsToRuleset(base: Ruleset, config: SimConfig): Ruleset {
  const s = config.settings;
  return {
    ...base,
    referee: { ...base.referee, strictness: s.refereeStrictness },
    scoring: {
      ...base.scoring,
      culture: s.judgeCulture === 'unified_2025' ? base.scoring.culture : s.judgeCulture,
      openScoring: s.judgingMode === 'open' ? 'after_each_round' : base.scoring.openScoring,
    },
  };
}

/** The ruleset's glove spec mapped onto the 02/05 enum. */
export function gloveTypeOf(ruleset: Ruleset): GloveType {
  const g = ruleset.gloves;
  if (g.bareKnuckle) return 'bare';
  if (g.oz <= 6) return 'mma4oz';
  if (g.oz <= 8) return 'boxing8oz';
  if (g.oz <= 10) return 'boxing10oz';
  return 'boxing12oz';
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/** Radius the old engine started fighters at (`src/engine/engine.ts setup()`). */
const START_RADIUS_M = 2.2;
/** A fanned-out group stands a little further back, as the v3 engine did. */
const GROUP_RADIUS_M = 2.6;
/** The v3 `teamSpreadRadians`: how wide a group fans around its anchor. */
const TEAM_SPREAD_RAD = 1.2;

interface Placement {
  x: number;
  z: number;
  facing: number;
}

/**
 * Where everyone starts. The 1v1 case reproduces the v3 engine exactly
 * (fighter 0 at angle π, fighter 1 at angle 0, both facing the centre); the
 * multi-opponent cases keep its fan-out idea, generalised to n sides.
 */
export function placeFighters(config: SimConfig): Placement[] {
  const n = config.fighters.length;
  const teamOf = config.teams.teamOf;
  const at = (angle: number, r: number): Placement => ({
    x: Math.sin(angle) * r,
    z: Math.cos(angle) * r,
    facing: Math.atan2(-Math.sin(angle), -Math.cos(angle)),
  });

  if (config.mode === 'ffa') {
    // Everyone on their own: evenly spaced around the circle, facing centre.
    return Array.from({ length: n }, (_, i) => at((2 * Math.PI * i) / n, GROUP_RADIUS_M));
  }

  // Two-sided modes: each team fans around its own anchor angle.
  const teams = [...new Set(teamOf.slice(0, n))].sort((a, b) => a - b);
  const anchors = new Map<number, number>();
  for (let t = 0; t < teams.length; t++) {
    anchors.set(teams[t], teams.length <= 2 ? (t === 0 ? Math.PI : 0) : (2 * Math.PI * t) / teams.length);
  }
  const membersOf = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const t = teamOf[i] ?? 0;
    const list = membersOf.get(t) ?? [];
    list.push(i);
    membersOf.set(t, list);
  }

  const out: Placement[] = new Array<Placement>(n);
  for (const [team, members] of [...membersOf.entries()].sort((a, b) => a[0] - b[0])) {
    const anchor = anchors.get(team) ?? 0;
    const k = members.length;
    const r = k === 1 ? START_RADIUS_M : GROUP_RADIUS_M;
    for (let i = 0; i < k; i++) {
      const spread = k === 1 ? 0 : (i / (k - 1) - 0.5) * TEAM_SPREAD_RAD;
      out[members[i]] = at(anchor + spread, r);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-fighter state
// ---------------------------------------------------------------------------

function damageProfileOf(
  runtime: FighterRuntime, id: number, ruleset: Ruleset, config: SimConfig,
): FighterDamageProfile {
  const base = profileFromDefinition(runtime.def, id);
  return {
    ...base,
    // Chapter 01 owns every one of these; the chapter-05 fallbacks in
    // `profileFromDefinition` are replaced by the derived runtime here.
    chinEff: runtime.chinEff,
    neck: runtime.effective.neck,
    bodyToughness: runtime.effective.bodyToughness,
    cardio: runtime.effective.cardio,
    recovery: runtime.effective.recovery,
    strength: runtime.effective.strength,
    massKg: runtime.body.fightNightKg,
    ageYears: runtime.body.ageYears,
    composureEff: runtime.composureEff,
    experience: runtime.experience,
    strikingSkill: runtime.strikingMean,
    energy: {
      pcrRefillHalfLifeS: runtime.energy.pcrRefillHalfLifeS,
      lactateClearance: runtime.energy.lactateClearance,
      breakRefillFrac: runtime.energy.breakRefillFrac,
      actionCostMult: runtime.energy.actionCostMult,
    },
    residualDehydration: runtime.residualDehydration,
    gloveType: gloveTypeOf(ruleset),
    hostileCrowd: config.settings.homeFighter !== undefined && config.settings.homeFighter !== id,
  };
}

function newFighterState(
  id: number, team: number, runtime: FighterRuntime, place: Placement,
  damage: DamageState, dtMs: number,
): FighterWorldState {
  const reactionLatencyMs = runtime.reactionTimeMs;
  return {
    id,
    team,
    runtime,
    x: place.x,
    z: place.z,
    vx: 0,
    vz: 0,
    facing: place.facing,
    stance: runtime.body.stance === 'southpaw' ? 'southpaw' : 'orthodox',
    posture: 'standing',
    position: 'pos.standing_long',
    partnerId: null,
    action: null,
    actionCommitMs: 0,
    actionTotalMs: 0,
    actionStartupMs: 0,
    actionActiveMs: 0,
    actionTargetId: null,
    actionResult: 'none',
    defence: 'def.neutral',
    damage,
    energy: damage.energy,
    balance: 1,
    sub: { technique: null, stage: 0, progress: 0, lockedAtMs: null },
    out: false,
    outReason: null,
    deductions: [],
    downTicks: 0,
    perception: new PerceptionBuffer(4),
    reactionLatencyMs,
    // 09 §2.2: a quicker fighter commits earlier inside the tick on average.
    decisionOffsetMs: Math.round(reactionLatencyMs) % dtMs,
    ai: null,
    tells: { backTurnedUntilMs: -Infinity, eyesShutUntilMs: -Infinity, rules: [] },
    intentTag: 'idle',
    sigLanded: 0,
    sigAttempted: 0,
    totalLanded: 0,
    totalAttempted: 0,
    takedownsLanded: 0,
    takedownsAttempted: 0,
    subAttempts: 0,
    knockdowns: 0,
    controlTicks: 0,
    unansweredStrikes: 0,
    lastStruckTick: -1,
    lastStruckBy: -1,
    lastActionTick: -1,
  };
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

class BoutWorld implements World {
  tick = 0;
  nowMs = 0;
  round = 1;
  roundTick = 0;
  phase: 'pre' | 'round' | 'break' | 'ended' = 'pre';
  breakTicksLeft = 0;
  finished = false;
  roundSignals: unknown[] = [];
  referee: unknown = null;
  judges: unknown = null;
  readonly events: SimEvent[] = [];

  constructor(
    readonly config: SimConfig,
    readonly ruleset: Ruleset,
    readonly arena: Arena,
    readonly params: ResolvedParams,
    readonly rng: RNG,
    readonly digest: Digest,
    readonly scheduler: Scheduler,
    readonly engagements: EngagementSet,
    readonly fighters: FighterWorldState[],
  ) {}

  liveTeams(): number[] {
    const teams = new Set<number>();
    for (const f of this.fighters) if (!f.out) teams.add(f.team);
    return [...teams].sort((a, b) => a - b);
  }

  live(): FighterWorldState[] {
    return this.fighters.filter((f) => !f.out);
  }

  opponentsOf(f: FighterWorldState): FighterWorldState[] {
    return this.fighters.filter((o) => !o.out && o.id !== f.id && o.team !== f.team);
  }

  nearestOpponent(f: FighterWorldState): FighterWorldState | null {
    let best: FighterWorldState | null = null;
    let bestD = Infinity;
    // Ascending id, so an exact tie always resolves the same way.
    for (const o of this.opponentsOf(f)) {
      const d = distanceBetween(f, o);
      if (d < bestD - 1e-12) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  distance(a: FighterWorldState, b: FighterWorldState): number {
    return distanceBetween(a, b);
  }

  emit(event: SimEvent): void {
    this.events.push(event);
  }
}

/**
 * Build the whole mutable state of one bout. Deterministic: the same config
 * always produces a byte-identical world, which is what makes a replay a
 * function of its seed.
 */
export function buildWorld(config: SimConfig): World {
  if (config.fighters.length < 2) {
    throw new Error('A bout needs at least two fighters');
  }
  const params = resolveParams(config.paramOverrides);
  const ruleset = applySettingsToRuleset(resolveRuleset(config.ruleset), config);
  const arena = resolveArena(config.arena);
  const dtMs = params.get('core.dtMs');
  const rng = new RNG(config.seed);
  const tuning = tuningFrom(params);

  const places = placeFighters(config);
  const fighters: FighterWorldState[] = [];
  for (let id = 0; id < config.fighters.length; id++) {
    const def = config.fighters[id];
    const runtime = deriveRuntime(def, params, { explain: false });
    const profile = damageProfileOf(runtime, id, ruleset, config);
    const stance = runtime.body.stance === 'southpaw' ? 'southpaw' : 'orthodox';
    const damage = new DamageState(profile, { tuning, stance });
    const team = config.teams.teamOf[id] ?? (config.mode === 'ffa' ? id : id === 0 ? 0 : 1);
    fighters.push(newFighterState(id, team, runtime, places[id], damage, dtMs));
  }

  const world = new BoutWorld(
    config, ruleset, arena, params, rng, new Digest(), new Scheduler(dtMs),
    new EngagementSet(), fighters,
  );

  const refRuntime: RefereeRuntime = {
    ref: new Referee(ruleset, { rng, strictness: config.settings.refereeStrictness }),
    result: null,
    obs: fighters.map((f) => {
      const o = emptyObservables();
      void f;
      return o;
    }),
    display: { state: 'watching' },
  };
  world.referee = refRuntime;

  // Judge traits are the only pre-bout draws this function takes, and they are
  // taken in judge order (09 §2.7 "Pre-bout order").
  const scored = fighters.length === 2 && ruleset.scoring.system !== 'none';
  const judgeRt: JudgeRuntime = {
    panel: scored
      ? createPanel(ruleset, rng, {
        homeFighter: config.settings.homeFighter ?? null,
        enableBiases: true,
      })
      : null,
    ledgers: fighters.map(() => emptyLedger()),
    history: [],
    cursor: 0,
    scored: 0,
  };
  world.judges = judgeRt;

  return world;
}
