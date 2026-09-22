/**
 * `mma.amateur` — an IMMAF-style amateur construct.
 *
 * ENTIRELY [E]. No research file in `research/` covers amateur MMA, so every
 * number here is a design assumption listed in docs/design/06 §6 item 1:
 * shorter rounds, bigger gloves and shin guards, no elbows or knees to the
 * head, ground strikes to the head with punches only, no heel hooks or
 * twisting knee locks. Verify against IMMAF / state amateur rules before
 * quoting any amateur statistic from it. Its calibration target is FD #97
 * (amateur bouts finish about 60 % of the time).
 */
import type { Ruleset } from '../types';
import { MMA_UNIFIED_3R } from './mma-unified-3r';
import { MMA_AMATEUR_LEGAL, MMA_AMATEUR_SUBMISSIONS } from './common';

export const MMA_AMATEUR: Ruleset = {
  ...MMA_UNIFIED_3R,
  id: 'mma.amateur',
  rounds: { ...MMA_UNIFIED_3R.rounds, count: 3, lengthS: 180 },
  // 6 oz gloves plus shin guards; the extra padding is chapter 05's input, the
  // ruleset only records the size.
  gloves: { oz: 6, fingerless: true, bareKnuckle: false },
  legal: MMA_AMATEUR_LEGAL,
  // No 12-6 elbow because there are no elbows to the head at all.
  elbows12to6: 'foul',
  clinch: { ...MMA_UNIFIED_3R.clinch, elbowsAllowed: false },
  submissions: {
    allowed: true, legal: MMA_AMATEUR_SUBMISSIONS, standingLocksAllowed: false,
  },
  referee: { present: true, strictness: 'strict', crowdPresent: true },
};
