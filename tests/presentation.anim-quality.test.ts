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
import { kneeAboveFloor } from '../src/presentation/anim/blend';
import { foldReach } from '../src/presentation/rig/ik';
import { buildRequest } from '../src/presentation/anim/grapple';
import { separatePoints } from '../src/presentation/finish';
import { restState } from '../src/presentation/corner';
import { clampPelvis } from '../src/presentation/anim/stance';
import { fistPoint, solveHand, worldP } from '../src/presentation/anim/spec';

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

// ---------------------------------------------------------------------------
// Animation quality pass 2 (docs/design/PHASE8_NOTES.md, "Animation quality
// pass 2"): contact at the instant, the IK's fold and floor limits, ground
// strikes, the post-submission rise, the corner walk and the walkers' spacing.
// ---------------------------------------------------------------------------

describe('pass 2: strikes touch what they hit', () => {
  it('landed and blocked punches and a kick end on the target surface at the recorded instant', () => {
    const sb = buildScenario({
      fighters: [archetype('arch.champion_complete'), archetype('arch.regional_pro_allrounder')],
      stances: ['orthodox', 'orthodox'], start: [[0, 0], [0, 1.25]], durationMs: 6000,
      actions: [
        { fighter: 0, technique: 'tech.jab', commitMs: 1037, result: 'landed' },
        { fighter: 0, technique: 'tech.cross', commitMs: 2037, result: 'blocked', defence: 'def.block_high' },
        { fighter: 1, technique: 'tech.hook_lead', commitMs: 3037, result: 'landed' },
        { fighter: 0, technique: 'tech.jab', commitMs: 4037, result: 'blocked', defence: 'def.block_high' },
        { fighter: 1, technique: 'tech.kick_low_rear', commitMs: 5037, result: 'landed', region: 'leadLeg' },
      ],
    });
    const r = audit(asRecording(sb, 'contact'), { post: 0, motion: lib });
    expect(r.contact.surface.n).toBe(5);
    // Before pass 2, blocked punches aimed at the glove's knuckle point, 8.5 cm
    // past the blocking arm, and the aim was taken before the defender's own
    // late corrections: a fifth of the audit's strikes ended > 5 cm off.
    expect(r.contact.surface.max).toBeLessThan(5);
  });
});

describe('pass 2: IK limits', () => {
  it('a knee under the canvas swings up about the hip-ankle line to the nearest clear angle', () => {
    const H: [number, number, number] = [0, 0.3, 0];
    const A: [number, number, number] = [0.6, 0.06, 0];
    const d = (p: readonly number[], q: readonly number[]): number => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
    // A leg lying on its side, the knee pointing out and a little under the canvas.
    const K: [number, number, number] = [0.3, 0.01, 0.3];
    const r = kneeAboveFloor(H, K, A, 0.045);
    expect(r.knee[1]).toBeGreaterThanOrEqual(0.045 - 1e-6);
    expect(r.lift).toBe(0);
    // Still a knee of the same leg: the bone lengths are kept.
    expect(Math.abs(d(r.knee, H) - d(K, H))).toBeLessThan(1e-6);
    expect(Math.abs(d(r.knee, A) - d(K, A))).toBeLessThan(1e-6);
    // A knee swept round under the leg (pointing straight down in the middle):
    // the answer changes continuously — no flip to the other side — and what
    // the swing cannot clear is made up by lifting the leg.
    const c: [number, number, number] = [0.3, 0.18, 0];
    const rad = 0.33;
    let prev: readonly number[] | null = null;
    let maxStep = 0;
    for (let k = -40; k <= 40; k++) {
      const a = (k * Math.PI) / 180;
      const Kk: [number, number, number] = [c[0], c[1] - rad * Math.cos(a), rad * Math.sin(a)];
      const rk = kneeAboveFloor(H, Kk, A, 0.045);
      expect(rk.knee[1] + rk.lift).toBeGreaterThan(0.045 - 1e-6);
      if (prev) maxStep = Math.max(maxStep, d(rk.knee, prev));
      prev = rk.knee;
    }
    expect(maxStep).toBeLessThan(0.05);
  });

  it('the elbow fold limit is soft, in target space, and never folds past 150°', () => {
    const L1 = 0.29, L2 = 0.26;
    const r150 = Math.sqrt(L1 * L1 + L2 * L2 + 2 * L1 * L2 * Math.cos(150 * Math.PI / 180));
    let prev: readonly number[] | null = null;
    let maxStep = 0;
    for (let k = 0; k <= 200; k++) {
      const r = 0.4 - k * 0.0017; // pulled in along a line toward the shoulder
      const t: [number, number, number] = [r * 0.8, r * 0.6, 0];
      const o = foldReach([0, 0, 0], t, L1, L2);
      expect(Math.hypot(o[0], o[1], o[2])).toBeGreaterThanOrEqual(r150 - 1e-6);
      if (prev) maxStep = Math.max(maxStep, Math.hypot(o[0] - prev[0]!, o[1] - prev[1]!, o[2] - prev[2]!));
      prev = o;
    }
    expect(maxStep).toBeLessThan(0.004); // continuous: no jump as it engages
  });
});

