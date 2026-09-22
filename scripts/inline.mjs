/**
 * scripts/inline.mjs - produce a single self-contained page.
 *
 *   vite build && node scripts/inline.mjs [distDir]
 *   (npm run build:single does both)
 *
 * Reads `dist/index.html`, inlines every LOCAL `<script src>` and
 * `<link rel="stylesheet">` into the markup, converts small local assets
 * referenced from `<link rel="icon">` into `data:` URIs, drops preload hints
 * that would only cause extra requests, and writes `dist/standalone.html`.
 *
 * It then re-reads its own output and fails, loudly and non-zero, if anything
 * that would trigger a network request survives: a remaining `src`/`href` on a
 * script, link, image, iframe or media element; a `url(...)` or `@import` in
 * any inline stylesheet; or a protocol-relative `//host/...` reference. The
 * point of the standalone build is that it works from a file:// URL on a
 * machine with no network at all, so "probably fine" is not good enough.
 *
 * Node 22, ESM, no dependencies outside node: builtins.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.resolve(ROOT, process.argv[2] ?? 'dist');
const INPUT = path.join(DIST, 'index.html');
const OUTPUT = path.join(DIST, 'standalone.html');

const MIME = {
  '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.json': 'application/json',
};

const die = (message, extra = []) => {
  console.error(`\ninline.mjs: ${message}`);
  for (const line of extra) console.error(`  ${line}`);
  console.error('');
  process.exit(1);
};

const humanBytes = (n) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / (1024 * 1024)).toFixed(2)} MB`;

/** True for anything the browser would fetch over the network. */
const isExternal = (url) => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url) && !url.startsWith('data:');
const isInlineable = (url) => url && !isExternal(url) && !url.startsWith('data:') && !url.startsWith('#');

/** Resolve a URL written in the built HTML to a file inside dist/. */
function resolveAsset(url) {
  const clean = url.split('?')[0].split('#')[0];
  const candidates = clean.startsWith('/')
    ? [path.join(DIST, clean.slice(1)), path.join(ROOT, 'public', clean.slice(1))]
    : [path.join(DIST, clean), path.join(path.dirname(INPUT), clean)];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/** Pull one attribute out of a tag's attribute string. */
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
};

/** A stylesheet is inlined verbatim, so any url() inside it must already be a data: URI. */
function inlineCssAssets(css, fromFile) {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, quote, url) => {
    if (!isInlineable(url)) return whole;
    const file = resolveAsset(url) ?? (() => {
      const rel = path.resolve(path.dirname(fromFile), url.split('?')[0]);
      return fs.existsSync(rel) ? rel : null;
    })();
    if (!file) {
      die(`stylesheet ${path.relative(DIST, fromFile)} references "${url}", which is not in ${path.relative(ROOT, DIST)}/`);
    }
    const mime = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    return `url("data:${mime};base64,${fs.readFileSync(file).toString('base64')}")`;
  });
}

// ------------------------------------------------------------------ start
if (!fs.existsSync(INPUT)) {
  die(`${path.relative(ROOT, INPUT)} not found.`, ['Run `vite build` (or `npm run build`) first.']);
}

let html = fs.readFileSync(INPUT, 'utf8');
const inputBytes = Buffer.byteLength(html, 'utf8');
const inlined = { scripts: 0, styles: 0, assets: 0, dropped: 0 };
const externalsFound = [];
const inlinedScriptSources = [];

// The passes run markup-first and scripts LAST, on purpose: once a bundle is
// inlined, the document contains code that can legitimately hold strings like
// `<img src="https://...">`, and a later markup pass would mistake those
// string literals for real references.

// --- 1. <img> / <source> / <iframe> / <video poster> --------------
html = html.replace(/<(img|source|iframe|video|audio|embed)\b([^>]*)>/gi, (whole, tag) => {
  let out = whole;
  for (const name of ['src', 'poster']) {
    const url = attr(whole, name);
    if (!url) continue;
    if (isExternal(url)) { externalsFound.push(`<${tag} ${name}="${url}">`); continue; }
    if (!isInlineable(url)) continue;
    const file = resolveAsset(url);
    if (!file) die(`<${tag} ${name}="${url}"> does not resolve to a file inside ${path.relative(ROOT, DIST)}/`);
    const mime = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    out = out.replace(url, `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`);
    inlined.assets++;
  }
  return out;
});

