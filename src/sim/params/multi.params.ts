/**
 * Parameters owned by design chapter: docs/design/07_STRATEGY_AND_AI.md
 *
 * This file carries the **game-plan** half of chapter 07 (§2.5 scouting, plan
 * generation and the physical / style / stance rule tables) and the whole of
 * the **multi-opponent** manager (§2.7, and the 09 §3.1 mode table). The
 * utility, perception and adaptation parameters live in `ai.params.ts`.
 *
 * Provenance convention (00_CONVENTIONS §1): a selection weight tagged
 * `[S: … (est.)]` is a research-side estimate and is a calibration tunable
 * (Assumption A-1); `[E]` is a design assumption. Multi-opponent numbers are
 * all anchored priors under Assumption A-9 — the evidence is weak or indirect
 * and the "500 encounters" figures are never used.
 *
 * Binding note on the reach and height rules: they re-weight technique
 * *selection* only. Reach and height do not move win probability
 * `[S: LIT_B §2.4, §2.5]`, and no entry in this file may be turned into a
 * hit-chance or win-rate term. See the header of `src/sim/ai/plans/physical.ts`.
 */
import type { ParamSpec } from './registry';

const S = 'multi' as const;

/** A selection-weight multiplier. Clamped to [0.25, 3] by the plan generator. */
const w = (id: string, value: number, note: string, tag = '[E]'): ParamSpec =>
  ({ id, value, unit: 'x', tag, section: S, free: true, min: 0, max: 3, note });

/** A non-multiplier tunable. */
const n = (
  id: string, value: number, unit: string, note: string,
  tag = '[E]', min = 0, max = 1000, free = true,
): ParamSpec => ({ id, value, unit, tag, section: S, free, min, max, note });

const EST_R = '[S: MMA_INTEGRATION §4.1 (est.)]';
const EST_H = '[S: MMA_INTEGRATION §4.2 (est.)]';
const EST_F = '[S: MMA_INTEGRATION §4.3 (est.)]';
const EST_C = '[S: MMA_INTEGRATION §4.4 (est.)]';
const EST_V = '[S: MMA_INTEGRATION §3.4 (est.)]';
const EST_S = '[S: MMA_INTEGRATION §3.1 (est.)]';
const EST_WB = '[S: MMA_INTEGRATION §3.2 (est.)]';
const EST_P = '[S: MMA_INTEGRATION §3.3 (est.)]';
const EST_ST = '[S: MMA_INTEGRATION §5.1 (est.)]';
const FD_GROUPS = '[S: FIGHT_DATA §6.2]';
const FD_SLOTS = '[S: FIGHT_DATA §6.4 pt 1]';
const FD_GROUND = '[S: FIGHT_DATA §6.4 pt 3]';

