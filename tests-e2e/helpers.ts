import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

/**
 * Запускает SkyFork как Electron-приложение, опционально с cwd=fixtureRepo
 * (тогда autoOpenRepo сам подхватит репо при старте).
 *
 * Перед запуском должен отработать `npm run build` (dist/main/main.js +
 * dist/renderer/index.html существуют).
 */
export async function launchApp(opts?: { cwd?: string }): Promise<{ app: ElectronApplication; page: Page }> {
  const repoRoot = path.resolve(__dirname, '..');
  const app = await electron.launch({
    args: [repoRoot],
    cwd: opts?.cwd ?? repoRoot,
    env: {
      ...process.env,
      // Гарантированно prod-режим: не ждём dev-server на 5188.
      SKYFORK_VITE: '0',
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

/**
 * Создаёт пустой git-репо в новом temp-каталоге, делает первый commit,
 * чтобы у репо был HEAD и ветка main. Возвращает путь к репо и cleanup-функцию.
 */
export function makeFixtureRepo(prefix = 'skyfork-e2e-'): { repoPath: string; cleanup: () => void } {
  const repoPath = mkdtempSync(path.join(tmpdir(), prefix));
  const env = { ...process.env, GIT_AUTHOR_NAME: 'E2E', GIT_AUTHOR_EMAIL: 'e2e@local', GIT_COMMITTER_NAME: 'E2E', GIT_COMMITTER_EMAIL: 'e2e@local' };
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoPath, env });
  execFileSync('git', ['config', 'user.email', 'e2e@local'], { cwd: repoPath, env });
  execFileSync('git', ['config', 'user.name', 'E2E'], { cwd: repoPath, env });
  mkdirSync(path.join(repoPath, 'docs'), { recursive: true });
  writeFileSync(path.join(repoPath, 'README.md'), '# E2E fixture\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: repoPath, env });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: repoPath, env });
  return {
    repoPath,
    cleanup: () => {
      try { rmSync(repoPath, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}
