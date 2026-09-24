/**
 * PERFORMANCE PASS SUITE — docs/design/PHASE8_NOTES.md "Performance pass".
 *
 * No GPU in vitest; what this holds is the logic the GPU work depends on:
 *  1. the GPU-time dynamic resolution: converges to the budget from above and below, respects the
 *     floor and ceiling, does not oscillate inside the dead band, moves rarely (every change
 *     reallocates the scene targets), learns the fixed (output-resolution) share of the frame,
 *     and remembers a scale per shot so a cut lands on the right one;
 *  2. the lens depth of field: the signed CoC model (sign = near/far, complete at the range, the
 *     live thin-lens range k·z keeps a fighter at the focus sharp and the fence at the lens fully
 *     soft) and the gather kernel (inside the unit disc, evenly spread, no duplicate taps);
 *  3. the GTAO radius follows the shot's framing (wide shots unchanged);
 *  4. the default quality: an explicit choice wins, a software rasteriser gets Low, WebGL2 is
 *     capped at Medium, the probe maps to tiers against the reference machine, an unknown GPU
 *     gets Medium, Ultra is never chosen automatically; the profile table lists the four presets
 *     in cost order.
 */
import { describe, expect, it } from 'vitest';
import { GpuDynamicResolution } from '../src/presentation/stage/dynres';
import { LENS_DOF_TAPS, signedCoc, vogelDisc } from '../src/presentation/stage/lensDof';
import {
  PROBE_REFERENCE_MS, QUALITY_PROFILES, initialQuality, recommendQuality,
} from '../src/presentation/stage/profiles';
import { QUALITY_LEVELS } from '../src/presentation/stage/quality';
import { aoRadiusFor } from '../src/presentation/stage/pipeline';

/** A synthetic GPU: ms = fixed + variable × scale². */
function gpu(fixed: number, variable: number) {
  return (scale: number): number => fixed + variable * scale * scale;
}

/** Run the controller against a synthetic GPU for `seconds`, one sample per 4 frames at 60 fps. */
function run(c: GpuDynamicResolution, cost: (s: number) => number, seconds: number): number[] {
  const scales: number[] = [];
  const dt = 4 * 16.7;
  for (let t = 0; t < seconds * 1000; t += dt) {
    scales.push(c.sample(cost(c.scale), dt));
  }
  return scales;
}

describe('GPU-time dynamic resolution', () => {
  it('drops a heavy shot to the budget and stays there', () => {
    const c = new GpuDynamicResolution(0.8, { min: 0.6, max: 0.8, targetMs: 15 });
    const cost = gpu(5, 20); // 17.8 ms at 0.8, 14.0 at 0.7
    const s = run(c, cost, 6);
    expect(cost(s[s.length - 1])).toBeLessThanOrEqual(15 * 1.04);
    expect(s[s.length - 1]).toBeGreaterThanOrEqual(0.6);
    // Settled: the last two seconds hold one scale.
    const tail = s.slice(-30);
    expect(new Set(tail).size).toBe(1);
  });

  it('climbs on a light shot to use the headroom, never above the ceiling', () => {
    const c = new GpuDynamicResolution(0.6, { min: 0.6, max: 0.8, targetMs: 15 });
    const cost = gpu(4, 12); // 8.3 ms at 0.6, 11.7 at 0.8
    const s = run(c, cost, 8);
    expect(s[s.length - 1]).toBe(0.8);
    expect(Math.max(...s)).toBeLessThanOrEqual(0.8);
  });

  it('holds the floor when even the floor is over budget', () => {
    const c = new GpuDynamicResolution(0.7, { min: 0.6, max: 0.8, targetMs: 15 });
    const s = run(c, gpu(12, 20), 6); // 19.2 ms at 0.6
    expect(s[s.length - 1]).toBe(0.6);
    expect(Math.min(...s)).toBeGreaterThanOrEqual(0.6);
  });

  it('does not move inside the dead band', () => {
    const c = new GpuDynamicResolution(0.7, { min: 0.6, max: 0.8, targetMs: 15 });
    const s = run(c, () => 15.3, 5);
    expect(new Set(s).size).toBe(1);
  });

  it('changes scale rarely: at most one change per hold interval, in quantised steps', () => {
    const c = new GpuDynamicResolution(0.8, { min: 0.5, max: 0.8, targetMs: 15, holdMs: 600 });
    const s = run(c, gpu(3, 40), 6);
    let changes = 0;
    for (let i = 1; i < s.length; i++) {
      if (s[i] !== s[i - 1]) {
        changes++;
        expect(Math.abs(s[i] - s[i - 1])).toBeLessThanOrEqual(0.1 + 1e-9);
        expect(Math.round(s[i] * 20) / 20).toBeCloseTo(s[i], 9);
      }
    }
    expect(changes).toBeLessThanOrEqual(Math.ceil(6000 / 600));
    expect(changes).toBeGreaterThan(0);
  });

  it('learns the fixed share of the frame from two operating points', () => {
    const c = new GpuDynamicResolution(0.8, { min: 0.5, max: 0.8, targetMs: 12 });
    run(c, gpu(6, 12), 8); // true fixed share at 0.65: 6 / (6 + 12·0.42) ≈ 0.54
    expect(c.estimatedFixedShare).toBeGreaterThan(0.4);
  });

  it('remembers the scale per shot and jumps to it on a cut', () => {
    const c = new GpuDynamicResolution(0.8, { min: 0.6, max: 0.8, targetMs: 15 });
    c.cut('MAIN');
    run(c, gpu(4, 12), 6); // light: settles at 0.8
    expect(c.scale).toBe(0.8);
    c.cut('CAGESIDE');
    run(c, gpu(6, 20), 6); // heavy: settles lower
    const cageside = c.scale;
    expect(cageside).toBeLessThan(0.8);
    expect(c.cut('MAIN')).toBe(0.8);
    expect(c.cut('CAGESIDE')).toBe(cageside);
  });

  it('ignores garbage samples', () => {
    const c = new GpuDynamicResolution(0.7, { min: 0.6, max: 0.8 });
    for (const v of [NaN, -1, 0, 1e6, Infinity]) expect(c.sample(v, 16)).toBe(0.7);
  });
});

