import { app, dialog, shell, BrowserWindow } from 'electron';
import { GitExecutor } from '../git/GitExecutor';
import { RecoveryAction, RecoveryIssue, RecoveryReport } from '../git/types';
import { RecoveryManager } from './RecoveryManager';
import { pickGitNotFoundLocale, type GitNotFoundLocale } from './RecoveryUI.locales';

function getWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

/**
 * `app.getLocale()` доступен только после `whenReady()`. На случай вызова
 * из unit-тестов с пустым моком electron — try/catch с fallback на `en`.
 */
function currentGitNotFoundLocale(): GitNotFoundLocale {
  let tag: string | undefined;
  try {
    if (typeof app.getLocale === 'function') {
      tag = app.getLocale();
    }
  } catch {
    tag = undefined;
  }
  return pickGitNotFoundLocale(tag);
}

export async function checkGitAvailable(git: GitExecutor): Promise<{ available: boolean; version?: string }> {
  try {
    const result = await git.exec(['--version']);
    return { available: true, version: result.stdout.trim() };
  } catch {
    return { available: false };
  }
}

/**
 * Диалог-предупреждение «Git не найден». Возвращает решение пользователя:
 *
 * - `shouldQuit: true`  — пользователь выбрал «Закрыть» (или закрыл диалог
 *   через cancelId). Вызывающий код должен сделать `app.quit()` и НЕ создавать
 *   главное окно — без git UI всё равно нерабочий, чтобы не вводить юзера
 *   в заблуждение мёртвой welcome-страницей.
 * - `shouldQuit: false` — пользователь нажал «Скачать Git». Открыли страницу
 *   загрузки во внешнем браузере; UI оставляем поднятым, пользователь сам
 *   решит, когда перезапускать приложение после установки.
 *
 * Прошлая кнопка «Указать путь к Git» удалена: обработчика для неё нет,
 * file picker — отдельный стрим, держать мёртвую кнопку = вводить в
 * заблуждение.
 */
export async function showGitNotFoundMessage(): Promise<{ shouldQuit: boolean }> {
  const win = getWindow();
  const locale = currentGitNotFoundLocale();
  const options = {
    type: 'error' as const,
    title: locale.title,
    message: locale.message,
    buttons: [...locale.buttons],
    defaultId: 0,
    // ESC/закрытие крестиком трактуем как «Закрыть» — без git стартовать
    // welcome-экран бессмысленно.
    cancelId: 1,
  };
  const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  if (result.response === 0) {
    void shell.openExternal(locale.downloadUrl);
    return { shouldQuit: false };
  }
  return { shouldQuit: true };
}

function getButtonsForIssue(issue: RecoveryIssue): { label: string; action: RecoveryAction }[] {
  switch (issue.type) {
    case 'interrupted_operation':
      return [
        { label: 'Откатить к сохранённому состоянию', action: issue.suggestedAction },
        { label: 'Игнорировать', action: { type: 'ignore' } },
      ];
    case 'lock_file':
      return [
        { label: 'Удалить lock-файл', action: { type: 'remove_lock' } },
        { label: 'Игнорировать', action: { type: 'ignore' } },
      ];
    case 'unfinished_merge':
      return [
        { label: 'Отменить merge', action: { type: 'abort_merge' } },
        { label: 'Продолжить merge', action: { type: 'continue_merge' } },
        { label: 'Игнорировать', action: { type: 'ignore' } },
      ];
    case 'unfinished_rebase':
      return [
        { label: 'Отменить rebase', action: { type: 'abort_rebase' } },
        { label: 'Продолжить rebase', action: { type: 'continue_rebase' } },
        { label: 'Игнорировать', action: { type: 'ignore' } },
      ];
    case 'orphaned_auto_stash':
      return [
        { label: 'Восстановить', action: issue.suggestedAction },
        { label: 'Игнорировать', action: { type: 'ignore' } },
      ];
  }
}

export async function showRecoveryDialog(report: RecoveryReport, recovery: RecoveryManager): Promise<void> {
  const win = getWindow();

  for (const issue of report.issues) {
    const buttons = getButtonsForIssue(issue);
    const options = {
      type: 'warning' as const,
      title: 'GitBor',
      message: issue.description,
      buttons: buttons.map(b => b.label),
      defaultId: 0,
    };
    const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);

    const selected = buttons[result.response];
    if (selected) {
      try {
        await recovery.executeRecovery(selected.action);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const errOpts = {
          type: 'error' as const,
          title: 'GitBor — Recovery Failed',
          message: errMsg,
          buttons: ['OK'],
        };
        if (win) await dialog.showMessageBox(win, errOpts);
        else await dialog.showMessageBox(errOpts);
      }
    }
  }
}
