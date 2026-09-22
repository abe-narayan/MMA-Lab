/**
 * GROUND AND POUND — striking as a property of the graph, not a separate mode.
 *
 * Chapter 03 §5. This module owns three things and deliberately not a fourth:
 *
 *  - **rate, land and damage multiplier** per node and posture (§5.1), plus the
 *    strike ids those nodes may throw (§5.1.1);
 *  - **the posture-versus-control trade-off** (§5.2): posturing up unlocks the
 *    striking row and simultaneously hands the bottom fighter POST +0.40 on
 *    every sweep, escape and get-up, plus a per-node opening on top;
 *  - **the activity and stall counters** the referee (chapter 06) and the
 *    judges read (§6).
 *
 * Damage per strike is chapter 02's force model and chapter 05's pools; this
 * module produces the `StrikeImpact` inputs and stops there.
 *
 * Anchors the §5.1 numbers reproduce: ground punches and elbows land 58.6 %
 * `[S: BJJ_POSITIONS §4 (Roy & Murphy 2026, 931 attempts)]`; 11 % of all
 * significant strikes land on the ground `[S: FIGHT_DATA §3 #81]`; ground
 * KO/TKO share 28 % `[S: FIGHT_DATA §3 #82]`; ground finishing strikes are
 * punches 83 %, elbows 14 %, knees 3 % `[S: FIGHT_DATA §3 #28]`.
 */
import type { PositionId, TechniqueId } from '../core/ids';
import type { ResolvedParams } from '../params';
import { TECHNIQUE_IDS } from '../core/ids';
import type { EdgeId } from './graph';
import { positionNode } from './graph';

// ---------------------------------------------------------------------------
// §5.1.1 Clinch and ground strike ids
// ---------------------------------------------------------------------------

export type GnpWeapon = 'fist' | 'elbow' | 'knee' | 'hammerfist' | 'heel';

/** Where chapter 05 should treat the impact as coming from. */
export type ImpactPosture = 'clinch' | 'groundTop' | 'groundBottom' | 'wallPinned';

export interface GnpStrike {
  id: TechniqueId;
  weapon: GnpWeapon;
  /** The chapter 02 Table B row the force comes from. */
  forceRow: string;
  /** Multiplies that row's force before chapter 05 sees it. */
  forceScale: number;
  posture: ImpactPosture;
  /** Ruleset flags chapter 06 checks before the strike is legal. */
  flags: readonly ('elbows12to6' | 'kneesToGroundedHead' | 'backOfHead' | 'soccerKicks')[];
  note?: string;
  tag: string;
}

