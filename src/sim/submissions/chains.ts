/**
 * THE CHAIN GRAPH (04 §4) - 132 directed edges, as data.
 *
 * Semantics. An edge fires when the source stage *fails* - the defender's `p_e`
 * succeeded and routed to regress/hold, or a stall/abandon roll came up - for
 * the listed trigger. `p` is the share of the source's failures that route to
 * the target at T4; the remainder follows the catalogue's escape/abandon
 * routing. A `POS` source fires on a positional event instead, at the rate §03
 * reports.
 *
 * A chain target starts at S1 with `M_CHAIN` (+0.18) unless `enterStage` says
 * `secure`, which means the grip is already there.
 *
 * Two loop guards keep `rnc <-> crank`, `darce <-> anaconda`,
 * `americana <-> kimura` and the leg-lock family from cycling forever: at most
 * `hopCap` hops per `hopWindowMs`, and chains are gated by tier - a T0/T1
 * fighter never chains at all.
 *
 * `sampleChainEdge` is a pure function of the `chain` draw that
 * `stages.resolveWindow` already took, so routing a failure through the graph
 * never costs an extra RNG call (09 §2.7: four draws per window, no more).
 */
import type { Tier } from './stages';

/** `edge.sub.*` for submission-to-submission, `edge.pos.*` when §03 owns an end. */
export type ChainEdgeId = string;

export type ChainSourceKind = 'sub' | 'pos';
export type ChainTargetKind = 'sub' | 'pos' | 'event';

export interface ChainEdge {
  readonly id: ChainEdgeId;
  readonly fromKind: ChainSourceKind;
  /** Submission ids, or a §03 node id for a `pos` source. */
  readonly from: readonly string[];
  /** Stages of the source attack whose failure can fire this edge. */
  readonly fromStages: readonly ('entry' | 'secure' | 'finish' | 'any')[];
  readonly toKind: ChainTargetKind;
  /** Submission id, §03 node id, or an event name for `event` targets. */
  readonly to: string;
  /** Stage the target attack starts at. */
  readonly enterStage: 'entry' | 'secure';
  /** Share of the source's failures that route here, at T4. */
  readonly p: number;
  readonly trigger: string;
  /** True when the edge hands the *defender* a new attack (`DEF` in §4). */
  readonly defenderEdge?: boolean;
  readonly tag: string;
  readonly note?: string;
}

/** Chain tunables (§4 preamble, param registry §7). */
export const CHAIN_PARAMS = {
  /** M_CHAIN, the logit the target attack's S1 gets. */
  chainBonus: 0.18,
  hopCap: 3,
  hopWindowMs: 15000,
  /** P scales with tier: elite fighters are the ones who actually chain. */
  tierMult: [0, 0, 0.5, 0.8, 1.0, 1.2] as readonly number[],
  tierMultCap: 1.0,
} as const;

const E = (
  id: string,
  from: string | readonly string[],
  fromStages: readonly ('entry' | 'secure' | 'finish' | 'any')[],
  to: string,
  p: number,
  trigger: string,
  tag: string,
  opts: {
    fromKind?: ChainSourceKind;
    toKind?: ChainTargetKind;
    enterStage?: 'entry' | 'secure';
    defenderEdge?: boolean;
    note?: string;
  } = {},
): ChainEdge => ({
  id,
  fromKind: opts.fromKind ?? 'sub',
  from: typeof from === 'string' ? [from] : from,
  fromStages,
  toKind: opts.toKind ?? (to.startsWith('sub.') ? 'sub' : to.startsWith('pos.') ? 'pos' : 'event'),
  to,
  enterStage: opts.enterStage ?? 'entry',
  p,
  trigger,
  defenderEdge: opts.defenderEdge,
  tag,
  note: opts.note,
});

const ANY: readonly ('any')[] = ['any'];
const S1S2: readonly ('entry' | 'secure')[] = ['entry', 'secure'];
const S2S3: readonly ('secure' | 'finish')[] = ['secure', 'finish'];

// The four truck-family nodes chain into each other at 0.20 in every direction
// [S: §3 "BACK_CONTROL (one hook) <-> Twister <-> Truck -> Calf Slicer / Banana
// Split"; the per-pair P is E].
const TRUCK_FAMILY: readonly [string, string, string][] = [
  ['truck_to_twister', 'pos.ground_truck', 'sub.twister'],
  ['twister_to_truck', 'sub.twister', 'pos.ground_truck'],
  ['truck_to_calf_slicer', 'pos.ground_truck', 'sub.calf_slicer'],
  ['calf_slicer_to_truck', 'sub.calf_slicer', 'pos.ground_truck'],
  ['truck_to_banana_split', 'pos.ground_truck', 'sub.banana_split'],
  ['banana_split_to_truck', 'sub.banana_split', 'pos.ground_truck'],
  ['twister_to_calf_slicer', 'sub.twister', 'sub.calf_slicer'],
  ['calf_slicer_to_twister', 'sub.calf_slicer', 'sub.twister'],
  ['twister_to_banana_split', 'sub.twister', 'sub.banana_split'],
  ['banana_split_to_twister', 'sub.banana_split', 'sub.twister'],
  ['calf_slicer_to_banana_split', 'sub.calf_slicer', 'sub.banana_split'],
  ['banana_split_to_calf_slicer', 'sub.banana_split', 'sub.calf_slicer'],
];

