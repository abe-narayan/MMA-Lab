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
import { FACE_PRESETS, luminance, resolveFace, skinAlbedo, skinPalette } from '../src/presentation/character/appearance';
import { anatomyForm, sweatPropensity, sweatRegion, sweatWetness, type V3 } from '../src/presentation/character/anatomy';
import { bakeSkinMaps, packSkinMaps } from '../src/presentation/character/skinMaps';
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
      skinTex: { maskA: tex, maskB: tex, detail: makeSkinDetail(64), sweat: makeSweatDetail(64), skinA: tex, skinB: tex, skinC: tex },
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
    // Cover the pass-2 parts too: beard shells (full beard), braided rows, eyelashes.
    const fighters = [
      variant(defs[0], {}, { hairStyle: { styleId: 'curly', colorId: 'black', length: 'short' }, facialHair: 'full' }),
      variant(defs[10], {}, { hairStyle: { styleId: 'cornrows', colorId: 'black', length: 'short' }, facialHair: 'goatee' }),
    ];
    const bout = {
      fighters, runtimes: fighters.map(runtime), teamOf: [0, 1], arena: {} as never, rulesetId: 'mma',
      glove: 'mma4oz', cornerColours: ['#c01824', '#1d4fb8'], blood: true, cosmeticSeed: 'test',
    } as const;
    for (let i = 0; i < fighters.length; i++) {
      const a = new FighterActor(res as never, bout as never, i, quality as never);
      const t0 = a.triangles();
      expect(t0).toBeLessThanOrEqual(60000);
      const names: string[] = [];
      a.object3d.traverse((o) => { names.push(o.name); });
      expect(names).toContain('lashes');
      expect(names.some((n) => n.startsWith('beard-'))).toBe(true);
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

// ---------------------------------------------------------------------------
// Lookdev pass 2
// ---------------------------------------------------------------------------

describe('sweat model (anatomy.ts)', () => {
  const can = canonical(asset);
  const nBody = asset.header.counts.body;
  const P = (s: number): V3 => [can.pos[s * 3], can.pos[s * 3 + 1], can.pos[s * 3 + 2]];
  const Nn = (s: number): V3 => [can.normal[s * 3], can.normal[s * 3 + 1], can.normal[s * 3 + 2]];
  // Canonical regions: chest/sternum front, forearms (T-pose arms along x), shins, torso.
  const chest: number[] = [], forearm: number[] = [], shin: number[] = [], torso: number[] = [];
  for (let s = 0; s < nBody; s++) {
    const [x, y, z] = P(s);
    if (Math.abs(x) < 0.12 && y > 1.2 && y < 1.36 && z > 0.05) chest.push(s);
    if (Math.abs(x) > 0.44 && Math.abs(x) < 0.6 && y > 1.28 && y < 1.42) forearm.push(s);
    if (Math.abs(x) > 0.05 && y > 0.12 && y < 0.38) shin.push(s);
    if (Math.abs(x) < 0.2 && y > 0.95 && y < 1.4) torso.push(s);
  }
  const mean = (a: number[]): number => a.reduce((t, v) => t + v, 0) / a.length;
  const wet = (list: number[], level: number, seed: number): number[] =>
    list.map((s) => sweatWetness(sweatPropensity(P(s), Nn(s), seed), level));

  it('is regional: forearms and shins stay drier than the chest at the same sweat level', () => {
    expect(chest.length).toBeGreaterThan(50);
    expect(forearm.length).toBeGreaterThan(50);
    for (const level of [0.3, 0.5, 0.8]) {
      const c = mean(wet(chest, level, 7)), f = mean(wet(forearm, level, 7)), sh = mean(wet(shin, level, 7));
      expect(c, 'chest vs forearm at level ' + level).toBeGreaterThan(f + 0.2);
      expect(c, 'chest vs shin at level ' + level).toBeGreaterThan(sh + 0.2);
    }
    // The regional map itself ranks them.
    expect(mean(chest.map((s) => sweatRegion(P(s), Nn(s))))).toBeGreaterThan(mean(forearm.map((s) => sweatRegion(P(s), Nn(s)))) + 0.3);
  });

  it('is patchy, not an even coat: wetness over the torso varies strongly mid-fight', () => {
    for (const seed of [11, 12, 13]) {
      const w = wet(torso, 0.55, seed);
      const m = mean(w);
      const sd = Math.sqrt(mean(w.map((v) => (v - m) ** 2)));
      expect(sd).toBeGreaterThan(0.25);
      expect(m).toBeGreaterThan(0.15);
      expect(m).toBeLessThan(0.85);
    }
    // Where sweat pools (forehead, sternum) it is reliably among the first to run wet.
    const forehead: number[] = [];
    for (let s = 0; s < nBody; s++) { const [x, y, z] = P(s); if (Math.abs(x) < 0.04 && y > 1.585 && y < 1.63 && z > 0.1) forehead.push(s); }
    for (const seed of [1, 2, 3, 4, 5]) expect(mean(forehead.map((s) => sweatPropensity(P(s), Nn(s), seed)))).toBeGreaterThan(0.7);
    const w = wet(torso, 0.55, 11);
    const m = mean(w);
    expect(m).toBeGreaterThan(0.15);
  });

  it('builds over the rounds and is seeded per fighter', () => {
    const levels = [0.1, 0.3, 0.5, 0.7, 0.9].map((l) => mean(wet(torso, l, 3)));
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1]);
    const a = torso.map((s) => sweatPropensity(P(s), Nn(s), 1));
    const b = torso.map((s) => sweatPropensity(P(s), Nn(s), 1));
    const c = torso.map((s) => sweatPropensity(P(s), Nn(s), 2));
    expect(a).toEqual(b);
    expect(mean(a.map((v, i) => Math.abs(v - c[i])))).toBeGreaterThan(0.05);
  });
});

