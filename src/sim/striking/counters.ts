/**
 * COUNTERS — chapter 02 §2.5.
 *
 * Every strike opens a window on the attacker keyed to its *recovery*, and how
 * long that window stays open depends on what happened to the strike: a whiffed
 * kick leaves the attacker re-planting for `recovery x 1.2`, a landed punch for
 * only `recovery x 0.4`. Missing is punished more than landing — which is the
 * whole reason a counter-puncher can beat a volume puncher without throwing
 * first. Elite exchange initiations split roughly one third lead, one third
 * counter, one third defensive [S: LB §5.10], so counters are first-class here,
 * not an afterthought.
 */
import type { DefenceId, TechniqueId } from '../core/ids';
import { hasTechnique, type TechniqueSpec } from './catalogue';
import type { StrikeClass } from './defence';

// ---------------------------------------------------------------------------
// §2.5.1 counter windows
// ---------------------------------------------------------------------------

/** How the attacker's strike ended — the key to the window table. */
export type StrikeOutcomeForWindow = 'missed' | 'checked' | 'blocked' | 'landed' | 'caught' | 'evaded';

export interface CounterWindow {
  /** Window length in ms, measured from the end of the contact phase. */
  ms: number;
  /** Logit on the attacker's *read* while the window is open. */
  attackerReadLogit: number;
  /** Logit on the attacker's defence success while the window is open. */
  attackerDefenceLogit: number;
  /** Logit for the defender's strikes to the side the attacker's limb left from. */
  handAwayLogit: number;
  /** Balance the attacker lost. */
  attackerBalance: number;
}

export const CTR = Object.freeze({
  windowMissed: 1.0,
  windowChecked: 1.2,
  windowBlocked: 0.6,
  windowLanded: 0.4,
  readPenaltyMissed: -0.50,
  readPenaltyBlocked: -0.30,
  readPenaltyLanded: -0.15,
  /** A missed *kick* costs 30 % of all defence success. */
  kickMissDefence: -0.60,
  /** A landed kick costs 10 %. */
  kickLandDefence: -0.20,
  handAway: 0.30,
  bestBonus: 0.70,
  otherBonus: 0.24,
  /** `boxing.counters` realises the bonus: T2 ~60 %, T5 ~120 % of it. */
  skillK: 2.0,
  simulCancelP: 0.50,
  simulForceMult: 0.5,
  preemptStraight: 0.50,
  habitualN: 2,
  delayedBonus: 0.70,
  /** Closing-speed constants chosen to reproduce BOX's x1.25 / x1.5 (§2.6.4). */
  kClose: 1.6,
  stepInSpeedMs: 1.5,
  lungeSpeedMs: 2.5,
  hitOnBreak: 1.0,
  /** T0/T1 skip the return to stance: the window doubles / x1.5. */
  noReturnWindowMult: [2.0, 1.5, 1.0, 1.0, 1.0, 1.0] as readonly number[],
});

/**
 * §2.5.1. `recoveryMs` comes from the catalogue; the attacker's tier scales the
 * window because T0-T1 do not return to their stance after a kick.
 */
export function counterWindow(
  spec: TechniqueSpec,
  outcome: StrikeOutcomeForWindow,
  attackerTier = 4,
): CounterWindow {
  const isKick = spec.family === 'lowKick' || spec.family === 'bodyKick'
    || spec.family === 'headKick' || spec.family === 'teep' || spec.family === 'spinning';
  const tierMult = isKick ? CTR.noReturnWindowMult[clampTier(attackerTier)] : 1;

  let fraction: number;
  let readLogit: number;
  let defenceLogit = 0;
  let balance = 0;
  switch (outcome) {
    case 'missed':
    case 'evaded':
      fraction = CTR.windowMissed;
      readLogit = CTR.readPenaltyMissed;
      if (isKick) { defenceLogit = CTR.kickMissDefence; balance = -5; }
      break;
    case 'checked':
      fraction = CTR.windowChecked;
      readLogit = CTR.readPenaltyMissed;
      defenceLogit = CTR.kickMissDefence;
      balance = -10;
      break;
    case 'blocked':
    case 'caught':
      fraction = CTR.windowBlocked;
      readLogit = CTR.readPenaltyBlocked;
      break;
    default:
      fraction = CTR.windowLanded;
      readLogit = CTR.readPenaltyLanded;
      if (isKick) defenceLogit = CTR.kickLandDefence;
      break;
  }
  return {
    ms: spec.counterWindowMs * fraction * tierMult,
    attackerReadLogit: readLogit,
    attackerDefenceLogit: defenceLogit,
    handAwayLogit: CTR.handAway,
    attackerBalance: balance,
  };
}

