/**
 * SKIN MAPS — the anatomy and region layers of `anatomy.ts` baked into the body's UV layout.
 *
 * Baked OFFLINE by `scripts/assets/build-skin-maps.ts` (deterministic; ~10 s at 2048², far too
 * slow for a loading screen) into `static/assets/body/skinmaps.{json,bin}`; the bin is zlib-
 * compressed raw texels, inflated in the browser with `DecompressionStream`, so the bytes reach
 * the GPU exactly (no image decoding, premultiplied alpha or per-backend flips).
 *
 * The bake rasterises every body triangle into UV space; each covered texel interpolates its
 * canonical position and normal and evaluates `skinSample` there, so separations a few
 * millimetres wide are resolved between the mesh's ~1.5 cm vertices. Heights become tangent-space
 * normals using each triangle's dP/du, dP/dv (metres per texel) — the frame three's
 * derivative-based `normalMap` reconstructs. Unwritten texels are dilated from their neighbours
 * so mip-maps and bilinear filtering do not pull flat texels across UV seams.
 *
 *   skinA  RGBA8  half size  RG = muscle/vein relief normal XY (scaled by definition in the shader)
 *                            B = cavity (0.5 flat, lower in grooves), A = pore strength
 *   skinB  RGBA8  half size  R = subdermal redness, G = vein tint, B = sebum (oil), A = lash line
 *   skinC  RG8    full size  crease relief normal XY (knuckles, elbows, knees, wrists, neck, eyes)
 *
 * Rows run bottom-up (row 0 = v 0), the DataTexture convention used by masks.ts.
 */
import type { BodyAsset } from './asset';
import type { Canonical } from './canonical';
import { skinSample, type SkinSample, type V3 } from './anatomy';

export interface SkinMapData {
  /** Full bake size (skinC); skinA/skinB are half this. */
  size: number;
  a: Uint8Array;
  b: Uint8Array;
  c: Uint8Array;
  /** Mean metres per full-size texel over the covered body. */
  metresPerTexel: number;
  coverage: number;
}

const enc = (v: number): number => Math.max(0, Math.min(255, Math.round((v * 0.5 + 0.5) * 255)));
const u8 = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));

