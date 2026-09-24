/**
 * Animation quality pass (docs/design/PHASE8_NOTES.md, "Animation quality
 * pass"): the QA harness of `scripts/dev/anim-audit-lib.ts` run on a short
 * stretch of a real recorded bout and on targeted synthetic timelines, with
 * bounds on the metrics the pass improved — planted-foot sliding, one-frame
 * pose pops, joint limits, the stance order of the feet, the post-fight clinch
 * break and the captured get-up / celebration. The full audit (eight bouts,
 * several rulesets and tiers, one 2v2) is `scripts/dev/anim-audit.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { SimEvent, TickSnapshot } from '../src/sim';
import { StandingAnimator } from '../src/presentation/anim/animator';
import { archetype, buildScenario, frameAt, type SynthBout } from '../src/presentation/anim/synth';
import { registerMotionLibrary } from '../src/presentation/anim/capture';
import { headCentre } from '../src/presentation/anim/clearance';
import { FinishStage, finishTimeline, clinchEnd, CLINCH_BREAK_M } from '../src/presentation/finish';
import { B, createPose, createWorldPose, forwardKinematics, type Pose, type WorldPose } from '../src/presentation/rig/skeleton';
import { audit, loadMotion, recordBout, type AuditResult, type Recording } from '../scripts/dev/anim-audit-lib';

const lib = loadMotion();
const FRAME = 1000 / 60;

function asRecording(sb: SynthBout, name: string): Recording {
  return { spec: { name, seed: name, ruleset: 'mma.unified.3r', fighters: [] }, cfg: null as never, ...sb };
}

const pct = (a: number, b: number): number => (b > 0 ? (100 * a) / b : 0);

describe('QA harness on a recorded bout', () => {
  // The opening minute of a real bout (the sim is being tuned, so only bounds
  // that hold for any plausible bout are asserted).
  const rec = recordBout({ name: 'qa', seed: 'anim-quality-1', ruleset: 'mma.unified.3r', fighters: ['arch.champion_complete', 'arch.regional_pro_allrounder'] });
  const end = Math.min(60, rec.frames[rec.frames.length - 1]!.t);
  let r: AuditResult;
  it('runs the pipeline and measures every category', () => {
    r = audit(rec, { windows: [[0, end]], post: 0, motion: lib });
    expect(r.frames).toBeGreaterThan(end * 55);
    expect(r.footSlide.standing.n).toBeGreaterThan(100);
    expect(r.jointFrames).toBeGreaterThan(0);
  });
  it('planted feet barely slide while standing', () => {
    const s = r.footSlide.standing;
    expect(pct(s.over, s.n)).toBeLessThan(7); // was 9.3 % over 0.5 cm/frame before the pass
    expect(s.mean).toBeLessThan(0.2);
  });
  it('no neck past its range and no knee past 160° while standing', () => {
    const standingJoint = (k: string): number => Object.entries(r.jointHist)
      .filter(([key]) => key.startsWith(`${k}:standing:`)).reduce((a, [, v]) => a + v, 0);
    expect(standingJoint('neckYaw')).toBe(0);
    expect(standingJoint('neckRoll')).toBe(0);
    expect(standingJoint('kneeOverflex')).toBe(0);
  });
  it('one-frame pose pops are rare while standing', () => {
    const min = r.fighterFrames.standing / 60 / 60;
    expect((r.pops.rot.standing + r.pops.trans.standing) / Math.max(1e-6, min)).toBeLessThan(150);
  });
});

describe('footwork', () => {
  it('stop-go recorded motion does not jolt the hips (the root path is continuous in velocity)', () => {
    // The sim moves in 100 ms steps that start and stop: 2.3 m/s, then 0, then 2.3 m/s.
    const moves = [];
    for (let k = 0; k < 20; k++) moves.push({ fighter: 0, fromMs: 800 + k * 200, toMs: 900 + k * 200, vx: k % 2 ? 2.3 : 0, vz: k % 2 ? 0 : 2.3 });
    const sb = buildScenario({
      fighters: [archetype('arch.champion_complete'), archetype('arch.regional_pro_allrounder')],
      stances: ['orthodox', 'orthodox'], start: [[-2, -2], [2, 2]], durationMs: 5200, actions: [], moves,
    });
    const r = audit(asRecording(sb, 'stopgo'), { post: 0, motion: lib });
    expect(r.pops.trans.standing).toBeLessThanOrEqual(2);
    expect(r.footSlide.standing.pct(0.99)).toBeLessThan(2);
  });

  it('a trained rear foot never lands in front of the lead foot after a sudden stop', () => {
    const sb = buildScenario({
      fighters: [archetype('arch.champion_complete'), archetype('arch.regional_pro_allrounder')],
      stances: ['orthodox', 'orthodox'], start: [[0, -2.5], [0, 2.5]], durationMs: 4000, actions: [],
      moves: [{ fighter: 0, fromMs: 600, toMs: 1500, vx: 0, vz: 1.9 }],
    });
    const an = new StandingAnimator({ motion: lib });
    an.setBout(sb.bout, sb.rests);
    const out = [createPose(), createPose()];
    let worst = Infinity;
    for (let t = 0; t <= 3900; t += FRAME) {
      an.evaluate(frameAt(sb, t, t === 0), FRAME / 1000, out);
      const st = an.fighterState(0)!;
      if (st.feet[0].swing || st.feet[1].swing) continue;
      // Orthodox: the left (lead) ball ahead of the right along the facing (+z here).
      worst = Math.min(worst, st.feet[0].ball[2] - st.feet[1].ball[2]);
    }
    expect(worst).toBeGreaterThan(0.05);
  });
});

describe('actions end without a snap', () => {
  it('a round kick\'s leg comes home without a one-frame jump', () => {
    const sb = buildScenario({
      fighters: [archetype('arch.thai_striker'), archetype('arch.regional_pro_allrounder')],
      stances: ['orthodox', 'orthodox'], start: [[0, 0], [0, 1.3]], durationMs: 3000,
      actions: [{ fighter: 0, technique: 'tech.kick_body_rear', commitMs: 1037, result: 'blocked', defence: 'def.block' }],
    });
    const r = audit(asRecording(sb, 'kick'), { post: 0, motion: lib });
    // After the kick (back in the stance layer) the leg comes home with no spike;
    // the forearm no longer flips at the wrap of its pronation either.
    const pops = (re: RegExp): number => Object.entries(r.popHist).filter(([k]) => re.test(k)).reduce((a, [, v]) => a + v, 0);
    expect(pops(/(Thigh|Shin):L0/)).toBe(0);
    expect(pops(/Forearm/)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Post-fight: the clinch break, the captured get-up and celebration
// ---------------------------------------------------------------------------

const ev = (kind: string, tick: number, actor = -1, target = -1, detail: unknown = {}): SimEvent =>
  ({ kind, tick, subMs: 0, round: 1, actor, target, text: '', detail }) as unknown as SimEvent;

function play(sb: SynthBout, seconds: number, sample: (t: number, worlds: WorldPose[], fin: FinishStage) => void): void {
  const an = new StandingAnimator({ motion: lib });
  an.setBout(sb.bout, sb.rests);
  const fin = new FinishStage(sb.bout, sb.rests, null);
  fin.setRecording(sb.frames, sb.events);
  const poses: Pose[] = sb.rests.map(() => createPose());
  const worlds = sb.rests.map(() => createWorldPose());
  const endMs = sb.frames[sb.frames.length - 1]!.t * 1000;
  const dt = 1 / 60;
  let first = true;
  const step = (tMs: number): void => {
    const input = frameAt(sb, Math.min(tMs, endMs), first);
    const post = fin.clock(input, dt);
    an.evaluate(post !== null ? fin.animatorInput(input) : input, dt, poses);
    fin.apply(poses, null);
    for (let i = 0; i < poses.length; i++) forwardKinematics(worlds[i]!, poses[i]!, sb.rests[i]!);
    first = false;
  };
  for (let t = endMs - 1000; t < endMs; t += FRAME) step(t);
  for (let k = 0; k <= seconds * 60; k++) {
    step(endMs);
    sample(fin.postTime ?? 0, worlds, fin);
  }
}

/** A bout that ends with the pair tied up in a clinch (a TKO against the fence). */
function clinchStoppage(): SynthBout {
  const sb = buildScenario({
    fighters: [archetype('arch.champion_complete'), archetype('arch.regional_pro_allrounder')],
    stances: ['orthodox', 'orthodox'], start: [[0, -0.25], [0, 0.25]], durationMs: 2500, actions: [],
  });
  for (const f of sb.frames.slice(-6)) {
    f.engagements = [{
      a: 0, b: 1, node: 'pos.clinch_double_collar', sinceTick: sb.frames[0]!.tick, kind: 'clinch', cage: false, underhookOwner: null,
      kuzushi: { dir: 0, mag: 0 }, posture: 'chest', inflight: null, rootX: 0, rootZ: 0, rootYaw: 0,
    }] as TickSnapshot['engagements'];
    for (const x of f.fighters) x.posture = 'clinch';
  }
  const last = sb.frames[sb.frames.length - 1]!;
  last.phase = 'ended';
  const end = last.tick;
  sb.events.push(ev('refereeStoppage', end, -1, 0, { method: 'tko_strikes' }), ev('fighterOut', end, 1, -1), ev('boutEnd', end, -1, -1, { method: 'tko' }));
  return sb;
}

