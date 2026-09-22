/**
 * DAMAGE STATE — one fighter's pools, states, timers and cues.
 *
 * This is the object the engine holds per fighter and the only entry point
 * into chapter 05:
 *
 *   applyImpact(impact, rng, ctx)   resolution phase; draws exactly ten (§2.10)
 *   upkeep(dtMs, ctx)               upkeep phase; draws NOTHING (09 §2.7 P2)
 *   roundBreak(opts)                between rounds; draws nothing
 *   observables() / caps()          what 06, 07, 02-04 and the presenter read
 *
 * The ten-draw contract is why `applyImpact` takes all its draws up front:
 * every one of (a)-(j) is consumed whether or not its branch applies, so the
 * RNG stream position after an impact is a pure function of the impact count,
 * not of what happened. A replay that reproduces the event stream therefore
 * reproduces the stream position (09 §2.7 P4).
 */
import type { DamageEvent } from '../record/events';
import type { FighterSnapshot } from '../record/snapshot';
import type { RNG } from '../rng';
import {
  attackerLimbSide, alphaEquivalent, concussionProbability, emptyCareerWrites, footInjuryProbability,
  frontEnd, handInjuryProbability, outcomeWeights, outcomeWindows, recordKnockout, splitOutcome,
  type CareerWrites, type ConcussiveOutcome,
} from './ko';
import {
  elbowArc, isLegRegion, weaponClass,
  type BodySite, type HeadSite, type ImpactPosture, type LegSite, type StrikeImpact,
} from './impact';
import {
  ARM_SITES, acuteAttrMult, armDecayConfig, bodyAcuteMult, bodyDecayConfig, bodyStructuralMult,
  combinedMovement, cutSiteFor, headAcuteMult, headDecayConfig, headStructuralMult, isBodySite,
  isBrowZone, isHeadSite, isLegSite, legAcuteMult, legDecayConfig, legKickPower, legKickRate,
  legLoad, legMobility, legCheckSpeed, legSeverity, legStructuralMult, legSubPool, legTdd,
  massScaleTarget, multiplyScalar, neutralCaps, newRegionSet, rearHandPower, recoveryHalfLifeMult,
  S, shinPenalty, sideId, stateCaps, visionCaps, visionFor,
  type CapabilityMultipliers, type Cut, type Joint, type RegionPool, type RegionSet, type Side,
} from './regions';
import { EnergyState, fatigueCaps, type BreakOptions, type TechClass } from './fatigue';
import type { FighterDamageProfile } from './profile';
import {
  ABSORBED_WINDOW_S, emptyObservables, INTELLIGENT_DEFENCE_WINDOW_S, KNOCKDOWN_WINDOW_S,
  NO_REACTION_WINDOW_S,
  type EyesCue, type KnockdownCue, type LegsCue, type ReactionCue, type RefObservables,
} from './observables';
import { clamp, defaultTuning, lerpDraw, type Tuning } from './tuning';

/** Bit positions in `FighterSnapshot.state` (the digested state summary). */
export const STATE_BITS = Object.freeze({
  stunned: 1 << 0,
  rocked: 1 << 1,
  knockdown: 1 << 2,
  ko: 1 << 3,
  bodyHurt: 1 << 4,
  bodyWorn: 1 << 5,
  winded: 1 << 6,
  bodyCollapse: 1 << 7,
  deadLeg: 1 << 8,
  legCompromised: 1 << 9,
  legCollapse: 1 << 10,
  deadArm: 1 << 11,
  handInjured: 1 << 12,
  noseBroken: 1 << 13,
  eyeSwollenShut: 1 << 14,
  secondWind: 1 << 15,
  adrenalineDump: 1 << 16,
  grounded: 1 << 17,
  limbFracture: 1 << 18,
  cut: 1 << 19,
});

export interface ActiveState {
  id: string;
  base: string;
  side: Side | null;
  sinceS: number;
  /** +inf for states that last the bout. */
  untilS: number;
  severity: number;
}

export interface UpkeepContext {
  tick: number;
  round: number;
  posture: ImpactPosture;
  /** 03's grounded flag; OR-ed with this module's own grounded windows. */
  grounded?: boolean;
  clinching?: boolean;
  moving?: boolean;
  underChoke?: boolean;
  /** 02's trailing-30-s defence quality. */
  defenceQuality30?: number;
  /** 07's intent; forced false during a collapse window or while `cannotStand`. */
  attemptingToRise?: boolean;
  tapped?: boolean;
  verbalTap?: boolean;
  screams?: boolean;
  jointFailed?: boolean;
}

export interface ImpactContext {
  round: number;
  /** 01 `fightNightKg` of the attacker (never taken from the payload, §2.1). */
  attackerMassKg: number;
  /**
   * Which side of the body was struck. 02's payload carries no laterality, so
   * callers that know it (a left hook lands on the target's right side) should
   * pass it; otherwise it alternates deterministically off the impact itself.
   */
  struckSide?: Side;
}

export interface AttackerInjury {
  kind: 'hand' | 'foot';
  side: Side;
}

export interface ImpactResult {
  raw: number;
  fDel: number;
  absorb: number;
  alphaEq: number;
  pConcuss: number;
  concussive: boolean;
  outcome: ConcussiveOutcome | null;
  /** Injury the ATTACKER suffered; the engine applies it to their state. */
  attackerInjury: AttackerInjury | null;
  events: DamageEvent[];
  /** Always 10 (§2.10). Exposed so the determinism test can assert it. */
  drawsUsed: number;
}

export interface RoundBreakOptions extends Partial<BreakOptions> {
  tick?: number;
  round?: number;
}

const TEN = 10;

export class DamageState {
  readonly t: Tuning;
  readonly regions: RegionSet = newRegionSet();
  readonly energy: EnergyState;
  readonly cuts: Cut[] = [];
  readonly career: CareerWrites = emptyCareerWrites();

  private readonly active = new Map<string, ActiveState>();
  private caps_: CapabilityMultipliers = neutralCaps();
  private obs: RefObservables = emptyObservables();

  private nowS = 0;
  private roundTimeS = 0;
  private round = 1;
  private tick = 0;
  private stance: 'orthodox' | 'southpaw' = 'orthodox';

  // grounded / consciousness windows
  private groundedUntilS = Number.NEGATIVE_INFINITY;
  private riseAllowedAtS = Number.NEGATIVE_INFINITY;
  private unconsciousUntilS = Number.NEGATIVE_INFINITY;
  private chokeProgress = 0;

  // delayed liver collapse (§2.3.2)
  private liverFireAtS = Number.POSITIVE_INFINITY;
  private liverDownS = 0;

  // observable bookkeeping
  private unansweredHead = 0;
  private lastDefenceS = 0;
  private coveringStaticS = 0;
  private bloodInEyeS = 0;
  private doctorRequested = false;
  private lastHitAnyS = Number.NEGATIVE_INFINITY;
  private knockedDownCue: KnockdownCue | undefined;
  private readonly absorbLog: { tS: number }[] = [];
  private readonly kdLog: number[] = [];
  private highAcuteSinceS = Number.POSITIVE_INFINITY;
  private events: DamageEvent[] = [];

  constructor(
    readonly profile: FighterDamageProfile,
    opts: { tuning?: Tuning; stance?: 'orthodox' | 'southpaw' } = {},
  ) {
    this.t = opts.tuning ?? defaultTuning();
    this.stance = opts.stance ?? 'orthodox';
    this.energy = new EnergyState(this.t, profile);
    this.recompute();
  }

  // =========================================================================
  // Accessors
  // =========================================================================

  get f(): number {
    return this.energy.f;
  }

  get caps(): CapabilityMultipliers {
    return this.caps_;
  }

  get states(): string[] {
    return [...this.active.keys()].sort();
  }