export const CHAIN_EDGES: readonly ChainEdge[] = [
  // ---- back --------------------------------------------------------------
  E('edge.pos.back_to_rnc', 'pos.ground_back_hooks', ANY, 'sub.rnc', 0.45,
    'back take completed; the attack is immediate', '[S: BJJ_POS §1 Lamas 2024]', { fromKind: 'pos' }),
  E('edge.sub.rnc_to_armbar_back', ['sub.rnc', 'sub.rnc_short'], S1S2, 'sub.armbar_back', 0.20,
    "hands defended, defender's arm high", '[S: SUBMISSIONS §3]'),
  E('edge.sub.rnc_to_rear_tri', ['sub.rnc', 'sub.rnc_short'], ['secure'], 'sub.triangle_rear', 0.10,
    'arm trapped inside the seatbelt', '[S: SUBMISSIONS §3]'),
  E('edge.sub.rnc_to_neck_crank', ['sub.rnc', 'sub.rnc_short'], S2S3, 'sub.neck_crank_rear', 0.15,
    'the choking arm lands on the jaw', '[S: SUBMISSIONS §3]'),
  E('edge.sub.rnc_to_body_tri_gnp', ['sub.rnc', 'sub.rnc_short'], ANY, 'pos.ground_back_body_triangle', 0.25,
    'hands defended; the attacker chooses damage over the choke', '[S: SUBMISSIONS §3]',
    { note: 'hands the pair to §03/§05 for the GnP TKO path' }),
  E('edge.sub.rnc_to_mount', ['sub.rnc', 'sub.rnc_short'], ANY, 'pos.ground_mount_low', 0.15,
    'defender turns in and stops', '[S: SUBMISSIONS §3]'),
  E('edge.sub.rnc_to_short', 'sub.rnc', ['secure'], 'sub.rnc_short', 0.30,
    'the figure-four is denied', '[E]', { enterStage: 'secure' }),
  E('edge.sub.armbar_back_to_rnc', 'sub.armbar_back', S1S2, 'sub.rnc', 0.50,
    'defender turns back in', '[S: SUBMISSIONS §3]'),
  E('edge.sub.rear_tri_to_armbar', 'sub.triangle_rear', S2S3, 'sub.armbar_back', 0.30,
    'trapped arm extended', '[E]'),
  E('edge.sub.crank_to_rnc', ['sub.neck_crank_rear', 'sub.neck_crank_generic'], ANY, 'sub.rnc', 0.40,
    'hand-fighting loop, the chin comes back out', '[S: SUBMISSIONS §3 RNC-crank-RNC loop; P E]'),
  E('edge.sub.twister_to_rnc', 'sub.twister', S1S2, 'sub.rnc', 0.25,
    'both hooks come in', '[S: SUBMISSIONS §2.21]'),
  ...TRUCK_FAMILY.map(([name, from, to]) => E(
    `edge.sub.${name}`, from, ANY, to, 0.20, 'the leg is already in the truck',
    '[S: SUBMISSIONS §3 truck family; P E]',
    { fromKind: from.startsWith('pos.') ? 'pos' : 'sub' },
  )),
  E('edge.pos.turtle_to_rnc', 'pos.ground_turtle', ANY, 'sub.rnc', 0.45,
    'back take completed (§03 T9)', '[S: BJJ_POS §8 rule 13]',
    { fromKind: 'pos', note: 'the real rate is §03-owned; 0.45 is the back-take-to-attempt share' }),
  E('edge.pos.turtle_to_crucifix', 'pos.ground_turtle', ANY, 'sub.crucifix_armlock', 0.15,
    'arm trapped between the legs', '[E]', { fromKind: 'pos' }),
  E('edge.sub.crucifix_to_choke', 'sub.crucifix_armlock', ANY, 'sub.crucifix_choke', 0.25,
    'arm still trapped', '[S: SUBMISSIONS §2.25; P E]'),
  E('edge.sub.crucifix_to_crank', 'sub.crucifix_armlock', ANY, 'sub.neck_crank_generic', 0.15,
    'arm still trapped, head available', '[S: SUBMISSIONS §2.25; P E]'),
  E('edge.pos.crucifix_to_gnp', ['sub.crucifix_armlock', 'sub.crucifix_choke'], ANY, 'pos.ground_crucifix_side', 0.40,
    'the attacker switches to strikes', '[S: SUBMISSIONS §2.25 "TKO from crucifix far more common"; P E]',
    { note: 'TKO route: §03 keeps the node, §05 takes the strikes' }),

  // ---- front headlock ----------------------------------------------------
  E('edge.pos.sprawl_to_fhl', 'pos.standing_sprawl', ANY, 'pos.ground_front_headlock', 0.60,
    'sprawl on a desperate shot', '[S: SUBMISSIONS §3]', { fromKind: 'pos' }),
  E('edge.pos.snapdown_to_standing_guillotine', 'pos.clinch_collar_tie', ANY, 'sub.guillotine_standing', 0.20,
    'evt.head_down_standing: a hurt opponent with the head down', '[S: SUBMISSIONS §3]', { fromKind: 'pos' }),
  E('edge.sub.guillotine_to_darce',
    ['sub.guillotine_standard', 'sub.guillotine_arm_in', 'sub.guillotine_high_elbow',
      'sub.guillotine_ten_finger', 'sub.guillotine_standing'], S1S2, 'sub.darce', 0.20,
    "opponent's arm on the same side", '[S: SUBMISSIONS §3]',
    { note: 'x2 weight from the arm-in guillotine, x0.5 from the ten-finger (no arm control)' }),
  E('edge.sub.guillotine_to_anaconda',
    ['sub.guillotine_standard', 'sub.guillotine_arm_in'], ['entry'], 'sub.anaconda', 0.10,
    'head slides out under the arm', '[S: SUBMISSIONS §3]'),
  E('edge.sub.guillotine_to_mounted',
    ['sub.guillotine_standard', 'sub.guillotine_arm_in', 'sub.guillotine_high_elbow', 'sub.guillotine_standing'],
    S2S3, 'sub.guillotine_mounted', 0.10, 'sweep to top keeping the grip', '[S: SUBMISSIONS §3]',
    { enterStage: 'secure' }),
  E('edge.sub.guillotine_to_back',
    ['sub.guillotine_standard', 'sub.guillotine_arm_in', 'sub.guillotine_high_elbow', 'sub.guillotine_ten_finger'],
    S1S2, 'pos.ground_back_hooks', 0.15, 'opponent turns / go-behind', '[S: SUBMISSIONS §3]'),
  E('edge.sub.guillotine_to_tri', 'sub.guillotine_standard', ['secure'], 'sub.triangle_guard', 0.10,
    'head pops out with the arm in', '[S: SUBMISSIONS §3]'),
  E('edge.sub.guillotine_to_armbar', 'sub.guillotine_standard', ['secure'], 'sub.armbar_guard', 0.05,
    'defender posts', '[S: SUBMISSIONS §2.2 chains; P E]'),
  E('edge.sub.guillotine_to_von_flue',
    ['sub.guillotine_standard', 'sub.guillotine_arm_in'], S2S3, 'sub.von_flue', 0.15,
    'the defender passes to the choking side and the attacker keeps the grip', '[S: SUBMISSIONS §3]',
    { enterStage: 'secure', defenderEdge: true }),
  E('edge.sub.standing_guillotine_to_guard', 'sub.guillotine_standing', ['secure'], 'sub.guillotine_standard', 0.50,
    'opponent lifts, or the attacker chooses to jump guard', '[S: SUBMISSIONS §3]', { enterStage: 'secure' }),
  E('edge.sub.standing_guillotine_dumped', 'sub.guillotine_standing', S1S2, 'evt.slam', 0.25,
    'def.lift_and_dump', '[S: SUBMISSIONS §3]',
    { toKind: 'event', defenderEdge: true, note: 'waist-height slam, then pos.ground_half_flat with the attacker on the bottom' }),
  E('edge.sub.darce_to_anaconda', 'sub.darce', S1S2, 'sub.anaconda', 0.30,
    'head/arm position flips', '[S: SUBMISSIONS §3]'),
  E('edge.sub.anaconda_to_darce', 'sub.anaconda', S1S2, 'sub.darce', 0.30,
    'head/arm position flips', '[S: SUBMISSIONS §3]'),
  E('edge.sub.darce_to_arm_tri', 'sub.darce', S2S3, 'sub.arm_triangle_side', 0.20,
    'attacker ends on top with the arm trapped', '[S: SUBMISSIONS §3]', { enterStage: 'secure' }),
  E('edge.sub.anaconda_to_arm_tri', 'sub.anaconda', S2S3, 'sub.arm_triangle_side', 0.20,
    'after the gator roll', '[S: SUBMISSIONS §3]', { enterStage: 'secure' }),
  E('edge.sub.darce_to_back', ['sub.darce', 'sub.anaconda'], S1S2, 'pos.ground_back_hooks', 0.20,
    'opponent turns away', '[S: SUBMISSIONS §3]'),
  E('edge.sub.darce_to_necktie', 'sub.darce', S1S2, 'sub.peruvian_necktie', 0.10,
    'opponent stays turtled', '[S: SUBMISSIONS §3]'),
  E('edge.sub.darce_to_guillotine', ['sub.darce', 'sub.anaconda'], ['entry'], 'sub.guillotine_standard', 0.10,
    'the arm slips out', '[S: SUBMISSIONS §2.3 chains; P E]'),
  E('edge.sub.necktie_to_darce', ['sub.peruvian_necktie', 'sub.japanese_necktie'], S1S2, 'sub.darce', 0.15,
    'front headlock retained', '[S: SUBMISSIONS §2.18; P E]'),
  E('edge.sub.necktie_to_anaconda', ['sub.peruvian_necktie', 'sub.japanese_necktie'], S1S2, 'sub.anaconda', 0.15,
    'front headlock retained', '[S: SUBMISSIONS §2.18; P E]'),
  E('edge.sub.necktie_to_guillotine', ['sub.peruvian_necktie', 'sub.japanese_necktie'], S1S2,
    'sub.guillotine_standard', 0.15, 'front headlock retained', '[S: SUBMISSIONS §2.18; P E]'),
  E('edge.sub.peruvian_to_japanese', 'sub.peruvian_necktie', S1S2, 'sub.japanese_necktie', 0.15,
    'the leg goes over the back instead', '[S: SUBMISSIONS §2.18; P E]'),
  E('edge.sub.japanese_to_peruvian', 'sub.japanese_necktie', S1S2, 'sub.peruvian_necktie', 0.15,
    'the attacker sits to the hip instead', '[S: SUBMISSIONS §2.18; P E]'),
  E('edge.sub.kimura_side_to_darce', 'sub.kimura_side', ['entry'], 'sub.darce', 0.10,
    'the bottom fighter turns in to escape', '[E]'),

  // ---- mount and side control --------------------------------------------
  E('edge.pos.mount_gnp_to_arm_tri', 'pos.ground_mount_gnp', ANY, 'sub.arm_triangle_mount', 0.30,
    'framing under GnP produces evt.arm_crossed_centre', '[S: SUBMISSIONS §3]', { fromKind: 'pos' }),
  E('edge.pos.mount_gnp_to_ezekiel', 'pos.ground_mount_gnp', ANY, 'sub.ezekiel_top', 0.05,
    'head wrapped during GnP', '[E]', { fromKind: 'pos' }),
  E('edge.sub.arm_tri_to_americana_kimura', 'sub.arm_triangle_mount', ['secure'], 'sub.americana', 0.20,
    'arm across, the dismount fails', '[S: SUBMISSIONS §3]',
    { note: 'resolves to sub.kimura_side when the arm is already bent behind the back' }),
  E('edge.sub.arm_tri_to_mounted_tri', 'sub.arm_triangle_mount', ['secure'], 'sub.triangle_mounted', 0.10,
    'arm across, the attacker stays mounted', '[S: SUBMISSIONS §3]'),
  E('edge.sub.arm_tri_to_back', ['sub.arm_triangle_mount', 'sub.arm_triangle_side'], S1S2,
    'pos.ground_back_hooks', 0.15, 'defender turns away', '[S: SUBMISSIONS §3]'),
  E('edge.sub.arm_tri_to_mounted_guillotine', 'sub.arm_triangle_mount', ['entry'], 'sub.guillotine_mounted', 0.05,
    'the chin is available as the arm is released', '[S: SUBMISSIONS §2.5 chains; P E]'),
  E('edge.sub.mounted_guillotine_to_arm_tri', 'sub.guillotine_mounted', ['secure'], 'sub.arm_triangle_mount', 0.20,
    'the arm crosses while defending', '[E]'),
  E('edge.sub.ezekiel_to_arm_tri', 'sub.ezekiel_top', ['secure'], 'sub.arm_triangle_mount', 0.20,
    'arm across', '[S: SUBMISSIONS §2.16 chains; P E]'),
  E('edge.sub.ezekiel_bottom_to_guillotine', 'sub.ezekiel_bottom', S1S2, 'sub.guillotine_standard', 0.20,
    'the top fighter pulls the head out', '[S: SUBMISSIONS §2.16 chains; P E]'),
  E('edge.sub.americana_to_kimura', 'sub.americana', S1S2, 'sub.kimura_side', 0.30,
    'the arm flips', '[S: SUBMISSIONS §3]'),
  E('edge.sub.kimura_to_americana', 'sub.kimura_side', S1S2, 'sub.americana', 0.30,
    'the arm flips', '[S: SUBMISSIONS §3]'),
  E('edge.sub.americana_to_armbar', 'sub.americana', S1S2, 'sub.armbar_mount', 0.25,
    'defender straightens the arm', '[S: SUBMISSIONS §3; EV3]'),
  E('edge.sub.americana_to_arm_tri', 'sub.americana', ['entry'], 'sub.arm_triangle_mount', 0.10,
    'the arm is pushed across', '[S: SUBMISSIONS §2.9 chains; P E]'),
  E('edge.sub.armbar_mount_to_mounted_tri', 'sub.armbar_mount', S1S2, 'sub.triangle_mounted', 0.20,
    'the arm retracts, the leg is already over', '[S: SUBMISSIONS §3]'),
  E('edge.sub.armbar_mount_to_back', 'sub.armbar_mount', S1S2, 'pos.ground_back_hooks', 0.10,
    'defender turns', '[S: SUBMISSIONS §3]'),
  E('edge.sub.armbar_mount_lost', 'sub.armbar_mount', S2S3, 'pos.ground_closed_guard_bottom', 0.35,
    'defender pulls out and comes up on top', '[S: SUBMISSIONS §3 "GUARD_TOP_FOR_DEFENDER 0.35"]',
    { defenderEdge: true, note: 'share of escapes, not of failures' }),
  E('edge.sub.mounted_tri_to_armbar', 'sub.triangle_mounted', S2S3, 'sub.armbar_mount', 0.35,
    'arm isolated across', '[S: SUBMISSIONS §3]'),
  E('edge.sub.armbar_side_to_kimura', 'sub.armbar_belly_down', ['secure'], 'sub.kimura_side', 0.15,
    'the arm bends', '[E]'),
  E('edge.sub.kimura_side_to_ns_choke', ['sub.kimura_side', 'sub.kimura_north_south'], S1S2,
    'sub.north_south_choke', 0.20, 'the attacker moves to the head', '[S: SUBMISSIONS §3]'),
  E('edge.sub.ns_choke_to_kimura', 'sub.north_south_choke', S1S2, 'sub.kimura_north_south', 0.20,
    'the arm comes free', '[S: SUBMISSIONS §3]'),
  E('edge.sub.kimura_side_to_arm_tri', 'sub.kimura_side', ['secure'], 'sub.arm_triangle_side', 0.15,
    'the arm is pushed across', '[S: SUBMISSIONS §3]'),
  E('edge.sub.ns_choke_to_arm_tri', 'sub.north_south_choke', ['secure'], 'sub.arm_triangle_side', 0.10,
    'the arm is caught', '[S: SUBMISSIONS §2.15 chains; P E]'),
  E('edge.pos.ns_to_mount', 'sub.north_south_choke', ANY, 'pos.ground_mount_low', 0.20,
    'the attacker abandons and steps over', '[S: SUBMISSIONS §2.15 chains; P E]'),
  E('edge.pos.throw_to_mount_armbar', 'pos.ground_mount_high', ANY, 'sub.armbar_mount', 0.25,
    'opponent posts on landing from a throw', '[E; S: SUBMISSIONS §2.7 "Rousey route"]', { fromKind: 'pos' }),

  // ---- guard -------------------------------------------------------------
  E('edge.sub.tri_to_armbar', 'sub.triangle_guard', S1S2, 'sub.armbar_guard', 0.30,
    'the arm pinned across the throat is isolated', '[S: SUBMISSIONS §3]'),
  E('edge.sub.tri_to_omoplata', 'sub.triangle_guard', S1S2, 'sub.omoplata', 0.15,
    'the arm ends outside the leg', '[S: SUBMISSIONS §3; K6]'),
  E('edge.sub.tri_to_mounted_tri', 'sub.triangle_guard', ['secure'], 'sub.triangle_mounted', 0.10,
    "the opponent's base breaks (sweep)", '[S: SUBMISSIONS §3]', { enterStage: 'secure' }),
  E('edge.sub.tri_to_gogoplata', 'sub.triangle_guard', ['secure'], 'sub.gogoplata', 0.03,
    'flexibility >= 80', '[S: SUBMISSIONS §3]'),
  E('edge.sub.tri_slam', ['sub.triangle_guard', 'sub.armbar_guard', 'sub.omoplata'], ANY, 'evt.slam', 0.50,
    'def.slam', '[S: SUBMISSIONS §3 "attacker keeps guard 0.5 / loses 0.5"]',
    { toKind: 'event', defenderEdge: true, note: 'the probability is resolved by §2.6.6, not by this share' }),
  E('edge.sub.tri_diamond_counter', 'sub.triangle_guard', ['secure'], 'sub.kneebar', 0.05,
    'crossed ankles ("diamond") vs a T4+ defender with sk.legLocks >= 60',
    '[E; S: SUBMISSIONS §2.6 counters]', { defenderEdge: true }),
  E('edge.sub.armbar_to_tri',
    ['sub.armbar_guard', 'sub.armbar_mount', 'sub.armbar_belly_down', 'sub.armbar_back'], ['secure'],
    'sub.triangle_guard', 0.30, 'defender clasps the grip; throw the leg over the head',
    '[S: SUBMISSIONS §3]', { note: 'resolves to the triangle variant matching the node; kills def.hitchhiker' }),
  E('edge.sub.armbar_to_omoplata', 'sub.armbar_guard', S1S2, 'sub.omoplata', 0.10,
    'the arm is pulled back outside the leg', '[S: SUBMISSIONS §3]'),
  E('edge.sub.armbar_guard_to_back', 'sub.armbar_guard', S1S2, 'pos.ground_back_hooks', 0.15,
    'the attacker spins under as the defender pulls out', '[S: SUBMISSIONS §3]'),
  E('edge.sub.omoplata_to_sweep', 'sub.omoplata', S2S3, 'pos.ground_side_control', 0.45,
    "the defender's forward roll", '[S: SUBMISSIONS §3]'),
  E('edge.sub.omoplata_to_tri', 'sub.omoplata', S1S2, 'sub.triangle_guard', 0.15,
    're-enter the triangle', '[S: SUBMISSIONS §3]'),
  E('edge.sub.omoplata_to_armbar', 'sub.omoplata', ['secure'], 'sub.armbar_guard', 0.10,
    'the arm straightens', '[S: SUBMISSIONS §3]'),
  E('edge.sub.omoplata_to_kimura', 'sub.omoplata', ['secure'], 'sub.kimura_guard', 0.10,
    'the roll exposes the bent arm', '[S: SUBMISSIONS §3]'),
  E('edge.sub.omoplata_to_back', 'sub.omoplata', ['secure'], 'pos.ground_back_hooks', 0.10,
    'the opponent rolls and stops on the side', '[S: SUBMISSIONS §3]'),
  E('edge.sub.omoplata_to_gogoplata', 'sub.omoplata', S1S2, 'sub.gogoplata', 0.10,
    'rubber guard, flexibility >= 80', '[S: SUBMISSIONS §2.23; P E]'),
  E('edge.sub.gogoplata_to_omoplata', 'sub.gogoplata', S1S2, 'sub.omoplata', 0.10,
    'the shin slips off the throat', '[S: SUBMISSIONS §2.23; P E]'),
  E('edge.sub.gogoplata_to_tri', 'sub.gogoplata', S1S2, 'sub.triangle_guard', 0.10,
    'the legs close instead', '[S: SUBMISSIONS §2.23; P E]'),
  E('edge.pos.knee_slice_to_omoplata', 'pos.ground_half_knee_shield', ANY, 'sub.omoplata', 0.05,
    "the top fighter's arm is outside the hip during a knee-slice pass",
    '[E; S: SUBMISSIONS §2.10]', { fromKind: 'pos', defenderEdge: true }),
  E('edge.pos.arm_drag_to_tri', 'pos.ground_butterfly', ANY, 'sub.triangle_guard', 0.15,
    'a failed arm drag leaves one arm in', '[E; S: SUBMISSIONS §2.6 inbound]', { fromKind: 'pos' }),
  E('edge.sub.kimura_to_sweep', ['sub.kimura_guard', 'sub.kimura_half', 'sub.kimura_grip'], S1S2,
    'pos.ground_half_flat', 0.35, 'hip-bump or roll', '[S: SUBMISSIONS §3]'),
  E('edge.sub.kimura_to_back', ['sub.kimura_guard', 'sub.kimura_half', 'sub.kimura_grip'], S1S2,
    'pos.ground_back_hooks', 0.20, 'kimura trap', '[S: SUBMISSIONS §3; K4b; BJ7]'),
  E('edge.sub.kimura_to_armbar',
    ['sub.kimura_guard', 'sub.kimura_half', 'sub.kimura_side', 'sub.kimura_north_south', 'sub.kimura_grip'],
    S1S2, 'sub.armbar_guard', 0.10, 'defender straightens the arm', '[S: SUBMISSIONS §3]'),
  E('edge.sub.kimura_to_guillotine', 'sub.kimura_grip', ['entry'], 'sub.guillotine_standing', 0.10,
    'the head drops', '[S: SUBMISSIONS §3]'),
  E('edge.sub.kimura_to_takedown', 'sub.kimura_grip', ['entry'], 'pos.ground_half_flat', 0.20,
    'grip secured standing', '[E; S: SUBMISSIONS §2.8]'),
  E('edge.sub.kimura_grip_to_tri', 'sub.kimura_guard', ['entry'], 'sub.triangle_guard', 0.10,
    'the kimura-trap grip pulls the arm in', '[E; S: SUBMISSIONS §2.6 inbound]'),
  E('edge.pos.single_leg_to_kimura_trap', 'pos.clinch_whizzer', ANY, 'sub.kimura_grip', 0.15,
    "the shooter's arm is exposed on the single leg", '[E; S: SUB_COACH kimura trap]', { fromKind: 'pos' }),
  E('edge.pos.underhook_to_kimura_trap', 'pos.ground_half_underhook', ANY, 'sub.kimura_half', 0.15,
    'the underhook arm is exposed', '[E; S: SUB_COACH kimura trap]', { fromKind: 'pos' }),
  E('edge.sub.inverted_tri_to_kimura', 'sub.triangle_inverted', ['secure'], 'sub.kimura_side', 0.20,
    'the arm is caught', '[E; S: SUBMISSIONS §1.2 Rockhold]'),
  E('edge.sub.buggy_to_sweep', 'sub.buggy_choke', ['secure'], 'pos.ground_mount_low', 0.20,
    "the top fighter's base breaks", '[E]'),
  E('edge.pos.can_opener_to_pass', 'sub.can_opener', ANY, 'pos.ground_open_guard_kneeling_top', 0.90,
    'the guard opens', '[S: SUBMISSIONS §2.22]'),

  // ---- leg locks ---------------------------------------------------------
  E('edge.pos.step_over_to_entanglement', 'pos.ground_closed_guard_standing_top', ANY, 'pos.leg_saddle', 0.30,
    'evt.step_over_guard', '[S: SUBMISSIONS §3; the rate is §03-owned]',
    { fromKind: 'pos', defenderEdge: true }),
  E('edge.pos.imanari', 'pos.standing_long', ANY, 'pos.leg_saddle', 0.30,
    'Imanari roll, sk.legLocks >= 70', '[E; S: SUBMISSIONS §2.11 entries]', { fromKind: 'pos' }),
  E('edge.sub.hh_to_kneebar', ['sub.heel_hook_inside', 'sub.heel_hook_outside'], ['secure'], 'sub.kneebar', 0.20,
    'rotation fails, so extend instead', '[S: SUBMISSIONS §3]'),
  E('edge.sub.kneebar_to_hh', 'sub.kneebar', ['secure'], 'sub.heel_hook_inside', 0.20,
    'extension fails, so rotate instead', '[S: SUBMISSIONS §3]'),
  E('edge.sub.hh_to_toe_hold', ['sub.heel_hook_inside', 'sub.heel_hook_outside'], ['secure'], 'sub.toe_hold', 0.15,
    'the heel slips, the toes are available', '[S: SUBMISSIONS §3]'),
  E('edge.sub.hh_to_ankle', ['sub.heel_hook_inside', 'sub.heel_hook_outside'], S1S2,
    'sub.ankle_lock_straight', 0.15, 'fallback', '[S: SUBMISSIONS §3]'),
  E('edge.sub.hh_to_calf_slicer', 'sub.heel_hook_inside', ['secure'], 'sub.calf_slicer', 0.05,
    'the leg bends (411 only)', '[S: SUBMISSIONS §3]'),
  E('edge.sub.hh_to_sweep_back', ['sub.heel_hook_inside', 'sub.heel_hook_outside'], S1S2,
    'pos.ground_back_hooks', 0.15, 'the opponent turns away from the entanglement', '[S: SUBMISSIONS §3]'),
  E('edge.sub.hh_counter', ['sub.heel_hook_inside', 'sub.heel_hook_outside'], S1S2,
    'sub.heel_hook_inside', 0.10, 'mutual exposure in 50-50', '[S: SUBMISSIONS §3]',
    { defenderEdge: true, note: 'T0-T1 attackers do not hide their own heel: this edge doubles against them' }),
  E('edge.sub.ankle_to_hh', 'sub.ankle_lock_straight', S1S2, 'sub.heel_hook_outside', 0.20,
    'the heel is exposed as the opponent turns', '[S: SUBMISSIONS §3]'),
  E('edge.sub.ankle_to_slx_sweep', 'sub.ankle_lock_straight', S1S2, 'pos.ground_side_control', 0.30,
    'the opponent stands or defends: SLX sweep to top', '[S: SUBMISSIONS §3]'),
  E('edge.sub.ankle_to_toe_hold', 'sub.ankle_lock_straight', S1S2, 'sub.toe_hold', 0.10,
    'the foot is available', '[S: SUBMISSIONS §2.13 "<->"; P E]'),
  E('edge.sub.kneebar_to_toe_hold', 'sub.kneebar', S1S2, 'sub.toe_hold', 0.10,
    'the foot is available', '[S: SUBMISSIONS §2.12 "<->"; P E]'),
  E('edge.sub.kneebar_to_ankle', 'sub.kneebar', S1S2, 'sub.ankle_lock_straight', 0.10,
    'the knee line is lost but the foot is held', '[S: SUBMISSIONS §2.12 "<->"; P E]'),
  E('edge.sub.toe_hold_to_ankle', 'sub.toe_hold', S1S2, 'sub.ankle_lock_straight', 0.10,
    'the toes slip, the Achilles is available', '[S: SUBMISSIONS §2.14 "<->"; P E]'),
  E('edge.sub.toe_hold_to_hh', 'sub.toe_hold', S1S2, 'sub.heel_hook_outside', 0.10,
    'the heel is available', '[S: SUBMISSIONS §2.14 "<->"; P E]'),
  E('edge.sub.toe_hold_to_kneebar', 'sub.toe_hold', S1S2, 'sub.kneebar', 0.10,
    'the leg straightens', '[S: SUBMISSIONS §2.14 "<->"; P E]'),
  E('edge.sub.slx_sweep_fail_to_hh', 'pos.leg_ashi_slx', ANY, 'sub.heel_hook_outside', 0.20,
    'an SLX sweep fails with the leg still entangled', '[E; S: SUBMISSIONS §2.11 inbound]', { fromKind: 'pos' }),
  E('edge.sub.electric_chair_to_sweep', 'sub.banana_split', S1S2, 'pos.ground_mount_low', 0.50,
    'the opponent posts', '[S: BJJ_POS §2.4]'),

  // ---- standing, flying, misc -------------------------------------------
  E('edge.sub.standing_arm_tri_to_ground', 'sub.arm_triangle_standing', S1S2, 'sub.arm_triangle_side', 0.50,
    'the attacker drags it to the mat', '[E]', { enterStage: 'secure' }),
  E('edge.sub.flying_landed_guard', ['sub.triangle_flying', 'sub.armbar_flying'], S1S2,
    'sub.triangle_guard', 0.60, 'the attacker lands in guard', '[S: SUBMISSIONS §3]',
    { enterStage: 'secure', note: 'the flying armbar resolves to sub.armbar_guard, keeping its own clock' }),
  E('edge.sub.flying_slammed', ['sub.triangle_flying', 'sub.armbar_flying'], ['entry'], 'evt.slam', 0.25,
    'def.slam', '[S: SUBMISSIONS §3]', { toKind: 'event', defenderEdge: true }),
  E('edge.pos.scramble_to_bulldog', 'pos.ground_scramble', ANY, 'sub.bulldog', 0.10,
    'the attacker wins the head from the side', '[E; S: SUBMISSIONS §2.20]',
    { fromKind: 'pos', note: 'doubles to 0.20 against a T<=2 defender' }),
  E('edge.pos.bulldog_to_kesa', 'sub.bulldog', ANY, 'pos.ground_kesa_gatame', 0.60,
    'the attacker abandons but keeps the headlock', '[S: SUBMISSIONS §2.20; P E]'),
  E('edge.sub.choke_to_crank',
    ['sub.rnc', 'sub.rnc_short', 'sub.guillotine_standard', 'sub.darce', 'sub.anaconda',
      'sub.arm_triangle_mount', 'sub.arm_triangle_side', 'sub.north_south_choke', 'sub.triangle_guard'],
    ['finish'], 'sub.neck_crank_generic', 0.10,
    'the arm ends on the jaw - "a choke that went wrong"', '[S: SUBMISSIONS §2.22; P E]'),
  E('edge.pos.gnp_turn_away_to_back', 'pos.ground_mount_gnp', ANY, 'pos.ground_back_hooks', 0.50,
    'evt.turn_away: rocked or turtled after strikes', '[S: SUBMISSIONS §3]', { fromKind: 'pos' }),
];

