/**
 * Pose data for the animation quality pass 2 before / after captures
 * (docs/screenshots/anim2-*.png). Plays targeted timelines and stretches of the
 * cached audit recordings through the animator (and the post-fight stage),
 * writes joint positions and per-frame traces as JSON; `anim2-captures.mjs`
 * draws and screenshots them.
 *
 *   node scripts/dev/heavy.mjs npx tsx scripts/dev/anim2-captures.ts out.json
 *
 * Uses only APIs that existed before pass 2, so the same file run against the
 * previous animation code gives the "before" half.
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SimEvent, TickSnapshot } from '../../src/sim';
import { StandingAnimator } from '../../src/presentation/anim/animator';
import { archetype, buildScenario, frameAt, type SynthBout } from '../../src/presentation/anim/synth';
import { registerMotionLibrary } from '../../src/presentation/anim/capture';
import { FinishStage } from '../../src/presentation/finish';
import { Composer } from '../../src/presentation/anim/grapple/compose';
import { scaledRest } from '../../src/presentation/anim/grapple';
import { B, createPose, createWorldPose, forwardKinematics, type Pose, type WorldPose } from '../../src/presentation/rig/skeleton';
import { AUDIT_BOUTS, audit, cachedRecording, loadMotion } from './anim-audit-lib';

const lib = loadMotion();
const FRAME = 1000 / 60;
const DEG = 180 / Math.PI;
const JOINTS = [
  B.hips, B.spine2, B.neck, B.head, B.lArm, B.lForeArm, B.lHand, B.rArm, B.rForeArm, B.rHand,
  B.lUpLeg, B.lLeg, B.lFoot, B.lToe, B.rUpLeg, B.rLeg, B.rFoot, B.rToe,
];
const snapW = (w: WorldPose): number[][] => JOINTS.map((j) => {
  const p = [w.pos[j * 3]!, w.pos[j * 3 + 1]!, w.pos[j * 3 + 2]!];
  if (j === B.head) { p[0] = (p[0]! + w.tip[j * 3]!) / 2; p[1] = (p[1]! + w.tip[j * 3 + 1]!) / 2; p[2] = (p[2]! + w.tip[j * 3 + 2]!) / 2; }
  return p.map((v) => Math.round(v * 1000) / 1000);
});
const ev = (kind: string, tick: number, actor = -1, target = -1, detail: unknown = {}): SimEvent =>
  ({ kind, tick, subMs: 0, round: 1, actor, target, text: '', detail }) as unknown as SimEvent;

/** Relative rotation angle of `bone` to `parent` between two world poses (degrees). */
function relAngle(a: Float32Array, b: Float32Array, bone: number, parent: number): number {
  const rel = (q: Float32Array): number[] => {
    const po = parent * 4, o = bone * 4;
    const ax = -q[po]!, ay = -q[po + 1]!, az = -q[po + 2]!, aw = q[po + 3]!;
    const bx = q[o]!, by = q[o + 1]!, bz = q[o + 2]!, bw = q[o + 3]!;
    return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
  };
  const p = rel(a), q = rel(b);
  return 2 * Math.acos(Math.min(1, Math.abs(p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]! + p[3]! * q[3]!))) * DEG;
}

/** A synthetic exchange: strikes landed and blocked; bodies at each contact instant. */
function contacts(): { t: number; bodies: number[][][]; tech: string }[] {
  const acts = [
    { fighter: 0, technique: 'tech.jab', commitMs: 1037, result: 'blocked' as const, defence: 'def.block_high' },
    { fighter: 0, technique: 'tech.cross', commitMs: 2037, result: 'blocked' as const, defence: 'def.block_high' },
    { fighter: 1, technique: 'tech.hook_lead', commitMs: 3037, result: 'landed' as const },
    { fighter: 0, technique: 'tech.jab', commitMs: 4037, result: 'landed' as const },
  ];
  const sb = buildScenario({
    fighters: [archetype('arch.champion_complete'), archetype('arch.regional_pro_allrounder')],
    stances: ['orthodox', 'orthodox'], start: [[0, 0], [0, 1.25]], durationMs: 5000, actions: acts,
  });
  const cms = sb.events.filter((e) => e.kind === 'strike').map((e) => ({ ms: e.tick * 100 + e.subMs, tech: (e.detail as { technique: string }).technique }));
  const an = new StandingAnimator({ motion: lib });
  an.setBout(sb.bout, sb.rests);
  const poses = [createPose(), createPose()];
  const worlds = [createWorldPose(), createWorldPose()];
  const out: { t: number; bodies: number[][][]; tech: string }[] = [];
  const times: number[] = [];
  for (let t = 0; t <= 4800; t += FRAME) times.push(t);
  for (const c of cms) times.push(c.ms);
  times.sort((a, b) => a - b);
  let first = true;
  for (const t of times) {
    an.evaluate(frameAt(sb, t, first), FRAME / 1000, poses);
    first = false;
    const c = cms.find((x) => Math.abs(x.ms - t) < 1e-6);
    if (!c) continue;
    for (let i = 0; i < 2; i++) forwardKinematics(worlds[i]!, poses[i]!, sb.rests[i]!);
    out.push({ t: t / 1000, bodies: worlds.map(snapW), tech: c.tech });
  }
  return out;
}

