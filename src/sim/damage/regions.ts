/**
 * REGIONS — six pools, their sub-sites, their thresholds, and the states and
 * capability multipliers those thresholds produce. Chapter 05 §2.3.
 *
 * The model in one paragraph: every region carries an **acute** pool (shock —
 * drives states, decays in seconds) and a **structural** pool (tissue — drives
 * long capability loss, decays only at round breaks and only in part)
 * `[S: DAMAGE §2]`. Acute decay is exponential and pauses on the tick a region
 * is hit; a region hit again inside `reHitWindow` decays on a *longer*
 * half-life (head 8 -> 20 s), which is the mechanism that turns sustained
 * pressure into a stoppage without any "accumulated damage" bar (§2.4.5).
 *
 * Structural bookkeeping: each increment splits `permanent += pFrac * d` and
 * `recoverable += (1 - pFrac) * d`. Round breaks recover a fraction of
 * `recoverable` only — so a fight can be lost to damage taken in round 1.
 *
 * This file is tables and pool arithmetic. Nothing here draws from the RNG and
 * nothing here knows about time except through the `nowS` it is handed:
 * `state.ts` owns the clock, the active-state set and the event stream.
 */
import { STATE_IDS } from '../core/ids';
import type { ArmSite, BodySite, HeadSite, ImpactSite, LegSite } from './impact';
import { clamp, decayBy, type Tuning } from './tuning';

// ---------------------------------------------------------------------------
// State ids (§2.10 table). Every id this chapter can set is registered here.
// ---------------------------------------------------------------------------

export type Side = 'left' | 'right';
export const SIDES: readonly Side[] = ['left', 'right'];

/** Base state ids. Side-carrying states append `.left` / `.right` (§2.10). */
export const S = {
  stunned: 'state.stunned',
  rocked: 'state.rocked',
  knockdownFlash: 'state.knockdown_flash',
  knockdownHurt: 'state.knockdown_hurt',
  ko: 'state.ko',
  chokedOut: 'state.choked_out',
  jointFailure: 'state.joint_failure',
  neckCranked: 'state.neck_cranked',
  bodyHurt: 'state.body_hurt',
  bodyWorn: 'state.body_worn',
  winded: 'state.winded',
  bodyCollapse: 'state.body_collapse',
  ribFracture: 'state.rib_fracture',
  deadLeg: 'state.dead_leg',
  legCompromised: 'state.leg_compromised',
  legCollapse: 'state.leg_collapse',
  kneeInjured: 'state.knee_injured',
  deadArm: 'state.dead_arm',
  handInjured: 'state.hand_injured',
  footInjured: 'state.foot_injured',
  limbFracture: 'state.limb_fracture',
  noseBroken: 'state.nose_broken',
  eyeSwollenShut: 'state.eye_swollen_shut',
  secondWind: 'state.second_wind',
  adrenalineDump: 'state.adrenaline_dump',
} as const;

export type DamageStateBase = (typeof S)[keyof typeof S];

/** `state.dead_arm` + 'left' -> `state.dead_arm.left`. */
export function sideId(base: string, side: Side): string {
  return `${base}.${side}`;
}

/** `state.dead_arm.left` -> `state.dead_arm`. */
export function baseOf(id: string): string {
  const dot = id.lastIndexOf('.');
  if (dot < 0) return id;
  const tail = id.slice(dot + 1);
  return tail === 'left' || tail === 'right' || JOINTS.includes(tail as Joint) ? id.slice(0, dot) : id;
}

export type Joint = 'elbow' | 'shoulder' | 'knee' | 'ankle';
export const JOINTS: readonly Joint[] = ['elbow', 'shoulder', 'knee', 'ankle'];

const SIDED: readonly string[] = [
  S.deadLeg, S.legCompromised, S.legCollapse, S.kneeInjured,
  S.deadArm, S.handInjured, S.footInjured, S.eyeSwollenShut,
];

