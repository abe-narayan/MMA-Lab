/**
 * Parameters owned by design chapter: docs/design/03_GRAPPLING_STATE_GRAPH.md
 * Populated from that chapter's parameter registry (§9.1).
 *
 * The per-edge numbers (base, duration, k_skill, destination weights) live in
 * `src/sim/grappling/graph.ts` as one record per edge, exactly as §9.1 asks;
 * this file holds the **global** tunables — the modifier coefficients, the
 * clamps, the cage terms, the chain and judo tables, the scramble formula, the
 * wall-walk cycle, the ground-and-pound constants and the §6 timers.
 *
 * `free` follows 00_CONVENTIONS §1: a number sourced from research (`[S: …]`)
 * is fixed and the Phase 9 calibrator may not move it; derived (`[D: …]`) and
 * estimated (`[E]`) numbers are free.
 */
import type { ParamSpec } from './registry';

interface Opts {
  min?: number;
  max?: number;
  note?: string;
  /** Override the tag-derived default. */
  free?: boolean;
}

/** `[S: …]` numbers are measurements; everything else is open to calibration. */
function p(id: string, value: number, unit: string, tag: string, o: Opts = {}): ParamSpec {
  const free = o.free ?? !tag.startsWith('[S:');
  const spec: ParamSpec = { id, value, unit, tag, section: 'grappling', free };
  if (o.min !== undefined) spec.min = o.min;
  if (o.max !== undefined) spec.max = o.max;
  if (o.note !== undefined) spec.note = o.note;
  return spec;
}

