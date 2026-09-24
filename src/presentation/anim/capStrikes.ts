/**
 * CAPTURE-DRIVEN STRIKES AND DEFENCES (see `capture.ts` for the method).
 *
 * A strike with a usable clip is played as:
 *   - a TIME MAP from the recorded timeline (commit -> contact -> active end
 *     -> end, `timing.ts`) onto clip time (start-ish -> contact marker -> a
 *     short dwell -> natural recovery). The contact marker lands exactly on the
 *     recorded instant; the windup keeps the capture's own speed where the sim
 *     allows it and is sped up / slowed down uniformly where it does not;
 *   - BODY DELTAS from the clip's start pose (pelvis weight shift relative to
 *     the support foot, pelvis / chest / head rotation, clavicles, support-foot
 *     pivot and heel), scaled by the tier's capture filter and with any end
 *     residual ramped out over the recovery;
 *   - the WEAPON on a displacement-mapped path: the captured fist (ankle) path
 *     relative to its shoulder (hip), with our guard / planted foot at the
 *     start and our aim at contact. The blend weight is the capture's own
 *     progress toward contact, so the snap of the capture is preserved and the
 *     weapon is on the aim at the recorded instant (the IK then lands it).
 *
 * What stays procedural: knees, elbows, spinning techniques, switch kicks,
 * the superman punch, feints, level changes, anything whose clip is for the
 * other limb (the axe kick / front kick / rear teep captures are lead-leg
 * takes), and anything the library lacks. Both paths write the same Delta and
 * BodySpec, start and end in the same stance, so there is no seam to blend.
 */
import type { MotionClipInfo, MotionLibrary } from '../assets/motionLibrary';
import { B, forwardKinematics } from '../rig/skeleton';
import { KNEE_MAX_FLEX, LIMBS, solveTwoBone } from '../rig/ik';
import {
  DEG, add, bump, clamp, clamp01, dirToWorld, hash01, madd, norm, smooth, sub, toWorld, vlerp,
  windowW, type V3,
} from './math';
import { ankleOf, worldP, type BodySpec } from './spec';
import type { Ctx, Delta } from './state';
import type { GuardPose } from './stance';
import {
  aimPoint, envelope, kickGeometry, lungeFor, strikeHands, type StrikeInfo,
} from './strikes';
import { TECH, type ActionTiming } from './timing';
import { CapRig, clipStance, wrapAngle, type CapFrame } from './capture';
import type { ActiveDefence, DefMotion } from './defence';

type Use = 'full' | 'body';

/** Which motion kinds read the capture, and how much of it. */
const USE: Partial<Record<StrikeInfo['kind'], Use>> = {
  jab: 'full', cross: 'full', hook: 'full', uppercut: 'full', overhand: 'body',
  round: 'full', teep: 'full', side: 'full', axe: 'full', oblique: 'full',
};

const ROLE: Record<string, string> = { leadHand: 'leadHand', rearHand: 'rearHand', leadLeg: 'leadFoot', rearLeg: 'rearFoot' };

export interface CapAction {
  key: string;
  h: number;
  clip: MotionClipInfo;
  use: Use;
  leg: boolean;
  /** Canonical side of the weapon (0 = left). */
  side: 0 | 1;
  commit: number; contact: number; activeEnd: number; end: number;
  t0: number; tc: number; tE: number; hold: number;
  f0: CapFrame; fc: CapFrame; fE: CapFrame;
  /** Weapon progress toward contact over [t0, tc] and back over [tc, tE], per clip frame. */
  prog: Float32Array;
  ret: Float32Array;
}

/** The clip a technique would be played from for this stance (null: procedural). */
export function strikeClip(
  lib: MotionLibrary, techId: string, info: StrikeInfo, stance: string, seed: number, commit: number,
  force?: string, tier = 3,
): MotionClipInfo | null {
  if (!USE[info.kind] || info.spin || info.switchStep || techId === 'tech.superman_punch') return null;
  const spec = TECH.get(techId);
  if (!spec) return null;
  const role = ROLE[spec.limb];
  if (force && lib.has(force)) {
    const c = lib.info(force);
    return c.limbRole === role && c.markers?.contact !== undefined ? c : null;
  }
  const cs = clipStance(stance);
  const ok = (c: MotionClipInfo): boolean => c.kind === 'strike' && c.limbRole === role && c.markers?.contact !== undefined;
  const all = lib.byTechnique(techId, cs).filter(ok);
  if (all.length === 0) return null;
  const direct = all.filter((c) => c.techniques?.includes(techId));
  let pool = direct.length ? direct : all;
  // Takes where the performer walked through the strike read as a lunge; keep
  // them for the stepping variants only (the sim's own lunge does the rest).
  const stepping = (spec.flags as readonly string[]).includes('stepIn');
  const travel = (c: MotionClipInfo): number => Math.hypot(c.rootMotion.displacement[0], c.rootMotion.displacement[1]);
  const still = pool.filter((c) => (stepping ? travel(c) >= 0.15 : travel(c) < 0.16));
  if (still.length) pool = still;
  // Source by skill: the ACCAD performer is a trained martial artist, the CMU
  // boxers are recreational. Elite fighters throw the trained takes; the lower
  // the tier, the likelier a recreational one (sloppier, bigger, squarer).
  const trained = pool.filter((c) => c.asset !== 'motion.cmu');
  const rec = pool.filter((c) => c.asset === 'motion.cmu');
  if (trained.length && rec.length) {
    const pRec = clamp((3.2 - tier) / 3.2, 0, 0.85);
    pool = hash01(seed, Math.round(commit), 92) < pRec ? rec : trained;
  }
  return pool[Math.floor(hash01(seed, Math.round(commit), 91) * pool.length) % pool.length];
}

