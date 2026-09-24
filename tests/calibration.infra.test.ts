/**
 * PHASE 9 — calibration infrastructure (scripts/batch, scripts/calibrate).
 *
 * The load-bearing claims:
 *   1. A batch row is a pure function of its job: the same plan + seed gives
 *      byte-identical rows (after sorting) on one worker thread or two.
 *   2. An interrupted run (including a torn last line) resumed with --resume
 *      ends with exactly the rows of an uninterrupted run.
 *   3. The metric functions compute what the §7.1 rows say, on hand-built
 *      fixtures whose answers are worked out by hand.
 *   4. The §6.6 rule: pass iff |sim − target| ≤ tol and CI ≤ tol / 2.
 *   5. Every plan generates valid fighters and every config simulates.
 *
 * The batch tests spawn real `worker_threads` (tsx loader) and keep the
 * resource monitor's 93 % cap on; they run a handful of bouts.
 */
import { describe, expect, it } from 'vitest';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRunner, type FromWorker } from '../src/app/workers/simProtocol';
import { simulate, type BoutRun } from '../src/sim';
import { runBatch } from '../scripts/batch/batch';
import { PLANS, buildJob } from '../scripts/batch/plans';
import { runQaBout, summarizeRun } from '../scripts/batch/summarize';
import { executeJob } from '../scripts/batch/execute';
import { DEFAULT_THROTTLE, Throttle, poolBudget, type Sample } from '../scripts/batch/monitor';
import type { FighterRow, ResultRow } from '../scripts/batch/types';
import { Dataset, ptLA } from '../scripts/calibrate/data';
import { MASTER_ROWS, evaluateAll, evaluateRow, judgeComp } from '../scripts/calibrate/metrics';
import { edgeCaseChecks, strategyChecks, tierChecks } from '../scripts/calibrate/checks';
import { renderReport } from '../scripts/calibrate/report';
import { proportion, ratio, verdictOf, zOf } from '../scripts/calibrate/stats';

const sortedLines = (file: string): string[] =>
  readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '').sort();

// A small mixed job list: ordinary bouts through the worker protocol, and one
// §7.4 QA cell (stepped by hand with the invariant sweep).
const FILTER = /^(identical\/mirror|edge_cases\/max_stats)$/;
const PLAN_IDS = ['identical', 'edge_cases'];
const N = 4;

function batch(out: string, workers: number, extra: Partial<Parameters<typeof runBatch>[0]> = {}) {
  return runBatch({
    plans: PLAN_IDS,
    n: N,
    seed: 'infra-test',
    out,
    maxWorkers: workers,
    startWorkers: workers,
    filter: FILTER,
    sampleMs: 500,
    perWorkerMB: 1,
    quiet: true,
    ...extra,
  });
}

describe('batch runner', () => {
  const root = mkdtempSync(join(tmpdir(), 'boutlab-cal-'));

  it('produces byte-identical rows on one worker and on two', async () => {
    const one = await batch(join(root, 'w1'), 1);
    const two = await batch(join(root, 'w2'), 2);
    expect(one.errors).toBe(0);
    expect(two.errors).toBe(0);
    expect(one.done).toBe(2 * N);
    expect(two.peakWorkers).toBe(2);
    const a = sortedLines(join(root, 'w1', 'results.jsonl'));
    const b = sortedLines(join(root, 'w2', 'results.jsonl'));
    expect(a.length).toBe(2 * N);
    expect(b).toEqual(a);
    // Rows carry no wall-clock data and reproduce from their own seed.
    const row = JSON.parse(a[0]) as ResultRow;
    expect(row.ev).toMatch(/^\d+\.\d+\.\d+$/);
    expect(JSON.stringify(row)).not.toMatch(/"(wall|ms|elapsedMs|time)"/);
  }, 180_000);

  it('resumes an interrupted run (with a torn last line) to the same rows', async () => {
    const out = join(root, 'resume');
    const first = await batch(out, 1, { stopAfter: 3 });
    expect(first.done).toBe(3);
    // A crash mid-write leaves half a line with no newline.
    appendFileSync(join(out, 'results.jsonl'), '{"cell":"identical/mirror","i":3,"seed":"inf');
    const second = await batch(out, 2, { resume: true });
    expect(second.skipped).toBe(3);
    expect(second.done).toBe(2 * N - 3);
    expect(sortedLines(join(out, 'results.jsonl'))).toEqual(sortedLines(join(root, 'w1', 'results.jsonl')));
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as { sessions: { monitor: { peakRam: number } }[] };
    expect(manifest.sessions).toHaveLength(2);
    expect(manifest.sessions[0].monitor.peakRam).toBeGreaterThan(0);
  }, 180_000);

  it('refuses to overwrite a run without --resume', async () => {
    await expect(batch(join(root, 'w1'), 1)).rejects.toThrow(/--resume/);
  });

  it('cleans up', () => {
    rmSync(root, { recursive: true, force: true });
  });
});

