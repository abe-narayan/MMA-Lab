/**
 * REPLAY LIBRARY — many saved bouts, listed without loading them
 * (Watch/replay pass).
 *
 * localStorage (the app store, 09 §3.6) holds at most ~5 MB and must parse its
 * whole history document to list it, so saved replays live in IndexedDB
 * instead, in two object stores:
 *
 *   meta   one small record per replay (names, result line, date, size,
 *          digest, engine) — `list()` reads only this;
 *   blobs  the archive bytes (`archive.ts`), read by `get(id)` when opened.
 *
 * The id is derived from the digest, so saving the same bout twice replaces
 * it. `MAX_ENTRIES` bounds the library (oldest dropped first), and only the
 * newest `MAX_CACHED` entries keep their instant-open frame cache; older ones
 * are re-encoded to the portable profile, which re-simulates on open.
 *
 * Without IndexedDB (tests, locked-down browsers) the same API runs on an
 * in-memory backend: the session still works, it forgets on reload.
 */
import type { ReplayFileV4 } from '../../sim';

export const LIBRARY_DB = 'boutlab-replays';
export const LIBRARY_DB_VERSION = 1;
export const MAX_ENTRIES = 300;

export interface ReplayMeta {
  id: string;
  /** ISO time of saving (wall clock is allowed in saved data, 09 §3.6). */
  savedAt: string;
  label: string;
  fighterNames: string[];
  /** e.g. "KO/TKO · R2 1:43 · Silva". */
  resultLine: string;
  seed: string;
  digest: string;
  engineVersion: string;
  ticks: number;
  bytes: number;
  profile: 'portable' | 'library';
}

export interface LibraryBackend {
  list(): Promise<ReplayMeta[]>;
  get(id: string): Promise<Uint8Array | null>;
  put(meta: ReplayMeta, bytes: Uint8Array): Promise<void>;
  remove(id: string): Promise<void>;
}

export function replayId(file: Pick<ReplayFileV4, 'digest' | 'seed'>): string {
  return `r.${file.digest.slice(0, 16)}.${file.seed.length.toString(36)}`;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function resultLine(file: ReplayFileV4): string {
  const r = file.result as { winner?: number | string; method?: string; round?: number; timeSeconds?: number };
  const winner = typeof r.winner === 'number' ? file.fighters[r.winner]?.short ?? `F${r.winner}` : String(r.winner ?? '');
  const when = r.round !== undefined && r.timeSeconds !== undefined ? ` · R${r.round} ${clock(r.timeSeconds)}` : '';
  return `${(r.method ?? 'result').toUpperCase()}${when}${winner && winner !== 'undefined' ? ` · ${winner}` : ''}`;
}

export function metaFor(file: ReplayFileV4, bytes: number, profile: ReplayMeta['profile'], savedAt: string, label?: string): ReplayMeta {
  return {
    id: replayId(file),
    savedAt,
    label: label ?? file.meta?.label ?? file.fighters.map((f) => f.short).join(' vs '),
    fighterNames: file.fighters.map((f) => f.name),
    resultLine: resultLine(file),
    seed: file.seed,
    digest: file.digest,
    engineVersion: file.engineVersion,
    ticks: file.ticks,
    bytes,
    profile,
  };
}

// ---------------------------------------------------------------------------
// In-memory backend
// ---------------------------------------------------------------------------

export function memoryLibrary(): LibraryBackend {
  const meta = new Map<string, ReplayMeta>();
  const blobs = new Map<string, Uint8Array>();
  return {
    async list() {
      return [...meta.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    },
    async get(id) {
      const b = blobs.get(id);
      return b ? b.slice() : null;
    },
    async put(m, bytes) {
      meta.set(m.id, { ...m });
      blobs.set(m.id, bytes.slice());
    },
    async remove(id) {
      meta.delete(id);
      blobs.delete(id);
    },
  };
}

// ---------------------------------------------------------------------------
// IndexedDB backend
// ---------------------------------------------------------------------------

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export function indexedDbLibrary(factory: IDBFactory = indexedDB): LibraryBackend {
  let dbp: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    if (!dbp) {
      dbp = new Promise((resolve, reject) => {
        const r = factory.open(LIBRARY_DB, LIBRARY_DB_VERSION);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error ?? new Error('IndexedDB open failed'));
        r.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
      });
      dbp.catch(() => { dbp = null; });
    }
    return dbp;
  };
  return {
    async list() {
      const db = await open();
      const all = await req(db.transaction('meta', 'readonly').objectStore('meta').getAll() as IDBRequest<ReplayMeta[]>);
      return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    },
    async get(id) {
      const db = await open();
      const v = await req(db.transaction('blobs', 'readonly').objectStore('blobs').get(id) as IDBRequest<unknown>);
      if (v instanceof Uint8Array) return v;
      if (v instanceof ArrayBuffer) return new Uint8Array(v);
      return null;
    },
    async put(m, bytes) {
      const db = await open();
      const tx = db.transaction(['meta', 'blobs'], 'readwrite');
      tx.objectStore('blobs').put(bytes, m.id);
      tx.objectStore('meta').put(m);
      await done(tx);
    },
    async remove(id) {
      const db = await open();
      const tx = db.transaction(['meta', 'blobs'], 'readwrite');
      tx.objectStore('blobs').delete(id);
      tx.objectStore('meta').delete(id);
      await done(tx);
    },
  };
}

let shared: LibraryBackend | null = null;

/** The app's library: IndexedDB when it works, else memory. */
export function replayLibrary(): LibraryBackend {
  if (shared) return shared;
  const idb = typeof indexedDB !== 'undefined' ? indexedDbLibrary() : null;
  if (!idb) {
    shared = memoryLibrary();
    return shared;
  }
  // Fall back to memory for the whole session on the first IndexedDB failure
  // (private mode, quota, a blocked upgrade): saving must never throw at the UI.
  const mem = memoryLibrary();
  let broken = false;
  const guard = <A extends unknown[], R>(fn: (...a: A) => Promise<R>, alt: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
    if (broken) return alt(...a);
    try {
      return await fn(...a);
    } catch (err) {
      console.warn('[replay library] IndexedDB unavailable, keeping replays in memory:', err);
      broken = true;
      return alt(...a);
    }
  };
  shared = {
    list: guard(idb.list, mem.list),
    get: guard(idb.get, mem.get),
    put: guard(idb.put, mem.put),
    remove: guard(idb.remove, mem.remove),
  };
  return shared;
}

/** Apply the size policy after a save: drop the oldest past `max`. Returns removed ids. */
export async function enforceLimit(lib: LibraryBackend, max = MAX_ENTRIES): Promise<string[]> {
  const all = await lib.list();
  const drop = all.slice(max).map((m) => m.id);
  for (const id of drop) await lib.remove(id);
  return drop;
}
