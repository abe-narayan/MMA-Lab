#!/usr/bin/env node
/**
 * Camera-pass captures: several Watch-screen shots from ONE page load, written
 * as small PNGs (downscaled and colour-quantised in the page, so each stays
 * under ~300 KB for the docs).
 *
 *   node scripts/dev/heavy.mjs node scripts/dev/cam-shots.mjs <base-url> <out-prefix> <spec.json> [--size 1600x900] [--out 960x540] [--levels 24]
 *
 * `spec.json`: an array of shots, as `polish-shots.mjs` takes them:
 *   { "name": "main", "cam": "main", "event": "knockdown", "nth": 0, "offset": -20, "play": true, "waitMs": 2500,
 *     "replay": true }   // "replay": start the "last 8 s" replay before waiting
 * Prints one JSON line per shot (tick, size, the director's shot name).
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { captureGoto } from './capture-url.mjs';

const args = process.argv.slice(2);
const [base, prefix, specPath] = args;
if (!base || !prefix || !specPath) {
  console.error('usage: cam-shots.mjs <base-url> <out-prefix> <spec.json> [--size WxH] [--out WxH] [--levels N]');
  process.exit(2);
}
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const [w, h] = opt('size', '1600x900').split('x').map(Number);
const [ow, oh] = opt('out', '960x540').split('x').map(Number);
const levels = Number(opt('levels', '24'));
const spec = JSON.parse(readFileSync(specPath, 'utf8'));

const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
captureGoto(page); // ?capture=1: QA switches in production builds (capture-url.mjs)
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base, { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => document.querySelector('[data-phase="live"]') && window.__watch, null, { timeout: 240000 });
await page.waitForTimeout(1500);

try {
  for (const s of spec) {
    await page.waitForFunction(() => document.querySelector('[data-phase="live"]') && window.__watch, null, { timeout: 180000 });
    if (s.cam) await page.evaluate((c) => window.__watch.camera(c), s.cam);
    let seek = s.seek;
    if (s.event) {
      const evs = await page.evaluate(() => window.__watch.events());
      const list = s.event === 'end' ? [{ tick: Math.max(...evs.map((e) => e.tick)) }] : evs.filter((e) => e.kind === s.event);
      const e = list[s.nth ?? 0];
      if (!e) { console.log(JSON.stringify({ shot: s.name, skipped: `no ${s.event}` })); continue; }
      seek = e.tick + (s.offset ?? 0);
    }
    if (seek !== undefined) await page.evaluate((t) => window.__watch.seek(t), seek);
    await page.waitForTimeout(300);
    if (s.play) await page.evaluate(() => window.__watch.play());
    if (s.replay) await page.evaluate(() => window.__watch.replayLast());
    await page.waitForTimeout(s.waitMs ?? 2500);
    // The picture only (the 3D canvas), else the page.
    const canvas = await page.$('canvas');
    const buf = canvas ? await canvas.screenshot({ type: 'png' }) : await page.screenshot({ type: 'png' });
    const small = await page.evaluate(async ({ b64, ow, oh, levels }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = ow; c.height = oh;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, ow, oh);
      const d = g.getImageData(0, 0, ow, oh);
      const q = 255 / (levels - 1);
      for (let i = 0; i < d.data.length; i += 4) {
        for (let k = 0; k < 3; k++) d.data[i + k] = Math.round(Math.round(d.data[i + k] / q) * q);
      }
      g.putImageData(d, 0, 0);
      return c.toDataURL('image/png').split(',')[1];
    }, { b64: buf.toString('base64'), ow, oh, levels });
    const out = `${prefix}${s.name}.png`;
    const bytes = Buffer.from(small, 'base64');
    writeFileSync(out, bytes);
    const stats = await page.evaluate(() => ({ tick: window.__watch.tick(), shot: window.__stats?.camera ?? null })).catch(() => null);
    if (s.play) await page.evaluate(() => window.__watch.pause());
    console.log(JSON.stringify({ shot: s.name, out, kb: Math.round(bytes.length / 1024), stats }));
  }
} finally {
  if (errors.length) {
    console.log(`${errors.length} page error(s):`);
    for (const e of errors.slice(0, 8)) console.log('  ' + e.slice(0, 300));
  }
  await browser.close();
}
