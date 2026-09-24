/**
 * DEFENCE LAYER — chapter 02 §2.4.
 *
 * The central claim of this file, and the reason the old pre-chosen
 * `DefenseKind` posture roll is retired: **defence is reactive, and reaction
 * only matters inside its own window**. A jab's 130 ms startup is below any
 * human reaction (200-250 ms), so an unfeinted jab is never *seen* and blocked;
 * it is defended positionally (the guard matrix, §2.4.1) or predicted (the
 * pattern read, §2.4.3). A telegraphed T1 overhand, by contrast, leaves 260 ms
 * of window and every reactive defence in the table fits. That single
 * inequality is what makes slow, telegraphed strikes useless against experts
 * while remaining effective between novices [S: LB §4.2].
 *
 * Two layers:
 *   1. guard posture   — continuous, always in effect, never rolled (§2.4.1)
 *   2. reactive defence — chosen per incoming strike, only when a read
 *                         succeeded in time (§2.4.2, §2.4.3)
 *
 * Latency is NOT tier-scaled: simple reaction time does not separate tiers
 * [S: LB §4.2 Mori 2002], so `reactionLatencyMs` reads only 01's
 * `reactionTimeMs` plus state. What IS tier-scaled is the *read*: `readP`,
 * `feintBiteP` and `counterOnReadP` all come from 01's composites, which have
 * skill inside them, and the hurt penalty is tabled by tier.
 */
import { DEFENCE_IDS, type DefenceId } from '../core/ids';
import type { TechniqueSpec } from './catalogue';

// ---------------------------------------------------------------------------
// strike classes — the vocabulary the "vs" lists speak
// ---------------------------------------------------------------------------

export type StrikeClass =
  | 'jab' | 'cross' | 'straight' | 'bodyPunch' | 'hook' | 'bodyHook' | 'uppercut' | 'overhand'
  | 'elbow' | 'knee' | 'teep' | 'lowKick' | 'calfKick' | 'bodyKick' | 'headKick'
  | 'spinning' | 'stepIn' | 'levelChange';

/** Every class a technique belongs to, for the `vs` / `weakVs` lookups. */
export function strikeClasses(spec: TechniqueSpec): readonly StrikeClass[] {
  const out: StrikeClass[] = [];
  const body = spec.targets[0] === 'body';
  switch (spec.family) {
    case 'straight':
      out.push('straight');
      if (spec.skill === 'boxing.jab') out.push('jab');
      else if (spec.limb === 'rearHand') out.push('cross');
      if (body) out.push('bodyPunch');
      break;
    case 'hook':
      out.push(body ? 'bodyHook' : 'hook');
      if (body) out.push('bodyPunch');
      break;
    case 'uppercut':
      out.push('uppercut');
      if (body) out.push('bodyPunch');
      break;
    case 'overhand': out.push('overhand'); break;
    case 'elbow': out.push('elbow'); break;
    case 'knee': out.push('knee'); break;
    case 'teep': out.push('teep'); break;
    case 'lowKick':
      out.push('lowKick');
      if (spec.flags.includes('calfTargeted')) out.push('calfKick');
      break;
    case 'bodyKick': out.push('bodyKick'); break;
    case 'headKick': out.push('headKick'); break;
    case 'spinning': out.push('spinning'); break;
  }
  if (spec.flags.includes('stepIn')) out.push('stepIn');
  return out;
}

// ---------------------------------------------------------------------------
// §2.4.1 guard postures
// ---------------------------------------------------------------------------

export type GuardId =
  | 'guard.standard' | 'guard.high' | 'guard.long' | 'guard.philly' | 'guard.low_hands'
  | 'guard.peekaboo' | 'guard.cross_arm' | 'guard.square_wrestler' | 'guard.cover_turtle';

/** The columns of the §2.4.1 matrix. */
export type GuardColumn =
  | 'straightsHead' | 'hooksHead' | 'uppercuts' | 'overhand' | 'body' | 'headKicks' | 'lowKicks';

export interface GuardSpec {
  id: GuardId;
  name: string;
  description: string;
  /**
   * Logits added to the **attacker's** strike. Negative = the posture defends
   * that line. `guard.standard` is the reference and is all zeros, because the
   * catalogue's P_land already assumes it.
   */
  matrix: Readonly<Record<GuardColumn, number>>;
  /** Logit on the defender's own read roll (§2.4.3). */
  readLogit: number;
  /** Logit added to the passive block roll of §2.6.1 step 6. */
  passiveLogit: number;
  /** Multiplier on the defender's stamina drain while under fire. */
  staminaMult: number;
  /** Multiplier on the defender's mobility. */
  mobilityMult: number;
  /** Counter bonuses realised from this posture are multiplied by this. */
  counterMult: number;
  /** Minimum bladedness b (§2.1.2). */
  minBladedness?: number;
  /** Minimum `boxing.headMovement`. */
  minHeadMovement?: number;
  notes: string;
  tag: string;
}

const zeros: Record<GuardColumn, number> = {
  straightsHead: 0, hooksHead: 0, uppercuts: 0, overhand: 0, body: 0, headKicks: 0, lowKicks: 0,
};

/**
 * §2.4.1. BOX C11's probability-point matrix converted at p = 0.30 [D], with
 * MMA-glove scaling from MIS §2.4. `guard.low_hands`, `guard.square_wrestler`
 * and `guard.cover_turtle` are ours (§6 item 19).
 */
