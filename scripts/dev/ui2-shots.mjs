#!/usr/bin/env node
/**
 * UI pass 2 walk-through (docs/design/UI_PASS.md, "UI pass 2"): a new user's
 * path through every screen of a PRODUCTION build, with screenshots and the
 * JavaScript chunks each screen fetches.
 *
 *   npx vite build --outDir <dir>
 *   node scripts/dev/heavy.mjs node scripts/dev/ui2-shots.mjs <dir> [--prefix ui2] [--only a,b]
 *
 * The build is served by a tiny static server started here (no dev server,
 * no hot reload). Each screenshot is written to docs/screenshots/<prefix>-<name>.png
 * and checked against 250 KB. Also checks the debug-switch gate in the
 * production build: `?watchDemo=1` alone must open Match setup with no
 * `window.__*` QA globals, and `?watchDemo=1&capture=1` must open Watch.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const dir = args[0] ? resolve(args[0]) : null;
if (!dir || !existsSync(join(dir, 'index.html'))) {
  console.error('usage: ui2-shots.mjs <buildDir> [--prefix ui2] [--only a,b]');
  process.exit(2);
}
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const prefix = opt('prefix', 'ui2');
const only = opt('only', null)?.split(',') ?? null;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ktx2': 'image/ktx2', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x');
  let f = join(dir, decodeURIComponent(u.pathname));
  if (!f.startsWith(dir) || !existsSync(f) || statSync(f).isDirectory()) f = join(dir, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(f).toLowerCase()] ?? 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
});
const errors = [];
const findings = [];

async function newPage(theme) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  if (theme) await page.addInitScript((t) => { try { localStorage.setItem('bout-lab.theme', t); } catch { /* */ } }, theme);
  const chunks = [];
  page.on('request', (r) => { if (/\.js$/.test(r.url())) chunks.push(r.url().split('/').pop()); });
  return { context, page, chunks };
}

// ---- 1. the debug-switch gate in production --------------------------------
{
  const { context, page } = await newPage();
  await page.goto(`${base}?watchDemo=1&quality=ultra&backend=webgl2`, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'Match setup' }).waitFor({ timeout: 60000 });
  const globals = await page.evaluate(() => Object.keys(window).filter((k) => k.startsWith('__')));
  findings.push(`production, no capture flag: opened "Match setup"; window.__* globals: [${globals.join(', ')}]`);
  await context.close();
}
{
  const { context, page } = await newPage();
  await page.goto(`${base}?watchDemo=1&view=2d&capture=1`, { waitUntil: 'load' });
  const onWatch = await page.locator('.watch').first().waitFor({ timeout: 60000 }).then(() => true, () => false);
  await page.waitForTimeout(1500);
  const hasHook = await page.evaluate(() => typeof window.__watch === 'object');
  findings.push(`production + capture=1: Watch opened: ${onWatch}; window.__watch present: ${hasHook}`);
  await context.close();
}

// ---- 2. a new user's walk ----------------------------------------------------
const { page, chunks } = await newPage();
/**
 * Keep a PNG within MAX_KB: a 3D picture does not compress like UI chrome, so
 * an oversized capture is scaled down in a canvas (still PNG) until it fits.
 */
const MAX_KB = 250;
let scratch = null;
async function fitPng(buf) {
  if (buf.length <= MAX_KB * 1024) return { buf, scale: 1 };
  scratch ??= await (await browser.newContext()).newPage();
  for (const scale of [0.85, 0.75, 0.66, 0.58, 0.5, 0.42]) {
    const b64 = await scratch.evaluate(async ({ src, scale }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/png').split(',')[1];
    }, { src: `data:image/png;base64,${buf.toString('base64')}`, scale });
    const out = Buffer.from(b64, 'base64');
    if (out.length <= MAX_KB * 1024) return { buf: out, scale };
  }
  return { buf, scale: 1 };
}
/** `full`: grow the viewport to the page's scroll height for one capture (the panels scroll, not the body). */
const shot = async (name, { full = false } = {}) => {
  if (only && !only.includes(name)) return;
  const out = `docs/screenshots/${prefix}-${name}.png`;
  let restore = null;
  if (full) {
    const h = await page.evaluate(() => {
      const panel = document.querySelector('.tabpanel:not([hidden])');
      const top = panel ? panel.getBoundingClientRect().top : 0;
      return Math.min(3000, Math.ceil(top + (panel ? panel.scrollHeight : document.body.scrollHeight)));
    });
    restore = page.viewportSize();
    await page.setViewportSize({ width: restore.width, height: Math.max(restore.height, h) });
    await page.waitForTimeout(300);
  }
  const { buf, scale } = await fitPng(await page.screenshot());
  if (restore) await page.setViewportSize(restore);
  writeFileSync(out, buf);
  const kb = buf.length / 1024;
  console.log(`${out} ${kb.toFixed(0)} KB${scale < 1 ? ` (scaled to ${Math.round(scale * 100)} %)` : ''}${kb > MAX_KB ? '  ** OVER 250 KB **' : ''}`);
};
const nav = async (label) => {
  const before = chunks.length;
  await page.locator('nav.nav').getByRole('button', { name: new RegExp(`^${label}`) }).first().click();
  await page.waitForTimeout(900);
  const fetched = chunks.slice(before);
  findings.push(`open ${label}: fetched ${fetched.length ? fetched.join(', ') : 'nothing new'}`);
};

