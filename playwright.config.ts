import { defineConfig } from '@playwright/test';

/**
 * Playwright config для E2E smoke-тестов.
 *
 * Запускаем единственный проект `electron-windows`. На non-Windows прогон
 * пропускается (вся фикстура и launch завязаны на Windows-сборку electron).
 * Полноценный mac/linux smoke — следующий стрим.
 *
 * Тесты ОЖИДАЮТ что `npm run build` уже отработал (dist/main + dist/renderer
 * существуют). Запуск самого билда — задача CI или ручной команды
 * `npm run e2e:build` (в этом стриме не добавляли отдельный скрипт; тесты
 * запускаются через `npx playwright test`).
 */
export default defineConfig({
  testDir: './tests-e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'tests-e2e/_report' }]] : 'list',
  projects: [
    {
      name: 'electron-windows',
      // Платформенный фильтр на уровне теста (test.skip(process.platform !== 'win32'))
      // — здесь прописан явный gate чтобы случайно не запустить mac/linux.
      testMatch: /.*\.spec\.ts$/,
    },
  ],
});
