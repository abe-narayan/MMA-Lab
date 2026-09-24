#!/usr/bin/env node
/**
 * React render cost of the Watch screen during playback (Watch/replay pass).
 *
 *   node scripts/dev/heavy.mjs node scripts/dev/watch-profile.mjs "<base-url>" [--seconds 8] [--speeds 1,4]
 *
 * Opens the Watch page with `profile=1` (React <Profiler> accounting in
 * components/watch/profile.tsx), waits for the broadcast to be live, then for
 * each speed: seeks to the start, resets the counters, plays for `seconds`,
 * pauses and prints commits/s and render ms/s per profiled region, plus the
 * main thread's long tasks (> 50 ms) in that window. Same GPU flags as
 * scripts/dev/shot.mjs. One browser; run it through heavy.mjs.
 */
import { chromium } from 'playwright';
import { captureGoto } from './capture-url.mjs';

const args = process.argv.slice(2);
const base = args[0];
if (!base) {
  console.error('usage: watch-profile.mjs <base-url> [--seconds N] [--speeds 1,4] [--size WxH]');
  process.exit(2);
}
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const seconds = Number(opt('seconds', '8'));
const speeds = opt('speeds', '1,4').split(',').map(Number);
const [w, h] = opt('size', '1600x900').split('x').map(Number);
const url = base + (base.includes('?') ? '&' : '?') + 'profile=1';

const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
captureGoto(page); // ?capture=1: QA switches in production builds (capture-url.mjs)
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__watch && (document.querySelector('[data-phase="live"]') || document.querySelector('.watch-stage--2d')), null, { timeout: 180000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  window.__longTasks = [];
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longTasks.push(e.duration); })
      .observe({ type: 'longtask', buffered: false });
  } catch { /* not supported */ }
});

for (const speed of speeds) {
  await page.evaluate(() => window.__watch.pause());
  await page.evaluate(() => window.__watch.seek(0));
  const set = await page.evaluate((s) => {
    if (typeof window.__watch.speed === 'function') { window.__watch.speed(s); return 'hook'; }
    const label = `${s}×`;
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === label);
    if (b) { b.click(); return 'button'; }
    return 'none';
  }, speed);
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__watchProfile?.reset(); window.__longTasks = []; });
  const t0 = await page.evaluate(() => window.__watch.tick());
  await page.evaluate(() => window.__watch.play());
  await page.waitForTimeout(seconds * 1000);
  await page.evaluate(() => window.__watch.pause());
  const r = await page.evaluate(() => ({
    regions: window.__watchProfile?.regions ?? {},
    tick: window.__watch.tick(),
    longTasks: window.__longTasks ?? [],
  }));
  const per = {};
  for (const [id, v] of Object.entries(r.regions)) {
    per[id] = { commitsPerS: +(v.commits / seconds).toFixed(1), renderMsPerS: +(v.ms / seconds).toFixed(2), msPerCommit: v.commits ? +(v.ms / v.commits).toFixed(2) : 0 };
  }
  console.log(JSON.stringify({
    speed, speedSetBy: set, seconds, ticksPlayed: r.tick - t0, regions: per,
    longTasks: r.longTasks.length, longestTaskMs: r.longTasks.length ? Math.round(Math.max(...r.longTasks)) : 0,
  }));
}
if (errors.length) console.log(`${errors.length} page error(s): ${errors.slice(0, 3).join(' | ')}`);
await browser.close();
