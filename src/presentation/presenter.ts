/**
 * THE PRESENTER — composes stage, arena, characters, animation and camera
 * behind `Presenter3D` (docs/design/09 §1.3.2).
 *
 * Each module comes from its factory (`createArenaSet`, `createCharacterFactory`,
 * `createAnimator`, `createCameraDirector`). A factory that returns null — its
 * owner has not landed it yet — or throws is replaced by a placeholder from
 * `placeholders/`, so the view always works and each module can be seen in
 * context the moment it lands. `window.__stats.modules` says which is which.
 *
 * Per-frame order (update):
 *   1. discontinuity → every module drops its smoothing, TAA history is cut;
 *   2. animator.evaluate  → one Pose per fighter;
 *   3. characters: applyPose, setVisualState (from the snapshot's visual fields);
 *   4. forwardKinematics  → WorldPose per fighter (for camera and arena);
 *   5. arena.update       → referee placement, crowd, screens;
 *      referee.update     → the official's body posed from that placement;
 *   6. camera.update      → CameraState → stage camera, DoF, cut;
 *   7. LOD per fighter from camera distance, capped by the preset.
 * then render() draws through the post pipeline and publishes `window.__stats`.
 *
 * Integration (docs/design/PHASE8_NOTES.md, "Integration (lead)"): the arena
 * is seeded from the bout (`cosmeticSeed`, `cornerColours`); the grappling
 * solver registers through `anim/` itself; a broadcast director gets the whole
 * recording (`setRecording`), the viewport shape (`setAspect` on resize), the
 * instant replay on air (`setReplay`) and the user camera (`attachFreeCamera`);
 * `warmUpAsync` compiles every material before the first visible frame.
 *
 * The presenter only reads sim frames. Nothing here writes to a snapshot, and
 * all cosmetic variation downstream is seeded from `cosmeticSeed`.
 */
import type { FighterSnapshot } from '../sim';
import type {
  Animator, ArenaSet, BoutPresentation, CameraDirector, CameraRequest, CameraState, CharacterActor,
  CharacterFactory, CharacterVisualState, FrameInput, Presenter3D, PresenterStats, QualityLevel,
  QualitySettings,
} from './contract';
import type { Arena } from '../sim';
import type { Object3D, Scene, Texture } from 'three';
import { createPose, createWorldPose, forwardKinematics, B, type Pose, type WorldPose } from './rig/skeleton';
import { createArenaSet } from './arena';
import { createCharacterFactory } from './character';
import { createAnimator } from './anim';
import {
  attachFreeCamera, createCameraDirector, isBroadcastDirector, makeCameraArena, type ReplayState,
  type ShotKind,
} from './camera';
import type { SimEvent, TickSnapshot } from '../sim';
import { createRefereeActor, type RefereeActor } from './referee';
import { CornerRest } from './corner';
import { FinishStage } from './finish';
import type { VenueSet } from './arena';
import type { ArenaOptions } from './arena';
import { qualitySettings, defaultQualityFor, FrameMeter, type PassToggles, type QualityRecommendation } from './stage/index';
import { createPlaceholderArena } from './placeholders/arena';
import { createPlaceholderCharacterFactory, DebugSkeletonActor, restFor } from './placeholders/debugSkeleton';
import { createPlaceholderAnimator } from './placeholders/animator';
import { createPlaceholderCameraDirector } from './placeholders/camera';

/** What the presenter needs from the stage; the real one is `stage/Stage`. */
export interface StageLike {
  readonly backend: 'webgpu' | 'webgl2';
  readonly scene: Scene;
  quality: QualitySettings;
  setQuality(q: QualitySettings): void;
  applyShadowPolicy(root: Object3D): void;
  resize(): void;
  setCameraState(s: CameraState): void;
  setReplay(on: boolean): void;
  cut(): void;
  frameTiming(ms: number): void;
  render(): void;
  warmUp(): void;
  /** The post warm-up as separate steps, so the page can paint between them (optional). */
  warmUpSteps?(): (() => void)[];
  /** Compile the scene's materials without drawing (optional: fakes and old stages lack it). */
  precompile?(onProgress?: (loaded: number, total: number) => void): Promise<void>;
  info(): { drawCalls: number; triangles: number; internalWidth: number; internalHeight: number };
  /** Resolves when the GPU has drained, without blocking the main thread (optional). */
  gpuIdle?(): Promise<void>;
  /** The preset this machine should start on (optional: fakes lack it). See stage/profiles.ts. */
  recommendQuality?(): Promise<QualityRecommendation>;
  /** GPU ms of the last timed frame and the dynamic-resolution mode (optional). */
  readonly lastGpuMs?: number;
  readonly dynamicResolutionMode?: string;
  dispose(): void;
}

