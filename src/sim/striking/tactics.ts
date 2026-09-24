/**
 * TACTICAL STRIKING LAYER — the chapter 02 §2.1, §2.3, §2.5 and §2.8 terms at
 * contact time (Realism pass, engine 6.0).
 *
 * Until this pass chapter 02's tactical tables were designed, sourced, unit
 * tested — and read by nothing at contact time. Contact resolution saw a skill
 * gap (`k x (skill_A - skill_B)/100`), the guard, the read and the placement;
 * it never saw *where* the strike was thrown from (range fit), *who had the
 * reach* (§2.8), *what came before it* (combination flow, §2.3.1), *whether the
 * target had just bitten a feint* (§2.3.4) or *whether it was thrown into the
 * target's own recovery* (the counter windows of §2.5.1). Those are exactly
 * the channels through which a better fighter beats a worse one without being
 * faster or stronger — so their absence is a large part of why skill barely
 * predicted winners (REALISM_PASS §1).
 *
 * Everything here is draw-free. The only per-fighter memory is
 * `TacticalState`, written at commit and at contact and read at contact.
 */
import type { DefenceId, TechniqueId } from '../core/ids';
import type { FighterRuntime } from '../fighter';
import { hasTechnique, technique, type RangeBand, type TechniqueSpec } from './catalogue';
import { strikeClasses } from './defence';
import {
  bestCounterFor, counterWindow, genericCounterBonus, realisedCounterBonus,
  type StrikeOutcomeForWindow,
} from './counters';
import { CHAIN, FEINT, chainStep, feintBonus } from './combos';
import {
  rangeFitIn, reachAccuracyLogit, stanceMatchupLogit, stanceRuleFor, isOpenStance,
  type BandLimits, type ReachProfile, type WeightClassScale,
} from './range';

// ---------------------------------------------------------------------------
// Per-fighter tactical memory
// ---------------------------------------------------------------------------

export interface TacticalState {
  /** §2.5.1: the counter window this fighter's own last strike opened on him. */
  exposedFromMs: number;
  exposedUntilMs: number;
  exposedDefenceLogit: number;
  exposedReadLogit: number;
  exposedTech: TechniqueId | null;
  /** The reactive defence this fighter last made work, and when (best-counter lookup). */
  lastDefence: DefenceId | null;
  lastDefenceMs: number;
  /** §2.3.4: this fighter bit a feint from `bitBy` and is reacting to it until `bitUntilMs`. */
  bitBy: number;
  bitUntilMs: number;
  bitBonus: number;
  bitFeint: string | null;
  /** §2.3.1: this fighter's previous strike, for the combination-flow bonus. */
  prevTech: TechniqueId | null;
  prevLaunchMs: number;
  prevTarget: number;
  prevOutcome: StrikeOutcomeForWindow | null;
  prevRegion: string | null;
  /** §2.3.4 habituation: the last feints this fighter threw, newest last. */
  feintIds: string[];
  feintMs: number[];
  feintsSinceStrike: number;
  /** A feint in progress keeps the feinter busy (startup + recovery) without a contact. */
  busyUntilMs: number;
}

export function newTacticalState(): TacticalState {
  return {
    exposedFromMs: -Infinity, exposedUntilMs: -Infinity, exposedDefenceLogit: 0, exposedReadLogit: 0,
    exposedTech: null, lastDefence: null, lastDefenceMs: -Infinity,
    bitBy: -1, bitUntilMs: -Infinity, bitBonus: 0, bitFeint: null,
    prevTech: null, prevLaunchMs: -Infinity, prevTarget: -1, prevOutcome: null, prevRegion: null,
    feintIds: [], feintMs: [], feintsSinceStrike: 0, busyUntilMs: -Infinity,
  };
}

// ---------------------------------------------------------------------------
// Craft: the striking sub-skills that realise these bonuses
// ---------------------------------------------------------------------------

/**
 * The best available value of each tactical sub-skill across the striking
 * arts. The arts name the same craft differently (boxing `counters`, karate
 * `counters` and `timing`, taekwondo `counters`); a fighter is as good at
 * countering as the best art he learned it in. Memoised per runtime.
 */
export interface StrikingCraft {
  counters: number;
  feints: number;
  combinations: number;
  footwork: number;
  distance: number;
  headMovement: number;
}

const CRAFT = new WeakMap<FighterRuntime, StrikingCraft>();