describe('lens depth of field', () => {
  it('signed CoC: 0 at focus, negative in front, positive behind, complete at the range', () => {
    expect(signedCoc(4, 4, 2)).toBe(0);
    expect(signedCoc(3, 4, 2)).toBeLessThan(0);
    expect(signedCoc(5, 4, 2)).toBeGreaterThan(0);
    expect(signedCoc(1, 4, 2)).toBe(-1);
    expect(signedCoc(7, 4, 2)).toBe(1);
    // Monotone in distance.
    let prev = -Infinity;
    for (let d = 0.2; d < 10; d += 0.1) {
      const c = signedCoc(d, 4, 2);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });

  it('live thin-lens range (k·z): the fence at the lens is fully soft, the fighters stay sharp', () => {
    // CAGESIDE: strength 0.35 → k = 1.1 / 0.35; focus on the fighters ~2.4 m away.
    const k = 1.1 / 0.35;
    const focus = 2.4;
    const at = (z: number): number => signedCoc(z, focus, Math.max(0.05, z * k));
    expect(at(0.35)).toBeLessThan(-0.05); // clearly out of focus in front
    // The fighters (±0.4 m around focus) are within a few % of sharp.
    expect(Math.abs(at(2.0))).toBeLessThan(0.02);
    expect(Math.abs(at(2.8))).toBeLessThan(0.02);
  });

  it('gather kernel: taps inside the unit disc, evenly spread, distinct', () => {
    const k = vogelDisc(LENS_DOF_TAPS);
    expect(k).toHaveLength(LENS_DOF_TAPS);
    for (const [x, y] of k) expect(Math.hypot(x, y)).toBeLessThanOrEqual(1);
    // Even: half the taps within radius sqrt(1/2) (equal-area rings).
    const inner = k.filter(([x, y]) => Math.hypot(x, y) < Math.SQRT1_2).length;
    expect(Math.abs(inner - LENS_DOF_TAPS / 2)).toBeLessThanOrEqual(1);
    // Centroid near the centre (no directional bias in the blur).
    const cx = k.reduce((a, [x]) => a + x, 0) / k.length;
    const cy = k.reduce((a, [, y]) => a + y, 0) / k.length;
    expect(Math.hypot(cx, cy)).toBeLessThan(0.08);
    const keys = new Set(k.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`));
    expect(keys.size).toBe(LENS_DOF_TAPS);
  });
});

describe('GTAO radius per shot', () => {
  it('wide shots keep the 0.4 m human-scale radius', () => {
    expect(aoRadiusFor(12, 20)).toBe(0.4); // MAIN
    expect(aoRadiusFor(8, 30)).toBe(0.4);
  });
  it('close handhelds hold it to ~15 % of the frame height, never below 0.12 m', () => {
    const r = aoRadiusFor(2.4, 30); // CAGESIDE: frame ≈ 1.29 m tall at the fighters
    expect(r).toBeCloseTo(0.15 * 2 * 2.4 * Math.tan(Math.PI / 12), 6);
    expect(r).toBeLessThan(0.4);
    expect(aoRadiusFor(0.5, 10)).toBe(0.12);
  });
  it('is monotone in focus distance', () => {
    let prev = 0;
    for (let f = 0.5; f < 20; f += 0.25) { const r = aoRadiusFor(f, 30); expect(r).toBeGreaterThanOrEqual(prev); prev = r; }
  });
});

describe('default quality', () => {
  it('an explicit user choice always wins', () => {
    expect(initialQuality('ultra', { level: 'low', reason: '' })).toBe('ultra');
    expect(initialQuality('low', { level: 'high', reason: '' })).toBe('low');
  });

  it('without a choice: the recommendation, else Medium', () => {
    expect(initialQuality(null, { level: 'high', reason: '' })).toBe('high');
    expect(initialQuality(null, null)).toBe('medium');
  });

  it('software rasterisers and no GPU get Low', () => {
    expect(recommendQuality({ backend: 'none' }).level).toBe('low');
    expect(recommendQuality({ backend: 'webgpu', adapter: { isFallbackAdapter: true }, probeMs: 1 }).level).toBe('low');
    expect(recommendQuality({ backend: 'webgl2', adapter: { description: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))' } }).level).toBe('low');
  });

  it('the probe maps to tiers against the reference machine; Ultra is never automatic', () => {
    const r = PROBE_REFERENCE_MS;
    expect(recommendQuality({ backend: 'webgpu', probeMs: r }).level).toBe('high');
    expect(recommendQuality({ backend: 'webgpu', probeMs: r * 0.1 }).level).toBe('high');
    expect(recommendQuality({ backend: 'webgpu', probeMs: r * 2 }).level).toBe('medium');
    expect(recommendQuality({ backend: 'webgpu', probeMs: r * 4 }).level).toBe('low');
  });

  it('WebGL2 is capped at Medium, even on a fast GPU', () => {
    expect(recommendQuality({ backend: 'webgl2', probeMs: PROBE_REFERENCE_MS * 0.2 }).level).toBe('medium');
    expect(recommendQuality({ backend: 'webgl2', adapter: { description: 'NVIDIA GeForce RTX 4080' } }).level).toBe('medium');
  });

  it('without a probe: adapter heuristics, Medium for anything unknown', () => {
    expect(recommendQuality({ backend: 'webgpu', adapter: { vendor: 'nvidia', architecture: 'ada' } }).level).toBe('high');
    expect(recommendQuality({ backend: 'webgpu', adapter: { vendor: 'intel', architecture: 'xe2-lpg' } }).level).toBe('high');
    expect(recommendQuality({ backend: 'webgpu', adapter: { vendor: 'intel', architecture: 'gen-12lp' } }).level).toBe('medium');
    expect(recommendQuality({ backend: 'webgpu', adapter: {} }).level).toBe('medium');
    expect(recommendQuality({ backend: 'webgpu' }).level).toBe('medium');
  });

  it('the profile table lists the four presets in cost order', () => {
    expect(QUALITY_PROFILES.map((p) => p.level)).toEqual([...QUALITY_LEVELS]);
    for (let i = 1; i < QUALITY_PROFILES.length; i++) {
      expect(QUALITY_PROFILES[i].arcMs.main).toBeGreaterThan(QUALITY_PROFILES[i - 1].arcMs.main);
      expect(QUALITY_PROFILES[i].arcMs.cageside).toBeGreaterThan(QUALITY_PROFILES[i - 1].arcMs.cageside);
    }
    // High holds the 60 fps budget on the reference machine on every measured shot.
    const high = QUALITY_PROFILES.find((p) => p.level === 'high')!;
    expect(Math.max(high.arcMs.main, high.arcMs.cageside)).toBeLessThanOrEqual(16);
  });
});