/**
 * The logit a counter actually gets. The table bonus is the ceiling; a fighter
 * realises it in proportion to `boxing.counters` (k = 2.0 per 100 points), so a
 * T2 counter-puncher banks ~60 % of it and a T5 ~120 %.
 */
export function realisedCounterBonus(tableBonus: number, boxingCounters: number, guardCounterMult = 1): number {
  const realisation = 1 + CTR.skillK * (boxingCounters - 50) / 100;
  return tableBonus * Math.max(0, realisation) * guardCounterMult;
}

/** Any strike inside the window that is not the listed best counter. */
export function genericCounterBonus(boxingCounters: number): number {
  return realisedCounterBonus(CTR.otherBonus, boxingCounters);
}

// ---------------------------------------------------------------------------
// §2.5.2 counter matrix
// ---------------------------------------------------------------------------

export type CounterId = string;

export interface CounterSpec {
  id: CounterId;
  /** Technique ids that trigger it, and/or strike classes. */
  triggerTech: readonly TechniqueId[];
  triggerClasses: readonly StrikeClass[];
  /** The defence that sets it up, if any. */
  defence: DefenceId | null;
  /** The counter strike. null when another chapter owns the follow-up. */
  counterTech: TechniqueId | null;
  /** Logit bonus from the table (before `realisedCounterBonus`). */
  bonus: number;
  /** Some entries replace the base P_land outright instead of adding a logit. */
  flatPLand?: number;
  /** Force multiplier from closing speed, where the table names one. */
  forceMult?: number;
  minTier: number;
  /** Resolves before the incoming strike when its contact time is earlier. */
  simultaneous: boolean;
  /** Thrown into the wind-up, before the trigger strike is committed. */
  preemptive: boolean;
  /** True when the follow-up belongs to another chapter (03 takedowns). */
  handedOff: 'grappling' | null;
  note: string;
  tag: string;
}

function ctr(
  id: string,
  triggerTech: readonly TechniqueId[],
  triggerClasses: readonly StrikeClass[],
  defenceId: DefenceId | null,
  counterTech: TechniqueId | null,
  bonus: number,
  minTier: number,
  note: string,
  tag: string,
  extra: Partial<CounterSpec> = {},
): CounterSpec {
  return {
    id, triggerTech, triggerClasses, defence: defenceId, counterTech, bonus, minTier,
    simultaneous: false, preemptive: false, handedOff: null, note, tag, ...extra,
  };
}

/**
 * §2.5.2. 34 rows: 33 owned by this chapter plus `ctr.level_change_double`,
 * whose payoff is a takedown and therefore belongs to 03 (`handedOff`).
 */
