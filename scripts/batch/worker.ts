/**
 * worker_threads entry for the batch pool. Receives `JobMessage`s, replies with
 * one `ResultRow` each. It holds no state between bouts.
 */
import { parentPort } from 'node:worker_threads';
import { executeJob } from './execute';
import type { JobMessage, WorkerReply } from './types';

const port = parentPort;
if (!port) throw new Error('scripts/batch/worker.ts must run as a worker thread');

const reply = (m: WorkerReply): void => port.postMessage(m);

port.on('message', (job: JobMessage) => {
  executeJob(job).then(
    (row) => reply({ type: 'row', key: job.key, row }),
    (err: unknown) => reply({ type: 'error', key: job.key, message: err instanceof Error ? (err.stack ?? err.message) : String(err) }),
  );
});
reply({ type: 'ready' });
