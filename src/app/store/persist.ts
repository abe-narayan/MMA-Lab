/**
 * PERSISTENCE — localStorage, defensively (09 §3.6).
 *
 * localStorage is the least reliable dependency in the app: it is absent under
 * Node and in the test runner, it throws on `getItem` in a locked-down browser,
 * and it throws on `setItem` the moment a few fat replays fill the 5 MB quota.
 * None of that may ever cost the user their in-memory state, so this module
 * obeys three rules:
 *
 *   1. every call into storage is wrapped; a failed read returns the default,
 *      a failed write returns `ok: false` and the caller carries on;
 *   2. everything written is mirrored in memory first, so a session with no
 *      usable storage still behaves like a session with one — it just forgets
 *      on reload;
 *   3. a quota failure evicts the oldest *replay bodies* from history before
 *      anything else, because a replay is regenerable from its seed while a
 *      fighter the user spent twenty minutes building is not.
 *
 * The backend is injectable so the quota and failure paths can be tested; with
 * nothing injected it probes `globalThis.localStorage` once.
 */

import type { ArenaId, MatchSettings, ReplayFileV4, RulesetId } from '../../sim';
import { DEFAULT_SETTINGS } from '../../sim';
import { STORAGE_KEYS, type FighterRecord, type HistoryEntry, type MatchupPreset, type Tournament } from './types';

/** The two methods this module needs; `localStorage` satisfies it structurally. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PersistResult {
  ok: boolean;
  /** How many replay bodies had to be evicted to make the write fit. */
  evicted: number;
  reason?: 'unavailable' | 'quota' | 'serialise';
  error?: string;
}

/** History keeps full replays for the last 50 bouts (09 §3.5). */
export const HISTORY_FULL_REPLAYS = 50;
/** Beyond this, stubs are dropped oldest-first; the list view never needs more. */
export const HISTORY_MAX_ENTRIES = 500;
/** Eviction rounds before a write is declared hopeless. */
const MAX_EVICTIONS = 200;

// --------------------------------------------------------------------------
// App settings (the `boutlab.v1.settings` document)
// --------------------------------------------------------------------------

export interface AppSettings {
  schemaVersion: 1;
  theme: 'dark' | 'light' | 'system';
  defaultRuleset: RulesetId;
  defaultArena: ArenaId;
  /** Starting point for a new matchup; the match screen may override it. */
  defaultMatchSettings: MatchSettings;
  /** Show `FighterRuntime.derivation` in the creator's model tab. */
  showDerivation: boolean;
  confirmDestructive: boolean;
  /** Prefix for generated bout seeds, so a user's runs are distinguishable. */
  seedPrefix: string;
  lastFighterId?: string;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  schemaVersion: 1,
  theme: 'dark',
  defaultRuleset: 'mma.unified.3r',
  defaultArena: 'octagon_30',
  defaultMatchSettings: { ...DEFAULT_SETTINGS },
  showDerivation: true,
  confirmDestructive: true,
  seedPrefix: 'boutlab',
};

// --------------------------------------------------------------------------
// Backend
// --------------------------------------------------------------------------

/** `undefined` = not yet probed, `null` = probed and unusable. */
let backend: StorageLike | null | undefined;
const mirror = new Map<string, string>();

/** Inject a backend (tests, or a future IndexedDB adapter). `null` disables storage. */
export function setStorage(next: StorageLike | null): void {
  backend = next;
}

/** Forget the injected backend and the in-memory mirror. For test isolation. */
export function resetStorage(): void {
  backend = undefined;
  mirror.clear();
}

function storage(): StorageLike | null {
  if (backend !== undefined) return backend;
  try {
    const ls = (globalThis as { localStorage?: StorageLike }).localStorage;
    // Touching the object is not enough: Safari's private mode only throws on
    // the first write, so probe with one.
    if (ls) {
      const probe = `${STORAGE_KEYS.settings}.probe`;
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      backend = ls;
    } else {
      backend = null;
    }
  } catch {
    backend = null;
  }
  return backend;
}

export function isStorageAvailable(): boolean {
  return storage() !== null;
}