export const COUNTERS: readonly CounterSpec[] = [
  ctr('ctr.counter_jab', ['tech.jab'], ['jab'], null, 'tech.jab', 0.50, 1,
    'Intercept the jab with a jab: whoever is first owns the exchange.',
    '[S: BOX §3 counters]', { simultaneous: true }),
  ctr('ctr.catch_jab', ['tech.jab'], ['jab'], 'def.catch', 'tech.jab', 0.50, 2,
    'Catch, then jab or cross back.', '[S: BOX §5 counter chains]'),
  ctr('ctr.parry_cross', ['tech.jab'], ['jab'], 'def.parry', 'tech.cross', 0.70, 2,
    'Parry down, cross over the top.', '[S: BOX §3 "7 easy counters"]'),
  ctr('ctr.slip_cross', ['tech.jab'], ['jab'], 'def.slip_out', 'tech.cross', 0.90, 2,
    'Slip outside the jab and cross.', '[S: BOX §3 D4]'),
  ctr('ctr.slip_in_body', ['tech.jab'], ['jab'], 'def.slip_in', 'tech.cross_body', 0.70, 2,
    'Slip inside, cross to the body.', '[S: BOX §5]'),
  ctr('ctr.slip_in_hook', ['tech.jab'], ['jab'], 'def.slip_in', 'tech.hook_lead', 0.70, 3,
    'Slip inside, lead hook.', '[S: BOX §5]'),
  ctr('ctr.pull_counter', ['tech.jab', 'tech.cross', 'tech.jab_step', 'tech.cross_step'],
    ['jab', 'cross', 'stepIn'], 'def.pull', 'tech.cross', 0.90, 3,
    'Pull back so it falls short, then cross into the recovery. Closing speed applies.',
    '[S: BOX §3 D8, §8 D16]'),
  ctr('ctr.cross_counter', ['tech.cross'], ['cross'], 'def.slip_out', 'tech.hook_lead', 0.90, 2,
    'Slip the cross, lead hook over it.', '[S: BOX §2 #8]'),
  ctr('ctr.cross_simultaneous', ['tech.cross'], ['cross'], 'def.slip_out', 'tech.cross', 0.50, 3,
    'Slip and cross at the same time.', '[S: BOX §3 Ringsport]', { simultaneous: true }),
  ctr('ctr.shoulder_roll_return', ['tech.cross', 'tech.overhand'], ['cross', 'overhand'],
    'def.shoulder_roll', 'tech.cross', 0.90, 3,
    'Roll it off the shoulder and return the rear straight or uppercut. Same stance only.',
    '[S: BOX §3 D9]'),
  ctr('ctr.duck_body', ['tech.cross', 'tech.hook_lead', 'tech.hook_rear'], ['cross', 'hook'],
    'def.duck', 'tech.cross_body', 0.50, 2,
    'Duck under, cross to the body.', '[S: BOX §5]'),
  ctr('ctr.block_hook', ['tech.cross', 'tech.hook_lead', 'tech.hook_rear'], ['cross', 'hook'],
    'def.block_high', 'tech.hook_lead', 0.24, 1,
    'Hook back as the blocked hand peels away.', '[S: BOX §3 "10 counters"]'),
  ctr('ctr.inside_hook', ['tech.hook_rear', 'tech.cross'], ['hook', 'cross'],
    null, 'tech.hook_lead', 0.50, 3,
    'Lead hook inside, thrown as the rear hand leaves the chin.',
    '[S: BOX §2 #10]', { preemptive: true }),
  ctr('ctr.roll_hook', ['tech.hook_lead', 'tech.hook_rear'], ['hook'],
    'def.roll', 'tech.hook_rear', 0.70, 2,
    'Roll under the hook, hook or cross on the way up.', '[S: BOX §3 D6]'),
  ctr('ctr.straight_beats_hook', ['tech.hook_lead', 'tech.hook_rear'], ['hook'],
    null, 'tech.cross', 0.50, 2,
    'The straight beats the hook if it is thrown first — shorter path, same target.',
    '[S: BOX §2 #9]', { preemptive: true, simultaneous: true }),
  ctr('ctr.lean_back_cross', ['tech.hook_lead'], ['hook'], 'def.lean_back', 'tech.cross', 0.70, 2,
    'Sway out of the hook, cross into the follow-through.', '[S: BOX §5]'),
  ctr('ctr.check_hook', ['tech.jab_step', 'tech.cross_step', 'tech.superman_punch'], ['stepIn'],
    null, 'tech.check_hook', 0.90, 3,
    'Lead hook plus pivot against a straight-line charge; P_land 0.40 as a counter, force x1.5 '
    + 'from the closing speed.',
    '[S: BOX §2 #14, §8 D16]', { flatPLand: 0.40, forceMult: 1.5 }),
  ctr('ctr.duck_uppercut', ['tech.overhand'], ['overhand'], 'def.duck', 'tech.uppercut_rear', 0.70, 3,
    'Duck the overhand, rear uppercut into the bent-over head.', '[S: BOX §5]'),
  ctr('ctr.outside_step_hook', ['tech.overhand'], ['overhand'], 'def.step_off', 'tech.hook_lead', 0.70, 3,
    'Step off outside the lead foot, lead hook.', '[S: BOX §5]'),
  ctr('ctr.level_change_double', ['tech.overhand', 'tech.hook_rear'], ['overhand', 'hook'],
    null, null, 0.60, 2,
    'Level change into a double leg under the wide punch. TODO(chapter 03): 03 owns the takedown.',
    '[S: BOX §5; MIS I-1]', { handedOff: 'grappling' }),
  ctr('ctr.uppercut_over_top', ['tech.uppercut_lead'], ['uppercut'], null, 'tech.cross', 0.70, 2,
    'The uppercut drops the hand; cross over the top of it.', '[S: BOX §2 #11]'),
  ctr('ctr.cross_on_kick', ['tech.kick_low_rear', 'tech.kick_body_rear'], ['lowKick', 'bodyKick'],
    null, 'tech.cross', 0, 2,
    'Straight punch as the kick starts. The counter-Dutch: P_land 0.45 flat, replacing the base.',
    '[S: MTK §8.23 counter-Dutch 0.45; §2 K1]', { flatPLand: 0.45, simultaneous: true, preemptive: true }),
  ctr('ctr.return_low_kick', ['tech.kick_low_rear', 'tech.kick_low_lead', 'tech.kick_calf'],
    ['lowKick', 'calfKick'], null, 'tech.kick_low_rear', 0.50, 1,
    'Return the low kick to the planted leg, landed or checked.', '[S: MTK §2 K1]'),
  ctr('ctr.punch_on_switch', ['tech.kick_body_switch', 'tech.kick_head_switch'],
    ['bodyKick', 'headKick'], null, 'tech.cross', 0.45, 2,
    'Any punch during the 100-150 ms switch: the switch is a visible tell.',
    '[S: MTK §2 K4]', { preemptive: true }),
  ctr('ctr.teep_jam', ['tech.kick_body_rear', 'tech.kick_body_switch', 'tech.knee_flying', 'tech.kick_spinning_back'],
    ['bodyKick', 'knee', 'spinning'], 'def.teep_jam', 'tech.teep_stop', 0.50, 2,
    'Jam the wind-up with a teep: the attacker\'s action is cancelled.', '[S: MTK §3]'),
  ctr('ctr.punch_spinning_back',
    ['tech.kick_spinning_back', 'tech.elbow_spinning', 'tech.spinning_backfist', 'tech.kick_wheel'],
    ['spinning'], null, 'tech.cross', 0.60, 1,
    'Punch the exposed back while it is turned. Always unseen.', '[S: MTK E5, S1]'),
  ctr('ctr.intercepting_knee', [], ['levelChange'], null, 'tech.knee_intercepting', 0.60, 3,
    'Meet the level change with the knee; force x1.3 from the closing head.',
    '[S: MIS I-6; MTK §8.18]', { forceMult: 1.3, simultaneous: true }),
  ctr('ctr.uppercut_on_level_change', [], ['levelChange'], null, 'tech.uppercut_rear', 0.70, 2,
    'Uppercut into the dropping head, including off a sprawl-bait bite.', '[S: MIS I-6]'),
  ctr('ctr.knee_on_duck', [], [], null, 'tech.knee_straight', 0.70, 2,
    'The opponent ducks or rolls; substitute a knee for the planned punch.', '[S: BOX §8 C12]'),
  ctr('ctr.kick_catch_tree', ['tech.kick_body_rear', 'tech.teep_lead', 'tech.teep_rear', 'tech.knee_straight'],
    ['bodyKick', 'teep', 'knee'], 'def.kick_catch', null, 0, 1,
    'Catch, then the post-catch tree of §2.5.3.', '[S: MTK §3.1]'),
  ctr('ctr.smother_clinch', ['tech.kick_body_rear', 'tech.kick_head_rear', 'tech.hook_rear'],
    ['bodyKick', 'headKick', 'hook'], 'def.step_in_smother', null, 0.50, 2,
    'Smother the kick and enter the clinch. TODO(chapter 03): 03 owns what happens once locked.',
    '[S: MTK §3]'),
  ctr('ctr.frame_cross', ['tech.overhand', 'tech.jab_step', 'tech.cross_step'], ['overhand', 'stepIn'],
    'def.frame', 'tech.cross', 0.50, 2,
    'Frame the entry, cross off the frame.', '[S: BOX §3 D10]'),
  ctr('ctr.backstep_jab', ['tech.jab_step', 'tech.cross_step'], ['stepIn'],
    'def.step_back', 'tech.jab_backstep', 0.24, 2,
    'Step back out of the entry and jab on the way out.', '[S: BOX §4]'),
  ctr('ctr.hit_on_break', [], [], null, 'tech.hook_lead', 1.0, 2,
    'One short strike as the opponent breaks the clinch. TODO(chapter 03): 03 signals the break.',
    '[D: MIS I-12 +20-30 % p]'),
];

