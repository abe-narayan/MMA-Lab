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
  /** Heel lift of the foot when it left the floor (the swing's lift starts here, so the foot does not snap). */
  fromLift: number;
  /** A deliberate novice cross-step (its landing is not re-aimed in flight). */
  crossed: boolean;
  /**
   * How far past its landing the step is aimed (ms of the body's smoothed
   * travel): a moving fighter plants ahead of where the body will be, so each
   * step covers ground instead of catching up (see `updateFeet`).
   */
  lead: number;
}

export interface FootState {
  ball: V3;
  yaw: number;
  swing: Swing | null;
  /** sim ms of the last landing. */
  landedAt: number;
  /** Heel lift this foot was last drawn with while planted. */
  lift: number;
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

/**
 * Reset a delta to `createDelta()`'s values in place (pass 3: a fresh delta
 * per fighter per frame was ~20 small arrays of garbage a frame, and the
 * collector's pauses showed in the frame-time tail). Layers replace the
 * array fields they write with fresh arrays, so zeroing in place is safe.
 */
export function resetDelta(d: Delta): Delta {
  const z = (v: V3): void => { v[0] = 0; v[1] = 0; v[2] = 0; };
  z(d.rootOff); d.rootFns.length = 0; z(d.pelvisOff); z(d.pelvisWorld);
  d.pelvisYaw = 0; d.pelvisPitch = 0; d.pelvisRoll = 0;
  d.spineYaw = 0; d.spinePitch = 0; d.spineRoll = 0;
  d.headYaw = 0; d.headPitch = 0; d.headRoll = 0; d.lookW = 1;
  d.clavRaise[0] = 0; d.clavRaise[1] = 0; d.clavFwd[0] = 0; d.clavFwd[1] = 0;
  d.frameYaw = 0; d.stanceWidth = 1; d.bounce = 1; d.heel = 1;
  for (const c of d.feet) {
    c.pivot = 0; c.lift = 0; c.liftW = 0; c.liftAdd = 0; c.ankle = null; c.ankleW = 0; c.pole = null;
    c.airPitch = 0; c.hold = false; c.land = null; c.landYaw = null;
  }
  d.face.fill(0);
  z(d.evade); d.guardDrop = 0; d.guardDown = 0;
  z(d.handOff[0]); z(d.handOff[1]);
  d.idle = null;
  return d;
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
  /**
   * Getting up off a body still on the canvas: the old (grapple) pose first
   * slides out sideways at its own height to where he stands, then the blend
   * lifts him — so he rises beside the body, not through it.
   */
  slide?: boolean;
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
  /** Which feet are planted on the floor this frame. */
  planted: [boolean, boolean];
  /**
   * How much each foot's target binds the pelvis height (1: planted or stepping,
   * fading to 0 as an action takes the leg over), so the reach clamp never
   * switches a constraint on or off in one frame.
   */
  reachW: [number, number];
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
  /** The strike and defence running last frame (`s:id@commit`, `d:motion@contact`), to fade out their end. */
  actStrike: string;
  actDefence: string;
  /**
   * Where each foot stood in the last displayed pose when the fighter came back
   * to his feet from a clinch, the ground or the canvas (ball point and yaw), or
   * null: the footwork starts from there instead of teleporting the feet under
   * the stance (they then step into it).
   */
  feetSeed: [{ ball: V3; yaw: number } | null, { ball: V3; yaw: number } | null] | null;
  /**
   * This frame's weapon as the strike pass aimed it (null: no strike): the aim
   * point it used, and for a kick the leg's solved ankle target and knee pole.
   * The contact pass re-solves the weapon on the FINAL poses from these.
   */
  weapon: WeaponLock | null;
  /** The latched contact aim once the contact pass has made it final (identity compare). */
  contactFinal: V3 | null;
  /**
   * Guard / defence hand targets and elbow poles as drawn, in the chest frame,
   * with their velocities: the critically damped follow of pass 2a (null until
   * the first standing frame after a reset).
   */
  handF: [HandFollow, HandFollow] | null;
  /** Which side of a lying body the standing root is kept on (±1; 0: none). */
  clearSide: number;
  /**
   * The body's travel velocity as the footwork reads it (world, m/s): the
   * display root's velocity through a critically damped follow (~0.2 s), so
   * the sim's 100 ms stop-go surges plan steps from their average rather than
   * re-stepping at every surge (null until the first standing frame).
   */
  loco: { v: V3; a: V3 } | null;
  /** Scratch for this frame's idle residual (see `Delta.idle`). */
  idleBuf: Float64Array | null;
  /** The pelvis reach drop as applied (m) and its rate: it is released with inertia (`buildBody`). */
  pelDrop: { v: number; vel: number } | null;
}

export interface HandFollow { p: V3; v: V3; q: V3; qv: V3; at: number }

export interface WeaponLock {
  hand: -1 | 0 | 1;
  leg: -1 | 0 | 1;
  aim: V3;
  /** Kicks: the ankle target and pole the strike pass solved the leg to. */
  ankle: V3 | null;
  pole: V3 | null;
}

export function createFighterState(index: number, id: number, rig: RigInfo, tiers: FighterTiers, seed: number): FighterState {
  return {
    index, id, rig, tiers, seed,
    pose: createPose(), world: createWorldPose(),
    feet: [
      { ball: [0, 0, 0], yaw: 0, swing: null, landedAt: -1e9, lift: 0 },
      { ball: [0, 0, 0], yaw: 0, swing: null, landedAt: -1e9, lift: 0 },
    ],
    latch: null, knownAt: 0, contactAim: null, lastMs: -1, stepCount: 0,
    mode: 'standing', modeSince: 0, fade: null, knock: null, prevPosture: 'standing',
    lastYaw: 0, initialised: false, planted: [true, true], reachW: [1, 1], debugLayer: 'L0',
    delta: createDelta(), spec: createSpec({ ox: 0, oz: 0, yaw: 0, c: 1, s: 0 }), lastSpec: null,
    displayRoot: [0, 0, 0], displayVel: [0, 0, 0], ikTargets: [],
    cap: null, capAction: null, capDefence: null, actStrike: '', actDefence: '', feetSeed: null, weapon: null, contactFinal: null, handF: null, clearSide: 0, loco: null, idleBuf: null, pelDrop: null,
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
