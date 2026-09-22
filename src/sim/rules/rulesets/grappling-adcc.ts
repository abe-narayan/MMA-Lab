/**
 * `grappling.adcc` — ADCC submission wrestling, qualifier distance.
 *
 * The rule that shapes every ADCC match: the first half of regulation has no
 * positive points. Only negatives are available, so a fighter who pulls guard,
 * puts a knee down for three seconds, backs up or refuses to engage goes to
 * -1 while nobody can go up. Warnings issued in the no-points half convert to
 * -1 when the scoring half begins. Slams are legal, but only as an escape from
 * inside a submission. [S: RULES §2.6]
 */
import type { Ruleset } from '../types';
import {
  ADCC_FOULS, ADCC_SUBMISSIONS, ADCC_WEIGHT_CLASSES, GRAPPLING_TAKEDOWNS,
  NO_STRIKING_LEGAL, ncNever,
} from './common';

export const GRAPPLING_ADCC: Ruleset = {
  id: 'grappling.adcc',
  family: 'grappling',
  rounds: {
    count: 1,
    lengthS: 600,                  // finals are 1200 with a 600 s no-points half
    breakS: 0,
    extra: { max: 1, lengthS: 300, breakS: 0, trigger: 'tie' },
    goldenScore: false,
    noPositivePointsBeforeS: 300,
    clockStopsOnCount: false,
  },
  weightClasses: ADCC_WEIGHT_CLASSES,
  catchWeightMaxGapLb: null,
  gloves: { oz: 0, fingerless: false, bareKnuckle: true },
  legal: NO_STRIKING_LEGAL,
  groundedDef: 'none',
  elbows12to6: 'foul',
  clinch: {
    allowed: true, maxS: null, activityRule: 'none', kneesAllowed: false,
    elbowsAllowed: false, dirtyBoxingAllowed: false, catchKickStepLimit: null,
  },
  takedowns: {
    allowed: true, legal: GRAPPLING_TAKEDOWNS, slamOnlyFromSubmission: true,
  },
  submissions: { allowed: true, legal: ADCC_SUBMISSIONS, standingLocksAllowed: true },
  ground: { fightingAllowed: true, strikesAllowed: false, standupPolicy: 'adcc_passivity' },
  winConditions: [
    'submission', 'technical_submission', 'points', 'referee_decision', 'dq',
  ],
  scoring: {
    system: 'points_adcc',
    culture: 'none',
    judges: 1,
    openScoring: 'always',
    ncThresholdRounds: ncNever,
    drawsAllowed: false,
    championRetainsOnDraw: false,
  },
  knockdown: {
    counts: false, mandatoryCount: 8, koCount: 10, standingEight: false,
    threeKdRound: null, fourKdBout: null, outOfRingCountS: 20, savedByBell: false,
  },
  fouls: ADCC_FOULS,
  stoppage: {
    refereeStops: true, doctor: true, cornerTowel: 'none', outmatchedTko: false,
  },
  referee: { present: true, strictness: 'standard', crowdPresent: true },
  multiOpponent: { allowed: false, maxPerSide: 1, replacement: 'none' },
};
