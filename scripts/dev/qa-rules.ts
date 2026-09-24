/** QA probe 5: rules edge cases and result bookkeeping across rulesets. */
import { createSim, RULESETS, type BoutResult, type SimConfig } from '../../src/sim';
import { ALL, arch, cfg, withId } from './qa-lib';

const N = Number(process.argv[2] ?? 30);
const only = process.argv[3];

/** Check a finished result for internal consistency; returns problem strings. */
export function resultProblems(r: BoutResult, c: SimConfig, rounds: number, roundS: number, restS: number): string[] {
  const p: string[] = [];
  if (r.round < 1 || r.round > rounds) p.push(`round ${r.round} outside 1..${rounds}`);
  if (r.timeSeconds < 0 || r.timeSeconds > roundS + 1e-6) p.push(`timeSeconds ${r.timeSeconds} > round ${roundS}`);
  const expectTotal = (r.round - 1) * (roundS + restS) + r.timeSeconds;
  if (Math.abs(expectTotal - r.totalSeconds) > 0.11) p.push(`totalSeconds ${r.totalSeconds} != ${expectTotal.toFixed(1)}`);
  const dec = r.method.startsWith('decision') || r.method.startsWith('draw');
  if (dec) {
    if (r.scorecards.length === 0) p.push('decision without scorecards');
    const tot = r.judgeTotals;
    for (let j = 0; j < r.scorecards.length; j++) {
      const sum = [0, 0];
      for (const rd of r.scorecards[j]) { sum[0] += rd[0]; sum[1] += rd[1]; }
      if (tot[j] && (tot[j][0] !== sum[0] || tot[j][1] !== sum[1])) p.push(`judge ${j} total ${tot[j]} != sum ${sum}`);
      if (r.scorecards[j].length !== r.round && r.method !== 'decision.technical') p.push(`judge ${j} scored ${r.scorecards[j].length} rounds, bout ended in round ${r.round}`);
    }
    const votes = tot.map((t) => (t[0] > t[1] ? 0 : t[1] > t[0] ? 1 : -1));
    const w0 = votes.filter((v) => v === 0).length, w1 = votes.filter((v) => v === 1).length, d = votes.filter((v) => v === -1).length;
    let expect = '';
    if (w0 === 3 || w1 === 3) expect = 'decision.unanimous';
    else if ((w0 === 2 && w1 === 1) || (w1 === 2 && w0 === 1)) expect = 'decision.split';
    else if ((w0 === 2 || w1 === 2) && d === 1) expect = 'decision.majority';
    else if (d === 3) expect = 'draw';
    else if (d === 2) expect = 'draw.majority';
    else if (d === 1 && w0 === 1 && w1 === 1) expect = 'draw.split';
    if (tot.length === 3 && expect && expect !== r.method) p.push(`method ${r.method} but judge totals ${JSON.stringify(tot)} imply ${expect}`);
    const expWinner = w0 > w1 ? 0 : w1 > w0 ? 1 : 'draw';
    if (tot.length === 3 && ((expWinner === 'draw' && r.winner !== 'draw' && r.winner !== 'none') || (expWinner !== 'draw' && r.winner !== expWinner))) {
      p.push(`winner ${r.winner} but judges imply ${expWinner}`);
    }
  } else if (r.winner === 'draw') p.push(`finish method ${r.method} with a draw winner`);
  return p;
}

const fighters = [
  ['CHM', 'arch.champion_complete'], ['RPA', 'arch.regional_pro_allrounder'], ['EWB', 'arch.elite_wrestler_boxer'],
  ['THA', 'arch.thai_striker'], ['BJJ', 'arch.bjj_guard_player'], ['PBX', 'arch.pressure_boxer'],
] as const;

const rulesets = Object.keys(RULESETS).filter((r) => r !== 'street');
for (const rs of rulesets) {
  if (only && !only.split(',').includes(rs)) continue;
  const spec = (RULESETS as Record<string, any>)[rs];
  const methods: Record<string, number> = {}; const probs: string[] = []; const kinds: Record<string, number> = {};
  let endAtBell = 0, kdLastSecond = 0, ms = 0; let threw = '';
  for (let s = 0; s < N; s++) {
    const a = fighters[s % fighters.length], b = fighters[(s * 7 + 1) % fighters.length];
    const fa = withId(arch(a[1]), `a${a[0]}`), fb = withId(arch(b[1]), `b${b[0]}`);
    const c = cfg(`qa-rules-${rs}-${s}`, [fa, fb], { ruleset: rs, arena: rs.startsWith('mma') ? 'octagon_30' : rs.includes('grappl') || rs.includes('judo') ? 'mat_ibjjf' : 'ring_20' });
    try {
      const t0 = performance.now();
      const sim = createSim(c);
      sim.runToEnd();
      ms += performance.now() - t0;
      const r = sim.result!;
      methods[r.method] = (methods[r.method] ?? 0) + 1;
      const roundS = spec.rounds.lengthS;
      const rounds = spec.rounds.count;
      const restS = spec.rounds.breakS;
      if (s === 0) console.log(`  ${rs} clock guess: ${rounds} x ${roundS}s rest ${restS}`);
      probs.push(...resultProblems(r, c, rounds, roundS, restS).map((x) => `s${s} ${x}`));
      if (!r.method.startsWith('decision') && !r.method.startsWith('draw') && Math.abs(r.timeSeconds - roundS) < 0.11) endAtBell++;
      for (const e of sim.events) {
        if (['foul', 'pointDeduction', 'dq', 'doctorCheck', 'refereeTimeout', 'refereeCount', 'standingEight', 'cut'].includes(e.kind) || e.kind.startsWith('referee')) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
        if (e.kind === 'knockdown') {
          const rt = (e.tick % 1) + 0; void rt;
        }
      }
      const lastKd = [...sim.events].reverse().find((e) => e.kind === 'knockdown');
      const lastRoundEnd = sim.events.filter((e) => e.kind === 'roundEnd');
      if (lastKd && lastRoundEnd.some((re) => re.tick - lastKd.tick >= 0 && re.tick - lastKd.tick <= 10)) kdLastSecond++;
    } catch (e) {
      threw = `seed ${s}: ${(e as Error).stack?.split('\n').slice(0, 3).join(' / ')}`;
      break;
    }
  }
  console.log(`${rs}: ${JSON.stringify(methods)} | finish at bell ${endAtBell} | KD in last second ${kdLastSecond} | avg ${(ms / N).toFixed(0)} ms`);
  console.log(`   officials ${JSON.stringify(kinds)}`);
  if (probs.length) console.log(`   PROBLEMS(${probs.length}): ${probs.slice(0, 6).join(' | ')}`);
  if (threw) console.log(`   THREW ${threw}`);
}
void ALL;
