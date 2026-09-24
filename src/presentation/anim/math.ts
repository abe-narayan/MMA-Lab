/**
 * Small vector / quaternion / easing helpers for the standing animator.
 *
 * Vectors are plain `[x, y, z]` tuples and quaternions `[x, y, z, w]`: the
 * animator evaluates two to a handful of fighters per frame, so clarity wins
 * over allocation-free code here. The per-bone hot paths (FK, IK) live in
 * `rig/` and are allocation-free already.
 *
 * Fighter frame convention used throughout `anim/`: +Z toward the opponent,
 * +X the fighter's LEFT, +Y up (the skeleton's rest convention). Positive yaw
 * turns to the fighter's left, positive pitch leans forward (chin down),
 * positive roll leans to the fighter's right.
 */

export type V3 = [number, number, number];
export type Q = [number, number, number, number];

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const DEG = Math.PI / 180;

export function smooth(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}
export function smoother(t: number): number {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
}
/** Accelerating launch that arrives at full speed (strike extension). */
export function launch(t: number): number {
  const x = clamp01(t);
  return x * x * (2 - x);
}
/** Fast start, soft landing (retraction to guard). */
export function settle(t: number): number {
  const x = clamp01(t);
  return 1 - (1 - x) * (1 - x) * (1 - x);
}
/** 0 -> 1 -> 0 bump over [0,1]. */
export function bump(t: number): number {
  const x = clamp01(t);
  return Math.sin(Math.PI * x);
}
/**
 * 0 -> 1 -> 0 bump over [0,1] with ZERO slope at both ends (sin²): a foot's
 * weight shift, clearance and toe-off start and stop at rest, so a lift-off or
 * a touch-down is never a velocity step (`bump` starts at full speed: measured,
 * a shin or hips jolt at every lift-off and landing).
 */
export function bumpC1(t: number): number {
  const s = Math.sin(Math.PI * clamp01(t));
  return s * s;
}
/** Early-peaking pulse over [0,1] (peak 1 at t = 0.4), zero slope at both ends: a toe-off. */
export function earlyPulse(t: number): number {
  const x = clamp01(t);
  const y = 1 - x;
  return 28.935 * x * x * y * y * y;
}
/** Window: rises over [a,b], holds, falls over [c,d]. */
export function windowW(t: number, a: number, b: number, c: number, d: number): number {
  if (t <= a || t >= d) return 0;
  if (t < b) return smooth((t - a) / Math.max(1e-6, b - a));
  if (t <= c) return 1;
  return 1 - smooth((t - c) / Math.max(1e-6, d - c));
}
/**
 * Critically damped impulse response, normalised to peak 1 at t = 1/omega.
 * The shape of a hit reaction: a snap, then a settle with no overshoot.
 */
export function impulse(t: number, omega: number): number {
  if (t <= 0) return 0;
  const x = omega * t;
  return x * Math.exp(1 - x);
}
/** Soft saturation: linear near 0, approaches +-cap. */
export function softCap(x: number, cap: number): number {
  return cap * Math.tanh(x / cap);
}

// ---- vectors ---------------------------------------------------------------

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const madd = (a: V3, b: V3, s: number): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export function norm(a: V3): V3 {
  const n = Math.hypot(a[0], a[1], a[2]);
  return n > 1e-9 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 1];
}
export const vlerp = (a: V3, b: V3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
];
export const at = (arr: ArrayLike<number>, i: number): V3 => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];
/** Quadratic Bezier. */
export function bez2(a: V3, c: V3, b: V3, t: number): V3 {
  const u = 1 - t;
  return [
    u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
    u * u * a[1] + 2 * u * t * c[1] + t * t * b[1],
    u * u * a[2] + 2 * u * t * c[2] + t * t * b[2],
  ];
}

// ---- quaternions -----------------------------------------------------------

