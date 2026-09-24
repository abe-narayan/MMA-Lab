/**
 * THE POST-PROCESSING PIPELINE (docs/design/08 §4.4) — TSL on WebGPURenderer.
 *
 *   scene pass (MRT: colour, packed normal, velocity [, metal/rough])  internal res
 *     └─ GTAO (at internal resolution) ───────────┐
 *   AO composite (colour × AO) [+ SSR]           ┘  internal res, one quad
 *     └─ TAAU (internal → output) | TRAA (native) | nothing          output res
 *          └─ live handhelds: thin-lens depth of field (the fence at the lens goes soft)
 *          └─ replay only: depth of field → motion blur
 *               └─ bloom (mip chain at half res, threshold above paper white)
 *                    └─ tone map (ACES filmic) + sRGB encode
 *                         └─ 3D LUT broadcast grade  ─┐ display space
 *                              └─ FXAA (Low) | RCAS sharpen (after TAA)
 *                                   └─ vignette + grain (final quad)
 *
 * Why this order:
 *  - AO goes *into* the temporal resolve: GTAO is rendered with a rotating
 *    sample pattern (`useTemporalFiltering`) and the TAA is its denoiser, the
 *    same arrangement three.js's own GTAO example uses. It is applied to the
 *    lit colour rather than through `builtinAOContext` because the latter needs
 *    a second geometry pre-pass of both fighters and the crowd (~1-2 ms on the
 *    Arc) to exist before the scene pass; a composite quad costs ~0.15 ms. The
 *    price — AO also darkens direct light — reads as contact shadowing under
 *    overhead arena lights, which is what a real broadcast shows anyway.
 *  - Depth of field and motion blur run after the temporal resolve, at output
 *    resolution, on the clean image (feeding blur into TAA smears the history)
 *    and only in the replay pipeline, so live play never pays for them.
 *  - Bloom runs on the resolved HDR image so it does not flicker with jitter.
 *  - The grade is a LUT in display space, after tone mapping: that is where a
 *    broadcast colourist's LUT lives and where "mid-grey" is perceptual.
 *  - RCAS sharpening follows TAAU (as in FSR) to restore the crispness a
 *    temporal upscale softens; FXAA needs sRGB input, so it follows the grade.
 *
 * Three `RenderPipeline`s share every node up to the temporal resolve: `live`,
 * `liveDof` (the close handhelds) and `replay`. Switching between them is free (no shader rebuild), and the
 * replay one is warmed up at start so the first instant replay does not hitch.
 */
import {
  Data3DTexture, LinearFilter, RenderPipeline, UnsignedByteType, RGBAFormat, ClampToEdgeWrapping,
  NoColorSpace, Vector2, type Camera, type Node, type Object3D, type Scene, type WebGPURenderer,
} from 'three/webgpu';
import {
  Fn, float, int, interleavedGradientNoise, max as tslMax, metalness, mix, mrt, normalView, output, pass,
  packNormalToRGB, renderOutput, roughness, rtt, sample, screenCoordinate, screenUV, smoothstep,
  texture3D, uniform, unpackRGBToNormal, uv, vec2, vec3, vec4, velocity,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { taau } from 'three/addons/tsl/display/TAAUNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { motionBlur } from 'three/addons/tsl/display/MotionBlur.js';
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import type { QualitySettings } from '../contract';
import type { StageTuning } from './quality';
import { buildLutData, LUT_SIZE } from './lut';

/** Every pass the dev page can switch individually; derived from the preset otherwise. */
export interface PassToggles {
  ao: boolean;
  ssr: boolean;
  bloom: boolean;
  /** Temporal/spatial anti-aliasing and upscaling. */
  aa: 'none' | 'fxaa' | 'smaa' | 'traa' | 'taau';
  dof: boolean;
  /**
   * Live depth of field on the close handhelds (cageside, corner, finish):
   * the fence mesh a few centimetres from the lens goes soft, as it does
   * through a real lens, while the fighters stay sharp. A third pipeline,
   * used only while the shot asks for it (`CameraState.dof > 0`).
   */
  liveDof: boolean;
  motionBlur: boolean;
  grade: boolean;
  sharpen: boolean;
  vignetteGrain: boolean;
  /** QA only (`?stagePost=view:velocity`): show the motion vectors instead of the picture. */
  debugView?: 'velocity';
}

export function togglesFor(q: QualitySettings): PassToggles {
  const aa: PassToggles['aa'] = q.upscale === 'taau' ? 'taau'
    : q.antialias === 'traa' ? 'traa'
      : q.antialias === 'smaa' ? 'smaa' : 'fxaa';
  return {
    ao: q.ambientOcclusion,
    ssr: q.screenSpaceReflections,
    bloom: q.bloom,
    aa,
    dof: q.replayDepthOfField,
    liveDof: q.replayDepthOfField,
    motionBlur: q.replayMotionBlur,
    grade: true,
    sharpen: aa === 'taau' || aa === 'traa',
    vignetteGrain: true,
  };
}

/** The internal render target is scaled inside the pipeline only when a temporal upscaler reconstructs it. */
export function scalesInsidePipeline(t: PassToggles): boolean {
  return t.aa === 'taau';
}

// Loosely typed node handle: the TSL typings are generic over the value type
// and the composition below mixes vec4 textures, TempNodes and Fn results.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** Build the broadcast LUT as a GPU texture (32³ RGBA8, linear filtering). */
export function createLutTexture(): Data3DTexture {
  const tex = new Data3DTexture(buildLutData(LUT_SIZE), LUT_SIZE, LUT_SIZE, LUT_SIZE);
  tex.format = RGBAFormat;
  tex.type = UnsignedByteType;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.wrapR = ClampToEdgeWrapping;
  tex.colorSpace = NoColorSpace;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/** Halton(2,3) offsets for the grain so it never repeats a pattern two frames running. */
function grainOffset(frame: number, out: Vector2): Vector2 {
  const halton = (i: number, b: number): number => {
    let f = 1, r = 0;
    while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); }
    return r;
  };
  const i = (frame % 64) + 1;
  return out.set(halton(i, 2) * 64, halton(i, 3) * 64);
}

