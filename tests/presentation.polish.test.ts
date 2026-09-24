/**
 * Broadcast polish pass (docs/design/PHASE8_NOTES.md, "Broadcast polish pass"):
 * the referee's presentation state machine, camera occlusion and the
 * director's dodge around the referee, the knockdown cut exception, and the
 * referee's clothing cut.
 */
import { describe, expect, it } from 'vitest';
import {
  ARCHETYPES, ARENAS, DEFAULT_SETTINGS, resolveArena, simulate,
  type BoutRun, type SimConfig, type SimEvent, type TickSnapshot,
} from '../src/sim';
import type { BoutPresentation } from '../src/presentation/contract';
import {
  refereeDisplay, refereePlacement, RefereeTracker, MIN_CLEARANCE_M, type RefereeScene,
} from '../src/presentation/arena/referee';
import {
  chooseOperator, createCameraDirector, CUT_RULES, contactTime, makeCameraArena, planShots, standInPoints,
  StrikeIndex, TICK_S,
} from '../src/presentation/camera';
import {
  occlusion, standingCapsules, subjectSamples, bodyCapsules, OCCLUSION_LIMIT,
} from '../src/presentation/camera/occlusion';
import { sightLines } from '../src/presentation/camera/planner';
import { atAzimuth } from '../src/presentation/camera/math';
import { wallDistanceAt } from '../src/presentation/camera/geometry';
import { PLACEMENT } from '../src/presentation/camera/shots';
import { classifyVertices } from '../src/presentation/referee/clothing';
import { refereeDefinition } from '../src/presentation/referee';
import { B, createPose, createWorldPose, defaultRest, forwardKinematics } from '../src/presentation/rig/skeleton';

const arena = ARENAS.octagon_30;
const ev = (kind: string, tick: number, actor = 0, target = 1, detail: unknown = {}, subMs = 0): SimEvent =>
  ({ kind, tick, subMs, round: 1, actor, target, text: '', detail }) as unknown as SimEvent;

const scene = (over: Partial<RefereeScene & { tick: number }> = {}): RefereeScene & { tick: number } => ({
  tick: 1000,
  phase: 'round',
  fighters: [{ id: 0, x: -0.6, z: 0, posture: 'standing' }, { id: 1, x: 0.6, z: 0, posture: 'standing' }],
  engagements: [],
  referee: { state: 'watching' },
  ...over,
});

