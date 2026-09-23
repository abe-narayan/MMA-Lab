/**
 * Phase 8 assets: the motion-capture library, the typed asset table and the
 * licence ledger.
 *
 *  - integrity: every URL in `ASSETS` exists under static/, the motion binary
 *    matches its manifest (size + sha256), every clip / asset names a licence
 *    documented in docs/ASSETS.md, and every shipped file in the directories
 *    this pipeline owns is documented;
 *  - retargeting quality on the shipped data, through the runtime sampler:
 *    feet on the floor when planted, knees and elbows never bend backwards,
 *    fighters face +Z, strikes land in front;
 *  - the sampler: frame-exact at frame times, slerp between, loops wrap,
 *    one-shots clamp, in-place + trajectory = full;
 *  - mirroring: mirrored clips are exact X-reflections with left/right swapped;
 *  - the build is deterministic (pure pipeline on a synthetic BVH, and — when
 *    the raw data cache is present — a full rebuild matches the committed bytes).
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  B, BONES, BONE_COUNT, boneIndex, createPose, createWorldPose, defaultRest, forwardKinematics, slerpInto,
  type Pose,
} from '../src/presentation/rig/skeleton';
import {
  MotionLibrary, alignContact, makeTimeWarp, mirrorPose, placePose, warpTime, type MotionManifest,
} from '../src/presentation/assets/motionLibrary';
import { ASSETS, allAssetUrls } from '../src/presentation/assets/manifest';

const ROOT = join(__dirname, '..');
const STATIC = join(ROOT, 'static');
const assetsMd = readFileSync(join(ROOT, 'docs', 'ASSETS.md'), 'utf8');
const manifest = JSON.parse(readFileSync(join(STATIC, 'assets', 'motion', 'manifest.json'), 'utf8')) as MotionManifest;
const bin = readFileSync(join(STATIC, 'assets', 'motion', 'motion.bin'));
const lib = MotionLibrary.fromData(manifest, bin);
const rest = defaultRest();
const toFile = (url: string) => join(STATIC, url.replace(/^\//, ''));
const ALLOWED_LICENCES = ['CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0', 'OFL-1.1', 'CMU-mocap'];

// ---------------------------------------------------------------------------
// Integrity
// ---------------------------------------------------------------------------

describe('asset manifest integrity', () => {
  it('every URL in ASSETS resolves to a non-empty file under static/', () => {
    for (const url of allAssetUrls()) {
      expect(url.startsWith('/assets/'), url).toBe(true);
      const f = toFile(url);
      expect(existsSync(f), url).toBe(true);
      expect(statSync(f).size, url).toBeGreaterThan(1000);
    }
  });

  it('every asset id in ASSETS is documented in docs/ASSETS.md with an allowed licence id', () => {
    const ids = [
      ...Object.values(ASSETS.hdri).map((h) => h.id),
      ...Object.values(ASSETS.textures).map((t) => t.id),
      ASSETS.fonts.broadcast.id,
      ...Object.values(manifest.sources).map((s) => s.asset),
    ];
    for (const id of ids) {
      const at = assetsMd.indexOf(`### ${id}`);
      expect(at, `${id} missing from docs/ASSETS.md`).toBeGreaterThanOrEqual(0);
      const entry = assetsMd.slice(at, assetsMd.indexOf('\n### ', at + 4) >>> 0 || undefined);
      const lic = /\*\*Licence id\*\*: ([A-Za-z0-9.-]+)/.exec(entry)?.[1];
      expect(ALLOWED_LICENCES, `${id} licence ${lic}`).toContain(lic);
    }
  });

  it('files in the pipeline-owned directories are all documented and within budget', () => {
    let total = 0;
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
      .flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
    for (const sub of ['motion', 'hdri', 'textures']) {
      for (const f of walk(join(STATIC, 'assets', sub))) {
        const rel = relative(ROOT, f).replace(/\\/g, '/');
        total += statSync(f).size;
        const documented = assetsMd.includes(rel)
          || (sub === 'textures' && assetsMd.includes(rel.split('/').slice(0, 4).join('/')));
        expect(documented, `${rel} not listed in docs/ASSETS.md`).toBe(true);
      }
    }
    for (const u of Object.values(ASSETS.fonts.broadcast.files)) total += statSync(toFile(u)).size;
    expect(existsSync(join(STATIC, 'assets', 'fonts', 'OFL.txt'))).toBe(true);
    expect(total).toBeLessThan(60 * 1024 * 1024);
  });

  it('motion.bin matches the manifest (size, sha256) and stays small', () => {
    expect(bin.length).toBe(manifest.format.bytes);
    expect(createHash('sha256').update(bin).digest('hex')).toBe(manifest.format.sha256);
    expect(bin.length).toBeLessThan(15 * 1024 * 1024);
    expect(manifest.format.fps).toBe(30);
    expect(manifest.format.bones.length).toBe(21);
    for (const n of manifest.format.bones) expect(() => boneIndex(n)).not.toThrow();
  });

  it('every clip names a documented source, an allowed licence and a unique id', () => {
    const ids = new Set<string>();
    for (const c of manifest.clips) {
      expect(ids.has(c.id), c.id).toBe(false);
      ids.add(c.id);
      expect(ALLOWED_LICENCES).toContain(c.licence);
      expect(assetsMd).toContain(`### ${c.asset}`);
      expect(Object.values(manifest.sources).some((s) => s.asset === c.asset && s.licence === c.licence)).toBe(true);
      if (c.mirrorOf) expect(ids.has(c.mirrorOf) || manifest.clips.some((k) => k.id === c.mirrorOf)).toBe(true);
    }
    expect(assetsMd).toContain('The database was created with funding from NSF EIA-0196217.');
  });

  it('covers the core striking and footwork vocabulary in both stances', () => {
    for (const fam of ['stance.bounce', 'punch.jab', 'punch.cross', 'punch.hook_lead', 'punch.hook_rear',
      'punch.uppercut_lead', 'punch.uppercut_rear', 'kick.round_body_rear', 'kick.round_head_rear',
      'kick.teep_lead', 'defence.slip_left', 'step.forward', 'step.back']) {
      for (const st of ['orthodox', 'southpaw'] as const) expect(lib.find(fam, st)?.stance, `${fam} ${st}`).toBe(st);
    }
    expect(lib.byTechnique('tech.jab', 'orthodox')[0].id).toBe('punch.jab.orthodox');
    expect(lib.byTechnique('tech.kick_low_rear').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Retargeting quality (runtime path)
// ---------------------------------------------------------------------------

/** Signed flexion (radians) of child relative to parent about the anatomical hinge. */
function flexion(w: ReturnType<typeof createWorldPose>, parent: number, child: number, axis: 'elbowL' | 'elbowR' | 'knee'): number {
  // bone directions in world (joint → tip) and the hinge axis carried by the parent's rotation
  const d = (i: number) => {
    const v = [w.tip[i * 3] - w.pos[i * 3], w.tip[i * 3 + 1] - w.pos[i * 3 + 1], w.tip[i * 3 + 2] - w.pos[i * 3 + 2]];
    const n = Math.hypot(v[0], v[1], v[2]);
    return v.map((x) => x / n);
  };
  const a = d(parent), c = d(child);
  const local = axis === 'elbowL' ? [0, -1, 0] : axis === 'elbowR' ? [0, 1, 0] : [1, 0, 0];
  const q = w.quat.subarray(parent * 4, parent * 4 + 4);
  const h = new Float32Array(3);
  rotate(h, q, local);
  const cr = [a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]];
  const bend = Math.acos(Math.max(-1, Math.min(1, a[0] * c[0] + a[1] * c[1] + a[2] * c[2])));
  return cr[0] * h[0] + cr[1] * h[1] + cr[2] * h[2] >= 0 ? bend : -bend;
}
function rotate(out: Float32Array, q: Float32Array, v: number[]): void {
  const [x, y, z, w] = q;
  const cx = y * v[2] - z * v[1], cy = z * v[0] - x * v[2], cz = x * v[1] - y * v[0];
  out[0] = v[0] + 2 * (w * cx + (y * cz - z * cy));
  out[1] = v[1] + 2 * (w * cy + (z * cx - x * cz));
  out[2] = v[2] + 2 * (w * cz + (x * cy - y * cx));
}

