/**
 * FATIGUE — the three-pool energy model (§2.5).
 *
 *   phosphagen `pcr`  0-100   burst capacity: power strikes, shots, squeezes
 *   glycolytic `lac`  1-22    mmol/L of acidosis; clears at 0.4 mmol/L per
 *                             MINUTE, so within a bout it only ever goes up
 *   aerobic    `aer`  0-1     debt; how fast PCr refills and lactate clears
 *
 * The one-scalar `stamina` of the old engine is gone. Three pools with
 * different time constants are what produce the behaviours a single pool can
 * never produce:
 *
 *  - **Front-runner fade is emergent** (§2.5.9). There is no fade parameter.
 *    Lactate does not clear, and `pcrCeil = 100 - 1.2 * max(0, lac - 8)`, so a
 *    fighter who ran at high intensity in round 1 starts round 3 with a lower
 *    ceiling on their burst pool and a higher aerobic debt. High-`cardio`
 *    fighters clear faster and fade less. Verified in `tests/damage.test.ts`.
 *  - **"Gassed in round 2"** falls out of the adrenaline dump (§2.5.7): a
 *    low-experience, low-composure fighter pays 1.6x for everything in the
 *    first 150 s, and the lactate carries over.
 *  - **Second wind** (§2.5.9) is explicitly psychological: 40 s of low
 *    intensity after a hard spell buys 60 s of output and decision bonus, once
 *    per round.
 *
 * Nothing in this file draws from the RNG: every update is deterministic in
 * (dt, state, parameters), which is what lets `upkeep` draw nothing (09 §2.7).
 */
import { clamp, decayBy, type Tuning } from './tuning';
import type { FighterDamageProfile } from './profile';
import type { ImpactPosture } from './impact';

// ---------------------------------------------------------------------------
// Action classes (§2.5.1)
// ---------------------------------------------------------------------------

export type TechClass =
  | 'lightStrike' | 'feint' | 'powerStrike' | 'heavyStrike'
  | 'takedownAttempt' | 'sprawl'
  | 'clinchPummel' | 'clinchHoldDominant' | 'wallPinned' | 'wallPinning' | 'wallWalk'
  | 'groundBottomPressured' | 'groundBottomActive' | 'groundTopHold' | 'groundTopPassAttempt'
  | 'gnpStrike' | 'submissionSqueeze' | 'submissionEscape' | 'scramble'
  | 'movementHighPace' | 'movementLowPace' | 'idleStanding';

/** How a class is charged: once per action, per second, or per ten seconds. */
export type ChargeRate = 'action' | 'perSecond' | 'perTenSeconds';

export const CLASS_RATE: Readonly<Record<TechClass, ChargeRate>> = Object.freeze({
  lightStrike: 'action',
  feint: 'action',
  powerStrike: 'action',
  heavyStrike: 'action',
  takedownAttempt: 'action',
  sprawl: 'action',
  wallWalk: 'action',
  groundTopPassAttempt: 'action',
  gnpStrike: 'action',
  clinchPummel: 'perTenSeconds',
  clinchHoldDominant: 'perTenSeconds',
  wallPinned: 'perTenSeconds',
  wallPinning: 'perTenSeconds',
  groundBottomPressured: 'perTenSeconds',
  groundBottomActive: 'perTenSeconds',
  groundTopHold: 'perTenSeconds',
  submissionSqueeze: 'perTenSeconds',
  submissionEscape: 'perTenSeconds',
  scramble: 'perSecond',
  movementHighPace: 'perSecond',
  movementLowPace: 'perSecond',
  idleStanding: 'perSecond',
});

/** Grappling classes pay 01's `energy.actionCostMult` instead of the striking
 *  skill slope — the tier multiplier 01 and 03 both carried, applied once here
 *  (REVIEW). */
const GRAPPLING_CLASSES: ReadonlySet<TechClass> = new Set<TechClass>([
  'takedownAttempt', 'sprawl', 'clinchPummel', 'clinchHoldDominant',
  'wallPinned', 'wallPinning', 'wallWalk', 'groundBottomPressured',
  'groundBottomActive', 'groundTopHold', 'groundTopPassAttempt',
  'submissionSqueeze', 'submissionEscape', 'scramble',
]);

/** The grip channel is charged only by gripping work (§2.5.10). */
const GRIP_CLASSES: ReadonlySet<TechClass> = new Set<TechClass>([
  'clinchPummel', 'submissionSqueeze', 'submissionEscape', 'wallPinned',
  'wallPinning', 'wallWalk',
]);

