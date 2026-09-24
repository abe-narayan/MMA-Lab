/**
 * L1 — DEFENCES. Every striking `def.*` id of chapter 02 §2.4.2, timed against
 * the incoming strike's recorded contact instant.
 *
 * Which defence: the strike event's `detail.defence` when the result is
 * already recorded (it is, from the tick of contact), else the defender's own
 * snapshot `defence` (the reactive defence a read bought), else nothing — a
 * novice then flinches (tier `flinch`).
 *
 * Head movement defences (slip, roll, duck, pull) report the head displacement
 * they intend in `delta.evade`, which the attacker's aim subtracts: the punch
 * goes where the head was, so an evaded punch visibly misses.
 */
import { B } from '../rig/skeleton';
import {
  DEG, add, bump, clamp01, dirToWorld, hash01, lerp, norm, smooth, sub, vlerp, windowW, type V3,
} from './math';
import { worldP, type BodySpec } from './spec';
import type { Ctx, Delta } from './state';
import { footNow, gToWorld, guardFrame, type GuardPose } from './stance';
import { classify, envelope, type StrikeInfo } from './strikes';
import type { ActionTiming } from './timing';

export type DefMotion =
  | 'none' | 'block' | 'blockKick' | 'parry' | 'catch' | 'slipOut' | 'slipIn' | 'roll' | 'duck'
  | 'pull' | 'shoulderRoll' | 'check' | 'kneeBlock' | 'kickCatch' | 'teepJam' | 'stepBack'
  | 'stepOff' | 'smother' | 'frame' | 'clinchUp' | 'parryDown' | 'elbowTuck' | 'duckUnder'
  | 'kneeIntercept' | 'sprawl' | 'flinch' | 'cover' | 'chinTuck' | 'answerPhone' | 'rollWith';

/** Every striking defence id -> its motion. Grappling / submission defences are the grapple solver's. */
export const DEFENCE_MOTION: Readonly<Record<string, DefMotion>> = Object.freeze({
  'def.block_high': 'block',
  'def.forearm_block_kick': 'blockKick',
  'def.parry': 'parry',
  'def.catch': 'catch',
  'def.slip_out': 'slipOut',
  'def.slip_outside': 'slipOut',
  'def.slip_in': 'slipIn',
  'def.roll': 'roll',
  'def.duck': 'duck',
  'def.pull': 'pull',
  'def.lean_back': 'pull',
  'def.pull_head_back': 'pull',
  'def.shoulder_roll': 'shoulderRoll',
  'def.check': 'check',
  'def.knee_raise_block': 'kneeBlock',
  'def.kick_catch': 'kickCatch',
  'def.teep_jam': 'teepJam',
  'def.step_back': 'stepBack',
  'def.step_off': 'stepOff',
  'def.pivot': 'stepOff',
  'def.step_in_smother': 'smother',
  'def.frame': 'frame',
  'def.clinch_up': 'clinchUp',
  'def.parry_down_teep': 'parryDown',
  'def.elbow_tuck': 'elbowTuck',
  'def.duck_under': 'duckUnder',
  'def.knee_intercept': 'kneeIntercept',
  'def.sprawl_posture': 'sprawl',
  'def.flinch': 'flinch',
  'def.chin_tuck': 'chinTuck',
  'def.answer_phone': 'answerPhone',
  'def.roll_with': 'rollWith',
  'def.turn_head_toward': 'rollWith',
  'def.endure': 'chinTuck',
  'def.cover': 'cover',
  'def.neutral': 'none',
  'def.none': 'none',
});

export function defenceMotion(id: string | null | undefined): DefMotion {
  if (!id) return 'none';
  return DEFENCE_MOTION[id] ?? 'none';
}

