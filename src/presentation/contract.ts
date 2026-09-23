/**
 * PRESENTATION CONTRACT — how the 3D broadcast is put together.
 *
 * Five modules build the picture, each owned separately, each replaceable:
 *
 *   stage/      renderer, post-processing pipeline, quality presets, frame loop
 *   arena/      the venue: cage/ring/mat/street, lighting rig, crowd, officials
 *   character/  a fighter's body: morphed mesh, skin, kit, damage, sweat
 *   anim/       where every bone points this frame
 *   camera/     the broadcast director: shots, cuts, replays, free camera
 *
 * `presenter.ts` composes them behind the `Presenter3D` interface, which the
 * Watch screen drives exactly as it drives the 2D canvas today.
 *
 * Two rules hold across all of it (docs/design/08 §2.1, 09 §1.3.2):
 *
 *   1. **Presentation never changes the fight.** Nothing here imports sim
 *      internals — only the public `src/sim` API — and nothing writes to sim
 *      state. A bout replays identically with or without a GPU.
 *
 *   2. **What you see is a function of what was recorded.** Given the same
 *      frames, alpha and camera request, every module produces the same picture.
 *      Smoothing filters and cosmetic randomness are allowed, but they are
 *      seeded from the bout and reset on seek, so scrubbing backwards and
 *      forwards shows the same fight.
 *
 * Coordinates everywhere: Y up, metres, fighters face along the sim's `facing`
 * (radians, atan2(dx, dz)), the sim's (x, z) floor plane is three.js (x, z).
 */
import type * as THREE from 'three';
import type {
  Arena, FighterDefinition, FighterRuntime, SimEvent, TickSnapshot,
} from '../sim';
import type { Pose, RestSkeleton, WorldPose } from './rig/skeleton';

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

/**
 * Everything a preset controls. The target machine is an Intel Arc 140V
 * integrated GPU; "high" is the 60 fps target there at 1440p output, and
 * "ultra" is for discrete GPUs (docs/ENGINE_DECISION.md). The stage owns the
 * canonical table; other modules read the fields that concern them.
 */
export interface QualitySettings {
  level: QualityLevel;
  /** Internal render resolution as a fraction of the output resolution. */
  renderScale: number;
  /** How the internal image reaches output resolution. */
  upscale: 'none' | 'taau' | 'fsr1';
  antialias: 'fxaa' | 'smaa' | 'traa';
  maxPixelRatio: number;
  shadows: 'off' | 'hard' | 'soft';
  shadowMapSize: number;
  ambientOcclusion: boolean;
  screenSpaceReflections: boolean;
  bloom: boolean;
  /** Depth of field and motion blur are replay-only effects in broadcast grammar. */
  replayDepthOfField: boolean;
  replayMotionBlur: boolean;
  /** Skin: pre-integrated subsurface scattering; off falls back to a wrapped diffuse. */
  skinScattering: boolean;
  sweatAndDamage: boolean;
  crowd: 'off' | 'sprites' | 'instanced';
  crowdCount: number;
  /** Highest detail level a fighter may use (0 = full). */
  maxCharacterLOD: 0 | 1 | 2 | 3;
}

// ---------------------------------------------------------------------------
// Bout-level and frame-level inputs
// ---------------------------------------------------------------------------

export type GloveKind = 'mma4oz' | 'boxing10oz' | 'boxing16oz' | 'grappling' | 'bare';

/** Everything a module needs to know about a bout that does not change per frame. */
export interface BoutPresentation {
  fighters: readonly FighterDefinition[];
  /** `deriveRuntime` output per fighter: rig proportions, tiers, composites. */
  runtimes: readonly FighterRuntime[];
  teamOf: readonly number[];
  arena: Arena;
  rulesetId: string;
  /** Glove worn under this ruleset (MMA 4 oz, boxing, bare for grappling/street). */
  glove: GloveKind;
  /** Corner colour per fighter, CSS hex. Red/blue in 1v1; team colours otherwise. */
  cornerColours: readonly string[];
  /** Presentation-only setting from `MatchSettings.blood`. */
  blood: boolean;
  /** A stable seed for cosmetic variation (crowd, sweat noise). Never the sim RNG. */
  cosmeticSeed: string;
}

/** Everything that changes per rendered frame. */
export interface FrameInput {
  frame: TickSnapshot;
  next: TickSnapshot | null;
  /** Interpolation 0..1 between `frame` and `next`. */
  alpha: number;
  /** Interpolated simulated seconds since the opening horn. */
  simTime: number;
  /** Recent events (at least the last two seconds). */
  events: readonly SimEvent[];
  /** Playback speed; < 1 is slow motion. Effects that depend on real motion read it. */
  playbackRate: number;
  /** True while an instant replay is showing. Enables replay-only post effects. */
  replay: boolean;
  /** True on the first frame after a seek: every smoothing filter must snap. */
  discontinuity: boolean;
}

