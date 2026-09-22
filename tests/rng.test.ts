/**
 * RNG SUITE
 *
 * The replay system is built on one claim: `new RNG(seed)` produces the same
 * sequence of draws everywhere, forever. If that claim is false, every replay
 * file in this repository is a lie. These tests attack it from four angles:
 *
 *   1. reproducibility  - identical seeds produce identical streams,
 *   2. separation       - different seeds and forked child streams do not,
 *   3. distribution     - the stream is actually uniform / normal enough to be
 *                         used as a probability source,
 *   4. the digest       - the fingerprint that verifies a replay is itself
 *                         deterministic, order-sensitive and non-vacuous.
 *
 * Statistical bounds below are deliberately loose "sanity" bounds, not tight
 * randomness certifications: they are wide enough that a correct generator can
 * never trip them, and narrow enough that a broken one always will. Because the
 * generator is seeded, every one of these tests is itself deterministic - a
 * failure here is a real regression, never flakiness.
 */

import { describe, it, expect } from 'vitest';
import { RNG, Digest, xmur3 } from '../src/engine/rng';

const take = (r: RNG, n: number): number[] => Array.from({ length: n }, () => r.next());

describe('xmur3 seed hashing', () => {
  it('is a pure function of the string', () => {
    expect(xmur3('bout-1')()).toBe(xmur3('bout-1')());
    const a = xmur3('bout-1');
    expect([a(), a(), a(), a()]).toEqual((() => { const b = xmur3('bout-1'); return [b(), b(), b(), b()]; })());
  });

  it('separates seeds that differ by one character', () => {
    expect(xmur3('bout-1')()).not.toBe(xmur3('bout-2')());
    expect(xmur3('')()).not.toBe(xmur3(' ')());
  });

  it('returns unsigned 32-bit integers', () => {
    const h = xmur3('range check');
    for (let i = 0; i < 64; i++) {
      const v = h();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('RNG reproducibility', () => {
  it('produces an identical stream for an identical seed', () => {
    expect(take(new RNG('replay-seed'), 2000)).toEqual(take(new RNG('replay-seed'), 2000));
  });

  it('is unaffected by interleaving with another instance', () => {
    // Proves there is no shared/global state hiding inside the generator.
    const solo = take(new RNG('interleave'), 500);
    const a = new RNG('interleave');
    const b = new RNG('other-stream');
    const mixed: number[] = [];
    for (let i = 0; i < 500; i++) { mixed.push(a.next()); b.next(); }
    expect(mixed).toEqual(solo);
  });

  it('gives different streams for different seeds', () => {
    const seeds = Array.from({ length: 40 }, (_, i) => `bout-${i}`);
    const firsts = seeds.map((s) => new RNG(s).next());
    expect(new Set(firsts).size).toBe(seeds.length);
    // And the divergence is not just the first draw.
    const x = take(new RNG('bout-1'), 200);
    const y = take(new RNG('bout-2'), 200);
    expect(x.filter((v, i) => v === y[i]).length).toBe(0);
  });

  it('decorrelates low-entropy neighbouring seeds', () => {
    // The constructor discards 12 warm-up draws precisely for this case.
    const firsts = Array.from({ length: 200 }, (_, i) => new RNG(`s${i}`).next());
    const mean = firsts.reduce((a, b) => a + b, 0) / firsts.length;
    expect(mean).toBeGreaterThan(0.42);
    expect(mean).toBeLessThan(0.58);
    expect(new Set(firsts).size).toBe(firsts.length);
  });

  it('counts draws and resets the counter after warm-up', () => {
    const r = new RNG('counter');
    expect(r.draws).toBe(0);
    take(r, 17);
    expect(r.draws).toBe(17);
    r.range(0, 1); r.int(4); r.chance(0.5);
    expect(r.draws).toBe(20);
    r.normal();
    expect(r.draws).toBe(22); // normal() always consumes exactly 2 draws
    r.weighted([1, 2, 3]);
    expect(r.draws).toBe(23);
  });

  it('exposes the seed it was built from', () => {
    expect(new RNG('kept').seed).toBe('kept');
  });
});

describe('RNG forked streams', () => {
  it('forks reproducibly from the same parent state and label', () => {
    const a = new RNG('parent').fork('fighter-0');
    const b = new RNG('parent').fork('fighter-0');
    expect(take(a, 300)).toEqual(take(b, 300));
  });

  it('gives different children for different labels', () => {
    const p1 = new RNG('parent'), p2 = new RNG('parent');
    expect(take(p1.fork('a'), 100)).not.toEqual(take(p2.fork('b'), 100));
  });

  it('gives different children for repeated forks with the same label', () => {
    // fork() consumes a parent draw, so the parent advances between forks.
    const p = new RNG('parent');
    expect(take(p.fork('x'), 100)).not.toEqual(take(p.fork('x'), 100));
  });

  it('produces children that are uncorrelated with each other', () => {
    const a = new RNG('parent').fork('left');
    const b = new RNG('parent').fork('right');
    const n = 40000;
    let sxy = 0, sx2 = 0, sy2 = 0;
    for (let i = 0; i < n; i++) {
      const x = a.next() - 0.5, y = b.next() - 0.5;
      sxy += x * y; sx2 += x * x; sy2 += y * y;
    }
    const r = sxy / Math.sqrt(sx2 * sy2);
    expect(Math.abs(r)).toBeLessThan(0.02);
  });

  it('produces a child stream that is not a shifted copy of the parent', () => {
    const p = new RNG('parent');
    const child = take(p.fork('c'), 200);
    const parentTail = take(new RNG('parent'), 400);
    for (let shift = 0; shift < 200; shift++) {
      expect(child.every((v, i) => v === parentTail[i + shift])).toBe(false);
    }
  });
});

describe('RNG distribution sanity', () => {
  const N = 200_000;

  it('stays strictly inside [0, 1)', () => {
    const r = new RNG('bounds');
    let lo = 1, hi = 0;
    for (let i = 0; i < N; i++) { const v = r.next(); if (v < lo) lo = v; if (v > hi) hi = v; }
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThan(1);
  });

  it('is uniform: mean ~ 0.5 and a chi-square that clears the 0.1% critical value', () => {
    const r = new RNG('uniformity');
    const bins = new Array(10).fill(0);
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const v = r.next();
      sum += v;
      bins[Math.min(9, Math.floor(v * 10))]++;
    }
    expect(sum / N).toBeGreaterThan(0.495);
    expect(sum / N).toBeLessThan(0.505);
    const expected = N / 10;
    const chi2 = bins.reduce((acc, b) => acc + (b - expected) ** 2 / expected, 0);
    // 9 degrees of freedom, p = 0.001 -> 27.88.
    expect(chi2).toBeLessThan(27.88);
    // Every decile must be populated - catches a generator stuck in a subrange.
    expect(bins.every((b) => b > expected * 0.9)).toBe(true);
  });

  it('has the variance of a uniform distribution (1/12)', () => {
    const r = new RNG('variance');
    let s = 0, s2 = 0;
    for (let i = 0; i < N; i++) { const v = r.next(); s += v; s2 += v * v; }
    const variance = s2 / N - (s / N) ** 2;
    expect(variance).toBeGreaterThan(1 / 12 - 0.004);
    expect(variance).toBeLessThan(1 / 12 + 0.004);
  });

  it('does not repeat itself over a long run', () => {
    const r = new RNG('period');
    const seen = new Set<number>();
    for (let i = 0; i < 100_000; i++) seen.add(r.next());
    // Collisions are possible at 2^-32 granularity but must be vanishingly rare.
    expect(seen.size).toBeGreaterThan(99_990);
  });

  it('range() and int() respect their bounds', () => {
    const r = new RNG('bounded');
    const seenInts = new Set<number>();
    let rangeViolations = 0, intViolations = 0;
    for (let i = 0; i < 50_000; i++) {
      const v = r.range(-3, 7);
      if (!(v >= -3 && v < 7)) rangeViolations++;
      const k = r.int(6);
      if (!Number.isInteger(k) || k < 0 || k >= 6) intViolations++;
      seenInts.add(k);
    }
    expect(rangeViolations).toBe(0);
    expect(intViolations).toBe(0);
    expect(seenInts.size).toBe(6);
    expect(r.int(1)).toBe(0);
  });

  it('chance(p) fires at approximately rate p', () => {
    for (const p of [0.05, 0.3, 0.5, 0.9]) {
      const r = new RNG(`chance-${p}`);
      let hits = 0;
      const n = 100_000;
      for (let i = 0; i < n; i++) if (r.chance(p)) hits++;
      expect(Math.abs(hits / n - p)).toBeLessThan(0.01);
    }
    const r = new RNG('edges');
    expect(r.chance(0)).toBe(false);
    expect(r.chance(1)).toBe(true);
  });
});

describe('RNG normal draws', () => {
  it('is standard normal to within sanity bounds', () => {
    const r = new RNG('normality');
    const n = 100_000;
    let s = 0, s2 = 0, within1 = 0, within2 = 0, within3 = 0;
    for (let i = 0; i < n; i++) {
      const v = r.normal();
      s += v; s2 += v * v;
      if (Math.abs(v) < 1) within1++;
      if (Math.abs(v) < 2) within2++;
      if (Math.abs(v) < 3) within3++;
    }
    const mean = s / n;
    const sd = Math.sqrt(s2 / n - mean * mean);
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(sd).toBeGreaterThan(0.98);
    expect(sd).toBeLessThan(1.02);
    // 68 / 95 / 99.7
    expect(Math.abs(within1 / n - 0.6827)).toBeLessThan(0.01);
    expect(Math.abs(within2 / n - 0.9545)).toBeLessThan(0.01);
    expect(Math.abs(within3 / n - 0.9973)).toBeLessThan(0.005);
  });

  it('honours mean and sd arguments', () => {
    const r = new RNG('shifted');
    const n = 60_000;
    let s = 0, s2 = 0;
    for (let i = 0; i < n; i++) { const v = r.normal(5, 2); s += v; s2 += v * v; }
    const mean = s / n;
    expect(Math.abs(mean - 5)).toBeLessThan(0.05);
    expect(Math.abs(Math.sqrt(s2 / n - mean * mean) - 2)).toBeLessThan(0.05);
  });

  it('never returns a non-finite value even at the extreme of the input range', () => {
    // log(0) is clamped internally; this walks a long stream looking for NaN.
    const r = new RNG('finite');
    let nonFinite = 0;
    for (let i = 0; i < 200_000; i++) if (!Number.isFinite(r.normal())) nonFinite++;
    expect(nonFinite).toBe(0);
  });
});

describe('RNG weighted choice', () => {
  it('selects proportionally to the weights', () => {
    const r = new RNG('weights');
    const counts = [0, 0, 0];
    const n = 120_000;
    for (let i = 0; i < n; i++) counts[r.weighted([1, 2, 3])]++;
    expect(Math.abs(counts[0] / n - 1 / 6)).toBeLessThan(0.01);
    expect(Math.abs(counts[1] / n - 2 / 6)).toBeLessThan(0.01);
    expect(Math.abs(counts[2] / n - 3 / 6)).toBeLessThan(0.01);
  });

  it('never returns an index outside the array', () => {
    const r = new RNG('weights-bounds');
    let outOfRange = 0, pickedZeroWeight = 0;
    for (let i = 0; i < 50_000; i++) {
      const k = r.weighted([0.001, 5, 0, 2.5]);
      if (k < 0 || k >= 4) outOfRange++;
      if (k === 2) pickedZeroWeight++;
    }
    expect(outOfRange).toBe(0);
    expect(pickedZeroWeight).toBe(0);
  });

  it('treats negative weights as zero and never picks them', () => {
    const r = new RNG('weights-neg');
    let wrong = 0;
    for (let i = 0; i < 20_000; i++) if (r.weighted([-5, 1, -1]) !== 1) wrong++;
    expect(wrong).toBe(0);
  });

  it('falls back to index 0 when every weight is zero', () => {
    expect(new RNG('weights-zero').weighted([0, 0, 0])).toBe(0);
    expect(new RNG('weights-empty').weighted([])).toBe(0);
  });

  it('always picks the only candidate', () => {
    const r = new RNG('weights-single');
    let wrong = 0;
    for (let i = 0; i < 5000; i++) if (r.weighted([0.5]) !== 0) wrong++;
    expect(wrong).toBe(0);
  });
});

describe('Digest fingerprint', () => {
  const digestOf = (ns: number[]) => { const d = new Digest(); d.pushAll(ns); return d.value; };

  it('is an 8-character lower-case hex string', () => {
    expect(digestOf([1, 2, 3])).toMatch(/^[0-9a-f]{8}$/);
    expect(new Digest().value).toMatch(/^[0-9a-f]{8}$/);
  });

  it('is deterministic', () => {
    expect(digestOf([1.5, -2.25, 900.125])).toBe(digestOf([1.5, -2.25, 900.125]));
  });

  it('is order-sensitive', () => {
    expect(digestOf([1, 2, 3])).not.toBe(digestOf([3, 2, 1]));
    expect(digestOf([1, 2, 3])).not.toBe(digestOf([1, 3, 2]));
  });

  it('is length-sensitive', () => {
    expect(digestOf([1, 2, 3])).not.toBe(digestOf([1, 2, 3, 0]));
  });

  it('reacts to changes at the recorded precision', () => {
    // The engine records positions to 3 dp, so a 0.001 change must move it.
    expect(digestOf([1.0])).not.toBe(digestOf([1.001]));
    expect(digestOf([1.0])).not.toBe(digestOf([0.999]));
  });

  it('quantises below the recorded precision so float noise cannot move it', () => {
    // This is the property that makes cross-platform verification survivable.
    expect(digestOf([3.0])).toBe(digestOf([3.0001]));
    expect(digestOf([3.0])).toBe(digestOf([2.99996]));
  });

  it('push and pushAll agree', () => {
    const d = new Digest();
    d.push(4); d.push(5); d.push(6);
    expect(d.value).toBe(digestOf([4, 5, 6]));
  });

  it('spreads values across the output space', () => {
    // A hash that collapsed everything to one bucket would still pass the
    // determinism tests above, so check the fingerprints are actually distinct.
    const values = new Set(Array.from({ length: 5000 }, (_, i) => digestOf([i, i * 2, i * 3])));
    expect(values.size).toBeGreaterThan(4990);
  });
});
