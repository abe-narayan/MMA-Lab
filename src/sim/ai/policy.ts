/**
 * MMA POLICY — chapter 07 wired into the tick loop.
 *
 * `decide()` is called once per fighter per tick in phase P3, in ascending id
 * order, and the loop commits whatever comes back. Two contracts bind it:
 *
 *   1. **Fixed draw count.** The P3 block of the §2.1 schedule is eight draws
 *      per fighter (nine in multi-opponent modes). The *loop* takes the last
 *      of them, `u_commit`, as the intra-tick commitment jitter, so a policy
 *      takes `DRAWS_PER_DECIDE - 1` and the total is eight either way — the
 *      same split `IdlePolicy` uses. Those uniforms are taken first and
 *      unconditionally, before any branch runs, including the branches that
 *      return early. That is what makes the stream position a pure function of
 *      (tick, fighterId), which is what makes a replay reproduce. Every
 *      sub-layer here takes its uniform as an argument; nothing below this
 *      file can reach the generator.
 *   2. **Delayed information only.** The policy reads `ctx.observed`, the
 *      perception buffer's view from `lagTicks` ago, never `world.fighters`.
 *      Own state is read live — a fighter knows his own legs.
 *
 * Where a uniform has to serve two purposes (the pattern read and the hurt
 * cue; the three execution tells), the uniform's range is *partitioned* rather
 * than reused, so each event keeps its exact marginal probability and the draw
 * budget stays fixed.
 */
import {
  DRAWS_PER_DECIDE, DRAWS_PER_DECIDE_MULTI,
  type Decision, type DecisionContext, type DecisionPolicy, type FighterIntent,
} from '../core/policy';
import type { World, FighterWorldState } from '../core/world';
import type { ObservedFighter, ObservedState } from '../core/perception';
import { distanceToWall } from '../rules/arenas/types';
import type { DefenceId, PositionId } from '../core/ids';
import { hasPositionNode, positionNode } from '../grappling/graph';
import { isTakedownAttempt } from '../grappling/takedowns';
import {
  reachProfile, rangeFit, bandFor, bandLimits, isOpenStance, leadFootBattle,
  BAND_BOUNDS,
} from '../striking/range';
import { technique, hasTechnique, type TechniqueSpec } from '../striking/catalogue';
import { reactionLatencyMs as defenceLatencyMs } from '../striking/defence';
import { ACTION_FAMILIES, type ActionFamily, type ModeId } from './contracts';
import {
  currentMultiTargetProvider, currentPlanProvider, pacingFor, planWeight,
  type PlanView, type TargetChoice,
} from './planview';
import {
  enumerateActions, type Candidate, type EnumerationContext,
} from './actions';
import {
  behaviourWeights, eyesCloseP, patternReadShare, reactiveDefence, tierBehaviourFor, turnAwayP,
  PATTERN_HABIT_P,
  type BehaviourWeights, type TierBehaviour,
} from './behaviour';
import {
  ConsiderationScorer, decisionTier, effectiveTau, familyShares, softmaxSelect, tauForTier,
  type MassCap,
  type ConsiderationInputs, type WeightBundle,
} from './utility';
import {
  abortReason, advance as advanceMacro, availableMacros, begin as beginMacro, comboCap,
  isRunning as macroRunning, newMacroState, preferComboOrder, reset as resetMacro,
  type Macro, type MacroState,
} from './macros';
import { executionQuality, executionTierFor, type ExecutionQuality } from './execution';
import {
  preferenceWeight, preferencesFor, rangeTargetOf, type StylePreferences,
} from './preferences';
import {
  ExchangeLedger, OpponentModel, baseFeintBiteP, baseReadP, buildContext, counterOnRead,
  feintBiteProbabilityFor, hurtCueP, readCues, readProbability,
  COUNTER_ON_READ_MULT, type Cues,
} from './perceive';
import { patternReadP } from '../striking/defence';
import { strikingCraft } from '../striking/tactics';
import { FOOTWORK, preferredDistance } from './footwork';
import {
  NO_URGENCY, URGENCY_EFFECT, currentRoundLead, newScoreBelief, scoreRound as scoreRoundBelief, urgency,
  visibleMargin, type ScoreBelief, type Urgency,
} from './scorecard';
import type { RoundLedger } from '../rules/judges';
import { resolveSubmissionFamily } from '../submissions/catalogue';
import { MODE_DEFAULTS } from './plan';
import { STRIKE_FAMILIES, type OppFamily } from './families';
import {
  adaptWeight, applyAdjustment, beliefToConfidence, buildAdjustment, candidateAdjustments,
  cornerCue, cornerUptakeP, defaultCornerTier, effectiveIqTier, evaluationDue,
  expireAdjustments, finisherProfile, finisherWeights, hurtBehaviour, hurtDurationS,
  hurtWeights, minDwellS, needFinishDeficit, pChange, scoreBelief, shouldStopFinishing,
  CORNER_AFFIRM_COMPOSURE, CORNER_MAX_CUES, DROP_FAMILY_HIT_RATE, DROP_FAMILY_MIN_ATTEMPTS,
  type AdaptSignals, type Adjustment, type AdjustmentId, type EmergencyKind, type EvalTrigger,
  type FinisherProfile, type HurtBehaviourId, type RiskLevel,
} from './adapt';

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const clamp01 = (v: number): number => clamp(v, 0, 1);

// ---------------------------------------------------------------------------
// One uniform -> one standard normal
// ---------------------------------------------------------------------------

/**
 * Inverse standard normal CDF (Acklam's rational approximation, |error| <
 * 1.15e-9). Box-Muller would cost two draws; the schedule allots one, and a
 * draw budget that changed with the fighter's tier would break the replay
 * contract. So the score-noise sample and the pre-bout style jitter each map a
 * single uniform through this.
 */
export function normalFromUniform(u: number): number {
  const p = clamp(u, 1e-12, 1 - 1e-12);
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5])
      / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q
    / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// ---------------------------------------------------------------------------
// Intent (§2.6)
// ---------------------------------------------------------------------------

export interface Intent {
  mode: ModeId;
  rangeTarget: 'long' | 'mid' | 'short';
  phaseTarget: 'distance' | 'clinch' | 'groundTop' | 'getUp' | 'any';
  initiative: 'lead' | 'counter' | 'mixed';
  /** Strikes per minute intended. */
  paceTarget: number;
  riskAppetite: RiskLevel;
  cagePolicy: 'centre' | 'cut' | 'circleAway';
  focusWeapons: ActionFamily[];
  avoid: ActionFamily[];
  emergency: EmergencyKind;
  perceivedScore: { roundsUp: number; sigma: number; lastRoundEstimate: -1 | 0 | 1 };
  effectiveIqTier: 0 | 1 | 2 | 3 | 4 | 5;
  /** Tick the current mode was entered, for min-dwell and commentary. */
  since: number;
}

/** `ai.style.jitter_sd`: replaces the old per-bout `tendencySd` of 0.22. */
export const STYLE_JITTER_SD = 0.10;
/** `ai.style.weight_range`. */
export const STYLE_WEIGHT_MIN = 0.5;
export const STYLE_WEIGHT_MAX = 2.0;

/**
 * How long a perceived hurt opponent is *believed* to still be hurt. The cue
 * is rolled per tick (§2.4.2) and often misses; without a belief window the
 * finish emergency would flicker off on the first failed roll, which is not
 * what "he smells blood" looks like. 05's rocked state decays over a similar
 * horizon.
 */
export const OPP_HURT_BELIEF_MS = 4000;

/** `ai.pace.finish_budget` (R1/R2/R3) and the final-round intent bump. */
export const FINISH_BUDGET: readonly number[] = [0.53, 0.30, 0.15];
export const FINAL_ROUND_INTENT = 1.10;
/** Default intended pace in strikes per minute when no plan says otherwise. */
export const DEFAULT_PACE_TARGET = 14;
/**
 * Landed-to-thrown conversion for the pace target [E: Phase 9]: UFC total
 * strike accuracy is 53 % (FIGHT_DATA §3 #6); the plan's `paceSLpM` is a
 * landed rate, the controller runs on thrown strikes.
 */
export const PACE_NOMINAL_ACCURACY = 0.45;

/**
 * The pace governor's constants [E: tuned Phase 9]. `gain` scales the hazard
 * (a combination's follow-up beats ride on one decision, so the gain sits
 * below 1); `n` is the feedback exponent above target, `boost` the catch-up
 * below it; the multipliers are per phase (see `strikeCap`).
 */
/**
 * Submission-attempt hazard per minute in a position that offers one, by the
 * attacker's side of the §03 node family [E: tuned Phase 9]. Anchors: 0.45
 * attempts per fighter per 15 min and 40 % of fights with one (FIGHT_DATA §3
 * #69-#71); the RNC is 39 % of submission finishes (#74), so the back is by
 * far the busiest position.
 */
export const SUB_HAZARD_PER_MIN: Readonly<Record<string, number>> = Object.freeze({
  'back:top': 1.8,
  'mount:top': 0.75,
  'side:top': 0.25,
  'turtle:top': 0.5,
  'half:top': 0.08,
  'closedGuard:top': 0.03,
  'openGuard:top': 0.05,
  'closedGuard:bottom': 0.45,
  'openGuard:bottom': 0.25,
  'half:bottom': 0.08,
  // Realism pass: 0.5 -> 0.2. Leg locks are 3 % of MMA submission finishes
  // (FIGHT_DATA §3 #75); an entanglement gives up top position under strikes.
  'legEntanglement:top': 0.2,
  'legEntanglement:bottom': 0.2,
  clinch: 0.12,
  attack: 0.25,
  standingFree: 0.05,
  default: 0.1,
});

/**
 * Clinch-entry attempts per minute from the feet [E: tuned Phase 9]: clinch
 * time is 15 % of UFC fight time (FIGHT_DATA §3 #24); at 15-20 s a clinch
 * that is about four successful entries per fighter per fifteen minutes.
 */
export const CLINCH_ENTRY_PER_MIN = 3.0;

/**
 * P(a free fighter follows a knocked-down opponent to the floor) per decision
 * while the chance lasts [E: tuned Phase 9 to FIGHT_DATA §5 KD conversion].
 */
export const KNOCKDOWN_FOLLOW_P = 0.6;

/** How long a measured finisher who stopped waits before trying again [E: Phase 9]. */
export const FINISH_RETRY_MS = 10_000;

/** Positional-edge attempts per minute in contact, by role [E: tuned Phase 9]. */
export const GRAPPLE_TEMPO_PER_MIN = Object.freeze({ clinch: 5, top: 5, bottom: 12 });

/**
 * Realism pass [E: retuned to FIGHT_DATA §3 #69]: the MMA floor on escapes and
 * guard (bind `grapplingAliases`) and the grappling skill terms cut attempts
 * to ~0.28 per 15 min; this restores the population rate.
 */
export const SUB_HAZARD_SCALE = 1.6;

/** A submission-hunting plan's multiplier on the attempt hazard [E]. */
export const SUB_HUNT_MULT = 1.5;

/** UFC-level §01 SUB composites, the reference for the attempt hazard [D: pooled population]. */
export const SUB_SKILL_REF = Object.freeze({ attack: 25, defence: 18 });

/** Exponent of the defender-side opportunity (ref / subDefence) [E: tuned Phase 9, T7]. */
export const SUB_OPPORTUNITY_EXP = 1.5;

/**
 * Pace by striking tier [E: tuned Phase 9 to 09 §7.3 T7]: regional fighters
 * throw less (T2 6-7, T3 7.5-8 significant attempts a minute, UFC 8.4).
 */
export function tierPaceMult(tier: number): number {
  return 0.55 + 0.11 * Math.max(0, Math.min(5, tier));
}

/** Takedown governor [E: tuned Phase 9]: gain on the plan's per-round target. */
export const TD_GOVERNOR = Object.freeze({
  gain: 1.9, boost: 3.0, n: 2.0, priorS: 60, floorPerRound: 0.15,
});

/**
 * Feint and level-change budget per minute [E: Phase 9]. Once the shots are
 * budgeted, the setups that lead to them (a level change is a SETUP edge,
 * §2.3 A) took the freed mass and ran at ten a minute.
 */
export const FEINT_PER_MIN = 2.5;

/** The families that spend the takedown budget. */
export const TD_FAMILIES: ReadonlySet<string> = new Set([
  'shoot', 'nakedShot', 'shootOffStrikes', 'bodylockTd', 'trip',
]);

/**
 * Realism pass [E]: weight on repeating the combination thrown last time.
 * Repeating a pattern is what the opponent model reads (§2.4.3 pattern read),
 * so fighters vary them; 0.35 keeps a favourite recognisable without making
 * every jab the start of the same one-two.
 */
export const COMBO_REPEAT_DAMP = 0.35;

/**
 * Realism pass: in-fight adaptation that follows success. The §2.6.1 rows fire
 * at evaluation cadence on hard thresholds (a family below 25 % over six
 * attempts); between them a fighter kept the same mix whatever landed, and in
 * the audit the families that landed best in R1 were used *less* in R2. Here
 * each strike family's landing rate is tracked with a 90 s half-life, shrunk
 * toward what that family normally lands (a leg kick landing 80 % is not a
 * discovery), and its weight moves by (rate / expected)^gain, bounded. The
 * gain is fight IQ x adaptability: a T1 fighter keeps throwing what he came
 * with; an elite one drifts toward what works (LIT_B §4: experts anticipate
 * and adjust; 07 §2.6 "he adjusted").
 */
export const WORKS_EXPECTED: Readonly<Partial<Record<ActionFamily, number>>> = Object.freeze({
  jab: 0.30, cross: 0.32, hook: 0.30, leadHook: 0.30, uppercut: 0.30, overhand: 0.28,
  bodyHook: 0.60, spinning: 0.20, teep: 0.60, lowKick: 0.78, leadLowKick: 0.78, bodyKick: 0.62,
  headKick: 0.25, rearKick: 0.60, knee: 0.60, elbow: 0.50,
});
export const WORKS = Object.freeze({ halfLifeS: 90, prior: 4, exp: 0.9, min: 0.6, max: 1.7 });

function decayWorks(r: { a: number; l: number; t: number }, nowS: number): void {
  const dt = nowS - r.t;
  if (dt > 0) {
    const k = Math.pow(0.5, dt / WORKS.halfLifeS);
    r.a *= k;
    r.l *= k;
    r.t = nowS;
  }
}

function noteWorks(st: AiState, family: string, what: 'a' | 'l', nowS: number): void {
  const r = (st.works[family] ??= { a: 0, l: 0, t: nowS });
  decayWorks(r, nowS);
  r[what] += 1;
}

export function worksWeight(st: AiState, family: string, nowS: number): number {
  const e = WORKS_EXPECTED[family as ActionFamily];
  const r = st.works[family];
  if (e === undefined || !r) return 1;
  decayWorks(r, nowS);
  const rate = (r.l + WORKS.prior * e) / (r.a + WORKS.prior);
  const w = Math.pow(rate / e, WORKS.exp * st.worksGain);
  return w < WORKS.min ? WORKS.min : w > WORKS.max ? WORKS.max : w;
}

