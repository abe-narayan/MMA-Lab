#!/usr/bin/env node
/**
 * Draw the animation quality pass's before / after captures from the pose data
 * of `anim-captures.ts` (run once against the previous animation code, once
 * against the current) and screenshot them into docs/screenshots/anim-*.png.
 *
 *   node scripts/dev/anim-captures.mjs before.json after.json [outDir]
 *
 * Stick figures (red: fighter 0, blue: fighter 1; head as a 10 cm circle) on a
 * side view, the canvas as a line; traces as simple charts. 2D canvas only.
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
p{margin:0 0 10px;color:#9aa6b2;font-size:13px;max-width:1500px}
canvas{display:block}
</style></head><body><div id="root"></div><script>
const B = ${JSON.stringify(before)};
const A = ${JSON.stringify(after)};
const BONES = [[0,1],[1,2],[2,3],[2,4],[4,5],[5,6],[2,7],[7,8],[8,9],[0,10],[10,11],[11,12],[12,13],[0,14],[14,15],[15,16],[16,17]];
const COL = ['#e0574f', '#4f8fe0'];
function axisFor(bodies) {
  if (bodies.length > 1) { const a = bodies[0][0], b = bodies[1][0]; const dx = b[0]-a[0], dz = b[2]-a[2]; const n = Math.hypot(dx,dz)||1; return [dx/n, dz/n]; }
  const h = bodies[0][0], f = bodies[0][12]; const dx = f[0]-h[0], dz = f[2]-h[2]; const n = Math.hypot(dx,dz)||1; return [dx/n, dz/n];
}
function figure(ctx, body, ox, oy, s, u, c0, col, alpha) {
  const P = (p) => { const x = (p[0]-c0[0])*u[0] + (p[2]-c0[1])*u[1]; const z = -(p[0]-c0[0])*u[1] + (p[2]-c0[1])*u[0]; return [ox + (x + 0.18*z)*s, oy - (p[1] + 0.08*z)*s]; };
  ctx.globalAlpha = alpha; ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'round';
  for (const [a,b] of BONES) { const p = P(body[a]), q = P(body[b]); ctx.beginPath(); ctx.moveTo(p[0],p[1]); ctx.lineTo(q[0],q[1]); ctx.stroke(); }
  const h = P(body[3]); ctx.beginPath(); ctx.arc(h[0], h[1], 0.1*s, 0, 7); ctx.stroke();
  ctx.globalAlpha = 1;
}
function strip(title, note, rows, opts) {
  const n = rows[0].frames.length, pw = opts.pw || 230, ph = opts.ph || 260, s = opts.scale || 110;
  const div = document.createElement('div'); div.className = 'cap'; div.id = opts.id;
  div.innerHTML = '<h2>'+title+'</h2><p>'+note+'</p>';
  const cv = document.createElement('canvas'); cv.width = 90 + n*pw; cv.height = rows.length*ph + 24; div.appendChild(cv);
  document.getElementById('root').appendChild(div);
  const ctx = cv.getContext('2d');
  rows.forEach((row, r) => {
    const y0 = r*ph;
    ctx.fillStyle = r % 2 ? '#1a1f28' : '#161a22'; ctx.fillRect(0, y0, cv.width, ph);
    ctx.fillStyle = '#dfe6ee'; ctx.font = '600 14px system-ui'; ctx.fillText(row.label, 12, y0 + 24);
    const first = row.frames[0].bodies || [row.frames[0].body];
    const u = axisFor(first);
    row.frames.forEach((fr, k) => {
      const bodies = fr.bodies || [fr.body];
      const all = bodies.map((b) => b[0]);
      const c0 = opts.fixedCentre ? opts.fixedCentre(row) : [all.reduce((a,p)=>a+p[0],0)/all.length, all.reduce((a,p)=>a+p[2],0)/all.length];
      const ox = 90 + k*pw + pw/2, oy = y0 + ph - 26;
      ctx.strokeStyle = '#3a4250'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(90 + k*pw + 8, oy); ctx.lineTo(90 + (k+1)*pw - 8, oy); ctx.stroke();
      bodies.forEach((b, i) => figure(ctx, b, ox, oy, s, u, c0, COL[opts.colorOf ? opts.colorOf(i) : i], 1));
      ctx.fillStyle = '#9aa6b2'; ctx.font = '12px system-ui'; ctx.fillText((opts.tlabel || ((t) => 't = ' + t.toFixed(1) + ' s'))(fr.t), 90 + k*pw + 10, y0 + ph - 8);
    });
  });
}
function chart(id, title, note, series, opts) {
  const div = document.createElement('div'); div.className = 'cap'; div.id = id;
  div.innerHTML = '<h2>'+title+'</h2><p>'+note+'</p>';
  const W = 1500, H = opts.h || 320; const cv = document.createElement('canvas'); cv.width = W; cv.height = H * series.length; div.appendChild(cv);
  document.getElementById('root').appendChild(div);
  const ctx = cv.getContext('2d');
  series.forEach((sp, r) => {
    const y0 = r*H; ctx.fillStyle = r % 2 ? '#1a1f28' : '#161a22'; ctx.fillRect(0, y0, W, H);
    ctx.fillStyle = '#dfe6ee'; ctx.font = '600 14px system-ui'; ctx.fillText(sp.label, 12, y0 + 22);
    const L = 70, R = W - 20, T = y0 + 36, Bt = y0 + H - 30;
    const ts = sp.t; const tmin = ts[0], tmax = ts[ts.length-1];
    const X = (t) => L + (t - tmin)/(tmax - tmin)*(R - L), Y = (v) => Bt - (v - sp.lo)/(sp.hi - sp.lo)*(Bt - T);
    ctx.strokeStyle = '#3a4250'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, Bt); ctx.lineTo(R, Bt); ctx.stroke();
    ctx.fillStyle = '#9aa6b2'; ctx.font = '12px system-ui';
    for (let k = 0; k <= 4; k++) { const v = sp.lo + (sp.hi - sp.lo)*k/4; ctx.fillText(v.toFixed(sp.dec ?? 2), 8, Y(v) + 4); }
    ctx.fillText(sp.unit || '', L + 6, T - 4);
    for (const line of sp.lines) {
      ctx.strokeStyle = line.col; ctx.lineWidth = line.w || 2; ctx.beginPath();
      line.v.forEach((v, i) => { const x = X(ts[i]), y = Y(Math.max(sp.lo, Math.min(sp.hi, v))); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }
    let lx = R - 360; for (const line of sp.lines) { ctx.fillStyle = line.col; ctx.fillRect(lx, T - 14, 14, 4); ctx.fillStyle = '#dfe6ee'; ctx.fillText(line.name, lx + 20, T - 8); lx += 180; }
  });
}
const both = (key) => [{ label: 'Before', frames: B[key] }, { label: 'After', frames: A[key] }];
strip('Clinch stoppage: the first second after the referee stops it',
  'The bout ends with the pair tied up (a TKO in a double collar tie). Before: the clinch pose blends out chest to chest for ~0.8 s. After: the referee\\'s break — the pair released and stepping apart facing each other, open by 0.8 s, then the post-fight script.',
  both('clinch'), { id: 'clinch' });
strip('Getting up after a KO: the loser, 3.5 to 10.6 s after the stoppage',
  'Before: a pose blend (lying → sitting → a knee → standing), with the feet dipping through the canvas mid-blend. After: the unused ground.get_up_back capture, retargeted onto his own skeleton as body targets and laid along his body, rising on the script\\'s timing.',
  [{ label: 'Before', frames: B.getup.map((f) => ({ t: f.t, bodies: [f.bodies[1]] })) }, { label: 'After', frames: A.getup.map((f) => ({ t: f.t, bodies: [f.bodies[1]] })) }],
  { id: 'getup', colorOf: () => 1, pw: 230 });
strip('The winner\\'s celebration, 3.2 to 8.2 s after the stoppage',
  'Before: arms up and pumping from the procedural figure. After: the unused celebrate.victory_1 capture (arms out, a deep drop toward the canvas, back up) on his own skeleton, facing the crowd from his spot.',
  [{ label: 'Before', frames: B.celebrate.map((f) => ({ t: f.t, bodies: [f.bodies[0]] })) }, { label: 'After', frames: A.celebrate.map((f) => ({ t: f.t, bodies: [f.bodies[0]] })) }],
  { id: 'celebrate', colorOf: () => 0, pw: 230 });
chart('stopgo', 'Stop-go recorded motion: hips and a foot, 0.9 to 2.9 s',
  'The sim moves in 100 ms steps that start and stop (2.2 m/s, then 0, then 2.2 m/s at right angles). Before: the linear root path made a velocity step at every tick and the hips popped 3-5 cm each time a foot left or touched the floor. After: a continuous-velocity root path, a reach clamp that never switches, captured step curves smoothed.',
  [
    { label: 'Hips height', t: A.stopgo.t, lo: Math.min(...B.stopgo.hipY, ...A.stopgo.hipY) - 0.01, hi: Math.max(...B.stopgo.hipY, ...A.stopgo.hipY) + 0.01, unit: 'm', lines: [{ name: 'before', col: '#e0574f', v: B.stopgo.hipY }, { name: 'after', col: '#5fd08a', v: A.stopgo.hipY }] },
    { label: 'Left toe height (steps)', t: A.stopgo.t, lo: 0, hi: 0.14, unit: 'm', lines: [{ name: 'before', col: '#e0574f', v: B.stopgo.footY[0] }, { name: 'after', col: '#5fd08a', v: A.stopgo.footY[0] }] },
  ], { h: 260 });
chart('kick', 'A blocked rear body kick: kicking thigh angular speed, 1.0 to 2.6 s',
  'Before: when the kick\\'s recorded end came the leg snapped back to the stance in one frame (and the forearm flipped at the wrap of its pronation). After: the action\\'s end fades over 180 ms over the planted feet; the pronation eases at the wrap.',
  [{ label: 'Right (kicking) thigh', t: A.kick.t, lo: 0, hi: 70, unit: 'degrees / frame', dec: 0, lines: [{ name: 'before', col: '#e0574f', v: B.kick.thigh[1] }, { name: 'after', col: '#5fd08a', v: A.kick.thigh[1] }] }],
  { h: 300 });
window.__ready = true;
</script></body></html>`;

const browser = await chromium.launch({ headless: true });
const p = await browser.newPage({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 1 });
await p.setContent(page);
await p.waitForFunction('window.__ready === true');
for (const id of ['clinch', 'getup', 'celebrate', 'stopgo', 'kick']) {
  const el = await p.$('#' + id);
  const file = join(outDir, `anim-${id === 'stopgo' ? 'footwork-stopgo' : id === 'kick' ? 'kick-end' : id === 'clinch' ? 'clinch-stoppage' : id}.png`);
  await el.screenshot({ path: file });
  console.log('wrote', file);
}
await browser.close();
