/**
 * STANDING TECHNIQUE CATALOGUE — chapter 02 §2.2 (Tables A and B) as data.
 *
 * 54 techniques: 27 punches (§2.2.1), 8 elbows/knees and 19 kicks/teeps
 * (§2.2.2), with the force inputs, follow-up chains and "beaten by" defence
 * lists of §2.2.3 merged into one row per technique. Nothing in this file is
 * invented: every number is the chapter's, and the `tag` field carries the
 * chapter's own provenance tag (00_CONVENTIONS §1 — a number with no tag is a
 * bug).
 *
 * Timing vocabulary (09 §2.2 owns the field names):
 *   startupMs  launch -> impact          (chapter 02 "Startup")
 *   activeMs   uncancelable impact phase (chapter 02 "Contact")
 *   recoveryMs impact -> guard restored  (chapter 02 "Recovery")
 *   contactMs  commit -> contact instant, absolute; contact lands at the end of
 *              startup, so contactMs === startupMs and always sits inside
 *              [startupMs, startupMs + activeMs] (09 §2.2 `T_c = T_commit + contactMs`)
 *   totalMs    startupMs + activeMs + recoveryMs
 *
 * All timings are T4 execution; the tier multipliers of §3 are applied by the
 * caller (`execTimeMultFor`), never baked in here.
 *
 * `effectiveMassKg` is the chapter's `m_eff` fraction expressed at the
 * REFERENCE_MASS_KG fighter, so the source keeps the chapter's fraction visible
 * (`effMass(0.038)`) while consumers get kilograms. For a fighter of mass m the
 * effective mass is `effectiveMassKg x (m / REFERENCE_MASS_KG) x commitMult`
 * (§2.6.4), which is algebraically the chapter's `m_eff_frac x massKg`.
 *
 * `rotationalFactor` is the `rot` column and is INFORMATIONAL ONLY: the REVIEW
 * note in §2.6.4 moved the rotational term to 05 `ko.kWeapon`, and the
 * StrikeImpact payload deliberately carries no `rot` field. It is kept here
 * because the catalogue is also the design document's mirror.
 */
import { TECHNIQUE_IDS, type DefenceId, type TechniqueId } from '../core/ids';

// ---------------------------------------------------------------------------
// vocabulary
// ---------------------------------------------------------------------------

/** Striking surface. Union of 02 §2.2.3 and the 05 enum in §2.6.5. */
export type Weapon =
  | 'fist' | 'backfist' | 'hammerfist' | 'elbow' | 'elbow_point' | 'knee'
  | 'shin' | 'instep' | 'ball_of_foot' | 'heel' | 'shin_on_knee' | 'head' | 'mat';

/** Damage region (05 §2.3 / events.ts `detail.target`). */
export type TargetRegion = 'head' | 'body' | 'leadLeg' | 'rearLeg' | 'arms';

/** Range bands, §2.1.1. Ordered out -> in so band arithmetic is monotone. */
export type RangeBand = 'out' | 'kick' | 'long' | 'mid' | 'close' | 'clinch';

/** Band order used for the "one band out" range-fit rule (§2.1.1). */
export const BAND_ORDER: readonly RangeBand[] = ['out', 'kick', 'long', 'mid', 'close', 'clinch'];

/**
 * Mechanical family. Drives: the guard matrix column (§2.4.1), the placement
 * and sub-location weight tables (§2.6.3), the force tier/fatigue multipliers
 * (§2.6.4) and the defence "vs" lists (§2.4.2).
 */
export type TechniqueFamily =
  | 'straight' | 'hook' | 'uppercut' | 'overhand' | 'elbow' | 'knee'
  | 'teep' | 'lowKick' | 'bodyKick' | 'headKick' | 'spinning';

/** Which limb throws it — the flow rule of §2.3.1 alternates these. */
export type Limb = 'leadHand' | 'rearHand' | 'leadLeg' | 'rearLeg' | 'both';

/** Guard-exposure class of the commitment column (§2.2 "Commit"). */
export type CommitClass = 'L' | 'L-M' | 'M' | 'M-H' | 'H';

/** §1.2 sub-skill alias that governs this technique's accuracy and quality. */
export type SkillAlias =
  | 'boxing.jab' | 'boxing.power' | 'boxing.bodyWork'
  | 'kickboxing.roundKick' | 'kickboxing.teep' | 'kickboxing.spinning'
  | 'muayThai.elbows' | 'muayThai.knees';

export type TechniqueFlag =
  /** Optional technique: available, but never part of a default AI mix (§2.2). */
  | 'optional'
  /** Back is turned during startup: §2.2.4 spin rule (+0.60 logit, unseen, to the defender). */
  | 'spinning'
  /** Switch step before the kick: §2.2.4 switch tell (defender punch +0.45, teep-jam 0.40). */
  | 'switchStep'
  /** Step-through shift: force x1.15, own defence -0.50 logit for 400 ms (§2.1.5 `move.shift`). */
  | 'shift'
  /** Closes a band with a step (§2.1.1 `stepGain` 0.30-0.50 m). */
  | 'stepIn'
  /** Only selectable as a counter / interception (§2.5). */
  | 'counterOnly'
  /** Pushes the target back a band (§2.2.4 teeps). */
  | 'pushback'
  /** Second strike of a two-beat technique has its own P_land (§2.2.1 double jab). */
  | 'twoBeat'
  /** Touch outcome sets `state.vision_blocked` for 300 ms (§2.2.4 flicker). */
  | 'visionBlocker'
  /** Needs >= `p.strike.effect.qmSetupKicks` low-line kicks this bout (§2.2.4). */
  | 'setupRequired'
  /** Carries the cut channel; 05 owns P(cut) (§2.2.4). */
  | 'cutChannel'
  /** Targets `body.liver` by default (§2.2.4 liver shot). */
  | 'liverTargeted'
  /** Lands on the calf; 05 owns the dead-leg roll (§2.2.4). */
  | 'calfTargeted'
  /** Lands on the knee joint; 05 owns the acute joint roll (§2.2.4). */
  | 'kneeJointTargeted'
  /** Checked kicks emit a self-damage impact on the kicker's shin (§2.2.4). */
  | 'selfDamageOnCheck'
  // ruleset gates (§1 interface table; 06 supplies the flags)
  | 'requiresElbowsLegal' | 'requires12to6Legal' | 'requiresObliqueLegal'
  | 'requiresKneesToHeadLegal' | 'illegalUnderBoxing' | 'illegalUnderKickboxing';

export interface Commitment {
  /** Balance cost in balance points, 0-100 scale (§2.2 "Commit"). */
  balance: number;
  /** Guard exposure class while the technique runs. */
  guard: CommitClass;
}

export interface TechniqueSpec {
  id: TechniqueId;
  name: string;
  weapon: Weapon;
  /** Home bands, best first. Outside these: §2.1.1 range-fit penalties. */
  band: readonly RangeBand[];
  /** Regions the AI (07) may retarget to; the first is the default. */
  targets: readonly TargetRegion[];

  startupMs: number;
  /** Absolute commit -> contact instant (09 §2.2). Equals `startupMs`. */
  contactMs: number;
  activeMs: number;
  recoveryMs: number;

  /** Marginal P(recorded as landed) vs the reference T4 defender (§0, §2.2). */
  baseLand: number;
  /** Conditional P_land variants named in the §2.2 tables (e.g. 'close', 'counter'). */
  landVariants?: Readonly<Record<string, number>>;
  /** Readable cue before launch, ms; added to the defender's window (§2.4.3). */
  telegraph: number;
  commitment: Commitment;

  /** Median delivered force of a flush, committed, unfatigued T4 landing (N). */
  forceMedianN: number;
  /** Hard ceiling (N); the force draw is capped at `forceCapN x capOvershoot`. */
  forceCapN: number;
  /** Effective mass at REFERENCE_MASS_KG (= chapter `m_eff` fraction x 77 kg). */
  effectiveMassKg: number;
  /** Chapter `m_eff` fraction of body mass, kept verbatim (§2.2.3). */
  effMassFrac: number;
  /** Weapon speed at impact, m/s (§2.2.3 `v_ref`). */
  vRefMs: number;
  /** `rot` column — informational only; 05 `ko.kWeapon` owns rotation (§2.6.4 REVIEW). */
  rotationalFactor: number;

  followUps: readonly TechniqueId[];
  beatenBy: readonly DefenceId[];
  /**
   * Counter window opened on the attacker, ms, for the *missed* outcome
   * (`recovery x 1.0`, §2.5.1). Other outcomes scale this: checked x1.2,
   * blocked x0.6, landed x0.4 — see counters.ts `counterWindowMs()`.
   */
  counterWindowMs: number;

  family: TechniqueFamily;
  limb: Limb;
  /** Sub-skill that drives accuracy and quality (§1.2). */
  skill: SkillAlias;
  /** Lowest tier that may select it (§3 "available" rows). */
  minTier: 0 | 1 | 2 | 3 | 4 | 5;
  flags: readonly TechniqueFlag[];
  tag: string;
}

/** UFC-average fighter mass; the `m_eff` and `massMult` reference (§2.6.4). */
export const REFERENCE_MASS_KG = 77;

const effMass = (frac: number): number => frac * REFERENCE_MASS_KG;

type TechniqueInput =
  Omit<TechniqueSpec, 'contactMs' | 'effectiveMassKg' | 'counterWindowMs'>
  & { counterWindowMs?: number };

