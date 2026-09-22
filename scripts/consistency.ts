/** Checks the grappling-pair invariant across many bouts and formats. */
import { BoutSimulation } from '../src/engine/engine';
import { boutSeed } from '../src/engine/recorder';
let bad = 0, frames = 0;
for (const n of [1, 2, 3, 4, 5]) {
  for (let i = 1; i <= 60; i++) {
    const sim = new BoutSimulation({ seed: boutSeed('cons', n, i), opponents: n });
    const fr = sim.runRecorded();
    for (const f of fr) {
      frames++;
      const g = f.fighters.filter((x) => x.posture === 'ground' && !x.out);
      const c = f.fighters.filter((x) => x.posture === 'clinch' && !x.out);
      const tops = g.filter((x) => x.groundRole === 'top').length;
      const bots = g.filter((x) => x.groundRole === 'bottom').length;
      if (tops !== bots) bad++;
      else if (c.length % 2 !== 0) bad++;
      else if (f.fighters.some((x) => x.posture !== 'ground' && x.groundRole !== 'none')) bad++;
    }
  }
}
console.log(`grappling-pair invariant: ${bad} violations in ${frames} frames`);
process.exit(bad === 0 ? 0 : 1);
