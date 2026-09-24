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
import { StagePipeline, scalesInsidePipeline, togglesFor, type PassToggles } from './pipeline';
import { DynamicResolution } from './dynres';
import { installSkinnedVelocityFix, preparePreviousBones, snapshotPreviousBones } from './skinnedVelocity';

export * from './quality';
export { StagePipeline, togglesFor, scalesInsidePipeline, createLutTexture } from './pipeline';
export type { PassToggles } from './pipeline';
export { DynamicResolution, FrameMeter } from './dynres';
export { gradeColor, buildLutData, BROADCAST_GRADE, LUT_SIZE } from './lut';

export type StageBackend = 'webgpu' | 'webgl2';
export type BackendRequest = 'auto' | StageBackend;

/** `?backend=webgl2` / `?backend=webgpu` in the page URL, else auto. */
export function requestedBackend(search: string = typeof location !== 'undefined' ? location.search : ''): BackendRequest {
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
    this.scene.background = new Color(0x050608);
  }

  /** Create the renderer and wait for its device. Throws when no GPU path works. */
  static async create(container: HTMLElement, opts: StageOptions): Promise<Stage> {
    // Correct motion vectors for skinned bodies that share materials (see
    // skinnedVelocity.ts). `?skinVelFix=0` leaves three's own path, for A/B.
    const noFix = typeof location !== 'undefined' && new URLSearchParams(location.search).get('skinVelFix') === '0';
    if (!noFix) installSkinnedVelocityFix();
    const want = opts.backend ?? requestedBackend();
    const renderer = new WebGPURenderer({
      antialias: false,
      forceWebGL: want === 'webgl2',
      powerPreference: 'high-performance',
      trackTimestamp: opts.trackTimestamp === true,
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
    this.dynres = dr && !this.fixedResolution && scalesInsidePipeline(this.toggles)
      ? new DynamicResolution(this.quality.renderScale, { min: Math.min(dr.min, this.quality.renderScale), max: Math.max(dr.max, this.quality.renderScale) })
      : null;
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
    if (s.cut) this.pipeline?.cut();
  }

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
    if (!this.dynres || !this.pipeline) return;
    this.pipeline.setInternalScale(this.dynres.sample(frameMs));
  }

  render(): void {
    if (!this.pipeline) return;
    this.renderer.info.reset();
    // One node frame per presented frame, whatever three's own rAF did in
    // between: skeletons, TAA and GTAO update exactly once per picture.
    this.advanceNodeFrame();
    snapshotPreviousBones(this.scene);
    this.pipeline.render(this.replayOn);
  }

  /**
   * Compile the scene's materials for the scene pass without drawing, yielding
   * to the page between objects (integration: the loading state runs while
   * this does). Call after the set and the bodies are in the scene.
   */
  async precompile(onProgress?: (loaded: number, total: number) => void): Promise<void> {
    preparePreviousBones(this.scene);
    await this.pipeline?.compileScene(this.scene, onProgress);
  }

  /** Compile the replay pipeline ahead of the first replay. */
  /** The warm-up split into steps (see `StagePipeline.warmSteps`). */
  warmUpSteps(): (() => void)[] {
    return this.pipeline?.warmSteps() ?? [];
  }

  warmUp(): void {
    this.pipeline?.warmReplay();
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
    if (this.timestamps) return this.gpuTime(frames, onFrame);
    await this.drain();
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      onFrame?.(i);
      this.advanceNodeFrame();
      this.render();
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
    await this.renderer.resolveTimestampsAsync('render');
    let sum = 0;
    let n = 0;
    for (let i = 0; i < frames; i++) {
      onFrame?.(i);
      this.advanceNodeFrame();
      this.render();
      const ms = await this.renderer.resolveTimestampsAsync('render');
      if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) { sum += ms; n++; }
    }
    return n > 0 ? sum / n : NaN;
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