/** Timing of each motion around the contact instant, ms: [start before, full before, hold after, release]. */
const TIMING: Partial<Record<DefMotion, [number, number, number, number]>> = {
  block: [200, 60, 160, 260],
  blockKick: [260, 80, 200, 300],
  parry: [170, 20, 60, 200],
  catch: [180, 30, 90, 220],
  slipOut: [200, 30, 120, 260],
  slipIn: [200, 30, 120, 260],
  roll: [260, 0, 100, 300],
  duck: [230, 30, 120, 300],
  pull: [200, 30, 120, 280],
  shoulderRoll: [190, 30, 120, 260],
  check: [300, 90, 200, 320],
  kneeBlock: [300, 90, 200, 320],
  kickCatch: [260, 40, 500, 350],
  teepJam: [260, 40, 120, 300],
  stepBack: [300, 60, 150, 400],
  stepOff: [300, 60, 150, 400],
  smother: [280, 40, 200, 380],
  frame: [260, 40, 200, 320],
  clinchUp: [280, 40, 300, 380],
  parryDown: [240, 30, 90, 260],
  elbowTuck: [200, 40, 160, 260],
  duckUnder: [280, 40, 150, 350],
  kneeIntercept: [300, 30, 150, 330],
  sprawl: [300, 60, 250, 400],
  flinch: [130, 0, 180, 300],
  cover: [200, 40, 400, 400],
  chinTuck: [180, 40, 150, 250],
  answerPhone: [200, 40, 160, 260],
  rollWith: [80, -30, 120, 250],
};

export interface ActiveDefence {
  motion: DefMotion;
  w: number;
  /** Local-frame direction the weapon comes from (+1 = the defender's left). */
  fromSide: number;
  t: ActionTiming;
  info: StrikeInfo;
  from: Ctx['incoming'][number];
}

/** The defence animating now, if any. */
export function activeDefence(ctx: Ctx): ActiveDefence | null {
  let best: ActiveDefence | null = null;
  for (const inc of ctx.incoming) {
    const t = inc.t;
    const recorded = t.event?.detail.defence ?? null;
    const snapDef = ctx.f.defence;
    let motion = defenceMotion(recorded);
    if (motion === 'none' && t.result === 'pending') motion = defenceMotion(snapDef);
    const info = classify(t.id, inc.fromSnap.stance === 'orthodox' ? 0 : 1);
    // A defence must fit what is coming: no checks against punches, no slips against kicks.
    const kick = info.leg !== -1 && info.kind !== 'knee';
    if (kick && (motion === 'slipOut' || motion === 'slipIn' || motion === 'parry' || motion === 'catch' || motion === 'shoulderRoll')) motion = 'block';
    if (!kick && (motion === 'check' || motion === 'kickCatch' || motion === 'kneeBlock' || motion === 'parryDown' || motion === 'teepJam')) motion = 'block';
    if (motion === 'none') continue;
    const tm = TIMING[motion] ?? [200, 40, 150, 260];
    const dt = ctx.nowMs - t.contact;
    const w = windowW(dt, -tm[0], -tm[1], tm[2], tm[2] + tm[3]);
    if (w <= 0) continue;
    // Weapon on the attacker's left arrives on the defender's right.
    const weaponSide = info.hand !== -1 ? (info.hand === 0 ? 1 : -1) : info.leg !== -1 ? (info.leg === 0 ? 1 : -1) : 1;
    const cand: ActiveDefence = { motion, w, fromSide: -weaponSide, t, info, from: inc };
    if (!best || w > best.w) best = cand;
  }
  return best;
}

/** Root (stance-frame) offset of a footwork defence at sim time `ms`, local metres. */
export function defenceRootOffset(ctx: Ctx, ad: ActiveDefence, ms: number): V3 {
  const tm = TIMING[ad.motion] ?? [200, 40, 150, 260];
  const s = ctx.st.rig.scale;
  const dt = ms - ad.t.contact;
  const w = windowW(dt, -tm[0], -tm[1], tm[2], tm[2] + tm[3]);
  const u = clamp01((dt + tm[0]) / (tm[0] + tm[2]));
  const back = 1 - smooth(clamp01((dt - 200) / 500));
  switch (ad.motion) {
    case 'duckUnder': return [0, 0, 0.2 * s * w];
    case 'stepBack': return [0, 0, -0.32 * s * smooth(u) * back];
    case 'stepOff': return [-ad.fromSide * 0.3 * s * smooth(u) * back, 0, 0];
    case 'smother': case 'clinchUp': return [0, 0, 0.22 * s * w];
    default: return [0, 0, 0];
  }
}

