/**
 * THE REFEREE'S BODY — presentation only (the sim has no referee body).
 *
 * `arena/referee.ts` decides where the referee stands and what he is doing
 * (`VenueSet.referee` after each `ArenaSet.update`); this module gives him a
 * body and a pose:
 *
 *   - body: the stage's capsule `DebugSkeletonActor` in the `official` outfit
 *     (black shirt, trousers and shoes, bare forearms, thin dark gloves) on a
 *     1.80 m default skeleton. The character module builds fighters only
 *     (shorts and fight gloves, no shirt or trousers), so a real skinned
 *     official has to wait for it to grow a clothing layer; `createRefereeActor`
 *     is the one place to swap that in.
 *   - pose: `RefereeAnimator` (stance/crouch, a gait driven by the distance he
 *     travels, arm IK for his gestures).
 *
 * Placement comes from the arena set when it provides one (so his contact
 * shadow on the canvas, which the set draws from the same placement, sits
 * under his feet); a set without a `referee` field (the placeholder arena)
 * gets the same `RefereeTracker` run here. `null` from the set means "no
 * referee" (street fights) and hides him.
 */
import type { ArenaSet, BoutPresentation, FrameInput } from '../contract';
import { RefereeTracker, type RefereePlacement } from '../arena/referee';
import { DebugSkeletonActor } from '../placeholders/debugSkeleton';
import { defaultRest, type RestSkeleton, type WorldPose } from '../rig/skeleton';
import { RefereeAnimator } from './pose';

export { RefereeAnimator, STRIDE_M } from './pose';
export type { RefereeFrame } from './pose';

/** A neutral official: 1.80 m, black shirt and trousers. */
export const REFEREE_STATURE_M = 1.8;
export const REFEREE_CLOTHING = '#0d0e10';

export function refereeRest(statureM = REFEREE_STATURE_M): RestSkeleton {
  const base = defaultRest();
  const k = statureM / base.statureM;
  for (let j = 0; j < base.head.length; j++) { base.head[j] *= k; base.tail[j] *= k; }
  for (let j = 0; j < base.length.length; j++) base.length[j] *= k;
  base.statureM *= k;
  return base;
}

/**
 * The set's referee placement: a placement, `null` for "this venue has no
 * referee", or `undefined` when the set does not compute one at all.
 */
export function arenaReferee(arena: ArenaSet): RefereePlacement | null | undefined {
  if (!('referee' in arena)) return undefined;
  return (arena as unknown as { referee: RefereePlacement | null }).referee;
}

export class RefereeActor {
  readonly body: DebugSkeletonActor;
  readonly animator: RefereeAnimator;
  /** The placement used on the last update (null when he is not shown). */
  placement: RefereePlacement | null = null;
  private readonly tracker: RefereeTracker;

  constructor(bout: BoutPresentation, hardCameraAngle = 0) {
    const rest = refereeRest();
    this.body = new DebugSkeletonActor(-1, { rest, corner: REFEREE_CLOTHING, glove: 'bare', outfit: 'official' });
    this.body.object3d.name = 'referee';
    this.animator = new RefereeAnimator(rest);
    this.tracker = new RefereeTracker(bout.arena, undefined, hardCameraAngle);
  }

  get object3d(): DebugSkeletonActor['object3d'] {
    return this.body.object3d;
  }

  update(input: FrameInput, arena: ArenaSet, fighters: readonly WorldPose[], realDt: number): RefereePlacement | null {
    const rate = Math.max(0, input.playbackRate);
    const simDt = input.discontinuity ? 0 : Math.max(0, realDt) * rate;
    let place = arenaReferee(arena);
    if (place === undefined) {
      // TickSnapshot satisfies the tracker's RefereeScene (it reads, never writes).
      const t = this.tracker.update(input.frame, input.simTime, simDt, input.discontinuity);
      place = t.present ? t : null;
    }
    this.placement = place && place.present ? place : null;
    this.body.setVisible(this.placement !== null);
    if (!this.placement) return null;
    const pose = this.animator.evaluate({
      placement: this.placement, fighters, realDt, simDt, snap: input.discontinuity,
    });
    this.body.applyPose(pose);
    return this.placement;
  }

  reset(): void {
    this.animator.reset();
  }

  dispose(): void {
    this.body.dispose();
  }
}

export function createRefereeActor(bout: BoutPresentation, hardCameraAngle = 0): RefereeActor {
  return new RefereeActor(bout, hardCameraAngle);
}
