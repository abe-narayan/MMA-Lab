/**
 * The frozen parameter registry.
 *
 * Each design chapter contributes one `*.params.ts` file; this module merges
 * them, freezes the result (which sorts ids, so the dense index does not depend
 * on module evaluation order) and exposes the default hash that every replay
 * file carries.
 *
 * Adding a parameter anywhere changes DEFAULT_PARAMS_HASH, so a replay recorded
 * under one parameter set can never be silently replayed under another — the
 * same guarantee the v3 engine had, now with provenance attached.
 */
import { ParamRegistry, type ParamOverrides, type ResolvedParams } from './registry';
import { CORE_PARAMS } from './core.params';
import { FIGHTER_PARAMS } from './fighter.params';
import { STRIKING_PARAMS } from './striking.params';
import { GRAPPLING_PARAMS } from './grappling.params';
import { SUBMISSION_PARAMS } from './submissions.params';
import { DAMAGE_PARAMS } from './damage.params';
import { RULES_PARAMS } from './rules.params';
import { AI_PARAMS } from './ai.params';
import { MULTI_PARAMS } from './multi.params';

export type { ParamSpec, ParamId, ParamOverrides, ResolvedParams, ParamSection } from './registry';
export { ParamRegistry } from './registry';

export const PARAMS = new ParamRegistry();
PARAMS.addAll(CORE_PARAMS);
PARAMS.addAll(FIGHTER_PARAMS);
PARAMS.addAll(STRIKING_PARAMS);
PARAMS.addAll(GRAPPLING_PARAMS);
PARAMS.addAll(SUBMISSION_PARAMS);
PARAMS.addAll(DAMAGE_PARAMS);
PARAMS.addAll(RULES_PARAMS);
PARAMS.addAll(AI_PARAMS);
PARAMS.addAll(MULTI_PARAMS);
PARAMS.freeze();

export const DEFAULT_PARAMS_HASH: string = PARAMS.hash();

/** Resolve defaults plus overrides into the dense array the engine reads. */
export function resolveParams(overrides?: ParamOverrides): ResolvedParams {
  return PARAMS.resolve(overrides);
}

/** Hash of a parameter set, stored in every replay file. */
export function hashParams(overrides?: ParamOverrides): string {
  return PARAMS.hash(overrides);
}
