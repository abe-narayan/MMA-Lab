// QA2 Watch/replay: transport, scrubbing, speeds, stepping, cameras, markers, replays, loop, quality switching,
// save/load/library/download/import; asserts the digest and end-of-bout stats never change.
// Usage: node scripts/dev/heavy.mjs node scripts/dev/qa2-watch.mjs [--webgl] [--quality high]
import { launch, metrics, save, report, OUT, BASE, sleep } from './qa2-lib.mjs';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const webgl = args.includes('--webgl');
const q0 = args.includes('--quality') ? args[args.indexOf('--quality') + 1] : null;
const tag = `watch${webgl ? '-webgl' : ''}${q0 ? '-' + q0 : ''}`;
const { page, cdp, log, close, peakRam } = await launch();
const res = { phases: [], checks: {} };
const phase = async (name, fn) => {
  const e0 = log.errors.length; const t0 = Date.now();
  let err = null;
  try { await fn(); } catch (e) { err = String(e).slice(0, 300); }
  const m = await metrics(page, cdp);
  res.phases.push({ name, ms: Date.now() - t0, err, newErrors: log.errors.slice(e0).map((s) => s.slice(0, 200)), m });
  console.log(`${name}: ${Date.now() - t0}ms ${err ? 'ERR ' + err : ''} errs+${log.errors.length - e0} heap ${m.jsHeapMB} nodes ${m.nodes} fps ${m.stats?.fps} frameMs ${m.stats?.frameMs} gpu ${JSON.stringify(m.gpu)}`);
};
const blur = () => page.evaluate(() => document.activeElement?.blur?.());
const key = async (k, n = 1) => { await blur(); for (let i = 0; i < n; i++) await page.keyboard.press(k); };
const snapshotEnd = async () => {
  const total = await page.locator('input[aria-label=Seek]').getAttribute('max');
  await page.evaluate((t) => window.__watch.seek(t), Number(total));
  await page.evaluate(() => window.__watch.pause());
  await page.waitForTimeout(1500);
  const stats = await page.evaluate(() => document.querySelector('.watch-analytics .wa-body')?.innerText ?? null);
  const bars = await page.evaluate(() => [...document.querySelectorAll('.watch-fighter, .wf-bar, [class*=fighterbar], [class*=watch-fighters]')].map((e) => e.innerText).join('|').slice(0, 800));
  return { digest: await page.evaluate(() => window.__watch.digest()), total, stats, bars, tick: await page.evaluate(() => window.__watch.tick()) };
};

let url = `${BASE}?watchDemo=1&demo=qa2-watch:3:5${q0 ? '&quality=' + q0 : ''}`;
if (webgl) url += '&backend=webgl2';

await phase('load', async () => {
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__watch && window.__watch.digest() && window.__stats && window.__stats.fps > 0, null, { timeout: 180000 });
  await page.waitForTimeout(2000);
});
res.backend = await page.evaluate(() => window.__stats?.backend);
res.ttff = await page.evaluate(() => window.__ttff ?? null);
await page.evaluate(() => window.__watch.analytics(true, 'stats'));
await page.waitForTimeout(500);
res.before = await snapshotEnd();
console.log('before', res.before.digest, res.before.total, (res.before.stats ?? '').slice(0, 120).replace(/\n/g, ' '));
await page.evaluate(() => window.__watch.seek(0));