  get grounded(): boolean {
    return this.nowS < this.groundedUntilS;
  }

  get conscious(): boolean {
    return !this.has(S.ko) && !this.has(S.chokedOut) && this.nowS >= this.unconsciousUntilS;
  }

  has(base: string, side?: Side): boolean {
    return this.active.has(side ? sideId(base, side) : base);
  }

  severityOf(base: string, side?: Side): number {
    return this.active.get(side ? sideId(base, side) : base)?.severity ?? 0;
  }

  setStance(stance: 'orthodox' | 'southpaw'): void {
    this.stance = stance;
  }

  /** Orthodox leads with the left, so the rear leg is the right one. */
  private get rearSide(): Side {
    return this.stance === 'orthodox' ? 'right' : 'left';
  }

  /** 04 writes choke progress; it drives `consciousness` only (§2.7). */
  setChokeProgress(p: number): void {
    this.chokeProgress = clamp(p, 0, 1);
  }

  /** An answer: a strike thrown back, a grip, a level change, a turn (§2.7). */
  noteAnswer(): void {
    this.unansweredHead = 0;
    this.lastDefenceS = this.nowS;
    this.coveringStaticS = 0;
  }

  /** A static double-forearm cover is *not* an answer; it accrues instead. */
  noteStaticCover(dtS: number): void {
    this.coveringStaticS += dtS;
  }

  clearDoctorCheck(): void {
    this.doctorRequested = false;
  }

  /** 06 calls this on a head-strike TKO so the career write matches a KO (§2.4.6). */
  recordHeadStrikeTko(): void {
    recordKnockout(this.t, this.career);
  }

  // =========================================================================
  // Energy passthrough (so callers never reach past `DamageState`)
  // =========================================================================

  spendAction(cls: TechClass, opts?: { skill?: number; scale?: number }): void {
    this.energy.spendAction(cls, opts);
  }

  spendSustained(cls: TechClass, dtS: number, opts?: { skill?: number; scale?: number }): void {
    this.energy.spendSustained(cls, dtS, opts);
  }

  // =========================================================================
  // §2.10 resolution phase — exactly ten draws
  // =========================================================================

  /**
   * Apply one landed impact. The ten draws, in the §2.10 order:
   *   (a) pConcuss  (b) outcome split  (c) unconscious / grounded window
   *   (d) freeze    (e) cut roll       (f) cut severity
   *   (g) region event (calf shock / knee / rib / body collapse / nose)
   *   (h) attacker hand or foot injury  (i) shin fracture  (j) liver delay
   */
  applyImpact(imp: StrikeImpact, rng: RNG, ctx: ImpactContext): ImpactResult {
    const d: number[] = new Array<number>(TEN);
    for (let i = 0; i < TEN; i++) d[i] = rng.next();

    this.events = [];
    this.round = ctx.round;
    const t = this.t;
    const nowS = this.nowS;
    const rockedNow = this.has(S.rocked) || this.has(S.knockdownHurt) || this.has(S.knockdownFlash);

    const front = frontEnd(t, imp, ctx.attackerMassKg, rockedNow);
    const side = ctx.struckSide ?? this.derivedSide(imp);
    const scale = massScaleTarget(t, this.profile.massKg);

    this.lastHitAnyS = nowS;
    this.absorbLog.push({ tS: nowS });

    let alphaEq = 0;
    let pConcuss = 0;
    let concussive = false;
    let outcome: ConcussiveOutcome | null = null;

    if (imp.region === 'head') {
      const site = (isHeadSite(imp.subLocation) ? imp.subLocation : 'topback') as HeadSite;
      const alpha = alphaEquivalent(t, imp, {
        neck: this.profile.neck,
        fatigue: this.f,
        headStructural: this.regions.head.structural,
        neckCranked: this.has(S.neckCranked),
      }, front);
      alphaEq = alpha.alphaEq;

      // (§2.4.3 step 1) the acute increment lands first, with the PRE-impact
      // structural value inside kPrior.
      this.regions.head.addAcute(
        front.raw * headAcuteMult(t, site) * acuteAttrMult(t, this.profile.chinEff)
          * scale * alpha.kPrior,
        nowS,
      );
      this.regions.head.addStructural(
        front.raw * headStructuralMult(t, site) * t.n('dmg.head.structuralRatio')
          * (imp.targetState.grounded ? t.n('dmg.head.groundStructuralMult') : 1),
        t.n('dmg.head.pFrac'),
        nowS,
      );

      // Swelling: orbit and midface hits on that side (§2.3.1).
      if (site === 'orbit' || site === 'midface') {
        this.regions.swell[side] = clamp(
          this.regions.swell[side] + t.n('dmg.swell.gain') * front.raw * headStructuralMult(t, site),
          0, 100,
        );
      }

      pConcuss = concussionProbability(t, alphaEq, this.profile.chinEff, this.profile.residualDehydration);
      concussive = d[0] < pConcuss;
      if (concussive) {
        const w = outcomeWeights(t, ctx.attackerMassKg, this.profile, this.f);
        outcome = splitOutcome(d[1], w);
        this.applyConcussiveOutcome(outcome, d[2], d[3], imp);
      }

      this.unansweredHead += imp.placement === 'flush' || imp.placement === 'solid' ? 1 : 0;
      this.applyCut(imp, site, side, d[4], d[5]);
      this.applyHeadRegionEvent(site, front.raw, d[6]);
      this.applyHeadThresholds(nowS, concussive, rockedNow);
    } else if (imp.region === 'body') {
      const site = (isBodySite(imp.subLocation) ? imp.subLocation : 'abdomen') as BodySite;
      const acuteAdd = front.raw * bodyAcuteMult(t, site)
        * acuteAttrMult(t, this.profile.bodyToughness) * scale;
      this.regions.body.addAcute(acuteAdd, nowS);
      this.regions.body.addStructural(
        front.raw * bodyStructuralMult(t, site) * t.n('dmg.body.structuralRatio'),
        t.n('dmg.body.pFrac'),
        nowS,
      );
      this.energy.noteBodyShot(front.raw);
      this.applyBodySiteEvents(imp, site, front.raw, acuteAdd, d[6], d[9]);
    } else if (isLegRegion(imp.region)) {
      const site = (isLegSite(imp.subLocation) ? imp.subLocation : 'thigh_outer') as LegSite;
      const legSide = imp.region === 'leadLeg'
        ? (this.stance === 'orthodox' ? 'left' : 'right')
        : this.rearSide;
      const leg = this.regions.leg[legSide];
      leg.acute.addAcute(
        front.raw * legAcuteMult(t, site) * acuteAttrMult(t, this.profile.bodyToughness) * scale,
        nowS,
      );
      const pool: RegionPool = leg[legSubPool(site)];
      pool.addStructural(
        front.raw * legStructuralMult(t, site) * t.n('dmg.leg.structuralRatio'),
        t.n('dmg.leg.pFrac'),
        nowS,
      );
      if (site === 'calf' && imp.placement === 'flush') leg.calfHits += 1;
      this.applyLegRegionEvent(imp, site, legSide, d[6]);
      this.applyShinFracture(imp, site, legSide, d[8]);
    } else {
      // region === 'arms': a kick or knee into the guard (§2.3.4).
      const armSide = ctx.struckSide ?? side;
      const arm = this.regions.arm[armSide];
      arm.addAcute(front.raw * t.n('dmg.arm.directAcute')
        * acuteAttrMult(t, this.profile.bodyToughness) * scale, nowS);
      arm.addStructural(front.raw * t.n('dmg.arm.directStructural'), t.n('dmg.arm.pFrac'), nowS);
    }

    // Blocked head strikes route part of the absorbed energy into the guard
    // (§2.2.1, §2.3.4): absorbed energy is not lost.
    if (imp.region === 'head' && (imp.defence === 'block_forearm' || imp.defence === 'block_glove')) {
      const toArm = t.n('dmg.blockToArmFraction') * front.absorb * front.raw;
      // 02 does not say which arm blocked, so the load is split evenly.
      for (const s of ['left', 'right'] as Side[]) {
        this.regions.arm[s].addStructural(toArm / 2, t.n('dmg.arm.pFrac'), nowS);
      }
    }

    // (h) and (i): the attacker's own hand / foot (§2.3.5).
    const attackerInjury = this.rollAttackerInjury(imp, d[7]);

    this.evaluateStates(nowS);
    this.recompute();

    return {
      raw: front.raw,
      fDel: front.fDel,
      absorb: front.absorb,
      alphaEq,
      pConcuss,
      concussive,
      outcome,
      attackerInjury,
      events: this.events,
      drawsUsed: TEN,
    };
  }

