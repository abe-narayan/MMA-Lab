import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // `public/replays/` holds the legacy v3 corpus, which is a repo artefact and
  // must not ship. Runtime assets for the 3D broadcast (body meshes, textures,
  // HDR environments, motion clips) live in `static/` instead and are served at
  // the site root, e.g. `static/assets/body/base.bin` -> `/assets/body/base.bin`.
  publicDir: 'static',
  build: {
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: { output: { manualChunks: undefined, inlineDynamicImports: true } },
  },
  test: { globals: true, environment: 'node' },
});
