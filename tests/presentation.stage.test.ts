/**
 * STAGE / PRESENTER SUITE — docs/design/08 §4.4-4.5, 09 §1.3.2.
 *
 * No GPU in vitest, so the renderer itself is replaced by a fake stage; what
 * this suite holds is everything around it:
 *
 *  1. the quality table is ordered by cost (moving up never turns a feature
 *     off, never shrinks a buffer, never lowers a count);
 *  2. the broadcast LUT keeps black black, white white, grey neutral and skin
 *     on its own hue;
 *  3. dynamic resolution drops when frames are late and climbs back slowly;
 *  4. the BoutPresentation built from a loaded bout has the right glove for
 *     the ruleset and red/blue corners in a 1v1;
 *  5. the presenter calls the modules in the documented order, snaps on a
 *     discontinuity, and falls back to placeholders when a factory returns
 *     null or throws;
 *  6. presenting a bout never writes to a sim frame (deep-frozen frames).
 */
import { describe, expect, it } from 'vitest';
import { Scene } from 'three/webgpu';
import {
  ARCHETYPES, DEFAULT_SETTINGS, createSim, resolveParams, deriveRuntime, resolveRuleset,
  type SimConfig, type TickSnapshot,
} from '../src/sim';
import {
  QUALITY_LEVELS, QUALITY_PRESETS, STAGE_TUNING, qualitySettings, defaultQualityFor,
} from '../src/presentation/stage/quality';
import { gradeColor, hueSat, buildLutData, LUT_SIZE } from '../src/presentation/stage/lut';
import { DynamicResolution, FrameMeter } from '../src/presentation/stage/dynres';
import {
  buildBoutPresentation, cornerColoursFor, gloveFor, CORNER_BLUE, CORNER_RED,
} from '../src/presentation/stage/bout';
import { togglesFor } from '../src/presentation/stage/pipeline';
import { createPresenter, lodFor, type PresenterDeps, type StageLike } from '../src/presentation/presenter';
import { DebugSkeletonActor } from '../src/presentation/placeholders/debugSkeleton';
import type {
  Animator, ArenaSet, BoutPresentation, CameraDirector, CameraState, CharacterActor, CharacterFactory,
  FrameInput, QualitySettings,
} from '../src/presentation/contract';
import { BONE_COUNT, createPose, defaultRest, type Pose } from '../src/presentation/rig/skeleton';
import { Group } from 'three';

const ARCH = Object.values(ARCHETYPES);

function config(seed = 'stage-suite', over: Partial<SimConfig> = {}): SimConfig {
  return {
    seed,
    mode: '1v1',
    fighters: [ARCH[0], ARCH[1]],
    teams: { teamOf: [0, 1] },
    ruleset: 'mma.unified.3r',
    arena: 'octagon_30',
    settings: DEFAULT_SETTINGS,
    ...over,
  };
}

function boutFor(cfg: SimConfig): BoutPresentation {
  const params = resolveParams(cfg.paramOverrides);
  return buildBoutPresentation({
    config: cfg,
    fighters: cfg.fighters,
    runtimes: cfg.fighters.map((f) => deriveRuntime(f, params, { explain: false })),
  });
}

