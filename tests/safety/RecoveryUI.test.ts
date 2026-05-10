import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Контракт `RecoveryUI.showGitNotFoundMessage`:
 *
 * - Возвращает `{ shouldQuit: true }` если пользователь нажал Quit (response=1)
 *   или закрыл диалог (cancelId=1). В этом случае `shell.openExternal` НЕ
 *   вызывается.
 * - Возвращает `{ shouldQuit: false }` если пользователь нажал Download Git
 *   (response=0). При этом `shell.openExternal` вызывается с URL
 *   `https://git-scm.com/downloads`.
 * - message локализован: `en-*` → "Git not found...", `ru-*` → "не обнаружен".
 *   Локаль читается из `app.getLocale()` на каждый вызов (не кэшируется
 *   модулем), поэтому per-test переключение через мок работает без
 *   `vi.resetModules()`.
 *
 * Тут проверяем именно сам контракт диалога; реальный Electron не подымаем,
 * `electron` целиком замокан.
 */

const { showMessageBox, openExternal, getLocaleMock } = vi.hoisted(() => ({
  showMessageBox: vi.fn(),
  openExternal: vi.fn(),
  // Меняется per-test через `mockReturnValue`. Модульный `currentGitNotFoundLocale`
  // дёргает `app.getLocale()` каждый вызов, так что переключение без resetModules
  // работает корректно.
  getLocaleMock: vi.fn<() => string>(() => 'en-US'),
}));

vi.mock('electron', () => ({
  app: { getLocale: () => getLocaleMock() },
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {
    showMessageBox: (...args: unknown[]) => showMessageBox(...args),
  },
  shell: {
    openExternal: (...args: unknown[]) => openExternal(...args),
  },
}));

vi.mock('../../src/core/utils/Logger', () => ({
  mainLogger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

interface DialogOptions {
  message: string;
  buttons: string[];
  cancelId?: number;
  defaultId?: number;
}

function lastDialogOptions(): DialogOptions {
  expect(showMessageBox).toHaveBeenCalled();
  const callArgs = showMessageBox.mock.calls[showMessageBox.mock.calls.length - 1];
  // showMessageBox(win, options) — окно null/моком, но в проде первый аргумент
  // может быть BrowserWindow. Берём последний аргумент как options.
  return callArgs[callArgs.length - 1] as DialogOptions;
}

describe('RecoveryUI.showGitNotFoundMessage', () => {
  beforeEach(() => {
    showMessageBox.mockReset();
    openExternal.mockReset();
    getLocaleMock.mockReset();
    getLocaleMock.mockReturnValue('en-US');
  });

  it('Quit (response=1) → shouldQuit: true, openExternal не вызван', async () => {
    showMessageBox.mockResolvedValue({ response: 1 });
    const { showGitNotFoundMessage } = await import('../../src/core/safety/RecoveryUI');
    const result = await showGitNotFoundMessage();
    expect(result).toEqual({ shouldQuit: true });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('Download Git (response=0) → shouldQuit: false, openExternal с git-scm.com/downloads', async () => {
    showMessageBox.mockResolvedValue({ response: 0 });
    const { showGitNotFoundMessage } = await import('../../src/core/safety/RecoveryUI');
    const result = await showGitNotFoundMessage();
    expect(result).toEqual({ shouldQuit: false });
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith('https://git-scm.com/downloads');
  });

  it('EN locale → message содержит "Git not found"', async () => {
    getLocaleMock.mockReturnValue('en-US');
    showMessageBox.mockResolvedValue({ response: 1 });
    const { showGitNotFoundMessage } = await import('../../src/core/safety/RecoveryUI');
    await showGitNotFoundMessage();
    const opts = lastDialogOptions();
    expect(opts.message).toContain('Git not found');
    expect(opts.buttons).toEqual(['Download Git', 'Quit']);
  });

  it('RU locale → message содержит "не обнаружен"', async () => {
    getLocaleMock.mockReturnValue('ru-RU');
    showMessageBox.mockResolvedValue({ response: 1 });
    const { showGitNotFoundMessage } = await import('../../src/core/safety/RecoveryUI');
    await showGitNotFoundMessage();
    const opts = lastDialogOptions();
    expect(opts.message).toContain('не обнаружен');
    expect(opts.buttons).toEqual(['Скачать Git', 'Закрыть']);
  });

  it('cancelId выставлен в 1 (ESC/крестик трактуем как Quit)', async () => {
    showMessageBox.mockResolvedValue({ response: 1 });
    const { showGitNotFoundMessage } = await import('../../src/core/safety/RecoveryUI');
    await showGitNotFoundMessage();
    const opts = lastDialogOptions();
    expect(opts.cancelId).toBe(1);
    expect(opts.defaultId).toBe(0);
  });
});