export function bakeSkinMaps(asset: BodyAsset, can: Canonical, size = 2048): SkinMapData {
  const S = size, N = S * S;
  const H = new Float32Array(N), C = new Float32Array(N);
  const MU = new Float32Array(N), MV = new Float32Array(N);
  const RED = new Float32Array(N), VEIN = new Float32Array(N), OIL = new Float32Array(N), LASH = new Float32Array(N), PORE = new Float32Array(N);
  const cov = new Uint8Array(N);
  const uv = asset.uv, map = asset.renderSrc, idx = asset.lodIndex[0];
  const P = can.pos, Nn = can.normal;
  const sample: SkinSample = { h: 0, crease: 0, pore: 0, red: 0, vein: 0, oil: 0, lash: 0 };
  const p: [number, number, number] = [0, 0, 0];
  const n: [number, number, number] = [0, 0, 0];
  let mptSum = 0, mptN = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const r0 = idx[t], r1 = idx[t + 1], r2 = idx[t + 2];
    const s0 = map[r0], s1 = map[r1], s2 = map[r2];
    const u0 = uv[r0 * 2] * S - 0.5, v0 = uv[r0 * 2 + 1] * S - 0.5;
    const u1 = uv[r1 * 2] * S - 0.5, v1 = uv[r1 * 2 + 1] * S - 0.5;
    const u2 = uv[r2 * 2] * S - 0.5, v2 = uv[r2 * 2 + 1] * S - 0.5;
    const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
    if (Math.abs(det) < 1e-9) continue;
    const inv = 1 / det;
    const du1 = u1 - u0, dv1 = v1 - v0, du2 = u2 - u0, dv2 = v2 - v0;
    // Metres per texel along u and v (|dP/du|, |dP/dv|).
    let mu2 = 0, mv2 = 0;
    for (let k = 0; k < 3; k++) {
      const e1 = P[s1 * 3 + k] - P[s0 * 3 + k], e2 = P[s2 * 3 + k] - P[s0 * 3 + k];
      const a = (e1 * dv2 - e2 * dv1) * inv, b = (e2 * du1 - e1 * du2) * inv;
      mu2 += a * a; mv2 += b * b;
    }
    const mu = Math.sqrt(mu2), mv = Math.sqrt(mv2);
    const x0 = Math.max(0, Math.floor(Math.min(u0, u1, u2))), x1 = Math.min(S - 1, Math.ceil(Math.max(u0, u1, u2)));
    const y0 = Math.max(0, Math.floor(Math.min(v0, v1, v2))), y1 = Math.min(S - 1, Math.ceil(Math.max(v0, v1, v2)));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const w1 = ((x - u0) * dv2 - du2 * (y - v0)) * inv;
        const w2 = (du1 * (y - v0) - (x - u0) * dv1) * inv;
        const w0 = 1 - w1 - w2;
        // A small tolerance so texels on shared edges are always covered.
        if (w0 < -0.02 || w1 < -0.02 || w2 < -0.02) continue;
        const i = y * S + x;
        if (cov[i] === 2) continue; // an interior hit already wrote this texel
        for (let k = 0; k < 3; k++) {
          p[k] = w0 * P[s0 * 3 + k] + w1 * P[s1 * 3 + k] + w2 * P[s2 * 3 + k];
          n[k] = w0 * Nn[s0 * 3 + k] + w1 * Nn[s1 * 3 + k] + w2 * Nn[s2 * 3 + k];
        }
        const nl = Math.hypot(n[0], n[1], n[2]) || 1;
        n[0] /= nl; n[1] /= nl; n[2] /= nl;
        skinSample(p as V3, n as V3, sample);
        H[i] = sample.h; C[i] = sample.crease;
        RED[i] = sample.red; VEIN[i] = sample.vein; OIL[i] = sample.oil; LASH[i] = sample.lash; PORE[i] = sample.pore;
        MU[i] = mu; MV[i] = mv;
        if (!cov[i]) { mptSum += (mu + mv) / 2; mptN++; }
        cov[i] = w0 >= 0 && w1 >= 0 && w2 >= 0 ? 2 : 1;
      }
    }
  }

  // Slopes (tangent-space normal XY) from heights, never across unwritten texels (seams).
  const has = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < S && y < S && cov[y * S + x] > 0;
  const slope = (F: Float32Array, i: number, x: number, y: number, out: number[]): void => {
    const l = has(x - 1, y), r = has(x + 1, y), d = has(x, y - 1), u = has(x, y + 1);
    const dx = l && r ? (F[i + 1] - F[i - 1]) / 2 : r ? F[i + 1] - F[i] : l ? F[i] - F[i - 1] : 0;
    const dy = d && u ? (F[i + S] - F[i - S]) / 2 : u ? F[i + S] - F[i] : d ? F[i] - F[i - S] : 0;
    const sx = -dx / (MU[i] || 1), sy = -dy / (MV[i] || 1);
    const l2 = Math.hypot(sx, sy, 1);
    out[0] = sx / l2; out[1] = sy / l2;
  };
  const c = new Uint8Array(N * 2);
  const HX = new Float32Array(N), HY = new Float32Array(N);
  const tmp = [0, 0];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      if (!cov[i]) continue;
      slope(H, i, x, y, tmp); HX[i] = tmp[0]; HY[i] = tmp[1];
      slope(C, i, x, y, tmp);
      c[i * 2] = enc(tmp[0]); c[i * 2 + 1] = enc(tmp[1]);
    }
  }
  // Half-size A and B: 2×2 box filter over written texels.
  const S2 = S >> 1, N2 = S2 * S2;
  const a = new Uint8Array(N2 * 4), b = new Uint8Array(N2 * 4);
  const cov2 = new Uint8Array(N2);
  for (let y = 0; y < S2; y++) {
    for (let x = 0; x < S2; x++) {
      let k = 0, hx = 0, hy = 0, hh = 0, pr = 0, rd = 0, vn = 0, ol = 0, ls = 0;
      for (let j = 0; j < 2; j++) for (let q = 0; q < 2; q++) {
        const i = (y * 2 + j) * S + x * 2 + q;
        if (!cov[i]) continue;
        k++; hx += HX[i]; hy += HY[i]; hh += H[i] + 1.5 * C[i]; pr += PORE[i];
        rd += RED[i]; vn += VEIN[i]; ol += OIL[i]; ls = Math.max(ls, LASH[i]);
      }
      if (!k) continue;
      const o = (y * S2 + x) * 4;
      cov2[y * S2 + x] = 1;
      a[o] = enc(hx / k); a[o + 1] = enc(hy / k);
      // Cavity: 0.5 on flat skin, ~0.1 at the bottom of a 2 mm groove, a little above on ridges.
      a[o + 2] = u8(0.5 + Math.max(-0.4, Math.min(0.25, (hh / k) * 200)));
      a[o + 3] = u8(pr / k);
      b[o] = u8(rd / k); b[o + 1] = u8(vn / k); b[o + 2] = u8(ol / k); b[o + 3] = u8(ls);
    }
  }
  dilate(a, cov2, S2, 4, 10, [128, 128, 128, 115]);
  dilate(b, cov2, S2, 4, 10, [0, 0, 0, 0]);
  dilate(c, cov, S, 2, 16, [128, 128]);
  let covered = 0;
  for (let i = 0; i < N; i++) if (cov[i]) covered++;
  return { size: S, a, b, c, metresPerTexel: mptN ? mptSum / mptN : 0, coverage: covered / N };
}

