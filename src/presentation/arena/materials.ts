/**
 * Venue materials (three.js r186 node materials, TSL).
 *
 *  - Floor (canvas / mat): painted colour texture + a fine woven normal that
 *    fades out by pixel footprint (no shimmer), broad cloth undulation for the
 *    specular, and an analytic contact-occlusion term from the fighters' bones
 *    so bodies sit on the floor even with GTAO off.
 *  - Chain-link: a procedural diamond mesh, exactly box-filtered per pixel
 *    (the integral of the wire pattern over the pixel footprint), so it neither
 *    shimmers nor moirés at any distance and converges to the right grey veil
 *    far away. Wire normals are bent across each wire while it is resolved, so
 *    the top light picks out the vinyl coating.
 */
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uv, fwidth, floor, fract, min, max, clamp, abs, mix, smoothstep,
  positionWorld, normalView, cameraViewMatrix, texture, uniform, uniformArray, Loop, int, If, length,
  mx_noise_float, sin, dot, sqrt, attribute, select, round, mrt, output, cameraPosition,
} from 'three/tsl';

type N = any; // TSL node objects: the @types for TSL are too loose to be worth fighting here.

/** World-space direction -> view space (for normalNode). */
export const toView = (dir: N): N => cameraViewMatrix.mul(vec4(dir, 0)).xyz.normalize();

/**
 * For additive "air" layers (haze, beams, halos). The stage's scene pass
 * writes a packed view normal (for GTAO) and motion vectors into extra render
 * targets with no blending, so a transparent layer replaces whatever surface is
 * behind it there: a beam crossing the canvas stamped its cone normals into the
 * AO input and showed as a hard-edged band of different occlusion. These layers
 * write the floor's normal (straight up) instead, which is what is behind them
 * on every shot where they cover the canvas.
 */
export function airMRT(): N {
  // `output` too: without a pass MRT (Low, the dev page) this becomes the whole output.
  return mrt({ output, normal: toView(vec3(0, 1, 0)).mul(0.5).add(0.5) });
}

// ---------------------------------------------------------------------------
// Contact occlusion
// ---------------------------------------------------------------------------

export const OCCLUDER_COUNT = 40;

/**
 * Sphere occluders (x, y, z, radius) fed from the fighters' world poses each
 * frame. Unused slots have radius 0.
 */
export class ContactOccluders {
  readonly data: THREE.Vector4[] = Array.from({ length: OCCLUDER_COUNT }, () => new THREE.Vector4(0, -100, 0, 0));
  readonly node: N = uniformArray(this.data, 'vec4');
  /** 1 when the pipeline casts no shadows: the blob also darkens direct light. */
  readonly noShadows: N = uniform(0);
  /** Occluders in use, and a bounding circle (x, z, radius) around all of them. */
  readonly count: N = uniform(0);
  readonly bounds: N = uniform(new THREE.Vector3(0, 0, 0));

  /** Call after writing `data[0..n)`: sets the count and the bounding circle. */
  commit(n: number): void {
    this.count.value = n;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const s = this.data[i]!;
      minX = Math.min(minX, s.x - s.w); maxX = Math.max(maxX, s.x + s.w);
      minZ = Math.min(minZ, s.z - s.w); maxZ = Math.max(maxZ, s.z + s.w);
    }
    const b = this.bounds.value as THREE.Vector3;
    if (n === 0) { b.set(0, 0, -1); return; }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    // Each sphere's term is windowed to zero by 1.3 m (aoAt), inside this circle.
    b.set(cx, cz, Math.hypot(maxX - cx, maxZ - cz) + 1.4);
  }

  /** Ambient-occlusion factor (1 = open) at a floor point with an upward normal. */
  aoAt(p: N): N {
    return Fn(() => {
      const occ = float(0).toVar();
      // Early out: pixels away from every body skip the loop entirely.
      If(length(p.xz.sub(this.bounds.xy)).lessThan(this.bounds.z), () => {
        Loop({ start: int(0), end: this.count.toInt(), type: 'int', condition: '<' }, ({ i }: { i: N }) => {
          const s = this.node.element(i);
          const dv = s.xyz.sub(p);
          const d2 = max(dot(dv, dv), 1e-4);
          const cosT = max(dv.y.div(sqrt(d2)), 0);
          // Windowed to zero 1.3 m out horizontally, so the sum ends smoothly
          // inside the bounding circle instead of cutting off at its edge (a
          // visible, straight-looking step across the canvas on wide shots).
          const r2 = s.w.mul(s.w);
          const fall = max(float(1).sub(dv.x.mul(dv.x).add(dv.z.mul(dv.z)).div(1.69)), 0);
          occ.addAssign(cosT.mul(r2).div(d2).mul(fall.mul(fall)));
        });
      });
      return clamp(float(1).sub(occ.mul(1.7)), 0.08, 1);
    })();
  }
}

