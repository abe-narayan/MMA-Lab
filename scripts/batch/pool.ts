/**
 * WORKER POOL — Node `worker_threads`, one bout per worker at a time, driven
 * by the resource monitor (docs/design/09 §6.1–6.2).
 *
 *   - Starts with ONE worker and adds one per monitor sample while the sample
 *     is calm (< resume threshold) and the §6.1 budget allows, up to the
 *     target. A cold start therefore never spikes the machine.
 *   - While the monitor says `paused`, no bout is dispatched; busy workers
 *     finish the bout they hold.
 *   - `shrink`: one worker is retired (terminated now if idle, after its
 *     current bout otherwise) and the target drops by one for the rest of the
 *     run. The pool never goes below one worker.
 *   - A crashed worker's bout is re-queued and the worker replaced.
 *
 * Results are handed to `onRow` in completion order; the order is irrelevant
 * because every row is a pure function of its job.
 */
import { Worker } from 'node:worker_threads';
import type { ResourceMonitor, Sample, ThrottleAction } from './monitor';
import type { JobMessage, ResultRow, WorkerReply } from './types';

export interface JobSource {
  /** Next job, or null when the plan is exhausted. */
  next(): JobMessage | null;
}

export interface PoolOptions {
  workerUrl: URL;
  /** Upper bound after the §6.1 budget. */
  target: number;
  monitor: ResourceMonitor;
  /** Recomputed live: how many workers free RAM would allow right now. */
  memBudget: () => number;
  log: (line: string) => void;
  onRow: (row: ResultRow) => void;
  onError: (key: string, message: string) => void;
  /** Called after every completed bout (progress line, etc.). */
  onProgress?: () => void;
  /** Stop dispatching (Ctrl-C): busy workers finish, then `run` resolves. */
  stopRequested?: () => boolean;
  /** Workers to spawn at once instead of ramping from one (tests). Default 1. */
  startWorkers?: number;
}

interface Slot {
  id: number;
  w: Worker;
  ready: boolean;
  job: JobMessage | null;
  retiring: boolean;
}

export class Pool {
  private slots: Slot[] = [];
  private requeue: JobMessage[] = [];
  private exhausted = false;
  private nextId = 0;
  private target: number;
  private resolveDone: (() => void) | null = null;
  private rejectDone: ((e: Error) => void) | null = null;
  private crashes = 0;
  peakWorkers = 0;
  completed = 0;

  constructor(private readonly src: JobSource, private readonly o: PoolOptions) {
    this.target = Math.max(1, o.target);
  }

  get size(): number {
    return this.slots.length;
  }

  run(): Promise<void> {
    const mon = this.o.monitor;
    mon.workers = () => this.slots.length;
    mon.on({
      sample: (s) => this.onSample(s),
      action: (a, s) => this.onAction(a, s),
    });
    return new Promise<void>((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
      if (!mon.paused) {
        const k = Math.max(1, Math.min(this.target, this.o.startWorkers ?? 1));
        for (let j = 0; j < k; j++) this.spawn();
      } else this.o.log(`[pool] waiting to start: cpu ${(100 * mon.last.cpu).toFixed(0)} % · ram ${(100 * mon.last.ram).toFixed(0)} % is above the ${(100 * mon.throttle.opts.cap).toFixed(0)} % cap`);
    });
  }

  private lastWaitLog = 0;

  private onSample(s: Sample): void {
    const mon = this.o.monitor;
    if (mon.paused) {
      if (this.slots.length === 0 && s.t - this.lastWaitLog >= 30_000) {
        this.lastWaitLog = s.t;
        this.o.log(`[pool] still waiting: cpu ${(100 * s.cpu).toFixed(0)} % · ram ${(100 * s.ram).toFixed(0)} % (resume below ${(100 * mon.throttle.opts.resumeBelow).toFixed(0)} %)`);
      }
      return;
    }
    if (this.slots.length === 0 && !this.finishedDispatching()) {
      this.spawn();
      return;
    }
    // Grow by one per calm sample, within the target and the live RAM budget:
    // CPU below the resume threshold, RAM 3 pp under the cap, and free memory
    // for one more worker above the 7 % floor (`memBudget`).
    const calm = s.cpu < mon.throttle.opts.resumeBelow && s.ram < mon.throttle.opts.cap - 0.03;
    const allReady = this.slots.every((x) => x.ready);
    if (calm && allReady && this.slots.length < this.target && this.o.memBudget() > this.slots.length
      && !this.finishedDispatching() && !this.o.stopRequested?.()) {
      this.spawn();
    }
  }

