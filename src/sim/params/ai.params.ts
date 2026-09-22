/**
 * Parameters owned by design chapter: docs/design/07_STRATEGY_AND_AI.md
 *
 * This file carries the **decision core** of chapter 07: the architecture
 * constants (§2.1), the utility and softmax parameters (§2.2), the
 * execution-quality layer (§2.3), perception and the opponent model (§2.4) and
 * in-fight adaptation, score awareness, the hurt/finisher blocks and the corner
 * (§2.6). The game-plan generator's rule tables (§2.5) and the whole of the
 * multi-opponent manager (§2.7) live in `multi.params.ts`.
 *
 * Provenance convention (00_CONVENTIONS §1): `[S: …]` sourced, `[D: …]`
 * derived, `[E]` a design assumption. A value tagged `[S: … (est.)]` is a
 * research-side estimate and is a primary Phase 9 calibration target
 * (Assumption A-1). Vectors in the chapter's registry are expanded here into
 * one id per tier, because the resolved parameter array is dense and indexed.
 *
 * Two entries are deliberately `free: false`: the draw counts. Moving them
 * would break the replay contract of §2.1 / A-2 rather than re-tune a
 * behaviour, and the calibrator must refuse to touch them.
 */
import type { ParamSpec } from './registry';

const S = 'ai' as const;

/** A probability. */
const p = (id: string, value: number, note: string, tag = '[E]', free = true): ParamSpec =>
  ({ id, value, unit: 'probability', tag, section: S, free, min: 0, max: 1, note });

/** A selection-weight multiplier. */
const w = (id: string, value: number, note: string, tag = '[E]'): ParamSpec =>
  ({ id, value, unit: 'x', tag, section: S, free: true, min: 0, max: 3, note });

/** Anything else. */
const n = (
  id: string, value: number, unit: string, note: string,
  tag = '[E]', min = 0, max = 1000, free = true,
): ParamSpec => ({ id, value, unit, tag, section: S, free, min, max, note });

const DP43 = '[S: DAMAGE_PHYSIOLOGY §4.3 (est.)]';
const MIS72 = '[S: MMA_INTEGRATION §7.2 (est.)]';
const MIS73 = '[S: MMA_INTEGRATION §7.3 (est.)]';
const MIS74 = '[S: MMA_INTEGRATION §7.4 (est.)]';
const MIS75 = '[S: MMA_INTEGRATION §7.5 (est.)]';
const MIS77 = '[S: MMA_INTEGRATION §7.7 (est.)]';
const LAG = '[S: 09 §2.5 (E)]';

