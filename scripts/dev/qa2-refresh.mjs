// QA2 refresh: reload mid Match-setup run, mid Watch load, mid Watch playback, mid library save; check the app comes
// back clean (no errors, history intact, library intact, no orphan workers).
import { launch, metrics, nav, report, BASE, sleep } from './qa2-lib.mjs';
const { page, cdp, log, close } = await launch();
await cdp.send('Target.setDiscoverTargets', { discover: true }).catch(() => {});
const workers = async () => (await cdp.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'worker').length;
const cur = () => page.evaluate(() => document.querySelector('.nav-item[aria-current=page]')?.id);
const histCount = async () => { await nav(page, 'History'); await sleep(300); return (await page.locator('#panel-history').innerText()).match(/The last (\d+) bouts/)?.[1]; };
const out = {};
await page.goto(BASE, { waitUntil: 'load' }); await sleep(1500);
// one completed bout for a baseline
const pick = async (seed, teams) => {
  await nav(page, 'Match setup');
  if (teams) { await page.locator('.ms-mode', { hasText: 'Teams' }).click(); await page.selectOption('#ms-preset', '3v3'); }
  const n = await page.locator('select[id^=ms-slot-]').count();
  const A = ['arch.champion_complete', 'arch.brand_new_brawler', 'arch.pressure_boxer', 'arch.bjj_guard_player', 'arch.judoka', 'arch.counter_striker'];
  for (let i = 0; i < n; i++) await page.selectOption(`#ms-slot-${i}`, A[i]);
  await page.locator('#ms-seed').fill(seed);
};
await pick('qa2-refresh-base');
await page.getByRole('button', { name: 'Run bout' }).click();
for (let k = 0; k < 120; k++) { await sleep(500); if ((await cur()) === 'tab-result') break; }
out.histBase = await histCount();
// 1. reload mid run (long 3v3)
await pick('qa2-cancel-3v3', true);
await page.getByRole('button', { name: 'Run bout' }).click(); await sleep(400);
out.midRunWorkersBefore = await workers();
await page.reload({ waitUntil: 'load' }); await sleep(2500);
out.midRun = { workers: await workers(), hist: await histCount(), errors: log.errors.length };
// 2. reload mid Watch load, 3. mid playback
await page.goto(`${BASE}?watchDemo=1&quality=medium`, { waitUntil: 'load' }); await sleep(2500);
await page.reload({ waitUntil: 'load' });
try { await page.waitForFunction(() => window.__ttff?.revealMs > 0, null, { timeout: 150000 }); out.afterReloadMidLoad = 'revealed'; } catch { out.afterReloadMidLoad = 'stuck'; }
await page.evaluate(() => { window.__watch.speed(4); window.__watch.play(); }); await sleep(3000);
out.tickBefore = await page.evaluate(() => window.__watch.tick());
await page.reload({ waitUntil: 'load' });
try { await page.waitForFunction(() => window.__ttff?.revealMs > 0, null, { timeout: 150000 }); out.afterReloadMidPlay = 'revealed'; } catch { out.afterReloadMidPlay = 'stuck'; }
out.tickAfter = await page.evaluate(() => window.__watch.tick());
// 4. save to library then reload immediately; library must list it
await page.locator('.watch-replaybar button', { hasText: /^Save/ }).click();
await sleep(150);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__watch?.digest(), null, { timeout: 150000 }).catch(() => {});
await page.locator('.watch-replaybar button', { hasText: 'Library' }).click({ timeout: 60000 }).catch(() => {});
await sleep(1500);
out.libraryAfterSaveReload = (await page.locator('[role=dialog]').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 250);
await page.keyboard.press('Escape');
out.m = await metrics(page, cdp, { gc: true });
const r = await report('refresh', log, page);
out.errors = [...new Set(r.errors.map((e) => e.slice(0, 200)))]; out.rej = r.rejections;
console.log(JSON.stringify(out, null, 1));
await close();
