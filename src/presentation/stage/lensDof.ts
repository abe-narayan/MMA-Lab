/**
 * LENS DEPTH OF FIELD — a gather DoF built for the broadcast shots (performance pass).
 *
 * Replaces three's `DepthOfFieldNode` on the live handhelds and the replay angles. That node
 * costs ~4 ms at 1440p on the Arc 140V (measured with GPU timestamps: seven passes, two of them at
 * output resolution, a 64-tap gather that reads the *full-resolution* input from a half-resolution
 * pass, a Gaussian blur of the near CoC and a max filter). This one is three small passes and an
 * inline composite, ~0.5 ms:
 *
 *   1. prefilter (half res): colour (one bilinear tap = the 2×2 box) + signed circle of confusion
 *      from the scene depth (negative = in front of the focus plane);
 *   2. near tiles (1/16 res): the largest near CoC around each tile, so an in-focus pixel knows
 *      how far a blurred foreground object (the fence wire at the lens) reaches over it;
 *   3. gather (half res, 24-tap Vogel disc read from the half-res prefilter, cache-friendly):
 *      - near layer: the foreground scattered over this pixel (scatter-as-gather: a tap counts when
 *        its own CoC reaches this pixel, weighted by its spread area), with its coverage as alpha;
 *      - background: taps no nearer than this pixel and no blurrier (the min-CoC rule, so a blurred
 *        background never bleeds over a sharp fighter); under a near pixel, the non-near
 *        neighbours instead (the scene *behind* the fence wire, which the camera sees around it);
 *   4. composite, inline in whatever reads it (the bloom's high pass and the grade's texture pass,
 *      so it costs no pass of its own): the full-resolution picture where in focus, the background
 *      blur where out of focus, the near layer over the top.
 *
 * Near field: a blurred foreground object becomes a veil of its own colour over the sharp
 * subject (what a real lens does); three's node blended a blurred copy of the whole picture.
 * Finding (read back from the CoC target): the chain-link fence writes no depth (a coverage-blended
 * material), so for either node it is not a near object at all — its softening on CAGESIDE comes
 * from the background's far-field blur behind each wire, and the two nodes look alike there
 * (docs/screenshots/phase8-perf-cageside*.png). If the fence ever writes depth, the near layer
 * here blurs it as the thin-lens model intends. The tests hold the CoC model and the kernel.
 */
import {
  HalfFloatType, NodeMaterial, NodeUpdateType, QuadMesh, RedFormat, RenderTarget, RendererUtils, TempNode, Vector2,
  type Renderer,
} from 'three/webgpu';
import {
  Fn, If, Loop, abs, context, convertToTexture, float, max, min, mix, nodeObject, outputStruct, property, select,
  smoothstep, texture, uniform, uniformArray, uv, vec2, vec4,
} from 'three/tsl';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type N = any;

/** Gather taps. 24 over a disc of ≤ ~8 half-res pixels is one tap per ~8 px², smoothed by bilinear reads. */
export const LENS_DOF_TAPS = 24;
/** Near-layer coverage gain (see the gather). */
export const NEAR_GAIN = 2.5;

/**
 * Vogel (golden-angle) disc: `n` points, uniformly spread over the unit disc, radius
 * sqrt((i + 0.5) / n) — no ring structure, so the blur has no visible pattern.
 */
export function vogelDisc(n: number): [number, number][] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n);
    const a = i * golden;
    out.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return out;
}

/**
 * Signed circle of confusion, the CPU mirror of the shader: 0 at the focus distance, → -1 in
 * front of it (near), → +1 behind it, complete at |distance − focus| = range.
 */
export function signedCoc(distM: number, focusM: number, rangeM: number): number {
  const s = distM - focusM;
  const x = Math.min(1, Math.max(0, Math.abs(s) / Math.max(1e-6, rangeM)));
  const c = x * x * (3 - 2 * x);
  return s < 0 ? -c : c;
}

const _quad = /*@__PURE__*/ new QuadMesh(null as N);
let _state: N;

export class LensDofNode extends TempNode {
  static get type(): string { return 'LensDofNode'; }

  readonly textureNode: N;
  readonly viewZNode: N;
  readonly focusNode: N;
  readonly rangeNode: N;
  /** Blur radius at full CoC, in output pixels. */
  readonly radiusNode: N;

