/**
 * CALIBRATION REPORT — docs/design/09 §6.6.
 *
 *   npx tsx scripts/calibrate/report.ts runs/<id> [--out docs/CALIBRATION.md]
 *       [--baseline runs/<prev>] [--label "pre-tuning baseline"]
 *
 * Regenerable from `results.jsonl` alone: every metric, check and QA line is
 * computed from the rows. `manifest.json`, when present, adds what rows cannot
 * know — machine, pool size, wall time and the monitor's peak CPU/RAM.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readResults } from '../batch/batch';
import { PLANS } from '../batch/plans';
import type { ResultRow } from '../batch/types';
import { edgeCaseChecks, strategyChecks, tierChecks, type CheckResult, type QaResult } from './checks';
import { Dataset } from './data';
import { MASTER_ROWS, evaluateAll, type CompResult, type RowResult } from './metrics';

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function fmtVal(v: number | null, unit: CompResult['unit']): string {
  if (v === null || !Number.isFinite(v)) return '—';
  switch (unit) {
    case 'pct': return `${(100 * v).toFixed(1)} %`;
    case 'min': return `${v.toFixed(2)} min`;
    case 's': return `${v.toFixed(1)} s`;
    case 'bool': return v === 1 ? 'yes' : 'no';
    default: return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2);
  }
}

function fmtCi(c: CompResult): string {
  const ci = c.est.ci;
  if (ci === null || !Number.isFinite(ci) || c.unit === 'bool') return '—';
  switch (c.unit) {
    case 'pct': return `±${(100 * ci).toFixed(1)}`;
    case 'min': return `±${ci.toFixed(2)}`;
    case 's': return `±${ci.toFixed(1)}`;
    default: return `±${ci.toFixed(2)}`;
  }
}

function fmtTarget(c: CompResult): string {
  if (c.info) return c.target === 0 && c.tol === 0 ? '(report)' : `${fmtVal(c.target, c.unit)} (info)`;
  if (c.unit === 'bool') return 'yes';
  if (c.kind === 'ge') return `≥ ${fmtVal(c.target, c.unit)}`;
  if (c.kind === 'le') return `≤ ${fmtVal(c.target, c.unit)}`;
  return fmtVal(c.target, c.unit);
}

function fmtTol(c: CompResult): string {
  if (c.info || c.unit === 'bool' || c.kind === 'ge' || c.kind === 'le') return '—';
  switch (c.unit) {
    case 'pct': return `±${(100 * c.tol).toFixed(1)} pp`;
    case 'min': return `±${c.tol.toFixed(2)}`;
    case 's': return `±${c.tol.toFixed(1)}`;
    default: return `±${c.tol.toFixed(2)}`;
  }
}

const esc = (s: string): string => s.replace(/\|/g, '\\|');
const badge = (v: string): string => (v === 'PASS' ? '**PASS**' : v === 'FAIL' ? 'FAIL' : v);

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

interface Manifest {
  plans?: string[];
  n?: Record<string, number>;
  seed?: string;
  engineVersion?: string;
  paramsHash?: string;
  paramOverrides?: Record<string, number>;
  machine?: { platform?: string; node?: string; cpuModel?: string; cores?: number; totalGB?: number; freeGBAtStart?: number };
  pool?: { target?: number; cpuBudget?: number; memBudget?: number; perWorkerMB?: number; affinity?: string; maxWorkers?: number };
  sessions?: { started: string; ended: string; wallS: number; boutsDone: number; errors: number; peakWorkers: number; confine: string; interrupted?: boolean;
    monitor: { peakCpu: number; peakRam: number; meanCpu: number; samples: number; pauses: number; shrinks: number; pausedS: number } }[];
}

function planSeedOf(r: ResultRow): string {
  const k = r.seed.indexOf('::v4::');
  return k >= 0 ? r.seed.slice(0, k) : r.seed;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface ReportInput {
  rows: ResultRow[];
  manifest?: Manifest;
  baselineRows?: ResultRow[];
  label?: string;
  runDir?: string;
}

function masterSection(results: RowResult[], base?: Map<string, CompResult>): string[] {
  const out: string[] = [];
  let section = '';
  const head = base
    ? '| # | metric | sim | 95 % CI | target | tolerance | z | Δ vs baseline | pass? | status |\n|---|---|---|---|---|---|---|---|---|---|'
    : '| # | metric | sim | 95 % CI | target | tolerance | z | pass? | status |\n|---|---|---|---|---|---|---|---|---|';
  for (const r of results) {
    if (r.row.section !== section) {
      section = r.row.section;
      out.push('', `### ${section}`, '', head);
    }
    const status = r.row.status;
    if (r.verdict === 'N/A') {
      const cells = [`${r.row.id}`, esc(r.row.metric), '—', '—', esc(r.row.target), esc(r.row.tolerance), '—'];
      if (base) cells.push('—');
      cells.push('n/a', `${status} — ${esc(r.row.unmeasurable ?? 'not modelled')}`);
      out.push(`| ${cells.join(' | ')} |`);
      continue;
    }
    const cp = r.classPass ? ` (classes passing: men ${r.classPass.men[0]}/${r.classPass.men[1]}${r.classPass.women[1] ? `, women ${r.classPass.women[0]}/${r.classPass.women[1]}` : ''})` : '';
    r.comps.forEach((c, k) => {
      const first = k === 0;
      const cells = [
        first ? `${r.row.id}` : '',
        first ? `${esc(r.row.metric)} — *${esc(c.label)}*` : `*${esc(c.label)}*`,
        fmtVal(c.est.value, c.unit),
        fmtCi(c),
        fmtTarget(c),
        fmtTol(c),
        c.z === null ? '—' : c.z.toFixed(2),
      ];
      if (base) {
        const b = base.get(`${r.row.id}|${c.label}`);
        const dv = b && b.est.value !== null && c.est.value !== null ? c.est.value - b.est.value : null;
        cells.push(dv === null ? '—' : (c.unit === 'pct' ? `${(100 * dv).toFixed(1)} pp` : dv.toFixed(2)));
      }
      cells.push(
        first ? `${badge(r.verdict)}${c.verdict !== r.verdict && r.comps.length > 1 ? ` (${c.verdict})` : ''}` : c.verdict,
        first ? `${status}${cp}` : '',
      );
      out.push(`| ${cells.join(' | ')} |`);
    });
    if (r.note) out.push(`| | ↳ ${esc(r.note)} | | | | | |${base ? ' |' : ''} | |`);
  }
  return out;
}

function checkSection(checks: CheckResult[]): string[] {
  const out = ['| Id | check | part | sim | 95 % CI | criterion | verdict |', '|---|---|---|---|---|---|---|'];
  for (const c of checks) {
    c.parts.forEach((p, k) => {
      const crit = p.kind === 'ge' ? `≥ ${fmtVal(p.target, p.unit)}` : p.kind === 'le' ? `≤ ${fmtVal(p.target, p.unit)}`
        : p.unit === 'bool' ? 'yes' : p.info ? '(report)' : `${fmtVal(p.target - p.tol, p.unit)} – ${fmtVal(p.target + p.tol, p.unit)}`;
      out.push(`| ${k === 0 ? `**${c.id}**` : ''} | ${k === 0 ? esc(c.title) : ''} | ${esc(p.label)} | ${fmtVal(p.est.value, p.unit)} | ${fmtCi(p)} | ${crit} | ${k === 0 ? `${badge(c.verdict)}${p.verdict !== c.verdict ? ` (${p.verdict})` : ''}` : p.verdict} |`);
    });
    for (const u of c.unmeasured) out.push(`| | | *not measurable yet* | — | — | ${esc(u)} | n/a |`);
    out.push(`| | | *criterion* | | | ${esc(c.criterion)} — population: ${esc(c.population)}${c.note ? `. ${esc(c.note)}` : ''} | |`);
  }
  return out;
}

function qaSection(qa: QaResult[]): string[] {
  const out = ['| Case | expectation | observed | n | verdict |', '|---|---|---|---|---|'];
  for (const q of qa) out.push(`| ${esc(q.id)} | ${esc(q.expectation)} | ${esc(q.observed)} | ${q.n} | ${badge(q.verdict)} |`);
  return out;
}

function countVerdicts(results: RowResult[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const r of results) c[r.verdict] = (c[r.verdict] ?? 0) + 1;
  return c;
}

/** Seconds of worker time per simulated tick, from the manifest and the rows. */
function costModel(rows: ResultRow[], m?: Manifest): { secPerTick: number; meanTicks: number } | null {
  const s = m?.sessions ?? [];
  const bouts = s.reduce((a, x) => a + x.boutsDone, 0);
  if (bouts === 0 || rows.length === 0) return null;
  const workerS = s.reduce((a, x) => a + x.wallS * Math.max(1, x.peakWorkers), 0);
  const ticks = rows.reduce((a, r) => a + r.ticks, 0) * (bouts / rows.length);
  return { secPerTick: workerS / ticks, meanTicks: rows.reduce((a, r) => a + r.ticks, 0) / rows.length };
}

