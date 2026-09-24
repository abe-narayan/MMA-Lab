// QA2 probe: load a URL, wait, and print errors (deduped, full text), reloads, failed responses and stats.
import { launch, metrics, report, OUT, BASE, sleep } from './qa2-lib.mjs';
const url = BASE + (process.argv[2] ?? '?watchDemo=1');
const waitS = Number(process.argv[3] ?? 60);
const { page, cdp, log, close } = await launch();
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
const t0 = Date.now(); const samples = [];
while (Date.now() - t0 < waitS * 1000) { await sleep(5000); samples.push([(Date.now() - t0) / 1000 | 0, await page.evaluate(() => window.__stats ? `${window.__stats.backend} ${window.__stats.level} fps${window.__stats.fps} ${window.__stats.frameMs}ms gpu${window.__stats.gpuMs}` : 'no-stats')]); }
const r = await report('probe', log, page);
console.log('samples', JSON.stringify(samples));
console.log('navs', JSON.stringify(r.navs)); console.log('bad', JSON.stringify(r.badResponses));
const uniq = new Map(); for (const e of r.errors) { const k = e.slice(0, 90); uniq.set(k, (uniq.get(k) ?? [0, e])); uniq.get(k)[0]++; }
for (const [k, [n, e]] of uniq) console.log(`x${n}: ${e.slice(0, 700)}`);
console.log('warnings', r.warnings.filter((w) => !w.includes('powerPreference')).slice(0, 6).join('\n'));
console.log('m', JSON.stringify(await metrics(page, cdp)), 'ttff', JSON.stringify(await page.evaluate(() => window.__ttff)));
await page.screenshot({ path: `${OUT}/probe.png` });
await close();