export const GNP_STRIKES: readonly GnpStrike[] = [
  {
    id: 'tech.clinch_uppercut', weapon: 'fist', forceRow: 'tech.uppercut_rear', forceScale: 1,
    posture: 'clinch', flags: [], note: 'dirty boxing; lands 0.55-0.70',
    tag: '[S: MMA_INTEGRATION I-10]',
  },
  {
    id: 'tech.clinch_hook', weapon: 'fist', forceRow: 'tech.hook_lead', forceScale: 1,
    posture: 'clinch', flags: [], note: 'short hook over the tie', tag: '[S: MMA_INTEGRATION I-10]',
  },
  {
    id: 'tech.clinch_elbow', weapon: 'elbow', forceRow: 'tech.elbow_horizontal', forceScale: 1,
    posture: 'clinch', flags: ['elbows12to6'], note: 'cut channel (chapter 05)',
    tag: '[S: WRESTLING §5.4]',
  },
  {
    id: 'tech.clinch_knee', weapon: 'knee', forceRow: 'tech.knee_straight', forceScale: 1,
    posture: 'clinch', flags: ['kneesToGroundedHead'],
    note: 'body and thigh by default; head only where legal',
    tag: '[S: MUAY_THAI §4.3]',
  },
  {
    // Already an edge in §2.3 E; listed here so every thrown strike has an id.
    id: 'tech.foot_stomp', weapon: 'heel', forceRow: '-', forceScale: 0,
    posture: 'wallPinned', flags: [], note: 'no damage; +0.21 logit on the next trip',
    tag: '[S: WRESTLING §9 r23]',
  },
  {
    id: 'tech.gnp_punch', weapon: 'fist', forceRow: 'tech.cross', forceScale: 1,
    posture: 'groundTop', flags: [], note: 'tech.hook_lead when seated rather than postured',
    tag: '[S: BJJ_POSITIONS §4]',
  },
  {
    id: 'tech.gnp_hammerfist', weapon: 'hammerfist', forceRow: 'tech.hook_lead', forceScale: 0.6,
    posture: 'groundTop', flags: ['backOfHead'], tag: '[S: BJJ_POSITIONS §4] (kWeapon 0.6)',
  },
  {
    id: 'tech.gnp_elbow', weapon: 'elbow', forceRow: 'tech.elbow_horizontal', forceScale: 1,
    posture: 'groundTop', flags: ['elbows12to6'], note: 'cut channel',
    tag: '[S: BJJ_POSITIONS §4]',
  },
  {
    id: 'tech.gnp_knee_body', weapon: 'knee', forceRow: 'tech.knee_straight', forceScale: 0.5,
    posture: 'groundTop', flags: ['kneesToGroundedHead'],
    note: 'never to a grounded head under Unified', tag: '[S: BJJ_POSITIONS §4]',
  },
  {
    id: 'tech.upkick', weapon: 'heel', forceRow: 'tech.teep_rear', forceScale: 0.6,
    posture: 'groundBottom', flags: [], note: 'legal only against a standing top',
    tag: '[S: MMA_INTEGRATION I-17]',
  },
  {
    id: 'tech.bottom_elbow', weapon: 'elbow', forceRow: 'tech.elbow_horizontal', forceScale: 0.4,
    posture: 'groundBottom', flags: ['elbows12to6'], tag: '[S: BJJ_POSITIONS §4]',
  },
  {
    id: 'tech.bottom_punch', weapon: 'fist', forceRow: 'tech.jab', forceScale: 0.5,
    posture: 'groundBottom', flags: [], tag: '[S: BJJ_POSITIONS §4]',
  },
];

for (const s of GNP_STRIKES) TECHNIQUE_IDS.add(s.id);

const STRIKE_BY_ID = new Map(GNP_STRIKES.map((s) => [s.id, s] as const));

export function gnpStrike(id: TechniqueId): GnpStrike {
  const s = STRIKE_BY_ID.get(id);
  if (!s) throw new Error(`Unknown ground/clinch strike id: ${id}`);
  return s;
}

// ---------------------------------------------------------------------------
// §5.1 Per-position striking table
// ---------------------------------------------------------------------------

export interface GnpProfile {
  /** Attempts per minute when the top chooses to strike. */
  rate: readonly [number, number];
  /** P(lands clean) before chapter 02's defence terms. */
  land: number;
  /** Damage multiplier versus the same fighter's standing power punch, per weapon. */
  dmg: Partial<Record<GnpWeapon, number>>;
  /** Strike ids legal from this node under the Unified rules. */
  strikes: readonly TechniqueId[];
  /**
   * Extra logit on the listed bottom edges while `posture = 'postured'`, on top
   * of the generic POST bonus.
   */
  openings: Readonly<Record<EdgeId, number>>;
  /** Submission risk to the top per 30 s of striking from this node. */
  subRiskPer30s: number;
  /** Chapter 06 judge credit per minute, 0-3. */
  judge: number;
  tag: string;
}

