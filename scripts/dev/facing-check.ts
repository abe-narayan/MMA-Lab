/** Dev probe: do standing fighters face each other, and do engagements open along the approach line? */
import { simulate, ARCHETYPES, DEFAULT_SETTINGS, boutSeed, type SimConfig } from '../../src/sim';
const A = Object.values(ARCHETYPES);
const f = A.find(a => a.id === 'arch.regional_pro_allrounder')!;
let n = 0, facingErr = 0, facingBad = 0, joins = 0, yawJump = 0;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
for (let i = 0; i < 6; i++) {
  const cfg: SimConfig = { seed: boutSeed('facing', '1v1', i), mode: '1v1', fighters: [f, f], teams: { teamOf: [0, 1] },
    ruleset: 'mma.unified.3r', arena: 'octagon_30', settings: { ...DEFAULT_SETTINGS } };
  const run = simulate(cfg, { record: true });
  const frames = run.frames!;
  for (let k = 1; k < frames.length; k++) {
    const fr = frames[k];
    const [a, b] = fr.fighters;
    if (a.posture === 'standing' && b.posture === 'standing' && fr.engagements.length === 0) {
      const want = Math.atan2(b.x - a.x, b.z - a.z);
      const err = Math.abs(wrap(a.facing - want));
      n++; facingErr += err; if (err > Math.PI / 2) facingBad++;
    }
    if (fr.engagements.length === 1 && frames[k - 1].engagements.length === 0) {
      joins++;
      const prev = frames[k - 1].fighters;
      const approach = Math.atan2(prev[1].x - prev[0].x, prev[1].z - prev[0].z);
      const e = fr.engagements[0];
      const rel = Math.abs(wrap(e.rootYaw - approach));
      yawJump += Math.min(rel, Math.PI - rel); // a/b order may be swapped: up to 180 deg is the same line
    }
  }
}
console.log(`standing frames ${n}: mean facing error ${(180 / Math.PI * facingErr / n).toFixed(1)} deg, facing away (>90 deg) ${(100 * facingBad / n).toFixed(1)}%`);
console.log(`engagement openings ${joins}: mean root-yaw deviation from approach line ${(180 / Math.PI * yawJump / Math.max(1, joins)).toFixed(1)} deg`);
