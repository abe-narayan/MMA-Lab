/**
 * THE 54-SUBMISSION CATALOGUE (04 §3), as data.
 *
 * Every entry is a transcription of one §3 sub-section: where the attack is
 * available from, what grips it needs, the four stages with their T4-vs-T4
 * probability and mean duration, the finish clock, where a failure puts both
 * fighters, which chain edges lead in and out, which §2.3 modifiers apply, and
 * the share of MMA submission finishes the technique is calibrated to (§8 C6).
 *
 * Reading the stage numbers: `baseP` is P(this stage is eventually won by the
 * attacker) against a competent equal-skill defender, and `dMeanMs` the mean
 * time it takes. `stages.perWindowBases` turns the pair into the per-window
 * hazards the engine rolls, so changing a research number here never requires
 * touching the resolution code. `Conv` (S2 x S3) is the conversion from a
 * logged attempt and is what §8 C5 calibrates against.
 *
 * Provenance: values are `[S: SUBMISSIONS §2.x]` unless the entry's `tag` says
 * otherwise. Where this chapter moved a research number to hit a FIGHT_DATA
 * row, the entry carries the `[D: ...]` reason - those are the RNC S2/S3, the
 * guillotine S2/S3 and the whole armbar family's S2 (04 §9.2).
 *
 * Duration ranges: the research range where §3 quotes one, otherwise
 * `[0.5 x dMean, 1.5 x dMean]` [E] - the range only feeds presentation and the
 * stall clock, never a probability.
 */
import { SUBMISSION_IDS } from '../core/ids';
import type { SubmissionClass } from '../rules/types';
import type { AttackerRole, SubPositionId } from './positions';
import type { DefenceOptionId, ModifierRef, StageName, Tier } from './stages';
import { STAGE_PARAMS } from './stages';

export type SubFamily = 'choke' | 'jointLock' | 'legLock' | 'crank' | 'compression';
export type ChokeType = 'blood' | 'air' | 'mixed';
export type InjurySeverity = 'medium' | 'high';

/** One way into the attack (§2.4.1 availability). */
export interface SubmissionEntry {
  readonly pos: SubPositionId;
  readonly role: AttackerRole;
  /** Grips / control flags §03 must report true. */
  readonly requires?: readonly string[];
  /** `evt.*` that must have fired within `STAGE_PARAMS.triggerWindowMs`. */
  readonly trigger?: string;
  /** No trigger: the decision is re-evaluated every decision-latency interval. */
  readonly continuous?: boolean;
  /** Logit shift on S1 for this entry only (e.g. RNC from a standing body lock). */
  readonly s1Shift?: number;
  readonly note?: string;
}

export interface SubmissionStageSpec {
  readonly stage: StageName;
  /** P(stage won by the attacker), T4 vs T4. null = not a contested roll. */
  readonly baseP: number | null;
  readonly dMeanMs: number | null;
  readonly durationMsRange: readonly [number, number] | null;
  readonly defences: readonly DefenceOptionId[];
}

export interface FinishClock {
  /** Tap time once locked, uniform over this range (§2.6.2 / §2.6.5). */
  readonly tapMinMs: number;
  readonly tapMaxMs: number;
  /** Mean time to unconsciousness in seconds, chokes only (§2.6.1). */
  readonly locMeanS?: number;
  /** Mixed chokes: P(it becomes a functional blood choke). */
  readonly pBlood?: number;
  /** Non-functional mixed choke: the attacker's forearms give out after this. */
  readonly enduranceMs?: number;
  /** Refusal -> injury delay, joint locks and compressions (§2.6.5). */
  readonly injuryDelayMinMs?: number;
  readonly injuryDelayMaxMs?: number;
  readonly severity?: InjurySeverity;
  readonly injuryJoint?: 'elbow' | 'shoulder' | 'knee' | 'ankle' | 'spine' | 'hip' | 'calf' | 'hamstring';
  /** Cranks: cumulative `state.neck_cranked` severity per 5 s instead of an injury. */
  readonly neckStrainPer5s?: number;
  /** Per-second escape hazard while locked, T4 (§2.6.2 / §2.6.5). */
  readonly escapeHazardPerS: number;
  /** Non-functional mixed chokes escape faster. */
  readonly escapeHazardAirPerS?: number;
  /** Heel hooks: the tear can precede the pain, so even a tapper is hurt. */
  readonly noWarning?: boolean;
  /** Inside heel hook: the smaller arc makes the no-warning property worse. */
  readonly noWarningMult?: number;
}

/** Where the defender's successful escape puts both fighters (§2.7). */
export interface EscapeOutcome {
  /** The node both fighters end in; null = the bout state is unchanged (round end). */
  readonly pos: SubPositionId | null;
  /** The attacker's role in that node afterwards. */
  readonly roleAtt: AttackerRole | 'none';
  readonly share: number;
  readonly note?: string;
}

/** Selection gates: an attack a fighter physically cannot do (§3 entries). */
export interface SelectionGates {
  readonly flexibilityMin?: number;
  readonly chokeSkillMin?: number;
  readonly legLockSkillMin?: number;
  readonly explosivenessMin?: number;
  /** MMA gloves required (Ezekiel from the bottom). */
  readonly requiresGloves?: boolean;
}

export interface SubmissionSpec {
  readonly id: string;
  readonly name: string;
  readonly family: SubFamily;
  readonly chokeType?: ChokeType;
  /** The attacker's usual role; per-entry roles may differ. */
  readonly role: AttackerRole;
  readonly entryPositions: readonly SubmissionEntry[];
  readonly requiredGrips: readonly string[];
  /** [setup, entry, secure, finish]. */
  readonly stages: readonly [SubmissionStageSpec, SubmissionStageSpec, SubmissionStageSpec, SubmissionStageSpec];
  readonly finishClock: FinishClock;
  readonly escapes: readonly EscapeOutcome[];
  readonly abandon: { readonly pos: SubPositionId | null; readonly roleAtt: AttackerRole | 'none'; readonly share?: number };
  readonly counters: readonly string[];
  readonly chains: { readonly out: readonly string[]; readonly in: readonly string[] };
  readonly modifiers: readonly ModifierRef[];
  /** M_GLOVES is signed per technique: grips lose, the Ezekiel gains. */
  readonly glovesTerm?: number;
  /** M_CLASS: FLW/BW triangle and armbar entries. */
  readonly lightClassBonus?: boolean;
  readonly gates?: SelectionGates;
  /** Primary ruleset class (§5 / 06 §2.1 `SubmissionClass`). */
  readonly legalityClass: SubmissionClass;
  /** Extra classes an entry also has to satisfy (necktie crank component, etc.). */
  readonly secondaryClasses?: readonly SubmissionClass[];
  /** Target share of MMA submission finishes, 0-1 (§8 C6). */
  readonly finishShareTarget: number;
  readonly tag: string;
  readonly note?: string;
}

// ---------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------

function setupStage(defences: readonly DefenceOptionId[] = []): SubmissionStageSpec {
  return { stage: 'setup', baseP: null, dMeanMs: null, durationMsRange: null, defences };
}

function st(
  stage: 'entry' | 'secure' | 'finish',
  baseP: number,
  dMeanMs: number,
  defences: readonly DefenceOptionId[],
  range?: readonly [number, number],
): SubmissionStageSpec {
  return {
    stage,
    baseP,
    dMeanMs,
    durationMsRange: range ?? [Math.round(dMeanMs * 0.5), Math.round(dMeanMs * 1.5)],
    defences,
  };
}

/** von Flue is entered at S2: the entry stage is skipped, not failed (§2.17). */
function skippedEntry(): SubmissionStageSpec {
  return { stage: 'entry', baseP: null, dMeanMs: null, durationMsRange: null, defences: [] };
}

/** dMax for a stage: reaching it starts the abandon rolls (§2.4.4). */
export function stageDMaxMs(s: SubmissionStageSpec): number {
  return (s.dMeanMs ?? 0) * STAGE_PARAMS.dMaxFactor;
}

/** Conversion from a logged attempt = S2 x S3 (§3 preamble). */
export function conversion(spec: SubmissionSpec): number {
  return (spec.stages[2].baseP ?? 1) * (spec.stages[3].baseP ?? 1);
}

// Shorthand for the modifier lists, which are the bulk of each entry.
const M = (id: ModifierRef['id'], weight?: number, inverse?: boolean): ModifierRef =>
  weight === undefined && inverse === undefined ? { id } : { id, weight, inverse };

// ---------------------------------------------------------------------------
// §3.1 back attacks
// ---------------------------------------------------------------------------

const BACK_ATTACKS: readonly SubmissionSpec[] = [
  {
    id: 'sub.rnc', name: 'Rear-naked choke', family: 'choke', chokeType: 'blood', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_back_hooks', role: 'top', requires: ['seatbelt', 'hook'], continuous: true },
      { pos: 'pos.ground_back_body_triangle', role: 'top', requires: ['seatbelt'], continuous: true },
      { pos: 'pos.ground_back_seatbelt_no_hooks', role: 'top', requires: ['seatbelt', 'chinExposed'] },
      { pos: 'pos.ground_turtle', role: 'top', trigger: 'evt.turn_away', s1Shift: -0.3 },
      { pos: 'pos.clinch_rear_body_lock', role: 'standing', requires: ['matReturnFirst'], s1Shift: -0.6 },
    ],
    requiredGrips: ['seatbelt over/under', 'chest-to-back', 'hooks or body triangle',
      'S1: choking arm under the chin', 'S2: second hand in (figure-four)'],
    stages: [
      setupStage(),
      st('entry', 0.45, 2000, ['def.two_on_one', 'def.hand_fight', 'def.chin_tuck', 'def.clear_hooks_turn_in'], [1000, 3000]),
      st('secure', 0.50, 4000, ['def.hand_fight', 'def.chin_tuck'], [2000, 6000]),
      st('finish', 0.85, 3000, ['def.slide_to_choking_side', 'def.tap'], [2000, 6000]),
    ],
    finishClock: { tapMinMs: 2000, tapMaxMs: 6000, locMeanS: 8.9, escapeHazardPerS: 0.02 },
    escapes: [
      { pos: 'pos.ground_closed_guard_bottom', roleAtt: 'bottom', share: 0.55, note: 'clear the hook and turn in' },
      { pos: 'pos.ground_turtle', roleAtt: 'top', share: 0.25, note: 'scoot out, then stand' },
      { pos: 'pos.ground_scramble', roleAtt: 'bottom', share: 0.10, note: 'roll over the shoulder' },
      { pos: null, roleAtt: 'none', share: 0.10, note: 'round end' },
    ],
    abandon: { pos: 'pos.ground_back_hooks', roleAtt: 'top' },
    counters: ['none once locked; an aggressive turn-in lands in the attacker guard (T3+)'],
    chains: {
      out: ['edge.sub.rnc_to_armbar_back', 'edge.sub.rnc_to_rear_tri', 'edge.sub.rnc_to_neck_crank',
        'edge.sub.rnc_to_body_tri_gnp', 'edge.sub.rnc_to_mount', 'edge.sub.rnc_to_short'],
      in: ['edge.pos.turtle_to_rnc', 'edge.pos.back_to_rnc', 'edge.sub.guillotine_to_back',
        'edge.sub.armbar_guard_to_back', 'edge.sub.darce_to_back', 'edge.sub.armbar_back_to_rnc'],
    },
    modifiers: [M('M_CTRL'), M('M_SETUP'), M('M_STR_FIN'), M('M_NECK'), M('M_SLIP_LOW'),
      M('M_FAT_ATT'), M('M_FAT_DEF', 1.5)],
    glovesTerm: -0.1,
    legalityClass: 'choke_blood', finishShareTarget: 0.389,
    tag: '[S: SUBMISSIONS §2.1; SUB_FINISH §1a 659/1695] [D: S2 0.60->0.50, S3 0.90->0.85 to meet FIGHT_DATA #73]',
    note: 'S1 re-rolls continuously while back control persists; back control is the finishing context of ~45 % of modern submissions',
  },
  {
    id: 'sub.rnc_short', name: 'Short choke (palm-to-palm RNC)', family: 'choke', chokeType: 'mixed', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_back_hooks', role: 'top', requires: ['seatbelt', 'hook'], continuous: true },
      { pos: 'pos.ground_back_body_triangle', role: 'top', requires: ['seatbelt'], continuous: true },
      { pos: 'pos.ground_back_seatbelt_no_hooks', role: 'top', requires: ['seatbelt', 'chinExposed'] },
    ],
    requiredGrips: ['gable / palm-to-palm behind the neck', 'no figure-four'],
    stages: [
      setupStage(),
      st('entry', 0.45, 2000, ['def.two_on_one', 'def.hand_fight', 'def.chin_tuck', 'def.clear_hooks_turn_in'], [1000, 3000]),
      st('secure', 0.55, 3000, ['def.hand_fight', 'def.chin_tuck'], [2000, 5000]),
      st('finish', 0.75, 3000, ['def.slide_to_choking_side', 'def.tap'], [2000, 6000]),
    ],
    finishClock: { tapMinMs: 2000, tapMaxMs: 8000, locMeanS: 9.0, pBlood: 0.7, escapeHazardPerS: 0.03 },
    escapes: [
      { pos: 'pos.ground_closed_guard_bottom', roleAtt: 'bottom', share: 0.55 },
      { pos: 'pos.ground_turtle', roleAtt: 'top', share: 0.25 },
      { pos: 'pos.ground_scramble', roleAtt: 'bottom', share: 0.10 },
      { pos: null, roleAtt: 'none', share: 0.10 },
    ],
    abandon: { pos: 'pos.ground_back_hooks', roleAtt: 'top' },
    counters: ['as sub.rnc'],
    chains: { out: ['edge.sub.rnc_to_armbar_back', 'edge.sub.rnc_to_neck_crank'], in: ['edge.sub.rnc_to_short'] },
    // It is a squeeze rather than a lever, hence the heavier strength weight.
    modifiers: [M('M_CTRL'), M('M_SETUP'), M('M_STR_FIN', 1.5), M('M_NECK'), M('M_SLIP_LOW'),
      M('M_FAT_ATT'), M('M_FAT_DEF', 1.5)],
    glovesTerm: -0.1,
    legalityClass: 'choke_blood', finishShareTarget: 0,
    tag: '[D: from sub.rnc; S2 +0.05 (no second-hand placement), S3 -0.10 (less head control) per SUBMISSIONS §2.1]',
    note: 'selected 50 % of the time under MMA gloves; logged as an RNC by UFCStats, so its share is folded into sub.rnc',
  },
  {
    id: 'sub.armbar_back', name: 'Armbar from the back', family: 'jointLock', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_back_hooks', role: 'top', trigger: 'evt.hand_posted', requires: ['defenderArmHigh'] },
      { pos: 'pos.ground_back_body_triangle', role: 'top', trigger: 'evt.hand_posted' },
    ],
    requiredGrips: ['control of the defending wrist', 'leg slides over the face', 'fall to the side'],
    stages: [
      setupStage(),
      st('entry', 0.45, 2000, ['def.pull_elbow', 'def.clear_hooks_turn_in'], [1000, 3000]),
      st('secure', 0.45, 4000, ['def.grip_clasp', 'def.hitchhiker', 'def.spin_out'], [2000, 8000]),
      st('finish', 0.80, 1500, ['def.hitchhiker', 'def.tap'], [1000, 3000]),
    ],
    finishClock: {
      tapMinMs: 0, tapMaxMs: 3000, injuryDelayMinMs: 1000, injuryDelayMaxMs: 3000,
      severity: 'high', injuryJoint: 'elbow', escapeHazardPerS: 0.02,
    },
    escapes: [
      { pos: 'pos.ground_half_flat', roleAtt: 'bottom', share: 0.50 },
      { pos: 'pos.ground_back_hooks', roleAtt: 'top', share: 0.50, note: 'attacker retains back control' },
    ],
    abandon: { pos: 'pos.ground_back_hooks', roleAtt: 'top', share: 0.6 },
    counters: ['the defender comes up on top when the attacker falls off'],
    chains: { out: ['edge.sub.armbar_back_to_rnc', 'edge.sub.armbar_to_tri'], in: ['edge.sub.rnc_to_armbar_back'] },
    modifiers: [M('M_CTRL'), M('M_STR_DEF'), M('M_SLIP_LOW'), M('M_FAT_ATT'), M('M_LEN_LEG')],
    glovesTerm: -0.1,
    legalityClass: 'elbow_lock', finishShareTarget: 0.015,
    tag: '[S: SUBMISSIONS §2.7; S2 0.55->0.45 D: armbar family calibration] [E: share split of armbar 11.9 %]',
  },
  {
    id: 'sub.triangle_rear', name: 'Rear triangle', family: 'choke', chokeType: 'blood', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_back_hooks', role: 'top', requires: ['armTrappedInSeatbelt'], trigger: 'evt.hand_posted' },
    ],
    requiredGrips: ['leg over the far shoulder', 'figure-four behind the head', 'arm trapped'],
    stages: [
      setupStage(),
      st('entry', 0.45, 2500, ['def.hand_fight', 'def.clear_hooks_turn_in'], [1000, 4000]),
      st('secure', 0.50, 5000, ['def.answer_phone', 'def.chin_tuck'], [3000, 8000]),
      st('finish', 0.60, 4000, ['def.endure', 'def.tap'], [2000, 8000]),
    ],
    finishClock: { tapMinMs: 5000, tapMaxMs: 15000, locMeanS: 9.5, escapeHazardPerS: 0.02 },
    escapes: [
      { pos: 'pos.ground_back_hooks', roleAtt: 'top', share: 0.50 },
      { pos: 'pos.ground_scramble', roleAtt: 'bottom', share: 0.30 },
      { pos: 'pos.ground_closed_guard_bottom', roleAtt: 'bottom', share: 0.20 },
    ],
    abandon: { pos: 'pos.ground_back_hooks', roleAtt: 'top' },
    counters: [],
    chains: { out: ['edge.sub.rear_tri_to_armbar'], in: ['edge.sub.rnc_to_rear_tri', 'edge.sub.armbar_to_tri'] },
    modifiers: [M('M_CTRL'), M('M_LEN_LEG'), M('M_FLX_ATT'), M('M_NECK'), M('M_SLIP_LOW'), M('M_FAT_ATT')],
    legalityClass: 'choke_blood', finishShareTarget: 0.003,
    tag: '[S: SUBMISSIONS §2.6 "Rear"] [E: escape split, share split of triangle 5.5 %]',
  },
  {
    id: 'sub.neck_crank_rear', name: 'Rear neck crank', family: 'crank', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_back_hooks', role: 'top', requires: ['forearmAcrossJaw'] },
      { pos: 'pos.ground_back_body_triangle', role: 'top', requires: ['forearmAcrossJaw'] },
      { pos: 'pos.ground_back_crucifix', role: 'top' },
    ],
    requiredGrips: ['forearm across the jaw/chin', 'second hand behind the head', 'cervical flexion/rotation'],
    stages: [
      setupStage(),
      st('entry', 0.50, 1500, ['def.two_on_one', 'def.hand_fight']),
      st('secure', 0.50, 3000, ['def.turn_head_toward', 'def.chin_tuck'], [2000, 5000]),
      st('finish', 0.35, 4000, ['def.endure', 'def.tap'], [2000, 8000]),
    ],
    finishClock: { tapMinMs: 2000, tapMaxMs: 10000, neckStrainPer5s: 0.15, escapeHazardPerS: 0.10 },
    escapes: [
      { pos: 'pos.ground_closed_guard_bottom', roleAtt: 'bottom', share: 0.55 },
      { pos: 'pos.ground_turtle', roleAtt: 'top', share: 0.25 },
      { pos: 'pos.ground_scramble', roleAtt: 'bottom', share: 0.10 },
      { pos: null, roleAtt: 'none', share: 0.10 },
    ],
    abandon: { pos: 'pos.ground_back_hooks', roleAtt: 'top' },
    counters: [],
    chains: { out: ['edge.sub.crank_to_rnc'], in: ['edge.sub.rnc_to_neck_crank', 'edge.sub.choke_to_crank'] },
    // The S3 0.35-vs-Advanced / 0.80-vs-Novice gap in the research is produced
    // by M_SKILL plus the T<=1 def.none default, not by a second base number.
    modifiers: [M('M_CTRL'), M('M_STR_FIN', 1.5), M('M_NECK', 1.5), M('M_FAT_ATT')],
    legalityClass: 'neck_crank', finishShareTarget: 0.006,
    tag: '[S: SUBMISSIONS §2.22; SUB_FINISH §1b neck cranks 1.3 % total] [E: rear split 0.6 %]',
  },
  {
    id: 'sub.suloev_stretch', name: 'Suloev stretch', family: 'jointLock', role: 'top',
    entryPositions: [{ pos: 'pos.ground_back_hooks', role: 'top', requires: ['farAnkleReachable'] }],
    requiredGrips: ['far ankle gripped', 'pulled toward the shoulder while keeping the back'],
    stages: [
      setupStage(),
      st('entry', 0.25, 2000, ['def.hide_heel']),
      st('secure', 0.40, 3000, ['def.roll_with']),
      st('finish', 0.60, 2000, ['def.endure', 'def.tap']),
    ],
    finishClock: {
      tapMinMs: 2000, tapMaxMs: 6000, injuryDelayMinMs: 3000, injuryDelayMaxMs: 6000,
      severity: 'medium', injuryJoint: 'hamstring', escapeHazardPerS: 0.05,
    },
    escapes: [
      { pos: 'pos.ground_back_hooks', roleAtt: 'top', share: 0.70 },
      { pos: 'pos.ground_scramble', roleAtt: 'either', share: 0.30 },
    ],
    abandon: { pos: 'pos.ground_back_hooks', roleAtt: 'top' },
    counters: [],
    chains: { out: [], in: [] },
    modifiers: [M('M_CTRL'), M('M_FLX_DEF', 1.5), M('M_STR_FIN')],
    // Legality class: the §5 row matches the kneebar column-for-column (IBJJF
    // treats it as leg-spreading), so it reuses that class.
    legalityClass: 'kneebar', finishShareTarget: 0.0018,
    tag: '[S: SUBMISSIONS §2.29; SUB_FINISH §1a 3/1695] [E: clock]',
  },
  {
    id: 'sub.crucifix_armlock', name: 'Crucifix straight armlock', family: 'jointLock', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_back_crucifix', role: 'top', requires: ['armTrappedBetweenLegs'] },
      { pos: 'pos.ground_crucifix_side', role: 'top', requires: ['armTrappedBetweenLegs'] },
    ],
    requiredGrips: ['leg-trapped arm extended by hip pressure', 'other arm controlled'],
    stages: [
      setupStage(),
      st('entry', 0.35, 3000, ['def.pull_elbow']),
      st('secure', 0.45, 4000, ['def.roll_with']),
      st('finish', 0.55, 2000, ['def.endure', 'def.tap']),
    ],
    finishClock: {
      tapMinMs: 2000, tapMaxMs: 6000, injuryDelayMinMs: 1000, injuryDelayMaxMs: 3000,
      severity: 'high', injuryJoint: 'shoulder', escapeHazardPerS: 0.03,
    },
    escapes: [
      { pos: 'pos.ground_scramble', roleAtt: 'either', share: 0.40 },
      { pos: 'pos.ground_back_crucifix', roleAtt: 'top', share: 0.60 },
    ],
    abandon: { pos: 'pos.ground_back_crucifix', roleAtt: 'top' },
    counters: ['roll to the trapped-arm side'],
    chains: {
      out: ['edge.sub.crucifix_to_choke', 'edge.sub.crucifix_to_crank', 'edge.pos.crucifix_to_gnp'],
      in: ['edge.pos.turtle_to_crucifix'],
    },
    modifiers: [M('M_CTRL'), M('M_STR_FIN'), M('M_FLX_DEF')],
    legalityClass: 'shoulder_lock', finishShareTarget: 0.002,
    tag: '[S: SUBMISSIONS §2.25 "ESTIMATE 3-6 UFC"] [E: injury delay]',
    note: 'the crucifix position itself is illegal in ADCC (§5)',
  },
  {
    id: 'sub.crucifix_choke', name: 'One-arm RNC from the crucifix', family: 'choke', chokeType: 'blood', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_back_crucifix', role: 'top' },
      { pos: 'pos.ground_crucifix_side', role: 'top' },
    ],
    requiredGrips: ['free arm under the chin', 'near arm trapped by the legs'],
    stages: [
      setupStage(),
      st('entry', 0.40, 2000, ['def.hand_fight', 'def.chin_tuck']),
      st('secure', 0.45, 4000, ['def.roll_with']),
      st('finish', 0.65, 3000, ['def.tap']),
    ],
    finishClock: { tapMinMs: 3000, tapMaxMs: 8000, locMeanS: 9.0, escapeHazardPerS: 0.02 },
    escapes: [
      { pos: 'pos.ground_scramble', roleAtt: 'either', share: 0.40 },
      { pos: 'pos.ground_back_crucifix', roleAtt: 'top', share: 0.60 },
    ],
    abandon: { pos: 'pos.ground_back_crucifix', roleAtt: 'top' },
    counters: [],
    chains: { out: ['edge.sub.crucifix_to_crank'], in: ['edge.sub.crucifix_to_choke', 'edge.sub.crank_to_rnc'] },
    modifiers: [M('M_CTRL'), M('M_STR_FIN'), M('M_NECK'), M('M_SLIP_LOW')],
    legalityClass: 'choke_blood', finishShareTarget: 0.001,
    tag: '[E: between sub.rnc_short and sub.crucifix_armlock - the defender has one hand to fight with; S: SUB_FINISH §1a forearm choke 5]',
  },
];

