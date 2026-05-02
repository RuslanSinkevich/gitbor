import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Контракт `RecoveryManager.checkOnStartup` для index.lock:
 *
 * - Свежий lock (<15с) → диалог-issue, юзер сам решает (может реально другой
 *   git-instance параллельно работает в терминале).
 * - Stale lock (≥15с) → silently удаляется, без issue. Это типичный остаток
 *   после нашего SIGTERM на выходе — юзера не нужно дёргать диалогом каждый
 *   запуск (это и была жалоба «часто выпадает при запуске»).
 */

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/skyfork-recovery-test' },
}));

describe('RecoveryManager.checkLockFiles', () => {
  let repoDir: string;
  let gitDir: string;
  let lockPath: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'skyfork-rec-'));
    gitDir = join(repoDir, '.git');
    mkdirSync(gitDir, { recursive: true });
    lockPath = join(gitDir, 'index.lock');
  });

  afterEach(() => {
    try { rmSync(repoDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function makeManager() {
    const git: any = {
      getCwd: () => repoDir,
      exec: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0, duration: 1 })),
    };
    const journal: any = {
      getIncomplete: vi.fn(async () => []),
      cleanup: vi.fn(async () => {}),
    };
    const safetyNet: any = {};
    return { git, journal, safetyNet };
  }

  it('фолбэк: lock отсутствует — пустой отчёт', async () => {
    const { RecoveryManager } = await import('../../src/core/safety/RecoveryManager');
    const { git, journal, safetyNet } = makeManager();
    const rm = new RecoveryManager(git, journal, safetyNet);
    const report = await rm.checkOnStartup();
    expect(report.hasIssues).toBe(false);
    expect(report.issues).toEqual([]);
  });

  it('свежий index.lock (<15с) → issue в отчёте, файл НЕ удалён', async () => {
    writeFileSync(lockPath, '');
    const { RecoveryManager } = await import('../../src/core/safety/RecoveryManager');
    const { git, journal, safetyNet } = makeManager();
    const rm = new RecoveryManager(git, journal, safetyNet);
    const report = await rm.checkOnStartup();
    expect(report.hasIssues).toBe(true);
    const lockIssue = report.issues.find(i => i.type === 'lock_file');
    expect(lockIssue).toBeDefined();
    expect(existsSync(lockPath)).toBe(true);
  });

  it('stale index.lock (≥15с) → silently удалён, нет issue', async () => {
    writeFileSync(lockPath, '');
    // Сдвигаем mtime назад на 30 секунд (явно старше порога 15с).
    const old = (Date.now() - 30_000) / 1000;
    utimesSync(lockPath, old, old);

    const { RecoveryManager } = await import('../../src/core/safety/RecoveryManager');
    const { git, journal, safetyNet } = makeManager();
    const rm = new RecoveryManager(git, journal, safetyNet);
    const report = await rm.checkOnStartup();

    const lockIssues = report.issues.filter(i => i.type === 'lock_file');
    expect(lockIssues.length).toBe(0);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('lock ровно на границе (~5с) считается свежим (диалог)', async () => {
    writeFileSync(lockPath, '');
    const recent = (Date.now() - 5_000) / 1000;
    utimesSync(lockPath, recent, recent);

    const { RecoveryManager } = await import('../../src/core/safety/RecoveryManager');
    const { git, journal, safetyNet } = makeManager();
    const rm = new RecoveryManager(git, journal, safetyNet);
    const report = await rm.checkOnStartup();
    expect(report.issues.some(i => i.type === 'lock_file')).toBe(true);
    expect(existsSync(lockPath)).toBe(true);
  });
});
