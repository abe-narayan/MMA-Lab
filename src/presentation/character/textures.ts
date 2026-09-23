/**
 * Procedural detail textures, generated once on the CPU at preload and mip-mapped on the GPU:
 * skin micro-relief (pores, fine crossing wrinkles), sweat beads, cloth weave and leather grain.
 * Mip-mapped textures instead of in-shader noise keep pores from shimmering at broadcast distance.
 *
 * Every texture is tileable and deterministic (fixed seeds, no Math.random).
 * Channels of each normal texture: RG = tangent-space normal XY encoded 0..1, B = height, A = mask.
 */
import * as THREE from 'three/webgpu';

/** Small, fast, seeded PRNG (mulberry32). Cosmetic only — never the sim's RNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string to a 32-bit seed (FNV-1a). */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Tileable value noise on an n×n lattice. */
function valueNoise(size: number, cells: number, rnd: () => number): Float32Array {
  const lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = (x / size) * cells, fy = (y / size) * cells;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const g = (i: number, j: number): number => lat[((j % cells) + cells) % cells * cells + (((i % cells) + cells) % cells)];
    const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * sx;
    const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * sx;
    out[y * size + x] = a + (b - a) * sy;
  }
  return out;
}

/** Tileable Worley F1 distance (in cell units) with jittered points. */
function worley(size: number, cells: number, rnd: () => number): { f1: Float32Array; id: Float32Array } {
  const px = new Float32Array(cells * cells), py = new Float32Array(cells * cells), pid = new Float32Array(cells * cells);
  for (let i = 0; i < px.length; i++) { px[i] = rnd(); py[i] = rnd(); pid[i] = rnd(); }
  const f1 = new Float32Array(size * size), id = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = (x / size) * cells, fy = (y / size) * cells;
    const cx = Math.floor(fx), cy = Math.floor(fy);
    let best = 9, bid = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j;
      const k = (((gy % cells) + cells) % cells) * cells + (((gx % cells) + cells) % cells);
      const dx = gx + px[k] - fx, dy = gy + py[k] - fy;
      const d = dx * dx + dy * dy;
      if (d < best) { best = d; bid = pid[k]; }
    }
    f1[y * size + x] = Math.sqrt(best);
    id[y * size + x] = bid;
  }
  return { f1, id };
}

