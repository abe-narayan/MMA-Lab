/**
 * AI — barrel for design chapter 07 (docs/design/07_STRATEGY_AND_AI.md).
 *
 *   contracts.ts  the shared vocabulary: action families, mode/policy ids, the
 *                 shapes the plan generator and the multi-opponent manager use
 *   families.ts   how the decision core partitions those families
 *   planview.ts   what the action layer reads from a plan, and the hooks the
 *                 plan generator and the targeting manager register through
 *   utility.ts    §2.2 the IAUS score, the nineteen considerations, the softmax
 *   actions.ts    §2.2 the legal candidate set, with the catalogue priors
 *   macros.ts     §2.2.5 committed sequences and the combination caps
 *   execution.ts  §2.3 telegraph, timing, target error and the novice tells
 *   perceive.ts   §2.4 cues, the 72-context opponent model, the 30 s ledger,
 *                 the read / counter-on-read / feint-bite curves
 *   adapt.ts      §2.6 the sixteen adjustments, cadence, score awareness, the
 *                 hurt and finisher blocks, the corner
 *   policy.ts     `MmaPolicy` — all of the above wired to the tick loop under
 *                 the fixed-draw contract
 *
 *   plan.ts / scout.ts / plans/  §2.5 the pre-fight game-plan generator
 *   multi.ts                     §2.7 threat assessment and targeting
 *   bindings.ts   registers those two with `planview.ts`, so importing this
 *                 barrel gives a policy that actually plans
 *
 * The two halves are coupled only through `planview.ts`: the decision core
 * never imports `plan.ts` or `multi.ts` directly, so it compiles, tests and
 * runs without them (as the T0 fighter of §2.5.8 does).
 */
export * from './contracts';
export * from './families';
export * from './planview';
export * from './utility';
export * from './actions';
export * from './macros';
export * from './execution';
export * from './perceive';
export * from './adapt';
export * from './policy';
export * from './scout';
export * from './plan';
export * from './multi';
// Last: registers the plan generator with `planview.ts` (side effect on load).
export * from './bindings';
