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
  },
});
