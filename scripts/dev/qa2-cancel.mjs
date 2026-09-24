// QA2: Match setup run state over time for a long bout (single click, double click), and Cancel.
import { launch, nav, report, OUT, BASE, sleep } from './qa2-lib.mjs';
const { page, log, close } = await launch();
await page.goto(BASE, { waitUntil: 'load' }); await sleep(1500);
await nav(page, 'Match setup');
await page.getByRole('radiogroup', { name: 'Format' }).getByRole('radio', { name: 'Teams' }).click(); await sleep(300);
await page.getByRole('radiogroup', { name: 'Team sizes' }).getByRole('radio', { name: '2v2' }).click();
const A = ['arch.champion_complete', 'arch.brand_new_brawler', 'arch.pressure_boxer', 'arch.bjj_guard_player'];
for (let i = 0; i < 4; i++) await page.selectOption(`#ms-slot-${i}`, A[i]);
const state = () => page.evaluate(() => ({ t: Math.round(performance.now()), btn: document.querySelector('.ms-head .page-actions .ui-btn--primary')?.textContent, dis: document.querySelector('.ms-head .page-actions .ui-btn--primary')?.disabled, prog: document.querySelector('.ms-progress')?.textContent?.slice(-40) ?? null, cancel: !!document.querySelector('.ms-head .page-actions button:not(.ui-btn--primary)'), tab: document.querySelector('.nav-item[aria-current=page]')?.id }));
for (const how of (process.argv[2] ? [process.argv[2]] : ['click', 'dblclick'])) {
  await nav(page, 'Match setup');
  await page.locator('#ms-seed').fill(how === 'cancel' ? 'qa2-cancel' : `qa2-cancel-${how}`);
  const s = [];
  if (how !== 'dblclick') await page.getByRole('button', { name: 'Run bout' }).first().click(); else await page.getByRole('button', { name: 'Run bout' }).first().dblclick();
  for (let i = 0; i < 12; i++) { s.push(await state()); await sleep(400); }
  console.log(how, JSON.stringify(s.filter((x, i) => i % 2 === 0)));
  const cancel = page.locator('.ms-head .page-actions button', { hasText: 'Cancel' });
  if (await cancel.count()) { await cancel.click(); await sleep(800); console.log('after cancel', JSON.stringify(await state())); }
  else { for (let i = 0; i < 60; i++) { const st = await state(); if (st.tab === 'tab-result') break; await sleep(1000); } console.log('no cancel; final', JSON.stringify(await state())); }
}
await nav(page, 'History'); await sleep(400);
console.log('history', (await page.locator('main').innerText()).match(/The last (\d+) bouts/)?.[0], (await page.locator('main').innerText()).split('qa2-cancel').length - 1);
const r = await report('c', log, page); console.log(JSON.stringify({ errors: r.errors, rej: r.rejections }));
await close();