// ---------------------------------------------------------------------------
// §3.2 front-headlock family
// ---------------------------------------------------------------------------

const GUILLOTINE_ENTRIES: readonly SubmissionEntry[] = [
  { pos: 'pos.ground_front_headlock', role: 'top', trigger: 'evt.sprawl_front_headlock' },
  { pos: 'pos.standing_sprawl', role: 'top' },
  { pos: 'pos.ground_closed_guard_broken', role: 'bottom', requires: ['headControl'], trigger: 'evt.posture_broken' },
  { pos: 'pos.ground_butterfly', role: 'bottom', requires: ['headControl'], trigger: 'evt.posture_broken' },
  { pos: 'pos.ground_half_flat', role: 'bottom', trigger: 'evt.posture_broken' },
  { pos: 'pos.ground_scramble', role: 'either', requires: ['wonTheHead'] },
  { pos: 'pos.ground_cage_seated_bottom', role: 'top', requires: ['defenderDucksIn'] },
];

const GUILLOTINE_ESCAPES: readonly EscapeOutcome[] = [
  { pos: 'pos.ground_side_control', roleAtt: 'bottom', share: 0.50, note: 'passed to the choking side' },
  { pos: 'pos.standing_long', roleAtt: 'standing', share: 0.25, note: 'both stand up' },
  { pos: 'pos.ground_closed_guard_bottom', roleAtt: 'bottom', share: 0.25, note: 'attacker abandons to keep guard' },
];

