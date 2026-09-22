/**
 * `street` — no referee, no rounds, no weight classes, no rules.
 *
 * The research design note is binding and is the reason this mode exists at all
 * [S: RULES §2.8; FD §6]: no glamorisation, fleeing counts as a win, and
 * attacks on an incapacitated person are never rewarded for the player. The
 * fight ends on incapacitation, flight, surrender, separation by bystanders,
 * a weapon appearing, or the arrival of authority — never on a score. Median
 * time to the first of those is 20-40 s, which is the point: a real street
 * fight is over before a sanctioned first round would be half done.
 *
 * `Arena.surfaceHardness` (concrete 3.0) is what actually does the damage here
 * — the secondary head impact on the ground, not the punch.  [S: FD §6.3]
 */
import type { Ruleset } from '../types';
import { STREET_SUBMISSIONS, STREET_TAKEDOWNS, ncNever } from './common';

export const STREET: Ruleset = {
  id: 'street',
  family: 'street',
  rounds: {
    count: 1,
    // No clock. `MatchSettings.maxSeconds` (default 180 s) is the only cap and
    // expiry is recorded as 'separation', never as a decision.
    lengthS: 0,
    breakS: 0,
    extra: null,
    goldenScore: false,
    noPositivePointsBeforeS: 0,
    clockStopsOnCount: false,
  },
  weightClasses: [],
  catchWeightMaxGapLb: null,
  gloves: { oz: 0, fingerless: true, bareKnuckle: true },
  // Empty matrix; `isLegal` short-circuits on family === 'street' in any case.
  legal: {},
  groundedDef: 'none',
  elbows12to6: 'legal',
  clinch: {
    allowed: true, maxS: null, activityRule: 'none', kneesAllowed: true,
    elbowsAllowed: true, dirtyBoxingAllowed: true, catchKickStepLimit: null,
  },
  takedowns: { allowed: true, legal: STREET_TAKEDOWNS, slamOnlyFromSubmission: false },
  submissions: { allowed: true, legal: STREET_SUBMISSIONS, standingLocksAllowed: true },
  ground: { fightingAllowed: true, strikesAllowed: true, standupPolicy: 'none' },
  winConditions: ['incapacitation', 'flight', 'surrender', 'separation', 'weapon'],
  scoring: {
    system: 'none',
    culture: 'none',
    judges: 0,
    openScoring: 'hidden',
    ncThresholdRounds: ncNever,
    drawsAllowed: true,
    championRetainsOnDraw: false,
  },
  knockdown: {
    counts: false, mandatoryCount: 8, koCount: 10, standingEight: false,
    threeKdRound: null, fourKdBout: null, outOfRingCountS: 20, savedByBell: false,
  },
  fouls: [],
  stoppage: {
    refereeStops: false, doctor: false, cornerTowel: 'none', outmatchedTko: false,
  },
  referee: { present: false, strictness: 'standard', crowdPresent: false },
  // 1vN up to five a side, matching the existing 1v5 corpus.    [S: AUDIT §1]
  multiOpponent: { allowed: true, maxPerSide: 5, replacement: 'none' },
  street: { surface: 'concrete', bystanders: 0, weaponHazardPerS: 0.001 },
};
