/**
 * IN-FIGHT ADAPTATION — the tactical layer of §2.6.
 *
 * Fighters do not re-plan continuously. They re-plan in bursts: after being
 * hurt, after a takedown, between rounds. So this layer runs on a cadence
 * (never / 90 / 60 / 30 / 20 s by IQ tier) plus event triggers, and each
 * evaluation only *may* change the intent — `P(change | signal)` is 0.30 at T1
 * and 0.95 at T5, which is most of what "he adjusted" means as a visible
 * behaviour.
 *
 * Four things live here:
 *   - the sixteen `adj.*` rows (§2.6.1), each a set of family multipliers with
 *     a dwell timer that stops the same signal oscillating the intent;
 *   - the effective-IQ reduction (§2.6.2): hurt or empty, a fighter executes
 *     the plan he wrote down one tier worse, which is failure mode 3 of §2.5.9;
 *   - score awareness SC-0..5 (§2.6.3), with the belief noise that makes a T1
 *     fighter genuinely wrong about the cards — and exactly zero noise under
 *     open scoring;
 *   - the hurt (§2.6.4), finisher (§2.6.5) and corner (§2.6.6) blocks.
 */
import type { ActionFamily, ModeId } from './contracts';
import type { PlanView } from './planview';
import type { ExchangeLedger } from './perceive';

/** `intent.riskAppetite` (§2.6): -2 gun-shy .. +2 all-in. */
export type RiskLevel = -2 | -1 | 0 | 1 | 2;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number): number => clamp(v, 0, 1);
const tierIndex = (t: number): number => Math.max(0, Math.min(5, Math.round(t)));

export type EmergencyKind = null | 'hurt' | 'finish' | 'survive' | 'stealRound' | 'needFinish';

// ---------------------------------------------------------------------------
// §2.6.2 — cadence, P(change) and dwell
// ---------------------------------------------------------------------------

/** `ai.eval.T_eval.tier`; Infinity means "never mid-round" (T0 and T1). */
export const T_EVAL_S_BY_IQ: readonly number[] =
  [Infinity, Infinity, 90, 60, 30, 20];
/** `ai.eval.p_change.tier`. */
export const P_CHANGE_BY_IQ: readonly number[] = [0, 0.30, 0.50, 0.70, 0.85, 0.95];
/** `ai.eval.dwell.tier`, seconds; Infinity = "until the break" (T1). */
export const DWELL_S_BY_IQ: readonly number[] = [Infinity, Infinity, 45, 30, 20, 15];

/**
 * Events that force an evaluation regardless of the cadence, by the lowest IQ
 * tier that notices them (§2.6.2). A T1 fighter re-evaluates only after a
 * knockdown; a T5 re-evaluates when the *opponent* adjusts.
 */
export type EvalTrigger =
  | 'knockdown' | 'takedown' | 'tdStuffedX2' | 'selfHurt' | 'hitRateCollapse' | 'oppAdjusted';

export const TRIGGER_MIN_IQ: Readonly<Record<EvalTrigger, number>> = Object.freeze({
  knockdown: 1,
  takedown: 2,
  tdStuffedX2: 3,
  selfHurt: 3,
  hitRateCollapse: 4,
  oppAdjusted: 5,
});

export function evaluationDue(
  effectiveIqTier: number,
  sinceLastEvalS: number,
  triggers: readonly EvalTrigger[],
): boolean {
  const tier = tierIndex(effectiveIqTier);
  if (tier === 0) return false;
  for (const t of triggers) {
    if (tier >= TRIGGER_MIN_IQ[t]) return true;
  }
  const cadence = T_EVAL_S_BY_IQ[tier];
  return Number.isFinite(cadence) && sinceLastEvalS >= cadence;
}

/**
 * `P(change | signal) = base(iqTier) x (0.7 + 0.6 x adaptability/100)`,
 * clamped at 0.98 (§3). Personality is what separates two fighters with the
 * same fight IQ: one acts on what he notices, the other files it away.
 */
export function pChange(effectiveIqTier: number, adaptability: number): number {
  const base = P_CHANGE_BY_IQ[tierIndex(effectiveIqTier)];
  return Math.min(0.98, base * (0.7 + 0.6 * clamp01(adaptability / 100)));
}

