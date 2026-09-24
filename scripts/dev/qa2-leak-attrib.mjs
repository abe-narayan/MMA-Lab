// QA2 leak attribution: after each Watch bout switch (WebGL2), compare geometries/textures reachable from the scene with
// the renderer's live counts, and count live objects by prototype (Presenter, THREE.BufferGeometry, Float32Array bytes).
import { launch, metrics, nav, BASE, sleep } from './qa2-lib.mjs';
const N = Number(process.argv[2] ?? 6);
const { page, cdp, close } = await launch();
await page.goto(`${BASE}?quality=medium&backend=webgl2`, { waitUntil: 'load' }); await sleep(1500);
const cur = () => page.evaluate(() => document.querySelector('.nav-item[aria-current=page]')?.id);
for (let i = 0; i < N; i++) {
  await nav(page, 'Match setup');
  const A = ['arch.champion_complete', 'arch.brand_new_brawler', 'arch.pressure_boxer', 'arch.judoka', 'arch.counter_striker'];
  await page.selectOption('#ms-slot-0', A[i % 5]); await page.selectOption('#ms-slot-1', A[(i + 2) % 5]);
  await page.locator('#ms-seed').fill(`qa2-attr-${i}`);
  await page.getByRole('button', { name: 'Run bout' }).click();
  for (let k = 0; k < 120; k++) { await sleep(500); if ((await cur()) === 'tab-result') break; }
}
async function countProto(expr) {
  const { result } = await cdp.send('Runtime.evaluate', { expression: expr });
  if (!result.objectId) return null;
  const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: result.objectId });
  const { result: len } = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function(){return this.length}', returnByValue: true });
  return len.value;
}
for (let s = 0; s < N; s++) {
  await nav(page, 'History');
  await page.evaluate(() => { window.__ttff = undefined; });
  await page.locator('#panel-history tbody tr').nth(s).locator('button', { hasText: 'Re-watch' }).click();
  await page.waitForFunction(() => window.__ttff?.revealMs > 0, null, { timeout: 120000 }).catch(() => {});
  await sleep(1500);
  const m = await metrics(page, cdp, { gc: true });
  const scene = await page.evaluate(() => {
    const p = window.__presenter; const sc = p?.stage?.scene; if (!sc) return null;
    const g = new Set(); const t = new Set(); let meshes = 0;
    sc.traverse((o) => { if (o.geometry) { g.add(o.geometry); meshes++; } const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; for (const mm of ms) for (const v of Object.values(mm)) if (v && v.isTexture) t.add(v); });
    return { sceneGeoms: g.size, sceneTex: t.size, meshes, children: sc.children.length };
  });
  const presenters = await countProto('Object.getPrototypeOf(window.__presenter)');
  const geoms = await countProto('Object.getPrototypeOf(Object.getPrototypeOf((()=>{let g;window.__presenter.stage.scene.traverse(o=>{if(!g&&o.geometry)g=o.geometry});return g})()))');
  console.log(JSON.stringify({ s, heap: m.jsHeapMB, gpu: m.gpu, scene, presenters, liveGeometryObjects: geoms }));
}
await close();
