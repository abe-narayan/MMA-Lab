/**
 * Default values for this chapter's parameters.
 *
 * The canonical registry is `src/sim/params` — that is where ids are checked
 * for uniqueness across chapters, where overrides are applied and where the
 * replay hash comes from. This module reads `RULES_PARAMS` directly instead,
 * for two reasons:
 *
 *  1. the referee and the judges need *defaults* at module load, before a bout
 *     exists and before anything has been resolved;
 *  2. chapter 06 then compiles and tests on its own, without waiting for every
 *     other chapter's `*.params.ts` to be complete and valid.
 *
 * A bout that wants calibrated overrides resolves them through `resolveParams`
 * and passes the numbers in explicitly; nothing here caches a resolved value.
 */
import { RULES_PARAMS } from '../params/rules.params';

const DEFAULTS: ReadonlyMap<string, number> = new Map(
  RULES_PARAMS.map((s) => [s.id, s.value]),
);

/** Default value of a chapter-06 parameter. Throws on an unknown id. */
export function param(id: string): number {
  const v = DEFAULTS.get(id);
  if (v === undefined) throw new Error(`Unknown rules parameter: ${id}`);
  return v;
}

export { RULES_PARAMS };
