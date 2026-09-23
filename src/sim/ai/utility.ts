/**
 * UTILITY — the action layer of §2.2 (IAUS).
 *
 *     score(a) = base(a)
 *              x  PI_k comp( c_k(x_k(a)), n )
 *              x  clamp( w_style x w_pref x w_plan x w_adapt x w_matchup, 0.25, 3.0 )
 *              x  w_multi(a)
 *
 * `w_pref` is 01 §2.6's authored style preference for *this technique id*
 * (`ai/preferences.ts`). It is a sixth factor only in the bookkeeping sense:
 * it is bounded to the same [0.5, 2.0] band as `w_style` and enters the same
 * clamp, so the utility model's ceiling is unchanged and a preference biases
 * the choice without ever unlocking anything (the candidate has to exist
 * first). It is never a new roll — the draw schedule of 09 §2.7 is untouched.
 *
 * The shape is the Infinite Axis Utility System's: every consideration is a
 * response curve onto [0, 1] and the score is their product, with the
 * compensation factor that stops a product over many axes collapsing toward
 * zero. What is specific to a fight is *which* axes exist (§2.2.2, nineteen of
 * them) and that the winner is drawn from a softmax whose temperature is the
 * fighter's tier — argmax would make a rematch replay identically, and the
 * predictability ceiling (61.6 %) says fights are not that predictable.
 *
 * Nothing here reads the world. The caller assembles a `ConsiderationInputs`
 * from the *delayed* observation (§2.4.1) and hands it over; that is what keeps
 * a fighter from reacting to a punch that has not arrived.
 */
import type { ActionFamily } from './contracts';
import { WEIGHT_CLAMP_MAX, WEIGHT_CLAMP_MIN } from './contracts';
import {
  ADVANCING_FAMILIES, BALANCE_FAMILIES, COUNTER_FAMILIES, DEFENSIVE_FAMILIES, EXIT_FAMILIES,
  FINISH_FAMILIES, KICK_FAMILIES, LEAD_FAMILIES, MOVEMENT_FAMILIES, PRESSURE_FAMILIES,
  REST_FAMILIES, RETREATING_FAMILIES, SHOT_FAMILIES, STRIKE_FAMILIES,
} from './families';

// ---------------------------------------------------------------------------
// §2.9 — the nineteen `c.*` ids
// ---------------------------------------------------------------------------

export const CONSIDERATION_IDS = [
  'c.range_fit', 'c.range_target', 'c.own_fatigue', 'c.opp_fatigue', 'c.own_damage',
  'c.opp_hurt', 'c.cage', 'c.round_time', 'c.setup', 'c.expected_threat',
  'c.opp_recovery', 'c.balance', 'c.position_value', 'c.risk', 'c.mustnot',
  'c.pace', 'c.dwell', 'c.shield', 'c.lookahead',
] as const;

export type ConsiderationId = (typeof CONSIDERATION_IDS)[number];

