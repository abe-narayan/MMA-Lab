/**
 * Contact diagnostic (dev): for every landed / blocked standing strike of the
 * cached audit recordings, decompose the weapon's miss at the recorded instant
 *   surf   weapon → target surface (the audit's contact metric)
 *   ik     weapon → the aim point the animator used (IK error)
 *   drift  aim point → where the same aim point is on the FINAL poses (the
 *          target moved after the aim was taken)
 * and group by technique family / result / layer.
 *
 *   node scripts/dev/heavy.mjs npx tsx scripts/dev/anim-contact-diag.ts [--bouts a,b] [--list N]
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { StrikeEvent } from '../../src/sim';
import { AUDIT_BOUTS, audit, auditWindows, cachedRecording, headCentreW } from './anim-audit-lib';
import { B, type WorldPose } from '../../src/presentation/rig/skeleton';
import { classify } from '../../src/presentation/anim/strikes';
import { targetPoint, blockPoint, type AimInput } from '../../src/presentation/anim/targets';

type V3 = [number, number, number];
const args = process.argv.slice(2);
const opt = (k: string): string | undefined => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const pick = opt('--bouts')?.split(',');
const listN = Number(opt('--list') ?? 25);
const P = (w: WorldPose, b: number): V3 => [w.pos[b * 3]!, w.pos[b * 3 + 1]!, w.pos[b * 3 + 2]!];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
function segPoint(p: V3, a: V3, b: V3): number {
  const ab = sub(b, a), ap = sub(p, a);
  const t = Math.max(0, Math.min(1, dot(ab, ap) / Math.max(1e-9, dot(ab, ab))));
  return len([ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t]);
}
function segSeg(p1: V3, q1: V3, p2: V3, q2: V3): number {
  let best = Infinity;
  for (let k = 0; k <= 20; k++) {
    const t = k / 20;
    const p: V3 = [p1[0] + (q1[0] - p1[0]) * t, p1[1] + (q1[1] - p1[1]) * t, p1[2] + (q1[2] - p1[2]) * t];
    best = Math.min(best, segPoint(p, p2, q2));
  }
  return best;
}
function fist(w: WorldPose, side: 0 | 1, s: number): V3 {
  const f = P(w, side === 0 ? B.lForeArm : B.rForeArm), h = P(w, side === 0 ? B.lHand : B.rHand);
  const d = sub(h, f); const n = len(d) || 1;
  return [h[0] + d[0] / n * 0.085 * s, h[1] + d[1] / n * 0.085 * s, h[2] + d[2] / n * 0.085 * s];
}

interface Row { bout: string; t: number; tech: string; res: string; tgt: string; surf: number; ik: number; drift: number; aimSurf: number; layer: string; defLayer: string; fade: string; short: number }
const rows: Row[] = [];
for (const spec of AUDIT_BOUTS.filter((b) => !pick || pick.includes(b.name))) {
  const rec = cachedRecording(spec, join(tmpdir(), 'boutlab-anim-audit'));
  const strikes = rec.events.filter((e): e is StrikeEvent => e.kind === 'strike');
  const byMs = new Map<number, StrikeEvent[]>();
  for (const e of strikes) (byMs.get(e.tick * 100 + e.subMs) ?? byMs.set(e.tick * 100 + e.subMs, []).get(e.tick * 100 + e.subMs)!).push(e);
  const scales = rec.rests.map((r) => r.statureM / 1.7332);
  audit(rec, {
    windows: auditWindows(rec), post: 0, examples: 0,
    onFrame: (t, worlds, an) => {
      const ms = Math.round(t * 1000);
      const evs = byMs.get(ms);
      if (!evs) return;
      for (const e of evs) {
        const res = e.detail.result;
        if ((res !== 'landed' && res !== 'blocked') || e.detail.short) continue;
        const ai = e.actor, ti = e.target;
        const sa = an.fighterState(ai), sd = an.fighterState(ti);
        if (!sa || !sd || (sa.mode !== 'standing') || (sd.mode !== 'standing')) continue;
        const tech = e.detail.technique;
        const aw = worlds[ai]!, tw = worlds[ti]!;
        const kick = /kick|teep|knee/.test(tech);
        const weapon: [V3, V3][] = [];
        if (/elbow/.test(tech)) weapon.push([P(aw, B.lForeArm), P(aw, B.lForeArm)], [P(aw, B.rForeArm), P(aw, B.rForeArm)]);
        else if (/knee/.test(tech)) weapon.push([P(aw, B.lLeg), P(aw, B.lLeg)], [P(aw, B.rLeg), P(aw, B.rLeg)]);
        else if (kick) weapon.push([P(aw, B.lLeg), P(aw, B.lFoot)], [P(aw, B.lFoot), P(aw, B.lToe)], [P(aw, B.rLeg), P(aw, B.rFoot)], [P(aw, B.rFoot), P(aw, B.rToe)]);
        else { const a = fist(aw, 0, scales[ai]!), c = fist(aw, 1, scales[ai]!); weapon.push([a, a], [c, c]); }
        const st = scales[ti]!;
        const tg: [V3, V3, number][] = [];
        if (res === 'blocked') {
          tg.push([P(tw, B.lForeArm), P(tw, B.lHand), 0.05 * st], [P(tw, B.rForeArm), P(tw, B.rHand), 0.05 * st],
            [P(tw, B.lArm), P(tw, B.lForeArm), 0.05 * st], [P(tw, B.rArm), P(tw, B.rForeArm), 0.05 * st]);
          if (kick) tg.push([P(tw, B.lLeg), P(tw, B.lFoot), 0.05 * st], [P(tw, B.rLeg), P(tw, B.rFoot), 0.05 * st]);
        } else if (e.detail.target === 'head') { const h = headCentreW(tw); tg.push([h, h, 0.1 * st]); }
        else if (e.detail.target === 'body') tg.push([P(tw, B.hips), P(tw, B.neck), 0.13 * st]);
        else if (e.detail.target === 'leadLeg' || e.detail.target === 'rearLeg') tg.push([P(tw, B.lUpLeg), P(tw, B.lLeg), 0.075 * st], [P(tw, B.rUpLeg), P(tw, B.rLeg), 0.075 * st], [P(tw, B.lLeg), P(tw, B.lFoot), 0.05 * st], [P(tw, B.rLeg), P(tw, B.rFoot), 0.05 * st]);
        else tg.push([P(tw, B.lArm), P(tw, B.lHand), 0.05 * st], [P(tw, B.rArm), P(tw, B.rHand), 0.05 * st]);
        let surf = Infinity;
        for (const [wa, wb] of weapon) for (const [ta, tb, r] of tg) surf = Math.min(surf, Math.max(0, segSeg(wa, wb, ta, tb) - r));
        const aim = an.debug(ai).ikTargets.find((x) => x.name === 'aim' || x.name === 'kick');
        let ik = NaN, drift = NaN, aimSurf = NaN, short = NaN;
        if (aim) {
          ik = Infinity;
          for (const [wa, wb] of weapon) ik = Math.min(ik, segPoint(aim.pos as V3, wa, wb));
          const ra = rec.rests[ai]!;
          const armL = ra.length[B.lArm]! + ra.length[B.lForeArm]! + 0.085 * scales[ai]!;
          short = Math.min(len(sub(aim.pos as V3, P(aw, B.lArm))), len(sub(aim.pos as V3, P(aw, B.rArm)))) - armL;
          aimSurf = Infinity;
          for (const [ta, tb, r] of tg) aimSurf = Math.min(aimSurf, Math.abs(segPoint(aim.pos as V3, ta, tb) - r));
          // Where the aim would be on the final poses.
          const fr = rec.frames.find((f) => f.tick === Math.floor(ms / 100)) ?? rec.frames[0]!;
          const info = classify(tech, fr.fighters[ai]!.stance === 'southpaw' ? 1 : 0);
          const inp: AimInput = {
            attacker: sa, defender: sd, region: e.detail.target as AimInput['region'], subLocation: e.detail.subLocation ?? null,
            approach: info.approach, weaponSide: info.hand !== -1 ? (info.hand === 0 ? 1 : -1) : info.leg === 0 ? 1 : -1, defenderLead: fr.fighters[ti]!.stance === 'southpaw' ? 1 : 0,
          };
          const now = res === 'blocked' ? blockPoint(inp, kick || /elbow|knee/.test(tech)) : targetPoint(inp);
          drift = len(sub(now, aim.pos as V3));
        }
        rows.push({
          bout: spec.name, t, tech, res, tgt: e.detail.target, surf: surf * 100, ik: ik * 100, drift: drift * 100, aimSurf: aimSurf * 100, short: short * 100,
          layer: an.debug(ai).layer, defLayer: an.debug(ti).layer, fade: `${sa.fade ? 'A' : '-'}${sd.fade ? 'D' : '-'}`,
        });
      }
    },
  });
  console.error(`# ${spec.name}`);
}
const fam = (tech: string): string => (/kick|teep/.test(tech) ? 'kick' : /knee/.test(tech) ? 'knee' : /elbow/.test(tech) ? 'elbow' : /hook|bolo/.test(tech) ? 'hook' : /upper/.test(tech) ? 'uppercut' : /overhand/.test(tech) ? 'overhand' : 'straight');
const med = (a: number[]): number => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)]! : NaN; };
const groups = new Map<string, Row[]>();
for (const r of rows) for (const k of [`all`, `res:${r.res}`, `fam:${fam(r.tech)}`, `fam+res:${fam(r.tech)}/${r.res}`, `mocap:${/mocap/.test(r.layer)}`, `fade:${r.fade}`]) (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
console.log('group'.padEnd(28), 'n'.padStart(4), '>5cm%'.padStart(7), 'surfMed'.padStart(8), 'ikMed'.padStart(7), 'ik>3%'.padStart(7), 'drift>3%'.padStart(9), 'aimSurf>3%'.padStart(11));
for (const [k, l] of [...groups].sort()) {
  const p = (f: (r: Row) => boolean): string => (100 * l.filter(f).length / l.length).toFixed(1);
  console.log(k.padEnd(28), String(l.length).padStart(4), p((r) => r.surf > 5).padStart(7), med(l.map((r) => r.surf)).toFixed(2).padStart(8), med(l.map((r) => r.ik)).toFixed(2).padStart(7), p((r) => r.ik > 3).padStart(7), p((r) => r.drift > 3).padStart(9), p((r) => r.aimSurf > 3).padStart(11));
}
console.log('\nworst:');
for (const r of rows.filter((x) => x.surf > 5).sort((a, b) => b.surf - a.surf).slice(0, listN)) {
  console.log(`${r.bout} t=${r.t.toFixed(3)} ${r.tech} ${r.res} ${r.tgt} surf=${r.surf.toFixed(1)} ik=${r.ik.toFixed(1)} drift=${r.drift.toFixed(1)} aimSurf=${r.aimSurf.toFixed(1)} short=${r.short.toFixed(1)} fade=${r.fade} [${r.layer}] def[${r.defLayer}]`);
}
