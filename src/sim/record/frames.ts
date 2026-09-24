/**
 * RECORDED FRAMES — compact columnar storage (docs/design/09 §4.5, QA-8).
 *
 * A recorded run keeps one `TickSnapshot` per tick so the Watch screen can
 * seek by array index. Kept as plain objects that costs ≈ 3 KB per fighter per
 * tick (a 1v5 five-rounder measured +163 MB of heap). 09 §4.5 asks instead for
 * "typed-array columns to keep GC quiet", ≈ 1.2 KB per tick for six fighters.
 *
 * `FrameStore` is that store:
 *
 *  - **Columns.** Every leaf field of the snapshot is a column in chunked
 *    typed arrays (1,024 rows per chunk, so growth never copies and the slack
 *    is at most one chunk). Fighters and engagements are child tables whose
 *    rows the frame row points at.
 *  - **Constant until it changes.** A column holds one scalar until the first
 *    row that differs, and only then allocates storage. Most presentation
 *    placeholders (lead foot, grips, blood on gloves…) never change, so they
 *    cost nothing.
 *  - **Interning.** Strings, booleans, ids, state lists and small objects go
 *    through a per-column dictionary; the column stores the index, as a
 *    Uint8/16/32 that widens only when the dictionary does.
 *  - **Quantisation**, where it cannot be seen: positions, velocities, angles
 *    and times-in-ms are Float32 (sub-micrometre at arena scale); quantities
 *    the snapshot contract defines as 0-1 (stamina, damage, action phase,
 *    fatigue tells) are 16-bit fixed point (1/65,535). Integers (ticks,
 *    counters, the state bitfield) are exact. The frame's own `tick`, `t` and
 *    `roundTime` are exact.
 *  - **Never lossy by surprise.** A value that does not fit its column (a
 *    "0-1" number outside 0-1, a fraction in an integer column, an object with
 *    an extra key, a list longer than expected) is stored verbatim in that
 *    node's exception map and returned exactly. So a field the sim adds later
 *    survives, it just costs memory until the schema below learns it.
 *
 * None of this touches the simulation: frames are built from `buildSnapshot`
 * after each step, exactly as before, and are never digested (the digest is
 * computed inside the world). Replay files never contained frames (09 §1.5),
 * so the on-disk format is unchanged.
 *
 * The array view (`FrameStore.view()`) is what `BoutRun.frames` holds: a
 * read-only `TickSnapshot[]` whose elements are decoded on access (with a
 * small cache, so the same index returns the same object while it is hot).
 * Every consumer that indexes, iterates, slices, `find`s or JSON-serialises
 * frames works unchanged. A view is *not* structured-cloneable (it is a
 * Proxy): code that posts frames between threads uses `packFrames` /
 * `unpackFrames`, which move the typed arrays as transferables.
 */
import type { TickSnapshot } from './snapshot';

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const SHIFT = 10;
const CHUNK = 1 << SHIFT;
const MASK = CHUNK - 1;

type Enc = 'f32' | 'f64' | 'unorm' | 'int' | 'tick' | 'ref';

type Typed =
  | Float32Array | Float64Array | Uint16Array
  | Int8Array | Int16Array | Int32Array | Uint8Array | Uint32Array;
type TypedCtor = { new (n: number): Typed; readonly BYTES_PER_ELEMENT: number };

const INT_CTORS: TypedCtor[] = [Int8Array, Int16Array, Int32Array];
const INT_MAX = [0x7f, 0x7fff, 0x7fffffff];
const REF_CTORS: TypedCtor[] = [Uint8Array, Uint16Array, Uint32Array];
const REF_MAX = [0xff, 0xffff, 0xffffffff];

/** Encoding context: the frame's tick, for tick-relative columns. */
interface Ctx {
  tick: number;
}

/** Deep copy of a JSON-like value (keeps NaN / Infinity, unlike a JSON round trip). */
function cloneValue<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(cloneValue) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as object)) out[k] = cloneValue((v as Record<string, unknown>)[k]);
  return out as T;
}

/** Dictionary key of an interned value. Prefixes keep "3", 3 and NaN/null apart. */
function refKey(v: unknown): string {
  if (v === undefined) return 'u';
  if (typeof v === 'string') return `s${v}`;
  if (typeof v === 'number') return `n${String(v)}`;
  return JSON.stringify(v);
}