const FRONT_HEADLOCK: readonly SubmissionSpec[] = [
  {
    id: 'sub.guillotine_standard', name: 'Standard (arm-out) guillotine', family: 'choke', chokeType: 'mixed', role: 'either',
    entryPositions: GUILLOTINE_ENTRIES,
    requiredGrips: ['chin strap (blade of the wrist on the throat)', 'palm-on-wrist clasp',
      'head on the attacker own hip side'],
    stages: [
      setupStage(['def.head_up_sit_out']),
      st('entry', 0.55, 1500, ['def.answer_phone', 'def.chin_tuck'], [1000, 3000]),
      st('secure', 0.40, 4000, ['def.walk_weak_side', 'def.posture_up'], [2000, 6000]),
      st('finish', 0.35, 4000, ['def.walk_weak_side', 'def.stack', 'def.slam', 'def.endure', 'def.tap'], [2000, 8000]),
    ],
    finishClock: {
      tapMinMs: 4000, tapMaxMs: 12000, locMeanS: 8.9, pBlood: 0.5, enduranceMs: 15000,
      escapeHazardPerS: 0.02, escapeHazardAirPerS: 0.06,
    },
    escapes: GUILLOTINE_ESCAPES,
    abandon: { pos: 'pos.ground_front_headlock', roleAtt: 'top' },
    counters: ['sub.von_flue after the pass with the grip retained', 'def.slam (pick up and slam)',
      'back take when the attacker rolls'],
    chains: {
      out: ['edge.sub.guillotine_to_darce', 'edge.sub.guillotine_to_anaconda', 'edge.sub.guillotine_to_mounted',
        'edge.sub.guillotine_to_back', 'edge.sub.guillotine_to_tri', 'edge.sub.guillotine_to_armbar',
        'edge.sub.guillotine_to_von_flue'],
      in: ['edge.pos.sprawl_to_fhl', 'edge.sub.kimura_to_guillotine', 'edge.sub.standing_guillotine_to_guard',
        'edge.sub.ezekiel_bottom_to_guillotine', 'edge.sub.darce_to_guillotine'],
    },
    modifiers: [M('M_SLIP_HIGH'), M('M_STR_FIN'), M('M_LEN_ARM', 0.5), M('M_NECK'), M('M_NECK_GIRTH'),
      M('M_FAT_ATT_GRIP'), M('M_CTRL'), M('M_CAGE')],
    glovesTerm: -0.1,
    legalityClass: 'choke_blood', finishShareTarget: 0.095,
    tag: '[S: SUBMISSIONS §2.2; SUB_FINISH §1a family 299/1695] [D: S2 -0.05, S3 -0.10 to meet FIGHT_DATA #73 10-15 % conversion]',
    note: 'the most-attempted technique with the lowest conversion of the big five',
  },
  {
    id: 'sub.guillotine_arm_in', name: 'Arm-in guillotine', family: 'choke', chokeType: 'mixed', role: 'either',
    entryPositions: [...GUILLOTINE_ENTRIES,
      { pos: 'pos.ground_half_flat', role: 'bottom', note: 'finished off the side; closed guard weakens the arm-in' }],
    requiredGrips: ['trapped arm inside the loop', 'shoulder pressure', 'hips angled away from the trapped-head side'],
    stages: [
      setupStage(['def.head_up_sit_out']),
      st('entry', 0.55, 1500, ['def.answer_phone', 'def.chin_tuck', 'def.swim_arm'], [1000, 3000]),
      st('secure', 0.35, 5000, ['def.walk_weak_side', 'def.posture_up', 'def.swim_arm'], [3000, 8000]),
      st('finish', 0.30, 5000, ['def.walk_weak_side', 'def.stack', 'def.endure', 'def.tap'], [3000, 10000]),
    ],
    finishClock: {
      tapMinMs: 6000, tapMaxMs: 20000, locMeanS: 10.2, pBlood: 0.6, enduranceMs: 20000,
      escapeHazardPerS: 0.02, escapeHazardAirPerS: 0.06,
    },
    escapes: GUILLOTINE_ESCAPES,
    abandon: { pos: 'pos.ground_front_headlock', roleAtt: 'top' },
    counters: ['sub.von_flue', 'def.slam'],
    chains: {
      out: ['edge.sub.guillotine_to_darce', 'edge.sub.guillotine_to_anaconda', 'edge.sub.guillotine_to_mounted',
        'edge.sub.guillotine_to_back', 'edge.sub.guillotine_to_von_flue'],
      in: ['edge.pos.sprawl_to_fhl', 'edge.sub.kimura_to_guillotine'],
    },
    modifiers: [M('M_SLIP_HIGH'), M('M_STR_FIN'), M('M_LEN_ARM', 0.5), M('M_NECK'), M('M_NECK_GIRTH'),
      M('M_FAT_ATT_GRIP'), M('M_CTRL'), M('M_CAGE'), M('M_MASS')],
    glovesTerm: -0.1,
    legalityClass: 'choke_blood', finishShareTarget: 0.045,
    tag: '[S: SUBMISSIONS §2.2; D: share = P2 arm-in 9.7 % of chokes applied to the 17.6 % family]',
  },
  {
    id: 'sub.guillotine_high_elbow', name: 'High-elbow guillotine', family: 'choke', chokeType: 'blood', role: 'either',
    entryPositions: GUILLOTINE_ENTRIES,
    requiredGrips: ['choking hand to the opposite shoulder', 'elbow up and over the shoulder',
      'elbows squeeze plus hip thrust'],
    stages: [
      setupStage(['def.head_up_sit_out']),
      st('entry', 0.45, 2000, ['def.answer_phone', 'def.chin_tuck']),
      st('secure', 0.55, 3500, ['def.walk_weak_side', 'def.posture_up'], [2000, 5000]),
      st('finish', 0.65, 3000, ['def.walk_weak_side', 'def.stack', 'def.endure', 'def.tap'], [2000, 5000]),
    ],
    finishClock: { tapMinMs: 3000, tapMaxMs: 8000, locMeanS: 9.0, escapeHazardPerS: 0.02 },
    escapes: GUILLOTINE_ESCAPES,
    abandon: { pos: 'pos.ground_front_headlock', roleAtt: 'top' },
    counters: ['sub.von_flue', 'def.slam'],
    chains: {
      out: ['edge.sub.guillotine_to_darce', 'edge.sub.guillotine_to_mounted', 'edge.sub.guillotine_to_back',
        'edge.sub.guillotine_to_von_flue'],
      in: ['edge.pos.sprawl_to_fhl'],
    },
    // The elbow, not the forearm blade, does the work, so sweat matters less.
    modifiers: [M('M_SLIP_HIGH', 0.7), M('M_STR_FIN'), M('M_LEN_ARM', 0.5), M('M_NECK'), M('M_NECK_GIRTH'),
      M('M_FAT_ATT_GRIP'), M('M_CTRL'), M('M_CAGE')],
    glovesTerm: -0.1,
    gates: { chokeSkillMin: 60 },
    legalityClass: 'choke_blood', finishShareTarget: 0.015,
    tag: '[S: SUBMISSIONS §2.2 table; SUB_COACH "Marcelotine"] [E: share split, slip weight, skill gate]',
  },
  {
    id: 'sub.guillotine_ten_finger', name: 'Ten-finger / power guillotine', family: 'choke', chokeType: 'mixed', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_front_headlock', role: 'top' },
      { pos: 'pos.standing_sprawl', role: 'top' },
      { pos: 'pos.standing_front_headlock', role: 'standing' },
      { pos: 'pos.ground_scramble', role: 'either', requires: ['wonTheHead'] },
    ],
    requiredGrips: ['interlocked fingers under the chin', 'hips back, chest lifted'],
    stages: [
      setupStage(['def.head_up_sit_out']),
      st('entry', 0.60, 1000, ['def.answer_phone', 'def.chin_tuck'], [500, 2000]),
      st('secure', 0.40, 3000, ['def.posture_up', 'def.walk_weak_side'], [2000, 5000]),
      st('finish', 0.45, 4000, ['def.endure', 'def.lift_and_dump', 'def.tap'], [2000, 8000]),
    ],
    finishClock: {
      tapMinMs: 5000, tapMaxMs: 15000, locMeanS: 9.0, pBlood: 0.5, enduranceMs: 12000,
      escapeHazardPerS: 0.02, escapeHazardAirPerS: 0.06,
    },
    escapes: [
      { pos: 'pos.ground_scramble', roleAtt: 'either', share: 0.55, note: 'posture out to scramble or turtle' },
      { pos: 'pos.ground_half_flat', roleAtt: 'bottom', share: 0.20, note: 'lift and dump' },
      { pos: 'pos.ground_front_headlock', roleAtt: 'top', share: 0.25, note: 'attacker abandons' },
    ],
    abandon: { pos: 'pos.ground_front_headlock', roleAtt: 'top' },
    counters: ['def.lift_and_dump'],
    chains: { out: ['edge.sub.guillotine_to_darce', 'edge.sub.guillotine_to_back'], in: ['edge.pos.sprawl_to_fhl'] },
    modifiers: [M('M_SLIP_HIGH'), M('M_STR_FIN', 1.5), M('M_NECK'), M('M_NECK_GIRTH'),
      M('M_FAT_ATT_GRIP'), M('M_CTRL')],
    glovesTerm: -0.1,
    legalityClass: 'choke_blood', finishShareTarget: 0.006,
    tag: '[S: SUBMISSIONS §2.2 table] [E: escape split, strength weight, share split]',
  },
  {
    id: 'sub.guillotine_standing', name: 'Standing guillotine', family: 'choke', chokeType: 'mixed', role: 'standing',
    entryPositions: [
      { pos: 'pos.standing_front_headlock', role: 'standing', trigger: 'evt.head_down_standing' },
      { pos: 'pos.clinch_collar_tie', role: 'standing', trigger: 'evt.head_down_standing', note: 'snap-down' },
      { pos: 'pos.standing_sprawl', role: 'standing', trigger: 'evt.head_down_standing' },
    ],
    requiredGrips: ['chin strap while standing', 'pull up and arch'],
    stages: [
      setupStage(),
      st('entry', 0.50, 1000, ['def.posture_up', 'def.answer_phone']),
      st('secure', 0.35, 3000, ['def.lift_and_dump', 'def.walk_weak_side'], [2000, 5000]),
      st('finish', 0.45, 3000, ['def.lift_and_dump', 'def.endure', 'def.tap'], [2000, 6000]),
    ],
    finishClock: {
      tapMinMs: 3000, tapMaxMs: 8000, locMeanS: 9.0, pBlood: 0.5, enduranceMs: 15000,
      escapeHazardPerS: 0.04, escapeHazardAirPerS: 0.06,
    },
    escapes: [
      { pos: 'pos.clinch_collar_tie', roleAtt: 'standing', share: 0.60, note: 'posture back into the clinch' },
      { pos: 'pos.ground_half_flat', roleAtt: 'bottom', share: 0.40, note: 'lift and dump, slam damage at waist height' },
    ],
    abandon: { pos: 'pos.clinch_collar_tie', roleAtt: 'standing' },
    counters: ['lift / slam', 'driving the head to the far side'],
    chains: {
      out: ['edge.sub.standing_guillotine_to_guard', 'edge.sub.standing_guillotine_dumped',
        'edge.sub.guillotine_to_mounted', 'edge.sub.guillotine_to_darce'],
      in: ['edge.pos.snapdown_to_standing_guillotine', 'edge.sub.kimura_to_guillotine'],
    },
    // M_MASS is read inverse here: a lighter attacker cannot hold a heavier lifter.
    modifiers: [M('M_SLIP_HIGH'), M('M_STR_FIN'), M('M_NECK'), M('M_NECK_GIRTH'), M('M_FAT_ATT_GRIP'),
      M('M_ROCKED', 1.5), M('M_MASS', 1, true)],
    glovesTerm: -0.1,
    legalityClass: 'choke_blood', finishShareTarget: 0.005,
    tag: '[S: SUBMISSIONS §2.26 "ESTIMATE 10-20 UFC"; WR2 Jones-Machida] [E: mass-deficit term]',
  },
  {
    id: 'sub.guillotine_mounted', name: 'Mounted guillotine', family: 'choke', chokeType: 'mixed', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_mount_high', role: 'top', requires: ['chinCupped'] },
      { pos: 'pos.ground_mount_low', role: 'top', requires: ['chinCupped'] },
      { pos: 'pos.ground_half_flat', role: 'top', requires: ['gripKeptAfterDump'] },
    ],
    requiredGrips: ['cup the chin', 'pull to sit', 'lock and finish in place or roll to guard'],
    stages: [
      setupStage(),
      st('entry', 0.50, 1500, ['def.answer_phone', 'def.pull_head_back']),
      st('secure', 0.55, 3000, ['def.frame_and_bridge', 'def.hand_fight'], [2000, 5000]),
      st('finish', 0.70, 3000, ['def.endure', 'def.tap'], [2000, 5000]),
    ],
    finishClock: { tapMinMs: 4000, tapMaxMs: 10000, locMeanS: 9.0, pBlood: 0.7, escapeHazardPerS: 0.02 },
    escapes: [
      { pos: 'pos.ground_mount_low', roleAtt: 'top', share: 0.75, note: 'attacker keeps mount without the choke' },
      { pos: 'pos.ground_half_flat', roleAtt: 'top', share: 0.25, note: 'bottom recovers half guard' },
    ],
    abandon: { pos: 'pos.ground_mount_low', roleAtt: 'top' },
    counters: [],
    chains: {
      out: ['edge.sub.mounted_guillotine_to_arm_tri'],
      in: ['edge.sub.guillotine_to_mounted', 'edge.sub.arm_tri_to_mounted_guillotine'],
    },
    modifiers: [M('M_CTRL'), M('M_MASS'), M('M_STR_FIN'), M('M_SLIP_HIGH'), M('M_NECK'),
      M('M_FAT_ATT_GRIP'), M('M_SETUP')],
    glovesTerm: -0.1,
    legalityClass: 'choke_blood', finishShareTarget: 0.010,
    tag: '[S: SUBMISSIONS §2.2 "Mounted"; §2.28 escape share] [E: share split]',
  },
  {
    id: 'sub.darce', name: "D'Arce / brabo choke", family: 'choke', chokeType: 'blood', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_front_headlock', role: 'top', requires: ['nearArmInside'] },
      { pos: 'pos.ground_half_flat', role: 'top', trigger: 'evt.underhook_from_bottom', note: 'the biggest MMA creator' },
      { pos: 'pos.ground_turtle', role: 'top', trigger: 'evt.turn_away' },
      { pos: 'pos.ground_side_control', role: 'top', trigger: 'evt.turn_away' },
      { pos: 'pos.standing_sprawl', role: 'top', requires: ['headInsideSingle'] },
      { pos: 'pos.ground_knee_on_belly', role: 'top', trigger: 'evt.turn_away' },
      { pos: 'pos.ground_half_dogfight', role: 'top', requires: ['whizzerSide'] },
    ],
    requiredGrips: ['palm-up under the near arm and across the throat', 'grab own biceps (brabo grip)',
      'free hand behind the head', 'sprawl / walk toward the head'],
    stages: [
      setupStage(),
      st('entry', 0.45, 2000, ['def.swim_arm', 'def.go_flat', 'def.head_up_sit_out'], [1000, 3000]),
      st('secure', 0.50, 5500, ['def.post_against_roll', 'def.chin_tuck'], [3000, 8000]),
      st('finish', 0.70, 4000, ['def.roll_with', 'def.tap'], [2000, 6000]),
    ],
    finishClock: { tapMinMs: 3000, tapMaxMs: 10000, locMeanS: 9.0, escapeHazardPerS: 0.02 },
    escapes: [
      { pos: 'pos.ground_turtle', roleAtt: 'top', share: 0.40, note: 'to the knees, attacker keeps the front headlock' },
      { pos: 'pos.ground_half_flat', roleAtt: 'bottom', share: 0.20, note: 'roll through, attacker on the bottom' },
      { pos: 'pos.ground_half_flat', roleAtt: 'top', share: 0.40, note: 'arm free, attacker keeps top half guard' },
    ],
    abandon: { pos: 'pos.ground_front_headlock', roleAtt: 'top' },
    counters: ['roll-through reversal', 'bridge into the attacker on a loose grip', 'low-elbow escape then single leg'],
    chains: {
      out: ['edge.sub.darce_to_anaconda', 'edge.sub.darce_to_arm_tri', 'edge.sub.darce_to_back',
        'edge.sub.darce_to_necktie', 'edge.sub.darce_to_guillotine'],
      in: ['edge.sub.guillotine_to_darce', 'edge.sub.anaconda_to_darce', 'edge.sub.kimura_side_to_darce',
        'edge.sub.necktie_to_darce'],
    },
    // "Long arms finish; short arms fail at S2" is the strongest anthropometric
    // statement in the research, hence the 1.5 weight.
    modifiers: [M('M_LEN_ARM', 1.5), M('M_SLIP_HIGH'), M('M_STR_FIN'), M('M_NECK'),
      M('M_FAT_ATT_GRIP'), M('M_CTRL'), M('M_MASS', 0.5)],
    glovesTerm: -0.1,
    legalityClass: 'choke_blood', finishShareTarget: 0.028,
    tag: '[S: SUBMISSIONS §2.3; SUB_FINISH §1a 47/1695]',
  },
  {
    id: 'sub.anaconda', name: 'Anaconda choke', family: 'choke', chokeType: 'blood', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_front_headlock', role: 'top', requires: ['armUnderNeck'] },
      { pos: 'pos.standing_sprawl', role: 'top' },
      { pos: 'pos.ground_turtle', role: 'top', trigger: 'evt.turn_away' },
    ],
    requiredGrips: ['gator grip (hand on own biceps)', 'trapped elbow driven into the neck',
      'gator roll across the trapped side'],
    stages: [
      setupStage(),
      st('entry', 0.40, 2000, ['def.pull_elbow', 'def.head_up_sit_out']),
      st('secure', 0.50, 5500, ['def.post_against_roll'], [3000, 8000]),
      st('finish', 0.70, 4000, ['def.roll_with', 'def.swim_arm', 'def.tap']),
    ],
    finishClock: { tapMinMs: 3000, tapMaxMs: 10000, locMeanS: 9.0, escapeHazardPerS: 0.02 },
    escapes: [
      { pos: 'pos.ground_turtle', roleAtt: 'top', share: 0.40 },
      { pos: 'pos.ground_half_flat', roleAtt: 'bottom', share: 0.20, note: 'reverse onto top' },
      { pos: 'pos.ground_side_control', roleAtt: 'top', share: 0.40, note: 'arm free' },
    ],
    abandon: { pos: 'pos.ground_front_headlock', roleAtt: 'top' },
    counters: ['roll counter', 'single leg from turtle on a loose grip'],
    chains: {
      out: ['edge.sub.anaconda_to_darce', 'edge.sub.anaconda_to_arm_tri', 'edge.sub.darce_to_back',
        'edge.sub.darce_to_guillotine'],
      in: ['edge.sub.guillotine_to_anaconda', 'edge.sub.darce_to_anaconda', 'edge.sub.necktie_to_anaconda'],
    },
    modifiers: [M('M_LEN_ARM', 1.5), M('M_SLIP_HIGH'), M('M_STR_FIN'), M('M_NECK'),
      M('M_FAT_ATT_GRIP'), M('M_CTRL'), M('M_MASS', 0.5)],
    glovesTerm: -0.1,
    legalityClass: 'choke_blood', finishShareTarget: 0.024,
    tag: '[S: SUBMISSIONS §2.4; SUB_FINISH §1a 40/1695]',
  },
  {
    id: 'sub.peruvian_necktie', name: 'Peruvian necktie', family: 'choke', chokeType: 'mixed', role: 'top',
    entryPositions: [{ pos: 'pos.ground_front_headlock', role: 'top', requires: ['opponentTurtled', 'nearArmIn'] }],
    requiredGrips: ['ten-finger or figure-four arm-in grip', 'sit to the hip, one leg over the neck, one over the back'],
    stages: [
      setupStage(),
      st('entry', 0.40, 2000, ['def.head_up_sit_out', 'def.swim_arm']),
      st('secure', 0.45, 3000, ['def.posture_up'], [2000, 5000]),
      st('finish', 0.60, 3000, ['def.roll_with', 'def.endure', 'def.tap']),
    ],
    finishClock: {
      tapMinMs: 4000, tapMaxMs: 10000, locMeanS: 9.0, pBlood: 0.6, enduranceMs: 15000,
      escapeHazardPerS: 0.02, escapeHazardAirPerS: 0.06,
    },
    escapes: [
      { pos: 'pos.ground_turtle', roleAtt: 'top', share: 0.55, note: 'posture out' },
      { pos: 'pos.ground_open_guard_kneeling_top', roleAtt: 'bottom', share: 0.30, note: 'roll, attacker underneath' },
      { pos: null, roleAtt: 'none', share: 0.15, note: 'round end' },
    ],
    abandon: { pos: 'pos.ground_open_guard_kneeling_top', roleAtt: 'bottom' },
    counters: [],
    chains: {
      out: ['edge.sub.necktie_to_darce', 'edge.sub.necktie_to_anaconda', 'edge.sub.necktie_to_guillotine',
        'edge.sub.peruvian_to_japanese'],
      in: ['edge.sub.darce_to_necktie', 'edge.sub.japanese_to_peruvian'],
    },
    modifiers: [M('M_LEN_ARM'), M('M_SLIP_LOW'), M('M_STR_FIN'), M('M_FLX_ATT', 0.5), M('M_FAT_ATT_GRIP')],
    legalityClass: 'choke_blood', secondaryClasses: ['neck_crank'],
    finishShareTarget: 0.0012,
    tag: '[S: SUBMISSIONS §2.18; SUB_FINISH §1a 2/1695] [E: abandon node]',
    note: 'the crank component makes it restricted wherever spinal locks are banned (§5)',
  },
  {
    id: 'sub.japanese_necktie', name: 'Japanese necktie', family: 'choke', chokeType: 'mixed', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_front_headlock', role: 'top', requires: ['darceGrip'] },
      { pos: 'pos.ground_turtle', role: 'top', requires: ['darceGrip'] },
    ],
    requiredGrips: ["D'Arce grip plus a leg across the back", 'head forced to the chest'],
    stages: [
      setupStage(),
      st('entry', 0.40, 2000, ['def.swim_arm', 'def.go_flat', 'def.head_up_sit_out']),
      st('secure', 0.40, 3000, ['def.post_against_roll', 'def.chin_tuck']),
      st('finish', 0.60, 3000, ['def.roll_with', 'def.endure', 'def.tap']),
    ],
    finishClock: {
      tapMinMs: 4000, tapMaxMs: 10000, locMeanS: 9.0, pBlood: 0.6, enduranceMs: 15000,
      escapeHazardPerS: 0.02, escapeHazardAirPerS: 0.06,
    },
    escapes: [
      { pos: 'pos.ground_turtle', roleAtt: 'top', share: 0.40 },
      { pos: 'pos.ground_half_flat', roleAtt: 'bottom', share: 0.20 },
      { pos: 'pos.ground_half_flat', roleAtt: 'top', share: 0.40 },
    ],
    abandon: { pos: 'pos.ground_front_headlock', roleAtt: 'top' },
    counters: [],
    chains: {
      out: ['edge.sub.necktie_to_darce', 'edge.sub.necktie_to_anaconda', 'edge.sub.necktie_to_guillotine',
        'edge.sub.japanese_to_peruvian'],
      in: ['edge.sub.darce_to_necktie', 'edge.sub.peruvian_to_japanese'],
    },
    modifiers: [M('M_LEN_ARM', 1.5), M('M_SLIP_HIGH'), M('M_STR_FIN'), M('M_NECK'), M('M_FAT_ATT_GRIP'), M('M_CTRL')],
    legalityClass: 'choke_blood', secondaryClasses: ['neck_crank'],
    finishShareTarget: 0.0006,
    tag: '[S: SUBMISSIONS §2.19; SUB_FINISH §6 ">= 1"]',
  },
  {
    id: 'sub.bulldog', name: 'Bulldog choke (side headlock choke)', family: 'choke', chokeType: 'mixed', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_scramble', role: 'either', requires: ['wonTheHeadFromTheSide'] },
      { pos: 'pos.ground_turtle', role: 'top' },
      { pos: 'pos.ground_kesa_gatame', role: 'top', requires: ['headInArmpit'] },
    ],
    requiredGrips: ['head in the armpit', 'forearm across the throat', 'hand clasp', 'drop to the hip'],
    stages: [
      setupStage(),
      st('entry', 0.35, 1500, ['def.pull_head_back', 'def.turn_in_bridge']),
      st('secure', 0.40, 3000, ['def.turn_head_toward']),
      st('finish', 0.45, 5000, ['def.endure', 'def.counter_sub', 'def.tap'], [3000, 8000]),
    ],
    finishClock: {
      tapMinMs: 6000, tapMaxMs: 15000, locMeanS: 9.0, pBlood: 0.3, enduranceMs: 15000,
      escapeHazardPerS: 0.02, escapeHazardAirPerS: 0.06,
    },
    escapes: [
      { pos: 'pos.ground_back_hooks', roleAtt: 'bottom', share: 0.40, note: 'the defender takes the attacker back' },
      { pos: 'pos.ground_scramble', roleAtt: 'either', share: 0.60 },
    ],
    abandon: { pos: 'pos.ground_kesa_gatame', roleAtt: 'top' },
    counters: ['back take on the attacker (T3+)'],
    chains: { out: ['edge.pos.bulldog_to_kesa'], in: ['edge.pos.scramble_to_bulldog'] },
    // "Works on beginners or in chaos": the skill term does most of the work here.
    modifiers: [M('M_STR_FIN', 1.5), M('M_SKILL', 1.5), M('M_ROCKED'), M('M_SLIP_HIGH')],
    legalityClass: 'choke_blood', secondaryClasses: ['neck_crank'],
    finishShareTarget: 0.004,
    tag: '[S: SUBMISSIONS §2.20; §1.2 ">= 6"] [E: pBlood 0.3]',
  },
];

