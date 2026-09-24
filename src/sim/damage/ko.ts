/**
 * CONSCIOUSNESS — the shared impact front end (§2.2) and the knockdown /
 * knockout model (§2.4).
 *
 * The chain, per head impact:
 *
 *   delivered force  ->  rotational-acceleration equivalent  ->  logistic
 *   ->  concussive event?  ->  which kind (KO / hurt KD / flash KD / rocked)
 *
 * WHY THE LOGISTIC IS 8,500 / 1,000 AND NOT DAMAGE §3.2's 6,383 / 1,800
 * ---------------------------------------------------------------------
 * DAMAGE §3.2 proposes `(alphaEq - 6,383) / 1,800` from Rowson 2012's
 * rotation-only 50 % point. That curve has an unphysical floor —
 * `sigmoid(-3.55) = 2.8 %` at *zero* force — and, run through the in-fight
 * force distribution of §2.1, produces ~10 % knockdowns per landed power head
 * strike, 2.5-5x the FIGHT_DATA target.
 *
 * So the chapter uses the **combined** Rowson & Duma 2013 logistic
 * `CP = sigmoid(-10.2 + 0.0433a + 0.000873alpha - 9.2e-7 a*alpha)`
 * `[S: LIT_A §4]`, collapsed onto the punch regime with the boxing
 * linear:rotational ratio `a ~ 0.0085 * alpha` g per rad/s²
 * `[D: mean of Walilko 58 g / 6,343 and Viano 71 g / 9,306]`. That gives
 * CP(4,000) = 0.005, CP(6,343) = 0.07, CP(9,306) = 0.66, CP(11,000) = 0.92 —
 * and a single logistic with midpoint 8,500, scale 1,000 reproduces all four
 * within ±0.03 [D]. It also matches Lota 2022's combat-sport means (concussive
 * MMA impacts ~7,560; boxing LOC punches 11,280 vs 6,146 non-LOC).
 *
 * Verified in `tests/damage.test.ts`: the §2.4.1 Monte-Carlo reproduces 4.2 %
 * pConcuss and 2.3 % knockdowns per landed distance power head strike.
 */
import {
  punchKind, weaponClass, type ImpactDefence, type ImpactSite, type StrikeImpact,
} from './impact';
import { isHeadSite, type Side } from './regions';
import { koHistoryMult, type FighterDamageProfile } from './profile';
import { clamp, lerpDraw, sigmoid, type Tuning } from './tuning';

// ---------------------------------------------------------------------------
// §2.2 Shared front end
// ---------------------------------------------------------------------------

export interface FrontEnd {
  /** Delivered force, newtons. `F_del = forceN * cleanMult`. */
  fDel: number;
  /** Final absorb fraction, 0-0.95. */
  absorb: number;
  /** Raw damage units before the regional split. */
  raw: number;
  /** `(attackerMassKg / 77)^0.5`, clamped — severity by attacker size. */
  massSev: number;
}

function isBlock(defence: ImpactDefence): boolean {
  return defence === 'block_forearm' || defence === 'block_glove';
}

/**
 * §2.2.1. `impact.absorb` is 02's defence-outcome fraction and already includes
 * the glove pass-through, so the `defence`-keyed table and `gloveBlockMult` are
 * only used for impacts built *without* an absorb (03/04 ad-hoc landings).
 * `Number.isFinite` rather than `=== undefined` because the contract types the
 * field as required: this is the runtime guard for callers that omit it.
 */
export function computeAbsorb(t: Tuning, imp: StrikeImpact, targetRocked: boolean): number {
  const supplied = Number.isFinite(imp.absorb);
  let base = supplied ? imp.absorb : t.table('dmg.absorb', imp.defence);
  if (!supplied && isBlock(imp.defence)) {
    base *= t.table('dmg.absorb.gloveBlockMult', imp.gloveType);
  }
  const brace = imp.targetState.braced ? t.n('dmg.absorb.brace') : 0;
  // A rocked fighter's absorb halves: this is the mechanism that turns "hurt"
  // into "finished" (C6, C14) without any separate follow-up rule.
  const rockedMult = targetRocked ? t.n('dmg.absorb.rockedMult') : 1;
  return clamp(Math.max(base, brace) * rockedMult, 0, t.n('dmg.absorb.cap'));
}

/**
 * §2.2.1 + §2.2.3. `cleanMult` is 1.0 for every impact that carries a
 * `placement`, because 02's `forceN` is already delivered force (REVIEW §3.1);
 * the flush/partial/glancing table survives only as a fallback.
 */