const GNP: Record<string, GnpProfile> = {
  'pos.ground_mount_high': {
    rate: [25, 40], land: 0.65,
    dmg: { elbow: 0.9, fist: 0.8, hammerfist: 0.6 },
    strikes: ['tech.gnp_elbow', 'tech.gnp_punch', 'tech.gnp_hammerfist'],
    openings: {
      'tech.escape_mount_upa': 0.63,
      'tech.escape_mount_elbow_knee': 0.42,
      'tech.escape_mount_turn_belly': 0,
    },
    // Only against a T0-T1 top who straight-arms the mat.
    subRiskPer30s: 0.02,
    judge: 3,
    tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.ground_mount_s': {
    rate: [25, 40], land: 0.65,
    dmg: { elbow: 0.9, fist: 0.8, hammerfist: 0.6 },
    strikes: ['tech.gnp_elbow', 'tech.gnp_punch', 'tech.gnp_hammerfist'],
    openings: { 'tech.escape_mount_kip': 0.42 },
    subRiskPer30s: 0.02, judge: 3, tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.ground_mount_low': {
    rate: [15, 30], land: 0.55,
    dmg: { fist: 0.6, hammerfist: 0.6, elbow: 0.6 },
    strikes: ['tech.gnp_punch', 'tech.gnp_hammerfist', 'tech.gnp_elbow'],
    openings: { 'tech.escape_mount_upa': 0.85, 'tech.escape_mount_elbow_knee': 0.42 },
    subRiskPer30s: 0, judge: 2, tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.ground_mount_tech': {
    rate: [20, 35], land: 0.65,
    dmg: { fist: 0.8, hammerfist: 0.8, elbow: 0.8 },
    strikes: ['tech.gnp_punch', 'tech.gnp_hammerfist', 'tech.gnp_elbow'],
    openings: { 'tech.tech_mount_to_back': 0 },
    subRiskPer30s: 0, judge: 2.5, tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.ground_back_hooks': {
    // No hip rotation available, so the damage multiplier is halved.
    rate: [10, 25], land: 0.60,
    dmg: { fist: 0.5, hammerfist: 0.5, elbow: 0.5 },
    strikes: ['tech.gnp_punch', 'tech.gnp_hammerfist', 'tech.gnp_elbow'],
    openings: { 'tech.escape_back_hand_fight': 0.42 },
    subRiskPer30s: 0, judge: 2.5, tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.ground_back_body_triangle': {
    rate: [10, 25], land: 0.60,
    dmg: { fist: 0.5, hammerfist: 0.5, elbow: 0.5 },
    strikes: ['tech.gnp_punch', 'tech.gnp_hammerfist', 'tech.gnp_elbow'],
    openings: { 'tech.escape_back_hand_fight': 0.42 },
    subRiskPer30s: 0, judge: 2.5, tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.ground_back_one_hook': {
    rate: [10, 25], land: 0.60,
    dmg: { fist: 0.5, hammerfist: 0.5 },
    strikes: ['tech.gnp_punch', 'tech.gnp_hammerfist'],
    openings: { 'tech.escape_back_hand_fight': 0.42 },
    subRiskPer30s: 0, judge: 2, tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.ground_back_seatbelt': {
    rate: [10, 25], land: 0.60,
    dmg: { fist: 0.5, hammerfist: 0.5 },
    strikes: ['tech.gnp_punch', 'tech.gnp_hammerfist'],
    openings: { 'tech.escape_back_hand_fight': 0.42 },
    subRiskPer30s: 0, judge: 2, tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.ground_crucifix': {
    // Unanswered: both of the bottom's arms are trapped.
    rate: [30, 50], land: 0.85,
    dmg: { elbow: 0.8, fist: 0.8 },
    strikes: ['tech.gnp_elbow', 'tech.gnp_punch'],
    openings: {},
    subRiskPer30s: 0, judge: 3, tag: '[S: BJJ_POSITIONS §4]; TKO ~0.35 per 30 s [E]',
  },
  'pos.ground_side': {
    rate: [12, 25], land: 0.55,
    dmg: { elbow: 0.6, knee: 0.5, fist: 0.5 },
    strikes: ['tech.gnp_elbow', 'tech.gnp_knee_body', 'tech.gnp_punch'],
    openings: {
      'tech.escape_side_frames_shrimp': 0.42,
      'tech.escape_side_underhook_turn': 0.42,
      'tech.bridge_roll_kesa_side': 0.42,
    },
    subRiskPer30s: 0, judge: 2, tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.ground_side_kesa': {
    rate: [10, 20], land: 0.60,
    dmg: { hammerfist: 0.5, elbow: 0.5 },
    strikes: ['tech.gnp_hammerfist', 'tech.gnp_elbow'],
    openings: { 'tech.bridge_roll_kesa_side': 0.42 },
    subRiskPer30s: 0, judge: 2, tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.ground_side_reverse_kesa': {
    rate: [10, 20], land: 0.55,
    dmg: { hammerfist: 0.5, fist: 0.5 },
    strikes: ['tech.gnp_hammerfist', 'tech.gnp_punch'],
    openings: {},
    subRiskPer30s: 0, judge: 2, tag: '[S: BJJ_POSITIONS §4] (mirrors kesa)',
  },
  'pos.ground_side_kob': {
    rate: [20, 35], land: 0.55,
    dmg: { fist: 0.8, hammerfist: 0.8 },
    strikes: ['tech.gnp_punch', 'tech.gnp_hammerfist'],
    openings: { 'tech.escape_kob': 0.63 },
    subRiskPer30s: 0.02, judge: 2.5, tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.ground_north_south': {
    rate: [5, 10], land: 0.60,
    dmg: { knee: 0.4, hammerfist: 0.4 },
    strikes: ['tech.gnp_knee_body', 'tech.gnp_hammerfist'],
    openings: { 'tech.escape_north_south': 0.21 },
    subRiskPer30s: 0, judge: 1.5, tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.ground_half_flat': {
    // The highest-volume MMA ground-and-pound node.
    rate: [15, 30], land: 0.55,
    dmg: { elbow: 0.7, fist: 0.6, hammerfist: 0.6 },
    strikes: ['tech.gnp_elbow', 'tech.gnp_punch', 'tech.gnp_hammerfist'],
    openings: {
      'tech.dogfight_entry': 0.42,
      'tech.knee_shield_wrestle_up': 0.42,
      'tech.escape_half_recover': 0.21,
    },
    subRiskPer30s: 0.03, judge: 2.5, tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.ground_half_quarter': {
    rate: [15, 30], land: 0.55,
    dmg: { elbow: 0.7, fist: 0.6 },
    strikes: ['tech.gnp_elbow', 'tech.gnp_punch'],
    openings: { 'tech.escape_half_recover': 0.21 },
    subRiskPer30s: 0.01, judge: 2.5, tag: '[S: BJJ_POSITIONS §4] (as half flat)',
  },
  'pos.ground_half_underhook': {
    rate: [8, 15], land: 0.50,
    dmg: { fist: 0.5, elbow: 0.5 },
    strikes: ['tech.gnp_punch', 'tech.gnp_elbow'],
    openings: { 'tech.dogfight_entry': 0.42 },
    subRiskPer30s: 0.01, judge: 1.5, tag: '[S: BJJ_POSITIONS §4] (between half flat and knee shield)',
  },
  'pos.ground_half_dogfight': {
    rate: [5, 12], land: 0.40,
    dmg: { fist: 0.4 },
    strikes: ['tech.gnp_punch'],
    openings: {},
    subRiskPer30s: 0.01, judge: 1, tag: '[S: BJJ_POSITIONS §4] (both hands are busy)',
  },
  'pos.ground_half_knee_shield': {
    rate: [5, 12], land: 0.40,
    dmg: { fist: 0.3, hammerfist: 0.3 },
    strikes: ['tech.gnp_punch', 'tech.gnp_hammerfist'],
    openings: {},
    subRiskPer30s: 0, judge: 1, tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.ground_half_butterfly': {
    rate: [5, 12], land: 0.40,
    dmg: { fist: 0.3 },
    strikes: ['tech.gnp_punch'],
    openings: {},
    subRiskPer30s: 0, judge: 1, tag: '[S: BJJ_POSITIONS §4] (as knee shield)',
  },
  'pos.ground_half_deep': {
    rate: [8, 15], land: 0.60,
    dmg: { elbow: 0.5, hammerfist: 0.5 },
    strikes: ['tech.gnp_elbow', 'tech.gnp_hammerfist'],
    openings: { 'tech.sweep_deep_half': 0.42 },
    subRiskPer30s: 0.01, judge: 1.5, tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.ground_half_lockdown': {
    rate: [8, 15], land: 0.60,
    dmg: { elbow: 0.5, hammerfist: 0.5 },
    strikes: ['tech.gnp_elbow', 'tech.gnp_hammerfist'],
    openings: { 'tech.lockdown_whip_up': 0.42 },
    subRiskPer30s: 0.01, judge: 1.5, tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.ground_closed_posture_up': {
    rate: [12, 25], land: 0.45,
    dmg: { fist: 0.5, elbow: 0.7 },
    strikes: ['tech.gnp_punch', 'tech.gnp_elbow'],
    openings: { 'tech.sweep_hip_bump': 0.63 },
    subRiskPer30s: 0.04, judge: 1.5, tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.ground_closed_posture_broken': {
    rate: [3, 8], land: 0.40,
    dmg: { fist: 0.2, elbow: 0.2 },
    strikes: ['tech.gnp_punch', 'tech.gnp_elbow'],
    openings: {},
    // The bottom is the attacking slot here: chapter 04 runs 1.0 attempts/min at T3+.
    subRiskPer30s: 0.5, judge: 0.5, tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.ground_closed_high': {
    rate: [3, 8], land: 0.40,
    dmg: { fist: 0.2 },
    strikes: ['tech.gnp_punch'],
    openings: {},
    subRiskPer30s: 0.5, judge: 0.5, tag: '[S: BJJ_POSITIONS §4] (as posture broken)',
  },
  'pos.ground_closed_rubber': {
    rate: [3, 8], land: 0.40,
    dmg: { fist: 0.2 },
    strikes: ['tech.gnp_punch'],
    openings: {},
    subRiskPer30s: 0.5, judge: 0.5, tag: '[S: BJJ_POSITIONS §4] (as posture broken)',
  },
  'pos.ground_closed_top_standing': {
    rate: [6, 15], land: 0.40,
    dmg: { fist: 0.7 },
    strikes: ['tech.gnp_punch'],
    openings: {},
    subRiskPer30s: 0.03, judge: 1, tag: '[S: BJJ_POSITIONS §4] (as standing over guard)',
  },
  'pos.ground_open_kneeling_top': {
    rate: [10, 20], land: 0.45,
    dmg: { fist: 0.6, hammerfist: 0.6 },
    strikes: ['tech.gnp_punch', 'tech.gnp_hammerfist'],
    openings: { 'tech.sweep_scissor': 0.42, 'tech.sweep_on_strike': 0.42 },
    subRiskPer30s: 0.03, judge: 1.5, tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.ground_hq': {
    rate: [10, 20], land: 0.45,
    dmg: { fist: 0.6, hammerfist: 0.6 },
    strikes: ['tech.gnp_punch', 'tech.gnp_hammerfist'],
    openings: { 'tech.sweep_on_strike': 0.42 },
    subRiskPer30s: 0.03, judge: 1.5, tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.ground_open_legs_up': {
    // Diving punches land hard and rarely; soccer kicks and stomps are illegal.
    rate: [6, 15], land: 0.40,
    dmg: { fist: 0.7 },
    strikes: ['tech.gnp_punch'],
    openings: { 'tech.upkick_push_stand': 0, 'tech.technical_standup': 0 },
    subRiskPer30s: 0.01, judge: 1, tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.ground_open_butterfly': {
    rate: [6, 15], land: 0.45,
    dmg: { fist: 0.5 },
    strikes: ['tech.gnp_punch'],
    openings: {},
    subRiskPer30s: 0.03, judge: 1, tag: '[S: BJJ_POSITIONS §4] (as kneeling top)',
  },
  'pos.ground_open_seated': {
    rate: [6, 15], land: 0.45,
    dmg: { fist: 0.5 },
    strikes: ['tech.gnp_punch'],
    openings: {},
    subRiskPer30s: 0.03, judge: 1, tag: '[S: BJJ_POSITIONS §4] (as kneeling top)',
  },
  'pos.ground_open_x': {
    rate: [4, 10], land: 0.40,
    dmg: { fist: 0.4 },
    strikes: ['tech.gnp_punch'],
    openings: {},
    subRiskPer30s: 0.05, judge: 0.5, tag: '[S: BJJ_POSITIONS §4] (head exposed, hands busy)',
  },
  'pos.ground_open_k': {
    rate: [8, 18], land: 0.50,
    dmg: { fist: 0.6 },
    strikes: ['tech.gnp_punch'],
    openings: {},
    subRiskPer30s: 0.05, judge: 1, tag: '[S: BJJ_POSITIONS §4] (head exposed: K-guard is rare in MMA)',
  },
  'pos.ground_turtle': {
    rate: [15, 30], land: 0.60,
    dmg: { fist: 0.6, hammerfist: 0.6, knee: 0.5 },
    strikes: ['tech.gnp_punch', 'tech.gnp_hammerfist', 'tech.gnp_knee_body'],
    openings: { 'tech.turtle_sit_out_peek': 0.42 },
    subRiskPer30s: 0, judge: 2.5, tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.ground_referee': {
    rate: [15, 30], land: 0.60,
    dmg: { fist: 0.6, hammerfist: 0.6 },
    strikes: ['tech.gnp_punch', 'tech.gnp_hammerfist'],
    openings: { 'tech.turtle_sit_out_peek': 0.42 },
    subRiskPer30s: 0, judge: 2.5, tag: '[S: BJJ_POSITIONS §4] (as turtle)',
  },
  'pos.ground_front_headlock': {
    rate: [10, 20], land: 0.55,
    dmg: { knee: 0.6, fist: 0.6, elbow: 0.6 },
    strikes: ['tech.gnp_knee_body', 'tech.gnp_punch', 'tech.gnp_elbow'],
    openings: { 'tech.re_shot': 0.42 },
    subRiskPer30s: 0, judge: 2, tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.td_sprawl': {
    rate: [10, 20], land: 0.55,
    dmg: { knee: 0.6, fist: 0.6, elbow: 0.6 },
    strikes: ['tech.gnp_knee_body', 'tech.gnp_punch', 'tech.gnp_elbow'],
    openings: { 'tech.re_shot': 0.42 },
    subRiskPer30s: 0, judge: 2, tag: '[S: BJJ_POSITIONS §4]',
  },
  'pos.ground_truck': {
    rate: [15, 30], land: 0.60,
    dmg: { fist: 0.6, hammerfist: 0.6 },
    strikes: ['tech.gnp_punch', 'tech.gnp_hammerfist'],
    openings: {},
    subRiskPer30s: 0, judge: 2.5, tag: '[E] (between one-hook back and crucifix)',
  },
};

