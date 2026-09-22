/**
 * THE JUDGES — docs/design/06 §2.4.
 *
 * Judging is modelled as measurement, not as truth. There is a real margin
 * between the two fighters in a round, built from the round ledger with
 * weights taken from Holmes' average marginal effects (a knockdown = 1.0
 * logit, and everything else is priced relative to it [S: LIT_B §3.5]). Each
 * judge then *perceives* that margin through his own noise and his own biases,
 * and writes 10-9, 10-8, 10-7 or 10-10.
 *
 * The two numbers that make the model reproduce reality are `noiseScale` 0.32
 * and the 10-8 threshold 2.6, both fixed by the 400,000-round Monte Carlo in
 * §2.4.3: they give 77.0 % unanimous / 18.3 % split / 3.0 % majority decisions,
 * 1.67 % draws and 8.9 % of judge-rounds scored 10-8. `noiseScale` is really a
 * *ratio* — 0.22 of the round-margin SD — so if the engine's measured margin SD
 * moves away from 1.44 it must be rescaled (§5 step 2).
 *
 * Biases are only the ones the literature supports: previous round, reputation
 * or betting favouritism, home crowd, and an insurmountable lead. Gift found no
 * bias for titleholders and none against a fighter who has just been deducted a
 * point, so there is no term for either [S: LIT_B §3.6].
 *
 * Defence is never scored in MMA. Boxing scores it. That is not an oversight in
 * either direction — it is the actual difference between the two criteria sets.
 */
import type { RNG } from '../rng';
import { param as p } from './params';
import type { BoutMethod, BoutResult } from '../core/config';
import type { JudgeCulture, Ruleset } from './types';
import type { GrapplingScore, JudoScore } from './referee';

// ---------------------------------------------------------------------------
// §2.4.1 the round ledger
// ---------------------------------------------------------------------------

export interface MuayThaiTechniqueCounts {
  bodyKick: number;
  knee: number;
  elbow: number;
  punch: number;
  lowKick: number;
  teepEffective: number;
  sweepOffBalance: number;
}

/**
 * Filled from chapter 02/03/04/05 events and frozen at the horn. Counts are
 * per fighter, "caused to the opponent" where the name says so.
 */
export interface RoundLedger {
  kd: number;
  rockedCaused: number;
  bodyHurtCaused: number;
  cutsOpened: number;
  /** Change in the opponent's structuralHead pool, points. */
  structuralHeadDealt: number;
  sigHead: number;
  sigBody: number;
  sigLeg: number;
  nonSigLanded: number;
  sigAttempted: number;
  groundSigHead: number;
  tdLanded: number;
  tdLandedPastGuard: number;
  tdMissed: number;
  /** Attempts that reached chapter 04's `locked` stage. */
  subLocked: number;
  subEarly: number;
  reversals: number;
  passes: number;
  dominantPositionsGained: number;
  /** Control seconds carrying at least one strike or pass/sub attempt per 10 s. */
  controlOffenceS: number;
  controlPassiveS: number;
  oppPurelyDefensiveS: number;
  aggressionS: number;
  centreS: number;
  /** Boxing only: share of the opponent's strikes blocked or evaded, 0-1. */
  defenceQuality: number;
  roundSecondsElapsed: number;
  // family-specific
  mt: MuayThaiTechniqueCounts;
  stumbles: number;
  catchAndDump: number;
  spectacularLanded: number;
  powerPunchLanded: number;
  jabLanded: number;
  bodyPunchLanded: number;
  hurtEvents: number;
  /** [E] Strikes landed inside the final ten seconds; weighted down in boxing. */
  lastTenSecondsLanded: number;
}

export function emptyLedger(): RoundLedger {
  return {
    kd: 0, rockedCaused: 0, bodyHurtCaused: 0, cutsOpened: 0, structuralHeadDealt: 0,
    sigHead: 0, sigBody: 0, sigLeg: 0, nonSigLanded: 0, sigAttempted: 0, groundSigHead: 0,
    tdLanded: 0, tdLandedPastGuard: 0, tdMissed: 0, subLocked: 0, subEarly: 0,
    reversals: 0, passes: 0, dominantPositionsGained: 0,
    controlOffenceS: 0, controlPassiveS: 0, oppPurelyDefensiveS: 0,
    aggressionS: 0, centreS: 0, defenceQuality: 0, roundSecondsElapsed: 0,
    mt: { bodyKick: 0, knee: 0, elbow: 0, punch: 0, lowKick: 0, teepEffective: 0, sweepOffBalance: 0 },
    stumbles: 0, catchAndDump: 0, spectacularLanded: 0,
    powerPunchLanded: 0, jabLanded: 0, bodyPunchLanded: 0, hurtEvents: 0,
    lastTenSecondsLanded: 0,
  };
}

// ---------------------------------------------------------------------------
// §2.4.2 weights
// ---------------------------------------------------------------------------

export interface JudgeWeights {
  kd: number;
  rocked: number;
  bodyHurt: number;
  cut: number;
  structuralHead: number;
  subLocked: number;
  subEarly: number;
  reversal: number;
  td: number;
  tdMissed: number;
  sigHead: number;
  sigBody: number;
  sigLeg: number;
  nonSig: number;
  pass: number;
  dominantPosition: number;
  controlOffenceS: number;
  controlPassiveS: number;
  oppDefensiveFraction: number;
}

