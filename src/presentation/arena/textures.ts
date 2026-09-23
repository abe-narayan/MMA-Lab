/**
 * Procedural 2D-canvas textures for the venue: the octagon and ring canvases
 * (fictional "BOUT LAB" branding, invented sponsor-style panels, markings,
 * scuffs, footprints and sweat marks), grappling mats, apron LED boards and
 * hall banners. Painted once at load, seeded, no downloads and no real marks.
 *
 * World <-> texture mapping for floors (see `floorUV`): u = (x + L) / 2L,
 * v = (L - z) / 2L. Painted text therefore reads the right way up from a
 * camera on the +z side, which is where the dev page's hard camera sits.
 */
import * as THREE from 'three/webgpu';
import type { Arena } from '../../sim';
import { mulberry32, hashString } from './rng';
import { OCTAGON_APRON_M, RING_APRON_M, wallLoop, wallInradius } from './geometry';

/** Invented sponsor-style marks. Deliberately silly and not any real company. */
export const FICTIONAL_SPONSORS = [
  'TICKRATE', 'SEEDWELL', 'HALF GUARD WATER', 'REPLAY+', 'DIGEST', 'KUZUSHI', 'NULL CORNER', 'OPEN SCORING',
] as const;

const FONT = '"Arial Black", "Helvetica Neue", Arial, sans-serif';

export function makeCanvas(w: number, h = w): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function toTexture(c: HTMLCanvasElement, srgb = true, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

/** Floor texture half-extent (metres) for a set; the floor mesh maps UVs with the same L. */
export function floorExtent(arena: Arena): number {
  if (arena.wall === 'fence') return (wallInradius(arena) + OCTAGON_APRON_M) / Math.cos(Math.PI / 8) + 0.05;
  if (arena.wall === 'ropes') return wallInradius(arena) + RING_APRON_M + 0.35;
  return (arena.halfWidthM ?? 4) + 3.5;
}

export function floorUV(x: number, z: number, L: number): [number, number] {
  return [(x + L) / (2 * L), (L - z) / (2 * L)];
}

interface Painter {
  ctx: CanvasRenderingContext2D;
  S: number;
  L: number;
  /** metres -> pixels */
  k: number;
  /** Run `fn` in a frame centred at world (x, z), rotated by `rot` (text up = toward -z at rot 0), units in metres. */
  at(x: number, z: number, rot: number, fn: () => void): void;
}

function painter(c: HTMLCanvasElement, L: number): Painter {
  const ctx = c.getContext('2d')!;
  const S = c.width;
  const k = S / (2 * L);
  return {
    ctx, S, L, k,
    at(x, z, rot, fn) {
      ctx.save();
      ctx.translate((x + L) * k, (z + L) * k);
      ctx.rotate(rot);
      ctx.scale(k, k);
      fn();
      ctx.restore();
    },
  };
}

function polygonPath(ctx: CanvasRenderingContext2D, pts: [number, number][], L: number, k: number): void {
  ctx.beginPath();
  pts.forEach(([x, z], i) => {
    const px = (x + L) * k;
    const py = (z + L) * k;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.closePath();
}

/** Scale a loop outward so its edges sit `off` metres further out. */
function offsetLoop(loop: [number, number][], inradius: number, off: number): [number, number][] {
  const s = (inradius + off) / inradius;
  return loop.map(([x, z]) => [x * s, z * s]);
}

/** Text fitted to a width, in metres, centred at the origin of the current frame. */
function fitText(ctx: CanvasRenderingContext2D, text: string, widthM: number, heightM: number, italic = true): void {
  ctx.font = `${italic ? 'italic ' : ''}900 1px ${FONT}`;
  const w = ctx.measureText(text).width;
  const sx = widthM / Math.max(1e-6, w);
  const sy = heightM / 0.72;
  ctx.save();
  ctx.scale(Math.min(sx, sy * 1.6), sy);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0.04);
  ctx.restore();
}

/** The fictional BOUT LAB emblem, radius `r` metres, centred on the current frame. */
export function drawEmblem(ctx: CanvasRenderingContext2D, r: number, ink: string, accent: string): void {
  ctx.save();
  ctx.lineWidth = r * 0.07;
  ctx.strokeStyle = ink;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = r * 0.025;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2);
  ctx.stroke();
  // An octagon inside the ring.
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const px = Math.sin(a) * r * 0.8;
    const py = Math.cos(a) * r * 0.8;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = ink;
  ctx.fill();
  ctx.globalAlpha = 1;
  // Slash accent.
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(-r * 0.62, r * 0.1);
  ctx.lineTo(r * 0.7, -r * 0.1);
  ctx.lineTo(r * 0.64, r * 0.04);
  ctx.lineTo(-r * 0.68, r * 0.24);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.save();
  ctx.translate(0, -r * 0.28);
  fitText(ctx, 'BOUT', r * 1.25, r * 0.42);
  ctx.restore();
  ctx.save();
  ctx.translate(0, r * 0.36);
  fitText(ctx, 'LAB', r * 0.95, r * 0.36);
  ctx.restore();
  ctx.restore();
}

/** Sponsor-style panel in one of a few invented styles. */
function drawPanel(ctx: CanvasRenderingContext2D, text: string, w: number, h: number, style: number, colour: string, ink: string): void {
  ctx.save();
  switch (style % 4) {
    case 0: // solid block, knocked-out text
      ctx.fillStyle = colour;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = ink;
      fitText(ctx, text, w * 0.86, h * 0.62);
      break;
    case 1: // text only
      ctx.fillStyle = colour;
      fitText(ctx, text, w, h * 0.8);
      break;
    case 2: // outlined box
      ctx.strokeStyle = colour;
      ctx.lineWidth = h * 0.08;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = colour;
      fitText(ctx, text, w * 0.82, h * 0.55, false);
      break;
    default: // chevron + text
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2);
      ctx.lineTo(-w / 2 + h * 0.6, 0);
      ctx.lineTo(-w / 2, h / 2);
      ctx.lineTo(-w / 2 + h * 0.3, h / 2);
      ctx.lineTo(-w / 2 + h * 0.9, 0);
      ctx.lineTo(-w / 2 + h * 0.3, -h / 2);
      ctx.fill();
      ctx.translate(h * 0.5, 0);
      fitText(ctx, text, w - h, h * 0.7);
  }
  ctx.restore();
}

