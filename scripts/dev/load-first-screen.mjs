#!/usr/bin/env node
/**
 * First-screen load cost of a production build: JavaScript fetched before the
 * first screen is usable (raw and gzip), first contentful paint, "ready" (the
 * Match setup Run button is on screen) and time to interactive.
 *
 *   npx vite build --outDir <dir>
 *   node scripts/dev/heavy.mjs node scripts/dev/load-first-screen.mjs <dir> [--runs 3] [--label text]
 *
 * The build is served by a small static server started here (gzip for text,
 * like any real host), on a random port, so the shared dev server and its hot
 * reloads are never involved. Each run is a fresh browser context (empty
 * cache). Two profiles:
 *   - desktop: no throttling;
 *   - slow: DevTools "Fast 4G"-like network (9 Mbit/s down, 150 ms RTT) and 4x CPU slowdown.
 *
 * Time to interactive (TTI) here is the end of the last main-thread long task
 * (> 50 ms) that starts before a 2 s quiet window following "ready", or
 * "ready" itself when nothing long runs after it. It is a lab proxy for
 * Lighthouse's TTI, consistent between builds, which is what a before/after
 * needs.
 *
 * Prints one JSON object per profile with the median over the runs.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const dir = args[0] ? resolve(args[0]) : null;
if (!dir || !existsSync(join(dir, 'index.html'))) {
  console.error('usage: load-first-screen.mjs <buildDir> [--runs N] [--label text]');
  process.exit(2);
}
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const RUNS = Number(opt('runs', 3));
const LABEL = opt('label', dir);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.bin': 'application/octet-stream', '.ktx2': 'image/ktx2', '.woff2': 'font/woff2',
};
const TEXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg']);
const gz = new Map();

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let file = join(dir, decodeURIComponent(url.pathname));
  if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) file = join(dir, 'index.html');
  const ext = extname(file).toLowerCase();
  const headers = { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': 'no-store' };
  let body = readFileSync(file);
  if (TEXT.has(ext) && /gzip/.test(String(req.headers['accept-encoding'] ?? ''))) {
    if (!gz.has(file)) gz.set(file, gzipSync(body, { level: 9 }));
    body = gz.get(file);
    headers['content-encoding'] = 'gzip';
  }
  res.writeHead(200, headers);
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const PROFILES = {
  desktop: null,
  slow: { cpu: 4, net: { offline: false, latency: 150, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 } },
};

const browser = await chromium.launch({ headless: true, channel: 'chromium' });

async function once(profile) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (profile) {
    await cdp.send('Network.emulateNetworkConditions', profile.net);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
  }
  await page.addInitScript(() => {
    window.__lt = [];
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]);
    }).observe({ type: 'longtask', buffered: true });
  });
  // Transfer sizes come from CDP (encoded bytes on the wire) so they include
  // the gzip the server applied.
  const wire = new Map();
  cdp.on('Network.responseReceived', (e) => wire.set(e.requestId, { url: e.response.url, type: e.type }));
  cdp.on('Network.loadingFinished', (e) => {
    const w = wire.get(e.requestId);
    if (w) w.bytes = e.encodedDataLength;
  });

  await page.goto(base, { waitUntil: 'commit' });
  await page.waitForSelector('text=Run bout', { timeout: 120000 });
  const ready = await page.evaluate(() => performance.now());
  // Wait for a 2 s quiet window after ready (or 20 s max).
  const t0 = Date.now();
  for (;;) {
    await page.waitForTimeout(250);
    const quiet = await page.evaluate(() => {
      const last = window.__lt.reduce((m, [s, d]) => Math.max(m, s + d), 0);
      return performance.now() - Math.max(last, 0);
    });
    if (quiet > 2000 || Date.now() - t0 > 20000) break;
  }
  const m = await page.evaluate((readyAt) => {
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null;
    const lt = window.__lt.filter(([s]) => s + 0 >= 0);
    const lastEnd = lt.reduce((mx, [s, d]) => Math.max(mx, s + d), 0);
    const js = performance.getEntriesByType('resource').filter((r) => /\.js(\?|$)/.test(r.name))
      .map((r) => ({ name: r.name.split('/').pop(), decoded: r.decodedBodySize, start: r.startTime }));
    return { fcp, ready: readyAt, tti: Math.max(readyAt, lastEnd), longTasks: lt.length, longTaskMs: lt.reduce((a, [, d]) => a + d, 0), js };
  }, ready);
  const jsWire = [...wire.values()].filter((w) => /\.js(\?|$)/.test(w.url));
  m.jsFiles = jsWire.map((w) => w.url.split('/').pop());
  m.jsGzipBytes = jsWire.reduce((a, w) => a + (w.bytes ?? 0), 0);
  m.jsRawBytes = m.js.reduce((a, r) => a + r.decoded, 0);
  delete m.js;
  await context.close();
  return m;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const out = { label: LABEL };
for (const [name, profile] of Object.entries(PROFILES)) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await once(profile));
  out[name] = {
    jsFiles: runs[0].jsFiles,
    jsRawKB: +(runs[0].jsRawBytes / 1024).toFixed(1),
    jsGzipKB: +(runs[0].jsGzipBytes / 1024).toFixed(1),
    fcpMs: Math.round(median(runs.map((r) => r.fcp ?? NaN))),
    readyMs: Math.round(median(runs.map((r) => r.ready))),
    ttiMs: Math.round(median(runs.map((r) => r.tti))),
    longTaskMs: Math.round(median(runs.map((r) => r.longTaskMs))),
    runs: runs.map((r) => Math.round(r.tti)),
  };
}
console.log(JSON.stringify(out, null, 2));
await browser.close();
server.close();