/** Minimum seconds before the same signal may revert an adjustment. */
export function minDwellS(effectiveIqTier: number): number {
  return DWELL_S_BY_IQ[tierIndex(effectiveIqTier)];
}

// ---------------------------------------------------------------------------
// §2.6.2 — effective IQ
// ---------------------------------------------------------------------------

/** `ai.effiq.*`. */
export const EFFIQ_DAMAGE_THRESHOLD = 0.60;
export const EFFIQ_FATIGUE_THRESHOLD = 0.70;
export const EFFIQ_KD_WINDOW_S = 20;

export interface EffectiveIqInput {
  iqTier: number;
  /** Structural damage as a fraction of the TKO threshold. */
  damageFrac: number;
  /** Fatigue index `f`, 0-1. */
  fatigue: number;
  /** Seconds since the last knockdown suffered; Infinity when there was none. */
  sinceKnockdownS: number;
  rocked: boolean;
}

/**
 * The plan is written down and does not degrade; the ability to execute it
 * does. Hurt, empty or freshly dropped costs a tier, and being rocked costs
 * another on top.
 */
export function effectiveIqTier(x: EffectiveIqInput): 0 | 1 | 2 | 3 | 4 | 5 {
  let tier = tierIndex(x.iqTier);
  const degraded = x.damageFrac > EFFIQ_DAMAGE_THRESHOLD
    || clamp01(x.fatigue) >= EFFIQ_FATIGUE_THRESHOLD
    || x.sinceKnockdownS <= EFFIQ_KD_WINDOW_S;
  if (degraded) tier -= 1;
  if (x.rocked) tier -= 1;
  return Math.max(0, tier) as 0 | 1 | 2 | 3 | 4 | 5;
}

// ---------------------------------------------------------------------------
// §2.6.1 — the sixteen adjustment rows
// ---------------------------------------------------------------------------

export type AdjustmentId =
  | 'adj.drop_family' | 'adj.defend_family' | 'adj.td_stuffed_x2' | 'adj.taken_down_x2'
  | 'adj.opp_tired' | 'adj.opp_hurt' | 'adj.self_low_stamina' | 'adj.behind_final'
  | 'adj.need_finish' | 'adj.ahead' | 'adj.cut_vision' | 'adj.cage_trapped'
  | 'adj.opp_adjusted' | 'adj.leg_damaged' | 'adj.opp_leg_damaged' | 'adj.trap_set';

export const ADJUSTMENT_IDS: readonly AdjustmentId[] = [
  'adj.drop_family', 'adj.defend_family', 'adj.td_stuffed_x2', 'adj.taken_down_x2',
  'adj.opp_tired', 'adj.opp_hurt', 'adj.self_low_stamina', 'adj.behind_final',
  'adj.need_finish', 'adj.ahead', 'adj.cut_vision', 'adj.cage_trapped',
  'adj.opp_adjusted', 'adj.leg_damaged', 'adj.opp_leg_damaged', 'adj.trap_set',
];

/** The signal side of one row, computed from the ledger and the perceived state. */
export interface AdaptSignals {
  /** The family whose hit rate has collapsed, with >= 6 attempts. */
  collapsedFamily: ActionFamily | null;
  /** The family we have most on the best hit rate, for the swap. */
  bestFamily: ActionFamily | null;
  /** A technique family we have eaten >= 2 heavy strikes from. */
  threatFamily: ActionFamily | null;
  ownTdStuffedX2: boolean;
  takenDownX2: boolean;
  oppTired: boolean;
  oppHurt: boolean;
  ownFatigue: number;
  round: number;
  finalRound: boolean;
  /** Rounds up as this fighter believes them; negative means behind. */
  perceivedRoundsUp: number;
  /** Rounds needed to be behind enough for SC-3, by format. */
  needFinishDeficit: number;
  ownVisionImpaired: boolean;
  cageExchanges: number;
  oppAdjusted: boolean;
  ownLegDamaged: boolean;
  oppLegDamaged: boolean;
  /** The opponent has answered the same setup the same way >= 3 times. */
  trapReady: boolean;
  /** `losingBehaviour: 'unchanged'` disables SC-2 and SC-3 (§2.6.3). */
  losingBehaviourUnchanged: boolean;
  /**
   * 01 §2.6 `whenLosing`: what this fighter *does* about being behind, once
   * SC-2 has fired. It shapes the adjustment rather than gating it — `hold` is
   * already handled by `losingBehaviourUnchanged` above. Optional: absent is
   * the §2.6.3 default, `press`.
   */
  whenLosing?: 'press' | 'stall' | 'gamble' | 'hold';
  /** Style hooks that select among the variants. */
  isWrestler: boolean;
  isStriker: boolean;
  strengthEdge: boolean;
  subSpecialist: boolean;
}

