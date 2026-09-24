/**
 * QA2 browser harness: launches headless Chromium on the real GPU (ANGLE/D3D11 + WebGPU, as shot.mjs does),
 * records console errors / page errors / unhandled rejections, samples heap / DOM / listeners via CDP,
 * and runs a machine RAM watchdog that aborts the run above the 93 % cap.
 *
 * Always run through the governor:  node scripts/dev/heavy.mjs node scripts/dev/qa2-<x>.mjs
 */
import { chromium } from 'playwright';
import { freemem, totalmem } from 'node:os';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { captureGoto } from './capture-url.mjs';
const MIME = { js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', html: 'text/html', json: 'application/json', wasm: 'application/wasm', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', hdr: 'application/octet-stream', bin: 'application/octet-stream', ktx2: 'image/ktx2', glb: 'model/gltf-binary' };

// QA2_SNAP=1 serves a production build (scratchpad/snap, from `vite build --outDir`) through request interception
// at http://localhost:5199/ -- no server process -- so HMR churn from other agents can't disturb long runs.
export const SNAP = process.env.QA2_SNAP ? 'C:/Users/abena/AppData/Local/Temp/claude/C--Users-abena-Downloads-bout-lab-repo-mma-sim/4b478565-865d-498a-bfaf-9a2cdb49bb77/scratchpad/' + (process.env.QA2_SNAP === '1' ? 'snap' : process.env.QA2_SNAP) : null;
export const BASE = SNAP ? 'http://localhost:5199/' : (process.env.QA2_BASE ?? 'http://127.0.0.1:5180/');
export const OUT = 'C:/Users/abena/AppData/Local/Temp/claude/C--Users-abena-Downloads-bout-lab-repo-mma-sim/4b478565-865d-498a-bfaf-9a2cdb49bb77/scratchpad/qa2';
mkdirSync(OUT, { recursive: true });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const ramPct = () => 100 * (1 - freemem() / totalmem());

export async function launch({ width = 1440, height = 900, webgpu = true } = {}) {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
    args: webgpu
      ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-precise-memory-info']
      : ['--enable-precise-memory-info'],
  });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, acceptDownloads: true });
  if (SNAP) {
    await context.route('http://localhost:5199/**', (route) => {
      const u = new URL(route.request().url());
      let f = SNAP + decodeURIComponent(u.pathname);
      if (u.pathname === '/' || !existsSync(f) || statSync(f).isDirectory()) f = existsSync(f) && !statSync(f).isDirectory() ? f : SNAP + '/index.html';
      if (!existsSync(f)) return route.fulfill({ status: 404, body: 'not found' });
      const ext = f.split('.').pop().toLowerCase();
      return route.fulfill({ status: 200, body: readFileSync(f), headers: { 'content-type': MIME[ext] ?? 'application/octet-stream' } });
    });
  }
  const page = await context.newPage();
  captureGoto(page); // ?capture=1: QA switches in production builds (capture-url.mjs)
  const log = { console: [], errors: [], warnings: [] };
  page.on('console', (m) => {
    const t = `[${m.type()}] ${m.text()}`.slice(0, 600);
    log.console.push(t);
    if (m.type() === 'error') log.errors.push(t);
    if (m.type() === 'warning') log.warnings.push(t);
  });
  page.on('pageerror', (e) => log.errors.push(`[pageerror] ${e.message}\n${(e.stack ?? '').split('\n').slice(0, 4).join('\n')}`));
  page.on('crash', () => log.errors.push('[crash] page crashed'));
  log.navs = []; log.badResponses = [];
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) log.navs.push([new Date().toISOString().slice(11, 19), f.url().slice(0, 120)]); });
  page.on('response', (r) => { if (r.status() >= 400) log.badResponses.push(`${r.status()} ${r.url().slice(0, 160)}`); });
  await page.addInitScript(() => {
    window.__qaRejections = [];
    window.addEventListener('unhandledrejection', (e) => {
      window.__qaRejections.push(String(e.reason?.stack ?? e.reason).slice(0, 400));
    });
    window.__qaLongTasks = [];
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__qaLongTasks.push([Math.round(e.startTime), Math.round(e.duration)]); })
        .observe({ type: 'longtask', buffered: true });
    } catch { /* unsupported */ }
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  let peakRam = ramPct();
  const watchdog = setInterval(() => {
    const r = ramPct();
    peakRam = Math.max(peakRam, r);
    if (r > Number(process.env.QA2_RAM_CAP ?? 90)) {
      console.error(`[qa2] machine RAM ${r.toFixed(1)}% > cap: aborting run`);
      browser.close().finally(() => process.exit(4));
    }
  }, 1000);
  const close = async () => { clearInterval(watchdog); await browser.close().catch(() => {}); };
  return { browser, context, page, cdp, log, close, peakRam: () => peakRam };
}

/** Heap (MB), DOM nodes, listeners, documents, frames via CDP; optional forced GC first. */
export async function metrics(page, cdp, { gc = false } = {}) {
  if (gc) { try { await cdp.send('HeapProfiler.collectGarbage'); } catch { /* */ } await sleep(300); }
  const { metrics: m } = await cdp.send('Performance.getMetrics');
  const g = (n) => m.find((x) => x.name === n)?.value ?? 0;
  const extra = await page.evaluate(() => {
    const s = window.__stats;
    const p = window.__presenter;
    let gpu = null;
    try {
      const info = p?.stage?.renderer?.info ?? p?.renderer?.info ?? null;
      if (info) gpu = { geometries: info.memory?.geometries, textures: info.memory?.textures, programs: info.programs?.length ?? info.memory?.programs };
    } catch { /* */ }
    return {
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1e6).toFixed(1) : null,
      rejections: (window.__qaRejections ?? []).length,
      longTasks: (window.__qaLongTasks ?? []).length,
      stats: s ? { backend: s.backend, fps: s.fps, frameMs: s.frameMs, draw: s.drawCalls, level: s.level, gpuMs: s.gpuMs } : null,
      gpu,
      canvases: document.querySelectorAll('canvas').length,
    };
  }).catch(() => ({}));
  return {
    jsHeapMB: +(g('JSHeapUsedSize') / 1e6).toFixed(1),
    nodes: g('Nodes'), listeners: g('JSEventListeners'), documents: g('Documents'), frames: g('Frames'),
    ...extra, ram: +ramPct().toFixed(1),
  };
}

const IDS = { 'Match setup': 'match', 'Batch simulation': 'batch', Tournaments: 'tournaments', Watch: 'watch', Result: 'result', History: 'history', Fighters: 'fighters', 'Fighter editor': 'creator', 'About the model': 'model' };
export async function nav(page, label) {
  await page.locator(`#tab-${IDS[label] ?? label}`).click();
  await page.waitForTimeout(500);
}

export function save(name, obj) {
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify(obj, null, 2));
}

export function report(tag, log, page) {
  return page.evaluate(() => ({ rej: window.__qaRejections ?? [], lt: window.__qaLongTasks ?? [] })).catch(() => ({ rej: [], lt: [] }))
    .then(({ rej, lt }) => {
      const r = { tag, navs: log.navs, badResponses: log.badResponses, errors: log.errors, rejections: rej, warnings: log.warnings.slice(0, 30), longTasks: lt.length, longestTask: lt.reduce((a, b) => Math.max(a, b[1]), 0) };
      return r;
    });
}
