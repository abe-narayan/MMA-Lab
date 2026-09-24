/**
 * Per-fighter animation state and the per-frame context every layer reads.
 *
 * Layer protocol: each frame, the layers (stance, action, defence, reaction,
 * condition) ADD into one `Delta` — root offsets, pelvis and torso angles,
 * head angles, foot controls — and `stance.ts` turns stance + delta into a
 * `BodySpec`. Hands are resolved in a second pass (after every body has been
 * solved) because strikes aim at the opponent's solved body.
 */
import type { FighterSnapshot, SimEvent } from '../../sim';
import type { Pose, WorldPose } from '../rig/skeleton';
import { createPose, createWorldPose } from '../rig/skeleton';
import { FACE_CHANNELS } from '../rig/skeleton';
import type { Frame, V3 } from './math';
import type { BodySpec, RigInfo } from './spec';
import { createFoot, createHand } from './spec';
import type { FighterTiers } from './tier';
import type { ActionTiming } from './timing';
import type { CapRig, SwingProfile } from './capture';
import type { CapAction, CapDefence } from './capStrikes';

export interface Swing {
  t0: number;
  dur: number;
  fromBall: V3;
  fromYaw: number;
  toBall: V3;
  toYaw: number;
  height: number;
  /** Captured step this swing follows (foot progress / height curves, upper-body residual), if any. */
  cap: SwingProfile | null;
}

export interface FootState {
  ball: V3;
  yaw: number;
  swing: Swing | null;
  /** sim ms of the last landing. */
  landedAt: number;
}

export interface FootCtl {
  /** Added to the planted yaw while active (pivot on the ball; the ball does not move). */
  pivot: number;
  /** Heel lift override (radians) and its weight. */
  lift: number;
  liftW: number;
  /** Additive heel lift (captured heel rise on top of the stance's). */
  liftAdd: number;
  /** Direct ankle target (kicks, knees, checks) and its weight. */
  ankle: V3 | null;
  ankleW: number;
  pole: V3 | null;
  airPitch: number;
  /** Suppress new steps on this foot. */
  hold: boolean;
  /** Where the foot should land when the action releases it (world ball). */
  land: V3 | null;
  landYaw: number | null;
}

export function createFootCtl(): FootCtl {
  return { pivot: 0, lift: 0, liftW: 0, liftAdd: 0, ankle: null, ankleW: 0, pole: null, airPitch: 0, hold: false, land: null, landYaw: null };
}

export interface Delta {
  /** Moves the stance frame (feet targets and pelvis), local metres. */
  rootOff: V3;
  /** The same offsets as pure functions of sim time, so the feet can step ahead of them. */
  rootFns: ((ms: number) => V3)[];
  /** Pelvis only (weight shift), local metres; y = height. */
  pelvisOff: V3;
  /** Pelvis weight shift in WORLD metres (e.g. over a support foot during a spin). */
  pelvisWorld: V3;
  pelvisYaw: number;
  pelvisPitch: number;
  pelvisRoll: number;
  spineYaw: number;
  spinePitch: number;
  spineRoll: number;
  headYaw: number;
  headPitch: number;
  headRoll: number;
  lookW: number;
  clavRaise: [number, number];
  clavFwd: [number, number];
  /** Rotates the stance frame (spins, turning away). */
  frameYaw: number;
  stanceWidth: number;
  bounce: number;
  heel: number;
  feet: [FootCtl, FootCtl];
  face: Float32Array;
  /** Intended head displacement from defensive movement (world), for miss aiming. */
  evade: V3;
  /** 0..1 how much the guard hands are replaced by defence hands. */
  guardDrop: number;
  /** Extra guard lowering (m) and forward offset. */
  guardDown: number;
  /** Additive hand offsets (local frame) from reactions/conditions. */
  handOff: [V3, V3];
  /**
   * Normalised idle residuals from the capture (`capture.ts` CH order), or null
   * for the procedural idle noise.
   */
  idle: Float64Array | null;
}

export function createDelta(): Delta {
  return {
    rootOff: [0, 0, 0], rootFns: [], pelvisOff: [0, 0, 0], pelvisWorld: [0, 0, 0],
    pelvisYaw: 0, pelvisPitch: 0, pelvisRoll: 0,
    spineYaw: 0, spinePitch: 0, spineRoll: 0,
    headYaw: 0, headPitch: 0, headRoll: 0, lookW: 1,
    clavRaise: [0, 0], clavFwd: [0, 0],
    frameYaw: 0, stanceWidth: 1, bounce: 1, heel: 1,
    feet: [createFootCtl(), createFootCtl()],
    face: new Float32Array(FACE_CHANNELS.length),
    evade: [0, 0, 0], guardDrop: 0, guardDown: 0,
    handOff: [[0, 0, 0], [0, 0, 0]],
    idle: null,
  };
}

