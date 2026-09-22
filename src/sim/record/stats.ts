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
import { positionNode, hasPositionNode, roleFor } from '../grappling';

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
 * 09 §4.1 significance: landed at distance always counts; in clinch or on the
 * ground only power strikes do. The event carries the technique id, which is
 * all that is needed to tell a jab from a power strike.
 */
function isSignificant(technique: string, position: StrikePosition): boolean {
  if (position === 'distance') return true;
  return !technique.startsWith('tech.jab');
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
  /** Fighter in slot `a` of the node. */
  a: number;
  b: number;
  /** Tick the pair entered a ground node through a takedown, or -1. */
  tdTick: number;
  /** Fighter credited with the takedown that put them here, or -1. */
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

  const clearPair = (id: number): void => {
    const p = pairOf.get(id);
    if (!p) return;
    pairOf.delete(p.a);
    pairOf.delete(p.b);
  };

  const setPair = (a: number, b: number, node: PositionId, tick: number, byTakedown: boolean): void => {
    clearPair(a);
    clearPair(b);
    if (phaseOf(node) === 'distance') return;
    const p: PairState = {
      node, a, b,
      tdTick: byTakedown ? tick : -1,
      tdBy: byTakedown ? a : -1,
      tdCounted: false,
    };
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
    }

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
      if (!p.tdCounted && p.tdTick >= 0 && phaseOf(p.node) === 'ground'
        && (tick - p.tdTick) * DT_S >= TD_HOLD_SECONDS) {
        p.tdCounted = true;
        const f = rs.fighters[p.tdBy];
        if (f) f.takedowns.landed++;
      }
    }
  }

  function applyEvent(e: SimEvent): void {
    const rs = roundOf(e.round > 0 ? e.round : round);
    const actor = e.actor >= 0 && e.actor < n ? rs.fighters[e.actor] : null;
    const target = e.target >= 0 && e.target < n ? rs.fighters[e.target] : null;

    switch (e.kind) {
      case 'strike': {
        if (!actor) break;
        const pair = pairOf.get(e.actor);
        const position = phaseOf(pair ? pair.node : null);
        const landed = e.detail.result === 'landed';
        const sig = isSignificant(e.detail.technique, position);
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
        clearPair(e.target);
        break;
      }
      case 'takedown': {
        if (actor) actor.takedowns.attempted++;
        if (e.detail.result === 'success' && e.detail.to) {
          setPair(e.actor, e.target, e.detail.to, e.tick, true);
        }
        break;
      }
      case 'clinch':
      case 'engagementJoin':
      case 'positionChange':
      case 'scramble':
      case 'reversal': {
        if (e.kind === 'reversal' && actor) actor.reversals++;
        if (e.detail.to) setPair(e.actor, e.target, e.detail.to, e.tick, false);
        break;
      }
      case 'standUp':
      case 'clinchBreak':
      case 'disengage':
        clearPair(e.actor);
        clearPair(e.target);
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