function howToRun(rows: ResultRow[], m?: Manifest): string[] {
  const cost = costModel(rows, m);
  const est = (plan: string, workers: number): string => {
    if (!cost) return '—';
    const p = PLANS[plan];
    const cells = p.cells(p.defaultN);
    const bouts = cells.reduce((a, c) => a + c.n, 0);
    const own = rows.filter((r) => r.tags.plan === plan || (plan === 'ufc_population' && r.tags.group === 'ufc'));
    const ticks = own.length > 0 ? own.reduce((a, r) => a + r.ticks, 0) / own.length : cost.meanTicks;
    const h = (bouts * ticks * cost.secPerTick) / workers / 3600;
    return h >= 1 ? `${h.toFixed(1)} h` : `${(h * 60).toFixed(0)} min`;
  };
  const planRows = Object.values(PLANS).map((p) => {
    const cells = p.cells(p.defaultN);
    const bouts = cells.reduce((a, c) => a + c.n, 0);
    return `| \`${p.id}\` | ${cells.length} | ${p.defaultN.toLocaleString('en-US')} | ${bouts.toLocaleString('en-US')} | ${est(p.id, 1)} | ${est(p.id, 2)} | ${esc(p.description)} |`;
  });
  return [
    '## How to run calibration',
    '',
    'All heavy commands go through the machine governor (`scripts/dev/heavy.mjs`), which waits for a free slot, memory headroom and CPU below 70 % before it starts, and confines the job to 6 of 8 cores at below-normal priority.',
    '',
    '```sh',
    '# list plans, cells and default bouts per cell',
    'npx tsx scripts/batch/run.ts --list',
    '',
    '# the pre-tuning baseline in this file',
    'node scripts/dev/heavy.mjs npm run batch -- --plan baseline,tier_matrix,identical \\',
    '    --n baseline=30,tier_matrix=8,identical=100 --seed cal-2026-09 --out runs/pre-tuning --max-workers 2',
    '# ... plus the §7.4 QA cells, added to the same run directory',
    'node scripts/dev/heavy.mjs npx tsx scripts/batch/run.ts --plan edge_cases,multi,rules_arenas \\',
    '    --n edge_cases=5,multi=5,rules_arenas=3 --seed cal-2026-09 --out runs/pre-tuning --max-workers 2 --resume',
    'npx tsx scripts/calibrate/report.ts runs/pre-tuning --out docs/CALIBRATION.md --label "pre-tuning baseline"   # (npm run drops the quotes on Windows)',
    '',
    '# a full §7.1 run (the tuning engineer\'s job), resumable after any interruption',
    'node scripts/dev/heavy.mjs npm run batch -- --plan ufc_population --seed cal-2026-09 --out runs/ufc-2000 --max-workers 2',
    'node scripts/dev/heavy.mjs npm run batch -- --plan ufc_population --seed cal-2026-09 --out runs/ufc-2000 --max-workers 2 --resume',
    '',
    '# one tuning candidate: same seeds (common random numbers), overrides from a file, Δ column against the reference',
    'node scripts/dev/heavy.mjs npm run batch -- --plan ufc_population --n 200 --seed cal-2026-09 --out runs/cand-01 --params cand-01.json',
    'npm run calibrate:report -- runs/cand-01 --out runs/cand-01/CALIBRATION.md --baseline runs/ufc-200',
    '```',
    '',
    'Useful flags: `--filter cell=LW` (subset of cells by regex), `--n plan=N,plan=N`, `--cap 0.93`, `--resume-below 0.85`, `--affinity 3F`, `--per-worker-mb 200`. Output: `runs/<id>/manifest.json`, `results.jsonl` (one ≈ 2 KB row per bout, no frames), `errors.jsonl`, `monitor.jsonl` (a sample every 2 s).',
    '',
    '**Expected wall time on this machine** (8 cores / 15.6 GB, i.e. the laptop this report was produced on), extrapolated from this run\'s measured worker-seconds per simulated tick and each plan\'s mean bout length (plans not in this run use this run\'s mean):',
    '',
    '| plan | cells | bouts/cell | bouts | 1 worker | 2 workers | purpose |',
    '|---|---|---|---|---|---|---|',
    ...planRows,
    '',
    'Wall time scales with bout length: plans dominated by decisions (≈ 10,200 ticks) cost about twice what finish-heavy plans do. Bout cost will change as tuning moves the method mix.',
    '',
    '**How the resource monitor behaves.** The runner lowers its own priority and pins itself (and so every worker thread) to cores 0–5 (`--affinity 3F`). Every 2 s it samples machine-wide CPU from `os.cpus()` tick deltas and RAM from `os.freemem()`; each sample is appended to `monitor.jsonl`.',
    '',
    '- *Sizing (§6.1).* Target workers = min(⌊cores × 0.93⌋ capped at the allowed cores, ⌊(free RAM − 7 % of total) / 200 MB⌋, `--max-workers`), at least 1. The pool starts with **one** worker and adds one per sample only while CPU < 85 %, RAM < 90 % and the live RAM budget has room — so a cold start never spikes the machine.',
    '- *Throttle (§6.2).* CPU > 93 % or RAM > 93 % → dispatch pauses (workers finish the bout they hold; nothing new is sent). Dispatch resumes when both are below 85 %. If the pause lasts 30 s, one worker is retired (pool shrinks, never below one) and another every further 30 s. Once the pool is at one worker and has been paused 60 s, it resumes below 91 % instead of 85 % so a machine that simply idles at 88–91 % because of other programs does not stall the run forever.',
    '- *Starting over the cap.* If RAM (or CPU) is already above 93 % when the run starts, no worker is spawned; the runner logs the reason every 30 s and starts when the machine drops below 85 %.',
    '- *Interruption.* Ctrl-C stops dispatch and lets bouts in flight finish; the manifest records the session. `--resume` truncates a partial last line and skips every `(cell, i)` already in `results.jsonl`; rows are pure functions of `(plan seed, cell, i, params)`, so a resumed file sorts to exactly the uninterrupted file (tested).',
    '',
  ];
}

