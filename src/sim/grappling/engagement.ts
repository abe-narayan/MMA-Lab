/**
 * ENGAGEMENTS — the matching over fighters, and the invariants that keep it honest.
 *
 * The old engine carried five parallel fields per fighter (`posture`,
 * `groundRole`, `groundPosition`, `groundOpponent`, clinch flags) and three
 * methods that had to keep them consistent: `clearEngagement`, `enterGround`
 * and `exitGround` (`src/engine/engine.ts`). The invariant it maintained was
 * "tops == bottoms, clinch count even, no ground role off the ground".
 *
 * This module generalises that to the graph of chapter 03: an `Engagement` is
 * one record holding the pair, the node they share, the slot each fighter
 * occupies and the state the node needs (cage, underhook ownership, kuzushi,
 * top posture, the in-flight edge, the §6 timers). `EngagementSet` owns the
 * matching, so there is exactly one place that can create, move or dissolve a
 * pairing — and `checkInvariants` states, in one place, what "consistent" means
 * (docs/design/09 §1.6, invariants I1-I8).
 *
 * Determinism (03 §7.7): every iteration here is in ascending fighter id or
 * ascending engagement id, never in Map insertion order.
 */
import type { PositionId, SubmissionId } from '../core/ids';
import type { EngagementRole, EngagementSnapshot, Posture } from '../record/snapshot';
import { subOfferedAt } from './subOffers';
import {
  complementaryNode, positionNode, roleFor,
  type EdgeId, type GrapplingEdge,
} from './graph';

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export type EngagementKind = 'clinch' | 'takedown' | 'throw' | 'ground' | 'scramble' | 'knockdown';

/** Eight-way off-balance compass; 0 = front, 2 = lateral, 4 = back (03 §2.1.1). */
export type KuzushiDir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type KuzushiMag = 0 | 1 | 2 | 3;

export interface Kuzushi {
  dir: KuzushiDir;
  mag: KuzushiMag;
}

export interface InflightEdge {
  edge: EdgeId;
  /** Tick at which the edge was committed. */
  tStart: number;
  /** Total duration in milliseconds, already rounded up to whole ticks. */
  dur: number;
  /** 0-1 progress, for chapter 08's animation blending. */
  phase: number;
  /** Two-stage leg attacks resolve capture and finish as separate contacts. */
  stage: 'single' | 'capture' | 'finish';
  /** Who owns the slot. Both ends of an engagement contest it (§2.1.1). */
  actorId: number;
  /**
   * Intra-tick commit offset in [0, dtMs), i.e. `(decisionOffsetMs + jitter) %
   * dtMs` — the same number the scheduler turns into `commitMs`.
   *
   * It exists so that the *one contested edge per engagement* rule is decided
   * by who moved first inside the tick rather than by who the loop asked first.
   * P3 iterates in ascending id, so without this the lower id claimed the slot
   * every tick it wanted it and the higher id could never initiate from inside
   * an engagement: in a mirror match that was worth 2x the takedowns, 2x the
   * control time and 3.6x the reversals (see PHASE4_FINDINGS Phase 5).
   */
  commitOffsetMs: number;
}

/** The §6 clocks the referee and the judges read. All in milliseconds. */
export interface EngagementTimers {
  /** Since the last work event, by either fighter (§6.1). */
  sinceWork: number;
  /** Since the last landed strike or takedown attempt. */
  sinceStrikeOrTd: number;
  /** Time in the current node. */
  dwell: number;
  /** Time the pinned fighter has spent on the fence. */
  pinClock: number;
}

export interface Engagement {
  id: number;
  /** The slot the node table calls controls / top / attacker. */
  a: number;
  /** The other slot. -1 for a `knockdown` engagement with nobody following (03 §7.3). */
  b: number;
  node: PositionId;
  sinceTick: number;
  kind: EngagementKind;
  /** Either fighter within grap.cageReachM of the fence. */
  cage: boolean;
  underhookOwner: 'a' | 'b' | null;
  kuzushi: Kuzushi;
  /** Ground top slot: chest-to-chest versus postured to strike (§5.2). */
  posture: 'chest' | 'postured';
  inflight: InflightEdge | null;
  timers: EngagementTimers;
}

export interface JoinOptions {
  cage?: boolean;
  underhookOwner?: 'a' | 'b' | null;
  kuzushi?: Kuzushi;
  posture?: 'chest' | 'postured';
  /** Override the kind the node implies (a throw landing mid-flight, say). */
  kind?: EngagementKind;
}

