/**
 * Leg-pop diagnostic (dev, animation quality pass 3): replays cached audit
 * bouts and, for every one-frame spike of a thigh's or shin's rotation
 * relative to its parent (the audit's pop rule: > 6°/frame and 2.5× both
 * neighbours) while standing, prints the footwork state around it — where the
 * foot is in its swing (lift-off, mid-air, landing, planted), the hip–ankle
 * distance as a fraction of the leg (reach), the heel lift / air pitch / yaw
 * of the foot spec, the pelvis height and the knee angle — so a pop can be
 * traced to its input rather than guessed.
 *
 *   node scripts/dev/heavy.mjs npx tsx scripts/dev/anim-leg-diag.ts [--bouts a,b] [--list N] [--bone Shin|Thigh]
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AUDIT_BOUTS, audit, auditWindows, cachedRecording } from './anim-audit-lib';
import { B, type WorldPose } from '../../src/presentation/rig/skeleton';

type V3 = [number, number, number];
const args = process.argv.slice(2);
const opt = (k: string): string | undefined => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const pick = opt('--bouts')?.split(',');
const listN = Number(opt('--list') ?? 30);
const boneRe = new RegExp(opt('--bone') ?? '.');
const DEG = 180 / Math.PI;
const P = (w: WorldPose, b: number): V3 => [w.pos[b * 3]!, w.pos[b * 3 + 1]!, w.pos[b * 3 + 2]!];
const Q = (w: WorldPose, b: number): number[] => [w.quat[b * 4]!, w.quat[b * 4 + 1]!, w.quat[b * 4 + 2]!, w.quat[b * 4 + 3]!];
function inv(q: number[]): number[] { return [-q[0]!, -q[1]!, -q[2]!, q[3]!]; }
function mul(a: number[], b: number[]): number[] {
  return [a[3]! * b[0]! + a[0]! * b[3]! + a[1]! * b[2]! - a[2]! * b[1]!, a[3]! * b[1]! - a[0]! * b[2]! + a[1]! * b[3]! + a[2]! * b[0]!,
    a[3]! * b[2]! + a[0]! * b[1]! - a[1]! * b[0]! + a[2]! * b[3]!, a[3]! * b[3]! - a[0]! * b[0]! - a[1]! * b[1]! - a[2]! * b[2]!];
}
const ang = (a: number[], b: number[]): number => 2 * Math.acos(Math.min(1, Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!))) * DEG;
const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

interface Fr {
  t: number; layer: string; tech: string;
  rel: number[][]; // [lThigh, lShin, rThigh, rShin] relative rotations
  reach: number[]; knee: number[]; u: number[]; landedAgo: number[];
  lift: number[]; air: number[]; yaw: number[]; ankleW: number[]; pelY: number; ankle: V3[]; dbg: number[]; root: V3; pel: V3; dbgS: number[]; dbgC: number[]; dbgA: number[]; poleAng: number[];
}
const BONES = [
  { b: B.lUpLeg, p: B.hips, side: 0, name: 'lThigh' }, { b: B.lLeg, p: B.lUpLeg, side: 0, name: 'lShin' },
  { b: B.rUpLeg, p: B.hips, side: 1, name: 'rThigh' }, { b: B.rLeg, p: B.rUpLeg, side: 1, name: 'rShin' },
];
const hz = (a: number[], b: number[]): number => (a.length >= 3 && b.length >= 3 ? Math.hypot(a[0]! - b[0]!, a[2]! - b[2]!) * 100 : NaN);
/** How far a stage moved the pelvis (after - before) in each frame, cm. */
const stg = (pp: Fr, p: Fr, f: Fr, after: (x: Fr) => number[], before: (x: Fr) => number[]): string => [pp, p, f].map((x) => hz(after(x), before(x)).toFixed(1)).join('/');
/** How far a stage's pelvis moved frame to frame, cm. */
const mv = (pp: Fr, p: Fr, f: Fr, g: (x: Fr) => number[]): string => `${hz(g(p), g(pp)).toFixed(1)}→${hz(g(f), g(p)).toFixed(1)}`;
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
        if (st.mode !== 'standing' || st.fade) { h.length = 0; continue; }
        const w = worlds[i]!;
        const now = t * 1000;
        const fr: Fr = {
          t, layer: an.debug(i).layer, tech: an.debug(i).technique ?? '',
          rel: BONES.map((x) => mul(inv(Q(w, x.p)), Q(w, x.b))),
          reach: [0, 1].map((s) => dist(P(w, s ? B.rUpLeg : B.lUpLeg), P(w, s ? B.rFoot : B.lFoot)) / st.rig.legLen),
          knee: [0, 1].map((s) => {
            const a = P(w, s ? B.rUpLeg : B.lUpLeg), k = P(w, s ? B.rLeg : B.lLeg), f = P(w, s ? B.rFoot : B.lFoot);
            const u = [k[0] - a[0], k[1] - a[1], k[2] - a[2]], v = [f[0] - k[0], f[1] - k[1], f[2] - k[2]];
            return Math.acos(Math.max(-1, Math.min(1, (u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!) / (Math.hypot(u[0]!, u[1]!, u[2]!) * Math.hypot(v[0]!, v[1]!, v[2]!))))) * DEG;
          }),
          u: [0, 1].map((s) => { const sw = st.feet[s]!.swing; return sw ? (now - sw.t0) / sw.dur : -1; }),
          landedAgo: [0, 1].map((s) => now - st.feet[s]!.landedAt),
          lift: [0, 1].map((s) => st.spec.feet[s]!.lift * DEG),
          air: [0, 1].map((s) => st.spec.feet[s]!.airPitch * DEG),
          yaw: [0, 1].map((s) => st.spec.feet[s]!.yaw * DEG),
          ankleW: [0, 1].map((s) => st.delta.feet[s]!.ankleW),
          pelY: st.spec.pelvis[1],
          ankle: [P(w, B.lFoot), P(w, B.rFoot)],
          dbg: [...((st as unknown as { dbg3?: number[] }).dbg3 ?? [])],
          root: [...st.displayRoot] as V3, pel: [...st.spec.pelvis] as V3,
          dbgS: [...((st as unknown as { dbg3s?: number[] }).dbg3s ?? [])],
          dbgC: [...((st as unknown as { dbg3c?: number[] }).dbg3c ?? [])],
          dbgA: [...((st as unknown as { dbg3a?: number[] }).dbg3a ?? [])],
          poleAng: [0, 1].map((s) => {
            const hp = P(w, s ? B.rUpLeg : B.lUpLeg), an2 = P(w, s ? B.rFoot : B.lFoot), po = st.spec.feet[s]!.pole;
            const a = [an2[0] - hp[0], an2[1] - hp[1], an2[2] - hp[2]], b = [po[0] - hp[0], po[1] - hp[1], po[2] - hp[2]];
            return Math.acos(Math.max(-1, Math.min(1, (a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) / (Math.hypot(a[0]!, a[1]!, a[2]!) * Math.hypot(b[0]!, b[1]!, b[2]!))))) * DEG;
          }),
        };
        h.push(fr);
        if (h.length > 5) h.shift();
        if (h.length < 4) continue;
        const k = h.length - 2;
        for (let bi = 0; bi < BONES.length; bi++) {
          const bn = BONES[bi]!;
          if (!boneRe.test(bn.name)) continue;
          const w1 = ang(h[k - 1]!.rel[bi]!, h[k]!.rel[bi]!), w0 = ang(h[k]!.rel[bi]!, h[k + 1]!.rel[bi]!), w2 = ang(h[k - 2]!.rel[bi]!, h[k - 1]!.rel[bi]!);
          if (!(w1 > 6 && w1 > 2.5 * Math.max(w0, w2))) continue;
          const s = bn.side;
          const f = h[k]!, p = h[k - 1]!, pp = h[k - 2]!;
          total++;
          let cause = 'planted';
          const uP = p.u[s]!, uF = f.u[s]!;
          if (f.ankleW[s]! > 0.02 || p.ankleW[s]! > 0.02) cause = 'action leg';
          else if (uP < 0 && uF >= 0) cause = 'lift-off';
          else if (uP >= 0 && uF < 0) cause = 'touch-down';
          else if (uF >= 0 && uF < 0.2) cause = 'early swing';
          else if (uF >= 0.8) cause = 'late swing';
          else if (uF >= 0) cause = 'mid swing';
          else if (f.landedAgo[s]! < 80) cause = 'just landed';
          const dReach = Math.abs(f.reach[s]! - p.reach[s]!) * 100, dReach0 = Math.abs(p.reach[s]! - pp.reach[s]!) * 100;
          const sub = f.reach[s]! > 0.975 || p.reach[s]! > 0.975 ? ' (near full reach)' : '';
          const key = `${cause}${sub} · ${bn.name.slice(1)}`;
          causes[key] = (causes[key] ?? 0) + 1;
          const dA = dist(f.ankle[s]!, p.ankle[s]!) * 100, dA0 = dist(p.ankle[s]!, pp.ankle[s]!) * 100;
          if (lines.length < 6000) lines.push(`${w1.toFixed(1).padStart(6)}°  ${spec.name} t=${p.t.toFixed(3)} f${i} ${bn.name} ${cause}${sub} u ${pp.u[s]!.toFixed(2)}/${p.u[s]!.toFixed(2)}/${f.u[s]!.toFixed(2)} reach%Δ ${dReach0.toFixed(2)}→${dReach.toFixed(2)} (${(f.reach[s]! * 100).toFixed(1)}%) knee ${pp.knee[s]!.toFixed(1)}/${p.knee[s]!.toFixed(1)}/${f.knee[s]!.toFixed(1)} ankle cm ${dA0.toFixed(2)}→${dA.toFixed(2)} lift ${pp.lift[s]!.toFixed(1)}/${p.lift[s]!.toFixed(1)}/${f.lift[s]!.toFixed(1)} air ${p.air[s]!.toFixed(1)}/${f.air[s]!.toFixed(1)} yaw ${pp.yaw[s]!.toFixed(1)}/${p.yaw[s]!.toFixed(1)}/${f.yaw[s]!.toFixed(1)} pelY ${(pp.pelY * 100).toFixed(1)}/${(p.pelY * 100).toFixed(1)}/${(f.pelY * 100).toFixed(1)} [${p.layer}] ${p.tech}
      pre-clamp y ${[pp, p, f].map((x) => (x.dbg[1]! * 100).toFixed(1)).join('/')} post-clamp ${[pp, p, f].map((x) => (x.dbg[3]! * 100).toFixed(1)).join('/')} pelOffY ${[pp, p, f].map((x) => (x.dbg[6]! * 100).toFixed(1)).join('/')} srY ${[pp, p, f].map((x) => (x.dbg[7]! * 100).toFixed(1)).join('/')} pelXZ moved ${(Math.hypot(p.pel[0] - pp.pel[0], p.pel[2] - pp.pel[2]) * 100).toFixed(1)}→${(Math.hypot(f.pel[0] - p.pel[0], f.pel[2] - p.pel[2]) * 100).toFixed(1)}cm preXZ ${(Math.hypot(p.dbg[0]! - pp.dbg[0]!, p.dbg[2]! - pp.dbg[2]!) * 100).toFixed(1)}→${(Math.hypot(f.dbg[0]! - p.dbg[0]!, f.dbg[2]! - p.dbg[2]!) * 100).toFixed(1)} root ${(Math.hypot(p.root[0] - pp.root[0], p.root[2] - pp.root[2]) * 100).toFixed(1)}→${(Math.hypot(f.root[0] - p.root[0], f.root[2] - p.root[2]) * 100).toFixed(1)} poleAng ${[pp, p, f].map((x) => x.poleAng[s]!.toFixed(0)).join('/')}
      stages XZ-moved cm: assist ${stg(pp, p, f, (x) => x.dbgS.slice(3, 6), (x) => x.dbgS.slice(0, 3))} beforeClear ${mv(pp, p, f, (x) => x.dbgC)} final ${mv(pp, p, f, (x) => [...x.pel])} | clear-part ${stg(pp, p, f, (x) => [...x.pel], (x) => x.dbgC)}
      assist err0 ${[pp, p, f].map((x) => (x.dbgA.length ? (x.dbgA[0]! * 100).toFixed(1) : '-')).join('/')} goal moved ${[[pp, p], [p, f]].map(([a, b]) => (a!.dbgA.length && b!.dbgA.length ? (Math.hypot(b!.dbgA[1]! - a!.dbgA[1]!, b!.dbgA[2]! - a!.dbgA[2]!, b!.dbgA[3]! - a!.dbgA[3]!) * 100).toFixed(1) : '-')).join('→')} shoulder moved ${[[pp, p], [p, f]].map(([a, b]) => (a!.dbgA.length && b!.dbgA.length ? (Math.hypot(b!.dbgA[4]! - a!.dbgA[4]!, b!.dbgA[5]! - a!.dbgA[5]!, b!.dbgA[6]! - a!.dbgA[6]!) * 100).toFixed(1) : '-')).join('→')} sh→goal ${[pp, p, f].map((x) => (x.dbgA.length ? (Math.hypot(x.dbgA[1]! - x.dbgA[4]!, x.dbgA[2]! - x.dbgA[5]!, x.dbgA[3]! - x.dbgA[6]!) * 100).toFixed(1) : '-')).join('/')}`);
        }
      }
    },
  });
  console.error(`# ${spec.name}`);
}
console.log(`leg pops (standing, no own strike, no fade): ${total}`);
for (const [k, v] of Object.entries(causes).sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`${String(v).padStart(6)}  ${k}`);
console.log('\nlargest:');
for (const l of lines.sort((a, b) => parseFloat(b) - parseFloat(a)).slice(0, listN)) console.log(l);
console.log('\nsample (every k-th):');
const step = Math.max(1, Math.floor(lines.length / listN));
for (let k = 0; k < lines.length; k += step) console.log(lines[k]);
