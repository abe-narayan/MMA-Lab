/**
 * THE FOUR-STAGE SUBMISSION BATTLE (04 §2).
 *
 * setup (S0) -> entry (S1) -> secure (S2) -> finish (S3) -> locked.
 *
 * Every stage is the same three-outcome hazard process, resolved once per
 * window `w`: the defender picks an option and rolls `p_e`, then (if nothing
 * happened) the attacker rolls `p_a`; otherwise the stage clock just keeps
 * running. The per-window bases are *derived* from the catalogue's stage
 * probability and mean duration so that the catalogue can keep speaking in the
 * language the research uses ("this stage is won 45 % of the time and takes
 * about 2 s") while the engine works in per-window hazards:
 *
 *     p_a0 = P     x w / dMean          P(advance before escape) = P
 *     p_e0 = (1-P) x w / dMean          mean stage time          = dMean
 *
 * Everything else is logit-additive on a T4-vs-T4, fresh, neutral base
 * (00_CONVENTIONS §4): 24 modifier terms are summed, nothing multiplies.
 *
 * No wall clock, no Math.random: the caller passes the seeded RNG and a window
 * consumes exactly four draws, in the order fixed by 09 §2.7.
 */
import { DEFENCE_IDS } from '../core/ids';

// ---------------------------------------------------------------------------
// stages, windows, tiers
// ---------------------------------------------------------------------------

export type StageName = 'setup' | 'entry' | 'secure' | 'finish' | 'locked';

/** Stage index as the snapshot and `SubmissionStageEvent` carry it. */
export type StageIndex = 0 | 1 | 2 | 3 | 4;

export const STAGE_ORDER: readonly StageName[] = ['setup', 'entry', 'secure', 'finish', 'locked'];

export function stageIndex(stage: StageName): StageIndex {
  return STAGE_ORDER.indexOf(stage) as StageIndex;
}

/** Skill tier T0-T5 (00_CONVENTIONS §3). */
export type Tier = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Tunables of §2.2-§2.4, single source of truth for `params/submissions.params.ts`.
 * Window lengths are [E] (04 §9.1 item 1); the clamp is sourced.
 */
export const STAGE_PARAMS = {
  /** Window length per stage, ms. S0 is re-checked every 100 ms tick. */
  windowMs: { setup: 100, entry: 500, secure: 1000, finish: 1000, locked: 1000 },
  /** dMax = dMaxFactor x dMean; reaching it starts the abandon rolls (§2.4.4). */
  dMaxFactor: 3.0,
  /** If p_a0 + p_e0 exceeds this, both are rescaled (short stages). */
  windowRescaleCap: 0.9,
  /** Final per-window clamp [S: SUBMISSIONS §5 preamble]. */
  pClampMin: 0.01,
  pClampMax: 0.97,
  /** A listed trigger event counts if it fired within this window (§2.4.1). */
  triggerWindowMs: 3000,
} as const;

/** Logit modifier coefficients (§2.3). Names match the `M_*` ids in the design. */
export const MODIFIER_PARAMS = {
  /** M_SKILL: k_skill x (skAtt - skDef)/100. Halved past the entry/secure pair. */
  // Realism pass: x1.25 (BJJ_POSITIONS '+' ladder 2.0/3.0/3.5 per 100; the
  // belt gap is the largest skill effect in grappling).
  kSkillEntry: 2.5,
  kSkillSecure: 2.5,
  kSkillFinish: 1.25,
  kSkillLocked: 1.25,
  /** M_CTRL: logit per §03 control point away from the neutral 5. */
  kCtrl: 0.12,
  /** M_SETUP: logit per strike landed in the last 5 s, at most 3 counted. */
  kSetupStrike: 0.25,
  setupStrikeCap: 3,
  /** M_CHAIN: entering through a chain edge. */
  chainBonus: 0.18,
  /** M_STR_FIN / M_STR_DEF: logit per 10 points of strength difference. */
  kStrFin: 0.17,
  kStrDef: 0.17,
  /** M_MASS: logit per 5 kg, capped. */
  kMass: 0.08,
  massCap: 0.6,
  /** M_NECK: the defender's neck attribute, and its effect on tLoc. */
  kNeck: -1.2,
  kNeckTLocS: 0.5,
  /** M_NECK_GIRTH: logit per 10 kg of defender mass above the class mean. */
  kNeckGirth: -0.2,
  /** M_LEN_LEG / M_LEN_ARM: logit per 10 cm of attacker limb, per 10 kg of defender. */
  kLenLeg: 0.25,
  kLenLegMass: -0.25,
  kLenArm: 0.25,
  kLenArmMass: -0.2,
  /** M_FLX_ATT: logit per 10 points above 50 (triangles; x1.5 = the omoplata slope). */
  kFlxAttTri: 0.08,
  kFlxAttOmo: 0.12,
  /** M_FLX_DEF: logit per 10 points above 50, and seconds added to the injury delay. */
  kFlxDef: 0.1,
  kFlxDefInjuryDelayS: 0.02,
  /** SLIP state: sweat/blood grip loss rising with fight time. */
  slipBase: 0.2,
  slipPerSecond: 0.001,
  slipTimeCap: 0.9,
  slipBloodAdd: 0.1,
  slipHeavyClassAdd: 0.1,
  slipTotalCap: 1.0,
  /** M_SLIP_HIGH / M_SLIP_LOW: logit per unit of SLIP. */
  kSlipHigh: -0.6,
  kSlipLow: -0.2,
  /** M_FAT_ATT_GRIP / M_FAT_ATT: logit per unit of attacker fatigue. */
  kFatAttGrip: -0.85,
  kFatAtt: -0.3,
  /** M_FAT_DEF: a tired defender stops hand-fighting. */
  kFatDefAtt: 0.5,
  kFatDefEsc: -0.7,
  /** M_ROCKED. */
  kRocked: 1.0,
  kRockedDef: -0.7,
  kStructuralHead: 0.006,
  structuralHeadCap: 0.6,
  /** M_GLOVES. */
  glovesRncShortShare: 0.5,
  glovesGripPenalty: -0.1,
  glovesDefHandFightPenalty: -0.15,
  /**
   * M_MMA_DEF [E: tuned Phase 9 to FIGHT_DATA §3 #73]: under MMA rules the man
   * in a hold can also punch, scramble, stack and use the fence, none of which
   * the grappling-sourced stage rates price in. Without it half of all
   * locked-in attempts finished against a real quarter.
   */
  mmaDefenceBonus: 1.0,
  glovesEzekielBonus: 0.2,
  /** M_CLASS: flyweight/bantamweight triangle and armbar entries. */
  classLightTriArmbar: 0.1,
  classWomenAttemptMult: 1.15,
  /** M_CAGE. */
  kCageTop: 0.3,
  kCageBottom: -0.3,
  /** M_WRONG_DEF: the defender chose nothing, or the wrong thing for this stage. */
  kWrongDef: 0.8,
} as const;

