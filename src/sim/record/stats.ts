/**
 * BOUT STATISTICS — the UFCStats-compatible tallies of docs/design/09 §4.1.
 *
 * `computeStats` is a pure function of `(events, config, ticks)`. It never
 * reads the world, which is what lets the dashboard recompute a stored replay's
 * numbers without re-simulating, and what lets `stats.test.ts` check the
 * tallies against the event log rather than against the engine that produced
 * them.
 *
 * Time-based stats (control time, position time, the three-second takedown
 * stabilisation) cannot come from a single event: they need the *state between*
 * events. So the function replays the event stream tick by tick, maintaining
 * the minimum state each definition needs, and integrates `dt` while that state
 * holds. Nothing here is random and nothing is approximate — the same event log
 * always yields the same numbers.
 */
import type { SimConfig } from '../core/config';
import type { PositionId } from '../core/ids';
import type { SimEvent } from './events';
import {
  hasPositionNode, isMatNode as isMatNodeShared, isReversal, isTakedownAttempt, positionNode, roleFor,
} from '../grappling';

/** Seconds a takedown must be held before UFCStats records it (09 §4.1). */
export const TD_HOLD_SECONDS = 3;
/** Re-grips inside this window are the same submission attempt (09 §4.1). */
export const SUB_REGRIP_SECONDS = 5;

const DT_S = 0.1;

export type StrikePosition = 'distance' | 'clinch' | 'ground';

export interface LandedAttempted {
  landed: number;
  attempted: number;
}

export interface FighterRoundStats {
  fighter: number;
  /** Significant strikes, by the §4.1 definition. */
  sig: LandedAttempted;
  sigByTarget: { head: LandedAttempted; body: LandedAttempted; leg: LandedAttempted };
  sigByPosition: { distance: LandedAttempted; clinch: LandedAttempted; ground: LandedAttempted };
  /** All strikes, significant or not. */
  total: LandedAttempted;
  knockdowns: number;
  takedowns: LandedAttempted;
  subAttempts: number;
  reversals: number;
  controlSeconds: number;
  /** Mirrors of the opponents' tallies (§4.1 rows 46, 50, 51). */
  sigAbsorbed: number;
  headSigAbsorbed: number;
  subAttemptsAgainst: number;
}

export interface RoundStats {
  /** 0 for the bout total. */
  round: number;
  seconds: number;
  /** Shared phase time, both fighters (§4.1 row 24). */
  positionSeconds: { distance: number; clinch: number; ground: number };
  fighters: FighterRoundStats[];
}

export interface FighterStatBlock extends FighterRoundStats {
  knockdownsByRound: number[];
}

export interface BoutStats {
  perRound: RoundStats[];
  total: RoundStats;
  fighters: FighterStatBlock[];
  /** `[judge][round][fighter]`, copied from the `scorecardRound` events. */
  cards: number[][][];
}

// ---------------------------------------------------------------------------

function emptyLA(): LandedAttempted {
  return { landed: 0, attempted: 0 };
}

function emptyFighter(id: number): FighterRoundStats {
  return {
    fighter: id,
    sig: emptyLA(),
    sigByTarget: { head: emptyLA(), body: emptyLA(), leg: emptyLA() },
    sigByPosition: { distance: emptyLA(), clinch: emptyLA(), ground: emptyLA() },
    total: emptyLA(),
    knockdowns: 0,
    takedowns: emptyLA(),
    subAttempts: 0,
    reversals: 0,
    controlSeconds: 0,
    sigAbsorbed: 0,
    headSigAbsorbed: 0,
    subAttemptsAgainst: 0,
  };
}

function emptyRound(round: number, n: number): RoundStats {
  return {
    round,
    seconds: 0,
    positionSeconds: { distance: 0, clinch: 0, ground: 0 },
    fighters: Array.from({ length: n }, (_, i) => emptyFighter(i)),
  };
}

function addLA(into: LandedAttempted, from: LandedAttempted): void {
  into.landed += from.landed;
  into.attempted += from.attempted;
}

function addFighter(into: FighterRoundStats, from: FighterRoundStats): void {
  addLA(into.sig, from.sig);
  for (const k of ['head', 'body', 'leg'] as const) addLA(into.sigByTarget[k], from.sigByTarget[k]);
  for (const k of ['distance', 'clinch', 'ground'] as const) {
    addLA(into.sigByPosition[k], from.sigByPosition[k]);
  }
  addLA(into.total, from.total);
  addLA(into.takedowns, from.takedowns);
  into.knockdowns += from.knockdowns;
  into.subAttempts += from.subAttempts;
  into.reversals += from.reversals;
  into.controlSeconds += from.controlSeconds;
  into.sigAbsorbed += from.sigAbsorbed;
  into.headSigAbsorbed += from.headSigAbsorbed;
  into.subAttemptsAgainst += from.subAttemptsAgainst;
}

