/**
 * ACTIONS — the legal candidate set for one fighter on one tick.
 *
 * The utility layer scores; this module decides *what there is to score*. That
 * split matters because legality is owned elsewhere: §02 says which strikes
 * reach from this distance and which the ruleset allows, §03 says which edges
 * leave the current node, §04 says which submissions the position offers, and
 * §06 says which of those the ruleset permits at all. Nothing here re-derives
 * any of it — the module reads those catalogues and turns each survivor into a
 * `Candidate` with the catalogue prior of §2.2.1 attached.
 *
 * Two invariants the tests lean on:
 *   1. the list is never empty (there is always `wait`, which is what a
 *      fighter who cannot do anything else actually does);
 *   2. every candidate is legal *and* in range, so the policy can never emit
 *      an action the resolver would reject.
 */
import type { DefenceId, PositionId, TechniqueId } from '../core/ids';
import type { Ruleset } from '../rules/types';
import type { FighterRuntime } from '../fighter';
import {
  TECHNIQUES, hasTechnique, technique, techniqueLegal, type StrikingRulesetFlags, type TechniqueSpec,
  type GloveType as StrikeGloveType,
} from '../striking/catalogue';
import { bandFor, rangeFit, reachProfile, MOVEMENTS, type ReachProfile } from '../striking/range';
import { feintsForTier, type FeintSpec } from '../striking/combos';
import { edgesFrom, hasPositionNode, positionNode, roleFor, type GrapplingEdge } from '../grappling/graph';
import { BOTTOM_GNP, gnpProfile } from '../grappling/gnp';
import { subOffers } from '../grappling/subOffers';
import { isLegalUnderRuleset } from '../submissions/legality';
import type { ActionFamily } from './contracts';
import { tierBehaviourFor, techniqueBlockedBy, type TierBehaviour } from './behaviour';
import { familyForTechnique } from './families';
import type { ScorableAction } from './utility';

export type CandidateKind = 'strike' | 'grapple' | 'submission' | 'defend' | 'move' | 'wait';

/**
 * One scorable option. Extends `ScorableAction` so the utility layer can take
 * it directly; the extra fields are what the policy needs to build a
 * `Decision`.
 */
export interface Candidate extends ScorableAction {
  kind: CandidateKind;
  /** Technique, edge, submission, movement or feint id; null for `wait`. */
  id: string | null;
  family: ActionFamily;
  /** Defensive posture held while the action runs. */
  defence: DefenceId;
  /** Desired velocity in world space, m/s; the loop steers toward it in P5. */
  moveX: number;
  moveZ: number;
  /** Short id for the HUD, commentary and the game-plan panel. */
  intentTag: string;
  /** `|d - optimal| / tolerance`, already normalised (`c.range_fit`). */
  rangeError: number;
  /** Set for strikes: the region the technique is aimed at. */
  targetRegion?: 'head' | 'body' | 'leadLeg' | 'rearLeg' | 'arms';
  /** Set for strikes: the §02 spec, so the execution layer need not look it up. */
  spec?: TechniqueSpec;
  /**
   * A short, arm-only strike in the clinch or on the ground: fast, accurate,
   * light, and not significant under the UFCStats definition (09 §4.1).
   */
  short?: boolean;
}

// ---------------------------------------------------------------------------
// §2.2.1 — catalogue priors
// ---------------------------------------------------------------------------

/**
 * `base(a)`: the family prior. The existing engine's weighted lottery is the
 * starting point (jab 1.5, cross 1.0, head kick 0.28); everything else is
 * interpolated into the same scale and re-fitted in Phase 9 against the
 * FIGHT_DATA target/position shares.
 */
export const BASE_PRIOR: Readonly<Partial<Record<ActionFamily, number>>> = Object.freeze({
  // Phase 9 [E: tuned to FIGHT_DATA §3 #20-#21, target shares of sig
  // attempts head 77 / body 13.5 / legs 9 %]: leg kicks x4, body shots x2.4;
  // the jab x2.3 (FD #36: knockdowns per landed *power* head strike 3.9 %
  // at 0.30 KD per 15 min implies about half a power head strike landed per
  // minute — most distance head strikes are jabs).
  jab: 3.40, cross: 1.00, hook: 0.70, leadHook: 0.70, uppercut: 0.45,
  overhand: 0.40, bodyHook: 1.60, spinning: 0.12,
  teep: 0.60, lowKick: 3.00, leadLowKick: 2.20, bodyKick: 1.30,
  headKick: 0.28, rearKick: 0.40, knee: 0.45, elbow: 0.35,
  feint: 0.55, slipEntry: 0.30, parryCross: 0.35, levelChange: 0.40,
  baitCross: 0.25, inOut: 0.45,
  shoot: 0.50, nakedShot: 0.20, shootOffStrikes: 0.55, bodylockTd: 0.40,
  trip: 0.35, sprawl: 0.60, cagePin: 0.40,
  clinchEntry: 0.45, clinchStrike: 0.55, breakClinch: 0.50, wallWalk: 0.70,
  groundStrike: 0.80, pass: 0.60, ride: 0.45, sweep: 0.30,
  submission: 0.50, bottomSubmission: 0.35, guardPull: 0.08,
  backTake: 0.65, frontHeadlock: 0.40, standUp: 0.75,
  advance: 0.60, retreat: 0.50, circle: 0.55, circleAway: 0.50,
  lateral: 0.50, pivot: 0.45,
  longGuard: 0.25, block: 0.30, check: 0.35, counterWindow: 0.40, leadStrike: 0.35,
  switchStance: 0.15, flee: 0.05, wait: 0.12,
});

