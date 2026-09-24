/**
 * Pose data for the animation quality pass's before / after captures
 * (docs/screenshots/anim-*.png). Plays a few targeted timelines through the
 * animator and the post-fight stage and writes the joint positions (and a few
 * per-frame traces) as JSON; `anim-captures.mjs` draws and screenshots them.
 *
 *   npx tsx scripts/dev/anim-captures.ts out.json
 *
 * Uses only APIs that existed before the pass, so the same file run against
 * the previous animation code gives the "before" half.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SimEvent, TickSnapshot } from '../../src/sim';
import { StandingAnimator } from '../../src/presentation/anim/animator';
import { archetype, buildScenario, frameAt, type SynthBout } from '../../src/presentation/anim/synth';
import { registerMotionLibrary } from '../../src/presentation/anim/capture';
import { FinishStage } from '../../src/presentation/finish';
import { MotionLibrary, type MotionManifest } from '../../src/presentation/assets/motionLibrary';
import { B, createPose, createWorldPose, forwardKinematics, type Pose, type WorldPose } from '../../src/presentation/rig/skeleton';

const lib = MotionLibrary.fromData(
  JSON.parse(readFileSync(join(process.cwd(), 'static/assets/motion/manifest.json'), 'utf8')) as MotionManifest,
  readFileSync(join(process.cwd(), 'static/assets/motion/motion.bin')),
);
const FRAME = 1000 / 60;
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

/** Play a bout's last second, then the post-roll; sample worlds at the given post times. */
function postRoll(sb: SynthBout, times: number[]): { t: number; bodies: number[][][] }[] {
  const an = new StandingAnimator({ motion: lib });
  an.setBout(sb.bout, sb.rests);
  const fin = new FinishStage(sb.bout, sb.rests, null);
  fin.setRecording(sb.frames, sb.events);
  const poses: Pose[] = sb.rests.map(() => createPose());
  const worlds = sb.rests.map(() => createWorldPose());
  const endMs = sb.frames[sb.frames.length - 1]!.t * 1000;
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
  for (let t = endMs - 1500; t < endMs; t += FRAME) step(t);
  const last = Math.max(...times);
  let k = 0;
  for (let n = 0; n <= last * 60 + 1; n++) {
    step(endMs);
    const pt = fin.postTime ?? 0;
    while (k < times.length && pt >= times[k]! - 1e-6) { out.push({ t: times[k]!, bodies: worlds.map(snapW) }); k++; }
  }
  return out;
}

function clinchStoppage(): SynthBout {
  const sb = buildScenario({
    fighters: [archetype('arch.champion_complete'), archetype('arch.regional_pro_allrounder')],
    stances: ['orthodox', 'orthodox'], start: [[0, -0.25], [0, 0.25]], durationMs: 2500, actions: [],
  });
  for (const f of sb.frames.slice(-8)) {
    f.engagements = [{
      a: 0, b: 1, node: 'pos.clinch_double_collar', sinceTick: sb.frames[0]!.tick, kind: 'clinch', cage: false, underhookOwner: null,
      kuzushi: { dir: 0, mag: 0 }, posture: 'chest', inflight: null, rootX: 0, rootZ: 0, rootYaw: 0,
    }] as TickSnapshot['engagements'];
    for (const x of f.fighters) x.posture = 'clinch';
  }
  const last = sb.frames[sb.frames.length - 1]!;
  last.phase = 'ended';
  sb.events.push(ev('refereeStoppage', last.tick, -1, 0, { method: 'tko_strikes' }), ev('fighterOut', last.tick, 1, -1), ev('boutEnd', last.tick, -1, -1, { method: 'tko' }));
  return sb;
}

function koStoppage(): SynthBout {
  const sb = buildScenario({
    fighters: [archetype('arch.champion_complete'), archetype('arch.regional_pro_allrounder')],
    stances: ['orthodox', 'orthodox'], start: [[-0.5, 0.4], [0.6, 0.2]], durationMs: 4000,
    actions: [{ fighter: 0, technique: 'tech.hook_lead', commitMs: 1037, result: 'landed', knockdown: 'ko', downMs: 60000 }],
  });
  const last = sb.frames[sb.frames.length - 1]!;
  last.phase = 'ended';
  last.fighters[1]!.posture = 'out';
  sb.events.push(ev('refereeStoppage', last.tick, -1, 0, { method: 'ko' }), ev('fighterOut', last.tick, 1, -1, { method: 'ko' }), ev('boutEnd', last.tick, -1, -1, { method: 'ko' }));
  return sb;
}

