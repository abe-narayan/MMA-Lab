/**
 * LEAK SUITE — Watch bout switching must not grow memory (QA2 #3,
 * docs/design/PHASE8_NOTES.md "Leak fix").
 *
 * No GPU in Node, so the renderer is modelled on the parts of three r186 that
 * leaked:
 *  - `RenderObjects` keeps one record per (object, material) in a strong set
 *    and frees it only when the material or the object fires `dispose` (a
 *    geometry `dispose` frees the buffers, not the record);
 *  - the geometry registry frees on geometry `dispose`;
 *  - a bare `scene.environment` texture gets a PMREM generator per texture
 *    that nothing frees (a node in `scene.environmentNode` is its owner's to
 *    dispose);
 *  - every light ever drawn stays referenced (the shared bind-group cache and
 *    the shadow cameras' render lists are never pruned);
 *  - a scene warm-up (`compileAsync`) collects the scene first and builds the
 *    render state later, also for objects disposed in between.
 *
 * The presenter runs with the real character factory (body asset from
 * static/assets, masks stubbed), referee, corner crew, finish staging,
 * animator, director and venue (on a do-nothing 2D canvas). Over the bout
 * switches the model's records, geometries, lights and PMREM generators must
 * stay flat, and every earlier bout's bodies and venue must be
 * garbage-collectable (WeakRef census after a forced GC), also when a bout is
 * switched away from while its warm-up is still compiling.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import * as THREE from 'three/webgpu';
import {
  ARCHETYPES, DEFAULT_SETTINGS, createSim, deriveRuntime, resolveParams,
  type SimConfig, type SimEvent, type TickSnapshot,
} from '../src/sim';
import { buildBoutPresentation } from '../src/presentation/stage/bout';
import { qualitySettings } from '../src/presentation/stage/quality';
import { createPresenter, type StageLike } from '../src/presentation/presenter';
import { createCharacterFactory } from '../src/presentation/character';
import { createArenaSet } from '../src/presentation/arena';
import { createAnimator } from '../src/presentation/anim';
import { createCameraDirector } from '../src/presentation/camera';
import type { BoutPresentation, CameraState } from '../src/presentation/contract';

vi.mock('../src/presentation/character/masks', async () => {
  const T = await import('three/webgpu');
  const tex = (): InstanceType<typeof T.DataTexture> => new T.DataTexture(new Uint8Array(4), 1, 1);
  return { loadMasks: async () => ({ maskA: tex(), maskB: tex() }) };
});

const STATIC = join(__dirname, '..', 'static');

// ---- the environment: fetch from static/, a do-nothing 2D canvas ----------------

function fakeFetch(url: string | URL): Promise<Response> {
  const p = join(STATIC, decodeURIComponent(String(url)).replace(/^\//, ''));
  if (!existsSync(p)) return Promise.resolve(new Response('missing', { status: 404 }));
  return Promise.resolve(new Response(readFileSync(p), { status: 200 }));
}

/** A 2D context that accepts every call; the venue only paints procedural textures with it. */
function fakeContext(w: number, h: number): unknown {
  const img = (): { data: Uint8ClampedArray; width: number; height: number } => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
  const grad = { addColorStop: () => undefined };
  const special: Record<string, unknown> = {
    getImageData: img, createImageData: img, measureText: () => ({ width: 10 }),
    createLinearGradient: () => grad, createRadialGradient: () => grad, createConicGradient: () => grad,
    createPattern: () => ({}), getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }), isPointInPath: () => false,
  };
  const store: Record<string, unknown> = {};
  return new Proxy(store, {
    get: (t, k: string) => (k in special ? special[k] : k in t ? t[k] : () => undefined),
    set: (t, k: string, v) => { t[k] = v; return true; },
  });
}

function fakeDocument(): unknown {
  return {
    createElement: (tag: string) => {
      if (tag !== 'canvas') return {};
      const c = { width: 1, height: 1, style: {}, getContext: () => fakeContext(c.width, c.height) };
      return c;
    },
  };
}

// ---- the renderer model ---------------------------------------------------------

type Target = THREE.EventDispatcher<Record<string, object>>;
type Listener = { type: string; target: Target; fn: () => void };

/** three r186's retention rules (see the header). */
class RendererModel {
  readonly records = new Set<{ object: THREE.Object3D; material: THREE.Material }>();
  private readonly byObject = new WeakMap<THREE.Object3D, Map<THREE.Material, unknown>>();
  readonly geometries = new Set<THREE.BufferGeometry>();
  /** Bare environment textures three turned into PMREMs (a generator each, never freed). */
  readonly envGenerators = new Set<THREE.Texture>();
  /** Environment nodes still alive (not disposed by their owner). */
  readonly envNodes = new Set<unknown>();
  /** Every light ever drawn. */
  readonly lights = new Set<THREE.Light>();

