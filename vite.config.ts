import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Runtime assets for the 3D broadcast (body mesh, motion clips, textures,
  // fonts) live in `static/` and are served at the site root, e.g.
  // `static/assets/body/body.bin` -> `/assets/body/body.bin`. Everything in
  // `static/` ships, so it holds only files the runtime loads (docs/ASSETS.md).
  publicDir: 'static',
  build: {
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    // Code splitting (docs/design/UI_PASS.md, "UI pass 2"): the first screen
    // loads the shell, Match setup and the sim; Watch, the 3D broadcast
    // (three.js/WebGPU, src/presentation), Batch, the fighter editor and the
    // parameter registry are chunks fetched when first opened.
    // `vite build --mode single` (npm run build:single) keeps the old single
    // chunk, because scripts/inline.mjs inlines one script into one page and
    // refuses sibling-chunk imports.
    rollupOptions: mode === 'single'
      ? { output: { manualChunks: undefined, inlineDynamicImports: true } }
      : {},
  },
  test: { globals: true, environment: 'node' },
}));
