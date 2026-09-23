/**
 * Standing animator (src/presentation/anim): contact timing, foot planting,
 * determinism, coverage of every technique and defence, and tier motion.
 */
import { describe, expect, it } from 'vitest';
import { StandingAnimator } from '../src/presentation/anim/animator';
import { archetype, buildScenario, frameAt, type Scenario, type SynthBout } from '../src/presentation/anim/synth';
import { classify } from '../src/presentation/anim/strikes';
import { DEFENCE_MOTION, defenceMotion } from '../src/presentation/anim/defence';
import { fistPoint, worldP } from '../src/presentation/anim/spec';
import { B, createPose, type Pose } from '../src/presentation/rig/skeleton';
import { TECHNIQUES } from '../src/sim';
import { DEFENCES } from '../src/sim/striking/defence';

const FRAME = 1000 / 60;

function scenario(extra: Partial<Scenario>): SynthBout {
  return buildScenario({
    fighters: [archetype('arch.champion_complete'), archetype('arch.regional_pro_allrounder')],
    stances: ['orthodox', 'orthodox'], start: [[0, 0], [0, 1.2]], durationMs: 3500, actions: [],
    ...extra,
  });
}

function animator(sb: SynthBout, tier?: number): StandingAnimator {
  const an = new StandingAnimator({ tierOverride: tier === undefined ? undefined : () => tier });
  an.setBout(sb.bout, sb.rests);
  return an;
}

