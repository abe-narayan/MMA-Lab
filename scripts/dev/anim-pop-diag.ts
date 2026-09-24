/**
 * Arm-pop diagnostic (dev): replays cached audit bouts and, for every
 * one-frame spike of an upper arm's rotation relative to the chest (the
 * audit's pop rule: > 6°/frame and 2.5× both neighbours), prints what the arm
 * IK was given around it — the hand target and pole relative to the chest, the
 * elbow angle, the head relative to the chest — so a pop can be traced to its
 * input (target jump, pole flip, reach singularity) rather than guessed.
 *
 *   node scripts/dev/heavy.mjs npx tsx scripts/dev/anim-pop-diag.ts [--bouts a,b] [--layer L0] [--list N]
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUDIT_BOUTS, audit, auditWindows, cachedRecording } from './anim-audit-lib';
import { B, type WorldPose } from '../../src/presentation/rig/skeleton';

type V3 = [number, number, number];
const args = process.argv.slice(2);
const opt = (k: string): string | undefined => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const pick = opt('--bouts')?.split(',');
const layerRe = new RegExp(opt('--layer') ?? '.');
const listN = Number(opt('--list') ?? 30);
const DEG = 180 / Math.PI;
const P = (w: WorldPose, b: number): V3 => [w.pos[b * 3]!, w.pos[b * 3 + 1]!, w.pos[b * 3 + 2]!];
const Q = (w: WorldPose, b: number): number[] => [w.quat[b * 4]!, w.quat[b * 4 + 1]!, w.quat[b * 4 + 2]!, w.quat[b * 4 + 3]!];
function inv(q: number[]): number[] { return [-q[0]!, -q[1]!, -q[2]!, q[3]!]; }
function mul(a: number[], b: number[]): number[] {
  return [a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!, a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!,
    a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!, a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!];
}
function rot(q: number[], v: V3): V3 {
  const [x, y, z, w] = q as [number, number, number, number];
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
const ang = (a: number[], b: number[]): number => 2 * Math.acos(Math.min(1, Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!))) * DEG;
/** A world point in the chest frame (Spine2). */
const local = (w: WorldPose, p: V3): V3 => { const c = P(w, B.spine2); return rot(inv(Q(w, B.spine2)), [p[0] - c[0], p[1] - c[1], p[2] - c[2]]); };
const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

