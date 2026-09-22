/**
 * HIT RESOLUTION — chapter 02 §2.6.
 *
 * The eleven-step pipeline, and two ideas that replace what the old engine did:
 *
 * 1. **Two-stage landing.** UFCStats "accuracy" is a *marginal*: it already
 *    contains every defence the reference defender made. So the catalogue's
 *    `baseLand` (`P_land`) is a calibration anchor, not a roll. What the engine
 *    rolls is `pA` — the probability the strike *arrives* before the defender's
 *    reactive response is applied — derived so that the marginal comes back out
 *    at `P_land` against the reference defender (`solvePA`). Rolling `P_land`
 *    directly and *then* rolling a defence would double-count every defence in
 *    the data.
 *
 * 2. **Placement is a categorical draw, not a 5 % flush lottery.** Every landed
 *    strike is flush / solid / partial / glancing with family-specific weights,
 *    shifted by whether the target saw it coming, by how narrowly the defence
 *    failed, and by the attacker's precision. That distribution, crossed with
 *    the lognormal force draw, is what reproduces Pierce's in-ring force
 *    distribution (median ~950 N, 88 % < 1500 N, 2-6 % >= 2000 N).
 *
 * RNG contract (09 §2.7, P4 "strike contact"): exactly **six** draws per
 * resolution, always, in this order —
 *     arrival, defenceSuccess | passiveBlock, placement, subLocation,
 *     forceLognormal (normal() = 2)
 * — taken before any branching, so the stream position after a strike is a pure
 * function of state and never of the outcome. 05's ten per-impact draws happen
 * after this function returns and are not ours.
 */
import type { RNG } from '../rng';
import type { DefenceId, TechniqueId } from '../core/ids';
import {
  REFERENCE_MASS_KG, isKickFamily, isRotational,
  type GloveType, type TargetRegion, type TechniqueFamily, type TechniqueSpec, type Weapon,
} from './catalogue';
import {
  defenceSuccessFor, logit, sigmoid, strikeClasses,
  type DefenceSpec, type GuardSpec,
} from './defence';
import { CTR } from './counters';

// ---------------------------------------------------------------------------
// §2.6.5 — the StrikeImpact contract with chapter 05 (frozen; 05 §2.1 repeats it)
// ---------------------------------------------------------------------------

export type HeadSite = 'chin' | 'temple' | 'midface' | 'forehead' | 'orbit' | 'topback';
export type BodySite = 'liver' | 'solar' | 'ribs' | 'spleen' | 'sternum' | 'abdomen';
export type LegSite = 'thigh_outer' | 'thigh_inner' | 'calf' | 'shin' | 'knee';
export type ArmSite = 'forearm' | 'hand';
export type SubLocation = HeadSite | BodySite | LegSite | ArmSite;

export type Placement = 'flush' | 'solid' | 'partial' | 'glancing';

/** 05's defence enum. 02 maps its own `def.*` ids onto it (§2.6.5). */
export type ImpactDefence =
  'none' | 'block_glove' | 'block_forearm' | 'roll' | 'slip_late' | 'check' | 'knee_block' | 'catch';

export type ImpactPosture = 'distance' | 'clinch' | 'groundTop' | 'groundBottom' | 'wallPinned';

/**
 * The single StrikeImpact contract (§2.6.5). Field names and units are frozen:
 * `forceN` is DELIVERED force on the Pierce scale (placement already applied,
 * 05 sets `cleanMult = 1.0`), `absorb` comes from the defence, and there is
 * deliberately no `rot` field — 05 §2.2.2 `ko.kWeapon` owns rotation.
 */
export interface StrikeImpact {
  tick: number;
  /** 09 `subMs`, 0-99. */
  subTickMs: number;
  attacker: number;
  target: number;
  /** `tech.*` (02 §2.2), or 03's clinch/ground ids, or 'slam'/'throw'. */
  tech: string;
  weapon: Weapon;
  region: TargetRegion;
  subLocation: SubLocation;
  placement: Placement;
  /** Delivered force, newtons, Pierce scale. 05 uses it as `F_del` directly. */
  forceN: number;
  vRel: number;
  effMassKg: number;
  /** 0..1 from the defence outcome (DP §3.3). 05 applies its own brace/rocked terms on top. */
  absorb: number;
  defence: ImpactDefence;
  seen: boolean;
  counter: boolean;
  simultaneous: boolean;
  /** Defender's velocity component toward the attacker, m/s, >= 0. */
  closingSpeedMs: number;
  attackerState: { rocked: boolean; fatigue: number };
  targetState: {
    midAction: boolean; mouthOpen: boolean; guardHand: 'up' | 'away';
    braced: boolean; grounded: boolean;
  };
  posture: ImpactPosture;
  gloveType: GloveType;
  /** Optional rad/s^2 if a head-kinematics model ever exists. v1 never sets it. */
  rotProxy?: number;
  /** Checked-kick shin impact (weapon 'shin_on_knee', forceN = 0.6 x forceN). */
  selfDamage?: StrikeImpact;
}

// ---------------------------------------------------------------------------
// §2.6.1 — the two-stage landing model
// ---------------------------------------------------------------------------

export const PA = Object.freeze({
  /** T4 read probability used in the reference-defender solve. */
  refRead: 0.81,
  clampMin: 0.05,
  clampMax: 0.97,
});

