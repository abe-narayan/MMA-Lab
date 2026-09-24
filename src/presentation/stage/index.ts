/**
 * THE STAGE — renderer, camera, output transform, shadows, resolution and the
 * post-processing pipeline (docs/design/08 §4.3-4.5, §8).
 *
 * Backend: `WebGPURenderer` from three r186, which runs on WebGPU where the
 * browser has it and falls back to WebGL2 on its own. `?backend=webgl2` in the
 * page URL forces the fallback so it can be tested on a WebGPU machine; the
 * backend that actually ran is reported by `Stage.backend` and in
 * `window.__stats`.
 *
 * Output: sRGB, **ACES filmic** tone mapping at exposure 1.0, chosen by
 * looking at both on the test scene (dev/stage.html, `?tm=agx|aces`):
 *  - AgX is the more "correct" curve — no hue skew, graceful desaturation of
 *    fixtures — but it is deliberately flat: a lit white canvas comes out a
 *    dull 80 % grey-beige and skin loses its warmth. A televised fight is the
 *    opposite: the canvas is the brightest, cleanest white in the frame and
 *    the picture has broadcast-camera snap. Getting that back out of AgX
 *    would need so much LUT contrast that the grade stops being a light touch.
 *  - ACES gives clean whites and punch out of the box and keeps skin warm.
 *    Its known faults (saturated highlights skew toward yellow, a hard toe)
 *    matter little here: the only saturated emitters are small LED strips,
 *    and the arena bowl is meant to fall to near black behind the lit canvas.
 * The broadcast LUT (`lut.ts`) is therefore a light touch on top: a little
 * contrast, vibrance with skin protected, cool deep shadows, clean whites.
 * The dev page can switch to AgX or Neutral to re-evaluate.
 *
 * Shadows: the renderer runs PCF shadow maps; which lights cast is the arena's
 * call (08 §4.3 asks for one camera-side key), the stage sets the map size and
 * softness from the preset on every light the arena marked `castShadow`.
 */
import {
  AgXToneMapping, ACESFilmicToneMapping, NeutralToneMapping, PCFShadowMap, PerspectiveCamera, Scene,
  SRGBColorSpace, Color, WebGPURenderer, type LightShadow, type Object3D, type ToneMapping,
} from 'three/webgpu';
import type { CameraState, QualitySettings } from '../contract';
import { STAGE_TUNING, type StageTuning } from './quality';
import { probeGpu, recommendQuality, type QualityRecommendation } from './profiles';
import { StagePipeline, aoRadiusFor, fenceLensFor, scalesInsidePipeline, togglesFor, type PassToggles } from './pipeline';
import { DynamicResolution, GpuDynamicResolution } from './dynres';
import { installSkinnedVelocityFix, preparePreviousBones, snapshotPreviousBones } from './skinnedVelocity';
import { installProgramSharing } from './programSharing';
import { devParam, devSearch, exposeDevGlobal } from '../devFlags';

export * from './quality';
export * from './profiles';
export { StagePipeline, togglesFor, scalesInsidePipeline, createLutTexture, aoRadiusFor, fenceLensFor, FENCE_LENS } from './pipeline';
export type { PassToggles } from './pipeline';
export { DynamicResolution, GpuDynamicResolution, FrameMeter } from './dynres';
export { gradeColor, buildLutData, BROADCAST_GRADE, LUT_SIZE } from './lut';

export type StageBackend = 'webgpu' | 'webgl2';
export type BackendRequest = 'auto' | StageBackend;

/** `?backend=webgl2` / `?backend=webgpu` in the page URL, else auto. */
export function requestedBackend(search: string = devSearch()): BackendRequest {
  const v = new URLSearchParams(search).get('backend');
  return v === 'webgl2' || v === 'webgl' ? 'webgl2' : v === 'webgpu' ? 'webgpu' : 'auto';
}

