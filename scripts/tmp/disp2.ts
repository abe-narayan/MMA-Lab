import { simulate, ARCHETYPES, DEFAULT_SETTINGS, boutSeed, type SimConfig } from '../../src/sim';
const A = Object.values(ARCHETYPES);
const fa = A.find(a => a.id === 'arch.regional_pro_allrounder')!;
const disp = new Map<string, number>(); const all = new Map<string, number>();
for (let i = 0; i < 40; i++) {
  const r = simulate({ seed: boutSeed('probe','1v1',i), mode:'1v1', fighters:[fa,fa], teams:{teamOf:[0,1]}, ruleset:'mma.unified.3r', arena:'octagon_30', settings:{...DEFAULT_SETTINGS} } as SimConfig);
  for (const e of r.events) {
    const d = e.detail as any;
    if (d && typeof d.edge === 'string') {
      all.set(d.edge, (all.get(d.edge) ?? 0) + 1);
      if (d.reason === 'contested') disp.set(d.edge, (disp.get(d.edge) ?? 0) + 1);
    }
  }
}
console.log('DISPLACED:'); for (const [k,v] of [...disp].sort((a,b)=>b[1]-a[1])) console.log('  ', k, v, ' of total', all.get(k));