function tech(input: TechniqueInput): TechniqueSpec {
  return {
    ...input,
    // 09 §2.2: contact is scheduled at commit + contactMs, and the chapter's
    // "Startup" column IS launch -> impact, so the two are the same number.
    contactMs: input.startupMs,
    effectiveMassKg: effMass(input.effMassFrac),
    // §2.5.1: a missed strike opens `recovery x 1.0`.
    counterWindowMs: input.counterWindowMs ?? input.recoveryMs,
  };
}

/** startup + active + recovery (the §2.2 row total). */
export function totalMs(spec: TechniqueSpec): number {
  return spec.startupMs + spec.activeMs + spec.recoveryMs;
}

// ---------------------------------------------------------------------------
// shared follow-up / beaten-by lists (§2.2.3)
// ---------------------------------------------------------------------------

// "cross, lead hook, body jab, low kick (Dutch), level change (03), teep" — the
// level change is 03's, so it is not a tech id here. TODO(chapter 03): expose
// `state.jab_setup` to the level-change entry (§2.3.6).
const JAB_FOLLOWUPS: readonly TechniqueId[] = [
  'tech.cross', 'tech.hook_lead', 'tech.jab_body', 'tech.kick_low_rear', 'tech.teep_lead',
];
// `guard.long` also beats the jab (§2.2.3) but is a posture, not a def.* id.
const JAB_BEATEN_BY: readonly DefenceId[] = [
  'def.catch', 'def.parry', 'def.slip_out', 'def.slip_in', 'def.pull', 'def.block_high',
];
const BODY_PUNCH_BEATEN_BY: readonly DefenceId[] = [
  'def.elbow_tuck', 'def.step_back', 'def.pull',
];
const CROSS_BEATEN_BY: readonly DefenceId[] = [
  'def.slip_out', 'def.parry', 'def.shoulder_roll', 'def.pull', 'def.block_high', 'def.catch',
];
const HOOK_BEATEN_BY: readonly DefenceId[] = [
  'def.roll', 'def.block_high', 'def.lean_back', 'def.step_in_smother', 'def.catch',
];
const BODY_HOOK_BEATEN_BY: readonly DefenceId[] = [
  'def.elbow_tuck', 'def.step_back', 'def.frame', 'def.clinch_up',
];
const ELBOW_BEATEN_BY: readonly DefenceId[] = [
  'def.block_high', 'def.frame', 'def.step_back', 'def.lean_back', 'def.clinch_up',
];
const KNEE_BEATEN_BY: readonly DefenceId[] = [
  'def.forearm_block_kick', 'def.step_off', 'def.frame', 'def.kick_catch',
];
const TEEP_BEATEN_BY: readonly DefenceId[] = [
  'def.parry_down_teep', 'def.step_off', 'def.kick_catch',
];
const LOW_KICK_BEATEN_BY: readonly DefenceId[] = [
  'def.check', 'def.step_back', 'def.step_in_smother', 'def.knee_raise_block',
];
const BODY_KICK_BEATEN_BY: readonly DefenceId[] = [
  'def.forearm_block_kick', 'def.kick_catch', 'def.step_in_smother', 'def.teep_jam', 'def.step_back',
];
const HEAD_KICK_BEATEN_BY: readonly DefenceId[] = [
  'def.forearm_block_kick', 'def.lean_back', 'def.step_in_smother', 'def.duck_under', 'def.block_high',
];

// ---------------------------------------------------------------------------
// Table A §2.2.1 — punches (27)
// ---------------------------------------------------------------------------

