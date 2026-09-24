/**
 * HAIR — short styles only (docs/design/08 §3.4): the scalp colour is painted on the skin
 * (skinMaterial), and styles with volume add alpha-tested shells lifted off the scalp — the
 * fur-shell technique. Each shell keeps fewer strands than the one below and is darker lower
 * down, which reads as short hair with depth and self-shadowing at broadcast distances.
 *
 *   bald      none                              buzz      one sparse fuzz shell (2.5 mm) over a painted scalp
 *   fade      shells on top, tapering to bare    crew      4 shells, 10 mm top / 4 mm sides
 *             skin at the ear line
 *   curly     6 shells, 20 mm, coils            cornrows  4 shells in raised braided rows
 *   braids    4 shells, thicker braided rows    receding  crew with a raised hairline
 *
 * Cornrows and braids run straight back: rows follow meridians of the head (constant angle about
 * the front-back axis), so they stay rows on the top, the sides and down to the nape. Each row is
 * a rounded ridge (outer shells keep only its crest) made of plaits that alternate in a chevron,
 * with a line of bare scalp between rows; the skin shader paints the same partings (ROW_FREQ).
 *
 * Facial hair with volume: full beards, goatees and moustaches add two short shells over the same
 * regions the skin shader paints, so a beard has a soft, broken silhouette and depth, not paint.
 */
import * as THREE from 'three/webgpu';
import {
  abs, atan, attribute, float, fract, mix, mx_noise_float, mx_worley_noise_float, smoothstep, vec3, vec4, sin, max, min,
  cos, fwidth,
} from 'three/tsl';
import type { BodyAsset } from './asset';
import type { BuiltBody } from './body';
import type { Canonical } from './canonical';
import type { Rig } from './rigging';
import type { ResolvedHair } from './appearance';
import { emptyMesh, toSkinnedGeometry } from './geom';
import { objectUniform } from './skinMaterial';

/* eslint-disable @typescript-eslint/no-explicit-any */
type N = any;

export interface HairParts {
  meshes: THREE.SkinnedMesh[];
  setLOD(l: number): void;
  dispose(): void;
}

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Row frequency for cornrows and braids: rows are |sin(φ·f)| bands in φ, the angle about the head's
 * front-back axis (so one row per π/f radians ≈ 2.6 cm / 3.4 cm of scalp).
 */
export const ROW_FREQ = { cornrows: 10.5, braids: 8 } as const;

interface Style { shells: number; top: number; side: number; recede: number; fadeSides: boolean }

const STYLES: Record<string, Style> = {
  bald: { shells: 0, top: 0, side: 0, recede: 0, fadeSides: false },
  buzz: { shells: 1, top: 0.0025, side: 0.002, recede: 0, fadeSides: false },
  fade: { shells: 4, top: 0.011, side: 0.0, recede: 0, fadeSides: true },
  crew: { shells: 4, top: 0.010, side: 0.004, recede: 0, fadeSides: false },
  curly: { shells: 6, top: 0.02, side: 0.01, recede: 0, fadeSides: false },
  cornrows: { shells: 4, top: 0.0065, side: 0.006, recede: 0, fadeSides: false },
  braids: { shells: 4, top: 0.009, side: 0.008, recede: 0, fadeSides: false },
  receding: { shells: 3, top: 0.009, side: 0.005, recede: 1.8, fadeSides: false },
};

const EYE_R = 0.0118;

