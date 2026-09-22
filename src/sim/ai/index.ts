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
 * The other half of chapter 07 (§2.5 plan generation, §2.7 multi-opponent)
 * registers itself through `planview.ts` rather than being imported here.
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