/** Height field → RGBA8 texture (RG normal, B height, A mask). `strength` scales slopes. */
function heightToTexture(h: Float32Array, size: number, strength: number, mask?: Float32Array): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const at = (x: number, y: number): number => h[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  let lo = Infinity, hi = -Infinity;
  for (const v of h) { if (v < lo) lo = v; if (v > hi) hi = v; }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const n = Math.hypot(dx, dy, 1);
    const o = (y * size + x) * 4;
    data[o] = Math.round((-dx / n * 0.5 + 0.5) * 255);
    data[o + 1] = Math.round((-dy / n * 0.5 + 0.5) * 255);
    data[o + 2] = Math.round(((at(x, y) - lo) / (hi - lo || 1)) * 255);
    data[o + 3] = mask ? Math.round(Math.max(0, Math.min(1, mask[y * size + x])) * 255) : 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Skin micro-relief. Pores are small soft pits on a jittered grid; fine lines are two families
 * of shallow grooves crossing at about 60° (the skin's diamond micro-pattern); a low-frequency
 * undulation keeps highlights from looking stamped. A = pore occlusion (1 = open skin).
 */
export function makeSkinDetail(size = 512): THREE.DataTexture {
  const rnd = mulberry32(0x5eed5c1);
  const pores = worley(size, 44, rnd);
  const pores2 = worley(size, 90, rnd);
  const low = valueNoise(size, 12, rnd);
  const mid = valueNoise(size, 48, rnd);
  const lineN = valueNoise(size, 24, rnd);
  const h = new Float32Array(size * size);
  const mask = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const u = x / size, v = y / size;
    const pr = 0.16 + 0.08 * pores.id[i];
    const pit = Math.max(0, 1 - pores.f1[i] / pr);
    const pit2 = Math.max(0, 1 - pores2.f1[i] / 0.22) * 0.35;
    // Crossing grooves: |sin| ridges along two directions, broken up by noise.
    const a1 = (u * 0.87 + v * 0.5) * 60 + lineN[i] * 3;
    const a2 = (u * 0.87 - v * 0.5) * 60 - lineN[i] * 3;
    const g1 = Math.pow(1 - Math.abs(Math.sin(a1 * Math.PI)), 6);
    const g2 = Math.pow(1 - Math.abs(Math.sin(a2 * Math.PI)), 6);
    const grooves = (g1 + g2) * (0.35 + 0.65 * mid[i]);
    h[i] = -0.9 * pit * pit - pit2 * pit2 - 0.18 * grooves + 0.35 * low[i] + 0.12 * mid[i];
    mask[i] = 1 - 0.55 * pit - 0.15 * grooves;
  }
  return heightToTexture(h, size, 2.2, mask);
}

/**
 * Sweat: scattered hemispherical beads of varied size plus a few elongated runs. A = wet mask
 * (1 on a bead or run). Tileable.
 */
export function makeSweatDetail(size = 256): THREE.DataTexture {
  const rnd = mulberry32(0x5a7e47);
  const h = new Float32Array(size * size);
  const mask = new Float32Array(size * size);
  const stamp = (cx: number, cy: number, r: number, elong: number): void => {
    const ry = r * elong;
    for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
      const q = (dx * dx) / (r * r) + (dy * dy) / (ry * ry);
      if (q >= 1) continue;
      const x = (((Math.round(cx) + dx) % size) + size) % size;
      const y = (((Math.round(cy) + dy) % size) + size) % size;
      const z = Math.sqrt(1 - q) * r;
      const i = y * size + x;
      if (z > h[i]) h[i] = z;
      mask[i] = 1;
    }
  };
  for (let k = 0; k < 170; k++) {
    const r = 1.2 + Math.pow(rnd(), 2.5) * 5.5;
    stamp(rnd() * size, rnd() * size, r, 1 + rnd() * 0.3);
  }
  for (let k = 0; k < 14; k++) stamp(rnd() * size, rnd() * size, 1.5 + rnd() * 1.5, 4 + rnd() * 6);
  return heightToTexture(h, size, 0.55, mask);
}

/** Cloth: a fine 2/2 twill weave with a ripstop grid. For shorts, spats and hand wraps. */
export function makeClothDetail(size = 256): THREE.DataTexture {
  const rnd = mulberry32(0xc107);
  const n = valueNoise(size, 32, rnd);
  const h = new Float32Array(size * size);
  const threads = 64;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x / size) * threads, v = (y / size) * threads;
    const diag = Math.floor(u + v) % 4 < 2 ? 1 : 0; // twill diagonal
    const warp = 0.5 + 0.5 * Math.cos((u % 1) * Math.PI * 2);
    const weft = 0.5 + 0.5 * Math.cos((v % 1) * Math.PI * 2);
    const rip = (Math.floor(u) % 16 === 0 || Math.floor(v) % 16 === 0) ? 0.5 : 0;
    h[y * size + x] = (diag ? warp : weft) * 0.8 + rip + 0.25 * n[y * size + x];
  }
  return heightToTexture(h, size, 0.9);
}

/** Leather / synthetic-leather grain for gloves: fine pebbling. */
export function makeLeatherDetail(size = 256): THREE.DataTexture {
  const rnd = mulberry32(0x1ea7e5);
  const w = worley(size, 40, rnd);
  const n = valueNoise(size, 16, rnd);
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = Math.min(1, w.f1[i] * 1.6) * 0.8 + 0.3 * n[i];
  return heightToTexture(h, size, 0.8);
}
