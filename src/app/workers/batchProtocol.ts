/**
 * BATCH WORKER PROTOCOL — many seeded bouts per worker, summaries back.
 *
 *   ToBatchWorker   { type: 'chunk', jobId, template, master, indices }
 *                   | { type: 'cancel', jobId }
 *   FromBatchWorker { type: 'result', jobId, summary }
 *                   | { type: 'bout-error', jobId, index, message }
 *                   | { type: 'chunk-done', jobId }
 *
 * The main thread hands each worker a small chunk of bout indices at a time
 * and sends the next chunk when it reports `chunk-done`: a dynamic queue, so
 * a worker that draws long bouts simply takes fewer chunks, and a cancel
 * never has to wait for more than one bout per worker.
 *
 * Every bout runs through the same `createRunner` the single-bout worker
 * uses (unrecorded, no frames), so a batch bout and a Match-setup bout with
 * the same seed are the same bout. Only a ~120-byte `BoutSummary` crosses
 * the thread boundary; the event stream is dropped inside the worker, which
 * is what keeps a 5,000-bout batch at a few megabytes.
 *
 * Environment-free for the same reason as `simProtocol.ts`: the tests drive
 * this exact code, and `batchWorker.ts` is a shim.
 */

import type { SimConfig } from '../../sim';
import { batchConfig, summarise, type BoutSummary } from '../model/batchModel';
import { createRunner, type FromWorker } from './simProtocol';

export interface ChunkMessage {
  type: 'chunk';
  jobId: string;
  template: Omit<SimConfig, 'seed'>;
  master: string;
  indices: number[];
}

export type ToBatchWorker = ChunkMessage | { type: 'cancel'; jobId: string };

export type FromBatchWorker =
  | { type: 'result'; jobId: string; summary: BoutSummary }
  | { type: 'bout-error'; jobId: string; index: number; message: string }
  | { type: 'chunk-done'; jobId: string };

export interface BatchRunnerHost {
  post(message: FromBatchWorker): void;
  /** Between bouts; a real macrotask in the browser so `cancel` is delivered. */
  yieldControl?: () => Promise<void>;
}

/** Ticks per slice inside one bout: large, because nobody watches its progress. */
const SLICE_TICKS = 4000;

export function createBatchRunner(host: BatchRunnerHost): { handle(m: ToBatchWorker): Promise<void> } {
  const cancelled = new Set<string>();
  const yieldControl = host.yieldControl ?? (() => Promise.resolve());

  async function runOne(jobId: string, template: ChunkMessage['template'], master: string, index: number): Promise<void> {
    let outcome: FromWorker | null = null;
    const runner = createRunner({
      post: (m) => { if (m.type !== 'progress') outcome = m; },
      yieldControl: () => Promise.resolve(),
    });
    await runner.handle({
      type: 'run', id: `${jobId}#${index}`, config: batchConfig(template, master, index),
      record: false, progressEveryTicks: SLICE_TICKS,
    });
    const o = outcome as FromWorker | null;
    if (o && o.type === 'done') host.post({ type: 'result', jobId, summary: summarise(index, o.run) });
    else host.post({ type: 'bout-error', jobId, index, message: o && o.type === 'error' ? o.message : 'The bout produced no result.' });
  }

  return {
    async handle(message: ToBatchWorker): Promise<void> {
      if (message.type === 'cancel') {
        cancelled.add(message.jobId);
        return;
      }
      for (const index of message.indices) {
        if (cancelled.has(message.jobId)) return;
        try {
          await runOne(message.jobId, message.template, message.master, index);
        } catch (err) {
          host.post({ type: 'bout-error', jobId: message.jobId, index, message: err instanceof Error ? err.message : String(err) });
        }
        await yieldControl();
      }
      if (!cancelled.has(message.jobId)) host.post({ type: 'chunk-done', jobId: message.jobId });
    },
  };
}
