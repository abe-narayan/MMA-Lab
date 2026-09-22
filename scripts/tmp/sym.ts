/** Diagnostic: where does fighter 0's edge come from in a mirror match? */
import { simulate, ARCHETYPES, DEFAULT_SETTINGS, boutSeed, type SimConfig } from '../../src/sim';
const A = Object.values(ARCHETYPES);
const by = (id: string) => A.find(a => a.id === id)!;
const fa = by('arch.regional_pro_allrounder');
const N = Number(process.argv[2] ?? 200);
let w0 = 0, w1 = 0, draws = 0;
let land0 = 0, land1 = 0, att0 = 0, att1 = 0, kd0 = 0, kd1 = 0;
const methods = new Map<string, number>();
for (let i = 0; i < N; i++) {
  const cfg: SimConfig = { seed: boutSeed(`sym`, '1v1', i), mode: '1v1',
    fighters: [fa, fa], teams: { teamOf: [0,1] }, ruleset: 'mma.unified.3r',
    arena: 'octagon_30', settings: { ...DEFAULT_SETTINGS } };
  const r = simulate(cfg);
  if (r.result.winner === 0) w0++; else if (r.result.winner === 1) w1++; else draws++;
  methods.set(r.result.method + ':' + r.result.winner, (methods.get(r.result.method+':'+r.result.winner) ?? 0) + 1);
  const b = r.stats.fighters;
  land0 += b[0].sig.landed; land1 += b[1].sig.landed;
  att0 += b[0].sig.attempted; att1 += b[1].sig.attempted;
  kd0 += b[0].knockdowns; kd1 += b[1].knockdowns;
}
console.log(`N=${N}  w0=${w0} w1=${w1} draws=${draws}  -> ${(100*w0/N).toFixed(1)}% / ${(100*w1/N).toFixed(1)}%`);
console.log(`sig landed  f0=${(land0/N).toFixed(1)}  f1=${(land1/N).toFixed(1)}`);
console.log(`sig attempt f0=${(att0/N).toFixed(1)}  f1=${(att1/N).toFixed(1)}`);
console.log(`accuracy    f0=${(100*land0/att0).toFixed(1)}%  f1=${(100*land1/att1).toFixed(1)}%`);
console.log(`knockdowns  f0=${kd0}  f1=${kd1}`);
console.log([...methods.entries()].sort().map(([k,v])=>`${k}=${v}`).join('  '));
