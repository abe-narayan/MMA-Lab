/**
 * Pose data for the animation quality pass 3 before / after captures
 * (docs/screenshots/anim3-*.png). Plays stretches of the cached audit
 * recordings through the audit pipeline and writes, per frame, the displayed
 * root, both balls of the feet (and whether they are on the floor), the hips,
 * the shins' angular speed and the pelvis's offset from the root; plus every
 * standing step of two whole audit bouts. `anim3-captures.mjs` draws them.
 *
 *   node scripts/dev/heavy.mjs npx tsx scripts/dev/anim3-captures.ts out.json
 *
 * Uses only APIs that existed before pass 3, so the same file run against the
 * previous animation code gives the "before" half.
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUDIT_BOUTS, audit, auditWindows, cachedRecording } from './anim-audit-lib';
import { B, type WorldPose } from '../../src/presentation/rig/skeleton';

const DEG = 180 / Math.PI;
const cache = join(tmpdir(), 'boutlab-anim-audit');
const P = (w: WorldPose, b: number): number[] => [w.pos[b * 3]!, w.pos[b * 3 + 1]!, w.pos[b * 3 + 2]!];
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

function relQ(w: WorldPose, b: number, p: number): number[] {
  const po = p * 4, o = b * 4, q = w.quat;
  const ax = -q[po]!, ay = -q[po + 1]!, az = -q[po + 2]!, aw = q[po + 3]!;
  const bx = q[o]!, by = q[o + 1]!, bz = q[o + 2]!, bw = q[o + 3]!;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
const angle = (a: number[], b: number[]): number => 2 * Math.acos(Math.min(1, Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!))) * DEG;

interface Trace {
  t: number[]; root: number[][]; toe: number[][][]; on: boolean[][]; hipY: number[];
  shin: number[][]; lunge: number[]; layer: string[];
}

/** One fighter over a window: per-frame traces. */
function trace(boutName: string, fighter: number, from: number, to: number): Trace {
  const spec = AUDIT_BOUTS.find((b) => b.name === boutName)!;
  const rec = cachedRecording(spec, cache);
  const out: Trace = { t: [], root: [], toe: [[], []], on: [[], []], hipY: [], shin: [[], []], lunge: [], layer: [] };
  const rest = rec.rests[fighter]!;
  const s = rest.statureM / 1.7332;
  let prev: number[][] | null = null;
  let lastT = -1;
  audit(rec, {
    windows: [[from - 2, to]], post: 0, examples: 0,
    onFrame: (t, worlds, an) => {
      if (Math.abs(t - lastT) < 0.01) return; // contact probes
      lastT = t;
      if (t < from) return;
      const w = worlds[fighter]!;
      const st = an.fighterState(fighter)!;
      const rel = [relQ(w, B.lLeg, B.lUpLeg), relQ(w, B.rLeg, B.rUpLeg)];
      out.t.push(r3(t));
      out.root.push([r3(st.displayRoot[0]), r3(st.displayRoot[2])]);
      const hip = P(w, B.hips);
      out.hipY.push(r3(hip[1]));
      out.lunge.push(r3(Math.hypot(hip[0] - st.displayRoot[0], hip[2] - st.displayRoot[2]) * 100));
      for (const side of [0, 1]) {
        const toe = P(w, side ? B.rToe : B.lToe), ank = P(w, side ? B.rFoot : B.lFoot);
        out.toe[side]!.push([r3(toe[0]!), r3(toe[2]!)]);
        out.on[side]!.push(toe[1]! < rest.head[B.lToe * 3 + 1]! + 0.02 * s && ank[1]! < rest.head[B.lFoot * 3 + 1]! + 0.08 * s);
        out.shin[side]!.push(prev ? r3(angle(prev[side]!, rel[side]!)) : 0);
      }
      out.layer.push(an.debug(fighter).layer);
      prev = rel;
    },
  });
  return out;
}

