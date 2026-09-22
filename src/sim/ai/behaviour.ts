/**
 * TIER BEHAVIOUR — chapter 01 §3's catalogue compiled into the decision path.
 *
 * Chapter 01 ships ~200 rows of "what a fighter of tier Tn visibly does and
 * cannot do" as data (`fighter/tiers.ts`). Until this module existed nothing in
 * `ai/` ever called `rulesFor`, so tier reached behaviour only through scalar
 * composites — softmax temperature, skill gaps, telegraph. A white belt was a
 * weaker black belt rather than a different fighter.
 *
 * What this file is: the join between the catalogue and the three places a rule
 * can actually bite.
 *
 *   1. **Gates** (`actions.ts`) — what is not in the repertoire is not a
 *      candidate. A T0 has no teep, no elbow, no sprawl, no guard pass and no
 *      counter; those are absences, not small weights, and a weight clamped at
 *      0.25 would still let a white belt shoot a perfect double every thirty
 *      seconds.
 *   2. **Weights** (`policy.weightsFor`) — the `w(x) xN` clauses, folded into
 *      `w_adapt` so they sit under the same `ai.utility.clamp` as every other
 *      multiplier.
 *   3. **Posture and defence** (`policy.commit`, `core/bind.guardOf`) — the
 *      guard a tier holds and the reactive defence a read buys, which is the
 *      half of the tier ladder the resolution path never saw.
 *
 * Everything here is keyed by rule id, and every application is recorded in
 * `fired` so the debug overlay and Phase 8's animation layer can ask "which
 * catalogue rows are driving this fighter right now" and pair them with
 * `animationTagsFor`.
 *
 * Draw discipline: nothing in this file touches an RNG. Selections that need a
 * uniform take one as an argument, and the callers partition uniforms the §2.7
 * schedule already allots rather than adding draws.
 */
import type { DefenceId } from '../core/ids';
import type { FighterRuntime } from '../fighter';
import { animationTagsFor, rulesFor, type TierBehaviourRule } from '../fighter/tiers';
import {
  availableDefences, anticipationLeadMs, defenceWindowMs, rankDefences, READ,
  type DefenceSpec, type GuardId,
} from '../striking/defence';
import type { TechniqueSpec } from '../striking/catalogue';
import type { ActionFamily } from './contracts';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------------------
// The compiled profile
// ---------------------------------------------------------------------------

/** The per-discipline tiers the catalogue keys on, read once. */
export interface BehaviourTiers {
  boxing: number;
  muayThai: number;
  wrestling: number;
  judo: number;
  bjj: number;
  mmaIntegration: number;
  striking: number;
  grappling: number;
  mma: number;
  iq: number;
}

export interface TierBehaviour {
  readonly tiers: BehaviourTiers;
  /** Every catalogue row active for this fighter, for the Model tab. */
  readonly rules: readonly TierBehaviourRule[];
  readonly ruleIds: ReadonlySet<string>;
  /** `animationTagsFor` for the whole active set (08 owns the clips). */
  readonly animationTags: readonly string[];
  /**
   * Families the repertoire does not contain, with the rule that removed them.
   * `actions.ts` drops these before scoring; see §3's "Available: {...}" rows.
   */
  readonly forbidden: ReadonlyMap<ActionFamily, string>;
  /** Technique ids inside an allowed family that the repertoire still excludes. */
  readonly forbiddenTechniques: ReadonlyMap<string, string>;
  /** Always-on family multipliers (`beh.box.lead_hand_use`, ...). */
  readonly staticWeights: ReadonlyMap<ActionFamily, number>;
  readonly staticFired: readonly string[];
}

const CACHE = new WeakMap<FighterRuntime, TierBehaviour>();

function tiersOf(rt: FighterRuntime): BehaviourTiers {
  const t = rt.tiers as Partial<Record<string, number>>;
  return {
    boxing: t.boxing ?? rt.strikingTier,
    muayThai: t.muayThai ?? rt.strikingTier,
    wrestling: t.wrestling ?? rt.grapplingTier,
    judo: t.judo ?? 0,
    bjj: t.bjj ?? rt.grapplingTier,
    mmaIntegration: t.mmaIntegration ?? rt.mmaTier,
    striking: rt.strikingTier,
    grappling: rt.grapplingTier,
    mma: rt.mmaTier,
    iq: rt.iqTier,
  };
}

/**
 * The catalogue rows for this fighter, compiled once per bout. Nothing in
 * `rulesFor` depends on per-tick state, so the result is stable for the whole
 * bout and is cached against the runtime.
 */