const BY_ID = new Map<ChainEdgeId, ChainEdge>(CHAIN_EDGES.map((e) => [e.id, e]));

export function chainEdge(id: ChainEdgeId): ChainEdge {
  const e = BY_ID.get(id);
  if (!e) throw new Error(`Unknown chain edge: ${id}`);
  return e;
}

export function hasChainEdge(id: ChainEdgeId): boolean {
  return BY_ID.has(id);
}

/** Edges that a failure of `subId` at `stage` can fire. */
export function outgoingEdges(
  subId: string,
  stage: 'entry' | 'secure' | 'finish',
): readonly ChainEdge[] {
  return CHAIN_EDGES.filter((e) =>
    e.fromKind === 'sub'
    && e.from.includes(subId)
    && (e.fromStages.includes('any') || e.fromStages.includes(stage)));
}

/** Edges a §03 positional event can fire. */
export function positionEdges(posId: string): readonly ChainEdge[] {
  return CHAIN_EDGES.filter((e) => e.fromKind === 'pos' && e.from.includes(posId));
}

/** Tier scaling of every edge probability (§4 preamble). */
export function chainTierMult(tier: Tier): number {
  return CHAIN_PARAMS.tierMult[tier] ?? 1;
}

export interface ChainState {
  /** Hops taken inside the current window. */
  readonly hops: number;
  /** Bout time in ms at which the current chain window opened. */
  readonly windowStartMs: number;
}