export interface PresenterDeps {
  createStage(container: HTMLElement, quality: QualitySettings): Promise<StageLike>;
  createArenaSet(arena: Arena, q: QualitySettings, options?: ArenaOptions): Promise<ArenaSet | null>;
  createCharacterFactory(): CharacterFactory | null;
  createAnimator(): Animator | null;
  createCameraDirector(): CameraDirector | null;
  /** Monotonic clock (ms) for the fps meter; injectable for tests. */
  now(): number;
}

export type ModuleSource = 'module' | 'placeholder';

export interface ModuleReport {
  arena: ModuleSource;
  character: ModuleSource;
  anim: ModuleSource;
  camera: ModuleSource;
}

const defaultDeps: PresenterDeps = {
  async createStage(container, quality) {
    const { Stage } = await import('./stage/index');
    // `?gpuTiming=1` turns on GPU timestamp queries so QA scripts can read
    // per-frame GPU time with other GPU work on the machine factored out.
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
    const gpuTiming = q.get('gpuTiming') === '1';
    // `?fixedRes=1` holds the preset's (or `?scale=`) internal scale: per-shot cost comparisons.
    return Stage.create(container, {
      quality, trackTimestamp: gpuTiming, toggles: postOverrides(q.get('stagePost')), fixedResolution: q.get('fixedRes') === '1',
    });
  },
  createArenaSet,
  createCharacterFactory,
  createAnimator,
  createCameraDirector,
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
};

/**
 * `?stagePost=ao:0,sharpen:0,aa:traa` in the page URL overrides individual
 * post passes for QA (keys of `PassToggles`; booleans as 0/1).
 */
export function postOverrides(spec: string | null): Partial<PassToggles> | undefined {
  if (!spec) return undefined;
  const out: Record<string, unknown> = {};
  for (const part of spec.split(',')) {
    const [k, v] = part.split(':');
    if (!k || v === undefined) continue;
    if (k === 'aa') out.aa = v;
    else if (k === 'view') out.debugView = v;
    else if (k === 'aoSamples') out.aoSamples = Number(v);
    else out[k] = v === '1' || v === 'true';
  }
  return out as Partial<PassToggles>;
}

/**
 * `?placeholders=all` (or a list: `arena,character,anim,camera`) in the page
 * URL forces those modules back to their placeholders, so a module can be
 * compared against the baseline or ruled out when something breaks.
 */
function forcedPlaceholders(): Partial<PresenterDeps> {
  if (typeof location === 'undefined') return {};
  const v = new URLSearchParams(location.search).get('placeholders');
  if (!v) return {};
  const all = v === 'all' || v === '1';
  const has = (m: string): boolean => all || v.split(',').includes(m);
  const out: Partial<PresenterDeps> = {};
  if (has('arena')) out.createArenaSet = async () => null;
  if (has('character')) out.createCharacterFactory = () => null;
  if (has('anim')) out.createAnimator = () => null;
  if (has('camera')) out.createCameraDirector = () => null;
  return out;
}

/** Try a factory; a throw is reported and treated as "not landed yet". */
function attempt<T>(label: string, fn: () => T | null): T | null {
  try {
    return fn();
  } catch (err) {
    console.warn(`[presenter] ${label} failed, using the placeholder:`, err);
    return null;
  }
}

/** Per-frame look of one fighter from the snapshot's presentation-only fields. */
export function visualStateFrom(f: FighterSnapshot, blood: boolean, roundTime: number): CharacterVisualState {
  const fatigue = clamp01(f.fatigueVisual?.f ?? 1 - f.stamina.total);
  return {
    // Sweat builds with work (spent stamina) and with time under the lights.
    sweat: clamp01(0.1 + (1 - f.stamina.total) * 0.6 + Math.min(1, roundTime / 300) * 0.3),
    flush: clamp01((1 - f.stamina.burst) * 0.6 + fatigue * 0.4),
    damageZones: f.damageVisual?.zones ?? [],
    swelling: f.damageVisual?.swelling ?? [],
    cuts: f.damageVisual?.cuts ?? [],
    bloodOnGloves: blood ? clamp01(f.damageVisual?.bloodOnGloves ?? 0) : 0,
    blood,
    fatigue,
  };
}

