/**
 * RUNNING A BOUT FROM THE APP (docs/design/09 §1.3.3).
 *
 * The rule the chapter sets is short: *the app never calls `createSim` on the
 * main thread for live bouts*. It posts a `SimConfig` to `simWorker.ts`, which
 * streams progress and hands back a `BoutRun`. The app then treats that run
 * exactly like a loaded replay, which is what makes "watch a fight I just ran"
 * and "watch a fight from a file" the same code path.
 *
 * Two things this module adds on top of the protocol:
 *
 *   1. **A fallback.** Workers are absent under Node, blocked by some
 *      sandboxes, and occasionally fail to construct. The fallback runs the
 *      *same* `createRunner` on the main thread, sliced and yielding between
 *      slices, so the page stays responsive rather than freezing outright. It
 *      is slower and jankier, and `BoutRunOutcome.ranOn` says which path was
 *      used so the UI can tell the truth about it.
 *   2. **History.** A finished run is written through the store as a
 *      `HistoryEntry` with a full replay file attached. The store's quota
 *      policy (09 §3.6) decides how long that replay body survives.
 *
 * A bout is a pure function of its seed, so the two paths must produce
 * byte-identical runs. `tests/match.setup.test.ts` asserts exactly that, by
 * driving the worker's own runner across a serialisation boundary and
 * comparing the digest with a main-thread `simulate()`.
 */

import {
  SIM_ENGINE_VERSION, toReplayFile,
  type BoutRun, type SimConfig,
} from '../../sim';
import {
  createRunner, DEFAULT_PROGRESS_TICKS, fromWire,
  type FromWorker, type FromWorkerWire, type ToWorker,
} from '../workers/simProtocol';
import type { HistoryEntry } from '../store/types';

export interface BoutProgress {
  tick: number;
  round: number;
}

export interface RunBoutOptions {
  /** Keep every frame, for the replay view. On for anything the user watches. */
  record?: boolean;
  progressEveryTicks?: number;
  onProgress?: (p: BoutProgress) => void;
  /** Force the main-thread path. Tests and the "worker failed" retry use it. */
  forceMainThread?: boolean;
}

export type RunPath = 'worker' | 'main';

export interface BoutRunOutcome {
  run: BoutRun;
  ranOn: RunPath;
  /** Set when the worker could not be used and the main thread took over. */
  fallbackReason?: string;
}

export interface BoutRunHandle {
  readonly id: string;
  readonly promise: Promise<BoutRunOutcome>;
  cancel(): void;
}

/** Thrown when a run is cancelled. Distinguishable from a real failure. */
export class BoutCancelled extends Error {
  constructor() {
    super('The bout was cancelled.');
    this.name = 'BoutCancelled';
  }
}

let counter = 0;
function nextRunId(): string {
  counter += 1;
  return `run-${counter}`;
}

function workersAvailable(): boolean {
  return typeof Worker !== 'undefined' && typeof URL !== 'undefined';
}

/**
 * Start a bout. Returns immediately with a handle; the promise settles when
 * the bout ends, fails, or is cancelled (`BoutCancelled`).
 */