export interface TransitionOptions extends JoinOptions {
  /** The "(def)" marker: slot `a` passes to the fighter who was in slot `b`. */
  swap?: boolean;
  /** Keep the §6 work clock running rather than resetting it. */
  keepWorkTimer?: boolean;
}

// ---------------------------------------------------------------------------
// Node classification
// ---------------------------------------------------------------------------

/**
 * The engagement kind a node implies. `null` means the node is a free standing
 * node and holds no engagement at all (invariant I3).
 */
export function kindForNode(node: PositionId): EngagementKind | null {
  if (node === 'pos.scramble') return 'scramble';
  if (node === 'pos.ground_knockdown') return 'knockdown';
  if (node === 'pos.throw_in_progress') return 'throw';
  const family = positionNode(node).family;
  switch (family) {
    case 'standingFree': return null;
    case 'clinch': return 'clinch';
    case 'attack': return 'takedown';
    default: return 'ground';
  }
}

/** Nodes in which a fighter is grounded under the 2024 Unified definition. */
export function isGroundedNode(node: PositionId): boolean {
  const kind = kindForNode(node);
  return kind === 'ground' || kind === 'scramble' || kind === 'knockdown';
}

/** Does this node list the submission as available to that slot (invariant I5)? */
export function nodeAllowsSubmission(
  node: PositionId, slot: 'a' | 'b', submission: SubmissionId,
): boolean {
  const n = positionNode(node);
  const list = slot === 'a' ? n.subThreats.top : n.subThreats.bottom;
  // The node's threat list names families (`sub.arm_triangle`); the catalogue
  // attacks are variants (`sub.arm_triangle_mount`). Either source counts.
  if (list.some((x) => submission === x || submission.startsWith(`${x}_`))) return true;
  return subOfferedAt(node, slot, submission);
}

// ---------------------------------------------------------------------------
// Invariant inputs
//
// These are the narrow views this module needs from chapters 05 (fighter
// condition), 06 (referee, legality) and the core loop (placement). Nothing
// here imports those modules.
// ---------------------------------------------------------------------------

export interface FighterView {
  id: number;
  posture: Posture;
  position: PositionId;
  role: EngagementRole;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** 2024 Unified: any part but the soles of the feet touching the mat. */
  grounded: boolean;
  out: boolean;
  /** Chapter 04's in-progress submission, or null. */
  submission: SubmissionId | null;
}

/** TODO(chapter 06): supplied by the referee module; I6 and I8 read it. */
export interface RefereeView {
  activeCounts: number;
  rulesetHasCounts: boolean;
  /**
   * Technique events this tick that the active ruleset forbids and that were
   * *not* emitted as `foul` events. Any entry is an I6 violation.
   */
  illegalUnflagged?: readonly { fighter: number; technique: string; reason: string }[];
}

export interface InvariantWorld {
  tick: number;
  fighters: readonly FighterView[];
  /** 09 §1.6 I4: `core.engagedMaxDistanceM` = 0.6 m [E]. */
  engagedMaxDistanceM?: number;
  referee?: RefereeView;
}

export type InvariantId = 'I1' | 'I2' | 'I3' | 'I4' | 'I5' | 'I6' | 'I7' | 'I8';

export interface InvariantViolation {
  invariant: InvariantId;
  message: string;
  fighters: readonly number[];
  engagementId?: number;
  tick: number;
}

export const ENGAGED_MAX_DISTANCE_M = 0.6;

// ---------------------------------------------------------------------------
// EngagementSet
// ---------------------------------------------------------------------------

export class EngagementSet {
  private readonly byId = new Map<number, Engagement>();
  private readonly byFighter = new Map<number, number>();
  /**
   * 03 §7.6: a fighter leaving an engagement is free for one tick before any
   * new engagement can claim it, so two claimants resolve by chapter 07's
   * targeting order rather than by tick ordering.
   */
  private readonly freedAtTick = new Map<number, number>();
  /** 09 §1.6 I7: `out` never reverts, so the set remembers who has been out. */
  private readonly everOut = new Set<number>();
  private nextId = 1;

  /** Engagements in ascending id order. */
  get all(): readonly Engagement[] {
    return [...this.byId.keys()].sort((x, y) => x - y).map((k) => this.byId.get(k)!);
  }

  get size(): number {
    return this.byId.size;
  }

