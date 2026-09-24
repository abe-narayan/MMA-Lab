/**
 * RESOURCE MONITOR — docs/design/09 §6.1–6.2, and the user's hard rule: total
 * CPU and total RAM each stay at or below 93 % at all times.
 *
 *   - `sampleCpu` / `sampleRam`: machine-wide utilisation from `os.cpus()` tick
 *     deltas (works on Windows, where `os.loadavg()` is always 0) and from
 *     `os.freemem()`.
 *   - `Throttle`: the pure pause / resume / shrink state machine, fed one
 *     sample at a time so the tests can drive it with synthetic numbers.
 *       pause   when CPU > cap or RAM > cap (cap 0.88: 5 points of headroom under the 93 % rule for load outside the batch)
 *       resume  when CPU < 0.80 and RAM < 0.80 (hysteresis)
 *       shrink  one worker for every 30 s the pause persists (never below 1)
 *       relaxed resume: once the pool is down to one worker and has been
 *         paused for 60 s, resume below cap − 2 pp instead of 85 %, so a
 *         machine that simply sits at 88–91 % because of somebody else's
 *         browser does not stall the run forever. One worker is one bout on
 *         one core at a time, so the cap still holds.
 *   - `ResourceMonitor`: samples every 2 s, drives the throttle, keeps the
 *     peaks for the report and appends every sample to `monitor.jsonl`.
 *   - `poolBudget`: §6.1 sizing (CPU budget from the cores this process may
 *     use, memory budget from free RAM above the 7 % floor).
 *   - `confineSelf`: below-normal priority and, on Windows, a processor
 *     affinity mask (default 0x1F = 5 of 8 cores) on this process; worker
 *     threads are threads of this process and so inherit both.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { constants, cpus, freemem, setPriority, totalmem } from 'node:os';

export interface Sample {
  /** ms since the monitor started. */
  t: number;
  cpu: number;
  ram: number;
}

type CpuTimes = { idle: number; total: number }[];

function cpuSnapshot(): CpuTimes {
  return cpus().map((c) => {
    const t = c.times;
    return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq };
  });
}

/** Machine-wide CPU busy fraction between two snapshots. */
export function cpuBusy(a: CpuTimes, b: CpuTimes): number {
  let idle = 0;
  let total = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    idle += b[i].idle - a[i].idle;
    total += b[i].total - a[i].total;
  }
  return total > 0 ? Math.max(0, Math.min(1, 1 - idle / total)) : 0;
}

export function sampleRam(): number {
  return 1 - freemem() / totalmem();
}

// ---------------------------------------------------------------------------
// The throttle state machine (pure)
// ---------------------------------------------------------------------------

export interface ThrottleOptions {
  cap: number;
  resumeBelow: number;
  shrinkAfterMs: number;
  relaxedAfterMs: number;
  relaxedMargin: number;
}

export const DEFAULT_THROTTLE: ThrottleOptions = {
  cap: 0.88,
  resumeBelow: 0.80,
  shrinkAfterMs: 30_000,
  relaxedAfterMs: 60_000,
  relaxedMargin: 0.02,
};

export type ThrottleAction = 'pause' | 'resume' | 'shrink';

export class Throttle {
  paused = false;
  private pausedAt = 0;
  private lastShrinkAt = 0;

  constructor(readonly opts: ThrottleOptions = DEFAULT_THROTTLE) {}

  /**
   * Feed one sample. `workers` is the current pool size; the throttle never
   * asks for a shrink below one worker.
   */
  update(s: Sample, workers: number): ThrottleAction[] {
    const o = this.opts;
    const over = s.cpu > o.cap || s.ram > o.cap;
    const out: ThrottleAction[] = [];
    if (!this.paused) {
      if (over) {
        this.paused = true;
        this.pausedAt = s.t;
        this.lastShrinkAt = s.t;
        out.push('pause');
      }
      return out;
    }
    const calm = s.cpu < o.resumeBelow && s.ram < o.resumeBelow;
    const relaxed = workers <= 1 && s.t - this.pausedAt >= o.relaxedAfterMs
      && s.cpu < o.cap - o.relaxedMargin && s.ram < o.cap - o.relaxedMargin;
    if (calm || relaxed) {
      this.paused = false;
      out.push('resume');
      return out;
    }
    if (workers > 1 && s.t - this.lastShrinkAt >= o.shrinkAfterMs) {
      this.lastShrinkAt = s.t;
      out.push('shrink');
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Pool sizing (§6.1)
// ---------------------------------------------------------------------------

export interface BudgetInput {
  cores: number;
  /** Cores this process may run on (affinity). */
  allowedCores: number;
  freeBytes: number;
  totalBytes: number;
  perWorkerBytes: number;
  cap: number;
  maxWorkers: number;
  reserved?: number;
}

export interface Budget {
  cpuBudget: number;
  memBudget: number;
  workers: number;
}

export function poolBudget(b: BudgetInput): Budget {
  const cpuBudget = Math.min(Math.floor(b.cores * b.cap), b.allowedCores) - (b.reserved ?? 0);
  const memBudget = Math.floor((b.freeBytes - (1 - b.cap) * b.totalBytes) / b.perWorkerBytes);
  const workers = Math.max(1, Math.min(32, cpuBudget, memBudget, b.maxWorkers));
  return { cpuBudget, memBudget, workers };
}

export function popcount(maskHex: string): number {
  let v = parseInt(maskHex, 16);
  let c = 0;
  while (v > 0) {
    c += v & 1;
    v >>>= 1;
  }
  return c;
}

/** Lower this process's priority and, on Windows, pin it to `maskHex`'s cores. */
export function confineSelf(maskHex: string): string {
  const notes: string[] = [];
  try {
    setPriority(process.pid, constants.priority.PRIORITY_BELOW_NORMAL);
    notes.push('priority below-normal');
  } catch (e) {
    notes.push(`priority unchanged (${e instanceof Error ? e.message : String(e)})`);
  }
  if (process.platform === 'win32') {
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `(Get-Process -Id ${process.pid}).ProcessorAffinity = 0x${maskHex}`], { stdio: 'ignore' });
      notes.push(`affinity 0x${maskHex} (${popcount(maskHex)} cores)`);
    } catch {
      notes.push('affinity unchanged (PowerShell call failed)');
    }
  } else {
    notes.push('affinity not set (non-Windows)');
  }
  return notes.join(', ');
}