// ---------------------------------------------------------------------------
// §3.3 mount and side-control attacks
// ---------------------------------------------------------------------------

const ARM_TRIANGLE_ESCAPES: readonly EscapeOutcome[] = [
  { pos: 'pos.ground_turtle', roleAtt: 'top', share: 0.50, note: 'bridge and turn to the attacker guard or turtle' },
  { pos: 'pos.ground_side_control', roleAtt: 'top', share: 0.40, note: 'attacker keeps the position without the choke' },
  { pos: 'pos.ground_side_control', roleAtt: 'bottom', share: 0.10, note: 'reversal' },
];

const MOUNT_SIDE: readonly SubmissionSpec[] = [
  {
    id: 'sub.arm_triangle_mount', name: 'Arm-triangle from mount (kata-gatame)', family: 'choke', chokeType: 'blood', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_mount_high', role: 'top', trigger: 'evt.arm_crossed_centre' },
      { pos: 'pos.ground_mount_low', role: 'top', trigger: 'evt.arm_crossed_centre' },
      { pos: 'pos.ground_mount_technical', role: 'top', trigger: 'evt.arm_crossed_centre' },
      { pos: 'pos.ground_half_flat', role: 'top', note: 'knee-slide arm-triangle' },
    ],
    requiredGrips: ['opponent arm across their own neck', 'attacker head on the far side',
      'arm under the neck (hand to own biceps or gable)', 'dismount to the opposite side and sprawl'],
    stages: [
      setupStage(['def.pull_elbow']),
      st('entry', 0.50, 2000, ['def.pull_elbow', 'def.turn_in_bridge'], [1000, 3000]),
      st('secure', 0.55, 7000, ['def.answer_phone', 'def.turn_in_bridge'], [4000, 10000]),
      st('finish', 0.75, 5000, ['def.turn_in_bridge', 'def.endure', 'def.tap'], [3000, 8000]),
    ],
    finishClock: { tapMinMs: 5000, tapMaxMs: 15000, locMeanS: 7.2, escapeHazardPerS: 0.02 },
    escapes: ARM_TRIANGLE_ESCAPES,
    abandon: { pos: 'pos.ground_mount_low', roleAtt: 'top', share: 0.45 },
    counters: ['bridge into the attacker as they step over', 'underhook and come up to a single from half guard'],
    chains: {
      out: ['edge.sub.arm_tri_to_americana_kimura', 'edge.sub.arm_tri_to_mounted_tri', 'edge.sub.arm_tri_to_back',
        'edge.sub.arm_tri_to_mounted_guillotine'],
      in: ['edge.pos.mount_gnp_to_arm_tri', 'edge.sub.darce_to_arm_tri', 'edge.sub.anaconda_to_arm_tri',
        'edge.sub.kimura_side_to_arm_tri', 'edge.sub.americana_to_arm_tri', 'edge.sub.ezekiel_to_arm_tri',
        'edge.sub.mounted_guillotine_to_arm_tri', 'edge.sub.ns_choke_to_arm_tri'],
    },
    modifiers: [M('M_CTRL'), M('M_SETUP'), M('M_MASS', 1.5), M('M_STR_FIN'), M('M_SLIP_HIGH'),
      M('M_NECK'), M('M_LEN_ARM'), M('M_FAT_ATT'), M('M_ROCKED', 1.5)],
    legalityClass: 'choke_blood', finishShareTarget: 0.055,
    tag: '[S: SUBMISSIONS §2.5; SUB_FINISH §1a family 130/1695; P4/W5 tLoc 7.2 s] [E: mount/side split]',
    note: 'the fastest common choke: 7.2 s to unconsciousness, 13 of 92 UFC victims went out',
  },
  {
    id: 'sub.arm_triangle_side', name: 'Arm-triangle from side control', family: 'choke', chokeType: 'blood', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_side_control', role: 'top', trigger: 'evt.arm_crossed_centre' },
      { pos: 'pos.ground_half_flat', role: 'top', trigger: 'evt.arm_crossed_centre' },
      { pos: 'pos.ground_kesa_gatame', role: 'top', requires: ['headAndArmTrapped'] },
    ],
    requiredGrips: ['as mount but without the dismount step', 'walk toward the head, hips low'],
    stages: [
      setupStage(['def.pull_elbow']),
      st('entry', 0.45, 2000, ['def.pull_elbow', 'def.turn_in_bridge']),
      st('secure', 0.50, 6000, ['def.answer_phone', 'def.turn_in_bridge'], [3000, 9000]),
      st('finish', 0.70, 5000, ['def.turn_in_bridge', 'def.endure', 'def.tap']),
    ],
    finishClock: { tapMinMs: 5000, tapMaxMs: 15000, locMeanS: 7.2, escapeHazardPerS: 0.02 },
    escapes: ARM_TRIANGLE_ESCAPES,
    abandon: { pos: 'pos.ground_side_control', roleAtt: 'top' },
    counters: ['bridge into the attacker', 'underhook and come up to a single'],
    chains: {
      out: ['edge.sub.arm_tri_to_americana_kimura', 'edge.sub.arm_tri_to_back'],
      in: ['edge.sub.darce_to_arm_tri', 'edge.sub.anaconda_to_arm_tri', 'edge.sub.kimura_side_to_arm_tri',
        'edge.sub.ns_choke_to_arm_tri', 'edge.sub.standing_arm_tri_to_ground'],
    },
    modifiers: [M('M_CTRL'), M('M_SETUP'), M('M_MASS', 1.5), M('M_STR_FIN'), M('M_SLIP_HIGH'),
      M('M_NECK'), M('M_LEN_ARM'), M('M_FAT_ATT'), M('M_ROCKED', 1.5)],
    legalityClass: 'choke_blood', finishShareTarget: 0.020,
    tag: '[E: mount values -0.05 per stage - no dismount leverage, but no mount-loss risk either]',
  },
  {
    id: 'sub.arm_triangle_standing', name: 'Standing arm-triangle', family: 'choke', chokeType: 'blood', role: 'standing',
    entryPositions: [
      { pos: 'pos.clinch_over_under', role: 'standing', requires: ['armPushedAcross', 'headAndArmGrip'] },
      { pos: 'pos.clinch_collar_tie', role: 'standing', requires: ['armPushedAcross', 'headAndArmGrip'] },
    ],
    requiredGrips: ['head-and-arm grip standing', 'walk the opponent to the fence or drag to the mat'],
    stages: [
      setupStage(),
      st('entry', 0.30, 2000, ['def.pull_elbow', 'def.posture_up']),
      st('secure', 0.30, 4000, ['def.answer_phone', 'def.hand_fight']),
      st('finish', 0.50, 5000, ['def.endure', 'def.tap']),
    ],
    finishClock: { tapMinMs: 5000, tapMaxMs: 15000, locMeanS: 7.2, escapeHazardPerS: 0.05 },
    escapes: [
      { pos: 'pos.clinch_over_under', roleAtt: 'standing', share: 0.70 },
      { pos: 'pos.ground_half_flat', roleAtt: 'bottom', share: 0.30, note: 'takedown on the attacker' },
    ],
    abandon: { pos: 'pos.clinch_over_under', roleAtt: 'standing' },
    counters: ['takedown on the attacker'],
    chains: { out: ['edge.sub.standing_arm_tri_to_ground'], in: [] },
    modifiers: [M('M_MASS'), M('M_STR_FIN'), M('M_SLIP_HIGH'), M('M_NECK'), M('M_LEN_ARM'), M('M_CAGE')],
    legalityClass: 'choke_blood', finishShareTarget: 0.002,
    tag: '[E: rare standing finish; the usual route is to take it to the ground]',
  },
  {
    id: 'sub.armbar_mount', name: 'Armbar from mount', family: 'jointLock', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_mount_s', role: 'top', note: 'primary' },
      { pos: 'pos.ground_mount_high', role: 'top', trigger: 'evt.hand_posted' },
      { pos: 'pos.ground_mount_technical', role: 'top', requires: ['farArm'] },
      { pos: 'pos.ground_mount_gnp', role: 'top', requires: ['straightArmPush'], note: 'T0-T1 bottom behaviour' },
      { pos: 'pos.ground_knee_on_belly', role: 'top', requires: ['farArm'], note: 'shotgun armbar' },
    ],
    requiredGrips: ['arm isolated at the wrist/elbow', 'knee high on the chest', 'step over the head',
      'fall back or stay belly-down'],
    stages: [
      setupStage(['def.pull_elbow']),
      st('entry', 0.55, 2000, ['def.pull_elbow', 'def.posture_up'], [1000, 3000]),
      st('secure', 0.40, 5000, ['def.grip_clasp', 'def.hitchhiker', 'def.spin_out'], [3000, 10000]),
      st('finish', 0.85, 1500, ['def.hitchhiker', 'def.tap'], [1000, 3000]),
    ],
    finishClock: {
      tapMinMs: 0, tapMaxMs: 3000, injuryDelayMinMs: 1000, injuryDelayMaxMs: 3000,
      severity: 'high', injuryJoint: 'elbow', escapeHazardPerS: 0.02,
    },
    escapes: [
      { pos: 'pos.ground_closed_guard_bottom', roleAtt: 'bottom', share: 0.45, note: 'defender comes up into the attacker guard' },
      { pos: 'pos.ground_half_flat', roleAtt: 'bottom', share: 0.15, note: 'hitchhiker / spin-out' },
      { pos: 'pos.ground_mount_low', roleAtt: 'top', share: 0.25, note: 'attacker abandons to keep mount' },
      { pos: 'pos.ground_back_hooks', roleAtt: 'bottom', share: 0.15, note: 'defender takes the back' },
    ],
    abandon: { pos: 'pos.ground_mount_low', roleAtt: 'top' },
    counters: ['stand up into the guard', 'back take when the attacker falls off'],
    chains: {
      out: ['edge.sub.armbar_mount_to_mounted_tri', 'edge.sub.armbar_mount_to_back', 'edge.sub.armbar_to_tri',
        'edge.sub.armbar_mount_lost'],
      in: ['edge.sub.americana_to_armbar', 'edge.sub.mounted_tri_to_armbar', 'edge.pos.throw_to_mount_armbar',
        'edge.sub.arm_tri_to_americana_kimura', 'edge.sub.kimura_to_armbar'],
    },
    modifiers: [M('M_CTRL'), M('M_SETUP'), M('M_STR_DEF'), M('M_FLX_ATT', 0.5), M('M_LEN_LEG'),
      M('M_SLIP_LOW'), M('M_FAT_ATT')],
    glovesTerm: -0.1, lightClassBonus: true,
    legalityClass: 'elbow_lock', finishShareTarget: 0.050,
    tag: '[S: SUBMISSIONS §2.7; SUB_FINISH §1a family 202/1695; S2 -0.10 D: armbar family calibration]',
    note: 'women are 3.03x more likely to lose by an upper-limb lock [S: P5]',
  },
  {
    id: 'sub.armbar_belly_down', name: 'Belly-down armbar from top', family: 'jointLock', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_knee_on_belly', role: 'top', trigger: 'evt.hand_posted' },
      { pos: 'pos.ground_side_control', role: 'top', trigger: 'evt.hand_posted' },
      { pos: 'pos.ground_north_south', role: 'top', trigger: 'evt.hand_posted' },
    ],
    requiredGrips: ['arm trapped against the attacker chest', 'spin to belly-down', 'hips over the elbow'],
    stages: [
      setupStage(['def.pull_elbow']),
      st('entry', 0.50, 1500, ['def.pull_elbow']),
      st('secure', 0.40, 3500, ['def.grip_clasp', 'def.hitchhiker', 'def.spin_out'], [2000, 6000]),
      st('finish', 0.85, 1500, ['def.tap'], [1000, 3000]),
    ],
    finishClock: {
      tapMinMs: 0, tapMaxMs: 3000, injuryDelayMinMs: 1000, injuryDelayMaxMs: 3000,
      severity: 'high', injuryJoint: 'elbow', escapeHazardPerS: 0.02,
    },
    escapes: [
      { pos: 'pos.ground_side_control', roleAtt: 'top', share: 0.45 },
      { pos: 'pos.ground_scramble', roleAtt: 'either', share: 0.30 },
      { pos: 'pos.ground_half_flat', roleAtt: 'bottom', share: 0.25 },
    ],
    abandon: { pos: 'pos.ground_side_control', roleAtt: 'top' },
    counters: [],
    chains: {
      out: ['edge.sub.armbar_to_tri', 'edge.sub.armbar_side_to_kimura'],
      in: ['edge.sub.kimura_to_armbar', 'edge.sub.americana_to_armbar', 'edge.sub.ns_choke_to_kimura'],
    },
    modifiers: [M('M_CTRL'), M('M_SETUP'), M('M_STR_DEF'), M('M_FLX_ATT', 0.5), M('M_LEN_LEG'),
      M('M_SLIP_LOW'), M('M_FAT_ATT')],
    glovesTerm: -0.1, lightClassBonus: true,
    legalityClass: 'elbow_lock', finishShareTarget: 0.005,
    tag: '[S: SUBMISSIONS §2.7 table; S2 -0.10 D] [E: escape split, share split]',
  },
  {
    id: 'sub.americana', name: 'Americana / keylock', family: 'jointLock', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_mount_high', role: 'top', requires: ['armBentAboveShoulderLine'] },
      { pos: 'pos.ground_mount_low', role: 'top', requires: ['armBentAboveShoulderLine'] },
      { pos: 'pos.ground_side_control', role: 'top', requires: ['armBentAboveShoulderLine'] },
      { pos: 'pos.ground_kesa_gatame', role: 'top', requires: ['armBentAboveShoulderLine'] },
    ],
    requiredGrips: ['wrist pinned', 'figure-four under the elbow', 'paint-brush the knuckles along the mat'],
    stages: [
      setupStage(['def.pull_elbow']),
      st('entry', 0.45, 1500, ['def.straighten_arm', 'def.pull_elbow']),
      st('secure', 0.40, 3000, ['def.frame_and_bridge', 'def.grip_clasp'], [2000, 5000]),
      st('finish', 0.75, 2000, ['def.roll_with', 'def.tap']),
    ],
    finishClock: {
      tapMinMs: 2000, tapMaxMs: 6000, injuryDelayMinMs: 2000, injuryDelayMaxMs: 4000,
      severity: 'medium', injuryJoint: 'shoulder', escapeHazardPerS: 0.05,
    },
    escapes: [
      { pos: 'pos.ground_side_control', roleAtt: 'top', share: 0.80, note: 'straighten the arm, top position retained' },
      { pos: 'pos.ground_half_flat', roleAtt: 'top', share: 0.20, note: 'bridge' },
    ],
    abandon: { pos: 'pos.ground_side_control', roleAtt: 'top' },
    counters: ['grab own head'],
    chains: {
      out: ['edge.sub.americana_to_kimura', 'edge.sub.americana_to_armbar', 'edge.sub.americana_to_arm_tri'],
      in: ['edge.sub.arm_tri_to_americana_kimura', 'edge.sub.kimura_to_americana', 'edge.pos.mount_gnp_to_arm_tri'],
    },
    modifiers: [M('M_CTRL'), M('M_STR_FIN', 1.5), M('M_FLX_DEF', 1.5), M('M_SETUP')],
    legalityClass: 'shoulder_lock', finishShareTarget: 0.007,
    tag: '[S: SUBMISSIONS §2.9; §1.2 "ESTIMATE 10-15 UFC"]',
    note: 'high finish rate on beginners, ~0.03 conversion against T5 - produced by M_SKILL plus def.straighten_arm at S1',
  },
  {
    id: 'sub.kimura_side', name: 'Kimura from side control / top half guard', family: 'jointLock', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_side_control', role: 'top', trigger: 'evt.hand_posted' },
      { pos: 'pos.ground_half_flat', role: 'top', trigger: 'evt.hand_posted' },
      { pos: 'pos.ground_reverse_kesa', role: 'top', trigger: 'evt.hand_posted' },
      { pos: 'pos.ground_half_deep', role: 'top', trigger: 'evt.hand_posted' },
    ],
    requiredGrips: ['figure-four on the wrist', 'elbow pinned to the attacker chest',
      'opponent arm trapped by the leg, or "hip in" to stop the roll'],
    stages: [
      setupStage(),
      st('entry', 0.55, 2000, ['def.straighten_arm', 'def.pull_elbow']),
      st('secure', 0.55, 4000, ['def.roll_with', 'def.grip_clasp', 'def.turn_in_bridge'], [2000, 6000]),
      st('finish', 0.80, 2000, ['def.roll_with', 'def.tap'], [1000, 4000]),
    ],
    finishClock: {
      tapMinMs: 1000, tapMaxMs: 4000, injuryDelayMinMs: 1000, injuryDelayMaxMs: 3000,
      severity: 'high', injuryJoint: 'shoulder', escapeHazardPerS: 0.03,
    },
    escapes: [
      { pos: 'pos.ground_side_control', roleAtt: 'top', share: 0.60, note: 'straighten and pull out' },
      { pos: 'pos.ground_half_flat', roleAtt: 'top', share: 0.25, note: 'roll through, the attacker keeps the grip (kimura trap)' },
      { pos: 'pos.ground_half_flat', roleAtt: 'bottom', share: 0.15, note: 'reversal' },
    ],
    abandon: { pos: 'pos.ground_side_control', roleAtt: 'top' },
    counters: ['the bottom fighter roll can reverse (15 %)'],
    chains: {
      out: ['edge.sub.kimura_side_to_ns_choke', 'edge.sub.kimura_side_to_arm_tri', 'edge.sub.kimura_to_armbar',
        'edge.sub.kimura_to_americana', 'edge.sub.kimura_side_to_darce'],
      in: ['edge.sub.americana_to_kimura', 'edge.sub.arm_tri_to_americana_kimura', 'edge.sub.ns_choke_to_kimura',
        'edge.sub.armbar_side_to_kimura', 'edge.sub.inverted_tri_to_kimura'],
    },
    modifiers: [M('M_STR_FIN', 1.5), M('M_SLIP_HIGH'), M('M_FLX_DEF', 1.5), M('M_CTRL'), M('M_FAT_ATT_GRIP')],
    glovesTerm: -0.1,
    legalityClass: 'shoulder_lock', finishShareTarget: 0.013,
    tag: '[S: SUBMISSIONS §2.8 "Side/N-S top"; SUB_FINISH §1a family 46/1695; WR2 Mir-Nogueira]',
    note: 'the strong man submission; second-most injurious lock in the literature',
  },
  {
    id: 'sub.kimura_north_south', name: 'North-south kimura', family: 'jointLock', role: 'top',
    entryPositions: [{ pos: 'pos.ground_north_south', role: 'top', trigger: 'evt.hand_posted' }],
    requiredGrips: ['figure-four on the wrist', 'attacker chest over the shoulder', 'two grips'],
    stages: [
      setupStage(),
      st('entry', 0.55, 2000, ['def.straighten_arm', 'def.pull_elbow']),
      st('secure', 0.55, 4000, ['def.roll_with', 'def.grip_clasp', 'def.turn_in_bridge'], [2000, 6000]),
      st('finish', 0.80, 2000, ['def.roll_with', 'def.tap'], [1000, 4000]),
    ],
    finishClock: {
      tapMinMs: 1000, tapMaxMs: 4000, injuryDelayMinMs: 1000, injuryDelayMaxMs: 3000,
      severity: 'high', injuryJoint: 'shoulder', escapeHazardPerS: 0.03,
    },
    escapes: [
      { pos: 'pos.ground_north_south', roleAtt: 'top', share: 0.60 },
      { pos: 'pos.ground_half_flat', roleAtt: 'top', share: 0.25 },
      { pos: 'pos.ground_half_flat', roleAtt: 'bottom', share: 0.15 },
    ],
    abandon: { pos: 'pos.ground_north_south', roleAtt: 'top' },
    counters: ['the bottom fighter roll can reverse'],
    chains: {
      out: ['edge.sub.kimura_side_to_ns_choke', 'edge.sub.kimura_to_armbar'],
      in: ['edge.sub.ns_choke_to_kimura'],
    },
    modifiers: [M('M_STR_FIN', 1.5), M('M_SLIP_HIGH'), M('M_FLX_DEF', 1.5), M('M_CTRL'), M('M_FAT_ATT_GRIP')],
    glovesTerm: -0.1,
    legalityClass: 'shoulder_lock', finishShareTarget: 0.003,
    tag: '[S: SUBMISSIONS §2.8 pools "Side/N-S top"; SUB_COACH kimura] [E: share split]',
  },
  {
    id: 'sub.north_south_choke', name: 'North-south choke', family: 'choke', chokeType: 'blood', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_north_south', role: 'top' },
      { pos: 'pos.ground_side_control', role: 'top', requires: ['transitionToTheHead'] },
    ],
    requiredGrips: ['arm around the neck', 'shoulder in the throat', 'chest on the face', 'hips low, heads side by side'],
    stages: [
      setupStage(),
      st('entry', 0.45, 2000, ['def.turn_in_bridge']),
      st('secure', 0.45, 5000, ['def.frame_and_bridge', 'def.chin_tuck'], [3000, 8000]),
      st('finish', 0.55, 8000, ['def.turn_in_bridge', 'def.endure', 'def.tap'], [5000, 12000]),
    ],
    finishClock: { tapMinMs: 8000, tapMaxMs: 20000, locMeanS: 9.4, escapeHazardPerS: 0.02 },
    escapes: [
      { pos: 'pos.ground_turtle', roleAtt: 'top', share: 0.50, note: 'bridge and turn to the knees' },
      { pos: 'pos.ground_side_control', roleAtt: 'top', share: 0.50, note: 'attacker resets' },
    ],
    abandon: { pos: 'pos.ground_north_south', roleAtt: 'top' },
    counters: [],
    chains: {
      out: ['edge.sub.ns_choke_to_kimura', 'edge.sub.ns_choke_to_arm_tri', 'edge.pos.ns_to_mount'],
      in: ['edge.sub.kimura_side_to_ns_choke'],
    },
    // "The worst offender in sweat" - the heaviest slip weight in the catalogue.
    modifiers: [M('M_SLIP_HIGH', 1.3), M('M_MASS'), M('M_STR_FIN'), M('M_NECK'), M('M_NECK_GIRTH'),
      M('M_FAT_ATT_GRIP'), M('M_CTRL')],
    legalityClass: 'choke_blood', finishShareTarget: 0.003,
    tag: '[S: SUBMISSIONS §2.15; SUB_FINISH §1a 5/1695; P4/W8 tLoc 9.4 s]',
    note: 'slow: the defender often thinks they are fine and then goes out',
  },
  {
    id: 'sub.ezekiel_top', name: 'Ezekiel choke from mount', family: 'choke', chokeType: 'mixed', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_mount_low', role: 'top', requires: ['headAndArmWrap'] },
      { pos: 'pos.ground_mount_high', role: 'top', requires: ['headAndArmWrap'] },
      { pos: 'pos.ground_closed_guard_broken', role: 'top' },
      { pos: 'pos.ground_back_hooks', role: 'top' },
    ],
    requiredGrips: ['one arm behind the head', 'other hand grips own wrist / glove edge',
      'forearm across the neck'],
    stages: [
      setupStage(),
      st('entry', 0.40, 1500, ['def.pull_head_back']),
      st('secure', 0.40, 3000, ['def.posture_up', 'def.hand_fight', 'def.chin_tuck']),
      st('finish', 0.45, 5000, ['def.endure', 'def.tap'], [3000, 8000]),
    ],
    finishClock: {
      tapMinMs: 5000, tapMaxMs: 15000, locMeanS: 9.0, pBlood: 0.5, enduranceMs: 12000,
      escapeHazardPerS: 0.02, escapeHazardAirPerS: 0.06,
    },
    escapes: [
      { pos: 'pos.ground_mount_low', roleAtt: 'top', share: 0.70 },
      { pos: 'pos.ground_half_flat', roleAtt: 'top', share: 0.30 },
    ],
    abandon: { pos: 'pos.ground_mount_low', roleAtt: 'top' },
    counters: [],
    chains: { out: ['edge.sub.ezekiel_to_arm_tri'], in: ['edge.pos.mount_gnp_to_ezekiel'] },
    modifiers: [M('M_STR_FIN', 1.5), M('M_SLIP_HIGH'), M('M_CTRL'), M('M_MASS', 0.5)],
    // MMA gloves *help* the Ezekiel: the glove edge replaces the gi sleeve.
    glovesTerm: 0.2,
    legalityClass: 'choke_blood', finishShareTarget: 0.002,
    tag: '[S: SUBMISSIONS §2.16; SUB_FINISH §1a both variants 5/1695] [E: split]',
  },
  {
    id: 'sub.ezekiel_bottom', name: 'Ezekiel from the bottom', family: 'choke', chokeType: 'mixed', role: 'bottom',
    entryPositions: [
      { pos: 'pos.ground_mount_low', role: 'bottom', requires: ['topStaysLowAndHeavy'] },
      { pos: 'pos.ground_mount_gnp', role: 'bottom', requires: ['topStaysLowAndHeavy'] },
      { pos: 'pos.ground_half_flat', role: 'bottom' },
    ],
    requiredGrips: ['hug the head', 'drive the forearm across the neck', 'glove-edge grip'],
    stages: [
      setupStage(),
      st('entry', 0.30, 2000, ['def.posture_up', 'def.strike_attacker']),
      st('secure', 0.35, 4000, ['def.posture_up', 'def.strike_attacker']),
      st('finish', 0.40, 6000, ['def.posture_up', 'def.strike_attacker', 'def.tap']),
    ],
    finishClock: {
      tapMinMs: 5000, tapMaxMs: 15000, locMeanS: 9.0, pBlood: 0.5, enduranceMs: 12000,
      escapeHazardPerS: 0.02, escapeHazardAirPerS: 0.06,
    },
    escapes: [
      { pos: 'pos.ground_mount_low', roleAtt: 'bottom', share: 0.90, note: 'top postures out, GnP window opens' },
      { pos: 'pos.ground_half_flat', roleAtt: 'bottom', share: 0.10 },
    ],
    abandon: { pos: 'pos.ground_mount_low', roleAtt: 'bottom' },
    counters: ['posture and strike'],
    chains: { out: ['edge.sub.ezekiel_bottom_to_guillotine'], in: [] },
    modifiers: [M('M_STR_FIN'), M('M_SLIP_HIGH'), M('M_LEN_ARM'), M('M_CTRL', 1, true)],
    glovesTerm: 0.2,
    gates: { requiresGloves: true },
    legalityClass: 'choke_blood', finishShareTarget: 0.001,
    tag: '[S: SUBMISSIONS §2.16 bottom; rule 16 gloves gate; Oleinik x2] [E: escape split]',
  },
  {
    id: 'sub.von_flue', name: 'Von Flue choke', family: 'choke', chokeType: 'blood', role: 'top',
    entryPositions: [
      {
        pos: 'pos.ground_side_control', role: 'top',
        requires: ['bottomHoldsGuillotineAfterThePass'],
        note: 'only reachable via edge.sub.guillotine_to_von_flue (def.counter_sub)',
      },
    ],
    requiredGrips: ['shoulder driven into the neck', 'hands clasped behind the head', 'hips dropped'],
    stages: [
      setupStage(),
      skippedEntry(),
      st('secure', 0.60, 3000, ['def.release_grip', 'def.turn_in_bridge'], [2000, 5000]),
      st('finish', 0.65, 4000, ['def.release_grip', 'def.tap'], [2000, 6000]),
    ],
    finishClock: { tapMinMs: 4000, tapMaxMs: 10000, locMeanS: 9.0, escapeHazardPerS: 0.02 },
    escapes: [
      { pos: 'pos.ground_side_control', roleAtt: 'top', share: 1.0, note: 'the escape is letting the guillotine go' },
    ],
    abandon: { pos: 'pos.ground_side_control', roleAtt: 'top' },
    counters: ['def.release_grip'],
    chains: { out: [], in: ['edge.sub.guillotine_to_von_flue'] },
    modifiers: [M('M_MASS'), M('M_STR_FIN'), M('M_NECK')],
    legalityClass: 'choke_blood', finishShareTarget: 0.005,
    tag: '[S: SUBMISSIONS §2.17; rule 20 release ladder; §1.2 "~8"]',
    note: 'a classic beginner tap: the whole counter depends on the bottom fighter refusing to let go',
  },
  {
    id: 'sub.triangle_mounted', name: 'Mounted triangle', family: 'choke', chokeType: 'blood', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_mount_s', role: 'top', trigger: 'evt.arm_crossed_centre' },
      { pos: 'pos.ground_mount_high', role: 'top', trigger: 'evt.arm_crossed_centre' },
    ],
    requiredGrips: ['S-mount', 'step over the head', 'figure-four the legs'],
    stages: [
      setupStage(),
      st('entry', 0.55, 2000, ['def.pull_elbow', 'def.frame_and_bridge']),
      st('secure', 0.55, 5000, ['def.answer_phone', 'def.chin_tuck'], [3000, 8000]),
      st('finish', 0.70, 4000, ['def.turn_in_bridge', 'def.endure', 'def.tap']),
    ],
    finishClock: { tapMinMs: 5000, tapMaxMs: 15000, locMeanS: 9.5, escapeHazardPerS: 0.02 },
    escapes: [
      { pos: 'pos.ground_side_control', roleAtt: 'top', share: 0.75 },
      { pos: 'pos.ground_half_flat', roleAtt: 'top', share: 0.25 },
    ],
    abandon: { pos: 'pos.ground_side_control', roleAtt: 'top' },
    counters: [],
    chains: {
      out: ['edge.sub.mounted_tri_to_armbar'],
      in: ['edge.sub.tri_to_mounted_tri', 'edge.sub.arm_tri_to_mounted_tri', 'edge.sub.armbar_mount_to_mounted_tri',
        'edge.sub.armbar_to_tri'],
    },
    modifiers: [M('M_CTRL'), M('M_LEN_LEG'), M('M_FLX_ATT'), M('M_NECK'), M('M_SLIP_LOW'),
      M('M_FAT_ATT'), M('M_SETUP')],
    lightClassBonus: true,
    legalityClass: 'choke_blood', finishShareTarget: 0.010,
    tag: '[S: SUBMISSIONS §2.6 "Mounted"; §2.28 escape share] [E: share split]',
  },
];