/** Every `state.*` id chapter 05 can write, expanded over sides and joints. */
export const DAMAGE_STATE_IDS: readonly string[] = (() => {
  const ids: string[] = [];
  for (const id of Object.values(S)) {
    if (SIDED.includes(id)) {
      for (const side of SIDES) ids.push(sideId(id, side));
    } else if (id === S.jointFailure) {
      for (const j of JOINTS) ids.push(`${id}.${j}`);
    } else {
      ids.push(id);
    }
  }
  return ids;
})();

STATE_IDS.addAll(DAMAGE_STATE_IDS);

// ---------------------------------------------------------------------------
// Capability multipliers (§2.3.7) — the vector every other chapter reads
// ---------------------------------------------------------------------------

export interface SideMult {
  left: number;
  right: number;
}

/**
 * Published once per tick as `caps` on the fighter state. Damage multipliers
 * (§2.3.7) and fatigue multipliers (§2.5.5) compose multiplicatively into it.
 *
 * Every field is "multiply the fighter's effective value by this", except
 * `reactionLatency`, which multiplies a *latency* (so > 1 is worse).
 */
export interface CapabilityMultipliers {
  movement: number;
  defence: number;
  accuracy: number;
  power: number;
  speed: number;
  decision: number;
  tdd: number;
  output: number;
  reactionLatency: number;
  /** Multiplies the absorb fraction of incoming strikes (§2.2.1 rockedAbsorbMult). */
  absorb: number;
  /** Rotational strikes lose about twice what linear ones do under fatigue. */
  powerRotational: number;
  kickPower: SideMult;
  kickRate: SideMult;
  checkSpeed: SideMult;
  guard: SideMult;
  handPower: SideMult;
  handRate: SideMult;
  gripStrength: number;
}

export function neutralCaps(): CapabilityMultipliers {
  return {
    movement: 1, defence: 1, accuracy: 1, power: 1, speed: 1, decision: 1, tdd: 1,
    output: 1, reactionLatency: 1, absorb: 1, powerRotational: 1,
    kickPower: { left: 1, right: 1 },
    kickRate: { left: 1, right: 1 },
    checkSpeed: { left: 1, right: 1 },
    guard: { left: 1, right: 1 },
    handPower: { left: 1, right: 1 },
    handRate: { left: 1, right: 1 },
    gripStrength: 1,
  };
}

/** Scalar part of the §2.3.7 row a state contributes. */
export type ScalarCaps = Partial<
  Pick<CapabilityMultipliers,
    'movement' | 'defence' | 'accuracy' | 'power' | 'speed' | 'decision' | 'tdd'
    | 'output' | 'reactionLatency' | 'absorb'>
>;

export function multiplyScalar(into: CapabilityMultipliers, from: ScalarCaps): void {
  if (from.movement !== undefined) into.movement *= from.movement;
  if (from.defence !== undefined) into.defence *= from.defence;
  if (from.accuracy !== undefined) into.accuracy *= from.accuracy;
  if (from.power !== undefined) into.power *= from.power;
  if (from.speed !== undefined) into.speed *= from.speed;
  if (from.decision !== undefined) into.decision *= from.decision;
  if (from.tdd !== undefined) into.tdd *= from.tdd;
  if (from.output !== undefined) into.output *= from.output;
  if (from.reactionLatency !== undefined) into.reactionLatency *= from.reactionLatency;
  if (from.absorb !== undefined) into.absorb *= from.absorb;
}

/**
 * The §2.3.7 table, one row per state. `sev` is the state's severity: the
 * rocked row is linear in `rs` (0-1), the leg-compromised row is banded 1-3,
 * everything else ignores it.
 *
 * Every cell is a `dmg.caps.*` parameter: §6.1 item 10 lists this whole table
 * as an estimate that calibration must be able to move.
 */