export const GUARDS: readonly GuardSpec[] = [
  {
    id: 'guard.standard', name: 'Standard', description: 'Hands at cheek/chin, elbows in.',
    matrix: { ...zeros }, readLogit: 0, passiveLogit: 0, staminaMult: 1, mobilityMult: 1,
    counterMult: 1, notes: 'Reference posture; every base P_land assumes it.', tag: '[S: BOX §8 C11]',
  },
  {
    id: 'guard.high', name: 'High guard', description: 'Gloves on the forehead, elbows tight, forward.',
    matrix: {
      straightsHead: -0.35, hooksHead: -0.35, uppercuts: 0.35, overhand: -0.20,
      body: 0.45, headKicks: -0.30, lowKicks: 0.10,
    },
    readLogit: -0.30, passiveLogit: 0.60, staminaMult: 1.10, mobilityMult: 1, counterMult: 1,
    notes: 'Buys the head line and pays for it with the body and the uppercut lane.',
    tag: '[D: BOX §8 C11 at p=0.30]',
  },
  {
    id: 'guard.long', name: 'Long guard', description: 'Lead arm extended into the opponent.',
    matrix: {
      straightsHead: -0.20, hooksHead: 0.20, uppercuts: 0.35, overhand: -0.40,
      body: 0.10, headKicks: -0.10, lowKicks: 0,
    },
    readLogit: 0, passiveLogit: 0, staminaMult: 1, mobilityMult: 1, counterMult: 1,
    notes: 'Lead hand unavailable for the jab; measures range (opponent step-in strikes -0.30); '
      + 'eye-poke foul risk 0.3-0.6 %/s (06).',
    tag: '[S: BOX §3 D10; MIS §2.4]',
  },
  {
    id: 'guard.philly', name: 'Philly shell', description: 'Lead shoulder up, rear hand at the chin, bladed.',
    matrix: {
      // -0.60 in the same stance; the open-stance value (+0.40) is applied by
      // the caller through `phillyOpenStance`, because it flips sign.
      straightsHead: -0.60, hooksHead: 0.60, uppercuts: 0.10, overhand: -0.30,
      body: 0.30, headKicks: 0.20, lowKicks: 0.10,
    },
    readLogit: 0, passiveLogit: 0, staminaMult: 1, mobilityMult: 1, counterMult: 1,
    minBladedness: 0.5, minHeadMovement: 60,
    notes: 'Enables def.shoulder_roll. "Hundreds of rounds" to own it.', tag: '[S: BOX §3 D9]',
  },
  {
    id: 'guard.low_hands', name: 'Low hands', description: 'Hands low and loose, upright (Thai / MMA counter stance).',
    matrix: {
      straightsHead: 0.50, hooksHead: 0.50, uppercuts: 0.10, overhand: 0.40,
      body: -0.10, headKicks: 0.10, lowKicks: -0.20,
    },
    readLogit: 0.20, passiveLogit: 0, staminaMult: 1, mobilityMult: 1, counterMult: 1,
    notes: 'Better vision and faster checks; enables tech.jab_up against it; pull/lean +0.20.',
    tag: '[E; S: MTK §1.4]',
  },
  {
    id: 'guard.peekaboo', name: 'Peek-a-boo', description: 'Gloves on the cheeks, elbows in, constant bob.',
    matrix: {
      straightsHead: -0.35, hooksHead: -0.10, uppercuts: 0.10, overhand: -0.10,
      body: 0.35, headKicks: -0.20, lowKicks: 0.10,
    },
    readLogit: 0, passiveLogit: 0, staminaMult: 1.15, mobilityMult: 1, counterMult: 1,
    notes: 'Enables the 6-4 body-uppercut chains; the bob costs 15 % stamina.',
    tag: '[S: BOX §3 D11]',
  },
  {
    id: 'guard.cross_arm', name: 'Cross-arm', description: 'Forearms folded across the face.',
    matrix: {
      straightsHead: -0.20, hooksHead: -0.35, uppercuts: 0.50, overhand: -0.30,
      body: -0.10, headKicks: -0.10, lowKicks: 0.10,
    },
    readLogit: -0.20, passiveLogit: 0, staminaMult: 1, mobilityMult: 0.90, counterMult: 0.5,
    notes: 'Slow to counter: the counter bonus is halved.', tag: '[S: BOX §3 D12]',
  },
  {
    id: 'guard.square_wrestler', name: 'Square wrestler', description: 'Hands mid, wide square base.',
    matrix: {
      straightsHead: 0.30, hooksHead: 0.20, uppercuts: 0, overhand: 0.20,
      body: 0.10, headKicks: 0, lowKicks: 0.20,
    },
    readLogit: 0, passiveLogit: 0, staminaMult: 1, mobilityMult: 1, counterMult: 1,
    notes: 'Takedown-defence bonus owned by 03; the heavy lead leg exposes the calf.',
    tag: '[S: MTK §1.4]',
  },
  {
    id: 'guard.cover_turtle', name: 'Cover up', description: 'Both arms wrapped, chin down, turned away.',
    matrix: {
      straightsHead: -0.30, hooksHead: -0.30, uppercuts: 0.60, overhand: -0.20,
      body: 0.60, headKicks: -0.20, lowKicks: 0.20,
    },
    readLogit: -0.60, passiveLogit: 0, staminaMult: 1, mobilityMult: 1, counterMult: 0,
    notes: 'T0-T1 default under fire. No counters; draws referee attention (06).',
    tag: '[E; S: BOX §6]',
  },
];

const GUARD_BY_ID = new Map<GuardId, GuardSpec>(GUARDS.map((g) => [g.id, g]));

export function guard(id: GuardId): GuardSpec {
  const g = GUARD_BY_ID.get(id);
  if (!g) throw new Error(`Unknown guard: ${id}`);
  return g;
}

