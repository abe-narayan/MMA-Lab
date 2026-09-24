/**
 * EDGE RESOLUTION — the logit sum of chapter 03 §2.1.2 and the RNG contract of
 * chapter 09 §2.7.
 *
 * Two rules govern everything here.
 *
 *  1. **Probability is logit-additive** (00_CONVENTIONS §4):
 *
 *         P = clamp( sigmoid( logit(base) + k*(skillAtt - skillDef)/100
 *                             + sum(phys) + sum(state) ), 0.03, 0.95 )
 *
 *     `base` is the T4-vs-T4, fresh, open-mat value from the edge catalogue.
 *     A few codes (KUZ, the judo grip and chain multipliers, the cage's x1.5
 *     reap and x0.7 forward-throw terms) are multiplicative on P; they are
 *     applied after the sigmoid and the result is re-clamped.
 *
 *  2. **The RNG stream position is a pure function of state.** 09 §2.7 fixes
 *     the order for a grappling edge as `contested`, `outcomeSplit`,
 *     `counterBranch`, `kuzushiKuz` — and "always" means the draw is consumed
 *     even when the branch is inactive. `resolveEdge` therefore takes exactly
 *     `GRAPPLE_EDGE_DRAWS` draws on every path, including the ones it does not
 *     use. A two-stage leg attack resolves capture and finish as two separate
 *     contacts, so it takes four draws per stage.
 *
 * Landing impacts (chapter 05) and foul draws (chapter 06) follow these four in
 * the schedule and are not taken here.
 */
import type { PositionId } from '../core/ids';
import type { SkillTier } from '../fighter/types';
import type { ResolvedParams } from '../params';
import type { RNG } from '../rng';
import type { Kuzushi, KuzushiDir, KuzushiMag } from './engagement';
import { openingBonus } from './gnp';
import {
  JUDO_FAIL_TABLE, SCRAMBLE_OUTCOMES_CAGE, SCRAMBLE_OUTCOMES_OPEN,
  type EdgeDestination, type EdgeId, type GrapplingEdge, type PhysMod,
  type SkillAlias, type StateMod,
} from './graph';

// ---------------------------------------------------------------------------
// Narrow interfaces to the chapters this module does not own
// ---------------------------------------------------------------------------

/**
 * What an edge needs to know about one fighter.
 *
 * TODO(chapter 01): `skills` is keyed by the §2.1.3 alias; chapter 01 resolves
 * each alias to a sub-skill (or a `max()` composite) and hands the effective
 * 0-100 value over. This module never reads a discipline sub-skill directly.
 */
export interface GrappleActor {
  id: number;
  /** §2.1.3 aliases to effective 0-100 values. */
  skills: Readonly<Partial<Record<SkillAlias, number>>>;
  /** Per-discipline tier, used by the chain and judo counter tables. */
  tiers: { wrestling: SkillTier; judo: SkillTier; bjj: SkillTier; mma: SkillTier };
  strength: number;
  explosiveness: number;
  flexibility: number;
  balance: number;
  speed: number;
  massKg: number;
  heightM: number;
  reachM: number;
  /** TODO(chapter 05): 0-1 aerobic fatigue. */
  fatigue: number;
  /** TODO(chapter 05): `state.rocked`. */
  rocked: boolean;
  /** Ground or clinch strikes this fighter landed in the last grap.stkWindowMs. */
  recentStrikesLanded: number;
  /** Ground or clinch strikes this fighter absorbed in the last grap.stkWindowMs. */
  recentStrikesAbsorbed: number;
  /** TODO(chapter 05): 0-1 damage on the driving leg and on the base leg. */
  drivingLegDamage: number;
  baseLegDamage: number;
  /** `wr.chain`, 0-100 (§3.1). */
  chainSkill: number;
  /** Background offsets the clinch and ride rows name explicitly (§2.1.3). */
  background: { greco: boolean; judo: boolean; folkstyle: boolean; funk: boolean };
}

export interface ChainContext {
  discipline: 'wrestling' | 'judo' | 'bjj';
  /** How many chained steps have already fired. */
  step: number;
  /** WRESTLING §9 r9: the defender's hands are on the mat / posture bent. */
  defenderBent: boolean;
}

