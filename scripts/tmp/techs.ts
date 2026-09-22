import { TECHNIQUES } from '../../src/sim/striking/catalogue';
const by: Record<number,string[]> = {};
for (const t of TECHNIQUES) { (by[t.minTier] ??= []).push(`${t.id}(${t.family}/${t.limb}/${t.targets[0]}/${t.skill})`); }
for (const k of Object.keys(by).sort()) console.log(`minTier ${k}: ${by[Number(k)].length}\n   ${by[Number(k)].join('\n   ')}`);
