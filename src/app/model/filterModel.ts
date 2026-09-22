/**
 * DATABASE FILTERING — pure, so the list view is a render of a query result.
 *
 * The screen holds one `DatabaseQuery` in state and derives the visible rows
 * from it. No row is hidden by a side effect, which means the "showing 9 of 41"
 * line can never disagree with the table, and the whole thing is testable
 * without a DOM.
 */

import type { CoreDisciplineId } from '../../sim';
import type { FighterRecord } from '../store/types';

export type OriginFilter = 'all' | 'builtIn' | 'custom';
export type SortKey = 'name' | 'tier' | 'weight' | 'age' | 'reach' | 'updated';
export type SortDir = 'asc' | 'desc';

export interface DatabaseQuery {
  /** Free text, matched against name, nickname, short code and tags. */
  search: string;
  discipline: 'all' | CoreDisciplineId;
  /** Minimum overall tier, or 'all'. */
  tier: 'all' | 0 | 1 | 2 | 3 | 4 | 5;
  weightClass: string;
  origin: OriginFilter;
  sort: SortKey;
  dir: SortDir;
}

export const EMPTY_QUERY: DatabaseQuery = Object.freeze({
  search: '',
  discipline: 'all',
  tier: 'all',
  weightClass: 'all',
  origin: 'all',
  sort: 'name',
  dir: 'asc',
});

export const SORT_LABELS: Readonly<Record<SortKey, string>> = Object.freeze({
  name: 'Name',
  tier: 'Overall tier',
  weight: 'Weight class',
  age: 'Age',
  reach: 'Reach',
  updated: 'Last edited',
});

function haystack(r: FighterRecord): string {
  const def = r.definition;
  return [
    def.name,
    def.short,
    def.appearance?.nickname ?? '',
    def.notes ?? '',
    r.summary.topDiscipline,
    ...r.tags,
  ]
    .join(' ')
    .toLowerCase();
}

/** True when the record trains `id` at all (a block exists for it). */
export function trainsDiscipline(r: FighterRecord, id: CoreDisciplineId): boolean {
  const block = r.definition.disciplines[id];
  return block !== undefined && (block.years ?? 0) >= 0;
}

export function matchesQuery(r: FighterRecord, q: DatabaseQuery): boolean {
  const search = q.search.trim().toLowerCase();
  if (search.length > 0 && !haystack(r).includes(search)) return false;
  if (q.origin === 'builtIn' && !r.builtIn) return false;
  if (q.origin === 'custom' && r.builtIn) return false;
  if (q.discipline !== 'all' && !trainsDiscipline(r, q.discipline)) return false;
  // Tier filters as a floor rather than an exact match: "show me T4 and up" is
  // the question a matchmaker actually asks.
  if (q.tier !== 'all' && r.summary.overallTier < q.tier) return false;
  if (q.weightClass !== 'all' && r.summary.weightClass !== q.weightClass) return false;
  return true;
}

function compare(a: FighterRecord, b: FighterRecord, key: SortKey): number {
  switch (key) {
    case 'name':
      return a.summary.name.localeCompare(b.summary.name);
    case 'tier':
      return a.summary.overallTier - b.summary.overallTier;
    case 'age':
      return a.summary.ageYears - b.summary.ageYears;
    case 'reach':
      return a.summary.reachCm - b.summary.reachCm;
    case 'weight':
      return a.summary.weightClass.localeCompare(b.summary.weightClass);
    case 'updated':
      return a.updatedAt.localeCompare(b.updatedAt);
    default:
      return 0;
  }
}

export function applyQuery(records: readonly FighterRecord[], q: DatabaseQuery): FighterRecord[] {
  const out = records.filter((r) => matchesQuery(r, q));
  const sign = q.dir === 'asc' ? 1 : -1;
  // Name is the tiebreak on every sort so the order is total and therefore
  // stable across reloads — a list that reshuffles itself is unusable.
  out.sort((a, b) => {
    const primary = compare(a, b, q.sort) * sign;
    return primary !== 0 ? primary : a.summary.name.localeCompare(b.summary.name);
  });
  return out;
}

/** The weight classes actually present, so the filter never offers an empty one. */
export function weightClassesPresent(records: readonly FighterRecord[]): string[] {
  const seen = new Set<string>();
  for (const r of records) seen.add(r.summary.weightClass);
  return Array.from(seen).sort();
}