export function frontEnd(
  t: Tuning,
  imp: StrikeImpact,
  attackerMassKg: number,
  targetRocked: boolean,
): FrontEnd {
  const cleanMult = imp.placement !== undefined
    ? 1.0
    : t.table('dmg.cleanMult', 'flush');
  const fDel = imp.forceN * cleanMult;
  const absorb = computeAbsorb(t, imp, targetRocked);
  const massSev = clamp(
    Math.pow(attackerMassKg / t.n('dmg.massRef'), t.n('dmg.massSev.exp')),
    t.n('dmg.massSev.min'),
    t.n('dmg.massSev.max'),
  );
  const raw = t.n('dmg.rawScale')
    * (fDel / t.n('dmg.forceRef'))
    * t.table('dmg.kWeaponDmg', weaponClass(imp.weapon))
    * massSev
    * (1 - absorb);
  return { fDel, absorb, raw: Math.max(0, raw), massSev };
}

// ---------------------------------------------------------------------------
// §2.2.2 Rotational-acceleration equivalent
// ---------------------------------------------------------------------------

export interface AlphaContext {
  /** 01 `neck`, 0-100. */
  neck: number;
  /** The target's fatigue index `f`, 0-1. */
  fatigue: number;
  /** The target's head structural pool, 0-100, *before* this impact. */
  headStructural: number;
  /** `state.neck_cranked` raises kBrace for the rest of the bout (§2.3.8). */
  neckCranked: boolean;
  /** The struck fighter's body mass, kg (head-neck inertia, Phase 9). */
  targetMassKg?: number;
}

export interface AlphaBreakdown {
  alphaEq: number;
  kWeapon: number;
  kLever: number;
  kPrior: number;
}

/** `ko.kWeapon` key for an impact: punches split by trajectory (§2.2.2). */
export function koWeaponKey(imp: StrikeImpact): string {
  const cls = weaponClass(imp.weapon);
  if (cls === 'fist') return punchKind(imp.tech);
  return cls;
}

/**
 * §2.2.2. Attacker mass is deliberately absent: in-ring landed force is
 * uncorrelated with body mass (r = 0.22, Pierce 2006) and knockdowns per 100
 * head strikes are nearly flat across men's classes (FLW 0.87, HW 0.92,
 * LHW 1.20, FD #37). The weight-class gradient lives in *severity* (§2.4.2).
 */
export function alphaEquivalent(
  t: Tuning,
  imp: StrikeImpact,
  ctx: AlphaContext,
  front: FrontEnd,
): AlphaBreakdown {
  const site = imp.subLocation;
  const kWeapon = t.table('ko.kWeapon', koWeaponKey(imp));
  const kLever = isHeadSite(site) ? t.table('ko.kLever', site) : 1;
  const kGlove = t.table('ko.kGlove', imp.gloveType);
  const kUnseen = imp.seen ? 1 : t.n('ko.kUnseen');
  // 01 `neckMult` = 1.15 - 0.30 * neck/100 `[S: DAMAGE §3.2 — Collins 2014,
  // -5 % concussion odds per lb of neck strength]`.
  let kBrace = t.n('ko.kBrace.a') - t.n('ko.kBrace.b') * (clamp(ctx.neck, 0, 100) / 100);
  if (ctx.neckCranked) kBrace *= t.n('dmg.caps.neckCranked.braceMult');
  const relaxed = imp.targetState.midAction || imp.targetState.mouthOpen;
  const kRelaxed = relaxed ? t.n('ko.kRelaxed') : 1;
  const kClosing = 1
    + t.n('ko.kClosing.max') * Math.min(Math.max(imp.closingSpeedMs, 0), t.n('ko.kClosing.speedRef'))
      / t.n('ko.kClosing.speedRef');
  const kFatigue = 1 + t.n('ko.kFatigue') * clamp(ctx.fatigue, 0, 1);
  const kPrior = Math.min(
    1 + t.n('dmg.head.kPriorSlope') * ctx.headStructural,
    t.n('dmg.head.kPriorCap'),
  );
  const kGround = imp.targetState.grounded ? t.n('ko.kGround') : 1;
  // Phase 9: the head and neck that have to be accelerated grow with the
  // fighter. Delivered force scales with the puncher's mass (02 massMult,
  // m^0.5), so without this a heavyweight's head took the same angular
  // acceleration per newton as a flyweight's and knockdowns per landed head
  // strike ran ten times higher at HW than at FLW — the data are flat across
  // the men's classes (FIGHT_DATA §3 #37: FLW 0.87, HW 0.92 per 100). The
  // weight-class gradient stays where §2.4.2 puts it, in severity (kKO).
  const kInertia = ctx.targetMassKg === undefined ? 1
    : Math.pow(Math.max(30, ctx.targetMassKg) / t.n('dmg.massRef'), -t.n('ko.targetMassExp'));

  if (imp.rotProxy !== undefined) {
    // 02 may one day compute head kinematics explicitly; when it does, its
    // number replaces the derivation (§2.1) but still carries kPrior forward.
    return { alphaEq: imp.rotProxy, kWeapon, kLever, kPrior };
  }

  const alphaEq = t.n('ko.alphaRef')
    * (front.fDel / t.n('ko.forceRef'))
    * kWeapon * kLever * kGlove * kUnseen * kBrace * kRelaxed * kClosing
    * kFatigue * kPrior * kGround * kInertia * t.n('ko.alphaCal');
  return { alphaEq, kWeapon, kLever, kPrior };
}

