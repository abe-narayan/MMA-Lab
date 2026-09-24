/**
 * GRAPPLING STATE GRAPH — node and edge catalogues as data.
 *
 * Source of truth: docs/design/03_GRAPPLING_STATE_GRAPH.md §2.2 (74 nodes) and
 * §2.3 (the edge tables A–L). Every number here is copied from that chapter
 * together with its provenance tag (00_CONVENTIONS §1: `[S: FILE §n]` sourced,
 * `[D: …]` derived, `[E]` estimate). A number with no tag is a bug.
 *
 * Two structural decisions carried from the design, both of which the rest of
 * this module depends on:
 *
 *  1. **One node per pair.** A grappling position is a single node shared by
 *     both fighters, with `a` = the slot the node table calls
 *     controls/top/attacker and `b` = the other. 09 §1.6's I2 originally spoke
 *     of `*_top`/`*_bottom` node pairs; its own REVIEW note retracts that.
 *     `COMPLEMENTARY_NODE` is therefore the identity involution — see its
 *     comment for why it still exists as data.
 *
 *  2. **Destination weights, not destination nodes.** Almost every edge lands
 *     in one of several nodes with research-quoted weights, and some of them
 *     hand slot `a` to the defender (the "(def)" marker in the tables). That is
 *     `swap: true` on the destination.
 *
 * Probability convention (00_CONVENTIONS §4): `baseP` is P(success) for
 * T4-vs-T4, fresh, open mat. Skill gaps, physical and state modifiers are added
 * in logit space by `resolve.ts`; they are named here, never applied here.
 */
import {
  POSITION_IDS, TECHNIQUE_IDS, DEFENCE_IDS, SUBMISSION_IDS,
  type PositionId, type SubmissionId,
} from '../core/ids';
import type { EngagementRole } from '../record/snapshot';

// ---------------------------------------------------------------------------
// Node types
// ---------------------------------------------------------------------------

/** Which §2.2 sub-table a node came from. Drives slot naming and GnP lookup. */
export type PositionFamily =
  | 'standingFree'      // §2.2.1 — owned by chapter 02, entry nodes here
  | 'clinch'            // §2.2.2
  | 'attack'            // §2.2.3 — transient, contested
  | 'mount'             // §2.2.4
  | 'back'              // §2.2.5
  | 'side'              // §2.2.6
  | 'half'              // §2.2.7
  | 'closedGuard'       // §2.2.8
  | 'openGuard'         // §2.2.9
  | 'turtle'            // §2.2.10
  | 'legEntanglement'   // §2.2.11
  | 'cageGround'        // §2.2.12 cage ground nodes
  | 'transient';        // §2.2.12 scramble / knockdown

/**
 * How the cage shows up for this node.
 *  - `flag`  — same node with `cage = true` on the engagement
 *  - `node`  — a separate cage node exists (see `CAGE_VARIANT_NODE`)
 *  - `is`    — this node only exists against the fence
 *  - `none`  — not applicable
 */
export type CageVariant = 'flag' | 'node' | 'is' | 'none';

/** Slot labels as the §2.2 "controls" column names them. */
export interface NodeSlots {
  a: 'top' | 'attacker' | 'controls' | 'neither';
  b: 'bottom' | 'defender' | 'other' | 'neither';
}

export interface PositionNode {
  id: PositionId;
  name: string;
  family: PositionFamily;
  /** §2.2 **ctrl**: how hard it is for the non-controlling fighter to improve, 0–10. */
  controlRating: number;
  /** §2.2 **strike T/B**, 0–10 each. */
  strikePotential: { top: number; bottom: number };
  /** §2.2 **subs T/B** — exit edges into chapter 04. */
  subThreats: { top: readonly SubmissionId[]; bottom: readonly SubmissionId[] };
  /** §2.2 **esc**: escape/break difficulty for the non-controlling slot at equal skill, 0–10. */
  escapeDifficulty: number;
  cageVariant: CageVariant;
  /** True when either fighter may hold slot `a` (09 §1.6 I2 exception). */
  symmetric: boolean;
  slots: NodeSlots;
  /** §2.2 **dwell s**: typical seconds before a transition at equal elite skill. */
  dwellS: readonly [number, number];
  tag: string;
}

const GROUND: NodeSlots = { a: 'top', b: 'bottom' };
const ATTACK: NodeSlots = { a: 'attacker', b: 'defender' };
const TIE: NodeSlots = { a: 'controls', b: 'other' };
const FREE: NodeSlots = { a: 'neither', b: 'neither' };

function node(
  id: string, name: string, family: PositionFamily, controlRating: number,
  strikeTop: number, strikeBottom: number, escapeDifficulty: number,
  cageVariant: CageVariant, slots: NodeSlots, dwellS: readonly [number, number], tag: string,
  subs?: { top?: readonly string[]; bottom?: readonly string[] }, symmetric = false,
): PositionNode {
  return {
    id, name, family, controlRating,
    strikePotential: { top: strikeTop, bottom: strikeBottom },
    subThreats: { top: subs?.top ?? [], bottom: subs?.bottom ?? [] },
    escapeDifficulty, cageVariant, symmetric, slots, dwellS, tag,
  };
}

// ---------------------------------------------------------------------------
// §2.2 Node catalogue — 74 nodes
// ---------------------------------------------------------------------------

/** §2.2.1 Standing free (4). Ratings are `[E]`; chapter 02 owns these nodes. */
const STANDING_FREE_NODES: readonly PositionNode[] = [
  // dwell for the three free-range nodes is chapter 02's range model, not ours.
  node('pos.standing_long', 'Long range', 'standingFree', 0, 6, 6, 0, 'flag', FREE, [0, 0], '[E]', undefined, true),
  node('pos.standing_mid', 'Punching range', 'standingFree', 0, 8, 8, 0, 'flag', FREE, [0, 0], '[E]', undefined, true),
  node('pos.standing_close', 'Pocket', 'standingFree', 0, 8, 8, 0, 'flag', FREE, [0, 0], '[E]', undefined, true),
  // The pressurer has initiative; escaping is circling out, hence esc 2.
  node('pos.standing_cage', 'Backed to the fence', 'standingFree', 1, 8, 7, 2, 'is', TIE, [3, 15], '[S: WRESTLING §2]'),
];

/** §2.2.2 Standing tie-ups (14). */
const CLINCH_NODES_DATA: readonly PositionNode[] = [
  node('pos.clinch_hand_fight', 'Hand fight', 'clinch', 1, 5, 5, 1, 'flag', TIE, [2, 6],
    '[S: JUDO §2.2 N2/N9] [S: JUDO §8 r12]', undefined, true),
  node('pos.clinch_collar_tie', 'Collar tie', 'clinch', 2, 7, 6, 2, 'flag', TIE, [3, 10],
    '[S: WRESTLING §2] [S: WRESTLING §5.4]', { top: ['sub.guillotine_standing'] }),
  node('pos.clinch_thai_plum', 'Thai plum', 'clinch', 4, 9, 3, 4, 'flag', TIE, [3, 8], '[S: MUAY_THAI §4.1]'),
  // The default MMA clinch: symmetric 50/50, so either fighter may be slot `a`.
  node('pos.clinch_over_under', 'Over-under', 'clinch', 3, 5, 5, 3, 'flag', TIE, [5, 20],
    '[S: JUDO §2.2 N5] [S: WRESTLING §5.3]', undefined, true),
  node('pos.clinch_underhook', 'Underhook (inside position)', 'clinch', 4, 6, 4, 4, 'flag', TIE, [3, 10],
    '[S: WRESTLING §2] [S: JUDO §2.2 N3]'),
  node('pos.clinch_overhook_control', 'Overhook / whizzer control', 'clinch', 3, 5, 4, 3, 'flag', TIE, [2, 6],
    '[S: WRESTLING §3.2 whizzer] [S: JUDO §2.2 N4]'),
  node('pos.clinch_double_under', 'Double unders', 'clinch', 6, 5, 3, 6, 'flag', TIE, [3, 8],
    '[S: WRESTLING §2]', { bottom: ['sub.guillotine_standing'] }),
  node('pos.clinch_body_lock_front', 'Front body lock', 'clinch', 6, 3, 4, 6, 'flag', TIE, [3, 10],
    '[S: WRESTLING §2] [S: JUDO §2.2 N7]', { bottom: ['sub.guillotine_standing'] }),
  // Cage variant is a distinct node, not a flag: the fence changes the geometry.
  node('pos.clinch_body_lock_rear', 'Rear body lock (standing back)', 'clinch', 6, 3, 2, 5, 'node', TIE, [5, 20],
    '[S: WRESTLING §2] [S: BJJ_POSITIONS §2.2]', { top: ['sub.rnc'] }),
  node('pos.clinch_front_headlock', 'Front headlock', 'clinch', 5, 6, 2, 5, 'flag', TIE, [3, 10],
    '[S: WRESTLING §2] [S: WRESTLING §9 r12]',
    { top: ['sub.guillotine_high_elbow', 'sub.guillotine_arm_in', 'sub.darce', 'sub.anaconda', 'sub.peruvian_necktie'] }),
  node('pos.clinch_head_and_arm', 'Head and arm', 'clinch', 4, 5, 4, 3, 'flag', TIE, [2, 6],
    '[S: JUDO §2.2 N6]', { top: ['sub.guillotine_arm_in'] }),
  node('pos.clinch_two_on_one', 'Two-on-one (Russian tie)', 'clinch', 4, 4, 3, 3, 'flag', TIE, [2, 6],
    '[S: JUDO §2.2 N8]'),
  node('pos.clinch_cage_pin_front', 'Cage pin, front', 'clinch', 6, 6, 4, 6, 'is', TIE, [5, 40],
    '[S: WRESTLING §2] [S: WRESTLING §5.2]', { top: ['sub.guillotine_standing'] }),
  node('pos.clinch_cage_pin_rear', 'Cage pin, rear', 'clinch', 7, 4, 2, 6, 'is', TIE, [5, 30],
    '[S: WRESTLING §2]', { top: ['sub.rnc'] }),
];

/** §2.2.3 Attacks in progress (8) — transient, contested. */
const ATTACK_NODES: readonly PositionNode[] = [
  node('pos.td_single_leg_in', 'Single leg captured', 'attack', 4, 2, 5, 4, 'flag', ATTACK, [1.5, 15],
    '[S: WRESTLING §2] [S: WRESTLING §8.4]', { bottom: ['sub.guillotine_standing'] }),
  node('pos.td_double_leg_in', 'Double leg captured', 'attack', 5, 1, 4, 4, 'flag', ATTACK, [1, 8],
    '[S: WRESTLING §2]', { bottom: ['sub.guillotine_standing'] }),
  node('pos.td_high_crotch_in', 'High crotch captured', 'attack', 5, 1, 3, 4, 'flag', ATTACK, [1.5, 8],
    '[S: WRESTLING §2] [S: WRESTLING §3.4]'),
  node('pos.td_low_single_in', 'Low single captured', 'attack', 3, 1, 6, 3, 'flag', ATTACK, [1, 4],
    '[S: WRESTLING §3.2]', { bottom: ['sub.guillotine_standing'] }),
  // Slot `a` is the sprawler: the defender has become the attacker.
  node('pos.td_sprawl', 'Sprawl', 'attack', 5, 6, 1, 4, 'flag', ATTACK, [1, 5],
    '[S: WRESTLING §2] [S: BJJ_POSITIONS §2.7]',
    { top: ['sub.guillotine_high_elbow', 'sub.darce', 'sub.anaconda'] }),
  node('pos.td_lifted', 'Lifted (slam pending)', 'attack', 8, 0, 2, 2, 'flag', ATTACK, [0.5, 1.5],
    '[S: WRESTLING §3.3] [S: JUDO §3 ura nage]', { bottom: ['sub.guillotine_standing'] }),
  node('pos.throw_in_progress', 'Throw in progress', 'attack', 0, 0, 0, 0, 'flag', ATTACK, [0.7, 1.4],
    '[S: JUDO §3 exec time]'),
  node('pos.td_kick_caught', 'Kick caught', 'attack', 4, 7, 3, 3, 'flag', ATTACK, [0.3, 2],
    '[S: MUAY_THAI §3.1]'),
];

/** §2.2.4 Mount family (4). `posture = 'postured'` on any of these is BJJ MOUNT_GNP. */
const MOUNT_NODES: readonly PositionNode[] = [
  node('pos.ground_mount_low', 'Low mount', 'mount', 7, 5, 1, 6, 'flag', GROUND, [15, 40],
    '[S: BJJ_POSITIONS §2.1]', { top: ['sub.arm_triangle', 'sub.ezekiel', 'sub.americana'] }),
  node('pos.ground_mount_high', 'High mount', 'mount', 8, 9, 0, 8, 'flag', GROUND, [10, 30],
    '[S: BJJ_POSITIONS §2.1]',
    { top: ['sub.armbar', 'sub.arm_triangle', 'sub.mounted_triangle', 'sub.mounted_guillotine'] }),
  node('pos.ground_mount_s', 'S-mount', 'mount', 8, 8, 0, 8, 'flag', GROUND, [5, 15],
    '[S: BJJ_POSITIONS §2.1]', { top: ['sub.armbar', 'sub.mounted_triangle'] }),
  node('pos.ground_mount_tech', 'Technical mount', 'mount', 8, 7, 0, 7, 'flag', GROUND, [5, 15],
    '[S: BJJ_POSITIONS §2.1]', { top: ['sub.armbar', 'sub.arm_triangle'] }),
];

/** §2.2.5 Back family (5). */
const BACK_NODES: readonly PositionNode[] = [
  node('pos.ground_back_hooks', 'Back, two hooks', 'back', 9, 5, 0, 8, 'flag', GROUND, [20, 90],
    '[S: BJJ_POSITIONS §2.2]', { top: ['sub.rnc', 'sub.armbar'] }),
  node('pos.ground_back_body_triangle', 'Back, body triangle', 'back', 9, 4, 0, 9, 'flag', GROUND, [30, 120],
    '[S: BJJ_POSITIONS §2.2]', { top: ['sub.rnc'] }),
  node('pos.ground_back_one_hook', 'Back, one hook', 'back', 6, 4, 0, 5, 'flag', GROUND, [5, 15],
    '[S: BJJ_POSITIONS §2.2]', { top: ['sub.rnc'] }),
  node('pos.ground_back_seatbelt', 'Seatbelt, no hooks', 'back', 6, 4, 0, 5, 'flag', GROUND, [5, 20],
    '[S: BJJ_POSITIONS §2.2]', { top: ['sub.rnc'] }),
  node('pos.ground_crucifix', 'Crucifix', 'back', 9, 8, 0, 8, 'flag', GROUND, [10, 40],
    '[S: BJJ_POSITIONS §2.2, §2.3]', { top: ['sub.rnc', 'sub.neck_crank', 'sub.crucifix_shoulder_lock'] }),
];

/** §2.2.6 Side-control family (5). */
const SIDE_NODES: readonly PositionNode[] = [
  // cage = true raises ctrl to 8 and esc to 7 (BJJ SIDE_CONTROL_WALL); cage.ts applies it.
  node('pos.ground_side', 'Side control', 'side', 7, 6, 1, 6, 'flag', GROUND, [15, 45],
    '[S: BJJ_POSITIONS §2.3]',
    { top: ['sub.arm_triangle', 'sub.kimura', 'sub.americana', 'sub.darce', 'sub.anaconda', 'sub.north_south_choke'] }),
  node('pos.ground_side_kesa', 'Kesa gatame', 'side', 7, 5, 1, 7, 'flag', GROUND, [15, 40],
    '[S: BJJ_POSITIONS §2.3]', { top: ['sub.americana', 'sub.arm_triangle'] }),
  node('pos.ground_side_reverse_kesa', 'Reverse kesa', 'side', 7, 4, 1, 6, 'flag', GROUND, [5, 20],
    '[S: BJJ_POSITIONS §2.3]', { top: ['sub.kimura'] }),
  node('pos.ground_side_kob', 'Knee on belly', 'side', 6, 7, 1, 4, 'flag', GROUND, [5, 15],
    '[S: BJJ_POSITIONS §2.3]', { top: ['sub.armbar', 'sub.darce'] }),
  node('pos.ground_north_south', 'North-south', 'side', 7, 3, 0, 6, 'flag', GROUND, [10, 30],
    '[S: BJJ_POSITIONS §2.3]', { top: ['sub.north_south_choke', 'sub.kimura', 'sub.armbar'] }),
];

/** §2.2.7 Half guard family (8). */
const HALF_NODES: readonly PositionNode[] = [
  node('pos.ground_half_flat', 'Half guard, bottom flat', 'half', 6, 7, 2, 5, 'flag', GROUND, [20, 60],
    '[S: BJJ_POSITIONS §2.4]',
    {
      top: ['sub.arm_triangle', 'sub.darce', 'sub.kimura'],
      bottom: ['sub.kimura', 'sub.guillotine_high_elbow', 'sub.triangle'],
    }),
  node('pos.ground_half_knee_shield', 'Knee shield (Z-guard)', 'half', 4, 3, 2, 3, 'flag', GROUND, [10, 30],
    '[S: BJJ_POSITIONS §2.4]', { bottom: ['sub.kimura', 'sub.triangle'] }),
  node('pos.ground_half_underhook', 'Half guard, bottom underhook', 'half', 4, 3, 1, 3, 'flag', GROUND, [5, 20],
    '[S: BJJ_POSITIONS §2.4]'),
  node('pos.ground_half_dogfight', 'Dogfight', 'half', 3, 2, 2, 2, 'flag', GROUND, [3, 10],
    '[S: BJJ_POSITIONS §2.4]', { top: ['sub.guillotine_high_elbow', 'sub.darce'] }),
  node('pos.ground_half_deep', 'Deep half', 'half', 5, 4, 0, 4, 'flag', GROUND, [5, 20],
    '[S: BJJ_POSITIONS §2.4]', { top: ['sub.kimura'] }),
  node('pos.ground_half_lockdown', 'Lockdown', 'half', 5, 4, 0, 4, 'flag', GROUND, [10, 30],
    '[S: BJJ_POSITIONS §2.4]', { bottom: ['sub.electric_chair', 'sub.banana_split'] }),
  node('pos.ground_half_quarter', 'Quarter guard', 'half', 8, 7, 0, 7, 'flag', GROUND, [5, 15],
    '[S: BJJ_POSITIONS §2.4]', { top: ['sub.arm_triangle', 'sub.kimura'] }),
  node('pos.ground_half_butterfly', 'Half butterfly', 'half', 4, 3, 1, 3, 'flag', GROUND, [5, 20],
    '[S: BJJ_POSITIONS §2.4]'),
];

/** §2.2.8 Closed guard family (5). */
const CLOSED_NODES: readonly PositionNode[] = [
  node('pos.ground_closed_posture_up', 'Closed guard, top postured', 'closedGuard', 4, 5, 2, 4, 'flag', GROUND, [10, 40],
    '[S: BJJ_POSITIONS §2.5]', { bottom: ['sub.kimura', 'sub.armbar', 'sub.triangle'] }),
  node('pos.ground_closed_posture_broken', 'Closed guard, posture broken', 'closedGuard', 2, 2, 3, 2, 'flag', GROUND, [10, 30],
    '[S: BJJ_POSITIONS §2.5]',
    { bottom: ['sub.triangle', 'sub.armbar', 'sub.kimura', 'sub.guillotine_high_elbow', 'sub.omoplata'] }),
  node('pos.ground_closed_high', 'High guard', 'closedGuard', 1, 1, 2, 1, 'flag', GROUND, [5, 20],
    '[S: BJJ_POSITIONS §2.5]', { bottom: ['sub.triangle', 'sub.armbar', 'sub.omoplata'] }),
  node('pos.ground_closed_rubber', 'Rubber guard', 'closedGuard', 2, 1, 1, 2, 'flag', GROUND, [10, 30],
    '[S: BJJ_POSITIONS §2.5]', { bottom: ['sub.gogoplata', 'sub.omoplata', 'sub.triangle'] }),
  node('pos.ground_closed_top_standing', 'Standing in closed guard', 'closedGuard', 5, 4, 3, 4, 'flag', GROUND, [3, 10],
    '[S: BJJ_POSITIONS §2.5]', { bottom: ['sub.kneebar', 'sub.heel_hook_inside'] }),
];

/** §2.2.9 Open guards (7). */
const OPEN_NODES: readonly PositionNode[] = [
  node('pos.ground_open_legs_up', 'Legs up / standing over guard', 'openGuard', 3, 4, 4, 4, 'flag', GROUND, [5, 20],
    '[S: BJJ_POSITIONS §2.6, §2.8]', { bottom: ['sub.straight_ankle'] }),
  node('pos.ground_open_butterfly', 'Butterfly guard', 'openGuard', 3, 3, 1, 3, 'flag', GROUND, [5, 20],
    '[S: BJJ_POSITIONS §2.6]',
    { top: ['sub.guillotine_high_elbow', 'sub.darce'], bottom: ['sub.guillotine_high_elbow'] }),
  node('pos.ground_open_seated', 'Seated / shin-to-shin guard', 'openGuard', 3, 3, 1, 3, 'flag', GROUND, [3, 10],
    '[S: BJJ_POSITIONS §2.6]', { bottom: ['sub.straight_ankle'] }),
  node('pos.ground_open_x', 'X-guard', 'openGuard', 2, 2, 0, 2, 'flag', GROUND, [3, 10],
    '[S: BJJ_POSITIONS §2.6]', { bottom: ['sub.straight_ankle', 'sub.kneebar'] }),
  node('pos.ground_open_k', 'K-guard', 'openGuard', 3, 4, 0, 3, 'flag', GROUND, [3, 10],
    '[S: BJJ_POSITIONS §2.6]', { bottom: ['sub.heel_hook_inside'] }),
  node('pos.ground_open_kneeling_top', 'Open guard vs kneeling top', 'openGuard', 4, 5, 1, 4, 'flag', GROUND, [5, 20],
    '[S: BJJ_POSITIONS §2.6]', { bottom: ['sub.armbar', 'sub.triangle'] }),
  node('pos.ground_hq', 'Headquarters', 'openGuard', 5, 5, 1, 4, 'flag', GROUND, [5, 15],
    '[S: BJJ_POSITIONS §2.8]', { bottom: ['sub.heel_hook_inside', 'sub.heel_hook_outside'] }),
];

/** §2.2.10 Turtle, front headlock, referee's position (3). */
const TURTLE_NODES: readonly PositionNode[] = [
  node('pos.ground_turtle', 'Turtle', 'turtle', 6, 6, 0, 5, 'flag', GROUND, [5, 20],
    '[S: BJJ_POSITIONS §2.7]', { top: ['sub.rnc', 'sub.anaconda', 'sub.darce'] }),
  node('pos.ground_referee', "Referee's position (tight-waist ride)", 'turtle', 6, 5, 0, 5, 'flag', GROUND, [5, 20],
    '[S: WRESTLING §2] [S: WRESTLING §3.8]', { top: ['sub.rnc'] }),
  node('pos.ground_front_headlock', 'Front headlock (ground)', 'turtle', 5, 5, 1, 5, 'flag', GROUND, [3, 10],
    '[S: BJJ_POSITIONS §2.7]',
    { top: ['sub.guillotine_high_elbow', 'sub.guillotine_arm_in', 'sub.darce', 'sub.anaconda', 'sub.peruvian_necktie'] }),
];

/** §2.2.11 Leg entanglements (7). Entries here; chapter 04 owns the finishes. */
const LEG_NODES: readonly PositionNode[] = [
  node('pos.ground_ashi_slx', 'Single-leg X / ashi garami', 'legEntanglement', 2, 2, 0, 2, 'flag', GROUND, [3, 10],
    '[S: BJJ_POSITIONS §2.6 SLX]', { bottom: ['sub.straight_ankle', 'sub.heel_hook_inside'] }),
  node('pos.ground_ashi_outside', 'Outside ashi', 'legEntanglement', 2, 2, 0, 2, 'flag', GROUND, [3, 8],
    '[E] (position from §04 heel-hook family; ratings mirror SLX)',
    { bottom: ['sub.straight_ankle', 'sub.heel_hook_outside', 'sub.toe_hold'] }),
  // Symmetric: both fighters are entangled identically, so either may be slot `a`.
  node('pos.ground_5050', '50/50', 'legEntanglement', 1, 2, 2, 1, 'flag', GROUND, [3, 15],
    '[E] (ratings), family [S: SUBMISSIONS §2.11]',
    { top: ['sub.heel_hook_inside', 'sub.heel_hook_outside'], bottom: ['sub.heel_hook_inside', 'sub.heel_hook_outside'] },
    true),
  node('pos.ground_saddle', 'Saddle / 411', 'legEntanglement', 4, 2, 1, 5, 'flag', GROUND, [3, 10],
    '[E] (ratings); family [S: SUBMISSIONS §2.11]',
    { bottom: ['sub.heel_hook_inside', 'sub.kneebar', 'sub.toe_hold'] }),
  node('pos.ground_reap', 'Knee reap', 'legEntanglement', 3, 2, 1, 4, 'flag', GROUND, [2, 6],
    '[E]; ruleset [S: BJJ_POSITIONS §9.1]', { bottom: ['sub.heel_hook_inside', 'sub.kneebar'] }),
  node('pos.ground_ashi_cross', 'Cross ashi garami', 'legEntanglement', 3, 2, 1, 3, 'flag', GROUND, [2, 6],
    '[E] (node requested by §04 §0.1; ratings mirror outside ashi)',
    { bottom: ['sub.heel_hook_outside', 'sub.kneebar'] }),
  node('pos.ground_truck', 'Truck', 'legEntanglement', 7, 5, 0, 6, 'flag', GROUND, [5, 15],
    '[E] (node requested by §04 §0.1; ratings between one-hook back and crucifix)',
    { top: ['sub.twister', 'sub.calf_slicer', 'sub.banana_split'] }),
];

/** §2.2.12 Cage-specific ground nodes, scramble, knockdown (4). */
const CAGE_GROUND_NODES: readonly PositionNode[] = [
  node('pos.ground_cage_seated', 'Seated against the fence', 'cageGround', 4, 4, 2, 3, 'is', GROUND, [5, 20],
    '[S: BJJ_POSITIONS §2.8]', { top: ['sub.guillotine_high_elbow'] }),
  node('pos.ground_wall_walk', 'Wall walk in progress', 'cageGround', 4, 3, 2, 3, 'is', GROUND, [3, 8],
    '[S: BJJ_POSITIONS §2.8] [S: WRESTLING §2]'),
  // Skill-driven and role-free: either fighter may be slot `a` (09 §1.6 I2).
  node('pos.scramble', 'Scramble', 'transient', 0, 0, 0, 0, 'flag', ATTACK, [1, 2],
    '[S: WRESTLING §6] [S: BJJ_POSITIONS §2.8]',
    { top: ['sub.guillotine_high_elbow', 'sub.darce', 'sub.anaconda'], bottom: ['sub.guillotine_high_elbow'] },
    true),
  node('pos.ground_knockdown', 'Knocked down', 'transient', 5, 8, 1, 3, 'flag', ATTACK, [0.5, 3],
    '[E] (node); knockdown -> finish conversion 65 % [S: FIGHT_DATA §5]'),
];

export const POSITION_NODES: readonly PositionNode[] = [
  ...STANDING_FREE_NODES, ...CLINCH_NODES_DATA, ...ATTACK_NODES,
  ...MOUNT_NODES, ...BACK_NODES, ...SIDE_NODES, ...HALF_NODES,
  ...CLOSED_NODES, ...OPEN_NODES, ...TURTLE_NODES, ...LEG_NODES,
  ...CAGE_GROUND_NODES,
];

/** §2.2 closes with "4 + 14 + 8 + 4 + 5 + 5 + 8 + 5 + 7 + 3 + 7 + 4 = 74 distinct ids". */
export const NODE_COUNT = 74;

const NODE_BY_ID = new Map<PositionId, PositionNode>();
for (const n of POSITION_NODES) {
  if (NODE_BY_ID.has(n.id)) throw new Error(`Duplicate position node: ${n.id}`);
  NODE_BY_ID.set(n.id, n);
}

export function positionNode(id: PositionId): PositionNode {
  const n = NODE_BY_ID.get(id);
  if (!n) throw new Error(`Unknown position node: ${id}`);
  return n;
}

export function hasPositionNode(id: string): boolean {
  return NODE_BY_ID.has(id);
}

export function nodesInFamilies(...families: readonly PositionFamily[]): readonly PositionId[] {
  const set = new Set(families);
  return POSITION_NODES.filter((n) => set.has(n.family)).map((n) => n.id);
}

/** Node groups the edge tables address collectively ("any `pos.clinch_*`", "any guard node"). */
export const CLINCH_NODE_IDS: readonly PositionId[] = nodesInFamilies('clinch');
export const GROUND_NODE_IDS: readonly PositionId[] = nodesInFamilies(
  'mount', 'back', 'side', 'half', 'closedGuard', 'openGuard', 'turtle', 'legEntanglement', 'cageGround',
);
export const GUARD_NODE_IDS: readonly PositionId[] = nodesInFamilies('closedGuard', 'openGuard');
export const STANDING_NODE_IDS: readonly PositionId[] = nodesInFamilies('standingFree');
/** Clinch nodes that exist away from the fence (open-mat breaks and pummels). */
export const OPEN_MAT_CLINCH_IDS: readonly PositionId[] =
  CLINCH_NODE_IDS.filter((id) => positionNode(id).cageVariant !== 'is');