interface Fr { t: number; layer: string; rel: number[][]; tgt: V3[]; gd: V3[]; pole: V3[]; head: V3; elbow: number[]; reach: number[]; tech: string }
const causes: Record<string, number> = {};
let total = 0;
const lines: string[] = [];
for (const spec of AUDIT_BOUTS.filter((b) => !pick || pick.includes(b.name))) {
  const rec = cachedRecording(spec, join(tmpdir(), 'boutlab-anim-audit'));
  const n = rec.rests.length;
  const hist: Fr[][] = rec.rests.map(() => []);
  let lastT = -1;
  audit(rec, {
    windows: auditWindows(rec), post: 0, examples: 0,
    onFrame: (t, worlds, an) => {
      if (Math.abs(t - lastT) < 0.01) return; // probes
      const seek = t - lastT > 0.05;
      lastT = t;
      for (let i = 0; i < n; i++) {
        const st = an.fighterState(i)!;
        const h = hist[i]!;
        if (seek) h.length = 0;
        if (st.mode !== 'standing') { h.length = 0; continue; }
        const w = worlds[i]!;
        const fr: Fr = {
          t, layer: an.debug(i).layer, tech: an.debug(i).technique ?? '',
          rel: [mul(inv(Q(w, B.spine2)), Q(w, B.lArm)), mul(inv(Q(w, B.spine2)), Q(w, B.rArm))],
          tgt: [local(w, st.spec.hands[0].pos), local(w, st.spec.hands[1].pos)],
          gd: ((st as unknown as { guard?: { pos: V3[] } }).guard?.pos ?? [st.spec.hands[0].pos, st.spec.hands[1].pos]).map((p) => local(w, p)),
          pole: [local(w, st.spec.hands[0].pole), local(w, st.spec.hands[1].pole)],
          head: local(w, P(w, B.head)),
          elbow: [0, 1].map((s) => {
            const a = P(w, s ? B.rArm : B.lArm), e = P(w, s ? B.rForeArm : B.lForeArm), hh = P(w, s ? B.rHand : B.lHand);
            const u = [e[0] - a[0], e[1] - a[1], e[2] - a[2]], v = [hh[0] - e[0], hh[1] - e[1], hh[2] - e[2]];
            return Math.acos(Math.max(-1, Math.min(1, (u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!) / (Math.hypot(u[0]!, u[1]!, u[2]!) * Math.hypot(v[0]!, v[1]!, v[2]!))))) * DEG;
          }),
          reach: [0, 1].map((s) => dist(P(w, s ? B.rArm : B.lArm), st.spec.hands[s]!.pos) / st.rig.armLen),
        };
        h.push(fr);
        if (h.length > 5) h.shift();
        if (h.length < 4) continue;
        // Pop at h[len-2]: speed into it vs speeds around.
        const k = h.length - 2;
        for (const s of [0, 1]) {
          const w1 = ang(h[k - 1]!.rel[s]!, h[k]!.rel[s]!), w0 = ang(h[k]!.rel[s]!, h[k + 1]!.rel[s]!), w2 = ang(h[k - 2]!.rel[s]!, h[k - 1]!.rel[s]!);
          if (!(w1 > 6 && w1 > 2.5 * Math.max(w0, w2))) continue;
          const f = h[k]!, p = h[k - 1]!, pp = h[k - 2]!;
          if (!layerRe.test(p.layer)) continue;
          total++;
          const dT = dist(f.tgt[s]!, p.tgt[s]!), dT0 = dist(p.tgt[s]!, pp.tgt[s]!);
          const dP = dist(f.pole[s]!, p.pole[s]!), dP0 = dist(p.pole[s]!, pp.pole[s]!);
          const dE = Math.abs(f.elbow[s]! - p.elbow[s]!);
          let cause = 'other';
          if (dT > 0.02 && dT > 2.5 * dT0) cause = 'target jump';
          else if (dP > 0.05 && dP > 2.5 * dP0) cause = 'pole jump';
          else if (p.reach[s]! > 0.97 || f.reach[s]! > 0.97) cause = 'near full reach';
          else if (f.elbow[s]! > 130) cause = 'folded (elbow > 130°)';
          else if (dE > 8) cause = 'elbow swing';
          const key = `${cause} · ${p.layer.replace(/\[mocap [^\]]*\]/, '[mocap]')}`;
          causes[key] = (causes[key] ?? 0) + 1;
          if (lines.length < 4000) lines.push(`${w1.toFixed(1).padStart(6)}°  ${spec.name} t=${p.t.toFixed(2)} f${i} ${s ? 'R' : 'L'} ${cause} tgt ${(dT0 * 100).toFixed(1)}→${(dT * 100).toFixed(1)}cm guard ${(dist(p.gd[s]!, pp.gd[s]!) * 100).toFixed(1)}→${(dist(f.gd[s]!, p.gd[s]!) * 100).toFixed(1)}cm pole ${(dP0 * 100).toFixed(1)}→${(dP * 100).toFixed(1)}cm elbow ${pp.elbow[s]!.toFixed(0)}/${p.elbow[s]!.toFixed(0)}/${f.elbow[s]!.toFixed(0)} reach ${p.reach[s]!.toFixed(2)} [${p.layer}] ${p.tech}`);
        }
      }
    },
  });
  console.error(`# ${spec.name}`);
}
console.log(`arm pops: ${total}`);
for (const [k, v] of Object.entries(causes).sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`${String(v).padStart(6)}  ${k}`);
console.log('\nlargest:');
for (const l of lines.sort((a, b) => parseFloat(b) - parseFloat(a)).slice(0, listN)) console.log(l);
