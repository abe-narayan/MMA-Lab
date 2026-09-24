/**
 * The fighter editor's undo history, kept out of React so it can be tested
 * and so StrictMode's double-invoked updaters cannot record a step twice.
 *
 * Past states are kept newest last. Edits to the same field within
 * `coalesceMs` merge, so one slider drag is one undo step.
 */
export class DraftHistory<T> {
  current: T;
  readonly past: T[] = [];
  readonly future: T[] = [];
  private lastEdit: { key: string; at: number } | null = null;

  constructor(initial: T, private readonly coalesceMs = 700, private readonly limit = 150) {
    this.current = initial;
  }

  /** Apply an edit. Returns the new state, or null when nothing changed. */
  update(fn: (d: T) => T, key = '*', now = Date.now()): T | null {
    const d = this.current;
    const next = fn(d);
    if (next === d) return null;
    const merge = this.lastEdit !== null && key !== '*' && this.lastEdit.key === key
      && now - this.lastEdit.at < this.coalesceMs;
    if (!merge) {
      this.past.push(d);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.future.length = 0;
    this.lastEdit = { key, at: now };
    this.current = next;
    return next;
  }

  undo(): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(this.current);
    this.current = prev;
    this.lastEdit = null;
    return prev;
  }

  redo(): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.current);
    this.current = next;
    this.lastEdit = null;
    return next;
  }

  /** Start over from `value` with no history (a different fighter arrived). */
  reset(value: T): void {
    this.current = value;
    this.past.length = 0;
    this.future.length = 0;
    this.lastEdit = null;
  }

  /** Replace the current state without an undo step (a save normalised it). */
  replace(value: T): void {
    this.current = value;
    this.lastEdit = null;
  }

  /**
   * Capture the state as it is now and return the edit that puts it back.
   * A toast's "Undo" uses this: it must undo the action it names, not
   * whatever the user happened to edit after the toast appeared. The restore
   * is itself an ordinary, undoable edit.
   */
  restorePoint(): (d: T) => T {
    const before = this.current;
    return () => before;
  }
}
