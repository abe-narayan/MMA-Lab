/**
 * `kickboxing.glory` — GLORY rules kickboxing.
 *
 * Three things make GLORY score differently from every other 10-point-must
 * sport:
 *  - minus points are subtracted *before* the round score, so a 10-9 winner
 *    carrying a -1 leaves the round 9-9;                        [S: RULES §2.4]
 *  - a drawn bout goes to a sudden-victory extra round in which the judges are
 *    forbidden to score even (`drawsAllowed: false`);
 *  - a champion retains on a five-round draw.
 * Plus the safety rules: the standing eight count survives here, three
 * knockdowns in a round or four in a bout ends it (two/three in a tournament).
 * The clinch is one knee and then a break.
 */
import type { Ruleset } from '../types';
import {
  GLORY_WEIGHT_CLASSES, KICKBOXING_FOULS, KICKBOXING_LEGAL, ncHalf,
} from './common';

export const KICKBOXING_GLORY: Ruleset = {
  id: 'kickboxing.glory',
  family: 'kickboxing',
  rounds: {
    count: 3,
    lengthS: 180,
    breakS: 60,
    // Sudden victory: one extra round after a 90 s break.       [S: RULES §2.4]
    extra: { max: 1, lengthS: 180, breakS: 90, trigger: 'draw' },
    goldenScore: false,
    noPositivePointsBeforeS: 0,
    clockStopsOnCount: false,
  },
  weightClasses: GLORY_WEIGHT_CLASSES,
  catchWeightMaxGapLb: null,
  // 8 oz below 65 kg, 10 oz at and above it; the heavier pair is the default.
  gloves: { oz: 10, fingerless: false, bareKnuckle: false },
  legal: KICKBOXING_LEGAL,
  groundedDef: 'any_contact',
  elbows12to6: 'foul',
  clinch: {
    allowed: true,
    maxS: 5,
    activityRule: 'one_strike_then_break',
    kneesAllowed: true,
    elbowsAllowed: false,
    dirtyBoxingAllowed: false,
    catchKickStepLimit: null,
  },
  // No sweeps, no throws, no pushing.
  takedowns: { allowed: false, legal: [], slamOnlyFromSubmission: false },
  submissions: { allowed: false, legal: [], standingLocksAllowed: false },
  ground: { fightingAllowed: false, strikesAllowed: false, standupPolicy: 'immediate' },
  winConditions: [
    'ko', 'tko_strikes', 'tko_count', 'tko_three_kd', 'tko_doctor', 'tko_corner',
    'tko_bell', 'tko_bodily', 'decision', 'technical_decision', 'dq',
  ],
  scoring: {
    system: 'ten_point_must',
    culture: 'glory',
    judges: 3,
    openScoring: 'hidden',
    ncThresholdRounds: ncHalf,
    drawsAllowed: false,
    championRetainsOnDraw: true,
  },
  knockdown: {
    counts: true,
    mandatoryCount: 8,
    koCount: 10,
    standingEight: true,           // the only ruleset here that keeps it
    threeKdRound: 3,               // tournament format uses 2
    fourKdBout: 4,                 // tournament format uses 3
    outOfRingCountS: 20,
    savedByBell: false,
  },
  fouls: KICKBOXING_FOULS,
  stoppage: {
    refereeStops: true, doctor: true, cornerTowel: 'direct', outmatchedTko: false,
  },
  referee: { present: true, strictness: 'standard', crowdPresent: true },
  multiOpponent: { allowed: false, maxPerSide: 1, replacement: 'none' },
};