export function basePrior(family: ActionFamily): number {
  return BASE_PRIOR[family] ?? 0.3;
}

/**
 * `c.risk` input: how much of a gamble the family is, 0 safe .. 1 all-in.
 * A jab risks nothing; a spinning kick in front of a wrestler risks the fight.
 */
export const RISK_CLASS: Readonly<Partial<Record<ActionFamily, number>>> = Object.freeze({
  jab: 0.10, cross: 0.35, hook: 0.45, leadHook: 0.40, uppercut: 0.45,
  overhand: 0.60, bodyHook: 0.40, spinning: 0.90,
  teep: 0.15, lowKick: 0.35, leadLowKick: 0.30, bodyKick: 0.50,
  headKick: 0.75, rearKick: 0.55, knee: 0.45, elbow: 0.40,
  feint: 0.10, slipEntry: 0.35, parryCross: 0.30, levelChange: 0.30,
  baitCross: 0.40, inOut: 0.25,
  shoot: 0.55, nakedShot: 0.85, shootOffStrikes: 0.45, bodylockTd: 0.50,
  trip: 0.35, sprawl: 0.10, cagePin: 0.30,
  clinchEntry: 0.40, clinchStrike: 0.30, breakClinch: 0.25, wallWalk: 0.20,
  groundStrike: 0.25, pass: 0.35, ride: 0.10, sweep: 0.40,
  submission: 0.55, bottomSubmission: 0.60, guardPull: 0.85,
  backTake: 0.35, frontHeadlock: 0.30, standUp: 0.30,
  advance: 0.30, retreat: 0.05, circle: 0.10, circleAway: 0.10,
  lateral: 0.10, pivot: 0.10,
  longGuard: 0.05, block: 0.02, check: 0.10, counterWindow: 0.35, leadStrike: 0.30,
  switchStance: 0.25, flee: 0.30, wait: 0.02,
});

