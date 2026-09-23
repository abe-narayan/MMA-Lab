/**
 * The paired-pose library: every POSITIONS id maps to a bespoke pose, or is
 * listed in `GENERIC_NODES` as borrowing a close relative's pose.
 */
import type { NodePose } from './types';
import { GROUND_POSES } from './ground';
import { CLINCH_POSES } from './clinch';
import { ATTACK_POSES } from './attack';
import { GUARD_POSES } from './guard';
import { LEG_POSES } from './legs';

export const NODE_POSES: Readonly<Record<string, NodePose>> = {
  ...CLINCH_POSES,
  ...ATTACK_POSES,
  ...GROUND_POSES,
  ...GUARD_POSES,
  ...LEG_POSES,
};

/**
 * Nodes without a bespoke pose, and the node whose pose they borrow. Kept
 * explicit so coverage is auditable (tests assert every POSITIONS id is in
 * exactly one of the two tables).
 */
export const GENERIC_NODES: Readonly<Record<string, string>> = {};

export function nodePoseFor(node: string): NodePose | null {
  const p = NODE_POSES[node];
  if (p) return p;
  const g = GENERIC_NODES[node];
  if (g && NODE_POSES[g]) return NODE_POSES[g];
  return null;
}
