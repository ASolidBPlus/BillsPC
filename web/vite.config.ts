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
  // Allow any host for the preview server so cloudflared / ngrok-style
  // tunnel testing works. The preview server is only used for local
  // testing — never deployed — so the relaxed host check is fine.
  preview: { allowedHosts: true, host: '0.0.0.0' },
  server: { allowedHosts: true, host: '0.0.0.0' },
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