await page.goto(base, { waitUntil: 'load' });
await page.getByRole('heading', { name: 'Match setup' }).waitFor({ timeout: 60000 });
await page.waitForTimeout(600);
findings.push(`first screen fetched: ${chunks.join(', ')}`);
await shot('match');
await shot('match-full', { full: true });

// Inline validation: the same fighter twice, an out-of-range round count.
await page.locator('#ms-slot-1').selectOption('arch.regional_pro_allrounder');
await page.locator('#panel-match .ui-disclosure summary').first().click();
await page.locator('#ms-rounds').fill('20');
await page.waitForTimeout(300);
await page.locator('#ms-rounds').evaluate((el) => el.scrollIntoView({ block: 'center' }));
await shot('match-validation');
await page.locator('#ms-rounds').fill('');
await page.locator('#ms-slot-1').selectOption('arch.thai_striker');

// Options step with the officials section open.
await page.locator('#panel-match .ui-disclosure summary').nth(1).click();
await page.locator('#ms-home').scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await shot('match-advanced');

// Run the default bout → result.
await page.locator('.page-actions').getByRole('button', { name: 'Run bout' }).click();
await page.getByRole('heading', { level: 1 }).filter({ hasText: ' vs ' }).waitFor({ timeout: 180000 });
await page.waitForTimeout(800);
await shot('result');

// Watch it (lazy Watch chunk, then the lazy 3D chunk).
{
  const before = chunks.length;
  await page.getByRole('button', { name: 'Watch the fight' }).click();
  await page.locator('[data-phase="live"], .watch-stage--2d').first().waitFor({ timeout: 180000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  findings.push(`open Watch from the result: fetched ${chunks.slice(before).join(', ')}`);
  await shot('watch');
}

await nav('Tournaments');
await shot('tournaments-new');
await page.getByRole('button', { name: /^Pick the top 8/ }).click();
await page.locator('#panel-tournaments .ui-disclosure summary').first().click();
await page.waitForTimeout(300);
await shot('tournaments-builder', { full: true });
await page.getByRole('button', { name: 'Create bracket' }).click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Run match' }).first().click();
await page.waitForFunction(() => ![...document.querySelectorAll('.tr-next-row button')].some((b) => /Running/.test(b.textContent ?? '')), null, { timeout: 180000 });
await page.waitForTimeout(800);
await shot('tournaments-bracket');

await nav('Batch simulation');
await shot('batch');
await nav('History');
await shot('history');
await nav('Fighters');
await shot('fighters');
await nav('Fighter editor');
await shot('editor-empty');
await nav('About the model');
await shot('about');

// Dark theme, first screen.
{
  const d = await newPage('dark');
  await d.page.goto(base, { waitUntil: 'load' });
  await d.page.getByRole('heading', { name: 'Match setup' }).waitFor({ timeout: 60000 });
  await d.page.waitForTimeout(500);
  if (!only || only.includes('match-dark')) {
    const { buf } = await fitPng(await d.page.screenshot());
    writeFileSync(`docs/screenshots/${prefix}-match-dark.png`, buf);
    console.log(`docs/screenshots/${prefix}-match-dark.png ${(buf.length / 1024).toFixed(0)} KB`);
  }
  await d.context.close();
}

console.log('\nfindings:');
for (const f of findings) console.log(`  ${f}`);
if (errors.length) {
  console.log(`\n${errors.length} console error(s):`);
  for (const e of [...new Set(errors)].slice(0, 12)) console.log(`  ${e}`);
}
await browser.close();
server.close();