/** Bottom striking from any guard: rarely wins rounds, but it stops 10-8s. */
export const BOTTOM_GNP: GnpProfile = {
  rate: [5, 15], land: 0.40,
  dmg: { elbow: 0.4, fist: 0.3, heel: 0.6 },
  strikes: ['tech.bottom_elbow', 'tech.bottom_punch', 'tech.upkick'],
  openings: {},
  subRiskPer30s: 0,
  judge: 0.5,
  tag: '[S: BJJ_POSITIONS §4]',
};

export const GNP_TABLE: Readonly<Record<string, GnpProfile>> = Object.freeze(GNP);

/** The striking profile of the top slot in a node, or null when it has none. */
export function gnpProfile(node: PositionId): GnpProfile | null {
  return GNP_TABLE[node] ?? null;
}

/** Can the top slot strike at all from here? */
export function canStrikeFromTop(node: PositionId): boolean {
  const p = gnpProfile(node);
  return p !== null && p.rate[1] > 0;
}

/** Attempts per minute, interpolated across the node's band by intent (0-1). */
export function strikeRatePerMinute(profile: GnpProfile, intent: number): number {
  const t = Math.min(1, Math.max(0, intent));
  return profile.rate[0] + (profile.rate[1] - profile.rate[0]) * t;
}