export function strikingCraft(rt: FighterRuntime): StrikingCraft {
  const hit = CRAFT.get(rt);
  if (hit) return hit;
  const S = (d: keyof FighterRuntime['disciplines'], k: string): number => rt.disciplines[d]?.effective[k] ?? 0;
  const c: StrikingCraft = {
    counters: Math.max(S('boxing', 'counters'), S('karate', 'counters'), S('taekwondo', 'counters'),
      0.9 * S('karate', 'timing'), 0.8 * S('kickboxing', 'defence')),
    feints: Math.max(S('boxing', 'feints'), 0.8 * S('karate', 'timing'), 0.8 * S('kickboxing', 'combinations'),
      0.7 * S('muayThai', 'hands')),
    combinations: Math.max(S('boxing', 'combinations'), S('kickboxing', 'combinations'),
      0.85 * S('muayThai', 'hands'), 0.8 * S('karate', 'blitz')),
    footwork: Math.max(S('boxing', 'footwork'), S('kickboxing', 'footwork'), S('karate', 'footwork'),
      S('taekwondo', 'footwork'), 0.9 * S('boxing', 'ringCraft'), 0.8 * S('mmaIntegration', 'cageWork')),
    distance: Math.max(S('karate', 'distanceControl'), S('taekwondo', 'distance'), S('boxing', 'ringCraft'),
      0.9 * S('boxing', 'jab'), 0.9 * S('muayThai', 'teep'), 0.85 * S('kickboxing', 'footwork')),
    headMovement: Math.max(S('boxing', 'headMovement'), 0.8 * S('kickboxing', 'defence')),
  };
  CRAFT.set(rt, c);
  return c;
}

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

export const TACTICS = Object.freeze({
  /**
   * A strike launched this soon after the previous one still belongs to the
   * same combination (§2.3.1 rule 2: the next strike may launch once the
   * previous has completed 40 % of its recovery; a pause longer than this is a
   * new entry, not a follow-up).
   */
  chainGapSlackMs: 350,
  /** A defence counts as "just made" for the best-counter lookup this long. */
  defenceMemoryMs: 700,
  /** §2.8: at most this much reach advantage counts. */
  reachScaleByClass: { light: 0.7, middle: 1.0, heavy: 1.5 } as Readonly<Record<WeightClassScale, number>>,
  /** Range-fit skill: the comfort term reads this share of the footwork/distance craft. */
  comfortCraftShare: 0.5,
  /** Habituation window for a repeated feint (§2.3.4). */
  feintHabitWindowMs: FEINT.habituationWindowMs,
});

// ---------------------------------------------------------------------------
// Feints (§2.3.4)
// ---------------------------------------------------------------------------

export interface FeintBiteInput {
  /** 01 `feintBiteP` of the defender. */
  baseBiteP: number;
  attackerFeintSkill: number;
  /** Same feint shown by this attacker inside the habituation window. */
  repeats: number;
  defenderFatigue: number;
  defenderRocked: boolean;
  defenderVisionBlocked: boolean;
  /** Consecutive feints without a strike (over-feinting is read, §2.3.4). */
  consecutive: number;
}

function sig(x: number): number { return 1 / (1 + Math.exp(-x)); }
function lgt(p: number): number {
  const c = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
  return Math.log(c / (1 - c));
}

/** P(the defender bites), §2.3.4 with the habituation and over-feint rules. */
export function feintBiteP(x: FeintBiteInput): number {
  const l = lgt(x.baseBiteP)
    + FEINT.sellK * (x.attackerFeintSkill - 50) / 100
    + FEINT.habituationLogit * Math.max(0, x.repeats)
    + FEINT.fatigueLogit * Math.min(1, Math.max(0, x.defenderFatigue))
    + (x.defenderVisionBlocked ? FEINT.visionBlockedLogit : 0)
    + (x.defenderRocked ? 0.5 : 0)
    // The third feint in a row without a strike is information, not a threat.
    - (x.consecutive >= FEINT.overFeintN ? 1.0 : 0);
  return sig(l);
}

/** How many times this attacker showed the same feint inside the window. */
export function feintRepeats(st: TacticalState, id: string, nowMs: number): number {
  let n = 0;
  for (let i = 0; i < st.feintIds.length; i++) {
    if (st.feintIds[i] === id && nowMs - st.feintMs[i] <= TACTICS.feintHabitWindowMs) n++;
  }
  return n;
}