export const AI_PARAMS: ParamSpec[] = [
  // ======================================================= architecture (§2.1)
  n('ai.rng.draws_per_tick', 8, 'count', 'RNG draws every policy consumes per fighter per tick in P3', '[E]', 8, 8, false),
  n('ai.rng.draws_per_tick_multi', 9, 'count', 'The same, plus the target-switch draw, in multi-opponent modes', '[E]', 9, 9, false),
  n('ai.rng.draws_per_break', 5, 'count', 'Draws per fighter at a round break: 2 cue correctness, 2 uptake, 1 score noise', '[S: MMA_INTEGRATION §7.7]', 5, 5, false),

  // ======================================================= utility (§2.2)
  n('ai.utility.clamp_min', 0.25, 'x', 'Floor on the product of the style, plan, adaptation and matchup weights', '[S: MMA_INTEGRATION §10 rule 22]', 0, 1),
  n('ai.utility.clamp_max', 3.0, 'x', 'Cap on that product', '[S: MMA_INTEGRATION §10 rule 22]', 1, 10),
  n('ai.utility.considerations', 19, 'count', 'Number of `c.*` axes in the IAUS product; sets the sqrt(n) compensation', '[E]', 1, 40, false),
  n('ai.style.weight_min', 0.5, 'x', 'Floor on a per-fighter style weight', '[E]', 0, 1),
  n('ai.style.weight_max', 2.0, 'x', 'Cap on a per-fighter style weight', '[E]', 1, 5),
  n('ai.style.jitter_sd', 0.10, 'log-normal sd', 'Per-bout style jitter; replaces the old tendencySd of 0.22', '[E]', 0, 1),

  n('ai.temp.tier.t0', 1.00, 'tau', 'Softmax temperature at T0 (near-lottery)', '[E]', 0.05, 3),
  n('ai.temp.tier.t1', 0.80, 'tau', 'Softmax temperature at T1', '[E]', 0.05, 3),
  n('ai.temp.tier.t2', 0.60, 'tau', 'Softmax temperature at T2', '[E]', 0.05, 3),
  n('ai.temp.tier.t3', 0.45, 'tau', 'Softmax temperature at T3', '[E]', 0.05, 3),
  n('ai.temp.tier.t4', 0.35, 'tau', 'Softmax temperature at T4', '[E]', 0.05, 3),
  n('ai.temp.tier.t5', 0.28, 'tau', 'Softmax temperature at T5 (near-argmax, never argmax)', '[E]', 0.05, 3),
  n('ai.temp.phase_iq_blend', 0.5, 'fraction', 'Share of the temperature tier taken from the phase discipline rather than fightIQ', '[E]', 0, 1),

  n('ai.q.fatigue_zero', 0.20, 'fraction', 'Fatigue below which decision quality is unaffected', '[E]', 0, 1),
  n('ai.q.fatigue_mid', 0.15, 'fraction', 'Decision-quality penalty at f = 0.5', DP43, 0, 1),
  n('ai.q.fatigue_high', 0.35, 'fraction', 'Decision-quality penalty at f = 0.8', DP43, 0, 1),
  n('ai.q.fatigue_cap', 0.50, 'fraction', 'Cap on the fatigue decision penalty', DP43, 0, 1),
  n('ai.q.rocked', 0.40, 'fraction', 'Decision-quality penalty while rocked', '[S: DAMAGE_PHYSIOLOGY §7 rule 6]', 0, 1),
  n('ai.q.dump', 0.20, 'fraction', 'Decision-quality penalty per unit of adrenaline dump', '[S: DAMAGE_PHYSIOLOGY §4.6]', 0, 1),
  n('ai.q.dump_window_s', 150, 's', 'How long the dump penalty lasts into round 1', '[S: DAMAGE_PHYSIOLOGY §4.6]', 0, 600),
  n('ai.q.second_wind', 0.10, 'fraction', 'Decision-quality bonus during a second wind', '[S: DAMAGE_PHYSIOLOGY §4.5]', 0, 1),
  n('ai.q.second_wind_s', 60, 's', 'How long the second wind lasts', '[S: DAMAGE_PHYSIOLOGY §4.5]', 0, 300),

  n('ai.combo.cap.t0', 2, 'strikes', 'AI selection combination cap at T0', '[E]', 1, 6),
  n('ai.combo.cap.t1', 2, 'strikes', 'AI selection combination cap at T1', '[E]', 1, 6),
  n('ai.combo.cap.t2', 3, 'strikes', 'AI selection combination cap at T2', '[E]', 1, 6),
  n('ai.combo.cap.t3', 4, 'strikes', 'AI selection combination cap at T3', '[E]', 1, 6),
  n('ai.combo.cap.t4', 4, 'strikes', 'AI selection combination cap at T4', '[E]', 1, 6),
  n('ai.combo.cap.t5', 4, 'strikes', 'AI selection combination cap at T5', '[E]', 1, 6),
  n('ai.combo.cap_vs_wrestler', 3, 'strikes', 'Cap at level-change distance in front of a better wrestler (S-4)', '[S: MMA_INTEGRATION §3.1 (est.)]', 1, 6),
  n('ai.combo.max_any', 4, 'strikes', 'Absolute cap on a selected combination', '[S: MMA_INTEGRATION §6]', 1, 8),

  n('ai.mcts.enabled', 0, 'flag', 'Lookahead is reserved, not baseline (§2.2.6, A-13)', '[E]', 0, 1, false),
  n('ai.mcts.playouts', 64, 'count', 'Playouts per lookahead decision if it is ever enabled', '[S: LIT_C §2]', 1, 512),
  n('ai.mcts.horizon_ticks', 4, 'ticks', 'Rollout horizon', '[S: LIT_C §2]', 1, 20),
  n('ai.mcts.budget_ms', 2, 'ms', 'Per-decision time budget in a worker', '[S: LIT_C §2]', 0, 50),

  // ======================================================= execution quality (§2.3)
  n('ai.exec.tele_fatigue', 0.5, 'coefficient', 'Telegraph multiplier is (1 + this x f)', '[E]', 0, 2),
  n('ai.exec.tele_scale_ms', 600, 'ms', '01 telegraphMod (-1..+1) times this gives the ms the tier adds', '[S: 01 §2.7.8]', 0, 2000),
  p('ai.exec.p_ontime.t0', 0.55, 'P(the technique fires on the beat) at T0'),
  p('ai.exec.p_ontime.t1', 0.65, 'P(on the beat) at T1'),
  p('ai.exec.p_ontime.t2', 0.75, 'P(on the beat) at T2'),
  p('ai.exec.p_ontime.t3', 0.85, 'P(on the beat) at T3'),
  p('ai.exec.p_ontime.t4', 0.92, 'P(on the beat) at T4'),
  p('ai.exec.p_ontime.t5', 0.95, 'P(on the beat) at T5'),
  n('ai.exec.p_ontime_fatigue', 0.15, 'coefficient', 'On-time probability is multiplied by (1 - this x f)', '[E]', 0, 1),
  p('ai.exec.late_share', 0.75, 'Share of mistimed attempts that are late rather than early'),
  n('ai.exec.k_accuracy', 0.6, 'logit', 'Accuracy penalty per unit of (1 - p_ontime)', '[E]', 0, 3),
  n('ai.exec.accuracy_fatigue', 0.18, 'fraction', 'Accuracy loss at f = 0.8, linear below', DP43, 0, 1),
  p('ai.exec.target_error.t0', 0.10, 'P(the requested region is swapped for an adjacent one) at T0'),
  p('ai.exec.target_error.t1', 0.06, 'P(target error) at T1'),
  p('ai.exec.target_error.t2', 0.03, 'P(target error) at T2'),
  p('ai.exec.target_error.t3', 0.015, 'P(target error) at T3'),
  p('ai.exec.target_error.t4', 0.008, 'P(target error) at T4'),
  p('ai.exec.target_error.t5', 0.005, 'P(target error) at T5'),
  p('ai.exec.overcommit.t0', 0.40, 'P(lunging for power on a power strike) at T0', '[S: BOXING §6]'),
  p('ai.exec.overcommit.t1', 0.25, 'P(overcommit) at T1', '[S: BOXING §6]'),
  w('ai.exec.overcommit_power', 1.15, 'Power multiplier when the fighter overcommits'),
  n('ai.exec.overcommit_balance', -0.2, 'balance', 'Balance cost of overcommitting', '[E]', -1, 0),

  // ======================================================= perception (§2.4.1-2.4.2)
  n('ai.percept.base_ms.t0', 300, 'ms', 'Perception lag base at T0', LAG, 0, 600),
  n('ai.percept.base_ms.t1', 300, 'ms', 'Perception lag base at T1', LAG, 0, 600),
  n('ai.percept.base_ms.t2', 200, 'ms', 'Perception lag base at T2', LAG, 0, 600),
  n('ai.percept.base_ms.t3', 200, 'ms', 'Perception lag base at T3', LAG, 0, 600),
  n('ai.percept.base_ms.t4', 100, 'ms', 'Perception lag base at T4', LAG, 0, 600),
  n('ai.percept.base_ms.t5', 100, 'ms', 'Perception lag base at T5', LAG, 0, 600),
  n('ai.percept.reaction_slope', 1, 'ms per point', 'Lag falls by this per reactionTime point above 50', LAG, 0, 5),
  n('ai.percept.fatigue_ms', 50, 'ms', 'Lag added at f >= 0.7', LAG, 0, 300),
  n('ai.percept.fatigue_threshold', 0.70, 'fraction', 'Fatigue at which that penalty starts', LAG, 0, 1),
  n('ai.percept.rocked_ms', 150, 'ms', 'Lag added while rocked', LAG, 0, 500),
  n('ai.percept.familiarity_ms', 20, 'ms', 'Lag added against an unfamiliar stance (T0-T3)', '[S: MMA_INTEGRATION §5.1 (est.)]', 0, 200),
  n('ai.percept.lag_ticks_min', 1, 'ticks', 'Floor on the perception buffer lag', LAG, 0, 5, false),
  n('ai.percept.lag_ticks_max', 3, 'ticks', 'Cap on the perception buffer lag', LAG, 1, 8, false),
  p('ai.percept.hurt_cue_p_t0', 0.50, 'P(the opponent-hurt cue is noticed) per tick at T0'),
  n('ai.percept.tired_cue_pace_drop', 0.20, 'fraction', 'Pace drop over 30 s that reads as "he is tired"', MIS72, 0, 1),
  n('ai.percept.tired_cue_min_tier', 2, 'tier', 'Lowest IQ tier that reads the tired cue unaided', MIS72, 0, 5),
  n('ai.percept.tired_cue_fatigue', 0.60, 'fraction', 'Fatigue at which the mouth-open / hands-low cue appears', MIS72, 0, 1),

  // ======================================================= opponent model (§2.4.3)
  n('ai.oppmodel.contexts', 72, 'count', 'Context cells: 6 ranges x 2 fatigue buckets x 6 "what I threw last"', '[E]', 1, 512, false),
  n('ai.oppmodel.families', 12, 'count', 'Opponent action families the table counts', '[E]', 1, 32, false),
  n('ai.oppmodel.laplace_alpha', 1, 'count', 'Laplace smoothing constant', '[S: LIT_C §2]', 0, 10),
  n('ai.oppmodel.n_prior.t1', 2, 'pseudo-counts', 'Scouted profile weight at iqTier 1', '[E]', 0, 64),
  n('ai.oppmodel.n_prior.t2', 4, 'pseudo-counts', 'Scouted profile weight at iqTier 2', '[E]', 0, 64),
  n('ai.oppmodel.n_prior.t3', 8, 'pseudo-counts', 'Scouted profile weight at iqTier 3', '[E]', 0, 64),
  n('ai.oppmodel.n_prior.t4', 12, 'pseudo-counts', 'Scouted profile weight at iqTier 4', '[E]', 0, 64),
  n('ai.oppmodel.n_prior.t5', 16, 'pseudo-counts', 'Scouted profile weight at iqTier 5', '[E]', 0, 64),
  n('ai.oppmodel.tau_mem.t1', 20, 's', 'Forgetting horizon at iqTier 1 (A-4: deviates from LIT_C 6 s)', '[E]', 1, 600),
  n('ai.oppmodel.tau_mem.t2', 40, 's', 'Forgetting horizon at iqTier 2', '[E]', 1, 600),
  n('ai.oppmodel.tau_mem.t3', 60, 's', 'Forgetting horizon at iqTier 3', '[E]', 1, 600),
  n('ai.oppmodel.tau_mem.t4', 90, 's', 'Forgetting horizon at iqTier 4', '[E]', 1, 600),
  n('ai.oppmodel.tau_mem.t5', 120, 's', 'Forgetting horizon at iqTier 5', '[E]', 1, 600),
  n('ai.oppmodel.kl_recent_s', 30, 's', 'Recent window of the "he has adjusted" test', '[E]', 1, 300),
  n('ai.oppmodel.kl_prior_s', 60, 's', 'Prior window of the same test', '[E]', 1, 600),
  n('ai.oppmodel.kl_adjust_threshold', 0.35, 'nats', 'KL divergence above which the T5 trigger fires', '[E]', 0, 5),
  n('ai.oppmodel.round_persistence', 1.0, 'x', 'Counts carried across a round break', '[S: MMA_INTEGRATION §6.4]', 0, 1),
  n('ai.ledger.window', 30, 's', 'The exchange ledger the adjustment signals read', '[S: MMA_INTEGRATION §7.1]', 1, 300),

  // ======================================================= reads and feints (§2.4.4-2.4.5)
  n('ai.read.familiarity_threshold', 3, 'fights', 'Fights against a stance before it stops being unfamiliar', '[E]', 0, 20),
  n('ai.read.familiarity_logit', 0.45, 'logit', 'Read penalty against a wholly unfamiliar stance', '[S: LIT_B §3.15]', 0, 3),
  n('ai.read.anxiety_logit_per_p', 4.33, 'logit per p', '01 anxietyReadPenalty is a probability; this converts it to a logit shift', '[S: LIT_B §4.3]', 0, 20),
  n('ai.read.pattern_logit_scale', 2.0, 'logit', 'Opponent-model agreement, in logits, when the model is certain', '[E]', 0, 10),
  w('ai.read.counter_mult', 2.5, 'Counter families are multiplied by this for the tick after a successful read'),
  n('ai.read.counter_window_ms', 100, 'ms', 'How long that multiplier lasts', '[E]', 0, 1000),
  n('ai.feint.quality_coef', 0.3, 'coefficient', 'Bite probability is scaled by (1 + this x feint quality)', '[E]', 0, 2),
  n('ai.feint.min_tier', 2, 'tier', 'Lowest striking tier that can feint at all', '[S: BOXING §6]', 0, 5),
  n('ai.feint.layered_tier', 4, 'tier', 'Lowest tier for layered feints', '[S: BOXING §6]', 0, 5),
  n('ai.feint.walkthrough_drop', 0.30, 'fraction', 'Drop in expectedThreat for a family the defender walked through', '[E]', 0, 1),
  n('ai.feint.walkthrough_s', 5, 's', 'How long that drop lasts', '[E]', 0, 60),
  p('ai.feint.hurt_bonus', 0.20, 'Added bite probability against a hurt opponent (they flinch)'),
  n('ai.rematch_plan_bonus', 0.02, 'fraction', 'Plan-quality bonus in a rematch; deliberately small', '[E]', 0, 0.2),

  // ======================================================= pacing intent (§2.5.7 leftovers owned here)
  n('ai.pace.default_target', 14, 'strikes/min', 'Intended pace when no plan says otherwise', '[E]', 1, 60),
  n('ai.pace.composure_threshold', 40, '0-100', 'Composure below which the fighter rushes round 1', '[E]', 0, 100),
  w('ai.pace.composure_rush_r1', 1.30, 'Round-1 intended pace below that composure', '[S: MMA_INTEGRATION §7.6 (est.)]'),
  n('ai.pace.composure_rush_s', 120, 's', 'How long the rush lasts', '[S: MMA_INTEGRATION §7.6 (est.)]', 0, 600),
  w('ai.pace.composure_rush_r2', 0.70, 'Round-2 output after rushing round 1', '[S: MMA_INTEGRATION §7.6 (est.)]'),

  // ======================================================= adaptation (§2.6.1-2.6.2)
  n('ai.eval.t_eval.t2', 90, 's', 'Tactical evaluation cadence at iqTier 2', MIS73, 1, 600),
  n('ai.eval.t_eval.t3', 60, 's', 'Tactical evaluation cadence at iqTier 3', MIS73, 1, 600),
  n('ai.eval.t_eval.t4', 30, 's', 'Tactical evaluation cadence at iqTier 4', MIS73, 1, 600),
  n('ai.eval.t_eval.t5', 20, 's', 'Tactical evaluation cadence at iqTier 5', MIS73, 1, 600),
  p('ai.eval.p_change.t1', 0.30, 'P(the intent changes | a signal) at iqTier 1', MIS73),
  p('ai.eval.p_change.t2', 0.50, 'P(change | signal) at iqTier 2', MIS73),
  p('ai.eval.p_change.t3', 0.70, 'P(change | signal) at iqTier 3', MIS73),
  p('ai.eval.p_change.t4', 0.85, 'P(change | signal) at iqTier 4', MIS73),
  p('ai.eval.p_change.t5', 0.95, 'P(change | signal) at iqTier 5', MIS73),
  p('ai.eval.p_change_cap', 0.98, 'Cap after the adaptability term is applied', '[S: 01 §2.5]'),
  n('ai.eval.adaptability_floor', 0.7, 'coefficient', 'P(change) multiplier at adaptability 0', '[S: 01 §2.5]', 0, 2),
  n('ai.eval.adaptability_span', 0.6, 'coefficient', 'Added to that multiplier at adaptability 100', '[S: 01 §2.5]', 0, 2),
  n('ai.eval.dwell.t2', 45, 's', 'Minimum dwell before a signal may revert an adjustment, iqTier 2', MIS73, 0, 300),
  n('ai.eval.dwell.t3', 30, 's', 'Minimum dwell at iqTier 3', MIS73, 0, 300),
  n('ai.eval.dwell.t4', 20, 's', 'Minimum dwell at iqTier 4', MIS73, 0, 300),
  n('ai.eval.dwell.t5', 15, 's', 'Minimum dwell at iqTier 5', MIS73, 0, 300),

  n('ai.effiq.damage_threshold', 0.60, 'fraction', 'Structural damage (of the TKO threshold) that costs a tier', MIS73, 0, 1),
  n('ai.effiq.fatigue_threshold', 0.70, 'fraction', 'Fatigue that costs a tier', MIS73, 0, 1),
  n('ai.effiq.kd_window', 20, 's', 'Window after a knockdown suffered in which a tier is lost', MIS73, 0, 120),
  n('ai.effiq.rocked_extra', 1, 'tiers', 'Further tiers lost while rocked', '[E]', 0, 3),

  p('ai.adj.drop_family.hit_rate', 0.25, 'Hit rate below which a family is dropped', MIS72),
  n('ai.adj.drop_family.min_attempts', 6, 'count', 'Attempts needed before the hit rate means anything', MIS72, 1, 40),
  w('ai.adj.drop_family.mult', 0.6, 'Weight on the dropped family', MIS72),
  w('ai.adj.drop_family.feint', 1.3, 'Feints while the family is dropped', MIS72),
  w('ai.adj.drop_family.best', 1.3, 'Weight on the best-performing family instead', MIS72),
  n('ai.adj.defend_family.heavy_count', 2, 'count', 'Heavy strikes from one family that trigger the defensive bias', MIS72, 1, 10),
  w('ai.adj.defend_family.counter', 1.3, 'Counter windows against that family', MIS72),
  w('ai.adj.defend_family.guard', 1.4, 'Block and check weight against that family', MIS72),
  n('ai.adj.td_stuffed.count', 2, 'count', 'Consecutive stuffed shots that trigger the switch', MIS72, 1, 6),
  w('ai.adj.td_stuffed.rear_kick', 1.2, 'A striker\'s rear kicks after stuffing two shots (confidence)', MIS72),
  w('ai.adj.td_stuffed.clinch', 1.6, 'A wrestler\'s clinch entries instead of more shots', MIS72),
  n('ai.adj.taken_down.count', 2, 'count', 'Takedowns conceded that trigger the stand-up urgency', MIS72, 1, 6),
  w('ai.adj.taken_down.stand_up', 2.0, 'Stand-up and wall-walk weight after two takedowns', MIS72),
  w('ai.adj.taken_down.kicks', 0.3, 'Kicks after two takedowns', MIS72),
  w('ai.adj.taken_down.range_weapons', 1.3, 'Jab and teep after two takedowns', MIS72),
  w('ai.adj.opp_tired.pressure', 1.3, 'Pressure against a tired opponent', MIS72),
  w('ai.adj.opp_tired.clinch', 1.2, 'Clinch grind against a tired opponent with a strength edge', MIS72),
  w('ai.adj.opp_tired.td', 1.2, 'Takedown attempts against a tired opponent', MIS72),
  n('ai.adj.opp_tired.combo_delta', 1, 'strikes', 'Extra beat in the combination against a tired opponent', MIS72, 0, 3),
  n('ai.adj.self_low_stamina.f', 0.60, 'fraction', 'Own fatigue in R1/R2 that triggers economy mode', MIS72, 0, 1),
  w('ai.adj.self_low_stamina.kicks', 0.6, 'Kicks in economy mode', MIS72),
  w('ai.adj.self_low_stamina.pace', 0.8, 'Intended pace in economy mode', MIS72),
  w('ai.adj.cut_vision.retreat', 1.2, 'Retreat with an impaired eye', MIS72),
  n('ai.adj.cut_vision.s', 20, 's', 'How long that bias lasts', MIS72, 0, 120),
  n('ai.adj.cage_trapped.exchanges', 3, 'count', 'Fence exchanges in 30 s that count as trapped', '[E]', 1, 10),
  w('ai.adj.cage_trapped.circle_off', 1.5, 'Circle-off weight once trapped', '[E]'),
  n('ai.adj.leg_damaged.structural', 30, 'damage', 'Lead-leg structural damage that triggers the leg rules', '[S: DAMAGE_PHYSIOLOGY §7 rule 9]', 0, 100),
  w('ai.adj.leg_damaged.switch', 1.5, 'Stance switch with a damaged lead leg', '[E]'),
  w('ai.adj.leg_damaged.check', 1.4, 'Checking with a damaged lead leg', '[E]'),
  w('ai.adj.leg_damaged.kicks', 0.5, 'Kicking with the damaged leg', '[E]'),
  w('ai.adj.opp_leg_damaged.low_kick', 1.5, 'Low kicks to a damaged leg', '[E]'),
  w('ai.adj.opp_leg_damaged.td', 1.2, 'Takedowns against a damaged leg', '[E]'),
  n('ai.adj.trap_repeat_count', 3, 'count', 'Identical responses to a setup before the T5 trap is set', '[E]', 1, 10),
  w('ai.adj.trap_set.feint', 1.5, 'Feints once the trap is set', '[E]'),
  w('ai.adj.t4_overthink', 0.9, 'Lead families after a failed trap (T4 passivity)', '[E]'),
  n('ai.adj.t4_overthink_s', 20, 's', 'How long that passivity lasts', '[E]', 0, 120),

  // ======================================================= score awareness (§2.6.3)
  n('ai.score.sigma.t1', 1.0, 'rounds', 'Score-estimate noise at iqTier 1', MIS74, 0, 5),
  n('ai.score.sigma.t2', 0.7, 'rounds', 'Score-estimate noise at iqTier 2', MIS74, 0, 5),
  n('ai.score.sigma.t3', 0.5, 'rounds', 'Score-estimate noise at iqTier 3', MIS74, 0, 5),
  n('ai.score.sigma.t4', 0.3, 'rounds', 'Score-estimate noise at iqTier 4', MIS74, 0, 5),
  n('ai.score.sigma.t5', 0.2, 'rounds', 'Score-estimate noise at iqTier 5', MIS74, 0, 5),
  n('ai.score.corner_sigma_mult', 0.5, 'x', 'The corner sees the cards with half that noise', MIS74, 0, 1),
  n('ai.score.open_sigma', 0, 'rounds', 'SC-0: under open scoring nobody is guessing', '[S: 09 §2.5]', 0, 0, false),
  w('ai.score.SC2.pace', 1.25, 'Intended pace one round down entering the final round', MIS74),
  w('ai.score.SC2.td', 0.80, 'Takedown attempts in that state (milder than the measured -38 %)', MIS74),
  n('ai.score.SC2.risk_delta', 1, 'steps', 'Risk-appetite change in that state', MIS74, -2, 2),
  w('ai.score.SC2.late_volume', 1.30, 'Volume in the last 60 s in that state', MIS74),
  w('ai.score.SC3.power', 1.50, 'Power strikes when a finish is needed', MIS74),
  w('ai.score.SC3.td', 0.60, 'Takedown attempts when a finish is needed', '[S: FIGHT_DATA #129]'),
  w('ai.score.SC3.td_sub_spec', 1.30, 'Takedowns instead, for a submission specialist', MIS74),
  w('ai.score.SC3.submission', 1.60, 'Submission attempts for that specialist', MIS74),
  w('ai.score.SC3.defence', 0.70, 'Defensive families when a finish is needed', MIS74),
  n('ai.score.SC3.sub_tier_gap', 2, 'tiers', 'Submission-tier edge over the opponent\'s bottom game that flips SC-3 to grappling', MIS74, 0, 5),
  n('ai.score.SC4.risk_delta', -1, 'steps', 'Risk-appetite change when ahead (no coasting)', MIS74, -2, 2),
  w('ai.score.SC4.control', 1.20, 'A wrestler\'s takedown-to-control when ahead', MIS74),
  w('ai.score.SC4.counter', 1.20, 'A striker\'s counter mode when ahead', MIS74),
  n('ai.score.SC4.min_iq_tier', 3, 'tier', 'Lowest iqTier that acts on being ahead at all', MIS74, 0, 5),

  // ======================================================= hurt and finisher (§2.6.4-2.6.5)
  n('ai.hurt.duration_min', 10, 's', 'Shortest hurt-behaviour window', MIS75, 0, 120),
  n('ai.hurt.duration_max', 20, 's', 'Longest hurt-behaviour window', MIS75, 0, 120),
  w('ai.hurt.grappler_clinch', 2.0, 'A grappler\'s shoot or clinch while hurt (it buys time)', MIS75),
  w('ai.hurt.striker_circle', 2.0, 'A striker with footwork circling away while hurt', MIS75),
  w('ai.hurt.novice_cover', 2.0, 'A novice covering on the fence while hurt — the worst option', MIS75),
  w('ai.hurt.elite_clinch', 2.5, 'An elite fighter clinching or level-changing immediately', MIS75),
  w('ai.hurt.t5_counter', 1.3, 'A champion still countering while hurt', MIS75),
  w('ai.hurt.inexperienced_trade', 1.5, 'Inexperience biases toward trading while hurt', '[S: DAMAGE_PHYSIOLOGY §7 rule 6]'),
  n('ai.hurt.experience_threshold', 0.30, 'fraction', 'Career experience below which that bias applies', '[E]', 0, 1),
  n('ai.hurt.heart_shell_coef', 0.5, 'coefficient', 'P(shell or turn away | rocked) = this x (1 - heart/100) for T0-T2', '[S: 01 §2.5]', 0, 1),
  w('ai.finish.reckless_swing', 2.0, 'Swinging families against a hurt opponent (reckless)', MIS75),
  w('ai.finish.reckless_defence', 0.5, 'Defensive families while swinging', MIS75),
  w('ai.finish.reckless_drain', 2.0, 'Stamina drain while swinging (a 05 input)', MIS75),
  n('ai.finish.reckless_aggression', 80, '0-100', 'Aggression that forces the reckless profile', '[E]', 0, 100),
  n('ai.finish.reckless_composure', 50, '0-100', 'Composure below which it is forced', '[E]', 0, 100),
  w('ai.finish.measured_straights', 1.5, 'Straight punches and knees against a hurt opponent (measured)', MIS75),
  n('ai.finish.measured_balance_floor', 0.60, 'fraction', 'Balance the measured finisher will not go below', MIS75, 0, 1),
  p('ai.finish.measured_stop_hit_rate', 0.40, 'Hit rate below which the measured finisher returns to the plan', MIS75),
  n('ai.finish.measured_stop_attempts', 8, 'count', 'Attempts over which that rate is measured', MIS75, 1, 40),
  p('ai.finish.trap_bite_bonus', 0.20, 'Extra bite probability the T5 trap buys on a hurt opponent'),
  w('ai.finish.ground_strike_on_downed', 3.0, 'Ground strikes on a downed hurt opponent, every tier'),

  // ======================================================= corner (§2.6.6)
  p('ai.corner.correct.t1', 0.40, 'P(the cue is the right adjustment) for a T1 corner', MIS77),
  p('ai.corner.correct.t2', 0.55, 'P(right cue) for a T2 corner', MIS77),
  p('ai.corner.correct.t3', 0.70, 'P(right cue) for a T3 corner', MIS77),
  p('ai.corner.correct.t4', 0.85, 'P(right cue) for a T4 corner', MIS77),
  p('ai.corner.correct.t5', 0.95, 'P(right cue) for a T5 corner', MIS77),
  n('ai.corner.uptake_base', 0.4, 'probability', 'Uptake before the tier and adaptability terms', '[S: 01 §3.0 beh.gen.corner_uptake]', 0, 1),
  n('ai.corner.uptake_per_tier', 0.1, 'probability', 'Uptake added per iqTier', '[S: 01 §3.0 beh.gen.corner_uptake]', 0, 1),
  n('ai.corner.uptake_adaptability', 0.1, 'probability', 'Uptake added at adaptability 100 relative to 50', '[S: 01 §2.5]', 0, 1),
  n('ai.corner.uptake_damage_penalty', 0.2, 'probability', 'Uptake lost when structural damage is past 60 %', MIS77, 0, 1),
  n('ai.corner.uptake_contradiction_penalty', 0.1, 'probability', 'Uptake lost when the cue contradicts the primary mode', MIS77, 0, 1),
  w('ai.corner.pace_cue_mult', 0.5, 'Pace cues at T4+: elite fighters pace by internal cues', '[S: MMA_INTEGRATION §7.6]'),
  n('ai.corner.pace_cue_min_tier', 4, 'tier', 'Tier from which that halving applies', '[S: MMA_INTEGRATION §7.6]', 0, 5),
  n('ai.corner.affirm_composure', 10, '0-100', 'Composure the affirmation buys for the next round', '[S: MMA_INTEGRATION §7.7]', 0, 50),
  n('ai.corner.default_tier_offset', 1, 'tiers', 'Default corner tier is the fighter\'s iqTier minus this, floor T1', '[E]', 0, 3),
];
