// QA2 fighters follow-up: malicious imports (__proto__ payloads, prototype-named ids), extreme values, then
// reload persistence and running a bout with the imported fighters.
import { launch, nav, report, OUT, BASE, sleep } from './qa2-lib.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const { page, log, close } = await launch();
const one = JSON.parse(readFileSync(`${OUT}/fighters-one.json`, 'utf8'));
const f0 = (one.fighters ?? [one])[0];
const wrap = (fighters) => JSON.stringify({ ...one, fighters });
const customCount = () => page.evaluate(() => (document.body.innerText.match(/and (\d+) of your own/) ?? [])[1] ?? null);
const polluted = () => page.evaluate(() => [({}).polluted, ({}).polluted2, ({}).isAdmin, Object.keys(Object.prototype).length]);
const imp = async (name, content) => {
  const p = `${OUT}/f2-${name}.json`; writeFileSync(p, content);
  await nav(page, 'Fighters');
  await page.locator('input[type=file][aria-label="Import a fighter JSON file"]').setInputFiles(p);
  await sleep(1200);
  const dlg = page.locator('[role=dialog]').last();
  const text = (await dlg.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 500);
  const btn = dlg.getByRole('button', { name: /^Import \d+ fighter/ });
  let clicked = false;
  if (await btn.count() && await btn.isEnabled()) { await btn.click({ timeout: 5000 }).then(() => { clicked = true; }).catch(() => {}); await sleep(800); }
  await page.keyboard.press('Escape'); await sleep(300);
  const r = { text, clicked, custom: await customCount(), polluted: await polluted() };
  console.log(name, JSON.stringify(r).slice(0, 700));
  return r;
};
await page.goto(BASE, { waitUntil: 'load' }); await sleep(1500);
const protoText = `{"__proto__":{"polluted":1},"schemaVersion":${JSON.stringify(one.schemaVersion ?? 1)},"fighters":[${JSON.stringify({ ...f0, id: 'qa2.proto', name: 'Proto' })
  .replace(/^\{/, '{"__proto__":{"polluted":1,"isAdmin":true},"constructor":{"prototype":{"polluted2":1}},')
  .replace('"physical":{', '"physical":{"__proto__":{"polluted":1},')}]}`;
await imp('proto', protoText);
await imp('protoid', wrap([{ ...f0, id: '__proto__', name: 'ProtoId' }, { ...f0, id: 'constructor', name: 'CtorId' }, { ...f0, id: 'toString', name: 'ToStringId' }]));
await imp('extreme', wrap([{ ...f0, id: 'qa2.extreme', name: 'Extreme', physical: Object.fromEntries(Object.keys(f0.physical ?? {}).map((k) => [k, 1e308])), body: { ...f0.body, heightM: 1e308, reachM: -1, fightNightKg: 0.0001 } }]));
await imp('longname2k', wrap([{ ...f0, id: 'qa2.long', name: 'L'.repeat(2000) }]));
await imp('html-name', wrap([{ ...f0, id: 'qa2.html', name: '<script>window.__xss2=1</script><img src=x onerror="window.__xss3=1">' }]));
const ls = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, (localStorage.getItem(k) ?? '').length])));
console.log('localStorage keys', JSON.stringify(ls));
const storeShape = await page.evaluate(() => {
  for (const k of Object.keys(localStorage)) {
    const v = localStorage.getItem(k) ?? '';
    if (v.includes('ProtoId') || v.includes('qa2.proto')) {
      try { const j = JSON.parse(v); return { key: k, top: Object.keys(j).slice(0, 10), hasProtoKey: v.includes('"__proto__"'), ids: JSON.stringify(j).match(/"id":"(__proto__|constructor|toString|qa2\.[a-z]+)"/g) }; } catch (e) { return { key: k, err: String(e) }; }
    }
  }
  return null;
});
console.log('store', JSON.stringify(storeShape));
await page.reload({ waitUntil: 'load' }); await sleep(1500);
await nav(page, 'Fighters');
const afterReload = await page.evaluate(() => ({
  custom: (document.body.innerText.match(/and (\d+) of your own/) ?? [])[1],
  names: [...document.querySelectorAll('button[aria-label^="Delete "]')].map((b) => b.getAttribute('aria-label').slice(7, 40)).filter((n) => /Proto|Ctor|ToString|Extreme|LLLL|script/.test(n)),
  xss: [window.__xss2 ?? null, window.__xss3 ?? null],
}));
console.log('afterReload', JSON.stringify(afterReload), 'polluted', JSON.stringify(await polluted()));
// run a bout with the extreme fighter and the __proto__-id fighter
await nav(page, 'Match setup');
const opts = await page.locator('#ms-slot-0 option').evaluateAll((os) => os.map((o) => [o.value, o.textContent]));
console.log('options', JSON.stringify(opts.filter(([v]) => !v.startsWith('arch.'))).slice(0, 600));
for (const [a, b] of [['qa2.extreme', 'arch.champion_complete'], ['__proto__', 'constructor']]) {
  const e0 = log.errors.length;
  const has = opts.some(([v]) => v === a) && opts.some(([v]) => v === b);
  if (!has) { console.log('bout', a, b, 'not selectable'); continue; }
  await page.selectOption('#ms-slot-0', a); await page.selectOption('#ms-slot-1', b);
  await page.getByRole('button', { name: 'Run bout' }).click();
  const t0 = Date.now();
  try { await page.waitForFunction(() => /Result|Winner|decision|KO|TKO|Draw/i.test(document.querySelector('[aria-current=page]')?.textContent ?? '') || location.hash, null, { timeout: 5000 }); } catch { /* */ }
  for (let i = 0; i < 60; i++) { await sleep(1000); const cur = await page.evaluate(() => document.querySelector('.nav-item[aria-current=page]')?.id); if (cur === 'tab-result') break; }
  const cur = await page.evaluate(() => document.querySelector('.nav-item[aria-current=page]')?.id);
  const txt = (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 300);
  console.log('bout', a, 'vs', b, cur, `${Date.now() - t0}ms`, txt.slice(0, 250), 'errs', log.errors.slice(e0).map((s) => s.slice(0, 200)));
  await nav(page, 'Match setup');
}
const r = await report('f2', log, page);
console.log(JSON.stringify({ errors: r.errors.slice(0, 6), rej: r.rejections, longest: r.longestTask }));
await page.screenshot({ path: `${OUT}/f2-end.png` });
await close();
