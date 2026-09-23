/**
 * Dev probe: does skill tier actually decide fights, and does it decide them
 * the way docs/design/09 §7.3 says it should?
 *
 * Three views, all from the same batch:
 *   1. the named matchups of the Phase 4 finding, with duration and method mix
 *   2. the equal-tier mirror ladder — the `beh.box.defence_reference` check:
 *      a higher tier must make a bout *longer* and more technical, not shorter
 *   3. the full cross-tier win matrix, for the §7.3 monotonicity check
 *
 * Usage: `npx tsx scripts/dev/tiers.ts [bouts] [view]`
 *        view = all | pairs | mirrors | matrix
 */
import {
  simulate, ARCHETYPES, DEFAULT_SETTINGS, boutSeed,
  type SimConfig, type FighterDefinition,
} from '../../src/sim';

const A = Object.values(ARCHETYPES);
const by = (id: string): FighterDefinition => A.find((a) => a.id === id)!;

const N = Number(process.argv[2] ?? 30);
const view = process.argv[3] ?? 'all';

interface Row {
  aWins: number;
  bWins: number;
  draws: number;
  seconds: number;
  finishes: number;
  decisions: number;
  kd: number;
  sigLanded: number;
  sigAttempted: number;
}

function run(a: FighterDefinition, b: FighterDefinition, label: string): Row {
  const row: Row = {
    aWins: 0, bWins: 0, draws: 0, seconds: 0, finishes: 0, decisions: 0,
    kd: 0, sigLanded: 0, sigAttempted: 0,
  };
  for (let i = 0; i < N; i++) {
    const cfg: SimConfig = {
      seed: boutSeed(`tier-${label}`, '1v1', i),
      mode: '1v1',
      fighters: [a, b],
      teams: { teamOf: [0, 1] },
      ruleset: 'mma.unified.3r',
      arena: 'octagon_30',
      settings: { ...DEFAULT_SETTINGS },
    };
    const r = simulate(cfg);
    if (r.result.winner === 0) row.aWins++;
    else if (r.result.winner === 1) row.bWins++;
    else row.draws++;
    row.seconds += r.result.totalSeconds;
    if (r.result.method.startsWith('decision') || r.result.method.startsWith('draw')) row.decisions++;
    else row.finishes++;
    for (const f of r.stats.total.fighters) {
      row.kd += f.knockdowns;
      row.sigLanded += f.sig.landed;
      row.sigAttempted += f.sig.attempted;
    }
  }
  return row;
}

const pct = (n: number, d: number): string => `${Math.round((100 * n) / Math.max(1, d))}%`;

// ---------------------------------------------------------------------------
// 1. named matchups
// ---------------------------------------------------------------------------

const PAIRS: [string, string][] = [
  ['arch.brand_new_brawler', 'arch.regional_pro_allrounder'],
  ['arch.brand_new_brawler', 'arch.champion_complete'],
  ['arch.gym_fit_beginner', 'arch.elite_wrestler_boxer'],
  ['arch.regional_pro_allrounder', 'arch.champion_complete'],
  ['arch.champion_complete', 'arch.champion_complete'],
  ['arch.regional_pro_allrounder', 'arch.regional_pro_allrounder'],
];

if (view === 'all' || view === 'pairs') {
  console.log(`\n== named matchups (${N} bouts each) ==`);
  console.log('matchup'.padEnd(20), 'A wins   mean dur   finishes   KD/15m  sig acc');
  for (const [a, b] of PAIRS) {
    const fa = by(a);
    const fb = by(b);
    const r = run(fa, fb, `${a}-${b}`);
    const perFighterMin = r.seconds / 30;
    const label = `${fa.short ?? a.slice(5)} vs ${fb.short ?? b.slice(5)}`;
    console.log(
      label.padEnd(20),
      `${String(Math.round((100 * r.aWins) / N)).padStart(4)}%`,
      `   ${(r.seconds / N / 60).toFixed(1)}m`,
      `     ${pct(r.finishes, N).padStart(4)}`,
      `    ${((r.kd / perFighterMin) * 15).toFixed(2)}`,
      `   ${pct(r.sigLanded, r.sigAttempted)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 2. the equal-tier mirror ladder (09 §7.3: skill must not shorten a fight)
// ---------------------------------------------------------------------------

/** One archetype per mmaTier, T0..T5, for the mirror and matrix views. */
export const TIER_LADDER: readonly [tier: number, id: string][] = [
  [0, 'arch.brand_new_brawler'],
  [1, 'arch.gym_fit_beginner'],
  [2, 'arch.heavyweight_power_puncher'],
  [3, 'arch.regional_pro_allrounder'],
  [4, 'arch.elite_wrestler_boxer'],
  [5, 'arch.champion_complete'],
];

if (view === 'all' || view === 'mirrors') {
  console.log(`\n== equal-tier mirrors (${N} bouts each) ==`);
  console.log('tier  archetype        A wins  mean dur  decisions  KD/15m  sig acc');
  for (const [tier, id] of TIER_LADDER) {
    const f = by(id);
    const r = run(f, f, `mirror-${id}`);
    const perFighterMin = r.seconds / 30;
    console.log(
      `T${tier}   `,
      (f.short ?? id.slice(5)).padEnd(16),
      `${String(Math.round((100 * r.aWins) / N)).padStart(4)}%`,
      `  ${(r.seconds / N / 60).toFixed(1)}m`.padStart(8),
      `   ${pct(r.decisions, N).padStart(4)}`,
      `    ${((r.kd / perFighterMin) * 15).toFixed(2)}`,
      `   ${pct(r.sigLanded, r.sigAttempted)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 3. the cross-tier win matrix (09 §7.3 monotonicity)
// ---------------------------------------------------------------------------

if (view === 'all' || view === 'matrix') {
  console.log(`\n== win matrix, row fighter's win % (${N} bouts per cell) ==`);
  console.log('      ' + TIER_LADDER.map(([t]) => `T${t}`.padStart(6)).join(''));
  for (const [ta, ida] of TIER_LADDER) {
    const cells: string[] = [];
    for (const [tb, idb] of TIER_LADDER) {
      const r = run(by(ida), by(idb), `m-${ta}-${tb}`);
      cells.push(`${Math.round((100 * r.aWins) / N)}%`.padStart(6));
    }
    console.log(`T${ta}   ` + cells.join(''));
  }
}