const COUNTER_BY_ID = new Map<CounterId, CounterSpec>(COUNTERS.map((c) => [c.id, c]));

export function counter(id: CounterId): CounterSpec {
  const c = COUNTER_BY_ID.get(id);
  if (!c) throw new Error(`Unknown counter: ${id}`);
  return c;
}

/** Counters this chapter resolves itself (the rest are handed to 03). */
export const OWNED_COUNTERS: readonly CounterSpec[] = COUNTERS.filter((c) => c.handedOff === null);

/**
 * Counters available against an incoming strike. `classes` comes from
 * `strikeClasses(spec)`; a counter matches on either the exact technique or one
 * of its classes.
 */
export function countersAgainst(
  spec: TechniqueSpec,
  classes: readonly StrikeClass[],
  tier: number,
): readonly CounterSpec[] {
  return COUNTERS.filter((c) =>
    c.minTier <= tier
    && (c.triggerTech.includes(spec.id) || c.triggerClasses.some((k) => classes.includes(k))));
}

/** The best counter listed for this strike after this defence, if any. */
export function bestCounterFor(
  spec: TechniqueSpec,
  classes: readonly StrikeClass[],
  defenceId: DefenceId | null,
  tier: number,
): CounterSpec | null {
  const candidates = countersAgainst(spec, classes, tier)
    .filter((c) => c.defence === defenceId)
    .sort((a, b) => (b.bonus - a.bonus) || a.id.localeCompare(b.id));
  return candidates[0] ?? null;
}

