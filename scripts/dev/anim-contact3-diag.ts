/**
 * Contact-miss geometry (dev, animation quality pass 3): at the recorded
 * contact instant of every landed / blocked standing punch whose fist is more
 * than 5 cm off the aim the animator used, print where that aim sat for the
 * punching arm — its distance from the shoulder against the arm's full reach
 * (fist included), in the chest frame (x own left, y up, z forward) — the
 * fist's IK error and the elbow's flexion, so a close-range miss (no room to
 * extend) can be told from an out-of-reach one.
 *
 *   node scripts/dev/heavy.mjs npx tsx scripts/dev/anim-contact3-diag.ts [--bouts a,b]
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StrikeEvent } from '../../src/sim';
import { AUDIT_BOUTS, audit, auditWindows, cachedRecording } from './anim-audit-lib';
import { B, type WorldPose } from '../../src/presentation/rig/skeleton';
import { classify } from '../../src/presentation/anim/strikes';

type V3 = [number, number, number];
const args = process.argv.slice(2);
const opt = (k: string): string | undefined => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const pick = opt('--bouts')?.split(',');
const DEG = 180 / Math.PI;
const P = (w: WorldPose, b: number): V3 => [w.pos[b * 3]!, w.pos[b * 3 + 1]!, w.pos[b * 3 + 2]!];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
function toChest(w: WorldPose, v: V3): V3 {
  const o = B.spine2 * 4, q = w.quat;
  const x = -q[o]!, y = -q[o + 1]!, z = -q[o + 2]!, s = q[o + 3]!;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + s * tx + (y * tz - z * ty), v[1] + s * ty + (z * tx - x * tz), v[2] + s * tz + (x * ty - y * tx)];
}
const lines: string[] = [];
for (const spec of AUDIT_BOUTS.filter((b) => !pick || pick.includes(b.name))) {
  const rec = cachedRecording(spec, join(tmpdir(), 'boutlab-anim-audit'));
  const strikes = rec.events.filter((e): e is StrikeEvent => e.kind === 'strike' && (e.detail.result === 'landed' || e.detail.result === 'blocked') && !e.detail.short);
  const at = new Map<number, StrikeEvent[]>();
  for (const e of strikes) { const ms = e.tick * 100 + e.subMs; (at.get(ms) ?? at.set(ms, []).get(ms)!).push(e); }
  audit(rec, {
    windows: auditWindows(rec), post: 0, examples: 0,
    onFrame: (t, worlds, an) => {
      const evs = at.get(Math.round(t * 1000));
      if (!evs) return;
      for (const e of evs) {
        const ai = rec.frames[0]!.fighters.findIndex((f) => f.id === e.actor);
        if (ai < 0 || an.fighterState(ai)!.mode !== 'standing') continue;
        const tech = e.detail.technique;
        if (/kick|knee|teep|elbow/.test(tech)) continue;
        const st = an.fighterState(ai)!;
        const snap = rec.frames.find((f) => f.tick === e.tick)?.fighters[ai];
        const info = classify(tech, snap?.stance === 'southpaw' ? 1 : 0);
        const aim = an.debug(ai).ikTargets.find((x) => x.name === 'aim');
        if (!aim || info.hand === -1) continue;
        const w = worlds[ai]!;
        const h = info.hand as 0 | 1;
        const sh = P(w, h ? B.rArm : B.lArm), el = P(w, h ? B.rForeArm : B.lForeArm), hd = P(w, h ? B.rHand : B.lHand);
        const d = sub(hd, el); const dl = len(d);
        const fist: V3 = [hd[0] + d[0] / dl * st.rig.fistLen, hd[1] + d[1] / dl * st.rig.fistLen, hd[2] + d[2] / dl * st.rig.fistLen];
        const err = len(sub(fist, aim.pos as V3));
        if (err < 0.05) continue;
        const R = st.rig.armLen + st.rig.fistLen;
        const rel = toChest(w, sub(aim.pos as V3, sh));
        const u = sub(el, sh), v = sub(hd, el);
        const flex = Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (len(u) * len(v))))) * DEG;
        const fa = rec.frames.find((f) => f.tick === e.tick)?.fighters;
        const recD = fa ? Math.hypot(fa[0]!.x - fa[1]!.x, fa[0]!.z - fa[1]!.z) : NaN;
        const hs = st.spec.hands[h]!;
        const hp = hs.pos as V3;
        const extra = `| hand w=${hs.w.toFixed(2)} fistTarget=${hs.fistTarget} exact=${!!hs.exact} target→aim ${(len(sub(hp, aim.pos as V3)) * 100).toFixed(1)} cm fist→target ${(len(sub(fist, hp)) * 100).toFixed(1)} cm fade=${st.fade ? ((t * 1000 - st.fade.t0) / st.fade.dur).toFixed(2) : '-'}`;
        lines.push(`${(err * 100).toFixed(1).padStart(5)} cm ${extra}  ${spec.name} t=${t.toFixed(2)} f${ai} ${tech} ${e.detail.result} rec ${recD.toFixed(2)} m | sh→aim ${(len(rel) * 100).toFixed(0)} cm = ${(len(rel) / R * 100).toFixed(0)}% of reach, chest-frame (${rel.map((x) => (x * 100).toFixed(0)).join(', ')}) cm | elbow ${flex.toFixed(0)}° [${an.debug(ai).layer}]`);
      }
    },
  });
  console.error(`# ${spec.name}`);
}
console.log(`punch contacts with fist > 5 cm off its aim: ${lines.length}`);
for (const l of lines.sort((a, b) => parseFloat(b) - parseFloat(a))) console.log(l);