/** Strike classes, for the flurry tax and the intensity window. */
const STRIKE_CLASSES: ReadonlySet<TechClass> = new Set<TechClass>([
  'lightStrike', 'powerStrike', 'heavyStrike', 'gnpStrike',
]);

export function isGrapplePosture(p: ImpactPosture): boolean {
  return p === 'clinch' || p === 'groundTop' || p === 'groundBottom' || p === 'wallPinned';
}

// ---------------------------------------------------------------------------
// Capability effects (§2.5.5)
// ---------------------------------------------------------------------------

export interface FatigueCaps {
  powerLinear: number;
  powerRotational: number;
  speed: number;
  output: number;
  accuracy: number;
  defence: number;
  tdd: number;
  decision: number;
  movement: number;
}

/**
 * §2.5.5. Anchors at f = 0.5 / 0.8 from DAMAGE §4.3; the exponents are the
 * chapter's shape estimates. Defence dies first (0.80 -> 0.55), power holds up
 * best (Pierce 2006 found no force decline across pro-boxing rounds), and
 * rotational punches lose about twice what the jab loses (Dunn 2022).
 */
export function fatigueCaps(t: Tuning, f: number): FatigueCaps {
  const x = clamp(f, 0, 1);
  return {
    powerRotational: 1 - t.n('fat.eff.powerRot.a') * Math.pow(x, t.n('fat.eff.powerRot.p')),
    powerLinear: 1 - t.n('fat.eff.powerLinear.a') * x,
    speed: 1 - t.n('fat.eff.speed.a') * x,
    output: 1 - t.n('fat.eff.output.a') * Math.pow(x, t.n('fat.eff.output.p')),
    accuracy: 1 - t.n('fat.eff.accuracy.a') * x,
    defence: 1 - t.n('fat.eff.defence.a') * Math.pow(x, t.n('fat.eff.defence.p')),
    tdd: 1 - t.n('fat.eff.td.a') * x,
    decision: 1 - t.n('fat.eff.decision.a') * x,
    movement: 1 - t.n('fat.eff.moveCap.a') * x,
  };
}

// ---------------------------------------------------------------------------
// Energy state
// ---------------------------------------------------------------------------

export interface EnergyContext {
  /** Drives the grapple re-weighting of `f` (§2.5.3). */
  posture: ImpactPosture;
  /** Body structural pool, 0-100: costs rise and aerobic refill falls (§2.5.6). */
  bodyStructural: number;
  round: number;
  /** Seconds since the start of the current round (the dump window). */
  roundTimeS: number;
  /** `state.winded` blocks PCr refill entirely (§2.3.2). */
  refillBlocked: boolean;
  /** `state.nose_broken` — mouth breathing, aerobic refill x0.92. */
  noseBroken: boolean;
}

export interface BreakOptions {
  breakSeconds: number;
  /** T0-T1 habit, or a ruleset with no stools: refill x0.85, aer recovery x0.8. */
  sitDown: boolean;
  /** A T3+ corner telling the fighter to breathe: aer multiplier 0.65 -> 0.60. */
  breatheCue: boolean;
}

export interface ChargeOptions {
  /** Relevant striking sub-skill, 0-100. Defaults to the profile's. */
  skill?: number;
  /** Multiply the base cost (a partial second of a sustained posture, say). */
  scale?: number;
}

export class EnergyState {
  pcr = 100;
  lac: number;
  aer = 0;
  /** Fourth, cheap accumulator: forearms and hands (§2.5.10). Not in `f`. */
  grip = 0;

  private nowS = 0;
  private ctx: EnergyContext = {
    posture: 'distance',
    bodyStructural: 0,
    round: 1,
    roundTimeS: 0,
    refillBlocked: false,
    noseBroken: false,
  };

  /** PCr spent in the trailing `fat.intensityWindowS`, as (time, amount). */
  private readonly spendLog: { tS: number; pcr: number }[] = [];
  private readonly strikeLog: number[] = [];
  private flurryCharged = false;

  /** 60 s tax after a body hit of raw >= 35 (§2.5.6). */
  private bodyShotUntilS = Number.NEGATIVE_INFINITY;

  // second wind bookkeeping (§2.5.9)
  private lowIntensityS = 0;
  private peakFInSpell = 0;
  private secondWindUntilS = Number.NEGATIVE_INFINITY;
  private secondWindUsedRound = 0;

