import { simulate, ARCHETYPES, DEFAULT_SETTINGS, boutSeed, type SimConfig } from '../../src/sim';
const A = Object.values(ARCHETYPES);
const fa = A.find(a => a.id === (process.argv[3] ?? 'arch.regional_pro_allrounder'))!;
const N = Number(process.argv[2] ?? 200);
const acc = { td0:0, td1:0, ctl0:0, ctl1:0, rev0:0, rev1:0, kd0:0, kd1:0, head0:0, head1:0, body0:0, body1:0, leg0:0, leg1:0 };
let rw0=0, rw1=0, rt=0;
const cardsByRound: number[][] = [[0,0],[0,0],[0,0],[0,0]];
for (let i = 0; i < N; i++) {
  const cfg: SimConfig = { seed: boutSeed(`sym`, '1v1', i), mode: '1v1',
    fighters: [fa, fa], teams: { teamOf: [0,1] }, ruleset: 'mma.unified.3r',
    arena: 'octagon_30', settings: { ...DEFAULT_SETTINGS } };
  const r = simulate(cfg);
  const b = r.stats.fighters;
  acc.td0 += b[0].takedowns.landed; acc.td1 += b[1].takedowns.landed;
  acc.ctl0 += b[0].controlSeconds; acc.ctl1 += b[1].controlSeconds;
  acc.rev0 += b[0].reversals; acc.rev1 += b[1].reversals;
  acc.kd0 += b[0].knockdowns; acc.kd1 += b[1].knockdowns;
  acc.head0 += b[0].sigByTarget.head.landed; acc.head1 += b[1].sigByTarget.head.landed;
  acc.body0 += b[0].sigByTarget.body.landed; acc.body1 += b[1].sigByTarget.body.landed;
  acc.leg0 += b[0].sigByTarget.leg.landed; acc.leg1 += b[1].sigByTarget.leg.landed;
  // cards: [judge][round][fighter]
  for (const j of r.stats.cards) for (let ri=0; ri<j.length; ri++) {
    const c = j[ri]; rt++;
    if (c[0] > c[1]) { rw0++; cardsByRound[ri][0]++; }
    else if (c[1] > c[0]) { rw1++; cardsByRound[ri][1]++; }
  }
}
console.log(JSON.stringify(acc, null, 0));
console.log(`judge-rounds won: f0=${rw0} f1=${rw1} of ${rt}`);
console.log('per round index:', JSON.stringify(cardsByRound));