  of(fighterId: number): Engagement | null {
    const id = this.byFighter.get(fighterId);
    return id === undefined ? null : this.byId.get(id) ?? null;
  }

  byIdOrNull(id: number): Engagement | null {
    return this.byId.get(id) ?? null;
  }

  partnerOf(fighterId: number): number | null {
    const e = this.of(fighterId);
    if (!e) return null;
    if (e.a === fighterId) return e.b === -1 ? null : e.b;
    if (e.b === fighterId) return e.a === -1 ? null : e.a;
    return null;
  }

  /** Which slot a fighter occupies, or null when they are not engaged. */
  slotOf(fighterId: number): 'a' | 'b' | null {
    const e = this.of(fighterId);
    if (!e) return null;
    return e.a === fighterId ? 'a' : e.b === fighterId ? 'b' : null;
  }

  roleOf(fighterId: number): EngagementRole {
    const e = this.of(fighterId);
    const slot = this.slotOf(fighterId);
    if (!e || !slot) return 'none';
    return roleFor(e.node, slot);
  }

  isEngaged(fighterId: number): boolean {
    return this.byFighter.has(fighterId);
  }

  /** 03 §7.6: freed fighters cannot be claimed again until the next tick. */
  canJoin(fighterId: number, tick: number): boolean {
    if (this.byFighter.has(fighterId)) return false;
    const freed = this.freedAtTick.get(fighterId);
    return freed === undefined || freed < tick;
  }

  /**
   * Create an engagement. Any engagement either fighter is already in is
   * dissolved first, together with its partner's half — the generalisation of
   * the old `enterGround`'s "free any engagement either fighter was already
   * in, including the partner on the other end of it".
   */
  join(
    a: number, b: number, node: PositionId, tick: number, opts: JoinOptions = {},
  ): Engagement {
    const kind = opts.kind ?? kindForNode(node);
    if (kind === null) {
      throw new Error(`Cannot open an engagement in the free standing node ${node}`);
    }
    // Ascending id, so dissolving is order-independent.
    for (const f of [a, b].filter((x) => x >= 0).sort((x, y) => x - y)) {
      this.leave(f, tick);
    }
    const e: Engagement = {
      id: this.nextId++,
      a, b, node, sinceTick: tick, kind,
      cage: opts.cage ?? false,
      underhookOwner: opts.underhookOwner ?? null,
      kuzushi: opts.kuzushi ?? { dir: 0, mag: 0 },
      posture: opts.posture ?? 'chest',
      inflight: null,
      timers: { sinceWork: 0, sinceStrikeOrTd: 0, dwell: 0, pinClock: 0 },
    };
    this.byId.set(e.id, e);
    this.byFighter.set(a, e.id);
    if (b >= 0) this.byFighter.set(b, e.id);
    this.freedAtTick.delete(a);
    this.freedAtTick.delete(b);
    return e;
  }

  /**
   * Dissolve the engagement a fighter is in. Returns the partner's id, or null
   * when the fighter was free. Both ends are always cleared: this is the single
   * source of truth the old `clearEngagement` tried to be.
   */
  leave(fighterId: number, tick: number): number | null {
    const id = this.byFighter.get(fighterId);
    if (id === undefined) return null;
    const e = this.byId.get(id);
    this.byId.delete(id);
    if (!e) {
      this.byFighter.delete(fighterId);
      return null;
    }
    const partner = e.a === fighterId ? e.b : e.a;
    this.byFighter.delete(e.a);
    if (e.b >= 0) this.byFighter.delete(e.b);
    this.freedAtTick.set(e.a, tick);
    if (e.b >= 0) this.freedAtTick.set(e.b, tick);
    return partner >= 0 ? partner : null;
  }

  /** Dissolve an engagement by its own id. */
  dissolve(engagementId: number, tick: number): void {
    const e = this.byId.get(engagementId);
    if (e) this.leave(e.a, tick);
  }

