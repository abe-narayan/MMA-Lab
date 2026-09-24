/**
 * SAVED REPLAYS — save, export, open (Watch/replay pass).
 *
 * The glue between the Watch bout, the archive codec (`archive.ts`) and the
 * library (`library.ts`). Opening a replay always ends in one of these
 * verdicts, which the Watch screen shows next to the bout:
 *
 *   verified         re-simulated under this engine; digest, ticks, RNG draws
 *                    (and the event log, when stored) match the file;
 *   cached           opened instantly from the stored frames (this engine);
 *                    the digest is re-checked in the background;
 *   mismatch         re-simulated, but the result differs from the file
 *                    (a parameter or data change): the bout shown is the fresh one;
 *   other-engine     recorded by another engine build: the stored frames
 *                    are shown when present, else a re-simulation that may differ.
 *
 * Nothing here mutates a bout: saving reads the run, opening builds a new one.
 */
import {
  SIM_ENGINE_VERSION, VERIFIED_EVENT_FIELDS, computeStats, configFromReplay, hashParams, toReplayFile,
  type ReplayFileV4, type SimEvent,
} from '../../sim';
import { loadWatchBout, watchBoutFromRun, type WatchBout } from './bout';
import {
  decodeArchive, encodeArchive, type ArchiveError, type DecodedArchive,
} from './archive';
import {
  enforceLimit, metaFor, type LibraryBackend, type ReplayMeta,
} from './library';

export type Verification = 'verified' | 'cached' | 'mismatch' | 'other-engine';

export interface OpenedReplay {
  bout: WatchBout;
  verification: Verification;
  /** One line for the UI. */
  message: string;
  file: ReplayFileV4;
}

export type OpenResult = { ok: true; opened: OpenedReplay } | { ok: false; error: ArchiveError };

/** Library entries that keep the instant-open frame cache (newest first). */
export const MAX_CACHED = 12;

function eventsMatch(a: readonly SimEvent[], b: readonly SimEvent[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    for (const f of VERIFIED_EVENT_FIELDS) if (a[i][f] !== b[i][f]) return false;
  }
  return true;
}

/** The replay file for a Watch bout (with an optional label). */
export function replayFileFor(bout: WatchBout, label?: string): ReplayFileV4 {
  const file = toReplayFile(bout.run);
  if (label) file.meta = { ...(file.meta ?? {}), label };
  return file;
}

/** Library profile bytes: the replay plus the instant-open cache. */
export function encodeForLibrary(bout: WatchBout, label?: string): Promise<Uint8Array> {
  return encodeArchive({ replay: replayFileFor(bout, label), frames: bout.run.frames, intents: bout.intents }, { profile: 'library' });
}

/** Portable profile bytes (seed + config + claim): tiny, re-simulates on open. */
export function encodePortable(file: ReplayFileV4): Promise<Uint8Array> {
  return encodeArchive({ replay: file }, { profile: 'portable' });
}

/**
 * Save a bout to the library. `savedAt` is the wall-clock stamp (saved data
 * only). Older entries lose their frame cache past `MAX_CACHED` and the
 * library is trimmed to its size limit.
 */
export async function saveToLibrary(
  lib: LibraryBackend, bout: WatchBout, savedAt: string, label?: string,
): Promise<ReplayMeta> {
  const file = replayFileFor(bout, label);
  const bytes = await encodeArchive(
    { replay: file, frames: bout.run.frames, intents: bout.intents }, { profile: 'library' },
  );
  const meta = metaFor(file, bytes.length, 'library', savedAt, label);
  await lib.put(meta, bytes);
  await demoteOldCaches(lib);
  await enforceLimit(lib);
  return meta;
}

