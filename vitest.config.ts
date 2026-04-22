import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'core/src/**/__tests__/**/*.test.ts'],
    globals: false,
  },
});