describe('row summariser', () => {
  const cell = PLANS.baseline.cells(1).find((c) => c.id === 'baseline/ufc/LW')!;

  it('position x target cross-tabs sum back to computeStats exactly', () => {
    for (let i = 0; i < 3; i++) {
      const job = buildJob(cell, i, 'xtab');
      const run = simulate(job.config);
      const row = summarizeRun(run, job.cell, job.i, job.tags, job.bt);
      for (let f = 0; f < 2; f++) {
        const s = run.stats.total.fighters[f];
        const fr = row.f[f];
        for (const p of ['distance', 'clinch', 'ground'] as const) {
          expect(ptLA(fr, p, null)).toEqual([s.sigByPosition[p].landed, s.sigByPosition[p].attempted]);
        }
        for (const t of ['head', 'body', 'leg'] as const) {
          expect(ptLA(fr, null, t)).toEqual([s.sigByTarget[t].landed, s.sigByTarget[t].attempted]);
        }
        expect(fr.rsa.reduce((a, b) => a + b, 0)).toBe(s.sig.attempted);
      }
      expect(row.res.fs).toBeLessThanOrEqual(row.res.ts);
      expect(row.pos.reduce((a, b) => a + b, 0)).toBeCloseTo(row.res.fs, 0);
    }
  });

  it('the worker protocol, the QA sweep and simulate() agree on the digest', async () => {
    const job = buildJob(cell, 0, 'digest');
    const direct = simulate(job.config);
    const qa = runQaBout(job.config, job.valid);
    expect(qa.run.digest).toBe(direct.digest);
    expect(qa.run.ticks).toBe(direct.ticks);
    let viaProtocol: BoutRun | null = null;
    const runner = createRunner({ post: (m: FromWorker) => { if (m.type === 'done') viaProtocol = m.run; } });
    await runner.handle({ type: 'run', id: 'x', config: JSON.parse(JSON.stringify(job.config)), record: false, progressEveryTicks: 1e9 });
    expect((viaProtocol as BoutRun | null)?.digest).toBe(direct.digest);
    const row = await executeJob(job);
    expect(row.digest).toBe(direct.digest);
  });
});

describe('plans', () => {
  it('every plan builds valid fighters and every config simulates', () => {
    let cells = 0;
    for (const plan of Object.values(PLANS)) {
      for (const c of plan.cells(2)) {
        cells++;
        for (let i = 0; i < 2; i++) {
          const job = buildJob(c, i, 'plan-check');
          if (!c.allowInvalid) expect(job.valid.every(Boolean), `${c.id} #${i}`).toBe(true);
          expect(job.config.fighters.length).toBeGreaterThanOrEqual(2);
          expect(job.config.teams.teamOf).toHaveLength(job.config.fighters.length);
          if (i === 0) {
            const run = simulate(job.config, { maxTicks: 40 });
            expect(run.ticks, c.id).toBeGreaterThan(0);
          }
        }
      }
    }
    expect(cells).toBeGreaterThan(150);
  }, 120_000);

  it('bout seeds are boutSeed(planSeed, cell, i) and make() is deterministic', () => {
    const c = PLANS.physical_sweeps.cells(2).find((x) => x.id === 'physical_sweeps/reach/10')!;
    const a = buildJob(c, 1, 's');
    const b = buildJob(c, 1, 's');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.config.seed).toBe('s::v4::physical_sweeps/reach/10::bout-1');
    // Sides alternate: bout 1 carries the edge on side 1, 10 cm more reach.
    expect(a.bt?.edge).toBe(1);
    expect(a.config.fighters[1].body.reachM - a.config.fighters[0].body.reachM).toBeCloseTo(0.10, 5);
  });
});