/** The reference defender's behaviour against one technique family. */
export interface ReferenceDefenceMix {
  /** `s_bar`: mean Success of the defences 07's default policy picks. */
  meanSuccess: number;
  /** `p_bar_pass`: passive block rate for the family. */
  passiveRate: number;
}

/**
 * Per-family reference mixes. These are back-solved from the first-pass `pA`
 * table the chapter publishes in §2.6.1 (`s_bar = (1 - P_land/pA - 0.19 x p_bar)/0.81`),
 * so `solvePA` reproduces that table. The jab row is the chapter's own worked
 * example: catch 0.70, parry 0.62, slip 0.55, block 0.62 mixed -> 0.60, passive
 * 0.25, denominator 1 - 0.486 - 0.048 = 0.466, `pA = 0.30 / 0.466 = 0.64` [D].
 *
 * Low kicks sit at a mean success of 0.14 not because legs are hard to defend
 * but because a *checked* kick still counts as contact on the leg (§2.6.1 stat
 * rule) — which is exactly what makes UFCStats leg accuracy 80 %.
 */
export type ReferenceFamily =
  | 'jabHead' | 'powerHead' | 'bodyPunch' | 'elbowKnee' | 'teep'
  | 'lowKick' | 'obliqueKick' | 'bodyKick' | 'headKick';

export const REFERENCE_MIX: Readonly<Record<ReferenceFamily, ReferenceDefenceMix>> = Object.freeze({
  jabHead: { meanSuccess: 0.600, passiveRate: 0.25 },
  powerHead: { meanSuccess: 0.559, passiveRate: 0.25 },
  bodyPunch: { meanSuccess: 0.489, passiveRate: 0.20 },
  elbowKnee: { meanSuccess: 0.447, passiveRate: 0.20 },
  teep: { meanSuccess: 0.480, passiveRate: 0.15 },
  lowKick: { meanSuccess: 0.139, passiveRate: 0.05 },
  obliqueKick: { meanSuccess: 0.235, passiveRate: 0.05 },
  bodyKick: { meanSuccess: 0.485, passiveRate: 0.15 },
  headKick: { meanSuccess: 0.512, passiveRate: 0.15 },
});

/** Which reference mix a technique is solved against. */
export function referenceFamilyFor(spec: TechniqueSpec): ReferenceFamily {
  const body = spec.targets[0] === 'body';
  switch (spec.family) {
    case 'straight':
    case 'hook':
    case 'uppercut':
    case 'overhand':
      if (body) return 'bodyPunch';
      return spec.skill === 'boxing.jab' ? 'jabHead' : 'powerHead';
    case 'elbow':
    case 'knee':
      return 'elbowKnee';
    case 'teep': return 'teep';
    case 'lowKick':
      return spec.flags.includes('kneeJointTargeted') ? 'obliqueKick' : 'lowKick';
    case 'bodyKick': return 'bodyKick';
    case 'headKick': return 'headKick';
    case 'spinning':
      return spec.targets[0] === 'head' ? 'powerHead' : 'bodyKick';
  }
}

/**
 * Solve `pA` from `P_land = pA x (1 - r x s_bar - (1 - r) x p_bar_pass)`
 * (§2.6.1). The calibration script (09 §7) re-solves this against the live
 * defence layer; this closed form is the first pass and the engine default.
 */
export function solvePA(spec: TechniqueSpec, pLand = spec.baseLand, mix?: ReferenceDefenceMix): number {
  const m = mix ?? REFERENCE_MIX[referenceFamilyFor(spec)];
  const denom = 1 - PA.refRead * m.meanSuccess - (1 - PA.refRead) * m.passiveRate;
  if (denom <= 0) return PA.clampMax;
  return clamp(pLand / denom, PA.clampMin, PA.clampMax);
}

/** Memoised `pA` per technique; the engine reads this, not `baseLand`. */
const PA_CACHE = new Map<TechniqueId, number>();

export function arrivalBase(spec: TechniqueSpec): number {
  const cached = PA_CACHE.get(spec.id);
  if (cached !== undefined) return cached;
  const pa = solvePA(spec);
  PA_CACHE.set(spec.id, pa);
  return pa;
}

/**
 * The chapter's published first-pass `pA` values (§2.6.1), kept so a test can
 * assert the solve reproduces them and a reviewer can see the arithmetic.
 */
export const PA_FIRST_PASS: Readonly<Record<string, number>> = Object.freeze({
  'tech.jab': 0.64,
  'tech.jab_step': 0.69,
  'tech.jab_power': 0.58,
  'tech.jab_body': 0.92,
  'tech.cross': 0.60,
  'tech.cross_body': 0.88,
  'tech.hook_lead': 0.56,
  'tech.hook_rear': 0.50,
  'tech.hook_lead_body': 0.88,
  'tech.uppercut_rear': 0.72,
  'tech.overhand': 0.46,
  'tech.elbow_horizontal': 0.60,
  'tech.knee_straight': 0.70,
  'tech.teep_lead': 0.95,
  'tech.teep_rear': 0.85,
  'tech.kick_low_rear': 0.89,
  'tech.kick_calf': 0.92,
  'tech.kick_oblique': 0.75,
  'tech.kick_body_rear': 0.95,
  'tech.kick_head_rear': 0.36,
  'tech.kick_question_mark': 0.27,
});

// ---------------------------------------------------------------------------
// §2.6.2 — arrival modifiers
// ---------------------------------------------------------------------------

