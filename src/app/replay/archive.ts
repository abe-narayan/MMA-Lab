/**
 * REPLAY ARCHIVE — the saved-replay container (Watch/replay pass).
 *
 * A bout is a pure function of its seed and config under a given engine, so a
 * replay only has to store what `simulate()` needs (seed, fighters, rules,
 * arena, settings, parameter overrides) plus the claim to check (engine
 * version, digest, ticks, RNG draws, result): re-simulating reproduces every
 * event and every frame exactly. That is the **portable** profile, a few KB.
 *
 * The **library** profile adds a cache for instant opening: the full event
 * log, the game-plan samples and the recorded frames (the `FrameStore`
 * columns), so the Watch screen can open a saved bout without re-running the
 * simulation. The cache is exact: columns are stored bit for bit, with
 * lossless transforms only (integers delta-coded, floats XOR-ed with the
 * previous value's bits, then every array byte-shuffled into planes) before
 * gzip. Decoding it yields the very same `TickSnapshot`s (tested).
 *
 * Container (little-endian):
 *
 *   0  'BLRP'           magic
 *   4  u8  version      container version (1)
 *   5  u8  flags        bit 0: body is gzip-compressed
 *   6  u16 reserved     0
 *   8  u32 bodyBytes    stored body length
 *  12  u32 crc32        CRC-32 of the stored body
 *  16  body             u32 jsonBytes, JSON (UTF-8), then the binary blob
 *
 * Reading is defensive: every failure is a typed `ArchiveError` (empty,
 * not a replay, unsupported version, truncated, checksum, decompress, parse,
 * invalid), never an exception reaching the UI. A plain `ReplayFileV4` JSON
 * (format 4, what History exports) is read too: that is the previous format.
 *
 * No React, no DOM beyond `CompressionStream` (browsers, Node >= 18).
 */
import {
  SIM_ENGINE_VERSION,
  type IntentSample, type ReplayFileV4, type TickSnapshot,
} from '../../sim';
import { FrameStore, type PackedFrames } from '../../sim/record/frames';

export const ARCHIVE_MAGIC = 0x50524c42; // 'BLRP' little-endian
export const ARCHIVE_VERSION = 1;
export const ARCHIVE_KIND = 'bout-lab.replay';
const HEADER_BYTES = 16;
const FLAG_GZIP = 1;

export type ArchiveProfile = 'portable' | 'library';

export type ArchiveErrorCode =
  | 'empty' | 'not-a-replay' | 'unsupported-version' | 'truncated' | 'checksum'
  | 'decompress' | 'parse' | 'invalid';

export interface ArchiveError {
  code: ArchiveErrorCode;
  message: string;
}

/** What a saved replay holds once decoded. */
export interface DecodedArchive {
  /** The replay claim. `events` / `stats` are empty in the portable profile. */
  replay: ReplayFileV4;
  /** True when the events were stored (library profile or a v4 JSON file). */
  hasEvents: boolean;
  /** Instant-open cache (library profile only). */
  cache: { frames: readonly TickSnapshot[]; intents: IntentSample[] } | null;
  /** Container version read (0 = a bare ReplayFileV4 JSON). */
  containerVersion: number;
  /** False when the file was recorded by another engine build: it cannot re-simulate exactly. */
  engineVersionMatch: boolean;
}

export type DecodeResult = { ok: true; archive: DecodedArchive } | { ok: false; error: ArchiveError };

// ---------------------------------------------------------------------------
// CRC-32 (IEEE)
// ---------------------------------------------------------------------------

let CRC_TABLE: Uint32Array | null = null;

