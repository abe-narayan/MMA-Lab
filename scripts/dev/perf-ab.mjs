#!/usr/bin/env node
/**
 * In-page A/B of the performance pass: the same frame of the same shot, rendered alternately with
 * the pre-pass paths (three's DepthOfFieldNode + SharpenNode pass, ungated skin, fixed 0.4 m GTAO
 * radius) and the current ones, in blocks of back-to-back frames. The GPU is shared with other
 * processes, whose work only adds time, so alternating blocks and taking each side's median of
 * block p25s cancels the drift that makes page-to-page comparisons useless on a busy machine.
 *
 *   node scripts/dev/heavy.mjs node scripts/dev/perf-ab.mjs <base-url> [--shots main,cageside] [--rounds 5]
 *        [--size 2560x1440] [--only dof|skin|ao|sharpen|skindup|fencelens]
 *
 * Performance pass 2 modes (the "legacy" side is the pre-pass-2 path, same frame):
 *   skindup    every body's skin swapped for the same graph built with the old debug `select`,
 *              which emitted the whole surface graph twice (`legacySelect`);
 *   fencelens  the chain-link's lens held at the old fixed focus 3.5 m / aperture 9 mm
 *              (`presenter.fenceLensLive = false`) instead of the shot's.
 *
 * Needs `?gpuTiming=1&stagePost=abLegacy:1&fixedRes=1` (added). Prints one JSON line per shot:
 * legacy ms, new ms, saving, and per-pass medians of each side.
 */
import { chromium } from 'playwright';
import { captureGoto } from './capture-url.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
let url = args[0];
const add = (kv) => { url += (url.includes('?') ? '&' : '?') + kv; };
add('gpuTiming=1'); add('stagePost=abLegacy:1'); add('fixedRes=1');
if (!/quality=/.test(url)) add('quality=high');
const [w, h] = opt('size', '2560x1440').split('x').map(Number);
const rounds = Number(opt('rounds', '5'));
const only = opt('only', 'all');
const SHOTS = {
  main: ['main', 'strike', 6, 0], mainTight: ['mainTight', 'strike', 6, 0], cageside: ['cageside', 'strike', 6, 0],
  ground: ['ground', 'takedown', 0, 40], corner: ['corner', 'roundEnd', 0, 420], finish: ['finish', 'end', 0, 0],
  overhead: ['overhead', 'takedown', 0, 40],
};
const names = opt('shots', 'main,mainTight,cageside,ground,corner,finish').split(',');

const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
captureGoto(page); // ?capture=1: QA switches in production builds (capture-url.mjs)
await page.goto(url, { waitUntil: 'load', timeout: 240000 });
const live = () => page.waitForFunction(() => document.querySelector('[data-phase="live"]') && window.__watch && window.__presenter, null, { timeout: 240000 });
await live();
for (const name of names) {
  const [lock, ev, nth, off] = SHOTS[name];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await live();
      const evs = await page.evaluate(() => window.__watch.events());
      const list = ev === 'end' ? [{ tick: Math.max(...evs.map((e) => e.tick)) }] : evs.filter((e) => e.kind === ev);
      const e = list[Math.min(list.length - 1, nth)];
      if (!e) { console.log(JSON.stringify({ shot: name, skipped: `no ${ev}` })); break; }
      await page.evaluate(() => window.__watch.camera('broadcast'));
      await page.evaluate((t) => window.__watch.seek(t), e.tick + off);
      await page.evaluate((k) => window.__presenter.camera.lockShot(k), lock);
      await page.waitForTimeout(3500);
      const r = await page.evaluate(async ({ rounds, only }) => {
        const st = window.__presenter.stage;
        const pl = st.pipeline;
        const radius = pl.aoNode?.radius.value;
        let skinSwap = null;
        if (only === 'skindup') {
          const mod = await import('/src/presentation/character/skinMaterial.ts');
          const bodies = [];
          st.scene.traverse((o) => { if (o.isSkinnedMesh && /^body-lod/.test(o.name)) bodies.push(o); });
          const cur = bodies.map((o) => o.material);
          const alt = new Map();
          for (const m of new Set(cur)) { const a = m.userData.skinArgs; alt.set(m, mod.createSkinMaterial(a.tex, { ...a.opt, legacySelect: true })); }
          skinSwap = (legacy) => bodies.forEach((o, i) => { o.material = legacy ? alt.get(cur[i]) : cur[i]; });
        }
        const pr = window.__presenter;
        const set = (legacy) => {
          if (skinSwap) { skinSwap(legacy); return; }
          if (only === 'fencelens') {
            pr.fenceLensLive = !legacy;
            const fl = pr.arena?.fenceLens;
            if (legacy && fl) { fl.focus.value = 3.5; fl.aperture.value = 0.009; }
            if (!legacy && fl) { const l = pr.stage.fenceLens(pr.lastShot); fl.focus.value = l.focus; fl.aperture.value = l.aperture; }
            return;
          }
          if (only === 'all' || only === 'dof' || only === 'sharpen') pl.useLegacy = legacy;
          if (only === 'all' || only === 'skin') window.__skinGatesOff.value = legacy ? 1 : 0;
          if ((only === 'all' || only === 'ao') && pl.aoNode) { st.aoClamp = !legacy; pl.aoNode.radius.value = legacy ? 0.4 : radius; }
        };
        const A = [], B = [], PA = [], PB = [];
        for (let i = 0; i < rounds; i++) {
          for (const legacy of [true, false]) {
            set(legacy);
            await st.passTimes(6); // settle (history, pipelines)
            const p = await st.passTimes(24);
            (legacy ? A : B).push(p.total); (legacy ? PA : PB).push(p.passes);
          }
        }
        set(false);
        const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
        const passMed = (ps) => { const k = new Set(ps.flatMap((p) => Object.keys(p))); const o = {}; for (const x of k) o[x] = med(ps.map((p) => p[x] ?? 0)); return o; };
        return { legacy: med(A), now: med(B), legacyAll: A, nowAll: B, passesLegacy: passMed(PA), passesNow: passMed(PB), internal: `${window.__stats?.internalWidth}x${window.__stats?.internalHeight}`, shot: window.__stats?.shot };
      }, { rounds, only });
      const round2 = (x) => Math.round(x * 100) / 100;
      console.log(JSON.stringify({ shot: name, name: r.shot, internal: r.internal, legacyMs: r.legacy, nowMs: r.now, savedMs: round2(r.legacy - r.now), legacyAll: r.legacyAll, nowAll: r.nowAll, passesLegacy: r.passesLegacy, passesNow: r.passesNow }));
      await page.evaluate(() => window.__presenter.camera.lockShot(null));
      break;
    } catch (err) {
      if (attempt === 2) console.log(JSON.stringify({ shot: name, error: String(err).slice(0, 200) }));
      await page.waitForTimeout(3000);
    }
  }
}
await browser.close();