/** Azimuth of the broadcast director's main camera for this venue. */
export function hardCameraAngle(bout: BoutPresentation): number {
  try {
    return makeCameraArena(bout.arena, null).mainAzimuth;
  } catch {
    return 0;
  }
}

/** Let the browser paint (the loading card) between long synchronous steps. */
function yieldToPage(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0;
}

/** Level of detail for a fighter at `distM` from the camera, never above the preset's cap. */
export function lodFor(distM: number, cap: 0 | 1 | 2 | 3): 0 | 1 | 2 | 3 {
  const byDistance = distM < 9 ? 0 : distM < 16 ? 1 : distM < 30 ? 2 : 3;
  return Math.max(byDistance, cap) as 0 | 1 | 2 | 3;
}

export class Presenter implements Presenter3D {
  private readonly deps: PresenterDeps;
  private stage: StageLike | null = null;
  private quality: QualitySettings;
  private bout: BoutPresentation | null = null;
  private arena: ArenaSet | null = null;
  private factory: CharacterFactory | null = null;
  private actors: CharacterActor[] = [];
  private overlays: DebugSkeletonActor[] = [];
  private animator: Animator | null = null;
  private camera: CameraDirector | null = null;
  private poses: Pose[] = [];
  private worlds: WorldPose[] = [];
  private request: CameraRequest = { mode: 'broadcast' };
  private referee: RefereeActor | null = null;
  /** Stools, the seated fighters and their cornermen between rounds. */
  private corner: CornerRest | null = null;
  /** The post-fight staging (wave-off, celebration, the raised hand). */
  private finish: FinishStage | null = null;
  private container: HTMLElement | null = null;
  private recording: { frames: readonly TickSnapshot[]; events: readonly SimEvent[] } | null = null;
  private replayState: ReplayState | null = null;
  private flags = { debug: false, labels: false };
  private lastShot: CameraState | null = null;
  private readonly meter = new FrameMeter();
  private lastRender = -1;
  private boutToken = 0;
  /**
   * Robustness (Watch/replay pass, review M2b/M4/M5): the character module's
   * factory is built once per presenter and reused across bouts (it caches
   * the decoded masks, skin maps and shared materials, so a new one per bout
   * leaked all of them); `building` is true while `setBout` is in flight, so a
   * quality change cannot rebuild bodies from a half-cleared bout; `gpuLost`
   * is set when the device or context is lost (nothing renders after that).
   */
  private moduleFactory: CharacterFactory | null = null;
  private building = false;
  private gpuLost = false;
  private readonly lostListeners = new Set<(reason: string) => void>();
  /** Viewer's manual camera in broadcast mode (`setCameraOverride`); null = the director's edit. */
  private cameraOverride: ShotKind | null = null;
  readonly modules: ModuleReport = { arena: 'placeholder', character: 'placeholder', anim: 'placeholder', camera: 'placeholder' };
  /** Order of module calls in the last update, for the tests and the debug overlay. */
  readonly trace: string[] = [];

  constructor(deps: Partial<PresenterDeps> = {}, quality?: QualitySettings) {
    this.deps = { ...defaultDeps, ...forcedPlaceholders(), ...deps };
    this.quality = quality ?? qualitySettings('high');
  }

  async mount(container: HTMLElement): Promise<{ backend: 'webgpu' | 'webgl2' }> {
    this.container = container;
    this.stage = await this.deps.createStage(container, this.quality);
    this.watchDeviceLoss(this.stage);
    return { backend: this.stage.backend };
  }

  /**
   * WebGPU device loss / WebGL context loss (review M5). three reports both
   * through `renderer.onDeviceLost`; its default only logs, after which every
   * frame renders into a dead device. Keep the default (it flags the
   * renderer), stop rendering, and tell the host, which rebuilds the
   * presenter or falls back to the 2D view.
   */
  private watchDeviceLoss(stage: StageLike): void {
    const renderer = (stage as unknown as { renderer?: { onDeviceLost?: (info: { api?: string; message?: string }) => void } }).renderer;
    if (!renderer || typeof renderer.onDeviceLost !== 'function') return;
    const original = renderer.onDeviceLost.bind(renderer);
    renderer.onDeviceLost = (info) => {
      try { original(info); } catch { /* the default only logs */ }
      if (this.stage !== stage || this.gpuLost) return;
      this.gpuLost = true;
      const reason = `${info?.api ?? 'GPU'} device lost${info?.message ? `: ${info.message}` : ''}`;
      for (const cb of this.lostListeners) {
        try { cb(reason); } catch (err) { console.error('[presenter] device-lost listener failed', err); }
      }
    };
  }

