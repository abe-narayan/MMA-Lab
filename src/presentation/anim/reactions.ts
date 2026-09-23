/**
 * L2 — HIT REACTIONS, and L3 — FATIGUE / DAMAGE POSTURE and FACE.
 *
 * Hit reactions are critically damped impulse responses (docs/design/08 §5.8)
 * evaluated ANALYTICALLY from the recorded strike events: each landed strike
 * contributes `A * h(now - t_contact)` along its own direction, where
 * h(t) = w t e^(1 - w t) snaps to 1 at t = 1/w and settles without overshoot.
 * Because the response is a pure function of (events, time), a reaction is
 * identical whether the frame was reached by playing, scrubbing or seeking —
 * no spring state to reset, no dependence on the display frame rate.
 *
 * Direction comes from the technique family and the side it came from (a hook
 * from the right turns the head left and tilts it; a straight snaps it back;
 * an uppercut lifts the chin; body shots fold toward the struck side; a leg
 * kick buckles the leg); magnitude from the recorded force relative to the
 * technique's median, the `unseen` flag and the tier's composure.
 */
import type { SimEvent, StrikeEvent } from '../../sim';
import {
  DEG, clamp01, hash01, impulse, noise1, softCap, windowW,
} from './math';
import type { Ctx, Delta } from './state';
import { classify } from './strikes';
import { TECH } from './timing';

const W_HEAD = 22;
const W_BODY = 13;
const W_LEG = 11;

export interface ReactionOut {
  /** Largest head reaction weight this frame (for the face / eyes). */
  head: number;
  body: number;
}

