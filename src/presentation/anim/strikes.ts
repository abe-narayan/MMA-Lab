/**
 * L1 — STRIKES. Every one of the 54 catalogue techniques, by family, as
 * chamber -> extension -> contact -> retraction curves on the body spec.
 *
 * Timing: the curves are written against the action's own timeline
 * (commit -> contact -> active end -> end, from `timing.ts`), so whatever the
 * tier / fatigue multipliers did to the duration, the moment of impact is the
 * recorded instant: `pre` reaches 1 exactly at `contact`, and at pre = 1 the
 * weapon IS on the aim point (IK, not a clip that "should" line up).
 *
 * Aim: the weapon goes to a point on the defender's current solved body
 * (`targets.ts`). A landed strike lands on it; a blocked one lands on the
 * glove/forearm in the way; an evaded one goes where the head WAS before the
 * slip; a missed one goes past, over-extended.
 *
 * Body (pass 1): hips, torso, shoulders, head, feet — the part a viewer reads
 * as technique (a cross turns the hips and pivots the rear foot; a jab covers
 * the chin with the lead shoulder; a kick pivots the standing foot and turns
 * the hip over). Limbs (pass 2): the striking hand / leg, aimed.
 */
import { B } from '../rig/skeleton';
import { LIMBS, solveTwoBone } from '../rig/ik';
import {
  DEG, add, bump, clamp, clamp01, cross, dist, dot, hash01, launch, len, lerp, madd, norm,
  qaxis, qrot, qslerp, scale, settle, smooth, sub, toWorld, dirToWorld, vlerp, windowW,
  type V3,
} from './math';
import { ankleOf, worldP, type BodySpec } from './spec';
import { forwardKinematics } from '../rig/skeleton';
import type { Ctx, Delta, FighterState } from './state';
import type { GuardPose } from './stance';
import { blockPoint, missPoint, targetPoint, type AimInput, type Approach } from './targets';
import { TECH, type ActionTiming, type Region } from './timing';

export type MotionKind =
  | 'jab' | 'cross' | 'hook' | 'uppercut' | 'overhand' | 'backfist'
  | 'elbow' | 'knee' | 'round' | 'teep' | 'side' | 'axe' | 'spinBack' | 'wheel' | 'oblique'
  | 'levelChange' | 'shot' | 'grapple' | 'feint';

export interface StrikeInfo {
  kind: MotionKind;
  /** Striking hand (0 L / 1 R) or -1. */
  hand: -1 | 0 | 1;
  /** Striking leg (0 L / 1 R) or -1. */
  leg: -1 | 0 | 1;
  body: boolean;
  step: number;
  spin: boolean;
  switchStep: boolean;
  approach: Approach;
  weapon: string;
}

/**
 * The motion used for a technique id. Exhaustive over the catalogue families
 * — `tests/presentation.anim.test.ts` checks that no id falls through.
 */
export function classify(id: string, lead: 0 | 1): StrikeInfo {
  const spec = TECH.get(id);
  const rear = (1 - lead) as 0 | 1;
  const base: StrikeInfo = {
    kind: 'grapple', hand: -1, leg: -1, body: false, step: 0, spin: false, switchStep: false,
    approach: 'front', weapon: 'fist',
  };
  if (!spec) {
    if (id === 'tech.level_change') return { ...base, kind: 'levelChange' };
    if (/leg|double|single|tackle|crotch|ankle|shot|takedown/.test(id)) return { ...base, kind: 'shot', step: 0.45 };
    if (id.startsWith('feint')) return { ...base, kind: 'feint', hand: lead };
    return base;
  }
  const flags = spec.flags as readonly string[];
  const hand = spec.limb === 'leadHand' ? lead : spec.limb === 'rearHand' ? rear : -1;
  const legSide = spec.limb === 'leadLeg' ? lead : spec.limb === 'rearLeg' ? rear : -1;
  const info: StrikeInfo = {
    ...base,
    hand: hand as -1 | 0 | 1,
    leg: legSide as -1 | 0 | 1,
    body: spec.targets[0] === 'body',
    step: flags.includes('stepIn') ? (id === 'tech.superman_punch' || id === 'tech.knee_flying' ? 0.6 : 0.4) : 0,
    spin: flags.includes('spinning'),
    switchStep: flags.includes('switchStep'),
    weapon: spec.weapon,
  };
  switch (spec.family) {
    case 'straight':
      info.kind = spec.limb === 'leadHand' ? 'jab' : 'cross';
      info.approach = 'front';
      if (id === 'tech.superman_punch') info.approach = 'above';
      return info;
    case 'hook':
      info.kind = 'hook';
      info.approach = id === 'tech.shovel_hook' || id === 'tech.bolo' ? 'sideLow' : 'side';
      return info;
    case 'uppercut':
      info.kind = 'uppercut'; info.approach = 'below';
      return info;
    case 'overhand':
      info.kind = 'overhand'; info.approach = 'above';
      return info;
    case 'elbow':
      info.kind = 'elbow';
      info.approach = id === 'tech.elbow_upward' ? 'below' : id === 'tech.elbow_downward' ? 'above' : id === 'tech.elbow_diagonal' ? 'sideHigh' : 'side';
      return info;
    case 'knee':
      info.kind = 'knee'; info.approach = 'below';
      return info;
    case 'teep':
      info.kind = 'teep'; info.approach = 'front';
      return info;
    case 'lowKick':
      info.kind = id === 'tech.kick_oblique' ? 'oblique' : 'round';
      info.approach = id === 'tech.kick_inside_low' ? 'inside' : id === 'tech.kick_oblique' ? 'front' : 'sideLow';
      return info;
    case 'bodyKick':
      info.kind = id === 'tech.kick_side' ? 'side' : 'round';
      info.approach = id === 'tech.kick_side' ? 'front' : 'side';
      return info;
    case 'headKick':
      info.kind = id === 'tech.kick_axe' ? 'axe' : 'round';
      info.approach = id === 'tech.kick_axe' ? 'above' : 'sideHigh';
      return info;
    case 'spinning':
      if (spec.limb === 'rearHand') {
        info.kind = spec.weapon === 'elbow' ? 'elbow' : 'backfist';
        info.approach = 'side';
        info.spin = true;
      } else {
        info.kind = id === 'tech.kick_wheel' ? 'wheel' : 'spinBack';
        info.approach = id === 'tech.kick_wheel' ? 'sideHigh' : 'front';
        info.spin = true;
      }
      return info;
  }
  return info;
}

/** Envelope values of an action at `now`. */
export interface Env {
  pre: number;
  before: boolean;
  /** 1 at contact, rising over the startup and falling over the recovery. */
  ext: number;
  /** A slightly wider envelope for the body (hips lead, settle last). */
  body: number;
  /** 0..1 over the recovery phase. */
  rec: number;
  /** 0..1 over the active phase. */
  act: number;
  dt: number;
}

export function envelope(tm: ActionTiming, now: number): Env {
  const pre = clamp01((now - tm.commit) / Math.max(1, tm.contact - tm.commit));
  const before = now < tm.contact;
  const recDur = Math.max(1, tm.end - tm.activeEnd);
  const rec = clamp01((now - tm.activeEnd) / recDur);
  const act = clamp01((now - tm.contact) / Math.max(1, tm.activeEnd - tm.contact));
  const ext = before ? launch(pre) : now < tm.activeEnd ? 1 : 1 - settle(rec);
  const body = before ? smooth(Math.min(1, pre * 1.15)) : now < tm.activeEnd ? 1 : 1 - smooth(rec);
  return { pre, before, ext, body, rec, act, dt: now - tm.contact };
}

