/**
 * COMBINATION GRAMMAR, FEINTS AND RHYTHM — chapter 02 §2.3.
 *
 * A combination is not "n strikes in a row": it is a chain whose every step
 * moves the defender's guard somewhere the next step exploits (1-2 narrows the
 * guard and opens the hook; 1-3 widens it and opens the middle). That is why
 * the per-step bonus is conditional on a guard-moving relation and why chains
 * without one get the flow but no bonus (§2.3.1 rule 3).
 *
 * Feints target the *read*, not the guard: on a bite the defender executes the
 * reaction the feint sells, and the follow-up exploits it. Experts do not bite,
 * and when they do they still have reflexes — which is why the bonus shrinks
 * from +0.40 logit against T0-T2 to +0.10 against T4-T5.
 *
 * Numbering (§2.3.2): 1 jab, 2 cross, 3 lead hook, 4 rear hook, 5 lead
 * uppercut, 6 rear uppercut, `b` body, L rear low kick, K body kick, H head
 * kick, E elbow, N knee, T teep, F feint, S slip, P pivot.
 */
import type { TechniqueId } from '../core/ids';
import { technique, type TechniqueSpec } from './catalogue';

// ---------------------------------------------------------------------------
// §2.3.1 chain rules
// ---------------------------------------------------------------------------

export const CHAIN = Object.freeze({
  /** Strike n+1 may launch once strike n has completed this share of its recovery. */
  overlap: 0.40,
  stepBonus: 0.24,
  stepBonusCap: 0.48,
  afterLandedJab: 0.48,
  afterDefendedJab: 0.24,
  bodyHeadMs: 600,
  bodyHeadBonus: 0.48,
  /** A body pool at `structural >= 40` (05) makes the guard drop permanent. */
  bodyPoolHeadKick: 0.45,
  dutchMs: 300,
  dutchBonus: 0.45,
  /** Absolute change to P(read), not a logit (§2.3.1 rule 6). */
  dutchReadPenalty: -0.15,
  dutchCheckMult: 0.5,
  kickThenPunch: 0.24,
  afterCheckPunch: 0.50,
  /** Same limb without a hip reload, or the wrong launch position. */
  illegalPenaltyLogit: -0.50,
  illegalPenaltyMs: 100,
  /** Hip reload: legal, but it costs the same 100 ms and 0.50 logit. */
  reloadMs: 100,
  reloadLogit: -0.50,
  capVsWrestler: 3,
});

/** Per-tier combination cap (§2.3.1 rule 8). 07's own cap must be <= this. */
export const COMBO_CAP_BY_TIER: readonly number[] = [2, 3, 3, 4, 5, 6];

/** T0 and T1 attempt illegal chains this often (§2.3.1 rule 9). */
export const ILLEGAL_CHAIN_RATE_BY_TIER: readonly number[] = [0.30, 0.15, 0, 0, 0, 0];

export interface ChainCheck {
  legal: boolean;
  /** Extra startup on the offending / reloading strike. */
  extraStartupMs: number;
  /** Logit penalty on the offending / reloading strike. */
  logit: number;
  reason: 'ok' | 'reload' | 'sameLimb' | 'notInFlow';
}

/**
 * §2.3.1 rule 1 (flow) and rule 9 (illegal chain).
 *
 * Legal when the limbs alternate, or when the same limb repeats *with* a hip
 * reload. The recovery position of strike n must also be the launch position of
 * strike n+1 — that relation is the catalogue's `followUps` list.
 */