/** Fine per-pixel mottling of a region (canvas fibre, uneven dye). */
function mottle(ctx: CanvasRenderingContext2D, S: number, amount: number, seed: number): void {
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  const rnd = mulberry32(seed);
  // Low-frequency field from a small random grid, bilinearly sampled.
  const G = 24;
  const grid = new Float32Array((G + 1) * (G + 1));
  for (let i = 0; i < grid.length; i++) grid[i] = rnd() - 0.5;
  for (let y = 0; y < S; y++) {
    const gy = (y / S) * G;
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    for (let x = 0; x < S; x++) {
      const gx = (x / S) * G;
      const x0 = Math.floor(gx);
      const fx = gx - x0;
      const a = grid[y0 * (G + 1) + x0]!;
      const b = grid[y0 * (G + 1) + x0 + 1]!;
      const c = grid[(y0 + 1) * (G + 1) + x0]!;
      const e = grid[(y0 + 1) * (G + 1) + x0 + 1]!;
      const low = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
      const n = (low * 0.6 + (rnd() - 0.5) * 0.4) * amount;
      const i = (y * S + x) * 4;
      d[i] = Math.max(0, Math.min(255, d[i]! * (1 + n)));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! * (1 + n)));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! * (1 + n * 0.9)));
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Scuffs, faint footprints and sweat marks — heavier where fighters work (centre ring). */
function wear(p: Painter, radius: number, seed: number, dark: boolean): void {
  const { ctx } = p;
  const rnd = mulberry32(seed);
  const ink = dark ? '255,255,255' : '40,36,32';
  // Broad scuffs.
  for (let i = 0; i < 420; i++) {
    const r = radius * Math.sqrt(rnd()) * (rnd() < 0.7 ? 0.75 : 1.0);
    const a = rnd() * Math.PI * 2;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    p.at(x, z, rnd() * Math.PI, () => {
      ctx.fillStyle = `rgba(${ink},${(0.008 + rnd() * 0.018).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.06 + rnd() * 0.25, 0.02 + rnd() * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  // Pivot scuffs: short curved arcs from turning on the ball of the foot.
  ctx.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const r = radius * 0.85 * Math.sqrt(rnd());
    const a = rnd() * Math.PI * 2;
    p.at(Math.sin(a) * r, Math.cos(a) * r, rnd() * Math.PI * 2, () => {
      ctx.strokeStyle = `rgba(${ink},${((dark ? 0.01 : 0.018) + rnd() * (dark ? 0.015 : 0.03)).toFixed(3)})`;
      ctx.lineWidth = 0.02 + rnd() * 0.03;
      ctx.beginPath();
      ctx.arc(0, 0, 0.06 + rnd() * 0.08, 0, 1 + rnd() * 2.5);
      ctx.stroke();
    });
  }
  // Faint bare footprints (ball + heel ovals), in loose pairs.
  for (let i = 0; i < 90; i++) {
    const r = radius * 0.9 * Math.sqrt(rnd());
    const a = rnd() * Math.PI * 2;
    const rot = rnd() * Math.PI * 2;
    const alpha = 0.025 + rnd() * 0.035;
    p.at(Math.sin(a) * r, Math.cos(a) * r, rot, () => {
      ctx.fillStyle = `rgba(${ink},${alpha.toFixed(3)})`;
      for (const side of [-0.09, 0.09]) {
        ctx.beginPath();
        ctx.ellipse(side, -0.06, 0.045, 0.06, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(side * 1.05, 0.1, 0.032, 0.04, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  // Sweat marks: soft irregular damp patches, slightly darker and greyer.
  for (let i = 0; i < 14; i++) {
    const r = radius * 0.8 * Math.sqrt(rnd());
    const a = rnd() * Math.PI * 2;
    p.at(Math.sin(a) * r, Math.cos(a) * r, rnd() * Math.PI, () => {
      for (let j = 0; j < 6; j++) {
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 0.12 + rnd() * 0.16);
        g.addColorStop(0, `rgba(70,70,74,${(0.025 + rnd() * 0.03).toFixed(3)})`);
        g.addColorStop(1, 'rgba(60,60,64,0)');
        ctx.fillStyle = g;
        ctx.save();
        ctx.translate((rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3);
        ctx.scale(1, 0.5 + rnd() * 0.6);
        ctx.beginPath();
        ctx.arc(0, 0, 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });
  }
}

/** Octagon canvas + apron, one texture (colour); `size` px square. */
export function octagonCanvasTexture(arena: Arena, size: number, seed: string): THREE.CanvasTexture {
  const L = floorExtent(arena);
  const c = makeCanvas(size);
  const p = painter(c, L);
  const { ctx, k } = p;
  const a = wallInradius(arena);
  const loop = wallLoop(arena);

  // Apron: black vinyl.
  ctx.fillStyle = '#0d0d0f';
  ctx.fillRect(0, 0, size, size);

  // Canvas: warm off-white, slightly deeper in tone toward the edges.
  polygonPath(ctx, offsetLoop(loop, a, 0.06), L, k);
  const g = ctx.createRadialGradient(L * k, L * k, 0, L * k, L * k, a * k * 1.1);
  g.addColorStop(0, '#dcdad4');
  g.addColorStop(0.75, '#d6d3cc');
  g.addColorStop(1, '#cbc7bf');
  ctx.fillStyle = g;
  ctx.fill();

  const rnd = mulberry32(hashString(seed + ':canvas'));
  ctx.save();
  polygonPath(ctx, offsetLoop(loop, a, 0.06), L, k);
  ctx.clip();

  // Centre emblem, large and slightly faded by wear.
  p.at(0, 0, 0, () => {
    ctx.globalAlpha = 0.9;
    drawEmblem(ctx, a * 0.34, '#27272b', '#a3161b');
    ctx.globalAlpha = 1;
  });

  // Sponsor-style panels: four large ones on the flats facing the cameras, four
  // small ones toward the corners. Each reads from outside its own side.
  const colours = ['#1f2126', '#9c1a1f', '#25405f', '#3a3a3e'];
  for (let i = 0; i < 8; i++) {
    const big = i % 2 === 0;
    const ang = (i / 8) * Math.PI * 2 + (big ? Math.PI / 8 : Math.PI / 8);
    const rr = big ? a * 0.7 : a * 0.62;
    const phi = ang + (big ? 0 : 0);
    const x = Math.sin(phi) * rr;
    const z = Math.cos(phi) * rr;
    const text = FICTIONAL_SPONSORS[i % FICTIONAL_SPONSORS.length]!;
    if (!big) continue;
    p.at(x, z, -phi, () => {
      ctx.globalAlpha = 0.88;
      drawPanel(ctx, text, 2.4, 0.62, i / 2, colours[(i / 2) % colours.length]!, '#e9e6df');
      ctx.globalAlpha = 1;
    });
  }
  for (let i = 0; i < 4; i++) {
    const phi = (i / 4) * Math.PI * 2 + Math.PI / 4 + Math.PI / 8;
    const rr = a * 0.5;
    p.at(Math.sin(phi) * rr, Math.cos(phi) * rr, -phi, () => {
      ctx.globalAlpha = 0.8;
      drawPanel(ctx, FICTIONAL_SPONSORS[4 + i]!, 1.3, 0.34, i + 1, colours[(i + 2) % colours.length]!, '#e9e6df');
      ctx.globalAlpha = 1;
    });
  }

  // Corner marks: painted wedges at the red and blue posts (vertices 6 and 2).
  const n = loop.length;
  const cornerMark = (vi: number, colour: string) => {
    const [vx, vz] = loop[vi % n]!;
    const [px, pz] = loop[(vi + n - 1) % n]!;
    const [nx, nz] = loop[(vi + 1) % n]!;
    const t = 0.16;
    ctx.fillStyle = colour;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo((vx + L) * k, (vz + L) * k);
    ctx.lineTo((vx + (px - vx) * t + L) * k, (vz + (pz - vz) * t + L) * k);
    ctx.lineTo((vx * 0.86 + L) * k, (vz * 0.86 + L) * k);
    ctx.lineTo((vx + (nx - vx) * t + L) * k, (vz + (nz - vz) * t + L) * k);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  };
  cornerMark(6, '#b3161c');
  cornerMark(2, '#1b4f9c');

  // Thin painted border line 30 cm inside the fence.
  polygonPath(ctx, offsetLoop(loop, a, -0.3), L, k);
  ctx.strokeStyle = 'rgba(30,30,34,0.55)';
  ctx.lineWidth = 0.035 * k;
  ctx.stroke();

  wear(p, a * 0.98, hashString(seed + ':wear'), false);
  ctx.restore();

  // Apron print: repeated wordmark on each flat, reading from outside.
  for (let i = 0; i < 8; i++) {
    const phi = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const rr = a + OCTAGON_APRON_M * 0.55;
    p.at(Math.sin(phi) * rr, Math.cos(phi) * rr, -phi, () => {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(200,200,205,0.55)' : 'rgba(170,40,44,0.7)';
      fitText(ctx, i % 2 === 0 ? 'BOUT LAB' : FICTIONAL_SPONSORS[(i + 3) % 8]!, 2.2, 0.36);
    });
  }
  void rnd;
  mottle(ctx, size, 0.05, hashString(seed + ':mottle'));
  return toTexture(c);
}

/** Ring canvas + apron. Corner posts at (+-h, +-h); corner colours painted at two of them. */
export function ringCanvasTexture(arena: Arena, size: number, seed: string, red = '#b3161c', blue = '#1b4f9c'): THREE.CanvasTexture {
  const L = floorExtent(arena);
  const h = wallInradius(arena);
  const c = makeCanvas(size);
  const p = painter(c, L);
  const { ctx, k } = p;
  ctx.fillStyle = '#1a2c47';
  ctx.fillRect(0, 0, size, size);
  // Canvas inside the ropes and a bit beyond (apron), light blue-grey.
  const e = h + RING_APRON_M;
  ctx.fillStyle = '#c9ced4';
  ctx.fillRect((L - e) * k, (L - e) * k, 2 * e * k, 2 * e * k);
  // Apron band in deep navy with print.
  ctx.fillStyle = '#233a5c';
  ctx.fillRect((L - e) * k, (L - e) * k, 2 * e * k, (e - h - 0.05) * k);
  ctx.fillRect((L - e) * k, (L + h + 0.05) * k, 2 * e * k, (e - h - 0.05) * k);
  ctx.fillRect((L - e) * k, (L - e) * k, (e - h - 0.05) * k, 2 * e * k);
  ctx.fillRect((L + h + 0.05) * k, (L - e) * k, (e - h - 0.05) * k, 2 * e * k);
  p.at(0, 0, 0, () => {
    ctx.globalAlpha = 0.85;
    drawEmblem(ctx, h * 0.38, '#20314f', '#a3161b');
    ctx.globalAlpha = 1;
  });
  const sides: [number, number, number][] = [[0, h * 0.72, 0], [h * 0.72, 0, -Math.PI / 2], [0, -h * 0.72, Math.PI], [-h * 0.72, 0, Math.PI / 2]];
  sides.forEach(([x, z, rot], i) => {
    p.at(x, z, rot, () => {
      ctx.globalAlpha = 0.8;
      drawPanel(ctx, FICTIONAL_SPONSORS[(i * 2 + 1) % 8]!, h * 0.8, h * 0.16, i, i % 2 ? '#20314f' : '#8e1a1f', '#e8e8ea');
      ctx.globalAlpha = 1;
    });
  });
  // Corner triangles.
  const tri = (sx: number, sz: number, col: string) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo((L + sx * h) * k, (L + sz * h) * k);
    ctx.lineTo((L + sx * (h - 0.9)) * k, (L + sz * h) * k);
    ctx.lineTo((L + sx * h) * k, (L + sz * (h - 0.9)) * k);
    ctx.closePath();
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
  };
  tri(-1, 1, red);
  tri(1, -1, blue);
  ctx.save();
  ctx.beginPath();
  ctx.rect((L - h) * k, (L - h) * k, 2 * h * k, 2 * h * k);
  ctx.clip();
  wear(p, h * 1.2, hashString(seed + ':ringwear'), false);
  ctx.restore();
  // Apron print.
  sides.forEach(([x, z, rot], i) => {
    const s = (h + RING_APRON_M * 0.5) / (h * 0.72);
    p.at(x * s, z * s, rot, () => {
      ctx.fillStyle = 'rgba(220,220,228,0.6)';
      fitText(ctx, i % 2 ? 'BOUT LAB' : 'BOUT LAB  BOXING', h * 1.1, 0.28);
    });
  });
  mottle(ctx, size, 0.05, hashString(seed + ':ringmottle'));
  return toTexture(c);
}

/** Competition mat: tiles, contest area, safety border, hall floor beyond. */
export function matTexture(arena: Arena, size: number, seed: string): THREE.CanvasTexture {
  const L = floorExtent(arena);
  const h = wallInradius(arena);
  const tatami = arena.surface === 'tatami';
  const c = makeCanvas(size);
  const p = painter(c, L);
  const { ctx, k } = p;
  const contest = tatami ? '#d9c24a' : '#2c4f86';
  const safety = tatami ? '#2c5aa0' : '#d1c33d';
  const outer = 3.0;
  // Hall floor (maple-ish) beyond the mats.
  ctx.fillStyle = '#8a6a44';
  ctx.fillRect(0, 0, size, size);
  const rnd = mulberry32(hashString(seed + ':mat'));
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(${rnd() < 0.5 ? '255,230,200' : '40,25,10'},${(0.03 + rnd() * 0.05).toFixed(3)})`;
    const y = rnd() * size;
    ctx.fillRect(0, y, size, 1 + rnd() * 3);
  }
  const e = h + outer;
  ctx.fillStyle = safety;
  ctx.fillRect((L - e) * k, (L - e) * k, 2 * e * k, 2 * e * k);
  ctx.fillStyle = contest;
  ctx.fillRect((L - h) * k, (L - h) * k, 2 * h * k, 2 * h * k);
  if (!tatami) {
    // Grappling: 1 m transition band inside the edge is marked in a lighter blue.
    ctx.strokeStyle = 'rgba(230,230,235,0.55)';
    ctx.lineWidth = 0.05 * k;
    ctx.strokeRect((L - h) * k, (L - h) * k, 2 * h * k, 2 * h * k);
  } else {
    // Judo start marks: one white and one blue tape.
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect((L - 1.5 - 0.05) * k, (L - 0.5) * k, 0.1 * k, 1.0 * k);
    ctx.fillStyle = '#3b6fc4';
    ctx.fillRect((L + 1.5 - 0.05) * k, (L - 0.5) * k, 0.1 * k, 1.0 * k);
  }
  // Tile seams every metre (2 m x 1 m tatami, 1 m x 1 m jigsaw mats).
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = Math.max(1, 0.012 * k);
  for (let x = -e; x <= e + 1e-6; x += 1) {
    ctx.beginPath();
    ctx.moveTo((L + x) * k, (L - e) * k);
    ctx.lineTo((L + x) * k, (L + e) * k);
    ctx.stroke();
  }
  for (let z = -e; z <= e + 1e-6; z += tatami ? 2 : 1) {
    ctx.beginPath();
    ctx.moveTo((L - e) * k, (L + z) * k);
    ctx.lineTo((L + e) * k, (L + z) * k);
    ctx.stroke();
  }
  // Centre mark.
  p.at(0, 0, 0, () => {
    ctx.globalAlpha = 0.28;
    drawEmblem(ctx, 0.9, '#f0f0f0', '#f0f0f0');
    ctx.globalAlpha = 1;
  });
  ctx.save();
  ctx.beginPath();
  ctx.rect((L - e) * k, (L - e) * k, 2 * e * k, 2 * e * k);
  ctx.clip();
  wear(p, e, hashString(seed + ':matwear'), true);
  ctx.restore();
  mottle(ctx, size, 0.035, hashString(seed + ':matmottle'));
  return toTexture(c);
}

/** LED board strip for aprons / skirts / barriers: dark with repeating fictional marks. */
export function ledBoardTexture(seed: string, accent = '#c01a22'): THREE.CanvasTexture {
  const W = 2048;
  const H = 128;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#050507';
  ctx.fillRect(0, 0, W, H);
  const words = ['BOUT LAB', ...FICTIONAL_SPONSORS.slice(0, 5)];
  const rnd = mulberry32(hashString(seed + ':led'));
  const n = 6;
  for (let i = 0; i < n; i++) {
    const cx = (i + 0.5) * (W / n);
    ctx.save();
    ctx.translate(cx, H / 2);
    ctx.fillStyle = i % 3 === 0 ? accent : rnd() < 0.5 ? '#d8d8dc' : '#6f8fb8';
    const word = words[i % words.length]!;
    ctx.font = `italic 900 ${H * 0.5}px ${FONT}`;
    const w = ctx.measureText(word).width;
    const maxW = (W / n) * 0.8;
    if (w > maxW) ctx.scale(maxW / w, 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(word, 0, 4);
    ctx.restore();
  }
  // LED pixel grid.
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let x = 0; x < W; x += 4) ctx.fillRect(x, 0, 1, H);
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
  const t = toTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Hall banner / wall graphic. */
export function bannerTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
  const c = makeCanvas(1024, 256);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1024, 256);
  ctx.translate(512, 128);
  ctx.scale(256, 256);
  ctx.fillStyle = fg;
  fitText(ctx, text, 3.4, 0.5);
  return toTexture(c);
}
