/**
 * `muay_thai.abc` — Muay Thai under the ABC rules (the Western sanctioned form).
 *
 * The clinch is the sport, not an interruption of it: it is untimed and the
 * referee only breaks it when it goes inactive (~5 s). Knees are unlimited
 * inside it and elbows are legal at every angle. Catching a kick buys two
 * steps before you must strike or let go. Sweeps are legal but only the shin
 * sweep and kicking the legs out from under a fighter; hip throws, shoulder
 * throws, reaps and lifts are not. The referee also carries an "outmatched"
 * clause, which is a health-and-safety TKO with no knockdown behind it.
 * [S: RULES §2.5; MTKB §9]
 */
import type { Ruleset } from '../types';
import {
  MUAY_THAI_FOULS, MUAY_THAI_LEGAL, MUAY_THAI_TAKEDOWNS, MUAY_THAI_WEIGHT_CLASSES, ncHalf,
} from './common';

export const MUAY_THAI_ABC: Ruleset = {
  id: 'muay_thai.abc',
  family: 'muay_thai',
  rounds: {
    count: 5,
    lengthS: 180,
    breakS: 60,
    extra: null,
    goldenScore: false,
    noPositivePointsBeforeS: 0,
    clockStopsOnCount: false,
  },
  weightClasses: MUAY_THAI_WEIGHT_CLASSES,
  catchWeightMaxGapLb: null,
  gloves: { oz: 10, fingerless: false, bareKnuckle: false },
  legal: MUAY_THAI_LEGAL,
  groundedDef: 'any_contact',
  elbows12to6: 'legal',
  clinch: {
    allowed: true,
    maxS: null,
    activityRule: 'continuous',
    kneesAllowed: true,
    elbowsAllowed: true,
    dirtyBoxingAllowed: true,
    catchKickStepLimit: 2,
  },
  takedowns: { allowed: true, legal: MUAY_THAI_TAKEDOWNS, slamOnlyFromSubmission: false },
  submissions: { allowed: false, legal: [], standingLocksAllowed: false },
  ground: { fightingAllowed: false, strikesAllowed: false, standupPolicy: 'immediate' },
  winConditions: [
    'ko', 'tko_strikes', 'tko_count', 'tko_doctor', 'tko_corner', 'tko_bell',
    'tko_bodily', 'tko_outmatched', 'decision', 'technical_decision', 'dq',
  ],
  scoring: {
    system: 'ten_point_must',
    culture: 'muay_thai_abc',
    judges: 3,
    openScoring: 'hidden',
    ncThresholdRounds: ncHalf,
    drawsAllowed: true,
    championRetainsOnDraw: false,
  },
  knockdown: {
    counts: true,
    mandatoryCount: 8,
    koCount: 10,
    standingEight: false,
    threeKdRound: null,
    fourKdBout: null,
    // Off the platform is an 18 count, not the boxing 20.        [S: RULES §2.5]
    outOfRingCountS: 18,
    savedByBell: false,
  },
  fouls: MUAY_THAI_FOULS,
  stoppage: {
    refereeStops: true,
    doctor: true,
    // The fighter himself, or his corner, may throw the towel.   [S: RULES §2.5]
    cornerTowel: 'direct',
    outmatchedTko: true,
  },
  referee: { present: true, strictness: 'standard', crowdPresent: true },
  multiOpponent: { allowed: false, maxPerSide: 1, replacement: 'none' },
};
