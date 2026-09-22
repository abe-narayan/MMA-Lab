/**
 * AI CONTRACTS — the narrow shapes the chapter-07 modules share.
 *
 * This file exists so the game-plan side (scout/plan/plans/multi) and the
 * utility side (`utility.ts`, `perceive.ts`, `policy.ts`) can be written
 * against each other without importing each other. Nothing here holds state
 * and nothing here reads the world directly.
 *
 * TODO (owner of utility.ts/perceive.ts): the action layer consumes
 * `GamePlan.actionWeights` as `w_plan(a)` (07 §2.2.3) and the multi-opponent
 * weights returned by `ai/multi.ts` as `w_multi(a)`. Both are plain
 * `ActionWeights` records keyed by the family ids below; if a family id is
 * missing from the catalogue the utility layer should treat it as 1.0 rather
 * than throw, so adding a family here is additive.
 *
 * TODO: `PerceivedOpponent` below is the *minimum* the multi-opponent manager
 * needs from `perceive.ts`. When that module lands, it may widen the shape; it
 * must not narrow it.
 *
 * See docs/design/07_STRATEGY_AND_AI.md §2.2, §2.5, §2.7 and 09 §3.1.
 */
import type { RNG } from '../rng';

// ---------------------------------------------------------------------------
// Action families
// ---------------------------------------------------------------------------

/**
 * The families the plan and the multi-opponent manager re-weight. These are
 * *families*, not technique ids: chapter 02/03/04 own the technique catalogue,
 * and each technique declares the family it belongs to. Keeping the plan at
 * family granularity is what lets one rule ("jab ×1.6") apply to every jab
 * variant without the plan generator knowing the catalogue.
 */
export const ACTION_FAMILIES = [
  // punches
  'jab', 'cross', 'hook', 'leadHook', 'uppercut', 'overhand', 'bodyHook', 'spinning',
  // kicks, knees, elbows
  'teep', 'lowKick', 'leadLowKick', 'bodyKick', 'headKick', 'rearKick', 'knee', 'elbow',
  // set-ups
  'feint', 'slipEntry', 'parryCross', 'levelChange', 'baitCross', 'inOut',
  // wrestling
  'shoot', 'nakedShot', 'shootOffStrikes', 'bodylockTd', 'trip', 'sprawl', 'cagePin',
  // clinch
  'clinchEntry', 'clinchStrike', 'breakClinch', 'wallWalk',
  // ground
  'groundStrike', 'pass', 'ride', 'sweep', 'submission', 'bottomSubmission',
  'guardPull', 'backTake', 'frontHeadlock', 'standUp',
  // movement and defence
  'advance', 'retreat', 'circle', 'circleAway', 'lateral', 'pivot',
  'longGuard', 'block', 'check', 'counterWindow', 'leadStrike',
  // misc
  'switchStance', 'flee', 'wait',
] as const;

export type ActionFamily = (typeof ACTION_FAMILIES)[number];

/** A full family → multiplier map. 1.0 means "the plan has no opinion". */
export type ActionWeights = Record<ActionFamily, number>;

/** Sparse patch produced by a single plan rule. */
export type ActionWeightPatch = Partial<Record<ActionFamily, number>>;

/** `ai.utility.clamp` — the research cap on any single action weight. */
export const WEIGHT_CLAMP_MIN = 0.25;
export const WEIGHT_CLAMP_MAX = 3.0;

export function unitWeights(): ActionWeights {
  const w = {} as ActionWeights;
  for (const f of ACTION_FAMILIES) w[f] = 1;
  return w;
}

/** Multiply a patch into a weight map in place. */
export function multiplyInto(dst: ActionWeights, patch: ActionWeightPatch): void {
  for (const k of Object.keys(patch) as ActionFamily[]) {
    const v = patch[k];
    if (v === undefined) continue;
    dst[k] *= v;
  }
}

/** Clamp every family to [0.25, 3.0] (`[S: MMA_INTEGRATION §10 rule 22]`). */
export function clampWeights(w: ActionWeights): ActionWeights {
  for (const f of ACTION_FAMILIES) {
    const v = w[f];
    w[f] = v < WEIGHT_CLAMP_MIN ? WEIGHT_CLAMP_MIN : v > WEIGHT_CLAMP_MAX ? WEIGHT_CLAMP_MAX : v;
  }
  return w;
}

// ---------------------------------------------------------------------------
// Ids introduced by chapter 07 §2.9
// ---------------------------------------------------------------------------

export type ModeId =
  | 'mode.distance_striking' | 'mode.pressure_striking' | 'mode.counter_striking'
  | 'mode.sprawl_and_brawl' | 'mode.wrestle_control' | 'mode.clinch_grind'
  | 'mode.submission_hunt' | 'mode.outnumbered';

export const PLANNABLE_MODES: readonly ModeId[] = [
  'mode.distance_striking', 'mode.pressure_striking', 'mode.counter_striking',
  'mode.sprawl_and_brawl', 'mode.wrestle_control', 'mode.clinch_grind',
  'mode.submission_hunt',
];

/** Striking-family vs grappling-family, for the "fallback is the other family" rule. */
export const STRIKING_MODES: readonly ModeId[] = [
  'mode.distance_striking', 'mode.pressure_striking', 'mode.counter_striking',
  'mode.sprawl_and_brawl',
];

export type MustNotId =
  | 'mn.rear_kick_mid_range' | 'mn.head_outside_on_shots' | 'mn.lead_with_head'
  | 'mn.engage_guard' | 'mn.naked_shot' | 'mn.stand_at_range' | 'mn.go_to_ground'
  | 'mn.dwell_in_pocket' | 'mn.back_to_fence' | 'mn.kick_the_wrestler';

