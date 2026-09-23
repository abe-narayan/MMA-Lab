/**
 * Arena module entry point (docs/design/08 §6). Owned by the arena/lighting work.
 * Returns null until implemented; the presenter then uses its placeholder set.
 */
import type { Arena } from '../../sim';
import type { ArenaSet, QualitySettings } from '../contract';

export async function createArenaSet(_arena: Arena, _quality: QualitySettings): Promise<ArenaSet | null> {
  return null;
}
