// QA2: cancel a running Match-setup bout after 700 ms; then run again; watch state.
import { launch, nav, report, BASE, sleep } from './qa2-lib.mjs';
const { page, log, close } = await launch();
await page.goto(BASE, { waitUntil: 'load' }); await sleep(1500);
await page.locator('.ms-mode', { hasText: 'Teams' }).click(); await page.selectOption('#ms-preset', '3v3');
const A = ['arch.champion_complete', 'arch.brand_new_brawler', 'arch.pressure_boxer', 'arch.bjj_guard_player', 'arch.judoka', 'arch.counter_striker'];
for (let i = 0; i < 6; i++) await page.selectOption(`#ms-slot-${i}`, A[i]);
await page.locator('#ms-seed').fill('qa2-cancel-3v3');
const st = () => page.evaluate(() => ({ btn: document.querySelector('.ms-head .btn--play')?.textContent, prog: document.querySelector('.ms-progress')?.textContent?.slice(-30) ?? null, err: document.querySelector('.ms-warn--error')?.textContent ?? null, tab: document.querySelector('.nav-item[aria-current=page]')?.id, btns: [...document.querySelectorAll('.ms-head .page-actions button')].map((b) => [b.textContent, Math.round(b.getBoundingClientRect().x)]) }));
console.log('before', JSON.stringify(await st()));
await page.getByRole('button', { name: 'Run bout' }).click();
await sleep(150); console.log('running', JSON.stringify(await st()));
await sleep(550);
await page.locator('.ms-head .page-actions button', { hasText: 'Cancel' }).click({ timeout: 3000 }).then(() => console.log('clicked cancel')).catch((e) => console.log('cancel click failed', String(e).slice(0, 80)));
for (let i = 0; i < 6; i++) { await sleep(500); console.log('after', JSON.stringify(await st())); }
await page.getByRole('button', { name: 'Run bout' }).click();
for (let i = 0; i < 40; i++) { await sleep(500); const s = await st(); if (s.tab === 'tab-result') { console.log('rerun ok', i * 0.5, 's'); break; } }
const r = await report('c2', log, page); console.log(JSON.stringify({ errors: r.errors, rej: r.rejections }));
await close();