/** Estimated distance from the attacker's root to the target surface (pass 1). */
function reachNeed(ctx: Ctx, region: Region): number {
  const depth = region === 'head' ? 0.1 : region === 'body' ? 0.13 : 0.08;
  return ctx.dist - depth * (ctx.opp ? ctx.opp.rig.scale : 1);
}

/** How far forward (local z) the body must travel for this strike to reach. */
export function lungeFor(ctx: Ctx, tm: ActionTiming, info: StrikeInfo): number {
  const s = ctx.st.rig.scale;
  const rig = ctx.st.rig;
  const need = reachNeed(ctx, tm.region);
  let avail: number;
  let max = 0.22 + info.step * 0.8;
  switch (info.kind) {
    case 'jab': avail = rig.armLen + 0.25 * s; break;
    case 'cross': case 'overhand': avail = rig.armLen + 0.28 * s; break;
    case 'hook': case 'backfist': avail = rig.armLen * 0.7 + 0.02 * s; max += 0.12; break;
    case 'uppercut': avail = rig.armLen * 0.55 + 0.1 * s; max += 0.1; break;
    case 'elbow': avail = rig.upperArm + 0.06 * s; max = 0.36; break;
    case 'knee': avail = rig.thigh + 0.5 * s; max = 0.35 + info.step; break;
    case 'feint': return 0;
    case 'levelChange': return 0.12 * s;
    case 'shot': return 0.45 * s;
    default: {
      // Kicks: the hip travels over the support foot; beyond that the support
      // foot steps up before the chamber. Reach is limited by the target height.
      const rearLeg = info.leg !== ctx.lead;
      const os = ctx.opp ? ctx.opp.rig.scale : 1;
      const h = tm.region === 'head' ? 1.55 * os : tm.region === 'body' ? 1.12 * os : 0.55 * os;
      const dh = h - rig.hipsY * 0.97;
      const L = rig.legLen * (info.weapon === 'shin' ? 0.97 : 1.05);
      const horiz = Math.sqrt(Math.max(0.01, L * L - dh * dh));
      // Foot-first head kicks (instep, heel) reach a little less than a shin.
      const footHead = tm.region === 'head' && info.weapon !== 'shin' ? 0.14 : 0;
      avail = horiz + ((rearLeg ? 0.36 : 0.14) - footHead) * s;
      max = 0.45;
    }
  }
  // Never step through the opponent: keep the hips at least ~0.55 m apart.
  return clamp(need - avail, 0, Math.min(max * s, Math.max(0, ctx.dist - 0.55)));
}

/** Root offset (local) the action asks for at time `now`. Pure in time, so the feet can anticipate it. */
export function strikeRootOffset(ctx: Ctx, tm: ActionTiming, info: StrikeInfo, now: number): V3 {
  if (now < tm.commit || now > tm.end) return [0, 0, 0];
  const e = envelope(tm, now);
  const l = lungeFor(ctx, tm, info);
  // Lunge arrives just before contact and returns over the recovery. A kick's
  // step-up happens before the chamber (the support foot is then planted).
  const legs = info.leg !== -1;
  const inW = e.before ? smooth(Math.min(1, e.pre * (legs ? 2.8 : 1.3))) : 1 - smooth(e.rec);
  let z = l * inW;
  let x = 0;
  if (tm.id === 'tech.jab_backstep') z -= 0.28 * ctx.st.rig.scale * (e.before ? 0 : smooth(Math.min(1, e.dt / 250))) * (1 - smooth(e.rec));
  if (tm.id === 'tech.jab_pivot' || tm.id === 'tech.check_hook') {
    x = -(ctx.lead === 0 ? 1 : -1) * 0.22 * ctx.st.rig.scale * (e.before ? 0 : bump(Math.min(1, (e.dt / Math.max(1, tm.end - tm.contact)))));
  }
  return [x, 0, z];
}

// ---------------------------------------------------------------------------
// Pass 1: body
// ---------------------------------------------------------------------------