  private on(target: Target, type: string, fn: () => void): Listener {
    target.addEventListener(type, fn);
    return { type, target, fn };
  }

  private off(ls: Listener[]): void {
    for (const l of ls) l.target.removeEventListener(l.type, l.fn);
  }

  /** A frame: the environment, the lights and every drawable in the scene. */
  render(scene: THREE.Scene): void {
    const sceneE = scene as THREE.Scene & { environmentNode?: (Target & object) | null };
    const n = sceneE.environmentNode;
    if (n && !this.envNodes.has(n)) {
      this.envNodes.add(n);
      const l = this.on(n, 'dispose', () => { this.envNodes.delete(n); this.off([l]); });
    } else if (!n && scene.environment) {
      this.envGenerators.add(scene.environment);
    }
    scene.traverse((o) => {
      if ((o as THREE.Light).isLight) this.lights.add(o as THREE.Light);
      this.register(o);
    });
  }

  /** What a warm-up collects up front, to build later whatever happens to it meanwhile. */
  collect(scene: THREE.Scene): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    scene.traverse((o) => { out.push(o); });
    return out;
  }

  /** The render state of one object (a render object per material, its geometry). */
  register(o: THREE.Object3D): void {
    const m = o as THREE.Mesh;
    if (!m.isMesh && !(o as THREE.Points).isPoints && !(o as THREE.Line).isLine) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    let map = this.byObject.get(o);
    if (!map) { map = new Map(); this.byObject.set(o, map); }
    for (const mat of mats) {
      if (!mat || map.has(mat)) continue;
      const rec = { object: o, material: mat };
      const ls: Listener[] = [];
      const owner = map;
      const free = (): void => { this.records.delete(rec); owner.delete(mat); this.off(ls); };
      ls.push(this.on(mat as unknown as Target, 'dispose', free), this.on(o as unknown as Target, 'dispose', free));
      map.set(mat, rec);
      this.records.add(rec);
    }
    const g = m.geometry;
    if (g && !this.geometries.has(g)) {
      this.geometries.add(g);
      const l = this.on(g as unknown as Target, 'dispose', () => { this.geometries.delete(g); this.off([l]); });
    }
  }
}

function fakeStage(extra: Partial<StageLike> = {}): StageLike {
  return {
    backend: 'webgpu', scene: new THREE.Scene() as unknown as StageLike['scene'], quality: qualitySettings('medium'),
    setQuality: () => undefined, applyShadowPolicy: () => undefined, resize: () => undefined,
    setCameraState: (_s: CameraState) => undefined, setReplay: () => undefined, cut: () => undefined,
    frameTiming: () => undefined, render: () => undefined, warmUp: () => undefined,
    info: () => ({ drawCalls: 0, triangles: 0, internalWidth: 1, internalHeight: 1 }), dispose: () => undefined,
    ...extra,
  };
}

// ---- bouts ----------------------------------------------------------------------

const ARCH = Object.values(ARCHETYPES);
const VENUES: [string, string][] = [['mma.unified.3r', 'octagon_30'], ['boxing.pro', 'ring_20'], ['mma.unified.3r', 'octagon_25']];

function boutAndRecording(i: number): { bout: BoutPresentation; frames: TickSnapshot[]; events: SimEvent[] } {
  const [ruleset, arena] = VENUES[i % VENUES.length];
  const cfg = {
    seed: `leak-${i}`, mode: '1v1', fighters: [ARCH[i % ARCH.length], ARCH[(i + 3) % ARCH.length]], teams: { teamOf: [0, 1] },
    ruleset, arena, settings: DEFAULT_SETTINGS,
  } as SimConfig;
  const params = resolveParams(cfg.paramOverrides);
  const bout = buildBoutPresentation({ config: cfg, fighters: cfg.fighters, runtimes: cfg.fighters.map((f) => deriveRuntime(f, params, { explain: false })) });
  const sim = createSim(cfg);
  const frames = [sim.snapshot()];
  for (let k = 0; k < 40 && sim.step(); k++) frames.push(sim.snapshot());
  return { bout, frames, events: [...sim.events] };
}

function forceGc(): void {
  setFlagsFromString('--expose_gc');
  (runInNewContext('gc') as () => void)();
}

/** Weak references to what is in the scene now (a helper, so no local keeps them alive). */
function track(refs: WeakRef<THREE.Object3D>[], scene: THREE.Object3D): void {
  for (const c of scene.children) refs.push(new WeakRef(c));
}