/** Top slot may strike from these (chapter 05 GnP table keys on the same set). */
export const TOP_GNP_NODE_IDS: readonly PositionId[] = nodesInFamilies(
  'mount', 'back', 'side', 'half', 'closedGuard', 'openGuard', 'turtle',
);

// ---------------------------------------------------------------------------
// Complementary nodes, cage variants, role mapping (invariant I2)
// ---------------------------------------------------------------------------

/**
 * Complementary-node map used by invariant I2 (09 §1.6).
 *
 * Chapter 03 models a position as **one** node shared by the pair with `a`/`b`
 * slots, so the node the partner occupies is the same node: this map is the
 * identity involution. It exists as data rather than as an assumption because
 * I2 is stated over "both fighters' `position`" and a future ruleset (gi judo
 * `pos.throw_in_progress` variants, for instance) could legitimately split a
 * node in two; the invariant check reads this map, never `===`.
 *
 * Symmetry (`comp(comp(n)) === n`) is what the test asserts and what
 * `EngagementSet.checkInvariants` relies on.
 */
export const COMPLEMENTARY_NODE: ReadonlyMap<PositionId, PositionId> =
  new Map(POSITION_NODES.map((n) => [n.id, n.id] as const));

export function complementaryNode(id: PositionId): PositionId {
  const c = COMPLEMENTARY_NODE.get(id);
  if (c === undefined) throw new Error(`No complementary node for ${id}`);
  return c;
}

/**
 * Nodes whose `cage` column says a *separate* node exists rather than a flag
 * (§2.2.2). The engagement moves node when the fence is reached.
 */
export const CAGE_VARIANT_NODE: ReadonlyMap<PositionId, PositionId> = new Map([
  ['pos.clinch_body_lock_rear', 'pos.clinch_cage_pin_rear'],
]);

/** Map a node + slot onto the snapshot's `EngagementRole`. */
export function roleFor(id: PositionId, slot: 'a' | 'b'): EngagementRole {
  const label = slot === 'a' ? positionNode(id).slots.a : positionNode(id).slots.b;
  switch (label) {
    case 'top': return 'top';
    case 'bottom': return 'bottom';
    case 'attacker': case 'controls': return 'attacker';
    case 'defender': case 'other': return 'defender';
    default: return 'none';
  }
}

// ---------------------------------------------------------------------------
// §2.2.13 Alias map for chapter 04
// ---------------------------------------------------------------------------

/**
 * Chapter 04 §0.1 names its entry positions in its own vocabulary and states
 * that this chapter's ids win. Unlisted §04 ids are identical here.
 */
export const POSITION_ALIASES: Readonly<Record<string, PositionId>> = Object.freeze({
  'pos.clinch_whizzer': 'pos.clinch_overhook_control',
  'pos.clinch_rear_body_lock': 'pos.clinch_body_lock_rear',
  'pos.standing_front_headlock': 'pos.clinch_front_headlock',
  'pos.standing_sprawl': 'pos.td_sprawl',
  'pos.ground_scramble': 'pos.scramble',
  'pos.ground_mount_technical': 'pos.ground_mount_tech',
  // `pos.ground_mount_gnp` is a sub-state (`posture === 'postured'`), not a node;
  // it resolves to low mount so a §04 lookup still lands on a real node.
  'pos.ground_mount_gnp': 'pos.ground_mount_low',
  'pos.ground_back_seatbelt_no_hooks': 'pos.ground_back_seatbelt',
  'pos.ground_back_crucifix': 'pos.ground_crucifix',
  'pos.ground_crucifix_side': 'pos.ground_crucifix',
  'pos.ground_side_control': 'pos.ground_side',
  // The wall variant is `pos.ground_side` with `cage = true`.
  'pos.ground_side_control_wall': 'pos.ground_side',
  'pos.ground_kesa_gatame': 'pos.ground_side_kesa',
  'pos.ground_reverse_kesa': 'pos.ground_side_reverse_kesa',
  'pos.ground_knee_on_belly': 'pos.ground_side_kob',
  'pos.ground_closed_guard_bottom': 'pos.ground_closed_posture_up',
  'pos.ground_closed_guard_broken': 'pos.ground_closed_posture_broken',
  'pos.ground_high_guard': 'pos.ground_closed_high',
  'pos.ground_rubber_guard': 'pos.ground_closed_rubber',
  'pos.ground_closed_guard_standing_top': 'pos.ground_closed_top_standing',
  'pos.ground_open_guard_kneeling_top': 'pos.ground_open_kneeling_top',
  'pos.ground_open_supine_legs_up': 'pos.ground_open_legs_up',
  'pos.ground_butterfly': 'pos.ground_open_butterfly',
  'pos.ground_seated_shin_to_shin': 'pos.ground_open_seated',
  'pos.ground_x_guard': 'pos.ground_open_x',
  'pos.leg_ashi_slx': 'pos.ground_ashi_slx',
  'pos.leg_outside_ashi': 'pos.ground_ashi_outside',
  'pos.leg_saddle': 'pos.ground_saddle',
  'pos.leg_50_50': 'pos.ground_5050',
  'pos.leg_cross_ashi': 'pos.ground_ashi_cross',
  'pos.ground_cage_seated_bottom': 'pos.ground_cage_seated',
  // BJJ_POSITIONS' Z_GUARD (§2.2.9 closing line).
  'pos.ground_z_guard': 'pos.ground_half_knee_shield',
});

/** Resolve a §04 (or BJJ_POSITIONS) position id onto this chapter's id. */
export function resolvePositionAlias(id: string): PositionId {
  const direct = POSITION_ALIASES[id];
  if (direct !== undefined) return direct;
  if (NODE_BY_ID.has(id)) return id;
  throw new Error(`Unknown position id or alias: ${id}`);
}

/**
 * Submission id reconciliation (§2.2.13 closing paragraph). Chapter 04's
 * catalogue names are authoritative; only one id differs.
 */
export const SUBMISSION_ALIASES: Readonly<Record<string, SubmissionId>> = Object.freeze({
  'sub.straight_ankle': 'sub.ankle_lock_straight',
});

// ---------------------------------------------------------------------------
// Edge types
// ---------------------------------------------------------------------------

export type EdgeId = string;

/**
 * Sub-skill aliases (§2.1.3). Each resolves to one chapter 01 sub-skill or to a
 * declared composite; chapter 01 is authoritative for the names, this is the
 * binding map's key set. Where an edge names two aliases for one side the
 * engine uses the max `[E]`.
 */
export type SkillAlias =
  | 'wr.shot' | 'wr.finish' | 'wr.sprawl' | 'wr.pummel' | 'wr.mat_return' | 'wr.ride'
  | 'wr.scramble' | 'wr.get_up' | 'wr.chain'
  | 'jd.grip' | 'jd.throw_fwd' | 'jd.throw_rear' | 'jd.foot_sweep' | 'jd.counter' | 'jd.throw_def'
  | 'bjj.pass' | 'bjj.retention' | 'bjj.sweep' | 'bjj.escape' | 'bjj.top_control'
  | 'bjj.back_control' | 'bjj.leg_entangle'
  | 'mma.level_change' | 'mma.anti_wrestling' | 'mma.cage' | 'mma.gnp' | 'mma.clinch_strike';

/** §2.1.4 physical modifier codes. Attacker minus defender unless marked `d`. */
export type PhysCode =
  | 'STR+' | 'STR++' | 'STR-'
  | 'MASS+' | 'MASS++' | 'MASS-' | 'MASS--'
  | 'EXP+' | 'FLX+' | 'FLX++' | 'FLXd-' | 'BALd'
  | 'HGT+' | 'HGT-' | 'RCH+' | 'SPD+' | 'OWNBAL+';

/** §2.1.4 state modifier codes. */
export type StateCode =
  | 'SETUP' | 'TELE' | 'CAGE' | 'UHO' | 'STK+' | 'STK-' | 'STK--'
  | 'POST' | 'RCK' | 'WET' | 'WET+' | 'KUZ' | 'CHAIN' | 'LEGDMG'
  | 'FAT-' | 'FAT--' | 'FATd+' | 'FATd++' | 'GRECO' | 'FOLKSTYLE';

export interface PhysMod {
  code: PhysCode;
  /** Override the registry default logit-per-unit for this edge. */
  perUnit?: number;
  note?: string;
}

export interface StateMod {
  code: StateCode;
  /** CAGE carries its own per-edge logit; POST/UHO/RCK may override the default. */
  value?: number;
  /** CAGE and KUZ are multiplicative on P for some rows instead of additive. */
  multiplicative?: boolean;
  note?: string;
}

/** Destination node, or `'same'` for "stays in the from-node". */
export type DestinationNode = PositionId | 'same';

export interface EdgeDestination {
  node: DestinationNode;
  /** Weights within one cell sum to 1 (§2.3 column header). */
  weight: number;
  /**
   * The engagement's slots flip: whoever was in slot `b` takes slot `a` of the
   * destination (`EngagementSet.transition`). For an edge whose actor is slot
   * `a` this is exactly the §2.3 "(def)" marker. For an actor-`b` edge (sweeps,
   * escapes) it means the *actor* ends up in slot `a` — a reversal — so a
   * §2.3 "(bottom)" destination of an escape carries no swap. (Phase 9: three
   * escape rows — underhook turn, north-south escape, kesa escape to turtle —
   * had transcribed "(bottom)" as a swap and handed the escaping fighter the
   * top of the turtle.)
   */
  swap?: boolean;
  /** Chapter 04 entry instead of, or alongside, a node change. */
  submission?: SubmissionId;
  note?: string;
}

export interface EdgeRequirements {
  /** The §2.3 "requirements" cell, condensed. */
  text: string;
  cage?: 'required' | 'forbidden';
  minAttackerSkill?: { alias: SkillAlias; value: number };
  /** 0-100 reactionTime attribute gate (§9.1 grap.reactiveShotMinReaction). */
  minReactionTime?: number;
  /** 0-100 balance attribute gate. */
  minBalance?: number;
  minTier?: 0 | 1 | 2 | 3 | 4 | 5;
  notRocked?: boolean;
  /** Top posture the edge needs (get-ups that only exist against a postured top). */
  needsPosture?: 'postured' | 'chest';
  /** Judo grip gate (§2.3 D preamble): a throw needs a pull *and* a lift handle. */
  grips?: 'pullAndLift' | 'singleHandle' | 'none';
  /** Required kuzushi direction, 8-way compass, 0 = front (§2.1.1). */
  kuzushiDir?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  kuzushiMinMag?: 0 | 1 | 2 | 3;
}

/** Which §2.3 table the row came from. */
export type EdgeGroup = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'L';

export type EdgeKind =
  | 'setup' | 'entry' | 'capture' | 'finish' | 'chain' | 'clinch' | 'throw' | 'counter'
  | 'cage' | 'pass' | 'advance' | 'sweep' | 'escape' | 'getup' | 'strike' | 'defence'
  | 'referee' | 'scramble' | 'gnp' | 'subEntry';

/** Two-stage edges (leg attacks) roll capture and finish separately (§2.1.2). */
export interface TwoStageBase {
  capture: number;
  finish: number;
}

export interface GrapplingEdge {
  id: EdgeId;
  name: string;
  group: EdgeGroup;
  kind: EdgeKind;
  /** Which slot of the from-node initiates. */
  actor: 'a' | 'b';
  from: readonly PositionId[];
  to: readonly EdgeDestination[];
  toOnFailure: readonly EdgeDestination[];
  requirements: EdgeRequirements;
  /** Commit to resolution, milliseconds (§2.3 "dur"). */
  durationMs: readonly [number, number];
  /** P(success) T4 vs T4, fresh, open mat. Two-stage edges give both stages. */
  baseP: number | TwoStageBase;
  /** Logit per 100 skill points (§2.3 "k_skill"). 0 = uncontested. */
  kSkill: number;
  skills: { attacker: readonly SkillAlias[]; defender: readonly SkillAlias[] };
  physicalMods: readonly PhysMod[];
  stateMods: readonly StateMod[];
  counters: readonly string[];
  /** Provenance for every untagged number in the row (§2.3 "src"). */
  tag: string;
  /** Judo failure table applies instead of `toOnFailure` weights (§2.3 D). */
  judoFailure?: boolean;
  /** Commitment multiplier for the judo counter-launch branch (§2.3 D). */
  judoCommitment?: number;
  /** Defender rolls sub.guillotine_standing against this edge (§2.3 B preamble). */
  guillotineTax?: boolean;
  /** Landing produces a slam impact for chapter 05, scaled by this factor. */
  slamScale?: number;
  note?: string;
}

// ---------------------------------------------------------------------------
// Edge builders
// ---------------------------------------------------------------------------

function d(node: DestinationNode, weight: number, swap = false): EdgeDestination {
  return swap ? { node, weight, swap: true } : { node, weight };
}

function subEntry(submission: string, weight: number): EdgeDestination {
  return { node: 'same', weight, submission };
}

function ph(code: PhysCode, perUnit?: number): PhysMod {
  return perUnit === undefined ? { code } : { code, perUnit };
}

function st(code: StateCode, value?: number, multiplicative = false): StateMod {
  if (value === undefined) return { code };
  return multiplicative ? { code, value, multiplicative: true } : { code, value };
}

interface EdgeInput extends Omit<GrapplingEdge,
'actor' | 'physicalMods' | 'stateMods' | 'counters' | 'skills' | 'toOnFailure' | 'requirements'> {
  actor?: 'a' | 'b';
  requirements?: EdgeRequirements | string;
  toOnFailure?: readonly EdgeDestination[];
  skills?: { attacker?: readonly SkillAlias[]; defender?: readonly SkillAlias[] };
  physicalMods?: readonly PhysMod[];
  stateMods?: readonly StateMod[];
  counters?: readonly string[];
}

function edge(input: EdgeInput): GrapplingEdge {
  const req = input.requirements;
  return {
    ...input,
    actor: input.actor ?? 'a',
    requirements: typeof req === 'string' ? { text: req } : req ?? { text: '-' },
    toOnFailure: input.toOnFailure ?? [d('same', 1)],
    skills: { attacker: input.skills?.attacker ?? [], defender: input.skills?.defender ?? [] },
    physicalMods: input.physicalMods ?? [],
    stateMods: input.stateMods ?? [],
    counters: input.counters ?? [],
  };
}

/**
 * §2.3 B preamble: capture failure destinations, shared by every leg attack
 * unless the row overrides them. "(def)" on sprawl and front headlock.
 */
const CAPTURE_FAIL: readonly EdgeDestination[] = [
  d('pos.td_sprawl', 0.5, true),
  d('pos.standing_close', 0.35),
  d('pos.clinch_front_headlock', 0.15, true),
];

/**
 * §2.3 D failure table (rolled once per failed throw): reset to the same tie
 * 0.62 / tie lost 0.18 / position given 0.10 / counter-throw launched 0.10.
 * The counter-launch branch is resolved by `resolve.ts`, which scales it by
 * commitment and the defender's tier factor.
 */
export const JUDO_FAIL_TABLE: readonly EdgeDestination[] = [
  d('same', 0.62),
  d('pos.clinch_hand_fight', 0.18),
  d('pos.clinch_body_lock_rear', 0.10, true),
  d('same', 0.10, true),
];

// ---------------------------------------------------------------------------
// §2.3 A — Standing setups, entries and strike-to-grapple integration (17)
// ---------------------------------------------------------------------------

const EDGES_A: readonly GrapplingEdge[] = [
  edge({
    id: 'tech.level_change', name: 'Level change', group: 'A', kind: 'setup',
    from: ['pos.standing_mid', 'pos.standing_close'],
    // Not contested: it either happens or the defender reads it. 0.99 rather
    // than 1.0 so every base in the catalogue lives strictly inside (0, 1).
    to: [d('same', 1)],
    requirements: { text: 'not state.rocked; in stance', notRocked: true },
    durationMs: [200, 300], baseP: 0.99, kSkill: 0,
    stateMods: [st('FAT-')],
    counters: ['knee', 'uppercut', 'sprawl-in-place'],
    tag: '[S: WRESTLING §3.1]',
    note: 'Grants SETUP to the next shot for grap.setupWindowMs; at fatigue > 0.7 the AI drops it 25 % of the time.',
  }),
  edge({
    id: 'def.read_level_change', name: 'Read the level change', group: 'A', kind: 'defence', actor: 'b',
    from: ['pos.standing_mid', 'pos.standing_close'],
    // Success cancels the shot and opens chapter 02's counter window.
    to: [d('same', 1)],
    requirements: { text: 'reactionTime >= 50', minReactionTime: 50 },
    durationMs: [200, 200], baseP: 0.30, kSkill: 2.5,
    skills: { attacker: ['mma.anti_wrestling'], defender: ['mma.level_change'] },
    counters: ['feint the level change first'],
    tag: '[E] (MMA_INTEGRATION I-6 gives the hit bonus; the read probability is the estimate)',
  }),
  edge({
    id: 'tech.level_change_feint', name: 'Level-change feint', group: 'A', kind: 'setup',
    from: ['pos.standing_mid', 'pos.standing_close'],
    to: [d('same', 1)],
    requirements: 'opponent has shown a sprawl reaction this bout',
    // Chapter 01 owns the bite probability in the takedown domain; 0.30 is its
    // T4-vs-T4 value, quoted here so the catalogue is self-contained.
    durationMs: [250, 250], baseP: 0.30, kSkill: 2.0,
    skills: { attacker: ['mma.level_change'], defender: ['mma.anti_wrestling'] },
    counters: ['none (costs stamina)'],
    tag: '[S: MMA_INTEGRATION §2.1 I-6]',
  }),
  edge({
    id: 'tech.shot_reactive', name: 'Reactive shot', group: 'A', kind: 'entry',
    from: ['pos.standing_mid'],
    to: [d('pos.td_single_leg_in', 0.4), d('pos.td_double_leg_in', 0.35), d('pos.td_high_crotch_in', 0.25)],
    toOnFailure: CAPTURE_FAIL,
    requirements: {
      text: 'wr.shot >= 40; opponent strike commitment >= 300 ms; reactionTime >= 60',
      minAttackerSkill: { alias: 'wr.shot', value: 40 }, minReactionTime: 60,
    },
    durationMs: [400, 400], baseP: 0.55, kSkill: 2.5,
    skills: { attacker: ['mma.level_change'], defender: ['mma.anti_wrestling'] },
    physicalMods: [ph('EXP+')], stateMods: [st('SETUP')],
    counters: ['retract fast', 'throw with less commitment'],
    tag: '[S: WRESTLING §3.1]', guillotineTax: true,
  }),
  edge({
    id: 'tech.jab_to_double', name: 'Jab into a double', group: 'A', kind: 'entry',
    from: ['pos.standing_mid'],
    to: [d('pos.td_double_leg_in', 1)], toOnFailure: CAPTURE_FAIL,
    requirements: 'jab thrown <= 800 ms ago; opponent guard raised or stepping back',
    durationMs: [450, 450], baseP: 0.62, kSkill: 2.1,
    skills: { attacker: ['wr.shot'], defender: ['wr.sprawl'] },
    physicalMods: [ph('STR+'), ph('MASS+'), ph('EXP+')], stateMods: [st('SETUP')],
    counters: ['pull the hands down and sprawl', 'counter-jab into a knee', 'frame and circle'],
    tag: '[S: MMA_INTEGRATION §2.1 I-2]', guillotineTax: true,
  }),
  edge({
    id: 'tech.cross_to_single', name: 'Cross into a single', group: 'A', kind: 'entry',
    from: ['pos.standing_mid'],
    to: [d('pos.td_single_leg_in', 1)], toOnFailure: CAPTURE_FAIL,
    requirements: 'cross thrown <= 600 ms ago and the opponent stepped laterally',
    durationMs: [450, 450], baseP: 0.55, kSkill: 2.1,
    skills: { attacker: ['wr.shot'], defender: ['wr.sprawl'] },
    physicalMods: [ph('EXP+'), ph('STR+', 0.05)], stateMods: [st('SETUP'), st('CAGE', 0.42)],
    counters: ['limp leg / whizzer', 'sprawl on one leg', 'hop to the cage and hip in'],
    tag: '[S: MMA_INTEGRATION §2.1 I-3]', guillotineTax: true,
  }),
  edge({
    id: 'tech.hook_to_body_lock', name: 'Hook into a body lock', group: 'A', kind: 'entry',
    from: ['pos.standing_close'],
    to: [d('pos.clinch_body_lock_front', 1)],
    toOnFailure: [d('pos.clinch_over_under', 0.6), d('pos.standing_close', 0.4)],
    requirements: 'hook thrown, opponent covers or ducks, distance < 1.0 m',
    durationMs: [500, 500], baseP: 0.55, kSkill: 2.0,
    skills: { attacker: ['mma.level_change'], defender: ['wr.pummel'] },
    physicalMods: [ph('STR+')], stateMods: [st('SETUP')],
    counters: ['frame on the hip', 'underhook', 'hit on the entry'],
    tag: '[S: MMA_INTEGRATION §2.1 I-4]',
  }),
  edge({
    id: 'tech.clinch_entry_strikes', name: 'Clinch entry behind strikes', group: 'A', kind: 'entry',
    from: ['pos.standing_close'],
    to: [d('pos.clinch_collar_tie', 0.5), d('pos.clinch_over_under', 0.35), d('pos.clinch_underhook', 0.15)],
    toOnFailure: [d('pos.standing_close', 1)],
    requirements: '>= 2 strikes thrown in the last 1.5 s; distance < 1.0 m',
    durationMs: [400, 400], baseP: 0.47, kSkill: 2.0,
    skills: { attacker: ['mma.level_change'], defender: ['mma.clinch_strike'] },
    physicalMods: [ph('STR+')], stateMods: [st('SETUP'), st('CAGE', 0.35)],
    counters: ['frame', 'pivot off', 'knee on the entry'],
    tag: '[S: MMA_INTEGRATION §2.2 I-9]',
  }),
  edge({
    id: 'tech.clinch_entry_cold', name: 'Cold clinch entry', group: 'A', kind: 'entry',
    from: ['pos.standing_close'],
    to: [d('pos.clinch_collar_tie', 0.5), d('pos.clinch_over_under', 0.4), d('pos.clinch_hand_fight', 0.1)],
    toOnFailure: [d('pos.standing_mid', 0.7), d('pos.standing_close', 0.3)],
    requirements: 'none',
    durationMs: [400, 400], baseP: 0.35, kSkill: 2.0,
    skills: { attacker: ['wr.pummel'], defender: ['wr.pummel'] },
    physicalMods: [ph('STR+')], stateMods: [st('TELE'), st('CAGE', 0.35), st('RCK')],
    counters: ['frame', 'pivot off', 'knee on the entry'],
    tag: '[E] anchored on MMA_INTEGRATION I-9 minus the setup bonus',
  }),
  edge({
    id: 'tech.kick_catch', name: 'Kick catch', group: 'A', kind: 'entry', actor: 'b',
    from: ['pos.standing_mid'],
    to: [d('pos.td_kick_caught', 1)], toOnFailure: [d('same', 1)],
    requirements: {
      text: 'balance >= 60, reactionTime >= 55, inside the 200 ms contact window',
      minBalance: 60, minReactionTime: 55,
    },
    // Chapter 02 owns the catch roll; 0.28 is its body-kick value (teep 0.35,
    // knee 0.25, head kick 0.10, low kick 0.15 [E]).
    durationMs: [200, 200], baseP: 0.28, kSkill: 2.5,
    skills: { attacker: ['mma.anti_wrestling'], defender: [] },
    counters: ['retract the kick fast'],
    tag: '[S: MMA_INTEGRATION §2.1 I-5]',
  }),
  edge({
    id: 'tech.kick_catch_takedown', name: 'Takedown off the caught kick', group: 'A', kind: 'finish',
    from: ['pos.td_kick_caught'],
    to: [d('pos.ground_open_kneeling_top', 0.40), d('pos.ground_half_flat', 0.35), d('pos.ground_side', 0.25)],
    toOnFailure: [d('pos.standing_close', 0.7), d('pos.clinch_over_under', 0.3)],
    requirements: 'leg held >= 300 ms',
    durationMs: [700, 1200], baseP: 0.55, kSkill: 2.1,
    skills: { attacker: ['wr.finish'], defender: ['wr.sprawl'] },
    physicalMods: [ph('STR+'), ph('MASS+')],
    stateMods: [st('CAGE', 0.42), st('FAT-'), st('LEGDMG')],
    counters: ['hop and frame on the shoulder', 'punch while held', 're-teep with the free leg'],
    tag: '[S: MUAY_THAI §3.1] [D: equal-tier T2 value adopted as the T4 base]',
  }),
  edge({
    id: 'tech.kick_catch_strike', name: 'Strike the held leg', group: 'A', kind: 'strike',
    from: ['pos.td_kick_caught'],
    to: [d('same', 1)], toOnFailure: [d('same', 1)],
    requirements: 'leg still held',
    // Chapter 02 owns damage; 0.60 is its punch land rate from this node
    // (knee to body/thigh 0.65, kick the post 0.55).
    durationMs: [300, 500], baseP: 0.60, kSkill: 0,
    skills: { attacker: ['mma.clinch_strike'], defender: [] },
    counters: ["kicker's elbow or punch while held"],
    tag: '[S: MUAY_THAI §3.1]',
  }),
  edge({
    id: 'def.kick_pull_free', name: 'Pull the kick free', group: 'A', kind: 'escape', actor: 'b',
    from: ['pos.td_kick_caught'],
    to: [d('pos.standing_mid', 1)], toOnFailure: [d('same', 1)],
    requirements: 'rolled every 300 ms; 0.35 before the grip closes, 0.30 per beat after',
    durationMs: [300, 300], baseP: 0.35, kSkill: 2.0,
    skills: { attacker: ['bjj.retention', 'wr.sprawl'], defender: ['wr.finish'] },
    physicalMods: [ph('FLX+'), ph('OWNBAL+')], stateMods: [st('FAT-')],
    counters: ['catcher steps and pulls'],
    tag: '[S: MUAY_THAI §3.1]',
  }),
  edge({
    id: 'tech.knee_catch_single', name: 'Catch the knee into a single', group: 'A', kind: 'entry', actor: 'b',
    from: ['pos.clinch_collar_tie', 'pos.clinch_thai_plum'],
    to: [d('pos.td_single_leg_in', 1, true)], toOnFailure: [d('same', 1)],
    requirements: 'a knee thrown from the tie',
    durationMs: [300, 300], baseP: 0.30, kSkill: 2.0,
    skills: { attacker: ['wr.shot'], defender: ['mma.clinch_strike'] },
    stateMods: [st('SETUP')],
    counters: ['knee with less commitment', 'plum control'],
    tag: '[E] (+0.08 P catch window) [S: WRESTLING §5.4]',
  }),
  edge({
    id: 'tech.strike_in_tie', name: 'Strike in the tie', group: 'A', kind: 'strike',
    from: CLINCH_NODE_IDS,
    to: [d('same', 1)], toOnFailure: [d('same', 1)],
    requirements: 'a free hand, elbow or knee',
    // 0.60 is the midpoint of MMA_INTEGRATION I-10's 0.55-0.70 dirty-boxing band.
    durationMs: [300, 600], baseP: 0.60, kSkill: 0,
    skills: { attacker: ['mma.clinch_strike'], defender: [] },
    stateMods: [st('KUZ')],
    counters: ['pummel for double unders', 'head position', 'break'],
    tag: '[S: WRESTLING §5.4] [S: JUDO §5.4]',
    note: 'Every strike thrown from a tie gives the opponent +0.21 logit on duck-under / arm-drag / snap-down for 1 s.',
  }),
  edge({
    id: 'tech.hit_on_break', name: 'Hit on the break', group: 'A', kind: 'clinch',
    from: OPEN_MAT_CLINCH_IDS,
    to: [d('pos.standing_close', 1)], toOnFailure: [d('same', 1)],
    requirements: 'the breaker initiates the break',
    durationMs: [500, 500], baseP: 0.60, kSkill: 2.0,
    skills: { attacker: ['mma.clinch_strike'], defender: ['mma.clinch_strike'] },
    counters: ['step out with the hand up', 'pivot'],
    tag: '[S: MUAY_THAI §4.3] [S: MMA_INTEGRATION §2.2 I-12]',
  }),
  edge({
    id: 'tech.pull_guard', name: 'Pull guard', group: 'A', kind: 'entry',
    from: ['pos.clinch_collar_tie', 'pos.clinch_over_under', 'pos.clinch_front_headlock'],
    // The puller lands on the bottom, so the opponent takes slot `a`.
    to: [d('pos.ground_closed_posture_up', 0.7, true), d('pos.ground_open_butterfly', 0.3, true)],
    toOnFailure: [d('pos.ground_open_legs_up', 0.6, true), d('pos.ground_hq', 0.4, true)],
    requirements: 'grips',
    durationMs: [800, 800], baseP: 0.94, kSkill: 0,
    counters: ['stay standing and strike', 'referee stands them up'],
    tag: '[S: BJJ_POSITIONS §7.4] (guard pull 94 %, Williams 2019)',
  }),
];

