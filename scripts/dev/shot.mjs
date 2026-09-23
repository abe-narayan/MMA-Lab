#!/usr/bin/env node
/**
 * Capture a screenshot of a page rendered on the machine's real GPU.
 *
 *   node scripts/dev/shot.mjs <url> <out.png> [--size 1920x1080] [--wait 3000]
 *        [--until "window.__ready === true"] [--eval "window.__cam('cageside')"]
 *        [--webgl]   force the WebGL2 path (adds ?backend=webgl2 to the URL)
 *        [--console] print the page's console output
 *
 * Headless Chromium falls back to SwiftShader (software rendering) by default,
 * which makes every render look wrong and run at a few frames per second. This
 * launches Chromium's new headless mode on ANGLE/Direct3D 11 with WebGPU
 * enabled, which uses the Intel Arc 140V exactly as a user's browser would, so a
 * screenshot shows what the user will see and a frame-time reading means
 * something. The page must be served from localhost: WebGPU only exists in
 * secure contexts.
 *
 * Prints backend, GPU, and any `window.__stats` the page exposes.
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const url0 = args[0];
const out = args[1];
if (!url0 || !out) {
  console.error('usage: node scripts/dev/shot.mjs <url> <out.png> [--size WxH] [--wait ms] [--until expr] [--eval expr] [--webgl] [--console]');
  process.exit(2);
}
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(`--${name}`);

const [w, h] = opt('size', '1920x1080').split('x').map(Number);
const wait = Number(opt('wait', '2500'));
const until = opt('until', null);
const evalExpr = opt('eval', null);
let url = url0;
if (flag('webgl')) url += (url.includes('?') ? '&' : '?') + 'backend=webgl2';

const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'load', timeout: 120000 });
if (until) await page.waitForFunction(until, null, { timeout: 120000 });
if (evalExpr) await page.evaluate(evalExpr);
await page.waitForTimeout(wait);
await page.screenshot({ path: out });

const stats = await page.evaluate(() => window.__stats ?? null).catch(() => null);
const gpu = await page.evaluate(async () => {
  const a = navigator.gpu ? await navigator.gpu.requestAdapter() : null;
  return a ? `webgpu-capable (${a.info?.architecture ?? '?'})` : 'webgpu-unavailable';
}).catch(() => 'unknown');
console.log(`saved ${out}  ${w}x${h}  ${gpu}${stats ? `  stats=${JSON.stringify(stats)}` : ''}`);
const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
if (flag('console')) for (const l of logs) console.log(l);
else if (errors.length) { console.log(`${errors.length} console error(s):`); for (const l of errors.slice(0, 8)) console.log('  ' + l); }
await browser.close();