export function crc32(bytes: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// gzip
// ---------------------------------------------------------------------------

export function gzipAvailable(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export const gzip = (b: Uint8Array): Promise<Uint8Array> => pipe(b, new CompressionStream('gzip'));
export const gunzip = (b: Uint8Array): Promise<Uint8Array> => pipe(b, new DecompressionStream('gzip'));

// ---------------------------------------------------------------------------
// Lossless column transforms
// ---------------------------------------------------------------------------

type Typed =
  | Float32Array | Float64Array | Uint16Array
  | Int8Array | Int16Array | Int32Array | Uint8Array | Uint32Array;

const CTORS = {
  f32: Float32Array, f64: Float64Array, u8: Uint8Array, u16: Uint16Array, u32: Uint32Array,
  i8: Int8Array, i16: Int16Array, i32: Int32Array,
} as const;
type CtorName = keyof typeof CTORS;

function ctorName(a: Typed): CtorName {
  if (a instanceof Float32Array) return 'f32';
  if (a instanceof Float64Array) return 'f64';
  if (a instanceof Uint8Array) return 'u8';
  if (a instanceof Uint16Array) return 'u16';
  if (a instanceof Uint32Array) return 'u32';
  if (a instanceof Int8Array) return 'i8';
  if (a instanceof Int16Array) return 'i16';
  return 'i32';
}

/** Integer view over the same bytes (floats as their bit patterns). */
function bitsView(a: Typed): Uint8Array | Uint16Array | Uint32Array {
  const bytes = a.BYTES_PER_ELEMENT;
  if (bytes === 1) return new Uint8Array(a.buffer, a.byteOffset, a.length);
  if (bytes === 2) return new Uint16Array(a.buffer, a.byteOffset, a.length);
  return new Uint32Array(a.buffer, a.byteOffset, (a.length * bytes) / 4);
}

/**
 * Encode one array to bytes: delta (integers) or XOR-with-previous (floats)
 * on the bit patterns, then split the bytes into planes (all first bytes,
 * then all second bytes...), which is what lets gzip find the redundancy of
 * slowly changing numbers. Exactly invertible (`decodeArray`).
 */
export function encodeArray(a: Typed): Uint8Array {
  const float = a instanceof Float32Array || a instanceof Float64Array;
  const src = bitsView(a);
  const t = new (src.constructor as { new (n: number): Uint8Array | Uint16Array | Uint32Array })(src.length);
  // Float64: pairs of u32 words; XOR each word with the same word of the previous value.
  const stride = a instanceof Float64Array ? 2 : 1;
  for (let i = 0; i < src.length; i++) {
    const prev = i >= stride ? src[i - stride] : 0;
    t[i] = float ? (src[i] ^ prev) >>> 0 : (src[i] - prev);
  }
  const width = t.BYTES_PER_ELEMENT;
  const raw = new Uint8Array(t.buffer, t.byteOffset, t.byteLength);
  if (width === 1) return raw.slice();
  const n = t.length;
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < n; i++) for (let b = 0; b < width; b++) out[b * n + i] = raw[i * width + b];
  return out;
}

export function decodeArray(bytes: Uint8Array, name: CtorName, length: number): Typed {
  const Ctor = CTORS[name];
  const out = new Ctor(length);
  const view = bitsView(out);
  const width = view.BYTES_PER_ELEMENT;
  const n = view.length;
  const raw = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  if (bytes.length !== raw.length) throw new Error('array length mismatch');
  if (width === 1) raw.set(bytes);
  else for (let i = 0; i < n; i++) for (let b = 0; b < width; b++) raw[i * width + b] = bytes[b * n + i];
  const float = name === 'f32' || name === 'f64';
  const stride = name === 'f64' ? 2 : 1;
  for (let i = stride; i < n; i++) {
    view[i] = float ? (view[i] ^ view[i - stride]) >>> 0 : view[i] + view[i - stride];
  }
  return out;
}

// ---------------------------------------------------------------------------
// JSON with typed arrays, Maps and non-finite numbers
// ---------------------------------------------------------------------------

interface BlobWriter {
  parts: Uint8Array[];
  offset: number;
}

function toJsonSafe(v: unknown, w: BlobWriter): unknown {
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return { $n: 'NaN' };
    if (v === Infinity) return { $n: 'Inf' };
    if (v === -Infinity) return { $n: '-Inf' };
    if (Object.is(v, -0)) return { $n: '-0' };
    return v;
  }
  if (v === undefined) return { $u: 1 };
  if (v === null || typeof v !== 'object') return v;
  if (ArrayBuffer.isView(v)) {
    const a = v as Typed;
    const bytes = encodeArray(a);
    const ref = { $ta: ctorName(a), o: w.offset, b: bytes.length, n: a.length };
    w.parts.push(bytes);
    w.offset += bytes.length;
    return ref;
  }
  if (v instanceof Map) return { $map: [...v.entries()].map(([k, x]) => [toJsonSafe(k, w), toJsonSafe(x, w)]) };
  if (Array.isArray(v)) return v.map((x) => toJsonSafe(x, w));
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) out[k] = toJsonSafe((v as Record<string, unknown>)[k], w);
  // An object that happens to use a marker key is escaped.
  if ('$n' in out || '$u' in out || '$ta' in out || '$map' in out || '$o' in out) return { $o: out };
  return out;
}

