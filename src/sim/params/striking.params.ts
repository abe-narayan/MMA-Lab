/**
 * Parameters owned by design chapter: docs/design/02_STRIKING.md
 * Transcribed from that chapter's §4 parameter registry.
 *
 * Not repeated here (by §4's own instruction): the per-technique rows of §2.2
 * (`p.strike.tech.<id>.<field>`), the guard and defence tables of §2.4
 * (`p.strike.guard.*`, `p.strike.def.*`), the counter matrix of §2.5.2
 * (`p.strike.ctr.<id>.bonus`), the catch tree of §2.5.3, the named chains of
 * §2.3.2 and the feints of §2.3.4. Those live as typed catalogues in
 * `src/sim/striking/`, where a reader can see each number next to what it does.
 *
 * Entries the chapter's REVIEW pass retired are deliberately absent:
 * `p.strike.feint.bite[tier]`, `p.strike.read.base[tier]`,
 * `p.strike.read.skillK`, `p.strike.read.counterOnRead[tier]` (all now 01
 * composites), `p.strike.glove.boxing.rotFactor` (now 05 `ko.kGlove`) and
 * `p.strike.force.refFlushCross` (05 consumes delivered force directly).
 *
 * `free` follows 00_CONVENTIONS §1: a number fixed by a measurement is not a
 * calibration lever. Sourced `[S:]` values are frozen; `[E]` estimates are open;
 * `[D]` values are frozen unless §5 names them as a lever for a FIGHT_DATA row.
 */
import type { ParamSpec } from './registry';

interface Opts {
  free?: boolean;
  min?: number;
  max?: number;
  note?: string;
}

function p(id: string, value: number, unit: string, tag: string, opts: Opts = {}): ParamSpec {
  return {
    id, value, unit, tag, section: 'striking',
    // Default: estimates are levers, measurements are not.
    free: opts.free ?? tag.startsWith('[E'),
    ...(opts.min !== undefined ? { min: opts.min } : {}),
    ...(opts.max !== undefined ? { max: opts.max } : {}),
    ...(opts.note !== undefined ? { note: opts.note } : {}),
  };
}

const LOGIT = 'logit';
const MS = 'ms';
const PROB = 'probability';
const RATIO = 'ratio';

