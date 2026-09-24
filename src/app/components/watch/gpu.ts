/**
 * Whether any GPU path can be tried at all (WebGPU or WebGL2): decides if the
 * Watch screen opens on the 3D view or the 2D board.
 *
 * Same test as `gpuLikelyAvailable` in src/presentation/stage/index.ts, kept
 * here so the Watch screen can ask without importing the stage module, which
 * pulls in three/webgpu (the 3D stack is a lazily loaded chunk).
 */
export function gpuLikelyAvailable(): boolean {
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) return true;
  if (typeof document === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}
