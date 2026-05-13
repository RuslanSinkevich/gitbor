import { app, dialog, shell, BrowserWindow } from 'electron';
import { GitExecutor } from '../git/GitExecutor';
import { mainLogger } from '../utils/Logger';
import { pickLongPathLocale, type LongPathLocale } from './LongPathSuggester.locales';

/**
 * Получаем актуальный локалевой пакет: `app.getLocale()` доступен только
 * после `whenReady()`, но `inspectStderr` вызывается при exec'ах git, что
 * заведомо позже. На случай unit-тестов с пустым моком electron — try/catch
 * с fallback на `en`.
 */
function currentLocale(): LongPathLocale {
  let tag: string | undefined;
  try {
    if (typeof app.getLocale === 'function') {
      tag = app.getLocale();
    }
  } catch {
    tag = undefined;
  }
  return pickLongPathLocale(tag);
}

/**
 * На Windows глубокие node_modules (а также репозитории с длинными путями
 * вроде vendored npm-пакетов) валятся в git с
 *   error: unable to create file ...: Filename too long
 * пока юзер не выставит `git config --global core.longpaths true`.
 *
 * Здесь — единоразовый per-session детектор: при первом совпадении
 * паттерна предлагаем включить опцию глобально.
 */

const LONG_PATH_PATTERNS: ReadonlyArray<RegExp> = [
  /Filename too long/i,
  /unable to create file .*: File name too long/i,
  /unable to create directory .*: File name too long/i,
];

let alreadyOffered = false;
let alreadyKnownEnabled = false;

function getWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

function looksLikeLongPathError(stderr: string): boolean {
  if (!stderr) return false;
  return LONG_PATH_PATTERNS.some((p) => p.test(stderr));
}

async function isLongPathsEnabledGlobally(git: GitExecutor): Promise<boolean> {
  try {
    const r = await git.exec(['config', '--global', '--get', 'core.longpaths']);
    if (r.exitCode === 0) {
      const v = r.stdout.trim().toLowerCase();
      return v === 'true' || v === '1';
    }
    return false;
  } catch {
    return false;
  }
}

async function tryEnableLongPathsGlobally(git: GitExecutor): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await git.exec(['config', '--global', 'core.longpaths', 'true']);
    if (r.exitCode === 0) return { ok: true };
    return { ok: false, error: r.stderr.trim() || `exit ${r.exitCode}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function showSuggestDialog(locale: LongPathLocale): Promise<number> {
  const win = getWindow();
  const options = {
    type: 'warning' as const,
    title: locale.title,
    message: locale.message,
    detail: locale.detail,
    buttons: [...locale.buttons],
    defaultId: 0,
    cancelId: 1,
  };
  const result = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  return result.response;
}

async function showResultDialog(message: string, isError: boolean): Promise<void> {
  const win = getWindow();
  const options = {
    type: isError ? ('error' as const) : ('info' as const),
    title: 'GitBor',
    message,
    buttons: ['OK'],
  };
  if (win) await dialog.showMessageBox(win, options);
  else await dialog.showMessageBox(options);
}

/**
 * Вызывается из GitExecutor после каждого exec (через setStderrInspector).
 * Сам по себе вызов дешёвый: regex по короткому stderr; полный путь
 * (config + dialog) запускается только при первом матче.
 */
export function inspectStderr(stderr: string, git: GitExecutor): void {
  if (alreadyOffered || alreadyKnownEnabled) return;
  if (process.platform !== 'win32') return;
  if (!looksLikeLongPathError(stderr)) return;

  alreadyOffered = true;
  void (async () => {
    const locale = currentLocale();
    try {
      if (await isLongPathsEnabledGlobally(git)) {
        alreadyKnownEnabled = true;
        return;
      }
      const choice = await showSuggestDialog(locale);
      if (choice === 0) {
        const r = await tryEnableLongPathsGlobally(git);
        if (r.ok) {
          alreadyKnownEnabled = true;
          await showResultDialog(locale.successMessage, false);
        } else {
          await showResultDialog(
            locale.errorMessage(r.error ?? 'unknown error'),
            true,
          );
        }
      } else if (choice === 2) {
        shell.openExternal(locale.learnMoreUrl);
      }
    } catch (e) {
      mainLogger.warn(`LongPathSuggester failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  })();
}

/**
 * Регистрирует suggester в GitExecutor. Вызывать один раз из main bootstrap.
 */
export function attachLongPathSuggester(git: GitExecutor): void {
  GitExecutor.setStderrInspector((stderr) => inspectStderr(stderr, git));
}

/** Только для тестов: сбросить per-session кэш. */
export function _resetLongPathSuggesterForTests(): void {
  alreadyOffered = false;
  alreadyKnownEnabled = false;
}
