import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Контракт `LongPathSuggester.inspectStderr`:
 *
 * - Только Windows. На любой другой платформе — no-op.
 * - Сработка единоразовая per-session: после первого матча второй stderr
 *   с тем же паттерном уже не дёргает диалог.
 * - При нажатии «Включить» — идёт `git config --global core.longpaths true`.
 * - Если опция уже включена глобально — диалог не показываем.
 *
 * Тут проверяем именно само поведение детектора и решение «звать ли диалог»;
 * UI/Electron-часть — out of scope (просто мокается).
 */

const showMessageBox = vi.fn();
const openExternal = vi.fn();

vi.mock('electron', () => ({
  app: {},
  BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: {
    showMessageBox: (...args: unknown[]) => showMessageBox(...args),
  },
  shell: {
    openExternal: (...args: unknown[]) => openExternal(...args),
  },
}));

vi.mock('../../src/core/utils/Logger', () => ({
  mainLogger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

function createMockGit(opts?: { longpathsValue?: string }) {
  return {
    exec: vi.fn(async (args: string[]) => {
      if (args[0] === 'config' && args.includes('--get') && args.includes('core.longpaths')) {
        if (opts?.longpathsValue !== undefined) {
          return { stdout: opts.longpathsValue, stderr: '', exitCode: 0, duration: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 1, duration: 0 };
      }
      if (args[0] === 'config' && args.includes('core.longpaths') && args[args.length - 1] === 'true') {
        return { stdout: '', stderr: '', exitCode: 0, duration: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0, duration: 0 };
    }),
  };
}

let originalPlatform: PropertyDescriptor | undefined;
function setPlatform(p: NodeJS.Platform): void {
  originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}
function restorePlatform(): void {
  if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
}

async function flush(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe('LongPathSuggester.inspectStderr', () => {
  beforeEach(async () => {
    showMessageBox.mockReset();
    openExternal.mockReset();
    const mod = await import('../../src/core/safety/LongPathSuggester');
    mod._resetLongPathSuggesterForTests();
  });

  afterEach(() => {
    restorePlatform();
  });

  it('no-op на не-Windows', async () => {
    setPlatform('linux');
    const { inspectStderr } = await import('../../src/core/safety/LongPathSuggester');
    const git = createMockGit();
    inspectStderr('error: unable to create file ./a/b/c.txt: Filename too long', git as never);
    await flush();
    expect(git.exec).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('игнорирует stderr без признаков длинного пути', async () => {
    setPlatform('win32');
    const { inspectStderr } = await import('../../src/core/safety/LongPathSuggester');
    const git = createMockGit();
    inspectStderr('fatal: ambiguous argument', git as never);
    await flush();
    expect(git.exec).not.toHaveBeenCalled();
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('при первом совпадении проверяет config и зовёт диалог', async () => {
    setPlatform('win32');
    showMessageBox.mockResolvedValue({ response: 1 });
    const { inspectStderr } = await import('../../src/core/safety/LongPathSuggester');
    const git = createMockGit();
    inspectStderr('error: unable to create file foo: Filename too long', git as never);
    await flush();
    expect(git.exec).toHaveBeenCalledWith(['config', '--global', '--get', 'core.longpaths']);
    expect(showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('повторный stderr не показывает второй диалог (single-shot)', async () => {
    setPlatform('win32');
    showMessageBox.mockResolvedValue({ response: 1 });
    const { inspectStderr } = await import('../../src/core/safety/LongPathSuggester');
    const git = createMockGit();
    inspectStderr('error: Filename too long', git as never);
    await flush();
    inspectStderr('error: Filename too long', git as never);
    await flush();
    expect(showMessageBox).toHaveBeenCalledTimes(1);
  });

  it('если core.longpaths уже true глобально — диалог не зовёт', async () => {
    setPlatform('win32');
    const { inspectStderr } = await import('../../src/core/safety/LongPathSuggester');
    const git = createMockGit({ longpathsValue: 'true' });
    inspectStderr('error: Filename too long', git as never);
    await flush();
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('кнопка «Включить» (response=0) выполняет git config --global core.longpaths true', async () => {
    setPlatform('win32');
    showMessageBox.mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 0 });
    const { inspectStderr } = await import('../../src/core/safety/LongPathSuggester');
    const git = createMockGit();
    inspectStderr('error: Filename too long', git as never);
    await flush();
    expect(git.exec).toHaveBeenCalledWith(['config', '--global', 'core.longpaths', 'true']);
  });

  it('кнопка «Подробнее» (response=2) открывает внешний URL', async () => {
    setPlatform('win32');
    showMessageBox.mockResolvedValueOnce({ response: 2 });
    const { inspectStderr } = await import('../../src/core/safety/LongPathSuggester');
    const git = createMockGit();
    inspectStderr('error: Filename too long', git as never);
    await flush();
    expect(openExternal).toHaveBeenCalledTimes(1);
  });
});
