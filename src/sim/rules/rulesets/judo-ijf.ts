/**
 * `judo.ijf` — IJF contest rules, 2025-28 cycle.
 *
 * Four minutes, then golden score with no time limit: the contest ends on the
 * first score or the third shido, however long that takes. Scores do not
 * accumulate upward — two waza-ari make an ippon, but no number of yuko ever
 * makes a waza-ari. The leg grab is a shido again in this cycle. The
 * direct-hansoku-make list (head-diving throws, kani-basami, kawazu-gake,
 * do-jime, ashi-garami, standing kansetsu/shime-waza, lifting and slamming)
 * ends the contest on the first occurrence. [S: RULES §2.7; JUDO §9]
 */
import type { Ruleset } from '../types';
import {
  IJF_WEIGHT_CLASSES, JUDO_FOULS, JUDO_SUBMISSIONS, JUDO_TAKEDOWNS,
  NO_STRIKING_LEGAL, ncNever,
} from './common';

export const JUDO_IJF: Ruleset = {
  id: 'judo.ijf',
  family: 'judo',
  rounds: {
    count: 1,
    lengthS: 240,
    breakS: 0,
    extra: null,
    goldenScore: true,
    noPositivePointsBeforeS: 0,
    clockStopsOnCount: false,
  },
  weightClasses: IJF_WEIGHT_CLASSES,
  catchWeightMaxGapLb: null,
  gloves: { oz: 0, fingerless: false, bareKnuckle: true },
  legal: NO_STRIKING_LEGAL,
  groundedDef: 'none',
  elbows12to6: 'foul',
  clinch: {
    allowed: true,
    // 45 s attack clock after kumi-kata. RULES §2.7 (IJF SOR text) says 45 s
    // and JUDO §9 says 30 s; the chapter resolves the conflict to 45 s.
    maxS: 45,
    activityRule: 'none',
    kneesAllowed: false,
    elbowsAllowed: false,
    dirtyBoxingAllowed: false,
    catchKickStepLimit: null,
  },
  takedowns: { allowed: true, legal: JUDO_TAKEDOWNS, slamOnlyFromSubmission: false },
  // Chokes and elbow locks in ne-waza only; a standing lock is hansoku-make.
  submissions: { allowed: true, legal: JUDO_SUBMISSIONS, standingLocksAllowed: false },
  ground: { fightingAllowed: true, strikesAllowed: false, standupPolicy: 'judo_progress' },
  winConditions: [
    'ippon', 'waza_ari_x2', 'golden_score', 'submission', 'technical_submission',
    'hansoku_make', 'referee_decision',
  ],
  scoring: {
    system: 'ippon',
    culture: 'none',
    judges: 1,
    openScoring: 'always',
    ncThresholdRounds: ncNever,
    drawsAllowed: false,           // golden score runs until something happens
    championRetainsOnDraw: false,
  },
  knockdown: {
    counts: false, mandatoryCount: 8, koCount: 10, standingEight: false,
    threeKdRound: null, fourKdBout: null, outOfRingCountS: 20, savedByBell: false,
  },
  fouls: JUDO_FOULS,
  stoppage: {
    refereeStops: true, doctor: true, cornerTowel: 'none', outmatchedTko: false,
  },
  referee: { present: true, strictness: 'standard', crowdPresent: true },
  multiOpponent: { allowed: false, maxPerSide: 1, replacement: 'none' },
};
