import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      exclude: ['src/core/git/types/**'],
      reporter: ['text', 'text-summary'],
    },
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
    },
  },
});
