/**
 * Finish and corner pass (docs/design/PHASE8_NOTES.md, "Finish and corner
 * pass"): the post-fight sequence (timing from the recorded result, the
 * referee's hand on the fighters' wrists, nobody walking through anybody), the
 * standing pair's head clearance after close hooks, and the cornermen (in
 * with the stool, out before the bell, clear of the fence).
 */
import { describe, expect, it } from 'vitest';
import type { SimEvent, TickSnapshot } from '../src/sim';
import { ARENAS } from '../src/sim';
import { StandingAnimator } from '../src/presentation/anim/animator';
import { archetype, buildScenario, frameAt, type SynthBout } from '../src/presentation/anim/synth';
import { HEAD_RADIUS_M, headCentre } from '../src/presentation/anim/clearance';
import {
  FINISH_REPLAY_DELAY_S, planShots, makeCameraArena, ReplaySequencer, type ReplayPlan,
} from '../src/presentation/camera';
import {
  FinishStage, finishResult, finishTimeline, gripGap, postShots, RAISE_S, MARK_GAP_M, type FinishResult,
} from '../src/presentation/finish';
import { RefereeAnimator } from '../src/presentation/referee/pose';
import { refereeRest } from '../src/presentation/referee';
import {
  B, createPose, createWorldPose, forwardKinematics, type Pose, type WorldPose,
} from '../src/presentation/rig/skeleton';
import { breakTiming, cornerSpots, crewCue, restState, type BreakWindow } from '../src/presentation/corner';
import { FigurePoser, footCycle } from '../src/presentation/people/figure';

const FRAME = 1 / 60;
const ev = (kind: string, tick: number, actor = -1, target = -1, detail: unknown = {}): SimEvent =>
  ({ kind, tick, subMs: 0, round: 1, actor, target, text: '', detail }) as unknown as SimEvent;

/** A synthetic bout that ends: a knockout (fighter 0 drops fighter 1), or a decision / draw. */
function endedBout(kind: 'ko' | 'tko-standing' | 'decision' | 'draw'): SynthBout {
  const ko = kind === 'ko';
  const sb = buildScenario({
    fighters: [archetype('arch.champion_complete'), archetype('arch.regional_pro_allrounder')],
    stances: ['orthodox', 'orthodox'], start: [[-0.5, 0.4], [0.6, 0.2]], durationMs: ko ? 4000 : 2500,
    actions: ko ? [{ fighter: 0, technique: 'tech.hook_lead', commitMs: 1037, result: 'landed', knockdown: 'ko', downMs: 60000 }] : [],
  });
  const last = sb.frames[sb.frames.length - 1]!;
  last.phase = 'ended';
  const end = last.tick;
  if (ko) {
    last.fighters[1]!.posture = 'out';
    sb.events.push(ev('refereeStoppage', end, -1, 0, { method: 'ko' }), ev('fighterOut', end, 1, -1, { method: 'ko' }), ev('boutEnd', end, -1, -1, { method: 'ko' }));
  } else if (kind === 'tko-standing') {
    sb.events.push(ev('refereeStoppage', end, -1, 0, { method: 'tko_strikes' }), ev('fighterOut', end, 1, -1), ev('boutEnd', end, -1, -1, { method: 'tko' }));
  } else {
    sb.events.push(ev('boutEnd', end, -1, -1, { method: kind === 'draw' ? 'decision.split' : 'decision.unanimous' }));
    sb.events.push(ev('decision', end, -1, -1, { method: 'decision.unanimous', winner: kind === 'draw' ? 'draw' : 1 }));
  }
  return sb;
}

interface PostFrame {
  t: number;
  worlds: WorldPose[];
  ref: WorldPose | null;
  refX: number;
  refZ: number;
  kneel: number;
}

/**
 * Play a bout's last second, then hold on the last frame for `seconds`, the
 * way the presenter does: post clock → animator (clock advanced) → finish
 * layer → forward kinematics → the referee from the script.
 */
