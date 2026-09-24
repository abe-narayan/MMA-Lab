/**
 * Camera quality regression guard (docs/design/PHASE8_NOTES.md, "Camera polish
 * pass"). A short version of `scripts/dev/cam-audit.ts`: the broadcast director
 * driven headless over recorded bouts chosen by content (a ground-heavy MMA bout
 * in the octagon, a boxing bout in a ring, a short street fight, a 2v2), with
 * stand-in bodies and the tracked referee, measured frame by frame for
 * visibility, occlusion, composition, motion, the edit, clipping and replay
 * framing; then every manual camera, and the hand-back from an override.
 *
 * Thresholds sit a margin above the values measured after the pass (the full
 * audit with animated bodies is the reference; see the notes).
 */
import { describe, expect, it } from 'vitest';
import {
  animatedBodies, auditCamera, CAM_BOUTS, mergeCam, recordCamBout, standInBodies, type CamRecording, type CamResult,
} from '../scripts/dev/cam-audit-lib';
import { bodyCapsules, CORNER_AVOID, cornerSamples, inflateCapsules, occlusion, type Capsule } from '../src/presentation/camera/occlusion';
import { createCameraDirector, type ShotKind } from '../src/presentation/camera';
import type { CameraRequest, CameraState, FrameInput } from '../src/presentation/contract';

const spec = (name: string) => CAM_BOUTS.find((b) => b.name === name)!;
const RECS = new Map<string, CamRecording>();
const rec = (name: string): CamRecording => {
  let r = RECS.get(name);
  if (!r) { r = recordCamBout(spec(name)); RECS.set(name, r); }
  return r;
};
/** A window of at most `s` seconds from the start plus the last 40 s. */
const windows = (r: CamRecording, s: number): [number, number][] => {
  const end = r.frames[r.frames.length - 1]!.t;
  return end <= s + 40 ? [[0, end]] : [[0, s], [end - 40, end]];
};

const finite = (s: CameraState): boolean =>
  [...s.position, ...s.target, s.fovDeg, s.rollRad, s.focusM].every(Number.isFinite);

describe('camera quality: the broadcast on air', () => {
  let all: CamResult;
  it('runs the director over recorded bouts (ground-heavy cage, ring, street, 2v2)', async () => {
    const rs: CamResult[] = [];
    for (const name of ['mma-ground', 'boxing-ring20', 'street', 'teams-2v2']) {
      const r = rec(name);
      let bad = 0;
      const res = auditCamera(r, {
        bodies: await standInBodies(r), windows: windows(r, 120), fps: 30, pre: 4, post: 20, replays: true,
        onFrame: (_t, s) => { if (!finite(s)) bad++; },
      });
      expect(bad, `${name}: non-finite camera states`).toBe(0);
      rs.push(res);
    }
    all = mergeCam(rs);
    expect(all.frames).toBeGreaterThan(5000);
  }, 240_000);

  it('keeps the subjects in frame and clear of the referee, cage and cornermen', () => {
    expect(all.headOutSafe / all.subj).toBeLessThan(0.003);
    expect(all.offScreen).toBe(0);
    expect(all.occBad / all.frames).toBeLessThan(0.01);
    // 2v2: the pair that is fighting is always in the picture.
    expect(all.primaryN).toBeGreaterThan(0);
    expect(all.primaryOut / all.primaryN).toBeLessThan(0.01);
  });

  it('composes: sensible fill, headroom, a level horizon', () => {
    expect(all.fillTight / all.fillN).toBeLessThan(0.02);
    expect(all.fillLoose / all.fillN).toBeLessThan(0.03);
    expect(all.headroomLow / Math.max(1, all.headroomN)).toBeLessThan(0.01);
    expect(all.rollDeg.max).toBeLessThan(1.5);
  });

  it('moves like an operator: no jitter, no hunting, no sudden reframes', () => {
    const mins = all.motionSeconds / 60;
    expect(all.screenSpeed.pct(0.95)).toBeLessThan(0.3);
    expect(all.jerk.pct(0.95)).toBeLessThan(4);
    expect(all.reversals / mins).toBeLessThan(6);
    expect(all.reframes / mins).toBeLessThan(0.5);
  });

  it('cuts like a live broadcast: several seconds a shot, never on a punch', () => {
    expect(all.cutsNearStrike).toBe(0);
    expect(all.shotLengths.pct(0.5)).toBeGreaterThan(5);
    expect(all.cuts / (all.liveSeconds / 60)).toBeLessThan(8);
  });

  it('never clips: fence, posts, bodies, floor, rig, building', () => {
    expect(all.clip).toEqual({});
  });

  it('replays frame the moment and hold steady in slow motion', () => {
    expect(all.replay.angles).toBeGreaterThan(0);
    expect(all.replay.keyVisible).toBe(all.replay.angles);
    expect(all.replay.keyCentreDist.max).toBeLessThan(0.6);
    expect(all.replay.cutsInside).toBe(0);
    expect(all.replay.speed.pct(0.95)).toBeLessThan(0.15);
  });

  it('costs little per frame', () => {
    // Generous: CI machines vary; the audit reports the real figure.
    expect(all.updateMs.pct(0.5)).toBeLessThan(0.5);
  });
});