/** Pass 1: body part of the defence. */
export function defenceBody(ctx: Ctx, ad: ActiveDefence, d: Delta): void {
  const s = ctx.st.rig.scale;
  const fs = ad.fromSide; // +1: from my left
  const w = ad.w;
  const sd = ctx.sd;
  const fr = ctx.frame;
  const u = clamp01((ctx.nowMs - (ad.t.contact - (TIMING[ad.motion]?.[0] ?? 200))) / ((TIMING[ad.motion]?.[0] ?? 200) + (TIMING[ad.motion]?.[2] ?? 150)));
  const evade = (lx: number, ly: number, lz: number): void => {
    const e = dirToWorld(fr, [lx * w, ly * w, lz * w]);
    d.evade = add(d.evade, e);
  };
  switch (ad.motion) {
    case 'slipOut': case 'slipIn': {
      // Slip outside: the head goes outside the punching arm, i.e. toward the side it arrives on.
      const dir = ad.motion === 'slipOut' ? fs : -fs;
      const lat = 0.17 * s;
      d.spineRoll += -dir * 15 * DEG * w;
      d.pelvisOff[0] += dir * 0.04 * s * w;
      d.pelvisOff[1] -= 0.05 * s * w;
      d.spineYaw += dir * 8 * DEG * w;
      d.spinePitch += 7 * DEG * w;
      d.headRoll += -dir * 4 * DEG * w;
      evade(dir * lat, -0.06 * s, 0);
      break;
    }
    case 'roll': case 'duckUnder': {
      const x = lerp(-0.08, 0.12, smooth(u)) * fs * -1;
      const y = -0.16 * s * bump(u);
      d.pelvisOff[1] += y * (ad.motion === 'duckUnder' ? 1.3 : 1);
      d.spineRoll += -x * 1.1 * w;
      d.spinePitch += 16 * DEG * bump(u);
      d.pelvisOff[0] += x * 0.3;
      evade(x * 1.2, y * 1.4, 0.03 * s);
      break;
    }
    case 'duck': {
      d.pelvisOff[1] -= 0.17 * s * w;
      d.spinePitch += 14 * DEG * w;
      d.headPitch += 6 * DEG * w;
      evade(0, -0.22 * s, 0.04 * s);
      break;
    }
    case 'pull': {
      d.spinePitch += -20 * DEG * w;
      d.pelvisPitch += -4 * DEG * w;
      d.pelvisOff[2] += -0.07 * s * w;
      d.headPitch += 10 * DEG * w;
      evade(0, -0.02 * s, -0.19 * s);
      break;
    }
    case 'shoulderRoll': {
      d.spineYaw += -sd * 16 * DEG * w;
      d.pelvisYaw += -sd * 6 * DEG * w;
      d.clavRaise[ctx.lead] += 20 * DEG * w;
      d.spineRoll += sd * 6 * DEG * w;
      d.headPitch += 8 * DEG * w;
      evade(-sd * 0.06 * s, -0.03 * s, -0.04 * s);
      break;
    }
    case 'block': case 'cover': case 'chinTuck': case 'answerPhone': case 'elbowTuck': {
      d.headPitch += 10 * DEG * w;
      d.clavRaise[0] += 8 * DEG * w;
      d.clavRaise[1] += 8 * DEG * w;
      d.pelvisOff[1] -= 0.03 * s * w;
      if (ad.motion === 'cover') { d.spinePitch += 12 * DEG * w; d.pelvisOff[1] -= 0.05 * s * w; }
      if (ad.motion === 'elbowTuck') { d.spinePitch += 9 * DEG * w; d.spineRoll += fs * 4 * DEG * w; }
      if (ad.motion === 'answerPhone') d.spineRoll += fs * 5 * DEG * w;
      d.guardDrop = Math.max(d.guardDrop, w);
      break;
    }
    case 'blockKick': {
      const head = ad.t.region === 'head';
      d.spineRoll += fs * (head ? 6 : 10) * DEG * w;
      d.spinePitch += (head ? 4 : 10) * DEG * w;
      d.headPitch += 8 * DEG * w;
      d.guardDrop = Math.max(d.guardDrop, w);
      break;
    }
    case 'parry': case 'catch': case 'parryDown': {
      d.headPitch += 5 * DEG * w;
      d.spineYaw += fs * 5 * DEG * w;
      if (ad.motion === 'parryDown') { d.spineYaw += fs * 10 * DEG * w; d.pelvisYaw += fs * 8 * DEG * w; }
      break;
    }
    case 'check': case 'kneeBlock': case 'teepJam': case 'kneeIntercept': {
      const leg = checkLeg(ctx, ad);
      legRaise(ctx, ad, leg, d);
      d.spinePitch += (ad.motion === 'kneeIntercept' ? -8 : -3) * DEG * w;
      d.guardDrop = Math.max(d.guardDrop, ad.motion === 'check' ? 0.3 * w : 0);
      break;
    }
    case 'kickCatch': {
      d.spineRoll += fs * 10 * DEG * w;
      d.spinePitch += 8 * DEG * w;
      d.pelvisOff[0] += -fs * 0.04 * s * w;
      break;
    }
    case 'stepBack': {
      d.spinePitch += -6 * DEG * w;
      evade(0, 0, -0.15 * s);
      break;
    }
    case 'stepOff': {
      const dir = -fs;
      d.frameYaw += -dir * 18 * DEG * w;
      evade(dir * 0.2 * s, 0, 0);
      break;
    }
    case 'smother': case 'clinchUp': case 'frame': {
      d.spinePitch += (ad.motion === 'frame' ? -4 : 8) * DEG * w;
      d.headPitch += 10 * DEG * w;
      d.guardDrop = Math.max(d.guardDrop, w);
      break;
    }
    case 'sprawl': {
      d.pelvisOff[1] -= 0.14 * s * w;
      d.pelvisOff[2] -= 0.12 * s * w;
      d.spinePitch += 22 * DEG * w;
      d.stanceWidth *= 1 + 0.25 * w;
      d.guardDown += 0.15 * w;
      break;
    }
    case 'flinch': {
      flinch(ctx, d, w, fs);
      break;
    }
    case 'rollWith': {
      d.headYaw += fs * -18 * DEG * w;
      d.spineYaw += fs * -6 * DEG * w;
      break;
    }
    case 'none':
      break;
  }
}

