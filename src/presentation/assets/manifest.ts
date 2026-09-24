/**
 * TYPED ASSET URLS — the only place a runtime asset path is spelled out.
 *
 * Everything here is served from `static/` at the site root (vite.config.ts
 * `publicDir`), and every file is listed with its source and licence in
 * `docs/ASSETS.md` (ids in the comments below). Other modules import `ASSETS`
 * and never hard-code a path, so moving or re-encoding an asset is a one-line
 * change here.
 */

/** Site-root prefix for runtime assets. Change with `setAssetBase` (e.g. a CDN or sub-path deploy). */
let BASE = '/assets/';

export function setAssetBase(base: string): void {
  BASE = base.endsWith('/') ? base : `${base}/`;
  rebuild();
}

/** A PBR map kind. Colour maps are sRGB, the rest linear. */
export type TextureMap = 'color' | 'normal' | 'roughness' | 'ao';

export interface TextureSet {
  /** docs/ASSETS.md id */
  id: string;
  /**
   * The maps that ship for this set. Only maps the runtime actually loads are
   * kept in `static/` (the unused colour/roughness/ao maps of the Poly Haven
   * sets were removed in the final cleanup), so every entry is optional.
   */
  maps: Partial<Record<TextureMap, string>>;
  /** Physical size one texture repeat covers, metres (for UV scaling). */
  tileMetres: number;
  /** Source resolution, pixels. */
  resolution: 1024 | 2048;
}

export interface FontEntry {
  id: string;
  family: string;
  /** weight → woff2 URL */
  files: Record<500 | 600 | 700, string>;
  licence: string;
}

/** The texture sets that ship (loaded by `src/presentation/arena/assets.ts`). */
export type TextureName = 'canvas' | 'vinyl' | 'asphalt';

export interface AssetManifest {
  motion: { manifest: string; data: string };
  textures: Record<TextureName, TextureSet>;
  fonts: { broadcast: FontEntry };
  body: { base: string };
}

const tex = (
  dir: TextureName, id: string, maps: readonly TextureMap[], tileMetres: number, resolution: 1024 | 2048,
): TextureSet => ({
  id,
  maps: Object.fromEntries(maps.map((m) => [m, `${BASE}textures/${dir}/${m}.jpg`])),
  tileMetres,
  resolution,
});

function build(): AssetManifest {
  return {
    // motion.accad.male2 (CC-BY-3.0), motion.cmu (CMU-mocap)
    motion: { manifest: `${BASE}motion/manifest.json`, data: `${BASE}motion/motion.bin` },
    // No HDRIs ship: the arena paints its image-based lighting from the set's
    // own geometry (arena/environment.ts), so the Poly Haven HDRIs that were
    // only ever viewed on dev/assets.html were removed.
    textures: {
      // canvas weave normal + thread-gap cavity (octagon and ring canvas)
      canvas: tex('canvas', 'tex.polyhaven.rough_linen', ['normal', 'ao'], 1, 2048),
      // fine grain on the competition mats
      vinyl: tex('vinyl', 'tex.polyhaven.fabric_leather_02', ['normal'], 1, 1024),
      // street lot
      asphalt: tex('asphalt', 'tex.polyhaven.asphalt_02', ['color', 'normal', 'roughness'], 2, 1024),
    },
    fonts: {
      broadcast: {
        id: 'font.barlow-condensed',
        family: 'Barlow Condensed',
        files: {
          500: `${BASE}fonts/BarlowCondensed-Medium.woff2`,
          600: `${BASE}fonts/BarlowCondensed-SemiBold.woff2`,
          700: `${BASE}fonts/BarlowCondensed-Bold.woff2`,
        },
        licence: 'OFL-1.1',
      },
    },
    body: { base: `${BASE}body/` },
  };
}

/** The asset table. Rebuilt in place by `setAssetBase`, so hold on to the object, not copies of its strings. */
export const ASSETS: AssetManifest = build();

function rebuild(): void {
  Object.assign(ASSETS, build());
}

/** Every URL in the table (for preloading, service workers and the integrity test). */
export function allAssetUrls(m: AssetManifest = ASSETS): string[] {
  const out: string[] = [m.motion.manifest, m.motion.data];
  for (const t of Object.values(m.textures)) out.push(...Object.values(t.maps).filter((u): u is string => !!u));
  out.push(...Object.values(m.fonts.broadcast.files));
  return out;
}

export interface PreloadProgress { loaded: number; total: number; bytes: number; failed: string[] }

/**
 * Warm the HTTP cache for a set of assets (default: everything in the
 * table), at most `concurrency` requests at a time. Resolves when all have
 * finished; failures are reported, not thrown, so a missing optional asset
 * never blocks the broadcast.
 */
export async function preload(
  urls: readonly string[] = allAssetUrls(),
  opts: { concurrency?: number; onProgress?: (p: PreloadProgress) => void; fetchFn?: typeof fetch } = {},
): Promise<PreloadProgress> {
  const fetchFn = opts.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const p: PreloadProgress = { loaded: 0, total: urls.length, bytes: 0, failed: [] };
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        const res = await fetchFn(url);
        if (!res.ok) throw new Error(String(res.status));
        p.bytes += (await res.arrayBuffer()).byteLength;
      } catch {
        p.failed.push(url);
      }
      p.loaded++;
      opts.onProgress?.(p);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 4) }, worker));
  return p;
}

/** Register the broadcast font with the document (browser only). Resolves when all weights are ready. */
export async function registerBroadcastFont(): Promise<string> {
  const f = ASSETS.fonts.broadcast;
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return f.family;
  await Promise.all(Object.entries(f.files).map(async ([weight, url]) => {
    const face = new FontFace(f.family, `url(${url}) format('woff2')`, { weight, style: 'normal', display: 'swap' });
    document.fonts.add(await face.load());
  }));
  return f.family;
}
