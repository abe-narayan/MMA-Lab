/**
 * SIM EVENTS — the append-only timeline.
 *
 * A replay file stores the seed plus this event stream plus a digest; it never
 * stores frames. Everything the UI, the commentary system, the stats tallies
 * and the calibration metrics read comes from here.
 *
 * Four design chapters named events in their own vocabularies; the canonical
 * mapping is the table in docs/design/09 §1.4, and `detail` carries the source
 * chapter's payload verbatim.
 *
 * `subMs` is the intra-tick resolution offset in [0, 100) and is part of the
 * ordering contract (09 §2.2): contacts in one tick resolve in
 * `(subMs, actorId, seq)` order, and a replay that reproduces the same event
 * stream must reproduce the same offsets.
 */
import type { DefenceId, PositionId, SubmissionId, TechniqueId } from '../core/ids';

export type SimEventKind =
  // bout structure
  | 'boutStart' | 'roundStart' | 'roundEnd' | 'boutEnd' | 'decision'
  // striking
  | 'strike' | 'feint' | 'read'
  // grappling
  | 'takedown' | 'clinch' | 'clinchBreak' | 'positionChange' | 'scramble' | 'reversal'
  | 'standUp' | 'engagementJoin' | 'disengage' | 'slam'
  // submissions
  | 'submissionStage' | 'submissionFinish'
  // damage
  | 'knockdown' | 'rocked' | 'stateChange' | 'injury'
  // officials
  | 'refereeWarning' | 'refereeCount' | 'standingEight' | 'refereeBreak' | 'refereeTimeout'
  | 'foul' | 'deduction' | 'refereeStoppage' | 'doctorCheck' | 'cornerStop' | 'timidityWarning'
  | 'fighterOut' | 'scorecardRound' | 'pointsAwarded' | 'judoScore'
  // strategy / AI
  | 'planSet' | 'intentChange' | 'adjustment' | 'cornerCue' | 'scoreUpdate'
  | 'paceShift' | 'stanceSwitch' | 'targetSwitch' | 'roleAssign' | 'trap' | 'emergency'
  // multi-opponent / street
  | 'flight' | 'streetEnd';

export type StrikeResult =
  | 'landed' | 'blocked' | 'evaded' | 'missed' | 'checked' | 'caught' | 'interrupted';
export type GrappleResult = 'success' | 'stuffed' | 'countered' | 'interrupted';

/** Fields every event carries. */
export interface SimEventBase {
  tick: number;
  /** Intra-tick offset in [0, 100) ms — part of the ordering contract. */
  subMs: number;
  round: number;
  kind: SimEventKind;
  /** Fighter id, or -1 for referee / judges / bout-level events. */
  actor: number;
  /** Fighter id, or -1 when not applicable. */
  target: number;
  /** Human-readable line for the timeline UI. Excluded from replay verification. */
  text: string;
}

export interface StrikeEvent extends SimEventBase {
  kind: 'strike';
  detail: {
    technique: TechniqueId;
    result: StrikeResult;
    target: 'head' | 'body' | 'leadLeg' | 'rearLeg' | 'arms';
    subLocation?: string;
    /** Delivered force, newtons (the Pierce in-ring scale, 02 §2.6.5). */
    forceN?: number;
    /** Damage applied to each region this strike touched, 0-1 of that pool. */
    damage?: { head?: number; body?: number; legs?: number };
    defence?: DefenceId;
    /** True when the defender never saw it coming (05 unseen multiplier). */
    unseen?: boolean;
    counter?: boolean;
    combinationIndex?: number;
    /** A short clinch/ground strike: not significant (09 §4.1). */
    short?: boolean;
  };
}

export interface GrappleEvent extends SimEventBase {
  kind: 'takedown' | 'clinch' | 'clinchBreak' | 'positionChange' | 'scramble' | 'reversal'
    | 'standUp' | 'engagementJoin' | 'disengage';
  detail: {
    edge?: string;
    from?: PositionId;
    to?: PositionId;
    result?: GrappleResult;
    cage?: boolean;
    /** Referee-initiated stand-ups and breaks say why. */
    reason?: string;
    /**
     * The fighter in slot `a` (top / attacker / controlling) of `to` after the
     * transition. Edges can hand slot `a` to either fighter (a sweep, a
     * sprawl, a failed escape that leaves the top where he was), so the
     * event's `actor` does not say who is on top. Absent on events that
     * changed no engagement.
     */
    a?: number;
  };
}

