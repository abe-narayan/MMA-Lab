// QA2: 3D -> 2D -> 3D toggle on the Watch screen. Does the 3D view come back?
// node scripts/dev/heavy.mjs node scripts/dev/qa2-toggle.mjs <quality> [webgl2] [cycles]
import { launch, report, OUT, BASE, sleep } from './qa2-lib.mjs';
const q = process.argv[2] ?? 'high'; const webgl = process.argv[3] === 'webgl2'; const cycles = Number(process.argv[4] ?? 2);
const { page, log, close } = await launch();
await page.goto(`${BASE}?watchDemo=1&quality=${q}${webgl ? '&backend=webgl2' : ''}`, { waitUntil: 'load' });
const ready = async (ms) => {
  try { await page.waitForFunction(() => window.__ttff?.revealMs > 0 && !document.body.innerText.includes('PREPARING BROADCAST') && !/Preparing broadcast/i.test(document.querySelector('.watch-stage, .arena3d, main')?.innerText ?? ''), null, { timeout: ms }); return true; } catch { return false; }
};
const out = { q, webgl, first: await ready(150000), cycles: [] };
out.backend = await page.evaluate(() => window.__stats?.backend);
for (let c = 0; c < cycles; c++) {
  const e0 = log.errors.length;
  await page.evaluate(() => { const d = document.querySelector('details.watch-settings'); if (d) d.open = true; window.__ttff = undefined; });
  await page.getByRole('radio', { name: '2D board' }).click(); await sleep(2500);
  await page.getByRole('radio', { name: '3D broadcast' }).click();
  const t0 = Date.now(); const ok = await ready(90000);
  const overlay = await page.evaluate(() => (document.body.innerText.match(/PREPARING BROADCAST[^\n]*\n?[^\n]*\n?[^\n]*/i) ?? [''])[0].replace(/\n/g, ' / '));
  out.cycles.push({ ok, ms: Date.now() - t0, newErrors: log.errors.length - e0, overlay, first: log.errors.slice(e0, e0 + 1).map((s) => s.slice(0, 260)) });
}
await page.screenshot({ path: `${OUT}/toggle-${q}${webgl ? '-webgl2' : ''}.png` });
const r = await report('toggle', log, page);
out.totalErrors = r.errors.length; out.navs = r.navs.length;
console.log(JSON.stringify(out, null, 1));
await close();
