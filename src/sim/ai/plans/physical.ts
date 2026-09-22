/**
 * PHYSICAL-ADVANTAGE RULES — chapter 07 §2.5.4 (R / H / F / C / PV / VP / AG / L).
 *
 * ===========================================================================
 *  BINDING RESEARCH CONSTRAINT — DO NOT "FIX" THIS INTO A WIN-RATE BONUS.
 *
 *  Reach and height do **not** move win probability once fighters are
 *  weight-matched: stature is null with BF01 = 7 and armspan is trivial except
 *  at heavyweight `[S: LIT_B §2.4]`; a reach advantage shifts the *finishing
 *  punch* toward straights rather than the chance of winning
 *  `[S: LIT_B §2.5]`; the whole-population target is a 51.7 % win rate for the
 *  longer fighter `[S: FIGHT_DATA #116]`, i.e. almost nothing.
 *
 *  Every rule below is therefore a **weight multiplier on action selection**:
 *  it changes the technique mix and where the fight happens, never the odds.
 *  Nothing in this file may add hit chance, damage, or a win-probability term.
 *  Reach's one legitimate hit-chance effect lives in chapter 02 and applies at
 *  long/mid range only (rule R-5), which is why R-5 appears here as a note
 *  with no weights at all.
 *
 *  If a calibration run shows the long-reach fighter winning too much, the bug
 *  is in §02's range model or in the mode-fitness table, not here.
 * ===========================================================================
 */
import type { ActionWeightPatch, PlanRuleHit } from '../contracts';
import type { PlanContext } from './context';

/** `ai.rule.R1` … `ai.rule.L1` thresholds, mirrored in params/multi.params.ts. */
export const REACH_EDGE_CM = 5;
export const MASS_EDGE_PCT = 3;
export const AGE_VETERAN_YEARS = 34;
export const LAYOFF_COMPROMISED_DAYS = 210;

const hit = (
  id: string, label: string, tag: string,
  weights: ActionWeightPatch, policy?: PlanRuleHit['policy'],
): PlanRuleHit => ({ id, kind: 'physical', label, weights, policy, tag });

/**
 * Every physical rule that fires for this matchup, in table order.
 *
 * Gated at iqTier >= 1: a T0 fighter has no plan at all, but a T1 fighter does
 * see the obvious physical facts ("he's taller, he's a wrestler") — that is
 * exactly what §2.5.8 gives T1.
 */