describe('referee: the presentation state follows the sim', () => {
  it('shows a sim separation only while there is something to separate', () => {
    // Clinched, nothing thrown: the break.
    const clinch = scene({
      referee: { state: 'separating' },
      fighters: [{ id: 0, x: -0.3, z: 0, posture: 'clinch' }, { id: 1, x: 0.3, z: 0, posture: 'clinch' }],
      engagements: [{ a: 0, b: 1, kind: 'clinch' }],
    });
    expect(refereeDisplay(clinch).state).toBe('separating');
    expect(refereePlacement(clinch, arena, 10).gesture).toBe('break');
    // A stale separating (doctor pause outliving the action) over ground work: watching, crouched.
    const ground = scene({
      referee: { state: 'separating' },
      fighters: [{ id: 0, x: -0.3, z: 0, posture: 'ground' }, { id: 1, x: 0.3, z: 0, posture: 'ground' }],
      engagements: [{ a: 0, b: 1, kind: 'ground' }],
    });
    expect(refereeDisplay(ground).state).toBe('watching');
    const g = refereePlacement(ground, arena, 10);
    expect(g.gesture).toBe('watch');
    expect(g.crouch).toBeGreaterThan(0.3);
    // Standing apart and trading: watching.
    const trading = scene({ referee: { state: 'separating' }, fighters: [
      { id: 0, x: -1.2, z: 0, posture: 'standing' }, { id: 1, x: 1.2, z: 0, posture: 'standing' }] });
    expect(refereeDisplay(trading, { events: [ev('strike', 997)] }).state).toBe('watching');
  });

  it('knockdown: over the downed fighter, hands out, not the break pose', () => {
    const s = scene({
      referee: { state: 'separating' },
      fighters: [{ id: 0, x: -0.5, z: 0.2, posture: 'standing' }, { id: 1, x: 0.8, z: 0, posture: 'down' }],
    });
    const d = refereeDisplay(s, { events: [ev('knockdown', 995, 0, 1)] });
    expect(d.state).toBe('knockdown');
    expect(d.focusId).toBe(1);
    const p = refereePlacement(s, arena, 10, Math.PI, { events: [ev('knockdown', 995, 0, 1)] });
    expect(p.gesture).toBe('ready');
    expect(p.focusId).toBe(1);
    expect(Math.hypot(p.x - 0.8, p.z)).toBeLessThan(1.7);
    for (const f of s.fighters) expect(Math.hypot(p.x - f.x, p.z - f.z)).toBeGreaterThanOrEqual(MIN_CLEARANCE_M - 1e-6);
    // Up again: close, watching him, for a moment.
    const up = scene({ tick: 1020 });
    expect(refereeDisplay(up, { events: [ev('knockdown', 995, 0, 1)] }).state).toBe('standingUp');
    expect(refereeDisplay(scene({ tick: 1060 }), { events: [ev('knockdown', 995, 0, 1)] }).state).toBe('watching');
  });

  it('follows break calls, warnings, counts and the finish', () => {
    expect(refereeDisplay(scene(), { events: [ev('refereeBreak', 995, -1, 0, { reason: 'clinch' })] }).state).toBe('separating');
    expect(refereeDisplay(scene(), { events: [ev('refereeWarning', 994, -1, 1)] }).state).toBe('warning');
    expect(refereeDisplay(scene({ referee: { state: 'counting', target: 1, count: 3 } })).state).toBe('counting');
    // Events after the frame's tick (the look-ahead) never start a state early.
    expect(refereeDisplay(scene(), { events: [ev('refereeBreak', 1003, -1, 0)] }).state).toBe('watching');
    // The end: he raises the winner's hand, beside the winner.
    const end = scene({ phase: 'ended', fighters: [
      { id: 0, x: -0.4, z: 0, posture: 'standing' }, { id: 1, x: 0.5, z: 0.3, posture: 'out' }] });
    const events = [ev('refereeStoppage', 1000, -1, 0), ev('fighterOut', 1000, 1, -1)];
    const d = refereeDisplay(end, { events });
    expect(d).toEqual({ state: 'raisingHand', focusId: 0, otherId: 1 });
    const p = refereePlacement(end, arena, 10, Math.PI, { events });
    expect(p.gesture).toBe('raise');
    expect(Math.hypot(p.x + 0.4, p.z)).toBeLessThan(1.3);
    // A decision names its winner in the detail.
    expect(refereeDisplay(end, { events: [ev('decision', 1000, -1, -1, { winner: 1 })] }).focusId).toBe(1);
  });

  it('never shows the break pose over ground work or a downed fighter in a real bout', () => {
    const config: SimConfig = {
      seed: 'watch-demo-5', mode: '1v1', fighters: [Object.values(ARCHETYPES)[1]!, Object.values(ARCHETYPES)[2]!],
      teams: { teamOf: [0, 1] }, ruleset: 'mma.unified.3r', arena: 'octagon_30', settings: DEFAULT_SETTINGS,
    };
    const run = simulate(config, { record: true }) as BoutRun & { frames: TickSnapshot[] };
    const tr = new RefereeTracker(arena, undefined, Math.PI);
    let wi = 0;
    let ei = 0;
    let checked = 0;
    const evs = run.events;
    for (const f of run.frames) {
      while (ei < evs.length && evs[ei]!.tick <= f.tick) ei++;
      while (wi < ei && evs[wi]!.tick <= f.tick - 20) wi++;
      const p = tr.update(f, f.t, TICK_S, checked === 0, { events: evs.slice(wi, ei) });
      checked++;
      const busy = f.fighters.some((x) => x.posture === 'down' || x.posture === 'ground')
        || f.engagements.some((e) => e.kind !== 'clinch');
      if (busy && f.phase === 'round') expect(p.gesture, `tick ${f.tick}`).not.toBe('break');
    }
    expect(checked).toBeGreaterThan(500);
  });
});

