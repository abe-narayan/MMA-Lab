/**
 * IMPACT CONTRACT — `StrikeImpact`, the one payload that crosses into damage.
 *
 * OWNERSHIP: chapter 02 (striking) owns this interface. It is the merged
 * contract recorded in docs/design/REVIEW_LOG.md §3.1 and written out in
 * 02 §2.6.5 / 05 §2.1. Chapters 03 (slams, clinch/ground strikes) and 04
 * (submission slams, 04 §2.6.6) emit the same shape.
 *
 * `src/sim/striking/` is still empty at the time of writing, so the type is
 * declared here and re-exported. When chapter 02 lands its own
 * `StrikeImpact`, this declaration is deleted and replaced with
 * `export type { StrikeImpact } from '../striking';` — nothing else in this
 * module changes, because nothing else refers to the striking module.
 *
 * The three things the review settled, and which this module depends on:
 *  1. `forceN` is **delivered** force on the Pierce in-ring scale — placement
 *     is already applied upstream, so `cleanMult` is 1.0 (§2.2.1).
 *  2. There is no `rot` field: rotation is this module's `kWeapon` (§2.2.2).
 *     A `rot` from 02 would double-count the hook factor.
 *  3. `absorb` is supplied by the striking side (its defence-outcome fraction,
 *     glove pass-through already included); the `defence`-keyed table in
 *     §2.2.1 is only a fallback for impacts built without one.
 */

/** §2.3.1 head sub-sites. `topback` is 02's spelling. */
export type HeadSite = 'chin' | 'temple' | 'midface' | 'forehead' | 'orbit' | 'topback';
/** §2.3.2 body sub-sites. */
export type BodySite = 'liver' | 'solar' | 'ribs' | 'spleen' | 'sternum' | 'abdomen';
/** §2.3.3 leg sub-sites. `shin` is the kicker's own shin, via a check. */
export type LegSite = 'thigh_outer' | 'thigh_inner' | 'calf' | 'shin' | 'knee';
/** §2.3.4 arm sub-sites. */
export type ArmSite = 'forearm' | 'biceps' | 'hand' | 'shoulder';
export type ImpactSite = HeadSite | BodySite | LegSite | ArmSite;

export type ImpactRegion = 'head' | 'body' | 'leadLeg' | 'rearLeg' | 'arms';

/** 02's weapon enum. §2.1 gives the mapping onto this module's eight classes. */
export type ImpactWeapon =
  | 'fist' | 'backfist' | 'hammerfist' | 'elbow' | 'elbow_point' | 'knee' | 'shin'
  | 'instep' | 'ball_of_foot' | 'heel' | 'shin_on_knee' | 'head' | 'mat';

/** The eight weapon classes §2.2.2 and §2.2.3 actually key their tables on. */
export type WeaponClass = 'fist' | 'hammerfist' | 'elbow' | 'knee' | 'shin' | 'foot' | 'head' | 'mat';

/** 02's four-valued placement. "contact = flush" in the chapter means `flush`. */
export type ImpactPlacement = 'flush' | 'solid' | 'partial' | 'glancing';

export type ImpactDefence =
  | 'none' | 'block_forearm' | 'block_glove' | 'roll' | 'slip_late'
  | 'check' | 'knee_block' | 'catch';

export type ImpactPosture = 'distance' | 'clinch' | 'groundTop' | 'groundBottom' | 'wallPinned';

export type GloveType = 'mma4oz' | 'boxing8oz' | 'boxing10oz' | 'boxing12oz' | 'bare';

export interface StrikeImpact {
  tick: number;
  /** 09 §2.2 intra-tick offset, [0, 100) ms. */
  subTickMs: number;
  attacker: number;
  target: number;
  /** `tech.*` (02 §2.2, 03 §5.1.1) or 'slam' / 'throw' for 03/04 landings. */
  tech: string;
  weapon: ImpactWeapon;
  region: ImpactRegion;
  subLocation: ImpactSite;
  placement: ImpactPlacement;
  /** DELIVERED force, newtons (02 §2.6.4). `F_del = forceN`. */
  forceN: number;
  /** Informational (02); v1 formulas do not read them. */
  vRel: number;
  effMassKg: number;
  /** 02's defence-outcome absorb fraction (DAMAGE §3.3), 0-1. */
  absorb: number;
  defence: ImpactDefence;
  seen: boolean;
  counter: boolean;
  simultaneous: boolean;
  /** Relative velocity of the target toward the attacker, >= 0, m/s. */
  closingSpeedMs: number;
  attackerState: { rocked: boolean; fatigue: number };
  targetState: {
    midAction: boolean;
    mouthOpen: boolean;
    guardHand: 'up' | 'away';
    braced: boolean;
    grounded: boolean;
  };
  /** The attacker's posture at contact. */
  posture: ImpactPosture;
  gloveType: GloveType;
  /** Optional explicit rad/s^2 from 02; replaces the derived `alphaEq` (§2.2.2). */
  rotProxy?: number;
  /** Checked-kick shin (§2.3.3) or the hand/foot injury route (§2.3.5). */
  selfDamage?: StrikeImpact;
}

/**
 * 02's weapon enum collapsed onto the eight damage classes, per the mapping
 * comment in 05 §2.1: backfist -> fist, elbow_point -> elbow,
 * instep/ball_of_foot/heel -> foot, shin_on_knee -> shin.
 */
export function weaponClass(weapon: ImpactWeapon): WeaponClass {
  switch (weapon) {
    case 'fist':
    case 'backfist':
      return 'fist';
    case 'hammerfist':
      return 'hammerfist';
    case 'elbow':
    case 'elbow_point':
      return 'elbow';
    case 'knee':
      return 'knee';
    case 'shin':
    case 'shin_on_knee':
      return 'shin';
    case 'instep':
    case 'ball_of_foot':
    case 'heel':
      return 'foot';
    case 'head':
      return 'head';
    case 'mat':
      return 'mat';
  }
}

export type PunchKind = 'straight' | 'hook' | 'uppercut';

/**
 * `ko.kWeapon` needs straight / hook / uppercut, but the contract's `weapon`
 * is just `fist` for every punch — the trajectory lives in the technique id.
 * Matching on the id keeps 02 free to add techniques without touching this
 * module; anything unrecognised is a straight (the 1.00 reference, DAMAGE §3.1).
 */
export function punchKind(tech: string): PunchKind {
  const t = tech.toLowerCase();
  if (t.includes('uppercut')) return 'uppercut';
  if (t.includes('hook') || t.includes('overhand') || t.includes('swing') || t.includes('haymaker')) {
    return 'hook';
  }
  return 'straight';
}

export type ElbowArc = 'horizontal' | 'downward' | 'upward';

/** Cut probability (§2.3.6) splits elbows by arc; again read from the tech id. */
export function elbowArc(tech: string): ElbowArc {
  const t = tech.toLowerCase();
  if (t.includes('down') || t.includes('12_6') || t.includes('12to6') || t.includes('chop')) {
    return 'downward';
  }
  if (t.includes('up')) return 'upward';
  return 'horizontal';
}

/** True when the impact is a leg region (the two leg pools share all tables). */
export function isLegRegion(region: ImpactRegion): boolean {
  return region === 'leadLeg' || region === 'rearLeg';
}
