/**
 * BATCH ORCHESTRATION — plans -> jobs -> pool -> checkpointed JSONL
 * (docs/design/09 §6.3–6.4). `run.ts` is the CLI around `runBatch`; the tests
 * call `runBatch` directly.
 *
 * Output directory:
 *   manifest.json   plan ids, bouts per cell, seed, engine version, params hash
 *                   and overrides, machine, pool sizing, and one entry per
 *                   session (wall time, peak CPU/RAM seen by the monitor)
 *   results.jsonl   one `ResultRow` per bout, appended as each bout finishes
 *   errors.jsonl    bouts that threw (re-tried on the next --resume)
 *   monitor.jsonl   every 2 s monitor sample
 *
 * `--resume` reads results.jsonl, discards a partial last line (a crash
 * mid-write), and skips every `(cell, i)` already present. Because a row is a
 * pure function of its job, the resumed file sorts to exactly the file an
 * uninterrupted run would have written.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, truncateSync, writeFileSync } from 'node:fs';
import { cpus, freemem, platform, totalmem } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PARAMS_HASH, SIM_ENGINE_VERSION, hashParams, type ParamOverrides } from '../../src/sim';
import { buildJob, planCells, PLANS, type Cell, type Plan } from './plans';
import { Pool, type JobSource } from './pool';
import { DEFAULT_THROTTLE, ResourceMonitor, confineSelf, poolBudget, popcount, type ThrottleOptions } from './monitor';
import type { JobMessage, ResultRow } from './types';
import { rowKey } from './types';

export interface BatchOptions {
  plans: string[];
  /** Bouts per cell: one number for every plan, or per plan id. */
  n?: number | Record<string, number>;
  seed: string;
  out: string;
  maxWorkers: number;
  resume?: boolean;
  overrides?: ParamOverrides;
  /** Keep only cells whose id matches. */
  filter?: RegExp;
  throttle?: Partial<ThrottleOptions>;
  sampleMs?: number;
  perWorkerMB?: number;
  /** Hex affinity mask; confinement only happens when `confine` is true. */
  affinity?: string;
  confine?: boolean;
  /** Stop dispatching after this many new rows (tests: simulated interruption). */
  stopAfter?: number;
  /** Spawn this many workers at once rather than ramping up from one (tests). */
  startWorkers?: number;
  quiet?: boolean;
  log?: (line: string) => void;
}

export interface BatchSummary {
  out: string;
  cells: number;
  total: number;
  skipped: number;
  done: number;
  errors: number;
  wallS: number;
  peakWorkers: number;
  monitor: ReturnType<ResourceMonitor['summary']>;
}

export function boutsPerCell(plan: Plan, n: BatchOptions['n']): number {
  if (typeof n === 'number') return n;
  if (n && n[plan.id] !== undefined) return n[plan.id];
  return plan.defaultN;
}

/** Read a results file, truncating a partial last line in place. */
export function readResults(file: string, repair = false): ResultRow[] {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  const end = text.lastIndexOf('\n');
  if (repair && end + 1 < text.length) truncateSync(file, Buffer.byteLength(text.slice(0, end + 1)));
  const body = end >= 0 ? text.slice(0, end) : '';
  // One row per (cell, i): a `--resume` over a directory without a manifest
  // re-runs bouts and appends them again. The last copy wins; rows are pure
  // functions of their job, so the copies are identical anyway (Phase 9).
  const byKey = new Map<string, ResultRow>();
  for (const line of body.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const row = JSON.parse(line) as ResultRow;
      byKey.set(`${row.cell}#${row.i}`, row);
    } catch { /* a corrupt interior line is skipped and will be re-run */ }
  }
  return [...byKey.values()];
}

function machine(): Record<string, unknown> {
  const c = cpus();
  return {
    platform: platform(),
    node: process.version,
    cpuModel: c[0]?.model ?? 'unknown',
    cores: c.length,
    totalGB: +(totalmem() / 2 ** 30).toFixed(1),
    freeGBAtStart: +(freemem() / 2 ** 30).toFixed(2),
  };
}