export const CONSIDERATION_COUNT = CONSIDERATION_IDS.length;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * Everything the nineteen curves read, normalised once per tick per fighter.
 * Per-action terms (range fit, the action's own risk class) travel on the
 * candidate; everything here is shared by every candidate of that tick.
 */
export interface ConsiderationInputs {
  /** `f` in 0-1 (05's fatigue index). */
  ownFatigue: number;
  /** Perceived opponent fatigue, 0-1 — a cue estimate, never the true pool. */
  oppFatigue: number;
  /** 1 when the opponent is perceived rocked or hurt (§2.4.2 cue roll). */
  oppHurt: 0 | 1;
  /** Own distance to the fence, metres. */
  ownCageDistM: number;
  /** Perceived opponent distance to the fence, metres. */
  oppCageDistM: number;
  /** Seconds left in the round / round length, 1 at the bell. */
  roundTimeLeftFrac: number;
  /** True when this fighter believes they are behind on the cards. */
  behind: boolean;
  /** 1 when a strike was thrown or landed in the prior 1 s (§2.2.2 `c.setup`). */
  setupRecent: 0 | 1;
  /** Opponent model's P(opp attacks next | context), 0-1. */
  expectedThreat: number;
  /** 1 when the opponent is perceived to be in a technique's recovery phase. */
  oppInRecovery: 0 | 1;
  /** Own balance, 0-1. */
  balance: number;
  /** `intent.riskAppetite`, -2 .. +2. */
  riskAppetite: number;
  /** Own strike rate over the last 60 s divided by `intent.paceTarget`. */
  paceRatio: number;
  /** True when the pocket / clinch dwell limit of V-2 or F-2 is exceeded. */
  dwellExceeded: boolean;
  /** `[E]` reserved (§2.2.6); 0 with the lookahead disabled. */
  lookahead: number;
  /** Intended range in metres, from the live intent. */
  intentRangeM: number;
  /** Centre-to-centre distance to the target, metres. */
  distanceM: number;
  /** Effective IQ tier, 0-5: drives the `c.mustnot` slip rate. */
  effectiveIqTier: number;
}

/** Per-candidate terms of the score. */
export interface ScorableAction {
  family: ActionFamily;
  /** Catalogue prior for the family (§2.2.1). */
  base: number;
  /**
   * How well the distance suits this action: `|d - optimal| / tolerance`,
   * already normalised by the caller because only §02 knows the ranges.
   */
  rangeError: number;
  /** Risk class, 0 safe .. 1 gamble. */
  risk: number;
  /** Own damage in the region this action uses (leg for kicks, hand for punches), 0-1. */
  ownRegionDamage: number;
  /** §03/§04 node value of the destination, 0-1; 0.5 for actions that hold. */
  positionValue: number;
  /** True when the action is on the plan's `mustNots` list. */
  isMustNot: boolean;
  /** §2.7.3 `c.shield`: 1 when a clinch would occlude another hostile's line. */
  shield: number;
}

/**
 * The four multiplier vectors of §2.2.3 reduced to this one action, plus
 * `w_multi`. Named `WeightBundle` rather than `ActionWeights` because
 * `contracts.ActionWeights` is the family-keyed map a plan carries; this is the
 * scalar product of that map's entry with the three other sources.
 */
export interface WeightBundle {
  style: number;
  /**
   * 01 §2.6's authored preference for this candidate's own id
   * (`ai/preferences.preferenceWeight`). Optional so every existing caller and
   * test keeps meaning "no opinion"; bounded to `[PREF_CLAMP_MIN,
   * PREF_CLAMP_MAX]` before it enters the product.
   */
  pref?: number;
  plan: number;
  adapt: number;
  matchup: number;
  multi: number;
}

export const NEUTRAL_WEIGHTS: WeightBundle =
  Object.freeze({ style: 1, pref: 1, plan: 1, adapt: 1, matchup: 1, multi: 1 });

/**
 * `ai.pref.clamp` — the band a style preference may move a single action by,
 * before the §2.2.3 product clamp. Same range as `w_style` (§2.2.3), so the
 * preference channel is never wider than the style channel it belongs to.
 */
export const PREF_CLAMP_MIN = 0.5;
export const PREF_CLAMP_MAX = 2.0;

/** The bounded preference factor. Non-finite and absent both mean "no opinion". */
export function preferenceFactor(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v)) return 1;
  return clamp(v, PREF_CLAMP_MIN, PREF_CLAMP_MAX);
}

// ---------------------------------------------------------------------------
// The IAUS compensation factor (§2.2.1)
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number): number => clamp(v, 0, 1);

/**
 * `comp(c, n) = c + (1 - c) x (1 - 1/sqrt(n)) x c`.
 *
 * With nineteen axes a raw product of 0.9s would be 0.13; compensated it is
 * 0.55, which is the point — a good option with one mediocre axis must not lose
 * to a mediocre option with no axes.
 */
export function compensate(c: number, n: number): number {
  const v = clamp01(c);
  const modification = 1 - 1 / Math.sqrt(Math.max(1, n));
  return v + (1 - v) * modification * v;
}

// ---------------------------------------------------------------------------
// The nineteen response curves (§2.2.2)
// ---------------------------------------------------------------------------

