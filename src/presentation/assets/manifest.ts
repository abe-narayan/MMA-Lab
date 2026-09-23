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

export interface TextureSet {
  /** docs/ASSETS.md id */
  id: string;
  color: string;
  normal: string;
  roughness: string;
  ao: string;
  metalness?: string;
  /** Physical size one texture repeat covers, metres (for UV scaling). */
  tileMetres: number;
  /** Colour map resolution, pixels. */
  resolution: 1024 | 2048;
}

export interface HdriEntry {
  id: string;
  /** 1k is always present; 2k where it was kept. Load with `three/addons/loaders/HDRLoader.js`. */
  url1k: string;
  url2k?: string;
  /** What the environment is for. */
  role: string;
}

export interface FontEntry {
  id: string;
  family: string;
  /** weight → woff2 URL */
  files: Record<500 | 600 | 700, string>;
  licence: string;
}

export type TextureName =
  | 'canvas' | 'vinyl' | 'metal' | 'leather' | 'satin' | 'concrete' | 'asphalt' | 'rubber_mat';
export type HdriName = 'arena' | 'street' | 'gym';

export interface AssetManifest {
  motion: { manifest: string; data: string };
  hdri: Record<HdriName, HdriEntry>;
  textures: Record<TextureName, TextureSet>;
  fonts: { broadcast: FontEntry };
  body: { base: string };
}

const tex = (dir: TextureName, id: string, tileMetres: number, resolution: 1024 | 2048, metal = false): TextureSet => ({
  id,
  color: `${BASE}textures/${dir}/color.jpg`,
  normal: `${BASE}textures/${dir}/normal.jpg`,
  roughness: `${BASE}textures/${dir}/roughness.jpg`,
  ao: `${BASE}textures/${dir}/ao.jpg`,
  ...(metal ? { metalness: `${BASE}textures/${dir}/metalness.jpg` } : {}),
  tileMetres,
  resolution,
});

function build(): AssetManifest {
  return {
    // motion.accad.male2 (CC-BY-3.0), motion.cmu (CMU-mocap)
    motion: { manifest: `${BASE}motion/manifest.json`, data: `${BASE}motion/motion.bin` },
    hdri: {
      arena: {
        id: 'hdri.polyhaven.circus_arena',
        url1k: `${BASE}hdri/circus_arena_1k.hdr`,
        url2k: `${BASE}hdri/circus_arena_2k.hdr`,
        role: 'dark indoor arena: reflections and ambient for the cage / ring',
      },
      street: {
        id: 'hdri.polyhaven.cobblestone_street_night',
        url1k: `${BASE}hdri/cobblestone_street_night_1k.hdr`,
        role: 'night street for street-fight mode',
      },
      gym: {
        id: 'hdri.polyhaven.gym_01',
        url1k: `${BASE}hdri/gym_01_1k.hdr`,
        role: 'gym / studio for the creator and dev pages',
      },
    },
    textures: {
      canvas: tex('canvas', 'tex.polyhaven.rough_linen', 1, 2048),
      vinyl: tex('vinyl', 'tex.polyhaven.fabric_leather_02', 1, 1024),
      metal: tex('metal', 'tex.polyhaven.metal_plate', 1, 1024, true),
      leather: tex('leather', 'tex.polyhaven.leather_white', 0.5, 1024),
      satin: tex('satin', 'tex.polyhaven.crepe_satin', 0.5, 1024),
      concrete: tex('concrete', 'tex.polyhaven.concrete_floor_02', 2, 1024),
      asphalt: tex('asphalt', 'tex.polyhaven.asphalt_02', 2, 1024),
      rubber_mat: tex('rubber_mat', 'tex.polyhaven.rubber_tiles', 1, 1024),
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
  for (const h of Object.values(m.hdri)) { out.push(h.url1k); if (h.url2k) out.push(h.url2k); }
  for (const t of Object.values(m.textures)) {
    out.push(t.color, t.normal, t.roughness, t.ao);
    if (t.metalness) out.push(t.metalness);
  }
  out.push(...Object.values(m.fonts.broadcast.files));
  return out;
}

export interface PreloadProgress { loaded: number; total: number; bytes: number; failed: string[] }

/**
 * Warm the HTTP cache for a set of assets (default: everything but the 2k
 * HDRIs), at most `concurrency` requests at a time. Resolves when all have
 * finished; failures are reported, not thrown, so a missing optional asset
 * never blocks the broadcast.
 */
export async function preload(
  urls: readonly string[] = allAssetUrls().filter((u) => !u.includes('_2k.')),
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