/** Which matrix column an incoming technique reads. */
export function guardColumnFor(spec: TechniqueSpec): GuardColumn {
  const body = spec.targets[0] === 'body';
  switch (spec.family) {
    case 'straight': return body ? 'body' : 'straightsHead';
    case 'hook': return body ? 'body' : 'hooksHead';
    case 'uppercut': return body ? 'body' : 'uppercuts';
    case 'overhand': return 'overhand';
    case 'elbow': return 'hooksHead';
    case 'knee': return body ? 'body' : 'uppercuts';
    case 'teep': return 'body';
    case 'lowKick': return 'lowKicks';
    case 'bodyKick': return 'body';
    case 'headKick': return 'headKicks';
    case 'spinning': return spec.targets[0] === 'head' ? 'hooksHead' : 'body';
  }
}

/**
 * Logit the defender's posture adds to the attacker's strike. The Philly shell
 * is the one posture whose sign flips with the stance matchup: the rear
 * straight comes from the wrong side in an open stance (+0.40 instead of -0.60).
 */
export function guardLogit(g: GuardSpec, spec: TechniqueSpec, openStance = false): number {
  const column = guardColumnFor(spec);
  if (g.id === 'guard.philly' && column === 'straightsHead' && openStance) return 0.40;
  return g.matrix[column];
}

// ---------------------------------------------------------------------------
// §2.4.2 reactive defences
// ---------------------------------------------------------------------------

/** Outcome a successful defence produces (§2.6.1 step 6). */
export type DefenceOutcome = 'evaded' | 'blocked' | 'checked' | 'caught' | 'landed_partial';

/** Counter-window quality a successful defence creates (§2.4.2 "Counter created"). */
export type CounterQuality = 'none' | 'small' | 'medium' | 'large' | 'veryLarge' | 'tree' | 'clinch';

/** 05's `defence` enum in the StrikeImpact payload (§2.6.5 mapping table). */
export type ImpactDefence =
  'none' | 'block_glove' | 'block_forearm' | 'roll' | 'slip_late' | 'check' | 'knee_block' | 'catch';

export interface DefenceSpec {
  id: DefenceId;
  name: string;
  /** Strike classes this defence is listed against. */
  vs: readonly StrikeClass[];
  /** Classes it is explicitly bad against (07's selection policy reads this). */
  weakVs: readonly StrikeClass[];
  /** Decision -> in place, ms. Must fit the reaction window (§2.4.3). */
  execMs: number;
  /** P(works | the strike would have arrived, read succeeded, class in `vs`), T4 vs T4, MMA gloves. */
  success: number;
  /** Conditional successes named in the table ('calf', 'bodyKick', 'longRange', ...). */
  successVariants?: Readonly<Record<string, number>>;
  /** Logit per 100 points of (defender sub-skill - attacker technique sub-skill). */
  k: number;
  /** §1.2 alias of the sub-skill that drives it. */
  subSkill: string;
  outcome: DefenceOutcome;
  /** Absorb fraction handed to 05 (DP §3.3 vocabulary). 0 = nothing got through. */
  absorb: number;
  /** Share of the absorbed force that goes to the `arms` pool (05). */
  toArms?: number;
  counter: { quality: CounterQuality; bonus: number };
  /** 05's enum for this defence (§2.6.5). */
  impactDefence: ImpactDefence;
  /** Is this an evasive (head/foot movement) defence? Cage and cut-off penalties hit these. */
  evasive: boolean;
  minTier: number;
  /** Extra availability gate beyond the tier (e.g. the Philly shell). */
  requires?: 'guard.philly' | 'bladedness>=0.5';
  cost: string;
  tag: string;
}

/**
 * §2.4.2. Sources: BOX D1-D15 (boxing gloves, competent defender) and MTK §3
 * (T2 vs T2), re-anchored to MMA per MIS §2.4 ("block x0.67" = -0.90 logit) and
 * the FD accuracy matrix. Every Success value is [D] from those unless tagged.
 * No public measurement of defence success exists (§6 item 6).
 */
