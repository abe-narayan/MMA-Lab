/** QA probe: street ruleset 1v1 — can anybody ever be stopped? */
import { createSim } from '../../src/sim';
import { arch, cfg, withId } from './qa-lib';
for (let s = 0; s < 6; s++) {
  const sim = createSim(cfg(`qa-street-${s}`, [withId(arch('arch.champion_complete'), 'chm'), withId(arch('arch.brand_new_brawler'), 'bnb')],
    { ruleset: 'street', arena: 'street_open', settings: { maxSeconds: 600 } }));
  sim.runToEnd();
  const k = (kind: string) => sim.events.filter((e) => e.kind === kind).length;
  const w = sim.world.fighters;
  console.log(`seed ${s}: ${sim.result!.method} winner=${sim.result!.winner} t=${sim.result!.totalSeconds} knockdowns=${k('knockdown')} ko-ish states=${sim.events.filter((e) => e.kind === 'stateChange' && /ko|unconscious/i.test(JSON.stringify(e.detail))).length} sig=${w.map((f) => f.sigLanded).join('/')} headAcute=${w.map((f) => f.damage.regions.head.acute.toFixed(2)).join('/')} out=${w.map((f) => f.out).join('/')}`);
}