  /**
   * The side a lateral effect (swelling, a blocking arm) lands on. 02's payload
   * has no laterality, so this alternates off the impact's own fields — it is
   * deterministic, replay-stable and unbiased over a bout. `ctx.struckSide`
   * overrides it wherever the caller does know.
   */
  private derivedSide(imp: StrikeImpact): Side {
    return (Math.floor(imp.subTickMs) + imp.attacker + imp.tick) % 2 === 0 ? 'left' : 'right';
  }

  /** §2.4.3 steps 2-5. */
  private applyConcussiveOutcome(
    outcome: ConcussiveOutcome,
    drawC: number,
    drawD: number,
    imp: StrikeImpact,
  ): void {
    const t = this.t;
    const nowS = this.nowS;
    const w = outcomeWindows(t, outcome, drawC, drawD);
    this.regions.head.floorAcute(w.acuteFloor, nowS);

    if (outcome === 'ko') {
      const alreadyOut = this.has(S.ko);
      this.unconsciousUntilS = nowS + w.unconsciousS;
      this.groundedUntilS = this.unconsciousUntilS;
      this.riseAllowedAtS = this.unconsciousUntilS;
      this.enter(S.ko, null, this.unconsciousUntilS, 1);
      // One career write per bout however many times the pool crosses (§2.4.6).
      if (!alreadyOut) recordKnockout(t, this.career);
      this.emitKnockdown('ko', imp);
    } else if (outcome === 'knockdown_hurt') {
      this.groundedUntilS = Math.max(this.groundedUntilS, nowS + w.riseAllowedAfterS);
      this.riseAllowedAtS = nowS + w.riseAllowedAfterS;
      // The decay freeze IS the "legs are gone" model: 15-40 s of rocked after
      // a hurt knockdown comes out of freeze + the normal 8-s half-life (§2.6.1).
      this.regions.head.freezeUntilS = nowS + w.freezeS;
      this.enter(S.knockdownHurt, null, nowS + w.freezeS + w.riseAllowedAfterS, 1);
      this.energy.survivalTax();
      this.emitKnockdown('hurt', imp);
    } else if (outcome === 'knockdown_flash') {
      this.groundedUntilS = Math.max(this.groundedUntilS, nowS + w.riseAllowedAfterS);
      this.riseAllowedAtS = nowS + w.riseAllowedAfterS;
      this.enter(S.knockdownFlash, null, nowS + w.riseAllowedAfterS, 1);
      this.energy.survivalTax();
      this.emitKnockdown('flash', imp);
    } else {
      this.enter(S.rocked, null, Number.POSITIVE_INFINITY, 1);
      this.energy.survivalTax();
      this.event('rocked', { kind: 'hurt', cause: imp.tech, severity: 1 }, 'rocked');
    }
  }

  /**
   * §2.3.1 threshold mapping, re-evaluated on the final acute value (§2.4.3
   * step 6). It can only raise severity, never lower it.
   *
   * THE ACCUMULATION GATE. `wasHurt` restricts the knockdown/KO *bands* to
   * strikes that land on an already-rocked or already-dropped fighter, which is
   * exactly the scope §2.4.4 gives them: "each further landed head strike
   * during `state.rocked`/`knockdown_*` ... the acute pool crossing 90 produces
   * `state.ko` by threshold". Without the gate the two paths double-count and
   * the chapter contradicts itself: the median delivered power punch (1,150 N)
   * puts 46 points into the acute pool at the chin, so 22 % of *single* landed
   * power punches would cross 65 and 6.6 % would cross 90 — against §2.4.1's
   * own headline of 2.3 % knockdowns and 0.8 % KOs per landed strike, and
   * against C1-C3. The roll owns the single-impact case; the threshold owns the
   * barrage, which is what §2.4.5 mechanism 3 describes and what produces the
   * TKO path. §6.2 lists "roll or threshold" as an open question; this is the
   * reading that satisfies the calibration targets, and the gate is the knob.
   */
  private applyHeadThresholds(nowS: number, resolvedByRoll: boolean, wasHurt: boolean): void {
    const t = this.t;
    const a = this.regions.head.acute;
    if (!wasHurt) return;
    if (a >= t.n('dmg.head.thr.ko') && !this.has(S.ko)) {
      // The accumulation path to a true KO ("KO'd on the ground under a
      // barrage"). §6.2 keeps both paths and logs which one fired.
      this.unconsciousUntilS = nowS + t.n('ko.unconsciousMin');
      this.groundedUntilS = this.unconsciousUntilS;
      this.enter(S.ko, null, this.unconsciousUntilS, 1);
      recordKnockout(t, this.career);
      this.event('knockdown', { kind: 'ko', severity: 1 }, 'knocked out by accumulation');
      this.kdLog.push(nowS);
      this.knockedDownCue = { cause: 'legal_strike', kind: 'ko' };
      return;
    }
    if (!resolvedByRoll && a >= t.n('dmg.head.thr.kdHurt') && !this.anyKnockdown()) {
      this.groundedUntilS = Math.max(this.groundedUntilS, nowS + t.n('kd.hurt.riseMin'));
      this.riseAllowedAtS = nowS + t.n('kd.hurt.riseMin');
      this.enter(S.knockdownHurt, null, nowS + t.n('kd.hurt.freezeMin'), 1);
      this.event('knockdown', { kind: 'hurt', severity: 1 }, 'dropped by accumulated damage');
      this.kdLog.push(nowS);
      this.knockedDownCue = { cause: 'legal_strike', kind: 'hurt' };
    }
  }

  private anyKnockdown(): boolean {
    return this.has(S.knockdownHurt) || this.has(S.knockdownFlash) || this.has(S.ko);
  }

  private emitKnockdown(kind: 'flash' | 'hurt' | 'ko', imp: StrikeImpact): void {
    this.kdLog.push(this.nowS);
    this.knockedDownCue = { cause: 'legal_strike', kind };
    this.event('knockdown', { kind, cause: imp.tech, region: imp.region }, `knockdown (${kind})`);
  }

  // ---- region events (draw g) --------------------------------------------

  /**
   * Head: the nose-break roll (§2.3.1). 2 % per midface hit of raw >= 30,
   * anchored on the nose being 10.4 % of MMA injuries (Bledsoe 2006) and
   * ~3.6 % of fighter-bouts incurring a facial fracture (Jones 2023) — C19.
   */
  private applyHeadRegionEvent(site: HeadSite, raw: number, draw: number): void {
    const t = this.t;
    if (site !== 'midface' || this.has(S.noseBroken)) return;
    if (raw < t.n('dmg.nose.rawMin')) return;
    if (draw >= t.n('dmg.nose.breakP')) return;
    this.enter(S.noseBroken, null, Number.POSITIVE_INFINITY, 1);
    // Mouth breathing for the rest of the bout: aerobic refill x0.92 (§2.3.1).
    this.event('injury', { region: 'head', kind: 'hurt', severity: 1 }, 'nose broken');
  }

