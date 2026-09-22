/** Shared state types for the simulation, recorder and renderer. */

export type Posture = 'standing' | 'clinch' | 'ground' | 'down';
export type GroundPosition = 'none' | 'guard' | 'half' | 'side' | 'mount' | 'back';
export type GroundRole = 'none' | 'top' | 'bottom';

export type ActionKind =
  | 'idle' | 'advance' | 'retreat' | 'circle'
  | 'jab' | 'cross' | 'hook' | 'uppercut'
  | 'lowKick' | 'bodyKick' | 'headKick' | 'teep'
  | 'clinchEntry' | 'clinchKnee' | 'breakClinch'
  | 'shoot' | 'sprawlDefend'
  | 'groundStrike' | 'passGuard' | 'sweep' | 'standUp' | 'submission'
  | 'recover';

export type DefenseKind = 'neutral' | 'highGuard' | 'slip' | 'parry' | 'sprawl' | 'frame' | 'subDefend';

/** Per-tick mutable state of one fighter. */
export interface FighterState {
  id: number;
  team: 'A' | 'B';
  label: string;
  /** Position on the canvas floor, metres. */
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Facing angle, radians. */
  facing: number;

  stamina: number;
  staminaMax: number;
  balance: number;
  damage: number;
  durability: number;

  action: ActionKind;
  /** 0..1 progress through the current action. */
  actionPhase: number;
  actionTicks: number;
  actionTotal: number;
  actionTarget: number;
  /** Set on the tick the action resolves, for the renderer. */
  actionResult: 'none' | 'landed' | 'blocked' | 'evaded' | 'missed';

  defense: DefenseKind;
  posture: Posture;
  groundRole: GroundRole;
  groundPosition: GroundPosition;
  groundOpponent: number;
  downTicks: number;
  out: boolean;

  subProgress: number;

  // running tallies
  sigLanded: number;
  sigAttempted: number;
  strikesAbsorbed: number;
  takedownsLanded: number;
  takedownsAttempted: number;
  subAttempts: number;
  controlTicks: number;
  score: number;
}

export type EventKind =
  | 'boutStart' | 'roundStart' | 'roundEnd' | 'boutEnd'
  | 'strike' | 'takedown' | 'clinch' | 'clinchBreak'
  | 'positionChange' | 'submissionAttempt' | 'submissionFinish'
  | 'knockdown' | 'standUp' | 'refereeStoppage' | 'fighterOut' | 'decision';

export interface BoutEvent {
  t: number;            // simulated seconds from the opening horn
  tick: number;
  round: number;
  kind: EventKind;
  actor: number;        // fighter id, -1 for the referee / bout-level events
  target: number;       // -1 if not applicable
  /** Machine-readable detail, e.g. 'hook' or 'mount'. */
  detail: string;
  /** Outcome for resolvable actions. */
  result?: 'landed' | 'blocked' | 'evaded' | 'missed' | 'success' | 'stuffed';
  /** Damage index applied, if any. */
  value?: number;
  text: string;         // human-readable line for the timeline UI
}

export type Method =
  | 'referee stoppage (strikes)'
  | 'referee stoppage (ground strikes)'
  | 'submission (tap)'
  | 'unanimous decision'
  | 'split decision'
  | 'majority decision'
  | 'draw'
  | 'all opponents stopped';

export interface BoutResult {
  winner: 'A' | 'B' | 'draw';
  method: Method;
  round: number;
  timeSeconds: number;
  scorecards: number[][];   // [judge][round] margin for A
  judgeTotals: { a: number; b: number }[];
}

/** One compact per-tick snapshot per fighter, for rendering and analytics. */
export interface TickSnapshot {
  tick: number;
  t: number;
  round: number;
  roundTime: number;
  phase: 'round' | 'break' | 'ended';
  fighters: {
    id: number;
    x: number; z: number; facing: number;
    stamina: number; balance: number; damage: number;
    action: ActionKind; actionPhase: number; actionResult: FighterState['actionResult'];
    defense: DefenseKind;
    posture: Posture; groundRole: GroundRole; groundPosition: GroundPosition;
    down: boolean; out: boolean; subProgress: number; score: number;
    sigLanded: number; sigAttempted: number;
  }[];
}
