/**
 * PARAMETER REGISTRY
 *
 * Every tunable number in the simulation lives here, exactly once, with its
 * provenance. This replaces `src/engine/params.ts` (a flat interface of ~90
 * constants) with a registry that carries, per entry:
 *
 *   value   the number itself, in the stated unit
 *   unit    so a reader never has to guess seconds vs ms vs logit
 *   tag     provenance: `[S: FILE §n]` sourced, `[D: …]` derived, `[E]` assumed
 *   section which design chapter owns it (01..09)
 *   free    whether Phase 9 calibration is allowed to move it
 *
 * `free: false` means the number is fixed by research and moving it would make
 * the sim disagree with a measurement; the calibrator will refuse to touch it.
 *
 * Params are resolved once per bout into a dense `Float64Array` indexed by a
 * compile-time-stable integer, so the hot loop never does a string lookup.
 *
 * See docs/design/00_CONVENTIONS.md §1 (tags) and docs/design/09 §9.1.
 */

/** Which design chapter owns a parameter. */
export type ParamSection =
  | 'core' | 'fighter' | 'striking' | 'grappling' | 'submissions'
  | 'damage' | 'rules' | 'ai' | 'multi' | 'stats' | 'commentary' | 'batch';

export interface ParamSpec {
  /** Namespaced id, e.g. `striking.jab.baseLand`. Unique across the registry. */
  id: string;
  value: number;
  /** Unit string: 'ms', 's', 'm', 'kg', 'N', 'rad/s^2', 'logit', 'probability', 'ratio', 'count', '0-1', '0-100'. */
  unit: string;
  /** Provenance tag. Must start with '[S:', '[D:' or '[E'. */
  tag: string;
  section: ParamSection;
  /** May Phase 9 calibration move this? Numbers fixed by measurement are false. */
  free: boolean;
  /** Optional inclusive bounds the calibrator must respect. */
  min?: number;
  max?: number;
  /** One-line description for the Model/params UI. */
  note?: string;
}

export type ParamId = string;
export type ParamOverrides = Record<ParamId, number>;

/**
 * Resolved parameters: dense values plus the index map. The hot loop holds the
 * `Float64Array` and integer indices; everything else uses `get(id)`.
 */
export interface ResolvedParams {
  readonly values: Float64Array;
  readonly index: ReadonlyMap<ParamId, number>;
  readonly hash: string;
  get(id: ParamId): number;
  idx(id: ParamId): number;
}

export class ParamRegistry {
  private readonly specs = new Map<ParamId, ParamSpec>();
  private order: ParamId[] = [];
  private frozen = false;

  /** Register one parameter. Throws on a duplicate id or a missing tag. */
  add(spec: ParamSpec): void {
    if (this.frozen) throw new Error(`ParamRegistry is frozen; cannot add ${spec.id}`);
    if (this.specs.has(spec.id)) throw new Error(`Duplicate parameter id: ${spec.id}`);
    validateSpec(spec);
    this.specs.set(spec.id, spec);
    this.order.push(spec.id);
  }

  /** Register many at once (the per-section params files call this). */
  addAll(specs: readonly ParamSpec[]): void {
    for (const s of specs) this.add(s);
  }

  has(id: ParamId): boolean {
    return this.specs.has(id);
  }

  spec(id: ParamId): ParamSpec {
    const s = this.specs.get(id);
    if (!s) throw new Error(`Unknown parameter: ${id}`);
    return s;
  }

  get all(): readonly ParamSpec[] {
    return this.order.map((id) => this.specs.get(id)!);
  }

  bySection(section: ParamSection): readonly ParamSpec[] {
    return this.all.filter((s) => s.section === section);
  }

  /** Ids the calibrator is allowed to move. */
  get freeIds(): readonly ParamId[] {
    return this.all.filter((s) => s.free).map((s) => s.id);
  }

  /**
   * Sort ids and forbid further additions. Sorting makes the dense index a pure
   * function of the id set, so two builds that register in a different module
   * order still produce the same indices, the same hash and the same bouts.
   */
  freeze(): void {
    if (this.frozen) return;
    this.order = [...this.order].sort();
    this.frozen = true;
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  /** Resolve defaults plus overrides into the dense array used by the engine. */
  resolve(overrides?: ParamOverrides): ResolvedParams {
    if (!this.frozen) this.freeze();
    const index = new Map<ParamId, number>();
    const values = new Float64Array(this.order.length);
    for (let i = 0; i < this.order.length; i++) {
      const id = this.order[i];
      index.set(id, i);
      values[i] = this.specs.get(id)!.value;
    }
    if (overrides) {
      for (const [id, v] of Object.entries(overrides)) {
        const i = index.get(id);
        if (i === undefined) throw new Error(`Override for unknown parameter: ${id}`);
        if (!Number.isFinite(v)) throw new Error(`Override for ${id} is not finite: ${v}`);
        const spec = this.specs.get(id)!;
        if (spec.min !== undefined && v < spec.min) throw new Error(`${id}=${v} below min ${spec.min}`);
        if (spec.max !== undefined && v > spec.max) throw new Error(`${id}=${v} above max ${spec.max}`);
        values[i] = v;
      }
    }
    const hash = hashValues(this.order, values);
    return {
      values,
      index,
      hash,
      get: (id: ParamId): number => {
        const i = index.get(id);
        if (i === undefined) throw new Error(`Unknown parameter: ${id}`);
        return values[i];
      },
      idx: (id: ParamId): number => {
        const i = index.get(id);
        if (i === undefined) throw new Error(`Unknown parameter: ${id}`);
        return i;
      },
    };
  }

  /** Hash of defaults + overrides; stored in every replay file. */
  hash(overrides?: ParamOverrides): string {
    return this.resolve(overrides).hash;
  }
}

function validateSpec(spec: ParamSpec): void {
  if (!spec.id || !/^[a-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(spec.id)) {
    throw new Error(`Parameter id must be dotted lowerCamel segments: ${spec.id}`);
  }
  if (!Number.isFinite(spec.value)) throw new Error(`Parameter ${spec.id} has a non-finite value`);
  if (!spec.unit) throw new Error(`Parameter ${spec.id} has no unit`);
  // The provenance rule from 00_CONVENTIONS §1: an untagged number is a bug.
  if (!/^\[(S:|D:|E)/.test(spec.tag)) {
    throw new Error(`Parameter ${spec.id} has an invalid provenance tag: ${spec.tag}`);
  }
  if (spec.min !== undefined && spec.max !== undefined && spec.min > spec.max) {
    throw new Error(`Parameter ${spec.id} has min > max`);
  }
  if (spec.min !== undefined && spec.value < spec.min) {
    throw new Error(`Parameter ${spec.id} default ${spec.value} is below its min ${spec.min}`);
  }
  if (spec.max !== undefined && spec.value > spec.max) {
    throw new Error(`Parameter ${spec.id} default ${spec.value} is above its max ${spec.max}`);
  }
}

/** FNV-1a over id/value pairs; quantised so float noise cannot change it. */
function hashValues(order: readonly ParamId[], values: Float64Array): string {
  let h = 0x811c9dc5;
  const mix = (n: number): void => {
    for (let i = 0; i < 4; i++) {
      h ^= (n >>> (i * 8)) & 0xff;
      h = Math.imul(h, 16777619);
    }
  };
  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    for (let c = 0; c < id.length; c++) mix(id.charCodeAt(c));
    mix(Math.round(values[i] * 1e6) | 0);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