// ---------------------------------------------------------------------------
// Floor
// ---------------------------------------------------------------------------

export interface FloorOptions {
  map: THREE.Texture;
  /** Base roughness (canvas ~0.8, vinyl mats ~0.55). */
  roughness: number;
  /** Weave period in metres (0 = none). */
  weaveM: number;
  weaveDepth: number;
  /** Broad undulation of the cloth (normal strength). */
  undulation: number;
  occluders: ContactOccluders | null;
  /** Optional tiling normal map (OpenGL convention) replacing the procedural weave. */
  detailNormal?: THREE.Texture;
  /** Metres per tile of `detailNormal`. */
  detailTileM?: number;
  detailStrength?: number;
  /**
   * Optional tiling cavity (AO) map in the same tiling as `detailNormal`: the
   * weave's thread gaps read a little darker and rougher up close; it
   * mip-averages to its mean far away, so it never shimmers.
   */
  detailCavity?: THREE.Texture;
  /**
   * Linear colour of the bare floor. Texels that differ from it are printed
   * ink (logos, lines, the apron), which is smoother than the cloth: a soft
   * sheen on the logos at grazing angles, as on a televised canvas.
   */
  inkBase?: [number, number, number];
  /** Roughness of printed ink (default: 0.62 x `roughness`). */
  inkRoughness?: number;
  /** The bout's sweat and blood marks (marks.ts). */
  marks?: FloorMarks;
}

/**
 * Uniforms and texture of the recorded fight marks (marks.ts): the texture is
 * swapped when the recording arrives; `time` is the playhead's sim time.
 */
export class FloorMarks {
  readonly time: N = uniform(0);
  /** Half-extent (m) of the square the marks texture covers. */
  readonly extent: N = uniform(5);
  /** 0 until a recording has been baked (skips the lookup's effect). */
  readonly on: N = uniform(0);
  readonly node: N;
  constructor(initial: THREE.Texture) {
    // The lookup is built here, once, so swapping `node.value` re-binds it.
    this.node = texture(initial, positionWorld.xz.div(this.extent.mul(2)).add(0.5));
  }
  set(tex: THREE.Texture, extent: number): void {
    this.node.value = tex;
    this.extent.value = extent;
    this.on.value = 1;
  }
}

/**
 * A tiling tangent-space normal map projected on a horizontal floor, returned
 * as a world-space slope (dh/dx, dh/dz). uv = (x, -z) / tile, so the tangent is
 * +x and the bitangent -z. Mipmapping averages the normal out with distance, so
 * the weave never shimmers.
 */
export function floorDetailSlope(tex: THREE.Texture, tileM: number, strength: number): N {
  const P = positionWorld;
  const n = texture(tex, vec2(P.x, P.z.negate()).div(tileM)).xyz.mul(2).sub(1);
  // World normal (n.x, n.z, -n.y); slope = -N.xz / N.y.
  const ny = max(n.z, 0.2);
  return vec2(n.x.negate().div(ny), n.y.div(ny)).mul(strength);
}