const PUNCHES: readonly TechniqueSpec[] = [
  tech({
    id: 'tech.jab', name: 'Jab', weapon: 'fist', band: ['long', 'mid'], targets: ['head', 'body'],
    // 100-160 ms startup / 120-180 ms recovery measured; the row sits mid-bracket.
    startupMs: 130, activeMs: 60, recoveryMs: 150,
    // FD #26 distance jab 0.29 + the 42 -> 46 % era drift of FD §2.1 note b.
    baseLand: 0.30, telegraph: 0, commitment: { balance: 2, guard: 'L' },
    forceMedianN: 900, forceCapN: 2850, effMassFrac: 0.030, vRefMs: 7.2, rotationalFactor: 1.0,
    followUps: JAB_FOLLOWUPS, beatenBy: JAB_BEATEN_BY,
    family: 'straight', limb: 'leadHand', skill: 'boxing.jab', minTier: 0, flags: [],
    tag: '[S: BOX §2 #1 100-160/120-180 ms; P_land D from FD #26 0.29 + era drift]',
  }),
  tech({
    id: 'tech.jab_step', name: 'Step jab', weapon: 'fist', band: ['kick', 'long'], targets: ['head'],
    startupMs: 200, activeMs: 60, recoveryMs: 230,
    baseLand: 0.32, telegraph: 40, commitment: { balance: 5, guard: 'M' },
    forceMedianN: 900, forceCapN: 2850, effMassFrac: 0.030, vRefMs: 7.2, rotationalFactor: 1.0,
    followUps: JAB_FOLLOWUPS, beatenBy: JAB_BEATEN_BY,
    family: 'straight', limb: 'leadHand', skill: 'boxing.jab', minTier: 1, flags: ['stepIn'],
    tag: '[S: BOX §2 #2 step closes 0.3-0.5 m; P_land E +0.1 logit over the jab]',
  }),
  tech({
    id: 'tech.jab_power', name: 'Power jab', weapon: 'fist', band: ['long'], targets: ['head'],
    startupMs: 220, activeMs: 70, recoveryMs: 280,
    baseLand: 0.27, telegraph: 60, commitment: { balance: 6, guard: 'M-H' },
    // Heavier jab: 1150 N at 7.6 m/s, between the elite jab (1508 N, Liu 2022) and the flick.
    forceMedianN: 1150, forceCapN: 2850, effMassFrac: 0.034, vRefMs: 7.6, rotationalFactor: 1.0,
    followUps: ['tech.cross', 'tech.hook_lead'],
    // "as jab + def.shoulder_roll weak" — the roll is listed but poor against it.
    beatenBy: [...JAB_BEATEN_BY, 'def.shoulder_roll'],
    family: 'straight', limb: 'leadHand', skill: 'boxing.jab', minTier: 2, flags: [],
    tag: '[S: BOX §2 #3]',
  }),
  tech({
    id: 'tech.jab_double', name: 'Double jab', weapon: 'fist', band: ['long'], targets: ['head'],
    // Two 130 ms beats; the row quotes "130 + 130" with 60 ms contact each.
    startupMs: 130, activeMs: 60, recoveryMs: 180,
    // The second jab lands more often once the first has moved the guard.
    baseLand: 0.30, landVariants: { second: 0.37 }, telegraph: 0,
    commitment: { balance: 3, guard: 'L' },
    forceMedianN: 900, forceCapN: 2850, effMassFrac: 0.030, vRefMs: 7.2, rotationalFactor: 1.0,
    followUps: JAB_FOLLOWUPS, beatenBy: JAB_BEATEN_BY,
    family: 'straight', limb: 'leadHand', skill: 'boxing.jab', minTier: 1, flags: ['twoBeat'],
    tag: '[S: BOX §2 #4 second jab lands more]',
  }),
  tech({
    id: 'tech.jab_flicker', name: 'Flicker jab', weapon: 'fist', band: ['long'], targets: ['head'],
    startupMs: 110, activeMs: 50, recoveryMs: 120,
    // Two outcomes: a clean landing (0.22) or a vision-blocking touch (0.60).
    baseLand: 0.22, landVariants: { touch: 0.60 }, telegraph: 0,
    commitment: { balance: 1, guard: 'L' },
    forceMedianN: 900, forceCapN: 2850, effMassFrac: 0.030, vRefMs: 7.2, rotationalFactor: 1.0,
    followUps: JAB_FOLLOWUPS, beatenBy: JAB_BEATEN_BY,
    family: 'straight', limb: 'leadHand', skill: 'boxing.jab', minTier: 2, flags: ['visionBlocker'],
    tag: '[S: BOX §2 #5; touch sets state.vision_blocked 300 ms]',
  }),
  tech({
    id: 'tech.jab_up', name: 'Up-jab', weapon: 'fist', band: ['long', 'mid'], targets: ['head'],
    startupMs: 150, activeMs: 60, recoveryMs: 190,
    // +0.3 logit against `guard.high`; needs the opponent in low hands or a long guard.
    baseLand: 0.31, landVariants: { vsHighGuard: 0.38 }, telegraph: 20,
    commitment: { balance: 3, guard: 'L-M' },
    forceMedianN: 900, forceCapN: 2850, effMassFrac: 0.030, vRefMs: 7.2, rotationalFactor: 1.0,
    followUps: JAB_FOLLOWUPS, beatenBy: JAB_BEATEN_BY,
    family: 'straight', limb: 'leadHand', skill: 'boxing.jab', minTier: 2, flags: [],
    tag: '[S: BOX §2 #6; needs guard.low_hands or guard.long]',
  }),
  tech({
    id: 'tech.jab_body', name: 'Body jab', weapon: 'fist', band: ['long', 'mid'], targets: ['body'],
    startupMs: 180, activeMs: 60, recoveryMs: 230,
    // BOX §2 #7 quotes 0.45-0.55 against FD #17's 0.63 body marginal.
    baseLand: 0.52, telegraph: 40, commitment: { balance: 5, guard: 'M' },
    forceMedianN: 850, forceCapN: 2500, effMassFrac: 0.030, vRefMs: 7.0, rotationalFactor: 0.5,
    followUps: ['tech.jab', 'tech.hook_lead', 'tech.overhand'],
    beatenBy: [...BODY_PUNCH_BEATEN_BY, 'def.knee_intercept'],
    family: 'straight', limb: 'leadHand', skill: 'boxing.bodyWork', minTier: 2, flags: [],
    tag: '[S: BOX §2 #7 0.45-0.55; FD #17 body 0.63]',
  }),
  tech({
    id: 'tech.jab_backstep', name: 'Back-step jab', weapon: 'fist', band: ['long'], targets: ['head'],
    startupMs: 170, activeMs: 60, recoveryMs: 200,
    baseLand: 0.24, telegraph: 20, commitment: { balance: 3, guard: 'L' },
    forceMedianN: 900, forceCapN: 2850, effMassFrac: 0.030, vRefMs: 7.2, rotationalFactor: 1.0,
    followUps: ['tech.jab', 'tech.cross'], beatenBy: JAB_BEATEN_BY,
    family: 'straight', limb: 'leadHand', skill: 'boxing.jab', minTier: 2, flags: [],
    tag: '[S: BOX §4 "back-step jab"; P_land E]',
  }),
  tech({
    id: 'tech.jab_pivot', name: 'Pivot jab', weapon: 'fist', band: ['mid'], targets: ['head'],
    // Recovery runs until the pivot finishes (move.pivot 300 ms, §2.1.5).
    startupMs: 180, activeMs: 60, recoveryMs: 250,
    baseLand: 0.27, telegraph: 30, commitment: { balance: 4, guard: 'M' },
    forceMedianN: 900, forceCapN: 2850, effMassFrac: 0.030, vRefMs: 7.2, rotationalFactor: 1.0,
    followUps: ['tech.cross', 'tech.hook_lead'], beatenBy: JAB_BEATEN_BY,
    family: 'straight', limb: 'leadHand', skill: 'boxing.jab', minTier: 2, flags: [],
    tag: '[S: BOX §2 note "pivot jab"; P_land E]',
  }),
  tech({
    id: 'tech.cross', name: 'Cross', weapon: 'fist', band: ['mid', 'long'], targets: ['head', 'body'],
    // 180-250 startup / 250-330 recovery; Boxing Science's rear hand reaches the target in 183 ms.
    startupMs: 210, activeMs: 70, recoveryMs: 290,
    baseLand: 0.30, telegraph: 40, commitment: { balance: 6, guard: 'M-H' },
    // Lab maximum for an elite rear straight is 4800 N (Smith 2000); 1400 N is the in-fight median.
    forceMedianN: 1400, forceCapN: 4800, effMassFrac: 0.038, vRefMs: 7.8, rotationalFactor: 1.0,
    followUps: ['tech.hook_lead', 'tech.uppercut_lead', 'tech.kick_low_rear'],
    beatenBy: CROSS_BEATEN_BY,
    family: 'straight', limb: 'rearHand', skill: 'boxing.power', minTier: 0, flags: [],
    tag: '[S: BOX §2 #8 180-250/250-330; rear hand to target 183 ms §7.5; P_land D]',
  }),
  tech({
    id: 'tech.cross_step', name: 'Step cross', weapon: 'fist', band: ['long'], targets: ['head'],
    startupMs: 250, activeMs: 70, recoveryMs: 320,
    baseLand: 0.28, telegraph: 60, commitment: { balance: 8, guard: 'H' },
    forceMedianN: 1400, forceCapN: 4800, effMassFrac: 0.038, vRefMs: 7.8, rotationalFactor: 1.0,
    followUps: ['tech.hook_lead', 'tech.uppercut_lead'], beatenBy: CROSS_BEATEN_BY,
    family: 'straight', limb: 'rearHand', skill: 'boxing.power', minTier: 2, flags: ['stepIn'],
    tag: '[E]',
  }),
  tech({
    id: 'tech.cross_body', name: 'Cross to the body', weapon: 'fist', band: ['mid'], targets: ['body'],
    startupMs: 240, activeMs: 70, recoveryMs: 310,
    baseLand: 0.50, telegraph: 50, commitment: { balance: 7, guard: 'M-H' },
    forceMedianN: 1300, forceCapN: 4000, effMassFrac: 0.038, vRefMs: 7.5, rotationalFactor: 0.5,
    followUps: ['tech.hook_lead', 'tech.uppercut_lead'],
    beatenBy: ['def.elbow_tuck', 'def.step_off', 'def.pull'],
    family: 'straight', limb: 'rearHand', skill: 'boxing.bodyWork', minTier: 2, flags: [],
    tag: '[S: BOX §2 #17-18 0.45; FD #17]',
  }),
  tech({
    id: 'tech.cross_shift', name: 'Shift cross', weapon: 'fist', band: ['mid', 'close'], targets: ['head'],
    startupMs: 260, activeMs: 70, recoveryMs: 350,
    baseLand: 0.28, telegraph: 80, commitment: { balance: 12, guard: 'H' },
    // Stepping through adds body mass behind it: force x1.15 via the `shift` flag.
    forceMedianN: 1600, forceCapN: 4800, effMassFrac: 0.045, vRefMs: 8.2, rotationalFactor: 1.0,
    followUps: ['tech.hook_lead'], beatenBy: ['def.step_off', 'def.pull'],
    family: 'straight', limb: 'rearHand', skill: 'boxing.power', minTier: 3, flags: ['shift', 'stepIn'],
    tag: '[S: BOX §4 shift; magnitudes E] force x1.15',
  }),
  tech({
    id: 'tech.hook_lead', name: 'Lead hook', weapon: 'fist', band: ['mid', 'close'], targets: ['head', 'body'],
    startupMs: 190, activeMs: 70, recoveryMs: 260,
    baseLand: 0.28, telegraph: 60, commitment: { balance: 6, guard: 'M' },
    // Olympic hook 4405 N at 11.0 m/s (Walilko/Viano); 1500 N is the in-fight median.
    forceMedianN: 1500, forceCapN: 4400, effMassFrac: 0.036, vRefMs: 11.0, rotationalFactor: 1.5,
    followUps: ['tech.cross', 'tech.uppercut_rear', 'tech.hook_rear', 'tech.hook_lead_body'],
    beatenBy: HOOK_BEATEN_BY,
    family: 'hook', limb: 'leadHand', skill: 'boxing.power', minTier: 0, flags: [],
    tag: '[S: BOX §2 #9 150-230/220-300]',
  }),
  tech({
    id: 'tech.hook_rear', name: 'Rear hook', weapon: 'fist', band: ['mid', 'close'], targets: ['head'],
    startupMs: 240, activeMs: 70, recoveryMs: 320,
    baseLand: 0.25, telegraph: 80, commitment: { balance: 8, guard: 'H' },
    forceMedianN: 1600, forceCapN: 4400, effMassFrac: 0.040, vRefMs: 11.2, rotationalFactor: 1.5,
    followUps: ['tech.hook_lead', 'tech.uppercut_lead'],
    beatenBy: [...HOOK_BEATEN_BY.filter((d) => d !== 'def.catch'), 'def.duck'],
    family: 'hook', limb: 'rearHand', skill: 'boxing.power', minTier: 1, flags: [],
    tag: '[S: BOX §2 #10]',
  }),
  tech({
    id: 'tech.hook_lead_body', name: 'Lead body hook', weapon: 'fist', band: ['mid', 'close'], targets: ['body'],
    startupMs: 200, activeMs: 70, recoveryMs: 270,
    baseLand: 0.50, telegraph: 60, commitment: { balance: 6, guard: 'M' },
    forceMedianN: 1400, forceCapN: 4000, effMassFrac: 0.036, vRefMs: 10.0, rotationalFactor: 0.4,
    followUps: ['tech.hook_lead', 'tech.uppercut_rear', 'tech.cross'],
    beatenBy: BODY_HOOK_BEATEN_BY,
    family: 'hook', limb: 'leadHand', skill: 'boxing.bodyWork', minTier: 2, flags: [],
    tag: '[S: BOX §2 #16; FD #17]',
  }),
  tech({
    id: 'tech.hook_liver', name: 'Liver hook', weapon: 'fist', band: ['mid', 'close'], targets: ['body'],
    startupMs: 220, activeMs: 70, recoveryMs: 280,
    // BOX §2 #16 quotes 0.40 for the targeted liver shot; re-anchored to 0.45 [D].
    baseLand: 0.45, telegraph: 60, commitment: { balance: 6, guard: 'M' },
    forceMedianN: 1400, forceCapN: 4000, effMassFrac: 0.036, vRefMs: 10.0, rotationalFactor: 0.4,
    followUps: ['tech.hook_lead', 'tech.uppercut_rear', 'tech.kick_low_rear'],
    beatenBy: BODY_HOOK_BEATEN_BY,
    family: 'hook', limb: 'leadHand', skill: 'boxing.bodyWork', minTier: 2, flags: ['liverTargeted'],
    tag: '[S: BOX §2 #16 0.40 -> D]',
  }),
  tech({
    id: 'tech.hook_rear_body', name: 'Rear body hook', weapon: 'fist', band: ['mid', 'close'], targets: ['body'],
    startupMs: 250, activeMs: 70, recoveryMs: 310,
    baseLand: 0.48, telegraph: 80, commitment: { balance: 8, guard: 'H' },
    forceMedianN: 1500, forceCapN: 4000, effMassFrac: 0.040, vRefMs: 10.0, rotationalFactor: 0.4,
    followUps: ['tech.hook_lead'], beatenBy: ['def.elbow_tuck', 'def.step_off'],
    family: 'hook', limb: 'rearHand', skill: 'boxing.bodyWork', minTier: 2, flags: [],
    tag: '[E]',
  }),
  tech({
    id: 'tech.shovel_hook', name: 'Shovel hook', weapon: 'fist', band: ['close'], targets: ['body', 'head'],
    startupMs: 190, activeMs: 60, recoveryMs: 250,
    // Half hook, half uppercut: the body line lands far more often than the head line.
    baseLand: 0.42, landVariants: { head: 0.32 }, telegraph: 40,
    commitment: { balance: 5, guard: 'M' },
    forceMedianN: 1200, forceCapN: 3500, effMassFrac: 0.034, vRefMs: 9.5, rotationalFactor: 1.1,
    followUps: ['tech.uppercut_rear', 'tech.elbow_horizontal'],
    beatenBy: ['def.elbow_tuck', 'def.clinch_up', 'def.frame'],
    family: 'hook', limb: 'leadHand', skill: 'boxing.bodyWork', minTier: 2, flags: ['liverTargeted'],
    tag: '[S: BOX §2 #15]',
  }),
  tech({
    id: 'tech.uppercut_lead', name: 'Lead uppercut', weapon: 'fist', band: ['close', 'mid'], targets: ['head'],
    startupMs: 220, activeMs: 70, recoveryMs: 280,
    // BOX §2 #11 quotes 0.30/0.40; re-anchored to 0.35 close / 0.24 mid [D].
    baseLand: 0.35, landVariants: { close: 0.35, mid: 0.24 }, telegraph: 60,
    commitment: { balance: 7, guard: 'M-H' },
    // Elite uppercuts measure 3.0-3.2 kN in the lab; the cap sits at 3250 N.
    forceMedianN: 1450, forceCapN: 3250, effMassFrac: 0.034, vRefMs: 10.2, rotationalFactor: 1.2,
    followUps: ['tech.cross', 'tech.hook_rear', 'tech.hook_lead'],
    beatenBy: ['def.catch', 'def.step_back', 'def.pull', 'def.frame'],
    family: 'uppercut', limb: 'leadHand', skill: 'boxing.power', minTier: 1, flags: [],
    tag: '[S: BOX §2 #11 0.30/0.40 -> D]',
  }),
  tech({
    id: 'tech.uppercut_rear', name: 'Rear uppercut', weapon: 'fist', band: ['close', 'mid'], targets: ['head'],
    startupMs: 240, activeMs: 70, recoveryMs: 320,
    baseLand: 0.36, landVariants: { close: 0.36, mid: 0.23 }, telegraph: 70,
    commitment: { balance: 9, guard: 'H' },
    forceMedianN: 1500, forceCapN: 3250, effMassFrac: 0.038, vRefMs: 10.2, rotationalFactor: 1.2,
    followUps: ['tech.hook_lead'],
    beatenBy: ['def.catch', 'def.lean_back', 'def.frame', 'def.clinch_up'],
    family: 'uppercut', limb: 'rearHand', skill: 'boxing.power', minTier: 1, flags: [],
    tag: '[S: BOX §2 #12]',
  }),
  tech({
    id: 'tech.uppercut_body', name: 'Body uppercut', weapon: 'fist', band: ['close'], targets: ['body'],
    startupMs: 210, activeMs: 60, recoveryMs: 270,
    baseLand: 0.48, telegraph: 50, commitment: { balance: 6, guard: 'M' },
    forceMedianN: 1300, forceCapN: 3000, effMassFrac: 0.034, vRefMs: 9.5, rotationalFactor: 0.4,
    followUps: ['tech.uppercut_rear', 'tech.hook_lead'],
    beatenBy: ['def.elbow_tuck', 'def.frame'],
    family: 'uppercut', limb: 'leadHand', skill: 'boxing.bodyWork', minTier: 2, flags: [],
    tag: '[E]',
  }),
  tech({
    id: 'tech.overhand', name: 'Overhand', weapon: 'fist', band: ['mid'], targets: ['head'],
    startupMs: 300, activeMs: 80, recoveryMs: 400,
    // 0.26-0.32 against a competent defender, re-anchored down to the UFC marginal.
    baseLand: 0.23, telegraph: 100, commitment: { balance: 12, guard: 'H' },
    forceMedianN: 1550, forceCapN: 4400, effMassFrac: 0.045, vRefMs: 10.5, rotationalFactor: 1.4,
    followUps: ['tech.hook_lead'],
    // block_high only partially works against it (-0.3 logit on the block).
    beatenBy: ['def.duck', 'def.roll', 'def.lean_back', 'def.step_off', 'def.catch', 'def.block_high'],
    family: 'overhand', limb: 'rearHand', skill: 'boxing.power', minTier: 2, flags: [],
    tag: '[S: BOX §2 #13 250-350/350-450; 0.26-0.32 vs competent -> D]',
  }),
  tech({
    id: 'tech.check_hook', name: 'Check hook', weapon: 'fist', band: ['mid'], targets: ['head'],
    startupMs: 190, activeMs: 70, recoveryMs: 300,
    // Thrown cold it is a poor lead (0.20); as a counter to a charge it doubles.
    baseLand: 0.20, landVariants: { counter: 0.40 }, telegraph: 40,
    commitment: { balance: 5, guard: 'M' },
    forceMedianN: 1300, forceCapN: 4400, effMassFrac: 0.034, vRefMs: 11.0, rotationalFactor: 1.5,
    followUps: ['tech.cross'],
    // Nothing "defends" it in the normal sense; a step feint baits the pivot.
    beatenBy: ['def.step_back'],
    // Accuracy rides on `boxing.power`; the counter bonus is realised through
    // `boxing.counters` in counters.ts, not here.
    family: 'hook', limb: 'leadHand', skill: 'boxing.power',
    minTier: 3, flags: ['counterOnly'],
    tag: '[S: BOX §2 #14]',
  }),
  tech({
    id: 'tech.bolo', name: 'Bolo punch', weapon: 'fist', band: ['mid'], targets: ['body', 'head'],
    startupMs: 320, activeMs: 80, recoveryMs: 350,
    baseLand: 0.16, telegraph: 150, commitment: { balance: 10, guard: 'H' },
    forceMedianN: 1300, forceCapN: 3500, effMassFrac: 0.036, vRefMs: 9.0, rotationalFactor: 1.2,
    followUps: [], beatenBy: ['def.step_off', 'def.parry', 'def.block_high'],
    family: 'hook', limb: 'leadHand', skill: 'boxing.power', minTier: 3, flags: ['optional'],
    tag: '[S: BOX §2 #19]; optional',
  }),
  tech({
    id: 'tech.superman_punch', name: 'Superman punch', weapon: 'fist', band: ['long', 'mid'], targets: ['head'],
    startupMs: 350, activeMs: 80, recoveryMs: 450,
    baseLand: 0.20, telegraph: 150, commitment: { balance: 14, guard: 'H' },
    // Both feet leave the ground: the highest punch m_eff in the catalogue.
    forceMedianN: 1500, forceCapN: 4400, effMassFrac: 0.050, vRefMs: 9.0, rotationalFactor: 1.0,
    followUps: ['tech.kick_low_rear'],
    beatenBy: ['def.step_back', 'def.parry'],
    family: 'straight', limb: 'rearHand', skill: 'boxing.power', minTier: 3, flags: ['optional', 'stepIn'],
    tag: '[E]; optional, MMA',
  }),
  tech({
    id: 'tech.spinning_backfist', name: 'Spinning backfist', weapon: 'backfist', band: ['mid'], targets: ['head'],
    startupMs: 450, activeMs: 80, recoveryMs: 550,
    baseLand: 0.15, telegraph: 200, commitment: { balance: 15, guard: 'H' },
    forceMedianN: 1300, forceCapN: 4000, effMassFrac: 0.030, vRefMs: 12.0, rotationalFactor: 1.6,
    followUps: [], beatenBy: ['def.step_in_smother', 'def.step_back'],
    family: 'spinning', limb: 'rearHand', skill: 'kickboxing.spinning', minTier: 3,
    flags: ['optional', 'spinning'],
    tag: '[E]; optional',
  }),
];

