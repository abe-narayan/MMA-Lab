/**
 * RULESET LEGALITY (04 §5).
 *
 * Ten rulesets, three verdicts: legal, restricted (legal but with a caveat the
 * referee may call), illegal (the attempt is a foul - a point deduction or a DQ
 * depending on §06).
 *
 * The matrix is expressed twice, deliberately.
 *
 *  - As a **predicate over `SubmissionClass`** (`classLegality`), because that
 *    is the vocabulary `Ruleset.submissions.legal` speaks in 06 §2.1: a new
 *    combat sport is a data file listing classes, not a list of 54 techniques.
 *  - As a small set of **per-technique overrides**, for the handful of rows in
 *    §5 where the class is not the whole story: a standing guillotine is a
 *    legal choke everywhere and hansoku-make in judo; the crucifix is a legal
 *    position everywhere and banned in ADCC; the neckties are legal chokes
 *    carrying an illegal crank.
 *
 * `submissionLegality` composes the two. A technique with a secondary class
 * (the neckties' crank, a heel hook's knee reap) is never more legal than its
 * strictest class.
 *
 * Source caveats carried from §5: the IBJJF belt matrix is reconstructed and
 * flagged "verify before encoding" in RULES §2.5; the amateur-MMA and sub-only
 * columns are [E] from the IMMAF and EBI rule sets and need verifying too
 * (04 §9.3 open question 4).
 */
import type { Ruleset, SubmissionClass } from '../rules/types';
import { submission } from './catalogue';

export type Legality = 'legal' | 'restricted' | 'illegal';

/** The ten columns of §5. */
export type SubRulesetId =
  | 'mma.pro' | 'mma.amateur'
  | 'ibjjf.white' | 'ibjjf.bluePurple' | 'ibjjf.brownBlackGi' | 'ibjjf.brownBlackNoGi'
  | 'adcc' | 'judo' | 'subonly' | 'street';

export const SUB_RULESET_IDS: readonly SubRulesetId[] = [
  'mma.pro', 'mma.amateur',
  'ibjjf.white', 'ibjjf.bluePurple', 'ibjjf.brownBlackGi', 'ibjjf.brownBlackNoGi',
  'adcc', 'judo', 'subonly', 'street',
];

/** Every `SubmissionClass` 06 §2.1 defines, in declaration order. */
export const SUBMISSION_CLASSES: readonly SubmissionClass[] = [
  'choke_blood', 'choke_air', 'neck_crank', 'elbow_lock', 'shoulder_lock', 'wrist_lock',
  'straight_ankle', 'toe_hold', 'kneebar', 'heel_hook', 'twisting_knee', 'knee_reap',
  'slicer', 'spinal_lock', 'small_joint', 'trachea_grab', 'fish_hook',
];

type ClassRow = Partial<Record<SubmissionClass, Legality>>;

/**
 * Per-ruleset class verdicts. Anything not listed is illegal, which is the
 * safe default: a technique a ruleset never mentions is not one it permits.
 * `small_joint`, `trachea_grab` and `fish_hook` are fouls in every sanctioned
 * ruleset and are only legal in the street column.
 */