// ---------------------------------------------------------------------------
// §3.4 guard attacks (bottom)
// ---------------------------------------------------------------------------

const GUARD_ATTACKS: readonly SubmissionSpec[] = [
  {
    id: 'sub.triangle_guard', name: 'Front triangle from guard', family: 'choke', chokeType: 'blood', role: 'bottom',
    entryPositions: [
      { pos: 'pos.ground_closed_guard_broken', role: 'bottom', requires: ['oneArmInOneArmOut'], trigger: 'evt.hand_posted' },
      { pos: 'pos.ground_high_guard', role: 'bottom', requires: ['oneArmInOneArmOut'], trigger: 'evt.hand_posted' },
      { pos: 'pos.ground_open_guard_kneeling_top', role: 'bottom', requires: ['oneArmInOneArmOut'], trigger: 'evt.hand_posted' },
      { pos: 'pos.ground_rubber_guard', role: 'bottom', trigger: 'evt.posture_broken' },
      { pos: 'pos.ground_butterfly', role: 'bottom', trigger: 'evt.hand_posted' },
      { pos: 'pos.ground_half_knee_shield', role: 'bottom', requires: ['kneeShieldRemoved'] },
    ],
    requiredGrips: ['leg over the shoulder', 'diamond or immediate figure-four', 'cut the angle',
      'head pulled down', 'trapped arm across the throat', 'shin behind the knee'],
    stages: [
      setupStage(['def.posture_up']),
      st('entry', 0.50, 2000, ['def.posture_up'], [1000, 3000]),
      st('secure', 0.45, 6500, ['def.answer_phone', 'def.stack', 'def.posture_up', 'def.strike_attacker'], [3000, 10000]),
      st('finish', 0.55, 5000, ['def.stack', 'def.slam', 'def.posture_up', 'def.counter_sub', 'def.endure', 'def.tap'], [3000, 8000]),
    ],
    finishClock: { tapMinMs: 5000, tapMaxMs: 15000, locMeanS: 9.5, escapeHazardPerS: 0.02 },
    escapes: [
      { pos: 'pos.ground_closed_guard_bottom', roleAtt: 'bottom', share: 0.55, note: 'posture out, back in the guard' },
      { pos: 'pos.ground_side_control', roleAtt: 'bottom', share: 0.25, note: 'stack-pass' },
      { pos: 'pos.ground_scramble', roleAtt: 'bottom', share: 0.10, note: 'slam, often a KO' },
      { pos: null, roleAtt: 'none', share: 0.10, note: 'round end' },
    ],
    abandon: { pos: 'pos.ground_closed_guard_bottom', roleAtt: 'bottom', share: 0.75 },
    counters: ['def.slam (legal in MMA, very effective at LHW/HW)', 'knee-slice through the diamond',
      'strikes to the body', 'leg-lock counter on the diamond'],
    chains: {
      out: ['edge.sub.tri_to_armbar', 'edge.sub.tri_to_omoplata', 'edge.sub.tri_to_mounted_tri',
        'edge.sub.tri_to_gogoplata', 'edge.sub.tri_slam', 'edge.sub.tri_diamond_counter'],
      in: ['edge.sub.armbar_to_tri', 'edge.sub.guillotine_to_tri', 'edge.sub.omoplata_to_tri',
        'edge.pos.arm_drag_to_tri', 'edge.sub.kimura_grip_to_tri', 'edge.sub.flying_landed_guard',
        'edge.sub.gogoplata_to_tri'],
    },
    // Leg length against the opponent's torso is the single biggest physical
    // term in the triangle, hence 1.5.
    modifiers: [M('M_FLX_ATT'), M('M_LEN_LEG', 1.5), M('M_STR_DEF'), M('M_SLIP_LOW'), M('M_FAT_ATT'),
      M('M_CAGE'), M('M_CTRL', 1, true)],
    lightClassBonus: true,
    legalityClass: 'choke_blood', finishShareTarget: 0.040,
    tag: '[S: SUBMISSIONS §2.6 "Guard"; SUB_FINISH §1a family 94/1695; P4/W6 tLoc 9.5 s]',
    note: 'stalled triangles of 30-60 s arise from the dMax re-rolls of §2.4.4, not from a special case',
  },
  {
    id: 'sub.triangle_side', name: 'Side triangle (yoko-sankaku)', family: 'choke', chokeType: 'blood', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_side_control', role: 'top', requires: ['armExtendedAcross'] },
      { pos: 'pos.ground_north_south', role: 'top', requires: ['armExtendedAcross'] },
      { pos: 'pos.ground_knee_on_belly', role: 'top', requires: ['armExtendedAcross'] },
    ],
    requiredGrips: ['legs figure-four around the neck and one arm from the side', 'attacker perpendicular'],
    stages: [
      setupStage(),
      st('entry', 0.40, 2500, ['def.pull_elbow', 'def.posture_up']),
      st('secure', 0.45, 5000, ['def.answer_phone', 'def.turn_in_bridge']),
      st('finish', 0.60, 4000, ['def.endure', 'def.tap']),
    ],
    finishClock: { tapMinMs: 5000, tapMaxMs: 15000, locMeanS: 9.5, escapeHazardPerS: 0.02 },
    escapes: [
      { pos: 'pos.ground_half_flat', roleAtt: 'bottom', share: 0.40 },
      { pos: 'pos.ground_side_control', roleAtt: 'top', share: 0.60 },
    ],
    abandon: { pos: 'pos.ground_side_control', roleAtt: 'top' },
    counters: [],
    chains: { out: ['edge.sub.tri_to_armbar'], in: ['edge.sub.armbar_to_tri'] },
    modifiers: [M('M_CTRL'), M('M_LEN_LEG'), M('M_FLX_ATT'), M('M_NECK'), M('M_SLIP_LOW'), M('M_FAT_ATT')],
    legalityClass: 'choke_blood', finishShareTarget: 0.001,
    tag: '[E: between guard and mounted values; entered mostly as a chain] [S: SUB_COACH triangle "yoko-sankaku"]',
  },
  {
    id: 'sub.triangle_inverted', name: 'Inverted / reverse triangle', family: 'choke', chokeType: 'blood', role: 'bottom',
    entryPositions: [
      { pos: 'pos.ground_side_control', role: 'bottom', requires: ['headAndArmCaughtWhilePassing'] },
      { pos: 'pos.ground_north_south', role: 'bottom', requires: ['headAndArmCaughtWhilePassing'] },
      { pos: 'pos.ground_open_guard_kneeling_top', role: 'bottom', requires: ['invertedGuard'] },
    ],
    requiredGrips: ['legs locked around the neck and one arm with the attacker inverted'],
    stages: [
      setupStage(),
      st('entry', 0.30, 2500, ['def.posture_up']),
      st('secure', 0.40, 5000, ['def.stack', 'def.answer_phone']),
      st('finish', 0.60, 4000, ['def.slam', 'def.endure', 'def.tap']),
    ],
    finishClock: { tapMinMs: 5000, tapMaxMs: 15000, locMeanS: 9.5, escapeHazardPerS: 0.02 },
    escapes: [
      { pos: 'pos.ground_side_control', roleAtt: 'bottom', share: 0.70 },
      { pos: 'pos.ground_side_control', roleAtt: 'top', share: 0.30, note: 'attacker sweeps to top' },
    ],
    abandon: { pos: 'pos.ground_open_guard_kneeling_top', roleAtt: 'bottom' },
    counters: [],
    chains: { out: ['edge.sub.tri_to_armbar', 'edge.sub.inverted_tri_to_kimura'], in: [] },
    modifiers: [M('M_FLX_ATT', 2), M('M_LEN_LEG'), M('M_STR_DEF'), M('M_SLIP_LOW')],
    gates: { chokeSkillMin: 60, flexibilityMin: 60 },
    legalityClass: 'choke_blood', finishShareTarget: 0.0024,
    tag: '[S: SUBMISSIONS §2.6 "very rare in MMA"; SUB_FINISH §1a 4/1695] [E: stage values, gates]',
  },
  {
    id: 'sub.armbar_guard', name: 'Armbar from guard (juji-gatame)', family: 'jointLock', role: 'bottom',
    entryPositions: [
      { pos: 'pos.ground_closed_guard_broken', role: 'bottom', trigger: 'evt.hand_posted' },
      { pos: 'pos.ground_high_guard', role: 'bottom', trigger: 'evt.hand_posted' },
      { pos: 'pos.ground_open_guard_kneeling_top', role: 'bottom', trigger: 'evt.hand_posted' },
      { pos: 'pos.ground_rubber_guard', role: 'bottom', trigger: 'evt.posture_broken' },
    ],
    requiredGrips: ['wrist/elbow control', 'hips under the shoulder', 'leg over the face', 'cut the angle',
      'knees pinched, thumb up, elbow above the hip'],
    stages: [
      setupStage(['def.pull_elbow']),
      st('entry', 0.45, 2000, ['def.pull_elbow', 'def.posture_up'], [1000, 3000]),
      st('secure', 0.35, 6000, ['def.grip_clasp', 'def.hitchhiker', 'def.stack', 'def.spin_out', 'def.slam'], [3000, 12000]),
      st('finish', 0.85, 1500, ['def.hitchhiker', 'def.slam', 'def.tap'], [1000, 3000]),
    ],
    finishClock: {
      tapMinMs: 0, tapMaxMs: 3000, injuryDelayMinMs: 1000, injuryDelayMaxMs: 3000,
      severity: 'high', injuryJoint: 'elbow', escapeHazardPerS: 0.02,
    },
    escapes: [
      { pos: 'pos.ground_closed_guard_bottom', roleAtt: 'bottom', share: 0.45, note: 'posture and pull out' },
      { pos: 'pos.ground_side_control', roleAtt: 'bottom', share: 0.25, note: 'stack and pass' },
      { pos: 'pos.ground_half_flat', roleAtt: 'bottom', share: 0.15, note: 'hitchhiker / spin-out' },
      { pos: 'pos.ground_closed_guard_bottom', roleAtt: 'bottom', share: 0.15, note: 'attacker abandons' },
    ],
    abandon: { pos: 'pos.ground_closed_guard_bottom', roleAtt: 'bottom' },
    counters: ['def.slam (the lock breaks with p 0.8)', 'stack-pass'],
    chains: {
      out: ['edge.sub.armbar_to_tri', 'edge.sub.armbar_to_omoplata', 'edge.sub.armbar_guard_to_back',
        'edge.sub.tri_slam'],
      in: ['edge.sub.tri_to_armbar', 'edge.sub.kimura_to_armbar', 'edge.sub.omoplata_to_armbar',
        'edge.sub.guillotine_to_armbar', 'edge.sub.flying_landed_guard'],
    },
    modifiers: [M('M_FLX_ATT', 0.5), M('M_LEN_LEG'), M('M_STR_DEF', 1.5), M('M_SLIP_LOW'),
      M('M_CAGE'), M('M_FAT_ATT')],
    glovesTerm: -0.1, lightClassBonus: true,
    legalityClass: 'elbow_lock', finishShareTarget: 0.045,
    tag: '[S: SUBMISSIONS §2.7; S2 -0.10 D: armbar family calibration; WR2 Mir-Sylvia, Rousey-Tate]',
  },
  {
    id: 'sub.kimura_guard', name: 'Kimura from closed guard', family: 'jointLock', role: 'bottom',
    entryPositions: [
      { pos: 'pos.ground_closed_guard_bottom', role: 'bottom', trigger: 'evt.hand_posted' },
      { pos: 'pos.ground_closed_guard_broken', role: 'bottom', trigger: 'evt.hand_posted' },
      { pos: 'pos.ground_butterfly', role: 'bottom', trigger: 'evt.hand_posted' },
    ],
    requiredGrips: ['figure-four on the wrist', 'sit up, hip out, elbow pinned'],
    stages: [
      setupStage(),
      st('entry', 0.50, 2000, ['def.straighten_arm', 'def.posture_up']),
      st('secure', 0.35, 4000, ['def.roll_with', 'def.grip_clasp', 'def.posture_up'], [2000, 6000]),
      st('finish', 0.65, 2500, ['def.roll_with', 'def.tap']),
    ],
    finishClock: {
      tapMinMs: 1000, tapMaxMs: 4000, injuryDelayMinMs: 1000, injuryDelayMaxMs: 3000,
      severity: 'high', injuryJoint: 'shoulder', escapeHazardPerS: 0.03,
    },
    escapes: [
      { pos: 'pos.ground_closed_guard_bottom', roleAtt: 'bottom', share: 0.60 },
      { pos: 'pos.ground_half_flat', roleAtt: 'top', share: 0.25, note: 'roll through: the kimura trap sweep' },
      { pos: 'pos.standing_long', roleAtt: 'standing', share: 0.15, note: 'stand up out of the guard' },
    ],
    abandon: { pos: 'pos.ground_closed_guard_bottom', roleAtt: 'bottom' },
    counters: ['the top fighter passes over the kimura leg'],
    chains: {
      out: ['edge.sub.kimura_to_sweep', 'edge.sub.kimura_to_back', 'edge.sub.kimura_to_armbar',
        'edge.sub.kimura_grip_to_tri'],
      in: ['edge.sub.omoplata_to_kimura', 'edge.sub.tri_to_omoplata'],
    },
    modifiers: [M('M_STR_FIN', 1.5), M('M_SLIP_HIGH'), M('M_FLX_DEF', 1.5), M('M_FAT_ATT_GRIP'), M('M_CTRL', 1, true)],
    glovesTerm: -0.1,
    legalityClass: 'shoulder_lock', finishShareTarget: 0.007,
    tag: '[S: SUBMISSIONS §2.8 "Guard"] [E: share split]',
  },
  {
    id: 'sub.kimura_half', name: 'Kimura from bottom half guard', family: 'jointLock', role: 'bottom',
    entryPositions: [
      { pos: 'pos.ground_half_flat', role: 'bottom', trigger: 'evt.hand_posted' },
      { pos: 'pos.ground_half_knee_shield', role: 'bottom', trigger: 'evt.hand_posted' },
      { pos: 'pos.ground_half_dogfight', role: 'bottom', requires: ['whizzerArm'] },
      { pos: 'pos.ground_half_underhook', role: 'bottom', requires: ['kimuraTrapGrip'] },
    ],
    requiredGrips: ['figure-four on the wrist', 'hip out, elbow pinned'],
    stages: [
      setupStage(),
      st('entry', 0.45, 2000, ['def.straighten_arm', 'def.posture_up']),
      st('secure', 0.35, 4000, ['def.roll_with', 'def.grip_clasp', 'def.posture_up'], [2000, 6000]),
      st('finish', 0.60, 2500, ['def.roll_with', 'def.tap']),
    ],
    finishClock: {
      tapMinMs: 1000, tapMaxMs: 4000, injuryDelayMinMs: 1000, injuryDelayMaxMs: 3000,
      severity: 'high', injuryJoint: 'shoulder', escapeHazardPerS: 0.03,
    },
    escapes: [
      { pos: 'pos.ground_half_flat', roleAtt: 'bottom', share: 0.60 },
      { pos: 'pos.ground_half_flat', roleAtt: 'top', share: 0.25, note: 'roll through = the attacker sweep' },
      { pos: 'pos.standing_long', roleAtt: 'standing', share: 0.15 },
    ],
    abandon: { pos: 'pos.ground_half_flat', roleAtt: 'bottom' },
    counters: ['butterfly lift', 'T-kimura reversal'],
    chains: {
      out: ['edge.sub.kimura_to_sweep', 'edge.sub.kimura_to_back', 'edge.sub.kimura_to_armbar'],
      in: ['edge.pos.underhook_to_kimura_trap'],
    },
    modifiers: [M('M_STR_FIN', 1.5), M('M_SLIP_HIGH'), M('M_FLX_DEF', 1.5), M('M_FAT_ATT_GRIP'), M('M_CTRL', 1, true)],
    glovesTerm: -0.1,
    legalityClass: 'shoulder_lock', finishShareTarget: 0.005,
    tag: '[S: SUBMISSIONS §2.8 "Half-guard bottom"; K4b back take] [E: share split]',
  },
  {
    id: 'sub.kimura_grip', name: 'Kimura grip (standing / whizzer / kimura trap)', family: 'jointLock', role: 'either',
    entryPositions: [
      { pos: 'pos.clinch_whizzer', role: 'either', requires: ['armExposed'] },
      { pos: 'pos.clinch_over_under', role: 'either', requires: ['armExposed'] },
      { pos: 'pos.ground_half_dogfight', role: 'either', requires: ['armExposed'] },
      { pos: 'pos.ground_turtle', role: 'top', note: 'rolling kimura' },
      { pos: 'pos.ground_half_underhook', role: 'bottom', requires: ['kimuraTrapGrip'] },
    ],
    requiredGrips: ['the figure-four grip is the constant through transitions; the finish is secondary'],
    stages: [
      setupStage(),
      st('entry', 0.35, 2000, ['def.straighten_arm']),
      st('secure', 0.30, 4000, ['def.roll_with', 'def.grip_clasp']),
      st('finish', 0.50, 3000, ['def.roll_with', 'def.tap']),
    ],
    finishClock: {
      tapMinMs: 1000, tapMaxMs: 4000, injuryDelayMinMs: 1000, injuryDelayMaxMs: 3000,
      severity: 'high', injuryJoint: 'shoulder', escapeHazardPerS: 0.03,
    },
    escapes: [
      { pos: 'pos.clinch_over_under', roleAtt: 'standing', share: 0.70 },
      { pos: 'pos.ground_scramble', roleAtt: 'either', share: 0.30 },
    ],
    abandon: { pos: 'pos.clinch_over_under', roleAtt: 'standing' },
    counters: ['pull the arm out'],
    chains: {
      out: ['edge.sub.kimura_to_sweep', 'edge.sub.kimura_to_back', 'edge.sub.kimura_to_takedown',
        'edge.sub.kimura_to_armbar', 'edge.sub.kimura_to_guillotine'],
      in: ['edge.pos.single_leg_to_kimura_trap', 'edge.pos.underhook_to_kimura_trap'],
    },
    modifiers: [M('M_STR_FIN', 1.5), M('M_SLIP_HIGH'), M('M_FLX_DEF')],
    glovesTerm: -0.1,
    legalityClass: 'shoulder_lock', finishShareTarget: 0.002,
    tag: '[S: SUBMISSIONS §2.8 "Standing/clinch"; BJ7 Avellan system] [E: escape split, share]',
    note: 'as *control* the S1 success immediately rolls the chain table (sweep 0.35 / back 0.20 / takedown 0.20 / armbar 0.10 / guillotine 0.10 / hold 0.05) instead of proceeding to S2',
  },
  {
    id: 'sub.omoplata', name: 'Omoplata', family: 'jointLock', role: 'bottom',
    entryPositions: [
      { pos: 'pos.ground_closed_guard_broken', role: 'bottom', requires: ['armOutsideTheHip'], trigger: 'evt.hand_posted' },
      { pos: 'pos.ground_high_guard', role: 'bottom', requires: ['armOutsideTheHip'], trigger: 'evt.hand_posted' },
      { pos: 'pos.ground_rubber_guard', role: 'bottom', requires: ['armOutsideTheHip'] },
      { pos: 'pos.ground_open_guard_kneeling_top', role: 'bottom', trigger: 'evt.hand_posted' },
    ],
    requiredGrips: ['leg over the shoulder', 'sit up perpendicular', 'control the hip/belt to stop the forward roll'],
    stages: [
      setupStage(),
      st('entry', 0.45, 2000, ['def.posture_up']),
      st('secure', 0.35, 4000, ['def.roll_with', 'def.posture_up', 'def.strike_attacker'], [2000, 6000]),
      st('finish', 0.30, 3000, ['def.step_over_head', 'def.stack', 'def.tap']),
    ],
    finishClock: {
      tapMinMs: 3000, tapMaxMs: 8000, injuryDelayMinMs: 3000, injuryDelayMaxMs: 6000,
      severity: 'medium', injuryJoint: 'shoulder', escapeHazardPerS: 0.10,
    },
    escapes: [
      { pos: 'pos.ground_side_control', roleAtt: 'top', share: 0.45, note: 'forward roll: the attacker usually gets the sweep' },
      { pos: 'pos.ground_closed_guard_bottom', roleAtt: 'bottom', share: 0.35, note: 'posture out' },
      { pos: 'pos.standing_long', roleAtt: 'standing', share: 0.20, note: 'stand up, both free' },
    ],
    abandon: { pos: 'pos.ground_closed_guard_bottom', roleAtt: 'bottom' },
    counters: ['stack into the attacker', 'strikes during the sit-up'],
    chains: {
      out: ['edge.sub.omoplata_to_sweep', 'edge.sub.omoplata_to_tri', 'edge.sub.omoplata_to_armbar',
        'edge.sub.omoplata_to_kimura', 'edge.sub.omoplata_to_back', 'edge.sub.omoplata_to_gogoplata'],
      in: ['edge.sub.tri_to_omoplata', 'edge.sub.armbar_to_omoplata', 'edge.pos.knee_slice_to_omoplata',
        'edge.sub.gogoplata_to_omoplata'],
    },
    // The omoplata slope is 0.12/10 = 1.5 x the triangle slope.
    modifiers: [M('M_FLX_ATT', 1.5), M('M_LEN_LEG'), M('M_SLIP_HIGH'), M('M_STR_DEF'), M('M_CAGE')],
    legalityClass: 'shoulder_lock', finishShareTarget: 0.0012,
    tag: '[S: SUBMISSIONS §2.10; SUB_FINISH §1a 2/1695]',
    note: 'as a sweep it converts at S1 x 0.85 ~ 0.40, which is what edge.sub.omoplata_to_sweep carries',
  },
  {
    id: 'sub.gogoplata', name: 'Gogoplata', family: 'choke', chokeType: 'blood', role: 'bottom',
    entryPositions: [
      { pos: 'pos.ground_rubber_guard', role: 'bottom', requires: ['missionControl'] },
      { pos: 'pos.ground_mount_s', role: 'top', note: 'mounted gogoplata' },
    ],
    requiredGrips: ['foot to the throat via mission control', 'hands pull the head down onto the shin'],
    stages: [
      setupStage(),
      st('entry', 0.25, 2500, ['def.posture_up', 'def.strike_attacker']),
      st('secure', 0.35, 4000, ['def.pull_head_back', 'def.hand_fight']),
      st('finish', 0.50, 4000, ['def.endure', 'def.tap']),
    ],
    finishClock: { tapMinMs: 4000, tapMaxMs: 10000, locMeanS: 9.0, escapeHazardPerS: 0.03 },
    escapes: [{ pos: 'pos.ground_closed_guard_bottom', roleAtt: 'bottom', share: 1.0, note: 'posture: back in guard' }],
    abandon: { pos: 'pos.ground_closed_guard_bottom', roleAtt: 'bottom' },
    counters: ['posture and strike'],
    chains: {
      out: ['edge.sub.gogoplata_to_omoplata', 'edge.sub.gogoplata_to_tri'],
      in: ['edge.sub.omoplata_to_gogoplata', 'edge.sub.tri_to_gogoplata'],
    },
    modifiers: [M('M_FLX_ATT', 1.5), M('M_LEN_LEG'), M('M_SLIP_LOW'), M('M_STR_FIN', 0.5)],
    gates: { flexibilityMin: 80 },
    legalityClass: 'choke_blood', finishShareTarget: 0.0002,
    tag: '[S: SUBMISSIONS §2.23; rule 14 flexibility gate 80; SUB_FINISH §6 zero official UFC] [E: flavour-level share]',
  },
  {
    id: 'sub.buggy_choke', name: 'Buggy choke', family: 'choke', chokeType: 'blood', role: 'bottom',
    entryPositions: [
      { pos: 'pos.ground_side_control', role: 'bottom', requires: ['topHeadOnNearSide', 'attackerLegFree'] },
      { pos: 'pos.ground_kesa_gatame', role: 'bottom', requires: ['topHeadOnNearSide', 'attackerLegFree'] },
    ],
    requiredGrips: ['near arm around the top head', 'grab own leg/shin', 'close the arm-triangle with the leg'],
    stages: [
      setupStage(),
      st('entry', 0.30, 2500, ['def.posture_up', 'def.strike_attacker']),
      st('secure', 0.35, 5000, ['def.answer_phone', 'def.turn_in_bridge']),
      st('finish', 0.55, 4000, ['def.endure', 'def.tap']),
    ],
    finishClock: { tapMinMs: 4000, tapMaxMs: 12000, locMeanS: 9.0, escapeHazardPerS: 0.03 },
    escapes: [
      { pos: 'pos.ground_north_south', roleAtt: 'bottom', share: 0.70 },
      { pos: 'pos.ground_side_control', roleAtt: 'top', share: 0.30, note: 'attacker sweeps to top' },
    ],
    abandon: { pos: 'pos.ground_side_control', roleAtt: 'bottom' },
    counters: ['posture and pass to north-south'],
    chains: { out: ['edge.sub.buggy_to_sweep'], in: [] },
    modifiers: [M('M_FLX_ATT', 1.5), M('M_LEN_ARM'), M('M_MASS', 1, true), M('M_SLIP_HIGH'), M('M_STR_FIN')],
    gates: { flexibilityMin: 70 },
    legalityClass: 'choke_blood', finishShareTarget: 0.0002,
    tag: '[E: rare and positionally weak; between the gogoplata and the side arm-triangle] [S: §1.2 Cage Warriors 2024]',
  },
  {
    id: 'sub.can_opener', name: 'Can opener', family: 'crank', role: 'top',
    entryPositions: [{ pos: 'pos.ground_closed_guard_bottom', role: 'top', requires: ['opponentHoldsClosedGuard'] }],
    requiredGrips: ['hands clasped behind the head', 'pull the head to the chest (cervical flexion)'],
    stages: [
      setupStage(),
      st('entry', 0.50, 1500, ['def.posture_up', 'def.chin_tuck']),
      st('secure', 0.50, 3000, ['def.posture_up', 'def.chin_tuck']),
      st('finish', 0.30, 5000, ['def.endure', 'def.tap']),
    ],
    finishClock: { tapMinMs: 2000, tapMaxMs: 10000, neckStrainPer5s: 0.15, escapeHazardPerS: 0.10 },
    escapes: [
      { pos: 'pos.ground_open_guard_kneeling_top', roleAtt: 'top', share: 0.90, note: 'the guard opens - the intended outcome' },
      { pos: 'pos.ground_closed_guard_bottom', roleAtt: 'top', share: 0.10 },
    ],
    abandon: { pos: 'pos.ground_open_guard_kneeling_top', roleAtt: 'top' },
    counters: ['open the guard and put the hands on the mat'],
    chains: { out: ['edge.pos.can_opener_to_pass'], in: [] },
    modifiers: [M('M_STR_FIN'), M('M_NECK', 1.5)],
    legalityClass: 'neck_crank', finishShareTarget: 0.001,
    tag: '[S: SUBMISSIONS §2.22; S3 0.35 -> 0.30 E: the guard usually opens first]',
    note: 'primarily a guard-opening tool; T<=1 tap to it, T4+ never do',
  },
];