// ---------------------------------------------------------------------------
// Table A §2.2.2 — elbows, knees (8), kicks and teeps (19)
// Elbow rows are `range.close` WITHOUT a tie; with a tie they belong to 03.
// ---------------------------------------------------------------------------

const ELBOWS_KNEES: readonly TechniqueSpec[] = [
  tech({
    id: 'tech.elbow_horizontal', name: 'Horizontal elbow', weapon: 'elbow', band: ['close'], targets: ['head'],
    startupMs: 170, activeMs: 50, recoveryMs: 200,
    // MTK quotes 0.45-0.55 at T2 with a tie; without a tie at UFC level -> 0.36 [D].
    baseLand: 0.36, telegraph: 40, commitment: { balance: 4, guard: 'M' },
    forceMedianN: 1400, forceCapN: 4400, effMassFrac: 0.045, vRefMs: 8.0, rotationalFactor: 1.4,
    followUps: ['tech.elbow_diagonal', 'tech.knee_straight'], beatenBy: ELBOW_BEATEN_BY,
    family: 'elbow', limb: 'leadHand', skill: 'muayThai.elbows', minTier: 2,
    flags: ['cutChannel', 'requiresElbowsLegal', 'illegalUnderBoxing', 'illegalUnderKickboxing'],
    tag: '[S: MTK §2 E1 150-250; 0.45-0.55 T2 -> close-no-tie D] cut roll (05)',
  }),
  tech({
    id: 'tech.elbow_upward', name: 'Upward elbow', weapon: 'elbow', band: ['close'], targets: ['head'],
    startupMs: 180, activeMs: 50, recoveryMs: 200,
    baseLand: 0.32, telegraph: 40, commitment: { balance: 4, guard: 'M' },
    forceMedianN: 1400, forceCapN: 4400, effMassFrac: 0.045, vRefMs: 8.0, rotationalFactor: 1.4,
    followUps: ['tech.elbow_horizontal', 'tech.knee_straight'], beatenBy: ELBOW_BEATEN_BY,
    family: 'elbow', limb: 'rearHand', skill: 'muayThai.elbows', minTier: 3,
    flags: ['cutChannel', 'requiresElbowsLegal', 'illegalUnderBoxing', 'illegalUnderKickboxing'],
    tag: '[S: MTK §2 E2]',
  }),
  tech({
    id: 'tech.elbow_downward', name: 'Downward elbow', weapon: 'elbow_point', band: ['close'], targets: ['head'],
    startupMs: 250, activeMs: 60, recoveryMs: 300,
    baseLand: 0.28, telegraph: 80, commitment: { balance: 6, guard: 'M-H' },
    // Elbow point, dropping body weight behind it: the highest m_eff of the elbows.
    forceMedianN: 1600, forceCapN: 4400, effMassFrac: 0.055, vRefMs: 7.0, rotationalFactor: 1.2,
    followUps: ['tech.knee_straight'], beatenBy: ['def.frame', 'def.step_back'],
    family: 'elbow', limb: 'rearHand', skill: 'muayThai.elbows', minTier: 3,
    flags: ['cutChannel', 'requiresElbowsLegal', 'requires12to6Legal', 'illegalUnderBoxing', 'illegalUnderKickboxing'],
    tag: '[S: MTK §2 E3]; elbow12to6Legal',
  }),
  tech({
    id: 'tech.elbow_diagonal', name: 'Diagonal elbow', weapon: 'elbow', band: ['close'], targets: ['head'],
    startupMs: 180, activeMs: 50, recoveryMs: 200,
    baseLand: 0.36, telegraph: 40, commitment: { balance: 4, guard: 'M' },
    forceMedianN: 1400, forceCapN: 4400, effMassFrac: 0.045, vRefMs: 8.0, rotationalFactor: 1.4,
    followUps: ['tech.elbow_horizontal', 'tech.knee_straight'], beatenBy: ELBOW_BEATEN_BY,
    family: 'elbow', limb: 'leadHand', skill: 'muayThai.elbows', minTier: 2,
    flags: ['cutChannel', 'requiresElbowsLegal', 'illegalUnderBoxing', 'illegalUnderKickboxing'],
    tag: '[S: MTK §2 E4]',
  }),
  tech({
    id: 'tech.elbow_spinning', name: 'Spinning elbow', weapon: 'elbow', band: ['close', 'mid'], targets: ['head'],
    startupMs: 500, activeMs: 60, recoveryMs: 600,
    // MTK quotes 0.20-0.30 at T2 with a tie; 0.17 without one at UFC level [D].
    baseLand: 0.17, telegraph: 200, commitment: { balance: 15, guard: 'H' },
    forceMedianN: 1800, forceCapN: 5000, effMassFrac: 0.055, vRefMs: 11.0, rotationalFactor: 1.6,
    followUps: [], beatenBy: ['def.step_back', 'def.step_in_smother'],
    family: 'spinning', limb: 'rearHand', skill: 'kickboxing.spinning', minTier: 4,
    flags: ['optional', 'spinning', 'cutChannel', 'requiresElbowsLegal', 'illegalUnderBoxing', 'illegalUnderKickboxing'],
    tag: '[S: MTK §2 E5 0.20-0.30 -> D]; optional',
  }),
  tech({
    id: 'tech.knee_straight', name: 'Straight knee', weapon: 'knee', band: ['close', 'mid'], targets: ['body', 'head'],
    // MTK N1 quotes 300-450 startup / 400-500 recovery; x0.85 for the MMA re-anchor.
    startupMs: 340, activeMs: 90, recoveryMs: 420,
    baseLand: 0.42, telegraph: 80, commitment: { balance: 9, guard: 'H' },
    // Knee impacts measure ~8242 N (provisional); the cap keeps that as a ceiling.
    forceMedianN: 2200, forceCapN: 8200, effMassFrac: 0.10, vRefMs: 6.5, rotationalFactor: 1.5,
    followUps: ['tech.elbow_horizontal'], beatenBy: KNEE_BEATEN_BY,
    family: 'knee', limb: 'rearLeg', skill: 'muayThai.knees', minTier: 1,
    flags: ['requiresKneesToHeadLegal', 'illegalUnderBoxing'],
    tag: '[S: MTK §2 N1 300-450/400-500 x0.85; 0.45 -> D]',
  }),
  tech({
    id: 'tech.knee_intercepting', name: 'Intercepting knee', weapon: 'knee', band: ['mid'], targets: ['head', 'body'],
    startupMs: 300, activeMs: 90, recoveryMs: 400,
    // 0.55 only against a level change / duck — it is an interception, not a lead.
    baseLand: 0.55, telegraph: 60, commitment: { balance: 9, guard: 'H' },
    forceMedianN: 2200, forceCapN: 8200, effMassFrac: 0.10, vRefMs: 6.5, rotationalFactor: 1.5,
    followUps: ['tech.elbow_horizontal'], beatenBy: KNEE_BEATEN_BY,
    family: 'knee', limb: 'rearLeg', skill: 'muayThai.knees', minTier: 3,
    flags: ['counterOnly', 'requiresKneesToHeadLegal', 'illegalUnderBoxing'],
    tag: '[S: MTK §8.18 +0.15; MIS I-6]',
  }),
  tech({
    id: 'tech.knee_flying', name: 'Flying knee', weapon: 'knee', band: ['long', 'mid'], targets: ['head'],
    startupMs: 550, activeMs: 100, recoveryMs: 750,
    baseLand: 0.20, telegraph: 200, commitment: { balance: 25, guard: 'H' },
    forceMedianN: 2600, forceCapN: 8200, effMassFrac: 0.14, vRefMs: 7.5, rotationalFactor: 1.5,
    followUps: [], beatenBy: ['def.step_off', 'def.block_high', 'def.duck_under'],
    family: 'knee', limb: 'rearLeg', skill: 'muayThai.knees', minTier: 3,
    flags: ['optional', 'stepIn', 'requiresKneesToHeadLegal', 'illegalUnderBoxing'],
    tag: '[S: MTK §2 N4]; optional',
  }),
];