// ---------------------------------------------------------------------------
// §2.3 B — Leg attacks: single, double, high crotch, low single, ankle pick (30)
//
// Two-stage throughout: capture then finish (§2.1.2). Finish failure keeps the
// `*_in` node for another attempt, capped at grap.finishAttemptsMaxOpen = 3 open
// mat and 6 on the cage. Every capture carries the guillotine tax.
// ---------------------------------------------------------------------------

const EDGES_B: readonly GrapplingEdge[] = [
  edge({
    id: 'tech.single_leg', name: 'Single leg (capture)', group: 'B', kind: 'capture',
    from: ['pos.standing_mid', 'pos.standing_close', 'pos.clinch_collar_tie',
      'pos.clinch_underhook', 'pos.clinch_hand_fight'],
    // Head inside 0.6 / outside 0.4 [E]; the sub-field lives on the engagement.
    to: [d('pos.td_single_leg_in', 1)],
    toOnFailure: [d('pos.td_sprawl', 0.40, true), d('pos.standing_close', 0.45),
      d('pos.clinch_front_headlock', 0.15, true)],
    requirements: 'level change (else TELE and -0.85 logit for T0-T1); lead leg within 1.2 m',
    durationMs: [500, 500], baseP: 0.55, kSkill: 2.1,
    skills: { attacker: ['wr.shot'], defender: ['wr.sprawl'] },
    physicalMods: [ph('EXP+'), ph('STR+', 0.05)],
    stateMods: [st('SETUP'), st('TELE'), st('CAGE', 0.42), st('FAT-'), st('RCK'), st('LEGDMG')],
    counters: ['sprawl', 'knee', 'down-block', 'step back'],
    tag: '[S: WRESTLING §3.2]', guillotineTax: true,
    note: 'Full TD 0.35-0.42 after the finish stage.',
  }),
  edge({
    id: 'tech.single_run_pipe', name: 'Run the pipe', group: 'B', kind: 'finish',
    from: ['pos.td_single_leg_in'],
    to: [d('pos.ground_open_kneeling_top', 0.55), d('pos.ground_half_flat', 0.35), d('pos.ground_side', 0.10)],
    toOnFailure: [d('same', 0.50), d('pos.standing_close', 0.35),
      d('pos.clinch_overhook_control', 0.15, true)],
    requirements: 'head on the inside hip, leg clamped',
    durationMs: [1000, 2000], baseP: 0.55, kSkill: 2.1,
    skills: { attacker: ['wr.finish'], defender: ['wr.sprawl'] },
    physicalMods: [ph('STR+'), ph('MASS+', 0.08)],
    // The fence is a *penalty* here: the attacker cannot circle.
    stateMods: [st('CAGE', -1.05), st('FAT-')],
    counters: ['whizzer', 'hop / limp leg', 'hand on the head', 'cage post'],
    tag: '[S: WRESTLING §3.2]',
  }),
  edge({
    id: 'tech.single_tree_top', name: 'Tree top', group: 'B', kind: 'finish',
    from: ['pos.td_single_leg_in'],
    to: [d('pos.ground_open_legs_up', 0.5), d('pos.ground_open_kneeling_top', 0.5)],
    requirements: 'leg lifted to the chest, defender hopping',
    durationMs: [1000, 1000], baseP: 0.50, kSkill: 2.1,
    skills: { attacker: ['wr.finish'], defender: ['wr.sprawl'] },
    physicalMods: [ph('STR+'), ph('HGT+')], stateMods: [st('FAT-')],
    counters: ["hook the attacker's leg", 'grab the head', 'hop to the cage'],
    tag: '[S: WRESTLING §3.2]',
  }),
  edge({
    id: 'tech.single_dump', name: 'Cut across / knee-tap dump', group: 'B', kind: 'finish',
    from: ['pos.td_single_leg_in'],
    to: [d('pos.ground_side', 0.5), d('pos.ground_half_flat', 0.5)],
    requirements: 'attacker steps across the posted leg',
    durationMs: [1000, 1000], baseP: 0.50, kSkill: 2.1,
    skills: { attacker: ['wr.finish'], defender: ['wr.sprawl'] },
    physicalMods: [ph('STR+')], stateMods: [st('CAGE', 0.42)],
    counters: ['limp leg', 'wide base', 'whizzer'],
    tag: '[S: WRESTLING §3.2]',
  }),
  edge({
    id: 'tech.single_to_double', name: 'Single to double', group: 'B', kind: 'chain',
    from: ['pos.td_single_leg_in'],
    to: [d('pos.td_double_leg_in', 0.7), d('pos.ground_open_kneeling_top', 0.3)],
    requirements: 'hips under, second hand to the far leg',
    durationMs: [1000, 1000], baseP: 0.60, kSkill: 2.1,
    skills: { attacker: ['wr.finish'], defender: ['wr.sprawl'] },
    physicalMods: [ph('STR+'), ph('MASS+')], stateMods: [st('CHAIN'), st('FAT-')],
    counters: ['turn the hips away', 'whizzer', 'cage post'],
    tag: '[S: WRESTLING §3.2]',
  }),
  edge({
    id: 'tech.single_trip', name: 'Single-leg trip', group: 'B', kind: 'finish',
    from: ['pos.td_single_leg_in'],
    to: [d('pos.ground_open_kneeling_top', 0.6), d('pos.ground_half_flat', 0.4)],
    requirements: 'free leg reachable; defender posted, especially on the cage',
    durationMs: [700, 700], baseP: 0.45, kSkill: 2.1,
    skills: { attacker: ['wr.finish', 'jd.throw_rear'], defender: ['wr.sprawl'] },
    stateMods: [st('CAGE', 0.42)],
    counters: ['hop away', 'hip in on the cage'],
    tag: '[S: WRESTLING §3.2]',
  }),
  edge({
    id: 'tech.single_low', name: 'Low single (capture)', group: 'B', kind: 'capture',
    from: ['pos.standing_mid'],
    to: [d('pos.td_low_single_in', 1)],
    toOnFailure: [d('pos.standing_close', 1)],
    requirements: { text: 'speed and explosiveness; > 1.2 m of open mat', cage: 'forbidden' },
    durationMs: [400, 400], baseP: { capture: 0.45, finish: 0.60 }, kSkill: 2.1,
    skills: { attacker: ['wr.shot'], defender: ['wr.sprawl'] },
    physicalMods: [ph('EXP+'), ph('SPD+')],
    stateMods: [st('CAGE', -0.42), st('TELE')],
    counters: ['hop away', 'hip down / limp leg', 'punch down on the head'],
    tag: '[S: WRESTLING §3.2]', guillotineTax: true,
    note: 'Light divisions +0.21 logit [D: +5 pp]; 20 % of failures eat a strike.',
  }),
  edge({
    id: 'tech.single_low_finish', name: 'Low single finish', group: 'B', kind: 'finish',
    from: ['pos.td_low_single_in'],
    to: [d('pos.ground_open_kneeling_top', 0.60), d('pos.scramble', 0.35), d('pos.ground_side', 0.05)],
    toOnFailure: [d('pos.standing_close', 0.6), d('pos.td_single_leg_in', 0.4)],
    requirements: 'ankle in hand; drive or tree-top',
    durationMs: [800, 800], baseP: 0.60, kSkill: 2.1,
    skills: { attacker: ['wr.finish'], defender: ['wr.sprawl'] },
    physicalMods: [ph('EXP+')], stateMods: [st('FAT-')],
    counters: ['limp leg', 'hip down'],
    tag: '[S: WRESTLING §3.2], landing [S: WRESTLING §9 r15]',
  }),
  edge({
    id: 'tech.single_outside', name: 'Outside single (capture)', group: 'B', kind: 'capture',
    from: ['pos.standing_mid', 'pos.clinch_overhook_control'],
    to: [d('pos.td_single_leg_in', 1)], toOnFailure: CAPTURE_FAIL,
    requirements: "defender's lead leg forward; head outside",
    durationMs: [500, 500], baseP: 0.50, kSkill: 2.1,
    skills: { attacker: ['wr.shot'], defender: ['wr.sprawl'] },
    physicalMods: [ph('EXP+')], stateMods: [st('SETUP'), st('CAGE', 0.42)],
    counters: ['whizzer (P 0.60 if wr.sprawl >= 40)'],
    tag: '[S: WRESTLING §3.2] [S: WRESTLING §9 r11]', guillotineTax: true,
  }),
  edge({
    id: 'tech.double_leg', name: 'Double leg (capture)', group: 'B', kind: 'capture',
    from: ['pos.standing_mid', 'pos.standing_close'],
    to: [d('pos.td_double_leg_in', 1)], toOnFailure: CAPTURE_FAIL,
    requirements: 'penetration step, hands behind the knees, head outside',
    // 0.62 capture x 0.70 drive-through = 0.43 full TD [D: WRESTLING §3.3 43-50 %].
    durationMs: [450, 450], baseP: 0.62, kSkill: 2.1,
    skills: { attacker: ['wr.shot'], defender: ['wr.sprawl'] },
    physicalMods: [ph('STR+'), ph('MASS+'), ph('EXP+')],
    stateMods: [st('SETUP'), st('TELE'), st('CAGE', 0.63), st('FAT-'), st('RCK'), st('LEGDMG')],
    counters: ['sprawl', 'knee or uppercut on the entry', 'underhooks + hip heist', 'guillotine'],
    tag: '[S: WRESTLING §3.3]', guillotineTax: true,
    note: 'Open-mat shots from > 1.2 m: base x 0.85 [S: WRESTLING §9 r7]; extra -0.85 above fatigue 0.7.',
  }),
  edge({
    id: 'tech.double_drive_through', name: 'Drive through', group: 'B', kind: 'finish',
    from: ['pos.td_double_leg_in'],
    to: [d('pos.ground_open_kneeling_top', 0.60), d('pos.ground_half_flat', 0.30), d('pos.ground_side', 0.10)],
    toOnFailure: [d('pos.td_sprawl', 1, true)],
    requirements: 'head up, hips under, feet driving',
    durationMs: [500, 1000], baseP: 0.70, kSkill: 2.1,
    skills: { attacker: ['wr.finish'], defender: ['wr.sprawl'] },
    // The largest mass effect of any edge in the catalogue.
    physicalMods: [ph('STR+'), ph('MASS++')],
    stateMods: [st('CAGE', 0.42), st('FAT-')],
    counters: ['sprawl', 'underhooks', 'wide base'],
    tag: '[S: WRESTLING §3.3]',
    note: '0.40 instead of 0.70 when the defender is already half-sprawled.',
  }),
  edge({
    id: 'tech.double_lift_slam', name: 'Lift and slam', group: 'B', kind: 'finish',
    from: ['pos.td_double_leg_in'],
    to: [d('pos.ground_side', 0.55), d('pos.ground_half_flat', 0.45)],
    requirements: 'hips under; strength >= the defender',
    durationMs: [1000, 1500], baseP: 0.60, kSkill: 2.1,
    skills: { attacker: ['wr.finish'], defender: ['wr.sprawl'] },
    physicalMods: [ph('STR++'), ph('MASS++')], stateMods: [st('FAT--')],
    counters: ['grab the cage (foul)', 'guillotine', 'sit the hips down'],
    tag: '[S: WRESTLING §3.3]', slamScale: 1.0,
    note: 'Passes through pos.td_lifted; chapter 05 gets a 3-8 % KO-class slam event.',
  }),
  edge({
    id: 'tech.double_turn_corner', name: 'Turn the corner', group: 'B', kind: 'finish',
    from: ['pos.td_double_leg_in'],
    to: [d('pos.ground_open_kneeling_top', 0.5), d('pos.ground_half_flat', 0.5)],
    toOnFailure: [d('pos.td_sprawl', 1, true)],
    requirements: 'head drives across, feet circle 90 degrees',
    durationMs: [1000, 1000], baseP: 0.50, kSkill: 2.1,
    skills: { attacker: ['wr.finish'], defender: ['wr.sprawl'] },
    stateMods: [st('FAT-'), st('CAGE', -0.42)],
    counters: ['square back up', 'crossface'],
    tag: '[S: WRESTLING §3.3]; cage -0.42 is [E]',
  }),
  edge({
    id: 'tech.double_cut_corner', name: 'Cut the corner', group: 'B', kind: 'finish',
    from: ['pos.td_double_leg_in'],
    to: [d('pos.ground_side', 1)],
    requirements: 'lateral step, 45-degree drive',
    durationMs: [1000, 1000], baseP: 0.55, kSkill: 2.1,
    skills: { attacker: ['wr.finish'], defender: ['wr.sprawl'] },
    physicalMods: [ph('STR+')],
    counters: ['re-square'],
    tag: '[S: WRESTLING §3.3]',
  }),
  edge({
    id: 'tech.double_to_high_crotch', name: 'Double to high crotch', group: 'B', kind: 'chain',
    from: ['pos.td_double_leg_in'],
    to: [d('pos.td_high_crotch_in', 1)],
    toOnFailure: [d('pos.td_sprawl', 1, true)],
    requirements: 'the inside arm switches to the crotch (far leg hidden by the sprawl)',
    durationMs: [500, 500], baseP: 0.55, kSkill: 2.1,
    skills: { attacker: ['wr.finish'], defender: ['wr.sprawl'] },
    stateMods: [st('CHAIN')],
    counters: ['limp leg', 'whizzer'],
    tag: '[S: WRESTLING §3.3]',
  }),
  edge({
    id: 'tech.knee_tap_double', name: 'Knee tap from the tie', group: 'B', kind: 'finish',
    from: ['pos.clinch_underhook', 'pos.clinch_collar_tie', 'pos.clinch_body_lock_front'],
    to: [d('pos.ground_open_kneeling_top', 0.5), d('pos.ground_half_flat', 0.3), d('pos.ground_side', 0.2)],
    requirements: "defender's weight forward",
    durationMs: [700, 700], baseP: 0.45, kSkill: 2.1,
    skills: { attacker: ['wr.finish', 'jd.foot_sweep'], defender: ['wr.sprawl'] },
    physicalMods: [ph('STR+')],
    // JUDO §8 r13 puts ko-uchi / knee-tap at x1.5 P on the fence.
    stateMods: [st('CAGE', 0.42)],
    counters: ['post on the head', 'hips back', 'whizzer'],
    tag: '[S: WRESTLING §3.3] [S: JUDO §3 ko uchi]',
  }),
  edge({
    id: 'tech.high_crotch', name: 'High crotch (capture)', group: 'B', kind: 'capture',
    from: ['pos.clinch_underhook', 'pos.clinch_collar_tie', 'pos.standing_close'],
    to: [d('pos.td_high_crotch_in', 1)],
    toOnFailure: [d('pos.standing_close', 0.5), d('pos.td_sprawl', 0.5, true)],
    requirements: 'underhook-side leg is the target; head inside on the chest',
    // 0.55 from the underhook tie, 0.45 from neutral.
    durationMs: [500, 500], baseP: 0.55, kSkill: 2.1,
    skills: { attacker: ['wr.shot'], defender: ['wr.sprawl'] },
    physicalMods: [ph('EXP+')], stateMods: [st('SETUP'), st('CAGE', 0.42)],
    counters: ['hips back', 'cross-wrist control (the whizzer is weak here)'],
    tag: '[S: WRESTLING §3.4]', guillotineTax: true,
  }),
  edge({
    id: 'tech.hc_to_double', name: 'High crotch to double', group: 'B', kind: 'finish',
    from: ['pos.td_high_crotch_in'],
    to: [d('pos.ground_open_kneeling_top', 0.5), d('pos.ground_side', 0.5)],
    requirements: 'the second hand reaches the far leg',
    durationMs: [700, 700], baseP: 0.60, kSkill: 2.1,
    skills: { attacker: ['wr.finish'], defender: ['wr.sprawl'] },
    physicalMods: [ph('STR+'), ph('MASS+')], stateMods: [st('CHAIN')],
    counters: ['limp leg', 'hip away'],
    tag: '[S: WRESTLING §3.4]',
  }),
  edge({
    id: 'tech.hc_lift_dump', name: 'High crotch lift', group: 'B', kind: 'finish',
    from: ['pos.td_high_crotch_in'],
    to: [d('pos.ground_side', 1)],
    requirements: 'hips under',
    durationMs: [1000, 1000], baseP: 0.55, kSkill: 2.1,
    skills: { attacker: ['wr.finish'], defender: ['wr.sprawl'] },
    physicalMods: [ph('STR++')], stateMods: [st('FAT-')],
    counters: ['sit down', 'whizzer', 'cage post'],
    tag: '[S: WRESTLING §3.4]', slamScale: 1.0,
    note: 'Passes through pos.td_lifted.',
  }),
  edge({
    id: 'tech.hc_cage_drive_single', name: 'Drive the high crotch to the cage', group: 'B', kind: 'chain',
    from: ['pos.td_high_crotch_in'],
    to: [d('pos.td_single_leg_in', 1)],
    requirements: { text: 'the fence within 2 m', cage: 'required' },
    durationMs: [1000, 1000], baseP: 0.65, kSkill: 2.0,
    skills: { attacker: ['mma.cage'], defender: ['mma.cage'] },
    physicalMods: [ph('MASS+')], stateMods: [st('CHAIN')],
    counters: ['hip in'],
    tag: '[S: WRESTLING §3.4]',
  }),
  edge({
    id: 'tech.ankle_pick', name: 'Ankle pick', group: 'B', kind: 'entry',
    from: ['pos.clinch_collar_tie', 'pos.clinch_front_headlock'],
    to: [d('pos.ground_open_kneeling_top', 0.60), d('pos.scramble', 0.35), d('pos.ground_side', 0.05)],
    requirements: "collar tie pulling the head down; defender's weight on the lead leg",
    durationMs: [500, 500], baseP: 0.40, kSkill: 2.1,
    skills: { attacker: ['wr.shot', 'jd.foot_sweep'], defender: ['wr.sprawl'] },
    physicalMods: [ph('RCH+')], stateMods: [st('SETUP')],
    counters: ['posture up', 'step the lead leg back', 'sprawl on the reaching arm'],
    tag: '[S: WRESTLING §3.6], landing [S: WRESTLING §9 r15]',
  }),
  edge({
    id: 'tech.re_shot', name: 'Re-shot', group: 'B', kind: 'chain',
    from: ['pos.td_sprawl'], actor: 'b',
    to: [d('pos.td_single_leg_in', 0.6, true), d('pos.td_high_crotch_in', 0.4, true)],
    toOnFailure: [d('pos.clinch_front_headlock', 0.40), d('pos.standing_close', 0.60)],
    requirements: "knee under; defender's hands still on the head",
    // First shot -0.42 [D: -10 pp]; +0.42 back if the defender is bent over.
    durationMs: [500, 500], baseP: 0.35, kSkill: 2.1,
    skills: { attacker: ['wr.shot'], defender: ['wr.sprawl'] },
    stateMods: [st('CHAIN'), st('FAT--')],
    counters: ['keep the hips back', 'snap', 'circle'],
    tag: '[S: WRESTLING §3.7]',
  }),
  edge({
    id: 'def.sprawl', name: 'Sprawl', group: 'B', kind: 'defence', actor: 'b',
    from: ['pos.standing_mid', 'pos.standing_close', 'pos.standing_cage'],
    to: [d('pos.td_sprawl', 1, true)],
    toOnFailure: [d('same', 1)],
    requirements: {
      text: 'fires only within 450 ms (+100 ms if the shot was telegraphed); hips back within 300 ms',
      minReactionTime: 0,
    },
    // Tier table T0 0.20, T2 0.50, T3 0.70, T4 0.85: 0.55 vs a double, 0.45 vs
    // a single, i.e. 1 - the capture base.
    durationMs: [300, 300], baseP: 0.55, kSkill: 2.1,
    skills: { attacker: ['wr.sprawl'], defender: ['wr.shot'] },
    physicalMods: [ph('MASS+')],
    stateMods: [st('FAT-'), st('CAGE', -0.42)],
    counters: ['re-shoot', 'drag the hands', 'high crotch off the sprawl'],
    tag: '[S: WRESTLING §3.2, §3.3] [S: WRESTLING §9 r10]',
  }),
  edge({
    id: 'def.whizzer', name: 'Whizzer', group: 'B', kind: 'defence', actor: 'b',
    from: ['pos.td_single_leg_in'],
    to: [d('pos.clinch_overhook_control', 1, true)],
    toOnFailure: [d('same', 1)],
    requirements: "free arm over the near arm; attacker's head outside",
    // Applied with P 0.60 when wr.sprawl >= 40; it then puts -0.85 logit on
    // run-the-pipe and dump.
    durationMs: [0, 0], baseP: 0.60, kSkill: 2.1,
    skills: { attacker: ['wr.sprawl'], defender: ['wr.finish'] },
    physicalMods: [ph('STR+'), ph('HGT+')],
    counters: ['limp arm', 'switch to a double', 'drive to the cage'],
    tag: '[S: WRESTLING §3.2] [S: WRESTLING §4 chain 8]',
  }),
  edge({
    id: 'tech.whizzer_throw', name: 'Whizzer throw', group: 'B', kind: 'throw',
    from: ['pos.clinch_overhook_control'],
    to: [d('pos.ground_side', 1)],
    toOnFailure: [d('pos.td_single_leg_in', 1, true)],
    requirements: 'deep whizzer + hip pressure',
    durationMs: [800, 800], baseP: 0.15, kSkill: 2.1,
    skills: { attacker: ['jd.throw_fwd', 'wr.sprawl'], defender: ['wr.finish'] },
    physicalMods: [ph('STR++')],
    counters: ['limp arm', 'drive the head across'],
    tag: '[S: WRESTLING §3.2]', slamScale: 0.5,
  }),
  edge({
    id: 'def.limp_leg', name: 'Limp leg', group: 'B', kind: 'escape', actor: 'b',
    from: ['pos.td_single_leg_in'],
    to: [d('pos.standing_close', 1)],
    requirements: "leg below the attacker's hip or a loose grip",
    // 0.60 against a T0-T1 grip.
    durationMs: [500, 500], baseP: 0.35, kSkill: 2.1,
    skills: { attacker: ['wr.sprawl'], defender: ['wr.finish'] },
    physicalMods: [ph('FLX+')], stateMods: [st('FATd+')],
    counters: ['clamp the leg to the chest', 'lift'],
    tag: '[S: WRESTLING §3.2]',
  }),
  edge({
    id: 'def.crossface_hip_pressure', name: 'Crossface and hip pressure', group: 'B', kind: 'defence', actor: 'b',
    from: ['pos.td_single_leg_in', 'pos.td_double_leg_in'],
    to: [d('pos.td_sprawl', 0.7, true), d('pos.clinch_front_headlock', 0.3, true)],
    requirements: 'free arm across the face',
    // +0.42 to the sprawl [D: +10 pp]; 0.30 converts a capture into a front headlock.
    durationMs: [500, 500], baseP: 0.30, kSkill: 2.1,
    skills: { attacker: ['wr.sprawl'], defender: ['wr.finish'] },
    physicalMods: [ph('STR+')],
    counters: ['keep the head tight to the hip'],
    tag: '[S: WRESTLING §3.2]',
  }),
  edge({
    id: 'def.underhooks_hip_heist', name: 'Underhooks and hip heist', group: 'B', kind: 'escape', actor: 'b',
    from: ['pos.td_double_leg_in'],
    to: [d('pos.clinch_underhook', 0.6, true), d('pos.standing_close', 0.4)],
    requirements: 'one or both underhooks as the attacker drives',
    durationMs: [500, 1000], baseP: 0.35, kSkill: 2.1,
    skills: { attacker: ['wr.sprawl'], defender: ['wr.finish'] },
    physicalMods: [ph('STR+')],
    counters: ['lift', 'switch to a single'],
    tag: '[S: WRESTLING §3.3]',
  }),
  edge({
    id: 'def.cage_hip_in_double', name: 'Hip in against the cage (vs the double)', group: 'B', kind: 'defence', actor: 'b',
    from: ['pos.td_double_leg_in'],
    to: [d('pos.clinch_cage_pin_front', 0.70), d('pos.standing_cage', 0.30)],
    toOnFailure: [d('pos.ground_open_kneeling_top', 1)],
    requirements: {
      text: 'back flat on the fence, hips forward, underhook and head post',
      cage: 'required',
    },
    durationMs: [0, 0], baseP: 0.45, kSkill: 2.0,
    skills: { attacker: ['mma.cage'], defender: ['mma.cage'] },
    physicalMods: [ph('STR+')],
    counters: ['switch to a single / trip / knee tap', 'foot stomps'],
    tag: '[S: WRESTLING §3.3]',
  }),
  edge({
    id: 'def.cage_post_single', name: 'Post against the cage (vs the single)', group: 'B', kind: 'defence', actor: 'b',
    from: ['pos.td_single_leg_in'],
    to: [d('same', 1)],
    requirements: {
      text: "back on the fence, hips forward, hand on the attacker's head",
      cage: 'required',
    },
    // Halves run-the-pipe P; tree-top and trips are unaffected.
    durationMs: [0, 0], baseP: 0.50, kSkill: 2.0,
    skills: { attacker: ['mma.cage'], defender: ['wr.finish'] },
    counters: ['switch finish (trip, dump)', 'foot sweep', 'knee to the posted thigh'],
    tag: '[S: WRESTLING §3.2]',
  }),
];

// ---------------------------------------------------------------------------
// §2.3 C — Clinch transitions, snaps, drags, body locks, trips, mat returns (25)
// ---------------------------------------------------------------------------