// ---------------------------------------------------------------------------
// §3.5 leg locks
// ---------------------------------------------------------------------------

const LEG_LOCK_ESCAPES: readonly EscapeOutcome[] = [
  { pos: 'pos.ground_open_guard_kneeling_top', roleAtt: 'bottom', share: 0.50, note: 'clear the leg and stand' },
  { pos: 'pos.ground_side_control', roleAtt: 'bottom', share: 0.20, note: 'pass over the entanglement' },
  { pos: 'pos.leg_50_50', roleAtt: 'either', share: 0.10, note: 'counter heel hook (50-50 only)' },
  { pos: 'pos.ground_open_guard_kneeling_top', roleAtt: 'bottom', share: 0.20, note: 'attacker abandons for strikes' },
];

const LEG_LOCKS: readonly SubmissionSpec[] = [
  {
    id: 'sub.heel_hook_inside', name: 'Inside heel hook', family: 'legLock', role: 'either',
    entryPositions: [
      { pos: 'pos.leg_saddle', role: 'either', continuous: true },
      { pos: 'pos.leg_50_50', role: 'either', continuous: true, note: 'mutual exposure' },
      { pos: 'pos.ground_closed_guard_standing_top', role: 'bottom', trigger: 'evt.step_over_guard' },
      { pos: 'pos.ground_hq', role: 'bottom' },
      { pos: 'pos.ground_open_supine_legs_up', role: 'bottom', note: 'Imanari roll entry' },
    ],
    requiredGrips: ['knee line trapped between the thighs', 'heel in the armpit', 'figure-four under the heel',
      'control the knee line before the heel'],
    stages: [
      setupStage(),
      st('entry', 0.45, 2000, ['def.hide_heel'], [1000, 3000]),
      st('secure', 0.50, 5000, ['def.clear_knee_line', 'def.roll_with', 'def.strike_attacker'], [2000, 8000]),
      st('finish', 0.85, 1500, ['def.roll_with', 'def.tap'], [1000, 3000]),
    ],
    finishClock: {
      tapMinMs: 1000, tapMaxMs: 3000, injuryDelayMinMs: 0, injuryDelayMaxMs: 1000,
      severity: 'high', injuryJoint: 'knee', escapeHazardPerS: 0.01,
      noWarning: true, noWarningMult: 1.2,
    },
    escapes: LEG_LOCK_ESCAPES,
    abandon: { pos: 'pos.ground_open_guard_kneeling_top', roleAtt: 'bottom' },
    counters: ['heel hook vs heel hook in 50-50 (first to locked wins)', 'GnP from the top on the entangled attacker',
      'kneebar counter when the attacker extends'],
    chains: {
      out: ['edge.sub.hh_to_kneebar', 'edge.sub.hh_to_toe_hold', 'edge.sub.hh_to_ankle',
        'edge.sub.hh_to_calf_slicer', 'edge.sub.hh_to_sweep_back', 'edge.sub.hh_counter'],
      in: ['edge.pos.step_over_to_entanglement', 'edge.pos.imanari', 'edge.sub.kneebar_to_hh',
        'edge.sub.ankle_to_hh', 'edge.sub.slx_sweep_fail_to_hh', 'edge.sub.tri_diamond_counter'],
    },
    // "The largest skill-gap effect of any submission."
    modifiers: [M('M_SKILL', 1.5), M('M_FLX_DEF', 1.5), M('M_STR_FIN'), M('M_SLIP_HIGH'), M('M_FAT_ATT', 0.5), M('M_MUTUAL')],
    glovesTerm: -0.1,
    legalityClass: 'heel_hook', secondaryClasses: ['knee_reap'],
    finishShareTarget: 0.008,
    tag: '[S: SUBMISSIONS §2.11 "Inside (411)"; SUB_FINISH §1a both variants 24/1695; P13 posterolateral corner]',
    note: 'the tear can precede the pain, so even a tapper is injured with pInjBeforeTap (x1.2 inside)',
  },
  {
    id: 'sub.heel_hook_outside', name: 'Outside heel hook', family: 'legLock', role: 'either',
    entryPositions: [
      { pos: 'pos.leg_ashi_slx', role: 'either', continuous: true },
      { pos: 'pos.leg_outside_ashi', role: 'either', continuous: true },
      { pos: 'pos.leg_50_50', role: 'either', continuous: true },
      { pos: 'pos.leg_cross_ashi', role: 'either', continuous: true },
      { pos: 'pos.ground_x_guard', role: 'bottom' },
      { pos: 'pos.ground_seated_shin_to_shin', role: 'bottom' },
    ],
    requiredGrips: ['outside leg hooks the opponent leg to block the knee turn', 'heel captured',
      'rotate the heel away from the body'],
    stages: [
      setupStage(),
      st('entry', 0.40, 2000, ['def.hide_heel']),
      st('secure', 0.40, 5000, ['def.clear_knee_line', 'def.roll_with', 'def.strike_attacker'], [2000, 8000]),
      st('finish', 0.70, 1500, ['def.roll_with', 'def.tap'], [1000, 3000]),
    ],
    finishClock: {
      tapMinMs: 1000, tapMaxMs: 3000, injuryDelayMinMs: 0, injuryDelayMaxMs: 1000,
      severity: 'high', injuryJoint: 'knee', escapeHazardPerS: 0.01, noWarning: true,
    },
    escapes: LEG_LOCK_ESCAPES,
    abandon: { pos: 'pos.ground_open_guard_kneeling_top', roleAtt: 'bottom' },
    counters: ['counter heel hook in 50-50', 'GnP', 'kneebar counter'],
    chains: {
      out: ['edge.sub.hh_to_kneebar', 'edge.sub.hh_to_toe_hold', 'edge.sub.hh_to_ankle',
        'edge.sub.hh_to_sweep_back', 'edge.sub.hh_counter'],
      in: ['edge.pos.step_over_to_entanglement', 'edge.sub.kneebar_to_hh', 'edge.sub.ankle_to_hh',
        'edge.sub.slx_sweep_fail_to_hh'],
    },
    modifiers: [M('M_SKILL', 1.5), M('M_FLX_DEF', 1.5), M('M_STR_FIN'), M('M_SLIP_HIGH'), M('M_FAT_ATT', 0.5), M('M_MUTUAL')],
    glovesTerm: -0.1,
    legalityClass: 'heel_hook', secondaryClasses: ['knee_reap'],
    finishShareTarget: 0.006,
    tag: '[S: SUBMISSIONS §2.11 "Outside"; P13/P16 ACL/PCL/MCL] [E: share split]',
  },
  {
    id: 'sub.kneebar', name: 'Kneebar', family: 'legLock', role: 'either',
    entryPositions: [
      { pos: 'pos.leg_saddle', role: 'either', requires: ['legExtendedAcrossTheHips'] },
      { pos: 'pos.leg_50_50', role: 'either', requires: ['legExtendedAcrossTheHips'] },
      { pos: 'pos.leg_cross_ashi', role: 'either', requires: ['legExtendedAcrossTheHips'] },
      { pos: 'pos.ground_half_flat', role: 'top', note: 'rolling kneebar: positional risk 0.50' },
      { pos: 'pos.ground_back_hooks', role: 'top' },
      { pos: 'pos.ground_closed_guard_bottom', role: 'top', requires: ['bottomCrossesTheAnkles'] },
    ],
    requiredGrips: ['knees pinched', 'heel under the armpit', 'hips in line with the knee'],
    stages: [
      setupStage(),
      st('entry', 0.40, 2000, ['def.hide_heel']),
      st('secure', 0.45, 4000, ['def.roll_with', 'def.clear_knee_line', 'def.strike_attacker'], [2000, 6000]),
      st('finish', 0.80, 1500, ['def.roll_with', 'def.tap'], [1000, 3000]),
    ],
    finishClock: {
      tapMinMs: 1000, tapMaxMs: 3000, injuryDelayMinMs: 1000, injuryDelayMaxMs: 2000,
      severity: 'high', injuryJoint: 'knee', escapeHazardPerS: 0.02,
    },
    escapes: [
      { pos: 'pos.ground_open_guard_kneeling_top', roleAtt: 'bottom', share: 0.55, note: 'leg freed, defender on top' },
      { pos: 'pos.ground_scramble', roleAtt: 'either', share: 0.35 },
      { pos: 'pos.ground_back_hooks', roleAtt: 'bottom', share: 0.10, note: 'reversal to the attacker back' },
    ],
    abandon: { pos: 'pos.leg_saddle', roleAtt: 'either', share: 0.5 },
    counters: ['counter kneebar / heel hook in 50-50', 'GnP'],
    chains: {
      out: ['edge.sub.kneebar_to_hh', 'edge.sub.kneebar_to_toe_hold', 'edge.sub.kneebar_to_ankle'],
      in: ['edge.sub.hh_to_kneebar', 'edge.sub.tri_diamond_counter'],
    },
    modifiers: [M('M_STR_FIN'), M('M_FLX_DEF', 1.5), M('M_SKILL'), M('M_MUTUAL')],
    legalityClass: 'kneebar', finishShareTarget: 0.012,
    tag: '[S: SUBMISSIONS §2.12; SUB_FINISH §1a 20/1695; rule 18 rolling-kneebar positional risk 0.50]',
  },
  {
    id: 'sub.ankle_lock_straight', name: 'Straight ankle lock', family: 'legLock', role: 'either',
    entryPositions: [
      { pos: 'pos.leg_ashi_slx', role: 'either', continuous: true, note: 'primary' },
      { pos: 'pos.leg_50_50', role: 'either', continuous: true },
      { pos: 'pos.leg_outside_ashi', role: 'either', continuous: true },
      { pos: 'pos.ground_open_supine_legs_up', role: 'bottom' },
      { pos: 'pos.ground_seated_shin_to_shin', role: 'bottom' },
    ],
    requiredGrips: ['foot under the armpit', 'forearm blade under the Achilles', 'gable or figure-four',
      'knee controlled by the attacker leg'],
    stages: [
      setupStage(),
      st('entry', 0.50, 1500, ['def.hide_heel']),
      st('secure', 0.45, 3000, ['def.clear_knee_line', 'def.strike_attacker'], [2000, 5000]),
      st('finish', 0.45, 4000, ['def.endure', 'def.clear_knee_line', 'def.tap'], [2000, 8000]),
    ],
    finishClock: {
      tapMinMs: 3000, tapMaxMs: 8000, injuryDelayMinMs: 4000, injuryDelayMaxMs: 10000,
      severity: 'medium', injuryJoint: 'ankle', escapeHazardPerS: 0.08,
    },
    escapes: [
      { pos: 'pos.ground_open_guard_kneeling_top', roleAtt: 'bottom', share: 0.60, note: 'stand and strike' },
      { pos: 'pos.standing_long', roleAtt: 'standing', share: 0.40, note: 'pull out to neutral' },
    ],
    abandon: { pos: 'pos.ground_open_guard_kneeling_top', roleAtt: 'bottom' },
    counters: ['counter ankle lock in 50-50', 'GnP'],
    chains: {
      out: ['edge.sub.ankle_to_hh', 'edge.sub.ankle_to_toe_hold', 'edge.sub.ankle_to_slx_sweep'],
      in: ['edge.sub.hh_to_ankle', 'edge.sub.kneebar_to_ankle', 'edge.sub.tri_diamond_counter'],
    },
    // Pain tolerance, not structure, decides this one: the defender's heart
    // shows up as a negative term on the attacker's S3.
    modifiers: [M('M_STR_FIN'), M('M_FLX_DEF'), M('M_FAT_ATT_GRIP'), M('M_SLIP_HIGH', 0.5), M('M_MUTUAL')],
    glovesTerm: -0.1,
    legalityClass: 'straight_ankle', finishShareTarget: 0.006,
    tag: '[S: SUBMISSIONS §2.13; §1.2 "ESTIMATE 8-14"; BJ1 "well defended, low injury threat"] [E: heart term]',
  },
  {
    id: 'sub.toe_hold', name: 'Toe hold', family: 'legLock', role: 'either',
    entryPositions: [
      { pos: 'pos.leg_saddle', role: 'either' },
      { pos: 'pos.leg_50_50', role: 'either' },
      { pos: 'pos.leg_ashi_slx', role: 'either' },
      { pos: 'pos.ground_half_flat', role: 'top' },
      { pos: 'pos.ground_turtle', role: 'top', note: 'rolling toe hold' },
    ],
    requiredGrips: ['figure-four on the foot', 'knee controlled', 'rotate the foot toward the buttock'],
    stages: [
      setupStage(),
      st('entry', 0.45, 1500, ['def.hide_heel']),
      st('secure', 0.45, 3000, ['def.roll_with', 'def.clear_knee_line']),
      st('finish', 0.70, 1500, ['def.roll_with', 'def.tap'], [1000, 3000]),
    ],
    finishClock: {
      tapMinMs: 1000, tapMaxMs: 3000, injuryDelayMinMs: 1000, injuryDelayMaxMs: 2000,
      severity: 'medium', injuryJoint: 'ankle', escapeHazardPerS: 0.02,
    },
    escapes: [
      { pos: 'pos.ground_open_guard_kneeling_top', roleAtt: 'bottom', share: 0.60 },
      { pos: 'pos.standing_long', roleAtt: 'standing', share: 0.40 },
    ],
    abandon: { pos: 'pos.ground_open_guard_kneeling_top', roleAtt: 'bottom' },
    counters: ['counter leg lock in 50-50'],
    chains: {
      out: ['edge.sub.toe_hold_to_ankle', 'edge.sub.toe_hold_to_hh', 'edge.sub.toe_hold_to_kneebar'],
      in: ['edge.sub.hh_to_toe_hold', 'edge.sub.ankle_to_toe_hold', 'edge.sub.kneebar_to_toe_hold'],
    },
    modifiers: [M('M_STR_FIN'), M('M_FLX_DEF'), M('M_SLIP_HIGH'), M('M_MUTUAL')],
    glovesTerm: -0.1,
    legalityClass: 'toe_hold', finishShareTarget: 0.0006,
    tag: '[S: SUBMISSIONS §2.14; SUB_FINISH §1a 1/1695; P15 toe hold + ankle lock = 61 % of ligamentous ankle injuries]',
    note: 'mechanically sound but almost never attempted in MMA',
  },
  {
    id: 'sub.calf_slicer', name: 'Calf slicer', family: 'compression', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_truck', role: 'top' },
      { pos: 'pos.ground_back_hooks', role: 'top', requires: ['legBent'] },
      { pos: 'pos.ground_turtle', role: 'top', requires: ['legBent'] },
      { pos: 'pos.ground_half_flat', role: 'top', requires: ['legBent'] },
      { pos: 'pos.leg_saddle', role: 'either', requires: ['legBent'] },
    ],
    requiredGrips: ['shin or forearm behind the knee', 'legs figure-four the leg', 'pull the ankle toward the buttock'],
    stages: [
      setupStage(),
      st('entry', 0.35, 2000, ['def.hide_heel']),
      st('secure', 0.45, 3000, ['def.roll_with']),
      st('finish', 0.65, 2000, ['def.endure', 'def.tap']),
    ],
    finishClock: {
      tapMinMs: 2000, tapMaxMs: 6000, injuryDelayMinMs: 3000, injuryDelayMaxMs: 6000,
      severity: 'medium', injuryJoint: 'calf', escapeHazardPerS: 0.03,
    },
    escapes: [
      { pos: 'pos.ground_truck', roleAtt: 'top', share: 0.70 },
      { pos: 'pos.ground_scramble', roleAtt: 'either', share: 0.30 },
    ],
    abandon: { pos: 'pos.ground_truck', roleAtt: 'top' },
    counters: ['straighten the leg early'],
    chains: {
      out: ['edge.sub.calf_slicer_to_twister', 'edge.sub.calf_slicer_to_truck', 'edge.sub.calf_slicer_to_banana_split'],
      in: ['edge.sub.hh_to_calf_slicer', 'edge.sub.twister_to_calf_slicer', 'edge.sub.truck_to_calf_slicer'],
    },
    modifiers: [M('M_STR_FIN', 1.5), M('M_CTRL'), M('M_SLIP_LOW')],
    legalityClass: 'slicer', finishShareTarget: 0.0018,
    tag: '[S: SUBMISSIONS §2.24; SUB_FINISH §1a 3/1695] [E: heart/pain term as the ankle lock]',
  },
];

