/**
 * GRAPPLING — barrel.
 *
 * Design chapter: docs/design/03_GRAPPLING_STATE_GRAPH.md.
 *
 *  - `graph.ts`      the 74 node and 187 edge catalogues as data, the
 *                    complementary-node map I2 reads and chapter 04's alias map
 *  - `engagement.ts` the `Engagement` record, the `EngagementSet` matching and
 *                    invariants I1-I8 (09 §1.6)
 *  - `resolve.ts`    the logit sum, the two-stage leg attacks, the judo failure
 *                    table, chain grappling and scramble resolution, on the
 *                    fixed RNG draw order of 09 §2.7
 *  - `cage.ts`       fence contact, per-edge cage effects, the wall-walk cycle
 *  - `gnp.ts`        ground-and-pound rates, the posture trade-off and the
 *                    activity and stall counters chapters 06 and 09 read
 */
export * from './graph';
export * from './engagement';
export * from './resolve';
export * from './cage';
export * from './gnp';
export * from './takedowns';
export * from './subOffers';