export const ARRIVAL = Object.freeze({
  attackerFatigue: -0.35,
  defenderFatigue: 0.45,
  defenderRocked: 0.80,
  defenderStunned: 0.30,
  defenderBodyHurt: 0.50,
  attackerRocked: -0.60,
  defenderLegDamage: 0.25,
  defenderRePlanting: 0.50,
  defenderMidSwitch: 0.45,
  defenderBackTurned: 0.60,
  attackerFeetCrossed: -0.50,
  guardHandAway: 0.30,
  defenderVisionBlocked: 0.30,
  attackerEyesClosed: -0.60,
});

/** State the §2.6.2 modifier table reads. Every field is optional and defaults to "no". */
export interface ArrivalContext {
  /** `k_skill x (attacker technique sub-skill - defender defence sub-skill)/100`. */
  attackerSkill?: number;
  defenderSkill?: number;
  /** Sum of the set-up, feint, rhythm, range-fit, angle, stance and reach terms. */
  setupLogit?: number;
  attackerFatigue?: number;
  defenderFatigue?: number;
  defenderRocked?: boolean;
  defenderStunned?: boolean;
  defenderBodyHurt?: boolean;
  attackerRocked?: boolean;
  /** 05's mobility 0-1; 1 = unimpaired. */
  defenderMobility?: number;
  defenderRePlanting?: boolean;
  defenderMidSwitch?: boolean;
  defenderBackTurned?: boolean;
  attackerFeetCrossed?: boolean;
  defenderGuardHandAway?: boolean;
  defenderVisionBlocked?: boolean;
  attackerEyesClosed?: boolean;
  /** Logit from the defender's guard posture (negative = defended). */
  guardLogit?: number;
}

/**
 * §2.6.2. Age deliberately contributes nothing: accuracy is preserved with age,
 * and the volume cost belongs to 07 and 05 [S: LB §5.8].
 */
export function arrivalLogit(spec: TechniqueSpec, ctx: ArrivalContext, kSkill = 2.0): number {
  let l = ctx.setupLogit ?? 0;
  l += kSkill * ((ctx.attackerSkill ?? 50) - (ctx.defenderSkill ?? 50)) / 100;
  l += ARRIVAL.attackerFatigue * clamp01(ctx.attackerFatigue ?? 0);
  l += ARRIVAL.defenderFatigue * clamp01(ctx.defenderFatigue ?? 0);
  if (ctx.defenderRocked) l += ARRIVAL.defenderRocked;
  if (ctx.defenderStunned) l += ARRIVAL.defenderStunned;
  if (ctx.defenderBodyHurt && spec.targets[0] === 'head') l += ARRIVAL.defenderBodyHurt;
  if (ctx.attackerRocked) l += ARRIVAL.attackerRocked;
  if (ctx.defenderMobility !== undefined) {
    l += ARRIVAL.defenderLegDamage * (1 - clamp01(ctx.defenderMobility));
  }
  if (ctx.defenderRePlanting) l += ARRIVAL.defenderRePlanting;
  if (ctx.defenderMidSwitch) l += ARRIVAL.defenderMidSwitch;
  if (ctx.defenderBackTurned) l += ARRIVAL.defenderBackTurned;
  if (ctx.attackerFeetCrossed) l += ARRIVAL.attackerFeetCrossed;
  if (ctx.defenderGuardHandAway) l += ARRIVAL.guardHandAway;
  if (ctx.defenderVisionBlocked) l += ARRIVAL.defenderVisionBlocked;
  if (ctx.attackerEyesClosed) l += ARRIVAL.attackerEyesClosed;
  l += ctx.guardLogit ?? 0;
  return l;
}

// ---------------------------------------------------------------------------
// §2.6.3 — placement and sub-location
// ---------------------------------------------------------------------------

export type PlacementFamily =
  'headPunch' | 'headElbowKnee' | 'headKick' | 'body' | 'legKick' | 'teep';

type PlacementWeights = readonly [flush: number, solid: number, partial: number, glancing: number];

/** §2.6.3 base weights, tuned so 05's hook KD-per-landed-strike holds. */
export const PLACEMENT_BASE: Readonly<Record<PlacementFamily, PlacementWeights>> = Object.freeze({
  headPunch: [0.20, 0.35, 0.30, 0.15],
  headElbowKnee: [0.25, 0.35, 0.25, 0.15],
  headKick: [0.25, 0.30, 0.25, 0.20],
  body: [0.30, 0.40, 0.20, 0.10],
  // Shin on thigh: the leg is a big, slow target, so most contacts are clean.
  legKick: [0.45, 0.35, 0.15, 0.05],
  teep: [0.35, 0.40, 0.20, 0.05],
});

export const PLACEMENT = Object.freeze({
  /** Force multipliers, consistent with DP §3.1 cleanMult 1.0 / 0.5 / 0.25. */
  mult: { flush: 1.00, solid: 0.75, partial: 0.45, glancing: 0.25 } as Readonly<Record<Placement, number>>,
  /** Absorb passed to 05 when the placement itself is what softened it. */
  absorbPartialBlocked: 0.45,
  absorbPartialRolled: 0.60,
  absorbGlancing: 0.60,
  unseenFlushMult: 1.75,
  unseenGlancingMult: 0.65,
  narrowFailGlancingMult: 2.5,
  narrowFailFlushMult: 0.5,
  /** "Rolled with it": an evasive defence that failed by less than this. */
  narrowFailMargin: 0.15,
  blockedPartial: 0.70,
  blockedGlancing: 0.30,
  precisionK: 0.5,
  headMovementK: -0.4,
  rockedFlushMult: 1.5,
});