  constructor(
    private readonly t: Tuning,
    private readonly profile: FighterDamageProfile,
  ) {
    this.lac = t.n('fat.lacMin');
  }

  // ---- derived rates ------------------------------------------------------

  /**
   * §2.5. `(1 + 0.008 * (cardio - 50))` with the dehydration, altitude, nose
   * and body-damage multipliers. 01's energy composites are authoritative where
   * they exist (REVIEW): `lactateClearance` and `pcrRefillHalfLifeS` are read
   * directly in the regeneration step.
   */
  get aerobicRate(): number {
    const t = this.t;
    const p = this.profile;
    const cardio = 1 + t.n('fat.cardioSlope') * (p.cardio - 50);
    const dehyd = 1 - t.n('fat.dehydAerobicSlope') * clamp(p.residualDehydration, 0, 0.05);
    const alt = 1 - t.n('fat.alt.vo2PerKm')
      * Math.max(0, p.altitudeM - t.n('fat.alt.baseM')) / 1000
      * (p.acclimatised ? t.n('fat.alt.acclimMult') : 1);
    const nose = this.ctx.noseBroken ? t.n('dmg.nose.aerobicMult') : 1;
    const body = 1 - t.n('fat.bodyAerobicSlope') * clamp(this.ctx.bodyStructural, 0, 100);
    const bodyShot = this.nowS < this.bodyShotUntilS ? t.n('fat.bodyShot.aerobicMult') : 1;
    return Math.max(0.1, cardio * dehyd * alt * nose * body * bodyShot);
  }

  /** PCr ceiling: lactate above 8 mmol/L and residual dehydration both cut it. */
  get pcrCeiling(): number {
    const t = this.t;
    const lacTerm = t.n('fat.pcrCeil.lacSlope') * Math.max(0, this.lac - t.n('fat.pcrCeil.lacStart'));
    const dehyd = t.n('fat.pcrCeil.dehydPerUnit') * clamp(this.profile.residualDehydration, 0, 0.05);
    return clamp(100 - lacTerm - dehyd, 0, 100);
  }

  /** PCr spend over the trailing window / `fat.intensityRef`, clamped 0-1. */
  get intensity(): number {
    const window = this.t.n('fat.intensityWindowS');
    let sum = 0;
    for (const e of this.spendLog) if (e.tS >= this.nowS - window) sum += e.pcr;
    return clamp(sum / this.t.n('fat.intensityRef'), 0, 1);
  }

  // Perf: `f` is read dozens of times per fighter per tick but only changes
  // when a pool or the posture does, so the last value is memoised against
  // exactly the inputs it is a pure function of (compared with `Object.is`, so
  // a signed zero or a NaN is never mistaken for a hit). The tuning behind
  // `t.n` is immutable for the life of the bout.
  private fMemoGrapple = false;
  private fMemoPcr = Number.NaN;
  private fMemoLac = Number.NaN;
  private fMemoAer = Number.NaN;
  private fMemo = 0;
  private capsMemoF = Number.NaN;
  private capsMemo: FatigueCaps | null = null;

  /** §2.5.3. The number every other section reads. */
  get f(): number {
    const grapple = isGrapplePosture(this.ctx.posture);
    if (grapple === this.fMemoGrapple && Object.is(this.pcr, this.fMemoPcr)
      && Object.is(this.lac, this.fMemoLac) && Object.is(this.aer, this.fMemoAer)) {
      return this.fMemo;
    }
    const t = this.t;
    const wP = grapple ? t.n('fat.f.w.grapple.pcr') : t.n('fat.f.w.pcr');
    const wL = grapple ? t.n('fat.f.w.grapple.lac') : t.n('fat.f.w.lac');
    const wA = grapple ? t.n('fat.f.w.grapple.aer') : t.n('fat.f.w.aer');
    const lacTerm = clamp((this.lac - t.n('fat.f.lacStart')) / t.n('fat.f.lacSpan'), 0, 1);
    const f = clamp(wP * (1 - this.pcr / 100) + wL * lacTerm + wA * this.aer, 0, 1);
    this.fMemoGrapple = grapple;
    this.fMemoPcr = this.pcr;
    this.fMemoLac = this.lac;
    this.fMemoAer = this.aer;
    this.fMemo = f;
    return f;
  }

