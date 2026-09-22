/**
 * Shared ruleset furniture: weight-class ladders, legal-technique matrices and
 * foul catalogues. Each `rulesets/*.ts` file is then only what makes that sport
 * different, which is the point of having the ruleset be data.
 *
 * Source tables: docs/design/06 §2.2 (master table), §2.2.1-§2.2.4 (instance
 * notes) and the MMA legal matrix in §2.1.
 */
import type {
  FoulId, FoulRule, Legality, Phase, SubmissionClass, TakedownClass, Target, Weapon,
} from '../types';

/** lb -> kg at the conversion chapter 06 §2.2 uses. */
export const LB_TO_KG = 0.45359;
export function lb(name: string, maxLb: number): WeightClass {
  return { name, maxLb, maxKg: Math.round(maxLb * LB_TO_KG * 10) / 10 };
}
export function kg(name: string, maxKg: number): WeightClass {
  return { name, maxLb: Math.round((maxKg / LB_TO_KG) * 10) / 10, maxKg };
}
export function open(name: string): WeightClass {
  return { name, maxLb: null, maxKg: null };
}

export interface WeightClass {
  name: string;
  maxLb: number | null;
  maxKg: number | null;
}

// ---------------------------------------------------------------------------
// Weight classes
// ---------------------------------------------------------------------------

/** The full ABC ladder. [S: RULES §2.2] (kg = lb x 0.45359 [D]) */
export const MMA_WEIGHT_CLASSES: WeightClass[] = [
  lb('Atomweight', 105), lb('Strawweight', 115), lb('Flyweight', 125),
  lb('Bantamweight', 135), lb('Featherweight', 145), lb('Lightweight', 155),
  lb('Super Lightweight', 165), lb('Welterweight', 170), lb('Super Welterweight', 175),
  lb('Middleweight', 185), lb('Super Middleweight', 195), lb('Light Heavyweight', 205),
  lb('Cruiserweight', 225), lb('Heavyweight', 265), open('Super Heavyweight'),
];

/** [E] — the standard 17-class professional ladder; not in the research files. */
export const BOXING_WEIGHT_CLASSES: WeightClass[] = [
  lb('Minimumweight', 105), lb('Light Flyweight', 108), lb('Flyweight', 112),
  lb('Super Flyweight', 115), lb('Bantamweight', 118), lb('Super Bantamweight', 122),
  lb('Featherweight', 126), lb('Super Featherweight', 130), lb('Lightweight', 135),
  lb('Super Lightweight', 140), lb('Welterweight', 147), lb('Super Welterweight', 154),
  lb('Middleweight', 160), lb('Super Middleweight', 168), lb('Light Heavyweight', 175),
  lb('Cruiserweight', 200), open('Heavyweight'),
];

/** 18 boxing-style classes [S: RULES §2.5]; intermediate cut-offs [E]. */
export const MUAY_THAI_WEIGHT_CLASSES: WeightClass[] = [
  lb('Mini Flyweight', 105), lb('Light Flyweight', 108), lb('Flyweight', 112),
  lb('Super Flyweight', 115), lb('Bantamweight', 118), lb('Super Bantamweight', 122),
  lb('Featherweight', 126), lb('Super Featherweight', 130), lb('Lightweight', 135),
  lb('Super Lightweight', 140), lb('Welterweight', 147), lb('Super Welterweight', 154),
  lb('Middleweight', 160), lb('Super Middleweight', 168), lb('Light Heavyweight', 175),
  lb('Cruiserweight', 190), lb('Heavyweight', 225), open('Super Heavyweight'),
];

/** [E] — GLORY's published divisions. */
export const GLORY_WEIGHT_CLASSES: WeightClass[] = [
  kg('Featherweight', 65), kg('Lightweight', 70), kg('Welterweight', 77),
  kg('Middleweight', 85), kg('Light Heavyweight', 95), open('Heavyweight'),
];

