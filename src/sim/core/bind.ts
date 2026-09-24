/**
 * MODULE BINDING — the wiring between `BoutLoop` and the six design chapters.
 *
 * `loop.ts` owns the phase order and knows nothing about techniques, positions,
 * pools or officials. This file is the adapter that turns each phase into calls
 * on chapters 01–06, in the draw order docs/design/09 §2.7 fixes:
 *
 *   P2 upkeep          05 `DamageState.upkeep` / `EnergyState.upkeep`, engagement
 *                      timers and control counters — no draws, by contract
 *   P3 commitDecision  02/03/04 timings + 05 cost table + `Scheduler.commit`
 *   P4 resolveContact  02 `resolveStrike`, 03 `resolveEdge`, 04 `resolveWindow`,
 *                      then 05 `applyImpact`; events per the §1.4 mapping table
 *   P0 breakRecovery   05 `DamageState.roundBreak`
 *   P6 referee         06 `Referee.tick` from 05 `RefObservables`
 *   P7 judges          06 ledger accumulation, `scoreRound` at the bell
 *
 * Draw discipline: this file never takes a draw of its own. Every draw belongs
 * to a module call whose count is fixed (6 + 10 per strike, 4 per edge, 4 per
 * submission window, 3 per judge per round). A precondition that fails at
 * contact time skips the module call entirely, so the branch — and with it the
 * draw count — stays a pure function of state, which §2.6 explicitly allows.
 */
import type { FighterWorldState, World } from './world';
import type { FighterRuntime } from '../fighter';
import type { Decision, DecisionPolicy } from './policy';

import { MmaPolicy, familyForTechnique, guardChoice, tierBehaviourFor } from '../ai';
import type { LoopModules } from './loop';
import type { ContactKind, ScheduledContact } from './scheduler';
import type { PositionId, SubmissionId, TechniqueId } from './ids';
import { refereeRuntime, judgeRuntime, matchClock } from './build';
import { clampToArena } from '../rules/arenas/types';

import {
  BAND_ORDER, DRAWS_PER_STRIKE, arrivalLogit, bandFor, bandReachable, baseDefenceSuccess, defence, guard,
  guardLogit, hasDefence, hasTechnique, passiveBlockP, reachProfile, resolveStrike, skillGapK,
  strikeClasses, technique, TECHNIQUES, GROUND_TECHNIQUES, totalMs as techniqueTotalMs,
  type ForceContext, type GuardId, type GuardSpec, type ImpactPosture, type RangeBand,
  type ResolvedDefence,
  type CommitMode, type StrikeResolveInput, type TargetRegion, type TechniqueSpec,
} from '../striking';
import {
  GRAPPLE_EDGE_DRAWS, hasGrapplingEdge, grapplingEdge, isGroundedNode, isReversal,
  isMatNode, isTakedownAttempt, isTakedownLanding, kindForNode, nodeAllowsSubmission, positionNode, hasPositionNode,
  gnpProfile,
  resolveEdge, roleFor,
  type EdgeOutcome, type GrappleActor, type GrappleWorld, type GrapplingEdge, type Kuzushi,
} from '../grappling';
import {
  STAGE_PARAMS, baselineEnvironment, baselineFighter, hasSubmission, resolveWindow, submission,
  type StageIndex, type SubFighter, type SubmissionSpec, type WindowContext,
} from '../submissions';
import {
  S, type RefObservables as DamageObservables, type TechClass,
} from '../damage';
import {
  decideSubOnly, effectiveScore, mmaWeights, streetTick, type FoulId, type FoulOccurrence,
  emptyLedger, isGrounded, isLegal, scoreRound, decide, STANDING_CONTACT,
  type RefEngagementInput, type RefFighterInput, type RoundLedger,
} from '../rules';
import type { DamageEvent, GrappleEvent, SimEvent, StrikeEvent } from '../record/events';
import { FEINT, feint as feintSpecOf, type FeintId } from '../striking/combos';
import {
  biteBonus, feintBiteP, feintRepeats, noteDefence, noteFeint, notePrevStrike, openExposure,
  strikingCraft, tacticalTerms,
} from '../striking/tactics';
import { bandLimits } from '../striking/range';
import { FOOTWORK, stepMs } from '../ai/footwork';
import { isSignificantStrike, isStatLanded } from '../record/stats';

// ---------------------------------------------------------------------------
// Payloads the scheduler carries between P3 and P4
// ---------------------------------------------------------------------------

interface StrikePayload {
  kind: 'strike';
  technique: TechniqueId;
  region: TargetRegion;
  posture: ImpactPosture;
  /** Node the attacker was in at commit; P4 re-checks it (09 §2.3 rule 3). */
  node: PositionId | null;
  /** A short clinch/ground strike (non-significant, 09 §4.1). */
  short?: boolean;
  /** Realism pass (QA2 #6): significance and position when thrown. */
  sig: boolean;
  pos: 'distance' | 'clinch' | 'ground';
}

/**
 * The short strike [E: Phase 9]: an arm-only punch or a knee to the thigh in
 * the clinch, a short punch on the ground. UFCStats' non-significant strikes
 * land at about 83 % (FIGHT_DATA §3 #5-#7: total 5.4 landed / 10.2 thrown vs
 * significant 3.9 / 8.4 a minute) and carry little force.
 */
export const SHORT_STRIKE_MODEL = Object.freeze({
  /** Logit added to arrival: nobody slips a short punch from inside a tie. */
  arrivalLogit: 1.4,
  /** Delivered force multiplier (passed as 02's `rangeFitMult`). */
  forceMult: 0.30,
  /** Startup / active / recovery multiplier. */
  timeMult: 0.70,
});

interface GrapplePayload {
  kind: 'grapple';
  edge: string;
  engagementId: number | null;
  node: PositionId | null;
  stage: 'single' | 'capture' | 'finish';
}

interface SubmissionPayload {
  kind: 'submission';
  technique: SubmissionId;
  stage: 'entry' | 'secure' | 'finish';
  node: PositionId | null;
}

type Payload = StrikePayload | GrapplePayload | SubmissionPayload;

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