export const QI = (): Q => [0, 0, 0, 1];
export function qmul(a: ArrayLike<number>, b: ArrayLike<number>): Q {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
export const qconj = (q: ArrayLike<number>): Q => [-q[0], -q[1], -q[2], q[3]];
export function qaxis(axis: V3, angle: number): Q {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}
export const qy = (a: number): Q => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
export const qx = (a: number): Q => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
export const qz = (a: number): Q => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
/** yaw (about Y), then pitch (about the yawed X), then roll (about the pitched Z). */
export function qypr(yaw: number, pitch: number, roll: number): Q {
  return qmul(qmul(qy(yaw), qx(pitch)), qz(roll));
}
export function qrot(q: ArrayLike<number>, v: V3): V3 {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const cx = y * v[2] - z * v[1];
  const cy = z * v[0] - x * v[2];
  const cz = x * v[1] - y * v[0];
  return [
    v[0] + 2 * (w * cx + (y * cz - z * cy)),
    v[1] + 2 * (w * cy + (z * cx - x * cz)),
    v[2] + 2 * (w * cz + (x * cy - y * cx)),
  ];
}
export function qnormalize(q: Q): Q {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}
export function qslerp(a: ArrayLike<number>, b: ArrayLike<number>, t: number): Q {
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let c = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (c < 0) { c = -c; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let s0: number, s1: number;
  if (c > 0.9995) { s0 = 1 - t; s1 = t; } else {
    const th = Math.acos(c), sn = Math.sin(th);
    s0 = Math.sin((1 - t) * th) / sn; s1 = Math.sin(t * th) / sn;
  }
  return qnormalize([s0 * a[0] + s1 * bx, s0 * a[1] + s1 * by, s0 * a[2] + s1 * bz, s0 * a[3] + s1 * bw]);
}
/** Shortest-arc rotation carrying unit a onto unit b. */
export function qfromTo(a: V3, b: V3): Q {
  const d = dot(a, b);
  if (d < -0.999999) {
    let ax = cross([1, 0, 0], a);
    if (len(ax) < 1e-6) ax = cross([0, 1, 0], a);
    ax = norm(ax);
    return [ax[0], ax[1], ax[2], 0];
  }
  const c = cross(a, b);
  return qnormalize([c[0], c[1], c[2], 1 + d]);
}
/** Swing-twist: the signed angle of q about unit axis `ax`. */
export function twistAngle(q: ArrayLike<number>, ax: V3): number {
  const p = q[0] * ax[0] + q[1] * ax[1] + q[2] * ax[2];
  return 2 * Math.atan2(p, q[3]);
}

// ---- fighter frame -----------------------------------------------------------

/** A ground frame: origin on the floor, +Z along `yaw` (sim facing convention). */
export interface Frame {
  ox: number;
  oz: number;
  yaw: number;
  c: number;
  s: number;
}
export function frame(ox: number, oz: number, yaw: number): Frame {
  return { ox, oz, yaw, c: Math.cos(yaw), s: Math.sin(yaw) };
}
/** Local (x left, y up, z forward) -> world. */
export function toWorld(f: Frame, l: V3): V3 {
  return [f.ox + l[0] * f.c + l[2] * f.s, l[1], f.oz - l[0] * f.s + l[2] * f.c];
}
/** Local direction -> world direction. */
export function dirToWorld(f: Frame, l: V3): V3 {
  return [l[0] * f.c + l[2] * f.s, l[1], -l[0] * f.s + l[2] * f.c];
}
/** World -> local. */
export function toLocal(f: Frame, w: V3): V3 {
  const dx = w[0] - f.ox, dz = w[2] - f.oz;
  return [dx * f.c - dz * f.s, w[1], dx * f.s + dz * f.c];
}
export function dirToLocal(f: Frame, w: V3): V3 {
  return [w[0] * f.c - w[2] * f.s, w[1], w[0] * f.s + w[2] * f.c];
}
export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

// ---- deterministic cosmetic noise -------------------------------------------

/** 32-bit string hash (FNV-1a), for per-fighter cosmetic seeds. */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
/** Integer hash -> [0,1). */
export function hash01(a: number, b = 0, c = 0): number {
  let h = (a | 0) ^ Math.imul(b | 0, 0x9e3779b1) ^ Math.imul(c | 0, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Smooth 1-D value noise in [-1,1], deterministic in (seed, t). */
export function noise1(seed: number, t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const a = hash01(seed, i) * 2 - 1;
  const b = hash01(seed, i + 1) * 2 - 1;
  return a + (b - a) * smooth(f);
}
