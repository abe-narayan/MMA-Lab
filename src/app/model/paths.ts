/**
 * DOTTED PATHS — the one addressing scheme the creator uses end to end.
 *
 * A `ValidationIssue` carries a dotted path into the definition
 * (`body.reachM`, `disciplines.bjj.sub.guard`). The editor has to be able to
 * turn that string into three things without a lookup table: the current
 * value, an updated copy of the definition, and the DOM id of the control that
 * owns the field. Deriving all three from the same function is what lets
 * "click an error, land on the field" work for fields nobody wrote a special
 * case for — including fields a future schema version adds.
 *
 * Every write is immutable: React re-renders on identity, and the undo-free
 * editor relies on the previous definition still being intact so the
 * unsaved-changes guard can compare against a baseline.
 */

/** DOM id for the control that edits `path`. Stable, collision-free, valid CSS. */
export function fieldIdForPath(path: string): string {
  return `fc-${path.replace(/[^A-Za-z0-9]+/g, '-')}`;
}

/** Reverse of {@link fieldIdForPath} is not possible; this is the label id instead. */
export function labelIdForPath(path: string): string {
  return `${fieldIdForPath(path)}-label`;
}

/** Id of the element that carries a field's helper/tooltip text. */
export function describedByIdForPath(path: string): string {
  return `${fieldIdForPath(path)}-desc`;
}

function segments(path: string): string[] {
  return path.split('.').filter((s) => s.length > 0);
}

export function getAtPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const key of segments(path)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * Immutably set `path` on `root`, cloning only the spine down to the leaf.
 *
 * Missing intermediate objects are created, because the schema has optional
 * blocks (`record.weightCut`, `appearance.hairStyle`) the user may be the
 * first to touch. Arrays are cloned as arrays so a numeric segment keeps
 * working — `style.favouriteTechniques.0.weight` is a real editable path.
 */
export function setAtPath<T>(root: T, path: string, value: unknown): T {
  const keys = segments(path);
  if (keys.length === 0) return value as T;

  const clone = (node: unknown, nextKey: string): Record<string, unknown> | unknown[] => {
    if (Array.isArray(node)) return node.slice();
    if (node !== null && typeof node === 'object') return { ...(node as Record<string, unknown>) };
    // Fabricate the container the next key implies rather than throwing: an
    // editor that refuses to set an optional sub-field is worse than one that
    // creates it.
    return /^\d+$/.test(nextKey) ? [] : {};
  };

  const out = clone(root, keys[0]);
  let cur: Record<string, unknown> | unknown[] = out;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const child = (cur as Record<string, unknown>)[key];
    const copied = clone(child, keys[i + 1]);
    (cur as Record<string, unknown>)[key] = copied;
    cur = copied;
  }

  (cur as Record<string, unknown>)[keys[keys.length - 1]] = value;
  return out as T;
}

/** Immutably delete `path`. Used when a discipline block is removed. */
export function deleteAtPath<T>(root: T, path: string): T {
  const keys = segments(path);
  if (keys.length === 0) return root;
  const parentPath = keys.slice(0, -1).join('.');
  const parent = keys.length === 1 ? root : getAtPath(root, parentPath);
  if (parent === null || typeof parent !== 'object') return root;
  const next = { ...(parent as Record<string, unknown>) };
  delete next[keys[keys.length - 1]];
  return keys.length === 1 ? (next as T) : setAtPath(root, parentPath, next);
}

export interface ClampSpec {
  min: number;
  max: number;
  /** Decimal places to round to. 0 keeps integers integral. */
  dp?: number;
}

/**
 * Turn whatever an `<input>` produced into a number inside the field's range.
 *
 * The editor never stores NaN. A half-typed value ("1.", "-", "") is common
 * while someone types, so an unparseable string falls back to `previous`
 * rather than to the minimum — snapping a height to 1.40 the moment the user
 * clears the box would fight the person editing it.
 */
export function clampNumber(raw: string | number, spec: ClampSpec, previous: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw.trim());
  if (!Number.isFinite(n)) return previous;
  const bounded = n < spec.min ? spec.min : n > spec.max ? spec.max : n;
  const dp = spec.dp ?? 0;
  const f = Math.pow(10, dp);
  return Math.round(bounded * f) / f;
}