// ---------------------------------------------------------------------------
// §5.2 The posture-versus-control trade-off
// ---------------------------------------------------------------------------

export interface PostureTradeoff {
  /** POST logit the bottom gets on every sweep, escape and get-up that lists it. */
  bottomPostBonus: number;
  /** Extra logit on specific bottom edges from this node (§5.1 "openings"). */
  bottomOpenings: Readonly<Record<EdgeId, number>>;
  /** STK+ the top can accumulate, capped at grap.stkMax strikes. */
  topStrikeBonusMax: number;
  /** Damage multiplier on each landed strike while postured. */
  damageBonus: number;
}

/**
 * §5.2: posturing up buys striking and sells position. At T4 vs T4 from closed
 * guard it raises the top's pass P by up to +0.60 (STK+) while raising the
 * bottom's hip bump from 0.25 to about 0.48 for the tick the hand is posted
 * `[D: logit(0.25) + 0.40 + 0.63 = -0.07 => 0.48]`. That trade is exactly what
 * chapter 07 is choosing between.
 */
export function postureTradeoff(node: PositionId, params: ResolvedParams): PostureTradeoff {
  const profile = gnpProfile(node);
  return {
    bottomPostBonus: params.get('grap.postureBonus'),
    bottomOpenings: profile?.openings ?? {},
    topStrikeBonusMax: params.get('grap.stkPerStrike') * params.get('grap.stkMax'),
    damageBonus: params.get('grap.gnpPostureDmgBonus'),
  };
}