describe('retargeted clips (shipped data, runtime sampler)', () => {
  const pose = createPose();
  const w = createWorldPose();
  const deg = Math.PI / 180;

  it('keep planted feet on the floor, never sink below it, and never invert a knee or elbow', () => {
    let checked = 0;
    for (const c of lib.clips) {
      let minToe = Infinity, worstKnee = 0, worstElbow = 0;
      const lastBall: Record<'left' | 'right', { f: number; x: number; z: number } | null> = { left: null, right: null };
      for (let f = 0; f < c.frames; f++) {
        lib.sample(c.id, f / c.fps, pose, { loop: false });
        forwardKinematics(w, pose, rest);
        for (const s of ['left', 'right'] as const) {
          const foot = s === 'left' ? B.lFoot : B.rFoot, toe = s === 'left' ? B.lToe : B.rToe;
          minToe = Math.min(minToe, w.pos[toe * 3 + 1], w.tip[toe * 3 + 1]);
          if (c.footPlants[s].some(([a, b]) => f >= a && f <= b)) {
            // planted: the ball of the foot is on the floor (the heel may be up) and does not slide
            expect(w.pos[toe * 3 + 1], `${c.id} f${f} ${s} ball`).toBeLessThan(0.09);
            const prev = lastBall[s];
            if (prev && prev.f === f - 1) {
              const slide = Math.hypot(w.pos[toe * 3] - prev.x, w.pos[toe * 3 + 2] - prev.z);
              expect(slide, `${c.id} f${f} ${s} slides`).toBeLessThan(0.015);
            }
            lastBall[s] = { f, x: w.pos[toe * 3], z: w.pos[toe * 3 + 2] };
            void foot;
            checked++;
          }
        }
        worstKnee = Math.min(worstKnee, flexion(w, B.lUpLeg, B.lLeg, 'knee'), flexion(w, B.rUpLeg, B.rLeg, 'knee'));
        worstElbow = Math.min(worstElbow, flexion(w, B.lArm, B.lForeArm, 'elbowL'), flexion(w, B.rArm, B.rForeArm, 'elbowR'));
      }
      expect(minToe, `${c.id} toe below floor`).toBeGreaterThan(-0.04);
      expect(worstKnee, `${c.id} knee bends backwards`).toBeGreaterThan(-1 * deg);
      expect(worstElbow, `${c.id} elbow bends backwards`).toBeGreaterThan(-3 * deg);
    }
    expect(checked).toBeGreaterThan(5000);
  });

  it('face +Z at frame 0 with the hips over the origin at standing height', () => {
    for (const c of lib.clips) {
      lib.sample(c.id, 0, pose);
      expect(Math.hypot(pose.rootPos[0], pose.rootPos[2]), c.id).toBeLessThan(0.02);
      if (c.family.startsWith('ground.')) continue;
      expect(pose.rootPos[1], c.id).toBeGreaterThan(0.72); // a boxer can sit low in the stance
      expect(pose.rootPos[1], c.id).toBeLessThan(1.02);
      // (spinning and back kicks legitimately start turned away)
      if ((c.kind === 'strike' || c.kind === 'defence' || c.family.startsWith('stance.bounce')) && !/spinning|kick.back/.test(c.family)) {
        forwardKinematics(w, pose, rest);
        const h = new Float32Array(3);
        rotate(h, w.quat.subarray(B.head * 4, B.head * 4 + 4), [0, 0, 1]);
        expect(Math.abs(Math.atan2(h[0], h[2])), `${c.id} looks away from +Z`).toBeLessThan(45 * deg);
      }
    }
  });

  it('strikes land in front, with the striking limb and markers in order', () => {
    for (const c of lib.clips.filter((k) => k.kind === 'strike')) {
      const m = c.markers!;
      expect(m.start! <= m.contact! && m.contact! < m.end!, c.id).toBe(true);
      lib.sample(c.id, m.contact! / c.fps, pose);
      forwardKinematics(w, pose, rest);
      const limb = boneIndex(c.limb!.endsWith('Hand') ? c.limb! : c.limb!.replace('Foot', 'ToeBase'));
      const p = c.limb!.endsWith('Hand') ? w.tip : w.pos;
      const hz = pose.rootPos[2];
      expect(p[limb * 3 + 2] - hz, `${c.id} reach`).toBeGreaterThan(0.3);
      // contact point recorded in the manifest is where the runtime puts the limb (mirrors: the
      // rest skeleton is only symmetric to a couple of centimetres)
      const tol = c.mirrorOf ? 0.03 : 0.01;
      expect(Math.abs(p[limb * 3] - m.contactPoint![0]), c.id).toBeLessThan(tol);
      expect(Math.abs(p[limb * 3 + 2] - m.contactPoint![2]), c.id).toBeLessThan(tol);
      // ... and it is (nearly) straight ahead of the stance
      expect(Math.abs(m.contactPoint![0]), `${c.id} lateral`).toBeLessThan(0.3);
      // limb role agrees with the stance
      const lead = c.stance === 'southpaw' ? 'Right' : 'Left';
      expect(c.limb!.startsWith(lead), c.id).toBe(c.limbRole!.startsWith('lead'));
    }
  });

  it('stances are what the ids say: orthodox leads with the left foot', () => {
    for (const c of lib.clips.filter((k) => k.stance !== 'square' && k.kind !== 'move')) {
      lib.sample(c.id, 0, pose);
      forwardKinematics(w, pose, rest);
      const dz = w.pos[B.lFoot * 3 + 2] - w.pos[B.rFoot * 3 + 2];
      expect(Math.sign(dz), c.id).toBe(c.stance === 'orthodox' ? 1 : -1);
    }
  });
});