export function chainStep(prev: TechniqueSpec, next: TechniqueSpec, reload = false): ChainCheck {
  const sameLimb = prev.limb === next.limb && prev.limb !== 'both';
  const inFlow = prev.followUps.includes(next.id);
  if (sameLimb && !reload) {
    return {
      legal: false, reason: 'sameLimb',
      extraStartupMs: CHAIN.illegalPenaltyMs, logit: CHAIN.illegalPenaltyLogit,
    };
  }
  if (sameLimb && reload) {
    return { legal: true, reason: 'reload', extraStartupMs: CHAIN.reloadMs, logit: CHAIN.reloadLogit };
  }
  // The §2.2.3 "Follow-up options" lists name the *common* continuations, not an
  // exhaustive grammar, so a pair that appears in one of the 35 named chains of
  // §2.3.2 (which the chapter certifies as legal) is in flow by construction.
  if (!inFlow && !NAMED_CHAIN_PAIRS.has(`${prev.id}>${next.id}`)) {
    return {
      legal: false, reason: 'notInFlow',
      extraStartupMs: CHAIN.illegalPenaltyMs, logit: CHAIN.illegalPenaltyLogit,
    };
  }
  return { legal: true, reason: 'ok', extraStartupMs: 0, logit: 0 };
}

/**
 * Earliest launch of the next strike, in ms after the previous strike's launch
 * (§2.3.1 rule 2): strike n+1 may go once strike n has completed `overlap` of
 * its recovery.
 *
 * Note for calibration [REVIEW]: the chapter's own worked check of this rule is
 * internally inconsistent. It writes the per-step term as
 * `startup_{n+1} - 0.6 x recovery_n` (which would launch the next strike
 * *before* the previous contact ended), its listed numbers sum to 590 ms rather
 * than the 780 ms it quotes, and the measured anchor is 851 ms for 1-2-3-2. The
 * rule as *stated* gives ~1290 ms at `overlap = 0.40`, so `p.strike.combo.overlap`
 * is the lever that has to move to hit FD #48 (18.5 strikes in the final 30 s)
 * — not the formula. TODO(chapter 09 §7): resolve in the C1 calibration run.
 */
export function nextLaunchOffsetMs(prev: TechniqueSpec, overlap: number = CHAIN.overlap): number {
  return prev.startupMs + prev.activeMs + overlap * prev.recoveryMs;
}

/** Total time of a chain from first launch to last contact (§2.3.1 rule 2 check). */
export function chainDurationMs(specs: readonly TechniqueSpec[], overlap: number = CHAIN.overlap): number {
  if (specs.length === 0) return 0;
  let t = 0;
  for (let i = 0; i < specs.length - 1; i++) t += nextLaunchOffsetMs(specs[i], overlap);
  return t + specs[specs.length - 1].startupMs + specs[specs.length - 1].activeMs;
}

/**
 * §2.3.1 rule 3. `index` is 0-based; only the 2nd and 3rd strike of a chain earn
 * the bonus, it is cumulative, and it is capped. A chain whose steps have no
 * guard-moving relation gets the flow but nothing else.
 */
export function comboStepBonus(index: number, guardMovingSteps: readonly number[]): number {
  let bonus = 0;
  for (let i = 1; i <= Math.min(index, 2); i++) {
    if (guardMovingSteps.includes(i)) bonus += CHAIN.stepBonus;
  }
  return Math.min(bonus, CHAIN.stepBonusCap);
}

export interface SetupState {
  /** ms since the previous strike in the chain landed / was defended. */
  sinceMs: number;
  previous?: TechniqueSpec;
  previousResult?: 'landed' | 'blocked' | 'evaded' | 'missed' | 'checked' | 'caught';
  /** ms since a body strike landed on this defender. */
  sinceBodyLandedMs?: number;
  /** ms since a head strike landed on this defender. */
  sinceHeadLandedMs?: number;
  /** 05's body `structural` pool, 0-100. */
  defenderBodyStructural?: number;
}

/**
 * The set-up logits of §2.3.1 rules 4-7 for the strike about to be thrown.
 * Kept in one place because they all read the same "what just happened" state
 * and 07 must not be able to double-count them.
 */
