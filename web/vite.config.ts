/**
 * Vite config for the pokeportal web demo.
 *
 * Per PLAN_EVAL A11: pin output filenames so the CI bundle-size gate
 * can reference a stable name. We force a single chunk by setting
 * `manualChunks: undefined` and `inlineDynamicImports: true`. Per
 * PLAN_EVAL "Risks" #10, we also disable `cssCodeSplit` and
 * `modulePreload` so the build produces exactly one JS file under
 * `dist/assets/app.js`.
 */
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    modulePreload: false,
    cssCodeSplit: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/chunk-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
