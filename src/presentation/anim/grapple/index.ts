/**
 * Grappling animation module entry (docs/design/08 §5.7). Importing this
 * module registers the paired-pose solver with the standing animator's
 * hand-off (`../grappleApi.ts`).
 */
import { registerGrappleSolver } from '../grappleApi';
import { GrappleSolverImpl } from './solver';

export { GrappleSolverImpl, buildRequest, likelyDestination } from './solver';
export { Composer, nodeSpec } from './compose';
export { NODE_POSES, GENERIC_NODES, nodePoseFor } from './poses';
export { scaledRest, restForBody } from './rest';
export type { PairRequest, FlightRequest, SubRequest, StrikeRequest } from './request';

export const grappleSolverInstance = new GrappleSolverImpl();
registerGrappleSolver(grappleSolverInstance);