export function tierBehaviourFor(rt: FighterRuntime): TierBehaviour {
  const hit = CACHE.get(rt);
  if (hit) return hit;

  const rules = rulesFor(rt);
  const ruleIds = new Set(rules.map((r) => r.id));
  const t = tiersOf(rt);

  const forbidden = new Map<ActionFamily, string>();
  const forbiddenTechniques = new Map<string, string>();
  const staticWeights = new Map<ActionFamily, number>();
  const staticFired: string[] = [];

  const ban = (family: ActionFamily, ruleId: string): void => {
    if (!forbidden.has(family)) forbidden.set(family, ruleId);
  };
  const mult = (family: ActionFamily, m: number, ruleId: string): void => {
    staticWeights.set(family, (staticWeights.get(family) ?? 1) * m);
    if (!staticFired.includes(ruleId)) staticFired.push(ruleId);
  };

  // --- §3.2 boxing repertoire ---------------------------------------------
  // `beh.box.repertoire_t0`: "{1, 2, wild 1-2-3, high guard, back-straight-up};
  // no feints, no counters". The punches themselves are already gated by
  // `spec.minTier`; what the tier table cannot express is the *absence of a
  // counter game*, which is a whole class of candidate.
  if (t.boxing <= 1) {
    ban('parryCross', 'beh.box.repertoire_t0');
    ban('baitCross', 'beh.box.repertoire_t0');
    ban('counterWindow', 'beh.box.repertoire_t0');
    ban('slipEntry', 'beh.box.repertoire_t0');
  }
  // `beh.box.lead_hand_use`: w(jab) x1.2 for T2+, x0.8 for T0-T1.
  mult('jab', t.boxing >= 2 ? 1.2 : 0.8, 'beh.box.lead_hand_use');
  // `beh.box.body_work`: w(body punches) x1.3 (T2+), x0.3 (T0-T1 head-hunt).
  mult('bodyHook', t.boxing >= 2 ? 1.3 : 0.3, 'beh.box.body_work');

  // --- §3.3 Muay Thai / kickboxing repertoire ------------------------------
  // `beh.mt.kick_selection`: T0-T1 rear low/body only, no teep, no switch;
  // T2 adds the teep and the switch kick; T3 the full catalogue.
  if (t.muayThai <= 1) {
    ban('teep', 'beh.mt.kick_selection');
    ban('leadLowKick', 'beh.mt.kick_selection');
    ban('bodyKick', 'beh.mt.kick_selection');
  }
  // `beh.mt.lean_back_t0`: the T0 wind-up leans the torso back — the head kick
  // is not available from there at all.
  if (t.muayThai <= 0) ban('headKick', 'beh.mt.lean_back_t0');
  // `beh.mt.elbow_availability` [2-5]: "T0-T1 have w(elbow) = 0".
  if (t.muayThai <= 1) ban('elbow', 'beh.mt.elbow_availability');
  // `beh.mt.spinning_gate` [4-5]: spinning techniques are available from T4.
  if (t.muayThai <= 3) ban('spinning', 'beh.mt.spinning_gate');
  // `beh.mt.knee_availability` [1-5]: knees from T1.
  if (t.muayThai <= 0) ban('knee', 'beh.mt.knee_availability');

  // --- §3.4 wrestling ------------------------------------------------------
  // `beh.wr.sprawl_late` [0-1]: a fighter who has never drilled it has no
  // sprawl posture to choose — he reacts late or not at all.
  if (t.wrestling <= 0) ban('sprawl', 'beh.wr.sprawl_late');
  // `beh.wr.timing_shots`: "T0-T1 never" shoot reactively off a strike.
  if (t.wrestling <= 1) ban('shootOffStrikes', 'beh.wr.timing_shots');
  // `beh.wr.cage_use`: "T0-T1 never" drive to the fence.
  if (t.wrestling <= 1) ban('cagePin', 'beh.wr.cage_use');
  // `beh.wr.underhook_pummel`: T3+ pummel for underhooks x1.5; T0-T1 headlock x2.
  if (t.wrestling >= 3) mult('clinchEntry', 1.5, 'beh.wr.underhook_pummel');
  else if (t.wrestling <= 1) mult('frontHeadlock', 2, 'beh.wr.underhook_pummel');

  // --- §3.6 BJJ ------------------------------------------------------------
  // `beh.bjj.top_t0` / `beh.bjj.pass_repertoire`: a T0 on top "lies in guard and
  // punches wildly" — passing is not in the repertoire.
  if (t.bjj <= 0) ban('pass', 'beh.bjj.top_t0');
  // `beh.bjj.sweep_repertoire`: "T0 none (bucks)".
  if (t.bjj <= 0) ban('sweep', 'beh.bjj.sweep_repertoire');
  // `beh.bjj.cage_use`: "T0 no" wall walk.
  if (t.bjj <= 0) ban('wallWalk', 'beh.bjj.cage_use');
  // `beh.bjj.knee_on_belly_pressure` [3-5].
  if (t.bjj >= 3) mult('ride', 1.4, 'beh.bjj.knee_on_belly_pressure');

  // --- §3.7 MMA integration ------------------------------------------------
  // `beh.mma.clinch_striking_gate`: w(clinch strikes) x (0.3 + 0.7 x cs/100).
  // The tier is the honest stand-in for the sub-skill at this seam.
  mult('clinchStrike', 0.3 + 0.7 * clamp01(t.mmaIntegration / 5), 'beh.mma.clinch_striking_gate');

  const behaviour: TierBehaviour = {
    tiers: t,
    rules,
    ruleIds,
    animationTags: animationTagsFor(rt),
    forbidden,
    forbiddenTechniques,
    staticWeights,
    staticFired,
  };
  CACHE.set(rt, behaviour);
  return behaviour;
}