  /**
   * `fatigueCaps(t, this.f)`, memoised on `f`. The returned object is shared:
   * callers read it and must not write to it.
   */
  get caps(): Readonly<FatigueCaps> {
    const f = this.f;
    if (this.capsMemo === null || !Object.is(f, this.capsMemoF)) {
      this.capsMemo = fatigueCaps(this.t, f);
      this.capsMemoF = f;
    }
    return this.capsMemo;
  }

  /** §2.5.7. The dump is a property of the fighter and the occasion. */
  get dump(): number {
    const t = this.t;
    const p = this.profile;
    let magnitude = t.table('fat.dump.magnitude', p.eventMagnitude);
    if (p.hostileCrowd) magnitude += t.n('fat.dump.magnitude.hostileCrowd');
    return clamp((1 - p.experience) * (1 - p.composureEff / 100) * magnitude, 0, 1);
  }

  /** True during round 1's first `fat.dump.durS` seconds. */
  get dumpActive(): boolean {
    return this.ctx.round === 1 && this.ctx.roundTimeS < this.t.n('fat.dump.durS');
  }

  get secondWindActive(): boolean {
    return this.nowS < this.secondWindUntilS;
  }

  /** §2.5.10. Grip strength for 03/04: -16 % at a full grip pool. */
  get gripStrengthMult(): number {
    return 1 - this.t.n('fat.grip.strengthLoss') * clamp(this.grip, 0, 100) / 100;
  }

  /**
   * The output *budget* (§2.5.5): 07 may spend it on fewer full-quality
   * exchanges (T3+) or the same number of weaker ones (T0-T2).
   */
  get paceBudget(): number {
    const t = this.t;
    let budget = this.caps.output;
    if (this.dumpActive) {
      const d = this.dump;
      budget *= this.ctx.roundTimeS < t.n('fat.dump.rushS')
        ? 1 + t.n('fat.dump.rushOutput') * d            // they rush
        : 1 - t.n('fat.dump.crashOutput') * d;          // then they crash
    }
    if (this.secondWindActive) budget *= 1 + t.n('fat.secondWind.bonus');
    return Math.max(0, budget);
  }

  /** Decision-quality multiplier from the energy side only (§2.5.5, §2.5.7). */
  get decisionMult(): number {
    const t = this.t;
    let d = this.caps.decision;
    if (this.dumpActive) d *= 1 - t.n('fat.dump.decisionMult') * this.dump;
    if (this.secondWindActive) d *= 1 + t.n('fat.secondWind.bonus');
    return Math.max(0, d);
  }

  // ---- charging -----------------------------------------------------------

  private costMultipliers(cls: TechClass, skill: number): number {
    const t = this.t;
    const p = this.profile;
    const skillMult = GRAPPLING_CLASSES.has(cls)
      ? p.energy.actionCostMult
      : 1 - t.n('fat.skillCostSlope') * (skill - 50);
    const bodyMult = 1 + t.n('fat.bodyCostSlope') * clamp(this.ctx.bodyStructural, 0, 100);
    const bodyShotMult = this.nowS < this.bodyShotUntilS ? t.n('fat.bodyShot.costMult') : 1;
    const dumpMult = this.dumpActive ? 1 + t.n('fat.dump.costMult') * this.dump : 1;
    // Perf: a `Math.pow` of the fighter's mass on every charge; memoised on
    // the one input that can change it.
    if (!Object.is(p.massKg, this.weightMultMass)) {
      this.weightMult = Math.pow(p.massKg / t.n('dmg.massRef'), t.n('fat.weightCostExp'));
      this.weightMultMass = p.massKg;
    }
    const weightMult = this.weightMult;
    return Math.max(0, skillMult) * bodyMult * bodyShotMult * dumpMult * weightMult;
  }

  private weightMultMass = Number.NaN;
  private weightMult = 1;
  private altMemoAltitude = Number.NaN;
  private altMemoAcclim = false;
  private altMemo = 1;

  private get altLacMult(): number {
    const t = this.t;
    const p = this.profile;
    // Perf: memoised on the profile fields it reads (the tuning is immutable).
    if (Object.is(p.altitudeM, this.altMemoAltitude) && p.acclimatised === this.altMemoAcclim) return this.altMemo;
    const v = 1 + t.n('fat.alt.lacPerKm')
      * Math.max(0, p.altitudeM - t.n('fat.alt.baseM')) / 1000
      * (p.acclimatised ? t.n('fat.alt.acclimMult') : 1);
    this.altMemoAltitude = p.altitudeM;
    this.altMemoAcclim = p.acclimatised;
    this.altMemo = v;
    return v;
  }

