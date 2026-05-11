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
      // baseline 2026-05-11-2: statements=56.89%, branches=55.83%, lines=58.87%, functions=45.97%
      // (предыдущий baseline 2026-05-11: 49.9 / 49.88 / 51.66 / 40.34)
      // Прирост обеспечен добавлением GraphCache/AuthorStatsCache/SshKeyManager/SafetyNet/FileWatcher тестов.
      // Запас 2% против случайных флуктуаций (округление вниз). Поднимаем
      // числа по мере роста покрытия — но НЕ опускаем без явной причины.
      thresholds: {
        statements: 54,
        branches: 53,
        lines: 56,
        functions: 43,
      },
    },
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
    },
  },
});