export function hitReactions(ctx: Ctx, d: Delta): ReactionOut {
  const st = ctx.st;
  const s = st.rig.scale;
  const now = ctx.nowMs;
  const me = ctx.f.id;
  const t = st.tiers.stance;
  const react = 0.75 + 0.55 * t.economy;
  let hp = 0, hy = 0, hr = 0, sp = 0, sr = 0, sy = 0, py = 0, pr = 0, pz = 0;
  let headW = 0, bodyW = 0, wince = 0, grimace = 0, eyes = 0;
  const handDrop = [0, 0];
  const handBack = [0, 0];
  for (let i = ctx.events.length - 1; i >= 0; i--) {
    const e = ctx.events[i] as SimEvent;
    const te = e.tick * 100 + e.subMs;
    const dt = now - te;
    if (dt > 1600) break;
    if (dt < 0 || e.kind !== 'strike') continue;
    const se = e as StrikeEvent;
    const res = se.detail.result;
    if (se.actor === me && res === 'checked') {
      // The kicker's shin bounced off a check: a wince and a hitch in the hips.
      const h = impulse(dt / 1000,W_LEG);
      pr += 5 * DEG * h;
      wince = Math.max(wince, 0.6 * h);
      continue;
    }
    if (se.target !== me) continue;
    if (res !== 'landed' && res !== 'blocked' && res !== 'caught') continue;
    const spec = TECH.get(se.detail.technique);
    const attacker = ctx.opp && ctx.opp.id === se.actor ? ctx.oppSnap : null;
    const info = classify(se.detail.technique, attacker && attacker.stance === 'southpaw' ? 1 : 0);
    const ws = info.hand !== -1 ? (info.hand === 0 ? 1 : -1) : info.leg !== -1 ? (info.leg === 0 ? 1 : -1) : 1;
    const fs = -ws; // side it arrives on, in my frame (+1 my left)
    const force = se.detail.forceN ?? 0;
    const ref = spec ? spec.forceMedianN : 2000;
    let A = Math.min(1.7, Math.max(0.35, force > 0 ? force / ref : 0.7)) * react;
    if (se.detail.unseen) A *= 1.35;
    if (res === 'blocked') {
      // A blocked shot still rocks the guard back into the face.
      const h = impulse(dt / 1000,W_HEAD * 0.8);
      const side = fs > 0 ? 0 : 1;
      handBack[side] += 0.07 * s * h * A;
      hp += -4 * DEG * h * A;
      sy += -fs * 3 * DEG * h * A;
      continue;
    }
    const region = se.detail.target;
    if (region === 'head') {
      const h = impulse(dt / 1000,W_HEAD);
      headW = Math.max(headW, h * A);
      switch (info.kind) {
        case 'jab': case 'cross': case 'teep':
          hp += -24 * DEG * h * A; sp += -7 * DEG * h * A; hy += fs * 8 * DEG * h * A; pz += -0.04 * s * h * A;
          break;
        case 'hook': case 'backfist': case 'round': case 'wheel':
          hy += -fs * 30 * DEG * h * A; hr += fs * 14 * DEG * h * A; sy += -fs * 8 * DEG * h * A;
          sr += fs * 5 * DEG * h * A; hp += -4 * DEG * h * A;
          break;
        case 'uppercut': case 'knee':
          hp += -30 * DEG * h * A; sp += -9 * DEG * h * A; pz += -0.02 * s * h * A;
          break;
        case 'overhand': case 'axe':
          hp += 14 * DEG * h * A; hy += -fs * 16 * DEG * h * A; py += -0.03 * s * h * A;
          break;
        case 'elbow':
          hy += -fs * 22 * DEG * h * A; hr += fs * 10 * DEG * h * A; hp += -8 * DEG * h * A;
          break;
        default:
          hp += -14 * DEG * h * A;
      }
      wince = Math.max(wince, h * Math.min(1, A));
      // Untrained fighters shut their eyes and turn away.
      eyes = Math.max(eyes, t.flinch * windowW(dt, -50, 0, 220, 450));
    } else if (region === 'body') {
      const h = impulse(dt / 1000,W_BODY);
      bodyW = Math.max(bodyW, h * A);
      sp += 17 * DEG * h * A;
      hp += 7 * DEG * h * A;
      py += -0.035 * s * h * A;
      pz += -0.04 * s * h * A * (info.kind === 'teep' || info.kind === 'jab' || info.kind === 'cross' ? 2 : 1);
      if (info.kind !== 'teep' && info.kind !== 'jab' && info.kind !== 'cross') {
        sr += -fs * 11 * DEG * h * A;
        const side = fs > 0 ? 0 : 1;
        handDrop[side] += 0.08 * s * h * A;
      }
      grimace = Math.max(grimace, Math.min(1, h * A * 1.2));
      wince = Math.max(wince, h * A * 0.7);
    } else if (region === 'leadLeg' || region === 'rearLeg') {
      const h = impulse(dt / 1000,W_LEG);
      const pain = st.tiers.stance.painReaction * 1.6;
      const legLeft = (region === 'leadLeg') === (ctx.lead === 0);
      const ls = legLeft ? 1 : -1;
      py += -0.05 * s * h * A * (0.6 + pain);
      pr += -ls * 7 * DEG * h * A * (0.6 + pain);
      sr += ls * 3 * DEG * h * A;
      grimace = Math.max(grimace, h * A * pain * 0.6);
    }
  }
  // Saturate: a flurry cannot fold a neck past what a neck does.
  d.headPitch += softCap(hp, 35 * DEG);
  d.headYaw += softCap(hy, 38 * DEG);
  d.headRoll += softCap(hr, 25 * DEG);
  d.spinePitch += softCap(sp, 25 * DEG);
  d.spineRoll += softCap(sr, 18 * DEG);
  d.spineYaw += softCap(sy, 15 * DEG);
  d.pelvisOff[1] += softCap(py, 0.1 * s);
  d.pelvisOff[2] += softCap(pz, 0.08 * s);
  d.pelvisRoll += softCap(pr, 10 * DEG);
  for (const side of [0, 1] as const) {
    d.handOff[side][1] -= handDrop[side];
    d.handOff[side][2] -= handBack[side];
  }
  // The snap rides on top of the look-at (dropping the look would swing the
  // head back to the bladed chest and double the turn).
  d.lookW *= 1 - Math.min(0.25, headW * 0.25);
  d.face[0] = Math.max(d.face[0], eyes, 0.8 * clamp01(headW - 0.3));
  d.face[1] = Math.max(d.face[1], eyes, 0.8 * clamp01(headW - 0.3));
  d.face[6] = Math.max(d.face[6], wince);
  d.face[4] = Math.max(d.face[4], grimace);
  d.face[3] = Math.max(d.face[3], 0.6 * grimace);
  return { head: headW, body: bodyW };
}