export async function runBatch(o: BatchOptions): Promise<BatchSummary> {
  const log = o.log ?? ((l: string) => { if (!o.quiet) console.log(l); });
  const t0 = Date.now();
  mkdirSync(o.out, { recursive: true });
  const resultsFile = join(o.out, 'results.jsonl');
  const errorsFile = join(o.out, 'errors.jsonl');
  const manifestFile = join(o.out, 'manifest.json');
  const paramsHash = hashParams(o.overrides);

  let cells: Cell[] = planCells(o.plans, (p) => boutsPerCell(p, o.n));
  if (o.filter) cells = cells.filter((c) => o.filter!.test(c.id));
  const total = cells.reduce((s, c) => s + c.n, 0);

  // ---- resume / fresh --------------------------------------------------------
  const done = new Set<string>();
  let manifest: Record<string, unknown> & { sessions: unknown[] };
  if (existsSync(resultsFile) && readFileSync(resultsFile, 'utf8').length > 0 && !o.resume) {
    throw new Error(`${resultsFile} already has results; pass --resume or choose a new --out`);
  }
  if (o.resume && existsSync(manifestFile)) {
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as typeof manifest;
    if (manifest.seed !== o.seed || manifest.paramsHash !== paramsHash || manifest.engineVersion !== SIM_ENGINE_VERSION) {
      throw new Error(`--resume: ${o.out} was run with seed ${String(manifest.seed)}, params ${String(manifest.paramsHash)}, engine ${String(manifest.engineVersion)}; this run has ${o.seed}, ${paramsHash}, ${SIM_ENGINE_VERSION}`);
    }
    for (const r of readResults(resultsFile, true)) done.add(rowKey(r.cell, r.i));
    manifest.plans = [...new Set([...(manifest.plans as string[]), ...o.plans])];
  } else {
    manifest = {
      plans: o.plans,
      seed: o.seed,
      engineVersion: SIM_ENGINE_VERSION,
      paramsHash,
      defaultParamsHash: DEFAULT_PARAMS_HASH,
      paramOverrides: o.overrides ?? {},
      sessions: [],
    };
  }
  const nPerPlan: Record<string, number> = { ...((manifest.n as Record<string, number> | undefined) ?? {}) };
  for (const id of o.plans) nPerPlan[id] = boutsPerCell(PLANS[id], o.n);
  manifest.n = nPerPlan;
  manifest.filter = o.filter ? String(o.filter) : null;
  manifest.machine = machine();

  // ---- pool sizing -------------------------------------------------------------
  const affinity = o.affinity ?? '1F';
  const confined = o.confine ? confineSelf(affinity) : 'not confined (library call)';
  const throttle: ThrottleOptions = { ...DEFAULT_THROTTLE, ...o.throttle };
  const perWorkerBytes = (o.perWorkerMB ?? 200) * 2 ** 20;
  const budgetNow = () => poolBudget({
    cores: cpus().length,
    allowedCores: o.confine && process.platform === 'win32' ? popcount(affinity) : cpus().length,
    freeBytes: freemem(),
    totalBytes: totalmem(),
    perWorkerBytes,
    cap: throttle.cap,
    maxWorkers: o.maxWorkers,
  });
  const budget = budgetNow();
  log(`[batch] ${cells.length} cells · ${total} bouts · ${done.size} already done · seed ${o.seed} · engine ${SIM_ENGINE_VERSION} · params ${paramsHash}`);
  log(`[batch] ${confined}; budget cpu ${budget.cpuBudget} · mem ${budget.memBudget} · max ${o.maxWorkers} → target ${budget.workers} worker(s)`);
  manifest.pool = { target: budget.workers, cpuBudget: budget.cpuBudget, memBudget: budget.memBudget, perWorkerMB: o.perWorkerMB ?? 200, affinity, maxWorkers: o.maxWorkers };
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

  // ---- jobs ----------------------------------------------------------------------
  let cellIdx = 0;
  let boutIdx = 0;
  let dispatched = 0;
  const src: JobSource = {
    next(): JobMessage | null {
      while (cellIdx < cells.length) {
        const cell = cells[cellIdx];
        if (boutIdx >= cell.n) {
          cellIdx++;
          boutIdx = 0;
          continue;
        }
        const i = boutIdx++;
        if (done.has(rowKey(cell.id, i))) continue;
        if (o.stopAfter !== undefined && dispatched >= o.stopAfter) return null;
        dispatched++;
        return buildJob(cell, i, o.seed, o.overrides);
      }
      return null;
    },
  };

  // ---- run ------------------------------------------------------------------------
  const monitor = new ResourceMonitor({ sampleMs: o.sampleMs ?? 2000, throttle, logFile: join(o.out, 'monitor.jsonl'), log });
  let stop = false;
  const onSigint = (): void => {
    if (stop) process.exit(130);
    stop = true;
    log('[batch] stopping: finishing the bouts in flight (Ctrl-C again to abort)');
  };
  process.on('SIGINT', onSigint);

  // Only rows of the cells selected for this session count as skipped.
  const selected = new Set(cells.map((c) => c.id));
  const skipped = [...done].filter((k) => selected.has(k.slice(0, k.lastIndexOf('#')))).length;
  let newRows = 0;
  let errors = 0;
  let lastProgress = 0;
  const remainingByCell = new Map(cells.map((c) => [c.id, c.n]));
  for (const k of done) {
    const cell = k.slice(0, k.lastIndexOf('#'));
    if (remainingByCell.has(cell)) remainingByCell.set(cell, remainingByCell.get(cell)! - 1);
  }
  const startedAt = Date.now();
  const progress = (force = false): void => {
    const now = Date.now();
    if (!force && now - lastProgress < 10_000) return;
    lastProgress = now;
    const cellsDone = [...remainingByCell.values()].filter((v) => v <= 0).length;
    const doneAll = skipped + newRows;
    const mins = (now - startedAt) / 60_000;
    const rate = mins > 0 ? newRows / mins : 0;
    const eta = rate > 0 ? (total - doneAll) / rate : NaN;
    const s = monitor.last;
    log(`cells ${cellsDone}/${cells.length} · bouts ${doneAll.toLocaleString('en-US')}/${total.toLocaleString('en-US')} · ${Math.round(rate).toLocaleString('en-US')} bouts/min · cpu ${(100 * s.cpu).toFixed(0)} % · mem ${(100 * s.ram).toFixed(0)} % · workers ${pool.size}${monitor.paused ? ' · PAUSED' : ''} · eta ${Number.isFinite(eta) ? `${eta.toFixed(1)} min` : '?'}`);
  };

  const pool = new Pool(src, {
    workerUrl: new URL('./worker.ts', import.meta.url),
    target: budget.workers,
    monitor,
    memBudget: () => budgetNow().memBudget,
    log,
    stopRequested: () => stop,
    startWorkers: o.startWorkers,
    onRow: (row) => {
      appendFileSync(resultsFile, `${JSON.stringify(row)}\n`);
      newRows++;
      remainingByCell.set(row.cell, (remainingByCell.get(row.cell) ?? 1) - 1);
    },
    onError: (key, message) => {
      errors++;
      appendFileSync(errorsFile, `${JSON.stringify({ key, message })}\n`);
      log(`[batch] bout ${key} failed: ${message.split('\n')[0]}`);
    },
    onProgress: () => progress(),
  });

  await monitor.start();
  try {
    await pool.run();
  } finally {
    monitor.stop();
    process.off('SIGINT', onSigint);
  }
  progress(true);

  const wallS = Math.round((Date.now() - t0) / 100) / 10;
  const mon = monitor.summary();
  manifest.sessions.push({
    started: new Date(t0).toISOString(),
    ended: new Date().toISOString(),
    wallS,
    boutsDone: newRows,
    errors,
    peakWorkers: pool.peakWorkers,
    confine: confined,
    monitor: mon,
    interrupted: stop || (o.stopAfter !== undefined && skipped + newRows < total),
  });
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  log(`[batch] done: ${newRows} new bouts in ${wallS} s · peak cpu ${(100 * mon.peakCpu).toFixed(0)} % · peak ram ${(100 * mon.peakRam).toFixed(0)} % · pauses ${mon.pauses} · shrinks ${mon.shrinks}`);
  return { out: o.out, cells: cells.length, total, skipped, done: newRows, errors, wallS, peakWorkers: pool.peakWorkers, monitor: mon };
}