export interface Adjustment {
  id: AdjustmentId;
  /** Multipliers folded into `w_adapt` (§2.2.3). */
  weights: Partial<Record<ActionFamily, number>>;
  /** Policy changes the intent takes on. */
  policy?: {
    mode?: ModeId;
    initiative?: 'lead' | 'counter' | 'mixed';
    cagePolicy?: 'centre' | 'cut' | 'circleAway';
    riskDelta?: number;
    paceMult?: number;
    comboCapDelta?: number;
    emergency?: EmergencyKind;
  };
  source: 'self' | 'corner' | 'plan';
  sinceTick: number;
  dwellUntilTick: number;
  /** The signal that produced it, for `evt.adjust.applied` and the panel. */
  trigger: string;
  label: string;
}

interface AdjustmentRow {
  id: AdjustmentId;
  minIqTier: number;
  fires(s: AdaptSignals): boolean;
  build(s: AdaptSignals): Pick<Adjustment, 'weights' | 'policy' | 'label'>;
  trigger: string;
}

/** `ai.adj.drop_family`: hit-rate < 25 % over >= 6 attempts. */
export const DROP_FAMILY_HIT_RATE = 0.25;
export const DROP_FAMILY_MIN_ATTEMPTS = 6;
/** `ai.adj.cage_trapped`. */
export const CAGE_TRAPPED_EXCHANGES = 3;
/** `ai.adj.self_low_stamina`. */
export const LOW_STAMINA_F = 0.60;
/** `ai.adj.trap_repeat_count`. */
export const TRAP_REPEAT_COUNT = 3;

/**
 * The §2.6.1 table, verbatim, as data. Each row is `signal -> multipliers`,
 * gated by the minimum IQ tier that can produce it; the tier gate is why a T1
 * fighter's only in-fight change comes from his corner.
 */