  /**
   * Move an engagement to another node, optionally handing slot `a` to the
   * fighter who was in slot `b`. Moving to a free standing node dissolves the
   * engagement instead, which is what every get-up, break and referee restart
   * does.
   */
  transition(
    engagementId: number, toNode: PositionId, tick: number, opts: TransitionOptions = {},
  ): Engagement | null {
    const e = this.byId.get(engagementId);
    if (!e) throw new Error(`Unknown engagement: ${engagementId}`);
    const kind = opts.kind ?? kindForNode(toNode);
    if (kind === null) {
      this.leave(e.a, tick);
      return null;
    }
    if (opts.swap) {
      const a = e.a;
      e.a = e.b;
      e.b = a;
      if (e.underhookOwner) e.underhookOwner = e.underhookOwner === 'a' ? 'b' : 'a';
      // The kuzushi vector is expressed in the attacker's frame, so a swap
      // turns it through 180 degrees.
      e.kuzushi = { dir: ((e.kuzushi.dir + 4) % 8) as KuzushiDir, mag: e.kuzushi.mag };
    }
    const nodeChanged = e.node !== toNode;
    e.node = toNode;
    e.kind = kind;
    e.sinceTick = tick;
    e.inflight = null;
    if (opts.cage !== undefined) e.cage = opts.cage;
    if (opts.underhookOwner !== undefined) e.underhookOwner = opts.underhookOwner;
    if (opts.kuzushi !== undefined) e.kuzushi = opts.kuzushi;
    if (opts.posture !== undefined) e.posture = opts.posture;
    // Leaving a ground node with a standing top resets the posture flag: the
    // §5.1 table only defines posture for ground top slots.
    else if (kind !== 'ground') e.posture = 'chest';
    if (nodeChanged) {
      e.timers.dwell = 0;
      // A node change is a work event (§6.1).
      if (!opts.keepWorkTimer) e.timers.sinceWork = 0;
    }
    if (!e.cage) e.timers.pinClock = 0;
    // Re-index in case the ids moved between slots.
    this.byFighter.set(e.a, e.id);
    if (e.b >= 0) this.byFighter.set(e.b, e.id);
    return e;
  }

  /** Commit an edge to an engagement; at most one resolves at a time (§2.1.1). */
  commit(engagementId: number, edge: GrapplingEdge, tick: number, durMs: number,
    stage: InflightEdge['stage'] = 'single',
    actorId = -1, commitOffsetMs = 0): void {
    const e = this.byId.get(engagementId);
    if (!e) throw new Error(`Unknown engagement: ${engagementId}`);
    if (e.inflight) {
      throw new Error(
        `Engagement ${engagementId} already has ${e.inflight.edge} in flight; ` +
        'at most one contested edge resolves per engagement (03 §2.1.1)',
      );
    }
    e.inflight = { edge: edge.id, tStart: tick, dur: durMs, phase: 0, stage, actorId, commitOffsetMs };
  }

  /**
   * Who wins the single contested-edge slot when both fighters want it on the
   * same tick: the earlier intra-tick commit offset, ties to the incumbent.
   *
   * Returns `'free'` when nothing holds the slot, `'blocked'` when the
   * incumbent keeps it, and `'displace'` when the challenger's hands moved
   * first and the incumbent's commitment must be cancelled.
   */
  contestInflight(
    engagementId: number, tick: number, commitOffsetMs: number,
  ): { verdict: 'free' | 'blocked' | 'displace'; incumbentId: number; edge: EdgeId | null; simultaneous: boolean } {
    const e = this.byId.get(engagementId);
    if (!e || !e.inflight) return { verdict: 'free', incumbentId: -1, edge: null, simultaneous: false };
    const held = e.inflight;
    // An edge committed on an earlier tick is already in motion: it is not a
    // simultaneous claim and cannot be displaced.
    if (held.tStart !== tick) {
      return { verdict: 'blocked', incumbentId: held.actorId, edge: held.edge, simultaneous: false };
    }
    if (commitOffsetMs >= held.commitOffsetMs) {
      return { verdict: 'blocked', incumbentId: held.actorId, edge: held.edge, simultaneous: true };
    }
    return { verdict: 'displace', incumbentId: held.actorId, edge: held.edge, simultaneous: true };
  }

  /** Clear the in-flight edge once it has resolved. */
  clearInflight(engagementId: number): void {
    const e = this.byId.get(engagementId);
    if (e) e.inflight = null;
  }

  /** Advance every timer by one tick, ascending engagement id. */
  advanceTimers(dtMs: number): void {
    for (const e of this.all) {
      e.timers.sinceWork += dtMs;
      e.timers.sinceStrikeOrTd += dtMs;
      e.timers.dwell += dtMs;
      if (e.cage) e.timers.pinClock += dtMs;
      if (e.inflight && e.inflight.dur > 0) {
        e.inflight.phase = Math.min(1, e.inflight.phase + dtMs / e.inflight.dur);
      }
    }
  }

