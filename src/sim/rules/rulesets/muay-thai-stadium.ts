/**
 * `muay_thai.stadium` — Lumpinee/Rajadamnern-style scoring.
 *
 * Both distinguishing features are marked [UNVERIFIED] in the research and are
 * provided as a switchable culture rather than as fact [S: RULES §2.5]:
 * two-minute breaks, and a whole-fight impression in which rounds 1-2 are
 * treated as feeling-out (weights 0.5 / 0.75), rounds 3-4 decide the fight
 * (1.25 each) and round 5 is discounted (0.75) because a leading fighter
 * coasts through it by convention. Per-round cards are still emitted for the
 * HUD; the decision uses the impression.                        [S: RULES §4.4]
 */
import type { Ruleset } from '../types';
import { MUAY_THAI_ABC } from './muay-thai-abc';

export const MUAY_THAI_STADIUM: Ruleset = {
  ...MUAY_THAI_ABC,
  id: 'muay_thai.stadium',
  rounds: { ...MUAY_THAI_ABC.rounds, count: 5, breakS: 120 },
  scoring: { ...MUAY_THAI_ABC.scoring, culture: 'thai_stadium' },
};
