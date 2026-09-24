# Runtime assets for the 3D broadcast

Served at the site root by Vite (`publicDir: 'static'`). Every file here must have an entry in
`docs/ASSETS.md` with its source and licence. Generated files name the script that produced them.

## What is here

| Path | What | Made by | `docs/ASSETS.md` entry |
|---|---|---|---|
| `body/body.bin`, `body/body.json` | MakeHuman/MPFB2 base mesh, targets, rig weights (CC0) | `scripts/assets/build-body.mjs` | body.mpfb2.runtime |
| `body/masks/*.jpg` | MPFB2 UV region masks (CC0), copied unmodified | `scripts/assets/build-body.mjs` | body.mpfb2.runtime |
| `body/skinmaps.bin`, `body/skinmaps.json` | Baked anatomy/skin-region maps (project-original, from the CC0 base mesh) | `scripts/assets/build-skin-maps.ts` | body.skinmaps |
| `motion/` | Motion-capture clip library | asset pipeline | Motion capture |
| `textures/`, `hdri/`, `fonts/` | CC0 textures, HDRIs, OFL fonts | see each entry | see `docs/ASSETS.md` |

The referee's clothes, the corner stools and the live depth of field added in the Phase 8
broadcast polish pass are generated at runtime (no files).
