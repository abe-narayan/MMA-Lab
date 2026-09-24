// QA2 smoke: every screen loads, navigation round-trip, console errors per screen, and a button inventory.
import { launch, metrics, nav, save, report, OUT, BASE } from './qa2-lib.mjs';

const screens = ['Match setup', 'Batch simulation', 'Tournaments', 'Watch', 'Result', 'History', 'Fighters', 'Fighter editor', 'About the model'];
const { page, cdp, log, close } = await launch();
const out = { screens: {} };
const t0 = Date.now();
await page.goto(BASE, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(2500);
out.initial = await metrics(page, cdp);
for (const s of screens) {
  const before = log.errors.length;
  const ts = Date.now();
  await nav(page, s);
  await page.waitForTimeout(s === 'Watch' ? 12000 : 1500);
  const inv = await page.evaluate(() => {
    const vis = (e) => e.offsetParent !== null;
    const panel = [...document.querySelectorAll('[role=tabpanel], main section, .page')].find(vis) ?? document.body;
    return {
      h: [...document.querySelectorAll('h1,h2,h3')].filter(vis).map((e) => e.textContent.trim()).slice(0, 15),
      buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 40)).filter(Boolean).slice(0, 80),
      radios: [...document.querySelectorAll('[role=radio]')].filter(vis).map((b) => (b.getAttribute('aria-label') || b.textContent).trim().slice(0, 30)).slice(0, 60),
      selects: [...document.querySelectorAll('select')].filter(vis).map((s) => (s.getAttribute('aria-label') || s.id || s.name) + ':' + [...s.options].map((o) => o.value).slice(0, 12).join('|')).slice(0, 20),
      inputs: [...document.querySelectorAll('input')].filter(vis).map((i) => `${i.type}:${i.getAttribute('aria-label') || i.name || i.id || i.placeholder}`).slice(0, 40),
      text: (panel.innerText || '').slice(0, 600),
    };
  });
  out.screens[s] = { ms: Date.now() - ts, newErrors: log.errors.slice(before), inv, m: await metrics(page, cdp) };
  await page.screenshot({ path: `${OUT}/smoke-${s.replace(/\W+/g, '_')}.png` });
}
// round-trip navigation 3x quickly
for (let k = 0; k < 3; k++) for (const s of screens) { await nav(page, s); await page.waitForTimeout(150); }
await page.waitForTimeout(3000);
out.afterRoundTrips = await metrics(page, cdp, { gc: true });
out.report = await report('smoke', log, page);
out.totalMs = Date.now() - t0;
save('smoke', out);
console.log(JSON.stringify({ initial: out.initial, after: out.afterRoundTrips, errors: out.report.errors, rej: out.report.rejections, perScreen: Object.fromEntries(Object.entries(out.screens).map(([k, v]) => [k, { ms: v.ms, errs: v.newErrors.length, heap: v.m.jsHeapMB, nodes: v.m.nodes }])) }, null, 1));
await close();
