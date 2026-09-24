/**
 * THE BATCH WORKER — a shim over `batchProtocol.ts` (see there).
 *
 * `self` is typed by hand for the same reason as `simWorker.ts`: the
 * project's lib is DOM, not WebWorker.
 */

import { createBatchRunner, type FromBatchWorker, type ToBatchWorker } from './batchProtocol';

interface WorkerScope {
  postMessage(message: FromBatchWorker): void;
  onmessage: ((event: { data: ToBatchWorker }) => void) | null;
}

const scope = self as unknown as WorkerScope;
const runner = createBatchRunner({
  post: (message) => scope.postMessage(message),
  // A macrotask between bouts, so a `cancel` sitting in the queue is read.
  yieldControl: () => new Promise((done) => setTimeout(done, 0)),
});

scope.onmessage = (event): void => {
  void runner.handle(event.data);
};