export const STRIKING_PARAMS: ParamSpec[] = [
  // -------------------------------------------------------------------------
  // §2.1.1 reach geometry and range bands
  // -------------------------------------------------------------------------
  p('p.strike.geom.jabReachAdd', 0.27, 'm', '[E]', {
    min: 0.15, max: 0.40,
    note: 'Added to 01 effectiveReachM: lean 0.10 + shoulder-to-centre 0.05 + face-to-centre 0.12.',
  }),
  p('p.strike.geom.crossReachAdd', 0.04, 'm', '[E]', { min: 0, max: 0.15 }),
  p('p.strike.geom.hookReachAdd', 0.12, 'm', '[E]', { min: 0, max: 0.3 }),
  p('p.strike.geom.uppercutReachAdd', -0.05, 'm', '[E]', { min: -0.2, max: 0 }),
  p('p.strike.geom.elbowReach', 0.55, 'm', '[E]', { min: 0.4, max: 0.7 }),
  p('p.strike.geom.kneeReach', 0.65, 'm', '[E]', { min: 0.5, max: 0.9 }),
  p('p.strike.geom.kickReachAdd', 0.30, 'm', '[E]', { min: 0.15, max: 0.5 }),
  p('p.strike.geom.teepReachAdd', 0.25, 'm', '[E]', { min: 0.1, max: 0.45 }),
  p('p.strike.geom.stepGainMin', 0.30, 'm', '[S: BOX §2 #2]', { note: 'A step jab closes 30-50 cm.' }),
  p('p.strike.geom.stepGainMax', 0.50, 'm', '[S: BOX §2 #2]'),
  p('p.strike.geom.bladedReach', 0.05, 'm', '[E]', {
    note: 'Lead hand gains this x b, rear hand loses it x b.',
  }),
  p('p.strike.range.clinchMax', 0.45, 'm', '[E]', {
    min: 0.3, max: 0.6, note: 'Two torso radii 0.18 + 0.09 m.',
  }),
  p('p.strike.range.closeMax', 0.70, 'm', '[D: BOX §2 close < 0.5 m chest-to-chest + 0.2 m to centre]'),
  p('p.strike.range.midToLongOffset', -0.15, 'm', '[E]', { min: -0.3, max: 0 }),
  p('p.strike.range.longToKickOffset', 0.10, 'm', '[E]', { min: 0, max: 0.3 }),

  p('p.strike.rangeFit.edge', -0.30, LOGIT, '[E]', {
    min: -1, max: 0, note: 'Outer 10 cm of the home band.',
  }),
  p('p.strike.rangeFit.edgeBand', 0.10, 'm', '[E]'),
  p('p.strike.rangeFit.wrongBand', -0.60, LOGIT, '[E]', { min: -1.5, max: 0 }),
  p('p.strike.rangeFit.forceEdge', 0.70, RATIO, '[E]', { min: 0.3, max: 1 }),
  p('p.strike.rangeFit.forceSmother', 0.60, RATIO, '[E]', { min: 0.3, max: 1 }),
  p('p.strike.rangeComfort.k', 0.40, LOGIT, '[E; direction S: LA §2 Estevan 2011 / Falco 2009]', {
    note: 'Extra out-of-band penalty of (1 - skill/100) x k: novices\' timing is distance-dependent.',
  }),

  // -------------------------------------------------------------------------
  // §2.1.2 stance bladedness
  // -------------------------------------------------------------------------
  p('p.strike.stance.bladedJab', 0.20, 'logit per b', '[E; S: BOX §4 Stances]'),
  p('p.strike.stance.bladedReach', 0.05, 'm per b', '[E]'),
  p('p.strike.stance.bladedShoulderRoll', 0.40, 'logit per b', '[E]'),
  p('p.strike.stance.bladedLegExposure', 0.15, 'ratio per b', '[E]', {
    note: 'Lead-leg kick damage taken x (1 + this x b); passed to 05 as targetExposure.',
  }),
  p('p.strike.stance.bladedCheck', -0.20, 'logit per b', '[E]'),
  p('p.strike.stance.bladedLateral', 0.15, 'ratio per b', '[E]'),
  p('p.strike.stance.bladedTarget', -0.10, 'logit per b', '[E]', {
    note: 'Opponent\'s straights against a bladed body: a smaller target.',
  }),

  // -------------------------------------------------------------------------
  // §2.1.3 angles and the lead-foot battle
  // -------------------------------------------------------------------------
  p('p.strike.angle.threshold', 30, 'deg', '[E]'),
  p('p.strike.angle.straightPenalty', -0.60, LOGIT, '[D: BOX §8 G27 -0.15 p at p=0.30]'),
  p('p.strike.angle.hookPenalty', -0.20, LOGIT, '[D: BOX §8 G27 -0.05 p]'),
  p('p.strike.angle.kickPenalty', -0.30, LOGIT, '[E]'),
  p('p.strike.angle.rearHandBonus', 0.30, LOGIT, '[E]'),
  p('p.strike.angle.unseenP', 0.35, PROB, '[E]', { min: 0, max: 1 }),
  p('p.strike.angle.resquareMs', 300, MS, '[E]'),
  p('p.strike.leadFoot.threshold', 0.10, 'm', '[E]'),
  p('p.strike.leadFoot.rearStraight', 0.20, LOGIT, '[D: MIS ST-1]'),
  p('p.strike.leadFoot.rearKickOpenSide', 0.20, LOGIT, '[D: MIS ST-1]'),
  p('p.strike.leadFoot.leadHook', 0.10, LOGIT, '[D: MIS ST-3]'),
  p('p.strike.leadFoot.oppRearStraight', -0.15, LOGIT, '[D: MIS ST-1]'),
  p('p.strike.leadFoot.leadLegKick', 0.26, LOGIT, '[D: MIS ST-6 ln 1.3]'),
  p('p.strike.leadFoot.circleWeight', 1.5, RATIO, '[S: MIS ST-1]'),

  // -------------------------------------------------------------------------
  // §2.1.4 cage zones and cutting off
  // -------------------------------------------------------------------------
  p('p.strike.cage.centreMin', 2.0, 'm', '[E]'),
  p('p.strike.cage.fenceMax', 0.8, 'm', '[E]'),
  p('p.strike.cage.fenceEvasion', -0.40, LOGIT, '[D: BOX §8 C12 -0.10 p]'),
  p('p.strike.cage.fenceStepOff', -1.0, LOGIT, '[E]'),
  p('p.strike.cage.fenceComboCap', 1, 'count', '[S: MIS P-3]'),
  p('p.strike.cage.fenceBodyWeight', 1.4, RATIO, '[S: MIS P-3]'),
  p('p.strike.cage.fenceClinchWeight', 1.3, RATIO, '[S: MIS P-3]'),
  p('p.strike.cutoff.mirrorAngle', 30, 'deg', '[E]'),
  p('p.strike.cutoff.armSeconds', 0.5, 's', '[E]'),
  p('p.strike.cutoff.failNear', 0.30, PROB, '[S: BOX §8 G28]', { min: 0, max: 1 }),
  p('p.strike.cutoff.failFence', 0.60, PROB, '[S: BOX §8 G28]', { min: 0, max: 1 }),
  p('p.strike.cutoff.minCageCraft', 30, '0-100', '[S: BOX §4 "a year or more" = T2+]'),
  p('p.strike.cutoff.accuracyBase', 0.5, PROB, '[E]'),
  p('p.strike.cutoff.accuracySlope', 0.005, 'probability per point', '[E]'),
  p('p.strike.cutoff.smallCageMult', 1.15, RATIO, '[S: MIS §10.21]'),

  // -------------------------------------------------------------------------
  // §2.1.5 movement primitives
  // -------------------------------------------------------------------------
  p('p.strike.move.stepDragMs', 200, MS, '[S: BOX §4 150-250 ms]'),
  p('p.strike.move.pivotMs', 300, MS, '[S: BOX §4 250-350 ms]'),
  p('p.strike.move.lStepMs', 400, MS, '[S: BOX §4 350-450 ms]'),
  p('p.strike.move.shuffleMs', 200, MS, '[S: BOX §4]'),
  p('p.strike.move.levelChangeMs', 200, MS, '[E]'),
  p('p.strike.move.levelChangeTelegraph', 120, MS, '[E]'),
  p('p.strike.move.shiftPower', 1.15, RATIO, '[E]'),
  p('p.strike.move.shiftDefence', -0.50, LOGIT, '[E]'),
  p('p.strike.move.shiftDefenceMs', 400, MS, '[E]'),
  p('p.strike.move.switchMs', 300, MS, '[S: MIS ST-8]'),
  p('p.strike.move.switchStamina', 1, 'percent', '[S: MIS ST-8]'),
  p('p.strike.move.switchTdVuln', 0.60, LOGIT, '[D: MIS ST-8 +15 %]'),
  p('p.strike.move.switchLegDamage', 1.3, RATIO, '[S: MIS ST-8]'),
  p('p.strike.move.retreatMs', 200, MS, '[E]'),
  p('p.strike.move.feetCrossP.t0', 0.25, PROB, '[S: BOX §8 H32]', { min: 0, max: 1 }),
  p('p.strike.move.feetCrossP.t1', 0.10, PROB, '[S: BOX §8 H32]', { min: 0, max: 1 }),
  p('p.strike.move.feetCrossP.t2', 0.02, PROB, '[S: BOX §8 H32]', { min: 0, max: 1 }),
  p('p.strike.move.feetCrossP.t3', 0, PROB, '[S: BOX §8 H32]', { min: 0, max: 1 }),
  p('p.strike.move.feetCrossP.t4', 0, PROB, '[S: BOX §8 H32]', { min: 0, max: 1 }),
  p('p.strike.move.feetCrossP.t5', 0, PROB, '[S: BOX §8 H32]', { min: 0, max: 1 }),
  p('p.strike.move.feetCrossMs', 300, MS, '[S: BOX §8 H32]'),

  // -------------------------------------------------------------------------
  // §2.3.1 chain rules
  // -------------------------------------------------------------------------
  p('p.strike.combo.overlap', 0.40, 'fraction of recovery', '[E]', {
    min: 0, max: 0.9,
    note: 'Checked against the measured 851 ms four-action combo: 1-2-3-2 comes out at ~780 ms.',
  }),
  p('p.strike.combo.stepBonus', 0.24, 'logit per step', '[D: BOX §8 B6 +0.05 p]', { free: true }),
  p('p.strike.combo.stepBonusCap', 0.48, LOGIT, '[D: BOX §8 B6 cap +0.15 p]', { free: true }),
  p('p.strike.combo.afterLandedJab', 0.48, LOGIT, '[D: BOX §8 B5 +0.10 p at p=0.30]'),
  p('p.strike.combo.afterDefendedJab', 0.24, LOGIT, '[D: BOX §8 B5]'),
  p('p.strike.combo.bodyHeadMs', 600, MS, '[S: BOX §8 B9]'),
  p('p.strike.combo.bodyHeadBonus', 0.48, LOGIT, '[D: BOX §8 B9]'),
  p('p.strike.combo.bodyPoolHeadKick', 0.45, LOGIT, '[D: MTK §5.3 at body structural >= 40]'),
  p('p.strike.combo.dutchMs', 300, MS, '[S: MTK §8.3]'),
  p('p.strike.combo.dutchBonus', 0.45, LOGIT, '[D: MTK §8.4 +0.10 p]'),
  p('p.strike.combo.dutchReadPenalty', -0.15, PROB, '[S: MTK §8.3]', {
    note: 'Absolute change to P(read) of the kick, not a logit.',
  }),
  p('p.strike.combo.dutchCheckMult', 0.5, RATIO, '[E]', {
    note: 'The check is halved because the hands are up.',
  }),
  p('p.strike.combo.kickThenPunch', 0.24, LOGIT, '[E]'),
  p('p.strike.combo.afterCheckPunch', 0.50, LOGIT, '[D: MTK §8.13 +0.10 p]'),
  p('p.strike.combo.cap.t0', 2, 'count', '[E]', { min: 1, max: 8 }),
  p('p.strike.combo.cap.t1', 3, 'count', '[E]', { min: 1, max: 8 }),
  p('p.strike.combo.cap.t2', 3, 'count', '[E]', { min: 1, max: 8 }),
  p('p.strike.combo.cap.t3', 4, 'count', '[E]', { min: 1, max: 8 }),
  p('p.strike.combo.cap.t4', 5, 'count', '[E]', { min: 1, max: 8 }),
  p('p.strike.combo.cap.t5', 6, 'count', '[E]', { min: 1, max: 8 }),
  p('p.strike.combo.capVsWrestler', 3, 'count', '[S: MIS S-4]'),
  p('p.strike.combo.illegalPenaltyLogit', -0.50, LOGIT, '[D: BOX §8 B6 -0.10 p]'),
  p('p.strike.combo.illegalPenaltyMs', 100, MS, '[D: BOX §8 B6]'),
  p('p.strike.combo.reloadMs', 100, MS, '[D: BOX §8 B6 hip reload]'),
  p('p.strike.combo.illegalRate.t0', 0.30, PROB, '[E]', { min: 0, max: 1 }),
  p('p.strike.combo.illegalRate.t1', 0.15, PROB, '[E]', { min: 0, max: 1 }),

  // -------------------------------------------------------------------------
  // §2.3.4 feints
  // -------------------------------------------------------------------------
  p('p.strike.feint.startupMinMs', 80, MS, '[S: BOX §5]'),
  p('p.strike.feint.startupMaxMs', 150, MS, '[S: BOX §5]'),
  p('p.strike.feint.recoveryMs', 100, MS, '[S: BOX §5]'),
  p('p.strike.feint.windowMs', 400, MS, '[E]'),
  p('p.strike.feint.sellK', 1.5, 'logit per 100 pts', '[E]'),
  p('p.strike.feint.habituation', -0.70, 'logit per repeat', '[E]', {
    note: 'Same feint inside 20 s without a strike. The second one is information, not a trap.',
  }),
  p('p.strike.feint.habituationWindowMs', 20000, MS, '[E]'),
  p('p.strike.feint.bonusLow', 0.40, LOGIT, '[D: BOX §8 B7 +0.08 p vs T0-T2]'),
  p('p.strike.feint.bonusMid', 0.20, LOGIT, '[D: BOX §8 B7 +0.04 p vs T3]'),
  p('p.strike.feint.bonusHigh', 0.10, LOGIT, '[D: BOX §8 B7 +0.02 p vs T4-T5]'),
  p('p.strike.feint.levelChangeBonus', 0.70, LOGIT, '[D: MIS I-6 +15-25 %]'),
  p('p.strike.feint.overFeintN', 3, 'count', '[S: BOX §8 B7]'),
  p('p.strike.feint.overFeintCounterP', 0.30, PROB, '[S: BOX §8 B7]', { min: 0, max: 1 }),
  p('p.strike.feint.kickFeintPunch', 0.50, LOGIT, '[D: MTK §8.13]'),
  p('p.strike.feint.visionBlocked', 0.40, LOGIT, '[E]'),
  p('p.strike.feint.fatigue', 0.50, 'logit per f', '[E]'),

  // -------------------------------------------------------------------------
  // §2.3.5 rhythm
  // -------------------------------------------------------------------------
  p('p.strike.rhythm.onBeatTol', 0.15, 'fraction', '[E]'),
  p('p.strike.rhythm.halfBeatLow', 0.40, 'fraction', '[E]'),
  p('p.strike.rhythm.halfBeatHigh', 0.60, 'fraction', '[E]'),
  p('p.strike.rhythm.offBeatLow', 1.40, 'fraction', '[E]'),
  p('p.strike.rhythm.offBeatHigh', 1.60, 'fraction', '[E]'),
  p('p.strike.rhythm.brokenBonus', 0.30, LOGIT, '[D: BOX §8 B8 +0.06 p]'),
  p('p.strike.rhythm.minTier', 4, 'tier', '[S: BOX §8 H31 elite rhythm breaking]'),
  p('p.strike.rhythm.readableBonus', 0.30, LOGIT, '[E]', {
    note: 'The defender\'s pattern read after 4 on-beat actions.',
  }),
  p('p.strike.rhythm.cadenceMinMs', 400, MS, '[D: BOX §5 cycle times 442/667 ms]'),
  p('p.strike.rhythm.cadenceMaxMs', 700, MS, '[D: BOX §5]'),

  // -------------------------------------------------------------------------
  // §2.3.6 set-up windows handed to 03
  // -------------------------------------------------------------------------
  p('p.strike.setup.jabSetupMs', 800, MS, '[S: MIS I-2]'),
  p('p.strike.setup.crossSetupMs', 600, MS, '[S: MIS I-3]'),
  p('p.strike.setup.hookBodylockMs', 400, MS, '[S: MIS I-4]'),

  // -------------------------------------------------------------------------
  // §2.4.1 guard postures
  // -------------------------------------------------------------------------
  p('p.strike.guard.switchMs', 200, MS, '[E]'),
  p('p.strike.guard.highPassiveBonus', 0.60, LOGIT, '[E]'),
  p('p.strike.guard.highStamina', 1.10, RATIO, '[E]'),
  p('p.strike.guard.longPokeRateMin', 0.3, 'percent per s', '[S: MIS §2.4]'),
  p('p.strike.guard.longPokeRateMax', 0.6, 'percent per s', '[S: MIS §2.4]'),
  p('p.strike.guard.longStepInPenalty', -0.30, LOGIT, '[D: BOX §3 D10]'),
  p('p.strike.guard.phillyMinB', 0.5, '0-1', '[E]'),
  p('p.strike.guard.phillyMinSkill', 60, '0-100', '[E]'),
  p('p.strike.guard.peekabooStamina', 1.15, RATIO, '[E]'),
  p('p.strike.guard.crossArmMobility', 0.90, RATIO, '[S: BOX §8 C11 -0.10]'),
  p('p.strike.guard.crossArmCounterMult', 0.5, RATIO, '[S: BOX §3 D12 "slow to counter"]'),
  p('p.strike.guard.passiveBase', 0.20, PROB, '[E]', {
    min: 0, max: 1,
    note: 'P(the guard stops it) when no reactive defence fired at all — the floor of the model.',
  }),
  p('p.strike.guard.passiveK', 0.8, 'logit per 100 pts', '[E]'),
  p('p.strike.guard.passiveAbsorb', 0.45, 'fraction', '[E; S: DP §3.3]'),

  // -------------------------------------------------------------------------
  // §2.2.5 glove and ruleset modifiers
  // -------------------------------------------------------------------------
  p('p.strike.glove.boxing.jabLogit', -0.60, LOGIT, '[D: logit(0.19) - logit(0.30)]', {
    note: 'Mixes a counting convention (CompuBox counts pawing jabs) with a physical effect.',
  }),
  p('p.strike.glove.boxing.powerLogit', 0.30, LOGIT, '[D: logit(0.36) - logit(0.29)]'),
  p('p.strike.glove.boxing.blockLogit', 0.90, LOGIT, '[D: logit(0.80) - logit(0.62); MIS §2.4]'),
  p('p.strike.glove.boxing.blockPassthrough', 0.35, 'fraction', '[S: BOX §3 D1 30-50 %]'),
  p('p.strike.glove.mma.blockPassthrough', 0.55, 'fraction', '[S: BOX §3 D1 50-60 %]'),

  // -------------------------------------------------------------------------
  // §2.4.3 reaction and the read
  // -------------------------------------------------------------------------
  p('p.strike.react.choiceMs', 60, MS, '[E]', {
    note: 'Placeholder: the only measured choice RTs (LB §4.7, 0.8-0.9 s on video) are not transferable.',
  }),
  p('p.strike.react.fatigueMult', 0.15, 'ratio per f', '[S: LB §4.7 +10-15 %]'),
  p('p.strike.react.rockedMult', 1.15, RATIO, '[S: DP §2.1]'),
  p('p.strike.react.noviceAddMs', 30, 'ms per tier below T2', '[S: BOX §8 C13]', {
    note: 'Applies to the CHOICE cost only. Simple RT is untiered (LB §4.2 Mori 2002).',
  }),
  p('p.strike.react.visionBlockedMs', 80, MS, '[E]'),
  p('p.strike.read.telegraphSlope', 0.004, 'logit per ms', '[E]'),
  p('p.strike.read.fatigue', -0.50, 'logit per f', '[E]'),
  p('p.strike.read.hurtPenaltyLow', 0.65, LOGIT, '[D: LB §4.3 novices -15 %]', {
    note: 'T0-T1 under pressure.',
  }),
  p('p.strike.read.hurtPenaltyMid', 0.40, LOGIT, '[D: LB §4.3]', { note: 'T2-T3.' }),
  p('p.strike.read.hurtPenaltyHigh', 0.20, LOGIT, '[D: LB §4.3 experts -5 %]', { note: 'T4-T5.' }),
  p('p.strike.read.visionBlocked', -0.40, LOGIT, '[E]'),
  p('p.strike.read.leadBaseMs', 80, MS, '[E; S: LB §4.2 50-100 ms earlier cue pickup]'),
  p('p.strike.read.leadTelegraphFrac', 0.6, 'fraction of telegraph', '[E]'),
  p('p.strike.read.patternOnBeat', 0.30, LOGIT, '[E]'),
  p('p.strike.read.patternRepeat3', 0.60, LOGIT, '[D: MTK §8.3 +0.15 p]'),
  p('p.strike.read.patternHabit', 0.40, LOGIT, '[E]'),
  p('p.strike.read.afterBite', -0.60, LOGIT, '[E]'),
  p('p.strike.read.noviceDefaultBlockP', 0.80, PROB, '[S: LB §4.4]', { min: 0, max: 1 }),

  // -------------------------------------------------------------------------
  // §2.5 counters
  // -------------------------------------------------------------------------
  p('p.strike.ctr.windowMissed', 1.0, 'x recovery', '[S: BOX §8 D14]'),
  p('p.strike.ctr.windowChecked', 1.2, 'x recovery', '[E]'),
  p('p.strike.ctr.windowBlocked', 0.6, 'x recovery', '[E]'),
  p('p.strike.ctr.windowLanded', 0.4, 'x recovery', '[E]'),
  p('p.strike.ctr.readPenaltyMissed', -0.50, LOGIT, '[E]'),
  p('p.strike.ctr.readPenaltyBlocked', -0.30, LOGIT, '[E]'),
  p('p.strike.ctr.readPenaltyLanded', -0.15, LOGIT, '[S: MTK §8.2]'),
  p('p.strike.ctr.kickMissDefence', -0.60, LOGIT, '[S: MTK §8.2 -30 %]'),
  p('p.strike.ctr.kickLandDefence', -0.20, LOGIT, '[S: MTK §8.2 -10 %]'),
  p('p.strike.ctr.handAway', 0.30, LOGIT, '[E]'),
  p('p.strike.ctr.bestBonus', 0.70, LOGIT, '[D: BOX §8 D14 +0.15 p]', { free: true }),
  p('p.strike.ctr.otherBonus', 0.24, LOGIT, '[D: BOX §8 D14 +0.05 p]', { free: true }),
  p('p.strike.ctr.skillK', 2.0, 'ratio per 100 pts', '[E]', {
    note: 'A T2 counter-puncher realises ~60 % of the table bonus, a T5 ~120 %.',
  }),
  p('p.strike.ctr.simulCancelP', 0.50, PROB, '[E]', { min: 0, max: 1 }),
  p('p.strike.ctr.simulHalve', 0.5, RATIO, '[S: BOX §8 D15]'),
  p('p.strike.ctr.preemptStraight', 0.50, LOGIT, '[E]'),
  p('p.strike.ctr.habitualN', 2, 'count', '[S: BOX §8 D17]'),
  p('p.strike.ctr.delayedBonus', 0.70, LOGIT, '[D: BOX §8 D17 +0.15 p]'),
  p('p.strike.ctr.kClose', 1.6, 's/m on v_rel', '[D: reproduces BOX §8 D16 x1.25 / x1.5]'),
  p('p.strike.ctr.stepInSpeed', 1.5, 'm/s', '[E]'),
  p('p.strike.ctr.lungeSpeed', 2.5, 'm/s', '[E]'),
  p('p.strike.ctr.hitOnBreak', 1.0, LOGIT, '[D: MIS I-12 +20-30 % p]'),
  p('p.strike.catch.escapePullBackT2', 0.35, PROB, '[S: MTK §3.1]', { min: 0, max: 1 }),
  p('p.strike.catch.escapePullBackT4', 0.55, PROB, '[S: MTK §3.1]', { min: 0, max: 1 }),
  p('p.strike.catch.escapeBeatMs', 300, MS, '[S: MTK §3.1]'),
  p('p.strike.catch.stepLimitMT', 2, 'count', '[S: MTK §3.1]'),
  p('p.strike.catch.caughtKickAbsorb', 0.4, 'fraction', '[E]'),
  p('p.strike.catch.twistSweepBonus', 0.15, PROB, '[S: MTK §3.1]'),

  // -------------------------------------------------------------------------
  // §2.6.3 placement — base weights per family
  // -------------------------------------------------------------------------
  p('p.strike.placement.base.headPunch.flush', 0.20, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.base.headPunch.solid', 0.35, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.base.headPunch.partial', 0.30, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.base.headPunch.glancing', 0.15, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.base.headElbowKnee.flush', 0.25, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.base.headElbowKnee.solid', 0.35, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.base.headElbowKnee.partial', 0.25, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.base.headElbowKnee.glancing', 0.15, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.base.headKick.flush', 0.25, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.base.headKick.solid', 0.30, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.base.headKick.partial', 0.25, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.base.headKick.glancing', 0.20, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.base.body.flush', 0.30, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.base.body.solid', 0.40, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.base.body.partial', 0.20, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.base.body.glancing', 0.10, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.base.legKick.flush', 0.45, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.base.legKick.solid', 0.35, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.base.legKick.partial', 0.15, 'weight', '[E]', {
    min: 0, max: 1, note: 'Foot or instep rather than shin.',
  }),
  p('p.strike.placement.base.legKick.glancing', 0.05, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.base.teep.flush', 0.35, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.base.teep.solid', 0.40, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.base.teep.partial', 0.20, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.base.teep.glancing', 0.05, 'weight', '[E]', { min: 0, max: 1 }),

  // §2.6.3 placement shifts and outputs
  p('p.strike.placement.unseenFlush', 1.75, RATIO, '[E]', {
    note: '05 applies its own unseen x1.35 on alphaEq — this models WHERE it lands, not neck bracing.',
  }),
  p('p.strike.placement.unseenGlancing', 0.65, RATIO, '[E]'),
  p('p.strike.placement.narrowFailGlancing', 2.5, RATIO, '[E]'),
  p('p.strike.placement.narrowFailFlush', 0.5, RATIO, '[E]'),
  p('p.strike.placement.narrowFailMargin', 0.15, PROB, '[E]'),
  p('p.strike.placement.failedEvasionFlushAdd', 0.15, 'weight', '[S: BOX §3 D4]'),
  p('p.strike.placement.blockedPartial', 0.70, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.blockedGlancing', 0.30, 'weight', '[E]', { min: 0, max: 1 }),
  p('p.strike.placement.precisionK', 0.5, 'weight per 100 pts', '[E]'),
  p('p.strike.placement.headMovementK', -0.4, 'weight per 100 pts', '[E]'),
  p('p.strike.placement.rockedFlush', 1.5, RATIO, '[E]'),
  p('p.strike.placement.multFlush', 1.00, 'x force', '[E; S: DP §3.1 cleanMult 1.0]'),
  p('p.strike.placement.multSolid', 0.75, 'x force', '[E; S: DP §3.1]'),
  p('p.strike.placement.multPartial', 0.45, 'x force', '[E; S: DP §3.1 0.5]'),
  p('p.strike.placement.multGlancing', 0.25, 'x force', '[E; S: DP §3.1 0.25]'),
  p('p.strike.placement.absorbPartialBlocked', 0.45, 'fraction', '[S: DP §3.3]'),
  p('p.strike.placement.absorbPartialRolled', 0.60, 'fraction', '[S: DP §3.3]'),
  p('p.strike.placement.absorbGlancing', 0.60, 'fraction', '[S: DP §3.3]'),

  // §2.6.3 sub-location weights (head), anchored on Hutchison's KO-location shares
  p('p.strike.placement.subHead.straights.chin', 0.25, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.straights.temple', 0.05, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.straights.midface', 0.40, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.straights.forehead', 0.20, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.straights.orbit', 0.10, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.hooks.chin', 0.35, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.hooks.temple', 0.25, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.hooks.midface', 0.20, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.hooks.forehead', 0.05, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.hooks.orbit', 0.15, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.uppercuts.chin', 0.60, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.uppercuts.temple', 0.05, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.uppercuts.midface', 0.30, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.uppercuts.forehead', 0.00, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.uppercuts.orbit', 0.05, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.elbows.chin', 0.20, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.elbows.temple', 0.25, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.elbows.midface', 0.20, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.elbows.forehead', 0.15, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.elbows.orbit', 0.20, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.headKicks.chin', 0.30, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.headKicks.temple', 0.35, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.headKicks.midface', 0.15, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.headKicks.forehead', 0.10, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.headKicks.orbit', 0.10, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.knees.chin', 0.35, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.knees.temple', 0.10, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.knees.midface', 0.40, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.knees.forehead', 0.10, 'weight', '[E; S: FD §2.1 HUT]'),
  p('p.strike.placement.subHead.knees.orbit', 0.05, 'weight', '[E; S: FD §2.1 HUT]'),

  // §2.6.3 sub-location weights (body)
  p('p.strike.placement.subBody.liver', 0.15, 'weight', '[E]'),
  p('p.strike.placement.subBody.liverTargeted', 0.60, 'weight', '[E]', {
    note: 'Liver hook, shovel hook to the liver, open-stance rear body kick.',
  }),
  p('p.strike.placement.subBody.solar', 0.20, 'weight', '[E]'),
  p('p.strike.placement.subBody.ribs', 0.45, 'weight', '[E]'),
  p('p.strike.placement.subBody.spleen', 0.10, 'weight', '[E]'),
  p('p.strike.placement.subBody.abdomen', 0.10, 'weight', '[E]'),

  // -------------------------------------------------------------------------
  // §2.6.4 force model
  // -------------------------------------------------------------------------
  p('p.strike.force.sigma', 0.30, 'ln units', '[D: chosen with the placement mix to reproduce Pierce]', {
    free: true, min: 0.1, max: 0.6,
    note: 'Pierce in-ring: median ~950 N, 88 % < 1500 N, 2-6 % >= 2000 N.',
  }),
  p('p.strike.force.tierStraight.t0', 0.50, RATIO, '[D: LA §2 Smith 2000 novice 0.50]'),
  p('p.strike.force.tierStraight.t1', 0.60, RATIO, '[D: LA §2 Smith 2000]'),
  p('p.strike.force.tierStraight.t2', 0.72, RATIO, '[D: LA §2 Smith 2000 intermediate 0.78]'),
  p('p.strike.force.tierStraight.t3', 0.85, RATIO, '[D: LA §2 Smith 2000]'),
  p('p.strike.force.tierStraight.t4', 1.00, RATIO, '[D: LA §2 Smith 2000 elite 1.0]'),
  p('p.strike.force.tierStraight.t5', 1.05, RATIO, '[D: LA §2 Smith 2000]'),
  p('p.strike.force.tierHook.t0', 0.22, RATIO, '[D: BOX §1.4 junior hooks 20-25 % of elite]'),
  p('p.strike.force.tierHook.t1', 0.35, RATIO, '[D: BOX §1.4; LA §2 Dinu 2020]'),
  p('p.strike.force.tierHook.t2', 0.55, RATIO, '[D: BOX §1.4; LA §2 Dinu 2020]'),
  p('p.strike.force.tierHook.t3', 0.78, RATIO, '[D: BOX §1.4; LA §2 Dinu 2020]'),
  p('p.strike.force.tierHook.t4', 1.00, RATIO, '[D: BOX §1.4; LA §2 Dinu 2020]'),
  p('p.strike.force.tierHook.t5', 1.05, RATIO, '[D: BOX §1.4; LA §2 Dinu 2020]'),
  p('p.strike.force.tierKick.t0', 0.50, RATIO, '[S: MTK §6 hip rotation via 01 hipRotationMult]'),
  p('p.strike.force.tierKick.t1', 0.60, RATIO, '[S: MTK §6 via 01 hipRotationMult]'),
  p('p.strike.force.tierKick.t2', 0.75, RATIO, '[S: MTK §6 via 01 hipRotationMult]'),
  p('p.strike.force.tierKick.t3', 1.00, RATIO, '[S: MTK §6 via 01 hipRotationMult]'),
  p('p.strike.force.tierKick.t4', 1.05, RATIO, '[S: MTK §6 via 01 hipRotationMult]'),
  p('p.strike.force.tierKick.t5', 1.10, RATIO, '[S: MTK §6 via 01 hipRotationMult]'),
  p('p.strike.force.powerSlope', 0.008, 'ratio per attribute pt', '[E; S: LA §2 Loturco r 0.67-0.85]'),
  p('p.strike.force.powerMixExplosiveness', 0.6, 'weight', '[E]'),
  p('p.strike.force.powerMixStrength', 0.4, 'weight', '[E]'),
  p('p.strike.force.massExpPunch', 0.5, 'exponent', '[E; S: LA §0 in-ring force vs mass r 0.22]', {
    note: 'Deliberately weak: Pierce found in-ring punch force essentially uncorrelated with mass.',
  }),
  p('p.strike.force.massExpKick', 0.8, 'exponent', '[E]'),
  p('p.strike.force.fatigueStraight', 0.28, 'ratio per f', '[D: DP §4.3 power -12 % at f 0.5, -25 % at 0.8]'),
  p('p.strike.force.fatigueRotational', 0.40, 'ratio per f', '[D: LA §2 Dunn 2022 ~2x the jab decrement]'),
  p('p.strike.force.rearHandFatigue', 1.2, RATIO, '[S: BOX §8 F25]'),
  p('p.strike.force.speedBase', 0.85, RATIO, '[E]'),
  p('p.strike.force.speedSlope', 0.003, 'ratio per attribute pt', '[E]'),
  p('p.strike.force.speedFatigue', 0.18, 'ratio per f', '[D: DP §4.3 hand speed -8 / -18 %]'),
  p('p.strike.force.commitRetreat', 0.70, RATIO, '[E; S: LA §2 Lenetsky effective mass]'),
  p('p.strike.force.commitArmPunch', 0.60, RATIO, '[E]', { note: 'T0 default; T1 half the time.' }),
  p('p.strike.force.commitTouch', 0.50, RATIO, '[E]'),
  p('p.strike.force.commitInstep', 0.70, RATIO, '[E; S: MTK §2 "kicking with the foot is a T0/T1 tell"]'),
  p('p.strike.force.capOvershoot', 1.15, 'x F_cap', '[E]'),
  p('p.strike.force.referenceMassKg', 77, 'kg', '[S: LB §6 UFC pooled]', {
    note: 'The m_eff and massMult reference fighter.',
  }),

  // -------------------------------------------------------------------------
  // §2.6.1 the two-stage landing model
  // -------------------------------------------------------------------------
  p('p.strike.pa.clampMin', 0.05, PROB, '[E]', { min: 0, max: 1 }),
  p('p.strike.pa.clampMax', 0.97, PROB, '[E]', { min: 0, max: 1 }),
  p('p.strike.pa.refRead', 0.81, PROB, '[D: 01 readP_dom at T4]', {
    free: true, min: 0.5, max: 0.95,
    note: 'The reference defender\'s read rate in the pA solve. §5 step 1 re-solves pA against it.',
  }),
  p('p.strike.arrival.kSkillPunch', 2.0, 'logit per 100 pts', '[E; anchored BOX §8 A3]', { free: true }),
  p('p.strike.arrival.kSkillKick', 2.5, 'logit per 100 pts', '[E; anchored BOX §8 A3]', { free: true }),
  p('p.strike.arrival.attackerFatigue', -0.35, 'logit per f', '[D: DP §4.3 accuracy -8 % at f 0.5]'),
  p('p.strike.arrival.defenderFatigue', 0.45, 'logit per f', '[D: DP §4.3 head movement -20 / -45 %]'),
  p('p.strike.arrival.defenderRocked', 0.80, LOGIT, '[D: DP §2.1 defence -35 %]'),
  p('p.strike.arrival.defenderStunned', 0.30, LOGIT, '[D: DP §2.1 -10 %]'),
  p('p.strike.arrival.defenderBodyHurt', 0.50, LOGIT, '[D: DP §2.1 head exposure +30 %]'),
  p('p.strike.arrival.attackerRocked', -0.60, LOGIT, '[D: DP §2.1 accuracy -25 %]'),
  p('p.strike.arrival.defenderLegDamage', 0.25, LOGIT, '[E]', {
    note: 'Scaled by (1 - mobility): a hurt leg cannot move out of range.',
  }),
  p('p.strike.arrival.defenderRePlanting', 0.50, LOGIT, '[S: MTK §8.13]'),
  p('p.strike.arrival.defenderMidSwitch', 0.45, LOGIT, '[S: MTK §2 K4 visible tell]'),
  p('p.strike.arrival.defenderBackTurned', 0.60, LOGIT, '[E]'),
  p('p.strike.arrival.attackerFeetCrossed', -0.50, LOGIT, '[E]'),
  p('p.strike.arrival.guardHandAway', 0.30, LOGIT, '[E]'),
  p('p.strike.arrival.defenderVisionBlocked', 0.30, LOGIT, '[E]'),
  p('p.strike.arrival.attackerEyesClosed', -0.60, LOGIT, '[E; S: BOX §6]'),

  // -------------------------------------------------------------------------
  // §2.8 reach exploitation
  // -------------------------------------------------------------------------
  p('p.strike.reach.perTenCm', 0.12, 'logit per 10 cm', '[E; calibrated to FD #116]', {
    free: true, min: 0, max: 0.4,
    note: 'Set small on purpose: peer-reviewed data say the reach effect is ~0 outside heavyweight.',
  }),
  p('p.strike.reach.classScaleLight', 0.7, RATIO, '[E; S: FD §4 ~0 at BW/FLW]'),
  p('p.strike.reach.classScaleMiddle', 1.0, RATIO, '[E]'),
  p('p.strike.reach.classScaleHeavy', 1.5, RATIO, '[E; S: LB §2.3 Kirk 2018 HW +1.5 sig per cm]'),
  p('p.strike.reach.cap', 20, 'cm', '[E]'),
  p('p.strike.reach.closePenalty', -0.05, 'logit per 10 cm', '[E]', {
    note: 'The longer fighter is cramped at range.close.',
  }),
  p('p.strike.reach.weightThreshold', 5, 'cm', '[S: MIS R-1]'),

  // -------------------------------------------------------------------------
  // §2.7 stance matchup and familiarity
  // -------------------------------------------------------------------------
  p('p.strike.stance.closed.jab', 0.18, LOGIT, '[D: MIS ST-2 x1.2]'),
  p('p.strike.stance.open.jab', -0.30, LOGIT, '[D: MIS ST-7 x0.75 — the lead hands collide]'),
  p('p.strike.stance.closed.rearStraight', 0, LOGIT, '[D: MIS ST-3]'),
  p('p.strike.stance.open.rearStraight', 0.34, LOGIT, '[D: MIS ST-3 x1.4 — a lane down the middle]'),
  p('p.strike.stance.closed.leadHook', 0.10, LOGIT, '[D: MIS ST-3; BOX §8 G29]'),
  p('p.strike.stance.open.leadHook', 0.10, LOGIT, '[D: MIS ST-7 — needs the dominant angle]'),
  p('p.strike.stance.closed.rearBodyKick', -0.10, LOGIT, '[D: MIS ST-3 lands on the closed side]'),
  p('p.strike.stance.open.rearBodyKick', 0.34, LOGIT, '[D: MIS ST-7 — the liver is exposed]'),
  p('p.strike.stance.closed.rearLowKick', 0.10, LOGIT, '[S: MIS ST-7]'),
  p('p.strike.stance.open.rearLowKick', 0, LOGIT, '[S: MIS ST-7]'),
  p('p.strike.stance.closed.leadLegLowKick', 0, LOGIT, '[S: MIS ST-6]'),
  p('p.strike.stance.open.leadLegLowKick', 0.26, LOGIT, '[D: MIS ST-6 ln 1.3]'),
  p('p.strike.stance.closed.shoulderRoll', 0, LOGIT, '[S: BOX §8 G29]'),
  p('p.strike.stance.open.shoulderRoll', -0.85, LOGIT, '[D: BOX §8 G29 -0.20 p]'),
  p('p.strike.stance.closed.parryCrossCounter', 0, LOGIT, '[S: MIS ST-2]'),
  p('p.strike.stance.open.parryCrossCounter', 0.34, LOGIT, '[D: MIS ST-2 x1.4]'),
  p('p.strike.stance.familiarityThreshold', 0.5, '0-1', '[E]', {
    note: '01 stanceFamiliarity = 1 - exp(-bouts/4); 0.5 is roughly < 3 bouts.',
  }),
  p('p.strike.stance.famLatency', 1.10, RATIO, '[S: MIS ST-5 +10 % RT]'),
  p('p.strike.stance.famCounter', -0.15, LOGIT, '[D: MIS ST-5 -10 % counter]'),
  p('p.strike.stance.famWrongWay', 0.15, PROB, '[S: MIS ST-5 15 % footwork errors]', { min: 0, max: 1 }),
  p('p.strike.stance.nonSwitchPenalty', -0.40, LOGIT, '[E]'),
  p('p.strike.stance.nonSwitchTelegraph', 1.5, RATIO, '[E]'),
  p('p.strike.stance.switchedAccuracy', -0.40, LOGIT, '[D: MTK §8.8 -0.10 p]'),
  p('p.strike.stance.switchedTdVuln', 0.40, LOGIT, '[D: MTK §8.8 +0.10 p]'),
  p('p.strike.stance.switchTriggerHits', 3, 'count', '[S: MIS ST-8]'),
  p('p.strike.stance.switchTriggerWindowS', 30, 's', '[S: MIS ST-8]'),

  // -------------------------------------------------------------------------
  // §3 tier tables
  // -------------------------------------------------------------------------
  p('p.strike.tier.execMultKick.t0', 1.67, RATIO, '[D: 01 §2.7 execTimeMult / 0.90]'),
  p('p.strike.tier.execMultKick.t1', 1.56, RATIO, '[D: 01 §2.7]'),
  p('p.strike.tier.execMultKick.t2', 1.39, RATIO, '[D: 01 §2.7]'),
  p('p.strike.tier.execMultKick.t3', 1.11, RATIO, '[D: 01 §2.7]'),
  p('p.strike.tier.execMultKick.t4', 1.00, RATIO, '[D: 01 §2.7]'),
  p('p.strike.tier.execMultKick.t5', 0.94, RATIO, '[D: 01 §2.7]'),
  p('p.strike.tier.execMultPunch.t0', 1.32, RATIO, '[D: 01 §2.7 (0.5 + 0.5 x execTimeMult) / 0.95]'),
  p('p.strike.tier.execMultPunch.t1', 1.26, RATIO, '[D: 01 §2.7]'),
  p('p.strike.tier.execMultPunch.t2', 1.18, RATIO, '[D: 01 §2.7]'),
  p('p.strike.tier.execMultPunch.t3', 1.05, RATIO, '[D: 01 §2.7]'),
  p('p.strike.tier.execMultPunch.t4', 1.00, RATIO, '[D: 01 §2.7]'),
  p('p.strike.tier.execMultPunch.t5', 0.97, RATIO, '[D: 01 §2.7]'),
  p('p.strike.tier.telegraphAdd.t0', 150, MS, '[D: 01 §2.7 telegraphMod x 600]'),
  p('p.strike.tier.telegraphAdd.t1', 120, MS, '[D: 01 §2.7]'),
  p('p.strike.tier.telegraphAdd.t2', 90, MS, '[D: 01 §2.7]'),
  p('p.strike.tier.telegraphAdd.t3', 0, MS, '[D: 01 §2.7]'),
  p('p.strike.tier.telegraphAdd.t4', -30, MS, '[D: 01 §2.7]'),
  p('p.strike.tier.telegraphAdd.t5', -60, MS, '[D: 01 §2.7]'),
  p('p.strike.tier.feintRate.t0', 0, 'per strike', '[E]', { min: 0, max: 2 }),
  p('p.strike.tier.feintRate.t1', 0.05, 'per strike', '[E]', { min: 0, max: 2 }),
  p('p.strike.tier.feintRate.t2', 0.15, 'per strike', '[E]', { min: 0, max: 2 }),
  p('p.strike.tier.feintRate.t3', 0.30, 'per strike', '[E]', { min: 0, max: 2 }),
  p('p.strike.tier.feintRate.t4', 0.50, 'per strike', '[E]', { min: 0, max: 2 }),
  p('p.strike.tier.feintRate.t5', 0.70, 'per strike', '[E]', { min: 0, max: 2 }),
  p('p.strike.tier.checkRate.t0', 0.10, PROB, '[S: MTK §6 via 01 beh.mt.check_rate]', { min: 0, max: 1 }),
  p('p.strike.tier.checkRate.t1', 0.10, PROB, '[S: MTK §6]', { min: 0, max: 1 }),
  p('p.strike.tier.checkRate.t2', 0.25, PROB, '[S: MTK §6]', { min: 0, max: 1 }),
  p('p.strike.tier.checkRate.t3', 0.50, PROB, '[S: MTK §6]', { min: 0, max: 1 }),
  p('p.strike.tier.checkRate.t4', 0.60, PROB, '[S: MTK §6]', { min: 0, max: 1 }),
  p('p.strike.tier.checkRate.t5', 0.70, PROB, '[S: MTK §6]', { min: 0, max: 1 }),
  p('p.strike.tier.stumbleMiss.t0', 0.35, PROB, '[S: MTK §6 via 01 beh.mt.balance_after_kick]', { min: 0, max: 1 }),
  p('p.strike.tier.stumbleMiss.t1', 0.35, PROB, '[S: MTK §6]', { min: 0, max: 1 }),
  p('p.strike.tier.stumbleMiss.t2', 0.15, PROB, '[S: MTK §6]', { min: 0, max: 1 }),
  p('p.strike.tier.stumbleMiss.t3', 0.05, PROB, '[S: MTK §6]', { min: 0, max: 1 }),
  p('p.strike.tier.stumbleMiss.t4', 0.03, PROB, '[S: MTK §6]', { min: 0, max: 1 }),
  p('p.strike.tier.stumbleMiss.t5', 0.02, PROB, '[S: MTK §6]', { min: 0, max: 1 }),
  p('p.strike.tier.stumbleChecked.t0', 0.45, PROB, '[S: MTK §6]', { min: 0, max: 1 }),
  p('p.strike.tier.stumbleChecked.t1', 0.45, PROB, '[S: MTK §6]', { min: 0, max: 1 }),
  p('p.strike.tier.stumbleChecked.t2', 0.25, PROB, '[S: MTK §6]', { min: 0, max: 1 }),
  p('p.strike.tier.stumbleChecked.t3', 0.10, PROB, '[S: MTK §6]', { min: 0, max: 1 }),
  p('p.strike.tier.stumbleChecked.t4', 0.06, PROB, '[S: MTK §6]', { min: 0, max: 1 }),
  p('p.strike.tier.stumbleChecked.t5', 0.04, PROB, '[S: MTK §6]', { min: 0, max: 1 }),
  p('p.strike.tier.noReturnWindow.t0', 2.0, 'x counter window', '[S: MTK §6]'),
  p('p.strike.tier.noReturnWindow.t1', 1.5, 'x counter window', '[S: MTK §6]'),
  p('p.strike.tier.overcommit.t0', 1.5, 'x balance cost', '[E]'),
  p('p.strike.tier.overcommit.t1', 1.3, 'x balance cost', '[E]'),
  p('p.strike.tier.fatigueTellF.t0', 0.60, '0-1', '[S: BOX §8 F26]', { min: 0, max: 1 }),
  p('p.strike.tier.fatigueTellF.t1', 0.75, '0-1', '[S: BOX §8 F26]', { min: 0, max: 1 }),

  // -------------------------------------------------------------------------
  // §3 novice tells
  // -------------------------------------------------------------------------
  p('p.strike.tell.eyesClosed', -0.60, LOGIT, '[E]', {
    note: 'T0 against a power strike: the read fails and only def.flinch is left.',
  }),
  p('p.strike.tell.chinUp', 0.30, LOGIT, '[E; S: BOX §8 F26 +0.10 p]'),
  p('p.strike.tell.turnAwayTriggerHits', 2, 'count', '[E]'),
  p('p.strike.tell.turnAwayTriggerS', 3, 's', '[E]'),
  p('p.strike.tell.turnAwayMs', 500, MS, '[E]'),
  p('p.strike.tell.instepFootInjury', 3, 'x 05 roll', '[E]'),
  p('p.strike.tell.squareLowKick', 0.30, LOGIT, '[E]'),
  p('p.strike.tell.burstOutput', 1.3, RATIO, '[E]'),
  p('p.strike.tell.burstOutputS', 60, 's', '[E]'),

  // -------------------------------------------------------------------------
  // §2.2.4 technique-specific effects
  // -------------------------------------------------------------------------
  p('p.strike.effect.teepPushLead', 0.70, PROB, '[E; S: MTK §8.10]', { min: 0, max: 1 }),
  p('p.strike.effect.teepPushRear', 0.85, PROB, '[E; S: MTK §8.10]', { min: 0, max: 1 }),
  p('p.strike.effect.teepBalanceLead', -5, 'balance pts', '[E]'),
  p('p.strike.effect.teepBalanceRear', -10, 'balance pts', '[E]'),
  p('p.strike.effect.stopKickBalance', -10, 'balance pts', '[E; S: MTK §8.11]'),
  p('p.strike.effect.flickerVisionMs', 300, MS, '[E; S: BOX §2 #5]'),
  p('p.strike.effect.qmSetupKicks', 2, 'count', '[S: MTK §2 K6]'),
  p('p.strike.effect.switchTellBonus', 0.45, LOGIT, '[E; S: MTK §2 K4]'),
  p('p.strike.effect.spinBackBonus', 0.60, LOGIT, '[E; S: MTK E5/S1]'),
  p('p.strike.effect.checkedShinFrac', 0.60, 'fraction of raw', '[S: DP §2.3 attacker takes 60 %]'),
  p('p.strike.effect.checkedDefenderAbsorb', 0.85, 'fraction', '[D: MTK §8.12 0-20 % taken]'),
  p('p.strike.effect.kneeBlockSelfFrac', 0.40, 'fraction of raw', '[S: MTK §3]'),
  p('p.strike.effect.singleLegWindowMs', 250, MS, '[S: MTK §8.12]', {
    note: 'After a check the kicker is on one leg: punch +0.50, takedown +0.65 (03).',
  }),

  // -------------------------------------------------------------------------
  // §2.6.1 stat counting
  // -------------------------------------------------------------------------
  p('p.strike.stat.blockedCountsLandedP', 0.30, PROB, '[E]', {
    min: 0, max: 1,
    note: 'Blocked strikes that move the head count as landed-partial. Exposed as a probability, '
      + 'never as an extra RNG draw (09 §2.7 fixes the per-contact draw layout at six).',
  }),
  p('p.strike.stat.checkedCountsLanded', 1, 'boolean', '[E interpretation of FD #17]', {
    note: 'If this interpretation is wrong, kick P_land must drop to ~0.60 and checks become misses.',
  }),
];