export function setupLogit(next: TechniqueSpec, state: SetupState): number {
  let l = 0;
  const prev = state.previous;
  if (prev && state.sinceMs <= CHAIN.dutchMs) {
    const prevJab = prev.skill === 'boxing.jab';
    if (prevJab && state.previousResult === 'landed') l += CHAIN.afterLandedJab;
    else if (prevJab && (state.previousResult === 'blocked' || state.previousResult === 'caught')) {
      l += CHAIN.afterDefendedJab;
    }
    // Rule 6, the Dutch gate: hands occupied, weight on the lead leg.
    const prevPunch = prev.weapon === 'fist' || prev.weapon === 'backfist';
    const lowOrBodyKick = next.family === 'lowKick' || next.family === 'bodyKick';
    if (prevPunch && lowOrBodyKick
        && (state.previousResult === 'landed' || state.previousResult === 'blocked')) {
      l += CHAIN.dutchBonus;
    }
    // Rule 7, kick -> punch.
    const prevKick = prev.family === 'lowKick' || prev.family === 'bodyKick'
      || prev.family === 'headKick' || prev.family === 'teep';
    const nextPunch = next.weapon === 'fist' || next.weapon === 'backfist';
    if (prevKick && nextPunch && state.previousResult === 'landed') l += CHAIN.kickThenPunch;
  }
  // Rule 5, the body-head window. It runs both ways and lasts 600 ms.
  const toHead = next.targets[0] === 'head';
  if (toHead && (state.sinceBodyLandedMs ?? Infinity) <= CHAIN.bodyHeadMs) l += CHAIN.bodyHeadBonus;
  if (!toHead && next.targets[0] === 'body'
      && (state.sinceHeadLandedMs ?? Infinity) <= CHAIN.bodyHeadMs) {
    l += CHAIN.bodyHeadBonus;
  }
  // A beaten-up body keeps the elbows down for good, not for 600 ms.
  if (next.family === 'headKick' && (state.defenderBodyStructural ?? 0) >= 40) {
    l += CHAIN.bodyPoolHeadKick;
  }
  return l;
}

/** True when the Dutch gate is open for `next` (used to halve the check roll). */
export function dutchGateOpen(prev: TechniqueSpec | undefined, next: TechniqueSpec, sinceMs: number): boolean {
  if (!prev || sinceMs > CHAIN.dutchMs) return false;
  const prevPunch = prev.weapon === 'fist' || prev.weapon === 'backfist';
  return prevPunch && (next.family === 'lowKick' || next.family === 'bodyKick');
}

/** Combination length cap: the tier cap, or 3 against a clearly better wrestler. */
export function comboCap(tier: number, opponentWrestlingEdgeTiers = 0): number {
  const cap = COMBO_CAP_BY_TIER[clampTier(tier)];
  return opponentWrestlingEdgeTiers >= 1 ? Math.min(cap, CHAIN.capVsWrestler) : cap;
}

// ---------------------------------------------------------------------------
// §2.3.2 named chains
// ---------------------------------------------------------------------------

export type ComboToken = string;

export interface ComboStep {
  token: ComboToken;
  /** null for feints, pivots and slips — they are actions, not strikes. */
  tech: TechniqueId | null;
  kind: 'strike' | 'feint' | 'pivot' | 'slip';
}

export interface ComboSpec {
  id: string;
  /** The chain in the chapter's notation, e.g. '1-2-3-2'. */
  chain: string;
  steps: readonly ComboStep[];
  /** 1-based indices of the steps that earn the guard-moving bonus. */
  guardMovingSteps: readonly number[];
  minTier: number;
  note: string;
  tag: string;
}

/** Notation -> technique id (§2.3.2 numbering). */
const TOKEN_TECH: Readonly<Record<string, TechniqueId>> = Object.freeze({
  '1': 'tech.jab',
  '1b': 'tech.jab_body',
  '2': 'tech.cross',
  '2b': 'tech.cross_body',
  '3': 'tech.hook_lead',
  // `3b` is the liver hook: the chapter names combo.3b_3 "liver -> head".
  '3b': 'tech.hook_liver',
  '4': 'tech.hook_rear',
  '4b': 'tech.hook_rear_body',
  '5': 'tech.uppercut_lead',
  '6': 'tech.uppercut_rear',
  L: 'tech.kick_low_rear',
  calf: 'tech.kick_calf',
  K: 'tech.kick_body_rear',
  switchK: 'tech.kick_body_switch',
  H: 'tech.kick_head_rear',
  E: 'tech.elbow_horizontal',
  N: 'tech.knee_straight',
  T: 'tech.teep_lead',
  overhand: 'tech.overhand',
});