/** The extra logit a specific bottom edge gets while the top is postured. */
export function openingBonus(
  node: PositionId, edge: EdgeId, posture: 'chest' | 'postured', params: ResolvedParams,
): number {
  if (posture !== 'postured') return 0;
  const profile = gnpProfile(node);
  const extra = profile?.openings[edge];
  // The generic POST bonus is carried by the edge's own POST state modifier, so
  // only the per-node opening is added here.
  return extra ?? 0;
}

/**
 * §5.2: a landed ground strike drains the bottom's stamina and degrades guard
 * retention. T0 guards open after 3 landed strikes, T1 after 5.
 */
export interface StrikePressureResult {
  staminaDrain: number;
  retentionLogit: number;
  guardOpens: boolean;
}

export function strikePressure(
  landedStrikes: number, bottomTier: number, groundDamagePoolPct: number,
  params: ResolvedParams,
): StrikePressureResult {
  const threshold = bottomTier <= 0
    ? params.get('grap.guardOpensAfterStrikesT0')
    : bottomTier === 1 ? params.get('grap.guardOpensAfterStrikesT1') : Infinity;
  return {
    staminaDrain: landedStrikes * params.get('grap.gnpStaminaDrainPerLanded'),
    retentionLogit: params.get('grap.gnpRetentionPenaltyPer5pct') * (groundDamagePoolPct / 5),
    guardOpens: landedStrikes >= threshold,
  };
}