/** Whether any GPU path can be tried at all (WebGPU or WebGL2). */
export function gpuLikelyAvailable(): boolean {
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) return true;
  if (typeof document === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

export const TONE_MAPPINGS: Readonly<Record<'agx' | 'aces' | 'neutral', ToneMapping>> = {
  agx: AgXToneMapping,
  aces: ACESFilmicToneMapping,
  neutral: NeutralToneMapping,
};

export interface StageOptions {
  backend?: BackendRequest;
  quality: QualitySettings;
  /** Override individual passes (the dev page); defaults come from the preset. */
  toggles?: Partial<PassToggles>;
  /** Hold a fixed internal scale even on presets that allow dynamic resolution. */
  fixedResolution?: boolean;
  /** Timestamp queries for per-pass GPU timing (WebGPU only, dev use). */
  trackTimestamp?: boolean;
  /**
   * Drive dynamic resolution from the GPU's own frame time (WebGPU timestamp
   * queries, when the adapter has them) instead of the vsync-quantised frame
   * interval. Default true; `?gpuDynres=0` turns it off for A/B.
   */
  gpuTimedResolution?: boolean;
}

export class Stage {
  readonly renderer: WebGPURenderer;
  readonly backend: StageBackend;
  readonly scene = new Scene();
  // Near 0.1 m, far 200 m: depth precision matters to GTAO and the TAA's
  // disocclusion test, and no broadcast lens sits closer than 10 cm to anything.
  readonly camera = new PerspectiveCamera(40, 16 / 9, 0.1, 200);
  quality: QualitySettings;
  tuning: StageTuning;
  toggles: PassToggles;
  private pipeline: StagePipeline | null = null;
  private dynres: DynamicResolution | null = null;
  /** GPU-time controller (WebGPU with timestamps); replaces `dynres` when present. */
  private gpuDynres: GpuDynamicResolution | null = null;
  private readonly gpuTimed: boolean;
  private resolving = false;
  private framesSinceResolve = 0;
  private lastGpuSampleAt = 0;
  /** Phases of the last `precompile` (ms). */
  precompileTimes: { compileAsyncMs: number; drawMs: number; gpuIdleMs: number } | null = null;
  /** Last GPU frame time the controller saw (ms), for `window.__stats`. */
  lastGpuMs = 0;
  private readonly container: HTMLElement;
  private fixedResolution: boolean;
  private replayOn = false;
  private lastDof = { focus: 4, strength: 0 };
  /** Pass overrides given at creation (dev page, `?stagePost=`): kept across preset changes. */
  private readonly overrides: Partial<PassToggles>;

  private constructor(container: HTMLElement, renderer: WebGPURenderer, backend: StageBackend, opts: StageOptions) {
    this.container = container;
    this.renderer = renderer;
    this.backend = backend;
    this.quality = opts.quality;
    this.tuning = STAGE_TUNING[opts.quality.level];
    this.overrides = { ...opts.toggles };
    this.toggles = { ...togglesFor(opts.quality), ...this.overrides };
    this.fixedResolution = opts.fixedResolution === true;
    this.gpuTimed = opts.gpuTimedResolution !== false;
    this.scene.background = new Color(0x050608);
  }

  /** Create the renderer and wait for its device. Throws when no GPU path works. */
  static async create(container: HTMLElement, opts: StageOptions): Promise<Stage> {
    // Correct motion vectors for skinned bodies that share materials (see
    // skinnedVelocity.ts). `?skinVelFix=0` leaves three's own path, for A/B.
    const noFix = devParam('skinVelFix') === '0';
    if (!noFix) installSkinnedVelocityFix();
    // One program per material instead of one per skinned body (programSharing.ts).
    // `?shareProgs=0` restores three's per-node buffer names for A/B.
    if (!(devParam('shareProgs') === '0')) installProgramSharing();
    const want = opts.backend ?? requestedBackend();
    const gpuTimed = opts.gpuTimedResolution !== false
      && !(devParam('gpuDynres') === '0');
    opts = { ...opts, gpuTimedResolution: gpuTimed };
    const renderer = new WebGPURenderer({
      antialias: false,
      forceWebGL: want === 'webgl2',
      powerPreference: 'high-performance',
      // Timestamps feed the GPU-time dynamic resolution (three keeps them off
      // when the adapter lacks 'timestamp-query'; WebGL2 has none in Chrome).
      trackTimestamp: opts.trackTimestamp === true || (gpuTimed && want !== 'webgl2'),
    });
    try {
      await renderer.init();
    } catch (err) {
      renderer.dispose();
      throw err;
    }
    const b = renderer.backend as { isWebGPUBackend?: boolean };
    const backend: StageBackend = b.isWebGPUBackend ? 'webgpu' : 'webgl2';

    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.type = PCFShadowMap;
    // Several renders make up one frame (shadow, scene, post quads); the stats
    // are reset once per presented frame by `render()` instead.
    renderer.info.autoReset = false;

    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.setAttribute('aria-label', '3D broadcast view');
    container.appendChild(canvas);

    const stage = new Stage(container, renderer, backend, opts);
    stage.rebuild();
    stage.resize();
    return stage;
  }

  /** Apply a preset (and optional pass overrides). Rebuilds the post graph. */
  setQuality(q: QualitySettings, toggles?: Partial<PassToggles>): void {
    this.quality = q;
    this.tuning = STAGE_TUNING[q.level];
    this.toggles = { ...togglesFor(q), ...this.overrides, ...toggles };
    this.rebuild();
    this.resize();
  }

  setToneMapping(kind: keyof typeof TONE_MAPPINGS, exposure = 1): void {
    this.renderer.toneMapping = TONE_MAPPINGS[kind];
    this.renderer.toneMappingExposure = exposure;
  }

  setFixedResolution(fixed: boolean): void {
    this.fixedResolution = fixed;
    this.rebuild();
  }

  private rebuild(): void {
    this.pipeline?.dispose();
    this.pipeline = new StagePipeline(this.renderer, this.scene, this.camera, this.quality, this.tuning, this.toggles);
    this.pipeline.setDepthOfField(this.lastDof.focus, this.lastDof.strength);
    const dr = this.tuning.dynamicResolution;
    const dynamic = !!dr && !this.fixedResolution && scalesInsidePipeline(this.toggles);
    const range = dr ? { min: Math.min(dr.min, this.quality.renderScale), max: Math.max(dr.max, this.quality.renderScale) } : null;
    this.gpuDynres = dynamic && range && this.gpuTimed && this.timestamps
      ? new GpuDynamicResolution(this.quality.renderScale, { ...range, targetMs: dr!.gpuTargetMs })
      : null;
    this.dynres = dynamic && range && !this.gpuDynres ? new DynamicResolution(this.quality.renderScale, range) : null;
    this.applyShadowPolicy(this.scene);
  }

  /**
   * Shadow policy: the renderer-level switch and filter, plus map size and
   * PCF radius on every light that the arena marked as a caster. Call again
   * after adding a set.
   */
  applyShadowPolicy(root: Object3D): void {
    const q = this.quality;
    this.renderer.shadowMap.enabled = q.shadows !== 'off';
    this.renderer.shadowMap.type = PCFShadowMap;
    root.traverse((o) => {
      const light = o as unknown as { isLight?: boolean; castShadow: boolean; shadow?: LightShadow };
      if (!light.isLight || !light.shadow || !light.castShadow) return;
      if (o.userData.shadowManaged === false) return;
      const size = q.shadows === 'off' ? 1 : q.shadowMapSize;
      // The shadow node resizes its render target from mapSize every update.
      light.shadow.mapSize.set(size, size);
      light.shadow.radius = this.tuning.shadowRadius;
    });
  }

  /** Match the container size; honours `maxPixelRatio` and, without TAAU, `renderScale`. */
  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    let ratio = Math.min(dpr, this.quality.maxPixelRatio);
    if (!scalesInsidePipeline(this.toggles)) ratio *= this.quality.renderScale;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Point the camera from a director's state. */
  setCameraState(s: CameraState): void {
    const c = this.camera;
    c.position.set(s.position[0], s.position[1], s.position[2]);
    c.up.set(0, 1, 0);
    c.lookAt(s.target[0], s.target[1], s.target[2]);
    if (s.rollRad) c.rotateZ(s.rollRad);
    if (Math.abs(c.fov - s.fovDeg) > 1e-4) {
      c.fov = s.fovDeg;
      c.updateProjectionMatrix();
    }
    this.lastDof = { focus: s.focusM, strength: s.dof };
    this.pipeline?.setDepthOfField(s.focusM, s.dof);
    if (this.aoClamp) this.pipeline?.setAoRadius(aoRadiusFor(s.focusM, s.fovDeg));
    if (s.cut) this.pipeline?.cut();
    // A cut re-seeds the temporal history anyway: the moment to jump to the
    // internal scale this kind of shot needed last time.
    if (this.gpuDynres && this.pipeline && (s.cut || this.lastShotName !== s.shotName)) {
      this.pipeline.setInternalScale(this.gpuDynres.cut(s.shotName));
    }
    this.lastShotName = s.shotName;
  }

  private lastShotName = '';
  /** `?aoClamp=0`: keep GTAO's fixed 0.4 m radius on every shot (A/B). */
  aoClamp = !(devParam('aoClamp') === '0');

  /** Replay grammar: depth of field and motion blur only while a replay runs. */
  setReplay(on: boolean): void {
    this.replayOn = on;
  }

  /** Drop temporal history (camera cut, seek). */
  cut(): void {
    this.pipeline?.cut();
  }

  /** Feed the measured frame interval to dynamic resolution. */
  frameTiming(frameMs: number): void {
    if (this.gpuDynres || !this.dynres || !this.pipeline) return;
    this.pipeline.setInternalScale(this.dynres.sample(frameMs));
  }

  render(): void {
    // While a benchmark runs, the page's own frame loop must not interleave
    // frames (their timestamps would mix into the measurement). While the
    // scene warm-up runs, a frame would change the renderer's target and MRT
    // under the node builds it has started (they read them when they begin):
    // the canvas keeps its last picture until the warm-up is done (QA2 #1).
    if (this.benching || this.compiling > 0) return;
    this.renderFrame();
  }

  /** Scene warm-ups in flight (`precompile`). */
  private compiling = 0;
  /** True while the scene warm-up runs (the page's frames are held). */
  get precompiling(): boolean {
    return this.compiling > 0;
  }

  /** Measurement in progress: `render()` from the page loop is a no-op. */
  private benching = false;

  private renderFrame(): void {
    if (!this.pipeline) return;
    this.renderer.info.reset();
    // One node frame per presented frame, whatever three's own rAF did in
    // between: skeletons, TAA and GTAO update exactly once per picture.
    this.advanceNodeFrame();
    snapshotPreviousBones(this.scene);
    this.resetTargets();
    this.pipeline.render(this.replayOn);
    if (this.gpuDynres && !this.benching) this.sampleGpuTime();
  }

  /**
   * The post chains draw to whatever target and MRT the renderer has: a frame
   * (or a warm-up draw) always starts from the canvas with no MRT, whatever an
   * earlier job left bound (QA2: post-chain quads built against the scene
   * pass's three colour targets).
   */
  private resetTargets(): void {
    const r = this.renderer as unknown as { setRenderTarget(t: null): void; setMRT(m: null): void };
    r.setRenderTarget(null);
    r.setMRT(null);
  }

  /** Every fourth frame: resolve the GPU timestamps and feed the controller. */
  private sampleGpuTime(): void {
    if (this.resolving || ++this.framesSinceResolve < 4) return;
    this.framesSinceResolve = 0;
    this.resolving = true;
    const pipeline = this.pipeline;
    this.renderer.resolveTimestampsAsync('render').then((ms) => {
      if (typeof ms !== 'number' || !(ms > 0) || !this.gpuDynres || this.pipeline !== pipeline || this.benching) return;
      const t = performance.now();
      const dt = this.lastGpuSampleAt > 0 ? t - this.lastGpuSampleAt : 0;
      this.lastGpuSampleAt = t;
      this.lastGpuMs = ms;
      pipeline?.setInternalScale(this.gpuDynres.sample(ms, dt));
    }).catch(() => { /* a lost device; the next frame tries again */ }).finally(() => { this.resolving = false; });
  }

  private recommendation: Promise<QualityRecommendation> | null = null;

  /**
   * The preset this machine should start on when the viewer has not chosen
   * one (profiles.ts): adapter info plus a ~0.2 s deterministic GPU probe,
   * run once and cached. Call before the bout is built (the probe shares the GPU).
   */
  recommendQuality(): Promise<QualityRecommendation> {
    if (!this.recommendation) {
      const b = this.renderer.backend as {
        device?: { adapterInfo?: Record<string, string> & { isFallbackAdapter?: boolean } };
        gl?: WebGL2RenderingContext;
      };
      let info: Record<string, string> & { isFallbackAdapter?: boolean } = b.device?.adapterInfo ?? {};
      if (b.gl) {
        const ext = b.gl.getExtension('WEBGL_debug_renderer_info');
        info = { description: String(ext ? b.gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : b.gl.getParameter(b.gl.RENDERER)) };
      }
      const adapter = { isFallbackAdapter: info.isFallbackAdapter };
      this.recommendation = this.gpuSerial(() => probeGpu(this.renderer)).then((probeMs) => recommendQuality({
        backend: this.backend,
        adapter: { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, isFallbackAdapter: adapter?.isFallbackAdapter },
        probeMs,
      }));
    }
    return this.recommendation;
  }

  /** Which dynamic-resolution controller runs: 'gpu' (timestamps), 'interval', or 'fixed'. */
  get dynamicResolutionMode(): 'gpu' | 'interval' | 'fixed' {
    return this.gpuDynres ? 'gpu' : this.dynres ? 'interval' : 'fixed';
  }

  /**
   * Compile the scene's materials for the scene pass without drawing, yielding
   * to the page between objects (integration: the loading state runs while
   * this does). Call after the set and the bodies are in the scene.
   */
  async precompile(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    this.compiling++;
    try {
      await this.gpuSerial(() => this.precompileInner(onProgress));
    } finally {
      this.compiling--;
    }
  }

  /**
   * Async GPU work that holds renderer state (render target, MRT) across
   * awaits runs one at a time: the quality probe (its own target, drained
   * between draws) and the scene warm-up (the scene pass's target and MRT,
   * read by every node build it starts). Overlapped, a warm-up build could
   * start while the probe's target was bound and build its program without
   * the scene pass's MRT outputs — measured once the warm-up ran in parallel
   * lanes: WebGPU pipelines failing validation, a black picture (and the
   * QA2 #1 hang after a presenter rebuild: the new presenter's probe and warm-up
   * start together).
   */
  private gpuQueue: Promise<unknown> = Promise.resolve();
  private gpuSerial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.gpuQueue.then(fn, fn);
    this.gpuQueue = run.catch(() => undefined);
    return run;
  }

  private async precompileInner(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    preparePreviousBones(this.scene);
    const t0 = performance.now();
    await this.pipeline?.compileScene(this.scene, onProgress);
    const t1 = performance.now();
    let t2 = t1;
    if (this.backend === 'webgl2' && this.pipeline) {
      // Let the driver build the scene's shader variants with the main thread
      // free (see StagePipeline.drawSceneOnly).
      snapshotPreviousBones(this.scene);
      this.pipeline.drawSceneOnly(this.scene);
      t2 = performance.now();
      await this.gpuIdle();
    }
    // QA (load-timeline.mjs): where the scene warm-up spends its time.
    this.precompileTimes = { compileAsyncMs: Math.round(t1 - t0), drawMs: Math.round(t2 - t1), gpuIdleMs: Math.round(performance.now() - t2) };
    exposeDevGlobal('__precompile', this.precompileTimes);
  }

  /**
   * Resolve once the GPU has finished everything submitted so far, without
   * blocking the main thread: WebGPU `onSubmittedWorkDone`; WebGL2 a fence
   * polled every 25 ms (`getSyncParameter` never waits). Used between warm-up
   * steps so each driver-side shader compile runs while the page stays live.
   */
  async gpuIdle(timeoutMs = 120000): Promise<void> {
    const b = this.renderer.backend as { device?: { queue: { onSubmittedWorkDone(): Promise<void> } }; gl?: WebGL2RenderingContext };
    if (b.device) { await b.device.queue.onSubmittedWorkDone(); return; }
    const gl = b.gl;
    if (!gl) return;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) return;
    gl.flush();
    const t0 = performance.now();
    try {
      while (gl.getSyncParameter(sync, gl.SYNC_STATUS) !== gl.SIGNALED && performance.now() - t0 < timeoutMs) {
        await new Promise((r) => setTimeout(r, 25));
      }
    } finally {
      gl.deleteSync(sync);
    }
  }

  /**
   * The whole warm-up as ONE job on the GPU queue (QA2 #1, #2): the scene's
   * programs (`precompile`), the first frame, then the other post chains' first
   * draws (replay, live DoF), each followed by a non-blocking GPU drain and
   * `between` (the page paints). The page's own frames are held throughout.
   * Run as separate calls, a second warm-up (a quality switch while the first
   * is still drawing its post chains) started its node builds while the first
   * one's post passes had the renderer's target and MRT: programs built
   * without the scene pass's outputs, pipelines failing validation, nothing
   * drawn from then on.
   */
  async warmUpAll(
    onProgress?: (loaded: number, total: number) => void, between: () => Promise<void> = async () => undefined,
  ): Promise<{ sceneMs: number; postMs: number }> {
    this.compiling++;
    try {
      return await this.gpuSerial(async () => {
        const t0 = performance.now();
        try {
          await this.precompileInner(onProgress);
        } catch (err) {
          console.warn('[stage] precompile failed; shaders will compile on the first frame:', err);
        }
        const t1 = performance.now();
        this.renderFrame();
        await this.gpuIdle();
        for (const step of this.pipeline?.warmSteps() ?? []) {
          await between();
          this.resetTargets();
          step();
          await this.gpuIdle();
        }
        return { sceneMs: Math.round(t1 - t0), postMs: Math.round(performance.now() - t1) };
      });
    } finally {
      this.compiling--;
    }
  }

  /** The warm-up split into steps (see `StagePipeline.warmSteps`). */
  warmUpSteps(): (() => void)[] {
    return this.pipeline?.warmSteps() ?? [];
  }

  warmUp(): void {
    this.pipeline?.warmReplay();
  }

  private readonly lens = { focus: 3.5, aperture: 0.009 };
  /**
   * The near-fence lens for a camera state (`fenceLensFor`): the presenter hands
   * it to the arena's chain-link every frame. Returns a reused object.
   */
  fenceLens(s: CameraState): { focus: number; aperture: number } {
    const el = this.renderer.domElement;
    const l = fenceLensFor(s.focusM, s.dof, s.fovDeg, el.height * this.internalScale, this.pipeline?.hasLiveDof ?? false);
    this.lens.focus = l.focus;
    this.lens.aperture = l.aperture;
    return this.lens;
  }

  get internalScale(): number {
    return this.pipeline?.internalResolutionScale ?? 1;
  }

  /** Draw calls, triangles and internal resolution of the last frame. */
  info(): { drawCalls: number; triangles: number; internalWidth: number; internalHeight: number; outputWidth: number; outputHeight: number } {
    const r = this.renderer.info.render;
    const el = this.renderer.domElement;
    const s = this.internalScale;
    return {
      drawCalls: r.drawCalls,
      triangles: Math.round(r.triangles),
      internalWidth: Math.floor(el.width * s),
      internalHeight: Math.floor(el.height * s),
      outputWidth: el.width,
      outputHeight: el.height,
    };
  }

  /**
   * GPU-bound frame cost: render `frames` frames back to back and wait for the
   * GPU to drain. Independent of vsync, so it measures headroom as well as
   * shortfall (the rAF interval cannot). Returns mean ms per frame.
   */
  async benchmark(frames = 60, onFrame?: (i: number) => void): Promise<number> {
    return this.exclusive(() => this.benchmarkInner(frames, onFrame));
  }

  /** Run a measurement with the page's frame loop held off. */
  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.benching) return fn();
    this.benching = true;
    try { return await fn(); } finally { this.benching = false; }
  }

  private async benchmarkInner(frames: number, onFrame?: (i: number) => void): Promise<number> {
    if (this.timestamps) return this.gpuTimeInner(frames, onFrame);
    await this.drain();
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      onFrame?.(i);
      this.advanceNodeFrame();
      this.renderFrame();
    }
    await this.drain();
    return (performance.now() - t0) / frames;
  }

  /** True when GPU timestamp queries are available (WebGPU with `trackTimestamp`). */
  get timestamps(): boolean {
    return (this.renderer.backend as { trackTimestamp?: boolean }).trackTimestamp === true
      && this.backend === 'webgpu';
  }

  /**
   * Mean GPU time per frame from timestamp queries: the sum of every render
   * pass's GPU duration (shadow, scene, each post quad), excluding compositor
   * and CPU time. The number to compare passes by.
   */
  async gpuTime(frames = 60, onFrame?: (i: number) => void): Promise<number> {
    return this.exclusive(() => this.gpuTimeInner(frames, onFrame));
  }

  private async gpuTimeInner(frames: number, onFrame?: (i: number) => void): Promise<number> {
    await this.renderer.resolveTimestampsAsync('render');
    let sum = 0;
    let n = 0;
    for (let i = 0; i < frames; i++) {
      onFrame?.(i);
      this.advanceNodeFrame();
      this.renderFrame();
      const ms = await this.renderer.resolveTimestampsAsync('render');
      if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) { sum += ms; n++; }
    }
    return n > 0 ? sum / n : NaN;
  }

  /**
   * Per-pass GPU time (QA, `?gpuTiming=1`): the median over `frames` frames
   * of every render pass's timestamp duration, labelled by its render
   * target's texture name (`output` = the scene pass, `GTAONode.AO`,
   * `TAAUNode.resolve`, `DepthOfField.*`, `UnrealBloomPass.*`, ...; `canvas`
   * = the final quad; `rt WxH` = an unnamed target such as the shadow map).
   * Passes that share a label within a frame are summed.
   */
  async passTimes(frames = 30): Promise<{ total: number; median: number; passes: Record<string, number> } | null> {
    if (!this.timestamps) return null;
    return this.exclusive(() => this.passTimesInner(frames));
  }

  private async passTimesInner(frames: number): Promise<{ total: number; median: number; passes: Record<string, number> }> {
    const backend = this.renderer.backend as unknown as {
      timestampQueryPool: { render?: { timestamps: Map<string, number> } };
    };
    // The inspector hook sees every render call with its timestamp uid and
    // target; render contexts themselves are shared between targets of one
    // format, so the uid's call index (`r:<call>:<ctx>`) is what identifies a pass.
    const insp = (this.renderer as unknown as { inspector: { beginRender(uid: string, s: unknown, c: unknown, rt: unknown): void; __passLabels?: Map<string, string> } }).inspector;
    if (!insp.__passLabels) {
      const labels = new Map<string, string>();
      insp.__passLabels = labels;
      const orig = insp.beginRender.bind(insp);
      insp.beginRender = (uid, s, c, rt): void => {
        orig(uid, s, c, rt);
        const t = rt as { texture?: { name?: string }; width: number; height: number } | null;
        const name = t ? (t.texture?.name || `rt ${t.width}x${t.height}`) : 'canvas';
        labels.set(uid.replace(/:f\d+$/, ''), name);
      };
    }
    const labels = insp.__passLabels;
    await this.renderer.resolveTimestampsAsync('render');
    const per: Record<string, number[]> = {};
    const totals: number[] = [];
    for (let i = 0; i < frames; i++) {
      this.advanceNodeFrame();
      this.renderFrame();
      const total = await this.renderer.resolveTimestampsAsync('render');
      const ts = backend.timestampQueryPool.render?.timestamps;
      if (!ts || typeof total !== 'number' || !(total > 0)) continue;
      totals.push(total);
      const frame: Record<string, number> = {};
      for (const [uid, ms] of ts) {
        const id = uid.replace(/:f\d+$/, '');
        const label = labels.get(id) ?? `ctx ${id}`;
        frame[label] = (frame[label] ?? 0) + ms;
      }
      for (const [k, v] of Object.entries(frame)) (per[k] ??= []).push(v);
    }
    // The GPU is shared with the desktop and other processes, whose work can
    // only add time: the 25th percentile is the robust estimate of this
    // frame's own cost (the median is reported too).
    const pct = (a: number[], q: number): number => {
      const s = [...a].sort((x, y) => x - y);
      return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : NaN;
    };
    const r2 = (x: number): number => Math.round(x * 100) / 100;
    const passes: Record<string, number> = {};
    for (const [k, v] of Object.entries(per)) passes[k] = r2(pct(v, 0.25));
    return { total: r2(pct(totals, 0.25)), median: r2(pct(totals, 0.5)), passes };
  }

  /**
   * Post nodes that update once per frame (the scene pass, TAA, GTAO) key on
   * the node frame id, which three advances from its own requestAnimationFrame.
   * Back-to-back benchmark renders inside one task would otherwise all be the
   * same "frame" and only the first would do any work.
   */
  private advanceNodeFrame(): void {
    const nodes = (this.renderer as unknown as { _nodes?: { nodeFrame?: { update(): void } } })._nodes;
    nodes?.nodeFrame?.update();
  }

  private async drain(): Promise<void> {
    const backend = this.renderer.backend as {
      device?: { queue: { onSubmittedWorkDone(): Promise<void> } };
      gl?: WebGL2RenderingContext;
    };
    if (backend.device) {
      await backend.device.queue.onSubmittedWorkDone();
    } else if (backend.gl) {
      const px = new Uint8Array(4);
      backend.gl.readPixels(0, 0, 1, 1, backend.gl.RGBA, backend.gl.UNSIGNED_BYTE, px);
    }
  }

  dispose(): void {
    this.pipeline?.dispose();
    this.pipeline = null;
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
