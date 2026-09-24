#!/usr/bin/env node
/**
 * Same-frame visual A/B of the performance pass: each shot is captured twice from one page load,
 * with the pre-pass paths (three's DoF node and separate RCAS pass, ungated skin, fixed 0.4 m GTAO
 * radius; `stagePost=abLegacy:1`) and with the current ones, then composed side by side
 * (legacy left, current right) and downscaled to keep the PNG small.
 *
 *   node scripts/dev/heavy.mjs node scripts/dev/perf-compare-shots.mjs <base-url> <out-prefix> [--shots cageside,corner]
 *        [--crop x,y,w,h]   crop (fractions of the picture) for a detail view  [--width 800]  panel width
 *        [--ab pass1|corner|fencelens|skindup]  what the "before" side changes (default pass1, above):
 *          corner     the corner handheld's crew avoidance off (`director.cornerAvoid = false`: the lens stays home);
 *          fencelens  the chain-link's lens at the old fixed focus 3.5 m / aperture 9 mm;
 *          skindup    the skin built with the old debug `select` (the picture must be identical).
 *        [--offset ticks]  override the shot's event offset
 */
import { chromium } from 'playwright';
import { captureGoto } from './capture-url.mjs';

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
const ab = opt('ab', 'pass1');
const offOverride = opt('offset', null);
const LABEL = { pass1: ['before the performance pass', 'after'], corner: ['crew avoidance off', 'crew avoidance on'], fencelens: ['fence lens fixed 3.5 m / 9 mm', 'fence lens from the shot'], skindup: ['skin graph emitted twice', 'emitted once'] }[ab];

const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
captureGoto(page); // ?capture=1: QA switches in production builds (capture-url.mjs)
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
  const tick = e.tick + (offOverride !== null ? Number(offOverride) : off);
  await page.evaluate((t) => window.__watch.seek(t), tick);
  await page.evaluate((k) => window.__presenter.camera.lockShot(k), lock);
  await page.waitForTimeout(3500);
  const shots = [];
  let skinAlt = null;
  if (ab === 'skindup') {
    skinAlt = await page.evaluate(async () => {
      const mod = await import('/src/presentation/character/skinMaterial.ts');
      const bodies = [];
      window.__presenter.stage.scene.traverse((o) => { if (o.isSkinnedMesh && /^body-lod/.test(o.name)) bodies.push(o); });
      const cur = bodies.map((o) => o.material);
      const alt = new Map();
      for (const m of new Set(cur)) { const a = m.userData.skinArgs; alt.set(m, mod.createSkinMaterial(a.tex, { ...a.opt, legacySelect: true })); }
      window.__abSkin = (legacy) => bodies.forEach((o, i) => { o.material = legacy ? alt.get(cur[i]) : cur[i]; });
      return true;
    });
  }
  for (const legacy of [true, false]) {
    await page.evaluate(async ({ legacy, ab, tick }) => {
      const pr = window.__presenter; const st = pr.stage; const pl = st.pipeline;
      if (ab === 'pass1') {
        pl.useLegacy = legacy; window.__skinGatesOff.value = legacy ? 1 : 0; st.aoClamp = !legacy;
        if (legacy && pl.aoNode) pl.aoNode.radius.value = 0.4;
      } else if (ab === 'corner') {
        pr.camera.cornerAvoid = !legacy;
        // A discontinuity (a seek away and back: the paused player ignores a seek to
        // the tick it is on): the lens starts the shot where it now chooses.
        window.__watch.seek(tick - 1);
        await new Promise((r) => setTimeout(r, 300));
        window.__watch.seek(tick);
      } else if (ab === 'fencelens') {
        pr.fenceLensLive = !legacy;
        const fl = pr.arena?.fenceLens;
        if (legacy && fl) { fl.focus.value = 3.5; fl.aperture.value = 0.009; }
      } else if (ab === 'skindup') {
        window.__abSkin(legacy);
      }
    }, { legacy, ab, tick });
    await page.waitForTimeout(ab === 'corner' ? 3000 : 1500); // temporal history converges
    shots.push(await canvasShot());
  }
  await page.evaluate(() => window.__presenter.camera.lockShot(null));
  const png = await browser.newPage({ viewport: { width: 2000, height: 700 } });
  await png.setContent('<html><body style="margin:0;background:#0d1015"><canvas id="c"></canvas></body></html>');
  const data = await png.evaluate(async ({ a, b, crop, name, width, label }) => {
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
    g.fillText(`${name} — ${label[0]}`, pad, 23); g.fillText(`${name} — ${label[1]}`, W + pad * 2, 23);
    return c.toDataURL('image/png').split(',')[1];
  }, { a: shots[0], b: shots[1], crop, name, width, label: LABEL });
  const { writeFileSync } = await import('node:fs');
  const out = `${prefix}${name}${crop ? '-detail' : ''}.png`;
  if (ab === 'corner') await page.evaluate(() => { window.__presenter.camera.cornerAvoid = true; });
  if (ab === 'fencelens') await page.evaluate(() => { window.__presenter.fenceLensLive = true; });
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
