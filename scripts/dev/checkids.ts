/** Dev probe: do archetype style preferences reference real catalogue ids? */
import { ARCHETYPES } from '../../src/sim';
import { validateFighter } from '../../src/app/store';
let total = 0;
for (const a of Object.values(ARCHETYPES)) {
  const r = validateFighter(a);
  const bad = r.issues.filter(i => /is not in chapter/.test(i.message));
  if (bad.length) {
    total += bad.length;
    console.log(`${a.short.padEnd(5)} ${a.name}`);
    for (const i of bad) console.log(`   ${i.path}  ${i.message.replace(/"/g,'')}`);
  }
}
console.log(`\ntotal dangling ids: ${total}`);