  /** Body: liver collapse (deterministic, with a delayed fire), solar, ribs. */
  private applyBodySiteEvents(
    imp: StrikeImpact,
    site: BodySite,
    raw: number,
    acuteAdd: number,
    drawG: number,
    drawJ: number,
  ): void {
    const t = this.t;
    const nowS = this.nowS;
    const flush = imp.placement === 'flush';

    // Liver: not a roll. The threshold is deterministic given raw, and
    // bodyToughness scales it +-25 % (§2.3.2). The delay (0.5-3.0 s) is draw (j)
    // and is what makes a liver shot look like a liver shot.
    if (site === 'liver' && flush) {
      const thr = t.n('dmg.body.liver.rawThr')
        * (1 + t.n('dmg.body.toughnessThrSlope') * (this.profile.bodyToughness - 50));
      if (acuteAdd >= thr) {
        this.liverFireAtS = nowS
          + lerpDraw(drawJ, t.n('dmg.body.liver.delayMin'), t.n('dmg.body.liver.delayMax'));
        this.liverDownS = lerpDraw(drawJ, t.n('dmg.body.liver.downMin'), t.n('dmg.body.liver.downMax'));
      }
    }

    if (site === 'solar' && flush && raw >= t.n('dmg.body.solar.rawThr') && !this.has(S.winded)) {
      const dur = lerpDraw(drawG, t.n('dmg.body.solar.windedMin'), t.n('dmg.body.solar.windedMax'));
      this.enter(S.winded, null, nowS + dur, 1);
      this.event('stateChange', { state: S.winded, on: true, durationS: dur }, 'winded');
      return;
    }

    // One region-specific draw per impact (§2.10): at heavy accumulated body
    // damage the collapse roll takes it; otherwise the rib-fracture roll does.
    const tier4 = raw >= t.n('dmg.body.tier4Raw');
    if (this.regions.body.structural >= t.n('dmg.body.thr.collapseRollAt') && tier4) {
      if (drawG < t.n('dmg.body.collapseRollP')) this.startBodyCollapse(drawG);
      return;
    }
    if (site === 'ribs' && tier4 && drawG < t.n('dmg.body.ribFractureP') && !this.has(S.ribFracture)) {
      this.enter(S.ribFracture, null, Number.POSITIVE_INFINITY, 1);
      this.event('injury', { region: 'body', severity: 2 }, 'rib injury');
    }
  }

  private startBodyCollapse(draw: number): void {
    const t = this.t;
    const dur = lerpDraw(draw, t.n('dmg.body.liver.downMin'), t.n('dmg.body.liver.downMax'));
    this.groundedUntilS = Math.max(this.groundedUntilS, this.nowS + dur);
    this.enter(S.bodyCollapse, null, this.nowS + dur, 1);
    this.kdLog.push(this.nowS);
    this.knockedDownCue = { cause: 'legal_strike', kind: 'body' };
    this.event('knockdown', { kind: 'body', durationS: dur }, 'body shot drops him');
  }

  /** Legs: collapse fall, calf shock, knee event — one draw, by priority. */
  private applyLegRegionEvent(imp: StrikeImpact, site: LegSite, side: Side, draw: number): void {
    const t = this.t;
    const leg = this.regions.leg[side];
    const load = legLoad(t, leg);
    const flush = imp.placement === 'flush';

    if (legSeverity(t, load, leg.acute.acute) === 4 && flush) {
      if (draw < t.n('dmg.leg.collapseFallP')) {
        this.groundedUntilS = Math.max(this.groundedUntilS, this.nowS + 3);
        this.kdLog.push(this.nowS);
        this.knockedDownCue = { cause: 'legal_strike', kind: 'leg' };
        this.event('knockdown', { kind: 'leg', region: side }, 'the leg gives out');
      }
      return;
    }
    if (site === 'calf' && flush) {
      // MT's rising form, not DAMAGE's flat 5 %: it is what reproduces
      // "5-10 clean calf kicks and he switches stance".
      const p = Math.min(
        t.n('dmg.leg.calfShock.base') + t.n('dmg.leg.calfShock.perHit') * (leg.calfHits - 1),
        t.n('dmg.leg.calfShock.cap'),
      );
      if (draw < p && !this.has(S.deadLeg, side)) {
        const dur = lerpDraw(draw / Math.max(p, 1e-9),
          t.n('dmg.leg.calfShock.durMin'), t.n('dmg.leg.calfShock.durMax'));
        this.enter(S.deadLeg, side, this.nowS + dur, 1);
        this.event('injury', { region: `leg.${side}`, kind: 'leg', durationS: dur }, 'dead leg');
      }
      return;
    }
    if (site === 'knee' && flush && draw < t.n('dmg.leg.kneeEventP') && !this.has(S.kneeInjured, side)) {
      this.enter(S.kneeInjured, side, Number.POSITIVE_INFINITY, 1);
      this.event('injury', { region: `leg.${side}`, kind: 'leg' }, 'knee injured');
    }
  }

  /** Draw (i): the catastrophic shin fracture on a fully checked hard kick. */
  private applyShinFracture(imp: StrikeImpact, site: LegSite, side: Side, draw: number): void {
    const t = this.t;
    if (site !== 'shin' || weaponClass(imp.weapon) !== 'shin') return;
    // The gate is on the ORIGINAL kick force; a checked-kick self impact carries
    // `checkReturnForce` x that force (§2.3.3).
    const originalForce = imp.forceN / Math.max(t.n('dmg.leg.checkReturnForce'), 1e-6);
    if (originalForce < t.n('dmg.leg.shinFractureForceMin')) return;
    if (draw >= t.n('dmg.leg.shinFractureP') || this.has(S.limbFracture)) return;
    this.enter(S.limbFracture, side, Number.POSITIVE_INFINITY, 3);
    this.event('injury', { region: `shin.${side}`, severity: 3 }, 'shin fracture');
  }

  /** Draw (h): the attacker's hand or foot. */
  private rollAttackerInjury(imp: StrikeImpact, draw: number): AttackerInjury | null {
    const t = this.t;
    const pHand = handInjuryProbability(t, imp);
    if (pHand > 0 && draw < pHand) return { kind: 'hand', side: attackerLimbSide(imp) };
    const pFoot = footInjuryProbability(t, imp);
    if (pFoot > 0 && draw < pFoot) return { kind: 'foot', side: attackerLimbSide(imp) };
    return null;
  }

  /** The engine hands an `attackerInjury` back to the attacker's own state. */
  applySelfInjury(injury: AttackerInjury): DamageEvent[] {
    this.events = [];
    const base = injury.kind === 'hand' ? S.handInjured : S.footInjured;
    if (!this.has(base, injury.side)) {
      this.enter(base, injury.side, Number.POSITIVE_INFINITY, 1);
      this.event('injury', { region: `${injury.kind}.${injury.side}`, severity: 2 },
        `${injury.kind} injured`);
      this.recompute();
    }
    return this.events;
  }

  // ---- cuts (draws e, f) --------------------------------------------------

