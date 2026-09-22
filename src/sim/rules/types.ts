/**
 * RULESET TYPES — the rules of the contest as data.
 *
 * Transcribed from docs/design/06_RULES_REFEREE_JUDGING.md §2.1, which is the
 * owner of this vocabulary. Enumerations are closed: adding a value is a design
 * change, not an implementation detail.
 *
 * The referee (rules/referee.ts) and the judges (rules/judges.ts) read only this
 * object, so a new combat sport is a new data file, not new engine code.
 */

export type RulesetId =
  | 'mma.unified.3r' | 'mma.unified.5r' | 'mma.unified.2017' | 'mma.amateur'
  | 'boxing.pro'
  | 'kickboxing.glory' | 'kickboxing.k1'
  | 'muay_thai.abc' | 'muay_thai.stadium'
  | 'grappling.ibjjf' | 'grappling.adcc' | 'grappling.subonly'
  | 'judo.ijf'
  | 'street';


// ---------- primitives ----------
export type Weapon   = 'punch' | 'kick' | 'knee' | 'elbow' | 'headbutt' | 'stomp' | 'spinning_backfist';
export type Target   = 'head' | 'body' | 'leg' | 'back_of_head' | 'spine' | 'groin' | 'throat' | 'eyes'
                     | 'knee_joint' | 'downed_head';                 // downed_head only exists vs a grounded opponent
export type Phase    = 'standing' | 'clinch' | 'ground_top' | 'ground_bottom';
export type Legality = 'legal' | 'foul' | 'foul_hard';              // foul_hard: DQ-class regardless of intent
export type GroundedDef = 'unified_2001' | 'unified_2017' | 'unified_2024' | 'any_contact' | 'none';
// unified_2001: any part other than soles of feet (one hand = grounded)          [S: RULES §2.2]
// unified_2017: both palms/fists down, or any part other than a single hand      [S: RULES §2.2]
// unified_2024: any part other than hands or feet (hands never count)            [S: RULES §2.2]
// any_contact : boxing/KB/MT — a downed fighter may not be hit at all            [S: RULES §2.3, §2.5]

export type TakedownClass = 'shot' | 'trip' | 'sweep_shin' | 'sweep_side_foot' | 'hip_throw' | 'shoulder_throw'
  | 'leg_reap' | 'lift' | 'slam' | 'suplex' | 'spike' | 'kick_off_feet' | 'scissor' | 'leg_grab' | 'head_dive';
export type SubmissionClass = 'choke_blood' | 'choke_air' | 'neck_crank' | 'elbow_lock' | 'shoulder_lock'
  | 'wrist_lock' | 'straight_ankle' | 'toe_hold' | 'kneebar' | 'heel_hook' | 'twisting_knee' | 'knee_reap'
  | 'slicer' | 'spinal_lock' | 'small_joint' | 'trachea_grab' | 'fish_hook';

export type WinCondition = 'ko' | 'tko_strikes' | 'tko_doctor' | 'tko_corner' | 'tko_bell' | 'tko_bodily'
  | 'tko_count' | 'tko_three_kd' | 'tko_outmatched' | 'submission' | 'technical_submission'
  | 'decision' | 'technical_decision' | 'points' | 'ippon' | 'waza_ari_x2' | 'golden_score' | 'referee_decision'
  | 'dq' | 'hansoku_make' | 'incapacitation' | 'flight' | 'surrender' | 'separation' | 'weapon';

export type ScoringSystem = 'ten_point_must' | 'points_ibjjf' | 'points_adcc' | 'ippon' | 'none' | 'whole_fight';
export type JudgeCulture  = 'unified_2025' | 'legacy_2016' | 'boxing_abc' | 'glory' | 'muay_thai_abc'
                          | 'thai_stadium' | 'whole_fight' | 'none';
export type Strictness    = 'lenient' | 'standard' | 'strict';

// ---------- foul catalogue ----------
export type FoulId =
  | 'headbutt' | 'eye_gouge' | 'bite_spit' | 'fish_hook' | 'hair_pull' | 'spike' | 'back_of_head' | 'throat'
  | 'fingers_extended' | 'groin' | 'grounded_head_kick_knee' | 'stomp' | 'hold_gloves_shorts' | 'fence_grab'
  | 'small_joint' | 'throw_out' | 'finger_in_cut' | 'claw_pinch' | 'timidity' | 'abusive' | 'disregard'
  | 'unsporting_injury' | 'after_bell' | 'on_break' | 'under_ref_care' | 'corner_interference'
  // boxing / kickboxing / muay thai specific
  | 'holding' | 'hold_and_hit' | 'low_blow' | 'rabbit_punch' | 'hit_downed' | 'illegal_throw' | 'illegal_sweep'
  | 'catch_and_carry' | 'excessive_clinch' | 'elbow_illegal' | 'linear_leg_kick' | 'open_glove'
  // grappling / judo
  | 'illegal_submission' | 'slam' | 'stalling' | 'guard_pull' | 'passivity' | 'fleeing' | 'leg_grab_judo'
  | 'false_attack' | 'step_out' | 'defensive_grip' | 'head_dive';

