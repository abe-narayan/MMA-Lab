/**
 * The loaded run, with the populations the metrics read.
 *
 * `ufc` is the §7.1 master population: T4 vs T4 bouts of the `baseline` (or
 * `ufc_population`) plan, 8 men's and 3 women's classes, `mma.unified.3r`,
 * `octagon_30`, standard referee, hidden unified judging. Pooled rows use all
 * of it (cells are equal-sized, so women are 3/11 of the pool against roughly
 * a fifth of real UFC bouts — stated in the report); per-class rows filter it.
 */
import type { FighterRow, ResultRow } from '../batch/types';

export const MEN_CODES = ['FLW', 'BW', 'FW', 'LW', 'WW', 'MW', 'LHW', 'HW'] as const;
export const WOMEN_CODES = ['W-SW', 'W-FLW', 'W-BW'] as const;

export const isKoTko = (m: string): boolean => m === 'ko' || m.startsWith('tko');
export const isSub = (m: string): boolean => m.startsWith('submission');
export const isDec = (m: string): boolean => m.startsWith('decision');
export const isDraw = (m: string): boolean => m.startsWith('draw');
export const isFinish = (m: string): boolean => isKoTko(m) || isSub(m);
export const isOther = (m: string): boolean => !isKoTko(m) && !isSub(m) && !isDec(m);

/** Fight minutes of a bout. */
export const fmin = (r: ResultRow): number => r.res.fs / 60;

export interface FighterUnit {
  row: ResultRow;
  idx: number;
  f: FighterRow;
  opp: FighterRow;
  won: boolean;
  lost: boolean;
}

export class Dataset {
  readonly ufc: ResultRow[];
  readonly men: ResultRow[];
  readonly women: ResultRow[];
  private readonly byCellPrefix = new Map<string, ResultRow[]>();

  constructor(readonly all: readonly ResultRow[]) {
    this.ufc = all.filter((r) => r.tags.group === 'ufc' && r.tags.mode === '1v1');
    this.men = this.ufc.filter((r) => r.tags.sex === 'male');
    this.women = this.ufc.filter((r) => r.tags.sex === 'female');
  }

  byClass(code: string): ResultRow[] {
    return this.ufc.filter((r) => r.tags.wc === code);
  }

  plan(id: string): ResultRow[] {
    return this.all.filter((r) => r.tags.plan === id);
  }

  /** Rows whose cell id starts with `prefix` (memoised). */
  cell(prefix: string): ResultRow[] {
    let v = this.byCellPrefix.get(prefix);
    if (!v) {
      v = this.all.filter((r) => r.cell === prefix || r.cell.startsWith(prefix));
      this.byCellPrefix.set(prefix, v);
    }
    return v;
  }

  /** tier_matrix cell TaxTb. */
  tiers(a: number, b: number): ResultRow[] {
    return this.cell(`tier_matrix/T${a}xT${b}`);
  }

  /** physical_sweeps cell for one variable and value. */
  sweep(v: string, val: number | string): ResultRow[] {
    return this.all.filter((r) => r.tags.plan === 'physical_sweeps' && r.tags.sweepVar === v && String(r.tags.sweepVal) === String(val));
  }
}

/** Both fighters of every 1v1 bout. */
export function fighterUnits(rows: readonly ResultRow[]): FighterUnit[] {
  const out: FighterUnit[] = [];
  for (const row of rows) {
    if (row.f.length !== 2) continue;
    for (let idx = 0; idx < 2; idx++) {
      out.push({
        row, idx, f: row.f[idx], opp: row.f[1 - idx],
        won: row.res.w === idx, lost: row.res.w === 1 - idx,
      });
    }
  }
  return out;
}

/** Position x target accessor into `FighterRow.pt`. */
const PH = { distance: 0, clinch: 1, ground: 2 } as const;
const TG = { head: 0, body: 1, leg: 2 } as const;
export type PhaseKey = keyof typeof PH;
export type TargetKey = keyof typeof TG;

export function ptLA(f: FighterRow, ph: PhaseKey | null, tg: TargetKey | null): [number, number] {
  let l = 0;
  let a = 0;
  for (const p of Object.keys(PH) as PhaseKey[]) {
    if (ph !== null && p !== ph) continue;
    for (const t of Object.keys(TG) as TargetKey[]) {
      if (tg !== null && t !== tg) continue;
      const k = (PH[p] * 3 + TG[t]) * 2;
      l += f.pt[k];
      a += f.pt[k + 1];
    }
  }
  return [l, a];
}

/** Winner's `[winner, loser]` fighter rows for a decided 1v1 bout, else null. */
export function winLose(r: ResultRow): [FighterRow, FighterRow] | null {
  if (r.f.length !== 2 || typeof r.res.w !== 'number') return null;
  const w = r.res.w;
  if (w !== 0 && w !== 1) return null;
  return [r.f[w], r.f[1 - w]];
}

/** Sum of the judges' per-fighter points over rounds `1..upto` (true cards). */
export function cardTotals(r: ResultRow, upto: number): [number, number] | null {
  if (!r.cards || r.cards.length === 0) return null;
  let a = 0;
  let b = 0;
  let any = false;
  for (const judge of r.cards) {
    for (let k = 0; k < Math.min(upto, judge.length); k++) {
      const pts = judge[k];
      if (!pts || pts.length < 2) continue;
      a += pts[0];
      b += pts[1];
      any = true;
    }
  }
  if (!any) return null;
  return [a, b];
}
