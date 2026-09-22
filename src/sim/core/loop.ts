/**
 * TICK LOOP — the phase order that is the determinism contract.
 *
 * Every tick runs P0..P9 in this order; every loop over fighters is ascending
 * id; every loop over engagements is ascending (a,b); every queued contact
 * resolves in (subMs, actorId, seq) order. Changing any of that changes every
 * bout ever recorded, which is what `SIM_ENGINE_VERSION` and the golden
 * replays exist to catch.
 *
 *   P0 clock       round and break transitions, break recovery
 *   P1 perception  push last tick's observed state into each ring buffer
 *   P2 upkeep      fatigue, damage decay, timers, engagement counters
 *   P3 decide      chapter 07 chooses; the scheduler enqueues contacts
 *   P4 resolve     every contact due this tick, in arrival order
 *   P5 move        steering then integration, separation, arena walls
 *   P6 referee     stoppages, counts, stand-ups, fouls, doctor
 *   P7 judges      accumulate round signals; score at the bell
 *   P8 commentary  nothing (commentary is post-hoc from the event log)
 *   P9 digest      fold this tick into the fingerprint
 *
 * See docs/design/09 §2.1 and §2.7.
 */
import type { World, FighterWorldState } from './world';
import { updateDigest } from './world';
import type { DecisionPolicy, Decision } from './policy';
import { DRAWS_PER_DECIDE, DRAWS_PER_DECIDE_MULTI } from './policy';
import type { ObservedState, ObservedFighter } from './perception';
import { POSITION_IDS, TECHNIQUE_IDS } from './ids';
import { clampToArena, distanceToWall, wallNormalAngle } from '../rules/arenas/types';
import type { ScheduledContact } from './scheduler';

/** What the loop needs from each module. Keeps the loop free of module internals. */
export interface LoopModules {
  policy: DecisionPolicy;
  /** Resolve one due contact; returns true when it changed the bout state. */
  resolveContact(world: World, contact: ScheduledContact): void;
  /** Per-fighter upkeep: fatigue, damage decay, timers. No RNG draws (P2). */
  upkeep(world: World, f: FighterWorldState, dtMs: number): void;
  /** Referee pass; may end the bout. */
  referee(world: World): void;
  /** Accumulate judging signals; score at a round end. */
  judges(world: World, roundEnded: boolean): void;
  /** Recovery applied once per break tick. */
  breakRecovery(world: World, f: FighterWorldState, dtMs: number): void;
  /** Commit a decision: look up timings, enqueue the contact, spend energy. */
  commitDecision(world: World, f: FighterWorldState, d: Decision, jitter: number): void;
  /** True when this fighter may act (not downed, not mid-commitment). */
  canAct(world: World, f: FighterWorldState): boolean;
}

export interface LoopConfig {
  dtMs: number;
  roundSeconds: number;
  breakSeconds: number;
  rounds: number;
  /** Hard stop so a bug cannot hang a batch. */
  maxTicks: number;
  /** Rulesets with no clock (street) end on state, not time. */
  untimed: boolean;
  maxSeconds?: number;
}

export class BoutLoop {
  constructor(
    readonly world: World,
    readonly modules: LoopModules,
    readonly cfg: LoopConfig
  ) {}

  /** Pre-bout: plans, style jitter, judge traits — all before tick 1. */
  prepare(): void {
    this.modules.policy.prepare(this.world);
  }

  /** Advance one tick. Returns false once the bout is over. */
  step(): boolean {
    const w = this.world;
    if (w.finished) return false;
    if (w.tick >= this.cfg.maxTicks) {
      w.finished = true;
      return false;
    }

    // ---- P0 clock --------------------------------------------------------
    w.tick++;
    w.nowMs = w.tick * this.cfg.dtMs;

    if (w.phase === 'pre') w.phase = 'round';

    if (w.phase === 'break') {
      w.breakTicksLeft--;
      for (const f of w.fighters) {
        if (f.out) continue;
        this.modules.breakRecovery(w, f, this.cfg.dtMs);
      }
      if (w.breakTicksLeft <= 0) this.startRound();
      this.digest();
      return true;
    }

    w.roundTick++;

    // ---- P1 perception ---------------------------------------------------
    const observed = this.observe();
    for (const f of w.fighters) {
      if (f.out) continue;
      f.perception.push(observed);
    }

    // ---- P2 upkeep -------------------------------------------------------
    for (const f of w.fighters) {
      if (f.out) continue;
      this.modules.upkeep(w, f, this.cfg.dtMs);
    }

    // ---- P3 decide -------------------------------------------------------
    // Every fighter consumes the same number of draws whether or not they are
    // free to act, so the stream position after P3 depends only on how many
    // fighters are live - never on what they chose.
    const multi = w.live().length > 2;
    const drawsPerFighter = multi ? DRAWS_PER_DECIDE_MULTI : DRAWS_PER_DECIDE;
    for (const f of w.fighters) {
      if (f.out) continue;
      const before = w.rng.draws;
      if (this.modules.canAct(w, f)) {
        const lag = Math.round(f.reactionLatencyMs / this.cfg.dtMs);
        const decision = this.modules.policy.decide({
          world: w, self: f, observed: f.perception.delayed(lag),
          rng: w.rng, tick: w.tick, nowMs: w.nowMs,
        });
        const taken = w.rng.draws - before;
        // The jitter is the last mandated draw; a policy that consumed fewer
        // draws than promised has its remainder taken here so the stream stays
        // aligned. A policy that overdraws is a bug and is caught in tests.
        for (let i = taken; i < drawsPerFighter - 1; i++) w.rng.next();
        const jitter = w.rng.int(this.cfg.dtMs);
        f.intentTag = decision.intentTag;
        this.modules.commitDecision(w, f, decision, jitter);
      } else {
        for (let i = 0; i < drawsPerFighter; i++) w.rng.next();
      }
    }

    // ---- P4 resolve ------------------------------------------------------
    // Contacts already carry their arrival order; a contact resolved earlier
    // sees the world before the later ones, so trades happen naturally and a
    // knockdown can cancel the punch that was already on its way.
    for (const contact of w.scheduler.due(w.tick)) {
      if (w.finished) break;
      if (contact.cancelled) continue;
      const actor = w.fighters[contact.actorId];
      if (!actor || actor.out) continue;
      this.modules.resolveContact(w, contact);
    }

    // ---- P5 move ---------------------------------------------------------
    for (const f of w.fighters) {
      if (f.out) continue;
      this.integrate(f);
    }
    this.separate();

    // ---- P6 referee ------------------------------------------------------
    this.modules.referee(w);

    // ---- P7 judges -------------------------------------------------------
    const roundOver =
      !this.cfg.untimed && w.roundTick * this.cfg.dtMs >= this.cfg.roundSeconds;
    this.modules.judges(w, roundOver && !w.finished);
    if (roundOver && !w.finished) this.endRound();

    // Untimed rulesets (street) still respect a hard cap.
    if (this.cfg.untimed && this.cfg.maxSeconds !== undefined
        && w.nowMs >= this.cfg.maxSeconds * 1000 && !w.finished) {
      w.finished = true;
    }

    // ---- P8 commentary: nothing; it is derived from the event log --------
    // ---- P9 digest -------------------------------------------------------
    this.digest();
    return !w.finished;
  }