/** Scalp coverage 0..1 at a canonical position (the same hairline as the skin shader), and depth. */
function scalpMask(can: Canonical, p: ArrayLike<number>, recede: number): { m: number; depth: number } {
  const lm = can.lm;
  const eyeY = (lm.eyeL[1] + lm.eyeR[1]) / 2;
  const qx = p[0] - lm.headCentre[0], qz = p[2] - lm.headCentre[2];
  const th = Math.abs(Math.atan2(qx, qz));
  const ey = (p[1] - eyeY) / EYE_R;
  const hlFront = 4.7 + recede, hlTemple = 4.0 + recede * 1.6;
  let hl: number;
  // Angles from the head centre: temple ≈ 0.9, sideburn ≈ 1.65, ear ≈ 1.95, nape = π.
  if (th < 0.7) hl = hlFront + (hlTemple - hlFront) * (th / 0.7);
  else if (th < 1.35) hl = hlTemple - 1.0 * smooth(0.7, 1.35, th);
  else if (th < 1.75) hl = hlTemple - 1.0 + (-1.0 - (hlTemple - 1.0)) * smooth(1.35, 1.6, th);
  else if (th < 2.25) hl = -1.0 + 2.4 * smooth(1.72, 1.85, th);
  else hl = 1.4 + (-5.5 - 1.4) * smooth(2.25, 2.9, th);
  const headW = smooth(lm.neckY - 0.02, lm.neckY + 0.04, p[1]);
  // Keep clear of the ears.
  const dl = Math.hypot(p[0] - lm.earL[0], p[1] - lm.earL[1], p[2] - lm.earL[2]);
  const dr = Math.hypot(p[0] - lm.earR[0], p[1] - lm.earR[1], p[2] - lm.earR[2]);
  const ear = smooth(0.022, 0.034, Math.min(dl, dr));
  return { m: smooth(-0.25, 0.35, ey - hl) * headW * ear, depth: ey - hl };
}

/** CPU mirror of the skin shader's facial-hair regions: [full beard, goatee, moustache]. */
function facialRegions(can: Canonical, p: ArrayLike<number>): [number, number, number] {
  const lm = can.lm;
  const eyeMidX = (lm.eyeL[0] + lm.eyeR[0]) / 2, eyeMidY = (lm.eyeL[1] + lm.eyeR[1]) / 2;
  const ey = (p[1] - eyeMidY) / EYE_R;
  const ax = Math.abs(p[0] - eyeMidX) / EYE_R;
  const th = Math.abs(Math.atan2(p[0] - lm.headCentre[0], p[2] - lm.headCentre[2]));
  const lipsY = (lm.lips[1] - eyeMidY) / EYE_R, noseY = (lm.noseTip[1] - eyeMidY) / EYE_R, chinY = (lm.chin[1] - eyeMidY) / EYE_R;
  const front = smooth(1.45, 1.2, th);
  const headW = smooth(lm.neckY - 0.02, lm.neckY + 0.04, p[1]);
  // Irregular edge (a cheap hash wobble, matching the shader's noisy edge in spirit).
  const wob = 0.35 * Math.sin(p[0] * 610 + p[1] * 370) + 0.25 * Math.sin(p[1] * 980 - p[2] * 530);
  const cheekLine = -4.6 + 3.0 * smooth(1.6, 6.8, ax) + wob;
  const neckLine = chinY - 1.6 + ax * 0.3;
  const beard = smooth(0.9, -0.9, ey - cheekLine) * smooth(-0.4, 0.4, ey - neckLine) * front
    * Math.max(headW, smooth(lm.neckY - 0.06, lm.neckY - 0.02, p[1]));
  const mous = smooth(2.1, 1.6, ax) * smooth(lipsY + 0.2, lipsY + 0.6, ey) * smooth(noseY - 0.5, noseY - 1.0, ey);
  const goat = Math.max(smooth(1.9, 1.4, ax) * smooth(chinY - 1.8, chinY - 1.0, ey) * smooth(lipsY - 0.3, lipsY - 0.7, ey), mous);
  return [beard, goat, mous];
}

interface HairResources {
  asset: BodyAsset;
  can: Canonical;
  material<M extends THREE.Material>(key: string, make: () => M): M;
}