/** Build (or reuse) the capture plan for the action being animated. */
export function capActionFor(
  cap: CapRig, ctx: Ctx, tm: ActionTiming, info: StrikeInfo, force?: string,
): CapAction | null {
  const st = ctx.st;
  const key = `${tm.id}@${Math.round(tm.commit)}@${Math.round(tm.contact)}@${Math.round(tm.end)}`;
  if (st.capAction && st.capAction.key === key) return st.capAction.plan;
  const tier = info.leg !== -1 ? st.tiers.values.kick : st.tiers.values.punch;
  const clip = strikeClip(cap.lib, tm.id, info, ctx.f.stance, st.seed, tm.contact, force, tier);
  const plan = clip ? buildPlan(cap, clip, tm, info, key) : null;
  st.capAction = { key, plan };
  return plan;
}

function buildPlan(cap: CapRig, clip: MotionClipInfo, tm: ActionTiming, info: StrikeInfo, key: string): CapAction | null {
  const lib = cap.lib;
  const h = lib.handle(clip.id);
  const m = clip.markers!;
  const fps = clip.fps;
  const C = m.contact!;
  const S = Math.min(m.start ?? Math.max(0, C - 6), C - 1);
  const E = Math.max(C + 2, Math.min(m.end ?? clip.frames - 1, clip.frames - 1));
  const startupS = Math.max(0.02, (tm.contact - tm.commit) / 1000);
  const recS = Math.max(0.05, (tm.end - tm.activeEnd) / 1000);
  const tc = C / fps;
  let t0 = clamp(tc - startupS, (S - 5) / fps, (S - 1) / fps);
  t0 = clamp(t0, 0, tc - 1 / fps);
  const tE = Math.min(E / fps, tc + Math.max(4 / fps, recS * 1.25));
  const hold = Math.min(1.5 / fps, (tE - tc) * 0.15);
  const leg = info.leg !== -1;
  const side = (leg ? info.leg : info.hand) as 0 | 1;
  const rel = (f: CapFrame): V3 => (leg ? sub(f.ank[side], f.hip[side]) : sub(f.fist[side], f.sh[side]));
  const f0 = cap.frame(h, t0), fc = cap.frame(h, tc), fE = cap.frame(h, tE);
  const c0 = rel(f0), cc = rel(fc), cE = rel(fE);
  // Monotone progress of the weapon along its own chord, per clip frame.
  const table = (ta: number, tb: number, a: V3, b: V3): Float32Array => {
    const n = Math.max(2, Math.ceil((tb - ta) * fps) + 1);
    const out = new Float32Array(n);
    const ab = sub(b, a);
    const L2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    let run = 0;
    for (let k = 0; k < n; k++) {
      const t = ta + (tb - ta) * k / (n - 1);
      let p: number;
      if (L2 < 1e-4) p = k / (n - 1);
      else {
        const c = rel(cap.frame(h, t));
        p = ((c[0] - a[0]) * ab[0] + (c[1] - a[1]) * ab[1] + (c[2] - a[2]) * ab[2]) / L2;
      }
      run = Math.max(run, clamp01(p));
      out[k] = run;
    }
    out[0] = 0;
    out[n - 1] = 1;
    return out;
  };
  return {
    key, h, clip, use: USE[info.kind]!, leg, side,
    commit: tm.commit, contact: tm.contact, activeEnd: tm.activeEnd, end: tm.end,
    t0, tc, tE, hold, f0, fc, fE,
    prog: table(t0, tc, c0, cc),
    ret: table(tc, tE, cc, cE),
  };
}

/** Clip time of the body at sim ms (the capture dwells a frame and a half through the active phase). */
function bodyTime(p: CapAction, ms: number): number {
  if (ms <= p.commit) return p.t0;
  if (ms < p.contact) return p.t0 + (ms - p.commit) / Math.max(1, p.contact - p.commit) * (p.tc - p.t0);
  if (ms < p.activeEnd) return p.tc + (ms - p.contact) / Math.max(1, p.activeEnd - p.contact) * p.hold;
  const u = clamp01((ms - p.activeEnd) / Math.max(1, p.end - p.activeEnd));
  return p.tc + p.hold + u * (p.tE - p.tc - p.hold);
}