/** §2.2.2 `c.own_fatigue`: the per-family output curve. */
function ownFatigueCurve(family: ActionFamily, f: number): number {
  if (REST_FAMILIES.has(family)) {
    // Clinch-as-rest becomes *more* attractive as the tank empties.
    return clamp01(0.3 + 0.7 * f);
  }
  if (SHOT_FAMILIES.has(family)) return clamp01(1 - 0.7 * f);
  if (KICK_FAMILIES.has(family)) return clamp01(1 - 0.6 * f);
  if (STRIKE_FAMILIES.has(family)) return clamp01(1 - 0.45 * f);
  return clamp01(1 - 0.3 * f);
}

/** §2.2.2 `c.cage`: circle-away when own back is to the fence; pressure when theirs is. */
function cageCurve(family: ActionFamily, ownCageDistM: number, oppCageDistM: number): number {
  const own = clamp01(ownCageDistM / 1.5);
  const opp = clamp01(oppCageDistM / 1.5);
  if (EXIT_FAMILIES.has(family)) {
    // High when own cage distance -> 0.
    return clamp01(0.35 + 0.65 * (1 - own));
  }
  if (PRESSURE_FAMILIES.has(family)) {
    // High when the *opponent's* back is near the fence.
    return clamp01(0.35 + 0.65 * (1 - opp));
  }
  return clamp01(0.5 + 0.5 * own);
}

/** §2.2.2 `c.round_time`: finish-seeking and volume rise in the last 60 s when behind. */
function roundTimeCurve(family: ActionFamily, leftFrac: number, behind: boolean): number {
  const lateWindow = leftFrac <= 0.2;
  if (!lateWindow) return 0.75;
  const seeking = FINISH_FAMILIES.has(family) || STRIKE_FAMILIES.has(family);
  if (!seeking) return 0.7;
  return behind ? 1 : 0.85;
}

/** §2.2.2 `c.mustnot`: 0.15 for T2+, 0.5 at T1 (they know but slip), 1.0 at T0. */
function mustNotCurve(isMustNot: boolean, effectiveIqTier: number): number {
  if (!isMustNot) return 1;
  if (effectiveIqTier <= 0) return 1;
  if (effectiveIqTier === 1) return 0.5;
  return CURVE_FLOOR;
}

/**
 * §2.2.2 `c.pace`: `1 - 0.5(x - 1)` above the intended rate, where `x` is the
 * *landed* rate over `intent.paceTarget` (§2.5.5 P-6). The curve reaches 0 at
 * three times the target and the score is a product, so a fighter who is
 * landing at triple his plan's rate stops throwing until the 30 s window
 * drains — that hard edge is the only brake the chapter gives the volume, and
 * it is what keeps `w_plan x w_style` (up to x3 on a jab) from running the
 * pace away.
 */
export const CURVE_FLOOR = 0.15;

function paceCurve(family: ActionFamily, ratio: number): number {
  if (!STRIKE_FAMILIES.has(family)) return 1;
  if (ratio <= 1) return 1;
  return clamp01(1 - 0.5 * (ratio - 1));
}

/**
 * One consideration, by id. Exported so the Model tab can show a fighter's
 * decision broken down axis by axis.
 */