  /** Called once if the GPU device / context is lost. Returns the unsubscribe function. */
  onDeviceLost(cb: (reason: string) => void): () => void {
    this.lostListeners.add(cb);
    return () => { this.lostListeners.delete(cb); };
  }

  /** True after a device / context loss; the presenter no longer renders. */
  get deviceLost(): boolean {
    return this.gpuLost;
  }

  /**
   * Manual camera override for the broadcast mode (the Watch screen's camera
   * keys): pin one of the director's operators (`main`, `mainTight`,
   * `cageside`, `ground`, `overhead`, `reverse`), or `null` to hand the
   * picture back to the director's edit. Instant replays still air their own
   * angles while an override is set. Kept across bouts and director rebuilds.
   */
  setCameraOverride(kind: ShotKind | null): void {
    this.cameraOverride = kind;
    if (isBroadcastDirector(this.camera)) this.camera.lockShot(kind);
  }

  get cameraOverrideKind(): ShotKind | null {
    return this.cameraOverride;
  }

  async setBout(bout: BoutPresentation): Promise<void> {
    const token = ++this.boutToken;
    this.building = true;
    try {
      await this.buildBout(bout, token);
    } finally {
      // A newer setBout owns the flag once it has started.
      if (token === this.boutToken) this.building = false;
    }
  }

  private async buildBout(bout: BoutPresentation, token: number): Promise<void> {
    this.clearBout();
    this.bout = bout;
    const q = this.quality;

    let arena: ArenaSet | null = null;
    try {
      // Seeded from the bout, not the arena id: two bouts in the same venue get
      // different crowds, and the corner pads wear the bout's corner colours.
      // The referee keeps to the far side of the action from the hard camera,
      // so the set is told where the director puts it.
      arena = await this.deps.createArenaSet(bout.arena, q, {
        cosmeticSeed: bout.cosmeticSeed, cornerColours: bout.cornerColours,
        hardCameraAngle: hardCameraAngle(bout), blood: bout.blood,
      });
    } catch (err) {
      console.warn('[presenter] createArenaSet failed, using the placeholder:', err);
    }
    if (token !== this.boutToken) { arena?.dispose(); return; }
    this.modules.arena = arena ? 'module' : 'placeholder';
    this.arena = arena ?? createPlaceholderArena(bout.arena);
    this.applyArenaRecording();

    // One module factory per presenter (review M2b): its preload is idempotent
    // and it owns the shared textures and materials every bout's bodies use.
    let factory = this.moduleFactory
      ?? attempt('createCharacterFactory', () => this.deps.createCharacterFactory());
    this.moduleFactory = factory;
    if (factory) {
      try {
        await factory.preload();
      } catch (err) {
        console.warn('[presenter] character preload failed, using debug skeletons:', err);
        factory = null;
      }
    }
    if (token !== this.boutToken) return;
    this.modules.character = factory ? 'module' : 'placeholder';
    this.factory = factory ?? createPlaceholderCharacterFactory();
    await yieldToPage();
    if (token !== this.boutToken) return;
    this.buildActors();

    const animator = attempt('createAnimator', () => this.deps.createAnimator());
    this.modules.anim = animator ? 'module' : 'placeholder';
    this.animator = animator ?? createPlaceholderAnimator();
    this.animator.setBout(bout, this.actors.map((a) => a.rest));

    const camera = attempt('createCameraDirector', () => this.deps.createCameraDirector());
    this.modules.camera = camera ? 'module' : 'placeholder';
    this.camera = camera ?? createPlaceholderCameraDirector();
    this.camera.setBout(bout, this.arena);
    this.camera.setRequest(this.request);
    this.applyDirectorExtras();

    // The official: a real, dressed body when the character module is in,
    // else the capsule stand-in.
    // Yield to the page between the heavy build steps so the loading card
    // keeps painting (each body is ~50-120 ms of synchronous work).
    await yieldToPage();
    if (token !== this.boutToken) return;
    // Never orphan a referee already in the scene (review M4).
    this.referee?.dispose();
    this.referee = createRefereeActor(bout, hardCameraAngle(bout), {
      factory: this.modules.character === 'module' ? this.factory : null, quality: this.quality,
    });
    this.buildCorner();

    const stage = this.stage;
    if (stage) {
      stage.scene.add(this.arena.object3d);
      stage.scene.environment = (this.arena.environment as Texture | null) ?? null;
      for (const a of this.actors) stage.scene.add(a.object3d);
      stage.scene.add(this.referee.object3d);
      if (this.corner) stage.scene.add(this.corner.object3d);
      stage.applyShadowPolicy(stage.scene);
    }
  }