const dist3 = (a: number[], b: number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function segDist(p: number[], a: number[], b: number[]): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const t = Math.max(0, Math.min(1, (ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
}

/**
 * Play a single landed technique at 60 fps (landing exactly on the contact
 * instant) and return the weapon's distance to its aim at every frame.
 */
function weaponTrace(tech: string, distance: number): { contact: number; trace: { t: number; d: number }[] } {
  const sb = scenario({ start: [[0, 0], [0, distance]], actions: [{ fighter: 0, technique: tech, commitMs: 1037, result: 'landed' }] });
  const ev = sb.events.find((e) => e.kind === 'strike')!;
  const contact = ev.tick * 100 + ev.subMs;
  const an = animator(sb);
  const out = [createPose(), createPose()];
  const info = classify(tech, 0);
  const trace: { t: number; d: number }[] = [];
  let first = true;
  for (let t = 0; t <= contact + 200; t += FRAME) {
    // Land one sample exactly on the contact instant.
    const tt = t < contact && t + FRAME > contact ? contact : t;
    an.evaluate(frameAt(sb, tt, first), FRAME / 1000, out);
    first = false;
    if (tt < contact - 200) continue;
    const st = an.fighterState(0)!;
    const aim = an.debug(0).ikTargets.find((x) => x.name === 'aim' || x.name === 'kick')?.pos;
    if (!aim) continue;
    let d: number;
    if (info.hand !== -1) d = dist3(fistPoint(st.world, st.rig, info.hand as 0 | 1), aim);
    else {
      const L = info.leg === 0;
      const knee = worldP(st.world, L ? B.lLeg : B.rLeg);
      const ankle = worldP(st.world, L ? B.lFoot : B.rFoot);
      const toe = worldP(st.world, L ? B.lToe : B.rToe);
      d = Math.min(segDist(aim, knee, ankle), segDist(aim, ankle, toe));
    }
    trace.push({ t: tt, d });
    if (tt === contact) t = contact; // continue on the 60 fps grid from the contact instant
  }
  return { contact, trace };
}

describe('contact timing', () => {
  for (const [tech, distance] of [['tech.jab', 1.2], ['tech.cross', 1.15], ['tech.hook_lead', 0.95], ['tech.kick_body_rear', 1.3], ['tech.kick_low_rear', 1.3]] as const) {
    it(`${tech}: the weapon is on the target at the recorded contact instant`, () => {
      const { contact, trace } = weaponTrace(tech, distance);
      const atContact = trace.find((s) => s.t === contact)!;
      expect(atContact).toBeDefined();
      expect(atContact.d).toBeLessThan(0.03);
      // ...and not before: the closest approach is within one frame of the instant.
      const best = trace.reduce((a, b) => (b.d < a.d ? b : a));
      expect(Math.abs(best.t - contact)).toBeLessThanOrEqual(FRAME + 1e-6);
      const early = trace.find((s) => s.t <= contact - 3 * FRAME && s.t > contact - 4 * FRAME);
      if (early) expect(early.d).toBeGreaterThan(atContact.d + 0.05);
    });
  }
});

describe('footwork', () => {
  it('planted feet do not slide across advance / circle / retreat', () => {
    const v = 1.3;
    const sb = scenario({
      start: [[0, 0], [0, 1.8]], durationMs: 8000,
      moves: [
        { fighter: 0, fromMs: 800, toMs: 1800, vx: 0, vz: v * 0.8 },
        { fighter: 0, fromMs: 2100, toMs: 3600, vx: v, vz: 0 },
        { fighter: 0, fromMs: 3900, toMs: 4900, vx: 0, vz: -v * 0.8 },
        { fighter: 0, fromMs: 5200, toMs: 6700, vx: -v, vz: 0 },
      ],
    });
    const an = animator(sb);
    const out = [createPose(), createPose()];
    const plant: ({ at: number[]; key: number } | null)[] = [null, null];
    let maxDrift = 0;
    let plants = 0;
    let first = true;
    for (let t = 0; t <= 7800; t += FRAME) {
      an.evaluate(frameAt(sb, t, first), FRAME / 1000, out);
      first = false;
      const st = an.fighterState(0)!;
      for (const side of [0, 1] as const) {
        const f = st.feet[side];
        const toe = worldP(st.world, side === 0 ? B.lToe : B.rToe);
        if (!f.swing && st.planted[side]) {
          if (!plant[side] || plant[side]!.key !== f.landedAt) { plant[side] = { at: toe, key: f.landedAt }; plants++; }
          const p = plant[side]!.at;
          maxDrift = Math.max(maxDrift, Math.hypot(toe[0] - p[0], toe[1] - p[1], toe[2] - p[2]));
        } else plant[side] = null;
      }
    }
    expect(plants).toBeGreaterThan(12); // it actually stepped
    expect(maxDrift).toBeLessThan(0.01);
  });
});

describe('determinism', () => {
  const sb = scenario({ actions: [{ fighter: 0, technique: 'tech.cross', commitMs: 1037, result: 'landed' }, { fighter: 1, technique: 'tech.kick_low_rear', commitMs: 1900, result: 'checked', defence: 'def.check' }] });
  const run = (an: StandingAnimator, from: number, to: number, snapFirst: boolean): Pose[] => {
    const out = [createPose(), createPose()];
    let first = snapFirst;
    for (let t = from; t <= to + 1e-9; t += FRAME) {
      an.evaluate(frameAt(sb, t, first), FRAME / 1000, out);
      first = false;
    }
    return out;
  };
  it('the same inputs give bit-identical poses', () => {
    const a = run(animator(sb), 0, 2600, true);
    const b = run(animator(sb), 0, 2600, true);
    for (let k = 0; k < 2; k++) {
      expect(Array.from(a[k].local)).toEqual(Array.from(b[k].local));
      expect(Array.from(a[k].rootPos)).toEqual(Array.from(b[k].rootPos));
      expect(Array.from(a[k].face)).toEqual(Array.from(b[k].face));
    }
  });
  it('a discontinuity snaps: a seek gives the same pose as a fresh animator', () => {
    const an = animator(sb);
    run(an, 0, 1500, true);
    const out = [createPose(), createPose()];
    an.evaluate(frameAt(sb, 400, true), 0, out);
    const fresh = [createPose(), createPose()];
    animator(sb).evaluate(frameAt(sb, 400, true), 0, fresh);
    for (let k = 0; k < 2; k++) {
      expect(Array.from(out[k].local)).toEqual(Array.from(fresh[k].local));
      expect(Array.from(out[k].rootPos)).toEqual(Array.from(fresh[k].rootPos));
    }
  });
});

describe('coverage', () => {
  it('every catalogue technique has a motion (no fallthrough) and animates without NaN', () => {
    const ids = TECHNIQUES.map((t) => t.id);
    expect(ids.length).toBe(54);
    for (const id of ids) {
      const info = classify(id, 0);
      expect(info.kind, id).not.toBe('grapple');
      expect(info.hand !== -1 || info.leg !== -1, id).toBe(true);
    }
    for (const id of ids) {
      const sb = scenario({ actions: [{ fighter: 0, technique: id, commitMs: 537, result: 'landed' }], durationMs: 2600 });
      const an = animator(sb);
      const out = [createPose(), createPose()];
      const ev = sb.events.find((e) => e.kind === 'strike')!;
      const contact = ev.tick * 100 + ev.subMs;
      let first = true;
      let sawStrike = false;
      for (let t = 0; t <= 2400; t += 1000 / 30) {
        const tt = t < contact && t + 1000 / 30 > contact ? contact : t;
        an.evaluate(frameAt(sb, tt, first), 1 / 30, out);
        first = false;
        for (const p of out) for (const v of [...p.local, ...p.rootPos]) expect(Number.isFinite(v), id).toBe(true);
        if (an.debug(0).technique === id) sawStrike = true;
      }
      expect(sawStrike, id).toBe(true);
    }
  });

  it('every striking defence id is handled', () => {
    for (const d of DEFENCES) {
      expect(DEFENCE_MOTION[d.id], d.id).toBeDefined();
      expect(defenceMotion(d.id), d.id).not.toBe('none');
    }
    expect(defenceMotion('def.neutral')).toBe('none');
  });

  it('a recorded defence visibly moves the defender (slip moves the head off the line)', () => {
    const base = scenario({ actions: [{ fighter: 0, technique: 'tech.jab', commitMs: 1037, result: 'landed' }] });
    const slip = scenario({ actions: [{ fighter: 0, technique: 'tech.jab', commitMs: 1037, result: 'evaded', defence: 'def.slip_out' }] });
    const headAt = (sb: SynthBout, ms: number): number[] => {
      const an = animator(sb);
      const out = [createPose(), createPose()];
      let first = true;
      for (let t = 0; t <= ms; t += FRAME) { an.evaluate(frameAt(sb, t, first), FRAME / 1000, out); first = false; }
      return worldP(an.fighterState(1)!.world, B.head);
    };
    const ev = base.events[0];
    const c = ev.tick * 100 + ev.subMs;
    expect(Math.abs(headAt(slip, c)[0] - headAt(base, c)[0])).toBeGreaterThan(0.08);
  });
});

describe('tier motion', () => {
  it('a T0 stance is squarer and more upright than a T5 stance', () => {
    const sb = scenario({});
    const measure = (tier: number): { blade: number; hips: number; handY: number; heel: number } => {
      const an = animator(sb, tier);
      const out = [createPose(), createPose()];
      an.evaluate(frameAt(sb, 1000, true), 0, out);
      const st = an.fighterState(0)!;
      const head = worldP(st.world, B.head);
      const hands = (worldP(st.world, B.lHand)[1] + worldP(st.world, B.rHand)[1]) / 2;
      return {
        blade: Math.abs(st.spec.pelvisYaw),
        hips: out[0].rootPos[1],
        handY: head[1] - hands,
        heel: Math.max(st.spec.feet[0].lift, st.spec.feet[1].lift),
      };
    };
    const t0 = measure(0);
    const t5 = measure(5);
    expect(t0.blade).toBeLessThan(t5.blade * 0.5); // square vs bladed
    expect(t0.hips).toBeGreaterThan(t5.hips + 0.02); // upright vs knees bent
    expect(t0.handY).toBeGreaterThan(t5.handY + 0.1); // hands at the chest vs at the face
    expect(t0.heel).toBeLessThan(t5.heel); // flat-footed vs on the balls
  });
});
