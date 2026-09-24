#!/usr/bin/env node
/**
 * Same-frame visual A/B of the performance pass: each shot is captured twice from one page load,
 * with the pre-pass paths (three's DoF node and separate RCAS pass, ungated skin, fixed 0.4 m GTAO
 * radius; `stagePost=abLegacy:1`) and with the current ones, then composed side by side
 * (legacy left, current right) and downscaled to keep the PNG small.
 *
 *   node scripts/dev/heavy.mjs node scripts/dev/perf-compare-shots.mjs <base-url> <out-prefix> [--shots cageside,corner]
 *        [--crop x,y,w,h]   crop (fractions of the picture) for a detail view  [--width 800]  panel width
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const [base, prefix] = args;
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
let url = base;
const add = (kv) => { url += (url.includes('?') ? '&' : '?') + kv; };
add('stagePost=abLegacy:1'); add('fixedRes=1'); if (!/quality=/.test(url)) add('quality=high');
const SHOTS = {
  main: ['main', 'strike', 6, 0], cageside: ['cageside', 'strike', 6, 0], ground: ['ground', 'takedown', 0, 40],
  corner: ['corner', 'roundEnd', 0, 420], finish: ['finish', 'end', 0, 0], mainTight: ['mainTight', 'strike', 6, 0],
};
const names = opt('shots', 'cageside,corner,main').split(',');
const crop = opt('crop', null)?.split(',').map(Number) ?? null;
const width = Number(opt('width', '800'));

const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => document.querySelector('[data-phase="live"]') && window.__presenter, null, { timeout: 240000 });
const canvasShot = async () => {
  const el = await page.$('canvas[aria-label="3D broadcast view"]');
  return (await el.screenshot({ type: 'png' })).toString('base64');
};
const live = () => page.waitForFunction(() => document.querySelector('[data-phase="live"]') && window.__presenter && window.__watch, null, { timeout: 240000 });
async function capture(name) {
  await live();
  const [lock, ev, nth, off] = SHOTS[name];
  const evs = await page.evaluate(() => window.__watch.events());
  const list = ev === 'end' ? [{ tick: Math.max(...evs.map((e) => e.tick)) }] : evs.filter((e) => e.kind === ev);
  const e = list[Math.min(list.length - 1, nth)];
  await page.evaluate(() => window.__watch.camera('broadcast'));
  await page.evaluate((t) => window.__watch.seek(t), e.tick + off);
  await page.evaluate((k) => window.__presenter.camera.lockShot(k), lock);
  await page.waitForTimeout(3500);
  const shots = [];
  for (const legacy of [true, false]) {
    await page.evaluate((legacy) => {
      const st = window.__presenter.stage; const pl = st.pipeline;
      pl.useLegacy = legacy; window.__skinGatesOff.value = legacy ? 1 : 0; st.aoClamp = !legacy;
      if (legacy && pl.aoNode) pl.aoNode.radius.value = 0.4;
    }, legacy);
    await page.waitForTimeout(1500); // temporal history converges
    shots.push(await canvasShot());
  }
  await page.evaluate(() => window.__presenter.camera.lockShot(null));
  const png = await browser.newPage({ viewport: { width: 2000, height: 700 } });
  await png.setContent('<html><body style="margin:0;background:#0d1015"><canvas id="c"></canvas></body></html>');
  const data = await png.evaluate(async ({ a, b, crop, name, width }) => {
    const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = `data:image/png;base64,${s}`; });
    const [A, B] = [await load(a), await load(b)];
    const [cx, cy, cw, ch] = crop ?? [0, 0, 1, 1];
    const sw = A.width * cw, sh = A.height * ch, sx = A.width * cx, sy = A.height * cy;
    const W = width, H = Math.round(W * sh / sw), pad = 8, top = 34;
    const c = document.getElementById('c'); c.width = W * 2 + pad * 3; c.height = H + top + pad;
    const g = c.getContext('2d'); g.fillStyle = '#0d1015'; g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(A, sx, sy, sw, sh, pad, top, W, H); g.drawImage(B, sx, sy, sw, sh, W + pad * 2, top, W, H);
    g.fillStyle = '#e2c26b'; g.font = '600 17px sans-serif';
    g.fillText(`${name} — before the performance pass`, pad, 23); g.fillText(`${name} — after`, W + pad * 2, 23);
    return c.toDataURL('image/png').split(',')[1];
  }, { a: shots[0], b: shots[1], crop, name, width });
  const { writeFileSync } = await import('node:fs');
  const out = `${prefix}${name}${crop ? '-detail' : ''}.png`;
  writeFileSync(out, Buffer.from(data, 'base64'));
  console.log('saved', out, Math.round(Buffer.from(data, 'base64').length / 1024), 'KB');
  await png.close();
}
// The shared dev server hot-reloads the page when another agent saves: retry the shot.
for (const name of names) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try { await capture(name); break; } catch (err) {
      if (attempt === 3) console.log('failed', name, String(err).slice(0, 160));
      await page.waitForTimeout(3000);
    }
  }
}
await browser.close();