  /**
   * The rest-period staging (stools, fighters on them, the cornermen) and the
   * post-fight staging (`finish/`), for the current bodies and recording.
   */
  private buildCorner(): void {
    this.corner?.dispose();
    this.corner = null;
    this.finish = null;
    if (!this.bout) return;
    try {
      this.corner = new CornerRest(this.bout, this.actors.map((a) => a.rest), {
        factory: this.modules.character === 'module' ? this.factory : null, quality: this.quality,
      });
      if (this.recording) this.corner.setRecording(this.recording.frames, this.recording.events);
    } catch (err) {
      console.warn('[presenter] corner staging failed:', err);
      this.corner = null;
    }
    try {
      this.finish = new FinishStage(this.bout, this.actors.map((a) => a.rest), this.referee?.body.rest ?? null);
      if (this.recording) this.finish.setRecording(this.recording.frames, this.recording.events);
    } catch (err) {
      console.warn('[presenter] finish staging failed:', err);
      this.finish = null;
    }
  }

  /** Hand a broadcast director what it needs beyond the contract. */
  private applyDirectorExtras(): void {
    const d = this.camera;
    if (!isBroadcastDirector(d)) return;
    if (this.recording) d.setRecording(this.recording.frames, this.recording.events);
    d.setReplay(this.replayState);
    d.lockShot(this.cameraOverride);
    const aspect = this.aspect();
    if (aspect) d.setAspect(aspect);
  }

  private aspect(): number | null {
    const c = this.container;
    if (!c || !(c.clientWidth >= 2) || !(c.clientHeight >= 2)) return null;
    return c.clientWidth / c.clientHeight;
  }

  /**
   * The whole recorded bout, once per bout: a broadcast director plans its
   * edit and its replays' angles up front. Kept and re-applied if the
   * director is (re)built later.
   */
  setRecording(frames: readonly TickSnapshot[], events: readonly SimEvent[]): void {
    if (this.recording && this.recording.frames === frames && this.recording.events === events) return;
    this.recording = { frames, events };
    if (isBroadcastDirector(this.camera)) this.camera.setRecording(frames, events);
    this.corner?.setRecording(frames, events);
    this.finish?.setRecording(frames, events);
    this.applyArenaRecording();
  }

  /** The canvas marks (sweat, blood) are baked from the recording (arena/marks.ts). */
  private applyArenaRecording(): void {
    if (!this.recording || !this.bout) return;
    const set = this.arena as Partial<VenueSet> | null;
    set?.setRecording?.(this.recording.frames, this.recording.events, { blood: this.bout.blood });
  }

  /** The instant replay on air (`ReplaySequencer.state`), or null for live. */
  setReplay(state: ReplayState | null): void {
    this.replayState = state;
    if (isBroadcastDirector(this.camera)) this.camera.setReplay(state);
  }

  /**
   * Drag/wheel control of the free and orbit cameras on `el`. Returns the
   * detach function; a no-op when the director has no user camera.
   */
  attachFreeCamera(el: HTMLElement): () => void {
    if (!isBroadcastDirector(this.camera)) return () => undefined;
    return attachFreeCamera(el, this.camera.free);
  }

  /** Which layer posed each fighter last frame (e.g. "grapple pos.ground_mount ..."). */
  animLayers(): string[] {
    const a = this.animator;
    if (!a) return [];
    return this.actors.map((_, i) => {
      try { return a.debug(i).layer; } catch { return 'n/a'; }
    });
  }
  private buildActors(): void {
    const bout = this.bout;
    if (!bout || !this.factory) return;
    for (const a of this.actors) a.dispose();
    this.actors = bout.fighters.map((_, i) => {
      try {
        return this.factory!.create(bout, i, this.quality);
      } catch (err) {
        console.warn(`[presenter] character ${i} failed, using a debug skeleton:`, err);
        this.modules.character = 'placeholder';
        return createPlaceholderCharacterFactory().create(bout, i, this.quality);
      }
    });
    this.poses = this.actors.map(() => createPose());
    this.worlds = this.actors.map(() => createWorldPose());
    this.syncOverlays();
  }