const KICKS: readonly TechniqueSpec[] = [
  tech({
    id: 'tech.teep_lead', name: 'Lead teep', weapon: 'ball_of_foot', band: ['long', 'kick'], targets: ['body'],
    startupMs: 270, activeMs: 80, recoveryMs: 280,
    // 0.55-0.65 including pushes that do not "land" as scoring strikes -> 0.55 [D].
    baseLand: 0.55, telegraph: 40, commitment: { balance: 3, guard: 'L' },
    // Front kicks measure 466-7790 N in the literature; 1500 N is the working median.
    forceMedianN: 1500, forceCapN: 7800, effMassFrac: 0.15, vRefMs: 5.5, rotationalFactor: 0.4,
    followUps: ['tech.cross', 'tech.kick_low_rear', 'tech.jab'], beatenBy: TEEP_BEATEN_BY,
    family: 'teep', limb: 'leadLeg', skill: 'kickboxing.teep', minTier: 1,
    flags: ['pushback', 'illegalUnderBoxing'],
    tag: '[S: MTK §2 T1 250-350; 0.55-0.65 incl. pushes -> D] push effect §2.2.4',
  }),
  tech({
    id: 'tech.teep_rear', name: 'Rear teep', weapon: 'ball_of_foot', band: ['kick', 'long'], targets: ['body'],
    startupMs: 360, activeMs: 90, recoveryMs: 430,
    baseLand: 0.50, telegraph: 60, commitment: { balance: 7, guard: 'M' },
    forceMedianN: 1900, forceCapN: 7800, effMassFrac: 0.18, vRefMs: 6.0, rotationalFactor: 0.4,
    followUps: ['tech.cross', 'tech.kick_body_rear'], beatenBy: TEEP_BEATEN_BY,
    family: 'teep', limb: 'rearLeg', skill: 'kickboxing.teep', minTier: 1,
    flags: ['pushback', 'illegalUnderBoxing'],
    tag: '[S: MTK §2 T2]',
  }),
  tech({
    id: 'tech.teep_stop', name: 'Stop teep', weapon: 'ball_of_foot', band: ['long'], targets: ['leadLeg', 'body'],
    startupMs: 250, activeMs: 70, recoveryMs: 270,
    // Thrown into a step-in, so it meets the target coming forward: 0.60.
    baseLand: 0.60, telegraph: 30, commitment: { balance: 3, guard: 'L' },
    forceMedianN: 1500, forceCapN: 7800, effMassFrac: 0.15, vRefMs: 5.5, rotationalFactor: 0.4,
    followUps: ['tech.cross', 'tech.jab'], beatenBy: TEEP_BEATEN_BY,
    family: 'teep', limb: 'leadLeg', skill: 'kickboxing.teep', minTier: 2,
    flags: ['counterOnly', 'pushback', 'illegalUnderBoxing'],
    tag: '[S: MTK §2 T3]; cancels a step-in, costs the target 10 balance [S: MTK §8.11]',
  }),
  tech({
    id: 'tech.teep_face', name: 'Teep to the face', weapon: 'ball_of_foot', band: ['long'], targets: ['head'],
    startupMs: 400, activeMs: 90, recoveryMs: 480,
    baseLand: 0.18, telegraph: 100, commitment: { balance: 9, guard: 'H' },
    forceMedianN: 1500, forceCapN: 5000, effMassFrac: 0.12, vRefMs: 6.5, rotationalFactor: 1.2,
    followUps: [], beatenBy: TEEP_BEATEN_BY,
    family: 'teep', limb: 'leadLeg', skill: 'kickboxing.teep', minTier: 2,
    flags: ['illegalUnderBoxing'],
    tag: '[S: MTK §2 T4 0.20]',
  }),
  tech({
    id: 'tech.kick_low_rear', name: 'Rear low kick', weapon: 'shin', band: ['long', 'mid'], targets: ['leadLeg'],
    startupMs: 360, activeMs: 100, recoveryMs: 400,
    // FD #17 puts leg accuracy at 0.80 because checked kicks count as contact.
    baseLand: 0.78, telegraph: 80, commitment: { balance: 6, guard: 'M' },
    // In-match low kicks measure ~1850 N; the roundhouse literature spans 172-6400 N.
    forceMedianN: 1700, forceCapN: 6400, effMassFrac: 0.12, vRefMs: 7.2, rotationalFactor: 1.0,
    followUps: ['tech.cross', 'tech.hook_rear', 'tech.kick_low_rear'], beatenBy: LOW_KICK_BEATEN_BY,
    family: 'lowKick', limb: 'rearLeg', skill: 'kickboxing.roundKick', minTier: 0,
    flags: ['selfDamageOnCheck', 'illegalUnderBoxing'],
    tag: '[S: MTK §2 K1 350-450/350-500 x0.85; FD #17 leg 0.80]',
  }),
  tech({
    id: 'tech.kick_low_lead', name: 'Lead low kick', weapon: 'shin', band: ['mid', 'long'], targets: ['rearLeg', 'leadLeg'],
    startupMs: 300, activeMs: 90, recoveryMs: 300,
    baseLand: 0.74, telegraph: 50, commitment: { balance: 4, guard: 'M' },
    forceMedianN: 1200, forceCapN: 5000, effMassFrac: 0.10, vRefMs: 6.5, rotationalFactor: 1.0,
    followUps: ['tech.cross', 'tech.hook_lead'], beatenBy: ['def.check', 'def.step_back'],
    family: 'lowKick', limb: 'leadLeg', skill: 'kickboxing.roundKick', minTier: 2,
    flags: ['selfDamageOnCheck', 'illegalUnderBoxing'],
    tag: '[S: MTK §2 K5]',
  }),
  tech({
    id: 'tech.kick_inside_low', name: 'Inside low kick', weapon: 'shin', band: ['mid'], targets: ['leadLeg'],
    startupMs: 330, activeMs: 90, recoveryMs: 360,
    baseLand: 0.76, telegraph: 60, commitment: { balance: 5, guard: 'M' },
    forceMedianN: 1200, forceCapN: 5000, effMassFrac: 0.10, vRefMs: 6.5, rotationalFactor: 1.0,
    followUps: ['tech.cross', 'tech.hook_lead'], beatenBy: ['def.check', 'def.step_back'],
    family: 'lowKick', limb: 'rearLeg', skill: 'kickboxing.roundKick', minTier: 2,
    flags: ['selfDamageOnCheck', 'illegalUnderBoxing'],
    tag: '[E]',
  }),
  tech({
    id: 'tech.kick_calf', name: 'Calf kick', weapon: 'shin', band: ['long', 'mid'], targets: ['leadLeg'],
    startupMs: 270, activeMs: 90, recoveryMs: 300,
    // A bladed stance turns the calf away: 0.83 vs square, 0.65 vs bladed.
    baseLand: 0.83, landVariants: { vsSquare: 0.83, vsBladed: 0.65 }, telegraph: 50,
    commitment: { balance: 4, guard: 'L-M' },
    forceMedianN: 1300, forceCapN: 5000, effMassFrac: 0.09, vRefMs: 7.0, rotationalFactor: 1.0,
    followUps: ['tech.cross', 'tech.overhand', 'tech.kick_calf'],
    beatenBy: ['def.check', 'def.step_back'],
    family: 'lowKick', limb: 'rearLeg', skill: 'kickboxing.roundKick', minTier: 2,
    flags: ['calfTargeted', 'selfDamageOnCheck', 'illegalUnderBoxing'],
    tag: '[S: MTK §2 K7 0.60-0.70 / 0.45 -> D with FD #17]',
  }),
  tech({
    id: 'tech.kick_oblique', name: 'Oblique kick', weapon: 'ball_of_foot', band: ['long', 'kick'], targets: ['leadLeg'],
    startupMs: 260, activeMs: 80, recoveryMs: 270,
    baseLand: 0.60, telegraph: 40, commitment: { balance: 3, guard: 'L' },
    forceMedianN: 1200, forceCapN: 5000, effMassFrac: 0.12, vRefMs: 5.5, rotationalFactor: 1.0,
    followUps: ['tech.jab', 'tech.cross'], beatenBy: ['def.check', 'def.step_back'],
    family: 'lowKick', limb: 'leadLeg', skill: 'kickboxing.roundKick', minTier: 2,
    flags: ['kneeJointTargeted', 'requiresObliqueLegal', 'illegalUnderBoxing'],
    tag: '[S: MTK §2 K8 0.50 -> D]; obliqueKickLegal',
  }),
  tech({
    id: 'tech.kick_body_rear', name: 'Rear body kick', weapon: 'shin', band: ['long', 'kick'], targets: ['body'],
    startupMs: 400, activeMs: 110, recoveryMs: 450,
    baseLand: 0.55, telegraph: 100, commitment: { balance: 9, guard: 'H' },
    // Thai roundhouse 1400 +/- 419 N on a pad at 7.2 m/s (Gavagan 2017).
    forceMedianN: 1600, forceCapN: 6400, effMassFrac: 0.13, vRefMs: 7.2, rotationalFactor: 0.5,
    followUps: ['tech.cross', 'tech.kick_body_rear'], beatenBy: BODY_KICK_BEATEN_BY,
    family: 'bodyKick', limb: 'rearLeg', skill: 'kickboxing.roundKick', minTier: 0,
    flags: ['selfDamageOnCheck', 'illegalUnderBoxing'],
    tag: '[S: MTK §2 K2 0.45-0.55; FD #17 body]',
  }),
  tech({
    id: 'tech.kick_body_switch', name: 'Switch body kick', weapon: 'shin', band: ['long', 'kick'], targets: ['body'],
    // The switch step adds 100-150 ms before the kick itself starts.
    startupMs: 450, activeMs: 110, recoveryMs: 450,
    baseLand: 0.52, telegraph: 130, commitment: { balance: 9, guard: 'H' },
    forceMedianN: 1600, forceCapN: 6400, effMassFrac: 0.13, vRefMs: 7.2, rotationalFactor: 0.5,
    followUps: ['tech.cross'], beatenBy: [...BODY_KICK_BEATEN_BY, 'def.teep_jam'],
    family: 'bodyKick', limb: 'leadLeg', skill: 'kickboxing.roundKick', minTier: 1,
    flags: ['switchStep', 'selfDamageOnCheck', 'illegalUnderBoxing'],
    tag: '[S: MTK §2 K4 switch adds 100-150 ms]',
  }),
  tech({
    id: 'tech.kick_head_rear', name: 'Rear head kick', weapon: 'shin', band: ['long', 'kick'], targets: ['head'],
    startupMs: 470, activeMs: 120, recoveryMs: 540,
    // MTK 0.20-0.35; the low end, because FD's 0.31 head marginal includes punches.
    baseLand: 0.20, telegraph: 120, commitment: { balance: 12, guard: 'H' },
    forceMedianN: 1500, forceCapN: 6400, effMassFrac: 0.12, vRefMs: 7.5, rotationalFactor: 1.7,
    followUps: [], beatenBy: HEAD_KICK_BEATEN_BY,
    family: 'headKick', limb: 'rearLeg', skill: 'kickboxing.roundKick', minTier: 2,
    flags: ['selfDamageOnCheck', 'illegalUnderBoxing'],
    tag: '[S: MTK §2 K3 0.20-0.35 -> D low end (FD head 0.31 includes punches)]',
  }),
  tech({
    id: 'tech.kick_head_switch', name: 'Switch head kick', weapon: 'shin', band: ['long', 'kick'], targets: ['head'],
    startupMs: 500, activeMs: 120, recoveryMs: 540,
    baseLand: 0.19, telegraph: 140, commitment: { balance: 12, guard: 'H' },
    forceMedianN: 1500, forceCapN: 6400, effMassFrac: 0.12, vRefMs: 7.5, rotationalFactor: 1.7,
    followUps: [], beatenBy: [...HEAD_KICK_BEATEN_BY, 'def.teep_jam'],
    family: 'headKick', limb: 'leadLeg', skill: 'kickboxing.roundKick', minTier: 2,
    flags: ['switchStep', 'selfDamageOnCheck', 'illegalUnderBoxing'],
    tag: '[S: MTK §2 K4]',
  }),
  tech({
    id: 'tech.kick_question_mark', name: 'Question-mark kick', weapon: 'instep', band: ['long'], targets: ['head'],
    startupMs: 480, activeMs: 120, recoveryMs: 540,
    // Cold it is a lottery (0.15); after two low-line kicks the defender's hands
    // stay down and it more than doubles, with half the telegraph.
    baseLand: 0.15, landVariants: { setup: 0.33 }, telegraph: 100,
    commitment: { balance: 12, guard: 'H' },
    forceMedianN: 1500, forceCapN: 6400, effMassFrac: 0.12, vRefMs: 7.5, rotationalFactor: 1.7,
    followUps: [], beatenBy: HEAD_KICK_BEATEN_BY,
    family: 'headKick', limb: 'rearLeg', skill: 'kickboxing.roundKick', minTier: 3,
    flags: ['setupRequired', 'selfDamageOnCheck', 'illegalUnderBoxing'],
    tag: '[S: MTK §2 K6 0.15 -> 0.35]; setup = >=2 prior low-line kicks this bout',
  }),
  tech({
    id: 'tech.kick_front_snap', name: 'Front snap kick', weapon: 'ball_of_foot', band: ['long', 'kick'], targets: ['body'],
    startupMs: 300, activeMs: 80, recoveryMs: 320,
    baseLand: 0.50, telegraph: 60, commitment: { balance: 5, guard: 'M' },
    forceMedianN: 1400, forceCapN: 6000, effMassFrac: 0.11, vRefMs: 7.0, rotationalFactor: 0.6,
    followUps: ['tech.cross'], beatenBy: ['def.parry_down_teep', 'def.step_off'],
    family: 'teep', limb: 'rearLeg', skill: 'kickboxing.teep', minTier: 2,
    flags: ['optional', 'illegalUnderBoxing'],
    tag: '[E]; optional (karate/TKD)',
  }),
  tech({
    id: 'tech.kick_side', name: 'Side kick', weapon: 'heel', band: ['kick'], targets: ['body'],
    startupMs: 380, activeMs: 100, recoveryMs: 450,
    baseLand: 0.40, telegraph: 120, commitment: { balance: 9, guard: 'H' },
    // Side kicks reach 9015 N in the literature — the highest cap in the catalogue.
    forceMedianN: 2200, forceCapN: 9000, effMassFrac: 0.16, vRefMs: 7.0, rotationalFactor: 0.5,
    followUps: [], beatenBy: ['def.step_off', 'def.forearm_block_kick'],
    family: 'bodyKick', limb: 'leadLeg', skill: 'kickboxing.roundKick', minTier: 3,
    flags: ['optional', 'illegalUnderBoxing'],
    tag: '[E]; optional',
  }),
  tech({
    id: 'tech.kick_spinning_back', name: 'Spinning back kick', weapon: 'heel', band: ['kick'], targets: ['body'],
    startupMs: 540, activeMs: 120, recoveryMs: 630,
    baseLand: 0.25, telegraph: 200, commitment: { balance: 12, guard: 'H' },
    forceMedianN: 2500, forceCapN: 9000, effMassFrac: 0.18, vRefMs: 8.0, rotationalFactor: 0.8,
    followUps: [], beatenBy: ['def.step_off', 'def.forearm_block_kick'],
    family: 'spinning', limb: 'rearLeg', skill: 'kickboxing.spinning', minTier: 3,
    flags: ['optional', 'spinning', 'illegalUnderBoxing'],
    tag: '[S: MTK §2 S1 0.25]; optional',
  }),
  tech({
    id: 'tech.kick_wheel', name: 'Wheel kick', weapon: 'heel', band: ['kick'], targets: ['head'],
    startupMs: 600, activeMs: 120, recoveryMs: 700,
    baseLand: 0.15, telegraph: 220, commitment: { balance: 15, guard: 'H' },
    forceMedianN: 1600, forceCapN: 6400, effMassFrac: 0.12, vRefMs: 9.0, rotationalFactor: 1.7,
    followUps: [], beatenBy: ['def.step_in_smother', 'def.step_off', 'def.block_high'],
    family: 'spinning', limb: 'rearLeg', skill: 'kickboxing.spinning', minTier: 3,
    flags: ['optional', 'spinning', 'illegalUnderBoxing'],
    tag: '[E]; optional',
  }),
  tech({
    id: 'tech.kick_axe', name: 'Axe kick', weapon: 'heel', band: ['kick'], targets: ['head', 'body'],
    startupMs: 500, activeMs: 110, recoveryMs: 600,
    baseLand: 0.20, telegraph: 200, commitment: { balance: 12, guard: 'H' },
    forceMedianN: 1600, forceCapN: 6400, effMassFrac: 0.12, vRefMs: 9.0, rotationalFactor: 1.7,
    followUps: [], beatenBy: ['def.step_in_smother', 'def.step_off', 'def.block_high'],
    family: 'headKick', limb: 'rearLeg', skill: 'kickboxing.roundKick', minTier: 3,
    flags: ['optional', 'illegalUnderBoxing'],
    tag: '[E]; optional',
  }),
];

