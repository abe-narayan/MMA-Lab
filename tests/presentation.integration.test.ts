/**
 * INTEGRATION SUITE — the Phase 8 modules wired together (docs/design/PHASE8_NOTES.md,
 * "Integration (lead)").
 *
 *  1. importing the animator registers the grappling solver, and on a real
 *     bout's ground frames the pair is posed by it, not by the fallback;
 *  2. `FrameInput.events` reach through the next frame's tick;
 *  3. the presenter seeds the arena from the bout and hands a broadcast
 *     director the whole recording and the replay on air;
 *  4. a seek (or a replay jump) produces exactly one discontinuity frame;
 *  5. the referee gets a body: posed from the placement, on the floor, clear
 *     of the fighters, crouched over ground work;
 *  6. none of it writes to a sim frame.
 */
import { describe, expect, it, vi } from 'vitest';
import { Group, Scene } from 'three/webgpu';
import {
  ARCHETYPES, DEFAULT_SETTINGS, createSim, deriveRuntime, eventWindow, resolveParams,
  type SimConfig, type SimEvent, type TickSnapshot,
} from '../src/sim';
import { createAnimator } from '../src/presentation/anim';
import { grappleSolver } from '../src/presentation/anim/grappleApi';
import { buildBoutPresentation } from '../src/presentation/stage/bout';
import { qualitySettings } from '../src/presentation/stage/quality';
import { createPresenter, hardCameraAngle, type PresenterDeps, type StageLike } from '../src/presentation/presenter';
import { createCameraDirector, planReplays, ReplaySequencer } from '../src/presentation/camera';
import type { ArenaSet, BoutPresentation, CameraState, FrameInput } from '../src/presentation/contract';
import { B, createPose, createWorldPose, defaultRest, forwardKinematics, type Pose } from '../src/presentation/rig/skeleton';
import { RefereeAnimator, refereeRest, arenaReferee } from '../src/presentation/referee';
import { refereePlacement } from '../src/presentation/arena/referee';
import { BoutPlayer } from '../src/app/replay/player';
import { EventIndex, SeekDetector, advanceBroadcast, manualReplayPlan } from '../src/app/replay/broadcast';

const ARCH = Object.values(ARCHETYPES);

function config(seed = 'watch-demo'): SimConfig {
  return {
    seed, mode: '1v1', fighters: [ARCH[0], ARCH[1]], teams: { teamOf: [0, 1] },
    ruleset: 'mma.unified.3r', arena: 'octagon_30', settings: DEFAULT_SETTINGS,
  };
}

function boutFor(cfg: SimConfig): BoutPresentation {
  const params = resolveParams(cfg.paramOverrides);
  return buildBoutPresentation({
    config: cfg, fighters: cfg.fighters,
    runtimes: cfg.fighters.map((f) => deriveRuntime(f, params, { explain: false })),
  });
}

/** The demonstration bout's first `n` ticks (it takes the fight down at ~tick 340). */
function record(cfg: SimConfig, n: number): { frames: TickSnapshot[]; events: SimEvent[] } {
  const sim = createSim(cfg);
  const frames = [sim.snapshot()];
  for (let i = 0; i < n && sim.step(); i++) frames.push(sim.snapshot());
  return { frames, events: [...sim.events] };
}

