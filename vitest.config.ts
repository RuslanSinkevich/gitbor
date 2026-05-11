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
      // baseline 2026-05-11: statements=49.9%, branches=49.88%, lines=51.66%, functions=40.34%
      // Запас 2% против случайных флуктуаций (округление вниз). Поднимаем
      // числа по мере роста покрытия — но НЕ опускаем без явной причины.
      thresholds: {
        statements: 47,
        branches: 47,
        lines: 49,
        functions: 38,
      },
    },
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
    },
  },
});
