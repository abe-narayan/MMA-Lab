/**
 * POSITION IDS REFERENCED BY CHAPTER 04 (submissions).
 *
 * Chapter 03 (`src/sim/grappling/graph.ts`) owns the ground/clinch node graph
 * and its ids are authoritative. This file is the chapter-04 side of the
 * reconciliation described in 04 §0.1: the 52 node ids the catalogue's entries,
 * escapes and abandon routes name, plus the alias map from each of them to the
 * §03 id.
 *
 * TODO(chapter 03): when `src/sim/grappling/graph.ts` lands, re-export its
 * `PositionId` union here and delete `SUB_POSITION_IDS`; the alias map below is
 * then applied once at load time (`resolvePositionId`) and every catalogue
 * entry resolves mechanically, without touching the catalogue data.
 */
import { POSITION_IDS } from '../core/ids';

/**
 * The 52 position ids chapter 04 references (04 §0.1). The `_bottom` suffix on
 * guard nodes is part of the node name (the guard player is underneath); the
 * attacker's role is carried separately on each catalogue entry.
 */
export const SUB_POSITION_IDS = [
  // standing and clinch
  'pos.standing_long',
  'pos.clinch_collar_tie',
  'pos.clinch_over_under',
  'pos.clinch_whizzer',
  'pos.clinch_rear_body_lock',
  'pos.standing_front_headlock',
  'pos.standing_sprawl',
  // front headlock / turtle / scramble
  'pos.ground_front_headlock',
  'pos.ground_turtle',
  'pos.ground_scramble',
  // mount family
  'pos.ground_mount_low',
  'pos.ground_mount_high',
  'pos.ground_mount_s',
  'pos.ground_mount_technical',
  'pos.ground_mount_gnp',
  // back family
  'pos.ground_back_hooks',
  'pos.ground_back_body_triangle',
  'pos.ground_back_one_hook',
  'pos.ground_back_seatbelt_no_hooks',
  'pos.ground_back_crucifix',
  'pos.ground_crucifix_side',
  'pos.ground_truck',
  // side / top control family
  'pos.ground_side_control',
  'pos.ground_side_control_wall',
  'pos.ground_kesa_gatame',
  'pos.ground_reverse_kesa',
  'pos.ground_knee_on_belly',
  'pos.ground_north_south',
  // half guard family
  'pos.ground_half_flat',
  'pos.ground_half_knee_shield',
  'pos.ground_half_underhook',
  'pos.ground_half_dogfight',
  'pos.ground_half_deep',
  'pos.ground_half_lockdown',
  'pos.ground_half_butterfly',
  // guard family
  'pos.ground_closed_guard_bottom',
  'pos.ground_closed_guard_broken',
  'pos.ground_high_guard',
  'pos.ground_rubber_guard',
  'pos.ground_closed_guard_standing_top',
  'pos.ground_open_guard_kneeling_top',
  'pos.ground_open_supine_legs_up',
  'pos.ground_butterfly',
  'pos.ground_seated_shin_to_shin',
  'pos.ground_x_guard',
  // leg entanglements
  'pos.leg_ashi_slx',
  'pos.leg_outside_ashi',
  'pos.leg_saddle',
  'pos.leg_50_50',
  'pos.leg_cross_ashi',
  // passing / cage
  'pos.ground_hq',
  'pos.ground_cage_seated_bottom',
] as const;

export type SubPositionId = (typeof SUB_POSITION_IDS)[number];

/** Which side of the node the attacker occupies (04 §0.1). */
export type AttackerRole = 'top' | 'bottom' | 'either' | 'standing';

/**
 * Alias map to §03's node ids (04 §0.1, reconciled in 03 §2.2.13). Only the ids
 * whose spelling differs are listed; everything else is identical in both
 * chapters. `resolvePositionId` is the single place the rename happens, so a
 * §03 rename is a one-line change here and nowhere else.
 */
export const POSITION_ALIASES: Readonly<Record<string, string>> = {
  'pos.ground_side_control': 'pos.ground_side',
  'pos.ground_side_control_wall': 'pos.ground_side_wall',
  'pos.leg_saddle': 'pos.ground_saddle',
  'pos.leg_50_50': 'pos.ground_5050',
  'pos.standing_sprawl': 'pos.td_sprawl',
  'pos.ground_scramble': 'pos.scramble',
  // mount + posture flag: §03 has no separate GnP node, it is any mount node
  // with posture = 'postured'.
  'pos.ground_mount_gnp': 'pos.ground_mount_low',
  // both crucifix entries collapse onto one §03 node carrying an origin flag.
  'pos.ground_back_crucifix': 'pos.ground_crucifix',
  'pos.ground_crucifix_side': 'pos.ground_crucifix',
};

/**
 * Extra state §03 needs to disambiguate an aliased node (04 §0.1). Returned
 * alongside the resolved id so the alias is lossless.
 */
export const POSITION_ALIAS_FLAGS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'pos.ground_mount_gnp': { posture: 'postured' },
  'pos.ground_back_crucifix': { crucifixOrigin: 'back' },
  'pos.ground_crucifix_side': { crucifixOrigin: 'side' },
};

/** Resolve a chapter-04 position id to the §03 node id. Identity when no alias. */
export function resolvePositionId(id: string): string {
  return POSITION_ALIASES[id] ?? id;
}

/** The disambiguating flags an aliased id carries into §03, or an empty object. */
export function positionAliasFlags(id: string): Readonly<Record<string, string>> {
  return POSITION_ALIAS_FLAGS[id] ?? {};
}

const POSITION_SET: ReadonlySet<string> = new Set<string>(SUB_POSITION_IDS);

/** True when `id` is a node this chapter knows (before alias resolution). */
export function isSubPositionId(id: string): id is SubPositionId {
  return POSITION_SET.has(id);
}

/**
 * Register the chapter-04 node ids with the global table. `IdTable.add` is
 * idempotent, so once §03 registers the same ids this call becomes a no-op for
 * the shared ones and only contributes the alias sources.
 */
export function registerSubmissionPositionIds(): void {
  POSITION_IDS.addAll(SUB_POSITION_IDS);
}