export function noteFeint(st: TacticalState, id: string, nowMs: number): void {
  st.feintIds.push(id);
  st.feintMs.push(nowMs);
  if (st.feintIds.length > 6) { st.feintIds.shift(); st.feintMs.shift(); }
  st.feintsSinceStrike += 1;
}

/** The follow-up bonus a bite buys (kick feints make the punches +0.50). */
export function biteBonus(feintId: string, defenderTier: number): number {
  if (feintId === 'feint.kick') return FEINT.kickFeintPunchBonus;
  if (feintId === 'feint.level_change') return FEINT.levelChangeBonus;
  return feintBonus(defenderTier);
}

// ---------------------------------------------------------------------------
// Counter windows (§2.5.1) — written when a strike resolves
// ---------------------------------------------------------------------------

/**
 * The attacker has just finished a strike with this outcome: open the window
 * during which he is exposed. `contactEndMs` is when the contact phase ended.
 */
export function openExposure(
  st: TacticalState, spec: TechniqueSpec, outcome: StrikeOutcomeForWindow, attackerTier: number,
  contactEndMs: number,
): void {
  const w = counterWindow(spec, outcome, attackerTier);
  // The window covers the rest of the strike's recovery plus the table's
  // fraction of the counter window: that is when his hand or leg is away.
  st.exposedFromMs = contactEndMs;
  st.exposedUntilMs = contactEndMs + w.ms;
  st.exposedDefenceLogit = w.attackerDefenceLogit;
  st.exposedReadLogit = w.attackerReadLogit;
  st.exposedTech = spec.id;
}

/** The defender made a reactive defence work: remember it for the best-counter lookup. */
export function noteDefence(st: TacticalState, id: DefenceId, nowMs: number): void {
  st.lastDefence = id;
  st.lastDefenceMs = nowMs;
}

// ---------------------------------------------------------------------------
// The contact-time terms
// ---------------------------------------------------------------------------

export interface TacticalContext {
  spec: TechniqueSpec;
  /** When the attacking strike was launched (commit) and makes contact. */
  launchMs: number;
  contactMs: number;
  attackerId: number;
  targetId: number;
  attacker: FighterRuntime;
  defender: FighterRuntime;
  attackerState: TacticalState;
  defenderState: TacticalState;
  /** Centre-to-centre distance at contact, the attacker's band and profile. */
  distanceM: number;
  band: RangeBand;
  profile: ReachProfile;
  limits: BandLimits;
  /** At distance (range fit, reach and stance only apply there). */
  atDistance: boolean;
  region: string;
  attackerStance: 'orthodox' | 'southpaw';
  defenderStance: 'orthodox' | 'southpaw';
  classScale: WeightClassScale;
}

export interface TacticalTerms {
  /** Added to the arrival logit. */
  arrivalLogit: number;
  /** Added to the defender's reactive-defence success logit. */
  defenceLogit: number;
  /** The defender is reacting to a feint: his reactive defence is spent. */
  voidDefence: boolean;
  /** Delivered-force multiplier (range fit, counter closing speed). */
  forceMult: number;
  /** Thrown into the defender's counter window. */
  counter: boolean;
  /** Parts, for the audit and the tests. */
  parts: { range: number; reach: number; stance: number; chain: number; counter: number; feint: number };
}

/**
 * Every §2.1/§2.3/§2.5/§2.8 term for one strike at contact. Pure.
 */