export function floorMaterial(o: FloorOptions): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  const P = positionWorld;
  const ao = o.occluders ? o.occluders.aoAt(P) : float(1);

  // Weave: two orthogonal thread families; height field h = sin(x) * sin(z) warp/weft.
  const weave = Fn(() => {
    if (o.weaveM <= 0) return vec2(0, 0);
    const k = (2 * Math.PI) / o.weaveM;
    const fw = max(fwidth(P.x), fwidth(P.z));
    const fade = float(1).sub(smoothstep(o.weaveM * 0.25, o.weaveM * 0.9, fw));
    const x = P.x.mul(k);
    const z = P.z.mul(k);
    // Over/under weave: thread direction flips each cell.
    const dhdx = sin(x).mul(sin(z.mul(0.5))).mul(o.weaveDepth);
    const dhdz = sin(z).mul(sin(x.mul(0.5))).mul(o.weaveDepth);
    return vec2(dhdx, dhdz).mul(fade);
  })();
  // Broad cloth undulation from a small tileable gradient texture (one fetch).
  const g = texture(slopeTexture(), vec2(P.x, P.z).mul(0.37)).xy.sub(0.5).mul(2);
  const g2 = texture(slopeTexture(), vec2(P.z, P.x.negate()).mul(0.23).add(0.31)).xy.sub(0.5).mul(2);
  const broad = g.add(g2.mul(0.6)).mul(o.undulation * 10);
  const slope = (o.detailNormal
    ? floorDetailSlope(o.detailNormal, o.detailTileM ?? 0.4, o.detailStrength ?? 0.5)
    : weave).add(broad);
  m.normalNode = toView(vec3(slope.x.negate(), 1, slope.y.negate()));

  const tex = texture(o.map);
  // The key's shadow comes from the shadow map; the four truss-corner fills and
  // the canvas bounce are unshadowed, so the contact term also darkens the
  // albedo (a stand-in for their occlusion). Without shadow maps it carries the
  // whole contact shadow.
  const direct = o.occluders ? mix(ao.pow(0.8), ao.mul(ao), o.occluders.noShadows) : float(1);
  let albedo: N = tex.rgb;
  let rough: N = float(o.roughness);
  if (o.inkBase) {
    // Printed ink vs bare cloth, from the painted colour itself (no extra map).
    const d = tex.rgb.sub(vec3(...o.inkBase));
    const ink = smoothstep(0.25, 0.5, sqrt(dot(d, d)));
    rough = mix(rough, float(o.inkRoughness ?? o.roughness * 0.62), ink);
  } else {
    // Worn areas (darker in the texture) read slightly smoother, as polished canvas does.
    const lum = dot(tex.rgb, vec3(0.3, 0.59, 0.11));
    rough = rough.add(lum.sub(0.6).mul(0.08));
  }
  if (o.detailCavity) {
    // Thread gaps: darker and rougher; the map's mean (~0.77) is neutral.
    const cav = texture(o.detailCavity, vec2(P.x, P.z.negate()).div(o.detailTileM ?? 0.4)).r.sub(0.77);
    albedo = albedo.mul(cav.mul(0.45).add(1));
    rough = rough.sub(cav.mul(0.25));
  }
  if (o.marks) {
    const mk = o.marks;
    const mt = mk.node;
    const age = (a: N, t: N, fade: number) => a.mul(clamp(mk.time.sub(t).div(fade), 0, 1)).mul(mk.on);
    const sweat = age(mt.r, mt.g, 5);
    const blood = age(mt.b, mt.a, 1.2);
    // Damp cloth: a little darker and greyer, and smoother (it catches the key).
    albedo = albedo.mul(float(1).sub(sweat.mul(0.2)));
    rough = rough.sub(sweat.mul(0.15));
    // Blood: dark red that browns as it dries; fresh blood is glossy.
    const dry = clamp(mk.time.sub(mt.a).div(240), 0, 1);
    const bloodCol = mix(vec3(0.3, 0.012, 0.01), vec3(0.14, 0.03, 0.018), dry);
    albedo = mix(albedo, bloodCol, blood.mul(0.92));
    rough = mix(rough, mix(float(0.3), float(0.6), dry), blood);
  }
  m.colorNode = albedo.mul(direct);
  m.roughnessNode = clamp(rough, 0.25, 1);
  m.metalnessNode = float(0);
  m.aoNode = ao;
  return m;
}

let _slope: THREE.DataTexture | null = null;

/**
 * 128^2 tileable gradient field (RG = d/dx, d/dz of a sum of integer-frequency
 * waves, remapped to 0..1). Replaces three Perlin evaluations per canvas pixel.
 */
