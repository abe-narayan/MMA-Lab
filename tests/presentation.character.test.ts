/**
 * Character module (docs/design/08 §3–4): the body asset, the morph-and-fit body build, the rest
 * skeleton it derives, skinning data, budgets and the skin-tone ramp. No GPU: everything here is
 * CPU-side geometry, data and node-graph construction.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARCHETYPES, deriveRuntime, resolveParams, type FighterDefinition } from '../src/sim';
import { decodeBodyAsset, type BodyAsset, type BodyHeader } from '../src/presentation/character/asset';
import { buildBody, builtToT } from '../src/presentation/character/body';
import { canonical } from '../src/presentation/character/canonical';
import { luminance, resolveFace, skinAlbedo, skinPalette } from '../src/presentation/character/appearance';
import { B, BONE_COUNT, BONES } from '../src/presentation/rig/skeleton';

const DIR = 'static/assets/body';
const headerText = readFileSync(join(DIR, 'body.json'), 'utf8');
const binBuf = readFileSync(join(DIR, 'body.bin'));
const asset: BodyAsset = decodeBodyAsset(
  JSON.parse(headerText) as BodyHeader,
  binBuf.buffer.slice(binBuf.byteOffset, binBuf.byteOffset + binBuf.byteLength),
);
const params = resolveParams();
const defs = Object.values(ARCHETYPES);
const runtime = (d: FighterDefinition) => deriveRuntime(d, params, { explain: false });

function variant(base: FighterDefinition, body: Partial<FighterDefinition['body']>, app: Partial<FighterDefinition['appearance']> = {}): FighterDefinition {
  return { ...base, body: { ...base.body, ...body }, appearance: { ...base.appearance, ...app } };
}

function span(d: FighterDefinition): { span: number; body: ReturnType<typeof buildBody> } {
  const body = buildBody(asset, d, runtime(d));
  const t = builtToT(asset, body);
  let lo = Infinity, hi = -Infinity;
  for (let s = 0; s < asset.header.counts.body; s++) { lo = Math.min(lo, t[s * 3]); hi = Math.max(hi, t[s * 3]); }
  return { span: hi - lo, body };
}

describe('body asset (scripts/assets/build-body.mjs)', () => {
  it('matches its recorded checksum and bone order', () => {
    const h = JSON.parse(headerText) as BodyHeader;
    expect(createHash('sha256').update(binBuf).digest('hex')).toBe(h.binSha256);
    expect(h.bones).toEqual([...BONES]);
    expect(h.counts.trisLod0).toBeLessThanOrEqual(30000);
  });

  it('is deterministic: a rebuild from the cached MPFB2 data reproduces the committed bytes', () => {
    const cache = process.env.MPFB_CACHE ?? join(tmpdir(), 'boutlab-mpfb2');
    if (!existsSync(join(cache, '3dobjs', 'base.obj'))) return; // no offline cache on this machine
    const out = mkdtempSync(join(tmpdir(), 'boutlab-body-'));
    try {
      execFileSync(process.execPath, ['scripts/assets/build-body.mjs', '--offline', '--out', out], { stdio: 'pipe' });
      expect(readFileSync(join(out, 'body.bin')).equals(binBuf)).toBe(true);
      expect(readFileSync(join(out, 'body.json'), 'utf8')).toBe(headerText);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120000);

  it('skin weights sum to one and reference valid bones', () => {
    const { skinIdx, skinW, srcCount } = asset;
    for (let s = 0; s < srcCount; s++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += skinW[s * 4 + k];
        expect(skinIdx[s * 4 + k]).toBeLessThan(BONE_COUNT);
      }
      expect(sum).toBe(255);
    }
  });
});

describe('body build', () => {
  const base = ARCHETYPES['arch.regional_pro_allrounder'] ?? defs[0];

  it('fits every archetype: stature, reach (±2 cm) and hip height', () => {
    for (const d of defs) {
      const { span: sp, body } = span(d);
      expect(Math.abs(sp - d.body.reachM)).toBeLessThan(0.02);
      expect(Math.abs(body.measures.statureM - d.body.heightM)).toBeLessThan(0.01);
      expect(Math.abs(body.measures.hipHeightM - d.body.legReachM)).toBeLessThan(0.02);
      expect(body.rest.statureM).toBeCloseTo(body.measures.statureM, 6);
    }
  });

  it('re-derives joints from the morphed flesh: a taller fighter has higher joints', () => {
    const short = buildBody(asset, variant(base, { heightM: 1.66, reachM: 1.68, legReachM: 0.95 }));
    const tall = buildBody(asset, variant(base, { heightM: 1.95, reachM: 1.98, legReachM: 1.12 }));
    for (const b of [B.hips, B.spine2, B.neck, B.head, B.lArm, B.lLeg]) {
      expect(tall.rest.head[b * 3 + 1]).toBeGreaterThan(short.rest.head[b * 3 + 1] + 0.05);
    }
  });

  it('a longer reach puts the hand joint further out, and the mesh span follows', () => {
    const a = span(variant(base, { reachM: 1.78 }));
    const b = span(variant(base, { reachM: 1.94 }));
    expect(b.body.rest.head[B.lHand * 3]).toBeGreaterThan(a.body.rest.head[B.lHand * 3] + 0.05);
    expect(b.body.rest.head[B.rHand * 3]).toBeLessThan(a.body.rest.head[B.rHand * 3] - 0.05);
    expect(b.span - a.span).toBeGreaterThan(0.14);
    // Joints sit inside the flesh: the wrist is inside the span.
    expect(b.body.rest.head[B.lHand * 3]).toBeLessThan(b.span / 2);
  });

  it('the rest skeleton is a T-pose with every bone along its canonical direction', () => {
    const body = buildBody(asset, base);
    const r = body.rest;
    // Arms horizontal: shoulder, elbow and wrist at nearly the same height.
    expect(Math.abs(r.head[B.lForeArm * 3 + 1] - r.head[B.lArm * 3 + 1])).toBeLessThan(0.03);
    expect(Math.abs(r.head[B.lHand * 3 + 1] - r.head[B.lArm * 3 + 1])).toBeLessThan(0.04);
    // Feet on the floor, head on top.
    expect(r.head[B.lFoot * 3 + 1]).toBeLessThan(0.12);
    expect(r.tail[B.head * 3 + 1]).toBeGreaterThan(r.head[B.neck * 3 + 1]);
    for (let i = 0; i < BONE_COUNT; i++) expect(r.length[i]).toBeGreaterThan(0.005);
  });

  it('is deterministic', () => {
    const a = buildBody(asset, base);
    const b = buildBody(asset, base);
    expect(Buffer.from(a.pos.buffer).equals(Buffer.from(b.pos.buffer))).toBe(true);
    expect(Buffer.from(a.rest.head.buffer).equals(Buffer.from(b.rest.head.buffer))).toBe(true);
  });

  it('skin tone never changes the body, and the face preset never changes the skin', () => {
    const light = buildBody(asset, variant(base, {}, { skinTone: 0.05, facePreset: 2 }));
    const dark = buildBody(asset, variant(base, {}, { skinTone: 0.95, facePreset: 2 }));
    expect(Buffer.from(light.pos.buffer).equals(Buffer.from(dark.pos.buffer))).toBe(true);
    const f1 = resolveFace({ ...base.appearance, facePreset: 1, skinTone: 0.1 });
    const f2 = resolveFace({ ...base.appearance, facePreset: 1, skinTone: 0.9 });
    expect(f1.shape).toEqual(f2.shape);
    const other = buildBody(asset, variant(base, {}, { skinTone: 0.05, facePreset: 7 }));
    expect(Buffer.from(light.pos.buffer).equals(Buffer.from(other.pos.buffer))).toBe(false);
  });
});

describe('skin tone ramp', () => {
  it('is monotone in luminance from very light to very dark', () => {
    let prev = Infinity;
    for (let i = 0; i <= 100; i++) {
      const l = luminance(skinAlbedo(i / 100));
      expect(l).toBeLessThan(prev);
      prev = l;
    }
    expect(luminance(skinAlbedo(0))).toBeGreaterThan(0.4);
    expect(luminance(skinAlbedo(1))).toBeLessThan(0.04);
  });

  it('keeps a warm, never grey, undertone and lighter palms on dark skin', () => {
    for (let i = 0; i <= 10; i++) {
      const c = skinAlbedo(i / 10);
      expect(c[0]).toBeGreaterThan(c[1]);
      expect(c[1]).toBeGreaterThan(c[2] * 0.95);
    }
    const p = skinPalette(0.95);
    expect(luminance(p.palm)).toBeGreaterThan(luminance(p.base) * 2);
  });
});

describe('fighter actor (no GPU)', () => {
  it('stays inside the LOD0 triangle budget and has cheaper LODs', async () => {
    const THREE = await import('three/webgpu');
    const { FighterActor } = await import('../src/presentation/character/actor');
    const { makeClothDetail, makeLeatherDetail, makeSkinDetail, makeSweatDetail } = await import('../src/presentation/character/textures');
    const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const mats = new Map<string, unknown>();
    const res = {
      asset, can: canonical(asset),
      skinTex: { maskA: tex, maskB: tex, detail: makeSkinDetail(64), sweat: makeSweatDetail(64) },
      kitTex: { cloth: makeClothDetail(64), leather: makeLeatherDetail(64) },
      material<M>(key: string, make: () => M): M {
        if (!mats.has(key)) mats.set(key, make());
        return mats.get(key) as M;
      },
    };
    const quality = {
      level: 'high', renderScale: 1, upscale: 'none', antialias: 'fxaa', maxPixelRatio: 1, shadows: 'soft',
      shadowMapSize: 2048, ambientOcclusion: false, screenSpaceReflections: false, bloom: false,
      replayDepthOfField: false, replayMotionBlur: false, skinScattering: true, sweatAndDamage: true,
      crowd: 'off', crowdCount: 0, maxCharacterLOD: 0,
    } as const;
    const fighters = [variant(defs[0], {}, { hairStyle: { styleId: 'curly', colorId: 'black', length: 'short' } }), defs[10]];
    const bout = {
      fighters, runtimes: fighters.map(runtime), teamOf: [0, 1], arena: {} as never, rulesetId: 'mma',
      glove: 'mma4oz', cornerColours: ['#c01824', '#1d4fb8'], blood: true, cosmeticSeed: 'test',
    } as const;
    for (let i = 0; i < fighters.length; i++) {
      const a = new FighterActor(res as never, bout as never, i, quality as never);
      const t0 = a.triangles();
      expect(t0).toBeLessThanOrEqual(60000);
      // WebGPU guarantees 8 vertex attributes and 8 vertex buffers per pipeline.
      a.object3d.traverse((o) => {
        const g = (o as { geometry?: import('three').BufferGeometry }).geometry;
        if (!g) return;
        const attrs = Object.values(g.attributes);
        expect(attrs.length, `${o.name} vertex attributes`).toBeLessThanOrEqual(8);
        const buffers = new Set(attrs.map((x) => ('data' in x && x.data ? x.data : x)));
        expect(buffers.size, `${o.name} vertex buffers`).toBeLessThanOrEqual(8);
      });
      a.setLOD(1);
      const t1 = a.triangles();
      a.setLOD(2);
      const t2 = a.triangles();
      expect(t1).toBeLessThan(t0 * 0.6);
      expect(t2).toBeLessThan(t1);
      expect(a.rest.head.length).toBe(BONE_COUNT * 3);
      a.dispose();
    }
  }, 60000);
});