const CLASS_MATRIX: Readonly<Record<SubRulesetId, ClassRow>> = {
  // Unified Rules: everything in this catalogue is legal. The illegal entries
  // are fouls (small joints, throat grabs, fish hooks), not submissions.
  'mma.pro': {
    choke_blood: 'legal', choke_air: 'legal', neck_crank: 'legal',
    elbow_lock: 'legal', shoulder_lock: 'legal', wrist_lock: 'legal',
    straight_ankle: 'legal', toe_hold: 'legal', kneebar: 'legal',
    heel_hook: 'legal', twisting_knee: 'legal', knee_reap: 'legal',
    slicer: 'legal', spinal_lock: 'legal',
  },
  // IMMAF-style amateur: the twisting and spinal families come out.
  // [E: verify against the IMMAF Unified Amateur Rules before encoding]
  'mma.amateur': {
    choke_blood: 'legal', choke_air: 'legal',
    elbow_lock: 'legal', shoulder_lock: 'legal', wrist_lock: 'legal',
    straight_ankle: 'legal', kneebar: 'restricted', knee_reap: 'legal',
    neck_crank: 'illegal', toe_hold: 'illegal', heel_hook: 'illegal',
    twisting_knee: 'illegal', slicer: 'illegal', spinal_lock: 'illegal',
  },
  // IBJJF adult white: chokes and upper-body locks plus the straight footlock.
  'ibjjf.white': {
    choke_blood: 'legal', choke_air: 'legal',
    elbow_lock: 'legal', shoulder_lock: 'legal', straight_ankle: 'legal',
  },
  'ibjjf.bluePurple': {
    choke_blood: 'legal', choke_air: 'legal',
    elbow_lock: 'legal', shoulder_lock: 'legal', straight_ankle: 'legal',
  },
  // Brown/black gi adds the compression and rotational foot locks and the
  // kneebar; heel hooks and knee reaping stay out of the gi divisions.
  'ibjjf.brownBlackGi': {
    choke_blood: 'legal', choke_air: 'legal',
    elbow_lock: 'legal', shoulder_lock: 'legal', wrist_lock: 'legal',
    straight_ankle: 'legal', toe_hold: 'legal', kneebar: 'legal', slicer: 'legal',
  },
  // Brown/black no-gi has allowed heel hooks and reaping since 2021.
  'ibjjf.brownBlackNoGi': {
    choke_blood: 'legal', choke_air: 'legal',
    elbow_lock: 'legal', shoulder_lock: 'legal', wrist_lock: 'legal',
    straight_ankle: 'legal', toe_hold: 'legal', kneebar: 'legal', slicer: 'legal',
    heel_hook: 'legal', twisting_knee: 'legal', knee_reap: 'legal',
  },
  // ADCC: leg locks open, the twister legal, cranks restricted (the can opener
  // is fine, both-shoulder downward and chin-twist cranks are not).
  adcc: {
    choke_blood: 'legal', choke_air: 'legal', neck_crank: 'restricted',
    elbow_lock: 'legal', shoulder_lock: 'legal', wrist_lock: 'legal',
    straight_ankle: 'legal', toe_hold: 'legal', kneebar: 'legal',
    heel_hook: 'legal', twisting_knee: 'legal', knee_reap: 'legal',
    slicer: 'legal', spinal_lock: 'legal',
  },
  // IJF ne-waza: shime-waza and elbow kansetsu-waza only. Ude-garami is
  // classified as an elbow lock, so the shoulder family is restricted rather
  // than banned - a pure shoulder crank is not.
  judo: {
    choke_blood: 'legal', choke_air: 'legal',
    elbow_lock: 'legal', shoulder_lock: 'restricted',
  },
  // EBI-style sub-only: everything the catalogue contains.
  subonly: {
    choke_blood: 'legal', choke_air: 'legal', neck_crank: 'legal',
    elbow_lock: 'legal', shoulder_lock: 'legal', wrist_lock: 'legal',
    straight_ankle: 'legal', toe_hold: 'legal', kneebar: 'legal',
    heel_hook: 'legal', twisting_knee: 'legal', knee_reap: 'legal',
    slicer: 'legal', spinal_lock: 'legal',
  },
  street: {
    choke_blood: 'legal', choke_air: 'legal', neck_crank: 'legal',
    elbow_lock: 'legal', shoulder_lock: 'legal', wrist_lock: 'legal',
    straight_ankle: 'legal', toe_hold: 'legal', kneebar: 'legal',
    heel_hook: 'legal', twisting_knee: 'legal', knee_reap: 'legal',
    slicer: 'legal', spinal_lock: 'legal', small_joint: 'legal',
    trachea_grab: 'legal', fish_hook: 'legal',
  },
};

/** The predicate: is this class of submission permitted under this ruleset? */
export function classLegality(ruleset: SubRulesetId, cls: SubmissionClass): Legality {
  return CLASS_MATRIX[ruleset][cls] ?? 'illegal';
}

/**
 * Per-technique exceptions the class predicate cannot express (§5).
 * Each is one cell of the §5 table that disagrees with its class row.
 */