export function physicalRules(ctx: PlanContext): PlanRuleHit[] {
  const out: PlanRuleHit[] = [];
  if (ctx.iqTier < 1) return out;

  const d = ctx.delta;
  const longer = d.reachCm >= REACH_EDGE_CM;
  const shorter = d.reachCm <= -REACH_EDGE_CM;

  // ---- R: reach -----------------------------------------------------------
  if (longer) {
    // R-1: fight at the end of the jab. Selection only — the reach hit-chance
    // term is §02's and is range-gated (R-5).
    out.push(hit(
      'R-1', 'Keep it long: jab, teep, and circle away from the pressure.',
      '[S: MMA_INTEGRATION §4.1 R-1 (est.)]',
      {
        jab: 1.6,
        teep: 1.5,
        cross: 1.3,
        hook: 0.8,
        // The opponent has to come through the jab to get inside, so the
        // circle-away weight is highest against a pressure fighter; against a
        // passive opponent it still beats standing square.
        circleAway: ctx.opp.style.pressure ? 1.4 : 1.2,
        clinchEntry: 0.6,
        longGuard: 1.1,
      },
      { rangeTarget: 'long', longGuard: true },
    ));
    // R-2: when he does get inside, reset rather than trade hooks.
    out.push(hit(
      'R-2', 'If he gets inside: retreat behind the jab, pivot, re-establish range.',
      '[S: MMA_INTEGRATION §4.1 R-2 (est.)]',
      { retreat: 1.5, pivot: 1.5, hook: 0.5 },
    ));
  }

  if (shorter) {
    // R-3: never stand at the end of the jab.
    out.push(hit(
      'R-3', 'Get inside: feint, level change, body work, and take the clinch.',
      '[S: MMA_INTEGRATION §4.1 R-3 (est.)]',
      {
        feint: 1.5,
        slipEntry: 1.6,
        levelChange: 1.6,
        bodyHook: 1.4,
        uppercut: 1.4,
        leadLowKick: 1.3,
        clinchEntry: 1.3,
        shootOffStrikes: 1.2,
        lateral: 1.3,
      },
      { rangeTarget: 'short', mustNots: ['mn.stand_at_range'] },
    ));
    if (ctx.opp.style.usesLongGuard) {
      out.push(hit(
        'R-3b', 'He hides behind the long guard: parry it down and step in with the cross.',
        '[S: MMA_INTEGRATION §5.1 ST-2 (est.)] applied to the long-guard case [E]',
        { parryCross: 1.4 },
        { cagePolicy: 'cut' },
      ));
    }
    if (ctx.iqTier >= 3) {
      out.push(hit(
        'R-4', 'Draw the lead: half-step back, then step in with the cross.',
        '[S: MMA_INTEGRATION §4.1 R-4 (est.)]',
        { baitCross: 1.5 },
      ));
    }
  }

  // R-5 is a scope statement, not a weight. It is recorded so the game-plan
  // panel (and anyone reading a rationale dump) sees that reach is doing
  // nothing outside long/mid range.
  if (longer || shorter) {
    out.push(hit(
      'R-5', 'Reach only counts at long and mid range; it is worth nothing in the clinch or on the ground.',
      '[S: MMA_INTEGRATION §4.1 R-5]', {},
    ));
  }

  // R-6: height without reach is a clinch fact, not a striking one.
  if (Math.abs(d.heightCm) >= 5 && Math.abs(d.reachCm) < REACH_EDGE_CM) {
    out.push(hit(
      'R-6', d.heightCm > 0
        ? 'Taller but not longer: the edge is in the clinch, not on the outside.'
        : 'Shorter but not shorter-armed: no striking change, expect to be leaned on.',
      '[S: MMA_INTEGRATION §4.1 R-6 (est.)]', {},
    ));
  }

  // ---- H: mass and strength ----------------------------------------------
  if (d.massPct >= MASS_EDGE_PCT) {
    out.push(hit(
      'H-1', 'Heavier on the night: lean on him, the clinch and the takedown finish carry the edge.',
      '[S: MMA_INTEGRATION §4.2 H-1 (est.)], [S: LIT_B §6] (cap +/-5 pp)', {},
    ));
  }
  if (d.strengthTier >= 1) {
    out.push(hit(
      'H-2', 'Stronger: take the clinch, pin him on the fence, body-lock him down.',
      '[S: MMA_INTEGRATION §4.2 H-2 (est.)]',
      { clinchEntry: 1.4, cagePin: 1.5, bodylockTd: 1.3 },
      { clinchPolicy: 'seek' },
    ));
    out.push(hit(
      'H-3', 'Wear-down pacing: slow first round, a minute of clinch per round, press him late.',
      '[S: MMA_INTEGRATION §4.2 H-3 (est.)]',
      {},
      { r1PaceMult: 0.9, clinchTimeTargetS: 60 },
    ));
  }

  // ---- F: speed -----------------------------------------------------------
  if (d.speedTier >= 1) {
    out.push(hit(
      'F-1', 'Faster: in and out, angles, high pace, and never stay in the pocket.',
      '[S: MMA_INTEGRATION §4.3 F-1 (est.)]',
      { inOut: 1.5, circle: 1.4, breakClinch: 1.8 },
      { paceMult: 1.3, pocketDwellS: 1.0 },
    ));
    if (d.massPct <= -MASS_EDGE_PCT || d.strengthTier <= -1) {
      out.push(hit(
        'F-2', 'Do not let the bigger man hold you: break inside three seconds, wall-walk off the fence.',
        '[S: MMA_INTEGRATION §4.3 F-2 (est.)]',
        { wallWalk: 2.0 },
        { clinchPolicy: 'break', clinchDwellS: 3.0 },
      ));
    }
  }

  // ---- C: cardio ----------------------------------------------------------
  if (d.cardioTier >= 1) {
    out.push(hit(
      'C-1', 'Better gas tank: force the pace and the scrambles early, press from round two.',
      '[S: MMA_INTEGRATION §4.4 C-1 (est.)]; late edge is volume and control, not finishes [S: FIGHT_DATA #125]',
      { advance: 1.3 },
      { r1PaceMult: 1.2, r1TdMult: 1.2 },
    ));
  } else if (d.cardioTier <= -1) {
    out.push(hit(
      'C-2', 'Economy: fewer, heavier shots; no naked shots; stay out of scrambles.',
      '[S: MMA_INTEGRATION §4.4 C-2 (est.)]',
      { overhand: 1.2, cross: 1.2, nakedShot: 0.3, shoot: 0.7, clinchEntry: 0.7 },
      { paceMult: 0.8 },
    ));
  }

  // ---- power vs volume ----------------------------------------------------
  if (d.powerTier >= 1 && ctx.opp.style.volume) {
    out.push(hit(
      'P-V', 'He throws, you hurt: feint him into the counter and make the single shots count.',
      '[S: MMA_INTEGRATION §3.4 V-3, V-4 (est.)], [S: FIGHT_DATA #125]',
      { feint: 1.4, counterWindow: 1.5, overhand: 1.3, cross: 1.3, bodyHook: 1.2 },
      { comboCapMax: 3, r1PaceMult: 0.8 },
    ));
  }
  // ---- volume vs power ----------------------------------------------------
  if (ctx.self.style.volume && ctx.opp.tiers.power >= ctx.self.tiers.chin + 1) {
    out.push(hit(
      'V-P', 'Out-throw him from range: jab, teep, low kick, and never dwell in the pocket.',
      '[S: MMA_INTEGRATION §3.4 V-1, V-2 (est.)], [S: MMA_INTEGRATION §1]',
      { jab: 1.4, teep: 1.4, lowKick: 1.4, headKick: 0.8 },
      { paceMult: 1.3, pocketDwellS: 2.0 },
    ));
  }

  // ---- AG / L: camp quality ----------------------------------------------
  if (ctx.self.physical.ageYears > AGE_VETERAN_YEARS) {
    out.push(hit(
      'AG-1', 'Veteran: reads the film better (scouting sigma x0.8); the legs are chapter 01 and 05.',
      '[S: MMA_INTEGRATION §4.5 A-1 (est.)], [S: LIT_B §5.8]', {},
    ));
  }
  if (ctx.self.record.layoffDays >= LAYOFF_COMPROMISED_DAYS || ctx.self.record.shortNotice) {
    out.push(hit(
      'L-1', 'Compromised camp: take fewer chances and start slow.',
      '[E] from [S: FIGHT_DATA #123-#124]',
      {},
      { riskDelta: -1, r1PaceMult: 0.9 },
    ));
  }

  return out;
}
