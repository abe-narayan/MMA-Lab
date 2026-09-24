/**
 * SUBMISSION OFFERS — which chapter 04 submissions a §03 node offers to which
 * slot, built once from the catalogue's own entry positions.
 *
 * Chapter 04 names its entry positions in its own vocabulary
 * (`pos.ground_side_control`, `pos.ground_closed_guard_bottom`, ...) and gives
 * every entry the attacker's role there (`top`, `bottom`, `either`,
 * `standing`). This table resolves each entry onto the §03 node through
 * `resolvePositionAlias` and onto a slot through the node's slot labels, so the
 * AI's candidate list, the binder's "is this hold still possible here" check
 * and invariant I5 all read one answer.
 *
 * Phase 9: the AI used to look the catalogue up by the raw chapter-04 id and
 * ignore the role, so a side control, a closed guard or a half guard offered
 * no submissions at all (their §04 ids differ from §03's), while the nodes
 * whose ids happened to match (the back, the turtle, mount) offered every
 * submission to *both* fighters — the defender on the bottom of back control
 * could "attack" a rear-naked choke. And I5 read the node's short generic
 * threat list (`sub.arm_triangle`), which the catalogue's variants
 * (`sub.arm_triangle_mount`) never matched.
 */
import type { PositionId } from '../core/ids';
import {
  SUBMISSION_CATALOGUE, type SubmissionEntry, type SubmissionSpec,
} from '../submissions/catalogue';
import { hasPositionNode, positionNode, resolvePositionAlias, roleFor } from './graph';

export interface SubOffer {
  spec: SubmissionSpec;
  entry: SubmissionEntry;
}

const OFFERS = new Map<string, SubOffer[]>();

function key(node: string, slot: 'a' | 'b'): string {
  return `${node}|${slot}`;
}

function slotsFor(node: PositionId, role: SubmissionEntry['role']): Array<'a' | 'b'> {
  const n = positionNode(node);
  const aRole = roleFor(node, 'a');
  const aLeads = aRole === 'top' || aRole === 'attacker';
  switch (role) {
    case 'top': return aLeads || n.symmetric ? ['a'] : [];
    case 'bottom': return ['b'];
    case 'either': return ['a', 'b'];
    // Standing entries (guillotines off a shot, a standing RNC off a rear body
    // lock): the controlling slot, or either side of a symmetric tie.
    case 'standing': return n.symmetric ? ['a', 'b'] : ['a'];
    default: return [];
  }
}

for (const spec of SUBMISSION_CATALOGUE) {
  for (const entry of spec.entryPositions) {
    let node: PositionId;
    try {
      node = resolvePositionAlias(entry.pos);
    } catch {
      continue;
    }
    if (!hasPositionNode(node)) continue;
    for (const slot of slotsFor(node, entry.role)) {
      const k = key(node, slot);
      const list = OFFERS.get(k);
      const offer: SubOffer = { spec, entry };
      if (list) {
        // One offer per (submission, slot): the first entry at the node wins.
        if (!list.some((o) => o.spec.id === spec.id)) list.push(offer);
      } else OFFERS.set(k, [offer]);
    }
  }
}

/** The submissions this node offers to the fighter in `slot`, catalogue order. */
export function subOffers(node: PositionId | string, slot: 'a' | 'b'): readonly SubOffer[] {
  return OFFERS.get(key(node, slot)) ?? [];
}

/** Does the catalogue offer this submission (or a member of its family) here? */
export function subOfferedAt(node: PositionId | string, slot: 'a' | 'b', submission: string): boolean {
  const list = OFFERS.get(key(node, slot));
  if (!list) return false;
  return list.some((o) => o.spec.id === submission || o.spec.id.startsWith(`${submission}_`));
}