function fromJsonSafe(v: unknown, blob: Uint8Array): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => fromJsonSafe(x, blob));
  const o = v as Record<string, unknown>;
  if ('$o' in o && Object.keys(o).length === 1) {
    const inner = o.$o as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(inner)) out[k] = fromJsonSafe(inner[k], blob);
    return out;
  }
  if ('$n' in o) return o.$n === 'NaN' ? NaN : o.$n === 'Inf' ? Infinity : o.$n === '-Inf' ? -Infinity : -0;
  if ('$u' in o) return undefined;
  if ('$ta' in o) {
    const name = o.$ta as CtorName;
    const off = o.o as number;
    const len = o.b as number;
    if (!(name in CTORS) || !(off >= 0) || off + len > blob.length) throw new Error('bad array reference');
    return decodeArray(blob.subarray(off, off + len), name, o.n as number);
  }
  if ('$map' in o) {
    const entries = o.$map as [unknown, unknown][];
    return new Map(entries.map(([k, x]) => [fromJsonSafe(k, blob), fromJsonSafe(x, blob)]));
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o)) out[k] = fromJsonSafe(o[k], blob);
  return out;
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

interface Payload {
  kind: typeof ARCHIVE_KIND;
  version: typeof ARCHIVE_VERSION;
  profile: ArchiveProfile;
  replay: ReplayFileV4;
  hasEvents: boolean;
  cache?: { frames: PackedFrames; intents: IntentSample[] };
}

export interface EncodeInput {
  replay: ReplayFileV4;
  /** Library profile: the recorded frames and game-plan samples, for instant opening. */
  frames?: readonly TickSnapshot[];
  intents?: readonly IntentSample[];
}

export interface EncodeOptions {
  profile?: ArchiveProfile;
  /** Default: when `CompressionStream` exists. */
  compress?: boolean;
}

const utf8 = new TextEncoder();
const utf8d = new TextDecoder('utf-8', { fatal: true });

