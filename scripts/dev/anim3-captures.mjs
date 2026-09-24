#!/usr/bin/env node
/**
 * Draw the animation quality pass 3 before / after captures from the data of
 * `anim3-captures.ts` (run once against the previous animation code, once
 * against the current) and screenshot them into docs/screenshots/anim3-*.png.
 *
 *   node scripts/dev/heavy.mjs node scripts/dev/anim3-captures.mjs before.json after.json [outDir]
 *
 * 2D canvas only (headless Chromium, no server).
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const [beforeFile, afterFile, outDir = 'docs/screenshots'] = process.argv.slice(2);
const before = JSON.parse(readFileSync(beforeFile, 'utf8'));
const after = JSON.parse(readFileSync(afterFile, 'utf8'));
mkdirSync(outDir, { recursive: true });

const page = `<!doctype html><html><head><style>
body{margin:0;background:#12151b;font:14px system-ui,sans-serif;color:#dfe6ee}
.cap{padding:14px 18px;background:#12151b;display:inline-block}
h2{margin:0 0 4px;font-size:17px;font-weight:600}
p{margin:0 0 10px;color:#9aa6b2;font-size:13px;max-width:1360px}
canvas{display:block}
</style></head><body><div id="root"></div><script>
const B = ${JSON.stringify(before)};
const A = ${JSON.stringify(after)};
function panel(id, title, note, w, h) {
  const div = document.createElement('div'); div.className = 'cap'; div.id = id;
  div.innerHTML = '<h2>'+title+'</h2><p>'+note+'</p>';
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; div.appendChild(cv);
  document.getElementById('root').appendChild(div);
  return cv.getContext('2d');
}
// Top-down footprints: the root path, every plant of each foot (numbered), the landing of each step.
function plants(tr) {
  const out = [[], []];
  for (const s of [0, 1]) {
    let prevOn = false;
    tr.on[s].forEach((on, i) => { if (on && !prevOn) out[s].push({ i, p: tr.toe[s][i] }); prevOn = on; });
  }
  return out;
}
function footprints(ctx, tr, x0, y0, W, H, label) {
  ctx.fillStyle = '#161a22'; ctx.fillRect(x0, y0, W, H);
  const pts = tr.root.concat(tr.toe[0], tr.toe[1]);
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...zs) - Math.min(...zs)) * W / H, 0.5) * 1.15;
  const k = W / span;
  const X = (p) => x0 + W / 2 + (p[0] - cx) * k, Y = (p) => y0 + H / 2 - (p[1] - cz) * k;
  ctx.strokeStyle = '#3a4250'; ctx.lineWidth = 1; for (let m = -5; m <= 5; m++) { const gx = x0 + W/2 + (Math.round(cx) + m*0.5 - cx)*k; if (gx > x0 && gx < x0+W) { ctx.beginPath(); ctx.moveTo(gx, y0); ctx.lineTo(gx, y0+H); ctx.stroke(); } }
  ctx.strokeStyle = '#9aa6b2'; ctx.lineWidth = 2; ctx.beginPath(); tr.root.forEach((p, i) => i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p))); ctx.stroke();
  const pl = plants(tr);
  const col = ['#e0574f', '#4f8fe0'];
  let n = 0;
  for (const s of [0, 1]) {
    ctx.strokeStyle = col[s]; ctx.lineWidth = 1; ctx.beginPath(); tr.toe[s].forEach((p, i) => i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p))); ctx.globalAlpha = 0.35; ctx.stroke(); ctx.globalAlpha = 1;
    for (const q of pl[s]) { ctx.fillStyle = col[s]; ctx.beginPath(); ctx.arc(X(q.p), Y(q.p), 4, 0, 7); ctx.fill(); n++; }
  }
  const metres = tr.root.reduce((a, p, i) => i ? a + Math.hypot(p[0] - tr.root[i-1][0], p[1] - tr.root[i-1][1]) : 0, 0);
  ctx.fillStyle = '#dfe6ee'; ctx.font = '600 14px system-ui'; ctx.fillText(label, x0 + 10, y0 + 20);
  ctx.font = '13px system-ui'; ctx.fillStyle = '#9aa6b2';
  ctx.fillText((n - 2) + ' steps over ' + metres.toFixed(2) + ' m of root travel in ' + (tr.t[tr.t.length-1] - tr.t[0]).toFixed(1) + ' s', x0 + 10, y0 + 38);
  ctx.fillText('grey: displayed root   red / blue: left / right ball of the foot (dots: where it landed)', x0 + 10, y0 + H - 10);
}
function chart(ctx, x0, y0, W, H, label, unit, lo, hi, lines, shade) {
  ctx.fillStyle = '#161a22'; ctx.fillRect(x0, y0, W, H);
  ctx.fillStyle = '#dfe6ee'; ctx.font = '600 14px system-ui'; ctx.fillText(label, x0 + 10, y0 + 20);
  const L = x0 + 60, R = x0 + W - 16, T = y0 + 34, Bt = y0 + H - 26;
  const t = lines[0].t, tmin = t[0], tmax = t[t.length - 1];
  const X = (v) => L + (v - tmin) / (tmax - tmin) * (R - L), Y = (v) => Bt - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * (Bt - T);
  if (shade) { ctx.fillStyle = 'rgba(240,200,80,0.08)'; for (const [a, b] of shade) ctx.fillRect(X(a), T, Math.max(1, X(b) - X(a)), Bt - T); }
  ctx.strokeStyle = '#3a4250'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, Bt); ctx.lineTo(R, Bt); ctx.stroke();
  ctx.fillStyle = '#9aa6b2'; ctx.font = '12px system-ui';
  for (let k = 0; k <= 4; k++) { const v = lo + (hi - lo) * k / 4; ctx.fillText(v.toFixed(0), x0 + 8, Y(v) + 4); }
  ctx.fillText(unit, L + 6, T - 4);
  for (let k = 0; k <= 4; k++) { const v = tmin + (tmax - tmin) * k / 4; ctx.fillText(v.toFixed(1) + ' s', X(v) - 14, Bt + 18); }
  let lx = R - 330;
  for (const ln of lines) {
    ctx.strokeStyle = ln.col; ctx.lineWidth = ln.w || 1.6; ctx.beginPath();
    ln.v.forEach((v, i) => { const x = X(ln.t[i]), y = Y(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
    ctx.fillStyle = ln.col; ctx.fillRect(lx, T - 14, 14, 4); ctx.fillStyle = '#dfe6ee'; ctx.fillText(ln.name, lx + 20, T - 8); lx += 165;
  }
}
function hist(ctx, x0, y0, W, H, label, unit, edges, series) {
  ctx.fillStyle = '#161a22'; ctx.fillRect(x0, y0, W, H);
  ctx.fillStyle = '#dfe6ee'; ctx.font = '600 14px system-ui'; ctx.fillText(label, x0 + 10, y0 + 20);
  const L = x0 + 50, R = x0 + W - 16, T = y0 + 44, Bt = y0 + H - 28;
  const nb = edges.length - 1;
  const counts = series.map((s) => { const c = new Array(nb).fill(0); for (const v of s.v) { let k = edges.findIndex((e, i) => i < nb && v >= e && v < edges[i + 1]); if (k < 0) k = v < edges[0] ? 0 : nb - 1; c[k]++; } return c.map((x) => x / Math.max(1, s.v.length)); });
  const mx = Math.max(...counts.flat()) * 1.1;
  const bw = (R - L) / nb;
  counts.forEach((c, si) => { ctx.fillStyle = series[si].col; c.forEach((f, k) => { const h = f / mx * (Bt - T); ctx.fillRect(L + k * bw + 2 + si * (bw - 4) / series.length, Bt - h, (bw - 4) / series.length - 1, h); }); });
  ctx.strokeStyle = '#3a4250'; ctx.beginPath(); ctx.moveTo(L, Bt); ctx.lineTo(R, Bt); ctx.stroke();
  ctx.fillStyle = '#9aa6b2'; ctx.font = '12px system-ui';
  for (let k = 0; k <= nb; k += Math.max(1, Math.round(nb / 10))) ctx.fillText(String(edges[k]), L + k * bw - 6, Bt + 16);
  ctx.fillText('(' + unit + '; the last bar holds everything beyond)', L, T - 6);
  let lx = x0 + W - 520;
  for (const s of series) { ctx.fillStyle = s.col; ctx.fillRect(lx, y0 + 26, 14, 8); ctx.fillStyle = '#dfe6ee'; ctx.fillText(s.name, lx + 20, y0 + 34); lx += 260; }
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };
const pooled = (D, k) => D.steps.flatMap((s) => s[k]);
const rate = (D) => { const n = D.steps.reduce((a, s) => a + s.len.length, 0), m = D.steps.reduce((a, s) => a + s.rootM, 0), t = D.steps.reduce((a, s) => a + s.standS, 0); return [n / m, n / t * 60]; };

{
  const ctx = panel('footwork', 'Six seconds of travel (MMA bout, the champion, from ' + A.footwork.from.toFixed(1) + ' s): where the feet land',
    'Top-down view. Before: the footwork planned each step from the raw recorded velocity, which surges and stops every 100 ms tick, and re-stepped whenever a foot was 5.6 cm out of place while moving: many short, quick catch-up steps. After: steps are planned from the smoothed travel velocity and aimed a stride ahead (the stride grows with the speed), so the same travel is covered in fewer, longer steps; planted feet stay planted.', 1400, 460);
  footprints(ctx, B.footwork, 0, 0, 690, 460, 'Before');
  footprints(ctx, A.footwork, 710, 0, 690, 460, 'After');
}
{
  const ctx = panel('legs', 'A close-range boxing exchange (68-72 s): shin angular speed relative to the thigh, and the hips',
    'Spikes are one-frame pops (the audit counts > 6°/frame and 2.5× both neighbours). Before: a punch\\'s reach assist moved the hips by the arm IK\\'s leftover error — up to its 20 cm cap and back from frame to frame — and the pelvis reach clamp dropped the hips 3-12 cm in a frame when a foot neared the leg\\'s length; every lift-off and landing started at full speed. After: the assist carries only the geometric shortfall (smooth), the clamp is C¹ and the hips rise back from a drop with inertia, and lift-off / landing ease in and out.', 1400, 620);
  const sh = (D) => D.boxing.shin[0].map((v, i) => Math.max(v, D.boxing.shin[1][i]));
  chart(ctx, 0, 0, 1400, 300, 'Shin angular speed (faster of the two legs)', 'degrees / frame', 0, 40,
    [{ name: 'before', col: '#e0574f', t: B.boxing.t, v: sh(B) }, { name: 'after', col: '#5fd08a', t: A.boxing.t, v: sh(A) }]);
  chart(ctx, 0, 310, 1400, 300, 'Hips: horizontal distance from the displayed root', 'cm', 0, 40,
    [{ name: 'before', col: '#e0574f', t: B.boxing.t, v: B.boxing.lunge }, { name: 'after', col: '#5fd08a', t: A.boxing.t, v: A.boxing.lunge }]);
}
{
  const ctx = panel('steps', 'Every standing step in four audit bouts (MMA, boxing, K-1, amateur novices)',
    'Step length (plant to plant, scaled to a 1.73 m fighter) and swing time (ball off the floor). Before: ' + pooled(B, 'len').length + ' steps, median ' + med(pooled(B, 'len')).toFixed(0) + ' cm / ' + (med(pooled(B, 'dur')) * 1000).toFixed(0) + ' ms, ' + rate(B)[0].toFixed(1) + ' per metre of root travel, ' + rate(B)[1].toFixed(0) + ' per standing minute. After: ' + pooled(A, 'len').length + ' steps, median ' + med(pooled(A, 'len')).toFixed(0) + ' cm / ' + (med(pooled(A, 'dur')) * 1000).toFixed(0) + ' ms, ' + rate(A)[0].toFixed(1) + ' per metre, ' + rate(A)[1].toFixed(0) + ' per minute. Reference (assumed): boxing step-drag ~15-25 cm adjusting, 35-50 cm travelling; the capture library\\'s own step takes 50-85 cm per foot with 0.3-0.4 s swings.', 1400, 300);
  hist(ctx, 0, 0, 690, 300, 'Step length', 'cm', [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 80],
    [{ name: 'before', col: '#e0574f', v: pooled(B, 'len') }, { name: 'after', col: '#5fd08a', v: pooled(A, 'len') }]);
  hist(ctx, 710, 0, 690, 300, 'Swing time', 'ms', [0, 50, 100, 150, 200, 250, 300, 350, 400, 500, 800],
    [{ name: 'before', col: '#e0574f', v: pooled(B, 'dur').map((x) => x * 1000) }, { name: 'after', col: '#5fd08a', v: pooled(A, 'dur').map((x) => x * 1000) }]);
}
window.__ready = true;
</script></body></html>`;

const browser = await chromium.launch({ headless: true });
const p = await browser.newPage({ viewport: { width: 1500, height: 1200 }, deviceScaleFactor: 1 });
await p.setContent(page);
await p.waitForFunction('window.__ready === true');
for (const id of ['footwork', 'legs', 'steps']) {
  const el = await p.$('#' + id);
  const file = join(outDir, `anim3-${id}.png`);
  await el.screenshot({ path: file });
  console.log('wrote', file);
}
await browser.close();
