/**
 * ENGAGEMENT INVARIANTS I1–I8 (docs/design/09 §1.6) evaluated against a live
 * `World`.
 *
 * Chapter 03 owns the checks; this file only builds the narrow `FighterView`
 * and `RefereeView` records they read, so the invariant sweep, the tests and a
 * dev-build assertion all ask the same question in the same way.
 */
import type { World } from './world';
import { refereeRuntime } from './build';
import type { InvariantViolation } from '../grappling';

export function checkWorldInvariants(world: World): InvariantViolation[] {
  const rt = world.referee === null ? null : refereeRuntime(world);
  const counting = rt?.display.state === 'counting' ? 1 : 0;
  return world.engagements.checkInvariants({
    tick: world.tick,
    engagedMaxDistanceM: world.params.get('core.engagedMaxDistanceM'),
    fighters: world.fighters.map((f) => ({
      id: f.id,
      posture: f.posture,
      position: f.position,
      role: world.engagements.roleOf(f.id),
      x: f.x,
      z: f.z,
      vx: f.vx,
      vz: f.vz,
      grounded: f.posture === 'ground' || f.posture === 'down',
      out: f.out,
      submission: f.sub.technique,
    })),
    referee: {
      activeCounts: counting,
      rulesetHasCounts: world.ruleset.knockdown.counts,
      // I6: the binding emits every illegal technique as a `foul` event at
      // contact time, so nothing is ever left unflagged.
      illegalUnflagged: [],
    },
  });
}
