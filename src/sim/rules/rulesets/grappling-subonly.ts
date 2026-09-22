/**
 * `grappling.subonly` — submission-only, no points, draw at time.
 *
 * The slam ban and the ADCC-style legal list are design choices, not research
 * [S: RULES §7 item 3 / BJJ §9.3]. EBI overtime is opt-in: set `rounds.extra`
 * to a non-null value and the referee runs alternating starts from the back
 * with hooks or the armbar "spiderweb", with cumulative escape time as the
 * tiebreaker.
 */
import type { Ruleset } from '../types';
import { GRAPPLING_ADCC } from './grappling-adcc';
import { ADCC_SUBMISSIONS, GRAPPLING_TAKEDOWNS, SUBONLY_FOULS } from './common';

export const GRAPPLING_SUBONLY: Ruleset = {
  ...GRAPPLING_ADCC,
  id: 'grappling.subonly',
  rounds: {
    count: 1,
    lengthS: 600,
    breakS: 0,
    extra: null,                   // set to enable EBI overtime
    goldenScore: false,
    noPositivePointsBeforeS: 0,
    clockStopsOnCount: false,
  },
  takedowns: {
    allowed: true,
    legal: GRAPPLING_TAKEDOWNS.filter((t) => t !== 'slam'),
    slamOnlyFromSubmission: false,
  },
  submissions: { allowed: true, legal: ADCC_SUBMISSIONS, standingLocksAllowed: true },
  ground: { fightingAllowed: true, strikesAllowed: false, standupPolicy: 'none' },
  winConditions: ['submission', 'technical_submission', 'dq'],
  scoring: {
    ...GRAPPLING_ADCC.scoring,
    system: 'none',
    judges: 0,
    drawsAllowed: true,
  },
  fouls: SUBONLY_FOULS,
};
