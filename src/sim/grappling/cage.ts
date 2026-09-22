/**
 * THE CAGE — contact detection, per-edge effects, the wall-walk cycle and the
 * cage-pin nodes.
 *
 * Chapter 03 §4. The fence is not scenery: it is the single biggest positional
 * modifier in MMA grappling, and it cuts both ways. It adds +0.42 to +0.63 to a
 * shot's capture, and it takes −1.05 off running the pipe. It makes trips,
 * lifts and reaps better and forward hip throws worse. It gives the bottom
 * fighter the wall walk and takes away the hip escape.
 *
 * Everything here is data plus small pure functions; `resolve.ts` applies the
 * modifiers as part of the ordinary logit sum, and the wall-walk cycle is
 * expressed as stage tables so the core loop can step it without re-deriving
 * the probabilities.
 */
import type { PositionId } from '../core/ids';
import type { ResolvedParams } from '../params';
import type { RNG } from '../rng';
import { distanceToWall, type Arena } from '../rules/arenas/types';
import { CAGE_VARIANT_NODE, positionNode, type EdgeId } from './graph';

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

/**
 * §4: the fence is reachable within `grap.cageReachM` = 1.0 m, and the
 * engagement's `cage` flag is set from the *defender's* or *bottom's* distance
 * — being able to reach the fence only matters when it is behind you.
 */
export function isCageContact(arena: Arena, x: number, z: number, params: ResolvedParams): boolean {
  if (arena.wall === 'none') return false;
  return distanceToWall(arena, x, z) <= params.get('grap.cageReachM');
}

/** Ring rulesets set `fenceAvailable = false`: no wall walk, more sweeps (§9.3.15). */
export function fenceAvailable(arena: Arena): boolean {
  return arena.wall === 'fence' || arena.wall === 'ropes';
}

/**
 * Arena apothem, used for the cage-size scaling of the TELE term. Circles and
 * polygons carry it directly; a square ring uses its half-width.
 */
export function arenaRadiusM(arena: Arena, params: ResolvedParams): number {
  if (arena.shape === 'unbounded') return Infinity;
  const r = arena.apothemM ?? arena.halfWidthM;
  return r && r > 0 ? r : params.get('grap.cageReferenceRadiusM');
}

// ---------------------------------------------------------------------------
// Cage nodes
// ---------------------------------------------------------------------------

/** Nodes that only exist against the fence (`cage` column "is the cage node"). */
export const CAGE_ONLY_NODES: readonly PositionId[] = [
  'pos.standing_cage',
  'pos.clinch_cage_pin_front',
  'pos.clinch_cage_pin_rear',
  'pos.ground_cage_seated',
  'pos.ground_wall_walk',
];

/** The two standing cage pins; both accrue `pinClock` and cost the pinned fighter energy. */
export const CAGE_PIN_NODES: readonly PositionId[] = [
  'pos.clinch_cage_pin_front',
  'pos.clinch_cage_pin_rear',
];

export function isCageOnlyNode(node: PositionId): boolean {
  return CAGE_ONLY_NODES.includes(node);
}

/** The node a pairing moves to when the fence is reached, if the graph names one. */
export function cageVariantOf(node: PositionId): PositionId | null {
  return CAGE_VARIANT_NODE.get(node) ?? null;
}

/**
 * §2.2.6: `pos.ground_side` with `cage = true` is BJJ's `SIDE_CONTROL_WALL` —
 * ctrl 8 and esc 7 rather than 7 and 6. `pos.ground_turtle` likewise becomes
 * `TURTLE_WALL` (ctrl 5, esc 4: hooks are harder, the stand-up is easier).
 */
export function cageAdjustedRatings(
  node: PositionId, cage: boolean,
): { controlRating: number; escapeDifficulty: number } {
  const n = positionNode(node);
  if (!cage) return { controlRating: n.controlRating, escapeDifficulty: n.escapeDifficulty };
  if (node === 'pos.ground_side') return { controlRating: 8, escapeDifficulty: 7 };
  if (node === 'pos.ground_turtle') return { controlRating: 5, escapeDifficulty: 4 };
  return { controlRating: n.controlRating, escapeDifficulty: n.escapeDifficulty };
}

// ---------------------------------------------------------------------------
// §4.1 Per-edge cage effects
// ---------------------------------------------------------------------------

export interface CageEffect {
  /** Additive logit while `cage = true`. */
  logit?: number;
  /** Multiplicative on P, applied after the sigmoid. */
  mult?: number;
  /** Multiplies the edge's duration. */
  durMult?: number;
  tag: string;
}