  /** Debug skeleton overlays on top of real bodies (debug flag, real characters only). */
  private syncOverlays(): void {
    for (const o of this.overlays) o.dispose();
    this.overlays = [];
    const bout = this.bout;
    if (!bout || !this.flags.debug || this.modules.character !== 'module') return;
    this.overlays = this.actors.map((a, i) => new DebugSkeletonActor(i, {
      rest: a.rest ?? restFor(bout, i), corner: bout.cornerColours[i] ?? '#888', glove: bout.glove, overlay: true,
    }));
    if (this.stage) for (const o of this.overlays) this.stage.scene.add(o.object3d);
  }

  private clearBout(): void {
    for (const a of this.actors) a.dispose();
    for (const o of this.overlays) o.dispose();
    this.actors = [];
    this.overlays = [];
    this.arena?.dispose();
    this.arena = null;
    this.referee?.dispose();
    this.referee = null;
    this.corner?.dispose();
    this.corner = null;
    this.finish = null;
    this.animator = null;
    this.camera = null;
    this.bout = null;
    // The factory is the next bout's to set (review M4); the module factory
    // itself is kept in `moduleFactory` and reused.
    this.factory = null;
    this.lastShot = null;
  }

  /** CPU milliseconds of the last update() and render(), smoothed, for QA. */
  private cpu = { update: 0, render: 0 };

  update(input: FrameInput, realDt: number): void {
    const t0 = this.deps.now();
    this.updateInner(input, realDt);
    this.cpu.update += (this.deps.now() - t0 - this.cpu.update) * 0.1;
  }

  private updateInner(input: FrameInput, realDt: number): void {
    const trace = this.trace;
    trace.length = 0;
    if (!this.bout || !this.animator || !this.camera || !this.arena) return;

    if (input.discontinuity) {
      this.animator.reset();
      this.camera.reset();
      this.stage?.cut();
      trace.push('reset');
    }

    // After the bout (the playhead resting on the last frame): the post clock,
    // and the animator carried on through it so the bodies keep breathing.
    const post = this.finish ? this.finish.clock(input, realDt) : null;
    this.animator.evaluate(post !== null && this.finish ? this.finish.animatorInput(input) : input, realDt, this.poses);
    // Between rounds: walk to the corner, sit on the stool, back for the bell.
    this.corner?.apply(input, this.poses, realDt);
    // After the bout: wave-off, celebration, the centre of the cage, the raised hand.
    this.finish?.apply(this.poses, this.referee?.placement ?? null);
    trace.push('animator');

    const roundTime = input.frame.roundTime;
    for (let i = 0; i < this.actors.length; i++) {
      const actor = this.actors[i];
      actor.applyPose(this.poses[i]);
      const snap = input.frame.fighters[i];
      if (snap) actor.setVisualState(visualStateFrom(snap, this.bout.blood, roundTime));
      this.overlays[i]?.applyPose(this.poses[i]);
    }
    trace.push('characters');

    for (let i = 0; i < this.actors.length; i++) forwardKinematics(this.worlds[i], this.poses[i], this.actors[i].rest);
    trace.push('fk');

    // The post-fight script places the referee (the set draws his contact
    // shadow from it) and holds the wrists; the cornermen ground their feet too.
    const refScript = this.finish?.refereeScript(this.worlds) ?? null;
    const venue = this.arena as Partial<Pick<VenueSet, 'setRefereeOverride' | 'setExtraOccluders'>>;
    venue.setRefereeOverride?.(refScript?.placement ?? null);
    venue.setExtraOccluders?.(this.corner?.occluders() ?? []);
    this.arena.update(input, this.worlds, realDt);
    trace.push('arena');
    // Not in `trace`: the referee is an extra, not one of the contract modules.
    this.referee?.update(input, this.arena, this.worlds, realDt, refScript);
    // The operators work around him.
    if (isBroadcastDirector(this.camera)) {
      this.camera.setReferee(this.referee?.world ?? null);
      this.camera.setPostClock(post);
      this.camera.setExtraBodies(this.corner?.crew?.bodies() ?? []);
    }

    const shot = this.camera.update(input, this.worlds, realDt);
    this.lastShot = shot;
    trace.push('camera');

    if (this.stage) {
      this.stage.setCameraState(shot);
      this.stage.setReplay(input.replay);
    }

    const cap = this.quality.maxCharacterLOD;
    for (let i = 0; i < this.actors.length; i++) {
      const w = this.worlds[i];
      const d = Math.hypot(
        w.pos[B.spine2 * 3] - shot.position[0],
        w.pos[B.spine2 * 3 + 1] - shot.position[1],
        w.pos[B.spine2 * 3 + 2] - shot.position[2],
      );
      this.actors[i].setLOD(lodFor(d, cap));
    }
    const rc = this.referee?.chest();
    if (rc) {
      const d = Math.hypot(rc[0] - shot.position[0], rc[1] - shot.position[1], rc[2] - shot.position[2]);
      this.referee!.setLOD(lodFor(d, cap));
    }
    this.corner?.setLOD(shot.position, (d) => lodFor(d, cap));
    trace.push('lod');
  }

