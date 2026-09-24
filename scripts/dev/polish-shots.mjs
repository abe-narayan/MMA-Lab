#!/usr/bin/env node
/**
 * Several Watch-screen captures from ONE page load (shaders compile once).
 *
 *   node scripts/dev/heavy.mjs node scripts/dev/polish-shots.mjs <base-url> <out-prefix> <spec.json> [--size 1920x1080]
 *
 * `spec.json` is an array of shots, captured in order:
 *   { "name": "referee", "seek": 1200, "cam": "broadcast", "play": false, "waitMs": 2500,
 *     "eval": "optional page expression run before waiting" }
 * or, instead of "seek", "event": "knockdown" | "roundEnd" | "end" …, "nth": 0, "offset": -4
 * (ticks relative to that event), so the spec survives changes to the bout.
 * Output: `<out-prefix><name>.png`, plus one JSON line per shot with `window.__stats`.
 * Uses the Watch screen's `window.__watch` QA hook (seek/play/pause/camera).
 * Same GPU flags as scripts/dev/shot.mjs (ANGLE D3D11 + WebGPU on the real GPU).
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const [base, prefix, specPath] = args;
if (!base || !prefix || !specPath) {
  console.error('usage: polish-shots.mjs <base-url> <out-prefix> <spec.json> [--size WxH] [--webgl]');
  process.exit(2);
}
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const [w, h] = opt('size', '1920x1080').split('x').map(Number);
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
let url = base;
if (args.includes('--webgl')) url += (url.includes('?') ? '&' : '?') + 'backend=webgl2';

const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => document.querySelector('[data-phase="live"]') && window.__watch, null, { timeout: 180000 });
await page.waitForTimeout(1500);

for (const s of spec) {
  // The dev server may reload the page (another edit landed): wait for the picture again.
  await page.waitForFunction(() => document.querySelector('[data-phase="live"]') && window.__watch, null, { timeout: 180000 });
  if (s.cam) await page.evaluate((c) => window.__watch.camera(c), s.cam);
  let seek = s.seek;
  if (s.event) {
    // Seek relative to the nth event of a kind ('end' = the last recorded tick).
    const evs = await page.evaluate(() => window.__watch.events());
    const list = s.event === 'end' ? [{ tick: Math.max(...evs.map((e) => e.tick)) }] : evs.filter((e) => e.kind === s.event);
    const e = list[s.nth ?? 0];
    if (!e) { console.log(JSON.stringify({ shot: s.name, skipped: `no ${s.event}` })); continue; }
    seek = e.tick + (s.offset ?? 0);
  }
  if (seek !== undefined) await page.evaluate((t) => window.__watch.seek(t), seek);
  await page.waitForTimeout(300);
  if (s.play) await page.evaluate(() => window.__watch.play());
  if (s.eval) await page.evaluate(s.eval);
  await page.waitForTimeout(s.waitMs ?? 2500);
  const out = `${prefix}${s.name}.png`;
  await page.screenshot({ path: out });
  const stats = await page.evaluate(() => ({ tick: window.__watch.tick(), skinFix: window.__skinVelocityFix, ...(window.__stats ?? {}) })).catch(() => null);
  // "bench": GPU-bound ms per frame (back-to-back renders, vsync-independent).
  const benchMs = s.bench ? await page.evaluate(() => window.__presenter?.stage?.benchmark?.(60)).catch(() => null) : undefined;
  if (s.play) await page.evaluate(() => window.__watch.pause());
  console.log(JSON.stringify({ shot: s.name, out, benchMs, stats }));
}
if (errors.length) {
  console.log(`${errors.length} console error(s):`);
  for (const e of errors.slice(0, 8)) console.log('  ' + e.slice(0, 300));
}
await browser.close();
