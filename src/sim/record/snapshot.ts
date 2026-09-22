/**
 * TICK SNAPSHOT v4 — the only sim state the presenter and the UI ever read.
 *
 * Two rules govern this file (docs/design/09 §1.3.2, §1.4):
 *
 *  1. Presentation is a pure function of (snapshot, next, alpha, event window)
 *     plus the fighter definitions. The presenter may not import sim internals,
 *     so everything it needs is exposed here — including the fields chapter 08
 *     asked for (velocities for motion matching, grips and contact flags for
 *     IK, visual damage zones, fatigue tells).
 *
 *  2. Only a subset is digested (09 §1.5.3). The digest is the replay
 *     verification contract; adding a presentation-only field here must not
 *     change any recorded bout.
 */
import type { DefenceId, PositionId, SubmissionId, TechniqueId } from '../core/ids';

export type Posture = 'standing' | 'clinch' | 'ground' | 'down' | 'out';
export type EngagementRole = 'none' | 'top' | 'bottom' | 'attacker' | 'defender';
export type ActionStage = 'startup' | 'contact' | 'recovery' | 'none';
export type ActionResult =
  | 'none' | 'landed' | 'blocked' | 'evaded' | 'missed' | 'interrupted' | 'success' | 'stuffed';

export interface FighterSnapshot {
  id: number;
  team: number;

  // ---- placement ---------------------------------------------------------
  x: number;
  z: number;
  facing: number;
  vx: number;
  vz: number;
  stance: 'orthodox' | 'southpaw';
  /** Lead foot lateral offset in the fighter's own frame, metres. */
  leadFoot: number;
  againstFence: boolean;
  fenceNormalAngle: number;

  // ---- engagement --------------------------------------------------------
  posture: Posture;
  position: PositionId;
  role: EngagementRole;
  partnerId: number | null;

  // ---- what they are doing ----------------------------------------------
  action: TechniqueId | 'idle' | 'move';
  actionPhase: number;
  actionStage: ActionStage;
  actionResult: ActionResult;
  defence: DefenceId;
  actionDetail: {
    startTick: number;
    totalMs: number;
    contactTick: number;
    contactOffsetMs: number;
    target: 'head' | 'body' | 'leadLeg' | 'rearLeg' | 'arms' | 'none';
    subLocation: string | null;
    side: 'L' | 'R';
    targetId: number | null;
    /** 0-1 normalised force, for hit-reaction strength. */
    forceNorm: number;
    direction: 'front' | 'left' | 'right' | 'up' | 'down';
  };
  defenceDetail: { phase: number; side: 'L' | 'R' | 'both' };

  // ---- condition ---------------------------------------------------------
  /** Energy pools, 0-1. `total` is the aerobic/glycolytic reserve; `burst` the phosphagen. */
  stamina: { total: number; burst: number };
  /** Regional damage, 0-1 of each pool. head >= 1 is the KO threshold crossing. */
  damage: { head: number; body: number; legs: number; cut: number };
  /** Digested summary bitfield of the active states. */
  state: number;
  /** Full state id list (chapter 05 / 04 ids, with side suffixes). */
  states: string[];
  balance: number;

  // ---- submission --------------------------------------------------------
  sub: { technique: SubmissionId | null; stage: 0 | 1 | 2 | 3 | 4; progress: number };

  // ---- running tallies for the HUD --------------------------------------
  sig: { landed: number; attempted: number };

  // ---- strategy ----------------------------------------------------------
  /** Chapter 07 primary-mode short id, for the HUD and commentary. */
  intentTag: string;

  // ---- presentation-only (never digested) -------------------------------
  grips: { hand: 'L' | 'R'; socket: string; on: number; strength: number }[];
  contacts: {
    footL: boolean; footR: boolean; kneeL: boolean; kneeR: boolean;
    handL: boolean; handR: boolean; hipL: boolean; hipR: boolean;
    back: boolean; chest: boolean; fence: boolean;
  };
  damageVisual: {
    zones: number[];
    swelling: number[];
    cuts: { site: string; severity: 1 | 2 | 3; bleeding: boolean; ageS: number }[];
    bloodOnGloves: number;
  };
  fatigueVisual: {
    f: number; breathingRate: number; handsDrop: number; flatFeet: number; chinUp: number;
  };
}

export interface EngagementSnapshot {
  a: number;
  b: number;
  node: PositionId;
  sinceTick: number;
  kind: 'clinch' | 'takedown' | 'throw' | 'ground' | 'scramble' | 'knockdown';
  cage: boolean;
  underhookOwner: 'a' | 'b' | null;
  /** Off-balance direction (one of eight) and magnitude (0-3). */
  kuzushi: { dir: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; mag: 0 | 1 | 2 | 3 };
  posture: 'chest' | 'postured';
  inflight: { edge: string; tStart: number; dur: number; phase: number } | null;
  /** Interaction root for paired animation (chapter 08). */
  rootX: number;
  rootZ: number;
  rootYaw: number;
}

export interface TickSnapshot {
  v: 4;
  tick: number;
  t: number;
  round: number;
  roundTime: number;
  phase: 'pre' | 'round' | 'break' | 'ended';
  fighters: FighterSnapshot[];
  engagements: EngagementSnapshot[];
  referee: {
    state: 'watching' | 'counting' | 'warning' | 'separating' | 'stopping';
    count?: number;
    target?: number;
  };
  score: { hidden: boolean; cards?: number[][] };
}