export const DEFENCES: readonly DefenceSpec[] = [
  {
    id: 'def.block_high', name: 'High block',
    vs: ['hook', 'overhand', 'cross', 'straight', 'elbow'],
    weakVs: ['bodyPunch', 'bodyHook', 'uppercut', 'lowKick', 'bodyKick'],
    execMs: 120, success: 0.62, successVariants: { boxing: 0.80 },
    k: 1.5, subSkill: 'boxing.guard',
    outcome: 'blocked', absorb: 0.45, toArms: 0.40,
    counter: { quality: 'small', bonus: 0.24 }, impactDefence: 'block_glove', evasive: false,
    minTier: 1,
    cost: 'Vision cost, stamina; a blocked strike that moves the head counts as landed-partial with P 0.30.',
    tag: '[D: BOX §3 D1 with MIS §2.4 block x0.67]',
  },
  {
    id: 'def.forearm_block_kick', name: 'Forearm/shin block vs kicks',
    vs: ['bodyKick', 'headKick', 'knee'],
    weakVs: ['lowKick', 'calfKick'],
    execMs: 150, success: 0.58, successVariants: { body: 0.58, head: 0.52 },
    k: 1.5, subSkill: 'kickboxing.checks',
    outcome: 'blocked', absorb: 0.65, toArms: 0.35,
    counter: { quality: 'small', bonus: 0.24 }, impactDefence: 'block_forearm', evasive: false,
    minTier: 2,
    cost: 'Cannot punch during the block; arm fatigue.',
    tag: '[S: MTK §3]',
  },
  {
    id: 'def.parry', name: 'Parry',
    vs: ['jab', 'cross', 'straight', 'bodyPunch'],
    weakVs: ['hook', 'uppercut'],
    execMs: 100, success: 0.62, k: 2.0, subSkill: 'boxing.guard',
    outcome: 'evaded', absorb: 0,
    counter: { quality: 'large', bonus: 0.70 }, impactDefence: 'none', evasive: false,
    minTier: 2,
    cost: 'Parrying a feint puts the hand off the chin: -0.40 logit for 400 ms.',
    tag: '[S: BOX §3 D2]',
  },
  {
    id: 'def.catch', name: 'Catch',
    vs: ['jab', 'uppercut'],
    weakVs: ['hook', 'overhand', 'bodyKick', 'lowKick', 'headKick', 'knee', 'elbow'],
    execMs: 90, success: 0.70, k: 1.5, subSkill: 'boxing.guard',
    outcome: 'blocked', absorb: 0.85,
    counter: { quality: 'medium', bonus: 0.50 }, impactDefence: 'catch', evasive: false,
    minTier: 2,
    cost: 'Low. The rear palm catches the jab; the opposite hand catches the uppercut.',
    tag: '[S: BOX §3 D3]',
  },
  {
    id: 'def.slip_out', name: 'Slip outside',
    vs: ['jab', 'cross', 'straight'],
    weakVs: ['hook', 'knee', 'headKick'],
    execMs: 150, success: 0.55, k: 2.5, subSkill: 'boxing.headMovement',
    outcome: 'evaded', absorb: 0,
    counter: { quality: 'veryLarge', bonus: 0.90 }, impactDefence: 'slip_late', evasive: true,
    minTier: 2,
    cost: 'On a fail the placement shifts flush +0.15 and the attacker\'s next strike gets +0.48; '
      + 'in MMA the head is off-line for a knee or head kick (+0.50 for 400 ms).',
    tag: '[S: BOX §3 D4; §8 C10, C12]',
  },
  {
    id: 'def.slip_in', name: 'Slip inside',
    vs: ['jab'],
    weakVs: ['cross', 'hook'],
    execMs: 150, success: 0.48, k: 2.5, subSkill: 'boxing.headMovement',
    outcome: 'evaded', absorb: 0,
    counter: { quality: 'large', bonus: 0.70 }, impactDefence: 'slip_late', evasive: true,
    minTier: 2,
    cost: 'Riskier than the outside slip: it walks into the cross that follows.',
    tag: '[S: BOX §3 D5]',
  },
  {
    id: 'def.roll', name: 'Roll (weave)',
    vs: ['hook', 'bodyHook', 'overhand'],
    weakVs: ['uppercut', 'knee', 'straight'],
    execMs: 220, success: 0.55, k: 2.5, subSkill: 'boxing.headMovement',
    outcome: 'evaded', absorb: 0,
    counter: { quality: 'large', bonus: 0.70 }, impactDefence: 'roll', evasive: true,
    minTier: 2,
    cost: 'Eyes off target 200 ms (read -0.5 next strike); in MMA the opponent may substitute a knee (+0.70).',
    tag: '[S: BOX §3 D6; §8 C12]',
  },
  {
    id: 'def.duck', name: 'Duck',
    vs: ['hook', 'overhand', 'straight'],
    weakVs: ['uppercut', 'knee'],
    execMs: 180, success: 0.50, k: 2.0, subSkill: 'boxing.headMovement',
    outcome: 'evaded', absorb: 0,
    counter: { quality: 'medium', bonus: 0.50 }, impactDefence: 'roll', evasive: true,
    minTier: 2,
    cost: 'Chin drops, balance forward — the uppercut and the knee are waiting.',
    tag: '[S: BOX §3 D7]',
  },
  {
    id: 'def.pull', name: 'Pull (lean back)',
    vs: ['jab', 'cross', 'straight', 'hook'],
    weakVs: ['stepIn', 'lowKick', 'calfKick'],
    execMs: 150, success: 0.58, successVariants: { long: 0.58, mid: 0.35 },
    k: 2.5, subSkill: 'boxing.headMovement',
    outcome: 'evaded', absorb: 0,
    counter: { quality: 'large', bonus: 0.90 }, impactDefence: 'slip_late', evasive: true,
    minTier: 3,
    cost: 'Weight on the rear foot; unavailable on the fence; if the attacker steps in the '
      + 'defender eats it chin-up (placement flush +0.15).',
    tag: '[S: BOX §3 D8]',
  },
  {
    id: 'def.shoulder_roll', name: 'Shoulder roll',
    vs: ['cross', 'overhand'],
    weakVs: ['hook', 'jab', 'bodyPunch'],
    execMs: 140, success: 0.60, k: 3.0, subSkill: 'boxing.headMovement',
    outcome: 'evaded', absorb: 0,
    counter: { quality: 'veryLarge', bonus: 0.90 }, impactDefence: 'roll', evasive: true,
    minTier: 3, requires: 'guard.philly',
    cost: '10-20 % of successes are glancing rather than clean; -0.85 logit in an open stance.',
    tag: '[S: BOX §3 D9; §8 C11]',
  },
  {
    id: 'def.lean_back', name: 'Lean back (sway)',
    vs: ['headKick', 'elbow', 'spinning', 'teep'],
    weakVs: ['stepIn', 'lowKick'],
    execMs: 200, success: 0.45, k: 2.0, subSkill: 'boxing.headMovement',
    outcome: 'evaded', absorb: 0,
    counter: { quality: 'large', bonus: 0.70 }, impactDefence: 'slip_late', evasive: true,
    minTier: 2,
    cost: 'Over-lean falls or eats the follow-up; on a fail a head kick still lands at 0.6 x force. '
      + 'The kicker loses 10 balance and the back is exposed for 400 ms.',
    tag: '[S: MTK §3]',
  },
  {
    id: 'def.check', name: 'Check',
    vs: ['lowKick', 'calfKick'],
    weakVs: ['bodyKick', 'headKick'],
    // 180 ms for a thigh kick, 130 ms for a calf kick — see `defenceExecMs`.
    execMs: 180,
    success: 0.55, successVariants: { low: 0.55, calf: 0.35, body: 0.30 },
    k: 2.0, subSkill: 'kickboxing.checks',
    outcome: 'checked', absorb: 0.85,
    counter: { quality: 'medium', bonus: 0.50 }, impactDefence: 'check', evasive: false,
    minTier: 2,
    cost: 'Single-legged for 250 ms (attacker punch +0.50, takedown +0.65 to 03); a late check '
      + 'lands the kick on the knee or ankle at placement flush. The kicker takes 60 % of the '
      + 'raw force in his own shin.',
    tag: '[S: MTK §3, §8.12-13]',
  },
  {
    id: 'def.knee_raise_block', name: 'Knee-raise block',
    vs: ['bodyKick', 'knee', 'lowKick'],
    weakVs: ['jab', 'cross', 'hook'],
    execMs: 180, success: 0.45, successVariants: { body: 0.45, low: 0.50 },
    k: 2.0, subSkill: 'kickboxing.checks',
    outcome: 'blocked', absorb: 0.70,
    counter: { quality: 'small', bonus: 0.24 }, impactDefence: 'knee_block', evasive: false,
    minTier: 2,
    cost: 'As the check but slower to return; the kicker takes 40 % shin/foot self-damage.',
    tag: '[S: MTK §3]',
  },
  {
    id: 'def.kick_catch', name: 'Kick catch',
    vs: ['bodyKick', 'teep', 'knee', 'headKick'],
    weakVs: ['lowKick', 'calfKick'],
    execMs: 200, success: 0.28,
    successVariants: { bodyKick: 0.28, teep: 0.35, headKick: 0.10, knee: 0.25 },
    k: 3.0, subSkill: 'kickboxing.catches',
    outcome: 'caught', absorb: 0.60,
    counter: { quality: 'tree', bonus: 0 }, impactDefence: 'catch', evasive: false,
    minTier: 1,
    cost: 'On a fail the guard is low and the kicker\'s follow-up punch gets +0.50. A caught body '
      + 'kick still delivers absorb 0.4 to the body.',
    tag: '[S: MTK §3: 0.30 T2 / 0.45 T4-vs-T2 / 0.10 vs T4 -> k = 3.0 D]',
  },
  {
    id: 'def.teep_jam', name: 'Teep jam',
    vs: ['bodyKick', 'headKick', 'knee', 'spinning'],
    weakVs: ['jab', 'cross', 'hook'],
    execMs: 250, success: 0.40, k: 2.5, subSkill: 'kickboxing.teep',
    outcome: 'evaded', absorb: 0,
    counter: { quality: 'medium', bonus: 0.50 }, impactDefence: 'none', evasive: false,
    minTier: 2,
    cost: 'Needs a read of the wind phase; if it fails both strikes land. On success the '
      + 'attacker\'s action is cancelled and they lose 10 balance.',
    tag: '[S: MTK §3, §8.7]',
  },
  {
    id: 'def.step_back', name: 'Step back',
    vs: ['jab', 'cross', 'straight', 'hook', 'uppercut', 'overhand', 'elbow', 'lowKick', 'calfKick', 'bodyKick', 'teep'],
    weakVs: ['stepIn'],
    execMs: 200, success: 0.65,
    successVariants: { punch: 0.65, lowKick: 0.50, calfKick: 0.55, bodyKick: 0.40 },
    k: 2.0, subSkill: 'boxing.footwork',
    outcome: 'evaded', absorb: 0,
    counter: { quality: 'small', bonus: 0.24 }, impactDefence: 'none', evasive: true,
    minTier: 2,
    cost: 'Gives ground (06 judging); fails outright inside state.cutoff; unavailable on the fence.',
    tag: '[S: BOX §3 D13; MTK §3]',
  },
  {
    id: 'def.step_off', name: 'Step off (pivot / L-step)',
    vs: ['cross', 'straight', 'overhand', 'stepIn', 'spinning', 'knee', 'teep'],
    weakVs: [],
    execMs: 300, success: 0.60, k: 2.5, subSkill: 'boxing.footwork',
    outcome: 'evaded', absorb: 0,
    counter: { quality: 'large', bonus: 0.70 }, impactDefence: 'none', evasive: true,
    minTier: 3,
    cost: 'Needs space: -1.0 logit on the fence. On success the attacker is left at an angle.',
    tag: '[S: BOX §3 D14]',
  },
  {
    id: 'def.step_in_smother', name: 'Step in and smother',
    vs: ['bodyKick', 'headKick', 'lowKick', 'spinning', 'hook'],
    weakVs: ['knee', 'elbow'],
    execMs: 200, success: 0.45, k: 2.0, subSkill: 'striking.cageCraft',
    // The kick still lands, on the thigh or upper body, with no arc behind it.
    outcome: 'landed_partial', absorb: 0.60,
    counter: { quality: 'clinch', bonus: 0.50 }, impactDefence: 'none', evasive: false,
    minTier: 2,
    cost: 'Exposes to knees and elbows on the way in; ends in range.close or a clinch (03).',
    tag: '[S: MTK §3]',
  },
  {
    id: 'def.frame', name: 'Frame (stiff-arm)',
    vs: ['stepIn', 'overhand', 'elbow', 'knee'],
    weakVs: ['uppercut', 'hook'],
    execMs: 150, success: 0.55, k: 1.5, subSkill: 'boxing.guard',
    outcome: 'evaded', absorb: 0,
    counter: { quality: 'medium', bonus: 0.50 }, impactDefence: 'none', evasive: false,
    minTier: 3,
    cost: 'Lead hand unavailable; boxing referees may call holding (06).',
    tag: '[S: BOX §3 D10]',
  },
  {
    id: 'def.clinch_up', name: 'Clinch up',
    vs: ['hook', 'uppercut', 'elbow', 'bodyHook', 'straight'],
    weakVs: ['knee'],
    execMs: 300, success: 0.60, k: 2.0, subSkill: 'muayThai.clinch',
    outcome: 'evaded', absorb: 0,
    counter: { quality: 'none', bonus: 0 }, impactDefence: 'none', evasive: false,
    minTier: 2,
    cost: 'Short punches and uppercuts land during the 300 ms at +0.30. '
      + 'TODO(chapter 03): once locked, the clinch graph owns the exchange.',
    tag: '[S: BOX §3 D15; MTK §4]',
  },
  {
    id: 'def.parry_down_teep', name: 'Parry down (vs teep)',
    vs: ['teep'],
    weakVs: ['bodyKick', 'headKick', 'lowKick'],
    execMs: 150, success: 0.55, k: 2.0, subSkill: 'kickboxing.teep',
    outcome: 'evaded', absorb: 0,
    counter: { quality: 'medium', bonus: 0.50 }, impactDefence: 'none', evasive: false,
    minTier: 2,
    cost: 'Low. The kicker is turned and loses 5 balance.',
    tag: '[S: MTK §3]',
  },
  {
    id: 'def.elbow_tuck', name: 'Elbow tuck',
    vs: ['bodyPunch', 'bodyHook', 'knee'],
    weakVs: ['hook', 'straight', 'uppercut'],
    execMs: 100, success: 0.55, k: 1.5, subSkill: 'boxing.guard',
    outcome: 'blocked', absorb: 0.60, toArms: 1.0,
    counter: { quality: 'small', bonus: 0.24 }, impactDefence: 'block_forearm', evasive: false,
    minTier: 2,
    cost: 'The head guard opens: head strikes +0.30 for 300 ms.',
    tag: '[E]',
  },
  {
    id: 'def.duck_under', name: 'Duck under (MMA)',
    vs: ['headKick', 'knee'],
    weakVs: ['knee', 'uppercut'],
    execMs: 250, success: 0.40, k: 2.0, subSkill: 'mma.levelChangeDefence',
    outcome: 'evaded', absorb: 0,
    // On success it is a takedown entry with +0.60 — 03 owns what happens next.
    counter: { quality: 'large', bonus: 0.60 }, impactDefence: 'none', evasive: true,
    minTier: 3,
    cost: 'Failing against a knee means placement flush and unseen (x1.5 damage).',
    tag: '[S: MTK §3]',
  },
  {
    id: 'def.knee_intercept', name: 'Intercepting knee (as a defence)',
    vs: ['bodyPunch', 'levelChange'],
    weakVs: ['hook', 'overhand'],
    // The knee itself is tech.knee_intercepting; as a defence it is the choice
    // to meet a level change or a body punch with the knee rather than block.
    execMs: 300, success: 0.55, k: 2.5, subSkill: 'mma.levelChangeDefence',
    outcome: 'evaded', absorb: 0,
    counter: { quality: 'large', bonus: 0.60 }, impactDefence: 'none', evasive: false,
    minTier: 3,
    cost: 'Committing a leg: if the read was wrong the defender is on one leg for the takedown.',
    tag: '[S: MIS I-6; MTK §8.18]',
  },
  {
    id: 'def.sprawl_posture', name: 'Sprawl posture',
    vs: ['levelChange'],
    weakVs: ['uppercut', 'knee', 'overhand'],
    execMs: 150,
    // Owned by 03. TODO(chapter 03): read the takedown-defence table instead.
    success: 0, k: 0, subSkill: 'wrestling.takedownDefence',
    outcome: 'evaded', absorb: 0,
    counter: { quality: 'none', bonus: 0 }, impactDefence: 'none', evasive: false,
    minTier: 1,
    cost: 'Hands drop: head strikes +0.50 for 400 ms (state.sprawl_ready).',
    tag: '[S: MIS I-6]',
  },
  {
    id: 'def.flinch', name: 'Flinch',
    // The reflex that fires when nothing else fits: no read, no choice.
    vs: ['jab', 'cross', 'straight', 'bodyPunch', 'hook', 'bodyHook', 'uppercut', 'overhand',
      'elbow', 'knee', 'teep', 'lowKick', 'calfKick', 'bodyKick', 'headKick', 'spinning'],
    weakVs: [],
    execMs: 100,
    // def.block_high at -1.6 logit: sigmoid(logit(0.62) - 1.6) = 0.25.
    success: 0.25, k: 0.5, subSkill: 'boxing.guard',
    outcome: 'blocked', absorb: 0.30,
    counter: { quality: 'none', bonus: 0 }, impactDefence: 'block_glove', evasive: false,
    minTier: 0,
    cost: 'T0-T1 flinch = eyes closed (§3 novice tells): read fails, defence -0.60 logit.',
    tag: '[D: def.block_high at -1.6 logit]',
  },
];