/** §5.3: STK+ from the top's recent landed strikes, capped at grap.stkMax. */
export function passPressureBonus(recentLanded: number, params: ResolvedParams): number {
  return params.get('grap.stkPerStrike') * Math.min(recentLanded, params.get('grap.stkMax'));
}

// ---------------------------------------------------------------------------
// §6 Activity, stalling and control time
// ---------------------------------------------------------------------------

/**
 * §6.1: what counts as work. Work = a landed strike in any position, an attempt
 * at any catalogue `tech.*` edge, a chapter 04 stage advance, or a node change.
 * Not work: holding a node, posturing up or settling down on their own, or a
 * grip change with no attempt behind it.
 */
export const NON_WORK_EDGES: ReadonlySet<EdgeId> = new Set([
  'tech.gnp_posture',
  'tech.gnp_settle',
  // `tech.grip_exchange` counts as work only under the judo ruleset.
  'tech.grip_exchange',
]);

export function isWork(edge: EdgeId, ruleset: { judoGripsAreWork?: boolean } = {}): boolean {
  if (edge === 'tech.grip_exchange') return ruleset.judoGripsAreWork === true;
  if (edge.startsWith('ref.')) return false;
  return !NON_WORK_EDGES.has(edge);
}

export type RefereeStrictness = 'lenient' | 'standard' | 'strict';

/** §6.2 timer columns. The default column is the middle one (§9.3.14c). */
export const TIMER_COLUMNS: Readonly<Record<RefereeStrictness, {
  standupWarnS: number; standupS: number; clinchBreakS: number;
}>> = Object.freeze({
  lenient: { standupWarnS: 45, standupS: 75, clinchBreakS: 40 },
  standard: { standupWarnS: 30, standupS: 50, clinchBreakS: 25 },
  strict: { standupWarnS: 15, standupS: 30, clinchBreakS: 12 },
});

export interface ActivityCounters {
  /** Milliseconds since either fighter did work in this engagement. */
  sinceWorkMs: number;
  /** Milliseconds the top has spent in a guard node with no strike or pass attempt. */
  passiveTopMs: number;
  /** Milliseconds in a fence clinch with no strikes or takedown attempts. */
  clinchIdleMs: number;
  /** Accrued control time, milliseconds, per slot. */
  controlMs: { a: number; b: number };
  /** Landed ground strikes this round, for the 10-8 test. */
  groundStrikesLanded: number;
  /** Milliseconds spent in dominant positions this round. */
  dominantMs: number;
}

