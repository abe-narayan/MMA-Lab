/**
 * BATCH SIMULATION — the orchestration behind the Batch screen.
 *
 * Driven through fake Workers that run the real `batchProtocol` runner on a
 * macrotask, so the tests cross the same message boundary a browser does
 * (a message that is built but never posted fails here, not in the field).
 *
 *  - per-bout seeds are deterministic and independent of scheduling;
 *  - 1, 2 and 4 workers give identical summaries, aggregate and fingerprint;
 *  - a batch bout equals a plain `simulate()` of the same seed;
 *  - cancel stops early and reports it; a dying worker's chunk is re-run;
 *    with no worker at all the batch completes on the main thread;
 *  - the statistics helpers (Wilson, mean CI, ETA) behave.
 */
import { describe, expect, it } from 'vitest';
import { ARCHETYPES, DEFAULT_SETTINGS, simulate, type SimConfig } from '../src/sim';
import {
  aggregate, batchBoutSeed, batchConfig, EtaEstimator, meanCi, summarise, wilson, workerCountFor,
} from '../src/app/model/batchModel';
import { createBatchRunner, type FromBatchWorker, type ToBatchWorker } from '../src/app/workers/batchProtocol';
import { runBatch, type WorkerLike } from '../src/app/run/batchRun';

const a = ARCHETYPES['arch.regional_pro_allrounder'];
const b = { ...ARCHETYPES['arch.thai_striker'] };

// Short bouts keep the suite fast; the orchestration does not care.
const template: Omit<SimConfig, 'seed'> = {
  mode: '1v1',
  fighters: [a, b],
  teams: { teamOf: [0, 1] },
  ruleset: 'mma.unified.3r',
  arena: 'octagon_30',
  settings: { ...DEFAULT_SETTINGS, rounds: 1, roundSeconds: 25 },
};

class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: FromBatchWorker }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  posted: ToBatchWorker[] = [];
  terminated = false;
  private runner = createBatchRunner({
    post: (m) => { if (!this.terminated) setTimeout(() => this.onmessage?.({ data: m }), 0); },
    yieldControl: () => new Promise((r) => setTimeout(r, 0)),
  });
  constructor(private readonly failAfter = Infinity) {}
  postMessage(m: ToBatchWorker): void {
    this.posted.push(m);
    if (this.posted.filter((x) => x.type === 'chunk').length > this.failAfter) {
      setTimeout(() => this.onerror?.(new Error('boom')), 0);
      return;
    }
    setTimeout(() => { void this.runner.handle(m); }, 0);
  }
  terminate(): void { this.terminated = true; }
}

describe('batch seeds and summaries', () => {
  it('derives a stable seed per bout index', () => {
    expect(batchBoutSeed('m', 3)).toBe(batchBoutSeed('m', 3));
    expect(batchBoutSeed('m', 3)).not.toBe(batchBoutSeed('m', 4));
    expect(batchConfig(template, 'm', 3).seed).toBe(batchBoutSeed('m', 3));
  });

  it('a batch bout is the same bout as a plain simulate() of its seed', async () => {
    const out = await runBatch({ template, master: 'eq', bouts: 3 }, { workers: 1, workerFactory: () => new FakeWorker() }).promise;
    for (const s of out.summaries) {
      const direct = simulate(batchConfig(template, 'eq', s.index));
      expect(s.digest).toBe(direct.digest);
      expect(s).toEqual(summarise(s.index, direct));
    }
  });

  it('sizes the pool from hardwareConcurrency minus two, capped at four', () => {
    expect(workerCountFor(16)).toBe(4);
    expect(workerCountFor(6)).toBe(4);
    expect(workerCountFor(5)).toBe(3);
    expect(workerCountFor(3)).toBe(1);
    expect(workerCountFor(1)).toBe(1);
    expect(workerCountFor(undefined)).toBe(2);
  });
});