/** Re-encode entries beyond the newest `keep` as portable (drops their frame cache). */
export async function demoteOldCaches(lib: LibraryBackend, keep = MAX_CACHED): Promise<number> {
  const all = await lib.list();
  let n = 0;
  for (const m of all.slice(keep)) {
    if (m.profile !== 'library') continue;
    const bytes = await lib.get(m.id);
    if (!bytes) continue;
    const dec = await decodeArchive(bytes);
    if (!dec.ok) continue;
    const small = await encodePortable(dec.archive.replay);
    await lib.put({ ...m, bytes: small.length, profile: 'portable' }, small);
    n++;
  }
  return n;
}

/** Build the Watch bout from a decoded archive's frame cache (no re-simulation). */
function boutFromCache(a: DecodedArchive): WatchBout {
  const file = a.replay;
  const config = configFromReplay(file);
  const frames = a.cache!.frames as WatchBout['run']['frames'];
  const events = file.events;
  return watchBoutFromRun(config, {
    config,
    result: file.result,
    events,
    stats: computeStats(events, config, file.ticks),
    digest: file.digest,
    ticks: file.ticks,
    rngDraws: file.rngDraws,
    frames,
  }, a.cache!.intents);
}

/**
 * Check a freshly simulated bout against the file's claim. Returns null when
 * it matches, else what differs.
 */
export function claimMismatch(file: ReplayFileV4, bout: WatchBout, fileHasEvents: boolean): string | null {
  if (hashParams(configFromReplay(file).paramOverrides) !== file.paramsHash) return 'parameter hash';
  if (bout.run.digest !== file.digest) return 'digest';
  if (bout.run.ticks !== file.ticks) return 'tick count';
  if (bout.run.rngDraws !== file.rngDraws) return 'RNG draws';
  if (fileHasEvents && !eventsMatch(bout.run.events, file.events)) return 'event log';
  return null;
}

/**
 * Open archive bytes (or a legacy v4 JSON). `simulate` rebuilds a bout from a
 * replay's config (default: `loadWatchBout` on this thread; the Watch screen
 * passes the worker loader). Never throws for bad input.
 */
export async function openReplay(
  bytes: Uint8Array | ArrayBuffer,
  simulate: (file: ReplayFileV4) => WatchBout | Promise<WatchBout> = (file) => loadWatchBout(configFromReplay(file)),
): Promise<OpenResult> {
  const dec = await decodeArchive(bytes);
  if (!dec.ok) return dec;
  const a = dec.archive;
  const file = a.replay;
  try {
    if (!a.engineVersionMatch) {
      if (a.cache) {
        return {
          ok: true,
          opened: {
            bout: boutFromCache(a), verification: 'other-engine', file,
            message: `Recorded with engine ${file.engineVersion} (this build is ${SIM_ENGINE_VERSION}); showing the stored recording.`,
          },
        };
      }
      return {
        ok: true,
        opened: {
          bout: await simulate(file), verification: 'other-engine', file,
          message: `Recorded with engine ${file.engineVersion} (this build is ${SIM_ENGINE_VERSION}); re-simulated with this engine, so it may differ.`,
        },
      };
    }
    if (a.cache) {
      return {
        ok: true,
        opened: { bout: boutFromCache(a), verification: 'cached', file, message: 'Opened from the saved recording.' },
      };
    }
    const bout = await simulate(file);
    const diff = claimMismatch(file, bout, a.hasEvents);
    return {
      ok: true,
      opened: diff
        ? { bout, verification: 'mismatch', file, message: `Re-simulated, but the ${diff} differs from the file; showing the fresh bout.` }
        : { bout, verification: 'verified', file, message: 'Re-simulated from the seed: digest verified.' },
    };
  } catch (err) {
    return {
      ok: false,
      error: { code: 'invalid', message: `The replay could not be rebuilt (${err instanceof Error ? err.message : String(err)}).` },
    };
  }
}

/** A file name for a download: "thai-striker-vs-olympic-judoka.boutreplay". */
export function replayFileName(file: ReplayFileV4): string {
  const base = file.fighters.map((f) => f.short || f.name).join('-vs-')
    .toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return `${base || 'bout'}-${file.digest.slice(0, 8)}.boutreplay`;
}
