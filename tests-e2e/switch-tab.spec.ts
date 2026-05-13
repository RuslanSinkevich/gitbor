import { test, expect } from '@playwright/test';
import { launchApp, makeFixtureRepo } from './helpers';

test.skip(process.platform !== 'win32', 'E2E пока только windows-only (mac/linux — следующий стрим)');

test('opens second repo via IPC, switches tabs through RepoTabs', async () => {
  const fxA = makeFixtureRepo('gitbor-e2e-A-');
  const fxB = makeFixtureRepo('gitbor-e2e-B-');
  const { app, page } = await launchApp({ cwd: fxA.repoPath });
  try {
    await expect(page.locator('[data-testid="titlebar"]')).toBeVisible({ timeout: 30_000 });

    // Дожидаемся появления первого таба (репо A открылось через autoOpenRepo).
    await expect(page.locator('[data-testid="repo-tab-0"]')).toBeVisible({ timeout: 30_000 });

    // Открываем B напрямую через preload-API, минуя файловый диалог:
    // window.gitBorAPI.invoke({ type: 'openRepo', path: fxB.repoPath }).
    await page.evaluate((p) => {
      const api = (window as unknown as { gitBorAPI?: { invoke: (cmd: unknown) => Promise<unknown> } }).gitBorAPI;
      return api?.invoke({ type: 'openRepo', path: p });
    }, fxB.repoPath);

    // Должны появиться оба таба.
    await expect(page.locator('[data-testid="repo-tab-1"]')).toBeVisible({ timeout: 30_000 });

    // Кликаем на первый таб — переключаемся на A.
    await page.locator('[data-testid="repo-tab-0"]').click();
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();

    // И обратно на B.
    await page.locator('[data-testid="repo-tab-1"]').click();
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
  } finally {
    await app.close();
    fxA.cleanup();
    fxB.cleanup();
  }
});
