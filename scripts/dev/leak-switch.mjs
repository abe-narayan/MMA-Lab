// Leak check for Watch bout switching (QA2 #3; PHASE8_NOTES "Leak fix").
//
// Generates K bouts across venues (octagon, ring, mat, street), then re-watches them from History
// S times in rotation, sampling after every switch: JS heap after a forced GC, the renderer's
// geometry / texture / program counts, its live render objects, and live three.js objects by base
// type (CDP queryObjects). One browser, RAM watchdog at 88 % of machine memory.
//
//   QA2_SNAP=leak/snap1 node scripts/dev/heavy.mjs node scripts/dev/leak-switch.mjs [S=20] [K=4] [--webgl] [--quality medium]
//
// LEAK_SNAPS=7,15 also writes heap snapshots after those switches (to qa2-lib's OUT folder), for
// diffing what grew between two visits of the same venue.
//
// QA2_SNAP names a production build under the scratchpad (see qa2-lib.mjs); build it with
//   node scripts/dev/heavy.mjs npx vite build --outDir <scratchpad>/leak/snap1
import { createWriteStream } from 'node:fs';
import { launch, metrics, nav, save, BASE, OUT, sleep, ramPct } from './qa2-lib.mjs';

const args = process.argv.slice(2);
const nums = args.filter((a) => /^\d+$/.test(a)).map(Number);
const S = nums[0] ?? 20;
const K = nums[1] ?? 4;
const webgl = args.includes('--webgl');
const q = args.includes('--quality') ? args[args.indexOf('--quality') + 1] : 'medium';
const tag = args.includes('--tag') ? args[args.indexOf('--tag') + 1] : '';
// A 960x540 page: the counts do not depend on the size, and it leaves the machine more headroom
// (the integrated GPU's render targets live in system RAM).
const { page, cdp, log, close } = await launch({ width: 960, height: 540 });
const stopAt = Number(process.env.LEAK_RAM_CAP ?? 88);
const guard = setInterval(() => {
  const r = ramPct();
  if (r > stopAt) { console.error(`[leak] machine RAM ${r.toFixed(1)}% > ${stopAt}%: stopping`); close().finally(() => process.exit(4)); }
}, 1000);

const ARCH = ['arch.champion_complete', 'arch.brand_new_brawler', 'arch.pressure_boxer', 'arch.judoka', 'arch.counter_striker', 'arch.elite_wrestler_boxer'];
const RA = [['mma.unified.3r', 'octagon_30'], ['boxing.pro', 'ring_20'], ['grappling.ibjjf', 'mat_ibjjf'], ['street', 'street_open']];
const cur = () => page.evaluate(() => document.querySelector('.nav-item[aria-current=page]')?.id);

await page.goto(`${BASE}?quality=${q}${webgl ? '&backend=webgl2' : ''}`, { waitUntil: 'load' });
await sleep(1500);
for (let i = 0; i < K; i++) {
  await nav(page, 'Match setup');
  const [rs, ar] = RA[i % RA.length];
  await page.selectOption('#ms-ruleset', rs).catch(() => {});
  await page.selectOption('#ms-arena', ar).catch(() => {});
  await page.selectOption('#ms-slot-0', ARCH[i % ARCH.length]);
  await page.selectOption('#ms-slot-1', ARCH[(i + 2) % ARCH.length]);
  if (rs === 'street' && await page.locator('#ms-maxsec').count()) await page.locator('#ms-maxsec').fill('120');
  await page.locator('#ms-seed').fill(`leak-switch-${i}`);
  await page.getByRole('button', { name: 'Run bout' }).click();
  for (let k = 0; k < 240; k++) { await sleep(500); if ((await cur()) === 'tab-result') break; }
}