function step(token: ComboToken): ComboStep {
  if (token.startsWith('F')) return { token, tech: null, kind: 'feint' };
  if (token === 'P') return { token, tech: null, kind: 'pivot' };
  if (token === 'S') return { token, tech: null, kind: 'slip' };
  const tech = TOKEN_TECH[token];
  if (!tech) throw new Error(`Unknown combination token: ${token}`);
  return { token, tech, kind: 'strike' };
}

function combo(
  id: string, chain: string, guardMovingSteps: readonly number[], minTier: number,
  note: string, tag: string,
): ComboSpec {
  return { id, chain, steps: chain.split('-').map(step), guardMovingSteps, minTier, note, tag };
}

/** The 35 named chains of §2.3.2. 07 selects by weight; all of them are legal. */
export const COMBINATIONS: readonly ComboSpec[] = [
  combo('combo.1_1', '1-1', [2], 0, 'Double up on the jab.', '[S: BOX §5 basic]'),
  combo('combo.1_2', '1-2', [2], 0, 'The one-two.', '[S: BOX §5]'),
  combo('combo.1_1_2', '1-1-2', [2, 3], 1, 'Double jab into the cross.', '[S: BOX §5]'),
  combo('combo.1_2_3', '1-2-3', [2, 3], 1, 'The 1-2 narrows the guard, the hook goes around it.', '[S: BOX §5]'),
  combo('combo.1_2_3_2', '1-2-3-2', [2, 3], 2, 'The four-beat; measured at 851 ms.', '[S: BOX §5]'),
  combo('combo.2_3_2', '2-3-2', [2, 3], 2, 'Lead with the rear hand.', '[S: BOX §5]'),
  combo('combo.1_2_5_2', '1-2-5-2', [2, 3], 2, 'Uppercut through the middle, then re-cross.', '[S: BOX §5]'),
  combo('combo.1b_2', '1b-2', [2], 2, 'Body jab lifts the elbows, cross over the top.', '[S: BOX §5]'),
  combo('combo.1_2b', '1-2b', [2], 2, 'Head then body.', '[S: BOX §5]'),
  combo('combo.1_2b_3', '1-2b-3', [2, 3], 2, 'Head-body-head.', '[S: BOX §5 set-up chains]'),
  combo('combo.3b_3', '3b-3', [2], 2, 'Liver hook, then the same hand upstairs.', '[S: BOX §5]'),
  combo('combo.2b_2', '2b-2', [2], 3, 'Same hand twice: needs a hip reload.', '[S: BOX §5]'),
  combo('combo.1_6_3', '1-6-3', [2, 3], 2, 'Jab, rear uppercut through the guard, lead hook around it.', '[S: BOX §5]'),
  combo('combo.3b_6', '3b-6', [2], 3, 'Liver hook into the rear uppercut.', '[S: BOX §5]'),
  combo('combo.F1_2', 'F1-2', [], 2, 'Feint the jab, throw the cross.', '[S: BOX §5]'),
  combo('combo.F2_3', 'F2-3', [], 2, 'Feint the rear hand, hook around the reaction.', '[S: BOX §5]'),
  combo('combo.1_F2_3', '1-F2-3', [2], 3, 'Real jab, feinted cross, real hook.', '[S: BOX §5]'),
  combo('combo.1_2_P', '1-2-P', [2], 2, 'Exit on an angle after the two.', '[S: BOX §5]'),
  combo('combo.1_P_3', '1-P-3', [3], 3, 'Jab, pivot, hook from the new angle (+0.30, §2.1.3).', '[S: BOX §5]'),
  combo('combo.1_2_S_3', '1-2-S-3', [2], 3, 'Slip the return, then counter (§2.5.4).', '[S: BOX §5]'),
  combo('combo.1_2_L', '1-2-L', [2], 2, 'The Dutch three: the kick rides the gate.', '[S: MTK D1]'),
  combo('combo.1_L', '1-L', [], 1, 'Jab into the low kick.', '[S: MTK §8.23]'),
  combo('combo.2_3_L', '2-3-L', [2], 2, 'Cross-hook-low kick.', '[S: MTK D1]'),
  combo('combo.3b_L', '3b-L', [], 3, 'Liver hook into the low kick — the classic Dutch pair.', '[S: MTK D1]'),
  combo('combo.1_2_K', '1-2-K', [2], 2, 'One-two into the body kick.', '[E]'),
  combo('combo.1_T', '1-T', [], 1, 'Jab then teep: a range reset, not a guard mover.', '[E]'),
  combo('combo.T_2', 'T-2', [], 2, 'Teep then cross (kick -> punch +0.24).', '[E]'),
  combo('combo.L_2', 'L-2', [], 2, 'Low kick then cross.', '[S: MTK §2 K1; E]'),
  combo('combo.calf_2', 'calf-2', [], 2, 'Calf kick then cross.', '[E]'),
  combo('combo.1_2_N', '1-2-N', [2], 3, 'One-two into the knee (Thai).', '[E]'),
  combo('combo.3_E', '3-E', [2], 3, 'Hook into the elbow at close range.', '[E]'),
  combo('combo.1_2_E', '1-2-E', [2, 3], 3, 'One-two into the elbow.', '[E]'),
  combo('combo.1_2_switchK', '1-2-switchK', [2], 3, 'One-two into the switch body kick.', '[E]'),
  combo('combo.1b_overhand', '1b-overhand', [2], 3, 'Body jab lifts the hands, overhand over the top.', '[S: BOX §2 #7 note]'),
  combo('combo.Flevel_6', 'Flevel-6', [], 3, 'Level-change feint, then the uppercut into the dropped head.', '[S: MIS I-6]'),
];