/** [E] — IJF Olympic divisions, both sexes. */
export const IJF_WEIGHT_CLASSES: WeightClass[] = [
  kg('Women -48', 48), kg('Women -52', 52), kg('Women -57', 57), kg('Women -63', 63),
  kg('Women -70', 70), kg('Women -78', 78), open('Women +78'),
  kg('Men -60', 60), kg('Men -66', 66), kg('Men -73', 73), kg('Men -81', 81),
  kg('Men -90', 90), kg('Men -100', 100), open('Men +100'),
];

/** [E] — IBJJF adult male gi divisions. */
export const IBJJF_WEIGHT_CLASSES: WeightClass[] = [
  kg('Rooster', 57.5), kg('Light Feather', 64), kg('Feather', 70), kg('Light', 76),
  kg('Middle', 82.3), kg('Medium Heavy', 88.3), kg('Heavy', 94.3), kg('Super Heavy', 100.5),
  open('Ultra Heavy'),
];

/** [E] — ADCC divisions. */
export const ADCC_WEIGHT_CLASSES: WeightClass[] = [
  kg('Women -60', 60), open('Women +60'),
  kg('Men -66', 66), kg('Men -77', 77), kg('Men -88', 88), kg('Men -99', 99),
  open('Men +99'),
];

/** IBJJF match length by belt [S: RULES §2.6]. */
export const IBJJF_DURATION_BY_BELT: Record<string, number> = {
  white: 300, blue: 360, purple: 420, brown: 480, black: 600,
};

// ---------------------------------------------------------------------------
// Legal-technique matrix helpers
// ---------------------------------------------------------------------------

export const ALL_PHASES: Phase[] = ['standing', 'clinch', 'ground_top', 'ground_bottom'];

/** The same verdict in every phase. */
export function everyPhase(l: Legality): Partial<Record<Phase, Legality>> {
  return { standing: l, clinch: l, ground_top: l, ground_bottom: l };
}

/** The same verdict against every target, in every phase. */
export function everyTarget(l: Legality): Partial<Record<Target, Partial<Record<Phase, Legality>>>> {
  const out: Partial<Record<Target, Partial<Record<Phase, Legality>>>> = {};
  const targets: Target[] = ['head', 'body', 'leg', 'back_of_head', 'spine', 'groin',
    'throat', 'eyes', 'knee_joint', 'downed_head'];
  for (const t of targets) out[t] = everyPhase(l);
  return out;
}

export type LegalMatrix = Partial<Record<Weapon, Partial<Record<Target, Partial<Record<Phase, Legality>>>>>>;

/**
 * Targets that are a foul no matter what hit them. Applies to every family that
 * has a referee; the spine/back-of-head and throat rules are the same text in
 * the MMA, boxing and Muay Thai rule sets.  [S: RULES §2.1, §2.2, §2.3, §2.5]
 */
const FORBIDDEN_TARGETS: Partial<Record<Target, Partial<Record<Phase, Legality>>>> = {
  back_of_head: everyPhase('foul'),
  spine: everyPhase('foul'),
  throat: everyPhase('foul'),
  groin: everyPhase('foul'),
  eyes: everyPhase('foul'),
};

/**
 * MMA Unified, 2024 text. Every cell not listed is legal; the grounded-opponent
 * and 12-6 rules are flags, not cells, and live in legality.ts.
 * [S: RULES §2.1, §2.2]
 */
export const MMA_LEGAL: LegalMatrix = {
  punch: { ...FORBIDDEN_TARGETS },
  elbow: { ...FORBIDDEN_TARGETS },
  spinning_backfist: { ...FORBIDDEN_TARGETS },
  kick: {
    ...FORBIDDEN_TARGETS,
    // A kick to the head of a *grounded* opponent is foul #12; from ground_top
    // the target is by definition on the floor, so that cell is a foul even
    // before the grounded flag is consulted.
    head: { standing: 'legal', clinch: 'legal', ground_top: 'foul', ground_bottom: 'legal' },
    downed_head: everyPhase('foul'),
    // Kicking a downed knee joint sideways is a foul; kicking the leg is not.
    knee_joint: everyPhase('foul'),
  },
  knee: {
    ...FORBIDDEN_TARGETS,
    head: { standing: 'legal', clinch: 'legal', ground_top: 'foul', ground_bottom: 'legal' },
    downed_head: everyPhase('foul'),
    knee_joint: everyPhase('foul'),
  },
  // Foul #1. The one strike that is DQ-class on its own terms; an accidental
  // clash of heads in the clinch is handled as an accidental foul, not here.
  headbutt: everyTarget('foul_hard'),
  // Foul #13. The standing stomp on a standing opponent's foot is the one
  // exception and is handled by `LegalityContext.standingFootStomp`.
  stomp: {
    ...everyTarget('foul'),
    leg: { standing: 'legal', clinch: 'legal', ground_top: 'foul', ground_bottom: 'foul' },
  },
};

