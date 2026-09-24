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
| `textures/canvas/{normal,ao}.jpg` | Poly Haven "Rough Linen" (CC0): canvas weave normal and cavity | downloaded, renamed | tex.polyhaven.rough_linen |
| `textures/vinyl/normal.jpg` | Poly Haven "Fabric Leather 02" (CC0): mat grain | downloaded, renamed | tex.polyhaven.fabric_leather_02 |
| `textures/asphalt/{color,normal,roughness}.jpg` | Poly Haven "Asphalt 02" (CC0): street lot | downloaded, renamed | tex.polyhaven.asphalt_02 |
| `fonts/*.woff2`, `fonts/OFL.txt` | Barlow Condensed (OFL-1.1) and its licence | downloaded | font.barlow-condensed, font.barlow-condensed.extrabold |

Only files the runtime loads ship: the texture maps are exactly those in
`src/presentation/assets/manifest.ts` (a test fails if a file here is not listed there), and no HDRI
ships (the arena paints its own environment lighting). Unused maps and sets were removed in the final
cleanup; see `docs/ASSETS.md`.

The referee's clothes, the corner stools and the live depth of field added in the Phase 8
broadcast polish pass are generated at runtime (no files).