export interface FoulRule {
  id: FoulId;
  intentDefault: 'accidental' | 'intentional' | 'by_context';   // by_context: AI flag or repeat after warning
  warningsBeforeDeduction: number;   // overridden by strictness preset
  deductionAccidental: number;       // points (0 or 1), usually gated by "substantial effect"
  deductionIntentional: number;      // 2 = mandatory in MMA/boxing/MT                          [S: RULES §2.2, §2.3, §2.5]
  recoveryMaxS: number;              // 300 for groin/eye in MMA/boxing/MT; 120 in ADCC; 0 otherwise
  needsDoctorAbove: number | null;   // injury severity that triggers doctor evaluation
  hard: boolean;                     // foul_hard => DQ (or hansoku-make) on first occurrence
}

// ---------- the ruleset ----------
export interface Ruleset {
  id: string;                        // e.g. 'mma.unified.3r'
  family: 'mma' | 'boxing' | 'kickboxing' | 'muay_thai' | 'grappling' | 'judo' | 'street';
  rounds: {
    count: number;                   // 1 for single-period sports
    lengthS: number;
    breakS: number;
    extra: { max: number; lengthS: number; breakS: number; trigger: 'draw' | 'tie' } | null;
    goldenScore: boolean;            // judo: unlimited extra time, first score wins
    noPositivePointsBeforeS: number; // ADCC: first half has no positive points (0 = off)
    clockStopsOnCount: boolean;      // false everywhere (count runs with the clock; no saved-by-bell)
  };
  weightClasses: { name: string; maxLb: number | null; maxKg: number | null }[];
  catchWeightMaxGapLb: number | null;
  gloves: { oz: number; fingerless: boolean; bareKnuckle: boolean };
  legal: Partial<Record<Weapon, Partial<Record<Target, Partial<Record<Phase, Legality>>>>>>;  // sparse; default = 'legal'
  groundedDef: GroundedDef;
  elbows12to6: Legality;             // 'legal' from Nov 2024; 'foul' for the 2017 variant           [S: RULES §2.2]
  clinch: {
    allowed: boolean;
    maxS: number | null;             // null = untimed, referee breaks on inactivity
    activityRule: 'none' | 'one_strike_then_break' | 'continuous' | 'holding_is_foul';
    kneesAllowed: boolean; elbowsAllowed: boolean; dirtyBoxingAllowed: boolean;
    catchKickStepLimit: number | null;   // MT: 2 steps then must strike                             [S: MTKB §9]
  };
  takedowns: { allowed: boolean; legal: TakedownClass[]; slamOnlyFromSubmission: boolean };
  submissions: { allowed: boolean; legal: SubmissionClass[]; standingLocksAllowed: boolean };
  ground: {
    fightingAllowed: boolean;        // false in boxing/KB/MT; judo = limited (ne-waza until mate)
    strikesAllowed: boolean;
    standupPolicy: 'unified_effort' | 'judo_progress' | 'ibjjf_stalling' | 'adcc_passivity' | 'none' | 'immediate';
  };
  winConditions: WinCondition[];
  scoring: {
    system: ScoringSystem; culture: JudgeCulture; judges: number;
    openScoring: 'hidden' | 'after_each_round' | 'always';
    ncThresholdRounds: (scheduled: number) => number;  // MMA/MT/GLORY: ceil(scheduled/2); boxing: 4     [S: RULES §6.2]
    drawsAllowed: boolean;           // GLORY sudden-victory round forbids a drawn extra round
    championRetainsOnDraw: boolean;  // GLORY title fights                                            [S: RULES §2.4]
  };
  knockdown: {
    counts: boolean;                 // false in MMA                                                  [S: RULES §3.2]
    mandatoryCount: number;          // 8
    koCount: number;                 // 10
    standingEight: boolean;          // GLORY only                                                     [S: RULES §6.2]
    threeKdRound: number | null;     // GLORY 3 (tournament 2); ABC KB 3 (head strikes); K-1 3
    fourKdBout: number | null;       // GLORY 4 (tournament 3); K-1 4
    outOfRingCountS: number;         // 20 (mandatory 18 if back sooner)                               [S: RULES §6.2]
    savedByBell: false;
  };
  fouls: FoulRule[];
  stoppage: {
    refereeStops: boolean;           // false in street
    doctor: boolean;
    cornerTowel: 'direct' | 'via_inspector' | 'none';   // MMA/MT direct; US boxing via inspector       [S: RULES §2.3, §2.5]
    outmatchedTko: boolean;          // MT "outmatched" clause                                         [S: RULES §2.5]
  };
  referee: { present: boolean; strictness: Strictness; crowdPresent: boolean };
  multiOpponent: { allowed: boolean; maxPerSide: number; replacement: 'none' | 'gauntlet' | 'tag' };
  street?: { surface: 'concrete' | 'asphalt' | 'grass' | 'mat'; bystanders: number; weaponHazardPerS: number };
}