describe('generated textures and skin maps are deterministic', () => {
  it('the UV-space anatomy/region bake gives identical bytes twice, and covers the body', () => {
    const can = canonical(asset);
    const a = bakeSkinMaps(asset, can, 256);
    const b = bakeSkinMaps(asset, can, 256);
    expect(Buffer.from(packSkinMaps(a).raw).equals(Buffer.from(packSkinMaps(b).raw))).toBe(true);
    expect(a.coverage).toBeGreaterThan(0.5);
    // Relief is present (not a flat normal map): some texels bend well away from 128.
    let bent = 0;
    for (let i = 0; i < a.a.length; i += 4) if (Math.abs(a.a[i] - 128) > 8 || Math.abs(a.a[i + 1] - 128) > 8) bent++;
    expect(bent).toBeGreaterThan(20);
  }, 60000);

  it('the shipped skinmaps.bin matches its header checksum', () => {
    const head = JSON.parse(readFileSync(join(DIR, 'skinmaps.json'), 'utf8')) as { binSha256: string; size: number };
    const bin = readFileSync(join(DIR, 'skinmaps.bin'));
    expect(createHash('sha256').update(bin).digest('hex')).toBe(head.binSha256);
    expect(head.size).toBe(2048);
  });

  it('procedural detail textures are identical when regenerated', async () => {
    const { makeSkinDetail, makeSweatDetail } = await import('../src/presentation/character/textures');
    const bytes = (t: unknown): Buffer => Buffer.from((t as { image: { data: Uint8Array } }).image.data);
    expect(bytes(makeSkinDetail(64)).equals(bytes(makeSkinDetail(64)))).toBe(true);
    expect(bytes(makeSweatDetail(64)).equals(bytes(makeSweatDetail(64)))).toBe(true);
  });
});

