/**
 * Capture/QA switches are live only on the dev server or with `?capture=1`
 * (src/presentation/devFlags.ts, audit H3). Every capture script sends its
 * URL through `withCapture`, so the same script works against the dev server
 * and against a production build (`vite build`, served statically).
 */
export function withCapture(url) {
  const u = String(url);
  if (/[?&]capture=1(&|#|$)/.test(u)) return u;
  const hash = u.indexOf('#');
  const [head, tail] = hash >= 0 ? [u.slice(0, hash), u.slice(hash)] : [u, ''];
  return `${head}${head.includes('?') ? '&' : '?'}capture=1${tail}`;
}

/** Patch a Playwright page so every `goto` carries the capture flag. */
export function captureGoto(page) {
  const goto = page.goto.bind(page);
  page.goto = (url, opts) => goto(withCapture(url), opts);
  return page;
}