/**
 * §4.1's table, keyed by edge id. The catalogue already carries the per-edge
 * `CAGE` state modifier, so this map is the *authority* the sweep script checks
 * the catalogue against, and the place chapter 07 reads when it wants to know
 * whether driving to the fence is worth it. Where both exist they agree.
 */
export const CAGE_EFFECTS: ReadonlyMap<EdgeId, CageEffect> = new Map<EdgeId, CageEffect>([
  // Capture chance on the shots: +10 to +15 pp.
  ['tech.double_leg', { logit: 0.63, tag: '[S: WRESTLING §5.2, §9 r7]' }],
  ['tech.single_leg', { logit: 0.42, tag: '[S: WRESTLING §5.2, §9 r7]' }],
  ['tech.single_outside', { logit: 0.42, tag: '[S: WRESTLING §5.2, §9 r7]' }],
  ['tech.high_crotch', { logit: 0.42, tag: '[S: WRESTLING §5.2, §9 r7]' }],
  // Running the pipe needs room to circle, and the fence takes it away.
  ['tech.single_run_pipe', { logit: -1.05, durMult: 1.5, tag: '[S: WRESTLING §5.2]' }],
  // Trips, knee-behind-knee returns and lifts.
  ['tech.single_trip', { logit: 0.42, tag: '[S: WRESTLING §5.2]' }],
  ['tech.single_dump', { logit: 0.42, tag: '[S: WRESTLING §5.2]' }],
  ['tech.inside_trip', { logit: 0.42, tag: '[S: WRESTLING §5.2]' }],
  ['tech.outside_trip', { logit: 0.42, tag: '[S: WRESTLING §5.2]' }],
  ['tech.body_lock_lift_return', { logit: 0.42, mult: 1.25, tag: '[S: WRESTLING §5.2] [S: JUDO §8 r13]' }],
  ['tech.rear_mat_return', { logit: 0.42, tag: '[S: WRESTLING §5.2]' }],
  ['tech.knee_tap_double', { logit: 0.42, mult: 1.5, tag: '[S: JUDO §8 r13]' }],
  ['tech.ouchi_gari', { logit: 0.41, mult: 1.5, tag: '[S: JUDO §8 r13]' }],
  ['tech.kouchi_gari', { logit: 0.41, mult: 1.5, tag: '[S: JUDO §8 r13]' }],
  // Forward hip throws: x0.7 P.
  ['tech.uchi_mata', { logit: -0.36, mult: 0.7, tag: '[S: JUDO §8 r13]' }],
  ['tech.harai_goshi', { logit: -0.36, mult: 0.7, tag: '[S: JUDO §8 r13]' }],
  ['tech.koshi_guruma', { logit: -0.36, mult: 0.7, tag: '[S: JUDO §8 r13]' }],
  ['tech.o_goshi', { logit: -0.36, mult: 0.7, tag: '[S: JUDO §8 r13]' }],
  ['tech.hane_goshi', { logit: -0.36, mult: 0.7, tag: '[S: JUDO §8 r13]' }],
  ['tech.tai_otoshi', { logit: -0.36, mult: 0.7, tag: '[S: JUDO §8 r13]' }],
  ['tech.ippon_seoi', { logit: -0.36, mult: 0.7, tag: '[S: JUDO §8 r13]' }],
  ['tech.morote_seoi', { logit: -0.36, mult: 0.7, tag: '[S: JUDO §8 r13]' }],
  // Ura nage / te guruma / rear lifts: x1.25 P.
  ['tech.ura_nage', { logit: 0.22, mult: 1.25, tag: '[S: JUDO §8 r13]' }],
  ['tech.te_guruma', { logit: 0.22, mult: 1.25, tag: '[S: JUDO §8 r13]' }],
  ['tech.rear_lift_suplex', { logit: 0.22, mult: 1.25, tag: '[S: JUDO §8 r13]' }],
  // The defender's sprawl has no room.
  ['def.sprawl', { logit: -0.42, tag: '[S: WRESTLING §5.2]' }],
  ['tech.double_turn_corner', { logit: -0.42, tag: '[E]' }],
  ['tech.single_low', { logit: -0.42, tag: '[S: WRESTLING §3.2] (needs open mat)' }],
  // Cage-assisted passing and pinning: "+" 0.35, "++" 0.70.
  ['tech.pass_knee_cut', { logit: 0.35, tag: '[S: BJJ_POSITIONS §3.3, §5.3]' }],
  ['tech.pass_over_under', { logit: 0.35, tag: '[S: BJJ_POSITIONS §3.3, §5.3]' }],
  ['tech.pass_smash_half', { logit: 0.35, tag: '[S: BJJ_POSITIONS §3.3, §5.3]' }],
  ['tech.pass_hq', { logit: 0.35, tag: '[S: BJJ_POSITIONS §3.3, §5.3]' }],
  ['tech.side_to_mount', { logit: 0.35, tag: '[S: BJJ_POSITIONS §3.3, §5.3]' }],
  ['tech.cage_assisted_pass', { logit: 0.70, tag: '[S: BJJ_POSITIONS §3.2 P10]' }],
  // Wall walk and the stand-up family: +0.35 to +0.70 for the bottom.
  ['tech.escape_side_underhook_turn', { logit: 0.70, tag: '[S: BJJ_POSITIONS §3.3]' }],
  ['tech.turtle_sit_out_peek', { logit: 0.70, tag: '[S: BJJ_POSITIONS §3.3]' }],
  ['tech.stand_from_turtle', { logit: 0.70, tag: '[S: BJJ_POSITIONS §3.3]' }],
  ['tech.stand_after_back_escape', { logit: 0.70, tag: '[S: BJJ_POSITIONS §3.3]' }],
  ['tech.knee_shield_wrestle_up', { logit: 0.70, tag: '[S: BJJ_POSITIONS §3.3]' }],
  ['tech.wrestle_up', { logit: 0.35, tag: '[S: BJJ_POSITIONS §3.3]' }],
  ['tech.kimura_grip_standup', { logit: 0.35, tag: '[S: BJJ_POSITIONS §3.3]' }],
  ['tech.dogfight_entry', { logit: 0.35, tag: '[S: BJJ_POSITIONS §3.3]' }],
  ['tech.dogfight_resolve', { logit: 0.35, tag: '[S: BJJ_POSITIONS §3.3]' }],
  // The hip escape runs into the fence.
  ['tech.escape_side_frames_shrimp', { logit: -0.35, tag: '[S: BJJ_POSITIONS §3.2 E5]' }],
  // Entries and pins that only exist here.
  ['tech.cage_drive', { logit: 0, tag: '[S: WRESTLING §5.1] (cage is a requirement, not a bonus)' }],
  ['tech.hc_cage_drive_single', { logit: 0, tag: '[S: WRESTLING §3.4]' }],
  ['tech.cage_single_chain', { logit: 0.42, durMult: 1.5, tag: '[S: WRESTLING §5.2]' }],
]);