// ---------------------------------------------------------------------------
// §3.6 spine, crank and truck attacks
// ---------------------------------------------------------------------------

const SPINE_TRUCK: readonly SubmissionSpec[] = [
  {
    id: 'sub.twister', name: 'Twister', family: 'crank', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_truck', role: 'top', requires: ['farArmControlled'] },
      { pos: 'pos.ground_back_one_hook', role: 'top', requires: ['nearLegTriangled', 'farArmControlled'] },
    ],
    requiredGrips: ['lockdown on the near leg', 'hand behind the head or full nelson', 'chest on the shoulder'],
    stages: [
      setupStage(),
      st('entry', 0.30, 2500, ['def.hide_heel', 'def.clear_hooks_turn_in']),
      st('secure', 0.40, 4000, ['def.turn_head_toward', 'def.hand_fight']),
      st('finish', 0.75, 2000, ['def.roll_with', 'def.tap']),
    ],
    finishClock: {
      tapMinMs: 1000, tapMaxMs: 5000, injuryDelayMinMs: 2000, injuryDelayMaxMs: 4000,
      severity: 'high', injuryJoint: 'spine', escapeHazardPerS: 0.02,
    },
    escapes: [
      { pos: 'pos.ground_back_one_hook', roleAtt: 'top', share: 0.60 },
      { pos: 'pos.ground_scramble', roleAtt: 'bottom', share: 0.40 },
    ],
    abandon: { pos: 'pos.ground_back_one_hook', roleAtt: 'top' },
    counters: ['clear the leg'],
    chains: {
      out: ['edge.sub.twister_to_rnc', 'edge.sub.twister_to_calf_slicer', 'edge.sub.twister_to_truck',
        'edge.sub.twister_to_banana_split'],
      in: ['edge.sub.truck_to_twister', 'edge.sub.calf_slicer_to_twister', 'edge.sub.banana_split_to_twister'],
    },
    modifiers: [M('M_CTRL'), M('M_STR_FIN'), M('M_NECK', 1.5), M('M_FLX_DEF', 1.5)],
    legalityClass: 'spinal_lock', finishShareTarget: 0.0024,
    tag: '[S: SUBMISSIONS §2.21; SUB_FINISH §1a 4/1695; RULES §2.6 twister legal in ADCC]',
  },
  {
    id: 'sub.neck_crank_generic', name: 'Neck crank (non-rear positions)', family: 'crank', role: 'top',
    entryPositions: [
      { pos: 'pos.ground_mount_high', role: 'top', note: 'face crank' },
      { pos: 'pos.ground_back_crucifix', role: 'top' },
      { pos: 'pos.ground_crucifix_side', role: 'top' },
      { pos: 'pos.ground_kesa_gatame', role: 'top' },
    ],
    requiredGrips: ['head levered against the spine', 'cervical flexion, extension or rotation'],
    stages: [
      setupStage(),
      st('entry', 0.50, 1500, ['def.two_on_one', 'def.hand_fight']),
      st('secure', 0.50, 3000, ['def.turn_head_toward', 'def.chin_tuck'], [2000, 5000]),
      st('finish', 0.35, 4000, ['def.endure', 'def.tap'], [2000, 8000]),
    ],
    finishClock: { tapMinMs: 2000, tapMaxMs: 10000, neckStrainPer5s: 0.15, escapeHazardPerS: 0.10 },
    escapes: [
      { pos: 'pos.ground_mount_high', roleAtt: 'top', share: 0.80, note: 'position retained by the attacker' },
      { pos: 'pos.ground_scramble', roleAtt: 'either', share: 0.20 },
    ],
    abandon: { pos: 'pos.ground_mount_high', roleAtt: 'top' },
    counters: [],
    chains: { out: ['edge.sub.crank_to_rnc'], in: ['edge.sub.crucifix_to_crank', 'edge.sub.choke_to_crank'] },
    modifiers: [M('M_CTRL'), M('M_STR_FIN', 1.5), M('M_NECK', 1.5), M('M_FAT_ATT')],
    legalityClass: 'neck_crank', finishShareTarget: 0.006,
    tag: '[S: SUBMISSIONS §2.22; SUB_FINISH §1b 1.3 % all neck cranks] [E: escape split, generic share 0.6 %]',
  },
  {
    id: 'sub.banana_split', name: 'Banana split / electric chair', family: 'jointLock', role: 'either',
    entryPositions: [
      { pos: 'pos.ground_truck', role: 'top' },
      { pos: 'pos.ground_half_lockdown', role: 'bottom', note: 'electric chair' },
    ],
    requiredGrips: ['one leg triangled or locked down', 'other leg pulled away by the arms'],
    stages: [
      setupStage(),
      st('entry', 0.25, 2500, ['def.hide_heel']),
      st('secure', 0.40, 4000, ['def.roll_with']),
      st('finish', 0.55, 3000, ['def.endure', 'def.tap']),
    ],
    finishClock: {
      tapMinMs: 2000, tapMaxMs: 6000, injuryDelayMinMs: 3000, injuryDelayMaxMs: 6000,
      severity: 'medium', injuryJoint: 'hip', escapeHazardPerS: 0.05,
    },
    escapes: [
      { pos: 'pos.ground_truck', roleAtt: 'top', share: 0.60 },
      { pos: 'pos.ground_scramble', roleAtt: 'either', share: 0.40 },
    ],
    abandon: { pos: 'pos.ground_truck', roleAtt: 'top' },
    counters: ['keep the legs together'],
    chains: {
      out: ['edge.sub.electric_chair_to_sweep', 'edge.sub.banana_split_to_truck', 'edge.sub.banana_split_to_twister',
        'edge.sub.banana_split_to_calf_slicer'],
      in: ['edge.sub.truck_to_banana_split', 'edge.sub.twister_to_banana_split', 'edge.sub.calf_slicer_to_banana_split'],
    },
    modifiers: [M('M_FLX_DEF', 2), M('M_STR_FIN'), M('M_CTRL')],
    // Same §5 row as the kneebar (leg-spreading), so it reuses that class.
    legalityClass: 'kneebar', finishShareTarget: 0.0005,
    tag: '[S: SUBMISSIONS §2.30 "0-2 UFC"; BJJ_POS §2.4 electric chair sub/sweep] [E: clock, escapes]',
  },
];