const EDGES_C: readonly GrapplingEdge[] = [
  edge({
    id: 'tech.pummel', name: 'Pummel', group: 'C', kind: 'clinch',
    from: ['pos.clinch_over_under', 'pos.clinch_collar_tie', 'pos.clinch_hand_fight',
      'pos.clinch_cage_pin_front'],
    to: [d('pos.clinch_underhook', 0.45), d('pos.clinch_double_under', 0.25),
      d('pos.clinch_body_lock_front', 0.15), d('same', 0.15)],
    toOnFailure: [d('pos.clinch_underhook', 0.45, true), d('pos.clinch_double_under', 0.25, true),
      d('pos.clinch_body_lock_front', 0.15, true), d('same', 0.15, true)],
    requirements: 'not fully locked; one exchange per grap.pummelIntervalMs',
    durationMs: [3000, 3000], baseP: 0.50, kSkill: 1.6,
    skills: { attacker: ['wr.pummel'], defender: ['wr.pummel'] },
    // [D: WRESTLING §5.3 0.003 P/pt of strength => 0.12 per 10 pts].
    physicalMods: [ph('STR+', 0.12)],
    stateMods: [st('FAT-', 0.63), st('GRECO')],
    counters: ['hip in', 'frames', 'elbows', 're-pummel'],
    tag: '[S: WRESTLING §5.3]',
    note: 'Thai swim: 0.45 per 400 ms beat, 0.65 T4 vs T2 [S: MUAY_THAI §4.3].',
  }),
  edge({
    id: 'tech.establish_body_lock', name: 'Establish the body lock', group: 'C', kind: 'clinch',
    from: ['pos.clinch_underhook', 'pos.clinch_double_under', 'pos.clinch_cage_pin_front'],
    to: [d('pos.clinch_body_lock_front', 1)],
    requirements: 'hands locked (S-grip or gable)',
    durationMs: [500, 1500], baseP: 0.50, kSkill: 2.1,
    skills: { attacker: ['wr.pummel'], defender: ['wr.pummel'] },
    physicalMods: [ph('STR+')], stateMods: [st('GRECO')],
    counters: ['hip in', 'frames', 'elbows', 're-pummel'],
    tag: '[S: WRESTLING §3.5]',
  }),
  edge({
    id: 'tech.snap_down', name: 'Snap down', group: 'C', kind: 'clinch',
    from: ['pos.clinch_collar_tie', 'pos.clinch_thai_plum', 'pos.clinch_underhook', 'pos.standing_close'],
    to: [d('pos.clinch_front_headlock', 0.7), d('pos.ground_turtle', 0.3)],
    toOnFailure: [d('pos.clinch_collar_tie', 1)],
    requirements: 'head control and the defender leaning forward',
    // 0.60 against a T0-T1 who bends at the waist.
    durationMs: [500, 1000], baseP: 0.35, kSkill: 2.1,
    skills: { attacker: ['wr.pummel'], defender: ['wr.pummel'] },
    physicalMods: [ph('STR+')], stateMods: [st('FATd+')],
    counters: ['posture up', 'post on the hip', 'duck under'],
    tag: '[S: WRESTLING §3.1]',
    note: 'Defender bent posture +1.1 logit [D: +25 pp]; from the plum a success opens a +0.20 P knee window for 1 s.',
  }),
  edge({
    id: 'tech.arm_drag', name: 'Arm drag', group: 'C', kind: 'clinch',
    from: ['pos.standing_close', 'pos.clinch_collar_tie', 'pos.clinch_hand_fight', 'pos.clinch_two_on_one'],
    to: [d('pos.clinch_body_lock_rear', 0.25), d('pos.td_single_leg_in', 0.45), d('pos.clinch_underhook', 0.30)],
    toOnFailure: [d('pos.standing_close', 1)],
    requirements: 'wrist or tricep grip',
    durationMs: [500, 500], baseP: 0.42, kSkill: 2.1,
    skills: { attacker: ['wr.pummel'], defender: ['wr.pummel'] },
    physicalMods: [ph('SPD+')], stateMods: [st('WET')],
    counters: ['square up', 're-drag', 'back-step'],
    tag: '[S: WRESTLING §3.1] (38-45 %)',
  }),
  edge({
    id: 'tech.duck_under', name: 'Duck under', group: 'C', kind: 'clinch',
    from: ['pos.clinch_collar_tie', 'pos.clinch_underhook'],
    to: [d('pos.clinch_body_lock_rear', 1)],
    toOnFailure: [d('pos.clinch_collar_tie', 1)],
    requirements: "defender's elbow high or the tie loose",
    durationMs: [400, 400], baseP: 0.30, kSkill: 2.1,
    skills: { attacker: ['wr.pummel'], defender: ['wr.pummel'] },
    // A shorter attacker ducks more easily: +0.21 logit [D: +5 pp].
    physicalMods: [ph('HGT-')],
    counters: ['elbow tight', 'hip away', 'guillotine on the ducking head (0.10 [E])'],
    tag: '[S: WRESTLING §3.1] [S: MMA_INTEGRATION I-13]',
  }),
  edge({
    id: 'tech.slide_by', name: 'Slide by', group: 'C', kind: 'clinch',
    from: ['pos.clinch_underhook'],
    to: [d('pos.clinch_body_lock_rear', 1)],
    toOnFailure: [d('pos.clinch_underhook', 1)],
    requirements: "underhook and the defender's weight forward",
    durationMs: [500, 500], baseP: 0.25, kSkill: 2.1,
    skills: { attacker: ['wr.pummel'], defender: ['wr.pummel'] },
    counters: ['hip in', 're-pummel'],
    tag: '[S: WRESTLING §3.1]',
  }),
  edge({
    id: 'tech.two_on_one_back_take', name: 'Two-on-one back take', group: 'C', kind: 'clinch',
    from: ['pos.clinch_two_on_one'],
    to: [d('pos.clinch_body_lock_rear', 0.6), d('pos.td_single_leg_in', 0.4)],
    toOnFailure: [d('pos.clinch_hand_fight', 1)],
    requirements: "both hands on the arm, defender's elbow away from the ribs",
    durationMs: [500, 500], baseP: 0.35, kSkill: 2.1,
    skills: { attacker: ['wr.pummel'], defender: ['wr.pummel'] },
    stateMods: [st('WET')],
    counters: ['pull the arm back', 'square the hips'],
    tag: '[S: JUDO §2.2 N8]; value [E]',
  }),
  edge({
    id: 'tech.inside_trip', name: 'Inside trip (o uchi from the lock)', group: 'C', kind: 'throw',
    from: ['pos.clinch_body_lock_front', 'pos.clinch_double_under', 'pos.clinch_cage_pin_front',
      'pos.clinch_underhook'],
    to: [d('pos.ground_open_kneeling_top', 0.55), d('pos.ground_half_flat', 0.40), d('pos.ground_side', 0.05)],
    requirements: "the attacker's leg hooks inside the near leg",
    durationMs: [700, 700], baseP: 0.50, kSkill: 2.1,
    skills: { attacker: ['wr.finish', 'jd.throw_rear'], defender: ['wr.sprawl', 'jd.throw_def'] },
    // Coefficients doubled relative to the body lock itself.
    physicalMods: [ph('STR++'), ph('MASS++')],
    stateMods: [st('CAGE', 0.42), st('GRECO')],
    counters: ['base', 'hip in', 'wrestle up'],
    tag: '[S: WRESTLING §3.5] [S: WRESTLING §9 r13] [S: JUDO §8 r13]',
    judoFailure: true, judoCommitment: 1.0, slamScale: 0.2,
  }),
  edge({
    id: 'tech.outside_trip', name: 'Outside trip (o soto from the lock)', group: 'C', kind: 'throw',
    from: ['pos.clinch_body_lock_front', 'pos.clinch_underhook', 'pos.clinch_head_and_arm'],
    to: [d('pos.ground_side', 0.45), d('pos.ground_half_flat', 0.40), d('pos.ground_open_kneeling_top', 0.15)],
    requirements: "the defender's weight on the reaped leg",
    durationMs: [700, 700], baseP: 0.48, kSkill: 2.1,
    skills: { attacker: ['wr.finish', 'jd.throw_rear'], defender: ['jd.throw_def'] },
    physicalMods: [ph('STR++'), ph('MASS++'), ph('HGT+')],
    stateMods: [st('CAGE', 0.42), st('GRECO')],
    counters: ['step over or through', 'whizzer', 'o soto gaeshi'],
    tag: '[S: WRESTLING §3.5] (45-53 %)',
    judoFailure: true, judoCommitment: 1.5, slamScale: 0.2,
  }),
  edge({
    id: 'tech.body_lock_lift_return', name: 'Body-lock lift', group: 'C', kind: 'finish',
    from: ['pos.clinch_body_lock_front'],
    to: [d('pos.ground_side', 0.45), d('pos.ground_half_flat', 0.40), d('pos.ground_open_kneeling_top', 0.15)],
    requirements: 'hips under; strength >= the defender',
    durationMs: [1000, 1500], baseP: 0.55, kSkill: 2.1,
    skills: { attacker: ['wr.finish'], defender: ['wr.sprawl'] },
    physicalMods: [ph('STR++'), ph('MASS++')],
    // Lifts are x1.25 P on the fence [S: JUDO §8 r13].
    stateMods: [st('FAT--'), st('CAGE', 0.42)],
    counters: ['sprawl the hips', 'cage grab (foul)', 'guillotine', 'sit the hips down'],
    tag: '[S: WRESTLING §3.5] (50-60 %)', slamScale: 1.0,
  }),
  edge({
    id: 'tech.rear_mat_return', name: 'Rear mat return', group: 'C', kind: 'finish',
    from: ['pos.clinch_body_lock_rear', 'pos.clinch_cage_pin_rear'],
    to: [d('pos.ground_turtle', 0.55), d('pos.ground_back_hooks', 0.30), d('pos.ground_side', 0.15)],
    requirements: 'hips behind, knee behind knee',
    // 0.70 on the cage with knee-behind-knee.
    durationMs: [1000, 2000], baseP: 0.55, kSkill: 2.1,
    skills: { attacker: ['wr.mat_return'], defender: ['wr.get_up'] },
    physicalMods: [ph('STR+'), ph('MASS+')], stateMods: [st('CAGE', 0.42)],
    counters: ['wrist control and turn in', 'wide base', 'hand-fight the lock', 'cage foot post'],
    tag: '[S: WRESTLING §3.5] [S: BJJ_POSITIONS §3.2 T13]',
  }),
  edge({
    id: 'tech.rear_lift_suplex', name: 'Rear lift / suplex', group: 'C', kind: 'throw',
    from: ['pos.clinch_body_lock_rear'],
    to: [d('pos.ground_side', 0.55), d('pos.ground_north_south', 0.15), d('pos.scramble', 0.30)],
    requirements: 'high strength',
    durationMs: [1000, 1000], baseP: 0.35, kSkill: 2.1,
    skills: { attacker: ['wr.mat_return', 'jd.throw_rear'], defender: ['wr.get_up'] },
    physicalMods: [ph('STR++'), ph('MASS++')],
    stateMods: [st('GRECO', 0.63), st('CAGE', 0.22)],
    counters: ['base', 'hook a leg', 'spin in'],
    tag: '[S: WRESTLING §3.5] [S: JUDO §3 ura nage, §5.3]', slamScale: 0.8,
    note: 'Salto risk: grap.saltoRisk = 0.10 of successes send the attacker to pos.scramble at a disadvantage.',
  }),
  edge({
    id: 'tech.rear_trip', name: 'Rear trip', group: 'C', kind: 'throw',
    from: ['pos.clinch_body_lock_rear'],
    to: [d('pos.ground_back_hooks', 0.4), d('pos.ground_turtle', 0.35), d('pos.ground_side', 0.25)],
    requirements: "the defender's weight on the hooked leg",
    // Between the mat return (0.55) and the rear throw (0.35).
    durationMs: [800, 800], baseP: 0.45, kSkill: 2.1,
    skills: { attacker: ['wr.mat_return', 'jd.throw_rear'], defender: ['wr.get_up'] },
    physicalMods: [ph('STR+')], stateMods: [st('CAGE', 0.42)],
    counters: ['step over', 'base wide'],
    tag: '[E]', slamScale: 0.2,
  }),
  edge({
    id: 'def.wrestle_up_rear_lock', name: 'Wrestle up out of the rear lock', group: 'C', kind: 'getup', actor: 'b',
    from: ['pos.clinch_body_lock_rear'],
    to: [d('pos.standing_close', 0.5), d('pos.clinch_underhook', 0.5, true)],
    requirements: 'wrist control on the lock, hips forward, elbows down; rolled per 3 s window',
    durationMs: [1000, 2000], baseP: 0.30, kSkill: 2.1,
    skills: { attacker: ['wr.get_up'], defender: ['wr.mat_return'] },
    physicalMods: [ph('STR+')], stateMods: [st('FAT-')],
    counters: ['re-lock', 'knee behind knee', 'trips'],
    tag: '[S: WRESTLING §3.5]',
  }),
  edge({
    id: 'tech.front_headlock_go_behind', name: 'Go behind from the front headlock', group: 'C', kind: 'advance',
    from: ['pos.clinch_front_headlock', 'pos.td_sprawl'],
    to: [d('pos.ground_turtle', 0.60), d('pos.ground_back_seatbelt', 0.40)],
    requirements: "the defender's hands on the mat or posture broken",
    // 0.70 against a bent-over T0-T1.
    durationMs: [700, 700], baseP: 0.45, kSkill: 2.1,
    skills: { attacker: ['wr.pummel'], defender: ['wr.scramble'] },
    physicalMods: [ph('STR+')], stateMods: [st('FATd+')],
    counters: ['posture up', 'peel the chin strap', 'sit-out'],
    tag: '[S: WRESTLING §3.6] [S: WRESTLING §9 r12]',
    note: 'After grap.frontHeadlockDecayMs = 4 s of no progress the tie decays: standing 0.60 / collar tie 0.40.',
  }),
  edge({
    id: 'tech.front_headlock_sub_entry', name: 'Front-headlock submission entry', group: 'C', kind: 'subEntry',
    from: ['pos.clinch_front_headlock', 'pos.ground_front_headlock'],
    to: [subEntry('sub.guillotine_high_elbow', 0.30), subEntry('sub.guillotine_arm_in', 0.20),
      subEntry('sub.darce', 0.20), subEntry('sub.anaconda', 0.20),
      subEntry('sub.peruvian_necktie', 0.10)],
    toOnFailure: [d('same', 0.70), d('pos.standing_close', 0.30)],
    requirements: 'chin strap or the arm in',
    // Guillotine entry 0.25, anaconda/darce 0.20 (needs the arm inside); §04
    // owns every stage after the entry.
    durationMs: [500, 1000], baseP: 0.25, kSkill: 0,
    physicalMods: [ph('RCH+')],
    counters: ['head out', 'hips in', 'drive', 'hand fight'],
    tag: '[S: WRESTLING §3.6]',
  }),
  edge({
    id: 'tech.sprawl_to_front_headlock', name: 'Sprawl to front headlock', group: 'C', kind: 'advance',
    from: ['pos.td_sprawl'],
    to: [d('pos.clinch_front_headlock', 0.5), d('pos.ground_front_headlock', 0.5)],
    toOnFailure: [d('pos.standing_close', 1)],
    requirements: "chest on the shooter's head or shoulder",
    durationMs: [500, 500], baseP: 0.60, kSkill: 2.1,
    skills: { attacker: ['wr.sprawl'], defender: ['wr.shot'] },
    counters: ['post and stand', 're-shoot'],
    tag: '[S: WRESTLING §3.7]',
  }),
  edge({
    id: 'tech.sprawl_spin_behind', name: 'Spin behind off the sprawl', group: 'C', kind: 'advance',
    from: ['pos.td_sprawl'],
    to: [d('pos.ground_turtle', 0.6), d('pos.ground_back_seatbelt', 0.4)],
    toOnFailure: [d('pos.standing_close', 1)],
    requirements: 'the shooter stays on the knees',
    // 0.65 against a T0-T1 who stays down.
    durationMs: [1000, 1000], baseP: 0.35, kSkill: 2.1,
    skills: { attacker: ['wr.sprawl'], defender: ['wr.scramble'] },
    counters: ['sit-out', 'stand'],
    tag: '[S: WRESTLING §3.7]',
  }),
  edge({
    id: 'tech.sprawl_knees', name: 'Knees from the sprawl', group: 'C', kind: 'strike',
    from: ['pos.td_sprawl'],
    to: [d('same', 1)], toOnFailure: [d('same', 1)],
    requirements: "the shooter's head or body available; knees to the head only if the shooter is not grounded",
    durationMs: [500, 500], baseP: 0.55, kSkill: 0,
    skills: { attacker: ['mma.anti_wrestling'], defender: [] },
    counters: ['cover', 'stand'],
    tag: '[S: WRESTLING §3.7, §9 r23]',
    note: "+0.42 head-damage multiplier when the attacker's head is down [D: +0.10].",
  }),
  edge({
    id: 'tech.hip_heist_out', name: 'Hip heist out', group: 'C', kind: 'escape', actor: 'b',
    from: ['pos.td_sprawl', 'pos.ground_turtle'],
    to: [d('pos.standing_close', 0.6), d('pos.clinch_underhook', 0.4, true)],
    requirements: 'one foot posted, hips through',
    durationMs: [500, 500], baseP: 0.40, kSkill: 2.1,
    skills: { attacker: ['wr.scramble'], defender: ['wr.ride'] },
    physicalMods: [ph('SPD+')],
    counters: ['tight waist', 'ankle'],
    tag: '[S: WRESTLING §3.9]',
  }),
  edge({
    id: 'tech.clinch_break', name: 'Break the clinch', group: 'C', kind: 'clinch',
    from: OPEN_MAT_CLINCH_IDS,
    to: [d('pos.standing_close', 1)],
    requirements: { text: 'hip distance or posting; open mat only', cage: 'forbidden' },
    durationMs: [500, 500], baseP: 0.60, kSkill: 2.0,
    skills: { attacker: ['wr.pummel'], defender: ['wr.pummel'] },
    physicalMods: [ph('STR+')],
    counters: ['hitting on the break'],
    tag: '[S: MUAY_THAI §4.3] (post and exit)',
  }),
  edge({
    id: 'tech.thai_turn', name: 'Turn in the plum', group: 'C', kind: 'clinch',
    from: ['pos.clinch_thai_plum', 'pos.clinch_collar_tie'],
    to: [d('same', 1)],
    requirements: 'frame or inside position',
    durationMs: [500, 500], baseP: 0.40, kSkill: 2.0,
    skills: { attacker: ['mma.clinch_strike', 'jd.grip'], defender: ['mma.clinch_strike', 'jd.grip'] },
    physicalMods: [ph('STR+')],
    counters: ['base', 'swim'],
    tag: '[S: MUAY_THAI §4.3]',
    note: 'Opponent balance -2 and lateral kuzushi mag +1; sets up tech.thai_dump.',
  }),
  edge({
    id: 'tech.thai_dump', name: 'Thai dump', group: 'C', kind: 'throw',
    from: ['pos.clinch_thai_plum'],
    to: [d('pos.ground_open_legs_up', 0.7), d('pos.ground_side', 0.3)],
    requirements: 'a successful turn, or the opponent posting on one leg',
    // 0.50 for clinch specialists (mma.clinch_strike >= 80) [E].
    durationMs: [600, 600], baseP: 0.30, kSkill: 2.1,
    skills: { attacker: ['jd.foot_sweep', 'wr.finish'], defender: ['jd.throw_def'] },
    physicalMods: [ph('STR+')],
    counters: ['base', 'hip in'],
    tag: '[S: MUAY_THAI §4.3]', slamScale: 0.2,
  }),
  edge({
    id: 'tech.plum_knee', name: 'Knee from the plum', group: 'C', kind: 'strike',
    from: ['pos.clinch_thai_plum'],
    to: [d('same', 1)], toOnFailure: [d('same', 1)],
    requirements: 'the plum held; land rate follows the dominance index (§02 clinch model)',
    // 0.55 dominant / 0.30 neutral / 0.15 defensive.
    durationMs: [400, 400], baseP: 0.55, kSkill: 0,
    skills: { attacker: ['mma.clinch_strike'], defender: [] },
    counters: ['knee shield', 'hip in (0.50)'],
    tag: '[S: MUAY_THAI §4.3]',
  }),
  edge({
    id: 'tech.plum_swim_escape', name: 'Swim out of the plum', group: 'C', kind: 'escape', actor: 'b',
    from: ['pos.clinch_thai_plum'],
    to: [d('pos.clinch_over_under', 0.6), d('pos.clinch_collar_tie', 0.4, true)],
    requirements: 'the plum not fully locked; one roll per 400 ms beat',
    durationMs: [400, 400], baseP: 0.45, kSkill: 2.0,
    skills: { attacker: ['wr.pummel'], defender: ['wr.pummel'] },
    physicalMods: [ph('STR+')],
    counters: ['cross-face', 're-pinch the elbows'],
    tag: '[S: MUAY_THAI §4.3]',
  }),
];

// ---------------------------------------------------------------------------
// §2.3 D — Judo throws (no-gi / MMA form) and counter-throws (25 ids, 23 rows;
// the mirror-counter row bundles osoto / harai / ouchi gaeshi, split here
// because their conditional bases differ: 0.35 / 0.30 / 0.25).
//
// Grip gate: a throw is available only from tie-ups supplying BOTH a pull
// handle and a lift/steer handle. Single-handle nodes expose only de ashi,
// sasae, ko uchi, o uchi and snap-downs. KUZ applies to every row, and every
// failure rolls the §2.3 D failure table.
//
// Kuzushi directions are the 8-way compass of §2.1.1: 0 front, 1 front-corner,
// 2 lateral, 3 back-corner, 4 back.
// ---------------------------------------------------------------------------

