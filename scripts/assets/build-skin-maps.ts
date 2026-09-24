/**
 * Bakes the character skin maps (anatomy relief, creases, region maps) into the body UV layout.
 *
 *   node scripts/dev/heavy.mjs npx tsx scripts/assets/build-skin-maps.ts [--size 2048] [--out <dir>] [--png <dir>]
 *
 * Input: static/assets/body/body.{json,bin} (the MakeHuman-derived body, CC0) and the procedural
 * anatomy in src/presentation/character/anatomy.ts. Output (static/assets/body/):
 *   skinmaps.json  header: sizes, part table, SHA-256 of the raw and compressed payloads
 *   skinmaps.bin   zlib (deflate) stream of the raw texels, see skinMaps.ts for the layout
 * `--png <dir>` also writes preview PNGs of every channel group (not shipped).
 *
 * Deterministic: no clocks or randomness; the same inputs give identical bytes (zlib level 9).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { decodeBodyAsset, type BodyHeader } from '../../src/presentation/character/asset';
import { canonical } from '../../src/presentation/character/canonical';
import { bakeSkinMaps, packSkinMaps, type SkinMapHeader } from '../../src/presentation/character/skinMaps';

const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const size = Number(arg('size', '2048'));
const out = resolve(arg('out', 'static/assets/body'));
const pngDir = process.argv.includes('--png') ? resolve(arg('png', '.')) : null;

const h = JSON.parse(readFileSync('static/assets/body/body.json', 'utf8')) as BodyHeader;
const b = readFileSync('static/assets/body/body.bin');
const asset = decodeBodyAsset(h, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
const can = canonical(asset);
const t0 = performance.now();
const maps = bakeSkinMaps(asset, can, size);
const { raw, parts } = packSkinMaps(maps);
const bin = deflateSync(raw, { level: 9 });
const sha = (x: Uint8Array): string => createHash('sha256').update(x).digest('hex');
const header: SkinMapHeader = {
  format: 'boutlab-skinmaps/1', size, parts, rawBytes: raw.length, rawSha256: sha(raw), binSha256: sha(bin),
  metresPerTexel: +maps.metresPerTexel.toFixed(6), coverage: +maps.coverage.toFixed(4),
};
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'skinmaps.bin'), bin);
writeFileSync(join(out, 'skinmaps.json'), `${JSON.stringify(header, null, 2)}\n`);
console.log(`skin maps ${size}²: ${(raw.length / 1e6).toFixed(1)} MB raw, ${(bin.length / 1e6).toFixed(2)} MB compressed, ` +
  `${(maps.metresPerTexel * 1000).toFixed(2)} mm/texel, coverage ${(maps.coverage * 100).toFixed(1)} %, ${(performance.now() - t0).toFixed(0)} ms`);

if (pngDir) {
  mkdirSync(pngDir, { recursive: true });
  const S2 = size >> 1;
  png(join(pngDir, 'skin-relief.png'), S2, (i) => [maps.a[i * 4], maps.a[i * 4 + 1], 255]);
  png(join(pngDir, 'skin-cavity-pores.png'), S2, (i) => [maps.a[i * 4 + 2], maps.a[i * 4 + 3], 0]);
  png(join(pngDir, 'skin-region.png'), S2, (i) => [maps.b[i * 4], maps.b[i * 4 + 1], Math.max(maps.b[i * 4 + 2], maps.b[i * 4 + 3])]);
  png(join(pngDir, 'skin-crease.png'), size, (i) => [maps.c[i * 2], maps.c[i * 2 + 1], 255]);
}

/** Minimal RGB PNG writer, rows flipped so v = 1 is at the top of the image. */
function png(file: string, S: number, px: (i: number) => [number, number, number]): void {
  const stride = S * 3 + 1;
  const rows = Buffer.alloc(stride * S);
  for (let y = 0; y < S; y++) {
    const sy = S - 1 - y;
    for (let x = 0; x < S; x++) rows.set(px(sy * S + x), y * stride + 1 + x * 3);
  }
  const table = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (buf: Buffer): number => { let c = -1; for (const x of buf) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type: string, d: Buffer): Buffer => {
    const td = Buffer.concat([Buffer.from(type), d]);
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]));
}