const DEFENCE_BY_ID = new Map<DefenceId, DefenceSpec>(DEFENCES.map((d) => [d.id, d]));

DEFENCE_IDS.addAll(DEFENCES.map((d) => d.id));

export function defence(id: DefenceId): DefenceSpec {
  const d = DEFENCE_BY_ID.get(id);
  if (!d) throw new Error(`Unknown defence: ${id}`);
  return d;
}

export function hasDefence(id: DefenceId): boolean {
  return DEFENCE_BY_ID.has(id);
}

/** Defences listed against at least one of the technique's classes. */
export function defencesAgainst(spec: TechniqueSpec): readonly DefenceSpec[] {
  const classes = strikeClasses(spec);
  return DEFENCES.filter((d) => d.vs.some((c) => classes.includes(c)));
}

/**
 * The success base to use for this technique: the table's variants first
 * (`def.check` vs a calf kick is 0.35, not 0.55), then the flat base.
 */
export function defenceSuccessFor(d: DefenceSpec, spec: TechniqueSpec): number {
  const v = d.successVariants;
  if (!v) return d.success;
  const classes = strikeClasses(spec);
  for (const key of ['calf', 'calfKick', 'headKick', 'head', 'bodyKick', 'body', 'teep', 'knee', 'lowKick', 'low'] as const) {
    if (v[key] === undefined) continue;
    const matches =
      (key === 'calf' || key === 'calfKick') ? classes.includes('calfKick')
        : (key === 'head' || key === 'headKick') ? classes.includes('headKick')
          : (key === 'body') ? (classes.includes('bodyKick') || spec.targets[0] === 'body')
            : (key === 'bodyKick') ? classes.includes('bodyKick')
              : (key === 'teep') ? classes.includes('teep')
                : (key === 'knee') ? classes.includes('knee')
                  : classes.includes('lowKick');
    if (matches) return v[key];
  }
  if (v.punch !== undefined && (spec.weapon === 'fist' || spec.weapon === 'backfist')) return v.punch;
  return d.success;
}