export const ADJUSTMENT_ROWS: readonly AdjustmentRow[] = [
  {
    id: 'adj.drop_family', minIqTier: 3, trigger: 'hitRateCollapse',
    fires: (s) => s.collapsedFamily !== null,
    build: (s) => {
      const weights: Partial<Record<ActionFamily, number>> = {};
      if (s.collapsedFamily) weights[s.collapsedFamily] = 0.6;
      weights.feint = 1.3;
      if (s.bestFamily && s.bestFamily !== s.collapsedFamily) weights[s.bestFamily] = 1.3;
      return { weights, label: `the ${s.collapsedFamily ?? 'lead'} is not landing` };
    },
  },
  {
    id: 'adj.defend_family', minIqTier: 2, trigger: 'heavyAbsorbed',
    fires: (s) => s.threatFamily !== null,
    build: (s) => ({
      weights: { block: 1.4, check: 1.4, counterWindow: 1.3 },
      label: `he keeps landing that ${s.threatFamily ?? 'shot'}`,
    }),
  },
  {
    id: 'adj.td_stuffed_x2', minIqTier: 2, trigger: 'tdStuffedX2',
    fires: (s) => s.ownTdStuffedX2,
    build: (s) => (s.isWrestler
      ? {
        weights: { clinchEntry: 1.6, cagePin: 1.5, nakedShot: 0.3, shoot: 0.5 },
        label: 'shots are not there — go to the fence',
      }
      : {
        weights: { rearKick: 1.2, bodyKick: 1.2 },
        label: 'the shots are stuffed; back to striking',
      }),
  },
  {
    id: 'adj.taken_down_x2', minIqTier: 2, trigger: 'takenDownX2',
    fires: (s) => s.takenDownX2,
    build: () => ({
      weights: {
        standUp: 2.0, wallWalk: 2.0, jab: 1.3, teep: 1.3,
        lowKick: 0.3, bodyKick: 0.3, headKick: 0.3, rearKick: 0.3, leadLowKick: 0.3,
      },
      policy: { cagePolicy: 'centre', mode: 'mode.counter_striking' },
      label: 'stop getting taken down — hands only, centre of the cage',
    }),
  },
  {
    id: 'adj.opp_tired', minIqTier: 2, trigger: 'oppTired',
    fires: (s) => s.oppTired,
    build: (s) => ({
      weights: {
        advance: 1.3, clinchEntry: s.strengthEdge ? 1.2 : 1.0,
        shoot: 1.2, shootOffStrikes: 1.2, bodylockTd: 1.2,
      },
      policy: { comboCapDelta: 1 },
      label: 'he is fading — press him',
    }),
  },
  {
    id: 'adj.opp_hurt', minIqTier: 0, trigger: 'oppHurt',
    fires: (s) => s.oppHurt,
    build: () => ({ weights: {}, policy: { emergency: 'finish' }, label: 'he is hurt' }),
  },
  {
    id: 'adj.self_low_stamina', minIqTier: 2, trigger: 'lowStamina',
    fires: (s) => s.ownFatigue >= LOW_STAMINA_F && s.round <= 2,
    build: (s) => ({
      weights: {
        lowKick: 0.6, bodyKick: 0.6, headKick: 0.6, rearKick: 0.6, leadLowKick: 0.6,
        clinchEntry: s.strengthEdge ? 1.4 : 1.0, wait: 1.3,
        nakedShot: 0.3,
      },
      policy: { paceMult: 0.8 },
      label: 'the tank is low — economy mode',
    }),
  },
  {
    id: 'adj.behind_final', minIqTier: 2, trigger: 'behindFinal',
    fires: (s) => s.finalRound && s.perceivedRoundsUp <= -1
      && s.perceivedRoundsUp > -s.needFinishDeficit && !s.losingBehaviourUnchanged,
    build: (s) => ({
      weights: { shoot: 0.8, nakedShot: 0.8, bodylockTd: 0.8, shootOffStrikes: 0.8 },
      // 01 §2.6 `whenLosing`: the gambler empties the clip, the staller does
      // not change the pace he is already losing with, `press` is the default
      // §2.6.3 row.
      policy: {
        paceMult: s.whenLosing === 'gamble' ? 1.35 : s.whenLosing === 'stall' ? 1.0 : 1.25,
        riskDelta: s.whenLosing === 'gamble' ? 2 : s.whenLosing === 'stall' ? 0 : 1,
        emergency: 'stealRound',
      },
      label: s.whenLosing === 'gamble'
        ? 'down a round — go and get it'
        : 'down a round — steal it on volume',
    }),
  },
  {
    id: 'adj.need_finish', minIqTier: 2, trigger: 'needFinish',
    fires: (s) => s.perceivedRoundsUp <= -s.needFinishDeficit && !s.losingBehaviourUnchanged,
    build: (s) => (s.subSpecialist
      ? {
        weights: {
          shoot: 1.3, shootOffStrikes: 1.3, bodylockTd: 1.3,
          submission: 1.6, bottomSubmission: 1.6,
          block: 0.7, check: 0.7, longGuard: 0.7, retreat: 0.7,
        },
        policy: { riskDelta: 2, emergency: 'needFinish' },
        label: 'he needs the submission',
      }
      : {
        weights: {
          cross: 1.5, hook: 1.5, overhand: 1.5, uppercut: 1.5, leadHook: 1.5,
          headKick: 1.5, knee: 1.5,
          shoot: 0.6, nakedShot: 0.6, bodylockTd: 0.6, shootOffStrikes: 0.6,
          block: 0.7, check: 0.7, longGuard: 0.7, retreat: 0.7,
        },
        policy: { riskDelta: 2, emergency: 'needFinish' },
        label: 'he needs a finish — headhunting',
      }),
  },
  {
    id: 'adj.ahead', minIqTier: 3, trigger: 'ahead',
    fires: (s) => s.perceivedRoundsUp >= 1,
    build: (s) => ({
      weights: s.isWrestler
        ? { ride: 1.2, cagePin: 1.2, bodylockTd: 1.2 }
        : { counterWindow: 1.2, parryCross: 1.2 },
      policy: { riskDelta: -1, cagePolicy: 'centre', comboCapDelta: -1 },
      label: 'ahead — no need to gamble',
    }),
  },
  {
    id: 'adj.cut_vision', minIqTier: 1, trigger: 'visionImpaired',
    fires: (s) => s.ownVisionImpaired,
    build: () => ({
      weights: { retreat: 1.2, circleAway: 1.2, block: 1.2 },
      label: 'the eye is closing',
    }),
  },
  {
    id: 'adj.cage_trapped', minIqTier: 2, trigger: 'cageTrapped',
    fires: (s) => s.cageExchanges >= CAGE_TRAPPED_EXCHANGES,
    build: (s) => ({
      weights: { circleAway: 1.5, pivot: 1.5, lateral: 1.5 },
      policy: s.isStriker ? { initiative: 'lead' } : undefined,
      label: 'he is living on the fence — get off it',
    }),
  },
  {
    id: 'adj.opp_adjusted', minIqTier: 5, trigger: 'oppAdjusted',
    fires: (s) => s.oppAdjusted,
    build: () => ({
      weights: { feint: 1.3, counterWindow: 1.2 },
      label: 'he has changed something',
    }),
  },
  {
    id: 'adj.leg_damaged', minIqTier: 2, trigger: 'ownLegDamaged',
    fires: (s) => s.ownLegDamaged,
    build: () => ({
      weights: {
        switchStance: 1.5, check: 1.4,
        lowKick: 0.5, leadLowKick: 0.5, bodyKick: 0.5, headKick: 0.5, rearKick: 0.5,
      },
      label: 'that leg is gone',
    }),
  },
  {
    id: 'adj.opp_leg_damaged', minIqTier: 2, trigger: 'oppLegDamaged',
    fires: (s) => s.oppLegDamaged,
    build: () => ({
      weights: {
        lowKick: 1.5, leadLowKick: 1.5,
        shoot: 1.2, shootOffStrikes: 1.2, bodylockTd: 1.2,
      },
      label: 'keep going to that leg',
    }),
  },
  {
    id: 'adj.trap_set', minIqTier: 5, trigger: 'trapReady',
    fires: (s) => s.trapReady,
    build: () => ({
      weights: { feint: 1.5, counterWindow: 1.5, baitCross: 1.5 },
      label: 'he showed that for a reason',
    }),
  },
];