export function cageEffectFor(edge: EdgeId): CageEffect | null {
  return CAGE_EFFECTS.get(edge) ?? null;
}

/** §4.1: every `*_in` finish attempt takes 1.5x as long against the fence. */
export function cageFinishDuration(baseMs: number, cage: boolean, params: ResolvedParams): number {
  return cage ? baseMs * params.get('grap.cageFinishDurMult') : baseMs;
}

/** §4.1: the pinned fighter burns 1.3x energy per second; the pinner 1.0x. */
export function pinEnergyMultiplier(
  slot: 'a' | 'b', node: PositionId, params: ResolvedParams,
): number {
  if (!CAGE_PIN_NODES.includes(node)) return 1;
  return slot === 'b' ? params.get('grap.cagePinnedEnergyMult') : 1;
}

/** §4.3: hip-in halves the pinner's drive and lift finishes; trips are unaffected. */
export function hipInFinishMultiplier(
  edge: EdgeId, hipIn: boolean, params: ResolvedParams,
): number {
  if (!hipIn) return 1;
  const tripsUnaffected = new Set<EdgeId>([
    'tech.single_trip', 'tech.inside_trip', 'tech.outside_trip',
    'tech.knee_tap_double', 'tech.kouchi_gari', 'tech.ouchi_gari',
  ]);
  if (tripsUnaffected.has(edge)) return 1;
  return params.get('grap.cageHipInFinishMult');
}

// ---------------------------------------------------------------------------
// §4.2 The wall-walk cycle
// ---------------------------------------------------------------------------

export type WallWalkStage = 'stage1' | 'stage2';

export interface WallWalkBranch {
  node: PositionId;
  weight: number;
  /** The bottom fighter takes slot `a` of the destination. */
  swap?: boolean;
  label: string;
}

/**
 * Stage 1: from a cage-adjacent ground node, reach the feet. `reachFeetP` is
 * the roll; a failure is dragged back down.
 */
export const WALL_WALK_STAGE1_FAIL: readonly WallWalkBranch[] = [
  { node: 'pos.ground_cage_seated', weight: 0.60, label: 'dragged down to the fence' },
  { node: 'pos.ground_turtle', weight: 0.30, label: 'turned to turtle' },
  { node: 'pos.ground_back_hooks', weight: 0.10, label: 'gave up the back' },
];

