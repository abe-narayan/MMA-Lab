/**
 * L0 — STANCE, RHYTHM AND FOOTWORK.
 *
 * A trained fighter: bladed stance, knees bent, chin down, hands up, a light
 * rhythmic bounce on the balls of the feet, weight shifting, the rear heel
 * light. A brand-new fighter: square, upright, flat-footed, hands at the chest,
 * chin up. Both are the same code with the tier parameters of `tier.ts`.
 *
 * Footwork is a two-foot planting state machine in WORLD space. A planted foot
 * is a fixed ball-of-foot point; it may pivot on that ball and lift its heel,
 * but it never slides. When the body (the sim's recorded position, plus any
 * action lunge) drifts far enough from where a foot "should" be, that foot
 * takes a step: step-drag (the foot nearest the direction of travel goes
 * first, the other follows), swing arcs, landing ahead of the body when it is
 * moving. The pelvis is lowered as needed so every planted foot stays in
 * reach — the IK then lands it exactly.
 */
import { B } from '../rig/skeleton';
import {
  DEG, add, clamp, clamp01, dirToLocal, dirToWorld, frame as mkFrame, hash01, lerp, len, madd, noise1, qrot,
  qy, qypr, scale, smooth, sub, toWorld, bumpC1, earlyPulse, type Frame, type V3,
} from './math';
import type { BodySpec } from './spec';
import { LEG_REACH, ankleOf, worldP, worldQ } from './spec';
import type { Ctx, Delta, FighterState, FootState, Swing } from './state';
import { CH, NCH, clipStance, sampleCurve, stepClip, stepResidual, type SwingProfile } from './capture';

export interface StanceLayout {
  /** Ankle points in the stance frame (local), [left, right]. */
  ankle: [V3, V3];
  /** Foot yaw relative to the frame, [left, right]. */
  yaw: [number, number];
  blade: number;
  kneeBend: number;
  lean: number;
  chinPitch: number;
  heelLead: number;
  heelRear: number;
  bounce: number;
  qb: number;
}

/**
 * Guard styles. `rhythm` scales the bounce rate and `hop` its height (a Thai
 * fighter rocks slowly on a flat rear foot, a peek-a-boo fighter bobs quickly,
 * a Philly-shell boxer is relaxed), `stride` the step length at a given speed
 * (an out-fighter's long guard covers ground in fewer, longer steps; bobbing
 * and Thai footwork are shorter). Assumed values [E], not measured.
 */
const STYLE: Record<string, { q: number; width: number; knee: number; lean: number; blade: number; rhythm: number; hop: number; stride: number }> = {
  highGuard: { q: 1, width: 1, knee: 1, lean: 0, blade: 0, rhythm: 1, hop: 1, stride: 1 },
  philly: { q: 1.1, width: 0.95, knee: 0.95, lean: 2, blade: 8, rhythm: 0.85, hop: 0.7, stride: 1 },
  longGuard: { q: 1, width: 1.02, knee: 0.9, lean: -1, blade: 2, rhythm: 0.9, hop: 0.9, stride: 1.12 },
  peekaboo: { q: 0.95, width: 0.95, knee: 1.45, lean: 7, blade: -4, rhythm: 1.15, hop: 1.15, stride: 0.9 },
  thai: { q: 0.7, width: 0.92, knee: 0.6, lean: -4, blade: -14, rhythm: 0.72, hop: 0.6, stride: 0.88 },
  hybrid: { q: 0.95, width: 1.1, knee: 1.2, lean: 2, blade: -4, rhythm: 1, hop: 1, stride: 1.05 },
};

export function styleOf(st: FighterState): (typeof STYLE)[string] {
  return STYLE[st.tiers.guardStyle] ?? STYLE.hybrid;
}

export function stanceLayout(ctx: Ctx, d: Delta): StanceLayout {
  const { st, sd } = ctx;
  const t = st.tiers.stance;
  const sty = styleOf(st);
  const s = st.rig.scale;
  const qb = clamp01(((t.blade - 8) / 40) * sty.q);
  const w = t.stanceWidth * sty.width * d.stanceWidth;
  const lx = lerp(0.14, 0.11, qb) * w * s;
  const rx = lerp(0.14, 0.135, qb) * w * s;
  const lz = lerp(0.06, 0.22, qb) * (0.9 + 0.1 * w) * s;
  const rz = lerp(0.07, 0.22, qb) * (0.9 + 0.1 * w) * s;
  const leadAnkle: V3 = [sd * lx, 0, lz];
  const rearAnkle: V3 = [-sd * rx, 0, -rz];
  const leadYaw = -sd * lerp(3, 18, qb) * DEG;
  const rearYaw = -sd * lerp(8, 58, qb) * DEG;
  const lead = ctx.lead;
  const ankle: [V3, V3] = lead === 0 ? [leadAnkle, rearAnkle] : [rearAnkle, leadAnkle];
  const yaw: [number, number] = lead === 0 ? [leadYaw, rearYaw] : [rearYaw, leadYaw];
  return {
    ankle, yaw,
    blade: -sd * (t.blade + sty.blade) * DEG,
    kneeBend: t.kneeBend * sty.knee * s,
    lean: (t.lean + sty.lean) * DEG,
    chinPitch: (-t.chinUpDeg + 5 * qb) * DEG,
    heelLead: t.leadHeel * DEG,
    heelRear: t.rearHeel * DEG,
    bounce: t.bounce * s,
    qb,
  };
}

/** Ball-of-foot point (local) for an ankle point and foot yaw. */
function ballLocal(ctx: Ctx, side: 0 | 1, ankle: V3, yaw: number): V3 {
  const off = ctx.st.rig.ankleFromBall[side];
  const r = qrot(qy(yaw), [-off[0], 0, -off[2]]);
  return [ankle[0] + r[0], 0, ankle[2] + r[2]];
}

