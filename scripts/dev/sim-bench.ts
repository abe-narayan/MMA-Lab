/**
 * SIM BENCH — single-threaded simulation throughput (docs/design/SIM_PERF_PASS.md).
 *
 *   node scripts/dev/heavy.mjs npx tsx scripts/dev/sim-bench.ts [--n 12] [--only 3r,5r,1v5] [--json out.json]
 *
 * Runs unrecorded `simulate()` bouts (the batch hot path) in three suites —
 * 1v1 three-rounders, 1v1 five-rounders and a 1v5 gauntlet — after a warm-up,
 * and reports bouts/s, ms per tick, GC time (PerformanceObserver 'gc'), peak
 * heap and an estimate of bytes allocated per tick (see the last loop).
 * Seeds are fixed, so before/after numbers compare the same bouts.
 */
import { PerformanceObserver, performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import v8 from 'node:v8';
import { ARCHETYPES, DEFAULT_SETTINGS, createSim, simulate, type FighterDefinition, type SimConfig } from '../../src/sim';

const argv = process.argv.slice(2);
const arg = (k: string): string | undefined => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const N = Number(arg('--n') ?? 12);
const only = (arg('--only') ?? '3r,5r,1v5').split(',');

const ARCH = Object.values(ARCHETYPES) as FighterDefinition[];
const withId = (f: FighterDefinition, id: string): FighterDefinition => ({ ...JSON.parse(JSON.stringify(f)), id, short: id.toUpperCase() });

function cfg(seed: string, fighters: FighterDefinition[], ruleset: string, teamOf?: number[]): SimConfig {
  return {
    seed, mode: teamOf ? 'teams' : '1v1', fighters, teams: { teamOf: teamOf ?? [0, 1] },
    ruleset: ruleset as SimConfig['ruleset'], arena: 'octagon_30', settings: { ...DEFAULT_SETTINGS },
  };
}

const suites: Record<string, (i: number) => SimConfig> = {
  '3r': (i) => cfg(`bench-3r-${i}`, [withId(ARCH[i % ARCH.length], 'a'), withId(ARCH[(i * 7 + 3) % ARCH.length], 'b')], 'mma.unified.3r'),
  '5r': (i) => cfg(`bench-5r-${i}`, [withId(ARCH[i % ARCH.length], 'a'), withId(ARCH[(i * 5 + 2) % ARCH.length], 'b')], 'mma.unified.5r'),
  '1v5': (i) => cfg(`bench-1v5-${i}`, [withId(ARCH[14], 'hero'), ...[0, 1, 2, 3, 4].map((k) => withId(ARCH[11], `g${k}`))], 'mma.unified.3r', [0, 1, 1, 1, 1, 1]),
};

let gcMs = 0;
let gcCount = 0;
const obs = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) { gcMs += e.duration; gcCount++; }
});
obs.observe({ entryTypes: ['gc'] });

function heapUsed(): number { return v8.getHeapStatistics().used_heap_size; }

interface SuiteResult { suite: string; bouts: number; ticks: number; ms: number; cpuMs: number; boutsPerSec: number; msPerTick: number; cpuMsPerTick: number; gcMs: number; gcCount: number; gcPct: number; peakHeapMB: number; rssMB: number }
const results: SuiteResult[] = [];

for (const name of only) {
  const make = suites[name];
  if (!make) continue;
  // Warm-up (JIT): two bouts not counted.
  for (let i = 0; i < 2; i++) simulate(make(1000 + i));
  gcMs = 0; gcCount = 0;
  let ticks = 0;
  let peak = heapUsed();
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const run = simulate(make(i));
    ticks += run.ticks;
    const h = heapUsed();
    if (h > peak) peak = h;
  }
  const ms = performance.now() - t0;
  const cpu = process.cpuUsage(cpu0);
  const cpuMs = (cpu.user + cpu.system) / 1000;
  // Let the observer flush.
  await new Promise((r) => setTimeout(r, 50));
  const r: SuiteResult = {
    suite: name, bouts: N, ticks, ms: Math.round(ms), cpuMs: Math.round(cpuMs),
    boutsPerSec: +(N / (ms / 1000)).toFixed(3),
    msPerTick: +(ms / ticks).toFixed(4),
    cpuMsPerTick: +(cpuMs / ticks).toFixed(4),
    gcMs: Math.round(gcMs), gcCount, gcPct: +((100 * gcMs) / ms).toFixed(1),
    peakHeapMB: +(peak / 1048576).toFixed(1),
    rssMB: Math.round(process.memoryUsage().rss / 1048576),
  };
  results.push(r);
  console.log(`${name.padEnd(4)} ${N} bouts ${ticks} ticks  ${r.boutsPerSec} bouts/s  ${r.msPerTick} ms/tick (cpu ${r.cpuMsPerTick})  GC ${r.gcMs} ms (${r.gcPct} %, ${gcCount} runs)  peak heap ${r.peakHeapMB} MB  rss ${r.rssMB} MB`);
}
obs.disconnect();

// Allocation per tick: step one bout of each suite by hand and add up the
// positive heapUsed deltas across each step (a step that ran a GC shows a
// drop and is skipped; with a 16 MB young generation that is well under 1 %
// of steps, so this slightly under-counts).
for (const name of only) {
  const make = suites[name];
  if (!make) continue;
  let bytes = 0; let counted = 0; let ticks = 0;
  for (let i = 0; i < 2; i++) {
    const sim = createSim(make(i));
    let before = heapUsed();
    while (sim.step()) {
      const after = heapUsed();
      if (after >= before) { bytes += after - before; counted++; }
      before = after;
      ticks++;
    }
  }
  const perTick = bytes / counted;
  const r = results.find((x) => x.suite === name);
  if (r) (r as SuiteResult & { allocKBPerTick?: number }).allocKBPerTick = +(perTick / 1024).toFixed(2);
  console.log(`${name.padEnd(4)} allocation ~ ${(perTick / 1024).toFixed(2)} KB/tick (${counted}/${ticks} steps sampled)`);
}
console.log(`process peak RSS ${Math.round(process.resourceUsage().maxRSS / 1024)} MB`);
const out = arg('--json');
if (out) writeFileSync(out, JSON.stringify(results, null, 1));
