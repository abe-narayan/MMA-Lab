/**
 * The ruleset registry. Fourteen instances, one file each; `RulesetId` in
 * `../types` is the closed set, and this record must cover it exactly — which
 * the type checker enforces, so a new sport cannot be half-added.
 */
import type { Ruleset, RulesetId } from '../types';
import { MMA_UNIFIED_3R } from './mma-unified-3r';
import { MMA_UNIFIED_5R } from './mma-unified-5r';
import { MMA_UNIFIED_2017 } from './mma-unified-2017';
import { MMA_AMATEUR } from './mma-amateur';
import { BOXING_PRO } from './boxing-pro';
import { KICKBOXING_GLORY } from './kickboxing-glory';
import { KICKBOXING_K1 } from './kickboxing-k1';
import { MUAY_THAI_ABC } from './muay-thai-abc';
import { MUAY_THAI_STADIUM } from './muay-thai-stadium';
import { GRAPPLING_IBJJF } from './grappling-ibjjf';
import { GRAPPLING_ADCC } from './grappling-adcc';
import { GRAPPLING_SUBONLY } from './grappling-subonly';
import { JUDO_IJF } from './judo-ijf';
import { STREET } from './street';

export const RULESETS: Record<RulesetId, Ruleset> = {
  'mma.unified.3r': MMA_UNIFIED_3R,
  'mma.unified.5r': MMA_UNIFIED_5R,
  'mma.unified.2017': MMA_UNIFIED_2017,
  'mma.amateur': MMA_AMATEUR,
  'boxing.pro': BOXING_PRO,
  'kickboxing.glory': KICKBOXING_GLORY,
  'kickboxing.k1': KICKBOXING_K1,
  'muay_thai.abc': MUAY_THAI_ABC,
  'muay_thai.stadium': MUAY_THAI_STADIUM,
  'grappling.ibjjf': GRAPPLING_IBJJF,
  'grappling.adcc': GRAPPLING_ADCC,
  'grappling.subonly': GRAPPLING_SUBONLY,
  'judo.ijf': JUDO_IJF,
  street: STREET,
};

export const RULESET_IDS = Object.keys(RULESETS) as RulesetId[];

/** Accept either an id or an already-built object, as `SimConfig.ruleset` does. */
export function resolveRuleset(r: RulesetId | Ruleset): Ruleset {
  if (typeof r !== 'string') return r;
  const rs = RULESETS[r];
  if (!rs) throw new Error(`Unknown ruleset id: ${r}`);
  return rs;
}

export {
  MMA_UNIFIED_3R, MMA_UNIFIED_5R, MMA_UNIFIED_2017, MMA_AMATEUR, BOXING_PRO,
  KICKBOXING_GLORY, KICKBOXING_K1, MUAY_THAI_ABC, MUAY_THAI_STADIUM,
  GRAPPLING_IBJJF, GRAPPLING_ADCC, GRAPPLING_SUBONLY, JUDO_IJF, STREET,
};
export * from './common';