/** Consecutive strike pairs certified legal by the named chains (§2.3.2). */
const NAMED_CHAIN_PAIRS: ReadonlySet<string> = (() => {
  const pairs = new Set<string>();
  for (const c of COMBINATIONS) {
    const strikes = c.steps.filter((s) => s.tech !== null);
    for (let i = 0; i < strikes.length - 1; i++) {
      pairs.add(`${strikes[i].tech}>${strikes[i + 1].tech}`);
    }
  }
  return pairs;
})();

const COMBO_BY_ID = new Map<string, ComboSpec>(COMBINATIONS.map((c) => [c.id, c]));

export function combination(id: string): ComboSpec {
  const c = COMBO_BY_ID.get(id);
  if (!c) throw new Error(`Unknown combination: ${id}`);
  return c;
}

export function combinationsForTier(tier: number): readonly ComboSpec[] {
  return COMBINATIONS.filter((c) => c.minTier <= tier);
}

/** The technique specs of a chain's strike steps, in order. */
export function comboSpecs(c: ComboSpec): readonly TechniqueSpec[] {
  return c.steps.filter((s) => s.tech !== null).map((s) => technique(s.tech as TechniqueId));
}

// ---------------------------------------------------------------------------
// §2.3.4 feints
// ---------------------------------------------------------------------------

export type FeintId =
  | 'feint.jab' | 'feint.rear_hand' | 'feint.level_change' | 'feint.step'
  | 'feint.kick' | 'feint.teep' | 'feint.eyes' | 'feint.shoulder_roll_bait';