  setCamera(req: CameraRequest): void {
    this.request = { ...req };
    this.camera?.setRequest(this.request);
  }

  setQuality(level: QualityLevel, renderScale?: number): void {
    const prev = this.quality;
    this.quality = qualitySettings(level, renderScale);
    this.stage?.setQuality(this.quality);
    this.arena?.setQuality(this.quality);
    // Characters bake quality-dependent materials (skin scattering, sweat
    // layers) at creation; rebuild them when those change.
    const needsRebuild = prev.skinScattering !== this.quality.skinScattering
      || prev.sweatAndDamage !== this.quality.sweatAndDamage;
    // While `setBout` is in flight it builds the bodies itself, from the
    // current quality; rebuilding here would race it (review M4).
    if (needsRebuild && this.bout && this.factory && !this.building) {
      this.buildActors();
      if (this.stage) for (const a of this.actors) this.stage.scene.add(a.object3d);
      this.animator?.setBout(this.bout, this.actors.map((a) => a.rest));
      this.referee?.dispose();
      this.referee = createRefereeActor(this.bout, hardCameraAngle(this.bout), {
        factory: this.modules.character === 'module' ? this.factory : null, quality: this.quality,
      });
      if (this.stage) this.stage.scene.add(this.referee.object3d);
      this.buildCorner();
      if (this.stage && this.corner) this.stage.scene.add(this.corner.object3d);
    }
    if (this.stage) this.stage.applyShadowPolicy(this.stage.scene);
  }

  setFlags(flags: { debug: boolean; labels: boolean }): void {
    const changed = flags.debug !== this.flags.debug;
    this.flags = { ...flags };
    if (changed) this.syncOverlays();
  }

  render(): void {
    const stage = this.stage;
    if (!stage || this.gpuLost) return;
    const t0 = this.deps.now();
    stage.render();
    const now = this.deps.now();
    this.cpu.render += (now - t0 - this.cpu.render) * 0.1;
    if (this.lastRender >= 0) stage.frameTiming(now - this.lastRender);
    this.lastRender = now;
    this.meter.tick(now);
    this.publishStats();
  }

  /** Compile everything once (the replay pipeline too) before the first real frame. */
  warmUp(): void {
    this.stage?.warmUp();
  }

  /**
   * Compile every material of the set, the fighters and the referee before
   * the first visible frame, yielding to the page as it goes (the Watch
   * screen shows "Preparing broadcast..." meanwhile), then the post pipelines
   * with one live and one replay frame. Call after `setBout` and one
   * `update` (so the first shot's camera is in place).
   */
  async warmUpAsync(onProgress?: (loaded: number, total: number) => void): Promise<{ sceneMs: number; postMs: number }> {
    const stage = this.stage;
    if (!stage) return { sceneMs: 0, postMs: 0 };
    const t0 = this.deps.now();
    if (stage.precompile) {
      try {
        await stage.precompile(onProgress);
      } catch (err) {
        console.warn('[presenter] precompile failed; shaders will compile on the first frame:', err);
      }
    }
    const t1 = this.deps.now();
    if (this.stage !== stage) return { sceneMs: t1 - t0, postMs: 0 };
    // The post chains (live, then replay, then the live DoF) still compile on
    // their first draw; one per task, yielding in between, so the page (and
    // the loading card) can paint between the driver's compile stalls.
    stage.render();
    // Each driver-side compile finishes before the next step is issued, with
    // the main thread free meanwhile (WebGL2 first-draw compiles; stage.gpuIdle).
    await stage.gpuIdle?.();
    if (stage.warmUpSteps) {
      for (const step of stage.warmUpSteps()) {
        await yieldToPage();
        if (this.stage !== stage) break;
        step();
        await stage.gpuIdle?.();
      }
    } else {
      stage.warmUp();
    }
    return { sceneMs: Math.round(t1 - t0), postMs: Math.round(this.deps.now() - t1) };
  }

