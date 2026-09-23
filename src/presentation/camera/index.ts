/**
 * Camera director entry point (docs/design/08 §7). Owned by the camera work.
 * Returns null until implemented; the presenter then uses a fixed wide shot.
 */
import type { CameraDirector } from '../contract';

export function createCameraDirector(): CameraDirector | null {
  return null;
}