/** The rows whose signal is live and whose tier gate this fighter passes. */
export function candidateAdjustments(
  s: AdaptSignals,
  effectiveIqTier: number,
  plan: PlanView | null,
): AdjustmentRow[] {
  const tier = tierIndex(effectiveIqTier);
  const gated = plan?.triggers;
  return ADJUSTMENT_ROWS.filter((row) => {
    if (tier < row.minIqTier) return false;
    if (!row.fires(s)) return false;
    // A plan that lists triggers restricts the set to those (§2.5.3 step 8);
    // `adj.opp_hurt` is reflexive and is never gated out.
    if (gated && gated.length > 0 && row.id !== 'adj.opp_hurt') {
      return gated.some((t) => t.adjustment === row.id);
    }
    return true;
  });
}

export function buildAdjustment(
  row: AdjustmentRow,
  s: AdaptSignals,
  tick: number,
  dwellTicks: number,
  source: 'self' | 'corner' | 'plan',
): Adjustment {
  const built = row.build(s);
  return {
    id: row.id,
    weights: built.weights,
    policy: built.policy,
    source,
    sinceTick: tick,
    dwellUntilTick: Number.isFinite(dwellTicks) ? tick + dwellTicks : Number.MAX_SAFE_INTEGER,
    trigger: row.trigger,
    label: built.label,
  };
}

/**
 * §2.6.1: contradicting adjustments resolve newest-wins, but only once the
 * older one's dwell has been satisfied. Returns the list with `incoming`
 * merged in, or unchanged when the dwell forbids it.
 */
export function applyAdjustment(
  active: Adjustment[],
  incoming: Adjustment,
  tick: number,
): Adjustment[] {
  const existing = active.findIndex((a) => a.id === incoming.id);
  if (existing >= 0) {
    // Re-firing the same signal inside its dwell refreshes nothing.
    if (tick < active[existing].dwellUntilTick) return active;
    const next = active.slice();
    next[existing] = incoming;
    return next;
  }
  const contradicts = active.filter((a) => contradictory(a.id, incoming.id));
  for (const c of contradicts) {
    if (tick < c.dwellUntilTick) return active;
  }
  return [...active.filter((a) => !contradictory(a.id, incoming.id)), incoming];
}

