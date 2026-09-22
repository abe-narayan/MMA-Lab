/**
 * STYLE-MATCHUP RULES — chapter 07 §2.5.5 (S / W / WB / P / SH).
 *
 * Striker vs grappler, wrestler vs BJJ, pressure vs counter, volume vs power.
 * Like the physical rules these are *selection* weights and policies only: the
 * evidence base for pressure vs counter is coaching consensus rather than a
 * head-to-head study `[S: LIT_B §7 pt 6]`, so every number here is a
 * calibration tunable under Assumption A-1.
 *
 * Gated at iqTier >= 2. A T1 camp knows "he's a wrestler" and picks a mode
 * from it, but does not get the matchup weight set (§2.5.8).
 */
import type { ActionWeightPatch, PlanRuleHit } from '../contracts';
import { bandTier } from '../scout';
import type { PlanContext } from './context';

const hit = (
  id: string, label: string, tag: string,
  weights: ActionWeightPatch, policy?: PlanRuleHit['policy'],
): PlanRuleHit => ({ id, kind: 'style', label, weights, policy, tag });

export function styleRules(ctx: PlanContext): PlanRuleHit[] {
  const out: PlanRuleHit[] = [];
  if (ctx.iqTier < 2) return out;

  const self = ctx.self;
  const opp = ctx.opp;
  const selfTdD = bandTier(self.skills.tdDefence);
  const selfTdO = bandTier(self.skills.tdOffence);
  const oppTdO = bandTier(opp.skills.tdOffence);
  const oppTdD = bandTier(opp.skills.tdDefence);

  // ---- S: striker facing a better wrestler --------------------------------
  const strikerVsWrestler = self.style.striker && oppTdO - selfTdD >= 1;
  if (strikerVsWrestler && ctx.rules.takedownsAllowed) {
    out.push(hit(
      'S-1', 'He wants the takedown: long range, teep and jab, and nothing with the rear leg.',
      '[S: MMA_INTEGRATION §3.1 S-1 (est.)]',
      {
        teep: 1.4, jab: 1.4, rearKick: 0.4, headKick: 0.6, leadLowKick: 0.8,
        uppercut: 1.8, knee: 1.8,
      },
      { rangeTarget: 'long', mustNots: ['mn.rear_kick_mid_range', 'mn.kick_the_wrestler'] },
    ));
    out.push(hit(
      'S-2', 'Off the fence: circle away the moment your back gets near it.',
      '[S: MMA_INTEGRATION §3.1 S-2 (est.)]',
      { circleAway: 1.5 },
      { cagePolicy: 'circleAway' },
    ));
    const bjjEdge = self.tiers.bjj >= opp.tiers.bjj + 1;
    out.push(hit(
      'S-3', 'If he gets you down: get straight back up, do not play guard.',
      '[S: MMA_INTEGRATION §3.1 S-3 (est.)]',
      { standUp: 2.0, wallWalk: 2.0, bottomSubmission: bjjEdge ? 1.0 : 0.5 },
      { groundBottomPolicy: 'standUpFirst' },
    ));
    out.push(hit(
      'S-4', 'Three strikes maximum at level-change range; keep the weight back.',
      '[S: MMA_INTEGRATION §3.1 S-4, §10 rule 8 (est.)]',
      { sprawl: 1.4 },
      { comboCapMax: 3, weightBack: true },
    ));
    if (ctx.rules.clinchAllowed) {
      out.push(hit(
        'S-5', 'Break the clinch immediately, and hit him on the way out.',
        '[S: MMA_INTEGRATION §3.1 S-5, §2.2 I-12 (est.)]',
        { breakClinch: 1.8 },
        { clinchPolicy: 'break' },
      ));
    }
  }

  // ---- W: the wrestler ----------------------------------------------------
  if (self.style.wrestler && ctx.rules.takedownsAllowed) {
    out.push(hit(
      'W-1', 'No naked shots: every entry comes off a strike.',
      '[S: MMA_INTEGRATION §3.1 W-1 (est.)]',
      { nakedShot: 0.4, shootOffStrikes: 1.2 },
      { tdPolicy: 'offStrikes', mustNots: ['mn.naked_shot'] },
    ));
    out.push(hit(
      'W-2', 'Cut the cage and take him on the fence.',
      '[S: MMA_INTEGRATION §3.1 W-2 (est.)]',
      { advance: 1.5, clinchEntry: 1.8, shoot: 1.4, cagePin: 1.3 },
      { cagePolicy: 'cut' },
    ));
    if (ctx.rules.groundFightingAllowed) {
      out.push(hit(
        'W-3', 'On top: strike to pass, and bank the control minutes.',
        '[S: MMA_INTEGRATION §3.1 W-3], [S: FIGHT_DATA #84]',
        { groundStrike: 1.3, pass: 1.4, ride: 1.2 },
        { groundTopPolicy: 'gnp', controlGapTargetS: 180 },
      ));
    }
    out.push(hit(
      'W-4', 'Two stuffed shots in a row: sixty seconds of clinch and cage chains before you shoot again.',
      '[S: MMA_INTEGRATION §3.1 W-4 (est.)]', {},
    ));
    out.push(hit(
      'W-5', 'Front-load the takedowns: more in round one, fewer in round three unless behind.',
      '[S: MMA_INTEGRATION §3.1 W-5]', {},
      { r1TdMult: 1.2, r3TdMult: 0.9 },
    ));
  }

  // ---- WB: wrestler vs BJJ ------------------------------------------------
  if (self.style.wrestler && opp.tiers.bjj >= self.tiers.bjj + 1) {
    out.push(hit(
      'WB-1', 'His guard is better than your passing: ride and strike, never dive in.',
      '[S: MMA_INTEGRATION §3.2 WB-1 (est.)]',
      { submission: 0.3, pass: 0.9, ride: 1.3, groundStrike: 1.2 },
      { groundTopPolicy: 'passByStrikes', mustNots: ['mn.engage_guard'] },
    ));
    out.push(hit(
      'WB-2', 'If he pulls guard, stand him up or hit him from posture; do not pass at all costs.',
      '[S: MMA_INTEGRATION §3.2 WB-2]',
      { standUp: 1.4 },
      { groundTopPolicy: 'standAndReset' },
    ));
  }

  // ---- WB: the BJJ player -------------------------------------------------
  if (self.style.bjjPlayer) {
    if (opp.style.wrestler && ctx.rules.groundFightingAllowed) {
      out.push(hit(
        'WB-3', 'Taken down by a wrestler: sweep him when he strikes, attack when his posture breaks.',
        '[S: MMA_INTEGRATION §3.2 WB-3 (est.)]',
        { sweep: 1.6, bottomSubmission: 1.4, wallWalk: 0.8 },
        { groundBottomPolicy: 'sweep' },
      ));
    }
    const outwrestled = self.tiers.wrestling < opp.tiers.wrestling - 1;
    out.push(hit(
      'WB-4', outwrestled
        ? 'You will not out-wrestle him: accept the clinch and take it down from there.'
        : 'Strike at range and hunt the front headlock and the back when he shoots.',
      '[S: MMA_INTEGRATION §3.2 WB-4 (est.)], [S: LIT_B §5.11]',
      outwrestled
        ? { clinchEntry: 1.3, trip: 1.3, guardPull: ctx.rules.groundFightingAllowed ? 1.2 : 0.4 }
        : { frontHeadlock: 1.4, backTake: 1.5 },
      outwrestled ? { clinchPolicy: 'accept' } : undefined,
    ));
  }

  // ---- P: pressure vs counter --------------------------------------------
  if (self.style.pressure) {
    out.push(hit(
      'P-1', 'Cut the cage: steer to where he is going, not to where he is.',
      '[S: MMA_INTEGRATION §3.3 P-1]',
      { advance: 1.5 },
      { cagePolicy: 'cut', initiative: 'lead' },
    ));
    out.push(hit(
      'P-2', 'Feints first, angles second, centre-line third.',
      '[S: MMA_INTEGRATION §3.3 P-2 (est.)]',
      { feint: 1.5 },
    ));
    out.push(hit(
      'P-3', 'With his back on the fence: one more strike in the combination, and go to the body.',
      '[S: MMA_INTEGRATION §3.3 P-3 (est.)]',
      { bodyHook: 1.4, bodyKick: 1.4, clinchEntry: 1.3 },
      { comboCapDelta: 1 },
    ));
  }
  if (self.style.counter) {
    out.push(hit(
      'P-4', 'Make him lead: circle, give him nothing, and take the counter window.',
      '[S: MMA_INTEGRATION §3.3 P-4 (est.)]',
      { retreat: 1.4, circle: 1.4, leadStrike: 0.7, counterWindow: 1.8, pivot: 1.3 },
      { initiative: 'counter' },
    ));
    out.push(hit(
      'P-5', 'Three exchanges on the fence and you lead for twenty seconds to take the centre back.',
      '[S: MMA_INTEGRATION §3.3 P-5 (est.)]', {},
    ));
  }
  out.push(hit(
    'P-6', 'Pressure without landing wins nothing: the pace target counts landed strikes, not thrown.',
    '[S: MMA_INTEGRATION §3.3 P-6]', {},
  ));

  // ---- SH: the submission hunter -----------------------------------------
  if (self.style.bjjPlayer && ctx.rules.submissionsAllowed
      && self.skills.subAttack >= 55 && self.skills.subAttack >= opp.skills.subDefence) {
    const guardPullOk = bandTier(opp.skills.bjjTop) <= bandTier(self.skills.bjjBottom) - 1;
    out.push(hit(
      'SH-1', 'Entries in order: front headlock on his shot, then the clinch trip, and the guard pull only if he cannot punish it.',
      '[E] from WB-4 and [S: BJJ_POSITIONS §6]',
      {
        frontHeadlock: 1.5, trip: 1.3, backTake: 1.4,
        guardPull: guardPullOk && ctx.rules.groundFightingAllowed ? 1.2 : 0.3,
      },
      { phaseTarget: 'groundTop' },
    ));
  }

  // The wrestler/BJJ rules assume a ruleset where the ground exists. In a
  // striking ruleset the generator strips these families anyway, but the
  // rationale should say why the plan looks purely stand-up.
  if (!ctx.rules.takedownsAllowed) {
    out.push(hit(
      'S-0', 'No takedowns in this ruleset: the matchup is decided standing.',
      '[S: 06 ruleset]', {},
      { tdPolicy: 'never' },
    ));
  }

  return out;
}