/** Serialisable state of one column (see `packFrames`). */
interface ColumnState {
  w: number;
  constSet: boolean;
  constVal: number;
  chunks: Typed[] | null;
  exc: Map<number, unknown> | null;
  dict: unknown[] | null;
}

class Column {
  /** Width index into INT_CTORS / REF_CTORS (unused for float kinds). */
  private w = 0;
  private constSet = false;
  private constVal = 0;
  private chunks: Typed[] | null = null;
  /** Values that do not fit this column, stored verbatim by row. */
  private exc: Map<number, unknown> | null = null;
  /** `ref` only: interned values, and their keys. */
  private dict: unknown[] | null = null;
  private keys: Map<string, number> | null = null;

  /** Field path, for diagnostics. */
  name = '';

  constructor(readonly enc: Enc) {
    if (enc === 'ref') {
      this.dict = [];
      this.keys = new Map();
    }
  }

  // ---- encode ------------------------------------------------------------

  set(row: number, v: unknown, ctx: Ctx): void {
    let e: number;
    switch (this.enc) {
      case 'f32':
      case 'f64':
        if (typeof v !== 'number') return this.except(row, v);
        // Round once here so a constant-mode column decodes the same value a
        // materialised Float32Array would.
        e = this.enc === 'f32' ? Math.fround(v) : v;
        break;
      case 'unorm':
        if (typeof v !== 'number' || !(v >= 0 && v <= 1)) return this.except(row, v);
        e = Math.round(v * 65535);
        break;
      case 'int':
      case 'tick': {
        if (typeof v !== 'number' || !Number.isInteger(v) || Object.is(v, -0)) return this.except(row, v);
        e = this.enc === 'tick' ? v - ctx.tick : v;
        if (e > INT_MAX[2] || e < -INT_MAX[2] - 1) return this.except(row, v);
        break;
      }
      case 'ref':
      default:
        e = this.intern(v);
        break;
    }
    this.write(row, e);
  }

  private intern(v: unknown): number {
    const key = refKey(v);
    const keys = this.keys as Map<string, number>;
    let id = keys.get(key);
    if (id === undefined) {
      id = (this.dict as unknown[]).length;
      (this.dict as unknown[]).push(cloneValue(v));
      keys.set(key, id);
    }
    return id;
  }

  private except(row: number, v: unknown): void {
    if (!this.exc) this.exc = new Map();
    this.exc.set(row, cloneValue(v));
  }

  private widthFor(e: number): number {
    if (this.enc === 'int' || this.enc === 'tick') {
      for (let i = 0; i < 3; i++) if (e <= INT_MAX[i] && e >= -INT_MAX[i] - 1) return i;
      return 2;
    }
    for (let i = 0; i < 3; i++) if (e <= REF_MAX[i]) return i;
    return 2;
  }

  private ctor(w = this.w): TypedCtor {
    switch (this.enc) {
      case 'f32': return Float32Array;
      case 'f64': return Float64Array;
      case 'unorm': return Uint16Array;
      case 'ref': return REF_CTORS[w];
      default: return INT_CTORS[w];
    }
  }

  private write(row: number, e: number): void {
    if (!this.chunks) {
      if (!this.constSet) {
        this.constSet = true;
        this.constVal = e;
        return;
      }
      if (Object.is(e, this.constVal)) return;
      this.materialise(row);
    }
    if (this.enc !== 'f32' && this.enc !== 'f64' && this.enc !== 'unorm') {
      const need = this.widthFor(e);
      if (need > this.w) this.widen(need);
    }
    const chunks = this.chunks as Typed[];
    const c = row >> SHIFT;
    while (chunks.length <= c) chunks.push(new (this.ctor())(CHUNK));
    chunks[c][row & MASK] = e;
  }

  /** First differing value at `row`: allocate storage holding the constant for rows before it. */
  private materialise(row: number): void {
    if (this.enc !== 'f32' && this.enc !== 'f64' && this.enc !== 'unorm') this.w = this.widthFor(this.constVal);
    const Ctor = this.ctor();
    const chunks: Typed[] = [];
    const last = row >> SHIFT;
    for (let c = 0; c <= last; c++) {
      const a = new Ctor(CHUNK);
      if (this.constVal !== 0) a.fill(this.constVal);
      chunks.push(a);
    }
    this.chunks = chunks;
  }

