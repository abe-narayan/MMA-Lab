/**
 * RUNNING A BATCH FROM THE APP.
 *
 * Starts N workers (N = `workerCountFor(navigator.hardwareConcurrency)`,
 * i.e. cores minus two, at most four), feeds them chunks of bout indices from
 * one queue, and collects `BoutSummary`s keyed by index. The UI thread only
 * ever receives small messages, so it never freezes; the aggregate is
 * computed from the index-sorted summaries, so the numbers are the same for
 * any worker count (tests/ui.batch.test.ts proves it with 1, 2 and 4).
 *
 * Failure handling:
 *  - a bout that throws is recorded as an error for that index and the batch
 *    carries on;
 *  - a worker that dies (fails to load, crashes) has its unfinished chunk put
 *    back on the queue for the others; if every worker is gone, the rest of
 *    the batch runs on the main thread, sliced and yielding, and the outcome
 *    says so.
 *
 * `workerFactory` is injectable so the tests can drive the real protocol
 * through fake Workers (the lesson of the Match-setup bug fixed in 075d641:
 * a message that is built but never posted passes every main-thread test).
 */

import type { SimConfig } from '../../sim';
import { workerCountFor, type BoutSummary } from '../model/batchModel';
import { createBatchRunner, type FromBatchWorker, type ToBatchWorker } from '../workers/batchProtocol';

export interface BatchSpec {
  template: Omit<SimConfig, 'seed'>;
  master: string;
  bouts: number;
}

export interface BatchProgress {
  done: number;
  errors: number;
  total: number;
}

export interface BatchError { index: number; message: string }

export interface BatchOutcome {
  summaries: BoutSummary[];
  errors: BatchError[];
  cancelled: boolean;
  workers: number;
  ranOn: 'workers' | 'main' | 'mixed';
  fallbackReason?: string;
  wallMs: number;
}

export interface BatchHandle {
  promise: Promise<BatchOutcome>;
  cancel(): void;
}