// --- 2. <link ...> ------------------------------------------------
html = html.replace(/<link\b([^>]*)>/gi, (whole, attrs) => {
  const rel = (attr(whole, 'rel') ?? '').toLowerCase();
  const href = attr(whole, 'href') ?? '';

  if (rel === 'stylesheet') {
    if (isExternal(href)) { externalsFound.push(`<link rel="stylesheet" href="${href}">`); return whole; }
    const file = resolveAsset(href);
    if (!file) die(`<link rel="stylesheet" href="${href}"> does not resolve to a file inside ${path.relative(ROOT, DIST)}/`);
    const css = inlineCssAssets(fs.readFileSync(file, 'utf8'), file);
    inlined.styles++;
    return `<style>\n${css}\n</style>`;
  }

  // Preload / prefetch / modulepreload only exist to start a second request.
  if (/(^|\s)(modulepreload|preload|prefetch|dns-prefetch|preconnect)(\s|$)/.test(rel)) {
    inlined.dropped++;
    return `<!-- inline.mjs: dropped rel="${rel}" -->`;
  }

  if (isExternal(href)) { externalsFound.push(`<link rel="${rel}" href="${href}">`); return whole; }

  if (isInlineable(href)) {
    const file = resolveAsset(href);
    if (!file) die(`<link rel="${rel}" href="${href}"> does not resolve to a file inside ${path.relative(ROOT, DIST)}/`);
    const mime = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    inlined.assets++;
    return whole.replace(href, `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`);
  }
  return whole;
});

// --- 3. existing inline <style> blocks ----------------------------
html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (whole, css) =>
  whole.replace(css, inlineCssAssets(css, INPUT)));

// --- 4. <script src="...">, last ----------------------------------
html = html.replace(/<script\b([^>]*)\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))([^>]*)>\s*<\/script>/gi,
  (whole, before, dq, sq, bare, after) => {
    const url = dq ?? sq ?? bare ?? '';
    if (isExternal(url)) { externalsFound.push(`<script src="${url}">`); return whole; }
    if (url.startsWith('data:')) return whole;
    const file = resolveAsset(url);
    if (!file) die(`<script src="${url}"> does not resolve to a file inside ${path.relative(ROOT, DIST)}/`);
    const attrs = `${before} ${after}`;
    const isModule = /\btype\s*=\s*['"]?module/i.test(attrs);
    // A literal </script> inside the bundle would terminate the inline tag early.
    const raw = fs.readFileSync(file, 'utf8');
    inlinedScriptSources.push({ from: file, code: raw });
    const code = raw.replace(/<\/script/gi, '<\\/script');
    inlined.scripts++;
    return `<script${isModule ? ' type="module"' : ''}>\n${code}\n</script>`;
  });

fs.writeFileSync(OUTPUT, html);
const outputBytes = Buffer.byteLength(html, 'utf8');

// ------------------------------------------------------------------ audit
// Re-read from disk: the check must run against the file that ships, not
// against a variable this script happens to be holding.
const shipped = fs.readFileSync(OUTPUT, 'utf8');
const problems = [];

for (const found of externalsFound) problems.push(`external reference survived: ${found}`);

// Audit the MARKUP only. The inlined script bodies are code: a string literal
// such as '<img src="https://..."' inside a bundle is not a request, and
// scanning it as markup would produce false failures on a real build.
const styleBodies = [...shipped.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);
const markup = shipped
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (m) => `${m.slice(0, m.indexOf('>') + 1)}</script>`)
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, (m) => `${m.slice(0, m.indexOf('>') + 1)}</style>`);

// Any fetchable attribute left on a tag.
const FETCH_ATTR = /<(script|link|img|iframe|source|video|audio|embed|object)\b[^>]*?\b(src|srcset|href|data)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
for (const m of markup.matchAll(FETCH_ATTR)) {
  const url = (m[4] ?? m[5] ?? m[6] ?? '').trim();
  if (!url || url.startsWith('data:') || url.startsWith('#')) continue;
  problems.push(`<${m[1].toLowerCase()} ${m[2].toLowerCase()}="${url}"> still points outside the document`);
}