/**
 * Stage 2: out of `pos.ground_wall_walk`. In UFC about 70 % of wall walks end
 * in a fence clinch rather than free space, which the 0.45 body-lock branch
 * produces `[D: 0.45/(0.45+0.35) = 0.56 of successes held, plus drag-downs]`.
 */
export const WALL_WALK_STAGE2: readonly WallWalkBranch[] = [
  { node: 'pos.standing_cage', weight: 0.35, swap: true, label: 'clean separation' },
  { node: 'pos.clinch_cage_pin_front', weight: 0.45, label: 'up but held on the fence' },
  { node: 'pos.ground_cage_seated', weight: 0.20, label: 'back to the ground' },
];

export interface WallWalkResult {
  stage: WallWalkStage;
  success: boolean;
  p: number;
  branch: WallWalkBranch;
  /** A fence grab was committed: chapter 06 issues a warning (§4.1). */
  fenceGrab: boolean;
  draws: number;
}

/**
 * Step one wall-walk cycle. Draw order mirrors a grappling edge's first three
 * draws — `contested`, `outcomeSplit`, `counterBranch` (here the fence-grab
 * foul) — and all three are always taken.
 *
 * `pLogitDelta` is whatever `resolve.ts` computed for the fighter's
 * `tech.wall_walk` edge: UHO, fatigue, mass, the top's answers. Passing it in
 * keeps the cycle a pure function of the probability rather than re-deriving it.
 */
export function resolveWallWalkCycle(
  stage: WallWalkStage, pSuccess: number, bottomTier: number,
  params: ResolvedParams, rng: RNG,
): WallWalkResult {
  const p = Math.min(params.get('grap.clampMax'), Math.max(params.get('grap.clampMin'), pSuccess));
  const uContested = rng.next();
  const uSplit = rng.next();
  const uGrab = rng.next();

  const success = uContested < p;
  const branches: readonly WallWalkBranch[] = stage === 'stage1'
    ? (success
      ? [{ node: 'pos.ground_wall_walk' as PositionId, weight: 1, label: 'feet reached the fence' }]
      : WALL_WALK_STAGE1_FAIL)
    : (success ? WALL_WALK_STAGE2 : WALL_WALK_STAGE1_FAIL);

  let total = 0;
  for (const b of branches) total += b.weight;
  let r = uSplit * total;
  let branch = branches[branches.length - 1];
  for (const b of branches) {
    if (r < b.weight) { branch = b; break; }
    r -= b.weight;
  }

  // 5 % of attempts at T <= 1 grab the fence: a foul plus -0.5 logit on the
  // attempt. The draw is taken for every tier so the stream does not move.
  const fenceGrab = bottomTier <= 1 && uGrab < params.get('grap.wallWalkFenceGrabP');

  return { stage, success, p, branch, fenceGrab, draws: 3 };
}

/**
 * §4.2 calibration check: with 5 s cycles and P(reach feet) = 0.60, how often
 * is the bottom fighter on their feet — held or free — within `seconds`?
 * WRESTLING §8.4's targets are 0.35 within 30 s on the cage, 0.55 within 60 s,
 * 0.75 within 120 s.
 */
export function wallWalkCumulative(seconds: number, params: ResolvedParams): number {
  const cycleS = params.get('grap.wallWalkCycleMs') / 1000;
  const cycles = Math.max(0, Math.floor(seconds / cycleS));
  const perCycle = params.get('grap.wallWalkReachFeetP')
    * (params.get('grap.wallWalkCleanP') + params.get('grap.wallWalkHeldP'));
  return 1 - Math.pow(1 - perCycle, cycles);
}

// ---------------------------------------------------------------------------
// §4.3 Hip-in defence, foot stomps and knees in the cage clinch
// ---------------------------------------------------------------------------

export interface CageClinchState {
  /** The pinned fighter has the back flat, hips forward, underhook and head post. */
  hipIn: boolean;
  /** Foot stomps landed in the last 2 s (each is +0.21 logit on the next trip). */
  recentFootStomps: number;
  /** The pinner's head is on the wrong side: +0.42 to the break. */
  pinnerHeadWrongSide: boolean;
}

/** §4.3: a foot stomp adds +0.21 logit `[D: +0.05 P]` to the next trip within 2 s. */
export const FOOT_STOMP_TRIP_BONUS = 0.21;

export function footStompBonus(state: CageClinchState): number {
  return state.recentFootStomps > 0 ? FOOT_STOMP_TRIP_BONUS : 0;
}

/** §4.1: breaking off the fence, per 5 s, plus the head-on-the-wrong-side bonus. */
export function cageBreakLogit(state: CageClinchState, params: ResolvedParams): number {
  return state.pinnerHeadWrongSide ? params.get('grap.cageBreakHeadWrongSideBonus') : 0;
}
