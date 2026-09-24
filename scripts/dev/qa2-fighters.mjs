// QA2 fighters: create, edit every group, save, duplicate, rename, delete(+undo), export, import (valid, corrupted,
// partial, huge, malicious), reload persistence. node scripts/dev/heavy.mjs node scripts/dev/qa2-fighters.mjs
import { launch, metrics, nav, save, report, OUT, BASE, sleep } from './qa2-lib.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const { page, cdp, log, close } = await launch();
const res = { steps: [] };
const step = async (name, fn) => {
  const e0 = log.errors.length; const t0 = Date.now(); let err = null; let val;
  try { val = await fn(); } catch (e) {
    err = String(e).split('\n').filter((l) => /Timeout|intercepts|waiting for/.test(l)).slice(0, 3).join(' ').slice(0, 400);
    await page.screenshot({ path: `${OUT}/fighters-fail-${res.steps.length}.png` }).catch(() => {});
    const dlgs = await page.locator('[role=dialog]').allInnerTexts().catch(() => []);
    err += ' DIALOGS: ' + JSON.stringify(dlgs.map((d) => d.replace(/\s+/g, ' ').slice(0, 200)));
    await page.keyboard.press('Escape').catch(() => {});
  }
  const r = { name, ms: Date.now() - t0, err, val, newErrors: log.errors.slice(e0).map((s) => s.slice(0, 300)) };
  res.steps.push(r);
  console.log(`${name}: ${r.ms}ms ${err ? 'ERR ' + err : ''} ${val !== undefined ? JSON.stringify(val).slice(0, 400) : ''} errs+${r.newErrors.length}`);
  return val;
};
const setInput = (sel, value) => page.evaluate(({ sel, value }) => {
  const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
}, { sel, value });
const msg = () => page.locator('.ui-alert, [role=alert], [role=status]').allInnerTexts().then((a) => a.join(' | ').slice(0, 300)).catch(() => '');
const customCount = () => page.evaluate(() => (document.body.innerText.match(/and (\d+) of your own/) ?? [])[1] ?? null);
const importFile = async (name, content) => {
  const p = `${OUT}/fighters-${name}.json`; writeFileSync(p, content);
  await nav(page, 'Fighters');
  await page.locator('input[type=file][aria-label="Import a fighter JSON file"]').setInputFiles(p);
  await sleep(1200);
  const dlg = page.locator('[role=dialog]').last();
  const text = (await dlg.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400);
  const btn = dlg.getByRole('button', { name: /^Import \d+ fighter/ });
  let imported = null;
  if (await btn.count() && await btn.isEnabled()) { await btn.click(); await sleep(1000); imported = await msg(); } else {
    await dlg.getByRole('button', { name: /Close|Cancel/ }).first().click().catch(() => {});
  }
  if (!text) imported = await msg();
  return { dialog: text, imported, custom: await customCount(), polluted: await page.evaluate(() => [({}).polluted, ({}).polluted2, ({}).isAdmin, Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')]) };
};

await page.goto(BASE, { waitUntil: 'load' });
await sleep(1500);
res.m0 = await metrics(page, cdp);

// ---------- create + edit every group ----------
await step('new-fighter', async () => {
  await nav(page, 'Fighters');
  await page.getByRole('button', { name: 'New fighter' }).first().click();
  await sleep(1000);
  await page.locator('input.creator-name').fill('QA2 Test Fighter <img src=x onerror=window.__xss=1>');
  return await page.locator('.creator-status').innerText();
});
await step('edit-basic-advanced', async () => {
  const out = {};
  for (const mode of ['Basic', 'Advanced']) {
    await page.getByRole('radio', { name: mode }).click(); await sleep(400);
    const n = await page.evaluate(() => [...document.querySelectorAll('.creator-form input[type=range]')].filter((e) => e.offsetParent && !e.disabled).length);
    for (let i = 0; i < n; i++) {
      await page.evaluate((i) => {
        const els = [...document.querySelectorAll('.creator-form input[type=range]')].filter((e) => e.offsetParent && !e.disabled);
        const el = els[i]; if (!el) return;
        const min = Number(el.min || 0), max = Number(el.max || 100);
        const v = min + ((i * 37) % 100) / 100 * (max - min);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      }, i);
    }
    const sels = await page.evaluate(() => [...document.querySelectorAll('.creator-form select')].filter((e) => e.offsetParent && !e.disabled).length);
    for (let i = 0; i < sels; i++) {
      await page.evaluate((i) => {
        const el = [...document.querySelectorAll('.creator-form select')].filter((e) => e.offsetParent && !e.disabled)[i]; if (!el || el.options.length < 2) return;
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, el.options[el.options.length - 1].value);
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, i);
    }
    out[mode] = { ranges: n, selects: sels, status: await page.locator('.creator-status').innerText() };
  }
  // search
  await page.locator('#creator-search').fill('cardio'); await sleep(400);
  out.searchHits = await page.evaluate(() => document.querySelectorAll('.creator-form input[type=range]').length);
  await page.locator('#creator-search').fill('');
  // undo / redo a few times
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Undo (Ctrl+Z)' }).click().catch(() => {});
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' }).click().catch(() => {});
  return out;
});
await step('edit-full-schema-every-section', async () => {
  await page.getByRole('radio', { name: 'Full schema' }).click(); await sleep(400);
  const sections = await page.locator('[role=tab][id^=sect-]').allInnerTexts();
  const out = {};
  for (let s = 0; s < sections.length; s++) {
    await page.locator('[role=tab][id^=sect-]').nth(s).click(); await sleep(250);
    const counts = await page.evaluate((s) => {
      const panel = [...document.querySelectorAll('[role=tabpanel][id^=sectpanel-]')].find((p) => !p.hidden);
      if (!panel) return null;
      const nums = [...panel.querySelectorAll('input[type=number], input[type=range]')].filter((e) => !e.disabled);
      let k = 0;
      for (const el of nums) {
        const min = el.min !== '' ? Number(el.min) : 0; const max = el.max !== '' ? Number(el.max) : min + 50;
        const v = min + ((k++ * 13 + s) % 10) / 10 * (max - min);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(Math.round(v * 100) / 100));
        el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const boxes = [...panel.querySelectorAll('input[type=checkbox]')].filter((e) => !e.disabled).slice(0, 6);
      for (const b of boxes) b.click();
      return { nums: nums.length, boxes: boxes.length };
    }, s);
    out[sections[s]] = counts;
  }
  out.status = await page.locator('.creator-status').innerText();
  out.errorsListed = (await page.locator('[aria-label="Live derivation and validation"]').innerText().catch(() => '')).match(/error[^\n]*/gi)?.slice(0, 5);
  return out;
});
await step('save', async () => {
  const saveBtn = page.locator('.creator-buttons').getByRole('button', { name: 'Save', exact: true });
  const enabled = await saveBtn.isEnabled();
  if (!enabled) {
    // errors: take them from the side panel, then revert to the saved blank + set a name so we can continue
    const why = (await page.locator('[aria-label="Live derivation and validation"]').innerText()).slice(0, 600);
    return { enabled, why };
  }
  await saveBtn.click(); await sleep(800);
  return { enabled, status: await page.locator('.creator-status').innerText(), msg: await msg(), xss: await page.evaluate(() => window.__xss ?? null) };
});
const saved = res.steps.at(-1).val;
if (!saved?.enabled) {
  // fall back: fresh fighter with only a name so the rest of the flow can run
  await step('save-fallback', async () => {
    await page.getByRole('button', { name: 'Revert' }).click().catch(() => {});
    await page.locator('.creator-buttons').getByRole('button', { name: 'Close' }).click(); await sleep(500);
    const dlg = page.locator('[role=dialog]'); if (await dlg.count()) await dlg.getByRole('button', { name: /Discard/ }).click();
    await nav(page, 'Fighters');
    await page.getByRole('button', { name: 'New fighter' }).first().click(); await sleep(800);
    await page.locator('input.creator-name').fill('QA2 Test Fighter');
    await page.locator('.creator-buttons').getByRole('button', { name: 'Save', exact: true }).click(); await sleep(800);
    return await msg();
  });
}
await step('export-from-editor', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.locator('.creator-buttons').getByRole('button', { name: 'Export' }).click()]);
  const p = `${OUT}/fighters-one.json`; await dl.saveAs(p);
  return { bytes: readFileSync(p).length, name: dl.suggestedFilename() };
});
await step('leave-editor-guard', async () => {
  await page.locator('input.creator-name').fill('QA2 Test Fighter dirty');
  await nav(page, 'Match setup');
  const guard = await page.locator('[role=dialog]').innerText().catch(() => null);
  if (guard) await page.getByRole('button', { name: 'Keep editing' }).click();
  await page.locator('.creator-buttons').getByRole('button', { name: 'Revert' }).click().catch(() => {});
  return guard?.replace(/\s+/g, ' ').slice(0, 120) ?? null;
});