/** Build shells over the body vertices where `thickness(s)` > 0. */
function shells(
  res: HairResources, body: BuiltBody, rig: Rig, count: number,
  thickness: (s: number) => number, mask: (s: number) => number,
): THREE.BufferGeometry[] {
  const { asset, can } = res;
  const nBody = asset.header.counts.body;
  const T = new Float32Array(nBody), Mk = new Float32Array(nBody);
  for (let s = 0; s < nBody; s++) { Mk[s] = mask(s); T[s] = Mk[s] > 0.02 ? thickness(s) : 0; }
  const tris: number[] = [];
  const idx = asset.lodIndex[0], map = asset.renderSrc;
  for (let t = 0; t < idx.length; t += 3) {
    const a = map[idx[t]], b = map[idx[t + 1]], c = map[idx[t + 2]];
    if (Mk[a] > 0.02 || Mk[b] > 0.02 || Mk[c] > 0.02) tris.push(a, b, c);
  }
  if (!tris.length) return [];
  const used = [...new Set(tris)].sort((x, y) => x - y);
  const local = new Map(used.map((s, i) => [s, i]));
  const out: THREE.BufferGeometry[] = [];
  for (let k = 0; k < count; k++) {
    const f = (k + 1) / count;
    const m = emptyMesh();
    m.extra.aRef = { size: 3, data: [] };
    m.extra.aHair = { size: 2, data: [] };
    for (const s of used) {
      const off = 0.0008 + T[s] * f * body.scale;
      for (let q = 0; q < 3; q++) {
        m.pos.push(body.pos[s * 3 + q] + body.normal[s * 3 + q] * off);
        m.nrm.push(body.normal[s * 3 + q]);
      }
      m.extra.aRef.data.push(can.pos[s * 3], can.pos[s * 3 + 1], can.pos[s * 3 + 2]);
      m.extra.aHair.data.push(f, Mk[s]);
    }
    for (const s of tris) m.index.push(local.get(s)!);
    const si: number[] = [], sw: number[] = [];
    for (const s of used) for (let q = 0; q < 4; q++) { si.push(asset.skinIdx[s * 4 + q]); sw.push(asset.skinW[s * 4 + q] / 255); }
    out.push(toSkinnedGeometry(m, si, sw));
  }
  void rig;
  return out;
}

