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
  TECHNIQUES, techniqueLegal, type StrikingRulesetFlags, type TechniqueSpec,
  type GloveType as StrikeGloveType,
} from '../striking/catalogue';
import { bandFor, rangeFit, reachProfile, MOVEMENTS, type ReachProfile } from '../striking/range';
import { feintsForTier, type FeintSpec } from '../striking/combos';
import { edgesFrom, type GrapplingEdge } from '../grappling/graph';
import { SUBMISSION_CATALOGUE, type SubmissionSpec } from '../submissions/catalogue';
import { isLegalUnderRuleset } from '../submissions/legality';
import type { ActionFamily } from './contracts';
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
  jab: 1.50, cross: 1.00, hook: 0.70, leadHook: 0.70, uppercut: 0.45,
  overhand: 0.40, bodyHook: 0.50, spinning: 0.12,
  teep: 0.60, lowKick: 0.65, leadLowKick: 0.55, bodyKick: 0.42,
  headKick: 0.28, rearKick: 0.40, knee: 0.45, elbow: 0.35,
  feint: 0.55, slipEntry: 0.30, parryCross: 0.35, levelChange: 0.40,
  baitCross: 0.25, inOut: 0.45,
  shoot: 0.50, nakedShot: 0.20, shootOffStrikes: 0.55, bodylockTd: 0.40,
  trip: 0.35, sprawl: 0.60, cagePin: 0.40,
  clinchEntry: 0.45, clinchStrike: 0.55, breakClinch: 0.50, wallWalk: 0.70,
  groundStrike: 0.80, pass: 0.60, ride: 0.45, sweep: 0.55,
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
}

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
export function strikeCandidates(ctx: EnumerationContext): Candidate[] {
  if (!ctx.hasTarget) return [];
  if (ctx.posture === 'ground' || ctx.posture === 'down' || ctx.posture === 'out') return [];
  const flags = strikingFlagsFor(ctx.ruleset);
  const profile = profileOf(ctx.self);
  const tier = ctx.self.strikingTier;
  const inClinch = ctx.posture === 'clinch';
  const band = bandFor(ctx.distanceM, profile);
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
    out.push(mk(ctx, {
      kind: 'strike',
      id: spec.id,
      family: inClinch && homeInClinch ? 'clinchStrike' : family,
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
  }
  return out;
}

/** §2.4.5: feints unlock at T2 ("1 kind"), layered feints at T4. */
export function feintCandidates(ctx: EnumerationContext): Candidate[] {
  if (!ctx.hasTarget || ctx.posture !== 'standing') return [];
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
  const out: Candidate[] = [];
  for (const d of DEFENSIVE_OPTIONS) {
    if (d.family === 'check' && ctx.posture !== 'standing') continue;
    if (d.family === 'sprawl' && ctx.posture === 'ground') continue;
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

/** Map a §03 edge onto the family the plan weights. */
export function familyForEdge(e: GrapplingEdge): ActionFamily {
  switch (e.kind) {
    case 'entry': case 'capture':
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
    case 'strike': case 'gnp': return 'groundStrike';
    case 'defence': return 'sprawl';
    case 'subEntry': return 'submission';
    case 'counter': return 'counterWindow';
    case 'scramble': return 'sweep';
    case 'finish': return 'bodylockTd';
    case 'chain': return 'pass';
    default: return 'clinchEntry';
  }
}

/** Does this fighter meet the edge's stated requirements (§2.3)? */
function edgeAvailable(e: GrapplingEdge, ctx: EnumerationContext): boolean {
  if (ctx.slot !== null && e.actor !== ctx.slot) return false;
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
  const out: Candidate[] = [];
  for (const e of edgesFrom(node)) {
    if (!edgeAvailable(e, ctx)) continue;
    const family = familyForEdge(e);
    // §2.7.3: outnumbered, nothing goes to the ground.
    if (ctx.outnumbered && (family === 'shoot' || family === 'bodylockTd' || family === 'guardPull')) {
      continue;
    }
    if (family === 'groundStrike' && !ctx.ruleset.ground.strikesAllowed) continue;
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

const SUBS_BY_POSITION = new Map<string, SubmissionSpec[]>();
for (const s of SUBMISSION_CATALOGUE) {
  for (const entry of s.entryPositions) {
    const list = SUBS_BY_POSITION.get(entry.pos);
    if (list) list.push(s);
    else SUBS_BY_POSITION.set(entry.pos, [s]);
  }
}

/**
 * §04's availability at this node, filtered by the ruleset legality matrix and
 * the fighter's own selection gates. `pos.*` ids are shared with §03, so the
 * node is the key.
 */
export function submissionCandidates(ctx: EnumerationContext): Candidate[] {
  if (!ctx.ruleset.submissions.allowed) return [];
  const node = ctx.node;
  if (node === null) return [];
  if (ctx.outnumbered) return [];
  const here = SUBS_BY_POSITION.get(node);
  if (!here) return [];
  const bjj = ctx.self.disciplines.bjj;
  const flex = ctx.self.effective.flexibility;
  const out: Candidate[] = [];
  for (const s of here) {
    if (!isLegalUnderRuleset(ctx.ruleset, s.id)) continue;
    const gates = s.gates;
    if (gates) {
      if (gates.flexibilityMin !== undefined && flex < gates.flexibilityMin) continue;
      if (gates.chokeSkillMin !== undefined && (bjj.effective.chokes ?? 0) < gates.chokeSkillMin) continue;
      if (gates.legLockSkillMin !== undefined && (bjj.effective.legLocks ?? 0) < gates.legLockSkillMin) continue;
      if (gates.explosivenessMin !== undefined && ctx.self.effective.explosiveness < gates.explosivenessMin) continue;
      if (gates.requiresGloves && ctx.ruleset.gloves.bareKnuckle) continue;
    }
    const bottom = s.role === 'bottom';
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
      base: basePrior(bottom ? 'bottomSubmission' : 'submission') * (0.5 + 4 * s.finishShareTarget),
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