// ---------------------------------------------------------------------------
// Metrics on hand-built fixtures
// ---------------------------------------------------------------------------

function fighter(p: Partial<FighterRow> & { sig: [number, number] }): FighterRow {
  // All significant strikes at distance to the head unless stated.
  const pt = new Array<number>(18).fill(0);
  pt[0] = p.sig[0];
  pt[1] = p.sig[1];
  return {
    tot: [p.sig[0], p.sig[1]], pt, jab: [0, 0], hd: [p.sig[0], p.sig[1]], kd: 0, td: [0, 0], sub: 0, rev: 0, ctrl: 0,
    abs: 0, habs: 0, rsa: [0, 0, 0], rsl: [0, 0, 0], rhl: [0, 0, 0], rta: [0, 0, 0], rsu: [0, 0, 0], rst: [0, 0, 0],
    cle: 0, cls: 0, fe: 0, rk: 0, inCl: 0, inGr: 0, con: 0, ad: [0, 0, 0, 0],
    m: { tier: 4, rating: 70, exp: 1, h: 1.8, reach: 1.85, kg: 77, age: 30, stance: 'orthodox', sex: 'male', bouts: 20, kdHist: 0, team: 0 },
    ...p,
  };
}

function bout(i: number, fs: number, w: number, m: string, r: number, f0: FighterRow, f1: FighterRow, extra: Partial<ResultRow> = {}): ResultRow {
  return {
    cell: 'baseline/ufc/LW', i, seed: `fx::v4::baseline/ufc/LW::bout-${i}`, digest: 'x', ticks: fs * 10, draws: 0, ev: '4.2.0', ph: 'p',
    tags: { plan: 'baseline', group: 'ufc', wc: 'LW', sex: 'male', mode: '1v1', ruleset: 'mma.unified.3r', arena: 'octagon_30', tierA: 4, tierB: 4 },
    res: { w, team: w, m, r, t: fs - (r - 1) * 300, fs, ts: fs + (r - 1) * 60, det: '' },
    rl: 300, pos: [fs * 0.6, fs * 0.15, fs * 0.25], live: [300, 300, 300].slice(0, r), low: [0, 0, 0].slice(0, r),
    f: [f0, f1], kd: [], slam: 0, ...extra,
  };
}

