/**
 * Animation module entry point (docs/design/08 §5). Owned by the standing
 * animation work; grappling poses plug in through `grappleApi.ts` (the solver
 * registers itself when `anim/grapple/` is imported by the presenter).
 */
import type { Animator } from '../contract';
import { StandingAnimator, type AnimatorOptions } from './animator';
import './grapple'; // side effect: registers the paired-pose GrappleSolver (integration)

export function createAnimator(opts?: AnimatorOptions): Animator {
  return new StandingAnimator(opts);
}

export { StandingAnimator, displaySeparation } from './animator';
export type { AnimatorOptions } from './animator';
export { registerClipLibrary } from './clips';
export type { ClipLibrary, MotionClip, ClipQuery } from './clips';