export function newActivityCounters(): ActivityCounters {
  return {
    sinceWorkMs: 0, passiveTopMs: 0, clinchIdleMs: 0,
    controlMs: { a: 0, b: 0 }, groundStrikesLanded: 0, dominantMs: 0,
  };
}

export interface ActivityTickInput {
  node: PositionId;
  kind: 'clinch' | 'takedown' | 'throw' | 'ground' | 'scramble' | 'knockdown';
  posture: 'chest' | 'postured';
  cage: boolean;
  /** Slot `a` holds the underhook, head position or a cage pin. */
  aHasControlGrip: boolean;
  /** Any work this tick (see `isWork`). */
  workThisTick: boolean;
  /** A top strike or pass attempt this tick — resets the passive-top clock. */
  topActiveThisTick: boolean;
  /** A strike or takedown attempt in the clinch this tick. */
  clinchActionThisTick: boolean;
}

/**
 * §6.3: control time accrues to slot `a` of a clinch engagement holding the
 * underhook, head position or a cage pin; to the attacker of any takedown
 * engagement; and to the top slot of a ground node whose ctrl rating reaches
 * `grap.controlTimeMinCtrl`, plus the back-control nodes. Bottom control never
 * accrues under Unified (§9.3.12).
 */
export function advanceActivity(
  counters: ActivityCounters, input: ActivityTickInput, dtMs: number, params: ResolvedParams,
): void {
  counters.sinceWorkMs = input.workThisTick ? 0 : counters.sinceWorkMs + dtMs;

  const node = positionNode(input.node);
  const isGuardNode = node.family === 'closedGuard' || node.family === 'openGuard';
  if (input.kind === 'ground' && isGuardNode) {
    counters.passiveTopMs = input.topActiveThisTick ? 0 : counters.passiveTopMs + dtMs;
  } else {
    counters.passiveTopMs = 0;
  }

  if (input.kind === 'clinch' && input.cage) {
    counters.clinchIdleMs = input.clinchActionThisTick ? 0 : counters.clinchIdleMs + dtMs;
  } else {
    counters.clinchIdleMs = 0;
  }

  const minCtrl = params.get('grap.controlTimeMinCtrl');
  const accrues =
    (input.kind === 'clinch' && input.aHasControlGrip)
    || input.kind === 'takedown'
    || (input.kind === 'ground' && node.controlRating >= minCtrl)
    || node.family === 'back';
  if (accrues) {
    counters.controlMs.a += dtMs;
    counters.dominantMs += node.controlRating >= 7 ? dtMs : 0;
  }
}

export type RefereeCue = 'none' | 'standupWarning' | 'standup' | 'passiveTop' | 'clinchBreak';

/**
 * §6.2: which cue the referee should be considering. The actual roll —
 * `grap.standupRollPerS` per second, `grap.clinchBreakRollPer5s` per 5 s — is
 * chapter 06's, taken in phase P6 of the tick.
 *
 * TODO(chapter 06): the referee module consumes this and owns the draw.
 */
export function refereeCue(
  counters: ActivityCounters, kind: ActivityTickInput['kind'],
  strictness: RefereeStrictness, params: ResolvedParams,
): RefereeCue {
  const col = TIMER_COLUMNS[strictness];
  if (kind === 'clinch' && counters.clinchIdleMs >= col.clinchBreakS * 1000) return 'clinchBreak';
  if (kind === 'ground') {
    if (counters.passiveTopMs >= params.get('grap.passiveTopS') * 1000) return 'passiveTop';
    if (counters.sinceWorkMs >= col.standupS * 1000) return 'standup';
    if (counters.sinceWorkMs >= col.standupWarnS * 1000) return 'standupWarning';
  }
  return 'none';
}

/**
 * §6.3: judge credit per minute in a node, 0-3. A 10-8 needs at least 3 minutes
 * of dominant position **and** 15 landed ground strikes or a near-finish.
 */
export function judgeCreditPerMinute(node: PositionId): number {
  return gnpProfile(node)?.judge ?? 0;
}

export function qualifiesForTenEight(counters: ActivityCounters, nearFinish: boolean): boolean {
  const threeMinutes = 3 * 60 * 1000;
  return counters.dominantMs >= threeMinutes
    && (counters.groundStrikesLanded >= 15 || nearFinish);
}