export function considerationValue(
  id: ConsiderationId,
  a: ScorableAction,
  x: ConsiderationInputs,
): number {
  switch (id) {
    case 'c.range_fit': {
      // 1 - x^2, clipped. Movement is range-agnostic.
      if (MOVEMENT_FAMILIES.has(a.family)) return 1;
      const e = clamp(a.rangeError, 0, 1.5);
      return clamp01(1 - e * e);
    }
    case 'c.range_target': {
      if (!MOVEMENT_FAMILIES.has(a.family)) return 1;
      // Movement scores high when it would move toward the intended range.
      const gap = Math.abs(x.distanceM - x.intentRangeM);
      const tooFar = x.distanceM > x.intentRangeM;
      const wants = ADVANCING_FAMILIES.has(a.family) ? tooFar
        : RETREATING_FAMILIES.has(a.family) ? !tooFar
          : null;
      const alignment = wants === null ? 0.5 : wants ? 1 : 0.25;
      return clamp01(0.3 + 0.7 * alignment * clamp01(gap / 0.8));
    }
    case 'c.own_fatigue':
      return ownFatigueCurve(a.family, clamp01(x.ownFatigue));
    case 'c.opp_fatigue':
      return PRESSURE_FAMILIES.has(a.family)
        ? clamp01(0.6 + 0.4 * clamp01(x.oppFatigue))
        : 1;
    case 'c.own_damage':
      return clamp01(1 - clamp01(a.ownRegionDamage));
    case 'c.opp_hurt': {
      if (x.oppHurt === 0) return 0.8;
      if (FINISH_FAMILIES.has(a.family)) return 1;
      if (DEFENSIVE_FAMILIES.has(a.family)) return clamp01(0.8 * (1 - 0.3));
      return 0.8;
    }
    case 'c.cage':
      return cageCurve(a.family, x.ownCageDistM, x.oppCageDistM);
    case 'c.round_time':
      return roundTimeCurve(a.family, clamp01(x.roundTimeLeftFrac), x.behind);
    case 'c.setup':
      // A naked shot is the W-1 sin; everything else is unaffected.
      return SHOT_FAMILIES.has(a.family) && x.setupRecent === 0 ? 0.4 : 1;
    case 'c.expected_threat': {
      const t = clamp01(x.expectedThreat);
      if (COUNTER_FAMILIES.has(a.family)) return clamp01((0.5 + t) / 1.5);
      if (LEAD_FAMILIES.has(a.family)) return clamp01((1.2 - 0.4 * t) / 1.2);
      return 1;
    }
    case 'c.opp_recovery':
      // Counter strikes x1.8 into the recovery window, normalised onto [0,1].
      return x.oppInRecovery === 1 && COUNTER_FAMILIES.has(a.family) ? 1 : 1 / 1.8;
    case 'c.balance':
      return BALANCE_FAMILIES.has(a.family) ? clamp01(x.balance) : 1;
    case 'c.position_value':
      return clamp01(a.positionValue);
    case 'c.risk':
      return clamp01(1 - Math.max(0, a.risk - (0.5 + 0.25 * clamp(x.riskAppetite, -2, 2))));
    case 'c.mustnot':
      return mustNotCurve(a.isMustNot, x.effectiveIqTier);
    case 'c.pace':
      return paceCurve(a.family, Math.max(0, x.paceRatio));
    case 'c.dwell':
      // Exit families x2 when the dwell limit is exceeded; expressed as the
      // others being halved, because considerations live in [0, 1].
      if (!x.dwellExceeded) return 1;
      return EXIT_FAMILIES.has(a.family) ? 1 : 0.5;
    case 'c.shield':
      return a.shield > 0 ? 1 : 0.85;
    case 'c.lookahead':
      return clamp01(0.5 + 0.5 * x.lookahead);
    default:
      return 1;
  }
}

/** The whole score of one action, plus the per-axis breakdown for the UI. */
export interface ScoredAction<T extends ScorableAction = ScorableAction> {
  action: T;
  score: number;
  /** `c.*` values in `CONSIDERATION_IDS` order, before compensation. */
  considerations: number[];
  weightProduct: number;
}

export function scoreAction<T extends ScorableAction>(
  a: T,
  x: ConsiderationInputs,
  w: WeightBundle = NEUTRAL_WEIGHTS,
  explain = false,
): ScoredAction<T> {
  const n = CONSIDERATION_COUNT;
  let product = 1;
  const raw: number[] = explain ? new Array<number>(n) : [];
  for (let i = 0; i < n; i++) {
    const c = considerationValue(CONSIDERATION_IDS[i], a, x);
    if (explain) raw[i] = c;
    product *= compensate(c, n);
  }
  const weightProduct = clamp(
    w.style * preferenceFactor(w.pref) * w.plan * w.adapt * w.matchup,
    WEIGHT_CLAMP_MIN,
    WEIGHT_CLAMP_MAX,
  );
  const score = Math.max(0, a.base) * product * weightProduct * Math.max(0, w.multi);
  return { action: a, score, considerations: raw, weightProduct };
}

// ---------------------------------------------------------------------------
// §2.2.4 — softmax with tier temperature
// ---------------------------------------------------------------------------