// ---------------------------------------------------------------------------
// Technique-level repertoire (the rows a family gate is too coarse for)
// ---------------------------------------------------------------------------

/**
 * `beh.mt.kick_selection` again, at technique granularity: a T0-T1 kicker owns
 * the rear round kick and nothing else, so the two `minTier 0` round kicks
 * survive and the rest of the family does not.
 *
 * Returns the rule id that removes the technique, or null when it is allowed.
 */
export function techniqueBlockedBy(b: TierBehaviour, spec: TechniqueSpec): string | null {
  const kick = spec.family === 'lowKick' || spec.family === 'bodyKick'
    || spec.family === 'headKick' || spec.family === 'teep';
  if (kick && b.tiers.muayThai <= 1
    && spec.id !== 'tech.kick_low_rear' && spec.id !== 'tech.kick_body_rear') {
    return 'beh.mt.kick_selection';
  }
  // `beh.bjj.pass_repertoire`: T1 passes with the knee cut and the stack only.
  return null;
}

// ---------------------------------------------------------------------------
// Per-tick, trigger-gated weights
// ---------------------------------------------------------------------------

/** The engine predicates the catalogue's `trigger` column names. */
export interface BehaviourContext {
  /** `underPressure`: the opponent is closing and own back is toward the cage. */
  underPressure: boolean;
  /** `rushedOrAcuteHeadAbove30` — `beh.gen.panic_flurry`. */
  panic: boolean;
  /** `readSucceeded` this tick. */
  readSucceeded: boolean;
  /** `opponentAdvancing` — `beh.mt.teep_usage`. */
  oppAdvancing: boolean;
  /** `afterAnExchange` — `beh.box.angles`. */
  afterExchange: boolean;
  /** `onBottom` — the get-up ladder. */
  onBottom: boolean;
  /** `opponentWithinHalfMetre` — `beh.gen.t0_grab_push`. */
  withinHalfMetre: boolean;
  /** `fatigue` — `beh.mt.fatigue_kicking`. */
  fatigue: number;
  /** `opponentCircles` — `beh.box.ring_cutting`. */
  oppCircles: boolean;
}

export interface BehaviourWeights {
  /** Multiplier per family; absent means 1. */
  readonly weights: ReadonlyMap<ActionFamily, number>;
  /** Rule ids that produced a multiplier this tick. */
  readonly fired: readonly string[];
}

const KICK_FAMILY: readonly ActionFamily[] =
  ['lowKick', 'leadLowKick', 'bodyKick', 'headKick', 'rearKick', 'teep'];
const SWING_FAMILY: readonly ActionFamily[] =
  ['hook', 'leadHook', 'overhand', 'uppercut', 'spinning'];
const COVER_FAMILY: readonly ActionFamily[] = ['block', 'longGuard', 'check'];

/**
 * The trigger-gated half of the catalogue, evaluated once per fighter per tick.
 * The static half is folded in first so a caller only has to consult one map.
 */