const EDGES_D: readonly GrapplingEdge[] = [
  edge({
    id: 'tech.uchi_mata', name: 'Uchi mata', group: 'D', kind: 'throw',
    from: ['pos.clinch_underhook', 'pos.clinch_head_and_arm', 'pos.clinch_over_under'],
    to: [d('pos.ground_side', 0.60), d('pos.ground_side_kesa', 0.25),
      d('pos.ground_open_legs_up', 0.10), d('pos.ground_turtle', 0.05)],
    requirements: {
      text: 'front-corner kuzushi; hip under, near leg loaded; ken-ken hops add 500 ms each',
      grips: 'pullAndLift', kuzushiDir: 1,
    },
    durationMs: [900, 1400], baseP: 0.25, kSkill: 2.4,
    skills: { attacker: ['jd.throw_fwd'], defender: ['jd.throw_def'] },
    physicalMods: [ph('STR+'), ph('FLX+'), ph('HGT+')],
    // Forward hip throws are x0.7 P on the fence.
    stateMods: [st('KUZ'), st('CAGE', -0.36)],
    counters: ['uchi mata sukashi', 'te guruma', 'limp-arm out of the underhook to the back'],
    tag: '[S: JUDO §3]', judoFailure: true, judoCommitment: 1.5, slamScale: 0.5,
  }),
  edge({
    id: 'tech.osoto_gari', name: 'O soto gari', group: 'D', kind: 'throw',
    from: ['pos.clinch_collar_tie', 'pos.clinch_over_under', 'pos.clinch_head_and_arm'],
    to: [d('pos.ground_side', 0.55), d('pos.ground_half_flat', 0.30),
      d('pos.ground_back_seatbelt', 0.10), d('pos.scramble', 0.05)],
    requirements: {
      text: 'back-corner kuzushi; chest-to-chest drive; uke square or leaning back',
      grips: 'pullAndLift', kuzushiDir: 3,
    },
    durationMs: [800, 1200], baseP: 0.30, kSkill: 2.4,
    skills: { attacker: ['jd.throw_rear'], defender: ['jd.throw_def'] },
    physicalMods: [ph('STR+'), ph('EXP+'), ph('HGT+')],
    stateMods: [st('KUZ'), st('CAGE', 0.42)],
    counters: ['o soto gaeshi', 'ura nage', 'overhook and hip in'],
    tag: '[S: JUDO §3]', judoFailure: true, judoCommitment: 1.5, slamScale: 0.5,
    note: 'The cross-body version exposes the back: position-given share 0.20 [E].',
  }),
  edge({
    id: 'tech.harai_goshi', name: 'Harai goshi', group: 'D', kind: 'throw',
    from: ['pos.clinch_overhook_control', 'pos.clinch_head_and_arm', 'pos.clinch_body_lock_front',
      'pos.clinch_over_under'],
    to: [d('pos.ground_side', 0.60), d('pos.ground_side_kesa', 0.25),
      d('pos.ground_open_legs_up', 0.10), d('pos.ground_turtle', 0.05)],
    requirements: {
      text: 'front-corner; hip across, sweeping leg across both thighs; uke close and slightly bent',
      grips: 'pullAndLift', kuzushiDir: 1,
    },
    durationMs: [900, 1300], baseP: 0.28, kSkill: 2.4,
    skills: { attacker: ['jd.throw_fwd'], defender: ['jd.throw_def'] },
    physicalMods: [ph('STR+'), ph('FLX+'), ph('BALd')],
    stateMods: [st('KUZ'), st('CAGE', -0.36)],
    counters: ['hips back and whizzer', 'tani otoshi', 'catch the sweeping leg'],
    tag: '[S: JUDO §3]', judoFailure: true, judoCommitment: 1.5, slamScale: 0.5,
  }),
  edge({
    id: 'tech.koshi_guruma', name: 'Koshi guruma', group: 'D', kind: 'throw',
    from: ['pos.clinch_head_and_arm', 'pos.clinch_overhook_control'],
    // Kesa-biased: the arm is already round the head.
    to: [d('pos.ground_side_kesa', 0.50), d('pos.ground_side', 0.35),
      d('pos.ground_open_legs_up', 0.10), d('pos.ground_turtle', 0.05)],
    requirements: {
      text: 'front-corner; head controlled and bent', grips: 'pullAndLift', kuzushiDir: 1,
    },
    durationMs: [800, 1200], baseP: 0.25, kSkill: 2.4,
    skills: { attacker: ['jd.throw_fwd'], defender: ['jd.throw_def'] },
    physicalMods: [ph('STR+'), ph('FLX+'), ph('HGT-')],
    stateMods: [st('KUZ'), st('CAGE', -0.36)],
    counters: ['o goshi (mirror)', 'tani otoshi', 'head pop-out to the back (0.35 conditional)'],
    tag: '[S: JUDO §3, §4]', judoFailure: true, judoCommitment: 1.5, slamScale: 0.5,
  }),
  edge({
    id: 'tech.o_goshi', name: 'O goshi', group: 'D', kind: 'throw',
    from: ['pos.clinch_body_lock_front', 'pos.clinch_head_and_arm', 'pos.clinch_overhook_control'],
    to: [d('pos.ground_side', 0.60), d('pos.ground_side_kesa', 0.25),
      d('pos.ground_open_legs_up', 0.10), d('pos.ground_turtle', 0.05)],
    requirements: {
      text: 'front; hips fully across and below, knees bent', grips: 'pullAndLift', kuzushiDir: 0,
    },
    durationMs: [900, 1200], baseP: 0.22, kSkill: 2.4,
    skills: { attacker: ['jd.throw_fwd'], defender: ['jd.throw_def'] },
    physicalMods: [ph('STR+'), ph('EXP+'), ph('FLX+'), ph('HGT-')],
    stateMods: [st('KUZ'), st('CAGE', -0.36)],
    counters: ['koshi guruma (mirror)', 'tani otoshi', 'step-around back take (0.30 conditional)'],
    tag: '[S: JUDO §3] (Harrison; Fedor vs Mir)', judoFailure: true, judoCommitment: 1.5, slamScale: 0.5,
  }),
  edge({
    id: 'tech.ouchi_gari', name: 'O uchi gari', group: 'D', kind: 'throw',
    from: ['pos.clinch_collar_tie', 'pos.clinch_underhook', 'pos.clinch_over_under',
      'pos.clinch_body_lock_front', 'pos.clinch_cage_pin_front'],
    to: [d('pos.ground_open_kneeling_top', 0.60), d('pos.ground_half_flat', 0.30),
      d('pos.standing_close', 0.10)],
    requirements: {
      text: 'back or back-corner; far leg weighted or uke square on the fence',
      grips: 'singleHandle', kuzushiDir: 4,
    },
    durationMs: [600, 900], baseP: 0.32, kSkill: 2.4,
    skills: { attacker: ['jd.throw_rear'], defender: ['jd.throw_def'] },
    physicalMods: [ph('STR+'), ph('HGT+')],
    // x1.5 P on the fence [D: +0.41 logit].
    stateMods: [st('KUZ'), st('CAGE', 0.41)],
    counters: ['o uchi gaeshi', 'whizzer and sprawl the hooked leg', 'sweep the post leg'],
    tag: '[S: JUDO §3]', judoFailure: true, judoCommitment: 1.0, slamScale: 0.2,
  }),
  edge({
    id: 'tech.kouchi_gari', name: 'Ko uchi gari', group: 'D', kind: 'throw',
    from: ['pos.clinch_collar_tie', 'pos.clinch_over_under', 'pos.clinch_body_lock_front',
      'pos.clinch_underhook'],
    to: [d('pos.ground_open_kneeling_top', 0.60), d('pos.ground_half_flat', 0.30),
      d('pos.standing_close', 0.10)],
    requirements: {
      text: 'back (to the reaped heel); near heel weighted', grips: 'singleHandle', kuzushiDir: 4,
    },
    durationMs: [500, 800], baseP: 0.30, kSkill: 2.4,
    skills: { attacker: ['jd.foot_sweep', 'jd.throw_rear'], defender: ['jd.throw_def'] },
    physicalMods: [ph('EXP+'), ph('BALd')],
    stateMods: [st('KUZ'), st('CAGE', 0.41)],
    counters: ['hiza guruma', 'sumi otoshi', 'step out', 'sprawl the hooked leg and snap down'],
    tag: '[S: JUDO §3]', judoFailure: true, judoCommitment: 1.0, slamScale: 0.2,
  }),
  edge({
    id: 'tech.tai_otoshi', name: 'Tai otoshi', group: 'D', kind: 'throw',
    from: ['pos.clinch_collar_tie', 'pos.clinch_overhook_control', 'pos.clinch_head_and_arm'],
    to: [d('pos.ground_open_legs_up', 0.50), d('pos.ground_side', 0.40), d('pos.scramble', 0.10)],
    requirements: {
      text: 'front-corner; block the near shin; no lift needed', grips: 'pullAndLift', kuzushiDir: 1,
    },
    durationMs: [700, 1000], baseP: 0.20, kSkill: 2.4,
    skills: { attacker: ['jd.throw_fwd'], defender: ['jd.throw_def'] },
    physicalMods: [ph('OWNBAL+')],
    stateMods: [st('KUZ'), st('CAGE', -0.36)],
    counters: ['mirror tai otoshi', 'sumi gaeshi', 'ko soto', 'bend the knees and drive through'],
    tag: '[S: JUDO §3]', judoFailure: true, judoCommitment: 1.0, slamScale: 0.5,
  }),
  edge({
    id: 'tech.sumi_gaeshi', name: 'Sumi gaeshi', group: 'D', kind: 'throw',
    from: ['pos.clinch_overhook_control', 'pos.clinch_front_headlock', 'pos.clinch_over_under'],
    // A sacrifice throw: 0.30 of successes put tori on the bottom.
    to: [d('pos.ground_mount_low', 0.35), d('pos.ground_side', 0.25),
      d('pos.ground_closed_posture_up', 0.30, true), d('pos.ground_side', 0.10, true)],
    requirements: {
      text: 'front kuzushi; uke bent or pushing forward (mag >= 2, else x0.5)',
      grips: 'pullAndLift', kuzushiDir: 0, kuzushiMinMag: 2,
    },
    durationMs: [1000, 1500], baseP: 0.15, kSkill: 2.4,
    skills: { attacker: ['jd.throw_fwd', 'bjj.sweep'], defender: ['jd.throw_def'] },
    physicalMods: [ph('FLX+'), ph('BALd')],
    stateMods: [st('KUZ')],
    counters: ['o uchi before tori sits', 'post and end on top'],
    tag: '[S: JUDO §3, §5.3]', judoFailure: true, judoCommitment: 1.0, slamScale: 0.5,
  }),
  edge({
    id: 'tech.tomoe_nage', name: 'Tomoe nage', group: 'D', kind: 'throw',
    from: ['pos.clinch_collar_tie'],
    to: [d('pos.ground_mount_low', 0.35), d('pos.ground_side', 0.25),
      d('pos.ground_closed_posture_up', 0.30, true), d('pos.ground_side', 0.10, true)],
    requirements: {
      text: 'front; both hands controlled, uke leaning in', grips: 'pullAndLift', kuzushiDir: 0,
    },
    durationMs: [1000, 1400], baseP: 0.05, kSkill: 2.4,
    skills: { attacker: ['jd.throw_fwd'], defender: ['jd.throw_def'] },
    // Strength is a mild negative: the throw is a sacrifice, not a lift.
    physicalMods: [ph('FLX+'), ph('BALd'), ph('STR-', 0.05)],
    stateMods: [st('KUZ')],
    counters: ['ko soto before launch', 'stay standing (uke ends on top 0.40)'],
    tag: '[S: JUDO §3] (low viability)', judoFailure: true, judoCommitment: 1.0, slamScale: 0.5,
  }),
  edge({
    id: 'tech.ippon_seoi', name: 'Ippon seoi nage', group: 'D', kind: 'throw',
    from: ['pos.clinch_hand_fight', 'pos.clinch_overhook_control'],
    to: [d('pos.ground_side', 0.55), d('pos.ground_side_kesa', 0.20),
      d('pos.ground_back_seatbelt', 0.15), d('pos.ground_open_legs_up', 0.10)],
    requirements: {
      text: 'front-corner; arm trapped over the shoulder, hips under, feet inside',
      grips: 'pullAndLift', kuzushiDir: 1,
    },
    durationMs: [700, 1000], baseP: 0.15, kSkill: 2.4,
    skills: { attacker: ['jd.throw_fwd'], defender: ['jd.throw_def'] },
    physicalMods: [ph('EXP+'), ph('STR+'), ph('FLX+'), ph('HGT-')],
    stateMods: [st('KUZ'), st('CAGE', -0.36)],
    counters: ['squat + hips back + arm over to the back', 'guillotine off a failed drop'],
    tag: '[S: JUDO §3, §4]', judoFailure: true, judoCommitment: 1.5, slamScale: 0.5,
    note: 'Drop entry: position-given share 0.30 instead of 0.10.',
  }),
  edge({
    id: 'tech.morote_seoi', name: 'Morote seoi nage', group: 'D', kind: 'throw',
    from: ['pos.clinch_hand_fight'],
    to: [d('pos.ground_side', 0.55), d('pos.ground_side_kesa', 0.20),
      d('pos.ground_back_seatbelt', 0.15), d('pos.ground_open_legs_up', 0.10)],
    requirements: { text: 'full turn; back to uke', grips: 'pullAndLift', kuzushiDir: 1 },
    durationMs: [700, 1100], baseP: 0.12, kSkill: 2.4,
    skills: { attacker: ['jd.throw_fwd'], defender: ['jd.throw_def'] },
    physicalMods: [ph('EXP+'), ph('FLX+'), ph('HGT-')],
    stateMods: [st('KUZ'), st('CAGE', -0.36)],
    counters: ['back take', 'ushiro goshi'],
    tag: '[S: JUDO §3] (low-medium)', judoFailure: true, judoCommitment: 1.5, slamScale: 0.5,
  }),
  edge({
    id: 'tech.kata_guruma', name: "Kata guruma (fireman's carry)", group: 'D', kind: 'throw',
    from: ['pos.clinch_hand_fight', 'pos.clinch_two_on_one'],
    to: [d('pos.ground_side', 0.55), d('pos.ground_side_kesa', 0.20),
      d('pos.ground_back_seatbelt', 0.15), d('pos.ground_open_legs_up', 0.10)],
    requirements: {
      text: 'front-corner; drop under the arm, shoulder into the hip, arm between the legs; disabled under the judo ruleset (leg grab)',
      grips: 'pullAndLift', kuzushiDir: 1,
    },
    durationMs: [1200, 1800], baseP: 0.18, kSkill: 2.4,
    skills: { attacker: ['jd.throw_fwd', 'wr.finish'], defender: ['wr.sprawl'] },
    physicalMods: [ph('STR+'), ph('EXP+'), ph('HGT-')],
    stateMods: [st('KUZ')],
    counters: ['o uchi before tori leaves the ground', 'sprawl and guillotine'],
    tag: '[S: JUDO §3, §8 r16]', judoFailure: true, judoCommitment: 1.5, slamScale: 0.5,
  }),
  edge({
    id: 'tech.ura_nage', name: 'Ura nage', group: 'D', kind: 'throw',
    from: ['pos.clinch_body_lock_front', 'pos.clinch_over_under'],
    to: [d('pos.ground_side', 0.30), d('pos.ground_north_south', 0.25),
      d('pos.scramble', 0.30), d('pos.ground_side', 0.15, true)],
    requirements: {
      text: 'back kuzushi; uke leaning in or turned', grips: 'pullAndLift', kuzushiDir: 4,
    },
    // 0.20 direct, 0.35 as a counter to a forward throw.
    durationMs: [1000, 1500], baseP: 0.20, kSkill: 2.4,
    skills: { attacker: ['jd.throw_rear'], defender: ['jd.throw_def'] },
    physicalMods: [ph('STR+'), ph('EXP+'), ph('HGT-')],
    stateMods: [st('KUZ'), st('CAGE', 0.22), st('GRECO', 0.63)],
    counters: ['hook a leg', 'drop the weight and turn in'],
    tag: '[S: JUDO §3, §5.3]', judoFailure: true, judoCommitment: 1.0, slamScale: 0.8,
  }),
  edge({
    id: 'tech.te_guruma', name: 'Te guruma (hand wheel)', group: 'D', kind: 'counter',
    from: ['pos.clinch_body_lock_front', 'pos.clinch_underhook'],
    to: [d('pos.ground_side', 0.60), d('pos.ground_side_kesa', 0.25), d('pos.ground_open_legs_up', 0.15)],
    requirements: {
      text: 'lateral or back-corner; catch the planted leg, drive with the waist arm; disabled in the judo ruleset',
      grips: 'pullAndLift', kuzushiDir: 2,
    },
    // 0.30 direct, 0.45 as a counter to uchi mata / harai.
    durationMs: [900, 1300], baseP: 0.30, kSkill: 2.4,
    skills: { attacker: ['jd.counter', 'wr.finish'], defender: ['jd.throw_def'] },
    physicalMods: [ph('STR+'), ph('EXP+')],
    stateMods: [st('CAGE', 0.22)],
    counters: ['whizzer and sprag the lifted leg'],
    tag: '[S: JUDO §3]', judoFailure: true, judoCommitment: 1.0, slamScale: 0.5,
  }),
  edge({
    id: 'tech.tani_otoshi', name: 'Tani otoshi (valley drop)', group: 'D', kind: 'counter',
    from: ['pos.clinch_over_under', 'pos.clinch_body_lock_rear', 'pos.clinch_body_lock_front'],
    to: [d('pos.ground_side', 0.55), d('pos.ground_half_flat', 0.30), d('pos.scramble', 0.15)],
    requirements: {
      text: 'back-corner; uke driving or turning in', grips: 'pullAndLift', kuzushiDir: 3,
    },
    // 0.15 direct, 0.40 as a counter to a forward turn.
    durationMs: [800, 1200], baseP: 0.15, kSkill: 2.4,
    skills: { attacker: ['jd.counter', 'jd.throw_rear'], defender: ['jd.throw_def'] },
    physicalMods: [ph('STR+')],
    stateMods: [st('KUZ'), st('CAGE', 0.42)],
    counters: ['ko soto (difficult)', 'base wide', 'turn in'],
    tag: '[S: JUDO §3, §5.3]', judoFailure: true, judoCommitment: 1.0, slamScale: 0.8,
    note: 'Knee-injury flag on uke (chapter 05) [E].',
  }),
  edge({
    id: 'tech.de_ashi_harai', name: 'De ashi harai', group: 'D', kind: 'throw',
    from: ['pos.clinch_collar_tie', 'pos.clinch_hand_fight', 'pos.clinch_over_under', 'pos.standing_close'],
    to: [d('pos.ground_open_legs_up', 0.70), d('pos.ground_side', 0.20), d('pos.standing_close', 0.10)],
    requirements: {
      text: 'lateral kuzushi; uke stepping, weight not yet transferred',
      grips: 'singleHandle', kuzushiDir: 2,
    },
    durationMs: [300, 600], baseP: 0.08, kSkill: 2.4,
    skills: { attacker: ['jd.foot_sweep'], defender: ['jd.throw_def'] },
    physicalMods: [ph('BALd'), ph('OWNBAL+')],
    stateMods: [st('KUZ')],
    counters: ['tsubame gaeshi (mirror)', 'o soto', 'step over'],
    tag: '[S: JUDO §3]',
    // Commitment x0.3: near-zero counter risk.
    judoFailure: true, judoCommitment: 0.3, slamScale: 0.2,
  }),
  edge({
    id: 'tech.sasae_tsurikomi_ashi', name: 'Sasae tsurikomi ashi', group: 'D', kind: 'throw',
    from: ['pos.clinch_collar_tie', 'pos.clinch_two_on_one'],
    to: [d('pos.ground_open_legs_up', 0.50), d('pos.ground_side', 0.40), d('pos.scramble', 0.10)],
    requirements: {
      text: 'front-corner; prop the advancing ankle; uke stepping forward',
      grips: 'singleHandle', kuzushiDir: 1,
    },
    durationMs: [500, 800], baseP: 0.08, kSkill: 2.4,
    skills: { attacker: ['jd.foot_sweep'], defender: ['jd.throw_def'] },
    physicalMods: [ph('BALd')], stateMods: [st('KUZ')],
    counters: ['step over'],
    tag: '[S: JUDO §3]', judoFailure: true, judoCommitment: 0.3, slamScale: 0.2,
  }),
  edge({
    id: 'tech.hane_goshi', name: 'Hane goshi', group: 'D', kind: 'throw',
    from: ['pos.clinch_overhook_control', 'pos.clinch_head_and_arm'],
    to: [d('pos.ground_side', 0.60), d('pos.ground_side_kesa', 0.25),
      d('pos.ground_open_legs_up', 0.10), d('pos.ground_turtle', 0.05)],
    requirements: {
      text: 'front-corner; the bent leg springs the thigh', grips: 'pullAndLift', kuzushiDir: 1,
    },
    durationMs: [900, 1200], baseP: 0.20, kSkill: 2.4,
    skills: { attacker: ['jd.throw_fwd'], defender: ['jd.throw_def'] },
    physicalMods: [ph('STR+'), ph('FLX+')],
    stateMods: [st('KUZ'), st('CAGE', -0.36)],
    counters: ['as harai goshi'],
    tag: '[S: JUDO §3]', judoFailure: true, judoCommitment: 1.5, slamScale: 0.5,
  }),
  edge({
    id: 'tech.uchi_mata_sukashi', name: 'Uchi mata sukashi', group: 'D', kind: 'counter', actor: 'b',
    from: ['pos.clinch_underhook', 'pos.clinch_head_and_arm', 'pos.clinch_over_under'],
    to: [d('pos.ground_side', 0.60, true), d('pos.ground_side_kesa', 0.25, true),
      d('pos.ground_open_legs_up', 0.15, true)],
    toOnFailure: [d('same', 1)],
    requirements: 'fires only during a committed tech.uchi_mata; pure timing',
    // Conditional on the counter being launched by the failure table.
    durationMs: [400, 700], baseP: 0.50, kSkill: 2.4,
    skills: { attacker: ['jd.counter'], defender: ['jd.throw_fwd'] },
    physicalMods: [ph('BALd'), ph('OWNBAL+')],
    counters: ['none (uke is mid-throw)'],
    tag: '[S: JUDO §3, §4] (90-100 % in gi; no-gi 50 %)', slamScale: 0.5,
  }),
  edge({
    id: 'tech.osoto_gaeshi', name: 'O soto gaeshi', group: 'D', kind: 'counter', actor: 'b',
    from: ['pos.clinch_collar_tie', 'pos.clinch_over_under', 'pos.clinch_head_and_arm'],
    to: [d('pos.ground_side', 0.60, true), d('pos.ground_side_kesa', 0.25, true),
      d('pos.ground_open_legs_up', 0.15, true)],
    toOnFailure: [d('same', 1)],
    requirements: 'block the reap and reap the support leg; conditional on a launched counter',
    durationMs: [600, 1000], baseP: 0.35, kSkill: 2.4,
    skills: { attacker: ['jd.counter'], defender: ['jd.throw_rear'] },
    physicalMods: [ph('BALd'), ph('STR+')],
    // The fence cuts uke's counter launch to x0.7.
    stateMods: [st('CAGE', -0.36)],
    tag: '[S: JUDO §4]', slamScale: 0.5,
  }),
  edge({
    id: 'tech.harai_gaeshi', name: 'Harai gaeshi', group: 'D', kind: 'counter', actor: 'b',
    from: ['pos.clinch_overhook_control', 'pos.clinch_head_and_arm', 'pos.clinch_body_lock_front'],
    to: [d('pos.ground_side', 0.60, true), d('pos.ground_side_kesa', 0.25, true),
      d('pos.ground_open_legs_up', 0.15, true)],
    toOnFailure: [d('same', 1)],
    requirements: 'block the sweeping leg; conditional on a launched counter',
    durationMs: [600, 1000], baseP: 0.30, kSkill: 2.4,
    skills: { attacker: ['jd.counter'], defender: ['jd.throw_fwd'] },
    physicalMods: [ph('BALd'), ph('STR+')], stateMods: [st('CAGE', -0.36)],
    tag: '[S: JUDO §4]', slamScale: 0.5,
  }),
  edge({
    id: 'tech.ouchi_gaeshi', name: 'O uchi gaeshi', group: 'D', kind: 'counter', actor: 'b',
    from: ['pos.clinch_collar_tie', 'pos.clinch_over_under', 'pos.clinch_body_lock_front'],
    to: [d('pos.ground_side', 0.60, true), d('pos.ground_side_kesa', 0.25, true),
      d('pos.ground_open_legs_up', 0.15, true)],
    toOnFailure: [d('same', 1)],
    requirements: 'block the reap; conditional on a launched counter',
    durationMs: [600, 1000], baseP: 0.25, kSkill: 2.4,
    skills: { attacker: ['jd.counter'], defender: ['jd.throw_rear'] },
    physicalMods: [ph('BALd'), ph('STR+')], stateMods: [st('CAGE', -0.36)],
    tag: '[S: JUDO §4]', slamScale: 0.5,
  }),
  edge({
    id: 'tech.seoi_back_take', name: 'Back take off a failed shoulder throw', group: 'D', kind: 'counter', actor: 'b',
    from: ['pos.clinch_hand_fight', 'pos.clinch_overhook_control', 'pos.clinch_two_on_one'],
    to: [d('pos.clinch_body_lock_rear', 0.6, true), d('pos.ground_back_seatbelt', 0.4, true)],
    toOnFailure: [d('same', 1)],
    requirements: 'fires during a failed ippon seoi / morote seoi / kata guruma; squat, hips back, arm over',
    durationMs: [500, 500], baseP: 0.55, kSkill: 2.1,
    skills: { attacker: ['wr.pummel'], defender: ['jd.throw_fwd'] },
    tag: '[S: JUDO §4]',
  }),
  edge({
    id: 'tech.grip_exchange', name: 'Grip exchange (kuzushi action)', group: 'D', kind: 'clinch',
    from: CLINCH_NODE_IDS,
    to: [d('same', 1)], toOnFailure: [d('same', 1)],
    requirements: 'any tie; elite grip disputes run 16-18 s = 2-3 exchanges',
    durationMs: [3000, 8000], baseP: 0.50, kSkill: 2.5,
    skills: { attacker: ['jd.grip'], defender: ['jd.grip'] },
    physicalMods: [ph('STR+')],
    tag: '[S: JUDO §8 r4, r6]',
    note: 'Winner gains underhookOwner or head position and kuzushi mag +1 (max 3, decays -1 per 2 s); a dominant tie multiplies the next throw by 1.3, a uke-dominant tie by 0.6. P is clamped to 0.15-0.85 here, not to the global clamp. Exchange duration scales by massKg/70.',
  }),
];

// ---------------------------------------------------------------------------
// §2.3 E — Cage-specific edges, standing and ground (12). See §4 for the model.
// ---------------------------------------------------------------------------

const EDGES_E: readonly GrapplingEdge[] = [
  edge({
    id: 'tech.cage_drive', name: 'Drive to the cage', group: 'E', kind: 'cage',
    from: CLINCH_NODE_IDS,
    to: [d('pos.clinch_cage_pin_front', 1)],
    requirements: { text: 'defender <= 2 m from the fence; forward drive' },
    durationMs: [1000, 2000], baseP: 0.60, kSkill: 2.0,
    skills: { attacker: ['mma.cage'], defender: ['mma.cage'] },
    physicalMods: [ph('STR+'), ph('MASS+')], stateMods: [st('FAT-')],
    counters: ['circle out', 'hip in', 'underhook'],
    tag: '[S: WRESTLING §4 chain 8, §5.1]',
    note: 'Tier use of a stalled attempt: T2 50 %, T3 75 %, T4 90 % [S: WRESTLING §7].',
  }),
  edge({
    id: 'tech.cage_pin_pummel', name: 'Pummel on the fence', group: 'E', kind: 'cage',
    from: ['pos.clinch_cage_pin_front'],
    to: [d('pos.clinch_underhook', 0.35), d('pos.clinch_double_under', 0.30),
      d('pos.clinch_body_lock_front', 0.20), d('same', 0.15)],
    toOnFailure: [d('same', 0.40), d('pos.clinch_cage_pin_front', 0.25, true),
      d('pos.standing_cage', 0.35)],
    requirements: { text: 'one exchange per 3,000 ms', cage: 'required' },
    // P = 0.5 + 0.004*dWR + 0.003*dSTR - 0.15*dFAT, re-expressed in §2.1.4 codes.
    durationMs: [3000, 3000], baseP: 0.50, kSkill: 1.6,
    skills: { attacker: ['wr.pummel'], defender: ['wr.pummel'] },
    physicalMods: [ph('STR+', 0.12)], stateMods: [st('FAT-', 0.63)],
    tag: '[S: WRESTLING §5.3]',
    note: 'A pinned fighter who wins double-unders reverses the pin 0.25 or breaks 0.35.',
  }),
  edge({
    id: 'tech.cage_break', name: 'Break off the fence', group: 'E', kind: 'cage', actor: 'b',
    from: ['pos.clinch_cage_pin_front', 'pos.clinch_cage_pin_rear'],
    to: [d('pos.standing_cage', 1)],
    requirements: { text: 'underhook + hip in + circle out; rolled per 5 s', cage: 'required' },
    durationMs: [5000, 5000], baseP: 0.30, kSkill: 2.0,
    skills: { attacker: ['mma.cage'], defender: ['mma.cage'] },
    physicalMods: [ph('STR+')], stateMods: [st('FAT-')],
    counters: ['knee behind knee', 'tight waist', 're-pin'],
    tag: '[S: WRESTLING §5.2]',
    note: "+0.42 logit [D: +10 pp] if the pinner's head is on the wrong side; the pinned fighter pays 1.3x energy per second.",
  }),
  edge({
    id: 'def.cage_hip_in', name: 'Hip in on the fence', group: 'E', kind: 'defence', actor: 'b',
    from: ['pos.clinch_cage_pin_front'],
    to: [d('same', 1)],
    requirements: {
      text: 'back flat on the fence, hips forward, open-hand posts (grabbing is a foul)',
      cage: 'required',
    },
    // Halves the pinner's per-attempt drive/lift finish P; trips unaffected.
    durationMs: [0, 0], baseP: 0.50, kSkill: 2.0,
    skills: { attacker: ['mma.cage'], defender: ['wr.finish'] },
    physicalMods: [ph('STR+')],
    counters: ['switch to trips / knee tap / foot stomps'],
    tag: '[S: WRESTLING §5.2]',
  }),
  edge({
    id: 'tech.cage_pin_strikes', name: 'Strike on the fence', group: 'E', kind: 'strike',
    from: ['pos.clinch_cage_pin_front', 'pos.clinch_cage_pin_rear'],
    to: [d('same', 1)], toOnFailure: [d('same', 1)],
    requirements: { text: 'a free limb', cage: 'required' },
    // 0.50-0.65 land band; 0.57 is its midpoint.
    durationMs: [400, 600], baseP: 0.57, kSkill: 0,
    skills: { attacker: ['mma.clinch_strike'], defender: [] },
    tag: '[S: WRESTLING §5.2, §9 r23] [S: MMA_INTEGRATION I-11]',
    note: 'Every pinner strike resets the §6 clinch-break timer and adds STK+ to the next trip or mat return.',
  }),
  edge({
    id: 'tech.foot_stomp', name: 'Foot stomp', group: 'E', kind: 'strike',
    from: ['pos.clinch_cage_pin_front', 'pos.clinch_over_under'],
    to: [d('same', 1)], toOnFailure: [d('same', 1)],
    requirements: 'a free foot',
    durationMs: [300, 300], baseP: 0.50, kSkill: 0,
    skills: { attacker: ['mma.clinch_strike'], defender: [] },
    counters: ['lift the foot', 'step'],
    tag: '[S: WRESTLING §9 r23]; land rate [E]',
    note: 'No damage; +0.21 logit [D: +0.05 P] on the next trip within 2 s; counts as work for §6.',
  }),
  edge({
    id: 'tech.cage_single_chain', name: 'Cage single chain', group: 'E', kind: 'chain',
    from: ['pos.td_single_leg_in'],
    to: [d('pos.ground_open_kneeling_top', 0.45), d('pos.ground_half_flat', 0.35), d('pos.ground_side', 0.20)],
    toOnFailure: [d('pos.clinch_cage_pin_front', 0.6), d('pos.standing_cage', 0.4)],
    requirements: { text: 'fence contact; up to 6 attempts, each x1.5 duration', cage: 'required' },
    // Cumulative 0.45-0.60 over the chain; 0.52 is the midpoint [D].
    durationMs: [1500, 3000], baseP: 0.52, kSkill: 2.1,
    skills: { attacker: ['wr.finish'], defender: ['wr.sprawl'] },
    stateMods: [st('CHAIN'), st('CAGE', 0.42)],
    counters: ['wall walk', 'underhook and hip in', 'whizzer and circle'],
    tag: '[S: MMA_INTEGRATION I-8] [S: WRESTLING §5.2, §8.4]',
    note: 'Cycles single_trip (+0.42), single_dump (+0.42), single_to_double, single_run_pipe (-1.05).',
  }),
  edge({
    id: 'tech.wall_walk', name: 'Wall walk', group: 'E', kind: 'getup', actor: 'b',
    from: ['pos.ground_cage_seated', 'pos.ground_half_flat', 'pos.ground_side',
      'pos.ground_turtle', 'pos.ground_back_hooks'],
    // Stage 1 reaches pos.ground_wall_walk; stage 2 leaves it (see WALL_WALK_STAGE2 in cage.ts).
    to: [d('pos.ground_wall_walk', 1)],
    toOnFailure: [d('pos.ground_cage_seated', 0.60), d('pos.ground_turtle', 0.30),
      d('pos.ground_back_hooks', 0.10)],
    requirements: {
      text: 'back on the fence, near-side underhook or an open hand on the fence, feet under the hips, balance > 30 %',
      cage: 'required',
    },
    durationMs: [3000, 6000], baseP: 0.60, kSkill: 3.0,
    skills: { attacker: ['wr.get_up', 'mma.cage'], defender: ['wr.ride', 'mma.cage'] },
    physicalMods: [ph('STR++'), ph('MASS++')],
    stateMods: [st('CAGE'), st('UHO'), st('FAT--'), st('FATd+', 0.42)],
    counters: ['knee behind knee', 'tight waist', 'hip pressure', 'knees to thigh/body', 'mat return', 'twist body lock'],
    tag: '[S: WRESTLING §3.8] [S: BJJ_POSITIONS §3.2 G2] [S: MMA_INTEGRATION I-14]',
    note: 'Fence-grab foul on 5 % of attempts at T<=1: -0.5 logit plus a §06 warning.',
  }),
  edge({
    id: 'tech.wall_walk_back_escape', name: 'Wall walk out of back control', group: 'E', kind: 'escape', actor: 'b',
    from: ['pos.ground_back_hooks', 'pos.ground_back_body_triangle'],
    to: [d('pos.clinch_body_lock_rear', 0.60), d('pos.standing_cage', 0.40)],
    toOnFailure: [d('pos.ground_back_hooks', 1)],
    requirements: { text: 'hand-fight the choke first, then walk the hips up the wall', cage: 'required' },
    // 0.40 vs hooks; 0.20 vs the body triangle [D: E11 10 % per attempt => half].
    durationMs: [5000, 15000], baseP: 0.40, kSkill: 3.0,
    skills: { attacker: ['wr.get_up'], defender: ['bjj.back_control'] },
    physicalMods: [ph('STR++'), ph('MASS++')],
    stateMods: [st('CAGE'), st('FAT--')],
    counters: ['stretch the hooks', 'mat return', 'choke while standing'],
    tag: '[S: BJJ_POSITIONS §3.2 E12]',
  }),
  edge({
    id: 'tech.cage_mat_return', name: 'Mat return on the fence', group: 'E', kind: 'cage',
    from: ['pos.clinch_cage_pin_rear', 'pos.ground_wall_walk'],
    to: [d('pos.ground_turtle', 0.55), d('pos.ground_back_hooks', 0.30), d('pos.ground_cage_seated', 0.15)],
    requirements: { text: 'knee behind knee; the wall helps', cage: 'required' },
    durationMs: [1000, 2000], baseP: 0.70, kSkill: 2.1,
    skills: { attacker: ['wr.mat_return'], defender: ['wr.get_up'] },
    physicalMods: [ph('STR+'), ph('MASS+')],
    counters: ['wrist control and turn in', 'foot post on the cage'],
    tag: '[S: WRESTLING §3.5]',
    note: 'The cage bonus is already inside the 0.70 base; cage.ts must not add it twice.',
  }),
  edge({
    id: 'tech.cage_knee_pin', name: 'Knee pin against the fence', group: 'E', kind: 'cage',
    from: ['pos.ground_cage_seated', 'pos.ground_wall_walk'],
    to: [d('pos.ground_cage_seated', 0.70), d('pos.ground_side', 0.30)],
    requirements: { text: "inside knee pinning the bottom's near hip, body lock", cage: 'required' },
    durationMs: [2000, 4000], baseP: 0.50, kSkill: 2.5,
    skills: { attacker: ['mma.cage', 'bjj.top_control'], defender: ['mma.cage', 'wr.get_up'] },
    physicalMods: [ph('STR+'), ph('MASS+')], stateMods: [st('CAGE')],
    counters: ['knee shield along the fence', 'wrist control on the striking hand'],
    tag: '[S: BJJ_POSITIONS §5.3]; value [E]',
    note: 'Success flips underhookOwner to the top, costing the bottom -0.35 UHO on the wall walk.',
  }),
  edge({
    id: 'tech.cage_assisted_pass', name: 'Cage-assisted pass', group: 'E', kind: 'pass',
    from: ['pos.ground_cage_seated', 'pos.ground_half_knee_shield', 'pos.ground_half_flat',
      'pos.ground_open_kneeling_top'],
    to: [d('pos.ground_side', 0.60), d('pos.ground_mount_low', 0.10), d('pos.ground_turtle', 0.30)],
    toOnFailure: [d('same', 0.70), d('pos.standing_cage', 0.30, true)],
    requirements: {
      text: 'bottom pinned with back or shoulders on the fence; pin the near hip, walk the far side',
      cage: 'required',
    },
    durationMs: [8000, 20000], baseP: 0.45, kSkill: 3.0,
    skills: { attacker: ['bjj.pass', 'mma.cage'], defender: ['bjj.retention'] },
    physicalMods: [ph('STR+')],
    // This is the "++" cage bonus of §4.1.
    stateMods: [st('CAGE', 0.70), st('STK+')],
    counters: ['wall walk with the underhook', 'knee shield to create space along the fence'],
    tag: '[S: BJJ_POSITIONS §3.2 P10]',
  }),
];

// ---------------------------------------------------------------------------
// §2.3 F — Guard passes, top-initiated (12)
// ---------------------------------------------------------------------------