export class StagePipeline {
  readonly live: RenderPipeline;
  readonly replay: RenderPipeline;
  /** The live picture with the handheld depth of field (the same as `live` when off). */
  readonly liveDof: RenderPipeline;
  readonly toggles: PassToggles;

  private readonly scenePass: N;
  private readonly composite: N | null = null;
  private readonly aoNode: N | null = null;
  private readonly temporal: N | null = null;
  private readonly lutTexture: Data3DTexture | null;
  private readonly disposables: { dispose(): void }[] = [];

  // Per-frame uniforms.
  private readonly uFocus = uniform(4);
  private readonly uFocalRange = uniform(3);
  private readonly uBokeh = uniform(0);
  private readonly uBlur = uniform(0.5);
  private readonly uGrainOffset = uniform(new Vector2());
  private readonly uGrain: N;
  private readonly uVignette: N;
  private readonly uGrade = uniform(1);
  /** Live DoF: focus distance and the lens constant k (blur complete at |z - focus| = k·z). */
  private readonly uLiveFocus = uniform(3);
  private readonly uLiveK = uniform(4);
  private readonly uLiveBokeh = uniform(1.6);
  private liveDofOn = false;
  private frameIndex = 0;
  private internalScale: number;
  private readonly aoResolution: number;
  private replayWarm = false;