export function strikeBody(ctx: Ctx, tm: ActionTiming, info: StrikeInfo, d: Delta): void {
  const now = ctx.nowMs;
  if (now < tm.commit || now > tm.end) return;
  const st = ctx.st;
  const s = st.rig.scale;
  const e = envelope(tm, now);
  const tp = st.tiers.punch;
  const tk = st.tiers.kick;
  const k = tp.armOnly; // hip rotation (novices throw with the arm)
  const off = strikeRootOffset(ctx, tm, info, now);
  const hs = info.hand === 0 ? 1 : -1; // +1 when the striking hand is the left
  const ls = info.leg === 0 ? 1 : -1;
  const b = e.body;
  const x = e.ext;
  const lvl = info.body ? 1 : 0;
  const over = tp.overcommitCm / 100 * s;

  switch (info.kind) {
    case 'jab': {
      d.spineYaw += -hs * 15 * DEG * x * (0.4 + 0.6 * k);
      d.pelvisYaw += -hs * 6 * DEG * b * k;
      d.pelvisOff[2] += 0.035 * s * b + over * 0.5 * x;
      d.clavRaise[info.hand as 0 | 1] += 13 * DEG * x * k;
      d.clavFwd[info.hand as 0 | 1] += 16 * DEG * x;
      d.spineRoll += -hs * 3.5 * DEG * b * k;
      d.headPitch += 4 * DEG * b * k;
      if (lvl) { d.pelvisOff[1] -= 0.12 * s * b; d.spinePitch += 12 * DEG * b; d.spineRoll += -hs * 5 * DEG * b; }
      if (tm.id === 'tech.jab_up') { d.pelvisOff[1] -= 0.05 * s * b; d.spinePitch += 5 * DEG * b; }
      if (tm.id === 'tech.jab_power') { d.pelvisYaw += -hs * 6 * DEG * b * k; d.pelvisOff[2] += 0.03 * s * b; }
      // The lead foot pushes on a stepping jab; on a pivot jab the lead foot turns.
      if (tm.id === 'tech.jab_pivot') d.feet[ctx.lead].pivot += -hs * 60 * DEG * (e.before ? 0 : bump(clamp01(e.dt / Math.max(1, tm.end - tm.contact))));
      break;
    }
    case 'cross': {
      const rot = (Math.abs(stanceBlade(ctx)) + 22 * DEG) * k;
      d.pelvisYaw += -hs * rot * b;
      d.spineYaw += -hs * 18 * DEG * x * (0.3 + 0.7 * k);
      const rf = info.hand as 0 | 1;
      d.feet[rf].pivot += -hs * 58 * DEG * b * k;
      d.feet[rf].lift = 42 * DEG; d.feet[rf].liftW = Math.max(d.feet[rf].liftW, b * k);
      d.pelvisOff[2] += (0.06 * s + over) * b;
      d.pelvisOff[0] += ctx.sd * 0.03 * s * b;
      d.spineRoll += hs * 4 * DEG * b;
      d.spinePitch += (5 * DEG + tp.overcommitCm * 0.6 * DEG) * b;
      d.clavFwd[rf] += 18 * DEG * x;
      d.clavRaise[rf] += 6 * DEG * x;
      d.headPitch += 3 * DEG * b;
      if (lvl) { d.pelvisOff[1] -= 0.13 * s * b; d.spinePitch += 14 * DEG * b; d.spineRoll += hs * 6 * DEG * b; }
      if (tm.id === 'tech.superman_punch') {
        // Skip-step: the rear knee fakes forward, then the body flies in over it.
        const early = windowW(e.pre, 0, 0.25, 0.45, 0.75);
        const lf = rf;
        d.feet[lf].hold = true;
        d.feet[lf].ankleW = Math.max(d.feet[lf].ankleW, early);
        const hip = add(toWorld(ctx.frame, [0, 0, 0]), [0, st.rig.hipsY * 0.9, 0]);
        d.feet[lf].ankle = add(hip, dirToWorld(ctx.frame, [-ctx.sd * 0.12 * s, -0.35 * s, 0.25 * s]));
        d.pelvisOff[1] += 0.06 * s * bump(e.pre);
      }
      break;
    }
    case 'hook': {
      const load = e.before ? windowW(e.pre, 0, 0.25, 0.3, 0.6) : 0;
      d.pelvisYaw += hs * 8 * DEG * load * k - hs * 26 * DEG * x * k;
      d.spineYaw += hs * 6 * DEG * load - hs * 32 * DEG * x * (0.35 + 0.65 * k);
      const pf = info.hand as 0 | 1;
      d.feet[pf].pivot += -hs * 42 * DEG * x * k;
      d.feet[pf].lift = 28 * DEG; d.feet[pf].liftW = Math.max(d.feet[pf].liftW, x * k);
      d.pelvisOff[0] += -hs * 0.03 * s * x;
      d.clavRaise[pf] += 10 * DEG * x;
      d.spineRoll += hs * 3 * DEG * x;
      d.headPitch += 3 * DEG * b;
      if (lvl || tm.id === 'tech.shovel_hook') {
        d.pelvisOff[1] -= (lvl ? 0.13 : 0.06) * s * b;
        d.spineRoll += -hs * 11 * DEG * b;
        d.spinePitch += 7 * DEG * b;
      }
      if (tm.id === 'tech.bolo') d.spineRoll += -hs * 6 * DEG * bump(e.pre);
      if (tm.id === 'tech.check_hook') d.frameYaw += -hs * 40 * DEG * (e.before ? 0 : bump(clamp01(e.dt / Math.max(1, tm.end - tm.contact))));
      break;
    }
    case 'uppercut': {
      const dip = e.before ? windowW(e.pre, 0, 0.45, 0.55, 1.0) : 0;
      d.pelvisOff[1] -= 0.075 * s * dip - 0.02 * s * x;
      d.spineRoll += -hs * 9 * DEG * dip;
      d.pelvisYaw += hs * 8 * DEG * dip - hs * 20 * DEG * x * k;
      d.spineYaw += -hs * 14 * DEG * x * k;
      d.spinePitch += 6 * DEG * dip - 5 * DEG * x;
      const pf = info.hand as 0 | 1;
      if (pf !== ctx.lead) {
        d.feet[pf].pivot += -hs * 40 * DEG * x * k;
        d.feet[pf].lift = 35 * DEG; d.feet[pf].liftW = Math.max(d.feet[pf].liftW, x * k);
      }
      if (lvl) d.pelvisOff[1] -= 0.06 * s * b;
      break;
    }
    case 'overhand': {
      d.pelvisOff[1] -= 0.09 * s * b;
      d.spinePitch += 18 * DEG * b;
      d.spineRoll += hs * 12 * DEG * b;
      d.pelvisYaw += -hs * (Math.abs(stanceBlade(ctx)) + 30 * DEG) * b * k;
      d.spineYaw += -hs * 22 * DEG * x;
      const rf = info.hand as 0 | 1;
      d.feet[rf].pivot += -hs * 60 * DEG * b * k;
      d.feet[rf].lift = 45 * DEG; d.feet[rf].liftW = Math.max(d.feet[rf].liftW, b * k);
      d.pelvisOff[2] += (0.1 * s + over) * b;
      d.clavRaise[rf] += 20 * DEG * windowW(e.pre, 0.1, 0.5, 0.9, 1.2);
      break;
    }
    case 'backfist':
    case 'elbow':
    case 'wheel':
    case 'spinBack': {
      if (info.spin) spinBody(ctx, tm, info, d, e);
      else elbowBody(ctx, tm, info, d, e);
      if (info.kind === 'wheel' || info.kind === 'spinBack') kickBody(ctx, tm, info, d, e);
      break;
    }
    case 'knee': {
      const kf = info.leg as 0 | 1;
      const sup = (1 - kf) as 0 | 1;
      // Hips drive forward over the support foot and through.
      d.pelvisOff[2] += ((sup === ctx.lead ? 0.24 : 0.05) + 0.1) * s * b;
      d.pelvisOff[1] += 0.03 * s * b;
      d.pelvisPitch += -12 * DEG * b;
      d.spinePitch += -6 * DEG * b;
      d.feet[sup].lift = 30 * DEG; d.feet[sup].liftW = Math.max(d.feet[sup].liftW, b);
      d.feet[sup].hold = !e.before || e.pre > 0.36 || lungeFor(ctx, tm, info) < 0.02;
      d.pelvisOff[0] += (sup === 0 ? 1 : -1) * 0.05 * s * b;
      d.feet[kf].hold = true;
      if (tm.id === 'tech.knee_flying') {
        const jump = windowW(e.pre, 0.35, 0.85, 1.05, 1.4);
        d.pelvisOff[1] += 0.28 * s * jump;
        d.feet[sup].ankleW = Math.max(d.feet[sup].ankleW, jump);
        d.feet[sup].ankle = add(toWorld(ctx.frame, [(sup === 0 ? 1 : -1) * 0.1 * s, 0, off[2] - 0.05]), [0, 0.25 * s + 0.1 * jump, 0]);
      }
      // Estimated leg (pass 2 re-aims it on the real target).
      legPass(ctx, tm, info, null, d, true);
      break;
    }
    case 'round': case 'teep': case 'side': case 'axe': case 'oblique': {
      kickBody(ctx, tm, info, d, e);
      legPass(ctx, tm, info, null, d, true);
      break;
    }
    case 'levelChange':
    case 'shot': {
      const depth = st.tiers.wrestle.levelChangeDepth;
      const bend = 1 - depth;
      d.pelvisOff[1] -= (info.kind === 'shot' ? 0.3 : 0.2) * s * b * depth;
      d.spinePitch += (22 + 38 * bend) * DEG * b;
      d.pelvisPitch += 8 * DEG * b;
      d.headPitch += -(18 - 30 * bend) * DEG * b;
      d.guardDown += 0.15 * b;
      break;
    }
    case 'feint': {
      const w = bump(clamp01((now - tm.commit) / Math.max(1, tm.end - tm.commit)));
      d.spineYaw += -hs * 8 * DEG * w;
      d.clavRaise[info.hand as 0 | 1] += 8 * DEG * w;
      d.pelvisOff[1] -= 0.02 * s * w;
      break;
    }
    case 'grapple':
      break;
  }
  // Effort: brows down and a sharp exhale at contact.
  const burst = windowW(e.dt, -90, -20, 60, 200);
  d.face[2] += 0.5 * burst;
  d.face[4] += 0.35 * burst;
  d.face[3] += 0.25 * burst;
}

/** Share of a switch kick's startup spent on the switch step. */
const SWITCH_END = 0.32;

export function stanceBlade(ctx: Ctx): number {
  return ctx.st.tiers.stance.blade * DEG * (ctx.st.tiers.guardStyle === 'thai' ? 0.7 : 1);
}