export interface FeintSpec {
  id: FeintId;
  name: string;
  cue: string;
  sells: string;
  /** The defence the defender executes on a bite. */
  reactionDrawn: readonly string[];
  /** What the bite opens, in words; the logit is `feintBonus()` unless overridden. */
  opening: string;
  /** Replaces the tier-dependent bonus when set (the level-change feint's +0.70). */
  bonusOverride?: number;
  startupMs: number;
  recoveryMs: number;
  minTier: number;
  tag: string;
}

export const FEINT = Object.freeze({
  startupMinMs: 80,
  startupMaxMs: 150,
  recoveryMs: 100,
  windowMs: 400,
  /** Attacker's `striking.feints`: +1.5 logit per 100 points above 50. */
  sellK: 1.5,
  /** Same feint repeated inside 20 s without a strike. */
  habituationLogit: -0.70,
  habituationWindowMs: 20_000,
  levelChangeBonus: 0.70,
  /** The third consecutive feint without a strike gives away a free counter. */
  overFeintN: 3,
  overFeintCounterP: 0.30,
  /** Punches while the defender stands on one leg after biting a kick feint. */
  kickFeintPunchBonus: 0.50,
  /** Defender modifiers on the bite roll. */
  visionBlockedLogit: 0.40,
  fatigueLogit: 0.50,
});

/** §2.3.4. The bite draw itself is 07's per-tick `u_feint` (09 §2.7). */
export const FEINTS: readonly FeintSpec[] = [
  {
    id: 'feint.jab', name: 'Jab feint', cue: 'Shoulder / hand twitch', sells: 'jab',
    reactionDrawn: ['def.catch', 'def.parry', 'def.pull'],
    opening: 'Rear hand; hook around the parry.',
    startupMs: 90, recoveryMs: 100, minTier: 2, tag: '[S: BOX §5]',
  },
  {
    id: 'feint.rear_hand', name: 'Rear-hand feint', cue: 'Hip / shoulder load', sells: 'cross or overhand',
    reactionDrawn: ['def.shoulder_roll', 'def.block_high', 'def.slip_out'],
    opening: 'Lead hook; body.',
    startupMs: 110, recoveryMs: 100, minTier: 3, tag: '[S: BOX §5]',
  },
  {
    id: 'feint.level_change', name: 'Level-change feint', cue: 'Knees bend, head drops',
    sells: 'body punch or shot',
    reactionDrawn: ['def.sprawl_posture'],
    opening: 'Uppercut, intercepting knee, overhand into the dropped head.',
    bonusOverride: FEINT.levelChangeBonus,
    startupMs: 130, recoveryMs: 100, minTier: 3, tag: '[D: MIS I-6 +15-25 %; BOX §5]',
  },
  {
    id: 'feint.step', name: 'Step feint', cue: 'Foot stomp / half step', sells: 'step-in strike',
    reactionDrawn: ['def.pull', 'def.step_back'],
    opening: 'Step-in strike after the reaction; draws the check hook early, so the attacker '
      + 'can counter the counter.',
    startupMs: 100, recoveryMs: 100, minTier: 3, tag: '[S: BOX §5]',
  },
  {
    id: 'feint.kick', name: 'Kick feint', cue: 'Hip turn / knee lift', sells: 'round kick',
    reactionDrawn: ['def.check'],
    opening: 'Punches at +0.50 while the defender is on one leg for 250 ms; takedown +0.65 (03).',
    startupMs: 140, recoveryMs: 100, minTier: 3, tag: '[S: MTK §8.13]',
  },
  {
    id: 'feint.teep', name: 'Teep feint', cue: 'Lead knee lift', sells: 'teep',
    reactionDrawn: ['def.parry_down_teep', 'def.step_off'],
    opening: 'Cross over the dropped hand.',
    startupMs: 120, recoveryMs: 100, minTier: 3, tag: '[E]',
  },
  {
    id: 'feint.eyes', name: 'Eye feint', cue: 'Look at the target', sells: 'strike to the looked-at region',
    reactionDrawn: [],
    opening: 'Strike the *other* region.',
    startupMs: 80, recoveryMs: 100, minTier: 4, tag: '[S: BOX §5; E]',
  },
  {
    id: 'feint.shoulder_roll_bait', name: 'Shoulder-roll bait', cue: 'Offer the roll',
    sells: 'the opponent\'s rear hand',
    reactionDrawn: [],
    opening: 'The opponent throws; counter window (§2.5).',
    startupMs: 150, recoveryMs: 100, minTier: 4, tag: '[E]',
  },
];