// ---------------------------------------------------------------------------
// the catalogue
// ---------------------------------------------------------------------------

/** All 54 standing techniques of chapter 02 §2.2, in table order. */
export const TECHNIQUES: readonly TechniqueSpec[] = [...PUNCHES, ...ELBOWS_KNEES, ...KICKS];

// ---------------------------------------------------------------------------
// Ground strikes — chapter 03 §5.1.1 ids, resolved through this chapter's
// pipeline (Phase 9)
// ---------------------------------------------------------------------------

/**
 * The §03 §5.1.1 ground-and-pound and bottom strikes as full technique rows,
 * so the chapter 02 resolution and the chapter 05 impact model can take them.
 * Kept out of `TECHNIQUES` (the standing catalogue the stand-up AI, the
 * creator and the animation timing iterate); `technique()` finds them.
 *
 * Forces follow §03 §5.1.1's "force row x scale" column (gnp punch = cross,
 * hammerfist = lead hook x 0.6, elbow = horizontal elbow, knee to the body =
 * straight knee x 0.5, bottom punch = jab x 0.5, bottom elbow = elbow x 0.4);
 * chapter 05's `kGround` (x0.7 on a grounded target) applies on top.
 *
 * `baseLand` [E: tuned Phase 9]: UFC ground significant-strike accuracy is
 * 72 % (head 67 %, body 94 %) [S: FIGHT_DATA §3 #16, #19] and the §03 §5.1
 * per-node land column runs 0.40-0.85; the rows sit where the pooled ground
 * accuracy lands on the target once the bottom's defence is applied.
 * Timings [E]: a ground punch is a short, arm-and-shoulder action, slower to
 * reset than a standing jab because the puncher is posting and re-basing.
 */
