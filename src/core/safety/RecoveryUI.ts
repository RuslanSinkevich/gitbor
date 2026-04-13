import { dialog, shell, BrowserWindow } from 'electron';
import { GitExecutor } from '../git/GitExecutor';
import { RecoveryAction, RecoveryIssue, RecoveryReport } from '../git/types';
import { RecoveryManager } from './RecoveryManager';

function getWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

export async function checkGitAvailable(git: GitExecutor): Promise<{ available: boolean; version?: string }> {
  try {
    const result = await git.exec(['--version']);
    return { available: true, version: result.stdout.trim() };
  } catch {
    return { available: false };
  }
}

export async function showGitNotFoundMessage(): Promise<void> {
  const win = getWindow();
  const options = {
    type: 'error' as const,
    title: 'SkyFork',
    message: 'Git не обнаружен. Для работы приложения необходим Git.',
    buttons: ['Скачать Git', 'Указать путь к Git', 'Закрыть'],
    defaultId: 0,
  };
  const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  if (result.response === 0) shell.openExternal('https://git-scm.com/downloads');
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
      title: 'SkyFork',
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
          title: 'SkyFork — Recovery Failed',
          message: errMsg,
          buttons: ['OK'],
        };
        if (win) await dialog.showMessageBox(win, errOpts);
        else await dialog.showMessageBox(errOpts);
      }
    }
  }
}
