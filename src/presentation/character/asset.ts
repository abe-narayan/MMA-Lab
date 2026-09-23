/**
 * The runtime body asset (static/assets/body/, built by scripts/assets/build-body.mjs from
 * MakeHuman MPFB2 data, CC0). Decoding is pure and GPU-free so the body build can run in tests.
 *
 * Vertex spaces:
 *  - "src": the kept MakeHuman vertices — body, helper-tights, helper-upper-teeth, a few single
 *    vertices named by joint references, then one virtual vertex per `joint-*` cube and per eye.
 *    Morph targets, skin weights and joint references all index src vertices.
 *  - "render": body vertices split at UV seams. `renderSrc[r]` is the src vertex of render vertex r;
 *    the first 13 380 render vertices are the src body vertices in order.
 */
import { BONES } from '../rig/skeleton';

export interface BodyHeader {
  format: string;
  counts: { src: number; body: number; tights: number; teeth: number; render: number; trisLod0: number; trisLod1: number; trisLod2: number };
  ranges: { body: [number, number]; tights: [number, number]; teeth: [number, number]; refs: [number, number]; virtual: [number, number] };
  virtual: string[];
  bones: string[];
  jointRefs: { head: number[]; tail: number[] }[];
  targets: { name: string; count: number; dense: boolean; scale: number }[];
  masks: string[];
  buffers: Record<string, { type: string; offset: number; length: number }>;
  binBytes: number;
  binSha256: string;
}

export interface Target {
  /** Src vertex indices, or null when the target is dense (every src vertex, in order). */
  idx: Uint16Array | null;
  /** Quantised deltas, 3 per entry; metres = value * scale. */
  d: Int16Array;
  scale: number;
}

export interface BodyAsset {
  header: BodyHeader;
  srcCount: number;
  /** A-pose rest positions of every src vertex, metres. */
  srcPos: Float32Array;
  skinIdx: Uint8Array;
  /** Four weights per src vertex, summing to exactly 255. */
  skinW: Uint8Array;
  uv: Float32Array;
  renderSrc: Uint16Array;
  /** Body triangle lists in render vertices: LOD0, LOD1, LOD2. */
  lodIndex: Uint16Array[];
  /** Helper triangle lists in src vertices. */
  tightsIndex: Uint16Array;
  teethIndex: Uint16Array;
  targets: Map<string, Target>;
  virtualIndex(name: string): number;
}

const CTORS: Record<string, { new (b: ArrayBuffer, o: number, n: number): ArrayLike<number> }> = {
  Float32Array, Uint8Array, Uint16Array, Int16Array, Uint32Array,
} as never;

export function decodeBodyAsset(header: BodyHeader, bin: ArrayBuffer): BodyAsset {
  if (header.format !== 'boutlab-body/1') throw new Error(`unknown body asset format ${header.format}`);
  if (bin.byteLength !== header.binBytes) throw new Error('body.bin size does not match body.json');
  if (header.bones.length !== BONES.length || header.bones.some((b, i) => b !== BONES[i])) {
    throw new Error('body asset bone order differs from the canonical skeleton; rebuild the asset');
  }
  const get = <T>(name: string): T => {
    const b = header.buffers[name];
    if (!b) throw new Error(`body asset lacks ${name}`);
    const C = CTORS[b.type];
    // Copy into a fresh, aligned buffer (the bin is 4-byte aligned, so a view would also work,
    // but copies keep the ArrayBuffer collectable once decoded).
    const view = new C(bin, b.offset, b.length) as unknown as { slice(): T };
    return view.slice();
  };
  const targets = new Map<string, Target>();
  for (const t of header.targets) {
    targets.set(t.name, {
      idx: t.dense ? null : get<Uint16Array>(`t.${t.name}.i`),
      d: get<Int16Array>(`t.${t.name}.d`),
      scale: t.scale,
    });
  }
  const vbase = header.ranges.virtual[0];
  return {
    header,
    srcCount: header.counts.src,
    srcPos: get<Float32Array>('src.pos'),
    skinIdx: get<Uint8Array>('src.skinIdx'),
    skinW: get<Uint8Array>('src.skinW'),
    uv: get<Float32Array>('body.uv'),
    renderSrc: get<Uint16Array>('body.src'),
    lodIndex: [get<Uint16Array>('body.idx0'), get<Uint16Array>('body.idx1'), get<Uint16Array>('body.idx2')],
    tightsIndex: get<Uint16Array>('tights.idx'),
    teethIndex: get<Uint16Array>('teeth.idx'),
    targets,
    virtualIndex(name: string): number {
      const i = header.virtual.indexOf(name);
      if (i < 0) throw new Error(`no virtual vertex ${name}`);
      return vbase + i;
    },
  };
}

/** Add `weight` x target to positions (src space, 3 floats per vertex). */
export function applyTarget(pos: Float32Array, t: Target, weight: number): void {
  if (weight === 0) return;
  const k = weight * t.scale;
  const { idx, d } = t;
  if (idx === null) {
    for (let i = 0; i < d.length; i++) pos[i] += d[i] * k;
  } else {
    for (let j = 0; j < idx.length; j++) {
      const o = idx[j] * 3;
      pos[o] += d[j * 3] * k;
      pos[o + 1] += d[j * 3 + 1] * k;
      pos[o + 2] += d[j * 3 + 2] * k;
    }
  }
}

let loading: Promise<BodyAsset> | null = null;

/** Fetch and decode the body asset once (browser). `base` is the site path of static/assets/body. */
export function loadBodyAsset(base = '/assets/body/'): Promise<BodyAsset> {
  if (!loading) {
    loading = (async () => {
      const [hRes, bRes] = await Promise.all([fetch(`${base}body.json`), fetch(`${base}body.bin`)]);
      if (!hRes.ok || !bRes.ok) throw new Error(`body asset missing at ${base} (run scripts/assets/build-body.mjs)`);
      return decodeBodyAsset((await hRes.json()) as BodyHeader, await bRes.arrayBuffer());
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}