/** The novice reflex: eyes shut, chin up and away, shoulders hunched, hands up. */
export function flinch(ctx: Ctx, d: Delta, w: number, fromSide: number): void {
  const s = ctx.st.rig.scale;
  d.headYaw += fromSide * -24 * DEG * w;
  d.headPitch += -10 * DEG * w;
  d.spineYaw += fromSide * -12 * DEG * w;
  d.spinePitch += -6 * DEG * w;
  d.clavRaise[0] += 16 * DEG * w;
  d.clavRaise[1] += 16 * DEG * w;
  d.pelvisOff[2] -= 0.05 * s * w;
  d.face[0] = Math.max(d.face[0], w);
  d.face[1] = Math.max(d.face[1], w);
  d.face[6] = Math.max(d.face[6], w);
  d.lookW *= 1 - 0.7 * w;
  d.guardDrop = Math.max(d.guardDrop, 0.6 * w);
}

function checkLeg(ctx: Ctx, ad: ActiveDefence): 0 | 1 {
  if (ad.t.region === 'rearLeg') return (1 - ctx.lead) as 0 | 1;
  return ctx.lead;
}

function legRaise(ctx: Ctx, ad: ActiveDefence, leg: 0 | 1, d: Delta): void {
  const st = ctx.st;
  const s = st.rig.scale;
  const fr = ctx.frame;
  const w = ad.w;
  const out = leg === 0 ? 1 : -1;
  const ctl = d.feet[leg];
  const base: V3 = footNow(st, leg, ctx.nowMs).ball;
  let lift: V3;
  let pole: V3;
  const hip = add(base, [0, st.rig.hipsY * 0.9, 0]);
  switch (ad.motion) {
    case 'check':
      // Knee up and turned out, shin vertical: the shin meets the kick.
      lift = add(base, dirToWorld(fr, [out * 0.06 * s, 0.34 * s, -0.08 * s]));
      pole = add(hip, dirToWorld(fr, [out * 0.45, 0.1, 0.55]));
      break;
    case 'kneeBlock':
      lift = add(base, dirToWorld(fr, [-out * 0.05 * s, 0.42 * s, -0.02 * s]));
      pole = add(hip, dirToWorld(fr, [0, 0.2, 0.7]));
      break;
    case 'teepJam':
      lift = add(base, dirToWorld(fr, [0, 0.45 * s, 0.25 * s]));
      pole = add(hip, dirToWorld(fr, [0, 0.4, 0.7]));
      break;
    default:
      lift = add(base, dirToWorld(fr, [0, 0.5 * s, 0.2 * s]));
      pole = add(hip, dirToWorld(fr, [0, 0.3, 0.8]));
  }
  ctl.hold = true;
  ctl.ankle = lift;
  ctl.ankleW = Math.max(ctl.ankleW, w);
  ctl.pole = pole;
  ctl.airPitch = 0.4;
  const sup = (1 - leg) as 0 | 1;
  d.feet[sup].hold = true;
  d.pelvisOff[0] += (sup === 0 ? 1 : -1) * 0.06 * s * w;
}

