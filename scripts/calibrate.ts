import { recordBout, boutSeed } from '../src/engine/recorder';
const N = Number(process.env.N ?? 300);
for (const n of [1, 2, 3, 4, 5]) {
  const m: Record<string, number> = {};
  let aWins = 0, secs = 0, acc = 0, accN = 0, endStamA = 0, kd = 0, td = 0, gr = 0;
  const durations: number[] = [];
  for (let i = 1; i <= N; i++) {
    const r = recordBout(i, { seed: boutSeed('cal', n, i), opponents: n });
    m[r.result.method] = (m[r.result.method] || 0) + 1;
    if (r.result.winner === 'A') aWins++;
    secs += r.analytics.totalSeconds; durations.push(r.analytics.totalSeconds);
    const a = r.analytics.perFighter[0];
    if (a.sigAttempted > 4) { acc += a.accuracy; accN++; }
    endStamA += a.endStamina; kd += r.analytics.knockdowns; td += r.analytics.takedownsLanded;
    gr += r.analytics.postureSeconds.ground + r.analytics.postureSeconds.clinch;
  }
  durations.sort((x, y) => x - y);
  console.log(`1v${n}: A ${(100*aWins/N).toFixed(1)}%  median ${durations[Math.floor(N/2)].toFixed(0)}s  A acc ${(100*acc/Math.max(1,accN)).toFixed(0)}%  A end-stam ${(100*endStamA/N).toFixed(0)}%  kd/bout ${(kd/N).toFixed(2)}  td/bout ${(td/N).toFixed(2)}  grapple ${(gr/N).toFixed(0)}s`);
  console.log('   ', Object.entries(m).map(([k,v]) => `${k}=${(100*v/N).toFixed(0)}%`).join('  '));
}
