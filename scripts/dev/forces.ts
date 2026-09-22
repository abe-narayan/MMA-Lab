/** Dev probe: in-engine force distribution and knockdown rate by context. */
import { simulate, ARCHETYPES, DEFAULT_SETTINGS, boutSeed, type SimConfig } from '../../src/sim';
const arch = Object.values(ARCHETYPES);
const A = arch.find(a => a.id === 'arch.regional_pro_allrounder')!;
const cfg = (s: string): SimConfig => ({ seed: s, mode: '1v1', fighters: [A, A],
  teams: { teamOf: [0,1] }, ruleset: 'mma.unified.3r', arena: 'octagon_30',
  settings: { ...DEFAULT_SETTINGS } });

const forces: number[] = [];
let landed = 0, landedHead = 0, kd = 0, byTech: Record<string, {n:number;kd:number}> = {};
for (let i = 0; i < 25; i++) {
  const run = simulate(cfg(boutSeed('force','1v1',i)));
  for (const e of run.events) {
    if (e.kind === 'strike') {
      const d: any = (e as any).detail;
      if (d.result === 'landed') {
        landed++;
        if (d.forceN) forces.push(d.forceN);
        if (d.target === 'head') landedHead++;
        byTech[d.technique] ??= {n:0,kd:0};
        byTech[d.technique].n++;
      }
    }
    if (e.kind === 'knockdown') {
      kd++;
      const c = (e as any).detail?.cause;
      if (c && byTech[c]) byTech[c].kd++;
    }
  }
}
forces.sort((a,b)=>a-b);
const q = (p: number) => forces[Math.floor(p * (forces.length-1))] ?? 0;
console.log(`landed ${landed} (head ${landedHead})  knockdowns ${kd}`);
console.log(`KD per landed strike       ${(100*kd/landed).toFixed(2)}%   target ~2.3% of landed DISTANCE POWER HEAD strikes`);
console.log(`KD per landed head strike  ${(100*kd/Math.max(1,landedHead)).toFixed(2)}%`);
console.log(`force N: median ${q(0.5).toFixed(0)}  p90 ${q(0.9).toFixed(0)}  p99 ${q(0.99).toFixed(0)}  max ${(forces.at(-1)??0).toFixed(0)}`);
console.log(`Pierce anchors: median ~950, p90 ~1500, 2-6% >= 2000, max ~5400`);
console.log(`>=2000 N: ${(100*forces.filter(f=>f>=2000).length/forces.length).toFixed(1)}%  target 2-6%`);
console.log('top techniques by landed count:');
for (const [k,v] of Object.entries(byTech).sort((a,b)=>b[1].n-a[1].n).slice(0,8)) {
  console.log(`  ${k.padEnd(26)} n=${String(v.n).padStart(4)}  kd=${String(v.kd).padStart(3)}  ${(100*v.kd/v.n).toFixed(1)}%`);
}
