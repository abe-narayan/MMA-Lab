/** Dev probe: event histogram and a slice of one bout's timeline. */
import { simulate, ARCHETYPES, DEFAULT_SETTINGS, boutSeed, type SimConfig } from '../../src/sim';
const arch = Object.values(ARCHETYPES);
const A = arch.find(a => a.id === 'arch.regional_pro_allrounder')!;
const cfg: SimConfig = { seed: boutSeed('probe','1v1',0), mode: '1v1', fighters: [A, A],
  teams: { teamOf: [0,1] }, ruleset: 'mma.unified.3r', arena: 'octagon_30',
  settings: { ...DEFAULT_SETTINGS } };
const run = simulate(cfg);
const hist: Record<string, number> = {};
for (const e of run.events) hist[e.kind] = (hist[e.kind] ?? 0) + 1;
console.log('result:', run.result.method, run.result.detail, 'at', run.result.totalSeconds, 's');
console.log('events:', Object.entries(hist).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join(' '));
console.log('--- first 40 non-strike events ---');
for (const e of run.events.filter(e => e.kind !== 'strike').slice(0, 40)) {
  console.log(`${String(e.tick).padStart(5)} ${e.kind.padEnd(18)} a${e.actor}->${e.target} ${JSON.stringify((e as any).detail ?? {}).slice(0,110)}`);
}
console.log('--- last 12 events ---');
for (const e of run.events.slice(-12)) {
  console.log(`${String(e.tick).padStart(5)} ${e.kind.padEnd(18)} a${e.actor}->${e.target} ${JSON.stringify((e as any).detail ?? {}).slice(0,110)}`);
}
