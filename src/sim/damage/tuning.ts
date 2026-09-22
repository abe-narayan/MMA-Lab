/**
 * TUNING — the damage module's window onto the parameter registry.
 *
 * Chapter 05 has ~460 tunables and the calibrator (09 §9) must be able to move
 * every one of them, so nothing in this module is a literal: every number comes
 * from `src/sim/params/damage.params.ts` through this reader.
 *
 * `ResolvedParams.get` is a Map lookup. A Monte-Carlo batch does tens of
 * millions of them, so the reader memoises per id: one lookup per id per bout,
 * a plain number after that. The cache is keyed only by id because a `Tuning`
 * wraps one immutable source.
 *
 * NOTE on the import: this file deliberately imports the damage *spec list*
 * rather than `src/sim/params` (the merged registry). Two reasons — it keeps
 * the module usable without resolving every other chapter's parameters, and at
 * the time of writing `fighter.params.ts` carries three bare `[D]` tags that
 * make `ParamRegistry.add` throw, so importing the merged index would make this
 * module unloadable for a bug that is not its own. `tuningFrom` is the seam the
 * engine uses to hand in the real, merged `ResolvedParams` once that is fixed.
 */
import { DAMAGE_PARAMS } from '../params/damage.params';
import type { ParamOverrides, ParamSpec, ResolvedParams } from '../params/registry';

/** Anything that can answer "what is the value of this parameter id". */
export interface ParamSource {
  get(id: string): number;
}

const SPECS: ReadonlyMap<string, ParamSpec> = new Map(DAMAGE_PARAMS.map((s) => [s.id, s]));

/** Every parameter this chapter owns, at its registry default. */
export function damageDefaults(): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of DAMAGE_PARAMS) m.set(s.id, s.value);
  return m;
}

class MapSource implements ParamSource {
  constructor(private readonly values: ReadonlyMap<string, number>) {}

  get(id: string): number {
    const v = this.values.get(id);
    if (v === undefined) throw new Error(`Unknown damage parameter: ${id}`);
    return v;
  }
}

export class Tuning {
  private readonly cache = new Map<string, number>();

  constructor(private readonly source: ParamSource) {}

  /** Value of `id`, memoised. Throws on an unknown id. */
  n(id: string): number {
    const hit = this.cache.get(id);
    if (hit !== undefined) return hit;
    const v = this.source.get(id);
    this.cache.set(id, v);
    return v;
  }

  /** Value of `${prefix}.${key}`, for the many per-site / per-weapon tables. */
  table(prefix: string, key: string): number {
    return this.n(`${prefix}.${key}`);
  }
}

let cachedDefaults: Tuning | null = null;

/** The registry defaults, resolved once and shared. */
export function defaultTuning(): Tuning {
  if (cachedDefaults === null) cachedDefaults = new Tuning(new MapSource(damageDefaults()));
  return cachedDefaults;
}

/**
 * Defaults with overrides applied — what a calibration run uses. Overrides are
 * checked against the spec's bounds exactly as `ParamRegistry.resolve` does, so
 * a calibrator cannot push a parameter somewhere the chapter forbids.
 */
export function tuningWith(overrides: ParamOverrides): Tuning {
  const values = damageDefaults();
  for (const [id, v] of Object.entries(overrides)) {
    const spec = SPECS.get(id);
    if (!spec) throw new Error(`Override for unknown damage parameter: ${id}`);
    if (!Number.isFinite(v)) throw new Error(`Override for ${id} is not finite: ${v}`);
    if (spec.min !== undefined && v < spec.min) throw new Error(`${id}=${v} below min ${spec.min}`);
    if (spec.max !== undefined && v > spec.max) throw new Error(`${id}=${v} above max ${spec.max}`);
    values.set(id, v);
  }
  return new Tuning(new MapSource(values));
}

/** Wrap the engine's merged, already-resolved parameter set (once per bout). */
export function tuningFrom(params: ResolvedParams): Tuning {
  return new Tuning(params);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** Exponential decay by half-life. `dtS` and `halfLifeS` in seconds. */
export function decayBy(value: number, dtS: number, halfLifeS: number): number {
  if (halfLifeS <= 0) return 0;
  return value * Math.pow(0.5, dtS / halfLifeS);
}

/** Map a uniform draw in [0,1) onto [lo, hi). */
export function lerpDraw(u: number, lo: number, hi: number): number {
  return lo + (hi - lo) * u;
}
