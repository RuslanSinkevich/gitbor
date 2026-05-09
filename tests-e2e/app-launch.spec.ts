import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';

test.skip(process.platform !== 'win32', 'E2E пока только windows-only (mac/linux — следующий стрим)');

test('app launches and TitleBar is visible', async () => {
  const { app, page } = await launchApp();
  try {
    await expect(page.locator('[data-testid="titlebar"]')).toBeVisible({ timeout: 30_000 });
  } finally {
    await app.close();
  }
});