// ---------------------------------------------------------------------------
// Sampler
// ---------------------------------------------------------------------------

const S = manifest.format.stride;
function rawFrame(id: string, f: number): Float32Array {
  const c = manifest.clips.find((k) => k.id === id)!;
  const v = new DataView(bin.buffer, bin.byteOffset + c.byteOffset! + f * S * 2, S * 2);
  const out = new Float32Array(S);
  for (let k = 0; k < 3; k++) out[k] = v.getInt16(k * 2, true) / 1000;
  for (let q = 3; q < S; q += 4) {
    const x = v.getInt16(q * 2, true), y = v.getInt16(q * 2 + 2, true), z = v.getInt16(q * 2 + 4, true), ww = v.getInt16(q * 2 + 6, true);
    const n = Math.hypot(x, y, z, ww);
    out.set([x / n, y / n, z / n, ww / n], q);
  }
  return out;
}
const sameRot = (a: Float32Array | number[], ai: number, b: Float32Array | number[], bi: number, tol = 1e-5) =>
  Math.abs(Math.abs(a[ai] * b[bi] + a[ai + 1] * b[bi + 1] + a[ai + 2] * b[bi + 2] + a[ai + 3] * b[bi + 3]) - 1) < tol;

describe('MotionLibrary.sample', () => {
  const id = 'punch.cross.orthodox';
  const info = lib.info(id);
  const pose = createPose();
  const slots = manifest.format.bones.map((n) => boneIndex(n));

  it('reproduces stored frames exactly at frame times', () => {
    for (const f of [0, 7, info.frames - 1]) {
      const raw = rawFrame(id, f);
      lib.sample(id, f / info.fps, pose);
      for (let k = 0; k < 3; k++) expect(pose.rootPos[k]).toBeCloseTo(raw[k], 5);
      expect(sameRot(pose.rootQuat, 0, raw, 3)).toBe(true);
      slots.forEach((b, k) => expect(sameRot(pose.local, b * 4, raw, 7 + k * 4), BONES[b]).toBe(true));
      expect(Array.from(pose.local.subarray(0, 4))).toEqual([0, 0, 0, 1]);
    }
  });

  it('slerps between frames', () => {
    const f = 12, a = 0.3;
    const r0 = rawFrame(id, f), r1 = rawFrame(id, f + 1);
    lib.sample(id, (f + a) / info.fps, pose);
    const want = new Float32Array(4);
    slots.forEach((b, k) => {
      slerpInto(want, 0, r0, 7 + k * 4, r1, 7 + k * 4, a);
      expect(sameRot(pose.local, b * 4, want, 0, 1e-6), BONES[b]).toBe(true);
    });
    expect(pose.rootPos[2]).toBeCloseTo(r0[2] + (r1[2] - r0[2]) * a, 5);
  });

  it('clamps one-shots and wraps loops seamlessly', () => {
    const p2 = createPose();
    lib.sample(id, -1, pose);
    lib.sample(id, 0, p2);
    expect(Array.from(pose.local)).toEqual(Array.from(p2.local));
    lib.sample(id, info.duration + 5, pose);
    lib.sample(id, (info.frames - 1) / info.fps, p2);
    expect(Array.from(pose.local)).toEqual(Array.from(p2.local));

    const loop = lib.find('stance.bounce', 'orthodox')!;
    expect(loop.loop).toBe(true);
    for (const t of [0.13, 0.9]) {
      lib.sample(loop.id, t, pose);
      lib.sample(loop.id, t + loop.duration * 3, p2);
      for (let i = 0; i < BONE_COUNT * 4; i++) expect(p2.local[i]).toBeCloseTo(pose.local[i], 3);
      expect(p2.rootPos[1]).toBeCloseTo(pose.rootPos[1], 3);
    }
    // the seam: the last frame blends into the first without a jump
    const n = loop.frames;
    const last = rawFrame(loop.id, n - 1), first = rawFrame(loop.id, 0);
    let maxJump = 0;
    for (let k = 0; k < 21; k++) {
      const q = 7 + k * 4;
      const d = Math.abs(last[q] * first[q] + last[q + 1] * first[q + 1] + last[q + 2] * first[q + 2] + last[q + 3] * first[q + 3]);
      maxJump = Math.max(maxJump, 2 * Math.acos(Math.min(1, d)));
    }
    expect(maxJump).toBeLessThan(12 * Math.PI / 180);
  });

  it('full root motion = in-place + trajectory', () => {
    const step = lib.find('step.forward', 'orthodox')!;
    const tr = new Float32Array(3);
    const p2 = createPose();
    for (const t of [0, 1.1, 2.7, step.duration]) {
      lib.sample(step.id, t, pose);
      lib.sample(step.id, t, p2, { rootMotion: 'inPlace' });
      lib.trajectory(step.id, t, tr);
      expect(p2.rootPos[0] + tr[0]).toBeCloseTo(pose.rootPos[0], 4);
      expect(p2.rootPos[2] + tr[1]).toBeCloseTo(pose.rootPos[2], 4);
      expect(Math.abs(p2.rootPos[2])).toBeLessThan(0.4);
    }
    const d = lib.rootDelta(step.id, 0, step.duration, tr);
    expect(d[1]).toBeGreaterThan(1.5); // walks forward, towards +Z
  });

  it('does not touch fingers unless asked, and resets them on request', () => {
    const idx = boneIndex('LeftHandIndex2') * 4;
    pose.local.set([0.1, 0.2, 0.3, 0.927], idx);
    lib.sample(id, 0.2, pose);
    expect(pose.local[idx]).toBeCloseTo(0.1, 6);
    lib.sample(id, 0.2, pose, { fingers: 'reset' });
    expect(Array.from(pose.local.subarray(idx, idx + 4))).toEqual([0, 0, 0, 1]);
  });

  it('time-warps a clip so contact lands on the engine instant', () => {
    const w = makeTimeWarp(info, 0.25, 0.6);
    const c = info.markers!.contact! / info.fps;
    expect(warpTime(w, 0.25)).toBeCloseTo(c, 9);
    expect(warpTime(w, 0)).toBeCloseTo(w.clipFrom, 9);
    expect(warpTime(w, 0.6)).toBeCloseTo(w.clipTo, 9);
    expect(warpTime(w, 10)).toBeCloseTo(w.clipTo, 9);
    expect(warpTime(w, 0.1)).toBeLessThan(warpTime(w, 0.2));
    expect(alignContact(info, 1.0, 1.0)).toBeCloseTo(c, 9);
  });

  it('placePose rotates and translates the clip into the world', () => {
    lib.sample(id, 0, pose);
    const y = pose.rootPos[1];
    placePose(pose, 2, -3, Math.PI / 2); // facing +X
    expect(pose.rootPos[0]).toBeCloseTo(2, 2);
    expect(pose.rootPos[2]).toBeCloseTo(-3, 2);
    expect(pose.rootPos[1]).toBe(y);
    const w = createWorldPose();
    forwardKinematics(w, pose, rest);
    const h = new Float32Array(3);
    rotate(h, w.quat.subarray(B.head * 4, B.head * 4 + 4), [0, 0, 1]);
    expect(h[0]).toBeGreaterThan(0.6); // now looking along +X
  });
});