  private readonly prefilterRT = new RenderTarget(1, 1, { depthBuffer: false, type: HalfFloatType });
  private readonly tileRT = new RenderTarget(1, 1, { depthBuffer: false, type: HalfFloatType, format: RedFormat });
  private readonly gatherRT = new RenderTarget(1, 1, { depthBuffer: false, type: HalfFloatType, count: 2 });
  private readonly prefilterMat = new NodeMaterial();
  private readonly tileMat = new NodeMaterial();
  private readonly gatherMat = new NodeMaterial();
  private readonly invHalf = uniform(new Vector2());
  private readonly halfSize = uniform(new Vector2());
  private readonly prefilterTex: N = texture(this.prefilterRT.texture);
  private readonly tileTex: N = texture(this.tileRT.texture);
  private readonly nearTex: N = texture(this.gatherRT.textures[0]);
  private readonly bgTex: N = texture(this.gatherRT.textures[1]);

  constructor(textureNode: N, viewZNode: N, focusNode: N, rangeNode: N, radiusNode: N) {
    super('vec4');
    this.textureNode = textureNode;
    this.viewZNode = viewZNode;
    this.focusNode = focusNode;
    this.rangeNode = rangeNode;
    this.radiusNode = radiusNode;
    this.prefilterRT.texture.name = 'LensDof.prefilter';
    this.tileRT.texture.name = 'LensDof.nearTiles';
    this.gatherRT.textures[0].name = 'LensDof.gather';
    this.gatherRT.textures[1].name = 'LensDof.background';
    (this as N).updateBeforeType = NodeUpdateType.FRAME;
  }

  setSize(width: number, height: number): void {
    const hw = Math.max(1, Math.round(width / 2));
    const hh = Math.max(1, Math.round(height / 2));
    this.prefilterRT.setSize(hw, hh);
    this.gatherRT.setSize(hw, hh);
    this.tileRT.setSize(Math.max(1, Math.ceil(hw / 8)), Math.max(1, Math.ceil(hh / 8)));
    this.invHalf.value.set(1 / hw, 1 / hh);
    this.halfSize.value.set(hw, hh);
  }

  updateBefore(frame: N): undefined {
    const renderer: Renderer = frame.renderer;
    const map = this.textureNode.value;
    this.setSize(map.image.width, map.image.height);
    _state = RendererUtils.resetRendererState(renderer, _state);
    renderer.setClearColor(0x000000, 0);
    _quad.material = this.prefilterMat;
    renderer.setRenderTarget(this.prefilterRT);
    _quad.name = 'LensDof [ prefilter ]';
    _quad.render(renderer);
    _quad.material = this.tileMat;
    renderer.setRenderTarget(this.tileRT);
    _quad.name = 'LensDof [ near tiles ]';
    _quad.render(renderer);
    _quad.material = this.gatherMat;
    renderer.setRenderTarget(this.gatherRT);
    _quad.name = 'LensDof [ gather ]';
    _quad.render(renderer);
    RendererUtils.restoreRendererState(renderer, _state);
    return undefined;
  }