const OVERRIDES: Readonly<Record<string, Partial<Record<SubRulesetId, Legality>>>> = {
  // Standing shime-waza is hansoku-make in judo, whatever the choke is.
  'sub.guillotine_standing': { judo: 'illegal' },
  'sub.arm_triangle_standing': { judo: 'illegal' },
  // A standing entry into a lock is hansoku-make unless it comes off a throw.
  'sub.triangle_flying': { judo: 'restricted' },
  'sub.armbar_flying': { judo: 'restricted' },
  // ADCC lists the crucifix position itself as illegal.
  'sub.crucifix_choke': { adcc: 'illegal' },
  'sub.crucifix_armlock': { adcc: 'illegal', judo: 'restricted' },
  // The guillotine family is fine in ADCC as long as it is not a chin twist.
  'sub.guillotine_ten_finger': { adcc: 'restricted' },
  // Choke first, crank second: legal as a choke, callable as a spinal lock.
  'sub.peruvian_necktie': {
    'mma.amateur': 'restricted', 'ibjjf.white': 'restricted', 'ibjjf.bluePurple': 'restricted',
    'ibjjf.brownBlackGi': 'restricted', 'ibjjf.brownBlackNoGi': 'restricted',
    adcc: 'legal', judo: 'illegal',
  },
  'sub.japanese_necktie': {
    'mma.amateur': 'restricted', 'ibjjf.white': 'restricted', 'ibjjf.bluePurple': 'restricted',
    'ibjjf.brownBlackGi': 'restricted', 'ibjjf.brownBlackNoGi': 'restricted',
    adcc: 'legal', judo: 'illegal',
  },
  // The bulldog's choke variants are fine in judo; the crank version is not.
  'sub.bulldog': {
    judo: 'restricted', 'mma.amateur': 'legal', adcc: 'legal',
    'ibjjf.white': 'legal', 'ibjjf.bluePurple': 'legal',
    'ibjjf.brownBlackGi': 'legal', 'ibjjf.brownBlackNoGi': 'legal',
  },
  // The omoplata is sankaku-garami on the elbow in judo; cranking the shoulder
  // alone is not a judo technique.
  'sub.omoplata': { judo: 'restricted' },
  // The can opener is the one crank ADCC names as permitted.
  'sub.can_opener': { adcc: 'legal' },
  // Leg-spreading: banned below IBJJF brown, which their class row already
  // gives via `kneebar`; judo bans the whole ashi-garami family.
  'sub.suloev_stretch': { 'mma.amateur': 'restricted' },
  'sub.banana_split': { 'mma.amateur': 'restricted' },
  // The gogoplata is kakato-jime, an explicitly listed judo choke.
  'sub.gogoplata': { judo: 'legal' },
};

/**
 * The verdict for one technique under one ruleset. The primary class sets the
 * baseline, any secondary class can only make it stricter, and an explicit §5
 * override wins over both.
 */
export function submissionLegality(ruleset: SubRulesetId, subId: string): Legality {
  const override = OVERRIDES[subId]?.[ruleset];
  if (override !== undefined) return override;
  const spec = submission(subId);
  let verdict = classLegality(ruleset, spec.legalityClass);
  for (const cls of spec.secondaryClasses ?? []) {
    verdict = stricter(verdict, classLegality(ruleset, cls));
  }
  return verdict;
}

function stricter(a: Legality, b: Legality): Legality {
  const rank: Record<Legality, number> = { legal: 0, restricted: 1, illegal: 2 };
  return rank[a] >= rank[b] ? a : b;
}

/** Is the technique in the attacker's selection set at all (§5 closing note)? */
export function isSelectable(ruleset: SubRulesetId, subId: string): boolean {
  return submissionLegality(ruleset, subId) !== 'illegal';
}

/**
 * The same predicate driven by an engine `Ruleset` object rather than by a §5
 * column, so a ruleset defined purely as data (06 §2.1
 * `submissions.legal: SubmissionClass[]`) needs no entry in the table above.
 */
export function isLegalUnderRuleset(ruleset: Ruleset, subId: string): boolean {
  if (!ruleset.submissions.allowed) return false;
  const spec = submission(subId);
  // Perf: a short list, read directly (`includes` is SameValueZero, as a Set);
  // this runs for every offered submission on every ground tick.
  const legal: readonly SubmissionClass[] = ruleset.submissions.legal;
  if (!legal.includes(spec.legalityClass)) return false;
  const secondary = spec.secondaryClasses;
  if (secondary) for (const cls of secondary) if (!legal.includes(cls)) return false;
  // Flying and standing entries additionally need standing locks permitted.
  if (spec.role === 'standing' && !ruleset.submissions.standingLocksAllowed) return false;
  return true;
}

// ---------------------------------------------------------------------------
// the non-submission rows of §5
// ---------------------------------------------------------------------------