const LONG_MAX_CACHE = new WeakMap<object, number>();

/**
 * +1 a pure counter-fighter .. -1 a pure lead fighter, from the plan's
 * initiative and the authored `style.initiative` (either may say it). [E]
 */
export function counterLean(planInitiative: string, authored: string | undefined): number {
  let v = planInitiative === 'counter' ? 0.6 : planInitiative === 'lead' ? -0.4 : 0;
  if (authored === 'counter') v += 0.4;
  else if (authored === 'pressure') v -= 0.4;
  else if (authored === 'point') v -= 0.15;
  return Math.max(-1, Math.min(1, v));
}

/**
 * Realism pass: 01 `style.initiative` (pressure / counter / point / balanced),
 * which only the scouting report read. It is the fighter's habit of who
 * starts the exchange (LIT_B §5.10: elite initiations ~1/3 lead, 1/3 counter,
 * 1/3 defensive). [E] magnitudes.
 */
export const INITIATIVE_WEIGHTS: Readonly<Record<string, Partial<Record<ActionFamily, number>>>> = Object.freeze({
  pressure: { advance: 1.3, inOut: 1.1, retreat: 0.75, circleAway: 0.85, counterWindow: 0.85, jab: 1.1, cross: 1.1, clinchEntry: 1.15 },
  counter: { counterWindow: 1.4, parryCross: 1.3, baitCross: 1.3, advance: 0.8, wait: 1.25, circle: 1.15, leadStrike: 0.8 },
  point: { jab: 1.25, teep: 1.25, inOut: 1.3, leadLowKick: 1.15, hook: 0.85, overhand: 0.8, retreat: 1.15 },
  balanced: {},
});

export function initiativeWeight(initiative: string | undefined, family: ActionFamily): number {
  if (!initiative) return 1;
  return INITIATIVE_WEIGHTS[initiative]?.[family] ?? 1;
}

/**
 * Realism pass: what the fighter does about the cards is his own. 01 §2.6
 * `losingBehaviour` ("risk when behind") and `whenLosing` shape the urgency:
 * a finish-seeker goes for the stoppage early, a round-stealer presses on
 * volume, a sheller covers up, a gambler throws everything. `heart` is the
 * will to push when it gets hard: it scales pressing late. [E]
 */
export function shapeUrgency(u: Urgency, losing: string | undefined, whenLosing: string | undefined, heart: number): Urgency {
  let press = u.press;
  let desp = u.desperation;
  let protect = u.protect;
  switch (losing) {
    case 'finishSeek': desp = Math.min(1, Math.max(desp * 1.6, press * 0.6)); break;
    case 'stealRound': press = Math.min(1, press * 1.3); desp *= 0.5; break;
    case 'shell': protect = Math.min(1, protect + 0.3 * press); press *= 0.3; desp *= 0.3; break;
    case 'gamble': press = Math.min(1, press * 1.2); desp = Math.min(1, Math.max(desp * 1.8, press * 0.5)); break;
    default: break;
  }
  switch (whenLosing) {
    case 'stall': press *= 0.4; desp *= 0.5; break;
    case 'gamble': desp = Math.min(1, Math.max(desp * 1.5, press * 0.4)); break;
    default: break;
  }
  const h = 0.7 + 0.6 * Math.max(0, Math.min(100, heart)) / 100;
  return { press: Math.min(1, press * h), desperation: Math.min(1, desp * h), protect };
}

/** Heart fights the fatigue brake: x1.3 slope at 0 .. x0.7 at 100 [E]. */
export function heartFatigueMult(heart: number): number {
  return 1.3 - 0.6 * Math.max(0, Math.min(100, heart)) / 100;
}

/**
 * Realism pass: which submission an MMA fighter goes for, by family
 * (FIGHT_DATA §3 #74-#75: chokes 79 %, arm locks 15 %, leg locks 3 % of
 * finishes; the sim ran 61 / 21 / 10). Chokes work through gloves and sweat
 * and do not give up position; a leg lock under ground-and-pound does. [E]
 */
export const SUB_FAMILY_WEIGHT: Readonly<Record<string, number>> = Object.freeze({
  choke: 1.45, jointLock: 0.8, legLock: 0.3, crank: 0.8, compression: 0.8,
});

const SUB_WEIGHT_CACHE = new Map<string, number>();

export function subFamilyWeight(id: string): number {
  const hit = SUB_WEIGHT_CACHE.get(id);
  if (hit !== undefined) return hit;
  const spec = resolveSubmissionFamily(id)[0];
  const w = spec ? SUB_FAMILY_WEIGHT[spec.family] ?? 1 : 1;
  SUB_WEIGHT_CACHE.set(id, w);
  return w;
}

/**
 * Realism pass: fatigue lowers the intended output. The governors held the
 * plan's pace whatever the tank said, so sig attempts *rose* round by round
 * (+21 % R3 vs R1, FIGHT_DATA §2.5 kickboxing -8 %, boxing late rounds
 * -15-25 %) while `f` climbed past 0.8. Flat below `f0`, linear above;
 * shots (the most expensive action, DAMAGE_PHYSIOLOGY §4.3) fall faster. [E]
 */
export const FATIGUE_PACE = Object.freeze({ f0: 0.3, slope: 0.4, shotSlope: 0.7 });

export function fatiguePaceMult(f: number, slope: number = FATIGUE_PACE.slope): number {
  return Math.max(0.35, 1 - slope * Math.max(0, f - FATIGUE_PACE.f0));
}

/**
 * Realism pass: takedown propensity by weight class. Lighter fighters shoot
 * more and heavier fighters less (FIGHT_DATA §3 #60: FLW 4.8 .. HW 3.1
 * attempts per 15 min; WRESTLING §9 r20 `grap.tdPropensity*`, a registry
 * table nothing read). The sim ran it the wrong way (FLW 3.5, HW 4.5), so the
 * multiplier carries both the propensity and the correction. [D]
 */
export const TD_CLASS_MULT: Readonly<Record<string, number>> = Object.freeze({
  'wc.strawweight': 1.30, 'wc.flyweight': 1.30, 'wc.bantamweight': 1.12, 'wc.featherweight': 1.12,
  'wc.lightweight': 1.10, 'wc.welterweight': 1.02, 'wc.middleweight': 0.95,
  'wc.light_heavyweight': 0.85, 'wc.heavyweight': 0.66, 'wc.super_heavyweight': 0.6,
});

export function tdClassMult(wc: string, sex: string): number {
  // Women's flyweight/bantam shoot about as often as the men at the same limit.
  void sex;
  return TD_CLASS_MULT[wc] ?? 1;
}

/** Exchange clustering of the strike hazard [E: tuned Phase 9]. */
export const EXCHANGE = Object.freeze({ windowS: 1.5, inMult: 5.0, outMult: 0.3 });

export const PACE_GOVERNOR = Object.freeze({
  gain: 0.95,
  n: 2.0,
  boost: 3.0,
  finishMult: 7.0,
  clinchMult: 0.75,
  groundTopMult: 1.1,
  groundBottomMult: 0.4,
});

/** Per-fighter AI state. Stored on `FighterWorldState.ai`, which is opaque. */
export interface AiState {
  fighterId: number;
  /** Phase 9: takedown attempts chosen this round, and which round that is. */
  tdRound: { round: number; n: number };
  /** Phase 9: tick of this fighter's last strike choice (exchange clustering). */
  lastStrikeTick: number;
  plan: PlanView | null;
  /** `w_style(a)`: per-bout jittered style vector. */
  style: Record<ActionFamily, number>;
  /**
   * `w_pref(a)`: 01 §2.6's authored technique, combination, submission and
   * takedown preferences, compiled once and tier-gated (`ai/preferences.ts`).
   * Draw-free — it is a pure function of the definition.
   */
  prefs: StylePreferences;
  model: OpponentModel;
  ledger: ExchangeLedger;
  macro: MacroState;
  adjustments: Adjustment[];
  intent: Intent;
  /** Seconds at the last tactical evaluation. */
  lastEvalS: number;
  /** The action family we committed to last, for the opponent-model context. */
  lastFamily: ActionFamily | null;
  lastContext: number;
  /** Consecutive feints shown without a strike (§2.4.5 habituation). */
  consecutiveFeints: number;
  /** ms until which the counter-on-read multiplier applies. */
  counterWindowUntilMs: number;
  /** ms until which the hurt behaviour is in force. */
  hurtUntilMs: number;
  hurtBehaviourId: HurtBehaviourId | null;
  finisher: FinisherProfile | null;
  /** ms until which the opponent is still believed to be hurt (§2.6.5). */
  oppHurtUntilMs: number;
  /** Phase 9: a stopped measured finisher waits this long before re-reading a hurt cue. */
  finishRetryAfterMs: number;
  /**
   * How many resolved outcomes the ledger has seen. The measured finisher's
   * stop rule is a hit-rate test, and a hit rate over zero landings is not a
   * hit rate — it is a module that has not been wired yet.
   */
  outcomesSeen: number;
  /** Running read tallies for the panel. */
  reads: { attempts: number; successes: number; counters: number; feintBites: number };
  cornerCues: { text: string; correct: boolean; accepted: boolean }[];
  /** ms of the last knockdown suffered; -Infinity when there was none. */
  lastKnockdownMs: number;
  /** Composure bonus the corner's affirmation bought (CO-4). */
  composureBonus: number;
  targetId: number | null;
  targetChoice: TargetChoice;
  /** `mustNots` the fighter has actually violated, for `evt.mustnot.violated`. */
  mustNotViolations: { mustNot: string; tick: number }[];
  planLines: string[];
  /** 01 §3's catalogue compiled for this fighter; stable for the whole bout. */
  behaviour: TierBehaviour;
  /** The trigger-gated half of the catalogue, recomputed each tick. */
  tierWeights: BehaviourWeights | null;
  /** Rule ids that fired on the last decision — the debug overlay reads these. */
  firedRules: string[];
  /** The reactive defence a successful read bought this tick (§2.4.2). */
  pendingDefence: DefenceId | null;
  /** `attackerRepeated` for 02's pattern read: the opponent's last family ... */
  lastOppFamily: OppFamily | null;
  /** ... and how many ticks running they have shown it. */
  oppFamilyRepeats: number;
  /**
   * Tick of the last strike or level change this fighter committed. `c.setup`
   * and §03's `grap.setupBonus` both ask "was there a setup just now?", and
   * `FighterWorldState.lastActionTick` cannot answer it: the loop stamps that
   * on every decision, including a step and a wait, so the answer was always
   * yes and the axis never fired.
   */
  lastSetupTick: number;
  /** Realism pass: the last combination begun, damped on the next choice. */
  lastMacroId: string | null;
  /** Realism pass: the fighter's own reading of the cards (`ai/scorecard.ts`). */
  score: ScoreBelief;
  /** Realism pass: this tick's scorecard urgency. */
  urgency: Urgency;
  /** Realism pass: decayed attempts/landings per strike family (`worksWeight`). */
  works: Record<string, { a: number; l: number; t: number }>;
  /** Realism pass: how strongly this fighter follows what works (IQ x adaptability). */
  worksGain: number;
  /** Realism pass: plan B in force (`switchToPlanB`): its weight shift and phase policies. */
  planB: { mode: ModeId; weights: Partial<Record<ActionFamily, number>>; clinch?: string; top?: string; bottom?: string } | null;
  /** The plan as plan B reads it (its phase policies), built once at the switch. */
  planBView: PlanView | null;
  /** Perf caches. */
  rangeCache: { oppId: number; intent: string; dStar: number; deadband: number } | null;
  urgencyTick: number;
}

// ---------------------------------------------------------------------------
// The policy
// ---------------------------------------------------------------------------

export class MmaPolicy implements DecisionPolicy {
  /** Development probe (scripts/dev): sees every scored decision. Never set in a bout. */
  static debugHook: ((info: {
    fighter: number; tick: number; candidates: readonly Candidate[]; scores: readonly number[]; tau: number;
    weights: WeightBundle[];
  }) => void) | null = null;
  private readonly states = new Map<number, AiState>();

  /**
   * The whole P3 budget for one fighter on one tick: 8, or 9 once more than
   * two fighters are live. The predicate is the loop's own
   * (`world.live().length > 2`, 09 §2.7) — a policy that disagreed with the
   * loop about the count would desynchronise the stream the moment a fighter
   * was stopped.
   */
  static drawsPerDecide(world: World): number {
    let live = 0;
    for (const f of world.fighters) if (!f.out) live++;
    return live > 2 ? DRAWS_PER_DECIDE_MULTI : DRAWS_PER_DECIDE;
  }

  /** What `decide()` itself takes: the budget less the loop's commit jitter. */
  static drawsInPolicy(world: World): number {
    return MmaPolicy.drawsPerDecide(world) - 1;
  }

  // -------------------------------------------------------------------------
  // Pre-bout
  // -------------------------------------------------------------------------

  /**
   * §2.1: per-bout draws happen once before tick 0 in fighter-id order. The
   * order within a fighter is fixed: style jitter (one uniform per family, in
   * `ACTION_FAMILIES` order), then whatever the plan generator declares it
   * needs for scouting noise. A generator that under-consumes is topped up, so
   * one side's plan quality can never shift the other side's stream.
   */
  prepare(world: World): void {
    const provider = currentPlanProvider();
    const ids = world.fighters.map((f) => f.id).sort((a, b) => a - b);
    for (const id of ids) {
      const f = world.fighters.find((w) => w.id === id);
      if (!f) continue;

      const style = {} as Record<ActionFamily, number>;
      for (const family of ACTION_FAMILIES) {
        const z = normalFromUniform(world.rng.next());
        style[family] = clamp(
          Math.exp(STYLE_JITTER_SD * z),
          STYLE_WEIGHT_MIN,
          STYLE_WEIGHT_MAX,
        );
      }

      const budget = Math.max(0, Math.trunc(provider.drawsPerFighter(f)));
      const before = world.rng.draws;
      let plan: PlanView | null = null;
      try {
        plan = provider.generate(world, f, world.rng);
      } catch {
        plan = null;
      }
      const used = world.rng.draws - before;
      for (let i = used; i < budget; i++) world.rng.next();

      const state = this.newState(f, plan, style, world);
      this.states.set(id, state);
      f.ai = state;

      world.emit({
        tick: world.tick, subMs: 0, round: world.round, kind: 'planSet',
        actor: id, target: -1,
        text: `${f.runtime.name}: ${state.intent.mode}`,
        detail: { plan: state.intent.mode, intent: state.intent.rangeTarget },
      });
    }
  }