/** Every standing step (plant to plant) of fighter 0 and 1 over a bout's audit windows: lengths (cm at 1.73 m) and swing times. */
function steps(boutName: string): { len: number[]; dur: number[]; rootM: number; standS: number } {
  const spec = AUDIT_BOUTS.find((b) => b.name === boutName)!;
  const rec = cachedRecording(spec, cache);
  const n = rec.rests.length;
  const plant: (number[] | null)[][] = rec.rests.map(() => [null, null]);
  const lift: (number | null)[][] = rec.rests.map(() => [null, null]);
  const prevRoot: (number[] | null)[] = rec.rests.map(() => null);
  const res = { len: [] as number[], dur: [] as number[], rootM: 0, standS: 0 };
  let lastT = -1;
  audit(rec, {
    windows: auditWindows(rec), post: 0, examples: 0,
    onFrame: (t, worlds, an) => {
      if (Math.abs(t - lastT) < 0.01) return;
      const seek = t - lastT > 0.05;
      lastT = t;
      for (let i = 0; i < n; i++) {
        const st = an.fighterState(i)!;
        const rest = rec.rests[i]!;
        const s = rest.statureM / 1.7332;
        if (st.mode !== 'standing' || seek) { plant[i] = [null, null]; lift[i] = [null, null]; prevRoot[i] = null; continue; }
        const r = st.displayRoot;
        if (prevRoot[i]) { res.rootM += Math.hypot(r[0] - prevRoot[i]![0]!, r[2] - prevRoot[i]![1]!) / s; res.standS += 1 / 60; }
        prevRoot[i] = [r[0], r[2]];
        const w = worlds[i]!;
        for (const side of [0, 1]) {
          const toe = P(w, side ? B.rToe : B.lToe), ank = P(w, side ? B.rFoot : B.lFoot);
          const on = toe[1]! < rest.head[B.lToe * 3 + 1]! + 0.02 * s && ank[1]! < rest.head[B.lFoot * 3 + 1]! + 0.08 * s;
          if (on) {
            const lt = lift[i]![side], from = plant[i]![side];
            if (lt !== null && lt !== undefined && from && t - lt < 0.8) {
              res.len.push(r3(Math.hypot(toe[0]! - from[0]!, toe[2]! - from[1]!) * 100 / s));
              res.dur.push(r3(t - lt));
            }
            lift[i]![side] = null;
            plant[i]![side] = [toe[0]!, toe[2]!];
          } else if (plant[i]![side] && lift[i]![side] === null) lift[i]![side] = t;
        }
      }
    },
  });
  return res;
}

/** The window of `len` s within [a, b] where fighter 0's root travels furthest. */
function busiest(boutName: string, a: number, b: number, len: number): number {
  const spec = AUDIT_BOUTS.find((x) => x.name === boutName)!;
  const rec = cachedRecording(spec, cache);
  const fr = rec.frames.filter((f) => f.t >= a && f.t <= b && f.fighters[0]!.posture === 'standing' && f.engagements.length === 0);
  let best = a, bestD = -1;
  for (let i = 0; i < fr.length; i++) {
    let d = 0;
    for (let j = i + 1; j < fr.length && fr[j]!.t <= fr[i]!.t + len; j++) {
      if (fr[j]!.tick !== fr[j - 1]!.tick + 1) { d = -1; break; }
      d += Math.hypot(fr[j]!.fighters[0]!.x - fr[j - 1]!.fighters[0]!.x, fr[j]!.fighters[0]!.z - fr[j - 1]!.fighters[0]!.z);
    }
    if (d > bestD) { bestD = d; best = fr[i]!.t; }
  }
  return best;
}

const out = process.argv[2] ?? 'anim3.json';
const t0 = busiest('mma-champ-v-pro', 10, 140, 6);
const data = {
  footwork: { bout: 'mma-champ-v-pro', from: t0, ...trace('mma-champ-v-pro', 0, t0, t0 + 6) },
  boxing: { bout: 'boxing-pressure-v-counter', from: 68, ...trace('boxing-pressure-v-counter', 1, 68, 72) },
  steps: [steps('mma-champ-v-pro'), steps('boxing-pressure-v-counter'), steps('k1-thai-v-tkd'), steps('amateur-novices')],
};
writeFileSync(out, JSON.stringify(data));
console.log('wrote', out, 'footwork window', t0);