/** Novices turn their back under fire (`tier.turns_back`), seeded per strike. */
export function turnAway(ctx: Ctx, d: Delta): void {
  const st = ctx.st;
  const p = st.tiers.stance.turnsBack;
  if (p < 0.05) return;
  const now = ctx.nowMs;
  for (let i = ctx.events.length - 1; i >= 0; i--) {
    const e = ctx.events[i];
    const te = e.tick * 100 + e.subMs;
    const dt = now - te;
    if (dt > 1400) break;
    if (dt < 0 || e.kind !== 'strike' || e.target !== ctx.f.id) continue;
    const se = e as StrikeEvent;
    if (se.detail.result !== 'landed' || se.detail.target !== 'head') continue;
    if (hash01(st.seed, e.tick, 31) >= p * 0.6) continue;
    const w = windowW(dt, 0, 150, 700, 1300);
    const side = hash01(st.seed, e.tick, 32) < 0.5 ? 1 : -1;
    d.frameYaw += side * 75 * DEG * w;
    d.spinePitch += 18 * DEG * w;
    d.headPitch += 20 * DEG * w;
    d.lookW *= 1 - w;
    d.guardDrop = Math.max(d.guardDrop, w);
    d.face[0] = Math.max(d.face[0], w);
    d.face[1] = Math.max(d.face[1], w);
    return;
  }
}

/** Pre-contact flinch on incoming power shots for untrained fighters (tier `flinch`). */
export function incomingFlinch(ctx: Ctx): { w: number; fromSide: number } {
  const fl = ctx.st.tiers.stance.flinch;
  if (fl <= 0.02) return { w: 0, fromSide: 0 };
  let best = 0, side = 0;
  for (const inc of ctx.incoming) {
    const dt = ctx.nowMs - inc.t.contact;
    const w = windowW(dt, -170, -40, 150, 350) * fl;
    if (w > best) {
      best = w;
      const info = classify(inc.t.id, inc.fromSnap.stance === 'orthodox' ? 0 : 1);
      const ws = info.hand !== -1 ? (info.hand === 0 ? 1 : -1) : info.leg !== -1 ? (info.leg === 0 ? 1 : -1) : 1;
      side = -ws;
    }
  }
  return { w: best, fromSide: side };
}

// ---------------------------------------------------------------------------
// L3: fatigue, damage, face
// ---------------------------------------------------------------------------

