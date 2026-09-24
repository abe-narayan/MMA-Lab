/**
 * One job -> one row. Shared by the worker thread and the in-process path, so
 * a row cannot depend on where it was computed.
 *
 * Ordinary bouts go through the app's worker protocol (`createRunner`,
 * docs/design/09 §1.3.4) exactly as the browser Worker runs them; §7.4 QA
 * bouts are stepped by hand so the invariant sweep can read the world. Both
 * produce the same digest for the same config (the sweep is read-only).
 */
import { createRunner, type FromWorker } from '../../src/app/workers/simProtocol';
import type { BoutRun } from '../../src/sim';
import { runQaBout, summarizeRun } from './summarize';
import type { JobMessage, ResultRow } from './types';

export async function executeJob(job: JobMessage): Promise<ResultRow> {
  if (job.qa) {
    const { run, qa } = runQaBout(job.config, job.valid);
    return summarizeRun(run, job.cell, job.i, job.tags, job.bt, qa);
  }
  let done: BoutRun | null = null;
  let failure: string | null = null;
  const runner = createRunner({
    post: (m: FromWorker) => {
      if (m.type === 'done') done = m.run;
      else if (m.type === 'error') failure = m.message;
    },
    // No progress traffic in a batch: one slice per bout.
    yieldControl: () => Promise.resolve(),
  });
  await runner.handle({ type: 'run', id: job.key, config: job.config, record: false, progressEveryTicks: 1e9 });
  if (failure !== null) throw new Error(failure);
  if (done === null) throw new Error(`bout ${job.key} produced no result`);
  return summarizeRun(done, job.cell, job.i, job.tags, job.bt);
}