  /** Charge a cost in pool units and mmol/L, with all §2.5.1 modifiers. */
  private charge(cls: TechClass, pcrBase: number, lacBase: number, skill: number): void {
    const t = this.t;
    const mult = this.costMultipliers(cls, skill);
    const pcrCost = pcrBase * mult;
    let lacAdd = lacBase * mult * this.altLacMult;
    // An action with no PCr left still executes; the shortfall is charged as
    // extra lactate, and the action's power/speed use pcr = 0 (§2.5.1).
    const shortfall = Math.max(0, pcrCost - this.pcr);
    if (shortfall > 0) lacAdd += t.n('fat.pcrShortfallLacPerUnit') * shortfall;
    this.pcr = clamp(this.pcr - pcrCost, 0, 100);
    this.lac = clamp(this.lac + lacAdd, t.n('fat.lacMin'), t.n('fat.lacMax'));
    this.spendLog.push({ tS: this.nowS, pcr: pcrCost });
  }

  /** §2.5.10: +1.0 grip unit per 10 s of gripping work (or per gripping action). */
  private chargeGrip(cls: TechClass, tenSecondUnits: number): void {
    if (!GRIP_CLASSES.has(cls)) return;
    this.grip = clamp(this.grip + this.t.n('fat.grip.perTenS') * tenSecondUnits, 0, 100);
  }

  /** One discrete action (a strike thrown, a shot taken, a stand-up attempt). */
  spendAction(cls: TechClass, opts: ChargeOptions = {}): void {
    const t = this.t;
    const scale = opts.scale ?? 1;
    const skill = opts.skill ?? this.profile.strikingSkill;
    this.charge(cls, t.n(`fat.cost.${cls}.pcr`) * scale, t.n(`fat.cost.${cls}.lac`) * scale, skill);
    this.chargeGrip(cls, scale);
    if (STRIKE_CLASSES.has(cls)) this.noteStrike(skill);
  }

  /** `dtS` seconds of a sustained posture or movement class. */
  spendSustained(cls: TechClass, dtS: number, opts: ChargeOptions = {}): void {
    if (dtS <= 0) return;
    const t = this.t;
    const rate = CLASS_RATE[cls];
    const scale = (rate === 'perTenSeconds' ? dtS / 10 : dtS) * (opts.scale ?? 1);
    const skill = opts.skill ?? this.profile.strikingSkill;
    this.charge(cls, t.n(`fat.cost.${cls}.pcr`) * scale, t.n(`fat.cost.${cls}.lac`) * scale, skill);
    this.chargeGrip(cls, (dtS / 10) * (opts.scale ?? 1));
  }

  /** The flurry tax: >= 4 strikes inside 2 s costs extra, once per burst. */
  private noteStrike(skill: number): void {
    const t = this.t;
    const window = t.n('fat.flurry.window');
    this.strikeLog.push(this.nowS);
    while (this.strikeLog.length > 0 && this.strikeLog[0] < this.nowS - window) this.strikeLog.shift();
    if (this.strikeLog.length >= t.n('fat.flurry.count')) {
      if (!this.flurryCharged) {
        this.charge('powerStrike', t.n('fat.flurry.pcr'), t.n('fat.flurry.lac'), skill);
        this.flurryCharged = true;
      }
    } else {
      this.flurryCharged = false;
    }
  }

  /** §2.4.2 survival tax: entering rocked / knocked-down costs adrenaline. */
  survivalTax(): void {
    const t = this.t;
    this.charge('powerStrike', t.n('kd.survivalTax.pcr'), t.n('kd.survivalTax.lac'),
      this.profile.strikingSkill);
  }

  /** A body hit of `raw >= fat.bodyShot.rawThr` opens the 60-s tax (§2.5.6). */
  noteBodyShot(raw: number): void {
    if (raw >= this.t.n('fat.bodyShot.rawThr')) {
      this.bodyShotUntilS = this.nowS + this.t.n('fat.bodyShot.durS');
    }
  }

  // ---- regeneration -------------------------------------------------------