export function condition(ctx: Ctx, d: Delta): void {
  const st = ctx.st;
  const s = st.rig.scale;
  const t = st.tiers.stance;
  const now = ctx.nowMs / 1000;
  const fv = ctx.fatigue;
  const f = clamp01(fv.f);
  // Elites hide their tells until later (`tier.fatigue_tell_onset`).
  const tell = clamp01((f - t.fatigueOnset) / 0.3);
  const has = (id: string): boolean => ctx.states.has(id);
  const hasPre = (pre: string): string | null => {
    for (const x of ctx.states) if (x.startsWith(pre)) return x;
    return null;
  };

  // Breathing: rate in breaths/min from the sim (12 + 36 f).
  const adren = has('state.adrenaline_dump') ? 1.4 : 1;
  const hz = (fv.breathingRate || 14) * adren / 60;
  const br = 0.5 + 0.5 * Math.sin(2 * Math.PI * hz * now + hash01(st.seed, 41) * 6.28);
  const depth = 0.25 + 0.75 * Math.max(f, adren > 1 ? 0.4 : 0);
  d.spinePitch += -1.6 * DEG * br * depth;
  d.clavRaise[0] += 3 * DEG * br * depth;
  d.clavRaise[1] += 3 * DEG * br * depth;
  d.face[7] = br * depth;

  // Fatigue tells: shoulders slump, chin up, feet flatten, mouth opens.
  d.spinePitch += 5 * DEG * tell;
  d.clavRaise[0] -= 4 * DEG * tell;
  d.clavRaise[1] -= 4 * DEG * tell;
  d.pelvisOff[1] -= 0.015 * s * tell;
  d.headPitch += -8 * DEG * clamp01(fv.chinUp) * (0.4 + 0.6 * tell);
  d.heel *= 1 - 0.8 * clamp01(fv.flatFeet) * (0.3 + 0.7 * tell);
  d.bounce *= 1 - 0.9 * clamp01(fv.flatFeet);
  d.guardDown += 0.05 * tell;
  d.face[3] = Math.max(d.face[3], clamp01(f * 1.3 - 0.25) * (0.6 + 0.4 * br) * (0.5 + 0.5 * tell), adren > 1 ? 0.25 * br : 0);

  // Stunned / rocked.
  if (has('state.stunned')) d.guardDown += 0.03;
  if (has('state.rocked')) {
    d.stanceWidth *= 1.22;
    d.pelvisOff[1] += -0.04 * s + 0.028 * s * Math.sin(2 * Math.PI * 1.5 * now);
    d.pelvisRoll += 5 * DEG * noise1(st.seed + 50, now * 1.4);
    d.spineRoll += 4 * DEG * noise1(st.seed + 51, now * 1.1);
    d.headRoll += 6 * DEG * noise1(st.seed + 52, now * 0.9);
    d.headPitch += 5 * DEG * noise1(st.seed + 53, now * 0.8);
    d.guardDown += 0.08;
    d.lookW *= 0.7;
    d.bounce *= 0.2;
    d.face[5] = Math.max(d.face[5], 0.35);
    d.face[0] = Math.max(d.face[0], 0.25);
    d.face[1] = Math.max(d.face[1], 0.25);
  }
  // Body hurt / winded: elbows in, torso folds forward, mouth open.
  if (has('state.body_hurt') || has('state.winded') || has('state.body_worn')) {
    const k = has('state.body_hurt') || has('state.winded') ? 1 : 0.4;
    d.spinePitch += 13 * DEG * k;
    d.handOff[0][0] -= 0.03 * s * k;
    d.handOff[1][0] += 0.03 * s * k;
    const liver = 1 - ctx.lead;
    d.handOff[liver][1] -= 0.1 * s * k;
    d.face[3] = Math.max(d.face[3], 0.5 * k);
    d.face[4] = Math.max(d.face[4], 0.3 * k);
  }
  // Leg damage: weight off the hurt leg.
  const dead = hasPre('state.dead_leg') ?? hasPre('state.leg_compromised');
  if (dead) {
    const rear = dead.endsWith(':rear');
    const hurt = rear ? 1 - ctx.lead : ctx.lead;
    const away = hurt === 0 ? -1 : 1;
    d.pelvisOff[0] += away * 0.05 * s;
    d.feet[hurt].lift = 0; d.feet[hurt].liftW = Math.max(d.feet[hurt].liftW, 0.7);
    d.bounce *= 0.3;
  }
  const arm = hasPre('state.dead_arm');
  if (arm) {
    const side = arm.endsWith(':R') ? 1 : 0;
    d.handOff[side][1] -= 0.08 * s;
  }
  const eye = hasPre('state.eye_swollen_shut');
  if (eye) {
    const side = eye.endsWith(':R') ? 1 : 0;
    d.face[side] = Math.max(d.face[side], 0.85);
    d.headYaw += (side === 0 ? -1 : 1) * 10 * DEG;
  }
  // Blinks, seeded: every 2.5-5 s.
  const period = 2.5 + 2.5 * hash01(st.seed, 60);
  const ph = (now / period + hash01(st.seed, 61)) % 1;
  const blink = ph < 0.035 ? Math.sin((ph / 0.035) * Math.PI) : 0;
  d.face[0] = Math.max(d.face[0], blink);
  d.face[1] = Math.max(d.face[1], blink);
  // Damage shows in the brow.
  d.face[2] = Math.max(d.face[2], clamp01(ctx.f.damage.head * 0.8));
}
