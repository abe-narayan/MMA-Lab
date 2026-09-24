#!/usr/bin/env node
/**
 * Draw the animation quality pass 2 before / after captures from the pose data
 * of `anim2-captures.ts` (run once against the previous animation code, once
 * against the current) and screenshot them into docs/screenshots/anim2-*.png.
 *
 *   node scripts/dev/heavy.mjs node scripts/dev/anim2-captures.mjs before.json after.json [outDir]
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
p{margin:0 0 10px;color:#9aa6b2;font-size:13px;max-width:1400px}
canvas{display:block}
</style></head><body><div id="root"></div><script>
const B = ${JSON.stringify(before)};
const A = ${JSON.stringify(after)};
const BONES = [[0,1],[1,2],[2,3],[2,4],[4,5],[5,6],[2,7],[7,8],[8,9],[0,10],[10,11],[11,12],[12,13],[0,14],[14,15],[15,16],[16,17]];
const COL = ['#e0574f', '#4f8fe0'];
function axisFor(bodies) {
  const a = bodies[0][0], b = bodies[1][0]; const dx = b[0]-a[0], dz = b[2]-a[2]; const n = Math.hypot(dx,dz);
  if (n > 0.05) return [dx/n, dz/n];
  const h = bodies[1][0], f = bodies[1][3]; const ex = f[0]-h[0], ez = f[2]-h[2]; const m = Math.hypot(ex,ez)||1; return [ex/m, ez/m];
}
function figure(ctx, body, ox, oy, s, u, c0, col, depth) {
  const P = (p) => { const x = (p[0]-c0[0])*u[0] + (p[2]-c0[1])*u[1]; const z = -(p[0]-c0[0])*u[1] + (p[2]-c0[1])*u[0]; return [ox + (x + depth*z)*s, oy - (p[1] + 0.08*z)*s]; };
  ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'round';
  for (const [a,b] of BONES) { const p = P(body[a]), q = P(body[b]); ctx.beginPath(); ctx.moveTo(p[0],p[1]); ctx.lineTo(q[0],q[1]); ctx.stroke(); }
  const h = P(body[3]); ctx.beginPath(); ctx.arc(h[0], h[1], 0.1*s, 0, 7); ctx.stroke();
  return P;
}
function strip(id, title, note, rows, opts) {
  const n = rows[0].frames.length, pw = opts.pw || 210, ph = opts.ph || 250, s = opts.scale || 110;
  const div = document.createElement('div'); div.className = 'cap'; div.id = id;
  div.innerHTML = '<h2>'+title+'</h2><p>'+note+'</p>';
  const cv = document.createElement('canvas'); cv.width = 90 + n*pw; cv.height = rows.length*ph; div.appendChild(cv);
  document.getElementById('root').appendChild(div);
  const ctx = cv.getContext('2d');
  rows.forEach((row, r) => {
    const y0 = r*ph;
    ctx.fillStyle = r % 2 ? '#1a1f28' : '#161a22'; ctx.fillRect(0, y0, cv.width, ph);
    ctx.fillStyle = '#dfe6ee'; ctx.font = '600 14px system-ui'; ctx.fillText(row.label, 12, y0 + 24);
    const u = opts.axis ? opts.axis(row) : axisFor(row.frames[0].bodies);
    row.frames.forEach((fr, k) => {
      const bodies = fr.bodies;
      const c0 = opts.centre ? opts.centre(fr) : [(bodies[0][0][0]+bodies[1][0][0])/2, (bodies[0][0][2]+bodies[1][0][2])/2];
      const ox = 90 + k*pw + pw/2, oy = y0 + ph - (opts.floor ?? 26);
      ctx.strokeStyle = '#3a4250'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(90 + k*pw + 8, oy); ctx.lineTo(90 + (k+1)*pw - 8, oy); ctx.stroke();
      bodies.forEach((b, i) => figure(ctx, b, ox, oy, s, u, c0, COL[i], opts.depth ?? 0.18));
      ctx.fillStyle = '#9aa6b2'; ctx.font = '12px system-ui'; ctx.fillText(opts.label(fr, r), 90 + k*pw + 10, y0 + ph - 8);
    });
  });
}
function chart(id, title, note, series, opts) {
  const div = document.createElement('div'); div.className = 'cap'; div.id = id;
  div.innerHTML = '<h2>'+title+'</h2><p>'+note+'</p>';
  const W = 1400, H = opts.h || 260; const cv = document.createElement('canvas'); cv.width = W; cv.height = H * series.length; div.appendChild(cv);
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
    for (let k = 0; k <= 4; k++) { const v = sp.lo + (sp.hi - sp.lo)*k/4; ctx.fillText(v.toFixed(0), 8, Y(v) + 4); }
    ctx.fillText(sp.unit || '', L + 6, T - 4);
    for (let k = 0; k <= 5; k++) { const t = tmin + (tmax - tmin)*k/5; ctx.fillText(t.toFixed(1) + ' s', X(t) - 14, Bt + 18); }
    for (const line of sp.lines) {
      ctx.strokeStyle = line.col; ctx.lineWidth = line.w || 2; ctx.beginPath();
      line.v.forEach((v, i) => { const x = X(line.t[i]), y = Y(Math.max(sp.lo, Math.min(sp.hi, v))); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }
    let lx = R - 360; for (const line of sp.lines) { ctx.fillStyle = line.col; ctx.fillRect(lx, T - 14, 14, 4); ctx.fillStyle = '#dfe6ee'; ctx.fillText(line.name, lx + 20, T - 8); lx += 180; }
  });
}
const both = (key) => [{ label: 'Before', frames: B[key] }, { label: 'After', frames: A[key] }];
strip('contact', 'Strikes at the recorded contact instant (side view, 1.25 m apart)',
  'Before: blocked punches aimed at a point 8.5 cm past the blocking glove, and the aim was taken before the defender\\'s own later corrections (the pair clearance, fades) moved him. After: blocked punches meet the glove\\'s cuff over the wrist, and a last contact pass re-solves the weapon on the final poses.',
  both('contacts'), { pw: 260, ph: 260, scale: 140, depth: 0.35, label: (fr) => fr.tech.replace('tech.', '') + ' @ ' + fr.t.toFixed(3) + ' s' });
strip('submission', 'After a submission on the ground: the winner (red, underneath) gets up',
  'Before: he was stood up at his recorded spot, under the loser, and blended upright through the loser\\'s body. After: he is drawn half a metre off the loser\\'s body line; the fade from the ground slides him out level first, then stands him up.',
  both('submission'), { pw: 200, ph: 250, scale: 120, depth: 0.25, axis: (row) => { const b = row.frames[0].bodies[1]; const dx = b[3][0]-b[0][0], dz = b[3][2]-b[0][2]; const n = Math.hypot(dx,dz)||1; return [-dz/n, dx/n]; }, centre: () => [0.65, 1.7], label: (fr) => 'post ' + fr.t.toFixed(2) + ' s' });
strip('grips', 'Tie-up key poses, a 1.93 m heavyweight (red) on a 1.65 m flyweight: the folded elbow',
  'A hand gripping right beside its own shoulder (the partner\\'s elbow in a collar tie, a cage pin, the locked hands of a rear body lock) folded the elbow to 160-170°. After: the clavicle retracts / elevates the shoulder away from the hand, the grip stays on its socket and the elbow bends no further than ~150°.',
  both('grips').map((r) => ({ label: r.label, frames: r.frames.map((f) => ({ ...f, t: 0 })) })), { pw: 330, ph: 270, scale: 140, depth: 0.45, label: (fr) => fr.node.replace('pos.', '') + ' — elbow ' + fr.elbow.toFixed(0) + '°' });
chart('guard', 'A close-range boxer\\'s lead arm, 86.5 to 89 s of the audit\\'s boxing bout: upper-arm speed relative to the chest',
  'Spikes are one-frame pops (the audit counts a frame > 6°/frame and 2.5x both neighbours). Before: the guard glove sat 8-15 cm from the shoulder, straight above it, with the elbow pole straight below: the elbow plane was undefined and flipped; guard targets also jumped with the head, the idle loop\\'s wrap and every trunk correction. After: guard hands follow in the chest frame (critically damped), keep room in front of the shoulder, the pole is pushed off the reach line, and trunk corrections carry the guard.',
  [{ label: 'Left (lead) upper arm', lo: 0, hi: 180, unit: 'degrees / frame', t: A.guard.t, lines: [{ name: 'before', col: '#e0574f', t: B.guard.t, v: B.guard.w }, { name: 'after', col: '#5fd08a', t: A.guard.t, v: A.guard.w }] }], { h: 300 });
chart('gnp', 'Ground-and-pound from open guard, 128.5 to 131 s of the audit\\'s MMA bout: the striker\\'s upper arm',
  'Before: the sim reports a ground strike with no stage and a start tick that follows the clock, so the strike restarted (and switched hands) every 100 ms tick. After: timed like the standing strikes, from the pending contact and the strike events; overlapping strikes chain from where the hand is.',
  [{ label: 'Left upper arm (relative to the chest)', lo: 0, hi: 180, unit: 'degrees / frame', t: A.gnp.t, lines: [{ name: 'before', col: '#e0574f', t: B.gnp.t, v: B.gnp.w }, { name: 'after', col: '#5fd08a', t: A.gnp.t, v: A.gnp.w }] }], { h: 300 });
window.__ready = true;
</script></body></html>`;

const browser = await chromium.launch({ headless: true });
const p = await browser.newPage({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 1 });
await p.setContent(page);
await p.waitForFunction('window.__ready === true');
for (const id of ['contact', 'submission', 'grips', 'guard', 'gnp']) {
  const el = await p.$('#' + id);
  const file = join(outDir, `anim2-${id}.png`);
  await el.screenshot({ path: file });
  console.log('wrote', file);
}
await browser.close();