/** `def.check` needs only 130 ms against a calf kick — it is a shorter window. */
export function defenceExecMs(d: DefenceSpec, spec: TechniqueSpec): number {
  if (d.id === 'def.check' && strikeClasses(spec).includes('calfKick')) return 130;
  return d.execMs;
}

// ---------------------------------------------------------------------------
// §2.4.3 reaction, anticipation and the read roll
// ---------------------------------------------------------------------------

export const REACT = Object.freeze({
  /** Choice cost on top of simple RT. A placeholder: no transferable measurement exists. */
  choiceMs: 60,
  fatigueMult: 0.15,
  rockedMult: 1.15,
  /** Per tier below T2, on the *choice* cost only — decision, not reflex. */
  noviceAddMsPerTier: 30,
  visionBlockedMs: 80,
  stanceUnfamiliarMult: 1.10,
});

export interface LatencyInput {
  /** 01 §2.2.1 `reactionTimeMs` = 225 - 0.65 x (reactionTime - 50). NOT tier-scaled. */
  reactionTimeMs: number;
  /** Striking tier — enters the *choice* cost only, below T2. */
  tier: number;
  fatigue: number;
  rocked?: boolean;
  visionBlocked?: boolean;
  /** §2.7: below the familiarity threshold, latency x1.10. */
  stanceUnfamiliar?: boolean;
}