const EDGES_F: readonly GrapplingEdge[] = [
  edge({
    id: 'tech.pass_knee_cut', name: 'Knee cut', group: 'F', kind: 'pass',
    from: ['pos.ground_half_flat', 'pos.ground_half_knee_shield', 'pos.ground_hq'],
    to: [d('pos.ground_side', 0.70), d('pos.ground_mount_low', 0.10), d('pos.ground_side_kesa', 0.20)],
    toOnFailure: [d('same', 0.70), d('pos.ground_half_underhook', 0.15),
      d('pos.ground_half_dogfight', 0.10), d('pos.ground_ashi_slx', 0.05, true)],
    requirements: 'underhook or cross-face, pin the knee shield, inside knee across the thigh, head low on the far side',
    durationMs: [6000, 15000], baseP: 0.35, kSkill: 3.0,
    skills: { attacker: ['bjj.pass'], defender: ['bjj.retention'] },
    physicalMods: [ph('STR+'), ph('MASS+')],
    stateMods: [st('STK+'), st('CAGE', 0.35), st('FATd+')],
    counters: ['knee shield + far frame', 'underhook + roll-under', 'wrestle-up on the sliced leg', 'leg entanglement'],
    tag: '[S: BJJ_POSITIONS §3.2 P1]',
  }),
  edge({
    id: 'tech.pass_toreando', name: 'Toreando pass', group: 'F', kind: 'pass',
    from: ['pos.ground_open_legs_up', 'pos.ground_open_kneeling_top'],
    to: [d('pos.ground_side', 0.60), d('pos.ground_side_kob', 0.25), d('pos.ground_north_south', 0.15)],
    toOnFailure: [d('pos.ground_open_kneeling_top', 0.80), d('pos.standing_mid', 0.20, true)],
    requirements: 'shin / ankle / knee control (no pants: 2-on-1 on a leg), push the legs aside, circle',
    // 0.45 against an MMA-typical weak open guard.
    durationMs: [3000, 8000], baseP: 0.40, kSkill: 3.0,
    skills: { attacker: ['bjj.pass'], defender: ['bjj.retention'] },
    stateMods: [st('WET'), st('STK+')],
    counters: ['hip escape and re-guard', 'leg pummel', 'up-kick when the top dives', 'sit up to wrestle'],
    tag: '[S: BJJ_POSITIONS §3.2 P2]',
  }),
  edge({
    id: 'tech.pass_leg_drag', name: 'Leg drag', group: 'F', kind: 'pass',
    from: ['pos.ground_open_kneeling_top', 'pos.ground_ashi_slx', 'pos.ground_open_x',
      'pos.ground_half_knee_shield'],
    to: [d('pos.ground_side', 0.50), d('pos.ground_back_hooks', 0.20),
      d('pos.ground_mount_tech', 0.10), d('pos.ground_side_kob', 0.20)],
    toOnFailure: [d('pos.ground_half_flat', 0.7), d('pos.scramble', 0.3)],
    requirements: 'drag the leg across the hip, pin the thigh with the hip, control the far hip and head',
    durationMs: [4000, 10000], baseP: 0.35, kSkill: 3.0,
    skills: { attacker: ['bjj.pass'], defender: ['bjj.retention'] },
    stateMods: [st('WET'), st('STK+')],
    counters: ['hip escape and knee back', 'turn to turtle then stand'],
    tag: '[S: BJJ_POSITIONS §3.2 P3]',
  }),
  edge({
    id: 'tech.pass_over_under', name: 'Over-under pass', group: 'F', kind: 'pass',
    from: ['pos.ground_open_kneeling_top', 'pos.ground_half_flat'],
    to: [d('pos.ground_side', 0.80), d('pos.ground_mount_low', 0.20)],
    toOnFailure: [d('same', 0.85), d('same', 0.10, true), d('same', 0.05, true)],
    requirements: 'one arm under a leg, one over, head low, drive laterally',
    durationMs: [5000, 15000], baseP: 0.40, kSkill: 2.0,
    skills: { attacker: ['bjj.pass'], defender: ['bjj.retention'] },
    physicalMods: [ph('STR++'), ph('MASS++')],
    stateMods: [st('STK-'), st('CAGE', 0.35)],
    counters: ['hip escape', 'kimura on the over arm (0.10 of fails)', 'triangle on the under arm (0.05)'],
    tag: '[S: BJJ_POSITIONS §3.2 P4]',
  }),
  edge({
    id: 'tech.pass_double_under_stack', name: 'Double-under stack pass', group: 'F', kind: 'pass',
    from: ['pos.ground_open_kneeling_top', 'pos.ground_closed_top_standing'],
    to: [d('pos.ground_side', 0.70), d('pos.ground_mount_low', 0.30)],
    toOnFailure: [d('pos.ground_open_kneeling_top', 0.80), d('pos.scramble', 0.10),
      d('same', 0.10, true)],
    requirements: 'both arms under the thighs, clasp, stack; spiking is illegal (§06 flag)',
    durationMs: [5000, 15000], baseP: 0.35, kSkill: 2.0,
    skills: { attacker: ['bjj.pass'], defender: ['bjj.retention'] },
    physicalMods: [ph('STR++'), ph('MASS++')], stateMods: [st('STK-')],
    counters: ['hand-fight the hips', 'extend the legs', 'roll to the knees', 'triangle 0.05', 'kimura 0.05'],
    tag: '[S: BJJ_POSITIONS §3.2 P5]',
  }),
  edge({
    id: 'tech.pass_smash_half', name: 'Smash pass from half', group: 'F', kind: 'pass',
    from: ['pos.ground_half_flat', 'pos.ground_half_quarter'],
    to: [d('pos.ground_side', 0.60), d('pos.ground_mount_low', 0.40)],
    toOnFailure: [d('same', 0.70), d('pos.ground_half_underhook', 0.30)],
    requirements: 'cross-face + underhook or head control; flatten; free the foot by knee-out or foot-drag',
    // The highest-percentage MMA pass.
    durationMs: [8000, 25000], baseP: 0.40, kSkill: 2.0,
    skills: { attacker: ['bjj.pass'], defender: ['bjj.retention'] },
    physicalMods: [ph('STR++'), ph('MASS++')],
    stateMods: [st('STK+'), st('CAGE', 0.35), st('FATd++')],
    counters: ['underhook + knee-shield recovery', 'kimura on the cross-face arm', 'lockdown'],
    tag: '[S: BJJ_POSITIONS §3.2 P6]',
  }),
  edge({
    id: 'tech.pass_body_lock', name: 'Body-lock pass', group: 'F', kind: 'pass',
    from: ['pos.ground_open_legs_up', 'pos.ground_open_butterfly', 'pos.ground_open_seated',
      'pos.ground_open_k', 'pos.ground_half_knee_shield'],
    to: [d('pos.ground_side', 0.50), d('pos.ground_half_flat', 0.30), d('pos.ground_mount_low', 0.20)],
    toOnFailure: [d('pos.ground_half_knee_shield', 0.85), d('pos.scramble', 0.15)],
    requirements: 'chest-to-chest, arms locked around the waist, sprawl the legs, walk the hips around',
    durationMs: [15000, 45000], baseP: 0.45, kSkill: 2.0,
    skills: { attacker: ['bjj.pass'], defender: ['bjj.retention'] },
    physicalMods: [ph('STR++'), ph('MASS++')],
    stateMods: [st('STK-'), st('FATd++')],
    counters: ['frame on the shoulder/neck', 'knee shield', 'sit-up / wrestle-up', 'guillotine on the lowered head (0.05 [E])'],
    tag: '[S: BJJ_POSITIONS §3.2 P7] (dominant no-gi pass)',
  }),
  edge({
    id: 'tech.pass_hq', name: 'Pass from headquarters', group: 'F', kind: 'pass',
    from: ['pos.ground_hq'],
    to: [d('pos.ground_side', 0.60), d('pos.ground_half_flat', 0.20), d('pos.ground_side_kesa', 0.20)],
    toOnFailure: [d('pos.ground_half_knee_shield', 0.70), d('pos.ground_ashi_slx', 0.10, true),
      d('pos.td_single_leg_in', 0.20, true)],
    requirements: 'inside leg pinned between the bottom legs; outside knee/foot control; posture',
    durationMs: [4000, 12000], baseP: 0.40, kSkill: 3.0,
    skills: { attacker: ['bjj.pass'], defender: ['bjj.retention'] },
    stateMods: [st('STK+'), st('CAGE', 0.35)],
    counters: ['inside knee push', 'shin-to-shin', 'wrestle-up to a single'],
    tag: '[S: BJJ_POSITIONS §3.2 P8]',
  }),
  edge({
    id: 'tech.pass_float', name: 'Floating pass', group: 'F', kind: 'pass',
    from: ['pos.ground_hq', 'pos.ground_open_kneeling_top', 'pos.ground_open_butterfly'],
    to: [d('pos.ground_side', 0.40), d('pos.ground_north_south', 0.20),
      d('pos.ground_side_kob', 0.20), d('pos.ground_back_seatbelt', 0.20)],
    toOnFailure: [d('pos.scramble', 0.85), d('pos.ground_ashi_slx', 0.15, true)],
    requirements: { text: 'balance and hip mobility; T3+ only (T0-T2 resolve at 0.10)', minTier: 3 },
    durationMs: [3000, 8000], baseP: 0.30, kSkill: 3.5,
    skills: { attacker: ['bjj.pass'], defender: ['bjj.retention'] },
    // Lighter passers float better: the sign of the mass term flips here.
    physicalMods: [ph('MASS-')], stateMods: [st('FAT-')],
    counters: ['wrestle-ups', 'leg entanglements', 'guard recomposition'],
    tag: '[S: BJJ_POSITIONS §3.2 P9]',
  }),
  edge({
    id: 'tech.pass_north_south_to_mount_back', name: 'North-south to mount or back', group: 'F', kind: 'advance',
    from: ['pos.ground_north_south'],
    to: [d('pos.ground_mount_low', 0.6), d('pos.ground_back_seatbelt', 0.4)],
    toOnFailure: [d('pos.ground_side', 1)],
    requirements: 'hips heavy, arm control',
    durationMs: [3000, 8000], baseP: 0.50, kSkill: 2.0,
    skills: { attacker: ['bjj.pass', 'bjj.top_control'], defender: ['bjj.escape'] },
    stateMods: [st('STK-')],
    counters: ['hip escape to the knees'],
    tag: '[S: BJJ_POSITIONS §3.2 P12]',
  }),
  edge({
    id: 'tech.pass_with_gnp', name: 'Strike-to-pass wrapper', group: 'F', kind: 'pass',
    from: GUARD_NODE_IDS.concat(['pos.ground_half_flat', 'pos.ground_half_knee_shield']),
    to: [d('pos.ground_side', 0.60), d('pos.ground_half_flat', 0.25), d('pos.ground_mount_low', 0.15)],
    toOnFailure: [d('same', 0.80), d('same', 0.08, true), d('pos.ground_mount_low', 0.12, true)],
    requirements: { text: 'posture, hips heavy, a free hand; strike then pass while the bottom covers' },
    // The underlying pass base plus STK+ (max +0.60 logit); 0.38 is the
    // volume-weighted mean of the knee cut / smash / HQ bases it wraps.
    durationMs: [10000, 30000], baseP: 0.38, kSkill: 2.5,
    skills: { attacker: ['bjj.pass', 'mma.gnp'], defender: ['bjj.retention'] },
    stateMods: [st('STK+'), st('POST')],
    counters: ['cover and frame', 'hip escape when the top posts', 'wrist control', 'armbar/kimura/triangle on the striking arm (0.08)'],
    tag: '[S: BJJ_POSITIONS §3.2 P11] [S: MMA_INTEGRATION I-16]',
  }),
  edge({
    id: 'tech.open_closed_guard', name: 'Open the closed guard', group: 'F', kind: 'pass',
    from: ['pos.ground_closed_posture_up'],
    to: [d('pos.ground_open_kneeling_top', 0.6), d('pos.ground_closed_top_standing', 0.4)],
    toOnFailure: [d('pos.ground_closed_posture_broken', 0.30), d('same', 0.70)],
    requirements: 'posture, hands on hips or biceps, or stand',
    durationMs: [3000, 8000], baseP: 0.55, kSkill: 2.5,
    skills: { attacker: ['bjj.pass'], defender: ['bjj.retention'] },
    physicalMods: [ph('STR+')], stateMods: [st('STK+')],
    counters: ['break the posture', 'hip bump', 'armbar / triangle entries'],
    tag: '[E]; guard-opening-by-strikes [S: BJJ_POSITIONS §6]',
    note: 'T0 guards open after 3 landed strikes, T1 after 5.',
  }),
];

// ---------------------------------------------------------------------------
// §2.3 G — Top consolidation and advancement, non-pass (17)
// ---------------------------------------------------------------------------

const EDGES_G: readonly GrapplingEdge[] = [
  edge({
    id: 'tech.side_to_mount', name: 'Side control to mount', group: 'G', kind: 'advance',
    from: ['pos.ground_side', 'pos.ground_side_kesa', 'pos.ground_side_reverse_kesa'],
    to: [d('pos.ground_mount_low', 1)],
    toOnFailure: [d('pos.ground_half_flat', 0.60), d('pos.ground_side', 0.40)],
    requirements: 'cross-face, block the near hip and knee, slide the knee across',
    durationMs: [3000, 8000], baseP: 0.45, kSkill: 2.0,
    skills: { attacker: ['bjj.top_control'], defender: ['bjj.escape'] },
    physicalMods: [ph('STR+')], stateMods: [st('STK+'), st('CAGE', 0.35)],
    counters: ['knee in', 'hip escape on the transition', 'catch half guard'],
    tag: '[S: BJJ_POSITIONS §3.2 T1]',
  }),
  edge({
    id: 'tech.side_to_kob', name: 'Side control to knee on belly', group: 'G', kind: 'advance',
    from: ['pos.ground_side'],
    to: [d('pos.ground_side_kob', 1)],
    toOnFailure: [d('pos.ground_side', 0.80), d('pos.ground_turtle', 0.20)],
    requirements: 'hip switch, posted foot',
    durationMs: [1000, 3000], baseP: 0.70, kSkill: 2.0,
    skills: { attacker: ['bjj.top_control'], defender: ['bjj.escape'] },
    counters: ['follow the hip', 'turn in'],
    tag: '[S: BJJ_POSITIONS §3.2 T2]',
  }),
  edge({
    id: 'tech.kob_to_mount_back', name: 'Knee on belly to mount or back', group: 'G', kind: 'advance',
    from: ['pos.ground_side_kob'],
    to: [d('pos.ground_mount_low', 0.60), d('pos.ground_back_seatbelt', 0.40)],
    toOnFailure: [d('pos.ground_half_flat', 0.5), d('pos.scramble', 0.5)],
    requirements: 'pressure and timing',
    durationMs: [2000, 5000], baseP: 0.50, kSkill: 2.0,
    skills: { attacker: ['bjj.top_control'], defender: ['bjj.escape'] },
    stateMods: [st('STK+')],
    counters: ['push and shrimp', 'turn to the knees'],
    tag: '[S: BJJ_POSITIONS §3.2 T3]',
  }),
  edge({
    id: 'tech.side_to_north_south', name: 'Side control to north-south', group: 'G', kind: 'advance',
    from: ['pos.ground_side'],
    to: [d('pos.ground_north_south', 1)],
    toOnFailure: [d('pos.ground_side', 0.75), d('pos.ground_turtle', 0.25)],
    requirements: 'switch the hips over the head',
    durationMs: [2000, 4000], baseP: 0.70, kSkill: 2.0,
    skills: { attacker: ['bjj.top_control'], defender: ['bjj.escape'] },
    counters: ['follow', 'hip escape'],
    tag: '[S: BJJ_POSITIONS §3.2 T4]',
  }),
  edge({
    id: 'tech.mount_climb', name: 'Climb the mount', group: 'G', kind: 'advance',
    from: ['pos.ground_mount_low'],
    to: [d('pos.ground_mount_high', 0.70), d('pos.ground_mount_s', 0.30)],
    toOnFailure: [d('pos.ground_mount_low', 0.70), d('pos.ground_half_flat', 0.30)],
    requirements: 'walk the knees up with head and arm control, hips heavy',
    durationMs: [3000, 8000], baseP: 0.50, kSkill: 3.0,
    skills: { attacker: ['bjj.top_control'], defender: ['bjj.escape'] },
    physicalMods: [ph('STR+')], stateMods: [st('STK+')],
    counters: ['elbows tight', 'hip escape', 'upa when the top climbs'],
    tag: '[S: BJJ_POSITIONS §3.2 T5]',
  }),
  edge({
    id: 'tech.mount_to_tech_mount', name: 'Mount to technical mount', group: 'G', kind: 'advance',
    from: ['pos.ground_mount_low', 'pos.ground_mount_high'],
    to: [d('pos.ground_mount_tech', 1)],
    requirements: 'the bottom turns to the side (bottom-initiated, the E4 turn)',
    durationMs: [1000, 2000], baseP: 0.90, kSkill: 0,
    tag: '[S: BJJ_POSITIONS §3.2 T6]',
  }),
  edge({
    id: 'tech.tech_mount_to_back', name: 'Technical mount to the back', group: 'G', kind: 'advance',
    from: ['pos.ground_mount_tech'],
    to: [d('pos.ground_back_hooks', 0.60), d('pos.ground_back_one_hook', 0.40)],
    toOnFailure: [d('pos.ground_mount_tech', 0.65), d('pos.ground_half_flat', 0.25, true),
      d('pos.scramble', 0.10)],
    requirements: 'seatbelt / chest-to-back; insert the hook as the bottom turns',
    durationMs: [2000, 5000], baseP: 0.65, kSkill: 3.0,
    skills: { attacker: ['bjj.back_control'], defender: ['bjj.escape'] },
    stateMods: [st('STK+')],
    counters: ['turn back into mount', 'hip escape to guard', 'stand'],
    tag: '[S: BJJ_POSITIONS §3.2 T7, §8 r25]',
    note: '+0.3 logit if the bottom chose tech.escape_mount_turn_belly.',
  }),
  edge({
    id: 'tech.crucifix_entry', name: 'Crucifix entry', group: 'G', kind: 'advance',
    from: ['pos.ground_side', 'pos.ground_turtle'],
    to: [d('pos.ground_crucifix', 1)],
    toOnFailure: [d('pos.ground_turtle', 0.5), d('pos.ground_side', 0.5)],
    requirements: { text: 'trap the near arm with the legs, control the far wrist; T3+', minTier: 3 },
    durationMs: [3000, 8000], baseP: 0.25, kSkill: 3.5,
    skills: { attacker: ['bjj.top_control'], defender: ['bjj.escape'] },
    counters: ['keep the elbows glued', 'roll through'],
    tag: '[S: BJJ_POSITIONS §3.2 T8]',
  }),
  edge({
    id: 'tech.turtle_to_back', name: 'Turtle to the back', group: 'G', kind: 'advance',
    from: ['pos.ground_turtle', 'pos.ground_referee', 'pos.ground_front_headlock'],
    to: [d('pos.ground_back_hooks', 0.55), d('pos.ground_back_one_hook', 0.30),
      d('pos.ground_back_seatbelt', 0.15)],
    toOnFailure: [d('pos.ground_turtle', 0.45), d('pos.scramble', 0.30),
      d('pos.standing_cage', 0.25, true)],
    requirements: 'seatbelt, chest on the back, spiral ride, near hook first',
    durationMs: [3000, 8000], baseP: 0.45, kSkill: 3.0,
    skills: { attacker: ['bjj.back_control', 'wr.ride'], defender: ['wr.get_up', 'bjj.escape'] },
    physicalMods: [ph('STR+')], stateMods: [st('STK+'), st('CAGE', 0.35), st('UHO')],
    counters: ['hand-fight the seatbelt', 'sit-out', 'stand', 'turtle roll to guard'],
    tag: '[S: BJJ_POSITIONS §3.2 T9]',
    note: '+0.30 logit within grap.turtleWindowMs = 3 s of the opponent entering turtle [S: BJJ_POSITIONS §8 r13].',
  }),
  edge({
    id: 'tech.ride_tight_waist', name: 'Tight-waist ride', group: 'G', kind: 'advance',
    from: ['pos.ground_turtle', 'pos.ground_referee'],
    // Per 5 s the row splits hook in 0.35 / retain 0.40 / bottom out 0.25, and
    // quotes "retains 0.70" for the first two together. The success cell is the
    // 0.35:0.40 split renormalised; 0.70 stays as the base it was quoted at
    // `[D: 0.35 + 0.40 = 0.75, quoted as 0.70]`.
    to: [d('pos.ground_back_hooks', 0.4667), d('pos.ground_referee', 0.5333)],
    toOnFailure: [d('pos.standing_close', 0.5), d('pos.scramble', 0.5)],
    requirements: 'tight waist plus the far ankle or wrist; rolled per 5 s',
    durationMs: [5000, 5000], baseP: 0.70, kSkill: 2.1,
    skills: { attacker: ['wr.ride'], defender: ['wr.get_up'] },
    physicalMods: [ph('STR+')], stateMods: [st('FOLKSTYLE', 0.42)],
    counters: ['technical stand-up', 'sit-out', 'granby', 'switch'],
    tag: '[S: WRESTLING §3.8, §9 r18]',
  }),
  edge({
    id: 'tech.ride_leg_hook', name: 'Leg-hook ride', group: 'G', kind: 'advance',
    from: ['pos.ground_turtle'],
    to: [d('pos.ground_back_hooks', 1)],
    toOnFailure: [d('pos.ground_open_kneeling_top', 0.25, true), d('pos.scramble', 0.75)],
    requirements: 'one hook in, chest on the back; rolled per 5 s',
    durationMs: [5000, 5000], baseP: 0.45, kSkill: 2.1,
    skills: { attacker: ['wr.ride'], defender: ['wr.get_up'] },
    physicalMods: [ph('FLX+')],
    counters: ['turn in', 'clear the hook', 'stand with the cage'],
    tag: '[S: WRESTLING §3.8]',
    note: 'Retains position 0.75 per 5 s when the hook-in roll fails.',
  }),
  edge({
    id: 'tech.back_body_triangle', name: 'Body triangle', group: 'G', kind: 'advance',
    from: ['pos.ground_back_hooks'],
    to: [d('pos.ground_back_body_triangle', 1)],
    requirements: { text: 'hooks in, bottom not too wide; T3+', minTier: 3 },
    durationMs: [5000, 5000], baseP: 0.60, kSkill: 2.0,
    skills: { attacker: ['bjj.back_control'], defender: ['bjj.escape'] },
    // A bottom more than 15 kg heavier costs -0.5 logit [E].
    physicalMods: [ph('FLX+'), ph('MASS-')],
    counters: ['hand fight', 'hips down'],
    tag: '[S: BJJ_POSITIONS §8 r12]',
  }),
  edge({
    id: 'tech.back_one_hook_upgrade', name: 'Second hook in', group: 'G', kind: 'advance',
    from: ['pos.ground_back_one_hook'],
    to: [d('pos.ground_back_hooks', 1)],
    requirements: 'the second hook; rolled per 5 s',
    durationMs: [5000, 5000], baseP: 0.50, kSkill: 3.0,
    skills: { attacker: ['bjj.back_control'], defender: ['bjj.escape'] },
    counters: ['clear the hook', 'hips down'],
    tag: '[S: BJJ_POSITIONS §8 r12]',
  }),
  edge({
    id: 'tech.gnp_posture', name: 'Posture up to strike', group: 'G', kind: 'gnp',
    from: TOP_GNP_NODE_IDS,
    to: [d('same', 1)],
    requirements: 'a free hand and a base',
    durationMs: [500, 1000], baseP: 0.95, kSkill: 0,
    tag: '[S: BJJ_POSITIONS §3.2 T12]',
    note: "Sets posture = 'postured': unlocks §5.1 striking and grants the bottom POST +0.40.",
  }),
  edge({
    id: 'tech.gnp_settle', name: 'Settle back down', group: 'G', kind: 'gnp',
    from: TOP_GNP_NODE_IDS,
    to: [d('same', 1)],
    requirements: 'postured',
    durationMs: [500, 500], baseP: 0.95, kSkill: 0,
    tag: '[E]',
    note: "Sets posture = 'chest'.",
  }),
  edge({
    id: 'tech.disengage_stand', name: 'Disengage and stand', group: 'G', kind: 'getup',
    from: GUARD_NODE_IDS.concat(['pos.ground_half_knee_shield']),
    to: [d('pos.ground_open_legs_up', 0.7), d('pos.standing_mid', 0.3)],
    toOnFailure: [d('pos.ground_ashi_slx', 0.5, true), d('pos.td_single_leg_in', 0.5, true)],
    requirements: 'a choice, not a contest; costs judges control credit (§06)',
    durationMs: [1000, 2000], baseP: 0.95, kSkill: 0,
    counters: ['bottom holds a leg (0.05)'],
    tag: '[S: BJJ_POSITIONS §3.2 R1]',
  }),
  edge({
    id: 'tech.knockdown_follow', name: 'Follow the knockdown', group: 'G', kind: 'advance',
    from: ['pos.ground_knockdown'],
    to: [d('pos.ground_open_legs_up', 0.45), d('pos.ground_side', 0.25),
      d('pos.ground_mount_low', 0.20), d('pos.ground_back_seatbelt', 0.10)],
    toOnFailure: [d('pos.ground_open_legs_up', 0.6, true), d('pos.standing_close', 0.4)],
    requirements: 'the attacker chooses to follow within 1,500 ms',
    durationMs: [500, 1500], baseP: 0.70, kSkill: 2.5,
    skills: { attacker: ['mma.gnp'], defender: ['bjj.retention', 'wr.get_up'] },
    physicalMods: [ph('EXP+')], stateMods: [st('RCK')],
    counters: ['referee stoppage', 'up-kick', 'guard recovery'],
    tag: '[E]; knockdown->finish conversion 65 % at UFC level [S: FIGHT_DATA §5] is the calibration target',
  }),
];

// ---------------------------------------------------------------------------
// §2.3 H — Sweeps and bottom-initiated reversals (17)
// ---------------------------------------------------------------------------