/** True when every `counterTech` and `triggerTech` names a catalogued technique. */
export function counterMatrixReferencesValid(): boolean {
  return COUNTERS.every((c) =>
    (c.counterTech === null || hasTechnique(c.counterTech))
    && c.triggerTech.every(hasTechnique));
}

// ---------------------------------------------------------------------------
// simultaneous and pre-emptive counters (§2.5.1)
// ---------------------------------------------------------------------------

export interface SimultaneousOutcome {
  /** The counter's contact is earlier, so it resolves first. */
  countersFirst: boolean;
  /** P that a landing counter cancels the incoming strike outright. */
  cancelP: number;
  /** Force multiplier applied to the incoming strike when it is not cancelled. */
  incomingForceMult: number;
}

/**
 * §2.5.1. A simultaneous counter needs a cue read and a counter whose startup
 * fits in the time left before the attacker's contact. If it lands, the incoming
 * strike is cancelled half the time and has its force halved the other half
 * (the head is displaced, so the punch arrives without the neck behind it).
 */
export function simultaneousCounter(
  counterSpec: TechniqueSpec,
  msUntilAttackerContact: number,
): SimultaneousOutcome {
  return {
    countersFirst: counterSpec.startupMs <= msUntilAttackerContact,
    cancelP: CTR.simulCancelP,
    incomingForceMult: CTR.simulForceMult,
  };
}

/** Closing-speed force multiplier: `v_rel` grows by `kClose x closingSpeed` (§2.6.4). */
export function closingForceMult(vRefMs: number, closingSpeedMs: number): number {
  return (vRefMs + CTR.kClose * Math.max(0, closingSpeedMs)) / vRefMs;
}

// ---------------------------------------------------------------------------
// §2.5.3 post-catch tree
// ---------------------------------------------------------------------------

export type KickCatchRule = 'mt' | 'kb' | 'mma';

export interface CatchTreeOption {
  id: string;
  name: string;
  /** P(success) for a T4 catcher vs a T4 kicker. */
  p: number;
  /** Conditional adjustments named in the table. */
  modifiers?: Readonly<Record<string, number>>;
  kickerOutcome: string;
  rulesets: readonly KickCatchRule[];
  /** True when the option hands control to chapter 03. */
  handsOffToGrappling: boolean;
  tag: string;
}

/**
 * §2.5.3. Ruleset gate: `mt` allows <= 2 forward steps plus shin sweeps and hip
 * dumps, `kb` allows one strike then release, `mma` allows any takedown.
 */