export function placementFamilyFor(spec: TechniqueSpec, region: TargetRegion): PlacementFamily {
  if (region === 'leadLeg' || region === 'rearLeg') return 'legKick';
  if (region === 'body' || region === 'arms') {
    return spec.family === 'teep' ? 'teep' : 'body';
  }
  switch (spec.family) {
    case 'elbow':
    case 'knee': return 'headElbowKnee';
    case 'headKick': return 'headKick';
    case 'teep': return 'teep';
    case 'spinning': return 'headKick';
    default: return 'headPunch';
  }
}

export interface PlacementContext {
  /** False when the defender never saw it (no read, angle, spin, mid-action). */
  seen: boolean;
  /** An evasive defence failed by less than `narrowFailMargin` — "rolled with it". */
  narrowFail?: boolean;
  /** The strike was blocked: only partial and glancing remain. */
  blocked?: boolean;
  /** A check that came too late: the kick lands on the knee or ankle, flush. */
  lateCheck?: boolean;
  /** Attacker's `boxing.power` or `kickboxing.roundKick`, 0-100. */
  attackerPrecision?: number;
  /** Defender's `boxing.headMovement`, 0-100. */
  defenderHeadMovement?: number;
  defenderRocked?: boolean;
  /** A failed slip/pull leaves the chin square: flush weight +0.15. */
  failedEvasionFlushAdd?: number;
}

/** §2.6.3 weights after every shift, renormalised. Order: flush, solid, partial, glancing. */
export function placementWeights(
  spec: TechniqueSpec,
  region: TargetRegion,
  ctx: PlacementContext,
): PlacementWeights {
  if (ctx.lateCheck) return [1, 0, 0, 0];
  if (ctx.blocked) return [0, 0, PLACEMENT.blockedPartial, PLACEMENT.blockedGlancing];

  const base = PLACEMENT_BASE[placementFamilyFor(spec, region)];
  let [flush, solid, partial, glancing] = base;

  if (!ctx.seen) {
    flush *= PLACEMENT.unseenFlushMult;
    glancing *= PLACEMENT.unseenGlancingMult;
  }
  if (ctx.narrowFail) {
    glancing *= PLACEMENT.narrowFailGlancingMult;
    flush *= PLACEMENT.narrowFailFlushMult;
  }
  if (ctx.defenderRocked) flush *= PLACEMENT.rockedFlushMult;

  // Additive weight terms: precision buys flush landings, head movement denies them.
  flush += PLACEMENT.precisionK * ((ctx.attackerPrecision ?? 50) - 50) / 100;
  flush += PLACEMENT.headMovementK * ((ctx.defenderHeadMovement ?? 50) - 50) / 100;
  flush += ctx.failedEvasionFlushAdd ?? 0;

  flush = Math.max(0, flush);
  const total = flush + solid + partial + glancing;
  return [flush / total, solid / total, partial / total, glancing / total];
}

const PLACEMENTS: readonly Placement[] = ['flush', 'solid', 'partial', 'glancing'];

/** §2.6.3 head sub-location weights, anchored on the Hutchison KO-location shares. */
export type SubLocationFamily = 'straights' | 'hooks' | 'uppercuts' | 'elbows' | 'headKicks' | 'knees';

const HEAD_SITES: readonly HeadSite[] = ['chin', 'temple', 'midface', 'forehead', 'orbit'];

export const SUB_HEAD: Readonly<Record<SubLocationFamily, readonly number[]>> = Object.freeze({
  //            chin  temple midface forehead orbit
  straights: [0.25, 0.05, 0.40, 0.20, 0.10],
  hooks: [0.35, 0.25, 0.20, 0.05, 0.15],
  uppercuts: [0.60, 0.05, 0.30, 0.00, 0.05],
  elbows: [0.20, 0.25, 0.20, 0.15, 0.20],
  headKicks: [0.30, 0.35, 0.15, 0.10, 0.10],
  knees: [0.35, 0.10, 0.40, 0.10, 0.05],
});

const BODY_SITES: readonly BodySite[] = ['liver', 'solar', 'ribs', 'spleen', 'abdomen'];
/** §2.6.3 body weights; a liver-targeted strike lifts liver from 0.15 to 0.60. */
export const SUB_BODY: readonly number[] = [0.15, 0.20, 0.45, 0.10, 0.10];
export const SUB_BODY_LIVER_TARGETED = 0.60;

export function subLocationFamilyFor(spec: TechniqueSpec): SubLocationFamily {
  switch (spec.family) {
    case 'straight': return 'straights';
    case 'hook':
    case 'overhand': return 'hooks';
    case 'uppercut': return 'uppercuts';
    case 'elbow': return 'elbows';
    case 'knee': return 'knees';
    case 'headKick':
    case 'teep':
    case 'spinning': return 'headKicks';
    default: return 'straights';
  }
}

