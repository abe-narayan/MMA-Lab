/**
 * Camera director entry point (docs/design/08 §7). Owned by the camera work.
 *
 * `createCameraDirector()` returns the broadcast director. Beyond the
 * `CameraDirector` contract it takes (see docs/design/PHASE8_NOTES.md,
 * "Camera & broadcast graphics"):
 *
 *   setRecording(frames, events)  the whole bout: the edit is planned up front
 *   setReplay(sequencer.state)    the instant-replay angle being shown
 *   setAspect(width / height)     framing needs the viewport shape
 *   free                          the user camera, for `attachFreeCamera`
 *   plan / debug()                the edit and the live readout, for tools
 */
import type { CameraDirector } from '../contract';
import { BroadcastCameraDirector, type BroadcastDirectorOptions } from './director';

export function createCameraDirector(opts: BroadcastDirectorOptions = {}): BroadcastCameraDirector {
  return new BroadcastCameraDirector(opts);
}

/** For a presenter holding a plain `CameraDirector`: is it this one (with the extras)? */
export function isBroadcastDirector(d: CameraDirector | null | undefined): d is BroadcastCameraDirector {
  return d instanceof BroadcastCameraDirector;
}

export { BroadcastCameraDirector } from './director';
export type { BroadcastDirectorOptions, DirectorDebug } from './director';
export {
  planShots, entryAt, classify, contactTime, chooseOperator, StrikeIndex, ShotPlanner, CUT_RULES, TICK_S,
} from './planner';
export type { ShotPlan, ShotPlanEntry, BlockedCut, CutReason, Situation } from './planner';
export {
  planReplays, replayDuration, segmentRequest, ReplaySequencer, REPLAY_RULES,
} from './replay';
export type {
  ReplayPlan, ReplaySegment, ReplayState, ReplayTransport, ReplayRequest, ReplayTrigger,
} from './replay';
export { SHOTS, PLACEMENT, shotLabel } from './shots';
export type { ShotKind, ShotSpec } from './shots';
export { attachFreeCamera, FreeCameraState } from './freeCamera';
export { makeCameraArena, wallDistanceAt, insideWall, panelCentres, postAzimuths } from './geometry';
export type { CameraArena } from './geometry';
export { projectNdc } from './framing';
export { fighterPoints, standInPoints, standInWorldPose } from './keypoints';
export type { FighterPoints } from './keypoints';
