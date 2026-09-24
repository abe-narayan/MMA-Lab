// QA2: live three.js objects by base type after each Watch switch (WebGL2), via CDP queryObjects.
import { launch, metrics, nav, BASE, sleep } from './qa2-lib.mjs';
const N = Number(process.argv[2] ?? 4);
const { page, cdp, close } = await launch();
await page.goto(`${BASE}?quality=medium&backend=webgl2`, { waitUntil: 'load' }); await sleep(1500);
const cur = () => page.evaluate(() => document.querySelector('.nav-item[aria-current=page]')?.id);
const A = ['arch.champion_complete', 'arch.brand_new_brawler', 'arch.pressure_boxer', 'arch.judoka', 'arch.counter_striker'];
for (let i = 0; i < N; i++) {
  await nav(page, 'Match setup');
  await page.selectOption('#ms-slot-0', A[i % 5]); await page.selectOption('#ms-slot-1', A[(i + 2) % 5]);
  await page.locator('#ms-seed').fill(`qa2-types-${i}`);
  await page.getByRole('button', { name: 'Run bout' }).click();
  for (let k = 0; k < 120; k++) { await sleep(500); if ((await cur()) === 'tab-result') break; }
}
const find = (member) => `(()=>{let hit=null;window.__presenter.stage.scene.traverse(o=>{for(const c of [o,o.geometry,...(Array.isArray(o.material)?o.material:[o.material]),o.material&&o.material.map]){if(hit||!c)continue;let p=Object.getPrototypeOf(c);while(p&&!Object.prototype.hasOwnProperty.call(p,'${member}'))p=Object.getPrototypeOf(p);if(p)hit=p;}});return hit})()`;
const TYPES = { Object3D: 'traverse', BufferGeometry: 'setIndex', Material: 'customProgramCacheKey', Texture: 'transformUv', BufferAttribute: 'setUsage' };
async function count(member) {
  let expr = find(member);
  if (member === 'setUsage') expr = `(()=>{let hit=null;window.__presenter.stage.scene.traverse(o=>{const a=o.geometry&&o.geometry.attributes&&o.geometry.attributes.position;if(!hit&&a){let p=Object.getPrototypeOf(a);while(p&&!Object.prototype.hasOwnProperty.call(p,'setUsage'))p=Object.getPrototypeOf(p);hit=p}});return hit})()`;
  const { result } = await cdp.send('Runtime.evaluate', { expression: expr });
  if (!result.objectId) return null;
  const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: result.objectId });
  const { result: len } = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function(){return this.length}', returnByValue: true });
  await cdp.send('Runtime.releaseObject', { objectId: objects.objectId });
  return len.value;
}
for (let s = 0; s < N; s++) {
  await nav(page, 'History');
  await page.evaluate(() => { window.__ttff = undefined; });
  await page.locator('#panel-history tbody tr').nth(s).locator('button', { hasText: 'Re-watch' }).click();
  await page.waitForFunction(() => window.__ttff?.revealMs > 0, null, { timeout: 120000 }).catch(() => {});
  await sleep(2000);
  const m = await metrics(page, cdp, { gc: true });
  const c = {}; for (const [k, v] of Object.entries(TYPES)) c[k] = await count(v);
  const sceneObjs = await page.evaluate(() => { let n = 0; window.__presenter?.stage?.scene?.traverse(() => n++); return n; });
  console.log(JSON.stringify({ s, heap: m.jsHeapMB, gpu: m.gpu, sceneObjs, live: c }));
}
await close();
