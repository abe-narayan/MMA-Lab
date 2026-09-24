/**
 * The app's view of the debug/capture gate (src/presentation/devFlags.ts):
 * URL switches and `window.__*` QA globals are live only in development or
 * with `?capture=1`. Kept in the presentation layer so the 3D modules and the
 * app read one flag; this re-export is what screens import.
 */
export {
  DEV_SWITCHES, devParam, devParams, devSearch, exposeDevGlobal, clearDevGlobal,
} from '../presentation/devFlags';