  private newState(
    f: FighterWorldState,
    plan: PlanView | null,
    style: Record<ActionFamily, number>,
    world: World,
  ): AiState {
    const rt = f.runtime;
    const iq = rt.iqTier;
    const pacing = pacingFor(plan, 1);
    const intent: Intent = {
      mode: plan?.primaryMode ?? defaultModeFor(f),
      // With no plan (the T0 row of §2.5.8) the authored `preferredRange` is
      // the only statement of where this fighter wants the fight.
      rangeTarget: plan?.rangeTarget ?? rangeTargetOf(rt.def.style?.preferredRange),
      phaseTarget: plan?.phaseTarget ?? 'any',
      initiative: plan?.initiative ?? 'mixed',
      paceTarget: pacing?.paceTarget ?? DEFAULT_PACE_TARGET,
      riskAppetite: (pacing?.riskAppetite ?? 0) as RiskLevel,
      cagePolicy: plan?.cagePolicy ?? 'centre',
      focusWeapons: [...(plan?.primaryWeapons ?? [])],
      avoid: [...(plan?.avoidList ?? [])],
      emergency: null,
      perceivedScore: { roundsUp: 0, sigma: 0, lastRoundEstimate: 0 },
      effectiveIqTier: iq,
      since: world.tick,
    };
    return {
      fighterId: f.id,
      tdRound: { round: 1, n: 0 },
      lastStrikeTick: -1_000_000,
      plan,
      style,
      model: new OpponentModel(iq),
      ledger: new ExchangeLedger(),
      macro: newMacroState(),
      adjustments: [],
      intent,
      lastEvalS: 0,
      lastFamily: null,
      lastContext: 0,
      consecutiveFeints: 0,
      counterWindowUntilMs: -Infinity,
      hurtUntilMs: -Infinity,
      hurtBehaviourId: null,
      finisher: null,
      oppHurtUntilMs: -Infinity,
      finishRetryAfterMs: -Infinity,
      outcomesSeen: 0,
      reads: { attempts: 0, successes: 0, counters: 0, feintBites: 0 },
      cornerCues: [],
      lastKnockdownMs: -Infinity,
      composureBonus: 0,
      targetId: null,
      targetChoice: { targetId: null, policy: 'tgt.nearest', weight: 1, role: 'role.solo' },
      mustNotViolations: [],
      planLines: planLinesFor(plan),
      behaviour: tierBehaviourFor(rt),
      prefs: preferencesFor(rt),
      tierWeights: null,
      firedRules: [],
      pendingDefence: null,
      lastOppFamily: null,
      oppFamilyRepeats: 0,
      lastSetupTick: -Infinity,
      lastMacroId: null,
      score: newScoreBelief(),
      urgency: NO_URGENCY,
      works: {},
      planB: null,
      planBView: null,
      rangeCache: null,
      urgencyTick: -1_000_000,
      worksGain: Math.min(1.25, rt.iqTier / 4) * (0.5 + Math.max(0, Math.min(100, rt.def.mental.adaptability)) / 100),
    };
  }

  /** The AI state for a fighter, creating a default one if `prepare` was skipped. */
  stateOf(f: FighterWorldState, world: World): AiState {
    const existing = this.states.get(f.id);
    if (existing) return existing;
    const style = {} as Record<ActionFamily, number>;
    for (const family of ACTION_FAMILIES) style[family] = 1;
    const created = this.newState(f, null, style, world);
    this.states.set(f.id, created);
    f.ai = created;
    return created;
  }

  // -------------------------------------------------------------------------
  // Per tick
  // -------------------------------------------------------------------------

  /**
   * Draws 1-7 of the §2.1 order (`u_pattern`, `u_read`, `u_feint`, `u_eval`,
   * `u_select`, `u_timing`, `u_target`), plus `u_switch` in multi-opponent
   * modes. Draw 8, `u_commit`, is the loop's. They are taken first and
   * unconditionally; only then does anything branch, and the rest is wrapped so
   * a fault in a sub-layer costs this fighter a tick of action rather than the
   * bout's reproducibility.
   */
  decide(ctx: DecisionContext): Decision {
    const rng = ctx.rng;
    const multi = MmaPolicy.drawsPerDecide(ctx.world) === DRAWS_PER_DECIDE_MULTI;

    const uPattern = rng.next();
    const uRead = rng.next();
    const uFeint = rng.next();
    const uEval = rng.next();
    const uSelect = rng.next();
    const uTiming = rng.next();
    const uTarget = rng.next();
    const uSwitch = multi ? rng.next() : 0;

    try {
      return this.think(ctx, {
        uPattern, uRead, uFeint, uEval, uSelect, uTiming, uTarget, uSwitch, multi,
      });
    } catch {
      return waitDecision();
    }
  }

  private think(ctx: DecisionContext, u: Draws): Decision {
    const { world, self } = ctx;
    this.nowMs = world.nowMs;
    const st = this.stateOf(self, world);
    const rt = self.runtime;
    const nowS = world.nowMs / 1000;

    // --- housekeeping the decision reads from -----------------------------
    st.ledger.advance(nowS);
    st.model.decay(0.1);

    // --- targeting (draw 9 in multi modes) --------------------------------
    const choice = u.multi
      ? currentMultiTargetProvider().select(world, self, ctx.observed, st.targetId, u.uSwitch)
      : nearestChoice(world, self, st.targetId);
    if (choice.targetId !== st.targetId && st.targetId !== null && choice.targetId !== null) {
      world.emit({
        tick: world.tick, subMs: 0, round: world.round,
        kind: 'targetSwitch', actor: self.id, target: choice.targetId,
        text: `${rt.name} turns to ${choice.targetId}`,
        detail: { from: String(st.targetId), to: String(choice.targetId) },
      });
    }
    st.targetId = choice.targetId;
    st.targetChoice = choice;

    const opp = observedOf(ctx.observed, choice.targetId);
    if (!opp) return waitDecision();

    // --- perception (draws 1-3) -------------------------------------------
    const distanceM = Math.hypot(self.x - opp.x, self.z - opp.z);
    const onTop = isTopRole(world, self);
    const context = buildContext(self.posture, distanceM, onTop, st.model.active ? 0.5 : 0, st.lastFamily);
    st.lastContext = context;

    st.firedRules = [];
    const cues = this.perceive(st, self, opp, distanceM, u);
    this.noviceTells(st, world, self, u);
    this.readAndCounter(st, world, self, opp, u);
    this.resolveFeint(st, self, opp, u);

    // --- tactical layer (draw 4) ------------------------------------------
    this.evaluate(st, self, world, nowS, cues, u.uEval);
    this.updateEmergency(st, self, world, cues, u.uEval);

    // A fighter mid-commitment has already spent the action half of this tick.
    // Everything above still ran — the opponent model, the read, the defence —
    // and the defence is the half the loop will keep (`holdDefence`).
    if (!ctx.canAct) {
      self.tells.rules = st.firedRules;
      return { ...waitDecision(), defence: st.pendingDefence ?? 'def.neutral' };
    }

    // --- action layer (draws 5-8) -----------------------------------------
    const macroStep = this.continueMacro(st, self, cues, distanceM, world.tick, u.uFeint);
    if (macroStep) return macroStep;

    const enumeration = this.buildEnumeration(st, self, world, opp, distanceM);
    let candidates = enumerateActions(enumeration, opp.x - self.x, opp.z - self.z);
    // Phase 9: a shot is one committed movement (§2.3 B). Once the leg is
    // captured the shooter drives straight into a finish or a chain; he does
    // not stop to throw a punch or wait while the defender works his
    // sprawl, whizzer and hip heist on every free tick — which is how fewer
    // than one shot in eight used to reach the mat against a real 38 %
    // (FIGHT_DATA §3 #57).
    if (enumeration.slot === 'a' && hasPositionNode(self.position)
      && positionNode(self.position).family === 'attack') {
      const chain = candidates.filter((c) => c.kind === 'grapple');
      if (chain.length > 0) candidates = chain;
    }
    // Phase 9: a man on the floor in front of you is followed down — the
    // fighter who dropped him jumps on (`tech.knockdown_follow`) far more often
    // than he waves him up. As one candidate among fifty under the ordinary
    // weights it was almost never chosen, and a flash knockdown was followed
    // by a punch or two at a man on the floor and then nothing: 19 of 20
    // flash knockdowns went unpunished and knockdown-to-finish conversion sat
    // at ~50 % against a real 65 % (FIGHT_DATA §5). No new draw: the follow
    // decision reuses this tick's target-region draw, which the follow edge
    // does not read.
    if (self.position === 'pos.ground_knockdown' && u.uTarget < KNOCKDOWN_FOLLOW_P) {
      const follow = candidates.filter((c) => c.kind === 'grapple' && c.id === 'tech.knockdown_follow');
      if (follow.length > 0) candidates = follow;
    }
    if (candidates.length === 0) return waitDecision();

    st.tierWeights = behaviourWeights(st.behaviour, {
      // The opponent is walking this fighter down and there is fence behind.
      underPressure: distanceM < 1.6
        && distanceToWall(world.arena, self.x, self.z) < 1.5,
      panic: isRocked(self) || damageFracOf(self) > 0.30,
      readSucceeded: st.pendingDefence !== null || st.counterWindowUntilMs >= world.nowMs,
      oppAdvancing: (opp.vx * (self.x - opp.x) + opp.vz * (self.z - opp.z)) > 0,
      afterExchange: self.lastStruckTick >= world.tick - 10 || st.lastSetupTick >= world.tick - 10,
      onBottom: self.posture === 'ground' && !isTopRole(world, self),
      withinHalfMetre: distanceM < 0.5,
      fatigue: fatigueOf(self),
      oppCircles: Math.hypot(opp.vx, opp.vz) > 0.1,
    });
    for (const id of st.tierWeights.fired) st.firedRules.push(id);
    self.tells.rules = st.firedRules;

    // Perf: the cards move slowly; re-read them twice a second.
    if (world.tick - st.urgencyTick >= 5 || st.urgencyTick > world.tick) {
      st.urgency = this.scoreUrgency(st, self, world, opp.id);
      st.urgencyTick = world.tick;
    }
    const inputs = this.considerations(st, self, world, opp, distanceM, cues);
    const phaseTier = phaseTierFor(rt, self.posture, distanceM);
    // Realism pass: `mmaIntegration.gameplanExecution` — how closely he fights
    // the fight he meant to — narrows or widens the choice (x1.12 at 20 .. x0.84
    // at 90) [E]. It was a sub-skill nothing read.
    const gpe = rt.disciplines.mmaIntegration?.effective.gameplanExecution ?? 50;
    const tau = effectiveTau(
      tauForTier(decisionTier(phaseTier, st.intent.effectiveIqTier)) * (1.2 - 0.4 * clamp01(gpe / 100)),
      {
        fatigue: fatigueOf(self),
        rocked: isRocked(self),
        dump: 1 - clamp01(rt.composureEff / 100),
        dumpActive: world.round === 1 && nowS < 150,
        secondWind: false,
      },
    );

    const scores = new Array<number>(candidates.length);
    const scorer = new ConsiderationScorer(inputs);
    this.topNow = isTopRole(world, self);
    this.worksCache = new Map();
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      scores[i] = scorer.score(c, this.weightsFor(st, self, opp, c));
    }

    if (MmaPolicy.debugHook) {
      MmaPolicy.debugHook({ fighter: self.id, tick: world.tick, candidates, scores, tau,
        weights: candidates.map((c) => ({ ...this.weightsFor(st, self, opp, c) })) });
    }
    const sel = { residual: 0.5 };
    const pick = softmaxSelect(
      scores, tau, u.uSelect, familyShares(candidates.map((c) => c.family)),
      [
        this.strikeCap(st, self, world, candidates, opp),
        this.submissionCap(st, self, world, candidates),
        // A hurt fighter's §2.6.4 emergency (grab, shoot, tie up to survive)
        // is not paced by the plan's budgets.
        ...(st.intent.emergency === 'hurt' ? [] : [this.takedownCap(st, self, world, candidates)]),
        {
          mask: candidates.map((c) => c.family === 'levelChange' || c.family === 'feint'),
          cap: (FEINT_PER_MIN / 60) * (world.params.get('core.dtMs') / 1000),
        },
        this.grappleTempoCap(self, world, candidates),
        {
          mask: candidates.map((c) => c.family === 'clinchEntry' && self.posture === 'standing'
            && st.intent.emergency !== 'hurt'),
          // A clinch fighter's plan weights the entry (planWeight up to x1.4).
          cap: (CLINCH_ENTRY_PER_MIN / 60) * (world.params.get('core.dtMs') / 1000)
            * planWeight(st.plan, 'clinchEntry'),
        },
      ],
      sel,
    );
    let chosen = candidates[pick < 0 ? 0 : pick];
    // Realism pass: footwork momentum. A step in straight after a step out
    // (or the reverse) inside ~0.35 s, while he is already near the distance
    // he wants, is the in/out wobble the audit counted at ~40 reversals a
    // minute; a fighter at his range turns the reversal into a lateral step.
    if (chosen.kind === 'move') {
      const radial = chosen.family === 'advance' || chosen.family === 'inOut' ? 1
        : chosen.family === 'retreat' ? -1 : 0;
      const last = self.step.radial > 0.5 ? 1 : self.step.radial < -0.5 ? -1 : 0;
      if (radial !== 0 && last !== 0 && radial !== last && world.nowMs - self.step.untilMs < FOOTWORK.momentumMs
        && Math.abs(distanceM - inputs.intentRangeM) < 3 * (inputs.rangeDeadbandM ?? 0)) {
        const lateral = candidates.find((c) => c.kind === 'move' && (c.family === 'circle' || c.family === 'lateral'));
        if (lateral) chosen = lateral;
      }
    }

    // A macro may start here: the utility layer chose its head action, and the
    // rest of the sequence now runs unless something interrupts it (§2.2.5).
    // Realism pass: which combination follows the head strike is a weighted
    // choice (u_feint, now free: feint bites are resolved at commit), not
    // always the first matching chain in catalogue order.
    this.maybeBeginMacro(st, self, chosen, distanceM, world.tick, u.uFeint);

    if (chosen.isMustNot) {
      st.mustNotViolations.push({ mustNot: chosen.family, tick: world.tick });
    }
    st.lastFamily = chosen.family;
    if (chosen.kind === 'strike' && STRIKE_FAMILIES.has(chosen.family)) st.lastStrikeTick = world.tick;
    if (chosen.kind === 'grapple' && chosen.id !== null && isTakedownAttempt(chosen.id, self.position)) {
      if (st.tdRound.round !== world.round) st.tdRound = { round: world.round, n: 0 };
      st.tdRound.n += 1;
    }
    st.consecutiveFeints = chosen.family === 'feint' ? st.consecutiveFeints + 1 : 0;
    if (isSetupAction(chosen)) st.lastSetupTick = world.tick;
    st.ledger.note('attempt', chosen.family);
    if (chosen.kind === 'strike' && WORKS_EXPECTED[chosen.family] !== undefined) {
      noteWorks(st, chosen.family, 'a', world.nowMs / 1000);
    }

