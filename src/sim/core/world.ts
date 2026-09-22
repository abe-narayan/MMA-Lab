/**
 * WORLD — the mutable state of one bout.
 *
 * Everything that changes during a bout lives here; everything that does not
 * (the fighter definitions, the ruleset, the arena, the resolved parameters)
 * is held by reference and never written to. That split is what makes a bout a
 * pure function of its config: re-running `createSim` with the same config
 * rebuilds this object identically, tick for tick.
 *
 * The world owns no logic. It is the shared blackboard that the striking,
 * grappling, submission, damage, rules and AI modules read and write through
 * the tick loop, in the phase order fixed by docs/design/09 §2.1.
 */
import type { Arena } from '../rules/arenas/types';
import type { Ruleset } from '../rules/types';
import type { ResolvedParams } from '../params';
import type { FighterRuntime } from '../fighter';
import type { DamageState } from '../damage';
import type { EnergyState } from '../damage';
import type { EngagementSet } from '../grappling';
import type { SimEvent } from '../record/events';
import type { PositionId, TechniqueId, DefenceId, SubmissionId } from './ids';
import type { SimConfig } from './config';
import { PerceptionBuffer } from './perception';
import { Scheduler } from './scheduler';
import type { RNG } from '../rng';
import { Digest } from '../rng';

/** Per-fighter mutable state. One of these per fighter for the whole bout. */
export interface FighterWorldState {
  readonly id: number;
  readonly team: number;
  readonly runtime: FighterRuntime;

  // ---- placement ---------------------------------------------------------
  x: number;
  z: number;
  vx: number;
  vz: number;
  facing: number;
  /** Which foot leads right now; switch-stance fighters change this mid-bout. */
  stance: 'orthodox' | 'southpaw';

  // ---- engagement --------------------------------------------------------
  posture: 'standing' | 'clinch' | 'ground' | 'down' | 'out';
  position: PositionId;
  partnerId: number | null;

  // ---- commitment --------------------------------------------------------
  /** Currently committed technique, or null when free to act. */
  action: TechniqueId | null;
  /** Absolute ms at which the current commitment was made. */
  actionCommitMs: number;
  actionTotalMs: number;
  actionStartupMs: number;
  actionActiveMs: number;
  actionTargetId: number | null;
  /** Outcome written by P4 for the snapshot and the presenter. */
  actionResult: 'none' | 'landed' | 'blocked' | 'evaded' | 'missed' | 'interrupted' | 'success' | 'stuffed';
  /** Defensive posture chosen this tick. */
  defence: DefenceId;

  // ---- condition ---------------------------------------------------------
  damage: DamageState;
  energy: EnergyState;
  balance: number;

  // ---- submission --------------------------------------------------------
  sub: { technique: SubmissionId | null; stage: 0 | 1 | 2 | 3 | 4; progress: number; lockedAtMs: number | null };

  // ---- officials ---------------------------------------------------------
  out: boolean;
  outReason: string | null;
  /** Points deducted by the referee, per round. */
  deductions: number[];
  downTicks: number;

  // ---- perception and strategy ------------------------------------------
  perception: PerceptionBuffer;
  /** Reaction latency in ms, from chapter 01; drives the perception lag. */
  reactionLatencyMs: number;
  /** Intra-tick decision offset, so quicker fighters commit earlier on average. */
  decisionOffsetMs: number;
  /** Opaque chapter-07 state (plan, intent, opponent model, adjustments). */
  ai: unknown;
  /**
   * The 01 §3 tier tells currently in force. 07 writes them at decision time,
   * 02 and 05 read them at contact time: they are how a catalogue row like
   * `beh.gen.turn_away` or `beh.gen.eyes_close` reaches the resolution path,
   * which otherwise only ever saw the scalar composites.
   */
  tells: {
    /** `beh.gen.turn_away` (T0): ms until which the side or back is turned. */
    backTurnedUntilMs: number;
    /** `beh.gen.eyes_close` (T0/T1): ms until which the eyes are shut. */
    eyesShutUntilMs: number;
    /** Catalogue rule ids that fired for this fighter on the last decision. */
    rules: readonly string[];
  };
  /** Short intent id for the HUD and commentary. */
  intentTag: string;

  // ---- running tallies ---------------------------------------------------
  sigLanded: number;
  sigAttempted: number;
  totalLanded: number;
  totalAttempted: number;
  takedownsLanded: number;
  takedownsAttempted: number;
  subAttempts: number;
  knockdowns: number;
  controlTicks: number;
  /** Consecutive unanswered strikes taken, for the referee. */
  unansweredStrikes: number;
  lastStruckTick: number;
  /**
   * Who landed the last impact on this fighter, or -1. 05's `DamageState`
   * addresses its own events to the fighter they happen *to* (it has no idea
   * who is hitting it), so the binder needs this to re-address a knockdown or
   * a delayed liver collapse to the fighter who caused it before it reaches
   * the stats and the judges.
   */
  lastStruckBy: number;
  lastActionTick: number;
}

export interface World {
  readonly config: SimConfig;
  readonly ruleset: Ruleset;
  readonly arena: Arena;
  readonly params: ResolvedParams;
  readonly rng: RNG;
  readonly digest: Digest;
  readonly scheduler: Scheduler;
  readonly engagements: EngagementSet;

  readonly fighters: FighterWorldState[];
  readonly events: SimEvent[];

  /** Discrete tick counter; `nowMs` is the authoritative clock. */
  tick: number;
  nowMs: number;
  round: number;
  roundTick: number;
  phase: 'pre' | 'round' | 'break' | 'ended';
  breakTicksLeft: number;
  finished: boolean;

  /** Per-round, per-fighter scoring signals the judges consume at round end. */
  roundSignals: unknown[];
  /** Opaque referee state (counts, warnings, pending stoppages). */
  referee: unknown;
  /** Opaque judge state (traits drawn pre-bout, cards accumulated). */
  judges: unknown;

  /** Teams that still have a live fighter. */
  liveTeams(): number[];
  live(): FighterWorldState[];
  opponentsOf(f: FighterWorldState): FighterWorldState[];
  nearestOpponent(f: FighterWorldState): FighterWorldState | null;
  distance(a: FighterWorldState, b: FighterWorldState): number;
  emit(event: SimEvent): void;
}

export function distanceBetween(a: FighterWorldState, b: FighterWorldState): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Fold this tick's state into the running fingerprint.
 *
 * The field list and its order are the replay verification contract
 * (docs/design/09 §1.5.3). Adding a presentation-only field to the snapshot
 * must not touch this function, or every stored replay stops verifying.
 */
export function updateDigest(
  world: World,
  positionIndex: (id: PositionId) => number,
  actionIndex: (id: TechniqueId | null) => number
): void {
  const d = world.digest;
  d.push(world.tick);
  d.push(world.rng.draws);
  for (const f of world.fighters) {
    d.push(f.x);
    d.push(f.z);
    d.push(f.facing);
    d.push(f.energy.f);
    d.push(f.damage.regions.head.acute);
    d.push(f.damage.regions.body.acute);
    d.push(f.damage.regions.leg.left.acute.acute);
    d.push(f.damage.regions.leg.right.acute.acute);
    d.push(positionIndex(f.position));
    d.push(actionIndex(f.action));
    d.push(f.sigLanded);
  }
  for (const e of world.engagements.all) {
    d.push(positionIndex(e.node));
  }
}
