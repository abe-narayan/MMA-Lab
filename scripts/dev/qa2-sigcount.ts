// QA2: compare the snapshot's per-fighter sig-strike counters (Watch fighter bar) with computeStats (Watch Stats tab).
import { simulate, ARCHETYPES, DEFAULT_SETTINGS } from '../../src/sim';
const list = Object.values(ARCHETYPES);
const N = Number(process.argv[2] ?? 30);
let mism = 0, att = 0, land = 0; const ex: string[] = [];
for (let i = 0; i < N; i++) {
  const a = i % list.length, b = (i * 7 + 3) % list.length === a ? (a + 1) % list.length : (i * 7 + 3) % list.length;
  const seed = i === 0 ? 'qa2-watch' : `qa2-sig-${i}`;
  const cfg = { seed, mode: '1v1', fighters: [list[i === 0 ? 3 : a], list[i === 0 ? 5 : b]], teams: { teamOf: [0, 1] }, ruleset: 'mma.unified.3r', arena: 'octagon_30', settings: DEFAULT_SETTINGS } as never;
  const run = simulate(cfg, { record: true });
  const last = run.frames![run.frames!.length - 1];
  let bad = false;
  for (const f of last.fighters) {
    const s = (run.stats.total.fighters as any[]).find((x) => x.fighter === f.id)?.sig;
    if (!s) { console.log('no stats shape', Object.keys(run.stats)); process.exit(1); }
    if (s.attempted !== f.sig.attempted) { att++; bad = true; }
    if (s.landed !== f.sig.landed) { land++; bad = true; }
    if (bad && ex.length < 8) ex.push(`${seed} f${f.id} snapshot ${f.sig.landed}/${f.sig.attempted} stats ${s.landed}/${s.attempted} ${run.result.method}`);
  }
  if (bad) mism++;
}
console.log(`${mism}/${N} bouts disagree; attempted mismatches ${att}, landed mismatches ${land}`);
console.log(ex.join('\n'));
