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

// ---------------------------------------------------------------------------
// Snapshot construction (added in the module-binding phase; the types above are
// unchanged, because a stored replay must keep verifying).
//
// Only the fields listed in 09 §1.5.3 are digested. Everything else here is
// presentation-only: the presenter is a pure function of (snapshot, next,
// alpha, event window), so anything chapter 08 needs has to be on this record
// even when no sim module owns it yet. Those fields carry a documented neutral
// default and a `TODO(chapter 08)` marker.
// ---------------------------------------------------------------------------
import type { World, FighterWorldState } from '../core/world';
import { actionProgress } from '../core/scheduler';
import { judgeRuntime, refereeRuntime } from '../core/build';
import { distanceToWall, wallNormalAngle } from '../rules/arenas/types';

const CAGE_CONTACT_M = 0.5;

function actionOf(f: FighterWorldState): TechniqueId | 'idle' | 'move' {
  if (f.action !== null) return f.action;
  return Math.hypot(f.vx, f.vz) > 0.05 ? 'move' : 'idle';
}

function sideOf(f: FighterWorldState): 'L' | 'R' {
  // Lead side is the left for an orthodox fighter; the presenter only needs to
  // know which limb to animate, not which knuckle landed.
  return f.stance === 'orthodox' ? 'L' : 'R';
}

function fighterSnapshot(world: World, f: FighterWorldState): FighterSnapshot {
  const dmg = f.damage.snapshotFields();
  const pending = world.scheduler.queue.pendingFor(f.id);
  const progress = pending
    ? actionProgress(pending, world.nowMs, f.actionStartupMs, f.actionActiveMs)
    : { phase: 0, stage: 'none' as ActionStage };
  const wallD = distanceToWall(world.arena, f.x, f.z);
  const engagement = world.engagements.of(f.id);

  return {
    id: f.id,
    team: f.team,
    x: f.x,
    z: f.z,
    facing: f.facing,
    vx: f.vx,
    vz: f.vz,
    stance: f.stance,
    // TODO(chapter 08): 02's `LEAD_FOOT` geometry is not exposed per tick yet;
    // the neutral default is a square stance (no lateral lead-foot offset).
    leadFoot: 0,
    againstFence: wallD <= CAGE_CONTACT_M,
    fenceNormalAngle: wallNormalAngle(world.arena, f.x, f.z),

    posture: f.posture,
    position: f.position,
    role: world.engagements.roleOf(f.id),
    partnerId: f.partnerId,

    action: actionOf(f),
    actionPhase: progress.phase,
    actionStage: progress.stage,
    actionResult: f.actionResult,
    defence: f.defence,
    actionDetail: {
      startTick: pending ? Math.floor(pending.commitMs / 100) : world.tick,
      totalMs: f.actionTotalMs,
      contactTick: pending ? pending.tick : world.tick,
      contactOffsetMs: pending ? pending.subMs : 0,
      // TODO(chapter 08): the aimed region is carried on the scheduler payload
      // and is not part of the public `ScheduledContact` shape; 'none' until
      // the presenter needs it.
      target: 'none',
      subLocation: null,
      side: sideOf(f),
      targetId: f.actionTargetId,
      forceNorm: 0,
      direction: 'front',
    },
    // TODO(chapter 08): 02's reactive-defence layer does not expose a per-tick
    // phase; a held guard reads as fully established on both sides.
    defenceDetail: { phase: 1, side: 'both' },

    stamina: dmg.stamina,
    damage: dmg.damage,
    state: dmg.state,
    states: dmg.states,
    balance: f.balance,

    sub: { technique: f.sub.technique, stage: f.sub.stage, progress: f.sub.progress },
    sig: { landed: f.sigLanded, attempted: f.sigAttempted },
    intentTag: f.intentTag,

    // TODO(chapter 08): 03 models grips as node state, not as named sockets on
    // a rig. Until the socket table exists the list is empty, which the
    // presenter reads as "no IK targets".
    grips: [],
    contacts: {
      footL: f.posture === 'standing' || f.posture === 'clinch',
      footR: f.posture === 'standing' || f.posture === 'clinch',
      kneeL: f.posture === 'ground' || f.posture === 'down',
      kneeR: f.posture === 'ground' || f.posture === 'down',
      handL: false,
      handR: false,
      hipL: f.posture === 'down',
      hipR: f.posture === 'down',
      back: f.posture === 'down' && world.engagements.roleOf(f.id) === 'bottom',
      chest: engagement?.posture === 'chest' && f.posture === 'ground',
      fence: wallD <= CAGE_CONTACT_M && world.arena.wall !== 'none',
    },
    damageVisual: dmg.damageVisual,
    fatigueVisual: dmg.fatigueVisual,
  };
}

/**
 * The whole sim state the presenter and the UI are allowed to read, for the
 * current tick. Pure: it allocates a new record and writes nothing back.
 */
export function buildSnapshot(world: World): TickSnapshot {
  const ref = refereeRuntime(world);
  const judges = judgeRuntime(world);
  const open = world.ruleset.scoring.openScoring !== 'hidden';
  return {
    v: 4,
    tick: world.tick,
    t: world.nowMs / 1000,
    round: world.round,
    roundTime: (world.roundTick * 100) / 1000,
    phase: world.phase,
    fighters: world.fighters.map((f) => fighterSnapshot(world, f)),
    engagements: world.engagements.toSnapshot((e) => {
      const a = world.fighters[e.a];
      const b = e.b >= 0 ? world.fighters[e.b] : null;
      if (!a) return { x: 0, z: 0, yaw: 0 };
      if (!b) return { x: a.x, z: a.z, yaw: a.facing };
      return {
        x: (a.x + b.x) / 2,
        z: (a.z + b.z) / 2,
        yaw: Math.atan2(b.x - a.x, b.z - a.z),
      };
    }),
    referee: ref.display,
    score: {
      hidden: !open,
      cards: open && judges.panel
        ? judges.panel.cards.map((rounds) => rounds.map((r) => r[0] - r[1]))
        : undefined,
    },
  };
}