function elbowBody(ctx: Ctx, tm: ActionTiming, info: StrikeInfo, d: Delta, e: Env): void {
  const s = ctx.st.rig.scale;
  const hs = info.hand === 0 ? 1 : -1;
  const k = ctx.st.tiers.punch.armOnly;
  const x = e.ext;
  const up = tm.id === 'tech.elbow_upward';
  const down = tm.id === 'tech.elbow_downward' || tm.id === 'tech.elbow_diagonal';
  d.pelvisYaw += -hs * 24 * DEG * x * k;
  d.spineYaw += -hs * 30 * DEG * x;
  d.pelvisOff[2] += 0.05 * s * e.body;
  const pf = info.hand as 0 | 1;
  d.feet[pf].pivot += -hs * 45 * DEG * x * k;
  d.feet[pf].lift = 30 * DEG; d.feet[pf].liftW = Math.max(d.feet[pf].liftW, x * k);
  d.clavRaise[pf] += (down ? 25 : 14) * DEG * x;
  if (up) { d.pelvisOff[1] -= 0.05 * s * (e.before ? bump(e.pre) : 0); d.spinePitch += -6 * DEG * x; }
  if (down) { d.spinePitch += 10 * DEG * x; d.pelvisOff[1] -= 0.04 * s * x; }
}

/** Spinning techniques: the stance frame turns through the spin; the lead foot pivots on its ball. */
function spinBody(ctx: Ctx, tm: ActionTiming, info: StrikeInfo, d: Delta, e: Env): void {
  const ang = spinAngle(tm, info, ctx.nowMs);
  const dir = ctx.sd; // orthodox spins clockwise from above (turn right = negative yaw)
  d.frameYaw += -dir * ang;
  const lead = ctx.lead;
  const rear = (1 - lead) as 0 | 1;
  // The lead foot pivots with the body; the rear foot swings around it.
  d.feet[lead].pivot += -dir * ang;
  d.feet[lead].hold = true;
  d.feet[lead].lift = 25 * DEG; d.feet[lead].liftW = Math.max(d.feet[lead].liftW, smooth(Math.min(1, ang / 0.5)));
  if (info.leg === -1) {
    // Rear foot steps across behind, then back into stance at the end of the spin.
    d.feet[rear].hold = true;
    const s = ctx.st.rig.scale;
    const w = windowW(ang / (2 * Math.PI), 0.02, 0.12, 0.85, 0.98);
    const fr = ctx.frame;
    const phi = -dir * ang;
    const c = Math.cos(phi), sn = Math.sin(phi);
    const la: V3 = [-ctx.sd * 0.14 * s, 0, -0.24 * s];
    const rl: V3 = [la[0] * c + la[2] * sn, 0.07 * s + 0.05 * s * bump(ang / (2 * Math.PI)), -la[0] * sn + la[2] * c];
    d.feet[rear].ankle = toWorld(fr, rl);
    d.feet[rear].ankleW = Math.max(d.feet[rear].ankleW, w);
  }
  d.headYaw += dir * ang * 0.15 * (e.before ? 1 : 0);
  d.lookW *= 1 - 0.6 * bump(clamp01(ang / (2 * Math.PI)));
}

/** Spin angle (radians, 0..2pi) through a spinning technique. */
export function spinAngle(tm: ActionTiming, info: StrikeInfo, now: number): number {
  const e = envelope(tm, now);
  const atContact = info.kind === 'spinBack' ? Math.PI * 1.0 : info.kind === 'elbow' ? Math.PI * 1.55 : Math.PI * 1.72;
  if (e.before) return atContact * launch(e.pre);
  if (info.kind === 'spinBack') return atContact * (1 - smooth(e.rec));
  return atContact + (2 * Math.PI - atContact) * smooth(Math.min(1, (now - tm.contact) / Math.max(1, tm.end - tm.contact) * 1.4));
}

function kickBody(ctx: Ctx, tm: ActionTiming, info: StrikeInfo, d: Delta, e: Env): void {
  const st = ctx.st;
  const s = st.rig.scale;
  const tk = st.tiers.kick;
  const kf = info.leg as 0 | 1;
  const sup = (1 - kf) as 0 | 1;
  const ks = kf === 0 ? 1 : -1;
  const hip = tk.kickHipRotation;
  const b = e.body;
  const x = e.ext;
  const lean = tk.kickLeanBackDeg * DEG;
  const head = tm.region === 'head';
  const low = tm.region === 'leadLeg' || tm.region === 'rearLeg';
  d.feet[kf].hold = true;
  // The support foot may still step up early in the startup; then it is planted.
  d.feet[sup].hold = !e.before || e.pre > 0.36 || lungeFor(ctx, tm, info) < 0.02;
  // Support foot on the ball.
  d.feet[sup].lift = (low ? 18 : 30) * DEG;
  d.feet[sup].liftW = Math.max(d.feet[sup].liftW, b);
  // Weight over the support foot: for a rear-leg kick the hips travel forward
  // onto the lead foot, which is most of a kick's reach.
  if (info.spin) {
    // Spinning: frame-independent — the hips go over the pivoting support foot.
    const sb = ctx.st.feet[sup].ball;
    d.pelvisWorld[0] += (sb[0] - ctx.frame.ox) * 0.6 * b;
    d.pelvisWorld[2] += (sb[2] - ctx.frame.oz) * 0.6 * b;
  } else {
    d.pelvisOff[0] += (sup === 0 ? 1 : -1) * 0.07 * s * b;
    d.pelvisOff[2] += (sup === ctx.lead || info.switchStep ? 0.24 : -0.12) * s * b;
  }
  switch (info.kind) {
    case 'round': case 'wheel': {
      const turn = (head ? 85 : low ? 55 : 75) * DEG * hip;
      d.feet[sup].pivot += -ks * turn * 1.05 * b;
      // The hip leads the leg: most of the turn is in by the chamber.
      d.pelvisYaw += -ks * turn * (0.55 * b + 0.45 * x);
      d.pelvisRoll += ks * (head ? 22 : low ? 6 : 14) * DEG * x * hip;
      d.spineRoll += ks * (head ? 20 : low ? 4 : 10) * DEG * x;
      d.spineYaw += ks * (head ? 12 : 8) * DEG * x;
      d.spinePitch += -lean * bump(Math.min(1, e.pre * 1.2)) - (head ? 8 : 2) * DEG * x;
      d.pelvisOff[1] += (head ? 0.02 : low ? -0.05 : 0) * s * x;
      break;
    }
    case 'teep': case 'oblique': {
      // The hips drive through the teep; the shoulders lean back to balance it.
      d.spinePitch += -(14 * DEG + lean) * x;
      d.pelvisPitch += -10 * DEG * x;
      d.pelvisOff[2] += 0.14 * s * x;
      d.pelvisYaw += -ks * (info.kind === 'oblique' ? 25 : 10) * DEG * x;
      d.feet[sup].pivot += -ks * 20 * DEG * b;
      break;
    }
    case 'side': case 'spinBack': {
      const turn = (info.kind === 'side' ? 80 : 0) * DEG;
      d.pelvisYaw += -ks * turn * x;
      if (info.kind === 'side') d.pelvisOff[2] += 0.12 * s * x;
      d.feet[sup].pivot += -ks * turn * 1.1 * b;
      d.pelvisRoll += ks * 14 * DEG * x;
      d.spineRoll += ks * 16 * DEG * x;
      // A side kick leans away sideways; a spinning back kick leans away forward
      // (the target is behind him) and looks over the shoulder.
      d.spinePitch += (info.kind === 'spinBack' ? 22 : -6) * DEG * x;
      break;
    }
    case 'axe': {
      d.spinePitch += -14 * DEG * windowW(e.pre, 0.2, 0.7, 0.8, 1) + 10 * DEG * (e.before ? 0 : x);
      d.feet[sup].pivot += -ks * 25 * DEG * b;
      d.pelvisYaw += -ks * 25 * DEG * x;
      break;
    }
  }
  if (info.switchStep && e.before && e.pre < SWITCH_END) {
    // The switch: a small hop that trades the feet — the kicking (lead) foot
    // back, the rear foot up into the lead spot — before the kick proper.
    const u = clamp01(e.pre / SWITCH_END);
    const sd = ctx.sd;
    const fr = ctx.frame;
    const hop = 0.05 * s * bump(u);
    const place = (side: 0 | 1, from: V3, to: V3, yaw: number): void => {
      const a = vlerp(from, to, smooth(u));
      const ctl = d.feet[side];
      ctl.hold = true;
      ctl.ankle = toWorld(fr, [a[0], 0.07 * s + hop, a[2]]);
      ctl.ankleW = 1;
      ctl.pole = toWorld(fr, [a[0] * 1.5, 0.6, a[2] + 0.6]);
      const ball = toWorld(fr, [to[0], 0, to[2] + 0.14 * s]);
      ctl.land = [ball[0], 0, ball[2]];
      ctl.landYaw = fr.yaw + yaw;
    };
    place(kf, [sd * 0.11 * s, 0, 0.25 * s], [sd * 0.13 * s, 0, -0.12 * s], -sd * 45 * DEG);
    place(sup, [-sd * 0.13 * s, 0, -0.25 * s], [-sd * 0.1 * s, 0, 0.12 * s], sd * 12 * DEG);
  }
  d.bounce *= 1 - b;
}