export const CATCH_TREE: readonly CatchTreeOption[] = [
  {
    id: 'catch.sweep_standing_leg', name: 'Sweep the standing leg', p: 0.45,
    modifiers: { afterStepAndPull: 0.15, vsT5Kicker: -0.20 },
    kickerOutcome: 'On the canvas, ~0 damage, loses the exchange (06).',
    rulesets: ['mt'], handsOffToGrappling: false, tag: '[S: MTK §3.1]',
  },
  {
    id: 'catch.pull_and_dump', name: 'Pull and dump into a strike', p: 0.40,
    modifiers: { followUpLands: 0.50 },
    kickerOutcome: 'Falls into a power strike on the way in.',
    rulesets: ['mt'], handsOffToGrappling: false, tag: '[S: MTK §3.1]',
  },
  {
    id: 'catch.knee_while_holding', name: 'Knee the body or thigh while holding', p: 0.65,
    kickerOutcome: 'Body or thigh damage.',
    rulesets: ['mt', 'kb', 'mma'], handsOffToGrappling: false, tag: '[S: MTK §3.1]',
  },
  {
    id: 'catch.punch_while_holding', name: 'Punch while holding the leg', p: 0.60,
    modifiers: { unseenP: 0.5 },
    kickerOutcome: 'Head strike, half of them unseen.',
    rulesets: ['mt', 'kb', 'mma'], handsOffToGrappling: false, tag: '[S: MTK §3.1]',
  },
  {
    id: 'catch.return_kick_standing_leg', name: 'Return kick to the standing leg', p: 0.55,
    modifiers: { fallP: 0.4, balance: -10 },
    kickerOutcome: 'Leg damage, balance -10, falls 40 % of the time.',
    rulesets: ['mt', 'mma'], handsOffToGrappling: false, tag: '[S: MTK §3.1]',
  },
  {
    id: 'catch.walk_and_dump', name: 'Walk forward and dump (<= 2 steps)', p: 0.35,
    kickerOutcome: 'Falls.',
    rulesets: ['mt'], handsOffToGrappling: false, tag: '[S: MTK §3.1]',
  },
  {
    id: 'catch.leg_takedown', name: 'Leg-catch takedown (run the pipe / trip / lift)', p: 0.55,
    kickerOutcome: 'Bottom position. TODO(chapter 03): 03 may prefer its own single-leg table +0.20.',
    rulesets: ['mma'], handsOffToGrappling: true, tag: '[S: MTK §3.1; MIS I-5 45-55 %]',
  },
  {
    id: 'catch.release', name: 'Release and reset', p: 1.0,
    kickerOutcome: 'Neutral.',
    rulesets: ['mt', 'kb', 'mma'], handsOffToGrappling: false, tag: '[S: MTK §3.1]',
  },
];

export function catchTreeFor(rule: KickCatchRule): readonly CatchTreeOption[] {
  return CATCH_TREE.filter((o) => o.rulesets.includes(rule));
}

/** Kicker escapes, rolled once per 300 ms of hold (§2.5.3). */
export const CATCH_ESCAPES = Object.freeze({
  beatMs: 300,
  /** Immediate pull-back before the grip closes. */
  pullBackT2: 0.35,
  pullBackT4: 0.55,
  hopAndFrame: 0.30,
  collarTieKneeShield: 0.30,
  strikeWhileHeldLands: 0.45,
  strikeForcesRelease: 0.25,
  reTeepFreeLeg: 0.20,
  /** Twisting aggressively makes the sweep easier for the catcher. */
  twistSweepBonus: 0.15,
  /** A caught body kick still delivers this share of its force. */
  caughtKickAbsorb: 0.4,
  /** Muay Thai: the catcher may take at most this many forward steps. */
  stepLimitMT: 2,
});

// ---------------------------------------------------------------------------
// §2.5.4 delayed counters and habitual returns (T3+)
// ---------------------------------------------------------------------------

export interface HabitualReturnState {
  /** The technique the opponent has been returning with. */
  returnTech: TechniqueId | null;
  /** How many times in a row. */
  repeats: number;
}

/**
 * §2.5.4. A T3+ fighter who has seen the same return twice moves the head to
 * where it is going to be: the return misses automatically and the follow-up
 * gets +0.70. This is the "Duran" mechanic — punishment for being readable, and
 * the symmetric partner of §2.3.5's readable-rhythm bonus.
 */
export function delayedCounter(
  state: HabitualReturnState,
  tier: number,
): { armed: boolean; returnAutoMisses: boolean; followUpLogit: number } {
  const armed = tier >= 3 && state.returnTech !== null && state.repeats >= CTR.habitualN;
  return { armed, returnAutoMisses: armed, followUpLogit: armed ? CTR.delayedBonus : 0 };
}

// ---------------------------------------------------------------------------

function clampTier(t: number): number {
  return t < 0 ? 0 : t > 5 ? 5 : Math.floor(t);
}
