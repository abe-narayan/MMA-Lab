import { simulate, ARCHETYPES, DEFAULT_SETTINGS, boutSeed, type SimConfig } from '../../src/sim';
const A = Object.values(ARCHETYPES);
const fa = A.find(a => a.id === 'arch.regional_pro_allrounder')!;
let tdEvents = 0;
for (let i = 0; i < 40; i++) {
  const r = simulate({ seed: boutSeed('probe','1v1',i), mode:'1v1', fighters:[fa,fa], teams:{teamOf:[0,1]}, ruleset:'mma.unified.3r', arena:'octagon_30', settings:{...DEFAULT_SETTINGS} } as SimConfig);
  for (const f of r.stats.total.fighters) tdEvents += f.takedowns.attempted;
}
console.log('displacements', (globalThis as any).__disp, 'td attempts counted', tdEvents);
