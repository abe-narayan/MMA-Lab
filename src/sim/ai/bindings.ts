/**
 * BINDINGS — the seam between the two halves of chapter 07.
 *
 * `planview.ts` declares what the decision core reads from a plan and from the
 * targeting manager, and leaves the implementations to register themselves.
 * This module performs that registration for the in-tree implementations:
 * `plan.ts` (§2.5, scouting and plan generation) and `multi.ts` (§2.7, threat
 * assessment and targeting).
 *
 * It is a separate file, and importing it is what turns the plan generator on,
 * so that:
 *   - `policy.ts` still compiles and tests without either module, which is the
 *     T0 case of §2.5.8 (no report, no plan, style weights only) rather than a
 *     broken build;
 *   - the draw budget stays declarable: `drawsPerFighter` reports `SCOUT_DRAWS`
 *     up front, so `MmaPolicy.prepare` keeps the pre-bout stream aligned even
 *     if a generator returns early for an untrained fighter.
 *
 * Importing `./index` performs the registration.
 */
import { SCOUT_DRAWS } from './scout';
import { scoutAndPlan } from './plan';
import {
  setPlanProvider, setMultiTargetProvider,
  type PlanProvider, type PlanView,
} from './planview';

/** §2.5.3, wired to `plan.ts`. */
export const GENERATED_PLAN_PROVIDER: PlanProvider = {
  // Scouting noise is drawn in field order regardless of tier, so the count is
  // a constant and a T0 fighter costs the stream the same as a champion.
  drawsPerFighter: () => SCOUT_DRAWS,

  generate(world, self, rng): PlanView | null {
    const opponents = world.opponentsOf(self);
    // With nobody to scout there is nothing to plan against; the draws are
    // still taken by the caller, which is what keeps the stream aligned.
    if (opponents.length === 0) return null;
    // Plan against the first opponent by id — in a team bout that is the
    // nominal matchup, and §2.7 re-targets live anyway.
    const opponent = opponents.reduce((a, b) => (a.id <= b.id ? a : b));
    return scoutAndPlan(
      self.runtime,
      opponent.runtime,
      world.ruleset,
      rng,
      world.ruleset.rounds.count,
    );
  },
};

/**
 * Register the in-tree implementations. Idempotent, and safe to call again with
 * a different pair (the tests use that to isolate the decision core).
 */
export function registerChapter07Providers(): void {
  setPlanProvider(GENERATED_PLAN_PROVIDER);
  // TODO(§2.7): `multi.ts` owns threat assessment and the `tgt.*` policies but
  // does not yet expose a `MultiTargetProvider`. Until it does, the decision
  // core falls back to `tgt.nearest`, which is the documented T0-T1 policy and
  // the current engine's behaviour — not a silent gap.
  setMultiTargetProvider(null);
}

registerChapter07Providers();
