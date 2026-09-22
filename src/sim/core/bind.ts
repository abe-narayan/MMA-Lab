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
import type { Decision, DecisionPolicy } from './policy';
import { IdlePolicy } from './policy';
import type { LoopModules } from './loop';
import type { ContactKind, ScheduledContact } from './scheduler';
import type { PositionId, SubmissionId, TechniqueId } from './ids';
import { refereeRuntime, judgeRuntime, matchClock } from './build';

import {
  BAND_ORDER, DRAWS_PER_STRIKE, arrivalLogit, bandFor, baseDefenceSuccess, defence, guard,
  guardLogit, hasDefence, hasTechnique, passiveBlockP, reachProfile, resolveStrike, skillGapK,
  strikeClasses, technique, totalMs as techniqueTotalMs,
  type ForceContext, type GuardSpec, type ImpactPosture, type RangeBand, type ResolvedDefence,
  type StrikeResolveInput, type TargetRegion, type TechniqueSpec,
} from '../striking';
import {
  GRAPPLE_EDGE_DRAWS, hasGrapplingEdge, grapplingEdge, isGroundedNode, kindForNode,
  positionNode, resolveEdge, roleFor,
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
  emptyLedger, isGrounded, isLegal, scoreRound, decide, STANDING_CONTACT,
  type RefEngagementInput, type RefFighterInput, type RoundLedger,
} from '../rules';
import type { DamageEvent, GrappleEvent, SimEvent, StrikeEvent } from '../record/events';

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
}

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
  const near = w.params.get('core.engagedMaxDistanceM');
  if (d < 0.7 + near) return 'pos.standing_close';
  if (d < 2.0) return 'pos.standing_mid';
  return 'pos.standing_long';
}

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
export function isSignificant(spec: TechniqueSpec, posture: ImpactPosture): boolean {
  if (posture === 'distance') return true;
  if (spec.weapon !== 'fist' && spec.weapon !== 'backfist' && spec.weapon !== 'hammerfist') return true;
  return !spec.id.startsWith('tech.jab');
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
function guardOf(f: FighterWorldState): GuardSpec {
  switch (f.runtime.def.style.guardStyle) {
    case 'highGuard': return guard('guard.high');
    case 'philly': return guard('guard.philly');
    case 'longGuard': return guard('guard.long');
    case 'peekaboo': return guard('guard.peekaboo');
    case 'thai': return guard('guard.long');
    default: return guard('guard.standard');
  }
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
    + (d.k * (defenderSkill - attackerSkill)) / 100
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
function inRange(spec: TechniqueSpec, band: RangeBand): boolean {
  const here = BAND_ORDER.indexOf(band);
  for (const home of spec.band) {
    if (Math.abs(BAND_ORDER.indexOf(home) - here) <= 1) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Module views of a fighter (03 / 04 read narrow interfaces, not the world)
// ---------------------------------------------------------------------------

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
    cranks: pick('cranks', r.grappling.subAttack),
    escapes: pick('escapes', r.grappling.subDefence),
    control: pick('control', r.grappling.subDefence),
    guard: pick('guard', r.grappling.subDefence),
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
   * The decision policy. `IdlePolicy` is the placeholder until chapter 07's
   * planner lands — swapping it is this one argument.
   * TODO(chapter 07): default to `new AiPolicy(world)`.
   */
  policy?: DecisionPolicy;
}

export function createModules(world: World, opts: BindOptions = {}): BoundModules {
  const policy = opts.policy ?? new IdlePolicy();
  const clock = matchClock(world.config, world.ruleset);
  const dtMs = world.params.get('core.dtMs');
  /** Guards the once-per-tick work that `upkeep` is the only hook for. */
  let timersTick = -1;

  // =========================================================================
  // P2 — upkeep
  // =========================================================================

  function syncEngagement(w: World, f: FighterWorldState): void {
    const e = w.engagements.of(f.id);
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
    return speed > 1.0 ? 'movementHighPace' : speed > 0.05 ? 'movementLowPace' : 'idleStanding';
  }

  function pushDamageEvents(w: World, events: readonly DamageEvent[], subMs = 0): void {
    for (const e of events) {
      emit(w, { ...e, tick: w.tick, subMs, round: w.round });
      if (e.kind === 'knockdown') {
        const f = w.fighters[e.actor];
        if (f) {
          f.posture = 'down';
          f.downTicks = Math.max(f.downTicks, 10);
          w.scheduler.queue.cancelFor(f.id, 'knockdown');
        }
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
    const grounded = f.posture === 'down' || isGroundedNode(f.position);
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
    if (f.posture === 'down' || f.posture === 'out') return false;
    if (f.downTicks > 0) return false;
    if (!f.damage.conscious) return false;
    if (f.damage.has(S.ko) || f.damage.has(S.chokedOut)) return false;
    if (f.damage.has(S.knockdownFlash) || f.damage.has(S.knockdownHurt)) return false;
    if (f.damage.grounded && f.posture !== 'ground') return false;
    // Mid-commitment: still inside startup/active/recovery, or a contact pending.
    if (f.action !== null && w.nowMs < f.actionCommitMs + f.actionTotalMs) return false;
    if (w.scheduler.queue.pendingFor(f.id) !== null) return false;
    // 04: a fighter held at `secure` or deeper cannot choose a new action; the
    // submission battle is resolved by its own windows.
    const partner = f.partnerId === null ? null : w.fighters[f.partnerId];
    if (partner && partner.sub.technique !== null && partner.sub.stage >= 2) return false;
    if (f.sub.technique !== null && f.sub.stage >= 2) return false;
    return true;
  }

  function targetOf(w: World, f: FighterWorldState, d: Decision): FighterWorldState | null {
    if (d.targetId !== null) {
      const t = w.fighters[d.targetId];
      if (t && !t.out && t.id !== f.id) return t;
    }
    return w.nearestOpponent(f);
  }

  function commitDecision(w: World, f: FighterWorldState, d: Decision, jitter: number): void {
    f.defence = d.defence;
    f.intentTag = d.intentTag;
    f.lastActionTick = w.tick;

    // Movement intent. P5 integrates whatever is left here; an engaged fighter
    // outside a scramble is pinned in place by invariant I4.
    const e = w.engagements.of(f.id);
    if (e && e.kind !== 'scramble') {
      f.vx = 0;
      f.vz = 0;
    } else {
      const max = 4;
      f.vx = clamp(d.moveX, -max, max);
      f.vz = clamp(d.moveZ, -max, max);
      if (d.moveX !== 0 || d.moveZ !== 0) f.facing = Math.atan2(d.moveX, d.moveZ);
    }

    const target = targetOf(w, f, d);
    if (d.kind === 'wait' || d.kind === 'move' || d.kind === 'defend' || d.what === null) {
      f.action = null;
      f.actionResult = 'none';
      return;
    }
    if (!target) return;

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
    const id = d.what as TechniqueId;
    if (!hasTechnique(id)) return;
    const spec = technique(id);
    const posture = postureOf(w, f);
    // Chapter 01's tier execution multiplier; never baked into the catalogue.
    const mult = spec.weapon === 'fist' || spec.weapon === 'backfist' || spec.weapon === 'hammerfist'
      ? f.runtime.execTimeMultPunch
      : f.runtime.execTimeMultKick;
    const contactMs = Math.max(1, Math.round(spec.contactMs * mult));
    const total = Math.max(contactMs, Math.round(techniqueTotalMs(spec) * mult));

    f.damage.spendAction(techClassFor(spec, posture), { skill: f.runtime.strikingMean });
    // 05 §2.7: a strike thrown back is an "answer". Without this the referee
    // never sees intelligent defence and stops every fight for repetitive
    // strikes.
    f.damage.noteAnswer();

    const region: TargetRegion = (d.payload as { region?: TargetRegion } | undefined)?.region
      ?? spec.targets[0];
    f.totalAttempted++;
    if (isSignificant(spec, posture)) f.sigAttempted++;

    schedule(w, f, target, 'strike', id, contactMs, total, {
      kind: 'strike', technique: id, region, posture, node: f.position,
    }, jitter, Math.round(spec.startupMs * mult), Math.round(spec.activeMs * mult));
  }

  function commitGrapple(
    w: World, f: FighterWorldState, target: FighterWorldState, d: Decision, jitter: number,
  ): void {
    const id = d.what as string;
    if (!hasGrapplingEdge(id)) return;
    const edge = grapplingEdge(id);
    if (!edge.from.includes(f.position)) return;
    const e = w.engagements.of(f.id);
    if (e && e.inflight) return;
    // 03 §2.3 "dur" is a range; the midpoint is used, the scheduler's jitter
    // supplies the variation (no extra draw — 09 §2.7).
    const dur = Math.round((edge.durationMs[0] + edge.durationMs[1]) / 2);
    const stage: 'single' | 'capture' = typeof edge.baseP === 'number' ? 'single' : 'capture';

    f.damage.spendAction('takedownAttempt');
    f.damage.noteAnswer();
    if (edge.kind === 'entry' || edge.kind === 'capture' || edge.kind === 'throw') {
      f.takedownsAttempted++;
    }
    if (e) w.engagements.commit(e.id, edge, w.tick, dur, stage);

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
    const e: StrikeEvent = {
      ...base(w, 'strike', actor.id, target.id,
        `${actor.runtime.def.short} misses (${why})`, contact.subMs),
      kind: 'strike',
      detail: { technique: p.technique, result: 'missed', target: regionLabel(p.region), defence: target.defence },
    };
    emit(w, e);
  }

  function regionLabel(r: TargetRegion): 'head' | 'body' | 'leadLeg' | 'rearLeg' | 'arms' {
    return r;
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
      emit(w, {
        ...base(w, 'foul', actor.id, target.id,
          `${actor.runtime.def.short} lands an illegal ${spec.name}`, contact.subMs),
        kind: 'foul',
        detail: { foul: 'disregard', reason: `${rulesWeapon(spec)} to ${p.region}`, detected: true },
      });
      return;
    }

    // --- 02 resolution: exactly DRAWS_PER_STRIKE draws ---------------------
    const force: ForceContext = {
      tier: actor.runtime.strikingTier,
      massKg: actor.runtime.body.fightNightKg,
      explosiveness: actor.runtime.effective.explosiveness,
      strength: actor.runtime.effective.strength,
      weaponSpeedAttr: spec.weapon === 'fist' ? actor.runtime.effective.handSpeed : actor.runtime.effective.kickSpeed,
      fatigue: actor.energy.f,
      commit: 'planted',
    };
    const attackerSkill = actor.runtime.strikingMean;
    const defenderSkill = target.runtime.strikingMean;
    const g = guardOf(target);
    // A spinning technique arrives with the attacker's back turned: 02 §2.2.4.
    const seen = !spec.flags.includes('spinning');
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
      guard: g,
      defence: resolvedDefenceOf(target, spec, attackerSkill, defenderSkill),
      passiveBlockP: passiveBlockP(g, spec, defenderSkill),
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
        guardLogit: guardLogit(g, spec),
      }),
    };
    const res = resolveStrike(w.rng, input);
    if (res.draws !== DRAWS_PER_STRIKE) {
      throw new Error(`resolveStrike took ${res.draws} draws, expected ${DRAWS_PER_STRIKE}`);
    }

    actor.actionResult = res.result === 'landed' ? 'landed'
      : res.result === 'blocked' ? 'blocked'
        : res.result === 'evaded' ? 'evaded' : 'missed';

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
      pushDamageEvents(w, result.events, contact.subMs);
      if (result.attackerInjury) {
        pushDamageEvents(w, actor.damage.applySelfInjury(result.attackerInjury), contact.subMs);
      }
      if (result.outcome === 'ko' || result.outcome === 'knockdown_hurt'
        || result.outcome === 'knockdown_flash') {
        target.posture = 'down';
        target.downTicks = Math.max(target.downTicks, 10);
        target.knockdowns++;
        w.scheduler.queue.cancelFor(target.id, 'knockdown');
        w.engagements.leave(target.id, w.tick);
        emit(w, {
          ...base(w, 'knockdown', actor.id, target.id,
            `${target.runtime.def.short} is down!`, contact.subMs),
          kind: 'knockdown',
          detail: {
            kind: result.outcome === 'ko' ? 'ko'
              : result.outcome === 'knockdown_flash' ? 'flash' : 'hurt',
            cause: spec.id,
            severity: result.alphaEq,
          },
        });
      }
      target.lastStruckTick = w.tick;
      target.unansweredStrikes++;
      actor.unansweredStrikes = 0;
    }

    if (res.statLanded) {
      actor.totalLanded++;
      if (isSignificant(spec, posture)) actor.sigLanded++;
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
      setup: false,
      telegraphed: false,
      rangeM: w.distance(actor, target),
      round: w.round,
      bloodied: false,
      chain: null,
      gripDominance: 'neutral',
      sideMatch: 'none',
      attemptIndex: 0,
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
    const from = actor.position;
    const to: PositionId = outcome.toNode;
    actor.actionResult = outcome.success ? 'success' : 'stuffed';

    const kind = kindForNode(to);
    if (kind === null) {
      // A free standing node: the engagement dissolves.
      if (engagementId !== null) w.engagements.dissolve(engagementId, w.tick);
      for (const f of [actor, target]) {
        f.partnerId = null;
        f.posture = 'standing';
        f.position = to;
      }
    } else if (engagementId !== null) {
      w.engagements.transition(engagementId, to, w.tick, { swap: outcome.swap });
      syncEngagement(w, actor);
      syncEngagement(w, target);
    } else {
      // Opening a new engagement: the pair is pulled together so I4 holds.
      const mx = (actor.x + target.x) / 2;
      const mz = (actor.z + target.z) / 2;
      const gap = 0.15;
      actor.x = mx - gap / 2;
      actor.z = mz;
      target.x = mx + gap / 2;
      target.z = mz;
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
        detail: { edge: edge.id, from, to, result: 'success' },
      } as GrappleEvent);
      void e;
    }

    if (outcome.success && (edge.kind === 'entry' || edge.kind === 'capture' || edge.kind === 'throw')) {
      actor.takedownsLanded++;
    }
    if (engagementId !== null) w.engagements.markWork(engagementId, true);

    const ev: GrappleEvent = {
      ...base(w, edgeEventKind(edge), actor.id, target.id,
        `${actor.runtime.def.short} ${outcome.success ? 'completes' : 'fails'} ${edge.name}`,
        contact.subMs),
      kind: edgeEventKind(edge),
      detail: {
        edge: edge.id,
        from,
        to,
        result: outcome.success ? 'success' : outcome.counter.fired ? 'countered' : 'stuffed',
        cage: w.engagements.of(actor.id)?.cage ?? false,
      },
    };
    emit(w, ev);
  }

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
        nearFence: w.engagements.of(actor.id)?.cage ?? false,
        ctrl: positionNode(actor.position).controlRating,
      }),
      stageP: stageSpec.baseP,
      dMeanMs: stageSpec.dMeanMs,
      option: stageSpec.defences[0] ?? 'standard',
      chained: false,
    };
    const res = resolveWindow(w.rng, ctx);

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
          finishBout(w, {
            winner: actor.id, winningTeam: actor.team, method: 'submission',
            detail: spec.id, round: w.round, timeSeconds: w.roundTick * dtMs / 1000,
            totalSeconds: w.nowMs / 1000, scorecards: [], judgeTotals: [],
          });
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
        finishBout(w, {
          winner: actor.id, winningTeam: actor.team, method: 'submission',
          detail: spec.id, round: w.round, timeSeconds: w.roundTick * dtMs / 1000,
          totalSeconds: w.nowMs / 1000, scorecards: [], judgeTotals: [],
        });
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

  function refereePhase(w: World): void {
    const rt = refereeRuntime(w);
    if (rt.result) {
      w.finished = true;
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
      opponentOf: (id: number): number => {
        const f = w.fighters[id];
        const opp = f ? w.nearestOpponent(f) : null;
        return opp ? opp.id : -1;
      },
    });
    for (const e of outcome.events) {
      emit(w, { ...e, tick: w.tick, round: w.round });
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
        if (loser) {
          loser.out = true;
          loser.outReason = ended.reason;
          w.engagements.leave(loser.id, w.tick);
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
        a.sigAttempted++;
        if (det.result === 'landed') {
          if (det.target === 'head') a.sigHead++;
          else if (det.target === 'body') a.sigBody++;
          else a.sigLeg++;
        }
      } else if (e.kind === 'knockdown' && a) {
        a.kd++;
        a.hurtEvents++;
      } else if (e.kind === 'takedown' && a) {
        if (e.detail.result === 'success') a.tdLanded++;
        else a.tdMissed++;
      } else if (e.kind === 'reversal' && a) {
        a.reversals++;
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
    // No panel (teams, ffa, crowd, sub-only): the side with the most live
    // fighters, then the most significant strikes landed, takes it.
    const teams = w.liveTeams();
    const scoreOf = (team: number): number => w.fighters
      .filter((f) => f.team === team && !f.out)
      .reduce((n, f) => n + f.sigLanded, 0);
    let bestTeam: number | null = null;
    let best = -Infinity;
    let tied = false;
    for (const t of teams) {
      const s = w.live().filter((f) => f.team === t).length * 1000 + scoreOf(t);
      if (s > best) {
        best = s;
        bestTeam = t;
        tied = false;
      } else if (s === best) tied = true;
    }
    const winners = bestTeam === null ? [] : w.live().filter((f) => f.team === bestTeam);
    finishBout(w, {
      winner: tied ? 'draw' : winners.length === 1 ? winners[0].id : bestTeam === null ? 'none' : 'none',
      winningTeam: tied ? null : bestTeam,
      method: clock.untimed ? 'separated' : 'timeLimit',
      detail: 'time limit',
      round: w.round,
      timeSeconds: (w.roundTick * dtMs) / 1000,
      totalSeconds: w.nowMs / 1000,
      scorecards: [],
      judgeTotals: [],
    });
  }

  const modules: BoundModules = {
    policy,
    upkeep,
    canAct,
    commitDecision,
    resolveContact,
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