/** Encode a replay as an archive. Never mutates its input. */
export async function encodeArchive(input: EncodeInput, opts: EncodeOptions = {}): Promise<Uint8Array> {
  const profile = opts.profile ?? (input.frames ? 'library' : 'portable');
  const compress = opts.compress ?? gzipAvailable();
  const replay: ReplayFileV4 = profile === 'portable'
    ? { ...input.replay, events: [], stats: undefined as unknown as ReplayFileV4['stats'] }
    : input.replay;
  if (profile === 'portable') delete (replay as Partial<ReplayFileV4>).stats;
  const payload: Payload = {
    kind: ARCHIVE_KIND,
    version: ARCHIVE_VERSION,
    profile,
    replay,
    hasEvents: profile === 'library',
  };
  if (profile === 'library' && input.frames) {
    payload.cache = {
      frames: FrameStore.from(input.frames).pack().packed,
      intents: [...(input.intents ?? [])],
    };
  }
  const w: BlobWriter = { parts: [], offset: 0 };
  const json = utf8.encode(JSON.stringify(toJsonSafe(payload, w)));
  const body = new Uint8Array(4 + json.length + w.offset);
  new DataView(body.buffer).setUint32(0, json.length, true);
  body.set(json, 4);
  let at = 4 + json.length;
  for (const p of w.parts) {
    body.set(p, at);
    at += p.length;
  }
  const stored = compress ? await gzip(body) : body;
  const out = new Uint8Array(HEADER_BYTES + stored.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, ARCHIVE_MAGIC, true);
  dv.setUint8(4, ARCHIVE_VERSION);
  dv.setUint8(5, compress ? FLAG_GZIP : 0);
  dv.setUint16(6, 0, true);
  dv.setUint32(8, stored.length, true);
  dv.setUint32(12, crc32(stored), true);
  out.set(stored, HEADER_BYTES);
  return out;
}

const fail = (code: ArchiveErrorCode, message: string): DecodeResult => ({ ok: false, error: { code, message } });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Structural check of a `ReplayFileV4`: what re-simulation and the UI rely on. Returns the problem or null. */
export function replayProblem(r: unknown, needEvents: boolean): string | null {
  if (!isObj(r)) return 'the replay record is missing';
  if (r.format !== 4) return `unknown replay format ${String(r.format)}`;
  if (typeof r.engineVersion !== 'string') return 'no engine version';
  if (typeof r.seed !== 'string') return 'no seed';
  if (!Array.isArray(r.fighters) || r.fighters.length < 2 || !r.fighters.every(isObj)) return 'fighters are missing';
  if (!isObj(r.teams) || !Array.isArray((r.teams as { teamOf?: unknown }).teamOf)) return 'team assignment is missing';
  if (typeof r.ruleset !== 'string' && !isObj(r.ruleset)) return 'ruleset is missing';
  if (typeof r.arena !== 'string' && !isObj(r.arena)) return 'arena is missing';
  if (!isObj(r.settings)) return 'match settings are missing';
  if (typeof r.digest !== 'string' || r.digest.length === 0) return 'no digest';
  if (!Number.isInteger(r.ticks) || (r.ticks as number) < 0) return 'bad tick count';
  if (!Number.isInteger(r.rngDraws) || (r.rngDraws as number) < 0) return 'bad RNG draw count';
  if (!isObj(r.result)) return 'no result';
  if (needEvents) {
    if (!Array.isArray(r.events)) return 'the event log is missing';
    let last = -Infinity;
    for (const e of r.events as unknown[]) {
      if (!isObj(e) || typeof e.tick !== 'number' || typeof e.kind !== 'string') return 'the event log is corrupt';
      if (e.tick < last) return 'the event log is out of order';
      last = e.tick;
    }
  }
  return null;
}

function finish(replay: ReplayFileV4, hasEvents: boolean, cache: DecodedArchive['cache'], containerVersion: number): DecodeResult {
  return {
    ok: true,
    archive: {
      replay, hasEvents, cache, containerVersion, engineVersionMatch: replay.engineVersion === SIM_ENGINE_VERSION,
    },
  };
}

/** Read a bare `ReplayFileV4` JSON (the previous, uncontainered format). */
function decodeLegacyJson(bytes: Uint8Array): DecodeResult {
  let text: string;
  try {
    text = utf8d.decode(bytes);
  } catch {
    return fail('not-a-replay', 'This is not a Bout Lab replay file (unrecognised binary data).');
  }
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return fail(text.trimStart().startsWith('{') ? 'parse' : 'not-a-replay',
      text.trimStart().startsWith('{') ? 'The replay file is damaged: its JSON is incomplete or malformed.'
        : 'This is not a Bout Lab replay file.');
  }
  // A History entry wraps the replay.
  const r = isObj(v) && isObj(v.replay) && v.format === undefined ? v.replay : v;
  if (!isObj(r) || r.format === undefined) return fail('not-a-replay', 'This JSON file is not a Bout Lab replay.');
  if (r.format !== 4) return fail('unsupported-version', `Replay format ${String(r.format)} is not supported by this build (it reads format 4 and container v1).`);
  const problem = replayProblem(r, true);
  if (problem) return fail('invalid', `The replay file is incomplete: ${problem}.`);
  return finish(r as unknown as ReplayFileV4, true, null, 0);
}