  /** §2.5.2. Deterministic: no draws (09 §2.7 P2). */
  upkeep(dtS: number, ctx: EnergyContext): void {
    const t = this.t;
    this.ctx = ctx;
    this.nowS += dtS;
    const window = t.n('fat.intensityWindowS');
    while (this.spendLog.length > 0 && this.spendLog[0].tS < this.nowS - window) this.spendLog.shift();

    const rate = this.aerobicRate;
    const intensity = this.intensity;

    if (!ctx.refillBlocked && intensity < t.n('fat.intensityGate')) {
      const half = (this.profile.energy.pcrRefillHalfLifeS || t.n('fat.pcrHalfLifeInRound'))
        / rate * (1 + t.n('fat.aerDebtSlope') * this.aer);
      this.pcr += (this.pcrCeiling - this.pcr) * (1 - Math.pow(0.5, dtS / half));
      this.pcr = clamp(this.pcr, 0, 100);
    }

    const clearPerS = t.n('fat.lacClearPerMin') / 60 * rate * this.profile.energy.lactateClearance
      * (intensity < t.n('fat.lacActiveGate') ? 1 : t.n('fat.lacActiveMult'));
    this.lac = Math.max(t.n('fat.lacMin'), this.lac - clearPerS * dtS);

    this.aer = clamp(
      this.aer + dtS * (t.n('fat.aer.upRate') * intensity
        - t.n('fat.aer.downRate') * (1 - intensity) * rate),
      0, 1,
    );

    this.grip = decayBy(this.grip, dtS, t.n('fat.grip.halfLife'));
    this.updateSecondWind(dtS);
  }

  /**
   * §2.5.9. Not physiology — PCr resynthesis is the only literature — but the
   * pattern (a fighter who survives a bad spell and comes back) is real, so it
   * is modelled explicitly and capped at once per round.
   */
  private updateSecondWind(dtS: number): void {
    const t = this.t;
    const f = this.f;
    if (this.intensity < t.n('fat.secondWind.gate')) {
      this.lowIntensityS += dtS;
      this.peakFInSpell = Math.max(this.peakFInSpell, f);
    } else {
      this.lowIntensityS = 0;
      this.peakFInSpell = f;
    }
    if (
      this.secondWindUsedRound !== this.ctx.round
      && this.lowIntensityS >= t.n('fat.secondWind.lowIntensityS')
      && this.peakFInSpell > t.n('fat.secondWind.from')
      && f < t.n('fat.secondWind.to')
    ) {
      this.secondWindUntilS = this.nowS + t.n('fat.secondWind.durS');
      this.secondWindUsedRound = this.ctx.round;
      this.peakFInSpell = f;
    }
  }

  /** §2.5.4. The break is deterministic too — round-break processing draws nothing. */
  roundBreak(opts: BreakOptions): void {
    const t = this.t;
    const rate = this.aerobicRate;
    const ceilCap = this.lac > t.n('fat.break.ceilCapLac') ? t.n('fat.break.ceilCap') : 100;
    const ceiling = Math.min(this.pcrCeiling, ceilCap);
    const half = t.n('fat.break.pcrHalfLife') / rate;
    let refill = (ceiling - this.pcr) * (1 - Math.pow(0.5, opts.breakSeconds / half));
    refill *= this.profile.energy.breakRefillFrac;
    if (!opts.sitDown) refill *= t.n('fat.break.standingPcrMult');
    this.pcr = clamp(this.pcr + refill, 0, 100);

    this.lac = Math.max(t.n('fat.lacMin'), this.lac - t.n('fat.break.lacDrop'));

    const aerMult = opts.breatheCue ? t.n('fat.break.breatheAerMult') : t.n('fat.break.aerMult');
    let recovered = 1 - aerMult;
    if (!opts.sitDown) recovered *= t.n('fat.break.standingAerMult');
    this.aer = clamp(this.aer * (1 - recovered), 0, 1);

    this.grip = clamp(this.grip * (1 - t.n('fat.grip.breakDrop')), 0, 100);

    this.nowS += opts.breakSeconds;
    this.spendLog.length = 0;
    this.strikeLog.length = 0;
    this.flurryCharged = false;
    this.lowIntensityS = 0;
    this.peakFInSpell = this.f;
  }

  /** Fight-clock seconds this pool has seen (rounds plus breaks). */
  get elapsedS(): number {
    return this.nowS;
  }

  /** Projected energy for one more round: "do I have a round 3?" (§2.8). */
  get roundsLeftEnergy(): number {
    return this.pcrCeiling * (1 - this.aer) / 100;
  }
}