/** `ai.temp.tier`: T0 near-lottery, T5 close to argmax without reaching it. */
export const TAU_BY_TIER: readonly number[] = [1.00, 0.80, 0.60, 0.45, 0.35, 0.28];

/** The 50/50 phase-tier / IQ-tier blend of §2.2.4 (`ai.temp.phase_iq_blend`). */
export const PHASE_IQ_BLEND = 0.5;

/** Linear interpolation of the ladder at a fractional tier. */
export function tauForTier(tier: number): number {
  const t = clamp(tier, 0, 5);
  const lo = Math.floor(t);
  const hi = Math.min(5, lo + 1);
  const frac = t - lo;
  return TAU_BY_TIER[lo] + (TAU_BY_TIER[hi] - TAU_BY_TIER[lo]) * frac;
}

/** The blended tier that sets the temperature: phase discipline 50 / IQ 50. */
export function decisionTier(phaseTier: number, iqTier: number): number {
  return PHASE_IQ_BLEND * phaseTier + (1 - PHASE_IQ_BLEND) * iqTier;
}

export interface DecisionQuality {
  /** `f` 0-1. */
  fatigue: number;
  rocked: boolean;
  /** 05's adrenaline dump magnitude, 0-1; only in the first 150 s of R1. */
  dump: number;
  dumpActive: boolean;
  secondWind: boolean;
}

/** `ai.q.fatigue`: 0 at f <= 0.2, 0.15 at 0.5, 0.35 at 0.8, capped at 0.5. */
export function qFatigue(f: number): number {
  const x = clamp01(f);
  if (x <= 0.2) return 0;
  if (x <= 0.5) return (0.15 * (x - 0.2)) / 0.3;
  const beyond = 0.15 + (0.20 * (x - 0.5)) / 0.3;
  return Math.min(0.5, beyond);
}

export const Q_ROCKED = 0.40;
export const Q_DUMP_COEF = 0.20;
export const Q_SECOND_WIND = 0.10;

/**
 * `tau_eff = tau_tier x 1 / ((1 - q_f)(1 - q_rocked)(1 - q_dump)(1 + q_wind))`.
 * Every penalty widens the distribution; the second wind narrows it.
 */
export function effectiveTau(tauTier: number, q: DecisionQuality): number {
  const qf = qFatigue(q.fatigue);
  const qr = q.rocked ? Q_ROCKED : 0;
  const qd = q.dumpActive ? Q_DUMP_COEF * clamp01(q.dump) : 0;
  const qw = q.secondWind ? Q_SECOND_WIND : 0;
  const denom = (1 - qf) * (1 - qr) * (1 - qd) * (1 + qw);
  // Every factor is < 1 only through q < 1, so `denom` cannot reach zero, but
  // a hostile parameter override could; the floor keeps tau finite.
  return tauTier / Math.max(1e-3, denom);
}

/**
 * `P(a) proportional to score(a)^(1/tau)`, sampled with the single uniform the
 * draw schedule allows (draw 5, `u_select`).
 *
 * Scores are divided by the maximum before exponentiation so a tau of 0.28
 * (exponent 3.6) cannot overflow on a large prior, and the ordering is
 * unchanged because the normaliser is common to every term.
 */
export function softmaxSelect(scores: readonly number[], tau: number, u: number): number {
  const n = scores.length;
  if (n === 0) return -1;
  if (n === 1) return 0;
  let max = 0;
  for (let i = 0; i < n; i++) if (scores[i] > max) max = scores[i];
  if (max <= 0) return Math.min(n - 1, Math.floor(clamp01(u) * n));

  const exponent = 1 / Math.max(1e-3, tau);
  const weights = new Array<number>(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const w = scores[i] <= 0 ? 0 : Math.pow(scores[i] / max, exponent);
    weights[i] = w;
    total += w;
  }
  if (total <= 0) return 0;

  let r = clamp01(u) * total;
  for (let i = 0; i < n; i++) {
    if (r < weights[i]) return i;
    r -= weights[i];
  }
  return n - 1;
}

/** Index of the highest score; the reference argmax the tests compare against. */
export function bestIndex(scores: readonly number[]): number {
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > bestScore) {
      bestScore = scores[i];
      best = i;
    }
  }
  return best;
}
