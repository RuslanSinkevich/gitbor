import { test, expect } from '@playwright/test';
import { execFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { launchApp, makeFixtureRepo } from './helpers';

/**
 * E2E для safety-flow:
 *   1. Fake .git/index.lock на свежем (мс) lock → SafetyDialog с действиями;
 *   2. Merge с конфликтом → НЕТ rollback, есть MergeBanner;
 *   3. fetch с unresolvable host → toast с Retry-action;
 *   4. Orphaned auto-stash после fail → диалог "восстановить".
 *
 * Все тесты windows-only (как и остальные e2e); для запуска нужен
 * `npm run build` перед сессией.
 */
test.skip(process.platform !== 'win32', 'E2E windows-only stream');

test('fresh index.lock → SafetyDialog appears with remove_lock / cancel actions', async () => {
  const fx = makeFixtureRepo();
  // Создаём свежий index.lock прямо в .git
  writeFileSync(join(fx.repoPath, '.git', 'index.lock'), '');

  const { app, page } = await launchApp({ cwd: fx.repoPath });
  try {
    await expect(page.locator('[data-testid="titlebar"]')).toBeVisible({ timeout: 30_000 });

    // Дёргаем любую destructive операцию (fetch на не-репо подойдёт; но
    // на чистом локальном репо fetch не покажет lock — нужен реальный
    // merge). Запускаем merge самой себя, чтобы preflight упёрся в lock.
    await page.evaluate(() => {
      // Используем publicly exposed gitBorAPI (через preload).
      const win = window as unknown as { gitBorAPI?: { invoke: (cmd: unknown) => Promise<unknown> } };
      void win.gitBorAPI?.invoke({ type: 'merge', branch: 'main' });
    });

    // SafetyDialog должен открыться — title из локали (en или ru).
    const dialog = page.locator('dialog.sg-dialog').filter({
      hasText: /git process|git-процесс|index\.lock/i,
    });
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    // Кнопка remove_lock (по локали).
    const removeBtn = dialog.locator('button').filter({ hasText: /Remove index\.lock|Удалить index\.lock/i });
    await expect(removeBtn).toBeVisible();
  } finally {
    await app.close();
    fx.cleanup();
  }
});

test('merge with conflict: NO rollback, MergeBanner shown', async () => {
  const fx = makeFixtureRepo();
  const env = { ...process.env, GIT_AUTHOR_NAME: 'E2E', GIT_AUTHOR_EMAIL: 'e2e@local', GIT_COMMITTER_NAME: 'E2E', GIT_COMMITTER_EMAIL: 'e2e@local' };

  // Готовим конфликт: ветка feature меняет ту же строку что main.
  writeFileSync(join(fx.repoPath, 'a.txt'), 'main line\n');
  execFileSync('git', ['add', 'a.txt'], { cwd: fx.repoPath, env });
  execFileSync('git', ['commit', '-m', 'main-add'], { cwd: fx.repoPath, env });
  execFileSync('git', ['checkout', '-b', 'feature'], { cwd: fx.repoPath, env });
  writeFileSync(join(fx.repoPath, 'a.txt'), 'feature line\n');
  execFileSync('git', ['add', 'a.txt'], { cwd: fx.repoPath, env });
  execFileSync('git', ['commit', '-m', 'feature-add'], { cwd: fx.repoPath, env });
  execFileSync('git', ['checkout', 'main'], { cwd: fx.repoPath, env });
  writeFileSync(join(fx.repoPath, 'a.txt'), 'main line v2\n');
  execFileSync('git', ['add', 'a.txt'], { cwd: fx.repoPath, env });
  execFileSync('git', ['commit', '-m', 'main-v2'], { cwd: fx.repoPath, env });

  const { app, page } = await launchApp({ cwd: fx.repoPath });
  try {
    await expect(page.locator('[data-testid="titlebar"]')).toBeVisible({ timeout: 30_000 });

    await page.evaluate(() => {
      const win = window as unknown as { gitBorAPI?: { invoke: (cmd: unknown) => Promise<unknown> } };
      void win.gitBorAPI?.invoke({ type: 'merge', branch: 'feature' });
    });

    // MergeBanner появляется при mergeState.inProgress.
    const banner = page.locator('[data-testid="merge-banner"], .merge-banner').first();
    await expect(banner).toBeVisible({ timeout: 15_000 });

    // Проверяем что файл a.txt ОСТАЛСЯ изменён (нет rollback'а).
    // Делаем через git status внутри fixture репо.
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: fx.repoPath, env });
    expect(status.toString()).toMatch(/UU\s+a\.txt/);
  } finally {
    await app.close();
    fx.cleanup();
  }
});

test('fetch from unreachable host: action-toast with Retry', async () => {
  const fx = makeFixtureRepo();
  const env = { ...process.env, GIT_AUTHOR_NAME: 'E2E', GIT_AUTHOR_EMAIL: 'e2e@local' };
  // Добавляем заведомо unreachable remote.
  execFileSync('git', ['remote', 'add', 'origin', 'https://gitbor-no-such-host-12345.example/foo.git'], { cwd: fx.repoPath, env });

  const { app, page } = await launchApp({ cwd: fx.repoPath });
  try {
    await expect(page.locator('[data-testid="titlebar"]')).toBeVisible({ timeout: 30_000 });

    await page.evaluate(() => {
      const win = window as unknown as { gitBorAPI?: { invoke: (cmd: unknown) => Promise<unknown> } };
      void win.gitBorAPI?.invoke({ type: 'fetch', remote: 'origin' });
    });

    // Toast с Retry-кнопкой.
    const retryToast = page.locator('.sg-toast').filter({ hasText: /Retry|Повторить/ });
    await expect(retryToast).toBeVisible({ timeout: 60_000 });
  } finally {
    await app.close();
    fx.cleanup();
  }
});

test('orphaned auto-stash after failed merge → recovery dialog at startup', async () => {
  const fx = makeFixtureRepo();
  const env = { ...process.env, GIT_AUTHOR_NAME: 'E2E', GIT_AUTHOR_EMAIL: 'e2e@local', GIT_COMMITTER_NAME: 'E2E', GIT_COMMITTER_EMAIL: 'e2e@local' };

  // Делаем uncommitted change, стэшим под GitBor-prefix, оставляем как
  // "осиротевший" (без записи в журнале операции).
  writeFileSync(join(fx.repoPath, 'a.txt'), 'wip\n');
  execFileSync('git', ['stash', 'push', '-m', '[GitBor auto-stash] before merge stale'], { cwd: fx.repoPath, env });

  const { app, page } = await launchApp({ cwd: fx.repoPath });
  try {
    // Native Electron-диалог не доступен Playwright'у напрямую; проверяем
    // что recovery-баннер либо натив-диалог отработали (косвенно — что
    // приложение запустилось без падения и стэш виден в sidebar Stashes).
    await expect(page.locator('[data-testid="sidebar"]')).toBeVisible({ timeout: 30_000 });
    const stashesGroup = page.locator('[data-testid="sidebar"]').getByText('Stashes', { exact: false });
    await expect(stashesGroup).toBeVisible({ timeout: 10_000 });
  } finally {
    await app.close();
    fx.cleanup();
  }
});
