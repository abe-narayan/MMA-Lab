/**
 * Character module entry point (docs/design/08 §3–4).
 *
 * `createCharacterFactory()` returns the factory the presenter uses through `contract.ts`:
 *  - `preload()` fetches the MakeHuman-derived body asset (static/assets/body/), packs MPFB's UV
 *    region masks and generates the procedural detail textures — once, shared by every fighter;
 *  - `create()` builds one fighter (morph, fit, skeleton, skin, hair, kit) and returns a
 *    `CharacterActor`.
 */
import type * as THREE from 'three/webgpu';
import type { BoutPresentation, CharacterActor, CharacterFactory, QualitySettings } from '../contract';
import { loadBodyAsset } from './asset';
import { canonical } from './canonical';
import { loadMasks } from './masks';
import { makeClothDetail, makeLeatherDetail, makeSkinDetail, makeSweatDetail } from './textures';
import { FighterActor, type SharedResources } from './actor';

export { FighterActor } from './actor';
export { FACE_PRESETS, HAIR_STYLES, HAIR_COLOURS, skinAlbedo, skinPalette } from './appearance';

export interface CharacterFactoryOptions {
  /** Site path of static/assets/body/ (default `/assets/body/`). */
  assetBase?: string;
}

export function createCharacterFactory(opts: CharacterFactoryOptions = {}): CharacterFactory {
  const base = opts.assetBase ?? '/assets/body/';
  let shared: SharedResources | null = null;
  let loading: Promise<void> | null = null;
  return {
    preload(): Promise<void> {
      if (!loading) {
        loading = (async () => {
          const [asset, masks] = await Promise.all([loadBodyAsset(base), loadMasks(base)]);
          const materials = new Map<string, THREE.Material>();
          shared = {
            asset,
            can: canonical(asset),
            skinTex: { maskA: masks.maskA, maskB: masks.maskB, detail: makeSkinDetail(), sweat: makeSweatDetail() },
            kitTex: { cloth: makeClothDetail(), leather: makeLeatherDetail() },
            material<M extends THREE.Material>(key: string, make: () => M): M {
              let m = materials.get(key);
              if (!m) { m = make(); materials.set(key, m); }
              return m as M;
            },
          };
        })();
        loading.catch(() => { loading = null; });
      }
      return loading;
    },
    create(bout: BoutPresentation, fighterIndex: number, quality: QualitySettings): CharacterActor {
      if (!shared) throw new Error('CharacterFactory.create() before preload() resolved');
      return new FighterActor(shared, bout, fighterIndex, quality);
    },
  };
}
