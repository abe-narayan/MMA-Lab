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
import {
  reachProfile, rangeFit, bandFor, bandLimits, isOpenStance, leadFootBattle,
  BAND_BOUNDS,
} from '../striking/range';
import { technique, hasTechnique } from '../striking/catalogue';
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
  behaviourWeights, eyesCloseP, reactiveDefence, tierBehaviourFor, turnAwayP,
  type BehaviourWeights, type TierBehaviour,
} from './behaviour';
import {
  decisionTier, effectiveTau, scoreAction, softmaxSelect, tauForTier,
  type ConsiderationInputs, type WeightBundle,
} from './utility';
import {
  abortReason, advance as advanceMacro, availableMacros, begin as beginMacro, comboCap,
  isRunning as macroRunning, newMacroState, reset as resetMacro, type Macro, type MacroState,
} from './macros';
import { executionQuality, executionTierFor, type ExecutionQuality } from './execution';
import {
  ExchangeLedger, OpponentModel, baseFeintBiteP, baseReadP, buildContext, counterOnRead,
  feintBiteProbabilityFor, hurtCueP, readCues, readProbability,
  COUNTER_ON_READ_MULT, type Cues,
} from './perceive';
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

/** Per-fighter AI state. Stored on `FighterWorldState.ai`, which is opaque. */
export interface AiState {
  fighterId: number;
  plan: PlanView | null;
  /** `w_style(a)`: per-bout jittered style vector. */
  style: Record<ActionFamily, number>;
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
  /**
   * Tick of the last strike or level change this fighter committed. `c.setup`
   * and §03's `grap.setupBonus` both ask "was there a setup just now?", and
   * `FighterWorldState.lastActionTick` cannot answer it: the loop stamps that
   * on every decision, including a step and a wait, so the answer was always
   * yes and the axis never fired.
   */
  lastSetupTick: number;
}

// ---------------------------------------------------------------------------
// The policy
// ---------------------------------------------------------------------------

export class MmaPolicy implements DecisionPolicy {
  private readonly states = new Map<number, AiState>();

  /**
   * The whole P3 budget for one fighter on one tick: 8, or 9 once more than
   * two fighters are live. The predicate is the loop's own
   * (`world.live().length > 2`, 09 §2.7) — a policy that disagreed with the
   * loop about the count would desynchronise the stream the moment a fighter
   * was stopped.
   */
  static drawsPerDecide(world: World): number {
    return world.live().length > 2 ? DRAWS_PER_DECIDE_MULTI : DRAWS_PER_DECIDE;
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
      rangeTarget: plan?.rangeTarget ?? 'mid',
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
      tierWeights: null,
      firedRules: [],
      pendingDefence: null,
      lastSetupTick: -Infinity,
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
    const onTop = isTopRole(self.position);
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

    // --- action layer (draws 5-8) -----------------------------------------
    const macroStep = this.continueMacro(st, self, cues, distanceM, world.tick);
    if (macroStep) return macroStep;

    const enumeration = this.buildEnumeration(st, self, world, opp, distanceM);
    const candidates = enumerateActions(enumeration, opp.x - self.x, opp.z - self.z);
    if (candidates.length === 0) return waitDecision();

    st.tierWeights = behaviourWeights(st.behaviour, {
      // The opponent is walking this fighter down and there is fence behind.
      underPressure: distanceM < 1.6
        && distanceToWall(world.arena, self.x, self.z) < 1.5,
      panic: isRocked(self) || damageFracOf(self) > 0.30,
      readSucceeded: st.pendingDefence !== null || st.counterWindowUntilMs >= world.nowMs,
      oppAdvancing: (opp.vx * (self.x - opp.x) + opp.vz * (self.z - opp.z)) > 0,
      afterExchange: self.lastStruckTick >= world.tick - 10 || st.lastSetupTick >= world.tick - 10,
      onBottom: self.posture === 'ground' && !isTopRole(self.position),
      withinHalfMetre: distanceM < 0.5,
      fatigue: fatigueOf(self),
      oppCircles: Math.hypot(opp.vx, opp.vz) > 0.1,
    });
    for (const id of st.tierWeights.fired) st.firedRules.push(id);
    self.tells.rules = st.firedRules;

    const inputs = this.considerations(st, self, world, opp, distanceM, cues);
    const phaseTier = phaseTierFor(rt, self.posture, distanceM);
    const tau = effectiveTau(
      tauForTier(decisionTier(phaseTier, st.intent.effectiveIqTier)),
      {
        fatigue: fatigueOf(self),
        rocked: isRocked(self),
        dump: 1 - clamp01(rt.composureEff / 100),
        dumpActive: world.round === 1 && nowS < 150,
        secondWind: false,
      },
    );

    const scores = new Array<number>(candidates.length);
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      scores[i] = scoreAction(c, inputs, this.weightsFor(st, self, opp, c)).score;
    }