/** The keys, in a fixed order, so per-judge trait draws are reproducible. */
export const WEIGHT_KEYS: (keyof JudgeWeights)[] = [
  'kd', 'rocked', 'bodyHurt', 'cut', 'structuralHead', 'subLocked', 'subEarly',
  'reversal', 'td', 'tdMissed', 'sigHead', 'sigBody', 'sigLeg', 'nonSig',
  'pass', 'dominantPosition', 'controlOffenceS', 'controlPassiveS', 'oppDefensiveFraction',
];

export function mmaWeights(): JudgeWeights {
  return {
    kd: p('judge.w.kd'),
    rocked: p('judge.w.rocked'),
    bodyHurt: p('judge.w.bodyHurt'),
    cut: p('judge.w.cut'),
    structuralHead: p('judge.w.structuralHead'),
    subLocked: p('judge.w.subLocked'),
    subEarly: p('judge.w.subEarly'),
    reversal: p('judge.w.reversal'),
    td: p('judge.w.td'),
    tdMissed: p('judge.w.tdMissed'),
    sigHead: p('judge.w.sigHead'),
    sigBody: p('judge.w.sigBody'),
    sigLeg: p('judge.w.sigLeg'),
    nonSig: p('judge.w.nonSig'),
    pass: p('judge.w.pass'),
    dominantPosition: p('judge.w.dominantPosition'),
    controlOffenceS: p('judge.w.controlOffenceS'),
    controlPassiveS: p('judge.w.controlPassiveS'),
    oppDefensiveFraction: p('judge.w.oppDefensiveFraction'),
  };
}

const DAMAGE_KEYS: (keyof JudgeWeights)[] = [
  'kd', 'rocked', 'bodyHurt', 'cut', 'structuralHead',
];
const CONTROL_KEYS: (keyof JudgeWeights)[] = [
  'controlOffenceS', 'controlPassiveS', 'dominantPosition', 'oppDefensiveFraction',
];

/**
 * The 2016-era culture: control was worth more and damage less, 10-8s were
 * rarer and 10-10s commoner. This is what people mean when they say "the old
 * judging" — it is a weighting, not a different rule book.          [E]
 */
export function cultureWeights(culture: JudgeCulture): JudgeWeights {
  const w = mmaWeights();
  if (culture !== 'legacy_2016') return w;
  for (const k of CONTROL_KEYS) w[k] *= p('judge.legacyControlMult');
  for (const k of DAMAGE_KEYS) w[k] *= p('judge.legacyDamageMult');
  return w;
}

// ---------------------------------------------------------------------------
// The per-judge model (§2.4.3)
// ---------------------------------------------------------------------------

export type JudgeExperience = 'regional' | 'standard' | 'elite';

export interface Judge {
  index: number;
  noiseScale: number;
  /** Per-judge weight perturbation: each weight x (1 + N(0, styleSigma)). */
  style: JudgeWeights;
  /** N(1, 0.25): some judges hand out 10-8s more readily than others. */
  propensity1008: number;
  /** Who this judge gave the previous round to, for the previous-round bias. */
  prevRoundWinner: number | null;
  /** Rounds this judge has scored for each fighter, for the lead bias. */
  roundsWon: [number, number];
}

export interface PanelOptions {
  experience?: JudgeExperience;
  /** Off for the Monte Carlo reproduction; on for a real bout. */
  enableBiases?: boolean;
  /** Fighter index with the home crowd, or null. */
  homeFighter?: number | null;
  /** Ranking places in favour of fighter 0 (negative favours fighter 1). */
  rankGap?: number;
  /** Used when no ranks exist: fighter 0's odds ratio over fighter 1. */
  oddsRatio?: number;
  titleFight?: boolean;
  /** Which fighter holds the belt, for `championRetainsOnDraw`. */
  championIndex?: number | null;
}

export interface JudgePanel {
  judges: Judge[];
  rs: Ruleset;
  culture: JudgeCulture;
  opts: Required<Omit<PanelOptions, 'championIndex'>> & { championIndex: number | null };
  /** [judge][roundIndex][fighter] */
  cards: number[][][];
  /** [judge][roundIndex] — the perceived margin, kept for whole-fight cultures. */
  perceived: number[][];
  /** [judge][roundIndex] — true when that round was a near-finish. */
  nearFinish: boolean[][];
}

function noiseFor(culture: JudgeCulture, experience: JudgeExperience): number {
  if (experience === 'regional') return p('judge.noiseScaleRegional');
  if (experience === 'elite') return p('judge.noiseScaleElite');
  if (culture === 'boxing_abc') return p('judge.noiseScaleBoxing');
  return p('judge.noiseScale');
}

/**
 * Judge traits are drawn once, pre-bout, in judge order — never per round.
 * A judge who values control is the same judge in round three. [09 §2.7]
 */