export interface GrappleWorld {
  params: ResolvedParams;
  /** The node the edge fires from; `'same'` destinations resolve to it. */
  fromNode: PositionId;
  /** Two-stage edges name the stage they are resolving. */
  stage: 'single' | 'capture' | 'finish';
  cage: boolean;
  /** Arena apothem, metres; scales the TELE term (§4). */
  cageRadiusM: number;
  underhookOwner: 'a' | 'b' | null;
  /** Which slot the attacker occupies, for the UHO term. */
  actorSlot: 'a' | 'b';
  /** The ground top slot's posture flag (§5.2). */
  posture: 'chest' | 'postured';
  kuzushi: Kuzushi;
  /** True when the edge fires inside grap.setupWindowMs of a strike or feint. */
  setup: boolean;
  telegraphed: boolean;
  /** Distance at commit, metres; open-mat shots beyond 1.2 m take x0.85. */
  rangeM: number;
  round: number;
  /** TODO(chapter 05): blood on the grips makes them slip (WET). */
  bloodied: boolean;
  chain: ChainContext | null;
  /** Outcome of the last `tech.grip_exchange` (§2.3 D). */
  gripDominance: 'attacker' | 'defender' | 'neutral';
  /** Judo stance matching (§2.3 D preamble). */
  sideMatch: 'same' | 'kenka' | 'cross' | 'none';
  /** Which finish attempt this is, for the open/cage attempt caps. */
  attemptIndex: number;
  /**
   * Phase 9: an extra named logit term the bout adds (the MMA takedown-chain
   * calibration, `grap.tdChainLogit`). Absent in the unit-level resolvers.
   */
  extraLogit?: ModifierTerm;
}

// ---------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------

export interface ModifierTerm {
  code: string;
  logit: number;
}

export interface MultiplierTerm {
  code: string;
  mult: number;
}

export type CounterKind = 'none' | 'judoCounterThrow' | 'guillotine' | 'whizzer';

export interface CounterOutcome {
  kind: CounterKind;
  /** Probability the branch was rolled against. */
  p: number;
  fired: boolean;
}

export interface EdgeOutcome {
  edge: EdgeId;
  stage: 'single' | 'capture' | 'finish';
  success: boolean;
  /** The clamped probability the contested draw was tested against. */
  p: number;
  /** The logit sum before the sigmoid (diagnostics, commentary, the Model tab). */
  logitSum: number;
  terms: readonly ModifierTerm[];
  multipliers: readonly MultiplierTerm[];
  destination: EdgeDestination;
  /** `destination.node` with `'same'` resolved against `world.fromNode`. */
  toNode: PositionId;
  /** Slot `a` passes to the fighter who was in slot `b`. */
  swap: boolean;
  /** Chapter 04 entry this destination opens, if any. */
  submission: string | null;
  counter: CounterOutcome;
  /** Kuzushi the exchange leaves behind, for the next throw. */
  kuzushiAfter: Kuzushi;
  /** Always `GRAPPLE_EDGE_DRAWS`. */
  draws: number;
}

/**
 * 09 §2.7: `contested`, `outcomeSplit`, `counterBranch`, `kuzushiKuz`. Always
 * four, so the stream position after an edge depends only on the fact that an
 * edge resolved, never on which branch it took.
 */
export const GRAPPLE_EDGE_DRAWS = 4;

/** 09 §2.7: `winner`, `outcome`. */
export const SCRAMBLE_DRAWS = 2;

// ---------------------------------------------------------------------------
// Maths
// ---------------------------------------------------------------------------

