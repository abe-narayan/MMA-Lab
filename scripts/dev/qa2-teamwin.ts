// QA2: what result do team bouts carry? (the UI shows "No contest" when winner === 'none')
import { simulate, ARCHETYPES, DEFAULT_SETTINGS } from '../../src/sim';
const A = ARCHETYPES as Record<string, unknown>;
const ids = ['arch.champion_complete', 'arch.brand_new_brawler', 'arch.pressure_boxer', 'arch.bjj_guard_player', 'arch.counter_striker', 'arch.judoka'];
for (const [seed, n, teamOf] of [['qa2-Teams-1v3', 4, [0, 1, 1, 1]], ['qa2-Teams-3v3', 6, [0, 0, 0, 1, 1, 1]], ['qa2-Teams-2v2', 4, [0, 0, 1, 1]]] as const) {
  const run = simulate({ seed, mode: 'teams', fighters: ids.slice(0, n).map((i) => A[i]), teams: { teamOf: [...teamOf] }, ruleset: 'mma.unified.3r', arena: 'octagon_30', settings: DEFAULT_SETTINGS } as never);
  console.log(seed, JSON.stringify({ winner: run.result.winner, winningTeam: (run.result as any).winningTeam, method: run.result.method }), run.digest.slice(0, 8));
}
