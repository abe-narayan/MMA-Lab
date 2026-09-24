// QA2 leak check: generate N bouts (varied rulesets/arenas), then switch the Watch screen between them from History,
// sampling heap (after forced GC), DOM nodes, listeners and GPU resource counts after every switch.
// node scripts/dev/heavy.mjs node scripts/dev/qa2-leak.mjs [N=24] [--webgl] [--quality medium]
import { launch, metrics, nav, save, report, OUT, BASE, sleep } from './qa2-lib.mjs';

const args = process.argv.slice(2);
const N = Number(args.find((a) => /^\d+$/.test(a)) ?? 24);
const webgl = args.includes('--webgl');
const q = args.includes('--quality') ? args[args.indexOf('--quality') + 1] : 'medium';
const { page, cdp, log, close, peakRam } = await launch();
const res = { N, webgl, q, gen: [], switches: [] };
const ARCH = ['arch.champion_complete', 'arch.brand_new_brawler', 'arch.pressure_boxer', 'arch.bjj_guard_player', 'arch.counter_striker', 'arch.judoka', 'arch.elite_wrestler_boxer', 'arch.heavyweight_power_puncher', 'arch.gym_fit_beginner', 'arch.ageing_veteran', 'arch.flyweight_volume_striker'];
const RA = [['mma.unified.3r', 'octagon_30'], ['boxing.pro', 'ring_20'], ['grappling.ibjjf', 'mat_ibjjf'], ['mma.unified.3r', 'octagon_25'], ['kickboxing.glory', 'ring_24'], ['muay_thai.abc', 'ring_16'], ['mma.amateur', 'octagon_30'], ['street', 'street_open']];
const curTab = () => page.evaluate(() => document.querySelector('.nav-item[aria-current=page]')?.id);

await page.goto(`${BASE}?quality=${q}${webgl ? '&backend=webgl2' : ''}`, { waitUntil: 'load' }); await sleep(1500);
// ---- generate bouts ----
for (let i = 0; i < N; i++) {
  await nav(page, 'Match setup');
  const [rs, ar] = RA[i % RA.length];
  await page.selectOption('#ms-ruleset', rs).catch(() => {});
  await page.selectOption('#ms-arena', ar).catch(() => {});
  await page.selectOption('#ms-slot-0', ARCH[i % ARCH.length]);
  await page.selectOption('#ms-slot-1', ARCH[(i * 3 + 1) % ARCH.length] === ARCH[i % ARCH.length] ? ARCH[(i + 1) % ARCH.length] : ARCH[(i * 3 + 1) % ARCH.length]);
  if (rs === 'street' && await page.locator('#ms-maxsec').count()) await page.locator('#ms-maxsec').fill('120');
  await page.locator('#ms-seed').fill(`qa2-leak-${i}`);
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Run bout' }).click();
  for (let k = 0; k < 240; k++) { await sleep(500); if ((await curTab()) === 'tab-result') break; }
  const digest = (await page.locator('#panel-result').innerText()).match(/digest ([0-9a-f]{8})/)?.[1];
  res.gen.push({ i, rs, ar, ms: Date.now() - t0, digest });
}
console.log('generated', res.gen.map((g) => `${g.i}:${g.digest}:${(g.ms / 1000).toFixed(1)}s`).join(' '));
await nav(page, 'History'); await sleep(600);
res.historyCount = await page.locator('button', { hasText: 'Re-watch' }).count();
res.baseline = await metrics(page, cdp, { gc: true });

// ---- switch ----
for (let s = 0; s < res.historyCount; s++) {
  const e0 = log.errors.length; const t0 = Date.now();
  await nav(page, 'History'); await sleep(200);
  await page.evaluate(() => { window.__ttff = undefined; });
  const expected = await page.locator('#panel-history tbody tr').nth(s).innerText().then((t) => t.replace(/\s+/g, ' ').slice(0, 80));
  await page.locator('#panel-history tbody tr').nth(s).locator('button', { hasText: 'Re-watch' }).click();
  let ok = true;
  try { await page.waitForFunction(() => window.__ttff?.revealMs > 0 && window.__watch?.digest(), null, { timeout: 120000 }); } catch { ok = false; }
  const loadMs = Date.now() - t0;
  await page.evaluate(() => { window.__watch?.speed(4); window.__watch?.play(); });
  await sleep(2500);
  await page.evaluate(() => { const t = Number(document.querySelector('input[aria-label=Seek]')?.max ?? 0); window.__watch?.seek(Math.floor(t * 0.7)); });
  await sleep(1500);
  const m = await metrics(page, cdp, { gc: true });
  const row = { s, ok, loadMs, digest: await page.evaluate(() => window.__watch?.digest()), expected: expected.slice(0, 50), heap: m.jsHeapMB, nodes: m.nodes, listeners: m.listeners, gpu: m.gpu, fps: m.stats?.fps, draw: m.stats?.draw, errs: log.errors.length - e0, firstErr: log.errors[e0]?.slice(0, 160), ram: m.ram };
  res.switches.push(row);
  console.log(JSON.stringify(row));
}
// back-and-forth between two bouts 10x quickly (switch before the previous finished loading)
const e1 = log.errors.length;
for (let k = 0; k < 10; k++) {
  await nav(page, 'History');
  await page.locator('#panel-history tbody tr').nth(k % 2).locator('button', { hasText: 'Re-watch' }).click();
  await sleep(700 + (k % 3) * 400);
}
try { await page.waitForFunction(() => window.__ttff?.revealMs > 0 && window.__watch?.digest(), null, { timeout: 120000 }); res.rapidOk = true; } catch { res.rapidOk = false; }
await sleep(3000);
res.rapid = { ...(await metrics(page, cdp, { gc: true })), errs: log.errors.length - e1, firstErr: log.errors[e1]?.slice(0, 200) };
await page.screenshot({ path: `${OUT}/leak-end${webgl ? '-webgl' : ''}.png` });
res.final = await metrics(page, cdp, { gc: true });
res.report = await report('leak', log, page);
res.peakRam = peakRam();
save(`leak${webgl ? '-webgl' : ''}`, res);
const h = res.switches.map((r) => r.heap); const n = res.switches.map((r) => r.nodes);
console.log(JSON.stringify({ baseline: res.baseline, heapFirst: h.slice(0, 3), heapLast: h.slice(-3), nodesFirst: n.slice(0, 3), nodesLast: n.slice(-3), gpuFirst: res.switches[0]?.gpu, gpuLast: res.switches.at(-1)?.gpu, rapidOk: res.rapidOk, rapid: res.rapid, errors: res.report.errors.length, uniq: [...new Set(res.report.errors.map((e) => e.slice(0, 140)))].slice(0, 6), rej: res.report.rejections, longest: res.report.longestTask, peakRam: res.peakRam }, null, 1));
await close();