describe('camera quality: every manual camera', () => {
  const CAMS: { name: string; lock?: ShotKind; request?: CameraRequest }[] = [
    { name: 'main', lock: 'main' }, { name: 'close', lock: 'mainTight' }, { name: 'side', lock: 'cageside' },
    { name: 'low', lock: 'ground' }, { name: 'overhead', lock: 'overhead' }, { name: 'reverse', lock: 'reverse' },
    { name: 'wide', lock: 'jib' }, { name: 'corner', lock: 'corner' },
    { name: 'follow', request: { mode: 'follow', followId: 0 } }, { name: 'orbit', request: { mode: 'orbit' } },
    { name: 'free', request: { mode: 'free' } },
  ];
  for (const cam of CAMS) {
    it(`${cam.name}: well composed, finite, never clips`, async () => {
      for (const name of ['mma-ground', 'boxing-ring20', 'street']) {
        const r = rec(name);
        let bad = 0;
        const res = auditCamera(r, {
          bodies: await standInBodies(r), windows: [[0, Math.min(60, r.frames[r.frames.length - 1]!.t)]], fps: 20,
          lock: cam.lock, request: cam.request, onFrame: (_t, s) => { if (!finite(s)) bad++; },
        });
        expect(bad, `${cam.name} @ ${name}`).toBe(0);
        expect(res.clip, `${cam.name} @ ${name}`).toEqual({});
        if (cam.lock !== 'jib' && cam.request?.mode !== 'free') {
          expect(res.headOutSafe / Math.max(1, res.subj), `${cam.name} @ ${name} heads`).toBeLessThan(0.02);
        }
      }
    }, 120_000);
  }

  it('an override hands back to the director cleanly', () => {
    const r = rec('mma-ground');
    const d = createCameraDirector({ aspect: 16 / 9 });
    d.setBout(r.bout, null);
    d.setRecording(r.frames, r.events);
    const at = (i: number, disc = false): FrameInput => ({
      frame: r.frames[i]!, next: r.frames[i + 1] ?? null, alpha: 0, simTime: r.frames[i]!.t, events: [],
      playbackRate: 1, replay: false, discontinuity: disc,
    });
    const i0 = Math.min(600, r.frames.length - 40);
    d.update(at(i0, true), [], 1 / 30);
    d.lockShot('overhead');
    for (let i = i0 + 1; i < i0 + 10; i++) {
      d.update(at(i), [], 0.1);
      expect(d.debug().source).toBe('locked');
      expect(d.debug().shot).toBe('overhead');
    }
    d.lockShot(null);
    const s = d.update(at(i0 + 10), [], 0.1);
    expect(d.debug().source).toBe('plan');
    expect(s.cut).toBe(true);
    expect(finite(s)).toBe(true);
    // The same shot a fresh director shows at that moment.
    const fresh = createCameraDirector({ aspect: 16 / 9 });
    fresh.setBout(r.bout, null);
    fresh.setRecording(r.frames, r.events);
    fresh.update(at(i0 + 10, true), [], 0);
    expect(d.debug().shot).toBe(fresh.debug().shot);
    // Free camera and back.
    d.setRequest({ mode: 'free' });
    d.update(at(i0 + 11), [], 0.1);
    expect(d.debug().source).toBe('user');
    d.setRequest({ mode: 'broadcast' });
    const b = d.update(at(i0 + 12), [], 0.1);
    expect(d.debug().source).toBe('plan');
    expect(b.cut).toBe(true);
  });
});