/** Clip time of the weapon (held on contact through the active phase). */
function weaponTime(p: CapAction, ms: number): number {
  if (ms < p.contact) return bodyTime(p, ms);
  if (ms < p.activeEnd) return p.tc;
  const u = clamp01((ms - p.activeEnd) / Math.max(1, p.end - p.activeEnd));
  return p.tc + u * (p.tE - p.tc);
}

/** 0 until the active phase ends, then eases to 1 at the end (removes the clip's end residual). */
function endRamp(p: CapAction, ms: number): number {
  return ms <= p.activeEnd ? 0 : smooth((ms - p.activeEnd) / Math.max(1, p.end - p.activeEnd));
}

function tableAt(tab: Float32Array, u: number): number {
  const x = clamp01(u) * (tab.length - 1);
  const i = Math.min(tab.length - 2, Math.floor(x));
  return tab[i] + (tab[i + 1] - tab[i]) * (x - i);
}

/** Support reference: the non-kicking foot for kicks, both feet for punches. */
function support(f: CapFrame, p: CapAction): V3 {
  if (p.leg) return f.toe[(1 - p.side) as 0 | 1];
  return [(f.toe[0][0] + f.toe[1][0]) / 2, 0, (f.toe[0][2] + f.toe[1][2]) / 2];
}

/**
 * Pass 1: the body of a capture-driven strike. Writes the same Delta fields
 * the procedural `strikeBody` does.
 */
export function capStrikeBody(cap: CapRig, ctx: Ctx, tm: ActionTiming, info: StrikeInfo, d: Delta, p: CapAction): void {
  const now = ctx.nowMs;
  if (now < tm.commit || now > tm.end) return;
  const st = ctx.st;
  const s = st.rig.scale;
  const e = envelope(tm, now);
  const tp = st.tiers.punch;
  const tk = st.tiers.kick;
  const f = cap.frame(p.h, bodyTime(p, now));
  const r = endRamp(p, now);
  const { f0, fE } = p;
  const kick = p.leg;
  const rotK = kick ? Math.min(1.1, tk.kickHipRotation) : tp.capTorque;
  const moveK = 0.45 + 0.55 * Math.min(1, rotK);
  const heelK = st.tiers.stance.capHeel;
  const dl = (v: number, v0: number, vE: number): number => (v - v0) - r * (vE - v0);
  const da = (v: number, v0: number, vE: number): number => wrapAngle(v - v0) - r * wrapAngle(vE - v0);

  // Weight shift of the pelvis over the support.
  const po = (fr: CapFrame): V3 => sub(fr.pel, support(fr, p));
  const pc = po(f), p0 = po(f0), pE = po(fE);
  // Punches: the ACCAD performer leans into karate-style reverse punches and
  // drifts forward with his hooks; a boxer keeps his head over his hips, and
  // the sim's lunge (strikeRootOffset) already carries any reach. So forward
  // lean and translation are damped, and the forward drift is capped by the
  // room left in front of him.
  const lim = (kick ? 0.22 : 0.12) * s;
  const fwdLim = kick ? lim : Math.min(lim, 0.3 * Math.max(0, ctx.dist - 0.62));
  const pitchK = kick ? 1 : 0.6;
  const tK = kick ? moveK : moveK * 0.7;
  d.pelvisOff[0] += clamp(dl(pc[0], p0[0], pE[0]), -lim, lim) * tK;
  d.pelvisOff[1] += clamp(dl(pc[1], p0[1], pE[1]), -lim, (kick ? 0.05 : 0.02) * s) * tK;
  d.pelvisOff[2] += clamp(dl(pc[2], p0[2], pE[2]), -lim, fwdLim) * tK;
  // Hips, torso, head.
  d.pelvisYaw += da(f.pelYaw, f0.pelYaw, fE.pelYaw) * rotK;
  d.pelvisPitch += dl(f.pelPitch, f0.pelPitch, fE.pelPitch) * rotK * pitchK;
  d.pelvisRoll += dl(f.pelRoll, f0.pelRoll, fE.pelRoll) * rotK * pitchK;
  const sy = (fr: CapFrame): number => wrapAngle(fr.chYaw - fr.pelYaw);
  d.spineYaw += (sy(f) - sy(f0) - r * (sy(fE) - sy(f0))) * (0.35 + 0.65 * rotK);
  d.spinePitch += dl(f.chPitch - f.pelPitch, f0.chPitch - f0.pelPitch, fE.chPitch - fE.pelPitch) * (0.5 + 0.5 * rotK) * pitchK;
  d.spineRoll += dl(f.chRoll - f.pelRoll, f0.chRoll - f0.pelRoll, fE.chRoll - fE.pelRoll) * rotK;
  const hy = (fr: CapFrame): number => wrapAngle(fr.hdYaw - fr.chYaw);
  d.headYaw += (hy(f) - hy(f0) - r * (hy(fE) - hy(f0))) * 0.5;
  d.headPitch += dl(f.hdPitch - f.chPitch, f0.hdPitch - f0.chPitch, fE.hdPitch - fE.chPitch) * 0.6;
  d.headRoll += dl(f.hdRoll - f.chRoll, f0.hdRoll - f0.chRoll, fE.hdRoll - fE.chRoll) * 0.5;
  for (let k = 0; k < 2; k++) {
    d.clavRaise[k] += clamp(dl(f.clav[k * 2], f0.clav[k * 2], fE.clav[k * 2]), -0.5, 0.5) * (0.5 + 0.5 * rotK);
    d.clavFwd[k] += clamp(dl(f.clav[k * 2 + 1], f0.clav[k * 2 + 1], fE.clav[k * 2 + 1]), -0.5, 0.5) * (0.5 + 0.5 * rotK);
  }
  // Planted feet: pivot on the ball and lift the heel the way the performer did.
  for (const side of [0, 1] as const) {
    if (kick && side === p.side) continue;
    const pv = clamp(da(f.fYaw[side], f0.fYaw[side], fE.fYaw[side]), -1.4, 1.4);
    d.feet[side].pivot += pv * heelK * rotK;
    const hl = dl(f.fPitch[side], f0.fPitch[side], fE.fPitch[side]);
    d.feet[side].liftAdd += clamp(hl, -0.2, 0.9) * heelK;
  }

  // Tier tells on top of the capture.
  const over = tp.overcommitCm / 100 * s;
  if (!kick) {
    d.pelvisOff[2] += over * 0.5 * e.ext;
    d.spinePitch += tp.overcommitCm * 0.6 * DEG * e.body;
  } else {
    const kf = info.leg as 0 | 1;
    const sup = (1 - kf) as 0 | 1;
    d.feet[kf].hold = true;
    d.feet[sup].hold = !e.before || e.pre > 0.36 || lungeFor(ctx, tm, info) < 0.02;
    d.spinePitch += -tk.kickLeanBackDeg * DEG * bump(Math.min(1, e.pre * 1.2)) * (e.before ? 1 : 0);
    d.bounce *= 1 - e.body;
    capLegPass(cap, ctx, tm, info, null, d, true, p);
  }
  if (tm.id === 'tech.jab_pivot') {
    const hs = info.hand === 0 ? 1 : -1;
    d.feet[ctx.lead].pivot += -hs * 60 * DEG * (e.before ? 0 : bump(clamp01(e.dt / Math.max(1, tm.end - tm.contact))));
  }
  if (tm.id === 'tech.check_hook') {
    const hs = info.hand === 0 ? 1 : -1;
    d.frameYaw += -hs * 40 * DEG * (e.before ? 0 : bump(clamp01(e.dt / Math.max(1, tm.end - tm.contact))));
  }
  const burst = windowW(e.dt, -90, -20, 60, 200);
  d.face[2] += 0.5 * burst;
  d.face[4] += 0.35 * burst;
  d.face[3] += 0.25 * burst;
}

