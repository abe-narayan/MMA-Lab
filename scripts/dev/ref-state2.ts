/** Dev probe: referee display state in the Watch demo bout. */
import { createSim } from '../../src/sim';
import { ARCHETYPES, DEFAULT_SETTINGS, type SimConfig } from '../../src/sim';
const L = Object.values(ARCHETYPES);
const demoConfig = (): SimConfig => ({ seed: 'watch-demo', mode: '1v1', fighters: [L[0], L[1]], teams: { teamOf: [0, 1] }, ruleset: 'mma.unified.3r', arena: 'octagon_30', settings: DEFAULT_SETTINGS });
const sim = createSim(demoConfig());
const spans: string[] = []; let cur = '', since = 0; let pk = '';
while (sim.step()) {
  const st = sim.snapshot().referee.state;
  if (st !== cur) { if (cur) spans.push(`${cur} ${(since/10).toFixed(1)}-${(sim.tick/10).toFixed(1)}s`); cur = st; since = sim.tick; }
}
spans.push(`${cur} ${(since/10).toFixed(1)}-end(${(sim.tick/10).toFixed(1)}s)`);
console.log('result', sim.result?.method, sim.result?.detail);
console.log(spans.join('\n'));
const ev = sim.events.filter(e => ['knockdown','doctorCheck','foul','deduction','refereeTimeout','refereeStoppage'].includes(e.kind))
  .map(e => `${e.kind}@${(e.tick/10).toFixed(1)} ${JSON.stringify((e as any).detail).slice(0,80)}`);
console.log(ev.slice(0, 15).join('\n'));
const warns = sim.events.filter(e => e.kind === 'refereeWarning').length;
console.log('refereeWarning events:', warns, 'of', sim.events.length);