// ---------------------------------------------------------------------------
// Aim
// ---------------------------------------------------------------------------

export function aimInput(ctx: Ctx, tm: ActionTiming, info: StrikeInfo): AimInput | null {
  if (!ctx.opp || !ctx.oppSnap) return null;
  const weaponSide = info.hand !== -1 ? (info.hand === 0 ? 1 : -1) : info.leg !== -1 ? (info.leg === 0 ? 1 : -1) : 1;
  return {
    attacker: ctx.st,
    defender: ctx.opp,
    region: tm.region,
    subLocation: tm.subLocation,
    approach: info.approach,
    weaponSide,
    defenderLead: ctx.oppSnap.stance === 'orthodox' ? 0 : 1,
  };
}

/**
 * The aim point for this strike, by result: landed on the target, blocked on
 * the guard, evaded at where the head was, missed past the head.
 */
export function aimPoint(ctx: Ctx, tm: ActionTiming, info: StrikeInfo): V3 | null {
  const inp = aimInput(ctx, tm, info);
  if (!inp) return null;
  const hit = targetPoint(inp);
  const opp = ctx.opp!;
  const res = tm.result;
  const kick = info.leg !== -1;
  const evasive = opp.delta.evade;
  const sideSign = hash01(ctx.st.seed, Math.floor(tm.contact)) < 0.5 ? -1 : 1;
  let pendingAim = hit;
  // Before the result is known, a defender already slipping is aimed at where he was.
  if (len(evasive) > 0.02) pendingAim = sub(hit, evasive);
  let resAim: V3 = pendingAim;
  switch (res) {
    case 'landed': case 'caught': resAim = hit; break;
    case 'blocked': resAim = blockPoint(inp, kick || info.kind === 'elbow' || info.kind === 'knee'); break;
    case 'checked': {
      const lead = inp.defenderLead;
      const shin = ctx.opp!.world;
      const a = worldP(shin, lead === 0 ? B.lLeg : B.rLeg);
      const f = worldP(shin, lead === 0 ? B.lFoot : B.rFoot);
      resAim = vlerp(a, f, 0.3);
      break;
    }
    case 'evaded': resAim = madd(sub(hit, evasive), norm(sub(hit, ctx.st.displayRoot)), 0.04); break;
    case 'missed': resAim = missPoint(inp, hit, sideSign, kick ? 0.12 : 0.1); break;
    default: resAim = pendingAim;
  }
  if (res === 'pending') return pendingAim;
  // Blend from the pending aim to the result aim from when the result became known.
  const known = ctx.st.knownAt;
  const span = Math.max(40, tm.contact - known);
  const w = clamp01((ctx.nowMs - known) / span);
  return vlerp(pendingAim, resAim, smooth(w));
}

// ---------------------------------------------------------------------------
// Pass 2: striking limbs
// ---------------------------------------------------------------------------

/**
 * Hands for a striking fighter: overrides the guard for the striking hand
 * (and moves the other hand where the technique wants it). Returns the aim
 * point used (debug), or null.
 */