// ---------------------------------------------------------------------------
// §2.4.1 Per-impact concussive-event probability
// ---------------------------------------------------------------------------

export function concussionProbability(
  t: Tuning,
  alphaEq: number,
  chinEff: number,
  residualDehydration: number,
): number {
  const z = (alphaEq - t.n('ko.alpha50')) / t.n('ko.alphaScale')
    - t.n('ko.chinSlope') * (chinEff - 50)
    + t.n('ko.dehydSlope') * clamp(residualDehydration, 0, 0.05);
  return sigmoid(z);
}

// ---------------------------------------------------------------------------
// §2.4.2 Outcome split
// ---------------------------------------------------------------------------

export type ConcussiveOutcome = 'ko' | 'knockdown_hurt' | 'knockdown_flash' | 'rocked';

export interface OutcomeWeights {
  kKO: number;
  hurt: number;
  flash: number;
  massSevKO: number;
}

/**
 * §2.4.2. `kKO` is the fraction of concussive events that end in loss of
 * consciousness. The mass term is what makes the weight-class gradient appear
 * in severity: HW 120 kg -> massSevKO 1.43 -> kKO 0.29; FLW 57 kg -> 0.79 ->
 * 0.16 [D]. The fatigue term is why tired fighters drop *and stay down*.
 *
 * REVIEW N2: there is no age multiplier here. Age enters only through 01's
 * `chinEff`, and adding a second term would double-count it.
 */
export function outcomeWeights(
  t: Tuning,
  attackerMassKg: number,
  target: FighterDamageProfile,
  targetFatigue: number,
): OutcomeWeights {
  const massSevKO = clamp(
    Math.pow(attackerMassKg / t.n('dmg.massRef'), t.n('ko.massSevKO.exp')),
    t.n('ko.massSevKO.min'),
    t.n('ko.massSevKO.max'),
  );
  const historyMult = koHistoryMult(target.koLosses, t.n('ko.historyPerKO'), t.n('ko.historyCap'));
  const kKO = t.n('ko.kKO') * massSevKO * historyMult
    * (1 + t.n('ko.kKO.fatigue') * clamp(targetFatigue, 0, 1));
  return {
    kKO,
    hurt: t.n('ko.split.hurtKD') * massSevKO,
    flash: t.n('ko.split.flashKD'),
    massSevKO,
  };
}

/** One uniform draw `u` -> which kind of concussive event this was. */
export function splitOutcome(u: number, w: OutcomeWeights): ConcussiveOutcome {
  if (u < w.kKO) return 'ko';
  if (u < w.kKO + w.hurt) return 'knockdown_hurt';
  if (u < w.kKO + w.hurt + w.flash) return 'knockdown_flash';
  return 'rocked';
}

// ---------------------------------------------------------------------------
// §2.4.3 / §2.6.2 The windows an outcome opens
// ---------------------------------------------------------------------------

export interface OutcomeWindows {
  /** Acute head pool is raised to at least this (never lowered). */
  acuteFloor: number;
  grounded: boolean;
  /** Seconds before the fighter is physically able to rise. */
  riseAllowedAfterS: number;
  /** Seconds the acute decay is frozen — "the legs come back slowly". */
  freezeS: number;
  /** Seconds unconscious (KO only). Must exceed 06's referee lag (C15). */
  unconsciousS: number;
}

/**
 * Draw (c) is the grounded/unconscious window, draw (d) the freeze — both are
 * taken for every impact (§2.10), so the stream position never depends on the
 * outcome.
 */