/** Decode an archive (or a legacy v4 JSON replay). Never throws. */
export async function decodeArchive(input: Uint8Array | ArrayBuffer): Promise<DecodeResult> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length === 0) return fail('empty', 'The replay file is empty.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 4 || dv.getUint32(0, true) !== ARCHIVE_MAGIC) return decodeLegacyJson(bytes);
  if (bytes.length < HEADER_BYTES) return fail('truncated', 'The replay file is truncated (incomplete header).');
  const version = dv.getUint8(4);
  if (version !== ARCHIVE_VERSION) {
    return fail('unsupported-version', `Replay container v${version} is newer than this build supports (v${ARCHIVE_VERSION}).`);
  }
  const flags = dv.getUint8(5);
  const bodyBytes = dv.getUint32(8, true);
  const crc = dv.getUint32(12, true);
  if (bytes.length - HEADER_BYTES < bodyBytes) {
    return fail('truncated', `The replay file is truncated (${bytes.length - HEADER_BYTES} of ${bodyBytes} bytes).`);
  }
  const stored = bytes.subarray(HEADER_BYTES, HEADER_BYTES + bodyBytes);
  if (crc32(stored) !== crc) return fail('checksum', 'The replay file is corrupted (checksum mismatch).');
  let body: Uint8Array;
  try {
    if (flags & FLAG_GZIP) {
      if (!gzipAvailable()) return fail('decompress', 'This browser cannot decompress replay files (no CompressionStream).');
      body = await gunzip(stored);
    } else {
      body = stored;
    }
  } catch {
    return fail('decompress', 'The replay file is corrupted (it does not decompress).');
  }
  try {
    if (body.length < 4) return fail('truncated', 'The replay file is truncated (empty body).');
    const jsonBytes = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0, true);
    if (4 + jsonBytes > body.length) return fail('truncated', 'The replay file is truncated (body shorter than declared).');
    const json = JSON.parse(utf8d.decode(body.subarray(4, 4 + jsonBytes))) as unknown;
    const blob = body.subarray(4 + jsonBytes);
    const p = fromJsonSafe(json, blob) as Partial<Payload>;
    if (!isObj(p) || p.kind !== ARCHIVE_KIND) return fail('not-a-replay', 'The archive does not hold a Bout Lab replay.');
    if (p.version !== ARCHIVE_VERSION) return fail('unsupported-version', `Replay payload v${String(p.version)} is not supported.`);
    const hasEvents = p.hasEvents === true;
    const problem = replayProblem(p.replay, hasEvents);
    if (problem) return fail('invalid', `The replay file is incomplete: ${problem}.`);
    const replay = p.replay as ReplayFileV4;
    if (!hasEvents) replay.events = [];
    let cache: DecodedArchive['cache'] = null;
    if (p.cache && hasEvents) {
      const store = FrameStore.unpack(p.cache.frames);
      if (store.length < 2 || store.tickAt(store.length - 1) !== replay.ticks) {
        return fail('invalid', 'The replay file is incomplete: the frame cache does not match the bout.');
      }
      cache = { frames: store.view(), intents: Array.isArray(p.cache.intents) ? p.cache.intents : [] };
    }
    return finish(replay, hasEvents, cache, version);
  } catch (err) {
    return fail('parse', `The replay file is damaged (${err instanceof Error ? err.message : String(err)}).`);
  }
}

/** Short user-facing summary of a decode failure. */
export function describeArchiveError(e: ArchiveError): string {
  return e.message;
}