/** Where both feet belong (world balls and yaws) for a root position and frame. */
export function desiredFeet(ctx: Ctx, lay: StanceLayout, fr: Frame): { ball: [V3, V3]; yaw: [number, number] } {
  const ball: [V3, V3] = [[0, 0, 0], [0, 0, 0]];
  const yaw: [number, number] = [0, 0];
  for (const side of [0, 1] as const) {
    const bl = ballLocal(ctx, side, lay.ankle[side], lay.yaw[side]);
    ball[side] = toWorld(fr, bl);
    ball[side][1] = 0;
    yaw[side] = fr.yaw + lay.yaw[side];
  }
  return { ball, yaw };
}

function yawErr(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

/** Initialise both feet in stance (first frame, or after a seek). */
export function snapFeet(ctx: Ctx, lay: StanceLayout, fr: Frame): void {
  const des = desiredFeet(ctx, lay, fr);
  const seed = ctx.st.feetSeed;
  for (const side of [0, 1] as const) {
    const f = ctx.st.feet[side];
    const sd = seed?.[side] ?? null;
    // Back on his feet from a clinch / the ground: the feet start where they
    // were drawn (the plant machine then steps them into the stance).
    f.ball = sd ? [sd.ball[0], 0, sd.ball[2]] : des.ball[side];
    f.yaw = sd ? sd.yaw : des.yaw[side];
    f.swing = null;
    f.landedAt = ctx.nowMs - 1000;
    f.lift = 0;
  }
  ctx.st.feetSeed = null;
  ctx.st.loco = null;
}

/** Natural frequency (rad/s) of the footwork's travel-velocity follow (`FighterState.loco`). */
const LOCO_W = 9;

/**
 * Per-foot step length (m, before scale) a fighter takes travelling at `v`
 * m/s. Assumptions [E]: a boxer's step-drag moves each foot ~15-25 cm when
 * adjusting and ~35-50 cm when travelling at 1-1.5 m/s; the motion-capture
 * library's own step takes (ACCAD, a deep karate stance) move each foot
 * 50-85 cm at 0.4-1 m/s, an upper bound. Normal walking is ~0.7 m a step at
 * ~1.4 m/s (step length ≈ 0.4 × stature).
 */
export function strideFor(v: number): number {
  return clamp(0.15 + 0.26 * v, 0.15, 0.46);
}

export interface FootOut {
  ball: V3;
  yaw: number;
  lift: number;
  airPitch: number;
  planted: boolean;
  /** 0..1 progress of a swing (for weight transfer). */
  swingU: number;
}

/**
 * Advance the footwork state machine to `ctx.nowMs`. `fr` is the stance frame
 * at the display root (with the action's root offset applied).
 */
export function updateFeet(ctx: Ctx, lay: StanceLayout, fr: Frame, d: Delta, dtMs: number): [FootOut, FootOut] {
  const st = ctx.st;
  const now = ctx.nowMs;
  const s = st.rig.scale;
  const t = st.tiers.stance;

  // Land finished swings.
  for (const side of [0, 1] as const) {
    const f = st.feet[side];
    if (f.swing && now >= f.swing.t0 + f.swing.dur) {
      f.ball = f.swing.toBall;
      f.yaw = f.swing.toYaw;
      f.swing = null;
      f.landedAt = now;
    }
    const ctl = d.feet[side];
    if (ctl.land && ctl.ankleW > 0.5) {
      // The action carries this foot through the air and puts it down elsewhere.
      f.ball = ctl.land;
      if (ctl.landYaw !== null) f.yaw = ctl.landYaw;
      f.swing = null;
    }
  }

  // Where the body will be `dt` ms from now: recorded velocity plus the
  // actions' own root offsets (pure functions of time, so a lunge is stepped
  // into rather than chased).
  // Pass 3: the travel velocity the footwork plans with is smoothed
  // (`FighterState.loco`); the display root itself (and the hips) still
  // follow the record.
  if (!st.loco) st.loco = { v: [ctx.vel[0], 0, ctx.vel[2]], a: [0, 0, 0] };
  else if (dtMs > 0) {
    const dt = dtMs / 1000, w = LOCO_W, ex = Math.exp(-w * dt);
    for (const k of [0, 2] as const) {
      const ch = st.loco.v[k] - ctx.vel[k];
      const tmp = (st.loco.a[k] + w * ch) * dt;
      st.loco.a[k] = (st.loco.a[k] - w * tmp) * ex;
      st.loco.v[k] = ctx.vel[k] + (ch + tmp) * ex;
    }
  }
  const lv = st.loco.v;
  const predictFrame = (dt: number, velK = 1): Frame => {
    let ox = ctx.frame.ox + lv[0] * dt / 1000 * velK;
    let oz = ctx.frame.oz + lv[2] * dt / 1000 * velK;
    for (const fn of d.rootFns) {
      const o = fn(now + dt);
      const w = dirToWorld(ctx.frame, [o[0], 0, o[2]]);
      ox += w[0];
      oz += w[2];
    }
    return mkFrame(ox, oz, fr.yaw);
  };
  // Where the feet should be when a step started now would land.
  const lookMs = 170 * t.stepTime;
  const pred = predictFrame(lookMs);
  const p0 = predictFrame(0), p1 = predictFrame(100);
  const vel: V3 = [(p1.ox - p0.ox) * 10, 0, (p1.oz - p0.oz) * 10];
  const speed = Math.hypot(vel[0], vel[2]);
  const des = desiredFeet(ctx, lay, pred);
  // A trained fighter re-steps when a foot is ~9 cm out of its place (a
  // novice ~13 cm); moving, the steps are planned longer (`strideFor`) rather
  // than triggered earlier (the old 0.75× threshold while moving made the
  // many 5-8 cm catch-up steps).
  const thresh = lerp(0.13, 0.09, lay.qb) * s;

  // Pivot planted feet toward the stance angle on the ball (never a slide).
  const maxTurn = (260 * DEG) * dtMs / 1000;
  for (const side of [0, 1] as const) {
    const f = st.feet[side];
    if (f.swing || d.feet[side].hold || d.feet[side].ankleW > 0) continue;
    const e = Math.atan2(Math.sin(des.yaw[side] - f.yaw), Math.cos(des.yaw[side] - f.yaw));
    // Eased in over 3-9° of error (it used to switch on at 6°: the foot's
    // yaw rate jumped from 0 to 2.6°/frame, and the ankle, which swings
    // about the ball, jerked the shin).
    f.yaw += clamp(e, -maxTurn, maxTurn) * 0.6 * smooth((Math.abs(e) - 3 * DEG) / (6 * DEG));
  }

  const free = (side: 0 | 1): boolean => {
    const c = d.feet[side];
    return !st.feet[side].swing && !c.hold && c.ankleW <= 0.02;
  };
  const err = (side: 0 | 1): number => len(sub(st.feet[side].ball, des.ball[side]));
  const e0 = err(0), e1 = err(1);
  const swinging = st.feet[0].swing !== null || st.feet[1].swing !== null;
  const yawBad = (side: 0 | 1): boolean => yawErr(st.feet[side].yaw, des.yaw[side]) > 40 * DEG;

  let pick: 0 | 1 | -1 = -1;
  if (!swinging) {
    const need0 = free(0) && (e0 > thresh || yawBad(0));
    const need1 = free(1) && (e1 > thresh || yawBad(1));
    if (need0 || need1) {
      if (need0 && need1 && speed > 0.2) {
        // Step-drag: the foot nearest the direction of travel moves first.
        const vx = vel[0] / speed, vz = vel[2] / speed;
        const p0 = (des.ball[0][0] - st.feet[1].ball[0]) * vx + (des.ball[0][2] - st.feet[1].ball[2]) * vz;
        const p1 = (des.ball[1][0] - st.feet[0].ball[0]) * vx + (des.ball[1][2] - st.feet[0].ball[2]) * vz;
        pick = p0 >= p1 ? 0 : 1;
      } else if (need0 && need1) pick = e0 >= e1 ? 0 : 1;
      else pick = need0 ? 0 : 1;
    }
  } else if (speed > 0.6) {
    // Fast shuffle / step-in: the trailing foot drags before the lead has fully landed.
    for (const side of [0, 1] as const) {
      const o = st.feet[1 - side];
      if (o.swing && free(side) && (now - o.swing.t0) / o.swing.dur > 0.5 && err(side) > thresh * 0.8) pick = side;
    }
  } else {
    // A drag step can follow as soon as the first foot is down (handled next frame).
  }

  if (pick !== -1) {
    const side = pick;
    const f = st.feet[side];
    const dist0 = err(side);
    // Stride: at speed, the step is aimed `lead` ms of travel past where the
    // body will be when it lands, so it covers a stride (`strideFor`, by the
    // style and the tier) rather than just the error that triggered it; its
    // swing time follows its length.
    const sty = styleOf(st);
    const stride = strideFor(speed) * sty.stride * lerp(0.85, 1, lay.qb) * s;
    const planned = Math.min(Math.max(dist0, speed > 0.15 ? stride : 0), Math.max(dist0, 0.48 * s));
    const dur = Math.max(130, (180 + 230 * clamp01(planned / (0.6 * s))) * t.stepTime);
    const lead = speed > 0.15 ? clamp((stride - thresh) / speed * 1000 - dur, 0, 300) * smooth((speed - 0.15) / 0.3) : 0;
    const land = predictFrame(dur + lead, 1.05);
    const to = desiredFeet(ctx, lay, land);
    let toBall = keepOrder(ctx, side, to.ball[side], fr);
    // Untrained feet cross on lateral steps.
    const lateral = Math.abs((vel[0] * fr.c - vel[2] * fr.s)) / Math.max(1e-6, speed);
    let crossed = false;
    if (speed > 0.25 && lateral > 0.75 && t.footCross > 0 && hash01(st.seed, st.stepCount, 7) < t.footCross) {
      const other = to.ball[1 - side];
      const across = sub(other, toBall);
      toBall = madd(toBall, across, 1.35);
      crossed = true;
    }
    st.stepCount++;
    // The captured step for this direction supplies the foot's timing curves
    // and the upper body's weight shift over the swing.
    let prof: SwingProfile | null = null;
    if (st.cap) {
      const dl = dirToLocal(fr, sub(toBall, f.ball));
      if (Math.hypot(dl[0], dl[2]) > 0.03 * s) {
        prof = st.cap.swingProfile(stepClip(dl[0], dl[2], clipStance(ctx.f.stance), speed > 1.6), side);
      }
    }
    f.swing = {
      t0: now, dur,
      fromBall: f.ball, fromYaw: f.yaw,
      toBall, toYaw: to.yaw[side],
      height: (0.028 + 0.05 * clamp01(planned / (0.5 * s))) * s * (t.stepTime > 1.2 ? 1.25 : 1),
      cap: prof,
      fromLift: f.lift,
      crossed,
      lead,
    };
  }

  // Re-aim feet in flight: the landing was predicted from the velocity at
  // lift-off, and the sim's body often stops or turns within the swing (a rear
  // foot aimed for a body still moving forward landed 10 cm in FRONT of the
  // lead foot). The landing point drifts toward the current prediction, at most
  // 2 cm a frame, until 80 % of the swing.
  for (const side of [0, 1] as const) {
    const sw = st.feet[side].swing;
    if (!sw || sw.crossed || d.feet[side].ankleW > 0.02) continue;
    const u = (now - sw.t0) / sw.dur;
    // The re-aim rate tapers to 0 by 80 % of the swing (it used to stop dead
    // there: the landing foot's velocity stepped by up to 2 cm/frame).
    const rate = 0.02 * s * (1 - smooth(u / 0.8)) * Math.min(1.5, dtMs / (1000 / 60));
    if (rate <= 1e-6) continue;
    const want = keepOrder(ctx, side, desiredFeet(ctx, lay, predictFrame(sw.t0 + sw.dur - now + sw.lead, 1.05)).ball[side], fr);
    const dx = want[0] - sw.toBall[0], dz = want[2] - sw.toBall[2];
    const dl = Math.hypot(dx, dz);
    const k = dl > rate ? rate / dl : 1;
    sw.toBall = [sw.toBall[0] + dx * k, 0, sw.toBall[2] + dz * k];
  }

  const out: [FootOut, FootOut] = [null!, null!];
  for (const side of [0, 1] as const) {
    const f = st.feet[side];
    if (f.swing) {
      const u = clamp01((now - f.swing.t0) / f.swing.dur);
      const cp = f.swing.cap;
      // The foot leaves the canvas before it travels and is down before it
      // stops: no skimming along the floor at lift-off and touch-down. The
      // travel starts and ends at rest (smoothstep into the captured progress
      // curve, whose own end slopes are not zero: a velocity step at 10 % and
      // 90 % of every swing, the shin's pops at plant and lift-off).
      const e = swingProgress(f.swing, u);
      const b = f.swing.fromBall;
      const p: V3 = [
        lerp(b[0], f.swing.toBall[0], e),
        f.swing.height * (cp ? sampleCurve(cp.height, u) : bumpC1(u)),
        lerp(b[2], f.swing.toBall[2], e),
      ];
      const dy = Math.atan2(Math.sin(f.swing.toYaw - f.swing.fromYaw), Math.cos(f.swing.toYaw - f.swing.fromYaw));
      out[side] = {
        ball: p, yaw: f.swing.fromYaw + dy * e,
        lift: 0.25 * (1 - u), airPitch: 0.2 * earlyPulse(u), planted: false, swingU: u,
      };
    } else {
      out[side] = { ball: f.ball, yaw: f.yaw, lift: 0, airPitch: 0, planted: true, swingU: 0 };
    }
  }
  return out;
}

/** Horizontal progress (0..1) of a swing at u (see `updateFeet`). */
function swingProgress(sw: Swing, u: number): number {
  const uh = smooth((u - 0.1) / 0.8);
  return sw.cap ? sampleCurve(sw.cap.prog, uh) : uh;
}

/**
 * Where a foot's ball is drawn now (floor point): its plant, or its point
 * along a swing in flight. An action that takes the leg over (a kick, a check)
 * starts from here: it used to start from the plant the swing had left, and
 * when the swing landed under the action the leg's path jumped by the step
 * (measured: a 47 cm one-frame slide of a round kick's foot).
 */
export function footNow(st: FighterState, side: 0 | 1, nowMs: number): { ball: V3; yaw: number } {
  const f = st.feet[side];
  const sw = f.swing;
  if (!sw) return { ball: [f.ball[0], 0, f.ball[2]], yaw: f.yaw };
  const e = swingProgress(sw, clamp01((nowMs - sw.t0) / sw.dur));
  const dy = Math.atan2(Math.sin(sw.toYaw - sw.fromYaw), Math.cos(sw.toYaw - sw.fromYaw));
  return { ball: [lerp(sw.fromBall[0], sw.toBall[0], e), 0, lerp(sw.fromBall[2], sw.toBall[2], e)], yaw: sw.fromYaw + dy * e };
}

/**
 * A trained stance never steps the rear foot past the lead one (or the lead
 * behind the rear): the landing is held at least 6 cm (scaled) on its own side
 * of the other foot along the facing (the other foot where it stands, or
 * where it is landing). A stance switch flips which foot leads, so the same
 * rule walks the feet through the switch.
 */
function keepOrder(ctx: Ctx, side: 0 | 1, ball: V3, fr: Frame): V3 {
  const o = ctx.st.feet[1 - side];
  const ob = o.swing ? o.swing.toBall : o.ball;
  const gap = 0.06 * ctx.st.rig.scale;
  const fx = fr.s, fz = fr.c; // forward
  const dz = (ball[0] - ob[0]) * fx + (ball[2] - ob[2]) * fz;
  const lead = side === ctx.lead;
  const need = lead ? gap - dz : dz + gap; // > 0: on the wrong side
  if (need <= 0) return ball;
  const k = lead ? need : -need;
  return [ball[0] + fx * k, ball[1], ball[2] + fz * k];
}

/**
 * Build the body spec (everything but the hands) from stance, footwork and
 * the accumulated delta.
 */
export function buildBody(ctx: Ctx, d: Delta, spec: BodySpec, dtMs: number, snap: boolean): void {
  const st = ctx.st;
  const rig = st.rig;
  const s = rig.scale;
  const t = st.tiers.stance;
  const now = ctx.nowMs / 1000;
  const econ = t.economy;
  const fat = ctx.fatigue;

  const lay = stanceLayout(ctx, d);
  const yaw = ctx.frame.yaw + d.frameYaw;
  const rootW = toWorld(ctx.frame, [d.rootOff[0], 0, d.rootOff[2]]);
  const fr = mkFrame(rootW[0], rootW[2], yaw);
  spec.frame = fr;

  if (snap || !st.initialised) {
    snapFeet(ctx, lay, fr);
    st.initialised = true;
  }
  const feet = updateFeet(ctx, lay, fr, d, dtMs);

  // ---- rhythm ------------------------------------------------------------
  const sty = styleOf(st);
  const fb = (1.75 + 0.55 * hash01(st.seed, 11)) * sty.rhythm;
  const ph = 2 * Math.PI * fb * now + hash01(st.seed, 12) * 6.28;
  const flat = clamp01(fat.flatFeet);
  // The bounce eases off while a foot is in the air (continuous in the swing,
  // so lifting a foot never drops the hips in one frame).
  let airborne = 0;
  for (const side of [0, 1] as const) if (!feet[side].planted) airborne = Math.max(airborne, bumpC1(feet[side].swingU));
  const bounceA = lay.bounce * sty.hop * d.bounce * (1 - 0.85 * flat) * (1 - 0.6 * airborne);
  // Travel (the smoothed velocity the steps are planned with): the hips lead
  // into it and the trailing foot's heel comes up to push off.
  const lv = st.loco?.v ?? [0, 0, 0];
  const lspeed = Math.hypot(lv[0], lv[2]);
  const travel = smooth((lspeed - 0.2) / 0.8);
  // Capture: the performers' rhythm (normalised residuals, `capture.ts`) drives
  // the same channels the procedural sine / noise would, at the tier's amplitudes.
  const idle = d.idle;
  const ci = t.capIdle;
  const wave = idle ? clamp(idle[CH.py] / 1.4, -1, 1) : Math.sin(ph);
  const bob = bounceA * (0.5 + 0.5 * wave);
  const heelBob = 0.5 + 0.5 * wave;
  const swayZ = idle ? 0.009 * s * idle[CH.pz] * (0.5 + econ) * ci : 0.022 * s * noise1(st.seed + 1, now * 0.55) * (0.5 + econ);
  const swayX = idle ? 0.007 * s * idle[CH.px] * (0.5 + econ) * ci : 0.016 * s * noise1(st.seed + 2, now * 0.42) * (0.5 + econ);
  const hm = t.headMove;
  // Capture: the step being taken shifts the weight, bobs and turns the torso
  // the way the performer's did over the same step.
  const sr = stepRes;
  sr.fill(0);
  if (st.cap) {
    let stepping = false;
    for (const side of [0, 1] as const) {
      const sw = st.feet[side].swing;
      if (!sw || !sw.cap || feet[side].planted) continue;
      stepResidual(st.cap, sw.cap, feet[side].swingU, stepTmp);
      for (let c = 0; c < NCH; c++) sr[c] += stepTmp[c];
      stepping = true;
    }
    if (stepping) {
      const k = t.capStep;
      for (let c = 0; c < NCH; c++) {
        const lim = c < 3 ? 0.05 * s : c < 12 ? 0.14 : 0.04 * s;
        sr[c] = clamp(sr[c] * k, -lim, lim);
      }
      for (const side of [0, 1] as const) {
        const o = side === 0 ? CH.lhx : CH.rhx;
        d.handOff[side] = [d.handOff[side][0] + sr[o], d.handOff[side][1] + sr[o + 1], d.handOff[side][2] + sr[o + 2]];
      }
    }
  }

  // ---- pelvis ------------------------------------------------------------
  const localOff: V3 = [
    d.pelvisOff[0] + swayX + sr[CH.px],
    0,
    d.pelvisOff[2] + swayZ + sr[CH.pz] - t.heelsBackCm / 100 * s,
  ];
  {
    // Hips ~3 cm ahead of the root per m/s of travel (capped at 5 cm).
    const k = Math.min(0.03, 0.05 / Math.max(1e-6, lspeed));
    localOff[0] += (lv[0] * fr.c - lv[2] * fr.s) * k;
    localOff[2] += (lv[0] * fr.s + lv[2] * fr.c) * k;
  }
  // Weight moves over the planted foot while the other swings.
  for (const side of [0, 1] as const) {
    if (!feet[side].planted) {
      const o = feet[1 - side].ball;
      const toward = sub([o[0], 0, o[2]], [fr.ox, 0, fr.oz]);
      const w = (st.feet[side].swing?.cap ? 0.18 : 0.28) * bumpC1(feet[side].swingU);
      const lw = [toward[0] * fr.c - toward[2] * fr.s, 0, toward[0] * fr.s + toward[2] * fr.c];
      localOff[0] += lw[0] * w;
      localOff[2] += lw[2] * w;
    }
  }
  // The body sits between the feet: if the feet lag the recorded position, the hips lead them.
  const desNow = desiredFeet(ctx, lay, fr);
  const lagX = ((feet[0].ball[0] - desNow.ball[0][0]) + (feet[1].ball[0] - desNow.ball[1][0])) / 2;
  const lagZ = ((feet[0].ball[2] - desNow.ball[0][2]) + (feet[1].ball[2] - desNow.ball[1][2])) / 2;
  const pw = toWorld(fr, localOff);
  const pelvis: V3 = [
    pw[0] + lagX * 0.2 + d.pelvisWorld[0],
    rig.hipsY - lay.kneeBend - bounceA + bob + d.pelvisOff[1] + sr[CH.py],
    pw[2] + lagZ * 0.2 + d.pelvisWorld[2],
  ];
  spec.pelvisYaw = lay.blade + d.pelvisYaw + sr[CH.pYaw]
    + (idle ? 2.2 * DEG * idle[CH.pYaw] * ci : 2.5 * DEG * noise1(st.seed + 3, now * 0.5) * econ);
  spec.pelvisPitch = lay.lean * 0.35 + d.pelvisPitch + sr[CH.pPitch] + (idle ? 1.2 * DEG * idle[CH.pPitch] * ci : 0);
  spec.pelvisRoll = d.pelvisRoll + (swayX / (0.2 * s)) * 3 * DEG + sr[CH.pRoll] + (idle ? 1.2 * DEG * idle[CH.pRoll] * ci : 0);

  // ---- feet -> spec, and keep them reachable -----------------------------
  const hipsQ = qypr(yaw + spec.pelvisYaw, spec.pelvisPitch, spec.pelvisRoll);
  for (const side of [0, 1] as const) {
    const fo = feet[side];
    const ctl = d.feet[side];
    const fs = spec.feet[side];
    const isLead = side === ctx.lead;
    const baseHeel = isLead ? lay.heelLead : lay.heelRear;
    // The trailing foot (behind the hips along the travel) pushes off: its
    // heel rises up to 10° with the speed of travel.
    const behind = travel > 0 ? -((fo.ball[0] - fr.ox) * lv[0] + (fo.ball[2] - fr.oz) * lv[2]) / Math.max(1e-6, lspeed) : 0;
    const push = 10 * DEG * travel * smooth(behind / (0.25 * s)) * (1 - flat);
    const plantedHeel = baseHeel * (1 - flat) * d.heel + 5 * DEG * heelBob * (bounceA > 0 ? 1 : 0) + push;
    // A swinging foot starts from the heel it left the floor with and lands on
    // the heel it will stand on (a small toe-off early in the swing): no snap
    // of the foot's pitch at lift-off or touch-down.
    const u = fo.swingU;
    const air = fo.planted ? 0 : bumpC1(u);
    const sw = st.feet[side].swing;
    const heel = fo.planted
      ? plantedHeel
      : lerp(sw ? sw.fromLift : plantedHeel, plantedHeel, smooth(u)) + 0.087 * earlyPulse(u);
    fs.ball = [fo.ball[0], fo.ball[1], fo.ball[2]];
    fs.yaw = fo.yaw + ctl.pivot;
    fs.lift = lerp(heel, ctl.lift, clamp01(ctl.liftW)) + ctl.liftAdd * (1 - air);
    // An action's foot pitch comes in with its hold on the leg (it used to
    // apply in full from the first frame: the foot, and the ankle that pivots
    // about the ball with it, jumped 30-50° as a kick or a check began).
    fs.airPitch = fo.airPitch + ctl.airPitch * clamp01(ctl.ankleW);
    fs.toeFlat = 1 - 0.7 * air;
    if (fo.planted) st.feet[side].lift = fs.lift;
    fs.ankle = null;
    // Knees track between the toes and the opponent, nearer the toes (pass 3:
    // at 40 % toe the loaded knee turned more than 45° off a turned-out foot in
    // ~1 % of frames; knees over toes is the rule a coach teaches), a touch
    // outward.
    const toeDir: V3 = [Math.sin(fs.yaw), 0, Math.cos(fs.yaw)];
    const fwdF = dirToWorld(fr, [0, 0, 1]);
    // Normalised, so the pole stays 0.6 m out in front of the knee however the
    // foot is turned (unnormalised, a foot turned far out shortened it toward
    // the point above the ankle: near a straight leg's hip-ankle line, where
    // the knee's plane is ill-defined).
    const kx = toeDir[0] * 0.6 + fwdF[0] * 0.4, kz = toeDir[2] * 0.6 + fwdF[2] * 0.4;
    const kl = Math.hypot(kx, kz) || 1;
    const kneeFwd: V3 = [kx / kl, 0, kz / kl];
    const out = dirToWorld(fr, [side === 0 ? 1 : -1, 0, 0]);
    const ank = ankleOf(rig, side, fs);
    fs.pole = add(add(ank, [0, 0.5 * s, 0]), add(scale(kneeFwd, 0.6), scale(out, 0.05)));
    if (ctl.ankle && ctl.ankleW > 0) {
      const w = clamp01(ctl.ankleW);
      fs.ankle = [
        lerp(ank[0], ctl.ankle[0], w), lerp(ank[1], ctl.ankle[1], w), lerp(ank[2], ctl.ankle[2], w),
      ];
      if (ctl.pole) fs.pole = ctl.pole;
      fs.toeFlat = 1 - w;
    }
  }
  spec.pelvis = pelvis;
  st.planted = [feet[0].planted && d.feet[0].ankleW <= 0.05, feet[1].planted && d.feet[1].ankleW <= 0.05];
  st.reachW = [clamp01(1 - d.feet[0].ankleW / 0.35), clamp01(1 - d.feet[1].ankleW / 0.35)];
  if (!spec.free) {
    const y0 = spec.pelvis[1];
    clampPelvis(spec, st);
    // Pass 3: the hips come back UP from a reach drop with some inertia (a
    // critically damped follow, ~0.1 s): the drop follows the feet exactly (it
    // must, to keep them in reach), but the release could be 5-9 cm in a
    // frame when the foot that bound it landed or lifted. Rising late only
    // bends the knees a little longer; every foot stays reachable.
    const drop = y0 - spec.pelvis[1];
    const pd = st.pelDrop;
    if (snap || dtMs <= 0 || !pd) st.pelDrop = { v: drop, vel: 0 };
    else if (drop >= pd.v) { pd.vel = Math.max(0, (drop - pd.v) / (dtMs / 1000)); pd.v = drop; }
    else {
      const dt = dtMs / 1000, w = DROP_RELEASE_W, ex = Math.exp(-w * dt);
      const ch = pd.v - drop;
      const tmp = (pd.vel + w * ch) * dt;
      pd.vel = (pd.vel - w * tmp) * ex;
      pd.v = Math.max(drop, drop + (ch + tmp) * ex);
    }
    spec.pelvis[1] = y0 - st.pelDrop!.v;
  }

  // ---- torso, shoulders, head ----------------------------------------------
  spec.spineYaw = d.spineYaw + (-ctx.sd * 4 * lay.qb) * DEG + sr[CH.sYaw]
    + (idle ? 2.5 * DEG * idle[CH.sYaw] * ci : 3 * DEG * noise1(st.seed + 4, now * 0.6) * (0.4 + econ));
  spec.spinePitch = lay.lean * 0.65 + d.spinePitch + sr[CH.sPitch] + (idle ? 1.5 * DEG * idle[CH.sPitch] * ci : 0);
  spec.spineRoll = d.spineRoll + sr[CH.sRoll] + (idle ? 2 * DEG * hm * idle[CH.sRoll] * ci : 3.5 * DEG * hm * noise1(st.seed + 5, now * 0.7));
  const raise = (4 + 5 * lay.qb) * DEG;
  spec.clavRaise = [raise + d.clavRaise[0], raise + d.clavRaise[1]];
  spec.clavFwd = [(3 + 6 * lay.qb) * DEG + d.clavFwd[0], (3 + 6 * lay.qb) * DEG + d.clavFwd[1]];
  spec.head.lookAt = ctx.opp ? oppHeadEstimate(ctx) : null;
  spec.head.lookW = clamp01(d.lookW) * (ctx.opp ? 0.85 : 0);
  spec.head.yaw = d.headYaw + sr[CH.hYaw] * 0.6 + (idle ? 3 * DEG * hm * idle[CH.hYaw] * ci : 3 * DEG * hm * noise1(st.seed + 6, now * 0.8));
  spec.head.pitch = lay.chinPitch + d.headPitch + sr[CH.hPitch] * 0.6 + (idle ? 2 * DEG * hm * idle[CH.hPitch] * ci : 0);
  spec.head.roll = d.headRoll + sr[CH.hRoll] * 0.6 + (idle ? 2 * DEG * hm * idle[CH.hRoll] * ci : 2.5 * DEG * hm * noise1(st.seed + 7, now * 0.65));
  spec.face.set(d.face);
}

const stepRes = new Float64Array(NCH);
const stepTmp = new Float64Array(NCH);

/**
 * Lower the pelvis until every foot on the floor or stepping is within reach
 * (the IK then lands it exactly). A stepping foot binds as much as a planted
 * one — its target moves continuously, so the pelvis height does too — and a
 * leg an action takes over (a kick, a knee) releases the pelvis gradually
 * (`reachW`), so no constraint ever switches in one frame (that was the hips
 * popping 4-5 cm every time a foot left or touched the floor).
 */
export function clampPelvis(spec: BodySpec, st: FighterState): void {
  const rig = st.rig;
  const hipsQ = qypr(spec.frame.yaw + spec.pelvisYaw, spec.pelvisPitch, spec.pelvisRoll);
  const pelvis = spec.pelvis;
  const y0 = pelvis[1];
  const max = rig.legLen * LEG_REACH;
  // Pass 3: the drop is a C¹ function of where the feet are. The exact drop
  // for a foot at horizontal distance h, v - sqrt(max² - h²), has an infinite
  // slope as h reaches the leg's length: a foot stepping out wide dropped the
  // hips 3-5 cm a frame (measured, a third of the standing shin pops), and the
  // hard 12 cm floor then stopped them dead. Past 94 % of the reach the drop
  // continues on its tangent and the total is eased into its 12 cm limit.
  // (Tried: raising a still-stretched planted foot's heel for the rest — no
  // gain in sliding, slightly more pops; the soft reach limit handles it.)
  const h0 = max * 0.94;
  const s0 = Math.sqrt(max * max - h0 * h0);
  const slope = h0 / s0;
  let total = 0;
  for (let it = 0; it < 3; it++) {
    let drop = 0;
    for (const side of [0, 1] as const) {
      const w = st.reachW[side];
      if (w <= 0) continue;
      const hip = add(pelvis, qrot(hipsQ, rig.hipOff[side]));
      const ank = ankleOf(rig, side, spec.feet[side]);
      const h = Math.hypot(hip[0] - ank[0], hip[2] - ank[2]);
      const v = hip[1] - ank[1];
      const need = h <= h0 ? v - Math.sqrt(max * max - h * h) : v - s0 + slope * (h - h0);
      if (need > 0) drop = Math.max(drop, need * w);
    }
    if (drop <= 1e-6) break;
    pelvis[1] -= drop;
    total += drop;
  }
  if (total > 0) {
    // Never squat more than 12 cm below what the layers asked for (eased in
    // over its last 5 cm): past that a stretched leg lets its heel come up.
    const cap = 0.12 * rig.scale;
    const knee = cap - 0.05 * rig.scale;
    const eff = total <= knee ? total : knee + (cap - knee) * Math.tanh((total - knee) / (cap - knee));
    pelvis[1] = y0 - eff;
  }
}

/** Natural frequency (rad/s) of the hips' rise back from a reach drop (`buildBody`). */
const DROP_RELEASE_W = 30;


export function oppHeadEstimate(ctx: Ctx): V3 {
  const o = ctx.opp!;
  if (o.lastSpec) {
    const p = worldP(o.world, B.head);
    if (Number.isFinite(p[0]) && p[1] > 0.3) return [p[0], p[1] + 0.06, p[2]];
  }
  return [o.displayRoot[0], 1.55 * o.rig.scale, o.displayRoot[2]];
}

// ---------------------------------------------------------------------------
// Guard (hands in the second pass)
// ---------------------------------------------------------------------------

export interface GuardFrame {
  origin: V3;
  fwd: V3;
  left: V3;
  up: V3;
}

/** A frame at the head joint, facing the opponent (partly following the chest). */
export function guardFrame(ctx: Ctx, spec: BodySpec): GuardFrame {
  const w = ctx.st.world;
  const origin = worldP(w, B.head);
  const cq = worldQ(w, B.spine2);
  const cf = qrot(cq, [0, 0, 1]);
  const chestYaw = Math.atan2(cf[0], cf[2]);
  const fy = spec.frame.yaw;
  const dy = Math.atan2(Math.sin(chestYaw - fy), Math.cos(chestYaw - fy));
  const yaw = fy + dy * 0.35;
  const fwd: V3 = [Math.sin(yaw), 0, Math.cos(yaw)];
  const left: V3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  return { origin, fwd, left, up: [0, 1, 0] };
}

export function gToWorld(g: GuardFrame, l: V3): V3 {
  return [
    g.origin[0] + g.left[0] * l[0] + g.fwd[0] * l[2],
    g.origin[1] + l[1],
    g.origin[2] + g.left[2] * l[0] + g.fwd[2] * l[2],
  ];
}
export function gDir(g: GuardFrame, l: V3): V3 {
  return [g.left[0] * l[0] + g.fwd[0] * l[2], l[1], g.left[2] * l[0] + g.fwd[2] * l[2]];
}

/** Guard hand positions [L, R] in the guard frame (x = own left), per style. */
const GUARDS: Record<string, { lead: V3; rear: V3; fist: number }> = {
  highGuard: { lead: [0.07, 0.0, 0.25], rear: [-0.08, -0.02, 0.14], fist: 1 },
  philly: { lead: [0.02, -0.42, 0.17], rear: [-0.07, -0.03, 0.13], fist: 1 },
  longGuard: { lead: [0.05, -0.07, 0.42], rear: [-0.08, -0.04, 0.14], fist: 0.9 },
  peekaboo: { lead: [0.07, -0.02, 0.15], rear: [-0.07, -0.03, 0.14], fist: 1 },
  thai: { lead: [0.12, 0.02, 0.27], rear: [-0.11, 0.01, 0.21], fist: 0.9 },
  hybrid: { lead: [0.11, -0.07, 0.29], rear: [-0.09, -0.06, 0.15], fist: 0.75 },
};
const NOVICE_GUARD = { lead: [0.16, -0.3, 0.26] as V3, rear: [-0.16, -0.32, 0.2] as V3 };

export interface GuardPose {
  pos: [V3, V3];
  pole: [V3, V3];
  palm: [V3, V3];
  fist: number;
}

/** Guard hands for this fighter now, in world space. */
export function guardHands(ctx: Ctx, spec: BodySpec, d: Delta): GuardPose {
  const st = ctx.st;
  const s = st.rig.scale;
  const t = st.tiers.stance;
  const g = guardFrame(ctx, spec);
  const gs = GUARDS[st.tiers.guardStyle] ?? GUARDS.hybrid;
  const nov = clamp01((1.6 - st.tiers.values.stance) / 1.6);
  const now = ctx.nowMs / 1000;
  const econ = t.economy;
  const fat = ctx.fatigue;
  const pos: [V3, V3] = [[0, 0, 0], [0, 0, 0]];
  const pole: [V3, V3] = [[0, 0, 0], [0, 0, 0]];
  const palm: [V3, V3] = [[0, 0, 0], [0, 0, 0]];
  for (const side of [0, 1] as const) {
    const isLead = side === ctx.lead;
    const out = side === 0 ? 1 : -1;
    const base = isLead ? gs.lead : gs.rear;
    const nb = isLead ? NOVICE_GUARD.lead : NOVICE_GUARD.rear;
    // Guard styles are authored orthodox; mirror x for the southpaw.
    let l: V3 = [
      lerp(base[0] * ctx.sd, nb[0] * out, nov),
      lerp(base[1], nb[1], nov) + t.guardHeightCm / 100 * (1 - nov),
      lerp(base[2], nb[2], nov),
    ];
    l[0] += out * t.handsWide;
    // Fatigue: hands drop and drift forward-out; damage conditions add their own.
    const drop = 0.2 * clamp01(fat.handsDrop) + d.guardDown;
    l[1] -= drop * 0.75 * s;
    l[2] += drop * 0.12;
    // Idle: the lead hand paws, the rear hand breathes with the shoulders.
    const paw = isLead ? 0.025 * (0.6 + 0.6 * t.headMove) : 0.008;
    if (d.idle) {
      // The performer's hands around his head, at the tier's amplitude.
      const o = side === 0 ? CH.lhx : CH.rhx;
      const ci = t.capIdle;
      l[0] += 0.007 * s * d.idle[o] * ci;
      l[1] += 0.01 * s * d.idle[o + 1] * ci;
      l[2] += paw * 0.6 * s * d.idle[o + 2] * ci;
    } else {
      l[2] += paw * s * noise1(st.seed + 20 + side, now * (isLead ? 1.6 : 0.7));
      l[1] += 0.012 * s * noise1(st.seed + 22 + side, now * 0.9) * (0.5 + econ);
      l[0] += 0.01 * s * noise1(st.seed + 24 + side, now * 1.1) * econ;
    }
    l = [l[0] * s, l[1] * s, l[2] * s];
    const ho = d.handOff[side];
    l = [l[0] + ho[0], l[1] + ho[1], l[2] + ho[2]];
    pos[side] = gToWorld(g, l);
    const flare = t.elbowFlareDeg / 25;
    pole[side] = gToWorld(g, [l[0] + out * (0.1 + 0.22 * flare) * s, l[1] - 0.42 * s, l[2] - 0.2 * s]);
    palm[side] = norm3(gDir(g, [-out * 1, -0.35 + 0.3 * nov, -0.25]));
  }
  return { pos, pole, palm, fist: lerp(gs.fist, 0.85, nov) };
}

function norm3(v: V3): V3 {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}