  private applyCut(imp: StrikeImpact, site: HeadSite, side: Side, drawP: number, drawSev: number): void {
    const t = this.t;
    if (imp.placement !== 'flush') return;
    const brow = isBrowZone(site);
    const cutSite = cutSiteFor(site, side, brow);

    const existing = this.cuts.find((c) => c.site === cutSite);
    if (existing) {
      // Growth is by hit count, not by roll: +1 severity per 5 further clean
      // strikes on that site `[S: DAMAGE §2.5]`.
      existing.cleanHitsSinceOpen += 1;
      if (existing.cleanHitsSinceOpen >= t.n('dmg.cut.growthHits') && existing.severity < 3) {
        existing.severity = (existing.severity + 1) as 1 | 2 | 3;
        existing.bleedRate = existing.severity;
        existing.cleanHitsSinceOpen = 0;
        this.event('injury', { region: cutSite, severity: existing.severity }, 'the cut opens up');
      }
      if (existing.treatedSeverity > 0) {
        existing.hitsSinceTreated += 1;
        if (existing.hitsSinceTreated >= t.n('dmg.cut.reopenHits')) {
          existing.severity = Math.max(existing.severity, existing.treatedSeverity) as 1 | 2 | 3;
          existing.bleedRate = existing.severity;
          existing.treatedSeverity = 0;
        }
      }
      return;
    }

    const p = this.cutProbability(imp, brow);
    if (drawP >= p) return;
    const elbow = weaponClass(imp.weapon) === 'elbow';
    const w1 = elbow ? t.n('dmg.cut.sevWeightElbow1') : t.n('dmg.cut.sevWeight1');
    const w2 = elbow ? t.n('dmg.cut.sevWeightElbow2') : t.n('dmg.cut.sevWeight2');
    const severity: 1 | 2 | 3 = drawSev < w1 ? 1 : drawSev < w1 + w2 ? 2 : 3;
    this.cuts.push({
      site: cutSite,
      severity,
      bleedRate: severity,
      cleanHitsSinceOpen: 0,
      openedS: this.nowS,
      treatedSeverity: 0,
      hitsSinceTreated: 0,
    });
    this.career.cuts += 1;
    this.event('injury', { region: cutSite, severity }, `cut (severity ${severity})`);
  }

  private cutProbability(imp: StrikeImpact, brow: boolean): number {
    const t = this.t;
    const zone = brow ? 'brow' : 'other';
    const cls = weaponClass(imp.weapon);
    let key: string;
    if (cls === 'elbow') {
      const arc = elbowArc(imp.tech);
      key = arc === 'downward' ? 'elbowDown' : arc === 'upward' ? 'elbowUp' : 'elbowHoriz';
    } else if (cls === 'fist' || cls === 'hammerfist') {
      key = imp.gloveType === 'bare' ? 'fistBare' : imp.gloveType === 'mma4oz' ? 'fistMma' : 'fistBoxing';
    } else if (cls === 'knee') {
      key = 'knee';
    } else if (cls === 'head') {
      key = 'headClash';
    } else if (cls === 'shin' || cls === 'foot') {
      key = 'shinFoot';
    } else {
      return 0;
    }
    const base = t.n(`dmg.cut.p.${key}.${zone}`);
    const proneness = Math.min(
      1 + t.n('dmg.cut.pronenessPerCareerCut') * this.profile.priorCutsCareer,
      t.n('dmg.cut.pronenessCap'),
    );
    const swollen = 1 + t.n('dmg.cut.structuralSlope') * this.regions.head.structural;
    return base * proneness * swollen;
  }

  // =========================================================================
  // §2.10 upkeep phase — no draws
  // =========================================================================

  upkeep(dtMs: number, ctx: UpkeepContext): DamageEvent[] {
    this.events = [];
    const dtS = dtMs / 1000;
    this.tick = ctx.tick;
    this.round = ctx.round;
    this.nowS += dtS;
    this.roundTimeS += dtS;
    this.knockedDownCue = undefined;

    // (1) acute decay per region.
    this.decayPools(dtS);
    // (2) structural bookkeeping: nothing in-round, by design (§2.3).
    // (3) energy.
    this.energy.upkeep(dtS, {
      posture: ctx.posture,
      bodyStructural: this.regions.body.structural,
      round: ctx.round,
      roundTimeS: this.roundTimeS,
      refillBlocked: this.has(S.winded),
      noseBroken: this.has(S.noseBroken),
    });
    // (4) timers, then (5) caps and cues.
    this.expireStates();
    this.fireDelayedLiverCollapse();
    this.evaluateStates(this.nowS);
    this.trackObservableTimers(dtS);
    this.recompute(ctx);
    return this.events;
  }

  private decayPools(dtS: number): void {
    const t = this.t;
    const rm = recoveryHalfLifeMult(t, this.profile.recovery);
    // The rocked half-life also stretches with fatigue: 8 s fresh, 13 s at
    // f = 0.8 (§2.6.1). It multiplies the head pool only.
    const fatigueStretch = 1 + t.n('rec.fatigueSlope') * this.f;
    const head = headDecayConfig(t, rm * fatigueStretch);
    this.regions.head.decay(this.nowS, dtS, head);
    this.regions.body.decay(this.nowS, dtS, bodyDecayConfig(t, rm));
    for (const side of ['left', 'right'] as Side[]) {
      this.regions.leg[side].acute.decay(this.nowS, dtS, legDecayConfig(t, rm));
      this.regions.arm[side].decay(this.nowS, dtS, armDecayConfig(t, rm));
    }
    // Swelling does not decay in-round: only the cutman's ice touches it.
  }

  private fireDelayedLiverCollapse(): void {
    if (this.nowS < this.liverFireAtS) return;
    this.liverFireAtS = Number.POSITIVE_INFINITY;
    const dur = this.liverDownS;
    this.groundedUntilS = Math.max(this.groundedUntilS, this.nowS + dur);
    this.enter(S.bodyCollapse, null, this.nowS + dur, 1);
    this.kdLog.push(this.nowS);
    this.knockedDownCue = { cause: 'legal_strike', kind: 'body' };
    this.event('knockdown', { kind: 'body', durationS: dur }, 'he folds - liver shot');
  }

  private expireStates(): void {
    for (const st of [...this.active.values()]) {
      if (this.nowS >= st.untilS) this.exit(st.id);
    }
  }