describe('pass 2: ground strikes', () => {
  it('a ground-and-pound hammerfist is one continuous motion of one hand across the tick boundaries', () => {
    // The sim reports the action with no stage and a start tick that follows
    // the clock; the contact instant only while it is pending, then the event.
    const fighter = (id: number, tick: number, pending: boolean): unknown => ({
      id, team: id, x: 0, z: 0, facing: 0, stance: 'orthodox', posture: 'ground', role: id === 0 ? 'top' : 'bottom',
      action: id === 0 ? 'tech.gnp_hammerfist' : 'idle', actionStage: 'none', actionPhase: 0,
      actionDetail: { startTick: tick, totalMs: 330, contactTick: pending ? 101 : tick, contactOffsetMs: pending ? 78 : 0, targetId: 1 },
      sub: { technique: null, stage: 0, progress: 0 }, states: [],
    });
    const frame = (tick: number): TickSnapshot => ({ tick, t: tick / 10, fighters: [fighter(0, tick, tick < 101), fighter(1, tick, false)], engagements: [] }) as unknown as TickSnapshot;
    const events = [{ kind: 'strike', tick: 101, subMs: 78, round: 1, actor: 0, target: 1, text: '', detail: { technique: 'tech.gnp_hammerfist', result: 'landed' } }] as unknown as SimEvent[];
    const e = { a: 0, b: 1, node: 'pos.ground_mount', kind: 'ground', cage: false, posture: 'none', inflight: null, rootX: 0, rootZ: 0, rootYaw: 0, kuzushi: { dir: 0, mag: 0 } };
    let lastPhase = -1;
    const sides = new Set<string>();
    let seen = 0;
    for (let ms = 9960; ms <= 10500; ms += 1000 / 60) {
      const tick = Math.floor(ms / 100);
      const fr = frame(tick);
      const input = { frame: fr, next: frame(tick + 1), alpha: (ms - tick * 100) / 100, simTime: ms / 1000, events, playbackRate: 1, replay: false, discontinuity: false };
      const req = buildRequest({ bout: { runtimes: [] }, input, engagement: e, nextEngagement: e, a: fr.fighters[0], b: fr.fighters[1] } as never, null);
      if (!req.strike) continue;
      seen++;
      sides.add(req.strike.side);
      expect(req.strike.phase).toBeGreaterThanOrEqual(lastPhase);
      lastPhase = req.strike.phase;
    }
    expect(seen).toBeGreaterThan(15);
    expect(sides.size).toBe(1);
  });
});

describe('pass 2: walkers and corners', () => {
  it('walkers passing through each other keep their side (no jump across)', () => {
    const memo = new Map<string, [number, number]>();
    let prev: [number, number] | null = null;
    let maxStep = 0;
    for (let k = 0; k <= 120; k++) {
      // Walks straight through a fixed referee at the origin.
      const p: [number, number] = [-1.2 + k * 0.02, 0.001];
      const q = separatePoints([[0, 0], p], [true, false], 0.58, [], memo)[1]!;
      expect(Math.hypot(q[0], q[1])).toBeGreaterThan(0.57);
      if (prev) maxStep = Math.max(maxStep, Math.hypot(q[0] - prev[0], q[1] - prev[1]));
      prev = q;
    }
    expect(maxStep).toBeLessThan(0.06);
  });

  it('the walk back from the corner turns to the opponent while stepping, not with a snap at the mark', () => {
    const w = { fromTick: 3000, toTick: 3600, endPos: [[0.4, -0.3], [-0.5, 0.6]] as [number, number][], startPos: [[-1.2, 0], [1.2, 0]] as [number, number][], startFacing: [Math.PI / 2, -Math.PI / 2] };
    const spot = { stool: [-3.2, -3.2], facing: Math.PI / 4 } as never;
    let prev: number | null = null;
    let maxTurn = 0;
    for (let t = 0; t <= 60; t += 1 / 60) {
      const s = restState(w, 0, spot, t);
      // The walk back to the mark and the wait for the bell.
      if (prev !== null && (s.phase === 'toCentre' || s.phase === 'waiting')) maxTurn = Math.max(maxTurn, Math.abs(Math.atan2(Math.sin(s.facing - prev), Math.cos(s.facing - prev))));
      prev = s.facing;
    }
    expect(maxTurn).toBeLessThan(0.12); // rad per frame (was a snap of up to π at the mark)
  });
});

