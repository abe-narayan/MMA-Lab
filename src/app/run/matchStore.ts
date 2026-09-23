/**
 * THE MATCH-SIDE STORE SURFACE.
 *
 * Same idea as `storeApi.ts` and for the same reason: the screens are written
 * against an interface, `App.tsx` binds the concrete module, and the tests get
 * a working store without a `localStorage` by passing the in-memory
 * implementation below.
 *
 * Everything here is additive over `src/app/store` — it reads and writes the
 * documents 09 §3.6 already defines (`boutlab.v1.history`,
 * `boutlab.v1.tournaments`, `boutlab.v1.presets`) through the persistence
 * layer's own guarded helpers, so the quota policy and the eviction rules
 * still apply exactly as they were written.
 */

import {
  loadHistory, saveHistory, loadPresets, savePresets, loadTournaments, saveTournaments,
  loadSettings, saveSettings, type AppSettings, type PersistResult,
} from '../store';
import type { HistoryEntry, MatchupPreset, Tournament } from '../store/types';

export interface MatchStoreApi {
  history(): HistoryEntry[];
  /** Insert or replace by id. Newest first is the screen's job, not the store's. */
  putHistory(entry: HistoryEntry): PersistResult;
  removeHistory(id: string): PersistResult;
  clearHistory(): PersistResult;

  tournaments(): Tournament[];
  putTournament(t: Tournament): PersistResult;
  removeTournament(id: string): PersistResult;

  presets(): MatchupPreset[];
  putPreset(p: MatchupPreset): PersistResult;
  removePreset(id: string): PersistResult;

  appSettings(): AppSettings;
  putAppSettings(s: AppSettings): PersistResult;
}

const upsert = <T extends { id: string }>(list: T[], item: T): T[] => {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [item, ...list];
  const next = [...list];
  next[i] = item;
  return next;
};

/** The real thing: everything goes through `src/app/store/persist`. */
export function bindMatchStore(): MatchStoreApi {
  return {
    history: () => loadHistory(),
    putHistory: (entry) => saveHistory(upsert(loadHistory(), entry)),
    removeHistory: (id) => saveHistory(loadHistory().filter((e) => e.id !== id)),
    clearHistory: () => saveHistory([]),

    tournaments: () => loadTournaments(),
    putTournament: (t) => saveTournaments(upsert(loadTournaments(), t)),
    removeTournament: (id) => saveTournaments(loadTournaments().filter((t) => t.id !== id)),

    presets: () => loadPresets(),
    putPreset: (p) => savePresets(upsert(loadPresets(), p)),
    removePreset: (id) => savePresets(loadPresets().filter((p) => p.id !== id)),

    appSettings: () => loadSettings(),
    putAppSettings: (s) => saveSettings(s),
  };
}

/**
 * An in-memory store. Used by the tests and by a session whose storage is
 * unavailable *and* whose mirror has been reset — it behaves identically,
 * it just forgets on reload.
 */
export function memoryMatchStore(initial: Partial<{
  history: HistoryEntry[];
  tournaments: Tournament[];
  presets: MatchupPreset[];
  settings: AppSettings;
}> = {}): MatchStoreApi {
  let history = initial.history ?? [];
  let tournaments = initial.tournaments ?? [];
  let presets = initial.presets ?? [];
  let settings = initial.settings;
  const ok: PersistResult = { ok: true, evicted: 0 };

  return {
    history: () => history,
    putHistory: (entry) => {
      history = upsert(history, entry);
      return ok;
    },
    removeHistory: (id) => {
      history = history.filter((e) => e.id !== id);
      return ok;
    },
    clearHistory: () => {
      history = [];
      return ok;
    },

    tournaments: () => tournaments,
    putTournament: (t) => {
      tournaments = upsert(tournaments, t);
      return ok;
    },
    removeTournament: (id) => {
      tournaments = tournaments.filter((t) => t.id !== id);
      return ok;
    },

    presets: () => presets,
    putPreset: (p) => {
      presets = upsert(presets, p);
      return ok;
    },
    removePreset: (id) => {
      presets = presets.filter((p) => p.id !== id);
      return ok;
    },

    appSettings: () => settings ?? loadSettings(),
    putAppSettings: (s) => {
      settings = s;
      return ok;
    },
  };
}
