// QA2 batch: 100 and 1,000 bouts (then 5,000 with --big), long tasks and main-thread responsiveness during the run,
// cancel mid-run, re-run (fingerprint must match), refresh mid-batch (workers must die), heap.
import { launch, metrics, nav, save, report, OUT, BASE, sleep, ramPct } from './qa2-lib.mjs';

const big = process.argv.includes('--big');
const { page, cdp, log, close, peakRam, context } = await launch({ webgpu: false });
const res = { runs: [] };
const workerCount = async () => (await cdp.send('Target.getTargets').catch(() => ({ targetInfos: [] }))).targetInfos.filter((t) => t.type === 'worker').length;
await cdp.send('Target.setDiscoverTargets', { discover: true }).catch(() => {});

async function setSize(n) {
  const label = { 10: '10', 100: '100', 1000: '1,000', 5000: '5,000' }[n];
  if (label) await page.getByRole('radio', { name: label, exact: true }).click();
  else { await page.getByRole('radio', { name: 'Custom' }).click(); await page.locator('.batch-custom').fill(String(n)); }
}
/** Probe main-thread latency: time for a rAF + evaluate round trip. */
const latency = async () => { const t = Date.now(); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); return Date.now() - t; };
async function runBatchUi(n, { cancelAt = null, reloadAt = null, seed = 'qa2-batch' } = {}) {
  await nav(page, 'Batch simulation');
  await page.locator('.batch-seed input').fill(seed);
  await setSize(n);
  const lt0 = await page.evaluate(() => window.__qaLongTasks.length);
  const e0 = log.errors.length; const t0 = Date.now();
  await page.getByRole('button', { name: /^Run [\d,]+ bouts/ }).click();
  const samples = []; let lat = []; let cancelled = false; let reloaded = false;
  for (;;) {
    await sleep(1000);
    const done = await page.getByRole('button', { name: 'Export CSV' }).count();
    const prog = (await page.locator('.batch-progress-stats').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const l = await latency(); lat.push(l);
    const m = await metrics(page, cdp);
    const workers = await workerCount();
    samples.push({ s: Math.round((Date.now() - t0) / 1000), heap: m.jsHeapMB, nodes: m.nodes, lat: l, workers, ram: +ramPct().toFixed(0), prog: prog.slice(0, 90) });
    const doneN = Number((prog.match(/([\d,]+)\s*(?:of|\/)\s*[\d,]+/) ?? [])[1]?.replace(/,/g, '') ?? 0);
    if (cancelAt !== null && !cancelled && doneN >= cancelAt) { await page.getByRole('button', { name: 'Cancel batch' }).click(); cancelled = true; await sleep(1500); break; }
    if (reloadAt !== null && !reloaded && doneN >= reloadAt) { await page.reload({ waitUntil: 'load' }); reloaded = true; await sleep(3000); break; }
    if (done) break;
    if (Date.now() - t0 > 30 * 60 * 1000) { samples.push('TIMEOUT'); break; }
  }
  const lts = await page.evaluate((k) => window.__qaLongTasks.slice(k), lt0).catch(() => []);
  const r = {
    n, ms: Date.now() - t0, cancelled, reloaded,
    summary: (await page.locator('.batch-results .ui-alert').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300),
    foot: (await page.locator('.batch-foot').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300),
    state: (await page.locator('.batch-results').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300),
    runBtn: await page.getByRole('button', { name: /^Run [\d,]+ bouts/ }).count(),
    workersAfter: await workerCount(),
    longTasks: lts.length, longestTask: lts.reduce((a, b) => Math.max(a, b[1]), 0), sumLongTaskMs: lts.reduce((a, b) => a + b[1], 0),
    latMax: Math.max(...lat), latMedian: lat.sort((a, b) => a - b)[Math.floor(lat.length / 2)],
    heapMax: Math.max(...samples.filter((s) => s.heap).map((s) => s.heap)),
    newErrors: log.errors.slice(e0).map((s) => s.slice(0, 200)),
    samples: samples.filter((_, i) => i % 5 === 0).slice(0, 40),
  };
  res.runs.push(r);
  const { samples: _s, ...brief } = r;
  console.log(JSON.stringify(brief));
  return r;
}

await page.goto(BASE, { waitUntil: 'load' }); await sleep(1500);
res.cores = await page.evaluate(() => navigator.hardwareConcurrency);
const onlyBig = process.argv.includes('--only-big');
if (!onlyBig) {
await runBatchUi(100);
const a = await runBatchUi(1000);
const c = await runBatchUi(1000, { cancelAt: 300 });
// idle a moment: are the pool workers gone after cancel?
await sleep(3000); res.workersAfterCancel = await workerCount();
const b = await runBatchUi(1000);
res.fingerprintsMatch = a.foot === b.foot;
await runBatchUi(1000, { reloadAt: 250, seed: 'qa2-batch-reload' });
await sleep(4000);
res.afterReload = { workers: await workerCount(), m: await metrics(page, cdp, { gc: true }), batchText: (await page.locator('#panel-batch').innerText().catch(() => '')).slice(0, 100) };
console.log('afterReload', JSON.stringify(res.afterReload));
}
if (big) await runBatchUi(5000, { seed: 'qa2-batch-5000' });
res.final = await metrics(page, cdp, { gc: true });
res.report = await report('batch', log, page);
res.peakRam = peakRam();
save('batch', res);
console.log(JSON.stringify({ cores: res.cores, fingerprintsMatch: res.fingerprintsMatch, workersAfterCancel: res.workersAfterCancel, cancelState: res.runs.find((r) => r.cancelled)?.state, final: res.final, errors: res.report.errors.slice(0, 5), rej: res.report.rejections, peakRam: res.peakRam }, null, 1));
await close();