export function strikeHands(ctx: Ctx, tm: ActionTiming, info: StrikeInfo, spec: BodySpec, guard: GuardPose): V3 | null {
  const now = ctx.nowMs;
  if (now < tm.commit || now > tm.end) return null;
  const st = ctx.st;
  const s = st.rig.scale;
  const e = envelope(tm, now);
  const tp = st.tiers.punch;
  const w = st.world;
  const other = info.hand === -1 ? -1 : ((1 - info.hand) as 0 | 1);

  // The non-punching hand stays home — on the chin (novices drop it).
  if (other !== -1) {
    const dropP = tp.handsDropAfterPunch;
    const drop = hash01(st.seed, Math.floor(tm.commit), 3) < dropP ? 1 : 0;
    // The other glove stays glued to its own side of the chin, whatever the torso does.
    const sideX = other === 0 ? 1 : -1;
    const chin = add(worldP(w, B.head), dirToWorld(spec.frame, [sideX * 0.075 * s, -0.02 * s, 0.1 * s]));
    const home = vlerp(guard.pos[other], chin, 0.8 * e.body * (1 - drop));
    const g = spec.hands[other];
    g.pos = add(home, [0, -0.22 * s * drop * e.body, 0]);
  }

  if (info.kind === 'knee' || info.kind === 'round' || info.kind === 'teep' || info.kind === 'side'
    || info.kind === 'axe' || info.kind === 'oblique' || info.kind === 'spinBack' || info.kind === 'wheel') {
    kickArms(ctx, tm, info, spec, guard, e);
    return null;
  }
  if (info.kind === 'levelChange' || info.kind === 'shot' || info.kind === 'grapple') {
    for (const side of [0, 1] as const) {
      const g = spec.hands[side];
      const reach = dirToWorld(spec.frame, [(side === 0 ? 1 : -1) * 0.18 * s, -0.25 * s, 0.35 * s]);
      g.pos = vlerp(guard.pos[side], add(worldP(w, B.spine2), reach), e.body * 0.8);
      g.fist = lerp(g.fist, 0.2, e.body);
    }
    return null;
  }
  const hand = info.hand as 0 | 1;
  const hs = hand === 0 ? 1 : -1;
  const out = hs; // own left = +X
  const g = spec.hands[hand];
  const G = guard.pos[hand];
  const aim0 = aimPoint(ctx, tm, info);
  const shoulder = worldP(w, hand === 0 ? B.lArm : B.rArm);
  let aim: V3 = aim0 ?? add(shoulder, dirToWorld(spec.frame, [0, 0, st.rig.armLen + st.rig.fistLen]));
  // After contact the fist stays where it struck (the head snaps away from it).
  if (!e.before && st.contactAim) aim = st.contactAim;
  if (e.before) st.contactAim = null;
  else if (!st.contactAim) st.contactAim = aim;
  const loop = tp.punchLoop;
  const flare = tp.elbowFlareDeg / 25;
  const tell = tp.fistDropCm / 100 * s;
  const fr = spec.frame;
  const locDir = (v: V3): V3 => dirToWorld(fr, v);

  let p: V3;
  let pole: V3;
  let palm: V3;
  const retract = (from: V3): V3 => {
    // Active: hold on target (a landed shot sinks in a few cm); recovery: back to guard.
    if (now < tm.activeEnd) {
      const sink = tm.result === 'landed' ? 0.025 : tm.result === 'missed' || tm.result === 'evaded' ? 0.06 : 0.01;
      return madd(from, norm(sub(from, shoulder)), sink * s * bump(e.act));
    }
    const low = tp.handsDropAfterPunch > 0.5 ? locDir([0, -0.15 * s * tp.handsDropAfterPunch, 0]) : [0, 0, 0] as V3;
    const home = add(G, scale(low, bump(e.rec)));
    return vlerp(from, home, settle(e.rec));
  };

  switch (info.kind) {
    case 'jab': case 'cross': case 'feint': {
      if (info.kind === 'feint') {
        const f = bump(clamp01((now - tm.commit) / Math.max(1, tm.end - tm.commit)));
        const tgt = madd(G, norm(sub(aim, G)), 0.35 * len(sub(aim, G)));
        g.pos = vlerp(G, tgt, f);
        g.pole = guard.pole[hand];
        g.palm = guard.palm[hand];
        return null;
      }
      if (e.before) {
        const u = launch(e.pre);
        // Novice tell: the fist dips before it goes.
        const dip = locDir([0, -tell, -tell * 0.5]);
        p = add(vlerp(G, aim, u), scale(dip, bump(Math.min(1, e.pre * 1.8)) * (1 - u)));
        // Loose novices swing the straight out wide.
        p = add(p, scale(locDir([out * 0.12 * s * (loop - 1), 0, 0]), bump(e.pre)));
      } else p = retract(aim);
      const ext = e.before ? launch(e.pre) : 1 - settle(e.rec);
      pole = add(shoulder, locDir([out * (0.12 + 0.25 * flare) * s, -0.3 * s, -0.12 * s]));
      pole = vlerp(guard.pole[hand], pole, ext);
      palm = normV(vlerpV(guard.palm[hand], [0, -1, 0], ext * (0.6 + 0.4 * (1 - flare))));
      break;
    }
    case 'hook': case 'backfist': {
      // A horizontal arc around the chest; the hips and torso carry most of it.
      const chest = worldP(w, B.spine2);
      const c: V3 = [chest[0], aim[1], chest[2]];
      const rT = Math.max(0.25 * s, Math.hypot(aim[0] - c[0], aim[2] - c[2]));
      const angT = Math.atan2(aim[0] - c[0], aim[2] - c[2]);
      // A trained hook is short and tight; a novice's loops wide (tier.punch_loop).
      const sweep = (info.kind === 'backfist' ? 1.2 : 0.7 + 0.9 * (loop - 1)) * (tm.id === 'tech.bolo' ? 1.6 : 1);
      if (e.before) {
        const u = launch(e.pre);
        const ang = angT + hs * sweep * (1 - u) * (1 - u * 0.2);
        const r = lerp(Math.max(rT * 0.7, 0.26 * s) * (1 + 0.5 * (loop - 1)), rT, u);
        const y = lerp(G[1], aim[1], smooth(e.pre * 1.3)) - (tm.id === 'tech.bolo' ? 0.25 * s * bump(e.pre) : 0);
        const arc: V3 = [c[0] + Math.sin(ang) * r, y, c[2] + Math.cos(ang) * r];
        // Leave the guard first (the hand does not teleport onto the arc).
        p = vlerp(G, arc, smooth(Math.min(1, e.pre * 2.2)));
      } else if (now < tm.activeEnd) {
        p = retract(aim);
      } else {
        // Follow-through past the target, then home.
        const ang = angT - hs * (tm.result === 'missed' || tm.result === 'evaded' ? 0.7 : 0.2) * bump(Math.min(1, e.rec * 1.5));
        const ft: V3 = [c[0] + Math.sin(ang) * rT, aim[1], c[2] + Math.cos(ang) * rT];
        p = vlerp(ft, G, settle(e.rec));
      }
      const ext = e.before ? smooth(e.pre * 1.4) : 1 - settle(e.rec);
      // Elbow up and out, level with the fist.
      pole = add(shoulder, locDir([out * 0.45 * s, (info.body ? -0.2 : 0.02) * s, -0.2 * s]));
      pole = vlerp(guard.pole[hand], pole, ext);
      palm = normV(vlerpV(guard.palm[hand], info.kind === 'backfist' ? locDir([-out, 0, 0.3]) : [0, -1, 0], ext));
      break;
    }
    case 'uppercut': {
      const low = add(worldP(w, B.spine1), locDir([out * 0.12 * s, 0.02 * s, 0.22 * s]));
      if (e.before) {
        const u = e.pre;
        const dropW = windowW(u, 0, 0.35, 0.45, 0.8);
        const mid = vlerp(G, low, dropW);
        p = u < 0.55 ? mid : vlerp(low, aim, launch((u - 0.55) / 0.45));
        if (u >= 0.55) p = vlerp(mid, p, smooth((u - 0.55) / 0.2));
      } else p = retract(aim);
      const ext = e.before ? smooth(e.pre * 1.3) : 1 - settle(e.rec);
      pole = add(shoulder, locDir([out * 0.18 * s, -0.4 * s, 0.05 * s]));
      pole = vlerp(guard.pole[hand], pole, ext);
      palm = normV(vlerpV(guard.palm[hand], locDir([0, 0.3, -1]), ext));
      break;
    }
    case 'overhand': {
      if (e.before) {
        const u = e.pre;
        const top = add(shoulder, locDir([out * 0.25 * s, 0.25 * s, 0.1 * s]));
        const q1 = vlerp(G, top, smooth(Math.min(1, u / 0.5)));
        p = u < 0.5 ? q1 : vlerp(top, aim, launch((u - 0.5) / 0.5));
      } else p = retract(aim);
      const ext = e.before ? smooth(e.pre * 1.3) : 1 - settle(e.rec);
      pole = add(shoulder, locDir([out * 0.35 * s, 0.25 * s, -0.1 * s]));
      pole = vlerp(guard.pole[hand], pole, ext);
      palm = normV(vlerpV(guard.palm[hand], locDir([out * 0.3, -1, 0.2]), ext));
      break;
    }
    case 'elbow': {
      // The elbow point is the weapon: place the elbow joint on the aim with the forearm folded.
      const up = st.rig.upperArm;
      const dir = norm(sub(aim, shoulder));
      // Exactly an upper arm from the shoulder, so the IK puts the elbow joint here.
      const E_c = madd(shoulder, dir, up * 0.999);
      let E: V3;
      const ext = e.before ? launch(e.pre) : 1 - settle(e.rec);
      const upward = tm.id === 'tech.elbow_upward';
      const down = tm.id === 'tech.elbow_downward' || tm.id === 'tech.elbow_diagonal';
      const start = add(shoulder, locDir([out * 0.25 * s, (upward ? -0.25 : down ? 0.3 : 0.05) * s, -0.02 * s]));
      if (e.before) E = vlerp(start, E_c, launch(e.pre));
      else E = vlerp(E_c, start, settle(e.rec));
      // Fold the forearm back past the face.
      const fold = normV(add(sub(worldP(w, B.head), E), locDir([0, upward ? 0.1 : -0.05, 0])));
      p = madd(E, fold, st.rig.foreArm * 0.999);
      p = vlerp(G, p, clamp01(ext * 1.6));
      pole = madd(E, sub(E, p), 0.5);
      palm = locDir([-out, 0, -0.5]);
      g.fistTarget = false;
      g.pos = p; g.pole = pole; g.palm = normV(palm); g.w = 1; g.fist = 1;
      if (info.spin) {
        g.pos = vlerp(G, p, clamp01(ext * 1.3));
      }
      return aim;
    }
    default:
      return null;
  }
  g.pos = p;
  g.pole = pole;
  g.palm = palm;
  g.w = 1;
  g.fist = lerp(g.fist, 1, clamp01(e.ext * 2));
  g.fistTarget = true;
  return aim;
}