/** True while the attacker may still chain (§4 loop guard). */
export function chainAllowed(state: ChainState, nowMs: number, tier: Tier): boolean {
  if (chainTierMult(tier) <= 0) return false;
  if (nowMs - state.windowStartMs >= CHAIN_PARAMS.hopWindowMs) return true; // window has rolled over
  return state.hops < CHAIN_PARAMS.hopCap;
}

/**
 * The sampling rule on stage failure (§4). One uniform draw - the `chain` draw
 * `resolveWindow` already took - is compared against the tier-scaled edge
 * probabilities in catalogue order. Falling past the last one means no chain,
 * and the failure follows the catalogue's own escape/abandon routing.
 */
export function sampleChainEdge(
  subId: string,
  stage: 'entry' | 'secure' | 'finish',
  tier: Tier,
  u: number,
  opts: { includeDefenderEdges?: boolean } = {},
): ChainEdge | null {
  const mult = chainTierMult(tier);
  if (mult <= 0) return null;
  let acc = 0;
  for (const e of outgoingEdges(subId, stage)) {
    if (e.defenderEdge && !opts.includeDefenderEdges) continue;
    acc += Math.min(e.p * mult, CHAIN_PARAMS.tierMultCap);
    if (u < acc) return e;
  }
  return null;
}

/** Total tier-scaled chain probability out of a failed stage (for tooling and tests). */
export function totalChainP(
  subId: string,
  stage: 'entry' | 'secure' | 'finish',
  tier: Tier,
  opts: { includeDefenderEdges?: boolean } = {},
): number {
  const mult = chainTierMult(tier);
  let acc = 0;
  for (const e of outgoingEdges(subId, stage)) {
    if (e.defenderEdge && !opts.includeDefenderEdges) continue;
    acc += Math.min(e.p * mult, CHAIN_PARAMS.tierMultCap);
  }
  return acc;
}
