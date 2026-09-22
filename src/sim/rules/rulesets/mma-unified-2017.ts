/**
 * `mma.unified.2017` — the pre-November-2024 Unified Rules.
 *
 * Kept as a first-class ruleset because it is the version almost everyone means
 * when they say "the unified rules", and because it is the only way to ask what
 * the 2024 changes actually did:
 *
 *   - the 12-6 elbow is foul #10 again;
 *   - "grounded" means both palms or fists down (one hand does NOT ground you,
 *     which is why fighters spent 2017-2024 tapping a hand to the mat and
 *     hoping the referee agreed with them);
 *   - judges score under `legacy_2016`, which weights control more heavily and
 *     hands out fewer 10-8s.
 *
 * [S: RULES §7 item 5]
 */
import type { Ruleset } from '../types';
import { MMA_UNIFIED_3R } from './mma-unified-3r';

export const MMA_UNIFIED_2017: Ruleset = {
  ...MMA_UNIFIED_3R,
  id: 'mma.unified.2017',
  groundedDef: 'unified_2017',
  elbows12to6: 'foul',
  scoring: { ...MMA_UNIFIED_3R.scoring, culture: 'legacy_2016' },
};
