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
  type BoutRun, type CommentaryLine, type IntentSample, type SimConfig,
} from '../../sim';
import { assembleWatchBout, loadWatchBout, type WatchBout } from '../replay/bout';
import { FrameStore, packFrames, unpackFrames, type PackedFrames } from '../../sim/record/frames';

// The message types and the wire encoding live in ./simWire (engine-free, so
// the app shell can import them without pulling the simulation engine into
// the first-load bundle); re-exported here for existing importers.
export * from './simWire';
import { DEFAULT_PROGRESS_TICKS, type FromWorker, type RunMessage, type ToWorker } from './simWire';

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

// ---------------------------------------------------------------------------
// Watch bouts (Watch/replay pass)
// ---------------------------------------------------------------------------

/**
 * `{ type: 'watch' }` builds everything the Watch screen needs — the run with
 * every frame, the game-plan samples and the commentary — off the main thread
 * (`loadWatchBout`, the very function the main thread would run), and sends
 * the frames as transferred typed-array columns. The page stays responsive
 * and shows progress instead of freezing for the seconds a long bout takes.
 */
export interface WatchMessage {
  type: 'watch';
  id: string;
  config: SimConfig;
  progressEveryTicks: number;
}

export type WatchWire =
  | { type: 'progress'; id: string; tick: number; round: number }
  | {
    type: 'watchDone'; id: string; run: Omit<BoutRun, 'frames'>; packedFrames: PackedFrames;
    intents: IntentSample[]; commentary: CommentaryLine[];
  }
  | { type: 'error'; id: string; message: string };

/** Worker side: run a watch job, posting progress and the result (with its transfer list). */
export function runWatchJob(msg: WatchMessage, post: (m: WatchWire, transfer?: ArrayBuffer[]) => void): void {
  try {
    const bout = loadWatchBout(msg.config, {
      progressEveryTicks: msg.progressEveryTicks,
      onProgress: (tick, round) => post({ type: 'progress', id: msg.id, tick, round }),
    });
    const { frames, ...run } = bout.run;
    const { packed, transfer } = packFrames(frames);
    post({ type: 'watchDone', id: msg.id, run, packedFrames: packed, intents: bout.intents, commentary: bout.commentary }, transfer);
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
}

/** Main-thread side: the Watch bout from a `watchDone` message. */
export function watchBoutFromWire(msg: Extract<WatchWire, { type: 'watchDone' }>, config: SimConfig): WatchBout {
  const frames = unpackFrames(msg.packedFrames);
  return assembleWatchBout(config, { ...msg.run, config, frames }, msg.intents, msg.commentary);
}
