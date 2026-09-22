/**
 * FIGHTER DATABASE — records, not definitions.
 *
 * A `FighterDefinition` is what the sim reads; a `FighterRecord` is what the
 * user owns. The difference is the bookkeeping the sim must never see: whether
 * a fighter is one of the fifteen built-in archetypes, when it was last
 * touched, its tags, and the denormalised `FighterSummary` the database screen
 * renders a few hundred rows from.
 *
 * Two rules shape everything below.
 *
 * **Built-ins stay pristine.** 01 §4's archetypes are calibration fixtures as
 * much as they are presets: `tests/fighter.test.ts` asserts numbers derived
 * from them. So an edit to a built-in never writes through — it clones the
 * definition into a fresh user record and edits that, exactly as a "duplicate
 * then modify" would, without making the user ask for it.
 *
 * **Ids are allocated against the live set.** Nothing here reaches for
 * `Math.random()` or a timestamp to make an id unique; a slug is suffixed with
 * the smallest integer that is free, which is collision-proof, readable, and
 * reproducible in a test.
 *
 * The module keeps a lazily loaded copy of the database so the screens can call
 * it like a store. Every mutation writes through `persist`, and a failed write
 * leaves the in-memory copy updated (09 §3.6): the user's edit is never undone
 * by a storage problem.
 */

import {
  ARCHETYPES, deriveRuntime, resolveParams,
  type FighterDefinition, type FighterRuntime, type ResolvedParams,
} from '../../sim';
import { loadFighters, saveFighters, type PersistResult } from './persist';
import type { FighterRecord, FighterSummary } from './types';

// --------------------------------------------------------------------------
// Derivation for the list view
// --------------------------------------------------------------------------

/**
 * One resolved parameter set for every `summarise` call. Resolving is the
 * expensive half of `deriveRuntime`; sharing it is what makes summarising a
 * few hundred fighters a list-render rather than a loading screen.
 */
let sharedParams: ResolvedParams | null = null;
function params(): ResolvedParams {
  if (sharedParams === null) sharedParams = resolveParams();
  return sharedParams;
}