function kickArms(ctx: Ctx, tm: ActionTiming, info: StrikeInfo, spec: BodySpec, guard: GuardPose, e: Env): void {
  const st = ctx.st;
  const s = st.rig.scale;
  const w = st.world;
  const kf = info.leg as 0 | 1;
  const other = (1 - kf) as 0 | 1;
  const fr = spec.frame;
  const x = e.body;
  if (info.kind === 'knee') {
    // Both hands reach for the head / collar tie, pulling down into the knee.
    const oh = ctx.opp ? worldP(ctx.opp.world, B.neck) : add(worldP(w, B.head), dirToWorld(fr, [0, 0, 0.5]));
    for (const side of [0, 1] as const) {
      const g = spec.hands[side];
      const t = add(oh, dirToWorld(fr, [(side === 0 ? 1 : -1) * 0.08 * s, -0.05 * s, -0.08 * s]));
      const r = sub(t, worldP(w, side === 0 ? B.lArm : B.rArm));
      const tt = len(r) > st.rig.armLen * 0.95 ? madd(worldP(w, side === 0 ? B.lArm : B.rArm), norm(r), st.rig.armLen * 0.95) : t;
      g.pos = vlerp(guard.pos[side], tt, x * (tm.id === 'tech.knee_flying' ? 0.6 : 0.85));
      g.fist = lerp(g.fist, 0.3, x);
    }
    return;
  }
  // The kicking-side arm swings down and back for counterbalance; the other covers the face.
  const g = spec.hands[kf];
  const hip = worldP(w, kf === 0 ? B.lUpLeg : B.rUpLeg);
  const swing = info.kind === 'round' || info.kind === 'wheel'
    ? add(hip, dirToWorld(fr, [(kf === 0 ? 1 : -1) * 0.1 * s, 0.05 * s, -0.25 * s]))
    : add(worldP(w, B.spine1), dirToWorld(fr, [(kf === 0 ? 1 : -1) * 0.25 * s, 0.1 * s, 0.1 * s]));
  const noReset = st.tiers.kick.kickReturnSkip;
  g.pos = vlerp(guard.pos[kf], swing, x * (0.8 + 0.2 * noReset));
  const cover = add(worldP(w, B.head), dirToWorld(fr, [(other === 0 ? 1 : -1) * 0.02 * s, -0.02 * s, 0.14 * s]));
  const o = spec.hands[other];
  o.pos = vlerp(guard.pos[other], cover, x * (1 - 0.7 * noReset));
}

/**
 * The kicking / kneeing leg. In pass 1 (`estimate`) it writes an ankle
 * override into the delta from an estimated target; in pass 2 it re-aims on
 * the defender's solved body and re-solves the leg directly.
 */