  /**
   * Threshold entries and exits (§2.3.1-§2.3.4). Entries are idempotent, so
   * this runs both after an impact and every upkeep.
   */
  private evaluateStates(nowS: number): void {
    const t = this.t;

    // ---- head -------------------------------------------------------------
    // Entry and exit thresholds differ on purpose (45 in / 35 out, 30 in /
    // 25 out): the hysteresis is what stops a fighter flickering in and out of
    // rocked on the decay curve.
    const a = this.regions.head.acute;
    if (!this.has(S.ko)) {
      if (this.has(S.rocked)) {
        if (a < t.n('dmg.head.exit.rocked')) this.exit(S.rocked);
      } else if (a >= t.n('dmg.head.thr.rocked')) {
        // rs saturates at the knockdown threshold: 45 -> 0, 65 -> 1.
        const rs = clamp((a - t.n('dmg.head.thr.rocked')) / t.n('dmg.head.rockedSevSpan'), 0, 1);
        this.enter(S.rocked, null, Number.POSITIVE_INFINITY, rs);
      }
      if (this.has(S.rocked)) {
        this.exit(S.stunned);
      } else if (this.has(S.stunned)) {
        if (a < t.n('dmg.head.exit.stunned')) this.exit(S.stunned);
      } else if (a >= t.n('dmg.head.thr.stunned')) {
        this.enter(S.stunned, null, Number.POSITIVE_INFINITY, 1);
      }
    }

    // ---- swelling / eye ---------------------------------------------------
    for (const side of ['left', 'right'] as Side[]) {
      if (this.regions.swell[side] >= t.n('dmg.swell.shutAt')) {
        this.enter(S.eyeSwollenShut, side, Number.POSITIVE_INFINITY, 1);
        this.doctorRequested = true;
      }
    }

    // ---- body -------------------------------------------------------------
    const ba = this.regions.body.acute;
    const bs = this.regions.body.structural;
    if (ba >= t.n('dmg.body.thr.collapse') && !this.has(S.bodyCollapse)) {
      // The immediate collapse at body acute >= 80. Its grounded window is
      // U(5, 20) s in the chapter, but upkeep draws nothing (09 §2.7 P2), so a
      // collapse discovered here takes the midpoint of that range.
      this.startBodyCollapse(0.5);
    }
    if (ba >= t.n('dmg.body.thr.hurt')) this.enter(S.bodyHurt, null, Number.POSITIVE_INFINITY, 1);
    else if (ba < t.n('dmg.body.thr.hurtExit')) this.exit(S.bodyHurt);
    if (bs >= t.n('dmg.body.thr.worn')) {
      this.enter(S.bodyWorn, null, Number.POSITIVE_INFINITY, bs >= t.n('dmg.body.thr.worn2') ? 2 : 1);
    } else if (bs < t.n('dmg.body.thr.wornExit')) {
      this.exit(S.bodyWorn);
    }

    // ---- legs -------------------------------------------------------------
    for (const side of ['left', 'right'] as Side[]) {
      const leg = this.regions.leg[side];
      const sev = legSeverity(t, legLoad(t, leg), leg.acute.acute);
      if (sev >= 4) {
        this.enter(S.legCollapse, side, Number.POSITIVE_INFINITY, 1);
        this.enter(S.legCompromised, side, Number.POSITIVE_INFINITY, 3);
      } else if (sev >= 1) {
        this.exit(sideId(S.legCollapse, side));
        this.enter(S.legCompromised, side, Number.POSITIVE_INFINITY, sev);
      } else {
        this.exit(sideId(S.legCollapse, side));
        this.exit(sideId(S.legCompromised, side));
      }
    }

    // ---- arms -------------------------------------------------------------
    for (const side of ['left', 'right'] as Side[]) {
      const arm = this.regions.arm[side];
      if (arm.structural >= t.n('dmg.arm.deadArmThr')) {
        const existing = this.active.get(sideId(S.deadArm, side));
        const until = Math.max(existing?.untilS ?? 0, nowS + t.n('dmg.arm.deadArmMinDur'));
        this.enter(S.deadArm, side, until, 1);
      } else if (arm.structural < t.n('dmg.arm.deadArmExit')) {
        const existing = this.active.get(sideId(S.deadArm, side));
        // Minimum 60 s, then it clears once the pool has come down (§2.3.4).
        if (existing && nowS >= existing.untilS) this.exit(existing.id);
      }
    }

    // ---- energy-driven flags ----------------------------------------------
    if (this.energy.secondWindActive) this.enter(S.secondWind, null, Number.POSITIVE_INFINITY, 1);
    else this.exit(S.secondWind);
    if (this.energy.dumpActive) this.enter(S.adrenalineDump, null, Number.POSITIVE_INFINITY, 1);
    else this.exit(S.adrenalineDump);
  }

  private trackObservableTimers(dtS: number): void {
    const t = this.t;
    while (this.absorbLog.length > 0 && this.absorbLog[0].tS < this.nowS - ABSORBED_WINDOW_S) {
      this.absorbLog.shift();
    }
    while (this.kdLog.length > 0 && this.kdLog[0] < this.nowS - KNOCKDOWN_WINDOW_S) this.kdLog.shift();

    const inEye = this.cuts.some((c) => c.severity >= 2
      && (c.site.startsWith('brow') || c.site.startsWith('eyelid')));
    if (inEye) this.bloodInEyeS += dtS;

    const a = this.regions.head.acute;
    if (a >= 85) {
      if (this.highAcuteSinceS === Number.POSITIVE_INFINITY) this.highAcuteSinceS = this.nowS;
    } else {
      this.highAcuteSinceS = Number.POSITIVE_INFINITY;
    }

    // Doctor-check triggers (§2.3.6). 06 decides what to do with them.
    const worstCut = this.cuts.reduce((m, c) => Math.max(m, c.severity), 0);
    if (worstCut >= 3) this.doctorRequested = true;
    if (this.cuts.some((c) => c.severity >= 2 && c.site.startsWith('eyelid'))) this.doctorRequested = true;
    if (this.bloodInEyeS > t.n('dmg.cut.doctor.bloodInEyeS')) this.doctorRequested = true;
    if (this.has(S.noseBroken) && this.regions.head.structural >= t.n('dmg.nose.doctorStructural')) {
      this.doctorRequested = true;
    }
  }

  // =========================================================================
  // §2.5.4 / §2.3 round break — no draws
  // =========================================================================

  roundBreak(opts: RoundBreakOptions = {}): DamageEvent[] {
    this.events = [];
    const t = this.t;
    const breakSeconds = opts.breakSeconds ?? 60;
    const sitDown = opts.sitDown ?? this.profile.corner.sitDown;
    const breatheCue = opts.breatheCue ?? this.profile.corner.breatheCue;

    // Acute pools simply continue their in-round decay through the break —
    // "saved by the bell" comes out clear-headed but keeps the structural tax.
    // Stepped a second at a time so freeze windows and state timers expire in
    // the right order; still deterministic, still no draws.
    for (let s = 0; s < breakSeconds; s++) {
      this.nowS += 1;
      this.decayPools(1);
      this.expireStates();
    }

    // Structural: the recoverable part only (§2.3).
    this.regions.head.breakRecover(t.n('dmg.head.breakRecovery'), breakSeconds);
    this.regions.body.breakRecover(t.n('dmg.body.breakRecovery'), breakSeconds);
    for (const side of ['left', 'right'] as Side[]) {
      const leg = this.regions.leg[side];
      for (const pool of [leg.thigh, leg.calf, leg.shin, leg.knee]) {
        pool.breakRecover(t.n('dmg.leg.breakRecovery'), breakSeconds);
      }
      this.regions.arm[side].breakRecover(t.n('dmg.arm.breakRecovery'), breakSeconds);
      this.regions.swell[side] *= 1 - t.n('dmg.swell.breakRecovery');
    }

    this.cutmanWork();
    this.energy.roundBreak({ breakSeconds, sitDown, breatheCue });

    this.round = opts.round ?? this.round + 1;
    this.roundTimeS = 0;
    this.evaluateStates(this.nowS);
    this.recompute();
    return this.events;
  }

  /** §2.3.6: the worst cut goes down one severity, and re-opens on 2 clean hits. */
  private cutmanWork(): void {
    if (this.cuts.length === 0) return;
    const t = this.t;
    if (this.profile.corner.cutmanSkill <= 0) return;
    let worst = this.cuts[0];
    for (const c of this.cuts) if (c.severity > worst.severity) worst = c;
    if (worst.severity <= 1) return;
    worst.treatedSeverity = worst.severity;
    worst.severity = Math.max(1, worst.severity - t.n('dmg.cut.cutmanReduce')) as 1 | 2 | 3;
    worst.bleedRate = worst.severity;
    worst.cleanHitsSinceOpen = 0;
    worst.hitsSinceTreated = 0;
  }

  // =========================================================================
  // §2.3.8 states chapter 04 hands over
  // =========================================================================

  applyChokeOut(heldPastLocS: number, draw: number): void {
    const t = this.t;
    // 2-5 s after a prompt release; 10-20 s if held >= 4 s past LOC
    // `[S: SUBPHYS §1 Sasaki 2022]`.
    const dur = heldPastLocS >= 4 ? lerpDraw(draw, 10, 20) : lerpDraw(draw, 2, 5);
    this.unconsciousUntilS = this.nowS + dur;
    this.groundedUntilS = this.unconsciousUntilS;
    this.enter(S.chokedOut, null, this.unconsciousUntilS, 1);
    // No chin write: a single sportive LOC leaves no lasting deficit (§2.4.6).
    this.recompute();
  }

