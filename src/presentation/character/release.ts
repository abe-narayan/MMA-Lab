/**
 * Releasing drawables from the renderer (Leak fix, docs/design/PHASE8_NOTES.md).
 *
 * three r186's renderer keeps one `RenderObject` per (object, material,
 * render context, lights) in a strong set, and frees it only when the
 * **material** or the **object** fires `dispose`. Disposing the geometry is not
 * enough: it drops the vertex buffers but leaves the render object, which
 * still holds the mesh — and through `mesh.parent` the whole body, its
 * skeleton, bindings and pipeline references.
 *
 * Bodies, hair, kit and clothes draw with materials shared across fighters
 * and bouts (one skin pipeline for everyone; the character factory and
 * `referee/clothing.ts` own them), so those materials are never disposed and
 * every bout's bodies stayed alive for good. Firing `dispose` on each object
 * when its body is thrown away releases exactly its own render objects and
 * leaves the shared materials (and their compiled programs) untouched.
 */
import type { Object3D } from 'three';

interface Drawable {
  isMesh?: boolean;
  isPoints?: boolean;
  isLine?: boolean;
  isSprite?: boolean;
  dispatchEvent(e: { type: string }): void;
}

function release(o: Object3D, seen: Set<Object3D>): void {
  if (seen.has(o)) return;
  seen.add(o);
  const d = o as unknown as Drawable;
  if (d.isMesh || d.isPoints || d.isLine || d.isSprite) d.dispatchEvent({ type: 'dispose' });
}

/**
 * Fire `dispose` on every drawable in `roots` (whole subtrees) and in `extra`
 * (single objects that may already be out of the tree), each once.
 */
export function releaseFromRenderer(roots: readonly (Object3D | null | undefined)[], extra: readonly (Object3D | null | undefined)[] = []): void {
  const seen = new Set<Object3D>();
  for (const r of roots) r?.traverse((o) => release(o, seen));
  for (const o of extra) if (o) release(o, seen);
}
