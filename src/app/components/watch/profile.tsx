/**
 * React render accounting for the Watch screen (`?profile=1`).
 *
 * Wraps a region in React's `<Profiler>` and accumulates, per region id, the
 * number of commits and the summed `actualDuration` (ms spent rendering that
 * region and its children) into `window.__watchProfile`. Off unless the URL
 * asks for it, so production renders are untouched. Used by
 * `scripts/dev/watch-profile.mjs` for the before/after numbers in
 * docs/design/WATCH_REPLAY_PASS.md.
 */
import { Profiler, type ReactNode } from 'react';

interface Region {
  commits: number;
  ms: number;
}

interface WatchProfile {
  regions: Record<string, Region>;
  reset(): void;
}

const enabled = typeof location !== 'undefined' && new URLSearchParams(location.search).get('profile') === '1';

function profile(): WatchProfile {
  const w = window as unknown as { __watchProfile?: WatchProfile };
  if (!w.__watchProfile) {
    const p: WatchProfile = {
      regions: {},
      reset() { p.regions = {}; },
    };
    w.__watchProfile = p;
  }
  return w.__watchProfile;
}

function onRender(id: string, _phase: string, actualDuration: number): void {
  const p = profile();
  const r = p.regions[id] ?? (p.regions[id] = { commits: 0, ms: 0 });
  r.commits += 1;
  r.ms += actualDuration;
}

export function WatchProfiler(props: { id: string; children: ReactNode }): JSX.Element {
  if (!enabled) return <>{props.children}</>;
  return <Profiler id={props.id} onRender={onRender}>{props.children}</Profiler>;
}
