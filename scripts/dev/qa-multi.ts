/** QA probe: in multi-fighter modes, how does a bout end and who is still standing? */
import { createSim, type BoutResult } from '../../src/sim';
import { arch, cfg, withId } from './qa-lib';

const N = Number(process.argv[2] ?? 10);
const shape = (process.argv[3] ?? '2v2');
const tplId = process.argv[4] ?? 'arch.regional_pro_allrounder';
const heroId = process.argv[5];
const tpl = arch(tplId);

let mode: 'teams' | 'ffa' | 'crowd' = 'teams';
let teamOf: number[];
if (shape.startsWith('ffa')) { mode = 'ffa'; const n = Number(shape.slice(3)); teamOf = Array.from({ length: n }, (_, i) => i); }
else if (shape.startsWith('crowd')) { mode = 'crowd'; const n = Number(shape.slice(5)); teamOf = [0, ...Array(n).fill(1)]; }
else { const [a, b] = shape.split('v').map(Number); teamOf = [...Array(a).fill(0), ...Array(b).fill(1)]; }

for (let s = 0; s < N; s++) {
  const fs = teamOf.map((_, i) => withId(i === 0 && heroId ? arch(heroId) : tpl, `f${i}`));
  const sim = createSim(cfg(`qa-multi-${shape}-${s}`, fs, { mode, teamOf, settings: mode === 'crowd' ? { maxSeconds: 180 } : {} }));
  const outAt: string[] = [];
  const seen = new Set<number>();
  while (sim.step()) {
    for (const f of sim.world.fighters) if (f.out && !seen.has(f.id)) { seen.add(f.id); outAt.push(`f${f.id}@${sim.t.toFixed(0)}s`); }
  }
  const r = sim.result as BoutResult;
  const kinds: Record<string, number> = {};
  for (const e of sim.events) if (['strike', 'grapple', 'submissionFinish', 'knockdown', 'stoppage', 'fighterOut'].includes(e.kind) || e.kind.includes('Out') || e.kind.includes('stop')) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  const sig = sim.world.fighters.map((f) => f.sigLanded);
  const live = sim.world.fighters.map((f) => (f.out ? 'X' : 'o')).join('');
  console.log(`seed ${s}: ${r.method} winner=${r.winner} team=${r.winningTeam} t=${r.totalSeconds.toFixed(0)} live=${live} out=[${outAt.join(',')}] sigLanded=${sig.join('/')} detail=${r.detail}`);
}