/** Amateur MMA [E]: no elbows to the head, knees to the body only. */
export const MMA_AMATEUR_LEGAL: LegalMatrix = {
  ...MMA_LEGAL,
  elbow: {
    ...FORBIDDEN_TARGETS,
    head: everyPhase('foul'),
    downed_head: everyPhase('foul'),
  },
  knee: {
    ...FORBIDDEN_TARGETS,
    head: everyPhase('foul'),
    downed_head: everyPhase('foul'),
    knee_joint: everyPhase('foul'),
  },
  kick: {
    ...FORBIDDEN_TARGETS,
    // Ground strikes are punches only in the amateur construct, so a kick or
    // knee anywhere on the ground is out.
    head: { standing: 'legal', clinch: 'legal', ground_top: 'foul', ground_bottom: 'foul' },
    body: { ground_top: 'foul', ground_bottom: 'foul' },
    leg: { ground_top: 'foul', ground_bottom: 'foul' },
    downed_head: everyPhase('foul'),
    knee_joint: everyPhase('foul'),
  },
};

/** Boxing: closed fist, front of the glove, head and body only. [S: RULES §2.3] */
export const BOXING_LEGAL: LegalMatrix = {
  punch: { ...FORBIDDEN_TARGETS, leg: everyPhase('foul'), knee_joint: everyPhase('foul') },
  // The backfist lands with the back of the glove, which is foul `open_glove`.
  spinning_backfist: everyTarget('foul'),
  kick: everyTarget('foul'),
  knee: everyTarget('foul'),
  elbow: everyTarget('foul'),
  headbutt: everyTarget('foul_hard'),
  stomp: everyTarget('foul'),
};

/** Kickboxing (GLORY / K-1): punches, kicks, knees; no elbows. [S: RULES §2.4] */
export const KICKBOXING_LEGAL: LegalMatrix = {
  punch: { ...FORBIDDEN_TARGETS },
  spinning_backfist: { ...FORBIDDEN_TARGETS },
  kick: { ...FORBIDDEN_TARGETS, knee_joint: everyPhase('foul') },
  knee: { ...FORBIDDEN_TARGETS, knee_joint: everyPhase('foul') },
  elbow: everyTarget('foul'),
  headbutt: everyTarget('foul_hard'),
  stomp: everyTarget('foul'),
};

/** Muay Thai: as kickboxing plus elbows at every angle. [S: RULES §2.5] */
export const MUAY_THAI_LEGAL: LegalMatrix = {
  ...KICKBOXING_LEGAL,
  elbow: { ...FORBIDDEN_TARGETS },
};

/** Grappling and judo: striking is a disqualifying act. [S: RULES §2.6, §2.7] */
export const NO_STRIKING_LEGAL: LegalMatrix = {
  punch: everyTarget('foul_hard'),
  kick: everyTarget('foul_hard'),
  knee: everyTarget('foul_hard'),
  elbow: everyTarget('foul_hard'),
  spinning_backfist: everyTarget('foul_hard'),
  headbutt: everyTarget('foul_hard'),
  stomp: everyTarget('foul_hard'),
};

// ---------------------------------------------------------------------------
// Technique classes
// ---------------------------------------------------------------------------

/** Every arcing throw; MMA bans only the spike and the head-dive. [S: RULES §2.2] */
export const MMA_TAKEDOWNS: TakedownClass[] = [
  'shot', 'trip', 'sweep_shin', 'sweep_side_foot', 'hip_throw', 'shoulder_throw',
  'leg_reap', 'lift', 'slam', 'suplex', 'kick_off_feet', 'scissor', 'leg_grab',
];

