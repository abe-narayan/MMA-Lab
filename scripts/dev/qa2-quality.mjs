// QA2: (a) ?view=2d start then 3D; (b) same-presenter quality switching with live frame counters.
import { launch, report, OUT, BASE, sleep } from './qa2-lib.mjs';
const mode = process.argv[2] ?? 'switch'; const webgl = process.argv[3] === 'webgl2';
const { page, log, close } = await launch();
const out = { mode, webgl };
const frameCount = () => page.evaluate(() => { const r = window.__presenter?.stage?.renderer; return r?.info?.render?.frame ?? r?.info?.frame ?? null; });
const statsNow = () => page.evaluate(() => ({ level: window.__stats?.level, fps: window.__stats?.fps, ms: window.__stats?.frameMs, gpu: window.__stats?.gpuMs, draw: window.__stats?.drawCalls, tri: window.__stats?.triangles, w: window.__stats?.internalWidth }));
if (mode === '2dfirst') {
  await page.goto(`${BASE}?watchDemo=1&view=2d&quality=high${webgl ? '&backend=webgl2' : ''}`, { waitUntil: 'load' });
  await sleep(6000);
  await page.evaluate(() => { const d = document.querySelector('details.watch-settings'); if (d) d.open = true; });
  await page.getByRole('radio', { name: '3D broadcast' }).click();
  try { await page.waitForFunction(() => window.__ttff?.revealMs > 0, null, { timeout: 120000 }); out.ok = true; } catch { out.ok = false; }
} else {
  await page.goto(`${BASE}?watchDemo=1&quality=low&play=1${webgl ? '&backend=webgl2' : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ttff?.revealMs > 0, null, { timeout: 150000 });
  await page.evaluate(() => { const d = document.querySelector('details.watch-settings'); if (d) d.open = true; window.__watch.play(); });
  out.steps = [];
  for (const q of ['high', 'ultra', 'medium', 'low', 'ultra', 'high', 'low', 'medium', 'high', 'low', 'ultra', 'medium']) {
    const e0 = log.errors.length;
    await page.selectOption('select[aria-label="3D quality"]', q);
    await sleep(6000);
    const f1 = await frameCount(); await sleep(1000); const f2 = await frameCount();
    out.steps.push({ q, framesPerSec: f1 !== null ? f2 - f1 : null, ...(await statsNow()), errs: log.errors.length - e0, firstErr: log.errors[e0]?.slice(0, 160) });
  }
}
await page.screenshot({ path: `${OUT}/quality-${mode}${webgl ? '-webgl2' : ''}.png` });
const r = await report('q', log, page); out.errors = r.errors.length; out.longest = r.longestTask;
console.log(JSON.stringify(out, null, 0).replace(/},{/g, '},\n{'));
await close();