  applyJointFailure(joint: Joint): void {
    this.active.set(`${S.jointFailure}.${joint}`, {
      id: `${S.jointFailure}.${joint}`,
      base: S.jointFailure,
      side: null,
      sinceS: this.nowS,
      untilS: Number.POSITIVE_INFINITY,
      severity: 3,
    });
    this.recompute();
  }

  applyNeckCrank(): void {
    this.enter(S.neckCranked, null, Number.POSITIVE_INFINITY, 1);
    this.recompute();
  }

  // =========================================================================
  // Capability vector (§2.3.7 x §2.5.5) and cues (§2.7)
  // =========================================================================

  private recompute(ctx?: UpkeepContext): void {
    const t = this.t;
    const caps = neutralCaps();

    for (const st of this.active.values()) multiplyScalar(caps, stateCaps(t, st.base, st.severity));

    // Vision: swelling compounded with brow/eyelid cuts, per side.
    const vL = visionFor(t, this.regions.swell.left, this.cuts, 'left');
    const vR = visionFor(t, this.regions.swell.right, this.cuts, 'right');
    multiplyScalar(caps, visionCaps(t, (vL + vR) / 2));

    // Legs: the §2.3.3 curves, per side, then the combined movement multiplier.
    const loads: Record<Side, number> = {
      left: legLoad(t, this.regions.leg.left),
      right: legLoad(t, this.regions.leg.right),
    };
    const mob: Record<Side, number> = {
      left: legMobility(t, loads.left),
      right: legMobility(t, loads.right),
    };
    caps.movement *= combinedMovement(t, mob.left, mob.right);
    caps.tdd *= Math.min(legTdd(t, loads.left), legTdd(t, loads.right));
    for (const side of ['left', 'right'] as Side[]) {
      caps.kickPower[side] *= legKickPower(t, loads[side]);
      caps.checkSpeed[side] *= legCheckSpeed(t, loads[side]);
      caps.kickRate[side] *= legKickRate(t, this.severityOf(S.legCompromised, side));
      const shin = shinPenalty(t, this.regions.leg[side].shin.structural);
      caps.kickRate[side] *= shin.rate;
      caps.kickPower[side] *= shin.power;
      if (this.has(S.deadLeg, side)) {
        caps.movement *= t.n('dmg.leg.deadLeg.move');
        caps.checkSpeed[side] *= t.n('dmg.leg.deadLeg.check');
        caps.kickPower[side] *= t.n('dmg.leg.deadLeg.kick');
        caps.tdd *= t.n('dmg.leg.deadLeg.tdd');
      }
      if (this.has(S.kneeInjured, side)) caps.movement *= t.n('dmg.leg.kneeMove');
      if (this.has(S.deadArm, side)) {
        caps.guard[side] *= t.n('dmg.arm.deadArmGuard');
        caps.handPower[side] *= t.n('dmg.arm.deadArmPower');
      }
      if (this.has(S.handInjured, side)) {
        caps.handPower[side] *= t.n('dmg.hand.power');
        caps.handRate[side] *= t.n('dmg.hand.useFreq');
      }
      if (this.has(S.footInjured, side)) {
        caps.kickPower[side] *= t.n('dmg.foot.power');
        caps.kickRate[side] *= t.n('dmg.foot.freq');
      }
      if (this.has(S.limbFracture, side)) {
        caps.kickPower[side] = 0;
        caps.kickRate[side] = 0;
      }
    }
    // A damaged rear leg costs the rear hand up to 20 % `[S: DAMAGE §2.3]`.
    caps.handPower[this.rearSide] *= rearHandPower(t, loads[this.rearSide]);

    for (const st of this.active.values()) {
      if (st.base === S.jointFailure) caps.tdd *= t.n('dmg.caps.jointFailure.tdd');
    }

    // Fatigue (§2.5.5) composes multiplicatively with all of the above.
    const fc = this.energy;
    const fcaps = fatigueCaps(t, fc.f);
    caps.power *= fcaps.powerLinear;
    caps.powerRotational *= fcaps.powerRotational;
    caps.speed *= fcaps.speed;
    caps.accuracy *= fcaps.accuracy;
    caps.defence *= fcaps.defence;
    caps.tdd *= fcaps.tdd;
    caps.movement *= fcaps.movement;
    caps.output *= fc.paceBudget;
    caps.decision *= fc.decisionMult;
    caps.gripStrength *= fc.gripStrengthMult;

    if (this.has(S.ko) || this.has(S.chokedOut) || !this.conscious) {
      caps.movement = 0; caps.defence = 0; caps.output = 0; caps.decision = 0;
    }

    this.caps_ = caps;
    this.obs = this.buildObservables(vL, vR, loads, ctx);
  }

  private buildObservables(
    vL: number,
    vR: number,
    loads: Record<Side, number>,
    ctx?: UpkeepContext,
  ): RefObservables {
    const t = this.t;
    const o = emptyObservables();
    const a = this.regions.head.acute;
    const ko = this.has(S.ko) || this.has(S.chokedOut);

    o.ko = ko;
    o.rocked = this.has(S.rocked);
    o.stunned = this.has(S.stunned);

    const kdHurtActive = this.has(S.knockdownHurt);
    o.limpness = ko || (a >= 85 && this.nowS - this.highAcuteSinceS > 1)
      ? 2
      : (a >= 70 || kdHurtActive ? 1 : 0);
    o.limp = o.limpness >= 1;

    const collapse = this.active.get(S.bodyCollapse);
    o.bodyCollapse = { on: !!collapse, tSinceS: collapse ? this.nowS - collapse.sinceS : 0 };
    const legColl = this.active.get(sideId(S.legCollapse, 'left'))
      ?? this.active.get(sideId(S.legCollapse, 'right'));
    o.legCollapse = { on: !!legColl, tSinceS: legColl ? this.nowS - legColl.sinceS : 0 };

    o.unansweredHead = this.unansweredHead;
    o.absorbedWindow30 = this.absorbLog.length;
    o.tSinceDefenceS = this.nowS - this.lastDefenceS;
    o.consciousness = ko || !this.conscious ? 0 : clamp(1 - this.chokeProgress, 0, 1);
    o.cuts = this.cuts.map((c) => ({
      site: c.site,
      severity: c.severity,
      bleedIntoEye: c.severity >= 2 && (c.site.startsWith('brow') || c.site.startsWith('eyelid')),
    }));
    o.visionL = vL;
    o.visionR = vR;
    o.eyeSwollenShut = this.has(S.eyeSwollenShut, 'left') || this.has(S.eyeSwollenShut, 'right');
    o.fractureFlag = this.has(S.limbFracture, 'left') || this.has(S.limbFracture, 'right')
      ? 'leg'
      : this.has(S.handInjured, 'left') || this.has(S.handInjured, 'right')
        ? 'hand'
        : this.has(S.noseBroken) ? 'nose' : null;
    if (this.knockedDownCue) o.knockedDown = this.knockedDownCue;

    o.grounded = this.grounded || (ctx?.grounded ?? false);
    o.intelligentDefence = o.tSinceDefenceS < INTELLIGENT_DEFENCE_WINDOW_S;
    o.cannotStand = (this.has(S.legCollapse, 'left') || this.has(S.legCollapse, 'right'))
      && Math.max(this.regions.leg.left.acute.acute, this.regions.leg.right.acute.acute)
        >= t.n('dmg.leg.thr.cannotStandAcute');
    // 07 intends; physiology overrides (§2.7).
    o.attemptingToRise = (ctx?.attemptingToRise ?? false)
      && !o.bodyCollapse.on && !o.cannotStand && this.nowS >= this.riseAllowedAtS;

    o.tapped = ctx?.tapped ?? false;
    o.verbalTap = ctx?.verbalTap ?? false;
    o.screams = ctx?.screams ?? false;
    o.jointFailed = ctx?.jointFailed ?? [...this.active.values()].some((s) => s.base === S.jointFailure);
    o.defenceQuality30 = ctx?.defenceQuality30 ?? 1;
    o.knockdownsLast10s = this.kdLog.length;
    o.underChoke = ctx?.underChoke ?? false;
    o.clinching = ctx?.clinching ?? false;
    o.moving = ctx?.moving ?? false;

    o.coveringStaticS = this.coveringStaticS;
    o.eyesCue = this.eyesCue(a, ko);
    o.reactionCue = this.reactionCue();
    o.legsCue = this.legsCue();
    o.bloodInEyeS = this.bloodInEyeS;
    o.doctorCheckRequested = this.doctorRequested;
    o.mouthOpen = this.f > 0.6 || this.severityOf(S.bodyWorn) >= 2;

    const cutScore = clamp(
      this.cuts.reduce((m, c) => Math.max(m, c.severity), 0) / 3
        + Math.max(this.regions.swell.left, this.regions.swell.right) / 100,
      0, 1,
    );
    const legScore = clamp(Math.max(loads.left, loads.right) / 100, 0, 1);
    o.visibleDamageScore = clamp(
      0.5 * clamp(a / 65, 0, 1) + 0.3 * cutScore + 0.2 * legScore, 0, 1,
    );
    return o;
  }