describe('camera occlusion', () => {
  const fighter = standInPoints({
    tick: 0, t: 0, round: 1, roundTime: 0, phase: 'round', engagements: [], referee: { state: 'watching' },
    fighters: [{ id: 0, x: 0, z: 0, facing: 0, posture: 'standing', vx: 0, vz: 0 }],
  } as unknown as TickSnapshot, null, 0, 0);

  it('measures the share of the subject a capsule hides', () => {
    const cam: [number, number, number] = [0, 1.55, -6];
    expect(occlusion(cam, subjectSamples(fighter), standingCapsules(0, -2.5))).toBeGreaterThan(0.9);
    expect(occlusion(cam, subjectSamples(fighter), standingCapsules(1.2, -2.5))).toBe(0);
    // A referee behind the fighter hides nothing.
    expect(occlusion(cam, subjectSamples(fighter), standingCapsules(0, 2))).toBe(0);
    // A posed body works too.
    const w = createWorldPose();
    const pose = createPose();
    pose.rootPos.set([0, defaultRest().head[B.hips * 3 + 1]!, -2.5]);
    forwardKinematics(w, pose, defaultRest());
    expect(occlusion(cam, subjectSamples(fighter), bodyCapsules(w))).toBeGreaterThan(0.5);
  });

  it('the planner picks a handheld spot the referee is not standing in front of', () => {
    const ca = makeCameraArena(resolveArena('octagon_30'));
    const frame = {
      tick: 100, t: 10, round: 1, roundTime: 10, phase: 'round', engagements: [], referee: { state: 'watching' },
      fighters: [
        { id: 0, x: -0.5, z: 1.5, facing: Math.PI / 2, posture: 'standing', vx: 0, vz: 0 },
        { id: 1, x: 0.5, z: 1.5, facing: -Math.PI / 2, posture: 'standing', vx: 0, vz: 0 },
      ],
    } as unknown as TickSnapshot;
    const free = chooseOperator(ca, frame, [], 's', 'x', undefined, { referee: null });
    // Put the referee between that spot and fighter 0.
    const spot = atAzimuth(free, wallDistanceAt(ca, free) + PLACEMENT.handheldOutsideM);
    const ref = { x: spot[0] * 0.5 - 0.5 * 0.5, z: spot[2] * 0.5 + 1.5 * 0.5, crouch: 0 };
    const lines = sightLines(frame, [], { referee: ref });
    const camAt = (az: number): [number, number, number] => {
      const p = atAzimuth(az, wallDistanceAt(ca, az) + PLACEMENT.handheldOutsideM);
      return [p[0], PLACEMENT.handheldHeightM, p[2]];
    };
    expect(occlusion(camAt(free), lines.samples, lines.occluders)).toBeGreaterThan(OCCLUSION_LIMIT);
    const avoided = chooseOperator(ca, frame, [], 's', 'x', undefined, { referee: ref });
    expect(avoided).not.toBeCloseTo(free, 3);
    expect(occlusion(camAt(avoided), lines.samples, lines.occluders)).toBeLessThanOrEqual(OCCLUSION_LIMIT);
  });

  it('the director walks a handheld (and slides the hard camera) around a referee in the way', () => {
    const list = Object.values(ARCHETYPES);
    const config: SimConfig = {
      seed: 'polish', mode: '1v1', fighters: [list[0]!, list[1]!], teams: { teamOf: [0, 1] },
      ruleset: 'mma.unified.3r', arena: 'octagon_30', settings: DEFAULT_SETTINGS,
    };
    const pres: BoutPresentation = {
      fighters: config.fighters, runtimes: [], teamOf: [0, 1], arena: resolveArena('octagon_30'),
      rulesetId: 'mma.unified.3r', glove: 'mma4oz', cornerColours: ['#c8262f', '#2a5bb8'], blood: false,
      cosmeticSeed: 'cosmetic:polish',
    };
    // One behind the other as the hard camera sees them (the case where a
    // referee near the pair hides both torsos from the high camera).
    const ca = makeCameraArena(resolveArena('octagon_30'));
    const main = atAzimuth(ca.mainAzimuth, ca.mainRadius);
    const dl = Math.hypot(main[0], main[2] + 0.1);
    const ux = -main[0] / dl;
    const uz = -(main[2] + 0.1) / dl;
    const frame = {
      tick: 100, t: 10, round: 1, roundTime: 10, phase: 'round', engagements: [], referee: { state: 'watching' },
      fighters: [
        { id: 0, x: 0, z: -0.1, facing: 0, posture: 'standing', vx: 0, vz: 0, actionStage: 'idle' },
        { id: 1, x: ux * 1.0, z: -0.1 + uz * 1.0, facing: Math.PI, posture: 'standing', vx: 0, vz: 0, actionStage: 'idle' },
      ],
    } as unknown as TickSnapshot;
    for (const kind of ['cageside', 'main'] as const) {
      const d = createCameraDirector({ aspect: 16 / 9 });
      d.setBout(pres, null);
      d.lockShot(kind);
      const input = (disc: boolean) => ({
        frame, next: null, alpha: 0, simTime: 10, events: [], playbackRate: 1, replay: false, discontinuity: disc,
      });
      const first = d.update(input(true), [], 1 / 30);
      // A referee on the line from that lens to fighter 0 (close to him for the high hard camera).
      const pos = first.position;
      const t = kind === 'main' ? 0.88 : 0.5;
      const rx = pos[0] + (0 - pos[0]) * t;
      const rz = pos[2] + (-0.1 - pos[2]) * t;
      const w = createWorldPose();
      const pose = createPose();
      pose.rootPos.set([rx, defaultRest().head[B.hips * 3 + 1]!, rz]);
      forwardKinematics(w, pose, defaultRest());
      // Without the dodge he would hide more than the limit.
      const ids = new Set([0, 1]);
      void ids;
      d.setReferee(w);
      d.update(input(true), [], 1 / 30);
      expect(d.debug().occlusion, kind).toBeLessThanOrEqual(OCCLUSION_LIMIT);
      expect(Math.abs(d.debug().avoid[0]) + Math.abs(d.debug().avoid[1]), kind).toBeGreaterThan(0);
      // Deterministic: the same inputs dodge the same way.
      const d2 = createCameraDirector({ aspect: 16 / 9 });
      d2.setBout(pres, null);
      d2.lockShot(kind);
      d2.setReferee(w);
      expect(d2.update(input(true), [], 1 / 30).position).toEqual(d.update(input(true), [], 1 / 30).position);
    }
    void config;
  });
});

