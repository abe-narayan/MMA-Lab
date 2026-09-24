#!/usr/bin/env node
/**
 * Watch-screen load timeline: time to the live picture, main-thread long tasks
 * and the longest gap between painted frames while the loading card is up.
 *
 *   node scripts/dev/heavy.mjs node scripts/dev/load-timeline.mjs <url> <out.png> [--webgl] [--label text]
 *
 * Instruments the page before any script runs (PerformanceObserver 'longtask'
 * plus a requestAnimationFrame probe), waits for `[data-phase="live"]`, then
 * draws the timeline into a PNG (long tasks red, frame gaps > 100 ms amber,
 * phase marks from `window.__ttff`) and prints the numbers as JSON.
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const [url0, out] = args;
if (!url0 || !out) {
  console.error('usage: load-timeline.mjs <url> <out.png> [--webgl] [--label text]');
  process.exit(2);
}
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
let url = url0;
if (args.includes('--webgl')) url += (url.includes('?') ? '&' : '?') + 'backend=webgl2';
const label = opt('label', url);

const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.addInitScript(() => {
  const w = window;
  w.__lt = { tasks: [], gaps: [], frames: 0 };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) w.__lt.tasks.push([Math.round(e.startTime), Math.round(e.duration)]);
    }).observe({ type: 'longtask', buffered: true });
  } catch { /* no longtask support */ }
  let last = -1;
  const tick = (t) => {
    if (last >= 0 && t - last > 100) w.__lt.gaps.push([Math.round(last), Math.round(t - last)]);
    last = t;
    w.__lt.frames++;
    if (!document.querySelector('[data-phase="live"]')) requestAnimationFrame(tick);
    else w.__lt.liveAt = Math.round(t);
  };
  requestAnimationFrame(tick);
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => document.querySelector('[data-phase="live"]'), null, { timeout: 240000, polling: 500 });
await page.waitForTimeout(1500);
const r = await page.evaluate(() => ({
  lt: window.__lt,
  ttff: window.__ttff ?? null,
  backend: window.__stats?.backend ?? null,
  live: Math.round(performance.now()),
}));
const liveAt = r.lt.liveAt ?? r.live;
const longest = r.lt.tasks.reduce((m, t) => Math.max(m, t[1]), 0);
const blocked = r.lt.tasks.reduce((s, t) => s + t[1], 0);
const longestGap = r.lt.gaps.reduce((m, g) => Math.max(m, g[1]), 0);
const summary = {
  label, backend: r.backend, liveMs: liveAt, longestTaskMs: longest, totalLongTaskMs: blocked,
  longTasks: r.lt.tasks.length, longestFrameGapMs: longestGap, ttff: r.ttff,
};

// Draw the timeline in a blank page.
await page.setContent('<html><body style="margin:0;background:#0d1015"><canvas id="c" width="1600" height="360"></canvas></body></html>');
await page.evaluate(({ s, tasks, gaps }) => {
  const c = document.getElementById('c');
  const g = c.getContext('2d');
  const W = 1600, x0 = 40, x1 = W - 40;
  const span = Math.max(1000, Math.ceil(s.liveMs / 1000) * 1000 + 1000);
  const X = (ms) => x0 + (ms / span) * (x1 - x0);
  g.fillStyle = '#0d1015'; g.fillRect(0, 0, W, 360);
  g.fillStyle = '#e2c26b'; g.font = '600 20px sans-serif';
  g.fillText(`${s.label}  (${s.backend})`, x0, 34);
  g.fillStyle = '#c9d1da'; g.font = '15px sans-serif';
  g.fillText(`live ${(s.liveMs / 1000).toFixed(1)} s · longest main-thread task ${(s.longestTaskMs / 1000).toFixed(2)} s · long tasks total ${(s.totalLongTaskMs / 1000).toFixed(1)} s · longest frame gap ${(s.longestFrameGapMs / 1000).toFixed(2)} s`, x0, 62);
  g.strokeStyle = '#39414c';
  for (let t = 0; t <= span; t += 1000) {
    g.beginPath(); g.moveTo(X(t), 90); g.lineTo(X(t), 300); g.stroke();
    g.fillStyle = '#8a939e'; g.fillText(`${t / 1000}s`, X(t) - 8, 320);
  }
  g.fillStyle = '#8a939e'; g.fillText('long tasks', x0, 110);
  g.fillStyle = '#d6453d';
  for (const [st, d] of tasks) g.fillRect(X(st), 118, Math.max(2, X(st + d) - X(st)), 48);
  g.fillStyle = '#8a939e'; g.fillText('frame gaps > 100 ms (loading card frozen)', x0, 196);
  g.fillStyle = '#e0a526';
  for (const [st, d] of gaps) g.fillRect(X(st), 204, Math.max(2, X(st + d) - X(st)), 48);
  const t = s.ttff || {};
  const m0 = t.mountMs ?? 0;
  const marks = [['mount', m0], ['device', m0 + (t.deviceMs ?? 0)], ['bout built', m0 + (t.deviceMs ?? 0) + (t.boutMs ?? 0)],
    ['compiled', m0 + (t.deviceMs ?? 0) + (t.boutMs ?? 0) + (t.compileMs ?? 0)], ['live', s.liveMs]];
  g.fillStyle = '#7fc8a9';
  for (const [n, ms] of marks) {
    if (!(ms > 0)) continue;
    g.fillRect(X(ms) - 1, 84, 2, 180);
    g.fillText(n, X(ms) + 4, 280);
  }
}, { s: summary, tasks: r.lt.tasks, gaps: r.lt.gaps });
await page.locator('#c').screenshot({ path: out });
console.log(JSON.stringify(summary));
if (errors.length) console.log('page errors:', errors.slice(0, 5));
await browser.close();
