#!/usr/bin/env node
/**
 * UI screenshots for the polish pass (docs/design/UI_PASS.md).
 *
 *   node scripts/dev/heavy.mjs node scripts/dev/ui-shots.mjs <prefix> [--size 1440x900] [--only a,b]
 *
 * Visits every non-3D screen of the running dev server (default
 * http://127.0.0.1:5180) by clicking its navigation tab, and writes
 * docs/screenshots/<prefix>-<screen>.png. Software rendering is fine here:
 * none of these screens draws WebGL. Each PNG is checked against 1 MB.
 */
import { chromium } from 'playwright';
import { statSync } from 'node:fs';

const args = process.argv.slice(2);
const prefix = args[0] ?? 'ui-after';
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const [w, h] = opt('size', '1440x900').split('x').map(Number);
const only = opt('only', null)?.split(',') ?? null;
const base = opt('url', 'http://127.0.0.1:5180/');
const theme = opt('theme', null);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', (r) => { if (r.status() >= 500) errors.push(`${r.status()} ${r.url()}`); });
if (theme) await page.addInitScript((t) => { try { localStorage.setItem('bout-lab.theme', t); } catch {} }, theme);
// Shared dev server: stub the HMR client so another agent's edit cannot reload the page mid-capture.
await page.route('**/@vite/client', (route) => route.fulfill({
  contentType: 'application/javascript',
  body: `const styles = new Map();
export function updateStyle(id, css) { let el = styles.get(id); if (!el) { el = document.createElement('style'); document.head.appendChild(el); styles.set(id, el); } el.textContent = css; }
export function removeStyle(id) { styles.get(id)?.remove(); styles.delete(id); }
export function injectQuery(url) { return url; }
export class ErrorOverlay extends (globalThis.HTMLElement ?? class {}) {}
export function createHotContext() { const noop = () => {}; return { accept: noop, acceptExports: noop, dispose: noop, prune: noop, invalidate: noop, on: noop, off: noop, send: noop, data: {} }; }`,
}));
await page.goto(base, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(1500);

const legacy = args.includes('--legacy'); // the pre-pass shell used role=tab
async function nav(label) {
  const loc = legacy
    ? page.getByRole('tab', { name: new RegExp(`^${label.split(' ')[0]}`, 'i') }).first()
    : page.locator('nav.nav').getByRole('button', { name: new RegExp(`^${label}`) }).first();
  await loc.click();
  await page.waitForTimeout(700);
}
async function shot(name) {
  if (only && !only.includes(name)) return;
  const out = `docs/screenshots/${prefix}-${name}.png`;
  await page.screenshot({ path: out });
  const kb = statSync(out).size / 1024;
  console.log(`${out} ${kb.toFixed(0)} KB${kb > 1024 ? '  ** OVER 1 MB **' : ''}`);
}
const want = (name) => !only || only.includes(name);
const steps = [
  ['match', async () => { await nav('Match setup'); }],
  ['tournaments', async () => { await nav('Tournaments'); }],
  ['result', async () => { await nav('Result'); }],
  ['history', async () => { await nav('History'); }],
  ['fighters', async () => { await nav('Fighters'); }],
  ['creator-empty', async () => { await nav(legacy ? 'Creator' : 'Fighter editor'); }],
  ['creator', async () => {
    await nav('Fighters');
    await page.locator('table').getByRole('button', { name: /^(Open|Edit)$/ }).nth(12).click();
    await page.waitForTimeout(900);
  }],
  ['creator-advanced', async () => {
    if (legacy) return false;
    await page.getByRole('radio', { name: 'Advanced' }).click();
    await page.getByRole('tab', { name: /Technical/ }).click();
    await page.locator('#creator-compare-select').selectOption({ index: 3 });
    await page.waitForTimeout(700);
  }],
  ['creator-search', async () => {
    if (legacy) return false;
    await page.locator('#creator-search').fill('takedown');
    await page.waitForTimeout(500);
  }],
  ['creator-schema', async () => {
    if (legacy) return false;
    await page.locator('#creator-search').fill('');
    await page.getByRole('radio', { name: 'Full schema' }).click();
    await page.waitForTimeout(500);
  }],
  ['creator-presets', async () => {
    if (legacy) return false;
    await page.getByRole('button', { name: 'Presets' }).click();
    await page.waitForTimeout(500);
  }],
  ['about', async () => {
    if (legacy) return false;
    await page.keyboard.press('Escape');
    await nav('About the model');
  }],
  ['batch', async () => { if (legacy) return false; await nav('Batch simulation'); }],
  ['batch-running', async () => {
    if (legacy || !want('batch-running')) return false;
    await page.getByRole('radio', { name: '1,000' }).click();
    await page.getByRole('button', { name: /^Run 1,000 bouts/ }).click();
    await page.waitForTimeout(9000);
  }],
  ['batch-results', async () => {
    if (legacy || !want('batch-results')) return false;
    const cancel = page.getByRole('button', { name: 'Cancel batch' });
    if (await cancel.count()) await cancel.click();
    await page.getByRole('radio', { name: '100' }).click();
    await page.getByRole('button', { name: /^Run 100 bouts/ }).click();
    await page.getByRole('button', { name: 'Export CSV' }).waitFor({ timeout: 300000 });
    await page.waitForTimeout(600);
  }],
];
for (const [name, fn] of steps) {
  try {
    const r = await fn();
    if (r === false) { console.log(`skip ${name}`); continue; }
    await shot(name);
  } catch (e) { console.log(`failed ${name}: ${e.message.split(String.fromCharCode(10))[0]}`); }
}
if (errors.length) { console.log(`${errors.length} console error(s):`); for (const e of errors.slice(0, 8)) console.log('  ' + e); }
await browser.close();