  runToEnd(): void {
    this.prepare();
    while (this.step()) {
      /* advance */
    }
  }

  // ------------------------------------------------------------------ parts

  /** The compact view fighters are allowed to read, one tick delayed. */
  private observe(): ObservedState {
    const w = this.world;
    const fighters: ObservedFighter[] = [];
    for (const f of w.fighters) {
      if (f.out) continue;
      fighters.push({
        id: f.id, team: f.team, x: f.x, z: f.z, facing: f.facing, vx: f.vx, vz: f.vz,
        posture: f.posture, position: f.position,
        action: f.action ?? 'idle',
        actionPhase: f.actionTotalMs > 0
          ? Math.min(1, (w.nowMs - f.actionCommitMs) / f.actionTotalMs)
          : 0,
        stance: f.stance,
        visiblyHurt: f.damage.has('rocked') || f.damage.has('stunned'),
        visiblyTired: f.energy.f > 0.65,
        handsDropped: f.energy.f > 0.75,
        balance: f.balance,
      });
    }
    return { tick: w.tick, fighters };
  }

  /** Integrate one fighter, then hold them inside the arena. */
  private integrate(f: FighterWorldState): void {
    const w = this.world;
    const dt = this.cfg.dtMs / 1000;
    if (f.posture === 'ground' || f.posture === 'down') {
      f.vx *= 0.5;
      f.vz *= 0.5;
    }
    f.x += f.vx * dt;
    f.z += f.vz * dt;
    const margin = 0.35;
    const clamped = clampToArena(w.arena, f.x, f.z, margin);
    f.x = clamped.x;
    f.z = clamped.z;
  }

  /** Bodies do not overlap. Ascending id keeps the resolution order fixed. */
  private separate(): void {
    const w = this.world;
    const minFree = w.params.get('core.bodySeparationM');
    const minEngaged = w.params.get('core.bodySeparationEngagedM');
    const fighters = w.fighters;
    for (let i = 0; i < fighters.length; i++) {
      const a = fighters[i];
      if (a.out) continue;
      for (let j = i + 1; j < fighters.length; j++) {
        const b = fighters[j];
        if (b.out) continue;
        const engaged = a.partnerId === b.id || b.partnerId === a.id;
        const min = engaged ? minEngaged : minFree;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d >= min || d < 1e-4) continue;
        const push = (min - d) / 2;
        a.x -= (dx / d) * push;
        a.z -= (dz / d) * push;
        b.x += (dx / d) * push;
        b.z += (dz / d) * push;
      }
    }
    for (const f of fighters) {
      if (f.out) continue;
      const c = clampToArena(w.arena, f.x, f.z, 0.35);
      f.x = c.x;
      f.z = c.z;
    }
  }

  private startRound(): void {
    const w = this.world;
    w.phase = 'round';
    w.roundTick = 0;
    w.scheduler.reset();
    for (const f of w.fighters) {
      if (f.out) continue;
      f.action = null;
      f.actionResult = 'none';
      f.vx = 0;
      f.vz = 0;
    }
  }

  private endRound(): void {
    const w = this.world;
    if (w.round >= this.cfg.rounds) {
      w.finished = true;
      return;
    }
    w.round++;
    w.phase = 'break';
    w.breakTicksLeft = Math.round((this.cfg.breakSeconds * 1000) / this.cfg.dtMs);
    w.scheduler.reset();
    for (const f of w.fighters) {
      if (f.out) continue;
      f.action = null;
      f.actionResult = 'none';
    }
    this.modules.policy.betweenRounds(w, w.round);
  }

  private digest(): void {
    updateDigest(
      this.world,
      (id) => POSITION_IDS.indexOrNone(id),
      (id) => TECHNIQUE_IDS.indexOrNone(id)
    );
  }
}

/** Distance from a fighter to the nearest wall, for the AI and the cage rules. */
export function cageProximity(world: World, f: FighterWorldState): number {
  return distanceToWall(world.arena, f.x, f.z);
}

export function cageNormal(world: World, f: FighterWorldState): number {
  return wallNormalAngle(world.arena, f.x, f.z);
}