/** All except the three the ABC list forbids outright. [S: RULES §2.2] */
export const MMA_SUBMISSIONS: SubmissionClass[] = [
  'choke_blood', 'choke_air', 'neck_crank', 'elbow_lock', 'shoulder_lock', 'wrist_lock',
  'straight_ankle', 'toe_hold', 'kneebar', 'heel_hook', 'twisting_knee', 'knee_reap',
  'slicer', 'spinal_lock',
];

/** Amateur [E]: no heel hooks, no twisting knee locks, no knee reaps. */
export const MMA_AMATEUR_SUBMISSIONS: SubmissionClass[] = MMA_SUBMISSIONS
  .filter((s) => s !== 'heel_hook' && s !== 'twisting_knee' && s !== 'knee_reap');

/** Muay Thai: kicking the legs out and shin sweeps only. [S: RULES §2.5; MTKB §9] */
export const MUAY_THAI_TAKEDOWNS: TakedownClass[] = ['kick_off_feet', 'sweep_shin'];

/** IBJJF brown/black no-gi [S: RULES §2.6 (reconstructed)]. */
export const IBJJF_SUBMISSIONS: SubmissionClass[] = [
  'choke_blood', 'choke_air', 'elbow_lock', 'shoulder_lock', 'wrist_lock',
  'straight_ankle', 'toe_hold', 'kneebar', 'slicer',
];

/**
 * IBJJF's illegal-technique matrix is generated from belt + gi, not hard-coded:
 * white/blue/purple lose the leg locks and slicers; brown/black gi keeps the
 * twisting bans; brown/black no-gi gets heel hooks and reaps back.
 * [S: RULES §2.6 (reconstructed; verify against the IBJJF poster)]
 */
export type Belt = 'white' | 'blue' | 'purple' | 'brown' | 'black';
export function ibjjfSubmissions(belt: Belt, gi: boolean): SubmissionClass[] {
  const base: SubmissionClass[] = [
    'choke_blood', 'choke_air', 'elbow_lock', 'shoulder_lock', 'wrist_lock', 'straight_ankle',
  ];
  if (belt === 'white' || belt === 'blue' || belt === 'purple') return base;
  const advanced: SubmissionClass[] = [...base, 'toe_hold', 'kneebar', 'slicer'];
  if (gi) return advanced;                       // gi: no heel hook, no reap, no twisting
  return [...advanced, 'heel_hook', 'knee_reap']; // no-gi: heel hook and reap allowed
}

/** ADCC bans the neck cranks, the windpipe grab and the spinal locks. [S: RULES §2.6] */
export const ADCC_SUBMISSIONS: SubmissionClass[] = [
  'choke_blood', 'choke_air', 'elbow_lock', 'shoulder_lock', 'wrist_lock',
  'straight_ankle', 'toe_hold', 'kneebar', 'heel_hook', 'twisting_knee', 'knee_reap', 'slicer',
];

/** Grappling throws: everything but the spike and the head-dive; slam is gated. */
export const GRAPPLING_TAKEDOWNS: TakedownClass[] = [
  'shot', 'trip', 'sweep_shin', 'sweep_side_foot', 'hip_throw', 'shoulder_throw',
  'leg_reap', 'lift', 'leg_grab', 'slam',
];

/** IJF: no leg grabs (shido), no kani-basami, no head-dive, no lift-and-slam. */
export const JUDO_TAKEDOWNS: TakedownClass[] = [
  'trip', 'sweep_side_foot', 'hip_throw', 'shoulder_throw', 'leg_reap', 'lift', 'suplex',
];

/** Judo ne-waza: chokes and elbow locks only. [S: RULES §2.7; JUDO §9] */
export const JUDO_SUBMISSIONS: SubmissionClass[] = ['choke_blood', 'choke_air', 'elbow_lock'];