export const GROUND_TECHNIQUES: readonly TechniqueSpec[] = [
  tech({
    id: 'tech.gnp_punch', name: 'Ground punch', weapon: 'fist', band: ['clinch', 'close'], targets: ['head', 'body'],
    startupMs: 220, activeMs: 60, recoveryMs: 320,
    baseLand: 0.62, telegraph: 40, commitment: { balance: 4, guard: 'M' },
    forceMedianN: 1400, forceCapN: 4800, effMassFrac: 0.038, vRefMs: 7.8, rotationalFactor: 1.0,
    followUps: ['tech.gnp_punch', 'tech.gnp_elbow'], beatenBy: ['def.block_high', 'def.frame'],
    family: 'straight', limb: 'rearHand', skill: 'boxing.power', minTier: 0, flags: [],
    tag: '[S: BJJ_POSITIONS §4 58.6 % land; 03 §5.1.1 force row tech.cross x1] timings [E]',
  }),
  tech({
    id: 'tech.gnp_hammerfist', name: 'Hammerfist', weapon: 'hammerfist', band: ['clinch', 'close'], targets: ['head'],
    startupMs: 200, activeMs: 50, recoveryMs: 260,
    baseLand: 0.66, telegraph: 30, commitment: { balance: 3, guard: 'L-M' },
    forceMedianN: 900, forceCapN: 2650, effMassFrac: 0.022, vRefMs: 9.0, rotationalFactor: 1.2,
    followUps: ['tech.gnp_hammerfist', 'tech.gnp_punch'], beatenBy: ['def.block_high', 'def.frame'],
    family: 'hook', limb: 'rearHand', skill: 'boxing.power', minTier: 0, flags: [],
    tag: '[S: BJJ_POSITIONS §4; 03 §5.1.1 tech.hook_lead x0.6] timings [E]',
  }),
  tech({
    id: 'tech.gnp_elbow', name: 'Ground elbow', weapon: 'elbow', band: ['clinch', 'close'], targets: ['head'],
    startupMs: 250, activeMs: 50, recoveryMs: 330,
    baseLand: 0.56, telegraph: 50, commitment: { balance: 5, guard: 'M' },
    forceMedianN: 1400, forceCapN: 4400, effMassFrac: 0.045, vRefMs: 8.0, rotationalFactor: 1.4,
    followUps: ['tech.gnp_punch'], beatenBy: ['def.block_high', 'def.frame'],
    family: 'elbow', limb: 'leadHand', skill: 'muayThai.elbows', minTier: 0,
    flags: ['cutChannel', 'requiresElbowsLegal', 'illegalUnderBoxing', 'illegalUnderKickboxing'],
    tag: '[S: BJJ_POSITIONS §4; 03 §5.1.1 tech.elbow_horizontal x1] cut channel; timings [E]',
  }),
  tech({
    id: 'tech.gnp_knee_body', name: 'Knee to the body (ground)', weapon: 'knee', band: ['clinch', 'close'], targets: ['body'],
    startupMs: 300, activeMs: 80, recoveryMs: 380,
    baseLand: 0.80, telegraph: 60, commitment: { balance: 7, guard: 'M' },
    forceMedianN: 1100, forceCapN: 4100, effMassFrac: 0.05, vRefMs: 5.5, rotationalFactor: 1.0,
    followUps: ['tech.gnp_punch'], beatenBy: ['def.frame'],
    family: 'knee', limb: 'rearLeg', skill: 'muayThai.knees', minTier: 0, flags: ['illegalUnderBoxing'],
    tag: '[S: BJJ_POSITIONS §4; 03 §5.1.1 tech.knee_straight x0.5; FD #19 body 94 %] timings [E]',
  }),
  tech({
    id: 'tech.bottom_punch', name: 'Punch from the bottom', weapon: 'fist', band: ['clinch', 'close'], targets: ['head'],
    startupMs: 200, activeMs: 50, recoveryMs: 260,
    baseLand: 0.45, telegraph: 30, commitment: { balance: 2, guard: 'L' },
    forceMedianN: 450, forceCapN: 1400, effMassFrac: 0.015, vRefMs: 6.0, rotationalFactor: 1.0,
    followUps: ['tech.bottom_elbow'], beatenBy: ['def.block_high'],
    family: 'straight', limb: 'leadHand', skill: 'boxing.jab', minTier: 0, flags: [],
    tag: '[S: BJJ_POSITIONS §4; 03 §5.1.1 tech.jab x0.5] timings [E]',
  }),
  tech({
    id: 'tech.bottom_elbow', name: 'Elbow from the bottom', weapon: 'elbow', band: ['clinch', 'close'], targets: ['head'],
    startupMs: 220, activeMs: 50, recoveryMs: 300,
    baseLand: 0.42, telegraph: 40, commitment: { balance: 3, guard: 'M' },
    forceMedianN: 560, forceCapN: 1760, effMassFrac: 0.018, vRefMs: 6.0, rotationalFactor: 1.2,
    followUps: ['tech.bottom_punch'], beatenBy: ['def.block_high'],
    family: 'elbow', limb: 'leadHand', skill: 'muayThai.elbows', minTier: 0,
    flags: ['cutChannel', 'requiresElbowsLegal', 'illegalUnderBoxing', 'illegalUnderKickboxing'],
    tag: '[S: BJJ_POSITIONS §4; 03 §5.1.1 tech.elbow_horizontal x0.4] timings [E]',
  }),
];