  setup(builder: N): N {
    const shared: N = context(builder.getSharedContext());
    const coc = (viewZ: N): N => {
      const s: N = viewZ.negate().sub(this.focusNode);
      const c: N = smoothstep(0, this.rangeNode, abs(s));
      return select(s.lessThan(0), c.negate(), c);
    };

    // 1. Prefilter: half-res colour + signed CoC.
    this.prefilterMat.contextNode = shared;
    this.prefilterMat.fragmentNode = Fn(() => {
      const c: N = this.textureNode.sample(uv());
      return vec4(c.rgb, coc(this.viewZNode));
    })();
    this.prefilterMat.needsUpdate = true;

    // 2. Near tiles: the largest near CoC within ±12 half-res px (a 5×5 grid of bilinear taps
    //    6 px apart, centred on the tile), i.e. the tile and its neighbours.
    this.tileMat.contextNode = shared;
    this.tileMat.fragmentNode = Fn(() => {
      const m: N = float(0).toVar();
      for (let y = -2; y <= 2; y++) {
        for (let x = -2; x <= 2; x++) {
          const t: N = this.prefilterTex.sample(uv().add(vec2(x * 6, y * 6).mul(this.invHalf))).level(0);
          m.assign(max(m, t.a.negate()));
        }
      }
      return vec4(m, 0, 0, 1);
    })();
    this.tileMat.needsUpdate = true;

    // 3. Gather.
    const kernel: N = uniformArray(vogelDisc(LENS_DOF_TAPS).map(([x, y]) => new Vector2(x, y)));
    const nearOut: N = property('vec4');
    const bgOut: N = property('vec4');
    this.gatherMat.contextNode = shared;
    const radiusHalf: N = this.radiusNode.mul(0.5); // output px → half-res px
    this.gatherMat.colorNode = Fn(() => {
      const p: N = uv();
      const centre: N = this.prefilterTex.sample(p).level(0).toConst();
      const cC: N = centre.a;
      const nearTile: N = this.tileTex.sample(p).level(0).r;
      // Gather radius (half-res px): this pixel's own blur, or the widest foreground around it.
      const R: N = max(abs(cC), nearTile).mul(radiusHalf).toConst();
      const nearAcc: N = vec4(0).toVar();
      const bgAcc: N = vec4(centre.rgb, 1).toVar();
      const fillAcc: N = vec4(0).toVar();
      // Below half a pixel the gather would return the centre anyway.
      If(R.greaterThan(0.5), () => {
        const cBg: N = max(cC, 0).mul(radiusHalf);
        Loop(LENS_DOF_TAPS, ({ i }: N) => {
          const k: N = kernel.element(i);
          const d: N = k.length().mul(R);
          const tap: N = this.prefilterTex.sample(p.add(k.mul(R).mul(this.invHalf))).level(0);
          const r: N = abs(tap.a).mul(radiusHalf);
          // Near: the tap's own blur reaches this pixel; its light is spread over its disc, so it
          // weighs (R / r)² relative to a disc the size of the gather (clamped for tiny CoCs).
          const reach: N = r.sub(d).add(0.5).clamp(0, 1);
          const isNear: N = tap.a.lessThan(-0.02);
          const spread: N = R.div(max(r, 0.5)).pow(2).min(4);
          const wN: N = select(isNear, reach.mul(spread), float(0));
          nearAcc.addAssign(vec4(tap.rgb.mul(wN), wN));
          // Background: behind or at this pixel, and no blurrier than it (min-CoC rule).
          const wB: N = select(isNear, float(0), min(max(tap.a, 0).mul(radiusHalf), cBg).sub(d).add(0.5).clamp(0, 1));
          bgAcc.addAssign(vec4(tap.rgb.mul(wB), wB));
          // Fill: what is seen around a foreground occluder (used under near pixels).
          const wF: N = select(isNear, float(0), float(1));
          fillAcc.addAssign(vec4(tap.rgb.mul(wF), wF));
        });
      });
      // Coverage → opacity. A physically exact veil (gain 1) makes the out-of-focus fence almost
      // vanish; 2.5 matches the soft, still-readable bars of the broadcast look (and of three's
      // node) while keeping the fall-off smooth, because the coverage varies smoothly with position.
      const nearA: N = nearAcc.w.div(LENS_DOF_TAPS).mul(NEAR_GAIN).clamp(0, 1);
      const nearRgb: N = nearAcc.xyz.div(max(nearAcc.w, 1e-4));
      const bg: N = bgAcc.xyz.div(bgAcc.w);
      const fill: N = select(fillAcc.w.greaterThan(0.5), fillAcc.xyz.div(max(fillAcc.w, 1e-4)), bg);
      nearOut.assign(vec4(nearRgb, nearA));
      bgOut.assign(vec4(mix(bg, fill, smoothstep(0.01, 0.08, cC.negate())), cC));
      return vec4(0);
    })();
    this.gatherMat.outputNode = outputStruct(nearOut, bgOut);
    this.gatherMat.needsUpdate = true;

    // 4. Composite (inline).
    const p: N = uv();
    const sharp: N = this.textureNode.sample(p);
    const cF: N = coc(this.viewZNode);
    const near: N = this.nearTex.sample(p);
    const bg: N = this.bgTex.sample(p);
    // Out of focus behind (fb) or in front (fn): the half-res background replaces the sharp picture.
    const fb: N = smoothstep(0.02, 0.2, abs(cF).mul(this.radiusNode).mul(0.25));
    // A pixel of the blurred foreground itself shows what is behind it (the near layer on top
    // supplies the soft foreground): keeping any of the sharp pixel here draws a crisp edge.
    const fn: N = smoothstep(0.01, 0.06, cF.negate());
    const base: N = mix(mix(sharp.rgb, bg.rgb, fb), bg.rgb, fn);
    return vec4(mix(base, near.rgb, near.a), sharp.a);
  }

  dispose(): void {
    super.dispose();
    this.prefilterRT.dispose();
    this.tileRT.dispose();
    this.gatherRT.dispose();
    this.prefilterMat.dispose();
    this.tileMat.dispose();
    this.gatherMat.dispose();
  }
}

/**
 * TSL entry point. `range` is how far from the focus plane the blur completes (world units; may
 * be a per-pixel node), `radius` the blur radius at full CoC in output pixels.
 */
export const lensDof = (node: N, viewZ: N, focus: N, range: N, radius: N): LensDofNode =>
  new LensDofNode(convertToTexture(node), nodeObject(viewZ), nodeObject(focus), nodeObject(range), nodeObject(radius));
