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

/**
 * Phase 9 [E: tuned Phase 9, PHASE4_FINDINGS C-9]: the linear brake above let
 * the landed rate run to two or three times the target before it bit (a
 * bang-bang controller: an unbraked 15-20 attempts a minute, then nothing),
 * because the unbraked selection rate of a strike at range is far above any
 * real pace. The brake is now proportional: flat to `r0` of the target, then
 * `(r0 / ratio)^n`, so the landed rate settles a little above the target
 * instead of oscillating around three times it.
 */
export const PACE_CURVE = Object.freeze({ r0: 0.85, n: 2.0 });

export function paceCurve(family: ActionFamily, ratio: number): number {
  if (!STRIKE_FAMILIES.has(family)) return 1;
  if (ratio <= PACE_CURVE.r0) return 1;
  return clamp01(Math.pow(PACE_CURVE.r0 / ratio, PACE_CURVE.n));
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
      // Phase 9: applied outside the compensated product (`paceCurve` in the
      // policy), because compensation across nineteen axes diluted the brake
      // to a third of its strength. Reported as 1 here so it is not counted
      // twice.
      return 1;
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
// Perf: the same score without the per-id dispatch (the policy's hot path)
// ---------------------------------------------------------------------------

const FL_MOVEMENT = 1 << 0;
const FL_ADVANCING = 1 << 1;
const FL_RETREATING = 1 << 2;
const FL_REST = 1 << 3;
const FL_SHOT = 1 << 4;
const FL_KICK = 1 << 5;
const FL_STRIKE = 1 << 6;
const FL_PRESSURE = 1 << 7;
const FL_FINISH = 1 << 8;
const FL_DEFENSIVE = 1 << 9;
const FL_EXIT = 1 << 10;
const FL_COUNTER = 1 << 11;
const FL_LEAD = 1 << 12;
const FL_BALANCE = 1 << 13;

const FAMILY_FLAGS = new Map<string, number>();

/** Every family-set membership `considerationValue` asks about, as one bitmask. */
function familyFlags(family: ActionFamily): number {
  let v = FAMILY_FLAGS.get(family);
  if (v !== undefined) return v;
  v = (MOVEMENT_FAMILIES.has(family) ? FL_MOVEMENT : 0)
    | (ADVANCING_FAMILIES.has(family) ? FL_ADVANCING : 0)
    | (RETREATING_FAMILIES.has(family) ? FL_RETREATING : 0)
    | (REST_FAMILIES.has(family) ? FL_REST : 0)
    | (SHOT_FAMILIES.has(family) ? FL_SHOT : 0)
    | (KICK_FAMILIES.has(family) ? FL_KICK : 0)
    | (STRIKE_FAMILIES.has(family) ? FL_STRIKE : 0)
    | (PRESSURE_FAMILIES.has(family) ? FL_PRESSURE : 0)
    | (FINISH_FAMILIES.has(family) ? FL_FINISH : 0)
    | (DEFENSIVE_FAMILIES.has(family) ? FL_DEFENSIVE : 0)
    | (EXIT_FAMILIES.has(family) ? FL_EXIT : 0)
    | (COUNTER_FAMILIES.has(family) ? FL_COUNTER : 0)
    | (LEAD_FAMILIES.has(family) ? FL_LEAD : 0)
    | (BALANCE_FAMILIES.has(family) ? FL_BALANCE : 0);
  FAMILY_FLAGS.set(family, v);
  return v;
}

/** `compensate(c, CONSIDERATION_COUNT)` with the constant factor hoisted. */
const COMP_MOD = 1 - 1 / Math.sqrt(Math.max(1, CONSIDERATION_COUNT));
function comp(c: number): number {
  const v = clamp01(c);
  return v + (1 - v) * COMP_MOD * v;
}

/**
 * `scoreAction(a, x, w).score`, bit for bit, without the breakdown.
 *
 * The nineteen curves are the ones in `considerationValue`, inlined in
 * `CONSIDERATION_IDS` order so the running product multiplies the same
 * compensated factors in the same order (floating-point products are not
 * associative, so the order is part of the result). Family-set lookups are
 * one memoised bitmask per family. `tests/sim.golden.test.ts` checks the two
 * against each other.
 */
export function scoreValue(a: ScorableAction, x: ConsiderationInputs, w: WeightBundle): number {
  const fl = familyFlags(a.family);
  let product = 1;
  let c: number;
  // c.range_fit
  if (fl & FL_MOVEMENT) c = 1;
  else {
    const e = clamp(a.rangeError, 0, 1.5);
    c = clamp01(1 - e * e);
  }
  product *= comp(c);
  // c.range_target
  if (!(fl & FL_MOVEMENT)) c = 1;
  else {
    const gap = Math.abs(x.distanceM - x.intentRangeM);
    const tooFar = x.distanceM > x.intentRangeM;
    const wants = fl & FL_ADVANCING ? tooFar : fl & FL_RETREATING ? !tooFar : null;
    const alignment = wants === null ? 0.5 : wants ? 1 : 0.25;
    c = clamp01(0.3 + 0.7 * alignment * clamp01(gap / 0.8));
  }
  product *= comp(c);
  // c.own_fatigue
  {
    const f = clamp01(x.ownFatigue);
    c = fl & FL_REST ? clamp01(0.3 + 0.7 * f)
      : fl & FL_SHOT ? clamp01(1 - 0.7 * f)
        : fl & FL_KICK ? clamp01(1 - 0.6 * f)
          : fl & FL_STRIKE ? clamp01(1 - 0.45 * f)
            : clamp01(1 - 0.3 * f);
  }
  product *= comp(c);
  // c.opp_fatigue
  c = fl & FL_PRESSURE ? clamp01(0.6 + 0.4 * clamp01(x.oppFatigue)) : 1;
  product *= comp(c);
  // c.own_damage
  c = clamp01(1 - clamp01(a.ownRegionDamage));
  product *= comp(c);
  // c.opp_hurt
  c = x.oppHurt === 0 ? 0.8
    : fl & FL_FINISH ? 1
      : fl & FL_DEFENSIVE ? clamp01(0.8 * (1 - 0.3))
        : 0.8;
  product *= comp(c);
  // c.cage
  {
    const own = clamp01(x.ownCageDistM / 1.5);
    const opp = clamp01(x.oppCageDistM / 1.5);
    c = fl & FL_EXIT ? clamp01(0.35 + 0.65 * (1 - own))
      : fl & FL_PRESSURE ? clamp01(0.35 + 0.65 * (1 - opp))
        : clamp01(0.5 + 0.5 * own);
  }
  product *= comp(c);
  // c.round_time
  if (!(clamp01(x.roundTimeLeftFrac) <= 0.2)) c = 0.75;
  else if (!(fl & (FL_FINISH | FL_STRIKE))) c = 0.7;
  else c = x.behind ? 1 : 0.85;
  product *= comp(c);
  // c.setup
  c = fl & FL_SHOT && x.setupRecent === 0 ? 0.4 : 1;
  product *= comp(c);
  // c.expected_threat
  {
    const t = clamp01(x.expectedThreat);
    c = fl & FL_COUNTER ? clamp01((0.5 + t) / 1.5)
      : fl & FL_LEAD ? clamp01((1.2 - 0.4 * t) / 1.2)
        : 1;
  }
  product *= comp(c);
  // c.opp_recovery
  c = x.oppInRecovery === 1 && fl & FL_COUNTER ? 1 : 1 / 1.8;
  product *= comp(c);
  // c.balance
  c = fl & FL_BALANCE ? clamp01(x.balance) : 1;
  product *= comp(c);
  // c.position_value
  c = clamp01(a.positionValue);
  product *= comp(c);
  // c.risk
  c = clamp01(1 - Math.max(0, a.risk - (0.5 + 0.25 * clamp(x.riskAppetite, -2, 2))));
  product *= comp(c);
  // c.mustnot
  c = mustNotCurve(a.isMustNot, x.effectiveIqTier);
  product *= comp(c);
  // c.pace (applied outside the product; reported as 1)
  product *= comp(1);
  // c.dwell
  c = !x.dwellExceeded ? 1 : fl & FL_EXIT ? 1 : 0.5;
  product *= comp(c);
  // c.shield
  c = a.shield > 0 ? 1 : 0.85;
  product *= comp(c);
  // c.lookahead
  c = clamp01(0.5 + 0.5 * x.lookahead);
  product *= comp(c);

  const weightProduct = clamp(
    w.style * preferenceFactor(w.pref) * w.plan * w.adapt * w.matchup,
    WEIGHT_CLAMP_MIN,
    WEIGHT_CLAMP_MAX,
  );
  return Math.max(0, a.base) * product * weightProduct * Math.max(0, w.multi);
}

const COMP_ONE = comp(1);
const COMP_SHIELD_OFF = comp(0.85);

/**
 * `scoreValue` for every candidate of one decision, sharing the work that does
 * not depend on the candidate.
 *
 * Thirteen of the nineteen factors are functions of the family and the tick's
 * `ConsiderationInputs` only, so each family's compensated factors are
 * computed once per decision (with exactly `scoreValue`'s expressions) and the
 * per-candidate loop multiplies the same values into the product in the same
 * `CONSIDERATION_IDS` order. Build one per decision: it caches against the
 * `x` it was built with, which must not change while it is in use.
 */
export class ConsiderationScorer {
  // Plain arrays, not Float64Array: a typed array this size gets an off-heap
  // backing store, and one per family per decision is a lot of those.
  private readonly tables = new Map<ActionFamily, number[]>();
  /** `comp(mustNotCurve(true, x.effectiveIqTier))`; `false` is `comp(1)`. */
  private readonly mustNotComp: number;
  /** The `0.5 + 0.25 * clamp(riskAppetite)` term of `c.risk`. */
  private readonly riskShift: number;

  constructor(private readonly x: ConsiderationInputs) {
    this.mustNotComp = comp(mustNotCurve(true, x.effectiveIqTier));
    this.riskShift = 0.5 + 0.25 * clamp(x.riskAppetite, -2, 2);
  }

  private table(family: ActionFamily, fl: number): number[] {
    let t = this.tables.get(family);
    if (t !== undefined) return t;
    const x = this.x;
    t = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    let c: number;
    // [1] c.range_target
    if (!(fl & FL_MOVEMENT)) c = 1;
    else {
      const gap = Math.abs(x.distanceM - x.intentRangeM);
      const tooFar = x.distanceM > x.intentRangeM;
      const wants = fl & FL_ADVANCING ? tooFar : fl & FL_RETREATING ? !tooFar : null;
      const alignment = wants === null ? 0.5 : wants ? 1 : 0.25;
      c = clamp01(0.3 + 0.7 * alignment * clamp01(gap / 0.8));
    }
    t[1] = comp(c);
    // [2] c.own_fatigue
    {
      const f = clamp01(x.ownFatigue);
      c = fl & FL_REST ? clamp01(0.3 + 0.7 * f)
        : fl & FL_SHOT ? clamp01(1 - 0.7 * f)
          : fl & FL_KICK ? clamp01(1 - 0.6 * f)
            : fl & FL_STRIKE ? clamp01(1 - 0.45 * f)
              : clamp01(1 - 0.3 * f);
    }
    t[2] = comp(c);
    // [3] c.opp_fatigue
    t[3] = comp(fl & FL_PRESSURE ? clamp01(0.6 + 0.4 * clamp01(x.oppFatigue)) : 1);
    // [5] c.opp_hurt
    t[5] = comp(x.oppHurt === 0 ? 0.8
      : fl & FL_FINISH ? 1
        : fl & FL_DEFENSIVE ? clamp01(0.8 * (1 - 0.3))
          : 0.8);
    // [6] c.cage
    {
      const own = clamp01(x.ownCageDistM / 1.5);
      const opp = clamp01(x.oppCageDistM / 1.5);
      t[6] = comp(fl & FL_EXIT ? clamp01(0.35 + 0.65 * (1 - own))
        : fl & FL_PRESSURE ? clamp01(0.35 + 0.65 * (1 - opp))
          : clamp01(0.5 + 0.5 * own));
    }
    // [7] c.round_time
    if (!(clamp01(x.roundTimeLeftFrac) <= 0.2)) c = 0.75;
    else if (!(fl & (FL_FINISH | FL_STRIKE))) c = 0.7;
    else c = x.behind ? 1 : 0.85;
    t[7] = comp(c);
    // [8] c.setup
    t[8] = comp(fl & FL_SHOT && x.setupRecent === 0 ? 0.4 : 1);
    // [9] c.expected_threat
    {
      const th = clamp01(x.expectedThreat);
      t[9] = comp(fl & FL_COUNTER ? clamp01((0.5 + th) / 1.5)
        : fl & FL_LEAD ? clamp01((1.2 - 0.4 * th) / 1.2)
          : 1);
    }
    // [10] c.opp_recovery
    t[10] = comp(x.oppInRecovery === 1 && fl & FL_COUNTER ? 1 : 1 / 1.8);
    // [11] c.balance
    t[11] = comp(fl & FL_BALANCE ? clamp01(x.balance) : 1);
    // [15] c.pace
    t[15] = COMP_ONE;
    // [16] c.dwell
    t[16] = comp(!x.dwellExceeded ? 1 : fl & FL_EXIT ? 1 : 0.5);
    // [18] c.lookahead
    t[18] = comp(clamp01(0.5 + 0.5 * x.lookahead));
    this.tables.set(family, t);
    return t;
  }

  /** `scoreAction(a, x, w).score`, bit for bit. */
  score(a: ScorableAction, w: WeightBundle): number {
    const fl = familyFlags(a.family);
    const t = this.table(a.family, fl);
    let product = 1;
    // [0] c.range_fit
    if (fl & FL_MOVEMENT) product *= COMP_ONE;
    else {
      const e = clamp(a.rangeError, 0, 1.5);
      product *= comp(clamp01(1 - e * e));
    }
    product *= t[1];
    product *= t[2];
    product *= t[3];
    // [4] c.own_damage
    product *= comp(clamp01(1 - clamp01(a.ownRegionDamage)));
    product *= t[5];
    product *= t[6];
    product *= t[7];
    product *= t[8];
    product *= t[9];
    product *= t[10];
    product *= t[11];
    // [12] c.position_value
    product *= comp(clamp01(a.positionValue));
    // [13] c.risk
    product *= comp(clamp01(1 - Math.max(0, a.risk - this.riskShift)));
    // [14] c.mustnot
    product *= a.isMustNot ? this.mustNotComp : COMP_ONE;
    product *= t[15];
    product *= t[16];
    // [17] c.shield
    product *= a.shield > 0 ? COMP_ONE : COMP_SHIELD_OFF;
    product *= t[18];

    const weightProduct = clamp(
      w.style * preferenceFactor(w.pref) * w.plan * w.adapt * w.matchup,
      WEIGHT_CLAMP_MIN,
      WEIGHT_CLAMP_MAX,
    );
    return Math.max(0, a.base) * product * weightProduct * Math.max(0, w.multi);
  }
}

// ---------------------------------------------------------------------------
// §2.2.4 — softmax with tier temperature
// ---------------------------------------------------------------------------

/**
 * Phase 9: `BASE_PRIOR` is a *family* prior (jab 1.5, cross 1.0, ...), but the
 * candidate list has one entry per technique, edge or submission — nine jab
 * variants, a dozen RNC-family and back attacks, six ground strikes. Scoring
 * each with the full family prior made a family's weight proportional to how
 * many variants the catalogue happens to list (the jab took more than half of
 * all strikes; the back, which offers nine submissions, produced 50 attempts
 * per 15 minutes). Weighting each candidate by 1 / (candidates in its family)
 * inside the softmax makes the choice "family first, then variant", which is
 * what the priors were written for.
 */
export function familyShares(families: readonly string[]): number[] {
  // A fresh Map per call on purpose: a long-lived one cleared per call keeps
  // handing its new backing tables to the old generation (measured: it tripled
  // promoted bytes).
  const count = new Map<string, number>();
  for (const f of families) count.set(f, (count.get(f) ?? 0) + 1);
  const out = new Array<number>(families.length);
  for (let i = 0; i < families.length; i++) out[i] = 1 / (count.get(families[i]) ?? 1);
  return out;
}

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
/**
 * Phase 9 pace governor: an upper bound on the probability that the choice
 * this tick is a strike. `mask[i]` marks the strike candidates; when their
 * natural share of the softmax mass exceeds `cap`, their weights are scaled so
 * the share is exactly `cap`. Deterministic and draw-free — the same single
 * uniform picks from the rescaled mass — so the 09 §2.7 schedule is unchanged.
 */
export interface MassCap {
  mask: readonly boolean[];
  cap: number;
  /**
   * `exact`: the masked share is set to `cap` whenever any masked candidate
   * has weight, raising it as well as lowering it — a hazard rather than a
   * ceiling, for rare deliberate actions (takedown attempts) whose natural
   * share depends on how many other options the node happens to list.
   */
  exact?: boolean;
}

export function softmaxSelect(
  scores: readonly number[], tau: number, u: number, share?: readonly number[],
  massCaps?: readonly MassCap[],
): number {
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
    // `share` (Phase 9): each candidate's share of its family, so a family's
    // mass does not grow with the number of variants it lists (see
    // `familyShares`).
    const w = scores[i] <= 0 ? 0 : Math.pow(scores[i] / max, exponent) * (share ? share[i] : 1);
    weights[i] = w;
    total += w;
  }
  if (total <= 0) return 0;
  // Caps are applied in order over disjoint masks.
  for (const massCap of massCaps ?? []) {
    let capped = 0;
    for (let i = 0; i < n; i++) if (massCap.mask[i]) capped += weights[i];
    const other = total - capped;
    const cap = clamp01(massCap.cap);
    if (capped > 0 && other > 0 && (capped / total > cap || (massCap.exact === true && capped / total < cap))) {
      const k = (cap * other) / ((1 - cap) * capped);
      total = other;
      for (let i = 0; i < n; i++) {
        if (massCap.mask[i]) weights[i] *= k;
        if (massCap.mask[i]) total += weights[i];
      }
    }
  }

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