/** Rows that cannot both be in force. */
function contradictory(a: AdjustmentId, b: AdjustmentId): boolean {
  const scoreRows: AdjustmentId[] = ['adj.behind_final', 'adj.need_finish', 'adj.ahead'];
  if (scoreRows.includes(a) && scoreRows.includes(b)) return a !== b;
  if (a === 'adj.opp_tired' && b === 'adj.self_low_stamina') return false;
  return false;
}

/** Drop adjustments whose dwell has expired. */
export function expireAdjustments(active: Adjustment[], tick: number): Adjustment[] {
  return active.filter((a) => tick < a.dwellUntilTick);
}

/** `w_adapt(a)`: the product of every active adjustment's multiplier. */
export function adaptWeight(active: readonly Adjustment[], family: ActionFamily): number {
  let w = 1;
  for (const a of active) {
    const m = a.weights[family];
    if (m !== undefined) w *= m;
  }
  return w;
}

// ---------------------------------------------------------------------------
// §2.6.3 — score awareness
// ---------------------------------------------------------------------------

/** `ai.score.sigma.tier`, in rounds. T0 has no estimate at all. */
export const SCORE_SIGMA_BY_IQ: readonly number[] = [Infinity, 1.0, 0.7, 0.5, 0.3, 0.2];
/** `ai.score.corner_sigma_mult`. */
export const CORNER_SIGMA_MULT = 0.5;

export interface ScoreBeliefInput {
  /** The true running card from §06: rounds up, signed. */
  trueRoundsUp: number;
  effectiveIqTier: number;
  /** SC-0: `judgingMode === 'open'` zeroes sigma for fighter and corner alike. */
  openScoring: boolean;
  /** The corner's belief is half as noisy (§2.6.6). */
  isCorner: boolean;
  /** A standard normal, drawn once per round end. */
  z: number;
}

/**
 * SC-1. The belief is the truth plus noise, and a T1 fighter's sigma of 1.0
 * round means he is often simply wrong — which is the point (SC-5): the panel
 * shows both his belief and the real card.
 */
export function scoreBelief(x: ScoreBeliefInput): number {
  const tier = tierIndex(x.effectiveIqTier);
  if (tier === 0) return 0;
  if (x.openScoring) return x.trueRoundsUp;
  let sigma = SCORE_SIGMA_BY_IQ[tier];
  if (!Number.isFinite(sigma)) return 0;
  if (x.isCorner) sigma *= CORNER_SIGMA_MULT;
  return x.trueRoundsUp + sigma * x.z;
}

/** The deficit at which SC-3 fires: 2 rounds over 3, 3 rounds over 5. */
export function needFinishDeficit(scheduledRounds: number): number {
  return scheduledRounds >= 5 ? 3 : 2;
}

/** The 0-1 "I am ahead" number the HUD shows. */
export function beliefToConfidence(roundsUp: number): number {
  return clamp01(0.5 + 0.25 * roundsUp);
}

// ---------------------------------------------------------------------------
// §2.6.4 — hurt behaviour
// ---------------------------------------------------------------------------

export type HurtBehaviourId =
  | 'coverOnCage' | 'clinch' | 'shoot' | 'circleOut' | 'trade' | 'counter' | 'turnAway';

/** `ai.hurt.duration` = U(10, 20) s. */
export const HURT_DURATION_MIN_S = 10;
export const HURT_DURATION_MAX_S = 20;

export function hurtDurationS(u: number): number {
  return HURT_DURATION_MIN_S + (HURT_DURATION_MAX_S - HURT_DURATION_MIN_S) * clamp01(u);
}

export interface HurtProfileInput {
  effectiveIqTier: number;
  isGrappler: boolean;
  /** 0-100 `mmaIntegration.cageWork`; T3+ footwork is the circle-out gate. */
  cageWorkTier: number;
  /** 0-1 career experience; below 0.3 the fighter trades instead of covering. */
  experience: number;
  /** §01 `StyleProfile.hurtBehaviour`, when the author set one. */
  styleOverride?: HurtBehaviourId;
  /** 0-100 heart: scales P(shell / turn away) for T0-T2. */
  heart: number;
  /** A uniform for the heart roll; the caller supplies it, never draws it. */
  uHeart: number;
}