export const GRAPPLING_PARAMS: ParamSpec[] = [
  // --- §2.1.2 clamps ------------------------------------------------------
  p('grap.clampMin', 0.03, 'probability', '[S: WRESTLING §9]', {
    min: 0, max: 0.2,
    note: 'Lower clamp on every contested edge. Keeps T0-vs-T5 takedowns possible (playability, §9.3.14b).',
  }),
  p('grap.clampMax', 0.95, 'probability', '[S: WRESTLING §9]', { min: 0.8, max: 1 }),

  // --- §2.1.4 modifier coefficients --------------------------------------
  p('grap.k.str', 0.10, 'logit per 10 pts per +', '[D: WRESTLING §9 r3 0.002 P/pt / 0.24 slope]', {
    min: 0, max: 0.5,
  }),
  p('grap.k.mass', 0.16, 'logit per 10 kg per +', '[D: WRESTLING §9 r3 0.004 P/kg; BJJ_POSITIONS §3.3 +0.08 per 5 kg]', {
    min: 0, max: 0.6,
  }),
  p('grap.k.massCap', 0.6, 'logit', '[D: §2.1.4 cap per code]', { min: 0, max: 2 }),
  p('grap.k.exp', 0.10, 'logit per 10 pts', '[E] (JUDO §3 lists EXP qualitatively)', { min: 0, max: 0.5 }),
  p('grap.k.flx', 0.10, 'logit per 10 pts', '[E] (JUDO §8 r7 +-0.03/pt on 0-10)', { min: 0, max: 0.5 }),
  p('grap.k.bal', -0.10, 'logit per 10 pts of defender balance above 50', '[E] (JUDO §3 "uke +BAL")', {
    min: -0.5, max: 0,
  }),
  p('grap.k.hgt', 0.05, 'logit per 10 cm', '[D: JUDO §8 r7 +0.01 P per 2 cm, halved for no-gi]', {
    min: 0, max: 0.3,
  }),
  p('grap.k.rch', 0.05, 'logit per 10 cm', '[E] (WRESTLING §3.6 ankle pick "long arms +5 pp")', {
    min: 0, max: 0.3,
  }),
  p('grap.k.spd', 0.05, 'logit per 10 pts', '[E]', { min: 0, max: 0.3 }),
  p('grap.k.ownBalance', 0.05, 'logit per 10 pts', '[E]', { min: 0, max: 0.3 }),
  p('grap.k.fat', -1.0, 'logit per unit fatigue per -', '[D: WRESTLING §9 r4 -0.25 P at FAT 1; BJJ_POSITIONS §3.3 -0.9]', {
    min: -3, max: 0,
  }),
  p('grap.setupBonus', 0.63, 'logit', '[D: WRESTLING §9 r5 +0.15 P]', { min: 0, max: 2 }),
  p('grap.telegraphPenalty', -0.63, 'logit', '[D: WRESTLING §9 r5 -0.15 P]', { min: -2, max: 0 }),
  p('grap.setupWindowMs', 500, 'ms', '[S: WRESTLING §9 r5]', { min: 100, max: 2000 }),
  p('grap.reactiveShotMinSkill', 40, '0-100', '[S: WRESTLING §3.1]', { min: 0, max: 100 }),
  p('grap.reactiveShotMinReaction', 60, '0-100', '[E]', { min: 0, max: 100 }),
  p('grap.sprawlWindowMs', 450, 'ms', '[S: WRESTLING §9 r10]', { min: 100, max: 1500 }),
  p('grap.sprawlWindowTelegraphBonusMs', 100, 'ms', '[S: WRESTLING §9 r10]', { min: 0, max: 600 }),
  p('grap.stkPerStrike', 0.20, 'logit per landed strike in the last 5 s', '[D: BJJ_POSITIONS §3.3 +0.25; MMA_INTEGRATION I-16]', {
    min: 0, max: 0.6,
  }),
  p('grap.stkMax', 3, 'count', '[D: §2.1.4]', { min: 1, max: 6 }),
  p('grap.stkWindowMs', 5000, 'ms', '[D: §2.1.4 "last 5 s"]', { min: 1000, max: 15000 }),
  p('grap.postureBonus', 0.40, 'logit', '[S: BJJ_POSITIONS §3.3]', { min: 0, max: 1.5 }),
  p('grap.rockedBonus', 0.80, 'logit', '[E]', { min: 0, max: 2 }),
  p('grap.wetPenalty', -0.15, 'logit', '[S: BJJ_POSITIONS §3.3]', { min: -1, max: 0 }),
  p('grap.wetFromRound', 3, 'round', '[S: BJJ_POSITIONS §3.3]', { min: 1, max: 5 }),
  p('grap.uho', 0.35, 'logit', '[S: BJJ_POSITIONS §5.3 r4]', { min: 0, max: 1 }),
  p('grap.legDmgDrivePenalty', -0.30, 'logit per 25 % damage on the driving leg', '[E]', { min: -1, max: 0 }),
  p('grap.legDmgDefenderBonus', 0.30, 'logit when the defender base leg is >= 50 % damaged', '[E]', {
    min: 0, max: 1,
  }),

  // --- §4 cage model ------------------------------------------------------
  p('grap.cageReachM', 1.0, 'm', '[S: WRESTLING §5.1]', { min: 0.3, max: 2.5 }),
  p('grap.cageTdShareTarget', 0.55, 'share of TDs at the fence', '[S: WRESTLING §5]', {
    min: 0, max: 1, note: 'Calibration check only; the engine derives the share from geometry.',
  }),
  p('grap.cageContactTimeTarget', 0.21, 'share of fight time', '[S: FIGHT_DATA §2.2 (RM)]', { min: 0, max: 1 }),
  p('grap.cageCaptureBonus', 0.42, 'logit', '[D: WRESTLING §5.2 +10 pp]', { min: 0, max: 1.5 }),
  p('grap.cageCaptureBonusDouble', 0.63, 'logit', '[D: WRESTLING §9 r7 +15 pp]', { min: 0, max: 1.5 }),
  p('grap.cageRunPipePenalty', -1.05, 'logit', '[D: WRESTLING §5.2 -25 pp]', { min: -2.5, max: 0 }),
  p('grap.cageTripBonus', 0.42, 'logit', '[D: WRESTLING §5.2 +10 pp]', { min: 0, max: 1.5 }),
  p('grap.cageSprawlPenalty', -0.42, 'logit', '[D: WRESTLING §5.2 -10 pp]', { min: -1.5, max: 0 }),
  p('grap.cageFinishDurMult', 1.5, 'x', '[S: WRESTLING §5.2]', { min: 1, max: 3 }),
  p('grap.cagePinnedEnergyMult', 1.3, 'x', '[S: WRESTLING §5.2]', { min: 1, max: 2.5 }),
  p('grap.cageHipInFinishMult', 0.5, 'x on drive/lift P', '[S: WRESTLING §5.2]', { min: 0.1, max: 1 }),
  p('grap.cageBreakPPer5s', 0.30, 'probability per 5 s', '[S: WRESTLING §5.2]', { min: 0, max: 1 }),
  p('grap.cageBreakHeadWrongSideBonus', 0.42, 'logit', '[D: WRESTLING §5.2 +10 pp]', { min: 0, max: 1.5 }),
  p('grap.cageFwdThrowMult', 0.7, 'x P', '[S: JUDO §8 r13]', { min: 0.3, max: 1 }),
  p('grap.cageReapMult', 1.5, 'x P', '[S: JUDO §8 r13]', { min: 1, max: 2.5 }),
  p('grap.cageLiftMult', 1.25, 'x P', '[S: JUDO §8 r13]', { min: 1, max: 2 }),
  p('grap.cageCounterLaunchMult', 0.7, 'x', '[S: JUDO §8 r13]', { min: 0.3, max: 1 }),
  p('grap.cageReferenceRadiusM', 9.1, 'm', '[E] on [S: WRESTLING §8.1]', {
    min: 4, max: 15,
    note: 'Cage size scales the TELE term by (radius / this) ^ -1; 30 ft octagon is the reference.',
  }),
  p('grap.cageAssistPassBonus', 0.35, 'logit', '[S: BJJ_POSITIONS §3.3, §5.3]', { min: 0, max: 1.5 }),
  p('grap.cageAssistPassBonusStrong', 0.70, 'logit', '[S: BJJ_POSITIONS §3.3, §5.3]', { min: 0, max: 2 }),
  p('grap.cageHipEscapePenalty', -0.35, 'logit', '[S: BJJ_POSITIONS §3.2 E5]', { min: -1.5, max: 0 }),

  // --- §2.3 C clinch ------------------------------------------------------
  p('grap.pummelIntervalMs', 3000, 'ms', '[S: WRESTLING §5.3]', { min: 500, max: 10000 }),
  p('grap.pummelSkillP', 0.004, 'P per wrestling point', '[S: WRESTLING §5.3]', { min: 0, max: 0.02 }),
  p('grap.pummelStrP', 0.003, 'P per strength point', '[S: WRESTLING §5.3]', { min: 0, max: 0.02 }),
  p('grap.pummelFatP', -0.15, 'P per unit of fatigue difference', '[S: WRESTLING §5.3]', { min: -0.5, max: 0 }),
  p('grap.greccoJudoClinchBonus', 0.42, 'logit', '[D: WRESTLING §9 r13 +10 pp]', { min: 0, max: 1.5 }),
  p('grap.folkstyleRideBonus', 0.42, 'logit', '[D: WRESTLING §9 r18 +10 pp]', { min: 0, max: 1.5 }),
  p('grap.frontHeadlockDecayMs', 4000, 'ms', '[S: WRESTLING §9 r12]', { min: 1000, max: 15000 }),
  p('grap.frontHeadlockDecayStanding', 0.60, 'weight', '[S: WRESTLING §9 r12]', { min: 0, max: 1 }),
  p('grap.frontHeadlockDecayCollarTie', 0.40, 'weight', '[S: WRESTLING §9 r12]', { min: 0, max: 1 }),

  // --- §2.3 B leg attacks -------------------------------------------------
  p('grap.guillotineTaxBase', 0.12, 'probability', '[S: WRESTLING §9 r6]', { min: 0, max: 0.5 }),
  p('grap.guillotineTaxNoviceMult', 2.5, 'x', '[S: WRESTLING §9 r6]', { min: 1, max: 5 }),
  p('grap.guillotineTaxEliteMult', 0.5, 'x', '[S: WRESTLING §9 r6]', { min: 0.1, max: 1 }),
  p('grap.guillotineTaxBjjBonus', 0.10, 'probability', '[S: WRESTLING §9 r6]', { min: 0, max: 0.4 }),
  p('grap.guillotineFinishIntoGuillotine', 0.60, 'probability', '[S: WRESTLING §9 r6]', { min: 0, max: 1 }),
  p('grap.captureFailSprawl', 0.50, 'weight', '[S: WRESTLING §9 r8]', { min: 0, max: 1 }),
  p('grap.captureFailStanding', 0.35, 'weight', '[S: WRESTLING §9 r8]', { min: 0, max: 1 }),
  p('grap.captureFailFrontHeadlock', 0.15, 'weight', '[S: WRESTLING §9 r8]', { min: 0, max: 1 }),
  p('grap.finishAttemptsMaxOpen', 3, 'count', '[S: WRESTLING §9 r8]', { min: 1, max: 10 }),
  p('grap.finishAttemptsMaxCage', 6, 'count', '[S: WRESTLING §9 r8]', { min: 1, max: 15 }),
  p('grap.tdChainLogit', 1.3, 'logit', '[E: tuned Phase 9 to FIGHT_DATA §3 #57 — the WRESTLING §9 base rates are wrestler-vs-wrestler; with them MMA takedown accuracy ran 24-26 % against a real 38 %. Added to the shooter capture, throw and finish edges in a bout]', { min: 0, max: 1.5 }),
  p('grap.kSkillScale', 1.8, 'ratio', '[D: Realism pass: WRESTLING §8 tier table, sprawl denial 50 / 70 / 85 %, chain success 40 / 65 / 85 %, ride retention 60 / 75 / 85 % across 20-point tiers = 3.3-5.3 logit per 100 points; 03 §2.3 capped its k at 2.1-2.5 for the clamps. The skill term was dead until the Realism pass (alias map), so this is its first calibration]', { min: 0, max: 4 }),
  p('grap.getUpLogit', 1.0, 'logit', '[E: tuned Phase 9 to FIGHT_DATA §3 #24 — the BJJ_POSITIONS escape rates come from grappling, where the bottom player is not trying to stand; in MMA, with the cage to walk up, a third of ground spells lasted to the bell (mean 170 s) and ground time ran 29-31 % against a real 24 %. Added to bottom-initiated edges from the mat that end standing or in the clinch]', { min: 0, max: 1.5 }),
  p('grap.openMatFarShotMult', 0.85, 'x P beyond 1.2 m', '[S: WRESTLING §9 r7]', { min: 0.5, max: 1 }),

  // --- §3 chain grappling -------------------------------------------------
  p('grap.chainBase', 0.15, 'probability', '[S: WRESTLING §9 r9]', { min: 0, max: 1 }),
  p('grap.chainPerSkill', 0.008, 'P per wr.chain point', '[S: WRESTLING §9 r9]', { min: 0, max: 0.02 }),
  p('grap.chainFatigueHalfAbove', 0.7, '0-1 fatigue', '[S: WRESTLING §9 r4]', { min: 0, max: 1 }),
  p('grap.chainSecondShotPenalty', -0.42, 'logit', '[D: -10 pp]', { min: -1.5, max: 0 }),
  p('grap.chainBentBonus', 0.42, 'logit', '[S: WRESTLING §9 r9]', { min: 0, max: 1.5 }),
  p('grap.chainStepFatigueMult', 1.5, 'x shot fatigue', '[S: WRESTLING §9 r9]', { min: 1, max: 3 }),
  p('grap.chainDepthMaxOpen', 3, 'count', '[S: WRESTLING §9 r8]', { min: 1, max: 10 }),
  p('grap.chainDepthMaxCage', 6, 'count', '[S: WRESTLING §9 r8]', { min: 1, max: 15 }),
  p('grap.judoChainMult', 1.3, 'x P', '[S: JUDO §8 r10]', { min: 1, max: 2 }),
  p('grap.judoChainWindowMs', 500, 'ms', '[S: JUDO §8 r10]', { min: 100, max: 2000 }),
  p('grap.bjjChainBonusT4', 0.30, 'logit', '[S: BJJ_POSITIONS §8 r6]', { min: 0, max: 1 }),
  p('grap.bjjChainBonusT3', 0.15, 'logit', '[S: BJJ_POSITIONS §8 r6]', { min: 0, max: 1 }),
  p('grap.bjjChainWindowMs', 5000, 'ms', '[S: BJJ_POSITIONS §8 r6]', { min: 1000, max: 15000 }),
  p('grap.chainGroundStaminaTop', 1.4, 'x', '[S: BJJ_POSITIONS §8 r19]', { min: 1, max: 3 }),
  p('grap.chainGroundStaminaBottom', 1.6, 'x', '[S: BJJ_POSITIONS §8 r19]', { min: 1, max: 3 }),

  // --- §2.3 D judo --------------------------------------------------------
  p('grap.judoFailReset', 0.62, 'weight', '[S: JUDO §8 r9]', { min: 0, max: 1 }),
  p('grap.judoFailTieLost', 0.18, 'weight', '[S: JUDO §8 r9]', { min: 0, max: 1 }),
  p('grap.judoFailPositionGiven', 0.10, 'weight', '[S: JUDO §8 r9]', { min: 0, max: 1 }),
  p('grap.judoFailPositionGivenDrop', 0.30, 'weight', '[S: JUDO §8 r9]', {
    min: 0, max: 1, note: 'Seoi, ippon seoi, kata guruma, drop entries and the sacrifice throws.',
  }),
  p('grap.judoFailCounter', 0.10, 'weight', '[S: JUDO §8 r9]', { min: 0, max: 1 }),
  p('grap.judoCommitHigh', 1.5, 'x', '[S: JUDO §8 r9]', { min: 0, max: 3 }),
  p('grap.judoCommitMid', 1.0, 'x', '[S: JUDO §8 r9]', { min: 0, max: 3 }),
  p('grap.judoCommitLow', 0.3, 'x', '[S: JUDO §8 r9]', { min: 0, max: 3 }),
  p('grap.judoCounterTierLow', 0.3, 'x (T0-T1)', '[S: JUDO §8 r9]', { min: 0, max: 3 }),
  p('grap.judoCounterTierMid', 1.0, 'x (T2-T3)', '[S: JUDO §8 r9]', { min: 0, max: 3 }),
  p('grap.judoCounterTierHigh', 1.5, 'x (T4-T5)', '[S: JUDO §8 r9]', { min: 0, max: 3 }),
  p('grap.judoGripDominantMult', 1.3, 'x P', '[S: JUDO §8 r4]', { min: 1, max: 2 }),
  p('grap.judoGripUkeDominantMult', 0.6, 'x P', '[S: JUDO §8 r4]', { min: 0.2, max: 1 }),
  p('grap.judoGripClampMin', 0.15, 'probability', '[S: JUDO §8 r4]', { min: 0, max: 0.5 }),
  p('grap.judoGripClampMax', 0.85, 'probability', '[S: JUDO §8 r4]', { min: 0.5, max: 1 }),
  p('grap.judoSameSide', 0.14, 'logit', '[D: JUDO §8 r5 x1.15 P]', { min: 0, max: 0.6 }),
  p('grap.judoKenkaSameSide', 0.22, 'logit', '[D: JUDO §8 r5 x1.25 P]', { min: 0, max: 0.8 }),
  p('grap.judoCrossSide', -0.10, 'logit', '[D: JUDO §8 r5 x0.9 P]', { min: -0.6, max: 0 }),
  p('grap.kuzushiMagMax', 3, 'magnitude', '[S: JUDO §8 r6]', { min: 1, max: 5 }),
  p('grap.kuzushiDecayMs', 2000, 'ms per -1 magnitude', '[S: JUDO §8 r6]', { min: 500, max: 10000 }),
  p('grap.kuzushiAlignedBase', 0.5, 'x P', '[S: JUDO §8 r6]', { min: 0, max: 1 }),
  p('grap.kuzushiAlignedPerMag', 0.25, 'x P per magnitude', '[S: JUDO §8 r6]', { min: 0, max: 1 }),
  p('grap.kuzushiUnalignedMult', 0.5, 'x P', '[S: JUDO §8 r6]', { min: 0, max: 1 }),
  p('grap.kuzushiOppositeMult', 0.3, 'x P', '[S: JUDO §8 r6]', { min: 0, max: 1 }),
  p('grap.kuzushiAlignToleranceDeg', 45, 'degrees', '[S: JUDO §8 r6]', { min: 10, max: 90 }),
  p('grap.handleSlipWristCollar', 0.20, 'probability per 5 s', '[S: JUDO §8 r12]', { min: 0, max: 1 }),
  p('grap.handleSlipHookLock', 0.05, 'probability per 5 s', '[S: JUDO §8 r12]', { min: 0, max: 1 }),
  p('grap.handleSlipWindowMs', 5000, 'ms', '[S: JUDO §8 r12]', { min: 1000, max: 20000 }),
  p('grap.throwStrikeCheckMs', 1000, 'ms', '[S: JUDO §8 r8]', { min: 200, max: 4000 }),
  p('grap.throwStrikeCheckMult', 0.5, 'x clinch accuracy', '[S: JUDO §8 r8]', { min: 0, max: 1 }),
  p('grap.throwLandingDmgHip', 0.5, 'x slam scale', '[S: JUDO §8 r11]', { min: 0, max: 2 }),
  p('grap.throwLandingDmgRear', 0.8, 'x slam scale', '[S: JUDO §8 r11]', { min: 0, max: 2 }),
  p('grap.throwLandingDmgSweep', 0.2, 'x slam scale', '[S: JUDO §8 r11]', { min: 0, max: 2 }),
  p('grap.gripExchangeMassRefKg', 70, 'kg', '[D: JUDO §10 r9 heavyweights 165 s vs extra-light 60 s]', {
    min: 40, max: 120,
  }),

  // --- slams and scrambles ------------------------------------------------
  p('grap.slamKoClassP', 0.055, 'probability per slam', '[S: WRESTLING §3.3] (0.03-0.08 band midpoint)', {
    min: 0, max: 0.3,
  }),
  p('grap.saltoRisk', 0.10, 'probability on a successful rear lift', '[S: WRESTLING §9 r14]', {
    min: 0, max: 0.5,
  }),
  p('grap.scrambleWeightScramble', 0.5, 'weight on wr.scramble', '[S: WRESTLING §6]', { min: 0, max: 1 }),
  p('grap.scrambleWeightEscape', 0.2, 'weight on bjj.escape', '[S: WRESTLING §6]', { min: 0, max: 1 }),
  p('grap.scrambleWeightSpeed', 0.15, 'weight on speed', '[S: WRESTLING §6]', { min: 0, max: 1 }),
  p('grap.scrambleWeightFlex', 0.15, 'weight on flexibility', '[S: WRESTLING §6]', { min: 0, max: 1 }),
  p('grap.scrambleFatiguePenalty', -30, 'score points per unit fatigue', '[S: WRESTLING §6]', {
    min: -100, max: 0,
  }),
  p('grap.scrambleFunkBonus', 10, 'score points', '[S: WRESTLING §6]', { min: 0, max: 40 }),
  p('grap.scrambleLogitPerPt', 0.0576, 'logit per score point', '[D: ln 10 / 40]', {
    min: 0.01, max: 0.2,
    note: 'Exposed as a slider: 40 pts = 90/10 makes scrambles very skill-deterministic (§9.3.14a).',
  }),
  p('grap.scrambleMaxMs', 2000, 'ms', '[S: WRESTLING §6]', { min: 500, max: 6000 }),
  p('grap.scrambleCapMs', 4000, 'ms', '[S: BJJ_POSITIONS §8 r26]', { min: 1000, max: 10000 }),
  p('grap.scrambleFatigueMult', 2.0, 'x grappling fatigue per second', '[S: WRESTLING §6]', {
    min: 1, max: 4,
  }),

  // --- §2.3 K stabilisation ----------------------------------------------
  p('grap.stabiliseRollDelayMs', 3000, 'ms', '[S: WRESTLING §8.4]', { min: 500, max: 10000 }),
  p('grap.stabiliseTierShift', 0.10, 'mass moved per tier of top advantage', '[S: BJJ_POSITIONS §5.1]', {
    min: 0, max: 0.3,
  }),

  // --- §4.2 wall walk -----------------------------------------------------
  p('grap.wallWalkCycleMs', 5000, 'ms', '[S: MMA_INTEGRATION I-14]', { min: 1000, max: 15000 }),
  p('grap.wallWalkReachFeetP', 0.60, 'probability', '[S: WRESTLING §3.8, §9 r17]', { min: 0, max: 1 }),
  p('grap.wallWalkCleanP', 0.35, 'probability', '[S: WRESTLING §3.8]', { min: 0, max: 1 }),
  p('grap.wallWalkHeldP', 0.45, 'probability', '[S: WRESTLING §3.8]', { min: 0, max: 1 }),
  p('grap.wallWalkDragP', 0.20, 'probability', '[S: WRESTLING §3.8]', { min: 0, max: 1 }),
  p('grap.wallWalkFenceGrabP', 0.05, 'probability (T <= 1)', '[S: BJJ_POSITIONS §8 r16]', { min: 0, max: 0.5 }),
  p('grap.wallWalkGrabPenalty', -0.5, 'logit', '[S: BJJ_POSITIONS §8 r16]', { min: -2, max: 0 }),
  p('grap.wallWalkTwistBodyLockP', 0.40, 'probability', '[E] (§4.2 top answer that flips UHO)', {
    min: 0, max: 1,
  }),
  p('grap.getUpTopFatigueBonus', 0.42, 'logit per unit of top fatigue', '[D: WRESTLING §9 r17 +0.10 P]', {
    min: 0, max: 1.5,
  }),
  p('grap.getUpFailFreeStrikeOrBackTakeP', 0.15, 'probability', '[S: WRESTLING §9 r17]', { min: 0, max: 1 }),

  // --- §2.3 G rides and back control -------------------------------------
  p('grap.rideHookInP', 0.35, 'probability per 5 s', '[S: WRESTLING §9 r18]', { min: 0, max: 1 }),
  p('grap.rideRetainP', 0.40, 'probability per 5 s', '[S: WRESTLING §9 r18]', { min: 0, max: 1 }),
  p('grap.rideBottomOutP', 0.25, 'probability per 5 s', '[S: WRESTLING §9 r18]', { min: 0, max: 1 }),
  p('grap.turtleWindowBonus', 0.30, 'logit', '[S: BJJ_POSITIONS §8 r13]', { min: 0, max: 1 }),
  p('grap.turtleWindowMs', 3000, 'ms', '[S: BJJ_POSITIONS §8 r13]', { min: 500, max: 10000 }),
  p('grap.backTakeSubEntryP', 0.45, 'probability', '[S: BJJ_POSITIONS §1 (Lamas 2024)]', { min: 0, max: 1 }),
  p('grap.bodyTriangleP', 0.60, 'probability', '[S: BJJ_POSITIONS §8 r12]', { min: 0, max: 1 }),
  p('grap.bodyTriangleMinTier', 3, 'tier', '[S: BJJ_POSITIONS §8 r12]', { min: 0, max: 5 }),
  p('grap.oneHookUpgradeP', 0.50, 'probability per 5 s', '[S: BJJ_POSITIONS §8 r12]', { min: 0, max: 1 }),
  p('grap.oneHookEscapeP', 0.35, 'probability per 5 s', '[S: BJJ_POSITIONS §8 r12]', { min: 0, max: 1 }),
  p('grap.backHandFightP', 0.50, 'probability', '[S: BJJ_POSITIONS §8 r24]', { min: 0, max: 1 }),
  p('grap.backHandFightDurMs', 3000, 'ms', '[S: BJJ_POSITIONS §8 r24]', { min: 500, max: 10000 }),
  p('grap.backHandFightLossesForRncBonus', 3, 'count', '[S: BJJ_POSITIONS §8 r24]', { min: 1, max: 10 }),
  p('grap.backHandFightRncBonus', 0.30, 'logit', '[S: BJJ_POSITIONS §8 r24]', { min: 0, max: 1 }),

  // --- §5 ground and pound ------------------------------------------------
  p('grap.gnpStaminaDrainPerLanded', 0.005, 'stamina fraction', '[S: BJJ_POSITIONS §8 r8]', {
    min: 0, max: 0.05,
  }),
  p('grap.gnpRetentionPenaltyPer5pct', -0.10, 'logit per 5 % of the ground-damage pool', '[S: BJJ_POSITIONS §8 r23]', {
    min: -0.5, max: 0,
  }),
  p('grap.guardOpensAfterStrikesT0', 3, 'count', '[S: BJJ_POSITIONS §6]', { min: 1, max: 12 }),
  p('grap.guardOpensAfterStrikesT1', 5, 'count', '[S: BJJ_POSITIONS §6]', { min: 1, max: 15 }),
  p('grap.gnpStoppageBase', 0.02, 'probability per landed clean strike', '[S: BJJ_POSITIONS §4, §8 r9]', {
    min: 0, max: 0.2,
    note: 'Calibration sanity check only; the engine stoppage is chapter 06 ref.tkoUnansweredGround.',
  }),
  p('grap.gnpStoppageMinUnanswered', 3, 'count', '[S: BJJ_POSITIONS §8 r9]', { min: 1, max: 10 }),
  p('grap.gnpPostureDmgBonus', 0.15, 'x damage when postured', '[S: BJJ_POSITIONS §4]', { min: 0, max: 1 }),
  p('grap.gnpGroundStrikeLandBase', 0.586, 'probability', '[S: BJJ_POSITIONS §4 (Roy & Murphy 2026, 931 attempts)]', {
    min: 0, max: 1,
  }),
  p('grap.groundFatigueTopControl', 1.0, 'x', '[S: BJJ_POSITIONS §8 r19]', { min: 0.5, max: 3 }),
  p('grap.groundFatigueTopPassing', 1.4, 'x', '[S: BJJ_POSITIONS §8 r19]', { min: 0.5, max: 3 }),
  p('grap.groundFatigueBottomEscaping', 1.6, 'x', '[S: BJJ_POSITIONS §8 r19]', { min: 0.5, max: 3 }),
  p('grap.groundFatigueBottomHold', 0.6, 'x', '[S: BJJ_POSITIONS §8 r19]', { min: 0.2, max: 2 }),
  p('grap.shotEnergyVsJab', 3.0, 'x', '[S: WRESTLING §9 r25]', { min: 1, max: 6 }),
  p('grap.failedShotDefenderMult', 1.5, 'x', '[S: WRESTLING §9 r25]', { min: 1, max: 4 }),
  p('grap.stuffedShotShooterMult', 2.5, 'x the striker stamina cost', '[S: MMA_INTEGRATION I-20] (2-3x band)', {
    min: 1, max: 5,
  }),

  // --- §6 control time, activity and stalling -----------------------------
  p('grap.standupWarnS', 30, 's', '[S: RULES_JUDGING §5] (lenient 45 / default 30 / strict 15)', {
    min: 5, max: 120,
  }),
  p('grap.standupS', 50, 's', '[S: RULES_JUDGING §5] (lenient 75 / default 50 / strict 30)', {
    min: 5, max: 180,
  }),
  p('grap.standupRollPerS', 0.20, 'probability per second past the threshold', '[S: BJJ_POSITIONS §8 r17]', {
    min: 0, max: 1,
  }),
  p('grap.passiveTopS', 20, 's', '[S: BJJ_POSITIONS §8 r27]', { min: 5, max: 90 }),
  p('grap.clinchBreakS', 25, 's', '[S: RULES_JUDGING §5] (lenient 40 / default 25 / strict 12)', {
    min: 5, max: 90,
  }),
  p('grap.clinchBreakRollPer5s', 0.50, 'probability per 5 s past the threshold', '[S: WRESTLING §9 r24]', {
    min: 0, max: 1,
  }),
  p('grap.controlTimeMinCtrl', 5, 'ctrl rating', '[S: BJJ_POSITIONS §8 r22]', {
    min: 0, max: 10,
    note: 'Ground top slots accrue control time only in nodes whose ctrl rating reaches this.',
  }),

  // --- §7 multi-opponent --------------------------------------------------
  p('grap.multi.strikeTopRateMult', 0.7, 'x striking rate', '[E] §7', { min: 0, max: 1 }),
  p('grap.multi.dogPilePenalty', -1.0, 'logit', '[E] §7', { min: -3, max: 0 }),
  p('grap.multi.pullOffBase', 0.55, 'probability', '[E] §7', { min: 0, max: 1 }),
  p('grap.multi.teamAssist', 0.3, 'logit', '[E] §7', { min: 0, max: 1 }),
  p('grap.freeAutoStandP', 0.90, 'probability', '[S: BJJ_POSITIONS §3.2 G1 (disengaged)]', { min: 0, max: 1 }),
  p('grap.freeAutoStandMinMs', 1500, 'ms', '[S: BJJ_POSITIONS §3.2 G1]', { min: 200, max: 8000 }),
  p('grap.freeAutoStandMaxMs', 3000, 'ms', '[S: BJJ_POSITIONS §3.2 G1]', { min: 200, max: 12000 }),

  // --- AI propensity by weight class (read by chapter 07) ------------------
  p('grap.tdPropensityLight', 1.15, 'x (FLW/BW/FW)', '[S: WRESTLING §9 r20, §10]', { min: 0.5, max: 2 }),
  p('grap.tdPropensityMid', 1.0, 'x (LW/WW)', '[S: WRESTLING §9 r20, §10]', { min: 0.5, max: 2 }),
  p('grap.tdPropensityMiddle', 0.95, 'x (MW)', '[S: WRESTLING §9 r20, §10]', { min: 0.5, max: 2 }),
  p('grap.tdPropensityHeavy', 0.75, 'x (LHW/HW)', '[S: WRESTLING §9 r20, §10]', { min: 0.5, max: 2 }),
];