/** `wc.light_heavyweight` -> `Light Heavyweight`. */
export function weightClassLabel(id: string): string {
  return id
    .replace(/^wc\./, '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function recordLineOf(def: FighterDefinition): string {
  const r = def.record;
  const pro = r.pro;
  const wins = pro?.wins ?? r.proWins;
  const losses = pro?.losses ?? r.proLosses;
  const draws = pro?.draws ?? r.proDraws;
  return draws > 0 ? `${wins}-${losses}-${draws}` : `${wins}-${losses}`;
}

/**
 * The list-view fields. Derives a runtime with `explain: false`, which skips
 * building the ~150 `derivation` strings the Model tab wants and is the whole
 * reason this is cheap enough to run over the database.
 */
export function summarise(def: FighterDefinition): FighterSummary {
  const rt = deriveRuntime(def, params(), { explain: false });
  return {
    name: def.name,
    short: def.short,
    recordLine: recordLineOf(def),
    weightClass: weightClassLabel(rt.body.weightClass),
    heightCm: Math.round(rt.body.heightM * 100),
    reachCm: Math.round(rt.body.reachM * 100),
    ageYears: Math.round(rt.body.ageYears),
    stance: rt.body.stance,
    topDiscipline: topDisciplineOf(rt),
    overallTier: rt.mmaTier,
  };
}

/** Highest discipline tier, ties broken by the higher sub-skill mean. */
function topDisciplineOf(rt: FighterRuntime): string {
  let best: { id: string; tier: number; mean: number } | null = null;
  for (const d of Object.values(rt.disciplines)) {
    if (!d.trained) continue;
    if (best === null || d.tier > best.tier || (d.tier === best.tier && d.mean > best.mean)) {
      best = { id: d.id, tier: d.tier, mean: d.mean };
    }
  }
  return best === null ? `T${rt.mmaTier} untrained` : `T${best.tier} ${best.id}`;
}

// --------------------------------------------------------------------------
// Ids and records
// --------------------------------------------------------------------------

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'fighter';

/**
 * The first id of the form `fighter.<slug>` (then `.2`, `.3`, …) that `taken`
 * does not contain. Deterministic, so a test can predict it and two calls in
 * the same millisecond cannot collide the way a timestamp id would.
 */
export function nextFighterId(taken: Iterable<string>, name: string): string {
  const used = taken instanceof Set ? taken : new Set(taken);
  const base = `fighter.${slug(name)}`;
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}.${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export interface RecordOptions {
  builtIn?: boolean;
  tags?: string[];
  /** Injected so a test can pin the timestamps; defaults to the wall clock. */
  nowIso?: string;
  createdAt?: string;
}

export function makeRecord(def: FighterDefinition, opts: RecordOptions = {}): FighterRecord {
  const now = opts.nowIso ?? new Date().toISOString();
  return {
    definition: def,
    builtIn: opts.builtIn ?? false,
    createdAt: opts.createdAt ?? now,
    updatedAt: now,
    tags: opts.tags ?? [],
    summary: summarise(def),
  };
}

/**
 * Add any built-in archetype the stored database is missing, and refresh the
 * ones it has. Refreshing matters because a built-in is defined by this build,
 * not by what an older build happened to save: if 01 §4 changes a preset, the
 * user's copy of the *built-in* must follow. Their edits are untouched — those
 * live in cloned user records with their own ids.
 */
export function seedBuiltIns(existing: readonly FighterRecord[], nowIso?: string): FighterRecord[] {
  const now = nowIso ?? new Date().toISOString();
  const out = existing.filter((r) => !r.builtIn || ARCHETYPES[r.definition.id] !== undefined);
  const byId = new Map(out.map((r) => [r.definition.id, r]));

  for (const [id, def] of Object.entries(ARCHETYPES)) {
    const prior = byId.get(id);
    if (prior && !prior.builtIn) continue; // A user record squatting the id wins.
    // Cloned, because `ARCHETYPES` is shared with the calibration tests: a
    // screen that edited `record.definition` in place would rewrite a fixture.
    const seeded = makeRecord(structuredCloneish(def), {
      builtIn: true,
      tags: prior?.tags ?? ['built-in'],
      nowIso: now,
      createdAt: prior?.createdAt ?? now,
    });
    if (prior) out[out.indexOf(prior)] = seeded;
    else out.push(seeded);
  }
  return out;
}

// --------------------------------------------------------------------------
// The store
// --------------------------------------------------------------------------

let db: FighterRecord[] | null = null;

/** Load (and seed) the database. Idempotent; later calls return the cache. */
export function loadDatabase(): FighterRecord[] {
  if (db === null) {
    const stored = loadFighters();
    const seeded = seedBuiltIns(stored);
    db = seeded;
    // Only persist when seeding actually changed something, so a read-only
    // page load does not write.
    if (stored.length !== seeded.length) saveFighters(seeded);
  }
  return db;
}

/** Drop the cache so the next call re-reads storage. For tests and "reset". */
export function unloadDatabase(): void {
  db = null;
  sharedParams = null;
}

export function allFighters(): FighterRecord[] {
  return loadDatabase().slice();
}

export function getFighter(id: string): FighterRecord | undefined {
  return loadDatabase().find((r) => r.definition.id === id);
}

function commit(): PersistResult {
  return saveFighters(loadDatabase());
}

export interface SaveOutcome {
  record: FighterRecord;
  /** True when the save cloned a built-in instead of editing it in place. */
  cloned: boolean;
  persisted: PersistResult;
}

/**
 * Create a fighter. The definition's own id is honoured when it is free,
 * otherwise a fresh one is allocated — the creator hands us whatever id the
 * blank template carried.
 */
export function createFighter(
  def: FighterDefinition, opts: RecordOptions = {},
): SaveOutcome {
  const records = loadDatabase();
  const taken = new Set(records.map((r) => r.definition.id));
  const id = def.id && !taken.has(def.id) ? def.id : nextFighterId(taken, def.name);
  const record = makeRecord({ ...def, id }, { ...opts, builtIn: false });
  records.push(record);
  return { record, cloned: false, persisted: commit() };
}

/**
 * Save an edited definition. Editing a built-in clones it: the archetype keeps
 * its id and its values, and the user gets a record of their own carrying the
 * edit.
 */
export function updateFighter(
  id: string, def: FighterDefinition, opts: RecordOptions = {},
): SaveOutcome {
  const records = loadDatabase();
  const index = records.findIndex((r) => r.definition.id === id);
  if (index === -1) return createFighter(def, opts);

  const prior = records[index];
  if (prior.builtIn) {
    const taken = new Set(records.map((r) => r.definition.id));
    const clonedId = nextFighterId(taken, def.name);
    const record = makeRecord(
      { ...def, id: clonedId, name: def.name },
      { ...opts, builtIn: false, tags: opts.tags ?? prior.tags.filter((t) => t !== 'built-in') },
    );
    records.push(record);
    return { record, cloned: true, persisted: commit() };
  }

  const record = makeRecord({ ...def, id }, {
    ...opts,
    builtIn: false,
    createdAt: prior.createdAt,
    tags: opts.tags ?? prior.tags,
  });
  records[index] = record;
  return { record, cloned: false, persisted: commit() };
}

/** Built-ins cannot be deleted; they would reappear on the next seed anyway. */
export function deleteFighter(id: string): boolean {
  const records = loadDatabase();
  const index = records.findIndex((r) => r.definition.id === id);
  if (index === -1 || records[index].builtIn) return false;
  records.splice(index, 1);
  commit();
  return true;
}

export function duplicateFighter(id: string, opts: RecordOptions = {}): SaveOutcome | undefined {
  const source = getFighter(id);
  if (source === undefined) return undefined;
  const records = loadDatabase();
  const taken = new Set(records.map((r) => r.definition.id));
  const name = `${source.definition.name} (copy)`;
  const def = { ...structuredCloneish(source.definition), id: nextFighterId(taken, name), name };
  const record = makeRecord(def, { ...opts, builtIn: false, tags: opts.tags ?? source.tags });
  records.push(record);
  return { record, cloned: true, persisted: commit() };
}

export function setTags(id: string, tags: string[], nowIso?: string): FighterRecord | undefined {
  const records = loadDatabase();
  const index = records.findIndex((r) => r.definition.id === id);
  if (index === -1) return undefined;
  records[index] = { ...records[index], tags, updatedAt: nowIso ?? new Date().toISOString() };
  commit();
  return records[index];
}

/**
 * A definition is plain JSON by contract (01), so this round-trip is a deep
 * clone that also proves the contract on every duplicate.
 */
function structuredCloneish<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// --------------------------------------------------------------------------
// Search, filter, sort
// --------------------------------------------------------------------------

export interface FighterFilter {
  /** Matched against name, short, nickname, tags and the top discipline. */
  query?: string;
  tags?: string[];
  weightClasses?: string[];
  stances?: string[];
  minTier?: number;
  maxTier?: number;
  builtIn?: boolean;
}

export type FighterSortKey = 'name' | 'tier' | 'weight' | 'age' | 'reach' | 'height' | 'updated' | 'record';

export function matchesFilter(record: FighterRecord, filter: FighterFilter): boolean {
  const s = record.summary;
  if (filter.builtIn !== undefined && record.builtIn !== filter.builtIn) return false;
  if (filter.minTier !== undefined && s.overallTier < filter.minTier) return false;
  if (filter.maxTier !== undefined && s.overallTier > filter.maxTier) return false;
  if (filter.weightClasses?.length && !filter.weightClasses.includes(s.weightClass)) return false;
  if (filter.stances?.length && !filter.stances.includes(s.stance)) return false;
  if (filter.tags?.length && !filter.tags.every((t) => record.tags.includes(t))) return false;

  const q = filter.query?.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    s.name, s.short, s.topDiscipline, s.weightClass, record.definition.appearance?.nickname ?? '',
    ...record.tags,
  ].join(' ').toLowerCase();
  // Every whitespace-separated term must appear, so "elite wrestler" narrows
  // rather than widening the way an OR would.
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

export function searchFighters(records: readonly FighterRecord[], filter: FighterFilter): FighterRecord[] {
  return records.filter((r) => matchesFilter(r, filter));
}

const winsOf = (r: FighterRecord): number => r.definition.record.pro?.wins ?? r.definition.record.proWins;

export function sortFighters(
  records: readonly FighterRecord[], key: FighterSortKey, descending = false,
): FighterRecord[] {
  const cmp: Record<FighterSortKey, (a: FighterRecord, b: FighterRecord) => number> = {
    name: (a, b) => a.summary.name.localeCompare(b.summary.name),
    tier: (a, b) => a.summary.overallTier - b.summary.overallTier,
    weight: (a, b) => a.definition.body.massKg - b.definition.body.massKg,
    age: (a, b) => a.summary.ageYears - b.summary.ageYears,
    reach: (a, b) => a.summary.reachCm - b.summary.reachCm,
    height: (a, b) => a.summary.heightCm - b.summary.heightCm,
    updated: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
    record: (a, b) => winsOf(a) - winsOf(b),
  };
  const sorted = [...records].sort((a, b) => {
    const d = cmp[key](a, b);
    // Name is the tiebreak everywhere, so a re-sort is stable to look at.
    return d !== 0 ? d : a.summary.name.localeCompare(b.summary.name);
  });
  return descending ? sorted.reverse() : sorted;
}

/** Every tag in use, for the filter bar's chips. */
export function allTags(records: readonly FighterRecord[]): string[] {
  const seen = new Set<string>();
  for (const r of records) for (const t of r.tags) seen.add(t);
  return [...seen].sort();
}