/**
 * Pass 2: hands of a capture-driven punch (the procedural pass places the
 * other hand and resolves the aim; the weapon then follows the capture).
 */
export function capStrikeHands(
  cap: CapRig, ctx: Ctx, tm: ActionTiming, info: StrikeInfo, spec: BodySpec, guard: GuardPose, p: CapAction,
): V3 | null {
  const aim = strikeHands(ctx, tm, info, spec, guard);
  const now = ctx.nowMs;
  if (now < tm.commit || now > tm.end) return aim;
  const st = ctx.st;
  const w = st.world;
  const fr = spec.frame;
  const rot = (v: V3): V3 => dirToWorld(fr, v);
  const tp = st.tiers.punch;
  const r = endRamp(p, now);
  if (p.leg) {
    // Kicks: both arms keep the performer's counter-swing around their guard.
    const f = cap.frame(p.h, bodyTime(p, now));
    const k = 0.85 * Math.min(1, st.tiers.kick.kickHipRotation);
    for (const side of [0, 1] as const) {
      const c = sub(f.fist[side], f.sh[side]);
      const c0 = sub(p.f0.fist[side], p.f0.sh[side]);
      const cE = sub(p.fE.fist[side], p.fE.sh[side]);
      const dv: V3 = [c[0] - c0[0] - r * (cE[0] - c0[0]), c[1] - c0[1] - r * (cE[1] - c0[1]), c[2] - c0[2] - r * (cE[2] - c0[2])];
      const h = spec.hands[side];
      h.pos = add(guard.pos[side], scaleV(rot(dv), k));
      // The kicking side's arm swings down and back past the hip: not a guard,
      // and its palm follows the arm (no roll toward the guard's palm).
      if (side === p.side) { h.exact = true; h.twist = 1 - smooth(Math.min(1, envelope(tm, now).body * 1.5)); }
    }
    return aim;
  }
  if (p.use !== 'full' || !aim) return aim;
  const hand = p.side;
  const g = spec.hands[hand];
  const S = worldP(w, hand === 0 ? B.lArm : B.rArm);
  const tW = weaponTime(p, now);
  const f = cap.frame(p.h, tW);
  const rel = (fr: CapFrame): V3 => rot(sub(fr.fist[hand], fr.sh[hand]));
  let cT = rel(f);
  const c0 = rel(p.f0), cC = rel(p.fc), cE = rel(p.fE);
  if (now < tm.contact) {
    // The wind-up: the part of the captured path that goes back, away from the
    // chord to the contact point, scaled by the tier (trained hands stay short).
    const ch = sub(cC, c0);
    const L = Math.hypot(ch[0], ch[1], ch[2]);
    if (L > 1e-3) {
      const u: V3 = [ch[0] / L, ch[1] / L, ch[2] / L];
      const dv = sub(cT, c0);
      const along = dv[0] * u[0] + dv[1] * u[1] + dv[2] * u[2];
      if (along < 0) cT = madd(cT, u, -along * (1 - tp.capWindup));
    }
  }
  const r0 = sub(guard.pos[hand], S);
  const rc = sub(aim, S);
  let rv: V3;
  let wIn = 1;
  if (now < tm.contact) {
    const u = (tW - p.t0) / Math.max(1e-6, p.tc - p.t0);
    wIn = tableAt(p.prog, u);
    rv = [
      cT[0] + (1 - wIn) * (r0[0] - c0[0]) + wIn * (rc[0] - cC[0]),
      cT[1] + (1 - wIn) * (r0[1] - c0[1]) + wIn * (rc[1] - cC[1]),
      cT[2] + (1 - wIn) * (r0[2] - c0[2]) + wIn * (rc[2] - cC[2]),
    ];
    // Novice tells: the fist drops before it goes and swings out wide.
    const out = hand === 0 ? 1 : -1;
    const tell = tp.fistDropCm / 100 * st.rig.scale;
    const e = envelope(tm, now);
    const dip = rot([0, -tell, -tell * 0.5]);
    const arc = rot([out * tp.capArc, 0, 0]);
    const bd = bump(Math.min(1, e.pre * 1.8)) * (1 - wIn);
    const ba = bump(wIn);
    rv = [rv[0] + dip[0] * bd + arc[0] * ba, rv[1] + dip[1] * bd + arc[1] * ba, rv[2] + dip[2] * bd + arc[2] * ba];
  } else if (now < tm.activeEnd) {
    // On target through the active phase (a landed shot sinks in a little).
    const e = envelope(tm, now);
    const sink = tm.result === 'landed' ? 0.025 : tm.result === 'missed' || tm.result === 'evaded' ? 0.06 : 0.01;
    rv = madd(rc, norm(rc), sink * st.rig.scale * bump(e.act));
  } else {
    const u = (tW - p.tc) / Math.max(1e-6, p.tE - p.tc);
    const w2 = Math.max(tableAt(p.ret, u), smooth(clamp01((now - tm.activeEnd) / Math.max(1, tm.end - tm.activeEnd))) * 0.999);
    rv = [
      cT[0] + (1 - w2) * (rc[0] - cC[0]) + w2 * (r0[0] - cE[0]),
      cT[1] + (1 - w2) * (rc[1] - cC[1]) + w2 * (r0[1] - cE[1]),
      cT[2] + (1 - w2) * (rc[2] - cC[2]) + w2 * (r0[2] - cE[2]),
    ];
    wIn = 1 - w2;
  }
  g.pos = add(S, rv);
  // Elbow and forearm roll from the capture, in from and back out to the guard's.
  const ext = now < tm.contact ? smooth(clamp01((now - tm.commit) / Math.max(1, (tm.contact - tm.commit) * 0.5)))
    : 1 - smooth(clamp01((now - tm.activeEnd) / Math.max(1, (tm.end - tm.activeEnd) * 0.8)));
  const elb = rot(sub(f.el[hand], f.sh[hand]));
  const out = hand === 0 ? 1 : -1;
  const capPole = add(add(S, scaleV(elb, 1.6)), rot([out * 0.05 * st.rig.scale, -0.05, -0.05]));
  const flare = tp.elbowFlareDeg / 25;
  const novPole = add(S, rot([out * (0.12 + 0.25 * flare) * st.rig.scale, -0.3 * st.rig.scale, -0.12 * st.rig.scale]));
  g.pole = vlerp(guard.pole[hand], vlerp(capPole, novPole, clamp01(flare * 0.6)), ext);
  g.palm = norm(vlerp(guard.palm[hand], rot(f.palm[hand]), ext));
  g.fistTarget = true;
  g.w = 1;
  void wIn;
  // The other hand keeps the performer's small movements around its home.
  const o = (1 - hand) as 0 | 1;
  const fb = cap.frame(p.h, bodyTime(p, now));
  const oc = sub(fb.fist[o], fb.sh[o]), o0 = sub(p.f0.fist[o], p.f0.sh[o]), oE = sub(p.fE.fist[o], p.fE.sh[o]);
  const odv: V3 = [oc[0] - o0[0] - r * (oE[0] - o0[0]), oc[1] - o0[1] - r * (oE[1] - o0[1]), oc[2] - o0[2] - r * (oE[2] - o0[2])];
  const ok = 0.5 * tp.capTorque;
  const lim = 0.08 * st.rig.scale;
  spec.hands[o].pos = add(spec.hands[o].pos, rot([clamp(odv[0], -lim, lim) * ok, clamp(odv[1], -lim, lim) * ok, clamp(odv[2], -lim, lim) * ok]));
  return aim;
}