/** Street: everything, including the three the ABC forbids. [S: RULES §2.8] */
export const STREET_SUBMISSIONS: SubmissionClass[] = [
  ...MMA_SUBMISSIONS, 'small_joint', 'trachea_grab', 'fish_hook',
];
export const STREET_TAKEDOWNS: TakedownClass[] = [
  ...MMA_TAKEDOWNS, 'spike', 'head_dive',
];

// ---------------------------------------------------------------------------
// Foul catalogues
// ---------------------------------------------------------------------------

interface FoulOpts {
  intent?: FoulRule['intentDefault'];
  warnings?: number;
  accidental?: number;
  intentional?: number;
  recoveryMaxS?: number;
  doctorAbove?: number | null;
  hard?: boolean;
}

export function foul(id: FoulId, o: FoulOpts = {}): FoulRule {
  return {
    id,
    intentDefault: o.intent ?? 'accidental',
    warningsBeforeDeduction: o.warnings ?? 1,
    deductionAccidental: o.accidental ?? 0,
    // 2 points is mandatory for an intentional foul in MMA, boxing and Muay
    // Thai.                                    [S: RULES §2.2, §2.3, §2.5]
    deductionIntentional: o.intentional ?? 2,
    recoveryMaxS: o.recoveryMaxS ?? 0,
    needsDoctorAbove: o.doctorAbove ?? null,
    hard: o.hard ?? false,
  };
}

/**
 * The 27-item ABC foul list minus deleted #10 (the 12-6 elbow) = 26 rules.
 * Intent defaults are §2.2.1's; #14 `hold_gloves_shorts` is not in that list
 * and is treated as intentional here (you cannot grab a waistband by accident)
 * [E]. The 300 s recovery clock applies to the groin/eye family. [S: RULES §2.2]
 */
export const MMA_FOULS: FoulRule[] = [
  foul('headbutt', { intent: 'intentional', hard: true, warnings: 0, doctorAbove: 1 }),   // #1
  foul('eye_gouge', { intent: 'accidental', recoveryMaxS: 300, doctorAbove: 1 }),         // #2
  foul('bite_spit', { intent: 'intentional', hard: true, warnings: 0 }),                  // #3
  foul('fish_hook', { intent: 'intentional', hard: true, warnings: 0 }),                  // #4
  foul('hair_pull', { intent: 'intentional', warnings: 0 }),                              // #5
  foul('spike', { intent: 'intentional', hard: true, warnings: 0, doctorAbove: 1 }),      // #6
  foul('back_of_head', { intent: 'accidental', doctorAbove: 2 }),                         // #7
  foul('throat', { intent: 'intentional', warnings: 0, doctorAbove: 1 }),                 // #8
  foul('fingers_extended', { intent: 'by_context', recoveryMaxS: 300 }),                  // #9
  // #10 deleted Nov 2024 — the downward "12-6" elbow is a legal strike.
  foul('groin', { intent: 'accidental', recoveryMaxS: 300 }),                             // #11
  foul('grounded_head_kick_knee', { intent: 'accidental', doctorAbove: 2 }),              // #12
  foul('stomp', { intent: 'by_context', doctorAbove: 2 }),                                // #13
  foul('hold_gloves_shorts', { intent: 'intentional' }),                                  // #14 [E]
  foul('fence_grab', { intent: 'accidental', accidental: 1 }),                            // #15
  foul('small_joint', { intent: 'accidental' }),                                          // #16
  foul('throw_out', { intent: 'intentional', hard: true, warnings: 0, doctorAbove: 1 }),  // #17
  foul('finger_in_cut', { intent: 'intentional', warnings: 0, doctorAbove: 1 }),          // #18
  foul('claw_pinch', { intent: 'intentional', warnings: 0 }),                             // #19
  foul('timidity', { intent: 'by_context' }),                                             // #20
  foul('abusive', { intent: 'intentional' }),                                             // #21
  foul('disregard', { intent: 'intentional' }),                                           // #22
  foul('unsporting_injury', { intent: 'intentional', hard: true, warnings: 0 }),          // #23
  foul('after_bell', { intent: 'intentional', warnings: 0 }),                             // #24
  foul('on_break', { intent: 'intentional', warnings: 0 }),                               // #25
  foul('under_ref_care', { intent: 'intentional', warnings: 0 }),                         // #26
  foul('corner_interference', { intent: 'intentional' }),                                 // #27
];

