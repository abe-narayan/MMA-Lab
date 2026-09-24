/**
 * THE BOUT WORKER (docs/design/09 §1.3.4).
 *
 * Deliberately six lines of logic: everything interesting is in
 * `simProtocol.ts`, which is importable from a test and from the main thread.
 * A five-round 1v5 is tens of thousands of ticks and would lock the page for
 * seconds if it ran on the UI thread — that, and nothing else, is why this
 * file exists.
 *
 * `self` is typed by hand because the project's `lib` is DOM, not WebWorker,
 * and adding the WebWorker lib to a shared tsconfig would let `self.postMessage`
 * typecheck inside the app as well.
 */

import {
  createRunner, runWatchJob, toWire, type FromWorkerWire, type ToWorker, type WatchMessage, type WatchWire,
} from './simProtocol';

interface WorkerScope {
  postMessage(message: FromWorkerWire | WatchWire, transfer?: Transferable[]): void;
  onmessage: ((event: { data: ToWorker | WatchMessage }) => void) | null;
}

const scope = self as unknown as WorkerScope;
// Recorded frames travel as typed-array columns, transferred (toWire).
const runner = createRunner({
  post: (message) => {
    const wire = toWire(message);
    scope.postMessage(wire.message, wire.transfer);
  },
});

scope.onmessage = (event): void => {
  const data = event.data;
  // The Watch screen's bouts (frames + game plan + commentary), built here.
  if (data.type === 'watch') {
    runWatchJob(data, (m, transfer) => scope.postMessage(m, transfer));
    return;
  }
  void runner.handle(data);
};
