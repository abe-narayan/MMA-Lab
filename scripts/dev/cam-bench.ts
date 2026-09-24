/**
 * Director cost benchmark: `BroadcastCameraDirector.update` alone, over bodies
 * posed beforehand (so the animator's cost and garbage are not counted), with
 * the garbage collections it triggers.
 *
 *   node scripts/dev/heavy.mjs npx tsx scripts/dev/cam-bench.ts [--bouts a,b] [--frames N] [--reps N]
 *
 * Prints ms per update (mean / p50 / p99) and the GC count and time during the
 * timed passes (a proxy for per-frame allocation).
 */
import { PerformanceObserver, performance } from 'node:perf_hooks';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { animatedBodies, CAM_BOUTS, cachedCamRecording } from './cam-audit-lib';
import { createCameraDirector } from '../../src/presentation/camera';
import type { FrameInput } from '../../src/presentation/contract';
import { createWorldPose, type WorldPose } from '../../src/presentation/rig/skeleton';

const args = process.argv.slice(2);
const opt = (k: string): string | undefined => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const names = (opt('--bouts') ?? 'mma-oct30,mma-oct25-ko,teams-2v2').split(',');
const N = Number(opt('--frames') ?? 6000);
const reps = Number(opt('--reps') ?? 3);

const copyPose = (w: WorldPose): WorldPose => {
  const o = createWorldPose();
  o.pos.set(w.pos); o.tip.set(w.tip); o.quat.set(w.quat);
  return o;
};

async function main(): Promise<void> {
  // GC entries arrive asynchronously: keep them all and count those that
  // started inside a timed pass.
  const gcs: { t: number; d: number }[] = [];
  const windows: [number, number][] = [];
  let timing = false;
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) gcs.push({ t: e.startTime, d: e.duration });
  });
  obs.observe({ entryTypes: ['gc'] });
  const all: number[] = [];
  let updates = 0;
  let totalMs = 0;
  for (const name of names) {
    const spec = CAM_BOUTS.find((b) => b.name === name)!;
    const rec = cachedCamRecording(spec, join(tmpdir(), 'boutlab-cam-audit'));
    const bodies = await animatedBodies(rec);
    const frames = rec.frames;
    const dt = 1 / 30;
    const inputs: { input: FrameInput; worlds: WorldPose[]; ref: WorldPose | null; extras: WorldPose[] }[] = [];
    for (let k = 0; k < N; k++) {
      const t = frames[0]!.t + k * dt;
      if (t > frames[frames.length - 1]!.t) break;
      const i = Math.min(frames.length - 2, Math.max(0, Math.floor(t / 0.1)));
      const F0 = frames[i]!;
      const F1 = frames[i + 1]!;
      const input: FrameInput = {
        frame: F0, next: F1, alpha: Math.max(0, Math.min(1, (t - F0.t) / 0.1)), simTime: t,
        events: rec.events.filter((e) => e.tick > F0.tick - 20 && e.tick <= F1.tick),
        playbackRate: 1, replay: false, discontinuity: k === 0,
      };
      const worlds = bodies.update(input, dt).map(copyPose);
      const ref = bodies.referee();
      inputs.push({ input, worlds, ref: ref ? copyPose(ref) : null, extras: bodies.extras().map(copyPose) });
    }
    for (let r = 0; r < reps; r++) {
      const d = createCameraDirector({ aspect: 16 / 9 });
      d.setBout(rec.bout, null);
      d.setRecording(frames, rec.events);
      timing = r > 0; // the first pass warms the JIT
      const w0 = performance.now();
      for (const x of inputs) {
        d.setReferee(x.ref);
        d.setExtraBodies(x.extras);
        const c0 = performance.now();
        d.update(x.input, x.worlds, dt);
        const ms = performance.now() - c0;
        if (timing) { all.push(ms); totalMs += ms; updates++; }
      }
      if (timing) windows.push([w0, performance.now()]);
      timing = false;
    }
    console.log(`# ${name}: ${inputs.length} frames x ${reps - 1} timed passes`);
  }
  await new Promise((r) => setTimeout(r, 50));
  obs.disconnect();
  const inW = gcs.filter((g) => windows.some(([a, b]) => g.t >= a && g.t <= b));
  const gcCount = inW.length;
  const gcMs = inW.reduce((s, g) => s + g.d, 0);
  all.sort((a, b) => a - b);
  const p = (q: number): number => all[Math.min(all.length - 1, Math.floor(q * all.length))]!;
  console.log(`director.update: mean ${(totalMs / updates).toFixed(4)} ms, p50 ${p(0.5).toFixed(4)}, p99 ${p(0.99).toFixed(4)}, max ${p(1).toFixed(3)} (${updates} updates)`);
  console.log(`GC during timed passes: ${gcCount} collections, ${gcMs.toFixed(1)} ms (${((1000 * gcCount) / updates).toFixed(2)} per 1000 updates)`);
}

void main();
