import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The generated replay corpus lives in public/replays/ and is a build
  // artefact for the repo, not something to ship in the page bundle.
  publicDir: false,
  build: {
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    rollupOptions: { output: { manualChunks: undefined, inlineDynamicImports: true } },
  },
  test: { globals: true, environment: 'node' },
});
