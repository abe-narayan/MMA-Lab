/**
 * Small vector / quaternion kit for the grappling solver.
 *
 * Tuples rather than classes: pose authoring data is written as literal
 * `[x, y, z]` arrays, and the solver works on the same shape. Quaternions are
 * `[x, y, z, w]` like the pose buffer.
 */
export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];

export const QI: Readonly<Q4> = [0, 0, 0, 1];

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
  return n > 1e-9 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 1, 0];
}
export const lerp3 = (a: V3, b: V3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
];
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
export const easeInOut = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export const DEG = Math.PI / 180;

export function qMul(a: ArrayLike<number>, b: ArrayLike<number>): Q4 {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
export const qConj = (q: ArrayLike<number>): Q4 => [-q[0], -q[1], -q[2], q[3]];
export function qRot(q: ArrayLike<number>, v: V3): V3 {
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
export function qAxis(axis: V3, angle: number): Q4 {
  const a = norm(axis);
  const s = Math.sin(angle / 2);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(angle / 2)];
}
export function qNorm(q: Q4): Q4 {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}
export function qSlerp(a: ArrayLike<number>, b: ArrayLike<number>, t: number): Q4 {
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  let c = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (c < 0) { c = -c; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let s0: number, s1: number;
  if (c > 0.9995) { s0 = 1 - t; s1 = t; } else {
    const th = Math.acos(c);
    const sn = Math.sin(th);
    s0 = Math.sin((1 - t) * th) / sn;
    s1 = Math.sin(t * th) / sn;
  }
  return qNorm([s0 * a[0] + s1 * bx, s0 * a[1] + s1 * by, s0 * a[2] + s1 * bz, s0 * a[3] + s1 * bw]);
}
/** The shortest rotation carrying unit `a` onto unit `b`. */
export function qFromTo(a: V3, b: V3): Q4 {
  const d = dot(a, b);
  if (d < -0.999999) {
    let ax = cross([1, 0, 0], a);
    if (len(ax) < 1e-6) ax = cross([0, 1, 0], a);
    ax = norm(ax);
    return [ax[0], ax[1], ax[2], 0];
  }
  const c = cross(a, b);
  return qNorm([c[0], c[1], c[2], 1 + d]);
}
/** Rotation whose columns are the orthonormal basis (x, y, z). */
export function qBasis(x: V3, y: V3, z: V3): Q4 {
  const m00 = x[0], m01 = y[0], m02 = z[0];
  const m10 = x[1], m11 = y[1], m12 = z[1];
  const m20 = x[2], m21 = y[2], m22 = z[2];
  const tr = m00 + m11 + m22;
  let q: Q4;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return qNorm(q);
}
/**
 * Body orientation from the direction the spine points (`up`, body +Y) and the
 * direction the belly faces (`fwd`, body +Z). Body +X (the fighter's left) is
 * up x fwd. `fwd` is orthogonalised against `up`.
 */
export function qLook(up: V3, fwd: V3): Q4 {
  const y = norm(up);
  let z = sub(fwd, scale(y, dot(fwd, y)));
  if (len(z) < 1e-5) z = Math.abs(y[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  z = norm(sub(z, scale(y, dot(z, y))));
  const x = cross(y, z);
  return qBasis(x, y, z);
}
/** q^t: the fraction t of rotation q (slerp from identity). */
export const qPow = (q: ArrayLike<number>, t: number): Q4 => qSlerp(QI, q, t);

export function getV3(a: ArrayLike<number>, i: number): V3 {
  return [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];
}
export function getQ(a: ArrayLike<number>, i: number): Q4 {
  return [a[i * 4], a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]];
}
export function setQ(a: Float32Array, i: number, q: ArrayLike<number>): void {
  a[i * 4] = q[0]; a[i * 4 + 1] = q[1]; a[i * 4 + 2] = q[2]; a[i * 4 + 3] = q[3];
}

/** Deterministic pseudo-noise in [-1, 1] from a time and a channel id. */
export function wobble(t: number, ch: number): number {
  return 0.6 * Math.sin(t * (0.9 + ch * 0.37) + ch * 1.7) + 0.4 * Math.sin(t * (2.1 + ch * 0.13) + ch * 0.61);
}