const BY_ID = new Map<TechniqueId, TechniqueSpec>(
  [...TECHNIQUES, ...GROUND_TECHNIQUES].map((t) => [t.id, t]),
);

/** Register every id in the global table (ids.ts owns the dense indices). */
TECHNIQUE_IDS.addAll(TECHNIQUES.map((t) => t.id));
TECHNIQUE_IDS.addAll(GROUND_TECHNIQUES.map((t) => t.id));

export function technique(id: TechniqueId): TechniqueSpec {
  const spec = BY_ID.get(id);
  if (!spec) throw new Error(`Unknown technique: ${id}`);
  return spec;
}

export function hasTechnique(id: TechniqueId): boolean {
  return BY_ID.has(id);
}

export function techniquesInBand(band: RangeBand): readonly TechniqueSpec[] {
  return TECHNIQUES.filter((t) => t.band.includes(band));
}

export function techniquesForTier(tier: number): readonly TechniqueSpec[] {
  return TECHNIQUES.filter((t) => t.minTier <= tier);
}

/** True when `family` swings rather than pushes — drives force fatigue and tier tables. */
export function isRotational(family: TechniqueFamily): boolean {
  return family === 'hook' || family === 'uppercut' || family === 'overhand'
    || family === 'elbow' || family === 'spinning';
}

export function isKickFamily(family: TechniqueFamily): boolean {
  return family === 'teep' || family === 'lowKick' || family === 'bodyKick' || family === 'headKick';
}

/** `k_skill` for the arrival skill gap: 2.0 punches, 2.5 kicks/knees/elbows (§2.6.2). */
export function skillGapK(spec: TechniqueSpec): number {
  const punchy = spec.family === 'straight' || spec.family === 'hook'
    || spec.family === 'uppercut' || spec.family === 'overhand';
  return punchy ? 2.0 : 2.5;
}

// ---------------------------------------------------------------------------
// §2.2.5 — boxing-glove and ruleset modifiers
// ---------------------------------------------------------------------------

export type GloveType = 'mma4oz' | 'boxing8oz' | 'boxing10oz' | 'boxing12oz' | 'bare';

export interface GloveModifiers {
  /** Logit added to `tech.jab*` P_land. */
  jabLogit: number;
  /** Logit added to head power punches. */
  powerHeadLogit: number;
  /** Logit added to `def.block_high` / `def.catch` / `def.parry` success. */
  blockLogit: number;
  /** Fraction of force that passes a successful block. */
  blockPassthrough: number;
}

/**
 * §2.2.5. Boxing values are [D] from the CompuBox marginals: jab 17-20 %
 * (logit 0.19 - logit 0.30 = -0.60), power 35-36 % (+0.30), block 0.80 vs 0.62
 * (+0.90). They mix a counting convention (CompuBox counts pawing jabs thrown)
 * with a physical effect (bigger gloves block more) and §6 item 18 says so.
 *
 * `rotFactor` is deliberately absent: §2.6.4's REVIEW moved it to 05 `ko.kGlove`.
 */
export const GLOVE_MODIFIERS: Readonly<Record<GloveType, GloveModifiers>> = Object.freeze({
  mma4oz: { jabLogit: 0, powerHeadLogit: 0, blockLogit: 0, blockPassthrough: 0.55 },
  boxing8oz: { jabLogit: -0.60, powerHeadLogit: 0.30, blockLogit: 0.90, blockPassthrough: 0.35 },
  boxing10oz: { jabLogit: -0.60, powerHeadLogit: 0.30, blockLogit: 0.90, blockPassthrough: 0.35 },
  boxing12oz: { jabLogit: -0.60, powerHeadLogit: 0.30, blockLogit: 0.90, blockPassthrough: 0.35 },
  // Bare-knuckle is out of scope for chapter 02 v1: it keeps MMA geometry and
  // leaves the cut/hand-injury consequences to 05. TODO(chapter 05).
  bare: { jabLogit: 0, powerHeadLogit: 0, blockLogit: 0, blockPassthrough: 0.60 },
});

export function isBoxingGlove(glove: GloveType): boolean {
  return glove === 'boxing8oz' || glove === 'boxing10oz' || glove === 'boxing12oz';
}

/** Logit the glove adds to this technique's arrival (§2.2.5). */
export function gloveLandLogit(spec: TechniqueSpec, glove: GloveType): number {
  const mods = GLOVE_MODIFIERS[glove];
  if (spec.skill === 'boxing.jab') return mods.jabLogit;
  const powerHead = spec.weapon === 'fist'
    && spec.targets[0] === 'head'
    && spec.skill === 'boxing.power';
  return powerHead ? mods.powerHeadLogit : 0;
}

/** Ruleset flags this section reads (06 owns them; §1 interface table). */
export interface StrikingRulesetFlags {
  gloveType: GloveType;
  elbowsLegal: boolean;
  elbow12to6Legal: boolean;
  obliqueKickLegal: boolean;
  kneesToHeadStandingLegal: boolean;
  kickCatchRule: 'mt' | 'kb' | 'mma';
  /** 'boxing' forbids every kick, knee and elbow; 'kb' forbids elbows (§2.2.5). */
  family: 'mma' | 'boxing' | 'kickboxing' | 'muay_thai' | 'street';
}

/** §2.2.5 availability gate. Returns false when the ruleset forbids the technique. */
export function techniqueLegal(spec: TechniqueSpec, rules: StrikingRulesetFlags): boolean {
  if (rules.family === 'boxing' && spec.flags.includes('illegalUnderBoxing')) return false;
  if (rules.family === 'kickboxing' && spec.flags.includes('illegalUnderKickboxing')) return false;
  if (spec.flags.includes('requiresElbowsLegal') && !rules.elbowsLegal) return false;
  if (spec.flags.includes('requires12to6Legal') && !rules.elbow12to6Legal) return false;
  if (spec.flags.includes('requiresObliqueLegal') && !rules.obliqueKickLegal) return false;
  // A knee is still legal to the body when head knees are not; the AI retargets.
  if (spec.flags.includes('requiresKneesToHeadLegal') && !rules.kneesToHeadStandingLegal
      && spec.targets[0] === 'head') {
    return false;
  }
  return true;
}