/**
 * Effective latency `L = RT_simple + choice + modifiers` (§2.4.3).
 *
 * The tier term deliberately touches only the choice cost: simple reaction time
 * does not separate tiers [S: LB §4.2 Mori 2002; 01 `beh.gen.simple_rt_untiered`].
 * Everything that makes an expert faster lives in the *read*, below.
 */
export function reactionLatencyMs(input: LatencyInput): number {
  const noviceAdd = input.tier < 2 ? (2 - input.tier) * REACT.noviceAddMsPerTier : 0;
  let l = input.reactionTimeMs + REACT.choiceMs + noviceAdd;
  if (input.visionBlocked) l += REACT.visionBlockedMs;
  l *= 1 + REACT.fatigueMult * clamp01(input.fatigue);
  if (input.rocked) l *= REACT.rockedMult;
  if (input.stanceUnfamiliar) l *= REACT.stanceUnfamiliarMult;
  return l;
}

export const READ = Object.freeze({
  telegraphSlope: 0.004,
  fatigueLogit: -0.50,
  visionBlockedLogit: -0.40,
  leadBaseMs: 80,
  leadTelegraphFrac: 0.6,
  patternOnBeat: 0.30,
  patternRepeat3: 0.60,
  patternHabit: 0.40,
  afterBite: -0.60,
  noviceDefaultBlockP: 0.80,
});

/**
 * Reference `readBase` per tier — 01 `readP_dom` at tier-midpoint skills. The
 * engine uses 01's composite; this table exists so a fighter without 01 data
 * (tests, calibration stubs) still behaves plausibly.
 */
export const READ_BASE_BY_TIER: readonly number[] = [0.50, 0.58, 0.66, 0.74, 0.81, 0.87];

/** Under pressure the read degrades, and it degrades most for novices. */
export const HURT_PENALTY_BY_TIER: readonly number[] = [0.65, 0.65, 0.40, 0.40, 0.20, 0.20];

export interface PatternReadInput {
  /** 01 `readP_dom`, or `READ_BASE_BY_TIER[tier]`. Tier-scaled. */
  readP: number;
  /** Attacker has been on-beat for >= 4 actions. */
  attackerOnBeat?: boolean;
  /** Attacker has thrown the same strike >= 3 times this round without variation. */
  attackerRepeated?: boolean;
  /** 07's opponent model has a recorded habitual entry. */
  habitualEntry?: boolean;
  /** The defender bit a feint within the last 0.4 s. */
  afterFeintBite?: boolean;
}

/** §2.4.3 read 1 — before launch. Success lets the defender pre-commit (no latency). */
export function patternReadP(input: PatternReadInput): number {
  let l = logit(input.readP);
  if (input.attackerOnBeat) l += READ.patternOnBeat;
  if (input.attackerRepeated) l += READ.patternRepeat3;
  if (input.habitualEntry) l += READ.patternHabit;
  if (input.afterFeintBite) l += READ.afterBite;
  return sigmoid(l);
}