describe('faces and anatomy', () => {
  const base = defs[0];
  const can = canonical(asset);
  const headVerts: number[] = [];
  for (let s = 0; s < asset.header.counts.body; s++) {
    if (can.pos[s * 3 + 1] > 1.44 && Math.abs(can.pos[s * 3]) < 0.1 && can.pos[s * 3 + 2] > 0.05) headVerts.push(s);
  }
  /** Face shape only: head vertices relative to their centroid (stature does not count). */
  const faceShape = (preset: number, id = 'face.test'): Float32Array => {
    const body = buildBody(asset, { ...variant(base, {}, { facePreset: preset }), id });
    const c = [0, 0, 0];
    for (const s of headVerts) for (let k = 0; k < 3; k++) c[k] += body.pos[s * 3 + k] / headVerts.length;
    const out = new Float32Array(headVerts.length * 3);
    headVerts.forEach((s, i) => { for (let k = 0; k < 3; k++) out[i * 3 + k] = body.pos[s * 3 + k] - c[k]; });
    return out;
  };
  const rms = (a: Float32Array, b: Float32Array): number => {
    let t = 0;
    for (let i = 0; i < a.length; i++) t += (a[i] - b[i]) ** 2;
    return Math.sqrt(t / (a.length / 3));
  };

  it('the ten face presets are measurably different faces', () => {
    expect(FACE_PRESETS.length).toBe(10);
    const shapes = FACE_PRESETS.map((_, i) => faceShape(i));
    let min = Infinity;
    for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) min = Math.min(min, rms(shapes[i], shapes[j]));
    // Every pair of presets differs by more than 1.2 mm RMS over the whole face (most by 3-6 mm).
    expect(min).toBeGreaterThan(0.0012);
  }, 60000);

  it('every fighter gets a seeded, stable asymmetry on top of the preset', () => {
    const a1 = faceShape(3, 'fighter.a'), a2 = faceShape(3, 'fighter.a'), b = faceShape(3, 'fighter.b');
    expect(rms(a1, a2)).toBe(0);
    expect(rms(a1, b)).toBeGreaterThan(0.0004);
    // The face's left/right mirror error is non-zero (no real face is symmetric).
    // Mirror partners on the (symmetric) base mesh: nearest vertex to (-x, y, z) within 0.5 mm.
    const pairs: [number, number][] = [];
    headVerts.forEach((s, i) => {
      if (can.pos[s * 3] < 0.005) return;
      let best = -1, bd = 0.0005;
      headVerts.forEach((t, j) => {
        const d = Math.hypot(can.pos[t * 3] + can.pos[s * 3], can.pos[t * 3 + 1] - can.pos[s * 3 + 1], can.pos[t * 3 + 2] - can.pos[s * 3 + 2]);
        if (d < bd) { bd = d; best = j; }
      });
      if (best >= 0) pairs.push([i, best]);
    });
    expect(pairs.length).toBeGreaterThan(100);
    let asym = 0;
    for (const [i, j] of pairs) asym += Math.hypot(a1[i * 3] + a1[j * 3], a1[i * 3 + 1] - a1[j * 3 + 1], a1[i * 3 + 2] - a1[j * 3 + 2]);
    expect(asym / pairs.length).toBeGreaterThan(0.0003);
  }, 60000);

  it('skin tone and face preset stay independent: tone never moves geometry, the palette is tone alone', () => {
    for (const preset of [0, 4, 8]) {
      const light = buildBody(asset, variant(base, {}, { skinTone: 0.05, facePreset: preset }));
      const dark = buildBody(asset, variant(base, {}, { skinTone: 0.95, facePreset: preset }));
      expect(Buffer.from(light.pos.buffer).equals(Buffer.from(dark.pos.buffer))).toBe(true);
    }
    let prev = Infinity;
    for (let i = 0; i <= 20; i++) {
      const p = skinPalette(i / 20);
      expect(luminance(p.base)).toBeLessThan(prev);
      prev = luminance(p.base);
      expect(p.base[0]).toBeGreaterThan(p.base[2]);
    }
  });

  it('muscle form is anatomical and follows definition: abs, deltoids, calves', () => {
    // Ab blocks rise between the tendinous intersections; deltoid cap; gastrocnemius heads.
    expect(anatomyForm([0.035, 1.146, 0.13], [0, 0, 1])).toBeGreaterThan(0.002);
    expect(anatomyForm([0.035, 1.146, 0.13], [0, 0, 1])).toBeGreaterThan(anatomyForm([0.035, 1.128, 0.13], [0, 0, 1]) + 0.0005);
    expect(anatomyForm([0.21, 1.4, 0.03], [0, 1, 0])).toBeGreaterThan(0.002);
    expect(anatomyForm([0.08, 0.33, -0.02], [0, 0, -1])).toBeGreaterThan(0.002);
    // The same fighter at full vs zero definition: the form lands on the muscles (abdomen,
    // deltoids), millimetres deep, and nowhere near the face.
    const rt = runtime(base);
    const defined = buildBody(asset, base, { ...rt, rig: { ...rt.rig, definition: 1 } });
    const smooth0 = buildBody(asset, base, { ...rt, rig: { ...rt.rig, definition: 0 } });
    let absMax = 0, faceMax = 0;
    for (let s = 0; s < asset.header.counts.body; s++) {
      const x = can.pos[s * 3], y = can.pos[s * 3 + 1], z = can.pos[s * 3 + 2];
      const d = Math.hypot(defined.pos[s * 3] - smooth0.pos[s * 3], defined.pos[s * 3 + 1] - smooth0.pos[s * 3 + 1], defined.pos[s * 3 + 2] - smooth0.pos[s * 3 + 2]);
      if (Math.abs(x) < 0.08 && y > 1.08 && y < 1.2 && z > 0.1) absMax = Math.max(absMax, d);
      if (y > 1.5 && z > 0.1) faceMax = Math.max(faceMax, d);
    }
    expect(absMax).toBeGreaterThan(0.002);
    expect(faceMax).toBeLessThan(0.0002);
  }, 60000);
});