  constructor(
    private readonly renderer: WebGPURenderer,
    scene: Scene,
    private readonly camera: Camera,
    quality: QualitySettings,
    tuning: StageTuning,
    toggles: PassToggles = togglesFor(quality),
  ) {
    this.toggles = toggles;
    this.uGrain = uniform(tuning.grain);
    this.uVignette = uniform(tuning.vignette);
    this.aoResolution = tuning.aoResolution;

    const t = toggles;
    const temporalAA = t.aa === 'taau' || t.aa === 'traa';
    const needsVelocity = temporalAA || t.motionBlur;
    const needsNormal = t.ao || t.ssr;

    // ---- scene pass -------------------------------------------------------
    // No MSAA: the temporal resolve is the anti-aliasing, and MSAA on an MRT
    // target would multiply the bandwidth of every attachment.
    const scenePass: N = pass(scene, camera, { samples: 0 });
    const outputs: Record<string, N> = { output };
    if (needsNormal) outputs.normal = packNormalToRGB(normalView);
    if (needsVelocity) outputs.velocity = velocity;
    if (t.ssr) outputs.metalrough = vec2(metalness, roughness);
    if (Object.keys(outputs).length > 1) scenePass.setMRT(mrt(outputs));
    // Bandwidth: 8-bit normals and material channels are plenty for AO/SSR.
    if (needsNormal) scenePass.getTexture('normal').type = UnsignedByteType;
    if (t.ssr) scenePass.getTexture('metalrough').type = UnsignedByteType;
    this.scenePass = scenePass;

    this.internalScale = scalesInsidePipeline(t) ? quality.renderScale : 1;
    scenePass.setResolutionScale(this.internalScale);

    const colour: N = scenePass.getTextureNode('output');
    const depth: N = scenePass.getTextureNode('depth');
    const vel: N = needsVelocity ? scenePass.getTextureNode('velocity') : null;
    const normal: N = needsNormal
      ? sample((u: N) => unpackRGBToNormal(scenePass.getTextureNode('normal').sample(u)))
      : null;

    // ---- AO / SSR composite ---------------------------------------------
    let hdr: N = colour;
    if (t.ao || t.ssr) {
      let lit: N = colour.rgb;
      if (t.ao) {
        const aoNode: N = ao(depth, normal, camera);
        aoNode.resolutionScale = this.aoResolution * this.internalScale;
        aoNode.samples.value = tuning.aoSamples;
        // Human scale: a 0.4 m radius catches armpits, the gap between two
        // fighters in the clinch and the foot on the canvas, not the cage.
        aoNode.radius.value = 0.4;
        aoNode.thickness.value = 0.8;
        aoNode.useTemporalFiltering = temporalAA;
        this.aoNode = aoNode;
        // 0.85 strength: full-strength GTAO on direct light reads as dirt.
        const aoValue: N = aoNode.getTextureNode().sample(uv()).r;
        lit = lit.mul(mix(float(1), aoValue, 0.85));
      }
      if (t.ssr) {
        const metalRough: N = scenePass.getTextureNode('metalrough');
        const ssrNode: N = ssr(colour, depth, normal, {
          metalnessNode: metalRough.r, roughnessNode: metalRough.g, camera,
        });
        ssrNode.resolutionScale = 0.5 * this.internalScale;
        lit = lit.add(ssrNode.rgb);
        this.disposables.push(ssrNode);
      }
      // The composite is a texture at the scene pass's resolution so the
      // temporal resolve reads it exactly as it would the raw scene colour.
      this.composite = rtt(vec4(lit, colour.a), null, null, { resolutionScale: this.internalScale });
      hdr = this.composite;
    }

    // ---- temporal resolve -----------------------------------------------
    if (t.aa === 'taau') {
      const node: N = taau(hdr, depth, vel, camera);
      this.temporal = node;
      hdr = node.getTextureNode();
    } else if (t.aa === 'traa') {
      const node: N = traa(hdr, depth, vel, camera);
      this.temporal = node;
      hdr = node.getTextureNode();
    }

    // ---- the live and replay tails ---------------------------------------
    const tail = (input: N, replay: boolean, liveDof = false): N => {
      let c: N = input;
      if (liveDof) {
        // A thin-lens circle of confusion grows with |z - focus| / z: the
        // fence 0.35 m from the lens is far out of focus, the far side of the
        // cage only a little. DepthOfFieldNode blurs completely at
        // |z - focus| = focalLength, so focalLength = k·z reproduces that
        // falloff (k from the shot's DoF strength, `setDepthOfField`).
        const viewDist: N = scenePass.getViewZNode().negate();
        const range: N = tslMax(viewDist.mul(this.uLiveK), 0.05);
        const d: N = dof(c, scenePass.getViewZNode(), this.uLiveFocus, range, this.uLiveBokeh);
        this.disposables.push(d);
        c = d;
      }
      if (replay && t.dof) {
        // Focal range: how far from the focus plane before blur is complete.
        const d: N = dof(c, scenePass.getViewZNode(), this.uFocus, this.uFocalRange, this.uBokeh);
        this.disposables.push(d);
        // The node itself, not getTextureNode(): DoF's texture is a plain
        // texture() with no link back to the node, so using it alone would
        // leave the DoF passes out of the graph.
        c = d;
      }
      if (replay && t.motionBlur && vel) {
        // Motion blur samples its input at offsets, so it needs a texture: the
        // temporal resolve's output as is, or the DoF result copied to one.
        const tex: N = c.isTextureNode ? c : rtt(c);
        c = motionBlur(tex, vel.xy.mul(this.uBlur), int(12));
      }
      if (t.bloom) {
        // Threshold above paper white: only fixtures, speculars on sweat and
        // the lit LED strips glow. Strength is broadcast-subtle, not a dream.
        const b: N = bloom(c, 0.14, 0.35, 1.15);
        b.smoothWidth.value = 0.3;
        b.setResolutionScale(0.5);
        this.disposables.push(b);
        c = vec4(c.rgb.add(b.rgb), 1);
      }
      let ldr: N = renderOutput(c);
      if (t.grade && this.lutTexture) {
        ldr = lut3D(ldr, texture3D(this.lutTexture), LUT_SIZE, this.uGrade);
      }
      if (t.aa === 'fxaa') ldr = fxaa(ldr);
      else if (t.aa === 'smaa') ldr = smaa(ldr);
      if (t.sharpen) {
        const s: N = sharpen(ldr, tuning.sharpness, true);
        this.disposables.push(s);
        ldr = s;
      }
      if (t.vignetteGrain) ldr = this.finish(ldr);
      return ldr;
    };

    this.lutTexture = t.grade ? createLutTexture() : null;

    this.live = new RenderPipeline(renderer);
    this.live.outputColorTransform = false;
    this.live.outputNode = tail(hdr, false);

    if (t.debugView === 'velocity' && vel) {
      // Motion vectors in pixels of the internal image: red = x, green = y (abs, ×0.25), blue = none.
      const px: N = vel.xy.mul(vec2(scenePass.getTextureNode('output').size())).mul(0.5).abs().mul(0.25);
      this.live.outputNode = vec4(px.x, px.y, float(0.02), 1);
    }

    this.replay = new RenderPipeline(renderer);
    this.replay.outputColorTransform = false;
    this.replay.outputNode = (t.dof || t.motionBlur) ? tail(hdr, true) : this.live.outputNode;

    if (t.liveDof) {
      this.liveDof = new RenderPipeline(renderer);
      this.liveDof.outputColorTransform = false;
      this.liveDof.outputNode = tail(hdr, false, true);
    } else {
      this.liveDof = this.live;
    }
  }

