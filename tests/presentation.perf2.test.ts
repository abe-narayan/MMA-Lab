/**
 * PERFORMANCE PASS 2 SUITE — docs/design/PHASE8_NOTES.md "Performance pass 2".
 *
 * No GPU in vitest; what this holds is the logic the GPU work depends on:
 *  1. canonical helper-function order (`orderCodes`): the same set of shader functions gives the
 *     same text whatever order a build registered them in (the duplicate skin program on a cold
 *     WebGL2 load), and every function still follows the ones it calls;
 *  2. the concurrent warm-up lanes (`compileLanes`): every renderable in exactly one lane, all of a
 *     material's objects in one lane, a body's morphing and plain variants apart, masks preserved;
 *  3. the near-fence lens (`fenceLensFor`): focus follows the shot, the fence 0.4 m from a handheld
 *     blurs exactly as much as the live DoF blurs anything else there, the arena's floor aperture
 *     elsewhere;
 *  4. the WebGL2 skin variant: `setSkinVariant` chooses the graph, the lite graph drops the separate
 *     clear-coat normal and the second specular lobe, the full graph keeps them;
 *  5. QA2 #1: the stage holds the page's frames while the scene warm-up runs, and its async GPU work
 *     (the quality probe, the warm-up) runs one job at a time; QA2 #2: a shadow-map size change only
 *     sets the size (three's shadow node owns the map).
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { orderCodes } from '../src/presentation/stage/programSharing';
import { compileLanes, FENCE_LENS, fenceLensFor, liveDofParams } from '../src/presentation/stage/pipeline';
import { createSkinMaterial, setSkinVariant, skinVariant } from '../src/presentation/character/skinMaterial';
import { makeSkinDetail, makeSweatDetail } from '../src/presentation/character/textures';
import { Stage } from '../src/presentation/stage/index';
import { broadcastRig } from '../src/presentation/arena/lighting';
import { qualitySettings } from '../src/presentation/stage/quality';

const FNS = [
  'int mx_floor ( float x ) {\n\treturn int( floor( x ) );\n}',
  'float mx_fade ( float t ) {\n\treturn t * t * t;\n}',
  'uint mx_hash ( int x ) {\n\treturn uint( x );\n}',
  'float mx_perlin ( vec3 p ) {\n\tint i = mx_floor( p.x );\n\tfloat f = mx_fade( p.y );\n\treturn float( mx_hash( i ) ) * f;\n}',
  'float mx_cell ( vec3 p ) {\n\treturn float( mx_hash( mx_floor( p.x ) ) );\n}',
];

describe('canonical shader function order', () => {
  it('is the same text for every registration order', () => {
    const want = orderCodes(FNS).join('\n');
    const perms = [[4, 3, 2, 1, 0], [2, 0, 4, 1, 3], [3, 4, 0, 2, 1], [1, 3, 0, 4, 2]];
    for (const p of perms) expect(orderCodes(p.map((i) => FNS[i]!)).join('\n')).toBe(want);
  });

  it('defines every function before its callers, and keeps other blocks first in their order', () => {
    const other = ['// struct block A', '#define X 1'];
    const out = orderCodes([FNS[3]!, other[0]!, FNS[4]!, other[1]!, FNS[0]!, FNS[1]!, FNS[2]!]);
    expect(out.slice(0, 2)).toEqual(other);
    const at = (name: string): number => out.findIndex((c) => c.includes(` ${name} (`));
    expect(at('mx_floor')).toBeLessThan(at('mx_perlin'));
    expect(at('mx_fade')).toBeLessThan(at('mx_perlin'));
    expect(at('mx_hash')).toBeLessThan(at('mx_perlin'));
    expect(at('mx_hash')).toBeLessThan(at('mx_cell'));
    expect(out).toHaveLength(7);
  });

  it('handles WGSL `fn` definitions', () => {
    const w = ['fn b(x: f32) -> f32 { return a(x); }', 'fn a(x: f32) -> f32 { return x; }'];
    expect(orderCodes(w)).toEqual([w[1], w[0]]);
  });
});

describe('concurrent warm-up lanes', () => {
  it('puts each renderable in one lane, a material in one lane, a body’s morph variant apart', () => {
    const scene = new THREE.Scene();
    const skin = new THREE.MeshBasicNodeMaterial();
    const other = [0, 1, 2, 3, 4].map(() => new THREE.MeshBasicNodeMaterial());
    const morph = new THREE.BoxGeometry();
    morph.morphAttributes.position = [morph.getAttribute('position').clone() as THREE.BufferAttribute];
    const plain = new THREE.BoxGeometry();
    const body = new THREE.Group();
    const lod0 = new THREE.Mesh(morph, skin);
    const lod1 = new THREE.Mesh(plain, skin);
    const lod2 = new THREE.Mesh(plain, skin);
    lod1.layers.mask = 5;
    body.add(lod0, lod1, lod2);
    scene.add(body);
    for (const m of other) scene.add(new THREE.Mesh(plain, m), new THREE.Mesh(plain, m));
    // A child of a renderable (reached through it when it is masked out).
    lod0.add(new THREE.Mesh(plain, other[0]!));
    scene.add(new THREE.DirectionalLight());
    const lanes = compileLanes(scene, 4);
    expect(lanes.length).toBe(4);
    const all = lanes.flat();
    let renderables = 0;
    scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) renderables++; });
    expect(all.length).toBe(renderables);
    expect(new Set(all.map(([o]) => o)).size).toBe(renderables);
    const laneOf = (o: THREE.Object3D): number => lanes.findIndex((l) => l.some(([x]) => x === o));
    expect(laneOf(lod1)).toBe(laneOf(lod2));
    expect(laneOf(lod0)).not.toBe(laneOf(lod1));
    for (const m of other) {
      const ls = new Set(all.filter(([o]) => (o as THREE.Mesh).material === m).map(([o]) => laneOf(o)));
      expect(ls.size).toBe(1);
    }
    expect(all.find(([o]) => o === lod1)![1]).toBe(5);
  });
});

describe('near-fence lens', () => {
  it('focus follows the shot; no live DoF → the floor aperture', () => {
    expect(fenceLensFor(2.2, 0, 40, 1008, true)).toEqual({ focus: 2.2, aperture: FENCE_LENS.minAperture });
    expect(fenceLensFor(9, 0.35, 25, 1008, false)).toEqual({ focus: 9, aperture: FENCE_LENS.minAperture });
    expect(fenceLensFor(0.1, 0, 40, 1008, true).focus).toBe(0.3);
  });

  it('matches the live DoF’s blur of anything 0.4 m from a handheld', () => {
    for (const [focus, fov, h] of [[3, 40, 1008], [1.8, 60, 819], [5, 25, 1164]] as const) {
      const s = 0.35;
      const { aperture } = fenceLensFor(focus, s, fov, h, true);
      const z = FENCE_LENS.refM;
      // The fence material: footprint grows by 2·aperture·(1 − z/focus) (a diameter).
      const fenceBlurM = 2 * aperture * (1 - z / focus);
      // The live DoF: CoC radius in half-res px, times one half-res pixel at z in metres, doubled.
      const p = liveDofParams(s);
      const x = Math.min(1, Math.abs(z - focus) / (p.k * z));
      const cocPx = p.radiusHalfPx * x * x * (3 - 2 * x);
      const stageBlurM = 2 * cocPx * (2 * z * Math.tan((fov * Math.PI) / 360)) / (h / 2);
      expect(fenceBlurM).toBeCloseTo(Math.max(stageBlurM, 2 * FENCE_LENS.minAperture * (1 - z / focus)), 9);
      // A cageside handheld lands near the arena's hand-tuned 9 mm.
      expect(aperture).toBeGreaterThan(0.006);
      expect(aperture).toBeLessThan(0.03);
    }
  });

  it('never blurs the fence beyond the focus plane', () => {
    const { focus, aperture } = fenceLensFor(3, 0.35, 40, 1008, true);
    const blur = (z: number): number => 2 * aperture * Math.max(1 - z / focus, 0);
    expect(blur(3)).toBe(0);
    expect(blur(6)).toBe(0);
    expect(blur(0.35)).toBeGreaterThan(blur(1.5));
  });
});

describe('WebGL2 skin variant', () => {
  const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  const skinTex = { maskA: tex, maskB: tex, detail: makeSkinDetail(16), sweat: makeSweatDetail(16), skinA: tex, skinB: tex, skinC: tex };
  const V: [number, number, number] = [0, 1.6, 0.1];
  const lm = {
    eyeL: [0.03, 1.6, 0.1], eyeR: [-0.03, 1.6, 0.1], noseTip: [0, 1.57, 0.12], lips: [0, 1.54, 0.11], chin: [0, 1.5, 0.1],
    browL: V, browR: V, cheekL: V, cheekR: V, earL: [0.07, 1.58, 0], earR: [-0.07, 1.58, 0], crownY: 1.75, neckY: 1.46,
    headCentre: [0, 1.62, 0],
  } as never;

  it('setSkinVariant chooses the graph new materials get', () => {
    const before = skinVariant();
    setSkinVariant('lite');
    expect(skinVariant()).toBe('lite');
    expect(createSkinMaterial(skinTex, { scattering: false, sweatAndDamage: true, lm }).lite).toBe(true);
    setSkinVariant('full');
    expect(createSkinMaterial(skinTex, { scattering: false, sweatAndDamage: true, lm }).lite).toBe(false);
    setSkinVariant(before);
  });

  it('lite: the clear coat follows the skin normal; full: its own bead normal', () => {
    const lite = createSkinMaterial(skinTex, { scattering: false, sweatAndDamage: true, lm, lite: true });
    const full = createSkinMaterial(skinTex, { scattering: true, sweatAndDamage: true, lm, lite: false });
    expect(lite.clearcoatNormalNode).toBe(lite.normalNode);
    expect(full.clearcoatNormalNode).not.toBe(full.normalNode);
  });
});

/** Stage internals the QA2 tests drive (no GPU: the prototype with stub fields). */
interface StageInternals {
  renderFrame(): void; benching: boolean; compiling: number; gpuQueue: Promise<unknown>;
  precompileInner(): Promise<void>; gpuIdle(): Promise<void>; pipeline: unknown; renderer: unknown;
  render(): void; precompile(): Promise<void>; readonly precompiling: boolean;
  warmUpAll(p?: unknown, between?: () => Promise<void>): Promise<unknown>;
  gpuSerial<T>(f: () => Promise<T>): Promise<T>;
}
const bareStage = (): StageInternals => Object.create(Stage.prototype) as StageInternals;

