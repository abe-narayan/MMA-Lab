/** QA probe: referee latches after the first stoppage in multi-fighter bouts. */
import { createSim } from '../../src/sim';
const simulate = (c: any) => { const s = createSim(c); s.runToEnd(); return { result: s.result!, events: [...s.events], ticks: s.tick }; };
import { arch, cfg, withId } from './qa-lib';
const rpa = arch('arch.regional_pro_allrounder');
for (let s = 0; s < 3; s++) {
  const fs = Array.from({ length: 6 }, (_, i) => withId(rpa, `t${i}`));
  const r = simulate(cfg(`qa-multi-3v3-${s}`, fs, { mode: 'teams', teamOf: [0, 0, 0, 1, 1, 1] }));
  const k = (kind: string) => r.events.filter((e) => e.kind === kind).length;
  const firstOut = r.events.find((e) => e.kind === 'fighterOut');
  const refAfter = r.events.filter((e) => e.kind.startsWith('referee') && firstOut && e.tick > firstOut.tick).length;
  const refBefore = r.events.filter((e) => e.kind.startsWith('referee') && firstOut && e.tick <= firstOut.tick).length;
  const kdAfter = r.events.filter((e) => e.kind === 'knockdown' && firstOut && e.tick > firstOut.tick).length;
  console.log(`seed ${s}: ${r.result.method} events=${r.events.length} fighterOut=${k('fighterOut')} refereeStoppage=${k('refereeStoppage')} firstOut tick=${firstOut?.tick} referee* events before=${refBefore} after=${refAfter} knockdowns after=${kdAfter} ticks=${r.ticks}`);
  const kinds: Record<string, number> = {};
  for (const e of r.events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  if (s === 0) console.log(JSON.stringify(kinds));
}