/** Boxing. Holding is a foul with its own warning ladder. [S: RULES §2.3] */
export const BOXING_FOULS: FoulRule[] = [
  foul('headbutt', { intent: 'by_context', doctorAbove: 1 }),
  foul('low_blow', { intent: 'accidental', recoveryMaxS: 300 }),
  foul('rabbit_punch', { intent: 'accidental' }),
  foul('back_of_head', { intent: 'accidental' }),
  foul('holding', { intent: 'by_context', warnings: 2 }),
  foul('hold_and_hit', { intent: 'intentional' }),
  foul('hit_downed', { intent: 'intentional', warnings: 0 }),
  foul('open_glove', { intent: 'by_context' }),
  foul('throat', { intent: 'intentional', warnings: 0 }),
  foul('eye_gouge', { intent: 'accidental', recoveryMaxS: 300, doctorAbove: 1 }),
  foul('bite_spit', { intent: 'intentional', hard: true, warnings: 0 }),
  foul('after_bell', { intent: 'intentional', warnings: 0 }),
  foul('on_break', { intent: 'intentional', warnings: 0 }),
  foul('disregard', { intent: 'intentional' }),
  foul('abusive', { intent: 'intentional' }),
  foul('unsporting_injury', { intent: 'intentional', hard: true, warnings: 0 }),
  foul('corner_interference', { intent: 'intentional' }),
  foul('timidity', { intent: 'by_context' }),
];

/** Kickboxing: boxing's list plus throws, sweeps and the catch-and-carry. */
export const KICKBOXING_FOULS: FoulRule[] = [
  ...BOXING_FOULS.filter((f) => f.id !== 'holding'),
  foul('excessive_clinch', { intent: 'by_context', warnings: 2 }),
  foul('groin', { intent: 'accidental', recoveryMaxS: 300 }),
  foul('illegal_throw', { intent: 'by_context' }),
  foul('illegal_sweep', { intent: 'by_context' }),
  foul('catch_and_carry', { intent: 'by_context' }),
  foul('elbow_illegal', { intent: 'intentional', warnings: 0, doctorAbove: 1 }),
  // GLORY forbids the linear (oblique/teep-style) kick to the knee joint.
  foul('linear_leg_kick', { intent: 'by_context' }),
  foul('spike', { intent: 'intentional', hard: true, warnings: 0 }),
  foul('stomp', { intent: 'intentional', warnings: 0 }),
];

/** Muay Thai: the clinch is legal, so holding is not a foul; throws are. */
export const MUAY_THAI_FOULS: FoulRule[] = [
  ...BOXING_FOULS.filter((f) => f.id !== 'holding' && f.id !== 'open_glove'),
  foul('groin', { intent: 'accidental', recoveryMaxS: 300 }),
  foul('illegal_throw', { intent: 'by_context' }),
  foul('illegal_sweep', { intent: 'by_context' }),
  foul('catch_and_carry', { intent: 'by_context' }),
  foul('spike', { intent: 'intentional', hard: true, warnings: 0 }),
  foul('stomp', { intent: 'intentional', warnings: 0 }),
  foul('small_joint', { intent: 'accidental' }),
];

/** IBJJF: severe fouls DQ at once; serious fouls use the 4-step ladder. */
export const IBJJF_FOULS: FoulRule[] = [
  foul('illegal_submission', { intent: 'by_context', hard: true, warnings: 0 }),
  foul('slam', { intent: 'intentional', hard: true, warnings: 0, doctorAbove: 1 }),
  foul('stalling', { intent: 'by_context', warnings: 1 }),
  foul('guard_pull', { intent: 'by_context', warnings: 1 }),
  foul('step_out', { intent: 'by_context', warnings: 1 }),
  foul('eye_gouge', { intent: 'accidental', recoveryMaxS: 300, doctorAbove: 1 }),
  foul('groin', { intent: 'accidental', recoveryMaxS: 300 }),
  foul('small_joint', { intent: 'accidental' }),
  foul('hair_pull', { intent: 'intentional', warnings: 0 }),
  foul('bite_spit', { intent: 'intentional', hard: true, warnings: 0 }),
  foul('abusive', { intent: 'intentional' }),
  foul('disregard', { intent: 'intentional' }),
];