function input(frame: TickSnapshot, next: TickSnapshot | null, events: readonly SimEvent[], over: Partial<FrameInput> = {}): FrameInput {
  return {
    frame, next, alpha: 0.5, simTime: frame.t + 0.05, events, playbackRate: 1, replay: false,
    discontinuity: false, ...over,
  };
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

function fakeStage(): StageLike {
  return {
    backend: 'webgpu',
    scene: new Scene() as unknown as StageLike['scene'],
    quality: qualitySettings('high'),
    setQuality: () => undefined,
    applyShadowPolicy: () => undefined,
    resize: () => undefined,
    setCameraState: (_s: CameraState) => undefined,
    setReplay: () => undefined,
    cut: () => undefined,
    frameTiming: () => undefined,
    render: () => undefined,
    warmUp: () => undefined,
    info: () => ({ drawCalls: 1, triangles: 2, internalWidth: 3, internalHeight: 4 }),
    dispose: () => undefined,
  };
}

function fakeArena(): ArenaSet {
  return {
    object3d: new Group(),
    bounds: { fightRadiusM: 5, outerRadiusM: 12, ceilingM: 10 },
    environment: null,
    update: () => undefined,
    setQuality: () => undefined,
    dispose: () => undefined,
  };
}

// 'watch-demo-5' (Phase 9, engine 5.0.0): the calibrated sim takes this
// demonstration bout down at ~tick 340; the old 'watch-demo' seed now ends by
// a standing KO before any ground frame.
const cfg = config('watch-demo-5');
const bout = boutFor(cfg);
const rec = record(cfg, 520);
const groundIdx = rec.frames.findIndex((f) => f.engagements.some((e) => e.kind === 'ground'));

// ---------------------------------------------------------------------------

describe('grappling solver registration', () => {
  it('is registered once the animator module is imported', () => {
    expect(grappleSolver()).not.toBeNull();
  });

  it('poses a real bout\'s ground frames through the solver, not the fallback', () => {
    expect(groundIdx).toBeGreaterThan(0);
    const anim = createAnimator();
    anim.setBout(bout, [defaultRest(), defaultRest()]);
    const out: Pose[] = [createPose(), createPose()];
    let solved = 0;
    for (let i = groundIdx; i < groundIdx + 40 && i + 1 < rec.frames.length; i++) {
      const f = rec.frames[i];
      anim.evaluate(input(f, rec.frames[i + 1], eventWindow(rec.events, f.tick - 20, f.tick + 1).events, {
        discontinuity: i === groundIdx,
      }), 1 / 60, out);
      const layer = anim.debug(f.engagements[0]?.a ?? 0).layer;
      if (!f.engagements.some((e) => e.kind === 'ground')) continue;
      expect(layer).not.toContain('fallback');
      if (layer.startsWith('grapple ')) solved++;
    }
    expect(solved).toBeGreaterThan(10);
  });
});

describe('FrameInput.events look-ahead', () => {
  it('reaches through the next frame\'s tick and matches the sim\'s window convention', () => {
    const idx = new EventIndex(rec.events);
    const withNext = rec.frames.findIndex((f, i) => i > 25 && rec.events.some((e) => e.tick === f.tick + 1));
    expect(withNext).toBeGreaterThan(0);
    const f = rec.frames[withNext];
    const n = rec.frames[withNext + 1];
    const got = idx.forFrame(f, n);
    expect(got).toEqual(eventWindow(rec.events, f.tick - 20, n.tick).events);
    expect(got.some((e) => e.tick === n.tick)).toBe(true);
    expect(got.every((e) => e.tick > f.tick - 20)).toBe(true);
    // Cached: the same frame pair returns the same array.
    expect(idx.forFrame(f, n)).toBe(got);
  });
});

describe('presenter wiring', () => {
  it('seeds the arena from the bout and hands the broadcast director the recording and replay', async () => {
    const director = createCameraDirector();
    const setRecording = vi.spyOn(director, 'setRecording');
    const setReplay = vi.spyOn(director, 'setReplay');
    const createArenaSet = vi.fn<PresenterDeps['createArenaSet']>(async () => fakeArena());
    const p = createPresenter({
      createStage: async () => fakeStage(),
      createArenaSet,
      createCharacterFactory: () => null,
      createAnimator: () => createAnimator(),
      createCameraDirector: () => director,
      now: () => 0,
    });
    await p.mount({ clientWidth: 1600, clientHeight: 900 } as HTMLElement);
    p.setRecording(rec.frames, rec.events);
    await p.setBout(bout);
    expect(createArenaSet).toHaveBeenCalledTimes(1);
    expect(createArenaSet.mock.calls[0][2]).toEqual({
      cosmeticSeed: bout.cosmeticSeed, cornerColours: bout.cornerColours, hardCameraAngle: hardCameraAngle(bout),
    });
    expect(Math.abs(hardCameraAngle(bout))).toBeGreaterThan(3); // MAIN sits at 6 o'clock (-z)
    expect(setRecording).toHaveBeenCalledWith(rec.frames, rec.events);
    expect(director.plan).not.toBeNull();

    const plans = planReplays(rec.events, rec.frames);
    const seq = new ReplaySequencer(plans);
    p.setReplay(seq.state);
    expect(setReplay).toHaveBeenLastCalledWith(null);

    p.update(input(rec.frames[100], rec.frames[101], [], { discontinuity: true }), 1 / 60);
    expect(p.animLayers().length).toBe(2);
    await p.warmUpAsync(); // a stage without precompile still warms
    p.dispose();
  });

  it('never writes to a sim frame, referee included', async () => {
    const fr = rec.frames.slice(groundIdx - 5, groundIdx + 20).map((f) => structuredClone(f));
    const before = JSON.stringify(fr);
    fr.forEach((f) => deepFreeze(f));
    const p = createPresenter({
      createStage: async () => fakeStage(),
      createArenaSet: async () => null,
      createCharacterFactory: () => null,
      createAnimator: () => createAnimator(),
      createCameraDirector: () => createCameraDirector(),
      now: () => 0,
    });
    await p.mount({ clientWidth: 1600, clientHeight: 900 } as HTMLElement);
    await p.setBout(deepFreeze(boutFor(config())));
    for (let i = 0; i + 1 < fr.length; i++) p.update(input(fr[i], fr[i + 1], [], { discontinuity: i === 0 }), 1 / 60);
    expect(JSON.stringify(fr)).toBe(before);
    p.dispose();
  });
});

describe('seek and replay discontinuities', () => {
  it('a seek is exactly one discontinuity frame', () => {
    const d = new SeekDetector();
    const seen: boolean[] = [];
    let version = 0;
    for (const tick of [10, 10, 11, 11, 12]) seen.push(d.next(tick, version));
    // The host moves the playhead and bumps the version in the same instant.
    version++;
    for (const tick of [800, 800, 801, 801]) seen.push(d.next(tick, version));
    // A small step back (frame stepping) is still a seek.
    version++;
    seen.push(d.next(799, version));
    seen.push(d.next(799, version));
    expect(seen).toEqual([true, false, false, false, false, true, false, false, false, true, false]);
  });

  it('a replay starting, changing angle and ending each count as one jump', () => {
    const player = new BoutPlayer({ frames: rec.frames, events: rec.events });
    const plan = manualReplayPlan(
      { fromTick: 100, toTick: 110, speed: 0.5, label: 'test', eventIndex: -1 }, rec.events,
    );
    plan.segments.push({ ...plan.segments[0], shot: 'overhead', fromTick: 104, toTick: 110 });
    const seq = new ReplaySequencer([]);
    player.seekTick(300);
    player.play();
    seq.play(plan, player);
    expect(player.tick).toBe(100);
    const jumps: number[] = [];
    for (let i = 0; i < 200 && (seq.state || i === 0); i++) {
      const { jumped } = advanceBroadcast(player, seq, 0.05);
      if (jumped) jumps.push(player.tick);
    }
    // Angle 1 → angle 2 (back to tick 104), then back to live at 300.
    expect(jumps).toEqual([104, 300]);
    expect(seq.state).toBeNull();
  });
});

describe('referee body', () => {
  it('stands on the floor, clear of the fighters, and crouches over ground work', () => {
    const rest = refereeRest();
    const anim = new RefereeAnimator(rest);
    const worlds = [createWorldPose(), createWorldPose()];
    const poses = [createPose(), createPose()];
    const check = (f: TickSnapshot, snap: boolean): { crouch: number; hipsY: number } => {
      for (let i = 0; i < 2; i++) {
        poses[i].rootPos.set([f.fighters[i].x, f.fighters[i].posture === 'ground' ? 0.3 : 0.95, f.fighters[i].z]);
        forwardKinematics(worlds[i], poses[i], defaultRest());
      }
      const placement = refereePlacement(f, bout.arena, f.t);
      const pose = anim.evaluate({ placement, fighters: worlds, realDt: 1 / 30, simDt: 1 / 30, snap });
      const w = createWorldPose();
      forwardKinematics(w, pose, rest);
      for (let k = 0; k < w.pos.length; k++) expect(Number.isFinite(w.pos[k])).toBe(true);
      // Feet on the canvas.
      for (const foot of [B.lFoot, B.rFoot]) {
        expect(w.pos[foot * 3 + 1]).toBeGreaterThan(0.02);
        expect(w.pos[foot * 3 + 1]).toBeLessThan(0.25);
      }
      // Never inside a fighter.
      for (const fi of f.fighters) expect(Math.hypot(w.pos[0] - fi.x, w.pos[2] - fi.z)).toBeGreaterThan(0.6);
      return { crouch: placement.crouch, hipsY: w.pos[B.hips * 3 + 1] };
    };
    const standing = check(rec.frames[50], true);
    const ground = check(rec.frames[groundIdx + 30], true);
    expect(ground.crouch).toBeGreaterThan(standing.crouch);
    expect(ground.hipsY).toBeLessThan(standing.hipsY - 0.1);
  });

  it('walks only while he moves', () => {
    const anim = new RefereeAnimator(refereeRest());
    const f = rec.frames[50];
    const base = refereePlacement(f, bout.arena, f.t);
    anim.evaluate({ placement: base, fighters: [], realDt: 1 / 60, simDt: 1 / 60, snap: true });
    for (let i = 1; i <= 30; i++) {
      anim.evaluate({ placement: { ...base, x: base.x + i * 0.025 }, fighters: [], realDt: 1 / 60, simDt: 1 / 60, snap: false });
    }
    expect(anim.speed).toBeGreaterThan(0.5);
    const phase = anim.phase;
    for (let i = 0; i < 60; i++) {
      anim.evaluate({ placement: { ...base, x: base.x + 0.75 }, fighters: [], realDt: 1 / 60, simDt: 1 / 60, snap: false });
    }
    expect(anim.phase).toBeCloseTo(phase, 6);
    expect(anim.speed).toBeLessThan(0.05);
  });

  it('reads the placement from a set that computes one, and none from a set that does not', () => {
    expect(arenaReferee(fakeArena())).toBeUndefined();
    const withRef = { ...fakeArena(), referee: null };
    expect(arenaReferee(withRef)).toBeNull();
  });
});
