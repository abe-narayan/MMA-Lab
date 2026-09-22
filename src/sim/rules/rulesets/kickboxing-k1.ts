/**
 * `kickboxing.k1` — K-1 rules.
 *
 * Judged with the GLORY culture, but the safety furniture differs: no standing
 * eight count, three knockdowns in a round or four in a bout (two in a
 * tournament), and a single extra round on a draw. Both of those details are
 * marked [UNVERIFIED] in the research, so they are here as switchable defaults
 * rather than as facts.                     [S: RULES §2.4 (unverified); MTKB §9]
 */
import type { Ruleset } from '../types';
import { KICKBOXING_GLORY } from './kickboxing-glory';

export const KICKBOXING_K1: Ruleset = {
  ...KICKBOXING_GLORY,
  id: 'kickboxing.k1',
  rounds: {
    ...KICKBOXING_GLORY.rounds,
    extra: { max: 1, lengthS: 180, breakS: 60, trigger: 'draw' },
  },
  gloves: { oz: 10, fingerless: false, bareKnuckle: false },
  knockdown: { ...KICKBOXING_GLORY.knockdown, standingEight: false },
  scoring: { ...KICKBOXING_GLORY.scoring, championRetainsOnDraw: false },
};