export function logit(p: number): number {
  const q = Math.min(1 - 1e-9, Math.max(1e-9, p));
  return Math.log(q / (1 - q));
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function clampP(p: number, params: ResolvedParams): number {
  return Math.min(params.get('grap.clampMax'), Math.max(params.get('grap.clampMin'), p));
}

/** Pick a destination from a weight list using one already-taken draw. */
export function pickWeighted(u: number, dests: readonly EdgeDestination[]): EdgeDestination {
  let total = 0;
  for (const dst of dests) total += dst.weight > 0 ? dst.weight : 0;
  if (total <= 0) return dests[0];
  let r = u * total;
  for (const dst of dests) {
    const w = dst.weight > 0 ? dst.weight : 0;
    if (r < w) return dst;
    r -= w;
  }
  return dests[dests.length - 1];
}

/** Highest of the named aliases (§2.1.3: dual aliases resolve by max `[E]`). */
export function skillOf(actor: GrappleActor, aliases: readonly SkillAlias[]): number | null {
  let best: number | null = null;
  for (const a of aliases) {
    const v = actor.skills[a];
    if (v !== undefined && (best === null || v > best)) best = v;
  }
  return best;
}

// ---------------------------------------------------------------------------
// §2.1.4 modifier codes
// ---------------------------------------------------------------------------

function physTerm(
  mod: PhysMod, att: GrappleActor, def: GrappleActor, params: ResolvedParams,
): number {
  const k = (id: string): number => params.get(id);
  const per10 = (a: number, b: number, coeff: number): number => (coeff * (a - b)) / 10;
  switch (mod.code) {
    case 'STR+': return per10(att.strength, def.strength, mod.perUnit ?? k('grap.k.str'));
    case 'STR++': return 2 * per10(att.strength, def.strength, mod.perUnit ?? k('grap.k.str'));
    case 'STR-': return -per10(att.strength, def.strength, mod.perUnit ?? k('grap.k.str'));
    case 'MASS+': case 'MASS++': case 'MASS-': case 'MASS--': {
      const scale = mod.code === 'MASS++' ? 2 : mod.code === 'MASS-' ? -1 : mod.code === 'MASS--' ? -2 : 1;
      const raw = scale * per10(att.massKg, def.massKg, mod.perUnit ?? k('grap.k.mass'));
      const cap = k('grap.k.massCap');
      return Math.max(-cap, Math.min(cap, raw));
    }
    case 'EXP+': return per10(att.explosiveness, def.explosiveness, mod.perUnit ?? k('grap.k.exp'));
    case 'FLX+': return per10(att.flexibility, def.flexibility, mod.perUnit ?? k('grap.k.flx'));
    case 'FLX++': return 2 * per10(att.flexibility, def.flexibility, mod.perUnit ?? k('grap.k.flx'));
    // The *defender's own* flexibility helps them hold the position.
    case 'FLXd-': return -per10(def.flexibility, 50, mod.perUnit ?? k('grap.k.flx'));
    // BALd is the defender's own balance above 50, and k.bal is negative.
    case 'BALd': return per10(def.balance, 50, mod.perUnit ?? k('grap.k.bal'));
    case 'HGT+': return per10(att.heightM * 100, def.heightM * 100, mod.perUnit ?? k('grap.k.hgt'));
    case 'HGT-': return -per10(att.heightM * 100, def.heightM * 100, mod.perUnit ?? k('grap.k.hgt'));
    case 'RCH+': return per10(att.reachM * 100, def.reachM * 100, mod.perUnit ?? k('grap.k.rch'));
    case 'SPD+': return per10(att.speed, def.speed, mod.perUnit ?? k('grap.k.spd'));
    case 'OWNBAL+': return per10(att.balance, 50, mod.perUnit ?? k('grap.k.ownBalance'));
    default: return 0;
  }
}

function stateTerm(
  mod: StateMod, att: GrappleActor, def: GrappleActor, w: GrappleWorld,
): number {
  const p = w.params;
  const k = (id: string): number => p.get(id);
  switch (mod.code) {
    case 'SETUP':
      return w.setup ? (mod.value ?? k('grap.setupBonus')) : 0;
    case 'TELE':
      // A bigger cage makes a telegraphed shot from distance worse still
      // (WRESTLING §8.1: distance shots are 5.7 % less successful at 25 ft).
      return w.telegraphed
        ? (mod.value ?? k('grap.telegraphPenalty')) * cageSizeTeleScale(w.cageRadiusM, p)
        : 0;
    case 'CAGE':
      // Multiplicative cage rows are handled with the other P multipliers.
      return w.cage && !mod.multiplicative ? mod.value ?? k('grap.cageCaptureBonus') : 0;
    case 'UHO': {
      if (!w.cage || w.underhookOwner === null) return 0;
      const uho = mod.value ?? k('grap.uho');
      return w.underhookOwner === w.actorSlot ? uho : -uho;
    }
    case 'STK+':
      return (mod.value ?? k('grap.stkPerStrike'))
        * Math.min(att.recentStrikesLanded, k('grap.stkMax'));
    case 'STK-':
      return -(mod.value ?? k('grap.stkPerStrike'))
        * Math.min(att.recentStrikesAbsorbed, k('grap.stkMax'));
    case 'STK--':
      return -2 * (mod.value ?? k('grap.stkPerStrike'))
        * Math.min(att.recentStrikesAbsorbed, k('grap.stkMax'));
    case 'POST':
      return w.posture === 'postured' ? (mod.value ?? k('grap.postureBonus')) : 0;
    case 'RCK':
      // A rocked *attacker* may not initiate takedown or throw edges at all;
      // availability is chapter 07's gate, this is only the defender's side.
      return def.rocked ? (mod.value ?? k('grap.rockedBonus')) : 0;
    case 'WET':
      return w.round >= k('grap.wetFromRound') || w.bloodied
        ? (mod.value ?? k('grap.wetPenalty')) : 0;
    case 'WET+':
      // Slippery grips help the fighter trying to get out.
      return w.round >= k('grap.wetFromRound') || w.bloodied
        ? -(mod.value ?? k('grap.wetPenalty')) : 0;
    case 'FAT-':
      // Without a value: -1.0 x attacker fatigue. With one: the differential
      // form the pummel rows use, -value x (fatAtt - fatDef).
      return mod.value === undefined
        ? k('grap.k.fat') * att.fatigue
        : -mod.value * (att.fatigue - def.fatigue);
    case 'FAT--':
      return 2 * k('grap.k.fat') * att.fatigue;
    case 'FATd+':
      // Default +1.0 x defender fatigue; `grap.k.fat` is the negative form.
      return (mod.value ?? -k('grap.k.fat')) * def.fatigue;
    case 'FATd++':
      return -2 * k('grap.k.fat') * def.fatigue;
    case 'LEGDMG':
      return k('grap.legDmgDrivePenalty') * (att.drivingLegDamage / 0.25)
        + (def.baseLegDamage >= 0.5 ? k('grap.legDmgDefenderBonus') : 0);
    case 'GRECO':
      return att.background.greco || att.background.judo
        ? (mod.value ?? k('grap.greccoJudoClinchBonus')) : 0;
    case 'FOLKSTYLE':
      return att.background.folkstyle ? (mod.value ?? k('grap.folkstyleRideBonus')) : 0;
    // KUZ and CHAIN are multiplicative / contextual, handled separately.
    case 'KUZ': case 'CHAIN':
      return 0;
    default:
      return 0;
  }
}

/** §4: `cageRadius` scales the TELE term by `(radius_m / 9.1)^-1`. */
export function cageSizeTeleScale(radiusM: number, params: ResolvedParams): number {
  const ref = params.get('grap.cageReferenceRadiusM');
  if (radiusM <= 0 || !Number.isFinite(radiusM)) return 1;
  return ref / radiusM;
}

/**
 * §2.1.4 KUZ: `x(0.5 + 0.25*mag)` when the throw's required direction is within
 * 45 degrees of the vector, `x0.5` unaligned, `x0.3` opposite. Applied to P.
 */
export function kuzushiMultiplier(
  required: KuzushiDir | undefined, vector: Kuzushi, params: ResolvedParams,
): number {
  if (required === undefined) return 1;
  if (vector.mag === 0) return params.get('grap.kuzushiUnalignedMult');
  // Eight-way compass: one step is 45 degrees, so "within 45 degrees" is a
  // difference of at most one step; four steps is the opposite direction.
  const diff = Math.min((vector.dir - required + 8) % 8, (required - vector.dir + 8) % 8);
  const tolSteps = Math.round(params.get('grap.kuzushiAlignToleranceDeg') / 45);
  if (diff <= tolSteps) {
    return params.get('grap.kuzushiAlignedBase')
      + params.get('grap.kuzushiAlignedPerMag') * vector.mag;
  }
  if (diff >= 4) return params.get('grap.kuzushiOppositeMult');
  return params.get('grap.kuzushiUnalignedMult');
}

// ---------------------------------------------------------------------------
// §3 Chain grappling
// ---------------------------------------------------------------------------

/**
 * §3.1: `P_chain(wrestling) = 0.15 + 0.008 * wr.chain`, halved above fatigue
 * 0.7. Gives T0 0.15 · T1 0.31 · T2 0.47 · T3 0.63 · T4 0.79 · T5 0.91.
 */
export function chainPropensity(actor: GrappleActor, params: ResolvedParams): number {
  const base = params.get('grap.chainBase') + params.get('grap.chainPerSkill') * actor.chainSkill;
  const halved = actor.fatigue > params.get('grap.chainFatigueHalfAbove') ? base / 2 : base;
  return Math.min(1, Math.max(0, halved));
}

/** §3.1: judo renzoku is unavailable below T2 and multiplies P above it. */
export function judoChainMultiplier(tier: SkillTier, params: ResolvedParams): number {
  if (tier <= 1) return 0;
  if (tier <= 3) return 1.1;
  return params.get('grap.judoChainMult');
}

/** §3.1: BJJ pass-to-pass bonus within grap.bjjChainWindowMs. */
export function bjjChainBonus(tier: SkillTier, params: ResolvedParams): number {
  if (tier >= 4) return params.get('grap.bjjChainBonusT4');
  if (tier === 3) return params.get('grap.bjjChainBonusT3');
  return 0;
}

/**
 * §3.2 modifiers on a chained edge, split into the additive part (wrestling and
 * BJJ) and the multiplicative part (judo).
 */
function chainTerms(
  att: GrappleActor, w: GrappleWorld,
): { logit: number; mult: number; label: string } {
  const c = w.chain;
  if (!c) return { logit: 0, mult: 1, label: '' };
  const p = w.params;
  switch (c.discipline) {
    case 'wrestling': {
      // Elite retention: at T4+ each chain step keeps its full base.
      const penalty = c.step > 0 && att.tiers.wrestling < 4
        ? p.get('grap.chainSecondShotPenalty') : 0;
      const bent = c.defenderBent ? p.get('grap.chainBentBonus') : 0;
      return { logit: penalty + bent, mult: 1, label: 'CHAIN.wr' };
    }
    case 'judo':
      return { logit: 0, mult: judoChainMultiplier(att.tiers.judo, p), label: 'CHAIN.jd' };
    case 'bjj':
      return { logit: bjjChainBonus(att.tiers.bjj, p), mult: 1, label: 'CHAIN.bjj' };
  }
}

// ---------------------------------------------------------------------------
// The logit sum
// ---------------------------------------------------------------------------

export interface EdgeProbability {
  p: number;
  logitSum: number;
  terms: ModifierTerm[];
  multipliers: MultiplierTerm[];
}

/** Base probability for the stage being resolved (§2.1.2 two-stage edges). */
export function baseFor(edge: GrapplingEdge, stage: 'single' | 'capture' | 'finish'): number {
  if (typeof edge.baseP === 'number') return edge.baseP;
  return stage === 'finish' ? edge.baseP.finish : edge.baseP.capture;
}

/**
 * The full §2.1.2 probability, with every term named so the Model tab and the
 * commentary system can explain a result. Pure: no RNG, no mutation.
 */
export function edgeProbability(
  edge: GrapplingEdge, att: GrappleActor, def: GrappleActor, w: GrappleWorld,
): EdgeProbability {
  const p = w.params;
  const terms: ModifierTerm[] = [];
  const multipliers: MultiplierTerm[] = [];

  const base = baseFor(edge, w.stage);
  let sum = logit(base);
  terms.push({ code: 'base', logit: sum });

  // Skill gap. Only the *gap* enters, so an equal-tier pair reproduces the base
  // whatever their absolute level (§2.1.2).
  if (edge.kSkill > 0) {
    const a = skillOf(att, edge.skills.attacker);
    const dS = skillOf(def, edge.skills.defender);
    if (a !== null && dS !== null) {
      // Realism pass: `grap.kSkillScale` (see the registry note).
      const t = (p.get('grap.kSkillScale') * edge.kSkill * (a - dS)) / 100;
      sum += t;
      terms.push({ code: 'skill', logit: t });
    }
  }

  for (const mod of edge.physicalMods) {
    const t = physTerm(mod, att, def, p);
    if (t !== 0) terms.push({ code: mod.code, logit: t });
    sum += t;
  }

  for (const mod of edge.stateMods) {
    const t = stateTerm(mod, att, def, w);
    if (t !== 0) terms.push({ code: mod.code, logit: t });
    sum += t;
    if (mod.code === 'CAGE' && mod.multiplicative && w.cage) {
      multipliers.push({ code: 'CAGE*', mult: mod.value ?? 1 });
    }
    // §5.2: the POST bonus is the *generic* +0.40; the §5.1 table adds a
    // per-node opening on top of it for the specific edges it names, which is
    // what turns the hip bump from 0.25 into 0.48 while the top posts a hand.
    if (mod.code === 'POST') {
      const opening = openingBonus(w.fromNode, edge.id, w.posture, p);
      if (opening !== 0) {
        sum += opening;
        terms.push({ code: 'POST.opening', logit: opening });
      }
    }
  }

  // Judo stance matching (§2.3 D preamble), throws only.
  if (edge.kind === 'throw' || edge.kind === 'counter') {
    const side = w.sideMatch === 'same' ? p.get('grap.judoSameSide')
      : w.sideMatch === 'kenka' ? p.get('grap.judoKenkaSameSide')
        : w.sideMatch === 'cross' ? p.get('grap.judoCrossSide') : 0;
    if (side !== 0) {
      sum += side;
      terms.push({ code: `side.${w.sideMatch}`, logit: side });
    }
  }

  const chain = chainTerms(att, w);
  if (chain.logit !== 0) {
    sum += chain.logit;
    terms.push({ code: chain.label, logit: chain.logit });
  }
  if (chain.mult !== 1) multipliers.push({ code: chain.label, mult: chain.mult });

  if (w.extraLogit && w.extraLogit.logit !== 0) {
    sum += w.extraLogit.logit;
    terms.push(w.extraLogit);
  }

  let prob = sigmoid(sum);

  // Multiplicative codes, applied to P and then re-clamped (§2.1.4 closing line).
  const hasKuz = edge.stateMods.some((m) => m.code === 'KUZ');
  if (hasKuz) {
    const m = kuzushiMultiplier(edge.requirements.kuzushiDir, w.kuzushi, p);
    multipliers.push({ code: 'KUZ', mult: m });
  }
  // Grip dominance from tech.grip_exchange (§2.3 D).
  if ((edge.kind === 'throw' || edge.kind === 'counter') && w.gripDominance !== 'neutral') {
    multipliers.push({
      code: `grip.${w.gripDominance}`,
      mult: w.gripDominance === 'attacker'
        ? p.get('grap.judoGripDominantMult') : p.get('grap.judoGripUkeDominantMult'),
    });
  }
  // Open-mat shots from beyond 1.2 m (§2.3 B, WRESTLING §9 r7).
  if (edge.kind === 'capture' && !w.cage && w.rangeM > 1.2) {
    multipliers.push({ code: 'farShot', mult: p.get('grap.openMatFarShotMult') });
  }

  for (const m of multipliers) prob *= m.mult;

  // tech.grip_exchange carries its own, tighter clamp (§2.3 D).
  const clamped = edge.id === 'tech.grip_exchange'
    ? Math.min(p.get('grap.judoGripClampMax'), Math.max(p.get('grap.judoGripClampMin'), prob))
    : clampP(prob, p);

  return { p: clamped, logitSum: sum, terms, multipliers };
}

// ---------------------------------------------------------------------------
// Counter branches
// ---------------------------------------------------------------------------

/**
 * §2.3 D failure table: the counter-throw is launched with probability
 * `0.10 x commitment x defender tier factor`, x0.7 against the fence.
 */
export function judoCounterLaunchP(
  edge: GrapplingEdge, def: GrappleActor, w: GrappleWorld,
): number {
  const p = w.params;
  const tier = def.tiers.judo;
  const tierFactor = tier <= 1 ? p.get('grap.judoCounterTierLow')
    : tier <= 3 ? p.get('grap.judoCounterTierMid') : p.get('grap.judoCounterTierHigh');
  const commitment = edge.judoCommitment ?? p.get('grap.judoCommitMid');
  const cage = w.cage ? p.get('grap.cageCounterLaunchMult') : 1;
  return Math.min(1, Math.max(0, p.get('grap.judoFailCounter') * commitment * tierFactor * cage));
}

/**
 * §2.3 B preamble: every leg attack pays a guillotine tax. 0.12 base, x2.5 if
 * the attacker is T0-T1 (head down and outside), x0.5 if T4+, +0.10 if the
 * defender's BJJ is 70 or better.
 */
export function guillotineTaxP(
  att: GrappleActor, def: GrappleActor, params: ResolvedParams,
): number {
  let q = params.get('grap.guillotineTaxBase');
  if (att.tiers.wrestling <= 1) q *= params.get('grap.guillotineTaxNoviceMult');
  else if (att.tiers.wrestling >= 4) q *= params.get('grap.guillotineTaxEliteMult');
  const bjj = Math.max(def.skills['bjj.retention'] ?? 0, def.skills['bjj.top_control'] ?? 0);
  if (bjj >= 70) q += params.get('grap.guillotineTaxBjjBonus');
  return Math.min(1, Math.max(0, q));
}

/** Which counter branch, if any, this edge rolls on the `counterBranch` draw. */
function counterKindOf(edge: GrapplingEdge): CounterKind {
  if (edge.judoFailure) return 'judoCounterThrow';
  if (edge.guillotineTax) return 'guillotine';
  if (edge.id === 'tech.single_run_pipe' || edge.id === 'tech.single_dump') return 'whizzer';
  return 'none';
}

// ---------------------------------------------------------------------------
// resolveEdge
// ---------------------------------------------------------------------------

/**
 * Resolve one contested grappling edge.
 *
 * Draw order is 09 §2.7's, and all four draws are always taken:
 *
 *   1. `contested`    — success or failure against the clamped P
 *   2. `outcomeSplit` — the destination, from the success or failure weights
 *   3. `counterBranch`— the judo failure table's counter launch, the guillotine
 *                       tax on a leg attack, or the whizzer on a single-leg
 *                       finish; drawn even when the edge has no counter
 *   4. `kuzushiKuz`   — the kuzushi the exchange leaves behind for the next
 *                       throw; drawn even for edges that carry none
 */
export function resolveEdge(
  edge: GrapplingEdge, attacker: GrappleActor, defender: GrappleActor,
  world: GrappleWorld, rng: RNG,
): EdgeOutcome {
  const prob = edgeProbability(edge, attacker, defender, world);

  const uContested = rng.next();
  const uSplit = rng.next();
  const uCounter = rng.next();
  const uKuzushi = rng.next();

  const success = uContested < prob.p;

  // A judo throw that fails rolls the §2.3 D failure table instead of the
  // edge's own failure weights.
  const failList = edge.judoFailure ? JUDO_FAIL_TABLE : edge.toOnFailure;
  const list = success ? edge.to : failList;
  const destination = pickWeighted(uSplit, list.length > 0 ? list : [{ node: 'same', weight: 1 }]);

  const counterKind = counterKindOf(edge);
  let counterP = 0;
  if (counterKind === 'judoCounterThrow') counterP = judoCounterLaunchP(edge, defender, world);
  else if (counterKind === 'guillotine') counterP = guillotineTaxP(attacker, defender, world.params);
  else if (counterKind === 'whizzer') {
    // WRESTLING §9 r11: the defender applies the whizzer at 0.60 when
    // `wr.sprawl` is 40 or better.
    counterP = (defender.skills['wr.sprawl'] ?? 0) >= 40 ? 0.60 : 0;
  }
  // The judo counter can only fire on the failure table's counter branch; the
  // guillotine tax is rolled on every capture attempt, win or lose.
  const counterEligible = counterKind === 'guillotine'
    || (counterKind !== 'none' && !success);
  const counterFired = counterEligible && uCounter < counterP;

  // The exchange leaves kuzushi behind: a committed throw that fails still
  // moved the opponent, a successful one resets the vector.
  const kuzushiAfter = nextKuzushi(edge, world, success, uKuzushi);

  return {
    edge: edge.id,
    stage: world.stage,
    success,
    p: prob.p,
    logitSum: prob.logitSum,
    terms: prob.terms,
    multipliers: prob.multipliers,
    destination,
    toNode: destination.node === 'same' ? world.fromNode : destination.node,
    swap: destination.swap === true,
    submission: destination.submission ?? null,
    counter: { kind: counterKind, p: counterP, fired: counterFired },
    kuzushiAfter,
    draws: GRAPPLE_EDGE_DRAWS,
  };
}

/**
 * Kuzushi carried out of an exchange. A landed throw clears the vector; a
 * failed committed throw leaves it in the direction it pulled, at a magnitude
 * the fourth draw decides (JUDO §8 r6, r10 — this is what makes renzoku work).
 */
function nextKuzushi(
  edge: GrapplingEdge, w: GrappleWorld, success: boolean, u: number,
): Kuzushi {
  if (success) return { dir: w.kuzushi.dir, mag: 0 };
  const required = edge.requirements.kuzushiDir;
  if (required === undefined) return w.kuzushi;
  const max = w.params.get('grap.kuzushiMagMax');
  // A failed attack leaves 1 to `max` units of off-balance in its own
  // direction; the harder the commitment, the more it leaves.
  const commitment = edge.judoCommitment ?? 1;
  const mag = Math.min(max, 1 + Math.floor(u * Math.min(max, 1 + commitment)));
  return { dir: required as KuzushiDir, mag: mag as KuzushiMag };
}

// ---------------------------------------------------------------------------
// Two-stage leg attacks (§2.1.2, §2.3 B)
// ---------------------------------------------------------------------------

export interface TwoStageOutcome {
  capture: EdgeOutcome;
  finish: EdgeOutcome | null;
  /** True only when both stages landed. */
  success: boolean;
  draws: number;
}

/**
 * Roll a leg attack's capture, then its finish, as two separate contacts. The
 * finish stage is only rolled when the capture landed, which is why the draw
 * count differs between branches — the schedule treats them as two contacts,
 * not as one edge with a conditional draw.
 */
export function resolveTwoStage(
  captureEdge: GrapplingEdge, finishEdge: GrapplingEdge,
  attacker: GrappleActor, defender: GrappleActor, world: GrappleWorld, rng: RNG,
): TwoStageOutcome {
  const capture = resolveEdge(
    captureEdge, attacker, defender, { ...world, stage: 'capture' }, rng,
  );
  if (!capture.success) {
    return { capture, finish: null, success: false, draws: capture.draws };
  }
  const finish = resolveEdge(
    finishEdge, attacker, defender,
    { ...world, stage: 'finish', fromNode: capture.toNode }, rng,
  );
  return {
    capture, finish, success: finish.success,
    draws: capture.draws + finish.draws,
  };
}

// ---------------------------------------------------------------------------
// §2.3 L Scramble resolution
// ---------------------------------------------------------------------------

export interface ScrambleOutcomeResult {
  winner: 'a' | 'b';
  scoreA: number;
  scoreB: number;
  pA: number;
  node: PositionId;
  draws: number;
}

/**
 * §2.3 L score:
 *
 *   S = 0.5*wr.scramble + 0.2*bjj.escape + 0.15*speed + 0.15*flexibility
 *       - 30*fatigue + funk(+10)
 *
 * and `P(A wins) = 1 / (1 + 10^(-(S_A - S_B)/40))`, i.e. `sigmoid(0.0576 * dS)`
 * `[D: ln 10 / 40]`.
 */
export function scrambleScore(actor: GrappleActor, params: ResolvedParams): number {
  return params.get('grap.scrambleWeightScramble') * (actor.skills['wr.scramble'] ?? 0)
    + params.get('grap.scrambleWeightEscape') * (actor.skills['bjj.escape'] ?? 0)
    + params.get('grap.scrambleWeightSpeed') * actor.speed
    + params.get('grap.scrambleWeightFlex') * actor.flexibility
    + params.get('grap.scrambleFatiguePenalty') * actor.fatigue
    + (actor.background.funk ? params.get('grap.scrambleFunkBonus') : 0);
}

/**
 * Resolve a scramble. Two draws (09 §2.7): `winner`, then `outcome`. The §I
 * scramble techniques (sit-out, switch, granby, hip heist, funk) only *label*
 * the animation; they do not re-roll.
 */
export function resolveScramble(
  a: GrappleActor, b: GrappleActor, world: GrappleWorld, rng: RNG,
): ScrambleOutcomeResult {
  const p = world.params;
  const scoreA = scrambleScore(a, p);
  const scoreB = scrambleScore(b, p);
  const pA = clampP(sigmoid(p.get('grap.scrambleLogitPerPt') * (scoreA - scoreB)), p);

  const uWinner = rng.next();
  const uOutcome = rng.next();

  const winner: 'a' | 'b' = uWinner < pA ? 'a' : 'b';
  const table = world.cage ? SCRAMBLE_OUTCOMES_CAGE : SCRAMBLE_OUTCOMES_OPEN;
  const node = pickWeighted(
    uOutcome, table.map((o) => ({ node: o.node, weight: o.weight })),
  ).node as PositionId;

  return { winner, scoreA, scoreB, pA, node, draws: SCRAMBLE_DRAWS };
}

// ---------------------------------------------------------------------------
// §2.3 K Post-takedown stabilisation
// ---------------------------------------------------------------------------

export type StabiliseResult = 'stabilises' | 'scramble' | 'standsUp';

/**
 * Roll the stabilisation table `grap.stabiliseRollDelayMs` after a landed
 * takedown. One draw. Each tier of top advantage moves `grap.stabiliseTierShift`
 * of mass out of the complement and into "stabilises" (§2.3 K closing note).
 */
export function resolveStabilisation(
  row: { stabilises: number; scramble: number; standsUp: number },
  tierAdvantage: number, params: ResolvedParams, rng: RNG,
): StabiliseResult {
  const shift = params.get('grap.stabiliseTierShift') * tierAdvantage;
  const stab = Math.min(0.98, Math.max(0.02, row.stabilises + shift));
  const rest = 1 - stab;
  const restSource = row.scramble + row.standsUp;
  const scramble = restSource > 0 ? (rest * row.scramble) / restSource : rest / 2;
  const u = rng.next();
  if (u < stab) return 'stabilises';
  if (u < stab + scramble) return 'scramble';
  return 'standsUp';
}