// url() and @import inside the stylesheets that are now part of the document.
for (const body of styleBodies) {
  for (const u of body.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
    const url = u[2].trim();
    if (!url.startsWith('data:') && !url.startsWith('#')) problems.push(`inline CSS still fetches url(${url})`);
  }
  for (const imp of body.matchAll(/@import\s+[^;]+;/gi)) {
    problems.push(`inline CSS still has ${imp[0].trim()}`);
  }
}

// A bundle that still `import`s a sibling chunk would fetch it at runtime, which
// an HTML-only audit cannot see. Only specifiers that resolve to a real file in
// the build are reported, so ordinary string literals cannot trigger this.
const SPECIFIER = /\b(?:import|export)\b[^;'"\n]*?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
for (const { from, code } of inlinedScriptSources) {
  const seen = new Set();
  for (const m of code.matchAll(SPECIFIER)) {
    const spec = (m[1] ?? m[2] ?? '').trim();
    if (!spec || seen.has(spec)) continue;
    seen.add(spec);
    if (isExternal(spec)) {
      problems.push(`${path.basename(from)} imports "${spec}" over the network`);
      continue;
    }
    if (!spec.startsWith('.') && !spec.startsWith('/')) continue; // bare specifier: not a URL
    const sibling = resolveAsset(spec) ?? (() => {
      const rel = path.resolve(path.dirname(from), spec.split('?')[0]);
      return fs.existsSync(rel) ? rel : null;
    })();
    if (sibling) {
      problems.push(
        `${path.basename(from)} imports the separate chunk "${spec}", which was not inlined - ` +
        'build with a single bundle (rollupOptions.output.inlineDynamicImports) or extend this script'
      );
    }
  }
}

// A style="" attribute can fetch too.
for (const m of markup.matchAll(/\bstyle\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
  const body = m[2] ?? m[3] ?? '';
  for (const u of body.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) {
    const url = u[2].trim();
    if (!url.startsWith('data:') && !url.startsWith('#')) problems.push(`style attribute still fetches url(${url})`);
  }
}

if (problems.length) {
  die(`${problems.length} external reference(s) remain - this is NOT a standalone file.`,
    problems.slice(0, 20).concat(problems.length > 20 ? [`... and ${problems.length - 20} more`] : []));
}

// Advisory only: http(s) strings baked into the bundled JS are string
// literals (comments, licence headers, error messages) and are not requests.
const literalHits = [...shipped.matchAll(/https?:\/\/[^\s"'<>)]+/gi)].map((m) => m[0]);
const uniqueLiterals = [...new Set(literalHits)];

console.log('inline.mjs');
console.log('='.repeat(64));
console.log(`  input        : ${path.relative(ROOT, INPUT)} (${humanBytes(inputBytes)})`);
console.log(`  scripts      : ${inlined.scripts} inlined`);
console.log(`  stylesheets  : ${inlined.styles} inlined`);
console.log(`  assets       : ${inlined.assets} converted to data: URIs`);
console.log(`  preload hints: ${inlined.dropped} dropped`);
console.log(`  output       : ${path.relative(ROOT, OUTPUT)} (${humanBytes(outputBytes)})`);
console.log('  audit        : no script, link, image, media or CSS reference leaves the document.');
if (uniqueLiterals.length) {
  console.log(`  note         : ${uniqueLiterals.length} http(s) string literal(s) remain inside the bundled code ` +
    '(comments / licence headers / error text). They are not requests.');
  for (const u of uniqueLiterals.slice(0, 5)) console.log(`                 ${u.length > 90 ? `${u.slice(0, 90)}...` : u}`);
  if (uniqueLiterals.length > 5) console.log(`                 ... and ${uniqueLiterals.length - 5} more`);
}
console.log('');
console.log(`Open ${path.relative(ROOT, OUTPUT)} directly from disk - it needs no server and no network.`);
