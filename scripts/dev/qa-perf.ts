/** QA probe 8: headless timing and a 500-bout heap-growth check in one process. */
import v8 from 'node:v8';
import vm from 'node:vm';
import { createSim, simulate } from '../../src/sim';
import { arch, cfg, withId, flatFighter } from './qa-lib';

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc') as () => void;
const heapMB = () => { gc(); gc(); return process.memoryUsage().heapUsed / 1048576; };

const N = Number(process.argv[2] ?? 500);
const rpa = arch('arch.regional_pro_allrounder');

// 1. Full-distance timing: time-per-bout for bouts that went the distance.
function timeDistance(ruleset: string, label: string, tries = 40): void {
  const times: number[] = []; let all = 0; let allMs = 0;
  for (let s = 0; s < tries && times.length < 8; s++) {
    const c = cfg(`qa-perf-${label}-${s}`, [flatFighter('za', 20, 1), flatFighter('zb', 20, 1)], { ruleset });
    const t0 = performance.now();
    const sim = createSim(c); sim.runToEnd();
    const ms = performance.now() - t0; all++; allMs += ms;
    const r = sim.result!;
    if (r.method.startsWith('decision') || r.method.startsWith('draw')) times.push(ms);
  }
  times.sort((a, b) => a - b);
  console.log(`${label}: full-distance bouts ${times.length}, median ${times[Math.floor(times.length / 2)]?.toFixed(0)} ms, max ${times[times.length - 1]?.toFixed(0)} ms (all ${all} bouts avg ${(allMs / all).toFixed(0)} ms)`);
}
timeDistance('mma.unified.3r', '3R');
timeDistance('mma.unified.5r', '5R');

// With frames recorded (what the Watch screen does).
{
  const c = cfg('qa-perf-rec', [flatFighter('za', 20, 1), flatFighter('zb', 20, 1)], { ruleset: 'mma.unified.5r' });
  const before = heapMB();
  const t0 = performance.now();
  const r = simulate(c, { record: true });
  console.log(`5R recorded: ${r.ticks} ticks, ${r.frames!.length} frames, ${(performance.now() - t0).toFixed(0)} ms, heap +${(heapMB() - before).toFixed(1)} MB while held, method ${r.result.method}`);
}

// 1v5 gauntlet.
{
  const ts: number[] = [];
  for (let s = 0; s < 5; s++) {
    const fs = [withId(arch('arch.champion_complete'), 'hero'), ...[0, 1, 2, 3, 4].map((i) => withId(rpa, `g${i}`))];
    const t0 = performance.now();
    const sim = createSim(cfg(`qa-perf-1v5-${s}`, fs, { mode: 'teams', teamOf: [0, 1, 1, 1, 1, 1] })); sim.runToEnd();
    ts.push(performance.now() - t0);
    console.log(`1v5 seed ${s}: ${sim.tick} ticks ${ts[s].toFixed(0)} ms ${sim.result!.method} events ${sim.events.length}`);
  }
}

// 2. Leak check.
const samples: [number, number][] = [];
const start = heapMB();
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  const kind = i % 5;
  const c = kind === 4
    ? cfg(`qa-leak-${i}`, [0, 1, 2].map((k) => withId(rpa, `l${k}`)), { mode: 'ffa' })
    : cfg(`qa-leak-${i}`, [withId(rpa, 'a'), withId(arch('arch.thai_striker'), 'b')], { ruleset: kind === 3 ? 'mma.unified.5r' : 'mma.unified.3r' });
  const sim = createSim(c); sim.runToEnd();
  if ((i + 1) % 50 === 0) samples.push([i + 1, heapMB()]);
}
console.log(`leak: ${N} bouts in ${((performance.now() - t0) / 1000).toFixed(1)} s; heap start ${start.toFixed(1)} MB; samples ${samples.map(([n, m]) => `${n}:${m.toFixed(1)}`).join(' ')}; rss ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB`);
