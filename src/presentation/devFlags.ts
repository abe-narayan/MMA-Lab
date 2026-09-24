/**
 * DEBUG AND CAPTURE SWITCHES — one gate for every URL switch and window
 * global the QA and capture tooling uses (audit H3).
 *
 * The switches (`?watchDemo ?view ?quality ?scale ?cam ?seek ?play ?demo
 * ?analytics ?profile ?placeholders ?gpuTiming ?stagePost ?fixedRes ?backend
 * ?skinVelFix ?gpuDynres ?shareProgs ?aoClamp ?mrtBlend ?skinGate ?skinLite`)
 * and the globals (`window.__presenter __ttff __stats __watch
 * __skinVelocityFix __precompile __skinGatesOff __watchProfile`) are live
 * only when
 *   - the app runs from the Vite dev server (`import.meta.env.DEV`), or
 *   - the page URL carries `?capture=1` (production builds under the
 *     capture and QA scripts: scripts/dev/capture-url.mjs adds it).
 * Anywhere else they read as absent, so a shared link with `?quality=ultra`
 * or `?backend=webgl2` does nothing in the shipped app and nothing leaks
 * onto `window`.
 *
 * GPU-free and dependency-free: the app shell imports it before any of the
 * 3D stack is loaded, and Node tools can import it (no `import.meta.env`
 * there, so only `?capture=1` could turn it on, and Node has no URL).
 */

/** The rule itself, pure (tested): development, or `capture=1` in the query string. */
export function switchesEnabled(dev: boolean | undefined, search: string): boolean {
  if (dev === true) return true;
  try {
    return new URLSearchParams(search).get('capture') === '1';
  } catch {
    return false;
  }
}

/** True in development, or in a production build opened with `?capture=1`. */
export const DEV_SWITCHES: boolean = switchesEnabled(
  (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV,
  typeof location !== 'undefined' ? location.search : '',
);

/**
 * The page's query string when switches are enabled, else an empty one. Use
 * it wherever a module would have written `new URLSearchParams(location.search)`
 * to read a debug switch.
 */
export function devParams(): URLSearchParams {
  if (!DEV_SWITCHES || typeof location === 'undefined') return new URLSearchParams();
  return new URLSearchParams(location.search);
}

/** One debug switch's raw value, or null when absent or switches are off. */
export function devParam(name: string): string | null {
  return devParams().get(name);
}

/** The query string to hand to parsers that take one (`''` when switches are off). */
export function devSearch(): string {
  return DEV_SWITCHES && typeof location !== 'undefined' ? location.search : '';
}

/** Publish a QA global on `window` (no-op when switches are off or there is no window). */
export function exposeDevGlobal(name: string, value: unknown): void {
  if (!DEV_SWITCHES || typeof window === 'undefined') return;
  (window as unknown as Record<string, unknown>)[name] = value;
}

/** Remove a QA global if it still holds `value` (or unconditionally when `value` is omitted). */
export function clearDevGlobal(name: string, value?: unknown): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as Record<string, unknown>;
  if (arguments.length < 2 || w[name] === value) delete w[name];
}