/** Live objects whose prototype chain contains the prototype that owns `member` (found from the scene). */
async function census() {
  const find = (member) => `(()=>{let hit=null;const sc=window.__presenter&&window.__presenter.stage&&window.__presenter.stage.scene;if(!sc)return null;sc.traverse(o=>{for(const c of [o,o.geometry,...(Array.isArray(o.material)?o.material:[o.material])]){if(hit||!c)continue;let p=Object.getPrototypeOf(c);while(p&&!Object.prototype.hasOwnProperty.call(p,'${member}'))p=Object.getPrototypeOf(p);if(p)hit=p;}});return hit})()`;
  const out = {};
  for (const [k, member] of Object.entries({ Object3D: 'traverse', BufferGeometry: 'setIndex', Material: 'customProgramCacheKey' })) {
    const { result } = await cdp.send('Runtime.evaluate', { expression: find(member) });
    if (!result.objectId) { out[k] = null; continue; }
    const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: result.objectId });
    const { result: len } = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: 'function(){return this.length}', returnByValue: true });
    await cdp.send('Runtime.releaseObject', { objectId: objects.objectId });
    await cdp.send('Runtime.releaseObject', { objectId: result.objectId });
    out[k] = len.value;
  }
  return out;
}

await nav(page, 'History'); await sleep(600);
const rows = await page.locator('#panel-history tbody tr').count();
const res = { S, K, webgl, q, rows, switches: [] };
for (let s = 0; s < S; s++) {
  // Other work on the machine: hold the next switch while memory is high (the guard still stops at the cap).
  for (let w = 0; w < 120 && ramPct() > stopAt - 7; w++) await sleep(5000);
  const e0 = log.errors.length; const t0 = Date.now();
  await nav(page, 'History'); await sleep(200);
  await page.evaluate(() => { window.__ttff = undefined; });
  await page.locator('#panel-history tbody tr').nth(s % Math.min(K, rows)).locator('button', { hasText: 'Re-watch' }).click();
  let ok = true;
  try { await page.waitForFunction(() => window.__ttff?.revealMs > 0 && window.__watch?.digest(), null, { timeout: 180000 }); } catch { ok = false; }
  const loadMs = Date.now() - t0;
  await page.evaluate(() => { window.__watch?.speed(4); window.__watch?.play(); });
  await sleep(2500);
  await page.evaluate(() => { const t = Number(document.querySelector('input[aria-label=Seek]')?.max ?? 0); window.__watch?.seek(Math.floor(t * 0.7)); });
  await sleep(1500);
  const m = await metrics(page, cdp, { gc: true });
  const ro = await page.evaluate(() => window.__presenter?.stage?.renderer?._objects?._renderObjects?.size ?? null);
  const live = await census();
  const row = { s, ok, loadMs, heap: m.jsHeapMB, gpu: m.gpu, renderObjects: ro, live, fps: m.stats?.fps, errs: log.errors.length - e0, firstErr: log.errors[e0]?.slice(0, 160), ram: m.ram };
  res.switches.push(row);
  console.log(JSON.stringify(row));
  if ((process.env.LEAK_SNAPS ?? '').split(',').filter(Boolean).map(Number).includes(s)) {
    const file = `${OUT}/leak-${webgl ? 'webgl2' : 'webgpu'}-s${s}.heapsnapshot`;
    const out = createWriteStream(file);
    const onChunk = (e) => out.write(e.chunk);
    cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
    cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
    await new Promise((r) => out.end(r));
    console.log('snapshot', file);
  }
}
res.errors = [...new Set(log.errors.map((e) => e.slice(0, 160)))].slice(0, 10);
save(`leak-switch-${webgl ? 'webgl2' : 'webgpu'}${tag ? `-${tag}` : ''}`, res);
const a = res.switches[1] ?? res.switches[0], b = res.switches.at(-1);
console.log(JSON.stringify({ from: { heap: a.heap, gpu: a.gpu, ro: a.renderObjects, live: a.live }, to: { heap: b.heap, gpu: b.gpu, ro: b.renderObjects, live: b.live }, errors: res.errors }, null, 1));
clearInterval(guard);
await close();