  /** Record a work event (§6.1): resets the referee's inactivity clock. */
  markWork(engagementId: number, alsoStrikeOrTd = false): void {
    const e = this.byId.get(engagementId);
    if (!e) return;
    e.timers.sinceWork = 0;
    if (alsoStrikeOrTd) e.timers.sinceStrikeOrTd = 0;
  }

  /** Snapshot for the presenter (root placement is filled by the core loop). */
  toSnapshot(rootOf?: (e: Engagement) => { x: number; z: number; yaw: number }): EngagementSnapshot[] {
    return this.all.map((e) => {
      const root = rootOf ? rootOf(e) : { x: 0, z: 0, yaw: 0 };
      return {
        a: e.a,
        b: e.b,
        node: e.node,
        sinceTick: e.sinceTick,
        kind: e.kind,
        cage: e.cage,
        underhookOwner: e.underhookOwner,
        kuzushi: e.kuzushi,
        posture: e.posture,
        inflight: e.inflight
          ? { edge: e.inflight.edge, tStart: e.inflight.tStart, dur: e.inflight.dur, phase: e.inflight.phase }
          : null,
        rootX: root.x,
        rootZ: root.z,
        rootYaw: root.yaw,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Invariants I1-I8 (09 §1.6)
  // -------------------------------------------------------------------------

  /**
   * Check every invariant and return the violations. Used by the tests and by
   * `scripts/sweep-invariants.ts`; the sim asserts zero in dev builds.
   *
   * The checks are ordered I1..I8 and each iterates in ascending id, so the
   * violation list is itself deterministic.
   */
  checkInvariants(world: InvariantWorld): InvariantViolation[] {
    const v: InvariantViolation[] = [];
    const tick = world.tick;
    const fighters = [...world.fighters].sort((x, y) => x.id - y.id);
    const byId = new Map(fighters.map((f) => [f.id, f]));
    const maxDist = world.engagedMaxDistanceM ?? ENGAGED_MAX_DISTANCE_M;

    const push = (
      invariant: InvariantId, message: string, who: readonly number[], engagementId?: number,
    ): void => {
      v.push({ invariant, message, fighters: who, engagementId, tick });
    };

    // I1 Matching: each live fighter appears in at most one engagement.
    const seen = new Map<number, number>();
    for (const e of this.all) {
      for (const f of [e.a, e.b]) {
        if (f < 0) continue;
        const prev = seen.get(f);
        if (prev !== undefined) {
          push('I1', `fighter ${f} is in engagements ${prev} and ${e.id}`, [f], e.id);
        } else {
          seen.set(f, e.id);
        }
      }
      if (e.a >= 0 && e.a === e.b) {
        push('I1', `engagement ${e.id} pairs fighter ${e.a} with themself`, [e.a], e.id);
      }
      // The byFighter index must agree with the records it indexes.
      for (const f of [e.a, e.b]) {
        if (f < 0) continue;
        if (this.byFighter.get(f) !== e.id) {
          push('I1', `index for fighter ${f} does not point at engagement ${e.id}`, [f], e.id);
        }
      }
    }

    for (const e of this.all) {
      const fa = byId.get(e.a);
      const fb = e.b >= 0 ? byId.get(e.b) : undefined;

      // I2 Complementarity: both fighters report this node, and the roles they
      // report are the slots the node assigns. Symmetric nodes accept either
      // assignment, so only the node and the role *pair* are checked there.
      const expected = complementaryNode(e.node);
      const node = positionNode(e.node);
      if (fa && fa.position !== e.node) {
        push('I2', `fighter ${e.a} reports ${fa.position} but engagement ${e.id} is at ${e.node}`,
          [e.a], e.id);
      }
      if (fb && fb.position !== expected) {
        push('I2', `fighter ${e.b} reports ${fb.position} but the complement of ${e.node} is ${expected}`,
          [e.b], e.id);
      }
      if (!node.symmetric) {
        const roleA = roleFor(e.node, 'a');
        const roleB = roleFor(e.node, 'b');
        if (fa && roleA !== 'none' && fa.role !== roleA) {
          push('I2', `fighter ${e.a} has role ${fa.role}, expected ${roleA} in ${e.node}`, [e.a], e.id);
        }
        if (fb && roleB !== 'none' && fb.role !== roleB) {
          push('I2', `fighter ${e.b} has role ${fb.role}, expected ${roleB} in ${e.node}`, [e.b], e.id);
        }
      } else if (fa && fb && fa.role === fb.role && fa.role !== 'none') {
        push('I2', `symmetric node ${e.node} has both fighters in role ${fa.role}`, [e.a, e.b], e.id);
      }
      if (e.kind !== kindForNode(e.node) && kindForNode(e.node) !== null) {
        push('I2', `engagement ${e.id} kind ${e.kind} disagrees with node ${e.node}`,
          fb ? [e.a, e.b] : [e.a], e.id);
      }

      // I4 Contact: engaged pairs are within `engagedMaxDistanceM`, and neither
      // is moving unless the node is a scramble.
      if (fa && fb) {
        const dist = Math.hypot(fa.x - fb.x, fa.z - fb.z);
        if (dist > maxDist + 1e-9) {
          push('I4', `engaged pair ${e.a}/${e.b} are ${dist.toFixed(3)} m apart (max ${maxDist})`,
            [e.a, e.b], e.id);
        }
      }
      if (e.kind !== 'scramble') {
        for (const f of [fa, fb]) {
          if (f && (f.vx !== 0 || f.vz !== 0)) {
            push('I4', `engaged fighter ${f.id} has non-zero velocity outside a scramble`,
              [f.id], e.id);
          }
        }
      }

      // I5 Sub coherence: an in-progress submission must be one this node
      // offers to that fighter's slot.
      for (const [f, slot] of [[fa, 'a'], [fb, 'b']] as const) {
        if (!f || !f.submission) continue;
        if (!nodeAllowsSubmission(e.node, slot, f.submission)) {
          push('I5', `fighter ${f.id} holds ${f.submission}, not offered to slot ${slot} of ${e.node}`,
            [f.id], e.id);
        }
      }
    }

    for (const f of fighters) {
      // I3 Free implies standing: a fighter in no engagement is in a standing
      // free node, down, or out — never a clinch or ground node.
      if (!this.byFighter.has(f.id)) {
        // Phase 9: `pos.ground_knockdown` is the trigger node of the fighter
        // standing over a knocked-down opponent (`tech.knockdown_follow`
        // leaves from it); he is on his feet and in no engagement.
        const standing = positionNode(f.position).family === 'standingFree'
          || f.position === 'pos.ground_knockdown';
        const excused = f.posture === 'down' || f.posture === 'out' || f.out;
        if (!standing && !excused) {
          push('I3', `free fighter ${f.id} is in ${f.position}`, [f.id]);
        }
        if (f.role !== 'none' && !excused) {
          push('I3', `free fighter ${f.id} still has role ${f.role}`, [f.id]);
        }
      }

      // I5 (second half): a submission needs an engagement at all.
      if (f.submission && !this.byFighter.has(f.id)) {
        push('I5', `fighter ${f.id} holds ${f.submission} while in no engagement`, [f.id]);
      }

      // I7 Out is terminal: once out, never anything else.
      if (f.out) this.everOut.add(f.id);
      else if (this.everOut.has(f.id)) {
        push('I7', `fighter ${f.id} was out and is not out any more`, [f.id]);
      }
      if (f.out && this.byFighter.has(f.id)) {
        push('I7', `fighter ${f.id} is out but still engaged`, [f.id]);
      }
    }

    // I6 Legality: chapter 06 reports any technique that the ruleset forbids
    // and that was not emitted as a `foul` event.
    // TODO(chapter 06): the referee module fills `illegalUnflagged`; until it
    // exists this check passes vacuously.
    for (const bad of world.referee?.illegalUnflagged ?? []) {
      push('I6', `illegal ${bad.technique} by fighter ${bad.fighter} not flagged as a foul (${bad.reason})`,
        [bad.fighter]);
    }

    // I8 Referee count: at most one, and only where the ruleset has counts.
    const ref = world.referee;
    if (ref) {
      if (ref.activeCounts > 1) {
        push('I8', `${ref.activeCounts} referee counts are active at once`, []);
      }
      if (ref.activeCounts > 0 && !ref.rulesetHasCounts) {
        push('I8', 'a referee count is running under a ruleset that has no counts', []);
      }
    }

    return v;
  }

  /** Forget the I7 history — for tests that reuse one set across scenarios. */
  resetHistory(): void {
    this.everOut.clear();
    this.freedAtTick.clear();
  }
}
