#!/usr/bin/env node
/**
 * The in-app 5,000-bout batch, run once, headless, and watched.
 *
 *   node scripts/dev/heavy.mjs node scripts/dev/ui-batch5000.mjs [--bouts 5000] [--out docs/screenshots/ui-after-batch-5000.png]
 *
 * Opens the Batch screen on the shared dev server, picks the default matchup,
 * sets the bout count, runs it through the app's own worker pool and polls
 * every 20 s: bouts done, the page's JS heap, and machine RAM/CPU. If machine
 * RAM crosses the 93 % cap it cancels the batch from the UI (the Cancel
 * button) and exits non-zero. Writes a screenshot of the final results.
 */
import { chromium } from 'playwright';
import { cpus, freemem, totalmem } from 'node:os';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const bouts = Number(opt('bouts', '5000'));
const out = opt('out', 'docs/screenshots/ui-after-batch-5000.png');
const workers = opt('workers', null);
const CAP = 0.93;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function cpuBusy() {
  const a = cpus().map((c) => c.times);
  await sleep(1000);
  const b = cpus().map((c) => c.times);
  let idle = 0; let total = 0;
  for (let i = 0; i < a.length; i++) {
    const da = Object.values(a[i]).reduce((x, y) => x + y, 0);
    const db = Object.values(b[i]).reduce((x, y) => x + y, 0);
    total += db - da; idle += b[i].idle - a[i].idle;
  }
  return total > 0 ? 1 - idle / total : 0;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const reloads = [];
page.on('framenavigated', (f) => { if (f === page.mainFrame()) reloads.push(Date.now()); });

// The dev server is shared: another agent's source edit would hot-reload the
// page and wipe the batch. Replace Vite's HMR client with an inert stub so this
// page never reloads (styles still apply; only live updates are disabled).
await page.route('**/@vite/client', (route) => route.fulfill({
  contentType: 'application/javascript',
  body: `const styles = new Map();
export function updateStyle(id, css) { let el = styles.get(id); if (!el) { el = document.createElement('style'); el.setAttribute('data-vite-dev-id', id); document.head.appendChild(el); styles.set(id, el); } el.textContent = css; }
export function removeStyle(id) { styles.get(id)?.remove(); styles.delete(id); }
export function injectQuery(url) { return url; }
export class ErrorOverlay extends (globalThis.HTMLElement ?? class {}) {}
export function createHotContext() { const noop = () => {}; return { accept: noop, acceptExports: noop, dispose: noop, prune: noop, invalidate: noop, on: noop, off: noop, send: noop, data: {} }; }`,
}));
await page.goto('http://127.0.0.1:5180/', { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(1200);
await page.locator('nav.nav').getByRole('button', { name: 'Batch simulation', exact: true }).click();
await page.waitForTimeout(800);
if (workers) await page.getByLabel('Workers', { exact: true }).selectOption(String(workers));
const preset = String(bouts) === '5000' ? '5,000' : null;
if (preset) await page.getByRole('radio', { name: preset }).click();
else {
  await page.getByRole('radio', { name: 'Custom' }).click();
  await page.locator('.batch-custom').fill(String(bouts));
}
reloads.length = 0;
const t0 = Date.now();
await page.getByRole('button', { name: /^Run [\d,]+ bouts/ }).click();
let maxRam = 0; let maxCpu = 0; let maxHeap = 0; let aborted = false;
let lastProgress = ''; let stalls = 0; let cpuHigh = 0;
for (;;) {
  await sleep(20000);
  const done = await page.getByRole('button', { name: 'Export CSV' }).count();
  const ram = 1 - freemem() / totalmem();
  const cpu = await cpuBusy();
  const heap = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize / 1e6 : 0)).catch(() => 0);
  const progress = await page.locator('.batch-progress-stats').innerText().catch(() => '');
  maxRam = Math.max(maxRam, ram); maxCpu = Math.max(maxCpu, cpu); maxHeap = Math.max(maxHeap, heap);
  console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s  RAM ${(ram * 100).toFixed(0)}%  CPU ${(cpu * 100).toFixed(0)}%  page heap ${heap.toFixed(0)} MB  ${progress.replace(/\s+/g, ' ')}`);
  if (done) break;
  // A dev-server reload (HMR) or a hung page would otherwise wait forever.
  if (reloads.length > 0) { console.log('The page reloaded during the run (a source edit?); aborting.'); aborted = true; break; }
  if (progress === lastProgress) stalls += 1; else stalls = 0;
  lastProgress = progress;
  if (stalls >= 6) { console.log('No progress for two minutes; aborting.'); aborted = true; break; }
  if (cpu > CAP) cpuHigh += 1; else cpuHigh = 0;
  if (cpuHigh >= 2) {
    console.log('Machine CPU above the 93% cap twice running: cancelling the batch.');
    await page.getByRole('button', { name: 'Cancel batch' }).click();
    aborted = true;
    break;
  }
  if (ram > CAP) {
    console.log('RAM above the 93% cap: cancelling the batch.');
    await page.getByRole('button', { name: 'Cancel batch' }).click();
    aborted = true;
    break;
  }
}
await page.waitForTimeout(800);
const summary = await page.locator('.batch-results .ui-alert').first().innerText().catch(() => '');
const fp = await page.locator('.batch-foot').innerText().catch(() => '');
await page.screenshot({ path: out, fullPage: false });
console.log(`finished in ${((Date.now() - t0) / 1000).toFixed(0)} s; ${summary}`);
console.log(fp);
console.log(`peak machine RAM ${(maxRam * 100).toFixed(0)}%, peak CPU ${(maxCpu * 100).toFixed(0)}%, peak page heap ${maxHeap.toFixed(0)} MB`);
if (errors.length) console.log('page errors:', errors.slice(0, 5));
await browser.close();
process.exit(aborted ? 3 : 0);