/** Weights over the sites of the region the strike is landing in. */
export function subLocationWeights(
  spec: TechniqueSpec,
  region: TargetRegion,
): { sites: readonly SubLocation[]; weights: readonly number[] } {
  if (region === 'head') {
    return { sites: HEAD_SITES, weights: SUB_HEAD[subLocationFamilyFor(spec)] };
  }
  if (region === 'body') {
    const w = [...SUB_BODY];
    if (spec.flags.includes('liverTargeted')) {
      w[0] = SUB_BODY_LIVER_TARGETED;
    }
    return { sites: BODY_SITES, weights: w };
  }
  if (region === 'arms') {
    return { sites: ['forearm', 'hand'], weights: [0.85, 0.15] };
  }
  // Legs: the technique names its own site (§2.2.4).
  if (spec.flags.includes('calfTargeted')) return { sites: ['calf'], weights: [1] };
  if (spec.flags.includes('kneeJointTargeted')) return { sites: ['knee'], weights: [1] };
  if (spec.id === 'tech.kick_inside_low') return { sites: ['thigh_inner'], weights: [1] };
  return { sites: ['thigh_outer', 'thigh_inner', 'knee'], weights: [0.75, 0.20, 0.05] };
}

// ---------------------------------------------------------------------------
// §2.6.4 — the force model
// ---------------------------------------------------------------------------

export const FORCE = Object.freeze({
  /**
   * Log-normal spread of delivered force. 0.30 is chosen together with the
   * placement mix so that landed head punches reproduce Pierce: mean placement
   * multiplier 0.20 + 0.26 + 0.135 + 0.04 = 0.64, `F_med(cross) = 1400` ->
   * median ~900-1000 N, ~87 % < 1500 N, ~3-5 % >= 2000 N.
   */
  sigma: 0.30,
  tierStraight: [0.50, 0.60, 0.72, 0.85, 1.00, 1.05] as readonly number[],
  tierHook: [0.22, 0.35, 0.55, 0.78, 1.00, 1.05] as readonly number[],
  /** = 01 `hipRotationMult`. */
  tierKick: [0.50, 0.60, 0.75, 1.00, 1.05, 1.10] as readonly number[],
  powerSlope: 0.008,
  powerExplosivenessShare: 0.6,
  powerStrengthShare: 0.4,
  massExpPunch: 0.5,
  massExpKick: 0.8,
  fatigueStraight: 0.28,
  fatigueRotational: 0.40,
  rearHandFatigue: 1.2,
  speedBase: 0.85,
  speedSlope: 0.003,
  speedFatigue: 0.18,
  commitRetreat: 0.70,
  commitArmPunch: 0.60,
  commitTouch: 0.50,
  commitInstep: 0.70,
  capOvershoot: 1.15,
  /** Checked kicks send 60 % of the raw force back into the kicker's shin. */
  checkedShinFrac: 0.60,
  knockdownKneeBlockFrac: 0.40,
});

export type CommitMode = 'planted' | 'retreating' | 'armPunch' | 'touch' | 'instep';

export function commitMult(mode: CommitMode): number {
  switch (mode) {
    case 'retreating': return FORCE.commitRetreat;
    case 'armPunch': return FORCE.commitArmPunch;
    case 'touch': return FORCE.commitTouch;
    case 'instep': return FORCE.commitInstep;
    default: return 1;
  }
}

export interface ForceContext {
  tier: number;
  massKg: number;
  /** 0-100 each; `power = 0.6 explosiveness + 0.4 strength`. */
  explosiveness: number;
  strength: number;
  /** `handSpeed` for punches, `kickSpeed` for kicks. */
  weaponSpeedAttr: number;
  fatigue: number;
  commit: CommitMode;
  /** §2.1.1 `rangeFitMult`. */
  rangeFitMult?: number;
  /** Defender's velocity component toward the attacker, m/s, >= 0. */
  closingSpeedMs?: number;
  /** `move.shift` adds 15 % (§2.1.5). */
  shift?: boolean;
  /** Counter force multipliers from the §2.5.2 table (check hook x1.5, knee x1.3). */
  counterForceMult?: number;
}

/** Force tier multiplier for this technique family (§2.6.4). */
export function tierForceMult(family: TechniqueFamily, tier: number): number {
  const t = clampTier(tier);
  if (isKickFamily(family) || family === 'knee') return FORCE.tierKick[t];
  if (isRotational(family)) return FORCE.tierHook[t];
  return FORCE.tierStraight[t];
}

/** `powerMult = 1 + 0.008 x (power - 50)`, `power = 0.6 explosiveness + 0.4 strength`. */
export function powerMult(explosiveness: number, strength: number): number {
  const power = FORCE.powerExplosivenessShare * explosiveness + FORCE.powerStrengthShare * strength;
  return 1 + FORCE.powerSlope * (power - 50);
}

/**
 * `massMult` — exponent 0.5 for punches, 0.8 for kicks. Deliberately weak for
 * punches: Pierce found in-ring force essentially uncorrelated with mass
 * (r = 0.22), so the model must not turn mass into a punching-power dial.
 */
export function massMult(massKg: number, family: TechniqueFamily): number {
  const exp = isKickFamily(family) || family === 'knee' ? FORCE.massExpKick : FORCE.massExpPunch;
  return Math.pow(massKg / REFERENCE_MASS_KG, exp);
}

/** Rotational strikes lose power to fatigue about twice as fast as the jab. */
export function fatigueForceMult(spec: TechniqueSpec, fatigue: number): number {
  const rotationalOrKick = isRotational(spec.family) || isKickFamily(spec.family);
  const f = clamp01(spec.limb === 'rearHand'
    ? Math.min(1, FORCE.rearHandFatigue * fatigue)
    : fatigue);
  const k = rotationalOrKick ? FORCE.fatigueRotational : FORCE.fatigueStraight;
  return 1 - k * f;
}

