/** QA probe: slot bias in mirror 1v1 / ffa / teams, with Wilson CIs. */
import { arch, cfg, runChecked, withId, wilson } from './qa-lib';

const N = Number(process.argv[2] ?? 200);
const which = process.argv[3] ?? 'all';
const tplId = process.argv[4] ?? 'arch.regional_pro_allrounder';
const tpl = arch(tplId);

function report(label: string, counts: Record<string, number>, n: number, extra = ''): void {
  console.log(`${label} (n=${n}) ${JSON.stringify(counts)} ${extra}`);
}

if (which === 'all' || which === '1v1') {
  let red = 0, blue = 0, draw = 0; const methods: Record<string, number> = {}; const probs: string[] = [];
  let finishRed = 0, finishBlue = 0;
  for (let s = 0; s < N; s++) {
    const r = runChecked(cfg(`qa-mirror-${s}`, [withId(tpl, 'red'), withId(tpl, 'blue')]), 50);
    if (r.result.winner === 0) red++; else if (r.result.winner === 1) blue++; else draw++;
    const fin = !r.result.method.startsWith('decision') && !r.result.method.startsWith('draw');
    if (fin && r.result.winner === 0) finishRed++;
    if (fin && r.result.winner === 1) finishBlue++;
    methods[r.result.method] = (methods[r.result.method] ?? 0) + 1;
    probs.push(...r.problems);
  }
  const [lo, hi] = wilson(red, red + blue);
  report(`1v1 mirror ${tplId}`, { red, blue, draw }, N,
    `red share of decisive ${(red / (red + blue)).toFixed(3)} CI [${lo.toFixed(3)}, ${hi.toFixed(3)}]; finishes red ${finishRed} blue ${finishBlue}; methods ${JSON.stringify(methods)}; problems ${probs.length}`);
}

if (which === 'all' || which === 'swap') {
  // Same pair, swapped corners: A in red vs A in blue.
  const a = arch('arch.pressure_boxer'), b = arch('arch.counter_striker');
  let aRed = 0, aBlue = 0;
  for (let s = 0; s < N / 2; s++) {
    const r1 = runChecked(cfg(`qa-swap-${s}`, [withId(a, 'A'), withId(b, 'B')]), 100);
    const r2 = runChecked(cfg(`qa-swap-${s}`, [withId(b, 'B'), withId(a, 'A')]), 100);
    if (r1.result.winner === 0) aRed++;
    if (r2.result.winner === 1) aBlue++;
  }
  console.log(`corner swap PBX vs CTR: PBX wins in red ${aRed}/${N / 2}, in blue ${aBlue}/${N / 2}`);
}

if (which === 'all' || which === 'ffa') {
  for (const n of [3, 4]) {
    const wins: Record<string, number> = {}; const methods: Record<string, number> = {};
    const M = Math.max(10, Math.round(N / 5));
    for (let s = 0; s < M; s++) {
      const fs = Array.from({ length: n }, (_, i) => withId(tpl, `f${i}`));
      const r = runChecked(cfg(`qa-ffa-mirror-${n}-${s}`, fs, { mode: 'ffa' }), 100);
      const k = String(r.result.winner);
      wins[k] = (wins[k] ?? 0) + 1;
      methods[r.result.method] = (methods[r.result.method] ?? 0) + 1;
    }
    report(`ffa${n} mirror`, wins, M, `methods ${JSON.stringify(methods)}`);
  }
}

if (which === 'all' || which === 'teams') {
  for (const [a, b] of [[2, 2], [3, 3]]) {
    const wins: Record<string, number> = {}; const methods: Record<string, number> = {};
    const M = Math.max(10, Math.round(N / 5));
    for (let s = 0; s < M; s++) {
      const fs = Array.from({ length: a + b }, (_, i) => withId(tpl, `t${i}`));
      const r = runChecked(cfg(`qa-teams-mirror-${a}v${b}-${s}`, fs, { mode: 'teams', teamOf: fs.map((_, i) => (i < a ? 0 : 1)) }), 100);
      const k = String(r.result.winningTeam);
      wins[k] = (wins[k] ?? 0) + 1;
      methods[r.result.method] = (methods[r.result.method] ?? 0) + 1;
    }
    report(`teams ${a}v${b} mirror (by team)`, wins, M, `methods ${JSON.stringify(methods)}`);
  }
}
