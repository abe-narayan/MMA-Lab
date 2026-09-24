// QA2 modes: run bouts from Match setup in 1v1 / teams / ffa / crowd, check they finish and the Result shows;
// open each in Watch (3D) and check errors; cancel mid-run; double-click Run; then an 8-entrant tournament.
import { launch, metrics, nav, save, report, OUT, BASE, sleep } from './qa2-lib.mjs';

const { page, cdp, log, close } = await launch();
const res = { runs: [] };
const ARCH = ['arch.champion_complete', 'arch.brand_new_brawler', 'arch.pressure_boxer', 'arch.bjj_guard_player', 'arch.counter_striker', 'arch.judoka', 'arch.elite_wrestler_boxer', 'arch.heavyweight_power_puncher', 'arch.gym_fit_beginner'];
const curTab = () => page.evaluate(() => document.querySelector('.nav-item[aria-current=page]')?.id);
async function setup(mode, extra = {}) {
  await nav(page, 'Match setup');
  const MODE = { Crowd: 'One vs many' };
  await page.getByRole('radiogroup', { name: 'Format' }).getByRole('radio', { name: MODE[mode] ?? mode }).click(); await sleep(300);
  if (extra.preset) await page.getByRole('radiogroup', { name: 'Team sizes' }).getByRole('radio', { name: extra.preset }).click();
  if (extra.ffa) await page.getByRole('radiogroup', { name: 'Number of fighters' }).getByRole('radio', { name: String(extra.ffa) }).click();
  if (extra.crowd) await page.getByRole('radiogroup', { name: 'Number of attackers' }).getByRole('radio', { name: String(extra.crowd) }).click();
  // Advanced settings sit in closed <details> sections.
  await page.evaluate(() => document.querySelectorAll('#panel-match details').forEach((d) => { d.open = true; }));
  if (extra.ruleset) await page.selectOption('#ms-ruleset', extra.ruleset);
  if (extra.arena) await page.selectOption('#ms-arena', extra.arena);
  if (extra.maxsec && await page.locator('#ms-maxsec').count()) await page.locator('#ms-maxsec').fill(String(extra.maxsec));
  await sleep(300);
  const slots = await page.locator('select[id^=ms-slot-]').count();
  for (let i = 0; i < slots; i++) await page.selectOption(`#ms-slot-${i}`, ARCH[i % ARCH.length]);
  await page.locator('#ms-seed').fill(`qa2-${mode}-${extra.preset ?? extra.ffa ?? extra.crowd ?? ''}`.replace(/\W+/g, '-'));
  const problems = await page.locator('.setup-problems li, #panel-match .ui-field-error').allInnerTexts().catch(() => []);
  return { slots, problems };
}
async function runAndWait(label, timeoutS = 240) {
  const e0 = log.errors.length; const t0 = Date.now();
  const runBtn = page.getByRole('button', { name: /^(Run bout|Running…)$/ }).first();
  const disabled = await runBtn.isDisabled();
  if (disabled) return { label, disabled: true, why: (await page.locator('main').innerText()).match(/[^\n]*(pick|need|must|choose)[^\n]*/gi)?.slice(0, 3) };
  await runBtn.click();
  let maxHeap = 0; let stuck = false;
  for (let i = 0; ; i++) {
    await sleep(1000);
    const t = await curTab();
    if (t === 'tab-result') break;
    const failed = await page.locator('.ms-warn--error').innerText().catch(() => null);
    if (failed) return { label, failed, ms: Date.now() - t0 };
    if (i % 5 === 0) maxHeap = Math.max(maxHeap, (await metrics(page, cdp)).jsHeapMB);
    if (i > timeoutS) { stuck = true; break; }
  }
  const result = (await page.locator('main [role=tabpanel]:not([hidden]), main').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
  const r = { label, ms: Date.now() - t0, stuck, maxHeap, result: result.slice(0, 260), newErrors: log.errors.slice(e0).map((s) => s.slice(0, 200)) };
  return r;
}
async function watchFromResult(label) {
  const e0 = log.errors.length; const t0 = Date.now();
  const w = page.getByRole('button', { name: /^Watch( the fight)?$/ }).last();
  await w.click();
  let ok = false;
  try { await page.waitForFunction(() => window.__watch?.digest() && window.__ttff?.revealMs > 0 && window.__stats?.fps > 0, null, { timeout: 150000 }); ok = true; } catch { /* */ }
  await page.evaluate(() => { window.__watch?.play(); window.__watch?.speed(4); });
  await sleep(4000);
  await page.evaluate(() => { const t = document.querySelector('input[aria-label=Seek]')?.max; window.__watch?.seek(Math.floor(Number(t) * 0.6)); });
  await sleep(2500);
  const m = await metrics(page, cdp);
  await page.screenshot({ path: `${OUT}/modes-watch-${label}.png` });
  return { ok, ms: Date.now() - t0, digest: await page.evaluate(() => window.__watch?.digest()), fps: m.stats?.fps, heap: m.jsHeapMB, nodes: m.nodes, gpu: m.gpu, newErrors: [...new Set(log.errors.slice(e0).map((s) => s.slice(0, 160)))].slice(0, 5) };
}

await page.goto(BASE, { waitUntil: 'load' }); await sleep(1500);
const cases = [
  ['One on one', {}, '1v1'],
  ['Teams', { preset: '2v2' }, '2v2'],
  ['Teams', { preset: '1v3' }, '1v3'],
  ['Teams', { preset: '3v3' }, '3v3'],
  ['Free-for-all', { ffa: 4 }, 'ffa4'],
  ['Crowd', { crowd: 4, ruleset: 'street', arena: 'street_open', maxsec: 120 }, 'crowd4'],
];
for (const [mode, extra, label] of (process.argv.includes('--skip-modes') ? [] : cases)) {
  const s = await setup(mode, extra);
  const r = await runAndWait(label);
  r.setup = s;
  if (!r.disabled && !r.failed && !r.stuck) r.watch = await watchFromResult(label);
  res.runs.push(r);
  console.log(JSON.stringify(r).slice(0, 900));
}
// Cancel mid-run and double-click Run
await nav(page, 'History'); await sleep(300);
res.historyBefore = (await page.locator('main').innerText()).match(/The last (\d+) bouts/)?.[1];
await setup('Teams', { preset: '2v2' });
await page.locator('#ms-seed').fill('qa2-cancel');
await page.getByRole('button', { name: 'Run bout' }).first().dblclick();
await sleep(3000);
res.cancel = { runningText: await page.locator('.ms-progress').innerText().catch(() => null) };
await page.getByRole('button', { name: 'Cancel' }).click().catch((e) => { res.cancel.err = String(e).slice(0, 100); });
await sleep(1500);
res.cancel.after = { tab: await curTab(), btn: await page.locator('.ms-head .page-actions .ui-btn--primary').innerText(), status: await page.locator('.ms-progress, .ms-warn--error').allInnerTexts() };
// run again after cancel
res.cancel.rerun = await runAndWait('after-cancel');
console.log('cancel', JSON.stringify(res.cancel).slice(0, 600));
// History count
await nav(page, 'History'); await sleep(500);
res.history = (await page.locator('main').innerText()).match(/The last (\d+) bouts/)?.[1];

// ---------- tournament ----------
const e0 = log.errors.length;
await nav(page, 'Tournaments');
await page.locator('#tr-name').fill('QA2 Cup');
await page.getByRole('radiogroup', { name: 'Draw size' }).getByRole('radio', { name: '8' }).click();
const boxes = page.locator('.tr-entrant input[type=checkbox]');
const nBoxes = await boxes.count();
for (let i = 0; i < Math.min(8, nBoxes); i++) if (!(await boxes.nth(i).isChecked())) await boxes.nth(i).check();
await page.getByRole('button', { name: 'Create bracket' }).click(); await sleep(800);
const t0 = Date.now(); let runs = 0; let stalled = false;
for (;;) {
  const btn = page.locator('.tr-next-row button').first();
  if (!(await btn.count())) break;
  await btn.click(); runs++;
  const s = Date.now();
  await page.waitForFunction(() => ![...document.querySelectorAll('.tr-next-row button')].some((b) => b.textContent === 'Running…'), null, { timeout: 240000 }).catch(() => { stalled = true; });
  if (stalled || runs > 20) break;
  if (Date.now() - s > 200000) break;
}
await page.screenshot({ path: `${OUT}/modes-tournament.png` });
res.tournament = { runs, stalled, ms: Date.now() - t0, text: (await page.locator('.tr-bracket').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400), champion: (await page.locator('main').innerText()).match(/[^\n]* wins QA2 Cup[^\n]*/)?.[0] ?? null, decided: (await page.locator('main').innerText()).match(/\d+ of \d+ matches decided/)?.[0], newErrors: log.errors.slice(e0).map((s) => s.slice(0, 200)) };
console.log('tournament', JSON.stringify(res.tournament));
res.final = await metrics(page, cdp, { gc: true });
res.report = await report('modes', log, page);
save('modes', res);
console.log(JSON.stringify({ history: res.history, final: res.final, errors: res.report.errors.length, uniqErr: [...new Set(res.report.errors.map((e) => e.slice(0, 120)))].slice(0, 6), rej: res.report.rejections, longest: res.report.longestTask }, null, 1));
await close();