/** Stall / abandon and tier-behaviour tunables (§2.4.4, §6). */
export const BEHAVIOUR_PARAMS = {
  abandonBase: 0.35,
  abandonPatienceSlope: 0.25,
  abandonSubHunterMult: 0.5,
  /** Share of locked submissions expected to be saved by the bell (§2.4.5). */
  bellSaveTarget: 0.03,
  /** pAttempt = (base + skillSlope x sk/100) x multipliers (§6.1). */
  attemptBase: 0.15,
  attemptSkillSlope: 0.35,
  attemptSubHunterMult: 2.0,
  attemptWrestlerGnpMult: 0.5,
  attemptRockedMult: 1.5,
  attemptFatigueMult: 0.5,
  attemptTrailingMult: 0.51,
  attemptRulesetMmaMult: 1.0,
  attemptRulesetSubOnlyMult: 1.6,
  attemptRulesetGrapplingMult: 1.3,
  attemptRulesetJudoMult: 0.6,
  attemptRulesetStreetMult: 0.8,
  /** T5 "never gives the position": availability trigger rate multiplier. */
  t5AvailabilityMult: 0.6,
  /** T0 taps to pressure alone while mounted/back-controlled by a T4+ attacker. */
  t0PressureTapPerS: 0.05,
  /** Defender option policy: P(pick the best-EV option) = base + slope x tier. */
  defPickBestBase: 0.6,
  defPickBestTierSlope: 0.08,
  defPickBestIqSlope: 0.002,
  /** T0-T1 in a grappling ruleset attempt an illegal technique by mistake. */
  illegalAttemptP: 0.02,
} as const;

/** Patience per tier feeding `pAbandon` (§6.1). T0-T1 never abandon voluntarily. */
export const PATIENCE_BY_TIER: readonly number[] = [0, 0, 0.2, 0.5, 0.7, 0.9];

/**
 * Defender skill shift per tier and stage, in logit on `p_e` (§6.2, param
 * `tierDefShift`). T4 is the calibration base, hence 0.
 * [D: SUBMISSIONS §4 tier multipliers converted at p ~ 0.14-0.5]
 */
export const TIER_DEF_SHIFT: readonly { entry: number; secure: number; finish: number }[] = [
  { entry: -2.0, secure: -2.0, finish: -2.0 }, // T0 does not recognise danger
  { entry: -0.9, secure: -0.5, finish: 0 },    // T1 defends at S3
  { entry: -0.2, secure: 0, finish: 0 },       // T2 defends at S2
  { entry: 0, secure: 0, finish: 0 },          // T3
  { entry: 0, secure: 0, finish: 0 },          // T4 = base
  { entry: 0.35, secure: 0.25, finish: 0.1 },  // T5 early hand-fighting
];

// ---------------------------------------------------------------------------
// logit helpers
// ---------------------------------------------------------------------------