export function behaviourWeights(b: TierBehaviour, ctx: BehaviourContext): BehaviourWeights {
  const weights = new Map<ActionFamily, number>(b.staticWeights);
  const fired = [...b.staticFired];
  const t = b.tiers;

  const mult = (family: ActionFamily, m: number, ruleId: string): void => {
    weights.set(family, (weights.get(family) ?? 1) * m);
    if (!fired.includes(ruleId)) fired.push(ruleId);
  };
  const multAll = (families: readonly ActionFamily[], m: number, ruleId: string): void => {
    for (const f of families) mult(f, m, ruleId);
  };

  // `beh.box.backs_straight_up` [0-1, underPressure]: w(retreat straight) x3,
  // w(circle) x0.3. This is why a novice gets walked onto the fence.
  if (ctx.underPressure && t.boxing <= 1) {
    mult('retreat', 3, 'beh.box.backs_straight_up');
    mult('circle', 0.3, 'beh.box.backs_straight_up');
    mult('circleAway', 0.3, 'beh.box.backs_straight_up');
  }
  // `beh.mma.cage_t4` [iq 4-5, pressured]: rarely on the fence, escapes on angles.
  if (ctx.underPressure && t.iq >= 4) {
    mult('circleAway', 1.6, 'beh.mma.cage_t4');
    mult('pivot', 1.4, 'beh.mma.cage_t4');
  }

  // `beh.box.ring_cutting`: `ringCraft` gates cut-off stepping (T3-T5);
  // T0-T1 chase straight (w(advance straight) x2).
  if (ctx.oppCircles) {
    if (t.boxing <= 1) mult('advance', 2, 'beh.box.ring_cutting');
    else if (t.boxing >= 3) mult('lateral', 1.4, 'beh.box.ring_cutting');
  }

  // `beh.box.angles` [3-5, afterAnExchange]: w(pivot / L-step) x1.5 (T3), x2 (T4+).
  if (ctx.afterExchange && t.boxing >= 3) {
    const m = t.boxing >= 4 ? 2 : 1.5;
    mult('pivot', m, 'beh.box.angles');
    mult('lateral', m, 'beh.box.angles');
  }

  // `beh.gen.panic_flurry` [0-1]: w(wild swing) x3, w(defence) x0.5; costs x2.
  if (ctx.panic && t.striking <= 1) {
    multAll(SWING_FAMILY, 3, 'beh.gen.panic_flurry');
    multAll(COVER_FAMILY, 0.5, 'beh.gen.panic_flurry');
  }

  // `beh.gen.reflex_defensive` [0-1, readSucceeded]: w(cover, step back) x3,
  // w(counter) x0.2. A novice who reads a punch covers; he does not counter.
  if (ctx.readSucceeded && t.striking <= 1) {
    multAll(COVER_FAMILY, 3, 'beh.gen.reflex_defensive');
    mult('retreat', 3, 'beh.gen.reflex_defensive');
    mult('counterWindow', 0.2, 'beh.gen.reflex_defensive');
    mult('parryCross', 0.2, 'beh.gen.reflex_defensive');
  }

  // `beh.mt.teep_usage` [2-5, opponentAdvancing]: w(teep) x (1 + teep/100).
  if (ctx.oppAdvancing && t.muayThai >= 2) {
    mult('teep', 1 + 0.2 * t.muayThai, 'beh.mt.teep_usage');
  }

  // `beh.mt.fatigue_kicking`: T0-T1 x0.2 once f > 0.5 ("stops kicking by R2");
  // T2 by R3; T3 ~80% retained; T4 ~90%; T5 ~95%.
  if (ctx.fatigue > 0.5) {
    const keep = t.muayThai <= 1 ? 0.2 : t.muayThai === 2 ? 0.6
      : t.muayThai === 3 ? 0.8 : t.muayThai === 4 ? 0.9 : 0.95;
    if (keep < 1) multAll(KICK_FAMILY, keep, 'beh.mt.fatigue_kicking');
  }

  // `beh.gen.t0_grab_push` [mma 0, opponentWithinHalfMetre]: w(grab / push /
  // headlock) x3 over strikes. The untrained answer to being close is to hold on.
  if (ctx.withinHalfMetre && t.mma <= 0) {
    mult('clinchEntry', 3, 'beh.gen.t0_grab_push');
    mult('frontHeadlock', 3, 'beh.gen.t0_grab_push');
  }

  // `beh.mma.getup_t1` … `beh.mma.getup_t4`: turtles and covers at T0-T1,
  // wall-walks late at T2, immediately at T3, never settles at T4+.
  if (ctx.onBottom) {
    if (t.mma <= 1) {
      mult('standUp', 0.3, 'beh.mma.getup_t1');
      mult('wallWalk', 0.3, 'beh.mma.getup_t1');
      multAll(COVER_FAMILY, 2, 'beh.mma.getup_t1');
    } else if (t.mma === 2) {
      mult('standUp', 0.8, 'beh.mma.getup_t2');
    } else if (t.mma >= 4) {
      mult('standUp', 2, 'beh.mma.getup_t4');
      mult('wallWalk', 2, 'beh.mma.getup_t4');
    }
    // `beh.bjj.mma_bottom_priority` [mma 2-5]: stand > sweep > submit.
    if (t.mma >= 2) {
      mult('sweep', 1.2, 'beh.bjj.mma_bottom_priority');
      mult('bottomSubmission', 0.7, 'beh.bjj.mma_bottom_priority');
    }
  }

  return { weights, fired };
}