const FEINT_BY_ID = new Map<FeintId, FeintSpec>(FEINTS.map((f) => [f.id, f]));

export function feint(id: FeintId): FeintSpec {
  const f = FEINT_BY_ID.get(id);
  if (!f) throw new Error(`Unknown feint: ${id}`);
  return f;
}

/** Feints available at a tier (§3: T2 has only the jab feint; T4 adds the eyes). */
export function feintsForTier(tier: number): readonly FeintSpec[] {
  return FEINTS.filter((f) => f.minTier <= tier);
}

/** Feints thrown per strike, by tier (§3 "Feints per strike thrown"). */
export const FEINT_RATE_BY_TIER: readonly number[] = [0, 0.05, 0.15, 0.30, 0.50, 0.70];

export interface BiteInput {
  /** 01 `feintBiteP` = 0.62 - 0.40 x defenderStrikingSkill/100. */
  baseBiteP: number;
  /** Attacker's `striking.feints`, 0-100. */
  attackerFeintSkill: number;
  /** How many times this same feint has been shown inside 20 s without a strike. */
  repeatsInWindow: number;
  defenderVisionBlocked?: boolean;
  defenderFatigue?: number;
}

/**
 * §2.3.4 bite probability. Habituation is ours (-0.7 logit per repeat): the
 * second identical feint inside 20 s is information the defender now owns.
 */
export function feintBiteProbability(input: BiteInput): number {
  const l = logit(input.baseBiteP)
    + FEINT.sellK * (input.attackerFeintSkill - 50) / 100
    + FEINT.habituationLogit * Math.max(0, input.repeatsInWindow)
    + (input.defenderVisionBlocked ? FEINT.visionBlockedLogit : 0)
    + FEINT.fatigueLogit * clamp01(input.defenderFatigue ?? 0);
  return sigmoid(l);
}

/**
 * Bonus on the follow-up after a bite (§2.3.4). Small at high tiers on purpose:
 * experts rarely bite, and when they do they still have reflexes.
 */
export function feintBonus(defenderTier: number, spec?: FeintSpec): number {
  if (spec?.bonusOverride !== undefined) return spec.bonusOverride;
  const t = clampTier(defenderTier);
  if (t <= 2) return 0.40;
  if (t === 3) return 0.20;
  return 0.10;
}

// ---------------------------------------------------------------------------
// §2.3.5 rhythm and broken rhythm
// ---------------------------------------------------------------------------

export const RHYTHM = Object.freeze({
  /** Pro cadence: ~1 action per 400-700 ms [D: BOX §5 cycle times 442/667 ms]. */
  cadenceMinMs: 400,
  cadenceMaxMs: 700,
  /** On-beat = within +-15 % of the running mean. */
  onBeatTol: 0.15,
  halfBeatLow: 0.40,
  halfBeatHigh: 0.60,
  offBeatLow: 1.40,
  offBeatHigh: 1.60,
  brokenBonus: 0.30,
  /** Rhythm breaking is a T4+ skill (`striking.feints >= 70`). */
  minTier: 4,
  /** A fighter who has been on-beat for >= 4 actions is readable. */
  readableAfter: 4,
  readableBonus: 0.30,
});

export type Beat = 'first' | 'onBeat' | 'halfBeat' | 'offBeat';

