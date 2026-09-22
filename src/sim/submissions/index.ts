/**
 * SUBMISSIONS - design chapter 04.
 *
 * Owns everything from the moment a fighter commits to a submission until it
 * ends in a tap, unconsciousness, injury, escape, abandonment or the bell:
 * the four-stage battle (stages.ts), the 54-technique catalogue (catalogue.ts),
 * the locked clock and its injury/slam consequences (finish.ts), the chain
 * graph (chains.ts) and the ruleset legality matrix (legality.ts).
 *
 * It does not own positions (03), damage (05), the referee (06) or the decision
 * of when to attack (07) - this module exposes the model, those chapters drive
 * it.
 *
 * Importing this barrel registers the chapter's ids with the global tables.
 */
export * from './positions';
export * from './stages';
export * from './catalogue';
export * from './finish';
export * from './chains';
export * from './legality';

import { registerSubmissionPositionIds } from './positions';
import { registerDefenceIds } from './stages';
import { registerSubmissionIds } from './catalogue';

/**
 * Register `sub.*`, `def.*` and the chapter's `pos.*` references. Safe to call
 * more than once and safe to call before chapter 03 registers the same nodes -
 * `IdTable.add` is idempotent and the tables are only frozen once every
 * catalogue module has run (`freezeIdTables`).
 */
export function registerSubmissionModuleIds(): void {
  registerSubmissionIds();
  registerDefenceIds();
  registerSubmissionPositionIds();
}

registerSubmissionModuleIds();
