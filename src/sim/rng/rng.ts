/**
 * Seeded, reproducible pseudo-random number generator.
 *
 * sfc32 (Small Fast Counter, 32-bit) with a 128-bit state, seeded through
 * xmur3 string hashing. Chosen because it is:
 *   - deterministic and platform-independent (pure uint32 arithmetic),
 *   - fast enough to run tens of millions of draws per batch,
 *   - stream-splittable, so each bout gets an independent sub-stream.
 *
 * Determinism guarantee: for a given seed string, the sequence of draws is
 * identical in Node and in every browser. This is the foundation of the
 * replay system - a replay file stores the seed, not the frames.
 */

export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

export class RNG {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;
  readonly seed: string;
  /** Number of draws taken - part of the state digest, useful for debugging drift. */
  draws = 0;

  constructor(seed: string) {
    this.seed = seed;
    const h = xmur3(seed);
    this.a = h();
    this.b = h();
    this.c = h();
    this.d = h();
    // Discard the first draws so low-entropy seeds ("bout-1", "bout-2") decorrelate.
    for (let i = 0; i < 12; i++) this.next();
    this.draws = 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.draws++;
    const t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    const t2 = (t + this.d) | 0;
    this.c = (this.c + t2) | 0;
    return (t2 >>> 0) / 4294967296;
  }

  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n) % n;
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Standard normal via Box-Muller (always consumes exactly 2 draws). */
  normal(mean = 0, sd = 1): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Pick one index from a weight array. Weights need not be normalised. */
  weighted(weights: number[]): number {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i] > 0 ? weights[i] : 0;
    if (total <= 0) return 0;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i] > 0 ? weights[i] : 0;
      if (r < w) return i;
      r -= w;
    }
    return weights.length - 1;
  }

  /** Derive an independent child stream (used per bout, per fighter). */
  fork(label: string): RNG {
    return new RNG(`${this.seed}|${label}|${this.next().toString(36)}`);
  }
}