/**
 * ADCC: an intentional strike or an attempted illegal technique is an
 * immediate DQ; negatives are -1 point, not deductions. Accidental eye/groin
 * contact buys 120 s, not 300.                                  [S: RULES §2.6]
 */
export const ADCC_FOULS: FoulRule[] = [
  foul('illegal_submission', { intent: 'by_context', hard: true, warnings: 0 }),
  foul('slam', { intent: 'by_context', warnings: 0, doctorAbove: 1 }),
  foul('guard_pull', { intent: 'by_context', warnings: 0, accidental: 1 }),
  foul('passivity', { intent: 'by_context', warnings: 2, accidental: 1 }),
  foul('fleeing', { intent: 'by_context', warnings: 0, accidental: 1 }),
  foul('stalling', { intent: 'by_context', warnings: 2, accidental: 1 }),
  foul('eye_gouge', { intent: 'accidental', recoveryMaxS: 120, doctorAbove: 1 }),
  foul('groin', { intent: 'accidental', recoveryMaxS: 120 }),
  foul('small_joint', { intent: 'accidental' }),
  foul('bite_spit', { intent: 'intentional', hard: true, warnings: 0 }),
  foul('abusive', { intent: 'intentional' }),
  foul('disregard', { intent: 'intentional' }),
];

/** Sub-only: no points, so only the DQ-class fouls matter. [S: BJJ §9.3] */
export const SUBONLY_FOULS: FoulRule[] = [
  foul('illegal_submission', { intent: 'by_context', hard: true, warnings: 0 }),
  foul('slam', { intent: 'by_context', hard: true, warnings: 0, doctorAbove: 1 }),
  foul('eye_gouge', { intent: 'accidental', recoveryMaxS: 120, doctorAbove: 1 }),
  foul('groin', { intent: 'accidental', recoveryMaxS: 120 }),
  foul('small_joint', { intent: 'accidental' }),
  foul('bite_spit', { intent: 'intentional', hard: true, warnings: 0 }),
  foul('disregard', { intent: 'intentional' }),
];

/**
 * Judo. `deductionIntentional` is read as "shido count": three shido is
 * hansoku-make, and the direct-hansoku-make acts are `hard`. [S: RULES §2.7]
 */
export const JUDO_FOULS: FoulRule[] = [
  foul('leg_grab_judo', { intent: 'by_context', warnings: 0, accidental: 1, intentional: 1 }),
  foul('false_attack', { intent: 'by_context', warnings: 0, accidental: 1, intentional: 1 }),
  foul('passivity', { intent: 'by_context', warnings: 0, accidental: 1, intentional: 1 }),
  foul('step_out', { intent: 'by_context', warnings: 0, accidental: 1, intentional: 1 }),
  foul('defensive_grip', { intent: 'by_context', warnings: 0, accidental: 1, intentional: 1 }),
  foul('head_dive', { intent: 'by_context', hard: true, warnings: 0 }),
  foul('illegal_submission', { intent: 'by_context', hard: true, warnings: 0 }),
  foul('slam', { intent: 'intentional', hard: true, warnings: 0 }),
  foul('disregard', { intent: 'intentional', hard: true, warnings: 0 }),
];

/** Every id used by any catalogue, for the uniqueness test. */
export function foulIds(rules: readonly FoulRule[]): FoulId[] {
  return rules.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// No-contest thresholds
// ---------------------------------------------------------------------------

/** MMA / Muay Thai / GLORY: half the scheduled rounds, rounded up. [S: RULES §6.2] */
export const ncHalf = (scheduled: number): number => Math.ceil(scheduled / 2);
/** Boxing: a flat four completed rounds. [S: RULES §2.3, §6.2] */
export const ncFour = (_scheduled: number): number => 4;
/** Single-period sports have no technical-decision threshold. */
export const ncNever = (_scheduled: number): number => Number.POSITIVE_INFINITY;