const EDGES_H: readonly GrapplingEdge[] = [
  edge({
    id: 'tech.sweep_hip_bump', name: 'Hip bump sweep', group: 'H', kind: 'sweep', actor: 'b',
    from: ['pos.ground_closed_posture_up'],
    to: [d('pos.ground_mount_low', 1, true)],
    toOnFailure: [d('pos.ground_closed_posture_up', 1)],
    requirements: 'sit up on one elbow, hip through, trap the posting arm',
    // Gi lower-belt sit-up sweep is 38 %; lower in MMA because the top posts and punches.
    durationMs: [2000, 4000], baseP: 0.25, kSkill: 2.0,
    skills: { attacker: ['bjj.sweep'], defender: ['bjj.top_control'] },
    physicalMods: [ph('STR+'), ph('MASS+')],
    stateMods: [st('FATd+'), st('POST'), st('STK-')],
    counters: ['base out', 'posture', 'punch on the sit-up'],
    tag: '[S: BJJ_POSITIONS §3.2 S1, §4]',
  }),
  edge({
    id: 'tech.sweep_scissor', name: 'Scissor sweep', group: 'H', kind: 'sweep', actor: 'b',
    from: ['pos.ground_closed_posture_broken', 'pos.ground_open_kneeling_top'],
    to: [d('pos.ground_mount_low', 1, true)],
    toOnFailure: [d('pos.ground_open_kneeling_top', 0.85), d('pos.ground_side', 0.15)],
    requirements: 'knee across the chest, wrist and head control, chop',
    durationMs: [2000, 4000], baseP: 0.20, kSkill: 2.0,
    skills: { attacker: ['bjj.sweep'], defender: ['bjj.top_control'] },
    stateMods: [st('WET', -0.30), st('STK-')],
    counters: ['post', 'knee in the middle', 'posture'],
    tag: '[S: BJJ_POSITIONS §3.2 S2] (gi lower belts 55 %)',
  }),
  edge({
    id: 'tech.sweep_flower', name: 'Flower (pendulum) sweep', group: 'H', kind: 'sweep', actor: 'b',
    from: ['pos.ground_closed_posture_broken', 'pos.ground_closed_high'],
    to: [d('pos.ground_mount_low', 1, true)],
    toOnFailure: [d('pos.ground_closed_posture_broken', 1)],
    requirements: 'underhook the leg, pendulum, control the arm',
    durationMs: [2000, 4000], baseP: 0.20, kSkill: 2.0,
    skills: { attacker: ['bjj.sweep'], defender: ['bjj.top_control'] },
    stateMods: [st('WET')],
    counters: ['base wide', 'posture', 'pull the arm free'],
    tag: '[S: BJJ_POSITIONS §3.2 S3]',
  }),
  edge({
    id: 'tech.arm_drag_back_take_bottom', name: 'Arm drag to the back from guard', group: 'H', kind: 'sweep', actor: 'b',
    from: ['pos.ground_closed_posture_broken', 'pos.ground_open_butterfly', 'pos.ground_open_seated'],
    to: [d('pos.ground_back_hooks', 0.40, true), d('pos.ground_back_seatbelt', 0.40, true),
      d('pos.ground_side', 0.20, true)],
    toOnFailure: [d('same', 0.80), d('pos.ground_side', 0.20)],
    requirements: '2-on-1 on the wrist or tricep, drag across, hip out',
    durationMs: [2000, 4000], baseP: 0.20, kSkill: 3.0,
    skills: { attacker: ['bjj.sweep', 'wr.pummel'], defender: ['bjj.top_control'] },
    stateMods: [st('WET')],
    counters: ['posture', 'elbow tight', 're-square'],
    tag: '[S: BJJ_POSITIONS §3.2 S4] (ADCC 2022: only 17 % of back takes came from guard)',
  }),
  edge({
    id: 'tech.sweep_butterfly_hook', name: 'Butterfly hook sweep', group: 'H', kind: 'sweep', actor: 'b',
    from: ['pos.ground_open_butterfly', 'pos.ground_half_butterfly'],
    to: [d('pos.ground_mount_low', 0.50, true), d('pos.ground_side', 0.30, true),
      d('pos.ground_half_flat', 0.20, true)],
    toOnFailure: [d('pos.ground_half_flat', 0.7), d('pos.scramble', 0.3)],
    requirements: 'underhook plus overhook or wrist, chest-to-chest, elevate with the hook',
    durationMs: [2000, 4000], baseP: 0.35, kSkill: 3.0,
    skills: { attacker: ['bjj.sweep'], defender: ['bjj.top_control'] },
    physicalMods: [ph('STR+'), ph('MASS+')], stateMods: [st('STK-')],
    counters: ['sprawl the leg', 'post', 'body lock', 'head pressure'],
    tag: '[S: BJJ_POSITIONS §3.2 S5]',
  }),
  edge({
    id: 'tech.entry_x_slx', name: 'Entry to X / SLX', group: 'H', kind: 'sweep', actor: 'b',
    from: ['pos.ground_open_seated', 'pos.ground_open_butterfly', 'pos.ground_open_legs_up'],
    to: [d('pos.ground_open_x', 0.5), d('pos.ground_ashi_slx', 0.5)],
    toOnFailure: [d('same', 0.7), d('pos.ground_open_legs_up', 0.3)],
    requirements: 'shin-to-shin or a hook behind the knee',
    durationMs: [1500, 3000], baseP: 0.30, kSkill: 3.0,
    skills: { attacker: ['bjj.leg_entangle'], defender: ['bjj.retention'] },
    physicalMods: [ph('FLX+')], stateMods: [st('WET'), st('STK-')],
    counters: ['knee down', 'posture', 'punch down'],
    tag: '[S: BJJ_POSITIONS §3.2 S6] (entry 30 %)',
  }),
  edge({
    id: 'tech.sweep_x_slx', name: 'X / SLX sweep', group: 'H', kind: 'sweep', actor: 'b',
    from: ['pos.ground_open_x', 'pos.ground_ashi_slx'],
    to: [d('pos.ground_open_legs_up', 0.60, true), d('pos.ground_side', 0.20, true),
      d('pos.scramble', 0.20)],
    toOnFailure: [d('pos.ground_open_legs_up', 0.70), d('pos.ground_side', 0.30)],
    requirements: 'hooks behind the knee, off-balance',
    durationMs: [2000, 5000], baseP: 0.45, kSkill: 3.0,
    skills: { attacker: ['bjj.sweep', 'bjj.leg_entangle'], defender: ['bjj.top_control'] },
    stateMods: [st('WET'), st('STK-')],
    counters: ['free the trapped leg', 'posture', 'punch down'],
    tag: '[S: BJJ_POSITIONS §3.2 S6] (gi lower belts 63 %)',
  }),
  edge({
    id: 'tech.k_guard_entry', name: 'K-guard entry', group: 'H', kind: 'sweep', actor: 'b',
    from: ['pos.ground_open_k'],
    to: [d('pos.ground_ashi_slx', 0.30), d('pos.ground_5050', 0.20), d('pos.ground_saddle', 0.20),
      d('pos.ground_back_hooks', 0.30, true)],
    toOnFailure: [d('pos.ground_half_flat', 0.40), d('same', 0.60)],
    requirements: { text: 'knee across the hip, grip behind the knee, invert; T3+ only', minTier: 3 },
    durationMs: [2000, 5000], baseP: 0.30, kSkill: 3.5,
    skills: { attacker: ['bjj.leg_entangle'], defender: ['bjj.retention', 'mma.gnp'] },
    physicalMods: [ph('FLX+')], stateMods: [st('STK--')],
    counters: ['body lock', 'sprawl', 'punch the exposed head'],
    tag: '[S: BJJ_POSITIONS §3.2 S7]',
  }),
  edge({
    id: 'tech.sweep_deep_half', name: 'Deep half sweep', group: 'H', kind: 'sweep', actor: 'b',
    from: ['pos.ground_half_deep'],
    to: [d('pos.ground_half_flat', 0.40, true), d('pos.ground_side', 0.30, true),
      d('pos.ground_back_hooks', 0.30, true)],
    toOnFailure: [d('pos.ground_half_deep', 0.8), d('pos.ground_side', 0.2)],
    requirements: 'under the hips, hug the leg, off-balance',
    durationMs: [3000, 6000], baseP: 0.40, kSkill: 3.0,
    skills: { attacker: ['bjj.sweep'], defender: ['bjj.top_control'] },
    physicalMods: [ph('STR+')], stateMods: [st('STK-')],
    counters: ['cross-face', 'sit back on the hips', 'kimura (0.05)'],
    tag: '[S: BJJ_POSITIONS §3.2 S8]',
  }),
  edge({
    id: 'tech.dogfight_entry', name: 'Dogfight entry', group: 'H', kind: 'sweep', actor: 'b',
    from: ['pos.ground_half_underhook'],
    to: [d('pos.ground_half_dogfight', 1)],
    toOnFailure: [d('pos.ground_half_flat', 1)],
    requirements: 'underhook, get to the knees, head outside',
    durationMs: [2000, 4000], baseP: 0.45, kSkill: 3.0,
    skills: { attacker: ['bjj.sweep', 'wr.get_up'], defender: ['bjj.top_control'] },
    physicalMods: [ph('STR++')], stateMods: [st('FAT-'), st('CAGE', 0.35)],
    counters: ['whizzer', 'cross-face'],
    tag: '[S: BJJ_POSITIONS §3.2 S9]',
  }),
  edge({
    id: 'tech.dogfight_resolve', name: 'Dogfight resolution', group: 'H', kind: 'scramble', actor: 'b',
    from: ['pos.ground_half_dogfight'],
    // Underhook side wins 0.55.
    to: [d('pos.ground_back_hooks', 0.35, true), d('pos.ground_side', 0.40, true),
      d('pos.ground_side', 0.25, true)],
    toOnFailure: [d('pos.ground_side', 0.55), d('pos.ground_side_kesa', 0.20),
      d('pos.clinch_front_headlock', 0.25)],
    requirements: 'drive versus whizzer plus hip switch',
    durationMs: [2000, 6000], baseP: 0.55, kSkill: 3.0,
    skills: { attacker: ['wr.scramble', 'bjj.sweep'], defender: ['wr.sprawl', 'bjj.top_control'] },
    physicalMods: [ph('STR++')], stateMods: [st('FAT-'), st('CAGE', 0.35)],
    counters: ['limp arm', 'hip switch'],
    tag: '[S: BJJ_POSITIONS §3.2 S9]',
  }),
  edge({
    id: 'tech.lockdown_whip_up', name: 'Lockdown whip-up', group: 'H', kind: 'sweep', actor: 'b',
    from: ['pos.ground_half_lockdown'],
    to: [d('pos.ground_half_dogfight', 0.45), d('pos.ground_half_flat', 0.30, true),
      subEntry('sub.electric_chair', 0.25)],
    toOnFailure: [d('pos.ground_half_flat', 0.90), d('pos.ground_side', 0.10)],
    requirements: 'lockdown established, underhook or double underhooks',
    durationMs: [4000, 10000], baseP: 0.30, kSkill: 3.0,
    skills: { attacker: ['bjj.sweep'], defender: ['bjj.top_control'] },
    physicalMods: [ph('STR+')], stateMods: [st('STK-')],
    counters: ['free the leg by hip-switching', 'posture', 'elbows'],
    tag: '[S: BJJ_POSITIONS §3.2 S10]',
  }),
  edge({
    id: 'tech.knee_shield_wrestle_up', name: 'Knee-shield wrestle-up', group: 'H', kind: 'getup', actor: 'b',
    from: ['pos.ground_half_knee_shield'],
    to: [d('pos.td_single_leg_in', 0.50, true), d('pos.scramble', 0.30), d('pos.ground_side', 0.20)],
    toOnFailure: [d('pos.ground_half_flat', 0.50), d('pos.ground_turtle', 0.25), d('same', 0.25)],
    requirements: 'frame and knee shield to make space, post a hand, come up on the leg',
    durationMs: [3000, 8000], baseP: 0.40, kSkill: 3.0,
    skills: { attacker: ['wr.get_up', 'bjj.sweep'], defender: ['bjj.top_control', 'wr.sprawl'] },
    physicalMods: [ph('STR+')],
    // "++" wall-walk fusion.
    stateMods: [st('CAGE', 0.70), st('FATd+')],
    counters: ['snap down to a front headlock', 'cross-face', 'knee-cut through the shield'],
    tag: '[S: BJJ_POSITIONS §3.2 S11]',
  }),
  edge({
    id: 'tech.rubber_guard_sweep', name: 'Rubber guard (omoplata) sweep', group: 'H', kind: 'sweep', actor: 'b',
    from: ['pos.ground_closed_rubber'],
    to: [d('pos.ground_side', 0.6, true), d('pos.ground_mount_low', 0.4, true)],
    toOnFailure: [d('pos.ground_closed_posture_broken', 1)],
    requirements: 'flexibility; mission control established',
    durationMs: [3000, 8000], baseP: 0.20, kSkill: 3.0,
    skills: { attacker: ['bjj.sweep'], defender: ['bjj.top_control'] },
    physicalMods: [ph('FLX++')],
    counters: ['posture', 'stack', 'punch over the top'],
    tag: '[S: BJJ_POSITIONS §3.2 S12]',
  }),
  edge({
    id: 'tech.upkick_push_stand', name: 'Up-kick, push and stand', group: 'H', kind: 'getup', actor: 'b',
    from: ['pos.ground_open_legs_up'],
    to: [d('pos.standing_mid', 1)],
    toOnFailure: [d('pos.ground_open_kneeling_top', 0.5), d('pos.ground_hq', 0.5)],
    requirements: 'feet on the hips, push and hip-escape, post a hand',
    // BJJGraph community model 75/15/10, lowered for MMA.
    durationMs: [2000, 5000], baseP: 0.55, kSkill: 2.0,
    skills: { attacker: ['wr.get_up', 'bjj.retention'], defender: ['mma.gnp'] },
    stateMods: [st('FAT-'), st('STK-')],
    counters: ['top backs off', 'top dives with punches (risks the up-kick)'],
    tag: '[S: BJJ_POSITIONS §3.2 S13]',
    note: 'Up-kicks land 0.15-0.25 with KO < 2 % [S: MMA_INTEGRATION I-17].',
  }),
  edge({
    id: 'tech.bridge_roll_kesa_side', name: 'Bridge roll from kesa / side', group: 'H', kind: 'escape', actor: 'b',
    from: ['pos.ground_side_kesa', 'pos.ground_side'],
    to: [d('pos.ground_side', 1, true)],
    toOnFailure: [d('same', 1)],
    requirements: "leg hook on the top's trapped leg, bridge over the shoulder",
    durationMs: [2000, 4000], baseP: 0.15, kSkill: 2.0,
    skills: { attacker: ['bjj.escape'], defender: ['bjj.top_control'] },
    physicalMods: [ph('STR++'), ph('MASS++')],
    stateMods: [st('POST')],
    counters: ['base wide', 'free the leg'],
    tag: '[S: BJJ_POSITIONS §3.2 S14, §4]',
  }),
  edge({
    id: 'tech.sweep_on_strike', name: 'Sweep on the strike (wrapper)', group: 'H', kind: 'sweep', actor: 'b',
    from: GUARD_NODE_IDS.concat(['pos.ground_half_flat', 'pos.ground_half_knee_shield',
      'pos.ground_mount_low', 'pos.ground_side']),
    to: [d('pos.ground_mount_low', 0.4, true), d('pos.ground_side', 0.3, true),
      d('pos.ground_closed_posture_up', 0.3, true)],
    toOnFailure: [d('same', 1)],
    requirements: {
      text: "top posture = 'postured' with a strike in flight",
      needsPosture: 'postured',
    },
    // The underlying sweep base plus POST and a +0.63 window; 0.25 is the
    // volume-weighted mean of the sweeps it wraps. Doubled against a top with
    // fatigue > 0.6 [S: MMA_INTEGRATION I-18].
    durationMs: [2000, 4000], baseP: 0.25, kSkill: 2.0,
    skills: { attacker: ['bjj.sweep'], defender: ['bjj.top_control'] },
    stateMods: [st('POST')],
    counters: ['keep the elbows in', 'base'],
    tag: '[S: MMA_INTEGRATION §2.3 I-18] (20-30 %)',
  }),
];

// ---------------------------------------------------------------------------
// §2.3 I — Escapes, bottom-initiated, not to standing (20)
// ---------------------------------------------------------------------------

const EDGES_I: readonly GrapplingEdge[] = [
  edge({
    id: 'tech.escape_mount_elbow_knee', name: 'Elbow-knee escape from mount', group: 'I', kind: 'escape', actor: 'b',
    from: ['pos.ground_mount_low'],
    to: [d('pos.ground_half_flat', 0.70), d('pos.ground_half_knee_shield', 0.20),
      d('pos.ground_closed_posture_up', 0.10)],
    toOnFailure: [d('pos.ground_mount_low', 0.70), d('pos.ground_mount_high', 0.30)],
    requirements: 'elbows inside, bridge to make space, shrimp, insert the knee',
    // 0.12 from high mount or S-mount.
    durationMs: [3000, 8000], baseP: 0.30, kSkill: 3.0,
    skills: { attacker: ['bjj.escape'], defender: ['bjj.top_control'] },
    physicalMods: [ph('STR+'), ph('MASS-')],
    stateMods: [st('FAT--'), st('STK-'), st('POST')],
    counters: ['grapevines', 'high mount', 'cross-face', 'punch when the elbow drops'],
    tag: '[S: BJJ_POSITIONS §3.2 E1, §4]',
  }),
  edge({
    id: 'tech.escape_mount_upa', name: 'Upa (bridge and roll)', group: 'I', kind: 'escape', actor: 'b',
    from: ['pos.ground_mount_low', 'pos.ground_mount_high'],
    to: [d('pos.ground_closed_posture_up', 1, true)],
    toOnFailure: [d('pos.ground_mount_low', 0.30), d('pos.ground_mount_high', 0.40),
      d('same', 0.30)],
    requirements: 'trap one arm and the same-side foot, bridge diagonally',
    // 0.35 when the top has just posted to punch.
    durationMs: [2000, 4000], baseP: 0.20, kSkill: 2.0,
    skills: { attacker: ['bjj.escape'], defender: ['bjj.top_control'] },
    physicalMods: [ph('STR++'), ph('MASS++')],
    // +0.85 [D: +20 pp] when the top is postured in low mount, +0.63 in high mount.
    stateMods: [st('POST')],
    counters: ['post the free hand wide', 'spread the knees', 'armbar the pushing arm (0.05)'],
    tag: '[S: BJJ_POSITIONS §3.2 E2, §4]',
  }),
  edge({
    id: 'tech.escape_mount_kip', name: 'Kip escape from mount', group: 'I', kind: 'escape', actor: 'b',
    from: ['pos.ground_mount_high', 'pos.ground_mount_s'],
    to: [d('pos.ground_half_flat', 0.6), d('pos.scramble', 0.4)],
    toOnFailure: [d('pos.ground_mount_high', 1)],
    requirements: 'explosive hip lift and turn; arms not trapped',
    // T4+ 0.25.
    durationMs: [1000, 3000], baseP: 0.15, kSkill: 3.5,
    skills: { attacker: ['bjj.escape'], defender: ['bjj.top_control'] },
    physicalMods: [ph('STR+'), ph('EXP+')], stateMods: [st('FAT--')],
    counters: ['head and arm control', 'ride the hips'],
    tag: '[S: BJJ_POSITIONS §3.2 E3]',
  }),
  edge({
    id: 'tech.escape_mount_turn_belly', name: 'Turn to the belly (give the back)', group: 'I', kind: 'escape', actor: 'b',
    from: ['pos.ground_mount_high', 'pos.ground_mount_low', 'pos.ground_mount_s'],
    // Intent is the turtle; the usual outcome is technical mount or the back.
    to: [d('pos.ground_mount_tech', 0.40), d('pos.ground_back_hooks', 0.30),
      d('pos.ground_turtle', 0.30)],
    toOnFailure: [d('same', 1)],
    requirements: 'none (damage-avoidance behaviour)',
    durationMs: [1000, 2000], baseP: 0.90, kSkill: 0,
    counters: ['top follows to technical mount or the back'],
    tag: '[S: BJJ_POSITIONS §3.2 E4, §8 r25]',
    note: 'Grants the top +0.3 logit on tech.tech_mount_to_back.',
  }),
  edge({
    id: 'tech.escape_side_frames_shrimp', name: 'Frame and shrimp from side', group: 'I', kind: 'escape', actor: 'b',
    from: ['pos.ground_side'],
    to: [d('pos.ground_half_flat', 0.50), d('pos.ground_half_knee_shield', 0.30),
      d('pos.ground_closed_posture_up', 0.20)],
    toOnFailure: [d('pos.ground_side', 0.80), d('pos.ground_mount_low', 0.15),
      d('pos.ground_side_kob', 0.05)],
    requirements: 'forearm in the neck, hand on the hip, bridge, shrimp',
    durationMs: [3000, 8000], baseP: 0.30, kSkill: 3.0,
    skills: { attacker: ['bjj.escape'], defender: ['bjj.top_control'] },
    physicalMods: [ph('STR+')],
    // The wall stops the shrimp: this is one of the few negative cage terms.
    stateMods: [st('FAT--'), st('CAGE', -0.35), st('STK-'), st('POST')],
    counters: ['cross-face', 'hip block', 'switch to KOB or N-S', 'knee-cut mount'],
    tag: '[S: BJJ_POSITIONS §3.2 E5, §4]',
  }),
  edge({
    id: 'tech.escape_side_underhook_turn', name: 'Underhook and turn from side', group: 'I', kind: 'escape', actor: 'b',
    from: ['pos.ground_side', 'pos.ground_side_kesa', 'pos.ground_north_south'],
    to: [d('pos.ground_turtle', 0.50), d('pos.ground_half_dogfight', 0.30),
      d('pos.ground_wall_walk', 0.20)],
    toOnFailure: [d('pos.ground_side', 0.65), d('pos.ground_back_seatbelt', 0.25),
      d('same', 0.10)],
    requirements: 'near-side underhook, bridge, turn to the knees',
    durationMs: [2000, 5000], baseP: 0.30, kSkill: 3.0,
    skills: { attacker: ['bjj.escape', 'wr.get_up'], defender: ['bjj.top_control'] },
    physicalMods: [ph('STR+')],
    stateMods: [st('CAGE', 0.70), st('STK+'), st('POST')],
    counters: ['front-headlock chokes', 'seatbelt / back take', 'flatten'],
    tag: '[S: BJJ_POSITIONS §3.2 E6, §4]',
    note: 'STK+ helps the turn because the bottom turns to escape punches, at a damage cost.',
  }),
  edge({
    id: 'tech.escape_granby', name: 'Granby roll', group: 'I', kind: 'escape', actor: 'b',
    from: ['pos.ground_side', 'pos.ground_turtle', 'pos.ground_north_south'],
    to: [d('pos.ground_open_kneeling_top', 0.50), d('pos.ground_half_knee_shield', 0.25),
      d('pos.standing_close', 0.15), d('pos.scramble', 0.10)],
    toOnFailure: [d('same', 0.8), d('pos.ground_back_hooks', 0.2)],
    requirements: 'shoulder roll along the mat; needs space; T4+ resolves at 0.30',
    durationMs: [1000, 3000], baseP: 0.15, kSkill: 3.5,
    skills: { attacker: ['bjj.escape', 'wr.scramble'], defender: ['bjj.top_control'] },
    physicalMods: [ph('FLX+'), ph('MASS--')],
    counters: ['weight on the hips and shoulders', 'crucifix if the arm is exposed'],
    tag: '[S: BJJ_POSITIONS §3.2 E7] [S: WRESTLING §3.9]',
  }),
  edge({
    id: 'tech.escape_kob', name: 'Escape knee on belly', group: 'I', kind: 'escape', actor: 'b',
    from: ['pos.ground_side_kob'],
    to: [d('pos.ground_half_flat', 0.60), d('pos.ground_open_kneeling_top', 0.40)],
    toOnFailure: [d('pos.ground_side_kob', 0.6), d('pos.ground_mount_low', 0.4)],
    requirements: 'push the knee, shrimp, turn in',
    durationMs: [2000, 4000], baseP: 0.40, kSkill: 2.0,
    skills: { attacker: ['bjj.escape'], defender: ['bjj.top_control'] },
    physicalMods: [ph('STR+')],
    stateMods: [st('STK-'), st('POST')],
    counters: ['follow the hips', 'punch', 'switch sides', 'armbar the pushing arm (0.10)'],
    tag: '[S: BJJ_POSITIONS §3.2 E8, §4]',
  }),
  edge({
    id: 'tech.escape_north_south', name: 'Escape north-south', group: 'I', kind: 'escape', actor: 'b',
    from: ['pos.ground_north_south'],
    to: [d('pos.ground_turtle', 0.50), d('pos.ground_half_flat', 0.25),
      d('pos.ground_open_kneeling_top', 0.25)],
    toOnFailure: [d('pos.ground_north_south', 1)],
    requirements: 'hands on the hips, hip escape, roll to the knees',
    durationMs: [3000, 6000], baseP: 0.25, kSkill: 3.0,
    skills: { attacker: ['bjj.escape'], defender: ['bjj.top_control'] },
    physicalMods: [ph('STR+')], stateMods: [st('FAT-'), st('POST')],
    counters: ['weight on the chest', 'arm control', 'knees to the body', 'N-S choke or kimura (0.10)'],
    tag: '[S: BJJ_POSITIONS §3.2 E9, §4]',
  }),
  edge({
    id: 'tech.escape_back_hand_fight', name: 'Hand fight from the back', group: 'I', kind: 'escape', actor: 'b',
    from: ['pos.ground_back_hooks', 'pos.ground_back_one_hook', 'pos.ground_back_body_triangle'],
    to: [d('same', 1)], toOnFailure: [d('same', 1)],
    requirements: '2-on-1 on the choking hand, chin tucked',
    durationMs: [3000, 3000], baseP: 0.50, kSkill: 3.0,
    skills: { attacker: ['bjj.escape'], defender: ['bjj.back_control'] },
    physicalMods: [ph('STR+')],
    // Slippery helps the bottom here, so WET flips sign.
    stateMods: [st('FAT-'), st('WET+'), st('STK+', 0.42)],
    counters: ['straitjacket', 'seatbelt switch'],
    tag: '[S: BJJ_POSITIONS §8 r24, §4]',
    note: 'Sets handFightWon for 5 s, the prerequisite for tech.escape_back; three losses in a row give §04 an sub.rnc attempt at +0.3 logit.',
  }),
  edge({
    id: 'tech.escape_back', name: 'Escape the back', group: 'I', kind: 'escape', actor: 'b',
    from: ['pos.ground_back_hooks', 'pos.ground_back_one_hook'],
    to: [d('pos.ground_half_flat', 0.40), d('pos.ground_closed_posture_up', 0.20),
      d('pos.ground_side', 0.40)],
    toOnFailure: [d('pos.ground_back_hooks', 0.80), d('pos.ground_back_body_triangle', 0.20)],
    requirements: 'hand fight won; shoulders to the mat on the choking-arm side, clear the top hook',
    // 0.15 from hooks, 0.35 from one hook (anchored to elite back-take -> sub
    // attempt 0.45, Lamas 2024).
    durationMs: [5000, 15000], baseP: 0.15, kSkill: 3.5,
    skills: { attacker: ['bjj.escape'], defender: ['bjj.back_control'] },
    physicalMods: [ph('MASS-')],
    stateMods: [st('FAT--'), st('WET+'), st('STK-')],
    counters: ['straitjacket', 'body triangle', 'chair sit', 'RNC secured (0.15 of fails vs T4+)'],
    tag: '[S: BJJ_POSITIONS §3.2 E10]',
  }),
  edge({
    id: 'tech.escape_back_body_triangle', name: 'Escape the body triangle', group: 'I', kind: 'escape', actor: 'b',
    from: ['pos.ground_back_body_triangle'],
    to: [d('pos.ground_back_hooks', 0.4), d('pos.ground_half_flat', 0.3), d('pos.ground_side', 0.3)],
    toOnFailure: [d('same', 1)],
    requirements: 'attack the locked ankle, turn toward the lock, slide down',
    durationMs: [10000, 25000], baseP: 0.10, kSkill: 3.5,
    skills: { attacker: ['bjj.escape'], defender: ['bjj.back_control'] },
    // A more flexible top holds the triangle better, so this is the top's own value.
    physicalMods: [ph('FLXd-')], stateMods: [st('FAT--')],
    counters: ['re-lock', 'switch sides', 'punch'],
    tag: '[S: BJJ_POSITIONS §3.2 E11]',
  }),
  edge({
    id: 'tech.escape_crucifix', name: 'Escape the crucifix', group: 'I', kind: 'escape', actor: 'b',
    from: ['pos.ground_crucifix'],
    to: [d('pos.ground_turtle', 0.5), d('pos.ground_side', 0.5)],
    toOnFailure: [d('same', 1)],
    requirements: 'pull the trapped arm out by turning the thumb, roll',
    durationMs: [5000, 15000], baseP: 0.15, kSkill: 3.0,
    skills: { attacker: ['bjj.escape'], defender: ['bjj.top_control'] },
    physicalMods: [ph('STR+')],
    counters: ['keep the leg lock on the arm', 'strike'],
    tag: '[S: BJJ_POSITIONS §3.2 E13]',
  }),
  edge({
    id: 'tech.escape_kesa', name: 'Escape kesa gatame', group: 'I', kind: 'escape', actor: 'b',
    from: ['pos.ground_side_kesa'],
    to: [d('pos.ground_half_flat', 0.50), d('pos.ground_side', 0.20, true),
      d('pos.ground_turtle', 0.30)],
    toOnFailure: [d('pos.ground_side_kesa', 0.7), d('pos.ground_mount_low', 0.3)],
    requirements: 'trap the near leg or frame under the jaw',
    durationMs: [3000, 8000], baseP: 0.25, kSkill: 2.0,
    skills: { attacker: ['bjj.escape'], defender: ['bjj.top_control'] },
    physicalMods: [ph('STR++'), ph('MASS++')],
    counters: ['hips low', 'control the arm', 'switch to mount'],
    tag: '[S: BJJ_POSITIONS §3.2 E16]',
  }),
  edge({
    id: 'tech.escape_half_recover', name: 'Recover from flat half guard', group: 'I', kind: 'escape', actor: 'b',
    from: ['pos.ground_half_flat'],
    to: [d('pos.ground_half_knee_shield', 0.55), d('pos.ground_half_underhook', 0.45)],
    toOnFailure: [d('pos.ground_half_flat', 0.85), d('pos.ground_side', 0.15)],
    requirements: 'frame the cross-face, shrimp, insert the knee or swim the underhook',
    durationMs: [3000, 8000], baseP: 0.30, kSkill: 3.0,
    skills: { attacker: ['bjj.retention'], defender: ['bjj.top_control'] },
    physicalMods: [ph('STR+')],
    stateMods: [st('FAT-'), st('STK-'), st('POST')],
    counters: ['cross-face', 'shoulder pressure', 'whizzer'],
    tag: '[S: BJJ_POSITIONS §5.2] (E-recovery 30 %)',
  }),
  edge({
    id: 'tech.guard_retention', name: 'Guard retention', group: 'I', kind: 'escape', actor: 'b',
    from: GUARD_NODE_IDS.concat(['pos.ground_half_flat', 'pos.ground_half_knee_shield']),
    to: [d('pos.ground_half_knee_shield', 0.5), d('pos.ground_open_kneeling_top', 0.5)],
    toOnFailure: [d('same', 1)],
    requirements: 'hip mobility and frames; fires implicitly on every failed pass',
    // Inherent in the pass failure rates; 0.30 mirrors E-recovery so the edge
    // can also be attempted explicitly by the AI.
    durationMs: [1000, 3000], baseP: 0.30, kSkill: 3.0,
    skills: { attacker: ['bjj.retention'], defender: ['bjj.pass'] },
    stateMods: [st('STK-')],
    tag: '[S: BJJ_POSITIONS §3.2 E15, §8 r23]',
    note: 'Retention loses -0.10 logit per 5 % of the ground-damage pool (§05).',
  }),
  edge({
    id: 'tech.turtle_sit_out_peek', name: 'Sit-out / peek-out from turtle', group: 'I', kind: 'escape', actor: 'b',
    from: ['pos.ground_turtle', 'pos.ground_front_headlock', 'pos.ground_referee'],
    to: [d('pos.standing_close', 0.35), d('pos.scramble', 0.30),
      d('pos.ground_half_knee_shield', 0.20), d('pos.ground_side', 0.15, true)],
    toOnFailure: [d('pos.ground_turtle', 0.60), d('pos.ground_back_hooks', 0.30),
      d('pos.clinch_front_headlock', 0.10)],
    requirements: 'hand-fight the seatbelt, head up, hip heist or sit-out',
    // 0.45 against the cage with a wall walk.
    durationMs: [2000, 5000], baseP: 0.35, kSkill: 3.0,
    skills: { attacker: ['wr.scramble', 'wr.get_up'], defender: ['wr.ride'] },
    physicalMods: [ph('STR+')],
    stateMods: [st('CAGE', 0.70), st('FAT--'), st('POST')],
    counters: ['spiral ride', 'hooks', 'chin strap'],
    tag: '[S: BJJ_POSITIONS §3.2 E14, §4] [S: WRESTLING §3.9]',
  }),
  edge({
    id: 'tech.turtle_switch', name: 'Switch from turtle', group: 'I', kind: 'escape', actor: 'b',
    from: ['pos.ground_turtle', 'pos.ground_referee'],
    to: [d('pos.ground_turtle', 1, true)],
    toOnFailure: [d('same', 1)],
    requirements: "the top's arm around the waist",
    // 0.40 against a T0-T1; k rises to 3.0 for "++" scramblers.
    durationMs: [700, 700], baseP: 0.20, kSkill: 2.1,
    skills: { attacker: ['wr.scramble'], defender: ['wr.ride'] },
    counters: ['hips away', 'drop the arm'],
    tag: '[S: WRESTLING §3.9]',
  }),
  edge({
    id: 'tech.turtle_roll_to_guard', name: 'Turtle roll to guard', group: 'I', kind: 'escape', actor: 'b',
    from: ['pos.ground_turtle'],
    to: [d('pos.ground_open_kneeling_top', 1)],
    toOnFailure: [d('pos.ground_turtle', 0.9), d('pos.ground_back_hooks', 0.1)],
    requirements: 'space, no hooks',
    durationMs: [700, 700], baseP: 0.30, kSkill: 3.0,
    skills: { attacker: ['wr.scramble', 'bjj.retention'], defender: ['wr.ride'] },
    physicalMods: [ph('FLX+')],
    counters: ['hooks in', 'chest pressure'],
    tag: '[S: WRESTLING §3.9] (granby)',
  }),
  edge({
    id: 'tech.funk_roll', name: 'Funk roll', group: 'I', kind: 'scramble', actor: 'b',
    from: ['pos.td_single_leg_in', 'pos.scramble'],
    to: [d('pos.ground_turtle', 0.6, true), d('pos.ground_back_hooks', 0.4, true)],
    toOnFailure: [d('pos.ground_open_kneeling_top', 1)],
    requirements: "whizzer plus the attacker's head outside; funk trait",
    // 0.45 when wr.scramble >= 70.
    durationMs: [1000, 2000], baseP: 0.25, kSkill: 3.0,
    skills: { attacker: ['wr.scramble'], defender: ['wr.finish'] },
    physicalMods: [ph('FLX+')],
    counters: ['keep the head inside', 'finish fast', 'run the pipe'],
    tag: '[S: WRESTLING §3.9]',
    note: 'The funk trait adds +10 to the §L scramble score.',
  }),
];

