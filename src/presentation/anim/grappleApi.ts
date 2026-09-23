/**
 * GRAPPLING HAND-OFF — the seam between the standing animator and paired poses.
 *
 * The standing animator (`anim/`) owns every fighter every frame. When a
 * fighter is in an engagement (clinch, takedown in flight, throw, ground,
 * scramble), their pose depends on their partner's: a mount only reads as a
 * mount if both bodies agree about where the hips are. So for engaged pairs the
 * standing animator calls a `GrappleSolver`, which poses BOTH fighters at once
 * around the engagement's interaction root, and then layers hit reactions,
 * fatigue and face channels on top as it does for everyone else.
 *
 * The solver lives in `anim/grapple/` and is registered here, so neither side
 * imports the other's internals.
 */
import type { EngagementSnapshot, FighterSnapshot } from '../../sim';
import type { BoutPresentation, FrameInput } from '../contract';
import type { Pose, RestSkeleton, WorldPose } from '../rig/skeleton';

export interface GrappleContext {
  bout: BoutPresentation;
  input: FrameInput;
  /** The engagement as recorded this frame (node, roles, cage, in-flight edge, root). */
  engagement: EngagementSnapshot;
  /** Next frame's record of the same pair, when it exists, for interpolation. */
  nextEngagement: EngagementSnapshot | null;
  /** Fighter `a` controls / is on top / attacks; `b` is the other (09 §1.6 I2). */
  a: FighterSnapshot;
  b: FighterSnapshot;
  restA: RestSkeleton;
  restB: RestSkeleton;
}

export interface GrappleResult {
  /** False when the solver has no pose for this node; the caller falls back. */
  handled: boolean;
  /** Debug label, e.g. "pos.ground_mount / tech.upa_escape 0.42". */
  label: string;
}

export interface GrappleSolver {
  /**
   * Pose both fighters of one engagement. `outA`/`outB` arrive holding the
   * standing animator's pose (so the solver may keep what it does not need to
   * change); `worldA`/`worldB` are scratch buffers the solver may use for FK.
   */
  evaluate(
    ctx: GrappleContext, outA: Pose, outB: Pose, worldA: WorldPose, worldB: WorldPose,
  ): GrappleResult;
  /** Drop transition state on seek. */
  reset(): void;
}

let registered: GrappleSolver | null = null;

/** Called once by `anim/grapple/index.ts` at module load. */
export function registerGrappleSolver(solver: GrappleSolver): void {
  registered = solver;
}

export function grappleSolver(): GrappleSolver | null {
  return registered;
}