/** The post-roll of a bout that ends in a submission on the ground (the winner underneath). */
function submission(times: number[]): { t: number; bodies: number[][][] }[] {
  registerMotionLibrary(null);
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
  sb.events.push(ev('submissionFinish', last.tick, 0, 1, { technique: 'sub.guillotine_arm_in', type: 'tap' }), ev('boutEnd', last.tick, -1, -1, { method: 'submission' }));
  const an = new StandingAnimator({ motion: null });
  an.setBout(sb.bout, sb.rests);
  const fin = new FinishStage(sb.bout, sb.rests, null);
  fin.setRecording(sb.frames, sb.events);
  const poses: Pose[] = sb.rests.map(() => createPose());
  const worlds = sb.rests.map(() => createWorldPose());
  const endMs = last.t * 1000;
  let first = true;
  const out: { t: number; bodies: number[][][] }[] = [];
  const step = (tMs: number): void => {
    const input = frameAt(sb, Math.min(tMs, endMs), first);
    const post = fin.clock(input, 1 / 60);
    an.evaluate(post !== null ? fin.animatorInput(input) : input, 1 / 60, poses);
    fin.apply(poses, null);
    for (let i = 0; i < poses.length; i++) forwardKinematics(worlds[i]!, poses[i]!, sb.rests[i]!);
    first = false;
  };
  for (let t = endMs - 1200; t < endMs; t += FRAME) step(t);
  let k = 0;
  for (let m = 0; m <= Math.max(...times) * 60 + 1; m++) {
    step(endMs);
    const pt = fin.postTime ?? 0;
    while (k < times.length && pt >= times[k]! - 1e-6) { out.push({ t: times[k]!, bodies: worlds.map(snapW) }); k++; }
  }
  registerMotionLibrary(lib);
  return out;
}

/** Key poses of three tie-ups (a heavyweight on a flyweight): elbow flexion and the bodies. */
function grips(): { node: string; bodies: number[][][]; elbow: number }[] {
  const comp = new Composer();
  const ra = scaledRest(1.93), rb = scaledRest(1.65);
  const out: { node: string; bodies: number[][][]; elbow: number }[] = [];
  for (const node of ['pos.clinch_collar_tie', 'pos.clinch_cage_pin_front', 'pos.clinch_body_lock_rear']) {
    const poses: [Pose, Pose] = [createPose(), createPose()];
    comp.compose({ node, variant: { postured: false, cage: false, t: 1, tierA: 4, tierB: 4 }, mirror: false, flight: null, sub: null, strike: null } as never, ra, rb, poses);
    const w = [createWorldPose(), createWorldPose()];
    forwardKinematics(w[0]!, poses[0], ra); forwardKinematics(w[1]!, poses[1], rb);
    let e = 0;
    for (const x of w) {
      for (const [s, el, h] of [[B.lArm, B.lForeArm, B.lHand], [B.rArm, B.rForeArm, B.rHand]] as const) {
        const u = [x.pos[el * 3]! - x.pos[s * 3]!, x.pos[el * 3 + 1]! - x.pos[s * 3 + 1]!, x.pos[el * 3 + 2]! - x.pos[s * 3 + 2]!];
        const v = [x.pos[h * 3]! - x.pos[el * 3]!, x.pos[h * 3 + 1]! - x.pos[el * 3 + 1]!, x.pos[h * 3 + 2]! - x.pos[el * 3 + 2]!];
        const c = (u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!) / (Math.hypot(u[0]!, u[1]!, u[2]!) * Math.hypot(v[0]!, v[1]!, v[2]!));
        e = Math.max(e, Math.acos(Math.max(-1, Math.min(1, c))) * DEG);
      }
    }
    out.push({ node, bodies: w.map(snapW), elbow: e });
  }
  return out;
}

/** Upper-arm angular speed (relative to the chest) of one fighter over a stretch of a cached audit bout. */
function armTrace(bout: string, fi: number, t0: number, t1: number, side: 0 | 1, chest = true): { t: number[]; w: number[] } {
  const spec = AUDIT_BOUTS.find((b) => b.name === bout)!;
  const rec = cachedRecording(spec, join(tmpdir(), 'boutlab-anim-audit'));
  const res = { t: [] as number[], w: [] as number[] };
  let prev: Float32Array | null = null;
  let lastT = -1;
  audit(rec, {
    windows: [[t0 - 4, t1]], post: 0, examples: 0,
    onFrame: (t, worlds) => {
      if (Math.abs(t - lastT) < 0.01) return; // contact probes
      lastT = t;
      const q = new Float32Array(worlds[fi]!.quat);
      if (t >= t0 && prev) {
        res.t.push(Math.round(t * 1000) / 1000);
        res.w.push(relAngle(prev, q, side === 0 ? B.lArm : B.rArm, chest ? B.spine2 : B.hips));
      }
      prev = q;
    },
  });
  return res;
}

const outFile = process.argv[2] ?? 'anim2-captures.json';
registerMotionLibrary(lib);
const data = {
  contacts: contacts(),
  submission: submission([0, 0.1, 0.2, 0.3, 0.45, 0.6, 0.9]),
  grips: grips(),
  guard: armTrace('boxing-pressure-v-counter', 0, 86.5, 89.0, 0),
  gnp: armTrace('mma-champ-v-pro', 0, 128.5, 131.0, 0),
};
writeFileSync(outFile, JSON.stringify(data));
console.log('wrote', outFile);
