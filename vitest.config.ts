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
      // baseline 2026-05-12: statements=57.73%, branches=56.10%, lines=59.79%, functions=47.24%
      // (предыдущий baseline 2026-05-11-2: 56.89 / 55.83 / 58.87 / 45.97)
      // Прирост обеспечен новыми тестами на perf.ts (29%→100%) и RepoEventBus
      // (27%→100%) — utils 80.98%→88.34%.
      // Запас ~1.5% против флуктуаций (округление вниз). Поднимаем числа по
      // мере роста покрытия — но НЕ опускаем без явной причины.
      thresholds: {
        statements: 56,
        branches: 55,
        lines: 58,
        functions: 46,
      },
    },
  },
  resolve: {
    alias: {
      '@core': resolve(__dirname, 'src/core'),
    },
  },
});