// ---------- database actions ----------
await step('duplicate-rename-delete-undo', async () => {
  await nav(page, 'Fighters');
  const name = await page.evaluate(() => [...document.querySelectorAll('button[aria-label^="Duplicate QA2"]')].map((b) => b.getAttribute('aria-label'))[0]);
  const base = name.replace('Duplicate ', '');
  await page.getByRole('button', { name: `Duplicate ${base}`, exact: true }).click(); await sleep(600);
  const afterDup = await customCount();
  const renameBtns = page.locator('button[aria-label^="Rename QA2"]');
  await renameBtns.last().click(); await sleep(300);
  const dlg = page.locator('[role=dialog]').last();
  await dlg.locator('input').fill('   '); const emptyDisabled = !(await dlg.getByRole('button', { name: 'Rename' }).isEnabled());
  await dlg.locator('input').fill('QA2 Renamed ' + 'x'.repeat(300)); await dlg.getByRole('button', { name: 'Rename' }).click(); await sleep(500);
  const afterRename = await msg();
  await page.locator('button[aria-label^="Delete QA2 Renamed"]').first().click(); await sleep(300);
  await page.locator('[role=dialog]').last().getByRole('button', { name: 'Delete' }).click(); await sleep(400);
  const afterDelete = await customCount();
  const undo = page.getByRole('button', { name: 'Undo' });
  const hadUndo = await undo.count();
  if (hadUndo) await undo.first().click(); await sleep(500);
  const afterUndo = await customCount();
  const builtInRename = await page.locator('button[aria-label="Rename Ageing Veteran"]').isDisabled();
  return { afterDup, emptyDisabled, afterRename, afterDelete, hadUndo, afterUndo, builtInRename };
});
await step('export-shown', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.getByRole('button', { name: 'Export shown' }).click()]);
  const p = `${OUT}/fighters-all.json`; await dl.saveAs(p);
  const j = JSON.parse(readFileSync(p, 'utf8'));
  return { bytes: readFileSync(p).length, keys: Object.keys(j), fighters: (j.fighters ?? []).length };
});