// ---------------------------------------------------------------------------
// §2.3 J — Get-ups, bottom to standing (7)
// ---------------------------------------------------------------------------

const EDGES_J: readonly GrapplingEdge[] = [
  edge({
    id: 'tech.technical_standup', name: 'Technical stand-up', group: 'J', kind: 'getup', actor: 'b',
    from: ['pos.ground_open_legs_up', 'pos.ground_open_seated', 'pos.ground_open_butterfly'],
    to: [d('pos.standing_mid', 1)],
    toOnFailure: [d('pos.ground_hq', 0.40), d('pos.ground_open_legs_up', 0.40),
      d('pos.ground_front_headlock', 0.10), d('pos.td_sprawl', 0.10)],
    requirements: 'post a hand, lead knee up, hip lift, retreat the leg',
    // 0.55 against an engaged opponent, 0.90 against a disengaged one; 0.25 per
    // attempt from guard bottom nodes generally [S: WRESTLING §3.8].
    durationMs: [1500, 3000], baseP: 0.55, kSkill: 2.0,
    skills: { attacker: ['wr.get_up'], defender: ['mma.gnp', 'bjj.top_control'] },
    physicalMods: [ph('MASS+', 0.21)],
    stateMods: [st('FAT-'), st('STK-'), st('FATd+', 0.42)],
    counters: ['re-engage with punches', 'snap down', 'chase into the fence'],
    tag: '[S: BJJ_POSITIONS §3.2 G1] [S: WRESTLING §3.8, §9 r17]',
    note: 'A failed attempt gives the top a free strike tick or a back-take roll at 0.15.',
  }),
  edge({
    id: 'tech.wrestle_up', name: 'Wrestle up', group: 'J', kind: 'getup', actor: 'b',
    from: ['pos.ground_open_butterfly', 'pos.ground_half_knee_shield',
      'pos.ground_half_underhook', 'pos.ground_half_dogfight'],
    to: [d('pos.td_single_leg_in', 0.60, true), d('pos.standing_close', 0.25),
      d('pos.ground_side', 0.15, true)],
    toOnFailure: [d('pos.ground_half_flat', 0.50), d('pos.ground_turtle', 0.30),
      d('pos.ground_front_headlock', 0.20)],
    requirements: 'underhook or wrist and head control, base on one knee, drive',
    // T4+ 0.55.
    durationMs: [3000, 8000], baseP: 0.40, kSkill: 3.0,
    skills: { attacker: ['wr.get_up'], defender: ['wr.sprawl', 'bjj.top_control'] },
    physicalMods: [ph('STR++')],
    stateMods: [st('CAGE', 0.35), st('FAT--')],
    counters: ['sprawl', 'whizzer', 'snap down', 'cross-face'],
    tag: '[S: BJJ_POSITIONS §3.2 G3]',
  }),
  edge({
    id: 'tech.standup_from_closed_guard', name: 'Stand up from closed guard', group: 'J', kind: 'getup', actor: 'b',
    from: ['pos.ground_closed_posture_up'],
    to: [d('pos.ground_open_legs_up', 1)],
    toOnFailure: [d('pos.ground_half_flat', 0.40), d('same', 0.60)],
    requirements: 'frames on the hips, open the guard, foot on the hip',
    // 0.35 to reach the technical-standup chain; 0.20 compound.
    durationMs: [3000, 6000], baseP: 0.35, kSkill: 2.0,
    skills: { attacker: ['wr.get_up', 'bjj.retention'], defender: ['bjj.top_control'] },
    stateMods: [st('STK-'), st('FAT-')],
    counters: ['top drops weight', 'top passes when the guard opens'],
    tag: '[S: BJJ_POSITIONS §3.2 G4, §5.2]',
  }),
  edge({
    id: 'tech.stand_from_turtle', name: 'Stand up from turtle', group: 'J', kind: 'getup', actor: 'b',
    from: ['pos.ground_turtle', 'pos.ground_referee'],
    to: [d('pos.standing_cage', 0.60), d('pos.standing_close', 0.40)],
    toOnFailure: [d('pos.ground_turtle', 0.7), d('pos.ground_back_hooks', 0.3)],
    requirements: 'hand control on the seatbelt hands, head up, walk the feet in',
    // 0.35 open mat, 0.45 on the wall; WRESTLING's turtle-with-cage reach-feet is 0.50.
    durationMs: [2000, 5000], baseP: 0.35, kSkill: 3.0,
    skills: { attacker: ['wr.get_up'], defender: ['wr.ride'] },
    physicalMods: [ph('STR+')], stateMods: [st('CAGE', 0.70)],
    counters: ['hooks', 'mat return', 'seatbelt'],
    tag: '[S: BJJ_POSITIONS §3.2 G5] [S: WRESTLING §3.8]',
    note: 'With the cage, 0.60 of successes leave the top on pos.clinch_body_lock_rear.',
  }),
  edge({
    id: 'tech.stand_after_back_escape', name: 'Stand after the back escape', group: 'J', kind: 'getup', actor: 'b',
    from: ['pos.ground_back_one_hook', 'pos.ground_back_seatbelt'],
    to: [d('pos.clinch_body_lock_rear', 0.6), d('pos.standing_close', 0.4)],
    toOnFailure: [d('pos.ground_back_hooks', 1)],
    requirements: 'clear the hook, base on the far foot',
    durationMs: [3000, 6000], baseP: 0.35, kSkill: 3.0,
    skills: { attacker: ['wr.get_up'], defender: ['bjj.back_control'] },
    physicalMods: [ph('STR+')], stateMods: [st('CAGE', 0.70)],
    counters: ['re-hook', 'body triangle'],
    tag: '[S: BJJ_POSITIONS §3.2 G6]',
  }),
  edge({
    id: 'tech.kimura_grip_standup', name: 'Kimura-grip stand-up', group: 'J', kind: 'getup', actor: 'b',
    from: ['pos.ground_half_flat', 'pos.ground_closed_posture_up', 'pos.ground_half_knee_shield'],
    to: [d('pos.ground_wall_walk', 0.65), d('pos.ground_turtle', 0.15, true),
      subEntry('sub.kimura', 0.20)],
    toOnFailure: [d('same', 1)],
    requirements: "kimura grip on the top's far arm",
    durationMs: [2000, 3000], baseP: 0.35, kSkill: 3.0,
    skills: { attacker: ['bjj.sweep', 'wr.get_up'], defender: ['bjj.top_control'] },
    physicalMods: [ph('STR+')], stateMods: [st('CAGE', 0.35)],
    counters: ['hand posts', 'hide the arm', 'elbow tight'],
    tag: '[S: WRESTLING §3.8]',
  }),
  edge({
    id: 'tech.hip_in_technical_standup_open', name: 'Hip-in technical stand-up', group: 'J', kind: 'getup', actor: 'b',
    from: ['pos.ground_open_kneeling_top', 'pos.ground_half_flat', 'pos.ground_half_knee_shield',
      'pos.ground_half_underhook'],
    to: [d('pos.standing_close', 1)],
    toOnFailure: [d('same', 1)],
    requirements: {
      text: "frames set, top posture = 'postured'", needsPosture: 'postured',
    },
    durationMs: [2000, 4000], baseP: 0.30, kSkill: 2.5,
    skills: { attacker: ['wr.get_up'], defender: ['mma.gnp'] },
    stateMods: [st('POST'), st('FAT-')],
    counters: ['stay chest-to-chest', 'wrist control', 'ground and pound'],
    tag: '[S: MMA_INTEGRATION §2.3 I-15] (25-40 %)',
  }),
  // Realism pass: the *top* man's way off the floor. The graph had every
  // bottom exit and no top one, so a striker who sprawled on a shot or landed
  // on top by accident could only advance — spin behind, take the back — and
  // strikers ended up controlling wrestlers (3.1 min per 15 in the style
  // matrix). In MMA the man on top can nearly always stand and walk away:
  // "stuff, punish, reset to distance" is the sprawl-and-brawl game
  // [S: MMA_INTEGRATION §2 I-20, §3 S-6; WRESTLING §3.7 "sprawl -> both
  // stand"]. Closed guard holds him (legs locked) more than an open guard.
  edge({
    id: 'tech.sprawl_reset', name: 'Sprawl and reset', group: 'J', kind: 'getup', actor: 'a',
    from: ['pos.td_sprawl', 'pos.ground_front_headlock'],
    to: [d('pos.standing_mid', 1)],
    toOnFailure: [d('same', 1)],
    requirements: 'hips back, hands on the head, step back out',
    durationMs: [500, 800], baseP: 0.85, kSkill: 0.5,
    skills: { attacker: ['wr.sprawl'], defender: ['wr.scramble'] },
    stateMods: [st('FAT-')],
    counters: ['re-shot as he steps back', 'hand fight to the legs'],
    tag: '[S: WRESTLING §3.7 sprawl -> stand; MMA_INTEGRATION I-20] [E: baseP 0.85]',
  }),
  edge({
    id: 'tech.top_stand_away', name: 'Stand up out of the guard', group: 'J', kind: 'getup', actor: 'a',
    from: ['pos.ground_open_kneeling_top', 'pos.ground_open_legs_up', 'pos.ground_open_butterfly',
      'pos.ground_open_seated', 'pos.ground_hq', 'pos.ground_half_knee_shield', 'pos.ground_half_butterfly',
      'pos.ground_closed_posture_up', 'pos.ground_closed_top_standing'],
    to: [d('pos.standing_mid', 1)],
    toOnFailure: [d('same', 1)],
    requirements: { text: "postured; top posture = 'postured'", needsPosture: 'postured' },
    durationMs: [800, 1400], baseP: 0.70, kSkill: 1.0,
    skills: { attacker: ['wr.get_up'], defender: ['bjj.retention'] },
    stateMods: [st('FAT-')],
    counters: ['ankle pick or sweep as he rises', 'upkick', 'closed-guard lock'],
    tag: '[S: MMA_INTEGRATION §3 S-6 "strikers stand out of guard"] [E: baseP 0.70]',
  }),
];

// ---------------------------------------------------------------------------
// §2.3 L — Scramble resolution, referee, round end (5 edges + the outcome table)
// ---------------------------------------------------------------------------

const EDGES_L: readonly GrapplingEdge[] = [
  edge({
    id: 'tech.scramble_resolve', name: 'Scramble resolution', group: 'L', kind: 'scramble',
    from: ['pos.scramble'],
    // Both cells are the §2.3 L outcome table; `resolve.ts` picks the open-mat
    // or cage row and applies it to whichever fighter won the score contest.
    to: [d('pos.ground_turtle', 0.30), d('pos.ground_back_hooks', 0.15),
      d('pos.ground_side', 0.15), d('pos.ground_half_flat', 0.10),
      d('pos.ground_open_kneeling_top', 0.15), d('pos.standing_close', 0.15)],
    toOnFailure: [d('pos.ground_turtle', 0.30, true), d('pos.ground_back_hooks', 0.15, true),
      d('pos.ground_side', 0.15, true), d('pos.ground_half_flat', 0.10, true),
      d('pos.ground_open_kneeling_top', 0.15, true), d('pos.standing_close', 0.15, true)],
    requirements: 'resolves in 1,000-2,000 ms (4,000 ms cap); both pay 2x grappling fatigue',
    durationMs: [1000, 2000], baseP: 0.50,
    // Scrambles use the §2.3 L score formula, not a skill gap: the logit slope
    // is grap.scrambleLogitPerPt = 0.0576 per score point [D: ln 10 / 40].
    kSkill: 0,
    skills: { attacker: ['wr.scramble'], defender: ['wr.scramble'] },
    tag: '[S: WRESTLING §6] [S: BJJ_POSITIONS §8 r26]',
  }),
  edge({
    id: 'ref.standup', name: 'Referee stand-up', group: 'L', kind: 'referee', actor: 'a',
    from: GROUND_NODE_IDS,
    to: [d('pos.standing_mid', 1)],
    toOnFailure: [d('same', 1)],
    requirements: 'the §6 inactivity timers have expired; the referee warns, then stands them up',
    durationMs: [1000, 1000], baseP: 0.20, kSkill: 0,
    tag: '[S: BJJ_POSITIONS §8 r17] [S: RULES_JUDGING §3.3]',
    note: '0.20 per second after the threshold, so it is near certain within 8 s.',
  }),
  edge({
    id: 'ref.clinch_break', name: 'Referee clinch break', group: 'L', kind: 'referee',
    from: CLINCH_NODE_IDS,
    to: [d('pos.standing_mid', 1)],
    toOnFailure: [d('same', 1)],
    requirements: 'the §6 clinch-break timer has expired',
    durationMs: [1000, 1000], baseP: 0.50, kSkill: 0,
    tag: '[S: WRESTLING §9 r24] [S: RULES_JUDGING §5]',
    note: '0.50 per further 5 s after the threshold (referee variance parameter).',
  }),
  edge({
    id: 'ref.round_end', name: 'Round end restart', group: 'L', kind: 'referee',
    from: POSITION_NODES.map((n) => n.id),
    to: [d('pos.standing_mid', 1)],
    toOnFailure: [d('pos.standing_mid', 1)],
    requirements: 'the bell; damage and stamina carry, positional advantage does not',
    durationMs: [0, 0], baseP: 0.99, kSkill: 0,
    tag: '[S: BJJ_POSITIONS §3.2 R3]',
    note: 'UFC ground stints truncated by the bell are about 15 % of the total (calibration check).',
  }),
  edge({
    id: 'ref.stoppage', name: 'Referee stoppage from ground and pound', group: 'L', kind: 'referee',
    from: TOP_GNP_NODE_IDS,
    to: [d('same', 1)], toOnFailure: [d('same', 1)],
    requirements: '>= 3 unanswered clean strikes before any roll (§5.4)',
    // Sanity check only: the engine's stoppage decision is §06's
    // ref.tkoUnansweredGround. TODO(chapter 06): read RefObservables instead.
    durationMs: [0, 0], baseP: 0.02, kSkill: 0,
    tag: '[S: BJJ_POSITIONS §8 r9]',
  }),
];

// ---------------------------------------------------------------------------
// Assembled catalogue and indices
// ---------------------------------------------------------------------------

export const GRAPPLING_EDGES: readonly GrapplingEdge[] = [
  ...EDGES_A, ...EDGES_B, ...EDGES_C, ...EDGES_D,
  ...EDGES_E, ...EDGES_F, ...EDGES_G, ...EDGES_H,
  ...EDGES_I, ...EDGES_J, ...EDGES_L,
];

/**
 * §2.3 closes with "A 17 · B 30 · C 24 · D 24 · E 12 · F 12 · G 17 · H 17 ·
 * I 20 · J 7 · L 6 = 186 edge rows (a few rows bundle mirror variants)".
 *
 * Counting the printed rows gives C 25 and D 23, and L's six rows include the
 * "scramble outcome" row, which is a weight table rather than an edge. This
 * catalogue therefore holds **187 distinct edge ids**: the same 186 rows with
 * the mirror-counter row split into its three ids (osoto / harai / ouchi
 * gaeshi, whose conditional bases differ at 0.35 / 0.30 / 0.25) and the
 * outcome row moved into `SCRAMBLE_OUTCOMES` below. Nothing from the chapter
 * is dropped and nothing is invented.
 *
 * Realism pass: + 2 edges that are not §2.3 rows — the top man's exits
 * (`tech.sprawl_reset`, `tech.top_stand_away`), which the chapter's tables
 * lacked (every exit was a bottom exit). 189 in all.
 */
export const EDGE_COUNT = 189;

const EDGE_BY_ID = new Map<EdgeId, GrapplingEdge>();
for (const e of GRAPPLING_EDGES) {
  if (EDGE_BY_ID.has(e.id)) throw new Error(`Duplicate grappling edge: ${e.id}`);
  EDGE_BY_ID.set(e.id, e);
}

export function grapplingEdge(id: EdgeId): GrapplingEdge {
  const e = EDGE_BY_ID.get(id);
  if (!e) throw new Error(`Unknown grappling edge: ${id}`);
  return e;
}

export function hasGrapplingEdge(id: string): boolean {
  return EDGE_BY_ID.has(id);
}

const EDGES_FROM = new Map<PositionId, GrapplingEdge[]>();
for (const e of GRAPPLING_EDGES) {
  for (const f of e.from) {
    const list = EDGES_FROM.get(f);
    if (list) list.push(e);
    else EDGES_FROM.set(f, [e]);
  }
}

/** Every edge that can be attempted from a node, in catalogue order. */
export function edgesFrom(node: PositionId): readonly GrapplingEdge[] {
  return EDGES_FROM.get(node) ?? [];
}

/** All destination nodes of an edge, success and failure, with `'same'` resolved. */
export function destinationsOf(e: GrapplingEdge, from: PositionId): PositionId[] {
  const out: PositionId[] = [];
  for (const dest of [...e.to, ...e.toOnFailure]) {
    out.push(dest.node === 'same' ? from : dest.node);
  }
  return out;
}

/**
 * Entries the §2.2 node rows state in prose but that no §2.3 row carries as a
 * destination. Three sources:
 *
 *  - chapter 02 emits the trigger (`pos.ground_knockdown`; §1 interface table);
 *  - the node is an in-flight state of another edge (`pos.throw_in_progress`);
 *  - the node was added at chapter 04's request or is a leg-pummel variant of a
 *    neighbouring entanglement, and §04 owns the technique that reaches it.
 *
 * The graph-reachability check reads this map alongside the edge destinations.
 * TODO(chapter 04): replace the leg-entanglement rows once §04's entry
 * techniques exist as edges of their own.
 */
export const IMPLICIT_ENTRIES: ReadonlyMap<PositionId, readonly PositionId[]> = new Map([
  ['pos.standing_long', ['pos.standing_mid']],
  ['pos.clinch_thai_plum', ['pos.clinch_collar_tie']],
  ['pos.clinch_head_and_arm', ['pos.clinch_collar_tie', 'pos.clinch_over_under']],
  ['pos.clinch_two_on_one', ['pos.clinch_hand_fight', 'pos.clinch_collar_tie']],
  ['pos.clinch_cage_pin_rear', ['pos.clinch_body_lock_rear']],
  ['pos.throw_in_progress', CLINCH_NODE_IDS],
  // The lift edges name their landing node directly and pass through
  // `pos.td_lifted` in flight; the node is where the slam damage is decided.
  ['pos.td_lifted', ['pos.td_double_leg_in', 'pos.td_high_crotch_in',
    'pos.clinch_body_lock_front', 'pos.clinch_body_lock_rear']],
  ['pos.ground_knockdown', ['pos.standing_mid', 'pos.standing_close']],
  ['pos.ground_side_reverse_kesa', ['pos.ground_side']],
  ['pos.ground_half_quarter', ['pos.ground_half_flat']],
  ['pos.ground_half_deep', ['pos.ground_half_knee_shield']],
  ['pos.ground_half_lockdown', ['pos.ground_half_flat']],
  ['pos.ground_half_butterfly', ['pos.ground_half_knee_shield']],
  ['pos.ground_closed_high', ['pos.ground_closed_posture_broken']],
  ['pos.ground_closed_rubber', ['pos.ground_closed_posture_broken']],
  ['pos.ground_open_seated', ['pos.ground_open_legs_up']],
  ['pos.ground_open_k', ['pos.ground_open_seated']],
  ['pos.ground_ashi_outside', ['pos.ground_ashi_slx']],
  ['pos.ground_reap', ['pos.ground_ashi_slx']],
  ['pos.ground_ashi_cross', ['pos.ground_ashi_outside']],
  ['pos.ground_truck', ['pos.ground_turtle', 'pos.ground_back_one_hook']],
]);

// ---------------------------------------------------------------------------
// §2.3 K — Post-takedown stabilisation, rolled once 3 s after a landed takedown
// ---------------------------------------------------------------------------

export type StabiliseRoute =
  | 'doubleOpenMat' | 'singleRunPipe' | 'bodyLockTrip' | 'cage'
  | 'snapGoBehind' | 'lowSingleAnklePick' | 'judoThrowPast' | 'judoThrowGuard';

export interface StabiliseRow {
  /** Top holds the position for >= 10 s. */
  stabilises: number;
  /** Immediate `pos.scramble`. */
  scramble: number;
  /** Bottom stands straight back up (usually a wall). */
  standsUp: number;
  tag: string;
}

export const STABILISE_TABLE: Readonly<Record<StabiliseRoute, StabiliseRow>> = Object.freeze({
  doubleOpenMat: { stabilises: 0.70, scramble: 0.15, standsUp: 0.15, tag: '[S: WRESTLING §8.4]' },
  singleRunPipe: { stabilises: 0.60, scramble: 0.25, standsUp: 0.15, tag: '[S: WRESTLING §8.4]' },
  bodyLockTrip: { stabilises: 0.75, scramble: 0.10, standsUp: 0.15, tag: '[S: WRESTLING §8.4]' },
  cage: { stabilises: 0.65, scramble: 0.10, standsUp: 0.25, tag: '[S: WRESTLING §8.4]' },
  snapGoBehind: { stabilises: 0.55, scramble: 0.30, standsUp: 0.15, tag: '[S: WRESTLING §8.4]' },
  lowSingleAnklePick: { stabilises: 0.50, scramble: 0.35, standsUp: 0.15, tag: '[S: WRESTLING §8.4]' },
  // Throws that land past the guard mirror the body lock.
  judoThrowPast: { stabilises: 0.75, scramble: 0.15, standsUp: 0.10, tag: '[E]' },
  judoThrowGuard: { stabilises: 0.55, scramble: 0.25, standsUp: 0.20, tag: '[E]' },
});

/** Which stabilisation row a landed edge uses. */
export function stabiliseRouteFor(edgeId: EdgeId, cage: boolean): StabiliseRoute {
  if (cage) return 'cage';
  switch (edgeId) {
    case 'tech.double_drive_through': case 'tech.double_cut_corner':
    case 'tech.double_turn_corner': case 'tech.double_lift_slam':
    case 'tech.jab_to_double':
      return 'doubleOpenMat';
    case 'tech.single_run_pipe': case 'tech.single_tree_top': case 'tech.single_dump':
    case 'tech.single_trip': case 'tech.cross_to_single':
      return 'singleRunPipe';
    case 'tech.body_lock_lift_return': case 'tech.inside_trip': case 'tech.outside_trip':
    case 'tech.knee_tap_double': case 'tech.rear_mat_return': case 'tech.rear_trip':
      return 'bodyLockTrip';
    case 'tech.snap_down': case 'tech.front_headlock_go_behind': case 'tech.sprawl_spin_behind':
      return 'snapGoBehind';
    case 'tech.single_low_finish': case 'tech.ankle_pick':
      return 'lowSingleAnklePick';
    case 'tech.uchi_mata': case 'tech.harai_goshi': case 'tech.o_goshi': case 'tech.koshi_guruma':
    case 'tech.ippon_seoi': case 'tech.morote_seoi': case 'tech.kata_guruma':
    case 'tech.osoto_gari': case 'tech.ura_nage': case 'tech.te_guruma': case 'tech.tani_otoshi':
    case 'tech.hane_goshi':
      return 'judoThrowPast';
    case 'tech.ouchi_gari': case 'tech.kouchi_gari': case 'tech.tai_otoshi':
    case 'tech.de_ashi_harai': case 'tech.sasae_tsurikomi_ashi': case 'tech.thai_dump':
      return 'judoThrowGuard';
    default:
      return 'doubleOpenMat';
  }
}

// ---------------------------------------------------------------------------
// §2.3 L — Scramble outcome weights (the row that is a table, not an edge)
// ---------------------------------------------------------------------------

export interface ScrambleOutcome {
  node: PositionId;
  weight: number;
  note?: string;
}

/** Where the scramble winner ends up, open mat. */
export const SCRAMBLE_OUTCOMES_OPEN: readonly ScrambleOutcome[] = [
  { node: 'pos.ground_turtle', weight: 0.30 },
  { node: 'pos.ground_back_hooks', weight: 0.15 },
  { node: 'pos.ground_side', weight: 0.125 },
  { node: 'pos.ground_half_flat', weight: 0.125 },
  { node: 'pos.ground_open_kneeling_top', weight: 0.15 },
  { node: 'pos.standing_close', weight: 0.15, note: 'winner had the last upper-body control' },
];

/** Against the cage: more back takes, and standing resolutions become cage pins. */
export const SCRAMBLE_OUTCOMES_CAGE: readonly ScrambleOutcome[] = [
  { node: 'pos.ground_turtle', weight: 0.25 },
  { node: 'pos.ground_back_hooks', weight: 0.20 },
  { node: 'pos.ground_side', weight: 0.10 },
  { node: 'pos.ground_half_flat', weight: 0.10 },
  { node: 'pos.ground_open_kneeling_top', weight: 0.10 },
  { node: 'pos.clinch_cage_pin_front', weight: 0.25 },
];

// ---------------------------------------------------------------------------
// §2.3 M — Trigger events emitted to chapter 04
// ---------------------------------------------------------------------------

export type GrappleTriggerId =
  | 'evt.arm_crossed_centre' | 'evt.hand_posted' | 'evt.back_taken'
  | 'evt.sprawl_front_headlock' | 'evt.step_over_guard' | 'evt.turn_away'
  | 'evt.posture_broken' | 'evt.underhook_from_bottom' | 'evt.head_down_standing';

/** Nodes whose arrival emits a trigger, and the trigger id (§2.3 M). */
export const ARRIVAL_TRIGGERS: ReadonlyMap<PositionId, GrappleTriggerId> = new Map([
  ['pos.ground_back_hooks', 'evt.back_taken'],
  ['pos.ground_back_body_triangle', 'evt.back_taken'],
  ['pos.ground_back_one_hook', 'evt.back_taken'],
  ['pos.ground_back_seatbelt', 'evt.back_taken'],
  ['pos.td_sprawl', 'evt.sprawl_front_headlock'],
  ['pos.clinch_front_headlock', 'evt.sprawl_front_headlock'],
  ['pos.ground_front_headlock', 'evt.sprawl_front_headlock'],
  ['pos.ground_closed_posture_broken', 'evt.posture_broken'],
  ['pos.ground_half_underhook', 'evt.underhook_from_bottom'],
]);

/** Edges whose attempt or success emits a trigger (§2.3 M). */
export const EDGE_TRIGGERS: ReadonlyMap<EdgeId, GrappleTriggerId> = new Map([
  ['tech.pass_with_gnp', 'evt.arm_crossed_centre'],
  ['tech.gnp_posture', 'evt.hand_posted'],
  ['tech.sweep_on_strike', 'evt.hand_posted'],
  ['tech.escape_mount_turn_belly', 'evt.turn_away'],
  ['tech.escape_side_underhook_turn', 'evt.turn_away'],
  ['tech.pass_knee_cut', 'evt.step_over_guard'],
  ['tech.pass_hq', 'evt.step_over_guard'],
  ['tech.pass_leg_drag', 'evt.step_over_guard'],
  ['tech.snap_down', 'evt.head_down_standing'],
  ['tech.dogfight_entry', 'evt.underhook_from_bottom'],
]);

// ---------------------------------------------------------------------------
// Id registration
//
// `IdTable.add` is idempotent and assigns indices by sorted id at freeze time,
// so registration order here cannot move an index and cannot break a replay.
// Nothing in this module freezes the tables: chapters 02 and 04 register into
// the same tables.
// ---------------------------------------------------------------------------

POSITION_IDS.addAll(POSITION_NODES.map((n) => n.id));

for (const e of GRAPPLING_EDGES) {
  if (e.id.startsWith('tech.')) TECHNIQUE_IDS.add(e.id);
  else if (e.id.startsWith('def.')) DEFENCE_IDS.add(e.id);
  // `ref.*` ids are referee actions, not techniques; chapter 06 owns them and
  // there is no id table for them.
}

for (const n of POSITION_NODES) {
  for (const s of [...n.subThreats.top, ...n.subThreats.bottom]) SUBMISSION_IDS.add(s);
}
for (const e of GRAPPLING_EDGES) {
  for (const dest of [...e.to, ...e.toOnFailure]) {
    if (dest.submission) SUBMISSION_IDS.add(dest.submission);
  }
}