// ---------------------------------------------------------------------------
// The live monitor
// ---------------------------------------------------------------------------

export interface MonitorOptions {
  sampleMs: number;
  throttle: ThrottleOptions;
  /** Optional JSONL file every sample is appended to. */
  logFile?: string;
  log: (line: string) => void;
}

export interface MonitorListener {
  sample(s: Sample): void;
  action(a: ThrottleAction, s: Sample): void;
}

export class ResourceMonitor {
  readonly throttle: Throttle;
  peakCpu = 0;
  peakRam = 0;
  meanCpu = 0;
  samples = 0;
  pauses = 0;
  shrinks = 0;
  pausedMs = 0;
  last: Sample = { t: 0, cpu: 0, ram: sampleRam() };
  private timer: ReturnType<typeof setInterval> | null = null;
  private prev: CpuTimes = cpuSnapshot();
  private readonly t0 = Date.now();
  private listeners: MonitorListener[] = [];
  /** Current pool size, supplied by the pool. */
  workers = () => 1;

  constructor(readonly opts: MonitorOptions) {
    this.throttle = new Throttle(opts.throttle);
  }

  get paused(): boolean {
    return this.throttle.paused;
  }

  on(l: MonitorListener): void {
    this.listeners.push(l);
  }

  /** Take one sample now (the CPU figure covers the time since the last one). */
  tick(): Sample {
    const snap = cpuSnapshot();
    const s: Sample = { t: Date.now() - this.t0, cpu: cpuBusy(this.prev, snap), ram: sampleRam() };
    const dtMs = s.t - this.last.t;
    this.prev = snap;
    if (this.throttle.paused) this.pausedMs += dtMs;
    this.last = s;
    this.samples++;
    this.meanCpu += (s.cpu - this.meanCpu) / this.samples;
    if (s.cpu > this.peakCpu) this.peakCpu = s.cpu;
    if (s.ram > this.peakRam) this.peakRam = s.ram;
    if (this.opts.logFile) {
      try {
        appendFileSync(this.opts.logFile, `${JSON.stringify({ t: s.t, cpu: +s.cpu.toFixed(3), ram: +s.ram.toFixed(3), w: this.workers(), p: this.throttle.paused })}\n`);
      } catch { /* the log is a convenience */ }
    }
    for (const l of this.listeners) l.sample(s);
    for (const a of this.throttle.update(s, this.workers())) {
      if (a === 'pause') this.pauses++;
      if (a === 'shrink') this.shrinks++;
      this.opts.log(`[monitor] ${a}: cpu ${(100 * s.cpu).toFixed(0)} % · ram ${(100 * s.ram).toFixed(0)} % · workers ${this.workers()}`);
      for (const l of this.listeners) l.action(a, s);
    }
    return s;
  }

  /**
   * Start sampling. Takes a first 1 s CPU window immediately so the pool never
   * starts on an unmeasured machine.
   */
  async start(): Promise<Sample> {
    this.prev = cpuSnapshot();
    await new Promise((r) => setTimeout(r, 1000));
    const s = this.tick();
    this.timer = setInterval(() => this.tick(), this.opts.sampleMs);
    return s;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  summary(): { peakCpu: number; peakRam: number; meanCpu: number; samples: number; pauses: number; shrinks: number; pausedS: number } {
    return {
      peakCpu: +this.peakCpu.toFixed(3),
      peakRam: +this.peakRam.toFixed(3),
      meanCpu: +this.meanCpu.toFixed(3),
      samples: this.samples,
      pauses: this.pauses,
      shrinks: this.shrinks,
      pausedS: Math.round(this.pausedMs / 1000),
    };
  }
}
