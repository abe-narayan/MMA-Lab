/** QA probe 2 + 7: extreme stats, and elite vs novice with identical attributes. */
import { arch, cfg, flatFighter, runChecked, withId, setAllPhysical, setAllMental } from './qa-lib';
import type { FighterDefinition } from '../../src/sim';

const N = Number(process.argv[2] ?? 10);
const only = process.argv[3];

interface Pair { name: string; a: () => FighterDefinition; b: () => FighterDefinition }
const rpa = arch('arch.regional_pro_allrounder');

const mod = (id: string, fn: (f: FighterDefinition) => void, base = rpa): FighterDefinition => {
  const f = withId(base, id);
  fn(f);
  return f;
};

const pairs: Pair[] = [
  { name: 'all-max vs all-zero', a: () => flatFighter('max', 100, 30), b: () => flatFighter('zero', 0, 0) },
  { name: 'all-max vs all-max', a: () => flatFighter('maxa', 100, 30), b: () => flatFighter('maxb', 100, 30) },
  { name: 'all-zero vs all-zero', a: () => flatFighter('za', 0, 0), b: () => flatFighter('zb', 0, 0) },
  { name: 'all-max vs RPA', a: () => flatFighter('max', 100, 30), b: () => withId(rpa, 'rpa') },
  { name: 'all-zero vs RPA', a: () => flatFighter('zero', 0, 0), b: () => withId(rpa, 'rpa') },
  { name: 'RPA zero cardio vs RPA', a: () => mod('nocardio', (f) => { f.physical.cardio = 0; f.physical.recovery = 0; }), b: () => withId(rpa, 'rpa') },
  { name: 'RPA zero chin/neck/body vs RPA', a: () => mod('glass', (f) => { f.physical.chin = 0; f.physical.neckStrength = 0; f.physical.bodyToughness = 0; }), b: () => withId(rpa, 'rpa') },
  { name: 'RPA chin 100 vs RPA', a: () => mod('iron', (f) => { f.physical.chin = 100; f.physical.neckStrength = 100; f.physical.bodyToughness = 100; }), b: () => withId(rpa, 'rpa') },
  { name: 'strength-only (rest 0) vs all-zero', a: () => { const f = flatFighter('str', 0, 0); f.physical.strength = 100; return f; }, b: () => flatFighter('zero', 0, 0) },
  { name: 'RPA physical all 0 vs RPA', a: () => mod('weak', (f) => setAllPhysical(f, 0)), b: () => withId(rpa, 'rpa') },
  { name: 'RPA mental all 0 vs RPA', a: () => mod('mind0', (f) => setAllMental(f, 0)), b: () => withId(rpa, 'rpa') },
  { name: 'RPA mental all 100 vs RPA', a: () => mod('mind100', (f) => setAllMental(f, 100)), b: () => withId(rpa, 'rpa') },
  { name: 'RPA aggression 100 discipline 0 vs RPA', a: () => mod('wild', (f) => { f.mental.aggression = 100; f.mental.discipline = 0; }), b: () => withId(rpa, 'rpa') },
  { name: 'RPA reaction 0 vs RPA', a: () => mod('slow', (f) => { f.physical.reactionTime = 0; }), b: () => withId(rpa, 'rpa') },
  { name: 'no disciplines at all vs RPA', a: () => mod('empty', (f) => { f.disciplines = {} as FighterDefinition['disciplines']; }), b: () => withId(rpa, 'rpa') },
  { name: 'no disciplines vs no disciplines', a: () => mod('e1', (f) => { f.disciplines = {} as FighterDefinition['disciplines']; }), b: () => mod('e2', (f) => { f.disciplines = {} as FighterDefinition['disciplines']; }) },
  // Skill tiers: identical physical/mental, only skill differs.
  { name: 'TIER elite(skills 90, 15y) vs novice(skills 10, 0y), same body', a: () => { const f = flatFighter('elite', 60, 15); for (const d of Object.values(f.disciplines)) for (const k of Object.keys(d!.sub)) (d!.sub as Record<string, number>)[k] = 90; return f; }, b: () => { const f = flatFighter('nov', 60, 0); for (const d of Object.values(f.disciplines)) for (const k of Object.keys(d!.sub)) (d!.sub as Record<string, number>)[k] = 10; return f; } },
  { name: 'TIER mid(skills 55, 6y) vs mid(skills 50, 5y)', a: () => { const f = flatFighter('m1', 60, 6); for (const d of Object.values(f.disciplines)) for (const k of Object.keys(d!.sub)) (d!.sub as Record<string, number>)[k] = 55; return f; }, b: () => { const f = flatFighter('m2', 60, 5); for (const d of Object.values(f.disciplines)) for (const k of Object.keys(d!.sub)) (d!.sub as Record<string, number>)[k] = 50; return f; } },
  { name: 'ARCH CHM vs BNB', a: () => withId(arch('arch.champion_complete'), 'chm'), b: () => withId(arch('arch.brand_new_brawler'), 'bnb') },
  { name: 'ARCH RPA vs PBX', a: () => withId(rpa, 'rpa'), b: () => withId(arch('arch.pressure_boxer'), 'pbx') },
];

for (const p of pairs) {
  if (only && !only.split(",").some((o) => p.name.includes(o))) continue;
  let aw = 0, bw = 0, dr = 0, ms = 0, capHits = 0; const methods: Record<string, number> = {}; const probs: string[] = [];
  let sec = 0; let err = '';
  for (let s = 0; s < N; s++) {
    try {
      const r = runChecked(cfg(`qa-ext-${p.name}-${s}`, [p.a(), p.b()]), 10);
      if (r.result.winner === 0) aw++; else if (r.result.winner === 1) bw++; else dr++;
      methods[r.result.method] = (methods[r.result.method] ?? 0) + 1;
      probs.push(...r.problems.map((x) => `s${s} ${x}`));
      ms += r.ms; sec += r.result.totalSeconds;
      if (r.maxTicksHit) capHits++;
    } catch (e) {
      err = `THREW seed ${s}: ${(e as Error).stack?.split('\n').slice(0, 4).join(' / ')}`;
      break;
    }
  }
  console.log(`${p.name}: A ${aw} / B ${bw} / D ${dr} | avg ${(sec / N).toFixed(0)} s fight, ${(ms / N).toFixed(0)} ms | cap ${capHits} | ${JSON.stringify(methods)}`);
  if (probs.length) console.log(`   PROBLEMS(${probs.length}): ${probs.slice(0, 6).join(' | ')}`);
  if (err) console.log(`   ${err}`);
}
