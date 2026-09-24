/**
 * Standing animator driven by motion capture (src/presentation/anim/capture.ts,
 * capStrikes.ts): the capture must keep every guarantee the procedural path
 * gives — the weapon on the target at the recorded instant, planted feet that
 * never slide, determinism and snapping, every technique animated, tier
 * differences — within a time budget.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StandingAnimator } from '../src/presentation/anim/animator';
import { archetype, buildScenario, frameAt, type Scenario, type SynthBout } from '../src/presentation/anim/synth';
import { classify } from '../src/presentation/anim/strikes';
import { fistPoint, worldP } from '../src/presentation/anim/spec';
import { MotionLibrary, type MotionManifest } from '../src/presentation/assets/motionLibrary';
import { B, createPose, type Pose } from '../src/presentation/rig/skeleton';
import { TECHNIQUES } from '../src/sim';

const ROOT = join(__dirname, '..');
const lib = MotionLibrary.fromData(
  JSON.parse(readFileSync(join(ROOT, 'static/assets/motion/manifest.json'), 'utf8')) as MotionManifest,
  readFileSync(join(ROOT, 'static/assets/motion/motion.bin')),
);
const FRAME = 1000 / 60;
const LOG = process.env.MOCAP_LOG === '1';

function scenario(extra: Partial<Scenario>): SynthBout {
  return buildScenario({
    fighters: [archetype('arch.champion_complete'), archetype('arch.regional_pro_allrounder')],
    stances: ['orthodox', 'orthodox'], start: [[0, 0], [0, 1.2]], durationMs: 3500, actions: [],
    ...extra,
  });
}

function animator(sb: SynthBout, tier?: number, motion: MotionLibrary | null = lib): StandingAnimator {
  const an = new StandingAnimator({ tierOverride: tier === undefined ? undefined : () => tier, motion });
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

function weaponTrace(tech: string, distance: number, stance: 'orthodox' | 'southpaw' = 'orthodox', tier?: number) {
  const sb = scenario({ stances: [stance, 'orthodox'], start: [[0, 0], [0, distance]], actions: [{ fighter: 0, technique: tech, commitMs: 1037, result: 'landed' }] });
  const ev = sb.events.find((e) => e.kind === 'strike')!;
  const contact = ev.tick * 100 + ev.subMs;
  const an = animator(sb, tier);
  const out = [createPose(), createPose()];
  const info = classify(tech, stance === 'orthodox' ? 0 : 1);
  const trace: { t: number; d: number }[] = [];
  let layer = '';
  let first = true;
  for (let t = 0; t <= contact + 200; t += FRAME) {
    const tt = t < contact && t + FRAME > contact ? contact : t;
    an.evaluate(frameAt(sb, tt, first), FRAME / 1000, out);
    first = false;
    if (tt < contact - 200) continue;
    const st = an.fighterState(0)!;
    const aim = an.debug(0).ikTargets.find((x) => x.name === 'aim' || x.name === 'kick')?.pos;
    if (!aim) continue;
    if (tt === contact) layer = an.debug(0).layer;
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
    if (tt === contact) t = contact;
  }
  return { contact, trace, layer };
}

describe('capture-driven contact timing', () => {
  const cases: [string, number, 'orthodox' | 'southpaw'][] = [
    ['tech.jab', 1.2, 'orthodox'], ['tech.cross', 1.15, 'orthodox'], ['tech.hook_lead', 0.95, 'orthodox'],
    ['tech.hook_rear', 0.95, 'orthodox'], ['tech.hook_rear_body', 0.95, 'orthodox'], ['tech.uppercut_lead', 0.9, 'orthodox'],
    ['tech.jab', 1.2, 'southpaw'], ['tech.cross', 1.15, 'southpaw'],
    ['tech.kick_body_rear', 1.3, 'orthodox'], ['tech.kick_low_rear', 1.3, 'orthodox'], ['tech.kick_head_rear', 1.3, 'orthodox'],
    ['tech.teep_lead', 1.4, 'orthodox'],
  ];
  for (const [tech, distance, stance] of cases) {
    it(`${tech} (${stance}): captured, and the weapon is on the target at the recorded instant`, () => {
      const { contact, trace, layer } = weaponTrace(tech, distance, stance);
      expect(layer, 'played from a clip').toContain('strike [mocap');
      const atContact = trace.find((s) => s.t === contact)!;
      expect(atContact).toBeDefined();
      const kick = tech.includes('kick') || tech.includes('teep');
      if (LOG) console.log(tech, stance, layer, 'contact err', atContact.d.toFixed(4));
      expect(atContact.d).toBeLessThan(kick ? 0.05 : 0.03);
      // Not early: over the approach the closest the weapon gets is within one frame of the instant
      // (after it, the weapon rests on the target through the active phase).
      const approach = trace.filter((x) => x.t <= contact);
      const best = approach.reduce((x, y) => (y.d < x.d ? y : x));
      expect(Math.abs(best.t - contact)).toBeLessThanOrEqual(FRAME + 1e-6);
      const early = trace.find((x) => x.t <= contact - 3 * FRAME && x.t > contact - 4 * FRAME);
      if (early && !kick) expect(early.d).toBeGreaterThan(atContact.d + 0.05);
    });
  }
});

describe('capture-driven footwork', () => {
  it('planted feet do not slide; steps follow captured step profiles', () => {
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
    let maxDrift = 0, plants = 0, capSwings = 0;
    let first = true;
    for (let t = 0; t <= 7800; t += FRAME) {
      an.evaluate(frameAt(sb, t, first), FRAME / 1000, out);
      first = false;
      const st = an.fighterState(0)!;
      for (const side of [0, 1] as const) {
        const f = st.feet[side];
        if (f.swing?.cap) capSwings++;
        const toe = worldP(st.world, side === 0 ? B.lToe : B.rToe);
        if (!f.swing && st.planted[side]) {
          if (!plant[side] || plant[side]!.key !== f.landedAt) { plant[side] = { at: toe, key: f.landedAt }; plants++; }
          const p = plant[side]!.at;
          maxDrift = Math.max(maxDrift, Math.hypot(toe[0] - p[0], toe[1] - p[1], toe[2] - p[2]));
        } else plant[side] = null;
      }
    }
    if (LOG) console.log('footwork plants', plants, 'drift', maxDrift, 'captured swing frames', capSwings);
    expect(plants).toBeGreaterThan(12);
    expect(capSwings).toBeGreaterThan(30);
    expect(maxDrift).toBeLessThan(0.01);
  });

  it('planted feet stay put through captured strikes (the support foot pivots on its ball)', () => {
    const sb = scenario({ actions: [
      { fighter: 0, technique: 'tech.cross', commitMs: 537, result: 'landed' },
      { fighter: 0, technique: 'tech.hook_lead', commitMs: 1437, result: 'landed' },
      { fighter: 0, technique: 'tech.kick_body_rear', commitMs: 2237, result: 'landed' },
    ], durationMs: 4000 });
    const an = animator(sb);
    const out = [createPose(), createPose()];
    let first = true;
    const plant: ({ at: number[]; key: number } | null)[] = [null, null];
    let maxDrift = 0;
    for (let t = 0; t <= 3900; t += FRAME) {
      an.evaluate(frameAt(sb, t, first), FRAME / 1000, out);
      first = false;
      const st = an.fighterState(0)!;
      for (const side of [0, 1] as const) {
        const f = st.feet[side];
        const ball = worldP(st.world, side === 0 ? B.lToe : B.rToe);
        if (!f.swing && st.planted[side] && st.spec.feet[side].lift < 0.35) {
          if (!plant[side] || plant[side]!.key !== f.landedAt) plant[side] = { at: ball, key: f.landedAt };
          const p = plant[side]!.at;
          maxDrift = Math.max(maxDrift, Math.hypot(ball[0] - p[0], ball[2] - p[2]));
        } else plant[side] = null;
      }
    }
    if (LOG) console.log('strike support drift', maxDrift);
    expect(maxDrift).toBeLessThan(0.03);
  });
});

describe('capture determinism', () => {
  const sb = scenario({ actions: [
    { fighter: 0, technique: 'tech.cross', commitMs: 1037, result: 'landed' },
    { fighter: 1, technique: 'tech.kick_low_rear', commitMs: 1900, result: 'checked', defence: 'def.check' },
    { fighter: 1, technique: 'tech.jab', commitMs: 2700, result: 'evaded', defence: 'def.slip_out' },
  ] });
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
    const a = run(animator(sb), 0, 3200, true);
    const b = run(animator(sb), 0, 3200, true);
    for (let k = 0; k < 2; k++) {
      expect(Array.from(a[k].local)).toEqual(Array.from(b[k].local));
      expect(Array.from(a[k].rootPos)).toEqual(Array.from(b[k].rootPos));
    }
  });
  it('a discontinuity snaps: a seek gives the same pose as a fresh animator', () => {
    const an = animator(sb);
    run(an, 0, 1500, true);
    const out = [createPose(), createPose()];
    an.evaluate(frameAt(sb, 1200, true), 0, out);
    const fresh = [createPose(), createPose()];
    animator(sb).evaluate(frameAt(sb, 1200, true), 0, fresh);
    for (let k = 0; k < 2; k++) {
      expect(Array.from(out[k].local)).toEqual(Array.from(fresh[k].local));
      expect(Array.from(out[k].rootPos)).toEqual(Array.from(fresh[k].rootPos));
    }
  });
  it('the capture actually changes the motion (it is not the procedural path)', () => {
    const a = run(animator(sb), 0, 1300, true);
    const b = run(animator(sb, undefined, null), 0, 1300, true);
    let diff = 0;
    for (let i = 0; i < a[0].local.length; i++) diff = Math.max(diff, Math.abs(a[0].local[i] - b[0].local[i]));
    expect(diff).toBeGreaterThan(0.02);
  });
});

describe('capture coverage', () => {
  it('every catalogue technique animates (capture or procedural) without NaN', () => {
    const captured: string[] = [];
    for (const t of TECHNIQUES) {
      const id = t.id;
      for (const stance of ['orthodox', 'southpaw'] as const) {
        const sb = scenario({ stances: [stance, 'orthodox'], actions: [{ fighter: 0, technique: id, commitMs: 537, result: 'landed' }], durationMs: 2600 });
        const an = animator(sb);
        const out = [createPose(), createPose()];
        const ev = sb.events.find((e) => e.kind === 'strike')!;
        const contact = ev.tick * 100 + ev.subMs;
        let first = true, saw = false, cap = false;
        for (let t2 = 0; t2 <= 2400; t2 += 1000 / 30) {
          const tt = t2 < contact && t2 + 1000 / 30 > contact ? contact : t2;
          an.evaluate(frameAt(sb, tt, first), 1 / 30, out);
          first = false;
          for (const p of out) for (const v of [...p.local, ...p.rootPos]) expect(Number.isFinite(v), id).toBe(true);
          if (an.debug(0).technique === id) saw = true;
          if (an.debug(0).layer.includes('strike [mocap')) cap = true;
        }
        expect(saw, id).toBe(true);
        if (cap && stance === 'orthodox') captured.push(id);
      }
    }
    if (LOG) console.log(`captured ${captured.length}/54:`, captured.join(' '));
    expect(captured.length).toBeGreaterThanOrEqual(30);
  });

  it('recorded slips and blocks play from capture and move the head off the line', () => {
    const base = scenario({ actions: [{ fighter: 0, technique: 'tech.jab', commitMs: 1037, result: 'landed' }] });
    const slip = scenario({ actions: [{ fighter: 0, technique: 'tech.jab', commitMs: 1037, result: 'evaded', defence: 'def.slip_out' }] });
    const at = (sb: SynthBout, ms: number): { head: number[]; layer: string } => {
      const an = animator(sb);
      const out = [createPose(), createPose()];
      let first = true;
      for (let t = 0; t <= ms; t += FRAME) { an.evaluate(frameAt(sb, t, first), FRAME / 1000, out); first = false; }
      return { head: worldP(an.fighterState(1)!.world, B.head), layer: an.debug(1).layer };
    };
    const c = base.events[0].tick * 100 + base.events[0].subMs;
    const s = at(slip, c);
    expect(s.layer).toContain('slipOut [mocap]');
    expect(Math.abs(s.head[0] - at(base, c).head[0])).toBeGreaterThan(0.08);
  });
});

describe('tier degradation of captured motion', () => {
  it('a T0 fighter is squarer, more upright, hands lower and punches with less hip turn than a T5', () => {
    const sb = scenario({ actions: [{ fighter: 0, technique: 'tech.cross', commitMs: 1037, result: 'landed' }] });
    const ev = sb.events.find((e) => e.kind === 'strike')!;
    const contact = ev.tick * 100 + ev.subMs;
    const measure = (tier: number) => {
      const an = animator(sb, tier);
      const out = [createPose(), createPose()];
      let first = true;
      let idle = { blade: 0, hips: 0, handY: 0, width: 0, heel: 0 };
      let yaw0 = 0, yawC = 0;
      for (let t = 0; t <= contact; t += FRAME) {
        const tt = t + FRAME > contact ? contact : t;
        an.evaluate(frameAt(sb, tt, first), FRAME / 1000, out);
        first = false;
        const st = an.fighterState(0)!;
        if (Math.abs(tt - 900) < FRAME / 2) {
          const head = worldP(st.world, B.head);
          const lf = worldP(st.world, B.lFoot), rf = worldP(st.world, B.rFoot);
          const hands = (worldP(st.world, B.lHand)[1] + worldP(st.world, B.rHand)[1]) / 2;
          idle = {
            blade: Math.abs(st.spec.pelvisYaw), hips: out[0].rootPos[1], handY: head[1] - hands,
            width: Math.abs(lf[0] - rf[0]), heel: Math.max(st.spec.feet[0].lift, st.spec.feet[1].lift),
          };
          yaw0 = st.spec.pelvisYaw;
        }
        if (tt === contact) yawC = st.spec.pelvisYaw;
        if (tt === contact) break;
      }
      return { ...idle, turn: Math.abs(yawC - yaw0) };
    };
    const t0 = measure(0), t5 = measure(5);
    if (LOG) console.log('T0', t0, 'T5', t5);
    expect(t0.blade).toBeLessThan(t5.blade * 0.5);
    expect(t0.hips).toBeGreaterThan(t5.hips + 0.02);
    expect(t0.handY).toBeGreaterThan(t5.handY + 0.1);
    expect(t0.width).toBeGreaterThan(t5.width);
    expect(t0.heel).toBeLessThan(t5.heel);
    expect(t0.turn).toBeLessThan(t5.turn * 0.5);
  });
});

describe('capture cost', () => {
  const time = (n: number): number => {
    const fighters = Array.from({ length: n }, (_, i) => archetype(i % 2 ? 'arch.regional_pro_allrounder' : 'arch.champion_complete'));
    const start: [number, number][] = Array.from({ length: n }, (_, i) => [(i % 3) * 1.6, Math.floor(i / 3) * 1.4 + (i % 2) * 1.1]);
    const actions = [];
    for (let k = 0; k < 10; k++) actions.push({ fighter: k % n, technique: ['tech.jab', 'tech.cross', 'tech.hook_lead', 'tech.kick_body_rear'][k % 4], commitMs: 300 + k * 520, result: 'landed' as const });
    const sb = buildScenario({
      fighters, stances: fighters.map(() => 'orthodox' as const), start, durationMs: 6000, actions,
      moves: [{ fighter: 0, fromMs: 500, toMs: 5500, vx: 0.6, vz: 0.3 }],
    });
    const an = animator(sb);
    const out = fighters.map(() => createPose());
    let first = true;
    for (let t = 0; t < 1000; t += FRAME) { an.evaluate(frameAt(sb, t, first), FRAME / 1000, out); first = false; }
    const t0 = performance.now();
    let frames = 0;
    for (let t = 1000; t < 5800; t += FRAME) { an.evaluate(frameAt(sb, t, false), FRAME / 1000, out); frames++; }
    return (performance.now() - t0) / frames;
  };
  it('evaluate stays within budget for 2 and 6 fighters', () => {
    const two = time(2), six = time(6);
    console.log(`mocap evaluate: 2 fighters ${two.toFixed(3)} ms, 6 fighters ${six.toFixed(3)} ms`);
    expect(two).toBeLessThan(1.5);
    expect(six).toBeLessThan(4.5);
  });
});