// frame times while playing at 1x (3D)
await phase('play-1x-10s', async () => {
  await page.evaluate(() => window.__watch.play());
  const samples = [];
  for (let i = 0; i < 10; i++) { await sleep(1000); samples.push(await page.evaluate(() => ({ t: window.__watch.tick(), fps: window.__stats?.fps, ms: window.__stats?.frameMs, gpu: window.__stats?.gpuMs }))); }
  res.play1x = samples;
});
await phase('pause-resume', async () => {
  const blurB = await blur();
  void blurB;
  await key('Space'); const t1 = await page.evaluate(() => window.__watch.tick()); await sleep(1500);
  const t2 = await page.evaluate(() => window.__watch.tick());
  res.checks.pauseHolds = t1 === t2;
  await key('Space'); await sleep(1500);
  const t3 = await page.evaluate(() => window.__watch.tick());
  res.checks.resumeAdvances = t3 > t2;
  console.log('pause', t1, t2, 'resume', t3);
});
await phase('restart', async () => {
  await key('Home'); await sleep(300);
  res.checks.restartTick = await page.evaluate(() => window.__watch.tick());
});
await phase('speeds', async () => {
  const speeds = ['0.1', '0.25', '0.5', '1', '2', '4'];
  res.speeds = {};
  await page.evaluate(() => window.__watch.play());
  for (const s of speeds) {
    await page.selectOption('select[aria-label="Playback speed"]', s);
    const a = await page.evaluate(() => window.__watch.tick()); await sleep(2000);
    const b = await page.evaluate(() => window.__watch.tick());
    res.speeds[s] = { ticksIn2s: b - a, fps: await page.evaluate(() => window.__stats?.fps) };
  }
  // J/L keyboard up/down past the ends
  await key('KeyL', 6); res.speeds.afterL6 = await page.inputValue('select[aria-label="Playback speed"]');
  await key('KeyJ', 10); res.speeds.afterJ10 = await page.inputValue('select[aria-label="Playback speed"]');
  await key('Shift+KeyK'); res.speeds.afterShiftK = await page.inputValue('select[aria-label="Playback speed"]');
  console.log(JSON.stringify(res.speeds));
});
await phase('scrub-random', async () => {
  const total = Number(res.before.total);
  let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const seeks = [];
  for (let i = 0; i < 60; i++) {
    const t = Math.floor(rnd() * total);
    await page.evaluate((x) => window.__watch.seek(x), t);
    await sleep(40 + Math.floor(rnd() * 120));
    seeks.push([t, await page.evaluate(() => window.__watch.tick())]);
  }
  // reverse sweep via the slider itself
  const box = await page.locator('input[aria-label=Seek]').boundingBox();
  for (let x = 0.95; x >= 0.02; x -= 0.07) { await page.mouse.click(box.x + box.width * x, box.y + box.height / 2); await sleep(60); }
  // drag scrub
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2); await page.mouse.down();
  for (let x = 0.9; x >= 0.1; x -= 0.02) { await page.mouse.move(box.x + box.width * x, box.y + box.height / 2); await sleep(16); }
  await page.mouse.up();
  res.seekMismatch = seeks.filter(([a, b]) => Math.abs(a - b) > 3).slice(0, 10);
});
await phase('frame-step', async () => {
  await page.evaluate(() => { window.__watch.pause(); window.__watch.seek(500); });
  await sleep(300);
  const a = await page.evaluate(() => window.__watch.tick());
  await key('ArrowRight', 25); const b = await page.evaluate(() => window.__watch.tick());
  await key('ArrowLeft', 10); const c = await page.evaluate(() => window.__watch.tick());
  await key('Shift+ArrowRight', 3); const d = await page.evaluate(() => window.__watch.tick());
  await key('Shift+ArrowLeft', 5); const e = await page.evaluate(() => window.__watch.tick());
  await key('Home'); await key('ArrowLeft', 3); const f = await page.evaluate(() => window.__watch.tick());
  await key('End'); await key('ArrowRight', 3); const g = await page.evaluate(() => window.__watch.tick());
  res.steps = { a, b, c, d, e, f, g };
  console.log('steps', JSON.stringify(res.steps));
});
await phase('cameras-1-9', async () => {
  await page.evaluate(() => { window.__watch.seek(1200); window.__watch.play(); });
  res.cams = [];
  for (let r = 0; r < 2; r++) for (let k = 1; k <= 9; k++) {
    await key(`Digit${k}`); await sleep(700);
    res.cams.push([k, await page.inputValue('select[aria-label=Camera]'), await page.evaluate(() => window.__stats?.shot)]);
  }
  for (const v of ['auto', 'main', 'mainTight', 'cageside', 'ground', 'overhead', 'reverse', 'follow', 'free', 'orbit']) {
    await page.selectOption('select[aria-label=Camera]', v); await sleep(400);
  }
  await key('Digit1');
  console.log('cams', JSON.stringify(res.cams));
});
await phase('markers-events', async () => {
  const markers = page.locator('.watch-scrub-lane button');
  const n = await markers.count();
  res.markers = { n, jumps: [] };
  res.markers.fails = [];
  for (let i = 0; i < Math.min(n, 30); i++) {
    const title = await markers.nth(i).getAttribute('title');
    try { await markers.nth(i).click({ timeout: 2500 }); await sleep(250); res.markers.jumps.push([title?.slice(0, 50), await page.evaluate(() => window.__watch.tick())]); } catch (e) { res.markers.fails.push([i, title?.slice(0, 60), String(e).split(/\n/).filter((l) => /intercepts|not visible|outside|stable/.test(l)).slice(0, 2).join(' ').slice(0, 250)]); }
  }
  await key('BracketRight', 8); await key('BracketLeft', 12); await key('Period', 4); await key('Comma', 6);
});
await phase('instant-replays', async () => {
  await page.evaluate(() => { window.__watch.seek(2500); window.__watch.play(); });
  await sleep(1500);
  for (let i = 0; i < 4; i++) { await key('KeyR'); await sleep(1200); }
  const back = page.getByRole('button', { name: 'Back to live' });
  if (await back.count()) await back.first().click();
  const chips = page.locator('.watch-replaybar [aria-label="Instant replays"] button');
  const n = await chips.count();
  for (let i = 0; i < Math.min(n, 5); i++) { await chips.nth(i).click(); await sleep(900); }
  res.replayChips = n;
});
await phase('loop', async () => {
  await page.evaluate(() => { window.__watch.seek(3000); });
  await page.getByRole('button', { name: 'Set loop in' }).click();
  await page.evaluate(() => { window.__watch.seek(3040); window.__watch.play(); });
  await page.getByRole('button', { name: 'Loop to here' }).click();
  await page.selectOption('select[aria-label="Playback speed"]', '4');
  const ticks = [];
  for (let i = 0; i < 12; i++) { await sleep(250); ticks.push(await page.evaluate(() => window.__watch.tick())); }
  res.loopTicks = ticks;
  await page.getByRole('button', { name: /Loop/ }).last().click().catch(() => {});
  await page.selectOption('select[aria-label="Playback speed"]', '1');
});
await phase('analytics-tabs-debug-2d', async () => {
  for (const t of ['stats', 'cards', 'commentary', 'events', 'plan', 'debug', 'stats']) { await page.evaluate((x) => window.__watch.analytics(true, x), t); await sleep(350); }
  await key('KeyD'); await sleep(500); await key('KeyD');
  await key('Shift+Slash'); await sleep(300); await key('Escape');
  await page.evaluate(() => { const d = document.querySelector('details.watch-settings'); if (d) d.open = true; });
  await page.getByRole('radio', { name: '2D board' }).click(); await sleep(2500);
  await page.evaluate(() => window.__watch.play()); await sleep(2000);
  await page.getByRole('radio', { name: '3D broadcast' }).click();
  await page.waitForFunction(() => window.__stats && window.__stats.fps > 0, null, { timeout: 120000 }); await sleep(3000);
});
await phase('quality-switching', async () => {
  await page.evaluate(() => { const d = document.querySelector('details.watch-settings'); if (d) d.open = true; });
  await page.evaluate(() => window.__watch.play());
  res.quality = [];
  for (let r = 0; r < 4; r++) for (const q of ['low', 'medium', 'high', 'ultra']) {
    await page.selectOption('select[aria-label="3D quality"]', q);
    await sleep(r === 0 ? 3500 : 1200);
    res.quality.push([q, await page.evaluate(() => ({ fps: window.__stats?.fps, ms: window.__stats?.frameMs, gpu: window.__stats?.gpuMs, level: window.__stats?.level, draw: window.__stats?.drawCalls }))]);
  }
  // render-scale slider jiggle
  const sl = page.locator('input[aria-label="Render scale"]');
  if (await sl.count()) for (const v of ['0.5', '1', '0.75', '1.5', '0.6']) { await sl.fill(v).catch(() => {}); await sleep(300); }
  await page.selectOption('select[aria-label="3D quality"]', q0 ?? 'medium'); await sleep(2500);
  console.log('quality', JSON.stringify(res.quality));
});
await phase('resize', async () => {
  for (const [w, h] of [[900, 700], [1920, 1080], [600, 900], [1440, 900]]) { await page.setViewportSize({ width: w, height: h }); await sleep(900); }
});
res.after = await snapshotEnd();
res.checks.digestUnchanged = res.after.digest === res.before.digest;
res.checks.statsUnchanged = res.after.stats === res.before.stats;
res.checks.barsUnchanged = res.after.bars === res.before.bars;
console.log('after', JSON.stringify(res.checks));
await page.screenshot({ path: `${OUT}/${tag}-end.png` });

