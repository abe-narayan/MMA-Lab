/** Dev probe: headline stats over a batch of AI-driven bouts. Not a test. */
import { simulate, ARCHETYPES, DEFAULT_SETTINGS, boutSeed, type SimConfig } from '../../src/sim';

const arch = Object.values(ARCHETYPES);
const byId = (n: string) => arch.find((a) => a.id === n)!;
const A = byId(process.argv[2] ?? 'arch.regional_pro_allrounder');
const B = byId(process.argv[3] ?? 'arch.regional_pro_allrounder');
const N = Number(process.argv[4] ?? 40);

const cfg = (seed: string): SimConfig => ({
  seed, mode: '1v1', fighters: [A, B], teams: { teamOf: [0, 1] },
  ruleset: 'mma.unified.3r', arena: 'octagon_30', settings: { ...DEFAULT_SETTINGS },
});

const methods: Record<string, number> = {};
let secs = 0, sig = 0, sigAtt = 0, tot = 0, totAtt = 0, td = 0, tdAtt = 0, kd = 0, sub = 0, ctrl = 0;
for (let i = 0; i < N; i++) {
  const run = simulate(cfg(boutSeed('probe', '1v1', i)));
  methods[run.result.method] = (methods[run.result.method] ?? 0) + 1;
  secs += run.result.totalSeconds;
  for (const f of run.stats.total.fighters) {
    sig += f.sig.landed; sigAtt += f.sig.attempted;
    tot += f.total.landed; totAtt += f.total.attempted;
    td += f.takedowns.landed; tdAtt += f.takedowns.attempted;
    kd += f.knockdowns; sub += f.subAttempts; ctrl += f.controlSeconds;
  }
}
// Total fighter-minutes: both fighters are in the cage for the whole bout, so
// N bouts of `secs` total seconds is 2*secs/60 = secs/30 fighter-minutes.
const perFighterMin = secs / 30;
const pct = (a: number, b: number) => (b > 0 ? `${((100 * a) / b).toFixed(0)}%` : '-');
console.log(`${A.name} vs ${B.name}  |  ${N} bouts`);
console.log(`mean duration   ${(secs / N / 60).toFixed(1)} min           target 10.6`);
console.log(`methods         ${JSON.stringify(methods)}`);
console.log(`SLpM            ${(sig / perFighterMin).toFixed(2)}                target 3.9`);
console.log(`sig accuracy    ${pct(sig, sigAtt)}                 target 46%`);
console.log(`TD/15min        ${(td / perFighterMin * 15).toFixed(2)}  acc ${pct(td, tdAtt)}    target 1.45 @ 38%`);
console.log(`KD per 15 min   ${(kd / perFighterMin * 15).toFixed(2)}                target 0.30`);
console.log(`sub att/15min   ${(sub / perFighterMin * 15).toFixed(2)}                target 0.45-0.6`);
console.log(`control min     ${(ctrl / 60 / N / 2).toFixed(2)}                target 2.2`);