/** Pass 2: defence hands. */
export function defenceHands(ctx: Ctx, ad: ActiveDefence, spec: BodySpec, guard: GuardPose): void {
  const st = ctx.st;
  const s = st.rig.scale;
  const w = ad.w;
  const g = guardFrame(ctx, spec);
  const fs = ad.fromSide;
  const sideOf = (x: number): 0 | 1 => (x > 0 ? 0 : 1);
  const set = (side: 0 | 1, l: V3, fist = 1, palm?: V3): void => {
    const h = spec.hands[side];
    const p = gToWorld(g, [l[0] * s, l[1] * s, l[2] * s]);
    h.pos = vlerp(h.pos, p, w);
    h.fist = lerp(h.fist, fist, w);
    if (palm) h.palm = norm(vlerp(h.palm, palm, w));
  };
  const opp = ad.from.from;
  switch (ad.motion) {
    case 'block': case 'cover': case 'chinTuck': {
      // Gloves to the temples, forearms shielding the face; the side it is coming to presses in.
      const tight = ad.motion === 'cover' ? 1 : 0;
      set(0, [0.075 - 0.02 * tight, 0.03 + 0.03 * tight, 0.11 + (fs > 0 ? -0.02 : 0.02)]);
      set(1, [-0.075 + 0.02 * tight, 0.03 + 0.03 * tight, 0.11 + (fs < 0 ? -0.02 : 0.02)]);
      for (const side of [0, 1] as const) {
        const h = spec.hands[side];
        h.pole = vlerp(h.pole, gToWorld(g, [(side === 0 ? 0.1 : -0.1) * s, -0.35 * s, 0.12 * s]), w);
      }
      break;
    }
    case 'answerPhone': {
      const side = sideOf(fs);
      set(side, [fs * 0.1, 0.02, 0.0]);
      break;
    }
    case 'elbowTuck': {
      set(0, [0.06, -0.04, 0.12]);
      set(1, [-0.06, -0.04, 0.12]);
      for (const side of [0, 1] as const) {
        const h = spec.hands[side];
        h.pole = vlerp(h.pole, gToWorld(g, [(side === 0 ? 0.08 : -0.08) * s, -0.5 * s, 0.05 * s]), w);
      }
      break;
    }
    case 'blockKick': {
      const side = sideOf(fs);
      if (ad.t.region === 'head') {
        set(side, [fs * 0.1, 0.06, 0.06]);
        spec.hands[side].pole = vlerp(spec.hands[side].pole, gToWorld(g, [fs * 0.2 * s, -0.25 * s, 0.1 * s]), w);
      } else {
        set(side, [fs * 0.08, -0.12, 0.1]);
        spec.hands[side].pole = vlerp(spec.hands[side].pole, gToWorld(g, [fs * 0.16 * s, -0.55 * s, 0.02 * s]), w);
      }
      break;
    }
    case 'parry': case 'catch': {
      // The hand on the side the punch comes to meets it in front of the face.
      const side = sideOf(fs);
      const acrossU = clamp01((ctx.nowMs - (ad.t.contact - 80)) / 160);
      const x = ad.motion === 'parry' ? lerp(fs * 0.06, -fs * 0.08, smooth(acrossU)) : fs * 0.03;
      set(side, [x, -0.01, ad.motion === 'parry' ? 0.22 : 0.15], ad.motion === 'catch' ? 0.15 : 0.6,
        dirToWorld(spec.frame, [0, 0, 1]));
      break;
    }
    case 'parryDown': {
      const side = sideOf(fs);
      const u = clamp01((ctx.nowMs - (ad.t.contact - 120)) / 220);
      set(side, [lerp(fs * 0.05, -fs * 0.15, smooth(u)), lerp(-0.3, -0.55, smooth(u)), 0.3], 0.3);
      break;
    }
    case 'kickCatch': {
      // Scoop under the kick; after contact both hands hold the leg.
      const side = sideOf(fs);
      let leg: V3 | null = null;
      const kl = ad.info.leg;
      if (kl !== -1) leg = worldP(opp.world, kl === 0 ? B.lLeg : B.rLeg);
      if (leg && ctx.nowMs > ad.t.contact - 60) {
        const h = spec.hands[side];
        h.pos = vlerp(h.pos, add(leg, [0, -0.06 * s, 0]), w);
        h.fist = lerp(h.fist, 0.2, w);
        const o = spec.hands[(1 - side) as 0 | 1];
        o.pos = vlerp(o.pos, add(leg, [0, 0.07 * s, 0]), w * 0.8);
        o.fist = lerp(o.fist, 0.2, w);
      } else set(side, [fs * 0.2, -0.35, 0.25], 0.2);
      break;
    }
    case 'frame': case 'smother': case 'clinchUp': {
      const tgt = opp.world;
      const pts: [V3, V3] = ad.motion === 'clinchUp'
        ? [worldP(tgt, B.neck), worldP(tgt, B.neck)]
        : [worldP(tgt, B.rArm), worldP(tgt, B.lArm)];
      for (const side of [0, 1] as const) {
        if (ad.motion === 'frame' && side !== ctx.lead) continue;
        const h = spec.hands[side];
        const sh = worldP(st.world, side === 0 ? B.lArm : B.rArm);
        let t = pts[side];
        const r = sub(t, sh);
        const n = Math.hypot(r[0], r[1], r[2]);
        if (n > st.rig.armLen * 0.97) t = add(sh, [r[0] / n * st.rig.armLen * 0.97, r[1] / n * st.rig.armLen * 0.97, r[2] / n * st.rig.armLen * 0.97]);
        h.pos = vlerp(h.pos, t, w);
        h.fist = lerp(h.fist, 0.2, w);
      }
      break;
    }
    case 'flinch': {
      set(0, [0.1, 0.0, 0.1], 0.6);
      set(1, [-0.1, 0.0, 0.1], 0.6);
      break;
    }
    case 'check': {
      // Hands stay high; the check side hand a touch higher.
      set(ctx.lead, [ctx.sd * 0.08, 0.03, 0.16]);
      break;
    }
    case 'sprawl': {
      set(0, [0.18, -0.45, 0.3], 0.3);
      set(1, [-0.18, -0.45, 0.3], 0.3);
      break;
    }
    default:
      break;
  }
  void guard;
  void hash01;
}