export function runBout(config: SimConfig, opts: RunBoutOptions = {}): BoutRunHandle {
  const id = nextRunId();
  const record = opts.record ?? true;
  const progressEveryTicks = opts.progressEveryTicks ?? DEFAULT_PROGRESS_TICKS;

  let cancel = (): void => {
    /* replaced below once a path is chosen */
  };

  const promise = new Promise<BoutRunOutcome>((resolve, reject) => {
    const message: ToWorker = { type: 'run', id, config, record, progressEveryTicks };

    const onMain = (reason?: string): void => {
      const handle = runOnMainThread(message, opts.onProgress);
      cancel = handle.cancel;
      handle.promise.then(
        (run) => resolve({ run, ranOn: 'main', ...(reason ? { fallbackReason: reason } : {}) }),
        reject,
      );
    };

    if (opts.forceMainThread || !workersAvailable()) {
      onMain(opts.forceMainThread ? undefined : 'This browser has no Worker support.');
      return;
    }

    let worker: Worker;
    try {
      worker = new Worker(new URL('../workers/simWorker.ts', import.meta.url), { type: 'module' });
    } catch (err) {
      onMain(`The bout worker could not start (${err instanceof Error ? err.message : String(err)}).`);
      return;
    }

    let settled = false;
    const finish = (): void => {
      settled = true;
      worker.terminate();
    };

    cancel = (): void => {
      if (settled) return;
      worker.postMessage({ type: 'cancel', id } satisfies ToWorker);
      finish();
      reject(new BoutCancelled());
    };

    worker.onmessage = (event: MessageEvent<FromWorkerWire>): void => {
      // Recorded frames arrive as packed columns; rebuild the view.
      const msg = fromWire(event.data);
      if (msg.id !== id || settled) return;
      if (msg.type === 'progress') {
        opts.onProgress?.({ tick: msg.tick, round: msg.round });
      } else if (msg.type === 'done') {
        finish();
        resolve({ run: msg.run, ranOn: 'worker' });
      } else {
        finish();
        reject(new Error(msg.message));
      }
    };

    // A worker that fails to load at all (a bad MIME type behind a proxy, a
    // CSP that blocks blob workers) reports `error` and never `message`. The
    // bout still has to happen, so fall back rather than surface a dead end.
    worker.onerror = (): void => {
      if (settled) return;
      finish();
      onMain('The bout worker failed to load; this bout ran on the main thread.');
    };

    worker.postMessage(message);
  });

  return { id, promise, cancel: () => cancel() };
}

/**
 * The fallback. Same runner, same slicing, on the UI thread — the yield
 * between slices is a real macrotask so the browser can paint, which keeps a
 * long bout from looking like a hang even without a worker.
 */
function runOnMainThread(
  message: ToWorker & { type: 'run' },
  onProgress?: (p: BoutProgress) => void,
): { promise: Promise<BoutRun>; cancel: () => void } {
  // Definite assignment: the Promise executor runs synchronously, so `settle`
  // is populated before anything can read it.
  let settle!: { resolve: (r: BoutRun) => void; reject: (e: unknown) => void };
  const promise = new Promise<BoutRun>((resolve, reject) => {
    settle = { resolve, reject };
  });

  const runner = createRunner({
    post: (msg: FromWorker) => {
      if (msg.type === 'progress') onProgress?.({ tick: msg.tick, round: msg.round });
      else if (msg.type === 'done') settle.resolve(msg.run);
      else settle.reject(new Error(msg.message));
    },
    yieldControl: () => new Promise<void>((done) => {
      if (typeof setTimeout === 'function') setTimeout(done, 0);
      else void Promise.resolve().then(done);
    }),
  });

  // A cancelled run posts nothing, so the rejection is raised here rather
  // than waiting for a `done` that will never come.
  void runner.handle(message);

  return {
    promise,
    cancel: () => {
      void runner.handle({ type: 'cancel', id: message.id });
      settle.reject(new BoutCancelled());
    },
  };
}

// --------------------------------------------------------------------------
// History
// --------------------------------------------------------------------------

/**
 * The `HistoryEntry` a finished run becomes. `playedAt` is a wall clock, which
 * 09 §3.6 allows in saved data and nowhere else; `id` is derived from the
 * digest so replaying the same seed twice does not create two indistinguishable
 * rows.
 */
export function historyEntryFor(
  run: BoutRun,
  opts: {
    playedAt?: string;
    label?: string;
    tournamentId?: string;
    tournamentSlot?: { roundIndex: number; matchIndex: number };
  } = {},
): HistoryEntry {
  const file = toReplayFile(run);
  file.meta = {
    ...(file.meta ?? {}),
    ...(opts.label ? { label: opts.label } : {}),
    ...(opts.tournamentId && opts.tournamentSlot
      ? { tournament: { id: opts.tournamentId, ...opts.tournamentSlot } }
      : {}),
  };
  return {
    id: `bout.${run.digest.slice(0, 12)}.${run.config.seed.length.toString(36)}`,
    replay: file,
    result: run.result,
    fighterNames: run.config.fighters.map((f) => f.name),
    ...(opts.tournamentId ? { tournamentId: opts.tournamentId } : {}),
    playedAt: opts.playedAt ?? new Date().toISOString(),
  };
}

/** The engine this build records with; the History screen shows it beside a mismatch. */
export const ENGINE_VERSION = SIM_ENGINE_VERSION;