/** A bout that ends in a submission on the ground: the winner, underneath, gets up. */
function submissionOnTheGround(): SynthBout {
  const sb = buildScenario({
    fighters: [archetype('arch.champion_complete'), archetype('arch.regional_pro_allrounder')],
    stances: ['orthodox', 'orthodox'], start: [[0.5, 1.6], [0.8, 1.8]], durationMs: 3000, actions: [],
  });
  const n = sb.frames.length;
  sb.frames.slice(n - 12, n - 1).forEach((f) => {
    f.engagements = [{
      a: 0, b: 1, node: 'pos.ground_half_flat', sinceTick: f.tick - 5, kind: 'ground', cage: false, underhookOwner: null,
      kuzushi: { dir: 0, mag: 0 }, posture: 'none', inflight: null, rootX: 0.65, rootZ: 1.7, rootYaw: 0.6,
    }] as unknown as TickSnapshot['engagements'];
    f.fighters[0]!.posture = 'ground'; f.fighters[0]!.role = 'bottom';
    f.fighters[1]!.posture = 'ground'; f.fighters[1]!.role = 'top';
  });
  const last = sb.frames[n - 1]!;
  last.phase = 'ended';
  last.engagements = [];
  last.fighters[0]!.posture = 'standing';
  last.fighters[1]!.posture = 'ground';
  const end = last.tick;
  sb.events.push(ev('submissionFinish', end, 0, 1, { technique: 'sub.guillotine_arm_in', type: 'tap' }), ev('boutEnd', end, -1, -1, { method: 'submission' }));
  return sb;
}

describe('pass 2: after a submission', () => {
  it('the winner slides out from under the loser and rises beside him, not through him', () => {
    registerMotionLibrary(null);
    const sb = submissionOnTheGround();
    let worst = 0;
    let jump = 0;
    let prevHips: readonly number[] | null = null;
    const P = (x: WorldPose, j: number): [number, number, number] => [x.pos[j * 3]!, x.pos[j * 3 + 1]!, x.pos[j * 3 + 2]!];
    const seg = (p: readonly number[], a0: readonly number[], a1: readonly number[]): number => {
      const ab = [a1[0]! - a0[0]!, a1[1]! - a0[1]!, a1[2]! - a0[2]!], ap = [p[0]! - a0[0]!, p[1]! - a0[1]!, p[2]! - a0[2]!];
      const u = Math.max(0, Math.min(1, (ab[0]! * ap[0]! + ab[1]! * ap[1]! + ab[2]! * ap[2]!) / Math.max(1e-9, ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2)));
      return Math.hypot(ap[0]! - ab[0]! * u, ap[1]! - ab[1]! * u, ap[2]! - ab[2]! * u);
    };
    play(sb, 1.6, (t, w) => {
      const a = w[0]!, b = w[1]!;
      // The audit's torso capsules (hips to neck, 12 cm): winner against loser.
      let dmin = Infinity;
      const ha = P(a, B.hips), na = P(a, B.neck);
      for (let k = 0; k <= 10; k++) {
        const q = [ha[0] + (na[0] - ha[0]) * k / 10, ha[1] + (na[1] - ha[1]) * k / 10, ha[2] + (na[2] - ha[2]) * k / 10];
        dmin = Math.min(dmin, seg(q, P(b, B.hips), P(b, B.neck)));
      }
      if (t > 0.15) worst = Math.max(worst, 0.24 - dmin);
      if (prevHips) jump = Math.max(jump, Math.hypot(ha[0] - prevHips[0]!, ha[1] - prevHips[1]!, ha[2] - prevHips[2]!));
      prevHips = ha;
    });
    expect(worst).toBeLessThan(0.03);
    expect(jump).toBeLessThan(0.06); // no hips jump over a frame while he gets up
  });
});

// ---------------------------------------------------------------------------
// Animation quality pass 3 (docs/design/PHASE8_NOTES.md, "Animation quality
// pass 3"): lift-off / plant continuity, the reach assist and the pelvis
// clamp, footwork cadence, close-range contact, the subtree FK.
// ---------------------------------------------------------------------------