/** The phase a node sits in, for "sig by position" and "position time". */
function phaseOf(node: PositionId | null): StrikePosition {
  if (node === null || !hasPositionNode(node)) return 'distance';
  const family = positionNode(node).family;
  if (family === 'standingFree') return 'distance';
  if (family === 'clinch') return 'clinch';
  return 'ground';
}

/**
 * "On the mat" for the §4.1 takedown rule, which is narrower than `phaseOf`:
 * the §2.2.3 `attack` nodes are ground for striking purposes but nobody is down
 * yet, and `transient` is the scramble and the post-knockdown node. The
 * definition is shared with the judges (`grappling/takedowns.ts`).
 */
function isMatNode(node: PositionId | null): boolean {
  return isMatNodeShared(node);
}

/** A takedown attempt stays open this long for its chain to reach the mat. */
const TD_CHAIN_SECONDS = 10;

/**
 * 09 §4.1 significance, the FightMetric definition: every strike at distance
 * counts; in the clinch and on the ground only *power* strikes do. A short
 * strike (the event's `short` flag: an arm punch or thigh knee in the tie, a
 * short punch on the mat), a jab-type strike and a punch from the bottom are
 * total strikes only. This is the one definition — `record/stats.ts`, the
 * batch summariser and the sim's own counters all call it (Phase 9; the old
 * rule counted everything but jabs, so non-significant volume could not
 * exist and the sig/total ratio sat at 0.97 against a real 0.72).
 */
export function isSignificantStrike(technique: string, position: StrikePosition, short = false): boolean {
  if (position === 'distance') return true;
  if (short) return false;
  if (technique.startsWith('tech.jab')) return false;
  return !NON_SIG_OFF_DISTANCE.has(technique);
}

/**
 * A strike that goes on the books as landed (09 §4.1): a clean landing, or a
 * kick that met a check — it made contact, which is what FightMetric counts,
 * and what 02's `statLanded` and the sim's own running counters already said
 * (Phase 9: this file counted only 'landed', so the live tallies and the
 * computed stats disagreed by every checked kick).
 */
export function isStatLanded(result: string): boolean {
  return result === 'landed' || result === 'checked';
}

/** Techniques that are never power strikes away from distance. */
const NON_SIG_OFF_DISTANCE: ReadonlySet<string> = new Set(['tech.bottom_punch']);

function isSignificant(technique: string, position: StrikePosition, short = false): boolean {
  return isSignificantStrike(technique, position, short);
}

function targetBucket(region: string): 'head' | 'body' | 'leg' | null {
  if (region === 'head') return 'head';
  if (region === 'body') return 'body';
  if (region === 'leadLeg' || region === 'rearLeg') return 'leg';
  return null;
}

/** Per-pair engagement state the time-based definitions need. */
interface PairState {
  node: PositionId;
  /** Fighter in slot `a` of the node (top / attacker / controlling). */
  a: number;
  b: number;
  /** Tick the pair reached the mat, or -1 while nobody is down. */
  tdTick: number;
  /** Fighter credited with the takedown that put them here, or -1 for none. */
  tdBy: number;
  tdCounted: boolean;
}

/**
 * Compute every §4.1 statistic from an event log.
 *
 * `ticks` is the number of simulated ticks, needed because the last round's
 * length is not otherwise in the log.
 */