export interface SubmissionStageEvent extends SimEventBase {
  kind: 'submissionStage';
  detail: {
    technique: SubmissionId;
    /** 0 setup, 1 entry, 2 secure, 3 finish, 4 locked. */
    stage: 0 | 1 | 2 | 3 | 4;
    progress: number;
    from?: PositionId;
    defence?: string;
    /** Set when this stage change came from a chain off a failed attack. */
    chainedFrom?: SubmissionId;
  };
}

export interface SubmissionFinishEvent extends SimEventBase {
  kind: 'submissionFinish';
  detail: {
    technique: SubmissionId;
    /** How it ended: a tap, a verbal submission, going unconscious, or an injury. */
    type: 'tap' | 'verbal' | 'loc' | 'injury';
    lockedSeconds: number;
  };
}

export interface DamageEvent extends SimEventBase {
  kind: 'knockdown' | 'rocked' | 'stateChange' | 'injury' | 'slam';
  detail: {
    state?: string;
    on?: boolean;
    kind?: 'flash' | 'hurt' | 'ko' | 'body' | 'leg';
    cause?: TechniqueId;
    severity?: number;
    region?: string;
    durationS?: number;
  };
}

export interface RefereeEvent extends SimEventBase {
  kind: 'refereeWarning' | 'refereeCount' | 'standingEight' | 'refereeBreak' | 'refereeTimeout'
    | 'foul' | 'deduction' | 'refereeStoppage' | 'doctorCheck' | 'cornerStop'
    | 'timidityWarning' | 'fighterOut';
  detail: {
    method?: string;
    reason?: string;
    count?: number;
    foul?: string;
    detected?: boolean;
    intentional?: boolean;
    points?: number;
    decisionMade?: string;
    /** Seconds between the fight-ending moment and the referee's intervention. */
    lagS?: number;
    extraStrikes?: number;
  };
}

export interface ScoringEvent extends SimEventBase {
  kind: 'scorecardRound' | 'decision' | 'pointsAwarded' | 'judoScore';
  detail: {
    /** Per judge, per fighter, for this round. */
    cards?: number[][];
    method?: string;
    winner?: number | 'draw';
    points?: number;
    score?: string;
  };
}

export interface StrategyEvent extends SimEventBase {
  kind: 'planSet' | 'intentChange' | 'adjustment' | 'cornerCue' | 'scoreUpdate'
    | 'paceShift' | 'stanceSwitch' | 'targetSwitch' | 'roleAssign' | 'trap' | 'emergency'
    | 'feint' | 'read' | 'flight' | 'streetEnd';
  detail: {
    intent?: string;
    plan?: string;
    adjustment?: string;
    cue?: string;
    /** True when the opponent bought the feint. */
    bite?: boolean;
    belief?: number;
    from?: string;
    to?: string;
  };
}

export interface BoutStructureEvent extends SimEventBase {
  kind: 'boutStart' | 'roundStart' | 'roundEnd' | 'boutEnd';
  detail: { label?: string; method?: string };
}

export type SimEvent =
  | StrikeEvent | GrappleEvent | SubmissionStageEvent | SubmissionFinishEvent
  | DamageEvent | RefereeEvent | ScoringEvent | StrategyEvent | BoutStructureEvent;

/** Fields compared by `verifyReplay`; `text` is deliberately excluded. */
export const VERIFIED_EVENT_FIELDS = ['tick', 'subMs', 'kind', 'actor', 'target'] as const;

/** A window of events for the presenter: those with tick in (from, to]. */
export interface EventWindow {
  events: readonly SimEvent[];
  from: number;
  to: number;
}

export function eventWindow(events: readonly SimEvent[], from: number, to: number): EventWindow {
  return { events: events.filter((e) => e.tick > from && e.tick <= to), from, to };
}
