/**
 * DYNAMIC RESOLUTION — hold the frame-time target by moving the internal scale.
 *
 * Pure logic, no GPU: fed one frame interval at a time, it answers "what should
 * the internal render scale be". Only the TAAU presets use it, because only a
 * temporal upscaler hides a changing input resolution.
 *
 * The signal is the wall-clock interval between rendered frames. On a vsynced
 * display that interval is quantised (16.7 ms, then 33 ms), so it can say "too
 * slow" but never "how much headroom". The controller therefore drops quickly
 * when frames are late, climbs back slowly and in small steps, and remembers a
 * scale that failed so it does not oscillate around it.
 */
export interface DynResOptions {
  min: number;
  max: number;
  /** Target frame interval, ms (60 fps = 16.7). */
  targetMs?: number;
  step?: number;
}

export class DynamicResolution {
  scale: number;
  private readonly min: number;
  private readonly max: number;
  private readonly targetMs: number;
  private readonly step: number;
  private avg = 0;
  private slowFor = 0;
  private fastFor = 0;
  /** A scale that proved too slow, and how long (ms) before it may be tried again. */
  private ceiling = Infinity;
  private ceilingTtl = 0;

  constructor(start: number, opts: DynResOptions) {
    this.min = opts.min;
    this.max = opts.max;
    this.targetMs = opts.targetMs ?? 1000 / 60;
    this.step = opts.step ?? 0.05;
    this.scale = Math.min(this.max, Math.max(this.min, start));
  }

  /** Feed one frame interval (ms). Returns the scale to render the next frame at. */
  sample(frameMs: number): number {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) return this.scale;
    // Exponential average over ~10 frames: one hitch is not a trend.
    this.avg = this.avg === 0 ? frameMs : this.avg + (frameMs - this.avg) * 0.1;
    if (this.ceilingTtl > 0) {
      this.ceilingTtl -= frameMs;
      if (this.ceilingTtl <= 0) this.ceiling = Infinity;
    }
    const late = this.avg > this.targetMs * 1.12;
    const comfy = this.avg < this.targetMs * 1.04;
    this.slowFor = late ? this.slowFor + frameMs : 0;
    this.fastFor = comfy ? this.fastFor + frameMs : 0;

    if (this.slowFor > 500 && this.scale > this.min) {
      this.ceiling = this.scale;
      this.ceilingTtl = 15000;
      this.scale = Math.max(this.min, round2(this.scale - this.step));
      this.slowFor = 0;
      this.avg = this.targetMs;
    } else if (this.fastFor > 3000 && this.scale < this.max) {
      const next = Math.min(this.max, round2(this.scale + this.step));
      if (next < this.ceiling - 1e-6) {
        this.scale = next;
      }
      this.fastFor = 0;
    }
    return this.scale;
  }

  reset(scale: number): void {
    this.scale = Math.min(this.max, Math.max(this.min, scale));
    this.avg = 0;
    this.slowFor = 0;
    this.fastFor = 0;
    this.ceiling = Infinity;
    this.ceilingTtl = 0;
  }
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * GPU-TIME DYNAMIC RESOLUTION (performance pass) — the controller used when the
 * GPU reports its own time per frame (WebGPU timestamp queries).
 *
 * Unlike the frame interval, GPU time is not quantised by vsync: it says how
 * much headroom there is, so the controller can also *raise* the internal
 * scale on a light shot (more detail for free) and lower it just enough on a
 * heavy one. Model: frame GPU time = fixed + variable × scale², where `fixed`
 * is the output-resolution work (temporal resolve, grade, sharpen) that does
 * not move with the input scale. The fixed share is estimated online from two
 * operating points; until then a prior (35 %) is used.
 *
 * Stability: an exponential average over ~8 samples, a ±4 % dead band around
 * the target, scale changes quantised to 0.05 and at most one change per
 * `holdMs` (every change reallocates the scene targets, so it must be rare),
 * and never more than two steps at a time.
 *
 * Shot memory: `cut(shotKey)` on a camera cut jumps straight to the scale
 * that last held the target on that kind of shot (a cut already re-seeds the
 * temporal history, so the change is invisible there). A cageside shot after
 * a main shot therefore starts at its own scale instead of spending half a
 * second over budget.
 */
export interface GpuDynResOptions {
  /** Lowest scale (quality floor). */
  min: number;
  max: number;
  /** GPU budget per frame, ms (below the 16.7 ms display interval, for the compositor). */
  targetMs?: number;
  quantum?: number;
  holdMs?: number;
}

export class GpuDynamicResolution {
  scale: number;
  private readonly min: number;
  private readonly max: number;
  private readonly targetMs: number;
  private readonly quantum: number;
  private readonly holdMs: number;
  private avg = 0;
  private samples = 0;
  private sinceChange = Infinity;
  private fixedShare = 0.35;
  /** The last settled (gpuMs, scale) at another scale, for the fixed-share estimate. */
  private other: { ms: number; scale: number } | null = null;
  private readonly memory = new Map<string, number>();
  private shot = '';