  private widen(w: number): void {
    const Ctor = this.ctor(w);
    this.chunks = (this.chunks as Typed[]).map((a) => {
      const b = new Ctor(CHUNK);
      b.set(a);
      return b;
    });
    this.w = w;
  }

  // ---- decode ------------------------------------------------------------

  get(row: number, ctx: Ctx): unknown {
    if (this.exc) {
      const x = this.exc.get(row);
      if (x !== undefined || this.exc.has(row)) return cloneValue(x);
    }
    let e: number;
    if (this.chunks) {
      const a = this.chunks[row >> SHIFT];
      e = a ? a[row & MASK] : 0;
    } else {
      e = this.constVal;
    }
    switch (this.enc) {
      case 'unorm': return e / 65535;
      case 'tick': return e + ctx.tick;
      case 'ref': {
        const v = (this.dict as unknown[])[e];
        return v !== null && typeof v === 'object' ? cloneValue(v) : v;
      }
      default: return e;
    }
  }

  // ---- bookkeeping -------------------------------------------------------

  bytes(): number {
    let n = 64;
    if (this.chunks) for (const c of this.chunks) n += c.byteLength;
    if (this.dict) for (const v of this.dict) n += 48 + (typeof v === 'string' ? v.length * 2 : JSON.stringify(v ?? null).length * 4);
    if (this.exc) n += this.exc.size * 96;
    return n;
  }

  buffers(out: ArrayBuffer[]): void {
    if (this.chunks) for (const c of this.chunks) out.push(c.buffer as ArrayBuffer);
  }

  state(): ColumnState {
    return {
      w: this.w, constSet: this.constSet, constVal: this.constVal,
      chunks: this.chunks, exc: this.exc, dict: this.dict,
    };
  }

