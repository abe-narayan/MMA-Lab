/**
 * THE SHOT LIST — every camera the director can take, with its parameters.
 *
 * Placement mirrors a televised cage fight's camera plan (docs/design/08 §7.1):
 * a hard camera on a platform high on one side, handheld operators working the
 * apron at the fence, a robotic overhead on the lighting truss, a jib behind
 * the front rows, and apron robotics at each corner. The same table drives the
 * live director, the replay angles and the dev page's shot list.
 */

export type ShotKind =
  | 'main' | 'mainTight' | 'reverse' | 'cageside' | 'ground' | 'overhead'
  | 'jib' | 'corner' | 'finish'
  // user modes
  | 'follow' | 'orbit' | 'free';

export type FramingSetName = 'full' | 'torso' | 'face' | 'ground';

export interface ShotSpec {
  /** Short label for the graphics and the debug readout. */
  label: string;
  /** Wide shots: the lens must stay outside the fence (checked by the tests). */
  wide: boolean;
  /** Which body points must stay in frame. */
  framing: FramingSetName;
  /** Fraction of the frame the framed points should fill (goal). */
  safe: number;
  /** Vertical field of view limits, degrees. */
  fovMin: number;
  fovMax: number;
  /** Aim spring (rad/s): how quickly the operator pans onto the action. */
  aimOmega: number;
  /** Zoom springs (rad/s): zooming out to keep a fighter in is faster than zooming in. */
  zoomInOmega: number;
  zoomOutOmega: number;
  /** Handheld float, degrees of rotation at 1 — 0 for locked-off and robotic heads. */
  handheldDeg: number;
  /** Live depth of field strength (0 = off); replays add their own. */
  dof: number;
  /** Strike and slam shake multiplier. */
  shake: number;
  /**
   * The frame is never tighter than this many metres tall at the subject, so
   * a compact ground position still reads with some canvas around it.
   */
  minFrameM: number;
}

export const SHOTS: Readonly<Record<ShotKind, ShotSpec>> = {
  main: {
    label: 'MAIN', wide: true, framing: 'full', safe: 0.64, fovMin: 7, fovMax: 52,
    aimOmega: 2.2, zoomInOmega: 1.1, zoomOutOmega: 3.8, handheldDeg: 0.04, dof: 0, shake: 1, minFrameM: 2.7,
  },
  mainTight: {
    label: 'MAIN TIGHT', wide: true, framing: 'torso', safe: 0.7, fovMin: 5, fovMax: 40,
    aimOmega: 2.6, zoomInOmega: 1.3, zoomOutOmega: 4.5, handheldDeg: 0.04, dof: 0, shake: 1, minFrameM: 1.25,
  },
  reverse: {
    label: 'REVERSE', wide: true, framing: 'full', safe: 0.62, fovMin: 7, fovMax: 52,
    aimOmega: 2.2, zoomInOmega: 1.1, zoomOutOmega: 3.8, handheldDeg: 0.04, dof: 0, shake: 1, minFrameM: 2.7,
  },
  cageside: {
    label: 'CAGESIDE', wide: false, framing: 'torso', safe: 0.72, fovMin: 16, fovMax: 68,
    aimOmega: 3.2, zoomInOmega: 1.6, zoomOutOmega: 5, handheldDeg: 0.55, dof: 0.35, shake: 1.4, minFrameM: 1.25,
  },
  ground: {
    label: 'CAGESIDE LOW', wide: false, framing: 'ground', safe: 0.62, fovMin: 16, fovMax: 70,
    aimOmega: 3, zoomInOmega: 1.4, zoomOutOmega: 5, handheldDeg: 0.45, dof: 0.35, shake: 1.2, minFrameM: 1.5,
  },
  overhead: {
    label: 'OVERHEAD', wide: false, framing: 'ground', safe: 0.62, fovMin: 12, fovMax: 58,
    aimOmega: 1.6, zoomInOmega: 1, zoomOutOmega: 3.5, handheldDeg: 0, dof: 0, shake: 0.3, minFrameM: 3.0,
  },
  jib: {
    label: 'JIB', wide: true, framing: 'full', safe: 0.5, fovMin: 26, fovMax: 60,
    aimOmega: 1.2, zoomInOmega: 0.8, zoomOutOmega: 2, handheldDeg: 0.03, dof: 0, shake: 0, minFrameM: 4,
  },
  corner: {
    label: 'CORNER', wide: false, framing: 'face', safe: 0.55, fovMin: 8, fovMax: 45,
    aimOmega: 2.4, zoomInOmega: 1.2, zoomOutOmega: 4, handheldDeg: 0.45, dof: 0.45, shake: 0, minFrameM: 0.75,
  },
  finish: {
    label: 'CAGESIDE', wide: false, framing: 'torso', safe: 0.6, fovMin: 10, fovMax: 60,
    aimOmega: 2.4, zoomInOmega: 1.2, zoomOutOmega: 4, handheldDeg: 0.6, dof: 0.4, shake: 0.6, minFrameM: 1.1,
  },
  follow: {
    label: 'FOLLOW', wide: false, framing: 'full', safe: 0.72, fovMin: 24, fovMax: 70,
    aimOmega: 3, zoomInOmega: 1.6, zoomOutOmega: 5, handheldDeg: 0, dof: 0, shake: 0.5, minFrameM: 2,
  },
  orbit: {
    label: 'ORBIT', wide: false, framing: 'full', safe: 0.7, fovMin: 20, fovMax: 70,
    aimOmega: 4, zoomInOmega: 3, zoomOutOmega: 5, handheldDeg: 0, dof: 0, shake: 0, minFrameM: 1,
  },
  free: {
    label: 'FREE', wide: false, framing: 'full', safe: 0.7, fovMin: 20, fovMax: 75,
    aimOmega: 8, zoomInOmega: 8, zoomOutOmega: 8, handheldDeg: 0, dof: 0, shake: 0, minFrameM: 0.5,
  },
};

/** Where the operators physically are (metres), per shot. */
export const PLACEMENT = {
  /** Handheld lens distance outside the fence line (through-the-mesh shots). */
  handheldOutsideM: 0.35,
  handheldHeightM: 1.55,
  /** Over-the-top handheld: lens this far above the top rail. */
  overRailM: 0.5,
  /** Low handheld on the apron for ground work. */
  groundHeightM: 0.62,
  /** Robotic overhead on the truss. */
  overheadHeightM: 7.6,
  /** Off-vertical tilt of the overhead, toward the hard camera side, degrees. */
  overheadTiltDeg: 7,
  /** Corner robotics: lens height and extra offset outside the fence. */
  cornerHeightM: 1.35,
  cornerOutsideM: 0.55,
  /** Jib arm: radius beyond the fence and height range. */
  jibOutsideM: 3.4,
  jibHeightM: [3.8, 7.4] as const,
} as const;

export function shotLabel(kind: ShotKind, replay = false): string {
  const base = SHOTS[kind].label;
  return replay ? `REPLAY · ${base}` : base;
}