// ---------------------------------------------------------------------------
// Mirroring
// ---------------------------------------------------------------------------

describe('mirroring', () => {
  const rest0 = rest;
  const a = createPose(), b = createPose();
  const wa = createWorldPose(), wb = createWorldPose();
  const mirrorIdx = BONES.map((n) => BONES.indexOf(n.startsWith('Left') ? `Right${n.slice(4)}` : n.startsWith('Right') ? `Left${n.slice(5)}` : n));

  it('a mirrored clip is the X-reflection of its source with sides swapped', () => {
    const mirrored = lib.clips.filter((c) => c.mirrorOf);
    expect(mirrored.length).toBeGreaterThan(30);
    for (const c of mirrored.slice(0, 40)) {
      const t = (c.markers?.contact ?? Math.floor(c.frames / 2)) / c.fps;
      lib.sample(c.id, t, a);
      lib.sample(c.mirrorOf!, t, b);
      expect(a.rootPos[0]).toBeCloseTo(-b.rootPos[0], 5);
      expect(a.rootPos[2]).toBeCloseTo(b.rootPos[2], 5);
      for (let i = 0; i < BONE_COUNT; i++) {
        const j = mirrorIdx[i];
        if (BONES[i].includes('Hand') && /\d$/.test(BONES[i])) continue; // fingers untouched
        expect(a.local[i * 4]).toBeCloseTo(b.local[j * 4], 5);
        expect(a.local[i * 4 + 1]).toBeCloseTo(-b.local[j * 4 + 1], 5);
        expect(a.local[i * 4 + 2]).toBeCloseTo(-b.local[j * 4 + 2], 5);
        expect(a.local[i * 4 + 3]).toBeCloseTo(b.local[j * 4 + 3], 5);
      }
      // joint positions reflect: left wrist of one is the right wrist of the other, x negated
      // (rest is near-symmetric, so allow a few millimetres of rest asymmetry per bone)
      forwardKinematics(wa, a, rest0);
      forwardKinematics(wb, b, rest0);
      for (const [l, r] of [[B.lHand, B.rHand], [B.lFoot, B.rFoot], [B.head, B.head]]) {
        expect(Math.abs(wa.pos[l * 3] + wb.pos[r * 3]), c.id).toBeLessThan(0.03);
        expect(Math.abs(wa.pos[l * 3 + 2] - wb.pos[r * 3 + 2]), c.id).toBeLessThan(0.03);
      }
      if (c.limb) expect(c.limb).toBe(lib.info(c.mirrorOf!).limb!.replace(/^(Left|Right)/, (s) => (s === 'Left' ? 'Right' : 'Left')));
      expect(c.footPlants.left).toEqual(lib.info(c.mirrorOf!).footPlants.right);
    }
  });

  it('mirror option on a mirrored clip gives back the source; mirrorPose is an involution', () => {
    const c = lib.clips.find((k) => k.mirrorOf)!;
    lib.sample(c.id, 0.5, a, { mirror: true });
    lib.sample(c.mirrorOf!, 0.5, b);
    for (let i = 0; i < BONE_COUNT * 4; i++) expect(a.local[i]).toBeCloseTo(b.local[i], 5);
    lib.sample(c.mirrorOf!, 0.5, a);
    mirrorPose(a);
    lib.sample(c.id, 0.5, b);
    for (let i = 0; i < 22; i++) {
      const bi = boneIndex(manifest.format.bones[Math.min(i, 20)]) * 4;
      for (let k = 0; k < 4; k++) expect(a.local[bi + k]).toBeCloseTo(b.local[bi + k], 5);
    }
    const p: Pose = createPose();
    lib.sample(c.id, 0.3, p);
    const copy = Float32Array.from(p.local);
    mirrorPose(mirrorPose(p));
    for (let i = 0; i < copy.length; i++) expect(p.local[i]).toBeCloseTo(copy[i], 6);
  });
});