describe('pass 3: exactness of the cheaper solve', () => {
  it('subtree forward kinematics leaves exactly what a full pass would', () => {
    const sb = buildScenario({
      fighters: [archetype('arch.champion_complete'), archetype('arch.regional_pro_allrounder')],
      stances: ['orthodox', 'orthodox'], start: [[0, 0], [0, 1.25]], durationMs: 2500,
      actions: [{ fighter: 0, technique: 'tech.jab', commitMs: 837, result: 'landed' }],
    });
    const an = new StandingAnimator({ motion: lib });
    an.setBout(sb.bout, sb.rests);
    const out = [createPose(), createPose()];
    const w = createWorldPose();
    let worst = 0;
    for (let t = 0; t <= 2400; t += FRAME) {
      an.evaluate(frameAt(sb, t, t === 0), FRAME / 1000, out);
      for (const i of [0, 1]) {
        const st = an.fighterState(i)!;
        forwardKinematics(w, st.pose, sb.rests[i]!);
        for (let k = 0; k < w.pos.length; k++) worst = Math.max(worst, Math.abs(w.pos[k]! - st.world.pos[k]!));
      }
    }
    expect(worst).toBeLessThan(1e-5);
  });
});

describe('pass 3: the pelvis reach clamp is smooth', () => {
  it('the hips drop at a bounded rate as a foot moves out to the leg length (no sqrt singularity)', () => {
    const sb = buildScenario({
      fighters: [archetype('arch.champion_complete'), archetype('arch.regional_pro_allrounder')],
      stances: ['orthodox', 'orthodox'], start: [[0, 0], [0, 2]], durationMs: 500, actions: [],
    });
    const an = new StandingAnimator({ motion: null });
    an.setBout(sb.bout, sb.rests);
    an.evaluate(frameAt(sb, 0, true), FRAME / 1000, [createPose(), createPose()]);
    const st = an.fighterState(0)!;
    const spec = st.spec;
    const y0 = spec.pelvis[1];
    const drops: number[] = [];
    // The rear foot slid back 1 mm at a time, well past where the leg reaches.
    const b0 = [...spec.feet[1].ball] as [number, number, number];
    for (let k = 0; k <= 700; k++) {
      spec.pelvis[1] = y0;
      spec.feet[1].ball = [b0[0], 0, b0[2] - k * 0.001];
      st.reachW = [1, 1];
      clampPelvis(spec, st);
      drops.push(y0 - spec.pelvis[1]);
    }
    let maxRate = 0;
    for (let k = 1; k < drops.length; k++) maxRate = Math.max(maxRate, drops[k]! - drops[k - 1]!);
    // At most ~3 mm of drop per mm of foot travel, and never past the 12 cm limit.
    expect(maxRate).toBeLessThan(0.0035);
    expect(Math.max(...drops)).toBeLessThanOrEqual(0.12 * st.rig.scale + 1e-9);
  });
});

describe('pass 3: close-range punches', () => {
  it('a jab aimed straight out to the side of a bladed lead shoulder lands (the elbow pole is not on the reach line)', () => {
    const sb = buildScenario({
      fighters: [archetype('arch.champion_complete'), archetype('arch.regional_pro_allrounder')],
      stances: ['orthodox', 'orthodox'], start: [[0, 0], [0, 2]], durationMs: 500, actions: [],
    });
    const an = new StandingAnimator({ motion: null });
    an.setBout(sb.bout, sb.rests);
    an.evaluate(frameAt(sb, 0, true), FRAME / 1000, [createPose(), createPose()]);
    const st = an.fighterState(0)!;
    const sh = worldP(st.world, B.lArm);
    // Chest-frame +x (own left) of the lead shoulder, 36 cm out; the pole just
    // below the target (a straight captured elbow put 1.6x along the arm).
    const q = [st.world.quat[B.spine2 * 4]!, st.world.quat[B.spine2 * 4 + 1]!, st.world.quat[B.spine2 * 4 + 2]!, st.world.quat[B.spine2 * 4 + 3]!];
    const rot = (v: number[]): number[] => {
      const [x, y, z, w] = q as [number, number, number, number];
      const tx = 2 * (y * v[2]! - z * v[1]!), ty = 2 * (z * v[0]! - x * v[2]!), tz = 2 * (x * v[1]! - y * v[0]!);
      return [v[0]! + w * tx + (y * tz - z * ty), v[1]! + w * ty + (z * tx - x * tz), v[2]! + w * tz + (x * ty - y * tx)];
    };
    const out = rot([0.36, 0, 0]), below = rot([0.36, -0.07, 0]);
    const h = st.spec.hands[0];
    h.pos = [sh[0] + out[0]!, sh[1] + out[1]!, sh[2] + out[2]!];
    h.pole = [sh[0] + below[0]!, sh[1] + below[1]!, sh[2] + below[2]!];
    h.w = 1; h.fistTarget = true; h.exact = false;
    solveHand(st.spec, st.rig, st.pose, st.world, 0);
    forwardKinematics(st.world, st.pose, st.rig.rest);
    const f = fistPoint(st.world, st.rig, 0);
    expect(Math.hypot(f[0] - h.pos[0], f[1] - h.pos[1], f[2] - h.pos[2])).toBeLessThan(0.03);
  });

  it('a jab thrown with the fighters 0.6 m apart lands on the surface at the recorded instant', () => {
    const sb = buildScenario({
      fighters: [archetype('arch.pressure_boxer'), archetype('arch.counter_striker')],
      stances: ['orthodox', 'orthodox'], start: [[0, 0], [0, 0.62]], durationMs: 3000,
      actions: [
        { fighter: 0, technique: 'tech.jab', commitMs: 1037, result: 'landed' },
        { fighter: 1, technique: 'tech.jab', commitMs: 2037, result: 'blocked', defence: 'def.block_high' },
      ],
    });
    const r = audit(asRecording(sb, 'closejab'), { post: 0, motion: lib });
    expect(r.contact.surface.n).toBe(2);
    expect(r.contact.surface.max).toBeLessThan(5);
  });
});