  private eyesCue(acute: number, ko: boolean): EyesCue {
    if (ko || !this.conscious) return 'closed';
    if (acute >= 85) return 'rolled';
    if (this.has(S.rocked)) return 'glassy';
    return 'normal';
  }

  private reactionCue(): ReactionCue {
    const beingHit = this.nowS - this.lastHitAnyS <= NO_REACTION_WINDOW_S;
    if (beingHit && this.nowS - this.lastDefenceS >= NO_REACTION_WINDOW_S) return 'none';
    if (this.has(S.rocked) || this.has(S.stunned)) return 'slow';
    return 'normal';
  }

  private legsCue(): LegsCue {
    if (this.has(S.knockdownHurt)) return 'gone';
    if (!this.has(S.rocked)) return 'normal';
    return this.severityOf(S.rocked) >= 0.5 ? 'gone' : 'wobble';
  }

  observables(): RefObservables {
    return this.obs;
  }

  // =========================================================================
  // Snapshot (09 §1.3.2)
  // =========================================================================

  /** The six `FighterSnapshot` fields this chapter owns. */
  snapshotFields(): Pick<
    FighterSnapshot, 'damage' | 'stamina' | 'state' | 'states' | 'damageVisual' | 'fatigueVisual'
  > {
    const t = this.t;
    const loadL = legLoad(t, this.regions.leg.left);
    const loadR = legLoad(t, this.regions.leg.right);
    const worstCut = this.cuts.reduce((m, c) => Math.max(m, c.severity), 0);
    const f = this.f;
    return {
      // `head >= 1` is the KO threshold crossing, per the snapshot contract.
      damage: {
        head: clamp(this.regions.head.acute / t.n('dmg.head.thr.ko'), 0, 1),
        body: clamp(this.regions.body.acute / 100, 0, 1),
        legs: clamp(Math.max(loadL, loadR) / 100, 0, 1),
        cut: worstCut / 3,
      },
      stamina: {
        total: clamp(1 - f, 0, 1),
        burst: clamp(this.energy.pcr / 100, 0, 1),
      },
      state: this.stateBits(),
      states: this.states,
      damageVisual: {
        // `legLoad` weights the calf x1.1 and the knee x1.2, so it can exceed
        // 100; the visual zones are a 0-1 contract and are clamped.
        zones: [
          this.regions.head.structural / 100,
          this.regions.body.structural / 100,
          clamp(loadL / 100, 0, 1),
          clamp(loadR / 100, 0, 1),
          this.regions.arm.left.structural / 100,
          this.regions.arm.right.structural / 100,
        ],
        swelling: [this.regions.swell.left / 100, this.regions.swell.right / 100],
        cuts: this.cuts.map((c) => ({
          site: c.site,
          severity: c.severity,
          bleeding: c.severity >= 2 || this.nowS - c.openedS < t.n('dmg.cut.bloodRecentS'),
          ageS: this.nowS - c.openedS,
        })),
        bloodOnGloves: 0,
      },
      // Presentation only (08): breathing runs from a resting ~12 breaths per
      // minute to ~48 at f = 1, and the three tells are read straight off the
      // capability vector so the animation can never disagree with the model.
      fatigueVisual: {
        f,
        breathingRate: 12 + 36 * f,
        handsDrop: clamp(1 - this.caps_.defence, 0, 1),
        flatFeet: clamp(1 - this.caps_.movement, 0, 1),
        chinUp: clamp(f - 0.4, 0, 1),
      },
    };
  }

  private stateBits(): number {
    let bits = 0;
    if (this.has(S.stunned)) bits |= STATE_BITS.stunned;
    if (this.has(S.rocked)) bits |= STATE_BITS.rocked;
    if (this.has(S.knockdownFlash) || this.has(S.knockdownHurt)) bits |= STATE_BITS.knockdown;
    if (this.has(S.ko) || this.has(S.chokedOut)) bits |= STATE_BITS.ko;
    if (this.has(S.bodyHurt)) bits |= STATE_BITS.bodyHurt;
    if (this.has(S.bodyWorn)) bits |= STATE_BITS.bodyWorn;
    if (this.has(S.winded)) bits |= STATE_BITS.winded;
    if (this.has(S.bodyCollapse)) bits |= STATE_BITS.bodyCollapse;
    for (const side of ['left', 'right'] as Side[]) {
      if (this.has(S.deadLeg, side)) bits |= STATE_BITS.deadLeg;
      if (this.has(S.legCompromised, side)) bits |= STATE_BITS.legCompromised;
      if (this.has(S.legCollapse, side)) bits |= STATE_BITS.legCollapse;
      if (this.has(S.deadArm, side)) bits |= STATE_BITS.deadArm;
      if (this.has(S.handInjured, side)) bits |= STATE_BITS.handInjured;
      if (this.has(S.eyeSwollenShut, side)) bits |= STATE_BITS.eyeSwollenShut;
      if (this.has(S.limbFracture, side)) bits |= STATE_BITS.limbFracture;
    }
    if (this.has(S.noseBroken)) bits |= STATE_BITS.noseBroken;
    if (this.has(S.secondWind)) bits |= STATE_BITS.secondWind;
    if (this.has(S.adrenalineDump)) bits |= STATE_BITS.adrenalineDump;
    if (this.grounded) bits |= STATE_BITS.grounded;
    if (this.cuts.length > 0) bits |= STATE_BITS.cut;
    return bits;
  }

  // =========================================================================
  // State-set plumbing
  // =========================================================================

  private enter(base: string, side: Side | null, untilS: number, severity: number): void {
    const id = side ? sideId(base, side) : base;
    const existing = this.active.get(id);
    if (existing) {
      // Severity can rise but never fall while the state is held (§2.4.3 step 6).
      existing.severity = Math.max(existing.severity, severity);
      existing.untilS = Math.max(existing.untilS, untilS);
      return;
    }
    this.active.set(id, { id, base, side, sinceS: this.nowS, untilS, severity });
    this.event('stateChange', { state: id, on: true, severity }, `${id} on`);
  }

  private exit(id: string): void {
    if (!this.active.delete(id)) return;
    this.event('stateChange', { state: id, on: false }, `${id} off`);
  }

  private event(
    kind: DamageEvent['kind'],
    detail: DamageEvent['detail'],
    text: string,
  ): void {
    this.events.push({
      tick: this.tick,
      subMs: 0,
      round: this.round,
      kind,
      actor: this.profile.id,
      target: this.profile.id,
      text,
      detail,
    });
  }
}