export function riskClass(family: ActionFamily): number {
  return RISK_CLASS[family] ?? 0.35;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Everything enumeration needs, gathered by the policy from the delayed view. */
export interface EnumerationContext {
  self: FighterRuntime;
  ruleset: Ruleset;
  /** Posture of the deciding fighter. */
  posture: 'standing' | 'clinch' | 'ground' | 'down' | 'out';
  /** Current §03 node when engaged; null when free-standing. */
  node: PositionId | null;
  /** Which slot of the node this fighter holds. */
  slot: 'a' | 'b' | null;
  /** Centre-to-centre distance to the target, metres. */
  distanceM: number;
  /** Own distance to the fence, metres. */
  cageDistM: number;
  /** Whether the fighter is touching the fence (edges that require it). */
  atCage: boolean;
  /** 0-1 damage by region, for `c.own_damage`. */
  damage: { head: number; body: number; leadLeg: number; rearLeg: number; arms: number };
  balance: number;
  /** Set when the target is reachable at all; false suppresses every strike. */
  hasTarget: boolean;
  /** §2.7.3: the outnumbered fighter never chooses the ground. */
  outnumbered: boolean;
  /** Position value of the current node, 0-1 (§03/§04 tables). */
  positionValue: number;
  /** Plan `mustNots`, matched against the candidate's `mustNot` tags. */
  mustNots: readonly string[];
  /** §2.7.3 `c.shield`: 1 when a clinch would occlude another hostile's line. */
  shield: number;
  /** Phase 9: the opponent has a strike in the air (the "on the strike" edges). */
  oppStriking?: boolean;
}

/**
 * Phase 9: edges whose §2.3 requirement is "with a strike in flight". The
 * requirement was text only, so `tech.sweep_on_strike` was on offer on every
 * free tick under a postured top — from side control and low mount too — and
 * made 0.5 reversals a fight on its own (real total 0.26).
 */
const ON_THE_STRIKE_EDGES: ReadonlySet<string> = new Set(['tech.sweep_on_strike']);

// ---------------------------------------------------------------------------
// Ruleset translation
// ---------------------------------------------------------------------------

function gloveTypeFor(ruleset: Ruleset): StrikeGloveType {
  const oz = ruleset.gloves.oz;
  if (ruleset.gloves.bareKnuckle) return 'bare';
  if (oz >= 12) return 'boxing12oz';
  if (oz >= 10) return 'boxing10oz';
  if (oz >= 8) return 'boxing8oz';
  return 'mma4oz';
}

/** §02's availability gate, built from the §06 ruleset. */
export function strikingFlagsFor(ruleset: Ruleset): StrikingRulesetFlags {
  const family: StrikingRulesetFlags['family'] =
    ruleset.family === 'grappling' || ruleset.family === 'judo' ? 'mma' : ruleset.family;
  return {
    gloveType: gloveTypeFor(ruleset),
    elbowsLegal: ruleset.clinch.elbowsAllowed || ruleset.family === 'mma' || ruleset.family === 'muay_thai',
    elbow12to6Legal: ruleset.elbows12to6 === 'legal',
    obliqueKickLegal: ruleset.family !== 'boxing',
    kneesToHeadStandingLegal: ruleset.clinch.kneesAllowed,
    kickCatchRule: ruleset.family === 'muay_thai' ? 'mt' : ruleset.family === 'kickboxing' ? 'kb' : 'mma',
    family,
  };
}

/** Which `mustNot` tags an action carries, for `c.mustnot`. */
function mustNotTagsFor(family: ActionFamily, spec?: TechniqueSpec): readonly string[] {
  const out: string[] = [];
  if (family === 'nakedShot') out.push('mn.naked_shot');
  if (family === 'guardPull') out.push('mn.go_to_ground', 'mn.engage_guard');
  if (family === 'bottomSubmission') out.push('mn.engage_guard');
  if (family === 'rearKick' || family === 'bodyKick' || family === 'headKick') {
    out.push('mn.rear_kick_mid_range', 'mn.kick_the_wrestler');
  }
  if (spec && spec.flags.includes('stepIn')) out.push('mn.lead_with_head');
  return out;
}

function isMustNot(family: ActionFamily, mustNots: readonly string[], spec?: TechniqueSpec): boolean {
  if (mustNots.length === 0) return false;
  for (const tag of mustNotTagsFor(family, spec)) {
    if (mustNots.includes(tag)) return true;
  }
  return false;
}

/**
 * 01 §3's repertoire gate. What a tier does not own is not a weak option, it is
 * not an option: `beh.mt.elbow_availability` says "T0-T1 have w(elbow) = 0",
 * `beh.bjj.sweep_repertoire` says "T0 none (bucks)", `beh.wr.sprawl_late` says
 * an untrained fighter has no sprawl posture to hold. A weight clamped at 0.25
 * would still let a white belt sprawl on one shot in twenty, which is the whole
 * distinction the catalogue exists to draw.
 *
 * The profile is cached on the runtime, so this is a map lookup per candidate.
 */
function repertoireAllows(
  b: TierBehaviour, family: ActionFamily, spec?: TechniqueSpec,
): boolean {
  if (b.forbidden.has(family)) return false;
  if (spec && techniqueBlockedBy(b, spec) !== null) return false;
  return true;
}

function regionDamage(ctx: EnumerationContext, family: ActionFamily, spec?: TechniqueSpec): number {
  if (spec) {
    if (spec.limb === 'leadLeg') return ctx.damage.leadLeg;
    if (spec.limb === 'rearLeg') return ctx.damage.rearLeg;
    return ctx.damage.arms;
  }
  if (family === 'shoot' || family === 'nakedShot' || family === 'shootOffStrikes') {
    return Math.max(ctx.damage.leadLeg, ctx.damage.rearLeg);
  }
  return ctx.damage.body;
}

function mk(
  ctx: EnumerationContext,
  partial: Omit<Candidate, 'base' | 'risk' | 'ownRegionDamage' | 'positionValue' | 'isMustNot' | 'shield'>
  & Partial<Pick<Candidate, 'base' | 'risk' | 'positionValue'>>,
): Candidate {
  return {
    ...partial,
    base: partial.base ?? basePrior(partial.family),
    risk: partial.risk ?? riskClass(partial.family),
    ownRegionDamage: regionDamage(ctx, partial.family, partial.spec),
    positionValue: partial.positionValue ?? ctx.positionValue,
    isMustNot: isMustNot(partial.family, ctx.mustNots, partial.spec),
    shield: partial.family === 'clinchEntry' ? ctx.shield : 0,
  };
}

// ---------------------------------------------------------------------------
// Strikes (§02)
// ---------------------------------------------------------------------------

function profileOf(rt: FighterRuntime): ReachProfile {
  return reachProfile(rt.effectiveReachM, rt.effectiveKickReachM);
}

/**
 * Every technique the fighter could throw right now: tier-available, legal
 * under the ruleset, and inside `rangeFit`'s one-band tolerance. The range
 * error becomes `c.range_fit`'s input, so a technique thrown from the edge of
 * its band is available but unattractive rather than forbidden — the chapter's
 * replacement for the old hard distance gates.
 */
/**
 * QA-5 (Phase 9): the grappling and judo rulesets have no striking at all.
 * `strikingFlagsFor` maps them onto the MMA striking family for the glove and
 * legality tables, which left every punch and kick in the candidate set; each
 * was then refused at contact and logged as a foul.
 */
export function strikingAllowed(ruleset: Ruleset): boolean {
  return ruleset.family !== 'grappling' && ruleset.family !== 'judo';
}

export function strikeCandidates(ctx: EnumerationContext): Candidate[] {
  if (!ctx.hasTarget || !strikingAllowed(ctx.ruleset)) return [];
  if (ctx.posture === 'ground' || ctx.posture === 'down' || ctx.posture === 'out') return [];
  const flags = strikingFlagsFor(ctx.ruleset);
  const profile = profileOf(ctx.self);
  const tier = ctx.self.strikingTier;
  const inClinch = ctx.posture === 'clinch';
  const band = bandFor(ctx.distanceM, profile);
  const behaviour = tierBehaviourFor(ctx.self);
  const out: Candidate[] = [];

  for (const spec of TECHNIQUES) {
    if (spec.minTier > tier) continue;
    if (spec.flags.includes('counterOnly')) continue;
    if (!techniqueLegal(spec, flags)) continue;
    // In the clinch only clinch-band techniques are on the table, and at range
    // the clinch-only ones are not.
    const homeInClinch = spec.band.includes('clinch');
    if (inClinch && !homeInClinch && !spec.band.includes('close')) continue;
    if (!inClinch && band === 'clinch' && !homeInClinch) continue;

    const skill = ctx.self.strikingMean;
    const fit = rangeFit(spec, ctx.distanceM, profile, skill);
    if (!fit.available) continue;

    const family = familyForTechnique(spec.family, spec.limb, spec.targets[0]);
    const asFamily: ActionFamily = inClinch && homeInClinch ? 'clinchStrike' : family;
    // 01 §3 repertoire: `spec.minTier` is the striking aggregate, but the
    // catalogue keys kicks on the Muay Thai tier and elbows on their own row.
    if (!repertoireAllows(behaviour, family, spec)) continue;
    if (asFamily !== family && !repertoireAllows(behaviour, asFamily)) continue;
    out.push(mk(ctx, {
      kind: 'strike',
      id: spec.id,
      family: asFamily,
      defence: 'def.neutral',
      moveX: 0,
      moveZ: 0,
      intentTag: spec.id,
      // `bandsOut` is 0 in the home band, 1 one band away; the curve wants a
      // 0-1 error, and the edge case (10 cm inside the outer edge) shows up as
      // a small non-zero error rather than a cliff.
      rangeError: fit.bandsOut === 0 ? (fit.logit < 0 ? 0.35 : 0) : 0.85,
      targetRegion: spec.targets[0],
      spec,
    }));
    // UFCStats' non-significant strikes are mostly these: short punches and
    // thigh/body knees in the clinch that carry no power (09 §4.1).
    if (inClinch && homeInClinch && (spec.weapon === 'fist' || spec.weapon === 'knee')) {
      out.push(mk(ctx, {
        kind: 'strike',
        id: spec.id,
        family: 'clinchStrike',
        defence: 'def.neutral',
        moveX: 0,
        moveZ: 0,
        intentTag: `${spec.id}#short`,
        rangeError: 0,
        targetRegion: spec.weapon === 'knee' ? 'body' : spec.targets[0],
        spec,
        short: true,
        base: basePrior('clinchStrike') * SHORT_STRIKE.clinchPriorMult,
        risk: 0.10,
      }));
    }
  }
  return out;
}

/**
 * Short-strike and ground-strike priors [E: Phase 9]. `clinchPriorMult` and
 * `groundPriorMult` scale the short variant against the power one inside the
 * same family (so with the family normalisation of the softmax they set the
 * short share of clinch and ground strikes); `bottomMult` is the bottom
 * fighter's striking against the top's.
 */
export const SHORT_STRIKE = Object.freeze({
  // FIGHT_DATA §3 #5-#7, #23-#24: ~1.8 non-significant attempts a minute
  // against 8.4 significant, living mostly in the clinch and on the mat —
  // about 55 % of clinch strikes and 65 % of ground strikes are short.
  clinchPriorMult: 1.2,
  groundPriorMult: 1.8,
  bottomMult: 0.35,
});

/**
 * Ground-and-pound (03 §5.1): the strikes the node's GnP row lists for the
 * top slot, and the §5.1 bottom row for a fighter on his back in a guard.
 * Phase 9: the stand-up enumeration returned nothing on the ground, so the
 * sim had no ground-and-pound at all — the "groundStrike" family was the
 * posture/settle edges.
 */
export function groundStrikeCandidates(ctx: EnumerationContext): Candidate[] {
  if (!ctx.hasTarget || ctx.posture !== 'ground' || !strikingAllowed(ctx.ruleset)) return [];
  const node = ctx.node;
  if (node === null || ctx.slot === null || !hasPositionNode(node)) return [];
  if (!ctx.ruleset.ground.strikesAllowed) return [];
  const role = roleFor(node, ctx.slot);
  const fam = positionNode(node).family;
  let ids: readonly string[];
  let bottom = false;
  if (role === 'top' || role === 'attacker') {
    const prof = gnpProfile(node);
    if (!prof) return [];
    ids = prof.strikes;
  } else if (role === 'bottom' && (fam === 'closedGuard' || fam === 'openGuard' || fam === 'half')) {
    ids = BOTTOM_GNP.strikes.filter((x) => x !== 'tech.upkick');
    bottom = true;
  } else {
    return [];
  }
  const flags = strikingFlagsFor(ctx.ruleset);
  const behaviour = tierBehaviourFor(ctx.self);
  if (!repertoireAllows(behaviour, 'groundStrike')) return [];
  const out: Candidate[] = [];
  const side = bottom ? SHORT_STRIKE.bottomMult : 1;
  for (const id of ids) {
    if (!hasTechnique(id as TechniqueId)) continue;
    const spec = technique(id as TechniqueId);
    if (!techniqueLegal(spec, flags)) continue;
    for (const short of [false, true]) {
      out.push(mk(ctx, {
        kind: 'strike',
        id: spec.id,
        family: 'groundStrike',
        defence: 'def.neutral',
        moveX: 0,
        moveZ: 0,
        intentTag: short ? `${spec.id}#short` : spec.id,
        rangeError: 0,
        targetRegion: spec.targets[0],
        spec,
        ...(short ? { short: true } : {}),
        base: basePrior('groundStrike') * side * (short ? SHORT_STRIKE.groundPriorMult : 1),
        ...(short ? { risk: 0.10 } : {}),
      }));
    }
  }
  return out;
}

/** §2.4.5: feints unlock at T2 ("1 kind"), layered feints at T4. */
export function feintCandidates(ctx: EnumerationContext): Candidate[] {
  if (!ctx.hasTarget || ctx.posture !== 'standing' || !strikingAllowed(ctx.ruleset)) return [];
  const tier = ctx.self.strikingTier;
  if (tier < 2) return [];
  const out: Candidate[] = [];
  const specs: readonly FeintSpec[] = feintsForTier(tier);
  for (const f of specs) {
    out.push(mk(ctx, {
      kind: 'strike',
      id: f.id,
      family: 'feint',
      defence: 'def.neutral',
      moveX: 0,
      moveZ: 0,
      intentTag: f.id,
      rangeError: ctx.distanceM > 2.2 ? 0.9 : 0,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Movement (§2.1.5)
// ---------------------------------------------------------------------------

const MOVE_FAMILY: Readonly<Record<string, ActionFamily>> = Object.freeze({
  'move.step_drag': 'advance',
  'move.pivot': 'pivot',
  'move.l_step': 'lateral',
  'move.shuffle': 'circle',
  'move.level_change': 'levelChange',
  'move.shift': 'inOut',
  'move.switch_stance': 'switchStance',
  'move.retreat_straight': 'retreat',
});

/**
 * §2.1.5 movement primitives, plus the two derived directions the plan talks
 * about (`advance` toward, `circleAway` off the fence). Movement is never
 * gated by the ruleset — a fighter may always step.
 */
export function movementCandidates(ctx: EnumerationContext, toTargetX: number, toTargetZ: number): Candidate[] {
  if (ctx.posture !== 'standing') return [];
  const tier = ctx.self.mmaTier;
  const out: Candidate[] = [];
  const len = Math.hypot(toTargetX, toTargetZ) || 1;
  const ux = toTargetX / len;
  const uz = toTargetZ / len;
  // Perpendicular, for circling.
  const px = -uz;
  const pz = ux;
  const speed = ctx.self.footSpeedMs;

  for (const m of MOVEMENTS) {
    if (m.minTier > tier) continue;
    const family = MOVE_FAMILY[m.id];
    if (!family) continue;
    if (family === 'switchStance') {
      // ST-8 gates switching to T3+, and only for a switch-stance fighter.
      if (tier < 3 || ctx.self.body.stance !== 'switch') continue;
    }
    let mx = 0;
    let mz = 0;
    if (family === 'advance' || family === 'inOut') {
      mx = ux * speed;
      mz = uz * speed;
    } else if (family === 'retreat') {
      mx = -ux * speed;
      mz = -uz * speed;
    } else if (family === 'circle' || family === 'lateral') {
      mx = px * speed;
      mz = pz * speed;
    }
    out.push(mk(ctx, {
      kind: 'move',
      id: m.id,
      family,
      defence: 'def.neutral',
      moveX: mx,
      moveZ: mz,
      intentTag: m.id,
      rangeError: 0,
    }));
  }

  // `circleAway`: the S-2 / P-4 escape off the fence, distinct from plain
  // circling because the plan re-weights it separately.
  out.push(mk(ctx, {
    kind: 'move',
    id: 'move.shuffle',
    family: 'circleAway',
    defence: 'def.neutral',
    moveX: px * speed,
    moveZ: pz * speed,
    intentTag: 'circle.away',
    rangeError: 0,
  }));
  return out;
}

// ---------------------------------------------------------------------------
// Defensive options (§02 defence layer chooses *which* defence; we choose to
// defend at all)
// ---------------------------------------------------------------------------

const DEFENSIVE_OPTIONS: readonly { id: DefenceId; family: ActionFamily }[] = [
  { id: 'def.block_high', family: 'block' },
  { id: 'def.check', family: 'check' },
  { id: 'def.sprawl_posture', family: 'sprawl' },
];

export function defensiveCandidates(ctx: EnumerationContext): Candidate[] {
  const behaviour = tierBehaviourFor(ctx.self);
  const out: Candidate[] = [];
  for (const d of DEFENSIVE_OPTIONS) {
    if (d.family === 'check' && ctx.posture !== 'standing') continue;
    if (d.family === 'sprawl' && ctx.posture === 'ground') continue;
    // `beh.mt.check_rate` puts the T0 check below 0.10 and `beh.wr.sprawl_late`
    // takes the sprawl away entirely; both are repertoire rows, not weights.
    if (!repertoireAllows(behaviour, d.family)) continue;
    out.push(mk(ctx, {
      kind: 'defend',
      id: d.id,
      family: d.family,
      defence: d.id,
      moveX: 0,
      moveZ: 0,
      intentTag: d.id,
      rangeError: 0,
    }));
  }
  // R-1 unlocks the long guard for the longer fighter; it is a posture, not a
  // `def.*` id, so it rides as its own family.
  if (ctx.posture === 'standing') {
    out.push(mk(ctx, {
      kind: 'defend',
      id: 'def.block_high',
      family: 'longGuard',
      defence: 'def.block_high',
      moveX: 0,
      moveZ: 0,
      intentTag: 'guard.long',
      rangeError: 0,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Grappling (§03)
// ---------------------------------------------------------------------------

const FEET_FAMILIES: ReadonlySet<string> = new Set(['standingFree', 'clinch']);

/**
 * Phase 9: does this edge, started on the feet, take the opponent down (to a
 * mat node or into a leg attack)? Such edges spend the takedown budget
 * whatever §2.3 table they sit in — a snap-down or an arm drag to the back
 * puts a man on the mat as surely as a double leg (`grappling/takedowns.ts`
 * counts them as attempts for the same reason).
 */
function takesDown(e: GrapplingEdge): boolean {
  if (!e.from.some((n) => hasPositionNode(n) && FEET_FAMILIES.has(positionNode(n).family))) return false;
  return e.to.some((d) => d.node !== 'same' && hasPositionNode(d.node)
    && !FEET_FAMILIES.has(positionNode(d.node).family) && positionNode(d.node).family !== 'transient');
}

/** Map a §03 edge onto the family the plan weights. */
export function familyForEdge(e: GrapplingEdge): ActionFamily {
  if (e.id === 'tech.pull_guard') return 'guardPull';
  if (e.kind === 'clinch' && takesDown(e)) return 'trip';
  switch (e.kind) {
    case 'entry': case 'capture':
      if (e.id === 'tech.pull_guard') return 'guardPull';
      // Phase 9: an entry that only ties up (cold entry, entry off strikes,
      // hook into a body lock) is a clinch entry, not a shot.
      if (e.kind === 'entry' && e.to.every((d) => d.node === 'same'
        || (hasPositionNode(d.node) && positionNode(d.node).family === 'clinch'))) {
        return 'clinchEntry';
      }
      return e.id.includes('body_lock') ? 'bodylockTd'
        : e.id.includes('trip') || e.id.includes('sweep_single') ? 'trip'
          : 'shoot';
    case 'throw': return 'trip';
    case 'setup': return 'levelChange';
    case 'clinch': return 'clinchEntry';
    case 'cage': return 'cagePin';
    case 'pass': return 'pass';
    case 'advance': return e.id.includes('back') ? 'backTake' : 'ride';
    case 'sweep': return 'sweep';
    case 'escape': return 'standUp';
    case 'getup': return e.id.includes('wall') ? 'wallWalk' : 'standUp';
    // Phase 9: the posture/settle edges are the top's control choice, not a
    // strike; the ground strikes themselves are `groundStrikeCandidates`.
    // The §2.3 `strike` rows (strike in the tie, sprawl knees, cage-pin
    // strikes) are clinch work.
    case 'gnp': return 'ride';
    case 'strike': return 'clinchStrike';
    case 'defence': return 'sprawl';
    case 'subEntry': return 'submission';
    case 'counter': return 'counterWindow';
    case 'scramble': return 'sweep';
    case 'finish': return 'bodylockTd';
    // Phase 9: a chain inside a shot (single to double, double to high
    // crotch, the re-shot) is one of the ways to finish that shot, so it
    // shares the finishes' family. Filed as 'pass' it got a whole family's
    // share of the choice to itself and was taken as often as all the
    // finishes together — and most chains fail into the sprawl.
    case 'chain': return 'bodylockTd';
    default: return 'clinchEntry';
  }
}

/** Does this fighter meet the edge's stated requirements (§2.3)? */
function edgeAvailable(e: GrapplingEdge, ctx: EnumerationContext): boolean {
  // A free-standing fighter holds no slot, but the §2.3 tables still split the
  // rows by role: `a` initiates, `b` responds. Treating "no engagement" as "no
  // constraint" handed the initiator both halves of the table, so a fighter who
  // was not being shot on could pick `def.sprawl` or `def.read_level_change`
  // out of thin air and join an engagement as its defender. Whoever moves first
  // from a free node is the actor, so the slot is `a`.
  const slot = ctx.slot ?? 'a';
  if (e.actor !== slot) return false;
  if (ON_THE_STRIKE_EDGES.has(e.id) && !ctx.oppStriking) return false;
  const r = e.requirements;
  if (r.cage === 'required' && !ctx.atCage) return false;
  if (r.cage === 'forbidden' && ctx.atCage) return false;
  if (r.minTier !== undefined && ctx.self.grapplingTier < r.minTier) return false;
  if (r.minReactionTime !== undefined && ctx.self.effective.reactionTime < r.minReactionTime) return false;
  if (r.minBalance !== undefined && ctx.balance * 100 < r.minBalance) return false;
  return true;
}

/**
 * Every §03 edge leaving the current node that this fighter may attempt. When
 * the fighter is free-standing the node is the standing node their distance
 * puts them in, so the takedown entries appear at the right range and nowhere
 * else.
 */
export function grapplingCandidates(ctx: EnumerationContext): Candidate[] {
  const node = ctx.node;
  if (node === null) return [];
  if (!ctx.ruleset.takedowns.allowed && ctx.posture === 'standing') return [];
  const behaviour = tierBehaviourFor(ctx.self);
  const out: Candidate[] = [];
  for (const e of edgesFrom(node)) {
    // §2.3 L's `ref.*` rows are the referee's, not a fighter's: the bell and the
    // stand-up are chapter 06's to call. They share the edge catalogue only
    // because they move the pair between nodes, and `edgesFrom` cannot know the
    // difference — so the candidate set is where they have to be dropped, or a
    // fighter "chooses" to restart the round from the middle of it.
    if (e.kind === 'referee') continue;
    // A `setup` row is not something a fighter *does*; it is the head of
    // something. `tech.level_change` goes from `pos.standing_mid` to
    // `pos.standing_mid` and its whole payload is the SETUP state it hands the
    // next shot (§2.3 A), so as a standalone candidate it is a free no-op that
    // the softmax re-picks every tick — dozens of "successful" position changes
    // that change no position, crowding out the shot they were supposed to set
    // up. §2.2.5 already has the right home for them: `macro.feint_level_change`
    // and `macro.cut_feint_entry` run the level change as a step and commit to
    // the entry behind it.
    if (e.kind === 'setup') continue;
    if (!edgeAvailable(e, ctx)) continue;
    const family = familyForEdge(e);
    // §2.7.3: outnumbered, nothing goes to the ground.
    if (ctx.outnumbered && (family === 'shoot' || family === 'bodylockTd' || family === 'guardPull')) {
      continue;
    }
    if (family === 'groundStrike' && !ctx.ruleset.ground.strikesAllowed) continue;
    if (family === 'clinchStrike' && !strikingAllowed(ctx.ruleset)) continue;
    if (!repertoireAllows(behaviour, family)) continue;
    out.push(mk(ctx, {
      kind: 'grapple',
      id: e.id,
      family,
      defence: 'def.neutral',
      moveX: 0,
      moveZ: 0,
      intentTag: e.id,
      rangeError: 0,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Submissions (§04)
// ---------------------------------------------------------------------------

/**
 * §04 §2.4.1 opportunity weights [E: Phase 9]. The catalogue marks each entry
 * `continuous` (re-evaluated every decision: the RNC from back control), gated
 * on a `trigger` event (`evt.hand_posted`, `evt.turn_away`) or neither. The
 * trigger events are not tracked as such, so a triggered entry is offered at
 * a fraction of the prior, standing in for the share of time the opening is
 * actually there.
 */
export const SUB_OPPORTUNITY = Object.freeze({ continuous: 1.0, plain: 0.6, triggered: 0.25 });

/**
 * §04's availability at this node for this fighter's slot (the catalogue's
 * own entry positions and roles, `grappling/subOffers.ts`), filtered by the
 * ruleset legality matrix and the fighter's own selection gates.
 */
export function submissionCandidates(ctx: EnumerationContext): Candidate[] {
  if (!ctx.ruleset.submissions.allowed) return [];
  const node = ctx.node;
  if (node === null || ctx.slot === null) return [];
  if (ctx.outnumbered) return [];
  const here = subOffers(node, ctx.slot);
  if (here.length === 0) return [];
  const bjj = ctx.self.disciplines.bjj;
  const flex = ctx.self.effective.flexibility;
  const out: Candidate[] = [];
  for (const { spec: s, entry } of here) {
    if (!isLegalUnderRuleset(ctx.ruleset, s.id)) continue;
    const gates = s.gates;
    if (gates) {
      if (gates.flexibilityMin !== undefined && flex < gates.flexibilityMin) continue;
      if (gates.chokeSkillMin !== undefined && (bjj.effective.chokes ?? 0) < gates.chokeSkillMin) continue;
      if (gates.legLockSkillMin !== undefined && (bjj.effective.legLocks ?? 0) < gates.legLockSkillMin) continue;
      if (gates.explosivenessMin !== undefined && ctx.self.effective.explosiveness < gates.explosivenessMin) continue;
      if (gates.requiresGloves && ctx.ruleset.gloves.bareKnuckle) continue;
    }
    const bottom = entry.role === 'bottom' || (entry.role === 'either' && ctx.slot === 'b');
    const opportunity = entry.continuous ? SUB_OPPORTUNITY.continuous
      : entry.trigger ? SUB_OPPORTUNITY.triggered : SUB_OPPORTUNITY.plain;
    out.push(mk(ctx, {
      kind: 'submission',
      id: s.id,
      family: bottom ? 'bottomSubmission' : 'submission',
      defence: 'def.neutral',
      moveX: 0,
      moveZ: 0,
      intentTag: s.id,
      rangeError: 0,
      // The catalogue's own finish-share target is the natural per-technique
      // prior: an RNC is chosen more often than a gogoplata because it works.
      base: basePrior(bottom ? 'bottomSubmission' : 'submission') * (0.5 + 4 * s.finishShareTarget) * opportunity,
    }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// The whole set
// ---------------------------------------------------------------------------

/** The fighter who cannot do anything else still does this. */
export function waitCandidate(ctx: EnumerationContext): Candidate {
  return mk(ctx, {
    kind: 'wait',
    id: null,
    family: 'wait',
    defence: 'def.neutral',
    moveX: 0,
    moveZ: 0,
    intentTag: 'wait',
    rangeError: 0,
  });
}

/**
 * The legal candidate set, in a fixed order: strikes, feints, grappling edges,
 * submissions, movement, defence, wait. The order matters — it is the tie-break
 * the softmax inherits, so it must be a pure function of the catalogues.
 */
export function enumerateActions(
  ctx: EnumerationContext,
  toTargetX = 0,
  toTargetZ = 1,
): Candidate[] {
  const out: Candidate[] = [];
  out.push(...strikeCandidates(ctx));
  out.push(...groundStrikeCandidates(ctx));
  out.push(...feintCandidates(ctx));
  out.push(...grapplingCandidates(ctx));
  out.push(...submissionCandidates(ctx));
  out.push(...movementCandidates(ctx, toTargetX, toTargetZ));
  out.push(...defensiveCandidates(ctx));
  out.push(waitCandidate(ctx));
  return out;
}

/** The technique ids a strike candidate may carry, for the tests. */
export function isStrikeId(id: string | null): id is TechniqueId {
  return id !== null && id.startsWith('tech.');
}