export type TargetPolicyId =
  | 'tgt.nearest' | 'tgt.most_dangerous' | 'tgt.weakest' | 'tgt.assigned' | 'tgt.leader';

export type RoleId =
  | 'role.solo' | 'role.engage' | 'role.flank' | 'role.fringe' | 'role.hold'
  | 'role.hit' | 'role.protect' | 'role.flee' | 'role.bystander';

export type RangeTarget = 'long' | 'mid' | 'short';
export type PhaseTarget = 'distance' | 'clinch' | 'groundTop' | 'any';
export type InitiativeId = 'lead' | 'counter' | 'mixed';
export type TdPolicy = 'never' | 'reactive' | 'offStrikes' | 'chain' | 'any';
export type ClinchPolicy = 'avoid' | 'break' | 'accept' | 'seek' | 'wall';
export type GroundTopPolicy = 'standAndReset' | 'passByStrikes' | 'ride' | 'gnp' | 'subHunt';
export type GroundBottomPolicy = 'standUpFirst' | 'wallWalk' | 'sweep' | 'subHunt';
export type CagePolicy = 'centre' | 'cut' | 'circleAway';

/** The IQ tier chapter 07 keys on: `iqTier07` (T0 exists here, unlike 01). */
export type IqTier07 = 0 | 1 | 2 | 3 | 4 | 5;

// ---------------------------------------------------------------------------
// Policy patches — what a plan rule may change besides weights
// ---------------------------------------------------------------------------

export interface PlanPolicyPatch {
  rangeTarget?: RangeTarget;
  /** ST-4: both fighters stand 0.1 m further apart in an open stance. */
  rangeOffsetM?: number;
  phaseTarget?: PhaseTarget;
  initiative?: InitiativeId;
  cagePolicy?: CagePolicy;
  tdPolicy?: TdPolicy;
  clinchPolicy?: ClinchPolicy;
  groundTopPolicy?: GroundTopPolicy;
  groundBottomPolicy?: GroundBottomPolicy;
  /** Multiplies every round's `paceTarget`. */
  paceMult?: number;
  /** Multiplies round 1 only (adrenaline/wear-down rules). */
  r1PaceMult?: number;
  /** Multiplies every round's `tdAttemptTarget`. */
  tdAttemptMult?: number;
  /** R1/R3 specific takedown shaping (W-5, C-1). */
  r1TdMult?: number;
  r3TdMult?: number;
  /** Added to every round's `riskAppetite` before clamping to [-2, 2]. */
  riskDelta?: number;
  /** Hard cap on the selection-time combination length. */
  comboCapMax?: number;
  comboCapDelta?: number;
  /** Seconds the plan allows in the pocket / in the clinch before exiting. */
  pocketDwellS?: number;
  clinchDwellS?: number;
  /** Clinch seconds per round the plan wants (H-3 wear-down). */
  clinchTimeTargetS?: number;
  /** W-3: seconds of control the plan is aiming for. */
  controlGapTargetS?: number;
  mustNots?: MustNotId[];
  /** R-1: the long-guard posture is unlocked for this fighter. */
  longGuard?: boolean;
  /** S-4: weight-back stance (sprawl bonus, punch power penalty in 02/03). */
  weightBack?: boolean;
  /** ST-8: the plan allows switching stance mid-bout. */
  stanceSwitching?: boolean;
}

/** One rule of §2.5.4 / §2.5.5 / §2.5.6 that fired, with its effect. */
export interface PlanRuleHit {
  /** `R-1`, `S-3`, `ST-7`, … — the id used in the chapter tables. */
  id: string;
  /** Which table it came from. */
  kind: 'physical' | 'style' | 'stance' | 'ruleset' | 'override';
  /** One line for the game-plan panel and the commentary. */
  label: string;
  weights: ActionWeightPatch;
  policy?: PlanPolicyPatch;
  /** Provenance tag copied from the chapter. */
  tag: string;
}

// ---------------------------------------------------------------------------
// Multi-opponent views
// ---------------------------------------------------------------------------

/**
 * The slice of `FighterWorldState` the multi-opponent manager reads. Declared
 * structurally so `World` satisfies it without `ai/multi.ts` importing the
 * world (and so the tests can drive it with plain objects).
 */
export interface MultiFighterView {
  readonly id: number;
  readonly team: number;
  x: number;
  z: number;
  facing: number;
  posture: 'standing' | 'clinch' | 'ground' | 'down' | 'out';
  out: boolean;
  readonly runtime: { iqTier: number };
}

/** The slice of `World` the multi-opponent manager reads. */
export interface MultiWorldView {
  tick: number;
  nowMs: number;
  readonly ruleset: { family: string };
  readonly fighters: readonly MultiFighterView[];
}

/** 07 §2.7.7 — what the multi-target panel shows. */
export interface MultiTargetPanel {
  fighterId: number;
  target: number | null;
  policy: TargetPolicyId;
  threats: { id: number; threat: number; opportunity: number }[];
  role: RoleId;
  /** 1 − angularSpread/π for the outnumbered fighter. */
  lineQuality: number;
}

/**
 * The minimum the manager needs about a hostile. `perceive.ts` will supply the
 * delayed version of this; until it exists the manager reads the view above
 * and its own hit ledger.
 */
export interface PerceivedOpponent {
  id: number;
  distanceM: number;
  facingMe: boolean;
  /** Normalised 0..1 damage this hostile has done to me in the last 10 s. */
  damageDealtToMe: number;
  hurt: boolean;
  tired: boolean;
  facingAway: boolean;
  engagedByOther: boolean;
}

/** Anything that can hand out uniform draws. Narrow on purpose. */
export type DrawSource = Pick<RNG, 'next'>;