  private onAction(a: ThrottleAction, _s: Sample): void {
    if (a === 'resume') {
      for (const slot of this.slots) if (slot.ready && !slot.job) this.dispatch(slot);
      if (this.slots.length === 0) this.spawn();
    } else if (a === 'shrink') {
      if (this.slots.length <= 1) return;
      this.target = Math.max(1, Math.min(this.target, this.slots.length) - 1);
      const idle = this.slots.find((x) => !x.job && !x.retiring);
      if (idle) this.retire(idle);
      else {
        const busy = this.slots.find((x) => !x.retiring);
        if (busy) busy.retiring = true;
      }
      this.o.log(`[pool] shrinking to ${this.target} worker(s)`);
    }
  }

  private finishedDispatching(): boolean {
    return (this.exhausted && this.requeue.length === 0) || Boolean(this.o.stopRequested?.());
  }

  private spawn(): void {
    const w = new Worker(this.o.workerUrl, { execArgv: ['--import', 'tsx'] });
    const slot: Slot = { id: this.nextId++, w, ready: false, job: null, retiring: false };
    this.slots.push(slot);
    this.peakWorkers = Math.max(this.peakWorkers, this.slots.length);
    w.on('message', (m: WorkerReply) => this.onMessage(slot, m));
    w.on('error', (err) => this.onCrash(slot, err));
    w.on('exit', (code) => {
      if (this.slots.includes(slot)) this.onCrash(slot, new Error(`worker exited with code ${code}`));
    });
  }

  private retire(slot: Slot): void {
    this.slots = this.slots.filter((x) => x !== slot);
    void slot.w.terminate();
    this.checkDone();
  }

  private onCrash(slot: Slot, err: Error): void {
    if (!this.slots.includes(slot)) return;
    this.slots = this.slots.filter((x) => x !== slot);
    this.crashes++;
    this.o.log(`[pool] worker ${slot.id} crashed: ${err.message}`);
    if (slot.job) this.requeue.push(slot.job);
    if (this.crashes > 20) {
      this.rejectDone?.(new Error('too many worker crashes; aborting'));
      return;
    }
    if (!this.o.monitor.paused && !this.finishedDispatching()) this.spawn();
    this.checkDone();
  }

  private onMessage(slot: Slot, m: WorkerReply): void {
    if (m.type === 'ready') {
      slot.ready = true;
      this.dispatch(slot);
      return;
    }
    const job = slot.job;
    slot.job = null;
    if (m.type === 'row') {
      this.completed++;
      this.o.onRow(m.row);
    } else {
      this.o.onError(m.key, m.message);
    }
    void job;
    this.o.onProgress?.();
    if (slot.retiring) {
      this.retire(slot);
      return;
    }
    this.dispatch(slot);
  }

  private dispatch(slot: Slot): void {
    if (slot.job || !slot.ready) return;
    if (slot.retiring) {
      this.retire(slot);
      return;
    }
    if (this.o.monitor.paused || this.o.stopRequested?.()) {
      this.checkDone();
      return;
    }
    let job = this.requeue.pop() ?? null;
    if (!job && !this.exhausted) {
      job = this.src.next();
      if (!job) this.exhausted = true;
    }
    if (!job) {
      this.checkDone();
      return;
    }
    slot.job = job;
    slot.w.postMessage(job);
  }

  private checkDone(): void {
    const busy = this.slots.some((x) => x.job !== null);
    if (busy) return;
    if (this.finishedDispatching()) {
      const slots = this.slots;
      this.slots = [];
      void Promise.all(slots.map((x) => x.w.terminate())).then(() => this.resolveDone?.());
    }
  }
}
