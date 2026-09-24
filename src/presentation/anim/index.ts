/**
 * Animation module entry point (docs/design/08 §5). Owned by the standing
 * animation work; grappling poses plug in through `grappleApi.ts` (the solver
 * registers itself when `anim/grapple/` is imported by the presenter).
 */
import type { Animator } from '../contract';
import { StandingAnimator, type AnimatorOptions } from './animator';
import { ensureMotionLibrary } from './clips';
import './grapple'; // side effect: registers the paired-pose GrappleSolver (integration)

export function createAnimator(opts?: AnimatorOptions): Animator {
  // Motion capture loads in the background; the animator is procedural until it
  // arrives and then crossfades onto the capture-driven layers.
  if (opts?.motion === undefined) void ensureMotionLibrary();
  return new StandingAnimator(opts);
}

export { StandingAnimator, displaySeparation } from './animator';
export type { AnimatorOptions } from './animator';
export { ensureMotionLibrary, registerMotionLibrary, registeredMotionLibrary } from './clips';
