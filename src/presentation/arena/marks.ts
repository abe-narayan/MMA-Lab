/**
 * FIGHT MARKS — what a bout leaves on the canvas: damp patches where the
 * fighters worked on the ground, sweat drips that come with fatigue late in
 * the rounds, and blood where a cut fighter bled (only when the sim recorded a
 * bleeding cut, and only when the bout's `blood` setting is on).
 *
 * Pure and deterministic: `fightMarkSplats` reads the recorded frames (the
 * sim's own positions, postures and cut state) plus the cosmetic seed, never
 * the sim RNG and never `Math.random()`. `bakeFightMarks` rasterises every
 * splat of the whole bout ONCE into a half-float texture that stores, per
 * texel, how much sweat and blood lands there and (amount-weighted) when:
 *
 *   R = sweat amount   G = sweat time (s)   B = blood amount   A = blood time (s)
 *
 * The floor shader reveals a mark only once the playhead's sim time has passed
 * its time, so seeking backwards or forwards, live or replay, always shows
 * exactly the marks made up to that moment — with no per-frame texture upload.
 */
import * as THREE from 'three/webgpu';
import type { Arena, TickSnapshot } from '../../sim';
import { circumradius, wallInradius } from './geometry';
import { hash01 } from './rng';

export interface MarkSplat {
  x: number;
  z: number;
  /** Radius (m) along the major axis. */
  r: number;
  /** Minor/major axis ratio (1 = round). */
  aspect: number;
  /** Major-axis direction (radians, in the x-z plane). */
  rot: number;
  /** Peak amount 0..1. */
  a: number;
  /** Sim time (s) the mark is made. */
  t: number;
  kind: 'sweat' | 'blood';
  /** Edge softness 0 (crisp drop) .. 1 (soft damp patch). */
  soft: number;
  /** Per-splat seed for the ragged edge. */
  seed: number;
}

/** Half-extent (m) of the square the marks texture covers, centred on the canvas. */
export function marksExtent(arena: Arena): number {
  if (arena.shape === 'polygon' || arena.shape === 'circle') return circumradius(arena) + 0.1;
  if (arena.shape === 'square') return wallInradius(arena) + (arena.wall === 'ropes' ? 0.3 : 1.2);
  return 0;
}

const MAX_SPLATS = 6000;

/**
 * Every mark of the bout, in time order. `seed` is the cosmetic seed hashed to
 * a number. Frames are sampled at fixed tick strides so the answer does not
 * depend on how the recording is played back.
 */
export function fightMarkSplats(
  frames: readonly TickSnapshot[], opts: { blood: boolean; seed: number; extent: number },
): MarkSplat[] {
  const out: MarkSplat[] = [];
  const R = opts.extent;
  if (!(R > 0) || frames.length === 0) return out;
  const s0 = opts.seed >>> 0;
  const inside = (x: number, z: number) => Math.abs(x) < R - 0.05 && Math.abs(z) < R - 0.05;
  const push = (m: MarkSplat) => { if (out.length < MAX_SPLATS && inside(m.x, m.z)) out.push(m); };
  const lastT = frames[frames.length - 1]!.t || 1;

  for (let i = 0; i < frames.length; i += 5) {
    const f = frames[i]!;
    if (f.phase !== 'round') continue;
    const tick = f.tick;
    const t = f.t;
    const everySecond = tick % 10 === 0;
    for (const p of f.fighters) {
      const fx = Math.sin(p.facing);
      const fz = Math.cos(p.facing);
      const h = (salt: number, k = 0) => hash01(s0 ^ (p.id * 7919), tick * 16 + salt, k);
      const low = p.posture === 'ground' || p.posture === 'down';

      // Damp patches: bodies on the canvas soak it where they lie and scramble.
      if (low && everySecond) {
        for (let k = 0; k < 2; k++) {
          const along = k === 0 ? -0.1 : 0.45;
          push({
            x: p.x + fx * along + (h(1, k) - 0.5) * 0.3, z: p.z + fz * along + (h(2, k) - 0.5) * 0.3,
            r: 0.3 + h(3, k) * 0.22, aspect: 0.55 + h(4, k) * 0.35, rot: p.facing + (h(5, k) - 0.5) * 0.8,
            a: 0.07, t, kind: 'sweat', soft: 1, seed: Math.floor(h(6, k) * 1e6),
          });
        }
      }
      // Sweat drips while standing: rarer early, every few seconds by the late rounds.
      if (!low && p.posture !== 'out' && tick % 30 === 0) {
        const fatigue = Math.min(1, 0.15 + 0.85 * (t / Math.max(300, lastT)));
        if (h(10) < fatigue * 0.8) {
          const n = 2 + Math.floor(h(11) * 3);
          for (let k = 0; k < n; k++) {
            push({
              x: p.x + fx * 0.1 + (h(12, k) - 0.5) * 0.5, z: p.z + fz * 0.1 + (h(13, k) - 0.5) * 0.5,
              r: 0.012 + h(14, k) * 0.02, aspect: 0.75 + h(15, k) * 0.25, rot: h(16, k) * Math.PI,
              a: 0.55, t, kind: 'sweat', soft: 0.5, seed: Math.floor(h(17, k) * 1e6),
            });
          }
        }
      }
      // Blood: only from a cut the sim says is bleeding.
      if (!opts.blood) continue;
      let sev = 0;
      for (const c of p.damageVisual.cuts) if (c.bleeding) sev += c.severity;
      if (sev === 0) continue;
      // Where the head is over the canvas.
      const hx = p.x + fx * (low ? 0.55 : 0.12);
      const hz = p.z + fz * (low ? 0.55 : 0.12);
      if (low) {
        // Smears: a bleeding face on the canvas and the scramble around it.
        if (h(20) < 0.2 * sev) {
          push({
            x: hx + (h(21) - 0.5) * 0.3, z: hz + (h(22) - 0.5) * 0.3, r: 0.05 + h(23) * 0.09,
            aspect: 0.3 + h(24) * 0.4, rot: h(25) * Math.PI, a: 0.45 + h(26) * 0.3, t, kind: 'blood', soft: 0.6,
            seed: Math.floor(h(27) * 1e6),
          });
        }
      } else if (h(30) < 0.28 * sev) {
        // Drops falling from the brow: round, crisp, a few centimetres.
        const n = 1 + Math.floor(h(31) * 2);
        for (let k = 0; k < n; k++) {
          push({
            x: hx + (h(32, k) - 0.5) * 0.3, z: hz + (h(33, k) - 0.5) * 0.3, r: 0.008 + h(34, k) * 0.018,
            aspect: 0.8 + h(35, k) * 0.2, rot: h(36, k) * Math.PI, a: 0.95, t, kind: 'blood', soft: 0.15,
            seed: Math.floor(h(37, k) * 1e6),
          });
        }
        // Now and then a flick of droplets from a landed shot's head snap.
        if (h(38) < 0.12) {
          const ang = h(39) * Math.PI * 2;
          const len = 0.2 + h(40) * 0.35;
          for (let k = 0; k < 6; k++) {
            const d = (k / 5) * len;
            push({
              x: hx + Math.sin(ang) * d, z: hz + Math.cos(ang) * d, r: 0.004 + h(41, k) * 0.008,
              aspect: 0.6, rot: ang, a: 0.9, t, kind: 'blood', soft: 0.2, seed: Math.floor(h(42, k) * 1e6),
            });
          }
        }
      }
    }
  }
  return out;
}