export function tacticalTerms(x: TacticalContext): TacticalTerms {
  const spec = x.spec;
  const craftA = strikingCraft(x.attacker);
  const parts = { range: 0, reach: 0, stance: 0, chain: 0, counter: 0, feint: 0 };
  let forceMult = 1;
  let defenceLogit = 0;

  // --- §2.1.1 range fit: edge of the band, one band out, smothered ---------
  if (x.atDistance) {
    const comfortSkill = (1 - TACTICS.comfortCraftShare) * x.attacker.strikingMean
      + TACTICS.comfortCraftShare * Math.max(craftA.footwork, craftA.distance);
    const fit = rangeFitIn(spec, x.distanceM, x.profile, comfortSkill, x.band, x.limits);
    if (fit.available) {
      parts.range = fit.logit;
      forceMult *= fit.forceMult;
    }
    // --- §2.8 reach: straights, teeps and round kicks at long/kick range ---
    const reachAdvCm = (x.attacker.body.reachM - x.defender.body.reachM) * 100;
    parts.reach = reachAccuracyLogit(reachAdvCm, x.band, spec.family, x.classScale);
    // --- §2.7 stance matchup ------------------------------------------------
    const rule = stanceRuleFor(spec);
    if (rule) parts.stance = stanceMatchupLogit(rule, isOpenStance(x.attackerStance, x.defenderStance));
  }

  // --- §2.3.1 combination flow --------------------------------------------
  const a = x.attackerState;
  if (a.prevTech !== null && a.prevTarget === x.targetId && hasTechnique(a.prevTech)) {
    const prev = technique(a.prevTech);
    const gap = x.launchMs - a.prevLaunchMs;
    const window = prev.startupMs + prev.activeMs + prev.recoveryMs + TACTICS.chainGapSlackMs;
    if (gap >= 0 && gap <= window) {
      const step = chainStep(prev, spec);
      if (!step.legal) {
        parts.chain = step.logit;
      } else {
        const reacted = a.prevOutcome === 'landed' || a.prevOutcome === 'blocked'
          || a.prevOutcome === 'evaded' || a.prevOutcome === 'checked';
        let b = 0;
        if (prev.skill === 'boxing.jab') {
          b = a.prevOutcome === 'landed' ? CHAIN.afterLandedJab : reacted ? CHAIN.afterDefendedJab : 0;
        } else if (reacted) {
          b = CHAIN.stepBonus;
        }
        // Body then head inside 600 ms: the guard came down to meet the first.
        if (a.prevRegion === 'body' && x.region === 'head' && gap <= CHAIN.bodyHeadMs) {
          b = Math.max(b, CHAIN.bodyHeadBonus);
        }
        // Kick then punch: the kicker is back on both feet and the guard is low.
        const kick = prev.family === 'lowKick' || prev.family === 'bodyKick' || prev.family === 'headKick';
        if (kick && (spec.family === 'straight' || spec.family === 'hook')) {
          b = Math.max(b, a.prevOutcome === 'checked' ? CHAIN.afterCheckPunch : CHAIN.kickThenPunch);
        }
        // The bonus is realised in proportion to the combination craft.
        const realise = Math.max(0, 0.4 + 1.2 * (craftA.combinations / 100));
        parts.chain = Math.min(CHAIN.stepBonusCap, b) * realise;
      }
    }
  }

  // --- §2.5.1 counter: thrown into the defender's own recovery -------------
  const d = x.defenderState;
  let counter = false;
  if (x.launchMs >= d.exposedFromMs - 150 && x.launchMs <= d.exposedUntilMs && d.exposedTech !== null
    && hasTechnique(d.exposedTech)) {
    counter = true;
    const trigger = technique(d.exposedTech);
    const recentDefence = x.launchMs - a.lastDefenceMs <= TACTICS.defenceMemoryMs ? a.lastDefence : null;
    const best = bestCounterFor(trigger, strikeClasses(trigger), recentDefence, x.attacker.strikingTier);
    if (best && best.counterTech === spec.id) {
      parts.counter = realisedCounterBonus(best.bonus, craftA.counters);
      if (best.forceMult) forceMult *= best.forceMult;
    } else {
      parts.counter = genericCounterBonus(craftA.counters);
    }
    // A missed or checked kick costs the kicker his defence as well (§2.5.1).
    defenceLogit += d.exposedDefenceLogit;
  }

  // --- §2.3.4 the defender bit a feint from this attacker -----------------
  let voidDefence = false;
  if (d.bitBy === x.attackerId && x.contactMs <= d.bitUntilMs) {
    const punch = spec.family === 'straight' || spec.family === 'hook' || spec.family === 'uppercut'
      || spec.family === 'overhand';
    const bonus = d.bitFeint === 'feint.kick' && !punch ? feintBonus(x.defender.strikingTier) : d.bitBonus;
    parts.feint = bonus;
    voidDefence = true;
  }

  return {
    arrivalLogit: parts.range + parts.reach + parts.stance + parts.chain + parts.counter + parts.feint,
    defenceLogit,
    voidDefence,
    forceMult,
    counter,
    parts,
  };
}

/** Remember a strike for the next one's combination-flow test. */
export function notePrevStrike(
  st: TacticalState, spec: TechniqueSpec, launchMs: number, targetId: number,
  outcome: StrikeOutcomeForWindow, region: string,
): void {
  st.prevTech = spec.id;
  st.prevLaunchMs = launchMs;
  st.prevTarget = targetId;
  st.prevOutcome = outcome;
  st.prevRegion = region;
  st.feintsSinceStrike = 0;
}