  resize(): void {
    this.stage?.resize();
    const aspect = this.aspect();
    if (aspect && isBroadcastDirector(this.camera)) this.camera.setAspect(aspect);
  }

  stats(): PresenterStats {
    const info = this.stage?.info();
    return {
      backend: this.stage?.backend ?? 'none',
      fps: Math.round(this.meter.fps * 10) / 10,
      frameMs: Math.round(this.meter.frameMs * 100) / 100,
      drawCalls: info?.drawCalls ?? 0,
      triangles: info?.triangles ?? 0,
      internalWidth: info?.internalWidth ?? 0,
      internalHeight: info?.internalHeight ?? 0,
    };
  }

  private publishStats(): void {
    if (typeof window === 'undefined') return;
    (window as unknown as { __stats: unknown }).__stats = {
      ...this.stats(),
      level: this.quality.level,
      renderScale: this.quality.renderScale,
      shot: this.lastShot?.shotName ?? null,
      modules: { ...this.modules },
      anim: this.animLayers(),
      referee: this.referee?.placement
        ? {
          x: round2(this.referee.placement.x), z: round2(this.referee.placement.z),
          gesture: this.referee.placement.gesture, crouch: round2(this.referee.placement.crouch),
        }
        : null,
      // The post-fight staging: seconds since the end (null outside the post-roll) and the result it stages.
      finish: this.finish?.timeline
        ? { t: this.finish.postTime === null ? null : round2(this.finish.postTime), kind: this.finish.timeline.kind }
        : null,
      replay: this.replayState
        ? `${this.replayState.plan.title} ${this.replayState.segmentIndex + 1}/${this.replayState.plan.segments.length}`
        : null,
      cpuUpdateMs: Math.round(this.cpu.update * 100) / 100,
      cpuRenderMs: Math.round(this.cpu.render * 100) / 100,
      gpuMs: this.stage?.lastGpuMs ? Math.round(this.stage.lastGpuMs * 100) / 100 : null,
      dynres: this.stage?.dynamicResolutionMode ?? null,
    };
  }

  /**
   * The quality preset recommended for this machine (adapter + a short GPU
   * probe; Medium when unknown), for a settings UI's "Automatic" choice. An
   * explicit user choice (`readQualityChoice`) should always win over it.
   */
  async recommendedQuality(): Promise<QualityRecommendation> {
    const rec = await this.stage?.recommendQuality?.();
    return rec ?? { level: 'medium', reason: 'no GPU probe available' };
  }

  shot(): CameraState | null {
    return this.lastShot;
  }

  /** Test/debug access to the evaluated poses (read-only by convention). */
  get currentPoses(): readonly Pose[] {
    return this.poses;
  }

  dispose(): void {
    this.boutToken++;
    this.clearBout();
    // A factory with a dispose() (none today) frees its shared textures here.
    (this.moduleFactory as { dispose?: () => void } | null)?.dispose?.();
    this.moduleFactory = null;
    this.lostListeners.clear();
    try {
      this.stage?.dispose();
    } catch (err) {
      // Disposing a renderer whose device was lost can throw; nothing to keep.
      console.warn('[presenter] stage dispose failed', err);
    }
    this.stage = null;
    this.container = null;
  }
}

/**
 * The presenter the Watch screen uses. `quality` defaults to the preset for
 * the backend, which is only known after `mount`; callers normally follow with
 * `setQuality` from the user's saved choice.
 */
export function createPresenter(deps: Partial<PresenterDeps> = {}, quality?: QualitySettings): Presenter {
  return new Presenter(deps, quality);
}

export { defaultQualityFor };