describe('metric functions (hand-built fixtures)', () => {
  // Bout A: 10 min, fighter 0 wins by KO in R2 with one knockdown; 30/60 vs 10/40.
  // Bout B: 15 min, fighter 1 wins a unanimous decision; 20/50 vs 40/80, TDs 1/4 vs 2/3.
  const A = bout(0, 600, 0, 'ko', 2,
    fighter({ sig: [30, 60], kd: 1, td: [0, 1], ctrl: 60 }),
    fighter({ sig: [10, 40], habs: 30 }),
    { kd: [[2, 100, 0, 1, 'tech.cross', 'hurt']], fin: { k: 'strike', id: 'tech.cross', cls: 'punch', tgt: 'head', pos: 'distance' } });
  const B = bout(1, 900, 1, 'decision.unanimous', 3,
    fighter({ sig: [20, 50], td: [1, 4], ctrl: 30 }),
    fighter({ sig: [40, 80], td: [2, 3], ctrl: 240 }),
    { cards: [[[9, 10], [9, 10], [10, 9]], [[9, 10], [9, 10], [10, 9]], [[9, 10], [10, 9], [10, 9]]] });
  const d = new Dataset([A, B]);
  const row = (id: number) => evaluateRow(MASTER_ROWS.find((r) => r.id === id)!, d);
  const v = (id: number, k = 0) => row(id).comps[k].est.value;

  it('row 1/2/3/4: pooled rates over fighter-minutes and pooled accuracy', () => {
    // (30+10+20+40) / (2x10 + 2x15) = 100 / 50
    expect(v(1)).toBeCloseTo(2.0, 10);
    expect(v(2)).toBeCloseTo(230 / 50, 10);
    expect(v(3)).toBeCloseTo(100 / 230, 10);
    expect(v(4)).toBeCloseTo(130 / 230, 10);
  });

  it('row 9/10: winner and loser output', () => {
    expect(v(9, 0)).toBeCloseTo((30 + 40) / (10 + 15), 10);
    expect(v(9, 1)).toBeCloseTo((10 + 20) / (10 + 15), 10);
    expect(v(10, 0)).toBeCloseTo((30 + 40) / (60 + 80), 10);
  });

  it('row 30/31/32/39/42: knockdowns', () => {
    expect(v(30)).toBeCloseTo((1 / 50) * 15, 10);
    expect(v(31)).toBeCloseTo(0.5, 10);
    expect(v(32)).toBeCloseTo(0.5, 10);
    expect(v(39, 0)).toBe(1);
    expect(v(40)).toBe(1); // the KD scorer finished in the same round
    expect(v(42, 0)).toBe(1);
  });

  it('row 46/47: strikes absorbed before a KO and KO duration', () => {
    expect(v(46, 0)).toBe(30);
    expect(v(47, 0)).toBeCloseTo(10, 10);
  });

  it('row 56/57/58: takedowns', () => {
    expect(v(56)).toBeCloseTo((3 / 50) * 15, 10);
    expect(v(57)).toBeCloseTo(3 / 8, 10);
    expect(v(58)).toBeCloseTo(5 / 8, 10);
  });

  it('row 84/85/86: decision drivers', () => {
    expect(v(84)).toBe(1); // more control won the only decision
    expect(v(85)).toBe(1); // more sig strikes won it
    expect(v(86)).toBe(1); // more TDs landed won it
  });

  it('row 88/99/101/105/114: outcomes, rounds, duration, decision type, judge agreement', () => {
    const mix = row(88).comps.map((c) => c.est.value);
    expect(mix).toEqual([0.5, 0, 0.5, 0]);
    expect(v(99)).toBe(0);
    expect(v(101, 0)).toBeCloseTo(12.5, 10);
    expect(v(105, 0)).toBe(1);
    // Cards: round 1 (fighter 1) and round 3 (fighter 0) agree 3/3; round 2 splits 2-1.
    expect(v(114)).toBeCloseTo(2 / 3, 10);
  });

  it('row 27/82: the finishing blow', () => {
    expect(v(27, 0)).toBe(1);
    expect(v(82, 0)).toBe(1);
  });

  it('every one of the 129 rows is mapped, and all of them evaluate', () => {
    expect(MASTER_ROWS.map((r) => r.id)).toEqual(Array.from({ length: 129 }, (_, k) => k + 1));
    for (const r of MASTER_ROWS) {
      expect(Boolean(r.compute) || Boolean(r.unmeasurable), `row ${r.id}`).toBe(true);
      if (r.status === 'n/a') expect(r.unmeasurable, `row ${r.id}`).toBeTruthy();
    }
    const all = evaluateAll(d);
    expect(all).toHaveLength(129);
    expect(() => strategyChecks(d)).not.toThrow();
    expect(() => tierChecks(d)).not.toThrow();
    expect(() => edgeCaseChecks(d)).not.toThrow();
    const md = renderReport({ rows: [A, B], label: 'fixture' });
    expect(md).toContain('## 1. Master target table');
    expect(md).toContain('## How to run calibration');
  });
});

