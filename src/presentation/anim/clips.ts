/**
 * MOTION-CAPTURE SEAM (kept as the module's public entry for the library).
 *
 * The capture is consumed by `capture.ts` (sampler, idle / step residuals) and
 * `capStrikes.ts` (strikes and defences) through the runtime motion library of
 * `src/presentation/assets/motionLibrary.ts`. Register a decoded library here
 * (or pass `AnimatorOptions.motion`); `ensureMotionLibrary` loads and registers
 * the shipped one in a browser and is what `createAnimator` calls.
 */
import { loadMotionLibrary, type MotionLibrary } from '../assets/motionLibrary';
import { registerMotionLibrary, registeredMotionLibrary } from './capture';

export { registerMotionLibrary, registeredMotionLibrary };

let loading: Promise<MotionLibrary | null> | null = null;

/**
 * Load the shipped motion library once and register it. Resolves to null (and
 * the animator stays procedural) when there is no `fetch` or the load fails.
 */
export function ensureMotionLibrary(): Promise<MotionLibrary | null> {
  if (registeredMotionLibrary()) return Promise.resolve(registeredMotionLibrary());
  if (loading) return loading;
  if (typeof fetch === 'undefined' || typeof location === 'undefined') return Promise.resolve(null);
  loading = loadMotionLibrary()
    .then((lib) => { registerMotionLibrary(lib); return lib; })
    .catch((err: unknown) => {
      console.warn('motion library unavailable; standing animation stays procedural', err);
      return null;
    });
  return loading;
}