/** A few seconds of a real bout: enough frames to interpolate between. */
function frames(cfg: SimConfig, n = 40): TickSnapshot[] {
  const sim = createSim(cfg);
  const out = [sim.snapshot()];
  for (let i = 0; i < n && sim.step(); i++) out.push(sim.snapshot());
  return out;
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

function input(frame: TickSnapshot, next: TickSnapshot | null, over: Partial<FrameInput> = {}): FrameInput {
  return {
    frame, next, alpha: 0.5, simTime: frame.t, events: [], playbackRate: 1, replay: false,
    discontinuity: false, ...over,
  };
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function fakeStage(log: string[]): StageLike {
  return {
    backend: 'webgpu',
    scene: new Scene() as unknown as StageLike['scene'],
    quality: qualitySettings('high'),
    setQuality: () => log.push('stage.setQuality'),
    applyShadowPolicy: () => undefined,
    resize: () => undefined,
    setCameraState: (s: CameraState) => log.push(`stage.camera${s.cut ? ':cut' : ''}`),
    setReplay: () => undefined,
    cut: () => log.push('stage.cut'),
    frameTiming: () => undefined,
    render: () => log.push('stage.render'),
    warmUp: () => undefined,
    info: () => ({ drawCalls: 1, triangles: 2, internalWidth: 3, internalHeight: 4 }),
    dispose: () => log.push('stage.dispose'),
  };
}

function fakeModules(log: string[]): Omit<PresenterDeps, 'createStage' | 'now'> {
  const arena: ArenaSet = {
    object3d: new Group(),
    bounds: { fightRadiusM: 5, outerRadiusM: 10, ceilingM: 8 },
    environment: null,
    update: () => log.push('arena.update'),
    setQuality: () => log.push('arena.setQuality'),
    dispose: () => log.push('arena.dispose'),
  };
  const actor = (i: number): CharacterActor => ({
    fighterId: i,
    object3d: new Group(),
    rest: defaultRest(),
    applyPose: () => log.push(`char${i}.applyPose`),
    setVisualState: () => log.push(`char${i}.visual`),
    setLOD: () => log.push(`char${i}.lod`),
    dispose: () => log.push(`char${i}.dispose`),
  });
  const factory: CharacterFactory = {
    preload: async () => { log.push('char.preload'); },
    create: (_b, i) => actor(i),
  };
  const animator: Animator = {
    setBout: () => log.push('anim.setBout'),
    evaluate: (_in, _dt, out: Pose[]) => { log.push(`anim.evaluate:${out.length}`); },
    reset: () => log.push('anim.reset'),
    debug: () => ({ layer: 'x', technique: null, phase: 0, ikTargets: [], tierRules: [] }),
  };
  const camera: CameraDirector = {
    setBout: () => log.push('camera.setBout'),
    setRequest: () => log.push('camera.setRequest'),
    update: () => {
      log.push('camera.update');
      return { position: [0, 3, 8], target: [0, 1, 0], fovDeg: 35, rollRad: 0, focusM: 8, dof: 0, cut: false, shotName: 'WIDE' };
    },
    reset: () => log.push('camera.reset'),
  };
  return {
    createArenaSet: async () => arena,
    createCharacterFactory: () => factory,
    createAnimator: () => animator,
    createCameraDirector: () => camera,
  };
}

const nullModules: Omit<PresenterDeps, 'createStage' | 'now'> = {
  createArenaSet: async () => null,
  createCharacterFactory: () => null,
  createAnimator: () => null,
  createCameraDirector: () => null,
};

const host = {} as HTMLElement;

// ---------------------------------------------------------------------------
// 1. Quality table
// ---------------------------------------------------------------------------

describe('quality presets', () => {
  const rank = { off: 0, hard: 1, soft: 2, sprites: 1, instanced: 2 } as const;

  it('has one preset per level, each labelled with its own level', () => {
    expect(QUALITY_LEVELS).toEqual(['low', 'medium', 'high', 'ultra']);
    for (const l of QUALITY_LEVELS) expect(QUALITY_PRESETS[l].level).toBe(l);
  });

  it('never gets cheaper going up a level', () => {
    for (let i = 1; i < QUALITY_LEVELS.length; i++) {
      const lo = QUALITY_PRESETS[QUALITY_LEVELS[i - 1]];
      const hi = QUALITY_PRESETS[QUALITY_LEVELS[i]];
      const why = `${lo.level} -> ${hi.level}`;
      expect(rank[hi.shadows], why).toBeGreaterThanOrEqual(rank[lo.shadows]);
      expect(hi.shadowMapSize, why).toBeGreaterThanOrEqual(lo.shadowMapSize);
      expect(hi.maxPixelRatio, why).toBeGreaterThanOrEqual(lo.maxPixelRatio);
      expect(hi.crowdCount, why).toBeGreaterThanOrEqual(lo.crowdCount);
      expect(rank[hi.crowd], why).toBeGreaterThanOrEqual(rank[lo.crowd]);
      expect(hi.maxCharacterLOD, why).toBeLessThanOrEqual(lo.maxCharacterLOD);
      // Internal pixels grow within one reconstruction path (FXAA-native,
      // TAAU-upscaled); native Ultra out-renders everything below it.
      if (hi.upscale === lo.upscale) expect(hi.renderScale, why).toBeGreaterThanOrEqual(lo.renderScale);
      if (hi.level === 'ultra') expect(hi.renderScale, why).toBeGreaterThanOrEqual(Math.max(...QUALITY_LEVELS.map((l) => QUALITY_PRESETS[l].renderScale)));
      for (const f of ['ambientOcclusion', 'screenSpaceReflections', 'bloom', 'replayDepthOfField',
        'replayMotionBlur', 'skinScattering', 'sweatAndDamage'] as const) {
        if (lo[f]) expect(hi[f], `${why}: ${f}`).toBe(true);
      }
      expect(STAGE_TUNING[hi.level].aoResolution, why).toBeGreaterThanOrEqual(STAGE_TUNING[lo.level].aoResolution);
    }
  });

  it('keeps Low within a weak iGPU budget: FXAA only, no shadows, sprite crowd', () => {
    const low = QUALITY_PRESETS.low;
    expect(low.antialias).toBe('fxaa');
    expect(low.upscale).toBe('none');
    expect(low.shadows).toBe('off');
    expect(low.crowd).toBe('sprites');
    const t = togglesFor(low);
    expect(t).toMatchObject({ ao: false, ssr: false, bloom: false, aa: 'fxaa', dof: false, motionBlur: false });
  });

  it('renders High below native and reconstructs it with TAAU', () => {
    const high = QUALITY_PRESETS.high;
    expect(high.renderScale).toBeGreaterThanOrEqual(0.6);
    expect(high.renderScale).toBeLessThanOrEqual(0.8);
    expect(togglesFor(high).aa).toBe('taau');
    expect(QUALITY_PRESETS.ultra.renderScale).toBe(1);
  });

  it('clamps a render-scale override and falls back a level on WebGL2', () => {
    expect(qualitySettings('high', 5).renderScale).toBe(1);
    expect(qualitySettings('high', 0.01).renderScale).toBeGreaterThan(0.3);
    expect(qualitySettings('high', 0.65).renderScale).toBe(0.65);
    expect(qualitySettings('high').renderScale).toBe(QUALITY_PRESETS.high.renderScale);
    expect(defaultQualityFor('webgpu')).toBe('high');
    expect(defaultQualityFor('webgl2')).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
// 2. Colour grade
// ---------------------------------------------------------------------------

describe('broadcast LUT', () => {
  it('keeps black black and white white', () => {
    expect(gradeColor(0, 0, 0)).toEqual([0, 0, 0]);
    const w = gradeColor(1, 1, 1);
    for (const c of w) expect(c).toBeCloseTo(1, 3);
  });

  it('keeps mid-grey neutral and adds contrast around it', () => {
    const [r, g, b] = gradeColor(0.5, 0.5, 0.5);
    expect(Math.abs(r - g)).toBeLessThan(0.01);
    expect(Math.abs(b - g)).toBeLessThan(0.01);
    const dark = gradeColor(0.3, 0.3, 0.3)[1];
    const light = gradeColor(0.7, 0.7, 0.7)[1];
    expect(light - dark).toBeGreaterThan(0.4);
  });

  it('cools the deep shadows a touch', () => {
    const [r, , b] = gradeColor(0.1, 0.1, 0.1);
    expect(b).toBeGreaterThan(r);
    expect(b - r).toBeLessThan(0.04);
  });

  it('keeps skin on its hue (light and dark tones)', () => {
    for (const skin of [[0.86, 0.64, 0.52], [0.42, 0.27, 0.19]] as const) {
      const before = hueSat(skin[0], skin[1], skin[2]);
      const after = hueSat(...gradeColor(skin[0], skin[1], skin[2]));
      expect(Math.abs(after.hue - before.hue)).toBeLessThan(3);
      expect(after.sat / before.sat).toBeLessThan(1.08);
    }
  });

  it('fills a 32³ RGBA8 LUT whose corners are the identity endpoints', () => {
    const d = buildLutData();
    expect(d.length).toBe(LUT_SIZE ** 3 * 4);
    expect([d[0], d[1], d[2]]).toEqual([0, 0, 0]);
    const last = d.length - 4;
    expect(d[last]).toBeGreaterThan(250);
    expect(d[last + 3]).toBe(255);
  });
});

// ---------------------------------------------------------------------------
// 3. Dynamic resolution and the frame meter
// ---------------------------------------------------------------------------

describe('dynamic resolution', () => {
  it('drops quickly when frames are late and climbs back slowly', () => {
    const dr = new DynamicResolution(0.7, { min: 0.6, max: 0.8 });
    for (let i = 0; i < 60; i++) dr.sample(33.3);
    expect(dr.scale).toBeLessThan(0.7);
    const dropped = dr.scale;
    for (let i = 0; i < 60; i++) dr.sample(16.6);
    expect(dr.scale).toBe(dropped); // one second of good frames is not enough
    for (let i = 0; i < 2000; i++) dr.sample(16.6);
    expect(dr.scale).toBeGreaterThan(dropped);
    expect(dr.scale).toBeLessThanOrEqual(0.8);
  });

  it('never leaves its range and ignores hitches', () => {
    const dr = new DynamicResolution(0.7, { min: 0.6, max: 0.8 });
    for (let i = 0; i < 5000; i++) dr.sample(100);
    expect(dr.scale).toBe(0.6);
    dr.sample(5000);
    expect(dr.scale).toBe(0.6);
  });

  it('meters fps from frame intervals', () => {
    const m = new FrameMeter();
    for (let i = 0; i <= 60; i++) m.tick(i * 20);
    expect(m.fps).toBeCloseTo(50, 5);
    expect(m.frameMs).toBeCloseTo(20, 5);
  });
});

// ---------------------------------------------------------------------------
// 4. BoutPresentation
// ---------------------------------------------------------------------------

describe('BoutPresentation from a loaded bout', () => {
  it('puts the ruleset glove on the hands', () => {
    expect(gloveFor(resolveRuleset('mma.unified.3r'))).toBe('mma4oz');
    expect(gloveFor(resolveRuleset('mma.amateur'))).toBe('mma4oz');
    expect(gloveFor(resolveRuleset('boxing.pro'))).toBe('boxing10oz');
    expect(gloveFor(resolveRuleset('muay_thai.abc'))).toBe('boxing10oz');
    expect(gloveFor(resolveRuleset('grappling.adcc'))).toBe('grappling');
    expect(gloveFor(resolveRuleset('judo.ijf'))).toBe('grappling');
    expect(gloveFor(resolveRuleset('street'))).toBe('bare');
    expect(gloveFor({ family: 'boxing', gloves: { oz: 16, fingerless: false, bareKnuckle: false } })).toBe('boxing16oz');
  });

  it('dresses a 1v1 in red and blue, fighter 0 in the red corner', () => {
    const b = boutFor(config());
    expect(b.cornerColours).toEqual([CORNER_RED, CORNER_BLUE]);
    expect(b.glove).toBe('mma4oz');
    expect(b.rulesetId).toBe('mma.unified.3r');
    expect(b.arena.id).toBe('octagon_30');
    expect(b.blood).toBe(true);
    expect(b.cosmeticSeed).toBe('cosmetic:stage-suite');
    expect(b.fighters.length).toBe(2);
    expect(b.runtimes.length).toBe(2);
  });

  it('gives teammates one colour and teams distinct colours', () => {
    const c = cornerColoursFor([0, 1, 1, 1], 4);
    expect(c[0]).toBe(CORNER_RED);
    expect(c[1]).toBe(CORNER_BLUE);
    expect(c[2]).toBe(c[1]);
    const three = cornerColoursFor([0, 1, 2], 3);
    expect(new Set(three).size).toBe(3);
  });

  it('honours the blood setting', () => {
    const b = boutFor(config('b', { settings: { ...DEFAULT_SETTINGS, blood: false } }));
    expect(b.blood).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Presenter composition
// ---------------------------------------------------------------------------

describe('presenter', () => {
  const cfg = config();
  const bout = boutFor(cfg);
  const fr = frames(cfg);

  it('runs animator -> characters -> FK -> arena -> camera, then renders', async () => {
    const log: string[] = [];
    const p = createPresenter({ ...fakeModules(log), createStage: async () => fakeStage(log), now: () => 0 });
    await p.mount(host);
    await p.setBout(bout);
    expect(p.modules).toEqual({ arena: 'module', character: 'module', anim: 'module', camera: 'module' });
    log.length = 0;
    p.update(input(fr[10], fr[11]), 1 / 60);
    p.render();
    expect(p.trace).toEqual(['animator', 'characters', 'fk', 'arena', 'camera', 'lod']);
    const at = (s: string): number => log.indexOf(s);
    expect(at('anim.evaluate:2')).toBeGreaterThanOrEqual(0);
    expect(at('anim.evaluate:2')).toBeLessThan(at('char0.applyPose'));
    expect(at('char1.visual')).toBeLessThan(at('arena.update'));
    expect(at('arena.update')).toBeLessThan(at('camera.update'));
    expect(at('camera.update')).toBeLessThan(at('stage.camera'));
    expect(at('stage.camera')).toBeLessThan(at('stage.render'));
    expect(log).not.toContain('anim.reset');
  });

  it('a quality switch compiles the new preset off the frame loop (QA2 #2)', async () => {
    const log: string[] = [];
    const stage = fakeStage(log);
    let resolveCompile: () => void = () => undefined;
    stage.precompile = () => { log.push('stage.precompile'); return new Promise<void>((r) => { resolveCompile = r; }); };
    const p = createPresenter({ ...fakeModules(log), createStage: async () => stage, now: () => 0 });
    await p.mount(host);
    await p.setBout(bout);
    log.length = 0;
    p.setQuality('ultra');
    expect(log).toContain('stage.setQuality');
    expect(log).toContain('stage.precompile');
    // The post chains are warmed only once the scene's programs are built.
    expect(log).not.toContain('stage.render');
    resolveCompile();
    await p.qualityWarmUp;
    expect(log.indexOf('stage.render')).toBeGreaterThan(log.indexOf('stage.precompile'));
  });

  it('snaps every filter on a discontinuity and cuts the temporal history', async () => {
    const log: string[] = [];
    const p = createPresenter({ ...fakeModules(log), createStage: async () => fakeStage(log), now: () => 0 });
    await p.mount(host);
    await p.setBout(bout);
    log.length = 0;
    p.update(input(fr[20], fr[21], { discontinuity: true }), 0);
    expect(log.slice(0, 3)).toEqual(['anim.reset', 'camera.reset', 'stage.cut']);
    expect(p.trace[0]).toBe('reset');
  });

  it('falls back to placeholders when every factory returns null', async () => {
    const log: string[] = [];
    const p = createPresenter({ ...nullModules, createStage: async () => fakeStage(log), now: () => 0 });
    await p.mount(host);
    await p.setBout(bout);
    expect(p.modules).toEqual({ arena: 'placeholder', character: 'placeholder', anim: 'placeholder', camera: 'placeholder' });
    p.update(input(fr[10], fr[11]), 1 / 60);
    const shot = p.shot();
    expect(shot).not.toBeNull();
    expect(shot!.position[1]).toBeGreaterThan(2); // the high-side wide
    // The placeholder animator stands each fighter at its recorded position.
    const poses = p.currentPoses;
    expect(poses.length).toBe(2);
    for (let i = 0; i < 2; i++) {
      const f = fr[10].fighters[i];
      const g = fr[11].fighters[i];
      expect(poses[i].rootPos[0]).toBeCloseTo((f.x + g.x) / 2, 5);
      expect(poses[i].rootPos[2]).toBeCloseTo((f.z + g.z) / 2, 5);
      expect(poses[i].rootPos[1]).toBeGreaterThan(0.3);
    }
    expect(p.stats().backend).toBe('webgpu');
  });

  it('falls back per module when a factory throws or its preload fails', async () => {
    const log: string[] = [];
    const mods = fakeModules(log);
    const p = createPresenter({
      ...mods,
      createAnimator: () => { throw new Error('half-written'); },
      createCharacterFactory: () => ({ preload: async () => { throw new Error('404'); }, create: () => { throw new Error('unused'); } }),
      createStage: async () => fakeStage(log),
      now: () => 0,
    });
    await p.mount(host);
    await p.setBout(bout);
    expect(p.modules).toEqual({ arena: 'module', character: 'placeholder', anim: 'placeholder', camera: 'module' });
    p.update(input(fr[5], fr[6]), 1 / 60);
    expect(p.trace).toContain('camera');
  });

  it('builds tidy debug skeletons: one skinned draw per fighter, fingers folded into the glove', () => {
    const a = new DebugSkeletonActor(0, { corner: '#c8262f', glove: 'mma4oz' });
    const mesh = a.object3d.children[0] as unknown as { isSkinnedMesh: boolean; geometry: { getAttribute(n: string): { count: number } } };
    expect(mesh.isSkinnedMesh).toBe(true);
    expect(mesh.geometry.getAttribute('skinIndex').count).toBe(mesh.geometry.getAttribute('position').count);
    const pose = createPose();
    pose.rootPos.set([1, 0.95, 2]);
    a.applyPose(pose);
    expect(a.world.pos[0]).toBeCloseTo(1, 5);
    expect(a.world.pos.length).toBe(BONE_COUNT * 3);
    a.dispose();
  });

  it('chooses LOD by distance without exceeding the preset cap', () => {
    expect(lodFor(3, 0)).toBe(0);
    expect(lodFor(12, 0)).toBe(1);
    expect(lodFor(3, 1)).toBe(1);
    expect(lodFor(100, 0)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 6. Presentation never changes the fight
// ---------------------------------------------------------------------------

describe('presenting a bout never writes to the sim', () => {
  it('runs a full update over deep-frozen frames with every placeholder', async () => {
    const cfg = config('frozen');
    const fr = frames(cfg, 60);
    const before = JSON.stringify(fr);
    fr.forEach((f) => deepFreeze(f));
    const bout = deepFreeze(boutFor(cfg));
    const p = createPresenter({ ...nullModules, createStage: async () => fakeStage([]), now: () => 0 });
    await p.mount(host);
    await p.setBout(bout);
    for (let i = 0; i + 1 < fr.length; i++) {
      for (const alpha of [0, 0.5, 0.99]) {
        p.update(input(fr[i], fr[i + 1], { alpha, discontinuity: i === 0 }), 1 / 60);
        p.render();
      }
    }
    // Seek backwards and replay: still nothing written.
    p.update(input(fr[3], fr[4], { discontinuity: true, replay: true }), 1 / 60);
    expect(JSON.stringify(fr)).toBe(before);
  });
});