/** The subset of `Worker` the orchestrator uses. */
export interface WorkerLike {
  postMessage(message: ToBatchWorker): void;
  terminate(): void;
  onmessage: ((event: { data: FromBatchWorker }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface BatchRunOptions {
  workers?: number;
  chunkSize?: number;
  onProgress?: (p: BatchProgress) => void;
  /** Throttled onto animation frames by the caller if it wants. */
  onSummary?: (s: BoutSummary) => void;
  workerFactory?: (() => WorkerLike) | null;
  now?: () => number;
}

let jobCounter = 0;

function defaultFactory(): (() => WorkerLike) | null {
  if (typeof Worker === 'undefined' || typeof URL === 'undefined') return null;
  return () => new Worker(new URL('../workers/batchWorker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
}

export function defaultWorkerCount(): number {
  const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined;
  return workerCountFor(hc);
}

export function runBatch(spec: BatchSpec, opts: BatchRunOptions = {}): BatchHandle {
  jobCounter += 1;
  const jobId = `batch-${jobCounter}`;
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const started = now();
  const total = Math.max(0, Math.floor(spec.bouts));
  const chunkSize = Math.max(1, opts.chunkSize ?? (total >= 1000 ? 8 : total >= 100 ? 4 : 1));
  const wanted = Math.max(1, opts.workers ?? defaultWorkerCount());
  const factory = opts.workerFactory === undefined ? defaultFactory() : opts.workerFactory;

  // Chunks are handed out lowest index first.
  const queue: number[][] = [];
  for (let i = 0; i < total; i += chunkSize) {
    queue.push(Array.from({ length: Math.min(chunkSize, total - i) }, (_, k) => i + k));
  }

  const results = new Map<number, BoutSummary>();
  const errors = new Map<number, string>();
  let cancelled = false;
  let settled = false;
  let usedMain = false;
  let usedWorkers = false;
  let fallbackReason: string | undefined;

  let resolveOuter!: (o: BatchOutcome) => void;
  const promise = new Promise<BatchOutcome>((resolve) => { resolveOuter = resolve; });

  interface Slot { w: WorkerLike; chunk: number[] | null; alive: boolean }
  const slots: Slot[] = [];

  const progress = (): void => opts.onProgress?.({ done: results.size, errors: errors.size, total });

  const finish = (): void => {
    if (settled) return;
    settled = true;
    for (const s of slots) { try { s.w.terminate(); } catch { /* already gone */ } }
    resolveOuter({
      summaries: [...results.values()].sort((a, b) => a.index - b.index),
      errors: [...errors.entries()].map(([index, message]) => ({ index, message })).sort((a, b) => a.index - b.index),
      cancelled,
      workers: usedWorkers ? slots.length : 0,
      ranOn: usedMain && usedWorkers ? 'mixed' : usedMain ? 'main' : 'workers',
      ...(fallbackReason ? { fallbackReason } : {}),
      wallMs: now() - started,
    });
  };

  const complete = (): boolean => results.size + errors.size >= total;

  const accept = (m: FromBatchWorker): void => {
    if (m.jobId !== jobId || settled) return;
    if (m.type === 'result') {
      if (!results.has(m.summary.index)) {
        results.set(m.summary.index, m.summary);
        errors.delete(m.summary.index);
        opts.onSummary?.(m.summary);
      }
      progress();
    } else if (m.type === 'bout-error') {
      if (!results.has(m.index)) errors.set(m.index, m.message);
      progress();
    }
  };

  // ---- main-thread fallback: the same runner, yielding between bouts ----
  let mainRunning = false;
  const runOnMain = async (): Promise<void> => {
    if (mainRunning) return;
    mainRunning = true;
    usedMain = true;
    const runner = createBatchRunner({
      post: accept,
      yieldControl: () => new Promise((done) => setTimeout(done, 0)),
    });
    while (!cancelled && queue.length > 0) {
      const chunk = queue.shift() as number[];
      await runner.handle({ type: 'chunk', jobId, template: spec.template, master: spec.master, indices: chunk });
    }
    mainRunning = false;
    if (cancelled || complete()) finish();
  };

  const feed = (slot: Slot): void => {
    if (cancelled || settled) return;
    const chunk = queue.shift();
    if (!chunk) {
      slot.chunk = null;
      if (complete() || slots.every((s) => !s.alive || s.chunk === null)) finish();
      return;
    }
    slot.chunk = chunk;
    slot.w.postMessage({ type: 'chunk', jobId, template: spec.template, master: spec.master, indices: chunk });
  };

  const lose = (slot: Slot, reason: string): void => {
    if (!slot.alive) return;
    slot.alive = false;
    try { slot.w.terminate(); } catch { /* ignore */ }
    // Put back whatever it had not finished.
    if (slot.chunk) {
      const left = slot.chunk.filter((i) => !results.has(i) && !errors.has(i));
      if (left.length > 0) queue.unshift(left);
      slot.chunk = null;
    }
    if (slots.every((s) => !s.alive)) {
      fallbackReason = `${reason} The rest of the batch ran on the main thread.`;
      void runOnMain();
    } else {
      // A surviving idle worker picks the chunk up.
      for (const s of slots) if (s.alive && s.chunk === null) feed(s);
    }
  };

  if (total === 0) {
    queueMicrotask(finish);
  } else if (!factory) {
    fallbackReason = 'Web Workers are unavailable here; the batch ran on the main thread (slower, but it yields so the page stays responsive).';
    void runOnMain();
  } else {
    const count = Math.min(wanted, queue.length);
    for (let k = 0; k < count; k++) {
      let w: WorkerLike;
      try {
        w = factory();
      } catch (err) {
        fallbackReason = `A batch worker could not start (${err instanceof Error ? err.message : String(err)}).`;
        continue;
      }
      const slot: Slot = { w, chunk: null, alive: true };
      slots.push(slot);
      usedWorkers = true;
      w.onmessage = (event) => {
        const m = event.data;
        accept(m);
        if (m.jobId === jobId && m.type === 'chunk-done') feed(slot);
      };
      w.onerror = () => lose(slot, 'A batch worker failed.');
    }
    if (slots.length === 0) {
      usedWorkers = false;
      fallbackReason = `${fallbackReason ?? 'No batch worker could start.'} The batch ran on the main thread.`;
      void runOnMain();
    } else {
      for (const s of slots) feed(s);
    }
  }

  return {
    promise,
    cancel: () => {
      if (settled || cancelled) return;
      cancelled = true;
      for (const s of slots) {
        try { s.w.postMessage({ type: 'cancel', jobId }); } catch { /* ignore */ }
      }
      finish();
    },
  };
}