/** Impact velocity: `v_ref x (0.85 + 0.003 x speed) x (1 - 0.18 f) + kClose x closing`. */
export function relativeVelocity(spec: TechniqueSpec, ctx: ForceContext): number {
  return spec.vRefMs
    * (FORCE.speedBase + FORCE.speedSlope * ctx.weaponSpeedAttr)
    * (1 - FORCE.speedFatigue * clamp01(ctx.fatigue))
    + CTR.kClose * Math.max(0, ctx.closingSpeedMs ?? 0);
}

/** Effective mass: catalogue kg scaled to this fighter's mass and commitment. */
export function effectiveMass(spec: TechniqueSpec, ctx: ForceContext): number {
  return spec.effectiveMassKg * (ctx.massKg / REFERENCE_MASS_KG) * commitMult(ctx.commit);
}

/**
 * The deterministic part of the force product — everything except the lognormal
 * draw and the placement multiplier. Exposed so calibration can see the split.
 */
export function forceScale(spec: TechniqueSpec, ctx: ForceContext): number {
  const closing = relativeVelocity(spec, ctx) / (spec.vRefMs * (FORCE.speedBase + FORCE.speedSlope * 50));
  return spec.forceMedianN
    * tierForceMult(spec.family, ctx.tier)
    * powerMult(ctx.explosiveness, ctx.strength)
    * massMult(ctx.massKg, spec.family)
    * fatigueForceMult(spec, ctx.fatigue)
    * commitMult(ctx.commit)
    * (ctx.rangeFitMult ?? 1)
    * Math.max(0.1, closing)
    * (ctx.shift ? 1.15 : 1)
    * (ctx.counterForceMult ?? 1);
}

// ---------------------------------------------------------------------------
// the pipeline
// ---------------------------------------------------------------------------

export type StrikeOutcome =
  'landed' | 'blocked' | 'evaded' | 'missed' | 'checked' | 'caught';

/** A reactive defence that fired, with its already-modified success probability. */
export interface ResolvedDefence {
  spec: DefenceSpec;
  /** Final P(success) after skill gap, guard, cage and feint modifiers. */
  successP: number;
}

export interface StrikeResolveInput {
  tick: number;
  /** 09 `subMs`, 0-99. */
  subTickMs: number;
  attacker: number;
  target: number;
  spec: TechniqueSpec;
  /** Region actually aimed at (the AI may retarget within `spec.targets`). */
  region: TargetRegion;

  /** Overrides the derived `pA` (calibration re-solve, or a conditional P_land). */
  pA?: number;
  /** Sum of the §2.6.2 modifiers. */
  arrivalLogit?: number;

  /** The reactive defence the defender chose, or null (posture only). */
  defence?: ResolvedDefence | null;
  /** P(the guard stops it) when no reactive defence fired (§2.6.1 step 6). */
  passiveBlockP?: number;
  /** Guard posture, used only for the passive absorb when one is not supplied. */
  guard?: GuardSpec;

  placement?: Omit<PlacementContext, 'seen' | 'narrowFail' | 'blocked' | 'lateCheck'>;
  /** False when the defender never saw it coming. */
  seen: boolean;
  counter?: boolean;
  simultaneous?: boolean;

  force: ForceContext;
  gloveType: GloveType;
  posture?: ImpactPosture;
  attackerState?: { rocked: boolean; fatigue: number };
  targetState?: StrikeImpact['targetState'];
}

export interface StrikeResolution {
  outcome: StrikeOutcome;
  /** The event `result` (events.ts `StrikeResult`). */
  result: StrikeOutcome;
  placement: Placement | null;
  subLocation: SubLocation | null;
  /** Delivered force, N. 0 when nothing arrived. */
  forceN: number;
  /** The payload for 05, or null when no contact happened. */
  impact: StrikeImpact | null;
  /** The defence that produced the outcome, for the event detail. */
  defence: DefenceId | null;
  /** P used for the arrival roll, after modifiers — exposed for calibration. */
  arrivalP: number;
  /** True when the defence failed by less than the narrow-fail margin. */
  narrowFail: boolean;
  /** Counter window opened on the attacker, ms (§2.5.1). */
  counterWindowMs: number;
  /** Stat-counting (§2.6.1): does UFCStats credit this as a landed strike? */
  statLanded: boolean;
  /** RNG draws consumed. Always 6 (09 §2.7). */
  draws: number;
}

/** Draws consumed by one call to `resolveStrike`, always, in every branch. */
export const DRAWS_PER_STRIKE = 6;

/**
 * §2.6.1 steps 5-11. Steps 1-4 (legality, timeline, the defender's reads and
 * response) happen in P3 and are the caller's job; their draws are already
 * spent by the time this runs.
 */
