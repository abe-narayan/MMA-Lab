/**
 * Optional photographic detail for the venue, from the CC0 Poly Haven sets the
 * asset pipeline placed in `static/assets/textures/` (docs/ASSETS.md):
 *
 *   canvas/normal.jpg   "Rough Linen"   woven-canvas normal, tiled ~0.4 m
 *   asphalt/*           "Asphalt 02"    street ground colour/normal/roughness
 *   vinyl/normal.jpg    "Fabric Leather 02"  fine grain on competition mats
 *
 * Everything here is optional: a missing file (tests, offline builds, a slow
 * network) falls back to the procedural material, so the set always builds.
 */
import * as THREE from 'three/webgpu';
import type { QualitySettings } from '../contract';
import type { SetKind } from './geometry';

export interface ArenaTextures {
  canvasNormal?: THREE.Texture;
  vinylNormal?: THREE.Texture;
  asphalt?: { color: THREE.Texture; normal: THREE.Texture; roughness: THREE.Texture };
}

function base(): string {
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  return (env?.BASE_URL ?? '/').replace(/\/?$/, '/');
}

async function load(path: string, srgb: boolean, anisotropy: number): Promise<THREE.Texture | undefined> {
  if (typeof document === 'undefined') return undefined;
  try {
    const t = await new THREE.TextureLoader().loadAsync(`${base()}assets/textures/${path}`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = anisotropy;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  } catch {
    return undefined;
  }
}

export async function loadArenaTextures(kind: SetKind, q: QualitySettings): Promise<ArenaTextures> {
  if (q.level === 'low') return {};
  const aniso = q.level === 'ultra' ? 16 : 8;
  const out: ArenaTextures = {};
  if (kind === 'octagon' || kind === 'ring') {
    out.canvasNormal = await load('canvas/normal.jpg', false, aniso);
  } else if (kind === 'mat') {
    out.vinylNormal = await load('vinyl/normal.jpg', false, aniso);
  } else {
    const [color, normal, roughness] = await Promise.all([
      load('asphalt/color.jpg', true, aniso), load('asphalt/normal.jpg', false, aniso), load('asphalt/roughness.jpg', false, aniso),
    ]);
    if (color && normal && roughness) out.asphalt = { color, normal, roughness };
  }
  return out;
}