    return this.commit(st, self, chosen, u, chosen.family === 'feint' ? sel.residual : undefined);
  }

  // -------------------------------------------------------------------------
  // §2.4 perception
  // -------------------------------------------------------------------------

  /**
   * Draw 1 does double duty by *partition*: its lower tail is the pattern read
   * of the predicted incoming technique, its upper tail the per-tick hurt cue.
   * Both keep their exact marginal probability, and the budget stays at eight.
   */
  private perceive(
    st: AiState,
    self: FighterWorldState,
    opp: ObservedFighter,
    distanceM: number,
    u: Draws,
  ): Cues {
    const rt = self.runtime;
    const patternP = st.model.active ? st.model.p(st.lastContext, st.model.mostLikely(st.lastContext)) : 0;
    const patternSeen = u.uPattern < patternP;
    const hurtSeen = u.uPattern >= 1 - hurtCueP(rt);

    const cues = readCues({
      iqTier: rt.iqTier,
      visiblyHurt: opp.visiblyHurt,
      visiblyTired: opp.visiblyTired,
      handsDropped: opp.handsDropped,
      cut: opp.visiblyHurt,
      legDamaged: opp.balance < 0.6,
      inRecovery: opp.action !== 'idle' && opp.action !== 'move' && opp.actionPhase > 0.6,
      paceDrop: opp.visiblyTired ? 0.25 : 0,
      perceivedDamage: clamp01(1 - opp.balance),
      // Phase 9: nobody misses a knockdown. The per-tick hurt-cue roll is for
      // the subtle signs (legs dipping, a hand reaching for the fence); a man
      // on the floor is read by everyone, so the finish intent is not left to
      // a per-tick roll the knockdown usually outlasts.
      hurtCueSeen: hurtSeen || opp.posture === 'down',
    });

    // What the opponent is visibly doing is what the model counts.
    if (st.model.active && opp.action !== 'idle' && opp.action !== 'move'
      && hasTechnique(opp.action) && opp.actionPhase < 0.3) {
      const spec = technique(opp.action);
      st.model.note(st.lastContext, oppFamilyForSpec(spec.family));
    }
    // A pattern the fighter *saw* is worth more than one the table merely holds.
    if (patternSeen) st.reads.attempts += 0;
    void distanceM;
    return cues;
  }

  /**
   * `beh.gen.turn_away` (T0, P = 0.50 after a clean hit or three in two
   * seconds): the fighter turns his side or his back, arms over his head. It
   * is the single most expensive thing an untrained fighter does — the
   * follow-ups arrive against a turned back with no guard behind them — and it
   * is why a T0 is finished rather than merely outpointed.
   *
   * The roll rides in the *middle* band of draw 1, which `perceive` leaves
   * free: its lower tail is the pattern read and its upper tail the hurt cue.
   */
  private noviceTells(st: AiState, world: World, self: FighterWorldState, u: Draws): void {
    const pTurn = turnAwayP(st.behaviour);
    if (pTurn <= 0) return;
    const hitRecently = self.lastStruckTick >= world.tick - 20;
    if (!hitRecently || world.nowMs < self.tells.backTurnedUntilMs) return;
    const patternP = st.model.active
      ? st.model.p(st.lastContext, st.model.mostLikely(st.lastContext)) : 0;
    const hi = 1 - hurtCueP(self.runtime);
    const span = hi - patternP;
    if (span <= 0 || u.uPattern < patternP || u.uPattern >= hi) return;
    const v = (u.uPattern - patternP) / span;
    if (v >= pTurn) return;
    self.tells.backTurnedUntilMs = world.nowMs + 1000;
    st.firedRules.push('beh.gen.turn_away');
  }

  /**
   * Draw 2, partitioned four ways, in this order:
   *
   *   `[0, pEyes)`            `beh.gen.eyes_close` — the eyes shut and
   *                           "readP = 0 for the exchange"
   *   next `s x pPattern`     02 §2.4.3 read 1: the pattern was recognised
   *                           *before launch*, so the defender pre-commits
   *   next `s(1-pPattern)pRead`  read 2: the cue read at launch + telegraph
   *   the rest                nothing was seen
   *
   * with `s = 1 - pEyes`, and, *inside* either read band, the counter-on-read
   * of §2.4.4 below `p_counter` and the reactive-defence choice above it.
   * Nesting rather than reusing keeps every marginal exact and the draw budget
   * stays at eight.
   *
   * Two things this fixes at once.
   *
   * The read is what buys a *defence*, not only a counter: `beh.gen.read` says
   * "read → reactive defence / counter allowed; no read → positional defence
   * only", and until Phase 5 nothing in 07 ever set one, so chapter 02's whole
   * defence layer was dead and skill converted into offence alone.
   *
   * And the pattern read is the only way anything short of a telegraphed power
   * strike is ever defended: a jab's 130 ms startup is under every human
   * reaction, so the *reactive* window against it is negative at any tier. In a
   * mirror match the arrival logit's skill term cancels, so with no pattern
   * read two champions were exactly as hittable as two novices — which is why
   * the Phase 4 matrix had T5 vs T5 finishing 93 % of the time in 3.6 minutes.
   */
  private readAndCounter(
    st: AiState,
    world: World,
    self: FighterWorldState,
    opp: ObservedFighter,
    u: Draws,
  ): void {
    const rt = self.runtime;
    const nowMs = world.nowMs;
    st.pendingDefence = null;
    // Realism pass (§2.3.4): a fighter who bit a feint is executing the
    // reaction it sold; he reads nothing else until it is over.
    if (self.tactic.bitBy >= 0 && nowMs <= self.tactic.bitUntilMs) return;
    // §2.5.1: while his own strike is recovering his reads are worse.
    const exposure = nowMs <= self.tactic.exposedUntilMs ? self.tactic.exposedReadLogit : 0;
    const incoming = opp.action !== 'idle' && opp.action !== 'move' && hasTechnique(opp.action);
    st.reads.attempts += incoming ? 1 : 0;
    const spec = incoming ? technique(opp.action) : null;

    const pRead = readProbability({
      basePRead: baseReadP(rt, 'striking'),
      tier: rt.strikingTier,
      telegraphMs: spec ? spec.telegraph : 0,
      fatigue: fatigueOf(self),
      hurt: isRocked(self),
      anxietyPenalty: rt.anticipation.striking?.anxietyReadPenalty ?? 0,
      visionBlocked: nowMs < self.tells.eyesShutUntilMs,
      stanceFamiliarity: familiarityOf(rt, opp.stance),
      patternMods: (st.model.active && spec
        ? 2 * (st.model.p(st.lastContext, oppFamilyForSpec(spec.family)) - 1 / 12)
        : 0) + exposure,
      suppressed: !incoming,
    });

    // `beh.gen.eyes_close` (T0, P 0.70) / `beh.gen.eyes_close_t1` (T1, P 0.30),
    // on an incoming power strike only — a jab does not make anyone blink.
    const powerIn = spec !== null && spec.commitment.balance > 8;
    const pEyes = powerIn ? eyesCloseP(st.behaviour) : 0;
    if (spec !== null && u.uRead < pEyes) {
      self.tells.eyesShutUntilMs = nowMs + spec.startupMs + spec.activeMs;
      st.firedRules.push(rt.strikingTier <= 0 ? 'beh.gen.eyes_close' : 'beh.gen.eyes_close_t1');
      return;
    }

    const span = 1 - pEyes;
    if (span <= 0) return;

    // Read 1 (before launch). This is the read that matters, because read 2
    // arrives too late for most of the catalogue: perception is delayed by
    // `lagTicks` (two at a pro's reaction time) and a jab's whole flight is one
    // or two ticks, so by the time a fighter *sees* a jab it has already
    // landed. Only a fighter who predicts the family from his own model ever
    // defends one — which is `beh.box.reads_adapt`'s ladder from "T0 none" to
    // "T5 adapts within exchanges", and why the model is consulted here even
    // when nothing is visibly in flight.
    const predicted = st.model.active ? st.model.mostLikely(st.lastContext) : null;
    const observedFamily = spec === null ? null : oppFamilyForSpec(spec.family);
    if (observedFamily !== null) {
      if (observedFamily === st.lastOppFamily) st.oppFamilyRepeats += 1;
      else { st.lastOppFamily = observedFamily; st.oppFamilyRepeats = 1; }
    }
    const readFamily = observedFamily ?? predicted;
    const repeated = st.lastOppFamily === readFamily && st.oppFamilyRepeats >= 3;
    const habitual = predicted !== null && predicted === readFamily
      && st.model.p(st.lastContext, predicted) >= PATTERN_HABIT_P;
    const patternSpec = readFamily === null ? null
      : (spec ?? representativeTechnique(readFamily));
    const pPattern = patternSpec === null ? 0 : patternReadP({
      readP: baseReadP(rt, 'striking'),
      attackerRepeated: repeated,
      habitualEntry: habitual,
    }) * patternReadShare(rt.iqTier, repeated || habitual);

    const patternBand = span * pPattern;
    const cueBand = incoming ? span * (1 - pPattern) * pRead : 0;
    const patternRead = u.uRead < pEyes + patternBand;
    if (!patternRead && u.uRead >= pEyes + patternBand + cueBand) return;
    const readSpec = patternRead ? patternSpec : spec;
    if (readSpec === null) return;
    st.reads.successes += 1;
    // `beh.gen.read`: seeing it coming is worth something even when no reactive
    // defence fits the window — the fighter is set, not caught cold. 05 reads
    // this as the braced absorb, and `beh.gen.eyes_close`'s "absorb -0.15" is
    // the same coupling written from the other end.
    self.tells.readUntilMs = nowMs + readSpec.startupMs + readSpec.activeMs;

    // A fresh uniform, conditional on whichever read fired: the counter sits in
    // its lower tail and the defence choice takes the whole of it.
    const v = patternRead
      ? clamp01((u.uRead - pEyes) / Math.max(1e-9, patternBand))
      : clamp01((u.uRead - pEyes - patternBand) / Math.max(1e-9, cueBand));
    if (patternRead) st.firedRules.push('beh.box.reads_adapt');
    // §2.4.4: the counter rides *on* the defence rather than replacing it —
    // every row of 02's defence table carries its own `counter.bonus`, so the
    // pull that beat the cross is also what makes the counter available.
    // `beh.gen.reflex_counter` (T4-T5, ~0.45-0.53) against
    // `beh.gen.reflex_defensive` (T0-T1, ~0.05) is the tier ladder on which of
    // the two a read is worth.
    const pCounter = counterOnRead(rt);
    if (v < pCounter) {
      st.reads.counters += 1;
      st.counterWindowUntilMs = nowMs + 100;
      st.firedRules.push(rt.strikingTier >= 4 ? 'beh.gen.reflex_counter' : 'beh.box.block_counter');
    }

    // The defence the read buys. Latency is 02's, which is deliberately not
    // tier-scaled (`beh.gen.simple_rt_untiered`); everything tiered lives in
    // the window and in the repertoire.
    const chosen = reactiveDefence(st.behaviour, {
      spec: readSpec,
      latencyMs: defenceLatencyMs({
        reactionTimeMs: rt.reactionTimeMs,
        tier: rt.strikingTier,
        fatigue: fatigueOf(self),
        rocked: isRocked(self),
        stanceUnfamiliar: familiarityOf(rt, opp.stance) < 0.5,
      }),
      u: v,
      preCommitted: patternRead,
      // `def.shoulder_roll` needs the Philly shell; `def.step_back` and
      // `def.step_off` need room, and there is none on the fence.
      unavailable: [
        ...(rt.def.style.guardStyle === 'philly' ? [] : ['def.shoulder_roll' as DefenceId]),
        ...(distanceToWall(world.arena, self.x, self.z) < 0.8
          ? ['def.step_back' as DefenceId, 'def.step_off' as DefenceId]
          : []),
      ],
    });
    if (chosen.defence !== null) {
      st.pendingDefence = chosen.defence;
      for (const id of chosen.fired) st.firedRules.push(id);
    }
  }


  /** Draw 3: the feint bite (§2.4.5). */
  private resolveFeint(
    st: AiState,
    self: FighterWorldState,
    opp: ObservedFighter,
    u: Draws,
  ): void {
    // Realism pass: the bite is resolved once per feint, at the feinter's
    // commit (`bind.commitFeint`); a feint used to be a no-op the defender
    // could never even see. Here the defender only lives with the
    // consequence: while he is reacting to a feint he has no counter ready.
    // `u.uFeint` is no longer read here (the macro choice uses it).
    void opp; void u;
    if (self.tactic.bitBy >= 0 && this.nowMs <= self.tactic.bitUntilMs) {
      if (st.counterWindowUntilMs !== -Infinity) st.reads.feintBites += 1;
      st.counterWindowUntilMs = -Infinity;
    }
  }

  /** The world clock at the current `think` (read by the feint consequence). */
  private nowMs = 0;

  // -------------------------------------------------------------------------
  // §2.6 tactical layer
  // -------------------------------------------------------------------------

  /** Draw 4: `u_eval < P(change | signal)` at a due evaluation. */
  private evaluate(
    st: AiState,
    self: FighterWorldState,
    world: World,
    nowS: number,
    cues: Cues,
    uEval: number,
  ): void {
    const rt = self.runtime;
    st.intent.effectiveIqTier = effectiveIqTier({
      iqTier: rt.iqTier,
      damageFrac: damageFracOf(self),
      fatigue: fatigueOf(self),
      sinceKnockdownS: (world.nowMs - st.lastKnockdownMs) / 1000,
      rocked: isRocked(self),
    });
    st.adjustments = expireAdjustments(st.adjustments, world.tick);

    const triggers = this.triggers(st, self, cues);
    if (!evaluationDue(st.intent.effectiveIqTier, nowS - st.lastEvalS, triggers)) return;
    st.lastEvalS = nowS;

    if (uEval >= pChange(st.intent.effectiveIqTier, rt.def.mental.adaptability)) return;

    // Perf: `signals` is pure (it reads the ledger, the opponent model and the
    // runtime and writes nothing), so it is built only on the rare tick an
    // evaluation actually goes ahead rather than on every tick.
    const signals = this.signals(st, self, world, cues);
    const rows = candidateAdjustments(signals, st.intent.effectiveIqTier, st.plan);
    // Realism pass: plan B. When the primary plan is visibly failing — its
    // shots are stuffed, its strikes stopped landing, he keeps getting taken
    // down — a fighter with a plan B goes to it (07 §2.5.2 `fallbackMode`,
    // which the plan carried and nothing ever switched to).
    if (rows.some((r) => r.id === 'adj.td_stuffed_x2' || r.id === 'adj.drop_family' || r.id === 'adj.taken_down_x2')) {
      this.switchToPlanB(st, world, 'the plan is not working');
    }
    if (rows.length === 0) return;
    const dwellS = minDwellS(st.intent.effectiveIqTier);
    const dwellTicks = Number.isFinite(dwellS) ? Math.round(dwellS * 10) : Infinity;
    const row = rows[0];
    const built = buildAdjustment(row, signals, world.tick, dwellTicks, 'self');
    const before = st.adjustments.length;
    st.adjustments = applyAdjustment(st.adjustments, built, world.tick);
    if (st.adjustments.length !== before || st.adjustments.includes(built)) {
      this.applyPolicyPatch(st, built, world);
    }
  }

  /** Realism pass: go to the plan's fallback mode (once a bout). */
  private switchToPlanB(st: AiState, world: World, why: string): void {
    const fb = st.plan?.fallbackMode;
    if (!fb || st.planB || fb === st.plan?.primaryMode || fb === 'mode.outnumbered') return;
    const from = st.plan?.primaryMode;
    const next = MODE_DEFAULTS[fb as Exclude<ModeId, 'mode.outnumbered'>];
    const prev = from && from !== 'mode.outnumbered' ? MODE_DEFAULTS[from as Exclude<ModeId, 'mode.outnumbered'>] : null;
    if (!next) return;
    const weights: Partial<Record<ActionFamily, number>> = {};
    for (const [k, v] of Object.entries(next.weights)) weights[k as ActionFamily] = v;
    if (prev) {
      for (const [k, v] of Object.entries(prev.weights)) {
        weights[k as ActionFamily] = (weights[k as ActionFamily] ?? 1) / v;
      }
    }
    st.planB = { mode: fb, weights, clinch: next.clinchPolicy, top: next.groundTopPolicy, bottom: next.groundBottomPolicy };
    st.planBView = {
      ...(st.plan ?? {}), clinchPolicy: next.clinchPolicy, groundTopPolicy: next.groundTopPolicy,
      groundBottomPolicy: next.groundBottomPolicy,
    };
    st.rangeCache = null;
    st.intent.mode = fb;
    st.intent.rangeTarget = next.rangeTarget;
    st.intent.since = world.tick;
    world.emit({
      tick: world.tick, subMs: 0, round: world.round, kind: 'intentChange',
      actor: st.fighterId, target: st.targetId ?? -1,
      text: `goes to plan B: ${fb}`,
      detail: { from: from ?? '', to: fb, adjustment: why },
    });
  }

  private applyPolicyPatch(st: AiState, adj: Adjustment, world: World): void {
    const p = adj.policy;
    world.emit({
      tick: world.tick, subMs: 0, round: world.round, kind: 'adjustment',
      actor: st.fighterId, target: st.targetId ?? -1,
      text: adj.label, detail: { adjustment: adj.id },
    });
    if (!p) return;
    if (p.mode && p.mode !== st.intent.mode) {
      const from = st.intent.mode;
      st.intent.mode = p.mode;
      st.intent.since = world.tick;
      world.emit({
        tick: world.tick, subMs: 0, round: world.round, kind: 'intentChange',
        actor: st.fighterId, target: st.targetId ?? -1,
        text: `switches to ${p.mode}`,
        detail: { from, to: p.mode, adjustment: adj.id },
      });
    }
    if (p.initiative) st.intent.initiative = p.initiative;
    if (p.cagePolicy) st.intent.cagePolicy = p.cagePolicy;
    if (p.riskDelta) {
      st.intent.riskAppetite = clamp(st.intent.riskAppetite + p.riskDelta, -2, 2) as RiskLevel;
    }
    if (p.paceMult) st.intent.paceTarget *= p.paceMult;
    if (p.emergency !== undefined) st.intent.emergency = p.emergency;
  }

  private signals(
    st: AiState,
    self: FighterWorldState,
    world: World,
    cues: Cues,
  ): AdaptSignals {
    const rt = self.runtime;
    let collapsed: ActionFamily | null = null;
    for (const family of ACTION_FAMILIES) {
      const rate = st.ledger.hitRate(family, DROP_FAMILY_MIN_ATTEMPTS);
      if (rate !== null && rate < DROP_FAMILY_HIT_RATE) {
        collapsed = family;
        break;
      }
    }
    const rounds = world.ruleset.rounds.count;
    return {
      collapsedFamily: collapsed,
      bestFamily: st.ledger.bestFamily(),
      threatFamily: null,
      ownTdStuffedX2: st.ledger.consecutiveStuffs >= 2,
      takenDownX2: st.ledger.timesTakenDown >= 2,
      oppTired: cues.oppTired,
      oppHurt: cues.oppHurt,
      ownFatigue: fatigueOf(self),
      round: world.round,
      finalRound: world.round >= rounds,
      perceivedRoundsUp: st.intent.perceivedScore.roundsUp,
      needFinishDeficit: needFinishDeficit(rounds),
      ownVisionImpaired: false,
      cageExchanges: st.ledger.cageExchanges,
      oppAdjusted: st.model.active && st.model.hasAdjusted(st.lastContext),
      ownLegDamaged: self.damage.regions.leg.left.acute.acute > 30
        || self.damage.regions.leg.right.acute.acute > 30,
      oppLegDamaged: cues.oppLegDamaged,
      trapReady: false,
      // 01 §2.6 has two fields for the same idea: `losingBehaviour` (the
      // §2.6.3 enum) and the simpler `whenLosing`. Either one saying "do not
      // change" disables SC-2/SC-3.
      losingBehaviourUnchanged: rt.def.style.losingBehaviour === 'unchanged'
        || rt.def.style.whenLosing === 'hold',
      whenLosing: rt.def.style.whenLosing ?? 'press',
      isWrestler: rt.grapplingTier >= rt.strikingTier,
      isStriker: rt.strikingTier > rt.grapplingTier,
      strengthEdge: rt.effective.strength >= 60,
      subSpecialist: rt.disciplines.bjj.tier >= 4,
    };
  }

  private triggers(st: AiState, self: FighterWorldState, cues: Cues): EvalTrigger[] {
    const out: EvalTrigger[] = [];
    if (isRocked(self)) out.push('selfHurt');
    if (st.ledger.consecutiveStuffs >= 2) out.push('tdStuffedX2');
    if (st.ledger.timesTakenDown >= 1) out.push('takedown');
    if (st.model.active && st.model.hasAdjusted(st.lastContext)) out.push('oppAdjusted');
    if (cues.oppHurt) out.push('knockdown');
    return out;
  }

  /** §2.6.4 / §2.6.5: the two emergencies that override everything else. */
  private updateEmergency(
    st: AiState,
    self: FighterWorldState,
    world: World,
    cues: Cues,
    uEval: number,
  ): void {
    const rt = self.runtime;
    if (isRocked(self)) {
      if (world.nowMs >= st.hurtUntilMs) {
        st.hurtUntilMs = world.nowMs + hurtDurationS(uEval) * 1000;
        st.hurtBehaviourId = hurtBehaviour({
          effectiveIqTier: st.intent.effectiveIqTier,
          isGrappler: rt.grapplingTier >= rt.strikingTier,
          cageWorkTier: rt.disciplines.mmaIntegration.tier,
          experience: rt.experience,
          styleOverride: rt.def.style.hurtBehaviour,
          heart: rt.def.mental.heart,
          uHeart: uEval,
        });
        st.intent.emergency = 'hurt';
        world.emit({
          tick: world.tick, subMs: 0, round: world.round, kind: 'emergency',
          actor: self.id, target: st.targetId ?? -1,
          text: `${rt.name} is hurt — ${st.hurtBehaviourId}`,
          detail: { intent: st.hurtBehaviourId ?? 'hurt' },
        });
      }
      return;
    }
    if (world.nowMs >= st.hurtUntilMs && st.intent.emergency === 'hurt') {
      st.intent.emergency = null;
      st.hurtBehaviourId = null;
    }

    // Phase 9: a measured finisher who gave up on this hurt episode does not
    // re-read it on the very next tick. (The perception bug that hid every
    // hurt cue also hid this loop: once cues flowed, a stopped finisher
    // restarted every tick — hundreds of "smells the finish" a bout.)
    if (cues.oppHurt && world.nowMs >= st.finishRetryAfterMs) {
      st.oppHurtUntilMs = world.nowMs + OPP_HURT_BELIEF_MS;
    }
    if (world.nowMs < st.oppHurtUntilMs) {
      if (st.finisher === null) {
        st.finisher = finisherProfile(
          st.intent.effectiveIqTier,
          rt.def.mental.aggression,
          rt.composureEff,
          2,
        );
        st.intent.emergency = 'finish';
        world.emit({
          tick: world.tick, subMs: 0, round: world.round, kind: 'emergency',
          actor: self.id, target: st.targetId ?? -1,
          text: `${rt.name} smells the finish (${st.finisher})`,
          detail: { intent: st.finisher },
        });
      } else if (st.outcomesSeen > 0 && shouldStopFinishing(st.finisher, st.ledger)) {
        // The measured finisher returns to the plan when it stops working.
        st.finisher = null;
        st.intent.emergency = null;
        st.oppHurtUntilMs = -Infinity;
        st.finishRetryAfterMs = world.nowMs + FINISH_RETRY_MS;
      }
    } else if (st.intent.emergency === 'finish') {
      st.finisher = null;
      st.intent.emergency = null;
    }
  }

  // -------------------------------------------------------------------------
  // §2.2 action layer
  // -------------------------------------------------------------------------

  private buildEnumeration(
    st: AiState,
    self: FighterWorldState,
    world: World,
    opp: ObservedFighter,
    distanceM: number,
  ): EnumerationContext {
    const cageDistM = distanceToWall(world.arena, self.x, self.z);
    const engagement = world.engagements.of(self.id);
    return {
      self: self.runtime,
      ruleset: world.ruleset,
      posture: self.posture,
      node: self.posture === 'standing'
        ? (self.position === 'pos.ground_knockdown' ? self.position : standingNodeFor(self.runtime, distanceM))
        : self.position,
      slot: engagement ? (engagement.a === self.id ? 'a' : 'b') : null,
      distanceM,
      cageDistM,
      atCage: cageDistM < 0.8,
      damage: {
        head: clamp01(self.damage.regions.head.acute / 100),
        body: clamp01(self.damage.regions.body.acute / 100),
        leadLeg: clamp01(self.damage.regions.leg.left.acute.acute / 100),
        rearLeg: clamp01(self.damage.regions.leg.right.acute.acute / 100),
        arms: 0,
      },
      balance: clamp01(self.balance),
      hasTarget: true,
      outnumbered: world.fighters.filter((f) => !f.out && f.team !== self.team).length >= 2,
      positionValue: 0.5,
      mustNots: st.plan?.mustNots ?? [],
      shield: 0,
      oppStriking: opp.action !== 'idle' && opp.action !== 'move' && hasTechnique(opp.action),
    };
  }

  private considerations(
    st: AiState,
    self: FighterWorldState,
    world: World,
    opp: ObservedFighter,
    distanceM: number,
    cues: Cues,
  ): ConsiderationInputs {
    const roundLengthS = world.ruleset.rounds.lengthS;
    const elapsedS = (world.roundTick * 100) / 1000;
    const pacing = pacingFor(st.plan, world.round);
    const paceTarget = Math.max(1, pacing?.paceTarget ?? st.intent.paceTarget);
    return {
      ownFatigue: fatigueOf(self),
      oppFatigue: cues.oppFatigueEstimate,
      oppHurt: cues.oppHurt ? 1 : 0,
      ownCageDistM: distanceToWall(world.arena, self.x, self.z),
      oppCageDistM: distanceToWall(world.arena, opp.x, opp.z),
      roundTimeLeftFrac: clamp01(1 - elapsedS / Math.max(1, roundLengthS)),
      behind: st.intent.perceivedScore.roundsUp < 0,
      setupRecent: setupActive(st, world) ? 1 : 0,
      expectedThreat: st.model.active ? st.model.expectedThreat(st.lastContext) : 0.3,
      // Realism pass: a man walking into range is as counterable as one
      // recovering from a strike — that is the whole art of the counter-
      // puncher and of the longer fighter's jab (02 §2.5.1; LIT_B §5.10).
      oppInRecovery: cues.oppInRecovery || this.oppEntering(self, opp, distanceM) ? 1 : 0,
      balance: clamp01(self.balance),
      // Realism pass: the cards move the appetite for risk continuously.
      riskAppetite: clamp(st.intent.riskAppetite
        + URGENCY_EFFECT.riskPress * st.urgency.press
        + URGENCY_EFFECT.riskDesperation * st.urgency.desperation
        - URGENCY_EFFECT.riskProtect * st.urgency.protect, -2, 2),
      // §2.5.5 P-6 is explicit that `c.pace` counts *landed*, not thrown:
      // "pure pressure without landed strikes does not win rounds". The target
      // is `tendencies.paceSLpM`, which is a landed rate, so a thrown rate on
      // top of it also compared two different units.
      // Phase 9: controlled on strikes *thrown* (the variable the fighter
      // actually chooses), against the plan's landed target over a nominal
      // accuracy. On the landed rate the attempt volume ran inversely to
      // accuracy and the brake had no history at the bell.
      paceRatio: st.ledger.paceEstimate(paceTarget / PACE_NOMINAL_ACCURACY, elapsedS)
        / (paceTarget / PACE_NOMINAL_ACCURACY),
      dwellExceeded: dwellExceeded(st, self, world),
      lookahead: 0,
      ...this.rangeTargetFor(st, self, world, opp),
      distanceM,
      effectiveIqTier: st.intent.effectiveIqTier,
    };
  }

  /**
   * Realism pass: the scorecard urgency of this moment (`ai/scorecard.ts`).
   * The current round's lead is read from the same visible quantities the
   * judges weigh, running; the rounds-up belief was set at the last break.
   */
  private scoreUrgency(st: AiState, self: FighterWorldState, world: World, oppId: number): Urgency {
    const rounds = world.ruleset.rounds.count;
    if (rounds <= 1 || world.ruleset.scoring.judges <= 0) return NO_URGENCY;
    const jr = world.judges as { ledgers?: RoundLedger[] } | null;
    const mine = jr?.ledgers?.[self.id];
    const theirs = jr?.ledgers?.[oppId];
    const roundS = world.ruleset.rounds.lengthS || 300;
    const elapsedS = (world.roundTick * world.params.get('core.dtMs')) / 1000;
    const lead = mine && theirs ? currentRoundLead(visibleMargin(mine, theirs, roundS)) : 0;
    const u = urgency({
      roundsUp: st.score.roundsUp,
      lead,
      round: world.round,
      rounds,
      elapsedFrac: elapsedS / roundS,
      iqTier: st.intent.effectiveIqTier,
      holdWhenLosing: self.runtime.def.style.losingBehaviour === 'unchanged'
        || self.runtime.def.style.whenLosing === 'hold',
    });
    return shapeUrgency(u, self.runtime.def.style.losingBehaviour, self.runtime.def.style.whenLosing,
      self.runtime.def.mental.heart);
  }

  /** Is the (perceived) opponent stepping into this fighter's range? */
  private oppEntering(self: FighterWorldState, opp: ObservedFighter, distanceM: number): boolean {
    if (self.posture !== 'standing' || opp.posture !== 'standing' || distanceM <= 0) return false;
    const vr = (opp.vx * (self.x - opp.x) + opp.vz * (self.z - opp.z)) / distanceM;
    if (vr <= FOOTWORK.enteringSpeedMs) return false;
    let longMax = LONG_MAX_CACHE.get(self.runtime);
    if (longMax === undefined) {
      longMax = bandLimits(reachProfile(self.runtime.effectiveReachM, self.runtime.effectiveKickReachM)).longMax;
      LONG_MAX_CACHE.set(self.runtime, longMax);
    }
    return distanceM <= longMax + 0.25;
  }

  /**
   * Realism pass: where this fighter wants to stand *against this opponent*
   * (`footwork.preferredDistance`), with the hold band that stops in/out
   * wobble. A fighter who is hurt keeps the pre-pass behaviour of his hurt
   * profile (the adjustment weights decide), which is why only the intent's
   * range label is read here.
   */
  private rangeTargetFor(
    st: AiState, self: FighterWorldState, world: World, opp: ObservedFighter,
  ): { intentRangeM: number; rangeDeadbandM: number } {
    const oppRt = world.fighters[opp.id]?.runtime;
    if (!oppRt) {
      return { intentRangeM: rangeTargetMetres(st.intent.rangeTarget, self.runtime), rangeDeadbandM: 0 };
    }
    // Perf: the runtimes are fixed for the bout, so the answer only changes
    // with the opponent or the intent's range label.
    const c = st.rangeCache;
    if (c && c.oppId === opp.id && c.intent === st.intent.rangeTarget) {
      return { intentRangeM: c.dStar, rangeDeadbandM: c.deadband };
    }
    const pd = preferredDistance(self.runtime, oppRt, st.intent.rangeTarget);
    st.rangeCache = { oppId: opp.id, intent: st.intent.rangeTarget, dStar: pd.dStar, deadband: pd.deadband };
    return { intentRangeM: pd.dStar, rangeDeadbandM: pd.deadband };
  }

  /**
   * Phase 9 pace governor (PHASE4_FINDINGS C-9). The plan's pace target is
   * turned into a per-tick hazard of starting a strike — target strikes a
   * minute over the 600 decisions a minute — scaled by a proportional
   * feedback term on the fighter's own recent rate, and applied as a cap on
   * the strike share of the softmax (`MassCap`). A multiplicative brake on the
   * scores could not hold the rate: the utility has no absolute scale, so at
   * close range, where nearly every candidate is a strike, halving every
   * strike's score barely moved the choice, and the unbraked rate is 20-25 a
   * minute. The position multipliers carry the observed difference in output
   * between phases (FIGHT_DATA §3 #23-#24: 7 % of significant attempts in
   * 15 % clinch time and 7 % in 24 % ground time, plus the non-significant
   * volume that lives mostly on the mat).
   */
  private strikeCap(
    st: AiState, self: FighterWorldState, world: World, candidates: readonly Candidate[],
    opp: ObservedFighter,
  ): MassCap {
    const pacing = pacingFor(st.plan, world.round);
    const landedTarget = Math.max(0.5, pacing?.paceTarget ?? st.intent.paceTarget);
    const onTop = self.posture === 'ground' && isTopRole(world, self);
    const posMult = self.posture === 'ground'
      ? (onTop ? PACE_GOVERNOR.groundTopMult : PACE_GOVERNOR.groundBottomMult)
      : self.posture === 'clinch' ? PACE_GOVERNOR.clinchMult : 1;
    const u = st.urgency;
    const scoreMult = 1 + URGENCY_EFFECT.pacePress * u.press + URGENCY_EFFECT.paceDesperation * u.desperation
      - URGENCY_EFFECT.paceProtect * u.protect;
    const target = (landedTarget / PACE_NOMINAL_ACCURACY) * posMult * tierPaceMult(self.runtime.strikingTier)
      * scoreMult * fatiguePaceMult(fatigueOf(self), FATIGUE_PACE.slope * heartFatigueMult(self.runtime.def.mental.heart));
    const est = st.ledger.paceEstimate(target, (world.roundTick * world.params.get('core.dtMs')) / 1000);
    const ratio = est / target;
    const gain = ratio <= 1 ? 1 + PACE_GOVERNOR.boost * (1 - ratio) : Math.pow(1 / ratio, PACE_GOVERNOR.n);
    const dtS = world.params.get('core.dtMs') / 1000;
    const perTick = (target / 60) * dtS;
    // Exchanges, not a metronome: striking comes in bursts — a combination,
    // the answer to it, the answer to that — separated by lulls of feinting
    // and footwork (FIGHT_DATA §3 #127: over half of each round is "low
    // intensity", no strike by either man in the last two seconds, at a pace
    // that a steady rate would leave only ~40 % quiet). Inside an exchange
    // (either man struck within `EXCHANGE.windowS`) the hazard is raised,
    // outside it lowered; the feedback term keeps the minute's total.
    // Standing only: clinch and ground work is continuous. [E: Phase 9]
    let burst = 1;
    if (self.posture === 'standing') {
      const oppStriking = typeof opp.action === 'string' && opp.action.startsWith('tech.');
      const inExchange = oppStriking
        || (world.tick - st.lastStrikeTick) * dtS < EXCHANGE.windowS
        || (world.tick - self.lastStruckTick) * dtS < EXCHANGE.windowS;
      burst = inExchange ? EXCHANGE.inMult : EXCHANGE.outMult;
      // Realism pass: who starts the exchange is a style (LIT_B §5.10). A
      // counter-fighter holds his fire until there is something to counter —
      // the other man's strike in the air, his recovery, his step in — and
      // then lets go; a lead fighter starts more of them himself. Same
      // minute's total (the feedback term), different timing.
      const style = counterLean(st.intent.initiative, self.runtime.def.style.initiative);
      if (style !== 0) {
        const opening = oppStriking || (opp.action !== 'idle' && opp.action !== 'move' && opp.actionPhase > 0.6)
          || this.oppEntering(self, opp, Math.hypot(self.x - opp.x, self.z - opp.z));
        burst *= style > 0 ? (opening ? 1 + 2.0 * style : 1 - 0.5 * style)
          : (opening ? 1 : 1 - 0.8 * style);
      }
    }
    // A man who smells blood does not pace himself: in the §2.6 finish
    // emergency the plan's pace no longer holds him back.
    const finishing = st.intent.emergency === 'finish' ? PACE_GOVERNOR.finishMult : 1;
    return {
      mask: candidates.map((c) => c.kind === 'strike' && STRIKE_FAMILIES.has(c.family)),
      cap: Math.min(1, PACE_GOVERNOR.gain * perTick * gain * burst * finishing),
    };
  }

  /**
   * Phase 9: the same governor for submission attempts. The utility has no
   * absolute scale, so on the mat, once the strike share is capped, the
   * freed mass went to whatever else the node offered — and the back, the
   * mount and the turtle offer many submissions — which produced ten or more
   * attempts per fifteen minutes against the real 0.45 (FIGHT_DATA §3 #69).
   * Attempts are rare, opportunistic events: a per-tick hazard by the kind of
   * position (a back taker works the choke almost continuously, a guard
   * player rarely has the angle), scaled by the attacker's submission skill.
   */
  private submissionCap(
    st: AiState, self: FighterWorldState, world: World, candidates: readonly Candidate[],
  ): MassCap {
    const mask = candidates.map((c) => c.kind === 'submission');
    if (!mask.some(Boolean)) return { mask, cap: 1 };
    const node = self.position;
    const fam = hasPositionNode(node) ? positionNode(node).family : 'standingFree';
    const top = isTopRole(world, self);
    const perMin = SUB_HAZARD_PER_MIN[top ? `${fam}:top` : `${fam}:bottom`]
      ?? SUB_HAZARD_PER_MIN[fam] ?? SUB_HAZARD_PER_MIN.default;
    // The submission artist attacks far more often than the wrestler who
    // happens to hold the same position: scaled by the §01 SUB composite
    // (0-100) and by a submission-hunting plan.
    // §01 SUB composites run ~20-25 at UFC level (the pooled population's
    // subAttack ~23, subDefence ~18), ~7-9 at T2.
    const skill = clamp01(self.runtime.grappling.subAttack / SUB_SKILL_REF.attack);
    const hunt = st.plan?.primaryMode === 'mode.submission_hunt' ? SUB_HUNT_MULT : 1;
    // Opportunity comes from the man underneath as much as the man on top:
    // a weak submission defender leaves arms out and gives up his neck, which
    // is why regional bouts see more attempts than the UFC does (FIGHT_DATA
    // §3 #97 / 09 §7.3 T7: T2 0.7-1.0, T3 0.6-0.8, UFC 0.45 per 15 min).
    const partner = self.partnerId === null ? null : world.fighters[self.partnerId];
    const defSkill = Math.max(3, partner?.runtime.grappling.subDefence ?? SUB_SKILL_REF.defence);
    const opportunity = Math.max(0.5, Math.min(3,
      Math.pow(SUB_SKILL_REF.defence / defSkill, SUB_OPPORTUNITY_EXP)));
    const scoreMult = Math.max(0.2, 1 + URGENCY_EFFECT.subDesperation * st.urgency.desperation
      + URGENCY_EFFECT.subProtect * st.urgency.protect);
    const perTick = (perMin / 60) * (world.params.get('core.dtMs') / 1000)
      * (0.3 + 0.7 * skill) * opportunity * hunt * scoreMult * SUB_HAZARD_SCALE;
    return { mask, cap: Math.min(1, perTick) };
  }

  /**
   * Phase 9: and for takedown attempts, from the plan's own per-round
   * takedown target (`tdAttemptTarget`, 07 §2.5), which nothing read before.
   * Shots, trips, throws and clinch takedowns share the budget.
   */
  private takedownCap(
    st: AiState, self: FighterWorldState, world: World, candidates: readonly Candidate[],
  ): MassCap {
    // Only the edges that *start* a takedown spend the budget; the finish of a
    // leg already captured is the same attempt, not a new one.
    const mask = candidates.map((c) => c.kind === 'grapple' && c.id !== null
      && isTakedownAttempt(c.id, self.position));
    if (!mask.some(Boolean)) return { mask, cap: 1 };
    const pacing = pacingFor(st.plan, world.round);
    const grappler = self.runtime.grapplingTier >= self.runtime.strikingTier;
    const u = st.urgency;
    const scoreMult = Math.max(0.2, 1
      + (grappler ? URGENCY_EFFECT.tdPressGrappler : URGENCY_EFFECT.tdPressStriker) * Math.max(u.press, u.desperation)
      + (grappler ? URGENCY_EFFECT.tdProtectGrappler : URGENCY_EFFECT.tdProtectStriker) * u.protect);
    const perRound = Math.max(TD_GOVERNOR.floorPerRound, pacing?.tdAttemptTarget ?? TD_GOVERNOR.floorPerRound)
      * scoreMult * fatiguePaceMult(fatigueOf(self), FATIGUE_PACE.shotSlope)
      * tdClassMult(self.runtime.body.weightClass, self.runtime.body.sex);
    const roundS = Math.max(60, world.ruleset.rounds.lengthS || 300);
    const dtS = world.params.get('core.dtMs') / 1000;
    const perTick = (perRound / roundS) * dtS;
    // Feedback on this round's count against the pro-rated target, shrunk by
    // a prior so the first attempt of a round does not swing it.
    const elapsedS = world.roundTick * dtS;
    const done = st.tdRound.round === world.round ? st.tdRound.n : 0;
    const prior = (perRound * TD_GOVERNOR.priorS) / roundS;
    const ratio = (done + prior) / ((perRound * elapsedS) / roundS + prior);
    const gain = ratio <= 1 ? 1 + TD_GOVERNOR.boost * (1 - ratio) : Math.pow(1 / ratio, TD_GOVERNOR.n);
    void self;
    return { mask, cap: Math.min(1, TD_GOVERNOR.gain * perTick * gain), exact: true };
  }

  /**
   * Phase 9: the grappling tempo. In the clinch and on the mat the fighter
   * who is free chose a positional edge (a pass, an escape, a pummel, a sweep)
   * almost every time he was free — fifteen attempts a minute in contact,
   * which spent the energy pools three to four times faster than the
   * research bands (lactate 9 mmol/L by the middle of round 1, DAMAGE §4.1
   * puts 10-21 at the *end* of a bout) and churned positions so fast that
   * control time never accrued. Real grappling is positional: a top player
   * holds, strikes and passes when the chance comes; a bottom player works
   * frames and picks moments to explode. The edge attempts are capped at a
   * per-minute hazard by role [E: tuned Phase 9]; takedown shots have their
   * own budget.
   */
  private grappleTempoCap(
    self: FighterWorldState, world: World, candidates: readonly Candidate[],
  ): MassCap {
    const inShot = hasPositionNode(self.position) && positionNode(self.position).family === 'attack';
    const shooter = inShot && world.engagements.slotOf(self.id) === 'a';
    const mask = candidates.map((c) => c.kind === 'grapple' && c.id !== null
      && !isTakedownAttempt(c.id, self.position));
    // Inside a shot the shooter's chain resolves at its own speed (§2.3 B
    // durations). The defender's sprawl, whizzer and hip heist are already
    // priced into the finish's baseP ("0.40 if the defender is already
    // half-sprawled"); letting him also fire them on every free tick counted
    // the defence twice, so his active counters share the contact tempo.
    if (shooter || (!inShot && self.posture !== 'ground' && self.posture !== 'clinch')) {
      return { mask, cap: 1 };
    }
    const perMin = self.posture === 'clinch' ? GRAPPLE_TEMPO_PER_MIN.clinch
      : isTopRole(world, self) ? GRAPPLE_TEMPO_PER_MIN.top : GRAPPLE_TEMPO_PER_MIN.bottom;
    // Better grapplers chain more (0.6x at T0 .. 1.4x at T5).
    const tierMult = 0.6 + 0.16 * self.runtime.grapplingTier;
    // Underneath, working to get up or sweep is not optional: it is a
    // hazard, not a ceiling (a pinned man frames, shrimps and wall-walks
    // whatever else the utility liked); on top and in the clinch it is a
    // ceiling on an otherwise free choice.
    const bottom = self.posture === 'ground' && !isTopRole(world, self) && !inShot;
    return {
      mask, cap: Math.min(1, (perMin / 60) * (world.params.get('core.dtMs') / 1000) * tierMult),
      ...(bottom ? { exact: true } : {}),
    };
  }

  /** §2.2.3: style x plan x adapt x matchup, plus `w_multi`. */
  private weightsFor(
    st: AiState,
    self: FighterWorldState,
    opp: ObservedFighter,
    c: Candidate,
  ): WeightBundle {
    let adapt = adaptWeight(st.adjustments, c.family);
    if (st.intent.emergency === 'hurt' && st.hurtBehaviourId) {
      adapt *= hurtWeights(st.hurtBehaviourId, st.intent.effectiveIqTier)[c.family] ?? 1;
    }
    if (st.intent.emergency === 'finish' && st.finisher) {
      adapt *= finisherWeights(st.finisher, opp.posture === 'down')[c.family] ?? 1;
    }
    // §2.4.4 consequence 2: a successful read forces counters up for this tick.
    // Realism pass (bug): this compared the window's end with 0, so after the
    // first read-counter of a bout the x2.5 counter boost never switched off —
    // the sprawl posture and the cross were permanently favoured and the
    // "standing in a sprawl" posture took ~60 % of all non-strike decisions.
    if (st.counterWindowUntilMs >= this.nowMs && isCounterFamily(c.family)) {
      adapt *= COUNTER_ON_READ_MULT;
    }
    // 01 §3: the catalogue's own `w(x) xN` clauses. They ride on `w_adapt` so
    // they sit under the same `ai.utility.clamp` as every other multiplier
    // rather than being a parallel, unbounded channel.
    adapt *= st.tierWeights?.weights.get(c.family) ?? 1;
    // Realism pass: the plan's phase policies (07 §2.5.2 clinch / ground-top /
    // ground-bottom), which were stored on every plan and read by nothing.
    adapt *= phasePolicyWeight(st.planBView ?? st.plan, c.family, self.posture, this.topNow);
    if (c.kind === 'submission' && c.id !== null) adapt *= subFamilyWeight(c.id);
    adapt *= initiativeWeight(self.runtime.def.style.initiative, c.family);
    if (st.planB) adapt *= st.planB.weights[c.family] ?? 1;
    // Realism pass: do more of what lands (see `worksWeight`).
    if (c.kind === 'strike' && st.worksGain > 0 && WORKS_EXPECTED[c.family] !== undefined) {
      let ww = this.worksCache.get(c.family);
      if (ww === undefined) {
        ww = worksWeight(st, c.family, this.nowMs / 1000);
        this.worksCache.set(c.family, ww);
      }
      adapt *= ww;
    }
    // Perf: one scratch bundle, filled per candidate and read at once by
    // `scoreValue`; nothing keeps a reference to it.
    const w = this.weightScratch;
    w.style = st.style[c.family] ?? 1;
    // F-3: the authored preference for *this id*. The plan can only speak in
    // families, and a guillotine specialist differs from an armbar
    // specialist only by id.
    w.pref = preferenceWeight(st.prefs, c.id, c.family);
    w.plan = planWeight(st.plan, c.family);
    w.adapt = adapt;
    w.matchup = this.matchupWeight(self, opp, c.family);
    w.multi = st.targetChoice.weight;
    return w;
  }

  private readonly weightScratch: WeightBundle = { style: 1, pref: 1, plan: 1, adapt: 1, matchup: 1, multi: 1 };
  /** Set once per decision: is this fighter the top/attacking slot right now? */
  private topNow = false;
  /** Per decision: `worksWeight` by family (a fresh short-lived map; see SIM_PERF_PASS). */
  private worksCache = new Map<string, number>();

  /**
   * `w_matchup`: the live-geometry terms that cannot sit in the plan because
   * the feet move. ST-1's lead-foot battle and the cage rules are recomputed
   * every tick from the stances and positions.
   */
  private matchupWeight(
    self: FighterWorldState,
    opp: ObservedFighter,
    family: ActionFamily,
  ): number {
    const open = isOpenStance(self.stance, opp.stance);
    if (!open) {
      // ST-7 closed stance.
      if (family === 'jab') return 1.2;
      if (family === 'leadHook') return 1.1;
      if (family === 'lowKick') return 1.1;
      if (family === 'rearKick') return 0.9;
      if (family === 'clinchEntry') return 1.1;
      return 1;
    }
    // ST-1 / ST-2 / ST-3 open stance.
    const lateral = (self.x - opp.x) * Math.cos(opp.facing) - (self.z - opp.z) * Math.sin(opp.facing);
    const foot = leadFootBattle(self.stance, opp.stance, lateral);
    if (family === 'jab') return 0.75;
    if (family === 'cross') return foot.dominant ? 1.4 : 1.2;
    if (family === 'parryCross') return 1.4;
    if (family === 'circleAway' || family === 'lateral') return foot.dominant ? 1.5 : 1.2;
    if (family === 'rearKick' || family === 'bodyKick') return 1.4;
    if (family === 'leadLowKick') return foot.dominant ? 1.3 : 1;
    if (family === 'leadHook') return foot.dominant ? 1.1 : 1;
    if (family === 'clinchEntry') return 0.9;
    return 1;
  }

  // -------------------------------------------------------------------------
  // §2.2.5 macros
  // -------------------------------------------------------------------------

  private continueMacro(
    st: AiState,
    self: FighterWorldState,
    cues: Cues,
    distanceM: number,
    tick: number,
    uFree: number,
  ): Decision | null {
    if (!macroRunning(st.macro)) return null;
    const reason = abortReason(st.macro, self.runtime.strikingTier, {
      oppHurt: cues.oppHurt,
      wasHit: self.lastStruckTick >= tick - 5,
      // §2.2.5: the step is re-scored against abort each tick, and "the
      // opponent's changed range" is the common case — a combination whose next
      // beat cannot reach is not a combination any more. This is also what
      // keeps a macro from emitting an out-of-range technique, which the
      // resolver would have to reject.
      rangeLost: !this.macroStepInRange(st, self, distanceM),
      free: self.action === null,
    });
    if (reason !== 'none') {
      resetMacro(st.macro);
      return null;
    }
    const step = advanceMacro(st.macro, tick);
    if (!step) {
      resetMacro(st.macro);
      return null;
    }
    st.lastFamily = step.family;
    st.ledger.note('attempt', step.family);
    return {
      kind: step.kind === 'grapple' ? 'grapple' : step.kind === 'move' ? 'move' : 'strike',
      what: step.id,
      targetId: st.targetId,
      defence: 'def.neutral',
      moveX: 0,
      moveZ: 0,
      intentTag: `${st.macro.macro?.id ?? 'macro'}:${step.id}`,
      payload: {
        macro: st.macro.macro?.id, step: st.macro.step,
        // A feint inside a macro is sold with this tick's free uniform.
        ...(step.kind === 'feint' ? { biteU: uFree } : {}),
      },
    };
  }

  /** Can the macro's next step still reach from here? */
  private macroStepInRange(st: AiState, self: FighterWorldState, distanceM: number): boolean {
    const macro = st.macro.macro;
    if (!macro) return false;
    const next = macro.steps[st.macro.step];
    if (!next) return false;
    if (next.kind !== 'strike' || !hasTechnique(next.id)) {
      // Movement, feints and grappling entries have no band of their own; the
      // coarse limit is the awareness radius.
      return distanceM <= 2.5;
    }
    const rt = self.runtime;
    const profile = reachProfile(rt.effectiveReachM, rt.effectiveKickReachM);
    return rangeFit(technique(next.id), distanceM, profile, rt.strikingMean).available;
  }

  private maybeBeginMacro(
    st: AiState,
    self: FighterWorldState,
    chosen: Candidate,
    distanceM: number,
    tick: number,
    u: number,
  ): void {
    if (macroRunning(st.macro)) return;
    if (chosen.kind !== 'strike') return;
    const rt = self.runtime;
    const cap = comboCap({
      tier: rt.strikingTier,
      wrestlerEdgeTiers: 0,
      atLevelChangeRange: distanceM < 1.2,
      fenceBonus: false,
      planCap: st.plan?.comboCapMax ?? undefined,
    });
    if (cap <= 1) return;
    const legal: Macro[] = availableMacros(rt.strikingTier, cap)
      .filter((m) => m.steps.length > 1 && m.steps[0].id === chosen.id);
    if (legal.length === 0) return;
    // 01 §2.6 `favouriteCombos`: among the chains this tier and this cap allow,
    // run the one the author wrote. A reorder, never an unlock, and no draw —
    // the head action was already chosen by the utility layer.
    const options = preferComboOrder(legal, st.prefs.combos);
    // Realism pass: a weighted draw over the chains that start with this
    // strike, not always the first. An authored favourite weighs x3; a single
    // strike (no combination at all) stays an option, more so for fighters
    // with little combination craft; and the chain thrown last time is
    // damped, because a fighter who repeats the same combination is read
    // (§2.4.3) and every coach says so. The uniform is this tick's u_feint,
    // which the policy no longer needs for the bite (resolved at commit).
    const craft = strikingCraft(self.runtime).combinations;
    const singleW = 0.6 + 1.4 * (1 - Math.min(1, craft / 100));
    const favourites = new Set(st.prefs.combos.map((c) => c.id));
    const weights = options.map((m) => {
      let wgt = favourites.has(m.id) ? 3 : 1;
      if (m.id === st.lastMacroId) wgt *= COMBO_REPEAT_DAMP;
      return wgt;
    });
    let total = singleW;
    for (const x of weights) total += x;
    let r = Math.min(0.999999, Math.max(0, u)) * total;
    if (r < singleW) return;
    r -= singleW;
    let idx = options.length - 1;
    for (let i = 0; i < options.length; i++) {
      if (r < weights[i]) { idx = i; break; }
      r -= weights[i];
    }
    const macro = options[idx];
    st.lastMacroId = macro.id;
    // The head action is already committed this tick, so the macro starts at
    // its second step next tick.
    beginMacro(st.macro, macro, tick);
    advanceMacro(st.macro, tick);
  }

  // -------------------------------------------------------------------------
  // §2.3 commit
  // -------------------------------------------------------------------------

  private commit(st: AiState, self: FighterWorldState, c: Candidate, u: Draws, biteU?: number): Decision {
    const rt = self.runtime;
    const exec: ExecutionQuality = executionQuality({
      spec: c.spec ?? null,
      tier: executionTierFor(rt, c.kind),
      fatigue: fatigueOf(self),
      requestedTarget: c.targetRegion ?? 'head',
      telegraphMod: rt.telegraphMod,
      lateralStep: c.kind === 'move',
      powerStrike: c.risk >= 0.35 && c.kind === 'strike',
    }, u.uTiming, u.uTarget);

    return {
      kind: c.kind,
      what: c.id,
      targetId: st.targetId,
      // `beh.gen.read`: a read buys a *reactive* defence, and it outranks the
      // neutral posture a strike or a step would otherwise hold.
      defence: st.pendingDefence ?? c.defence,
      moveX: c.moveX,
      moveZ: c.moveZ,
      intentTag: c.intentTag,
      payload: {
        exec, family: c.family, ...(c.short ? { short: true } : {}),
        ...(biteU !== undefined ? { biteU } : {}),
      },
    };
  }

  /**
   * The loop's hook for resolved outcomes. §2.6.1's signals are hit rates,
   * stuffed shots and takedowns conceded, and none of those are visible from
   * inside `decide()` — P4 knows them. Until the loop calls this, the ledger
   * holds attempts only and the rules that need landings stay quiet rather than
   * firing on a spurious zero hit rate.
   *
   * TODO(chapter 09): call this from the P4 resolution step.
   */
  noteOutcome(
    fighterId: number,
    kind: 'landed' | 'absorbed' | 'absorbedHeavy' | 'knockdown'
    | 'tdLanded' | 'tdStuffed' | 'takenDown' | 'counterEaten' | 'cageExchange',
    family: ActionFamily | null = null,
  ): void {
    const st = this.states.get(fighterId);
    if (!st) return;
    st.ledger.note(kind, family);
    if (kind === 'landed' && family !== null && WORKS_EXPECTED[family] !== undefined) {
      noteWorks(st, family, 'l', this.nowMs / 1000);
    }
    st.outcomesSeen += 1;
    if (kind === 'knockdown') st.lastKnockdownMs = -Infinity;
  }

  // -------------------------------------------------------------------------
  // §2.6.6 the corner
  // -------------------------------------------------------------------------

  /**
   * Five draws per fighter per break, in the §2.6.6 order: cue-1 correctness,
   * cue-2 correctness, uptake-1, uptake-2, score-noise. Always taken, in
   * fighter-id order, whether or not the fighter has a corner.
   */
  betweenRounds(world: World, round: number): void {
    const ids = world.fighters.map((f) => f.id).sort((a, b) => a - b);
    for (const id of ids) {
      const f = world.fighters.find((w) => w.id === id);
      const uCorrect1 = world.rng.next();
      const uCorrect2 = world.rng.next();
      const uUptake1 = world.rng.next();
      const uUptake2 = world.rng.next();
      const uScore = world.rng.next();
      if (!f) continue;
      const st = this.stateOf(f, world);
      const rt = f.runtime;

      // SC-1 (Realism pass): the fighter scores the round he just fought from
      // what he could see, through his and his corner's eyes, once per break;
      // under open scoring he is told the cards (`ai/scorecard.ts`).
      const openScoring = world.config.settings.judgingMode === 'open';
      const opp = world.fighters.find((o) => o.id !== id && o.team !== f.team);
      const jr = world.judges as {
        history?: RoundLedger[][];
        panel?: { cards: number[][][] } | null;
      } | null;
      const hist = jr?.history ?? [];
      const last = hist.length > 0 ? hist[hist.length - 1] : null;
      if (last && opp && last[id] && last[opp.id]) {
        const roundS = world.ruleset.rounds.lengthS || 300;
        const margin = visibleMargin(last[id], last[opp.id], roundS);
        const trueWon = openScoring ? panelRoundShare(jr?.panel?.cards ?? null, hist.length - 1, id, opp.id) : null;
        scoreRoundBelief(st.score, margin, st.intent.effectiveIqTier, normalFromUniform(uScore),
          trueWon === null ? null : { trueWon });
      }
      const lastP = st.score.perRound.length > 0 ? st.score.perRound[st.score.perRound.length - 1] : 0.5;
      // Plan B at the break: he lost that round clearly (as he saw it).
      if (rt.iqTier >= 2 && lastP < 0.3 && world.round <= world.ruleset.rounds.count) {
        this.switchToPlanB(st, world, 'lost the round');
      }
      st.intent.perceivedScore = {
        roundsUp: st.score.roundsUp,
        sigma: openScoring ? 0 : 1,
        lastRoundEstimate: lastP > 0.6 ? 1 : lastP < 0.4 ? -1 : 0,
      };
      world.emit({
        tick: world.tick, subMs: 0, round, kind: 'scoreUpdate',
        actor: id, target: -1,
        text: `${rt.name} believes he is ${st.intent.perceivedScore.roundsUp >= 0 ? 'up' : 'down'}`,
        detail: { belief: st.intent.perceivedScore.roundsUp },
      });

      // CO-1 / CO-2: at most two cues, each correct with the corner's tier
      // probability and accepted with the fighter's uptake probability.
      const cornerTier = defaultCornerTier(rt.iqTier);
      const signals = this.signals(st, f, world, {
        oppHurt: false, oppTired: false, oppCut: false, oppLegDamaged: false,
        oppInRecovery: false, oppFatigueEstimate: 0.5, oppDamageEstimate: 0.5,
      });
      const wanted = candidateAdjustments(signals, 5, null);
      st.cornerCues = [];
      const correctness = [uCorrect1, uCorrect2];
      const uptakes = [uUptake1, uUptake2];
      for (let i = 0; i < CORNER_MAX_CUES; i++) {
        const target: AdjustmentId | null = wanted[i] ? wanted[i].id : null;
        const cue = cornerCue(target, cornerTier, correctness[i], correctness[i]);
        const isPaceCue = cue.adjustment === 'adj.behind_final'
          || cue.adjustment === 'adj.self_low_stamina';
        const pAccept = cornerUptakeP({
          fighterIqTier: rt.iqTier,
          adaptability: rt.def.mental.adaptability,
          damageFrac: damageFracOf(f),
          contradictsPlan: false,
          isPaceCue,
        });
        const accepted = uptakes[i] < pAccept;
        const row = wanted.find((r) => r.id === cue.adjustment)
          ?? candidateAdjustments(signals, 5, null).find((r) => r.id === cue.adjustment);
        if (accepted && row) {
          const adj = buildAdjustment(row, signals, world.tick, Infinity, 'corner');
          st.adjustments = applyAdjustment(st.adjustments, adj, world.tick);
          this.applyPolicyPatch(st, adj, world);
        }
        st.cornerCues.push({ text: cue.adjustment, correct: cue.correct, accepted });
        world.emit({
          tick: world.tick, subMs: 0, round, kind: 'cornerCue',
          actor: id, target: -1,
          text: `corner: ${cue.adjustment}${accepted ? '' : ' (ignored)'}`,
          detail: { cue: cue.adjustment, adjustment: cue.adjustment },
        });
      }

      // CO-4 affirmation: composure for the next round, no technical change.
      st.composureBonus = CORNER_AFFIRM_COMPOSURE;
      st.ledger.resetRound();
      st.lastEvalS = 0;
      resetMacro(st.macro);
    }
  }

  // -------------------------------------------------------------------------
  // §2.6.7 panel projection
  // -------------------------------------------------------------------------

  intents(world: World): readonly FighterIntent[] {
    return world.fighters.map((f) => {
      const st = this.states.get(f.id);
      if (!st) {
        return {
          fighterId: f.id, mode: 'idle', phase: 'mid' as const, planLines: [],
          adjustments: [], scoreBelief: 0.5, emergency: false,
          tierRules: [], animationTags: [],
        };
      }
      return {
        fighterId: f.id,
        mode: st.intent.mode,
        phase: phaseOf(st.intent, f),
        planLines: st.planLines,
        adjustments: st.adjustments.map((a) => ({
          id: a.id,
          trigger: a.trigger,
          sinceRound: world.round,
        })),
        scoreBelief: beliefToConfidence(st.intent.perceivedScore.roundsUp),
        emergency: st.intent.emergency !== null,
        // 01 §3: which catalogue rows are driving this fighter right now, and
        // the clips they ask for. `rulesFor` is no longer dead data.
        tierRules: [...st.firedRules],
        animationTags: st.behaviour.animationTags,
      };
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Draws {
  uPattern: number;
  uRead: number;
  uFeint: number;
  uEval: number;
  uSelect: number;
  uTiming: number;
  uTarget: number;
  uSwitch: number;
  multi: boolean;
}

function waitDecision(): Decision {
  return {
    kind: 'wait', what: null, targetId: null, defence: 'def.neutral',
    moveX: 0, moveZ: 0, intentTag: 'wait',
  };
}

function observedOf(observed: ObservedState | null, id: number | null): ObservedFighter | null {
  if (!observed || id === null) return null;
  for (const f of observed.fighters) if (f.id === id) return f;
  return null;
}

function nearestChoice(
  world: World,
  self: FighterWorldState,
  current: number | null,
): TargetChoice {
  const near = world.nearestOpponent(self);
  return {
    targetId: near ? near.id : current,
    policy: 'tgt.nearest',
    weight: 1,
    role: 'role.solo',
  };
}

function fatigueOf(f: FighterWorldState): number {
  return clamp01(f.damage.f);
}

function isRocked(f: FighterWorldState): boolean {
  return f.damage.has('state.rocked');
}

function damageFracOf(f: FighterWorldState): number {
  return clamp01(f.damage.regions.head.structural / 100);
}

/** §2.2.4: the discipline tier of the *phase*, not the fighter's best one. */
function phaseTierFor(
  rt: { strikingTier: number; grapplingTier: number; disciplines: Record<string, { tier: number }> },
  posture: 'standing' | 'clinch' | 'ground' | 'down' | 'out',
  distanceM: number,
): number {
  if (posture === 'ground' || posture === 'down') return rt.disciplines.bjj.tier;
  if (posture === 'clinch') return rt.disciplines.wrestling.tier;
  return distanceM < 0.9 ? Math.max(rt.strikingTier, rt.disciplines.wrestling.tier) : rt.strikingTier;
}

/**
 * Is this fighter the top / attacking / controlling slot of his engagement?
 * Phase 9: this used to be read off the node id ("no 'bottom' or 'guard' in
 * the name"), which called *both* fighters "on top" in side control, half
 * guard, mount, the back and the turtle — the man underneath got the top's
 * ground-and-pound budget and submission hazards, and no bottom tempo.
 */
function isTopRole(world: World, self: FighterWorldState): boolean {
  if (!world.engagements.of(self.id)) return false;
  const role = world.engagements.roleOf(self.id);
  return role === 'top' || role === 'attacker';
}

/**
 * What grants the §03 setup window: a strike (chapter 02's own wording is
 * "inside `grap.setupWindowMs` of a strike or a feint") and the level change,
 * whose §2.3 A row says in as many words that it "grants SETUP to the next
 * shot".
 */
function isSetupAction(c: Candidate): boolean {
  return c.kind === 'strike' || c.family === 'levelChange';
}

/** Is this fighter still inside `grap.setupWindowMs` of their last setup? */
function setupActive(st: AiState, world: World): boolean {
  const windowTicks = world.params.get('grap.setupWindowMs') / world.params.get('core.dtMs');
  return world.tick - st.lastSetupTick <= windowTicks;
}

/**
 * Realism pass: 07 §2.5.2's phase policies as family multipliers. A plan
 * says how its fighter wants the clinch (avoid .. wall), the top of the
 * ground (stand and reset .. hunt the submission) and the bottom (stand up
 * first .. hunt from guard); these are what make a kickboxer and a wrestler
 * *behave* differently once the fight leaves the feet. [E] magnitudes, bounded
 * by the utility clamp like every other multiplier.
 */
export const PHASE_POLICY_WEIGHTS = Object.freeze({
  clinch: {
    avoid: { clinchEntry: 0.5, cagePin: 0.7, breakClinch: 1.8, clinchStrike: 0.9 },
    break: { clinchEntry: 0.7, breakClinch: 1.5 },
    accept: {},
    seek: { clinchEntry: 1.4, breakClinch: 0.6, cagePin: 1.2 },
    wall: { clinchEntry: 1.5, cagePin: 1.6, breakClinch: 0.4, clinchStrike: 1.2 },
  } as Record<string, Partial<Record<ActionFamily, number>>>,
  top: {
    standAndReset: { standUp: 3.0, pass: 0.6, submission: 0.5, backTake: 0.7, ride: 0.7 },
    passByStrikes: { groundStrike: 1.2, pass: 1.2, standUp: 0.5 },
    ride: { ride: 1.4, pass: 1.1, standUp: 0.3 },
    gnp: { groundStrike: 1.4, ride: 1.1, standUp: 0.3 },
    subHunt: { submission: 1.5, backTake: 1.3, pass: 1.2, standUp: 0.3 },
  } as Record<string, Partial<Record<ActionFamily, number>>>,
  bottom: {
    standUpFirst: { standUp: 1.5, wallWalk: 1.5, sweep: 0.8, bottomSubmission: 0.6 },
    wallWalk: { wallWalk: 2.0, standUp: 1.2 },
    sweep: { sweep: 1.6, standUp: 0.8 },
    subHunt: { bottomSubmission: 1.8, sweep: 1.3, standUp: 0.6, wallWalk: 0.6 },
  } as Record<string, Partial<Record<ActionFamily, number>>>,
});

export function phasePolicyWeight(
  plan: PlanView | null, family: ActionFamily, posture: FighterWorldState['posture'], top: boolean,
): number {
  if (!plan) return 1;
  if (posture === 'standing' || posture === 'clinch') {
    return (plan.clinchPolicy && PHASE_POLICY_WEIGHTS.clinch[plan.clinchPolicy]?.[family]) ?? 1;
  }
  if (posture === 'ground') {
    if (top) return (plan.groundTopPolicy && PHASE_POLICY_WEIGHTS.top[plan.groundTopPolicy]?.[family]) ?? 1;
    return (plan.groundBottomPolicy && PHASE_POLICY_WEIGHTS.bottom[plan.groundBottomPolicy]?.[family]) ?? 1;
  }
  return 1;
}

/** The standing §03 node a distance puts a free fighter in. */
function standingNodeFor(
  rt: { effectiveReachM: number; effectiveKickReachM: number },
  distanceM: number,
): PositionId {
  const band = bandFor(distanceM, reachProfile(rt.effectiveReachM, rt.effectiveKickReachM));
  if (band === 'clinch' || band === 'close') return 'pos.standing_close';
  if (band === 'mid') return 'pos.standing_mid';
  return 'pos.standing_long';
}

/**
 * `intent.rangeTarget` is a *band* label, not a length: §2.5 writes "rangeTarget
 * long" and leaves the metres to §02, because a band edge is a function of the
 * fighter's own reach (§2.1.1) and two fighters do not agree on where "long" is.
 *
 * The fixed 1.9 / 1.3 / 0.8 m this used to return were outside §02's ladder
 * altogether: for a pooled-average reach the long band ends at 1.21 m and
 * everything past 1.48 m is `out`, so a plan that said "fight at long range"
 * parked the fighter 0.4 m beyond his own kick range. `c.range_target` then
 * rewarded the movement that kept him there, no technique was ever in its home
 * band, no §03 standing node but `pos.standing_long` was ever current — and
 * `pos.standing_long` has no outgoing edges, so no takedown or clinch entry was
 * reachable either.
 *
 * The band midpoint is the honest reading of the label.
 */
function rangeTargetMetres(
  t: 'long' | 'mid' | 'short',
  rt: { effectiveReachM: number; effectiveKickReachM: number },
): number {
  const l = bandLimits(reachProfile(rt.effectiveReachM, rt.effectiveKickReachM));
  if (t === 'long') return (l.midMax + l.longMax) / 2;
  if (t === 'mid') return (l.closeMax + l.midMax) / 2;
  return (BAND_BOUNDS.clinchMax + l.closeMax) / 2;
}

function dwellExceeded(st: AiState, self: FighterWorldState, world: World): boolean {
  const engagement = world.engagements.of(self.id);
  if (engagement && engagement.kind === 'clinch') {
    const limit = (st.plan?.clinchDwellS ?? 3) * 1000;
    return engagement.timers.dwell > limit;
  }
  return false;
}

function familiarityOf(
  rt: { stanceFamiliarity: { orthodox: number; southpaw: number; switch: number } },
  stance: 'orthodox' | 'southpaw',
): number {
  return clamp01(rt.stanceFamiliarity[stance] ?? 1);
}

function isCounterFamily(f: ActionFamily): boolean {
  // Realism pass: `sprawl` removed — a read *strike* is not countered with a
  // sprawl; the sprawl answers shots, which 03 resolves on its own terms.
  return f === 'counterWindow' || f === 'parryCross' || f === 'baitCross'
    || f === 'cross' || f === 'overhand' || f === 'check';
}

/**
 * The technique a predicted *family* stands for, so a pattern read can pick a
 * defence before anything has been thrown. 02's defence table is keyed on
 * strike classes, and a class is what the opponent model predicts; these are
 * the plainest member of each class.
 */
function representativeTechnique(family: OppFamily): TechniqueSpec | null {
  switch (family) {
    case 'jab': return technique('tech.jab');
    case 'power': return technique('tech.cross');
    case 'kick': return technique('tech.kick_low_rear');
    case 'knee': return technique('tech.knee_straight');
    case 'elbow': return technique('tech.elbow_horizontal');
    // A level change, a takedown or a clinch entry is 03's to defend, not 02's.
    default: return null;
  }
}

function oppFamilyForSpec(family: string):
'jab' | 'power' | 'kick' | 'knee' | 'elbow' | 'levelChange' | 'clinchEntry'
| 'takedown' | 'groundStrike' | 'submission' | 'movement' | 'defend' {
  switch (family) {
    case 'straight': return 'jab';
    case 'hook': case 'uppercut': case 'overhand': case 'spinning': return 'power';
    case 'teep': case 'lowKick': case 'bodyKick': case 'headKick': return 'kick';
    case 'knee': return 'knee';
    case 'elbow': return 'elbow';
    default: return 'movement';
  }
}

function defaultModeFor(f: FighterWorldState): ModeId {
  const rt = f.runtime;
  if (rt.grapplingTier > rt.strikingTier) {
    return rt.disciplines.bjj.tier > rt.disciplines.wrestling.tier
      ? 'mode.submission_hunt'
      : 'mode.wrestle_control';
  }
  const bias = rt.def.style.pressureBias ?? 50;
  if (bias >= 65) return 'mode.pressure_striking';
  if (bias <= 35) return 'mode.counter_striking';
  return 'mode.distance_striking';
}

function planLinesFor(plan: PlanView | null): string[] {
  if (!plan) return [];
  const lines: string[] = [];
  if (plan.primaryMode) lines.push(plan.primaryMode);
  if (plan.rangeTarget) lines.push(`fight at ${plan.rangeTarget} range`);
  if (plan.primaryWeapons && plan.primaryWeapons.length > 0) {
    lines.push(`weapons: ${plan.primaryWeapons.join(', ')}`);
  }
  for (const m of plan.mustNots ?? []) lines.push(`never: ${m}`);
  return lines;
}

function phaseOf(intent: Intent, f: FighterWorldState): FighterIntent['phase'] {
  if (f.posture === 'ground' || f.posture === 'down') return 'ground';
  if (f.posture === 'clinch') return 'clinch';
  if (intent.rangeTarget === 'long') return 'long';
  if (intent.rangeTarget === 'short') return 'close';
  return 'mid';
}

/**
 * Open scoring (SC-0): this fighter's share of the panel's verdict on one
 * round: 1 when a majority of judges gave it to him, 0 when to the other
 * man, 0.5 when split evenly or even. Null when there is no panel.
 */
function panelRoundShare(cards: number[][][] | null, roundIndex: number, self: number, opp: number): number | null {
  if (!cards || cards.length === 0) return null;
  let mine = 0;
  let theirs = 0;
  for (const judge of cards) {
    const r = judge[roundIndex];
    if (!r) continue;
    if (r[self] > r[opp]) mine++;
    else if (r[opp] > r[self]) theirs++;
  }
  if (mine + theirs === 0) return 0.5;
  return mine > theirs ? 1 : theirs > mine ? 0 : 0.5;
}