// ---------------------------------------------------------------------------
// §2.4.1 guard posture
// ---------------------------------------------------------------------------

export interface GuardContext {
  fatigue: number;
  rocked: boolean;
  /** `beh.gen.turn_away` fired on this fighter (T0 only). */
  turnedAway: boolean;
  /** 01 `style.guardStyle`, already mapped onto 02's catalogue by the caller. */
  styleGuard: GuardId;
}

/** `beh.gen.hands_drop_tired`: T0-T1 at f > 0.45, T2 at f > 0.6, T3+ at f > 0.75. */
export function handsDropThreshold(tier: number): number {
  if (tier <= 1) return 0.45;
  if (tier === 2) return 0.6;
  return 0.75;
}

export interface GuardChoice {
  guard: GuardId;
  /** Rule ids that decided it, for the overlay. */
  fired: readonly string[];
}

/**
 * Which posture this fighter is actually holding, as opposed to the one their
 * style sheet says they hold.
 *
 * The resolution path read `style.guardStyle` alone, so a white belt covered
 * up exactly as well as a champion and neither one's hands ever came down.
 * Three catalogue rows own this: `beh.box.hands_at_chest` (T0 guard height
 * -40%), `beh.gen.hands_drop_tired` (the tier-keyed fatigue threshold) and the
 * `beh.gen.hurt_*` ladder (T0-T1 cover and turn away when rocked).
 */
export function guardChoice(b: TierBehaviour, ctx: GuardContext): GuardChoice {
  const fired: string[] = [];
  const t = b.tiers;

  // `beh.gen.turn_away` / `beh.gen.hurt_t0` / `beh.gen.hurt_t1`: the novice
  // answer to being hurt is to wrap up and turn, which is the worst posture
  // there is and the reason a T0 gets finished rather than surviving.
  if (ctx.turnedAway) {
    fired.push('beh.gen.turn_away');
    return { guard: 'guard.cover_turtle', fired };
  }
  if (ctx.rocked && t.mma <= 1) {
    fired.push(t.mma <= 0 ? 'beh.gen.hurt_t0' : 'beh.gen.hurt_t1');
    return { guard: 'guard.cover_turtle', fired };
  }

  // `beh.box.hands_at_chest` [box 0]: hands at chest height, chin up.
  if (t.boxing <= 0) {
    fired.push('beh.box.hands_at_chest');
    return { guard: 'guard.low_hands', fired };
  }

  // `beh.gen.hands_drop_tired`: the guard comes down, and it comes down far
  // earlier for a novice than for a champion.
  if (ctx.fatigue > handsDropThreshold(t.striking)) {
    fired.push('beh.gen.hands_drop_tired');
    return { guard: 'guard.low_hands', fired };
  }

  return { guard: ctx.styleGuard, fired };
}

// ---------------------------------------------------------------------------
// §2.4.2 / §2.4.3 reactive defence
// ---------------------------------------------------------------------------

export interface ReactiveDefenceInput {
  /** The technique the defender believes is coming. */
  spec: TechniqueSpec;
  /** 01 `reactionTimeMs` plus state — never tier-scaled (`beh.gen.simple_rt_untiered`). */
  latencyMs: number;
  /** Uniform in [0,1), already conditioned on the read having succeeded. */
  u: number;
  /** Ids unavailable right now (fence, guard requirement, plan). */
  unavailable?: readonly DefenceId[];
}

export interface ReactiveDefence {
  defence: DefenceId | null;
  fired: readonly string[];
}

/** Nothing fits, or the tier has no reactive defence at all. */
const NO_DEFENCE: ReactiveDefence = { defence: null, fired: [] };

