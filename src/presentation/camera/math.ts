/**
 * Small, allocation-light maths for the camera director: vectors as tuples,
 * critically damped springs, and seeded deterministic noise.
 *
 * Nothing here reads a clock or `Math.random()`: every cosmetic variation is a
 * pure function of (cosmeticSeed, salt, time), so a scrub shows the same
 * broadcast twice.
 */

export type V3 = [number, number, number];

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const distXZ = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[2] - b[2]);
export function norm(a: V3): V3 {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerpV = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const smoothstep = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
/** Ease-in-out used for jib moves: slow start, slow finish, like a crane operator. */
export const easeInOut = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/** Wrap an angle to (-pi, pi]. */
export function wrapAngle(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x <= -Math.PI) x += Math.PI * 2;
  return x;
}

/** Point on the floor at `azimuth` (sim convention: atan2(x, z)) and radius `r`. */
export const atAzimuth = (azimuth: number, r: number, y = 0): V3 => [Math.sin(azimuth) * r, y, Math.cos(azimuth) * r];
export const azimuthOf = (p: V3): number => Math.atan2(p[0], p[2]);

// ---------------------------------------------------------------------------
// Seeded randomness (cosmetic only — never the sim RNG)
// ---------------------------------------------------------------------------

/** FNV-1a, 32-bit. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A deterministic value in [0, 1) for (seed, salt). */
export function seeded(seed: string, salt: string | number): number {
  let t = (hashString(`${seed}|${salt}`) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Smooth band-limited noise in roughly [-1, 1]: three incommensurate sines
 * with seeded phases. Cheap, continuous, and a pure function of time — the
 * handheld operator's breathing and weight shifts.
 */
export function smoothNoise(t: number, seed: number, baseHz: number): number {
  const p1 = (seed % 997) * 0.37;
  const p2 = (seed % 613) * 0.53;
  const p3 = (seed % 389) * 0.71;
  const w = Math.PI * 2 * baseHz;
  return (
    0.55 * Math.sin(w * t + p1)
    + 0.3 * Math.sin(w * 1.93 * t + p2)
    + 0.15 * Math.sin(w * 3.71 * t + p3)
  );
}

// ---------------------------------------------------------------------------
// Critically damped springs (exact integration: stable at any dt)
// ---------------------------------------------------------------------------

export class Spring1 {
  x = 0;
  v = 0;
  reset(x: number): void {
    this.x = x;
    this.v = 0;
  }
  step(goal: number, omega: number, dt: number): number {
    if (dt <= 0) return this.x;
    const e = Math.exp(-omega * dt);
    const d = this.x - goal;
    const tmp = (this.v + omega * d) * dt;
    this.x = goal + (d + tmp) * e;
    this.v = (this.v - omega * tmp) * e;
    return this.x;
  }
}

export class Spring3 {
  readonly x: V3 = [0, 0, 0];
  readonly v: V3 = [0, 0, 0];
  reset(p: V3): void {
    this.x[0] = p[0]; this.x[1] = p[1]; this.x[2] = p[2];
    this.v[0] = 0; this.v[1] = 0; this.v[2] = 0;
  }
  step(goal: V3, omega: number, dt: number): V3 {
    if (dt <= 0) return this.x;
    const e = Math.exp(-omega * dt);
    for (let k = 0; k < 3; k++) {
      const d = this.x[k] - goal[k];
      const tmp = (this.v[k] + omega * d) * dt;
      this.x[k] = goal[k] + (d + tmp) * e;
      this.v[k] = (this.v[k] - omega * tmp) * e;
    }
    return this.x;
  }
  set(p: V3): void {
    this.x[0] = p[0]; this.x[1] = p[1]; this.x[2] = p[2];
  }
}