// ---------- save / library / download / import ----------
await phase('save-library', async () => {
  for (let i = 0; i < 3; i++) { await page.locator('.watch-replaybar button', { hasText: /^Save/ }).click(); await sleep(1200); }
  await page.getByRole('button', { name: 'Library', exact: true }).click(); await sleep(1200);
  res.saveButtonName = await page.locator('.watch-replaybar button', { hasText: /^Save/ }).evaluate((b) => b.textContent + ' | aria=' + b.getAttribute('aria-label')).catch(() => null);
  res.libraryRows = await page.locator('.wl-row').count();
  res.libraryText = (await page.locator('.wl-list').innerText().catch(() => '')).slice(0, 400);
  // download from the library dialog
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.locator('.wl-row button[aria-label^=Download]').first().click()]);
  const p = `${OUT}/${tag}-lib.boutreplay`; await dl.saveAs(p); res.libDownload = p;
  await page.locator('.wl-row').first().getByRole('button', { name: 'Open' }).click();
  await sleep(4000);
  res.afterLibOpen = await page.evaluate(() => window.__watch.digest());
});
await phase('download-import', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: 'Download replay file' }).click()]);
  const p = `${OUT}/${tag}.boutreplay`; await dl.saveAs(p); res.download = p;
  await page.getByRole('button', { name: 'Library', exact: true }).click(); await sleep(800);
  const fc = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Import a replay file/ }).click();
  await (await fc).setFiles(p);
  await page.waitForFunction(() => window.__watch?.digest(), null, { timeout: 120000 });
  await sleep(6000);
  res.afterImport = await page.evaluate(() => window.__watch.digest());
  // corrupted imports
  const bad = { empty: Buffer.alloc(0), text: Buffer.from('hello'), json: Buffer.from('{"a":1}'), proto: Buffer.from('{"__proto__":{"polluted":1},"format":4}'), random: Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 7919) % 256)) };
  const { readFileSync } = await import('node:fs');
  const good = readFileSync(p); const flipped = Buffer.from(good); flipped[Math.floor(good.length / 2)] ^= 0xff; bad.flipped = flipped; bad.truncated = good.subarray(0, Math.floor(good.length / 2));
  res.badImports = {};
  for (const [k, buf] of Object.entries(bad)) {
    const f = `${OUT}/${tag}-bad-${k}.boutreplay`; writeFileSync(f, buf);
    if (!(await page.locator('.wl-list, [role=dialog]').count())) { await page.getByRole('button', { name: 'Library', exact: true }).click(); await sleep(500); }
    const fc2 = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Import a replay file/ }).click();
    await (await fc2).setFiles(f);
    await sleep(1500);
    res.badImports[k] = { toast: (await page.locator('[class*=toast]').allInnerTexts().catch(() => [])).join(' | ').slice(0, 250), digest: await page.evaluate(() => window.__watch?.digest()) };
  }
  res.polluted = await page.evaluate(() => ({}).polluted ?? null);
  await page.keyboard.press('Escape');
});
res.final = await metrics(page, cdp, { gc: true });
res.report = await report(tag, log, page);
res.peakRam = peakRam();
save(tag, res);
console.log(JSON.stringify({ backend: res.backend, ttff: res.ttff, checks: res.checks, restart: res.checks.restartTick, lib: [res.libraryRows, res.afterLibOpen], imp: res.afterImport, before: res.before.digest, bad: res.badImports, polluted: res.polluted, final: res.final, errors: res.report.errors.length, rej: res.report.rejections, longest: res.report.longestTask, seekMismatch: res.seekMismatch, peakRam: res.peakRam }, null, 1));
await close();