export function resolveStrike(rng: RNG, input: StrikeResolveInput): StrikeResolution {
  const { spec, region } = input;

  // --- all six draws, up front, in the 09 §2.7 order. Drawing before branching
  // is what makes the stream position independent of the outcome.
  const uArrival = rng.next();
  const uDefence = rng.next();
  const uPlacement = rng.next();
  const uSub = rng.next();
  const forceZ = rng.normal(0, 1);

  // --- step 5: arrival
  const pa = input.pA ?? arrivalBase(spec);
  const arrivalP = sigmoid(logit(pa) + (input.arrivalLogit ?? 0));
  const arrived = uArrival < arrivalP;

  // --- step 6: defence or passive posture
  const def = input.defence ?? null;
  let outcome: StrikeOutcome = 'landed';
  let defenceId: DefenceId | null = null;
  let narrowFail = false;
  let defenceAbsorb = 0;
  let impactDefence: ImpactDefence = 'none';
  let blocked = false;
  let lateCheck = false;
  let smothered = false;
  let failedEvasionFlushAdd = input.placement?.failedEvasionFlushAdd ?? 0;

  if (!arrived) {
    outcome = 'missed';
  } else if (def) {
    const successP = clamp01(def.successP);
    if (uDefence < successP) {
      defenceId = def.spec.id;
      defenceAbsorb = def.spec.absorb;
      impactDefence = def.spec.impactDefence;
      switch (def.spec.outcome) {
        case 'evaded': outcome = 'evaded'; break;
        case 'blocked': outcome = 'blocked'; blocked = true; break;
        case 'checked': outcome = 'checked'; break;
        case 'caught': outcome = 'caught'; break;
        case 'landed_partial':
          // def.step_in_smother: the kick lands, but on the thigh or upper body
          // with no arc behind it.
          outcome = 'landed'; smothered = true; break;
      }
    } else {
      // The defence failed. How narrowly decides where the strike lands: an
      // evasion that missed by a hair means the defender "rolled with it"
      // (glancing x2.5), one that missed by a mile means the chin was square
      // when it arrived (flush +0.15).
      narrowFail = def.spec.evasive && uDefence < successP + PLACEMENT.narrowFailMargin;
      defenceId = def.spec.id;
      impactDefence = narrowFail ? 'roll' : failedDefenceImpact(def.spec);
      if (def.spec.evasive && !narrowFail) failedEvasionFlushAdd = FAILED_EVASION_FLUSH_ADD;
      // A check that came too late lands the kick on the knee or the ankle.
      if (def.spec.id === 'def.check') lateCheck = true;
    }
  } else {
    const pPass = clamp01(input.passiveBlockP ?? 0);
    if (uDefence < pPass) {
      outcome = 'blocked';
      blocked = true;
      defenceAbsorb = 0.45;
      impactDefence = 'block_glove';
    }
  }

  const contact = outcome === 'landed' || outcome === 'blocked'
    || outcome === 'checked' || outcome === 'caught';

  // --- step 7: placement (drawn even when nothing arrived, for stream stability)
  const pctx: PlacementContext = {
    ...(input.placement ?? {}),
    seen: input.seen,
    narrowFail,
    blocked,
    lateCheck,
    failedEvasionFlushAdd,
  };
  const weights = placementWeights(spec, region, pctx);
  const placement = PLACEMENTS[pickWeighted(uPlacement, weights)];

  // --- step 8: sub-location
  const { sites, weights: subW } = subLocationWeights(spec, region);
  const subLocation = sites[pickWeighted(uSub, subW)];

  // --- step 9: force
  const placementMult = smothered ? 0.4 : PLACEMENT.mult[placement];
  const raw = forceScale(spec, input.force) * Math.exp(FORCE.sigma * forceZ);
  const capped = Math.min(raw * placementMult, spec.forceCapN * FORCE.capOvershoot);
  const forceN = contact ? capped : 0;

  // Absorb: the defence's own value, with the placement floor of §2.6.3 under
  // it (a strike nobody defended can still arrive glancing).
  const placementAbsorb = placement === 'partial'
    ? (blocked ? PLACEMENT.absorbPartialBlocked : narrowFail ? PLACEMENT.absorbPartialRolled : 0)
    : placement === 'glancing' ? PLACEMENT.absorbGlancing : 0;
  const absorb = Math.max(defenceAbsorb, placementAbsorb);

  // --- step 10 / 11: payload and self-damage
  let impact: StrikeImpact | null = null;
  if (contact) {
    impact = {
      tick: input.tick,
      subTickMs: input.subTickMs,
      attacker: input.attacker,
      target: input.target,
      tech: spec.id,
      weapon: spec.weapon,
      region,
      subLocation,
      placement,
      forceN,
      vRel: relativeVelocity(spec, input.force),
      effMassKg: effectiveMass(spec, input.force),
      absorb: clamp01(absorb),
      defence: impactDefence,
      seen: input.seen,
      counter: input.counter ?? false,
      simultaneous: input.simultaneous ?? false,
      closingSpeedMs: Math.max(0, input.force.closingSpeedMs ?? 0),
      attackerState: input.attackerState ?? { rocked: false, fatigue: input.force.fatigue },
      targetState: input.targetState ?? {
        midAction: false, mouthOpen: false, guardHand: 'up', braced: false, grounded: false,
      },
      posture: input.posture ?? 'distance',
      gloveType: input.gloveType,
    };
    // §2.2.4: a checked kick puts 60 % of the raw force into the kicker's own
    // shin. The kicker's shin pool (05) is what makes kick output fall late.
    if (outcome === 'checked' && spec.flags.includes('selfDamageOnCheck')) {
      impact.selfDamage = {
        ...impact,
        attacker: input.attacker,
        target: input.attacker,
        weapon: 'shin_on_knee',
        region: spec.limb === 'leadLeg' ? 'leadLeg' : 'rearLeg',
        subLocation: 'shin',
        forceN: forceN * FORCE.checkedShinFrac,
        absorb: 0,
        defence: 'none',
        seen: true,
        counter: false,
        simultaneous: false,
        selfDamage: undefined,
      };
    }
  }

  // §2.6.1 stat rule: landed = the strike made contact and was not blocked away;
  // a checked low kick still counts as contact on the leg, which is what makes
  // UFCStats leg accuracy 80 %. Blocked strikes that move the head count with
  // P 0.30 — exposed as a probability, never as a seventh draw.
  const statLanded = outcome === 'landed' || outcome === 'checked';

  return {
    outcome,
    result: outcome,
    placement: contact ? placement : null,
    subLocation: contact ? subLocation : null,
    forceN,
    impact,
    defence: defenceId,
    arrivalP,
    narrowFail,
    counterWindowMs: spec.counterWindowMs * counterWindowFraction(outcome),
    statLanded,
    draws: DRAWS_PER_STRIKE,
  };
}

