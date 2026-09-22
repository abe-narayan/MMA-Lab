import { TIER_BEHAVIOUR_CATALOGUE } from '../../src/sim/fighter/tiers';
for (const r of TIER_BEHAVIOUR_CATALOGUE) {
  console.log([r.id, r.domain, r.discipline, r.tiers.join('-'), r.trigger, (r.animationTag??[]).join(',')].join(' | ') + ' :: ' + r.effect.slice(0,110));
}
console.log('TOTAL', TIER_BEHAVIOUR_CATALOGUE.length);