export const MULTI_PARAMS: ParamSpec[] = [
  // =========================================================== scouting (§2.5.1)
  n('ai.scout.sigma.t1', 0.30, 'relative sd', 'Scouting noise at iqTier 1', '[S: MMA_INTEGRATION §6.4 (est.)]', 0, 1),
  n('ai.scout.sigma.t2', 0.20, 'relative sd', 'Scouting noise at iqTier 2', '[S: MMA_INTEGRATION §6.4 (est.)]', 0, 1),
  n('ai.scout.sigma.t3', 0.12, 'relative sd', 'Scouting noise at iqTier 3', '[S: MMA_INTEGRATION §6.4 (est.)]', 0, 1),
  n('ai.scout.sigma.t4', 0.08, 'relative sd', 'Scouting noise at iqTier 4', '[S: MMA_INTEGRATION §6.4 (est.)]', 0, 1),
  n('ai.scout.sigma.t5', 0.05, 'relative sd', 'Scouting noise at iqTier 5', '[S: MMA_INTEGRATION §6.4 (est.)]', 0, 1),
  n('ai.scout.age_threshold', 34, 'years', 'Above this age the camp reads film better (AG-1)', '[S: MMA_INTEGRATION §4.5 (est.)]', 20, 60),
  n('ai.scout.age_sigma_mult', 0.80, 'x', 'AG-1 multiplier on scouting sigma', '[S: MMA_INTEGRATION §4.5 (est.)]', 0.1, 2),
  n('ai.scout.self_overrate', 1, 'tiers', 'T0-T1 over-rate their own tiers by this much', '[E]', 0, 2),

  // =========================================================== plan (§2.5.3, §2.5.7, §2.5.8)
  n('ai.plan.fallback_ratio', 0.60, 'fraction', 'Second-best mode is kept as fallback above this share of the best fitness', '[E]', 0, 1),
  n('ai.plan.finishing_mode_aggression', 70, '0-100', 'Aggression at or above which ties break toward the finishing mode', '[E]', 0, 100),
  n('ai.plan.tie_tolerance', 0.98, 'fraction', 'Mode fitness within this share of the best counts as a tie', '[E]', 0.5, 1),
  n('ai.plan.avoid_threshold', 0.70, 'x', 'Final weight at or below which a family is listed as "avoid"', '[E]', 0, 1),
  n('ai.plan.weapon_threshold', 1.00, 'x', 'Final weight above which a family can be a primary weapon', '[E]', 0.5, 3),
  n('ai.plan.max_triggers.t2', 2, 'count', 'Triggers a T2 plan carries', '[S: MMA_INTEGRATION §6.4]', 0, 12),
  n('ai.plan.max_triggers.t3', 5, 'count', 'Triggers a T3 plan carries', '[S: MMA_INTEGRATION §6.4]', 0, 12),
  n('ai.plan.max_triggers.t4', 7, 'count', 'Triggers a T4 plan carries', '[S: MMA_INTEGRATION §6.4]', 0, 12),
  n('ai.plan.max_triggers.t5', 9, 'count', 'Triggers a T5 plan carries', '[S: MMA_INTEGRATION §6.4]', 0, 12),
  n('ai.plan.max_mustnots.t2', 2, 'count', 'Must-nots a T2 plan carries', '[S: MMA_INTEGRATION §6.4]', 0, 8),
  n('ai.plan.max_mustnots.t3', 4, 'count', 'Must-nots a T3 plan carries', '[E]', 0, 8),
  n('ai.plan.max_mustnots.t4', 5, 'count', 'Must-nots a T4 plan carries', '[E]', 0, 8),
  n('ai.plan.max_mustnots.t5', 6, 'count', 'Must-nots a T5 plan carries', '[E]', 0, 8),
  n('ai.plan.combo_cap.t0', 2, 'strikes', 'AI selection combo cap at T0', '[S: BOXING §6]', 1, 6),
  n('ai.plan.combo_cap.t1', 2, 'strikes', 'AI selection combo cap at T1', '[S: BOXING §6]', 1, 6),
  n('ai.plan.combo_cap.t2', 3, 'strikes', 'AI selection combo cap at T2', '[S: BOXING §6]', 1, 6),
  n('ai.plan.combo_cap.t3', 4, 'strikes', 'AI selection combo cap at T3', '[S: BOXING §6]', 1, 6),
  n('ai.plan.combo_cap.t4', 4, 'strikes', 'AI selection combo cap at T4', '[S: BOXING §6]', 1, 6),
  n('ai.plan.combo_cap.t5', 4, 'strikes', 'AI selection combo cap at T5', '[S: BOXING §6]', 1, 6),
  n('ai.plan.corner_max_cues', 2, 'count', 'Corner cues per round', '[S: MMA_INTEGRATION §7.7 CO-1]', 0, 4),
  n('ai.pace.final_round_intent', 1.10, 'x', 'Intended pace in the final round, T2+', '[E]', 0.5, 2),
  n('ai.pace.finish_budget.r1', 0.53, 'share', 'Finish budget spent in round 1', '[S: FIGHT_DATA #98]', 0, 1),
  n('ai.pace.finish_budget.r2', 0.30, 'share', 'Finish budget spent in round 2', '[S: FIGHT_DATA #98]', 0, 1),
  n('ai.pace.finish_budget.r3', 0.15, 'share', 'Finish budget spent in round 3', '[S: FIGHT_DATA #98]', 0, 1),
  n('ai.pace.finish_budget.r4', 0.10, 'share', 'Finish budget spent in round 4 (5-round bouts)', '[E]', 0, 1),
  n('ai.pace.finish_budget.r5', 0.07, 'share', 'Finish budget spent in round 5', '[E]', 0, 1),
  n('ai.pace.finish_class_mult.hw', 1.40, 'x', 'Heavyweight finish-seeking multiplier', '[S: MMA_INTEGRATION §10 rule 19]', 0.5, 2),
  n('ai.pace.finish_class_mult.wsw', 0.50, 'x', "Women's strawweight finish-seeking multiplier", '[S: MMA_INTEGRATION §10 rule 19]', 0.2, 2),

  // =========================================================== R: reach (§2.5.4)
  n('ai.rule.R1.threshold_cm', 5, 'cm', 'Reach difference at which the long/short rules fire', EST_R, 0, 30),
  w('ai.rule.R1.jab', 1.6, 'R-1 jab weight for the longer fighter', EST_R),
  w('ai.rule.R1.teep', 1.5, 'R-1 teep weight', EST_R),
  w('ai.rule.R1.cross', 1.3, 'R-1 cross weight', EST_R),
  w('ai.rule.R1.hook', 0.8, 'R-1 hook weight', EST_R),
  w('ai.rule.R1.circle_away_pressure', 1.4, 'R-1 circle-away weight against a pressure fighter', EST_R),
  w('ai.rule.R1.circle_away_default', 1.2, 'R-1 circle-away weight otherwise', '[E]'),
  w('ai.rule.R1.clinch_entry', 0.6, 'R-1 clinch-entry weight', EST_R),
  w('ai.rule.R1.long_guard', 1.1, 'R-1 long-guard posture weight', EST_R),
  w('ai.rule.R2.retreat', 1.5, 'R-2 retreat-with-jab weight when invaded', EST_R),
  w('ai.rule.R2.pivot', 1.5, 'R-2 pivot weight when invaded', EST_R),
  w('ai.rule.R2.hook', 0.5, 'R-2 hook-exchange weight when invaded', EST_R),
  w('ai.rule.R3.feint', 1.5, 'R-3 feint weight for the shorter fighter', EST_R),
  w('ai.rule.R3.slip_entry', 1.6, 'R-3 slip-entry weight', EST_R),
  w('ai.rule.R3.level_change', 1.6, 'R-3 level-change weight', EST_R),
  w('ai.rule.R3.body_hook', 1.4, 'R-3 body hook on entry', EST_R),
  w('ai.rule.R3.uppercut', 1.4, 'R-3 uppercut on entry', EST_R),
  w('ai.rule.R3.lead_low_kick', 1.3, 'R-3 low kick to the lead leg', EST_R),
  w('ai.rule.R3.clinch_entry', 1.3, 'R-3 clinch-entry weight', EST_R),
  w('ai.rule.R3.shoot_off_strikes', 1.2, 'R-3 shot off strikes', EST_R),
  w('ai.rule.R3.lateral', 1.3, 'R-3 lateral movement', EST_R),
  w('ai.rule.R3b.parry_cross', 1.4, 'R-3b parry the long guard then cross', '[E]'),
  w('ai.rule.R4.bait_cross', 1.5, 'R-4 draw-the-lead bait into the cross (iqTier 3+)', EST_R),
  n('ai.rule.R6.height_threshold_cm', 5, 'cm', 'Height difference that counts without a reach difference', EST_R, 0, 30),

  // =========================================================== H: mass and strength
  n('ai.rule.H1.mass_threshold_pct', 3, 'percent', 'Fight-night mass difference that counts', EST_H, 0, 20),
  w('ai.rule.H2.clinch_entry', 1.4, 'H-2 clinch entry for the stronger fighter', EST_H),
  w('ai.rule.H2.cage_pin', 1.5, 'H-2 cage pin', EST_H),
  w('ai.rule.H2.bodylock_td', 1.3, 'H-2 body-lock takedown', EST_H),
  w('ai.rule.H3.r1_pace', 0.9, 'H-3 wear-down: round-1 pace', EST_H),
  n('ai.rule.H3.clinch_time_target_s', 60, 's', 'H-3 clinch seconds per round the plan wants', EST_H, 0, 300),

  // =========================================================== F: speed
  w('ai.rule.F1.in_out', 1.5, 'F-1 in-and-out macro', EST_F),
  w('ai.rule.F1.circle', 1.4, 'F-1 circling', EST_F),
  w('ai.rule.F1.break_clinch', 1.8, 'F-1 breaking the clinch', EST_F),
  w('ai.rule.F1.pace', 1.3, 'F-1 pace target multiplier', EST_F),
  n('ai.rule.F1.pocket_dwell_s', 1.0, 's', 'F-1 maximum time in the pocket', EST_F, 0, 10),
  w('ai.rule.F2.wall_walk', 2.0, 'F-2 wall walk off the fence', EST_F),
  n('ai.rule.F2.clinch_dwell_s', 3.0, 's', 'F-2 maximum time clinched with a heavier opponent', EST_F, 0, 30),

  // =========================================================== C: cardio
  w('ai.rule.C1.advance', 1.3, 'C-1 pressure from round 2 with the better tank', EST_C),
  w('ai.rule.C1.r1_pace', 1.2, 'C-1 round-1 strike rate', EST_C),
  w('ai.rule.C1.r1_td', 1.2, 'C-1 round-1 takedown attempts (force scrambles)', EST_C),
  w('ai.rule.C2.pace', 0.8, 'C-2 economy strike rate', EST_C),
  w('ai.rule.C2.power', 1.2, 'C-2 single heavy shots early', EST_C),
  w('ai.rule.C2.naked_shot', 0.3, 'C-2 naked shots', EST_C),
  w('ai.rule.C2.scramble', 0.7, 'C-2 clinch and scramble entries', EST_C),

  // =========================================================== power vs volume
  w('ai.rule.PV.feint', 1.4, 'P-V feints against a volume fighter', EST_V),
  w('ai.rule.PV.counter_window', 1.5, 'P-V counter windows', EST_V),
  w('ai.rule.PV.heavy', 1.3, 'P-V single heavy shots', EST_V),
  w('ai.rule.PV.body', 1.2, 'P-V body shots', EST_V),
  w('ai.rule.PV.r1_pace', 0.8, 'P-V round-1 pace', EST_V),
  n('ai.rule.PV.combo_cap', 3, 'strikes', 'P-V combination cap', EST_V, 1, 6),
  w('ai.rule.VP.pace', 1.3, 'V-P pace target against a power puncher', EST_V),
  w('ai.rule.VP.range_weapons', 1.4, 'V-P jab / teep / low kick', EST_V),
  w('ai.rule.VP.head_only', 0.8, 'V-P head-only attacks', EST_V),
  n('ai.rule.VP.pocket_dwell_s', 2.0, 's', 'V-P maximum time in the pocket', EST_V, 0, 10),

  // =========================================================== AG / L
  n('ai.rule.L1.layoff_days', 210, 'days', 'Layoff at which the camp counts as compromised', '[E]', 0, 2000),
  n('ai.rule.L1.risk_delta', -1, 'steps', 'Risk-appetite change for a compromised camp', '[E]', -2, 2),
  w('ai.rule.L1.r1_pace', 0.9, 'L-1 round-1 pace for a compromised camp', '[E]'),

  // =========================================================== S: striker vs wrestler
  w('ai.rule.S1.teep', 1.4, 'S-1 teep against a takedown threat', EST_S),
  w('ai.rule.S1.jab', 1.4, 'S-1 jab', EST_S),
  w('ai.rule.S1.rear_kick', 0.4, 'S-1 rear-leg kicks', EST_S),
  w('ai.rule.S1.head_kick', 0.6, 'S-1 head kicks', '[E]'),
  w('ai.rule.S1.lead_low_kick', 0.8, 'S-1 lead low kick', EST_S),
  w('ai.rule.S1.level_change_punish', 1.8, 'S-1 uppercut / knee on the level change', EST_S),
  w('ai.rule.S2.circle_away', 1.5, 'S-2 circle away within 1.5 m of the fence', EST_S),
  n('ai.rule.S2.cage_distance_m', 1.5, 'm', 'S-2 cage-proximity threshold', EST_S, 0, 5),
  w('ai.rule.S3.stand_up', 2.0, 'S-3 stand-up urgency after being taken down', EST_S),
  w('ai.rule.S3.bottom_submission', 0.5, 'S-3 submissions from the bottom without a BJJ edge', EST_S),
  n('ai.rule.S3.window_s', 8, 's', 'S-3 stand-up urgency window', EST_S, 0, 60),
  w('ai.rule.S4.sprawl', 1.4, 'S-4 sprawl readiness (weight-back stance)', EST_S),
  n('ai.rule.S4.combo_cap', 3, 'strikes', 'S-4 combination cap at level-change range', EST_S, 1, 6),
  w('ai.rule.S5.break_clinch', 1.8, 'S-5 break the clinch and hit on the break', EST_S),

  // =========================================================== W: the wrestler
  w('ai.rule.W1.naked_shot', 0.4, 'W-1 naked shots', EST_S),
  w('ai.rule.W1.shoot_off_strikes', 1.2, 'W-1 shots set up by a strike', EST_S),
  n('ai.rule.W1.setup_window_s', 1.0, 's', 'W-1 window after a strike in which a shot counts as set up', EST_S, 0, 5),
  w('ai.rule.W2.advance', 1.5, 'W-2 advance behind the cut', EST_S),
  w('ai.rule.W2.clinch_entry', 1.8, 'W-2 clinch entry with his back near the fence', EST_S),
  w('ai.rule.W2.shoot', 1.4, 'W-2 shot with his back near the fence', EST_S),
  w('ai.rule.W2.cage_pin', 1.3, 'W-2 cage pin', '[E]'),
  w('ai.rule.W3.ground_strike', 1.3, 'W-3 ground strikes from guard or half', '[S: MMA_INTEGRATION §3.1]'),
  w('ai.rule.W3.pass', 1.4, 'W-3 pass after two landed ground strikes', '[S: MMA_INTEGRATION §3.1]'),
  w('ai.rule.W3.ride', 1.2, 'W-3 riding', '[E]'),
  n('ai.rule.W3.control_gap_target_s', 180, 's', 'W-3 control-time gap the plan aims for', '[S: FIGHT_DATA #84]', 0, 900),
  n('ai.rule.W4.clinch_window_s', 60, 's', 'W-4 clinch/cage chains after two stuffed shots', EST_S, 0, 300),
  w('ai.rule.W5.r1_td', 1.2, 'W-5 round-1 takedown attempts', '[S: MMA_INTEGRATION §3.1]'),
  w('ai.rule.W5.r3_td', 0.9, 'W-5 round-3 takedown attempts', '[S: MMA_INTEGRATION §3.1]'),

  // =========================================================== WB: wrestler vs BJJ
  w('ai.rule.WB1.submission', 0.3, 'WB-1 submission attempts against a better grappler', EST_WB),
  w('ai.rule.WB1.pass', 0.9, 'WB-1 passing into his guard', EST_WB),
  w('ai.rule.WB1.ride', 1.3, 'WB-1 riding with wrist control', EST_WB),
  w('ai.rule.WB1.ground_strike', 1.2, 'WB-1 striking to open the pass', EST_WB),
  w('ai.rule.WB2.stand_up', 1.4, 'WB-2 stand up rather than pass at all costs', '[S: MMA_INTEGRATION §3.2]'),
  w('ai.rule.WB3.sweep', 1.6, 'WB-3 sweep the striking top fighter', EST_WB),
  w('ai.rule.WB3.submission', 1.4, 'WB-3 submission when his posture breaks', EST_WB),
  w('ai.rule.WB3.wall_walk', 0.8, 'WB-3 wall walk (the guard is the better option here)', EST_WB),
  n('ai.rule.WB3.abort_strikes', 6, 'count', 'WB-3 ground strikes absorbed in 30 s before abandoning the guard', EST_WB, 0, 30),
  w('ai.rule.WB4.clinch_entry', 1.3, 'WB-4 accept the clinch when out-wrestled', EST_WB),
  w('ai.rule.WB4.trip', 1.3, 'WB-4 trip from the clinch', '[E]'),
  w('ai.rule.WB4.guard_pull', 1.2, 'WB-4 guard pull when it is not punishable', '[E]'),
  w('ai.rule.WB4.front_headlock', 1.4, 'WB-4 front headlock on his shot', EST_WB),
  w('ai.rule.WB4.back_take', 1.5, 'WB-4 back take (0.45 finish rate at elite)', '[S: LIT_B §5.11]'),

  // =========================================================== P: pressure vs counter
  w('ai.rule.P1.advance', 1.5, 'P-1 advance along the cut line', '[S: MMA_INTEGRATION §3.3]'),
  w('ai.rule.P2.feint', 1.5, 'P-2 feints before committing', EST_P),
  w('ai.rule.P3.body', 1.4, 'P-3 body hook and body kick with his back on the fence', EST_P),
  w('ai.rule.P3.clinch_entry', 1.3, 'P-3 clinch entry on the fence', EST_P),
  n('ai.rule.P3.combo_delta', 1, 'strikes', 'P-3 extra strike in the combination on the fence', EST_P, 0, 3),
  n('ai.rule.P3.cage_distance_m', 1.0, 'm', 'P-3 cage-proximity threshold', EST_P, 0, 5),
  w('ai.rule.P4.retreat', 1.4, 'P-4 retreat and circle for the counter fighter', EST_P),
  w('ai.rule.P4.lead', 0.7, 'P-4 lead strikes for the counter fighter', EST_P),
  w('ai.rule.P4.counter_window', 1.8, 'P-4 counter-window strikes', EST_P),
  w('ai.rule.P4.pivot', 1.3, 'P-4 check-hook and pivot off the fence', '[E]'),
  n('ai.rule.P5.cage_exchanges', 3, 'count', 'P-5 fence exchanges before the lead-initiative reset', EST_P, 1, 10),
  n('ai.rule.P5.reset_s', 20, 's', 'P-5 length of the lead-initiative reset', EST_P, 0, 120),

  // =========================================================== SH: submission hunter
  w('ai.rule.SH1.front_headlock', 1.5, 'SH-1 front headlock on his shot (first entry)', '[E]'),
  w('ai.rule.SH1.trip', 1.3, 'SH-1 clinch trip (second entry)', '[E]'),
  w('ai.rule.SH1.back_take', 1.4, 'SH-1 back take', '[S: LIT_B §5.11]'),
  w('ai.rule.SH1.guard_pull_ok', 1.2, 'SH-1 guard pull when his ground-and-pound cannot punish it', '[E]'),
  w('ai.rule.SH1.guard_pull_bad', 0.3, 'SH-1 guard pull otherwise', '[E]'),
  n('ai.rule.SH1.sub_attack_gate', 55, '0-100', 'Submission-attack skill at which the hunter entries unlock', '[E]', 0, 100),

  // =========================================================== ST: stance (§2.5.6)
  w('ai.rule.ST1.circle_outside', 1.5, 'ST-1 circle toward the outside-foot side in an open stance', EST_ST),
  w('ai.rule.ST1.pivot', 1.2, 'ST-1 pivot to keep the dominant angle', '[E]'),
  w('ai.rule.ST2.jab', 0.75, 'ST-2 jab in an open stance (the jabs collide)', '[S: MMA_INTEGRATION §5.1]'),
  w('ai.rule.ST2.parry_cross', 1.4, 'ST-2 parry into the cross (lead-hand fighting)', '[S: MMA_INTEGRATION §5.1]'),
  w('ai.rule.ST3.cross', 1.4, 'ST-3 cross straight down the middle', '[S: MMA_INTEGRATION §5.1]'),
  w('ai.rule.ST3.rear_body_kick', 1.4, 'ST-3 rear body kick to the open side', '[S: MMA_INTEGRATION §5.1]'),
  w('ai.rule.ST3.lead_hook', 1.1, 'ST-3 lead hook with the dominant angle', '[S: MMA_INTEGRATION §5.1]'),
  n('ai.rule.ST4.range_offset_m', 0.1, 'm', 'ST-4 extra range both fighters keep in an open stance', '[S: MMA_INTEGRATION §5.1]', 0, 0.5),
  w('ai.rule.ST4.clinch_entry', 0.9, 'ST-4 clinch entry in an open stance', '[S: MMA_INTEGRATION §5.1]'),
  n('ai.rule.ST5.familiarity_fights', 3, 'fights', 'Fights against a stance before it stops being unfamiliar', '[E]', 0, 20),
  n('ai.rule.ST5.wrong_way_circle_p', 0.15, 'probability', 'ST-5 per-exchange chance of circling the wrong way', EST_ST, 0, 1),
  w('ai.rule.ST5.counter', 0.9, 'ST-5 counter families against an unfamiliar stance', EST_ST),
  n('ai.rule.ST5.immune_tier', 4, 'tier', 'Tier from which ST-5 no longer applies', '[S: LIT_B §3.15]', 0, 5),
  w('ai.rule.ST6.lead_low_kick', 1.3, 'ST-6 low kick to the lead leg with the dominant angle', EST_ST),
  w('ai.rule.ST7.jab', 1.2, 'ST-7 jab in a closed stance', '[S: MMA_INTEGRATION §5.2]'),
  w('ai.rule.ST7.lead_hook', 1.1, 'ST-7 lead hook in a closed stance', '[S: MMA_INTEGRATION §5.2]'),
  w('ai.rule.ST7.rear_low_kick', 1.1, 'ST-7 rear low kick in a closed stance', '[S: MMA_INTEGRATION §5.2]'),
  w('ai.rule.ST7.rear_body_kick', 0.9, 'ST-7 rear body kick in a closed stance', '[S: MMA_INTEGRATION §5.2]'),
  w('ai.rule.ST7.clinch_entry', 1.1, 'ST-7 clinch entry in a closed stance', '[S: MMA_INTEGRATION §5.2]'),
  w('ai.rule.ST8.switch_stance', 1.5, 'ST-8 stance switch on a trigger (T3+ only)', '[S: MMA_INTEGRATION §5.3 (est.)]'),

  // =========================================================== multi: threat and targeting (§2.7, 09 §3.1)
  n('ai.multi.aware_radius', 6, 'm', 'Radius inside which hostiles are assessed', '[E]', 1, 30),
  n('ai.multi.engage_radius', 1.7, 'm', 'Radius inside which a hostile counts as engaged', '[S: AUDIT §1.1]', 0.5, 5),
  n('ai.multi.threat_prox_num', 0.5, '-', 'Numerator of the proximity term, 0.5/(d+0.5)', '[E]', 0, 2),
  n('ai.multi.threat_prox_offset', 0.5, 'm', 'Offset of the proximity term', '[E]', 0.01, 5),
  n('ai.multi.threat_damage_w', 0.3, '-', 'Weight on damage this hostile has done to me in the last 10 s', '[E]', 0, 1),
  n('ai.multi.threat_facing_w', 0.2, '-', 'Weight on the hostile facing me', '[E]', 0, 1),
  n('ai.multi.threat_damage_norm', 25, 'damage', 'Damage in the window that normalises the damage term to 1.0', '[E]', 1, 200),
  n('ai.multi.threat_damage_window_s', 10, 's', 'Damage look-back window', '[E]', 1, 60),
  n('ai.multi.facing_cone_deg', 45, 'deg', 'Half-angle of the "he is facing me" cone', '[E]', 5, 180),
  n('ai.multi.eval_ticks', 5, 'ticks', 'Threat re-evaluation cadence in multi-opponent modes', '[E]', 1, 50),
  n('ai.multi.switch_ratio', 1.2, 'x', 'New threat must exceed this multiple of the current target', '[E]', 1, 3),
  n('ai.multi.min_hold_s', 1.5, 's', 'Minimum time a target is held before a voluntary switch', '[E]', 0, 10),
  n('ai.multi.switch_notice_base', 0.55, 'probability', 'Base chance a due switch is noticed at iqTier 0', '[E]', 0, 1),
  n('ai.multi.switch_notice_per_tier', 0.15, 'probability', 'Added chance per iqTier that a due switch is noticed', '[E]', 0, 1),
  n('ai.multi.opportunity_hurt', 1.0, '-', 'Opportunity value of a hurt hostile', '[E]', 0, 2),
  n('ai.multi.opportunity_tired', 0.6, '-', 'Opportunity value of a tired hostile', '[E]', 0, 2),
  n('ai.multi.opportunity_facing_away', 0.3, '-', 'Opportunity value of a hostile facing away', '[E]', 0, 2),
  n('ai.multi.early_injury_window_s', 15, 's', 'Window in which causing visible injury is prioritised', FD_GROUPS, 0, 120),
  w('ai.multi.early_injury_mult', 1.5, 'Opportunity multiplier inside the early-injury window', '[E]'),

  // =========================================================== multi: engagement geometry
  n('ai.multi.effective_attackers', 2, 'count', 'Attackers who can strike one defender effectively at once', FD_SLOTS, 1, 6, false),
  w('ai.multi.fringe_weight', 0.3, 'How much each fringe attacker still counts toward engagedBy', '[E]'),
  n('ai.multi.fringe_ring_radius_m', 2.5, 'm', 'Radius of the fringe ring', '[E]', 0.5, 8),
  n('ai.multi.fringe_orbit_ms', 0.8, 'm/s', 'Orbit speed of a fringe attacker', '[E]', 0, 4),
  n('ai.multi.fringe_share_burst', 0.81, 'fraction', 'Share of a hostile group that fights during a burst', FD_GROUPS, 0, 1, false),
  n('ai.multi.fringe_share_calm', 0.51, 'fraction', 'Share of a hostile group that fights otherwise', FD_GROUPS, 0, 1, false),
  n('ai.team.burst_threshold', 0.5, 'fraction', 'Share of the group committed that triggers the burst', FD_GROUPS, 0, 1),
  n('ai.team.burst_join_ms', 1500, 'ms', 'Window in which the rest of the group joins after the burst', FD_GROUPS, 0, 5000),
  n('ai.team.burst_group_p', 0.39, 'probability', 'Share of hostile groups that burst at all', FD_GROUPS, 0, 1, false),
  n('ai.team.participation_threshold', 0.3333, 'fraction', 'Weenink predicted participation threshold', FD_GROUPS, 0, 1, false),

  // =========================================================== multi: the outnumbered fighter
  n('ai.multi.outnumbered_radius_m', 3, 'm', 'Hostiles within this radius trigger mode.outnumbered', '[E]', 0.5, 10),
  n('ai.multi.outnumbered_count', 2, 'count', 'Hostiles within the radius that trigger it', '[E]', 2, 8),
  w('ai.multi.ground_entry_weight', 0.05, 'Shoot, trip and guard-pull weight while outnumbered', FD_GROUND),
  w('ai.multi.stand_up_weight', 3.0, 'Stand-up and wall-walk weight while outnumbered and down', FD_GROUND),
  n('ai.multi.strike_and_move_ms', 1000, 'ms', 'Window after a strike in which movement is prioritised', '[E]', 0, 5000),
  w('ai.multi.strike_and_move_weight', 2.0, 'Retreat and circle weight inside that window', '[E]'),
  n('ai.multi.outnumbered_combo_cap', 2, 'strikes', 'Combination cap while outnumbered', '[E]', 1, 4),
  w('ai.multi.outnumbered_straight', 1.4, 'Straight strikes and front kicks while outnumbered', '[E]'),
  w('ai.multi.outnumbered_hook', 0.7, 'Hooks while outnumbered', '[E]'),
  w('ai.multi.shield_clinch', 1.5, 'Clinch entry that puts a hostile between self and the others', '[E]'),
  n('ai.multi.shield_clinch_break_ms', 2000, 'ms', 'Time after which a non-shielding clinch is broken', '[E]', 0, 10000),
  n('ai.multi.line_spread_fallback_deg', 120, 'deg', 'Spread above which the line cannot be kept', '[E]', 30, 180),
  n('ai.multi.line_spread_fallback_ms', 1000, 'ms', 'How long that spread must persist before backing to the fence', '[E]', 0, 10000),

  // =========================================================== multi: teams and free-for-all
  n('ai.team.flank_angle_deg', 90, 'deg', 'Bearing the second attacker takes from the first', '[E]', 0, 180),
  n('ai.team.turn_taking_ms', 6000, 'ms', 'How long an engaged attacker works before the fringe relieves him', '[E]', 0, 60000),
  n('ai.team.turn_taking_fatigue', 0.5, 'fraction', 'Fatigue at which he peels off sooner', '[E]', 0, 1),
  w('ai.ffa.engaged_penalty', 0.5, 'Engaging someone already fighting a healthy third party', FD_GROUPS),
  w('ai.ffa.opportunism', 1.5, 'Engaging someone busy and facing away (T3+)', '[E]'),

  // =========================================================== street
  n('ai.multi.grounded_defender_mult', 2.5, 'x', 'Per-second damage multiplier on a grounded defender with a free standing attacker (street only)', FD_GROUND, 1, 6),
  n('ai.street.bystander_separation_p', 0.10, 'probability', 'P(separation per 10 s) once any fighter is down', '[E]', 0, 1),
  n('ai.street.bystander_p', 0.90, 'probability', 'At least one bystander is present', FD_GROUPS, 0, 1, false),
  n('ai.street.join_p', 0.26, 'probability', 'A third party joins the fight', '[S: FIGHT_DATA §6.1]', 0, 1, false),
  n('ai.street.friend_share', 0.68, 'fraction', 'Share of joiners who join as a friend of one side', '[S: FIGHT_DATA §6.1]', 0, 1, false),
  n('ai.street.impaired_p', 0.64, 'probability', 'Hostile is impaired by alcohol', FD_GROUPS, 0, 1, false),
  n('ai.street.flee_base', 0.20, 'utility', 'Base flight utility', '[E]', 0, 2),
  n('ai.street.flee_damage_w', 0.50, 'utility', 'Flight utility per unit of own normalised damage', '[E]', 0, 2),
  n('ai.street.flee_hostile_w', 0.15, 'utility', 'Flight utility per extra hostile', '[E]', 0, 2),
  n('ai.street.flee_idle_w', 0.10, 'utility', 'Flight utility when nothing has landed recently', '[E]', 0, 2),
  n('ai.street.flee_idle_window_s', 15, 's', 'How long "nothing landed" takes to count', '[E]', 0, 120),
  n('ai.street.flee_trained_w', 0.30, 'utility', 'Flight utility removed by training', '[E]', 0, 2),
  n('ai.street.flee_friend_w', 0.20, 'utility', 'Flight utility removed by a friend being present', '[E]', 0, 2),
  n('ai.street.flee_friend_downed_w', 0.30, 'utility', 'Flight utility added when that friend goes down', '[E]', 0, 2),
];