export function createSpec(fr: Frame): BodySpec {
  return {
    frame: fr, pelvis: [0, 1, 0], pelvisYaw: 0, pelvisPitch: 0, pelvisRoll: 0,
    spineYaw: 0, spinePitch: 0, spineRoll: 0,
    head: { lookAt: null, lookW: 0, yaw: 0, pitch: 0, roll: 0 },
    clavRaise: [0, 0], clavFwd: [0, 0],
    hands: [createHand(), createHand()], feet: [createFoot(), createFoot()],
    face: new Float32Array(FACE_CHANNELS.length), free: false,
  };
}

export type Mode = 'standing' | 'grapple' | 'down' | 'out' | 'getup';

export interface Fade {
  from: Pose;
  t0: number;
  dur: number;
}

export interface KnockInfo {
  t0: number;
  kind: 'flash' | 'hurt' | 'ko' | 'body' | 'leg' | 'slip';
  /** Fall direction in the fighter's frame: +1 backward, -1 forward. */
  back: number;
  /** Lateral lean: +1 falls to own right. */
  side: number;
  cause: string | null;
}

/** Everything the animator keeps between frames for one fighter. */
export interface FighterState {
  index: number;
  id: number;
  rig: RigInfo;
  tiers: FighterTiers;
  seed: number;
  pose: Pose;
  world: WorldPose;
  feet: [FootState, FootState];
  latch: ActionTiming | null;
  /** When the latched action's result first became known (sim ms). */
  knownAt: number;
  contactAim: V3 | null;
  lastMs: number;
  stepCount: number;
  mode: Mode;
  modeSince: number;
  fade: Fade | null;
  knock: KnockInfo | null;
  prevPosture: string;
  /** Last display facing (for the frame when the opponent is directly on top). */
  lastYaw: number;
  initialised: boolean;
  /** Which feet are planted on the floor this frame (for the pelvis reach clamp). */
  planted: [boolean, boolean];
  debugLayer: string;
  /** Scratch: this frame's delta / spec / frame (valid during evaluate). */
  delta: Delta;
  spec: BodySpec;
  lastSpec: BodySpec | null;
  displayRoot: V3;
  displayVel: V3;
  /** Previous-frame guard targets for idle smoothing. */
  ikTargets: { name: string; pos: [number, number, number] }[];
  /** Motion capture as seen by this body (null: procedural only). */
  cap: CapRig | null;
  /** Capture plans of the current strike / defence (keyed so a seek rebuilds them). */
  capAction: { key: string; plan: CapAction | null } | null;
  capDefence: { key: string; plan: CapDefence | null } | null;
}

export function createFighterState(index: number, id: number, rig: RigInfo, tiers: FighterTiers, seed: number): FighterState {
  return {
    index, id, rig, tiers, seed,
    pose: createPose(), world: createWorldPose(),
    feet: [
      { ball: [0, 0, 0], yaw: 0, swing: null, landedAt: -1e9 },
      { ball: [0, 0, 0], yaw: 0, swing: null, landedAt: -1e9 },
    ],
    latch: null, knownAt: 0, contactAim: null, lastMs: -1, stepCount: 0,
    mode: 'standing', modeSince: 0, fade: null, knock: null, prevPosture: 'standing',
    lastYaw: 0, initialised: false, planted: [true, true], debugLayer: 'L0',
    delta: createDelta(), spec: createSpec({ ox: 0, oz: 0, yaw: 0, c: 1, s: 0 }), lastSpec: null,
    displayRoot: [0, 0, 0], displayVel: [0, 0, 0], ikTargets: [],
    cap: null, capAction: null, capDefence: null,
  };
}

/** Per-frame context for one fighter. */
export interface Ctx {
  nowMs: number;
  st: FighterState;
  f: FighterSnapshot;
  /** Interpolated snapshot fields the layers read continuously. */
  fatigue: FighterSnapshot['fatigueVisual'];
  /** +1 orthodox (left lead), -1 southpaw. */
  sd: number;
  /** Lead side index: 0 = left. */
  lead: 0 | 1;
  frame: Frame;
  opp: FighterState | null;
  oppSnap: FighterSnapshot | null;
  /** Display distance to the opponent (ground). */
  dist: number;
  vel: V3;
  my: ActionTiming | null;
  incoming: { t: ActionTiming; from: FighterState; fromSnap: FighterSnapshot }[];
  events: readonly SimEvent[];
  states: ReadonlySet<string>;
}