export function computeStats(
  events: readonly SimEvent[], config: SimConfig, ticks: number,
): BoutStats {
  const n = config.fighters.length;
  const rounds = new Map<number, RoundStats>();
  const cards: number[][][] = [];
  const knockdownsByRound = Array.from({ length: n }, () => [] as number[]);

  const roundOf = (r: number): RoundStats => {
    let rs = rounds.get(r);
    if (!rs) {
      rs = emptyRound(r, n);
      rounds.set(r, rs);
    }
    return rs;
  };

  // Events grouped by tick, in log order (which is already resolution order).
  const byTick = new Map<number, SimEvent[]>();
  let maxRound = 1;
  for (const e of events) {
    const list = byTick.get(e.tick);
    if (list) list.push(e);
    else byTick.set(e.tick, [e]);
    if (e.round > maxRound) maxRound = e.round;
  }

  // Engagement reconstruction: fighter id -> the pair record they are in.
  const pairOf = new Map<number, PairState>();
  const lastSubAttempt = new Map<string, number>();
  let round = 1;

  // Open takedown attempts: shooter id -> tick the attempt started. A chain
  // runs capture -> finish (or a throw straight to the mat) across one or
  // more edges; the landing is credited to the shooter only if the chain puts
  // him on top on the mat, once per attempt (Phase 9: a guard pull, a
  // knockdown follow-up, an escape or a stuffed get-up that "re-created" the
  // pair used to be credited as a landed takedown with no attempt behind it).
  const openShot = new Map<number, number>();
  const clearAfterTick: number[] = [];
  let live = true;

  const clearPair = (id: number): void => {
    const p = pairOf.get(id);
    if (!p) return;
    pairOf.delete(p.a);
    pairOf.delete(p.b);
  };

  const setPair = (a: number, b: number, node: PositionId, tick: number): void => {
    const prev = pairOf.get(a);
    const same = prev !== undefined
      && ((prev.a === a && prev.b === b) || (prev.a === b && prev.b === a));
    const carried = same ? prev : undefined;
    clearPair(a);
    clearPair(b);
    if (phaseOf(node) === 'distance') return;

    // §4.1: the stabilisation clock starts when the pair first reaches the mat
    // and runs until they leave it. A position change *on* the mat is not a
    // new takedown and does not cancel the one in progress.
    let tdTick = -1;
    let tdBy = -1;
    let tdCounted = false;
    if (isMatNode(node)) {
      if (carried && isMatNode(carried.node) && carried.tdTick >= 0) {
        tdTick = carried.tdTick;
        tdBy = carried.tdBy;
        tdCounted = carried.tdCounted;
      } else {
        tdTick = tick;
        const role = roleFor(node, 'a');
        const shotAt = openShot.get(a);
        if ((role === 'top' || role === 'attacker') && shotAt !== undefined
          && (tick - shotAt) * DT_S <= TD_CHAIN_SECONDS) {
          tdBy = a;
          openShot.delete(a);
        }
        // Whoever shot, the chain is over once the pair is down.
        openShot.delete(b);
      }
    }
    const p: PairState = { node, a, b, tdTick, tdBy, tdCounted };
    pairOf.set(a, p);
    pairOf.set(b, p);
  };

  const lastTick = Math.max(ticks, events.length > 0 ? events[events.length - 1].tick : 0);

  for (let tick = 1; tick <= lastTick; tick++) {
    const here = byTick.get(tick);
    if (here) {
      for (const e of here) {
        if (e.round > 0) round = e.round;
        applyEvent(e);
      }
      for (const id of clearAfterTick) clearPair(id);
      clearAfterTick.length = 0;
    }
    // The break between rounds is not fight time: no position, no control.
    if (!live) continue;

    // ---- integrate the tick ------------------------------------------------
    const rs = roundOf(round);
    rs.seconds += DT_S;
    // Position time is the *shared* phase: the pair's node, or distance.
    const anyPair = [...new Set(pairOf.values())];
    const phase: StrikePosition = anyPair.length === 0 ? 'distance' : phaseOf(anyPair[0].node);
    rs.positionSeconds[phase] += DT_S;

    for (const p of anyPair) {
      // Control time: the node's slot-`a` role is the controlling party, and a
      // symmetric node (neutral clinch, scramble, 50/50) controls nobody.
      const node = hasPositionNode(p.node) ? positionNode(p.node) : null;
      if (!node || node.symmetric) continue;
      const roleA = roleFor(p.node, 'a');
      if (roleA === 'top' || roleA === 'attacker') {
        const f = rs.fighters[p.a];
        if (f) f.controlSeconds += DT_S;
      }
      // Takedown stabilisation (§4.1: landed = held >= 3 s).
      if (!p.tdCounted && p.tdTick >= 0 && p.tdBy >= 0 && isMatNode(p.node)
        && (tick - p.tdTick) * DT_S >= TD_HOLD_SECONDS) {
        p.tdCounted = true;
        const f = rs.fighters[p.tdBy];
        if (f) f.takedowns.landed++;
      }
    }
  }

  /** Slot `a` after a grapple event: `detail.a`, else (older logs) the actor. */
  function slotAOf(e: SimEvent & { detail: { a?: number } }): [number, number] {
    const a = e.detail.a;
    if (a === undefined || a === e.actor) return [e.actor, e.target];
    return [a, a === e.target ? e.actor : e.target];
  }

  function applyEvent(e: SimEvent): void {
    const rs = roundOf(e.round > 0 ? e.round : round);
    const actor = e.actor >= 0 && e.actor < n ? rs.fighters[e.actor] : null;
    const target = e.target >= 0 && e.target < n ? rs.fighters[e.target] : null;

    switch (e.kind) {
      case 'strike': {
        if (!actor) break;
        const pair = pairOf.get(e.actor);
        // QA2 #6 (engine 6.0): a strike is classified as it was *thrown* —
        // the position and significance the sim recorded at commit — so these
        // tallies equal the live counters. Older logs fall back to the pair
        // state at the event.
        const position = e.detail.pos ?? phaseOf(pair ? pair.node : null);
        const landed = isStatLanded(e.detail.result);
        const sig = e.detail.sig ?? isSignificant(e.detail.technique, position, e.detail.short === true);
        actor.total.attempted++;
        if (landed) actor.total.landed++;
        if (sig) {
          actor.sig.attempted++;
          actor.sigByPosition[position].attempted++;
          const bucket = targetBucket(e.detail.target);
          if (bucket) actor.sigByTarget[bucket].attempted++;
          if (landed) {
            actor.sig.landed++;
            actor.sigByPosition[position].landed++;
            if (bucket) actor.sigByTarget[bucket].landed++;
            if (target) {
              target.sigAbsorbed++;
              if (bucket === 'head') target.headSigAbsorbed++;
            }
          }
        }
        break;
      }
      case 'knockdown': {
        if (actor) actor.knockdowns++;
        const list = knockdownsByRound[e.actor];
        if (list) {
          while (list.length < e.round) list.push(0);
          list[e.round - 1] = (list[e.round - 1] ?? 0) + 1;
        }
        // A knockdown separates the pair: the downed fighter is not "controlled".
        // The strike that caused it is logged *after* its damage events on
        // the same tick, and was thrown from the pair's position: the pair
        // is cleared once the tick's events are all in (Phase 9).
        clearAfterTick.push(e.target);
        break;
      }
      case 'takedown':
      case 'clinch':
      case 'engagementJoin':
      case 'positionChange':
      case 'scramble':
      case 'reversal':
      case 'standUp':
      case 'clinchBreak':
      case 'disengage': {
        const d = e.detail;
        const success = d.result === 'success';
        // A contested edge the fighter lost the race for never started: it has
        // no destination, and it changes nothing.
        if (d.reason === 'contested') break;
        // `engagementJoin` is the pair-opening twin of the edge's own event
        // (same edge, same tick): count the attempt once, on the edge event.
        if (actor && e.kind !== 'engagementJoin' && isTakedownAttempt(d.edge, d.from)) {
          actor.takedowns.attempted++;
          openShot.set(e.actor, e.tick);
        }
        if (actor && e.kind !== 'engagementJoin' && isReversal(d.edge, d.from, d.to, success, e.actor, d.a)) actor.reversals++;
        if (d.to) {
          const [a, b] = slotAOf(e as SimEvent & { detail: { a?: number } });
          setPair(a, b, d.to, e.tick);
        } else if (success && (e.kind === 'standUp' || e.kind === 'clinchBreak' || e.kind === 'disengage')) {
          clearPair(e.actor);
          clearPair(e.target);
        }
        // A chain that ends back on the feet, pair dissolved, is over.
        if (!pairOf.has(e.actor)) openShot.delete(e.actor);
        break;
      }
      case 'roundEnd':
        // The engine separates the pair for the break (P0 break recovery).
        pairOf.clear();
        openShot.clear();
        live = false;
        break;
      case 'roundStart':
        live = true;
        break;
      case 'submissionStage': {
        if (!actor) break;
        if (e.detail.stage < 2) break;
        const key = `${e.actor}:${e.detail.technique}`;
        const last = lastSubAttempt.get(key);
        if (last === undefined || (e.tick - last) * DT_S > SUB_REGRIP_SECONDS) {
          actor.subAttempts++;
          if (target) target.subAttemptsAgainst++;
        }
        lastSubAttempt.set(key, e.tick);
        break;
      }
      case 'submissionFinish':
      case 'fighterOut':
        clearPair(e.actor);
        clearPair(e.target);
        break;
      case 'scorecardRound': {
        const c = e.detail.cards;
        if (c) {
          for (let j = 0; j < c.length; j++) {
            if (!cards[j]) cards[j] = [];
            cards[j].push([...c[j]]);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  const perRound = [...rounds.keys()].sort((a, b) => a - b).map((r) => rounds.get(r)!);
  const total = emptyRound(0, n);
  for (const rs of perRound) {
    total.seconds += rs.seconds;
    total.positionSeconds.distance += rs.positionSeconds.distance;
    total.positionSeconds.clinch += rs.positionSeconds.clinch;
    total.positionSeconds.ground += rs.positionSeconds.ground;
    for (let i = 0; i < n; i++) addFighter(total.fighters[i], rs.fighters[i]);
  }

  const fighters: FighterStatBlock[] = total.fighters.map((f, i) => ({
    ...f,
    knockdownsByRound: knockdownsByRound[i].slice(),
  }));

  return { perRound, total, fighters, cards };
}