// ---------- imports ----------
const one = JSON.parse(readFileSync(`${OUT}/fighters-one.json`, 'utf8'));
const oneFighter = (one.fighters ?? [one])[0];
const wrap = (fighters) => JSON.stringify({ ...one, fighters });
res.imports = {};
res.imports.valid = await step('import-valid', () => importFile('valid', readFileSync(`${OUT}/fighters-one.json`, 'utf8')));
res.imports.validAgain = await step('import-valid-again(id collision)', () => importFile('valid2', readFileSync(`${OUT}/fighters-one.json`, 'utf8')));
res.imports.truncated = await step('import-truncated', () => importFile('trunc', readFileSync(`${OUT}/fighters-one.json`, 'utf8').slice(0, 700)));
res.imports.empty = await step('import-empty', () => importFile('empty', ''));
res.imports.notjson = await step('import-binary', () => importFile('bin', '\u0000\u0001PK\u0003\u0004garbage'));
res.imports.array = await step('import-array', () => importFile('array', JSON.stringify([oneFighter, oneFighter])));
res.imports.partial = await step('import-partial', () => importFile('partial', wrap([{ id: 'qa2.partial', name: 'Partial Guy' }, { ...oneFighter, id: 'qa2.partial2', body: undefined }, { ...oneFighter, id: 'qa2.nan', body: { ...oneFighter.body, heightM: 'NaN', fightNightKg: -5 } }])));
res.imports.weird = await step('import-weird-values', () => importFile('weird', wrap([{ ...oneFighter, id: 'qa2.weird', name: 'W'.repeat(100000), physical: Object.fromEntries(Object.keys(oneFighter.physical ?? {}).map((k) => [k, 1e308])) }])));
res.imports.proto = await step('import-__proto__', () => importFile('proto', `{"__proto__":{"polluted":1},"format":${JSON.stringify(one.format ?? null)},"fighters":[${JSON.stringify({ ...oneFighter, id: 'qa2.proto', name: 'Proto' }).replace(/^\{/, '{"__proto__":{"polluted":1,"isAdmin":true},"constructor":{"prototype":{"polluted2":1}},').replace('"physical":{', '"physical":{"__proto__":{"polluted":1},')}]}`));
res.imports.protoId = await step('import-id-__proto__', () => importFile('protoid', wrap([{ ...oneFighter, id: '__proto__', name: 'ProtoId' }, { ...oneFighter, id: 'constructor', name: 'CtorId' }, { ...oneFighter, id: 'hasOwnProperty', name: 'HOP' }])));
res.imports.deep = await step('import-deep-nesting', () => importFile('deep', '{"fighters":[' + JSON.stringify({ ...oneFighter, id: 'qa2.deep' }).replace(/\}$/, ',"notes":' + '['.repeat(20000) + ']'.repeat(20000) + '}') + ']}'));
const big = Array.from({ length: 400 }, (_, i) => ({ ...oneFighter, id: `qa2.bulk.${i}`, name: `Bulk ${i}` }));
res.imports.huge = await step('import-huge-400', async () => { const s = wrap(big); const r = await importFile('huge', s); return { bytes: s.length, ...r }; });
res.afterHuge = await metrics(page, cdp, { gc: true });
res.lsBytes = await page.evaluate(() => { let n = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); n += k.length + (localStorage.getItem(k) ?? '').length; } return n * 2; });

