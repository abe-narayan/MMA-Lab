/** QA probe: what fouls happen under grappling / striking rulesets, and are they ever penalised? */
import { createSim } from '../../src/sim';
import { arch, cfg, withId } from './qa-lib';
const rs = process.argv[2] ?? 'grappling.ibjjf';
const arena = process.argv[3] ?? 'mat_ibjjf';
const agg: Record<string, number> = {}; const ref: Record<string, number> = {};
for (let s = 0; s < 6; s++) {
  const sim = createSim(cfg(`qa-fouls-${s}`, [withId(arch('arch.bjj_guard_player'), 'a'), withId(arch('arch.thai_striker'), 'b')], { ruleset: rs, arena }));
  sim.runToEnd();
  for (const e of sim.events) {
    if (e.kind === 'foul') { const d = e.detail as any; const k = `${d?.foul ?? d?.id ?? '?'}|${d?.intent ?? ''}|${d?.penalty ?? d?.outcome ?? ''}`; agg[k] = (agg[k] ?? 0) + 1; }
    if (e.kind.startsWith('referee') || e.kind === 'pointsAwarded') ref[e.kind] = (ref[e.kind] ?? 0) + 1;
  }
  if (s === 0) { const f = sim.events.find((e) => e.kind === 'foul'); console.log('sample foul', JSON.stringify(f)); }
  console.log(`seed ${s}: ${sim.result!.method} ${sim.result!.detail} t=${sim.result!.totalSeconds}`);
}
console.log(JSON.stringify(agg, null, 1)); console.log(JSON.stringify(ref));