function scaleV(v: V3, k: number): V3 { return [v[0] * k, v[1] * k, v[2] * k]; }

/**
 * The kicking leg on the captured path. Pass 1 (`estimate`) writes an ankle
 * override into the delta; pass 2 re-aims on the defender's solved body and
 * re-solves the leg.
 */
export function capLegPass(
  cap: CapRig, ctx: Ctx, tm: ActionTiming, info: StrikeInfo, spec: BodySpec | null, d: Delta, estimate: boolean,
  p: CapAction,
): V3 | null {
  const now = ctx.nowMs;
  if (now < tm.commit || now > tm.end || info.leg === -1) return null;
  const st = ctx.st;
  const rig = st.rig;
  const s = rig.scale;
  const e = envelope(tm, now);
  const kf = info.leg as 0 | 1;
  const fr = ctx.frame;
  const ctl = d.feet[kf];
  const w = st.world;
  const rot = (v: V3): V3 => dirToWorld(fr, v);

  let T: V3;
  if (estimate || !ctx.opp) {
    const tz = ctx.dist - 0.1;
    const hgt = tm.region === 'head' ? 1.55 : tm.region === 'body' ? 1.1 : tm.region === 'arms' ? 1.2 : 0.55;
    T = toWorld(fr, [0, hgt * (ctx.opp ? ctx.opp.rig.scale : 1), tz]);
  } else {
    T = aimPoint(ctx, tm, info) ?? toWorld(fr, [0, 1, ctx.dist]);
    if (!e.before && st.contactAim) T = st.contactAim;
    if (e.before) st.contactAim = null;
    else if (!st.contactAim) st.contactAim = T;
  }
  const hipJ: V3 = estimate
    ? toWorld(fr, [(kf === 0 ? 1 : -1) * 0.1 * s, rig.hipsY - 0.05 * s, (kf === ctx.lead ? 0.12 : -0.12) * s])
    : worldP(w, kf === 0 ? B.lUpLeg : B.rUpLeg);
  const planted = ankleOf(rig, kf, {
    ball: st.feet[kf].ball, yaw: st.feet[kf].yaw, lift: 0, airPitch: 0, pole: [0, 0, 0], toeFlat: 1, ankle: null,
  });
  const geo = kickGeometry(ctx, tm, info, hipJ, T);
  const tk = st.tiers.kick;
  const noReset = hash01(st.seed, Math.floor(tm.commit), 5) < tk.kickReturnSkip;
  const land = noReset ? toWorld(fr, [(kf === 0 ? 1 : -1) * 0.2 * s, 0.07 * s, 0.1 * s]) : planted;
  const tW = weaponTime(p, now);
  const f = cap.frame(p.h, tW);
  const rel = (x: CapFrame): V3 => rot(sub(x.ank[kf], x.hip[kf]));
  const cT = rel(f), c0 = rel(p.f0), cC = rel(p.fc), cE = rel(p.fE);
  const r0 = sub(planted, hipJ), rc = sub(geo.ankleC, hipJ), rE = sub(land, hipJ);
  let A: V3;
  let wC: number;
  if (now < tm.contact) {
    wC = tableAt(p.prog, (tW - p.t0) / Math.max(1e-6, p.tc - p.t0));
    A = [
      hipJ[0] + cT[0] + (1 - wC) * (r0[0] - c0[0]) + wC * (rc[0] - cC[0]),
      hipJ[1] + cT[1] + (1 - wC) * (r0[1] - c0[1]) + wC * (rc[1] - cC[1]),
      hipJ[2] + cT[2] + (1 - wC) * (r0[2] - c0[2]) + wC * (rc[2] - cC[2]),
    ];
  } else if (now < tm.activeEnd) {
    wC = 1;
    A = geo.ankleC;
  } else {
    const u = (tW - p.tc) / Math.max(1e-6, p.tE - p.tc);
    const w2 = Math.max(tableAt(p.ret, u), smooth(clamp01((now - tm.activeEnd) / Math.max(1, tm.end - tm.activeEnd))) * 0.999);
    wC = 1 - w2;
    A = [
      hipJ[0] + cT[0] + (1 - w2) * (rc[0] - cC[0]) + w2 * (rE[0] - cE[0]),
      hipJ[1] + cT[1] + (1 - w2) * (rc[1] - cC[1]) + w2 * (rE[1] - cE[1]),
      hipJ[2] + cT[2] + (1 - w2) * (rc[2] - cC[2]) + w2 * (rE[2] - cE[2]),
    ];
    if (noReset && e.rec > 0.6) {
      ctl.land = [land[0], 0, land[2]];
      ctl.landYaw = fr.yaw;
    }
  }
  // Never through the floor.
  A[1] = Math.max(A[1], rig.ankleFromBall[kf][1] * 0.8);
  // The knee follows the performer's, turning into the contact configuration.
  const kneeRel = rot(sub(f.knee[kf], f.hip[kf]));
  const fwd = rot([0, 0, 1]);
  const capPole = add(add(hipJ, scaleV(kneeRel, 1.6)), add(scaleV(fwd, 0.15), [0, 0.05, 0]));
  const kc = wC * wC;
  const pole = vlerp(capPole, geo.poleC, kc);
  const pre = e.pre;
  const wgt = e.before ? smooth(Math.min(1, pre / 0.12)) : 1 - smooth(clamp01((e.rec - 0.88) / 0.12));
  ctl.hold = true;
  ctl.ankle = A;
  ctl.ankleW = Math.max(ctl.ankleW, wgt);
  ctl.pole = pole;
  ctl.airPitch = info.weapon === 'ball_of_foot' ? -0.6 : info.weapon === 'heel' ? -0.9 : 0.9;
  if (!estimate && spec) {
    const chain = kf === 0 ? LIMBS.lLeg : LIMBS.rLeg;
    const base = ankleOf(rig, kf, spec.feet[kf]);
    const target = vlerp(base, A, clamp01(wgt));
    st.weapon = { hand: -1, leg: kf, aim: T, ankle: target, pole };
    solveTwoBone(st.pose, w, rig.rest, chain, target, pole, 1, KNEE_MAX_FLEX);
    forwardKinematics(w, st.pose, rig.rest);
  }
  return T;
}

