/** QA probe: determinism hazards (key order, Math.random, input mutation, order, clock). */
import { createSim, toReplayFile, verifyReplay, simulate } from '../../src/sim';
import { arch, cfg, clone, withId } from './qa-lib';

const run = (c: any) => { const s = createSim(c); s.runToEnd(); return { d: s.digest, t: s.tick, n: s.rngDraws, r: JSON.stringify(s.result), e: s.events.length }; };
const base = () => cfg('qa-det-1', [withId(arch('arch.elite_wrestler_boxer'), 'a'), withId(arch('arch.thai_striker'), 'b')]);

const c1 = base();
const before = JSON.stringify(c1);
const r1 = run(c1);
console.log('input mutated:', JSON.stringify(c1) !== before);
const r2 = run(base());
console.log('repeat equal:', JSON.stringify(r1) === JSON.stringify(r2), r1.d, r1.t);

// Reverse key order of every object in the fighters.
const rev = (v: any): any => Array.isArray(v) ? v.map(rev) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, rev(x)])) : v;
const c3 = base(); c3.fighters = c3.fighters.map(rev);
const r3 = run(c3);
console.log('key-order independent:', JSON.stringify(r1) === JSON.stringify(r3), r3.d);

// Math.random and Date must not be read.
const origRandom = Math.random; const origNow = Date.now;
let randomCalls = 0; let nowCalls = 0;
Math.random = () => { randomCalls++; return 0.5; };
Date.now = () => { nowCalls++; return 0; };
const r4 = run(base());
Math.random = origRandom; Date.now = origNow;
console.log('Math.random calls', randomCalls, 'Date.now calls', nowCalls, 'equal', JSON.stringify(r1) === JSON.stringify(r4));

// Interleaving.
run(cfg('noise', [withId(arch('arch.judoka'), 'x'), withId(arch('arch.sambo_grappler'), 'y')]));
run(cfg('noise2', [0, 1, 2, 3].map((i) => withId(arch('arch.regional_pro_allrounder'), `n${i}`)), { mode: 'ffa' }));
const r5 = run(base());
console.log('order independent:', JSON.stringify(r1) === JSON.stringify(r5));

// Replay round trip.
try {
  const full = simulate(base());
  const file = JSON.parse(JSON.stringify(toReplayFile(full)));
  console.log('replay verify:', JSON.stringify(verifyReplay(file)));
  const tampered = clone(file); tampered.fighters[0].physical.chin = 1;
  console.log('tampered verify:', JSON.stringify(verifyReplay(tampered)));
} catch (e) { console.log('replay path threw:', (e as Error).message); }

// Seeds that differ only slightly diverge.
const r6 = run({ ...base(), seed: 'qa-det-2' });
console.log('different seed diverges:', r6.d !== r1.d);
// Unicode / empty / huge seed
for (const seed of ['', ' ', 'ü🥊', 'x'.repeat(100000)]) {
  try { const r = run({ ...base(), seed }); console.log(`seed len ${seed.length}: ok ${r.d} ${r.t}`); } catch (e) { console.log(`seed len ${seed.length}: threw ${(e as Error).message}`); }
}