/**
 * Tracks one fighter's last three inter-launch intervals (§2.3.5).
 *
 * A half-beat launch after >= 2 on-beat actions sets `state.broken_rhythm`: the
 * strike gets +0.30 logit and every *anticipatory* (pre-committed) defence fails
 * automatically for that action. Guard-based defences still roll — broken rhythm
 * beats prediction, not the arms in front of the face.
 */
export class RhythmTracker {
  private readonly intervals: number[] = [];
  private lastLaunchMs: number | null = null;
  private onBeatRun = 0;

  /** Feed a launch time in absolute ms. Returns the beat classification. */
  launch(atMs: number): Beat {
    if (this.lastLaunchMs === null) {
      this.lastLaunchMs = atMs;
      this.onBeatRun = 0;
      return 'first';
    }
    const gap = atMs - this.lastLaunchMs;
    this.lastLaunchMs = atMs;
    const beat = this.classify(gap);
    this.intervals.push(gap);
    if (this.intervals.length > 3) this.intervals.shift();
    this.onBeatRun = beat === 'onBeat' ? this.onBeatRun + 1 : 0;
    return beat;
  }

  private classify(gapMs: number): Beat {
    if (this.intervals.length === 0) return 'onBeat';
    const mean = this.intervals.reduce((a, b) => a + b, 0) / this.intervals.length;
    const ratio = gapMs / mean;
    if (Math.abs(ratio - 1) <= RHYTHM.onBeatTol) return 'onBeat';
    if (ratio >= RHYTHM.halfBeatLow && ratio <= RHYTHM.halfBeatHigh) return 'halfBeat';
    if (ratio >= RHYTHM.offBeatLow && ratio <= RHYTHM.offBeatHigh) return 'halfBeat';
    return 'offBeat';
  }

  /** Mean of the tracked intervals, or null before two launches. */
  get cadenceMs(): number | null {
    if (this.intervals.length === 0) return null;
    return this.intervals.reduce((a, b) => a + b, 0) / this.intervals.length;
  }

  /** Consecutive on-beat launches — >= 4 makes the fighter readable. */
  get onBeatStreak(): number {
    return this.onBeatRun;
  }

  get readable(): boolean {
    return this.onBeatRun >= RHYTHM.readableAfter;
  }

  /** Was the last launch a rhythm break that this fighter is skilled enough to use? */
  brokenRhythm(beat: Beat, tier: number, previousOnBeatRun: number): boolean {
    return beat === 'halfBeat' && tier >= RHYTHM.minTier && previousOnBeatRun >= 2;
  }
}

// ---------------------------------------------------------------------------
// §2.3.6 level changes off strikes (hand-off to 03)
// ---------------------------------------------------------------------------

/** Transient flags a landed or blocked strike hands to the grappling chapter. */
export const SETUP_WINDOWS = Object.freeze({
  jabSetupMs: 800,
  crossSetupMs: 600,
  hookBodylockMs: 400,
  levelChangeTelegraphMs: 120,
});

/** TODO(chapter 03): 03 reads these flags for its takedown set-up bonuses. */
export function setupFlagFor(spec: TechniqueSpec): { flag: string; ms: number } | null {
  if (spec.id === 'tech.jab') return { flag: 'state.jab_setup', ms: SETUP_WINDOWS.jabSetupMs };
  if (spec.id === 'tech.cross') return { flag: 'state.cross_setup', ms: SETUP_WINDOWS.crossSetupMs };
  if (spec.id === 'tech.hook_lead') {
    return { flag: 'state.hook_bodylock_window', ms: SETUP_WINDOWS.hookBodylockMs };
  }
  return null;
}

// ---------------------------------------------------------------------------

function sigmoid(x: number): number {
  const q = Math.round(x * 1e9) / 1e9;
  return 1 / (1 + Math.exp(-q));
}

function logit(p: number): number {
  const c = Math.min(Math.max(p, 1e-9), 1 - 1e-9);
  return Math.log(c / (1 - c));
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clampTier(t: number): number {
  return t < 0 ? 0 : t > 5 ? 5 : Math.floor(t);
}