// ---------------------------------------------------------------------------
// Defences
// ---------------------------------------------------------------------------

export interface CapDefence {
  key: string;
  h: number;
  t0: number; tHold: number; tE: number;
  /** Sim ms: start, hold (contact), release, end. */
  a: number; b: number; c: number; e: number;
  f0: CapFrame; fE: CapFrame;
}

const DEF_TIMING: Partial<Record<DefMotion, [number, number, number, number]>> = {
  slipOut: [230, 20, 120, 280], slipIn: [230, 20, 120, 280],
  duck: [250, 20, 120, 300], roll: [280, 0, 100, 320], duckUnder: [280, 20, 150, 350],
  block: [220, 50, 160, 260], cover: [220, 40, 400, 400], chinTuck: [200, 40, 150, 250],
  blockKick: [280, 70, 200, 300], parry: [190, 20, 60, 200], catch: [200, 30, 90, 220],
  parryDown: [240, 30, 90, 260],
};

/** The defence clip for this defence (null: procedural). */
function defenceClip(cap: CapRig, ctx: Ctx, ad: ActiveDefence): number | null {
  const lib = cap.lib;
  const cs = clipStance(ctx.f.stance);
  const pick = (ids: string[]): number | null => {
    for (const id of ids) if (lib.has(id)) return lib.handle(id);
    return null;
  };
  const byHead = (ids: string[], wantX: number): number | null => {
    let best: number | null = null, bestV = -Infinity;
    for (const id of ids) {
      if (!lib.has(id)) continue;
      const h = lib.handle(id);
      const v = cap.defProfile(h).headAtHold[0] * wantX;
      if (v > bestV) { bestV = v; best = h; }
    }
    return bestV > 0.03 ? best : null;
  };
  const fs = ad.fromSide;
  const body = ad.t.region === 'body';
  const leadSide = ctx.lead === 0 ? 1 : -1; // +1: my lead hand is on my left
  switch (ad.motion) {
    case 'slipOut': case 'slipIn': {
      const dir = ad.motion === 'slipOut' ? fs : -fs;
      return byHead([`defence.slip_left.${cs}`, `defence.slip_right.${cs}`], dir);
    }
    case 'roll': case 'duckUnder': case 'duck': {
      const dir = ad.motion === 'duck' ? (hash01(ctx.st.seed, Math.round(ad.t.contact), 93) < 0.5 ? 1 : -1) : fs;
      return byHead([`defence.duck_left.${cs}`, `defence.duck_right.${cs}`], dir) ?? pick([`defence.duck_left.${cs}`]);
    }
    case 'block': case 'cover': case 'chinTuck':
      if (body) return pick([fs === leadSide ? `defence.block_mid_lead.${cs}` : `defence.block_mid_rear.${cs}`]);
      return pick([`defence.block_high.${cs}`]);
    case 'blockKick':
      return pick([fs === leadSide ? (body ? `defence.block_mid_lead.${cs}` : `defence.block_high_lead.${cs}`) : (body ? `defence.block_mid_rear.${cs}` : `defence.block_high_rear.${cs}`)]);
    case 'parry': case 'catch':
      return pick([fs === leadSide ? `defence.block_high_lead.${cs}` : `defence.block_high_rear.${cs}`]);
    case 'parryDown':
      return pick([fs === leadSide ? `defence.block_low_lead.${cs}` : `defence.block_low_rear.${cs}`]);
    default:
      return null;
  }
}

