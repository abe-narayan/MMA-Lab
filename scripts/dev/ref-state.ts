/** Dev probe: referee display state over a bout containing a knockdown. */
import { createSim, ARCHETYPES, DEFAULT_SETTINGS, boutSeed, type SimConfig } from '../../src/sim';
const A = Object.values(ARCHETYPES);
const hw = A.find(a => a.id === 'arch.heavyweight_power_puncher')!;
for (let i = 0; i < 30; i++) {
  const cfg: SimConfig = { seed: boutSeed('refstate', '1v1', i), mode: '1v1', fighters: [hw, hw], teams: { teamOf: [0, 1] },
    ruleset: 'mma.unified.3r', arena: 'octagon_30', settings: { ...DEFAULT_SETTINGS } };
  const sim = createSim(cfg);
  let kdTick = -1; const spans: string[] = []; let cur = '', since = 0;
  while (sim.step()) {
    const st = sim.snapshot().referee.state;
    if (st !== cur) { if (cur) spans.push(`${cur}@${(since/10).toFixed(1)}-${(sim.tick/10).toFixed(1)}s`); cur = st; since = sim.tick; }
    if (kdTick < 0 && sim.events.some(e => e.kind === 'knockdown')) kdTick = sim.tick;
  }
  spans.push(`${cur}@${(since/10).toFixed(1)}-end`);
  if (kdTick >= 0) {
    const ev = sim.events.filter(e => ['knockdown','doctorCheck','foul','refereeStoppage','refereeWarning'].includes(e.kind)).slice(0, 8)
      .map(e => `${e.kind}@${(e.tick/10).toFixed(1)}`).join(' ');
    console.log(`bout ${i}: KD at ${(kdTick/10).toFixed(1)}s | result ${sim.result?.method} | states: ${spans.slice(0,6).join(' ')}\n   events: ${ev}`);
    break;
  }
}
