#!/usr/bin/env node
/**
 * Per-shot GPU cost of the Watch screen, from ONE page load (shaders compile once).
 *
 *   node scripts/dev/heavy.mjs node scripts/dev/perf-shots.mjs <base-url> <out-prefix> [--size 2560x1440]
 *        [--shots main,cageside,...] [--frames 40] [--no-png] [--webgl] [--quality high]
 *
 * For each broadcast shot it seeks relative to an event of the bout (so it survives sim
 * changes), locks the director on that shot kind (`director.lockShot`), lets the camera and
 * the temporal history settle, then records:
 *   - GPU ms per frame: 25th percentile (and median) over `--frames` back-to-back frames of the summed render-pass
 *     timestamps (needs `gpuTiming=1`, added to the URL), and the per-pass breakdown
 *     (`Stage.passTimes`);
 *   - the live frame rate over 3 s of the page's own rAF loop (vsync-limited);
 *   - the internal resolution and the skin shading level in use;
 *   - optionally a screenshot `<out-prefix><shot>.png` of the picture.
 * One JSON line per shot, then a table.
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const [base, prefix] = args;
if (!base || !prefix) {
  console.error('usage: perf-shots.mjs <base-url> <out-prefix> [--size WxH] [--shots a,b] [--frames n] [--no-png] [--webgl] [--quality q]');
  process.exit(2);
}
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const [w, h] = opt('size', '2560x1440').split('x').map(Number);
const frames = Number(opt('frames', '90'));
const png = !args.includes('--no-png');
const quality = opt('quality', 'high');

// Shot kind → where in the bout to look at it (event-relative), and how long to settle.
const SHOTS = {
  main: { lock: 'main', event: 'strike', nth: 6, offset: 0 },
  mainTight: { lock: 'mainTight', event: 'strike', nth: 6, offset: 0 },
  cageside: { lock: 'cageside', event: 'strike', nth: 6, offset: 0 },
  ground: { lock: 'ground', event: 'takedown', nth: 0, offset: 40 },
  overhead: { lock: 'overhead', event: 'takedown', nth: 0, offset: 40 },
  corner: { lock: 'corner', event: 'roundEnd', nth: 0, offset: 420 },
  finish: { lock: 'finish', event: 'end', offset: 0 },
};
const names = opt('shots', 'main,mainTight,cageside,ground,corner,finish').split(',');

let url = base;
const add = (kv) => { url += (url.includes('?') ? '&' : '?') + kv; };
if (!/gpuTiming=/.test(url)) add('gpuTiming=1');
if (!/quality=/.test(url)) add(`quality=${quality}`);
if (args.includes('--webgl')) add('backend=webgl2');

const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
});
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url, { waitUntil: 'load', timeout: 240000 });
await page.waitForFunction(() => document.querySelector('[data-phase="live"]') && window.__watch, null, { timeout: 240000 });
await page.waitForTimeout(1500);

const rows = [];
// The shared dev server hot-reloads the page when another agent saves a file:
// a shot interrupted by a reload is retried (up to 3 times) once the picture is live again.
async function measure(name) {
  const s = SHOTS[name];
  if (!s) { console.log(JSON.stringify({ shot: name, skipped: 'unknown shot' })); return; }
  await page.waitForFunction(() => document.querySelector('[data-phase="live"]') && window.__watch, null, { timeout: 240000 });
  const evs = await page.evaluate(() => window.__watch.events());
  const list = s.event === 'end' ? [{ tick: Math.max(...evs.map((e) => e.tick)) }] : evs.filter((e) => e.kind === s.event);
  const e = list[Math.min(list.length - 1, s.nth ?? 0)];
  if (!e) { console.log(JSON.stringify({ shot: name, skipped: `no ${s.event}` })); return; }
  await page.evaluate(() => window.__watch.camera('broadcast'));
  await page.evaluate((t) => window.__watch.seek(t), e.tick + (s.offset ?? 0));
  await page.evaluate((k) => window.__presenter.camera.lockShot(k), s.lock);
  // Settle: the lens springs, the dynamic resolution and the temporal history.
  await page.waitForTimeout(3500);
  const live = await page.evaluate(() => new Promise((res) => {
    const t = [];
    const f = (x) => { t.push(x); if (t.length < 181) requestAnimationFrame(f); else res(t); };
    requestAnimationFrame(f);
  }).then((t) => {
    const d = t.slice(1).map((x, i) => x - t[i]);
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    return { fps: Math.round(10000 / mean) / 10, worstMs: Math.round(Math.max(...d) * 10) / 10 };
  }));
  const stats = await page.evaluate(() => window.__stats ?? null);
  if (png) await page.screenshot({ path: `${prefix}${name}.png` });
  const passes = await page.evaluate((n) => window.__presenter?.stage?.passTimes?.(n), frames).catch((err) => ({ error: String(err) }));
  const benchMs = passes ? undefined : await page.evaluate(() => window.__presenter?.stage?.benchmark?.(60)).catch(() => null);
  const row = {
    shot: name, tick: e.tick + (s.offset ?? 0), gpuMs: passes?.total ?? benchMs, gpuMedianMs: passes?.median, liveFps: live.fps, worstFrameMs: live.worstMs,
    internal: stats ? `${stats.internalWidth}x${stats.internalHeight}` : null, output: stats ? `${stats.outputWidth ?? ''}` : null,
    shotName: stats?.shot, skinLod: stats?.skinLod ?? null, draws: stats?.drawCalls, tris: stats?.triangles, passes: passes?.passes,
  };
  rows.push(row);
  console.log(JSON.stringify(row));
  await page.evaluate(() => window.__presenter.camera.lockShot(null));
}
for (const name of names) {
  for (let attempt = 0; ; attempt++) {
    try { await measure(name); break; } catch (err) {
      if (attempt >= 3) { console.log(JSON.stringify({ shot: name, error: String(err).slice(0, 200) })); break; }
      await page.waitForTimeout(3000);
    }
  }
}
console.log('\n| shot | GPU ms p25 | GPU ms median | live fps | internal |');
console.log('| --- | --- | --- | --- | --- |');
for (const r of rows) console.log(`| ${r.shot} (${r.shotName}) | ${r.gpuMs} | ${r.gpuMedianMs ?? '-'} | ${r.liveFps} | ${r.internal} |`);
if (errors.length) {
  console.log(`${errors.length} console error(s):`);
  for (const e of [...new Set(errors)].slice(0, 8)) console.log('  ' + e.slice(0, 300));
}
await browser.close();