/** The ruleset flags this chapter consumes (§5 closing note). */
export interface SubRulesetFlags {
  readonly slamsLegal: boolean;
  readonly slamsOnlyFromLockedSub: boolean;
  readonly spikingLegal: boolean;
  readonly strikesLegal: boolean;
  readonly glovesMma: boolean;
  readonly giGrips: boolean;
  readonly refereeStopsOnLoc: boolean;
  readonly techSubEnabled: boolean;
  readonly kneeReapLegal: boolean;
}

export const RULESET_FLAGS: Readonly<Record<SubRulesetId, SubRulesetFlags>> = {
  'mma.pro': {
    slamsLegal: true, slamsOnlyFromLockedSub: false, spikingLegal: false, strikesLegal: true,
    glovesMma: true, giGrips: false, refereeStopsOnLoc: true, techSubEnabled: true, kneeReapLegal: true,
  },
  'mma.amateur': {
    slamsLegal: true, slamsOnlyFromLockedSub: false, spikingLegal: false, strikesLegal: true,
    glovesMma: true, giGrips: false, refereeStopsOnLoc: true, techSubEnabled: true, kneeReapLegal: true,
  },
  'ibjjf.white': {
    slamsLegal: false, slamsOnlyFromLockedSub: false, spikingLegal: false, strikesLegal: false,
    glovesMma: false, giGrips: true, refereeStopsOnLoc: true, techSubEnabled: true, kneeReapLegal: false,
  },
  'ibjjf.bluePurple': {
    slamsLegal: false, slamsOnlyFromLockedSub: false, spikingLegal: false, strikesLegal: false,
    glovesMma: false, giGrips: true, refereeStopsOnLoc: true, techSubEnabled: true, kneeReapLegal: false,
  },
  'ibjjf.brownBlackGi': {
    slamsLegal: false, slamsOnlyFromLockedSub: false, spikingLegal: false, strikesLegal: false,
    glovesMma: false, giGrips: true, refereeStopsOnLoc: true, techSubEnabled: true, kneeReapLegal: false,
  },
  'ibjjf.brownBlackNoGi': {
    slamsLegal: false, slamsOnlyFromLockedSub: false, spikingLegal: false, strikesLegal: false,
    glovesMma: false, giGrips: false, refereeStopsOnLoc: true, techSubEnabled: true, kneeReapLegal: true,
  },
  // ADCC allows a slam only as an escape from a locked submission.
  adcc: {
    slamsLegal: true, slamsOnlyFromLockedSub: true, spikingLegal: false, strikesLegal: false,
    glovesMma: false, giGrips: false, refereeStopsOnLoc: true, techSubEnabled: true, kneeReapLegal: true,
  },
  judo: {
    slamsLegal: false, slamsOnlyFromLockedSub: false, spikingLegal: false, strikesLegal: false,
    glovesMma: false, giGrips: true, refereeStopsOnLoc: true, techSubEnabled: true, kneeReapLegal: false,
  },
  subonly: {
    slamsLegal: true, slamsOnlyFromLockedSub: true, spikingLegal: false, strikesLegal: false,
    glovesMma: false, giGrips: false, refereeStopsOnLoc: true, techSubEnabled: true, kneeReapLegal: true,
  },
  // No referee, so nobody stops it: the attacker decides when to let go, and a
  // hold held 4 s past unconsciousness produces symptoms (§2.6.3).
  street: {
    slamsLegal: true, slamsOnlyFromLockedSub: false, spikingLegal: true, strikesLegal: true,
    glovesMma: false, giGrips: false, refereeStopsOnLoc: false, techSubEnabled: false, kneeReapLegal: true,
  },
};

/** P(a T0-T1 attacker tries an illegal technique by mistake) per window. */
export const ILLEGAL_ATTEMPT_P_T01 = 0.02;

/** Map the engine's `RulesetId` (06 §2.2) onto this chapter's §5 column. */
export const RULESET_ID_TO_COLUMN: Readonly<Record<string, SubRulesetId>> = {
  'mma.unified.3r': 'mma.pro',
  'mma.unified.5r': 'mma.pro',
  'mma.unified.2017': 'mma.pro',
  'mma.amateur': 'mma.amateur',
  'grappling.ibjjf': 'ibjjf.brownBlackNoGi',
  'grappling.adcc': 'adcc',
  'grappling.subonly': 'subonly',
  'judo.ijf': 'judo',
  street: 'street',
};
