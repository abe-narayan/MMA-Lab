import { TIER_BEHAVIOUR_CATALOGUE } from '../../src/sim/fighter/tiers';
const want = process.argv[2];
for (const r of TIER_BEHAVIOUR_CATALOGUE) {
  if (want && !r.id.includes(want)) continue;
  console.log(`${r.id} [${r.discipline} ${r.tiers[0]}-${r.tiers[1]}] trig=${r.trigger}`);
  console.log('   ' + r.effect);
}