export function createPanel(rs: Ruleset, rng: RNG, opts: PanelOptions = {}): JudgePanel {
  const culture = rs.scoring.culture;
  const experience = opts.experience ?? 'standard';
  const styleSigma = experience === 'regional'
    ? p('judge.styleSigmaRegional') : p('judge.styleSigma');
  const base = cultureWeights(culture);
  const judges: Judge[] = [];
  for (let i = 0; i < rs.scoring.judges; i++) {
    const style = { ...base };
    for (const k of WEIGHT_KEYS) style[k] = base[k] * (1 + rng.normal(0, styleSigma));
    judges.push({
      index: i,
      noiseScale: noiseFor(culture, experience),
      style,
      propensity1008: Math.max(0.1, rng.normal(1, p('judge.propensitySigma'))),
      prevRoundWinner: null,
      roundsWon: [0, 0],
    });
  }
  return {
    judges,
    rs,
    culture,
    opts: {
      experience,
      enableBiases: opts.enableBiases ?? true,
      homeFighter: opts.homeFighter ?? null,
      rankGap: opts.rankGap ?? 0,
      oddsRatio: opts.oddsRatio ?? 1,
      titleFight: opts.titleFight ?? false,
      championIndex: opts.championIndex ?? null,
    },
    cards: judges.map(() => []),
    perceived: judges.map(() => []),
    nearFinish: judges.map(() => []),
  };
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

/**
 * What a judge actually weighs. Kept as a separate structure from the ledger so
 * the Monte Carlo in §2.4.3 (and the calibration harness) can feed synthetic
 * margins straight in without inventing fake strike counts.
 */
export interface RoundSignals {
  /** (dmg + dom) for fighter 0 minus the same for fighter 1. */
  margin: number;
  dmg: [number, number];
  dom: [number, number];
  /** dmg without the knockdown and rocked terms — "was he doing anything?" */
  offence: [number, number];
  kd: [number, number];
  rockedCaused: [number, number];
  /** (controlOffenceS + aggressionS) / roundS, 0-1. Informational for 10-7. */
  dur: [number, number];
  aggressionS: [number, number];
  centreS: [number, number];
}

function dmgOf(l: RoundLedger, w: JudgeWeights): number {
  return w.kd * l.kd
    + w.rocked * l.rockedCaused
    + w.bodyHurt * l.bodyHurtCaused
    + w.cut * l.cutsOpened
    + w.structuralHead * l.structuralHeadDealt
    + w.subLocked * l.subLocked
    + w.subEarly * l.subEarly
    + w.reversal * l.reversals
    + w.td * l.tdLanded
    + w.tdMissed * l.tdMissed
    + w.sigHead * l.sigHead
    + w.sigBody * l.sigBody
    + w.sigLeg * l.sigLeg
    + w.nonSig * l.nonSigLanded
    + w.pass * l.passes
    + w.dominantPosition * l.dominantPositionsGained;
}

function domOf(l: RoundLedger, w: JudgeWeights, roundS: number): number {
  const span = roundS > 0 ? roundS : 1;
  return w.controlOffenceS * l.controlOffenceS
    + w.controlPassiveS * l.controlPassiveS
    + w.oppDefensiveFraction * (l.oppPurelyDefensiveS / span);
}

/**
 * Build the signals for one round.
 *
 * Plan A is damage and effective grappling. When the margin is inside the even
 * threshold the judge falls to Plan B (effective aggression) and then Plan C
 * (cage control) — the actual order in the unified criteria.   [S: RULES §2.2]
 */
export function ledgerSignals(
  a: RoundLedger, b: RoundLedger, roundS: number, w: JudgeWeights,
): RoundSignals {
  const dmg: [number, number] = [dmgOf(a, w), dmgOf(b, w)];
  const dom: [number, number] = [domOf(a, w, roundS), domOf(b, w, roundS)];
  const noKdW: JudgeWeights = { ...w, kd: 0, rocked: 0 };
  const offence: [number, number] = [dmgOf(a, noKdW), dmgOf(b, noKdW)];
  const span = roundS > 0 ? roundS : 1;
  const dur: [number, number] = [
    Math.min(1, (a.controlOffenceS + a.aggressionS) / span),
    Math.min(1, (b.controlOffenceS + b.aggressionS) / span),
  ];

  let margin = (dmg[0] + dom[0]) - (dmg[1] + dom[1]);
  if (Math.abs(margin) < p('judge.evenThreshold')) {
    margin += p('judge.planB') * Math.sign(a.aggressionS - b.aggressionS);
    if (Math.abs(margin) < p('judge.evenThreshold')) {
      margin += p('judge.planC') * Math.sign(a.centreS - b.centreS);
    }
  }
  return {
    margin,
    dmg,
    dom,
    offence,
    kd: [a.kd, b.kd],
    rockedCaused: [a.rockedCaused, b.rockedCaused],
    dur,
    aggressionS: [a.aggressionS, b.aggressionS],
    centreS: [a.centreS, b.centreS],
  };
}

/** Synthetic signals from a bare margin — the §2.4.3 Monte Carlo generator. */
export function marginSignals(margin: number): RoundSignals {
  const m = Math.abs(margin);
  const w = margin >= 0 ? 0 : 1;
  const l = 1 - w;
  const dmg: [number, number] = [0, 0];
  const dom: [number, number] = [0, 0];
  const off: [number, number] = [0, 0];
  // A round won by `m` is three parts damage to one part control, and the
  // loser did nothing — the shape that makes `domination()` mean what §2.4.2
  // says it means.
  dmg[w] = 0.75 * m;
  dom[w] = 0.25 * m;
  off[w] = 0.75 * m;
  const dur: [number, number] = [0, 0];
  dur[w] = Math.min(1, 0.5 + 0.25 * m);
  return {
    margin,
    dmg,
    dom,
    offence: off,
    kd: [0, 0],
    rockedCaused: [0, 0],
    dur,
    aggressionS: [0, 0],
    centreS: [0, 0],
  };
}

// ---------------------------------------------------------------------------
// Perception and the 10-point-must
// ---------------------------------------------------------------------------

/**
 * `noiseScale x Logistic(0,1)`. Consumes exactly two draws, matching the
 * `perceivedNoise (normal() = 2)` slot in the 09 §2.7 schedule, so swapping the
 * noise family later cannot shift the RNG stream.
 */
function perceivedNoise(rng: RNG, scale: number): number {
  const u = Math.min(1 - 1e-12, Math.max(1e-12, rng.next()));
  rng.next();
  return scale * Math.log(u / (1 - u));
}

function judgeBias(panel: JudgePanel, j: Judge, trueMargin: number): number {
  if (!panel.opts.enableBiases) return 0;
  let bias = 0;

  // Previous round: judges are sticky, but only in close rounds.
  if (j.prevRoundWinner !== null && Math.abs(trueMargin) < p('judge.prevRoundCloseOnly')) {
    bias += p('judge.prevRoundBias') * (j.prevRoundWinner === 0 ? 1 : -1);
  }
  // Reputation / favouritism. Ranks if we have them, betting odds otherwise.
  const rankGap = panel.opts.rankGap;
  let rep = rankGap !== 0
    ? p('judge.reputationPer10Ranks') * (rankGap / 10)
    : p('judge.oddsBias') * Math.log(Math.max(1e-6, panel.opts.oddsRatio));
  const cap = p('judge.reputationCap');
  rep = Math.max(-cap, Math.min(cap, rep));
  bias += rep;
  // Home crowd — and only if there is a crowd. An empty-arena bout has none.
  if (panel.opts.homeFighter !== null && panel.rs.referee.crowdPresent) {
    const size = panel.culture === 'boxing_abc'
      ? p('judge.homeBiasBoxing') : p('judge.homeBiasMma');
    bias += size * (panel.opts.homeFighter === 0 ? 1 : -1);
  }
  // Insurmountable lead: a judge who has someone 2-0 up leans that way.
  const lead = j.roundsWon[0] - j.roundsWon[1];
  if (Math.abs(lead) >= 2) bias += p('judge.leadBias') * Math.sign(lead);
  return bias;
}

export interface RoundContext {
  round: number;
  roundS: number;
  /** Referee point deductions applied to each fighter's card this round. */
  deductions?: [number, number];
  /** Partial round at a technical decision; defaults to roundS. */
  secondsElapsed?: number;
  /** GLORY sudden-victory round: the judges may not score it even. */
  mustSeparate?: boolean;
}

function tenPointScore(
  j: Judge, sig: RoundSignals, perceived: number, rng: RNG, panel: JudgePanel,
  mustSeparate: boolean,
): [number, number] {
  const abs = Math.abs(perceived);
  const w = perceived >= 0 ? 0 : 1;
  const l = 1 - w;
  const p1010Mult = panel.culture === 'legacy_2016' ? p('judge.legacyP1010Mult') : 1;
  const tenEightMult = panel.culture === 'legacy_2016' ? p('judge.legacyTenEightMult') : 1;
  const tenTenRoll = rng.next();

  if (!mustSeparate && abs < p('judge.T10')
    && tenTenRoll < Math.min(1, p('judge.p1010') * p1010Mult)) {
    return [10, 10];
  }

  const sigDamage = sig.kd[w] >= 1
    || sig.rockedCaused[w] >= 2
    || sig.dmg[w] >= p('judge.tenEightDamage');
  // Positional control alone never yields a 10-8: the loser must have been
  // stopped from doing anything, not merely held.             [S: RULES §2.2]
  const domination = sig.dom[w] >= p('judge.tenEightDom')
    && sig.offence[l] <= p('judge.loserOffenceRatio') * sig.offence[w];
  const t8 = p('judge.tenEight') * tenEightMult * j.propensity1008;

  let loserScore = 9;
  if (sig.kd[w] >= 2
    || (sigDamage && domination && sig.dur[w] >= 0.8 && abs >= p('judge.tenSeven'))) {
    loserScore = 7;
  } else if ((sigDamage && abs >= p('judge.tenEightKd')) || (abs >= t8 && domination)) {
    loserScore = 8;
  }
  const out: [number, number] = [0, 0];
  out[w] = 10;
  out[l] = loserScore;
  return out;
}

/**
 * Score one round from pre-built signals. This is the entry point the §2.4.3
 * Monte Carlo and the calibration harness use.
 *
 * Draw order per judge: `perceivedNoise` (2), `tenTen` (1) — 3 per judge per
 * round, exactly as docs/design/09 §2.7 P7 specifies.
 */
export function scoreRoundSignals(
  panel: JudgePanel, sig: RoundSignals, ctx: RoundContext, rng: RNG,
): number[][] {
  const cards: number[][] = [];
  const deductions = ctx.deductions ?? [0, 0];
  for (const j of panel.judges) {
    const bias = judgeBias(panel, j, sig.margin);
    const perceived = sig.margin + perceivedNoise(rng, j.noiseScale) + bias;
    const score = tenPointScore(j, sig, perceived, rng, panel, ctx.mustSeparate ?? false);

    // Deductions are applied to the card, not absorbed into the judge's
    // impression: judges never adjust their own scores for fouls.
    // GLORY subtracts minus points before the round score, which is the same
    // arithmetic — a 10-9 winner with -1 leaves the round 9-9. [S: RULES §2.4]
    const final: [number, number] = [score[0] - deductions[0], score[1] - deductions[1]];

    j.prevRoundWinner = final[0] === final[1] ? j.prevRoundWinner
      : final[0] > final[1] ? 0 : 1;
    if (final[0] > final[1]) j.roundsWon[0] += 1;
    else if (final[1] > final[0]) j.roundsWon[1] += 1;

    panel.cards[j.index].push(final);
    panel.perceived[j.index].push(perceived);
    panel.nearFinish[j.index].push(sig.kd[0] + sig.kd[1] > 0);
    cards.push(final);
  }
  return cards;
}

// ---------------------------------------------------------------------------
// Culture-specific round scoring
// ---------------------------------------------------------------------------

/** §2.4.5 boxing. Defence is scored; the last ten seconds are discounted. */
function boxingSignals(a: RoundLedger, b: RoundLedger): RoundSignals {
  const base = (l: RoundLedger): number => {
    const raw = p('judge.boxing.wPower') * l.powerPunchLanded
      + p('judge.boxing.wJab') * l.jabLanded
      + p('judge.boxing.wBody') * l.bodyPunchLanded
      + p('judge.boxing.wHurt') * l.hurtEvents
      + p('judge.boxing.wAggr') * Math.min(1, l.aggressionS / Math.max(1, l.roundSecondsElapsed))
      + p('judge.boxing.wGeneral') * Math.min(1, l.centreS / Math.max(1, l.roundSecondsElapsed))
      + p('judge.boxing.wDefence') * l.defenceQuality;
    // "Do not let a fighter steal a round with a last-second flurry."
    const discount = (1 - p('judge.boxing.lastTenSecondsWeight'))
      * p('judge.boxing.wPower') * l.lastTenSecondsLanded;
    return raw - discount;
  };
  const sa = base(a);
  const sb = base(b);
  const off: [number, number] = [sa - p('judge.boxing.wHurt') * a.hurtEvents,
    sb - p('judge.boxing.wHurt') * b.hurtEvents];
  return {
    margin: sa - sb,
    dmg: [sa, sb],
    dom: [0, 0],
    offence: off,
    kd: [a.kd, b.kd],
    rockedCaused: [a.hurtEvents, b.hurtEvents],
    dur: [1, 1],
    aggressionS: [a.aggressionS, b.aggressionS],
    centreS: [a.centreS, b.centreS],
  };
}

/**
 * Boxing's knockdown arithmetic is explicit rather than threshold-based
 * [S: RULES §2.3 S4]: net 1 = 10-8, net 2 = 10-7, net 3+ = 10-6. The exception
 * matters — a flash knockdown late in a round the other boxer dominated stays
 * 10-9 to the knockdown scorer.
 */
function boxingScore(
  j: Judge, sig: RoundSignals, perceived: number, rng: RNG, a: RoundLedger, b: RoundLedger,
): [number, number] {
  const abs = Math.abs(perceived);
  // In boxing the knockdown decides who wins the round, not the impression:
  // the man who was dropped does not win the round he was dropped in.
  const w = a.kd !== b.kd ? (a.kd > b.kd ? 0 : 1) : (perceived >= 0 ? 0 : 1);
  const l = 1 - w;
  const net = [a.kd, b.kd][w] - [a.kd, b.kd][l];
  const t8 = p('judge.boxing.decisiveMargin') * j.propensity1008;
  const tenTenRoll = rng.next();
  const out: [number, number] = [0, 0];
  out[w] = 10;

  if (net === 0) {
    if (abs < p('judge.T10') && tenTenRoll < p('judge.p1010Boxing')) return [10, 10];
    out[l] = (abs >= t8 && sig.offence[l] <= 0.05 * Math.max(1e-9, sig.offence[w])) ? 8 : 9;
  } else if (net === 1) {
    // A flash knockdown late in a round the other boxer dominated stays 10-9
    // to the knockdown scorer.                                [S: RULES §2.3]
    const loserDominatedRest = (sig.dmg[l] - sig.dmg[w]) >= 1.0
      && [a.hurtEvents, b.hurtEvents][l] > 0;
    out[l] = loserDominatedRest ? 9 : abs >= t8 ? 7 : 8;
  } else {
    // net 2 = 10-7, net 3 = 10-6, and lower with more.
    out[l] = Math.max(4, 9 - net);
  }
  return out;
}

/**
 * §2.4.6 Muay Thai. The order is fixed and lexicographic: knockdowns, then
 * cumulative damage, then technique (kicks and knees to the body outrank
 * punches), and only then aggression and control.              [S: RULES §4.4]
 */
function muayThaiTechnique(l: RoundLedger): number {
  return p('judge.mt.technique.bodyKick') * l.mt.bodyKick
    + p('judge.mt.technique.knee') * l.mt.knee
    + p('judge.mt.technique.elbow') * l.mt.elbow
    + p('judge.mt.technique.punch') * l.mt.punch
    + p('judge.mt.technique.lowKick') * l.mt.lowKick
    + p('judge.mt.technique.sweepOffBalance') * l.mt.sweepOffBalance
    + p('judge.mt.technique.teepEffective') * l.mt.teepEffective;
}

function muayThaiSignals(a: RoundLedger, b: RoundLedger, roundS: number, w: JudgeWeights): RoundSignals {
  const base = ledgerSignals(a, b, roundS, w);
  // cumDamage is dmg() without the knockdown term.
  const noKd: JudgeWeights = { ...w, kd: 0 };
  const cum: [number, number] = [dmgOf(a, noKd), dmgOf(b, noKd)];
  let margin: number;
  if (a.kd !== b.kd) {
    // More or better knockdowns: that fighter never loses the round.
    margin = (a.kd - b.kd) * 10;
  } else if (Math.abs(cum[0] - cum[1]) > p('judge.mt.damageT1')) {
    margin = cum[0] - cum[1];
  } else {
    const tech = muayThaiTechnique(a) - muayThaiTechnique(b);
    if (tech !== 0) margin = tech;
    else {
      margin = p('judge.planB') * Math.sign(a.aggressionS - b.aggressionS)
        + p('judge.planC') * Math.sign(a.centreS - b.centreS);
    }
  }
  // Composure, in the stadium reading: visible hurt and stumbles cost you,
  // catching a kick and dumping the man earns.                        [E]
  // `judge.mt.stumble` is negative, so a fighter who stumbles more loses
  // margin: composure is part of the Thai reading of a round.
  margin += p('judge.mt.stumble') * (a.stumbles - b.stumbles);
  margin += p('judge.mt.catchAndDump') * (a.catchAndDump - b.catchAndDump);
  return { ...base, margin, dmg: cum };
}

function muayThaiScore(
  j: Judge, sig: RoundSignals, perceived: number, a: RoundLedger, b: RoundLedger,
): [number, number] {
  const abs = Math.abs(perceived);
  const w = perceived >= 0 ? 0 : 1;
  const l = 1 - w;
  const kdW = [a.kd, b.kd][w];
  const t8 = p('judge.tenEight') * j.propensity1008;
  const out: [number, number] = [0, 0];
  out[w] = 10;
  // 10-6 exists in Muay Thai and nowhere else on this list.
  if (kdW >= 3) out[l] = 6;
  else if (kdW === 2) out[l] = 7;
  else if (kdW === 1 || abs >= t8) out[l] = 8;
  else out[l] = 9;
  return out;
}

/** §2.4.7 GLORY / K-1: knockdowns, then high impact, then clean strikes. */
function glorySignals(a: RoundLedger, b: RoundLedger, roundS: number, w: JudgeWeights): RoundSignals {
  const base = ledgerSignals(a, b, roundS, w);
  const impact = (l: RoundLedger): number =>
    p('judge.glory.rocked') * l.rockedCaused + p('judge.w.structuralHead') * l.structuralHeadDealt;
  const clean = (l: RoundLedger): number =>
    p('judge.w.sigHead') * l.sigHead + p('judge.w.sigBody') * l.sigBody
    + p('judge.w.sigLeg') * l.sigLeg
    + p('judge.glory.spectacularMult') * p('judge.w.sigHead') * l.spectacularLanded;
  let margin: number;
  if (a.kd !== b.kd) margin = (a.kd - b.kd) * 10;
  else {
    margin = (impact(a) - impact(b)) + (clean(a) - clean(b))
      + p('judge.planB') * Math.sign(a.aggressionS - b.aggressionS)
      + p('judge.planC') * Math.sign(a.centreS - b.centreS);
  }
  return {
    ...base,
    margin,
    dmg: [impact(a) + clean(a), impact(b) + clean(b)],
  };
}

function gloryScore(
  sig: RoundSignals, perceived: number, a: RoundLedger, b: RoundLedger,
  mustSeparate: boolean, rng: RNG,
): [number, number] {
  const w = perceived >= 0 ? 0 : 1;
  const l = 1 - w;
  const kdW = [a.kd, b.kd][w];
  const impactW = sig.dmg[w];
  const domination = sig.dom[w] >= p('judge.tenEightDom');
  const tenTenRoll = rng.next();
  const out: [number, number] = [0, 0];
  out[w] = 10;
  if (kdW >= 2) out[l] = 7;
  else if (kdW === 1 || (impactW >= p('judge.glory.tenEightImpact') && domination)) out[l] = 8;
  else if (!mustSeparate && Math.abs(perceived) < p('judge.T10')
    && tenTenRoll < p('judge.p1010')) return [10, 10];
  else out[l] = 9;
  return out;
}

/**
 * Score one round for whichever culture this panel uses. `scoreRoundSignals`
 * remains available for synthetic margins.
 */
export function scoreRound(
  panel: JudgePanel, ledgers: [RoundLedger, RoundLedger], ctx: RoundContext, rng: RNG,
): number[][] {
  const [a, b] = ledgers;
  const roundS = ctx.secondsElapsed ?? ctx.roundS;
  const deductions = ctx.deductions ?? [0, 0];
  const cards: number[][] = [];

  for (const j of panel.judges) {
    let sig: RoundSignals;
    if (panel.culture === 'boxing_abc') sig = boxingSignals(a, b);
    else if (panel.culture === 'muay_thai_abc' || panel.culture === 'thai_stadium') {
      sig = muayThaiSignals(a, b, roundS, j.style);
    } else if (panel.culture === 'glory') sig = glorySignals(a, b, roundS, j.style);
    else sig = ledgerSignals(a, b, roundS, j.style);

    const bias = judgeBias(panel, j, sig.margin);
    const perceived = sig.margin + perceivedNoise(rng, j.noiseScale) + bias;

    let score: [number, number];
    if (panel.culture === 'boxing_abc') score = boxingScore(j, sig, perceived, rng, a, b);
    else if (panel.culture === 'muay_thai_abc' || panel.culture === 'thai_stadium') {
      rng.next();                                  // keep the per-judge draw count at 3
      score = muayThaiScore(j, sig, perceived, a, b);
    } else if (panel.culture === 'glory') {
      score = gloryScore(sig, perceived, a, b, ctx.mustSeparate ?? false, rng);
    } else score = tenPointScore(j, sig, perceived, rng, panel, ctx.mustSeparate ?? false);

    const final: [number, number] = [score[0] - deductions[0], score[1] - deductions[1]];
    j.prevRoundWinner = final[0] === final[1] ? j.prevRoundWinner
      : final[0] > final[1] ? 0 : 1;
    if (final[0] > final[1]) j.roundsWon[0] += 1;
    else if (final[1] > final[0]) j.roundsWon[1] += 1;

    panel.cards[j.index].push(final);
    panel.perceived[j.index].push(perceived);
    panel.nearFinish[j.index].push(a.kd + b.kd > 0 || a.subLocked + b.subLocked > 0);
    cards.push(final);
  }
  return cards;
}

// ---------------------------------------------------------------------------
// §2.4.4 aggregation
// ---------------------------------------------------------------------------

export interface DecideMeta {
  round: number;
  timeSeconds: number;
  totalSeconds: number;
  /** A stoppage from an accidental foul past the NC threshold. */
  technical?: boolean;
  /** GLORY: only the sudden-victory round decides. */
  extraRoundOnly?: boolean;
}

export interface JudgeTotals {
  totals: number[][];
  winners: (0 | 1 | 'draw')[];
}

export function judgeTotals(panel: JudgePanel, fromRound = 0): JudgeTotals {
  const totals: number[][] = [];
  const winners: (0 | 1 | 'draw')[] = [];
  for (const j of panel.judges) {
    const rounds = panel.cards[j.index].slice(fromRound);
    const t = [0, 0];
    for (const r of rounds) {
      t[0] += r[0];
      t[1] += r[1];
    }
    totals.push(t);
    winners.push(t[0] === t[1] ? 'draw' : t[0] > t[1] ? 0 : 1);
  }
  return { totals, winners };
}

function aggregate(winners: (0 | 1 | 'draw')[]): { winner: 0 | 1 | 'draw'; method: BoutMethod } {
  const n = winners.length;
  const c0 = winners.filter((w) => w === 0).length;
  const c1 = winners.filter((w) => w === 1).length;
  const cd = winners.filter((w) => w === 'draw').length;
  const lead = c0 > c1 ? 0 : 1;
  const leadCount = Math.max(c0, c1);
  const otherCount = Math.min(c0, c1);

  if (leadCount === n) return { winner: lead as 0 | 1, method: 'decision.unanimous' };
  if (leadCount > n / 2) {
    // Two for one man and one draw is a majority decision; two for one man and
    // one for the other is a split.                           [S: RULES §2.2]
    return {
      winner: lead as 0 | 1,
      method: otherCount === 0 ? 'decision.majority' : 'decision.split',
    };
  }
  if (cd === n) return { winner: 'draw', method: 'draw' };
  if (cd > n / 2) return { winner: 'draw', method: 'draw.majority' };
  return { winner: 'draw', method: 'draw.split' };
}

/**
 * The whole-fight cultures (ONE, PRIDE, and the Thai stadium impression) do not
 * add cards up: each judge forms one impression of the bout. The Thai version
 * weights the middle rounds most and discounts the first two, because a Thai
 * fight is built rather than raced.                      [S: RULES §4.1, §4.4]
 */
function wholeFightWinners(panel: JudgePanel): (0 | 1 | 'draw')[] {
  const stadium = panel.culture === 'thai_stadium';
  const weights = [
    p('judge.mt.stadiumRoundWeight1'), p('judge.mt.stadiumRoundWeight2'),
    p('judge.mt.stadiumRoundWeight3'), p('judge.mt.stadiumRoundWeight4'),
    p('judge.mt.stadiumRoundWeight5'),
  ];
  return panel.judges.map((j) => {
    let impression = 0;
    const rounds = panel.perceived[j.index];
    for (let r = 0; r < rounds.length; r++) {
      const wt = stadium ? (weights[r] ?? 1) : 1;
      impression += wt * rounds[r];
      if (!stadium && panel.nearFinish[j.index][r]) {
        impression += p('judge.wholeFightNearFinishBonus') * Math.sign(rounds[r]);
      }
    }
    // No draws in a whole-fight culture: the judge must pick someone.
    return impression >= 0 ? 0 : 1;
  });
}

/**
 * The bout decision. Card totals are the standard; per-round consensus differs
 * in only ~2.5 % of bouts [S: LIT_B §3.12] and is exposed for display only.
 */
export function decide(panel: JudgePanel, meta: DecideMeta): BoutResult {
  const rs = panel.rs;
  const roundsScored = panel.cards[0]?.length ?? 0;
  const fromRound = meta.extraRoundOnly ? roundsScored - 1 : 0;
  const { totals, winners } =
    panel.culture === 'whole_fight' || panel.culture === 'thai_stadium'
      ? { totals: judgeTotals(panel, fromRound).totals, winners: wholeFightWinners(panel) }
      : judgeTotals(panel, fromRound);

  let { winner, method } = aggregate(winners);

  if (meta.technical) {
    method = 'decision.technical';
  }

  let detail = '';
  if (winner === 'draw' && rs.scoring.championRetainsOnDraw && panel.opts.championIndex !== null) {
    // The belt does not change hands on a draw; the record still says draw.
    detail = 'champion retains';
  }
  if (winner === 'draw' && !rs.scoring.drawsAllowed) {
    // GLORY sudden victory forbids an even extra round; the judges are told to
    // separate them, so this state should not survive `mustSeparate`. If it
    // does, the higher total on the extra round wins outright.
    const t = totals[0] ?? [0, 0];
    winner = t[0] >= t[1] ? 0 : 1;
    method = 'decision.split';
    detail = 'sudden victory';
  }

  return {
    winner,
    winningTeam: winner === 'draw' ? null : winner,
    method,
    detail,
    round: meta.round,
    timeSeconds: meta.timeSeconds,
    totalSeconds: meta.totalSeconds,
    scorecards: panel.cards.map((rounds) => rounds.map((r) => [...r])),
    judgeTotals: totals,
  };
}

/** Per-round consensus scoring, offered as a display option only. */
export function consensusWinner(panel: JudgePanel): 0 | 1 | 'draw' {
  const rounds = panel.cards[0]?.length ?? 0;
  let a = 0;
  let b = 0;
  for (let r = 0; r < rounds; r++) {
    let votes = 0;
    for (const j of panel.judges) {
      const card = panel.cards[j.index][r];
      votes += card[0] > card[1] ? 1 : card[1] > card[0] ? -1 : 0;
    }
    if (votes > 0) a += 1;
    else if (votes < 0) b += 1;
  }
  return a === b ? 'draw' : a > b ? 0 : 1;
}

// ---------------------------------------------------------------------------
// §2.4.8 grappling and judo decisions
// ---------------------------------------------------------------------------

export interface GrapplingDecideMeta extends DecideMeta {
  /** Offensive initiative for the referee decision: dom() plus subLocked. */
  dominance?: [number, number];
}

/**
 * IBJJF: points, then advantages, then fewer penalties, then a referee
 * decision on offensive initiative, and only then a coin flip — which is why a
 * jiu-jitsu match almost never ends without a named winner. [S: RULES §4.5]
 */
export function decideGrappling(
  score: GrapplingScore, rs: Ruleset, meta: GrapplingDecideMeta, rng: RNG,
): BoutResult {
  const order: ((s: GrapplingScore) => [number, number])[] =
    rs.scoring.system === 'points_adcc'
      ? [(s) => [s.points[0] - s.negatives[0], s.points[1] - s.negatives[1]]]
      : [
        (s) => s.points,
        (s) => s.advantages,
        (s) => [-s.penalties[0], -s.penalties[1]],
      ];
  let winner: 0 | 1 | 'draw' = 'draw';
  let detail = '';
  for (const key of order) {
    const [x, y] = key(score);
    if (x !== y) {
      winner = x > y ? 0 : 1;
      detail = 'points';
      break;
    }
  }
  if (winner === 'draw') {
    // Referee decision: dom() plus 0.40 per locked submission, same noise
    // scale as the judges and no biases at all.                          [E]
    const dom = meta.dominance ?? [0, 0];
    const a = dom[0] + p('judge.w.subLocked') * score.subLocked[0];
    const b = dom[1] + p('judge.w.subLocked') * score.subLocked[1];
    const noise = p('judge.noiseScale') * (rng.next() - 0.5) * 2;
    const m = a - b + noise;
    winner = m === 0 ? (rng.next() < 0.5 ? 0 : 1) : m > 0 ? 0 : 1;
    detail = 'referee decision';
  }
  const result: 0 | 1 | 'draw' = winner;
  return {
    winner: result,
    winningTeam: typeof result === 'number' ? result : null,
    method: detail === 'points' ? 'decision.unanimous' : 'decision.split',
    detail,
    round: meta.round,
    timeSeconds: meta.timeSeconds,
    totalSeconds: meta.totalSeconds,
    scorecards: [],
    judgeTotals: [[score.points[0], score.points[1]]],
  };
}

/**
 * Judo: ippon, then two waza-ari, then the waza-ari count, then yuko, then
 * golden score. Shido never scores for the opponent — it only accumulates
 * toward hansoku-make.                                  [S: RULES §4.5; JUDO §9]
 */
export function decideJudo(score: JudoScore, meta: DecideMeta): BoutResult {
  let winner: 0 | 1 | 'draw' = 'draw';
  let method: BoutMethod = 'decision.unanimous';
  let detail = 'golden score';

  if (score.hansokuMake[0] !== score.hansokuMake[1]) {
    winner = score.hansokuMake[0] ? 1 : 0;
    method = 'dq';
    detail = 'hansoku-make';
  } else if (score.ippon[0] !== score.ippon[1]) {
    winner = score.ippon[0] ? 0 : 1;
    detail = 'ippon';
  } else if (score.wazaAri[0] !== score.wazaAri[1]) {
    winner = score.wazaAri[0] > score.wazaAri[1] ? 0 : 1;
    detail = 'waza-ari';
  } else if (score.yuko[0] !== score.yuko[1]) {
    winner = score.yuko[0] > score.yuko[1] ? 0 : 1;
    detail = 'yuko';
  }
  return {
    winner,
    winningTeam: winner === 'draw' ? null : winner,
    method,
    detail,
    round: meta.round,
    timeSeconds: meta.timeSeconds,
    totalSeconds: meta.totalSeconds,
    scorecards: [],
    judgeTotals: [[score.wazaAri[0], score.wazaAri[1]]],
  };
}

/** Sub-only: a submission or a draw, unless EBI overtime is enabled. */
export function decideSubOnly(
  escapeTimeS: [number, number] | null, meta: DecideMeta,
): BoutResult {
  let winner: 0 | 1 | 'draw' = 'draw';
  let detail = 'time limit';
  if (escapeTimeS && escapeTimeS[0] !== escapeTimeS[1]) {
    // The shorter cumulative escape time wins the EBI tiebreak.
    winner = escapeTimeS[0] < escapeTimeS[1] ? 0 : 1;
    detail = 'escape time';
  }
  return {
    winner,
    winningTeam: winner === 'draw' ? null : winner,
    method: winner === 'draw' ? 'draw' : 'decision.unanimous',
    detail,
    round: meta.round,
    timeSeconds: meta.timeSeconds,
    totalSeconds: meta.totalSeconds,
    scorecards: [],
    judgeTotals: [],
  };
}