export function slopeTexture(): THREE.DataTexture {
  if (_slope) return _slope;
  const S = 128;
  const data = new Uint8Array(S * S * 4);
  const waves: [number, number, number, number][] = [];
  let seed = 1234567;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < 14; i++) {
    const fx = Math.round((rnd() * 2 - 1) * 6);
    const fz = Math.round((rnd() * 2 - 1) * 6);
    if (fx === 0 && fz === 0) continue;
    waves.push([fx, fz, rnd() * Math.PI * 2, 1 / Math.hypot(fx, fz)]);
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let gx = 0;
      let gz = 0;
      for (const [fx, fz, ph, a] of waves) {
        const t = ((fx * x + fz * y) / S) * Math.PI * 2 + ph;
        const c = Math.cos(t) * a;
        gx += c * fx;
        gz += c * fz;
      }
      const k = (y * S + x) * 4;
      data[k] = Math.max(0, Math.min(255, Math.round(128 + gx * 9)));
      data[k + 1] = Math.max(0, Math.min(255, Math.round(128 + gz * 9)));
      data[k + 2] = 128;
      data[k + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  _slope = t;
  return t;
}

// ---------------------------------------------------------------------------
// Chain-link fence
// ---------------------------------------------------------------------------

export interface ChainLinkOptions {
  /** Distance between parallel wires, metres. */
  pitch: number;
  /** Wire radius including the vinyl coat, metres. */
  wireR: number;
  colour: THREE.ColorRepresentation;
  roughness: number;
  /**
   * Near-lens defocus (FenceLens): the wires a few tens of centimetres from a
   * handheld are far out of focus, so their box filter is widened by the blur
   * disc the lens would give them. Omitted = always sharp.
   */
  lens?: FenceLens;
}

/**
 * The fence cannot write depth (a depth-writing near fence made GTAO's
 * screen-space radius explode: +12 ms on CAGESIDE, measured), so the stage's
 * lens depth of field never sees it. The material blurs itself instead: a
 * thin lens focused at `focus` metres with an aperture radius `aperture`
 * spreads a point at distance z over a disc of radius aperture * |1 - z/focus|
 * in that point's own plane, which is simply a wider footprint for the exact
 * box-filtered coverage. Only nearer than focus (the far fence is the lens
 * DoF's background blur).
 */
export class FenceLens {
  /** Focus distance (m); the handhelds focus on the fighters, 3-5 m away. */
  readonly focus: N = uniform(3.5);
  /** Aperture radius (m) of a broadcast zoom opened up indoors. */
  readonly aperture: N = uniform(0.009);
}

/**
 * Box-filtered coverage of a 1-D periodic line pattern (lines of half-width w,
 * centred on multiples of d) over [s - fw/2, s + fw/2]: the exact integral,
 * divided by the footprint. Anti-aliased at every scale by construction.
 */
const lineIntegral = (x: N, d: number, w: number): N => {
  const cell = floor(x.div(d));
  const y = fract(x.div(d)).mul(d);
  return cell.mul(2 * w).add(min(y, w)).add(max(float(0), y.sub(d - w)));
};
const lineCoverage = (s: N, fw: N, d: number, w: number): N =>
  clamp(lineIntegral(s.add(fw.mul(0.5)), d, w).sub(lineIntegral(s.sub(fw.mul(0.5)), d, w)).div(fw), 0, 1);

/**
 * Chain-link material for panels whose uv is (metres along the panel, metres up)
 * and whose `alongDir` attribute holds the world direction of +u.
 */
export function chainLinkMaterial(o: ChainLinkOptions): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.transparent = true;
  m.depthWrite = false;
  m.side = THREE.DoubleSide;
  const d = o.pitch;
  const w = o.wireR;
  const inv = Math.SQRT1_2;
  const U = uv();
  const s1 = U.x.add(U.y).mul(inv);
  const s2 = U.x.sub(U.y).mul(inv);
  // Footprint along each family's normal; a touch wider than one pixel.
  let blur: N = float(0);
  if (o.lens) {
    const z = length(positionWorld.sub(cameraPosition));
    blur = o.lens.aperture.mul(max(float(1).sub(z.div(o.lens.focus)), 0)).mul(2);
  }
  const fw1 = max(fwidth(s1).mul(1.25), 1e-5).add(blur);
  const fw2 = max(fwidth(s2).mul(1.25), 1e-5).add(blur);
  const c1 = lineCoverage(s1, fw1, d, w);
  const c2 = lineCoverage(s2, fw2, d, w);
  const cov = float(1).sub(float(1).sub(c1).mul(float(1).sub(c2)));

  // Knuckles (where the wires twist over each other) are slightly thicker and catch more light.
  const opacity = clamp(cov.mul(1.08), 0, 1);
  m.opacityNode = opacity;
  // The veil must not replace the AO input of what is behind it (see airMRT):
  // a view-facing normal is what a body or the far canvas seen through a near
  // fence mostly is, and it is the fence's own normal on the handheld shots.
  m.mrtNode = mrt({ output, normal: vec3(0.5, 0.5, 1) });
  // alphaTest discards before lighting: the empty holes of a near fence
  // (most of its pixels) cost almost nothing.
  m.alphaTest = 0.004;

  // Bent normals across each wire while it is resolved.
  const o1 = clamp(s1.sub(round(s1.div(d)).mul(d)).div(w), -1, 1);
  const o2 = clamp(s2.sub(round(s2.div(d)).mul(d)).div(w), -1, 1);
  const pick1 = abs(o1).lessThan(abs(o2));
  const off = select(pick1, o1, o2);
  const along = attribute('alongDir', 'vec3');
  const up = vec3(0, 1, 0);
  const e = select(pick1, along.add(up), along.sub(up)).normalize();
  const resolved = float(1).sub(smoothstep(0.6, 1.4, min(fw1, fw2).div(w)));
  const bend = off.mul(resolved);
  const eV = toView(e);
  const nV = normalView;
  const bent = nV.mul(sqrt(max(float(1).sub(bend.mul(bend)), 0))).add(eV.mul(bend));
  m.normalNode = bent.normalize();

  m.colorNode = vec3(new THREE.Color(o.colour).r, new THREE.Color(o.colour).g, new THREE.Color(o.colour).b);
  m.roughnessNode = float(o.roughness);
  m.metalnessNode = float(0);
  return m;
}

