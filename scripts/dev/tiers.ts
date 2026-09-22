/** Dev probe: does skill tier actually decide fights? */
import { simulate, ARCHETYPES, DEFAULT_SETTINGS, boutSeed, type SimConfig, type FighterDefinition } from '../../src/sim';
const A = Object.values(ARCHETYPES);
const by = (id: string) => A.find(a => a.id === id)!;
const pairs: [string, string][] = [
  ['arch.brand_new_brawler', 'arch.regional_pro_allrounder'],
  ['arch.brand_new_brawler', 'arch.champion_complete'],
  ['arch.gym_fit_beginner', 'arch.elite_wrestler_boxer'],
  ['arch.regional_pro_allrounder', 'arch.champion_complete'],
  ['arch.champion_complete', 'arch.champion_complete'],
  ['arch.regional_pro_allrounder', 'arch.regional_pro_allrounder'],
];
const N = 30;
console.log('matchup'.padEnd(52), 'A wins   mean dur   finishes');
for (const [a, b] of pairs) {
  const fa = by(a), fb = by(b);
  let aw = 0, secs = 0, fin = 0;
  for (let i = 0; i < N; i++) {
    const cfg: SimConfig = { seed: boutSeed(`tier-${a}-${b}`, '1v1', i), mode: '1v1',
      fighters: [fa, fb], teams: { teamOf: [0,1] }, ruleset: 'mma.unified.3r',
      arena: 'octagon_30', settings: { ...DEFAULT_SETTINGS } };
    const r = simulate(cfg);
    if (r.result.winner === 0) aw++;
    secs += r.result.totalSeconds;
    if (!r.result.method.startsWith('decision')) fin++;
  }
  const label = `${fa.short ?? a.slice(5)} vs ${fb.short ?? b.slice(5)}`;
  console.log(label.padEnd(52), `${String(Math.round(100*aw/N)).padStart(3)}%`,
    `   ${(secs/N/60).toFixed(1)}m`, `    ${Math.round(100*fin/N)}%`);
}