function playPost(sb: SynthBout, seconds: number, sample: (f: PostFrame) => void): FinishStage {
  const an = new StandingAnimator({ motion: null });
  an.setBout(sb.bout, sb.rests);
  const refRest = refereeRest();
  const fin = new FinishStage(sb.bout, sb.rests, refRest);
  fin.setRecording(sb.frames, sb.events);
  const ref = new RefereeAnimator(refRest);
  const poses: Pose[] = sb.rests.map(() => createPose());
  const worlds = sb.rests.map(() => createWorldPose());
  const endMs = sb.frames[sb.frames.length - 1]!.t * 1000;
  let first = true;
  let lastPlace = null as ReturnType<FinishStage['refereePlacement']>;
  const step = (tMs: number, dt: number): void => {
    const input = frameAt(sb, Math.min(tMs, endMs), first);
    const post = fin.clock(input, dt);
    an.evaluate(post !== null ? fin.animatorInput(input) : input, dt, poses);
    fin.apply(poses, lastPlace);
    for (let i = 0; i < poses.length; i++) forwardKinematics(worlds[i]!, poses[i]!, sb.rests[i]!);
    const script = fin.refereeScript(worlds);
    let refW: WorldPose | null = null;
    if (script) {
      ref.evaluate({ placement: script.placement, fighters: worlds, realDt: dt, simDt: dt, snap: first, extra: script.extra });
      refW = ref.world;
      lastPlace = script.placement;
    }
    first = false;
    if (post !== null) {
      sample({ t: post, worlds, ref: refW, refX: script?.placement.x ?? NaN, refZ: script?.placement.z ?? NaN, kneel: script?.extra.kneel ?? 0 });
    }
  };
  for (let t = endMs - 1000; t < endMs; t += FRAME * 1000) step(t, FRAME);
  for (let k = 0; k <= Math.round(seconds / FRAME); k++) step(endMs, k === 0 ? 0 : FRAME);
  return fin;
}

