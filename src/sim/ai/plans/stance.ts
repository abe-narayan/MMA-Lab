/**
 * STANCE RULES — chapter 07 §2.5.6 (ST-1 … ST-8).
 *
 * Southpaw vs orthodox is 34-34 in matched UFC bouts and the career edge is
 * ≈ +1.4 pp, not significant `[S: MMA_INTEGRATION §5]`, `[S: LIT_B §3.13-§3.16]`.
 * Whatever edge exists is a **familiarity** effect, which is why the only rule
 * here that costs anything is ST-5 (exposure < 3 fights) and why T4+ fighters
 * are immune to it. Everything else re-weights the technique mix: the open
 * stance opens the centre line (ST-3), collides the jabs (ST-2) and turns the
 * fight into a lead-foot battle (ST-1). Open-stance bouts finishing inside the
 * distance 18 % more often `[S: FIGHT_DATA §2.4]` is meant to fall out of the
 * straight-down-the-middle weights, not out of a bonus.
 *
 * The *dynamic* half of ST-1 (whose lead foot is outside, right now) is
 * `w_matchup` and is recomputed every tick by the action layer; the plan only
 * records the preference.
 */
import type { ActionWeightPatch, PlanRuleHit } from '../contracts';
import type { PlanContext } from './context';

/** `ai.read.familiarity_threshold` — fights against a stance before it is familiar. */
export const STANCE_FAMILIARITY_FIGHTS = 3;
/** `ai.rule.ST5` — per-exchange probability of circling the wrong way. */
export const WRONG_WAY_CIRCLE_P = 0.15;
/** ST-4: both fighters stand slightly further apart in an open stance. */
export const OPEN_STANCE_RANGE_OFFSET_M = 0.1;
/** ST-5 stops applying from this tier `[S: LIT_B §3.15]`. */
export const STANCE_FAMILIARITY_IMMUNE_TIER = 4;

const hit = (
  id: string, label: string, tag: string,
  weights: ActionWeightPatch, policy?: PlanRuleHit['policy'],
): PlanRuleHit => ({ id, kind: 'stance', label, weights, policy, tag });

export function stanceRules(ctx: PlanContext): PlanRuleHit[] {
  const out: PlanRuleHit[] = [];
  if (ctx.iqTier < 1) return out;

  const open = ctx.stancePair === 'open';
  const unfamiliar = ctx.stanceExposure < STANCE_FAMILIARITY_FIGHTS;

  // ST-5 is not a plan feature, it is a handicap: it applies from T1 and stops
  // at T4+ regardless of the plan's sophistication.
  if (unfamiliar && ctx.iqTier < STANCE_FAMILIARITY_IMMUNE_TIER) {
    out.push(hit(
      'ST-5', 'He has barely seen this stance: expect to circle the wrong way and to counter late.',
      '[S: MMA_INTEGRATION §5.1 ST-5 (est.)], [S: LIT_B §3.15]',
      { counterWindow: 0.9 },
    ));
  }

  // The rest of the stance table is a T3+ feature ("stance-aware", §2.5.8).
  if (ctx.iqTier < 3) return out;

  if (open) {
    out.push(hit(
      'ST-1', 'Win the lead-foot battle: keep your front foot outside his and circle that way.',
      '[S: MMA_INTEGRATION §5.1 ST-1 (est.)]',
      { circle: 1.5, pivot: 1.2 },
    ));
    out.push(hit(
      'ST-2', 'The jabs collide: fight the lead hand, parry and come back with the cross.',
      '[S: MMA_INTEGRATION §5.1 ST-2]',
      { jab: 0.75, parryCross: 1.4 },
    ));
    out.push(hit(
      'ST-3', 'Straight down the middle: the cross and the rear body kick land on the open side.',
      '[S: MMA_INTEGRATION §5.1 ST-3]',
      { cross: 1.4, bodyKick: 1.4, leadHook: 1.1 },
    ));
    out.push(hit(
      'ST-4', 'Open stance sits slightly longer, and the clinch is harder to enter.',
      '[S: MMA_INTEGRATION §5.1 ST-4]',
      { clinchEntry: 0.9 },
      { rangeOffsetM: OPEN_STANCE_RANGE_OFFSET_M },
    ));
    out.push(hit(
      'ST-6', 'With the dominant angle, the low kick to his lead leg is free.',
      '[S: MMA_INTEGRATION §5.1 ST-6 (est.)]',
      { leadLowKick: 1.3 },
    ));
  } else {
    out.push(hit(
      'ST-7', 'Closed stance: the jab and the lead hook are the tools, the rear body kick is not.',
      '[S: MMA_INTEGRATION §5.2 ST-7]',
      { jab: 1.2, leadHook: 1.1, lowKick: 1.1, bodyKick: 0.9, clinchEntry: 1.1 },
    ));
  }

  if (ctx.self.physical.stance === 'switch') {
    out.push(hit(
      'ST-8', 'Switch stance when the lead leg is being hurt or he has found the same side three times.',
      '[S: MMA_INTEGRATION §5.3 ST-8 (est.)], [S: BOXING §6]',
      { switchStance: 1.5 },
      { stanceSwitching: true },
    ));
  }

  return out;
}