export interface CueReadInput {
  /** 01 §2.7.6 `readP_striking` — skill and fightIQ are already inside it. */
  readP: number;
  telegraphMs: number;
  fatigue: number;
  /** Suppressed to 0 after a feint bite (reaction only). */
  feintSuppression?: number;
  /** `HURT_PENALTY_BY_TIER[tier]` when under pressure, rocked, or composure < 40. */
  hurtPenalty?: number;
  visionBlocked?: boolean;
  /** The Dutch gate lowers the read of the kick by 0.15 *probability* (§2.3.1 rule 6). */
  absoluteReadDelta?: number;
}

/** §2.4.3 read 2 — at launch + telegraph. */
export function cueReadP(input: CueReadInput): number {
  const l = logit(input.readP)
    + READ.telegraphSlope * input.telegraphMs
    - (input.feintSuppression ?? 0)
    + READ.fatigueLogit * clamp01(input.fatigue)
    - (input.hurtPenalty ?? 0)
    + (input.visionBlocked ? READ.visionBlockedLogit : 0);
  return clamp01(sigmoid(l) + (input.absoluteReadDelta ?? 0));
}

/** Anticipation lead in ms: experts pick the cue up 50-100 ms earlier. */
export function anticipationLeadMs(telegraphMs: number): number {
  return READ.leadBaseMs + READ.leadTelegraphFrac * telegraphMs;
}

/**
 * The window a reactive defence must fit into (§2.4.3):
 *
 *   window = startup + active/2 + telegraph - (L - A)
 *
 * Worked example from the chapter: a jab (startup 130, telegraph 0) against a
 * T4 with reactionTime 50 gives `130 + 30 + 0 - (285 - 80) = -45` ms — nothing
 * fits, and the jab is resolved against posture alone. The same defender
 * against a T1 cross (startup 265, telegraph 160) gets 264 ms and may parry,
 * slip, pull, catch, block or shoulder-roll.
 */
export function defenceWindowMs(spec: TechniqueSpec, latencyMs: number, leadMs: number): number {
  return spec.startupMs + spec.activeMs / 2 + spec.telegraph - (latencyMs - leadMs);
}

export interface AvailabilityInput {
  spec: TechniqueSpec;
  windowMs: number;
  tier: number;
  /** Ids the fighter may not use right now (fence, cut-off, guard requirements). */
  unavailable?: readonly DefenceId[];
}

/**
 * Reactive defences that both fit the window and are listed against the strike.
 * When this comes back empty only the posture and `def.flinch` apply.
 */
export function availableDefences(input: AvailabilityInput): readonly DefenceSpec[] {
  const blocked = new Set(input.unavailable ?? []);
  return defencesAgainst(input.spec).filter((d) =>
    !blocked.has(d.id)
    && d.minTier <= input.tier
    && defenceExecMs(d, input.spec) <= input.windowMs);
}

/**
 * 07's default selection policy (§2.4.3): highest `Success x counterValue`,
 * except that T0-T1 pick the block 80 % of the time regardless — a beginner's
 * automatic response is defence-shaped [S: LB §4.4]. The 0.80 draw itself
 * belongs to 07's `u_select`; this function only expresses the ordering.
 */
export function rankDefences(
  candidates: readonly DefenceSpec[],
  spec: TechniqueSpec,
): readonly DefenceSpec[] {
  return [...candidates].sort((a, b) => {
    const score = (d: DefenceSpec): number =>
      defenceSuccessFor(d, spec) * (1 + d.counter.bonus);
    const diff = score(b) - score(a);
    // Ties break by id — plain code-unit order, never localeCompare, whose ICU
    // collation can differ between machines (audit C2).
    return diff !== 0 ? diff : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}

/** 01 §2.7.6 `counterOnReadP`: the chance a read becomes a counter, not a defence. */
export function counterOnReadP(boxingCounters: number): number {
  return 0.05 + 0.45 * clamp01((boxingCounters - 10) / 80);
}

/** 01 §2.7.6 `feintBiteP` — falls with the defender's striking skill. */
export function feintBiteP(defenderStrikingSkill: number): number {
  return 0.62 - 0.40 * clamp01(defenderStrikingSkill / 100);
}

// ---------------------------------------------------------------------------
// passive posture roll (§2.6.1 step 6)
// ---------------------------------------------------------------------------

export const PASSIVE = Object.freeze({
  /** P(the guard stops it) when no reactive defence fired at all. */
  base: 0.20,
  k: 0.8,
  absorb: 0.45,
});

/**
 * `P_pass = sigmoid(logit(0.20) + guard.passive[family] + 0.8 x (guard - 50)/100)`.
 * This is the floor of the defence model: the strike nobody saw still has to get
 * through the arms that happen to be in front of the face.
 */
export function passiveBlockP(g: GuardSpec, spec: TechniqueSpec, guardSkill: number, extraLogit = 0): number {
  // A posture that defends a line also catches more of it passively, so the
  // guard matrix enters with its sign flipped (negative = defended).
  const postureTerm = g.passiveLogit - guardLogit(g, spec);
  return sigmoid(logit(PASSIVE.base) + postureTerm + PASSIVE.k * (guardSkill - 50) / 100 + extraLogit);
}

// ---------------------------------------------------------------------------

export function sigmoid(x: number): number {
  // 09 §2.6 asks every section to quantise the logit before the sigmoid so the
  // Node and browser digests cannot diverge by one ulp.
  const q = Math.round(x * 1e9) / 1e9;
  return 1 / (1 + Math.exp(-q));
}

export function logit(p: number): number {
  const c = Math.min(Math.max(p, 1e-9), 1 - 1e-9);
  return Math.log(c / (1 - c));
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
