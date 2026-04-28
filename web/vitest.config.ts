/**
 * Vitest config for the web workspace. Kept separate from vite.config.ts
 * because Vite's `defineConfig` does not type the `test` field — the
 * shared config used to fail typecheck under TS strict mode.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/__tests__/**/*.test.ts'],
    globals: false,
    // Most existing tests assert on the legacy v1 UI (comparison overlay,
    // upload dropzone, etc.). v2 is now the default for production users
    // (`?ui=v1` opts back into legacy). Setting the legacy flag in jsdom's
    // URL keeps those tests green without per-file beforeEach edits.
    // Tests that exercise v2 explicitly construct the workbench via
    // `renderWorkbench(props)` and don't depend on this default.
    setupFiles: ['src/__tests__/_helpers/setLegacyV1Flag.ts'],
  },
});