  /** Vignette and grain in display space: the last, cheapest touch. */
  private finish(input: N): N {
    const uGrain = this.uGrain;
    const uVignette = this.uVignette;
    const uOffset = this.uGrainOffset;
    return Fn(() => {
      const c: N = input;
      // Elliptical falloff that starts past the rule-of-thirds lines, so the
      // fighters (always framed centrally) are never darkened.
      const d: N = screenUV.sub(0.5).mul(vec2(1.0, 0.8)).length();
      const v: N = float(1).sub(uVignette.mul(smoothstep(0.3, 0.75, d)));
      // Deterministic per-frame noise: interleaved gradient noise shifted by a
      // Halton offset. Weighted toward the mid-tones like camera sensor noise.
      const n: N = interleavedGradientNoise(screenCoordinate.add(uOffset)).sub(0.5);
      const lum: N = c.rgb.dot(vec3(0.2126, 0.7152, 0.0722));
      const g: N = n.mul(uGrain).mul(float(1).sub(lum.sub(0.45).abs().mul(1.4)).max(0.25));
      return vec4(c.rgb.mul(v).add(g), 1);
    })();
  }

  get internalResolutionScale(): number {
    return this.internalScale;
  }

  /** Dynamic resolution: move the internal scale (TAAU presets only). */
  setInternalScale(s: number): void {
    if (!scalesInsidePipeline(this.toggles)) return;
    if (Math.abs(s - this.internalScale) < 1e-3) return;
    this.internalScale = s;
    this.scenePass.setResolutionScale(s);
    if (this.composite) this.composite.setResolutionScale(s);
    if (this.aoNode) this.aoNode.resolutionScale = this.aoResolution * s;
  }

  /**
   * Depth of field from the camera director's shot: the replay DoF (focus and
   * strength), and the live handheld DoF, which is on while `strength > 0`.
   */
  setDepthOfField(focusM: number, strength: number): void {
    this.uFocus.value = Math.max(0.3, focusM);
    // Live: strength 0.35 (cageside) → k ≈ 3.2: the fence at 0.35 m is fully
    // soft, the fighters (±0.4 m around focus) stay sharp, the far side of the
    // cage only slightly soft.
    this.liveDofOn = strength > 0.01;
    this.uLiveFocus.value = Math.max(0.3, focusM);
    this.uLiveK.value = 1.1 / Math.max(0.05, Math.min(1, strength));
    // Bokeh radius in half-resolution texels at full CoC: ~10 px on a 1080p picture at 0.35 (wider radii cost texture cache on the Arc).
    this.uLiveBokeh.value = 2 + 9 * Math.min(1, strength);
    // Strength 1 ≈ a long lens at f/2.8 on a fighter 4 m away: sharp over about
    // a metre, fully soft 1.2 m beyond it.
    const s = Math.min(1, Math.max(0, strength));
    this.uFocalRange.value = 6 - 4.8 * s;
    this.uBokeh.value = 3.5 * s;
  }

  setGradeIntensity(v: number): void {
    this.uGrade.value = v;
  }