export function capDefenceFor(cap: CapRig, ctx: Ctx, ad: ActiveDefence): CapDefence | null {
  const st = ctx.st;
  const key = `${ad.motion}@${Math.round(ad.t.contact)}@${ad.t.id}`;
  if (st.capDefence && st.capDefence.key === key) return st.capDefence.plan;
  const h = defenceClip(cap, ctx, ad);
  let plan: CapDefence | null = null;
  const tmg = DEF_TIMING[ad.motion];
  if (h !== null && tmg) {
    const pr = cap.defProfile(h);
    const c = ad.t.contact;
    // The captured release is cut to the defence's own release time.
    const tE = Math.min(pr.tEnd, pr.tHold + (tmg[2] + tmg[3]) / 1000 * 1.1);
    plan = {
      key, h, t0: pr.t0, tHold: pr.tHold, tE,
      a: c - tmg[0], b: c - tmg[1], c: c + tmg[2], e: c + tmg[2] + tmg[3],
      f0: cap.frame(h, pr.t0), fE: cap.frame(h, tE),
    };
  }
  st.capDefence = { key, plan };
  return plan;
}

/** Pass 1: the body of a capture-driven defence (and the head displacement strikers aim around). */
export function capDefenceBody(cap: CapRig, ctx: Ctx, ad: ActiveDefence, d: Delta, p: CapDefence): boolean {
  const now = ctx.nowMs;
  if (now <= p.a || now >= p.e) return false;
  let t: number;
  if (now < p.b) t = p.t0 + (now - p.a) / Math.max(1, p.b - p.a) * (p.tHold - p.t0);
  else if (now < p.c) t = p.tHold;
  else t = p.tHold + (now - p.c) / Math.max(1, p.e - p.c) * (p.tE - p.tHold);
  const r = now <= p.c ? 0 : smooth((now - p.c) / Math.max(1, p.e - p.c));
  const f = cap.frame(p.h, t);
  const { f0, fE } = p;
  const s = ctx.st.rig.scale;
  const mid = (fr: CapFrame): V3 => [(fr.toe[0][0] + fr.toe[1][0]) / 2, 0, (fr.toe[0][2] + fr.toe[1][2]) / 2];
  const po = (fr: CapFrame): V3 => sub(fr.pel, mid(fr));
  const pc = po(f), p0 = po(f0), pE = po(fE);
  const dl = (v: number, v0: number, vE: number): number => (v - v0) - r * (vE - v0);
  const da = (v: number, v0: number, vE: number): number => wrapAngle(v - v0) - r * wrapAngle(vE - v0);
  const lim = 0.25 * s;
  d.pelvisOff[0] += clamp(dl(pc[0], p0[0], pE[0]), -lim, lim);
  d.pelvisOff[1] += clamp(dl(pc[1], p0[1], pE[1]), -lim, 0.05);
  d.pelvisOff[2] += clamp(dl(pc[2], p0[2], pE[2]), -lim, lim);
  d.pelvisYaw += da(f.pelYaw, f0.pelYaw, fE.pelYaw);
  d.pelvisPitch += dl(f.pelPitch, f0.pelPitch, fE.pelPitch);
  d.pelvisRoll += dl(f.pelRoll, f0.pelRoll, fE.pelRoll);
  const sy = (fr: CapFrame): number => wrapAngle(fr.chYaw - fr.pelYaw);
  d.spineYaw += sy(f) - sy(f0) - r * (sy(fE) - sy(f0));
  d.spinePitch += dl(f.chPitch - f.pelPitch, f0.chPitch - f0.pelPitch, fE.chPitch - fE.pelPitch);
  d.spineRoll += dl(f.chRoll - f.pelRoll, f0.chRoll - f0.pelRoll, fE.chRoll - fE.pelRoll);
  const hy = (fr: CapFrame): number => wrapAngle(fr.hdYaw - fr.chYaw);
  d.headYaw += (hy(f) - hy(f0) - r * (hy(fE) - hy(f0))) * 0.6;
  d.headPitch += dl(f.hdPitch - f.chPitch, f0.hdPitch - f0.chPitch, fE.hdPitch - fE.chPitch) * 0.6;
  d.headRoll += dl(f.hdRoll - f.chRoll, f0.hdRoll - f0.chRoll, fE.hdRoll - fE.chRoll) * 0.6;
  // Where the head went (relative to the feet), for the attacker's aim.
  const hc = sub(f.head, mid(f)), h0 = sub(f0.head, mid(f0)), hE = sub(fE.head, mid(fE));
  const ev: V3 = [dl(hc[0], h0[0], hE[0]), dl(hc[1], h0[1], hE[1]), dl(hc[2], h0[2], hE[2])];
  d.evade = add(d.evade, dirToWorld(ctx.frame, ev));
  if (ad.motion === 'block' || ad.motion === 'cover' || ad.motion === 'chinTuck' || ad.motion === 'blockKick') {
    d.guardDrop = Math.max(d.guardDrop, ad.w);
  }
  return true;
}

export { clamp };