// ---------------------------------------------------------------------------
// Animation
// ---------------------------------------------------------------------------

export interface AnimDebug {
  layer: string;
  technique: string | null;
  phase: number;
  ikTargets: { name: string; pos: [number, number, number] }[];
  tierRules: readonly string[];
}

export interface Animator {
  /**
   * Called once per bout, after the characters are built, with each body's
   * rest skeleton (so a long-armed fighter's IK chains are long).
   */
  setBout(bout: BoutPresentation, rests: readonly RestSkeleton[]): void;
  /** Write every fighter's pose for this frame into `out` (one Pose per fighter). */
  evaluate(input: FrameInput, realDt: number, out: Pose[]): void;
  /** Drop all smoothing and transient state (called on seek). */
  reset(): void;
  debug(fighter: number): AnimDebug;
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

/** Per-frame look of one fighter, derived from the snapshot's visual fields. */
export interface CharacterVisualState {
  /** 0-1: builds with work rate and round time. */
  sweat: number;
  /** 0-1: skin flush from exertion. */
  flush: number;
  /** 8 damage zones, 0-1 (order in docs/design/08 §2.2). */
  damageZones: readonly number[];
  /** 8 swelling zones, 0-1. */
  swelling: readonly number[];
  cuts: readonly { site: string; severity: 1 | 2 | 3; bleeding: boolean; ageS: number }[];
  bloodOnGloves: number;
  /** When false, cuts render as closed marks and no blood is drawn. */
  blood: boolean;
  /** 0-1 fatigue, for breathing and posture cues the mesh itself shows. */
  fatigue: number;
}

export interface CharacterActor {
  readonly fighterId: number;
  readonly object3d: THREE.Object3D;
  /** Joint positions of this body, from its morphed mesh. */
  readonly rest: RestSkeleton;
  applyPose(pose: Pose): void;
  setVisualState(state: CharacterVisualState): void;
  setLOD(level: 0 | 1 | 2 | 3): void;
  dispose(): void;
}

export interface CharacterFactory {
  /** Fetch and decode shared assets (base mesh, targets, textures). Idempotent. */
  preload(): Promise<void>;
  create(bout: BoutPresentation, fighterIndex: number, quality: QualitySettings): CharacterActor;
}

// ---------------------------------------------------------------------------
// Arena
// ---------------------------------------------------------------------------

export interface ArenaSet {
  readonly object3d: THREE.Object3D;
  /** Where cameras may go: inside radius for handhelds, outside for the jib and crowd shots. */
  readonly bounds: { fightRadiusM: number; outerRadiusM: number; ceilingM: number };
  /** Environment lighting for PBR materials (image-based lighting). */
  readonly environment: THREE.Texture | null;
  /** Referee, crowd reactions, screens: anything that responds to the fight. */
  update(input: FrameInput, fighters: readonly WorldPose[], realDt: number): void;
  setQuality(q: QualitySettings): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

export type CameraMode = 'broadcast' | 'cageside' | 'overhead' | 'follow' | 'orbit' | 'free';

export interface CameraRequest {
  mode: CameraMode;
  followId?: number;
}

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  fovDeg: number;
  rollRad: number;
  /** Depth of field: focus distance (m) and strength 0-1 (0 = off). */
  focusM: number;
  dof: number;
  /** True on the frame of a hard cut: temporal effects must drop their history. */
  cut: boolean;
  /** Short label for the broadcast graphics ("CAGESIDE", "REPLAY"). */
  shotName: string;
}

export interface CameraDirector {
  setBout(bout: BoutPresentation, arena: ArenaSet): void;
  setRequest(req: CameraRequest): void;
  update(input: FrameInput, fighters: readonly WorldPose[], realDt: number): CameraState;
  reset(): void;
}

// ---------------------------------------------------------------------------
// Presenter (docs/design/09 §1.3.2)
// ---------------------------------------------------------------------------

export interface PresenterStats {
  backend: 'webgpu' | 'webgl2' | 'none';
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  internalWidth: number;
  internalHeight: number;
}

export interface Presenter3D {
  /** Attach to a container; resolves once the GPU backend is ready. */
  mount(container: HTMLElement): Promise<{ backend: 'webgpu' | 'webgl2' }>;
  setBout(bout: BoutPresentation): Promise<void>;
  update(input: FrameInput, realDt: number): void;
  setCamera(req: CameraRequest): void;
  setQuality(level: QualityLevel, renderScale?: number): void;
  setFlags(flags: { debug: boolean; labels: boolean }): void;
  render(): void;
  resize(): void;
  stats(): PresenterStats;
  /** Current camera shot, for the broadcast graphics. */
  shot(): CameraState | null;
  dispose(): void;
}
