import { ARCHETYPES, deriveRuntime, resolveParams } from '../../src/sim';
const PR = resolveParams();
import { rulesFor } from '../../src/sim/fighter/tiers';
for (const a of Object.values(ARCHETYPES)) {
  const rt = deriveRuntime(a, PR, { explain: false });
  const t = rt.tiers as Record<string, number>;
  console.log(`${(a.short ?? a.id).padEnd(6)} ${a.id.padEnd(34)} mma=${rt.mmaTier} str=${rt.strikingTier} grp=${rt.grapplingTier} iq=${rt.iqTier}  box=${t.boxing} mt=${t.muayThai} wr=${t.wrestling} bjj=${t.bjj} ju=${t.judo} mi=${t.mmaIntegration} subD=${(t.subDefence??0).toFixed(0)} subA=${(t.subAttack??0).toFixed(0)} exp=${(t.experience??0).toFixed(2)}  rules=${rulesFor(rt).length}`);
}