/** Grow written texels into unwritten ones (`passes` rings); anything left gets `fill`. */
function dilate(data: Uint8Array, cov: Uint8Array, S: number, ch: number, passes: number, fill: number[]): void {
  let c = cov.slice();
  const acc = new Array(ch).fill(0);
  for (let pass = 0; pass < passes; pass++) {
    const next = c.slice();
    let grew = false;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        if (c[i]) continue;
        let k = 0;
        acc.fill(0);
        if (x > 0 && c[i - 1]) { k++; for (let q = 0; q < ch; q++) acc[q] += data[(i - 1) * ch + q]; }
        if (x < S - 1 && c[i + 1]) { k++; for (let q = 0; q < ch; q++) acc[q] += data[(i + 1) * ch + q]; }
        if (y > 0 && c[i - S]) { k++; for (let q = 0; q < ch; q++) acc[q] += data[(i - S) * ch + q]; }
        if (y < S - 1 && c[i + S]) { k++; for (let q = 0; q < ch; q++) acc[q] += data[(i + S) * ch + q]; }
        if (!k) continue;
        for (let q = 0; q < ch; q++) data[i * ch + q] = Math.round(acc[q] / k);
        next[i] = 1;
        grew = true;
      }
    }
    c = next;
    if (!grew) break;
  }
  for (let i = 0; i < c.length; i++) if (!c[i]) for (let q = 0; q < ch; q++) data[i * ch + q] = fill[q];
}

// ---------------------------------------------------------------------------
// Serialisation (build script) and loading (browser)
// ---------------------------------------------------------------------------

export interface SkinMapHeader {
  format: 'boutlab-skinmaps/1';
  size: number;
  /** Byte ranges in the INFLATED payload. */
  parts: { name: 'a' | 'b' | 'c'; size: number; channels: number; offset: number; length: number }[];
  rawBytes: number;
  /** SHA-256 of the inflated payload. */
  rawSha256: string;
  binSha256: string;
  metresPerTexel: number;
  coverage: number;
}

/** The raw payload (a, b, c concatenated) and its part table. */
export function packSkinMaps(d: SkinMapData): { raw: Uint8Array; parts: SkinMapHeader['parts'] } {
  const S2 = d.size >> 1;
  const parts: SkinMapHeader['parts'] = [
    { name: 'a', size: S2, channels: 4, offset: 0, length: d.a.length },
    { name: 'b', size: S2, channels: 4, offset: d.a.length, length: d.b.length },
    { name: 'c', size: d.size, channels: 2, offset: d.a.length + d.b.length, length: d.c.length },
  ];
  const raw = new Uint8Array(d.a.length + d.b.length + d.c.length);
  raw.set(d.a, 0); raw.set(d.b, d.a.length); raw.set(d.c, d.a.length + d.b.length);
  return { raw, parts };
}

export interface SkinMapTextures {
  skinA: import('three/webgpu').Texture;
  skinB: import('three/webgpu').Texture;
  skinC: import('three/webgpu').Texture;
}

/** Fetch, inflate and upload the baked skin maps (browser). */
export async function loadSkinMaps(base = '/assets/body/'): Promise<SkinMapTextures> {
  const THREE = await import('three/webgpu');
  const [hRes, bRes] = await Promise.all([fetch(`${base}skinmaps.json`), fetch(`${base}skinmaps.bin`)]);
  if (!hRes.ok || !bRes.ok || !bRes.body) throw new Error(`skin maps missing at ${base} (run scripts/assets/build-skin-maps.ts)`);
  const header = (await hRes.json()) as SkinMapHeader;
  const raw = new Uint8Array(await new Response(bRes.body.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  if (raw.length !== header.rawBytes) throw new Error('skinmaps.bin does not match skinmaps.json');
  const make = (name: 'a' | 'b' | 'c'): InstanceType<typeof THREE.DataTexture> => {
    const p = header.parts.find((x) => x.name === name)!;
    const data = raw.subarray(p.offset, p.offset + p.length);
    const tex = new THREE.DataTexture(data, p.size, p.size, p.channels === 2 ? THREE.RGFormat : THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    // Relief (a) is seen at grazing angles on the body; the region map (b) is low-frequency.
    tex.anisotropy = name === 'a' ? 4 : name === 'c' ? 2 : 1;
    tex.needsUpdate = true;
    return tex;
  };
  return { skinA: make('a'), skinB: make('b'), skinC: make('c') };
}
