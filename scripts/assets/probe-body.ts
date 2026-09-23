import { readFileSync } from 'node:fs';
import { decodeBodyAsset } from '../../src/presentation/character/asset';
import { buildBody, measure } from '../../src/presentation/character/body';
import { ARCHETYPES, deriveRuntime, resolveParams } from '../../src/sim';
const h = JSON.parse(readFileSync('static/assets/body/body.json', 'utf8'));
const b = readFileSync('static/assets/body/body.bin');
const asset = decodeBodyAsset(h, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const m0 = measure(asset, asset.srcPos.slice());
console.log('base', m0.m);
const params = resolveParams();
for (const def of Object.values(ARCHETYPES)) {
  const rt = deriveRuntime(def, params, { explain: false });
  const t0 = performance.now();
  const body = buildBody(asset, def, rt);
  const ms = performance.now() - t0;
  const m = body.measures;
  console.log(def.id.padEnd(34), `h ${def.body.heightM}/${m.statureM.toFixed(3)} reach ${def.body.reachM}/${m.spanM.toFixed(3)} leg ${def.body.legReachM}/${m.hipHeightM.toFixed(3)} sw ${rt.rig.shoulderWidthM.toFixed(3)}/${m.shoulderWidthM.toFixed(3)} mus ${body.params.muscle.toFixed(2)} wt ${body.params.weight.toFixed(2)} ${ms.toFixed(0)}ms`);
}

// Triangles per LOD for a few looks (GPU-free actor construction).
const THREE = await import('three/webgpu');
const { FighterActor } = await import('../../src/presentation/character/actor');
const { canonical } = await import('../../src/presentation/character/canonical');
const tx = await import('../../src/presentation/character/textures');
const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
const mats = new Map<string, unknown>();
const res = {
  asset, can: canonical(asset),
  skinTex: { maskA: tex, maskB: tex, detail: tx.makeSkinDetail(32), sweat: tx.makeSweatDetail(32) },
  kitTex: { cloth: tx.makeClothDetail(32), leather: tx.makeLeatherDetail(32) },
  material<M>(k: string, make: () => M): M { if (!mats.has(k)) mats.set(k, make()); return mats.get(k) as M; },
};
const q = { skinScattering: true, sweatAndDamage: true, maxCharacterLOD: 0 };
for (const hairStyle of ['bald', 'crew', 'curly']) {
  const def = { ...Object.values(ARCHETYPES)[0] };
  def.appearance = { ...def.appearance, hairStyle: { styleId: hairStyle, colorId: 'black', length: 'short' } };
  const bout = { fighters: [def], runtimes: [deriveRuntime(def, params, { explain: false })], teamOf: [0], arena: {}, rulesetId: 'mma', glove: 'mma4oz', cornerColours: ['#c01824'], blood: true, cosmeticSeed: 'x' };
  const a = new FighterActor(res as never, bout as never, 0, q as never);
  const t: number[] = [];
  for (const l of [0, 1, 2, 3] as const) { a.setLOD(l); t.push(a.triangles()); }
  console.log(`tris ${hairStyle}: LOD0-3 ${t.join(' / ')}  build ${a.buildMs.toFixed(0)} ms`);
}