describe('knockdown cut exception', () => {
  it('the dropping strike is guarded by its exact contact, every other strike by ±6 ticks', () => {
    const idx = new StrikeIndex([ev('strike', 100, 0, 1, {}, 40), ev('strike', 120, 0, 1, {}, 0)]);
    expect(idx.nearExcept(104, 98, 100)).toBe(false); // the exempt strike alone
    expect(idx.nearExcept(115, 98, 100)).toBe(true); // 120 is not exempt
    expect(idx.latestContactIn(98, 100)).toBeCloseTo(10.04, 6);
  });

  it('cuts to the falling fighter 0.4-0.5 s after the punch, never nearer any strike', () => {
    const list = Object.values(ARCHETYPES);
    const ca = makeCameraArena(resolveArena('octagon_30'));
    for (const seed of ['camkd-0-1-4', 'cam-2', 'watch-demo-5']) {
      const [a, b] = seed === 'watch-demo-5' ? [1, 2] : [0, 1];
      const config: SimConfig = {
        seed, mode: '1v1', fighters: [list[a]!, list[b]!], teams: { teamOf: [0, 1] },
        ruleset: 'mma.unified.3r', arena: 'octagon_30', settings: DEFAULT_SETTINGS,
      };
      const run = simulate(config, { record: true }) as BoutRun & { frames: TickSnapshot[] };
      const plan = planShots(run.frames, run.events, { arena: ca, seed });
      const strikes = run.events.filter((e) => e.kind === 'strike');
      for (const e of plan.entries) {
        if (e.reason !== 'knockdown') continue;
        const kd = run.events.find((x) => x.kind === 'knockdown' && x.tick <= e.startTick && e.startTick - x.tick <= 35)!;
        expect(kd).toBeTruthy();
        // No earlier than the window allows, and at least 0.4 s after every contact.
        expect(e.startTick - kd.tick).toBeGreaterThanOrEqual(Math.round(CUT_RULES.kdCutWindowS[0] / TICK_S));
        for (const s of strikes) {
          const exempt = s.tick >= kd.tick - CUT_RULES.kdStrikeLookbackTicks && s.tick <= kd.tick;
          if (exempt) expect(e.startT - contactTime(s)).toBeGreaterThanOrEqual(CUT_RULES.strikeGuardS - 1e-9);
          else expect(Math.abs(e.startTick - s.tick)).toBeGreaterThan(CUT_RULES.strikeGuardTicks);
        }
      }
    }
  });
});

