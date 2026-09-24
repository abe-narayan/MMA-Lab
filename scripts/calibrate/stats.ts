/**
 * Estimators and the §6.6 pass rule for the calibration report.
 *
 * Every estimator returns `{ value, ci, n }` where `ci` is the 95 % half-width.
 *   proportion  Wilson half-width
 *   ratio       Σx / Σy over independent units (bouts), delta-method CI —
 *               the right estimator for pooled rates such as SLpM, where the
 *               per-minute denominators differ from bout to bout
 *   mean        normal approximation
 *   median      normal approximation with the 1.253 efficiency factor
 *
 * Pass rule (09 §6.6): `|sim − target| ≤ tol` AND `ci ≤ tol / 2`, so a pass
 * cannot be a lucky small sample. `z = (sim − target) / tol`.
 */

export interface Estimate {
  value: number | null;
  ci: number | null;
  n: number;
}

export const NONE: Estimate = { value: null, ci: null, n: 0 };

export function proportion(k: number, n: number): Estimate {
  if (n <= 0) return { value: null, ci: null, n: 0 };
  const p = k / n;
  const z = 1.96;
  // Wilson interval half-width.
  const denom = 1 + (z * z) / n;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { value: p, ci: half, n };
}

/** Pooled ratio Σx/Σy over units, with a delta-method 95 % half-width. */
export function ratio(xs: readonly number[], ys: readonly number[], scale = 1): Estimate {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return NONE;
  let sx = 0;
  let sy = 0;
  for (let k = 0; k < n; k++) {
    sx += xs[k];
    sy += ys[k];
  }
  if (sy <= 0) return { value: null, ci: null, n };
  const r = sx / sy;
  const ybar = sy / n;
  let ss = 0;
  for (let k = 0; k < n; k++) {
    const d = xs[k] - r * ys[k];
    ss += d * d;
  }
  const varR = n > 1 ? ss / (n - 1) / (n * ybar * ybar) : Infinity;
  return { value: r * scale, ci: 1.96 * Math.sqrt(varR) * scale, n };
}

export function mean(xs: readonly number[]): Estimate {
  const n = xs.length;
  if (n === 0) return NONE;
  const m = xs.reduce((s, x) => s + x, 0) / n;
  const sd = sdOf(xs, m);
  return { value: m, ci: n > 1 ? (1.96 * sd) / Math.sqrt(n) : Infinity, n };
}

export function sdOf(xs: readonly number[], m?: number): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mu = m ?? xs.reduce((s, x) => s + x, 0) / n;
  return Math.sqrt(xs.reduce((s, x) => s + (x - mu) * (x - mu), 0) / (n - 1));
}

export function median(xs: readonly number[]): Estimate {
  const n = xs.length;
  if (n === 0) return NONE;
  const s = [...xs].sort((a, b) => a - b);
  const med = n % 2 === 1 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  const sd = sdOf(xs);
  return { value: med, ci: n > 1 ? (1.96 * 1.253 * sd) / Math.sqrt(n) : Infinity, n };
}

/** SD of a per-unit statistic with an approximate CI (normal theory). */
export function sd(xs: readonly number[]): Estimate {
  const n = xs.length;
  if (n < 2) return NONE;
  const s = sdOf(xs);
  return { value: s, ci: (1.96 * s) / Math.sqrt(2 * (n - 1)), n };
}

/** The ratio of two independent pooled estimates, a/b, delta-method CI. */
export function quotient(a: Estimate, b: Estimate): Estimate {
  if (a.value === null || b.value === null || b.value === 0) return { value: null, ci: null, n: Math.min(a.n, b.n) };
  const q = a.value / b.value;
  const ra = (a.ci ?? Infinity) / Math.max(1e-12, Math.abs(a.value));
  const rb = (b.ci ?? Infinity) / Math.abs(b.value);
  return { value: q, ci: Math.abs(q) * Math.sqrt(ra * ra + rb * rb), n: Math.min(a.n, b.n) };
}

export type Verdict = 'PASS' | 'FAIL' | 'WIDE' | 'NO DATA' | 'INFO';

export interface PassInput {
  value: number | null;
  ci: number | null;
  target: number;
  tol: number;
}

/** 09 §6.6: pass iff |sim − target| ≤ tol and the CI half-width ≤ tol / 2. */
export function verdictOf(x: PassInput): Verdict {
  if (x.value === null || !Number.isFinite(x.value)) return 'NO DATA';
  const within = Math.abs(x.value - x.target) <= x.tol + 1e-12;
  if (!within) return 'FAIL';
  const tight = x.ci !== null && Number.isFinite(x.ci) && x.ci <= x.tol / 2 + 1e-12;
  return tight ? 'PASS' : 'WIDE';
}

export function zOf(x: PassInput): number | null {
  if (x.value === null || !Number.isFinite(x.value) || x.tol <= 0) return null;
  return (x.value - x.target) / x.tol;
}
