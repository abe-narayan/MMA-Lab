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

import { createRunner, type FromWorker, type ToWorker } from './simProtocol';

interface WorkerScope {
  postMessage(message: FromWorker): void;
  onmessage: ((event: { data: ToWorker }) => void) | null;
}

const scope = self as unknown as WorkerScope;
const runner = createRunner({ post: (message) => scope.postMessage(message) });

scope.onmessage = (event): void => {
  void runner.handle(event.data);
};
