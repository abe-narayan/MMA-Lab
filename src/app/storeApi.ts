/**
 * THE STORE SURFACE THE SCREENS USE.
 *
 * The database and the creator are written against this interface rather than
 * against `src/app/store/**` directly, for one reason: the persistence layer is
 * being written in parallel, and a screen that imports a named function from it
 * cannot be compiled, reviewed or tested until that function exists. An
 * interface inverts that — the screens are finished now, and `App.tsx` is the
 * single file that has to bind the real implementation.
 *
 * It is also how the tests get a database without a `localStorage`: the same
 * screens run against a plain object.
 *
 * `bindStore` in `App.tsx` maps this onto the real module. Any method a store
 * implementation does not provide is bound to a stub that throws naming itself,
 * so a missing piece is a loud failure on one action rather than a blank screen.
 */

import type { FighterDefinition } from '../sim';
import type { FighterRecord, ValidationResult } from './store/types';

export interface ImportOutcome {
  added: number;
  skipped: number;
  /** Human-readable reasons, shown in the database's message strip. */
  problems: string[];
}

export interface FighterStoreApi {
  /** Every fighter, built-in archetypes included. */
  list(): FighterRecord[];
  get(id: string): FighterRecord | undefined;

  /**
   * Insert or replace. Editing a built-in must clone it rather than mutate it,
   * which is the store's job, not the screen's — the screen just saves.
   */
  save(def: FighterDefinition): FighterRecord;
  remove(id: string): void;
  duplicate(id: string): FighterRecord;

  /** Called on every keystroke, so it has to be cheap and total. */
  validate(def: FighterDefinition): ValidationResult;

  /** A well-formed, minimal fighter for "New fighter". */
  blank(): FighterDefinition;
  /** A plausible complete fighter. Seeded, because nothing here may be random. */
  random(seed: string): FighterDefinition;

  /** The single JSON document of 09 §3.6. */
  exportJson(ids: readonly string[]): string;
  importJson(text: string): ImportOutcome;
}

/** Thrown by a stub so an unbound store method names itself. */
export class StoreNotReadyError extends Error {
  constructor(method: string) {
    super(
      `The fighter store does not export "${method}". ` +
        'Bind it in src/app/App.tsx.',
    );
    this.name = 'StoreNotReadyError';
  }
}
