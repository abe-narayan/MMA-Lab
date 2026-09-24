/** QA probe: does chin/durability move knockdowns and KO losses? */
import { simulate } from '../../src/sim';
import { arch, cfg, withId } from './qa-lib';

const N = Number(process.argv[2] ?? 60);
const rpa = arch('arch.regional_pro_allrounder');
for (const [label, v] of [['chin0', 0], ['chin50', 50], ['chin100', 100]] as const) {
  let kdOnA = 0, kdOnB = 0, koLossA = 0, koLossB = 0, headOnA = 0, headOnB = 0, aw = 0, bw = 0;
  for (let s = 0; s < N; s++) {
    const a = withId(rpa, 'glass');
    a.physical.chin = v; a.physical.neckStrength = v; a.physical.bodyToughness = v;
    const r = simulate(cfg(`qa-chin-${s}`, [a, withId(rpa, 'ref')]));
    const f = r.stats.total.fighters;
    kdOnA += f[1].knockdowns; kdOnB += f[0].knockdowns;
    headOnA += f[1].sig.landed; headOnB += f[0].sig.landed;
    const fin = r.result.method === 'ko' || r.result.method.startsWith('tko');
    if (fin && r.result.winner === 1) koLossA++;
    if (fin && r.result.winner === 0) koLossB++;
    if (r.result.winner === 0) aw++; else if (r.result.winner === 1) bw++;
  }
  console.log(`${label}: A wins ${aw} B wins ${bw} | KD suffered A ${kdOnA} B ${kdOnB} | (T)KO losses A ${koLossA} B ${koLossB} | sig landed on A ${headOnA} on B ${headOnB}`);
}
