/**
 * `mma.unified.5r` — the same rules over the championship distance.
 *
 * Only the round count changes, but it changes the fight: the NC threshold
 * moves to 3 of 5 and the judge model's lead bias needs 3-0 or 3-1 rather than
 * 2-0. [S: RULES §2.2]
 */
import type { Ruleset } from '../types';
import { MMA_UNIFIED_3R } from './mma-unified-3r';

export const MMA_UNIFIED_5R: Ruleset = {
  ...MMA_UNIFIED_3R,
  id: 'mma.unified.5r',
  rounds: { ...MMA_UNIFIED_3R.rounds, count: 5 },
};
