/**
 * `grappling.ibjjf` — IBJJF points jiu-jitsu, adult black belt by default.
 *
 * Points are not awarded for arriving somewhere; they are awarded for arriving
 * and staying there. Three seconds of stabilisation, and not while the scorer
 * is himself inside a submission attempt. Everything that nearly scored is an
 * advantage, which is the tie-break before penalties. The legal-submission
 * list is a function of belt and gi, not a constant: `ibjjfSubmissions()` in
 * `common.ts` generates it, and this instance uses adult brown/black no-gi.
 * [S: RULES §2.6; BJJ §9.1]
 */
import type { Ruleset } from '../types';
import {
  GRAPPLING_TAKEDOWNS, IBJJF_DURATION_BY_BELT, IBJJF_FOULS, IBJJF_SUBMISSIONS,
  IBJJF_WEIGHT_CLASSES, NO_STRIKING_LEGAL, ncNever,
} from './common';

export const GRAPPLING_IBJJF: Ruleset = {
  id: 'grappling.ibjjf',
  family: 'grappling',
  rounds: {
    count: 1,
    // Adult black belt. White 300 / blue 360 / purple 420 / brown 480.
    lengthS: IBJJF_DURATION_BY_BELT.black,
    breakS: 0,
    extra: null,
    goldenScore: false,
    noPositivePointsBeforeS: 0,
    clockStopsOnCount: false,
  },
  weightClasses: IBJJF_WEIGHT_CLASSES,
  catchWeightMaxGapLb: null,
  gloves: { oz: 0, fingerless: false, bareKnuckle: true },
  legal: NO_STRIKING_LEGAL,
  groundedDef: 'none',
  elbows12to6: 'foul',
  clinch: {
    allowed: true,
    maxS: null,
    activityRule: 'none',
    kneesAllowed: false,
    elbowsAllowed: false,
    dirtyBoxingAllowed: false,
    catchKickStepLimit: null,
  },
  // No slams, no scissor takedowns, no suplexes onto the head or neck.
  takedowns: {
    allowed: true,
    legal: GRAPPLING_TAKEDOWNS.filter((t) => t !== 'slam'),
    slamOnlyFromSubmission: false,
  },
  submissions: { allowed: true, legal: IBJJF_SUBMISSIONS, standingLocksAllowed: false },
  ground: { fightingAllowed: true, strikesAllowed: false, standupPolicy: 'ibjjf_stalling' },
  winConditions: [
    'submission', 'technical_submission', 'points', 'referee_decision', 'dq',
  ],
  scoring: {
    system: 'points_ibjjf',
    culture: 'none',
    judges: 1,
    openScoring: 'always',
    ncThresholdRounds: ncNever,
    drawsAllowed: false,           // the referee decides rather than draw
    championRetainsOnDraw: false,
  },
  knockdown: {
    counts: false, mandatoryCount: 8, koCount: 10, standingEight: false,
    threeKdRound: null, fourKdBout: null, outOfRingCountS: 20, savedByBell: false,
  },
  fouls: IBJJF_FOULS,
  stoppage: {
    refereeStops: true, doctor: true, cornerTowel: 'none', outmatchedTko: false,
  },
  referee: { present: true, strictness: 'standard', crowdPresent: true },
  multiOpponent: { allowed: false, maxPerSide: 1, replacement: 'none' },
};
