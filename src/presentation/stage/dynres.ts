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
