/** Dev probe: at what distance do strikes resolve, by result? */
import { simulate, ARCHETYPES, DEFAULT_SETTINGS, boutSeed, type SimConfig } from '../../src/sim';
const A = Object.values(ARCHETYPES);
const f = A.find(a => a.id === 'arch.regional_pro_allrounder')!;
const byResult: Record<string, number[]> = {};
for (let i = 0; i < 6; i++) {
  const cfg: SimConfig = { seed: boutSeed('range', '1v1', i), mode: '1v1', fighters: [f, f], teams: { teamOf: [0, 1] },
    ruleset: 'mma.unified.3r', arena: 'octagon_30', settings: { ...DEFAULT_SETTINGS } };
  const run = simulate(cfg, { record: true });
  const frameAt = new Map(run.frames!.map(fr => [fr.tick, fr]));
  for (const e of run.events) {
    if (e.kind !== 'strike') continue;
    const fr = frameAt.get(e.tick); if (!fr) continue;
    const a = fr.fighters[e.actor], b = fr.fighters[e.target];
    if (!a || !b || a.posture !== 'standing') continue;
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    const r = (e as any).detail.result;
    (byResult[r] ??= []).push(d);
  }
}
const q = (xs: number[], p: number) => xs.slice().sort((x, y) => x - y)[Math.floor(p * (xs.length - 1))];
for (const [r, xs] of Object.entries(byResult)) {
  console.log(`${r.padEnd(12)} n=${String(xs.length).padStart(4)}  p10 ${q(xs,.1).toFixed(2)}  median ${q(xs,.5).toFixed(2)}  p90 ${q(xs,.9).toFixed(2)}  max ${Math.max(...xs).toFixed(2)} m`);
}