export function logit(p: number): number {
  const q = Math.min(Math.max(p, 1e-6), 1 - 1e-6);
  return Math.log(q / (1 - q));
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export function clampP(p: number): number {
  return Math.min(Math.max(p, STAGE_PARAMS.pClampMin), STAGE_PARAMS.pClampMax);
}

/**
 * Per-window hazard bases from the catalogue's stage probability and mean
 * duration (§2.3). Short stages whose raw hazards exceed the rescale cap are
 * scaled down together, which shortens the effective mean duration but keeps
 * P(advance before escape) exactly at `stageP`.
 */
export function perWindowBases(
  stageP: number,
  dMeanMs: number,
  windowMs: number,
): { pA0: number; pE0: number; scale: number } {
  const raw = windowMs / dMeanMs;
  let pA0 = stageP * raw;
  let pE0 = (1 - stageP) * raw;
  let scale = 1;
  const total = pA0 + pE0;
  if (total > STAGE_PARAMS.windowRescaleCap) {
    scale = STAGE_PARAMS.windowRescaleCap / total;
    pA0 *= scale;
    pE0 *= scale;
  }
  return { pA0, pE0, scale };
}

// ---------------------------------------------------------------------------
// modifiers (§2.3)
// ---------------------------------------------------------------------------

export type ModifierId =
  | 'M_SKILL' | 'M_CTRL' | 'M_SETUP' | 'M_CHAIN' | 'M_STR_FIN' | 'M_STR_DEF'
  | 'M_MASS' | 'M_NECK' | 'M_NECK_GIRTH' | 'M_LEN_LEG' | 'M_LEN_ARM'
  | 'M_FLX_ATT' | 'M_FLX_DEF' | 'M_SLIP_HIGH' | 'M_SLIP_LOW'
  | 'M_FAT_ATT_GRIP' | 'M_FAT_ATT' | 'M_FAT_DEF' | 'M_ROCKED' | 'M_GLOVES'
  | 'M_CLASS' | 'M_CAGE' | 'M_WRONG_DEF' | 'M_MUTUAL';

/** The 24 modifier terms of §2.3, in table order. */
export const MODIFIER_IDS: readonly ModifierId[] = [
  'M_SKILL', 'M_CTRL', 'M_SETUP', 'M_CHAIN', 'M_STR_FIN', 'M_STR_DEF',
  'M_MASS', 'M_NECK', 'M_NECK_GIRTH', 'M_LEN_LEG', 'M_LEN_ARM',
  'M_FLX_ATT', 'M_FLX_DEF', 'M_SLIP_HIGH', 'M_SLIP_LOW',
  'M_FAT_ATT_GRIP', 'M_FAT_ATT', 'M_FAT_DEF', 'M_ROCKED', 'M_GLOVES',
  'M_CLASS', 'M_CAGE', 'M_WRONG_DEF', 'M_MUTUAL',
];

/**
 * A catalogue entry names its modifiers, sometimes with a weight ("M_LEN_ARM
 * very large: weight x1.5"). Weight 1 is the §2.3 table value.
 */
export interface ModifierRef {
  readonly id: ModifierId;
  readonly weight?: number;
  /** Notes such as "inverse" (the term is read from the opponent's side). */
  readonly inverse?: boolean;
}

export interface ModifierSpec {
  readonly id: ModifierId;
  /** Which side of the contested roll the term lands on. */
  readonly side: 'attacker' | 'defender' | 'both' | 'none';
  readonly stages: readonly StageName[];
  readonly note: string;
}

/** §2.3 in table form, for documentation, tooling and the params UI. */
export const MODIFIERS: readonly ModifierSpec[] = [
  { id: 'M_SKILL', side: 'both', stages: ['entry', 'secure', 'finish', 'locked'], note: 'family skill vs sk.escapes; k=2 at S1/S2, 1 at S3 and on the locked escape hazard' },
  { id: 'M_CTRL', side: 'attacker', stages: ['entry', 'secure'], note: '0.12 logit per §03 control point away from 5; bottom attacks read (5 - ctrl)' },
  { id: 'M_SETUP', side: 'attacker', stages: ['entry'], note: 'GnP creates frames: 0.25 per strike landed in the last 5 s, max 3' },
  { id: 'M_CHAIN', side: 'attacker', stages: ['entry'], note: '+0.18 when entered through a chain edge (§4)' },
  { id: 'M_STR_FIN', side: 'attacker', stages: ['finish'], note: 'squeeze/rotation finishes: 0.17 per 10 points of strength advantage' },
  { id: 'M_STR_DEF', side: 'defender', stages: ['secure', 'finish'], note: 'grip-break / stack / slam / leg-clear options' },
  { id: 'M_MASS', side: 'attacker', stages: ['secure', 'finish'], note: 'pressure chokes: 0.08 per 5 kg, cap 0.6' },
  { id: 'M_NECK', side: 'attacker', stages: ['secure', 'finish'], note: 'defender neck attribute; also +0.5 s on tLoc at neck 100' },
  { id: 'M_NECK_GIRTH', side: 'attacker', stages: ['finish'], note: 'guillotine family and north-south vs a thick neck' },
  { id: 'M_LEN_LEG', side: 'attacker', stages: ['secure'], note: 'triangles, omoplata, gogoplata: attacker leg reach vs defender torso girth' },
  { id: 'M_LEN_ARM', side: 'attacker', stages: ['secure'], note: "D'Arce, anaconda, arm-triangle, neckties, buggy" },
  { id: 'M_FLX_ATT', side: 'attacker', stages: ['entry', 'secure'], note: 'attacker flexibility above 50; gogoplata and rubber guard are gated' },
  { id: 'M_FLX_DEF', side: 'defender', stages: ['secure', 'finish'], note: 'kimura / americana / omoplata escapes; also delays the injury clock' },
  { id: 'M_SLIP_HIGH', side: 'attacker', stages: ['secure', 'finish'], note: 'grip-on-skin attacks lose most to sweat' },
  { id: 'M_SLIP_LOW', side: 'attacker', stages: ['secure', 'finish'], note: 'limb-on-limb attacks lose little to sweat' },
  { id: 'M_FAT_ATT_GRIP', side: 'attacker', stages: ['secure', 'finish'], note: 'grip-heavy attacks collapse when the forearms go' },
  { id: 'M_FAT_ATT', side: 'attacker', stages: ['secure', 'finish'], note: 'all other attacks' },
  { id: 'M_FAT_DEF', side: 'both', stages: ['entry', 'secure'], note: 'a tired defender stops hand-fighting and gives the back' },
  { id: 'M_ROCKED', side: 'both', stages: ['entry', 'secure', 'finish', 'locked'], note: 'rocked defender: +1.0 to p_a, -0.7 to p_e, option set restricted to late options' },
  { id: 'M_GLOVES', side: 'both', stages: ['secure', 'finish'], note: '4 oz gloves: grips -0.1, defender hand-fighting -0.15, Ezekiel +0.2, RNC short-choke variant 50 %' },
  { id: 'M_CLASS', side: 'attacker', stages: ['entry'], note: 'FLW/BW triangle and armbar +0.1; women attempt rate x1.15' },
  { id: 'M_CAGE', side: 'attacker', stages: ['secure'], note: 'shoulders on the fence: +0.3 for top attacks, -0.3 for guard attacks' },
  { id: 'M_WRONG_DEF', side: 'attacker', stages: ['entry', 'secure', 'finish', 'locked'], note: 'def.none or a mis-timed option' },
  { id: 'M_MUTUAL', side: 'none', stages: ['entry', 'secure', 'finish'], note: '50-50 / cross-ashi: both fighters run attempts concurrently (§2.6.6)' },
];

// ---------------------------------------------------------------------------
// defender options (§2.5)
// ---------------------------------------------------------------------------

export type DefenceOptionId =
  | 'def.none' | 'def.tap' | 'def.posture_up' | 'def.hand_fight' | 'def.two_on_one'
  | 'def.chin_tuck' | 'def.answer_phone' | 'def.walk_weak_side' | 'def.stack'
  | 'def.hitchhiker' | 'def.grip_clasp' | 'def.pull_elbow' | 'def.straighten_arm'
  | 'def.roll_with' | 'def.spin_out' | 'def.clear_hooks_turn_in' | 'def.slide_to_choking_side'
  | 'def.turn_in_bridge' | 'def.swim_arm' | 'def.go_flat' | 'def.post_against_roll'
  | 'def.head_up_sit_out' | 'def.hide_heel' | 'def.clear_knee_line' | 'def.strike_attacker'
  | 'def.slam' | 'def.lift_and_dump' | 'def.release_grip' | 'def.frame_and_bridge'
  | 'def.turn_head_toward' | 'def.step_over_head' | 'def.pull_head_back' | 'def.endure'
  | 'def.counter_sub';

export type DefenceOutcomeKind =
  | 'hold' | 'regress' | 'regressToSetup' | 'escape' | 'tap' | 'counterAttack'
  | 'slam' | 'release' | 'endureHazard';

/** Energy class; §05 applies the tier multiplier, this chapter only names it (§2.8). */
export type EnergyClass = 'none' | 'low' | 'med' | 'high' | 'veryHigh' | 'panic';

export interface DefenceOption {
  readonly id: DefenceOptionId;
  /** Stages the option may be chosen in. */
  readonly stages: readonly StageName[];
  /** Logit shift applied to the attacker's p_a while this option is held. */
  readonly da: number;
  /** Logit shift on the defender's own p_e; the standard option is 0 by construction. */
  readonly de: number;
  /** What a successful p_e roll does. */
  readonly outcome: DefenceOutcomeKind;
  /** Share of successes that route to a full escape rather than the primary outcome. */
  readonly escapeShare?: number;
  /** Lowest tier that knows the option (§6.2). */
  readonly minTier: Tier;
  readonly energy: EnergyClass;
  /** Human-readable "wrong when" condition (§2.5); `M_WRONG_DEF` applies there. */
  readonly wrongWhen: string;
  /** Stages at which choosing this option is the "wrong" column of §2.5. */
  readonly wrongStages?: readonly StageName[];
  /** Options a rocked defender may still choose (§2.5 filter). */
  readonly availableWhenRocked?: boolean;
  readonly note?: string;
}

/**
 * The 34 defender options of §2.5. All Δ values are [E] unless the entry says
 * otherwise; the outcome splits are cited per catalogue entry, which is why the
 * option itself only carries the *kind* of outcome and the escape share.
 */
export const DEFENCE_OPTIONS: readonly DefenceOption[] = [
  {
    id: 'def.none', stages: ['setup', 'entry', 'secure', 'finish', 'locked'], da: 0.8, de: -2.0,
    outcome: 'hold', minTier: 0, energy: 'low', wrongWhen: 'always',
    wrongStages: ['setup', 'entry', 'secure', 'finish', 'locked'], availableWhenRocked: true,
    note: 'T0 default, and the default for a rocked or exhausted defender',
  },
  {
    id: 'def.tap', stages: ['finish', 'locked'], da: 0, de: 0, outcome: 'tap',
    minTier: 1, energy: 'none', wrongWhen: 'never', availableWhenRocked: true,
    note: 'early taps are a tier behaviour (§6.3), not a wrong choice',
  },
  {
    id: 'def.posture_up', stages: ['entry', 'secure'], da: -0.3, de: 0, outcome: 'escape',
    minTier: 1, energy: 'med', wrongWhen: 'S3 of triangle/armbar - the arm is already straight',
    wrongStages: ['finish'], note: 'S2 costs an extra -0.4 on p_e (the lock is already closing)',
  },
  {
    id: 'def.hand_fight', stages: ['entry', 'secure'], da: -0.3, de: 0, outcome: 'regress',
    escapeShare: 0.2, minTier: 2, energy: 'med',
    wrongWhen: 'S3 once the second hand is in (Δa becomes 0)', wrongStages: ['finish'],
  },
  {
    id: 'def.two_on_one', stages: ['entry'], da: -0.4, de: 0.2, outcome: 'regressToSetup',
    minTier: 2, energy: 'med', wrongWhen: 'S2/S3', wrongStages: ['secure', 'finish'],
    note: 'RNC and rear cranks; gloves make the grip harder (M_GLOVES -0.15)',
  },
  {
    id: 'def.chin_tuck', stages: ['entry', 'secure'], da: -0.2, de: -0.2, outcome: 'hold',
    minTier: 1, energy: 'low', wrongWhen: 'weak alone, but never wrong; the T1 default',
    availableWhenRocked: true, note: 'buys time: adds 1000 ms to dMax',
  },
  {
    id: 'def.answer_phone', stages: ['entry', 'secure'], da: -0.3, de: 0, outcome: 'regress',
    escapeShare: 0.3, minTier: 2, energy: 'low', wrongWhen: 'S3 - the lock is closed',
    wrongStages: ['finish'],
  },
  {
    id: 'def.walk_weak_side', stages: ['secure', 'finish'], da: -0.4, de: 0.3, outcome: 'escape',
    minTier: 3, energy: 'high',
    wrongWhen: 'standing guillotine - use def.posture_up / def.lift_and_dump',
  },
  {
    id: 'def.stack', stages: ['secure', 'finish'], da: -0.3, de: 0, outcome: 'escape',
    minTier: 2, energy: 'high', wrongWhen: 'vs mounted or back variants - no stack is possible',
    note: 'M_STR_DEF applies',
  },
  {
    id: 'def.hitchhiker', stages: ['secure', 'locked'], da: -0.2, de: 0.2, outcome: 'escape',
    escapeShare: 0.15, minTier: 3, energy: 'med',
    wrongWhen: 'once the arm is straight; at the locked clock it runs at 0.25x (Δe -1.5)',
    note: 'fails outright if the attacker chains to a triangle (edge.sub.armbar_to_tri)',
  },
  {
    id: 'def.grip_clasp', stages: ['secure'], da: -0.4, de: 0, outcome: 'hold',
    minTier: 2, energy: 'med', wrongWhen: 'S1 - the elbow can still be pulled', wrongStages: ['entry'],
    note: 'every 3 consecutive holds regress one stage',
  },
  {
    id: 'def.pull_elbow', stages: ['entry'], da: -0.3, de: 0, outcome: 'regressToSetup',
    minTier: 2, energy: 'low', wrongWhen: 'S2+', wrongStages: ['secure', 'finish'],
  },
  {
    id: 'def.straighten_arm', stages: ['entry', 'secure'], da: -0.3, de: 0, outcome: 'escape',
    escapeShare: 0.6, minTier: 2, energy: 'low', wrongWhen: 'S3 - the rotation has begun',
    wrongStages: ['finish'],
    note: 'risk: the attacker chains to an armbar on 25 % of successes',
  },
  {
    id: 'def.roll_with', stages: ['secure', 'finish'], da: -0.2, de: 0.2, outcome: 'escape',
    minTier: 3, energy: 'high',
    wrongWhen: 'rolling a heel hook the wrong way tightens it (Δa +0.6)',
  },
  {
    id: 'def.spin_out', stages: ['secure', 'finish'], da: -0.2, de: 0, outcome: 'escape',
    minTier: 3, energy: 'high', wrongWhen: 'locked', note: 'S3 runs at 0.3x',
  },
  {
    id: 'def.clear_hooks_turn_in', stages: ['setup', 'entry'], da: -0.3, de: 0, outcome: 'escape',
    minTier: 2, energy: 'high', wrongWhen: 'body triangle locked (Δe -0.7)',
  },
  {
    id: 'def.slide_to_choking_side', stages: ['finish'], da: -0.2, de: 0.3, outcome: 'escape',
    minTier: 3, energy: 'high', wrongWhen: '-',
  },
  {
    id: 'def.turn_in_bridge', stages: ['secure', 'finish'], da: -0.3, de: 0, outcome: 'escape',
    minTier: 2, energy: 'high', wrongWhen: '-',
  },
  {
    id: 'def.swim_arm', stages: ['entry', 'secure'], da: -0.4, de: 0.2, outcome: 'escape',
    escapeShare: 0.4, minTier: 3, energy: 'med', wrongWhen: 'S3', wrongStages: ['finish'],
  },
  {
    id: 'def.go_flat', stages: ['entry'], da: -0.3, de: 0.1, outcome: 'regressToSetup',
    minTier: 3, energy: 'low', wrongWhen: 'S2+', wrongStages: ['secure', 'finish'],
  },
  {
    id: 'def.post_against_roll', stages: ['secure'], da: -0.4, de: 0.2, outcome: 'escape',
    escapeShare: 0.6, minTier: 3, energy: 'high', wrongWhen: '-',
  },
  {
    id: 'def.head_up_sit_out', stages: ['setup', 'entry'], da: -0.3, de: 0, outcome: 'escape',
    minTier: 2, energy: 'med', wrongWhen: 'S2+', wrongStages: ['secure', 'finish'],
  },
  {
    id: 'def.hide_heel', stages: ['entry'], da: -0.5, de: 0, outcome: 'regressToSetup',
    minTier: 2, energy: 'low', wrongWhen: 'S3', wrongStages: ['finish'],
    note: 'boot / toes pointed / knee turned in; needs sk.legLocks >= 30',
  },
  {
    id: 'def.clear_knee_line', stages: ['entry', 'secure'], da: -0.3, de: 0, outcome: 'escape',
    minTier: 3, energy: 'high', wrongWhen: 'locked',
  },
  {
    id: 'def.strike_attacker', stages: ['entry', 'secure', 'finish'], da: -0.35, de: 0, outcome: 'hold',
    minTier: 2, energy: 'med', wrongWhen: 'ruleset without strikes (unavailable)',
    note: 'per landed strike, max 2 per window at a 58.6 % landed rate; 2 landed forces an abandon roll at 0.2',
  },
  {
    id: 'def.slam', stages: ['entry', 'secure', 'finish', 'locked'], da: 0, de: 0, outcome: 'slam',
    minTier: 2, energy: 'veryHigh',
    wrongWhen: 'illegal ruleset, or the attacker is already on their back (unavailable)',
    availableWhenRocked: true, note: 'resolution and the impact handed to §05 are in finish.ts (§2.6.6)',
  },
  {
    id: 'def.lift_and_dump', stages: ['entry', 'secure'], da: -0.2, de: 0.3, outcome: 'escape',
    escapeShare: 0.4, minTier: 2, energy: 'high',
    wrongWhen: 'the attacker has already jumped guard (use def.stack / def.slam)',
    note: 'damage as a slam at height "waist"',
  },
  {
    id: 'def.release_grip', stages: ['setup', 'entry', 'secure', 'finish'], da: 0, de: 0,
    outcome: 'release', minTier: 3, energy: 'low', wrongWhen: '-',
    note: 'the *attacker* lets go (guillotine being passed, von Flue threat): T3+ 0.8, T2 0.4, T1 0.1',
  },
  {
    id: 'def.frame_and_bridge', stages: ['entry', 'secure'], da: -0.3, de: 0, outcome: 'regress',
    escapeShare: 0.25, minTier: 2, energy: 'high', wrongWhen: '-',
  },
  {
    id: 'def.turn_head_toward', stages: ['secure'], da: -0.4, de: 0.2, outcome: 'regress',
    minTier: 3, energy: 'low', wrongWhen: '-',
  },
  {
    id: 'def.step_over_head', stages: ['finish'], da: -0.2, de: 0.2, outcome: 'escape',
    minTier: 3, energy: 'med', wrongWhen: '-',
  },
  {
    id: 'def.pull_head_back', stages: ['entry', 'secure'], da: -0.3, de: 0, outcome: 'regress',
    minTier: 2, energy: 'low', wrongWhen: '-',
  },
  {
    id: 'def.endure', stages: ['finish', 'locked'], da: 0, de: 0, outcome: 'endureHazard',
    minTier: 2, energy: 'med', wrongWhen: 'vs a functional blood choke (Δe -1.5)',
    availableWhenRocked: true,
    note: 'replaces the window roll with the per-second escape hazard of §2.6.2 / §2.6.5',
  },
  {
    id: 'def.counter_sub', stages: ['entry', 'secure'], da: 0, de: 0, outcome: 'counterAttack',
    minTier: 4, energy: 'high', wrongWhen: '-',
    note: 'heel hook vs heel hook in 50-50, von Flue off a passed guillotine (T3), kneebar off a triangle diamond',
  },
];

/**
 * The *standard* defence at a stage: the generic, correct-for-this-stage
 * resistance the research's stage probabilities were quoted against. It is not
 * one of the 34 named options - it is the zero point they are measured from, so
 * it shifts nothing (§2.5: "the base p_e0 already assumes the standard option
 * at that stage, so the standard option has Δe = 0"). Naming it lets the
 * calibration harness reproduce a catalogue entry's `P_stage` exactly.
 */
export const STANDARD_DEFENCE = 'standard';
export type DefenceChoice = DefenceOptionId | typeof STANDARD_DEFENCE;

const STANDARD_OPTION: DefenceOption = {
  id: 'def.none', // placeholder id; never reported, the choice is 'standard'
  stages: ['setup', 'entry', 'secure', 'finish', 'locked'],
  da: 0, de: 0, outcome: 'escape', minTier: 0, energy: 'med',
  wrongWhen: 'never - it is the zero point',
  availableWhenRocked: true,
};

const DEFENCE_BY_ID = new Map<DefenceOptionId, DefenceOption>(
  DEFENCE_OPTIONS.map((o) => [o.id, o]),
);

export function defenceOption(id: DefenceChoice): DefenceOption {
  if (id === STANDARD_DEFENCE) return STANDARD_OPTION;
  const o = DEFENCE_BY_ID.get(id);
  if (!o) throw new Error(`Unknown defence option: ${id}`);
  return o;
}

/** Options a `state.rocked` defender may still choose (§2.5 filter). */
export function rockedOptions(strength: number): readonly DefenceOptionId[] {
  const base: DefenceOptionId[] = ['def.none', 'def.chin_tuck', 'def.endure', 'def.tap'];
  if (strength >= 70) base.push('def.slam');
  return base;
}

/** Per-second energy cost of a defender option in §05's units (§2.8). */
export const ENERGY_PER_S: Readonly<Record<EnergyClass, number>> = {
  none: 0,
  low: 0.5,
  med: 0.7,
  high: 1.4,
  veryHigh: 4.0, // def.slam is per attempt, not per second
  panic: 1.6,
};

/** Attacker energy cost per second by stage (§2.8); grip-heavy attacks add 0.3. */
export const ATTACKER_ENERGY_PER_S: Readonly<Record<'entry' | 'secure' | 'finish' | 'locked', number>> = {
  entry: 0.9, secure: 0.7, finish: 0.9, locked: 0.6,
};
export const ATTACKER_GRIP_ENERGY_ADD = 0.3;

/** Register this chapter's `def.*` ids with the global table. */
export function registerDefenceIds(): void {
  DEFENCE_IDS.addAll(DEFENCE_OPTIONS.map((o) => o.id));
}

// ---------------------------------------------------------------------------
// the contested roll
// ---------------------------------------------------------------------------

/** The attacker/defender attributes and state the modifiers read. */
export interface SubFighter {
  readonly tier: Tier;
  /** Family skills, 0-100 (§0.2). */
  readonly chokes: number;
  readonly jointLocks: number;
  readonly legLocks: number;
  readonly cranks: number;
  readonly escapes: number;
  readonly control: number;
  readonly guard: number;
  // physical (0-100 unless a unit says otherwise)
  readonly strength: number;
  readonly flexibility: number;
  readonly neck: number;
  readonly heart: number;
  readonly fightIQ: number;
  readonly massKg: number;
  readonly reachM: number;
  readonly legReachM: number;
  // state
  readonly fatigue: number;
  readonly rocked: boolean;
  readonly structuralHead: number;
  readonly subHunter: boolean;
  readonly wrestlerGnp: boolean;
}

/** A neutral T4 fighter, the calibration reference of 00_CONVENTIONS §4. */
export function baselineFighter(over: Partial<SubFighter> = {}): SubFighter {
  return {
    tier: 4,
    chokes: 75, jointLocks: 75, legLocks: 75, cranks: 75, escapes: 75, control: 75, guard: 75,
    strength: 50, flexibility: 50, neck: 50, heart: 50, fightIQ: 50,
    massKg: 77, reachM: 1.83, legReachM: 1.0,
    fatigue: 0, rocked: false, structuralHead: 0,
    subHunter: false, wrestlerGnp: false,
    ...over,
  };
}

/** Shared environment terms (§2.3 SLIP, cage, class, gloves). */
export interface WindowEnvironment {
  readonly fightTimeS: number;
  readonly bloodFlag: boolean;
  /** LHW and above: bigger, sweatier bodies (rule 17). */
  readonly heavyClass: boolean;
  /** FLW/BW: M_CLASS on triangle and armbar entries. */
  readonly lightClass: boolean;
  readonly glovesMma: boolean;
  readonly strikesLegal: boolean;
  /**
   * A live bout under MMA rules (Phase 9): the M_MMA_DEF term applies. Off in
   * the baseline environment, so the stage tables reproduce as sourced.
   */
  readonly mmaBout?: boolean;
  readonly nearFence: boolean;
  /** §03 node control value 0-10 of the top player's node. */
  readonly ctrl: number;
  readonly strikesLandedLast5s: number;
  readonly classMeanMassKg: number;
  readonly classMeanReachM: number;
  readonly classMeanLegReachM: number;
}

export function baselineEnvironment(over: Partial<WindowEnvironment> = {}): WindowEnvironment {
  return {
    fightTimeS: 0, bloodFlag: false, heavyClass: false, lightClass: false,
    glovesMma: true, strikesLegal: true, nearFence: false,
    ctrl: 5, strikesLandedLast5s: 0,
    classMeanMassKg: 77, classMeanReachM: 1.83, classMeanLegReachM: 1.0,
    ...over,
  };
}

/**
 * SLIP (§2.3): sweat rises through the fight, blood and big bodies add to it.
 * [D: rule 10 gives R1 0.2 / R2 0.5 / R3+ 0.8 -> linear 0.2 + t/1000]
 */
export function slip(env: WindowEnvironment): number {
  const P = MODIFIER_PARAMS;
  const base = Math.min(
    Math.max(P.slipBase + P.slipPerSecond * env.fightTimeS, P.slipBase),
    P.slipTimeCap,
  );
  const extra = (env.bloodFlag ? P.slipBloodAdd : 0) + (env.heavyClass ? P.slipHeavyClassAdd : 0);
  return Math.min(base + extra, P.slipTotalCap);
}

/** The catalogue fields the modifier maths needs; `catalogue.ts` satisfies it. */
export interface ModifiedSpec {
  readonly id: string;
  readonly family: 'choke' | 'jointLock' | 'legLock' | 'crank' | 'compression';
  readonly modifiers: readonly ModifierRef[];
  readonly role: 'top' | 'bottom' | 'either' | 'standing';
  /** M_GLOVES is signed per technique: grips lose, the Ezekiel gains. */
  readonly glovesTerm?: number;
  /** M_CLASS applies to triangle and armbar entries only. */
  readonly lightClassBonus?: boolean;
}

export interface WindowContext {
  readonly spec: ModifiedSpec;
  readonly stage: 'entry' | 'secure' | 'finish';
  readonly attacker: SubFighter;
  readonly defender: SubFighter;
  readonly env: WindowEnvironment;
  /** Base stage probability and mean duration from the catalogue. */
  readonly stageP: number;
  readonly dMeanMs: number;
  /** The defender's chosen option this window, or the standard resistance. */
  readonly option: DefenceChoice;
  /** True when the attempt was entered through a chain edge (§4). */
  readonly chained: boolean;
  /** Strikes the defender landed on the attacker this window (def.strike_attacker). */
  readonly defenderStrikesLanded?: number;
}

/** The family skill that drives the attack (§0.2). */
export function familySkill(f: SubFighter, family: ModifiedSpec['family']): number {
  switch (family) {
    case 'choke': return f.chokes;
    case 'jointLock': return f.jointLocks;
    case 'legLock': return f.legLocks;
    case 'crank':
    case 'compression': return f.cranks;
  }
}

function weightOf(spec: ModifiedSpec, id: ModifierId): number | null {
  for (const m of spec.modifiers) if (m.id === id) return m.weight ?? 1;
  return null;
}

function kSkill(stage: 'entry' | 'secure' | 'finish' | 'locked'): number {
  const P = MODIFIER_PARAMS;
  return stage === 'entry' ? P.kSkillEntry
    : stage === 'secure' ? P.kSkillSecure
    : stage === 'finish' ? P.kSkillFinish
    : P.kSkillLocked;
}

/**
 * Sum of the attacker-side modifier terms in logit units (§2.3). Every term is
 * additive; nothing multiplies. A modifier the catalogue entry does not list
 * contributes nothing.
 */
export function attackerModifierSum(ctx: WindowContext): number {
  const P = MODIFIER_PARAMS;
  const { spec, stage, attacker: a, defender: d, env } = ctx;
  const at = (id: ModifierId): number | null => weightOf(spec, id);
  let sum = 0;

  // M_SKILL - always applies (§3 preamble: every entry gets it implicitly).
  const skW = at('M_SKILL') ?? 1;
  sum += kSkill(stage) * skW * (familySkill(a, spec.family) - d.escapes) / 100;

  // M_CTRL - top attacks read their own node control, bottom attacks the top's.
  const ctrlW = at('M_CTRL');
  if (ctrlW !== null && (stage === 'entry' || stage === 'secure')) {
    const delta = spec.role === 'bottom' ? 5 - env.ctrl : env.ctrl - 5;
    sum += P.kCtrl * ctrlW * delta;
  }

  // M_SETUP - GnP builds the frames that create the arm-across entry.
  const setupW = at('M_SETUP');
  if (setupW !== null && stage === 'entry') {
    sum += P.kSetupStrike * setupW * Math.min(env.strikesLandedLast5s, P.setupStrikeCap);
  }

  // M_CHAIN - the grip is already half there.
  if (ctx.chained && stage === 'entry') sum += P.chainBonus;

  // M_STR_FIN - squeeze and rotation finishes.
  const strW = at('M_STR_FIN');
  if (strW !== null && stage === 'finish') {
    sum += P.kStrFin * strW * (a.strength - d.strength) / 10;
  }

  // M_MASS - pressure chokes, capped both ways.
  const massW = at('M_MASS');
  if (massW !== null && (stage === 'secure' || stage === 'finish')) {
    const raw = P.kMass * massW * (a.massKg - d.massKg) / 5;
    sum += Math.min(Math.max(raw, -P.massCap), P.massCap);
  }

  // M_NECK - a thick neck resists every neck choke.
  const neckW = at('M_NECK');
  if (neckW !== null && (stage === 'secure' || stage === 'finish')) {
    sum += P.kNeck * neckW * (d.neck / 100 - 0.5);
  }

  // M_NECK_GIRTH - guillotine family and north-south vs heavyweight necks.
  const girthW = at('M_NECK_GIRTH');
  if (girthW !== null && stage === 'finish') {
    sum += P.kNeckGirth * girthW * (d.massKg - env.classMeanMassKg) / 10;
  }

  // M_LEN_LEG / M_LEN_ARM - limb length against torso girth, in cm.
  const legW = at('M_LEN_LEG');
  if (legW !== null && stage === 'secure') {
    sum += legW * (P.kLenLeg * ((a.legReachM - env.classMeanLegReachM) * 100) / 10
      + P.kLenLegMass * (d.massKg - env.classMeanMassKg) / 10);
  }
  const armW = at('M_LEN_ARM');
  if (armW !== null && stage === 'secure') {
    sum += armW * (P.kLenArm * ((a.reachM - env.classMeanReachM) * 100) / 10
      + P.kLenArmMass * (d.massKg - env.classMeanMassKg) / 10);
  }

  // M_FLX_ATT - weight 1 is the triangle slope, weight 1.5 the omoplata slope.
  const flxW = at('M_FLX_ATT');
  if (flxW !== null && (stage === 'entry' || stage === 'secure')) {
    sum += P.kFlxAttTri * flxW * (a.flexibility - 50) / 10;
  }

  // SLIP - sweat. High for grip-on-skin attacks, low for limb-on-limb.
  const s = slip(env);
  const slipHighW = at('M_SLIP_HIGH');
  if (slipHighW !== null && (stage === 'secure' || stage === 'finish')) {
    sum += P.kSlipHigh * slipHighW * s;
  }
  const slipLowW = at('M_SLIP_LOW');
  if (slipLowW !== null && (stage === 'secure' || stage === 'finish')) {
    sum += P.kSlipLow * slipLowW * s;
  }

  // M_FAT_ATT_GRIP / M_FAT_ATT - the forearms go first on grip-heavy attacks.
  if (stage === 'secure' || stage === 'finish') {
    const fatGripW = at('M_FAT_ATT_GRIP');
    if (fatGripW !== null) sum += P.kFatAttGrip * fatGripW * a.fatigue;
    else {
      const fatW = at('M_FAT_ATT');
      if (fatW !== null) sum += P.kFatAtt * fatW * a.fatigue;
    }
  }

  // M_FAT_DEF - a tired defender stops hand-fighting (always applies, §3).
  if (stage === 'entry' || stage === 'secure') sum += P.kFatDefAtt * d.fatigue;

  // M_ROCKED - always applies (§3 preamble).
  if (d.rocked) {
    sum += P.kRocked;
    sum += Math.min(P.kStructuralHead * d.structuralHead, P.structuralHeadCap);
  }

  // M_GLOVES - signed per technique (grips lose, the Ezekiel gains).
  if (env.glovesMma && spec.glovesTerm !== undefined
    && (stage === 'secure' || stage === 'finish')) {
    sum += spec.glovesTerm;
  }

  // M_CLASS - small-division triangles and armbars.
  if (spec.lightClassBonus && env.lightClass && stage === 'entry') {
    sum += P.classLightTriArmbar;
  }

  // M_CAGE - shoulders on the fence help the top, trap the guard player.
  const cageW = at('M_CAGE');
  if (cageW !== null && env.nearFence && stage === 'secure') {
    sum += spec.role === 'bottom' ? P.kCageBottom : P.kCageTop;
  }

  // M_WRONG_DEF - always applies (§3 preamble).
  if (isWrongOption(ctx.option, stage)) sum += P.kWrongDef;

  // The defender's own option shifts the attacker's odds (§2.5 Δa).
  const opt = defenceOption(ctx.option);
  if (ctx.option === 'def.strike_attacker') {
    sum += opt.da * Math.min(ctx.defenderStrikesLanded ?? 0, 2);
  } else if (!isWrongOption(ctx.option, stage)) {
    sum += opt.da;
  }

  return sum;
}

/** Sum of the defender-side modifier terms applied to `p_e` (§2.3, §2.5, §6.2). */
export function defenderModifierSum(ctx: WindowContext): number {
  const P = MODIFIER_PARAMS;
  const { spec, stage, attacker: a, defender: d, env } = ctx;
  const at = (id: ModifierId): number | null => weightOf(spec, id);
  let sum = 0;

  // M_SKILL - the same term with the opposite sign.
  const skW = at('M_SKILL') ?? 1;
  sum -= kSkill(stage) * skW * (familySkill(a, spec.family) - d.escapes) / 100;

  // M_STR_DEF - grip-break / stack / slam / leg-clear options.
  const strDefW = at('M_STR_DEF');
  if (strDefW !== null && (stage === 'secure' || stage === 'finish')) {
    sum += P.kStrDef * strDefW * (d.strength - a.strength) / 10;
  }

  // M_FLX_DEF - flexible shoulders come out of kimuras and americanas.
  const flxDefW = at('M_FLX_DEF');
  if (flxDefW !== null && (stage === 'secure' || stage === 'finish')) {
    sum += P.kFlxDef * flxDefW * (d.flexibility - 50) / 10;
  }

  // M_FAT_DEF - always applies.
  if (stage === 'entry' || stage === 'secure') sum += P.kFatDefEsc * d.fatigue;

  // M_ROCKED - always applies.
  if (d.rocked) sum += P.kRockedDef;

  // M_GLOVES - 4 oz gloves make the defender's hand-fighting worse.
  if (env.glovesMma && isHandFighting(ctx.option)) sum += P.glovesDefHandFightPenalty;

  // M_MMA_DEF - strikes are legal, so the defence has more tools.
  if (env.mmaBout === true) sum += P.mmaDefenceBonus;

  // Tier behaviour (§6.2): the defender's tier shifts p_e at every stage.
  sum += TIER_DEF_SHIFT[d.tier][stage];

  // The option's own Δe always applies: §2.5 replaces a mis-timed option's Δa
  // with M_WRONG_DEF, but the cost the defender pays for choosing it stands -
  // which is the whole of `def.none`'s -2.0.
  const opt = defenceOption(ctx.option);
  sum += opt.de;
  // §2.5: def.posture_up costs an extra 0.4 at S2 (the lock is already closing).
  if (ctx.option === 'def.posture_up' && stage === 'secure') sum -= 0.4;

  return sum;
}

function isHandFighting(id: DefenceChoice): boolean {
  return id === 'def.hand_fight' || id === 'def.two_on_one' || id === 'def.grip_clasp';
}

/** §2.5 "wrong when": the option was chosen at a stage it does not work at. */
export function isWrongOption(id: DefenceChoice, stage: StageName): boolean {
  if (id === STANDARD_DEFENCE) return false;
  const opt = defenceOption(id);
  if (opt.wrongStages?.includes(stage)) return true;
  return !opt.stages.includes(stage);
}

/** Per-window advance and escape probabilities, clamped (§2.3). */
export function windowProbabilities(ctx: WindowContext): { pA: number; pE: number } {
  const w = STAGE_PARAMS.windowMs[ctx.stage];
  const { pA0, pE0 } = perWindowBases(ctx.stageP, ctx.dMeanMs, w);
  const pA = clampP(sigmoid(logit(pA0) + attackerModifierSum(ctx)));
  const pE = clampP(sigmoid(logit(pE0) + defenderModifierSum(ctx)));
  return { pA, pE };
}

// ---------------------------------------------------------------------------
// window resolution (§2.4.2, §2.4.3)
// ---------------------------------------------------------------------------

export type WindowOutcome =
  | 'advance' | 'escape' | 'regress' | 'regressToSetup' | 'hold'
  | 'tap' | 'slam' | 'counterAttack' | 'release';

export interface WindowResult {
  readonly outcome: WindowOutcome;
  readonly pA: number;
  readonly pE: number;
  /** The four draws of 09 §2.7, in the order they were taken. */
  readonly draws: { uDef: number; uAtt: number; outcomeSplit: number; chain: number };
  /** True when the defender's roll succeeded (before the split was read). */
  readonly defenderWon: boolean;
}

/** The minimum RNG surface this chapter needs. `RNG` from `../rng` satisfies it. */
export interface RandomSource {
  next(): number;
}

/**
 * Resolve one window (§2.4.2). Draw order is fixed by 09 §2.7: `u_def`,
 * `u_att`, `outcomeSplit`, `chain` - always four, consumed whether or not each
 * applies, so the stream position after a window is a pure function of state.
 *
 * The defender rolls first, as §2.4.2 specifies, which costs the attacker a
 * little relative to the idealised derivation: over a stage the attacker wins
 * `pA(1-pE) / (pA(1-pE) + pE)` of the decided windows rather than
 * `pA / (pA + pE)`, about 1.7 pp at a 0.5 base. That is the price of resolving
 * a simultaneous struggle in a fixed order, and it is deliberately not
 * corrected for: the ordering is what makes a replay reproducible.
 *
 * The chain draw is returned rather than used here; `chains.sampleChainEdge` is
 * a pure function of it, which keeps the draw count at four no matter how the
 * caller routes a failure.
 */
export function resolveWindow(rng: RandomSource, ctx: WindowContext): WindowResult {
  const { pA, pE } = windowProbabilities(ctx);

  const uDef = rng.next();
  const uAtt = rng.next();
  const outcomeSplit = rng.next();
  const chain = rng.next();
  const draws = { uDef, uAtt, outcomeSplit, chain };

  const defenderWon = uDef < pE;
  if (defenderWon) {
    const opt = defenceOption(ctx.option);
    let outcome: WindowOutcome;
    switch (opt.outcome) {
      case 'escape': outcome = 'escape'; break;
      case 'regress': outcome = outcomeSplit < (opt.escapeShare ?? 0) ? 'escape' : 'regress'; break;
      case 'regressToSetup': outcome = 'regressToSetup'; break;
      case 'tap': outcome = 'tap'; break;
      case 'slam': outcome = 'slam'; break;
      case 'counterAttack': outcome = 'counterAttack'; break;
      case 'release': outcome = 'release'; break;
      case 'hold':
      case 'endureHazard':
      default: outcome = 'hold'; break;
    }
    // An option whose primary outcome is an escape may still only regress the
    // attack when its escape share says so (§2.5 outcome splits).
    if (opt.outcome === 'escape' && opt.escapeShare !== undefined
      && outcomeSplit >= opt.escapeShare) {
      outcome = 'hold';
    }
    return { outcome, pA, pE, draws, defenderWon };
  }

  if (uAtt < pA) return { outcome: 'advance', pA, pE, draws, defenderWon };
  return { outcome: 'hold', pA, pE, draws, defenderWon };
}

// ---------------------------------------------------------------------------
// stall, abandon and the attempt decision (§2.4.4, §6.1)
// ---------------------------------------------------------------------------

/**
 * Probability the attacker gives the attack up on a window past `dMax`
 * (§2.4.4). Patience comes from the family skill and drops with fatigue; a
 * sub-hunter is half as likely to let go; T0-T1 never abandon voluntarily.
 */
export function pAbandon(spec: ModifiedSpec, attacker: SubFighter): number {
  if (attacker.tier <= 1) return 0;
  const sk = familySkill(attacker, spec.family);
  const patience = Math.min(Math.max((sk - 50) / 50, 0), 1) * (1 - 0.5 * attacker.fatigue);
  const p = BEHAVIOUR_PARAMS.abandonBase - BEHAVIOUR_PARAMS.abandonPatienceSlope * patience;
  return Math.max(0, attacker.subHunter ? p * BEHAVIOUR_PARAMS.abandonSubHunterMult : p);
}

export type SubRulesetFamily = 'mma' | 'subOnly' | 'grappling' | 'judo' | 'street';

/** P(attempt) on an availability window (§6.1). §07 may override the selection. */
export function pAttempt(opts: {
  spec: ModifiedSpec;
  attacker: SubFighter;
  defenderRocked: boolean;
  ruleset: SubRulesetFamily;
  womensDivision: boolean;
  trailingLateRound: boolean;
}): number {
  const B = BEHAVIOUR_PARAMS;
  const sk = familySkill(opts.attacker, opts.spec.family);
  let p = B.attemptBase + B.attemptSkillSlope * sk / 100;
  p *= opts.attacker.subHunter ? B.attemptSubHunterMult
    : opts.attacker.wrestlerGnp ? B.attemptWrestlerGnpMult : 1;
  if (opts.defenderRocked) p *= B.attemptRockedMult;
  // The two attacks a tired fighter still goes for are the RNC and the arm-triangle.
  const fatigueExempt = opts.spec.id === 'sub.rnc' || opts.spec.id === 'sub.rnc_short'
    || opts.spec.id.startsWith('sub.arm_triangle');
  if (opts.attacker.fatigue > 0.7 && !fatigueExempt) p *= B.attemptFatigueMult;
  if (opts.trailingLateRound) p *= B.attemptTrailingMult;
  p *= opts.ruleset === 'subOnly' ? B.attemptRulesetSubOnlyMult
    : opts.ruleset === 'grappling' ? B.attemptRulesetGrapplingMult
    : opts.ruleset === 'judo' ? B.attemptRulesetJudoMult
    : opts.ruleset === 'street' ? B.attemptRulesetStreetMult
    : B.attemptRulesetMmaMult;
  if (opts.womensDivision) p *= MODIFIER_PARAMS.classWomenAttemptMult;
  return Math.min(Math.max(p, 0), 1);
}

/** Decision latency between availability evaluations, seconds (§6.1, = 01 `beh.bjj.decision_latency`). */
export const DECISION_LATENCY_S: readonly (readonly [number, number])[] = [
  [4, 8], [3, 5], [2, 4], [2, 4], [1.5, 3], [1, 2],
];

/** Pick one entry of a share list with a single uniform draw (§2.7 routing). */
export function pickShare<T extends { share: number }>(list: readonly T[], u: number): T {
  let acc = 0;
  for (const item of list) {
    acc += item.share;
    if (u < acc) return item;
  }
  return list[list.length - 1];
}