// ---------------------------------------------------------------------------
// §3.7 standing and flying attacks
// ---------------------------------------------------------------------------

const FLYING: readonly SubmissionSpec[] = [
  {
    id: 'sub.triangle_flying', name: 'Flying triangle', family: 'choke', chokeType: 'blood', role: 'standing',
    entryPositions: [
      { pos: 'pos.standing_long', role: 'standing', requires: ['closeRange', 'wristOrCollarControl'] },
      { pos: 'pos.clinch_collar_tie', role: 'standing', requires: ['stationaryOpponent'] },
    ],
    requiredGrips: ['jump', 'leg over the shoulder', 'land in the lock or in guard'],
    stages: [
      setupStage(),
      st('entry', 0.30, 1000, ['def.slam', 'def.stack']),
      st('secure', 0.35, 3000, ['def.stack', 'def.slam', 'def.posture_up']),
      st('finish', 0.55, 4000, ['def.slam', 'def.endure', 'def.tap']),
    ],
    finishClock: { tapMinMs: 5000, tapMaxMs: 15000, locMeanS: 9.5, escapeHazardPerS: 0.02 },
    escapes: [
      { pos: 'pos.ground_closed_guard_bottom', roleAtt: 'bottom', share: 0.72, note: 'attacker lands in guard' },
      { pos: 'pos.ground_scramble', roleAtt: 'bottom', share: 0.28, note: 'slammed, plus damage' },
    ],
    abandon: { pos: 'pos.ground_closed_guard_bottom', roleAtt: 'bottom' },
    counters: ['def.slam is the norm - the attacker is in the air', 'drop to the knees'],
    chains: { out: ['edge.sub.flying_landed_guard', 'edge.sub.flying_slammed'], in: [] },
    modifiers: [M('M_FLX_ATT'), M('M_LEN_LEG'), M('M_STR_DEF'), M('M_ROCKED', 1.5)],
    gates: { chokeSkillMin: 70, explosivenessMin: 60 },
    legalityClass: 'choke_blood', finishShareTarget: 0.0018,
    tag: '[S: SUBMISSIONS §2.27; SUB_FINISH §1a 3/1695] [D: the §2.27 15 % is the conversion path, so the escape shares 0.60/0.25 are renormalised to 0.72/0.28]',
    note: 'slam risk 0.40 on failure; in judo a standing entry without a throw is hansoku-make (§5)',
  },
  {
    id: 'sub.armbar_flying', name: 'Flying armbar', family: 'jointLock', role: 'standing',
    entryPositions: [
      { pos: 'pos.standing_long', role: 'standing', requires: ['armExtended', 'collarTieOrWristGrip'] },
      { pos: 'pos.clinch_collar_tie', role: 'standing', requires: ['armExtended'] },
    ],
    requiredGrips: ['wrist and collar control', 'jump, leg over the head, fall back'],
    stages: [
      setupStage(),
      st('entry', 0.30, 1000, ['def.slam', 'def.stack']),
      st('secure', 0.35, 2500, ['def.stack', 'def.slam', 'def.posture_up']),
      st('finish', 0.55, 1500, ['def.slam', 'def.hitchhiker', 'def.tap']),
    ],
    finishClock: {
      tapMinMs: 0, tapMaxMs: 3000, injuryDelayMinMs: 1000, injuryDelayMaxMs: 3000,
      severity: 'high', injuryJoint: 'elbow', escapeHazardPerS: 0.02,
    },
    escapes: [
      { pos: 'pos.ground_closed_guard_bottom', roleAtt: 'bottom', share: 0.72 },
      { pos: 'pos.ground_scramble', roleAtt: 'bottom', share: 0.28, note: 'slammed, plus damage' },
    ],
    abandon: { pos: 'pos.ground_closed_guard_bottom', roleAtt: 'bottom' },
    counters: ['def.slam', 'drop to the knees'],
    chains: { out: ['edge.sub.flying_landed_guard', 'edge.sub.flying_slammed'], in: [] },
    modifiers: [M('M_FLX_ATT'), M('M_LEN_LEG'), M('M_STR_DEF'), M('M_ROCKED', 1.5)],
    gates: { chokeSkillMin: 70, explosivenessMin: 60 },
    legalityClass: 'elbow_lock', finishShareTarget: 0.004,
    tag: '[S: SUBMISSIONS §2.27; BJ6 Sato 6 s, Namajunas 12 s] [E: share split of armbar 11.9 %]',
  },
];

// ---------------------------------------------------------------------------
// the catalogue
// ---------------------------------------------------------------------------

export const SUBMISSION_CATALOGUE: readonly SubmissionSpec[] = [
  ...BACK_ATTACKS,
  ...FRONT_HEADLOCK,
  ...MOUNT_SIDE,
  ...GUARD_ATTACKS,
  ...LEG_LOCKS,
  ...SPINE_TRUCK,
  ...FLYING,
];

const BY_ID = new Map<string, SubmissionSpec>(SUBMISSION_CATALOGUE.map((s) => [s.id, s]));

export function submission(id: string): SubmissionSpec {
  const s = BY_ID.get(id);
  if (!s) throw new Error(`Unknown submission id: ${id}`);
  return s;
}

export function hasSubmission(id: string): boolean {
  return BY_ID.has(id);
}

export const SUBMISSION_ID_LIST: readonly string[] = SUBMISSION_CATALOGUE.map((s) => s.id);

/**
 * Family-level ids §03 uses in its node tables, resolved to a catalogue entry
 * by the node the attack is entered from (04 §0.3).
 */
export const SUBMISSION_ALIASES: Readonly<Record<string, string>> = {
  'sub.armbar': 'sub.armbar_guard',
  'sub.triangle': 'sub.triangle_guard',
  'sub.mounted_triangle': 'sub.triangle_mounted',
  'sub.mounted_guillotine': 'sub.guillotine_mounted',
  'sub.arm_triangle': 'sub.arm_triangle_mount',
  'sub.kimura': 'sub.kimura_side',
  'sub.ezekiel': 'sub.ezekiel_top',
  'sub.neck_crank': 'sub.neck_crank_generic',
  'sub.straight_ankle': 'sub.ankle_lock_straight',
  'sub.crucifix_shoulder_lock': 'sub.crucifix_armlock',
  'sub.electric_chair': 'sub.banana_split',
  'sub.guillotine': 'sub.guillotine_standard',
  'sub.heel_hook': 'sub.heel_hook_inside',
};

/** Resolve a §03 family-level id to a catalogue entry, preferring a node match. */
export function resolveSubmissionId(id: string, fromPos?: string): string {
  if (BY_ID.has(id)) return id;
  const fallback = SUBMISSION_ALIASES[id];
  if (!fallback) throw new Error(`Unknown submission id or alias: ${id}`);
  if (fromPos === undefined) return fallback;
  // Prefer the variant of the same family that actually lists this node.
  const prefix = fallback.split('_')[0];
  for (const s of SUBMISSION_CATALOGUE) {
    if (!s.id.startsWith(prefix)) continue;
    if (s.entryPositions.some((e) => e.pos === fromPos)) return s.id;
  }
  return fallback;
}

/** Register the catalogue's ids with the global table. */
export function registerSubmissionIds(): void {
  SUBMISSION_IDS.addAll(SUBMISSION_ID_LIST);
}