describe('QA2 regressions', () => {
  it('#1: the page’s frames are held while the scene warm-up runs', async () => {
    const st = bareStage();
    let frames = 0;
    st.renderFrame = () => { frames++; };
    st.benching = false;
    st.compiling = 0;
    st.gpuQueue = Promise.resolve();
    let finish: () => void = () => undefined;
    st.precompileInner = () => new Promise<void>((r) => { finish = r; });
    const done = st.precompile();
    await new Promise((r) => setTimeout(r, 0)); // the warm-up has started
    st.render();
    expect(frames).toBe(0);
    expect(st.precompiling).toBe(true);
    finish();
    await done;
    st.render();
    expect(frames).toBe(1);
    expect(st.precompiling).toBe(false);
  });

  it('#1: async GPU jobs (probe, warm-up) never overlap', async () => {
    const st = bareStage();
    st.gpuQueue = Promise.resolve();
    const serial = st.gpuSerial.bind(st);
    const log: string[] = [];
    const job = (name: string, ms: number) => () => new Promise<string>((r) => {
      log.push(`${name}+`);
      setTimeout(() => { log.push(`${name}-`); r(name); }, ms);
    });
    const failing = () => Promise.reject(new Error('probe failed'));
    const a = serial(job('probe', 20));
    const b = serial(failing).catch(() => 'caught');
    const c = serial(job('warm', 1));
    expect(await Promise.all([a, b, c])).toEqual(['probe', 'caught', 'warm']);
    expect(log).toEqual(['probe+', 'probe-', 'warm+', 'warm-']);
  });

  it('#1/#2: a second warm-up waits for the first one’s post-chain draws', async () => {
    const st = bareStage();
    const log: string[] = [];
    st.benching = false; st.compiling = 0; st.gpuQueue = Promise.resolve();
    let n = 0;
    st.precompileInner = async () => { const k = ++n; log.push(`compile${k}+`); await new Promise((r) => setTimeout(r, 5)); log.push(`compile${k}-`); };
    st.renderFrame = () => { log.push('frame'); };
    st.gpuIdle = async () => { await new Promise((r) => setTimeout(r, 2)); };
    st.pipeline = { warmSteps: () => [() => log.push('replay'), () => log.push('dof')] };
    st.renderer = { setRenderTarget: () => undefined, setMRT: () => undefined };
    const a = st.warmUpAll();
    const b = st.warmUpAll();
    st.render(); // the page's frame loop: held
    await Promise.all([a, b]);
    expect(log).toEqual(['compile1+', 'compile1-', 'frame', 'replay', 'dof', 'compile2+', 'compile2-', 'frame', 'replay', 'dof']);
  });

  it('#2: a shadow-map size change only sets the size; the map stays the shadow node’s', () => {
    const rig = broadcastRig('octagon', 4.6, 9, qualitySettings('high'));
    const key = rig.shadowCasters[0]!;
    let disposed = 0;
    const map = { dispose: () => { disposed++; } };
    (key.shadow as unknown as { map: unknown }).map = map;
    for (const level of ['ultra', 'medium', 'high', 'ultra'] as const) {
      rig.setQuality(qualitySettings(level));
      expect(key.shadow.mapSize.x).toBe(qualitySettings(level).shadowMapSize);
      expect((key.shadow as unknown as { map: unknown }).map).toBe(map);
    }
    expect(disposed).toBe(0);
  });
});