  /**
   * Drop temporal history on a hard cut: the previous frame shows another
   * camera, and reprojecting it would ghost the old shot into the new one for
   * a dozen frames. Forcing the history target to a stale size makes the
   * resolve re-seed it from the current frame, exactly as after a resize.
   * Motion blur is suppressed for the cut frame, whose velocities are
   * measured against the other camera.
   */
  cut(): void {
    const node = this.temporal as { _historyRenderTarget?: { setSize(w: number, h: number): void } } | null;
    node?._historyRenderTarget?.setSize(1, 1);
    this.cutFrames = 1;
  }

  private cutFrames = 0;

  render(replay: boolean): void {
    this.uGrainOffset.value.copy(grainOffset(this.frameIndex++, this.uGrainOffset.value));
    this.uBlur.value = this.cutFrames > 0 ? 0 : 0.5;
    if (this.cutFrames > 0) this.cutFrames--;
    (replay ? this.replay : this.liveDofOn ? this.liveDof : this.live).render();
  }

  /**
   * Render the replay pipeline once so its shaders compile now rather than on
   * the first knockdown replay. The frame is immediately overdrawn by `live`.
   */
  warmReplay(): void {
    for (const step of this.warmSteps()) step();
  }

  /**
   * The extra pipelines' first draws (replay, live DoF) as separate steps, so a
   * caller can yield to the page between them: on WebGL2 each first draw can
   * block for seconds while the driver compiles.
   */
  warmSteps(): (() => void)[] {
    if (this.replayWarm) return [];
    this.replayWarm = true;
    const steps: (() => void)[] = [];
    if (this.replay.outputNode !== this.live.outputNode) steps.push(() => this.replay.render());
    if (this.liveDof !== this.live) steps.push(() => this.liveDof.render());
    return steps;
  }

  /**
   * Compile every material the scene pass will draw, before the first frame
   * and off the critical path (added by the integration work). three's
   * `compileAsync` yields to the main thread between objects and, on WebGPU,
   * creates pipelines asynchronously, so the page stays responsive while the
   * driver works. It must target the scene pass's own render target and MRT:
   * node programs and pipelines are cached per render context, so compiling
   * against the canvas would warm the wrong variants. Hidden objects (LOD
   * levels, a referee not yet on the floor) and off-screen ones (the far
   * crowd for a later cut) are included by lifting visibility and frustum
   * culling for the synchronous collection step only.
   *
   * WebGL2 caveat (measured): ANGLE reports the programs ready but does the
   * driver-level work on the first draw, so there the first frame still
   * blocks (~12 s on the Arc 140V); drawing objects a few at a time instead
   * only made the total longer (single draws blocked 2-8 s each).
   */
  async compileScene(scene: Scene, onProgress?: (loaded: number, total: number) => void): Promise<void> {
    const r = this.renderer as unknown as {
      getRenderTarget(): unknown; setRenderTarget(t: unknown): void; getMRT(): unknown; setMRT(m: unknown): void;
      compileAsync(s: unknown, c: unknown, t: unknown, p: ((e: ProgressEvent) => void) | null): Promise<void>;
    };
    const sp = this.scenePass as { renderTarget: unknown; getMRT(): unknown };
    const lifted: [Object3D, boolean, boolean][] = [];
    scene.traverse((o) => {
      lifted.push([o, o.visible, o.frustumCulled]);
      o.visible = true;
      o.frustumCulled = false;
    });
    const prevTarget = r.getRenderTarget();
    const prevMrt = r.getMRT();
    r.setRenderTarget(sp.renderTarget);
    r.setMRT(sp.getMRT());
    try {
      let done: Promise<void>;
      try {
        // Collecting the render list runs synchronously up to compileAsync's
        // first await, so visibility can be restored straight after.
        done = r.compileAsync(scene, this.camera, null, onProgress ? (e) => onProgress(e.loaded, e.total) : null);
      } finally {
        for (const [o, v, f] of lifted) { o.visible = v; o.frustumCulled = f; }
      }
      // The node builds that follow read the renderer's MRT, so the target and
      // MRT stay bound until they finish (nothing else renders during warm-up).
      await done;
    } finally {
      r.setRenderTarget(prevTarget);
      r.setMRT(prevMrt);
    }
  }

  dispose(): void {
    this.live.dispose();
    if (this.replay !== this.live) this.replay.dispose();
    if (this.liveDof !== this.live) this.liveDof.dispose();
    for (const d of this.disposables) {
      try { d.dispose(); } catch { /* already gone */ }
    }
    this.aoNode?.dispose?.();
    this.temporal?.dispose?.();
    this.composite?.dispose?.();
    this.scenePass.dispose();
    this.lutTexture?.dispose();
  }
}

export type { Node };
