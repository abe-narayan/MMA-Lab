/** Types for capture-url.mjs (imported by tests/ui.pass2.test.tsx). */
export function withCapture(url: string | URL): string;
export function captureGoto<P extends { goto: (url: string, opts?: unknown) => unknown }>(page: P): P;