// --------------------------------------------------------------------------
// Raw read / write
// --------------------------------------------------------------------------

function readRaw(key: string): string | null {
  const s = storage();
  if (s) {
    try {
      const v = s.getItem(key);
      if (v !== null) return v;
    } catch {
      // Fall through to the mirror: a read that throws is a disabled store,
      // not a missing value.
    }
  }
  return mirror.get(key) ?? null;
}

/**
 * Parse a stored document, falling back to `fallback` for anything unusable.
 * Corrupt JSON is dropped rather than repaired — the export file is the
 * migration path, not a half-decoded localStorage string.
 */
function read<T>(key: string, fallback: T, accept: (v: unknown) => boolean): T {
  const raw = readRaw(key);
  if (raw === null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return accept(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): PersistResult {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch (err) {
    return { ok: false, evicted: 0, reason: 'serialise', error: String(err) };
  }

  // Rule 2: the mirror is updated before storage is even attempted, so the
  // session keeps working whatever localStorage does next.
  mirror.set(key, json);

  const s = storage();
  if (!s) return { ok: false, evicted: 0, reason: 'unavailable' };

  let evicted = 0;
  let last = '';
  for (let attempt = 0; attempt <= MAX_EVICTIONS; attempt++) {
    try {
      s.setItem(key, json);
      return { ok: true, evicted };
    } catch (err) {
      last = String(err);
      const relief = relieveQuota(s, key, json);
      if (!relief.freed) break;
      evicted++;
      if (relief.json !== undefined) {
        json = relief.json;
        mirror.set(key, json);
      }
    }
  }
  return { ok: false, evicted, reason: 'quota', error: last };
}

function remove(key: string): void {
  mirror.delete(key);
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(key);
  } catch {
    // Nothing useful to do; the mirror is already clear.
  }
}

// --------------------------------------------------------------------------
// Quota relief
// --------------------------------------------------------------------------

/** A stub keeps the bout identifiable and re-simulatable: seed, digest, one line. */
type ReplayStub = { seed: string; digest: string; summary: string };

function isFullReplay(replay: HistoryEntry['replay']): replay is ReplayFileV4 {
  return typeof replay === 'object' && replay !== null && (replay as { format?: unknown }).format === 4;
}

export function summariseReplay(entry: HistoryEntry): string {
  const r = entry.result;
  const who = typeof r?.winner === 'number' ? entry.fighterNames[r.winner] ?? `fighter ${r.winner}` : String(r?.winner ?? 'unknown');
  const names = entry.fighterNames.join(' vs ');
  const time = r ? `R${r.round} ${Math.floor(r.timeSeconds / 60)}:${String(Math.floor(r.timeSeconds % 60)).padStart(2, '0')}` : '';
  return `${names} — ${who} by ${r?.method ?? 'unknown'} ${time}`.trim();
}

function stubOf(entry: HistoryEntry): ReplayStub {
  const replay = entry.replay;
  return {
    seed: isFullReplay(replay) ? replay.seed : (replay as ReplayStub).seed ?? '',
    digest: isFullReplay(replay) ? replay.digest : (replay as ReplayStub).digest ?? '',
    summary: summariseReplay(entry),
  };
}

/** Index of the oldest entry matching `pick`, or -1. */
function oldestIndex(entries: HistoryEntry[], pick: (e: HistoryEntry) => boolean): number {
  let best = -1;
  for (let i = 0; i < entries.length; i++) {
    if (!pick(entries[i])) continue;
    if (best === -1 || (entries[i].playedAt ?? '') < (entries[best].playedAt ?? '')) best = i;
  }
  return best;
}

interface Relief {
  freed: boolean;
  /** Set when the document being written *is* history and was itself shrunk. */
  json?: string;
}

/**
 * Free space for a failing write. Replay bodies go first (they regenerate from
 * `seed`), then whole stub entries, oldest first. Fighters, presets,
 * tournaments and settings are never touched: losing one of those is the
 * failure this whole module exists to prevent.
 */
function relieveQuota(s: StorageLike, key: string, json: string): Relief {
  const writingHistory = key === STORAGE_KEYS.history;
  let entries: HistoryEntry[];
  try {
    // The mirror wins over storage here. A relief write can itself be refused
    // for quota, leaving the fat original in storage; reading that back would
    // evict the same entry forever instead of making progress.
    const source = writingHistory
      ? json
      : mirror.get(STORAGE_KEYS.history) ?? readRaw(STORAGE_KEYS.history);
    if (source === null) return { freed: false };
    const parsed: unknown = JSON.parse(source);
    if (!Array.isArray(parsed)) return { freed: false };
    entries = parsed as HistoryEntry[];
  } catch {
    return { freed: false };
  }

  const full = oldestIndex(entries, (e) => isFullReplay(e.replay));
  if (full !== -1) {
    entries[full] = { ...entries[full], replay: stubOf(entries[full]) };
  } else {
    const any = oldestIndex(entries, () => true);
    if (any === -1) return { freed: false };
    entries.splice(any, 1);
  }

  let next: string;
  try {
    next = JSON.stringify(entries);
  } catch {
    return { freed: false };
  }

  if (writingHistory) return { freed: true, json: next };

  mirror.set(STORAGE_KEYS.history, next);
  try {
    s.setItem(STORAGE_KEYS.history, next);
  } catch {
    // The shrunken history did not fit either; the caller retries and we will
    // shrink again on the next pass.
  }
  return { freed: true };
}

/**
 * Apply the standing history policy before a write: newest 50 keep their
 * replay, the rest become stubs, and anything past `HISTORY_MAX_ENTRIES` is
 * dropped. Doing this on save is what keeps the quota path rare.
 */
export function trimHistory(entries: readonly HistoryEntry[]): HistoryEntry[] {
  const byNewest = [...entries].sort((a, b) => (b.playedAt ?? '').localeCompare(a.playedAt ?? ''));
  const kept = byNewest.slice(0, HISTORY_MAX_ENTRIES);
  return kept.map((e, i) => (i < HISTORY_FULL_REPLAYS || !isFullReplay(e.replay) ? e : { ...e, replay: stubOf(e) }));
}

// --------------------------------------------------------------------------
// Documents
// --------------------------------------------------------------------------

const isArray = (v: unknown): boolean => Array.isArray(v);

export function loadFighters(): FighterRecord[] {
  return read<FighterRecord[]>(STORAGE_KEYS.fighters, [], isArray);
}

export function saveFighters(records: readonly FighterRecord[]): PersistResult {
  return write(STORAGE_KEYS.fighters, records);
}

export function loadPresets(): MatchupPreset[] {
  return read<MatchupPreset[]>(STORAGE_KEYS.presets, [], isArray);
}

export function savePresets(presets: readonly MatchupPreset[]): PersistResult {
  return write(STORAGE_KEYS.presets, presets);
}

export function loadHistory(): HistoryEntry[] {
  return read<HistoryEntry[]>(STORAGE_KEYS.history, [], isArray);
}

export function saveHistory(entries: readonly HistoryEntry[]): PersistResult {
  return write(STORAGE_KEYS.history, trimHistory(entries));
}

export function loadTournaments(): Tournament[] {
  return read<Tournament[]>(STORAGE_KEYS.tournaments, [], isArray);
}

export function saveTournaments(tournaments: readonly Tournament[]): PersistResult {
  return write(STORAGE_KEYS.tournaments, tournaments);
}

export function loadSettings(): AppSettings {
  const stored = read<Partial<AppSettings>>(
    STORAGE_KEYS.settings,
    {},
    (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
  );
  // Merged rather than replaced so a settings field added in a later build
  // takes its default instead of becoming `undefined`.
  return {
    ...DEFAULT_APP_SETTINGS,
    ...stored,
    defaultMatchSettings: { ...DEFAULT_APP_SETTINGS.defaultMatchSettings, ...(stored.defaultMatchSettings ?? {}) },
  };
}

export function saveSettings(settings: AppSettings): PersistResult {
  return write(STORAGE_KEYS.settings, settings);
}

/** Wipe every Bout Lab key. The built-ins are re-seeded on the next load. */
export function clearAll(): void {
  for (const key of Object.values(STORAGE_KEYS)) remove(key);
}