export function buildHair(res: HairResources, body: BuiltBody, hair: ResolvedHair, rig: Rig, seed: number): HairParts {
  const { can } = res;
  const st = STYLES[hair.style] ?? STYLES.crew;
  const meshes: THREE.SkinnedMesh[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const lm = can.lm;
  const eyeY = (lm.eyeL[1] + lm.eyeR[1]) / 2;
  const topY = lm.crownY;
  const P = (s: number): number[] => [can.pos[s * 3], can.pos[s * 3 + 1], can.pos[s * 3 + 2]];
  const state = { colour: new THREE.Vector3(...hair.colour), off: (seed % 997) / 97 };
  const add = (layers: THREE.BufferGeometry[], key: string, make: () => THREE.Material, name: string): void => {
    const mat = res.material(key, make);
    layers.forEach((g, k) => {
      const mesh = new THREE.SkinnedMesh(g, mat);
      mesh.userData.hair = state;
      mesh.name = `${name}-${k}`;
      mesh.bind(rig.skelA, new THREE.Matrix4());
      mesh.frustumCulled = false;
      mesh.castShadow = k === 0 && name === 'hair';
      mesh.receiveShadow = true;
      mesh.renderOrder = k;
      meshes.push(mesh);
      geos.push(g);
    });
  };

  if (st.shells > 0) {
    const cache = new Map<number, { m: number; depth: number }>();
    const sm = (s: number): { m: number; depth: number } => {
      let v = cache.get(s);
      if (!v) { v = scalpMask(can, P(s), st.recede); cache.set(s, v); }
      return v;
    };
    const fadeT = (s: number): number => {
      const p = P(s);
      // Fade: full on top, tapering over ~4 cm to nothing a little above the ear line.
      return st.fadeSides ? smooth(eyeY + 0.012, eyeY + 0.07, p[1]) : 1;
    };
    const layers = shells(res, body, rig, st.shells,
      (s) => {
        const p = P(s);
        const up = smooth(eyeY, topY - 0.02, p[1]);
        // Sideburns and the hairline in front of the ears are painted only (no shell flaps).
        const th = Math.abs(Math.atan2(p[0] - lm.headCentre[0], p[2] - lm.headCentre[2]));
        const burns = th < 1.7 ? smooth(eyeY + 0.004, eyeY + 0.03, p[1]) : 1;
        // Hair gets longer over the first ~3 cm inside the hairline instead of starting as a ledge.
        const depth = smooth(-0.2, 2.6, sm(s).depth);
        const f = fadeT(s);
        return (st.side + (st.top - st.side) * up) * depth * burns * f * f;
      },
      (s) => sm(s).m * (st.fadeSides ? smooth(0, 0.35, fadeT(s)) : 1));
    add(layers, `hair|${hair.style}`, () => hairMaterial(hair.style, lm), 'hair');
  }

  // Facial hair with volume.
  const facial = hair.facial;
  if (facial === 'full' || facial === 'goatee' || facial === 'moustache') {
    const ch = facial === 'full' ? 0 : facial === 'goatee' ? 1 : 2;
    const len = facial === 'full' ? 0.006 : facial === 'goatee' ? 0.005 : 0.003;
    const reg = new Map<number, number>();
    const R = (s: number): number => {
      let v = reg.get(s);
      if (v === undefined) {
        const r = facialRegions(can, P(s));
        v = facial === 'full' ? Math.max(r[0], r[2]) : r[ch];
        reg.set(s, v);
      }
      return v;
    };
    // Keep the shells off the lips and out of the mouth.
    const lipsY = lm.lips[1];
    const offLips = (s: number): number => {
      const p = P(s);
      const dx = (p[0] - lm.lips[0]) / 0.026, dy = (p[1] - lipsY) / 0.009;
      return smooth(0.8, 1.2, Math.hypot(dx, dy));
    };
    const layers = shells(res, body, rig, 2, (s) => len * smooth(0.1, 0.8, R(s)) * offLips(s), (s) => R(s) * offLips(s));
    add(layers, 'beard', () => beardMaterial(), 'beard');
  }

  return {
    meshes,
    setLOD(l: number) {
      const hairMeshes = meshes.filter((m) => m.name.startsWith('hair'));
      const keep = l === 0 ? hairMeshes.length : l === 1 ? Math.min(2, hairMeshes.length) : l === 2 ? 1 : 0;
      // Keep the outermost shells when thinning, so the silhouette stays.
      hairMeshes.forEach((m, i) => { m.visible = i >= hairMeshes.length - keep; });
      for (const m of meshes) if (m.name.startsWith('beard')) m.visible = l <= 1 || (l === 2 && m.name === 'beard-1');
    },
    dispose() { for (const g of geos) g.dispose(); },
  };
}

/** Shared per style; colour and pattern offset come from `mesh.userData.hair`. */
function hairMaterial(style: string, lm: Canonical['lm']): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const ref: N = attribute('aRef', 'vec3');
  const h: N = attribute('aHair', 'vec2');
  const layer: N = h.x;
  const mask: N = h.y;
  const off: N = objectUniform('hair', (s) => s.off, 0);
  let cover: N;
  let shadeMul: N = float(1);
  const clump: N = mx_noise_float(ref.mul(160).add(off)).mul(0.5).add(0.5);
  if (style === 'curly') {
    const w: N = mx_worley_noise_float(ref.mul(420).add(off));
    const coil: N = sin(w.mul(40)).mul(0.5).add(0.5);
    cover = smoothstep(0.62, 0.2, w).mul(0.7).add(coil.mul(0.35));
    shadeMul = coil.mul(0.3).add(0.8);
  } else if (style === 'cornrows' || style === 'braids') {
    const freq = style === 'cornrows' ? ROW_FREQ.cornrows : ROW_FREQ.braids;
    // φ about the head's front-back axis (rows run front to back), ψ along the row.
    const q: N = ref.sub(vec3(lm.headCentre[0], lm.headCentre[1], lm.headCentre[2]));
    const phi: N = atan(q.x, q.y);
    const psi: N = atan(q.z, q.y);
    const across: N = fract(phi.mul(freq / Math.PI)).sub(0.5).mul(2); // 0 row centre, ±1 parting
    const profile: N = cos(across.mul(Math.PI / 2)); // rounded cross-section
    // Plaits: chevrons along the row (each crossing strand slants in from alternate sides).
    const pitch = style === 'cornrows' ? 0.0075 : 0.01;
    const along: N = psi.mul(0.095 / pitch);
    const chev: N = fract(along.add(abs(across).mul(0.9)));
    const gap: N = smoothstep(0.16, 0.0, min(chev, float(1).sub(chev)));
    cover = profile.mul(float(1).sub(gap.mul(0.25))).add(0.05);
    shadeMul = float(1).sub(gap.mul(0.55)).mul(profile.mul(0.45).add(0.6));
  } else {
    // Straight short hair: fine strands, clumped. Alpha-tested shells need the strand pattern as a
    // dither at every distance (the stage's temporal AA averages it); only the buzz, which has no
    // clumps, settles to its mean when the strands are sub-pixel.
    const aa: N = style === 'buzz' ? smoothstep(0.0016, 0.0005, fwidth(ref.x).add(fwidth(ref.y))) : float(1);
    const strands: N = mix(float(0.5), mx_noise_float(ref.mul(vec3(2600, 900, 2600)).add(off)).mul(0.5).add(0.5), aa);
    // A buzz is even: no clumps (they read as bald patches once the strands average out).
    cover = style === 'buzz' ? strands.mul(0.8).add(0.12) : strands.mul(0.75).add(clump.mul(0.35));
    shadeMul = strands.mul(0.35).add(0.8);
  }
  // Outer shells keep fewer strands; the hairline thins out.
  // (A buzz has a single shell: treat it as a low layer, or nearly every strand is culled.)
  const layerK = style === 'buzz' ? 0.22 : style === 'cornrows' || style === 'braids' ? 0.85 : 0.62;
  const keep: N = cover.sub(layer.mul(layerK)).add(mask.sub(1).mul(0.6));
  m.opacityNode = smoothstep(0.08, 0.14, keep) as N;
  // Alpha-to-coverage (with MSAA) gives soft strand edges instead of a jagged cut-out fringe.
  m.alphaToCoverage = true;
  m.alphaTestNode = float(0.02) as N;
  const col: N = objectUniform('hair', (s) => s.colour, new THREE.Vector3(0.03, 0.02, 0.012));
  const shade: N = mix(float(0.3), float(1.1), layer);
  const tint: N = mx_noise_float(ref.mul(55).add(off)).mul(0.12).add(1).mul(clump.mul(0.2).add(0.9));
  m.colorNode = vec4(col.mul(shade).mul(tint).mul(shadeMul), 1) as N;
  m.roughnessNode = float(0.6) as N;
  m.sheenNode = max(col.mul(1.8), vec3(0.02)) as N;
  m.sheenRoughnessNode = float(0.45) as N;
  m.specularIntensityNode = float(0.25) as N;
  return m;
}