// ---------------------------------------------------------------------------
// Build determinism
// ---------------------------------------------------------------------------

describe('mocap build', () => {
  // A 3-joint-per-limb synthetic performer in BVH, standing then punching.
  const bvh = (frames: string[]) => `HIERARCHY
ROOT Hips
{
  OFFSET 0 0 0
  CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation
  JOINT ToSpine { OFFSET 0 10 0 CHANNELS 3 Zrotation Xrotation Yrotation
  JOINT Spine { OFFSET 0 12 0 CHANNELS 3 Zrotation Xrotation Yrotation
  JOINT Spine1 { OFFSET 0 14 0 CHANNELS 3 Zrotation Xrotation Yrotation
    JOINT Neck { OFFSET 0 16 0 CHANNELS 3 Zrotation Xrotation Yrotation
      JOINT Head { OFFSET 0 8 0 CHANNELS 3 Zrotation Xrotation Yrotation End Site { OFFSET 0 18 0 } } }
    JOINT LeftShoulder { OFFSET 5 12 0 CHANNELS 3 Zrotation Xrotation Yrotation
      JOINT LeftArm { OFFSET 12 0 0 CHANNELS 3 Zrotation Xrotation Yrotation
        JOINT LeftForeArm { OFFSET 26 0 0 CHANNELS 3 Zrotation Xrotation Yrotation
          JOINT LeftHand { OFFSET 25 0 0 CHANNELS 3 Zrotation Xrotation Yrotation End Site { OFFSET 9 0 0 } } } } }
    JOINT RightShoulder { OFFSET -5 12 0 CHANNELS 3 Zrotation Xrotation Yrotation
      JOINT RightArm { OFFSET -12 0 0 CHANNELS 3 Zrotation Xrotation Yrotation
        JOINT RightForeArm { OFFSET -26 0 0 CHANNELS 3 Zrotation Xrotation Yrotation
          JOINT RightHand { OFFSET -25 0 0 CHANNELS 3 Zrotation Xrotation Yrotation End Site { OFFSET -9 0 0 } } } } } } } }
  JOINT LeftUpLeg { OFFSET 10 -5 0 CHANNELS 3 Zrotation Xrotation Yrotation
    JOINT LeftLeg { OFFSET 0 -42 0 CHANNELS 3 Zrotation Xrotation Yrotation
      JOINT LeftFoot { OFFSET 0 -42 0 CHANNELS 3 Zrotation Xrotation Yrotation
        JOINT LeftToeBase { OFFSET 0 -5 13 CHANNELS 3 Zrotation Xrotation Yrotation End Site { OFFSET 0 0 5 } } } } }
  JOINT RightUpLeg { OFFSET -10 -5 0 CHANNELS 3 Zrotation Xrotation Yrotation
    JOINT RightLeg { OFFSET 0 -42 0 CHANNELS 3 Zrotation Xrotation Yrotation
      JOINT RightFoot { OFFSET 0 -42 0 CHANNELS 3 Zrotation Xrotation Yrotation
        JOINT RightToeBase { OFFSET 0 -5 13 CHANNELS 3 Zrotation Xrotation Yrotation End Site { OFFSET 0 0 5 } } } } }
}
MOTION
Frames: ${frames.length}
Frame Time: 0.0333333
${frames.join('\n')}
`.replace(/\{ /g, '{\n').replace(/ \}/g, '\n}').replace(/ (OFFSET|CHANNELS|JOINT|End)/g, '\n$1');
  // channel layout: root 6 + 21 joints × 3 (in hierarchy order)
  const frame = (hipsY: number, lElbowBend: number, lArmDown: number) => {
    const ch: number[] = [0, hipsY, 0, 0, 0, 0];
    const joints = ['ToSpine', 'Spine', 'Spine1', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
      'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
      'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'];
    for (const j of joints) {
      // Z X Y order; the left elbow flexes forward = rotation about -Y, the arm drops about -Z
      if (j === 'LeftArm') ch.push(-lArmDown, 0, 0);
      else if (j === 'RightArm') ch.push(lArmDown, 0, 0);
      else if (j === 'LeftForeArm') ch.push(0, 0, -lElbowBend);
      else if (j === 'RightForeArm') ch.push(0, 0, lElbowBend);
      else if (j === 'LeftLeg' || j === 'RightLeg') ch.push(0, 10, 0);
      else ch.push(0, 0, 0);
    }
    return ch.join(' ');
  };

  it('is a pure function of its inputs (synthetic BVH → identical output twice)', async () => {
    const libUrl = pathToFileURL(join(ROOT, 'scripts/assets/mocap-lib.mjs')).href;
    const rtUrl = pathToFileURL(join(ROOT, 'scripts/assets/retarget.mjs')).href;
    const L = await import(/* @vite-ignore */ libUrl);
    const R = await import(/* @vite-ignore */ rtUrl);
    const text = bvh(Array.from({ length: 24 }, (_, i) => frame(96, i === 0 ? 0 : 20 + i * 4, i < 2 ? 0 : 75)));
    const run = () => {
      const src = L.parseBVH(text, 0.01);
      const body = R.canonicalBody(R.parseRigData(readFileSync(join(ROOT, 'src/presentation/rig/rigData.ts'), 'utf8')));
      const profile = {
        map: Object.fromEntries(R.BODY_BONES.map((n: string) => [n, n === 'Spine' ? 'ToSpine' : n === 'Spine1' ? 'Spine' : n === 'Spine2' ? 'Spine1' : n])),
        hipL: 'LeftUpLeg', hipR: 'RightUpLeg', shoulderL: 'LeftArm', shoulderR: 'RightArm', ankleL: 'LeftFoot', ankleR: 'RightFoot',
      };
      const rt = R.makeRetargeter(body, profile, { src, frame: 0 }, [{ src, frames: Array.from({ length: 24 }, (_, i) => i) }]);
      const out = R.retargetFrames(rt, src, 0, src.frames, { yaw: 0, origin: [0, 0], floorY: 0.1 });
      return { out, body };
    };
    const a1 = run(), a2 = run();
    expect(Buffer.from(a1.out.world.buffer).equals(Buffer.from(a2.out.world.buffer))).toBe(true);
    expect(Buffer.from(a1.out.rootPos.buffer).equals(Buffer.from(a2.out.rootPos.buffer))).toBe(true);
    // the calibration frame (a T-pose) retargets to (nearly) the canonical T-pose
    const B0 = a1.body.bones.length;
    for (let i = 0; i < B0; i++) {
      const q = a1.out.world.subarray(i * 4, i * 4 + 4);
      const angle = 2 * Math.acos(Math.min(1, Math.abs(q[3])));
      expect(angle, a1.body.bones[i].name).toBeLessThan(25 * Math.PI / 180);
    }
    // the synthetic elbow flexes forward in the target too (hinge preserved, not inverted)
    const { localToWorld, hingeFlexion } = R;
    const loc = R.worldToLocal(a1.body, a1.out.world, a1.out.frames);
    const Rt = localToWorld(a1.body, loc.rootQuat, loc.local, 20);
    expect(hingeFlexion(a1.body, Rt, 'LeftArm', 'LeftForeArm', 'elbowL')).toBeGreaterThan(60 * Math.PI / 180);
    expect(hingeFlexion(a1.body, Rt, 'RightArm', 'RightForeArm', 'elbowR')).toBeGreaterThan(60 * Math.PI / 180);
  });

  const cache = join(ROOT, '.cache', 'assets', 'accad', 'Male2_E1_JabLeft.bvh');
  it.skipIf(!existsSync(cache))('rebuilding from the raw cache reproduces the committed bytes', () => {
    const out = mkdtempSync(join(tmpdir(), 'mocap-'));
    try {
      execFileSync(process.execPath, [join(ROOT, 'scripts/assets/build-mocap.mjs'), '--no-fetch', '--quiet', '--out', out], { stdio: 'pipe' });
      expect(readFileSync(join(out, 'motion.bin')).equals(bin)).toBe(true);
      expect(readFileSync(join(out, 'manifest.json'), 'utf8')).toBe(readFileSync(join(STATIC, 'assets', 'motion', 'manifest.json'), 'utf8'));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});