export function stateCaps(t: Tuning, base: string, sev = 0): ScalarCaps {
  switch (base) {
    // 2-6 s of slowed reactions and a slightly porous guard [E; DAMAGE §2.1].
    case S.stunned:
      return {
        defence: t.n('dmg.caps.stunned.defence'),
        accuracy: t.n('dmg.caps.stunned.accuracy'),
        decision: t.n('dmg.caps.stunned.decision'),
        tdd: t.n('dmg.caps.stunned.tdd'),
        reactionLatency: t.n('dmg.caps.stunned.reactionLatency'),
      };
    // "Fights on instinct": movement, guard and decision all fall with rs, and
    // absorb halves, which is what converts a rocked fighter into a finish.
    case S.rocked:
      return {
        movement: t.n('dmg.caps.rocked.movement') - t.n('dmg.caps.rocked.movementSev') * sev,
        defence: t.n('dmg.caps.rocked.defence') - t.n('dmg.caps.rocked.defenceSev') * sev,
        accuracy: t.n('dmg.caps.rocked.accuracy'),
        power: t.n('dmg.caps.rocked.power'),
        speed: t.n('dmg.caps.rocked.speed'),
        decision: t.n('dmg.caps.rocked.decision') - t.n('dmg.caps.rocked.decisionSev') * sev,
        tdd: t.n('dmg.caps.rocked.tdd'),
        output: t.n('dmg.caps.rocked.output'),
        absorb: t.n('dmg.absorb.rockedMult'),
      };
    // A flash knockdown is "grounded 1-3 s, then rocked" — same row as rocked.
    case S.knockdownFlash:
      return stateCaps(t, S.rocked, sev);
    case S.knockdownHurt:
      return {
        defence: t.n('dmg.caps.kdHurt.defence'),
        accuracy: t.n('dmg.caps.kdHurt.accuracy'),
        power: t.n('dmg.caps.kdHurt.power'),
        speed: t.n('dmg.caps.kdHurt.speed'),
        decision: t.n('dmg.caps.kdHurt.decision'),
        tdd: t.n('dmg.caps.kdHurt.tdd'),
        output: t.n('dmg.caps.kdHurt.output'),
        absorb: t.n('dmg.absorb.rockedMult'),
      };
    case S.ko:
    case S.chokedOut:
      return { movement: 0, defence: 0, accuracy: 0, power: 0, speed: 0, decision: 0, tdd: 0, output: 0 };
    // The guard drops to protect the body: head exposure +30 % (§2.3.2).
    case S.bodyHurt:
      return {
        movement: t.n('dmg.caps.bodyHurt.movement'),
        defence: t.n('dmg.caps.bodyHurt.defence'),
        accuracy: t.n('dmg.caps.bodyHurt.accuracy'),
        power: t.n('dmg.caps.bodyHurt.power'),
        decision: t.n('dmg.caps.bodyHurt.decision'),
        tdd: t.n('dmg.caps.bodyHurt.tdd'),
        output: t.n('dmg.caps.bodyHurt.output'),
      };
    case S.winded:
      return {
        movement: t.n('dmg.caps.winded.movement'),
        defence: t.n('dmg.caps.winded.defence'),
        accuracy: t.n('dmg.caps.winded.accuracy'),
        power: t.n('dmg.caps.winded.power'),
        speed: t.n('dmg.caps.winded.speed'),
        decision: t.n('dmg.caps.winded.decision'),
        tdd: t.n('dmg.caps.winded.tdd'),
        output: t.n('dmg.caps.winded.output'),
      };
    case S.bodyCollapse:
      return {
        movement: 0,
        defence: t.n('dmg.caps.bodyCollapse.defence'),
        decision: t.n('dmg.caps.bodyCollapse.decision'),
        output: 0,
      };
    // Movement, kick power, check speed and TDD for a compromised leg come from
    // the §2.3.3 curves (they are continuous in legLoad); the banded part is
    // the drop in kick *output* from that leg, handled per side by the caller.
    case S.legCompromised:
      return {};
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

export interface DecayConfig {
  halfLifeS: number;
  reHitHalfLifeS: number;
  reHitWindowS: number;
  /** `recovery` attribute multiplier on every acute half-life (§2.3). */
  recoveryMult: number;
}

/**
 * One region pool: acute shock plus the permanent/recoverable structural split.
 * Both are 0-100 and clamped there — nothing in the chapter can push a pool
 * outside its range, and a pool that left [0, 100] would silently break every
 * threshold below.
 */
export class RegionPool {
  acute = 0;
  permanent = 0;
  recoverable = 0;
  /** Fight-clock seconds of the last increment; -inf means never hit. */
  lastHitS = Number.NEGATIVE_INFINITY;
  /** Acute decay is frozen until this time (a hurt knockdown, §2.4.3). */
  freezeUntilS = Number.NEGATIVE_INFINITY;

  get structural(): number {
    return clamp(this.permanent + this.recoverable, 0, 100);
  }

  addAcute(delta: number, nowS: number): void {
    if (delta <= 0) return;
    this.acute = clamp(this.acute + delta, 0, 100);
    this.lastHitS = nowS;
  }

  /** Raise the acute pool to at least `floor` (the knockdown floors, §2.4.3). */
  floorAcute(floor: number, nowS: number): void {
    if (floor > this.acute) this.acute = clamp(floor, 0, 100);
    this.lastHitS = nowS;
  }

  addStructural(delta: number, pFrac: number, nowS: number): void {
    if (delta <= 0) return;
    const room = 100 - this.structural;
    const d = Math.min(delta, Math.max(room, 0));
    this.permanent = clamp(this.permanent + pFrac * d, 0, 100);
    this.recoverable = clamp(this.recoverable + (1 - pFrac) * d, 0, 100);
    this.lastHitS = nowS;
  }

  /**
   * One tick of acute decay. Skipped entirely on a tick the region was hit
   * (§2.3: "only while the region has not been hit in the current tick") and
   * while the decay is frozen.
   */
  decay(nowS: number, dtS: number, cfg: DecayConfig): void {
    if (this.acute <= 0) return;
    if (nowS <= this.freezeUntilS) return;
    if (this.lastHitS >= nowS - 1e-9) return;
    const reHit = nowS - this.lastHitS <= cfg.reHitWindowS;
    const half = (reHit ? cfg.reHitHalfLifeS : cfg.halfLifeS) * cfg.recoveryMult;
    this.acute = decayBy(this.acute, dtS, half);
    if (this.acute < 0.01) this.acute = 0;
  }

  /**
   * Round-break structural recovery, recoverable part only. A non-60-s break
   * scales as `1 - (1 - r60)^(breakSeconds/60)` [D: §2.3].
   */
  breakRecover(fracPer60: number, breakSeconds: number): void {
    const r = 1 - Math.pow(1 - clamp(fracPer60, 0, 1), breakSeconds / 60);
    this.recoverable *= 1 - r;
    if (this.recoverable < 0.01) this.recoverable = 0;
  }
}

/** The six regions (`legs` and `arms` are per side, so eight pools in all). */
export interface RegionSet {
  head: RegionPool;
  body: RegionPool;
  leg: { left: LegPools; right: LegPools };
  arm: { left: RegionPool; right: RegionPool };
  /** Swelling per side, structural, cleared only by the cutman (§2.3.1). */
  swell: { left: number; right: number };
}

/** Each leg: one acute pool plus four structural sub-pools `[S: MT §5.1]`. */
export interface LegPools {
  acute: RegionPool;
  thigh: RegionPool;
  calf: RegionPool;
  shin: RegionPool;
  knee: RegionPool;
  /** Clean calf landings so far, for the rising calf-shock probability. */
  calfHits: number;
}

export function newLegPools(): LegPools {
  return {
    acute: new RegionPool(),
    thigh: new RegionPool(),
    calf: new RegionPool(),
    shin: new RegionPool(),
    knee: new RegionPool(),
    calfHits: 0,
  };
}

export function newRegionSet(): RegionSet {
  return {
    head: new RegionPool(),
    body: new RegionPool(),
    leg: { left: newLegPools(), right: newLegPools() },
    arm: { left: new RegionPool(), right: new RegionPool() },
    swell: { left: 0, right: 0 },
  };
}

// ---------------------------------------------------------------------------
// Sub-site tables
// ---------------------------------------------------------------------------

export const HEAD_SITES: readonly HeadSite[] = ['chin', 'temple', 'midface', 'forehead', 'orbit', 'topback'];
export const BODY_SITES: readonly BodySite[] = ['liver', 'solar', 'ribs', 'spleen', 'sternum', 'abdomen'];
export const LEG_SITES: readonly LegSite[] = ['thigh_outer', 'thigh_inner', 'calf', 'shin', 'knee'];
export const ARM_SITES: readonly ArmSite[] = ['forearm', 'biceps', 'hand', 'shoulder'];

export function isHeadSite(s: ImpactSite): s is HeadSite {
  return (HEAD_SITES as readonly string[]).includes(s);
}
export function isBodySite(s: ImpactSite): s is BodySite {
  return (BODY_SITES as readonly string[]).includes(s);
}
export function isLegSite(s: ImpactSite): s is LegSite {
  return (LEG_SITES as readonly string[]).includes(s);
}

/** `thigh_outer` and `thigh_inner` share the `thigh` structural sub-pool. */
export type LegSubPool = 'thigh' | 'calf' | 'shin' | 'knee';

export function legSubPool(site: LegSite): LegSubPool {
  switch (site) {
    case 'thigh_outer':
    case 'thigh_inner':
      return 'thigh';
    case 'calf':
      return 'calf';
    case 'shin':
      return 'shin';
    case 'knee':
      return 'knee';
  }
}

export function headAcuteMult(t: Tuning, site: HeadSite): number {
  return t.table('dmg.head.site.acute', site);
}
export function headStructuralMult(t: Tuning, site: HeadSite): number {
  return t.table('dmg.head.site.structural', site);
}
export function bodyAcuteMult(t: Tuning, site: BodySite): number {
  return t.table('dmg.body.site.acute', site);
}
export function bodyStructuralMult(t: Tuning, site: BodySite): number {
  return t.table('dmg.body.site.structural', site);
}
export function legAcuteMult(t: Tuning, site: LegSite): number {
  return t.table('dmg.leg.site.acute', legSubPool(site));
}
export function legStructuralMult(t: Tuning, site: LegSite): number {
  return t.table('dmg.leg.site.structural', legSubPool(site));
}

// ---------------------------------------------------------------------------
// Leg capability curves (§2.3.3)
// ---------------------------------------------------------------------------

/** Worst structural load on a leg; calf and knee bite harder per point [E]. */
export function legLoad(t: Tuning, leg: LegPools): number {
  return Math.max(
    leg.thigh.structural,
    leg.calf.structural * t.n('dmg.leg.loadWeight.calf'),
    leg.knee.structural * t.n('dmg.leg.loadWeight.knee'),
  );
}

function curve(load: number, a: number, p: number): number {
  return clamp(1 - a * Math.pow(clamp(load, 0, 100) / 100, p), 0, 1);
}

/** `1 - 0.7 * (load/100)^1.5` `[S: DAMAGE §2.3]`. */
export function legMobility(t: Tuning, load: number): number {
  return curve(load, t.n('dmg.leg.mobility.a'), t.n('dmg.leg.mobility.p'));
}
export function legKickPower(t: Tuning, load: number): number {
  return curve(load, t.n('dmg.leg.kickPower.a'), t.n('dmg.leg.kickPower.p'));
}
export function legCheckSpeed(t: Tuning, load: number): number {
  return curve(load, t.n('dmg.leg.checkSpeed.a'), t.n('dmg.leg.checkSpeed.p'));
}
export function legTdd(t: Tuning, load: number): number {
  return curve(load, t.n('dmg.leg.tdd.a'), t.n('dmg.leg.tdd.p'));
}

/** `0.7 * min + 0.3 * max` — the worse leg carries 70 % `[S: DAMAGE §2.3]`. */
export function combinedMovement(t: Tuning, mobL: number, mobR: number): number {
  const w = t.n('dmg.leg.worseLegWeight');
  return w * Math.min(mobL, mobR) + (1 - w) * Math.max(mobL, mobR);
}

/** Rear-hand power loss from a damaged rear leg `[S: DAMAGE §2.3]`. */
export function rearHandPower(t: Tuning, rearLegLoad: number): number {
  const start = t.n('dmg.leg.rearHandPower.start');
  const span = t.n('dmg.leg.rearHandPower.span');
  const drop = t.n('dmg.leg.rearHandPower.drop');
  return 1 - drop * clamp((rearLegLoad - start) / span, 0, 1);
}

/** 0 = healthy, 1-3 = the §2.3.3 severity bands, 4 = collapse. */
export function legSeverity(t: Tuning, load: number, acute: number): 0 | 1 | 2 | 3 | 4 {
  if (load >= t.n('dmg.leg.thr.collapse') || acute >= t.n('dmg.leg.thr.collapseAcute')) return 4;
  if (load >= t.n('dmg.leg.thr.sev3')) return 3;
  if (load >= t.n('dmg.leg.thr.sev2')) return 2;
  if (load >= t.n('dmg.leg.thr.sev1')) return 1;
  return 0;
}

/** Kick output from a compromised leg: 0.8 / 0.6 / 0.4 by band [E]. */
export function legKickRate(t: Tuning, sev: number): number {
  if (sev >= 3) return t.n('dmg.caps.legCompromised.kickRate3');
  if (sev === 2) return t.n('dmg.caps.legCompromised.kickRate2');
  if (sev === 1) return t.n('dmg.caps.legCompromised.kickRate1');
  return 1;
}

/** The kicker's own shin bands `[S: MT §5.2]`: frequency and power multipliers. */
export function shinPenalty(t: Tuning, shinStructural: number): { rate: number; power: number } {
  if (shinStructural >= t.n('dmg.leg.shin.band3')) return { rate: 0, power: t.n('dmg.leg.shin.pow2') };
  if (shinStructural >= t.n('dmg.leg.shin.band2')) {
    return { rate: t.n('dmg.leg.shin.freq2'), power: t.n('dmg.leg.shin.pow2') };
  }
  if (shinStructural >= t.n('dmg.leg.shin.band1')) {
    return { rate: t.n('dmg.leg.shin.freq1'), power: t.n('dmg.leg.shin.pow1') };
  }
  return { rate: 1, power: 1 };
}

// ---------------------------------------------------------------------------
// Cuts (§2.3.6)
// ---------------------------------------------------------------------------

export type CutSite =
  | 'brow_L' | 'brow_R' | 'eyelid_L' | 'eyelid_R' | 'nose_bridge'
  | 'cheek_L' | 'cheek_R' | 'scalp' | 'lip';

export interface Cut {
  site: CutSite;
  severity: 1 | 2 | 3;
  /** Presentation, and the doctor criterion: equal to severity `[S: DAMAGE §2.5]`. */
  bleedRate: number;
  cleanHitsSinceOpen: number;
  openedS: number;
  /** The cutman's work, undone by the next `dmg.cut.reopenHits` clean strikes. */
  treatedSeverity: 0 | 1 | 2 | 3;
  hitsSinceTreated: number;
}

/** Which of the nine sites a head landing opens, given the site and side. */
export function cutSiteFor(site: HeadSite, side: Side, browZone: boolean): CutSite {
  const L = side === 'left';
  if (browZone) return L ? 'brow_L' : 'brow_R';
  switch (site) {
    case 'orbit':
      return L ? 'eyelid_L' : 'eyelid_R';
    case 'midface':
      return 'nose_bridge';
    case 'chin':
      return 'lip';
    case 'temple':
      return L ? 'cheek_L' : 'cheek_R';
    case 'forehead':
    case 'topback':
      return 'scalp';
  }
}

export function isBrowZone(site: HeadSite): boolean {
  // §2.3.6: the brow zone is the `orbit` site (brow / eyelid); everything else
  // uses the "other head sites" column.
  return site === 'orbit';
}

export function bleedsIntoEye(site: CutSite): boolean {
  return site === 'brow_L' || site === 'brow_R' || site === 'eyelid_L' || site === 'eyelid_R';
}

export function cutSide(site: CutSite): Side | null {
  if (site.endsWith('_L')) return 'left';
  if (site.endsWith('_R')) return 'right';
  return null;
}

/**
 * Vision on one side, 0.2-1: swelling (§2.3.1) compounded with brow/eyelid cuts
 * on that side (§2.3.6), floored at 0.2 `[S: DAMAGE §2.5]`.
 */
export function visionFor(t: Tuning, swell: number, cuts: readonly Cut[], side: Side): number {
  const start = t.n('dmg.swell.visionStart');
  const span = t.n('dmg.swell.visionSpan');
  let v = 1 - t.n('dmg.swell.visionLoss') * clamp((swell - start) / span, 0, 1);
  if (swell >= t.n('dmg.swell.shutAt')) v = Math.min(v, t.n('dmg.swell.shutVision'));
  for (const c of cuts) {
    if (!bleedsIntoEye(c.site) || cutSide(c.site) !== side) continue;
    if (c.severity >= 3) v *= t.n('dmg.cut.vision.sev3');
    else if (c.severity === 2) v *= t.n('dmg.cut.vision.sev2');
  }
  return clamp(v, t.n('dmg.cut.visionFloor'), 1);
}

/** Vision -> defence and accuracy multipliers (§2.3.7 bottom row). */
export function visionCaps(t: Tuning, visionAvg: number): ScalarCaps {
  const df = t.n('dmg.vision.defence.floor');
  const af = t.n('dmg.vision.accuracy.floor');
  return { defence: df + (1 - df) * visionAvg, accuracy: af + (1 - af) * visionAvg };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Toughness scales the *acute* increment only — tough fighters feel less, they
 * do not break less (§2.2.3). `attr` is `chin` for the head and
 * `bodyToughness` everywhere else.
 */
export function acuteAttrMult(t: Tuning, attr: number): number {
  return Math.max(0, 1 - t.n('dmg.acuteAttrSlope') * (attr - 50));
}

/** Heavier bodies dissipate more: a 120 kg target takes x0.90 [E]. */
export function massScaleTarget(t: Tuning, targetMassKg: number): number {
  return Math.pow(targetMassKg / t.n('dmg.massRef'), t.n('dmg.massScaleTarget.exp'));
}

/** `recovery` attribute on every acute half-life: +-15 % at 0/100 [E; §2.3]. */
export function recoveryHalfLifeMult(t: Tuning, recovery: number): number {
  return Math.max(0.1, 1 - t.n('dmg.recoveryAttrSlope') * (recovery - 50));
}

export function headDecayConfig(t: Tuning, recoveryMult: number): DecayConfig {
  return {
    halfLifeS: t.n('dmg.head.acuteHalfLife'),
    reHitHalfLifeS: t.n('dmg.head.reHit'),
    reHitWindowS: t.n('dmg.head.reHitWindow'),
    recoveryMult,
  };
}
export function bodyDecayConfig(t: Tuning, recoveryMult: number): DecayConfig {
  return {
    halfLifeS: t.n('dmg.body.acuteHalfLife'),
    reHitHalfLifeS: t.n('dmg.body.reHit'),
    reHitWindowS: t.n('dmg.body.reHitWindow'),
    recoveryMult,
  };
}
export function legDecayConfig(t: Tuning, recoveryMult: number): DecayConfig {
  return {
    halfLifeS: t.n('dmg.leg.acuteHalfLife'),
    reHitHalfLifeS: t.n('dmg.leg.reHit'),
    reHitWindowS: t.n('dmg.leg.reHitWindow'),
    recoveryMult,
  };
}
export function armDecayConfig(t: Tuning, recoveryMult: number): DecayConfig {
  return {
    halfLifeS: t.n('dmg.arm.acuteHalfLife'),
    reHitHalfLifeS: t.n('dmg.arm.reHit'),
    reHitWindowS: t.n('dmg.arm.reHitWindow'),
    recoveryMult,
  };
}