describe('referee clothing', () => {
  it('cuts shirt, trousers and shoes by bone and leaves head, forearms and hands bare', () => {
    const names = ['Hips', 'Spine', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot'];
    const joints: Record<string, [number, number, number]> = {
      Hips: [0, 1, 0], Spine: [0, 1.1, 0], Neck: [0, 1.5, 0], Head: [0, 1.6, 0],
      LeftArm: [0.2, 1.45, 0], LeftForeArm: [0.45, 1.2, 0], LeftHand: [0.65, 1.0, 0],
      LeftUpLeg: [0.1, 0.95, 0], LeftLeg: [0.1, 0.5, 0], LeftFoot: [0.1, 0.08, 0],
    };
    const verts: [string, [number, number, number]][] = [
      ['Spine', [0, 1.2, 0.1]], ['Head', [0, 1.7, 0.1]], ['LeftArm', [0.25, 1.4, 0]], ['LeftArm', [0.43, 1.22, 0]],
      ['LeftForeArm', [0.5, 1.15, 0]], ['LeftHand', [0.65, 1.0, 0]], ['LeftUpLeg', [0.1, 0.8, 0]],
      ['LeftLeg', [0.1, 0.3, 0]], ['LeftLeg', [0.1, 0.1, 0]], ['LeftFoot', [0.1, 0.02, 0.1]], ['Neck', [0, 1.52, 0]],
    ];
    const pos = verts.flatMap(([, p]) => p);
    const si = verts.flatMap(([n]) => [names.indexOf(n), 0, 0, 0]);
    const sw = verts.flatMap(() => [1, 0, 0, 0]);
    const c = classifyVertices(pos, si, sw, names, (i) => joints[names[i]!]!);
    expect(c.garment).toEqual(['shirt', null, 'shirt', null, null, null, 'trousers', 'trousers', 'shoes', 'shoes', 'shirt']);
    for (let v = 0; v < verts.length; v++) if (c.garment[v]) expect(c.offset[v]).toBeGreaterThan(0.004);
  });

  it('the referee definition is a neutral, bare-handed official, the same for a bout every time', () => {
    const pres = {
      fighters: [Object.values(ARCHETYPES)[0]!], cosmeticSeed: 'cosmetic:x',
    } as unknown as BoutPresentation;
    const a = refereeDefinition(pres)!;
    expect(a.body.heightM).toBeCloseTo(1.8, 6);
    expect(a.appearance.tattooPlacements).toEqual([]);
    expect(a.appearance.handWrapColor).toBeUndefined();
    expect(JSON.stringify(refereeDefinition(pres))).toBe(JSON.stringify(a));
  });
});
