/**
 * `boxing.pro` — professional boxing under the ABC rules.
 *
 * The interesting parts for the engine are not the punches, they are the
 * count, the "no saved by the bell" rule and the accidental-foul ladder:
 *
 *  - a knockdown is any legal blow that puts something other than the soles of
 *    the feet on the canvas, or leaves the boxer hanging defenceless on the
 *    ropes, or is only stopped from dropping him by the ropes; a slip is not a
 *    knockdown;                                                [S: RULES §2.3]
 *  - the count runs with the clock and continues past the bell;
 *  - an *accidental* low blow that leaves the fouled boxer unable to continue
 *    after five minutes costs him the fight by TKO — the one place in combat
 *    sports where being fouled loses you the bout;              [S: RULES §2.3]
 *  - accidental-foul stoppages are a No Decision before four completed rounds
 *    and a Technical Decision from four onwards;
 *  - the corner's towel does not stop the fight: it reaches the referee via the
 *    inspector, which costs seconds.                            [S: RULES §2.3]
 */
import type { Ruleset } from '../types';
import { BOXING_FOULS, BOXING_LEGAL, BOXING_WEIGHT_CLASSES, ncFour } from './common';

export const BOXING_PRO: Ruleset = {
  id: 'boxing.pro',
  family: 'boxing',
  rounds: {
    count: 12,
    lengthS: 180,
    breakS: 60,
    extra: null,
    goldenScore: false,
    noPositivePointsBeforeS: 0,
    clockStopsOnCount: false,
  },
  weightClasses: BOXING_WEIGHT_CLASSES,
  catchWeightMaxGapLb: null,
  gloves: { oz: 10, fingerless: false, bareKnuckle: false },
  legal: BOXING_LEGAL,
  // "Down" means down: a fallen boxer may not be hit at all, ever.
  groundedDef: 'any_contact',
  elbows12to6: 'foul',
  clinch: {
    allowed: false,
    maxS: null,
    activityRule: 'holding_is_foul',
    kneesAllowed: false,
    elbowsAllowed: false,
    dirtyBoxingAllowed: false,
    catchKickStepLimit: null,
  },
  takedowns: { allowed: false, legal: [], slamOnlyFromSubmission: false },
  submissions: { allowed: false, legal: [], standingLocksAllowed: false },
  ground: { fightingAllowed: false, strikesAllowed: false, standupPolicy: 'immediate' },
  winConditions: [
    'ko', 'tko_strikes', 'tko_count', 'tko_doctor', 'tko_corner', 'tko_bell',
    'tko_bodily', 'decision', 'technical_decision', 'dq',
  ],
  scoring: {
    system: 'ten_point_must',
    culture: 'boxing_abc',
    judges: 3,
    openScoring: 'hidden',
    ncThresholdRounds: ncFour,
    drawsAllowed: true,
    championRetainsOnDraw: true,
  },
  knockdown: {
    counts: true,
    mandatoryCount: 8,
    koCount: 10,
    standingEight: false,          // abolished in professional boxing
    threeKdRound: null,            // no three-knockdown rule by default
    fourKdBout: null,
    outOfRingCountS: 20,           // mandatory 18 if he is back sooner
    savedByBell: false,
  },
  fouls: BOXING_FOULS,
  stoppage: {
    refereeStops: true,
    doctor: true,
    cornerTowel: 'via_inspector',
    outmatchedTko: false,
  },
  referee: { present: true, strictness: 'standard', crowdPresent: true },
  multiOpponent: { allowed: false, maxPerSide: 1, replacement: 'none' },
};