const GRAPPLE_EVENT_KINDS: ReadonlySet<string> = new Set([
  'takedown', 'clinch', 'clinchBreak', 'positionChange', 'scramble', 'reversal',
  'standUp', 'engagementJoin', 'disengage',
]);
function isGrappleEventKind(kind: string): boolean {
  return GRAPPLE_EVENT_KINDS.has(kind);
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

function emit(w: World, e: SimEvent): void {
  w.emit(e);
}

/** `subMs` for an event raised outside P4 (upkeep, referee, judges) is 0. */
function base(w: World, kind: SimEvent['kind'], actor: number, target: number, text: string, subMs = 0) {
  return { tick: w.tick, subMs, round: w.round, kind, actor, target, text };
}

/** 05's posture enum for a fighter, from 03's engagement state. */
export function postureOf(w: World, f: FighterWorldState): ImpactPosture {
  const e = w.engagements.of(f.id);
  if (!e) return 'distance';
  if (e.kind === 'clinch') {
    return e.cage && w.engagements.slotOf(f.id) === 'b' ? 'wallPinned' : 'clinch';
  }
  if (e.kind === 'ground' || e.kind === 'knockdown' || e.kind === 'scramble') {
    return w.engagements.roleOf(f.id) === 'bottom' ? 'groundBottom' : 'groundTop';
  }
  return 'clinch';
}

/** The free standing node a disengaged fighter occupies, from geometry alone. */
function freeNodeFor(w: World, f: FighterWorldState): PositionId {
  const opp = w.nearestOpponent(f);
  const d = opp ? w.distance(f, opp) : 3;
  // Phase 9: a knocked-down opponent within a step or two is the §03
  // `pos.ground_knockdown` trigger node, the only node `tech.knockdown_follow`
  // leaves from. Nothing ever put a fighter there, so the follow-up edge was
  // unreachable and a knockdown could only be followed by standing punches at
  // a man on the floor — 19 of 20 flash knockdowns went unpunished.
  if (opp && opp.posture === 'down' && !w.engagements.of(opp.id)
    && w.ruleset.ground.strikesAllowed && d <= KNOCKDOWN_FOLLOW_RANGE_M) {
    return 'pos.ground_knockdown';
  }
  // Phase 9: the same band ladder the AI enumerates from (07 `standingNodeFor`,
  // 02 §2.1.1 bands on the fighter's own reach). The fixed 1.3 / 2.0 m cut-offs
  // this used disagreed with it across most of the mid band, and
  // `commitGrapple` silently drops an edge whose `from` does not list the
  // fighter's current node — so shots the AI chose at mid range vanished.
  const band = bandFor(d, reachProfile(f.runtime.effectiveReachM, f.runtime.effectiveKickReachM));
  if (band === 'clinch' || band === 'close') return 'pos.standing_close';
  if (band === 'mid') return 'pos.standing_mid';
  return 'pos.standing_long';
}

/**
 * 05 §2.5.1 action class for a grappling edge [E: Phase 9]. Every edge used to
 * be charged as a takedown attempt (10 PCr, 0.8 mmol/L) — a pummel, a grip
 * exchange, a posture-up, a hip escape — so a minute of grappling cost more
 * than a round of striking and fighters were at fatigue 0.7-0.8 by round 2
 * (FIGHT_DATA #128: real output falls only ~8 % from R1 to R3). A shot, a
 * throw or the finish of one is still a takedown attempt; the rest pay the
 * §2.5.1 class that describes them.
 */
export function edgeEnergy(edge: GrapplingEdge, from: PositionId): { cls: TechClass; scale: number } {
  if (isTakedownAttempt(edge.id, from) || edge.kind === 'capture' || edge.kind === 'throw'
    || edge.kind === 'counter' || edge.kind === 'finish' || edge.kind === 'chain') {
    return { cls: 'takedownAttempt', scale: 1 };
  }
  switch (edge.kind) {
    case 'setup': return { cls: 'feint', scale: 1 };
    case 'defence': return { cls: 'sprawl', scale: 1 };
    case 'getup': return { cls: 'wallWalk', scale: 1 };
    case 'gnp': return { cls: 'groundTopPassAttempt', scale: 0.25 };
    case 'pass': case 'advance': case 'sweep': case 'escape': case 'scramble':
      return { cls: 'groundTopPassAttempt', scale: 1 };
    case 'subEntry': return { cls: 'submissionSqueeze', scale: 0.3 };
    default: return { cls: 'groundTopPassAttempt', scale: 0.75 };
  }
}

/** Unseen-strike share by exposure [E: tuned Phase 9] — see `unseenByUnfamiliarity`. */
export const UNFAMILIAR = Object.freeze({ p0: 0.45, floor: 0.06, tau: 35, tierSlope: 0.50 });

/**
 * Defence-success multiplier by striking posture [E: tuned Phase 9 to
 * FIGHT_DATA §3 #16/#18/#19]: the stand-up block and parry rates do not carry
 * to a tie-up or a pin — a man tied up or flat on his back cannot shell up
 * behind a guard the way he can at distance. With the arrival term alone,
 * clinch and ground accuracy sat at ~60 % (target 72 %); the losses were
 * blocks, which arrival does not touch.
 */
export const POSITIONAL_DEFENCE = Object.freeze({ clinch: 0.5, groundTop: 0.7 });

function positionalDefenceMult(posture: ImpactPosture): number {
  if (posture === 'clinch' || posture === 'wallPinned') return POSITIONAL_DEFENCE.clinch;
  if (posture === 'groundTop') return POSITIONAL_DEFENCE.groundTop;
  return 1;
}

function scaledDefence(d: ResolvedDefence | null, mult: number): ResolvedDefence | null {
  return d === null || mult === 1 ? d : { ...d, successP: d.successP * mult };
}

/** A logit shift on a reactive defence's success (a missed kick costs the kicker his defence, §2.5.1). */
function shiftedDefence(d: ResolvedDefence | null, logit: number): ResolvedDefence | null {
  if (d === null || logit === 0) return d;
  const p = Math.min(0.999, Math.max(0.001, d.successP));
  const l = Math.log(p / (1 - p)) + logit;
  return { ...d, successP: 1 / (1 + Math.exp(-l)) };
}

/** Passive-block multiplier while the defender is reacting to a feint [E: Realism pass]. */
export const FEINT_BITE_GUARD_MULT = 0.5;

/**
 * Realism pass [D]: gain on the striking skill-gap terms (02 §2.6.2 arrival
 * k 2.0/100, §2.4.2 defence k). Measured with clones one skill domain apart
 * (plan skill_domains), +10 points on every sub-skill won only 60 % of bouts
 * where FIGHT_DATA §2.4 odds calibration (88-93 % at >= 2.5 rating SD, the
 * gap +10 is in the UFC population) asks for far more; LIT_B §1.9-§1.11 put
 * experts' anticipation and accuracy advantages at SMD 1.0-1.2.
 */
export const STRIKING_SKILL_GAIN = 1.6;

/**
 * Realism pass [E]: a single arrival offset that returns pooled distance
 * accuracy to FIGHT_DATA §3 #3/#16 once the tactical terms (range fit
 * penalties, counter/chain/feint bonuses) are live. The terms move accuracy
 * *between* fighters; this keeps the population mean where the data put it.
 */
export const TACTICAL_ARRIVAL_OFFSET = 0.2;

/**
 * Realism pass [E: FIGHT_DATA §5 rule of thumb 1]: defence has a level as well
 * as a gap. "Equal-skill lower tiers should land slightly *more*" — two
 * regional fighters of equal skill hit each other more cleanly than two UFC
 * fighters, which the gap-only arrival term could not express (regional
 * finish rates ran 40 % against 69 %). Zero at the UFC reference level.
 */
export const ABSOLUTE_DEFENCE = Object.freeze({ k: 1.5, ref: 70 });

/** §2.8's weight-class scale of the reach term (LIT_B §2.4: reach only bites at heavyweight). */
function reachClassScale(wc: string): 'light' | 'middle' | 'heavy' {
  if (wc === 'wc.light_heavyweight' || wc === 'wc.heavyweight' || wc === 'wc.super_heavyweight'
    || wc === 'wc.cruiserweight') return 'heavy';
  if (wc === 'wc.welterweight' || wc === 'wc.middleweight' || wc === 'wc.super_middleweight') return 'middle';
  return 'light';
}

/** Arrival logit by striking posture [E: tuned Phase 9] — see `positionalArrivalLogit`. */
export const POSITIONAL_ARRIVAL = Object.freeze({ clinch: 1.6, groundTop: 1.6, groundBottom: 0.3 });

/**
 * Arrival logit by target region [E: tuned Phase 9 to FIGHT_DATA §3 #15/#17]:
 * a body or leg strike lands far more often than a head strike (sig
 * accuracy head 38 %, body 70 %, legs 81 %) — the head is the target a
 * fighter's whole defence is built around, and the legs and body are big,
 * slow targets he mostly accepts being hit on. The §02 per-technique rows
 * carry part of this; in the bout the difference was a third of the real one.
 */
export const TARGET_ARRIVAL: Readonly<Partial<Record<TargetRegion, number>>> = Object.freeze({
  head: -0.7, body: 2.2, leadLeg: 0.7, rearLeg: 0.7,
});

/**
 * Realism pass [E: tuned to FIGHT_DATA §3 #18-#19]: position x target on top
 * of the two tables above. In a tie-up the head is the part a fighter still
 * defends (clinch head 58 %), the body and the thighs are not (86 / 91 %);
 * underneath, a man framing against a top player covers his head and leaves
 * the body (ground body 94 %).
 */
export const POSITION_TARGET_ARRIVAL: Readonly<Record<string, Partial<Record<TargetRegion, number>>>> = Object.freeze({
  distance: {},
  clinch: { head: -0.45, leadLeg: 0.6, rearLeg: 0.6 },
  ground: { body: 1.4, leadLeg: 0.8, rearLeg: 0.8 },
});

/**
 * Phase 9: the shooter's side of a takedown chain — the attempt itself (from
 * the feet or the clinch) and the finish / chain / cage edges he runs from
 * inside a shot (`attack` family, slot `a`). `grap.tdChainLogit` applies here.
 */
function tdChainEdge(edge: GrapplingEdge, from: PositionId, slot: 'a' | 'b' | null): boolean {
  if (isTakedownAttempt(edge.id, from)) return true;
  if (slot === 'b' || !hasPositionNode(from) || positionNode(from).family !== 'attack') return false;
  return edge.actor !== 'b' && (edge.kind === 'finish' || edge.kind === 'chain' || edge.kind === 'cage')
    && edge.to.some((d) => d.node !== 'same' && isMatNode(d.node));
}

/**
 * Phase 9: the bottom man's way back to his feet — an edge he starts from
 * underneath on the mat that ends standing or in the clinch. `grap.getUpLogit`
 * applies here.
 */
function getUpEdge(edge: GrapplingEdge, from: PositionId, slot: 'a' | 'b' | null): boolean {
  if (slot !== 'b' || edge.actor !== 'b' || !isMatNode(from)) return false;
  return edge.to.some((d) => d.node !== 'same' && hasPositionNode(d.node)
    && (positionNode(d.node).family === 'standingFree' || positionNode(d.node).family === 'clinch'));
}

/** How close a fighter must be to a downed opponent to follow him down [E: Phase 9]. */
export const KNOCKDOWN_FOLLOW_RANGE_M = 2.4;

/** 03 §5.1 damage fraction for a top node with no GnP row [E]. */
export const GNP_DEFAULT_DMG = 0.6;

/** Node families whose bottom slot defends by being there (guards, turtle). */
const GUARD_DEFENCE_FAMILIES: ReadonlySet<string> = new Set(['closedGuard', 'openGuard']);

/** Above this fatigue index a guard player stops counting as defending [E]. */
export const GUARD_DEFENCE_MAX_FATIGUE = 0.8;

/** 05 §2.5.1 action class for a standing technique. */
export function techClassFor(spec: TechniqueSpec, posture: ImpactPosture): TechClass {
  if (posture === 'groundTop' || posture === 'groundBottom') return 'gnpStrike';
  const b = spec.commitment.balance;
  if (b <= 8) return 'lightStrike';
  if (b <= 22) return 'powerStrike';
  return 'heavyStrike';
}

/**
 * 09 §4.1: every strike landed at distance is significant; in clinch and on the
 * ground only power strikes are (non-jab punches, kicks, knees, elbows).
 */
/** The stats' three-way position from 05's posture enum. */
export function statPosition(posture: ImpactPosture): 'distance' | 'clinch' | 'ground' {
  return posture === 'distance' ? 'distance'
    : posture === 'clinch' || posture === 'wallPinned' ? 'clinch' : 'ground';
}

export function isSignificant(spec: TechniqueSpec, posture: ImpactPosture, short = false): boolean {
  const position = posture === 'distance' ? 'distance'
    : posture === 'clinch' || posture === 'wallPinned' ? 'clinch' : 'ground';
  return isSignificantStrike(spec.id, position, short);
}

/** 06's weapon vocabulary from 02's. */
function rulesWeapon(spec: TechniqueSpec): 'punch' | 'kick' | 'knee' | 'elbow' | 'spinning_backfist' {
  if (spec.weapon === 'knee') return 'knee';
  if (spec.weapon === 'elbow' || spec.weapon === 'elbow_point') return 'elbow';
  if (spec.weapon === 'backfist') return 'spinning_backfist';
  if (spec.family === 'teep' || spec.family === 'lowKick' || spec.family === 'bodyKick'
    || spec.family === 'headKick' || spec.weapon === 'shin' || spec.weapon === 'instep'
    || spec.weapon === 'heel' || spec.weapon === 'ball_of_foot') return 'kick';
  return 'punch';
}

function rulesTarget(region: TargetRegion, defenderGrounded: boolean): 'head' | 'body' | 'leg' | 'downed_head' {
  if (region === 'head') return defenderGrounded ? 'downed_head' : 'head';
  if (region === 'body') return 'body';
  return 'leg';
}

function rulesPhase(posture: ImpactPosture): 'standing' | 'clinch' | 'ground_top' | 'ground_bottom' {
  if (posture === 'clinch' || posture === 'wallPinned') return 'clinch';
  if (posture === 'groundTop') return 'ground_top';
  if (posture === 'groundBottom') return 'ground_bottom';
  return 'standing';
}

function reachOf(f: FighterWorldState) {
  return reachProfile(f.runtime.effectiveReachM, f.runtime.effectiveKickReachM);
}

/** 01's `style.guardStyle` mapped onto 02's guard catalogue. */
function styleGuardOf(f: FighterWorldState): GuardId {
  switch (f.runtime.def.style.guardStyle) {
    case 'highGuard': return 'guard.high';
    case 'philly': return 'guard.philly';
    case 'longGuard': return 'guard.long';
    case 'peekaboo': return 'guard.peekaboo';
    case 'thai': return 'guard.long';
    default: return 'guard.standard';
  }
}

/**
 * The posture actually held, not the one on the style sheet.
 *
 * 02 §2.4.1's matrix is the largest single defensive term in the arrival
 * logit, and it was keyed on `style.guardStyle` alone: a white belt covered
 * exactly as well as a champion and nobody's hands ever came down. 01 §3 has
 * three rows that own this — `beh.box.hands_at_chest` (T0 guard height -40 %),
 * `beh.gen.hands_drop_tired` (the fatigue threshold is tier-keyed: f > 0.45 at
 * T0-T1 against f > 0.75 at T3+) and the `beh.gen.hurt_*` ladder — and this is
 * where they land.
 */
function guardOf(f: FighterWorldState, nowMs: number): GuardSpec {
  const choice = guardChoice(tierBehaviourFor(f.runtime), {
    fatigue: f.energy.f,
    rocked: f.damage.has(S.rocked),
    turnedAway: nowMs < f.tells.backTurnedUntilMs,
    styleGuard: styleGuardOf(f),
  });
  return guard(choice.guard);
}

/**
 * The reactive defence the defender committed to in P3, if it is one this
 * technique can be beaten by. Chapter 07 chooses it; this only resolves the
 * success probability, with the §2.6.1 skill-gap term applied.
 */
function resolvedDefenceOf(
  target: FighterWorldState, spec: TechniqueSpec, attackerSkill: number, defenderSkill: number,
): ResolvedDefence | null {
  const id = target.defence;
  if (!hasDefence(id)) return null;
  const d = defence(id);
  const classes = strikeClasses(spec);
  if (!d.vs.some((c) => classes.includes(c))) return null;
  const base = baseDefenceSuccess(d, spec);
  const p = 1 / (1 + Math.exp(-(
    Math.log(Math.max(1e-9, base) / Math.max(1e-9, 1 - base))
    + (STRIKING_SKILL_GAIN * d.k * (defenderSkill - attackerSkill)) / 100
  )));
  void skillGapK;
  return { spec: d, successP: Math.min(0.97, Math.max(0.03, p)) };
}

/**
 * 05 hands the referee lateralised cut sites (`brow_L`); 06's local copy of the
 * same contract uses the unsided names. The records are otherwise field for
 * field identical, so this is the whole adapter between them.
 */
function refCues(obs: DamageObservables): RefFighterInput['obs'] {
  return {
    ...obs,
    cuts: obs.cuts.map((c) => ({
      site: (c.site === 'nose_bridge' ? 'nose' : c.site.replace(/_[LR]$/, '')) as
        RefFighterInput['obs']['cuts'][number]['site'],
      severity: c.severity,
      bleedIntoEye: c.bleedIntoEye,
    })),
  };
}

/** True when `d` sits in a home band of the technique, or one band out (§2.1.1). */
/** Contact-time range re-check (09 §2.3 rule 3); the same predicate the AI selects with. */
function inRange(spec: TechniqueSpec, band: RangeBand): boolean {
  return bandReachable(spec, band);
}

// ---------------------------------------------------------------------------
// Module views of a fighter (03 / 04 read narrow interfaces, not the world)
// ---------------------------------------------------------------------------

/**
 * 03 §2.1.3's binding alias map, resolved from chapter 01's effective
 * sub-skills (after transfer, background offsets, priors and rust). Where the
 * table says `max(...)` [E] it is a max; sambo resolves through §01's transfer
 * factors, so it is read directly here only where 03 names it.
 */
const ALIAS_CACHE = new WeakMap<FighterRuntime, Record<string, number>>();
export function grapplingAliases(r: FighterRuntime): Record<string, number> {
  const hit = ALIAS_CACHE.get(r);
  if (hit) return hit;
  const S = (d: keyof FighterRuntime['disciplines'], k: string): number => r.disciplines[d]?.effective[k] ?? 0;
  // Realism pass: the MMA floor. Every professional MMA fighter drills
  // takedown defence, getting up and not getting submitted, whatever his base
  // art (MMA_INTEGRATION §1, §7: "wrestling for MMA" is its own curriculum);
  // 01 files that under `mmaIntegration`, which the alias map did not read
  // for the defensive aliases. Without the floor a kickboxer with no wrestling
  // block sprawled at 7 against shots at 75.
  const mmaDef = Math.max(S('mmaIntegration', 'transitions'), S('mmaIntegration', 'cageWork'),
    S('mmaIntegration', 'levelChanges'));
  const mmaGround = Math.max(S('mmaIntegration', 'getUps'), S('mmaIntegration', 'subDefenceUnderStrikes'));
  const out: Record<string, number> = {
    'wr.shot': Math.max(S('wrestling', 'shots'), S('sambo', 'takedowns'), 0.8 * S('mmaIntegration', 'levelChanges')),
    'wr.finish': S('wrestling', 'finishes'),
    'wr.sprawl': Math.max(S('wrestling', 'takedownDefence'), 0.85 * mmaDef, 0.7 * S('judo', 'gripFighting')),
    'wr.pummel': S('wrestling', 'clinch'),
    'wr.mat_return': S('wrestling', 'matReturns'),
    'wr.ride': S('wrestling', 'topControl'),
    'wr.scramble': Math.max(S('wrestling', 'scrambles'), 0.7 * mmaGround),
    'wr.get_up': Math.max(S('wrestling', 'getUps'), S('mmaIntegration', 'getUps')),
    'wr.chain': S('wrestling', 'chains'),
    'jd.grip': Math.max(S('judo', 'gripFighting'), S('judo', 'kuzushi'), S('sambo', 'gripFighting')),
    'jd.throw_fwd': Math.max(S('judo', 'throws'), S('sambo', 'throws')),
    'jd.throw_rear': Math.max(S('judo', 'throws'), S('sambo', 'throws')),
    'jd.foot_sweep': S('judo', 'footSweeps'),
    'jd.counter': S('judo', 'counters'),
    'jd.throw_def': Math.max(S('judo', 'gripFighting'), S('wrestling', 'takedownDefence'), 0.8 * mmaDef),
    'bjj.pass': S('bjj', 'passing'),
    'bjj.retention': Math.max(S('bjj', 'guard'), 0.75 * mmaGround),
    'bjj.sweep': S('bjj', 'sweeps'),
    'bjj.escape': Math.max(S('bjj', 'escapes'), 0.75 * mmaGround, 0.7 * S('wrestling', 'getUps')),
    'bjj.top_control': Math.max(S('bjj', 'topControl'), S('wrestling', 'topControl'), S('sambo', 'topControl')),
    'bjj.back_control': S('bjj', 'backControl'),
    'bjj.leg_entangle': Math.max(S('bjj', 'legLocks'), S('sambo', 'legLocks')),
    'mma.level_change': S('mmaIntegration', 'levelChanges'),
    'mma.anti_wrestling': Math.max(S('wrestling', 'takedownDefence'), S('mmaIntegration', 'transitions')),
    'mma.cage': Math.max(S('mmaIntegration', 'cageWork'), S('wrestling', 'cageWrestling')),
    'mma.gnp': S('mmaIntegration', 'groundAndPound'),
    'mma.clinch_strike': Math.max(S('mmaIntegration', 'clinchStriking'), S('muayThai', 'clinch')),
  };
  // Realism pass: grip strength holds ties, pins and submissions; balance keeps
  // the feet under a man being shot on or thrown. The creator exposed both and
  // nothing in the grappling layer read either. +/-0.12 alias points per
  // attribute point from 50 [E; WRESTLING §8, JUDO §8 grip dominance].
  const grip = 0.12 * ((r.effective.gripStrength ?? 50) - 50);
  const bal = 0.12 * ((r.effective.balance ?? 50) - 50);
  out['wr.pummel'] += grip;
  out['bjj.top_control'] += grip;
  out['bjj.back_control'] += grip;
  out['jd.grip'] += grip;
  out['wr.sprawl'] += bal;
  out['jd.throw_def'] += bal;
  out['mma.anti_wrestling'] += bal;
  ALIAS_CACHE.set(r, out);
  return out;
}

/** 02 §2.6.3 `attackerPrecision`: the technique's power/placement sub-skill. */
function precisionOf(r: FighterRuntime, spec: TechniqueSpec): number {
  const S = (d: keyof FighterRuntime['disciplines'], k: string): number => r.disciplines[d]?.effective[k] ?? 0;
  if (spec.weapon === 'fist' || spec.weapon === 'backfist' || spec.weapon === 'hammerfist') {
    return Math.max(S('boxing', 'power'), S('kickboxing', 'punches'), S('muayThai', 'hands'), 0.8 * r.strikingMean);
  }
  if (spec.weapon === 'elbow' || spec.weapon === 'elbow_point') return Math.max(S('muayThai', 'elbows'), 0.8 * r.strikingMean);
  if (spec.weapon === 'knee') return Math.max(S('muayThai', 'knees'), 0.8 * r.strikingMean);
  return Math.max(S('muayThai', 'kicks'), S('kickboxing', 'kicks'), S('karate', 'kicks'), S('taekwondo', 'kicks'),
    0.8 * r.strikingMean);
}

/** `target`'s speed toward `toward`, m/s, >= 0. */
function closingSpeed(target: FighterWorldState, toward: FighterWorldState): number {
  const dx = toward.x - target.x;
  const dz = toward.z - target.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return 0;
  return Math.max(0, (target.vx * dx + target.vz * dz) / len);
}

/** The skill pair a strike is resolved on, by position (Realism pass). */
export function strikeSkills(
  actor: FighterWorldState, target: FighterWorldState, posture: ImpactPosture,
): [number, number] {
  const a = actor.runtime;
  const d = target.runtime;
  if (posture === 'distance') return [a.strikingMean, d.strikingMean];
  const A = grapplingAliases(a);
  const D = grapplingAliases(d);
  if (posture === 'clinch' || posture === 'wallPinned') {
    return [
      0.5 * a.strikingMean + 0.5 * A['mma.clinch_strike'],
      0.5 * d.strikingMean + 0.5 * Math.max(D['mma.clinch_strike'], D['wr.pummel']),
    ];
  }
  if (posture === 'groundTop') {
    return [
      0.4 * a.strikingMean + 0.6 * A['mma.gnp'],
      0.4 * d.strikingMean + 0.6 * Math.max(D['bjj.retention'], D['bjj.escape']),
    ];
  }
  return [
    0.5 * a.strikingMean + 0.5 * A['bjj.retention'],
    0.5 * d.strikingMean + 0.5 * D['mma.gnp'],
  ];
}

function grappleActorOf(w: World, f: FighterWorldState): GrappleActor {
  const r = f.runtime;
  const disc = r.disciplines;
  // TODO(chapter 07): the AI will hand 03 an alias table it has already scouted.
  // Until then the 03 §2.1.3 aliases are filled from chapter 01's effective
  // sub-skills, which is the mapping chapter 01's barrel already promises.
  const skills: Record<string, number> = {};
  const prefixes: readonly [keyof typeof disc, string][] = [
    ['wrestling', 'wr'], ['judo', 'jd'], ['bjj', 'bjj'], ['mmaIntegration', 'mma'],
  ];
  for (const [d, prefix] of prefixes) {
    const block = disc[d];
    if (!block) continue;
    for (const k of Object.keys(block.effective)) skills[`${prefix}.${k}`] = block.effective[k];
  }
  // Realism pass: the 03 §2.1.3 alias map. The edge tables name their skills
  // by alias (`wr.shot`, `bjj.pass`, `mma.cage`, ...) and until this pass the
  // table above only held §01's own names (`wr.shots`, `bjj.passing`, ...),
  // which match *none* of the aliases — so `skillOf` returned null and no
  // grappling edge in the sim ever read a grappling skill. A better wrestler
  // shot, sprawled, rode and got up exactly as well as a worse one (a clone
  // with +10 on every grappling sub-skill won 47 %; +10 striking 62 %).
  Object.assign(skills, grapplingAliases(r));
  return {
    id: f.id,
    skills: skills as GrappleActor['skills'],
    tiers: {
      wrestling: disc.wrestling?.tier ?? 0,
      judo: disc.judo?.tier ?? 0,
      bjj: disc.bjj?.tier ?? 0,
      mma: r.mmaTier,
    },
    strength: r.effective.strength,
    explosiveness: r.effective.explosiveness,
    flexibility: r.effective.flexibility,
    balance: r.effective.balance,
    speed: r.effective.speed,
    massKg: r.body.fightNightKg,
    heightM: r.body.heightM,
    reachM: r.body.reachM,
    fatigue: f.energy.f,
    rocked: f.damage.has(S.rocked),
    recentStrikesLanded: 0,
    recentStrikesAbsorbed: 0,
    drivingLegDamage: 0,
    baseLegDamage: 0,
    chainSkill: disc.wrestling?.effective['chain'] ?? 50,
    background: { greco: false, judo: !!disc.judo?.trained, folkstyle: false, funk: false },
  };
}

function subFighterOf(f: FighterWorldState): SubFighter {
  const r = f.runtime;
  const bjj = r.disciplines.bjj;
  const pick = (key: string, fallback: number): number => bjj?.effective[key] ?? fallback;
  return baselineFighter({
    tier: r.grapplingTier,
    chokes: pick('chokes', r.grappling.subAttack),
    jointLocks: pick('jointLocks', r.grappling.subAttack),
    legLocks: pick('legLocks', r.grappling.subAttack),
    // Realism pass: 04's `sk.cranks` has no §01 skill of its own (neck cranks
    // are chokes-and-locks craft), and `sk.control` / `sk.guard` are 03's
    // `bjj.top_control` / `bjj.retention` (03 §2.1.3). `control` fell back to
    // the *defensive* SUB composite, so the man on top held a submission with
    // his escape skill.
    cranks: pick('cranks', 0.5 * (pick('chokes', r.grappling.subAttack) + pick('jointLocks', r.grappling.subAttack))),
    // Realism pass: the MMA floor (see `grapplingAliases`) reaches the
    // submission battle too; a non-BJJ fighter's escapes were his untrained 7.
    escapes: Math.max(pick('escapes', r.grappling.subDefence), grapplingAliases(r)['bjj.escape'], r.grappling.subDefence),
    control: grapplingAliases(r)['bjj.top_control'] || r.grappling.subDefence,
    guard: Math.max(pick('guard', r.grappling.subDefence), grapplingAliases(r)['bjj.retention']),
    strength: r.effective.strength,
    flexibility: r.effective.flexibility,
    neck: r.effective.neck,
    heart: r.def.mental.heart,
    fightIQ: r.def.mental.fightIQ,
    massKg: r.body.fightNightKg,
    reachM: r.body.reachM,
    legReachM: r.body.legReachM,
    fatigue: f.energy.f,
    rocked: f.damage.has(S.rocked),
    structuralHead: f.damage.regions.head.structural,
    subHunter: false,
    wrestlerGnp: false,
  });
}

// ---------------------------------------------------------------------------
// createModules
// ---------------------------------------------------------------------------

export interface BindOptions {
  /**
   * The decision policy. Defaults to chapter 07's `MmaPolicy`, which scouts,
   * plans, reads and adapts. `IdlePolicy` remains exported for tests that want
   * to exercise the loop without any decision-making.
   */
  policy?: DecisionPolicy;
}

/**
 * A landed strike above this force is "heavy" for the opponent model, which
 * distinguishes being touched from being hurt when it decides whether the plan
 * is failing. 1.5 kN is roughly the 88th percentile of the in-ring force
 * distribution `[S: LIT_A, Pierce 2006]`.
 */
const HEAVY_IMPACT_N = 1500;

/** Technique lookup for the outcome feedback below. */
/**
 * How well the attacker got their weight behind this strike (02 §2.6.4).
 *
 * Every strike used to be scored as `planted` — fully set, hips turned, weight
 * transferred — which is the ceiling of the force model, not its average. Real
 * strikes are thrown while backing up, off the wrong foot, or as a range-finding
 * paw, and each of those costs 30-50% of delivered force. Treating them all as
 * planted inflated the whole force distribution and, through it, the knockdown
 * rate.
 *
 * The mode is read from state that already exists at contact time, so this adds
 * no RNG draw and cannot desynchronise a replay:
 *   retreating  the attacker's velocity points away from the target
 *   armPunch    balance is gone, so there is no base to turn from
 *   touch       a light, low-commitment weapon thrown at the edge of its range
 *   instep      a kick landing at the tip of its range, instep rather than shin
 */
function commitModeOf(
  w: World, actor: FighterWorldState, target: FighterWorldState, spec: TechniqueSpec
): CommitMode {
  const dx = target.x - actor.x;
  const dz = target.z - actor.z;
  const d = Math.hypot(dx, dz);
  if (d > 1e-6) {
    // Closing speed toward the target; negative means backing away from it.
    const closing = (actor.vx * dx + actor.vz * dz) / d;
    if (closing < -0.25) return 'retreating';
  }
  if (actor.balance < 0.45) return 'armPunch';

  const kick = spec.weapon !== 'fist' && spec.weapon !== 'elbow';
  const reach = kick
    ? actor.runtime.effectiveKickReachM
    : actor.runtime.effectiveReachM;
  // "At the end of its range": the last 12% of the weapon's reach, where a kick
  // lands on the instep and a punch is arm-only.
  const atTip = d > reach * 0.88;
  if (kick && atTip) return 'instep';
  if (!kick && atTip && spec.commitment.balance <= 3) return 'touch';
  return 'planted';
}

const TECHNIQUE_BY_ID = new Map<string, TechniqueSpec>([...TECHNIQUES, ...GROUND_TECHNIQUES].map((t) => [t.id, t]));

export function createModules(world: World, opts: BindOptions = {}): BoundModules {
  const policy = opts.policy ?? new MmaPolicy();
  /**
   * Chapter 07 exposes `noteOutcome` for outcome feedback; a policy that does
   * not implement it (the idle policy, test doubles) simply does not learn.
   */
  const noteOutcome = (
    fighterId: number,
    kind: 'landed' | 'absorbed' | 'absorbedHeavy' | 'knockdown'
      | 'tdLanded' | 'tdStuffed' | 'takenDown' | 'counterEaten' | 'cageExchange' | null,
    what: string | null,
  ): void => {
    if (kind === null) return;
    const p = policy as { noteOutcome?: (id: number, k: string, f: string | null) => void };
    const spec = what && TECHNIQUE_BY_ID.has(what) ? TECHNIQUE_BY_ID.get(what)! : undefined;
    const family = spec
      ? familyForTechnique(spec.family, spec.limb, spec.targets[0])
      : null;
    p.noteOutcome?.(fighterId, kind, family);
  };
  /**
   * `grap.setupBonus` is the §2.3 A payload of a level change and of a strike
   * thrown into a shot ("inside `grap.setupWindowMs` of a strike or a feint",
   * resolve.ts). Nothing was setting it: `GrappleWorld.setup` went out as a
   * literal `false`, so a level change was a 250 ms no-op that bought its
   * owner nothing and the AI re-chose it forever. Fighter id -> ms until which
   * the window is open.
   */
  const setupUntilMs = new Map<number, number>();
  const openSetupWindow = (w: World, f: FighterWorldState, fromMs: number): void => {
    setupUntilMs.set(f.id, fromMs + w.params.get('grap.setupWindowMs'));
  };
  const setupOpen = (w: World, f: FighterWorldState): boolean =>
    (setupUntilMs.get(f.id) ?? -Infinity) >= w.nowMs;

  const clock = matchClock(world.config, world.ruleset);
  const dtMs = world.params.get('core.dtMs');
  /** Guards the once-per-tick work that `upkeep` is the only hook for. */
  let timersTick = -1;

  // =========================================================================
  // P2 — upkeep
  // =========================================================================

  /**
   * Phase 9 (I2/I3/I5): take a fighter out of his engagement and bring his
   * former partner's reported node, posture and hold into line on the same
   * tick. Leaving the partner to his next upkeep left one to two ticks in
   * which he reported a clinch or ground node while free, or held a
   * submission on nobody.
   */
  function leaveAndSync(w: World, f: FighterWorldState): void {
    const partner = w.engagements.partnerOf(f.id);
    w.engagements.leave(f.id, w.tick);
    if (partner !== null && partner !== f.id) {
      const pf = w.fighters[partner];
      if (pf && !pf.out) syncEngagement(w, pf);
    }
  }

  function syncEngagement(w: World, f: FighterWorldState): void {
    const e = w.engagements.of(f.id);
    // I5: a submission lives in the position it was offered from. When the
    // engagement dissolves or moves to a node that does not offer it to this
    // fighter's slot, the hold is gone. (Phase 9: `f.sub` used to outlive the
    // position, so a fighter could "hold" a choke from the feet or from the
    // bottom of a position that never offered it — invariant I5.)
    if (f.sub.technique !== null) {
      const slot = e ? w.engagements.slotOf(f.id) : null;
      if (!e || slot === null || e.b < 0 || !nodeAllowsSubmission(e.node, slot, f.sub.technique)) {
        f.sub = { technique: null, stage: 0, progress: 0, lockedAtMs: null };
      }
    }
    if (!e) {
      f.partnerId = null;
      if (f.posture !== 'down' && f.posture !== 'out') {
        f.posture = 'standing';
        f.position = freeNodeFor(w, f);
      }
      return;
    }
    f.partnerId = w.engagements.partnerOf(f.id);
    const slot = w.engagements.slotOf(f.id);
    // I2: both fighters report the node the engagement is at (slot `b` reports
    // the complement, which for this graph is the same id — 03 uses one node
    // per pair with a/b slots).
    f.position = e.node;
    f.posture = e.kind === 'clinch' ? 'clinch' : 'ground';
    // I4: nobody moves inside an engagement except in a scramble.
    if (e.kind !== 'scramble') {
      f.vx = 0;
      f.vz = 0;
    }
    void slot;
  }

  function sustainedClassFor(w: World, f: FighterWorldState, posture: ImpactPosture): TechClass {
    if (posture === 'clinch') return 'clinchPummel';
    if (posture === 'wallPinned') return 'wallPinned';
    if (posture === 'groundTop') return 'groundTopHold';
    if (posture === 'groundBottom') return 'groundBottomPressured';
    const speed = Math.hypot(f.vx, f.vz);
    void w;
    // Realism pass: footwork is now committed steps at step speed (~2 m/s for
    // 200-400 ms, 02 §2.1.5). A step is fight footwork, not the sustained
    // high-pace running DAMAGE §4's per-second cost was written for; only a
    // chase or a flight above ~2.4 m/s is.
    return speed > 2.4 ? 'movementHighPace' : speed > 0.05 ? 'movementLowPace' : 'idleStanding';
  }

  /**
   * 05 addresses every `DamageEvent` to the fighter it happened *to*
   * (`actor === target === this.profile.id`) — `DamageState` has no idea who
   * is hitting it. A knockdown, though, belongs to the fighter who caused it:
   * `stats.ts` reads `e.actor` for `knockdowns`, and 06's judging reads that
   * tally, so leaving the id as 05 wrote it scored every accumulation, body
   * and leg knockdown for the fighter who was dropped. `by` is the causer when
   * the caller knows it (the striker at P4), otherwise the last fighter to
   * land on this one.
   */
  function pushDamageEvents(
    w: World, events: readonly DamageEvent[], subMs = 0, by = -1,
  ): void {
    for (const e of events) {
      const downed = e.actor;
      const f = w.fighters[downed];
      const cause = e.kind === 'knockdown'
        ? (by >= 0 ? by : (f?.lastStruckBy ?? -1))
        : -1;
      emit(w, {
        ...e,
        tick: w.tick,
        subMs,
        round: w.round,
        ...(e.kind === 'knockdown' && cause >= 0 && cause !== downed
          ? { actor: cause, target: downed }
          : {}),
      });
      if (e.kind === 'knockdown' && f) {
        f.posture = 'down';
        f.downTicks = Math.max(f.downTicks, 10);
        f.knockdowns++;
        w.scheduler.queue.cancelFor(f.id, 'knockdown');
        leaveAndSync(w, f);
      }
    }
  }

  function upkeep(w: World, f: FighterWorldState, ms: number): void {
    if (w.tick !== timersTick) {
      timersTick = w.tick;
      w.engagements.advanceTimers(ms);
      // The horn. `BoutLoop` owns the clock, so the only hook that sees the
      // first tick of a round is this one.
      if (w.roundTick === 1) {
        emit(w, {
          ...base(w, 'roundStart', -1, -1, `Round ${w.round}`),
          kind: 'roundStart',
          detail: { label: `r${w.round}` },
        });
        refereeRuntime(w).ref.startRound(w.round);
      }
    }
    syncEngagement(w, f);
    const posture = postureOf(w, f);
    const dtS = ms / 1000;

    // 05 §2.5.1: the standing/clinch/ground cost of simply being there.
    f.damage.spendSustained(sustainedClassFor(w, f, posture), dtS);

    const obs = refereeRuntime(w).obs;
    // Phase 9: "grounded" for 06's stoppage tests is the fighter who is down
    // or underneath — the top of a mount is on the mat too, and was being
    // treated as a grounded fighter who could be stopped for "covering".
    const engagedRole = w.engagements.of(f.id) ? w.engagements.roleOf(f.id) : 'none';
    const grounded = f.posture === 'down'
      || (isGroundedNode(f.position) && engagedRole !== 'top' && engagedRole !== 'attacker');
    // A bottom fighter working an escape, a sweep or a get-up is defending
    // intelligently for as long as the attempt is in motion (06 §2.3.3: "not
    // improving position" is the test), not only on the tick he started it.
    if (grounded && f.action !== null && hasGrapplingEdge(f.action)
      && w.nowMs < f.actionCommitMs + f.actionTotalMs) {
      f.damage.noteAnswer();
    }
    // A fighter playing full guard (closed or open) who is not hurt and not
    // spent is defending the whole time — legs between him and the puncher,
    // tying up, controlling posture — whether or not he attempts a sweep this
    // second (06 §2.3.3: the test is "not intelligently defending"). In half
    // guard, the turtle, under mount or side control, with his back taken or
    // in a crucifix — the ground-and-pound stoppage positions — he has to *do*
    // something (an escape in motion, a strike back) to count. [E: Phase 9]
    if (grounded && engagedRole === 'bottom' && f.posture !== 'down' && hasPositionNode(f.position)
      && GUARD_DEFENCE_FAMILIES.has(positionNode(f.position).family)
      && !f.damage.has(S.rocked) && !f.damage.has(S.knockdownHurt)
      && f.energy.f < GUARD_DEFENCE_MAX_FATIGUE) {
      f.damage.noteAnswer();
    }
    const events = f.damage.upkeep(ms, {
      tick: w.tick,
      round: w.round,
      posture,
      grounded,
      clinching: posture === 'clinch' || posture === 'wallPinned',
      moving: Math.hypot(f.vx, f.vz) > 0.05,
      underChoke: underChoke(w, f),
      attemptingToRise: f.posture === 'down' && f.downTicks <= 0,
      tapped: false,
      verbalTap: false,
      screams: false,
      jointFailed: f.damage.has(S.jointFailure),
    });
    pushDamageEvents(w, events);
    obs[f.id] = f.damage.observables();

    // Timers the loop owns rather than a module.
    if (f.downTicks > 0) f.downTicks--;
    if (f.posture === 'down' && f.downTicks <= 0 && !f.damage.grounded && f.damage.conscious) {
      f.posture = 'standing';
      f.position = freeNodeFor(w, f);
    }
    if (f.action !== null && w.nowMs >= f.actionCommitMs + f.actionTotalMs) {
      f.action = null;
    }

    // Control time (09 §4.1): top, back control, or pinning in the clinch.
    const e = w.engagements.of(f.id);
    if (e && e.b >= 0 && e.kind !== 'scramble') {
      const role = w.engagements.roleOf(f.id);
      if (role === 'top' || role === 'attacker') f.controlTicks++;
    }
  }

  function underChoke(w: World, f: FighterWorldState): boolean {
    const partner = f.partnerId === null ? null : w.fighters[f.partnerId];
    if (!partner || partner.sub.technique === null) return false;
    if (partner.sub.stage < 3) return false;
    const spec = hasSubmission(partner.sub.technique) ? submission(partner.sub.technique) : null;
    return spec?.family === 'choke';
  }

  // =========================================================================
  // P0 — break recovery
  // =========================================================================

  function breakRecovery(w: World, f: FighterWorldState, ms: number): void {
    // The break is applied once, on the first tick of the break, because 05's
    // `roundBreak` takes the whole break length as its argument.
    if (w.breakTicksLeft !== Math.round((clock.breakSeconds * 1000) / dtMs) - 1) return;
    const events = f.damage.roundBreak({
      breakSeconds: clock.breakSeconds,
      round: w.round,
    });
    pushDamageEvents(w, events);
    refereeRuntime(w).obs[f.id] = f.damage.observables();
    f.posture = 'standing';
    f.position = 'pos.standing_long';
    f.downTicks = 0;
    f.sub = { technique: null, stage: 0, progress: 0, lockedAtMs: null };
    w.engagements.leave(f.id, w.tick);
    f.partnerId = null;
    void ms;
  }

  // =========================================================================
  // P3 — can this fighter act, and committing what they chose
  // =========================================================================

  function canAct(w: World, f: FighterWorldState): boolean {
    if (f.out) return false;
    // Phase 9: time is out while the referee counts, the doctor looks at a
    // cut or a foul is being dealt with. Fighters used to keep fighting
    // through every pause.
    if (refereeRuntime(w).ref.isPaused) return false;
    if (f.posture === 'down' || f.posture === 'out') return false;
    if (f.downTicks > 0) return false;
    if (!f.damage.conscious) return false;
    if (f.damage.has(S.ko) || f.damage.has(S.chokedOut)) return false;
    if (f.damage.has(S.knockdownFlash) || f.damage.has(S.knockdownHurt)) return false;
    if (f.damage.grounded && f.posture !== 'ground') return false;
    // Mid-commitment: still inside startup/active/recovery, or a contact pending.
    if (f.action !== null && w.nowMs < f.actionCommitMs + f.actionTotalMs) return false;
    // Realism pass: a feint is a committed movement with no contact.
    if (w.nowMs < f.tactic.busyUntilMs) return false;
    if (w.scheduler.queue.pendingFor(f.id) !== null) return false;
    // 04: a fighter held at `secure` or deeper cannot choose a new action; the
    // submission battle is resolved by its own windows.
    // The attacker holding such a submission *can* act, but only to work it:
    // `commitDecision` turns whatever he chose into the next window of the
    // same submission. (Phase 9: returning false here froze the attacker too,
    // so no window after `secure` was ever scheduled — every submission stalled
    // at stage 2 and the sim produced no submission finishes at all.)
    const partner = f.partnerId === null ? null : w.fighters[f.partnerId];
    if (partner && partner.sub.technique !== null && partner.sub.stage >= 2) return false;
    return true;
  }

  function targetOf(w: World, f: FighterWorldState, d: Decision): FighterWorldState | null {
    if (d.targetId !== null) {
      const t = w.fighters[d.targetId];
      if (t && !t.out && t.id !== f.id) return t;
    }
    return w.nearestOpponent(f);
  }

  /**
   * 02 §2.4: the guard and the reactive defence are chosen per incoming strike,
   * so a fighter who cannot start a new action can still change what he is
   * doing with his hands. Only the defence is taken; the movement intent and
   * the action are the parts a commitment locks out.
   */
  function holdDefence(w: World, f: FighterWorldState, d: Decision): void {
    f.defence = d.defence;
    // Realism pass: a committed step keeps its sense (in, out, around) relative
    // to where the opponent is *now* while the fighter is busy — circling is a
    // circle, not a straight line that drifts away from him.
    if (w.nowMs < f.step.untilMs && !w.engagements.of(f.id)) {
      const target = targetOf(w, f, d) ?? w.nearestOpponent(f);
      if (target) {
        const dx = target.x - f.x;
        const dz = target.z - f.z;
        const len = Math.hypot(dx, dz) || 1;
        const ux = dx / len;
        const uz = dz / len;
        const s = f.step;
        f.vx = clamp((s.radial * ux - s.lateral * uz) * s.speed, -4, 4);
        f.vz = clamp((s.radial * uz + s.lateral * ux) * s.speed, -4, 4);
      }
    }
  }

  /**
   * Realism pass: footwork is committed in steps (02 §2.1.5: a step-drag or a
   * shuffle takes ~200 ms, an L-step 400). A movement decision starts a step
   * whose radial and lateral sense (toward / around the opponent) holds for
   * the step's duration; a wait or a defensive posture chosen mid-step does
   * not stop the feet, only a strike, a grapple or a new commitment does. A
   * step-in strike (`stepIn` flag) carries the attacker forward over its
   * startup, which is what closes the distance on the way in. Before this,
   * velocity lived for exactly the tick a movement was chosen, so 92 % of
   * movement runs lasted one tick and the fighters stuttered.
   */
  function steer(w: World, f: FighterWorldState, d: Decision, target: FighterWorldState | null): void {
    const max = 4;
    const fleeing = /flee|flight/.test(d.intentTag);
    if (fleeing || !target) {
      f.vx = clamp(d.moveX, -max, max);
      f.vz = clamp(d.moveZ, -max, max);
      f.step.untilMs = -Infinity;
      return;
    }
    const dx = target.x - f.x;
    const dz = target.z - f.z;
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len;
    const uz = dz / len;
    const px = -uz;
    const pz = ux;
    const active = w.nowMs < f.step.untilMs;
    const passive = d.kind === 'wait' || d.kind === 'defend' || (d.kind === 'move' && active) || d.what === null;
    if (d.kind === 'move' && !active) {
      const speed = Math.hypot(d.moveX, d.moveZ);
      if (speed > 1e-6) {
        let radial = (d.moveX * ux + d.moveZ * uz) / speed;
        let lateral = (d.moveX * px + d.moveZ * pz) / speed;
        // The candidate's direction was built from the *perceived* position
        // (a tick or two old); a step is either in/out or around, so snap it.
        if (Math.abs(radial) < 0.6) { radial = 0; lateral = lateral >= 0 ? 1 : -1; }
        else { radial = radial > 0 ? 1 : -1; lateral = 0; }
        const sp = radial < -0.5 ? speed * FOOTWORK.retreatSpeedMult : speed;
        f.step = { tag: d.intentTag, radial, lateral, speed: sp, untilMs: w.nowMs + stepMs(d.what ?? '') };
        // Walking into the other man's range unguarded is an entry he can
        // time (02 §2.5.1 applied to a step): a short exposure window.
        if (radial > 0.5 && len <= bandLimits(reachOf(target)).longMax + 0.25) {
          openEntryExposure(w, f);
        }
      } else {
        f.step.untilMs = -Infinity;
      }
    } else if (!passive) {
      f.step.untilMs = -Infinity;
      if (d.kind === 'strike' && typeof d.what === 'string' && hasTechnique(d.what)) {
        const spec = technique(d.what as TechniqueId);
        if (spec.flags.includes('stepIn')) {
          // A step-in strike covers ~0.4 m over its startup.
          const ms = Math.max(100, spec.startupMs);
          f.step = { tag: d.what, radial: 1, lateral: 0, speed: (0.4 / ms) * 1000, untilMs: w.nowMs + ms };
        }
      }
    }
    if (w.nowMs < f.step.untilMs) {
      const s = f.step;
      f.vx = clamp((s.radial * ux + s.lateral * px) * s.speed, -max, max);
      f.vz = clamp((s.radial * uz + s.lateral * pz) * s.speed, -max, max);
      if (passive) f.intentTag = s.tag;
    } else {
      f.vx = d.kind === 'move' ? clamp(d.moveX, -max, max) : 0;
      f.vz = d.kind === 'move' ? clamp(d.moveZ, -max, max) : 0;
    }
  }

  /** See `resolveStrikeContact`: a range strike stops an advancing opponent. */
  function stopTheEntry(w: World, actor: FighterWorldState, target: FighterWorldState, spec: TechniqueSpec): void {
    const key = spec.family === 'teep' ? 'teep'
      : spec.family === 'straight' ? (spec.limb === 'leadHand' ? 'jab' : 'cross')
        : spec.family === 'bodyKick' ? 'bodyKick' : null;
    if (key === null) return;
    const dx = actor.x - target.x;
    const dz = actor.z - target.z;
    const len = Math.hypot(dx, dz) || 1;
    const vr = (target.vx * dx + target.vz * dz) / len;
    const stepping = w.nowMs < target.step.untilMs && target.step.radial > 0.5;
    if (vr <= FOOTWORK.enteringSpeedMs && !stepping) return;
    target.step.untilMs = -Infinity;
    target.vx = 0;
    target.vz = 0;
    const push = FOOTWORK.pushbackM[key] ?? 0;
    const c = clampToArena(w.arena, target.x - (dx / len) * push, target.z - (dz / len) * push, 0.35);
    target.x = c.x;
    target.z = c.z;
  }

  /** The exposure an unguarded walk-in opens (see `steer`). */
  function openEntryExposure(w: World, f: FighterWorldState): void {
    const t = f.tactic;
    if (t.exposedUntilMs >= w.nowMs) return;
    t.exposedFromMs = w.nowMs;
    t.exposedUntilMs = w.nowMs + FOOTWORK.entryExposureMs + 200;
    t.exposedDefenceLogit = 0;
    t.exposedReadLogit = -0.15;
    t.exposedTech = 'tech.jab_step' as TechniqueId;
  }

  function commitDecision(w: World, f: FighterWorldState, d: Decision, jitter: number): void {
    f.defence = d.defence;
    f.intentTag = d.intentTag;
    f.lastActionTick = w.tick;

    // Movement intent. P5 integrates whatever is left here; an engaged fighter
    // outside a scramble is pinned in place by invariant I4.
    const e = w.engagements.of(f.id);
    const target = targetOf(w, f, d);
    if (e && e.kind !== 'scramble') {
      f.vx = 0;
      f.vz = 0;
      f.step.untilMs = -Infinity;
    } else {
      steer(w, f, d, target);
    }

    // A fighter faces his opponent while moving in any direction — retreating,
    // circling or cutting off the cage — and faces his direction of travel only
    // when running away (street flight). Facing used to follow the movement
    // heading, which recorded every retreating fighter as turned around and
    // corrupted the two consumers that read it: the multi-opponent "is he
    // facing me" threat test and the angle logic's lateral offset.
    const fleeing = /flee|flight/.test(d.intentTag);
    if (target && !fleeing) {
      f.facing = Math.atan2(target.x - f.x, target.z - f.z);
    } else if (d.moveX !== 0 || d.moveZ !== 0) {
      f.facing = Math.atan2(d.moveX, d.moveZ);
    }
    const holdingSub = f.sub.technique !== null && f.sub.stage >= 2 && f.partnerId !== null;
    if (!holdingSub && (d.kind === 'wait' || d.kind === 'move' || d.kind === 'defend' || d.what === null)) {
      f.action = null;
      f.actionResult = 'none';
      return;
    }
    if (!target) return;

    // 04: a submission at `secure` or deeper is resolved window by window
    // until it ends; the attacker's only choice is to keep working it.
    if (f.sub.technique !== null && f.sub.stage >= 2) {
      const partner = f.partnerId === null ? null : w.fighters[f.partnerId];
      if (partner && !partner.out) {
        commitSubmission(w, f, partner, { ...d, kind: 'submission', what: f.sub.technique }, jitter);
        return;
      }
    }

    if (d.kind === 'strike') commitStrike(w, f, target, d, jitter);
    else if (d.kind === 'grapple') commitGrapple(w, f, target, d, jitter);
    else if (d.kind === 'submission') commitSubmission(w, f, target, d, jitter);
  }

  function schedule(
    w: World, f: FighterWorldState, target: FighterWorldState, kind: ContactKind,
    what: string, contactMs: number, total: number, payload: Payload, jitter: number,
    startupMs: number, activeMs: number,
  ): ScheduledContact {
    const contact = w.scheduler.commit(
      { actorId: f.id, targetId: target.id, kind, what, contactMs, totalMs: total, payload },
      w.tick, f.decisionOffsetMs, jitter,
    );
    f.action = what;
    f.actionCommitMs = contact.commitMs;
    f.actionTotalMs = contact.totalMs;
    f.actionStartupMs = startupMs;
    f.actionActiveMs = activeMs;
    f.actionTargetId = target.id;
    f.actionResult = 'none';
    return contact;
  }

  function commitStrike(
    w: World, f: FighterWorldState, target: FighterWorldState, d: Decision, jitter: number,
  ): void {
    if (typeof d.what === 'string' && d.what.startsWith('feint.')) {
      commitFeint(w, f, target, d);
      return;
    }
    const id = d.what as TechniqueId;
    if (!hasTechnique(id)) return;
    const spec = technique(id);
    const posture = postureOf(w, f);
    // Chapter 01's tier execution multiplier; never baked into the catalogue.
    const mult = spec.weapon === 'fist' || spec.weapon === 'backfist' || spec.weapon === 'hammerfist'
      ? f.runtime.execTimeMultPunch
      : f.runtime.execTimeMultKick;
    const short = (d.payload as { short?: boolean } | undefined)?.short === true && posture !== 'distance';
    const tMult = short ? SHORT_STRIKE_MODEL.timeMult : 1;
    const contactMs = Math.max(1, Math.round(spec.contactMs * mult * tMult));
    const total = Math.max(contactMs, Math.round(techniqueTotalMs(spec) * mult * tMult));

    f.damage.spendAction(short ? 'lightStrike' : techClassFor(spec, posture), { skill: f.runtime.strikingMean });
    // 05 §2.7: a strike thrown back is an "answer". Without this the referee
    // never sees intelligent defence and stops every fight for repetitive
    // strikes.
    f.damage.noteAnswer();

    const region: TargetRegion = (d.payload as { region?: TargetRegion } | undefined)?.region
      ?? spec.targets[0];
    f.totalAttempted++;
    const sig = isSignificant(spec, posture, short);
    if (sig) f.sigAttempted++;

    const contact = schedule(w, f, target, 'strike', id, contactMs, total, {
      kind: 'strike', technique: id, region, posture, node: f.position, ...(short ? { short: true } : {}),
      sig, pos: statPosition(posture),
    }, jitter, Math.round(spec.startupMs * mult * tMult), Math.round(spec.activeMs * mult * tMult));
    // I-2/I-3: the shot that follows a strike is the one that works.
    openSetupWindow(w, f, contact.commitMs + contactMs);
  }

  /**
   * Realism pass: a feint is a real, committed movement (02 §2.3.4). Until
   * this pass a feint decision reached `commitStrike`, failed `hasTechnique`
   * and did nothing at all — every feint the AI ever chose was a wasted tick.
   *
   * The bite is resolved here, once per feint, from the uniform the policy
   * carries in the payload (the conditional residual of its own selection
   * draw, so no draw is added). A bite means the defender executes the
   * reaction the feint sells: until `bitUntilMs` his reactive defence is spent
   * and the feinter's next strike carries §2.3.4's follow-up bonus.
   */
  function commitFeint(w: World, f: FighterWorldState, target: FighterWorldState, d: Decision): void {
    let spec;
    try {
      spec = feintSpecOf(d.what as FeintId);
    } catch {
      return;
    }
    const busyMs = spec.startupMs + spec.recoveryMs;
    f.tactic.busyUntilMs = w.nowMs + busyMs;
    f.action = null;
    f.actionResult = 'none';
    f.damage.spendAction('feint', { skill: f.runtime.strikingMean });
    const u = (d.payload as { biteU?: number } | undefined)?.biteU ?? 1;
    // A feint is only sold to a man who is standing, free and looking.
    const canSee = target.posture === 'standing' && postureOf(w, target) === 'distance'
      && w.nowMs >= target.tells.backTurnedUntilMs;
    const p = canSee ? feintBiteP({
      baseBiteP: target.runtime.anticipation.striking.feintBiteP,
      attackerFeintSkill: strikingCraft(f.runtime).feints,
      repeats: feintRepeats(f.tactic, spec.id, w.nowMs),
      defenderFatigue: target.energy.f,
      defenderRocked: target.damage.has(S.rocked),
      defenderVisionBlocked: w.nowMs < target.tells.eyesShutUntilMs,
      consecutive: f.tactic.feintsSinceStrike,
    }) : 0;
    const bite = u < p;
    noteFeint(f.tactic, spec.id, w.nowMs);
    // 03 §2.3 A: a feint grants the set-up window to the shot that follows.
    openSetupWindow(w, f, w.nowMs + spec.startupMs);
    if (bite) {
      target.tactic.bitBy = f.id;
      target.tactic.bitUntilMs = w.nowMs + spec.startupMs + FEINT.windowMs;
      target.tactic.bitBonus = biteBonus(spec.id, target.runtime.strikingTier);
      target.tactic.bitFeint = spec.id;
    }
    emit(w, {
      ...base(w, 'feint', f.id, target.id, `${f.runtime.def.short} ${bite ? 'draws a reaction with' : 'shows'} a ${spec.name.toLowerCase()}`),
      kind: 'feint',
      detail: { intent: spec.id, bite },
    });
  }

  /**
   * 03 §2.1.1 allows one contested edge per engagement at a time. The fighter
   * who lost the race for it made the attempt all the same: it goes on the
   * books as a stuffed edge rather than vanishing, which would otherwise
   * flatter takedown accuracy and hide the exchange from the judges.
   */
  function beatenToIt(
    w: World, loser: FighterWorldState, winner: FighterWorldState | undefined,
    edge: GrapplingEdge,
  ): void {
    const cost = edgeEnergy(edge, loser.position);
    loser.damage.spendAction(cost.cls, { scale: cost.scale });
    const kind = edgeEventKind(edge) === 'reversal' ? 'positionChange' : edgeEventKind(edge);
    emit(w, {
      ...base(w, kind, loser.id, winner?.id ?? -1,
        `${loser.runtime.def.short} is beaten to the ${edge.name}`),
      kind,
      detail: { edge: edge.id, from: loser.position, result: 'stuffed', reason: 'contested' },
    } as GrappleEvent);
  }

  function commitGrapple(
    w: World, f: FighterWorldState, target: FighterWorldState, d: Decision, jitter: number,
  ): void {
    const id = d.what as string;
    if (!hasGrapplingEdge(id)) return;
    const edge = grapplingEdge(id);
    if (!edge.from.includes(f.position)) return;
    const e = w.engagements.of(f.id);
    // 03 §2.1.1 allows one contested edge per engagement at a time. P3 iterates
    // in ascending id, so "first to ask" handed the slot to the lower id on
    // every tick it wanted it — a systematic initiative bonus worth 2x the
    // takedowns and 3.6x the reversals in a mirror match. The tie is broken
    // instead by the intra-tick commit offset the loop already draws for
    // exactly this purpose (09 §2.2), which is symmetric by construction.
    const offset = (Math.round(f.decisionOffsetMs) + jitter) % dtMs;
    if (e) {
      const contest = w.engagements.contestInflight(e.id, w.tick, offset);
      // Whoever loses the contest pays the same price, whichever side of it he
      // is on: the attempt was made, the energy went out of the tank and 06 has
      // to see the failure. Charging only the displaced fighter would put the
      // whole cost on the lower id, because P3 asks him first and he is
      // therefore the only one who can ever be displaced — a ~3 pp win-rate
      // edge to the higher id in a mirror match.
      if (contest.verdict === 'blocked') {
        // Only a *simultaneous* claim is a race someone lost. An edge the
        // opponent committed on an earlier tick is already in motion: this
        // fighter never got his own attempt started, so nothing is charged
        // and nothing goes on the books. (Phase 9: charging it re-billed the
        // blocked fighter a takedown attempt's energy and a stuffed event on
        // every tick of the opponent's 2-8 s edge — ~300 phantom attempts a
        // bout, a large hidden fatigue drain on whoever was on top.)
        if (contest.edge !== null && contest.simultaneous) {
          beatenToIt(w, f, w.fighters[contest.incumbentId], edge);
        }
        return;
      }
      if (contest.verdict === 'displace' && contest.edge !== null) {
        const loser = w.fighters[contest.incumbentId];
        w.scheduler.queue.cancelFor(contest.incumbentId, 'engagement.contested');
        if (loser) {
          loser.action = null;
          loser.actionResult = 'stuffed';
          beatenToIt(w, loser, f, grapplingEdge(contest.edge));
        }
        w.engagements.clearInflight(e.id);
      }
    }
    // 03 §2.3 "dur" is a range; the midpoint is used, the scheduler's jitter
    // supplies the variation (no extra draw — 09 §2.7).
    const dur = Math.round((edge.durationMs[0] + edge.durationMs[1]) / 2);
    const stage: 'single' | 'capture' = typeof edge.baseP === 'number' ? 'single' : 'capture';

    const cost = edgeEnergy(edge, f.position);
    f.damage.spendAction(cost.cls, { scale: cost.scale });
    f.damage.noteAnswer();
    if (edge.kind === 'entry' || edge.kind === 'capture' || edge.kind === 'throw') {
      f.takedownsAttempted++;
    }
    if (e) w.engagements.commit(e.id, edge, w.tick, dur, stage, f.id, offset);

    schedule(w, f, target, 'grapple', id, dur, dur, {
      kind: 'grapple', edge: id, engagementId: e?.id ?? null, node: f.position, stage,
    }, jitter, 0, dur);
  }

  function commitSubmission(
    w: World, f: FighterWorldState, target: FighterWorldState, d: Decision, jitter: number,
  ): void {
    const id = d.what as SubmissionId;
    if (!hasSubmission(id)) return;
    const spec = submission(id);
    const stageName: 'entry' | 'secure' | 'finish' =
      f.sub.technique === id
        ? (f.sub.stage <= 1 ? 'entry' : f.sub.stage === 2 ? 'secure' : 'finish')
        : 'entry';
    const windowMs = STAGE_PARAMS.windowMs[stageName];

    if (f.sub.technique !== id) {
      f.sub = { technique: id, stage: 0, progress: 0, lockedAtMs: null };
      f.subAttempts++;
      // The attempt-side event: 04 `evt.sub_start` maps to `submissionStage` S0.
      emit(w, {
        ...base(w, 'submissionStage', f.id, target.id, `${f.runtime.name} goes for the ${spec.name}`),
        kind: 'submissionStage',
        detail: { technique: id, stage: 0, progress: 0, from: f.position },
      });
    }
    f.damage.spendSustained('submissionSqueeze', windowMs / 1000);
    f.damage.noteAnswer();

    schedule(w, f, target, 'submission', id, windowMs, windowMs, {
      kind: 'submission', technique: id, stage: stageName, node: f.position,
    }, jitter, 0, windowMs);
  }

  // =========================================================================
  // P4 — resolution
  // =========================================================================

  function resolveContact(w: World, contact: ScheduledContact): void {
    const payload = contact.payload as Payload | undefined;
    if (!payload) return;
    const actor = w.fighters[contact.actorId];
    const target = w.fighters[contact.targetId];
    if (!actor || !target) return;
    if (payload.kind === 'strike') resolveStrikeContact(w, contact, payload, actor, target);
    else if (payload.kind === 'grapple') resolveGrappleContact(w, contact, payload, actor, target);
    else resolveSubmissionContact(w, contact, payload, actor, target);
  }

  /** The §2.3 rule-3 re-check, shared by all three contact kinds. */
  function actorAble(w: World, f: FighterWorldState): boolean {
    if (f.out) return false;
    if (f.posture === 'down' || f.posture === 'out') return false;
    if (!f.damage.conscious) return false;
    return !(f.damage.has(S.knockdownFlash) || f.damage.has(S.knockdownHurt) || f.damage.has(S.ko));
  }

  function missedStrike(
    w: World, contact: ScheduledContact, p: StrikePayload,
    actor: FighterWorldState, target: FighterWorldState, why: string,
  ): void {
    actor.actionResult = 'missed';
    // Realism pass: a strike that falls short is still a whiff — the thrower
    // is out of position for its recovery (02 §2.5.1 "missed x1.0").
    if (why === 'out of range' && hasTechnique(p.technique)) {
      const spec = technique(p.technique);
      openExposure(actor.tactic, spec, 'missed', actor.runtime.strikingTier, contact.tMs + Math.round(spec.activeMs));
      notePrevStrike(actor.tactic, spec, contact.commitMs, target.id, 'missed', regionLabel(p.region));
    }
    const e: StrikeEvent = {
      ...base(w, 'strike', actor.id, target.id,
        `${actor.runtime.def.short} misses (${why})`, contact.subMs),
      kind: 'strike',
      detail: {
        technique: p.technique, result: 'missed', target: regionLabel(p.region), defence: target.defence,
        ...(p.short ? { short: true } : {}), sig: p.sig, pos: p.pos,
      },
    };
    emit(w, e);
  }

  /**
   * QA2 #6: a strike that was thrown but never reached its contact phase (a
   * knockdown or a referee break cancelled it, the bell rang, the bout
   * ended) is still an attempt. It goes on the books as `interrupted`, so
   * every committed strike produces exactly one strike event and the live
   * counters equal the stats.
   */
  function abandonContact(w: World, contact: ScheduledContact): void {
    const p = contact.payload as Payload | undefined;
    if (!p || p.kind !== 'strike') return;
    const actor = w.fighters[contact.actorId];
    if (!actor) return;
    const e: StrikeEvent = {
      ...base(w, 'strike', actor.id, contact.targetId,
        `${actor.runtime.def.short}'s strike is cut off`, 0),
      kind: 'strike',
      detail: {
        technique: p.technique, result: 'interrupted', target: regionLabel(p.region),
        ...(p.short ? { short: true } : {}), sig: p.sig, pos: p.pos,
      },
    };
    emit(w, e);
  }

  function regionLabel(r: TargetRegion): 'head' | 'body' | 'leadLeg' | 'rearLeg' | 'arms' {
    return r;
  }

  /**
   * 03 §5.1 "dmg": a strike from the top of a ground position carries this
   * fraction of the same fighter's standing power (no legs under it, a
   * shortened arc — 0.8 from high mount, 0.5 from the back, 0.3 against a
   * knee shield). The table was data only; ground strikes landed at full
   * standing force (Phase 9). The bottom strikes carry their scale in the
   * technique row already.
   */
  function gnpDamageMult(posture: ImpactPosture, node: PositionId, spec: TechniqueSpec): number {
    if (posture !== 'groundTop') return 1;
    const prof = gnpProfile(node);
    const key = spec.weapon === 'elbow' || spec.weapon === 'elbow_point' ? 'elbow'
      : spec.weapon === 'knee' ? 'knee' : spec.weapon === 'hammerfist' ? 'hammerfist' : 'fist';
    return prof?.dmg[key] ?? GNP_DEFAULT_DMG;
  }

  /**
   * Phase 9 [E: tuned to FIGHT_DATA §3 #16-#19]: at grappling range the
   * target cannot slip, roll or step off a strike — he is tied up or pinned —
   * so significant accuracy is 72 % in the clinch and on the ground against
   * 42 % at distance. The §02 defence tables are the stand-up ones; this is
   * the positional term they lack.
   */
  function positionalArrivalLogit(posture: ImpactPosture): number {
    if (posture === 'clinch' || posture === 'wallPinned') return POSITIONAL_ARRIVAL.clinch;
    if (posture === 'groundTop') return POSITIONAL_ARRIVAL.groundTop;
    if (posture === 'groundBottom') return POSITIONAL_ARRIVAL.groundBottom;
    return 0;
  }

  /** Strikes each fighter has thrown at each opponent so far (attacker*64+target). */
  const exposure = new Map<number, number>();

  /**
   * Phase 9 [E: tuned to FIGHT_DATA §3 #38 / #125]: the punch that drops a
   * man is the one he did not see (05 kUnseen, DAMAGE §3.2 — Eckner 2014,
   * Mihalik 2010), and he sees fewer of them once he has read his opponent's
   * timing, range and habits. The share of strikes that arrive unseen starts
   * at `UNFAMILIAR.p0` and decays with the number of strikes this attacker
   * has thrown at him to `UNFAMILIAR.floor`. This is why knockdowns per
   * landed power head strike fall from 5.3 % in round 1 to 1.5 % in round 3
   * in the data, which a force- or damage-only model cannot produce (both
   * push the other way). The per-strike choice is a deterministic hash of
   * the contact, so it takes no draw from the bout stream (09 §2.7).
   */
  function unseenByUnfamiliarity(
    w: World, actor: FighterWorldState, target: FighterWorldState, subMs: number,
  ): boolean {
    const key = actor.id * 64 + target.id;
    const n = exposure.get(key) ?? 0;
    exposure.set(key, n + 1);
    // A less skilled defender reads less and sees fewer punches coming at any
    // point of the fight (x3 at T0 .. x0.7 at T5): the finishing rate of
    // regional bouts (09 §7.3 T7) comes from exactly this.
    const tierMult = Math.max(0.7, 1 + UNFAMILIAR.tierSlope * (4 - target.runtime.strikingTier));
    const p = tierMult
      * (UNFAMILIAR.floor + (UNFAMILIAR.p0 - UNFAMILIAR.floor) * Math.exp(-n / UNFAMILIAR.tau));
    let h = 2166136261 ^ w.tick;
    h = Math.imul(h ^ subMs, 16777619);
    h = Math.imul(h ^ (actor.id + 1), 16777619);
    h = Math.imul(h ^ (target.id + 7), 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296 < p;
  }

  /** Fouls raised in P4 this tick, handed to the referee in P6 (QA-6). */
  let pendingFouls: FoulOccurrence[] = [];

  /** The §06 foul an illegal strike is (the catalogue's closest entry). */
  function foulIdFor(w: World, spec: TechniqueSpec, targetDown: boolean): FoulId {
    const fam = w.ruleset.family;
    if (targetDown && (fam === 'boxing' || fam === 'kickboxing' || fam === 'muay_thai')) return 'hit_downed';
    if (spec.weapon === 'elbow' || spec.weapon === 'elbow_point') return 'elbow_illegal';
    if (targetDown && (spec.weapon === 'knee' || isKickWeapon(spec))) return 'grounded_head_kick_knee';
    return 'disregard';
  }

  function isKickWeapon(spec: TechniqueSpec): boolean {
    return spec.weapon === 'shin' || spec.weapon === 'instep' || spec.weapon === 'ball_of_foot'
      || spec.weapon === 'heel';
  }

  function resolveStrikeContact(
    w: World, contact: ScheduledContact, p: StrikePayload,
    actor: FighterWorldState, target: FighterWorldState,
  ): void {
    const spec = technique(p.technique);

    // --- preconditions, re-checked at contact time (09 §2.3 rule 3) --------
    if (!actorAble(w, actor)) {
      actor.actionResult = 'interrupted';
      missedStrike(w, contact, p, actor, target, 'interrupted');
      return;
    }
    if (target.out || !actorAble(w, target) === false && target.out) {
      missedStrike(w, contact, p, actor, target, 'target out');
      return;
    }
    const posture = postureOf(w, actor);
    const band = bandFor(w.distance(actor, target), reachOf(actor));
    if (posture === 'distance' && !inRange(spec, band)) {
      missedStrike(w, contact, p, actor, target, 'out of range');
      return;
    }
    if (p.node !== null && actor.position !== p.node && posture !== 'distance') {
      missedStrike(w, contact, p, actor, target, 'position changed');
      return;
    }
    const onFloor = target.posture === 'ground' || target.posture === 'down';
    const defenderGrounded = isGrounded(
      onFloor
        ? { feet: 0, hands: 2, knees: 1, otherBodyPart: true }
        : STANDING_CONTACT,
      w.ruleset.groundedDef,
    );
    const legality = isLegal(
      rulesWeapon(spec),
      rulesTarget(p.region, defenderGrounded),
      rulesPhase(posture),
      {
        targetGrounded: defenderGrounded,
        attackerGrounded: actor.posture === 'ground' || actor.posture === 'down',
      },
      w.ruleset,
    );
    if (legality !== 'legal') {
      // I6: an illegal technique is emitted as a foul, never silently dropped.
      actor.actionResult = 'missed';
      const foulId = foulIdFor(w, spec, onFloor);
      emit(w, {
        ...base(w, 'foul', actor.id, target.id,
          `${actor.runtime.def.short} lands an illegal ${spec.name}`, contact.subMs),
        kind: 'foul',
        detail: { foul: foulId, reason: `${rulesWeapon(spec)} to ${p.region}`, detected: true },
      });
      // QA-6 (Phase 9): the foul goes to the referee's ladder (warning,
      // deduction, DQ) in P6 of this tick. Nothing ever reached it before.
      pendingFouls.push({
        foul: foulId, fouler: actor.id, victim: target.id,
        intent: legality === 'foul_hard' ? 'intentional' : 'accidental',
        detected: true, effect: 'minor', announced: true,
      });
      return;
    }

    // --- Realism pass: chapter 02's tactical layer at contact ----------------
    // Range fit and reach (§2.1.1, §2.8), stance (§2.7), combination flow
    // (§2.3.1), counters into the target's recovery (§2.5.1) and feint bites
    // (§2.3.4). Draw-free; see `striking/tactics.ts`.
    const profile = reachOf(actor);
    const tac = tacticalTerms({
      spec,
      launchMs: contact.commitMs,
      contactMs: contact.tMs,
      attackerId: actor.id,
      targetId: target.id,
      attacker: actor.runtime,
      defender: target.runtime,
      attackerState: actor.tactic,
      defenderState: target.tactic,
      distanceM: w.distance(actor, target),
      band,
      profile,
      limits: bandLimits(profile),
      atDistance: posture === 'distance',
      region: regionLabel(p.region),
      attackerStance: actor.stance,
      defenderStance: target.stance,
      classScale: reachClassScale(actor.runtime.body.weightClass),
    });

    // --- 02 resolution: exactly DRAWS_PER_STRIKE draws ---------------------
    const force: ForceContext = {
      tier: actor.runtime.strikingTier,
      massKg: actor.runtime.body.fightNightKg,
      explosiveness: actor.runtime.effective.explosiveness,
      strength: actor.runtime.effective.strength,
      weaponSpeedAttr: spec.weapon === 'fist' ? actor.runtime.effective.handSpeed : actor.runtime.effective.kickSpeed,
      fatigue: actor.energy.f,
      commit: commitModeOf(w, actor, target, spec),
      rangeFitMult: (p.short ? SHORT_STRIKE_MODEL.forceMult : 1) * gnpDamageMult(posture, actor.position, spec),
      counterForceMult: tac.forceMult,
      // Realism pass: a man walking onto a punch adds his own speed to it
      // (02 §2.6.4 closing speed, BOX x1.25/x1.5; 05 kClosing). The field
      // existed on both contracts and nothing filled it.
      closingSpeedMs: posture === 'distance' ? closingSpeed(target, actor) : 0,
      female: actor.runtime.body.sex === 'female',
    };
    // Realism pass: the skill that lands a strike depends on where it is
    // thrown. At distance it is striking; in a tie-up it is clinch striking
    // (03 §2.1.3 `mma.clinch_strike`) against the other man's clinch craft;
    // from the top of a ground position it is ground-and-pound (`mma.gnp`)
    // against his guard and frames. Until this pass every strike read the
    // striking mean, so MMA-integration skill decided nothing.
    const [attackerSkill, defenderSkill] = strikeSkills(actor, target, posture);
    const g = guardOf(target, w.nowMs);
    const targetMidAction = target.action !== null
      && w.nowMs < target.actionCommitMs + target.actionTotalMs;
    // A spinning technique arrives with the attacker's back turned: 02 §2.2.4.
    const seen = !spec.flags.includes('spinning') && !unseenByUnfamiliarity(w, actor, target, contact.subMs);
    const input: StrikeResolveInput = {
      tick: w.tick,
      subTickMs: contact.subMs,
      attacker: actor.id,
      target: target.id,
      spec,
      region: p.region,
      seen,
      force,
      gloveType: actor.damage.profile.gloveType,
      posture,
      attackerState: { rocked: actor.damage.has(S.rocked), fatigue: actor.energy.f },
      // 05 §2.2.2 reads `targetState` for `kGround` (x0.7 on the mat), for
      // `kRelaxed` (x1.2 when the defender is mid-action or blowing) and for
      // the braced absorb. Leaving it unset handed 05 the all-false default on
      // every impact, so ground-and-pound was scored as if the defender were
      // standing and `kRelaxed` never fired.
      // it holds the last technique id long after the commitment ended — so
      // the unqualified test made every fighter permanently relaxed from his
      // first punch onward, and most of all the busy ones (the better
      // strikers). The commitment window is what 05 means.
      targetState: {
        midAction: targetMidAction,
        mouthOpen: refereeRuntime(w).obs[target.id]?.mouthOpen ?? false,
        guardHand: g.id === 'guard.low_hands' ? 'away' : 'up',
        // 01 `beh.gen.read`: a fighter who read the strike, is not himself
        // committed to something, and had no reactive answer that fitted the
        // window still has time for the one thing left — setting his neck and
        // shoulders behind it. A fighter who *did* commit to a slip or a parry
        // and had it beaten is caught mid-movement, which is the opposite of
        // braced; a fighter mid-punch is the case 05 already states from the
        // other side with `kRelaxed`.
        //
        // The broader reading (brace on any read that is not mid-punch) was
        // measured too: it moves the headline batch to 12.8 min at 0.21
        // knockdowns per 15 min, which trades the duration and knockdown
        // targets for a finish share closer to 09's. See PHASE4_FINDINGS
        // "Phase 5".
        braced: !targetMidAction
          && target.defence === 'def.neutral'
          && w.nowMs < target.tells.readUntilMs,
        grounded: onFloor,
      },
      guard: g,
      // A defender reacting to a feint has spent his reactive defence and his
      // guard is where the feint sent it (§2.3.4).
      defence: tac.voidDefence ? null : shiftedDefence(
        scaledDefence(resolvedDefenceOf(target, spec, attackerSkill, defenderSkill), positionalDefenceMult(posture)),
        tac.defenceLogit,
      ),
      passiveBlockP: passiveBlockP(g, spec, defenderSkill) * positionalDefenceMult(posture)
        * (tac.voidDefence ? FEINT_BITE_GUARD_MULT : 1),
      counter: tac.counter,
      // Realism pass: 02 §2.6.3's placement terms were never passed, so a
      // precise puncher landed flush exactly as often as a sloppy one and head
      // movement never turned a flush shot into a glancing one.
      placement: {
        attackerPrecision: precisionOf(actor.runtime, spec),
        defenderHeadMovement: p.region === 'head' ? strikingCraft(target.runtime).headMovement : 50,
        defenderRocked: target.damage.has(S.rocked),
      },
      arrivalLogit: arrivalLogit(spec, {
        attackerSkill,
        defenderSkill,
        attackerFatigue: actor.energy.f,
        defenderFatigue: target.energy.f,
        defenderRocked: target.damage.has(S.rocked),
        defenderStunned: target.damage.has(S.stunned),
        defenderBodyHurt: target.damage.has(S.bodyHurt),
        attackerRocked: actor.damage.has(S.rocked),
        defenderMobility: target.damage.caps.movement,
        // 01 §3 tells, written by 07 at decision time: `beh.gen.turn_away`
        // (T0 turns his back, absorb 0 for the follow-ups) and
        // `beh.gen.eyes_close` (T0 0.70 / T1 0.30, "readP = 0 for the
        // exchange"). Both are defender-side and neither reached 02 before.
        defenderBackTurned: w.nowMs < target.tells.backTurnedUntilMs,
        defenderVisionBlocked: w.nowMs < target.tells.eyesShutUntilMs,
        guardLogit: guardLogit(g, spec),
      }, 2.0 * STRIKING_SKILL_GAIN) + (p.short ? SHORT_STRIKE_MODEL.arrivalLogit : 0) + positionalArrivalLogit(posture)
        + (TARGET_ARRIVAL[p.region] ?? 0) + (POSITION_TARGET_ARRIVAL[statPosition(posture)][p.region] ?? 0)
        + tac.arrivalLogit + TACTICAL_ARRIVAL_OFFSET
        + ABSOLUTE_DEFENCE.k * (ABSOLUTE_DEFENCE.ref - defenderSkill) / 100,
    };
    const res = resolveStrike(w.rng, input);
    if (res.draws !== DRAWS_PER_STRIKE) {
      throw new Error(`resolveStrike took ${res.draws} draws, expected ${DRAWS_PER_STRIKE}`);
    }

    actor.actionResult = res.result === 'landed' ? 'landed'
      : res.result === 'blocked' ? 'blocked'
        : res.result === 'evaded' ? 'evaded' : 'missed';

    // Realism pass: the tactical memory. The attacker is now exposed for his
    // strike's counter window (§2.5.1); a defence that worked is remembered
    // for the best-counter lookup; the strike is the previous beat of any
    // combination that follows.
    const contactEnd = contact.tMs + Math.round(spec.activeMs);
    openExposure(actor.tactic, spec, res.result, actor.runtime.strikingTier, contactEnd);
    if (res.defence && res.result !== 'landed' && res.result !== 'missed') {
      noteDefence(target.tactic, res.defence, contact.tMs);
    }
    notePrevStrike(actor.tactic, spec, contact.commitMs, target.id, res.result, regionLabel(p.region));
    // A straight, a teep or a front body kick that meets a man walking in
    // stops him and moves him back: the jab and the teep are range tools,
    // not just points (02 §2.1.4, MUAY_THAI teep; BOX §4 "the jab keeps
    // distance"). Only against an advancing target, only at distance.
    if (posture === 'distance' && (res.result === 'landed' || res.result === 'blocked' || res.result === 'checked')) {
      stopTheEntry(w, actor, target, spec);
    }

    // 05 §2.7: an evasion, a check or a catch is intelligent defence; a glove
    // block is a static cover and deliberately is not.
    if (res.result === 'evaded' || res.result === 'checked' || res.result === 'caught') {
      target.damage.noteAnswer();
    } else if (res.result === 'blocked') {
      target.damage.noteStaticCover(w.params.get('core.dtMs') / 1000);
    }

    // --- 05: apply the impact, always ten draws when there is one ----------
    let damageDetail: { head?: number; body?: number; legs?: number } | undefined;
    if (res.impact) {
      const before = poolsOf(target);
      const result = target.damage.applyImpact(res.impact, w.rng, {
        round: w.round,
        attackerMassKg: actor.runtime.body.fightNightKg,
      });
      const after = poolsOf(target);
      damageDetail = {
        head: after.head - before.head,
        body: after.body - before.body,
        legs: after.legs - before.legs,
      };
      target.lastStruckBy = actor.id;
      pushDamageEvents(w, result.events, contact.subMs, actor.id);
      if (result.attackerInjury) {
        pushDamageEvents(w, actor.damage.applySelfInjury(result.attackerInjury), contact.subMs);
      }
      // 05 has already emitted the `knockdown` event for a roll outcome
      // (`emitKnockdown`) and `pushDamageEvents` has already applied the
      // posture, the queue cancel and the engagement exit. Emitting a second
      // one here double-counted every §2.4 roll knockdown in `stats.ts` and in
      // 06's judging.
      target.lastStruckTick = w.tick;
      target.unansweredStrikes++;
      actor.unansweredStrikes = 0;
      if (target.downTicks > 0) noteOutcome(target.id, 'knockdown', spec.id);
    }

    if (res.statLanded) {
      actor.totalLanded++;
      // QA2 #6: the strike is significant or not as it was *thrown*.
      if (p.sig) actor.sigLanded++;
    }

    // Feed the outcome back to chapter 07's ledger. Only P4 knows whether a
    // committed action actually landed, and the opponent model is what turns
    // "this keeps hitting me" into an adjustment, so without this the ledger
    // would hold attempts only and adaptation would never fire.
    noteOutcome(actor.id, res.result === 'landed' ? 'landed' : null, spec.id);
    if (res.result === 'landed') {
      const heavy = (res.forceN ?? 0) >= HEAVY_IMPACT_N;
      noteOutcome(target.id, heavy ? 'absorbedHeavy' : 'absorbed', spec.id);
    }

    const e: StrikeEvent = {
      ...base(w, 'strike', actor.id, target.id,
        `${actor.runtime.def.short} ${res.result} a ${spec.name}`, contact.subMs),
      kind: 'strike',
      detail: {
        technique: spec.id,
        result: res.result,
        target: regionLabel(p.region),
        subLocation: res.subLocation ?? undefined,
        forceN: res.forceN,
        damage: damageDetail,
        defence: res.defence ?? undefined,
        unseen: !seen,
        ...(tac.counter ? { counter: true } : {}),
        ...(p.short ? { short: true } : {}),
        sig: p.sig,
        pos: p.pos,
      },
    };
    emit(w, e);
  }

  function poolsOf(f: FighterWorldState): { head: number; body: number; legs: number } {
    const s = f.damage.snapshotFields();
    return { head: s.damage.head, body: s.damage.body, legs: s.damage.legs };
  }

  function resolveGrappleContact(
    w: World, contact: ScheduledContact, p: GrapplePayload,
    actor: FighterWorldState, target: FighterWorldState,
  ): void {
    const edge = grapplingEdge(p.edge);
    const engagement = p.engagementId === null ? null : w.engagements.byIdOrNull(p.engagementId);
    if (engagement) w.engagements.clearInflight(engagement.id);

    const stuffed = (why: string): void => {
      actor.actionResult = 'stuffed';
      const ev: GrappleEvent = {
        ...base(w, edgeEventKind(edge), actor.id, target.id,
          `${actor.runtime.def.short}'s ${edge.name} is stopped (${why})`, contact.subMs),
        kind: edgeEventKind(edge),
        detail: { edge: edge.id, from: p.node ?? actor.position, result: 'stuffed', reason: why },
      };
      emit(w, ev);
    };

    if (!actorAble(w, actor) || target.out) {
      stuffed('interrupted');
      return;
    }
    if (p.node !== null && actor.position !== p.node) {
      stuffed('position changed');
      return;
    }
    if (!edge.from.includes(actor.position)) {
      stuffed('node changed');
      return;
    }
    // Phase 9 (I3): an edge started on a free opponent who has since been
    // tied up by a third fighter (two men following the same knockdown down)
    // no longer has him to take; joining would silently strip the first pair.
    if (p.engagementId === null) {
      const held = w.engagements.of(target.id);
      if (held !== null && held.a !== actor.id && held.b !== actor.id) {
        stuffed('target engaged');
        return;
      }
    }

    const kuzushi: Kuzushi = engagement?.kuzushi ?? { dir: 0, mag: 0 };
    const gw: GrappleWorld = {
      params: w.params,
      fromNode: actor.position,
      stage: p.stage,
      cage: engagement?.cage ?? false,
      cageRadiusM: w.arena.apothemM ?? w.arena.halfWidthM ?? 4.5,
      underhookOwner: engagement?.underhookOwner ?? null,
      actorSlot: w.engagements.slotOf(actor.id) ?? 'a',
      posture: engagement?.posture ?? 'chest',
      kuzushi,
      setup: setupOpen(w, actor),
      telegraphed: false,
      rangeM: w.distance(actor, target),
      round: w.round,
      bloodied: false,
      chain: null,
      gripDominance: 'neutral',
      sideMatch: 'none',
      attemptIndex: 0,
      ...(tdChainEdge(edge, actor.position, w.engagements.slotOf(actor.id))
        ? { extraLogit: { code: 'tdMMA', logit: w.params.get('grap.tdChainLogit') } }
        : getUpEdge(edge, actor.position, w.engagements.slotOf(actor.id))
          ? { extraLogit: { code: 'getUpMMA', logit: w.params.get('grap.getUpLogit') } } : {}),
    };
    const outcome = resolveEdge(edge, grappleActorOf(w, actor), grappleActorOf(w, target), gw, w.rng);
    if (outcome.draws !== GRAPPLE_EDGE_DRAWS) {
      throw new Error(`resolveEdge took ${outcome.draws} draws, expected ${GRAPPLE_EDGE_DRAWS}`);
    }
    applyEdgeOutcome(w, contact, edge, outcome, actor, target, engagement?.id ?? null);
  }

  function edgeEventKind(edge: GrapplingEdge): GrappleEvent['kind'] {
    switch (edge.kind) {
      case 'entry':
      case 'capture':
      case 'throw':
        return 'takedown';
      case 'clinch':
        return 'clinch';
      case 'escape':
      case 'getup':
        return 'standUp';
      case 'scramble':
        return 'scramble';
      case 'sweep':
        return 'reversal';
      default:
        return 'positionChange';
    }
  }

  function applyEdgeOutcome(
    w: World, contact: ScheduledContact, edge: GrapplingEdge, outcome: EdgeOutcome,
    actor: FighterWorldState, target: FighterWorldState, engagementId: number | null,
  ): void {
    // §2.3 A: "Grants SETUP to the next shot for grap.setupWindowMs". A setup
    // edge changes no node, so this state is the entire outcome of one.
    if (edge.kind === 'setup' && outcome.success) openSetupWindow(w, actor, w.nowMs);
    const from = actor.position;
    const to: PositionId = outcome.toNode;
    actor.actionResult = outcome.success ? 'success' : 'stuffed';

    const kind = kindForNode(to);
    if (kind === null) {
      // A free standing node: the engagement dissolves.
      if (engagementId !== null) w.engagements.dissolve(engagementId, w.tick);
      for (const f of [actor, target]) {
        // Phase 9 (I2): in a multi-fighter bout the target of a free-standing
        // edge (a level change, a feint step) may be locked up with someone
        // else; that engagement is not this edge's to dissolve or overwrite.
        if (w.engagements.of(f.id) !== null) continue;
        f.partnerId = null;
        f.posture = 'standing';
        f.position = to;
        // Phase 9 (I5): a hold does not survive the pair coming apart.
        f.sub = { technique: null, stage: 0, progress: 0, lockedAtMs: null };
      }
    } else if (engagementId !== null) {
      w.engagements.transition(engagementId, to, w.tick, { swap: outcome.swap });
      syncEngagement(w, actor);
      syncEngagement(w, target);
    } else {
      // Opening a new engagement: the pair is pulled together so I4 holds —
      // along the line they approached each other on. (It used to lay every
      // new pair along the world X axis, so a clinch or takedown teleported
      // both bodies sideways and flipped the interaction root by up to 90°.)
      const mx = (actor.x + target.x) / 2;
      const mz = (actor.z + target.z) / 2;
      let ux = target.x - actor.x;
      let uz = target.z - actor.z;
      const len = Math.hypot(ux, uz);
      if (len > 1e-6) { ux /= len; uz /= len; } else { ux = Math.sin(actor.facing); uz = Math.cos(actor.facing); }
      const gap = 0.15;
      actor.x = mx - ux * gap / 2;
      actor.z = mz - uz * gap / 2;
      target.x = mx + ux * gap / 2;
      target.z = mz + uz * gap / 2;
      actor.facing = Math.atan2(ux, uz);
      target.facing = Math.atan2(-ux, -uz);
      actor.vx = actor.vz = target.vx = target.vz = 0;
      const e = w.engagements.join(
        outcome.swap ? target.id : actor.id, outcome.swap ? actor.id : target.id, to, w.tick,
      );
      syncEngagement(w, actor);
      syncEngagement(w, target);
      emit(w, {
        ...base(w, 'engagementJoin', actor.id, target.id,
          `${actor.runtime.def.short} ties up`, contact.subMs),
        kind: 'engagementJoin',
        detail: { edge: edge.id, from, to, result: 'success', a: e.a },
      } as GrappleEvent);
      void e;
    }

    if (outcome.success && (edge.kind === 'entry' || edge.kind === 'capture' || edge.kind === 'throw')) {
      actor.takedownsLanded++;
    }
    if (engagementId !== null) w.engagements.markWork(engagementId, true);
    const after = w.engagements.of(actor.id);
    // Phase 9: a `reversal` event is a reversal — the bottom man came out on
    // top. A failed sweep, or a sweep-table row that only changes guards, is
    // a position change (it used to be logged, commentated and replayed as a
    // reversal every time it was attempted).
    let evKind = edgeEventKind(edge);
    if (evKind === 'reversal' && !(outcome.success && after !== null && after.a === actor.id
      && roleFor(after.node, 'a') === 'top')) {
      evKind = 'positionChange';
    }

    const ev: GrappleEvent = {
      ...base(w, evKind, actor.id, target.id,
        `${actor.runtime.def.short} ${outcome.success ? 'completes' : 'fails'} ${edge.name}`,
        contact.subMs),
      kind: evKind,
      detail: {
        edge: edge.id,
        from,
        to,
        result: outcome.success ? 'success' : outcome.counter.fired ? 'countered' : 'stuffed',
        cage: after?.cage ?? false,
        ...(after && after.b >= 0 ? { a: after.a } : {}),
      },
    };
    emit(w, ev);
  }

  /**
   * QA-9 / QA-10 (Phase 9): a submission ends the bout only when the tapping
   * fighter's side has nobody else standing — the same multi-opponent rule the
   * referee path applies. Otherwise the victim is out (already marked by the
   * caller), leaves the engagement, and the bout goes on. A team win carries
   * `winner: 'none'` and the team, as a team KO does.
   */
  function submissionStops(
    w: World, actor: FighterWorldState, target: FighterWorldState, subId: string,
  ): void {
    w.engagements.leave(target.id, w.tick);
    w.scheduler.queue.cancelFor(target.id, 'out');
    actor.sub = { technique: null, stage: 0, progress: 0, lockedAtMs: null };
    syncEngagement(w, actor);
    const teams = w.liveTeams();
    if (w.fighters.length > 2 && teams.length > 1) {
      emit(w, {
        ...base(w, 'fighterOut', target.id, -1, `${target.runtime.def.short} is out: submission`),
        kind: 'fighterOut',
        detail: { reason: `submission:${subId}`, method: 'submission' },
      });
      return;
    }
    finishBout(w, {
      winner: w.fighters.length <= 2 ? actor.id : 'none', winningTeam: actor.team, method: 'submission',
      detail: subId, round: w.round, timeSeconds: w.roundTick * dtMs / 1000,
      totalSeconds: w.nowMs / 1000, scorecards: [], judgeTotals: [],
    });
  }

  /** When the current stage of each fighter's hold began (04 §2.4.4 dMax). */
  const subStageSince = new Map<number, { tech: string; stage: string; sinceMs: number }>();

  function resolveSubmissionContact(
    w: World, contact: ScheduledContact, p: SubmissionPayload,
    actor: FighterWorldState, target: FighterWorldState,
  ): void {
    const spec = submission(p.technique);
    const abandon = (why: string): void => {
      actor.actionResult = 'stuffed';
      actor.sub = { technique: null, stage: 0, progress: 0, lockedAtMs: null };
      emit(w, {
        ...base(w, 'submissionStage', actor.id, target.id,
          `${actor.runtime.def.short} lets the ${spec.name} go (${why})`, contact.subMs),
        kind: 'submissionStage',
        detail: { technique: spec.id, stage: 0, progress: 0, defence: why },
      });
    };
    if (!actorAble(w, actor) || target.out) {
      abandon('interrupted');
      return;
    }
    if (p.node !== null && actor.position !== p.node) {
      abandon('position changed');
      return;
    }
    if (!w.engagements.isEngaged(actor.id)) {
      abandon('separated');
      return;
    }

    const stageSpec = spec.stages.find((s) => s.stage === p.stage);
    if (!stageSpec || stageSpec.baseP === null || stageSpec.dMeanMs === null) {
      abandon('stage unavailable');
      return;
    }
    const ctx: WindowContext = {
      spec,
      stage: p.stage,
      attacker: subFighterOf(actor),
      defender: subFighterOf(target),
      env: baselineEnvironment({
        fightTimeS: w.nowMs / 1000,
        glovesMma: w.ruleset.gloves.oz <= 6,
        strikesLegal: w.ruleset.ground.strikesAllowed,
        mmaBout: w.ruleset.family === 'mma',
        nearFence: w.engagements.of(actor.id)?.cage ?? false,
        ctrl: positionNode(actor.position).controlRating,
      }),
      stageP: stageSpec.baseP,
      dMeanMs: stageSpec.dMeanMs,
      option: stageSpec.defences[0] ?? 'standard',
      chained: false,
    };
    const res = resolveWindow(w.rng, ctx);
    // 04 §2.4.4: an attack stalled past dMax (= dMaxFactor x the stage's mean
    // duration) without advancing is let go. Phase 9: with the windows now
    // resolved to the end, a hold could otherwise be worked indefinitely, and
    // every stage became a matter of when, not whether — half of all
    // locked-in attempts finished against a real quarter (FIGHT_DATA §3 #73).
    const held = subStageSince.get(actor.id);
    if (!held || held.tech !== spec.id || held.stage !== p.stage) {
      subStageSince.set(actor.id, { tech: spec.id, stage: p.stage, sinceMs: w.nowMs });
    } else if (res.outcome === 'hold'
      && w.nowMs - held.sinceMs > STAGE_PARAMS.dMaxFactor * stageSpec.dMeanMs) {
      subStageSince.delete(actor.id);
      abandon('stalled');
      return;
    }

    const stageNow: StageIndex = (p.stage === 'entry' ? 1 : p.stage === 'secure' ? 2 : 3) as StageIndex;
    switch (res.outcome) {
      case 'advance': {
        const next = Math.min(4, stageNow + 1) as StageIndex;
        actor.sub = {
          technique: spec.id, stage: next, progress: next / 4,
          lockedAtMs: next === 4 ? w.nowMs : actor.sub.lockedAtMs,
        };
        actor.actionResult = 'success';
        emit(w, {
          ...base(w, 'submissionStage', actor.id, target.id,
            `${actor.runtime.def.short} advances the ${spec.name}`, contact.subMs),
          kind: 'submissionStage',
          detail: { technique: spec.id, stage: next, progress: next / 4, from: actor.position },
        });
        if (next === 4) {
          // 04 §2.6: the lock is on. The tap is resolved on the same contact so
          // the bout cannot hang waiting on a policy that never re-commits.
          target.out = true;
          target.outReason = `submission:${spec.id}`;
          emit(w, {
            ...base(w, 'submissionFinish', actor.id, target.id,
              `${target.runtime.def.short} taps to the ${spec.name}`, contact.subMs),
            kind: 'submissionFinish',
            detail: { technique: spec.id, type: 'tap', lockedSeconds: 0 },
          });
          submissionStops(w, actor, target, spec.id);
        }
        break;
      }
      case 'tap': {
        target.out = true;
        target.outReason = `submission:${spec.id}`;
        emit(w, {
          ...base(w, 'submissionFinish', actor.id, target.id,
            `${target.runtime.def.short} taps`, contact.subMs),
          kind: 'submissionFinish',
          detail: { technique: spec.id, type: 'tap', lockedSeconds: 0 },
        });
        submissionStops(w, actor, target, spec.id);
        break;
      }
      case 'escape':
      case 'release':
      case 'counterAttack':
        abandon(res.outcome);
        break;
      case 'regress':
      case 'regressToSetup': {
        const next = Math.max(0, stageNow - 1) as StageIndex;
        actor.sub = { technique: spec.id, stage: next, progress: next / 4, lockedAtMs: null };
        actor.actionResult = 'stuffed';
        emit(w, {
          ...base(w, 'submissionStage', actor.id, target.id,
            `${target.runtime.def.short} fights out to stage ${next}`, contact.subMs),
          kind: 'submissionStage',
          detail: { technique: spec.id, stage: next, progress: next / 4, defence: res.outcome },
        });
        break;
      }
      default:
        actor.actionResult = 'none';
        emit(w, {
          ...base(w, 'submissionStage', actor.id, target.id,
            `${actor.runtime.def.short} holds the ${spec.name}`, contact.subMs),
          kind: 'submissionStage',
          detail: { technique: spec.id, stage: stageNow, progress: stageNow / 4 },
        });
        break;
    }
  }

  // =========================================================================
  // P6 — referee
  // =========================================================================

  function finishBout(w: World, result: import('./config').BoutResult): void {
    const rt = refereeRuntime(w);
    if (rt.result) return;
    rt.result = result;
    w.finished = true;
    w.phase = 'ended';
    emit(w, {
      ...base(w, 'boutEnd', -1, -1, `${result.method}`),
      kind: 'boutEnd',
      detail: { method: result.method, label: result.detail },
    });
  }

  /** 06's `WinCondition` mapped onto 09's `BoutMethod`. */
  function methodOf(method: string): import('./config').BoutMethod {
    switch (method) {
      case 'ko': return 'ko';
      case 'tko_strikes': case 'tko_count': case 'tko_three_kd': case 'tko_bell':
      case 'tko_outmatched': case 'tko_bodily': return 'tko';
      case 'tko_doctor': return 'tko.doctor';
      case 'tko_corner': return 'tko.corner';
      case 'submission': return 'submission';
      case 'technical_submission': return 'submission.technical';
      case 'dq': case 'hansoku_make': return 'dq';
      case 'no_contest': return 'noContest';
      case 'technical_decision': return 'decision.technical';
      case 'flight': return 'escaped';
      case 'separation': return 'separated';
      case 'incapacitation': return 'allOpponentsStopped';
      default: return 'tko';
    }
  }

  /**
   * 06 §2.3.6b: the referee's stand-up and clinch break. The referee module
   * decides *when*; this applies it — the pair is separated to a neutral
   * standing restart, anything in flight is cancelled and a `disengage` event
   * records it. (Phase 9: the `refereeBreak` event used to be emitted and never
   * applied, so a stalled pair stayed on the mat or on the fence until the
   * bell, the referee repeating "stand them up" every tick.)
   */
  function refereeSeparate(w: World, fighterId: number, reason: string): void {
    const f = w.fighters[fighterId];
    if (!f) return;
    const e = w.engagements.of(f.id);
    if (!e || e.b < 0) return;
    const fa = w.fighters[e.a];
    const fb = w.fighters[e.b];
    if (!fa || !fb) return;
    const from = e.node;
    const edgeId = e.kind === 'clinch' ? 'ref.clinch_break' : 'ref.standup';
    w.engagements.dissolve(e.id, w.tick);
    // A stand-up restarts at a neutral distance; a clinch break steps them
    // apart to about striking range.
    const gap = reason === 'clinch' ? 1.6 : 2.4;
    const mx = (fa.x + fb.x) / 2;
    const mz = (fa.z + fb.z) / 2;
    let ux = fb.x - fa.x;
    let uz = fb.z - fa.z;
    const len = Math.hypot(ux, uz);
    if (len > 1e-6) { ux /= len; uz /= len; } else { ux = Math.sin(fa.facing); uz = Math.cos(fa.facing); }
    const pa = clampToArena(w.arena, mx - ux * gap / 2, mz - uz * gap / 2, 0.35);
    const pb = clampToArena(w.arena, mx + ux * gap / 2, mz + uz * gap / 2, 0.35);
    fa.x = pa.x; fa.z = pa.z;
    fb.x = pb.x; fb.z = pb.z;
    for (const x of [fa, fb]) {
      w.scheduler.queue.cancelFor(x.id, 'referee.break');
      x.action = null;
      x.actionResult = 'none';
      x.sub = { technique: null, stage: 0, progress: 0, lockedAtMs: null };
      x.partnerId = null;
      x.vx = 0;
      x.vz = 0;
      if (x.posture !== 'down' && x.posture !== 'out') x.posture = 'standing';
    }
    fa.facing = Math.atan2(fb.x - fa.x, fb.z - fa.z);
    fb.facing = Math.atan2(fa.x - fb.x, fa.z - fb.z);
    syncEngagement(w, fa);
    syncEngagement(w, fb);
    emit(w, {
      ...base(w, 'disengage', fa.id, fb.id,
        reason === 'clinch' ? 'The referee breaks the clinch' : 'The referee stands them up'),
      kind: 'disengage',
      // No `edge`: the referee's restart is not a fighter's action (the §2.3 L
      // `ref.*` rows are chapter 06's), so the log names it by reason only.
      detail: { from, to: fa.position, result: 'success', reason },
    } as GrappleEvent);
    void edgeId;
  }

  /** Per-fighter state the street ending rules need (QA-2). */
  const streetState = new Map<number, { downSinceS: number | null }>();

  /**
   * QA-2 (Phase 9): the street ruleset has no referee; 06 §2.3.11's
   * `streetTick` — incapacitation, flight, surrender, bystander separation, a
   * weapon, the police — is how a street fight ends, and nothing called it.
   * An incapacitated or fled fighter is out; a hazard ending separates the
   * fight (no winner). Fleeing is a win for the one who gets away (RULES §2.8).
   */
  function streetPhase(w: World): void {
    const rt = refereeRuntime(w);
    const nowS = w.nowMs / 1000;
    const live = w.live();
    const participants = live.map((f) => {
      const o = refCues(rt.obs[f.id]);
      let st = streetState.get(f.id);
      if (!st) {
        st = { downSinceS: null };
        streetState.set(f.id, st);
      }
      const down = f.posture === 'down' || (o.grounded && !o.attemptingToRise);
      if (down) st.downSinceS ??= nowS;
      else st.downSinceS = null;
      return {
        id: f.id,
        side: f.team,
        obs: o,
        mobility: f.damage.caps.movement,
        cannotStandForS: st.downSinceS === null ? 0 : nowS - st.downSinceS,
        wantsToFlee: /flee|flight/.test(f.intentTag),
        wantsToSurrender: false,
      };
    });
    const res = streetTick(participants, w.rng, nowS, dtMs / 1000,
      w.ruleset.street?.bystanders ?? 0);
    let fled: FighterWorldState | null = null;
    for (const ch of res.changes) {
      const f = w.fighters[ch.participant];
      if (!f || f.out) continue;
      f.out = true;
      f.outReason = `street:${ch.state}`;
      f.sub = { technique: null, stage: 0, progress: 0, lockedAtMs: null };
      leaveAndSync(w, f);
      w.scheduler.queue.cancelFor(f.id, 'out');
      if (ch.state === 'fled') fled = f;
      emit(w, {
        ...base(w, 'fighterOut', f.id, -1, `${f.runtime.def.short} is ${ch.state}`),
        kind: 'fighterOut',
        detail: { reason: `street:${ch.state}`, method: ch.state === 'fled' ? 'flight' : 'incapacitation' },
      });
    }
    const meta = {
      round: w.round, timeSeconds: (w.roundTick * dtMs) / 1000, totalSeconds: nowS,
      scorecards: [], judgeTotals: [],
    };
    if (fled !== null) {
      const team = fled.team;
      if (!w.live().some((f) => f.team === team)) {
        finishBout(w, {
          winner: w.fighters.filter((f) => f.team === team).length === 1 ? fled.id : 'none',
          winningTeam: team, method: 'escaped', detail: 'fled', ...meta,
        });
        return;
      }
    }
    if (res.ended) {
      finishBout(w, { winner: 'none', winningTeam: null, method: 'separated', detail: res.ended.reason, ...meta });
    }
  }

  function refereePhase(w: World): void {
    const rt = refereeRuntime(w);
    if (rt.result) {
      w.finished = true;
      return;
    }
    if (!w.ruleset.referee.present || !w.ruleset.stoppage.refereeStops) {
      streetPhase(w);
      if (rt.result) return;
      const teamsLeft = w.liveTeams();
      if (teamsLeft.length <= 1 && !w.finished) {
        const survivors = w.live();
        finishBout(w, {
          winner: survivors.length === 1 && w.fighters.length <= 2 ? survivors[0].id : 'none',
          winningTeam: teamsLeft[0] ?? null,
          method: 'allOpponentsStopped',
          detail: 'no live opponent',
          round: w.round,
          timeSeconds: (w.roundTick * dtMs) / 1000,
          totalSeconds: w.nowMs / 1000,
          scorecards: [],
          judgeTotals: [],
        });
      }
      return;
    }
    const live = w.live();
    const fighters: RefFighterInput[] = live.map((f) => ({
      id: f.id,
      obs: refCues(rt.obs[f.id]),
      tier: f.runtime.mmaTier,
      acuteHeadProxy: f.damage.regions.head.acute,
      fatigue: f.energy.f,
      structuralHead: f.damage.regions.head.structural,
    }));
    const engagements: RefEngagementInput[] = [];
    for (const e of w.engagements.all) {
      if (e.b < 0) continue;
      const k = e.kind === 'clinch' ? 'clinch' : e.kind === 'ground' ? 'ground' : null;
      if (k === null) continue;
      engagements.push({
        kind: k,
        a: e.a,
        b: e.b,
        position: e.node,
        sSinceEffort: e.timers.sinceWork / 1000,
        sInClinch: e.timers.dwell / 1000,
        sSinceStrikeOrTdAttempt: e.timers.sinceStrikeOrTd / 1000,
        atFence: e.cage,
      });
    }
    const outcome = rt.ref.tick({
      tick: w.tick,
      roundT: (w.roundTick * dtMs) / 1000,
      t: w.nowMs / 1000,
      round: w.round,
      dt: dtMs / 1000,
      fighters,
      engagements,
      roundsCompleted: w.round - 1,
      fouls: pendingFouls,
      opponentOf: (id: number): number => {
        const f = w.fighters[id];
        const opp = f ? w.nearestOpponent(f) : null;
        return opp ? opp.id : -1;
      },
    });
    pendingFouls = [];
    for (const e of outcome.events) {
      emit(w, { ...e, tick: w.tick, round: w.round });
      if (e.kind === 'refereeBreak') {
        const reason = (e.detail as { reason?: string } | undefined)?.reason ?? '';
        if (reason === 'stand-up' || reason === 'clinch' || reason === 'restart-neutral') {
          refereeSeparate(w, e.target, reason);
        }
      }
    }
    rt.display = outcome.paused === 'count'
      ? { state: 'counting' }
      : outcome.paused === 'doctor' || outcome.paused === 'foul'
        ? { state: 'separating' }
        : { state: 'watching' };

    if (outcome.ended) {
      const ended = outcome.ended;
      if (ended.loser !== null) {
        const loser = w.fighters[ended.loser];
        if (loser && !loser.out) {
          loser.out = true;
          loser.outReason = ended.reason;
          // Phase 9 (I5): a fighter stopped while holding a submission lets go.
          loser.sub = { technique: null, stage: 0, progress: 0, lockedAtMs: null };
          leaveAndSync(w, loser);
          w.scheduler.queue.cancelFor(loser.id, 'out');
          emit(w, {
            ...base(w, 'fighterOut', ended.loser, -1, `${loser.runtime.def.short} is out: ${ended.reason}`),
            kind: 'fighterOut',
            detail: { reason: ended.reason, method: ended.method },
          });
        }
      }
      // The multi-opponent rule: a two-fighter bout ends at once, a team bout
      // only when a side has nobody left.
      const teams = w.liveTeams();
      if (w.fighters.length <= 2 || teams.length <= 1) {
        const winner = teams.length === 1
          ? (w.fighters.length <= 2 ? ended.winner : 'none')
          : ended.winner;
        finishBout(w, {
          winner: typeof winner === 'number' ? winner : winner,
          winningTeam: typeof ended.winner === 'number' ? w.fighters[ended.winner]?.team ?? null : teams[0] ?? null,
          method: methodOf(ended.method),
          detail: ended.reason,
          round: w.round,
          timeSeconds: (w.roundTick * dtMs) / 1000,
          totalSeconds: w.nowMs / 1000,
          scorecards: [],
          judgeTotals: [],
        });
        return;
      }
      // QA-1: one fighter is out, the bout goes on; the referee resumes.
      rt.ref.resumeAfterStoppage(ended.loser);
    }

    // A side with no live fighter has lost, whatever the referee said.
    const teams = w.liveTeams();
    if (teams.length <= 1 && !w.finished) {
      const survivors = w.live();
      finishBout(w, {
        winner: survivors.length === 1 ? survivors[0].id : teams.length === 1 ? 'none' : 'draw',
        winningTeam: teams[0] ?? null,
        method: w.fighters.length > 2 ? 'allOpponentsStopped' : 'tko',
        detail: 'no live opponent',
        round: w.round,
        timeSeconds: (w.roundTick * dtMs) / 1000,
        totalSeconds: w.nowMs / 1000,
        scorecards: [],
        judgeTotals: [],
      });
    }
  }

  // =========================================================================
  // P7 — judges
  // =========================================================================

  function foldEvents(w: World): void {
    const jr = judgeRuntime(w);
    const ledgers = jr.ledgers;
    for (let i = jr.cursor; i < w.events.length; i++) {
      const e = w.events[i];
      const a = ledgers[e.actor];
      const d = ledgers[e.target];
      if (e.kind === 'strike' && a) {
        const det = e.detail;
        // The judges see significance the way the stats do (09 §4.1): a short
        // clinch or ground strike, or a punch off the back, is volume, not a
        // significant strike (Phase 9; they used to be scored as sig).
        const nonSig = det.short === true || det.technique === 'tech.bottom_punch'
          || (det.technique.startsWith('tech.jab') && w.fighters[e.actor]?.posture !== 'standing');
        if (nonSig) {
          if (isStatLanded(det.result)) a.nonSigLanded++;
        } else {
          a.sigAttempted++;
          if (isStatLanded(det.result)) {
            if (det.target === 'head') a.sigHead++;
            else if (det.target === 'body') a.sigBody++;
            else a.sigLeg++;
          }
        }
      } else if (e.kind === 'knockdown' && a) {
        a.kd++;
        a.hurtEvents++;
      } else if (isGrappleEventKind(e.kind) && a) {
        // One definition with the §4.1 stats (grappling/takedowns.ts). The
        // judges used to score every `takedown`-kind event — clinch entries
        // and guard pulls included — as a takedown, and every sweep attempt
        // as a reversal.
        const g = e as GrappleEvent;
        const det = g.detail;
        const success = det.result === 'success';
        if (det.reason !== 'contested' && g.kind !== 'engagementJoin') {
          if (isTakedownLanding(det.from, det.to, success, g.actor, det.a)) a.tdLanded++;
          else if (!success && isTakedownAttempt(det.edge, det.from)) a.tdMissed++;
          if (isReversal(det.edge, det.from, det.to, success, g.actor, det.a)) a.reversals++;
        }
      } else if (e.kind === 'submissionStage' && a) {
        if (e.detail.stage >= 4) a.subLocked++;
        else if (e.detail.stage >= 2) a.subEarly++;
      } else if (e.kind === 'stateChange' && d && e.detail.on) {
        if (e.detail.state === S.rocked) {
          const opp = w.fighters[e.actor];
          const other = opp ? w.nearestOpponent(opp) : null;
          if (other && ledgers[other.id]) ledgers[other.id].rockedCaused++;
        }
      }
    }
    jr.cursor = w.events.length;
  }

  function judges(w: World, roundEnded: boolean): void {
    const jr = judgeRuntime(w);
    foldEvents(w);
    const dtS = dtMs / 1000;
    for (const f of w.fighters) {
      const led = jr.ledgers[f.id];
      if (!led) continue;
      led.roundSecondsElapsed += dtS;
      if (f.out) continue;
      const role = w.engagements.roleOf(f.id);
      if (role === 'top' || role === 'attacker') led.controlOffenceS += dtS;
      if (Math.hypot(f.vx, f.vz) > 0.05) led.aggressionS += dtS;
    }

    if (!roundEnded) return;
    const panel = jr.panel;
    jr.history.push(jr.ledgers);
    if (panel && jr.ledgers.length >= 2) {
      const rt = refereeRuntime(w);
      const cards = scoreRound(
        panel,
        [jr.ledgers[0], jr.ledgers[1]],
        {
          round: w.round,
          roundS: clock.roundSeconds,
          deductions: [rt.ref.deductions(0, w.round), rt.ref.deductions(1, w.round)],
        },
        w.rng,
      );
      jr.scored++;
      emit(w, {
        ...base(w, 'scorecardRound', -1, -1, `Round ${w.round} scored`),
        kind: 'scorecardRound',
        detail: { cards },
      });
    }
    jr.ledgers = w.fighters.map(() => emptyLedger());
    emit(w, {
      ...base(w, 'roundEnd', -1, -1, `End of round ${w.round}`),
      kind: 'roundEnd',
      detail: { label: `r${w.round}` },
    });
  }

  /** Called by the recorder once the loop stops, to turn cards into a result. */
  function decideIfUnfinished(w: World): void {
    const rt = refereeRuntime(w);
    if (rt.result) return;
    const jr = judgeRuntime(w);
    if (jr.panel && jr.scored > 0) {
      const result = decide(jr.panel, {
        round: w.round,
        timeSeconds: (w.roundTick * dtMs) / 1000,
        totalSeconds: w.nowMs / 1000,
      });
      finishBout(w, result);
      emit(w, {
        ...base(w, 'decision', -1, -1, `${result.method}`),
        kind: 'decision',
        detail: { method: result.method, winner: result.winner === 'none' ? 'draw' : result.winner },
      });
      return;
    }
    const meta = {
      round: w.round,
      timeSeconds: (w.roundTick * dtMs) / 1000,
      totalSeconds: w.nowMs / 1000,
    };
    // QA-3 (Phase 9): an untimed bout (street, crowd) that reaches its cap is
    // `separated` — 09 §3.1's indecisive ending — and nobody wins it. It used
    // to go to the side with more fighters standing.
    if (clock.untimed) {
      finishBout(w, {
        winner: 'none', winningTeam: null, method: 'separated', detail: 'separated',
        ...meta, scorecards: [], judgeTotals: [],
      });
      return;
    }
    // QA-11: a two-fighter bout with no judges (sub-only) that ends without a
    // submission is a draw (EBI escape-time overtime is not modelled).
    if (w.fighters.length <= 2) {
      finishBout(w, decideSubOnly(null, meta));
      return;
    }
    // QA-4: teams and ffa on the bell are judged (09 §4.3): per round, each
    // side's effective score is the sum of its fighters' §06 counters; teams
    // take 10 for the round (9 for a lower total, 10-10 when level) and the
    // most points wins; ffa ranks by total effective score. It used to be
    // "live headcount x 1000 + sig strikes landed".
    const weights = mmaWeights();
    const rounds = [...jr.history];
    if (jr.ledgers.some((l) => l.roundSecondsElapsed > 0)) rounds.push(jr.ledgers);
    const sides = [...new Set(w.fighters.map((f) => f.team))].sort((a, b) => a - b);
    const total = new Map<number, number>(sides.map((t) => [t, 0]));
    const points = new Map<number, number>(sides.map((t) => [t, 0]));
    for (const ledgers of rounds) {
      const perSide = new Map<number, number>(sides.map((t) => [t, 0]));
      for (const f of w.fighters) {
        const l = ledgers[f.id];
        if (!l) continue;
        perSide.set(f.team, (perSide.get(f.team) ?? 0) + effectiveScore(l, weights, clock.roundSeconds));
      }
      const top = Math.max(...perSide.values());
      for (const t of sides) {
        total.set(t, (total.get(t) ?? 0) + (perSide.get(t) ?? 0));
        points.set(t, (points.get(t) ?? 0) + ((perSide.get(t) ?? 0) >= top - 1e-9 ? 10 : 9));
      }
    }
    const ffa = w.config.mode === 'ffa';
    const key = (t: number): number => (ffa ? total.get(t) ?? 0 : (points.get(t) ?? 0) * 1e6 + (total.get(t) ?? 0));
    let bestTeam: number | null = null;
    let best = -Infinity;
    let tied = false;
    for (const t of sides) {
      const v = key(t);
      if (v > best + 1e-9) {
        best = v;
        bestTeam = t;
        tied = false;
      } else if (Math.abs(v - best) <= 1e-9) tied = true;
    }
    const members = bestTeam === null ? [] : w.fighters.filter((f) => f.team === bestTeam);
    finishBout(w, {
      winner: tied ? 'draw' : members.length === 1 ? members[0].id : 'none',
      winningTeam: tied ? null : bestTeam,
      method: tied ? 'draw' : 'timeLimit',
      detail: tied ? 'team scores level' : 'team scoring',
      ...meta,
      scorecards: [],
      judgeTotals: [],
    });
  }

  const modules: BoundModules = {
    policy,
    upkeep,
    canAct,
    commitDecision,
    holdDefence,
    resolveContact,
    abandonContact,
    referee: refereePhase,
    judges,
    breakRecovery,
    decideIfUnfinished,
  };
  return modules;
}

/** The recorder needs the end-of-bout decision hook; it lives on the modules. */
export interface BoundModules extends LoopModules {
  decideIfUnfinished(world: World): void;
}