describe('the §6.6 pass rule', () => {
  it('passes only inside tolerance with a CI no wider than half of it', () => {
    expect(verdictOf({ value: 3.9, ci: 0.1, target: 3.9, tol: 0.4 })).toBe('PASS');
    expect(verdictOf({ value: 4.3, ci: 0.2, target: 3.9, tol: 0.4 })).toBe('PASS');
    expect(verdictOf({ value: 4.0, ci: 0.21, target: 3.9, tol: 0.4 })).toBe('WIDE');
    expect(verdictOf({ value: 4.31, ci: 0.01, target: 3.9, tol: 0.4 })).toBe('FAIL');
    expect(verdictOf({ value: null, ci: null, target: 3.9, tol: 0.4 })).toBe('NO DATA');
    expect(zOf({ value: 4.5, ci: 0, target: 3.9, tol: 0.4 })).toBeCloseTo(1.5, 10);
    expect(zOf({ value: 3.5, ci: 0, target: 3.9, tol: 0.4 })).toBeCloseTo(-1, 10);
  });

  it('one-sided criteria pass only when the whole CI clears the threshold', () => {
    const base = { label: 'x', target: 0.95, tol: 0, unit: 'pct' as const, kind: 'ge' as const };
    expect(judgeComp({ ...base, est: { value: 0.99, ci: 0.02, n: 100 } }).verdict).toBe('PASS');
    expect(judgeComp({ ...base, est: { value: 0.96, ci: 0.03, n: 100 } }).verdict).toBe('WIDE');
    expect(judgeComp({ ...base, est: { value: 0.90, ci: 0.01, n: 100 } }).verdict).toBe('FAIL');
  });

  it('estimators: Wilson half-width and the pooled ratio', () => {
    const p = proportion(640, 2000);
    expect(p.value).toBeCloseTo(0.32, 10);
    expect(p.ci!).toBeCloseTo(0.0204, 3); // 09 §8.3 worked example
    const r = ratio([1, 2, 3], [2, 4, 6]);
    expect(r.value).toBeCloseTo(0.5, 10);
    expect(r.ci).toBeCloseTo(0, 10);
  });
});

describe('resource monitor', () => {
  const s = (t: number, cpu: number, ram: number): Sample => ({ t, cpu, ram });

  // Explicit 0.93 / 0.85 thresholds: the state machine under test, not the defaults.
  const OPTS = { ...DEFAULT_THROTTLE, cap: 0.93, resumeBelow: 0.85 };
  it('pauses above the cap, holds through the hysteresis band, resumes below 85 %', () => {
    const th = new Throttle(OPTS);
    expect(th.update(s(0, 0.5, 0.80), 2)).toEqual([]);
    expect(th.update(s(2000, 0.5, 0.94), 2)).toEqual(['pause']);
    expect(th.update(s(4000, 0.5, 0.88), 2)).toEqual([]);
    expect(th.paused).toBe(true);
    expect(th.update(s(6000, 0.5, 0.84), 2)).toEqual(['resume']);
    expect(th.update(s(8000, 0.96, 0.5), 2)).toEqual(['pause']);
  });

  it('shrinks the pool every 30 s of persistent pressure, never below one worker, then relaxes', () => {
    const th = new Throttle(OPTS);
    th.update(s(0, 0.5, 0.95), 3);
    expect(th.update(s(20_000, 0.5, 0.95), 3)).toEqual([]);
    expect(th.update(s(30_000, 0.5, 0.95), 3)).toEqual(['shrink']);
    expect(th.update(s(60_000, 0.5, 0.95), 2)).toEqual(['shrink']);
    expect(th.update(s(90_000, 0.5, 0.95), 1)).toEqual([]);
    // One worker, paused > 60 s, machine idling at 90 %: relaxed resume.
    expect(th.update(s(92_000, 0.5, 0.90), 1)).toEqual(['resume']);
  });

  it('sizes the pool from cores, affinity, free RAM and --max-workers (§6.1)', () => {
    const GB = 2 ** 30;
    const b = poolBudget({ cores: 8, allowedCores: 6, freeBytes: 5.5 * GB, totalBytes: 15.6 * GB, perWorkerBytes: 200 * 2 ** 20, cap: 0.93, maxWorkers: 7 });
    expect(b.cpuBudget).toBe(6);
    expect(b.memBudget).toBe(22);
    expect(b.workers).toBe(6);
    // RAM already over the cap: the budget floors at one worker (the monitor then keeps it paused).
    expect(poolBudget({ cores: 8, allowedCores: 6, freeBytes: 0.5 * GB, totalBytes: 15.6 * GB, perWorkerBytes: 200 * 2 ** 20, cap: 0.93, maxWorkers: 7 }).workers).toBe(1);
  });
});
