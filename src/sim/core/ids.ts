/**
 * ID TABLES — string ids to dense integer indices.
 *
 * The design uses readable namespaced ids (`pos.ground_mount`, `tech.jab`,
 * `sub.rnc`). Those are what the catalogues, the docs and the UI speak. The hot
 * loop and the state digest want small integers.
 *
 * `IdTable` interns a set of ids once at module load and gives a stable index
 * per id. Stability matters: the digest records `positionIndex` and
 * `actionIndex`, so if indices moved between builds, every stored replay would
 * fail to verify. Indices are therefore assigned by sorted id, not by
 * registration order.
 */

export type PositionId = string;    // `pos.*`   — chapter 03
export type TechniqueId = string;   // `tech.*`  — chapters 02 and 03
export type DefenceId = string;     // `def.*`   — chapter 02
export type SubmissionId = string;  // `sub.*`   — chapter 04
export type StateId = string;       // `state.*` — chapter 05

export class IdTable<T extends string = string> {
  private readonly toIndex = new Map<T, number>();
  private readonly toId: T[] = [];
  private frozen = false;

  constructor(readonly name: string, readonly prefix: string) {}

  add(id: T): void {
    if (this.frozen) throw new Error(`${this.name} table is frozen; cannot add ${id}`);
    if (!id.startsWith(this.prefix)) {
      throw new Error(`${this.name} id must start with "${this.prefix}": ${id}`);
    }
    if (this.toIndex.has(id)) return;
    this.toIndex.set(id, -1);
  }

  addAll(ids: readonly T[]): void {
    for (const id of ids) this.add(id);
  }

  /** Sort and assign indices. Sorted order keeps digests stable across builds. */
  freeze(): void {
    if (this.frozen) return;
    const sorted = [...this.toIndex.keys()].sort();
    this.toIndex.clear();
    for (let i = 0; i < sorted.length; i++) {
      this.toIndex.set(sorted[i], i);
      this.toId[i] = sorted[i];
    }
    this.frozen = true;
  }

  index(id: T): number {
    if (!this.frozen) this.freeze();
    const i = this.toIndex.get(id);
    if (i === undefined) throw new Error(`Unknown ${this.name} id: ${id}`);
    return i;
  }

  /** Index, or -1 for an id that is not in the table (used by the digest for 'none'). */
  indexOrNone(id: T | null | undefined): number {
    if (id === null || id === undefined) return -1;
    if (!this.frozen) this.freeze();
    const i = this.toIndex.get(id);
    return i === undefined ? -1 : i;
  }

  id(index: number): T {
    if (!this.frozen) this.freeze();
    const id = this.toId[index];
    if (id === undefined) throw new Error(`Unknown ${this.name} index: ${index}`);
    return id;
  }

  has(id: T): boolean {
    return this.toIndex.has(id);
  }

  get ids(): readonly T[] {
    if (!this.frozen) this.freeze();
    return this.toId;
  }

  get size(): number {
    return this.toIndex.size;
  }
}

export const POSITION_IDS = new IdTable<PositionId>('position', 'pos.');
export const TECHNIQUE_IDS = new IdTable<TechniqueId>('technique', 'tech.');
export const DEFENCE_IDS = new IdTable<DefenceId>('defence', 'def.');
export const SUBMISSION_IDS = new IdTable<SubmissionId>('submission', 'sub.');
export const STATE_IDS = new IdTable<StateId>('state', 'state.');

/** Called once after every catalogue module has registered its ids. */
export function freezeIdTables(): void {
  POSITION_IDS.freeze();
  TECHNIQUE_IDS.freeze();
  DEFENCE_IDS.freeze();
  SUBMISSION_IDS.freeze();
  STATE_IDS.freeze();
}