/**
 * §2.6.4. The row that fires is mostly the tier's: T0-T1 cover on the fence
 * (the worst option and the one they take), T2-T3 clinch or shoot, T4+ clinch
 * or level-change immediately, T5 may keep countering. The style override
 * replaces the row outright when the author set one.
 */
export function hurtBehaviour(x: HurtProfileInput): HurtBehaviourId {
  if (x.styleOverride) return x.styleOverride;
  const tier = tierIndex(x.effectiveIqTier);
  if (tier <= 2) {
    // `heart` scales P(shell / turn away): a low-heart novice turns away.
    const pShell = 0.5 * (1 - clamp01(x.heart / 100));
    if (clamp01(x.uHeart) < pShell) return tier === 0 ? 'turnAway' : 'coverOnCage';
  }
  if (x.experience < 0.3 && tier <= 2) return 'trade';
  if (tier <= 1) return 'coverOnCage';
  if (tier >= 4) return x.isGrappler || x.cageWorkTier < 3 ? 'clinch' : 'circleOut';
  // T2-T3.
  return x.isGrappler ? 'shoot' : x.cageWorkTier >= 3 ? 'circleOut' : 'clinch';
}

/** `ai.hurt.weights`: what the chosen behaviour does to the action weights. */
export function hurtWeights(
  behaviour: HurtBehaviourId,
  effectiveIqTier: number,
): Partial<Record<ActionFamily, number>> {
  const tier = tierIndex(effectiveIqTier);
  const elite = tier >= 4 ? 2.5 : 2.0;
  switch (behaviour) {
    case 'coverOnCage':
      return { block: 2.0, longGuard: 2.0, retreat: 2.0, wait: 1.5 };
    case 'turnAway':
      return { block: 2.0, retreat: 2.0, wait: 2.0 };
    case 'clinch':
      return { clinchEntry: elite, cagePin: 1.5, levelChange: elite };
    case 'shoot':
      return { shoot: elite, shootOffStrikes: elite, bodylockTd: 1.6, clinchEntry: 1.5 };
    case 'circleOut':
      return { circleAway: 2.0, circle: 2.0, lateral: 1.8, jab: 1.3, retreat: 1.4 };
    case 'trade':
      return { cross: 1.5, hook: 1.5, overhand: 1.5, leadHook: 1.5 };
    case 'counter':
      return { counterWindow: 1.3, parryCross: 1.3, check: 1.2, clinchEntry: 1.5 };
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// §2.6.5 — finisher logic
// ---------------------------------------------------------------------------

export type FinisherProfile = 'reckless' | 'measured' | 'trap';

/** `ai.finish.reckless` trigger attributes. */
export const RECKLESS_AGGRESSION = 80;
export const RECKLESS_COMPOSURE = 50;
/** `ai.finish.measured` stop rule. */
export const MEASURED_STOP_HIT_RATE = 0.40;
export const MEASURED_STOP_ATTEMPTS = 8;
/** `ai.finish.ground_strike_on_downed`. */
export const GROUND_STRIKE_ON_DOWNED = 3.0;

export function finisherProfile(
  effectiveIqTier: number,
  aggression: number,
  composure: number,
  oppChinTier: number,
): FinisherProfile {
  const tier = tierIndex(effectiveIqTier);
  if (aggression >= RECKLESS_AGGRESSION && composure < RECKLESS_COMPOSURE) return 'reckless';
  if (tier <= 2) return 'reckless';
  if (tier === 3) return oppChinTier <= 1 ? 'reckless' : 'measured';
  if (tier === 4) return 'measured';
  return 'trap';
}

export function finisherWeights(
  profile: FinisherProfile,
  oppDowned: boolean,
): Partial<Record<ActionFamily, number>> {
  const base: Partial<Record<ActionFamily, number>> = oppDowned
    ? { groundStrike: GROUND_STRIKE_ON_DOWNED }
    : {};
  if (profile === 'reckless') {
    return {
      ...base,
      hook: 2.0, leadHook: 2.0, overhand: 2.0, uppercut: 2.0, spinning: 2.0,
      block: 0.5, check: 0.5, longGuard: 0.5, retreat: 0.5, circle: 0.5,
    };
  }
  // Measured and trap share the straight-punches-and-knees shape; the trap
  // adds the feint, which the caller applies as a macro preference.
  return {
    ...base,
    jab: 1.5, cross: 1.5, knee: 1.5, teep: 1.2,
    ...(profile === 'trap' ? { feint: 1.6 } : {}),
    spinning: 0.6,
  };
}

/** The measured finisher's stop rule: back to the plan when it stops working. */
export function shouldStopFinishing(
  profile: FinisherProfile,
  ledger: ExchangeLedger,
): boolean {
  if (profile === 'reckless') return false;
  const attempts = ledger.attempts();
  if (attempts < MEASURED_STOP_ATTEMPTS) return false;
  return ledger.landed() / attempts < MEASURED_STOP_HIT_RATE;
}

// ---------------------------------------------------------------------------
// §2.6.6 — the corner
// ---------------------------------------------------------------------------

/** `ai.corner.correct.tier`: P(the cue is the *right* adjustment). */
export const CORNER_CORRECT_BY_TIER: readonly number[] = [0, 0.40, 0.55, 0.70, 0.85, 0.95];
/** `ai.corner.max_cues`. */
export const CORNER_MAX_CUES = 2;
/** `ai.corner.affirm`. */
export const CORNER_AFFIRM_COMPOSURE = 10;

/** `ai.corner.default_tier`: the fighter's own IQ tier - 1, floor T1. */
export function defaultCornerTier(iqTier: number): number {
  return Math.max(1, tierIndex(iqTier) - 1);
}

export interface CornerCueResult {
  /** The adjustment the corner asked for. */
  adjustment: AdjustmentId;
  /** Debug only: was it the right one? */
  correct: boolean;
  accepted: boolean;
  isPaceCue: boolean;
  text: string;
}

/**
 * CO-1. The corner picks from the same adjustment table, using its own ledger
 * view (half the fighter's noise). A wrong cue is a *different* row of the
 * table, not nothing — a bad corner still rewrites the weights, which is why a
 * T1 corner can actively cost its fighter a round.
 */
export function cornerCue(
  correctAdjustment: AdjustmentId | null,
  cornerTier: number,
  uCorrect: number,
  fallbackIndex: number,
): { adjustment: AdjustmentId; correct: boolean } {
  const pCorrect = CORNER_CORRECT_BY_TIER[tierIndex(cornerTier)];
  if (correctAdjustment !== null && clamp01(uCorrect) < pCorrect) {
    return { adjustment: correctAdjustment, correct: true };
  }
  const pool = ADJUSTMENT_IDS.filter((id) => id !== correctAdjustment);
  const idx = Math.min(pool.length - 1, Math.floor(clamp01(fallbackIndex) * pool.length));
  return { adjustment: pool[Math.max(0, idx)], correct: false };
}

export interface CornerUptakeInput {
  fighterIqTier: number;
  adaptability: number;
  /** Structural damage as a fraction of the TKO threshold. */
  damageFrac: number;
  /** The cue asks for something the primary mode says not to do. */
  contradictsPlan: boolean;
  isPaceCue: boolean;
}

/**
 * CO-2. `P(accept) = 0.4 + 0.1 x iqTier + 0.1 x (adaptability - 50)/50
 *                    - 0.2 [damage > 60 %] - 0.1 [contradiction]`,
 * and pace cues are halved at T4+, because elite fighters pace by internal
 * cues and do not change on corner feedback.
 */
export function cornerUptakeP(x: CornerUptakeInput): number {
  const tier = tierIndex(x.fighterIqTier);
  let p = 0.4 + 0.1 * tier + 0.1 * ((clamp(x.adaptability, 0, 100) - 50) / 50);
  if (x.damageFrac > 0.6) p -= 0.2;
  if (x.contradictsPlan) p -= 0.1;
  if (x.isPaceCue && tier >= 4) p *= 0.5;
  return clamp01(p);
}

/** CO-3: the corner may only call for a finish when *its* estimate supports it. */
export function cornerRiskCall(cornerBelief: number, deficit: number): RiskLevel {
  if (cornerBelief <= -deficit) return 2;
  if (cornerBelief <= -1) return 1;
  if (cornerBelief >= 1) return -1;
  return 0;
}