describe('camera quality: the corner between rounds', () => {
  // Performance pass 2: the cornermen kneel and lean in between the corner
  // handheld and the seated fighter. Measured with the real corner staging
  // (animated bodies, crew posed by the figure poser) over every break of an
  // octagon and a K-1 ring bout: the cornermen's capsules grown by the margin
  // for clothes and lean (forearms not counted), the share of the seated
  // fighter they hide (head, chest, hips, shoulders, hips' width, lap).
  it('keeps the cornermen out of the sight line to the seated fighter', async () => {
    for (const name of ['mma-oct30', 'k1-ring16']) {
      const r = rec(name);
      const bodies = await animatedBodies(r);
      const wins: [number, number][] = [];
      for (const re of r.events.filter((e) => e.kind === 'roundEnd')) {
        const rs = r.events.find((e) => e.kind === 'roundStart' && e.tick > re.tick);
        if (rs) wins.push([re.tick / 10 - 2, rs.tick / 10 + 1]);
      }
      expect(wins.length, `${name}: a break`).toBeGreaterThan(0);
      const occ: number[] = [];
      auditCamera(r, {
        bodies, windows: wins, fps: 10,
        onFrame: (_t, s, d, pts) => {
          const dbg = d.debug();
          if (dbg.shot !== 'corner') return;
          const caps: Capsule[] = [];
          for (const w of bodies.extras()) caps.push(...bodyCapsules(w));
          const subj = pts.filter((p) => (dbg.subjects ?? []).includes(p.id));
          if (!caps.length || !subj.length) return;
          const cam = s.position as [number, number, number];
          const samples = subj.flatMap((p) => {
            const dx = cam[0] - p.hips[0], dz = cam[2] - p.hips[2], l = Math.hypot(dx, dz) || 1;
            return cornerSamples(p, [dx / l, dz / l], []);
          });
          occ.push(occlusion(cam, samples, inflateCapsules(caps, CORNER_AVOID.margin, [], CORNER_AVOID.minR)));
        },
      });
      expect(occ.length, `${name}: corner frames with the crew in`).toBeGreaterThan(100);
      occ.sort((a, b) => a - b);
      const q = (p: number): number => occ[Math.min(occ.length - 1, Math.floor(p * occ.length))]!;
      // Before (the lens held its seeded spot): median 0.27 / 0.18, p95 0.36, 31 % / 10 % of
      // frames over 0.3 (a cornerman's back across the fighter's lap and arm). After: 0 / 0, and
      // ~8 % / 0 over 0.3 (a cornerman walking in with the stool).
      expect(q(0.5), `${name}: median hidden`).toBeLessThan(0.12);
      expect(q(0.9), `${name}: p90 hidden`).toBeLessThan(0.25);
      expect(occ.filter((o) => o > 0.3).length / occ.length, `${name}: frames > 30 % hidden`).toBeLessThan(0.1);
    }
  }, 240_000);
});