describe('post-fight: the clinch stoppage', () => {
  it('is recognised and the referee\'s break opens the pair within ~0.7 s', () => {
    const sb = clinchStoppage();
    expect(clinchEnd(sb.frames)?.half).toBeGreaterThan(0.3);
    registerMotionLibrary(null);
    let chestAt08 = 0;
    let minHead = Infinity;
    play(sb, 1.2, (t, w) => {
      const ca = w[0]!.pos.subarray(B.spine2 * 3, B.spine2 * 3 + 3);
      const cb = w[1]!.pos.subarray(B.spine2 * 3, B.spine2 * 3 + 3);
      if (Math.abs(t - 0.8) < 0.009) chestAt08 = Math.hypot(ca[0]! - cb[0]!, ca[2]! - cb[2]!);
      const ha = headCentre(w[0]!), hb = headCentre(w[1]!);
      minHead = Math.min(minHead, Math.hypot(ha[0] - hb[0], ha[1] - hb[1], ha[2] - hb[2]));
    });
    // Chest to chest (~0.3 m) at the stoppage; apart by 0.8 s.
    expect(chestAt08).toBeGreaterThan(0.75);
    expect(chestAt08).toBeLessThan(CLINCH_BREAK_M + 0.3);
    expect(minHead).toBeGreaterThan(0.19);
  });
});

