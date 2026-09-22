/**
 * `mma.unified.3r` — ABC Unified Rules of MMA, 2024 text, non-title distance.
 *
 * This is the reference ruleset: every calibration target in docs/design/06 §5
 * is measured under it. [S: RULES §2.1, §2.2]
 */
import type { Ruleset } from '../types';
import {
  MMA_FOULS, MMA_LEGAL, MMA_SUBMISSIONS, MMA_TAKEDOWNS, MMA_WEIGHT_CLASSES, ncHalf,
} from './common';

export const MMA_UNIFIED_3R: Ruleset = {
  id: 'mma.unified.3r',
  family: 'mma',
  rounds: {
    count: 3,
    lengthS: 300,
    breakS: 60,
    extra: null,
    goldenScore: false,
    noPositivePointsBeforeS: 0,
    // The count is a boxing device; MMA has none, and nowhere does the clock
    // stop for one. There is no saved-by-the-bell anywhere.   [S: RULES §6.2]
    clockStopsOnCount: false,
  },
  weightClasses: MMA_WEIGHT_CLASSES,
  // The heavier fighter may not exceed the lighter by more than 5 lb.
  catchWeightMaxGapLb: 5,                                       // [S: RULES §2.2]
  gloves: { oz: 4, fingerless: true, bareKnuckle: false },
  legal: MMA_LEGAL,
  /**
   * 2024 definition: a fighter is grounded when any part other than the hands
   * or the feet is on the floor. Hands never count — so the "put a hand down
   * to buy knee immunity" trick that the 2017 text created no longer works.
   */
  groundedDef: 'unified_2024',                                  // [S: RULES §2.2]
  /**
   * Legal since November 2024, when the ABC deleted foul #10. Most viewers
   * still believe the Jon Jones rule is live; it is not.
   */
  elbows12to6: 'legal',                                         // [S: RULES §2.2]
  clinch: {
    allowed: true,
    maxS: null,                       // untimed; the referee breaks on inactivity
    activityRule: 'none',
    kneesAllowed: true,
    elbowsAllowed: true,
    dirtyBoxingAllowed: true,
    catchKickStepLimit: null,
  },
  takedowns: { allowed: true, legal: MMA_TAKEDOWNS, slamOnlyFromSubmission: false },
  submissions: { allowed: true, legal: MMA_SUBMISSIONS, standingLocksAllowed: true },
  ground: {
    fightingAllowed: true,
    strikesAllowed: true,
    // The 2026 ABC text: maintaining a superior position is not, by itself,
    // effort. The stand-up clock runs on effort, not on position. [S: RULES §2.2]
    standupPolicy: 'unified_effort',
  },
  // Exactly the ways to win in the S1 list; no-contest and the three draw
  // types are outcomes, not wins, and are not listed here.   [S: RULES §2.2]
  winConditions: [
    'ko', 'tko_strikes', 'tko_doctor', 'tko_corner', 'tko_bell', 'tko_bodily',
    'submission', 'technical_submission', 'decision', 'technical_decision', 'dq',
  ],
  scoring: {
    system: 'ten_point_must',
    culture: 'unified_2025',
    judges: 3,
    openScoring: 'hidden',
    ncThresholdRounds: ncHalf,                                  // 2 of 3
    drawsAllowed: true,
    championRetainsOnDraw: false,
  },
  knockdown: {
    counts: false,                                              // [S: RULES §3.2]
    mandatoryCount: 8,
    koCount: 10,
    standingEight: false,
    threeKdRound: null,
    fourKdBout: null,
    outOfRingCountS: 20,
    savedByBell: false,
  },
  fouls: MMA_FOULS,
  stoppage: {
    refereeStops: true,
    doctor: true,
    cornerTowel: 'direct',                                      // [S: RULES §2.2]
    outmatchedTko: false,
  },
  referee: { present: true, strictness: 'standard', crowdPresent: true },
  multiOpponent: { allowed: false, maxPerSide: 1, replacement: 'none' },
};
