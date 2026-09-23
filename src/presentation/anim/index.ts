/**
 * Animation module entry point (docs/design/08 §5). Owned by the standing
 * animation work; grappling poses plug in through `grappleApi.ts`.
 * Returns null until implemented; the presenter then uses a static guard pose.
 */
import type { Animator } from '../contract';

export function createAnimator(): Animator | null {
  return null;
}