/**
 * The defence a successful read buys (`beh.gen.read`: "Read → reactive defence
 * / counter allowed; no read → positional defence only").
 *
 * The whole of chapter 02's defence layer — `availableDefences`,
 * `defenceWindowMs`, `rankDefences` — existed and was never called: every
 * candidate carried `def.neutral`, which is not in the catalogue, so
 * `resolvedDefenceOf` returned null on every strike in every bout and the only
 * defence in the engine was the passive guard roll. That is why skill converted
 * almost entirely into offence.
 *
 * The tier ladder is 01's, not invented here:
 *   T0   `beh.box.repertoire_t0` lists no defence but the high guard, and the
 *        catalogue's own reflex for "no read, no choice" is `def.flinch`.
 *   T1   `beh.box.high_guard_only`: the block, 90% of the time.
 *   T2   `beh.box.repertoire_t2` adds parry / catch / slip / roll.
 *   T3+  the pull, the step-off, the shoulder roll — whatever ranks best.
 *   T2+  `beh.gen.cue_lead` is the only tier term in the *timing*: below T2 a
 *        fighter gets no cue-pickup lead, so the window is shorter and fewer
 *        defences fit it.
 */
export function reactiveDefence(b: TierBehaviour, x: ReactiveDefenceInput): ReactiveDefence {
  const tier = b.tiers.striking;
  // `beh.gen.cue_lead` [2-5]: the lead on a telegraphed attack is a *trained*
  // read of the wind-up. A novice has none, so his window is the raw one.
  const leadMs = tier >= 2 ? anticipationLeadMs(x.spec.telegraph) : 0;
  const windowMs = defenceWindowMs(x.spec, x.latencyMs, leadMs);
  if (windowMs <= 0) return NO_DEFENCE;

  const options = availableDefences({
    spec: x.spec, windowMs, tier, unavailable: x.unavailable,
  });
  if (options.length === 0) return NO_DEFENCE;

  // `beh.box.high_guard_only` / 02 §2.4.3: "T0-T1 pick the block 80 % of the
  // time regardless — a beginner's automatic response is defence-shaped".
  if (tier <= 1) {
    const block = options.find((d) => d.id === 'def.block_high')
      ?? options.find((d) => d.id === 'def.flinch');
    if (block && x.u < READ.noviceDefaultBlockP) {
      return { defence: block.id, fired: ['beh.box.high_guard_only'] };
    }
    // The remaining 20% is the novice trying something he has not drilled:
    // `beh.box.high_guard_only` puts P(wrong direction) at 0.30, and a defence
    // that does not cover the incoming class is exactly what "wrong" means.
    const other = options[Math.min(options.length - 1, Math.floor(x.u * options.length))];
    return { defence: other.id, fired: ['beh.box.high_guard_only'] };
  }

  const ranked = rankDefences(options, x.spec);
  // T2 slips to one side only and holds one answer per line
  // (`beh.box.one_direction_slip`); T3+ pick from the top of the ranking.
  const depth = tier >= 4 ? Math.min(3, ranked.length)
    : tier === 3 ? Math.min(2, ranked.length) : 1;
  const pick: DefenceSpec = ranked[Math.min(depth - 1, Math.floor(x.u * depth))];
  const ruleId = tier >= 4 ? 'beh.box.repertoire_t4'
    : tier === 3 ? 'beh.box.repertoire_t3' : 'beh.box.repertoire_t2';
  return { defence: pick.id, fired: [ruleId] };
}

/**
 * `beh.gen.eyes_close` (T0, P = 0.70) and `beh.gen.eyes_close_t1` (T1, P = 0.30):
 * "readP = 0 for the exchange". The flinch that comes with closed eyes is not a
 * defence; it is the absence of one.
 */
export const EYES_CLOSE_P_BY_TIER: readonly number[] = [0.70, 0.30, 0, 0, 0, 0];

export function eyesCloseP(b: TierBehaviour): number {
  return EYES_CLOSE_P_BY_TIER[Math.max(0, Math.min(5, Math.round(b.tiers.striking)))] ?? 0;
}

/**
 * `beh.gen.turn_away` [T0, hitCleanOrThreeInTwoSeconds]: P = 0.50 that the
 * fighter turns his side or back; absorb 0 for the follow-ups.
 */
export const TURN_AWAY_P = 0.50;

export function turnAwayP(b: TierBehaviour): number {
  return b.tiers.striking <= 0 ? TURN_AWAY_P : 0;
}
