/**
 * WORKER PROTOCOL — docs/design/09 §1.3.4, and the runner that implements it.
 *
 * The message types are the chapter's, unchanged:
 *
 *   ToWorker    { type: 'run', id, config, record, progressEveryTicks }
 *               | { type: 'cancel', id }
 *   FromWorker  { type: 'progress', id, tick, round }
 *               | { type: 'done', id, run }
 *               | { type: 'error', id, message }
 *
 * The *logic* lives here rather than in `simWorker.ts` for a reason that is
 * really a test requirement: a Worker must not change a bout, and the only
 * honest way to check that is to drive the same code the Worker runs from a
 * test, across the same serialisation boundary, and compare digests. A file
 * that reaches for `self` cannot be imported by a test at all. So `simWorker`
 * is a six-line shim and everything below is environment-free.
 *
 * Two details matter for determinism:
 *
 *   1. The run is sliced and yields to the event loop between slices. That is
 *      what makes `cancel` deliverable — a synchronous `runToEnd` would leave
 *      the message sitting in the queue until the bout was already over. It
 *      cannot change the bout: slicing only decides *when* `step()` is called,
 *      never what it computes.
 *   2. Frames are collected exactly as `simulate()` collects them — one before
 *      the first step, one after every step, one after the last — so a run
 *      produced here is indistinguishable from a main-thread `simulate()`.
 */

import {
  computeStats, createSim,
  type BoutRun, type SimConfig,
} from '../../sim';
import { FrameStore, isPackedFrames, packFrames, unpackFrames, type PackedFrames } from '../../sim/record/frames';

export interface RunMessage {
  type: 'run';
  id: string;
  config: SimConfig;
  record: boolean;
  progressEveryTicks: number;
}

export interface CancelMessage {
  type: 'cancel';
  id: string;
}

export type ToWorker = RunMessage | CancelMessage;

export type FromWorker =
  | { type: 'progress'; id: string; tick: number; round: number }
  | { type: 'done'; id: string; run: BoutRun }
  | { type: 'error'; id: string; message: string };

/**
 * The `done` message as it crosses a real thread boundary. A recorded run's
 * `frames` is a Proxy view over typed-array columns, which `postMessage`
 * cannot clone, so the worker shim sends the columns themselves
 * (`packedFrames`, with their buffers transferred rather than copied) and
 * `runBout` rebuilds the view on arrival. In-process hosts never see this.
 */
export type WireDone = { type: 'done'; id: string; run: Omit<BoutRun, 'frames'>; packedFrames?: PackedFrames };
export type FromWorkerWire = Exclude<FromWorker, { type: 'done' }> | WireDone;

/** Worker side: a message ready for `postMessage`, and what to transfer. */
export function toWire(message: FromWorker): { message: FromWorkerWire; transfer: ArrayBuffer[] } {
  if (message.type !== 'done' || !message.run.frames) return { message, transfer: [] };
  const { frames, ...run } = message.run;
  const { packed, transfer } = packFrames(frames);
  return { message: { type: 'done', id: message.id, run, packedFrames: packed }, transfer };
}

/** Main-thread side: the inverse of `toWire`. */
export function fromWire(message: FromWorkerWire): FromWorker {
  if (message.type !== 'done') return message;
  const { packedFrames, ...rest } = message as WireDone;
  if (!isPackedFrames(packedFrames)) return { type: 'done', id: rest.id, run: rest.run as BoutRun };
  return { type: 'done', id: rest.id, run: { ...rest.run, frames: unpackFrames(packedFrames) } };
}

/** Ticks between progress messages. 200 ticks is 2 s of fight at the default dt. */
export const DEFAULT_PROGRESS_TICKS = 200;

export interface RunnerHost {
  post(message: FromWorker): void;
  /** Overridable so a test can run the slices without a real event loop. */
  yieldControl?: () => Promise<void>;
}

const microtask = (): Promise<void> => Promise.resolve();

export interface Runner {
  handle(message: ToWorker): Promise<void>;
  /** Ids currently running. Exposed for the shim's shutdown path. */
  readonly running: ReadonlySet<string>;
}

/**
 * Run one bout in slices, reporting progress. Shared by the browser Worker,
 * the main-thread fallback in `run/runBout.ts` and the tests.
 */
export function createRunner(host: RunnerHost): Runner {
  const cancelled = new Set<string>();
  const running = new Set<string>();
  const yieldControl = host.yieldControl ?? microtask;

  async function run(msg: RunMessage): Promise<void> {
    const { id } = msg;
    running.add(id);
    try {
      const slice = Math.max(1, Math.round(msg.progressEveryTicks || DEFAULT_PROGRESS_TICKS));
      const sim = createSim(msg.config);
      // Compact columnar frames (09 §4.5; sim/record/frames.ts), exactly as
      // `simulate()` keeps them.
      const store = msg.record ? new FrameStore() : undefined;
      if (store) store.push(sim.snapshot());

      let sinceYield = 0;
      let more = true;
      while (more) {
        more = sim.step();
        if (store && more) store.push(sim.snapshot());
        if (++sinceYield < slice) continue;
        sinceYield = 0;
        host.post({ type: 'progress', id, tick: sim.tick, round: sim.round });
        await yieldControl();
        if (cancelled.has(id)) {
          cancelled.delete(id);
          return;
        }
      }
      if (store) store.push(sim.snapshot());
      const frames = store?.view();

      const result = sim.result;
      if (!result) throw new Error('A bout must always end with a BoutResult');
      const events = [...sim.events];
      const run_: BoutRun = {
        config: msg.config,
        result,
        events,
        stats: computeStats(events, msg.config, sim.tick),
        digest: sim.digest,
        ticks: sim.tick,
        rngDraws: sim.rngDraws,
        ...(frames ? { frames } : {}),
      };
      host.post({ type: 'done', id, run: run_ });
    } catch (err) {
      host.post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
    } finally {
      running.delete(id);
      cancelled.delete(id);
    }
  }

  return {
    running,
    async handle(message: ToWorker): Promise<void> {
      if (message.type === 'cancel') {
        cancelled.add(message.id);
        return;
      }
      await run(message);
    },
  };
}