// ---------- reload persistence ----------
await step('reload-persistence', async () => {
  const before = await customCount();
  await page.reload({ waitUntil: 'load' }); await sleep(1500);
  await nav(page, 'Fighters');
  const after = await customCount();
  const names = await page.evaluate(() => [...document.querySelectorAll('button[aria-label^="Delete QA2"], button[aria-label^="Delete Bulk 39"], button[aria-label^="Delete Proto"]')].map((b) => b.getAttribute('aria-label')).slice(0, 8));
  return { before, after, names };
});
await step('fighters-list-with-400', async () => {
  const t0 = Date.now(); await nav(page, 'Match setup'); await nav(page, 'Fighters'); const ms = Date.now() - t0;
  await page.locator('input[type=search]').first().fill('Bulk 1'); await sleep(500);
  return { navMs: ms, nodes: (await metrics(page, cdp)).nodes };
});
// bulk delete via UI of a couple + open one in the editor and run it in Match setup
await step('match-with-custom', async () => {
  await nav(page, 'Match setup');
  const opts = await page.locator('#ms-slot-0 option').allInnerTexts();
  return { options: opts.length, hasCustom: opts.some((o) => o.includes('QA2') || o.includes('Bulk')) };
});
res.final = await metrics(page, cdp, { gc: true });
res.report = await report('fighters', log, page);
save('fighters', res);
console.log(JSON.stringify({ lsBytes: res.lsBytes, afterHuge: res.afterHuge, final: res.final, errors: res.report.errors.slice(0, 8), rej: res.report.rejections, longest: res.report.longestTask, navs: res.report.navs.length }, null, 1));
await close();