export function outcomeWindows(
  t: Tuning,
  outcome: ConcussiveOutcome,
  drawC: number,
  drawD: number,
): OutcomeWindows {
  switch (outcome) {
    case 'ko':
      return {
        acuteFloor: t.n('dmg.head.thr.ko'),
        grounded: true,
        riseAllowedAfterS: Number.POSITIVE_INFINITY,
        freezeS: 0,
        unconsciousS: lerpDraw(drawC, t.n('ko.unconsciousMin'), t.n('ko.unconsciousMax')),
      };
    case 'knockdown_hurt':
      return {
        acuteFloor: t.n('kd.hurt.acuteFloor'),
        grounded: true,
        riseAllowedAfterS: lerpDraw(drawC, t.n('kd.hurt.riseMin'), t.n('kd.hurt.riseMax')),
        freezeS: lerpDraw(drawD, t.n('kd.hurt.freezeMin'), t.n('kd.hurt.freezeMax')),
        unconsciousS: 0,
      };
    case 'knockdown_flash':
      return {
        acuteFloor: t.n('kd.flash.acuteFloor'),
        grounded: true,
        riseAllowedAfterS: lerpDraw(drawC, t.n('kd.flash.groundedMin'), t.n('kd.flash.groundedMax')),
        freezeS: 0,
        unconsciousS: 0,
      };
    case 'rocked':
      return {
        acuteFloor: t.n('kd.rocked.acuteFloor'),
        grounded: false,
        riseAllowedAfterS: 0,
        freezeS: 0,
        unconsciousS: 0,
      };
  }
}

// ---------------------------------------------------------------------------
// §2.3.5 Attacker self-injury (hands and feet)
// ---------------------------------------------------------------------------

const SKULL_SITES: readonly ImpactSite[] = ['forehead', 'topback', 'temple'];

/**
 * §2.3.5. Rates anchored on hand injuries = 13.5 % of MMA injuries (Bledsoe
 * 2006) and 347 per 1,000 h in elite boxing (Loosemore 2017). Expected
 * incidence ~3.3 % of fighter-bouts [D: 45 landed head punches, 30 % on the
 * skull zone]; `dmg.hand.gloveMult.*` is the tuning knob (C20).
 */
export function handInjuryProbability(t: Tuning, imp: StrikeImpact): number {
  const cls = weaponClass(imp.weapon);
  if (cls === 'hammerfist' || cls === 'elbow') return t.n('dmg.hand.pHammerElbow');
  if (cls !== 'fist') return 0;
  const glove = imp.gloveType === 'mma4oz'
    ? t.n('dmg.hand.gloveMult.mma4oz')
    : imp.gloveType === 'bare'
      ? t.n('dmg.hand.gloveMult.bare')
      : t.n('dmg.hand.gloveMult.boxing');
  const skull = imp.region === 'head' && SKULL_SITES.includes(imp.subLocation);
  return (skull ? t.n('dmg.hand.pSkull') : t.n('dmg.hand.pSoft')) * glove;
}

/** A kick that lands on an elbow or a knee risks the attacker's foot (§2.3.5). */
export function footInjuryProbability(t: Tuning, imp: StrikeImpact): number {
  const cls = weaponClass(imp.weapon);
  const ontoHardPoint = imp.defence === 'knee_block' || imp.region === 'arms';
  return (cls === 'foot' || cls === 'shin') && ontoHardPoint ? t.n('dmg.foot.p') : 0;
}

/** Which of the attacker's limbs this impact was thrown with. */
export function attackerLimbSide(imp: StrikeImpact): Side {
  // 02's payload carries no laterality (REVIEW §3.1 kept the contract minimal),
  // so the side is read from the technique id, which always names the hand or
  // leg ("tech.lead_hook", "tech.rear_low_kick"). Unnamed techniques are rear:
  // the rear limb throws the large majority of power strikes.
  const tech = imp.tech.toLowerCase();
  if (tech.includes('lead') || tech.includes('jab') || tech.includes('_l_')) return 'left';
  return 'right';
}

// ---------------------------------------------------------------------------
// §2.4.6 Career layer
// ---------------------------------------------------------------------------

export interface CareerWrites {
  /** KO or head-strike TKO losses added this bout. */
  priorKOs: number;
  /** Permanent chin points lost, 3 per KO/TKO `[E; DAMAGE §7.21]`. */
  chinDelta: number;
  /** Cuts opened this bout; feeds `cutProneness` next time. */
  cuts: number;
}

export function emptyCareerWrites(): CareerWrites {
  return { priorKOs: 0, chinDelta: 0, cuts: 0 };
}

/**
 * §2.4.6. A choke-out writes nothing: SUBPHYS §1 finds no lasting neuropsych
 * effect from a single sportive loss of consciousness.
 */
export function recordKnockout(t: Tuning, writes: CareerWrites): void {
  writes.priorKOs += 1;
  writes.chinDelta -= t.n('ko.careerChinLoss');
}