/** §2.6.1: blocked head/body strikes count as landed-partial with this probability. */
export const BLOCKED_COUNTS_LANDED_P = 0.30;

/** A failed evasion leaves the chin square: flush weight +0.15 (§2.4.2 `def.slip_out`). */
export const FAILED_EVASION_FLUSH_ADD = 0.15;

function counterWindowFraction(outcome: StrikeOutcome): number {
  switch (outcome) {
    case 'missed':
    case 'evaded': return CTR.windowMissed;
    case 'checked': return CTR.windowChecked;
    case 'blocked':
    case 'caught': return CTR.windowBlocked;
    default: return CTR.windowLanded;
  }
}

/** A failed slip or pull is what 05 calls `slip_late`; everything else is none. */
function failedDefenceImpact(d: DefenceSpec): ImpactDefence {
  return d.impactDefence === 'slip_late' ? 'slip_late' : 'none';
}

/** Categorical pick from a pre-drawn uniform. Consumes no RNG. */
export function pickWeighted(u: number, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += w > 0 ? w : 0;
  if (total <= 0) return 0;
  let r = u * total;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] > 0 ? weights[i] : 0;
    if (r < w) return i;
    r -= w;
  }
  return weights.length - 1;
}

// ---------------------------------------------------------------------------
// calibration helper — the reference defender of §2.6.1
// ---------------------------------------------------------------------------

/**
 * Builds the reference-defender inputs the `pA` solve assumes: a T4 defender
 * who reads the strike with P = 0.81 and then applies the family's mean
 * defence, or the family's passive block rate when the read failed.
 *
 * `readSucceeded` is decided by the caller (the read draw belongs to 07's P3
 * block, not to the contact block), which keeps `resolveStrike` at exactly six
 * draws. Feeding this into `resolveStrike` over many samples must reproduce the
 * catalogue's `baseLand` — that is the calibration invariant of §5 step 1.
 */
export function referenceDefenderInput(
  spec: TechniqueSpec,
  readSucceeded: boolean,
  base: Omit<StrikeResolveInput, 'defence' | 'passiveBlockP' | 'spec'>,
): StrikeResolveInput {
  const mix = REFERENCE_MIX[referenceFamilyFor(spec)];
  if (!readSucceeded) {
    return { ...base, spec, defence: null, passiveBlockP: mix.passiveRate };
  }
  // A generic "the defender did something and it worked s_bar of the time".
  // It is deliberately an `evaded` defence: an evasion is the neutral case for
  // the marginal, since blocked strikes would otherwise re-enter as contact.
  const generic: DefenceSpec = {
    ...REFERENCE_DEFENCE_STUB,
    success: mix.meanSuccess,
  };
  return { ...base, spec, defence: { spec: generic, successP: mix.meanSuccess }, passiveBlockP: 0 };
}

/**
 * The stand-in defence used by the reference-defender solve. It is not a
 * catalogue entry: it represents "whatever the reference defender did", whose
 * only property that matters to the marginal is that it stops the strike.
 */
const REFERENCE_DEFENCE_STUB: DefenceSpec = {
  id: 'def.reference_mix',
  name: 'Reference defence mix (calibration only)',
  vs: [],
  weakVs: [],
  execMs: 0,
  success: 0.5,
  k: 0,
  subSkill: 'boxing.guard',
  outcome: 'evaded',
  absorb: 0,
  counter: { quality: 'none', bonus: 0 },
  impactDefence: 'none',
  evasive: false,
  minTier: 0,
  cost: 'Calibration stub; never selected in a bout.',
  tag: '[D: §2.6.1 pA solve]',
};

/** Marginal P(landed) the two-stage model produces against the reference defender. */
export function marginalLandP(spec: TechniqueSpec, pA = arrivalBase(spec)): number {
  const mix = REFERENCE_MIX[referenceFamilyFor(spec)];
  return pA * (1 - PA.refRead * mix.meanSuccess - (1 - PA.refRead) * mix.passiveRate);
}

/** `k_skill` applied to the arrival skill gap, per §2.6.2. */
export function arrivalSkillK(spec: TechniqueSpec): number {
  return strikeClasses(spec).some((c) =>
    c === 'elbow' || c === 'knee' || c === 'lowKick' || c === 'calfKick'
    || c === 'bodyKick' || c === 'headKick' || c === 'teep' || c === 'spinning')
    ? 2.5 : 2.0;
}

/** Success of a defence against a technique, before state modifiers (§2.4.2). */
export function baseDefenceSuccess(d: DefenceSpec, spec: TechniqueSpec): number {
  return defenceSuccessFor(d, spec);
}

// ---------------------------------------------------------------------------

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

function clampTier(t: number): number {
  return t < 0 ? 0 : t > 5 ? 5 : Math.floor(t);
}
