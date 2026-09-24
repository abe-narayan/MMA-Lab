import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
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
    rollupOptions: { output: { manualChunks: undefined, inlineDynamicImports: true } },
  },
  test: { globals: true, environment: 'node' },
});