/** Row ids of the headline before/after table (the §7.1 rows people ask about first). */
const HEADLINE_ROWS = [1, 2, 3, 5, 7, 16, 24, 30, 36, 39, 55, 57, 69, 73, 77, 80, 88, 90, 101, 105, 107, 125];

function headlineSection(now: RowResult[], before: RowResult[]): string[] {
  const b = new Map(before.map((r) => [r.row.id, r]));
  const verdicts = (rs: RowResult[]) => {
    const a = rs.filter((r) => r.verdict !== 'N/A' && r.verdict !== 'NO DATA');
    return `${a.filter((r) => r.verdict === 'PASS').length} PASS · ${a.filter((r) => r.verdict === 'WIDE').length} WIDE · ${a.filter((r) => r.verdict === 'FAIL').length} FAIL`;
  };
  const core = (rs: RowResult[]) => rs.filter((r) => r.row.status === 'core');
  const out = [
    '### Headline metrics: pre-tuning baseline → post-tuning',
    '',
    `Master table verdicts (rows with data): baseline ${verdicts(before)}; now ${verdicts(now)}. Core rows: baseline ${verdicts(core(before))}; now ${verdicts(core(now))}.`,
    '',
    '| # | metric | component | baseline | now | target | verdict |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const id of HEADLINE_ROWS) {
    const r = now.find((x) => x.row.id === id);
    if (!r) continue;
    const br = b.get(id);
    for (const c of r.comps) {
      if (c.verdict === 'INFO') continue;
      const bc = br?.comps.find((x) => x.label === c.label);
      out.push(`| ${id} | ${esc(r.row.metric)} | ${esc(c.label)} | ${bc ? fmtVal(bc.est.value, bc.unit) : '—'} | ${fmtVal(c.est.value, c.unit)} | ${fmtTarget(c)} | ${c.verdict} |`);
    }
  }
  out.push('');
  return out;
}