  restore(s: ColumnState): void {
    this.w = s.w;
    this.constSet = s.constSet;
    this.constVal = s.constVal;
    this.chunks = s.chunks;
    this.exc = s.exc;
    if (this.enc === 'ref') {
      this.dict = s.dict ?? [];
      // Keys are only needed to keep encoding; a revived store is read-only,
      // but rebuild them anyway so `push` stays correct.
      const keys = new Map<string, number>();
      this.dict.forEach((v, i) => keys.set(refKey(v), i));
      this.keys = keys;
    }
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

type Schema =
  | Enc
  | { obj: [string, Schema][] }
  | { opt: Schema }
  | { arr: number; of: Schema }
  | { list: number; of: Schema }
  | { table: [string, Schema][] };

const S = {
  obj: (...fields: [string, Schema][]): Schema => ({ obj: fields }),
  opt: (inner: Schema): Schema => ({ opt: inner }),
  arr: (n: number, of: Schema): Schema => ({ arr: n, of }),
  list: (n: number, of: Schema): Schema => ({ list: n, of }),
  table: (...fields: [string, Schema][]): Schema => ({ table: fields }),
};

/**
 * One `FighterSnapshot` (snapshot.ts), field for field and in the same order.
 * Encodings: `ref` for anything with few distinct values (the state bitfield
 * and an action's total duration included: both come from small tables),
 * `unorm` for the contract's 0-1 quantities, `f32` for continuous geometry.
 */
const FIGHTER: [string, Schema][] = [
  ['id', 'int'], ['team', 'int'],
  ['x', 'f32'], ['z', 'f32'], ['facing', 'f32'], ['vx', 'f32'], ['vz', 'f32'],
  ['stance', 'ref'], ['leadFoot', 'f32'], ['againstFence', 'ref'], ['fenceNormalAngle', 'f32'],
  ['posture', 'ref'], ['position', 'ref'], ['role', 'ref'], ['partnerId', 'ref'],
  ['action', 'ref'], ['actionPhase', 'unorm'], ['actionStage', 'ref'], ['actionResult', 'ref'], ['defence', 'ref'],
  ['actionDetail', S.obj(
    ['startTick', 'tick'], ['totalMs', 'ref'], ['contactTick', 'tick'], ['contactOffsetMs', 'f32'],
    ['target', 'ref'], ['subLocation', 'ref'], ['side', 'ref'], ['targetId', 'ref'],
    ['forceNorm', 'unorm'], ['direction', 'ref'],
  )],
  ['defenceDetail', S.obj(['phase', 'unorm'], ['side', 'ref'])],
  ['stamina', S.obj(['total', 'unorm'], ['burst', 'unorm'])],
  ['damage', S.obj(['head', 'unorm'], ['body', 'unorm'], ['legs', 'unorm'], ['cut', 'unorm'])],
  ['state', 'ref'], ['states', 'ref'], ['balance', 'f32'],
  ['sub', S.obj(['technique', 'ref'], ['stage', 'int'], ['progress', 'f32'])],
  ['sig', S.obj(['landed', 'int'], ['attempted', 'int'])],
  ['intentTag', 'ref'],
  ['grips', 'ref'],
  ['contacts', 'ref'],
  ['damageVisual', S.obj(
    ['zones', S.arr(6, 'unorm')],
    ['swelling', S.arr(2, 'unorm')],
    ['cuts', S.list(4, S.obj(['site', 'ref'], ['severity', 'int'], ['bleeding', 'ref'], ['ageS', 'f32']))],
    ['bloodOnGloves', 'f32'],
  )],
  ['fatigueVisual', S.obj(
    ['f', 'unorm'], ['breathingRate', 'f32'], ['handsDrop', 'unorm'], ['flatFeet', 'unorm'], ['chinUp', 'unorm'],
  )],
];

/** One `EngagementSnapshot`. */
const ENGAGEMENT: [string, Schema][] = [
  ['a', 'int'], ['b', 'int'], ['node', 'ref'], ['sinceTick', 'int'], ['kind', 'ref'], ['cage', 'ref'],
  ['underhookOwner', 'ref'], ['kuzushi', 'ref'], ['posture', 'ref'],
  ['inflight', S.opt(S.obj(['edge', 'ref'], ['tStart', 'f64'], ['dur', 'f64'], ['phase', 'f32']))],
  ['rootX', 'f32'], ['rootZ', 'f32'], ['rootYaw', 'f32'],
];

/** One `TickSnapshot`. `tick` comes first: tick-relative columns below it read it. */
const FRAME: [string, Schema][] = [
  ['v', 'int'], ['tick', 'int'], ['t', 'f64'], ['round', 'int'], ['roundTime', 'f64'], ['phase', 'ref'],
  ['fighters', S.table(...FIGHTER)],
  ['engagements', S.table(...ENGAGEMENT)],
  ['referee', 'ref'],
  ['score', 'ref'],
];

// ---------------------------------------------------------------------------
// Codecs (a compiled schema)
// ---------------------------------------------------------------------------

interface Registry {
  columns: Column[];
  nodes: NodeCodec[];
  /** Field path while compiling, for `FrameStore.columnReport()`. */
  path: string[];
}

function addColumn(reg: Registry, c: Column, suffix?: string): Column {
  c.name = suffix ? [...reg.path, suffix].join('.') : reg.path.join('.');
  reg.columns.push(c);
  return c;
}

abstract class NodeCodec {
  /** Values whose shape does not match the schema, verbatim by row. */
  exc: Map<number, unknown> | null = null;
  protected except(row: number, v: unknown): void {
    if (!this.exc) this.exc = new Map();
    this.exc.set(row, cloneValue(v));
  }
  protected excepted(row: number): { hit: boolean; value?: unknown } {
    if (!this.exc || !this.exc.has(row)) return { hit: false };
    return { hit: true, value: cloneValue(this.exc.get(row)) };
  }
  abstract enc(row: number, v: unknown, ctx: Ctx): void;
  abstract dec(row: number, ctx: Ctx): unknown;
}

type Codec = Column | NodeCodec;

function compile(s: Schema, reg: Registry): Codec {
  if (typeof s === 'string') {
    return addColumn(reg, new Column(s));
  }
  let node: NodeCodec;
  if ('obj' in s) node = new ObjCodec(s.obj, reg);
  else if ('opt' in s) node = new OptCodec(s.opt, reg);
  else if ('arr' in s) node = new ArrCodec(s.arr, s.of, reg);
  else if ('list' in s) node = new ListCodec(s.list, s.of, reg);
  else node = new TableCodec(s.table, reg);
  reg.nodes.push(node);
  return node;
}

function encodeWith(c: Codec, row: number, v: unknown, ctx: Ctx): void {
  if (c instanceof Column) c.set(row, v, ctx);
  else c.enc(row, v, ctx);
}

function decodeWith(c: Codec, row: number, ctx: Ctx): unknown {
  return c instanceof Column ? c.get(row, ctx) : c.dec(row, ctx);
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

class ObjCodec extends NodeCodec {
  private readonly keys: string[];
  private readonly codecs: Codec[];
  constructor(fields: [string, Schema][], reg: Registry) {
    super();
    this.keys = fields.map((f) => f[0]);
    this.codecs = fields.map((f) => {
      reg.path.push(f[0]);
      const c = compile(f[1], reg);
      reg.path.pop();
      return c;
    });
  }

  /** Exactly the schema's keys (own, enumerable) — anything else is stored verbatim. */
  matches(v: unknown): v is Record<string, unknown> {
    if (!isPlain(v)) return false;
    let n = 0;
    for (const k in v) {
      if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
      n++;
    }
    if (n !== this.keys.length) return false;
    for (const k of this.keys) if (!Object.prototype.hasOwnProperty.call(v, k)) return false;
    return true;
  }

  enc(row: number, v: unknown, ctx: Ctx): void {
    if (!this.matches(v)) return this.except(row, v);
    for (let i = 0; i < this.keys.length; i++) {
      const val = v[this.keys[i]];
      // The frame's tick drives tick-relative columns in its subtree.
      if (this.keys[i] === 'tick' && typeof val === 'number') ctx.tick = val;
      encodeWith(this.codecs[i], row, val, ctx);
    }
  }

  dec(row: number, ctx: Ctx): unknown {
    const x = this.excepted(row);
    if (x.hit) return x.value;
    const out: Record<string, unknown> = {};
    for (let i = 0; i < this.keys.length; i++) {
      const val = decodeWith(this.codecs[i], row, ctx);
      if (this.keys[i] === 'tick' && typeof val === 'number') ctx.tick = val;
      out[this.keys[i]] = val;
    }
    return out;
  }
}

class OptCodec extends NodeCodec {
  private readonly flag = new Column('int');
  private readonly inner: Codec;
  constructor(inner: Schema, reg: Registry) {
    super();
    addColumn(reg, this.flag, '(null)');
    this.inner = compile(inner, reg);
  }
  enc(row: number, v: unknown, ctx: Ctx): void {
    if (v === null) return this.flag.set(row, 1, ctx);
    if (v === undefined) return this.flag.set(row, 2, ctx);
    this.flag.set(row, 0, ctx);
    encodeWith(this.inner, row, v, ctx);
  }
  dec(row: number, ctx: Ctx): unknown {
    const f = this.flag.get(row, ctx);
    if (f === 1) return null;
    if (f === 2) return undefined;
    return decodeWith(this.inner, row, ctx);
  }
}

class ArrCodec extends NodeCodec {
  private readonly items: Codec[];
  constructor(n: number, of: Schema, reg: Registry) {
    super();
    this.items = Array.from({ length: n }, (_, i) => {
      reg.path.push(String(i));
      const c = compile(of, reg);
      reg.path.pop();
      return c;
    });
  }
  enc(row: number, v: unknown, ctx: Ctx): void {
    if (!Array.isArray(v) || v.length !== this.items.length) return this.except(row, v);
    for (let i = 0; i < v.length; i++) encodeWith(this.items[i], row, v[i], ctx);
  }
  dec(row: number, ctx: Ctx): unknown {
    const x = this.excepted(row);
    if (x.hit) return x.value;
    return this.items.map((c) => decodeWith(c, row, ctx));
  }
}

class ListCodec extends NodeCodec {
  private readonly len = new Column('int');
  private readonly items: Codec[];
  constructor(max: number, of: Schema, reg: Registry) {
    super();
    addColumn(reg, this.len, '(length)');
    this.items = Array.from({ length: max }, (_, i) => {
      reg.path.push(String(i));
      const c = compile(of, reg);
      reg.path.pop();
      return c;
    });
  }
  enc(row: number, v: unknown, ctx: Ctx): void {
    if (!Array.isArray(v) || v.length > this.items.length) {
      this.len.set(row, 0, ctx);
      return this.except(row, v);
    }
    this.len.set(row, v.length, ctx);
    for (let i = 0; i < v.length; i++) encodeWith(this.items[i], row, v[i], ctx);
  }
  dec(row: number, ctx: Ctx): unknown {
    const x = this.excepted(row);
    if (x.hit) return x.value;
    const n = this.len.get(row, ctx) as number;
    const out: unknown[] = [];
    for (let i = 0; i < n; i++) out.push(decodeWith(this.items[i], row, ctx));
    return out;
  }
}

/** An array of records stored as rows of a child table; the parent row keeps start and count. */
class TableCodec extends NodeCodec {
  private readonly start = new Column('int');
  private readonly count = new Column('int');
  private readonly row: ObjCodec;
  rows = 0;
  constructor(fields: [string, Schema][], reg: Registry) {
    super();
    addColumn(reg, this.start, '(start)');
    addColumn(reg, this.count, '(count)');
    this.row = new ObjCodec(fields, reg);
    reg.nodes.push(this.row);
  }
  enc(row: number, v: unknown, ctx: Ctx): void {
    if (!Array.isArray(v)) {
      this.count.set(row, 0, ctx);
      return this.except(row, v);
    }
    this.start.set(row, this.rows, ctx);
    this.count.set(row, v.length, ctx);
    for (const item of v) this.row.enc(this.rows++, item, ctx);
  }
  dec(row: number, ctx: Ctx): unknown {
    const x = this.excepted(row);
    if (x.hit) return x.value;
    const s = this.start.get(row, ctx) as number;
    const n = this.count.get(row, ctx) as number;
    const out: unknown[] = [];
    for (let i = 0; i < n; i++) out.push(this.row.dec(s + i, ctx));
    return out;
  }
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/** Frames as moved between threads: typed arrays and plain data only. */
export interface PackedFrames {
  kind: 'bout-lab.frames';
  version: 1;
  length: number;
  tableRows: number[];
  columns: ColumnState[];
  nodeExc: (Map<number, unknown> | null)[];
}

const CACHE = 256;
const STORE = Symbol('FrameStore');

export class FrameStore {
  private readonly reg: Registry = { columns: [], nodes: [], path: [] };
  private readonly root: ObjCodec;
  private n = 0;
  private readonly cache = new Map<number, TickSnapshot>();
  private viewCache: TickSnapshot[] | null = null;

  constructor() {
    this.root = new ObjCodec(FRAME, this.reg);
    this.reg.nodes.push(this.root);
  }

  /** `frames[i].tick` without decoding the frame (for seeks and indexes). */
  tickAt(i: number): number | undefined {
    if (!(i >= 0 && i < this.n)) return undefined;
    // FRAME's second field; a frame whose shape did not match is stored whole.
    const whole = this.root.exc?.get(i) as TickSnapshot | undefined;
    if (whole) return whole.tick;
    return this.reg.columns[1].get(i, { tick: 0 }) as number;
  }

  get length(): number {
    return this.n;
  }

  /** Append one frame. The snapshot is copied; the caller may drop or reuse it. */
  push(frame: TickSnapshot): void {
    this.root.enc(this.n, frame, { tick: 0 });
    this.n += 1;
    if (this.viewCache) (this.viewCache as unknown[]).length = this.n;
  }

  /** Decode frame `i` (a fresh object, cached while it is recent). */
  get(i: number): TickSnapshot | undefined {
    if (!(i >= 0 && i < this.n) || !Number.isInteger(i)) return undefined;
    const hit = this.cache.get(i);
    if (hit) {
      this.cache.delete(i);
      this.cache.set(i, hit);
      return hit;
    }
    const f = this.root.dec(i, { tick: 0 }) as TickSnapshot;
    this.cache.set(i, f);
    if (this.cache.size > CACHE) this.cache.delete(this.cache.keys().next().value as number);
    return f;
  }

  /**
   * A read-only `TickSnapshot[]` over the store: `length`, indexing,
   * iteration and every non-mutating array method work; writes throw.
   */
  view(): TickSnapshot[] {
    if (this.viewCache) return this.viewCache;
    const target: TickSnapshot[] = [];
    target.length = this.n;
    const indexOf = (p: string | symbol): number => {
      if (typeof p !== 'string' || p.length === 0 || p.length > 10) return -1;
      const c = p.charCodeAt(0);
      if (c < 48 || c > 57 || (c === 48 && p.length > 1)) return -1;
      const i = Number(p);
      return Number.isInteger(i) ? i : -1;
    };
    const readOnly = (): never => {
      throw new TypeError('Recorded frames are read-only');
    };
    const view = new Proxy(target, {
      get: (t, p, r) => {
        if (p === STORE) return this;
        const i = indexOf(p);
        if (i >= 0) return this.get(i);
        return Reflect.get(t, p, r);
      },
      has: (t, p) => {
        const i = indexOf(p);
        if (i >= 0) return i < this.n;
        return Reflect.has(t, p);
      },
      getOwnPropertyDescriptor: (t, p) => {
        const i = indexOf(p);
        if (i >= 0) {
          return i < this.n
            ? { value: this.get(i), writable: false, enumerable: true, configurable: true }
            : undefined;
        }
        return Reflect.getOwnPropertyDescriptor(t, p);
      },
      ownKeys: (t) => {
        const keys: (string | symbol)[] = [];
        for (let i = 0; i < this.n; i++) keys.push(String(i));
        for (const k of Reflect.ownKeys(t)) if (indexOf(k) < 0) keys.push(k);
        return keys;
      },
      set: readOnly,
      defineProperty: readOnly,
      deleteProperty: readOnly,
    });
    this.viewCache = view;
    return view;
  }

  /** Bytes per column (diagnostics; `scripts/dev` memory probes). */
  columnReport(): { name: string; enc: string; bytes: number }[] {
    return this.reg.columns.map((c) => ({ name: c.name, enc: c.enc, bytes: c.bytes() }));
  }

  /** Approximate retained bytes: typed arrays exactly, dictionaries and exceptions estimated. */
  byteSize(): number {
    let n = 0;
    for (const c of this.reg.columns) n += c.bytes();
    for (const node of this.reg.nodes) if (node.exc) n += node.exc.size * 256;
    return n;
  }

  /** Plain data for `postMessage`, and the buffers to transfer with it. */
  pack(): { packed: PackedFrames; transfer: ArrayBuffer[] } {
    const transfer: ArrayBuffer[] = [];
    for (const c of this.reg.columns) c.buffers(transfer);
    return {
      packed: {
        kind: 'bout-lab.frames',
        version: 1,
        length: this.n,
        tableRows: this.reg.nodes.filter((x): x is TableCodec => x instanceof TableCodec).map((x) => x.rows),
        columns: this.reg.columns.map((c) => c.state()),
        nodeExc: this.reg.nodes.map((x) => x.exc),
      },
      transfer,
    };
  }

  /** Rebuild a store from `pack()` output (after a structured clone). */
  static unpack(p: PackedFrames): FrameStore {
    if (!p || p.kind !== 'bout-lab.frames' || p.version !== 1) {
      throw new Error('Not a packed frame store (or an unsupported version).');
    }
    const s = new FrameStore();
    if (p.columns.length !== s.reg.columns.length || p.nodeExc.length !== s.reg.nodes.length) {
      throw new Error('Packed frames were written by a different frame schema.');
    }
    p.columns.forEach((st, i) => s.reg.columns[i].restore(st));
    p.nodeExc.forEach((m, i) => { s.reg.nodes[i].exc = m; });
    const tables = s.reg.nodes.filter((x): x is TableCodec => x instanceof TableCodec);
    tables.forEach((t, i) => { t.rows = p.tableRows[i] ?? 0; });
    s.n = p.length;
    return s;
  }

  /** The store behind a `view()`, or null for a plain array. */
  static of(frames: readonly TickSnapshot[] | undefined | null): FrameStore | null {
    if (!frames) return null;
    const s = (frames as unknown as Record<symbol, unknown>)[STORE];
    return s instanceof FrameStore ? s : null;
  }

  /** A store holding `frames` (a plain array or another view). */
  static from(frames: readonly TickSnapshot[]): FrameStore {
    const existing = FrameStore.of(frames);
    if (existing) return existing;
    const s = new FrameStore();
    for (const f of frames) s.push(f);
    return s;
  }
}

/**
 * Frames ready for `postMessage`: a view becomes its packed columns (with the
 * buffers to transfer); a plain array is packed the same way.
 */
export function packFrames(frames: readonly TickSnapshot[]): { packed: PackedFrames; transfer: ArrayBuffer[] } {
  return FrameStore.from(frames).pack();
}

/** The inverse of `packFrames`: a read-only `TickSnapshot[]` view. */
export function unpackFrames(packed: PackedFrames): TickSnapshot[] {
  return FrameStore.unpack(packed).view();
}

/** True for a `packFrames` payload. */
export function isPackedFrames(v: unknown): v is PackedFrames {
  return isPlain(v) && v.kind === 'bout-lab.frames';
}