/** Names of the objects behind `refs` still alive after a few forced collections. */
async function aliveAfterGc(refs: readonly WeakRef<THREE.Object3D>[]): Promise<string[]> {
  for (let k = 0; k < 3; k++) {
    await new Promise((r) => setTimeout(r, 0));
    forceGc();
  }
  return refs.filter((r) => r.deref() !== undefined).map((r) => r.deref()!.name);
}

describe('presenter: bout switching does not leak', () => {
  const g = globalThis as unknown as { fetch: typeof fetch; document?: unknown };
  const saved = { fetch: g.fetch, document: g.document };
  beforeAll(() => {
    g.fetch = fakeFetch as typeof fetch;
    g.document = fakeDocument();
  });
  afterAll(() => {
    g.fetch = saved.fetch;
    if (saved.document === undefined) delete g.document; else g.document = saved.document;
  });

  function presenterOn(stage: StageLike, onVenue: () => void = () => undefined): ReturnType<typeof createPresenter> {
    return createPresenter({
      createStage: async () => stage,
      createArenaSet: async (a, q, o) => {
        const set = await createArenaSet(a, q, o);
        if (set) onVenue();
        return set;
      },
      createCharacterFactory: () => createCharacterFactory({ assetBase: '/assets/body/' }),
      createAnimator: () => createAnimator(),
      createCameraDirector: () => createCameraDirector(),
      now: () => 0,
    }, qualitySettings('medium'));
  }

  async function show(p: ReturnType<typeof createPresenter>, i: number): Promise<void> {
    const { bout, frames, events } = boutAndRecording(i);
    const building = p.setBout(bout);
    p.setRecording(frames, events);
    await building;
    expect(p.modules.character).toBe('module');
  }

  it('keeps render records, geometries, lights and environments flat over 10 bouts, and frees old bouts', async () => {
    const stage = fakeStage();
    const model = new RendererModel();
    let venues = 0;
    const p = presenterOn(stage, () => { venues++; });
    await p.mount({ clientWidth: 1600, clientHeight: 900 } as HTMLElement);

    const samples: { records: number; geometries: number; env: number; envNodes: number; lights: number }[] = [];
    const oldBouts: WeakRef<THREE.Object3D>[] = [];
    for (let i = 0; i < 10; i++) {
      track(oldBouts, stage.scene);
      await show(p, i % 3);
      model.render(stage.scene as unknown as THREE.Scene);
      samples.push({ records: model.records.size, geometries: model.geometries.size, env: model.envGenerators.size, envNodes: model.envNodes.size, lights: model.lights.size });
    }
    expect(venues).toBe(10);
    // The same three bouts in rotation: from the second round on, every count repeats exactly.
    const [a, b] = [samples[3], samples[9]];
    expect(b.records).toBe(a.records);
    expect(b.geometries).toBe(a.geometries);
    expect(b.lights).toBe(a.lights);
    expect(b.env).toBe(0);
    expect(b.envNodes).toBe(1);
    // Everything the earlier bouts put in the scene (venue, fighters, referee, corner) is collectable.
    expect(oldBouts.length).toBe(9 * 5);
    expect(await aliveAfterGc(oldBouts)).toEqual([]);
    p.dispose();
    expect(model.records.size).toBe(0);
    expect(model.geometries.size).toBe(0);
  }, 180_000);

  it('frees a bout switched away from while its warm-up is still compiling', async () => {
    const model = new RendererModel();
    // A warm-up like three's compileAsync: collect the scene now, build it when released.
    let release: () => void = () => undefined;
    const stage: StageLike = fakeStage({
      precompile: async () => {
        const list = model.collect(stage.scene as unknown as THREE.Scene);
        await new Promise<void>((r) => { release = r; });
        for (const o of list) model.register(o);
      },
    });
    const p = presenterOn(stage);
    await p.mount({ clientWidth: 1600, clientHeight: 900 } as HTMLElement);

    const records: number[] = [];
    const oldBouts: WeakRef<THREE.Object3D>[] = [];
    for (let i = 0; i < 5; i++) {
      await show(p, 0);
      model.render(stage.scene as unknown as THREE.Scene);
      track(oldBouts, stage.scene);
      const warm = p.warmUpAsync();
      // Switch before the warm-up has built anything, then let it finish.
      await show(p, 1);
      release();
      await warm;
      await new Promise((r) => setTimeout(r, 0));
      model.render(stage.scene as unknown as THREE.Scene);
      records.push(model.records.size);
    }
    expect(records[4]).toBe(records[1]);
    expect(await aliveAfterGc(oldBouts)).toEqual([]);
    p.dispose();
    expect(model.records.size).toBe(0);
  }, 180_000);
});