/** Per-frame traces of one fighter over [t0, t1] ms of a synthetic timeline. */
function traces(sb: SynthBout, t0: number, t1: number, keyTimes: number[]): {
  t: number[]; hipY: number[]; footY: number[][]; slide: number[][]; thigh: number[][]; bodies: { t: number; body: number[][] }[];
} {
  const an = new StandingAnimator({ motion: lib });
  an.setBout(sb.bout, sb.rests);
  const out = [createPose(), createPose()];
  const w = createWorldPose();
  const res = { t: [] as number[], hipY: [] as number[], footY: [[], []] as number[][], slide: [[], []] as number[][], thigh: [[], []] as number[][], bodies: [] as { t: number; body: number[][] }[] };
  let prevToe: number[][] | null = null;
  let prevQ: Float32Array | null = null;
  let kt = 0;
  for (let t = 0; t <= t1; t += FRAME) {
    an.evaluate(frameAt(sb, t, t === 0), FRAME / 1000, out);
    forwardKinematics(w, out[0]!, sb.rests[0]!);
    const toe = [B.lToe, B.rToe].map((j) => [w.pos[j * 3]!, w.pos[j * 3 + 1]!, w.pos[j * 3 + 2]!]);
    if (t >= t0) {
      res.t.push(Math.round(t));
      res.hipY.push(w.pos[1]!);
      for (const s of [0, 1]) {
        res.footY[s]!.push(toe[s]![1]!);
        res.slide[s]!.push(prevToe && toe[s]![1]! < 0.05 && prevToe[s]![1]! < 0.05 ? Math.hypot(toe[s]![0]! - prevToe[s]![0]!, toe[s]![2]! - prevToe[s]![2]!) * 100 : 0);
        const j = s === 0 ? B.lUpLeg : B.rUpLeg;
        let a = 0;
        if (prevQ) {
          const rel = (q: Float32Array): number[] => {
            const po = B.hips * 4, o = j * 4;
            const ax = -q[po]!, ay = -q[po + 1]!, az = -q[po + 2]!, aw = q[po + 3]!;
            const bx = q[o]!, by = q[o + 1]!, bz = q[o + 2]!, bw = q[o + 3]!;
            return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
          };
          const p = rel(prevQ), q = rel(w.quat);
          a = 2 * Math.acos(Math.min(1, Math.abs(p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]! + p[3]! * q[3]!))) * 180 / Math.PI;
        }
        res.thigh[s]!.push(a);
      }
      while (kt < keyTimes.length && t >= keyTimes[kt]! - 1e-6) { res.bodies.push({ t: keyTimes[kt]!, body: snapW(w) }); kt++; }
    }
    prevToe = toe;
    prevQ = new Float32Array(w.quat);
  }
  return res;
}

const outFile = process.argv[2] ?? 'anim-captures.json';
registerMotionLibrary(lib);
const moves = [];
for (let k = 0; k < 12; k++) moves.push({ fighter: 0, fromMs: 800 + k * 200, toMs: 900 + k * 200, vx: k % 2 ? 2.2 : 0, vz: k % 2 ? 0.4 : 2.2 });
const stopGo = buildScenario({
  fighters: [archetype('arch.champion_complete'), archetype('arch.regional_pro_allrounder')],
  stances: ['orthodox', 'orthodox'], start: [[-1.5, -2], [2.5, 2.5]], durationMs: 3600, actions: [], moves,
});
const kick = buildScenario({
  fighters: [archetype('arch.thai_striker'), archetype('arch.regional_pro_allrounder')],
  stances: ['orthodox', 'orthodox'], start: [[0, 0], [0, 1.3]], durationMs: 3000,
  actions: [{ fighter: 0, technique: 'tech.kick_body_rear', commitMs: 1037, result: 'blocked', defence: 'def.block' }],
});
const data = {
  clinch: postRoll(clinchStoppage(), [0, 0.2, 0.4, 0.6, 0.8, 1.1]),
  getup: postRoll(koStoppage(), [3.5, 5.6, 6.6, 7.6, 8.6, 9.6, 10.6]),
  celebrate: postRoll(koStoppage(), [3.2, 4.2, 5.2, 6.2, 7.2, 8.2]),
  stopgo: traces(stopGo, 900, 2900, [1300, 1500, 1700, 1900, 2100, 2300]),
  kick: traces(kick, 1000, 2600, [1450, 1650, 1850, 2000, 2050, 2150]),
};
writeFileSync(outFile, JSON.stringify(data));
console.log('wrote', outFile);