/** Rasterise the splats into the RGBA half-float marks texture (`size`² texels over ±extent). */
export function bakeFightMarks(splats: readonly MarkSplat[], extent: number, size: number): THREE.DataTexture {
  const N = size;
  // Per texel and channel (sweat, blood): screen-blended amount, sum of weights, sum of weight x time.
  const amt = new Float32Array(N * N * 2);
  const wA = new Float32Array(N * N * 2);
  const wT = new Float32Array(N * N * 2);
  const px = N / (2 * extent);
  for (const s of splats) {
    const ch = s.kind === 'sweat' ? 0 : 1;
    const rp = s.r * px;
    const cx = (s.x + extent) * px;
    const cy = (s.z + extent) * px;
    const reach = Math.ceil(rp * 1.3 + 1.5);
    const x0 = Math.max(0, Math.floor(cx - reach)), x1 = Math.min(N - 1, Math.ceil(cx + reach));
    const y0 = Math.max(0, Math.floor(cy - reach)), y1 = Math.min(N - 1, Math.ceil(cy + reach));
    const c = Math.cos(s.rot), sn = Math.sin(s.rot);
    // Ragged edge (drops and smears only): three seeded lobes around the rim.
    // Damp patches are soft ellipses; the trigonometry per texel was most of
    // the bake time.
    const ragged = s.soft < 0.9;
    const l1 = hash01(s.seed, 1) * 6.283, l2 = hash01(s.seed, 2) * 6.283, l3 = hash01(s.seed, 3) * 6.283;
    const rag = ragged ? 0.12 + 0.12 * s.soft : 0;
    const edge = 0.15 + 0.6 * s.soft;
    const rr = Math.max(rp, 0.7);
    const inv = 1 / rr;
    const invAsp = 1 / s.aspect;
    const outer2 = (1 + rag) * (1 + rag);
    // Sub-texel drops still leave their (area-weighted) share.
    const small = rp < 0.7 ? (rp / 0.7) ** 2 : 1;
    for (let y = y0; y <= y1; y++) {
      const dy = (y + 0.5 - cy) * inv;
      for (let x = x0; x <= x1; x++) {
        const dx = (x + 0.5 - cx) * inv;
        const u = dx * c + dy * sn;
        const v = (-dx * sn + dy * c) * invAsp;
        const d2 = u * u + v * v;
        if (d2 > outer2) continue;
        const d = Math.sqrt(d2);
        let q = d;
        if (ragged) {
          const th = Math.atan2(v, u);
          q = d / (1 + rag * (0.5 * Math.sin(th * 3 + l1) + 0.3 * Math.sin(th * 5 + l2) + 0.2 * Math.sin(th * 2 + l3)));
        }
        let w = q >= 1 ? 0 : q <= 1 - edge ? 1 : (1 - q) / edge;
        if (w <= 0) continue;
        w = w * w * (3 - 2 * w) * small;
        const a = s.a * w;
        const k = (y * N + x) * 2 + ch;
        amt[k] = 1 - (1 - amt[k]!) * (1 - a);
        wA[k] = wA[k]! + a;
        wT[k] = wT[k]! + a * s.t;
      }
    }
  }
  const data = new Uint16Array(N * N * 4);
  const H = THREE.DataUtils.toHalfFloat;
  for (let i = 0; i < N * N; i++) {
    for (let ch = 0; ch < 2; ch++) {
      const k = i * 2 + ch;
      const a = amt[k]!;
      if (a === 0) continue; // half-float 0 is 0x0000
      data[i * 4 + ch * 2] = H(Math.min(1, a));
      data[i * 4 + ch * 2 + 1] = H(a > 0 ? wT[k]! / wA[k]! : 0);
    }
  }
  return marksTexture(data, N);
}

function marksTexture(data: Uint16Array, N: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  tex.name = 'arena.fightMarks';
  return tex;
}

/** An empty (no marks) texture of the same format, for before a recording is known. */
export function emptyMarks(): THREE.DataTexture {
  return marksTexture(new Uint16Array(4), 1);
}
