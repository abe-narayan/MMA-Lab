/**
 * Concatenates docs/DESIGN.md and the chapter files in docs/design/ into a single
 * docs/DESIGN_FULL.md for reading or searching as one document.
 *
 *   node scripts/bundleDesign.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const designDir = join(root, 'docs', 'design');
const chapters = readdirSync(designDir)
  .filter((f) => /^\d\d_.*\.md$/.test(f))
  .sort();

let out = readFileSync(join(root, 'docs', 'DESIGN.md'), 'utf8');
out += '\n\n---\n\n# Chapters\n';
for (const f of chapters) {
  out += `\n\n---\n\n<!-- ${f} -->\n\n`;
  out += readFileSync(join(designDir, f), 'utf8');
}
writeFileSync(join(root, 'docs', 'DESIGN_FULL.md'), out);
console.log(`Wrote docs/DESIGN_FULL.md (${chapters.length} chapters, ${(out.length / 1024).toFixed(0)} KB)`);