// ---------------------------------------------------------------------------
// Simple lit and emissive materials
// ---------------------------------------------------------------------------

/** Vertex-coloured PBR material for merged props. `tag` > 0.5 marks emissive parts. */
export function propMaterial(roughness = 0.6, metalness = 0, emissiveTagGain = 0): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial();
  m.vertexColors = true;
  const col = attribute('color', 'vec3');
  const tag = attribute('tag', 'float');
  m.colorNode = col;
  m.roughnessNode = float(roughness);
  m.metalnessNode = float(metalness);
  if (emissiveTagGain > 0) m.emissiveNode = col.mul(smoothstep(0.5, 0.6, tag)).mul(emissiveTagGain);
  return m;
}

/** Padded vinyl: black-ish, satin, with a soft sheen toward grazing angles. */
export function vinylMaterial(colour: THREE.ColorRepresentation, roughness = 0.42): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  m.color = new THREE.Color(colour);
  m.roughness = roughness;
  m.metalness = 0;
  m.clearcoat = 0.25;
  m.clearcoatRoughness = 0.35;
  return m;
}

/** Unlit emissive colour (fixture lenses, LEDs, lamp heads). */
export function glowMaterial(colour: THREE.ColorRepresentation, intensity: number): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  const c = new THREE.Color(colour).multiplyScalar(intensity);
  m.colorNode = vec3(c.r, c.g, c.b);
  return m;
}

/**
 * Emissive texture (LED boards) at a given brightness, with an optional
 * animated scroll. With `pages` the texture holds two pages stacked
 * vertically (ledBoardTexture) and the board wipes from one to the other every
 * `period` seconds of sim time: the same picture live and in a replay.
 */
export function ledMaterial(
  map: THREE.Texture, intensity: number, scroll: N | null = null, pages: { time: N; period?: number } | null = null,
): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  let U: N = scroll ? uv().add(vec2(scroll, 0)) : uv();
  if (pages) {
    const period = pages.period ?? 14;
    const k = pages.time.div(period);
    const cycle = floor(k);
    const into = fract(k).mul(period);
    // A 0.6 s wipe along the board at the start of each period.
    const wipe = clamp(into.div(0.6), 0, 1);
    const shown = fract(U.x).lessThan(wipe);
    const cur = cycle.mod(2);
    const prev = float(1).sub(cur);
    const page = select(shown, cur, prev);
    // Page 0 is the top half of the canvas (v in [0.5, 1]), page 1 the bottom.
    U = vec2(U.x, clamp(U.y, 0.01, 0.99).mul(0.5).add(float(0.5).sub(page.mul(0.5))));
  }
  m.colorNode = texture(map, U).rgb.mul(intensity);
  return m;
}

export { mix };