describe('pass 3: footwork', () => {
  it('stop-go recorded motion is covered in few, unhurried steps with no leg pops', () => {
    const moves = [];
    for (let k = 0; k < 20; k++) moves.push({ fighter: 0, fromMs: 800 + k * 200, toMs: 900 + k * 200, vx: k % 2 ? 2.3 : 0, vz: k % 2 ? 0 : 2.3 });
    const sb = buildScenario({
      fighters: [archetype('arch.champion_complete'), archetype('arch.regional_pro_allrounder')],
      stances: ['orthodox', 'orthodox'], start: [[-2, -2], [2, 2]], durationMs: 5200, actions: [], moves,
    });
    const r = audit(asRecording(sb, 'stopgo3'), { post: 0, motion: lib });
    const legPops = Object.entries(r.popHist).filter(([k]) => /standing:.(Shin|Thigh):/.test(k)).reduce((a, [, v]) => a + v, 0);
    expect(legPops).toBeLessThanOrEqual(2);
    // Before pass 3 (the audit set): median swing 0.13 s, 11 % of steps under 8 cm.
    expect(r.steps.dur.pct(0.5)).toBeGreaterThan(0.14);
    expect((r.steps.len.n - r.steps.len.over) / Math.max(1, r.steps.len.n)).toBeLessThan(0.1);
  });

  it('a planted foot pivots without a yaw-rate step (the pivot eases in with the error)', () => {
    const sb = buildScenario({
      fighters: [archetype('arch.champion_complete'), archetype('arch.regional_pro_allrounder')],
      stances: ['orthodox', 'orthodox'], start: [[0, 0], [0, 2]], durationMs: 2500, actions: [],
      moves: [{ fighter: 1, fromMs: 600, toMs: 1600, vx: 1.2, vz: 0 }],
    });
    const an = new StandingAnimator({ motion: null });
    an.setBout(sb.bout, sb.rests);
    const out = [createPose(), createPose()];
    let prev: [number, number] | null = null;
    const prevRate = [0, 0];
    let worstJerk = 0;
    for (let t = 0; t <= 2400; t += FRAME) {
      an.evaluate(frameAt(sb, t, t === 0), FRAME / 1000, out);
      const st = an.fighterState(0)!;
      const y: [number, number] = [st.feet[0].yaw, st.feet[1].yaw];
      if (prev) {
        for (const s of [0, 1]) {
          // In the air, or just landed (the plant takes the landing yaw): not a pivot.
          if (st.feet[s]!.swing || st.feet[s]!.landedAt > t - 3 * FRAME) { prevRate[s] = 0; continue; }
          const r = Math.atan2(Math.sin(y[s]! - prev[s]!), Math.cos(y[s]! - prev[s]!));
          worstJerk = Math.max(worstJerk, Math.abs(r - prevRate[s]!));
          prevRate[s] = r;
        }
      }
      prev = y;
    }
    // Change of the per-frame yaw rate, radians (the old rule switched
    // 0 -> 0.045 rad/frame the moment the error passed 6°).
    expect(worstJerk).toBeLessThan(0.03);
  });
});
