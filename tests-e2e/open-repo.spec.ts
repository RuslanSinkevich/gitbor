import { test, expect } from '@playwright/test';
import { launchApp, makeFixtureRepo } from './helpers';

test.skip(process.platform !== 'win32', 'E2E пока только windows-only (mac/linux — следующий стрим)');

test('opens fixture repo via cwd, Sidebar shows main branch', async () => {
  const fx = makeFixtureRepo();
  const { app, page } = await launchApp({ cwd: fx.repoPath });
  try {
    await expect(page.locator('[data-testid="titlebar"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible({ timeout: 30_000 });
    // У ветки main должен появиться элемент в дереве веток. Используем
    // text-локатор: точная class-разметка хеширована CSS-modules'ами.
    await expect(page.locator('[data-testid="sidebar"]').getByText('main', { exact: false })).toBeVisible({ timeout: 30_000 });
  } finally {
    await app.close();
    fx.cleanup();
  }
});
