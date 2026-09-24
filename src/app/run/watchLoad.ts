/**
 * LOADING A WATCH BOUT OFF THE MAIN THREAD (Watch/replay pass).
 *
 * `loadWatchBout` steps the whole simulation keeping every frame, samples the
 * game plan and writes the commentary: seconds of synchronous work for a
 * five-round bout, during which the page used to freeze on "Rebuilding the
 * bout from its seed…". This runs the same function in the bout worker
 * (`simProtocol.runWatchJob`), streams progress, and rebuilds the frame view
 * from the transferred columns. Without a usable worker it falls back to the
 * main thread after letting the loading state paint.
 *
 * The worker runs the very same code on the same config, so the bout is
 * identical either way (tests/replay.polish.test.ts drives `runWatchJob`
 * across a structured clone and compares digest and frames).
 */
import type { SimConfig } from '../../sim';
import { loadWatchBout, type WatchBout } from '../replay/bout';
import { watchBoutFromWire, type WatchMessage, type WatchWire } from '../workers/simProtocol';

export interface WatchLoadProgress {
  tick: number;
  round: number;
}

export interface WatchLoadHandle {
  promise: Promise<WatchBout>;
  cancel(): void;
}

let counter = 0;

function mainThread(config: SimConfig, cancelled: () => boolean): Promise<WatchBout> {
  return new Promise((resolve, reject) => {
    // A frame for the loading state to paint before the synchronous run.
    setTimeout(() => {
      if (cancelled()) return;
      try {
        resolve(loadWatchBout(config));
      } catch (err) {
        reject(err);
      }
    }, 30);
  });
}

/** Build a Watch bout, in the worker when possible. */
export function loadWatchBoutAsync(
  config: SimConfig, onProgress?: (p: WatchLoadProgress) => void,
): WatchLoadHandle {
  let cancelled = false;
  let worker: Worker | null = null;
  const id = `watch-${++counter}`;
  const promise = new Promise<WatchBout>((resolve, reject) => {
    const fallback = (): void => {
      worker?.terminate();
      worker = null;
      mainThread(config, () => cancelled).then(resolve, reject);
    };
    if (typeof Worker === 'undefined') {
      fallback();
      return;
    }
    try {
      worker = new Worker(new URL('../workers/simWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      fallback();
      return;
    }
    worker.onmessage = (event: MessageEvent<WatchWire>): void => {
      const m = event.data;
      if (cancelled || m.id !== id) return;
      if (m.type === 'progress') {
        onProgress?.({ tick: m.tick, round: m.round });
      } else if (m.type === 'watchDone') {
        worker?.terminate();
        worker = null;
        try {
          resolve(watchBoutFromWire(m, config));
        } catch (err) {
          reject(err);
        }
      } else {
        worker?.terminate();
        worker = null;
        reject(new Error(m.message));
      }
    };
    // A worker that cannot load (CSP, bad MIME type) never answers: fall back.
    worker.onerror = (): void => {
      if (!cancelled) fallback();
    };
    worker.postMessage({ type: 'watch', id, config, progressEveryTicks: 300 } satisfies WatchMessage);
  });
  return {
    promise,
    cancel: () => {
      cancelled = true;
      worker?.terminate();
      worker = null;
    },
  };
}
