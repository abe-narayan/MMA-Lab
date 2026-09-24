/**
 * TAKEDOWN AND REVERSAL CLASSIFICATION — the UFCStats-style definitions that
 * the §4.1 statistics (`record/stats.ts`) and the judges (06) both read.
 *
 * One definition, used everywhere, because the two consumers used to disagree
 * with each other and with the data:
 *
 *  - a takedown ATTEMPT is the first edge of a takedown chain, started from the
 *    feet or the clinch: a leg attack or shot, a throw or trip, a clinch
 *    takedown finish (knee tap, body-lock return, mat return), a go-behind, or
 *    a counter-throw, a snap-down or arm drag that takes the opponent to the
 *    mat or into a leg attack. A clinch entry, a guard pull, a kick catch on
 *    its own and anything started on the mat are not attempts.
 *  - a takedown LANDS when the chain reaches a mat node with the shooter in
 *    slot `a` (on top); `record/stats.ts` adds the §4.1 three-second hold.
 *  - a REVERSAL is a successful bottom-initiated (actor-slot `b`) edge that
 *    goes mat to mat and leaves the actor on top of the destination.
 *
 * Phase 9: before this module the judges scored every clinch entry and guard
 * pull as a takedown; the stats counted every sweep *attempt* (and the non-
 * reversing guard entries filed as sweeps) as a reversal (34 a fight against
 * a real 0.26), and credited a landed takedown with no attempt behind it when
 * a guard pull, a knockdown follow or an escape put the pair on the mat.
 */
import type { PositionId } from '../core/ids';
import {
  grapplingEdge, hasGrapplingEdge, hasPositionNode, positionNode, roleFor,
  type PositionFamily,
} from './graph';

const NON_MAT: ReadonlySet<PositionFamily> = new Set(['standingFree', 'clinch', 'attack', 'transient']);
const FEET: ReadonlySet<PositionFamily> = new Set(['standingFree', 'clinch']);

/** Is this a node where both fighters are down on the mat (not a scramble)? */
export function isMatNode(node: PositionId | string | null | undefined): boolean {
  if (!node || !hasPositionNode(node)) return false;
  return !NON_MAT.has(positionNode(node as PositionId).family);
}

function familyOf(node: string | null | undefined): PositionFamily | null {
  if (!node || !hasPositionNode(node)) return null;
  return positionNode(node as PositionId).family;
}

/** Edges that would pass the structural test but are not takedown attempts. */
const NOT_ATTEMPTS: ReadonlySet<string> = new Set([
  'tech.pull_guard', // the puller goes to his back: UFCStats does not count it
  'tech.kick_catch', // a catch; the takedown off it is `tech.kick_catch_takedown`
]);

/** Attempts that start from the `attack` family (a caught kick). */
const ATTEMPTS_FROM_ATTACK: ReadonlySet<string> = new Set(['tech.kick_catch_takedown']);

/**
 * Does this edge, started from `fromNode`, open a takedown attempt?
 * `fromNode` is the node the actor was in when the edge resolved (the event's
 * `detail.from`); when absent, the edge's own `from` list is used.
 */
export function isTakedownAttempt(edgeId: string | undefined, fromNode?: string | null): boolean {
  if (edgeId === undefined || !hasGrapplingEdge(edgeId)) return false;
  if (ATTEMPTS_FROM_ATTACK.has(edgeId)) return true;
  if (NOT_ATTEMPTS.has(edgeId)) return false;
  const edge = grapplingEdge(edgeId);
  const fam = fromNode ? familyOf(fromNode) : null;
  const fromFeet = fam !== null
    ? FEET.has(fam)
    : edge.from.some((n) => FEET.has(positionNode(n).family));
  if (!fromFeet) return false;
  if (edge.kind === 'capture' || edge.kind === 'throw' || edge.kind === 'counter') return true;
  if (edge.kind === 'entry' || edge.kind === 'finish' || edge.kind === 'advance' || edge.kind === 'cage'
    || edge.kind === 'clinch') {
    return edge.to.some((d) => d.node !== 'same'
      && (familyOf(d.node) === 'attack' || isMatNode(d.node)));
  }
  return false;
}

/**
 * Did this (successful) transition put the actor on top on the mat from the
 * feet, a clinch or a takedown-attack node? `slotA` is the event's `detail.a`.
 */
export function isTakedownLanding(
  fromNode: string | null | undefined, toNode: string | null | undefined,
  success: boolean, actor: number, slotA: number | undefined,
): boolean {
  if (!success || !isMatNode(toNode) || isMatNode(fromNode)) return false;
  if (slotA !== undefined && slotA !== actor) return false;
  const role = roleFor(toNode as PositionId, 'a');
  return role === 'top' || role === 'attacker';
}

/**
 * UFCStats reversal: the bottom fighter comes out on top, mat to mat.
 * `slotA` is the event's `detail.a`.
 */
export function isReversal(
  edgeId: string | undefined, fromNode: string | null | undefined, toNode: string | null | undefined,
  success: boolean, actor: number, slotA: number | undefined,
): boolean {
  if (!success || edgeId === undefined || !hasGrapplingEdge(edgeId)) return false;
  if (grapplingEdge(edgeId).actor !== 'b') return false;
  if (!isMatNode(fromNode) || !isMatNode(toNode)) return false;
  if (slotA === undefined || slotA !== actor) return false;
  return roleFor(toNode as PositionId, 'a') === 'top';
}
