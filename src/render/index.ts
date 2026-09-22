/**
 * Public surface of the 3D renderer (workstream 1).
 *
 * The replay UI only needs `ArenaRenderer`, `CameraMode` and `RendererOptions`;
 * the rest is exported so that tooling, tests or a future overlay can reuse the
 * arena constants and the rig without reaching into module internals.
 */

export { ArenaRenderer } from './renderer';
export type { RendererOptions, CameraMode } from './renderer';

export { CameraRig, CAMERA_DEFAULTS } from './cameras';

export { FighterRig, contactPhase } from './fighterRig';
export type { RigOptions, SnapshotFighter } from './fighterRig';

export {
  Arena,
  CAGE_RADIUS,
  CAGE_HEIGHT,
  OCTAGON_PHASE,
  PALETTE,
  CORNER_A,
  CORNER_B,
  cornerColour,
  disposeObject3D,
} from './arena';
export type { ArenaOptions, ArenaPalette, ImpactKind } from './arena';