function koStoppage(): SynthBout {
  const sb = buildScenario({
    fighters: [archetype('arch.champion_complete'), archetype('arch.regional_pro_allrounder')],
    stances: ['orthodox', 'orthodox'], start: [[-0.5, 0.4], [0.6, 0.2]], durationMs: 4000,
    actions: [{ fighter: 0, technique: 'tech.hook_lead', commitMs: 1037, result: 'landed', knockdown: 'ko', downMs: 60000 }],
  });
  const last = sb.frames[sb.frames.length - 1]!;
  last.phase = 'ended';
  last.fighters[1]!.posture = 'out';
  const end = last.tick;
  sb.events.push(ev('refereeStoppage', end, -1, 0, { method: 'ko' }), ev('fighterOut', end, 1, -1, { method: 'ko' }), ev('boutEnd', end, -1, -1, { method: 'ko' }));
  return sb;
}

describe('post-fight: captured get-up and celebration', () => {
  it('the knocked-out man gets up from the capture, never through the canvas, and the winner celebrates from the capture', () => {
    registerMotionLibrary(lib);
    try {
      const sb = koStoppage();
      let lowest = Infinity;
      let headAtUp = 0;
      let headLying = Infinity;
      let handsOverHead = 0;
      let getup = false;
      let celebrate = false;
      const tl = finishTimeline({ kind: 'stoppage', method: 'ko', winner: 0, loser: 1, draw: false, endTick: 0, loserDown: true, ko: true, submission: false });
      play(sb, 11, (t, w, fin) => {
        const sc = (fin as unknown as { script: { getup: unknown; celebrate: unknown } | null }).script;
        getup ||= !!sc?.getup;
        celebrate ||= !!sc?.celebrate;
        const lw = w[1]!;
        for (const j of [B.lToe, B.rToe, B.lFoot, B.rFoot, B.lHand, B.rHand, B.hips]) lowest = Math.min(lowest, lw.pos[j * 3 + 1]!);
        const hy = headCentre(lw)[1];
        if (t > 1 && t < tl.sitUp![0] - 1) headLying = Math.min(headLying, hy);
        if (Math.abs(t - (tl.standUp![1] + 0.7)) < 0.009) headAtUp = hy;
        const ww = w[0]!;
        const hh = headCentre(ww)[1];
        if (t > tl.celebrate[0] + 0.7 && t < tl.celebrate[1] - 0.7 && Math.max(ww.pos[B.lHand * 3 + 1]!, ww.pos[B.rHand * 3 + 1]!) > hh) handsOverHead++;
      });
      expect(getup).toBe(true);
      expect(celebrate).toBe(true);
      expect(headLying).toBeLessThan(0.45);
      expect(headAtUp).toBeGreaterThan(1.35);
      expect(lowest).toBeGreaterThan(-0.01);
      expect(handsOverHead).toBeGreaterThan(30); // half a second of arms up at least
    } finally {
      registerMotionLibrary(null);
    }
  });
});