describe('worker count cannot change the answer', () => {
  it('1, 2 and 4 workers give identical results', async () => {
    const runs = [];
    for (const workers of [1, 2, 4]) {
      const fakes: FakeWorker[] = [];
      const out = await runBatch(
        { template, master: 'det', bouts: 10 },
        { workers, chunkSize: 2, workerFactory: () => { const f = new FakeWorker(); fakes.push(f); return f; } },
      ).promise;
      expect(out.ranOn).toBe('workers');
      expect(out.workers).toBe(workers);
      expect(out.summaries.map((s) => s.index)).toEqual([...Array(10).keys()]);
      // Every worker actually received work through postMessage.
      for (const f of fakes) expect(f.posted.some((m) => m.type === 'chunk')).toBe(true);
      runs.push(out);
    }
    const aggs = runs.map((r) => aggregate(r.summaries));
    expect(aggs[1]).toEqual(aggs[0]);
    expect(aggs[2]).toEqual(aggs[0]);
    expect(runs[1].summaries).toEqual(runs[0].summaries);
    expect(aggs[0].fingerprint).toMatch(/^[0-9a-f]{8}$/);
  }, 120_000);

  it('aggregate ignores arrival order', () => {
    const summaries = [0, 1, 2, 3].map((i) => summarise(i, simulate(batchConfig(template, 'ord', i))));
    expect(aggregate([...summaries].reverse())).toEqual(aggregate(summaries));
  }, 60_000);
});

describe('cancel, failure and fallback', () => {
  it('cancel resolves early and says so', async () => {
    const h = runBatch({ template, master: 'c', bouts: 40 }, { workers: 2, chunkSize: 1, workerFactory: () => new FakeWorker() });
    setTimeout(() => h.cancel(), 30);
    const out = await h.promise;
    expect(out.cancelled).toBe(true);
    expect(out.summaries.length).toBeLessThan(40);
  }, 60_000);

  it('re-runs a dead worker’s chunk on the survivors', async () => {
    let n = 0;
    const out = await runBatch(
      { template, master: 'd', bouts: 6 },
      { workers: 2, chunkSize: 1, workerFactory: () => (n++ === 0 ? new FakeWorker(0) : new FakeWorker()) },
    ).promise;
    expect(out.summaries.map((s) => s.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(out.errors).toEqual([]);
  }, 60_000);

  it('runs on the main thread when no worker can start', async () => {
    const out = await runBatch({ template, master: 'm', bouts: 3 }, { workerFactory: () => { throw new Error('blocked'); } }).promise;
    expect(out.ranOn).toBe('main');
    expect(out.fallbackReason).toMatch(/main thread/);
    expect(out.summaries).toHaveLength(3);
  }, 60_000);

  it('reports progress up to the total', async () => {
    const seen: number[] = [];
    await runBatch({ template, master: 'p', bouts: 4 }, { workers: 2, workerFactory: () => new FakeWorker(), onProgress: (p) => seen.push(p.done) }).promise;
    expect(seen[seen.length - 1]).toBe(4);
  }, 60_000);
});

describe('statistics', () => {
  it('Wilson interval brackets the proportion and stays in [0, 1]', () => {
    const w = wilson(30, 100);
    expect(w.value).toBeCloseTo(0.3);
    expect(w.lo).toBeLessThan(0.3);
    expect(w.hi).toBeGreaterThan(0.3);
    expect(wilson(0, 10).lo).toBe(0);
    expect(wilson(10, 10).hi).toBeLessThanOrEqual(1);
    expect(wilson(0, 0)).toEqual({ value: 0, lo: 0, hi: 0 });
  });

  it('mean CI narrows with n', () => {
    const small = meanCi([1, 2, 3, 4]);
    const big = meanCi(Array.from({ length: 400 }, (_, i) => (i % 4) + 1));
    expect(small.value).toBeCloseTo(2.5);
    expect(big.hi - big.lo).toBeLessThan(small.hi - small.lo);
  });

  it('ETA waits for signal, then converges on a steady rate', () => {
    const eta = new EtaEstimator();
    expect(eta.update(0, 0, 100)).toBeNull();
    expect(eta.update(1000, 2, 100)).toBeNull();
    let last: number | null = null;
    for (let t = 2; t <= 20; t++) last = eta.update(t * 1000, t * 2, 100);
    // 2 bouts/s, 60 left -> ~30 s.
    expect(last).not.toBeNull();
    expect(Math.abs((last as number) - 30)).toBeLessThan(3);
  });
});