  constructor(start: number, opts: GpuDynResOptions) {
    this.min = opts.min;
    this.max = opts.max;
    this.targetMs = opts.targetMs ?? 15;
    this.quantum = opts.quantum ?? 0.05;
    this.holdMs = opts.holdMs ?? 600;
    this.scale = this.clampQ(start);
  }

  private clampQ(s: number): number {
    const q = Math.round(s / this.quantum) * this.quantum;
    return Math.round(Math.min(this.max, Math.max(this.min, q)) * 1000) / 1000;
  }

  /** Estimated GPU ms at `scale` given `ms` measured at the current scale. */
  predict(ms: number, from: number, to: number): number {
    const f = this.fixedShare;
    return ms * (f + (1 - f) * (to * to) / Math.max(1e-6, from * from));
  }

  /** The scale that would bring `ms` (measured at `from`) to the target. */
  solve(ms: number, from: number): number {
    const f = this.fixedShare;
    const variable = ms * (1 - f);
    const room = this.targetMs - ms * f;
    if (variable <= 0) return this.max;
    if (room <= 0) return this.min;
    return from * Math.sqrt(room / variable);
  }

  /**
   * Feed one frame's GPU time (ms) and the wall time since the previous sample
   * (ms). Returns the scale to render at next.
   */
  sample(gpuMs: number, dtMs: number): number {
    if (!Number.isFinite(gpuMs) || gpuMs <= 0 || gpuMs > 200) return this.scale;
    this.avg = this.samples === 0 ? gpuMs : this.avg + (gpuMs - this.avg) * 0.125;
    this.samples++;
    this.sinceChange += Math.max(0, dtMs);
    if (this.samples < 4 || this.sinceChange < this.holdMs) return this.scale;
    const err = this.avg / this.targetMs;
    this.observe(this.avg, this.scale);
    if (err > 0.96 && err < 1.04) {
      this.memory.set(this.shot, this.scale);
      return this.scale;
    }
    let next = this.clampQ(this.solve(this.avg, this.scale));
    // Never more than two quanta per move: the model is approximate.
    const lim = 2 * this.quantum + 1e-9;
    next = this.clampQ(Math.min(this.scale + lim, Math.max(this.scale - lim, next)));
    // Climbing: only if the prediction at the new scale is still under the target.
    if (next > this.scale && this.predict(this.avg, this.scale, next) > this.targetMs * 1.02) {
      next = this.scale;
    }
    if (next !== this.scale) {
      // Leaving this scale: its settled point becomes the reference for the next one.
      if (this.pending) this.other = this.pending;
      this.pending = null;
      this.scale = next;
      this.sinceChange = 0;
      this.samples = 0;
    } else if (err <= 1.04) {
      this.memory.set(this.shot, this.scale);
    }
    return this.scale;
  }

  private observe(ms: number, scale: number): void {
    this.pending = { ms, scale };
    this.learn(ms, scale);
  }

  /**
   * Two operating points give the fixed share: ms = F + V s². Called with every
   * settled measurement; `other` keeps the latest point at a different scale.
   */
  private learn(ms: number, scale: number): void {
    const o = this.other;
    if (o && Math.abs(o.scale - scale) >= 0.049) {
      const s1 = o.scale * o.scale, s2 = scale * scale;
      const v = (o.ms - ms) / (s1 - s2);
      const f = ms - v * s2;
      if (v > 0 && f >= 0) {
        const share = f / ms;
        if (share > 0.05 && share < 0.8) this.fixedShare = this.fixedShare * 0.5 + share * 0.5;
      }
    }
  }

  /** The current scale's settled point, promoted to `other` when the scale changes. */
  private pending: { ms: number; scale: number } | null = null;

  /** A camera cut to `shotKey`: jump to the scale remembered for that shot, if any. */
  cut(shotKey: string): number {
    if (shotKey === this.shot) return this.scale;
    this.memory.set(this.shot, this.scale);
    this.shot = shotKey;
    const remembered = this.memory.get(shotKey);
    if (remembered !== undefined) this.scale = remembered;
    this.samples = 0;
    this.avg = 0;
    this.sinceChange = this.holdMs; // may correct as soon as the new shot has four samples
    this.other = null;
    this.pending = null;
    return this.scale;
  }

  get estimatedFixedShare(): number {
    return this.fixedShare;
  }
}

/** Rolling fps / frame-time meter for `window.__stats`. */
export class FrameMeter {
  fps = 0;
  frameMs = 0;
  private last = -1;
  private readonly times: number[] = [];

  /** Record a frame presented at `now` (ms, monotonic). */
  tick(now: number): void {
    if (this.last >= 0) {
      const dt = now - this.last;
      if (dt > 0 && dt < 1000) {
        this.times.push(dt);
        if (this.times.length > 60) this.times.shift();
        const sum = this.times.reduce((a, b) => a + b, 0);
        this.frameMs = sum / this.times.length;
        this.fps = this.frameMs > 0 ? 1000 / this.frameMs : 0;
      }
    }
    this.last = now;
  }

  reset(): void {
    this.last = -1;
    this.times.length = 0;
    this.fps = 0;
    this.frameMs = 0;
  }
}