    const pick = softmaxSelect(scores, tau, u.uSelect);
    const chosen = candidates[pick < 0 ? 0 : pick];

    // A macro may start here: the utility layer chose its head action, and the
    // rest of the sequence now runs unless something interrupts it (§2.2.5).
    this.maybeBeginMacro(st, self, chosen, distanceM, world.tick);

    if (chosen.isMustNot) {
      st.mustNotViolations.push({ mustNot: chosen.family, tick: world.tick });
    }
    st.lastFamily = chosen.family;
    st.consecutiveFeints = chosen.family === 'feint' ? st.consecutiveFeints + 1 : 0;
    if (isSetupAction(chosen)) st.lastSetupTick = world.tick;
    st.ledger.note('attempt', chosen.family);

    return this.commit(st, self, chosen, u);
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
      hurtCueSeen: hurtSeen,
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
   * Draw 2, partitioned three ways, in this order:
   *
   *   `[0, pEyes)`                       `beh.gen.eyes_close` — the eyes shut
   *                                      and "readP = 0 for the exchange"
   *   `[pEyes, pEyes + (1-pEyes) pRead)` the cue read succeeds
   *   the rest                           nothing was seen
   *
   * and, *inside* the read band, the counter-on-read of §2.4.4 below
   * `p_counter` and the reactive-defence choice above it. Nesting rather than
   * reusing keeps every marginal exact — P(eyes) = pEyes, P(read) =
   * (1-pEyes) x pRead, which is what "readP = 0 when the eyes are shut" means —
   * and the draw budget stays at eight.
   *
   * The read is what buys a *defence*, not only a counter: `beh.gen.read` says
   * "read → reactive defence / counter allowed; no read → positional defence
   * only", and until Phase 5 nothing in 07 ever set one, so chapter 02's whole
   * defence layer was dead and skill converted into offence alone.
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
      patternMods: st.model.active && spec
        ? 2 * (st.model.p(st.lastContext, oppFamilyForSpec(spec.family)) - 1 / 12)
        : 0,
      suppressed: !incoming,
    });

    if (!incoming || spec === null) return;

    // `beh.gen.eyes_close` (T0, P 0.70) / `beh.gen.eyes_close_t1` (T1, P 0.30),
    // on an incoming power strike only — a jab does not make anyone blink.
    const powerIn = spec.commitment.balance > 8;
    const pEyes = powerIn ? eyesCloseP(st.behaviour) : 0;
    if (u.uRead < pEyes) {
      self.tells.eyesShutUntilMs = nowMs + spec.startupMs + spec.activeMs;
      st.firedRules.push(rt.strikingTier <= 0 ? 'beh.gen.eyes_close' : 'beh.gen.eyes_close_t1');
      return;
    }

    const span = 1 - pEyes;
    if (span <= 0 || u.uRead >= pEyes + span * pRead) return;
    st.reads.successes += 1;

    // A fresh uniform, conditional on the read: the counter sits in its lower
    // tail and the defence choice takes the whole of it.
    const v = clamp01((u.uRead - pEyes) / Math.max(1e-9, span * pRead));
    const pCounter = counterOnRead(rt);
    if (v < pCounter) {
      st.reads.counters += 1;
      st.counterWindowUntilMs = nowMs + 100;
    }

    // The defence the read buys. Latency is 02's, which is deliberately not
    // tier-scaled (`beh.gen.simple_rt_untiered`); everything tiered lives in
    // the window and in the repertoire.
    const chosen = reactiveDefence(st.behaviour, {
      spec,
      latencyMs: defenceLatencyMs({
        reactionTimeMs: rt.reactionTimeMs,
        tier: rt.strikingTier,
        fatigue: fatigueOf(self),
        rocked: isRocked(self),
        stanceUnfamiliar: familiarityOf(rt, opp.stance) < 0.5,
      }),
      u: v,
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
    const feinting = typeof opp.action === 'string' && opp.action.startsWith('feint.');
    if (!feinting) return;
    const rt = self.runtime;
    const p = feintBiteProbabilityFor({
      baseBiteP: baseFeintBiteP(rt),
      feintQuality: 0.5,
      attackerFeintSkill: 50,
      repeatsInWindow: 0,
      defenderHurt: isRocked(self),
      defenderFatigue: fatigueOf(self),
      defenderVisionBlocked: false,
    });
    if (u.uFeint < p) {
      st.reads.feintBites += 1;
      // On a bite the next read is skipped; the draw is still taken next tick.
      st.counterWindowUntilMs = -Infinity;
    }
  }

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

    const signals = this.signals(st, self, world, cues);
    const triggers = this.triggers(st, self, cues);
    if (!evaluationDue(st.intent.effectiveIqTier, nowS - st.lastEvalS, triggers)) return;
    st.lastEvalS = nowS;

    if (uEval >= pChange(st.intent.effectiveIqTier, rt.def.mental.adaptability)) return;

    const rows = candidateAdjustments(signals, st.intent.effectiveIqTier, st.plan);
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
      losingBehaviourUnchanged: rt.def.style.losingBehaviour === 'unchanged',
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

    if (cues.oppHurt) st.oppHurtUntilMs = world.nowMs + OPP_HURT_BELIEF_MS;
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
        ? standingNodeFor(self.runtime, distanceM)
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
      oppInRecovery: cues.oppInRecovery ? 1 : 0,
      balance: clamp01(self.balance),
      riskAppetite: st.intent.riskAppetite,
      // §2.5.5 P-6 is explicit that `c.pace` counts *landed*, not thrown:
      // "pure pressure without landed strikes does not win rounds". The target
      // is `tendencies.paceSLpM`, which is a landed rate, so a thrown rate on
      // top of it also compared two different units.
      paceRatio: st.ledger.landedPerMin() / paceTarget,
      dwellExceeded: dwellExceeded(st, self, world),
      lookahead: 0,
      intentRangeM: rangeTargetMetres(st.intent.rangeTarget, self.runtime),
      distanceM,
      effectiveIqTier: st.intent.effectiveIqTier,
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
    if (st.counterWindowUntilMs > 0 && isCounterFamily(c.family)) {
      adapt *= COUNTER_ON_READ_MULT;
    }
    // 01 §3: the catalogue's own `w(x) xN` clauses. They ride on `w_adapt` so
    // they sit under the same `ai.utility.clamp` as every other multiplier
    // rather than being a parallel, unbounded channel.
    adapt *= st.tierWeights?.weights.get(c.family) ?? 1;
    return {
      style: st.style[c.family] ?? 1,
      plan: planWeight(st.plan, c.family),
      adapt,
      matchup: this.matchupWeight(self, opp, c.family),
      multi: st.targetChoice.weight,
    };
  }

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
      payload: { macro: st.macro.macro?.id, step: st.macro.step },
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
    const options: Macro[] = availableMacros(rt.strikingTier, cap)
      .filter((m) => m.steps.length > 1 && m.steps[0].id === chosen.id);
    if (options.length === 0) return;
    // The head action is already committed this tick, so the macro starts at
    // its second step next tick.
    const macro = options[0];
    beginMacro(st.macro, macro, tick);
    advanceMacro(st.macro, tick);
  }

  // -------------------------------------------------------------------------
  // §2.3 commit
  // -------------------------------------------------------------------------

  private commit(st: AiState, self: FighterWorldState, c: Candidate, u: Draws): Decision {
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
      payload: { exec, family: c.family },
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

      // SC-1: the fighter's own belief about the cards, sampled once per break.
      const openScoring = world.config.settings.judgingMode === 'open';
      const trueRoundsUp = trueCardOf(world, f);
      st.intent.perceivedScore = {
        roundsUp: scoreBelief({
          trueRoundsUp,
          effectiveIqTier: st.intent.effectiveIqTier,
          openScoring,
          isCorner: false,
          z: normalFromUniform(uScore),
        }),
        sigma: openScoring ? 0 : 1,
        lastRoundEstimate: trueRoundsUp > 0 ? 1 : trueRoundsUp < 0 ? -1 : 0,
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

function isTopRole(position: PositionId): boolean {
  return !position.includes('bottom') && !position.includes('guard');
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
  return f === 'counterWindow' || f === 'parryCross' || f === 'baitCross'
    || f === 'cross' || f === 'overhand' || f === 'check' || f === 'sprawl';
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
 * The true running card, as §06 keeps it. Until the judge module exposes a
 * per-fighter running total the AI may read, the belief is centred on zero and
 * the noise is what the fighter actually acts on — which is the honest state of
 * the coupling rather than a guess dressed up as a card.
 */
function trueCardOf(world: World, f: FighterWorldState): number {
  const judges = world.judges as { runningRoundsUp?: Record<number, number> } | null;
  const row = judges?.runningRoundsUp;
  if (row && typeof row[f.id] === 'number') return row[f.id];
  return 0;
}