export function renderReport(inp: ReportInput): string {
  const d = new Dataset(inp.rows);
  const results = evaluateAll(d);
  const s = strategyChecks(d);
  const t = tierChecks(d);
  const q = edgeCaseChecks(d);
  const m = inp.manifest;

  let base: Map<string, CompResult> | undefined;
  let baseResults: RowResult[] | undefined;
  if (inp.baselineRows) {
    base = new Map();
    baseResults = evaluateAll(new Dataset(inp.baselineRows));
    for (const r of baseResults) for (const c of r.comps) base.set(`${r.row.id}|${c.label}`, c);
  }

  // ---- summary --------------------------------------------------------------------
  const applicable = results.filter((r) => r.verdict !== 'N/A');
  const byStatus = (st: string) => applicable.filter((r) => r.row.status === st);
  const passing = (rs: RowResult[]) => rs.filter((r) => r.verdict === 'PASS').length;
  const vc = countVerdicts(results);
  const coreMisses = results
    .filter((r) => r.row.status === 'core' || r.row.status === 'proxy')
    .flatMap((r) => r.comps.filter((c) => c.verdict === 'FAIL' && c.z !== null).map((c) => ({ r, c })))
    .sort((a, b) => Math.abs(b.c.z!) - Math.abs(a.c.z!))
    .slice(0, 12);
  const measurable = MASTER_ROWS.filter((r) => r.compute && r.status !== 'n/a').length;
  const proxies = MASTER_ROWS.filter((r) => r.status === 'proxy').length;

  const ev = [...new Set(inp.rows.map((r) => r.ev))].join(', ') || m?.engineVersion || '—';
  const ph = [...new Set(inp.rows.map((r) => r.ph))].join(', ') || m?.paramsHash || '—';
  const seeds = [...new Set(inp.rows.map(planSeedOf))].join(', ') || m?.seed || '—';
  const cells = new Map<string, number>();
  for (const r of inp.rows) cells.set(r.cell, (cells.get(r.cell) ?? 0) + 1);
  const plansRun = [...new Set(inp.rows.map((r) => r.tags.plan))];
  const perPlan = plansRun.map((p) => {
    const rs = inp.rows.filter((r) => r.tags.plan === p);
    const cs = new Set(rs.map((r) => r.cell));
    const ns = [...cs].map((c) => cells.get(c) ?? 0);
    return `\`${p}\` ${cs.size} cells × ${Math.min(...ns)}${Math.max(...ns) !== Math.min(...ns) ? `–${Math.max(...ns)}` : ''} = ${rs.length}`;
  });
  const sessions = m?.sessions ?? [];
  const wall = sessions.reduce((a, x) => a + x.wallS, 0);
  const peakCpu = sessions.length ? Math.max(...sessions.map((x) => x.monitor.peakCpu)) : null;
  const peakRam = sessions.length ? Math.max(...sessions.map((x) => x.monitor.peakRam)) : null;
  const pauses = sessions.reduce((a, x) => a + x.monitor.pauses, 0);
  const shrinks = sessions.reduce((a, x) => a + x.monitor.shrinks, 0);
  const peakWorkers = sessions.length ? Math.max(...sessions.map((x) => x.peakWorkers)) : null;
  const ufcN = d.ufc.length;
  const title = inp.label ? `Calibration report — ${inp.label}` : 'Calibration report';
  const checkLine = (cs: CheckResult[]) => `${cs.filter((c) => c.verdict === 'PASS').length} pass · ${cs.filter((c) => c.verdict === 'FAIL').length} fail · ${cs.filter((c) => c.verdict === 'WIDE').length} wide · ${cs.filter((c) => c.verdict === 'NO DATA').length} no data (of ${cs.length})`;

  const lines: string[] = [
    `# ${title}`,
    '',
    inp.label?.toLowerCase().includes('post-tuning')
      ? '> **POST-TUNING REPORT (Phase 9).** The calibrated engine against the §7 targets, with the pre-tuning baseline alongside (the Δ column and the headline table below). What changed and why, the bugs fixed and the targets that could not be reached are in `docs/design/PHASE9_TUNING.md`. Rows whose confidence interval is still wider than the §6.6 rule allows are reported **WIDE** even when the estimate is on target.'
      : inp.label?.toLowerCase().includes('pre-tuning')
      ? '> **PRE-TUNING BASELINE.** Produced by the Phase 9 calibration infrastructure before any parameter was tuned, at modest bouts per cell, to prove the pipeline end to end and to give the tuning engineer a starting point. Most confidence intervals are wider than the §6.6 rule allows, so a row within tolerance is reported **WIDE**, not PASS. Nothing here is a sign-off.'
      : '> Generated by `scripts/calibrate/report.ts` from the run\'s `results.jsonl`.',
    '',
    `Generated by \`npm run calibrate:report -- ${inp.runDir ?? 'runs/<id>'}\`; every number below is recomputed from \`results.jsonl\` (run metadata from \`manifest.json\`). Targets and tolerances: docs/design/09 §7 (FIGHT_DATA §3).`,
    '',
    '## Run metadata',
    '',
    '| field | value |',
    '|---|---|',
    `| engine version | ${ev} |`,
    `| params hash | ${ph}${m?.paramOverrides && Object.keys(m.paramOverrides).length ? ` (overrides: ${Object.keys(m.paramOverrides).length})` : ' (defaults, no overrides)'} |`,
    `| plan seed(s) | \`${seeds}\` (bout seed = \`boutSeed(seed, cell, i)\`) |`,
    `| plans / bouts per cell | ${perPlan.join('; ')} |`,
    `| bouts | ${inp.rows.length.toLocaleString('en-US')} (master population: ${ufcN.toLocaleString('en-US')} T4 x T4 bouts across ${new Set(d.ufc.map((r) => r.tags.wc)).size} classes) |`,
    `| machine | ${m?.machine ? `${m.machine.cpuModel} · ${m.machine.cores} logical cores · ${m.machine.totalGB} GB · ${m.machine.platform} · Node ${m.machine.node}` : 'unknown (no manifest)'} |`,
    `| pool | ${m?.pool ? `target ${m.pool.target} (cpu budget ${m.pool.cpuBudget}, mem budget ${m.pool.memBudget} at ${m.pool.perWorkerMB} MB/worker, --max-workers ${m.pool.maxWorkers}), affinity 0x${m.pool.affinity}` : '—'}${peakWorkers !== null ? `; peak workers ${peakWorkers}` : ''} |`,
    `| wall time | ${sessions.length ? `${(wall / 60).toFixed(1)} min over ${sessions.length} session(s)` : '—'} |`,
    `| peak CPU / RAM (monitor, machine-wide) | ${peakCpu !== null ? `${(100 * peakCpu).toFixed(0)} % / ${(100 * peakRam!).toFixed(0)} %; ${pauses} pause(s), ${shrinks} shrink(s); cap 93 %` : '—'} |`,
    '',
    '## Status',
    '',
    `- **Master table (§7.1): passing ${passing(applicable)} / ${applicable.length} applicable rows** — core ${passing(byStatus('core'))}/${byStatus('core').length}, class ${passing(byStatus('class'))}/${byStatus('class').length}, proxy ${passing(byStatus('proxy'))}/${byStatus('proxy').length}. Verdicts: ${['PASS', 'FAIL', 'WIDE', 'NO DATA', 'N/A'].map((k) => `${k} ${vc[k] ?? 0}`).join(' · ')}.`,
    `- Measurability: ${measurable} of 129 rows have a metric function (${proxies} of them proxies, marked \`proxy\`); ${129 - measurable} are not measurable by this sim (reason in the row). NO DATA means the row's plan was not part of this run.`,
    `- Strategy checks (§7.2): ${checkLine(s)}.`,
    `- Tier checks (§7.3): ${checkLine(t)}.`,
    `- Edge-case QA (§7.4): ${q.filter((x) => x.verdict === 'PASS').length} pass · ${q.filter((x) => x.verdict === 'FAIL').length} fail · ${q.filter((x) => x.verdict === 'NO DATA').length} no data · ${q.filter((x) => x.verdict === 'N/A' || x.verdict === 'INFO').length} covered elsewhere / report-only (of ${q.length}).`,
    '',
    'Verdict rule (§6.6): **PASS** iff |sim − target| ≤ tolerance **and** the 95 % CI half-width ≤ tolerance / 2; **WIDE** = inside tolerance but the CI is too wide to call; **FAIL** = outside tolerance. `z = (sim − target) / tolerance`. `class` rows pass when ≥ 6 of 8 men\'s classes pass (and all but one women\'s class, where present). Pooled rows weight the 11 classes equally (women are 3/11 of the pool against roughly a fifth of real UFC bouts).',
    '',
    ...(baseResults ? headlineSection(results, baseResults) : []),
    '### Worst misses (core/proxy components, by |z|)',
    '',
    '| # | metric | component | sim | target | z |',
    '|---|---|---|---|---|---|',
    ...coreMisses.map(({ r, c }) => `| ${r.row.id} | ${esc(r.row.metric)} | ${esc(c.label)} | ${fmtVal(c.est.value, c.unit)} | ${fmtTarget(c)} | ${c.z!.toFixed(1)} |`),
    '',
    '## 1. Master target table (§7.1)',
    ...masterSection(results, base),
    '',
    '## 2. Strategy checks (§7.2)',
    '',
    ...checkSection(s),
    '',
    '## 3. Tier checks (§7.3)',
    '',
    ...checkSection(t),
    '',
    '## 4. Edge-case QA (§7.4)',
    '',
    ...qaSection(q),
    '',
    ...howToRun(inp.rows, m),
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function loadRun(dir: string): { rows: ResultRow[]; manifest?: Manifest } {
  const file = dir.endsWith('.jsonl') ? dir : join(dir, 'results.jsonl');
  if (!existsSync(file)) throw new Error(`no results at ${file}`);
  const rows = readResults(file);
  const mf = join(dir.endsWith('.jsonl') ? join(file, '..') : dir, 'manifest.json');
  const manifest = existsSync(mf) ? (JSON.parse(readFileSync(mf, 'utf8')) as Manifest) : undefined;
  return { rows, manifest };
}

function main(): void {
  const argv = process.argv.slice(2);
  const runDir = argv.find((a) => !a.startsWith('--'));
  const opt = (k: string): string | undefined => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (!runDir) {
    console.error('usage: npx tsx scripts/calibrate/report.ts runs/<id> [--out docs/CALIBRATION.md] [--baseline runs/<prev>] [--label "..."]');
    process.exit(2);
  }
  const { rows, manifest } = loadRun(runDir);
  const baseline = opt('baseline');
  const md = renderReport({
    rows, manifest, label: opt('label'), runDir,
    ...(baseline ? { baselineRows: loadRun(baseline).rows } : {}),
  });
  const out = opt('out') ?? join(runDir, 'CALIBRATION.md');
  writeFileSync(out, `${md}\n`);
  console.log(`wrote ${out} (${rows.length} bouts)`);
}

const invoked = process.argv[1] ? resolve(process.argv[1]).toLowerCase() : '';
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) main();