export function legPass(
  ctx: Ctx, tm: ActionTiming, info: StrikeInfo, spec: BodySpec | null, d: Delta, estimate: boolean,
): V3 | null {
  const now = ctx.nowMs;
  if (now < tm.commit || now > tm.end || info.leg === -1) return null;
  const st = ctx.st;
  const rig = st.rig;
  const s = rig.scale;
  const e = envelope(tm, now);
  const kf = info.leg as 0 | 1;
  const ks = kf === 0 ? 1 : -1;
  const fr = ctx.frame;
  const ctl = d.feet[kf];
  const w = st.world;

  let T: V3;
  if (estimate || !ctx.opp) {
    const tz = ctx.dist - 0.1;
    const h = tm.region === 'head' ? 1.55 : tm.region === 'body' ? 1.1 : tm.region === 'arms' ? 1.2 : 0.55;
    const lx = info.kind === 'round' ? (tm.region === 'leadLeg' ? -ks * 0.05 : 0) : 0;
    T = toWorld(fr, [lx * s, h * (ctx.opp ? ctx.opp.rig.scale : 1), tz]);
  } else {
    T = aimPoint(ctx, tm, info) ?? toWorld(fr, [0, 1, ctx.dist]);
    if (!e.before && st.contactAim) T = st.contactAim;
    if (e.before) st.contactAim = null;
    else if (!st.contactAim) st.contactAim = T;
  }
  // Hip joint of the kicking leg (estimate from the frame in pass 1).
  const hipJ: V3 = estimate
    ? toWorld(fr, [(kf === 0 ? 1 : -1) * 0.1 * s, rig.hipsY - 0.05 * s, (kf === ctx.lead ? 0.12 : -0.12) * s])
    : worldP(w, kf === 0 ? B.lUpLeg : B.rUpLeg);
  const L = rig.legLen;
  const planted = ankleOf(rig, kf, {
    ball: st.feet[kf].ball, yaw: st.feet[kf].yaw, lift: 0, airPitch: 0, pole: [0, 0, 0], toeFlat: 1, ankle: null,
  });
  const fwd = dirToWorld(fr, [0, 0, 1]);
  const up: V3 = [0, 1, 0];
  const outward = dirToWorld(fr, [ks, 0, 0]);
  const toT = norm(sub(T, hipJ));

  // Contact configuration.
  let ankleC: V3;
  let poleC: V3;
  let chamber: V3;
  let poleCh: V3;
  const knee = info.kind === 'knee';
  const footLead = info.weapon === 'ball_of_foot' || info.weapon === 'heel' || info.weapon === 'instep';
  if (knee) {
    const K = madd(hipJ, toT, rig.thigh);
    const kC = dist(T, hipJ) < rig.thigh ? T : K;
    const shinDir = norm(add(scale(toT, -0.35), [0, -1, 0]));
    ankleC = madd(kC, shinDir, rig.shin);
    poleC = madd(kC, toT, 0.4);
    chamber = madd(hipJ, norm(add(scale(fwd, 0.4), [0, -0.9, 0])), L * 0.55);
    poleCh = madd(hipJ, add(fwd, [0, 0.3, 0]), 0.6);
  } else if (info.kind === 'teep' || info.kind === 'side' || info.kind === 'spinBack' || info.kind === 'oblique') {
    const reach = Math.min(dist(T, hipJ) - (footLead ? 0.035 * s : 0), L * 0.99);
    ankleC = madd(hipJ, toT, reach);
    poleC = add(madd(hipJ, toT, L * 0.5), [0, 0.35, 0]);
    const chDir = norm(add(scale(toT, 0.55), [0, -0.55, 0]));
    chamber = madd(hipJ, chDir, L * 0.42);
    poleCh = madd(hipJ, norm(add(toT, [0, 0.6, 0])), 0.7);
    if (info.kind === 'oblique') poleCh = madd(hipJ, norm(add(outward, [0, 0.4, 0])), 0.7);
  } else if (info.kind === 'axe') {
    ankleC = madd(hipJ, toT, Math.min(dist(T, hipJ), L * 0.985));
    poleC = madd(hipJ, add(toT, [0, 0.5, 0]), 0.6);
    chamber = madd(hipJ, norm(add(scale(fwd, 0.35), [0, 1, 0])), L * 0.97);
    poleCh = madd(hipJ, fwd, 0.6);
  } else {
    // Round kick (low / body / head, wheel): straight leg through the target; shin on target.
    const dT = dist(T, hipJ);
    ankleC = madd(hipJ, toT, Math.max(dT, Math.min(L * 0.993, dT + rig.shin * 0.35)));
    if (info.weapon === 'instep') ankleC = madd(hipJ, toT, Math.min(L * 0.993, dT + 0.05));
    poleC = madd(madd(hipJ, toT, L * 0.5), up, 0.3);
    // In range with a bent knee: put the knee just above the line so the SHIN
    // (not a straight-leg approximation) passes through the target.
    const K = madd(hipJ, norm(add(toT, [0, 0.22, 0])), rig.thigh);
    const kT = dist(T, K);
    if (info.weapon === 'shin' && kT < rig.shin * 0.92 && kT > rig.shin * 0.3) {
      ankleC = madd(K, norm(sub(T, K)), rig.shin * 0.999);
      poleC = madd(K, norm(sub(K, hipJ)), 0.3);
    }
    // Chamber: the knee up and pointing at the target, the heel folded back
    // beside the hip on the kicking side (the hip is turning over).
    const sideDir = scale(norm(cross(up, toT)), ks);
    const lift = tm.region === 'head' ? 0.25 : tm.region === 'body' ? 0.02 : -0.2;
    chamber = madd(hipJ, norm(add(add(scale(sideDir, 0.85), scale(toT, 0.12)), [0, lift, 0])), L * 0.5);
    poleCh = madd(hipJ, norm(add(toT, [0, 0.35 + lift, 0])), 0.8);
    if (info.kind === 'wheel') chamber = madd(hipJ, norm(add(scale(fwd, -0.3), scale(outward, -0.8))), L * 0.8);
  }

  // Timeline: planted -> chamber -> contact -> (follow-through) -> re-chamber -> planted.
  let ank: V3;
  let pole: V3;
  const tk = st.tiers.kick;
  const chamberAt = info.kind === 'round' ? 0.5 : 0.55;
  const noReset = hash01(st.seed, Math.floor(tm.commit), 5) < tk.kickReturnSkip;
  // A switch kick spends the start of its startup on the switch step (kickBody).
  if (info.switchStep && e.before && e.pre < SWITCH_END) return null;
  const pre = info.switchStep ? clamp01((e.pre - SWITCH_END) / (1 - SWITCH_END)) : e.pre;
  if (e.before) {
    if (pre < chamberAt) {
      const u = smooth(pre / chamberAt);
      ank = arcLerp(hipJ, planted, chamber, u);
      pole = vlerp(add(planted, add(scale(fwd, 0.6), [0, 0.5, 0])), poleCh, u);
    } else {
      const u = launch((pre - chamberAt) / (1 - chamberAt));
      ank = arcLerp(hipJ, chamber, ankleC, u);
      pole = vlerp(poleCh, poleC, u);
    }
  } else if (now < tm.activeEnd) {
    // Active: a landed kick stays; a missed round kick carries through.
    const through = tm.result === 'missed' || tm.result === 'evaded' ? 0.5 : tm.result === 'checked' ? -0.3 : 0.12;
    const swingAxis = norm(cross(sub(chamber, hipJ), sub(ankleC, hipJ)));
    const q = qaxis(swingAxis, through * e.act);
    ank = add(hipJ, qrot(q, sub(ankleC, hipJ)));
    pole = poleC;
    if (tm.result === 'caught') ank = ankleC;
  } else {
    const through = tm.result === 'missed' || tm.result === 'evaded' ? 0.5 : tm.result === 'checked' ? -0.3 : 0.12;
    const swingAxis = norm(cross(sub(chamber, hipJ), sub(ankleC, hipJ)));
    const aEnd = add(hipJ, qrot(qaxis(swingAxis, through), sub(ankleC, hipJ)));
    const r = tm.result === 'caught' ? clamp01((e.rec - 0.5) / 0.5) : e.rec;
    if (r < 0.45) {
      ank = arcLerp(hipJ, aEnd, chamber, smooth(r / 0.45));
      pole = vlerp(poleC, poleCh, smooth(r / 0.45));
    } else {
      // Land: back into stance, or square in front for an untrained kicker.
      const land = noReset
        ? toWorld(fr, [(kf === 0 ? 1 : -1) * 0.2 * s, 0.07 * s, 0.1 * s])
        : planted;
      ank = arcLerp(hipJ, chamber, land, smooth((r - 0.45) / 0.55));
      pole = vlerp(poleCh, add(land, add(scale(fwd, 0.6), [0, 0.5, 0])), smooth((r - 0.45) / 0.55));
      if (noReset && r > 0.6) {
        ctl.land = [land[0], 0, land[2]];
        ctl.landYaw = fr.yaw;
      }
    }
  }
  // Weight: the override owns the foot for the whole action except the very ends.
  const wgt = e.before ? smooth(Math.min(1, pre / 0.12)) : 1 - smooth(clamp01((e.rec - 0.88) / 0.12));
  ctl.hold = true;
  ctl.ankle = ank;
  ctl.ankleW = Math.max(ctl.ankleW, wgt);
  ctl.pole = pole;
  ctl.airPitch = info.weapon === 'ball_of_foot' ? -0.6 : info.weapon === 'heel' ? -0.9 : 0.9;
  if (!estimate && spec) {
    // Re-solve this leg on the real aim.
    const chain = kf === 0 ? LIMBS.lLeg : LIMBS.rLeg;
    const base = ankleOf(rig, kf, spec.feet[kf]);
    const target = vlerp(base, ank, clamp01(wgt));
    solveTwoBone(st.pose, w, rig.rest, chain, target, pole, 1);
    forwardKinematics(w, st.pose, rig.rest);
    return T;
  }
  return T;
}

/** Interpolate between two points around a centre (hip): directions slerp, radius lerps. */
function arcLerp(c: V3, a: V3, b: V3, t: number): V3 {
  const da = sub(a, c), db = sub(b, c);
  const ra = len(da), rb = len(db);
  const ua = norm(da), ub = norm(db);
  const d = clamp(dot(ua, ub), -1, 1);
  const th = Math.acos(d);
  let u: V3;
  if (th < 1e-4) u = ua;
  else {
    const s0 = Math.sin((1 - t) * th) / Math.sin(th);
    const s1 = Math.sin(t * th) / Math.sin(th);
    u = [ua[0] * s0 + ub[0] * s1, ua[1] * s0 + ub[1] * s1, ua[2] * s0 + ub[2] * s1];
  }
  return madd(c, u, lerp(ra, rb, t));
}

function normV(v: V3): V3 { return norm(v); }
function vlerpV(a: V3, b: V3, t: number): V3 { return vlerp(a, b, t); }

export { qslerp };