const hipsXZ = (w: WorldPose): [number, number] => [w.pos[B.hips * 3]!, w.pos[B.hips * 3 + 2]!];
const dist2 = (a: [number, number], b: [number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('finish: the sequence follows the recorded result', () => {
  it('reads the result and orders the beats (stoppage, decision, draw)', () => {
    const ko = endedBout('ko');
    const r = finishResult(ko.frames, ko.events)!;
    expect(r).toMatchObject({ kind: 'stoppage', winner: 0, loser: 1, loserDown: true, ko: true });
    const tl = finishTimeline(r);
    expect(tl.wave![0]).toBe(0);
    expect(tl.walkOff[0]).toBeGreaterThan(tl.wave![0]);
    expect(tl.celebrate[0]).toBeGreaterThanOrEqual(tl.walkOff[1]);
    expect(tl.sitUp![0]).toBeGreaterThan(tl.wave![1]);
    expect(tl.standUp![0]).toBeGreaterThan(tl.sitUp![1]);
    expect(tl.regroup[0]).toBeGreaterThanOrEqual(tl.celebrate[1]);
    expect(tl.hold).toBeGreaterThan(tl.regroup[1]);
    expect(tl.raise).toBeGreaterThan(tl.hold);
    // The finish replay airs between the celebration and the walk to the centre.
    expect(tl.replayAt).toBe(FINISH_REPLAY_DELAY_S);
    expect(tl.replayAt!).toBeGreaterThanOrEqual(tl.celebrate[1]);
    expect(tl.replayAt!).toBeLessThanOrEqual(tl.regroup[0]);
    // A KO stays down longer than a TKO on the canvas; a standing TKO bends over instead.
    const tko: FinishResult = { ...r, ko: false };
    expect(finishTimeline(tko).sitUp![0]).toBeLessThan(tl.sitUp![0]);
    const st = endedBout('tko-standing');
    const rs = finishResult(st.frames, st.events)!;
    expect(rs.loserDown).toBe(false);
    expect(finishTimeline(rs).bentOver).not.toBeNull();

    const dec = endedBout('decision');
    const rd = finishResult(dec.frames, dec.events)!;
    expect(rd).toMatchObject({ kind: 'decision', winner: 1, loser: 0, draw: false });
    const td = finishTimeline(rd);
    expect(td.replayAt).toBeNull();
    expect(td.raises).toBe(true);
    expect(td.raise).toBeGreaterThan(td.hold);
    const draw = endedBout('draw');
    const rdr = finishResult(draw.frames, draw.events)!;
    expect(rdr).toMatchObject({ kind: 'decision', winner: -1, draw: true });
  });

  it('the post-roll edit cuts on the script\'s beats', () => {
    const sb = endedBout('ko');
    const ca = makeCameraArena(sb.bout.arena);
    const plan = planShots(sb.frames, sb.events, { arena: ca, seed: 's' });
    const r = finishResult(sb.frames, sb.events)!;
    const beats = postShots(r, finishTimeline(r));
    const post = plan.entries.filter((e) => e.reason === 'post');
    expect(post.map((e) => e.kind)).toEqual(beats.map((b) => b.kind));
    const end = sb.frames[sb.frames.length - 1]!.tick;
    post.forEach((e, i) => expect(e.startTick).toBeGreaterThanOrEqual(end + Math.round(beats[i]!.t / 0.1)));
    // The announcement is the hard camera on both fighters.
    expect([...post.find((e) => e.kind === 'mainTight')!.subjects].sort()).toEqual([0, 1]);
  });

  it('the finish replay waits for the live picture at the end', () => {
    const plan = { id: 'fin', airTick: 100, airReason: 'boutEnd', segments: [{ fromTick: 80, toTick: 100, speed: 0.3 }] } as unknown as ReplayPlan;
    const seq = new ReplaySequencer([plan]);
    let started = 0;
    const t = {
      tick: 99, playing: true, atEnd: false, inInstantReplay: false,
      startInstantReplay: () => { started++; t.inInstantReplay = true; }, stopInstantReplay: () => undefined,
    };
    seq.update(t as never, 0.1);
    t.tick = 100; t.playing = false; t.atEnd = true;
    seq.update(t as never, 0.1);
    expect(started).toBe(0);
    expect(seq.holding).toBe(true);
    for (let k = 0; k < Math.round((FINISH_REPLAY_DELAY_S - 0.5) / 0.1); k++) seq.update(t as never, 0.1);
    expect(started).toBe(0);
    for (let k = 0; k < 10; k++) seq.update(t as never, 0.1);
    expect(started).toBe(1);
  });
});

describe('finish: the referee raises the winner\'s hand', () => {
  it('holds both wrists (palm on wrist within 2 cm), then raises the winner\'s arm over his head', () => {
    const sb = endedBout('ko');
    let fin: FinishStage | null = null;
    const gaps: number[] = [];
    let raisedAbove = 0;
    let raisedFrames = 0;
    fin = playPost(sb, 20, (f) => {
      const tl = fin?.timeline ?? finishTimeline(finishResult(sb.frames, sb.events)!);
      if (!f.ref || f.t < tl.hold + 0.05) return;
      // Winner (0) on the referee's side -s, loser (1) on +s: find the hand pairs by proximity.
      for (const fi of [0, 1]) {
        const w = f.worlds[fi]!;
        let best = Infinity;
        for (const rh of [B.lHand, B.rHand]) for (const fh of [B.lHand, B.rHand]) best = Math.min(best, Math.abs(gripGap(f.ref, rh, w, fh)));
        gaps.push(best);
      }
      if (f.t > tl.raise + RAISE_S + 0.1) {
        raisedFrames++;
        const w = f.worlds[0]!;
        const top = Math.max(w.pos[B.lHand * 3 + 1]!, w.pos[B.rHand * 3 + 1]!);
        if (top > w.tip[B.head * 3 + 1]!) raisedAbove++;
      }
    });
    expect(gaps.length).toBeGreaterThan(100);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(0.02);
    expect(raisedFrames).toBeGreaterThan(30);
    expect(raisedAbove).toBe(raisedFrames);
  });

  it('decisions: both on their marks either side of the referee; a draw raises both', () => {
    for (const kind of ['decision', 'draw'] as const) {
      const sb = endedBout(kind);
      let checked = 0;
      let bothUp = 0;
      const fin = playPost(sb, 16, (f) => {
        const tl = finishTimeline(finishResult(sb.frames, sb.events)!);
        if (!f.ref || f.t < tl.hold + 0.1) return;
        const a = hipsXZ(f.worlds[0]!);
        const b = hipsXZ(f.worlds[1]!);
        const r: [number, number] = [f.refX, f.refZ];
        // Either side of him, about a mark's gap away, never in him.
        expect(dist2(a, r)).toBeGreaterThan(MARK_GAP_M * 0.75);
        expect(dist2(b, r)).toBeGreaterThan(MARK_GAP_M * 0.75);
        expect(dist2(a, b)).toBeGreaterThan(MARK_GAP_M * 1.5);
        checked++;
        if (f.t > tl.raise + RAISE_S + 0.2) {
          const up = (w: WorldPose): boolean => Math.max(w.pos[B.lHand * 3 + 1]!, w.pos[B.rHand * 3 + 1]!) > w.tip[B.head * 3 + 1]!;
          if (up(f.worlds[0]!) && up(f.worlds[1]!)) bothUp++;
        }
      });
      expect(checked, kind).toBeGreaterThan(60);
      if (kind === 'draw') expect(bothUp).toBeGreaterThan(30);
      else expect(bothUp).toBe(0);
      void fin;
    }
  });

  it('nobody walks through anybody during the post-roll', () => {
    const sb = endedBout('ko');
    let minStand = Infinity;
    let minHead = Infinity;
    let minRefToLying = Infinity;
    playPost(sb, 20, (f) => {
      const tl = finishTimeline(finishResult(sb.frames, sb.events)!);
      const w = hipsXZ(f.worlds[0]!);
      const l = hipsXZ(f.worlds[1]!);
      const lStanding = f.t >= tl.standUp![1];
      if (f.ref) {
        const r = hipsXZ(f.ref);
        minStand = Math.min(minStand, dist2(w, r));
        if (lStanding) minStand = Math.min(minStand, dist2(l, r));
        else minRefToLying = Math.min(minRefToLying, dist2(r, [f.worlds[1]!.pos[B.spine2 * 3]!, f.worlds[1]!.pos[B.spine2 * 3 + 2]!]));
        const hr = headCentre(f.ref);
        for (const fw of f.worlds) {
          const h = headCentre(fw);
          minHead = Math.min(minHead, Math.hypot(h[0] - hr[0], h[1] - hr[1], h[2] - hr[2]));
        }
      }
      if (lStanding) minStand = Math.min(minStand, dist2(w, l));
      // The winner never walks over the man on the canvas.
      if (!lStanding) {
        for (const bone of [B.hips, B.spine2, B.head, B.lFoot, B.rFoot]) {
          const p: [number, number] = [f.worlds[1]!.pos[bone * 3]!, f.worlds[1]!.pos[bone * 3 + 2]!];
          expect(dist2(w, p), `t ${f.t.toFixed(2)}`).toBeGreaterThan(0.35);
        }
      }
    });
    expect(minStand).toBeGreaterThan(0.45);
    expect(minHead).toBeGreaterThan(2 * HEAD_RADIUS_M);
    // He kneels beside the downed man, close but not in him.
    expect(minRefToLying).toBeGreaterThan(0.3);
    expect(minRefToLying).toBeLessThan(1.2);
  });

  it('is deterministic: the same recording and clock give the same poses', () => {
    const sb = endedBout('ko');
    const a: number[] = [];
    const b: number[] = [];
    playPost(sb, 18, (f) => { if (Math.abs(f.t % 1) < FRAME / 2) a.push(...f.worlds[0]!.pos.slice(0, 12), f.refX, f.refZ); });
    playPost(sb, 18, (f) => { if (Math.abs(f.t % 1) < FRAME / 2) b.push(...f.worlds[0]!.pos.slice(0, 12), f.refX, f.refZ); });
    expect(a.length).toBeGreaterThan(100);
    expect(a).toEqual(b);
  });
});

describe('standing pair: no head interpenetration after close hooks', () => {
  it('keeps the head spheres apart through and after contact', () => {
    let worst = Infinity;
    for (const tech of ['tech.hook_lead', 'tech.hook_rear', 'tech.hook_rear_body', 'tech.uppercut_lead']) {
      for (const d of [0.55, 0.7, 0.85]) {
        for (const result of ['landed', 'blocked'] as const) {
          const sb = buildScenario({
            fighters: [archetype('arch.champion_complete'), archetype('arch.regional_pro_allrounder')],
            stances: ['orthodox', 'orthodox'], start: [[0, 0], [0, d]], durationMs: 2600,
            actions: [{ fighter: 0, technique: tech, commitMs: 1037, result }],
          });
          const an = new StandingAnimator({ motion: null });
          an.setBout(sb.bout, sb.rests);
          const out = [createPose(), createPose()];
          let first = true;
          for (let t = 0; t <= 2600; t += FRAME * 1000) {
            an.evaluate(frameAt(sb, t, first), FRAME, out);
            first = false;
            const ha = headCentre(an.fighterState(0)!.world);
            const hb = headCentre(an.fighterState(1)!.world);
            const s = Math.min(an.fighterState(0)!.rig.scale, an.fighterState(1)!.rig.scale);
            worst = Math.min(worst, Math.hypot(ha[0] - hb[0], ha[1] - hb[1], ha[2] - hb[2]) / s);
          }
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(2 * HEAD_RADIUS_M);
  });
});

describe('corner: the cornermen', () => {
  const arena = ARENAS.octagon_30;
  const spots = cornerSpots(arena)!;
  const window: BreakWindow = {
    fromTick: 3000, toTick: 3600, endPos: [[0.4, -0.3], [-0.5, 0.6]], startPos: [[-1.2, 0], [1.2, 0]], startFacing: [Math.PI / 2, -Math.PI / 2],
  };
  const apothem = arena.apothemM ?? 4.57;
  /** Perpendicular distance to the nearest fence panel (octagon). */
  const toFence = (x: number, z: number): number => {
    let best = Infinity;
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + (2 * Math.PI * k) / 8;
      best = Math.min(best, apothem - (x * Math.sin(a) + z * Math.cos(a)));
    }
    return best;
  };

  it('come in with the stool, kneel with their man, and are gone (stool too) before the bell', () => {
    for (const corner of [0, 1] as const) {
      const spot = spots[corner];
      const bt = breakTiming(window, corner, spot);
      for (const solo of [false, true]) {
        const roles = solo ? (['cutman'] as const) : (['cutman', 'coach'] as const);
        let knelt = 0;
        let placedBeforeSit = false;
        for (let t = 0; t <= bt.len + 0.01; t += 0.05) {
          const fighter = restState(window, corner, spot, t);
          const cues = roles.map((r) => crewCue(spot, r, solo, bt, t));
          for (const c of cues) {
            if (!c.visible) continue;
            // Inside the cage, clear of the fence.
            expect(toFence(c.x, c.z), `t ${t.toFixed(2)}`).toBeGreaterThanOrEqual(0.3);
            // Clear of the fighter's body (hips) at all times.
            expect(Math.hypot(c.x - fighter.x, c.z - fighter.z), `t ${t.toFixed(2)} ${fighter.phase}`).toBeGreaterThan(0.42);
            if (c.kneel > 0.9) knelt++;
            if (c.stool && c.stool.y === 0 && fighter.phase === 'sitting') placedBeforeSit = true;
          }
          if (cues.length === 2 && cues[0]!.visible && cues[1]!.visible) {
            expect(Math.hypot(cues[0]!.x - cues[1]!.x, cues[0]!.z - cues[1]!.z)).toBeGreaterThan(0.5);
          }
        }
        expect(knelt, `corner ${corner} solo ${solo}`).toBeGreaterThan(40);
        expect(placedBeforeSit).toBe(true);
        // At the bell (and for the last 1.5 s) nobody from the corner is in the cage, nor is the stool.
        for (const t of [bt.len - 1.4, bt.len - 0.5, bt.len]) {
          for (const r of roles) {
            const c = crewCue(spot, r, solo, bt, t);
            expect(c.visible, `${r} at ${t}`).toBe(false);
            expect(c.stool).toBeNull();
          }
        }
      }
    }
  });

  it('the walk to the corner is a fighter\'s gait: planted feet do not slide', () => {
    const rest = endedBout('decision').rests[0]!;
    const poser = new FigurePoser(rest);
    const pose = createPose();
    const world = createWorldPose();
    // Walk straight along +Z at 1.2 m/s; the stance foot's ball must stay put.
    let maxSlide = 0;
    let prev: [number, number] | null = null;
    let prevPlanted = false;
    for (let t = 0.5; t < 3.5; t += FRAME) {
      const s = 1.2 * t;
      poser.evaluate({ x: 0, z: s, facing: 0, walked: s, speed: 1.2, style: 'fighter', time: t }, pose, world);
      const planted = footCycle(s, 0, 0.74 * rest.statureM / 1.733)[2] < 0;
      const f: [number, number] = [world.pos[B.lToe * 3]!, world.pos[B.lToe * 3 + 2]!];
      if (planted && prevPlanted && prev) maxSlide = Math.max(maxSlide, Math.hypot(f[0] - prev[0], f[1] - prev[1]));
      prev = f;
      prevPlanted = planted;
    }
    // Per frame: a planted foot rolls heel to toe but does not skate (< 1 cm per frame at 1.2 m/s = 2 cm).
    expect(maxSlide).toBeLessThan(0.01);
  });
});

// Keep the unused-import checker quiet for helper types used only in signatures.
void (null as unknown as TickSnapshot);