/** Beard shells: short downward strands in clumps; the edge thins out. */
function beardMaterial(): THREE.MeshPhysicalNodeMaterial {
  const m = new THREE.MeshPhysicalNodeMaterial();
  const ref: N = attribute('aRef', 'vec3');
  const h: N = attribute('aHair', 'vec2');
  const layer: N = h.x;
  const mask: N = h.y;
  const off: N = objectUniform('hair', (s) => s.off, 0);
  const strands: N = mx_noise_float(ref.mul(vec3(2400, 480, 2400)).add(off)).mul(0.5).add(0.5);
  const clump: N = mx_noise_float(ref.mul(vec3(300, 180, 300)).add(off)).mul(0.5).add(0.5);
  const cover: N = strands.mul(0.7).add(clump.mul(0.4));
  const keep: N = cover.sub(layer.mul(0.55)).add(mask.sub(1).mul(0.9));
  m.opacityNode = smoothstep(0.1, 0.16, keep) as N;
  m.alphaToCoverage = true;
  m.alphaTestNode = float(0.02) as N;
  const col: N = objectUniform('hair', (s) => s.colour, new THREE.Vector3(0.03, 0.02, 0.012));
  m.colorNode = vec4(col.mul(mix(float(0.45), float(1.1), layer)).mul(strands.mul(0.3).add(0.8)), 1) as N;
  m.roughnessNode = float(0.62) as N;
  m.sheenNode = max(col.mul(1.6), vec3(0.02)) as N;
  m.sheenRoughnessNode = float(0.5) as N;
  m.specularIntensityNode = float(0.35) as N;
  return m;
}
